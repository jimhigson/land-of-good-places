import { Vector3 } from 'three';
import { TRAIN_PLAN } from './plan';
import {
  CROSSING_STATION_CLEARANCE,
  CROSSING_STATION_STRUCTURE_CLEARANCE,
} from './clearance';
import { MIN_BRIDGE_HALF_LENGTH, MIN_RAMP_RUN } from './bridgeFootprint';
import { STATION_GAP } from './fence';
import { ENTRANCE_GATE_X, ENTRANCE_GATE_Z, isInEntranceGateway } from '../entrance/layout';
import { crossingSiteBanned } from '../parkWarp';
import { PARK_LAYOUT } from '../parkLayout';
import {
  NARROW_HALF_WIDTH,
  SITE_ANGLE_OFFSETS,
  SITE_BOUNDARY_MARGIN,
  SITE_HALF_WIDTH,
  SITE_HALF_WIDTHS,
  SITE_PLOT_MARGIN,
  SITE_RAMP_FLOOR,
  SITE_RAMP_IDEAL,
  fitBridgeAcross,
  railCorridorBlocked,
  probeBridgeReach,
} from './bridgeFit';

// Re-exported so every existing consumer (`paths.ts`, `crossings.ts`,
// `crossingPlan.ts`) keeps importing these from where it always did.
export { NARROW_HALF_WIDTH, SITE_HALF_WIDTH, SITE_RAMP_FLOOR, SITE_RAMP_IDEAL };

/**
 * **Where the park may cross its own railway — planned first, not
 * discovered afterwards** (Jim, 23 August 2026: "design the park around
 * these constraints, not try to fit the bridges into a park they were never
 * designed for").
 *
 * The old order was: plots placed, paths routed wherever they liked, then
 * `crossings.ts` *measured* where the drawn ribbons happened to meet the
 * rail, and only then — after scenery, lamps and stalls had claimed the
 * ground — did `bridgeFootprint.ts` try to fit a real ramp onto each
 * accidental crossing point. Measured result of that order (2026-08-23):
 * **zero bridges buildable on any of the three required seeds** (0/7
 * canonical, 0/7 seed 2, 0/5 seed 18), one crossing landed *inside a
 * station's fenced window* (sealed by `fence.ts`'s `stationRun` — 6
 * waypoints stranded), and several crossed so obliquely their fence gaps
 * ran to halfGap 8.5 m.
 *
 * This module inverts that order. It runs at module load — after the rail
 * (`TRAIN_PLAN`) and the plots (`PARK_LAYOUT`) are solved, before a single
 * path is drawn — and finds every point on the loop where a real bridge
 * (deck plus a genuinely walkable ramp on *both* sides) provably fits
 * against everything fixed that exists at that moment: the park boundary,
 * every placed plot, the rail's own corridor and the stations' fenced
 * windows. `paths.ts` then routes every rail-crossing leg through one of
 * these {@link CROSSING_SITES}, square to the track, so the drawn network
 * only ever meets the railway where a bridge belongs. The scatter passes
 * keep off the reserved footprints exactly as before (`bridgeKeepout.ts` —
 * whose crossings now land on these sites by construction), and
 * `ParkTrain`'s late, real, backtracking search stays the final verifier
 * rather than a search that was doomed before it started.
 *
 * **There is no level-crossing tier.** Jim's ruling, 2 Sep 2026: every
 * place a path crosses the railway is a bridge, and the ability to plan a
 * level crossing must not exist in the code. A loop that proves no bridge
 * site anywhere is an invalid park and this module fails it loudly; the
 * cure is a warp vector (`parkWarp.ts`) or, failing that, the seed simply
 * not entering the pool — never a flat crossing. (The tier this replaced
 * was measured before deletion: emptying it cost no attraction on any of
 * the sixteen pool seeds, only garden-waypoint pockets that the baked
 * warps reconnect — branch feat/park-warp-solver, measurements/.)
 *
 * Thresholds are the game's own (CLAUDE.md's procgen rule): the walkable
 * floor is `BRIDGE_RISE / MAX_RAMP_GRADIENT` — the identical floor the real
 * acceptance pass demands — never a separately-invented number.
 */
