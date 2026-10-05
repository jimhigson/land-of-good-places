/**
 * Does the **built** Sky Cruiser curve honour the turning radius its plan
 * promised?
 *
 * The plan is a chain of cubics whose radii the generator validates directly.
 * `CoasterRoute` then resamples that plan into control points and rebuilds it
 * as a `CatmullRomCurve3` — and a rebuild is not a copy. The spline through
 * sampled points is not the curve the points were sampled from, and what it
 * loses it loses at the tightest bends, which are exactly the ones under a
 * limit.
 *
 * That is the same shape of mistake this generator replaced: the old solver
 * pushed its control points clear of the castle and then smoothed them, so the
 * built curve did not respect what had been validated. Validating the plan and
 * shipping the rebuild is that bug one layer down.
 *
 * So this measures the thing riders are actually on. Menger curvature over
 * three points at a fixed arc spacing, horizontal only — turning radius is a
 * plan-view notion and the hills do not change it.
 */
import { cruiserTurnRadius } from './lib/rideFindings.mts';

// The measurement is `lib/rideFindings.mts`'s, one owner with the acceptance loop.
const { built, at, planned, limit, complaints } = await cruiserTurnRadius();
console.log(
  `check:cruiser-turn-radius: plan ${planned.toFixed(2)} m, built ${built.toFixed(2)} m ` +
    `at ${at.toFixed(0)} m along, limit ${limit} m — ${complaints.length === 0 ? 'holds' : 'FAILS'} ` +
    `(rebuild cost ${(planned - built).toFixed(2)} m)`,
);
for (const complaint of complaints) console.error(`check:cruiser-turn-radius: ${complaint}`);
if (complaints.length > 0) process.exitCode = 1;
