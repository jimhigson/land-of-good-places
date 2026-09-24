import { Rng, TAU } from '../../src/core/mathUtils';
import type { ParkBoundaryOptions } from '../../src/world/boundary';
import { installBoundarySolver } from '../../src/world/prebuilt/solverPort';
import { recordBuilt } from './builtLog';
import { GENTLE_CURVATURE_RADIUS, PROFILE_SAMPLES, minCurvatureRadius } from '../../src/world/boundaryProfile';
/**
 * **The park boundary's search** — rerolls a seeded outline until it is gentle
 * enough, keeping the gentlest. Moved verbatim from `src/world/boundary.ts`,
 * which builds the boundary from the radii the park file records. Build-time
 * only. Imports no park module at runtime, so the Node solver loader can load
 * it at the moment the boundary is first asked about, even mid-import.
 */

// ------------------------------------------------------------- the generator

/**
 * Harmonics the park's outline is built from.
 *
 * Only 2 through 5. One (`k = 1`) is not a shape at all — it just slides the
 * whole park off the origin — and anything above 5 puts more than five lobes
 * round the edge, which stops reading as a park and starts reading as a flower.
 * Low harmonics are also what *makes* the curve gentle: the tightest possible
 * curvature scales with `k` squared, so keeping `k` small is the same act as
 * keeping the spline smooth.
 */
const HARMONICS = [2, 3, 4, 5] as const;


/**
 * How much of the mean radius the wiggle may claim, before the area and gate
 * constraints are solved.
 *
 * These are the numbers that decide how *different* two seeds' parks look, and
 * the family's ruling (5 Aug 2026) is that every park should be unique — so
 * this is deliberately pushed until the curvature floor is what stops it, not
 * timidity. Amplitudes are re-rolled and shrunk if the result would be too
 * sharp; see {@link generateParkBoundary}.
 */
const WIGGLE_MIN = 0.1;

const WIGGLE_MAX = 0.32;


/**
 * How many candidate outlines to try before taking the best one.
 *
 * This number is load-bearing and was measured, not guessed. Taking the *first*
 * candidate that cleared a gentleness floor produced no park at all: every seed
 * exhausted its attempts and silently fell back to a circle, which is the
 * "every park is the same park" failure the family's uniqueness ruling exists
 * to prevent. Searching properly and keeping the best fixes it, and the budget
 * is what decides whether it works:
 *
 * | tries | best curvature radius found, across the five test seeds |
 * |---|---|
 * | 200 | 18.2 - 37.4 m (three seeds too sharp) |
 * | 2000 | 30.1 - 37.4 m (every seed comfortable) |
 *
 * Which is the family's ruling on ride generation applied here (5 Aug 2026):
 * keep trying, and only bail after a very large number of tries.
 */
const ATTEMPTS = 2000;


export function solveBoundaryRadii(options: ParkBoundaryOptions): number[] {
  const { seed, targetArea, gateBearing, gateRadius } = options;
  const rng = new Rng(seed);
  const areaOverPi = targetArea / Math.PI;

  let best: { radii: number[]; curvature: number } | null = null;

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const amplitudes = HARMONICS.map(() => rng.range(WIGGLE_MIN, WIGGLE_MAX));
    const phases = HARMONICS.map(() => rng.range(0, TAU));

    const u = (angle: number): number => {
      let total = 0;
      for (let h = 0; h < HARMONICS.length; h += 1) {
        total += (amplitudes[h] as number) * Math.cos((HARMONICS[h] as number) * angle + (phases[h] as number));
      }
      return total;
    };

    const q = amplitudes.reduce((sum, a) => sum + a * a, 0);
    const gateU = u(gateBearing);

    // (gateU^2 + q/2) B^2 - 2 gateRadius gateU B + (gateRadius^2 - areaOverPi) = 0
    const qa = gateU * gateU + q / 2;
    const qb = -2 * gateRadius * gateU;
    const qc = gateRadius * gateRadius - areaOverPi;
    if (Math.abs(qa) < 1e-9) continue;
    const discriminant = qb * qb - 4 * qa * qc;
    if (discriminant < 0) continue;
    const root = Math.sqrt(discriminant);
    // The `+` root is the one that grows the park outward from the gate.
    const b = (-qb + root) / (2 * qa);
    const a = gateRadius - b * gateU;
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0) continue;

    const radii: number[] = [];
    let smallest = Infinity;
    for (let i = 0; i < PROFILE_SAMPLES; i += 1) {
      const angle = (i / PROFILE_SAMPLES) * TAU;
      const r = a + b * u(angle);
      if (r < smallest) smallest = r;
      radii.push(r);
    }
    // A profile that dips to nothing is not a park.
    if (smallest < gateRadius * 0.5) continue;

    // Keep the gentlest candidate rather than the first acceptable one. See
    // ATTEMPTS: first-acceptable found nothing at all and fell back to a
    // circle on every seed.
    const curvature = minCurvatureRadius(radii);
    if (!best || curvature > best.curvature) best = { radii, curvature };
  }

  // No silent fallback to a circle. A boundary that cannot be generated is a
  // broken park, and quietly handing back a circle would turn that into "every
  // seed produced the same park" — which is exactly how this went wrong the
  // first time, and it took a spread-of-radii probe to notice. The seed is
  // committed and CI builds five of them, so this failing is a build-time
  // failure, which is where it belongs.
  if (!best || best.curvature < GENTLE_CURVATURE_RADIUS) {
    throw new Error(
      `generateParkBoundary: no gentle outline for seed ${seed} after ${ATTEMPTS} tries ` +
        `(best curvature radius ${best ? best.curvature.toFixed(1) : 'none'} m, ` +
        `floor ${GENTLE_CURVATURE_RADIUS} m). Target area ${targetArea.toFixed(0)} m2 ` +
        `with the gate pinned at ${gateRadius} m may be geometrically impossible.`,
    );
  }
  return best.radii;
}

// Installed on import: this module is what the Node loader requires the first
// time the park's edge is asked about (`scripts/ts-extension-resolver-register.mjs`).
installBoundarySolver((options) => recordBuilt('boundary', solveBoundaryRadii(options)));
