/**
 * **How each shipped seed's restart was found** — the root acceptance loop's
 * log, per seed, as `acceptanceMetadata` (`acceptedPark.mts`) shapes it:
 * every restart tried, what forced each one, the driver's backtracking inside
 * it, and the source the verdicts were taken against.
 *
 * Written by `pnpm run accept:parks -- <seeds> --write`, beside the restarts
 * themselves (`src/world/acceptedRestarts.ts`), because the loop is the only
 * thing that knows it and re-running the loop is minutes a seed. Read by
 * `build:parks`, which carries a seed's entry in its park file's `acceptance`
 * so a restart is visible in the shipped file, never only in a CI log; and by
 * `check:accepted-restarts`, which proves every entry names the restart that
 * is recorded for its seed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AcceptanceMetadata } from './acceptedPark.mts';

/** Relative to the repository root. Under `procgen/`: build tooling only, never in the bundle. */
export const ACCEPTANCE_LOG_FILE = 'procgen/acceptanceLog.json';

/** Seed (as a string key) → that seed's acceptance. */
export type AcceptanceLog = Readonly<Record<string, AcceptanceMetadata>>;

export function readAcceptanceLog(root: string): AcceptanceLog {
  return JSON.parse(readFileSync(join(root, ACCEPTANCE_LOG_FILE), 'utf8')) as AcceptanceLog;
}

/**
 * Why `entry` cannot stand for seed `seed` accepted at `restart`, or null if it
 * can: it must exist, name that restart, and be a log that ends there — one
 * attempt per restart from 0, only the last accepted.
 */
export function acceptanceLogProblem(entry: AcceptanceMetadata | undefined, seed: number, restart: number): string | null {
  if (!entry) return `seed ${seed} has no acceptance log — run pnpm run accept:parks -- ${seed} --write`;
  if (entry.restart !== restart) {
    return `seed ${seed}'s acceptance log accepted restart ${entry.restart}, but restart ${restart} is recorded — run pnpm run accept:parks -- ${seed} --write`;
  }
  if (entry.attempts !== entry.log.length || entry.log.length !== restart + 1) {
    return `seed ${seed}'s acceptance log has ${entry.log.length} attempt(s) (says ${entry.attempts}) for restart ${restart}`;
  }
  const wrong = entry.log.findIndex((a, i) => a.restart !== i || a.accepted !== (i === restart));
  if (wrong >= 0) return `seed ${seed}'s acceptance log attempt ${wrong} is out of order or wrongly accepted`;
  return null;
}
