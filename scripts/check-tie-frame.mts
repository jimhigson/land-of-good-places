/**
 * **Do the Sky Cruiser's ties actually bridge both rails?** The regression
 * guard for the tie-roll bug (#112 — "the sleeper bug").
 *
 * ```
 * npm run check:tie-frame
 * ```
 *
 * `Coaster.ts` used to orient each tie with
 * `rotation.setFromUnitVectors(new Vector3(0, 0, 1), forward)` — the
 * *minimal* rotation onto the track's tangent. That pins the tie's
 * along-track axis to `forward` but leaves its long (bridging) axis free to
 * roll about whatever axis the minimal rotation happens to pick, which on
 * any climbing or descending stretch (almost the whole ride) is not
 * horizontal. The rails themselves are offset with a strictly **horizontal**
 * side vector (`world/rail/sweptRail.ts`'s `sideX = along.z, sideZ =
 * -along.x`) — deliberately never rolled, because no track in this park
 * banks — so the old tie code and the rails disagreed about which way was
 * sideways, and the ties drifted off the rails wherever the track had any
 * pitch.
 *
 * The fix makes the tie's rotation come from `railFrameAt`, the same
 * horizontal `side`/`up`/`forward` frame the rails are swept with (see that
 * file's header). This script does not re-derive that claim from the rules —
 * it builds the **real** Sky Cruiser headlessly (`park-harness.mts`, the
 * `check-park.mts` precedent), reads the real `ties` `InstancedMesh` off it,
 * and for every tie computes where its rail-gauge points (`±RAIL_GAUGE/2`
 * out along its own local X) actually land in world space. That is compared
 * against the rail centre line computed independently, straight from
 * `railFrameAt` at the tie's own distance along the route — the same
 * function the rails themselves are offset with, so a passing tie is
 * provably sitting where the rail is, not just close by construction.
 *
 * Comparison is 3-D (not just horizontal): the tie is deliberately dropped
 * 0.12 m below the rail centre line **along that frame's own up**
 * (`Coaster.ts`: `addScaledVector(frame.up, -0.12)`, so the rail visually rests
 * on top of the sleeper), and the expected point below accounts for exactly
 * that offset, so the epsilon only has to cover real geometric slop, not the
 * ride's own art direction.
 *
 * Mutation-tested 1 August 2026: reverting the fix (going back to
 * `setFromUnitVectors`) fails this check — see HANDOFF-tie-frame-fix.md for
 * the measured before/after.
 *
 * **Re-proved red 16 September 2026, on the sphere.** Two mutations, both on
 * the canonical seed of `feat/sphere-combined` (geometry: 287 ties on a 286.3 m
 * loop whose flat and drawn frames diverge by up to 10.07 m):
 *
 * - putting `Coaster.ts`'s tie drop back to the plumb `setY(mid.y - 0.12)` →
 *   **worst deviation 184.5 mm** at s=77.0 m, past the 50 mm epsilon;
 * - reverting the tie's basis to `setFromUnitVectors` → **1099.9 mm** at s=189.0 m, the
 *   original #112 sleeper bug, still caught.
 *
 * Keep that geometry with the numbers: a later change that moves the loop moves
 * both figures, and a replacement re-running these against a different park
 * would reasonably conclude the check had rotted.
 */
import './headless-canvas.mjs';
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { RAIL_GAUGE, TIE_STEP } from '../src/world/coaster/Coaster.ts';
import { drawnOnSphere, railFrameAt, type RailFrame } from '../src/world/rail/sweptRail.ts';
import { upFor } from '../src/world/up.ts';
import { SLEEPER_SPACING } from '../src/world/railRace/trestleGeometry.ts';
import type { RailRaceRoute } from '../src/world/railRace/route.ts';

// How far a tie's rail-gauge point may sit from the rail centre line it is
// meant to be bolted to. The rails' own sweep is not perfectly on the
// analytic centre line either — a Catmull-Rom fit through samples 0.45 m
// apart, documented in `Coaster.ts` as straying up to ~20 mm — so this
// leaves comfortable headroom above that while remaining far below what the
// roll bug actually produced (tens of centimetres to over a metre on this
// route's steeper climbs; see the mutation-test numbers in the handoff).
const EPSILON_M = 0.05;

const park = buildHeadlessPark();
const coaster = park.world.coaster;

/**
 * **The route as the ties are actually built on, not the one the ride is solved
 * in.**
 *
 * `Coaster.buildTrack` wraps its route in `drawnOnSphere` before it lays a
 * single tie — the ride is *solved* in the flat frame the park is authored in
 * and *drawn* leant onto the sphere, and those two are a long way apart out
 * here: measured on the canonical seed, up to **10.07 m** at s=127 m. Asking
 * `railFrameAt` for the unleant route and comparing it against the leant ties
 * this check reads off the real `InstancedMesh` reported a worst deviation of
 * **10419.0 mm** — a check measuring one track against a different one.
 */
