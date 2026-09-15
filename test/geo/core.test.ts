import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  GROUND_SPHERE_RADIUS,
} from '../../src/core/constants';
import {
  Anchor,
  Frame,
  Geo,
  PARK_CHART,
  PLANET_RADIUS,
  advance,
  altitude,
  constantOver,
  curvedChart,
  flatChart,
  flatDeparture,
  flatRadiusFor,
  geodesicLerp,
  groundRadiusToward,
  tangentTowards,
  unboundedConstant,
} from '../../src/world/geo';
import { placeOnSphere, terrainHeight, upAt } from '../../src/world/terrain';

/**
 * **The core sphere vocabulary, and a control on every instrument that measures
 * it.**
 *
 * CLAUDE.md: *"break every check deliberately and watch it go red before you
 * trust it green"*, and *"control every instrument before trusting it"* — six
 * instruments were wrong-but-clean in one day on this project. So every
 * assertion here that could pass vacuously is paired with a **control**: the
 * same measurement run against the *wrong* answer, asserted to be wrong by a
 * stated margin. If the geometry ever moves such that the wrong answer stops
 * being wrong, the control goes red and says so, rather than the real assertion
 * quietly becoming untestable.
 *
 * The paired controls are named `control:` so they can be read as a block.
 */

/** Places that exercise the real range: the origin, the garden, the park's reach. */
const SAMPLE_COLUMNS: readonly (readonly [number, number])[] = [
  [0, 0],
  [12, -7],
  [40, 40],
  [-80, 25],
  [0, 135.4],
  [120, -100],
  [157, 0],
  [-110, -110],
];

describe('Geo: world space is a pure translation of planet-centred space', () => {
  it('fromWorld / toWorld round-trips exactly', () => {
    const out = new Vector3();
    for (const [x, z] of SAMPLE_COLUMNS) {
      const y = terrainHeight(x, z);
      Geo.fromWorld(x, y, z).toWorld(out);
      expect(out.x).toBe(x);
      // `y` is exact to a nanometre rather than bit-exact: it goes out and back
      // through `+220`, and floating point does not promise that. A nanometre
      // is six orders of magnitude below anything this game measures, and
      // saying so here is cheaper than a reader discovering it in a diff.
      expect(Math.abs(out.y - y)).toBeLessThan(1e-9);
      expect(out.z).toBe(z);
    }
  });

  it('the planet centre is where terrain.ts has been asserting it is', () => {
    // `planetRadiusAt` has used `y + GROUND_SPHERE_RADIUS` since the arrival
    // camera fix. If that ever moves, everything in `geo/` is off by the
    // difference and nothing else would notice.
    const g = Geo.fromWorld(0, 0, 0);
    expect(g.radius()).toBeCloseTo(GROUND_SPHERE_RADIUS, 12);
    expect(PLANET_RADIUS).toBe(GROUND_SPHERE_RADIUS);
  });

  it('agrees with terrain.ts upAt at every sample column', () => {
    const mine = new Vector3();
    const theirs = new Vector3();
    for (const [x, z] of SAMPLE_COLUMNS) {
      const y = terrainHeight(x, z);
      Geo.fromWorld(x, y, z).up(mine);
      upAt(x, y, z, theirs);
      expect(mine.distanceTo(theirs)).toBeLessThan(1e-12);
    }
  });

  it('control: the world +Y axis is NOT the local up anywhere but the origin', () => {
    // If this ever passes, the sphere has been flattened and every assertion
    // above is measuring nothing.
    const up = new Vector3();
    Geo.fromWorld(157, terrainHeight(157, 0), 0).up(up);
    const lean = (Math.acos(up.y) * 180) / Math.PI;
    expect(lean).toBeGreaterThan(40);
    expect(lean).toBeLessThan(50);
  });
});