export interface CrossingSite {
  /** Metres along the solved loop. */
  readonly railDistance: number;
  /** The crossing point, on the track centre line. */
  readonly x: number;
  readonly z: number;
  /** Unit direction a path travels while crossing here — perpendicular to
   * the rail, or one of the small oblique angles tried when perpendicular
   * does not fit. Points toward the local `side = +1` of the rail
   * (`crossings.ts`'s side convention). */
  readonly dirX: number;
  readonly dirZ: number;
  /** Feasible clear reach past the deck's edge along `+dir` / `-dir`,
   * measured against boundary, plots and the rail corridor. For a bridge
   * site both are at least {@link SITE_RAMP_FLOOR}; for a level-crossing
   * site they are the (much shorter) ground-corridor reaches. */
  readonly rampReachPos: number;
  readonly rampReachNeg: number;
  /** The corridor half-width this site was proven at. For a bridge site
   * this is what the measured crossing's `halfGap` is capped to (minus the
   * probe's own half-stride of slack), so the real search's deck-width
   * floor never exceeds the width the site was actually proven feasible
   * at. {@link SITE_HALF_WIDTH} normally; {@link NARROW_HALF_WIDTH} for a
   * site that only fits a narrower deck. */
  readonly halfWidth: number;
}






/**
 * A crossing may not land where `fence.ts`'s `stationRun` seals the far
 * side of a platform: the station's own window (`STATION_GAP` either way)
 * plus the half-gap a planned crossing's fence opening needs, plus a post's
 * worth of daylight so gap and window never merge into one another.
 */
const STATION_CLEARANCE = CROSSING_STATION_CLEARANCE;

/** Metres between candidate points marched along the loop. */
const MARCH_STEP = 2.0;

/** Minimum spacing kept between two selected sites of the same tier, along
 * the loop — two bridges closer than this fight over the same ground
 * (`bridgeFootprint.ts`'s `RAMP_CLEARANCE` capping) and read as clutter. */
const SITE_SPACING = 24;

const scratch = new Vector3();

/**
 * Which side of the railway a point stands on, in `crossings.ts`'s own sign
 * convention (+1 along `(tangent.z, -tangent.x)` from the nearest rail point).
 * Well-defined for any point meaningfully off the centre line; the loop is
 * simple (never self-crossing), so the sign is stable park-wide.
 *
 * The one owner. `crossingPlan.ts` re-exports it as `railSideOf`, which is
 * where every other module imports it from, and this module's own second-tier
 * gate pass calls it directly rather than keeping a copy.
 */
const sideScratch = new Vector3();
const sideTangent = new Vector3();
export function railSideOf(x: number, z: number): 1 | -1 {
  const route = TRAIN_PLAN.route;
  const d = route.distanceNear(x, z);
  const p = route.pointAt(d, sideScratch);
  const t = route.tangentAt(d, sideTangent);
  return Math.sign(t.z * (x - p.x) - t.x * (z - p.z)) >= 0 ? 1 : -1;
}

/** The same memo for "how far from the rail centre line" — `distanceNear`
 * walks the whole solved loop per query. */
const railDistanceCache = new Map<number, number>();
function railDistanceAt(x: number, z: number): number {
  const key = (Math.round(x) + 8192) * 32768 + (Math.round(z) + 8192);
  const hit = railDistanceCache.get(key);
  if (hit !== undefined) return hit;
  const route = TRAIN_PLAN.route;
  const p = route.pointAt(route.distanceNear(x, z), scratch);
  const value = Math.hypot(x - p.x, z - p.z);
  railDistanceCache.set(key, value);
  return value;
}

