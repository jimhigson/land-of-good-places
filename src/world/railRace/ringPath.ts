import { PARK_BOUNDARY } from '../boundary';

/**
 * The Rail Race's centre line: the park's own edge, pushed outward.
 *
 * ## Why this exists
 *
 * The ring used to be a circle — `r = NOMINAL_RADIUS = 65.5` — and every piece
 * of the ride was reconstructed from it in polar form: `length = TAU·R`,
 * `angleAt(d) = -d/R`, `pointAt` as `(cos θ·r, ·, sin θ·r)`. That was exactly
 * right while the park was a disc of radius 58.
 *
 * The park is a gentle spline now, running **59.7 m at its pinch and 101.4 m at
 * its bulge** on the canonical seed. A circle cannot be concentric with that.
 * Measured on `feat/park-spline-boundary`: 79% of bearings had the whole ring
 * *inside* the park, at bearing 30° the edge stood 31 m outside the outer rail,
 * and on 32 of 180 bearings the **boundary masonry passed between the two
 * rails** — the wall running through the middle of the ride.
 *
 * It cannot be fixed by making the circle bigger. Clearing a 101.4 m bulge needs
 * r ≈ 106 m, which back at the 59.7 m pinch is 46 m beyond the wall and past the
 * edge of the terrain: the ride would fly off the side of the world. **The ring
 * has to follow the boundary**, which is what this does.
 *
 * ## Offset along the normal, not along the radius
 *
 * The obvious cheap version — scale each outline vertex out from the origin —
 * is wrong, and wrong in the direction that matters. Radial offset only equals
 * true distance-from-the-edge where the boundary is locally circular; wherever
 * `dr/dθ` is steep it under-delivers, which is precisely the pinch-to-bulge
 * shoulder where clearance is tightest. The rails then creep back toward the
 * masonry exactly where they can least afford to.
 *
 * So each vertex is pushed along the outline's own outward **normal**. The
 * invariant checks true perpendicular distance (`boundary.distanceToEdge`), so
 * this is also the only offset that measures the same way the test does.
 *
 * ## Arc length is the parameter
 *
 * Everything downstream — the simulation, the carts, the duck bars, the
 * start/finish arch — addresses the ride by **metres travelled**, never by
 * angle. That was already true when the ring was a circle; the circle just made
 * `s` and `θ` interchangeable via `s = Rθ`. They are not interchangeable any
 * more, so this resamples the offset outline at even arc length and every query
 * is a lookup by `s`. Bearing is still available ({@link RingPath.bearingAt}),
 * but it is now derived from the path rather than the path from it.
 */

/** Samples around the ring. The boundary's own outline is 512; this refines it. */
const SAMPLES = 2048;


export interface RingSample {
  readonly x: number;
  readonly z: number;
  /** Unit tangent, in the direction of increasing arc length. */
  readonly tangentX: number;
  readonly tangentZ: number;
  /** Unit outward normal — away from the park. */
  readonly normalX: number;
  readonly normalZ: number;
  /** Cumulative arc length at this sample. */
  readonly at: number;
}

export class RingPath {
  readonly samples: readonly RingSample[];
  /** One lap, in metres. */
  readonly length: number;
  /** +1 or -1: which turn of the tangent points away from the park. */
  private readonly normalSign: number;

