import type { CanvasTexture } from 'three';
import { ART } from '../style/artPalette';
import { glbCanvasTexture } from '../style/glb';
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
function paintOnFill(options: FacePaintOptions): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('snakeFace: 2D canvas context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const patch = paintFace(options);
  const image = patch.image as CanvasImageSource;
  ctx.drawImage(image, 0, 0, WIDTH, HEIGHT);
  patch.dispose();
  return glbCanvasTexture(canvas);
}
