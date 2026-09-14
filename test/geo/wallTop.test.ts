import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GROUND_SPHERE_RADIUS, PLAYER_RADIUS } from '../../src/core/constants';
import { CollisionWorld } from '../../src/world/Collision';

const R = GROUND_SPHERE_RADIUS;
const capY = (d: number): number => Math.sqrt(R * R - d * d) - R;

const note = (s: string): void => {
  process.stderr.write(`  ${s}\n`);
};

/** Walk a body along +z at the wall, and report the z it ended up at. */
const marchAlongZ = (
  world: CollisionWorld,
  x: number,
  fromZ: number,
  y: number,
  toZ: number,
): number => {
  const position = new Vector3(x, y, fromZ);
  const stride = 0.05;
  for (let z = fromZ; z < toZ; z += stride) {
    position.z += stride;
    world.resolve(position, PLAYER_RADIUS);
  }
  return position.z;
};

describe('a wall top is read at the contact point', () => {
  it('is solid in the middle whichever end it was registered from', () => {
    // The invariant that matters, and the one a single scalar cannot hold: a
    // fence is solid from every approach, however the builder happened to
    // write its two endpoints down. Registering the same physical fence in
    // both orders must give the same answer, and with one top it does not —
    // one order is solid and the other is a ghost.
    //
    // A 10 m fence run from (75, 20) to (85, 20), 1.1 m tall, standing on the
    // ground. Its ends are 77.6 m and 87.3 m from the park's origin, so the
    // ground under it falls 3.92 m along its own length.
    const fenceHeight = 1.1;
    const lowD = Math.hypot(85, 20);
    const highD = Math.hypot(75, 20);
    const topAtHighEnd = capY(highD) + fenceHeight;
    const topAtLowEnd = capY(lowD) + fenceHeight;

    // A child walking into the MIDDLE of it, standing on the ground there.
    const walkerGround = capY(Math.hypot(80, 19.1));
    const trueTopAtMiddle = capY(Math.hypot(80, 20)) + fenceHeight;
    note(
      `10 m fence at x = 75..85, z = 20: top is ${topAtHighEnd.toFixed(2)} m of world y at ` +
        `one end and ${topAtLowEnd.toFixed(2)} m at the other, truly ` +
        `${trueTopAtMiddle.toFixed(2)} m in the middle where she meets it; ` +
        `her feet are at ${walkerGround.toFixed(2)} m`,
    );

    const reachWithOneTop: number[] = [];
    const reachWithTwoTops: number[] = [];
    for (const forwards of [true, false]) {
      // Whichever way round, the builder declares the top at its FIRST point —
      // which is what a single-scalar registration does.
      const one = new CollisionWorld();
      const two = new CollisionWorld();
      if (forwards) {
        one.addWall(75, 20, 85, 20, 0.2, topAtHighEnd, false, true);
        two.addWall(75, 20, 85, 20, 0.2, topAtHighEnd, false, true, -Infinity, false, topAtLowEnd);
      } else {
        one.addWall(85, 20, 75, 20, 0.2, topAtLowEnd, false, true);
        two.addWall(85, 20, 75, 20, 0.2, topAtLowEnd, false, true, -Infinity, false, topAtHighEnd);
      }
      reachWithOneTop.push(marchAlongZ(one, 80, 17, walkerGround, 23));
      reachWithTwoTops.push(marchAlongZ(two, 80, 17, walkerGround, 23));
    }

    note(
      `marching into the middle: one top reaches z = ` +
        `${reachWithOneTop.map((v) => v.toFixed(2)).join(' and ')} depending only on which ` +
        `end it was written from; two tops reach z = ` +
        `${reachWithTwoTops.map((v) => v.toFixed(2)).join(' and ')}`,
    );

    // Two tops: stopped short of the fence both ways round. This is the
    // assertion the feature exists for.
    for (const reach of reachWithTwoTops) expect(reach).toBeLessThan(20);
    // And the two orders agree, which is the property a scalar cannot have.
    expect(Math.abs((reachWithTwoTops[0] ?? 0) - (reachWithTwoTops[1] ?? 0))).toBeLessThan(0.01);

    // The control: with one top the answer really does depend on which end the
    // builder wrote first — one order is solid, the other lets her through.
    // Without this the test above could be true of a world where every wall is
    // solid for unrelated reasons.
    const oneTopLetHerThrough = reachWithOneTop.filter((r) => r > 20.5).length;
    note(`with one top, ${oneTopLetHerThrough} of the 2 registration orders is a ghost`);
    expect(oneTopLetHerThrough).toBe(1);
  });

  it('is bit-for-bit unchanged for a caller that declares one top', () => {
    // The migration's safety property: every existing call site passes no far
    // top, so it gets `topHeightFar === topHeight` and the interpolator returns
    // the near value untouched, at every t.
    const before = new CollisionWorld();
    before.addWall(-5, 0, 5, 0, 0.3, 0.8, false, true);
    const ends: number[] = [];
    for (let z = -1.5; z <= 1.5; z += 0.25) {
      for (let x = -6; x <= 6; x += 0.5) {
        const p = new Vector3(x, 0.4, z);
        before.resolve(p, PLAYER_RADIUS);
        ends.push(p.x, p.z);
      }
    }
    note(`${ends.length / 2} placement probes across a one-top wall`);
    // Feet at 0.4 m against a 0.8 m absolute top: solid, so something moved.
    expect(ends.some((v, i) => i % 2 === 0 && Math.abs(v) < 6)).toBe(true);
    expect(ends.every((v) => Number.isFinite(v))).toBe(true);

    // And the sentinel case: an infinite top must stay infinite, never NaN.
    const endless = new CollisionWorld();
    endless.addWall(-5, 0, 5, 0, 0.3);
    const p = new Vector3(0, 900, 0);
    endless.resolve(p, PLAYER_RADIUS);
    note(`a mover 900 m up is still pushed out of a top-less wall: z = ${p.z.toFixed(3)}`);
    expect(Math.abs(p.z)).toBeGreaterThan(0.5);
  });

  it('an autoHoppable wall whose top varies is demoted at boot, not trusted', () => {
    const world = new CollisionWorld();
    world.addWall(-5, 0, 5, 0, 0.2, 0.7, true, false, -Infinity, false, 0.9);
    const problems = world.checkHoppableColliders(PLAYER_RADIUS, 1.2812);
    note(`boot check said: ${problems.join(' | ') || '(nothing)'}`);
    expect(problems.some((p) => p.includes('varies along it'))).toBe(true);
    // Demoted, so nothing plans a hop over it.
    expect(world.wouldAutoHopClear(new Vector3(0, 0, 0), PLAYER_RADIUS, 1.2812)).toBe(false);

    // The control: the same wall with one top IS hoppable, so the assertion
    // above is about the varying top and not about the wall being unreachable.
    const flat = new CollisionWorld();
    flat.addWall(-5, 0, 5, 0, 0.2, 0.7, true);
    expect(flat.checkHoppableColliders(PLAYER_RADIUS, 1.2812)).toEqual([]);
    expect(flat.wouldAutoHopClear(new Vector3(0, 0, 0), PLAYER_RADIUS, 1.2812)).toBe(true);
  });
});

