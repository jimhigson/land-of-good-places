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

/**
 * Half-width of the stencil each sample's tangent is estimated over, in metres.
 *
 * ### The jerky camera this exists to fix (6 August 2026)
 *
 * Tangents used to be read straight off the outline segment a resampled point
 * happened to land in (`b.x - a.x` for that one segment). That makes the
 * tangent — and so the normal, and so the whole frame — a **step function**:
 * every sample inside one outline segment gets a bit-identical tangent, and it
 * jumps at the boundary. Measured round the lap, that left **3511
 * constant-tangent plateaus**, and because `railRace/camera.ts` stands its rig
 * tens of metres out *along that normal*, every step was amplified into a
 * visible lurch: the camera's speed ranged from **0.003 to 5.072 metres of
 * camera per metre of rider**, with a median acceleration of 0.000 and a
 * maximum of 81.4 — flat, flat, flat, jump, which is exactly what a step
 * function looks like and exactly what it felt like to ride.
 *
 * A central difference over a fixed *arc-length* window fixes it at the source
 * rather than damping the symptom downstream. It is also very nearly free in
 * accuracy: on a circular arc a symmetric central difference gives the chord,
 * whose direction **is** the true tangent at the midpoint, so the error is
 * third-order and appears only where curvature itself changes. 2 m is far
 * shorter than the ~40 m over which this ring's curvature actually varies
 * (`railRace/camera.ts` measures that), and comfortably longer than the ~1.5 m
 * longest outline segment, so it always spans several of them.
 *
 * Do not go back to the per-segment tangent to "keep the path faithful to the
 * outline" — the *positions* are untouched and still sit exactly on the offset
 * polygon. This changes only how the frame at those positions is estimated.
 */
const TANGENT_WINDOW = 2;

/**
 * The window the **camera's** frame is smoothed over, in metres — far longer
 * than {@link TANGENT_WINDOW}, and for a different reason.
 *
 * ### Why the camera cannot use the geometry's frame
 *
 * `railRace/camera.ts` stands its rig about **27.5 m** out along the normal at
 * the rider. The ring's tightest bend has a radius of about 20 m. A point held
 * a fixed distance out along the normal of a curve traces an offset curve whose
 * radius is `R - offset`, so wherever the ring bends towards the camera more
 * tightly than the rig stands out, **that offset curve runs backwards**. It is
 * not an approximation error and no amount of damping removes it.
 *
 * Measured on the built park by the `raceCameraNeverRunsBackwards` invariant,
 * it happened on **every one of the five seeds** — worst forward progress
 * −0.022, −0.055, −0.380, −0.410 and −0.318 metres of camera per metre of
 * rider, on 2 to 65 probes of ~2400 a lap. So a few times a lap, on any park
 * the generator makes, the picture lurches the wrong way while she is still
 * going forwards.
 *
 * ### Why smoothing the frame is the fix, and what it costs
 *
 * The rig is expressed as offsets in the frame **at the rider**, and the rider
 * sits at that frame's origin — so rotating the frame rotates the camera, its
 * aim and its up together, rigidly, about the rider. The rider's position on
 * screen is therefore *exactly* preserved however much the frame is smoothed,
 * which is the one framing promise `solve` makes exactly. What smoothing does
 * change is where the look-ahead point lands, and that promise is documented as
 * one-sided and approximate already: a window may show more road than asked
 * for, never less.
 *
 * So the camera follows the ring's *general drift* rather than its every
 * wiggle, which is what a camera operator standing in a field would do, and the
 * rails, lanes, sleepers and hazards all still use the faithful
 * {@link TANGENT_WINDOW} frame.
 *
 * ### It is not free, and 10 sits between two walls that are both guarded
 *
 * The cost I did not expect, and `check:rail-race` caught: a smoothed frame is
 * no longer square-on to the rider's *actual* direction of travel, and that
 * drift adds straight onto the rig's swing. The rider's own screen position is
 * still exact (she is the frame's origin), but how squarely she crosses the
 * picture is not, and the side-scroller floor — `dot(screenRight, travel) > 0.9`
 * — has only about 4° of budget over {@link MAX_SWING}'s 22°. Swept:
 *
 * ```
 *    window   camera runs backwards   check:rail-race
 *      6 m    200 of 12003 probes     passes
 *      8 m     17                     passes
 *     10 m      0                     passes            <- here
 *     12 m      0                     FAILS  side-scroller 0.897
 *     14 m      0                     FAILS  swing 27.3°, eye facing 0.348
 *     24 m      0                     FAILS  four ways
 * ```
 *
 * So this number has a wall on each side and roughly one step of room between
 * them. **Both walls are checked** — reversal by the `raceCameraNeverRunsBackwards`
 * procgen invariant across five seeds, drift by `check:rail-race` — so moving
 * it in either direction fails loudly rather than quietly. If it ever needs
 * more room, the lever is the ~27.5 m stand-off itself, which one awkward station
 * sets for the whole ring in `RaceCamera.solve`.
 */
