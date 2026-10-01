// @ts-check
/**
 * **What a prebuilt park was solved from, and what its acceptance was measured
 * against** — one hash over every input that can change a park or the verdict
 * on it:
 *
 * - the game (`src/`) and the generator (`procgen/`), which build it;
 * - the measures that accept or reject it — `test/procgen/` (the invariants,
 *   `parkFacts.ts`) and `scripts/` (`park-attempt.mts`, `lib/parkFindings.mts`);
 * - `package.json` (the Node and three.js the solve ran under are pinned
 *   through it) and `pnpm-lock.yaml`.
 *
 * `scripts/build-parks.mts` writes it into `.parks/manifest.json`, and
 * `vite.config.ts` recomputes it before shipping those files: a park solved
 * from any other source is not shipped (`docs/design/PREBUILT-PARKS.md`).
 * Plain JavaScript so that both — a Node script and the Vite config — can
 * import the one function.
 *
 * Deliberately coarse: an edit to a HUD file changes the hash too, and costs a
 * re-solve. Narrowing it to "the generator's files" would need a second list
 * of which files those are, kept in step by hand, and the first file it missed
 * would ship a park solved by other code.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** The directories hashed whole, relative to the repository root. */
export const PARK_SOURCE_DIRS = ['src', 'procgen', 'test/procgen', 'scripts'];
/** The single files hashed beside them. */
export const PARK_SOURCE_FILES = ['package.json', 'pnpm-lock.yaml'];

/** @param {string} dir @returns {string[]} */
function filesUnder(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

/**
 * @param {string} root the repository root
 * @returns {string} sha256, hex
 */
export function parkSourceHash(root) {
  const files = [
    ...PARK_SOURCE_DIRS.flatMap((dir) => filesUnder(join(root, dir))),
    ...PARK_SOURCE_FILES.map((file) => join(root, file)),
  ]
    .map((path) => relative(root, path).split(sep).join('/'))
    .sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(root, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}
