
import type { ParkBoundary } from '../boundary';
import { type CubicSegment, type Pose2, type SegmentKind, type Vec2, cubicPoint, cubicTangent, minCurvatureRadius } from './segments';

/**
 * **One rail route generator, for any rail ride whose shape is not dictated.**
 *
 * Grows a track by laying pieces from a vocabulary end to end, rejecting a
 * piece that hits something and picking another, backing up a piece when a
 * joint runs out of options, and starting somewhere else entirely when a whole
 * attempt dies. Deterministic per seed; pure, in the sense that it reads a
 * brief and returns a curve and touches nothing else in the world.
 *
 * ### Why it must be pure and synchronous
 *
 * Every ride's route is solved **at module load, from the park layout alone,
 * before a single scene object exists** — see the headers of `train/plan.ts`
 * and `coaster/plan.ts`. The reason is `paths.ts`: the walk graph needs a node
 * at each ride's exit, and it cannot wait for the 3D scene to be built to find
 * out where that is. So this generator can never consult `CollisionWorld`, can
 * never touch a mesh, and can never be asynchronous. Obstacles arrive as the
 * `clear` predicate in the brief, computed from the layout by the caller.
 *
 * ### Why it solves in plan view and not in 3D
 *
 * Every obstacle a rail ride here has to dodge horizontally — the castle, the
 * ferris wheel — is a vertical cylinder, and no track banks. Height is a
 * separate, well-tested pass the caller applies afterwards (`coaster/route.ts`
 * has a measure-the-built-curve repair loop for exactly this). Searching in 2D
 * keeps the state space small enough to solve inside the module-load budget,
 * and keeps the height pipeline that already works untouched.
 *
 * ### Why closure is constructed, not merely encouraged
 *
 * A loop that has to arrive back where it started is the hard part. Bias alone
 * — weighting the choice towards home as the route lengthens — gets close and
 * then has to get lucky, and "close" is not good enough when the two ends have
 * to meet at a matching tangent or the ride has a kink in it.
 *
 * So bias handles the approach, and once the head is within reach the route is
 * closed **analytically**: one or two cubics fitted directly from the current
 * pose to the start pose, which by construction start and end facing the right
 * way. They are then validated exactly like any other piece, and rejected and
 * backtracked over exactly like any other piece. Landing on the start at a
 * matching tangent stops being a hope and becomes a structural property.
 *
 * ### Open routes are the same machine pointed somewhere else
 *
 * A ride that stops somewhere other than where it began — the ginormous slide,
 * which starts at the castle roof and lands in the ball pit — is not a second
 * algorithm. The only thing a loop does that an open route does not is choose
 * its own destination: a loop's destination *is* its start. So an open brief
 * supplies `endPoses`, and the approach corridor, the steering bias and the
 * analytic finisher all aim at the chosen end pose instead of the start pose.
 * Everything else — the vocabulary, the validation, the backtracking, the
 * restart level — is untouched and shared.
 *
 * This matters beyond tidiness. The bug that prompted it (#118) was a slide
 * that ended wherever its hand-authored coordinates ran out, which was inside
 * the castle. Making the end pose a *required* input of an open brief means a
 * route that stops somewhere useless is no longer something the search is able
 * to return.
 */

/**
 * **A place a ride asks its route to be drawn towards.**
 *
 * The generator returns the **first satisfying route, not the best one** — it
 * takes whatever fits first, because nothing was ever asking for more. Measured
 * over 24 free solves of the Sky Cruiser, 20 crossed the castle and 4 did not;
 * the four were not rejected for anything, they simply closed before they got
 * there. So a feature that depends on the route going somewhere cannot be had
 * by asking afterwards. It has to be worth something *at the decision point*.
 *
 * That is what this is: a named, weighted nudge applied where the search picks
 * between candidate pieces. It is **not** a castle hook — the castle is merely
 * its first caller. Any ride can declare that it would like to pass near
 * something, and the mechanism knows nothing about what the something is.
 *
 * ### What it deliberately does not do
 *
 * **It reserves nothing.** No corridor is carved, no space is held, and no
 * other thing is moved out of the way. It changes which routes are *likely*,
 * never which are *possible*, so a park where the pull cannot be satisfied
 * still solves — it just solves without it. Decision 6 in
 * `ARCHITECTURE-DECISIONS.md` is the rule this is careful not to break: the
 * castle's opening is cut wherever the route actually crosses, and the route is
 * never bent to a hole that was cut first.
 *
 * **It does not guarantee anything either.** A weight makes an outcome likely.
 * When a ride needs the outcome rather than the tendency, it pairs this with
 * {@link RouteBrief.satisfies}, which is the backstop that can actually say no.
 */