const drawn = drawnOnSphere(coaster.route);

const ties = coaster.group.children.find(
  (child): child is InstancedMesh => child.name === 'ties',
);
if (!ties) {
  console.error('check:tie-frame — no "ties" InstancedMesh found on the Sky Cruiser group.');
  process.exit(1);
}

const halfGauge = RAIL_GAUGE / 2;
const instanceMatrix = new Matrix4();
const position = new Vector3();
const quaternion = new Quaternion();
const scale = new Vector3();
const localPoint = new Vector3();
const actual = new Vector3();

const frame: RailFrame = {
  position: new Vector3(),
  forward: new Vector3(),
  side: new Vector3(),
  up: new Vector3(),
};
const expected = new Vector3();

let worstDeviation = 0;
let worstAt = 0;
let worstSide = 0;
let checked = 0;

for (let i = 0; i < ties.count; i += 1) {
  ties.getMatrixAt(i, instanceMatrix);
  instanceMatrix.decompose(position, quaternion, scale);

  const d = i * TIE_STEP;
  railFrameAt(drawn, d, frame);

  for (const side of [1, -1] as const) {
    // Where the tie itself says its rail-gauge point is: its own local X
    // axis (the long, bridging axis), rotated and translated exactly as the
    // real InstancedMesh instance is.
    localPoint.set(side * halfGauge, 0, 0).applyMatrix4(instanceMatrix);
    actual.copy(localPoint);

    // Where the rail centre line actually is at this same distance,
    // computed independently via the same horizontal convention the rails
    // are swept with — not read back off the tie.
    expected.copy(frame.position).addScaledVector(frame.side, side * halfGauge);
    // The tie's own deliberate drop below rail height, **along the frame's own
    // up**. It was `expected.y -= 0.12`, a plumb drop — which agreed with
    // `Coaster.ts`'s own `setY(mid.y - 0.12)` only because both were wrong the
    // same way, and stopped agreeing with the *rails*, which are offset along
    // the whole leaning `side`.
    expected.addScaledVector(frame.up, -0.12);

    const deviation = actual.distanceTo(expected);
    checked += 1;
    if (deviation > worstDeviation) {
      worstDeviation = deviation;
      worstAt = d;
      worstSide = side;
    }
  }
}

console.log(
  `check:tie-frame — ${ties.count} ties, ${checked} rail-gauge points checked, ` +
    `worst deviation ${(worstDeviation * 1000).toFixed(1)} mm ` +
    `(at s=${worstAt.toFixed(1)} m, ${worstSide > 0 ? 'left' : 'right'} rail), ` +
    `epsilon ${(EPSILON_M * 1000).toFixed(0)} mm`,
);

if (worstDeviation > EPSILON_M) {
  console.error(
    `check:tie-frame: FAIL — a tie's rail-gauge point strayed ${(worstDeviation * 1000).toFixed(1)} mm ` +
      `from the rail centre line, past the ${(EPSILON_M * 1000).toFixed(0)} mm epsilon. ` +
      'Ties are rolling off horizontal — see Coaster.ts\'s tie placement and ' +
      'world/rail/sweptRail.ts\'s railFrameAt.',
  );
  process.exit(1);
}

