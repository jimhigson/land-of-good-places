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

import { readFileSync } from 'node:fs';

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
  const s = Math.abs(seconds);
  return `${sign}${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
}
