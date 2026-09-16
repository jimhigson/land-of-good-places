import { Quaternion, Vector3 } from 'three';
import { Geo } from './Geo';
import type { Up } from './Up';

const _up = /* @__PURE__ */ new Vector3();
const _tilt = /* @__PURE__ */ new Quaternion();
const _yaw = /* @__PURE__ */ new Quaternion();

/** The axis a yaw is a turn about, *within a frame*. Never a world direction. */
const LOCAL_UP = /* @__PURE__ */ new Vector3(0, 1, 0);

/**
 * **A place and a way round: a position plus a full orientation.**
 *
 * Half of `RADIAL-INVENTORY.md` is not about positions at all. It is about
 * things placed with a *scalar yaw* and an implied `+Y` up — `rotation.x =
 * -PI/2` on a tap marker, `rotation.y = atan2(...)` on a cart, `{ x, z, yaw }`
 * in the portal table. Every one of those is the same mistake: a single angle
 * describing an orientation in a world that no longer has a global north to
 * measure it from.
 *
 * So orientation gets a type, and **there is no global yaw.** A bearing is
 * meaningful only relative to a frame or a chart, and saying which is the whole
 * discipline. The tap marker, the hop rainbow, the highlight ring, the cart
 * pose, the tie frame, the climb pose and the bus pose retire as a class rather
 * than as seven arguments.
 *
 * ## The convention, which everything else depends on
 *
 * **`q` maps local `+Y` onto the local up at `at`.** Local `+X` and `+Z` are
 * then the tangent basis — the plane the ground lies in, at that point. A model
 * authored flat, standing along `+Y`, with its own local offsets and its own
 * `rotation.x = -PI/2` discs, is **correct without modification** once its
 * parent carries this quaternion. That is not a theory: it is the measured
 * difference between `LampPosts.ts` (correct, because `instanceAt` leans every
 * instance) and `tapMarker.ts` (wrong, because nothing downstream leans it).
 *
 * ## Why `fromBearing` is built the way it is
 *
 * `tilt * yaw`, never `yaw * tilt`. A yaw is a turn about the thing's *own* up,
 * so it must be applied first and then carried into the frame. This is the same
 * composition `terrain.ts`'s `placeOnSphere` uses, deliberately: a `Frame` built
 * from a `Geo` and a bearing reproduces today's placement to the last bit, so a
 * call site can be converted with no visible change and the diff stays honest.
 *
 * **And a per-frame tilt is never a pre-multiply.** `faceOnGround`'s docblock
 * has the measurement: a player re-oriented each tick by pre-multiplying a tilt
 * onto whatever `rotation.y =` left behind was slowly tumbling, and the first
 * screenshot of it caught her the right way up. A `Frame` is built from scratch
 * from a bearing every time and never reads what was there before, which is why
 * it is safe per-frame where `standOnSphere` is not.
 */
export class Frame {
  readonly at: Geo;
  readonly q: Quaternion;

  constructor(at: Geo = new Geo(), q: Quaternion = new Quaternion()) {
    this.at = at;
    this.q = q;
  }

  copy(other: Readonly<Frame>): this {
    this.at.copy(other.at);
    this.q.copy(other.q);
    return this;
  }

  clone(): Frame {
    return new Frame(this.at.clone(), this.q.clone());
  }

  /**
   * Stand a frame at a position, turned by `bearing` radians about its own up.
   *
   * `bearing` is a rotation within this frame and means nothing outside it —
   * that is the point of the type. Two frames at different places do not share
   * a zero, and code that assumes they do is the defect this class deletes.
   */
  setFromBearing(at: Readonly<Geo>, bearing: number): this {
    this.at.copy(at);
    at.up(_up);
    _tilt.setFromUnitVectors(LOCAL_UP, _up);
    this.q.copy(_yaw.setFromAxisAngle(LOCAL_UP, bearing)).premultiply(_tilt);
    return this;
  }

  static fromBearing(at: Readonly<Geo>, bearing: number): Frame {
    return new Frame().setFromBearing(at, bearing);
  }

