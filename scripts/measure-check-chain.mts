/**
 * **Where the `check` chain's 30 minutes actually go.**
 *
 * `checks.yml` runs the whole 59-step chain as a *single* `run:` step, so
 * GitHub's own per-step timings say nothing about it: the UI reports one step
 * that took 26 minutes. The only per-script timing that exists is implicit —
 * pnpm echoes each script's command line as `$ <command>`, and the runner
 * timestamps every line. Differencing consecutive `$` lines therefore gives
 * each script's wall clock.
 *
 * ## Why this exists rather than a local `time pnpm run check`
 *
 * A local run has **no cap**, which is exactly how this failure hid: both
 * reviewers of #498 ran `pnpm run check` locally at EXIT=0 while the CI job
 * was being killed at 30 minutes. A local number cannot answer "how close is
 * CI to its limit", because the runner is a different, slower, noisier
 * machine. So this measures the runner's own log.
 *
 * ## Reading the output
 *
 * `--- HEADROOM ---` is the number that matters: the job's wall clock against
 * `checks.yml`'s `timeout-minutes`. A timeout is reported by GitHub as
 * **`cancelled`**, not `failure`, so nothing goes red when this runs out —
 * which is the 29 August outage's exact mechanism and why the margin is worth
 * watching rather than discovering.
 *
 * Usage:
 *   gh run view <run-id> --log > run.log
 *   node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/measure-check-chain.mts run.log
 */

import { readFileSync } from 'node:fs';
// The cap and the step-naming rule live in one place, shared with
// `check-watchdog.mts`. A second copy of either is how they drift.
import { capSeconds, formatDuration as fmt, stepName } from './checkChain.mts';

interface Entry {
  readonly at: number;
  readonly command: string;
}

const path = process.argv[2];
if (!path) throw new Error('usage: measure-check-chain.mts <run.log from `gh run view --log`>');

const lines = readFileSync(path, 'utf8').split('\n');

/**
 * Every `$ <command>` pnpm echoed, with the runner's timestamp for it.
 *
 * The log's shape is `<job>\t<step>\t<ISO timestamp> <text>`, and a BOM sits
 * on the very first line — stripped, or the first timestamp fails to parse and
 * the first script silently gets no start time.
 */
const marks: Entry[] = [];
let jobStart: number | null = null;
let jobEnd: number | null = null;

for (const line of lines) {
  const tab = line.lastIndexOf('\t');
  const text = (tab >= 0 ? line.slice(tab + 1) : line).replace(/^﻿/, '');
  const stamp = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s?(.*)$/s.exec(text);
  if (!stamp) continue;
  const at = new Date(stamp[1]!).getTime() / 1000;
  const body = stamp[2] ?? '';
  if (jobStart === null) jobStart = at;
  jobEnd = at;
  if (body.startsWith('$ ')) marks.push({ at, command: body.slice(2).trim() });
}

if (jobStart === null || jobEnd === null) throw new Error('no timestamped lines — is this a `gh run view --log` dump?');

/**
 * The first `$` line is the whole chain (`pnpm run check:text && …`), echoed
 * by the `run:` step itself. It is not a step; every later one is.
 */
const steps = marks.filter((m) => !m.command.includes('&&'));

const named = steps.map((m, i) => {
  const next = steps[i + 1]?.at ?? jobEnd;
  return { command: stepName(m.command), seconds: next - m.at };
});

named.sort((a, b) => b.seconds - a.seconds);

const chainStart = steps[0]?.at ?? jobStart;
const chainSeconds = jobEnd - chainStart;
const jobSeconds = jobEnd - jobStart;
const cap = capSeconds();

console.log(`script invocations timed: ${named.length}  (not package.json step numbers — one chain entry is itself a mini-chain, so this runs a little high)`);
console.log(`\n--- SLOWEST 20 SCRIPTS (wall clock on the runner) ---`);
for (const s of named.slice(0, 20)) {
  const pct = ((100 * s.seconds) / chainSeconds).toFixed(1);
  console.log(`${fmt(s.seconds).padStart(7)}  ${pct.padStart(5)}%  ${s.command.slice(0, 96)}`);
}

console.log(`\n--- WHERE THE TIME GOES ---`);
console.log(`  job wall clock      ${fmt(jobSeconds)}`);
console.log(`  chain wall clock    ${fmt(chainSeconds)}  (checkout+install: ${fmt(jobSeconds - chainSeconds)})`);
// Deliberately NOT printing "summed script time" as if it corroborated the
// chain's wall clock. Each step's duration is *defined* as the gap to the next
// step's marker, so the sum equals the wall clock by construction — it would
// be a number that agrees with itself whatever the truth, which is exactly
// CLAUDE.md's "a check that passes without checking anything".
const top5 = named.slice(0, 5).reduce((a, b) => a + b.seconds, 0);
console.log(`  top 5 scripts       ${fmt(top5)}  (${((100 * top5) / chainSeconds).toFixed(1)}% of the chain)`);

console.log(`\n--- HEADROOM ---`);
console.log(`  timeout-minutes     ${fmt(cap)}   (read from checks.yml, not copied)`);
console.log(`  this run            ${fmt(jobSeconds)}`);
console.log(`  headroom            ${fmt(cap - jobSeconds)}   ${((100 * jobSeconds) / cap).toFixed(1)}% of cap used`);
if (jobSeconds > cap) {
  console.log(`  *** OVER CAP — GitHub reports this as \`cancelled\`, not \`failure\` ***`);
}