describe('Geo: chord and arc are different questions', () => {
  it('the arc is longer than the chord, and by the curvature', () => {
    const a = Geo.fromWorld(0, 0, 0);
    const b = Geo.fromWorld(100, terrainHeight(100, 0), 0);
    expect(a.arcTo(b)).toBeGreaterThan(a.chordTo(b));
    // Measured, not asserted from a formula: 100 m of walking on R = 220.
    expect(a.arcTo(b) - a.chordTo(b)).toBeGreaterThan(0.5);
    expect(a.arcTo(b) - a.chordTo(b)).toBeLessThan(5);
  });

  it('control: they agree to within a millimetre at furniture scale', () => {
    // The pair-with-a-margin that makes the divergence above meaningful: over a
    // metre the two metrics are the same number, so converting a short-range
    // call site cannot change an answer.
    const a = Geo.fromWorld(10, terrainHeight(10, 0), 0);
    const b = Geo.fromWorld(11, terrainHeight(11, 0), 0);
    expect(Math.abs(a.arcTo(b) - a.chordTo(b))).toBeLessThan(1e-3);
  });

  it('chordTo equals the old Vector3 distance exactly', () => {
    const av = new Vector3(12, terrainHeight(12, -7), -7);
    const bv = new Vector3(-80, terrainHeight(-80, 25), 25);
    const a = Geo.fromWorldVector(av);
    const b = Geo.fromWorldVector(bv);
    expect(a.chordTo(b)).toBeCloseTo(av.distanceTo(bv), 10);
  });
});

describe('Chart: the curved chart is exact at any distance', () => {
  it('toGeo / toLocal round-trips to sub-millimetre out to the park reach', () => {
    const g = new Geo();
    const back = new Vector3();
    let worst = 0;
    for (const [x, z] of SAMPLE_COLUMNS) {
      for (const y of [0, 2.5, 40]) {
        const local = new Vector3(x, y, z);
        PARK_CHART.toGeo(local, g);
        PARK_CHART.toLocal(g, back);
        worst = Math.max(worst, back.distanceTo(local));
      }
    }
    process.stderr.write(`[geo] curved chart round trip, worst error: ${worst.toExponential(3)} m\n`);
    expect(worst).toBeLessThan(1e-6);
  });

  it('local (x, z) is a true walking distance — no orthographic compression', () => {
    // The defect this replaces, stated as a number. Today's (x, z) chart
    // compresses radially by cos(theta): a 0.5 m cell measures 0.714 m at the
    // park's reach, against NavGrid's 0.62 m MAX_STEP. On the curved chart a
    // 0.5 m step is 0.5 m of ground, everywhere.
    const a = new Geo();
    const b = new Geo();
    for (const d of [0, 40, 80, 135.4, 157]) {
      PARK_CHART.toGeo(new Vector3(d, 0, 0), a);
      PARK_CHART.toGeo(new Vector3(d + 0.5, 0, 0), b);
      expect(a.arcTo(b)).toBeCloseTo(0.5, 6);
    }
  });

  it('control: the SAME measurement on a flat chart is wrong, and by how much', () => {
    // The control that proves the test above is measuring something. A flat
    // chart big enough to hold the park gets the radial step right (it is a
    // plane) but puts the point in the wrong place on the planet entirely.
    // It has to say what it costs to be allowed to exist — which is the point
    // of the control: the park-sized flat chart every one of today's bugs is
    // an implicit instance of cannot now be declared without writing 63.9 m
    // down. Nobody would sign that off; nobody ever had to before.
    const flat = flatChart('control-flat-park', new Frame(new Geo(0, PLANET_RADIUS, 0)), 200, {
      departure: flatDeparture(200),
      because: 'the control: a deliberately illegitimate chart, to measure how wrong flat is',
    });
    const curvedAt = new Geo();
    const flatAt = new Geo();
    const local = new Vector3(157, 0, 0);
    PARK_CHART.toGeo(local, curvedAt);
    flat.toGeo(local, flatAt);
    const gap = curvedAt.chordTo(flatAt);
    process.stderr.write(`[geo] flat vs curved at 157 m: ${gap.toFixed(2)} m apart\n`);
    expect(gap).toBeGreaterThan(50);
  });

  it('upAt leans, and matches the up of the position it maps to', () => {
    const g = new Geo();
    const fromChart = new Vector3();
    const fromGeo = new Vector3();
    for (const [x, z] of SAMPLE_COLUMNS) {
      const local = new Vector3(x, 3, z);
      PARK_CHART.toGeo(local, g);
      PARK_CHART.upAt(local, fromChart);
      g.up(fromGeo);
      expect(fromChart.distanceTo(fromGeo)).toBeLessThan(1e-9);
    }
  });
});

