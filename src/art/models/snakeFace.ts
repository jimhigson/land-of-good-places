import type { CanvasTexture } from 'three';
import { ART } from '../style/artPalette';
import { planarUvCanvasTexture } from '../style/glb';
import { markShared } from '../style/materials';
import { paintFace, type FacePaintOptions } from '../style/faces';

/**
 * **One face for every snake in the park.**
 *
 * Three authored heads share one UV contract — the `creatures` kit's
 * `rr-snake-head`, Noodle's `rn-head` and Sunny's `rh-head` (the building):
 * front faces take `u` across the head's full width and `v` down its full
 * height, back faces are parked at (0.02, 0.02). So one canvas fits all three,
 * and every snake from a 0.3 m hatchling to the ten-metre building wears the
 * same smile — which is the point: the babies are *Noodle's* babies, and the
 * house is a snake because the snakes are.
 *
 * **Right way up by the kits' own convention.** All three heads are authored
 * with `v = (hi_z − z) / h` (the gate arch's `paint_planar_uvs` recipe), so
 * `v` climbs with height once the `.glb` is read and the canvas has to be
 * flipped on upload — `planarUvCanvasTexture`, never `glbCanvasTexture`.
 * Painted through the latter (as it was until 2 October 2026) the mouth sat
 * above the eyes on every snake in the park; `check:reptile-house`'s
 * painted-faces clause now reads the UVs and the flip together.
 *
 * The features are **ink on an opaque white fill**, so `MeshToonMaterial`'s
 * own `color` tints the whole head: a mint snake gets mint skin and dark-mint
 * ink, a coral one coral, with no canvas per colourway. The top-left pixel
 * is plain fill — the parked back faces sample it, so the nape of every head
 * shows skin colour and nothing else.
 *
 * Painted once, cached, `markShared` so `disposeTree` on a nursery baby cannot
 * free the face every other snake is wearing. Five textures, one canvas each —
 * the whole snake population's share of ASSET_MANIFEST's texture budget.
 */
export type SnakeExpression = 'neutral' | 'blink' | 'happy' | 'surprised' | 'asleep';

/** Canvas aspect: the three heads are 1.13–1.19 wide for their height. */
const WIDTH = 512;
const HEIGHT = 448;

/**
 * Where the features sit, as fractions of the canvas — the Artist's suggested
 * eyes at (0.30, 0.42) / (0.70, 0.42) and smile at (0.50, 0.72), so the face
 * lands on the front of the snout rather than up on the crown.
 */
const LAYOUT: FacePaintOptions = {
  size: 512,
  eyeY: 0.42,
  eyeGap: 0.4,
  eyeW: 0.11,
  eyeH: 0.15,
  mouth: 'cat',
  mouthW: 0.085,
  mouthDrop: 0.3,
  blush: ART.blush,
  blushStyle: 'soft',
  blushR: 0.08,
};

/**
 * Where the eyes and the smile sit, as fractions of the canvas from its top
 * row — `check:reptile-house` reads a painted head's UVs against these to
 * assert the eyes come out above the smile on the mesh.
 */
export const SNAKE_FACE_ROWS = { eye: LAYOUT.eyeY!, mouth: LAYOUT.eyeY! + LAYOUT.mouthDrop! } as const;

/**
 * **Sunny's face — the building's.** Her mouth is not painted: it is the
 * doorway, a bore through `rh-head` lined by `rh-mouth` (Jim, 2 October
 * 2026: *"the door as its mouth"*). So her canvas carries eyes and blush
 * only, and the eyes sit high — the head's UVs span its whole height,
 * two metres of which is sunk into the ground under the chin, and the lips'
 * top is 4.3 m up a 6 m head. `art/blend/reptile_house_build.py` reads
 * {@link SUNNY_FACE_EYE_ROW} (a plain literal, for `ts_const`) and asserts
 * the row lands above the lips on the built mesh; `check:reptile-house`
 * reads it against the shipped UVs.
 */
export const SUNNY_FACE_EYE_ROW = 0.13;

const SUNNY_LAYOUT: FacePaintOptions = {
  size: 512,
  eyeY: SUNNY_FACE_EYE_ROW,
  eyeGap: 0.46,
  eyeW: 0.11,
  eyeH: 0.14,
  mouth: 'none',
  blush: ART.blush,
  blushStyle: 'soft',
  blushR: 0.09,
};

const SUNNY_PAINTS: Readonly<Record<SnakeExpression, FacePaintOptions>> = {
  neutral: { ...SUNNY_LAYOUT, eyeStyle: 'open' },
  blink: { ...SUNNY_LAYOUT, eyeStyle: 'closedHappy' },
  happy: { ...SUNNY_LAYOUT, eyeStyle: 'archHappy' },
  surprised: { ...SUNNY_LAYOUT, eyeStyle: 'wide', brows: true },
  asleep: { ...SUNNY_LAYOUT, eyeStyle: 'closedHappy' },
};

let sunnyCache: Record<SnakeExpression, CanvasTexture> | null = null;

/** Sunny's expression set — eyes and blush over an open-mouth doorway. */
export function sunnyFaceTextures(): Record<SnakeExpression, CanvasTexture> {
  if (sunnyCache) return sunnyCache;
  const painted = {} as Record<SnakeExpression, CanvasTexture>;
  for (const name of Object.keys(SUNNY_PAINTS) as SnakeExpression[]) {
    painted[name] = markShared(paintOnFill(SUNNY_PAINTS[name], 512, 512));
  }
  sunnyCache = painted;
  return painted;
}

const PAINTS: Readonly<Record<SnakeExpression, FacePaintOptions>> = {
  neutral: { ...LAYOUT, eyeStyle: 'open' },
  blink: { ...LAYOUT, eyeStyle: 'closedHappy' },
  happy: { ...LAYOUT, eyeStyle: 'archHappy', mouth: 'bigSmile', mouthW: 0.11 },
  surprised: { ...LAYOUT, eyeStyle: 'wide', mouth: 'oh', mouthW: 0.06, brows: true },
  asleep: { ...LAYOUT, eyeStyle: 'closedHappy', mouth: 'smile', mouthW: 0.06 },
};

let cache: Record<SnakeExpression, CanvasTexture> | null = null;

/** The shared expression set, painted on first use. */
export function snakeFaceTextures(): Record<SnakeExpression, CanvasTexture> {
  if (cache) return cache;
  const painted = {} as Record<SnakeExpression, CanvasTexture>;
  for (const name of Object.keys(PAINTS) as SnakeExpression[]) {
    painted[name] = markShared(paintOnFill(PAINTS[name]));
  }
  cache = painted;
  return painted;
}

/**
 * The house face (`faces.ts`'s own eyes, catchlights, blush and w-mouth)
 * composited onto a white fill. `paintFace` draws a transparent square patch;
 * stretching it onto the slightly-wider canvas is a 12 % squash nobody can see
 * on a snout.
 */
function paintOnFill(options: FacePaintOptions, width = WIDTH, height = HEIGHT): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('snakeFace: 2D canvas context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const patch = paintFace(options);
  const image = patch.image as CanvasImageSource;
  ctx.drawImage(image, 0, 0, width, height);
  patch.dispose();
  return planarUvCanvasTexture(canvas);
}
