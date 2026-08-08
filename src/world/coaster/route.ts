import { CatmullRomCurve3, Vector3 } from 'three';
import { Rng, TAU } from '../../core/mathUtils';
import { PARK_SEED } from '../parkManifest';
import { CART_ENVELOPE } from './cart';
import { clearOfFootprints, PARK_LAYOUT, placedEntry } from '../parkLayout';
import { terrainHeight } from '../terrain';
import { circleBoundary, insetBoundary, PARK_BOUNDARY, solverBoundary } from '../boundary';
import {
  type RouteBrief,
  type RouteInfluence,
  type SolvedRailRoute,
  solveRailRoute,
} from '../rail/generate';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from '../building/layout';
import { type Pose2, type SegmentKind, type Vec2, turnVocabulary } from '../rail/segments';
import {
  CASTLE_OUTER_X,
  WINDOW_HALF_WIDTH,
  WINDOW_TRACK_Y,
  castleClear,
  castleY,
  crossingBand,
  insideCastleFootprint,
} from '../building/cruiserWindow';

/**
 * The coaster's track — grown, not authored (Decision 4 C4 on Decision 5's
 * generated park).
 *
 * A closed loop in the park's middle, elevated so it flies over lawns, paths,
 * stalls and the train, and steered *horizontally* around the two things too
 * tall to fly over — the castle and the ferris wheel. The height profile is
 * seeded hills over a cruise floor, with a dip to boarding height at the
 * station, which sits beside the old rail racer stall: that booth is now the
 * way onto the real ride.
 *
 * Everything here is solved from the layout, so moving the manifest re-grows
 * the coaster along with everything else.
 *
 * ### The horizontal solve moved out (issue #112)
 *
 * The loop used to be a **radius per bearing** — 240 spokes about the origin,
 * relaxed until none of them landed in the castle. That representation had two
 * problems, and the second one shipped a visible bug.
 *
 * It could only express star-shaped loops. A track that doubles back, or runs
 * beside itself, or leaves the middle of the park at all, is not a function of
 * bearing and could not be said.
 *
 * Worse, the relaxation **smoothed the radii after pushing them out of the
 * obstacles, and never re-measured** (the old lines 139-143). Smoothing a spoke
 * that had just been pushed clear of the castle pulled it back in, and nothing
 * downstream checked: the horizontal side had no equivalent of the vertical
 * pipeline's measure-the-finished-curve repair loop, and no test measured
 * castle clearance at all. That is issue #113 — the cruiser has been clipping
 * the castle in plain sight.
 *
 * Now the plan-view shape comes from `rail/generate.ts`, which lays pieces of
 * track end to end and **rejects a piece that hits something** rather than
 * placing it and smoothing afterwards. There is no post-hoc smoothing step to
 * undo the avoidance, because avoidance is a precondition of a piece existing.
 *
 * ### What stayed
 *
 * The vertical pipeline, which was always the well-tested half: cruise floor,
 * seeded hills, the station carve, and the repair loop that measures the built
 * curve and lifts control points under any sag. It is unchanged in substance,
 * but it is now authored **along arc length** instead of along bearing. That
 * deletes a whole class of bug rather than fixing one: the carve used to have
 * to convert a bearing window into metres at an assumed radius, and got it
 * wrong for a station pulled further out. Arc length is already metres.
 */

/** Cruise floor: above trees (~4 m), garlands (≤5.2 m) and the train (2.6 m). */
export const CRUISE_FLOOR = 6.2;

/** Boarding height at the station, and the flat length either side. */
export const STATION_HEIGHT = 1.1;
const STATION_FLAT = 9;
const STATION_RAMP = 26;

/**
 * How far out the loop may reach.
 *
 * How far in from the park's edge the loop's territory stops.
 *
 * This was `OUTER_RADIUS = 47`, a circle that stood for "inside the train's
 * band" while the park was a disc. The park is a spline now and the plots
 * spread across all of it (issue #241) — the coaster's own station stall can
 * legally stand past 47 m — so the territory is the park itself, inset far
 * enough that the rim band stays substantially the train's: the train hugs
 * the wall at about 3.35 m in, and this keeps the coaster's *corridor*
 * (which the generator already holds a `corridorRadius` inside its boundary)
 * from camping on the same ground. Crossings still happen and are legal —
 * clearance between the two is vertical, ratcheted by `check:park` — this
 * only keeps the coaster from *running along* the train's lane.
 */
// 4, from 6: measured on seed 2, the pinched side of the spline left the
// loop only FOUR closed routes in four thousand attempts — the annulus
// between the castle band and a 6 m inset simply pinched shut. Two metres
// back buys closure everywhere; the trains-vs-coaster separation was never
// horizontal anyway (crossings are governed vertically, ratcheted).
const RIM_INSET = 4;

/**
 * Half-width kept clear either side of the centre line while solving.
 *
 * This is what the generator *aims* for, deliberately far more than the ride
 * physically needs, so a solved loop has room to breathe rather than shaving
 * past the castle.
 */
const CORRIDOR_RADIUS = 3;

/**
 * Half a car, in metres — now read from `coaster/cart.ts` rather than restated.
 *
 * The width at which the ride stops missing something and starts hitting it,
 * and so the threshold the boot assert uses. Emphatically **not**
 * {@link CORRIDOR_RADIUS}: asserting the generator's own target would only
 * prove it can do arithmetic, so an assert set there would cry wolf at the
 * first retune.
 */
const CAR_HALF_WIDTH = CART_ENVELOPE.halfWidth;

/** How close the loop may come to an earlier part of itself. */
const SELF_CLEARANCE = 5;

