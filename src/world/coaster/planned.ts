
import { CoasterRoute, type CoasterProfile } from './route';
import { type SolvedRailRoute } from '../rail/generate';
/**
 * **The Sky Cruiser as decided** — the plan's type and the one constructor a
 * decided cruiser is built with, shared by the game (park file) and
 * `procgen/` (search).
 */

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


/**
 * The finished cruiser plan from decisions a prebuilt park carries
 * (`world/prebuilt/parkFile.ts`): the searched plan view, the finished
 * profile, and the exit {@link planExit} chose. Built through the same
 * `CoasterRoute` constructor {@link finishCruiserPlanSearch} uses, handed the
 * same three things, so nothing after the search has a second definition.
 */
export function cruiserPlanFromDecisions(
  plan: SolvedRailRoute,
  profile: CoasterProfile,
  exit: { readonly exitX: number; readonly exitZ: number },
): PlannedCoaster {
  const route = new CoasterRoute({ plan, profile });
  return {
    name: CRUISER_SEED.name,
    route,
    stationStallId: CRUISER_SEED.stationStallId,
    exitX: exit.exitX,
    exitZ: exit.exitZ,
  };
}

export interface CoasterSeed {
  readonly name: string;
  readonly routeSalt: number;
  readonly stationStallId: string;
  /** How far out this loop may reach. Defaults to the route's own limit. */
  readonly outerRadius?: number;
  /** Metres of track wanted. Defaults to the route's own target. */
  readonly desiredLength?: number;
}


export const CRUISER_SEED: CoasterSeed = {
  name: 'skyCruiser',
  routeSalt: 0xc0a57e,
  stationStallId: 'stall.skyCruiser',
};