describe('checkAbsoluteTopSag', () => {
  it('finds the long run that is solid at both ends and hollow in the middle', () => {
    const world = new CollisionWorld();
    // 2.4 m, which is what train/fence.ts registers.
    world.addWall(80, 18.8, 80, 21.2, 0.2, -16, false, true);
    // 20 m of the same run, written as one piece.
    world.addWall(80, 10, 80, 30, 0.2, -16, false, true);
    const problems = world.checkAbsoluteTopSag(0.05, false);
    note(`sag check reported ${problems.length} of 2 walls: ${problems.join(' | ')}`);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('20.0 m long');

    // The control, and it corrected me: the dominant term is the segment's own
    // LENGTH (L^2/8R), not where it stands. The same 20 m run through the
    // middle of the park sags 0.227 m against the rim's 0.248 m — the lean
    // multiplies this defect, it does not cause it. So the honest control is
    // that a SHORT run is clean wherever it is and a LONG one is reported
    // wherever it is, and asserting the origin was exempt would have been this
    // repo's own "a check that passes without checking anything".
    const middle = new CollisionWorld();
    middle.addWall(0, -10, 0, 10, 0.2, -0.1, false, true);
    const atOrigin = middle.checkAbsoluteTopSag(0.05, false);
    note(`the same 20 m run through the park's middle: ${atOrigin.length} reported`);
    expect(atOrigin).toHaveLength(1);

    const shortEverywhere = new CollisionWorld();
    shortEverywhere.addWall(0, -1.2, 0, 1.2, 0.2, -0.1, false, true);
    shortEverywhere.addWall(155.8, 0, 158.2, 0, 0.2, -60, false, true);
    expect(shortEverywhere.checkAbsoluteTopSag(0.05, false)).toHaveLength(0);
  });

  it('says so out loud when it is measuring nothing', () => {
    const world = new CollisionWorld();
    world.addWall(80, 10, 80, 30, 0.2); // no absolute top
    const logged: string[] = [];
    const real = console.info;
    console.info = (m: string): void => void logged.push(m);
    try {
      expect(world.checkAbsoluteTopSag()).toHaveLength(0);
    } finally {
      console.info = real;
    }
    note(`with no absolute-topped wall it announced: ${logged.join('')}`);
    expect(logged.join('')).toContain('asserts nothing');
  });
});
