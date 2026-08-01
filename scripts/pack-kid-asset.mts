/**
 * **Turns `src/art/assets/kid.glb` into the module the game imports.**
 *
 * ```
 * npm run pack:kid
 * ```
 *
 * Separate from `export:kid` because the `.glb` has two possible authors and
 * only one of them is the code:
 *
 * - `npm run export:kid` writes it from the procedural build. That is Stage A's
 *   bootstrap and will not be needed once Stage B lands.
 * - `npm run blend:kid` writes it from `art/blend/kid.blend`, which is the
 *   authoring source from here on.
 *
 * Either way the file then has to be packed, and the packing is the same. Both
 * commands finish by running this.
 *
 * **Why the asset is a module and not a fetched file.** `createKid` is
 * synchronous and has fifteen callers, five of them Node check scripts and one
 * of them the character creator rebuilding on every tap. An imported module is
 * identical in Node, in Vitest and in the browser, arrives with the code that
 * uses it, and cannot go stale behind a service worker — which on this PWA has
 * already cost hours (CLAUDE.md). It costs about 15 KB gzipped over fetching
 * the `.glb`, and **that trade stops being right at the second authored
 * character**: six of these in the JS bundle is not the same decision as one.
 * When that day comes only `art/models/kidAsset.ts` changes, into a lookup that
 * a preload step fills before the game boots.
 *
 * The actual file-writing and budget check are shared with every other
 * `pack:<asset>` script — see `scripts/lib/pack-glb-asset.mts`, extracted when
 * the Rail Race cart became the second asset through this pipeline.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packGlbAsset } from './lib/pack-glb-asset.mts';

const here = dirname(fileURLToPath(import.meta.url));

packGlbAsset({
  glbPath: resolve(here, '../src/art/assets/kid.glb'),
  modulePath: resolve(here, '../src/art/assets/kidGlb.ts'),
  constantName: 'KID_GLB_BASE64',
  label: 'pack:kid',
  budgetBytes: 150 * 1024,
  docLines: [
    "The player kid's body and head, as authored geometry.",
    '',
    '**Generated — do not edit.** `npm run pack:kid` rebuilds it from',
    '`kid.glb`, which is itself written by `npm run blend:kid` (from',
    '`art/blend/kid.blend`) or, for the Stage A bootstrap, by',
    '`npm run export:kid`. See `scripts/pack-kid-asset.mts` for why the',
    'bytes are imported rather than fetched.',
  ],
});
