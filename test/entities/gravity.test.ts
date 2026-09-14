import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GROUND_SPHERE_RADIUS } from '../../src/core/constants';
import {
  altitudeAbove,
  chartStep,
  landingCorrection,
  liftAlongUp,
  realStep,
} from '../../src/entities/movement/gravity';
import { SPACE_GARDEN, spaceAt } from '../../src/world/spaces';
import { terrainHeight } from '../../src/world/terrain';

/**
 * **The arithmetic of leaving the ground, on its own.**
 *
 * `check:radial-hop` and `check:walk-metric` drive `SimPlayer` over the real
 * terrain and measure what a child does. These are the layer under that: the
 * four functions by themselves, at the origin (where every form of this agrees
 * and any disagreement is the instrument), out where the park actually leans,
 * and **indoors**, which neither of those checks reaches at all.
 *
 * The indoor branch is the one worth having here. A room is real coordinates
 * hundreds of metres from the park's origin, where a radius is ~600 m and has
 * nothing to do with a 3 m ceiling. Get the branch wrong and a child walks into
 * the hotel to find the lobby on its side — and no outdoor measurement would
 * ever say so.
 */

/** A point out in the garden where the lean is worst the park ever gets. */
const RIM_X = 157;
/**
 * `sin θ = d / R` on a **bare** cap, by construction — the flat-cap ideal.
 *
 * Good to about 5e-4 of the real ground and no better, because `groundWaves`
 * moves the surface: at the rim the real `cos θ` is 0.700984 against the bare
 * cap's 0.700516. That is fine for the clauses that want "about sin θ" and not
 * fine for the ones asserting to six places, which use {@link cosAtGround}.
 */
const rimSin = RIM_X / GROUND_SPHERE_RADIUS;

/**
 * `cos θ` at the **real** ground under `(x, z)` — the lean of the surface a
 * child actually stands on, waves and all.
 *
 * Reached by a different route from the code under test: this is one `hypot`
 * scaled, and `altitudeAbove` is the difference of two. They agree only if the
 * ground really is a sphere centred at `(0, -R, 0)`, which is the claim being
 * checked. It is not a fully independent oracle — both read `terrainHeight` —
 * but it cannot be satisfied by an `altitudeAbove` that has the conversion
 * inverted or missing, which is what these clauses are for.
 */
function cosAtGround(x: number, z: number): number {
  const h = terrainHeight(x, z) + GROUND_SPHERE_RADIUS;
  return h / Math.hypot(x, h, z);
}
const rimCos = cosAtGround(RIM_X, 0);

const v = new Vector3();

describe('altitudeAbove', () => {
  it('is a plain height difference at the park origin — the control', () => {
    const ground = terrainHeight(0, 0);
    expect(altitudeAbove(0, ground + 2, 0, ground)).toBeCloseTo(2, 9);
  });

  it('reads a small height as cos θ of its y difference, out where the ground leans', () => {
    const ground = terrainHeight(RIM_X, 0);
    // **Asked over 1 cm, deliberately.** `altitudeAbove` is an exact difference
    // of two radii; `y · cos θ` is its *first-order* form, and the two part
    // company by the second-order term `x² / r³ · y² / 2` as `y` grows. Over
    // 2 m at the rim that is 0.0046 m, which is bigger than the precision worth
    // asserting at and would make this clause a statement about how good a
    // linearisation is rather than about the geometry. Over 1 cm it is 1e-7.
    //
    // This was written as 2 m first and failed at 1.4066 against a predicted
    // 1.4010 — the code was exact and the prediction was the approximation,
    // which is the more interesting way round and worth leaving written down.
    const measured = altitudeAbove(RIM_X, ground + 0.01, 0, ground);
    expect(measured).toBeCloseTo(0.01 * rimCos, 6);
  });

  it('reads a metre of world Y as well under a metre of felt height at the rim', () => {
    const ground = terrainHeight(RIM_X, 0);
    const measured = altitudeAbove(RIM_X, ground + 2, 0, ground);
    // Bracketed rather than predicted, for the reason above: strictly less than
    // the y difference, and strictly more than the flat-cap linearisation,
    // because the radius difference is convex in y.
    expect(measured).toBeLessThan(2);
    expect(measured).toBeGreaterThan(2 * rimCos);
    // And by a margin nobody could call rounding: 2 m of world Y is about 1.4 m
    // of the height a child feels out here.
    expect(measured).toBeLessThan(1.45);
  });

  it('is zero on the ground at every radius', () => {
    for (const d of [0, 40, 80, 120, RIM_X]) {
      const ground = terrainHeight(d, 0);
      expect(altitudeAbove(d, ground, 0, ground)).toBeCloseTo(0, 9);
    }
  });
});

