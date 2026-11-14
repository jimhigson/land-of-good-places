/**
 * **One `AudioContext`, and only `src/core/audio.ts` makes it.**
 *
 * ```
 * pnpm run check:one-audio-context
 * ```
 *
 * `new AudioContext()` blocks the main thread for ~150 ms: it opens the audio
 * device, and nothing about when it runs makes it cheaper. Six sound modules
 * once built a private context each, lazily, on their first sound and inside
 * a frame, which gave six separate 150 ms hitches. The worst landed mid-play
 * when a wild puff sang (step 9 of `docs/perf/FRAME-DROPS-2026-11.md`, #753).
 * `core/audio.ts` now builds the one context at boot and every sound asks it
 * for that context with `audioContext()`.
 *
 * The easy way to undo that is to copy the old self-contained pattern into a
 * new sound file, so this fails on **any value-position reference** to
 * `AudioContext` or `webkitAudioContext` anywhere under `src/` outside
 * `core/audio.ts`. That covers `new AudioContext()`, `new window.AudioContext()`,
 * and `const Ctor = window.AudioContext ?? …; new Ctor()`, which is how every
 * one of the six was written. Type positions (`AudioContext | null`,
 * `typeof AudioContext` in a type) are fine. The scan reads the syntax tree,
 * so comments and strings never count. (`scripts/ts-ast.mts` owns the parsing:
 * oxc through rolldown, since TypeScript 7 has no JavaScript API.)
 *
 * One deliberate difference from the TypeScript-API version this replaced:
 * TypeScript's tree files `class X extends AudioContext` and the instantiation
 * expression `AudioContext<T>` under a type node (ExpressionWithTypeArguments),
 * so that version never saw them. Both are value references, a subclass
 * constructs the context all the same, and ESTree has them as plain
 * expressions, so this one reports them. Neither occurs in `src/`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { forEachNode, lineIndex, parseTypeScript, type Node } from './ts-ast.mts';

const ROOT = 'src';
const OWNER = ['src', 'core', 'audio.ts'].join(sep);
const NAMES = new Set(['AudioContext', 'webkitAudioContext']);

const files: string[] = [];
const walk = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|mts|tsx)$/.test(name) && !name.endsWith('.d.ts')) files.push(path);
  }
};
walk(ROOT);

/**
 * The nodes that are types: TypeScript's `isTypeNode`, in ESTree's names. The
 * heritage clauses (`implements I`, an interface's `extends I`) are types there
 * too; a class's `extends X` is not, see the header.
 */
const TYPE_NODES = new Set([
  'TSTypeAnnotation', 'TSTypeReference', 'TSTypeQuery', 'TSTypeLiteral', 'TSTypePredicate', 'TSFunctionType',
  'TSConstructorType', 'TSArrayType', 'TSTupleType', 'TSOptionalType', 'TSRestType', 'TSUnionType',
  'TSIntersectionType', 'TSConditionalType', 'TSInferType', 'TSParenthesizedType', 'TSThisType',
  'TSTypeOperator', 'TSIndexedAccessType', 'TSMappedType', 'TSLiteralType', 'TSNamedTupleMember',
  'TSTemplateLiteralType', 'TSImportType', 'TSClassImplements', 'TSInterfaceHeritage', 'TSAnyKeyword',
  'TSUnknownKeyword', 'TSNumberKeyword', 'TSBigIntKeyword', 'TSObjectKeyword', 'TSBooleanKeyword',
  'TSStringKeyword', 'TSSymbolKeyword', 'TSVoidKeyword', 'TSUndefinedKeyword', 'TSNullKeyword',
  'TSNeverKeyword', 'TSIntrinsicKeyword', 'TSJSDocNullableType', 'TSJSDocNonNullableType', 'TSJSDocUnknownType',
]);
/** The declarations that are statements, besides every `*Statement`: TypeScript's `isStatement`. */
const DECLARATION_STATEMENTS = new Set([
  'VariableDeclaration', 'FunctionDeclaration', 'ClassDeclaration', 'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSModuleDeclaration', 'ImportDeclaration',
  'TSImportEqualsDeclaration', 'ExportNamedDeclaration', 'ExportDefaultDeclaration', 'ExportAllDeclaration',
  'TSExportAssignment', 'TSNamespaceExportDeclaration',
]);

/** True when a node under these ancestors sits inside a type annotation, so it names a type and never runs. */
const inType = (ancestors: readonly Node[]): boolean => {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const at = ancestors[i]!.type;
    if (TYPE_NODES.has(at)) return true;
    if (at.endsWith('Statement') || DECLARATION_STATEMENTS.has(at) || at === 'Program') return false;
  }
  return false;
};

const fouls: string[] = [];
let ownerRefs = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (!/AudioContext/.test(text)) continue;
  const lineOf = lineIndex(text);
  const isOwner = relative('.', file) === OWNER;
  forEachNode(parseTypeScript(file, text), (node, ancestors) => {
    // `AudioContext` as a bare identifier, or `.AudioContext` on anything (window, globalThis, a cast).
    const name = node.type === 'Identifier' ? node.name : null;
    if (name && NAMES.has(name) && !inType(ancestors)) {
      const parent = ancestors[ancestors.length - 1];
      // The `webkitAudioContext?:` key in an inline object type is a type, already caught by inType.
      const isPropertyKey = parent?.type === 'TSPropertySignature' && parent.key === node;
      if (!isPropertyKey) {
        if (isOwner) ownerRefs += 1;
        else {
          const line = lineOf(node.start);
          const statement = text.split('\n')[line]?.trim() ?? '';
          fouls.push(`${relative('.', file)}:${line + 1}: ${statement.slice(0, 110)}`);
        }
      }
    }
  });
}

if (fouls.length > 0) {
  console.error(
    `check:one-audio-context FAILED: ${fouls.length} reference(s) to the AudioContext constructor outside ${OWNER}. ` +
      'Each new context blocks the main thread for ~150 ms. Use `audioContext()` from src/core/audio.ts instead:',
  );
  for (const foul of fouls) console.error(`  ${foul}`);
  process.exit(1);
}
if (ownerRefs === 0) {
  // If the owner stops constructing, this check would pass vacuously. Say so loudly instead.
  console.error(`check:one-audio-context FAILED: ${OWNER} no longer references AudioContext. Has the owner moved?`);
  process.exit(1);
}
console.log(
  `check:one-audio-context ok: ${files.length} files under ${ROOT}/, ${ownerRefs} constructor reference(s), all in ${OWNER}.`,
);
