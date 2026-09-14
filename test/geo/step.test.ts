import { describe, expect, it } from 'vitest';
import { BUILDING_STEP_UP, GROUND_SPHERE_RADIUS } from '../../src/core/constants';
import { Geo, riseBetween, riseBetweenWorld } from '../../src/world/geo';

const R = GROUND_SPHERE_RADIUS;

/** The bare spherical cap, so every number here is reproducible without a park. */
const capY = (d: number): number => Math.sqrt(R * R - d * d) - R;

/** A point on the cap, `height` metres up its own local up. */
const onCap = (d: number, height = 0): Geo => {
  const g = Geo.fromWorld(d, capY(d), 0);
  return g.lift(height);
};

/** The frame this replaces: a difference of world `y`. */
const worldYStep = (a: Geo, b: Geo): number => b.cy - a.cy;

const note = (s: string): void => {
  process.stderr.write(`  ${s}\n`);
};

describe('riseBetween — the honest step between two standing places', () => {
  it('is zero on level ground at every lean, where a world-y difference is not', () => {
    // The lattice's worst neighbour: a diagonal cell, all of it radial.
    const step = 0.5 * Math.SQRT2;
    let worstRise = 0;
    let worstWorldY = 0;
    for (const d of [0, 40, 80, 120, 157, 184.3]) {
      const a = onCap(d);
      const b = onCap(d + step);
      worstRise = Math.max(worstRise, Math.abs(riseBetween(a, b)));
      worstWorldY = Math.max(worstWorldY, Math.abs(worldYStep(a, b)));
    }
    note(
      `level ground, diagonal lattice step, d = 0..184.3 m: rise reads at most ` +
        `${worstRise.toFixed(4)} m, a world-y difference at most ${worstWorldY.toFixed(4)} m ` +
        `against a ${BUILDING_STEP_UP} m gate`,
    );

    expect(worstRise).toBeLessThan(0.005);
    // The control, and it is the point: the datum being replaced fails the very
    // gate this one passes. Without this line the assertion above could be true
    // of a function that returned 0 unconditionally.
    expect(worstWorldY).toBeGreaterThan(BUILDING_STEP_UP);
  });

  it('reads a real ledge at its real height, where a world-y difference dissolves it', () => {
    const ledge = 0.7;
    const rows: string[] = [];
    let admittedByWorldY = 0;
    for (const d of [0, 40, 80, 120, 157]) {
      const a = onCap(d);
      const b = onCap(d + 0.5, ledge);
      const rise = riseBetween(a, b);
      const flat = worldYStep(a, b);
      if (Math.abs(flat) <= BUILDING_STEP_UP) admittedByWorldY += 1;
      rows.push(`d=${d}m rise ${rise.toFixed(3)} m, world-y ${flat.toFixed(3)} m`);

      // The ledge is a real 0.70 m lift along the local up, everywhere.
      expect(rise).toBeCloseTo(ledge, 2);
      expect(Math.abs(rise)).toBeGreaterThan(BUILDING_STEP_UP);
    }
    note(`a real 0.70 m ledge: ${rows.join('; ')}`);
    note(
      `the world-y gate would walk a child up ${admittedByWorldY} of 5 of those ledges`,
    );
    // The control: the old datum really does admit them, so this test is
    // describing a live defect rather than a hypothetical one.
    expect(admittedByWorldY).toBeGreaterThanOrEqual(4);
  });

  it('is exactly antisymmetric, so a lattice edge cannot exist in one direction only', () => {
    let worst = 0;
    for (const d of [0, 37, 91, 157, 184.3]) {
      const a = onCap(d, 0.3);
      const b = onCap(d + 0.7, 1.1);
      worst = Math.max(worst, Math.abs(riseBetween(a, b) + riseBetween(b, a)));
    }
    note(`rise(a,b) + rise(b,a) is at most ${worst.toExponential(2)} m over the sweep`);
    expect(worst).toBe(0);

    // The control: taking `from`'s own up instead of the midpoint's is the
    // natural way to write this, and it is NOT antisymmetric — this is the
    // magnitude of the defect the midpoint avoids.
    const fromsOwnUp = (p: Geo, q: Geo): number => {
      const r = p.radius();
      return ((q.cx - p.cx) * p.cx + (q.cy - p.cy) * p.cy + (q.cz - p.cz) * p.cz) / r;
    };
    const a = onCap(157, 0.3);
    const b = onCap(157.7, 1.1);
    const skew = Math.abs(fromsOwnUp(a, b) + fromsOwnUp(b, a));
    note(`from's own up would be out by ${skew.toExponential(2)} m on the same pair`);
    expect(skew).toBeGreaterThan(0);
  });

  it('agrees with its own world-coordinate form', () => {
    let worst = 0;
    for (const d of [0, 63, 157]) {
      const a = onCap(d, 0.4);
      const b = onCap(d + 0.5, 1.2);
      const viaGeo = riseBetween(a, b);
      const viaWorld = riseBetweenWorld(
        a.cx,
        a.cy - R,
        a.cz,
        b.cx,
        b.cy - R,
        b.cz,
      );
      worst = Math.max(worst, Math.abs(viaGeo - viaWorld));
    }
    note(`the Geo and world forms agree to ${worst.toExponential(2)} m`);
    expect(worst).toBeLessThan(1e-9);
    // Control: the pair really does have a rise, so agreeing at zero would not
    // have counted.
    expect(Math.abs(riseBetween(onCap(157, 0.4), onCap(157.5, 1.2)))).toBeGreaterThan(0.5);
  });

  it('reduces to a plain height difference in the same column', () => {
    // At the park's origin the planet is edge-on to nothing, so the two frames
    // must coincide exactly — the migration can never make a centre-of-park
    // measurement worse, and this is the assertion that says so.
    const a = onCap(0, 0);
    const b = onCap(0, 0.5);
    expect(riseBetween(a, b)).toBeCloseTo(0.5, 9);
    expect(worldYStep(a, b)).toBeCloseTo(0.5, 9);
  });
});
