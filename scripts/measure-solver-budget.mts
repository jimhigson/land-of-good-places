import { PARK_SEED } from '../src/world/parkManifest';
import { circleBoundary } from '../src/world/rail/boundary';
import { RailRouteUnsolvable, solveRailRoute, ringStartPoses } from '../src/world/rail/generate';
import { turnVocabulary } from '../src/world/rail/segments';

/**
 * **What giving up costs**, so the bail threshold can be chosen rather than
 * guessed (Jim's 5 August ruling: keep trying, only bail after a very large
 * number of attempts).
 *
 * A successful solve stops early, so raising the cap costs nothing on a park
 * that works — the whole cost lands on a park that does not. That is the number
 * worth knowing, because a park that bails is bad but a park that takes two
 * minutes to load is worse, and a six-year-old is the one waiting.
 *
 * The pathological brief below is deliberately *nearly* plausible rather than
 * absurd: a loop of the Sky Cruiser's length and turning radius asked to close
 * inside a boundary far too small for it. Every piece is individually legal, so
 * the search does real work — grows, backtracks, exhausts a start pose, moves
 * to the next — instead of dying instantly the way an impossible piece would.
 */

const vocabulary = turnVocabulary(
  [
    { name: 'tight', minRadius: 13, maxRadius: 18, minLength: 16, maxLength: 28 },
    { name: 'sweep', minRadius: 18, maxRadius: 32, minLength: 22, maxLength: 38 },
    { name: 'easy', minRadius: 32, maxRadius: 60, minLength: 26, maxLength: 46 },
  ],
  { minLength: 22, maxLength: 40 },
);

for (const restarts of [200, 1000, 5000]) {
  const started = Date.now();
  let report = '';
  try {
    solveRailRoute({
      seed: PARK_SEED ^ 0x5a17,
      vocabulary,
      desiredLength: 220,
      closed: true,
      // Plenty of places to start from, so `restarts` is the binding cap.
      startPoses: ringStartPoses(0, 0, 12, 6000, true),
      clear: () => true,
      // Far too small a ring for a 220 m loop that may not come within 5 m of
      // itself: legal pieces the whole way, and no way to close.
      boundary: circleBoundary(18),
      corridorRadius: 3,
      selfClearance: 5,
      minRadius: 13,
      budgets: { perJoint: 16, restarts },
    });
    report = 'unexpectedly SOLVED';
  } catch (error) {
    if (!(error instanceof RailRouteUnsolvable)) throw error;
    const r = error.report;
    report =
      `gave up after ${r.restarts} attempts, ${r.candidatesTried} candidate pieces, ` +
      `${r.backtracks} backtracks`;
  }
  console.log(`restarts=${restarts}: ${Date.now() - started} ms — ${report}`);
}

// And how many start poses the real cruiser is actually offered, which is the
// number `restarts` has to clear to search all of them.
const { COASTER_PLANS } = await import('../src/world/coaster/plan');
const solved = COASTER_PLANS.cruiser.route.plan.report;
console.log(
  `real cruiser: ${solved.startPoseCount} start poses offered, took index ` +
    `${solved.startPoseIndex}, ${solved.candidatesTried} candidates, ${solved.elapsedMs} ms`,
);
