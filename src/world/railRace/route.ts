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
 * ### Two rings, built to their own dimensions
 *
 * A {@link RailRaceRoute} is built **per ring**, and a ring is described by one
 * number: its {@link RailRaceRoute.scale}. There are two of them
 * (`railRace/plan.ts`):
 *
 * - the **walk-past ring** at park scale (`scale = 1`), which the rival kids
 *   idle round permanently as ambient park life, and
 * - the **race ring** at toy scale (`scale =` {@link RIDE_SCALE}), which only
 *   exists while a child is actually aboard.
 *
 * They share one nominal radius, one arc length, one start distance and one
 * undulation, so a rider's `travelled` means the same thing on either and the
 * whole hazard schedule is shared verbatim. What differs is **lane spacing**
 * (and, in `track.ts`, rail gauge, duck-bar size, trestle beam span): the ring
 * is genuinely *built* at its own size rather than drawn once and multiplied by
 * a group transform.
 *
 * That distinction is the whole point of the split, and it is not academic. A
 * single ring drawn at toy scale meant every rival's cart and rider carried a
 * permanent `scale.setScalar(RIDE_SCALE)` — so the ambient rivals were 2.5x
 * life-size to anyone who walked or flew past, race or no race. Jim's
 * screenshot, 2 August 2026. There is no scale multiply on a ring any more;
 * only the cart and rider models take one, and only for the ring they are
 * currently on.
 *
 * ### Why it flies, and why it is outside the wall
 *
 * The ring used to circle the park *inside* the boundary at 53.5 m, flying over
 * the train's 48–58 m band and the entrance's gate corridor because that ground
 * was already spoken for. Since 2 August 2026 both rings stand **outside** the
 * masonry (`ENTRANCE_WALL_RADIUS`, 60 m) instead, on the hilltop apron: out
 * there is no planting, no path network, no railway and no plot to fight, which
 * is what lets a second ring of a completely different size be stood up beside
 * the first without a clearance search that can fail. It also means a child
 * walking the park never meets the ride's structure at all.
 *
 * It still **flies**, at {@link BASE_HEIGHT}, for the reason it always did: a
 * camera outside a rim-height track looks in **over** the boundary wall and the
 * treeline at the whole park, which is the backdrop the brief asks for. Down at
 * ground level it would be looking at a wall.
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

/**
 * The circle the shared arc length `s` is measured on — the same for both
 * rings, so `travelled` means the same distance whichever one a rider is on.
 *
 * **Chosen by the wide ring's outer edge, not by taste.** The race ring is four
 * lanes at `LANE_SPACING_AT_PARK_SCALE * RIDE_SCALE` = 2.6 m plus a 1.55 m
 * gauge: 9.35 m of radial width, 4.675 m of it either side of this circle. At
 * 65.5 m its innermost rail sits at 60.8 m — clear of the boundary masonry at
 * `ENTRANCE_WALL_RADIUS` (60 m) with the better part of a metre to spare, which
 * is what "outside the park" has to mean if it is to mean anything. Any smaller
 * and the inner rail is back over the wall; any larger and the outer rail walks
 * out onto the hillside for no gain.
 */
export const NOMINAL_RADIUS = 65.5;

/**
 * Metres between neighbouring rails **at park scale**. A ring's own spacing is
 * this times its {@link RailRaceRoute.scale}, so the race ring keeps the 2.6 m
 * it has always had and the walk-past ring is a genuinely narrower structure
 * rather than the same one drawn small.
 */
const LANE_SPACING_AT_PARK_SCALE = 1.04;

/**
 * The size-up of the carts, riders, rail gauge and lane spacing on the **race
 * ring** — `RailRaceRoute.scale` for that ring, and the multiplier the cart and
 * rider models take while they are on it.
 *
 * Deliberately not physics: the arc length, the undulation and every hazard's
 * position are shared with the walk-past ring, so nothing about *when* anything
 * happens in a race moves. Only how big the ring and the things riding it are.
 *
 * A scratch fix (1 August 2026) tried making the camera stand closer with a
 * wider lens instead, and hit a real ceiling: past ~120° horizontal FOV the
 * rider — pinned near the screen's edge by `RaceCamera`'s own
 * `RIDER_SCREEN_X_PORTRAIT` — grew too big for her own anchor point and
 * clipped off it, the opposite of "the character should be the focus of the
 * screen." Worse, the solve at 130° broke down numerically (a bisection that
 * had assumed a moderate lens produced a nonsense 140 m "visible ahead").
 * Scaling what is actually drawn sidesteps both problems: no camera geometry
 * to re-derive, and nothing to clip, since the anchor point itself does not
 * move.
 *
 * The value is the family's own pick from a screenshot sweep at 1.5×, 2×,
 * 2.5× and 3× — 1.5× already read clearly bigger without losing the park
 * behind her; 3× was mostly a hat filling the screen. 2.5× is the answer.
 */
export const RIDE_SCALE = 2.5;

/**
 * How high the rails fly above the ground under the nominal circle.
 *
 * Nothing in the park has to be cleared out here any more — the rings stand on
 * the empty hilltop apron outside the wall — so this is now a *sightline*
 * number rather than a clearance one: high enough that the side-on camera,
 * standing outside the ring, looks in over the boundary wall and the treeline
 * at the park rather than at masonry. Kept at the value the family already
 * approved the race's framing at rather than re-picked, and still asserted
 * against the ground it crosses by `scripts/check-rail-race.mts`.
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

/**
 * Half the radial width of the **widest** ring's lane centres.
 *
 * The level the lanes undulate about is sampled across this, not across each
 * ring's own span, so both rings come out with the *same* {@link
 * RailRaceRoute.base} to the millimetre. If they did not, swapping rings on
 * boarding would step the whole track (and the camera that follows it) up or
 * down by a few centimetres for no reason anybody could name.
 */
