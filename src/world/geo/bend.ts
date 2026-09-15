import {
  Matrix4,
  Object3D,
  Quaternion,
  Vector3,
  type BufferAttribute,
  type InterleavedBufferAttribute,
} from 'three';
import type { Chart } from './Chart';
import { Frame } from './Frame';
import { Geo, PLANET_RADIUS } from './Geo';
import { chartById, curvedChart, flatRadiusFor, type ChartId } from './Chart';

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
 * exactly that residual, in metres of arc. The shipped assertion is
 * `castleTurretsKeepTheirReach` in `test/procgen/invariants.ts`, which asserts
 * the same property end to end — that a bend leaves every part at the reach its
 * plan gives it — on every seed. A bend
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
 * What a bend actually reached, so a caller can say so out loud.
 *
 * A bend that silently skipped the very thing it was asked to bend is this
 * project's signature failure — a green line implying cover it does not give.
 * So the applier counts what it touched and the caller prints it.
 */
export interface BendReport {
  /** Meshes whose vertices were displaced. */
  meshes: number;
  /** `InstancedMesh`es whose per-instance matrices were re-solved. */
  instanced: number;
  /** Individual instances within those. */
  instances: number;
  /** Objects skipped because nothing about them is bendable. */
  skipped: number;
  /** Geometries cloned because more than one mesh shared them. */
  cloned: number;
  /** The name of the object that moved furthest — for reporting a surprise. */
  worstAt: string;
  /** The largest distance, in metres, any point moved. Zero means nothing bent. */
  worstShift: number;
}

const _toRoot = /* @__PURE__ */ new Matrix4();
const _objInverse = /* @__PURE__ */ new Matrix4();
const _rootInverse = /* @__PURE__ */ new Matrix4();
const _m = /* @__PURE__ */ new Matrix4();
const _pos = /* @__PURE__ */ new Vector3();
const _scale = /* @__PURE__ */ new Vector3();
const _rot = /* @__PURE__ */ new Quaternion();
const _before = /* @__PURE__ */ new Vector3();
const _qToRoot = /* @__PURE__ */ new Quaternion();
const _qObjInv = /* @__PURE__ */ new Quaternion();

/**
 * **Bend everything under `root` onto the planet, in place, without touching
 * the tree.**
 *
 * The retrofit `standOnSphere` should have been for anything large. Every
 * exterior in this codebase is built the same way — a group, children given
 * authored local positions and yaws, one rigid tilt applied to the whole thing
 * at the end — and the explorer's map of the castle shows why re-parenting
 * children cannot be the answer here:
 *
 * - **the four corner towers are not four objects.** They are four *instances*
 *   inside `tower-bodies`, `tower-roofs`, `tower-masts` and `tower-finials`, so
 *   the splay Jim asked for lives in per-instance matrices;
 * - **the curtain walls are one merged `ExtrudeGeometry` covering all four
 *   sides.** There is no per-wall object to lean, so the only honest reading of
 *   *"the mesh needs to be bent"* is the literal one: move its vertices.
 *
 * So this reaches both. Instances get their matrix re-solved through
 * {@link bentFrame}; plain meshes get every vertex mapped through it and their
 * normals recomputed. **Names, parents, materials and object counts are all
 * untouched** — which is not a nicety: `parkFacts.ts` finds the castle's
 * stonework by the patterns `^castle-wall-` and `^tower-(bodies|roofs)$`, and a
 * bend that renamed or re-nested it is exactly how `castleMasonryTopY` once
 * jumped 10.29 → 14.83 m with the check chain staying honestly green.
 *
 * `baseAltitude` is where the structure's own `y = 0` sits above the sphere, so
 * that a part's authored height keeps meaning what its author meant.
 *
 * **Call once, after assembly, never per frame** — it reads the authored
 * geometry and overwrites it, so a second call would bend an already-bent
 * structure again.
 */
