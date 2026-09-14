import { Vector3 } from 'three';
import { TrainRoute } from './route';
import { COASTER_PLANS } from '../coaster/plan';
import { terrainHeight } from '../terrain';
import { STATION_SEEDS, STATION_SEED_RADIUS } from './stationSeeds';
import { PLATFORM_LENGTH, STATION_GAP } from './clearance';

/**
 * The rail plan — the railway as *data*, solved at module load from the park
 * layout alone, before any scene object exists.
 *
 * This inverts the old order. The route used to be solved against the
 * finished collision world (so a tree bent the track), which meant nothing
 * upstream of the train could know where the railway was: paths could not
 * treat stations as destinations, and the path network had to be discovered
 * by the trains rather than planned with them. Now the plan is pure — layout
 * in, centre line and station positions out — and everything else reacts:
 * trees keep off the corridor (`Scenery`), the path graph gets a node per
 * station (`paths.ts`), and `ParkTrain` simply *builds* what was planned.
 */

export interface PlannedStation {
  readonly index: number;
  readonly name: string;
  readonly accent: number;
  /** Metres along the loop of the platform's centre. */
  readonly distance: number;
  /** Where a child waits: on the park side of the platform. */
  readonly standX: number;
  readonly standZ: number;
  /**
   * Where a path should arrive: a few metres along the platform on its
   * *empty* half. The canopy posts and the bench all stand at negative
   * platform-along by construction (`station.ts`), so a spur walking in at
   * positive along, then turning down the platform to the stand, never has
   * furniture across its line.
   */
  readonly approachX: number;
  readonly approachZ: number;
  /**
   * Where the spur should arrive from the park: past the platform's empty
   * end and stepped out into the park, so the incoming leg never cuts
   * diagonally across the canopy posts on the furnished half. Added when
   * issue #241 spread the plots: with stations landing on the loop's rim
   * bulges, `bestBranchPoint` can sit at almost any bearing from the
   * platform, and the straight leg it drew to the approach paved through the
   * posts and stranded Bluebell Halt's waypoints.
   */
  readonly leadX: number;
  readonly leadZ: number;
}

/** Clear of every plot's bounding circle by `radius` — the pure counterpart
 * of the old `collision.isClearCircle`. Trees no longer count: they are
 * seeded *after* this plan now, and keep off the railway rather than the
 * railway bending round them.
 *
 * Exported so any other pure plan solved at module load — `coaster/plan.ts`,
 * the ferris wheel's exit point — can ask the same question of the same
 * layout, rather than each re-deriving it. */
export { clearOfPlots } from '../parkLayout';
import { clearOfPlots } from '../parkLayout';
import {
  STATION_SEARCH_STEP,
  STATION_SEARCH_WINDOW,
  chosenCrossingCorridor,
  stationCrossingConflict,
} from './crossingKeepOut';
import type { Vec2 } from '../rail/segments';

/** The waiting spot beside the platform at `distance` — same side math the
 * station builder uses: the park side, 2.15 m off the centre line. */
export function stationStand(
  route: TrainRoute,
  distance: number,
): { standX: number; standZ: number } {
  const centre = route.pointAt(distance, new Vector3());
  const tangent = route.tangentAt(distance, new Vector3());
  const rightX = tangent.z;
  const rightZ = -tangent.x;
  const parkIsRight = rightX * -centre.x + rightZ * -centre.z >= 0;
  const side = parkIsRight ? 1 : -1;
  return {
    standX: centre.x + rightX * side * 2.15,
    standZ: centre.z + rightZ * side * 2.15,
  };
}

/**
 * Slides along the loop from `target` (0, +1, -1, +2 … metres) until the
 * platform area — three discs across its length — is clear of every plot.
 * Gives up at ±24 m and returns the target; the boot assert and check:park
 * then say so loudly rather than a child finding a platform inside a booth.
 */