export interface RouteInfluence {
  /** Names it in the solve report, so a pull that never lands can be seen. */
  readonly name: string;
  readonly x: number;
  readonly z: number;
  /**
   * Metres within which the route counts as having arrived.
   *
   * Once any laid track is this close, the pull switches off — otherwise a
   * satisfied influence goes on tugging and the loop orbits the thing it has
   * already visited.
   */
  readonly radius: number;
  /**
   * How hard it pulls, as a multiplier on metres-of-detour.
   *
   * The score this competes in is metres, and carries `rng.unit() * 12` of
   * seeded jitter to keep loops from all coming out the same shape. So a weight
   * of about **0.25** makes a 30 m pull worth roughly what the jitter is worth,
   * which biases the choice; much above that and the pull stops being a bias
   * and starts being a beeline, which is both duller to ride and harder to
   * close into a loop.
   */
  readonly weight: number;
}

/**
 * Everything common to a closed ride and an open one.
 *
 * Split out only so `closed` can discriminate the two below; every field here
 * means exactly what it did when there was one brief type. {@link RouteInfluence}
 * and {@link RouteBriefBase.satisfies} live here rather than on one half because
 * neither has anything to do with whether a route comes back to where it began:
 * an open route can want to pass near something exactly as a loop can.
 */
export interface RouteBriefBase {
  /** Usually `PARK_SEED ^ someRideSalt`. */
  readonly seed: number;
  /** The pieces this ride may be built from. Encodes its minimum turn radius. */
  readonly vocabulary: readonly SegmentKind[];
  /** Metres of track wanted. Finishing is attempted from `CLOSE_AFTER` of this. */
  readonly desiredLength: number;
  /**
   * **Metres of track the ride cannot exceed and still be worth building.**
   *
   * `desiredLength` is a target the search aims at; this is a wall it may not
   * pass. A piece that would take the route beyond it is rejected exactly like
   * a piece that hits a tree, so the whole branch below it is never explored.
   *
   * It exists because the ginormous slide had a hard 75 m ceiling
   * (`MAX_RIDEABLE_LENGTH` — past it the drop is spread so thin the ride is a
   * lazy river) that the search **could not see**. It was told to want 60 m,
   * allowed to grow to `60 × CLOSE_ONLY_AFTER` plus a closer, and then had its
   * finished routes rejected by `satisfies` for being too long: on seed 5 it
   * solved **123 complete routes and threw all 123 away**, and the park did
   * not build. A constraint that decides whether a route is acceptable belongs
   * where routes are *made*, not where they are *marked*.
   *
   * Leave it unset and nothing changes at all — no comparison is made and no
   * candidate's fate is altered, which is what keeps every ride that never
   * asked for a ceiling solving exactly as it did.
   */
  readonly maxLength?: number;
  /**
   * Where the route may begin, best first. This is the **outermost level of
   * the search**: when every route from one start pose fails, the next is
   * tried. For a closed loop whose station sits at the start, that makes the
   * station's position part of the search space rather than an assumption —
   * the same trick `train/plan.ts` plays when `clearStationDistance` slides a
   * station along the track until its platform is on clear ground.
   */
  readonly startPoses: readonly Pose2[];
  /**
   * Is a corridor of `radius` about (x, z) free of obstacles? Layout only.
   *
   * `distanceAlong` is how many metres of track lie behind this point. Most
   * rides ignore it — a tree is in the way wherever you meet it — and a plain
   * three-argument predicate satisfies this type unchanged.
   *
   * It exists because a ride whose **height varies along its length** cannot
   * otherwise say whether it is in the way of anything. The ginormous slide
   * descends from the castle parapet to the ball pit and crosses the Sky
   * Cruiser's loop on the way; height-blind, the only safe answer is "never go
   * near the cruiser", and that answer makes the slide unsolvable — the gap
   * between the castle's east wall and the cruiser is about 2 m, narrower than
   * the chute. Knowing it is still 14 m up when it crosses turns an impossible
   * route into an obvious one: it goes over the top.
   *
   * The search is still purely 2D. This hands the caller the one number it
   * needs to answer a 3D question for itself, rather than teaching the search
   * about height.
   */
  readonly clear: (
    x: number,
    z: number,
    radius: number,
    distanceAlong: number,
    /**
     * Straight-line distance from (x, z) to the attempt's finish pose — a lower
     * bound on the route still to lay from here. With `distanceAlong` it bounds
     * the finished route's length from below, which is what lets a caller whose
     * verdict depends on that length (the slide's height profile) reject only
     * what no finishable route could survive. Callers that do not need it may
     * ignore it.
     */
    toFinish: number,
  ) => boolean;
  readonly boundary: ParkBoundary;
  /** Half-width of track to keep clear of obstacles and the boundary. */
  readonly corridorRadius: number;
  /**
   * Half-width kept clear of the boundary specifically — defaults to
   * {@link corridorRadius}. The train sets it much wider (see
   * `train/route.ts`'s `TRACK_BOUNDARY_CLEARANCE`): the ground between its
   * loop and the rim must stay wide enough to actually walk, or not exist.
   */
  readonly boundaryMargin?: number;
  /**
   * How close the track may come to an earlier part of itself.
   *
   * A free-form loop can cross itself, which the old polar coaster solve could
   * not do. Two pieces of track in the same place at unrelated heights is a
   * gamble the vertical pass never agreed to take, so the search simply
   * forbids it and the loop stays simple.
   */
  readonly selfClearance: number;
  /** Tightest radius any piece may have, including the closer's. */
  readonly minRadius: number;
  /**
   * How far behind the finish the approach corridor sits. Defaults to
   * {@link APPROACH_DISTANCE}, which is tuned for a loop the size of the Sky
   * Cruiser's.
   *
   * Worth setting for a **short** route. The corridor is what the search steers
   * at so it arrives lined up rather than merely near, and 38 m behind the
   * finish is a sensible fraction of a 216 m loop but most of a 60 m slide —
   * which leaves the head aimed at a point it passes long before it is ready to
   * finish, and the biarcs home then need radii the ride has banned. Left
   * unset, nothing changes.
   */
  readonly approachDistance?: number;
  readonly budgets: {
    /** Candidate pieces tried at one joint before backing up. */
    readonly perJoint: number;
    /** Attempts tried before giving up entirely. */
    readonly restarts: number;
  };
  /**
   * Places this route would like to pass near. Absent means no bias at all —
   * and absent is **byte-identical** to before this existed, because the pull
   * a ride does not ask for contributes exactly zero and draws no randomness.
   */
  readonly influences?: readonly RouteInfluence[];
  /**
   * **The backstop: is a solved route actually acceptable?**
   *
   * {@link RouteInfluence} makes an outcome likely; this is what makes it
   * required. A route that solves but fails here is thrown away and the search
   * moves to the next start pose, exactly as a dead end would.
   *
   * Kept separate from `clear` on purpose. `clear` is asked about a *piece*,
   * thousands of times, and can only see a point; this is asked about a
   * *finished route*, a handful of times, and can measure the whole thing. A
   * property like "passes through the castle" is not a fact about any one piece
   * and cannot be phrased as one.
   *
   * **It cannot make a park fail.** If every start pose is exhausted and none
   * satisfied this, **the first route that solved** is returned anyway with
   * {@link SolveReport.satisfied} false, because a park with no coaster in it
   * is far worse than a park whose coaster missed the castle. The first rather
   * than the best on purpose: the search has no ordering over whole routes to
   * call one better, and inventing one here would be a second, unexamined
   * notion of quality sitting beside `scoreOf`. The count is
   * reported so it can be seen rather than guessed at: if this rejects often,
   * the weighting wants tuning; if it never rejects, the weighting is doing the
   * work and this is the belt beside the braces.
   */
  readonly satisfies?: (route: SolvedRailRoute) => boolean;
}

