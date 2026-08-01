import { Rng, TAU } from '../../core/mathUtils';
import type { ParkBoundary } from './boundary';
import {
  type CubicSegment,
  type Pose2,
  type SegmentKind,
  type Vec2,
  cubicPoint,
  cubicTangent,
  endPose,
  joinSegment,
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
}

/** What the search did, for the diagnostic on failure and the report on success. */
export interface SolveReport {
  readonly startPoseIndex: number;
  readonly segmentCount: number;
  readonly candidatesTried: number;
  readonly backtracks: number;
  readonly restarts: number;
  readonly closerAttempts: number;
  readonly length: number;
  readonly minRadius: number;
  readonly elapsedMs: number;
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
  constructor(
    message: string,
    readonly report: SolveReport,
  ) {
    super(message);
    this.name = 'RailRouteUnsolvable';
  }
}

/** Metres between validation samples along a candidate piece. */
const SAMPLE_STEP = 0.6;

/** Arc distance behind the head that self-clearance ignores (it is the head). */
const SELF_IGNORE_ARC = 22;

/** Fraction of the desired length after which closure is attempted. */
const CLOSE_AFTER = 0.68;

/** Fraction of the desired length after which nothing but closure is allowed. */
const CLOSE_ONLY_AFTER = 1.45;

/** Fraction after which the search steers home. Ramps to full bias at CLOSE_AFTER. */
const BIAS_FROM = 0.45;

/** Tensions the single-cubic closer tries, in order. */
const CLOSER_TENSIONS = [0.36, 0.45, 0.55, 0.65, 0.78, 0.9, 1.05];

