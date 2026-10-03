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
import { RING_PATH } from '../../../src/world/railRace/route';
import { RAIL_RACE_STATION_STALL_ID, railRacePlanFrom, type PlannedRailRace } from '../../../src/world/railRace/plan';

/** Something the arch's feet must not come down on. */
export interface KeepOff {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  /**
   * The plan decision that put this keep-off here (`cruiser`, `train`, …), so
   * a refusal of the arch can name it — see {@link RailRaceRoute.archDecidedBy}.
   * Omitted: the layout's.
   */
  readonly owner?: string;
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
  atBooth: number,
  stall: { readonly entranceX: number; readonly entranceZ: number },
  keepOff: readonly KeepOff[],
  /** Which clear station to take, nearest first — see {@link archStation}. */
  choice: number,
): { readonly at: number | null; readonly pushedBy: ReadonlySet<string> } {
  const probe = new Vector3();
  const outward = new Vector3();
  /** The owners of whatever refused a station tried before the one taken. */
  const pushedBy = new Set<string>();
  let clearSeen = 0;
  /** True for the `choice`-th clear station; every refusal on the way is recorded. */
  const clears = (at: number): boolean => {
    const refuser = refusedBy(at);
    if (refuser !== null) {
      pushedBy.add(refuser);
      return false;
    }
    clearSeen += 1;
    return clearSeen > choice;
  };
  /** Who refuses the arch at `at`, or null when its feet are clear. */
  const refusedBy = (at: number): string | null => {
    const sample = RING_PATH.sampleAt(at);
    outward.set(sample.normalX, 0, sample.normalZ);
    // The whole span the feet occupy, inner and outer, sampled every half
    // metre: the feet are two lines of six, not a point, and it is the lines
    // that have to miss.
    for (let radius = -ARCH_FOOT_REACH; radius <= ARCH_FOOT_REACH; radius += 0.5) {
      probe.set(sample.x + outward.x * radius, 0, sample.z + outward.z * radius);
      const toDoor = Math.hypot(probe.x - stall.entranceX, probe.z - stall.entranceZ);
      if (toDoor < ARCH_DOORMAT_CLEARANCE) return 'layout';
      for (const plot of PARK_LAYOUT.entries.values()) {
        if (Math.hypot(probe.x - plot.x, probe.z - plot.z) < plot.boundingRadius + 1) return 'layout';
      }
      for (const item of keepOff) {
        if (Math.hypot(probe.x - item.x, probe.z - item.z) < item.radius) return item.owner ?? 'layout';
      }
    }
    return null;
  };
  if (clears(atBooth)) return { at: atBooth, pushedBy };
  for (let step = 1; step <= ARCH_SLIDE_STEPS; step += 1) {
    for (const side of [1, -1] as const) {
      const at = wrapRing(atBooth + side * step * ARCH_SLIDE_STEP);
      if (clears(at)) return { at, pushedBy };
    }
  }
  // Fewer clear stations than `choice + 1` — for the first choice, nothing on
  // the whole ring works. This used to keep the booth's own bearing anyway, an
  // arch standing on something its feet must not, and leave a procgen
  // invariant to say so after the whole park was built. No station is an
  // answer the plan can act on: `parkPlan.ts`'s `railRaceBars` refuses, naming
  // everything that refused a station here.
  return { at: null, pushedBy };
}

/** The arch slides in steps this long... */
const ARCH_SLIDE_STEP = 0.75;
/** ...this many either side of the booth's bearing. */
const ARCH_SLIDE_STEPS = 60;
/** How many stations the arch can be offered: the booth's bearing and every step either side. */
export const ARCH_STATIONS = 1 + 2 * ARCH_SLIDE_STEPS;

/**
 * **Where the start/finish arch may stand: the `choice`-th clear station.**
 *
 * The arch goes at the bearing of the booth that boards the ride, so the rails
 * a child can see from the queue are the rails she is about to start on. She
 * is carried out to them by the iris wipe, exactly as the other rides carry her
 * to a station she is not standing on. Then {@link slideArchClear} slides it
 * off anything its feet must not come down on; choice 0 is that, the arch as it
 * always stood. **Choice `n` is the next clear station after choice `n - 1`**,
 * in the same order (smallest slide first, alternating sides) — the decision a
 * refusal of the arch's datum re-chooses (`planSolver.ts`'s `railRaceBars`: a
 * datum that leaves the duck bars nowhere to stand). `at` is null when there
 * are fewer clear stations than that.
 *
 * Pure in the ring path, so both rings share one answer: their arc length,
 * startDistance and undulation are the same by construction.
 */
export function archStation(
  stationStallId: string,
  keepArchOff: readonly KeepOff[],
  choice: number,
): { readonly at: number | null; readonly decidedBy: readonly string[] } {
  const stall = placedEntry(stationStallId);
  const bearing = Math.atan2(stall.z, stall.x);
  // A search, not a division: `s = -R * bearing` only held while the ring was
  // a circle. Valid because the boundary is star-shaped, so bearing is
  // monotone in arc length.
  const atBooth = wrapRing(RING_PATH.distanceAtBearing(bearing));
  const found = slideArchClear(atBooth, stall, keepArchOff, choice);
  return {
    at: found.at,
    decidedBy: ['layout', ...[...found.pushedBy].filter((owner) => owner !== 'layout')],
  };
}