export interface BendOptions {
  /**
   * Leave this object (and its geometry) exactly as authored.
   *
   * **For geometry something else rewrites every frame.** The worked example is
   * a vertex animation: a surface whose `update()` assigns into its own position
   * buffer each tick from a stored, unbent base. A bend written into those
   * vertices is overwritten on the first frame while the stored base stays flat,
   * so it does not come out subtly wrong — it simply does not take, which is
   * worse, because the build looks like it worked.
   *
   * **Skipping is only honest when the skipped part is inside the tolerance on
   * its own** — measure it with `scripts/rigid-audit.mts` rather than asserting
   * it. An earlier version of this comment claimed the park fountain's water
   * disc "spans about 2 m, ~2 cm"; the fountain is 4.58 m and its water 4.19 m,
   * and neither number had been measured when it was written. (Both are inside
   * the 4.69 m limit, so the fountain is left rigid entirely and this option is
   * not used for it.) If a part that needs the bend is being skipped, the answer
   * is to make its animation bend-aware, not to skip it.
   */
  skip?(object: Object3D): boolean;
}

export function bendOntoPlanet(
  root: Object3D,
  chart: Chart,
  baseAltitude: number,
  options: BendOptions = {},
): BendReport {
  const report: BendReport = {
    meshes: 0,
    instanced: 0,
    instances: 0,
    skipped: 0,
    cloned: 0,
    worstAt: '',
    worstShift: 0,
  };
  // **`updateWorldMatrix(true, true)`, not `updateMatrixWorld(true)`** — the
  // first argument is what updates the ANCESTORS, and without it this reads a
  // stale parent.
  //
  // `updateMatrixWorld(true)` recomputes the subtree from `parent.matrixWorld`
  // as it currently stands, and at the moment a structure is bent that is
  // routinely out of date: `standInPlot` writes `gardenRoot`'s local transform
  // *after* its last world update, so the castle's own `matrixWorld` was being
  // composed against a parent that had not yet moved. Every bent point then
  // came out offset by the parent's staleness — measured on the castle, a
  // uniform 4.59 m, which turned four symmetric turret instances into
  // (-15.915, -6.361), (9.160, -6.358), (-15.913, 12.561), (9.162, 12.564)
  // where the authored positions are (±12.225, ±9.225).
  //
  // The tell was in `BendReport` all along: `worstShift` read **6.005 m** for a
  // structure whose widest honest bend is about half a metre, and it was
  // explained away rather than read.
  root.updateWorldMatrix(true, true);
  _rootInverse.copy(root.matrixWorld).invert();

  // **A geometry shared by two meshes cannot be bent.** The bend is a function
  // of *where a vertex is*, so one buffer serving two meshes standing in two
  // places has no single right answer — and bending it once per mesh compounds,
  // which is how the castle's worst vertex shift read 6.0 m instead of 0.6 m
  // when the facade's builders turned out to reuse geometries. Counted first,
  // then cloned per mesh, so each copy is bent exactly once against its own
  // position. Cloning is the only correct answer available; the alternative is
  // silently drawing one of the two in the wrong shape.
  const uses = new Map<object, number>();
  root.traverse((object) => {
    if (options.skip?.(object) || asInstanced(object)) return;
    const geometry = asGeometryHolder(object);
    if (geometry) uses.set(geometry, (uses.get(geometry) ?? 0) + 1);
  });
  root.traverse((object) => {
    if (options.skip?.(object) || asInstanced(object)) return;
    const holder = object as unknown as { geometry?: GeometryLike & { clone?(): GeometryLike } };
    const geometry = holder.geometry;
    if (!geometry || (uses.get(geometry) ?? 0) < 2) return;
    if (typeof geometry.clone === 'function') {
      holder.geometry = geometry.clone();
      report.cloned += 1;
    }
  });

  let shiftOwner = '';
  const shift = (a: Readonly<Vector3>, b: Readonly<Vector3>): void => {
    const d = a.distanceTo(b);
    if (d > report.worstShift) {
      report.worstShift = d;
      report.worstAt = shiftOwner;
    }
  };

  root.traverse((object) => {
    if (options.skip?.(object)) {
      report.skipped += 1;
      return;
    }
    // Object-local -> root-local, and back. Composing through the root rather
    // than through world coordinates is what lets the whole structure keep
    // sitting inside whatever leaning plot already carries it: the rigid tilt
    // above the root cancels out of both directions exactly.
    _objInverse.copy(object.matrixWorld).invert();
    _toRoot.multiplyMatrices(_rootInverse, object.matrixWorld);
    _qToRoot.copy(rotationOf(_toRoot));
    _qObjInv.copy(rotationOf(_objInverse));

    shiftOwner = object.name || object.type;
    const instanced = asInstanced(object);
    if (instanced) {
      for (let i = 0; i < instanced.count; i++) {
        instanced.getMatrixAt(i, _m);
        _m.decompose(_pos, _rot, _scale);
        _before.copy(_pos);
        _pos.applyMatrix4(_toRoot);
        _local.set(_pos.x, baseAltitude + _pos.y, _pos.z);
        const f = bentFrame(chart, _local, _scratchFrame);
        f.at.toWorld(_world);
        // Into the instance's own space, and carry the frame onto the
        // instance's authored orientation rather than the other way round.
        _pos.copy(_world).applyMatrix4(_objInverse);
        // World orientation is the bent frame carried onto the instance's own
        // authored turn, read in the flat frame the author wrote it in:
        //   world = f.q * rot(toRoot) * authored
        // and then back into the instance's own space. Composing it in this
        // order is the same `tilt * yaw` rule `Frame.setFromBearing` states —
        // a yaw is a turn about the thing's *own* up, so it is applied first.
        _rot.premultiply(_qToRoot).premultiply(_q.copy(f.q)).premultiply(_qObjInv);
        shift(_before, _pos);
        instanced.setMatrixAt(i, _m.compose(_pos, _rot, _scale));
        report.instances += 1;
      }
      instanced.instanceMatrix.needsUpdate = true;
      instanced.computeBoundingSphere();
      report.instanced += 1;
      return;
    }

    const geometry = asGeometryHolder(object);
    if (!geometry) {
      report.skipped += 1;
      return;
    }
    const attribute = geometry.getAttribute('position');
    if (!attribute) {
      report.skipped += 1;
      return;
    }
    for (let i = 0; i < attribute.count; i++) {
      _pos.fromBufferAttribute(attribute, i);
      _before.copy(_pos);
      _pos.applyMatrix4(_toRoot);
      _local.set(_pos.x, baseAltitude + _pos.y, _pos.z);
      const f = bentFrame(chart, _local, _scratchFrame);
      f.at.toWorld(_world);
      _pos.copy(_world).applyMatrix4(_objInverse);
      shift(_before, _pos);
      attribute.setXYZ(i, _pos.x, _pos.y, _pos.z);
    }
    attribute.needsUpdate = true;
    // The extrusions and boxes this runs over are non-indexed, so recomputing
    // gives a flat normal per face — which is what masonry wants, and is also
    // the only answer available once the vertices no longer lie in the planes
    // the authored normals described.
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    report.meshes += 1;
  });

  return report;
}

