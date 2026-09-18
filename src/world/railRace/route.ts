import { Vector3 } from 'three';
import { TAU } from '../../core/mathUtils';
import { capHeight, terrainHeight, upAt } from '../terrain';
import { PARK_LAYOUT, placedEntry } from '../parkLayout';
import { RingPath, type RingSample } from './ringPath';
import {
  BASE_HEIGHT,
  CART_WIDTH_AT_PARK_SCALE,
  LANE_COUNT,
  LANE_SPACING_AT_PARK_SCALE,
  NOMINAL_OUTSET,
  PLAYER_LANE,
  RIDE_SCALE,
} from './dimensions';

/**
 * The ride's dimensions live in `./dimensions.ts`, which imports nothing, and
 * are re-exported here so that the many callers reading them **inside
 * functions** did not have to change — a function body does not run at import
 * time, so those are safe through this module.
 *
 * **A caller that reads one at module scope must import `./dimensions`
 * directly.** This module is inside the `hazards` -> `route` -> `parkLayout`
 * -> ... -> `hazards` import cycle, and an indirect binding resolved through a
 * module in a cycle is still subject to that cycle's evaluation order; the leaf
 * is not. `scripts/scan-cycle-tdz.mts` finds anyone who gets this wrong, and
 * `dimensions.ts`'s own header has the full account.
 */
