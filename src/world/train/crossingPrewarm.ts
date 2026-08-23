import type { SolvedCrossingSites } from './crossingPlanSolve';

/**
 * A one-slot letterbox for crossing sites solved before `crossingPlan.ts`
 * was loaded — the same mechanism, for the same reason, as
 * `train/prewarm.ts`, `coaster/prewarm.ts` and `slide/prewarm.ts`: the
 * solve is a function of the settled layout and rail plan, far too big for
 * one boot frame (~300 ms), and `boot/parkGeneration.ts` spreads it over
 * the cat-bus ride's frames then posts the result here. Take-once, so a
 * stale plan from an earlier seed can never describe a park that no longer
 * exists. Nothing calls the offer in Node: the harness and every check
 * solve straight through.
 */
let waiting: SolvedCrossingSites | null = null;

export function offerPrewarmedCrossingSites(sites: SolvedCrossingSites): void {
  waiting = sites;
}

export function takePrewarmedCrossingSites(): SolvedCrossingSites | null {
  const sites = waiting;
  waiting = null;
  return sites;
}
