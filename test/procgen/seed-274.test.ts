/**
 * **Pool seed 274 — invariant coverage.**
 *
 * One of the ten pool seeds that had no invariant suite until 2 Sep 2026. The
 * suite ran six of the sixteen seeds children actually draw from, and the gap
 * was not theoretical: `noPathEndsNowhere` had been honestly red on the
 * canonical seed for the whole life of the grid rework, and **seed 267 carried
 * the identical defect invisibly** — same orphaned `gate-approach`, same
 * assertion, no test file to say so. A check nobody runs on the park that has
 * the bug is a check that cannot fail.
 *
 * `check:park` cannot close that gap: it owns whether the park *works*, not
 * whether its furniture is placed sanely (`invariants.ts` header, and
 * CLAUDE.md's own split). Ten more park builds is the whole cost.
 */
import { registerParkInvariants } from './invariants.ts';

registerParkInvariants(274);
