/**
 * **Decisions made while the `World` builds, by searches that run only here**
 * — recorded as they are made so `build:parks` can write them into the park
 * file's `built` (`src/world/prebuilt/parkFile.ts`, `src/world/prebuilt/built.ts`).
 */
import { type BridgeDecision, type PlannedFootprint, type RealWorldQuery } from '../../src/world/train/bridgeFootprint';
import { planBridgeFootprints, bridgeDecisionOf } from './train/bridgeSearch';
import type { LevelCrossing } from '../../src/world/train/crossings';
import { BUILT_DECISIONS, type BuiltDecision } from '../../src/world/prebuilt/parkFile';

const recorded = new Map<BuiltDecision, unknown>();

/** Note what a search decided — the latest answer wins, as an unwind re-decides. */
export function recordBuilt<T>(key: BuiltDecision, value: T): T {
  recorded.set(key, value);
  return value;
}

/** Every built decision this process made, or the keys it never decided. */
export function builtDecisions(): { readonly values: Readonly<Record<string, unknown>>; readonly missing: readonly BuiltDecision[] } {
  return {
    values: Object.fromEntries(recorded),
    missing: BUILT_DECISIONS.filter((key) => !recorded.has(key)),
  };
}

/** The bridge search, recording what it decided. */
export function searchBridgeFootprints(crossings: readonly LevelCrossing[], real: RealWorldQuery): PlannedFootprint[] {
  const footprints = planBridgeFootprints(crossings, real);
  recordBuilt(
    'bridges',
    footprints.map((footprint): BridgeDecision | null => (footprint ? bridgeDecisionOf(footprint) : null)),
  );
  return footprints;
}
