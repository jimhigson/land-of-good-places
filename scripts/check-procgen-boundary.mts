/**
 * **`check:procgen-boundary` — the game never imports the park solver.**
 *
 * Jim, 24 September 2026: *"there should be no ability to build built into the
 * game as delivered."* The searches and the backtracking driver live in
 * `procgen/`; the game (`src/`) reads a park's decisions from its park file and
 * reaches a solver only through `src/world/prebuilt/solverPort.ts`, which the
 * game never fills (`docs/design/PREBUILT-PARKS.md`). This is the dependency
 * rule that keeps it so: **no file under `src/` may import anything under
 * `procgen/`** — statically, dynamically, as a type, or as a re-export. A type
 * import is refused too: the shared types have one owner, in `src/`, and a
 * type pointing the other way is how a value import starts.
 *
 * Its partner `check:client-no-solver` asks the same question of the built
 * bundle; this one names the offending line, that one proves the outcome.
 *
 * **Control, every run:** the detector is first run on a synthetic file with
 * one import of each kind into `procgen/`, and must find all four — so a green
 * run cannot mean a detector that finds nothing.
 *
 * The specifiers are read off the syntax tree (`scripts/ts-ast.mts`: oxc
 * through rolldown, since TypeScript 7 has no JavaScript API).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { forEachNode, lineIndex, parseTypeScript, stringLikeValue, type Node } from './ts-ast.mts';

const root = process.cwd();
const procgen = join(root, 'procgen') + sep;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (/\.(ts|mts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

/** Every module specifier a file names: imports, re-exports, `import()` and `import('x').T` types. */
function specifiers(file: string, text: string): { spec: string; line: number }[] {
  const lineOf = lineIndex(text);
  const out: { spec: string; line: number }[] = [];
  const add = (node: Node, spec: string): void => {
    out.push({ spec, line: lineOf(node.start) + 1 });
  };
  forEachNode(parseTypeScript(file, text), (node) => {
    // Imports of every kind, and re-exports: `export … from` / `export * from`.
    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') {
      add(node, node.source.value);
    } else if (node.type === 'ExportNamedDeclaration' && node.source !== null) {
      add(node, node.source.value);
    } else if (node.type === 'ImportExpression') {
      // `import('x')`, or a backtick string with no `${}`.
      const spec = stringLikeValue(node.source);
      if (spec !== undefined) add(node, spec);
    } else if (node.type === 'TSImportType') {
      // `import('x').T` in a type.
      add(node, node.source.value);
    }
  });
  return out;
}

function violations(file: string, text: string): string[] {
  return specifiers(file, text)
    .filter(({ spec }) => spec.startsWith('.') && resolve(dirname(file), spec).startsWith(procgen))
    .map(({ spec, line }) => `${relative(root, file)}:${line} imports '${spec}'`);
}

// ------------------------------------------------------------------ control
const controlFile = join(root, 'src', 'world', '__control__.ts');
const controlText = [
  "import { createPlanSolver } from '../../procgen/world/planSolver';",
  "import type { SolveStats } from '../../procgen/boot/parkSolve';",
  "export { searchBridgeFootprints } from '../../procgen/world/builtDecisions';",
  "const later = import('../../procgen/install');",
].join('\n');
const caught = violations(controlFile, controlText).length;
if (caught !== 4) {
  console.error(`check:procgen-boundary: CONTROL FAILED — the detector found ${caught} of 4 synthetic imports into procgen/`);
  process.exit(1);
}

// ------------------------------------------------------------------ the rule
const files = filesUnder(join(root, 'src'));
const found = files.flatMap((file) => violations(file, readFileSync(file, 'utf8')));
if (found.length > 0) {
  console.error(`check:procgen-boundary: ${found.length} import(s) from src/ into procgen/ — the game must not carry the solver:`);
  for (const line of found) console.error(`  ${line}`);
  console.error('Move what the game needs into src/ (one owner, both sides import it), or reach the solver through src/world/prebuilt/solverPort.ts.');
  process.exit(1);
}
console.log(`check:procgen-boundary passed: ${files.length} file(s) under src/, none imports procgen/ (control: 4 of 4 synthetic imports caught)`);
