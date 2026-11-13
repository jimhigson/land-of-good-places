// @ts-check
/**
 * **What a prebuilt park was solved from, and what its acceptance was measured
 * against** — one hash over exactly the code that can change a park or the
 * verdict on it, and nothing else.
 *
 * That code is an **import closure**, walked from the files that build and
 * judge a park ({@link PARK_SOURCE_ENTRIES}): the solver (`procgen/install.ts`
 * and the boundary's own solver), the build and attempt scripts, the measures
 * (`test/procgen/invariants.ts`, `parkFacts.ts`, `scripts/lib/parkFindings.mts`
 * and every check script the attempt runs), and the `--import` hook. Every
 * relative `import`/`export … from`/`import()` is followed, type-only ones
 * included, and so is every `'scripts/….mts'` string literal (how the
 * attempt names the check scripts it spawns). Plus the toolchain: the
 * dependency fields of `package.json`, `pnpm-lock.yaml` and `.node-version`.
 *
 * **Why a closure and not whole directories.** Hashing all of `src/` made a UI
 * string or a HUD tweak re-solve sixteen parks — 30-45 minutes in front of a
 * deploy that changed nothing a park depends on, the shape of the 29 August
 * outage. A file outside the closure cannot be loaded by any process that
 * builds or judges a park, so it cannot change one.
 *
 * **What would make it miss something**, and why each is guarded:
 * - a dynamic `import()` of a computed specifier — {@link parkSourceClosure}
 *   throws on one inside the closure, so it cannot be added silently;
 * - a data file read with `fs` — none exists in the closure today
 *   (measured: no `readFileSync` under `src/`, `procgen/` or `test/procgen/`
 *   outside the closure's own scripts, which read only their inputs);
 * - a bare (package) import — covered by the lockfile and `package.json`.
 *
 * **It no longer decides whether a park is solved** (13 November 2026, Jim:
 * *"how about if we checked in the result of the solve so we don't have to do
 * it every time?"*). Until then a park was cached under this hash, and since
 * the closure includes render code, a render-only edit re-solved all sixteen
 * parks — 12-30 minutes a seed — for identical decisions. Now the solved parks
 * are **checked in** (`parks/`, `docs/design/PREBUILT-PARKS.md`, "Checked
 * in"), and what keeps one honest is `pnpm run validate:parks`: the current
 * code hydrates the file and asks it every acceptance measure. A change to
 * this hash re-solves nothing. Nothing compares a park against it. What it is
 * still for:
 * - **the runtime save stamp** — `parkStampOf` (`checked-in-parks.mjs`) mixes
 *   it with the placement digest, so `vite build` and the dev server stamp each
 *   served park and a saved position is restored only into the same park built
 *   by the same code;
 * - **`validate:parks`' local skip** — outside CI, a checked-in file already
 *   accepted at byte-identical source is not measured again
 *   (`.cache/lgp-parks-validated/<this hash>/`); and the explicit
 *   `accept:parks` sweep's cache (`acceptanceSourceHash`) builds on it;
 * - **a note** — `build:parks` records it as a manifest line's `solvedUnder`,
 *   which nothing reads back.
 * `node scripts/lib/park-source-hash.mjs` prints it; `--files` lists the
 * closure. Plain JavaScript so that `vite.config.ts` and the scripts can all
 * import the one function.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the closure starts: the files that build a park, or judge one. Repo-relative. */
export const PARK_SOURCE_ENTRIES = [
  'procgen/install.ts',
  'procgen/world/boundaryRadii.ts',
  'scripts/build-parks.mts',
  'scripts/park-file-probe.mts',
  'scripts/park-attempt.mts',
  'scripts/validate-parks.mts',
  'scripts/ts-extension-resolver-register.mjs',
  'test/procgen/invariants.ts',
  'test/procgen/parkFacts.ts',
];

/** Single files hashed beside the closure: the toolchain. */
const TOOLCHAIN_FILES = ['pnpm-lock.yaml', '.node-version'];
/** The `package.json` fields that choose the toolchain (its `scripts` do not build parks). */
const PACKAGE_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'packageManager', 'engines', 'pnpm', 'type'];

const SPECIFIERS =
  /(?:^|[^\w$.])(?:import|export)\s*(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|['"]((?:\.\.?\/)*scripts\/[\w./-]+\.m?[jt]s)['"]/g;

/**
 * @param {string} root
 * @param {string} from
 * @param {string} spec
 * @returns {string | null}
 */
function resolveSpecifier(root, from, spec) {
  if (/^(?:\.\.?\/)*scripts\//.test(spec) && !spec.startsWith('.')) {
    const path = join(root, spec);
    return existsSync(path) ? path : null;
  }
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec.split('?')[0] ?? spec);
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Every file in the closure, repo-relative and sorted.
 * @param {string} root the repository root
 * @returns {string[]}
 */
export function parkSourceClosure(root) {
  /** @type {Set<string>} */
  const seen = new Set();
  const queue = PARK_SOURCE_ENTRIES.map((entry) => join(root, entry));
  while (queue.length > 0) {
    const file = /** @type {string} */ (queue.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.[mc]?[jt]s$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    // Strip line comments before asking about computed imports: prose may say "import(".
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    // `import(NAME)` is followable when NAME is a string constant in the same
    // file: the literal is followed below like any other specifier.
    const constants = new Set([...code.matchAll(/\bconst\s+([A-Z_][A-Z0-9_]*)\s*=\s*['"][^'"]+['"]/g)].map((m) => m[1]));
    const computed = [...code.matchAll(/\bimport\(\s*([A-Za-z_$`][\w$]*)/g)].filter((m) => !constants.has(m[1] ?? ''));
    if (computed.length > 0) {
      throw new Error(
        `park-source-hash: ${relative(root, file)} has an import() of a computed specifier, which the park source closure ` +
          'cannot follow — make it a string literal, or the parks would not be rebuilt when what it loads changes',
      );
    }
    for (const match of text.matchAll(SPECIFIERS)) {
      const spec = match[1] ?? match[2] ?? match[3];
      if (!spec) continue;
      const target = resolveSpecifier(root, file, spec);
      if (target && target.startsWith(root + sep)) queue.push(target);
    }
  }
  return [...seen].map((path) => relative(root, path).split(sep).join('/')).sort();
}

/**
 * @param {string} root the repository root
 * @returns {string} sha256, hex
 */
export function parkSourceHash(root) {
  const hash = createHash('sha256');
  for (const file of [...parkSourceClosure(root), ...TOOLCHAIN_FILES.filter((f) => existsSync(join(root, f)))]) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(join(root, file)));
    hash.update('\0');
  }
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  hash.update(JSON.stringify(PACKAGE_FIELDS.map((field) => [field, pkg[field] ?? null])));
  return hash.digest('hex');
}

// `node scripts/lib/park-source-hash.mjs [--files]` — the CI cache key, or the closure.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  if (process.argv.includes('--files')) console.log(parkSourceClosure(root).join('\n'));
  else console.log(parkSourceHash(root));
}