const _rotationScratch = /* @__PURE__ */ new Quaternion();
const _rotationMatrix = /* @__PURE__ */ new Matrix4();

/** The rotation half of a matrix, as a quaternion, with translation and scale dropped. */
function rotationOf(m: Matrix4): Quaternion {
  _rotationMatrix.extractRotation(m);
  return _rotationScratch.setFromRotationMatrix(_rotationMatrix);
}

interface InstancedLike {
  readonly isInstancedMesh: true;
  readonly count: number;
  readonly instanceMatrix: { needsUpdate: boolean };
  getMatrixAt(index: number, matrix: Matrix4): void;
  setMatrixAt(index: number, matrix: Matrix4): void;
  computeBoundingSphere(): void;
}

function asInstanced(object: Object3D): InstancedLike | undefined {
  const candidate = object as unknown as Partial<InstancedLike>;
  return candidate.isInstancedMesh === true ? (candidate as InstancedLike) : undefined;
}

interface GeometryLike {
  getAttribute(name: string): BufferAttribute | InterleavedBufferAttribute | undefined;
  computeVertexNormals(): void;
  computeBoundingSphere(): void;
  computeBoundingBox(): void;
}

function asGeometryHolder(object: Object3D): GeometryLike | undefined {
  const candidate = (object as unknown as { geometry?: GeometryLike }).geometry;
  return candidate && typeof candidate.getAttribute === 'function' ? candidate : undefined;
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

const _anchorAt = /* @__PURE__ */ new Geo();
const _anchorPos = /* @__PURE__ */ new Vector3();
const _anchorQuat = /* @__PURE__ */ new Quaternion();
const _anchorUp = /* @__PURE__ */ new Vector3();
const _anchorRadial = /* @__PURE__ */ new Vector3();

/**
 * **Bend a structure that has already been stood on the sphere, deriving its
 * chart from where it actually is.**
 *
 * The integration point, and it exists so that the one thing a caller can most
 * easily get wrong is not a thing a caller has to do at all. Both of this
 * module's probe bugs were the same mistake in the chart's anchor:
 *
 * - **the anchor frame must be the structure's own rigid frame, bearing and
 *   all.** Built from a minimal `+Y`-to-up tilt instead, it drops the
 *   structure's yaw and the "bend" comes out as a 6.2 m re-yaw of the whole
 *   castle;
 * - **`local.y` is an altitude above `PLANET_RADIUS`, not above the ground.**
 *   An anchor left at some other radius floats the structure by the difference,
 *   which read as a 45 m gap the first time this was measured.
 *
 * Reading both straight off `root.matrixWorld` — which is exactly what
 * `standInPlot`'s `placeOnSphere` put there — makes both unaskable. Call it
 * after the structure is assembled *and* placed.
 *
 * A chart id is one owner, not a label, so a rebuild (a new seed, a new park)
 * re-aims the existing chart rather than registering a second one under the same
 * name — which `Chart`'s registry would rightly refuse.
 */
export function bendPlacedStructure(
  root: Object3D,
  id?: ChartId,
  options: BendOptions = {},
): BendReport {
  // Ancestors too — see `bendOntoPlanet`. The chart is read off `matrixWorld`
  // here, so a stale parent puts the chart itself in the wrong place.
  root.updateWorldMatrix(true, true);
  root.getWorldPosition(_anchorPos);
  root.getWorldQuaternion(_anchorQuat);
  _anchorAt.setFromWorldVector(_anchorPos);

  // **The root must already be standing on the sphere, and this refuses to
  // guess.** The chart's whole basis is read off `root`'s world quaternion, so
  // a root carrying only a yaw hands over an up of world `+Y`; the chart origin
  // then lands wherever that direction meets the planet, and the structure is
  // drawn there instead of where it belongs. That is not subtle — the gate arch
  // was moved **148 m**, to the park's centre, leaving its own pier colliders at
  // the gateway — but it is silent, because every individual transform is
  // well-formed and nothing renders an error.
  //
  // So it is a precondition with a mechanism behind it rather than a comment.
  // `standOnSphere` (or `standInPlot`, or `placeOnSphere`) is what puts the
  // radial into that quaternion, and must run first.
  _anchorUp.set(0, 1, 0).applyQuaternion(_anchorQuat);
  _anchorRadial.set(_anchorAt.cx, _anchorAt.cy, _anchorAt.cz).normalize();
  const lean = Math.acos(Math.min(1, Math.max(-1, _anchorUp.dot(_anchorRadial))));
  if (lean > 0.02) {
    throw new Error(
      `bendPlacedStructure: "${root.name || root.type}" is not standing on the sphere — ` +
        `its own up is ${((lean * 180) / Math.PI).toFixed(2)}° from the radial at its position, ` +
        `which would put its chart origin about ${(lean * PLANET_RADIUS).toFixed(1)} m away and ` +
        'draw the whole structure there. Call standOnSphere/standInPlot on it first.',
    );
  }

  const baseAltitude = _anchorAt.radius() - PLANET_RADIUS;
  const chart = id === undefined ? scratchChart() : (chartById(id) ?? curvedChart(id, new Frame()));
  chart.anchor.at.copy(_anchorAt);
  chart.anchor.q.copy(_anchorQuat);
  return bendOntoPlanet(root, chart, baseAltitude, options);
}

let _scratchChart: Chart | undefined;

/**
 * **The chart for a structure nothing else refers to — a single fence run, one
 * stone bench — re-aimed per call.**
 *
 * A chart id is *one owner*, not a label, and `Chart`'s registry rightly refuses
 * a second chart under the same name. The castle and the hotel deserve named
 * charts: other code asks about them, and `allCharts()` should be able to sweep
 * them. Thirty-odd wall runs do not — their frames are ephemeral, used once
 * inside `bendPlacedStructure` and never referred to again, and registering one
 * each would fill the registry with names no one will ever look up while
 * saying, falsely, that each is a coordinate system somebody owns.
 *
 * Safe to share because it is used and finished with synchronously: the bend
 * reads the anchor and returns before anything can re-aim it. Give a structure
 * its own id the moment anything outside its builder needs to name its frame.
 */
function scratchChart(): Chart {
  _scratchChart ??= curvedChart('bend-scratch', new Frame());
  return _scratchChart;
}
