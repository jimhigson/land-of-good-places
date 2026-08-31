import { Vector3 } from 'three';
import { TRAIN_PLAN } from './plan';
import {
  CROSSING_STATION_CLEARANCE,
  CROSSING_STATION_STRUCTURE_CLEARANCE,
} from './clearance';
import { MIN_BRIDGE_HALF_LENGTH } from './bridgeFootprint';
import { STATION_GAP } from './fence';
import { ENTRANCE_GATE_X, ENTRANCE_GATE_Z } from '../entrance/layout';
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
 * Where the loop genuinely cannot take a bridge anywhere useful — on the
 * canonical seed the north-east strip between rail and boundary is too
 * shallow for any ramp — {@link LEVEL_CROSSING_SITES} offers deliberate,
 * station-clear, perpendicular *level* crossings as the last resort
 * Decision 8 allows, and `paths.ts` charges a heavy cost for choosing one
 * so a bridge always wins when one is in reach.
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
  /** True when a real bridge provably fits here; false for a deliberate
   * level crossing (the rare fallback). */
  readonly bridge: boolean;
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

/** Ground corridor a level-crossing site keeps clear past the fence gap on
 * each side — room for the path to arrive square and walk on, nothing
 * more. Short on purpose: this tier exists precisely where long clear runs
 * do not, and it must stay permissive enough to exist wherever a district
 * genuinely needs a crossing — a level crossing is barely more than a
 * fence gap, and the pre-plan park opened one wherever a path crossed with
 * no feasibility test at all. Making this tier too choosy stranded seed
 * 2's whole east district (8 waypoints, 1 unreachable attraction) the
 * moment its only bridge site was correctly ruled out. */
const LEVEL_REACH = 4;

/** Corridor half-width probed for a level-crossing site — the path ribbon
 * plus a walker, not a bridge deck. */
const LEVEL_HALF_WIDTH = 2.0;

const scratch = new Vector3();

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
 * The two tests that need a *solved* route — which is exactly what this caller
 * has and the pose generator does not. Named rather than inline because
 * {@link bridgeCandidateAt} hands it to `bridgeFit.ts`'s shared width/angle
 * search as well as using it through {@link probeReach}.
 */
const corridorBlocked = railCorridorBlocked(railDistanceAt);
const plannerBlocked = (x: number, z: number, along: number): boolean =>
  nearStationStructure(x, z) || corridorBlocked(x, z, along);

/** The `side = +1` direction at `railDistance` — `crossings.ts`'s own sign
 * convention (`side = sign(tangent.z * dx - tangent.x * dz)`). */
function sidePlusDirection(tangent: Vector3): readonly [number, number] {
  return [tangent.z, -tangent.x];
}

function bridgeCandidateAt(railDistance: number): Candidate | null {
  if (stationBlocked(railDistance)) return null;
  const route = TRAIN_PLAN.route;
  const point = new Vector3();
  const tangent = new Vector3();
  route.pointAt(railDistance, point);
  route.tangentAt(railDistance, tangent);
  const [perpX, perpZ] = sidePlusDirection(tangent);

  const fit = fitBridgeAcross(point.x, point.z, perpX, perpZ, plannerBlocked);
  if (!fit) return null;
  return {
    railDistance,
    x: point.x,
    z: point.z,
    dirX: fit.dirX,
    dirZ: fit.dirZ,
    rampReachPos: fit.rampReachPos,
    rampReachNeg: fit.rampReachNeg,
    bridge: true,
    halfWidth: fit.halfWidth,
    obliqueness: Math.abs(fit.angleOffset) + (fit.halfWidth < SITE_HALF_WIDTH ? 0.01 : 0),
  };
}

function levelCandidateAt(railDistance: number): Candidate | null {
  if (stationBlocked(railDistance)) return null;
  const route = TRAIN_PLAN.route;
  const point = new Vector3();
  const tangent = new Vector3();
  route.pointAt(railDistance, point);
  route.tangentAt(railDistance, tangent);
  const [dirX, dirZ] = sidePlusDirection(tangent);
  const { pos, neg, deckClear } = probeReach(
    point,
    dirX,
    dirZ,
    LEVEL_HALF_WIDTH,
    LEVEL_REACH,
    1.0,
    0.5,
  );
  if (!deckClear || pos < LEVEL_REACH - 0.5 || neg < LEVEL_REACH - 0.5) return null;
  return {
    railDistance,
    x: point.x,
    z: point.z,
    dirX,
    dirZ,
    rampReachPos: pos,
    rampReachNeg: neg,
    bridge: false,
    halfWidth: LEVEL_HALF_WIDTH,
    obliqueness: 0,
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
function footprintsOverlap(a: Candidate, b: Candidate): boolean {
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
    const extent = (c: Candidate): number =>
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
    // Bridge sites only: two level crossings are paint on the ground and may
    // sit as close as the loop rule allows.
    const collides =
      candidate.bridge && kept.some((other) => other.bridge && footprintsOverlap(candidate, other));
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
        `site: kept ${k.bridge ? 'BRIDGE' : 'level '} railD=${k.railDistance.toFixed(1)} at (${k.x.toFixed(2)}, ${k.z.toFixed(2)}) dir=(${k.dirX.toFixed(2)}, ${k.dirZ.toFixed(2)}) halfW=${k.halfWidth.toFixed(2)}\n`,
      );
    }
  }
  kept.sort((a, b) => a.railDistance - b.railDistance);
  return kept.map(({ obliqueness: _obliqueness, ...site }) => site);
}


