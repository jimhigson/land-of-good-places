/**
 * **How `scripts/` reads TypeScript source as a syntax tree. The one owner.**
 *
 * Six checks look at the code rather than run it: `check:pow-operator`,
 * `check:one-audio-context`, `check:flat-primitives`, `check:cycle-tdz`,
 * `check:procgen-boundary` and `check:client-no-solver`. They used to call
 * TypeScript's compiler API (`ts.createSourceFile`). TypeScript 7 is a native
 * binary with no JavaScript API, and since 14 November 2026 it is the only
 * TypeScript in this repo (Jim: "ok let's use 7.1 everywhere then"). So they
 * parse with oxc, through the copy Vite already installs: rolldown's
 * `parseAst`. `rolldown` is a devDependency pinned to exactly the version Vite
 * resolves, so it is the same package on disk, not a second parser. When Vite
 * moves to a new rolldown, move the pin with it.
 *
 * The tree is ESTree with TypeScript's additions (what typescript-eslint calls
 * TS-ESTree), not TypeScript's own. Where the two shapes differ in a way the
 * checks can see, this file absorbs the difference, so each check still reads
 * like the TypeScript version it replaced, and reports what it reported:
 *
 * - **Parentheses are kept** (`preserveParens: true`). TypeScript's tree keeps
 *   a ParenthesizedExpression, so `x ** (2)` is not the literal `x ** 2`.
 *   `parseAst` drops them by default, and defaults to `lang: 'js'` whatever
 *   the filename says, so {@link parseTypeScript} always passes both.
 * - **Optional chains get a wrapper.** ESTree puts `a?.y` inside a
 *   `ChainExpression`; TypeScript has no such node and flags the access itself.
 *   {@link unchain} looks through it wherever a check asks what kind of
 *   expression an operand is. Without it `a?.y - b.y` would quietly stop being
 *   a y difference, which is the direction a ported check must never drift.
 * - **A shorthand name is one node, not two.** `{ a }` is a key node and a value
 *   node over the same text in ESTree and a single name in TypeScript; so are
 *   `import { a }` and `export { a }`. {@link childrenOf} yields it once, so
 *   nothing is counted twice.
 * - **An annotated binding's span includes its annotation.** The declarator
 *   `x: number = 1` has an `id` whose text is `x: number`. Read `id.name`, never
 *   the span; {@link bindingText} does that for patterns too.
 * - **Line numbers count line breaks as TypeScript did** (LF, CR, CRLF, U+2028,
 *   U+2029), so every reported `file:line` is unchanged.
 * - **A syntax error throws** (`PARSE_ERROR`, with the file and a code frame).
 *   TypeScript returned a best-effort tree and the checks never read its
 *   diagnostics, so a file that did not parse used to be scanned in part, in
 *   silence. A check that cannot read a file should say so, and now it does.
 *
 * Offsets are UTF-16 code units, i.e. ordinary string indices, so
 * `text.slice(node.start, node.end)` is exactly the node's source. This repo's
 * comments are full of em-dashes, so that was measured, not assumed.
 */
import { parseAst } from 'rolldown/parseAst';
import type { ESTree } from 'rolldown/utils';

export type Node = ESTree.Node;
export type Program = ESTree.Program;

/** What every node has, which is all the generic walk below relies on. */
export interface Spanned {
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

/** Parse a `.ts`/`.mts`/`.tsx` file. Throws, naming the file, if it does not parse. */
export function parseTypeScript(file: string, text: string): Program {
  return parseAst(text, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts', preserveParens: true }, file);
}

const isNode = (value: unknown): value is Spanned =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';

const sameSpan = (a: unknown, b: unknown): boolean =>
  isNode(a) && isNode(b) && a.start === b.start && a.end === b.end;

/**
 * The child nodes of `node`, in source order: the ESTree counterpart of
 * `ts.forEachChild`. Type annotations are children like anything else, as they
 * were in TypeScript's tree.
 */
export function childrenOf(node: Spanned): Spanned[] {
  const fields = node as unknown as Record<string, unknown>;
  // The duplicates: one name in TypeScript's tree, two nodes over one span here.
  let skip: string | undefined;
  if (node.type === 'Property' && fields['shorthand'] === true) skip = 'key';
  else if (node.type === 'ImportSpecifier' && sameSpan(fields['imported'], fields['local'])) skip = 'imported';
  else if (node.type === 'ExportSpecifier' && sameSpan(fields['local'], fields['exported'])) skip = 'exported';

  const out: Spanned[] = [];
  for (const key in fields) {
    // `hashbang` is trivia to TypeScript, never a node.
    if (key === 'type' || key === 'hashbang' || key === skip) continue;
    const value = fields[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    } else if (isNode(value)) out.push(value);
  }
  // oxc emits fields in source order for every node this repo has needed, but
  // the order is what decides which of two findings is reported first, so do
  // not depend on it: sort (stably) whenever it is not already ordered.
  for (let i = 1; i < out.length; i += 1) {
    if (out[i]!.start < out[i - 1]!.start) return out.sort((a, b) => a.start - b.start);
  }
  return out;
}

/**
 * Visit `root` and everything under it, parents before children, in source
 * order, as `ts.forEachChild` recursion did. `enter` gets the node and its
 * ancestors (nearest last); return `false` to skip the node's children.
 */
export function forEachNode(root: Spanned, enter: (node: Node, ancestors: readonly Node[]) => boolean | void): void {
  const ancestors: Node[] = [];
  const visit = (node: Spanned): void => {
    if (enter(node as Node, ancestors) === false) return;
    ancestors.push(node as Node);
    for (const child of childrenOf(node)) visit(child);
    ancestors.pop();
  };
  visit(root);
}

/** `a?.b` is a ChainExpression around the access; TypeScript's tree has the access itself. */
export function unchain(node: Node): Node {
  return node.type === 'ChainExpression' ? (node.expression as Node) : node;
}

/** The source text of a node. */
export function textOf(text: string, node: Spanned): string {
  return text.slice(node.start, node.end);
}

/**
 * The text of a binding name without its type annotation: `x` for `x: number`,
 * `{ a, b }` for `{ a, b }: T`. TypeScript's `name.getText()`, in other words.
 */
export function bindingText(text: string, id: Spanned): string {
  const fields = id as unknown as { name?: unknown; typeAnnotation?: Spanned | null };
  if (id.type === 'Identifier' && typeof fields.name === 'string') return fields.name;
  return text.slice(id.start, fields.typeAnnotation?.start ?? id.end).trimEnd();
}

/**
 * A function from offset to 0-based line, breaking lines exactly where
 * TypeScript's `getLineAndCharacterOfPosition` did: LF, CR, CRLF, U+2028 and
 * U+2029.
 */
export function lineIndex(text: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) i += 1;
      starts.push(i + 1);
    } else if (c === 10 || c === 0x2028 || c === 0x2029) starts.push(i + 1);
  }
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
}

/**
 * The string a literal spells, if it is a string or a template with no
 * `${}`: TypeScript's `isStringLiteralLike(node) ? node.text : undefined`.
 */
export function stringLikeValue(node: Node): string | undefined {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0]?.value.cooked ?? undefined;
  return undefined;
}