describe('Chart: flatness is declared, bounded, and priced', () => {
  it('the departure table is the one the design decided on', () => {
    expect(flatRadiusFor(0.01)).toBeCloseTo(2.1, 1);
    expect(flatRadiusFor(0.05)).toBeCloseTo(4.69, 2);
    expect(flatRadiusFor(0.1)).toBeCloseTo(6.63, 2);
    expect(flatRadiusFor(1)).toBeCloseTo(20.95, 2);
    // And the headline: a 60 m hall departs by 2.06 m; a castle floor plate
    // (42.4 m across) by 1.02 m. Both are Jim's declared interior exception.
    expect(flatDeparture(30)).toBeCloseTo(2.06, 2);
    expect(flatDeparture(21.2)).toBeCloseTo(1.02, 2);
  });

  it('reading outside a chart throws at the call site', () => {
    const bench = flatChart('bench-under-test', new Frame(new Geo(0, PLANET_RADIUS, 0)), 2);
    const g = new Geo();
    expect(() => bench.toGeo(new Vector3(1, 0, 1), g)).not.toThrow();
    expect(() => bench.toGeo(new Vector3(9, 0, 0), g)).toThrow(/valid for 2\.00 m/);
  });

  it('asking a flat chart for an UP outside its radius throws — the lie, not the rounding', () => {
    // `toGeo`/`toLocal` were guarded from the first draft. `upAt` was not, and
    // it is the worse of the two: a position wrong by the departure is wrong by
    // centimetres; an up wrong by the lean is the second of the two mistakes
    // the whole inventory is a list of.
    const bench = flatChart('bench-up-under-test', new Frame(new Geo(0, PLANET_RADIUS, 0)), 2);
    const up = new Vector3();
    expect(() => bench.upAt(new Vector3(1, 0, 1), up)).not.toThrow();
    expect(() => bench.upAt(new Vector3(60, 0, 0), up)).toThrow(/valid for 2\.00 m/);
  });

  it('control: how wrong that up would have been had it answered', () => {
    // The number that makes the throw above worth having. Measured, not quoted.
    const flat = flatChart('control-up-flat', new Frame(new Geo(0, PLANET_RADIUS, 0)), 400, {
      departure: flatDeparture(400),
      because: 'the control: measures the error the upAt guard now refuses to return',
    });
    const local = new Vector3(157, 0, 0);
    const g = new Geo();
    PARK_CHART.toGeo(local, g);
    const honest = g.up(new Vector3());
    const flatUp = flat.upAt(local, new Vector3());
    const degrees = (Math.acos(Math.min(1, honest.dot(flatUp))) * 180) / Math.PI;
    process.stderr.write(`[geo] a flat up at 157 m would be ${degrees.toFixed(1)}° off the real one\n`);
    expect(degrees).toBeGreaterThan(40);
  });

  it('a flat chart over the 5 cm budget cannot be declared without saying what it costs', () => {
    const anchor = () => new Frame(new Geo(0, PLANET_RADIUS, 0));
    // 4.69 m is the budget radius: just inside is silent, just outside is not.
    expect(() => flatChart('budget-inside', anchor(), 4.6)).not.toThrow();
    expect(() => flatChart('budget-outside', anchor(), 30)).toThrow(/more than the 0\.05 m budget/);
  });

  it('an accepted departure that has gone stale is a build failure, not a comment', () => {
    // The repo's commonest bug is two definitions kept in step by hand. This is
    // that shape — a signed-off number beside a chart that grew — with a check
    // behind it instead of a promise.
    expect(() =>
      flatChart('stale-acceptance', new Frame(new Geo(0, PLANET_RADIUS, 0)), 30, {
        departure: flatDeparture(21.2), // signed off when the hall was smaller
        because: 'a castle floor plate',
      }),
    ).toThrow(/accepts a departure of 1\.024 m .* really departs by 2\.055 m/);
  });

  it('a constant Field cannot be carried past the chart it claims constancy over', () => {
    // Mechanism 2 of SPHERE-DOMAIN.md section 7. A `deckY` carried along a
    // 60 m fence run is the defect; this is the type refusing to express it.
    const bench = flatChart('bench-field-under-test', new Frame(new Geo(0, PLANET_RADIUS, 0)), 2);
    const deckY = constantOver(bench, 0.45);
    const g = new Geo();
    bench.toGeo(new Vector3(0.5, 0, 0.5), g);
    expect(deckY.at(g)).toBe(0.45);
    const farAway = new Geo();
    PARK_CHART.toGeo(new Vector3(60, 0, 0), farAway);
    expect(() => deckY.at(farAway)).toThrow(/valid for/);
  });

  it('control: the same field with no chart happily lies, which is why it is named loudly', () => {
    const g = new Geo();
    PARK_CHART.toGeo(new Vector3(60, 0, 0), g);
    // `unboundedConstant` is the escape hatch, and it must stay obviously an
    // escape hatch: it answers anywhere, including 60 m away, which is exactly
    // the bug when it is used for a height.
    expect(unboundedConstant(0.45).at(g)).toBe(0.45);
  });
});

