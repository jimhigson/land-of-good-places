import {
  CatmullRomCurve3,
  Matrix4,
  Quaternion,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { upFor } from '../up';
import { placeOnSphere, tiltToSphere } from '../terrain';
import { headingTurn } from '../headingTurn';

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
    // The direction the drawn rails actually run — see `drawnDirection`. This
    // used to be the flat tangent turned by the sphere's tilt at the point,
    // which leans it twice wherever the flat route already follows the ground:
    // the Sky Cruiser's sleepers were tipped 17.25° against their rails at
    // s=63 m on the canonical seed.
    tangentAt(distance: number, target: Vector3): Vector3 {
      return drawnDirection(this, distance, target);
    },
  };
}

/**
 * **Which way the rails are actually drawn at `distance`: the one owner of that
 * question.** A central difference of the sampler's own drawn points, ±5 cm.
 *
 * Not any route's `tangentAt`, because two routes in this park have a
 * `tangentAt` that is a different thing from the direction of their drawn
 * rails, and both were built on as if it were:
 *
 * - the Sky Cruiser's flat route, turned onto the sphere by the tilt at the
 *   point (`drawnOnSphere`), which leans a tangent that already follows the
 *   ground a second time — sleepers tipped 17.25° off their rails;
 * - the Rail Race's route, whose `tangentAt` is the unleant *chart* tangent the
 *   physics wants — sleepers laid up to 14.9° across the rails over them.
 *
 * A difference of the drawn points cannot disagree with the rails, because it
 * is read off the same points the rails are swept through. Five centimetres is
 * far inside the tightest bend on either ride and far above float noise.
 * `check:tie-frame` measures every sleeper and both carts against this, taken
 * independently.
 */
export function drawnDirection(
  sampler: Pick<RailSampler, 'pointAt'>,
  distance: number,
  target: Vector3,
): Vector3 {
  sampler.pointAt(distance - DRAWN_STEP, _drawnBehind);
  sampler.pointAt(distance + DRAWN_STEP, target);
  return target.sub(_drawnBehind).normalize();
}

/** Half the span of {@link drawnDirection}'s difference, in metres. */
const DRAWN_STEP = 0.05;
const _drawnBehind = /* @__PURE__ */ new Vector3();

/**
 * **`count` stations round a closed rail, evenly spaced along the rail as
 * drawn** — the one owner of where a lane's sleepers go.
 *
 * Returns the sampler's own `distance` for each, but chosen so the *drawn* arc
 * between every consecutive pair is the same: `drawnLength / count`.
 *
 * Not `i * spacing` of the sampler's distance, which is what the Rail Race laid
 * its sleepers at, because that distance is the ring's **centre line**, and a
 * lane offset from it covers `1 + offset / bendRadius` metres of rail per metre
 * of centre line. On a 17.7 m bend (seed 3, race ring, s=37 m) the innermost
 * lane — on the outside of that bend — got a sleeper every 1.254 m of drawn
 * rail, and the outermost one every 0.830 m: "about a metre" on no lane at all,
 * and worse on whichever seed bent tightest. The lean onto the sphere stretches
 * the drawn rail a further ~1.6% over its chart there, which a centre-line
 * spacing cannot see either. Walking the drawn points sees both.
 *
 * The table is sampled every `SLEEPER_TABLE_STEP` of distance and inverted
 * linearly; the chord-for-arc error at that step is far below a millimetre.
 */
export function stationsEvenlyAlongDrawn(
  sampler: Pick<RailSampler, 'pointAt' | 'length'>,
  count: number,
): Float64Array {
  const stations = new Float64Array(Math.max(0, count));
  if (count <= 0) return stations;
  const steps = Math.max(1, Math.ceil(sampler.length / STATION_TABLE_STEP));
  const at = new Float64Array(steps + 1);
  const run = new Float64Array(steps + 1);
  const previous = new Vector3();
  const next = new Vector3();
  sampler.pointAt(0, previous);
  for (let k = 1; k <= steps; k += 1) {
    at[k] = (k / steps) * sampler.length;
    sampler.pointAt(at[k]!, next);
    run[k] = run[k - 1]! + next.distanceTo(previous);
    previous.copy(next);
  }
  const spacing = run[steps]! / count;
  let k = 1;
  for (let i = 0; i < count; i += 1) {
    const want = i * spacing;
    while (k < steps && run[k]! < want) k += 1;
    const span = run[k]! - run[k - 1]!;
    const t = span > 0 ? (want - run[k - 1]!) / span : 0;
    stations[i] = at[k - 1]! + t * (at[k]! - at[k - 1]!);
  }
  return stations;
}