/**
 * Distance from a point to the **nearest part of the whole loop**, not to the
 * rail point some caller already had in hand.
 *
 * Written once here because two callers need exactly this and the difference
 * between it and "distance to my own rail point" is what made seed 451
 * unbuildable — see {@link stationLead} and the park-side test in
 * {@link clearStationDistance}. `distanceToRailCorridor` below answers the same
 * question for the *built* corridor and is not usable during planning, because
 * it is what the plan is producing.
 */
function nearestRailDistance(route: TrainRoute, x: number, z: number): number {
  const at = route.pointAt(route.distanceNear(x, z), new Vector3());
  return Math.hypot(at.x - x, at.z - z);
}

function clearStationDistance(
  route: TrainRoute,
  target: number,
  placed: readonly Vec2[],
): number {
  const tangent = new Vector3();
  const centre = new Vector3();

  // **The loop's own chosen crossing** (issue #427) — the ground a station may
  // not stand on, in either of the two senses `crossingKeepOut.ts` owns. Built
  // once here and asked per candidate below; the module's header says why the
  // rule lives there rather than being written out at each of its two callers.
  const crossingWindow: Vec2 = { x: 0, z: 0 };
  const corridor = chosenCrossingCorridor(
    route.flatPointAt(0, { x: 0, z: 0 }),
    route.tangentAt(0, new Vector3()),
  );
  const crossingConflictAt = (distance: number) =>
    stationCrossingConflict(distance, route.length, corridor, (d) =>
      route.flatPointAt(d, crossingWindow),
    );

  // Scored, not first-fit (issue #241). With the plots unpinned and the loop
  // hugging a spline rim, the stretch nearest a seed bearing can be one
  // where the track plunges RADIALLY between a dip and the rim — and a
  // platform parallel to a radial run walls off its own approach: the spur
  // has to run the fence line for its whole length, and Bluebell Halt's
  // waypoints stranded in the pocket that made. So every candidate along a
  // generous window is scored, and the score prefers exactly what Decision 4
  // asked of stations in the first place:
  //  - a TANGENTIAL stretch (platform across the park's view, approach open),
  //  - an inward dip rather than the far rim (short spur, near the paths),
  //  - open ground on the park side where the spur will actually arrive,
  //  - and, mildly, nearness to the seed's bearing.
  let best = target;
  let bestScore = Infinity;
  for (
    let offset = -STATION_SEARCH_WINDOW;
    offset <= STATION_SEARCH_WINDOW;
    offset += STATION_SEARCH_STEP
  ) {
    const distance = target + offset;
    const { standX, standZ } = stationStand(route, distance);
    route.tangentAt(distance, tangent);
    route.pointAt(distance, centre);

    let blocked = false;
    for (const along of [-2.6, 0, 2.6]) {
      if (!clearOfPlots(standX + tangent.x * along, standZ + tangent.z * along, 1.7)) {
        blocked = true;
        break;
      }
    }
    const radius = Math.hypot(centre.x, centre.z) || 1;
    const radialDot = Math.abs((tangent.x * centre.x + tangent.z * centre.z) / radius);
    const off = Math.hypot(standX - centre.x, standZ - centre.z) || 1;
    const parkX = (standX - centre.x) / off;
    const parkZ = (standZ - centre.z) / off;
    // **The park side has to be open, and "open" includes the railway itself.**
    //
    // This tested the plots and nothing else, which is the same blind spot
    // #472's own note warns about two comments down — backtrack against the
    // world as it stands, not against the two or three things this generator
    // knows by name. The railway is the one obstacle a station is guaranteed to
    // be next to, and the loop winds tightly enough to come back past its own
    // platforms.
    //
    // Measured on seed 451 at park scale 1, before this term existed: Sunny
    // Side was placed at railD 58.0 with **another limb of its own loop passing
    // 8 m away on its park side**, at railD 133.7 — 75.7 m away around the
    // circuit. Its lead landed 0.76 m from that limb and on the far side of it,
    // so the station's own spur had to cross the railway to reach its own
    // platform; `paths.ts` drew that leg, and the park failed to build at all
    // with *"the drawn paths cross the railway at railD 133.9, which snaps to no
    // proven bridge site"*. The error named a place 75 m and one module away
    // from the cause.
    //
    // `nearestRailDistance` asks the whole route, not this candidate's own rail
    // point — which is precisely the distinction that was missing.
    let approachBlocked = false;
    for (const reach of [4, 7]) {
      const px = standX + parkX * reach;
      const pz = standZ + parkZ * reach;
      if (!clearOfPlots(px, pz, 2)) {
        approachBlocked = true;
        break;
      }
      // Far enough from *any* limb of the loop that a spur can stand here.
      if (nearestRailDistance(route, px, pz) < RAIL_CORRIDOR_CLEARANCE) {
        approachBlocked = true;
        break;
      }
    }

    // Not under the Sky Cruiser's station flat or ramps either: the cruiser
    // solves before the train, its low corridor is real geometry, and a
    // platform under a 1-to-5 m coaster rail collides in plain sight
    // (seed 11 built exactly that before this term existed).
    const cruiserLow = nearCruiserLowCorridor(standX, standZ, 8);

    // **Never on the loop's own chosen crossing** (issue #427), in either
    // sense: not within `CROSSING_STATION_CLEARANCE` of it *along the loop*,
    // and not within `CROSSING_STATION_STRUCTURE_CLEARANCE` of the corridor its
    // deck and ramps occupy *in space*. The loop winds, so those are two rules
    // and not one seen twice — a station a hundred metres away around the
    // circuit can still stand a few metres from the crossing.
    //
    // The loop was grown from a pose where a bridge provably fits, and
    // `crossingPlanSolve.ts` refuses to plan a crossing near a station either
    // way, so a station placed here silently destroys the one thing the whole
    // loop was grown to guarantee. Measured before these terms existed, seed 2:
    // a station at d = -2.0 m, on the crossing, and a park with **no bridge at
    // all**. Weighted above every other term put together, because a park with
    // no bridge is invalid (Jim's ruling on #414) while a station a few metres
    // off its ideal spot is merely not ideal — and `crossingKeepOut.ts`'s
    // `crossingSurvivesStationAt` relies on that ordering holding.
    const conflict = crossingConflictAt(distance);

    // **Not on top of a station that is already there** (#472).
    //
    // Every station used to be planned in ignorance of the others — two
    // independent searches, each sliding up to `STATION_SEARCH_WINDOW` along
    // the loop from its own bearing. The two bearings are opposite, so that
    // looks safe and mostly is; on seeds 3 and 23 it was not. Both searches
    // converged on the same stretch and the park was built with **Sunny Side
    // and Bluebell Halt inside each other** — two platforms, two canopies and
    // two benches interpenetrating, 18 m² of deck and 9 m² of roof in one
    // plane. The coplanar sweep is what found it; a child would have seen a
    // single smeared station.
    //
    // CLAUDE.md's standing rule for every generator here: backtrack against
    // the world as it stands, not against the two or three things this
    // generator happens to know by name. So the stations are planned in turn
    // and each one is scored against the stands already chosen.
    //
    // Proportional rather than a step, so a loop that genuinely cannot spread
    // them still returns its least-bad answer instead of a coin toss between
    // two equally-forbidden candidates.
    let crowding = 0;
    for (const other of placed) {
      const gap = Math.hypot(standX - other.x, standZ - other.z);
      crowding = Math.max(crowding, Math.max(0, STATION_SEPARATION - gap) / STATION_SEPARATION);
    }

    const score =
      (conflict.alongLoop ? 5000 : 0) +
      (conflict.inSpace ? 5000 : 0) +
      // Below the crossing terms, and deliberately: a park with no bridge is
      // invalid (Jim's ruling on #414) while two stations closer together than
      // we would like is merely bad. Above `blocked`, because a platform inside
      // another platform is worse than a platform near a booth.
      crowding * 3000 +
      (blocked ? 1000 : 0) +
      (approachBlocked ? 120 : 0) +
      (cruiserLow ? 400 : 0) +
      radialDot * 30 +
      radius * 0.35 +
      Math.abs(offset) * 0.2;
    if (score < bestScore) {
      bestScore = score;
      best = distance;
    }
  }
  return best;
}