/** A ride that comes back to where it started: the Sky Cruiser, the train. */
export interface ClosedRouteBrief extends RouteBriefBase {
  readonly closed: true;
}

/**
 * A ride that starts one place and stops somewhere else: the ginormous slide.
 *
 * `endPoses` is **required**, not optional, and that is the whole point. The
 * bug this type exists to make unrepresentable (#118) was a slide that ran out
 * wherever its hand-authored coordinates happened to stop — which turned out to
 * be inside the castle, with a six-year-old stranded in it. An open route
 * therefore cannot be *asked for* without saying where it is to end up, and the
 * finisher lands on that pose at a matching tangent by the same analytic biarc
 * that closes a loop. Where the ride puts you down stops being an emergent
 * property of the search and becomes an input to it.
 */
export interface OpenRouteBrief extends RouteBriefBase {
  readonly closed: false;
  /**
   * Where the route may end, best first. Paired with `startPoses` to form the
   * outermost level of the search, so a ride whose landing spot has a little
   * freedom (anywhere on the rim of the ball pit) can trade one end against the
   * other rather than failing.
   */
  readonly endPoses: readonly Pose2[];
}

/** The brief a caller hands in. Everything the search is allowed to know. */
export type RouteBrief = ClosedRouteBrief | OpenRouteBrief;

