import type { ParkFile } from './parkFile';

/**
 * **The one letterbox a prebuilt park is posted through.** Whoever has a park
 * file — the browser boot (`boot/prebuiltPark.ts`), or a check script that
 * wrote one — offers it here *before anything forces the plan*; `parkPlan.ts`
 * and `worldPhase.ts` read it and hydrate from it instead of searching.
 *
 * A boot that could not get one posts the reason instead, so the error a
 * child sees says why (`ParkUnavailable`).
 *
 * It imports nothing at runtime, deliberately: `parkPlan.ts` is evaluated in
 * the middle of `parkLayout.ts`'s own evaluation, and a letterbox that dragged
 * the codec's imports in with it could not be read from there safely.
 */

// `var`, for the same reason `parkPlan.ts` gives: read during a module cycle.
/* eslint-disable no-var */
var offered: ParkFile | null = null;
var missing: string | null = null;
/* eslint-enable no-var */

/** Offer a park file. Must happen before the plan is driven. */
export function offerParkFile(file: ParkFile): void {
  offered = file;
  missing = null;
}

/** The offered file, or null. */
export function offeredParkFile(): ParkFile | null {
  return offered ?? null;
}

/** Say why there is no park file to offer. */
export function reportParkFileMissing(reason: string): void {
  missing = reason;
}

/** Why no park file was offered, if anybody said. */
export function parkFileMissingReason(): string | null {
  return missing ?? null;
}
