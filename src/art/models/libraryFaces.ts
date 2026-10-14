import type { CanvasTexture } from 'three';
import { ART } from '../style/artPalette';
import { planarUvCanvasTexture } from '../style/glb';
import { markShared } from '../style/materials';
import { paintFace, type FacePaintOptions } from '../style/faces';
import { LIBRARY_FACES, type LibraryFaceFigures } from '../assets/libraryGlb';

/**
 * **The library creatures' faces** — the owl librarian's, the baby dragon's and
 * the library cat's (#718, #719), painted into each head's own UVs.
 *
 * The 3D Artist authored all three heads with a face window in their UVs
 * (`art/blend/library_build.py`, "Faces"): front-facing polygons take a planar
 * projection over the head node's own bounds, with `v` written so that it
 * climbs with height once the `.glb` is read, and every other polygon parked
 * at the canvas's top-left corner. So, exactly as `snakeFace.ts`:
 *
 * - **uploaded through `planarUvCanvasTexture`** (flipY true), **never**
 *   `glbCanvasTexture`, which would put every mouth above its eyes —
 *   `check:library`'s PAINTED FACES clause reads the UVs and the flip together;
 * - **ink on an opaque white fill**, so the head's own material colour tints
 *   the whole canvas: the owl's fur, the dragon's mint and the cat's ginger
 *   come from `LIBRARY_GLB_STYLES`, never from here;
 * - **the top row and the top-left 8 % are plain fill**, for the parked back
 *   faces (the nape of every head shows its colour and nothing else);
 * - **painted once, cached, `markShared`**, so `disposeTree` on one creature
 *   can never free a face another is wearing.
 *
 * ## Every figure from the art, none typed
 *
 * `LIBRARY_FACES` (`libraryGlb.ts`, packed from the glb's own extras and
 * asserted by `check:library-glb`) carries, per head, the eye centres as canvas
 * fractions, the window's size in metres and — the owl's — her glasses rims.
 * From them:
 *
 * - the canvas is {@link CANVAS_WIDTH} wide and as tall as the window's own
 *   proportion makes it (owl 412, dragon 346, cat 408), so a round eye painted
 *   here lands round on the head;
 * - `paintFace` paints its square patch at the canvas's height and it is
 *   blitted into the middle, never stretched, so every eye stays taller than
 *   it is wide;
 * - the eye row is the art's `v`, and the eye gap the art's `|uL − uR|`
 *   carried into the patch's own fractions.
 *
 * The eye and mouth **sizes** are this file's: they are the painter's style,
 * not the head's shape. The owl's are sized inside her measured rims, and the
 * module refuses to load if they would not fit.
 *
 * Ten canvases in all — owl 4, dragon 4, cat 2 — the creatures' share of
 * ASSET_MANIFEST's informal texture budget (`check:library` prints the count).
 */

/** Every canvas is this wide; its height follows the head's window. */
const CANVAS_WIDTH = 512;

/** The three faced heads, by glb node name. */
export const LIBRARY_FACED_HEADS = ['owl-head', 'dragon-head', 'cat-head'] as const;
export type LibraryFacedHead = (typeof LIBRARY_FACED_HEADS)[number];

/** A head's canvas, measured off its window: {@link CANVAS_WIDTH} wide, as tall as the window's proportion. */
export function libraryFaceCanvasSize(head: LibraryFacedHead): { readonly width: number; readonly height: number } {
  const [width, height] = LIBRARY_FACES[head].face_window_m;
  return { width: CANVAS_WIDTH, height: Math.round((CANVAS_WIDTH * height) / width) };
}

/**
 * The art's eye row and the eye gap in the patch's own fractions. The painter
 * draws its pair level and centred on the canvas middle, so the art's two eyes
 * must be too — a head whose eyes were not would get a face painted somewhere
 * else, so it throws instead.
 */
