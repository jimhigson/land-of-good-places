import { Vector3 } from 'three';
import {
  type CoasterBriefs,
  CoasterRoute,
  type CoasterRouteOptions,
  coasterProfileSearch,
  coasterRouteBriefSearch,
} from './route';

// The retry ladder, re-exported so `boot/parkGeneration.ts` (which imports
// this module lazily, by design) can drive the SAME policy generator the
// constructor drives — one owner, two cadences. See its doc in `route.ts`.
export { cruiserRouteSearch } from './route';
import type { SolvedRailRoute } from '../rail/generate';
import { PARK_SEED } from '../parkManifest';
import { Rng } from '../../core/mathUtils';
import { placedEntry } from '../parkLayout';
import { clearOfPlots } from '../parkLayout';
// The same "far enough inside the edge to stand" margin the Rail Race's exit
// uses — one owner, and it lives on the boundary because importing it from
// `railRace/plan` would close the cycle
// `coaster/plan -> railRace/plan -> train/plan -> coaster/plan`, which `tsc`
// accepts and Node fails at load.
import { EXIT_INSIDE_EDGE, PARK_BOUNDARY } from '../boundary';

/**
 * The coaster plan — the Sky Cruiser as *data*, solved at module load
 * from the park layout alone, mirroring `train/plan.ts` exactly (see that
 * file's header for why this inversion matters).
 *
 * `CoasterRoute` already depended on nothing but the layout, so this is a
 * move rather than a redesign: `Coaster` used to call `new CoasterRoute(...)`
 * itself, in its own constructor, which meant nothing upstream of the ride —
 * least of all the path graph — could know where a coaster's station (and so
 * its exit) actually was. Now both loops are solved here, before any scene
 * object exists, and `paths.ts` gives each one's exit a node in the same walk
 * network a station gets.
 *
 * `CoasterRouteOptions.avoid` still exists for a second loop that ever wants to
 * grow here; nothing uses it now that the Rail Race is a perimeter ring.
 */

export interface PlannedCoaster {
  readonly name: string;
  readonly route: CoasterRoute;
  readonly stationStallId: string;
  /** Where a rider is put down after the ride (GAME_DESIGN.md's EXIT rule). */
  readonly exitX: number;
  readonly exitZ: number;
}

interface CoasterSeed {
  readonly name: string;
  readonly routeSalt: number;
  readonly stationStallId: string;
  /** How far out this loop may reach. Defaults to the route's own limit. */
  readonly outerRadius?: number;
  /** Metres of track wanted. Defaults to the route's own target. */
  readonly desiredLength?: number;
}

const CRUISER_SEED: CoasterSeed = {
  name: 'skyCruiser',
  routeSalt: 0xc0a57e,
  stationStallId: 'stall.skyCruiser',
};

/**
 * The exit point: beside the station, on the far side from the booth, clear
 * of every plot blocker — the `clearOfPlots`/slide pattern `train/plan.ts`
 * uses for a station's platform, adapted from a distance-along-the-loop
 * search to a 2D one, because an exit is a point beside the track rather than
 * a point on it.
 *
 * Starts a few metres past the station's platform deck (it is 6 m long) so
 * the exit never lands *on* the platform, then works outward — straight out
 * from the booth first, and **fanning to either side as it goes** — until the
 * ground there is genuinely clear.
 *
 * ### Why the fan, and not just the one line
 *
 * It used to try that single line and nothing else: twenty samples straight out
 * from the booth through the station, and if every one of them was blocked it
 * handed back the 5 m mark regardless — a point it had *already measured* to be
 * inside something. That is a placement that reports success about a spot it
 * knows is bad, and the only thing standing between it and a child was
 * `dismount.ts`'s runtime net.
 *
 * It stayed invisible because the seed it fails on could not build a park at
 * all for an unrelated reason (the slide's length ceiling), so the exit
 * invariant never ran there. With the slide fixed, seed 5 put the Sky Cruiser's
 * exit at (-80.2, 48.8): not standable, and not reachable from the entrance.
 *
 * A ring of ground is not one ray. Sweeping bearings costs nothing — this runs
 * once per ride at module load — and the direction out from the booth is still
 * tried first at every distance, so a park with clear ground there is placed
 * exactly where it always was.
 */
function planExit(route: CoasterRoute, stationStallId: string): { exitX: number; exitZ: number } {
  const stall = placedEntry(stationStallId);
  const station = route.pointAt(route.stationDistance, new Vector3());
  const dx = station.x - stall.x;
  const dz = station.z - stall.z;
  const length = Math.hypot(dx, dz) || 1;
  const nx = dx / length;
  const nz = dz / length;
  const straightOut = Math.atan2(nz, nx);

  // Straight out first, then alternating either side. A rider stepping off
  // beside the platform reads best when the exit is roughly where the booth
  // faces, so the fan widens only as far as it must.
  const bearings: number[] = [0];
  for (let step = 1; step <= 12; step += 1) {
    bearings.push((step * Math.PI) / 12, (-step * Math.PI) / 12);
  }

  for (let distance = 5; distance <= 24; distance += 1) {
    for (const offset of bearings) {
      const bearing = straightOut + offset;
      const x = station.x + Math.cos(bearing) * distance;
      const z = station.z + Math.sin(bearing) * distance;
      // 2.6, from 1.4 — same reasoning as railRace/plan.ts's exit margin.
      // The railway cannot be asked here — the coaster solves BEFORE the
      // train exists — so the avoidance points the other way: the train's
      // own solver keeps its track and fence off this exit (train/route.ts).
      if (!clearOfPlots(x, z, 2.6)) continue;
      // Inside the park with a lane to spare. An exit on the wrong side of the
      // boundary is clear of every plot and still somewhere a child cannot be
      // put down — and, being outside the walkable park, is exactly what
      // "not reachable from the entrance" means.
      if (PARK_BOUNDARY.distanceToEdge(x, z) < EXIT_INSIDE_EDGE) continue;
      return { exitX: x, exitZ: z };
    }
  }
  // Nothing anywhere in the ring out to 24 m. Hand back the nearest try rather
  // than nothing; `dismount.ts`'s runtime safety net is the last resort for
  // exactly this case, and the procgen invariant is the loud way to hear about
  // it before a child does.
  return { exitX: station.x + nx * 5, exitZ: station.z + nz * 5 };
}

