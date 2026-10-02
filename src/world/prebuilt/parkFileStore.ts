import type { ParkFile } from './parkFile';
import { parkSeedAsked } from '../parkSeedPool';

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
/** Whether Node's shipped-file resolver has been asked yet (once per process). */
var resolverAsked: boolean | undefined;
/* eslint-enable no-var */

/** Offer a park file. Must happen before the plan is driven. */
export function offerParkFile(file: ParkFile): void {
  offered = file;
  missing = null;
}

/** The offered file, or null. */
export function offeredParkFile(): ParkFile | null {
  if (!offered && !resolverAsked) {
    resolverAsked = true;
    // Node tooling only (the `--import` hook installs it): the shipped file
    // for this seed when there is a fresh one, so a check builds the park the
    // game ships rather than solving it. Never set in the browser.
    const resolve = (globalThis as { __LGP_RESOLVE_PARK_FILE__?: (seed: number) => ParkFile | null })
      .__LGP_RESOLVE_PARK_FILE__;
    if (resolve) offered = resolve(parkSeedAsked()) ?? null;
  }
  return offered ?? null;
}

/**
 * **Which park this is, exactly** — the offered file's whole-park digest
 * (`build:parks` writes it after proving the file), or null with no file. A
 * saved position is stamped with it and only restored into the same park
 * (`main.ts`): a seed's park changes when its restart is re-found or its
 * generator changes, and a spot measured in the old one can stand inside a
 * collider of the new.
 */
export function parkStamp(): string | null {
  return typeof offered?.digest === 'string' ? offered.digest : null;
}

/** Say why there is no park file to offer. */
export function reportParkFileMissing(reason: string): void {
  missing = reason;
}

/** Why no park file was offered, if anybody said. */
export function parkFileMissingReason(): string | null {
  return missing ?? null;
}