function eyesOf(head: LibraryFacedHead): { readonly eyeY: number; readonly eyeGap: number } {
  const figures: LibraryFaceFigures = LIBRARY_FACES[head];
  const [uL, vL, uR, vR] = figures.face_eyes_uv;
  if (Math.abs(vL - vR) > 1e-3 || Math.abs(uL + uR - 1) > 1e-3) {
    throw new Error(
      `libraryFaces: ${head}'s eyes (${uL}, ${vL}) / (${uR}, ${vR}) are not level and centred on its canvas — ` +
        'the face painter draws a level, centred pair, so it would paint them somewhere else',
    );
  }
  const { width, height } = libraryFaceCanvasSize(head);
  return { eyeY: vL, eyeGap: (Math.abs(uL - uR) * width) / height };
}

// ---------------------------------------------------------------------------
// The owl: big eyes inside her glasses, and her beak for a mouth
// ---------------------------------------------------------------------------

export type OwlFace = 'neutral' | 'blink' | 'happy' | 'shush';

const OWL_EYES = eyesOf('owl-head');
const OWL_RIM = LIBRARY_FACES['owl-head'].face_rim_uv;
if (!OWL_RIM) throw new Error('libraryFaces: owl-head carries no face_rim_uv — her eyes cannot be sized inside her glasses');
/** Eye half-height: four fifths of her rim's inner radius, so a ring of fur shows inside each lens. */
const OWL_EYE_H = 0.8 * OWL_RIM[1];
/** Eye half-width: taller than wide, as every eye in the park is. */
const OWL_EYE_W = 0.8 * OWL_EYE_H;
{
  const { width, height } = libraryFaceCanvasSize('owl-head');
  if (OWL_EYE_W * height > 0.9 * OWL_RIM[0] * width) {
    throw new Error(
      `libraryFaces: the owl's eyes (${(OWL_EYE_W * height).toFixed(1)} px half-wide) would not sit inside her glasses ` +
        `(rim ${(OWL_RIM[0] * width).toFixed(1)} px, 90 % of it allowed)`,
    );
  }
}

const OWL_LAYOUT: FacePaintOptions = {
  eyeY: OWL_EYES.eyeY,
  eyeGap: OWL_EYES.eyeGap,
  eyeW: OWL_EYE_W,
  eyeH: OWL_EYE_H,
  // Her beak is her mouth: a painted one would sit under a 3D beak.
  mouth: 'none',
};

const OWL_PAINTS: Readonly<Record<OwlFace, FacePaintOptions>> = {
  neutral: { ...OWL_LAYOUT, eyeStyle: 'open' },
  blink: { ...OWL_LAYOUT, eyeStyle: 'closedHappy' },
  happy: { ...OWL_LAYOUT, eyeStyle: 'archHappy' },
  shush: { ...OWL_LAYOUT, eyeStyle: 'wide', brows: true },
};

// ---------------------------------------------------------------------------
// The baby dragon: a smile with soft cheeks, and an "oh" for a puff
// ---------------------------------------------------------------------------

export type DragonFace = 'neutral' | 'blink' | 'happy' | 'puff';

const DRAGON_EYES = eyesOf('dragon-head');
const DRAGON_MOUTH_DROP = 0.22;
const DRAGON_LAYOUT: FacePaintOptions = {
  eyeY: DRAGON_EYES.eyeY,
  eyeGap: DRAGON_EYES.eyeGap,
  eyeW: 0.1,
  eyeH: 0.13,
  mouth: 'smile',
  mouthW: 0.09,
  mouthDrop: DRAGON_MOUTH_DROP,
  blush: ART.blush,
  blushStyle: 'soft',
};

const DRAGON_PAINTS: Readonly<Record<DragonFace, FacePaintOptions>> = {
  neutral: { ...DRAGON_LAYOUT, eyeStyle: 'open' },
  blink: { ...DRAGON_LAYOUT, eyeStyle: 'closedHappy' },
  happy: { ...DRAGON_LAYOUT, eyeStyle: 'archHappy', mouth: 'bigSmile' },
  puff: { ...DRAGON_LAYOUT, eyeStyle: 'wide', mouth: 'oh' },
};

