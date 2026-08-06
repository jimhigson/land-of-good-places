import { Rng, TAU, clamp } from '../../core/mathUtils';
import type { ParkBoundary } from './boundary';
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

/** The brief a caller hands in. Everything the search is allowed to know. */
export interface RouteBrief {
  /** Usually `PARK_SEED ^ someRideSalt`. */
  readonly seed: number;
  /** The pieces this ride may be built from. Encodes its minimum turn radius. */
  readonly vocabulary: readonly SegmentKind[];
  /** Metres of track wanted. Closure is attempted from `closeAfter` of this. */
  readonly desiredLength: number;
  /** Does the route return to its start? */
  readonly closed: boolean;
  /**
   * Where the route may begin, best first. This is the **outermost level of
   * the search**: when every route from one start pose fails, the next is
   * tried. For a closed loop whose station sits at the start, that makes the
   * station's position part of the search space rather than an assumption —
   * the same trick `train/plan.ts` plays when `clearStationDistance` slides a
   * station along the track until its platform is on clear ground.
   */
  readonly startPoses: readonly Pose2[];
  /** Is a corridor of `radius` about (x, z) free of obstacles? Layout only. */
  readonly clear: (x: number, z: number, radius: number) => boolean;
  readonly boundary: ParkBoundary;
  /** Half-width of track to keep clear of obstacles and the boundary. */
  readonly corridorRadius: number;
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
  readonly budgets: {
    /** Candidate pieces tried at one joint before backing up. */
    readonly perJoint: number;
    /** Start poses tried before giving up entirely. */
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

/** What the search did, for the diagnostic on failure and the report on success. */
export interface SolveReport {
  /** How many start poses the brief offered. Zero is its own kind of failure. */
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

export function solveRailRoute(brief: RouteBrief): SolvedRailRoute {
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
  const rejected = { collision: 0, boundary: 0, selfClearance: 0, curvature: 0 };

  const restartLimit = Math.min(brief.budgets.restarts, brief.startPoses.length);

  for (let startIndex = 0; startIndex < restartLimit; startIndex += 1) {
    restarts = startIndex;
    const startPose = brief.startPoses[startIndex];
    if (!startPose) continue;

    // Accepted pieces, and the samples they contributed, so self-clearance is
    // measured against the track that was actually laid rather than the poses
    // it was laid from.
    /**
     * The approach corridor: a pose sitting {@link APPROACH_DISTANCE} metres
     * *behind* the start, facing the same way.
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
    const approach: Pose2 = brief.closed
      ? {
          x: startPose.x - startPose.hx * APPROACH_DISTANCE,
          z: startPose.z - startPose.hz * APPROACH_DISTANCE,
          hx: startPose.hx,
          hz: startPose.hz,
        }
      : startPose;

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
     * cells. Pieces are added and removed strictly last-in-first-out as the
     * search advances and backtracks, so a cell's most recent entry is always
     * the one being taken back out.
     */
    const cell = Math.max(brief.selfClearance, 1);
    const grid = new Map<string, Sample[]>();
    const laid: Sample[] = [];
    const keyOf = (x: number, z: number): string =>
      `${Math.floor(x / cell)},${Math.floor(z / cell)}`;

    const headPose = (): Pose2 => {
      const last = chosen[chosen.length - 1];
      return last ? endPose(last) : startPose;
    };

    const accept = (seg: CubicSegment, produced: readonly Sample[]): void => {
      chosen.push(seg);
      sampleCounts.push(produced.length);
      for (const s of produced) {
        laid.push(s);
        const key = keyOf(s.x, s.z);
        const bucket = grid.get(key);
        if (bucket) bucket.push(s);
        else grid.set(key, [s]);
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
        grid.get(keyOf(s.x, s.z))?.pop();
      }
      accumulated -= seg.length;
    };

    /** Is (x, z) at arc `s` far enough from every earlier bit of track? */
    const selfClear = (x: number, z: number, s: number, closing: boolean): boolean => {
      const gx = Math.floor(x / cell);
      const gz = Math.floor(z / cell);
      for (let ix = gx - 1; ix <= gx + 1; ix += 1) {
        for (let iz = gz - 1; iz <= gz + 1; iz += 1) {
          const bucket = grid.get(`${ix},${iz}`);
          if (!bucket) continue;
          for (const earlier of bucket) {
            // The track immediately behind the head is not a collision, it is
            // where we just came from.
            if (s - earlier.s < SELF_IGNORE_ARC) continue;
            // A closer is aiming at the start pose; the start is not an obstacle.
            if (closing && earlier.s < SELF_IGNORE_ARC) continue;
            if (Math.hypot(x - earlier.x, z - earlier.z) < brief.selfClearance) return false;
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
      if (minCurvatureRadius(seg) < brief.minRadius) {
        rejected.curvature += 1;
        return null;
      }
      const steps = Math.max(2, Math.ceil(seg.length / SAMPLE_STEP));
      const produced: Sample[] = [];
      const point: Vec2 = { x: 0, z: 0 };
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        cubicPoint(seg, t, point);
        const s = accumulated + seg.length * t;
        if (!brief.clear(point.x, point.z, brief.corridorRadius)) {
          rejected.collision += 1;
          return null;
        }
        if (brief.boundary.distanceToEdge(point.x, point.z) < brief.corridorRadius) {
          rejected.boundary += 1;
          return null;
        }
        if (!selfClear(point.x, point.z, s, closing)) {
          rejected.selfClearance += 1;
          return null;
        }
        produced.push({ x: point.x, z: point.z, s });
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

    const tryClose = (): { seg: CubicSegment; samples: Sample[] }[] | null => {
      closerAttempts += 1;
      const head = headPose();

      // A biarc straight home, gentlest first.
      for (const segs of chainFor(head, startPose, 'closer')) {
        const taken = tryChain(segs);
        if (taken) return taken;
      }

      // Nothing direct fits, so swing wide: go via a seeded intermediate pose
      // and biarc each half. This is where an obstacle sitting between the head
      // and home gets gone around.
      const span = Math.hypot(startPose.x - head.x, startPose.z - head.z) || 1;
      if (span > VIA_MAX_GAP) return null;
      const midX = (head.x + startPose.x) / 2;
      const midZ = (head.z + startPose.z) / 2;
      const alongX = (startPose.x - head.x) / span;
      const alongZ = (startPose.z - head.z) / span;

      for (let attempt = 0; attempt < CLOSER_VIA_TRIES; attempt += 1) {
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
          for (const secondHalf of chainFor(via, startPose, 'closerB')) {
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
    };

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
      if (!brief.closed || accumulated / brief.desiredLength <= BIAS_FROM) return jitter + pull;
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
      steps += 1;
      if (steps > stepLimit) break;

      const depth = chosen.length;
      if (retries[depth] === undefined) retries[depth] = 0;
      if (closerTried[depth] === undefined) closerTried[depth] = false;

      // Closure is tried once per fresh arrival at a depth: backtracking to a
      // depth leaves its head pose unchanged, so a second attempt would be
      // asking the same question.
      if (brief.closed && !closerTried[depth] && accumulated >= brief.desiredLength * CLOSE_AFTER) {
        closerTried[depth] = true;
        const closer = tryClose();
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
      const mustClose = brief.closed && accumulated >= brief.desiredLength * CLOSE_ONLY_AFTER;
      const cursor = retries[depth] ?? 0;
      const exhausted = cursor >= Math.min(shortlist.length, brief.budgets.perJoint);

      if (mustClose || exhausted) {
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
      const reportFor = (satisfied: boolean): SolveReport => ({
        startPoseCount: brief.startPoses.length,
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
                startPoseCount: brief.startPoses.length,
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
    startPoseCount: brief.startPoses.length,
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
    brief.startPoses.length === 0
      ? 'the brief offered no admissible start poses at all — the outermost ' +
        'level of the search was empty before it began'
      : `all ${restartLimit} start poses were tried and every one dead-ended`;
  throw new RailRouteUnsolvable(
    `rail route did not solve: ${level}. ` +
      `${candidatesTried} candidate pieces, ${backtracks} backtracks, ` +
      `${closerAttempts} closure attempts, in ${report.elapsedMs} ms. ` +
      `Brief wanted ${brief.desiredLength.toFixed(0)} m, closed=${brief.closed}, ` +
      `corridor ${brief.corridorRadius} m, min radius ${brief.minRadius} m, ` +
      `self-clearance ${brief.selfClearance} m. ` +
      `Pieces rejected for: ${rejected.collision} collision, ${rejected.boundary} boundary, ` +
      `${rejected.selfClearance} self-clearance, ${rejected.curvature} curvature.`,
    report,
  );
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
    if (index === 0) stops.push({ s: 0, index: 0, t: 0 });
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
