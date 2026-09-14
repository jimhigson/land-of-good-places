/**
 * The claims registry's distance kernel, on the sphere.
 *
 * Every assertion here is paired with a **control** that pins the same number
 * by a route sharing no code with the thing under test — a closed form, or the
 * old planar kernel in the one region where the old planar kernel was right.
 * A projection error produces clean, decisive, wrong answers, which is exactly
 * the class of bug that a test agreeing with its own implementation cannot see.
 */
import { describe, expect, it } from 'vitest';
import {
  CLAIM_SURFACE_RADIUS,
  arcBetween,
  arcToRun,
  bearingOf,
  runsCross,
} from '../../src/boot/claimSurface';
import { Vector3 } from 'three';

const R = CLAIM_SURFACE_RADIUS;

/** The planar kernel `groundClaims.ts` used to use, kept here as the control. */
const flatPointSegment = (
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number => {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / lenSq));
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
};

describe('the claim surface is the planet', () => {
  it('puts a bearing on the unit sphere, and at the park origin that is straight up', () => {
    const v = new Vector3();
    bearingOf(0, 0, v);
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.y).toBeCloseTo(1, 12);
    expect(v.z).toBeCloseTo(0, 12);
    // Control: every bearing is a UNIT vector, on a sweep, or every angle
    // derived from one is silently scaled.
    for (const [x, z] of [
      [0, 0],
      [50, 0],
      [0, -120],
      [100, 100],
      [219, 0],
    ] as const) {
      bearingOf(x, z, v);
      expect(v.length()).toBeCloseTo(1, 12);
    }
  });

  it('agrees with plane geometry near the origin, and measurably disagrees far out', () => {
    // Control A — near the origin the cap is tangent, so the new kernel MUST
    // reproduce the old one. If this fails the two are not comparable at all.
    expect(arcBetween(0, 0, 1, 0)).toBeCloseTo(Math.hypot(1, 0), 4);
    expect(arcBetween(3, -2, -1, 4)).toBeCloseTo(Math.hypot(4, 6), 3);

    // Control B — the instrument must be CAPABLE of reporting a difference.
    // A test that only ever samples near the origin would pass on a kernel that
    // had never been changed at all.
    const flat = Math.hypot(1, 0);
    const far = arcBetween(150, 0, 151, 0);
    expect(far).toBeGreaterThan(flat * 1.3);

    // Control C — that far number, from an independent closed form. A radial
    // pair's true separation is R·Δasin, which shares no code with `arcBetween`.
    expect(far).toBeCloseTo(R * (Math.asin(151 / R) - Math.asin(150 / R)), 9);
  });

  it('is exactly symmetric, and zero only for a point against itself', () => {
    expect(arcBetween(30, -70, -110, 20)).toBeCloseTo(arcBetween(-110, 20, 30, -70), 12);
    expect(arcBetween(42, 42, 42, 42)).toBe(0);
  });
});

