import {
  CatmullRomCurve3,
  Quaternion,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { upFor } from '../up';
import { placeOnSphere, tiltToSphere } from '../terrain';

/**
 * **Sweeping a pair of rails along a route.** The park's one way of turning a
 * path into rail geometry.
 *
 * This is `Coaster.buildTrack`'s rail block, lifted out so that the Rail Race's
 * four lanes and the Sky Cruiser's single loop cannot drift apart — and so that
 * the backlog's "one parameterised rail generator; per-ride colour + radius" has
 * something to grow from rather than a third copy to reconcile.
 *
 * Two things it inherits from that original, both worth keeping:
 *
 * - The rails are **swept, not chopped** (family note, 28 July 2026). A rail
 *   built from one straight box per sample reads as a row of disjointed sticks
 *   wherever the route bends, which on a loop is most of it.
 * - A **circular cross-section** is why a plain `TubeGeometry` is enough: the
 *   Frenet frame it builds may twist along a curve with torsion, and on a round
 *   tube that twist is invisible. One draw call per rail, whatever the length.
 *
 * The sideways offset is the **horizontal** normal (`sideX = tangent.z`,
 * `sideZ = -tangent.x`), not a rolled one, because no track in this park banks.
 */

/**
 * Whatever can answer "where is the track at `distance`, and which way is it
 * heading?"
 *
 * Deliberately spelled `pointAt`/`tangentAt` — the names `TrainRoute` and
 * `CoasterRoute` already use — so that a route **is** a `RailSampler` with no
 * adapter, no wrapper and nothing to keep in step. `Coaster` hands `this.route`
 * straight to {@link sweptRails}. Only the Rail Race needs a small adapter, and
 * only because a lane has to be bound to its ring first.
 */
export interface RailSampler {
  /** Total length of the run, in metres. */
  readonly length: number;
  pointAt(distance: number, target: Vector3): Vector3;
  tangentAt(distance: number, target: Vector3): Vector3;
}

const _railUp = /* @__PURE__ */ new Vector3();
const _leanAt = /* @__PURE__ */ new Vector3();
const _leanSpin = /* @__PURE__ */ new Quaternion();

/**
 * The same route, **as it is drawn** — every point leant onto the sphere.
 *
 * A ride is solved in the flat frame the park was authored in: an (x, z) and a
 * height above the ground there. Keep it that way. `placeOnSphere` is locally a
 * rotation, so a height above the ground and a gradient are both *preserved* by
 * it — which means every clearance solve, every physics step and every
 * invariant is already asking its question in the right frame, and mapping the
 * route itself would move all of them for nothing.
 *
 * What does have to move is the geometry a child sees. Wrap the route in this
 * at the point of drawing, and the rails, the ties and anything hung off
 * `railFrameAt` lean with the world while nothing that reasons about the ride
 * shifts by a millimetre.
 *
 * The rail race does not need this: its own `pointAt` already returns the leant
 * point and `flatPointAt` is its unleant twin. Do not wrap it, or it leans
 * twice.
 */
export function drawnOnSphere(sampler: RailSampler): RailSampler {
  return {
    length: sampler.length,
    pointAt(distance: number, target: Vector3): Vector3 {
      sampler.pointAt(distance, target);
      placeOnSphere(target, 0, target, _leanSpin);
      return target;
    },
    tangentAt(distance: number, target: Vector3): Vector3 {
      sampler.pointAt(distance, _leanAt);
      sampler.tangentAt(distance, target);
      tiltToSphere(_leanAt.x, _leanAt.y, _leanAt.z, _leanSpin);
      return target.applyQuaternion(_leanSpin).normalize();
    },
  };
}

/**
 * The rails' one convention for "which way is sideways": **level with the
 * ground under the track**, and perpendicular to the tangent. Written once so
 * nothing that needs to sit square across both rails — a tie, say — can
 * reimplement it and quietly disagree with where the rails actually are.
 *
 * `normalize(up × along)`, which is perpendicular to `along` itself rather than
 * only to its horizontal projection, so `along`, this `side` and their cross
 * product always form a valid orthonormal frame however steeply the route
 * climbs or dives.
 *
 * **`up` is the local up, not world `+Y`.** This used to return a strictly
 * horizontal vector — `(along.z, 0, -along.x)` — and `sweptRail` offset the two
 * rails in `x`/`z` alone, leaving them at one world height. That is right on a
 * flat park and wrong on a sphere: out at the boundary the ground leans by
 * fourteen degrees, so a track held level to world `+Y` is tilted against the
 * ground it runs over, and its ties are no longer square to it. Reduces exactly
 * to the old formula when `up` is `+Y`, which is what the interiors still get.
 *
 * No track in this park banks *deliberately*; this is not banking, it is the
 * track lying flat on a world that curves.
 */
function railSide(along: Vector3, up: Vector3, target: Vector3): Vector3 {
  target.crossVectors(up, along);
  const norm = target.length() || 1;
  return target.divideScalar(norm);
}

/**
 * An orthonormal cross-section frame at `distance` along `sampler`, built
 * from the exact same horizontal `side` the rails are offset with (see
 * {@link horizontalSide}). `forward` is the route's unit tangent; `up`
 * completes the right-handed basis (`side × up === forward`).
 *
 * For anything that has to sit square across both rails — a tie is the
 * motivating case — orient local axes (side, up, forward) with this frame
 * rather than a generic minimal rotation onto `forward` alone: a minimal
 * rotation leaves the side axis free to roll wherever the route climbs or
 * dives, and the whole point of a tie is that it does not.
 */
export interface RailFrame {
  readonly position: Vector3;
  readonly forward: Vector3;
  readonly side: Vector3;
  readonly up: Vector3;
}

export function railFrameAt(sampler: RailSampler, distance: number, out: RailFrame): RailFrame {
  sampler.pointAt(distance, out.position);
  sampler.tangentAt(distance, out.forward).normalize();
  railSide(out.forward, upFor(out.position.x, out.position.y, out.position.z, _railUp), out.side);
  out.up.crossVectors(out.forward, out.side).normalize();
  return out;
}

export interface SweptRailOptions {
  /** Rail centre-to-centre, in metres. */
  readonly gauge: number;
  /** Radius of a rail's tube. */
  readonly radius: number;
  /** Metres between samples of the route. Default 1.4, as the coaster uses. */
  readonly step?: number;
  /** Whether the run closes on itself. Default true. */
  readonly closed?: boolean;
  /** Radial segments around the tube. Default 6 — it is a toy railway. */
  readonly radialSegments?: number;
  /**
   * Tube segments per metre. Default 2, which is what the coaster needs for the
   * tightest bend its solver can produce. A gentler route (the Rail Race's ring
   * turns at a constant 1/53.5 per metre) reads just as smooth at less, and the
   * saving is real: this is multiplied by eight rails there.
   */
  readonly tubularPerMetre?: number;
}

/**
 * Builds the two rails of one track: `[left, right]`.
 *
 * The caller owns the returned geometries and must dispose them.
 */
export function sweptRails(sampler: RailSampler, options: SweptRailOptions): BufferGeometry[] {
  return [1, -1].map((side) => sweptRail(sampler, side * options.gauge * 0.5, options));
}

/** One rail, offset `offset` metres to the side of the route's centre line. */
export function sweptRail(
  sampler: RailSampler,
  offset: number,
  options: SweptRailOptions,
): BufferGeometry {
  const closed = options.closed ?? true;
  const step = options.step ?? 1.4;
  const samples = Math.max(4, Math.ceil(sampler.length / step));

  const points: Vector3[] = [];
  const centre = new Vector3();
  const along = new Vector3();
  const side = new Vector3();
  // An open run needs the far end sampled too; a closed one must not repeat its
  // first point, which would leave `CatmullRomCurve3` a zero-length segment to
  // normalise a tangent from.
  const last = closed ? samples - 1 : samples;
  for (let i = 0; i <= last; i += 1) {
    const distance = (i / samples) * sampler.length;
    sampler.pointAt(distance, centre);
    sampler.tangentAt(distance, along);
    railSide(along, upFor(centre.x, centre.y, centre.z, _railUp), side);
    // Offset along the whole `side`, `y` included. Offsetting in `x`/`z` alone
    // held both rails at one world height, which puts the track at an angle to
    // a ground that leans.
    points.push(
      new Vector3(
        centre.x + side.x * offset,
        centre.y + side.y * offset,
        centre.z + side.z * offset,
      ),
    );
  }

  const curve = new CatmullRomCurve3(points, closed, 'catmullrom', 0.5);
  return new TubeGeometry(
    curve,
    Math.ceil(sampler.length * (options.tubularPerMetre ?? 2)),
    options.radius,
    options.radialSegments ?? 6,
    closed,
  );
}