function planCoaster(seed: CoasterSeed, avoid: CoasterRoute | null): PlannedCoaster {
  const options: CoasterRouteOptions = {
    salt: seed.routeSalt,
    stationStallId: seed.stationStallId,
    avoid,
    ...(seed.outerRadius !== undefined ? { outerRadius: seed.outerRadius } : {}),
    ...(seed.desiredLength !== undefined ? { desiredLength: seed.desiredLength } : {}),
  };
  const route = new CoasterRoute(options);
  const { exitX, exitZ } = planExit(route, seed.stationStallId);
  return { name: seed.name, route, stationStallId: seed.stationStallId, exitX, exitZ };
}

/**
 * **The cruiser's options, in one place, so both cadences solve the same ride.**
 *
 * `planCoaster` used to build these inline. They are named now because the
 * pre-warmed path needs the *identical* options object to build the identical
 * brief — two hand-kept copies of "which stall, which salt, how long" is exactly
 * the two-definitions-of-one-thing bug this repo keeps paying for.
 */
export function cruiserOptions(): CoasterRouteOptions {
  return {
    salt: CRUISER_SEED.routeSalt,
    stationStallId: CRUISER_SEED.stationStallId,
    avoid: null,
    ...(CRUISER_SEED.outerRadius !== undefined ? { outerRadius: CRUISER_SEED.outerRadius } : {}),
    ...(CRUISER_SEED.desiredLength !== undefined
      ? { desiredLength: CRUISER_SEED.desiredLength }
      : {}),
  };
}

/** What a sliced driver needs to search the cruiser and then finish it. */
export interface CruiserSearchStart {
  readonly briefs: CoasterBriefs;
  /**
   * The stream {@link coasterRouteBriefs} advanced building those briefs.
   *
   * Carried to {@link finishCruiserPlan} rather than rebuilt there — see
   * `CoasterRoute`'s constructor for why re-deriving it would be both slower
   * and a second definition of the same thing.
   */
  readonly rng: Rng;
}

/**
 * Everything the sliced driver needs to begin. Pure, and safe to call twice.
 *
 * ~20 ms, nearly all of it `stationPoses` filtering 762 candidate stations, so
 * the driver builds it once on the frame the search starts — the same treatment
 * `slide/solve.ts`'s door and pit poses get.
 */
export function cruiserBriefs(): CruiserSearchStart {
  const search = cruiserStartSearch();
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}

/**
 * {@link cruiserBriefs}, a ring of candidate stations at a time.
 *
 * ~19 ms of the ~20 ms is `boundary.distanceToEdge`, asked seven times for each
 * of 704 candidate spots — one indivisible lump that overran
 * `check:park-boot`'s per-frame ceiling on its own. It is sliced with the same
 * mechanism as the searches either side of it rather than the ceiling being
 * moved: eleven yields, ~1.8 ms apiece.
 */
export function* cruiserStartSearch(): Generator<number, CruiserSearchStart, void> {
  const options = cruiserOptions();
  const rng = new Rng(PARK_SEED ^ options.salt);
  const briefs = yield* coasterRouteBriefSearch(options, rng);
  return { briefs, rng };
}

/**
 * Turns a route somebody else searched into the finished plan.
 *
 * The counterpart of `slide/solve.ts`'s `finishSlidePlan`: everything after the
 * search — the height profile, the station and castle carves, the vertical
 * repair, and the exit hunt — done from an already-solved plan view. Measured at
 * ~10 ms, so it runs in one slice; it was never the expensive half.
 */
export function finishCruiserPlan(solved: SolvedRailRoute, rng: Rng): PlannedCoaster {
  const search = finishCruiserPlanSearch(solved, rng);
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}

/**
 * {@link finishCruiserPlan}, a repair pass at a time.
 *
 * **This is the block CI actually failed on.** As one call it measured 18.9 ms
 * on an M4 Pro and 54.6 ms on CI's hardware, against a 24 ms ceiling — the
 * vertical repair rebuilds the whole curve ten times and never converged early,
 * with no yield anywhere inside it. `coasterProfileSearch` yields per pass.
 *
 * `planExit` stays un-sliced deliberately: it is a bounded ring search that
 * measured well under a millisecond, and slicing work that already fits buys
 * nothing but places for a bug to hide.
 */
export function* finishCruiserPlanSearch(
  solved: SolvedRailRoute,
  rng: Rng,
): Generator<number, PlannedCoaster, void> {
  const options = cruiserOptions();
  const stall = placedEntry(CRUISER_SEED.stationStallId);
  const profile = yield* coasterProfileSearch(solved, rng, stall);
  const route = new CoasterRoute(options, { plan: solved, rng, profile });
  const { exitX, exitZ } = planExit(route, CRUISER_SEED.stationStallId);
  return {
    name: CRUISER_SEED.name,
    route,
    stationStallId: CRUISER_SEED.stationStallId,
    exitX,
    exitZ,
  };
}

/** Solves the cruiser start to finish, right now — the cadence CI takes. */
export function planCruiser(): PlannedCoaster {
  return planCoaster(CRUISER_SEED, null);
}
