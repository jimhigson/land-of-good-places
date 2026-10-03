import { CatmullRomCurve3, Vector3 } from 'three';
import { CART_ENVELOPE } from './cart';
import { PARK_LAYOUT, placedEntry } from '../parkLayout';
import { terrainHeight } from '../terrain';
import { type RouteBrief, type SolvedRailRoute } from '../rail/generate';

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
export const STATION_FLAT = 9;
export const STATION_RAMP = 26;

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
 * Air the coaster keeps above the train's railhead wherever their plan
 * positions come within 4 m — Decision 4's clearance rule, generalised. One
 * constant, shared by the vertical repair (which lifts to honour it) and the
 * boot assert (which measures it), so they cannot drift apart.
 */
export const RAIL_OVER_RAIL_AIR = 5.5;


export interface TallObstacle {
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

export function tallObstacles(): TallObstacle[] {
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
    // The Land Hotel (#236): 28 m of crystal against a 6.2 m cruise floor —
    // the third member of the statue's category, added the way the statue's
    // own comment predicted the next one would be: a tall thing merged on a
    // branch with no cruiser sweep to run, made visible when the loop
    // re-rolled (seed 5 flew the car straight through the tower's spires).
    hotelTallObstacle(),
  ];
}

function hotelTallObstacle(): TallObstacle {
  const hotel = placedEntry('hotel');
  return { x: hotel.x, z: hotel.z, radius: hotel.boundingRadius + 1 };
}

/** Metres of level flight held either side of the castle before the hills resume. */
export const WINDOW_FLAT = 5;

/** Metres from `s` to the nearest end of a (possibly wrapping) span; 0 inside. */
export function outsideSpan(span: { from: number; to: number }, s: number, length: number): number {
  const shifted = s < span.from ? s + length : s;
  if (shifted >= span.from && shifted <= span.to) return 0;
  const before = span.from - s < 0 ? span.from - s + length : span.from - s;
  const after = shifted - span.to;
  return Math.min(Math.abs(before), Math.abs(after));
}

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

  /**
   * Builds the loop from what was decided about it: the plan view the search
   * found and the finished profile. **It never searches** — the game as
   * delivered carries no search (`docs/design/PREBUILT-PARKS.md`); a loop is
   * either read from the park file or searched in build tooling
   * (`procgen/world/coaster/solve.ts`) and handed in here.
   */
  constructor(decided: DecidedCoaster) {
    this.plan = decided.plan;
    const profile = decided.profile;
    this.curve = profile.curve;
    this.length = profile.length;
    this.stationDistance = profile.stationDistance;
    this.castleSpan = profile.castleSpan;
    this.crestY = profile.crestY;
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

  /**
   * The loop sampled every {@link NEAREST_POINT_STEP} metres, as flat
   * `x, y, z` triples — built once, on first use.
   *
   * `curve` and `length` are assigned in the constructor and never reassigned,
   * so these samples cannot go stale and there is nothing to invalidate.
   */
  private nearestSamples: Float64Array | null = null;

  private planSamples(): Float64Array {
    if (this.nearestSamples) return this.nearestSamples;
    const count = Math.max(1, Math.ceil(this.length / NEAREST_POINT_STEP));
    const samples = new Float64Array(count * 3);
    const probe = new Vector3();
    for (let i = 0; i < count; i += 1) {
      this.pointAt(i * NEAREST_POINT_STEP, probe);
      samples[i * 3] = probe.x;
      samples[i * 3 + 1] = probe.y;
      samples[i * 3 + 2] = probe.z;
    }
    this.nearestSamples = samples;
    return samples;
  }

  /**
   * Nearest point on this loop to (x, z), for the other coaster's solve.
   *
   * **Reads a table rather than re-walking the curve.** This used to call
   * `pointAt` — `CatmullRomCurve3.getPointAt`, an arc-length lookup with a
   * binary search in it — at every 2 m of the loop, on *every query*: about a
   * hundred and forty curve evaluations to answer one question about one point.
   * The ginormous slide's search asks it once per chute sample, which on the
   * canonical seed is **3,007,891 questions**, so the loop was re-walked some
   * four hundred million times to re-derive a line that had not moved since the
   * constructor. Same step, same samples, same answer; the walking happens once.
   */
  nearestPoint(x: number, z: number): Vector3 {
    const samples = this.planSamples();
    const best = new Vector3();
    let bestDistance = Infinity;
    for (let i = 0; i < samples.length; i += 3) {
      const dx = (samples[i] as number) - x;
      const dz = (samples[i + 2] as number) - z;
      const gap = dx * dx + dz * dz;
      if (gap < bestDistance) {
        bestDistance = gap;
        best.set(samples[i] as number, samples[i + 1] as number, samples[i + 2] as number);
      }
    }
    return best;
  }
}

/**
 * How finely {@link CoasterRoute.nearestPoint} samples the loop. 2 m, which is
 * the step it has always walked — named so the table and the walk it replaced
 * cannot drift apart.
 */
const NEAREST_POINT_STEP = 2;

/** A loop somebody already decided: its plan view and its finished profile. */
export interface DecidedCoaster {
  /** The plan view the search found. */
  readonly plan: SolvedRailRoute;
  /** The finished profile: heights, carves, curve. */
  readonly profile: CoasterProfile;
}

/** A brief and the harder-pulling retry behind it — one tier of the policy. */
export interface CoasterBriefPair {
  /** What the loop is asked for first. */
  readonly first: RouteBrief;
  /** Twice the castle pull, its own stream — tried only if `first` fell short. */
  readonly escalated: RouteBrief;
}

/** The Sky Cruiser's search briefs, all tiers, for both cadences. */
export interface CoasterBriefs extends CoasterBriefPair {
  /**
   * The rescue tier: the same brief over start poses **constructed against the
   * search's own clearance truth** (Decision 10 part 4), built only when asked.
   *
   * A thunk rather than a field because building it costs a full pose sweep
   * (~20 ms) that the 48-in-60 seeds which solve on the primary tiers must not
   * pay — and, more importantly, must not observe: nothing about a solving
   * park may change, and a list that is never built cannot change anything.
   * Only {@link cruiserRouteSearch} calls it, and only after the primary
   * tiers have thrown.
   */
  readonly rescue: () => CoasterBriefPair;
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

/**
 * The loop's curve through its control points — the one owner of how a
 * profile's points become a curve (closed, 'catmullrom' type, tension 0.5,
 * 1600 arc-length divisions). `coasterProfileSearch` builds with it, and so
 * does a prebuilt park (`world/prebuilt/parkFile.ts`) that ships only the
 * points: a curve rebuilt any other way would sample differently.
 */
export function coasterCurve(points: Vector3[]): CatmullRomCurve3 {
  const curve = new CatmullRomCurve3(points, true, 'catmullrom', 0.5);
  curve.arcLengthDivisions = 1600;
  return curve;
}

/** Everything about the built loop that is not the plan view it came from. */
export interface CoasterProfile {
  readonly curve: CatmullRomCurve3;
  readonly length: number;
  readonly stationDistance: number;
  readonly castleSpan: { readonly from: number; readonly to: number } | null;
  readonly crestY: number;
}