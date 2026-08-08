import { TAU } from '../../core/mathUtils';
import { PARK_BOUNDARY } from '../boundary';
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

/**
 * How far inside the park's edge a rider must be set down, in metres.
 *
 * A distance from the **edge**, which is the thing that actually matters — a
 * child stepping off wants ground under her and the boundary wall in front of
 * her, not behind. Two metres is what the old `GARDEN_PLAY_RADIUS - 2` clamp
 * meant back when subtracting from a radius was the same statement.
 *
 * **Exported so `check:rail-race` can verify the clamp against this number
 * rather than a second copy of it.** It was unexported, and the checker's
 * "mirror" had already drifted to a hand-typed `> 1` — so the check could pass
 * on a plan that broke the planner's own rule, which is the entire failure it
 * exists to catch. Same number declared twice is this week's most-repeated bug;
 * one owner, one import.
 */
export const EXIT_INSIDE_EDGE = 2;

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
      // Keep the dismount a clear stride inside the park's own edge. This was
      // `hypot(x, z) > GARDEN_PLAY_RADIUS - 2` — 56 m — which said the same
      // thing only while the edge was a circle 58 m out on every bearing. The
      // edge is a spline now, 59.7 m away at its pinch and 101.4 m at its
      // bulge, so 56 m was simultaneously too tight (it refused perfectly good
      // ground at the bulge) and, on a seed whose pinch came in further, would
      // have been too slack. Its value never changed; its meaning did. Ask the
      // edge instead.
      if (PARK_BOUNDARY.distanceToEdge(x, z) < EXIT_INSIDE_EDGE) continue;
      if (distanceToRailCorridor(x, z) < RAIL_CORRIDOR_CLEARANCE) continue;
      // 2.6, from 1.4 (issue #241): an exit inside a booth's INFLATED circle is
      // one `routeAround` cannot dodge on the way in — the spur leg then
      // grazes the booth's counter and the exit's waypoints strand behind it.
      // And off the railway with its fence, like every exit.
      if (clearOfPlots(x, z, 2.6) && distanceToRailCorridor(x, z) >= RAIL_CORRIDOR_CLEARANCE) {
        return { exitX: x, exitZ: z };
      }
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