// --- and the cart sits square on the same rails ------------------------------
//
// **The heading's composition, measured where it shows.** The cart is turned by
// `rideFrame` — a lean about its flat column, then a yaw and a pitch composed by
// `world/headingTurn.ts`. For a year that composition was a default `XYZ`
// euler: the pitch taken about **world** X, which on a heading of 90° is a roll.
// On this loop's climbs that put the nose off the rails and rolled the tub; #680
// fixed the rider's half of the same euler and not this one, and the Rail Race
// came apart. So: every 0.5 m of the loop, the real `Coaster.placeCart`, and the
// cart's nose and up against the rails as drawn — a finite difference of the
// leant route, and the up square to it and to the rails' own side.
//
// Proved on the canonical seed (loop 288 m): with the cart on `rideFrame` and
// the heading composed `XYZ`, nose 29.37° / up 40.64° off; composed `YXZ`, up
// right but nose 17.25° off at s=63 m, because `rideFrame` leans a flat tangent
// that already runs along the drawn rails (0.26° apart). **`drawnOnSphere`'s
// own `tangentAt` has the same double lean**, and `railFrameAt` — so the ties —
// inherit it: a tie is pitched up to 17° about its long axis here. That is not
// this clause's to fix, and the gauge points above do not see it.
{
  /**
   * The cart against its rails, in degrees. The flat heading is carried onto
   * the sphere by the tilt at one column, while the drawn rail also feels the
   * tilt *changing* along it — arc/R, about 0.07° per half-metre on a 400 m
   * sphere, plus the Catmull-Rom's own sag (the ~20 mm above over a 0.45 m
   * sample spacing, ~2.5°/m at worst in curvature, not direction). A degree is
   * room for that and a fraction of what a mis-composed pitch does on a climb.
   */
  const CART_ON_RAILS_DEGREES = 1;
  const rig = coaster as unknown as { distance: number; placeCart(): void; cart: import('three').Object3D };
  const nose = new Vector3();
  const up = new Vector3();
  const ahead = new Vector3();
  const behind = new Vector3();
  const railFrame: RailFrame = { position: new Vector3(), forward: new Vector3(), side: new Vector3(), up: new Vector3() };
  const worldTurn = new Quaternion();
  const railUp = new Vector3();
  let worstNose = { value: 0, at: 0 };
  let worstUp = { value: 0, at: 0 };
  let stations = 0;
  const saved = rig.distance;
  for (let d = 0; d < coaster.route.length; d += 0.5) {
    rig.distance = d;
    rig.placeCart();
    rig.cart.updateWorldMatrix(true, false);
    rig.cart.getWorldQuaternion(worldTurn);
    nose.set(0, 0, 1).applyQuaternion(worldTurn);
    // flat-ok: the cart's own local up, carried into the world by its quaternion
    up.set(0, 1, 0).applyQuaternion(worldTurn);
    drawn.pointAt(coaster.route.wrap(d + 0.05), ahead);
    drawn.pointAt(coaster.route.wrap(d - 0.05), behind);
    railFrameAt(drawn, d, railFrame);
    const along = ahead.sub(behind).normalize();
    const noseOff = (nose.angleTo(along) * 180) / Math.PI;
    // Square to the rails: perpendicular to the way they run AND to the way
    // they are spread apart. Not `railFrame.up`, which is built on
    // `drawnOnSphere`'s `tangentAt` — the flat tangent turned by the tilt — and
    // that is pitched up to 17° off the drawn rails here (see the note below).
    const squareUp = railUp.crossVectors(along, railFrame.side).normalize();
    const upOff = (up.angleTo(squareUp) * 180) / Math.PI;
    if (noseOff > worstNose.value) worstNose = { value: noseOff, at: d };
    if (upOff > worstUp.value) worstUp = { value: upOff, at: d };
    stations += 1;
  }
  rig.distance = saved;
  rig.placeCart();
  console.log(
    `check:tie-frame — the cart at ${stations} stations: nose worst ${worstNose.value.toFixed(2)}° ` +
      `off the drawn rails (s=${worstNose.at.toFixed(1)} m), up worst ${worstUp.value.toFixed(2)}° off ` +
      `the rails' up (s=${worstUp.at.toFixed(1)} m), allowed ${CART_ON_RAILS_DEGREES}°`,
  );
  if (!(stations > 0) || !Number.isFinite(worstNose.value) || !Number.isFinite(worstUp.value)) {
    console.error('check:tie-frame: FAIL — the cart sweep measured nothing, or measured NaN.');
    process.exit(1);
  }
  if (worstNose.value > CART_ON_RAILS_DEGREES || worstUp.value > CART_ON_RAILS_DEGREES) {
    console.error(
      `check:tie-frame: FAIL — the Sky Cruiser's cart sits ${Math.max(worstNose.value, worstUp.value).toFixed(2)}° ` +
        `off its own rails, past ${CART_ON_RAILS_DEGREES}°. If the pitch is being composed about the ` +
        "world's X rather than the yawed one, `world/headingTurn.ts` is being bypassed — it is the one " +
        'owner of how a yaw and a pitch become a turn.',
    );
    process.exit(1);
  }
}

