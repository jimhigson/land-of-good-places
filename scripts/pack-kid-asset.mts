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
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const GLB = resolve(here, '../src/art/assets/kid.glb');
const MODULE = resolve(here, '../src/art/assets/kidGlb.ts');

/** Jim's ruling, 31 July 2026: ~150 KB per character for the exported asset. */
const BUDGET_BYTES = 150 * 1024;

const bytes = readFileSync(GLB);
const base64 = bytes.toString('base64');

writeFileSync(
  MODULE,
  `/**\n` +
    ` * The player kid's body and head, as authored geometry.\n` +
    ` *\n` +
    ` * **Generated — do not edit.** \`npm run pack:kid\` rebuilds it from\n` +
    ` * \`kid.glb\`, which is itself written by \`npm run blend:kid\` (from\n` +
    ` * \`art/blend/kid.blend\`) or, for the Stage A bootstrap, by\n` +
    ` * \`npm run export:kid\`. See \`scripts/pack-kid-asset.mts\` for why the\n` +
    ` * bytes are imported rather than fetched.\n` +
    ` *\n` +
    ` * ${bytes.length} bytes.\n` +
    ` */\n` +
    `export const KID_GLB_BASE64 =\n  '${base64}';\n`,
);

const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`;

console.log(`\npack:kid`);
console.log(`  ${GLB}`);
console.log(`  ${kb(bytes.length)} on disk, ${kb(gzipSync(bytes).length)} gzipped`);
console.log(
  `  ${kb(base64.length)} as a module, ${kb(gzipSync(Buffer.from(base64)).length)} gzipped`,
);

if (bytes.length > BUDGET_BYTES) {
  console.error(
    `\n✗ ${kb(bytes.length)} is over the ${kb(BUDGET_BYTES)} per-character budget.\n`,
  );
  process.exit(1);
}
console.log(`  within the ${kb(BUDGET_BYTES)} budget\n`);
