import { Vector3 } from 'three';
import { GROUND_SPHERE_RADIUS } from '../../core/constants';

/**
 * **A position is a 3-vector from the centre of the planet. Nothing else is a
 * position.**
 *
 * Jim, 14 September 2026: *"ALL rendering and ALL geometry is to be done using
 * a layer to translate to orthogonal co-ordinates (from the radial space) only
 * as the last step, while absolutely everything is calculated on a sphere."*
 * This class is the radial space. `SPHERE-DOMAIN.md` is the design.
 *
 * ## The one fact that makes the migration cheap, and it is worth reading twice
 *
 * **World space and planet-centred space differ by a pure translation of
 * `(0, +GROUND_SPHERE_RADIUS, 0)`. No rotation. No scale.** The ground cap is
 * tangent to horizontal at the park's origin, so the planet's centre is exactly
 * `(0, -220, 0)` in the coordinates every existing line of this codebase is
 * written in — see `terrain.ts`'s `planetRadiusAt`, which has been quietly
 * asserting this since the arrival-camera fix.
 *
 * Three consequences, and they are the whole reason four engineers can migrate
 * four subsystems at once without a big-bang switch:
 *
 * - **Directions, normals and quaternions are identical in both spaces.** A
 *   `Vector3` that is a *direction* needs no conversion, ever. Only *positions*
 *   move. So `up()` below returns a plain `Vector3` and it is directly usable
 *   as a world direction — that is not a convenience, it is the geometry.
 * - **`fromWorld` / `toWorld` are exact and lossless**, one add each. A
 *   subsystem can convert at its boundary and reason in `Geo` inside, while its
 *   callers still speak world coordinates. That is the migration.
 * - **Distances are identical in both spaces**, because a translation preserves
 *   them. A `chordTo` is the same number as the old `Vector3.distanceTo`.
 *
 * ## Why the components are named `cx`, `cy`, `cz` and not `x`, `y`, `z`
 *
 * Deliberately, and this is the single highest-leverage decision in the file.
 * `RADIAL-INVENTORY.md` catalogues ~95 defect sites, and **every one of them is
 * one of exactly two mistakes**: a `y` difference standing in for a distance,
 * or a world `+Y` axis standing in for a local up. If `Geo` had an `x`/`y`/`z`
 * it would be one keystroke from a `Vector3`, and `geo.y - other.y` would
 * compile, mean nothing, and be wrong by up to a factor of 1.4 at the park's
 * reach — which is exactly the bug the inventory is a list of.
 *
 * `cy` is a *component of a vector from the centre of a planet*. It is not a
 * height and there is no operation in this codebase for which it is the right
 * number on its own. Height is {@link altitude}, which is a function call, and
 * that is the point. `geo.y` is now a type error rather than a silent wrong
 * answer, and the category is deleted rather than the instances.
 *
 * ## Mutable, with out-parameters, on purpose
 *
 * Collision resolves thousands of times a frame and `Collision.ts` has no
 * spatial index. `Geo` is therefore shaped exactly like three.js's `Vector3` —
 * mutable, chainable, every method taking a `target` where it returns one — so
 * that the sphere costs no allocation the flat park did not already cost.
 */
export class Geo {
  /**
   * Metres from the planet's centre, along the world X axis.
   * Not a position on its own; see the class docblock.
   */
  cx: number;
  /**
   * Metres from the planet's centre, along the world Y axis.
   * **Not a height.** {@link altitude} is the height.
   */
  cy: number;
  /**
   * Metres from the planet's centre, along the world Z axis.
   * Not a position on its own; see the class docblock.
   */
  cz: number;

  constructor(cx = 0, cy = 0, cz = 0) {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
  }

  set(cx: number, cy: number, cz: number): this {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    return this;
  }

  copy(other: Readonly<Geo>): this {
    this.cx = other.cx;
    this.cy = other.cy;
    this.cz = other.cz;
    return this;
  }

  clone(): Geo {
    return new Geo(this.cx, this.cy, this.cz);
  }

  /**
   * Read a position written in today's world coordinates.
   *
   * The one and only place the `(0, -R, 0)` offset is applied on the way in.
   * Exact: no rotation, no scale, no approximation, and `toWorld` inverts it to
   * the last bit.
   */
  setFromWorld(x: number, y: number, z: number): this {
    return this.set(x, y + GROUND_SPHERE_RADIUS, z);
  }

  setFromWorldVector(v: { readonly x: number; readonly y: number; readonly z: number }): this {
    return this.setFromWorld(v.x, v.y, v.z);
  }

  static fromWorld(x: number, y: number, z: number): Geo {
    return new Geo().setFromWorld(x, y, z);
  }