/**
 * Ground the stations' own structures stand on, *spatially* — the platform,
 * canopy posts and station furniture live within a few metres of the rail
 * across the platform window. {@link stationBlocked} already keeps a site
 * out of that window *along the loop*, but the loop bends back past itself:
 * on seed 2 a provably-feasible site 190 m away along the rail stood 11 m
 * from a station's canopy post in space, and the post killed the real
 * bridge search at the very last half-metre of required ramp. Sampled once,
 * at module load, from the same plan the stations are built from.
 */
const STATION_STRUCTURE_CLEARANCE = CROSSING_STATION_STRUCTURE_CLEARANCE;

const stationWindowPoints: readonly (readonly [number, number])[] = (() => {
  const route = TRAIN_PLAN.route;
  const points: (readonly [number, number])[] = [];
  const p = new Vector3();
  for (const station of TRAIN_PLAN.stations) {
    for (let d = -STATION_GAP; d <= STATION_GAP; d += 2) {
      route.pointAt(route.wrap(station.distance + d), p);
      points.push([p.x, p.z]);
    }
  }
  return points;
})();

function nearStationStructure(x: number, z: number): boolean {
  for (const [px, pz] of stationWindowPoints) {
    if (Math.hypot(x - px, z - pz) < STATION_STRUCTURE_CLEARANCE) return true;
  }
  return false;
}

interface Candidate extends CrossingSite {
  /** 0 = square to the track; larger = more oblique (selection prefers small). */
  readonly obliqueness: number;
}

function stationBlocked(railDistance: number): boolean {
  const route = TRAIN_PLAN.route;
  for (const station of TRAIN_PLAN.stations) {
    const along = Math.abs(
      route.wrap(railDistance - station.distance + route.length / 2) - route.length / 2,
    );
    if (along < STATION_CLEARANCE) return true;
  }
  return false;
}

/**
 * Probe one candidate crossing (point + direction) at `halfWidth`, out to
 * `maxReach` past the deck on each side. Returns the clear reach per side.
 */
function probeReach(
  point: Vector3,
  dirX: number,
  dirZ: number,
  halfWidth: number,
  maxReach: number,
  boundaryMargin: number,
  plotMargin: number,
): { pos: number; neg: number; deckClear: boolean } {
  // The geometry lives in `bridgeFit.ts`, shared with #427's start-pose
  // generator so the two can never answer "does a bridge fit here"
  // differently — see that module's header on why a second copy would
  // recreate issue #414 one level earlier. What is added here is the pair of
  // tests that need a *solved* route, which is exactly what this caller has
  // and the pose generator does not.
  return probeBridgeReach(
    point.x,
    point.z,
    dirX,
    dirZ,
    halfWidth,
    maxReach,
    boundaryMargin,
    plotMargin,
    plannerBlocked,
  );
}

/**
 * **A bridge may not stand in the park's own front doorway** (#414, #437).
 *
 * A deck is `2 * SITE_HALF_WIDTH` = 10 m wide and its parapets flank it; the
 * entrance arch is `2 * ENTRANCE_GATE_HALF_WIDTH` = 8.6 m wide. **The bridge
 * is wider than the gate**, so a ramp that reaches the arch necessarily stands
 * its masonry inside the doorway — there is no width at which it fits.
 *
 * Measured on seed 11, which is what found this: a proven site at (2.0, 43.0),
 * 17.1 m from the gate, with an 18.4 m ramp extent (`DECK_HALF_LENGTH +
 * rampReach`) against an arch at z = 54. The arch stood **mid-ramp**, and
 * `probe-blocked-ribbons` reported the first metre of the walk in as blocked:
 *
 * ```
 * gate-approach: BLOCKED 0.0-1.0 m of 49.8 — at (0.0, 54.0)
 *                :: wall len=2.0 halfT=0.15 top=1.6
 * ```
 *
 * A child walking in through the arch hit a parapet in her first metre.
 * `check:park` saw seed 11 as **0 stranded** throughout, because the ground
 * beyond is reachable another way — so nothing else in the repo could see it.
 *
 * **This keeps bridges at the gate, and only stops them standing on it.** A
 * crossing far enough inside the arch is untouched; the ramp march simply
 * stops at the doorway, so a site with room to land its ramp short of the arch
 * still proves, and one without falls back to a level crossing. That is the
 * ordinary backtracking every generator here does, through the callback the
 * planner already had — no new threshold, and the width comes from
 * `entrance/layout.ts`, which owns the gate.
 *
 * The predicate itself lives in `entrance/layout.ts`, which owns the gate, and
 * `bridgeFootprint.ts` asks the same one when it *builds* — planning it here
 * alone was measurably not enough.
 */

