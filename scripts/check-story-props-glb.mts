/**
 * **`check:story-props-glb` — is the story-props kit that ships the one the
 * build wrote, and does the game's reader read it the way three.js does?**
 *
 * ```
 * pnpm run check:story-props-glb
 * ```
 *
 * The four questions, and why they are asked of the bytes rather than trusted,
 * are `scripts/lib/check-glb-kit.mts`'s — the one body `check:library-glb`
 * runs too. This file only names the kit: `art/blend/story_props_build.py` →
 * `storyProps.glb` → `pack:story-props` → `storyPropsGlb.ts` (`STORY_FACES`).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORY_FACES, STORY_PROPS_GLB_BASE64 } from '../src/art/assets/storyPropsGlb.ts';
import { checkGlbKit } from './lib/check-glb-kit.mts';

const here = dirname(fileURLToPath(import.meta.url));

await checkGlbKit({
  label: 'check:story-props-glb',
  title: 'the story-props kit as it ships',
  glbPath: resolve(here, '../src/art/assets/storyProps.glb'),
  fileName: 'storyProps.glb',
  moduleName: 'storyPropsGlb.ts',
  base64: STORY_PROPS_GLB_BASE64,
  faces: STORY_FACES,
  facesName: 'STORY_FACES',
  packScript: 'pnpm run pack:story-props',
  closing: 'The story-props kit ships as built, and both readers read it the same.',
});
