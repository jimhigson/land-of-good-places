import type { SolvedRailRoute } from '../rail/generate';

/**
 * **A one-slot letterbox for a train loop solved before `train/plan.ts` was
 * loaded.**
 *
 * The same mechanism as `coaster/prewarm.ts` and `slide/prewarm.ts`, for the
 * same reason and deliberately not a second design — see those files for the
 * full argument. What differs is only which solve it covers.
 *
 * ### Why the train needed one (11 August 2026)
 *
 * The train's route used to be a bespoke radius-per-bearing profile that solved
 * in ~41 ms — small enough that `ParkGeneration` could let it run inside its own
 * module-import frame and never sub-slice it. Switching the train to the generic
 * `rail/generate.ts` solver (so it respects a turning circle and never runs
 * through a stall) put its solve at ~1.1 s, the same category as the Sky
 * Cruiser's: far too much for one frame. `check:park-boot`'s event-loop lag timer
 * sees exactly that kind of import-time block, so the solve is now spread over the
 * cat-bus ride's frames — driven a joint at a time by `boot/parkGeneration.ts`'s
 * slice scheduler and handed here.
 *
 * ### Why it is take-once
 *
 * {@link takePrewarmedTrain} clears the slot as it reads it, so a loop can never
 * be served twice. A stale loop is the dangerous failure: it is a function of
 * `PARK_SEED`, and a leftover from an earlier seed would put the whole railway,
 * its stations and every path spur to them over a park that no longer exists —
 * silently, and only on the second park built in one process.
 *
 * Nothing calls {@link offerPrewarmedTrain} in Node: the harness, `check:park`
 * and `test:procgen` never pre-warm, so `TRAIN_PLAN` solves straight through
 * exactly as it always has and CI is untouched.
 */
let waiting: SolvedRailRoute | null = null;

/**
 * Hands over a train loop solved elsewhere. The next `train/plan.ts` load takes
 * it. Must be called **before** anything imports `train/plan.ts` directly or
 * transitively — after that `TRAIN_PLAN` has already solved the slow way and this
 * would be ignored. `boot/parkGeneration.ts` sequences that, and is the only
 * caller.
 */
export function offerPrewarmedTrain(route: SolvedRailRoute): void {
  waiting = route;
}

/** Takes the waiting loop, if there is one, emptying the slot. */
export function takePrewarmedTrain(): SolvedRailRoute | null {
  const route = waiting;
  waiting = null;
  return route;
}
