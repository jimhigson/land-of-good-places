import { GARDEN_PLAY_RADIUS } from '../../core/constants';
import { TAU } from '../../core/mathUtils';
import { placedEntry } from '../parkLayout';
import { RAIL_CORRIDOR_CLEARANCE, clearOfPlots, distanceToRailCorridor } from '../train/plan';
import { RailRaceRoute, RIDE_SCALE } from './route';

/**
 * The Rail Race as *data*, solved at module load from the park layout alone —
 * the same inversion `train/plan.ts` and `coaster/plan.ts` make, and for the
 * same reason: `paths.ts` has to give this ride's exit a node in the walk
 * network before any scene object exists, so "where does the Rail Race let you
 * off" can never be a coordinate known only to the ride itself.
 */

/** The booth that boards the ride. The id is a save key; it does not move. */
const STATION_STALL_ID = 'stall.railRacer';

export interface PlannedRailRace {
  /** Matches `PlannedCoaster.name` — `paths.ts` names the exit node with it. */
  readonly name: string;
  /**
   * The ring the rival kids idle round all day, at park scale. Always built,
   * always visible, and the only one of the two that registers collision.
   */
  readonly walkPastRing: RailRaceRoute;
  /**
   * The ring a race is actually run on, at `RIDE_SCALE`. Built at load like
   * its sibling — never regenerated when a race starts, which would mean a
   * mesh rebuild and a collection pause in the middle of the game — and simply
   * shown or hidden.
   */
  readonly raceRing: RailRaceRoute;
  /**
   * The race ring, under the name every arc-length consumer already used.
   *
   * Both rings share `length`, `startDistance` and the whole undulation, so
   * anything asking the route a question about *distance* (`simulate.ts`'s
   * hazard schedule, `RACE_DISTANCE`, `stepRider`'s gradient) gets the same
   * answer from either and does not need to know there are two.
   */
  readonly route: RailRaceRoute;
  readonly stationStallId: string;
  /** Where a rider is put down afterwards (GAME_DESIGN.md's EXIT rule). */
  readonly exitX: number;
  readonly exitZ: number;
}

/**
 * Somewhere clear to stand, next to the booth.
 *
 * Unlike the coaster's, this exit cannot be "beside the station": the station is
 * 53 m out at the park's rim and 9 m in the air, and a rider set down there
 * would be standing on nothing. She boards by iris wipe and she comes back the
 * same way, so the exit is simply a clear patch of ground beside the booth she
 * walked up to — which is also the least surprising place for a six-year-old to
 * reappear.
 *
 * Searched outward from the park's centre first (the booth's front is the side
 * a child approaches from, and the ride should not spit her out into the
 * queue), then round the compass, then further out, taking the first spot clear
 * of every plot blocker and safely inside the soft park boundary.
 *
 * **And clear of the railway.** Plot blockers used to be the only obstacle this
 * search knew about, and that is enough only while the booth stands inland with
 * open lawn all round it — which is the only reason it has never misfired. The
 * search runs *outward from the park's centre first*, so the further out the
 * booth is, the more directly it aims at the train's 48–58 m band; and the train
 * corridor is not a plot, so `clearOfPlots` cannot see it. Move the booth
 * anywhere near the rim and the first "clear" patch it finds is a spot on the
 * track, which `check:park` then reports as an exit node nobody can walk to —
 * the railway's invisible walls cut it off from the park.
 *
 * Found while trying to move the booth out to the rails (1 August 2026); the
 * move itself did not land, but the latent hole in this search is real and cheap
 * to close, so it is closed. With the booth where it stands today the result is
 * unchanged to the metre — this only ever rejects a candidate that was already
 * on the railway. The clearance is the railway's own published figure rather
 * than a number picked to suit.
 */
function planExit(): { exitX: number; exitZ: number } {
  const stall = placedEntry(STATION_STALL_ID);
  const outward = Math.atan2(stall.z, stall.x);

  // Bearings tried in order: straight out from the centre, then alternating
  // either side of it, and only then back towards the middle of the park.
  const bearings: number[] = [0];
  for (let step = 1; step <= 6; step += 1) {
    bearings.push((step * TAU) / 12, (-step * TAU) / 12);
  }

  const start = stall.boundingRadius + 1.6;
  for (let distance = start; distance <= start + 14; distance += 0.5) {
    for (const offset of bearings) {
      const bearing = outward + offset;
      const x = stall.x + Math.cos(bearing) * distance;
      const z = stall.z + Math.sin(bearing) * distance;
      if (Math.hypot(x, z) > GARDEN_PLAY_RADIUS - 2) continue;
      if (distanceToRailCorridor(x, z) < RAIL_CORRIDOR_CLEARANCE) continue;
      if (clearOfPlots(x, z, 1.4)) return { exitX: x, exitZ: z };
    }
  }

  // Nothing clear anywhere around the booth. Hand back the nearest try rather
  // than nothing: `world/dismount.ts`'s runtime safety net is the last resort
  // for exactly this, and the procgen invariant is the loud way to hear about
  // it long before a child does.
  return {
    exitX: stall.x + Math.cos(outward) * start,
    exitZ: stall.z + Math.sin(outward) * start,
  };
}

/** The plan. Import this; never re-solve — the same rule as `TRAIN_PLAN`. */
export const RAIL_RACE_PLAN: PlannedRailRace = (() => {
  const walkPastRing = new RailRaceRoute(STATION_STALL_ID, 1);
  const raceRing = new RailRaceRoute(STATION_STALL_ID, RIDE_SCALE);
  const { exitX, exitZ } = planExit();
  return {
    name: 'railRace',
    walkPastRing,
    raceRing,
    route: raceRing,
    stationStallId: STATION_STALL_ID,
    exitX,
    exitZ,
  };
})();
