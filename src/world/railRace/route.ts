import { Vector3 } from 'three';
import { TAU } from '../../core/mathUtils';
import { terrainHeight } from '../terrain';
import { placedEntry } from '../parkLayout';
import { RingPath } from './ringPath';

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
 * lanes at `LANE_SPACING_AT_PARK_SCALE * RIDE_SCALE` = 2.75 m plus a 1.55 m
 * gauge: 9.80 m of radial width, 4.90 m of it either side of this circle. At
 * 65.5 m its innermost rail sits at 60.6 m — clear of the boundary masonry at
 * `ENTRANCE_WALL_RADIUS` (60 m), which is what "outside the park" has to mean if
 * it is to mean anything. Any smaller and the inner rail is back over the wall;
 * any larger and the outer rail walks out onto the hillside for no gain.
 */
export const NOMINAL_OUTSET = 6.5;

/**
 * The ring's centre line, built once and shared by both rings.
 *
 * Was `NOMINAL_RADIUS = 65.5`, a circle. The park is a spline now (59.7 m at the
 * pinch, 101.4 m at the bulge), so a concentric circle is not available at any
 * radius — see `ringPath.ts` for the measurements.
 *
 * ### Why 6.5 and not the 5.5 the old circle worked out at
 *
 * The corridor is bounded at both ends and it is narrow. The race ring's own
 * half-width is 4.90 m of lanes and gauge, which the curve's own bending widens
 * to about 5.08 m of true perpendicular reach. So:
 *
 * - **inner limit 6.15 m** — the innermost rail must stand `1.07 m` clear of the
 *   outline (a child stopped by the collision wall, plus her own radius), and
 *   `1.07 + 5.08 = 6.15`.
 * - **outer limit 6.92 m** — the outermost rail must stay inside
 *   `RIM_OUTSET_START` (12 m), where the ground starts falling 17 m away, or
 *   there is nothing to stand a trestle on. `12 - 5.08 = 6.92`.
 *
 * 6.5 sits in the middle with 0.35 m inside and 0.42 m outside. **That was 0.58
 * m either way until the cart was widened on 7 August 2026** — see
 * {@link CART_WIDTH_AT_PARK_SCALE}, which every lane is now derived from. Half
 * the remaining slack went on that fix, and it is worth knowing that this is the
 * constraint the cart's width is really trading against: the tub was reshaped
 * rather than simply scaled up precisely because a uniform widening large enough
 * to clear her arm would have wanted 1.36 here and had nowhere to put it.
 *
 * Note the old circle put
 * the innermost rail **0.825 m** outside the wall at the gate — already inside
 * that 1.07 m, so the ride was marginally clipping the masonry there before any
 * of this; the old invariant did not catch it because it compared against the
 * wall's centre line plus a player radius and forgot the stone had thickness.
 */
const RING_PATH = new RingPath(NOMINAL_OUTSET);

/**
 * **How wide a cart is at park scale — the one number the ring is built around.**
 *
 * The tub is authored in `art/blend/cart.blend`, not here, so this is a
 * *statement about the asset* rather than a second definition of it:
 * `check:cart-shape` measures the built hopper's own widest vertices and fails
 * the build if they disagree with this number. That is what stops the two
 * drifting apart, which is this repo's most common bug by a distance.
 *
 * ### 7 August 2026: 1.04 -> 1.10, because her arm came through the side
 *
 * Jim, having ridden it: *"the characters arm clips through the mine cart -
 * make the box of the cart wider until this no longer happens"*. Measured by
 * ray-casting the built hopper against every vertex her arms draw, her hand
 * reached **0.285 m outside the tub** at ride scale.
 *
 * The cause was the *taper*, not the width: the tub was 0.62 m across at its
 * floor and 1.04 m at its rim, and her hands hang only **24% of the way up that
 * wall**. So most of the fix is shape — the wall is now vertical from the bevel
 * to the rim instead of sloping — and only 0.06 m of it is extra footprint. A
 * uniform widening big enough to fix the floor would have needed 1.36 here, and
 * the corridor below has nothing like that much room.
 *
 * **1.10 is a ceiling, not a preference.** Every extra centimetre here walks the
 * outermost lane — the one the player rides — further out, and the race camera
 * stands off *that* lane round a ~22 m hairpin where it is already turning
 * tighter than she is. Swept against the park's own
 * `raceCameraNeverRunsBackwards` invariant: 1.04, 1.06, 1.08 and 1.10 pass;
 * **1.12 fails on seed 5** at 0.049 m of camera per metre of rider against its
 * 0.05 floor. So this is the widest the ring can carry, and it is enough.
 *
 * Worst remaining clearance across the four poses that move her arms: **0.058 m**
 * (seated and boost; the duck has more, and the victory jump lifts her arms clear
 * of the tub altogether). Guarded in `check:rail-race`.
 */
