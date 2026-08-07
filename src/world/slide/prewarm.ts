import type { PlannedSlide } from './solve';

/**
 * **A one-slot letterbox for a slide solved before `slide/plan.ts` was loaded.**
 *
 * `SLIDE_PLAN` solves at module scope and takes ~3.5 s — 86% of the whole boot.
 * The cat-bus ride exists to cover that, which means solving the slide *during*
 * the ride and having the module pick the answer up when it finally loads.
 * This is the handover point, and it is deliberately the smallest thing that
 * could be.
 *
 * ### Why it is a module of its own
 *
 * It has to be reachable from **both** sides without either side dragging in
 * the other's cost:
 *
 * - the pre-warmer runs before anything park-shaped is imported;
 * - `slide/plan.ts` reads it in its own module initialiser.
 *
 * The only import here is `import type`, which TypeScript erases entirely, so
 * there is **no runtime edge from this file to `solve.ts`** and no import cycle
 * to reason about. A value module in the middle would put one there.
 *
 * ### Why it is take-once
 *
 * {@link takePrewarmedSlide} clears the slot as it reads it, so a plan can
 * never be served twice. A stale plan is the dangerous failure here: the slide
 * is a function of `PARK_SEED`, and a leftover from an earlier seed would build
 * a park whose castle doorway and ball-pit landing disagree with its own chute
 * — silently, and only on the second park built in one process. Emptying the
 * slot on read means the second read solves honestly instead.
 *
 * Nothing calls {@link offerPrewarmedSlide} in Node: the harness, `check:park`
 * and `test:procgen` never pre-warm, so `SLIDE_PLAN` solves straight through
 * exactly as it always has and CI is untouched.
 */
let waiting: PlannedSlide | null = null;

/**
 * Hands over a slide solved elsewhere. The next `slide/plan.ts` load takes it.
 *
 * Must be called **before** anything imports `slide/plan.ts`, directly or
 * transitively — after that the const has already been initialised the slow way
 * and this would be ignored. `boot/parkBoot.ts` is what sequences that, and it
 * is the only caller.
 */
export function offerPrewarmedSlide(plan: PlannedSlide): void {
  waiting = plan;
}

/** Takes the waiting plan, if there is one, emptying the slot. */
export function takePrewarmedSlide(): PlannedSlide | null {
  const plan = waiting;
  waiting = null;
  return plan;
}
