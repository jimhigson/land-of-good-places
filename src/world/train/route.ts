import { Vector3 } from 'three';
import { PARK_BOUNDARY } from '../boundary';
import { terrainHeight } from '../terrain';
import { type Vec2 } from '../rail/segments';
import { type SolvedRailRoute } from '../rail/generate';

/**
 * Where the park train's track goes.
 *
 * **Grown by the generic rail generator** (`rail/generate.ts`), the same one the
 * Sky Cruiser and the Rail Race use, since 11 August 2026. It lays pieces of
 * track end to end from a vocabulary that *encodes a minimum turn radius*, and
 * validates every piece sample-by-sample against the layout before placing it —
 * so a bend tighter than {@link TRAIN_MIN_TURN_RADIUS} and a piece that crosses
 * a stall are both things the search cannot return, rather than things a later
 * check has to catch.
 *
 * ### What this replaced, and why
 *
 * The route used to be a bespoke **radius-per-bearing profile**: 360 spokes,
 * relaxed, snapped into the free radial gaps between obstacles, then built as a
 * Catmull-Rom through control points every 5°. It failed two ways, both visible
 * on the canonical seed (measured):
 *
 * - **No curvature constraint at all.** A sharp radial dip between two control
 *   bearings produced a **0.60 m** bend — a hairpin tighter than one carriage.
 * - **The snap-between-control-points hop.** `snapToFree` was memoryless, so the
 *   profile could sit in one free interval at one 5° bearing and a different one
 *   at the next, and the spline interpolated *straight through the obstacle
 *   between them* — the train ran 0.31 m from the Rail Racer booth's centre and
 *   through the middle of the Water Fight ride. The old code's own comments
 *   flagged this as known and unfixed ("removes the temptation, not the
 *   capability").
 *
 * The generic solver has neither failure mode by construction: avoidance is a
 * precondition of a piece existing, and the curve it ships *is* the validated
 * cubics (this class keeps the `SolvedRailRoute` as its source of truth rather
 * than resampling it into a spline, so there is no rebuild sag to lose radius to
 * either — unlike `CoasterRoute`, which does resample and pays a headroom for
 * it).
 *
 * ### Why it is still solved synchronously at module load
 *
 * Unchanged, and load-bearing: every ride's route is solved from the layout
 * alone, before a scene object exists, because `paths.ts` needs each ride's exit
 * to build the walk graph and cannot wait for a scene. `solveRailRoute` is
 * synchronous, so `TRAIN_PLAN` (in `plan.ts`) gets a finished centre line the
 * same way it always did — `Scenery` keeps trees off it, the path graph gets a
 * node per station, and `ParkTrain` simply builds it.
 */

/**
 * Half the track's width plus a little. The train is 1.5 m across the buffers;
 * this is what a collider is "inside the train" within, and the number the
 * procgen invariant holds every plot and stall to. Exported (see `train/index`).
 */
export const TRACK_CLEARANCE = 1.3;

/** Drives {@link trainRouteSearch} straight through — the non-pre-warmed cadence. */

/** The solved loop, and everything the train and the stations ask of it. */
export class TrainRoute {
  readonly length: number;

  /** Smallest gap between the centre line and the boundary wall. For reporting. */
  readonly minClearance: number;

  /**
   * What the loop search actually cost — start poses offered, which one won,
   * restarts, backtracks (`rail/generate.ts`'s {@link SolveReport}).
   *
   * Exposed for `scripts/measure-train-solve-budget.mts` (#427): growing the
   * loop from a chosen crossing pose trades a ring of 96 candidate rim
   * bearings for a handful of interior ones, and `budgets.restarts` comes
   * straight from `startPoses.length` — so whether that starves the search is
   * a question about these numbers, and they were not readable from outside.
   */
  readonly solveReport: SolvedRailRoute['report'];

  private readonly solved: SolvedRailRoute;
  private readonly sampleX: Float64Array;
  private readonly sampleZ: Float64Array;
  private readonly sampleDistance: Float64Array;
  private readonly scratch = new Vector3();
  private readonly scratch2: Vec2 = { x: 0, z: 0 };

  /**
   * The searched loop this route was built from — what a prebuilt park
   * (`world/prebuilt/parkFile.ts`) writes down, so that it can hand the same
   * loop back to this constructor and get the same route.
   */
  get solvedRoute(): SolvedRailRoute {
    return this.solved;
  }

  /** Built from the loop the park's driver decided (`parkPlan.ts`'s train builder); never solves itself. */
  constructor(solved: SolvedRailRoute) {
    this.solved = solved;
    this.solveReport = this.solved.report;
    this.length = this.solved.length;

    // A lookup table for "where along the loop is this point?" — used to place
    // the stations and to send a child to the nearest one.
    const samples = 720;
    this.sampleX = new Float64Array(samples);
    this.sampleZ = new Float64Array(samples);
    this.sampleDistance = new Float64Array(samples);
    const p: Vec2 = { x: 0, z: 0 };
    let worstWall = Infinity;
    for (let i = 0; i < samples; i += 1) {
      const distance = (i / samples) * this.length;
      this.solved.pointAt(distance, p);
      this.sampleX[i] = p.x;
      this.sampleZ[i] = p.z;
      this.sampleDistance[i] = distance;
      const wall = PARK_BOUNDARY.distanceToEdge(p.x, p.z);
      if (wall < worstWall) worstWall = wall;
    }
    this.minClearance = worstWall;
  }

  /** Position on the centre line, `distance` metres along. Wraps both ways. */
  pointAt(distance: number, target = this.scratch): Vector3 {
    const p = this.solved.pointAt(this.wrap(distance), this.scratch2);
    return target.set(p.x, terrainHeight(p.x, p.z), p.z);
  }

  /**
   * The same centre-line point, ground-plane only — no `terrainHeight`.
   *
   * `paths.ts`'s `railInfoAt` asks "where is the rail near (x, z)?" thousands
   * of times while the walk graph solves, and it only ever reads `.x`/`.z` —
   * but {@link pointAt} pays for a `terrainHeight` sample (a boundary spline
   * walk) to fill in a `y` nobody looks at. Measured 25.7 ms of the paths
   * solve's single main-thread block (`check:park-boot`, 2026-08-24) spent
   * exactly there.
   */
  flatPointAt(distance: number, target: Vec2): Vec2 {
    return this.solved.pointAt(this.wrap(distance), target);
  }

  /** Unit tangent, pointing the way the train travels. Horizontal. */
  tangentAt(distance: number, target = new Vector3()): Vector3 {
    const t = this.solved.tangentAt(this.wrap(distance), this.scratch2);
    return target.set(t.x, 0, t.z).normalize();
  }

  /** Distance along the loop of the point nearest (x, z). */
  distanceNear(x: number, z: number): number {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < this.sampleX.length; i += 1) {
      const dx = (this.sampleX[i] ?? 0) - x;
      const dz = (this.sampleZ[i] ?? 0) - z;
      const squared = dx * dx + dz * dz;
      if (squared < bestDistance) {
        bestDistance = squared;
        best = this.sampleDistance[i] ?? 0;
      }
    }
    return best;
  }

  /** Folds any distance into [0, length). */
  wrap(distance: number): number {
    const wrapped = distance % this.length;
    return wrapped < 0 ? wrapped + this.length : wrapped;
  }

  /**
   * Signed gap from `from` to `to` going *forwards*, in metres. Always in
   * [0, length), so "how far to the next stop" never comes back negative.
   */
  forwardGap(from: number, to: number): number {
    return this.wrap(to - from);
  }
}
