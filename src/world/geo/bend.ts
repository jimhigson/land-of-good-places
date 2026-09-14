import { Object3D, Quaternion, Vector3 } from 'three';
import type { Chart } from './Chart';
import { Frame } from './Frame';
import { Geo, PLANET_RADIUS } from './Geo';
import { flatRadiusFor } from './Chart';

/**
 * **A building is not a rigid object standing at one up. Down varies across its
 * own footprint, and anything wider than a bench has to bend.**
 *
 * Jim, 13 September 2026: *"whatever 'down' is in the mesh ... needs to be
 * adjusted so that down is variable along the length ... effectively it needs to
 * be bent to cover the curvature of the earth. Just like all meshes that are not
 * tiny. Trees and flowers are fine, but buildings externals and bridges etc need
 * to bend downwards so that they use local horizontal/vertical, not a global
 * one."* And, asked directly whether the castle's four corner towers should
 * still be parallel: **they should not.**
 *
 * `terrain.ts`'s `standOnSphere` takes **one** tilt, at the group's own
 * position, and applies it to the whole group. That is exactly right for a lamp
 * post and exactly wrong for a castle: it says the tangent plane at the centre
 * is a good enough model of the ground everywhere the building touches it. On a
 * 220 m planet that claim is worth 5 cm out to **4.69 m of radius**
 * (`flatDeparture`) and nothing beyond it. A castle 24 m across is a flat
 * chart of unbounded extent asserted implicitly — the disease `Chart`'s docblock
 * names, applied to geometry instead of to coordinates.
 *
 * ## What bending actually is
 *
 * One rotation, and it is worth seeing why it is only one.
 *
 * A part authored at the structure's local `(x, y, z)` sits `d = hypot(x, z)`
 * metres away along the ground. Walking there turns the local frame by
 * `θ = d / R` about the axis perpendicular to the walk — that is the parallel
 * transport `advance` already performs on a heading, and applying the
 * *same* rotation to the whole anchor quaternion transports the entire basis
 * with it:
 *
 * - it carries the anchor's up onto the up at the arrival point, so the part
 *   stands along its own local vertical rather than the centre's;
 * - it carries the anchor's `+X`/`+Z` onto the tangent basis there, so the
 *   part's authored yaw still means the same turn about the same ground.
 *
 * So `q = R(axis, θ) · q_anchor`, and the position is the chart's own
 * exponential map. Nothing is approximated at any distance.
 *
 * ## The control, and why it is not optional
 *
 * The statement a bend makes is *"this part still points where its author meant
 * it to"*. That is checkable rather than assumable: the anchor's local direction
 * `u = (x, 0, z)/d`, carried through the bent quaternion, must come out as the
 * geodesic's own onward tangent at the arrival point. {@link bendError} returns
 * exactly that residual, in metres of arc, and the invariant asserts it. A bend
 * that silently transported the wrong basis would still *look* leaned in a
 * screenshot — every part tilted, nothing obviously wrong — and would be found
 * only by a child walking into a wall that is not where it is drawn. Measure
 * after you look, never instead.
 */

const _n = /* @__PURE__ */ new Vector3();
const _e1 = /* @__PURE__ */ new Vector3();
const _e2 = /* @__PURE__ */ new Vector3();
const _t = /* @__PURE__ */ new Vector3();
const _axis = /* @__PURE__ */ new Vector3();
const _turn = /* @__PURE__ */ new Quaternion();
const _local = /* @__PURE__ */ new Vector3();
const _world = /* @__PURE__ */ new Vector3();
const _q = /* @__PURE__ */ new Quaternion();
const _scratchFrame = /* @__PURE__ */ new Frame();
const _probe = /* @__PURE__ */ new Vector3();
const _ahead = /* @__PURE__ */ new Geo();
const _behind = /* @__PURE__ */ new Geo();

/**
 * **The largest footprint radius that may honestly stay rigid: 4.69 m.**
 *
 * Not a taste threshold — it is {@link flatRadiusFor} at 5 cm, the same number
 * `Chart`'s table prints, read from the one owner rather than typed here. A
 * bench, a lamp, a flower and a single stall are under it. A building, a wall
 * run, a bridge and a boundary are not.
 */
