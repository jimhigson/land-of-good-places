import { Vector3 } from 'three';
import { TAU } from '../../core/mathUtils';
import { terrainHeight } from '../terrain';
import { placedEntry } from '../parkLayout';

/**
 * **The Rail Race's four tracks** — a ring around the park's rim, flown high.
 *
 * The family's brief (31 July 2026): *"side-on perspective like before, with 4
 * parallel tracks. The tracks should go around the perimeter of the park, so
 * that the side-on perspective is looking into the park. It shouldn't otherwise
 * turn left or right but should undulate up and down with each of the four
 * tracks going up and down independently."*
 *
 * So the horizontal shape is not solved, grown or steered: it is the park's own
 * perimeter, a circle, and the only thing that varies along it is **height**.
 * There is no steering input in this ride and nothing for a solver to decide.
 *
 * ### Why it flies
 *
 * The ground at this radius is already spoken for. The train owns the 48–58 m
 * band (`train/route.ts`), the boundary wall is at 60 m, and the entrance's gate
 * corridor cuts straight through the ring at bearing +Z. Rather than thread a
 * fifth path through all that, the race **flies over the lot** at
 * {@link BASE_HEIGHT}, the way the coaster clears the park with its
 * `CRUISE_FLOOR`. That is not only the cheap way out of a crowded band — it is
 * the *point*: a camera outside a rim-height track looks in **over** the
 * boundary wall and the treeline at the whole park, which is the backdrop the
 * brief asks for. Down at ground level it would be looking at a wall.
 *
 * ### Why every lane is the same length
 *
 * Four concentric circles are four *different* circumferences — 311 m on the
 * inside lane against 361 m on the outside, a sixth further to go for riding
 * the outer rail. A race decided by which lane you drew is not a race.
 *
 * So the course is parameterised by **one shared arc length `s`, measured on
 * the nominal circle**, and each lane maps that same `s` onto its own radius.
 * Every rider covers the same `s` at the same rate; the outer cart is quietly
 * moving a little faster through the world and nobody has ever noticed. It also
 * makes hazards fair for free: one arc distance is the same moment of the race
 * in all four lanes.
 *
 * ### Why a lane is the same hill profile, merely rotated
 *
 * Same reasoning, one level down. If lane 3's hills were steeper or more
 * frequent than lane 0's it would have more total climb, and the lane you drew
 * would decide the race again.
 *
 * The fix is stronger than "give each lane a different phase", and the
 * difference matters: a sum of sinusoids given a *different phase per harmonic*
 * is a genuinely different waveform, with a different total climb and a
 * different steepest gradient. (Measured: 2.54 m of climb between the easiest
 * and hardest lane, on the first version of this file. The checker caught it.)
 *
 * So each lane is the **same waveform rigidly rotated around the loop** — one
 * shift `δ` applied to the angle itself, not a free phase per harmonic. Every
 * lane then has provably identical climb, descent, extremes and steepest
 * gradient, because it *is* the same function; and because the shift is a
 * sizeable fraction of a lap, the four rails visibly cross and swap over each
 * other the whole way round, which is the look the brief asks for.
 *
 * The base the lanes undulate about is **level**, for the same reason: a base
 * that followed the ground would put a hill under one lane's crest and another
 * lane's dip, and the difficulty would depend on the lane again.
 */

/** Four lanes, one per racer. */
export const LANE_COUNT = 4;

/**
 * The lane the player rides: the **outermost**, and so the one nearest a camera
 * that sits outside the ring looking in.
 *
 * Straight from the retired 2D game's note on the same choice: the player wants
 * the row of the picture where nothing can ever be drawn in front of them.
 */
export const PLAYER_LANE = LANE_COUNT - 1;

/** The circle the shared arc length `s` is measured on. */
export const NOMINAL_RADIUS = 53.5;

/** Metres between neighbouring rails. */
const LANE_SPACING = 2.6;

