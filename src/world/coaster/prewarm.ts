import type { PlannedCoaster } from './solve';

/**
 * **A one-slot letterbox for a Sky Cruiser solved before `coaster/plan.ts` was
 * loaded.**
 *
 * The same mechanism as `slide/prewarm.ts`, for the same reason, and
 * deliberately not a second design — see that file for the full argument. What
 * differs is only which solve it covers and how that solve came to be the
 * expensive one.
 *
 * ### Why the cruiser needed one too
 *
 * `COASTER_PLANS` solves at module scope and costs **~0.8 s** on the canonical
 * seed (~1.3 s when this letterbox was built; the 8 Aug 2026 hot-path pass cut
 * it, and `scripts/check-solve-cost.mts` owns the current measurement — still
 * far too much for one frame). That was invisible for a long time because of a
 * billing accident:
 * `train/plan.ts` imports `COASTER_PLANS`, and `ParkGeneration`'s ordered module
 * list loaded `train/plan` **first**, so the cruiser's entire solve was charged
 * to the train's frame. Measured in that order the train read 1439.6 ms and the
 * cruiser 0.3 ms — and issue #252 duly went after the train. Measured by
 * importing each dependency first, the split is cruiser ~1264 ms against the
 * train's own ~157 ms.
 *
 * Slicing the train could not have fixed it, and that was tested rather than
 * argued: with the train fix of PR #253 cherry-picked on, `check:park-boot`'s
 * worst block went 1354 ms to 1300 ms against a 250 ms ceiling — still red, with
 * ~1288 ms of cruiser left underneath. This is the solve that had to be spread.
 *
 * ### Why it is a module of its own
 *
 * Reachable from both sides without either dragging in the other's cost: the
 * pre-warmer runs before anything park-shaped is imported, and `coaster/plan.ts`
 * reads it in its own module initialiser. The only import here is `import type`,
 * which TypeScript erases, so there is **no runtime edge from this file to
 * `solve.ts`** and no import cycle to reason about.
 *
 * ### Why it is take-once
 *
 * {@link takePrewarmedCruiser} clears the slot as it reads it, so a plan can
 * never be served twice. A stale plan is the dangerous failure: the loop is a
 * function of `PARK_SEED`, and a leftover from an earlier seed would put the
 * castle's window, the train's low corridor and the slide's air over a route the
 * park no longer has — silently, and only on the second park built in one
 * process.
 *
 * Nothing calls {@link offerPrewarmedCruiser} in Node: the harness, `check:park`
 * and `test:procgen` never pre-warm, so `COASTER_PLANS` solves straight through
 * exactly as it always has and CI is untouched.
 */
let waiting: PlannedCoaster | null = null;

/**
 * Hands over a cruiser solved elsewhere. The next `coaster/plan.ts` load takes
 * it.
 *
 * Must be called **before** anything imports `coaster/plan.ts`, directly or
 * transitively — after that the const has already been initialised the slow way
 * and this would be ignored. That "transitively" is doing more work here than it
 * does for the slide: `train/plan.ts`, `railRace/plan.ts`, `slide/solve.ts`,
 * `paths.ts`, `Scenery.ts` and `World.ts` all reach `COASTER_PLANS`, so the
 * cruiser has to be solved before the *first* of them. `boot/parkGeneration.ts`
 * is what sequences that, and it is the only caller.
 */
export function offerPrewarmedCruiser(plan: PlannedCoaster): void {
  waiting = plan;
}

/** Takes the waiting plan, if there is one, emptying the slot. */
export function takePrewarmedCruiser(): PlannedCoaster | null {
  const plan = waiting;
  waiting = null;
  return plan;
}