const WIDEST_HALF_SPAN = (((LANE_COUNT - 1) / 2) * LANE_SPACING_AT_PARK_SCALE) * RIDE_SCALE;

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
  /**
   * How big this ring is built: `1` for the walk-past ring, {@link RIDE_SCALE}
   * for the race ring. Everything with a real width — lane spacing here, rail
   * gauge and duck-bar size in `track.ts`, the cart and rider models in
   * `RailRace.ts` — derives from it, so there is exactly one number that says
   * "how big is this ring" and nothing has to be kept in step with it by hand.
   */
  readonly scale: number;

  /** The circle this ring's arc length is measured on. Shared by both rings. */
  readonly nominalRadius = NOMINAL_RADIUS;

  /** Metres between neighbouring rails **on this ring**. */
  readonly laneSpacing: number;

  /** Radius of each lane, innermost first. Lane `PLAYER_LANE` is the outermost. */
  readonly laneRadii: readonly number[];

  /** Radial distance from the innermost lane's centre to the outermost lane's. */
  readonly laneSpan: number;

  /** One lap, in metres of shared arc length. Identical on both rings. */
  readonly length = TAU * NOMINAL_RADIUS;

  /** Where the start/finish arch stands, in metres along the loop. */
  readonly startDistance: number;

  /**
   * The level the four lanes undulate about, in world metres.
   *
   * Taken from the **highest** ground anywhere under the widest ring plus
   * {@link BASE_HEIGHT}, so the promised clearance holds at the worst point
   * rather than on average — the apron outside the wall is not perfectly flat,
   * even if it is close — and so that both rings share one base exactly (see
   * {@link WIDEST_HALF_SPAN}).
   */
  readonly base: number;

  private readonly scratch = new Vector3();

  constructor(stationStallId: string, scale: number) {
    this.scale = scale;
    this.laneSpacing = LANE_SPACING_AT_PARK_SCALE * scale;
    this.laneRadii = Array.from(
      { length: LANE_COUNT },
      (_unused, lane) => NOMINAL_RADIUS + (lane - (LANE_COUNT - 1) / 2) * this.laneSpacing,
    );
    this.laneSpan = (LANE_COUNT - 1) * this.laneSpacing;

    let highest = -Infinity;
    const samples = 360;
    for (let i = 0; i < samples; i += 1) {
      const theta = (i / samples) * TAU;
      // Sampled across the full width of the *widest* ring, not just the
      // nominal circle and not just this ring's own lanes: the outer rails can
      // be over higher ground than the middle is, and both rings must agree on
      // the answer.
      for (const radius of [
        NOMINAL_RADIUS - WIDEST_HALF_SPAN,
        NOMINAL_RADIUS,
        NOMINAL_RADIUS + WIDEST_HALF_SPAN,
      ]) {
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
    // Inverted to match `angleAt`'s clockwise sign, so this really is the arc
    // length at which the ring passes the booth.
    this.startDistance = this.wrap(-bearing * NOMINAL_RADIUS);
  }

  /** Brings any arc length into `[0, length)`. */
  wrap(distance: number): number {
    const wrapped = distance % this.length;
    return wrapped < 0 ? wrapped + this.length : wrapped;
  }

  /**
   * Loop angle at an arc length.
   *
   * **Negative**, so the race runs clockwise seen from above — and that sign is
   * not arbitrary. The camera stands outside the ring looking in, which fixes
   * screen-right as `(sin θ, 0, −cos θ)`; running anticlockwise would carry
   * every rider from right to left across the picture, backwards to every
   * side-scroller a child has ever seen and backwards to the direction she
   * reads. Flipping the sign here turns the whole race round at the one place
   * that decides it, rather than leaving the camera to compensate. Measured, not
   * argued: `scripts/check-rail-race.mts` asserts a rider's screen-space motion
   * is rightward.
   */
  angleAt(distance: number): number {
    return -distance / NOMINAL_RADIUS;
  }

  /** Height of a lane's rail head, in world metres. */
  heightAt(lane: number, distance: number): number {
    return this.base + undulation(lane, this.angleAt(distance));
  }

  /** A point on a lane's rail. */
  pointAt(lane: number, distance: number, target: Vector3 = this.scratch): Vector3 {
    const theta = this.angleAt(distance);
    const radius = this.laneRadii[lane] ?? NOMINAL_RADIUS;
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
    const radius = this.laneRadii[lane] ?? NOMINAL_RADIUS;
    const horizontal = radius / NOMINAL_RADIUS;
    // d/ds of (cos θ · r, ·, sin θ · r) with θ = −s/R, so the horizontal part
    // comes out as (sin θ, −cos θ) rather than the anticlockwise (−sin θ, cos θ).
    return target
      .set(Math.sin(theta) * horizontal, this.slopeAt(lane, distance), -Math.cos(theta) * horizontal)
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
    // Chain rule, with `angleAt`'s clockwise sign: dθ/ds = −1/NOMINAL_RADIUS.
    return -dydtheta / NOMINAL_RADIUS;
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