  static fromWorldVector(v: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  }): Geo {
    return new Geo().setFromWorldVector(v);
  }

  /**
   * Write this position out in today's world coordinates — the translation
   * Jim's ruling calls "the last step".
   *
   * Prefer an {@link Anchor} to calling this by hand. An `Anchor` is this
   * conversion done once, at scene-graph attachment, with the orientation
   * attached to it; a bare `toWorld` gives you a position and leaves the
   * orientation for you to get wrong, which is the other half of the inventory.
   */
  toWorld(target: Vector3): Vector3 {
    return target.set(this.cx, this.cy - GROUND_SPHERE_RADIUS, this.cz);
  }

  /** Distance from the planet's centre, metres. The radial coordinate itself. */
  radius(): number {
    return Math.hypot(this.cx, this.cy, this.cz);
  }

  /** `radius()` without the square root, for comparisons and sorting. */
  radiusSquared(): number {
    return this.cx * this.cx + this.cy * this.cy + this.cz * this.cz;
  }

  /**
   * **The local up at this position** — the unit radial, away from the planet's
   * centre.
   *
   * A direction, so it is the same vector in world space and in planet-centred
   * space and needs no conversion. This is the replacement for every
   * `new Vector3(0, 1, 0)` outdoors, and for `terrain.ts`'s `upAt`.
   *
   * At the planet's exact centre there is no answer; that position is not
   * reachable and this returns `+Y` rather than a `NaN` that would put every
   * prop in the park at an undefined orientation.
   */
  up(target: Vector3): Vector3 {
    const r = this.radius();
    if (r === 0) return target.set(0, 1, 0);
    return target.set(this.cx / r, this.cy / r, this.cz / r);
  }

  /**
   * **Straight-line distance between two positions, through space.**
   *
   * The honest metric for anything a collider, a reach test or a clearance
   * cares about: a child and a bench are separated by the air between them, not
   * by a walk around the planet. Identical to the old `Vector3.distanceTo`
   * because a translation preserves distance, so converting a call site to this
   * can never change an answer.
   *
   * For "how far did she walk", which is a different question once the ground
   * leans, use {@link arcTo}. The two agree to within 0.1 % out to 30 m on this
   * planet and diverge from there; `test/geo/control.test.ts` measures it.
   */
  chordTo(other: Readonly<Geo>): number {
    return Math.hypot(this.cx - other.cx, this.cy - other.cy, this.cz - other.cz);
  }

  chordToSquared(other: Readonly<Geo>): number {
    const dx = this.cx - other.cx;
    const dy = this.cy - other.cy;
    const dz = this.cz - other.cz;
    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * **Distance measured along the surface** — the great-circle arc between the
   * two directions, at this position's own radius.
   *
   * This is "how far is it to walk", and it is the number a path length, a
   * route cost, a nav step or a lap distance means. It is always at least
   * {@link chordTo} and the excess is the curvature: 691 m is half way round
   * this planet, so a 100 m walk reads 1.1 m longer than its chord.
   *
   * Takes the radius from `this`, not from `other`, because the caller always
   * knows which of the two they are standing on. When the two radii differ by
   * more than a metre or so the question is usually ill-posed and the caller
   * wants `chordTo` instead.
   */
  arcTo(other: Readonly<Geo>): number {
    const r = this.radius();
    const ro = other.radius();
    if (r === 0 || ro === 0) return this.chordTo(other);
    const cos = (this.cx * other.cx + this.cy * other.cy + this.cz * other.cz) / (r * ro);
    // `acos` of anything a whisker outside [-1, 1] is NaN, and rounding puts it
    // there for coincident directions. A NaN distance silently defeats every
    // `<` comparison in a solver, which is CLAUDE.md's "green can mean
    // incapable of failing" in one line.
    return r * Math.acos(cos < -1 ? -1 : cos > 1 ? 1 : cos);
  }

  /** Move along a world-space direction. The direction needs no conversion. */
  addScaledVector(
    v: { readonly x: number; readonly y: number; readonly z: number },
    scale: number,
  ): this {
    this.cx += v.x * scale;
    this.cy += v.y * scale;
    this.cz += v.z * scale;
    return this;
  }

  /**
   * Move radially — straight up or down, away from or towards the planet's
   * centre — without changing which patch of ground this is over.
   *
   * The `Geo` form of `terrain.ts`'s `liftFromGround`, and it differs from it
   * in exactly the way that helper's docblock warns about: this keeps the
   * *direction* and changes the radius, so a lift slides world `x` and `z`
   * outwards with the lean, which is right for placing a thing on the ground.
   */
  lift(metres: number): this {
    const r = this.radius();
    if (r === 0) {
      this.cy += metres;
      return this;
    }
    const s = (r + metres) / r;
    this.cx *= s;
    this.cy *= s;
    this.cz *= s;
    return this;
  }

  /** Set the distance from the centre, keeping the direction. */
  setRadius(radius: number): this {
    const r = this.radius();
    if (r === 0) return this.set(0, radius, 0);
    const s = radius / r;
    this.cx *= s;
    this.cy *= s;
    this.cz *= s;
    return this;
  }

  equals(other: Readonly<Geo>, epsilon = 0): boolean {
    return this.chordTo(other) <= epsilon;
  }

  /** For logs and failure messages. Prints the radius too, because the three components never mean anything alone. */
  toString(): string {
    return `Geo(${this.cx.toFixed(3)}, ${this.cy.toFixed(3)}, ${this.cz.toFixed(3)} | r=${this.radius().toFixed(3)})`;
  }
}

/**
 * Where the planet's centre sits in today's world coordinates.
 *
 * Exported so a check can assert it rather than re-deriving it, and so the one
 * place the offset lives is greppable. Nothing outside this directory should
 * need it: use {@link Geo.setFromWorld} and {@link Geo.toWorld}.
 */
export const PLANET_CENTRE_WORLD_Y = -GROUND_SPHERE_RADIUS;

/** The planet's radius, re-exported so `geo/` is a self-contained vocabulary. */
export const PLANET_RADIUS = GROUND_SPHERE_RADIUS;

const _scratch = /* @__PURE__ */ new Geo();

/**
 * A shared scratch `Geo` for a conversion that is immediately consumed.
 *
 * Use it the way this repo's modules use their module-level `_up`/`_tilt`
 * scratch vectors: read it, use it, do not store it. Anything that outlives the
 * statement it was made in gets its own `Geo`.
 */
export function scratchGeo(): Geo {
  return _scratch;
}
