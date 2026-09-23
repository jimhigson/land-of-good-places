import { PARK_SEED } from '../world/parkManifest';
import type { ParkFile } from '../world/prebuilt/parkFile';
import { parkFileName } from '../world/prebuilt/parkFileName';
import { offerParkFile } from '../world/prebuilt/parkFileStore';

/**
 * **Fetch this park's prebuilt decisions, so the device does not have to
 * search for them** (`docs/design/PREBUILT-PARKS.md`).
 *
 * The file sits beside the bundle at `/parks/<seed>.json`, emitted by the same
 * `vite build` and precached with it by the service worker, so on an installed
 * game this is a cache hit and costs nothing. It is offered to the plan's
 * driver (`world/prebuilt/parkFileStore.ts`), which hydrates from it instead
 * of spending seconds of a phone's CPU on the searches.
 *
 * **It can only ever make the boot faster, never wrong or stuck.** Anything
 * short of a file for exactly this seed, built by exactly this bundle, is
 * ignored and the park is solved here, as it always was:
 *
 * - no file (a `?seed=` off the pool, a build shipped without parks) → solve;
 * - a file from another build — an old bundle fetching after a deploy, which
 *   the precache normally prevents — is refused on `build` against
 *   `__APP_VERSION__`, so a stale park against a new bundle cannot happen;
 * - a network that does not answer within {@link PREBUILT_PARK_TIMEOUT_MS} is
 *   abandoned, so a bad connection cannot hang the boot.
 *
 * Never in dev (Vite serves no parks, and a dev server is where the generator
 * is being changed) and never in Node (checks measure fresh solves; a check
 * that wants a file offers one itself).
 */

/** How long a boot waits for the file before solving instead. */
export const PREBUILT_PARK_TIMEOUT_MS = 3000;

let loading: Promise<void> | null = null;

/** Fetch and offer the prebuilt park, once. Never rejects: the fallback is to solve. */
export function loadPrebuiltPark(): Promise<void> {
  return (loading ??= fetchPrebuiltPark());
}

async function fetchPrebuiltPark(): Promise<void> {
  const env = (import.meta as { env?: { DEV?: boolean; BASE_URL?: string } }).env;
  if (!env || env.DEV || typeof fetch !== 'function') return;
  const url = `${env.BASE_URL ?? '/'}${parkFileName(PARK_SEED)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREBUILT_PARK_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    // A host that answers every unknown path with the app's own page (the
    // service worker's `navigateFallback`, a single-page-app asset config)
    // says 200 with HTML for a seed that has no file — that is "none", not a
    // broken file.
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.includes('json')) {
      console.info(
        `Prebuilt park: none for seed ${PARK_SEED} (${url}: HTTP ${response.status}, ${type || 'no type'}); solving it here.`,
      );
      return;
    }
    const file = (await response.json()) as ParkFile;
    if (file.build !== __APP_VERSION__) {
      console.warn(
        `Prebuilt park: ${url} belongs to build ${String(file.build)}, this is ${__APP_VERSION__}; solving it here.`,
      );
      return;
    }
    offerParkFile(file);
  } catch (error) {
    console.warn(`Prebuilt park: could not load ${url} (${String(error)}); solving it here.`);
  } finally {
    clearTimeout(timer);
  }
}