describe('Frame: there is no global yaw', () => {
  it('reproduces placeOnSphere exactly, so a call site converts with no visible change', () => {
    const wantPos = new Vector3();
    const wantQ = new Quaternion();
    const gotPos = new Vector3();
    for (const [x, z] of SAMPLE_COLUMNS) {
      for (const yaw of [0, 0.7, -2.1, Math.PI]) {
        const ground = terrainHeight(x, z);
        placeOnSphere({ x, y: ground + 1.4, z }, yaw, wantPos, wantQ);
        const at = Geo.fromWorld(x, ground, z).lift(1.4);
        const frame = Frame.fromBearing(at, yaw);
        frame.at.toWorld(gotPos);
        expect(gotPos.distanceTo(wantPos)).toBeLessThan(1e-9);
        expect(frame.q.angleTo(wantQ)).toBeLessThan(1e-6);
      }
    }
  });

  it('a frame is safe to rebuild every tick — it never reads what was there', () => {
    // `faceOnGround`'s measurement: a per-frame pre-multiply had the player
    // tumbling within a second. Building a thousand frames from the same
    // bearing must give the same orientation as building one.
    const at = Geo.fromWorld(140, terrainHeight(140, 20), 20);
    const first = Frame.fromBearing(at, 1.2);
    const repeated = new Frame();
    for (let i = 0; i < 1000; i += 1) repeated.setFromBearing(at, 1.2);
    expect(repeated.q.angleTo(first.q)).toBeLessThan(1e-12);
  });

  it('control: a pre-multiplied tilt applied repeatedly DOES tumble', () => {
    // The wrong way, measured, so the assertion above is known to be measuring
    // the difference rather than a tautology.
    const up = new Vector3();
    Geo.fromWorld(140, terrainHeight(140, 20), 20).up(up);
    const tilt = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), up);
    const tumbling = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 1.2);
    for (let i = 0; i < 5; i += 1) tumbling.premultiply(tilt);
    const upright = Frame.fromBearing(
      Geo.fromWorld(140, terrainHeight(140, 20), 20),
      1.2,
    ).q;
    const driftDegrees = (tumbling.angleTo(upright) * 180) / Math.PI;
    process.stderr.write(`[geo] control: five pre-multiplied tilts drift ${driftDegrees.toFixed(1)}°\n`);
    expect(driftDegrees).toBeGreaterThan(30);
  });

  it('forward is tangent to the ground, not to world XZ', () => {
    const at = Geo.fromWorld(157, terrainHeight(157, 0), 0);
    const frame = Frame.fromBearing(at, 0);
    const forward = frame.forward(new Vector3());
    const up = frame.up(new Vector3());
    expect(Math.abs(forward.dot(up))).toBeLessThan(1e-9);
  });
});

describe('geodesic: walking keeps the surface', () => {
  it('advance holds the radius over a long walk, and keeps the heading tangent', () => {
    const g = Geo.fromWorld(0, 0, 0);
    const start = g.radius();
    const heading = new Vector3();
    tangentTowards(g, Geo.fromWorld(1, 0, 0), heading);
    for (let i = 0; i < 2000; i += 1) advance(g, heading, 0.1);
    const up = g.up(new Vector3());
    expect(Math.abs(g.radius() - start)).toBeLessThan(1e-6);
    expect(Math.abs(heading.dot(up))).toBeLessThan(1e-9);
    expect(Math.abs(heading.length() - 1)).toBeLessThan(1e-9);
    // 200 m of walking really did go 200 m along the ground.
    expect(Geo.fromWorld(0, 0, 0).arcTo(g)).toBeCloseTo(200, 3);
  });

  it('control: the naive `position += dir * step` loses the surface, measurably', () => {
    // The thing `advance` exists to stop, with the number attached. Without
    // this control the assertion above could be passing because the planet is
    // flat rather than because the arithmetic is right.
    const naive = new Vector3(0, 0, 0);
    const dir = new Vector3(1, 0, 0);
    for (let i = 0; i < 2000; i += 1) naive.addScaledVector(dir, 0.1);
    const drift = Geo.fromWorldVector(naive).radius() - PLANET_RADIUS;
    process.stderr.write(`[geo] control: 200 m walked flat leaves the surface by ${drift.toFixed(2)} m\n`);
    expect(drift).toBeGreaterThan(50);
  });

  it('geodesicLerp stays on the surface where a straight lerp cuts through it', () => {
    const a = Geo.fromWorld(0, 0, 0);
    const b = Geo.fromWorld(150, terrainHeight(150, 0), 0);
    const mid = geodesicLerp(a, b, 0.5, new Geo());
    const lerped = new Geo().set((a.cx + b.cx) / 2, (a.cy + b.cy) / 2, (a.cz + b.cz) / 2);
    const sag = mid.radius() - lerped.radius();
    process.stderr.write(`[geo] a straight lerp over 150 m sits ${sag.toFixed(2)} m under the geodesic\n`);
    expect(sag).toBeGreaterThan(5);
    expect(Math.abs(mid.radius() - a.radius())).toBeLessThan(1.5); // waves only
  });
});

