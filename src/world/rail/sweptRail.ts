import { CatmullRomCurve3, TubeGeometry, Vector3, type BufferGeometry } from 'three';

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
  // An open run needs the far end sampled too; a closed one must not repeat its
  // first point, which would leave `CatmullRomCurve3` a zero-length segment to
  // normalise a tangent from.
  const last = closed ? samples - 1 : samples;
  for (let i = 0; i <= last; i += 1) {
    const distance = (i / samples) * sampler.length;
    sampler.pointAt(distance, centre);
    sampler.tangentAt(distance, along);
    const sideX = along.z;
    const sideZ = -along.x;
    const norm = Math.hypot(sideX, sideZ) || 1;
    points.push(
      new Vector3(
        centre.x + (sideX / norm) * offset,
        centre.y,
        centre.z + (sideZ / norm) * offset,
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