/**
 * **Tightest turn the ride will make** — a promise about the curve riders are
 * actually on, not about the plan it was grown from.
 *
 * The old polar solve produced a **1.7 m** minimum radius — a hairpin, at
 * cruise speed, measured on the built curve by `scripts/measure-rail-radii.mts`.
 * Nothing asserted it because nothing measured it. Twelve metres is a turn a
 * six-year-old enjoys rather than one that throws them at the restraint, and
 * it keeps the family's "Sky Cruiser is the tightest of the three" ordering
 * comfortably (the Rail Race ring is 57 m).
 *
 * `scripts/check-cruiser-turn-radius.mts` holds the built curve to this, and it
 * is the number the procgen invariant measures. See {@link PLAN_TURN_RADIUS}
 * for why the generator is asked for something stricter.
 */
export const MIN_TURN_RADIUS = 12;

/**
 * What the *plan* is held to, which is deliberately more than the ride
 * promises.
 *
 * The generator validates radii on its own cubics, but `CoasterRoute` does not
 * ship those cubics: it resamples them into control points and rebuilds them as
 * a `CatmullRomCurve3`, and **a rebuild is not a copy**. The spline through
 * sampled points sags away from the curve the points came from, and it sags
 * most at the tightest bends — precisely the ones under a limit. Measured
 * across the five CI seeds at the original 3 m control spacing, the rebuild ate
 * between 0.73 m and 1.38 m of radius, and two seeds landed under the 12 m the
 * ride claims: seed 2 at 11.68 m, seed 18 at 10.98 m.
 *
 * That is the same mistake this whole generator replaced. The old solver pushed
 * its control points clear of the castle and then smoothed them, so the built
 * curve did not respect what had been validated. Validating a plan and shipping
 * a rebuild of it is that bug one layer down, in newer code.
 *
 * The fix is both halves, because either alone is thin. {@link CONTROL_SPACING}
 * makes the rebuild faithful, which is the actual cause; this headroom covers
 * what is left, because the loss is not a smooth function of spacing — it
 * depends where a control point happens to fall relative to the tightest bend,
 * so a margin that merely *happens* to hold on today's five seeds is luck, not
 * a guarantee.
 */
const PLAN_TURN_RADIUS = MIN_TURN_RADIUS + 1;

/** Metres of track wanted. The old loop came out at 221 m; this holds that. */
const DESIRED_LENGTH = 220;

/**
 * Air the coaster keeps above the train's railhead wherever their plan
 * positions come within 4 m — Decision 4's clearance rule, generalised. One
 * constant, shared by the vertical repair (which lifts to honour it) and the
 * boot assert (which measures it), so they cannot drift apart.
 */
export const RAIL_OVER_RAIL_AIR = 5.5;


/**
 * Roughly this far apart, in metres, along the loop.
 *
 * Two metres rather than the three it started at. This is the half of the
 * turning-radius fix that addresses the cause rather than the symptom: closer
 * control points mean the rebuilt spline tracks the solved plan more closely,
 * which took the worst rebuild loss across the CI seeds from 1.38 m to 0.46 m.
 *
 * Not finer still, because the vertical repair loop below works in control
 * points and starts to get grainy when they are packed tighter than its own
 * scan; two metres keeps the two in step. The rest of the margin is bought by
 * {@link PLAN_TURN_RADIUS} instead.
 */
const CONTROL_SPACING = 2;


