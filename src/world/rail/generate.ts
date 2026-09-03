import { Rng, TAU, clamp } from '../../core/mathUtils';
import type { ParkBoundary } from '../boundary';
import {
  type CubicSegment,
  type Pose2,
  type SegmentKind,
  type Vec2,
  arcChain,
  biarcs,
  cubicPoint,
  cubicTangent,
  endPose,
  minCurvatureRadius,
} from './segments';

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
interface RouteBriefBase {
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
  readonly clear: (x: number, z: number, radius: number, distanceAlong: number) => boolean;
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

/** Thrown when the search exhausts its budget, carrying why. */
export class RailRouteUnsolvable extends Error {
  // Assigned in the body rather than declared as a constructor parameter
  // property: several of this repo's check scripts run node in strip-only mode,
  // which cannot compile that syntax and dies at import time.
  readonly report: SolveReport;

  constructor(message: string, report: SolveReport) {
    super(message);
    this.name = 'RailRouteUnsolvable';
    this.report = report;
  }
}

/**
 * Metres between validation samples along a candidate piece.
 *
 * One metre, not the 0.6 tried first. Everything being dodged is metres across
 * — the castle's bounding circle is 19 m in radius, the corridor 3 m wide — so
 * a sample every metre cannot slip between an obstacle and its neighbour, and
 * the finer spacing bought nothing but a 40% slower search.
 */
const SAMPLE_STEP = 1;

/** Arc distance behind the head that self-clearance ignores (it is the head). */
const SELF_IGNORE_ARC = 22;

/** Fraction of the desired length after which closure is attempted. */
const CLOSE_AFTER = 0.68;

/** Fraction of the desired length after which nothing but closure is allowed. */
const CLOSE_ONLY_AFTER = 1.45;

/** Fraction after which the search steers home. Ramps to full bias at CLOSE_AFTER. */
const BIAS_FROM = 0.45;

/** Seeded intermediate poses the closer swings out through when direct fails. */
const CLOSER_VIA_TRIES = 16;

/**
 * Beyond this gap, the closer does not bother swinging out through an
 * intermediate pose. A detour spanning most of the park is not going to clear
 * the obstacles in between, and trying costs more than the search saves.
 */
const VIA_MAX_GAP = 95;

/**
 * Iterations allowed per start pose.
 *
 * Deliberately modest. With a shortlist ranked at every joint, a start pose
 * that is going to work usually works quickly; one that grinds is telling you
 * it is the wrong place to start, and the budget is better spent on the next
 * candidate station than on proving this one impossible.
 */
const STEPS_PER_START = 1200;

/**
 * How far behind the start the approach corridor sits.
 *
 * Long enough that lining up with it is a real constraint on the head's
 * heading, short enough that the biarc home is a small part of the loop.
 */
const APPROACH_DISTANCE = 38;

/** Within this of the approach point, steer to match its heading, not reach it. */
const ALIGN_RANGE = 26;

/** Legal pieces shortlisted and ranked at each joint before one is taken. */
/** Shared empty list, so an unweighted brief allocates nothing per joint. */
const EMPTY_INFLUENCES: readonly RouteInfluence[] = [];

const CANDIDATES_PER_JOINT = 16;

interface Sample {
  readonly x: number;
  readonly z: number;
  /** Arc distance from the route's start. */
  readonly s: number;
}

/**
 * **The search, as a generator — one route, solved a slice at a time.**
 *
 * Identical to {@link solveRailRoute} in every respect except that it suspends
 * at each joint and at the top of each attempt, so a caller with a frame budget
 * can advance it a little and come back. {@link solveRailRoute} is nothing but a
 * loop that drives this to completion, which is what keeps the two from ever
 * being two searches.
 *
 * ### Why the yields cannot move the route
 *
 * The whole search lives in this function's own locals — the `Rng`, the
 * counters, the accepted pieces, the grid. Suspending a generator preserves all
 * of that untouched and resumes at the same statement, so **the sequence of
 * `rng` draws is the same sequence, in the same order, whatever cadence the
 * caller advances it at.** There is no clock, no `await` and no shared state to
 * interleave with; a yield here is exactly as inert as a semicolon.
 *
 * That is an argument, and this repo does not ship arguments. `check:park-boot`
 * solves the ginormous slide **both ways in one process** and compares a hash of
 * 4000 sampled points: same route, or red.
 *
 * The value yielded is the index of the attempt in progress, purely so a driver
 * can say how far along it is. Nothing reads it to make a decision.
 */
export function* railRouteSearch(brief: RouteBrief): Generator<number, SolvedRailRoute, void> {
  const started = Date.now();
  const rng = new Rng(brief.seed);

  let candidatesTried = 0;
  let satisfyRejects = 0;
  /**
   * Builds the **first** route that solved but did not satisfy the brief.
   *
   * Kept as a thunk rather than a finished route so that exhausting the search
   * can hand *something* back whose report carries the **final** counts. Built
   * eagerly, it froze `satisfyRejects` at 1 — the value at the moment of the
   * first rejection — and under-reported in exactly the case the number exists
   * to describe: how much work the backstop is doing. The pieces are copied
   * because `chosen` is unwound by backtracking after this point.
   */
  let makeFallback: (() => SolvedRailRoute) | null = null;
  let backtracks = 0;
  let closerAttempts = 0;
  let restarts = 0;
  const rejected = { collision: 0, boundary: 0, selfClearance: 0, curvature: 0, tooLong: 0 };
  const maxLength = brief.maxLength;

  /**
   * The outermost level of the search, flattened.
   *
   * A closed loop finishes where it started, so an attempt is just a start
   * pose. An open route finishes somewhere else, so an attempt is a (start,
   * end) pair and every pairing is a distinct thing to try. Flattening the two
   * cases into one list keeps the search below identical for both — there is no
   * second loop and no second exit path to keep in step.
   */
  const attempts: { readonly start: Pose2; readonly finish: Pose2 }[] = [];
  if (brief.closed) {
    for (const pose of brief.startPoses) attempts.push({ start: pose, finish: pose });
  } else {
    for (const start of brief.startPoses) {
      for (const finish of brief.endPoses) attempts.push({ start, finish });
    }
  }

  const restartLimit = Math.min(brief.budgets.restarts, attempts.length);

  /**
   * The self-clearance grid's geometry, shared by every attempt.
   *
   * A **dense array over the brief's own extent**, not a `Map` keyed by an
   * integer: `selfClear` walks nine buckets per validated sample and was still
   * 19-23% of a cruiser solve after the integer keys landed, most of the
   * remainder being `Map.get`'s hashing against a plain array read. Every
   * sample stored or queried here has already passed the boundary check
   * (`validate` asks `clear`, then the boundary, then `selfClear`, in that
   * order), so it lies at least the corridor inside `boundary.extent` and the
   * two-cell pad covers the ±1-cell neighbour scan. Buckets are truncated and
   * reused between attempts rather than reallocated; `usedCells` records which
   * ones this attempt touched so the next one clears only those.
   */
  const cell = Math.max(brief.selfClearance, 1);
  const minGx = Math.floor(brief.boundary.extent.minX / cell) - 2;
  const minGz = Math.floor(brief.boundary.extent.minZ / cell) - 2;
  const cellsDeep = Math.floor(brief.boundary.extent.maxZ / cell) + 3 - minGz;
  const cellsWide = Math.floor(brief.boundary.extent.maxX / cell) + 3 - minGx;
  const grid: (Sample[] | null)[] = new Array(cellsWide * cellsDeep).fill(null);
  const usedCells: number[] = [];
  const cellIndexOf = (x: number, z: number): number =>
    (Math.floor(x / cell) - minGx) * cellsDeep + (Math.floor(z / cell) - minGz);

  for (let startIndex = 0; startIndex < restartLimit; startIndex += 1) {
    // The coarse suspension point: one whole attempt is the natural unit of
    // work, and on the slide's brief one costs tens of milliseconds — too long
    // for a frame on its own, which is why there is a second one at each joint
    // below.
    yield startIndex;
    restarts = startIndex;
    const attempt = attempts[startIndex];
    if (!attempt) continue;
    const startPose = attempt.start;
    /**
     * Where this attempt is trying to arrive: the start pose again for a loop,
     * the chosen end pose for an open route. Everything downstream that used to
     * say `startPose` because "the end is the start" says this instead.
     */
    const finishPose = attempt.finish;

    // Accepted pieces, and the samples they contributed, so self-clearance is
    // measured against the track that was actually laid rather than the poses
    // it was laid from.
    /**
     * The approach corridor: a pose sitting {@link APPROACH_DISTANCE} metres
     * *behind* the finish, facing the same way. For a loop the finish is the
     * start, which is the case this was originally written for.
     *
     * Steering at the start itself is the obvious thing and it does not work.
     * The head duly arrives near home — within 7 m, measured — but pointing
     * wherever it happened to be pointing, and a biarc between two poses that
     * are close together and badly aligned has to turn extremely tightly: 1 to
     * 6 m radius, against a 12 m limit, over and over. Being 7 m from home
     * facing the wrong way is *worse* than being 40 m away facing the right
     * way.
     *
     * Aiming at a point behind the start instead means the head lines up with
     * the start's own heading on the way in, and the closer is then joining two
     * poses that are already nearly collinear — which is exactly the case a
     * biarc handles with a gentle radius.
     */
    const approachDistance = brief.approachDistance ?? APPROACH_DISTANCE;
    const approach: Pose2 = {
      x: finishPose.x - finishPose.hx * approachDistance,
      z: finishPose.z - finishPose.hz * approachDistance,
      hx: finishPose.hx,
      hz: finishPose.hz,
    };

    const chosen: CubicSegment[] = [];
    const sampleCounts: number[] = [];
    const retries: number[] = [];
    const closerTried: boolean[] = [];
    const options: ({ seg: CubicSegment; samples: Sample[]; score: number }[] | null)[] = [];
    let accumulated = 0;

    /**
     * Laid track, bucketed by grid cell.
     *
     * Self-clearance was a scan of every sample laid so far against every
     * sample of every candidate — quadratic in the length of the route, run
     * thousands of times, and by far the most expensive thing the search did.
     * A grid whose cell is the clearance distance turns it into a look at nine
     * cells (the dense array above; it went `${gx},${gz}` string keys →
     * integer `Map` keys → flat array, each step measured). Pieces are added
     * and removed strictly last-in-first-out as the search advances and
     * backtracks, so a cell's most recent entry is always the one being taken
     * back out. The same samples land in the same buckets in the same order as
     * under either `Map` form, so the search sees an identical world.
     */
    for (let i = 0; i < usedCells.length; i += 1) {
      const used = grid[usedCells[i] as number];
      if (used) used.length = 0;
    }
    usedCells.length = 0;
    const laid: Sample[] = [];

    const headPose = (): Pose2 => {
      const last = chosen[chosen.length - 1];
      return last ? endPose(last) : startPose;
    };

    const accept = (seg: CubicSegment, produced: readonly Sample[]): void => {
      chosen.push(seg);
      sampleCounts.push(produced.length);
      for (const s of produced) {
        laid.push(s);
        const index = cellIndexOf(s.x, s.z);
        const bucket = grid[index];
        if (bucket) {
          // A bucket left empty — by this attempt's own backtracking or by a
          // previous attempt's clear-down — is being used afresh, and the next
          // attempt has to know to truncate it.
          if (bucket.length === 0) usedCells.push(index);
          bucket.push(s);
        } else {
          grid[index] = [s];
          usedCells.push(index);
        }
      }
      accumulated += seg.length;
    };

    const undo = (): void => {
      const seg = chosen.pop();
      if (!seg) return;
      const count = sampleCounts.pop() ?? 0;
      for (let i = 0; i < count; i += 1) {
        const s = laid.pop();
        if (!s) break;
        grid[cellIndexOf(s.x, s.z)]?.pop();
      }
      accumulated -= seg.length;
    };

    /**
     * Is (x, z) at arc `s` far enough from every earlier bit of track?
     *
     * The hottest loop in the whole generator — a CPU profile of one Sky
     * Cruiser solve spent 21% of it here even after the cell key stopped being
     * a string. Two things keep it cheap, and neither changes an answer:
     *
     *  - **Index loops, not `for…of`.** Nine buckets are walked per sample and
     *    every `for…of` allocated an iterator to do it.
     *  - **A bucket is in arc order, so the head skip can `break`.** Samples
     *    are appended as the route grows and popped last-in-first-out when it
     *    backtracks, so `s` never decreases within a bucket. The moment one
     *    entry is close enough behind the head to be ignored, so is every
     *    entry after it — carrying on to check them is provably wasted work.
     */
    const selfClearance = brief.selfClearance;
    const ignoreStart = brief.closed;
    const selfClear =(x: number, z: number, s: number, closing: boolean): boolean => {
      // Copied out of the closure context once per call: this is the hottest
      // function in the whole generator (30% of a grinding solve), and every
      // context read inside the nine-bucket loop is a load the engine cannot
      // hoist for us.
      const cells = grid;
      const deep = cellsDeep;
      const clearance = selfClearance;
      const gx = Math.floor(x / cell);
      const gz = Math.floor(z / cell);
      // A loop's closer is aiming at the start pose, so the start is not an
      // obstacle to it. An *open* route's finisher aims somewhere else
      // entirely, and its own start is an ordinary piece of track it has no
      // business running into — so this relaxation stays with loops.
      const skipStart = closing && ignoreStart;
      for (let ix = gx - 1; ix <= gx + 1; ix += 1) {
        const column = (ix - minGx) * deep - minGz;
        for (let iz = gz - 1; iz <= gz + 1; iz += 1) {
          const bucket = cells[column + iz];
          if (!bucket || bucket.length === 0) continue;
          for (let i = 0; i < bucket.length; i += 1) {
            const earlier = bucket[i] as Sample;
            // The track immediately behind the head is not a collision, it is
            // where we just came from — and nothing later in this bucket is
            // any further behind, so there is nothing left to look at.
            if (s - earlier.s < SELF_IGNORE_ARC) break;
            if (skipStart && earlier.s < SELF_IGNORE_ARC) continue;
            // The same exact axis prefilter the plot scans use: the cell is
            // `selfClearance` wide, so most entries in a *neighbouring* cell
            // are a whole axis out of reach, and `hypot(a, b) >= |a|` settles
            // those without the hypot.
            const dx = x - earlier.x;
            if (dx >= clearance || -dx >= clearance) continue;
            const dz = z - earlier.z;
            if (dz >= clearance || -dz >= clearance) continue;
            if (Math.hypot(dx, dz) < clearance) return false;
          }
        }
      }
      return true;
    };

    /**
     * Samples a candidate and returns them if every one is legal, or null.
     * `closing` relaxes self-clearance near the route's start, which a closer
     * is by definition heading straight for.
     */
    const validate = (seg: CubicSegment, closing: boolean): Sample[] | null => {
      // The length wall, checked FIRST because it is the cheapest rejection
      // there is — an addition and a comparison against work that would
      // otherwise sample the cubic sixty-five times and then walk it metre by
      // metre against the whole park. See {@link RouteBriefBase.maxLength}:
      // unset, this is one comparison against `undefined` and nothing else in
      // the search can tell the difference.
      if (maxLength !== undefined && accumulated + seg.length > maxLength) {
        rejected.tooLong += 1;
        return null;
      }
      const steps = Math.max(2, Math.ceil(seg.length / SAMPLE_STEP));
      const produced: Sample[] = [];
      const point: Vec2 = { x: 0, z: 0 };
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        cubicPoint(seg, t, point);
        const s = accumulated + seg.length * t;
        if (!brief.clear(point.x, point.z, brief.corridorRadius, s)) {
          rejected.collision += 1;
          return null;
        }
        if (
          brief.boundary.distanceToEdge(point.x, point.z) <
          (brief.boundaryMargin ?? brief.corridorRadius)
        ) {
          rejected.boundary += 1;
          return null;
        }
        if (!selfClear(point.x, point.z, s, closing)) {
          rejected.selfClearance += 1;
          return null;
        }
        produced.push({ x: point.x, z: point.z, s });
      }
      // Curvature LAST, and `brief.minRadius` doubles as a bail threshold —
      // the answer used here is only ever the comparison below, which
      // `bailBelow` provably cannot flip (see the parameter's doc in
      // `segments.ts`); the report's `minRadius` and `buildRoute`'s
      // `minCurvature` come from *accepted* pieces via the full scan, as ever.
      //
      // It used to run first, on the instinct that it was the cheap test. It
      // is the expensive one: 65 samples of hypot-and-divide, and measured on
      // seed 55 it rejected 13,241 pieces out of the 5.32 MILLION it fully
      // scanned — every piece the vocabulary or the analytic biarc had
      // already built at a legal nominal radius, and 2.1 million of which the
      // world checks above then rejected anyway. That was 40% of all
      // curvature sampling spent proving doomed pieces doomed twice over.
      //
      // **Which pieces are accepted is unchanged** — a piece must pass every
      // test whatever the order, no test draws randomness, and each test's own
      // verdict is untouched — so the search takes the same pieces in the same
      // order and the route is byte-identical (proven by fingerprint across
      // every solving sweep seed). What DOES move is diagnostic attribution:
      // a piece failing curvature *and* a world check now counts against the
      // world check it hit first. One increment per rejected piece, total
      // unchanged; only `measure-slide-route.mts` and failure messages print
      // the breakdown, and nothing asserts on it.
      if (minCurvatureRadius(seg, undefined, brief.minRadius) < brief.minRadius) {
        rejected.curvature += 1;
        return null;
      }
      return produced;
    };

    /**
     * The analytic closer. One cubic if it will do, two if it will not.
     *
     * The intermediate pose for the two-piece form is drawn around the midpoint
     * of the gap, pushed sideways and turned a little, which is enough freedom
     * to swing around something sitting between the head and home.
     */
    /**
     * Validates a run of pieces in order, each against a world that already
     * contains the ones before it, so a closer cannot cross itself. Leaves the
     * route exactly as it found it either way.
     */
    const tryChain = (
      segs: readonly CubicSegment[],
    ): { seg: CubicSegment; samples: Sample[] }[] | null => {
      const taken: { seg: CubicSegment; samples: Sample[] }[] = [];
      for (const seg of segs) {
        const produced = validate(seg, true);
        if (!produced) {
          for (let i = 0; i < taken.length; i += 1) undo();
          return null;
        }
        accept(seg, produced);
        taken.push({ seg, samples: produced });
      }
      for (let i = 0; i < taken.length; i += 1) undo();
      return taken;
    };

    /** Expands a biarc into cubics, if its radii are legal. */
    const chainFor = (from: Pose2, to: Pose2, kind: string): CubicSegment[][] => {
      const out: CubicSegment[][] = [];
      for (const arc of biarcs(from, to)) {
        if (arc.minRadius < brief.minRadius) {
          rejected.curvature += 1;
          continue;
        }
        let pose = from;
        const segs: CubicSegment[] = [];
        for (const piece of arc.arcs) {
          const chain = arcChain(pose, piece.length, piece.turn, kind);
          for (const seg of chain) segs.push(seg);
          const last = chain[chain.length - 1];
          if (last) pose = endPose(last);
        }
        out.push(segs);
      }
      return out;
    };

    /**
     * A generator, so the via fan below is not one indivisible unit of work.
     *
     * The whole closer used to run inside a single yield of the outer search:
     * up to {@link CLOSER_VIA_TRIES} seeded detours, each validating several
     * long pieces sample by sample — measured at up to 7.2 ms in one step on
     * the canonical slide (M4; roughly 3x that on the CI runner), which is
     * what actually tripped `check:park-boot`'s 3x-budget advance ceiling
     * there: a driver that checks the clock between steps cannot stop inside
     * a step. One yield per via try makes the worst step a single detour
     * instead of sixteen.
     *
     * Suspending here cannot move the route, by the same argument the outer
     * search makes: every piece of state is a local or the generator's own,
     * the `rng` draws happen in the same order whatever cadence the caller
     * advances at, and the yielded value is the attempt index like every
     * other yield. `check:park-boot` proves it, hashing sliced against
     * straight-through for cruiser and slide alike.
     */
    function* tryFinish(): Generator<
      number,
      { seg: CubicSegment; samples: Sample[] }[] | null,
      void
    > {
      closerAttempts += 1;
      const head = headPose();

      // A biarc straight home, gentlest first.
      for (const segs of chainFor(head, finishPose, 'closer')) {
        const taken = tryChain(segs);
        if (taken) return taken;
      }

      // Nothing direct fits, so swing wide: go via a seeded intermediate pose
      // and biarc each half. This is where an obstacle sitting between the head
      // and home gets gone around.
      const span = Math.hypot(finishPose.x - head.x, finishPose.z - head.z) || 1;
      if (span > VIA_MAX_GAP) return null;
      const midX = (head.x + finishPose.x) / 2;
      const midZ = (head.z + finishPose.z) / 2;
      const alongX = (finishPose.x - head.x) / span;
      const alongZ = (finishPose.z - head.z) / span;

      for (let attempt = 0; attempt < CLOSER_VIA_TRIES; attempt += 1) {
        yield startIndex;
        const sideways = rng.range(-span * 0.7, span * 0.7);
        const forward = rng.range(-span * 0.3, span * 0.3);
        const swing = rng.range(-0.9, 0.9);
        const hx = alongX * Math.cos(swing) - alongZ * Math.sin(swing);
        const hz = alongX * Math.sin(swing) + alongZ * Math.cos(swing);
        const via: Pose2 = {
          x: midX + -alongZ * sideways + alongX * forward,
          z: midZ + alongX * sideways + alongZ * forward,
          hx,
          hz,
        };
        for (const firstHalf of chainFor(head, via, 'closerA')) {
          const takenFirst = tryChain(firstHalf);
          if (!takenFirst) continue;
          for (const { seg, samples: produced } of takenFirst) accept(seg, produced);
          let result: { seg: CubicSegment; samples: Sample[] }[] | null = null;
          for (const secondHalf of chainFor(via, finishPose, 'closerB')) {
            const takenSecond = tryChain(secondHalf);
            if (takenSecond) {
              result = [...takenFirst, ...takenSecond];
              break;
            }
          }
          for (let i = 0; i < takenFirst.length; i += 1) undo();
          if (result) return result;
        }
      }
      return null;
    }

    /**
     * How good a piece is, lower being better: how near its end lands to the
     * approach corridor, and how well it lines up with it.
     *
     * Only once the route is long enough to be thinking about home — before
     * that the score is pure seeded jitter, which is what keeps the loop an
     * interesting shape instead of the shortest legal path to the corridor.
     */
    /**
     * Which influences the route has **not** reached yet.
     *
     * Measured against the track actually laid, so backtracking cannot leave a
     * pull switched off for a visit that has since been undone. Worked out once
     * per joint rather than once per candidate: sixteen candidates all get the
     * same answer, and the answer only changes when a piece is accepted.
     */
    const stillWanted = (): readonly RouteInfluence[] => {
      const wanted = brief.influences;
      if (!wanted || wanted.length === 0) return EMPTY_INFLUENCES;
      return wanted.filter((influence) => {
        for (const s of laid) {
          if (Math.hypot(s.x - influence.x, s.z - influence.z) <= influence.radius) return false;
        }
        return true;
      });
    };

    /**
     * The detour this piece's end still leaves to every unreached influence.
     *
     * Zero when a ride declared none, which is what keeps an unweighted brief
     * scoring exactly as it did before influences existed — adding zero to a
     * float changes nothing, and no randomness is drawn on this path.
     */
    const pullOf = (seg: CubicSegment, wanted: readonly RouteInfluence[]): number => {
      if (wanted.length === 0) return 0;
      const end = endPose(seg);
      let pull = 0;
      for (const influence of wanted) {
        const gap = Math.hypot(influence.x - end.x, influence.z - end.z) - influence.radius;
        if (gap > 0) pull += gap * influence.weight;
      }
      return pull;
    };

    const scoreOf = (seg: CubicSegment, wanted: readonly RouteInfluence[]): number => {
      const jitter = rng.unit() * 12;
      const pull = pullOf(seg, wanted);
      // No `!brief.closed` here, and that is not an oversight of the #213 merge.
      // Before open routes were first class this read `!brief.closed || …`,
      // which sent an open route down the jitter-only path *always*: it never
      // scored against the approach corridor, because it had no corridor to
      // score against. #118 gave it one, aimed at its chosen end pose, and the
      // whole point is that an open route now steers for its finish exactly as
      // a loop steers for its start. Restoring the guard switches that steering
      // back off: the route still solves, it just stops aiming.
      //
      // **Do not "restore" it.** This comment used to say nothing would fail,
      // which was an invitation to try — and was wrong. Measured in review: with
      // the guard back, `the ginormous slide stands on legs a child can walk
      // between` fails on seed 5, because the unaimed route reshapes and stands
      // on 0 legs where 3 are wanted. But that is one seed catching it by luck,
      // not a guard rail: the other four stay green, so a change made here that
      // looks fine on the canonical seed is exactly how this gets switched off.
      if (accumulated / brief.desiredLength <= BIAS_FROM) return jitter + pull;
      const end = endPose(seg);
      const dx = approach.x - end.x;
      const dz = approach.z - end.z;
      const range = Math.hypot(dx, dz);
      let wantX = dx / (range || 1);
      let wantZ = dz / (range || 1);
      if (range < ALIGN_RANGE) {
        const blend = range / ALIGN_RANGE;
        wantX = approach.hx * (1 - blend) + wantX * blend;
        wantZ = approach.hz * (1 - blend) + wantZ * blend;
      }
      const magnitude = Math.hypot(wantX, wantZ) || 1;
      const headingError = Math.acos(
        clamp((end.hx * wantX + end.hz * wantZ) / magnitude, -1, 1),
      );
      // A radian of misalignment is worth about 26 m of distance: arriving
      // pointing the right way matters roughly as much as arriving at all.
      return range + headingError * 26 + jitter + pull;
    };

    // --- the search ------------------------------------------------------
    let alive = true;
    let solved = false;
    const stepLimit = STEPS_PER_START;
    let steps = 0;

    while (alive) {
      // The fine suspension point. A joint — shortlist sixteen candidates,
      // validate each, take one or back up — is the smallest piece of this
      // search that leaves the route in a coherent state, and it is well under
      // a millisecond. Yielding here is what lets a caller stop inside an
      // attempt rather than being committed to all of it.
      yield startIndex;
      steps += 1;
      if (steps > stepLimit) break;

      const depth = chosen.length;
      if (retries[depth] === undefined) retries[depth] = 0;
      if (closerTried[depth] === undefined) closerTried[depth] = false;

      // Finishing is tried once per fresh arrival at a depth: backtracking to a
      // depth leaves its head pose unchanged, so a second attempt would be
      // asking the same question.
      if (!closerTried[depth] && accumulated >= brief.desiredLength * CLOSE_AFTER) {
        closerTried[depth] = true;
        const closer = yield* tryFinish();
        if (closer) {
          // Accepted exactly as validated — never re-validated, because a
          // second pass could disagree and quietly drop a piece, leaving a
          // loop with a hole in it.
          for (const { seg, samples: produced } of closer) accept(seg, produced);
          solved = true;
          break;
        }
      }

      // The legal pieces at this joint, best first, worked out once on arrival.
      //
      // Picking one candidate at random and re-rolling on rejection wanders:
      // it re-rolls the same bad region of the vocabulary and only stumbles
      // onto the approach corridor by luck. Building the shortlist once and
      // *ordering* it means the first thing tried at every joint is the piece
      // that best lines the head up for home, and backtracking walks down a
      // considered list rather than rolling dice again.
      if (!options[depth]) {
        const head = headPose();
        const wanted = stillWanted();
        const shortlist: { seg: CubicSegment; samples: Sample[]; score: number }[] = [];
        for (let i = 0; i < CANDIDATES_PER_JOINT; i += 1) {
          candidatesTried += 1;
          const kind = pickKind(brief, rng, head, approach, accumulated);
          const seg = kind.make(head, rng);
          const produced = validate(seg, false);
          if (produced) shortlist.push({ seg, samples: produced, score: scoreOf(seg, wanted) });
        }
        shortlist.sort((p, q) => p.score - q.score);
        options[depth] = shortlist;
        retries[depth] = 0;
      }

      const shortlist = options[depth] ?? [];
      const mustFinish = accumulated >= brief.desiredLength * CLOSE_ONLY_AFTER;
      const cursor = retries[depth] ?? 0;
      const exhausted = cursor >= Math.min(shortlist.length, brief.budgets.perJoint);

      if (mustFinish || exhausted) {
        if (depth === 0) {
          alive = false;
          break;
        }
        backtracks += 1;
        retries[depth] = 0;
        closerTried[depth] = false;
        options[depth] = null;
        undo();
        continue;
      }

      retries[depth] = cursor + 1;
      const pick = shortlist[cursor];
      if (pick) {
        accept(pick.seg, pick.samples);
        retries[chosen.length] = 0;
        closerTried[chosen.length] = false;
        options[chosen.length] = null;
      }
    }

    if (solved) {
      // `attempts.length`, never `brief.startPoses.length`. See the field's own
      // doc on {@link SolveReport.startPoseCount}: `startPoseIndex` indexes the
      // flat attempt list, so counting the other list makes the two describe
      // different things and nothing anywhere would complain.
      const reportFor = (satisfied: boolean): SolveReport => ({
        startPoseCount: attempts.length,
        startPoseIndex: startIndex,
        segmentCount: chosen.length,
        candidatesTried,
        backtracks,
        restarts,
        closerAttempts,
        length: accumulated,
        minRadius: Math.min(...chosen.map((s) => minCurvatureRadius(s))),
        elapsedMs: Date.now() - started,
        rejected: { ...rejected },
        satisfyRejects,
        satisfied,
      });

      // The backstop. A route that solves but does not meet what the ride
      // actually asked for is put aside — not thrown away entirely, because a
      // park with no coaster is far worse than one whose coaster missed, and
      // the alternative to keeping it is `RailRouteUnsolvable`.
      if (brief.satisfies) {
        const candidate = buildRoute(chosen, brief.closed, reportFor(true));
        if (!brief.satisfies(candidate)) {
          satisfyRejects += 1;
          if (!makeFallback) {
            const kept = [...chosen];
            const keptIndex = startIndex;
            const keptLength = accumulated;
            makeFallback = (): SolvedRailRoute =>
              buildRoute(kept, brief.closed, {
                startPoseCount: attempts.length,
                startPoseIndex: keptIndex,
                segmentCount: kept.length,
                candidatesTried,
                backtracks,
                restarts,
                closerAttempts,
                length: keptLength,
                minRadius: Math.min(...kept.map((seg) => minCurvatureRadius(seg))),
                elapsedMs: Date.now() - started,
                rejected: { ...rejected },
                satisfyRejects,
                satisfied: false,
              });
          }
          continue;
        }
        return candidate;
      }
      return buildRoute(chosen, brief.closed, reportFor(true));
    }
  }