let cruiserLowXs: Float64Array | null = null;
let cruiserLowZs: Float64Array | null = null;

/**
 * The Sky Cruiser's low-flying sample points, walked once and kept.
 *
 * {@link clearStationDistance} asks {@link nearCruiserLowCorridor} for every
 * candidate offset of every station — 122 calls a solve — and each call used
 * to re-walk the whole cruiser curve through `pointAt` (an arc-length lookup
 * per sample). The walk depends only on the cruiser's solved route, so it is
 * the same walk every time: same `d` sequence, same height test, same points
 * in the same order. Caching it changes when the points are computed, never
 * which points come back — the queries below compare against an identical
 * list and so return identical booleans.
 */
function cruiserLowPoints(): { readonly xs: Float64Array; readonly zs: Float64Array } {
  if (!cruiserLowXs || !cruiserLowZs) {
    const cruiser = COASTER_PLANS.cruiser.route;
    const probe = new Vector3();
    const xs: number[] = [];
    const zs: number[] = [];
    for (let d = 0; d < cruiser.length; d += 3) {
      cruiser.pointAt(d, probe);
      if (probe.y - terrainHeight(probe.x, probe.z) >= 5.9) continue;
      xs.push(probe.x);
      zs.push(probe.z);
    }
    cruiserLowXs = Float64Array.from(xs);
    cruiserLowZs = Float64Array.from(zs);
  }
  return { xs: cruiserLowXs, zs: cruiserLowZs };
}

