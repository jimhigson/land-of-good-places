import { Vector3 } from 'three';
import { TRAIN_PLAN } from './plan';
import { BRIDGE_RISE, FENCE_OFFSET } from './clearance';
import {
  BRIDGE_RAMP_GRADIENT,
  DECK_HALF_LENGTH,
  MAX_RAMP_GRADIENT,
} from './bridgeFootprint';
import { STATION_GAP } from './fence';
import { GARDEN_PLAY_BOUNDARY } from '../boundary';
import { clearOfPlots } from '../parkLayout';

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
}

/**
 * Same walkable floor the real bridge search accepts at
 * (`bridgeFootprint.ts`'s `WALKABLE_FLOOR + WALKABLE_MARGIN`), plus one
 * extra stride of planning slack — a site that only *just* clears the
 * acceptance bar leaves the late, real pass nothing to spend on the small
 * obstacles (a lamp base, a bush trunk) that legitimately arrive later.
 */
export const SITE_RAMP_FLOOR = BRIDGE_RISE / MAX_RAMP_GRADIENT + 0.5 + 1.0;

/** The most ramp a site ever needs credit for — the shallow, ideal grade,
 * the same run the real pass starts from. */
export const SITE_RAMP_IDEAL = BRIDGE_RISE / BRIDGE_RAMP_GRADIENT;

/**
 * Half-width of the corridor a bridge site's deck and ramps are probed at.
 * The real pass starts its width search at the crossing's own `halfGap`
 * (floored at 4.5 in `crossings.ts`, and a square planned crossing measures
 * at that floor), so this is the corridor the first — preferred — real
 * candidate will actually occupy, plus half a stride of slack.
 */
export const SITE_HALF_WIDTH = 4.5 + 0.5;

/** Boundary / plot margins for a ramp — the early reservation pass's own
 * figures (`bridgeFootprint.ts`'s `RAMP_BOUNDARY_MARGIN` / `RAMP_PLOT_MARGIN`
 * are module-private; same numbers, same job, and drift here only ever makes
 * this planner *stricter* than the reservation, the safe direction). */
const SITE_BOUNDARY_MARGIN = 1.5;
const SITE_PLOT_MARGIN = 2.0;

/** Clearance a ground-level ramp tread keeps from the rail centre line —
 * `bridgeFootprint.ts`'s own `FENCE_OFFSET + RAMP_RAIL_MARGIN`, restated
 * from the same parts because that sum is module-private too. Matters on
 * the oblique candidates, whose ramps skirt the fence at an angle. */
const SITE_RAIL_MARGIN = FENCE_OFFSET + 0.5;

/**
 * A crossing may not land where `fence.ts`'s `stationRun` seals the far
 * side of a platform: the station's own window (`STATION_GAP` either way)
 * plus the half-gap a planned crossing's fence opening needs, plus a post's
 * worth of daylight so gap and window never merge into one another.
 */
const STATION_CLEARANCE = STATION_GAP + SITE_HALF_WIDTH + 2.0;

/** Candidate crossing angles, radians off square, in preference order —
 * square first (the network is predominantly grid-aligned and a crossing
 * reads best square to the track; Decision 6 keeps diagonals a genuine
 * minority), modest obliques after, for stretches where the ground past the
 * rail is too shallow for a straight ramp but has room along its length. */
const ANGLE_OFFSETS: readonly number[] = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 4, -Math.PI / 4];

/** Metres between candidate points marched along the loop. */
const MARCH_STEP = 2.0;

/** Minimum spacing kept between two selected sites of the same tier, along
 * the loop — two bridges closer than this fight over the same ground
 * (`bridgeFootprint.ts`'s `RAMP_CLEARANCE` capping) and read as clutter. */
const SITE_SPACING = 24;

/** Ground corridor a level-crossing site keeps clear past the fence gap on
 * each side — room for the path to arrive square and walk on, nothing
 * more. Short on purpose: this tier exists precisely where long clear runs
 * do not. */
const LEVEL_REACH = 6;

/** Corridor half-width probed for a level-crossing site — the path ribbon
 * plus a walker, not a bridge deck. */
const LEVEL_HALF_WIDTH = 2.6;

