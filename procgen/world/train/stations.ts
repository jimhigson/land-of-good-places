import { type TrainRoute } from '../../../src/world/train/route';
import { type Vec2 } from '../../../src/world/rail/segments';
import { Vector3 } from 'three';
import { STATION_SEARCH_STEP, STATION_SEARCH_WINDOW, chosenCrossingCorridor, stationCrossingConflict } from '../../../src/world/train/crossingKeepOut';
import { clearOfPlots } from '../../../src/world/parkLayout';
import { COASTER_PLANS } from '../../../src/world/coaster/plan';
import { terrainHeight } from '../../../src/world/terrain';
import { PLATFORM_LENGTH, STATION_GAP } from '../../../src/world/train/clearance';
import { STATION_SEEDS, STATION_SEED_RADIUS } from '../../../src/world/train/stationSeeds';
import { stationStand, type PlannedStation } from '../../../src/world/train/plan';
import { registerPlanCache } from '../../../src/boot/planCaches';

// The cruiser's low run, sampled once per decided cruiser; forgotten with it.
let cruiserLowXs: Float64Array | null = null;
let cruiserLowZs: Float64Array | null = null;
registerPlanCache(() => {
  cruiserLowXs = null;
  cruiserLowZs = null;
});
/**
 * **Where the railway's stations stand** — each slid along the loop until its
 * platform is clear. Moved verbatim from `src/world/train/plan.ts`; the game
 * reads the stations from the park file. Build-time only.
 */

/**
 * Every admissible stand within `STATION_SEARCH_WINDOW` of `target`, best
 * first. A stand inside an already-placed station's fence window is not
 * admissible at all; everything else is scored (below) and ranked, so
 * {@link planStations} can take the best and backtrack to the next.
 */
function rankedStationDistances(
  route: TrainRoute,
  target: number,
  placed: readonly Vec2[],
): number[] {
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
  const ranked: { distance: number; score: number }[] = [];
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
    let approachBlocked = false;
    for (const reach of [4, 7]) {
      if (!clearOfPlots(standX + parkX * reach, standZ + parkZ * reach, 2)) {
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
    // **A hard refusal, not a price** (seed 428: Sunny Side and Bluebell Halt
    // 19.9 m apart against the 20.2 m two platforms need). Crowding used to be
    // a proportional penalty, `crowding * 3000`; 0.3 m short cost about 44,
    // less than a blocked approach (120) or the cruiser's low run (400), so a
    // crowded stand simply won. A stand inside another station's fence window
    // is not a worse station, it is half of one — so it is not a candidate,
    // and when a station has none left `planStations` backtracks.
    if (placed.some((other) => Math.hypot(standX - other.x, standZ - other.z) < STATION_SEPARATION)) {
      continue;
    }

    const score =
      (conflict.alongLoop ? 5000 : 0) +
      (conflict.inSpace ? 5000 : 0) +
      // Below the crossing terms, and deliberately: a park with no bridge is
      // invalid (Jim's ruling on #414) while two stations closer together than
      // we would like is merely bad. Above `blocked`, because a platform inside
      // another platform is worse than a platform near a booth.
      (blocked ? 1000 : 0) +
      (approachBlocked ? 120 : 0) +
      (cruiserLow ? 400 : 0) +
      radialDot * 30 +
      radius * 0.35 +
      Math.abs(offset) * 0.2;
    ranked.push({ distance, score });
  }
  // Stable, so equal scores keep window order — the first-minimum the old
  // single-best loop returned is exactly `ranked[0]`.
  ranked.sort((a, b) => a.score - b.score);
  return ranked.map((entry) => entry.distance);
}


/**
 * The Sky Cruiser's low-flying sample points, walked once and kept.
 *
 * {@link rankedStationDistances} asks {@link nearCruiserLowCorridor} for every
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


export function planStations(route: TrainRoute): readonly PlannedStation[] {
  // Sequential, not `map`: each station is scored against the stands already
  // chosen, which is what stops two of them landing in the same place. See the
  // hard refusal in `rankedStationDistances`.
  //
  // **Backtracking, CLAUDE.md's standing rule.** Each station takes its best
  // admissible stand; if a later station then has none (every stand in its
  // window is inside an earlier station's fence window), the earlier one moves
  // to its next-best stand and the later one is asked again. A park whose
  // stations fit first time is untouched — its choices are each `ranked[0]`.
  const targets = STATION_SEEDS.map((seed) =>
    route.distanceNear(seed.bearingX * STATION_SEED_RADIUS, seed.bearingZ * STATION_SEED_RADIUS),
  );
  const chosen: number[] = [];
  const place = (index: number, placed: readonly Vec2[]): boolean => {
    if (index === targets.length) return true;
    for (const distance of rankedStationDistances(route, targets[index] as number, placed)) {
      const { standX, standZ } = stationStand(route, distance);
      chosen[index] = distance;
      if (place(index + 1, [...placed, { x: standX, z: standZ }])) return true;
    }
    return false;
  };
  if (!place(0, [])) {
    // No arrangement in any station's window keeps them apart. Say so — the
    // invariant `stationsDoNotCrowdEachOther` will then fail the park — and
    // fall back to each station's own target rather than inventing a stand.
    // eslint-disable-next-line no-console
    console.warn('planStations: no arrangement keeps the stations a fence window apart');
    targets.forEach((target, index) => {
      chosen[index] = target;
    });
  }
  return STATION_SEEDS.map((seed, index) => {
    const distance = chosen[index] as number;
    const { standX, standZ } = stationStand(route, distance);
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
      leadX: standX + parkX * 6,
      leadZ: standZ + parkZ * 6,
    };
  });
}