/** Two-cubic closer attempts, each using fresh RNG draws. */
const CLOSER_TWO_PIECE_TRIES = 28;

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
  let backtracks = 0;
  let closerAttempts = 0;
  let restarts = 0;

  const restartLimit = Math.min(brief.budgets.restarts, brief.startPoses.length);

  for (let startIndex = 0; startIndex < restartLimit; startIndex += 1) {
    restarts = startIndex;
    const startPose = brief.startPoses[startIndex];
    if (!startPose) continue;

    // Accepted pieces, and the samples they contributed, so self-clearance is
    // measured against the track that was actually laid rather than the poses
    // it was laid from.
    const chosen: CubicSegment[] = [];
    const samples: Sample[] = [];
    const sampleCounts: number[] = [];
    const retries: number[] = [];
    const closerTried: boolean[] = [];
    let accumulated = 0;

    const headPose = (): Pose2 => {
      const last = chosen[chosen.length - 1];
      return last ? endPose(last) : startPose;
    };

    const accept = (seg: CubicSegment, produced: readonly Sample[]): void => {
      chosen.push(seg);
      sampleCounts.push(produced.length);
      for (const s of produced) samples.push(s);
      accumulated += seg.length;
    };

    const undo = (): void => {
      const seg = chosen.pop();
      if (!seg) return;
      const count = sampleCounts.pop() ?? 0;
      samples.length -= count;
      accumulated -= seg.length;
    };

    /**
     * Samples a candidate and returns them if every one is legal, or null.
     * `closing` relaxes self-clearance near the route's start, which a closer
     * is by definition heading straight for.
     */
    const validate = (seg: CubicSegment, closing: boolean): Sample[] | null => {
      if (minCurvatureRadius(seg) < brief.minRadius) return null;
      const steps = Math.max(2, Math.ceil(seg.length / SAMPLE_STEP));
      const produced: Sample[] = [];
      const point: Vec2 = { x: 0, z: 0 };
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        cubicPoint(seg, t, point);
        const s = accumulated + seg.length * t;
        if (!brief.clear(point.x, point.z, brief.corridorRadius)) return null;
        if (brief.boundary.distanceToEdge(point.x, point.z) < brief.corridorRadius) return null;
        for (const earlier of samples) {
          // The track immediately behind the head is not a collision, it is
          // where we just came from.
          if (s - earlier.s < SELF_IGNORE_ARC) continue;
          // A closer is aiming at the start pose; the start is not an obstacle.
          if (closing && earlier.s < SELF_IGNORE_ARC) continue;
          if (Math.hypot(point.x - earlier.x, point.z - earlier.z) < brief.selfClearance) {
            return null;
          }
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
    const tryClose = (): { seg: CubicSegment; samples: Sample[] }[] | null => {
      closerAttempts += 1;
      const head = headPose();

      for (const tension of CLOSER_TENSIONS) {
        const seg = joinSegment(head, startPose, tension, 'closer');
        const produced = validate(seg, true);
        if (produced) return [{ seg, samples: produced }];
      }

      const midX = (head.x + startPose.x) / 2;
      const midZ = (head.z + startPose.z) / 2;
      const span = Math.hypot(startPose.x - head.x, startPose.z - head.z) || 1;
      const alongX = (startPose.x - head.x) / span;
      const alongZ = (startPose.z - head.z) / span;

      for (let attempt = 0; attempt < CLOSER_TWO_PIECE_TRIES; attempt += 1) {
        const sideways = rng.range(-span * 0.6, span * 0.6);
        const forward = rng.range(-span * 0.2, span * 0.2);
        const swing = rng.range(-0.6, 0.6);
        const tensionA = rng.range(0.4, 0.95);
        const tensionB = rng.range(0.4, 0.95);
        const hx = alongX * Math.cos(swing) - alongZ * Math.sin(swing);
        const hz = alongX * Math.sin(swing) + alongZ * Math.cos(swing);
        const via: Pose2 = {
          x: midX + -alongZ * sideways + alongX * forward,
          z: midZ + alongX * sideways + alongZ * forward,
          hx,
          hz,
        };
        const first = joinSegment(head, via, tensionA, 'closerA');
        const firstSamples = validate(first, true);
        if (!firstSamples) continue;
        // The second piece is validated against a world that already contains
        // the first, so a closer cannot cross itself.
        accept(first, firstSamples);
        const second = joinSegment(via, startPose, tensionB, 'closerB');
        const secondSamples = validate(second, true);
        undo();
        if (secondSamples) {
          return [
            { seg: first, samples: firstSamples },
            { seg: second, samples: secondSamples },
          ];
        }
      }
      return null;
    };

    // --- the search ------------------------------------------------------
    let alive = true;
    let solved = false;
    const stepLimit = brief.budgets.perJoint * 220;
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

      const mustClose = brief.closed && accumulated >= brief.desiredLength * CLOSE_ONLY_AFTER;
      const exhausted = (retries[depth] ?? 0) >= brief.budgets.perJoint;

      if (mustClose || exhausted) {
        if (depth === 0) {
          alive = false;
          break;
        }
        backtracks += 1;
        retries[depth] = 0;
        closerTried[depth] = false;
        undo();
        continue;
      }

      retries[depth] = (retries[depth] ?? 0) + 1;
      candidatesTried += 1;

      const kind = pickKind(brief, rng, headPose(), startPose, accumulated);
      const seg = kind.make(headPose(), rng);
      const produced = validate(seg, false);
      if (produced) {
        accept(seg, produced);
        retries[chosen.length] = 0;
        closerTried[chosen.length] = false;
      }
    }

    if (solved) {
      const report: SolveReport = {
        startPoseIndex: startIndex,
        segmentCount: chosen.length,
        candidatesTried,
        backtracks,
        restarts,
        closerAttempts,
        length: accumulated,
        minRadius: Math.min(...chosen.map((s) => minCurvatureRadius(s))),
        elapsedMs: Date.now() - started,
      };
      return buildRoute(chosen, brief.closed, report);
    }
  }

  const report: SolveReport = {
    startPoseIndex: -1,
    segmentCount: 0,
    candidatesTried,
    backtracks,
    restarts: restartLimit,
    closerAttempts,
    length: 0,
    minRadius: 0,
    elapsedMs: Date.now() - started,
  };
  throw new RailRouteUnsolvable(
    `rail route did not solve: ${restartLimit} start poses tried, ` +
      `${candidatesTried} candidate pieces, ${backtracks} backtracks, ` +
      `${closerAttempts} closure attempts, in ${report.elapsedMs} ms. ` +
      `Brief wanted ${brief.desiredLength.toFixed(0)} m, closed=${brief.closed}, ` +
      `corridor ${brief.corridorRadius} m, min radius ${brief.minRadius} m.`,
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
    // Which way would turn us towards home? Cross product sign, in the same
    // sense `turn` is measured.
    const toHomeX = home.x - head.x;
    const toHomeZ = home.z - head.z;
    const cross = head.hx * toHomeZ - head.hz * toHomeX;
    const dot = head.hx * toHomeX + head.hz * toHomeZ;
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
  for (const seg of segments) worst = Math.min(worst, minCurvatureRadius(seg, 40));

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