  /**
   * Stand a frame at a position, facing along a world-space direction.
   *
   * The direction is projected onto the local tangent plane first, so passing
   * something with a radial component gives the sensible answer rather than a
   * lean. A direction exactly along the up has no bearing at all, and that
   * keeps whatever bearing the frame already had rather than producing a
   * `NaN` orientation.
   */
  setLookingAlong(at: Readonly<Geo>, direction: Readonly<Vector3>): this {
    this.at.copy(at);
    at.up(_up);
    _tilt.setFromUnitVectors(LOCAL_UP, _up);
    // Take the direction into the frame's own basis, drop its up component, and
    // read the bearing off the two tangent components. Doing it this way rather
    // than with an `atan2` on world x/z is the whole difference: world x/z stop
    // being the tangent plane the moment the ground leans.
    const inv = _yaw.copy(_tilt).invert();
    const local = _up.copy(direction).applyQuaternion(inv);
    if (Math.abs(local.x) < 1e-9 && Math.abs(local.z) < 1e-9) return this;
    return this.setFromBearing(at, Math.atan2(local.x, local.z));
  }

  /** The local up — a unit world-space direction, away from the planet's centre. */
  up(target: Vector3): Up {
    return this.at.up(target);
  }

  /** The direction this frame faces: its local `+Z`, in world space. */
  forward(target: Vector3): Vector3 {
    return target.set(0, 0, 1).applyQuaternion(this.q);
  }

  /** Its local `+X`, in world space. */
  right(target: Vector3): Vector3 {
    return target.set(1, 0, 0).applyQuaternion(this.q);
  }

  /**
   * **Where a world point is, as far as this frame is concerned** — the one
   * answer to *"how far in front of / beside / above the thing is that?"*.
   *
   * `x` is metres to its right, `y` metres along its own up, `z` metres in
   * front. A flat park had these for free: `y` was height, `x`/`z` were the
   * ground, and every measurement in the codebase helped itself. **Outdoors
   * none of that is true any more**, and the failures all look the same — a
   * near-zero residue where there should be an exact zero, or a plausible
   * number that is really the lean.
   *
   * The measured cases this exists for, all on the canonical seed:
   *
   * - **`check:rail-race`** reports a rider's arm **0.027 m** through the side
   *   of a cart, and her ducked body **0.53 m** below its own tub floor. The
   *   cart leans about 15°, and at that lean a plumb comparison across a 1.1 m
   *   tub manufactures a discrepancy of exactly that size. Ask this instead and
   *   the question becomes *"is her elbow outside the tub's own half-width"*,
   *   which is the question somebody meant.
   * - **The castle** (`cruiserWindow.ts`) describes itself with
   *   `world y = BUILDING_BASE_Y + localY` and `lx = x − BUILDING_CENTRE_X` —
   *   two flat formulas standing in for one rigid transform — while its mesh is
   *   leant by `placeOnSphere`. Its courtyard floor consequently spans
   *   **6.44 m** of world `y` across its own footprint, and a level route
   *   solved in that frame flies through the stonework.
   *
   * **This is the inverse of the placement, not a second opinion about it.**
   * `toWorld(toLocal(p)) === p` to the last bit, so converting a call site
   * cannot move anything; what it changes is only that the question is asked in
   * the frame the thing was built in.
   *
   * **A body's frame is not the ground's frame.** Build it with
   * {@link setFromBearing} at the body's *own* position and bearing — a cart at
   * its own place on its own lane — rather than at the ground under it, or the
   * answer is off by however far the two have leant apart.
   */
  toLocal(world: Readonly<Vector3>, target: Vector3): Vector3 {
    this.at.toWorld(_origin);
    return target.subVectors(world, _origin).applyQuaternion(_inverse.copy(this.q).invert());
  }

  /** The inverse of {@link toLocal}: a point in this frame's axes, put back into the world. */
  toWorld(local: Readonly<Vector3>, target: Vector3): Vector3 {
    this.at.toWorld(_origin);
    return target.copy(local).applyQuaternion(this.q).add(_origin);
  }
}

const _origin = /* @__PURE__ */ new Vector3();
const _inverse = /* @__PURE__ */ new Quaternion();