/** **Why did the planner refuse a bridge here?** — diagnostic only (#414/#427).
 * Reports, per width and angle, which gate closed, through the same probe the
 * real decision uses. */
/**
 * **Why is there no LEVEL site here?** — the same instrument as
 * {@link explainBridgeRefusal}, for the tier below it, and asked of the real
 * {@link levelCandidateAt} rather than a second model of it. Node-only
 * diagnostics; nothing in the game calls it.
 *
 * Written after a re-implementation of this tier's own tests reported ground
 * near seed 18's entrance arch as clean when the planner refuses it. A second
 * description of "does a crossing fit" is the defect this whole area keeps
 * producing, so the question is now asked of the one that decides.
 */
export function explainLevelRefusal(railDistance: number): string {
  const where = (): string => {
    const point = new Vector3();
    TRAIN_PLAN.route.pointAt(railDistance, point);
    return `railD=${railDistance.toFixed(1)} at (${point.x.toFixed(1)}, ${point.z.toFixed(1)})`;
  };
  if (stationBlocked(railDistance)) return `${where()}: inside a station's window`;
  const candidate = levelCandidateAt(railDistance);
  if (candidate) {
    return (
      `${where()}: LEVEL CANDIDATE, reach ${candidate.rampReachPos.toFixed(1)}/` +
      `${candidate.rampReachNeg.toFixed(1)} vs floor ${(LEVEL_REACH - 0.5).toFixed(1)}`
    );
  }
  const route = TRAIN_PLAN.route;
  const point = new Vector3();
  const tangent = new Vector3();
  route.pointAt(railDistance, point);
  route.tangentAt(railDistance, tangent);
  const [dirX, dirZ] = sidePlusDirection(tangent);
  const { pos, neg, deckClear } = probeReach(point, dirX, dirZ, LEVEL_HALF_WIDTH, LEVEL_REACH, 1.0, 0.5);
  return (
    `${where()}: refused -- ` +
    (!deckClear
      ? 'the crossing corridor itself is blocked'
      : `reach ${pos.toFixed(1)}/${neg.toFixed(1)} vs floor ${(LEVEL_REACH - 0.5).toFixed(1)} -- SHORT`)
  );
}

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
  readonly levels: readonly CrossingSite[];
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
  const levelCandidates: Candidate[] = [];
  for (let d = 0; d < route.length; d += MARCH_STEP) {
    yield d;
    const bridge = bridgeCandidateAt(d);
    if (bridge) {
      bridgeCandidates.push(bridge);
      continue;
    }
    const level = levelCandidateAt(d);
    if (level) levelCandidates.push(level);
  }
  const bridges = selectSpaced(bridgeCandidates);
  // A level crossing within a bridge site's own spacing is pure redundancy —
  // the bridge is right there and always preferred — so it never survives.
  const spacedLevels = selectSpaced(levelCandidates, true);
  if ((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.['LGP_DEBUG_BRIDGE']) {
    const w = (globalThis as unknown as { process: { stdout: { write: (s: string) => void } } }).process.stdout;
    w.write(`site: ${levelCandidates.length} level candidates -> ${spacedLevels.length} after same-tier spacing: ${spacedLevels.map((l) => l.railDistance.toFixed(0)).join(', ')}\n`);
  }
  // **And the same exception, one filter further on.** Clearing the same-tier
  // rule for the gate only revealed this one behind it: seed 18's railDistance
  // 306 survives the spacing above and is then struck here, because it sits
  // 16.2 m along the loop from the bridge site at railDistance 4.
  //
  // "The bridge is right there" is a claim about the ground, and this rule
  // measures the loop. Across the park that bridge is 21.9 m from the arch and
  // on the FAR SIDE of the very railway the walk is trying to cross, while the
  // level site is 7.9 m away on the near side. It is not redundant; it is the
  // only crossing the front door can reach.
  //
  // So a level site nearer the arch than the bridge that shadows it survives.
  // Measured in world metres, which is what a child walks. Every other level
  // site on this same seed, and on every other seed, is filtered exactly as
  // before.
  const nearerTheGate = (level: CrossingSite, bridge: CrossingSite): boolean =>
    Math.hypot(level.x - ENTRANCE_GATE_X, level.z - ENTRANCE_GATE_Z) <
    Math.hypot(bridge.x - ENTRANCE_GATE_X, bridge.z - ENTRANCE_GATE_Z);
  const levels = spacedLevels.filter(
    (level) =>
      !bridges.some(
        (bridge) =>
          Math.abs(
            route.wrap(level.railDistance - bridge.railDistance + route.length / 2) -
              route.length / 2,
          ) < SITE_SPACING && !nearerTheGate(level, bridge),
      ),
  );
  return { bridges, levels };
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