/**
 * The two tests that need a *solved* route — which is exactly what this caller
 * has and the pose generator does not. Named rather than inline because
 * {@link bridgeCandidateAt} hands it to `bridgeFit.ts`'s shared width/angle
 * search as well as using it through {@link probeReach}.
 */
const corridorBlocked = railCorridorBlocked(railDistanceAt);
const plannerBlocked = (x: number, z: number, along: number): boolean =>
  nearStationStructure(x, z) || isInEntranceGateway(x, z) || corridorBlocked(x, z, along);

/** The `side = +1` direction at `railDistance` — `crossings.ts`'s own sign
 * convention (`side = sign(tangent.z * dx - tangent.x * dz)`). */
function sidePlusDirection(tangent: Vector3): readonly [number, number] {
  return [tangent.z, -tangent.x];
}

function bridgeCandidateAt(
  railDistance: number,
  rampFloor: number = SITE_RAMP_FLOOR,
): Candidate | null {
  if (stationBlocked(railDistance)) return null;
  const route = TRAIN_PLAN.route;
  const point = new Vector3();
  const tangent = new Vector3();
  route.pointAt(railDistance, point);
  route.tangentAt(railDistance, tangent);
  const [perpX, perpZ] = sidePlusDirection(tangent);

  const fit = fitBridgeAcross(point.x, point.z, perpX, perpZ, plannerBlocked, rampFloor);
  if (!fit) return null;
  return {
    railDistance,
    x: point.x,
    z: point.z,
    dirX: fit.dirX,
    dirZ: fit.dirZ,
    rampReachPos: fit.rampReachPos,
    rampReachNeg: fit.rampReachNeg,
    halfWidth: fit.halfWidth,
    obliqueness: Math.abs(fit.angleOffset) + (fit.halfWidth < SITE_HALF_WIDTH ? 0.01 : 0),
  };
}

/**
 * **Would two bridges built on these sites occupy the same ground?**
 *
 * {@link SITE_SPACING} measures separation *along the loop*, which is a
 * clutter rule and cannot answer this: the railway winds, so two crossings a
 * long way apart around the loop can be a few metres apart in the park.
 *
 * Each site is treated as the oriented rectangle its bridge will really fill:
 * {@link MIN_BRIDGE_HALF_LENGTH} along the crossing direction (deck plus the
 * ramp every accepted bridge must achieve, asked of `bridgeFootprint.ts` rather
 * than restated here) by its own proven `halfWidth` across. Overlap is the
 * separating-axis test on the four face normals — exact for two rectangles, and
 * it costs nothing at this scale.
 *
 * This is deliberately about *footprints*, not centres. Two bridges side by
 * side, parallel and laterally offset, do not overlap and are perfectly fine; a
 * plain centre-distance rule would have banned them.
 *
 * ## What it does NOT do, and this matters
 *
 * **It does not fix the seed 2 collision that motivated #392, and it cannot.**
 * Its caller gates it on `candidate.bridge`, so it only ever compares two
 * *proven bridge sites* — and seed 2 proves **zero** of those (canonical proves
 * 4, seeds 5 and 11 three each, seed 18 one). All seven of seed 2's planned
 * sites are level ones, and the two bridges that collided there were built
 * opportunistically by `bridgeFootprint.ts`'s late `planReal` pass on crossings
 * planned as *level* crossings. There was never a pair of bridge sites for this
 * to reason about.
 *
 * **Measured, it fires zero times across the canonical seed and all four sweep
 * seeds**, and bridge counts are identical with and without it. It is a guard
 * on trust: correct by construction, and untested by any seed we build. #392
 * carries the re-scoped question — why seed 2 proves no bridge sites at all,
 * which is the defect that actually let two bridges collide.
 */
