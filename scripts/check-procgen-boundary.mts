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
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

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
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: { spec: string; line: number }[] = [];
  const add = (node: ts.Node, spec: string): void => {
    out.push({ spec, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
  };
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node, node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) add(node, arg.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      add(node, node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
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