interface TallObstacle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * What the plan-view search must route *around*, as circles on the ground.
 *
 * **This is an input to the generator, not a claim about the ride**, and the
 * difference is the whole reason it survives while the identically-shaped list
 * in `test/procgen/invariants.ts` was retired (#198). The solver has to be told
 * where not to go *before* there is a route to measure; a swept measurement can
 * only ever be taken afterwards. So the two are not alternatives, and replacing
 * this with one would simply let the loop grow through the big wheel and then
 * complain about it.
 *
 * What it must **not** be read as is a list of everything in the coaster's way.
 * The comment here used to say the 6.2 m cruise floor "clears the trees, the
 * garlands and the train", so that the wheel and the castle were "the only
 * horizontal obstacles the loop actually has". That was false: a canopy reaches
 * 6.68 m against a 6.04 m underside at cruise, and the profile dips far below
 * cruise at the station and at the castle anyway. Whether the built ride hits
 * anything is now measured against the built park by `coaster/clearance.ts`,
 * run by `check:cruiser-clearance` and by the procgen suite on every seed.
 *
 * Unlike the old code, the track's own width is *not* baked in here — the
 * generator is told the corridor radius separately, so an obstacle stays an
 * obstacle and a corridor stays a corridor.
 */
/**
 * How far the RiPika statue's *tall* part reaches from the middle of the
 * fountain, in metres.
 *
 * Measured on the built park rather than declared: every mesh under the
 * fountain's own root whose bounds top out above the car's underside at cruise
 * (6.04 m) reaches **3.47 m** from `PARK_LAYOUT.fountain`, and the statue's
 * crown stands at 10.81 m.
 *
 * **Deliberately the statue and not the fountain's plot**, whose bounding
 * radius is 10.5 m. The plaza is the park's social middle and the Sky Cruiser
 * is *allowed* to fly over it — the basin and its rim are barely a metre tall.
 * The only thing here it cannot fly over is the statue, so the only thing it
 * has to go round is the statue. Routing the loop around the whole plot would
 * be avoiding the wrong shape, and would over-constrain a solver that already
 * gives up on some seeds.
 *
 * The corridor is supplied separately (see {@link CORRIDOR_RADIUS}), so this is
 * the obstacle and not the obstacle-plus-clearance.
 */
const STATUE_TALL_RADIUS = 3.5;

function tallObstacles(): TallObstacle[] {
  const wheel = placedEntry('ferrisWheel');
  return [
    { x: wheel.x, z: wheel.z, radius: wheel.boundingRadius },
    // The RiPika statue in the fountain (#121/#200). It reaches 10.81 m against
    // a 6.2 m cruise floor, so it is the same category as the big wheel: a thing
    // the loop cannot fly over and must go round.
    //
    // It was missing here, and the omission was invisible until two branches
    // met. The statue merged (#200) with no cruiser sweep to run, and the castle
    // pass (#113) re-solved the loop from 216 m to 185 m; on the new route four
    // of five seeds sent the car **through the statue's head**, at 8.84 m up.
    // The ride is `camera: 'firstPerson'`, so that is a screen full of the
    // inside of a stone head rather than a mesh brushing past unseen.
    //
    // Nothing kept the loop off the plaza at all before this, which is the
    // actual hole; the statue merely made it visible.
    { x: PARK_LAYOUT.fountain.x, z: PARK_LAYOUT.fountain.z, radius: STATUE_TALL_RADIUS },
  ];
}

/**
 * How far from the middle of a side wall panel a crossing may land.
 *
 * See `building/cruiserWindow.ts`: derived from the tower's own bite out of the
 * panel, the masonry that has to survive beside the opening, and the opening's
 * width — which is itself the car's width plus clearance. Nothing here is a
 * chosen position.
 */
const CROSSING_BAND = crossingBand(WINDOW_HALF_WIDTH);

/**
 * **The Sky Cruiser asks to be drawn through the castle.**
 *
 * The family's ask is that the ride *always* flies through it, and before this
 * it did not: the generator returns the first route that fits, and on one CI
 * seed in five that route simply closed before it got to the castle, leaving a
 * child an ordinary loop and an unbroken building. Nothing was wrong with those
 * routes — nothing had ever asked them for anything.
 *
 * So the ask is made where the choice is made. `weight` is deliberately modest:
 * the score it competes in carries up to 12 m of seeded jitter, and at 0.3 a
 * 40 m detour is worth about the same, which tilts the search without
 * flattening the variety that makes each park its own. The result is a
 * *tendency*; {@link crossesTheCastle} is what turns a tendency into a promise.
 *
 * `radius` is the castle's own outer half-width plus a little, so the pull
 * switches off once the route is at the walls rather than going on tugging it
 * around a building it has already reached.
 *
 * **This reserves nothing** (Decision 6, and Decision 7 which records this
 * mechanism). No space is held for the ride and no opening exists until the
 * built curve is measured; the influence only changes which routes the search
 * is likely to find first.
 */
const CASTLE_INFLUENCE: RouteInfluence = {
  name: 'the castle',
  x: BUILDING_CENTRE_X,
  z: BUILDING_CENTRE_Z,
  radius: CASTLE_OUTER_X + 2,
  // 0.55, from 0.3 (issue #241): with the manifest unpinned the booth lands
  // anywhere on its 21-26 m ring around the castle, including bearings where
  // a free solve naturally closes AWAY from the walls — seed 2 exhausted
  // every start pose without one castle crossing at the old weight. Measured
  // across the five CI seeds at 0.55 the backstop still fires (so the weight
  // is not doing the satisfies' job alone), and every seed crosses.
  weight: 0.55,
};

/**
 * Does this solved plan actually pass through the castle?
 *
 * The backstop behind {@link CASTLE_INFLUENCE}. A weight makes the crossing
 * likely; this is what makes it required — a route that solves without one is
 * discarded and the search moves to the next start pose.
 *
 * It asks the same question `spanInsideCastle` asks of the finished curve, of
 * the plan, which is the only thing that exists at this point. The two
 * parameterisations differ by about 1.5%, which is why the real span is
 * re-measured on the built curve later; for "does it go in at all" the plan is
 * exact enough, and being slightly stricter here is the safe direction.
 */
function crossesTheCastle(candidate: SolvedRailRoute): boolean {
  return (
    spanInsideCastle((d, into) => candidate.pointAt(d, into), candidate.length) !== null
  );
}

/** Metres of level flight held either side of the castle before the hills resume. */
const WINDOW_FLAT = 5;

/**
 * Metres the profile takes to blend from window height back to the hills.
 *
 * Shorter than the station's 26 m ramp on purpose: the station ramp has to be
 * gentle because riders are boarding at walking pace, whereas this is mid-ride
 * at cruise and a brisker rise and fall *is* the moment — the loop drops to
 * thread the window and climbs away again.
 */
const WINDOW_RAMP = 16;

/** How far outside the castle's footprint the level run starts and ends. */
const CASTLE_SPAN_PAD = 2;

/**
 * The stretch of the solved plan that runs inside the castle, in metres along.
 *
 * `to` may exceed the loop's length, meaning the stretch wraps through the
 * loop's start — which it is perfectly entitled to do, and getting that wrong
 * would silently carve the wrong half of the ride. Found by taking every
 * sample that lands inside the footprint and keeping the complement of the
 * **largest cyclic gap** between them, which is exact for the ordinary case of
 * one visit and degrades sanely to "the whole visit" if a loop ever managed two.
 */
function spanInsideCastle(
  sampleAt: (distance: number, into: Vec2) => void,
  length: number,
): { from: number; to: number } | null {
  const probe: Vec2 = { x: 0, z: 0 };
  const inside: number[] = [];
  for (let d = 0; d < length; d += 0.5) {
    sampleAt(d, probe);
    if (insideCastleFootprint(probe.x, probe.z, CASTLE_SPAN_PAD)) inside.push(d);
  }
  if (inside.length === 0) return null;
  let widestGap = -Infinity;
  let gapAt = 0;
  for (let i = 0; i < inside.length; i += 1) {
    const here = inside[i]!;
    const next = inside[(i + 1) % inside.length]!;
    const gap = i === inside.length - 1 ? next + length - here : next - here;
    if (gap > widestGap) {
      widestGap = gap;
      gapAt = i;
    }
  }
  const from = inside[(gapAt + 1) % inside.length]!;
  const to = inside[gapAt]!;
  return { from: from - 0.5, to: (to >= from ? to : to + length) + 0.5 };
}

/** Metres from `s` to the nearest end of a (possibly wrapping) span; 0 inside. */
function outsideSpan(span: { from: number; to: number }, s: number, length: number): number {
  const shifted = s < span.from ? s + length : s;
  if (shifted >= span.from && shifted <= span.to) return 0;
  const before = span.from - s < 0 ? span.from - s + length : span.from - s;
  const after = shifted - span.to;
  return Math.min(Math.abs(before), Math.abs(after));
}

/** Is the ground at (x, z) free of every plot? Layout only, no scene. */
function groundClearOfPlots(x: number, z: number, radius: number, exceptId?: string): boolean {
  for (const entry of PARK_LAYOUT.entries.values()) {
    // A station's own booth is the thing it is parked next to, not something
    // to keep away from; the ring the candidate sits on is what keeps the
    // track out of the booth itself.
    if (entry.id === exceptId) continue;
    if (Math.hypot(x - entry.x, z - entry.z) < entry.boundingRadius + radius) return false;
  }
  return true;
}

/** The pieces the Sky Cruiser is built from. `MIN_TURN_RADIUS` lives here. */
const CRUISER_VOCABULARY: readonly SegmentKind[] = turnVocabulary(
  [
    // Widening these to compensate for the raised floor was tried and made
    // things worse (18 of 21 seeds, against 20 before): the vocabulary is not
    // the binding constraint, and changing it mostly reshuffles which seeds get
    // lucky. The search budget is the lever that actually moved.
    { name: 'tight', minRadius: PLAN_TURN_RADIUS, maxRadius: 18, minLength: 16, maxLength: 28 },
    { name: 'sweep', minRadius: 18, maxRadius: 32, minLength: 22, maxLength: 38 },
    { name: 'easy', minRadius: 32, maxRadius: 60, minLength: 26, maxLength: 46 },
  ],
  { minLength: 22, maxLength: 40 },
);

export interface CoasterRouteOptions {
  /** Seed salt, so two coasters in one park grow different loops. */
  readonly salt: number;
  /** The stall whose booth is this ride's station. */
  readonly stationStallId: string;
  /** Circular territory override. Defaults to the park inset {@link RIM_INSET}. */
  readonly outerRadius?: number;
  /** Metres of track wanted. Defaults to {@link DESIRED_LENGTH}. */
  readonly desiredLength?: number;
  /**
   * Another coaster to keep clear of.
   *
   * This is now a term in the generator's collision predicate rather than a
   * push applied during a relaxation, which means a piece that would run too
   * close to the other loop is simply never placed. The old comment here
   * claimed `checkCoasterClearances` asserted the gap afterwards; it never did.
   */
  readonly avoid?: CoasterRoute | null;
}

/**
 * Candidate stations, best first.
 *
 * The station is where the loop **starts and ends**, so choosing it is the
 * outermost level of the generator's search: when no loop can be grown from
 * one station, the next is tried. `train/plan.ts` does the same thing when
 * `clearStationDistance` slides a station along the track until its platform
 * stands on clear ground — a station's position is a thing to search for, not
 * a thing to assume.
 *
 * A candidate only qualifies if the **ground through the station window is
 * clear**. Everywhere else the coaster flies at `CRUISE_FLOOR` and only the two
 * tall obstacles matter, but at the station it is down at 1.1 m, in among the
 * scenery, where every plot is in its way. Putting that constraint on the start
 * pose keeps the plan-view search itself simple and purely horizontal.
 */
function stationPoses(
  stallId: string,
  rng: Rng,
  boundary: ReturnType<typeof circleBoundary>,
): Pose2[] {
  const stall = placedEntry(stallId);
  const poses: { pose: Pose2; key: number }[] = [];
  // Beside the booth, not a walk away from it: the old solve put the track
  // about 4.5 m out from the stall, and a station much further than that stops
  // reading as the thing the booth boards. It also has to stay inside the
  // loop's own outer limit, and the cruiser's stall is already 34 m from the
  // middle of the park, so there is not much room to spare on the outward side.
  //
  // Offering plenty of candidates is not generosity, it is the thing that makes
  // this solve at all: a first cut offered six and the search failed on every
  // one. Each is cheap to propose and the search abandons a bad one quickly.
  for (let ring = 0; ring < 11; ring += 1) {
    const distance = 5 + ring;
    for (let i = 0; i < 64; i += 1) {
      const angle = (i / 64) * TAU;
      const x = stall.x + Math.cos(angle) * distance;
      const z = stall.z + Math.sin(angle) * distance;
      // Two headings per spot: the track may run past the booth either way.
      for (const sign of [1, -1] as const) {
        const hx = -Math.sin(angle) * sign;
        const hz = Math.cos(angle) * sign;
        const pose: Pose2 = { x, z, hx, hz };
        if (!stationWindowIsClear(pose, boundary, stallId)) continue;
        // Plain seeded shuffle, and it is worth recording what was tried
        // instead, because both alternatives were worse.
        //
        // Ordering the roomiest first — march along the heading, see how far
        // you get, prefer the longest run — was *slower*: the roomiest stations
        // all sit in the same open corner and fail the same way, so the search
        // ground through dozens of near-identical hopeless starts before
        // reaching a genuinely different one.
        //
        // Using that same measurement as a filter was catastrophic: it cut
        // every seed from solvable to unsolvable. A straight line along the
        // heading is a bad predictor of whether a *curved* route can leave the
        // station, and it threw away precisely the stations that work.
        //
        // Diversity beats cleverness here.
        poses.push({ pose, key: rng.unit() });
      }
    }
  }
  poses.sort((a, b) => a.key - b.key);
  return poses.map((entry) => entry.pose);
}


/**
 * Is the low, flat run through a candidate station on clear ground?
 *
 * Checked along the pose's heading in both directions: the loop leaves the
 * station along that heading and — because closure matches the tangent —
 * arrives along it too, so a straight line is a fair stand-in for the track
 * either side of the platform.
 */
function stationWindowIsClear(
  pose: Pose2,
  boundary: ReturnType<typeof circleBoundary>,
  ownStallId: string,
): boolean {
  // The platform deck and a little either side — not the whole ramp.
  //
  // This window is the single thing that decides how many stations the search
  // gets to choose from, and it was originally far too greedy. Demanding the
  // full flat plus ramp be clear of every plot asked for 22 m of empty ground
  // in a park whose plots are laid out with 5 m corridors between them: it
  // offered 2 to 24 candidate stations depending on the seed, and four seeds
  // out of five then had no solvable loop from any of them.
  //
  // The deck itself is 6 m long (`plan.ts`), and past it the track is already
  // climbing away, so this is what genuinely has to be standable.
  const reach = 6;
  for (let along = -reach; along <= reach; along += 2) {
    const x = pose.x + pose.hx * along;
    const z = pose.z + pose.hz * along;
    if (!groundClearOfPlots(x, z, 1.2, ownStallId)) return false;
    if (boundary.distanceToEdge(x, z) < CORRIDOR_RADIUS) return false;
  }
  return true;
}

export class CoasterRoute {
  readonly curve: CatmullRomCurve3;
  readonly length: number;
  /** Metres along the loop of the station's centre. */
  readonly stationDistance: number;
  /** Highest crest height above ground, for the chain-lift feel. */
  readonly crestY: number;
  /** The solved plan-view centre line, kept for diagnostics and the asserts. */
  readonly plan: SolvedRailRoute;
  /**
   * The stretch of the loop that runs inside the castle, in metres along, or
   * `null` on a seed whose loop went round it instead.
   *
   * **Null is a normal park, not a failure.** Nothing places the loop at the
   * castle; if the search never went that way there is no level run, no window
   * and no hole in the wall, and that park simply has an unbroken castle. Every
   * consumer of this — the wall builder, the boot assert, the invariant — has
   * to treat it as optional, or the first seed that misses would fail a build
   * for doing exactly what it is allowed to do.
   */
  readonly castleSpan: { readonly from: number; readonly to: number } | null;

  private readonly scratch = new Vector3();

  constructor(options: CoasterRouteOptions) {
    const rng = new Rng(PARK_SEED ^ options.salt);
    const stall = placedEntry(options.stationStallId);
    const obstacles = tallObstacles();
    const other = options.avoid ?? null;
    const boundary =
      options.outerRadius !== undefined
        ? circleBoundary(options.outerRadius)
        : solverBoundary(insetBoundary(PARK_BOUNDARY, RIM_INSET));

    // --- horizontal: the generator solves the plan view --------------------
    const wantedLength = options.desiredLength ?? DESIRED_LENGTH;
    const lowWindow = STATION_FLAT + STATION_RAMP * 0.65;
    const clear = (x: number, z: number, radius: number, distanceAlong: number): boolean => {
      for (const tall of obstacles) {
        if (Math.hypot(x - tall.x, z - tall.z) < tall.radius + radius) return false;
      }
      if (!castleClear(x, z, radius, CROSSING_BAND)) return false;
      if (other) {
        const nearest = other.nearestPoint(x, z);
        if (Math.hypot(nearest.x - x, nearest.z - z) < 5 + radius) return false;
      }
      // The station and its ramps are the one stretch that flies LOW, and the
      // vertical repair may never lift it (a half-lift tilts the boarding
      // deck) — so while the track is below cruise height it must only ever
      // be over open ground: no plot may sit under the ramp. Footprints, not
      // bounding circles, because the near-relation deliberately parks this
      // ride's booth beside the castle and the castle's 19 m circle would
      // reject every pose the relation just arranged. This is what keeps the
      // ramp out of the ball pit's balls and everyone's roofs; the TRAIN
      // dodges the published low corridor itself (train/route.ts), because
      // it solves later and threads intervals — Decision 6's arrow: publish
      // what you solved, the next system treats it as an obstacle.
      // The castle is EXEMPT from the low-ground rule: the booth is parked
      // beside it by the near relation and the ride legally passes through
      // its walls, so pieces near the station are always near the castle —
      // holding them to its footprint made the search reject nearly every
      // early piece and burn its whole restart budget (measured: the solve
      // went 31 s with the blanket rule, 1.1 s without it; the castle's own
      // safety is `castleClear`'s crossing-band rule, checked above, plus
      // the carved pass). Every OTHER plot keeps the rule — a boarding ramp
      // through the ball pit's balls is what it exists to stop (seed 18).
      const nearStation = distanceAlong < lowWindow || distanceAlong > wantedLength - lowWindow;
      if (nearStation && !clearOfFootprints(x, z, radius + 0.6, 'building')) return false;
      return true;
    };
    const brief: RouteBrief = {
      // A stream of its own, so changing how many random draws the height
      // profile takes cannot silently reshape the loop.
      seed: PARK_SEED ^ options.salt ^ 0x5a17,
      vocabulary: CRUISER_VOCABULARY,
      desiredLength: options.desiredLength ?? DESIRED_LENGTH,
      closed: true,
      startPoses: stationPoses(options.stationStallId, rng, boundary),
      clear,
      boundary,
      corridorRadius: CORRIDOR_RADIUS,
      selfClearance: SELF_CLEARANCE,
      minRadius: PLAN_TURN_RADIUS,
      // Enough that the cap is never the thing that gives up (Decision 6:
      // "only bail if backtracking fails for a very large number of tries").
      //
      // `stationPoses` offers 210 candidates on the canonical seed and the
      // search takes index 0, so at 200 this abandoned the last ten for no
      // reason — and the reason it can afford not to is measured, not hoped:
      // `npm run measure:solver-budget` times a deliberately unsolvable brief
      // at **24 ms for 200 attempts, 89 ms for 1000 and 483 ms for 5000**,
      // about 0.1 ms each. A successful solve stops at the first start pose
      // that works, so this costs nothing on a park that works; the whole cost
      // lands on one that does not, and a park that bails is far worse than a
      // park that took a fifth of a second longer to decide it could not.
      budgets: { perJoint: 16, restarts: 2000 },
      // The family asked that the ride always flies through the castle. The
      // influence makes that likely at the decision point; the backstop makes
      // it required. See `CASTLE_INFLUENCE` and `crossesTheCastle`.
      influences: [CASTLE_INFLUENCE],
      satisfies: crossesTheCastle,
    };
    let plan = solveRailRoute(brief);
    if (!plan.report.satisfied) {
      // The escalation valve Decision 7 implies but never built: a weight
      // makes the castle crossing likely, the backstop makes it required —
      // and on a seed where the geometry fights (the booth's bearing, the
      // spread plots), a fixed weight can exhaust every start pose without
      // one crossing. Rather than raise the weight for every park until the
      // hardest seed passes (which makes every OTHER park's loop less free —
      // the cost Decision 7 warns about), the seeds that need more pull are
      // the only ones that pay for it: one re-solve, twice the weight.
      plan = solveRailRoute({
        ...brief,
        seed: brief.seed ^ 0xe5ca,
        influences: [{ ...CASTLE_INFLUENCE, weight: CASTLE_INFLUENCE.weight * 2 }],
      });
    }
    this.plan = plan;

    const controls = Math.max(24, Math.round(plan.length / CONTROL_SPACING));
    const flat: Vec2[] = [];
    const probe2: Vec2 = { x: 0, z: 0 };
    for (let i = 0; i < controls; i += 1) {
      plan.pointAt((i / controls) * plan.length, probe2);
      flat.push({ x: probe2.x, z: probe2.z });
    }

    // Where along the plan the station sits — measured, not assumed to be zero,
    // even though the loop starts there.
    let stationS = 0;
    let bestToStall = Infinity;
    for (let d = 0; d < plan.length; d += 1) {
      plan.pointAt(d, probe2);
      const toStall = Math.hypot(probe2.x - stall.x, probe2.z - stall.z);
      if (toStall < bestToStall) {
        bestToStall = toStall;
        stationS = d;
      }
    }

    // --- vertical: seeded hills over the cruise floor ----------------------
    // Authored along **arc length**, in metres. Integer harmonics of the loop
    // fraction, so the profile closes seamlessly where the loop meets itself —
    // a fractional harmonic would leave a step at the join that the swept rail
    // would have to smooth over and the physics would feel as a kink.
    const heights = new Float64Array(controls);
    const hillPhase = rng.range(0, TAU);
    for (let i = 0; i < controls; i += 1) {
      const angle = (i / controls) * TAU;
      const hills =
        Math.max(0, Math.sin(angle * 3 + hillPhase)) * 3.4 +
        Math.max(0, Math.sin(angle * 5 + hillPhase * 1.7)) * 1.4;
      heights[i] = CRUISE_FLOOR + hills;
    }
    // The station carve. No bearing-to-metres conversion any more: `along` is
    // already the metres of track between this control and the platform.
    for (let i = 0; i < controls; i += 1) {
      const s = (i / controls) * plan.length;
      const raw = Math.abs(s - stationS);
      const along = Math.min(raw, plan.length - raw);
      if (along < STATION_FLAT) heights[i] = STATION_HEIGHT;
      else if (along < STATION_FLAT + STATION_RAMP) {
        const t = (along - STATION_FLAT) / STATION_RAMP;
        const eased = t * t * (3 - 2 * t);
        heights[i] = STATION_HEIGHT + (heights[i]! - STATION_HEIGHT) * eased;
      }
    }

    // The castle window carve (issue #113). Applied **after** the station's,
    // and that order is load-bearing rather than incidental.
    //
    // The cruiser's booth is placed 21-26 m from the castle, so the station and
    // the castle are always near neighbours, and the station's 26 m ramp
    // reaches the castle on most seeds. Carving the castle first and letting
    // the station ramp run over it was tried and measured: **one crossing came
    // out pinned at window height and the other at 2-4 m**, halfway down the
    // ramp — an opening that would have been cut through the courtyard floor.
    // The flat run through the masonry is the one part of the profile that
    // cannot be blended with anything, because a hole was cut to fit it, so it
    // is applied last and wins outright.
    //
    // What the station keeps is its own flat: the two flats overlapping would
    // tilt the boarding deck, so `checkCoasterClearances` complains if they come
    // within reach of each other rather than letting either quietly deform.
    //
    // Level, not merely low: both openings then sit at the same height, the
    // masonry surround is a plain rectangle rather than a swept slot, and the
    // cart flies straight at the window instead of arriving at it climbing.
    // Measured on the **plan**, because the curve this carves does not exist
    // yet. The public `castleSpan` below is re-measured on the finished curve:
    // the two parameterisations are not the same length, and treating one as
    // the other is a bug this had — plan metres ran ~1.5% short of curve metres,
    // so the span stopped just before the second wall crossing and one of the
    // two windows was silently never cut. Three of the five CI seeds caught it.
    const castleSpan = spanInsideCastle((d, into) => plan.pointAt(d, into), plan.length);
    if (castleSpan) {
      const windowY = castleY(WINDOW_TRACK_Y);
      for (let i = 0; i < controls; i += 1) {
        const s = (i / controls) * plan.length;
        const away = outsideSpan(castleSpan, s, plan.length);
        const spot = flat[i]!;
        const wanted = windowY - terrainHeight(spot.x, spot.z);
        if (away < WINDOW_FLAT) heights[i] = wanted;
        else if (away < WINDOW_FLAT + WINDOW_RAMP) {
          const t = (away - WINDOW_FLAT) / WINDOW_RAMP;
          const eased = t * t * (3 - 2 * t);
          heights[i] = wanted + (heights[i]! - wanted) * eased;
        }
      }
    }

    const makeCurve = (): CatmullRomCurve3 => {
      const points: Vector3[] = [];
      for (let i = 0; i < controls; i += 1) {
        const spot = flat[i]!;
        points.push(
          new Vector3(spot.x, terrainHeight(spot.x, spot.z) + (heights[i] ?? CRUISE_FLOOR), spot.z),
        );
      }
      const curve = new CatmullRomCurve3(points, true, 'catmullrom', 0.5);
      curve.arcLengthDivisions = 1600;
      return curve;
    };

    const stationOn = (curve: CatmullRomCurve3, length: number): number => {
      let best = 0;
      let bestDistance = Infinity;
      const probe = new Vector3();
      for (let d = 0; d < length; d += 1) {
        curve.getPointAt(d / length, probe);
        const toStall = Math.hypot(probe.x - stall.x, probe.z - stall.z);
        if (toStall < bestDistance) {
          bestDistance = toStall;
          best = d;
        }
      }
      return best;
    };

    // --- vertical repair: measure the finished curve, not the plan ---------
    // Control-point heights are claims; between them the spline interpolates
    // while the terrain does what it likes, so a rise between two samples can
    // eat the cruise floor. Scan exactly the way the boot assert will (but with
    // a slightly narrower station exemption, so everything the assert measures
    // is either exempt or repaired), raise the control points under any
    // deficit, and re-measure until the track really clears.
    let curve = makeCurve();
    let length = curve.getLength();
    let station = stationOn(curve, length);
    const probe = new Vector3();
    for (let pass = 0; pass < 10; pass += 1) {
      // Worst deficit per control point, so a run of low samples under one
      // control raises it once by what it needs, not once per sample. The same
      // sweep records how close to the station each control's track actually
      // runs — measured on the curve, because a control's own nominal position
      // along the loop drifts once height is added to it.
      const lifts = new Map<number, number>();
      const ownsStationTrack = new Map<number, number>();
      for (let d = 0; d < length; d += 2) {
        curve.getPointAt(d / length, probe);
        const toStation = Math.min(Math.abs(d - station), length - Math.abs(d - station));
        const control = Math.round((d / length) * controls) % controls;
        ownsStationTrack.set(
          control,
          Math.min(ownsStationTrack.get(control) ?? Infinity, toStation),
        );
        if (toStation < STATION_FLAT + STATION_RAMP) continue;
        const above = probe.y - terrainHeight(probe.x, probe.z);
        if (above < CRUISE_FLOOR) {
          const lift = CRUISE_FLOOR - above + 0.4;
          lifts.set(control, Math.max(lifts.get(control) ?? 0, lift));
        }
      }
      // Never lift a control that owns boarding-flat or early-ramp track — a
      // half-lift bleeding onto the platform would tilt it. Mid-ramp and beyond
      // is fair game: steepening the ramp's tail is exactly how a sag just past
      // the window gets fixed.
      // A control carrying the level run through the castle is not liftable
      // either, and for a sharper reason than the station's: lifting it would
      // raise the track *inside a hole cut to fit it*, which is the one place
      // in the park where gaining height is how you hit something rather than
      // how you miss it. The ramp's outer two-thirds stay liftable, exactly as
      // the station's do, so a sag just past the castle can still be repaired.
      const holdsWindow = (index: number): boolean =>
        castleSpan !== null &&
        outsideSpan(castleSpan, (index / controls) * plan.length, plan.length) <
          WINDOW_FLAT + WINDOW_RAMP * 0.35;
      const liftable = (index: number): boolean =>
        (ownsStationTrack.get(index) ?? Infinity) > STATION_FLAT + STATION_RAMP * 0.65 &&
        !holdsWindow(index);
      for (const [control, lift] of lifts) {
        if (liftable(control)) heights[control] = (heights[control] ?? CRUISE_FLOOR) + lift;
        for (const side of [-1, 1]) {
          const neighbour = (control + side + controls) % controls;
          if (liftable(neighbour))
            heights[neighbour] = (heights[neighbour] ?? CRUISE_FLOOR) + lift * 0.5;
        }
      }
      if (lifts.size === 0) break;
      curve = makeCurve();
      length = curve.getLength();
      station = stationOn(curve, length);
    }

    this.curve = curve;
    this.length = length;
    this.stationDistance = station;

    // The span riders actually fly, in the metres every other consumer counts
    // in: `openingsFor`, the swept-car assert and the station-overlap check all
    // index the built curve, so this is measured on the built curve.
    const built = new Vector3();
    this.castleSpan = spanInsideCastle((d, into) => {
      curve.getPointAt(this.wrap(d) / length, built);
      into.x = built.x;
      into.z = built.z;
    }, length);

    let crest = 0;
    for (let d = 0; d < length; d += 1) {
      curve.getPointAt(d / length, probe);
      const above = probe.y - terrainHeight(probe.x, probe.z);
      if (above > crest) crest = above;
    }
    this.crestY = crest;
  }

  pointAt(distance: number, target = this.scratch): Vector3 {
    return this.curve.getPointAt(this.wrap(distance) / this.length, target);
  }

  tangentAt(distance: number, target = new Vector3()): Vector3 {
    return this.curve.getTangentAt(this.wrap(distance) / this.length, target).normalize();
  }

  wrap(distance: number): number {
    let value = distance % this.length;
    if (value < 0) value += this.length;
    return value;
  }

  /** Height above the ground directly below `distance` along the loop. */
  clearanceAt(distance: number): number {
    const point = this.pointAt(distance, new Vector3());
    return point.y - terrainHeight(point.x, point.z);
  }

  /** Nearest point on this loop to (x, z), for the other coaster's solve. */
  nearestPoint(x: number, z: number): Vector3 {
    const probe = new Vector3();
    const best = new Vector3();
    let bestDistance = Infinity;
    for (let d = 0; d < this.length; d += 2) {
      this.pointAt(d, probe);
      const gap = Math.hypot(probe.x - x, probe.z - z);
      if (gap < bestDistance) {
        bestDistance = gap;
        best.copy(probe);
      }
    }
    return best;
  }
}

/**
 * Boot assert (the claim-versus-fact rule): cruise really clears, the station
 * segment really is low, the loop really goes round the ferris wheel rather
 * than through it, and everywhere the coaster passes over the train there is
 * 5.5 m of air.
 *
 * **What it deliberately does not claim is that the ride misses everything.**
 * It measures the finished curve against a handful of named things, which is
 * all a check cheap enough to run at boot can do. The exhaustive question —
 * does the car's envelope touch any real geometry anywhere in the park — is
 * answered by `coaster/clearance.ts`, which sweeps eight rays along the whole
 * loop and takes seconds rather than milliseconds, so it runs in the build
 * (`check:cruiser-clearance`) and on every seed in the procgen suite instead.
 * Reading this function as the complete answer is exactly the mistake that let
 * the ride fly through a tree canopy for weeks with a green build (#198).
 *
 * Reports; the caller decides what to do about it. Never adjusts.
 *
 * The castle and wheel checks are new (issue #113). Their absence is the whole
 * reason the cruiser could clip the castle for weeks with a green build: the
 * avoidance lived in the solver and *nothing measured the finished curve*. The
 * horizontal gap is now measured the same way the vertical one always was.
 */
export function checkCoasterClearances(
  route: CoasterRoute,
  trainPointNear: (x: number, z: number) => { y: number; distance: number },
): string[] {
  const complaints: string[] = [];
  const point = new Vector3();
  const obstacles = tallObstacles();
  const worst = new Map<string, number>();
  for (let d = 0; d < route.length; d += 2) {
    route.pointAt(d, point);
    const above = point.y - terrainHeight(point.x, point.z);
    const nearStation =
      Math.min(
        Math.abs(d - route.stationDistance),
        route.length - Math.abs(d - route.stationDistance),
      ) <
      STATION_FLAT + STATION_RAMP + 4;
    if (!nearStation && above < CRUISE_FLOOR - 1.2) {
      complaints.push(
        `coaster at ${d.toFixed(0)} m is only ${above.toFixed(1)} m above ground outside the station window`,
      );
    }
    const train = trainPointNear(point.x, point.z);
    if (train.distance < 3 && point.y - train.y < RAIL_OVER_RAIL_AIR) {
      complaints.push(
        `coaster crosses the train with ${(point.y - train.y).toFixed(1)} m of air at (${point.x.toFixed(0)}, ${point.z.toFixed(0)}) — Decision 4 wants ${RAIL_OVER_RAIL_AIR}`,
      );
    }
    // The two things it cannot fly over. Recorded as a worst-case per obstacle
    // rather than one complaint per sample, so a loop that does clip says so
    // once, with the number, instead of a hundred times.
    for (let i = 0; i < obstacles.length; i += 1) {
      const tall = obstacles[i]!;
      const gap = Math.hypot(point.x - tall.x, point.z - tall.z) - tall.radius;
      worst.set('the ferris wheel', Math.min(worst.get('the ferris wheel') ?? Infinity, gap));
    }
  }
  // The two authored height features must not reach each other. The station is
  // pinned to 1.1 m because a platform is there and the castle to window height
  // because a hole is there, and neither can give: a station flat that gets
  // dragged upwards is a deck riders step off into fresh air, and a castle flat
  // dragged downwards is a hole cut through the courtyard floor.
  if (route.castleSpan) {
    const span = route.castleSpan;
    const gap = Math.min(
      outsideSpan(span, route.stationDistance, route.length),
      outsideSpan(span, route.stationDistance + STATION_FLAT, route.length),
      outsideSpan(span, route.stationDistance - STATION_FLAT + route.length, route.length),
    );
    if (gap < WINDOW_FLAT) {
      complaints.push(
        `the station platform is ${gap.toFixed(1)} m of track from the castle's level run — ` +
          `they would deform each other, and ${WINDOW_FLAT} m is the least that keeps them apart`,
      );
    }
  }

  for (const [what, gap] of worst) {
    if (gap < CAR_HALF_WIDTH) {
      complaints.push(
        `coaster passes ${gap.toFixed(1)} m from ${what} — a car is ` +
          `${CAR_HALF_WIDTH * 2} m wide, so it clips it`,
      );
    }
  }
  return complaints;
}
