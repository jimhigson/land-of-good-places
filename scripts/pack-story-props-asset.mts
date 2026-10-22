/**
 * **Turns `src/art/assets/storyProps.glb` into the module the game imports.**
 *
 * ```
 * pnpm run pack:story-props
 * ```
 *
 * The story-props kit's counterpart to `pack-library-asset.mts`:
 * `art/blend/story_props_build.py` writes `story_props.blend`,
 * `story_props_export.py` writes the `.glb`, and `pnpm run blend:story-props`
 * runs the three steps in order. This is always the last of them.
 *
 * See `pack-kid-asset.mts` for why an asset ships as an imported module rather
 * than a fetched file, and `scripts/lib/pack-glb-asset.mts` for the
 * file-writing and budget check every `pack:<asset>` script shares.
 *
 * **One thing this packer adds: `STORY_FACES`**, exactly as `pack:library` adds
 * `LIBRARY_FACES`. The build measures the figures a face painter needs on each
 * faced node (`face_eyes_uv`, `face_window_m`) and the export ships them as
 * glTF node `extras`. They are copied out of the `.glb` here, verbatim, into a
 * typed constant beside the bytes — so the loader imports them rather than
 * typing them. `check:story-props-glb` asserts the constant still equals the
 * file's extras.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packGlbAsset } from './lib/pack-glb-asset.mts';

const here = dirname(fileURLToPath(import.meta.url));
const glbPath = resolve(here, '../src/art/assets/storyProps.glb');
const modulePath = resolve(here, '../src/art/assets/storyPropsGlb.ts');

packGlbAsset({
  glbPath,
  modulePath,
  constantName: 'STORY_PROPS_GLB_BASE64',
  label: 'pack:story-props',
  /**
   * 480 KB: thirty-one picture props, 17 152 triangles and 447 KB on the day
   * it landed (the library's whole building plus furniture plus three
   * creatures is 450 KB for 18 568). The heavy ones are the forty-one-sandwich
   * heap, the sixteen-sandwich tower, the six rainbow bands and the toy ferris
   * wheel; everything else is a few KB. Boxes and wedges cost ~25 B a
   * triangle here (every crisp edge splits a vertex), smooth blobs ~19.
   */
  budgetBytes: 480 * 1024,
  docLines: [
    '**The story-props kit, as authored geometry.** Do not edit — generated.',
    '',
    'Written by `pnpm run blend:story-props`, which runs',
    '`art/blend/story_props_build.py` (the authoring source), then',
    '`story_props_export.py`, then this packer.',
    '',
    // No count here: the list is the enumeration, and a typed number beside it
    // was wrong on the day it was written (the library packer's lesson).
    "Every model the six chapter books' pictures need that the game had no model",
    'for — Nimbus the storm cloud, a faceless fluffy cloud, the Rail Race\'s finish',
    'rainbow, queue posts and rope, the rubber duck, a park bench, a magnifying',
    'glass, two kinds of footprint, a spoon, a flat stone, a stick, an open book, a',
    'loose page, the closed storybook, a flower and a petal, a picnic blanket,',
    'sandwiches singly and in a tower and a heap of forty-one, a jam tart, a cake, a',
    'puddle, a window frame, an inside-out umbrella, a castle battlement, a toy',
    'ferris wheel, a feather, a twig nest and a biscuit to eat. Each is its own',
    'asset with its own base-centred origin, so inside this file they all overlap',
    'at the world origin, which is expected and harmless.',
    '',
    "Shape only: no colour, no material, no texture. Nimbus's face puff and the",
    "duck's head carry face UVs, painted through a default `CanvasTexture`",
    '(`planarUvCanvasTexture`), never `glbCanvasTexture`.',
  ],
});

// ------------------------------------------------- the face figures, verbatim

const bytes = readFileSync(glbPath);
const jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as {
  nodes?: { name?: string; extras?: Record<string, unknown> }[];
};
const faces = (json.nodes ?? [])
  .filter((node) => node.name && node.extras && 'face_eyes_uv' in node.extras)
  .map((node) => [node.name as string, node.extras as Record<string, unknown>] as const)
  .sort(([a], [b]) => a.localeCompare(b));
if (faces.length === 0) {
  console.error('\n✗ pack:story-props: no node in storyProps.glb carries face_eyes_uv — was it exported with extras?\n');
  process.exit(1);
}
const keys = ['face_eyes_uv', 'face_window_m', 'face_rim_uv'] as const;
const entries = faces.map(([name, extras]) => {
  const fields = keys
    .filter((key) => key in extras)
    .map((key) => `${key}: ${JSON.stringify(extras[key]).replace(/,/g, ', ')}`)
    .join(', ');
  return `  '${name}': { ${fields} },`;
});
const block = [
  '',
  '/**',
  ' * The figures a face painter needs, per faced node — measured off the geometry',
  " * by `art/blend/story_props_build.py` and copied verbatim out of the `.glb`'s",
  ' * node `extras` by `pack:story-props`. Never typed; `check:story-props-glb`',
  " * asserts they still equal the file's. The same shape as `LIBRARY_FACES`.",
  ' */',
  'export interface StoryFaceFigures {',
  "  /** The two eye centres `[uL, vL, uR, vR]` as canvas fractions from the top-left; `L` is the creature's own left (+X). */",
  '  readonly face_eyes_uv: readonly [number, number, number, number];',
  "  /** The canvas's `[width, height]` in metres — to paint a round eye round. */",
  '  readonly face_window_m: readonly [number, number];',
  '  /** A rim the eyes must sit inside, as `[fraction of width, fraction of height]` — none of these faces has one. */',
  '  readonly face_rim_uv?: readonly [number, number];',
  '}',
  '',
  `export const STORY_FACES: Readonly<Record<${faces.map(([n]) => `'${n}'`).join(' | ')}, StoryFaceFigures>> = {`,
  ...entries,
  '};',
  '',
].join('\n');
writeFileSync(modulePath, readFileSync(modulePath, 'utf8') + block);
console.log(`  STORY_FACES: ${faces.map(([n]) => n).join(', ')} — copied from the .glb's extras\n`);