// ---------------------------------------------------------------------------
// The library cat: asleep, and happy when she is petted
// ---------------------------------------------------------------------------

export type CatFace = 'asleep' | 'happy';

const CAT_EYES = eyesOf('cat-head');
const CAT_MOUTH_DROP = 0.22;
const CAT_MOUTH_W = 0.07;
const CAT_LAYOUT: FacePaintOptions = {
  eyeY: CAT_EYES.eyeY,
  eyeGap: CAT_EYES.eyeGap,
  eyeW: 0.11,
  eyeH: 0.14,
  mouth: 'cat',
  mouthW: CAT_MOUTH_W,
  mouthDrop: CAT_MOUTH_DROP,
};

const CAT_PAINTS: Readonly<Record<CatFace, FacePaintOptions>> = {
  // Asleep: eyes shut in a contented curve, and a smaller "w".
  asleep: { ...CAT_LAYOUT, eyeStyle: 'closedHappy', mouthW: CAT_MOUTH_W * 0.7 },
  happy: { ...CAT_LAYOUT, eyeStyle: 'archHappy' },
};

/**
 * **Where the painted features sit, as fractions of the canvas from its top
 * row** — the eye row is the art's, the mouth row is the eye row plus the
 * painter's drop (computed, never typed). `check:library` reads each head's UVs
 * against these and asserts the eyes land above the mouth on the mesh (above
 * the beak, on the owl).
 */
export const LIBRARY_FACE_ROWS = {
  owl: { eye: OWL_EYES.eyeY },
  dragon: { eye: DRAGON_EYES.eyeY, mouth: DRAGON_EYES.eyeY + DRAGON_MOUTH_DROP },
  cat: { eye: CAT_EYES.eyeY, mouth: CAT_EYES.eyeY + CAT_MOUTH_DROP },
} as const;

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

/**
 * One face on its head's canvas: white fill, the house face (`faces.ts`'s own
 * eyes, catchlights, blush and mouths) painted as a square patch at the
 * canvas's height and blitted into the middle, then the parked corner made
 * certain.
 */
function paintHead(head: LibraryFacedHead, options: FacePaintOptions): CanvasTexture {
  const { width, height } = libraryFaceCanvasSize(head);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('libraryFaces: 2D canvas context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const patch = paintFace({ ...options, size: height });
  ctx.drawImage(patch.image as CanvasImageSource, Math.round((width - height) / 2), 0);
  patch.dispose();
  // The parked back faces sample the top-left corner: plain fill there, and
  // along the top row, whatever a future style paints.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, 1);
  ctx.fillRect(0, 0, Math.ceil(width * 0.08), Math.ceil(height * 0.08));
  return planarUvCanvasTexture(canvas);
}

function paintSet<F extends string>(head: LibraryFacedHead, paints: Readonly<Record<F, FacePaintOptions>>): Record<F, CanvasTexture> {
  const painted = {} as Record<F, CanvasTexture>;
  for (const name of Object.keys(paints) as F[]) painted[name] = markShared(paintHead(head, paints[name]));
  return painted;
}

let owlCache: Record<OwlFace, CanvasTexture> | null = null;
let dragonCache: Record<DragonFace, CanvasTexture> | null = null;
let catCache: Record<CatFace, CanvasTexture> | null = null;

/** The owl's four faces, painted on first use. */
export function owlFaceTextures(): Record<OwlFace, CanvasTexture> {
  owlCache ??= paintSet('owl-head', OWL_PAINTS);
  return owlCache;
}

/** The baby dragon's four faces, painted on first use. */
export function dragonFaceTextures(): Record<DragonFace, CanvasTexture> {
  dragonCache ??= paintSet('dragon-head', DRAGON_PAINTS);
  return dragonCache;
}

/** The library cat's two faces, painted on first use. */
export function catFaceTextures(): Record<CatFace, CanvasTexture> {
  catCache ??= paintSet('cat-head', CAT_PAINTS);
  return catCache;
}