function footprintsOverlap(a: CrossingSite, b: CrossingSite): boolean {
  const axes = [
    [a.dirX, a.dirZ],
    [-a.dirZ, a.dirX],
    [b.dirX, b.dirZ],
    [-b.dirZ, b.dirX],
  ] as const;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  for (const [axX, axZ] of axes) {
    // Each rectangle's own extent on this axis, and the gap between centres.
    const extent = (c: CrossingSite): number =>
      Math.abs((c.dirX * axX + c.dirZ * axZ) * MIN_BRIDGE_HALF_LENGTH) +
      Math.abs((-c.dirZ * axX + c.dirX * axZ) * c.halfWidth);
    // A single axis on which they are apart proves they do not overlap.
    if (Math.abs(dx * axX + dz * axZ) >= extent(a) + extent(b)) return false;
  }
  return true;
}

function selectSpaced(candidates: readonly Candidate[], serveTheGate = false): CrossingSite[] {
  const route = TRAIN_PLAN.route;
  const scored = [...candidates].sort(
    (a, b) =>
      a.obliqueness - b.obliqueness ||
      Math.min(b.rampReachPos, b.rampReachNeg) - Math.min(a.rampReachPos, a.rampReachNeg),
  );
  // **The candidate nearest the park's entrance is kept first.**
  //
  // This ranking has no notion of where the park *needs* to cross; it ranks by
  // how square and how roomy a candidate is, and the 24 m rule then clears
  // everything near whatever won. That is right for the open park and wrong at
  // the one place the network is guaranteed to need a crossing.
  //
  // Measured on seed 18. Its loop runs 2.5 m from the entrance arch and seals
  // the gate-side neck outright: swept about the arch there is 0.0 m of
  // gate-side ground 2 m out and 0.9 m at 4 m, against a 3.6 m ribbon. So the
  // walk in must cross within a few metres of the arch. Of 77 level
  // candidates the spacing rule kept 9, and near the gate it kept railDistance
  // 8 — 25.3 m from the arch, across the railway — over railDistance 306,
  // which stands 8.0 m from the arch and which the tier passes (reach 4.0/3.5
  // against a 3.5 floor). It preferred it on ramp reach, 4.0 against 3.5. The
  // walk in from the gate was then left crossing at railDistance 300.1 with no
  // planned site anywhere in the 90 m from 274 to 4.
  //
  // Seeding the keep list with the arch's own nearest candidate costs nothing
  // anywhere else: it is one site of the same tier, subject to the same 24 m
  // rule for everything that follows it, and on a seed whose loop is nowhere
  // near the gate it is a site that would have been kept regardless or one
  // that displaces a neighbour no better than itself. Measured across all five
  // CI seeds before shipping — see the commit.
  const kept: Candidate[] = [];
  if (serveTheGate && scored.length > 0) {
    let nearest = scored[0] as Candidate;
    for (const candidate of scored) {
      const gap = Math.hypot(candidate.x - ENTRANCE_GATE_X, candidate.z - ENTRANCE_GATE_Z);
      if (gap < Math.hypot(nearest.x - ENTRANCE_GATE_X, nearest.z - ENTRANCE_GATE_Z)) {
        nearest = candidate;
      }
    }
    kept.push(nearest);
  }
  for (const candidate of scored) {
    const tooClose = kept.some(
      (other) =>
        Math.abs(
          route.wrap(candidate.railDistance - other.railDistance + route.length / 2) -
            route.length / 2,
        ) < SITE_SPACING,
    );
    const collides = kept.some((other) => footprintsOverlap(candidate, other));
    if (collides && !tooClose && (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.['LGP_DEBUG_BRIDGE']) {
      (globalThis as unknown as { process: { stdout: { write: (s: string) => void } } }).process.stdout.write(
        `site: bridge candidate at railD=${candidate.railDistance.toFixed(1)} (${candidate.x.toFixed(1)}, ${candidate.z.toFixed(1)}) rejected -- footprint overlaps a kept bridge site\n`,
      );
    }
    if (!tooClose && !collides) kept.push(candidate);
  }
  if ((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.['LGP_DEBUG_BRIDGE']) {
    for (const k of kept) {
      (globalThis as unknown as { process: { stdout: { write: (s: string) => void } } }).process.stdout.write(
        `site: kept BRIDGE railD=${k.railDistance.toFixed(1)} at (${k.x.toFixed(2)}, ${k.z.toFixed(2)}) dir=(${k.dirX.toFixed(2)}, ${k.dirZ.toFixed(2)}) halfW=${k.halfWidth.toFixed(2)}\n`,
      );
    }
  }
  kept.sort((a, b) => a.railDistance - b.railDistance);
  return kept.map(({ obliqueness: _obliqueness, ...site }) => site);
}


/** **Why did the planner refuse a bridge here?** — diagnostic only (#414/#427).
 * Reports, per width and angle, which gate closed, through the same probe the
 * real decision uses. */
export function explainBridgeRefusal(railDistance: number): string[] {
  if (stationBlocked(railDistance)) return [`railD=${railDistance.toFixed(1)}: inside a station's window`];
  const route = TRAIN_PLAN.route;
  const point = new Vector3();
  const tangent = new Vector3();
  route.pointAt(railDistance, point);
  route.tangentAt(railDistance, tangent);
  const [perpX, perpZ] = sidePlusDirection(tangent);
  const out: string[] = [`railD=${railDistance.toFixed(1)} at (${point.x.toFixed(1)}, ${point.z.toFixed(1)}):`];
  for (const halfWidth of SITE_HALF_WIDTHS) {
    for (const offset of SITE_ANGLE_OFFSETS) {
      const cos = Math.cos(offset);
      const sin = Math.sin(offset);
      const { pos, neg, deckClear } = probeReach(
        point, perpX * cos + perpZ * sin, -perpX * sin + perpZ * cos,
        halfWidth, SITE_RAMP_IDEAL, SITE_BOUNDARY_MARGIN, SITE_PLOT_MARGIN,
      );
      out.push(`  halfW=${halfWidth.toFixed(1)} angle=${((offset * 180) / Math.PI).toFixed(0)}deg: ` +
        (!deckClear ? 'DECK BLOCKED' :
          `reach ${pos.toFixed(1)}/${neg.toFixed(1)} vs floor ${SITE_RAMP_FLOOR.toFixed(1)}` +
          (pos < SITE_RAMP_FLOOR || neg < SITE_RAMP_FLOOR ? ' -- SHORT' : ' -- OK')));
    }
  }
  return out;
}

export interface SolvedCrossingSites {
  readonly bridges: readonly CrossingSite[];
}

/**
 * **The gate gets a second tier when the first proves nothing near it** — a
 * backtrack ladder for exactly one site, and only when the alternative is a
 * park whose front gate is joined to nothing.
 *
 * The park's arch is world-fixed at `[0, 54]` and the walk in from it has to
 * reach the ring. Where the loop runs between the two, that walk must cross on
 * a bridge — there is no level tier any more — so a seed with no site anywhere
 * near the gate's own stretch of loop strands its whole entrance.
 *
 * ## Measured on the canonical seed, 2 Sep 2026
 *
 * `scripts/tmp-ribboncomp.mts` floods the drawn paving from the backbone: the
 * canonical seed has **two** paving components and the second is
 * `gate-approach` alone — a 7.2 m ribbon from the arch touching nothing else in
 * the park. `scripts/tmp-refusal.mts` (control: railD=300, a site that WAS
 * kept, reads OK) says why no site serves it:
 *
 * ```
 * railD=0.0 at (0.0, 41.0)     halfW=4.0 angle=0deg: reach 15.2/11.2 vs floor 12.1 -- SHORT
 * railD=300.0 at (-38.6,11.2)  halfW=5.0 angle=0deg: reach 13.7/15.2 vs floor 12.1 -- OK
 * ```
 *
 * The square-on fit at the very point the gate corridor meets the loop misses
 * by **0.9 m on one side**, with **3.1 m to spare on the other**. And
 * `SITE_RAMP_FLOOR` is `MIN_RAMP_RUN + 1.0`: the site clears the *real*
 * acceptance bar (11.2 > 11.1) and is refused by the one extra stride of
 * **planning** slack that exists so the late, real pass has something to spend
 * on a lamp base or a bush trunk.
 *
 * So this pass re-marches the gate's own window at {@link MIN_RAMP_RUN} — the
 * bar `bridgeFootprint.ts` itself accepts — and keeps the least oblique fit it
 * finds. Giving up planning slack on a site that would otherwise not exist is a
 * different decision, not a weaker rule: **`SITE_RAMP_FLOOR` is untouched for
 * every other candidate on every seed**, which is the whole point of doing it
 * here rather than by lowering the constant.
 *
 * Both of its guards reuse constants this file already owns rather than
 * inventing a reach of their own: the window is {@link SITE_SPACING} either
 * way of the gate's nearest rail distance, and the trigger is that no
 * first-tier site is already inside it — so on a seed the first tier already
 * serves, this runs, finds the site it was going to find, and adds nothing.
 *
 * Not to be confused with `selectSpaced`'s `serveTheGate` flag, which is a
 * *ranking* change within the first tier. That was measured on 2 Sep 2026 and
 * **reverted**: it moved canonical's sites by 2 m of rail distance and cost
 * seed 11 (3 -> 7 stranded) and seed 451 (0 -> 1, losing green). It cannot help
 * here because there is no first-tier candidate near the gate to prefer.
 */
function serveTheGateOnTheSecondTier(bridges: CrossingSite[]): void {
  const route = TRAIN_PLAN.route;
  // **Only when the walk in actually has to cross.** A site is not free: since
  // the grid rework every crossing reserves a rectangle that is forbidden
  // ground to every foreign leg, so an unneeded one lays a no-go across the
  // park's entrance for nothing.
  //
  // Measured, 2 Sep 2026 (`scripts/tmp-gateside.mts`), ungated:
  //
  //   canonical  gateSide=-1 centreSide= 1   gained railD=1 @(0.8,41.0) reach 15.2/11.2
  //                                          -> poi.stranded 4 -> 0, GREEN
  //   208        gateSide=-1 centreSide=-1   gained railD=49 @(-1.9,37.3) reach 11.7/15.2
  //                                          -> poi.stranded 0 -> 9, LOST GREEN
  //
  // Seed 208's gate stands on the **same** side of the loop as the fountain,
  // so nothing about its walk in needs a bridge and the site it was handed was
  // pure cost. The condition is therefore the structural one and not a
  // threshold: the gate and the park's own middle on opposite sides of the
  // track is exactly when the avenue must cross.
  //
  // `PARK_LAYOUT.fountain` is the same owner `paths.ts` reads its `PLAZA`
  // from — the park's middle is asked of the solver that placed it, never
  // re-derived here, and never approximated as the world origin.
  const fountain = PARK_LAYOUT.fountain;
  if (railSideOf(ENTRANCE_GATE_X, ENTRANCE_GATE_Z) === railSideOf(fountain.x, fountain.z)) {
    return;
  }
  const gateRailDistance = route.distanceNear(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
  const alongLoop = (a: number, b: number): number =>
    Math.abs(route.wrap(a - b + route.length / 2) - route.length / 2);
  if (bridges.some((site) => alongLoop(site.railDistance, gateRailDistance) < SITE_SPACING)) {
    return;
  }
  let best: Candidate | null = null;
  for (let d = -SITE_SPACING; d <= SITE_SPACING; d += MARCH_STEP) {
    const at = route.wrap(gateRailDistance + d);
    if (crossingSiteBanned(at)) continue;
    const candidate = bridgeCandidateAt(at, MIN_RAMP_RUN);
    if (!candidate) continue;
    if (
      best === null ||
      candidate.obliqueness < best.obliqueness ||
      (candidate.obliqueness === best.obliqueness &&
        Math.min(candidate.rampReachPos, candidate.rampReachNeg) >
          Math.min(best.rampReachPos, best.rampReachNeg))
    ) {
      best = candidate;
    }
  }
  if (!best) return;
  // A site that would sit on ground a kept bridge already fills is not a
  // second decision, it is the same one twice — the first tier's own rule.
  const chosen = best;
  if (bridges.some((other) => footprintsOverlap(chosen, other))) return;
  const { obliqueness: _obliqueness, ...site } = chosen;
  bridges.push(site);
  bridges.sort((a, b) => a.railDistance - b.railDistance);
}

/**
 * The feasibility march as a generator, one candidate rail distance per
 * `yield` — so the boot (`boot/parkGeneration.ts`) can spread the ~300 ms
 * solve across the cat-bus ride's frames exactly the way the train's own
 * loop search is spread, instead of blocking one frame on it
 * (`check:park-boot` measured the module-load lump at 323 ms). Yielding
 * between candidates cannot change the result: every candidate is a pure
 * function of its own rail distance and the already-solved layout.
 */
export function* crossingSitesSearch(): Generator<number, SolvedCrossingSites, void> {
  const route = TRAIN_PLAN.route;
  const bridgeCandidates: Candidate[] = [];
  for (let d = 0; d < route.length; d += MARCH_STEP) {
    yield d;
    // The warp vector may ban a site the paths could not use well; the
    // march then simply never sees a candidate there and `selectSpaced`
    // picks the next-best spacing. Unwarped, nothing is ever banned.
    if (crossingSiteBanned(d)) continue;
    const bridge = bridgeCandidateAt(d);
    if (bridge) bridgeCandidates.push(bridge);
  }
  const bridges = selectSpaced(bridgeCandidates);
  serveTheGateOnTheSecondTier(bridges);
  // Zero bridge sites is an invalid park, full stop — there is no level
  // tier to fall back to (Jim, 2 Sep 2026: a path crosses the railway on a
  // bridge or not at all), and every route the paths could take across the
  // rail would be an illegal crossing. Fail the build loudly here, where
  // the cause is, rather than letting paths.ts strand half the park:
  // the cure is a warp vector (parkWarp.ts), or the seed leaving the pool.
  if (bridges.length === 0) {
    throw new Error(
      'crossing plan: the solved railway loop proves NO bridge site anywhere. ' +
        'A park with no way over the railway is invalid; warp the seed (parkWarp.ts) ' +
        'or drop it from the pool. All sixteen pool seeds prove at least one site.',
    );
  }
  return { bridges };
}


/** The same search, driven straight through — Node, the harness and any
 * boot that did not pre-warm. */
export function solveCrossingSites(): SolvedCrossingSites {
  const search = crossingSitesSearch();
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}
