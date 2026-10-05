/**
 * **No `**` in park code except an exact square.**
 *
 * ```
 * pnpm run check:pow-operator
 * ```
 *
 * Every park is generated with `src/core/deterministicMath.ts` on the global
 * `Math`, because V8's own transcendental functions give different bits on
 * x64 and arm64, and an ulp was enough to grow a different park on five of
 * sixteen seeds. The `**` operator is the one door that port cannot close: V8
 * compiles it to its native pow, whatever is installed on `Math`. Measured, it
 * differs between the platforms like `Math.pow` did (the `powOp` row of
 * `scripts/math-determinism.mts`). Only `x ** 2` is safe, because pow(x, 2) is
 * computed as the exact `x * x`.
 *
 * So under the directories that decide a park, any `**` (or `**=`) whose
 * exponent is not the literal `2` fails here, with its file and line. Write
 * `Math.pow(x, y)` instead. The scan reads the TypeScript AST, not text, so a
 * `**` in a comment or a string is not one.
 *
 * Raised by the #706 review: "nothing guards future uses".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/** Where a park is decided. Rendering-only code (art, ui, minigames) is not. */
const ROOTS = ['src/world', 'src/boot', 'src/core', 'src/entities'];

const files: string[] = [];
const walk = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|mts)$/.test(name) && !name.endsWith('.d.ts')) files.push(path);
  }
};
for (const root of ROOTS) walk(root);

const fouls: string[] = [];
let squares = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.AsteriskAsteriskToken || op === ts.SyntaxKind.AsteriskAsteriskEqualsToken) {
        const right = node.right;
        const exactSquare = op === ts.SyntaxKind.AsteriskAsteriskToken && ts.isNumericLiteral(right) && right.text === '2';
        if (exactSquare) squares += 1;
        else {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          fouls.push(`${relative('.', file)}:${line + 1}: ${node.getText().slice(0, 100)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (fouls.length > 0) {
  console.error(
    `check:pow-operator FAILED — ${fouls.length} use(s) of \`**\` with an exponent other than the literal 2 ` +
      `under ${ROOTS.join(', ')}. V8's native pow gives different bits on x64 and arm64; write Math.pow(x, y), ` +
      'which goes through src/core/deterministicMath.ts:',
  );
  for (const foul of fouls) console.error(`  ${foul}`);
  process.exit(1);
}
console.log(
  `check:pow-operator ok — ${files.length} files under ${ROOTS.join(', ')}; ${squares} \`** 2\` (exact), no other \`**\`.`,
);