describe('ground: altitude is a difference of radii, not of ys', () => {
  it('groundRadiusToward reproduces the drawn ground to the millimetre', () => {
    let worst = 0;
    for (const [x, z] of SAMPLE_COLUMNS) {
      const onGround = Geo.fromWorld(x, terrainHeight(x, z), z);
      const up = onGround.up(new Vector3());
      worst = Math.max(worst, Math.abs(groundRadiusToward(up) - onGround.radius()));
    }
    process.stderr.write(`[geo] ground radius vs terrainHeight, worst: ${(worst * 1000).toFixed(3)} mm\n`);
    expect(worst).toBeLessThan(1e-3);
  });

  it('a point on the grass has altitude zero, everywhere', () => {
    for (const [x, z] of SAMPLE_COLUMNS) {
      expect(Math.abs(altitude(Geo.fromWorld(x, terrainHeight(x, z), z)))).toBeLessThan(1e-3);
    }
  });

  it('control: the old `y - terrainHeight` over-reads a real clearance out here', () => {
    // The arrival-camera bug, as a number. A point 10 m up along the *local*
    // up at the park's reach: the honest altitude is 10 m; the y-difference
    // says considerably more, because it is measuring against ground the point
    // is not over.
    const [x, z] = [157, 0];
    const ground = Geo.fromWorld(x, terrainHeight(x, z), z);
    const lifted = ground.clone().lift(10);
    const world = lifted.toWorld(new Vector3());
    const honest = altitude(lifted);
    const naive = world.y - terrainHeight(world.x, world.z);
    process.stderr.write(
      `[geo] control: at (${x}, ${z}) a 10 m lift reads ${honest.toFixed(2)} m honestly, ` +
        `${naive.toFixed(2)} m as a y-difference\n`,
    );
    expect(honest).toBeCloseTo(10, 2);
    expect(Math.abs(naive - 10)).toBeGreaterThan(1);
  });
});

describe('Anchor: the one translation to Cartesian', () => {
  it('puts a flat-authored child where the sphere says it should be', () => {
    const at = Geo.fromWorld(120, terrainHeight(120, -60), -60);
    const anchor = new Anchor(Frame.fromBearing(at, 0.4));
    anchor.updateMatrixWorld(true);
    const world = new Vector3();
    at.toWorld(world);
    expect(anchor.position.distanceTo(world)).toBeLessThan(1e-9);
    // Its local +Y is the local up — which is the whole reason a model with a
    // `rotateX(-PI/2)` disc in it comes out lying on the grass rather than
    // standing on edge.
    const localUp = new Vector3(0, 1, 0).applyQuaternion(anchor.quaternion);
    expect(localUp.distanceTo(at.up(new Vector3()))).toBeLessThan(1e-9);
  });

  it('setFrame assigns rather than composes, so it is safe every frame', () => {
    const at = Geo.fromWorld(100, terrainHeight(100, 0), 0);
    const frame = Frame.fromBearing(at, 0.9);
    const anchor = new Anchor();
    anchor.setFrame(frame);
    const first = anchor.quaternion.clone();
    for (let i = 0; i < 500; i += 1) anchor.setFrame(frame);
    expect(anchor.quaternion.angleTo(first)).toBeLessThan(1e-12);
  });
});

describe('a chart id is one owner, not a label', () => {
  it('refuses a second chart under an existing id', () => {
    const anchor = new Frame(new Geo(0, PLANET_RADIUS, 0));
    curvedChart('duplicate-under-test', anchor);
    expect(() => curvedChart('duplicate-under-test', anchor)).toThrow(/already registered/);
  });
});