/** What the search did, for the diagnostic on failure and the report on success. */
export interface SolveReport {
  /**
   * How many things the outermost level of the search had to try. Zero is its
   * own kind of failure — a brief that could never have worked.
   *
   * **Attempts, not start poses**, and for an open route those differ. A loop's
   * attempt is a start pose, so the two coincide and the name still reads true.
   * An open route pairs every start with every end, and an attempt is one
   * *pairing*: 85 starts against 29 landings is 2465 attempts, not 85.
   *
   * {@link startPoseIndex} indexes that same flat list, which is why this must
   * be counted the same way. Set it from `brief.startPoses.length` and the two
   * fields silently begin describing different lists — no type error, no failing
   * test, just a report that is wrong. Recovering which door was actually chosen
   * means `floor(startPoseIndex / endPoses.length)`, and that arithmetic is only
   * checkable if the denominator here is the flat count.
   */
  readonly startPoseCount: number;
  readonly startPoseIndex: number;
  readonly segmentCount: number;
  readonly candidatesTried: number;
  readonly backtracks: number;
  readonly restarts: number;
  readonly closerAttempts: number;
  readonly length: number;
  readonly minRadius: number;
  readonly elapsedMs: number;
  /**
   * Why candidates were thrown away, by cause.
   *
   * A generator that can throw owes whoever it throws at some idea of *what*
   * was in the way. "Nothing fits" is not actionable; "eleven thousand pieces
   * rejected for self-clearance and none for collision" says the loop is being
   * asked to fit in too small a space, and points at the parameter to change.
   */
  readonly rejected: {
    readonly collision: number;
    readonly boundary: number;
    readonly selfClearance: number;
    readonly curvature: number;
    /** Pieces that would have taken the route past {@link RouteBrief.maxLength}. */
    readonly tooLong: number;
  };
  /**
   * Whole solved routes thrown away by {@link RouteBrief.satisfies}.
   *
   * The number worth watching. Zero means the weighting is carrying the feature
   * and the backstop is only insurance; a large number means the search is
   * repeatedly solving routes it then has to discard, and the influence wants
   * strengthening rather than the backstop working harder.
   */
  readonly satisfyRejects: number;
  /**
   * Did the route handed back actually satisfy {@link RouteBrief.satisfies}?
   *
   * False means every start pose was exhausted without one that did, and the
   * first route that solved was returned rather than failing the park. Always
   * true when no `satisfies` was given.
   */
  readonly satisfied: boolean;
}

/** A solved centre line: piecewise cubics, parameterised by arc length. */
export interface SolvedRailRoute {
  readonly length: number;
  readonly closed: boolean;
  readonly segments: readonly CubicSegment[];
  readonly report: SolveReport;
  /** Position at `distance` metres along. Wraps if the route is closed. */
  pointAt(distance: number, target: Vec2): Vec2;
  /** Unit tangent at `distance` metres along. */
  tangentAt(distance: number, target: Vec2): Vec2;
  /** Tightest radius of curvature anywhere on the finished route. */
  readonly minCurvature: number;
}