export {
  BASE_HEIGHT,
  CART_WIDTH_AT_PARK_SCALE,
  LANE_COUNT,
  LANE_SPACING_AT_PARK_SCALE,
  NOMINAL_OUTSET,
  PLAYER_LANE,
  RIDE_SCALE,
};

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
/** Scratch for {@link RailRaceRoute.lean} and its inverse — both are on hot paths. */
const _up = /* @__PURE__ */ new Vector3();
const _out = /* @__PURE__ */ new Vector3();
const _along = /* @__PURE__ */ new Vector3();
const _chart = /* @__PURE__ */ new Vector3();
const _station = /* @__PURE__ */ new Vector3();
/** Terrain height at the station `frameAt` last built, its fourth output. */
let _ground = 0;

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

  /**
   * How far the undulation can carry a lane from its base, either way.
   *
   * The same {@link UNDULATION_REACH} `track.ts` solves the trestles' fork
   * plane against, published on the ring so a measurement can ask the *built*
   * object rather than importing the module (which pins the seed) or keeping a
   * second copy of the number. It is a bound, not a maximum that is attained —
   * the three harmonics do not peak together — so it cannot be recovered by
   * sampling the built ring, which is exactly why it has to be published.
   */
  readonly undulationReach = UNDULATION_REACH;

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
  readonly clearance: number;

  private readonly scratch = new Vector3();

  constructor(stationStallId: string, scale: number, keepArchOff: readonly KeepOff[] = []) {
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
      //
      // **The waves, not the ground.** This used to take the highest
      // `terrainHeight` and use it as an absolute world `y` for the whole ring,
      // which held the ride level in a park that was nearly level. It is a
      // sphere now, and the boundary this ring follows runs from 58 m to 110 m
      // out — so a level ring varies its clearance over the ground by **11 m**
      // round its own circumference, riding high on one side and low on the
      // other. The ring rides the sphere instead (see `heightAt`), and what is
      // solved here is the part that is genuinely a constant: how far the
      // rolling waves stand proud of the sphere at their worst, so the promised
      // clearance still holds at the worst point rather than on average.
      for (const offset of [-WIDEST_HALF_SPAN, 0, WIDEST_HALF_SPAN]) {
        const x = sample.x + sample.normalX * offset;
        const z = sample.z + sample.normalZ * offset;
        const proud = terrainHeight(x, z) - capHeight(x, z);
        if (proud > highest) highest = proud;
      }
    }
    this.clearance = highest + BASE_HEIGHT;

    // The arch goes at the bearing of the booth that boards the ride, so the
    // rails a child can see from the queue are the rails she is about to start
    // on. She is carried out to them by the iris wipe, exactly as the other
    // rides carry her to a station she is not standing on.
    const stall = placedEntry(stationStallId);
    const bearing = Math.atan2(stall.z, stall.x);
    // A search, not a division: `s = -R * bearing` only held while the ring was
    // a circle. Valid because the boundary is star-shaped, so bearing is
    // monotone in arc length.
    const atBooth = this.wrap(RING_PATH.distanceAtBearing(bearing));
    // ...and then off the doormat it would otherwise land on. See
    // {@link slideArchClear}: on most seeds this returns `atBooth` untouched.
    this.startDistance = slideArchClear(this, atBooth, stall, keepArchOff);
  }

  /**
   * **Where a drawn point of this ride was authored** — {@link unlean} without
   * having to know the station first.
   *
   * A measurement holds a vertex or an instance matrix, not an arc length, so
   * this has to find the station the point belongs to before it can invert the
   * turn there.
   *
   * **It searches in the chart, not in the drawn world, and that is the whole
   * of the difficulty.** A drawn point stands up to twelve metres outside the
   * centre line once the lean has pushed it out, and the ring follows a spline
   * whose curvature varies — so the nearest point of the *curve* to it can
   * belong to a different part of the loop altogether. Measured on the
   * canonical seed: asking `distanceNear` of a drawn lane top answered 2.4 m of
   * arc away from the trestle it belongs to, which unleant its four tops to
   * heights up to 0.57 m wrong and made a perfectly well-built fork read as
   * 2.3 deg off its plan. Unleaning at *any* station gives a chart point within
   * a lane offset of the line, though, and at that range the projection is
   * unambiguous — no lane sits further from the centre line than a fraction of
   * the tightest bend. So: one guess, then three refinements in the chart,
   * which is a fixed point rather than a limit and settles on the first.
   */
  chartOf(drawn: { x: number; y: number; z: number }, target: Vector3): Vector3 {
    return this.unlean(this.stationOf(drawn, target), drawn, target);
  }

  /**
   * The arc length a drawn point belongs to — {@link chartOf}'s first half,
   * exposed because a shape made of several nodes has **one** station and must
   * be unleant at that one.
   *
   * Nearest-point-on-the-curve is the normal-plane condition, and on a curve
   * whose bend tightens there can be more than one station whose normal plane
   * holds a given point: an outer lane top is genuinely in two of them, and the
   * nearest is not always the one it was authored at. So a trestle asks this of
   * its **trunk top** — the one node that sits on the centre line itself, where
   * the projection is unambiguous — and unleans the whole tree there, rather
   * than letting each of its seven nodes find a station of its own and reading
   * the ring's own curvature as a bent tree. Measured before that was done: up
   * to 0.08 m of spurious height per node, which is eighty times the float32
   * slack `railRaceSupportsAreClaimedAsDrawn` compares claims to.
   */
  stationOf(drawn: { x: number; y: number; z: number }, scratch = _station): number {
    let at = RING_PATH.distanceNear(drawn.x, drawn.z);
    for (let step = 0; step < 3; step += 1) {
      this.unlean(at, drawn, scratch);
      at = RING_PATH.distanceNear(scratch.x, scratch.z);
    }
    return at;
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

  /**
   * The level this ring's lanes undulate about, **at a point on it** — what
   * `base` used to be as a single number.
   *
   * It has to be a function of position now: the ring is held a constant height
   * above the *sphere*, so its world `y` falls away round the loop exactly as
   * the world does. Anything that used to read `route.base` as "the height of
   * the ride" wants this instead, asked at its own arc length.
   *
   * **Asked at the centre line, for every lane.** It used to sample the cap
   * under each lane's own column, which reads as "a constant height above the
   * sphere" and is right for a point but wrong for a *cross-section*: the cap
   * falls 2.1 m across the race ring's 8.25 m of lanes out at the bulge, so
   * four lanes each measured from their own column are a chart shape that is
   * already tilted before the ring is leant at all — the planet counted twice.
   * The ring is one rigid section turned as a piece about this one column (see
   * {@link lean}), so the datum is this one column's too.
   */
  baseAt(distance: number): number {
    const sample = RING_PATH.sampleAt(distance);
    return capHeight(sample.x, sample.z) + this.clearance;
  }

  /** Height of a lane's rail head, in **chart** metres — see {@link lean}. */
  heightAt(lane: number, distance: number): number {
    return this.baseAt(distance) + undulation(lane, this.phaseAt(distance));
  }

  /**
   * **The chart-to-world map for the whole ring: one rigid turn per station.**
   *
   * ## The bug this replaces, measured
   *
   * Every point of this ride used to be leant by `placeOnSphere` *at its own
   * column*, which displaces it outward by `height x up.x` — and `up.x` is
   * `r / GROUND_SPHERE_RADIUS`, 0.32 to 0.46 out here. The four lanes undulate
   * on their own phases and stand up to **4.38 m apart in height at one
   * station**, so they were displaced outward by up to `4.38 x 0.46 = 2.0 m`
   * *relative to each other* — against a walk-past lane spacing of 1.1 m. The
   * cross-section was **sheared**, not leant, and the lanes crossed over one
   * another: measured on the canonical seed, a minimum drawn lateral gap of
   * **-0.284 m** where 1.1 m is nominal, with the order of lanes 2 and 3
   * swapped at 46 of 690 sampled stations. Four "parallel tracks" that pass
   * through each other.
   *
   * It is worth writing down what does *not* fix it, because it is the obvious
   * thing and it is wrong: applying the undulation along the local up *after*
   * the lean shears by exactly the same amount, because the undulation **is**
   * the height difference. Any map that moves a point outward in proportion to
   * its height shears a section that has height variation across it.
   *
   * ## What this does instead
   *
   * At each arc length the ring has one frame — the centre line's own ground
   * column, the local up there, and the two horizontals perpendicular to that
   * up. A chart point is decomposed against the *chart's* axes (the outward
   * normal, world `+Y`, the tangent) and rebuilt against that frame. It is an
   * isometry, so a cross-section keeps its shape exactly: lanes stay
   * `laneSpacing` apart, measured square to the up they are leant along.
   *
   * At the centre line with no lateral offset it is bit-for-bit
   * `placeOnSphere`, which is what the ride has always done there.
   */
  lean(distance: number, chart: { x: number; y: number; z: number }, target: Vector3): Vector3 {
    const sample = this.frameAt(distance);
    const ground = _ground;
    return target
      .set(sample.x, ground, sample.z)
      .addScaledVector(_out, (chart.x - sample.x) * sample.normalX + (chart.z - sample.z) * sample.normalZ)
      .addScaledVector(_along, (chart.x - sample.x) * sample.tangentX + (chart.z - sample.z) * sample.tangentZ)
      // flat-ok: chart height over chart ground, the number placeOnSphere takes as flat.y
      .addScaledVector(_up, chart.y - ground);
  }

  /**
   * The station's frame, into `_up` / `_out` / `_along`, and its origin.
   *
   * **Orthonormal, and built by a cross product rather than by projecting both
   * horizontals.** The first draft took `out` and `along` as the outward normal
   * and the tangent each with their `up` component removed, which looks
   * symmetric and is not a frame: `out . along` comes out at `-(N.up)(T.up)`,
   * and out here `N.up` is about 0.45 while `T.up` is whatever the ring's
   * normal misses the radial by. The map was therefore a shear rather than a
   * turn, and it cost exactly what a shear costs — measured, every drawn lane
   * top came back **9.1% of its own lane offset** away from where it was
   * authored, 0.38 m on the race ring's outer lane, which is what was left of
   * the fork angles being 2.3 deg out and the trestle claims disagreeing with
   * the registry at 13 mm.
   *
   * The tangent is the axis worth keeping true — the ring has to run along its
   * own path — so `along` is the projected tangent and `out` is the cross
   * product, which is perpendicular to both by construction rather than by
   * hope.
   */
  private frameAt(distance: number): RingSample {
    const sample = RING_PATH.sampleAt(distance);
    const ground = terrainHeight(sample.x, sample.z);
    upAt(sample.x, ground, sample.z, _up);
    _along
      .set(sample.tangentX, 0, sample.tangentZ)
      .addScaledVector(_up, -(sample.tangentX * _up.x + sample.tangentZ * _up.z))
      .normalize();
    _out.crossVectors(_along, _up).normalize();
    // The cross product's sign follows the winding, which is decided in
    // `ringPath.ts` and not worth re-deriving here: ask the outward normal
    // which way it meant, once, and flip if they disagree.
    if (_out.x * sample.normalX + _out.z * sample.normalZ < 0) _out.negate();
    _ground = ground;
    return sample;
  }

  /**
   * The inverse of {@link lean}: where a drawn point was authored.
   *
   * `terrain.ts`'s `unplaceFromSphere` is the general form of this and answers
   * to within a few centimetres out here, but it assumes a point lies on the
   * ray through its own foot — which is true of everything leant per column and
   * only nearly true of a ring leant as a rigid section. This is exact, and it
   * is what a check measuring a drawn rail against the park's own *chart*
   * boundary needs.
   */
  unlean(distance: number, drawn: { x: number; y: number; z: number }, target: Vector3): Vector3 {
    const sample = this.frameAt(distance);
    const ground = _ground;
    const dx = drawn.x - sample.x;
    // flat-ok: not a height — a displacement's y, decomposed against the frame below
    const dy = drawn.y - ground;
    const dz = drawn.z - sample.z;
    const across = dx * _out.x + dy * _out.y + dz * _out.z;
    const along = dx * _along.x + dy * _along.y + dz * _along.z;
    const rise = dx * _up.x + dy * _up.y + dz * _up.z;
    return target.set(
      sample.x + sample.normalX * across + sample.tangentX * along,
      ground + rise,
      sample.z + sample.normalZ * across + sample.tangentZ * along,
    );
  }


  /**
   * A point on a lane's rail.
   *
   * **Lifted along the local up, not along world `+Y`.** The lane's centre line
   * and its lateral offset are authored on the ground; the rail is then a
   * height above that ground, and out here that height leans. At the ring's
   * radius it puts the rail about **3.7 m further out** than the flat frame did
   * — which is not an error to be corrected but the whole of what Jim asked
   * for, and it is what makes a trestle drawn from its foot up to the rail lean
   * away from the park's centre instead of standing at an angle to its own
   * ground.
   *
   * **Leant by {@link lean}, not by `placeOnSphere` at the lane's own column.**
   * The two agree exactly on the centre line and differ by up to two metres
   * sideways on an outer lane — see {@link lean} for the lanes that crossed.
   */
  pointAt(lane: number, distance: number, target: Vector3 = this.scratch): Vector3 {
    return this.lean(distance, this.flatPointAt(lane, distance, _chart), target);
  }

  /**
   * The same point **before** it is leant onto the sphere — an (x, z) on the
   * ground and a height straight up from it, in the flat frame the whole ride
   * is authored in.
   *
   * This exists for anything that has to *build a shape* out of several route
   * points rather than just read one. A trestle is the case: its trunk, its two
   * fork nodes and its four branch tops are solved from each other, and solving
   * them from points that have each already been leant by a different amount
   * bakes the lean into the shape. Measured when that happened: the trunks came
   * out at **28 degrees** from world `+Y` where the radial is 14 — leaning
   * twice as far as the ground does, because the top had been displaced
   * outward and the foot had not.
   *
   * So: build in this frame, then lean the finished assembly. `pointAt` is
   * exactly this followed by that lean, so the two can never disagree about
   * where a rail is.
   */
  flatPointAt(lane: number, distance: number, target: Vector3 = this.scratch): Vector3 {
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

/** Something the arch's feet must not come down on. */
export interface KeepOff {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * Slides the finish line along the ring until the arch's feet are off
 * everything a foot must not stand on.
 *
 * **The arch and the booth's doormat are placed by the same bearing, so on some
 * seeds they are placed on top of each other.** The arch is centred on the ring
 * at the boarding booth's bearing (just above), and its feet march inward along
 * that same radial — which is exactly where the doormat sits and where the spur
 * that serves it has to arrive. Measured on seed 11: six inner feet from
 * (67.4, -21.4) to (65.1, -19.9), straddling a doormat at (65.9, -20.7), with
 * the paving 1.14 m *inside* a leg. `paths.ts` routes around published
 * obstacles but cannot route around that one — a spur has to reach the door it
 * serves — so the arch is what gives.
 *
 * Moving `startDistance` moves the finish line **and everything measured from
 * it together**: the duck bars, the spark zones, `RACE_DISTANCE`, the cart
 * placement and the invariants that check them all read `startDistance`, so
 * this is the one lever that cannot desynchronise them. Nudging `buildArch`'s
 * own local copy instead would decouple the drawn finish from the scored one.
 *
 * ### Why it must clear more than the doormat
 *
 * A first cut checked the doormat and the plots only. It turned seed 11 green
 * and **turned seed 5 red on two tests** — because `startDistance` is the whole
 * ride's datum, so moving the arch moved the ride, onto the Sky Cruiser's loop.
 * One failure traded for two. Everything the datum can collide with has to be
 * in the list or this is a game of whack-a-mole: the doormat and the plots
 * here, and the ride's own exit and the cruiser's loop passed in as
 * {@link KeepOff} by `plan.ts`, which is the module that can see them.
 *
 * Everything asked about is **plan-time** data — no path exists yet when a
 * route is constructed. The doormat and the exit are what the paving is
 * obliged to reach, so keeping clear of them keeps clear of their spurs by
 * construction.
 *
 * Offsets are tried smallest first, alternating sides, so a park with no
 * conflict keeps its finish line exactly where the booth's bearing put it.
 */
function slideArchClear(
  route: RailRaceRoute,
  atBooth: number,
  stall: { readonly entranceX: number; readonly entranceZ: number },
  keepOff: readonly KeepOff[],
): number {
  const probe = new Vector3();
  const outward = new Vector3();
  const clears = (at: number): boolean => {
    const sample = route.path.sampleAt(at);
    route.outwardAt(at, outward);
    // The whole span the feet occupy, inner and outer, sampled every half
    // metre: the feet are two lines of six, not a point, and it is the lines
    // that have to miss.
    for (let radius = -ARCH_FOOT_REACH; radius <= ARCH_FOOT_REACH; radius += 0.5) {
      probe.set(sample.x + outward.x * radius, 0, sample.z + outward.z * radius);
      const toDoor = Math.hypot(probe.x - stall.entranceX, probe.z - stall.entranceZ);
      if (toDoor < ARCH_DOORMAT_CLEARANCE) return false;
      for (const plot of PARK_LAYOUT.entries.values()) {
        if (Math.hypot(probe.x - plot.x, probe.z - plot.z) < plot.boundingRadius + 1) return false;
      }
      for (const item of keepOff) {
        if (Math.hypot(probe.x - item.x, probe.z - item.z) < item.radius) return false;
      }
    }
    return true;
  };
  if (clears(atBooth)) return atBooth;
  for (let step = 1; step <= 60; step += 1) {
    for (const side of [1, -1] as const) {
      const at = route.wrap(atBooth + side * step * 0.75);
      if (clears(at)) return at;
    }
  }
  // Nothing on the whole ring works — keep the booth's own bearing and let the
  // procgen invariant say so out loud rather than putting the finish line
  // somewhere arbitrary.
  return atBooth;
}

/**
 * How far the arch's feet reach from the ring's centre line.
 *
 * `archFeet` owns the exact radii; this is the generous bound the search needs,
 * kept here because importing `arch.ts` would close a cycle (it needs
 * `RailRaceRoute`). Over-stating the reach only makes the search more cautious.
 */
const ARCH_FOOT_REACH = 22;

/**
 * How much room the arch's feet keep from the booth's doormat.
 *
 * 6 m, measured rather than chosen: a spur is ~2.4 m of paving, a leg needs
 * `WALKABLE_GAP`'s 1.24 m beside it, and the doormat has its own approach to
 * stand in. On seed 11 this leaves the nearest inner foot 4.2 m from the
 * nearest path where it used to be 1.14 m *inside* it; at 3.2 m it was still
 * 0.46 m inside, because the strip inward of the booth carries the exit's spur
 * as well as the booth's own.
 */
const ARCH_DOORMAT_CLEARANCE = 6;
