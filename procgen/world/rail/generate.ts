import { Rng, TAU, clamp } from '../../../src/core/mathUtils';
import { arcChain, biarcs, cubicPoint, endPose, minCurvatureRadius, type CubicSegment, type Pose2, type SegmentKind, type Vec2 } from '../../../src/world/rail/segments';
import { buildRoute, type RouteBrief, type RouteInfluence, type SolveReport, type SolvedRailRoute } from '../../../src/world/rail/generate';
/**
 * **The rail route search** — grows a track piece by piece with backtracking.
 * Moved verbatim from `src/world/rail/generate.ts`, which keeps the route
 * types and `buildRoute`. Build-time only: the game reads routes from the
 * park file (`docs/design/PREBUILT-PARKS.md`).
 */

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
      // **And a piece that leaves home out of reach is too long already.** A
      // route must still get from this piece's end to the finish, and whatever
      // it lays to do so is never shorter than the straight line; if that line
      // would carry it over the ceiling, no descendant of this piece can ever
      // finish. The closer's {@link provablyTooLong} is the same bound.
      if (!closing && maxLength !== undefined) {
        const end = endPose(seg);
        const home = Math.hypot(finishPose.x - end.x, finishPose.z - end.z);
        if (accumulated + seg.length + home > maxLength + 1e-6) {
          rejected.tooLong += 1;
          return null;
        }
      }
      const steps = Math.max(2, Math.ceil(seg.length / SAMPLE_STEP));
      const produced: Sample[] = [];
      const point: Vec2 = { x: 0, z: 0 };
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        cubicPoint(seg, t, point);
        const s = accumulated + seg.length * t;
        if (
          !brief.clear(
            point.x,
            point.z,
            brief.corridorRadius,
            s,
            Math.hypot(finishPose.x - point.x, finishPose.z - point.z),
          )
        ) {
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

    /**
     * **Can no chain from `from` (via `via`, if given) to `to` fit under
     * {@link RouteBriefBase.maxLength}?** A pure prune for the closer.
     *
     * Every closer is built from circular arcs, and an arc is never shorter
     * than its chord, so the straight-line distance through the poses is a
     * lower bound on what the chain would add to `accumulated`. When that
     * bound already crosses the ceiling, `validate` would reject a piece of
     * every chain `chainFor` could build as `tooLong` — so the biarc
     * construction, the arc expansion and the validation are skipped and the
     * answer, null, is the same. No test here draws randomness, so the search
     * takes the identical path; only the diagnostic `rejected` counts move.
     *
     * Measured on seed 11 (#650): the closer fired ~900,000 times in one slide
     * solve and the biarc/arc construction it ran was a quarter of the whole
     * search's CPU, overwhelmingly for heads already too far from home to
     * finish under the 75 m ceiling.
     *
     * The margin is for float rounding in the chain's summed lengths: the prune
     * only fires when the bound clears the ceiling by more than it.
     */
    const provablyTooLong = (from: Pose2, via: Pose2 | null, to: Pose2): boolean => {
      if (maxLength === undefined) return false;
      const bound = via
        ? Math.hypot(via.x - from.x, via.z - from.z) + Math.hypot(to.x - via.x, to.z - via.z)
        : Math.hypot(to.x - from.x, to.z - from.z);
      return accumulated + bound > maxLength + 1e-6;
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
      if (!provablyTooLong(head, null, finishPose)) {
        for (const segs of chainFor(head, finishPose, 'closer')) {
          const taken = tryChain(segs);
          if (taken) return taken;
        }
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
        // The draws above are made whatever happens, so skipping the geometry
        // below cannot move the random stream — see {@link provablyTooLong}.
        if (provablyTooLong(head, via, finishPose)) continue;
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
