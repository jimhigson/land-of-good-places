/**
 * **Fetching a lazy chunk again, under a URL the browser has not seen.**
 *
 * The other half of `LazyPart`'s retry. A browser keeps a failed `import()`
 * for the life of the page and answers every later `import()` of the same URL
 * with that failure, without a request — so a room whose chunk failed to load
 * once (offline before the service worker had cached it, a dropped connection)
 * could never load again until a reload. QA measured it on #749 in Chromium
 * 151 and WebKit 26.5: three imports, one request.
 *
 * So a retry imports the chunk under a fresh query string. That only recovers
 * the room if the chunk's *own* imports cannot have failed too — the browser
 * would refuse those just the same, and they are named inside the chunk where
 * no query can reach them. `check:boot-chunk` holds that: every lazy chunk
 * imports nothing but the boot's chunks, which are loaded before anything can
 * be entered.
 *
 * The chunk's file name is not known until the bundle is written, so the build
 * writes `lazy-chunks-<version>.json` beside it (`vite.config.ts`'s
 * `lazyChunksPlugin`): every lazy chunk's source path to its file. It is
 * fetched only on a retry — which happens only when the network failed once,
 * and only succeeds once it is back. Named by version, so a page can only ever
 * read the map of its own build.
 */

import { LazyPart } from './LazyPart';

/** The map's file name for this build — one owner for the writer (`vite.config.ts`) and the reader below. */
export function lazyChunkMapFile(version: string): string {
  return `lazy-chunks-${version}.json`;
}

/** Source path (repo-relative, e.g. `src/world/reptileHouse/hall.ts`) → the chunk's file, e.g. `assets/hall-D-qwotGp.js`. */
export type LazyChunkMap = Readonly<Record<string, string>>;

let map: Promise<LazyChunkMap> | null = null;

function chunkMap(): Promise<LazyChunkMap> {
  if (!map) {
    const loading = fetch(`/${lazyChunkMapFile(__APP_VERSION__)}`, { cache: 'no-store' }).then((response) => {
      if (!response.ok) throw new Error(`lazy chunk map: HTTP ${response.status}`);
      return response.json() as Promise<LazyChunkMap>;
    });
    // A failed fetch of the map is forgotten, so the next retry asks again.
    loading.catch(() => {
      if (map === loading) map = null;
    });
    map = loading;
  }
  return map;
}

/**
 * Imports `source`'s chunk again under `?retry=<attempt>-<now>` — a URL the
 * browser has never failed on. In the dev server there is no bundle and every
 * module is served at its source path, so that is the URL.
 */
export async function refetchChunk<T>(source: string, attempt: number): Promise<T> {
  const file = import.meta.env.DEV ? source : (await chunkMap())[source];
  if (!file) throw new Error(`lazy chunk map: no chunk for ${source}`);
  const url = new URL(`/${file}?retry=${attempt}-${Date.now()}`, location.href).href;
  return (await import(/* @vite-ignore */ url)) as T;
}

/**
 * A `LazyPart` for a lazy chunk, retried under a fresh URL after a failure.
 *
 * `source` must be the repo-relative path of the very module `loader`
 * imports — the build's map is keyed by it. `check:boot-chunk` reads every
 * call of this in `src/` and fails if the two disagree, or if the build wrote
 * no chunk for `source`.
 */
export function chunkPart<T>(name: string, source: string, loader: () => Promise<T>): LazyPart<T> {
  return new LazyPart(name, loader, { refetch: (attempt) => refetchChunk<T>(source, attempt) });
}
