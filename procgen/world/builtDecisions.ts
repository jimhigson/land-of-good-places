/**
 * **Decisions made while the `World` builds, by searches that run only here**
 * — recorded as they are made so `build:parks` can write them into the park
 * file's `built` (`src/world/prebuilt/parkFile.ts`, `src/world/prebuilt/built.ts`).
 */
import { type BridgeDecision, type PlannedFootprint, type RealWorldQuery } from '../../src/world/train/bridgeFootprint';
import { planBridgeFootprints, bridgeDecisionOf } from './train/bridgeSearch';
import type { LevelCrossing } from '../../src/world/train/crossings';
import { recordBuilt } from './builtLog';
export { builtDecisions, recordBuilt } from './builtLog';

/** The bridge search, recording what it decided. */
export function searchBridgeFootprints(crossings: readonly LevelCrossing[], real: RealWorldQuery): PlannedFootprint[] {
  const footprints = planBridgeFootprints(crossings, real);
  recordBuilt(
    'bridges',
    footprints.map((footprint): BridgeDecision | null => (footprint ? bridgeDecisionOf(footprint) : null)),
  );
  return footprints;
}