export const CART_WIDTH_AT_PARK_SCALE = 1.10;

/**
 * Metres between neighbouring rails **at park scale**. A ring's own spacing is
 * this times its {@link RailRaceRoute.scale}, so the race ring keeps the 2.8 m
 * of lane pitch its carts need and the walk-past ring is a genuinely narrower
 * structure rather than the same one drawn small.
 *
 * **Exactly one cart wide, and derived rather than copied.** It was an
 * independent 1.04 that happened to equal the cart's own 1.04, with nothing
 * anywhere saying they had to agree — so the four carts sat side by side with
 * zero gap by coincidence, and any widening of the cart would silently have made
 * neighbours interpenetrate. Lanes are one cart apart because a cart has to fit
 * in one; that is the rule, and this is now the only place it is written.
 */
const LANE_SPACING_AT_PARK_SCALE = CART_WIDTH_AT_PARK_SCALE;

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

/**
 * Height of a lane's rail above the level base, at loop **phase**.
 *
 * ### Phase is arc length now, and lane fairness depends on it
 *
 * This took `theta`, the compass bearing, which was interchangeable with arc
 * length while the ring was a circle (`s = R theta`). On a ring that follows the
 * park's edge they are **not** interchangeable: the ring sweeps bearing quickly
 * round the pinch and slowly round the bulge.
 *
 * Rotating the profile rigidly *in bearing* would therefore give each lane a
 * differently-stretched sequence of hills once measured in metres travelled —
 * one lane climbing more per lap than another. Lane fairness is the whole point
 * of the Rail Race; a ring where one lane is quietly easier is a ride that
 * cheats a six-year-old, and `check:rail-race` asserts `climbSpread < 0.02`
 * precisely to stop it.
 *
 * Phasing by normalised arc length keeps every lane an exact shifted copy of one
 * profile **in `s`**, so total climb per lap is identical across lanes by
 * construction rather than by luck. Integer harmonics still close seamlessly at
 * the join, because the phase advances by exactly `TAU` over one lap.
 *
 * Note this **degenerates to the old maths exactly** when the park is a circle:
 * there `length = TAU * R`, so `TAU * s / length` is `s / R`.
 */