  // Every start pose solved a route and every one failed `satisfies`. The park
  // still gets its ride; the report says the requirement went unmet, and the
  // caller decides whether that is worth complaining about.
  if (makeFallback) return makeFallback();

  const report: SolveReport = {
    startPoseCount: attempts.length,
    startPoseIndex: -1,
    segmentCount: 0,
    candidatesTried,
    backtracks,
    restarts: restartLimit,
    closerAttempts,
    length: 0,
    minRadius: 0,
    elapsedMs: Date.now() - started,
    rejected: { ...rejected },
    satisfyRejects,
    satisfied: false,
  };
  // Which level ran out matters more than the fact that one did: no start poses
  // at all is a brief that could never have worked, and says to go and look at
  // how the caller is choosing them, not at the search.
  const level =
    attempts.length === 0
      ? brief.closed
        ? 'the brief offered no admissible start poses at all — the outermost ' +
          'level of the search was empty before it began'
        : `the brief offered ${brief.startPoses.length} start poses and ` +
          `${brief.endPoses.length} end poses, which pair into no attempts at ` +
          'all — the outermost level of the search was empty before it began'
      : `all ${restartLimit} attempts were tried and every one dead-ended`;
  throw new RailRouteUnsolvable(
    `rail route did not solve: ${level}. ` +
      `${candidatesTried} candidate pieces, ${backtracks} backtracks, ` +
      `${closerAttempts} closure attempts, in ${report.elapsedMs} ms. ` +
      `Brief wanted ${brief.desiredLength.toFixed(0)} m, closed=${brief.closed}, ` +
      `corridor ${brief.corridorRadius} m, min radius ${brief.minRadius} m, ` +
      `self-clearance ${brief.selfClearance} m. ` +
      `Pieces rejected for: ${rejected.collision} collision, ${rejected.boundary} boundary, ` +
      `${rejected.selfClearance} self-clearance, ${rejected.curvature} curvature, ` +
      `${rejected.tooLong} over the ${brief.maxLength ?? Infinity} m ceiling.`,
    report,
  );
}