/** {@link RailRaceRoute.wrap}, for the one ring path both rings share. */
function wrapRing(distance: number): number {
  const wrapped = distance % RING_PATH.length;
  return wrapped < 0 ? wrapped + RING_PATH.length : wrapped;
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
export function planExit(
  /**
   * Somewhere else the exit may not go, on top of the edge, the railway and
   * the plots — for a test to hold the no-clear-spot answer to account. The
   * park passes nothing.
   */
  alsoRefuse: (x: number, z: number) => boolean = () => false,
): { exitX: number; exitZ: number; railwayTookPart: boolean } | { refused: string; railwayTookPart: boolean } {
  const stall = placedEntry(STATION_STALL_ID);
  // Whether the railway refused a spot tried before the one taken — so a
  // refusal of anything placed against this exit knows whether re-choosing the
  // railway could move it (see `RailRaceRoute.archDecidedBy`).
  let railwayTookPart = false;
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
      if (distanceToRailCorridor(x, z) < RAIL_CORRIDOR_CLEARANCE) {
        railwayTookPart = true;
        continue;
      }
      // 2.6, from 1.4 (issue #241): an exit inside a booth's INFLATED circle is
      // one `routeAround` cannot dodge on the way in — the spur leg then
      // grazes the booth's counter and the exit's waypoints strand behind it.
      // And off the railway with its fence, like every exit.
      if (alsoRefuse(x, z)) continue;
      if (clearOfPlots(x, z, 2.6) && distanceToRailCorridor(x, z) >= RAIL_CORRIDOR_CLEARANCE) {
        return { exitX: x, exitZ: z, railwayTookPart };
      }
    }
  }

  // Nothing clear anywhere around the booth. This used to hand back the
  // nearest try anyway — a spot it had just found unclear — and leave
  // `world/dismount.ts`'s runtime safety net to cope. It refuses instead, and
  // the plan re-chooses what put the booth there (`parkPlan.ts`'s
  // `railRaceBars`, which names the layout, and the railway when it refused a
  // spot).
  return {
    refused:
      `rail race: no clear exit within ${(start + 14).toFixed(1)} m of the booth at ` +
      `(${stall.x.toFixed(1)}, ${stall.z.toFixed(1)}) — every spot is off the park's edge, on the railway or in a plot`,
    railwayTookPart,
  };
}

/** Why no Rail Race can be planned at an arch station, and which decisions to re-choose. */
export interface RailRaceUnplaceable {
  readonly unplaceable: string;
  /** The plan decisions that put what refused it there — a refusal's `consumed`. */
  readonly decidedBy: readonly string[];
  /** False when no later arch station can answer it (the exit, or the stations ran out). */
  readonly anotherStationMayHelp: boolean;
}

/**
 * **The Rail Race with its arch at clear station `archChoice`** — the plan's
 * `railRaceBars` builder (`planSolver.ts`) asks this for choice 0, 1, 2, … until
 * the duck bars fit. Returns the plan (both rings, built on the one station)
 * and the exit, or — when the ring has fewer clear stations than that — the
 * decisions that put the arch's candidates where they are, for a refusal.
 */
export function planRailRaceAt(archChoice: number): PlannedRailRace | RailRaceUnplaceable {
  // **The exit is solved BEFORE the rings, and that ordering is load-bearing.**
  // `slideArchClear` slides the finish arch off anything its feet must not come
  // down on, and the ride's own exit is one of those things — the paving is
  // obliged to reach it, so a foot on the exit is a foot on the exit's spur.
  // `planExit` never needed a ring: it asks the booth, the boundary and the
  // railway corridor, all of which exist already. It simply used to run second.
  const exit = planExit();
  if ('refused' in exit) {
    return {
      unplaceable: exit.refused,
      decidedBy: ['layout', ...(exit.railwayTookPart ? ['train'] : [])],
      // The exit does not depend on the arch, so no other station can help.
      anotherStationMayHelp: false,
    };
  }
  const { exitX, exitZ, railwayTookPart } = exit;

  // Everything the arch's feet must miss that only this module can see. The
  // doormat and the plots are checked by the search itself; these two are
  // not, and leaving the cruiser out of the list is what turned seed 11 green
  // and seed 5 red on the first attempt — `startDistance` is the whole ride's
  // datum, so moving the arch moves the ride.
  const keepArchOff: KeepOff[] = [
    // The exit, plus the room a dismounting child needs around it.
    { x: exitX, z: exitZ, radius: 4, ...(railwayTookPart ? { owner: 'train' } : {}) },
  ];
  // The Sky Cruiser's loop, sampled. Its own low run is what the arch collided
  // with on seed 5; `RAIL_OVER_RAIL`-style air does not help here because an
  // arch foot is on the ground, so this is a plan-view keep-off like any other.
  const cruiser = COASTER_PLANS.cruiser.route;
  const cruiserStep = 2;
  for (let d = 0; d < cruiser.length; d += cruiserStep) {
    const point = cruiser.pointAt(d, new Vector3());
    keepArchOff.push({ x: point.x, z: point.z, radius: 5, owner: 'cruiser' });
  }

  const arch = archStation(STATION_STALL_ID, keepArchOff, archChoice);
  if (arch.at === null) {
    return {
      unplaceable:
        archChoice === 0
          ? 'rail race: no station on the whole ring leaves the finish arch\'s feet clear'
          : `rail race: no clear arch station leaves every duck bar a legal slot (${archChoice} tried)`,
      decidedBy: arch.decidedBy,
      anotherStationMayHelp: false,
    };
  }
  return railRacePlanFrom(exitX, exitZ, { at: arch.at, decidedBy: arch.decidedBy });
}