/**
 * Wraps the chosen pieces in an arc-length parameterisation.
 *
 * The table maps distance to (piece, t) at a fixed sample spacing, and lookups
 * interpolate `t` between neighbours and then evaluate the real cubic. Sampling
 * the curve rather than lerping between cached points keeps tangents exact,
 * which matters because the swept rail geometry is built from them.
 *
 * Exported for one other caller: a prebuilt park (`world/prebuilt/parkFile.ts`)
 * ships only the chosen segments and rebuilds the route through this same
 * function, so a hydrated route and a searched one share every line after the
 * search.
 */
export function buildRoute(
  segments: readonly CubicSegment[],
  closed: boolean,
  report: SolveReport,
): SolvedRailRoute {
  const stops: { s: number; index: number; t: number }[] = [];
  const point: Vec2 = { x: 0, z: 0 };
  const previous: Vec2 = { x: 0, z: 0 };
  let total = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const seg = segments[index];
    if (!seg) continue;
    const steps = Math.max(8, Math.ceil(seg.length / 0.35));
    cubicPoint(seg, 0, previous);
    // **Every piece gets its own `t = 0` stop**, not just the first.
    //
    // Without it, the stop *before* a new piece's first sample is the last
    // sample of the previous piece, so `locate` below found `hit` and `before`
    // on different pieces, refused to interpolate `t` across them, and returned
    // `hit.t` verbatim. Every distance in that piece's whole first step —
    // anything up to the 0.35 m sample spacing — therefore answered with the
    // same point, and the route had a dead spot at every join.
    //
    // Measured on the canonical park's ginormous slide, whose chute samples the
    // route at a fixed 0.9 m: the control points either side of a join came out
    // 1.163 m and 0.635 m apart against a rock-solid 0.899 m everywhere else —
    // the pair summing to exactly 2 × 0.899, because only the point *between*
    // them was displaced. A uniform Catmull-Rom through points spaced like that
    // kinks, which put a +14° spike in the chute's slope inside one percent of
    // its length, pitched the chase camera hard enough to throw the trailing pet
    // out of the bottom of the frame, and is what `check:pet-slide` went red on.
    //
    // The duplicate `s` at a join is deliberate and harmless: the binary search
    // takes the first stop at or past the distance, so a query exactly on the
    // join still lands on the previous piece's `t = 1` — the same point.
    stops.push({ s: total, index, t: 0 });
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      cubicPoint(seg, t, point);
      total += Math.hypot(point.x - previous.x, point.z - previous.z);
      stops.push({ s: total, index, t });
      previous.x = point.x;
      previous.z = point.z;
    }
  }

  const length = total;

  const wrap = (distance: number): number => {
    if (!closed) return Math.max(0, Math.min(length, distance));
    let value = distance % length;
    if (value < 0) value += length;
    return value;
  };

  const locate = (distance: number): { index: number; t: number } => {
    const s = wrap(distance);
    let low = 0;
    let high = stops.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((stops[mid]?.s ?? 0) < s) low = mid + 1;
      else high = mid;
    }
    const hit = stops[low] ?? stops[stops.length - 1];
    const before = stops[Math.max(0, low - 1)] ?? hit;
    if (!hit || !before) return { index: 0, t: 0 };
    if (hit.index !== before.index || hit.s === before.s) return { index: hit.index, t: hit.t };
    const f = (s - before.s) / (hit.s - before.s);
    return { index: hit.index, t: before.t + (hit.t - before.t) * f };
  };

  let worst = Infinity;
  for (const seg of segments) worst = Math.min(worst, minCurvatureRadius(seg));

  return {
    length,
    closed,
    segments,
    report,
    minCurvature: worst,
    pointAt(distance, target) {
      const { index, t } = locate(distance);
      const seg = segments[index];
      if (!seg) return target;
      return cubicPoint(seg, t, target);
    },
    tangentAt(distance, target) {
      const { index, t } = locate(distance);
      const seg = segments[index];
      if (!seg) return target;
      return cubicTangent(seg, t, target);
    },
  };
}