/** Is (x, z) within `reach` of anywhere the Sky Cruiser flies low? */
function nearCruiserLowCorridor(x: number, z: number, reach: number): boolean {
  const { xs, zs } = cruiserLowPoints();
  for (let i = 0; i < xs.length; i += 1) {
    if (Math.hypot((xs[i] ?? 0) - x, (zs[i] ?? 0) - z) < reach) return true;
  }
  return false;
}

/**
 * **How far apart two station stands must be before neither is crowding the
 * other**, in metres.
 *
 * Taken from the game rather than chosen: `fence.ts` opens the lineside fence
 * for `STATION_GAP` either side of a station, so two stations closer together
 * than two of those windows plus a platform's own length are sharing one
 * opening — which is the point past which they have stopped being two stations.
 */
const STATION_SEPARATION = PLATFORM_LENGTH + STATION_GAP * 2;

/**
 * **Where the spur arrives from the park — measured against the whole railway,
 * not against this station's own rail point.**
 *
 * The lead used to be one line: `stand + park * 6`, six metres straight out
 * from the platform along the outward normal at the station's own rail
 * distance. That is right whenever the nearest rail to the lead is the rail the
 * platform stands on, and it is **silently wrong the moment the loop doubles
 * back near the platform** — because "six metres into the park" is only into
 * the park with respect to the limb you measured from.
 *
 * Measured on seed 451, station Sunny Side at railD 58.0, at park scale 1: the
 * lead came out **8.15 m from its own rail point**, which is exactly what the
 * derivation intends and looks perfectly healthy — and **0.76 m from the
 * nearest rail, at railD 133.7, on the far side of it**. That limb is 75.7 m
 * away around the loop and passes within eight metres of the platform. So the
 * station's own spur had to cross the railway to reach its own platform,
 * `paths.ts` drew that leg, and `crossings.ts` threw: *"the drawn paths cross
 * the railway at railD 133.9 (37.9, -40.1), which snaps to no proven bridge
 * site"*. The park did not build at all, and the cause was 75 metres and one
 * module away from the error.
 *
 * Bluebell Halt on the same seed is the control that shows the old formula is
 * otherwise fine: its lead is 8.15 m from its own rail point **and** 8.15 m
 * from the nearest rail, 0.2 m along the loop — the same limb.
 *
 * This is CLAUDE.md's standing rule in its exact words: *"'backtrack' means
 * checking the real collision world as it stands at that moment, not just the
 * two or three obstacle classes a given generator happens to know about by
 * name."* The old lead knew about one rail point. This one asks the route.
 *
 * So: try the authored answer first, and only if it lands on the wrong side of
 * the railway or inside its corridor, make a different decision — pull the lead
 * in towards the platform, then step it along the platform's own
 * furniture-free `+tangent` half-plane, never into the negative-along half
 * where the canopy posts stand. The first candidate is the old formula exactly,
 * so every station that was already sound is unchanged to the millimetre.
 */
