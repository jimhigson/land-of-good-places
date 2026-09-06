/**
 * **One owner for the two facts both the watchdog and the measurer need:**
 * how long the job is allowed, and what a step is called.
 *
 * Neither is copied. The cap is read out of `.github/workflows/checks.yml`, so
 * changing `timeout-minutes` there moves the watchdog with it — a hand-copied
 * cap is precisely the "two definitions of one thing, kept in step by hand"
 * failure CLAUDE.md puts at the top of its list, and a *stale* cap here would
 * be the worst version of it: the watchdog would fire early (crying wolf) or
 * late (never firing, which is the silence it exists to end).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * `checks.yml`'s own `timeout-minutes`, in seconds.
 *
 * Deliberately strict: if the workflow is restructured so this cannot be
 * found, throw rather than fall back to a default. A watchdog that silently
 * assumes 30 minutes when the real cap has become 20 is worse than no
 * watchdog, because it reports a margin that does not exist.
 */
export function capSeconds(
  workflow = new URL('../.github/workflows/checks.yml', import.meta.url),
): number {
  const yml = readFileSync(workflow, 'utf8');
  // Comments in this file mention `timeout-minutes` in prose, so match only a
  // real YAML key at the start of a line.
  const match = /^\s*timeout-minutes:\s*(\d+)\s*$/m.exec(yml);
  if (!match) {
    throw new Error(
      'checks.yml has no `timeout-minutes:` key — the watchdog cannot know the cap. ' +
        'If the job was restructured, update scripts/checkChain.mts rather than hard-coding a number.',
    );
  }
  return Number(match[1]) * 60;
}

/**
 * **The cap for the job a `gh run view --log` dump came from.**
 *
 * `measure-check-chain.mts` used to call `capSeconds()` with no argument,
 * which silently meant `checks.yml`'s 30 minutes **whatever log it was
 * given**. Pointed at a `Procgen invariants` log it reported *"9m56s, 33.1%
 * of cap used"* — comfortable-sounding, and wrong by exactly 2×: that run was
 * 66.6% of its own 15-minute cap. A confident wrong percentage, in the
 * reassuring direction, from the very tool built to stop that happening.
 *
 * So the log is asked which job it is rather than the caller being trusted to
 * remember. Every line of a `gh` log dump begins with the job's name, and a
 * job's `name:` is what GitHub matches a required status check by — so it is
 * already load-bearing and already unique. Scanning the workflows for the one
 * that declares it needs no hand-maintained map that could drift.
 *
 * Ambiguity and absence both **throw**. Falling back to a default cap is the
 * behaviour that produced the bug.
 */
export function capSecondsForJob(jobName: string, dir = new URL('../.github/workflows/', import.meta.url)): {
  seconds: number;
  workflow: string;
} {
  const root = fileURLToPath(dir);
  const matches: string[] = [];
  for (const file of readdirSync(root)) {
    if (!/\.ya?ml$/.test(file)) continue;
    const yml = readFileSync(root + file, 'utf8');
    // A *job's* `name:` is indented; the workflow's own sits at column 0.
    // Either identifies the file, which is all that is wanted here.
    const escaped = jobName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`^\\s*name:\\s*["']?${escaped}["']?\\s*$`, 'm').test(yml)) matches.push(file);
  }
  if (matches.length === 0) {
    throw new Error(
      `no workflow declares a job named "${jobName}" — cannot know its cap. ` +
        'Pass the workflow path explicitly rather than measuring against the wrong one.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `"${jobName}" is declared by more than one workflow (${matches.join(', ')}), so its ` +
        'cap is ambiguous. Pass the workflow path explicitly.',
    );
  }
  const workflow = matches[0] as string;
  return { seconds: capSeconds(new URL(workflow, dir)), workflow: `.github/workflows/${workflow}` };
}

/**
 * The name of the script a pnpm `$ <command>` line is about to run.
 *
 * **Two ways this was wrong before it was right**, both worth keeping written
 * down because both produced a confident, wrong, plausible answer:
 *
 * 1. Every step in the chain runs through
 *    `--import ./scripts/ts-extension-resolver-register.mjs`, so taking the
 *    *first* filename in the command line named all 59 steps
 *    `ts-extension-resolver-register` — one answer for everything, this
 *    repo's signature disease.
 * 2. Printing the raw command truncated to a column width cut
 *    `check-climb-wave.mts` to `check-climb-wav`, so a grep for the step
 *    matched nothing and it looked absent from runs it dominated.
 *
 * So: drop the shared loader, take what is left, and keep any leading
 * `VAR=value` prefix, which is the only thing distinguishing the two
 * `check:speech-bubbles` variants from each other.
 */
export function stepName(command: string): string {
  const files = [...command.matchAll(/([\w.-]+)\.(?:mts|mjs|ts|js)\b/g)]
    .map((m) => m[1] as string)
    .filter((name) => name !== 'ts-extension-resolver-register');
  const env = /^([A-Z_]+=\S+\s+)+/.exec(command)?.[0]?.trim();
  const base = files.at(-1) ?? command.slice(0, 60);
  return env ? `${base} [${env}]` : base;
}

/** `93s` → `1m33s`, and negatives keep their sign so headroom can go under. */
export function formatDuration(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  // **Round to whole seconds FIRST, then split.** Flooring the minutes while
  // separately rounding the remainder prints times that do not exist: 1799.6 s
  // came out as `29m60s`, and 59.6 s as `0m60s`. `29m60s` was sitting in this
  // branch's own control transcript, which is a poor look on a mechanism whose
  // entire job is to report a number honestly.
  const total = Math.round(Math.abs(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${sign}${minutes}m${String(rest).padStart(2, '0')}s`;
}