/**
 * How high the rails fly above the ground under the nominal circle.
 *
 * Floored well above everything in this band: the train's rail head (0.17 m)
 * and its cars (2.6 m), its platform canopy (3.7 m), the boundary wall, and the
 * entrance arch the ring crosses at bearing +Z. Decision 4 asks for 5.5 m of
 * rail-over-rail air where one ride passes over another; the lowest this track
 * ever gets is `BASE_HEIGHT - UNDULATION_REACH` above the ground, which leaves
 * more than that over the railway. Asserted, not assumed — see
 * `scripts/check-rail-race.mts`.
 */
export const BASE_HEIGHT = 9.5;

/**
 * The three harmonics every lane runs.
 *
 * Integer multiples of the loop angle, so each one closes seamlessly where the
 * ring meets itself — a non-integer harmonic would leave a step at the join
 * that the swept rail would have to smooth over and the physics would feel as a
 * kink. Amplitudes and frequencies are deliberately identical across lanes; see
 * the file header.
 *
 * The frequencies are kept low on purpose. The steepest gradient this can
 * produce is the sum of `amplitude * harmonic / NOMINAL_RADIUS`, which comes out
 * at 0.233 — about 13°, and only where all three crests happen to align. The
 * retired 2D game settled on "nothing steeper than about 11°" as the gentle
 * rollercoaster a six-year-old enjoys, and this is that, with a little headroom.
 */
const HARMONICS: readonly { readonly amplitude: number; readonly n: number }[] = [
  { amplitude: 1.6, n: 3 },
  { amplitude: 0.9, n: 5 },
  { amplitude: 0.45, n: 7 },
];

/** The most a lane can rise or fall from the base. Sum of the amplitudes. */
export const UNDULATION_REACH = HARMONICS.reduce((sum, h) => sum + h.amplitude, 0);

/**
 * How far round the loop each lane's copy of the profile is rotated, as a
 * fraction of a lap.
 *
 * A rigid rotation of the *angle*, not a free phase per harmonic — see the
 * header for why that distinction decides whether the race is fair. 0.27 of a
 * lap is about 91 m between one lane's hills and the next's: far enough that
 * the four rails are never doing the same thing, and not a neat fraction like a
 * quarter, which would let lanes 0 and 2 fall back into step on any even
 * harmonic.
 */
const LANE_ROTATION = 0.27;

/** Radius of each lane, innermost first. Lane `PLAYER_LANE` is the outermost. */
export const LANE_RADII: readonly number[] = Array.from(
  { length: LANE_COUNT },
  (_unused, lane) => NOMINAL_RADIUS + (lane - (LANE_COUNT - 1) / 2) * LANE_SPACING,
);

/** Height of a lane's rail above the level base, at loop angle `theta`. */
function undulation(lane: number, theta: number): number {
  const rotated = theta + lane * LANE_ROTATION * TAU;
  let y = 0;
  for (const harmonic of HARMONICS) {
    y += Math.sin(rotated * harmonic.n) * harmonic.amplitude;
  }
  return y;
}

/**
 * The ring, as maths.
 *
 * Deliberately **not** a `CatmullRomCurve3` like `TrainRoute` and
 * `CoasterRoute`: those two interpolate a solved list of control points and have
 * to reparameterise by arc length to answer "where am I at 40 m?". A circle of
 * known radius answers that exactly, in closed form, with no sampling error and
 * no build cost — and the geometry builder still consumes it through the same
 * `pointAt`/`tangentAt`/`length`/`wrap` shape the other two routes expose, which
 * is what "our standard track path following" actually means here.
 */
export class RailRaceRoute {
  /** One lap, in metres of shared arc length. */
  readonly length = TAU * NOMINAL_RADIUS;

  /** Where the start/finish arch stands, in metres along the loop. */
  readonly startDistance: number;

  /**
   * The level the four lanes undulate about, in world metres.
   *
   * Taken from the **highest** ground anywhere under the ring plus
   * {@link BASE_HEIGHT}, so the promised clearance holds at the worst point
   * rather than on average — the rim is a hilltop and the ground under the ring
   * is not flat, even if it is close.
   */
  readonly base: number;