export const RIGID_RADIUS_LIMIT = /* @__PURE__ */ flatRadiusFor(0.05);

/**
 * The frame a part authored at `local` actually stands in, once the structure
 * bends to the planet.
 *
 * `local` is chart-local in the sense `Chart` defines: `x`/`z` are geodesic
 * displacement along the ground from the structure's centre, `y` is altitude
 * above the sphere — so a part 3 m up on a base standing 1.2 m proud of the
 * sphere passes `y = 4.2`, not `y = 3`.
 *
 * At the centre itself there is no walk and no transport, and the answer is the
 * anchor frame unchanged — which is the honest answer, not a special case
 * papering over a `normalize` of a zero vector.
 */
export function bentFrame(
  chart: Chart,
  local: Readonly<Vector3>,
  out: Frame = new Frame(),
): Frame {
  chart.toGeo(local, out.at);
  const anchor = chart.anchor;
  const d = Math.hypot(local.x, local.z);
  if (d < 1e-9 || chart.kind === 'flat') {
    out.q.copy(anchor.q);
    return out;
  }
  _n.set(0, 1, 0).applyQuaternion(anchor.q);
  _e1.set(1, 0, 0).applyQuaternion(anchor.q);
  _e2.set(0, 0, 1).applyQuaternion(anchor.q);
  // The world-space unit tangent the displacement points along, at the centre.
  _t.set(
    (_e1.x * local.x + _e2.x * local.z) / d,
    (_e1.y * local.x + _e2.y * local.z) / d,
    (_e1.z * local.x + _e2.z * local.z) / d,
  );
  _axis.crossVectors(_n, _t);
  const al = _axis.length();
  if (al < 1e-12) {
    out.q.copy(anchor.q);
    return out;
  }
  _axis.multiplyScalar(1 / al);
  out.q.copy(_turn.setFromAxisAngle(_axis, d / PLANET_RADIUS)).multiply(anchor.q);
  return out;
}

/**
 * How far, in metres of arc, a bent frame's own basis has drifted from the
 * geodesic it was transported along. Zero for a correct bend.
 *
 * **The control on {@link bentFrame}, and it is deliberately built out of
 * different parts than the thing it checks.** `bentFrame` gets its orientation
 * from one Rodrigues rotation; this gets the answer it expects from
 * `Chart.toGeo` alone — a central difference of the exponential map, two
 * points either side of the arrival, which is the onward tangent by definition
 * and touches none of the rotation algebra. An instrument sharing its subject's
 * arithmetic cannot see that arithmetic being wrong, which is how half a dozen
 * probes on this project read *wrong-but-clean* in one week.
 *
 * The residual is reported as an **arc length in metres**, not in radians, so
 * the number is one somebody can picture as ground a child would walk.
 */
export function bendError(chart: Chart, local: Readonly<Vector3>): number {
  const d = Math.hypot(local.x, local.z);
  if (d < 1e-9) return 0;
  const f = bentFrame(chart, local, _scratchFrame);
  // What the bent frame claims the authored direction now points along.
  _world.set(local.x / d, 0, local.z / d).applyQuaternion(f.q);
  // What the chart's own exponential map says it is: step a centimetre either
  // side along the same ray and difference. Central, so the truncation is
  // second order and lands far below anything a bad bend would produce.
  const h = 0.01;
  const ax = local.x / d;
  const az = local.z / d;
  _probe.set(local.x + ax * h, local.y, local.z + az * h);
  chart.toGeo(_probe, _ahead);
  _probe.set(local.x - ax * h, local.y, local.z - az * h);
  chart.toGeo(_probe, _behind);
  _t.set(_ahead.cx - _behind.cx, _ahead.cy - _behind.cy, _ahead.cz - _behind.cz);
  const tl = _t.length();
  if (tl < 1e-12) return 0;
  _t.multiplyScalar(1 / tl);
  return _world.distanceTo(_t) * PLANET_RADIUS;
}

