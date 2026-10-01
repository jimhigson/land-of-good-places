/**
 * **`check:client-no-solver` — the built game carries no park solver.**
 *
 * Jim, 24 September 2026: *"there should be no ability to build built into the
 * game as delivered."* `check:procgen-boundary` holds the source to that (no
 * `src/` file imports `procgen/`); this holds **the artefact** to it, because
 * that is what reaches a child's device and a rule about imports is only a
 * proxy for it.
 *
 * It builds the bundle (`vite build`, into a temporary directory) and searches
 * every emitted script for **sentinels**: every string literal of 16 or more
 * characters in `procgen/` that appears nowhere in `src/` — refusal messages,
 * trace lines, error text, which minification leaves intact. Derived, not
 * hand-listed, so a search added to `procgen/` tomorrow is covered the day it
 * lands. Any sentinel in the bundle means solver code shipped; the check names
 * the string and the chunk.
 *
 * **Controls, every run:** there must be enough sentinels to mean something
 * (at least {@link MIN_SENTINELS}), and a string only the game's own hydration
 * path prints ({@link SEEN_CONTROL}) must be found in the bundle — proof the
 * search is reading the real build, not an empty directory.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
/** Fewer than this and the instrument has stopped seeing `procgen/`. */
const MIN_SENTINELS = 100;
/** Printed by `src/world/parkPlan.ts` when a park is hydrated — must be in any real bundle. */
const SEEN_CONTROL = 'hydrated from its prebuilt file';

function filesUnder(dir: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, pattern));
    else if (pattern.test(name)) out.push(path);
  }
  return out;
}

/** Every string literal and template-literal text chunk in a file. */
function strings(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateExpression(node)) {
      out.push(node.head.text);
      for (const span of node.templateSpans) out.push(span.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const srcText = filesUnder(join(root, 'src'), /\.ts$/)
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
const sentinels = [
  ...new Set(
    filesUnder(join(root, 'procgen'), /\.ts$/)
      .flatMap(strings)
      .map((s) => s.trim())
      .filter((s) => s.length >= 16 && !srcText.includes(s)),
  ),
];
if (sentinels.length < MIN_SENTINELS) {
  console.error(
    `check:client-no-solver: CONTROL FAILED — only ${sentinels.length} sentinel string(s) found in procgen/ (need ${MIN_SENTINELS}); the instrument cannot see the solver`,
  );
  process.exit(1);
}

const outDir = mkdtempSync(join(tmpdir(), 'lgp-client-bundle-'));
try {
  execFileSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, LGP_REQUIRE_PARKS: '' },
  });
  const chunks = filesUnder(outDir, /\.js$/);
  const bundle = chunks.map((file) => ({ file: relative(outDir, file), text: readFileSync(file, 'utf8') }));
  if (!bundle.some(({ text }) => text.includes(SEEN_CONTROL))) {
    console.error(`check:client-no-solver: CONTROL FAILED — '${SEEN_CONTROL}' is not in the bundle; the search is not reading the real build`);
    process.exit(1);
  }
  const hits: string[] = [];
  for (const sentinel of sentinels) {
    for (const { file, text } of bundle) if (text.includes(sentinel)) hits.push(`${file}: ${JSON.stringify(sentinel.slice(0, 90))}`);
  }
  if (hits.length > 0) {
    console.error(`check:client-no-solver: ${hits.length} string(s) that exist only in procgen/ are in the client bundle — solver code shipped:`);
    for (const hit of hits.slice(0, 40)) console.error(`  ${hit}`);
    process.exit(1);
  }
  const bytes = bundle.reduce((sum, { text }) => sum + text.length, 0);
  console.log(
    `check:client-no-solver passed: ${chunks.length} chunk(s), ${bytes} bytes of script, none of ${sentinels.length} procgen-only strings present (control '${SEEN_CONTROL}' found)`,
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
