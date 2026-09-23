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

/** One job in a workflow file, as far as the cap and the job's name go. */
export interface WorkflowJob {
  /** The key under `jobs:` — `shards`, `build`, `check`. */
  readonly id: string;
  /** Its `name:`, verbatim, which may carry a `${{ matrix.x }}` template. */
  readonly name: string | null;
  readonly timeoutMinutes: number | null;
}

/**
 * **The jobs in a workflow, read by indentation rather than by a YAML parser.**
 *
 * Only two keys are wanted from each job, and both sit at a fixed depth in
 * every workflow this repo has: a job id two spaces in under `jobs:`, and its
 * `name:` / `timeout-minutes:` four spaces in. Comments are dropped first,
 * because the workflows mention `timeout-minutes` in prose.
 *
 * Why this exists at all: `checks.yml` used to be one job, so "the first
 * `timeout-minutes:` in the file" *was* the cap. Since the chain was split
 * into shards (#693's PR) the file has three jobs with three different caps,
 * and "the first one" would silently become whichever the file happened to
 * list first — a watchdog timed against the aggregator's 5 minutes, say.
 */
export function workflowJobs(yml: string): WorkflowJob[] {
  const lines = yml.split('\n').filter((line) => !/^\s*#/.test(line));
  const jobs: { id: string; name: string | null; timeoutMinutes: number | null }[] = [];
  let inJobs = false;
  for (const line of lines) {
    if (/^\S/.test(line)) {
      inJobs = /^jobs:\s*$/.test(line);
      continue;
    }
    if (!inJobs) continue;
    const id = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (id) {
      jobs.push({ id: id[1]!, name: null, timeoutMinutes: null });
      continue;
    }
    const job = jobs.at(-1);
    if (!job) continue;
    const name = /^ {4}name:\s*(.+?)\s*$/.exec(line);
    if (name) job.name = name[1]!.replace(/^["']|["']$/g, '');
    const timeout = /^ {4}timeout-minutes:\s*(\d+)\s*$/.exec(line);
    if (timeout) job.timeoutMinutes = Number(timeout[1]);
  }
  return jobs;
}

/**
 * A workflow job's own `timeout-minutes`, in seconds.
 *
 * Deliberately strict: if the cap cannot be found **unambiguously**, throw
 * rather than fall back to a default. A watchdog that silently assumes 30
 * minutes when the real cap has become 20 is worse than no watchdog, because
 * it reports a margin that does not exist.
 *
 * - With `jobId`, that job's cap; throws if the job is absent or has none.
 * - Without, the file's only cap; throws if more than one job declares one.
 */
export function capSeconds(
  workflow: URL = new URL('../.github/workflows/checks.yml', import.meta.url),
  jobId?: string,
): number {
  const jobs = workflowJobs(readFileSync(workflow, 'utf8'));
  const where = fileURLToPath(workflow).replace(/^.*\/\.github\//, '.github/');
  if (jobId !== undefined) {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) {
      throw new Error(`${where} has no job \`${jobId}\` (jobs: ${jobs.map((j) => j.id).join(', ') || 'none'})`);
    }
    if (job.timeoutMinutes === null) {
      throw new Error(
        `${where}'s job \`${jobId}\` has no \`timeout-minutes:\` — the watchdog cannot know the cap. ` +
          'Give the job one rather than hard-coding a number here.',
      );
    }
    return job.timeoutMinutes * 60;
  }
  const capped = jobs.filter((j) => j.timeoutMinutes !== null);
  if (capped.length !== 1) {
    throw new Error(
      `${where} has ${capped.length} jobs with a \`timeout-minutes:\` ` +
        `(${capped.map((j) => `${j.id}=${j.timeoutMinutes}`).join(', ') || 'none'}), so "its cap" is ` +
        'ambiguous. Name the job (check-watchdog.mts --job <id>) rather than taking the first one.',
    );
  }
  return capped[0]!.timeoutMinutes! * 60;
}

/** A job `name:` as a matcher: `Checks shard ${{ matrix.shard }}` matches `Checks shard 3`. */
const nameMatcher = (name: string): RegExp => {
  const parts = name.split(/\$\{\{[^}]*\}\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^${parts.join('.+?')}$`);
};

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
 * already load-bearing and already unique. A matrix job's templated name
 * (`Checks shard ${{ matrix.shard }}`) matches every instance of it.
 *
 * Ambiguity and absence both **throw**. Falling back to a default cap is the
 * behaviour that produced the bug.
 */
export function capSecondsForJob(jobName: string, dir = new URL('../.github/workflows/', import.meta.url)): {
  seconds: number;
  workflow: string;
} {
  const root = fileURLToPath(dir);
  const matches: { file: string; job: WorkflowJob }[] = [];
  for (const file of readdirSync(root)) {
    if (!/\.ya?ml$/.test(file)) continue;
    for (const job of workflowJobs(readFileSync(root + file, 'utf8'))) {
      if (job.name !== null && nameMatcher(job.name).test(jobName)) matches.push({ file, job });
    }
  }
  if (matches.length === 0) {
    throw new Error(
      `no workflow declares a job named "${jobName}" — cannot know its cap. ` +
        'Pass the workflow path explicitly rather than measuring against the wrong one.',
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `"${jobName}" matches more than one job (${matches.map((m) => `${m.file}:${m.job.id}`).join(', ')}), so its ` +
        'cap is ambiguous. Pass the workflow path explicitly.',
    );
  }
  const { file, job } = matches[0]!;
  return { seconds: capSeconds(new URL(file, dir), job.id), workflow: `.github/workflows/${file} (job ${job.id})` };
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