  private readonly scratch = new Vector3();

  constructor(stationStallId: string) {
    let highest = -Infinity;
    const samples = 360;
    for (let i = 0; i < samples; i += 1) {
      const theta = (i / samples) * TAU;
      // Sampled across the full width of the track, not just the nominal circle:
      // the inner and outer rails are 2.6 m either side of it and can be over
      // higher ground than the middle is.
      for (const radius of [LANE_RADII[0]!, NOMINAL_RADIUS, LANE_RADII[LANE_COUNT - 1]!]) {
        const height = terrainHeight(Math.cos(theta) * radius, Math.sin(theta) * radius);
        if (height > highest) highest = height;
      }
    }
    this.base = highest + BASE_HEIGHT;

    // The arch goes at the bearing of the booth that boards the ride, so the
    // rails a child can see from the queue are the rails she is about to start
    // on. She is carried out to them by the iris wipe, exactly as the other
    // rides carry her to a station she is not standing on.
    const stall = placedEntry(stationStallId);
    const bearing = Math.atan2(stall.z, stall.x);
    this.startDistance = this.wrap(bearing * NOMINAL_RADIUS);
  }

  /** Brings any arc length into `[0, length)`. */
  wrap(distance: number): number {
    const wrapped = distance % this.length;
    return wrapped < 0 ? wrapped + this.length : wrapped;
  }

  /** Loop angle at an arc length. */
  angleAt(distance: number): number {
    return distance / NOMINAL_RADIUS;
  }

  /** Height of a lane's rail head, in world metres. */
  heightAt(lane: number, distance: number): number {
    return this.base + undulation(lane, this.angleAt(distance));
  }

  /** A point on a lane's rail. */
  pointAt(lane: number, distance: number, target: Vector3 = this.scratch): Vector3 {
    const theta = this.angleAt(distance);
    const radius = LANE_RADII[lane] ?? NOMINAL_RADIUS;
    return target.set(
      Math.cos(theta) * radius,
      this.heightAt(lane, distance),
      Math.sin(theta) * radius,
    );
  }

  /**
   * Unit tangent along a lane, in the direction of increasing `s`.
   *
   * The horizontal part is the circle's own tangent; the vertical part is the
   * lane's gradient. Note the horizontal magnitude is scaled by the lane's
   * radius over the nominal one — an outer lane really does cover more ground
   * per metre of `s` (see the header), and a tangent that pretended otherwise
   * would tilt every cart on the outer lanes by the wrong pitch.
   */
  tangentAt(lane: number, distance: number, target: Vector3 = new Vector3()): Vector3 {
    const theta = this.angleAt(distance);
    const radius = LANE_RADII[lane] ?? NOMINAL_RADIUS;
    const horizontal = radius / NOMINAL_RADIUS;
    return target
      .set(-Math.sin(theta) * horizontal, this.slopeAt(lane, distance), Math.cos(theta) * horizontal)
      .normalize();
  }

  /**
   * Gradient of a lane, as dy/ds. Positive is uphill.
   *
   * Exact, because the base is level and the undulation is three sinusoids: the
   * derivative is closed form, so the physics reads the true gradient rather
   * than a sampled approximation of it.
   */
  slopeAt(lane: number, distance: number): number {
    const rotated = this.angleAt(distance) + lane * LANE_ROTATION * TAU;
    let dydtheta = 0;
    for (const harmonic of HARMONICS) {
      dydtheta += Math.cos(rotated * harmonic.n) * harmonic.amplitude * harmonic.n;
    }
    // Chain rule: theta = s / NOMINAL_RADIUS.
    return dydtheta / NOMINAL_RADIUS;
  }

  /**
   * The horizontal unit vector pointing **out** of the park at an arc length —
   * the direction the side-on camera stands in, and the axis the lanes are
   * stacked along.
   */
  outwardAt(distance: number, target: Vector3 = new Vector3()): Vector3 {
    const theta = this.angleAt(distance);
    return target.set(Math.cos(theta), 0, Math.sin(theta));
  }
}