describe('liftAlongUp', () => {
  it('is purely vertical at the park origin — the control', () => {
    liftAlongUp(0, terrainHeight(0, 0), 0, 1.2267, v);
    expect(v.y).toBeCloseTo(1.2267, 9);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(0, 9);
  });

  it('carries her sideways by apex * sin θ at the rim, and outwards', () => {
    liftAlongUp(RIM_X, terrainHeight(RIM_X, 0), 0, 1.2267, v);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(1.2267 * rimSin, 2);
    // Outwards, not inwards: the sign is the whole difference between a hop
    // that leans away from the middle of the park and one that leans into it.
    expect(v.x).toBeGreaterThan(0);
    expect(v.length()).toBeCloseTo(1.2267, 6);
  });

  it('reverses exactly on the way down, which is why a hop lands where it left', () => {
    const up = liftAlongUp(RIM_X, terrainHeight(RIM_X, 0), 0, 0.5, v).clone();
    const down = liftAlongUp(RIM_X, terrainHeight(RIM_X, 0), 0, -0.5, v).clone();
    expect(up.clone().add(down).length()).toBeCloseTo(0, 9);
  });
});

describe('landingCorrection', () => {
  it('is zero at the park origin — the control', () => {
    landingCorrection(0, terrainHeight(0, 0) - 0.05, 0, -0.05, v);
    expect(v.length()).toBeCloseTo(0, 9);
  });

  it('gives back the sideways part of an overshoot, inwards', () => {
    const ground = terrainHeight(RIM_X, 0);
    landingCorrection(RIM_X, ground - 0.05, 0, -0.05, v);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(0.05 * rimSin, 3);
    // She overshot along -up, which is inwards and down, so putting her back is
    // outwards. A correction with the wrong sign would double the drift rather
    // than remove it, and would still look like "a small number near zero".
    expect(v.x).toBeGreaterThan(0);
    expect(v.y).toBe(0);
  });
});

describe('chartStep and realStep', () => {
  it('leave a step untouched at the park origin — the control', () => {
    chartStep(0, terrainHeight(0, 0), 0, 0.1, 0.05, v);
    expect(v.x).toBeCloseTo(0.1, 9);
    expect(v.z).toBeCloseTo(0.05, 9);
  });

  it('leave a tangential step untouched even at the rim', () => {
    // The chart does not compress tangentially. This is the clause that would
    // catch a conversion applied to the whole step instead of its radial part.
    chartStep(RIM_X, terrainHeight(RIM_X, 0), 0, 0, 0.1, v);
    expect(v.z).toBeCloseTo(0.1, 9);
    expect(v.x).toBeCloseTo(0, 9);
  });

  it('compress a radial step by cos θ at the rim — a multiply, not a divide', () => {
    chartStep(RIM_X, terrainHeight(RIM_X, 0), 0, 0.1, 0, v);
    expect(v.x).toBeCloseTo(0.1 * rimCos, 3);
    // Explicitly smaller. The inverted form — dividing — is the mistake this
    // whole branch was written around, and it produces a number that is also
    // "close to 0.1" and passes a sloppier assertion.
    expect(v.x).toBeLessThan(0.1);
  });

  it('round-trip exactly, which is what stops her decaying to a standstill', () => {
    for (const d of [0, 40, 80, 120, RIM_X]) {
      const y = terrainHeight(d, 0);
      chartStep(d, y, 0, 0.13, 0.07, v);
      realStep(d, y, 0, v.x, v.z, v);
      expect(v.x).toBeCloseTo(0.13, 9);
      expect(v.z).toBeCloseTo(0.07, 9);
    }
  });
});

describe('indoors — the branch no outdoor measurement can see', () => {
  /**
   * A real interior coordinate, asserted to actually be one. Hard-coding a
   * point and *assuming* it is a room is how a check comes to measure the
   * garden while reporting on the hotel: `eng/radial-collide` fed deck-local
   * coordinates to `spaceAt` and got 351 confident answers about the grass.
   */
  const room = (() => {
    for (const [x, z] of [
      [600, 0],
      [-600, 0],
      [0, 600],
      [1200, 600],
      [600, 600],
    ] as const) {
      if (spaceAt(x, z) !== SPACE_GARDEN) return { x, z };
    }
    return null;
  })();

  it('found an interior coordinate to test against', () => {
    // If this fails the four below are vacuous, so it is asserted separately
    // rather than left as a silent skip.
    expect(room).not.toBeNull();
  });

  it('measures altitude as a plain height difference in a room', () => {
    if (!room) return;
    // 600 m from the origin the RADIUS is ~600 m; a radius difference would be
    // nothing like a 3 m ceiling. This is the assertion that the branch exists.
    expect(altitudeAbove(room.x, 3, room.z, 0)).toBeCloseTo(3, 9);
  });

  it('lifts straight up in a room, with no sideways component', () => {
    if (!room) return;
    liftAlongUp(room.x, 1, room.z, 0.5, v);
    expect(v.y).toBeCloseTo(0.5, 9);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(0, 9);
  });

  it('needs no landing correction in a room', () => {
    if (!room) return;
    landingCorrection(room.x, -0.05, room.z, -0.05, v);
    expect(v.length()).toBeCloseTo(0, 9);
  });

  it('does not compress a step in a room, in any direction', () => {
    if (!room) return;
    chartStep(room.x, 1, room.z, 0.1, 0.1, v);
    expect(v.x).toBeCloseTo(0.1, 9);
    expect(v.z).toBeCloseTo(0.1, 9);
  });
});