/**
 * **Bend a structure that was assembled flat, in place, without touching its
 * tree.**
 *
 * The retrofit `standOnSphere` should have been for anything large. Every
 * exterior in this codebase is built the same way — a group, children given
 * authored local positions and yaws, one rigid tilt at the end — so this takes
 * that group as it stands and re-solves each child's transform against the
 * chart, leaving the group itself **unrotated** and every child's name, parent,
 * material and geometry exactly as they were.
 *
 * Two consequences worth stating, because both are the reason it is done this
 * way rather than by re-parenting onto `Anchor`s:
 *
 * - `parkFacts.ts` and every check that finds a mesh by name still finds it, in
 *   the same place in the tree. A bend that renamed or re-nested the castle's
 *   stonework is how `castleMasonryTopY` jumped 10.29 → 14.83 m and every seed
 *   failed while the check chain stayed honestly green.
 * - The group carries no rotation, so nothing downstream can pre-multiply a
 *   second tilt onto it. A structure is bent exactly once, by construction.
 *
 * `baseAltitude` is where the structure's own `y = 0` sits above the sphere —
 * normally the altitude of the ground under its centre — and is added to every
 * child's authored height so that `y` keeps meaning what its author meant.
 *
 * Children are read by their **authored** transform, so call this once, after
 * assembly, and never per frame.
 */
export function bendChildren(
  group: Object3D,
  chart: Chart,
  baseAltitude: number,
): void {
  group.quaternion.identity();
  group.updateMatrixWorld(true);
  const origin = group.position;
  for (const child of group.children) {
    _local.set(child.position.x, baseAltitude + child.position.y, child.position.z);
    const f = bentFrame(chart, _local, _scratchFrame);
    f.at.toWorld(_world);
    child.position.copy(_world).sub(origin);
    // The child's own authored orientation is a turn within its own frame, so
    // the frame is carried onto it rather than the other way round — the same
    // `tilt * yaw` composition `Frame.setFromBearing` uses, and for the same
    // reason.
    child.quaternion.premultiply(_q.copy(f.q));
  }
}

/**
 * Split one long child into `segments` pieces laid along the chart, each bent to
 * its own middle.
 *
 * A tower is narrow and a single bend at its foot is the whole answer. A curtain
 * wall is not: a 24 m box bent once about its centre still has its two ends
 * 16 cm into the air, because the *box* is straight however its frame leans.
 * This is the chord-versus-arc half of the same problem, and the only honest fix
 * is more pieces.
 *
 * Returns the pieces, already positioned, for the caller to add — it deliberately
 * does not add them itself, because the caller owns the naming and every check
 * on this project that finds geometry finds it by name.
 */
export function segmentsAlong(
  chart: Chart,
  from: Readonly<Vector3>,
  to: Readonly<Vector3>,
  segments: number,
  build: (index: number, length: number) => Object3D,
): Object3D[] {
  const out: Object3D[] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz) / segments;
  for (let i = 0; i < segments; i++) {
    const t = (i + 0.5) / segments;
    _local.set(from.x + dx * t, from.y + dy * t, from.z + dz * t);
    const f = bentFrame(chart, _local, _scratchFrame);
    const piece = build(i, length);
    f.at.toWorld(piece.position);
    piece.quaternion.premultiply(_q.copy(f.q));
    out.push(piece);
  }
  return out;
}

/**
 * How many segments a run of `metres` needs to stay within `tolerance` of the
 * ground it is drawn over.
 *
 * Each segment is a chord of its own arc, so its middle stands
 * `R − √(R² − (L/2)²)` proud — `flatDeparture` again, read from the one
 * owner. Solving it the other way round gives the segment length, and the count
 * is what that implies. Never fewer than one.
 */
export function segmentsFor(metres: number, tolerance = 0.05): number {
  const longest = 2 * flatRadiusFor(tolerance);
  return Math.max(1, Math.ceil(metres / longest));
}
