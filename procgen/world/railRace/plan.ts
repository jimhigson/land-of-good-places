/**
 * **The rail race's plan search** — where the ride's exit is, and where its
 * finish arch (the whole ride's datum) can stand clear of the doormat, the
 * plots, the exit and the Sky Cruiser. Moved verbatim from
 * `src/world/railRace/route.ts` and `plan.ts`, which build the rings the
 * park file names. Build-time only (`docs/design/PREBUILT-PARKS.md`).
 */
import { Vector3 } from 'three';
import { placedEntry, PARK_LAYOUT } from '../../../src/world/parkLayout';
import { TAU } from '../../../src/core/mathUtils';
import { EXIT_INSIDE_EDGE, PARK_BOUNDARY } from '../../../src/world/boundary';
import { RAIL_CORRIDOR_CLEARANCE, clearOfPlots, distanceToRailCorridor } from '../../../src/world/train/plan';
import { COASTER_PLANS } from '../../../src/world/coaster/plan';
import { RailRaceRoute } from '../../../src/world/railRace/route';
import { RIDE_SCALE } from '../../../src/world/railRace/dimensions';
import { RAIL_RACE_STATION_STALL_ID, type RailRaceDecisions } from '../../../src/world/railRace/plan';

/** Something the arch's feet must not come down on. */
export interface KeepOff {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}


/**
 * Slides the finish line along the ring until the arch's feet are off
 * everything a foot must not stand on.
 *
 * **The arch and the booth's doormat are placed by the same bearing, so on some
 * seeds they are placed on top of each other.** The arch is centred on the ring
 * at the boarding booth's bearing (just above), and its feet march inward along
 * that same radial — which is exactly where the doormat sits and where the spur
 * that serves it has to arrive. Measured on seed 11: six inner feet from
 * (67.4, -21.4) to (65.1, -19.9), straddling a doormat at (65.9, -20.7), with
 * the paving 1.14 m *inside* a leg. `paths.ts` routes around published
 * obstacles but cannot route around that one — a spur has to reach the door it
 * serves — so the arch is what gives.
 *
 * Moving `startDistance` moves the finish line **and everything measured from
 * it together**: the duck bars, the spark zones, `RACE_DISTANCE`, the cart
 * placement and the invariants that check them all read `startDistance`, so
 * this is the one lever that cannot desynchronise them. Nudging `buildArch`'s
 * own local copy instead would decouple the drawn finish from the scored one.
 *
 * ### Why it must clear more than the doormat
 *
 * A first cut checked the doormat and the plots only. It turned seed 11 green
 * and **turned seed 5 red on two tests** — because `startDistance` is the whole
 * ride's datum, so moving the arch moved the ride, onto the Sky Cruiser's loop.
 * One failure traded for two. Everything the datum can collide with has to be
 * in the list or this is a game of whack-a-mole: the doormat and the plots
 * here, and the ride's own exit and the cruiser's loop passed in as
 * {@link KeepOff} by `plan.ts`, which is the module that can see them.
 *
 * Everything asked about is **plan-time** data — no path exists yet when a
 * route is constructed. The doormat and the exit are what the paving is
 * obliged to reach, so keeping clear of them keeps clear of their spurs by
 * construction.
 *
 * Offsets are tried smallest first, alternating sides, so a park with no
 * conflict keeps its finish line exactly where the booth's bearing put it.
 */
function slideArchClear(
  route: RailRaceRoute,
  atBooth: number,
  stall: { readonly entranceX: number; readonly entranceZ: number },
  keepOff: readonly KeepOff[],
): number {
  const probe = new Vector3();
  const outward = new Vector3();
  const clears = (at: number): boolean => {
    const sample = route.path.sampleAt(at);
    route.outwardAt(at, outward);
    // The whole span the feet occupy, inner and outer, sampled every half
    // metre: the feet are two lines of six, not a point, and it is the lines
    // that have to miss.
    for (let radius = -ARCH_FOOT_REACH; radius <= ARCH_FOOT_REACH; radius += 0.5) {
      probe.set(sample.x + outward.x * radius, 0, sample.z + outward.z * radius);
      const toDoor = Math.hypot(probe.x - stall.entranceX, probe.z - stall.entranceZ);
      if (toDoor < ARCH_DOORMAT_CLEARANCE) return false;
      for (const plot of PARK_LAYOUT.entries.values()) {
        if (Math.hypot(probe.x - plot.x, probe.z - plot.z) < plot.boundingRadius + 1) return false;
      }
      for (const item of keepOff) {
        if (Math.hypot(probe.x - item.x, probe.z - item.z) < item.radius) return false;
      }
    }
    return true;
  };
  if (clears(atBooth)) return atBooth;
  for (let step = 1; step <= 60; step += 1) {
    for (const side of [1, -1] as const) {
      const at = route.wrap(atBooth + side * step * 0.75);
      if (clears(at)) return at;
    }
  }
  // Nothing on the whole ring works — keep the booth's own bearing and let the
  // procgen invariant say so out loud rather than putting the finish line
  // somewhere arbitrary.
  return atBooth;
}


