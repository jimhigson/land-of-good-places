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
 * `Math.pow(x, y)` instead. The scan reads the syntax tree, not text, so a
 * `**` in a comment or a string is not one. (`scripts/ts-ast.mts` owns the
 * parsing: oxc through rolldown, since TypeScript 7 has no JavaScript API.)
 *
 * Raised by the #706 review: "nothing guards future uses".
 *
 * **Proved red, 14 November 2026,** when it moved to oxc (main at 27e570b3), by
 * appending three lines to `src/core/constants.ts`, then 1491 lines long:
 *
 *     export const __PROBE_POW = 2 ** 3;
 *     export let __probePow = 1; __probePow **= 2;
 *     export const __PROBE_POW_PAREN = 3 ** (2);
 *
 * Exit 1, and output identical to the TypeScript-API version's on the same input:
 *
 *     check:pow-operator FAILED — 3 use(s) of `**` with an exponent other than the literal 2 under …
 *       src/core/constants.ts:1493: 2 ** 3
 *       src/core/constants.ts:1494: __probePow **= 2
 *       src/core/constants.ts:1495: 3 ** (2)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { forEachNode, lineIndex, parseTypeScript, textOf } from './ts-ast.mts';

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
  const lineOf = lineIndex(text);
  forEachNode(parseTypeScript(file, text), (node) => {
    // `x ** y` is a BinaryExpression and `x **= y` an AssignmentExpression.
    const pow =
      (node.type === 'BinaryExpression' && node.operator === '**') ||
      (node.type === 'AssignmentExpression' && node.operator === '**=');
    if (!pow) return;
    // The literal 2 however it is spelt (`2`, `2.0`, `0x2`), as TypeScript's
    // `text === '2'` was. A parenthesised `(2)` is not a literal, and still fails.
    const right = node.right;
    const exactSquare = node.operator === '**' && right.type === 'Literal' && right.value === 2;
    if (exactSquare) squares += 1;
    else fouls.push(`${relative('.', file)}:${lineOf(node.start) + 1}: ${textOf(text, node).slice(0, 100)}`);
  });
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
