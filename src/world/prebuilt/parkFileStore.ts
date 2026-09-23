import type { ParkFile } from './parkFile';

/**
 * **The one letterbox a prebuilt park is posted through.** Whoever has a park
 * file — the browser boot (`boot/prebuiltPark.ts`), or a check script that
 * wrote one — offers it here *before anything forces the plan*; `parkPlan.ts`
 * reads it once, when its driver starts, and hydrates from it instead of
 * searching.
 *
 * It imports nothing at runtime, deliberately: `parkPlan.ts` is evaluated in
 * the middle of `parkLayout.ts`'s own evaluation, and a letterbox that dragged
 * the codec's imports in with it could not be read from there safely.
 */

// `var`, for the same reason `parkPlan.ts` gives: read during a module cycle.
/* eslint-disable no-var */
var offered: ParkFile | null = null;
/* eslint-enable no-var */

/** Offer a park file. Must happen before the plan is driven; later is ignored by the driver. */
export function offerParkFile(file: ParkFile): void {
  offered = file;
}

/** The offered file, or null. */
export function offeredParkFile(): ParkFile | null {
  return offered ?? null;
}
