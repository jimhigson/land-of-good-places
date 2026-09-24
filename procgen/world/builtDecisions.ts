/**
 * **Decisions the `World` made while it was built, by a search that runs only
 * here** — recorded as they are made so `build:parks` can write them into the
 * park file (`src/world/prebuilt/parkFile.ts`'s `built`).
 */
import { type BridgeDecision, type PlannedFootprint, type RealWorldQuery } from '../../src/world/train/bridgeFootprint';
import { planBridgeFootprints, bridgeDecisionOf } from './train/bridgeSearch';
import type { LevelCrossing } from '../../src/world/train/crossings';

let bridges: (BridgeDecision | null)[] | null = null;

/** The bridge search, recording what it decided. */
export function searchBridgeFootprints(crossings: readonly LevelCrossing[], real: RealWorldQuery): PlannedFootprint[] {
  const footprints = planBridgeFootprints(crossings, real);
  bridges = footprints.map((footprint) => (footprint ? bridgeDecisionOf(footprint) : null));
  return footprints;
}

/** The bridges the last built `World` decided, or null if none was built with the search. */
export function builtBridgeDecisions(): readonly (BridgeDecision | null)[] | null {
  return bridges;
}
