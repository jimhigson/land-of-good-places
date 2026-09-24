/**
 * **The log of built decisions** — what each search that runs while the
 * `World` builds decided, recorded for `build:parks` to write into the park
 * file's `built` (`src/world/prebuilt/parkFile.ts`). A leaf: it imports no park
 * module, so the boundary's search can record into it while the game's modules
 * are still loading.
 */
import { BUILT_DECISIONS, type BuiltDecision } from '../../src/world/prebuilt/parkFileName';

const recorded = new Map<BuiltDecision, unknown>();

/** Note what a search decided — the latest answer wins, as an unwind re-decides. */
export function recordBuilt<T>(key: BuiltDecision, value: T): T {
  recorded.set(key, value);
  return value;
}

/** Every built decision this process made, and the keys it never decided. */
export function builtDecisions(): { readonly values: Readonly<Record<string, unknown>>; readonly missing: readonly BuiltDecision[] } {
  return {
    values: Object.fromEntries(recorded),
    missing: BUILT_DECISIONS.filter((key) => !recorded.has(key)),
  };
}