function stationLead(
  route: TrainRoute,
  standX: number,
  standZ: number,
  parkX: number,
  parkZ: number,
  tangentX: number,
  tangentZ: number,
): { leadX: number; leadZ: number } {
  const point = new Vector3();
  const tangent = new Vector3();
  /** Which side of the *whole* loop this point is on, and how far off it —
   * `crossings.ts`'s own sign convention, against the nearest rail anywhere. */
  const railAt = (x: number, z: number): { side: number; dist: number } => {
    const d = route.distanceNear(x, z);
    route.pointAt(d, point);
    route.tangentAt(d, tangent);
    return {
      side: Math.sign(tangent.z * (x - point.x) - tangent.x * (z - point.z)) || 1,
      dist: Math.hypot(point.x - x, point.z - z),
    };
  };

  // The stand is the authority on which side of the railway this station is:
  // a lead the spur can reach without crossing must be on that side.
  const wanted = railAt(standX, standZ).side;

  // The ladder. `out` is the authored 6 m first, then progressively shorter —
  // a doubling-back limb is passed by going *further* out, so coming in is what
  // recovers the side. `along` stays >= 0: the negative-along half is where the
  // canopy posts and the bench are.
  for (const along of [0, 2, 4, 6] as const) {
    for (const out of [6, 5, 4.5, 4, 3.5, 3] as const) {
      const x = standX + parkX * out + tangentX * along;
      const z = standZ + parkZ * out + tangentZ * along;
      const rail = railAt(x, z);
      if (rail.side === wanted && rail.dist >= RAIL_CORRIDOR_CLEARANCE) {
        return { leadX: x, leadZ: z };
      }
    }
  }

  // Nothing cleared. Keep the authored answer rather than inventing a worse
  // one, and say so loudly: a station whose spur cannot reach it without
  // crossing the railway is a real defect in the layout, and the park's own
  // crossing checks will fail on it. Silence here is how it went unnoticed
  // before.
  console.warn(
    `train plan: station stand (${standX.toFixed(1)}, ${standZ.toFixed(1)}) has no lead ` +
      `on its own side of the railway and clear of the corridor — tried 24 placements. ` +
      'Its spur will have to cross the rail to reach it.',
  );
  return { leadX: standX + parkX * 6, leadZ: standZ + parkZ * 6 };
}