function undulation(lane: number, phase: number): number {
  const rotated = phase + lane * LANE_ROTATION * TAU;
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

  /** The centre line this ring's arc length is measured on. Shared by both rings. */
  readonly path = RING_PATH;

  /**
   * How far outside the park's edge the ring's centre line runs.
   *
   * Replaces `nominalRadius`. A radius is no longer a statement about where the
   * ride is relative to the park — the edge is 59.7 m away on one bearing and
   * 101.4 m on another — so the number that stays meaningful is the outset.
   */
  readonly nominalOutset = NOMINAL_OUTSET;

  /** Metres between neighbouring rails **on this ring**. */
  readonly laneSpacing: number;

  /**
   * Lateral offset of each lane from the centre line, innermost first —
   * negative is toward the park. Lane `PLAYER_LANE` is the outermost.
   *
   * Was `laneRadii`, absolute radii of concentric circles. Lanes are offsets
   * along the local outward normal now, because the centre line is not a circle
   * and "radius" no longer places anything.
   */
  readonly laneOffsets: readonly number[];

  /** Distance from the innermost lane's centre to the outermost lane's. */
  readonly laneSpan: number;

  /** One lap, in metres of shared arc length. Identical on both rings. */
  readonly length = RING_PATH.length;

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
    this.laneOffsets = Array.from(
      { length: LANE_COUNT },
      (_unused, lane) => (lane - (LANE_COUNT - 1) / 2) * this.laneSpacing,
    );
    this.laneSpan = (LANE_COUNT - 1) * this.laneSpacing;

    let highest = -Infinity;
    const samples = 360;
    for (let i = 0; i < samples; i += 1) {
      const sample = RING_PATH.sampleAt((i / samples) * RING_PATH.length);
      // Sampled across the full width of the *widest* ring, not just the centre
      // line and not just this ring's own lanes: the outer rails can be over
      // higher ground than the middle is, and both rings must agree on the
      // answer. Offsets are along the local normal now rather than radial.
      for (const offset of [-WIDEST_HALF_SPAN, 0, WIDEST_HALF_SPAN]) {
        const height = terrainHeight(
          sample.x + sample.normalX * offset,
          sample.z + sample.normalZ * offset,
        );
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
    // A search, not a division: `s = -R * bearing` only held while the ring was
    // a circle. Valid because the boundary is star-shaped, so bearing is
    // monotone in arc length.
    this.startDistance = this.wrap(RING_PATH.distanceAtBearing(bearing));
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
    return RING_PATH.bearingAt(distance);
  }

  /**
   * Loop phase at an arc length — what the undulation is drawn against.
   *
   * Negative, keeping the clockwise sense `angleAt`'s doc argues for, and
   * advancing by exactly `TAU` over one lap so integer harmonics close at the
   * join. This is the quantity that used to *be* `angleAt`; the two separated
   * when the ring stopped being a circle.
   */
  phaseAt(distance: number): number {
    return (-distance / this.length) * TAU;
  }

  /** Height of a lane's rail head, in world metres. */
  heightAt(lane: number, distance: number): number {
    return this.base + undulation(lane, this.phaseAt(distance));
  }

  /** A point on a lane's rail. */
  pointAt(lane: number, distance: number, target: Vector3 = this.scratch): Vector3 {
    const sample = RING_PATH.sampleAt(distance);
    const offset = this.laneOffsets[lane] ?? 0;
    return target.set(
      sample.x + sample.normalX * offset,
      this.heightAt(lane, distance),
      sample.z + sample.normalZ * offset,
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
    const sample = RING_PATH.sampleAt(distance);
    // The horizontal part is the centre line's own tangent. It is normalised at
    // the end, so the lane's own slightly different speed through `s` (an outer
    // lane covers more ground per metre of shared arc length) falls out of the
    // ratio rather than needing the radius factor the circular version used.
    return target
      .set(sample.tangentX, this.slopeAt(lane, distance), sample.tangentZ)
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
    const rotated = this.phaseAt(distance) + lane * LANE_ROTATION * TAU;
    let dydphase = 0;
    for (const harmonic of HARMONICS) {
      dydphase += Math.cos(rotated * harmonic.n) * harmonic.amplitude * harmonic.n;
    }
    // Chain rule, against phase rather than bearing: dphase/ds = -TAU/length.
    // Still exact and still closed form — the undulation is three sinusoids in
    // a quantity that is now linear in `s`, which it was not in bearing.
    return (-dydphase * TAU) / this.length;
  }

  /**
   * The horizontal unit vector pointing **out** of the park at an arc length —
   * the direction the side-on camera stands in, and the axis the lanes are
   * stacked along.
   */
  outwardAt(distance: number, target: Vector3 = new Vector3()): Vector3 {
    // The centre line's own outward normal. On a circle this was the radial
    // direction `(cos theta, 0, sin theta)` and the two were the same vector;
    // on a curve that follows the park's edge they are not, and using the radial
    // one would lean every cart and every camera slightly the wrong way
    // wherever the boundary's radius is changing.
    const sample = RING_PATH.sampleAt(distance);
    return target.set(sample.normalX, 0, sample.normalZ);
  }
}
