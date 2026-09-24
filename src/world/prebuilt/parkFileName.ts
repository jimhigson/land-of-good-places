/**
 * **Where a prebuilt park lives, and which shape it is** — the dependency-free
 * half of `parkFile.ts`, so that `vite.config.ts` (which emits the files), the
 * boot (which fetches them) and `scripts/build-parks.mts` (which writes them)
 * all ask one owner rather than each spelling the path.
 *
 * See `docs/design/PREBUILT-PARKS.md`.
 */

/**
 * The shape of a park file. **Bump it on any change to what `parkFile.ts`
 * writes or reads**: a file of another format is discarded by the client and
 * the park is solved instead, so a bump can cost a slow boot but never a
 * wrong park.
 */
export const PARK_FILE_FORMAT = 1;

/**
 * **The seeds this game has: 0 to 15.** Jim, 24 September 2026: *"we only
 * support seeds 0..15, no others."* The one owner of that range —
 * `parkSeedPool.ts`'s `PARK_SEED_POOL` is this list, and `vite.config.ts`'s
 * dev park server reads it from here because this module imports nothing.
 */
export const SUPPORTED_PARK_SEEDS: readonly number[] = Array.from({ length: 16 }, (_, seed) => seed);

/** The directory park files are served from, relative to the site root. */
export const PARK_FILE_DIR = 'parks';

/** The path of one seed's park file, relative to the site root. */
export function parkFileName(seed: number): string {
  return `${PARK_FILE_DIR}/${seed}.json`;
}

/**
 * Where `pnpm run build:parks` writes park files, relative to the repository
 * root, for `vite build` to ship. Not tracked: a committed copy of the
 * generator's output would be a second definition of every park, kept in step
 * by hand.
 */
export const PREBUILT_PARKS_OUT = '.parks';

/** The manifest `build:parks` writes beside the files — see {@link PrebuiltParksManifest}. */
export const PREBUILT_PARKS_MANIFEST = 'manifest.json';

/** What `build:parks` solved, and from what source. */
export interface PrebuiltParksManifest {
  readonly format: number;
  /** `scripts/lib/park-source-hash.mjs` of the tree the parks were solved from. */
  readonly sourceHash: string;
  readonly seeds: readonly number[];
  /** Each seed's proven whole-park digest (`scripts/lib/parkDigest.mts`). */
  readonly digests: Readonly<Record<string, string>>;
}