const scratch = new Vector3();
const sideTangent = new Vector3();

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
const STATION_STRUCTURE_CLEARANCE = 8;

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
  const route = TRAIN_PLAN.route;
  const acrossX = -dirZ;
  const acrossZ = dirX;
  const clearAt = (along: number, sign: 1 | -1): boolean => {
    for (const t of [-1, -0.5, 0, 0.5, 1]) {
      const x = point.x + dirX * along * sign + acrossX * halfWidth * t;
      const z = point.z + dirZ * along * sign + acrossZ * halfWidth * t;
      if (GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z) < boundaryMargin) return false;
      if (!clearOfPlots(x, z, plotMargin)) return false;
      if (nearStationStructure(x, z)) return false;
      if (along > DECK_HALF_LENGTH) {
        // Past the deck the ramp is ordinary near-ground paving — it may
        // not run inside the rail's own corridor (obliques skirt it).
        const rd = route.distanceNear(x, z);
        const rp = route.pointAt(rd, scratch);
        if (Math.hypot(x - rp.x, z - rp.z) < SITE_RAIL_MARGIN) return false;
      }
    }
    return true;
  };
  const deckClear = clearAt(0, 1) && clearAt(DECK_HALF_LENGTH, 1) && clearAt(DECK_HALF_LENGTH, -1);
  if (!deckClear) return { pos: 0, neg: 0, deckClear };
  const reach = (sign: 1 | -1): number => {
    let run = 0;
    const steps = Math.ceil(maxReach / 0.5);
    for (let i = 1; i <= steps; i += 1) {
      const along = DECK_HALF_LENGTH + (i / steps) * maxReach;
      if (!clearAt(along, sign)) break;
      run = along - DECK_HALF_LENGTH;
    }
    return run;
  };
  return { pos: reach(1), neg: reach(-1), deckClear };
}

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

  for (const offset of ANGLE_OFFSETS) {
    const cos = Math.cos(offset);
    const sin = Math.sin(offset);
    const dirX = perpX * cos + perpZ * sin;
    const dirZ = -perpX * sin + perpZ * cos;
    const { pos, neg, deckClear } = probeReach(
      point,
      dirX,
      dirZ,
      SITE_HALF_WIDTH,
      SITE_RAMP_IDEAL,
      SITE_BOUNDARY_MARGIN,
      SITE_PLOT_MARGIN,
    );
    if (!deckClear || pos < SITE_RAMP_FLOOR || neg < SITE_RAMP_FLOOR) continue;
    return {
      railDistance,
      x: point.x,
      z: point.z,
      dirX,
      dirZ,
      rampReachPos: pos,
      rampReachNeg: neg,
      bridge: true,
      obliqueness: Math.abs(offset),
    };
  }
  return null;
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
    SITE_BOUNDARY_MARGIN,
    1.0,
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
    obliqueness: 0,
  };
}

function selectSpaced(candidates: readonly Candidate[]): CrossingSite[] {
  const route = TRAIN_PLAN.route;
  const scored = [...candidates].sort(
    (a, b) =>
      a.obliqueness - b.obliqueness ||
      Math.min(b.rampReachPos, b.rampReachNeg) - Math.min(a.rampReachPos, a.rampReachNeg),
  );
  const kept: Candidate[] = [];
  for (const candidate of scored) {
    const tooClose = kept.some(
      (other) =>
        Math.abs(
          route.wrap(candidate.railDistance - other.railDistance + route.length / 2) -
            route.length / 2,
        ) < SITE_SPACING,
    );
    if (!tooClose) kept.push(candidate);
  }
  kept.sort((a, b) => a.railDistance - b.railDistance);
  return kept.map(({ obliqueness: _obliqueness, ...site }) => site);
}

function solveSites(): {
  bridges: readonly CrossingSite[];
  levels: readonly CrossingSite[];
} {
  const route = TRAIN_PLAN.route;
  const bridgeCandidates: Candidate[] = [];
  const levelCandidates: Candidate[] = [];
  for (let d = 0; d < route.length; d += MARCH_STEP) {
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
  const levels = selectSpaced(levelCandidates).filter(
    (level) =>
      !bridges.some(
        (bridge) =>
          Math.abs(
            route.wrap(level.railDistance - bridge.railDistance + route.length / 2) -
              route.length / 2,
          ) < SITE_SPACING,
      ),
  );
  return { bridges, levels };
}

const SOLVED = solveSites();

/**
 * Every point on the loop where a bridge provably fits — the places
 * `paths.ts` prefers for any leg that must cross the railway. Solved once,
 * at module load, from the same fixed inputs the rail and plot solvers used.
 */
export const CROSSING_SITES: readonly CrossingSite[] = SOLVED.bridges;

/**
 * Deliberate, station-clear, square level-crossing sites — Decision 8's
 * rare fallback, offered only where {@link CROSSING_SITES} leaves a whole
 * stretch of the loop unbridgeable. `paths.ts` charges
 * {@link LEVEL_CROSSING_PENALTY} extra metres for picking one, so a bridge
 * always wins when one is anywhere reasonable.
 */
export const LEVEL_CROSSING_SITES: readonly CrossingSite[] = SOLVED.levels;

/**
 * Extra path-metres a level-crossing site costs in `paths.ts`'s site
 * selection — the price of contradicting Decision 8's preference. Sized so
 * a bridge within roughly this much extra walking always wins, and only a
 * genuinely stranded region (nothing bridgeable anywhere near) falls back.
 */
export const LEVEL_CROSSING_PENALTY = 45;

/**
 * Which side of the railway a point stands on, in `crossings.ts`'s own
 * sign convention (+1 along `(tangent.z, -tangent.x)` from the nearest rail
 * point). Well-defined for any point meaningfully off the centre line; the
 * loop is simple (never self-crossing), so the sign is stable park-wide.
 */
export function railSideOf(x: number, z: number): 1 | -1 {
  const route = TRAIN_PLAN.route;
  const d = route.distanceNear(x, z);
  const p = route.pointAt(d, scratch);
  const t = route.tangentAt(d, sideTangent);
  return Math.sign(t.z * (x - p.x) - t.x * (z - p.z)) >= 0 ? 1 : -1;
}
