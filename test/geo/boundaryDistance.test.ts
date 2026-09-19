import { describe, expect, it } from 'vitest';

import { profileBoundary, REFINE } from '../../src/world/boundary.ts';
import { TAU } from '../../src/core/mathUtils.ts';

/**
 * **`profileBoundary`'s distance query, held to brute force.**
 *
 * `distanceToEdge` finds the nearest polygon *vertex* and then does real
 * point-to-segment work on the five segments beside it. That coarse pass used
 * to walk all 512 vertices, and walking them was **80.7% of the whole park
 * solve's CPU** — the rail generator asks this once per sample of every
 * candidate piece. It is a per-cell candidate list now: each grid cell
 * remembers every vertex that could be nearest anywhere inside it, which is
 * provably a superset of the winners, held in ascending index order so a tie
 * breaks the same way.
 *
 * Provably is not measurably, so this measures it, two ways:
 *
 * - against the **full scan**, which must agree **bit for bit** — anything
 *   less and the park a seed builds would quietly differ from the one it built
 *   yesterday;
 * - against **brute force over every segment**, which the file's own comment
 *   has claimed for weeks without a test existing to make it true. That is the
 *   looser clause (the ±2 refinement window is an approximation of its own,
 *   and this records how good it is) but it is the one that would catch a
 *   coarse pass that agrees with a broken full scan.
 *
 * A circle is in the profile list on purpose: every vertex is then equidistant
 * from the centre, which is the case the candidate list cannot usefully narrow
 * and where it must hand back to the full scan rather than get it wrong.
 */

const SAMPLES = 512;

/**
 * The pre-acceleration coarse pass: the nearest vertex by a full scan.
 *
 * `REFINE` is **imported, never re-typed**. A hand-copied `2` here would keep
 * passing the day `boundary.ts` changed its window — both oracles would have
 * moved together and agreed with each other about the wrong thing — which is
 * CLAUDE.md's "two definitions of one thing, kept in step by hand", the most
 * reported bug shape in this repo.
 */
function fullScanDistance(points: readonly (readonly [number, number])[], radii: readonly number[]) {
  const count = points.length;
  const radiusAt = (bearing: number): number => {
    const t = ((bearing % TAU) + TAU) % TAU;
    const scaled = (t / TAU) * count;
    const i = Math.floor(scaled) % count;
    const frac = scaled - Math.floor(scaled);
    const a = radii[i] as number;
    const b = radii[(i + 1) % count] as number;
    return a + (b - a) * frac;
  };
  return (x: number, z: number): number => {
    let coarse = 0;
    let coarseBest = Infinity;
    for (let i = 0; i < count; i += 1) {
      const [px, pz] = points[i] as readonly [number, number];
      const dx = x - px;
      const dz = z - pz;
      const d = dx * dx + dz * dz;
      if (d < coarseBest) {
        coarseBest = d;
        coarse = i;
      }
    }
    let best = Infinity;
    for (let step = -REFINE; step <= REFINE; step += 1) {
      const i = (((coarse + step) % count) + count) % count;
      const [ax, az] = points[i] as readonly [number, number];
      const [bx, bz] = points[(i + 1) % count] as readonly [number, number];
      const dx = bx - ax;
      const dz = bz - az;
      const lengthSq = dx * dx + dz * dz;
      let t = lengthSq > 0 ? ((x - ax) * dx + (z - az) * dz) / lengthSq : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best) best = d;
    }
    return Math.hypot(x, z) <= radiusAt(Math.atan2(z, x)) ? best : -best;
  };
}

/** Every segment, projected onto properly — no coarse pass at all. */
function bruteForceDistance(points: readonly (readonly [number, number])[]) {
  const count = points.length;
  return (x: number, z: number): number => {
    let best = Infinity;
    for (let i = 0; i < count; i += 1) {
      const [ax, az] = points[i] as readonly [number, number];
      const [bx, bz] = points[(i + 1) % count] as readonly [number, number];
      const dx = bx - ax;
      const dz = bz - az;
      const lengthSq = dx * dx + dz * dz;
      let t = lengthSq > 0 ? ((x - ax) * dx + (z - az) * dz) / lengthSq : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best) best = d;
    }
    return best;
  };
}

/** A circle at `kind` 0, then four star profiles of rising eccentricity. */
function profile(kind: number): number[] {
  const radii: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const a = (i / SAMPLES) * TAU;
    const wiggle =
      kind === 0
        ? 0
        : 0.08 * kind * Math.sin(2 * a + kind) +
          0.05 * kind * Math.cos(3 * a + 2 * kind) +
          0.03 * kind * Math.sin(5 * a);
    radii.push(80 * (1 + wiggle));
  }
  return radii;
}

/** Inside, across the edge, outside, and the degenerate query at the origin. */
function* queries(): Generator<readonly [number, number]> {
  yield [0, 0];
  for (let ix = -55; ix <= 55; ix += 1) {
    for (let iz = -55; iz <= 55; iz += 1) yield [ix * 2.27, iz * 2.27];
  }
}

describe('profileBoundary.distanceToEdge', () => {
  it('is bit-identical to the full 512-vertex scan it accelerates', () => {
    let checked = 0;
    for (let kind = 0; kind < 5; kind += 1) {
      const radii = profile(kind);
      const boundary = profileBoundary(radii);
      const reference = fullScanDistance(boundary.outline(), radii);
      for (const [x, z] of queries()) {
        checked += 1;
        // Not `toBeCloseTo`: a park is a deterministic function of these
        // doubles, so "close" is a different park.
        expect(boundary.distanceToEdge(x, z)).toBe(reference(x, z));
      }
    }
    process.stderr.write(`boundary distance: ${checked} points agree bit-for-bit with the full scan\n`);
  });

  it('agrees with brute force over every segment, inside the park', () => {
    let checked = 0;
    let worst = 0;
    for (let kind = 0; kind < 5; kind += 1) {
      const boundary = profileBoundary(profile(kind));
      const brute = bruteForceDistance(boundary.outline());
      for (const [x, z] of queries()) {
        const mine = boundary.distanceToEdge(x, z);
        if (mine <= 0) continue; // outside: the sign is the profile's business, tested above
        checked += 1;
        const apart = Math.abs(mine - brute(x, z));
        if (apart > worst) worst = apart;
      }
    }
    process.stderr.write(
      `boundary distance: ${checked} interior points, worst gap from brute force ${worst.toFixed(6)} m\n`,
    );
    // The ±2 refinement window is the only approximation left. It has never
    // been measured before; 1 cm is a ceiling far above what it does (under a
    // micrometre on these profiles) and far below anything the park asks.
    expect(worst).toBeLessThan(0.01);
  });
});
