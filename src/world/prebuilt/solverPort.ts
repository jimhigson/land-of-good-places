import type { GroundClaims } from '../../boot/groundClaims';

/**
 * **The one port through which build tooling plugs a park solver into the
 * game** (`docs/design/PREBUILT-PARKS.md`).
 *
 * Jim, 24 September 2026: *"there should be no ability to build built into the
 * game as delivered."* The searches and the backtracking driver live in
 * `procgen/`, which nothing in `src/` may import (`check:procgen-boundary`).
 * The game reads a park's decisions from its prebuilt file; the only other way
 * a park can be decided is a solver installed here, and only Node tooling
 * installs one — `scripts/ts-extension-resolver-register.mjs` for scripts,
 * `procgen/install.ts` for tests. The shipped client never does, so when it has
 * no park file the answer is `ParkUnavailable`, never a search.
 */

/** One run of the plan search, as the park sees it. */
export interface PlanSolverRun {
  /** Drive the search to the end, a turn per step. */
  run(): Generator<number, void, void>;
  /** The registry the builders committed into. */
  readonly claims: GroundClaims;
  /** The features placed so far, in ledger order. */
  readonly placedFeatures: readonly string[];
}

/** What a solver can do for a park that has no park file. */
export interface ParkSolver {
  /** A fresh plan search for `PARK_SEED`, decisions written through `parkPlan.ts`'s setters. */
  plan(): PlanSolverRun;
}

// `var`: read during module cycles, like `parkPlan.ts`'s state.
/* eslint-disable no-var */
var installed: ParkSolver | null = null;
var loader: (() => void) | null = null;
/* eslint-enable no-var */

/** Install the solver. Node tooling only. */
export function installParkSolver(solver: ParkSolver): void {
  installed = solver;
}

/**
 * Register a way to install the solver on first need — so a script that never
 * builds a park never loads it, and one that sets its seed in-process first
 * still loads it against that seed.
 */
export function setParkSolverLoader(load: () => void): void {
  loader = load;
}

/** The installed solver, loading it if a loader was registered; null in the game as delivered. */
export function parkSolver(): ParkSolver | null {
  if (!installed && loader) {
    const load = loader;
    loader = null;
    load();
  }
  return installed ?? null;
}