  constructor(outset: number) {
    const outline = PARK_BOUNDARY.outline();
    const count = outline.length;

    // --- 1. push every outline vertex out along its own normal --------------
    const offset: { x: number; z: number }[] = [];
    for (let i = 0; i < count; i += 1) {
      const [x, z] = outline[i] as readonly [number, number];
      const [px, pz] = outline[(i - 1 + count) % count] as readonly [number, number];
      const [nx, nz] = outline[(i + 1) % count] as readonly [number, number];
      // Central-difference tangent: less jittery than a forward difference on a
      // polygon this fine, and the normal is what the clearance depends on.
      const tx = nx - px;
      const tz = nz - pz;
      const tl = Math.hypot(tx, tz) || 1;
      // Outline winds anticlockwise, so the outward normal is the tangent
      // turned clockwise. Checked against `distanceToEdge`'s sign in the
      // constructor's own assertion below rather than assumed.
      const ox = tz / tl;
      const oz = -tx / tl;
      offset.push({ x: x + ox * outset, z: z + oz * outset });
    }

    // If the winding was the other way round, every point just landed *inside*
    // the park. Cheaper to detect than to reason about, and a silent sign error
    // here would put the whole ride under the boundary wall.
    const probe = offset[0] as { x: number; z: number };
    if (PARK_BOUNDARY.distanceToEdge(probe.x, probe.z) > 0) {
      for (let i = 0; i < offset.length; i += 1) {
        const [x, z] = outline[i] as readonly [number, number];
        const point = offset[i] as { x: number; z: number };
        offset[i] = { x: x - (point.x - x), z: z - (point.z - z) };
      }
    }

    // **Run the ring clockwise.** `RailRaceRoute.angleAt` used to be `-s/R`, and
    // its doc explains at length why the sign is not arbitrary: the camera
    // stands outside looking in, so an anticlockwise lap would carry every rider
    // right-to-left across the picture — backwards to every side-scroller a
    // child has seen, and backwards to the direction she reads.
    //
    // The boundary's outline winds the other way, so reverse it here, once,
    // where the direction is decided. Doing it here rather than by negating
    // arc length downstream keeps `s` increasing in the direction of travel for
    // everything that consumes the path.
    offset.reverse();

    // --- 2. cumulative arc length round the offset polygon ------------------
    const cumulative: number[] = [0];
    for (let i = 0; i < count; i += 1) {
      const a = offset[i] as { x: number; z: number };
      const b = offset[(i + 1) % count] as { x: number; z: number };
      cumulative.push((cumulative[i] as number) + Math.hypot(b.x - a.x, b.z - a.z));
    }
    const perimeter = cumulative[count] as number;
    this.length = perimeter;

    // --- 3. resample at even arc length ------------------------------------
    const samples: RingSample[] = [];
    let cursor = 0;
    for (let i = 0; i < SAMPLES; i += 1) {
      const target = (i / SAMPLES) * perimeter;
      while (cursor < count - 1 && (cumulative[cursor + 1] as number) < target) cursor += 1;
      const a = offset[cursor] as { x: number; z: number };
      const b = offset[(cursor + 1) % count] as { x: number; z: number };
      const segment = (cumulative[cursor + 1] as number) - (cumulative[cursor] as number);
      const t = segment > 1e-9 ? (target - (cumulative[cursor] as number)) / segment : 0;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const tx = b.x - a.x;
      const tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      samples.push({
        x,
        z,
        tangentX: tx / tl,
        tangentZ: tz / tl,
        // Filled in below, once the outward sense is known.
        normalX: 0,
        normalZ: 0,
        at: target,
      });
    }

    // Which way round is "out" follows from the winding, and the winding has
    // just been reversed — so rather than reason about it, ask the boundary
    // once and apply the answer to every sample. A silent sign error here
    // stacks the lanes toward the park instead of away from it.
    const first = samples[0] as RingSample;
    const trial = { x: first.tangentZ, z: -first.tangentX };
    const outward =
      PARK_BOUNDARY.distanceToEdge(first.x + trial.x * 0.5, first.z + trial.z * 0.5) <
      PARK_BOUNDARY.distanceToEdge(first.x - trial.x * 0.5, first.z - trial.z * 0.5)
        ? 1
        : -1;
    this.normalSign = outward;
    for (let i = 0; i < samples.length; i += 1) {
      const sample = samples[i] as RingSample;
      (sample as { normalX: number }).normalX = sample.tangentZ * outward;
      (sample as { normalZ: number }).normalZ = -sample.tangentX * outward;
    }
    this.samples = samples;
  }

  /** Brings any arc length into `[0, length)`. */
  wrap(distance: number): number {
    const wrapped = distance % this.length;
    return wrapped < 0 ? wrapped + this.length : wrapped;
  }

  /**
   * The sample at an arc length, interpolated between the two nearest.
   *
   * `SAMPLES` around a ~450 m loop is a sample every ~0.22 m, so the lerp is
   * over a span far shorter than anything the ride draws with.
   */
  sampleAt(distance: number): RingSample {
    const wrapped = this.wrap(distance);
    const exact = (wrapped / this.length) * SAMPLES;
    const i = Math.floor(exact) % SAMPLES;
    const j = (i + 1) % SAMPLES;
    const t = exact - Math.floor(exact);
    const a = this.samples[i] as RingSample;
    const b = this.samples[j] as RingSample;
    const lerp = (u: number, v: number): number => u + (v - u) * t;
    // Tangent and normal are lerped and renormalised rather than slerped: over
    // 0.22 m of a curve whose tightest radius is 20 m the angle between
    // neighbours is under a degree, so the two agree to well past the precision
    // anything downstream draws with.
    const tx = lerp(a.tangentX, b.tangentX);
    const tz = lerp(a.tangentZ, b.tangentZ);
    const tl = Math.hypot(tx, tz) || 1;
    return {
      x: lerp(a.x, b.x),
      z: lerp(a.z, b.z),
      tangentX: tx / tl,
      tangentZ: tz / tl,
      normalX: (tz / tl) * this.normalSign,
      normalZ: (-tx / tl) * this.normalSign,
      at: wrapped,
    };
  }

  /** Compass bearing of the point at this arc length, for anything still polar. */
  bearingAt(distance: number): number {
    const sample = this.sampleAt(distance);
    return Math.atan2(sample.z, sample.x);
  }

  /**
   * Arc length at which the ring passes a given bearing.
   *
   * The inverse of {@link bearingAt}, and it needs a search rather than a
   * division now — `s = -Rθ` only held while the ring was a circle. Valid
   * because the boundary is star-shaped, so bearing is monotone in `s`.
   */
  distanceAtBearing(bearing: number): number {
    const target = Math.atan2(Math.sin(bearing), Math.cos(bearing));
    let best = 0;
    let bestGap = Infinity;
    for (const sample of this.samples) {
      const angle = Math.atan2(sample.z, sample.x);
      const gap = Math.abs(Math.atan2(Math.sin(angle - target), Math.cos(angle - target)));
      if (gap < bestGap) {
        bestGap = gap;
        best = sample.at;
      }
    }
    return best;
  }
}
