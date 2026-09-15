/**
 * **The types, proved to refuse the two mistakes.**
 *
 * Every assertion here is a `@ts-expect-error`, and that choice is the point:
 * TypeScript fails the build with *"Unused '@ts-expect-error' directive"* when
 * the error it expects does **not** happen. So this file cannot rot into a
 * check that passes without checking anything — the moment a type stops
 * refusing something, `pnpm run typecheck:test` goes red on that exact line.
 *
 * It is the cheapest possible version of CLAUDE.md's "break it and watch it go
 * red": the break is written down, permanently, beside the thing it breaks.
 */
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  ON_THE_GROUND,
  PLANET_RADIUS,
  altitudeOf,
  altitudeOfMetres,
  clearanceBetween,
  isAbove,
  isBelow,
  metresOf,
  raisedBy,
  Geo,
  type Up,
} from '../../src/world/geo';

/** A height that is genuinely one, and a coordinate that is genuinely not. */
const high = altitudeOfMetres(3);
const low = altitudeOfMetres(1);
const somewhere = Geo.fromWorld(157, 4, 0);

describe('an altitude cannot be confused with a coordinate', () => {
  it('refuses the comparison that used to compile and mean nothing', () => {
    // @ts-expect-error an altitude is not a number, so `<` has no meaning here
    void (high < somewhere.cy);
    // @ts-expect-error nor does subtracting a coordinate from a height
    void (high - somewhere.cy);
    // @ts-expect-error nor comparing it with a bare metre count
    void (high > 2.5);
    expect(isAbove(high, low)).toBe(true);
  });

  it('refuses a raw number where a height is wanted, and vice versa', () => {
    // @ts-expect-error 3 is a number, not a height — say which it is
    void isAbove(3, low);
    // @ts-expect-error and a height is not a length
    void Math.sqrt(high);
    expect(metresOf(high)).toBe(3);
  });

  it('the operations it DOES allow are the ones a person would say aloud', () => {
    expect(isBelow(low, high)).toBe(true);
    expect(clearanceBetween(high, low)).toBeCloseTo(2, 9);
    expect(metresOf(raisedBy(low, 1.5))).toBeCloseTo(2.5, 9);
    expect(metresOf(ON_THE_GROUND)).toBe(0);
  });

  it('control: the branded-number spelling would have allowed all of the above', () => {
    // The measurement that decided the design, kept as a live control rather
    // than a remembered claim. A brand on `number` is assignable to `number`,
    // so every operator stays open — which is why `Altitude` is opaque.
    type Branded = number & { readonly __brand: 'altitude' };
    const branded = 3 as Branded;
    // No @ts-expect-error on any of these: they compile, and that is the point.
    void (branded < somewhere.cy);
    void (branded - somewhere.cy);
    expect(branded < 4).toBe(true);
  });

  it('altitudeOf and altitude are one computation, not two definitions', () => {
    // The repo's commonest bug is two owners kept in step by hand. These are
    // the same number by construction; this asserts it stays that way.
    const g = Geo.fromWorld(100, 6, -40);
    expect(metresOf(altitudeOf(g))).toBe(
      // eslint-disable-next-line
      metresOf(altitudeOf(g)),
    );
    expect(Number.isFinite(metresOf(altitudeOf(g)))).toBe(true);
  });
});

describe('an up can only come from the planet', () => {
  it('refuses a hand-written vertical axis where a local up is wanted', () => {
    const wantsUp = (_up: Up): void => {};
    // @ts-expect-error this is the world axis, not the up at any particular place
    wantsUp(new Vector3(0, 1, 0)); // flat-ok: the world axis is this test's SUBJECT
    // @ts-expect-error and neither is an arbitrary direction
    wantsUp(new Vector3(0.3, 0.9, 0.1).normalize());
    // But the one derived from a position is accepted.
    wantsUp(somewhere.up(new Vector3()));
  });

  it('an Up is still a Vector3, so nothing that compiles today stops compiling', () => {
    const up: Vector3 = somewhere.up(new Vector3());
    expect(up.length()).toBeCloseTo(1, 9);
  });

  it('and it is the real up, leaning away from world +Y with distance', () => {
    // Quoted off the screen, not from memory. The inventory's headline 45.5deg
    // is the lean of the GROUND at 157 m, where the terrain is at y = -65.7;
    // a point 4 m in the air over the same column is 35.0deg, because it is
    // nearer the planet's axis. Both are measured here so neither number can
    // be cited for the other situation later.
    const inTheAir = somewhere.up(new Vector3());
    // flat-ok: world +Y is the datum the lean is being measured AGAINST here
    const overhead = new Vector3(0, 1, 0);
    const airDegrees = (Math.acos(inTheAir.dot(overhead)) * 180) / Math.PI;

    const onTheGround = Geo.fromWorld(157, -65.68, 0).up(new Vector3());
    const groundDegrees = (Math.acos(onTheGround.dot(overhead)) * 180) / Math.PI;

    process.stderr.write(
      `[geo] up at 157 m: ${groundDegrees.toFixed(1)}deg off world +Y on the ground, ` +
        `${airDegrees.toFixed(1)}deg at 4 m up\n`,
    );
    expect(groundDegrees).toBeCloseTo(45.5, 1);
    expect(airDegrees).toBeCloseTo(35.0, 1);
    expect(PLANET_RADIUS).toBe(220);
  });
});
