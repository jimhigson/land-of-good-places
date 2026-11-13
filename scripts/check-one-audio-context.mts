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
 * `typeof AudioContext` in a type) are fine. The scan reads the TypeScript
 * AST, so comments and strings never count.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

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

/** True when `node` sits inside a type annotation, so it names a type and never runs. */
const inType = (node: ts.Node): boolean => {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isTypeNode(at)) return true;
    if (ts.isStatement(at) || ts.isSourceFile(at)) return false;
  }
  return false;
};

const fouls: string[] = [];
let ownerRefs = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (!/AudioContext/.test(text)) continue;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const isOwner = relative('.', file) === OWNER;
  const visit = (node: ts.Node): void => {
    // `AudioContext` as a bare identifier, or `.AudioContext` on anything (window, globalThis, a cast).
    const name = ts.isIdentifier(node) ? node.text : null;
    if (name && NAMES.has(name) && !inType(node)) {
      const parent = node.parent;
      // The `webkitAudioContext?:` key in an inline object type is a type, already caught by inType.
      const isPropertyKey = parent && ts.isPropertySignature(parent) && parent.name === node;
      if (!isPropertyKey) {
        if (isOwner) ownerRefs += 1;
        else {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          const statement = text.split('\n')[line]?.trim() ?? '';
          fouls.push(`${relative('.', file)}:${line + 1}: ${statement.slice(0, 110)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
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