/**
 * Solves a rail route, start to finish, right now.
 *
 * **The only entry point the park's own generation uses**, and deliberately
 * still synchronous: every ride's route is solved at module load, before a
 * scene object exists, because `paths.ts` needs each ride's exit to build the
 * walk graph. See this file's own header.
 *
 * It is a driver over {@link railRouteSearch} rather than a second copy of the
 * search, so "the route the game builds" and "the route the loading screen
 * solves a slice at a time" cannot be two different routes — there is one
 * search and two cadences. A `throw` propagates out of `next()` exactly as it
 * would from a plain call, so {@link RailRouteUnsolvable} still reaches the
 * caller unchanged.
 */
export function solveRailRoute(brief: RouteBrief): SolvedRailRoute {
  const search = railRouteSearch(brief);
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}

/**
 * Chooses which kind of piece to try next.
 *
 * Past `BIAS_FROM` of the desired length the choice is increasingly restricted
 * to pieces that turn the head towards home, so the route is already pointing
 * the right way when the analytic closer takes over. Before that it is free,
 * which is what makes the loop a shape rather than a circle.
 */
function pickKind(
  brief: RouteBrief,
  rng: Rng,
  head: Pose2,
  home: Pose2,
  accumulated: number,
): SegmentKind {
  const progress = accumulated / brief.desiredLength;
  const bias =
    progress <= BIAS_FROM
      ? 0
      : Math.min(0.85, (progress - BIAS_FROM) / (CLOSE_AFTER - BIAS_FROM)) * 0.85;

  if (bias > 0 && rng.unit() < bias) {
    // What heading do we want? Far from the approach point, the one that gets
    // us there; near it, the approach's own heading — otherwise the head
    // arrives at the corridor still turning and sails straight through it.
    const toHomeX = home.x - head.x;
    const toHomeZ = home.z - head.z;
    const range = Math.hypot(toHomeX, toHomeZ);
    let wantX = toHomeX;
    let wantZ = toHomeZ;
    if (range < ALIGN_RANGE) {
      const blend = range / ALIGN_RANGE;
      wantX = home.hx * (1 - blend) + (toHomeX / (range || 1)) * blend;
      wantZ = home.hz * (1 - blend) + (toHomeZ / (range || 1)) * blend;
    }
    // Which way turns us towards that heading? Cross product sign, in the same
    // sense `turn` is measured.
    const cross = head.hx * wantZ - head.hz * wantX;
    const dot = head.hx * wantX + head.hz * wantZ;
    const wanted: -1 | 0 | 1 = Math.abs(cross) < 1e-6 && dot > 0 ? 0 : cross > 0 ? 1 : -1;
    const steering = brief.vocabulary.filter((k) => k.turnSign === wanted || k.turnSign === 0);
    if (steering.length > 0) return rng.pick(steering);
  }
  return rng.pick(brief.vocabulary);
}

/**
 * Wraps the chosen pieces in an arc-length parameterisation.
 *
 * The table maps distance to (piece, t) at a fixed sample spacing, and lookups
 * interpolate `t` between neighbours and then evaluate the real cubic. Sampling
 * the curve rather than lerping between cached points keeps tangents exact,
 * which matters because the swept rail geometry is built from them.
 */
function buildRoute(
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

/** Poses evenly spaced around a circle about (cx, cz), each tangent to it. */
export function ringStartPoses(
  cx: number,
  cz: number,
  radius: number,
  count: number,
  clockwise: boolean,
): Pose2[] {
  const poses: Pose2[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * TAU;
    const x = cx + Math.cos(angle) * radius;
    const z = cz + Math.sin(angle) * radius;
    const sign = clockwise ? -1 : 1;
    poses.push({ x, z, hx: -Math.sin(angle) * sign, hz: Math.cos(angle) * sign });
  }
  return poses;
}