// --- and every sleeper lies square to the rails as DRAWN, on both rides -------
//
// The gauge-point clause above reads each tie's two ends against `railFrameAt`
// — the same function that placed it — so it can only ever say the tie is where
// its own frame put it. It cannot see a frame that is wrong. And one was:
// `drawnOnSphere`'s `tangentAt` turned the flat tangent by the sphere's tilt,
// and the flat tangent already runs where the drawn rails do, so it leant twice
// and the Sky Cruiser's sleepers were tipped up to 17° against their rails; the
// Rail Race laid its sleepers along the route's *chart* tangent, up to ~14° off
// the rails drawn over them. So this measures each sleeper's own axes, off the
// real `InstancedMesh`, against the rails' direction taken independently — a
// finite difference of the drawn points, never a `tangentAt` — and the up
// square to that and to the local ground.
{
  /**
   * A sleeper against its rails, in degrees. The difference is ±5 cm about each
   * sleeper, on bends no tighter than the Rail Race's 53.5 m ring or the Sky
   * Cruiser's solved minimum, so its own error is hundredths of a degree; a
   * degree is room for that and a small fraction of the misalignments above.
   */
  const SLEEPER_ON_RAILS_DEGREES = 1;
  const STEP = 0.05;
  const along = new Vector3();
  const ahead = new Vector3();
  const behind = new Vector3();
  const localUp = new Vector3();
  const side = new Vector3();
  const squareUp = new Vector3();
  const tieZ = new Vector3();
  const tieY = new Vector3();
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const sc = new Vector3();
  type Worst = { value: number; where: string };
  const measure = (
    mesh: InstancedMesh,
    locate: (i: number) => { at: number; pointAt: (d: number, t: Vector3) => Vector3; where: string },
  ): { worst: Worst; count: number } => {
    let worst: Worst = { value: 0, where: '' };
    for (let i = 0; i < mesh.count; i += 1) {
      mesh.getMatrixAt(i, m);
      m.decompose(p, q, sc);
      tieZ.set(0, 0, 1).applyQuaternion(q);
      // flat-ok: the sleeper's own local up, carried into the world by its turn
      tieY.set(0, 1, 0).applyQuaternion(q);
      const { at, pointAt, where } = locate(i);
      pointAt(at + STEP, ahead);
      pointAt(at - STEP, behind);
      along.subVectors(ahead, behind).normalize();
      upFor(p.x, p.y, p.z, localUp);
      side.crossVectors(localUp, along).normalize();
      squareUp.crossVectors(along, side).normalize();
      // The sleeper runs across the track, so its own +Z is along it.
      const off = (Math.max(tieZ.angleTo(along), tieY.angleTo(squareUp)) * 180) / Math.PI;
      if (off > worst.value) worst = { value: off, where };
    }
    return { worst, count: mesh.count };
  };

  const cruiser = measure(ties, (i) => ({
    at: i * TIE_STEP,
    pointAt: (d, t) => drawn.pointAt(coaster.route.wrap(d), t),
    where: `Sky Cruiser s=${(i * TIE_STEP).toFixed(1)} m`,
  }));

  const race = (park.world.railRace as unknown as {
    raceRing: { route: RailRaceRoute; track: { group: import('three').Object3D } };
    walkPastRing: { route: RailRaceRoute; track: { group: import('three').Object3D } };
  });
  const rings = [
    { name: 'race ring', ring: race.raceRing },
    { name: 'walk-past ring', ring: race.walkPastRing },
  ];
  const results = [{ name: 'Sky Cruiser', ...cruiser }];
  for (const { name, ring } of rings) {
    const sleepers = ring.track.group.getObjectByName('railRace:sleepers') as InstancedMesh | undefined;
    if (!sleepers) {
      console.error(`check:tie-frame: FAIL — no railRace:sleepers on the ${name}; the sleeper clause is VOID.`);
      process.exit(1);
    }
    const route = ring.route;
    const perLane = Math.floor(route.length / SLEEPER_SPACING);
    results.push({
      name: `Rail Race ${name}`,
      ...measure(sleepers, (i) => {
        const lane = Math.floor(i / perLane);
        const at = (i % perLane) * SLEEPER_SPACING;
        return {
          at,
          pointAt: (d, t) => route.pointAt(lane, route.wrap(d), t),
          where: `lane ${lane} s=${at.toFixed(1)} m`,
        };
      }),
    });
  }
  let failed = false;
  for (const r of results) {
    console.log(
      `check:tie-frame — ${r.name}: ${r.count} sleepers, worst ${r.worst.value.toFixed(2)}° off the ` +
        `drawn rails (${r.worst.where}), allowed ${SLEEPER_ON_RAILS_DEGREES}°`,
    );
    if (!(r.count > 0) || !Number.isFinite(r.worst.value)) failed = true;
    else if (r.worst.value > SLEEPER_ON_RAILS_DEGREES) failed = true;
  }
  if (failed) {
    console.error(
      'check:tie-frame: FAIL — a sleeper is turned off the rails drawn over it (or none was measured). ' +
        "Its frame comes from `railFrameAt`, whose forward is the sampler's `tangentAt`; that has to be " +
        'the direction the rails are drawn in — `rail/sweptRail.ts`\'s `drawnDirection` — not a flat or ' +
        'chart tangent turned onto the sphere.',
    );
    process.exit(1);
  }
}

console.log('tie frame: every tie sits on both rails, within epsilon.');
