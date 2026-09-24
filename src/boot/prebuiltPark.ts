import { PARK_SEED } from '../world/parkManifest';
import { PARK_SEED_POOL } from '../world/parkSeedPool';
import type { ParkFile } from '../world/prebuilt/parkFile';
import { parkFileName } from '../world/prebuilt/parkFileName';
import { offerParkFile, reportParkFileMissing } from '../world/prebuilt/parkFileStore';

/**
 * **Fetch this park's decisions — the only way the game has of getting a
 * park** (`docs/design/PREBUILT-PARKS.md`).
 *
 * Jim, 24 September 2026: *"there should be no ability to build built into the
 * game as delivered — seeds not downloadable is an error."* Parks are solved at
 * build time (`pnpm run build:parks`); each ships as `/parks/<seed>.json` beside
 * the bundle, emitted by the same `vite build` and precached with it by the
 * service worker. The game hydrates the park from it and searches for nothing.
 *
 * So anything short of a usable file is an **error**, reported by the plan as
 * `ParkUnavailable` and shown to the child by `ui/ParkUnavailableScreen.ts`,
 * naming the seed and the reason this module posts:
 *
 * - a seed outside {@link PARK_SEED_POOL} (Jim: *"we only support seeds
 *   0..15"*) — refused before anything is fetched;
 * - no file on the server — the host answers 404, or the app's own page for an
 *   unknown path (the service worker's `navigateFallback` does that), so
 *   anything not served as JSON counts as "no file";
 * - a file from another build — its `build` is not this bundle's
 *   `__APP_VERSION__`, so a stale park against a new bundle cannot be hydrated;
 * - a download that failed.
 *
 * **There is no timeout.** A pool park is precached with the bundle that
 * reads it, so on an installed game the fetch is answered by the service
 * worker and cannot fail for want of a network; on a first visit the park is
 * downloaded alongside the bundle itself, and a page that got its script can
 * get ~10 KB of JSON. Giving up early would only turn a slow load into an
 * error.
 *
 * **Retry means reload.** The screen's button reloads the page, which fetches
 * the file again — it never solves. That is the right answer to a failed
 * download and a wrong one (it fails the same way) to an unsupported seed or
 * a build shipped without parks, which is why the screen also offers the
 * park she gets without a `?seed=`.
 *
 * In Node nothing is fetched: checks and `build:parks` solve fresh or offer a
 * file themselves.
 */

let loading: Promise<void> | null = null;

/** Fetch and offer this park's file, once. Never rejects: a failure is posted as the reason. */
export function loadPrebuiltPark(): Promise<void> {
  return (loading ??= fetchPrebuiltPark());
}

async function fetchPrebuiltPark(): Promise<void> {
  const env = (import.meta as { env?: { BASE_URL?: string } }).env;
  if (!env || typeof fetch !== 'function') return;
  if (!PARK_SEED_POOL.includes(PARK_SEED)) {
    reportParkFileMissing(
      `seed ${PARK_SEED} is not one of this game's parks (it has seeds ${PARK_SEED_POOL.join(', ')})`,
    );
    return;
  }
  const url = `${env.BASE_URL ?? '/'}${parkFileName(PARK_SEED)}`;
  try {
    const response = await fetch(url);
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.includes('json')) {
      reportParkFileMissing(`its park file is not in this build (${url}: HTTP ${response.status}, ${type || 'no type'})`);
      return;
    }
    const file = (await response.json()) as ParkFile;
    if (file.build !== __APP_VERSION__) {
      reportParkFileMissing(
        `its park file belongs to another version of the game (${String(file.build).slice(0, 12)}, this is ${__APP_VERSION__.slice(0, 12)})`,
      );
      return;
    }
    offerParkFile(file);
  } catch (error) {
    reportParkFileMissing(`its park file could not be downloaded (${String(error)})`);
  }
}
