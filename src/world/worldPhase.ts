/**
 * **The world phase: every remaining park feature, decided.**
 *
 * Since prebuilt parks (`docs/design/PREBUILT-PARKS.md`) the game **hydrates**
 * these decisions from the park file; the search described below lives in
 * `procgen/world/worldPhaseSolver.ts` and runs only in build tooling, through
 * the solver port (`prebuilt/solverPort.ts`).
 *
 * The plan phase (`parkPlan.ts`) decides the layout, the rides' routes, the
 * crossings, the paths and the road. Everything else that stands on the lawn
 * — the fountain, the walls, the trees and bushes, the fairy-light poles, the
 * lamp posts, the rail race's trestles — is decided here, by a second
 * {@link ParkSolve} over the same claims registry, after the fixed structures
 * (castle, hotel, stalls, railway, coaster, entrance) have registered their
 * colliders. Jim, 16 Sep 2026: *"each feature being based around a generic
 * feature builder interface that provides advancing, going back, and
 * retrying … all features have a small degree of 'correction' built-in, eg
 * if colliding with a tree, simply moving the tree to a different location
 * before continuing, same for lamp posts, walls etc."*
 *
 * Nothing is drawn here. Each builder decides positions and claims; the
 * `World` then constructs the meshes and colliders from the decisions, in
 * one pass, so a decision that was unwound never left a collider behind.
 *
 * Not here, and why: **flowers**. A flower has no collider, respawns at
 * runtime and re-seats itself against the finished park
 * (`Flowers.settleAgainstTheFinishedPark`) — a living system, not a placed
 * feature, so it is constructed after the phase's colliders exist, as before.
 */

import type { CollisionWorld } from './Collision';
import type { GroundClaims, FeatureContribution } from '../boot/groundClaims';
import type { CoasterRoute } from './coaster/route';
import type { BushDecision, SceneryDecisions, TreeDecision, WallRun } from './Scenery';
import type { LampDecision } from './LampPosts';
import type { FairyChain } from './FairyLights';
import type { BoothRelocator } from './stallsFeature';
import { RailRace } from './railRace/RailRace';
import { trestleSpotsFromDecisions, type DecidedTrestles } from './railRace/track';
import { setStallShift } from '../minigames/stallPlacement';
import { PARK_SEED } from './parkManifest';
import { offeredParkFile, parkFileMissingReason } from './prebuilt/parkFileStore';
import { ParkUnavailable } from './prebuilt/parkUnavailable';
import { parkSolver } from './prebuilt/solverPort';
import { readWorld } from './prebuilt/parkFile';

/** Every decision the world phase makes — what a park file records. */
export interface WorldDecisions {
  /** Booths that stepped aside: id, the shift recorded, and the exact spot placed at. */
  readonly stallMoves: readonly (readonly [id: string, dx: number, dz: number, x: number, z: number])[];
  readonly walls: readonly (WallRun | null)[];
  readonly trees: readonly TreeDecision[];
  readonly bushes: readonly BushDecision[];
  readonly fairyPoles: readonly FairyChain[];
  readonly lamps: readonly LampDecision[];
  /** The rail race's trestles, by ring name. */
  readonly trestles: Readonly<Record<string, DecidedTrestles>>;
  /** The world phase's claims, feature by feature in commit order, section by section. */
  readonly claims: readonly {
    readonly feature: string;
    readonly sections: readonly (readonly [number, FeatureContribution])[];
  }[];
}

export interface WorldPhase {
  readonly scenery: SceneryDecisions;
  readonly lamps: readonly (readonly [number, number])[];
  readonly fairyPoles: readonly FairyChain[];
  readonly railRace: RailRace;
  readonly decisions: WorldDecisions;
}

/** What the `World` builds from, given the decisions and the ride built from them. */
export function worldPhaseFrom(decisions: WorldDecisions, railRace: RailRace): WorldPhase {
  return {
    scenery: { trees: decisions.trees, bushes: decisions.bushes, walls: decisions.walls },
    lamps: decisions.lamps.flatMap((lamp) => (lamp === 'forgone' ? [] : [[lamp.x, lamp.z] as const])),
    fairyPoles: decisions.fairyPoles,
    railRace,
    decisions,
  };
}

/**
 * The world phase from a park file: the booths moved to where the search left
 * them, the claims committed exactly as it committed them, and the rail race
 * built on its decided trestles. No search runs.
 */
function hydrateWorldPhase(
  decisions: WorldDecisions,
  collision: CollisionWorld,
  claims: GroundClaims,
  booths: BoothRelocator,
): WorldPhase {
  for (const [id, dx, dz, x, z] of decisions.stallMoves) {
    const booth = booths(id);
    if (!booth) throw new ParkUnavailable(PARK_SEED, `its park file moves stall ${id}, which cannot move`);
    booth.withdrawCollision();
    setStallShift(id, dx, dz);
    booth.placeAt(x, z);
  }
  for (const { feature, sections } of decisions.claims) {
    for (const [section, contribution] of sections) claims.commitSection(feature, section, contribution);
  }
  const railRace = new RailRace(collision, claims, trestleSpotsFromDecisions(decisions.trestles));
  return worldPhaseFrom(decisions, railRace);
}

/**
 * Decide every world-time feature: hydrated from the park file, or — in build
 * tooling only — searched by the installed solver. Synchronous: the `World`
 * constructor calls it.
 *
 * `booths` is how a stall steps aside: the `World` hands in a way to reach the
 * booths it has already built.
 */
export function decideWorldPhase(
  collision: CollisionWorld,
  claims: GroundClaims,
  cruiserRoute: CoasterRoute | null,
  booths: BoothRelocator,
): WorldPhase {
  const file = offeredParkFile();
  if (file) return hydrateWorldPhase(readWorld(file.features.world), collision, claims, booths);
  const solver = parkSolver();
  if (!solver) throw new ParkUnavailable(PARK_SEED, parkFileMissingReason() ?? 'no park file was loaded');
  return solver.worldPhase(collision, claims, cruiserRoute, booths);
}