describe('distance to a geodesic run', () => {
  it('reads zero on the run itself, at both ends and in the middle', () => {
    expect(arcToRun(0, 0, 0, 0, 100, 0)).toBeCloseTo(0, 9);
    expect(arcToRun(100, 0, 0, 0, 100, 0)).toBeCloseTo(0, 9);
    // A midpoint of the GEODESIC, not of the chart: on a cap the two differ, so
    // this is built by walking the bearing rather than by averaging (x, z).
    const a = new Vector3();
    const b = new Vector3();
    bearingOf(0, 0, a);
    bearingOf(100, 0, b);
    const mid = a.clone().add(b).normalize().multiplyScalar(R);
    // Back to world (x, z): the cap's bearing carries x and z directly.
    expect(arcToRun(mid.x, mid.z, 0, 0, 100, 0)).toBeCloseTo(0, 6);
  });

  it('agrees with the planar kernel near the origin', () => {
    // Control: the region where the old code was right. Perpendicular offset
    // from a short run through the park's middle.
    for (const off of [0.5, 1, 2, 3]) {
      expect(arcToRun(5, off, 0, 0, 10, 0)).toBeCloseTo(
        flatPointSegment(5, off, 0, 0, 10, 0),
        3,
      );
    }
  });

  it('clamps to the endpoint rather than measuring to the whole great circle', () => {
    // A short run near the origin; the query point is far PAST its end, and
    // almost exactly on the run's own great circle. Cross-track is ~0 there;
    // the honest answer is the distance to the nearer END.
    const d = arcToRun(80, 0, 0, 0, 10, 0);
    const toEnd = arcBetween(80, 0, 10, 0);
    expect(d).toBeCloseTo(toEnd, 9);

    // Control: without the clamp this would be ~0, so the assertion above is
    // capable of catching its absence. State the number it would have been.
    expect(d).toBeGreaterThan(50);
  });

  it('never reports a point as further than its nearest endpoint', () => {
    // A property, swept: the clamp can only ever make the answer smaller than
    // going round by an end, never larger. This is what a wrong `withinSpan`
    // breaks, and it is cheap to sweep.
    for (let i = 0; i < 400; i += 1) {
      const ang = (i / 400) * Math.PI * 2;
      const px = Math.cos(ang) * (20 + (i % 7) * 15);
      const pz = Math.sin(ang) * (20 + (i % 7) * 15);
      const d = arcToRun(px, pz, -60, -30, 70, 45);
      const ends = Math.min(arcBetween(px, pz, -60, -30), arcBetween(px, pz, 70, 45));
      expect(d).toBeLessThanOrEqual(ends + 1e-9);
    }
  });

  it('is a lower bound POINT to POINT — the projection can only shorten', () => {
    let worst = 1;
    for (let i = 0; i < 2000; i += 1) {
      const ang = (i / 2000) * Math.PI * 2;
      const r = 5 + ((i * 37) % 200);
      const px = Math.cos(ang) * r;
      const pz = Math.sin(ang) * r;
      const arc = arcBetween(px, pz, -80, -40);
      const flat = Math.hypot(px + 80, pz + 40);
      expect(arc).toBeGreaterThanOrEqual(flat - 1e-9);
      if (flat > 1) worst = Math.max(worst, arc / flat);
    }
    // The sweep must have found a real disagreement, or it proved a bound over
    // a set where the two happen to be equal.
    expect(worst).toBeGreaterThan(1.2);
    process.stderr.write(
      `[claim surface] point-to-point: arc/flat worst ${worst.toFixed(3)}x, never below 1\n`,
    );
  });

  it('is NOT a lower bound point-to-RUN, and the broad phase must pay for that', () => {
    // **This test was written asserting the opposite, and it failed.** The
    // docblock in claimSurface.ts claimed the flat kernel was always a lower
    // bound, so the registry's cheap axis-box prefilter could stay exactly as
    // it was. That is true point-to-point — a projection can only shorten — and
    // it is FALSE point-to-run, because the flat straight segment and the
    // geodesic arc are different curves. A great circle projects
    // orthographically to an ellipse, not to the chord between its endpoints,
    // so a point can sit nearer the chart's straight line than it does to the
    // real run on the ground.
    //
    // It matters, and it is not a rounding detail: if the true distance can be
    // SMALLER than the flat one, a box prefilter built from flat coordinates
    // can dismiss a pair that genuinely shares ground — a refusal that never
    // happens, two solid things in one place, and a child walking through the
    // furniture. So the number is measured here and the prefilter is widened by
    // it, rather than the property being assumed.
    let worstShortfall = 0;
    let worstRatio = 1;
    let samples = 0;
    const runs: readonly (readonly [number, number, number, number])[] = [
      [-80, -40, 90, 60],
      [-150, 0, 150, 0],
      [0, -140, 0, 140],
      [-120, 100, 130, -90],
      [20, 20, 160, 40],
    ];
    for (const [x1, z1, x2, z2] of runs) {
      for (let i = 0; i < 1500; i += 1) {
        const ang = (i / 1500) * Math.PI * 2;
        const r = 2 + ((i * 37) % 205);
        const px = Math.cos(ang) * r;
        const pz = Math.sin(ang) * r;
        const arc = arcToRun(px, pz, x1, z1, x2, z2);
        const flat = flatPointSegment(px, pz, x1, z1, x2, z2);
        worstShortfall = Math.max(worstShortfall, flat - arc);
        if (flat > 1) {
          worstRatio = Math.max(worstRatio, flat / arc);
          samples += 1;
        }
      }
    }
    expect(samples).toBeGreaterThan(5000);
    // The shortfall is real and it is metres, not millimetres.
    expect(worstShortfall).toBeGreaterThan(0.1);
    process.stderr.write(
      `[claim surface] point-to-run: the flat kernel OVER-reads by up to ` +
        `${worstShortfall.toFixed(3)} m (ratio ${worstRatio.toFixed(3)}x) over ${samples} samples ` +
        `on ${runs.length} runs — so a flat broad phase is NOT conservative and is widened ` +
        `by CLAIM_BROAD_PHASE_SLACK.\n`,
    );
  });
});

describe('two geodesic runs crossing', () => {
  it('sees a plain X', () => {
    expect(runsCross(-50, 0, 50, 0, 0, -50, 0, 50)).toBe(true);
  });

  it('refuses two runs that do not reach each other', () => {
    // Control: the same two bearings, pulled apart so they no longer meet. If
    // this said true, the X above would prove nothing.
    expect(runsCross(-50, 0, -10, 0, 0, -50, 0, 50)).toBe(false);
    expect(runsCross(-50, 20, 50, 20, -50, -20, 50, -20)).toBe(false);
  });

  it('refuses a T that stops short, and accepts one that reaches', () => {
    expect(runsCross(-40, 0, 40, 0, 0, 10, 0, 60)).toBe(false);
    expect(runsCross(-40, 0, 40, 0, 0, -10, 0, 60)).toBe(true);
  });

  it('does not report a run crossing itself, nor a colinear run-along', () => {
    expect(runsCross(-30, 0, 30, 0, -30, 0, 30, 0)).toBe(false);
    // Colinear overlap is a run-along, not a crossing — the distance kernel
    // reports it as zero separation, which is the honest description.
    expect(runsCross(-30, 0, 30, 0, 0, 0, 60, 0)).toBe(false);
  });

  it('still sees a crossing out where the chart is most distorted', () => {
    // The whole point: a crossing 150 m out, where the flat chart is 37% wrong,
    // must still be found.
    expect(runsCross(120, -40, 180, 40, 120, 40, 180, -40)).toBe(true);
    expect(runsCross(120, -40, 140, -20, 120, 40, 180, -40)).toBe(false);
  });
});