const CAMERA_GUIDE_WINDOW = 10;


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

/**
 * Fills in tangents by central difference over `window` metres of arc.
 *
 * One mechanism for both frames the ring publishes — the faithful one the
 * geometry is built on and the smoothed one the camera follows — so there is no
 * second copy of this arithmetic to fall out of step with the first.
 */
function addTangents(into: RingSample[], window: number, perimeter: number): void {
  const span = Math.max(1, Math.round((window / perimeter) * SAMPLES));
  // Read positions off a snapshot: writing tangents back into the same array is
  // safe only because nothing here reads a tangent, but the snapshot makes that
  // independent of the order the loop happens to run in.
  const points = into.map((sample) => ({ x: sample.x, z: sample.z }));
  for (let i = 0; i < SAMPLES; i += 1) {
    const behind = points[(i - span + SAMPLES) % SAMPLES] as { x: number; z: number };
    const ahead = points[(i + span) % SAMPLES] as { x: number; z: number };
    const tx = ahead.x - behind.x;
    const tz = ahead.z - behind.z;
    const tl = Math.hypot(tx, tz) || 1;
    const sample = into[i] as RingSample;
    (sample as { tangentX: number }).tangentX = tx / tl;
    (sample as { tangentZ: number }).tangentZ = tz / tl;
  }
}

/** Turns each tangent a quarter turn to face away from the park. */
function addNormals(into: RingSample[], outward: number): void {
  for (const sample of into) {
    (sample as { normalX: number }).normalX = sample.tangentZ * outward;
    (sample as { normalZ: number }).normalZ = -sample.tangentX * outward;
  }
}

export class RingPath {
  readonly samples: readonly RingSample[];
  /** The camera's smoothed frame. Same positions — see {@link CAMERA_GUIDE_WINDOW}. */
  private readonly guide: readonly RingSample[];
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
      samples.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        // Both filled in below: the tangent needs its neighbours, and the normal
        // needs the tangent plus the outward sense.
        tangentX: 0,
        tangentZ: 0,
        normalX: 0,
        normalZ: 0,
        at: target,
      });
    }

    // --- 4. tangents, by central difference over an arc-length window -------
    //
    // A second pass, because a tangent estimated from the outline segment a
    // sample lands in is piecewise constant and made the camera lurch. See
    // TANGENT_WINDOW.
    addTangents(samples, TANGENT_WINDOW, perimeter);

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
    addNormals(samples, outward);
    this.samples = samples;

    // --- 5. the camera's own, much more heavily smoothed frame --------------
    //
    // Same positions, same mechanism, longer window — see CAMERA_GUIDE_WINDOW
    // for why the camera cannot use the frame above at all.
    const guide = samples.map((sample) => ({ ...sample }));
    addTangents(guide, CAMERA_GUIDE_WINDOW, perimeter);
    addNormals(guide, outward);
    this.guide = guide;
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
    return this.lookup(this.samples, distance);
  }

  /**
   * The **camera's** frame at an arc length: the same point, on a frame
   * smoothed over {@link CAMERA_GUIDE_WINDOW} rather than
   * {@link TANGENT_WINDOW}.
   *
   * Only `railRace/camera.ts` should call this. Everything that draws or
   * collides — rails, sleepers, droppers, lanes, duck bars — wants
   * {@link sampleAt}, because those must sit exactly where the ring is, and
   * this deliberately does not.
   *
   * The window was swept against the two things it trades off — how far the
   * frame drifts from the true one, and whether the offset path the camera
   * rides ever reverses. See the commit that introduced it for the table.
   */
  guideAt(distance: number): RingSample {
    return this.lookup(this.guide, distance);
  }

  private lookup(table: readonly RingSample[], distance: number): RingSample {
    const wrapped = this.wrap(distance);
    const exact = (wrapped / this.length) * SAMPLES;
    const i = Math.floor(exact) % SAMPLES;
    const j = (i + 1) % SAMPLES;
    const t = exact - Math.floor(exact);
    const a = table[i] as RingSample;
    const b = table[j] as RingSample;
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