/**
 * How far the arch's feet reach from the ring's centre line.
 *
 * `archFeet` owns the exact radii; this is the generous bound the search needs,
 * kept here because importing `arch.ts` would close a cycle (it needs
 * `RailRaceRoute`). Over-stating the reach only makes the search more cautious.
 */
const ARCH_FOOT_REACH = 22;


/**
 * How much room the arch's feet keep from the booth's doormat.
 *
 * 6 m, measured rather than chosen: a spur is ~2.4 m of paving, a leg needs
 * `WALKABLE_GAP`'s 1.24 m beside it, and the doormat has its own approach to
 * stand in. On seed 11 this leaves the nearest inner foot 4.2 m from the
 * nearest path where it used to be 1.14 m *inside* it; at 3.2 m it was still
 * 0.46 m inside, because the strip inward of the booth carries the exit's spur
 * as well as the booth's own.
 */
const ARCH_DOORMAT_CLEARANCE = 6;

/**
 * The Rail Race as *data*, solved at module load from the park layout alone —
 * the same inversion `train/plan.ts` and `coaster/plan.ts` make, and for the
 * same reason: `paths.ts` has to give this ride's exit a node in the walk
 * network before any scene object exists, so "where does the Rail Race let you
 * off" can never be a coordinate known only to the ride itself.
 */

const STATION_STALL_ID = RAIL_RACE_STATION_STALL_ID;


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

/**
 * The rail race's plan, searched: the exit, then each ring's arch slid clear.
 * Returns only what the search decided — the game builds the rings from it
 * (`src/world/railRace/plan.ts`).
 */
export function searchRailRacePlan(): RailRaceDecisions {
  // **The exit is solved BEFORE the rings, and that ordering is load-bearing.**
  // `slideArchClear` slides the finish arch off anything its feet must not come
  // down on, and the ride's own exit is one of those things — the paving is
  // obliged to reach it, so a foot on the exit is a foot on the exit's spur.
  // `planExit` never needed a ring: it asks the booth, the boundary and the
  // railway corridor, all of which exist already. It simply used to run second.
  const { exitX, exitZ } = planExit();

  // Everything the arch's feet must miss that only this module can see. The
  // doormat and the plots are checked inside the route (it has them); these two
  // are not, and leaving the cruiser out of the list is what turned seed 11
  // green and seed 5 red on the first attempt — `startDistance` is the whole
  // ride's datum, so moving the arch moves the ride.
  const keepArchOff: KeepOff[] = [
    // The exit, plus the room a dismounting child needs around it.
    { x: exitX, z: exitZ, radius: 4 },
  ];
  // The Sky Cruiser's loop, sampled. Its own low run is what the arch collided
  // with on seed 5; `RAIL_OVER_RAIL`-style air does not help here because an
  // arch foot is on the ground, so this is a plan-view keep-off like any other.
  const cruiser = COASTER_PLANS.cruiser.route;
  const cruiserStep = 2;
  for (let d = 0; d < cruiser.length; d += cruiserStep) {
    const point = cruiser.pointAt(d, new Vector3());
    keepArchOff.push({ x: point.x, z: point.z, radius: 5 });
  }

  const slide = (route: RailRaceRoute, atBooth: number, stall: { entranceX: number; entranceZ: number }): number =>
    slideArchClear(route, atBooth, stall, keepArchOff);
  const walkPastRing = new RailRaceRoute(STATION_STALL_ID, 1, slide);
  const raceRing = new RailRaceRoute(STATION_STALL_ID, RIDE_SCALE, slide);
  return { exitX, exitZ, walkPastStart: walkPastRing.startDistance, raceStart: raceRing.startDistance };
}