function planStations(route: TrainRoute): readonly PlannedStation[] {
  // Sequential, not `map`: each station is scored against the stands already
  // chosen, which is what stops two of them landing in the same place. See the
  // `crowding` term in `clearStationDistance`.
  const placed: Vec2[] = [];
  return STATION_SEEDS.map((seed, index) => {
    const target = route.distanceNear(
      seed.bearingX * STATION_SEED_RADIUS,
      seed.bearingZ * STATION_SEED_RADIUS,
    );
    const distance = clearStationDistance(route, target, placed);
    const { standX, standZ } = stationStand(route, distance);
    placed.push({ x: standX, z: standZ });
    const tangent = route.tangentAt(distance, new Vector3());
    // Away from the track, through the stand — the platform's park side.
    const centre = route.pointAt(distance, new Vector3());
    const off = Math.hypot(standX - centre.x, standZ - centre.z) || 1;
    const parkX = (standX - centre.x) / off;
    const parkZ = (standZ - centre.z) / off;
    return {
      index,
      name: seed.name,
      accent: seed.accent,
      distance,
      standX,
      standZ,
      approachX: standX + tangent.x * 3.5,
      approachZ: standZ + tangent.z * 3.5,
      // Straight out into the park from the platform's centre. From here the
      // remaining legs run lead -> approach -> stand entirely in the
      // platform's furniture-free (+tangent) half-plane: in platform
      // coordinates the lead is (along 0, park 6) and the approach
      // (along 3.5, park 0), so the connecting segment never enters the
      // negative-along half where the canopy posts stand — measured 2.8 m
      // clear of the nearest post, against the graph's 0.7 m requirement. A
      // lead past the platform's far END was tried first and made things
      // worse: a spur arriving from anywhere in the park then had to sweep
      // the whole frontage to get there, 0.3 m from the posts.
      //
      // **Asked of the whole railway, not of this station's own rail point**
      // — see {@link stationLead}.
      ...stationLead(route, standX, standZ, parkX, parkZ, tangent.x, tangent.z),
    };
  });
}

/**
 * Distance from (x, z) to the solved rail centre line, by segment projection
 * over a fine sampling of the curve.
 *
 * This is what lets `Scenery` keep its garden walls off the tracks: walls are
 * scattered long before the train is *built*, but the route is *planned* at
 * module load, so the question has an exact answer by then. (An earlier
 * version approximated this with a separate "corridor pre-solve" because the
 * route used to bend around trees at build time; the pure plan made the
 * approximation — and its caveats — unnecessary.)
 */
export function distanceToRailCorridor(x: number, z: number): number {
  ensureCorridorSamples();
  let best = Infinity;
  const xs = corridorX as Float64Array;
  const zs = corridorZ as Float64Array;
  for (let i = 0; i < xs.length; i += 1) {
    const j = (i + 1) % xs.length;
    const ax = xs[i] ?? 0;
    const az = zs[i] ?? 0;
    const bx = xs[j] ?? 0;
    const bz = zs[j] ?? 0;
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSquared = dx * dx + dz * dz;
    const t =
      lengthSquared < 1e-12
        ? 0
        : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared));
    const gap = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (gap < best) best = gap;
  }
  return best;
}

/**
 * How far a scattered structure must keep off {@link distanceToRailCorridor}.
 *
 * Measured, not chosen: the fence stands 2 m off the rails (`train/fence.ts`)
 * and a station platform's canopy reaches 3.7 m from the centre line
 * (`train/station.ts`: `PLATFORM_OFFSET` 2.15 + half of `PLATFORM_WIDTH` 2.6,
 * + 0.25 of roof overhang). Anything at 4.2 m clears the widest of those with
 * room for its own thickness.
 */
export const RAIL_CORRIDOR_CLEARANCE = 4.2;

let corridorX: Float64Array | null = null;
let corridorZ: Float64Array | null = null;

function ensureCorridorSamples(): void {
  if (corridorX) return;
  const route = TRAIN_PLAN.route;
  const count = Math.max(64, Math.ceil(route.length / 2));
  corridorX = new Float64Array(count);
  corridorZ = new Float64Array(count);
  const point = new Vector3();
  for (let i = 0; i < count; i += 1) {
    route.pointAt((i / count) * route.length, point);
    corridorX[i] = point.x;
    corridorZ[i] = point.z;
  }
}

/** The one plan. Import this; never re-solve — same rule as `PARK_LAYOUT`. */
export const TRAIN_PLAN: {
  readonly route: TrainRoute;
  readonly stations: readonly PlannedStation[];
} = (() => {
  const route = new TrainRoute();
  return { route, stations: planStations(route) };
})();