/** How finely {@link stationsEvenlyAlongDrawn} walks the drawn rail, in metres of distance. */
const STATION_TABLE_STEP = 0.1;

const _rideTilt = /* @__PURE__ */ new Quaternion();
const _rideSpin = /* @__PURE__ */ new Quaternion();

/**
 * **How a vehicle sits on a route that is drawn on the sphere** — the
 * orientation half of {@link drawnOnSphere}, and the one owner of it.
 *
 * {@link drawnOnSphere} leans the *track*. Nothing leaned the things that ride
 * it, and for a long time nothing noticed, because a cart placed at the flat
 * `route.pointAt` with a plain `rotation.y`/`rotation.x` looks perfectly
 * sensible in isolation. It is only wrong *relative to its own rails* — and
 * only once the park stopped being flat.
 *
 * Measured on seed 428 before this existed: the Sky Cruiser's cart was
 * **10.83 m from its own rails** at the worst point of a 213.5 m circuit, and
 * 3.42 m from them on average. Not a subtle lean; the vehicle was flying beside
 * the track rather than on it. The same fault seated the Rail Race's rider — who
 * *is* leaned, by `faceOnGround` inside `Player.setRidePose` — inside a tub that
 * was not, which swung her arms out through its side.
 *
 * **The lean is taken about `flat`'s column, not about where the vehicle ends
 * up.** That is the whole reason this is a shared function rather than a
 * `faceOnGround` call: `faceOnGround` reads the object's own position, and a
 * drawn point has already slid `height · sin(tilt)` outwards from the column
 * the rails were leaned about. Leaning the cart about *that* column tilts it by
 * a slightly different angle from the rails under it — a small error, but the
 * same *kind* of error as the large one this replaces, and invisible in exactly
 * the way that kind always is. `drawnOnSphere` uses the flat point; so does
 * this; so the two cannot drift.
 *
 * **Safe to call every frame**, and that is not incidental. It writes the
 * quaternion from scratch from the yaw and pitch it is handed, and never reads
 * what is already there — the trap `world/up.ts`'s `faceOnGround` docblock
 * describes at length, where a per-frame pre-multiply decomposes back into
 * `rotation.x`/`rotation.z` and the tilt compounds until the thing tumbles.
 *
 * Position is deliberately **not** this function's business: the train solves
 * flat and maps its point through `placeOnSphere`.
 *
 * **Only for a heading with no pitch — today, the train's cars.** A pitched
 * heading read off a flat tangent and then leant is leant twice where the flat
 * tangent already follows the ground: measured on the Sky Cruiser (canonical
 * seed), 17.25° between the nose and its drawn rails even once the composition
 * was right. The Sky Cruiser and the Rail Race carts now take the direction
 * their rails are actually drawn in, through {@link railTurn}; a new vehicle
 * that climbs should too.
 */
export function rideFrame(
  flat: Readonly<Vector3>,
  yaw: number,
  pitch: number,
  out: Quaternion,
): Quaternion {
  tiltToSphere(flat.x, flat.y, flat.z, _rideTilt);
  // Yaw, then pitch in the yawed frame, from the one owner of that order —
  // the same function `faceOnGround` poses a rider with, so a rider and the
  // tub she sits in cannot compose one heading two ways again.
  headingTurn(yaw, pitch, _rideSpin);
  return out.multiplyQuaternions(_rideTilt, _rideSpin);
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

/**
 * **The turn that sits a vehicle square on rails running along `forward` at
 * `position`** — the orientation half of {@link railFrameAt}, from the same
 * side/up convention, so a cart and the sleepers under it cannot disagree about
 * which way is across.
 *
 * `forward` is the direction the rails are actually **drawn** in. That is not
 * always the route's own `tangentAt`: the Rail Race's is the unleant chart
 * tangent, and a cart turned from it through `rideFrame` ran its nose up to
 * 3.5° off the rails under it, round the whole lap (`check:rail-race`).
 */
export function railTurn(position: Vector3, forward: Vector3, out: Quaternion): Quaternion {
  railSide(forward, upFor(position.x, position.y, position.z, _railUp), _turnSide);
  _turnUp.crossVectors(forward, _turnSide).normalize();
  _turnBasis.makeBasis(_turnSide, _turnUp, forward);
  return out.setFromRotationMatrix(_turnBasis);
}

const _turnSide = /* @__PURE__ */ new Vector3();
const _turnUp = /* @__PURE__ */ new Vector3();
const _turnBasis = /* @__PURE__ */ new Matrix4();

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
