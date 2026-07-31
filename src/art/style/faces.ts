import {
  CanvasTexture,
  Mesh,
  SphereGeometry,
  SRGBColorSpace,
  type BufferAttribute,
  type BufferGeometry,
  type MeshToonMaterial,
} from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from './artPalette';
import { decal, isShared, markShared, ownTextures, toonMaterial } from './materials';

/**
 * Faces are PAINTED, not built.
 *
 * Every character wears a "face patch": a thin curved shell that hugs the front
 * of the head sphere, carrying a transparent canvas texture. This is the single
 * highest-leverage decision in the art direction, because:
 *
 *  - eyes can be *far* bigger than sphere geometry allows before they start
 *    poking out of the skull, and big eyes are 80% of cuteness;
 *  - blinking and expressions are a texture swap, not an animation rig;
 *  - the shell curves with the head, so eyes wrap correctly at the iso angle
 *    instead of sliding off the way a flat decal does;
 *  - it costs one draw call and one 512² canvas per expression set.
 *
 * Canvas sizes (the whole game sticks to these):
 *   512² — hero heads (player kid, RiPika, Biscuit)
 *   256² — small creatures, muzzles, balloon animals
 *
 * Drawing style rules are in ART_DIRECTION.md; the short version is: fill with
 * warm plum ink (never black), eyes taller than wide, always two catchlights,
 * and lines with round caps at ~3.5% of the canvas width.
 */

export type Expression = 'neutral' | 'blink' | 'happy' | 'surprised' | 'sad';

export type EyeStyle = 'open' | 'wide' | 'closedHappy' | 'archHappy' | 'sly' | 'worried';
export type MouthStyle = 'smile' | 'bigSmile' | 'grin' | 'oh' | 'cat' | 'wobble' | 'none';

export interface FacePaintOptions {
  /** Canvas edge length in pixels. 512 for heroes, 256 for small things. */
  size?: number;
  /** Vertical centre of the eyes, as a fraction of the canvas. Lower = cuter. */
  eyeY?: number;
  /** Eye centre-to-centre distance, as a fraction of the canvas. Wide = cuter. */
  eyeGap?: number;
  /** Eye half-width as a fraction of the canvas. */
  eyeW?: number;
  /** Eye half-height as a fraction of the canvas. Must exceed eyeW. */
  eyeH?: number;
  eyeStyle?: EyeStyle;
  /** Optional coloured iris glow inside the lower eye. */
  iris?: number | null;
  mouth?: MouthStyle;
  /** Mouth half-width as a fraction of the canvas. */
  mouthW?: number;
  /** Distance from the eye line down to the mouth, as a fraction of the canvas. */
  mouthDrop?: number;
  /** Blush colour, or null for none. */
  blush?: number | null;
  /** `soft` = airbrushed gradient (kids, bears). `disc` = solid (RiPika). */
  blushStyle?: 'soft' | 'disc';
  /** Blush radius as a fraction of the canvas. */
  blushR?: number;
  /** Little eyebrows — used for the mini's mischief and for surprise. */
  brows?: boolean;
  /** Drawn as a nose+mouth patch for a muzzle instead of a full face. */
  nose?: number | null;
  /**
   * Set false for a muzzle patch — a second, smaller patch carrying only the
   * mouth, worn on the snout of bears, pups and corgis while the eyes stay on
   * the head patch above.
   */
  eyes?: boolean;
}

const DEFAULTS: Required<Omit<FacePaintOptions, 'iris' | 'blush' | 'nose'>> = {
  eyes: true,
  size: 512,
  eyeY: 0.46,
  eyeGap: 0.44,
  // These are BIG on purpose. An eye narrower than ~0.10 of the patch stops
  // reading as an eye at gameplay distance and the character goes dead.
  eyeW: 0.118,
  eyeH: 0.152,
  eyeStyle: 'open',
  mouth: 'smile',
  mouthW: 0.075,
  mouthDrop: 0.175,
  blushStyle: 'soft',
  blushR: 0.075,
  brows: false,
};

/** A palette number as a CSS colour string, for canvas painting. */
export function css(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function newCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot paint a face.');
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** One filled eye, drawn at canvas coordinates. `side` is -1 (left) or +1. */
function drawEye(
  ctx: CanvasRenderingContext2D,
  s: number,
  cx: number,
  cy: number,
  side: -1 | 1,
  o: Required<Omit<FacePaintOptions, 'iris' | 'blush' | 'nose'>> & { iris?: number | null },
): void {
  const rx = o.eyeW * s;
  const ry = o.eyeH * s;
  const ink = css(ART.ink);

  if (o.eyeStyle === 'closedHappy' || o.eyeStyle === 'archHappy') {
    // A happy closed eye is an upward arc — the "^_^" of the toy world.
    const up = o.eyeStyle === 'archHappy' ? 1 : 1;
    ctx.strokeStyle = ink;
    ctx.lineWidth = s * 0.03;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy + ry * 0.28 * up);
    ctx.quadraticCurveTo(cx, cy - ry * 0.72 * up, cx + rx, cy + ry * 0.28 * up);
    ctx.stroke();
    return;
  }

  if (o.eyeStyle === 'worried') {
    ctx.strokeStyle = ink;
    ctx.lineWidth = s * 0.03;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy - ry * 0.25);
    ctx.quadraticCurveTo(cx, cy + ry * 0.55, cx + rx, cy - ry * 0.25);
    ctx.stroke();
    return;
  }

  const wide = o.eyeStyle === 'wide';
  const sly = o.eyeStyle === 'sly';
  const ex = wide ? rx * 1.12 : rx;
  const ey = wide ? ry * 1.18 : sly ? ry * 0.62 : ry;

  // The eye itself: one solid warm-plum oval. No white sclera — cartoon toys
  // read cuter with a full dark eye and bright catchlights.
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.ellipse(cx, cy, ex, ey, 0, 0, Math.PI * 2);
  ctx.fill();

  // Optional iris: a coloured pool in the bottom two-thirds, which gives hero
  // characters a hint of eye colour without losing the solid silhouette.
  if (o.iris) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(cx, cy, ex, ey, 0, 0, Math.PI * 2);
    ctx.clip();
    const grad = ctx.createRadialGradient(cx, cy + ey * 0.3, 0, cx, cy + ey * 0.3, ex * 0.95);
    grad.addColorStop(0, `${css(o.iris)}ee`);
    grad.addColorStop(0.6, `${css(o.iris)}9a`);
    grad.addColorStop(1, `${css(o.iris)}00`);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - ex, cy - ey, ex * 2, ey * 2);
    ctx.restore();
  }

  if (sly) {
    // A sly eye is a normal eye with a lid pulled down over the top half.
    return;
  }

  // Two catchlights, always. Big one high and outboard, tiny one low and inboard.
  ctx.fillStyle = css(ART.shine);
  ctx.beginPath();
  ctx.ellipse(cx + side * ex * 0.34, cy - ey * 0.42, ex * 0.36, ey * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx - side * ex * 0.34, cy + ey * 0.42, ex * 0.17, ey * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawMouth(
  ctx: CanvasRenderingContext2D,
  s: number,
  cx: number,
  cy: number,
  style: MouthStyle,
  w: number,
): void {
  if (style === 'none') return;
  const ink = css(ART.ink);
  const half = w * s;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = s * 0.026;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (style === 'smile') {
    ctx.beginPath();
    ctx.moveTo(cx - half, cy - half * 0.18);
    ctx.quadraticCurveTo(cx, cy + half * 0.85, cx + half, cy - half * 0.18);
    ctx.stroke();
    return;
  }

  if (style === 'cat') {
    // The "w" mouth. Cheapest possible cuteness.
    ctx.beginPath();
    ctx.moveTo(cx - half, cy - half * 0.1);
    ctx.quadraticCurveTo(cx - half * 0.5, cy + half * 0.6, cx, cy);
    ctx.quadraticCurveTo(cx + half * 0.5, cy + half * 0.6, cx + half, cy - half * 0.1);
    ctx.stroke();
    return;
  }

  if (style === 'oh') {
    ctx.beginPath();
    ctx.ellipse(cx, cy + half * 0.2, half * 0.44, half * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (style === 'wobble') {
    ctx.beginPath();
    ctx.moveTo(cx - half, cy);
    ctx.quadraticCurveTo(cx - half * 0.5, cy - half * 0.55, cx, cy);
    ctx.quadraticCurveTo(cx + half * 0.5, cy + half * 0.55, cx + half, cy);
    ctx.stroke();
    return;
  }

  // bigSmile / grin: a filled open mouth with a tongue, and teeth for `grin`.
  ctx.beginPath();
  ctx.moveTo(cx - half, cy - half * 0.25);
  ctx.quadraticCurveTo(cx, cy + half * 1.5, cx + half, cy - half * 0.25);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.fillStyle = css(ART.blush);
  ctx.beginPath();
  ctx.ellipse(cx, cy + half * 1.05, half * 0.62, half * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  if (style === 'grin') {
    // Two little top teeth. Mischief, but friendly mischief.
    ctx.fillStyle = css(ART.miniTooth);
    const tw = half * 0.26;
    for (const t of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(cx + t * tw * 0.35, cy - half * 0.3);
      ctx.lineTo(cx + t * tw * 1.5, cy - half * 0.22);
      ctx.lineTo(cx + t * tw * 0.9, cy + half * 0.42);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawBlush(
  ctx: CanvasRenderingContext2D,
  s: number,
  cx: number,
  cy: number,
  colour: number,
  style: 'soft' | 'disc',
  r: number,
): void {
  const rad = r * s;
  if (style === 'disc') {
    ctx.fillStyle = css(colour);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rad, rad, 0, 0, Math.PI * 2);
    ctx.fill();
    // A soft top highlight so the disc reads as a rounded pad, not a sticker.
    ctx.fillStyle = '#ffffff3a';
    ctx.beginPath();
    ctx.ellipse(cx - rad * 0.22, cy - rad * 0.3, rad * 0.5, rad * 0.34, -0.3, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
  grad.addColorStop(0, `${css(colour)}cc`);
  grad.addColorStop(0.55, `${css(colour)}77`);
  grad.addColorStop(1, `${css(colour)}00`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rad, rad * 0.82, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Paints one face onto a transparent canvas and returns it as a texture. */
export function paintFace(options: FacePaintOptions = {}): CanvasTexture {
  const o = { ...DEFAULTS, ...options };
  const s = o.size;
  const { canvas, ctx } = newCanvas(s);

  const eyeY = o.eyeY * s;
  const gap = (o.eyeGap * s) / 2;
  const cx = s / 2;

  if (o.blush && o.eyes) {
    const blushY = eyeY + o.eyeH * s * 0.95;
    const blushX = gap + o.eyeW * s * 1.25;
    drawBlush(ctx, s, cx - blushX, blushY, o.blush, o.blushStyle, o.blushR);
    drawBlush(ctx, s, cx + blushX, blushY, o.blush, o.blushStyle, o.blushR);
  }

  if (o.brows && o.eyes) {
    ctx.strokeStyle = css(ART.ink);
    ctx.lineWidth = s * 0.022;
    ctx.lineCap = 'round';
    for (const side of [-1, 1] as const) {
      const bx = cx + side * gap;
      ctx.beginPath();
      ctx.moveTo(bx - side * o.eyeW * s * 0.95, eyeY - o.eyeH * s * 1.75);
      ctx.lineTo(bx + side * o.eyeW * s * 0.85, eyeY - o.eyeH * s * 1.25);
      ctx.stroke();
    }
  }

  if (o.eyes) {
    drawEye(ctx, s, cx - gap, eyeY, -1, o);
    drawEye(ctx, s, cx + gap, eyeY, 1, o);
  }

  if (o.nose) {
    const ny = eyeY + o.mouthDrop * s * 0.55;
    ctx.fillStyle = css(o.nose);
    ctx.beginPath();
    ctx.moveTo(cx - o.mouthW * s * 0.62, ny - o.mouthW * s * 0.34);
    ctx.quadraticCurveTo(cx, ny - o.mouthW * s * 0.72, cx + o.mouthW * s * 0.62, ny - o.mouthW * s * 0.34);
    ctx.quadraticCurveTo(cx + o.mouthW * s * 0.3, ny + o.mouthW * s * 0.7, cx, ny + o.mouthW * s * 0.75);
    ctx.quadraticCurveTo(cx - o.mouthW * s * 0.3, ny + o.mouthW * s * 0.7, cx - o.mouthW * s * 0.62, ny - o.mouthW * s * 0.34);
    ctx.fill();
  }

  drawMouth(ctx, s, cx, eyeY + o.mouthDrop * s, o.mouth, o.mouthW);

  return finish(canvas);
}

// =============================================================================
// Faces baked into a worn item's own surface.
//
// A face patch (above) is a transparent decal worn *over* a head. That is right
// for a head — the skull is the thing the face belongs to. It is the wrong
// shape for a face painted onto an object the child wears, like the critter
// hoods in `models/hoodShell.ts`, and the reason is worth writing down because
// it cost a whole bug:
//
// A second surface floating a fixed distance off a first one has to be kept in
// step with it by hand, and every single thing about it is a way to get that
// wrong. The hood faces were invisible in game for a fortnight because the
// patch's triangles were wound the opposite way round from the shell's, so the
// face pointed at the wearer's skull and was back-face culled. Padding the
// stand-off distance — the obvious fix, and the one that was tried — could
// never have worked. Sink it too far and it disappears into the base mesh;
// float it too far and it detaches; get the winding backwards and it is never
// drawn at all.
//
// So: **bake the face into the base surface's own UV map instead.** One
// surface, one texture, no stand-off, no winding to match, nothing to keep in
// sync. The base colour is the texture's background fill and the face is
// composited on top of it. See `hoodShellGeometry`'s face window for the other
// half of it.
// =============================================================================

/**
 * The border of plain background colour left round a baked-in face, as a
 * fraction of the canvas.
 *
 * Everything on the wearing surface that is *outside* the face window has UVs
 * outside `[0, 1]` and clamps to the texture's edge, so the edge has to be the
 * plain base colour or the whole object smears with whatever is at the canvas
 * border. This is the width of that guard band, and it has to survive
 * mip-mapping: at 0.08 of a 512² canvas it is 41 texels, against a mip block of
 * about 6 texels at gameplay distance.
 *
 * It costs the face 16% of its canvas. Do not shrink it to buy that back
 * without checking the object at a distance — the failure mode is a faint
 * bloom of eye colour over the entire surface, which reads as a lighting bug.
 */
export const FACE_FILL_INSET = 0.08;

/** Layers painted into a baked face, in the order they go down. */
export interface FaceFillLayers {
  /** Beneath the face — markings belonging to the garment, not the character. */
  under?: (ctx: CanvasRenderingContext2D, size: number) => void;
  /** Over the face — face paint, which is a sticker over the photograph. */
  over?: (ctx: CanvasRenderingContext2D, size: number) => void;
}

/**
 * Draws a face on an opaque background **into a canvas that already exists**.
 *
 * Separate from {@link paintFaceOnFill} so a baked face can be *redrawn in
 * place* — a skin-tone change or a trip to the face-painting stall repaints the
 * same canvases and sets `needsUpdate`, rather than allocating a fresh set of
 * textures on the GPU every time a six-year-old taps a swatch.
 *
 * `under` and `over` draw in the **face window's** own coordinates (`0…size`
 * across the window), not the whole canvas, so a caller never has to know about
 * the inset.
 */
function drawFaceOnFill(
  ctx: CanvasRenderingContext2D,
  size: number,
  fill: number,
  options: FacePaintOptions,
  layers: FaceFillLayers = {},
): void {
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = css(fill);
  ctx.fillRect(0, 0, size, size);

  // The face is painted at the inset size and blitted 1:1, rather than painted
  // at full size and scaled down on the way in. Every shape in `paintFace` is a
  // fraction of the canvas, so painting it smaller draws the same picture at a
  // lower resolution — which is exactly what is wanted — whereas scaling a
  // finished canvas would resample it and soften every ink edge for nothing.
  const box = Math.round(size * (1 - 2 * FACE_FILL_INSET));
  const at = Math.round(size * FACE_FILL_INSET);
  const inWindow = (draw: (ctx: CanvasRenderingContext2D, size: number) => void): void => {
    ctx.save();
    ctx.translate(at, at);
    draw(ctx, box);
    ctx.restore();
  };

  if (layers.under) inWindow(layers.under);

  // `paintFace` owns its own transparent canvas; this composites that canvas in
  // rather than re-implementing the drawing, so a change to how an eye is
  // painted reaches a baked face and a worn one alike.
  const face = paintFace({ ...options, size: box });
  ctx.drawImage(face.image as CanvasImageSource, at, at);
  face.dispose();

  if (layers.over) inWindow(layers.over);
}

/**
 * A face painted onto an **opaque** background, for baking into the UV map of
 * the thing that wears it.
 *
 * The face is drawn inset by {@link FACE_FILL_INSET} on all four sides, leaving
 * a border of pure `fill`.
 */
export function paintFaceOnFill(
  fill: number,
  options: FacePaintOptions = {},
  under?: (ctx: CanvasRenderingContext2D, size: number) => void,
): CanvasTexture {
  const s = options.size ?? DEFAULTS.size;
  const { canvas, ctx } = newCanvas(s);
  drawFaceOnFill(ctx, s, fill, options, under ? { under } : {});
  return finish(canvas);
}

export const EXPRESSIONS: readonly Expression[] = [
  'neutral',
  'blink',
  'happy',
  'surprised',
  'sad',
];

/**
 * What each expression *is*, as paint options — the one definition of the set.
 *
 * Split out from {@link paintExpressions} because a baked face has to be able to
 * **redraw** an expression later (a skin-tone change, a trip to the face-paint
 * stall) rather than only paint it once, and two copies of this table would be
 * two places for `happy` to mean different things.
 */
function expressionPaints(base: FacePaintOptions): Record<Expression, FacePaintOptions> {
  const happyMouth: MouthStyle = base.mouth === 'grin' ? 'grin' : 'bigSmile';
  return {
    neutral: base,
    blink: { ...base, eyeStyle: 'closedHappy' },
    happy: { ...base, eyeStyle: 'archHappy', mouth: happyMouth },
    surprised: { ...base, eyeStyle: 'wide', mouth: 'oh', brows: true },
    sad: { ...base, eyeStyle: 'worried', mouth: 'wobble', blush: base.blush ?? null },
  };
}

/**
 * Paints the whole expression set for one character in a single call.
 *
 * Callers keep the record and swap `material.map` — that is the entire
 * expression system. Nothing else in the game animates a face.
 */
export function paintExpressions(base: FacePaintOptions = {}): Record<Expression, CanvasTexture> {
  const paints = expressionPaints(base);
  const out = {} as Record<Expression, CanvasTexture>;
  for (const name of EXPRESSIONS) out[name] = paintFace(paints[name]);
  return out;
}

/**
 * The curved shell the face is painted on.
 *
 * A spherical patch centred on +Z (the character's forward direction), built at
 * a whisker larger than the head so it never z-fights. `spreadX`/`spreadY` are
 * in radians — how much of the skull the face wraps around. 1.6 × 1.6 covers a
 * generous front third, which is what you want: at the 38° iso camera angle a
 * narrow patch makes the face disappear as soon as the character turns.
 */
export function facePatchGeometry(
  radius: number,
  spreadX = 1.7,
  spreadY = 1.7,
  tilt = 0.1,
): SphereGeometry {
  return new SphereGeometry(
    radius,
    40,
    32,
    Math.PI / 2 - spreadX / 2,
    spreadX,
    Math.PI / 2 - spreadY / 2 + tilt,
    spreadY,
  );
}

export interface FacePatchOptions extends FacePaintOptions {
  /** Radius of the head sphere the face sits on. */
  radius: number;
  spreadX?: number;
  spreadY?: number;
  /** Positive nudges the face down the skull. Eyes low = cute. */
  tilt?: number;
}

/** How much of a head a face wraps around, and where on it the face sits. */
export interface FaceWindow {
  spreadX?: number;
  spreadY?: number;
  tilt?: number;
}

/**
 * Rewrites a **whole head sphere's** UVs so the face window fills the texture.
 *
 * This is the sphere counterpart of `hoodShell.ts`'s `hoodFaceUv`, and it is
 * deliberately an *affine remap of three.js's own UV attribute* rather than a
 * fresh computation from vertex positions. Two reasons, both learned the hard
 * way:
 *
 * 1. **`SphereGeometry` already splits its own UV seam** — the column at the
 *    far side is built twice, once with `u = 0` and once with `u = 1`. Recomputing
 *    `u` from each vertex's azimuth would give both copies the same value and
 *    the quad between them would smear the whole texture round the head. An
 *    affine remap keeps the split three.js already made.
 * 2. **The winding stays three.js's.** The hood faces were invisible for a
 *    fortnight because a hand-rolled patch was wound inside out (see CLAUDE.md);
 *    nothing here re-triangulates anything.
 *
 * The remap is exact: `facePatchGeometry` and a full sphere parameterise
 * azimuth identically, differing only by an affine map, so a face texture
 * painted for the patch lands on precisely the same part of the head. Which is
 * why this is a like-for-like change and not a re-authoring of anybody's face.
 *
 * Where the seam lands matters and is checked rather than assumed: three.js
 * puts `u = 0.25` at `+Z` (dead front) and the seam at 90° round the side, so a
 * face spreading ±48.7° clears it by 41°. `check:baked-face` asserts it.
 */
export function remapSphereFaceUv(geometry: BufferGeometry, window: FaceWindow = {}): void {
  const { spreadX = 1.7, spreadY = 1.7, tilt = 0.1 } = window;
  const uv = geometry.getAttribute('uv') as BufferAttribute | undefined;
  if (!uv) throw new Error('remapSphereFaceUv: geometry has no uv attribute — not a SphereGeometry?');

  // u: the patch's u=0 sits at azimuth -spreadX/2, and a full sphere's u
  // advances 2π of azimuth, so the window occupies `spreadX / 2π` of it.
  const u0 = 0.25 - spreadX / (4 * Math.PI);
  const du = spreadX / (2 * Math.PI);
  // v: three.js's v is 1 at the top pole and 0 at the bottom, with polar angle
  // θ = (1 − v)·π. The window runs from θ0 at its top down to θ0 + spreadY.
  const theta0 = Math.PI / 2 - spreadY / 2 + tilt;

  const span = 1 - 2 * FACE_FILL_INSET;
  for (let i = 0; i < uv.count; i += 1) {
    const u = (uv.getX(i) - u0) / du;
    const theta = (1 - uv.getY(i)) * Math.PI;
    const v = (theta0 + spreadY - theta) / spreadY;
    uv.setXY(i, FACE_FILL_INSET + span * u, FACE_FILL_INSET + span * v);
  }
  uv.needsUpdate = true;
}

/**
 * A face baked into the head's own texture, rather than worn on a patch in
 * front of it. The sphere counterpart of the critter hoods' baked faces.
 *
 * ## When to use this, and when a patch is still right
 *
 * **Bake** when the head is a *unique* mesh with a colour of its own: the player
 * kid, RiPika, Biscuit, Mini. One surface, one texture; the face inherits the
 * head's squash and tilt for free instead of a `FACE_SQUASH` constant copied
 * beside every call, and there is no second mesh to get wrong.
 *
 * **Keep the patch** when the head's colour is *not* the head's own:
 *
 * - `entities/npc/kidCrowd.ts` and any other `InstancedCrowd` prototype. Skin
 *   tone reaches an instanced skull as an `instanceColor` multiply against a
 *   flat white material. Bake the face in and that multiply lands on the eyes
 *   too — a deep skin tone would drive the ink to near-black, and this game has
 *   no black in it. Crossing the crowd's twelve (expression × eye-colour) face
 *   variants with skin tone as well is the thing the crowd exists to avoid.
 * - `sharedFace.ts`'s cache. Its whole point is that one set of five canvases
 *   serves every shopkeeper and every shop pet; baking would need one set per
 *   *body colour*, which is the cache deleted.
 *
 * The rule in one line: **bake when the texture can carry the head's colour;
 * keep the patch when something else has to.**
 */
export interface BakedFaceOptions extends FacePaintOptions, FaceWindow {
  /** The head's own colour. It becomes the texture's background fill. */
  fill: number;
}

export interface BakedFace {
  /** Give this to the head mesh in place of its flat-colour material. */
  readonly material: MeshToonMaterial;
  readonly expressions: Record<Expression, CanvasTexture>;
  setExpression(name: Expression): void;
  /** Repaints on a new base colour — a skin-tone change. */
  setFill(colour: number): void;
  /** Paints a face-paint design over every expression, or washes it off. */
  setFacePaint(design: FacePaintDesign | null): void;
  /**
   * Points a head sphere at this face: its material, and its UVs remapped so
   * the face window fills the texture.
   */
  applyTo(mesh: Mesh): void;
}

export function createBakedFace(options: BakedFaceOptions): BakedFace {
  const { fill, spreadX = 1.7, spreadY = 1.7, tilt = 0.1, ...paint } = options;
  const size = paint.size ?? DEFAULTS.size;
  const layout = faceLayoutOf(paint);
  const paints = expressionPaints(paint);

  let colour = fill;
  let design: FacePaintDesign | null = null;

  const canvases = {} as Record<Expression, { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }>;
  const expressions = {} as Record<Expression, CanvasTexture>;
  for (const name of EXPRESSIONS) {
    const target = newCanvas(size);
    canvases[name] = target;
    drawFaceOnFill(target.ctx, size, colour, paints[name]);
    expressions[name] = finish(target.canvas);
  }

  /**
   * Redraws all five canvases in place and re-uploads them.
   *
   * In place, rather than painting a new set: the character creator rebuilds on
   * every tap and the face stall repaints on every design, and allocating five
   * fresh 512² textures per tap is the exact leak `ownTextures` was added for.
   */
  const repaint = (): void => {
    for (const name of EXPRESSIONS) {
      const target = canvases[name];
      drawFaceOnFill(target.ctx, size, colour, paints[name], {
        ...(design ? { over: (ctx, s) => drawFacePaint(ctx, s, design as FacePaintDesign, layout) } : {}),
      });
      expressions[name].needsUpdate = true;
    }
  };

  const material = toonMaterial(0xffffff, { map: expressions.neutral });
  // Opaque — no `transparent`, no `alphaTest`, nothing to sort. The head is a
  // solid object again, which is what it always was underneath the patch.
  ownTextures(material, Object.values(expressions));

  return {
    material,
    expressions,
    setExpression(name: Expression) {
      material.map = expressions[name];
      material.needsUpdate = true;
    },
    setFill(next: number) {
      if (next === colour) return;
      colour = next;
      repaint();
    },
    setFacePaint(next: FacePaintDesign | null) {
      if (next === design) return;
      design = next;
      repaint();
    },
    applyTo(mesh: Mesh) {
      if (isShared(mesh.geometry)) {
        throw new Error(
          'createBakedFace: refusing to remap a shared geometry. A cached head ' +
            'geometry is worn by more than one character and its UVs are not this ' +
            "face's to rewrite — see sharedFace.ts.",
        );
      }
      remapSphereFaceUv(mesh.geometry, { spreadX, spreadY, tilt });
      mesh.material = material;
    },
  };
}

export interface FacePatch {
  readonly mesh: Mesh;
  readonly expressions: Record<Expression, CanvasTexture>;
  setExpression(name: Expression): void;
}

/** Builds a ready-to-parent face patch with its full expression set. */
export function createFacePatch(options: FacePatchOptions): FacePatch {
  const { radius, spreadX = 1.7, spreadY = 1.7, tilt = 0.1, ...paint } = options;
  const expressions = paintExpressions(paint);
  const material = toonMaterial(0xffffff, { map: expressions.neutral, transparent: true });
  material.alphaTest = 0.02;
  // Five canvases painted, one in `material.map` at a time. Without this the
  // other four are invisible to `disposeTree` and leak on every rebuild — which
  // is exactly what the character creator's preview does on every single tap.
  ownTextures(material, Object.values(expressions));
  const mesh = decal(new Mesh(facePatchGeometry(radius * 1.012, spreadX, spreadY, tilt), material));
  mesh.name = 'facePatch';
  mesh.renderOrder = 2;
  return {
    mesh,
    expressions,
    setExpression(name: Expression) {
      material.map = expressions[name];
      material.needsUpdate = true;
    },
  };
}

// =============================================================================
// Face paint — the face-painting stall's decoration layer (additive).
//
// A face patch already carries eyes, blush and a mouth for one expression at a
// time (see `paintExpressions` above). Face *paint* is a second, independent
// layer on top: a design like butterfly wings or cat whiskers, painted onto its
// own transparent canvas and worn on a second decal mesh with a **higher
// `renderOrder`** than the base face patch. Because it never touches the base
// canvas, swapping expressions (`setExpression`) or blinking keeps working
// completely unchanged underneath — the paint is just always drawn on top of
// whatever the face currently looks like, exactly like a sticker over a
// photograph.
//
// This is deliberately NOT folded into `paintExpressions`/`FacePaintOptions`:
// baking paint into all five expression canvases would mean five redraws per
// design per character, and would give the crowd's shared, cached expression
// textures (`sharedFace.ts`) nowhere to keep a "painted" variant without
// touching the instanced-crowd material list. A second decal is one extra draw
// call and reuses the base face for everything it does not draw.
// =============================================================================

/** The designs on offer at the face-painting stall. */
export type FacePaintDesign =
  | 'butterfly'
  | 'catWhiskers'
  | 'rainbowCheeks'
  | 'flowerCheeks'
  | 'starEye'
  | 'ripikaCheeks';

export const FACE_PAINT_DESIGNS: readonly FacePaintDesign[] = [
  'butterfly',
  'catWhiskers',
  'rainbowCheeks',
  'flowerCheeks',
  'starEye',
  'ripikaCheeks',
];

/** Label + glyph for the picker panel and the "wearing" chip. */
export const FACE_PAINT_INFO: Record<FacePaintDesign, { label: string; glyph: string }> = {
  butterfly: { label: 'Butterfly Wings', glyph: '🦋' },
  catWhiskers: { label: 'Cat Whiskers', glyph: '🐱' },
  rainbowCheeks: { label: 'Rainbow Cheeks', glyph: '🌈' },
  flowerCheeks: { label: 'Flower Cheeks', glyph: '🌸' },
  starEye: { label: 'Star Eye', glyph: '⭐' },
  ripikaCheeks: { label: 'RiPika Cheeks', glyph: '💛' },
};

/**
 * The subset the instanced NPC crowd wears (see `world/FacePaintStall.ts` and
 * the additive block in `entities/npc/wanderDriver.ts`).
 *
 * `kidCrowd.ts` gives its shared face-patch part exactly three material
 * variants (`neutral`/`happy`/`blink` — see `FACE_ORDER` there), one
 * `InstancedMesh` each, sized at construction time. Adding a fourth variant for
 * "painted" would mean editing that instancing setup, which is out of scope for
 * this PR (see the file-ownership note at the top of `FacePaintStall.ts`).
 * Painted background children get a small floating paint decal positioned near
 * their head instead (a second, ordinary — not instanced — mesh), cycling
 * through **three** pre-painted designs rather than one unique canvas per
 * child. Three keeps the park's texture budget (ASSET_MANIFEST.md, "under 40
 * distinct canvas textures") untouched and is plenty of variety for a design
 * nobody stands and stares at.
 */
export const NPC_PAINT_DESIGNS: readonly FacePaintDesign[] = ['butterfly', 'rainbowCheeks', 'ripikaCheeks'];

/**
 * Where a given character's eyes actually are, as canvas fractions.
 *
 * Face paint used to be positioned from `DEFAULTS` alone, which is only right
 * for a character that happens to use the default layout. The kid does not
 * (`KID_FACE` puts her eyes at `eyeY` 0.43, not 0.46) and neither do most of
 * the creatures, so every design was landing a little off the cheeks it was
 * aiming at. Baking the paint into the same canvas as the face makes that
 * impossible to keep: they share one set of coordinates now.
 */
export interface FaceLayout {
  readonly eyeY: number;
  readonly eyeGap: number;
  readonly eyeW: number;
  readonly eyeH: number;
}

export const DEFAULT_FACE_LAYOUT: FaceLayout = {
  eyeY: DEFAULTS.eyeY,
  eyeGap: DEFAULTS.eyeGap,
  eyeW: DEFAULTS.eyeW,
  eyeH: DEFAULTS.eyeH,
};

function faceLayoutOf(paint: FacePaintOptions): FaceLayout {
  return {
    eyeY: paint.eyeY ?? DEFAULTS.eyeY,
    eyeGap: paint.eyeGap ?? DEFAULTS.eyeGap,
    eyeW: paint.eyeW ?? DEFAULTS.eyeW,
    eyeH: paint.eyeH ?? DEFAULTS.eyeH,
  };
}

/** Centre of the cheek blush spot, mirroring the maths in `paintFace`. */
function paintCheekPoint(s: number, side: -1 | 1, layout: FaceLayout): { x: number; y: number } {
  const blushY = layout.eyeY * s + layout.eyeH * s * 0.95;
  const blushX = (layout.eyeGap / 2) * s + layout.eyeW * s * 1.25;
  return { x: s / 2 + side * blushX, y: blushY };
}

/** A five-pointed star path, centred at `(cx, cy)`. Does not fill or stroke. */
function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, innerR: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** One wing of the butterfly design: two lobed ellipses and a body line. */
function drawButterflyWing(ctx: CanvasRenderingContext2D, s: number, cx: number, cy: number, side: -1 | 1): void {
  const ink = css(ART.ink);
  const upperColour = css(PALETTE.flowerBlue);
  const lowerColour = css(PALETTE.blossomPink);
  const r = s * 0.052;

  ctx.strokeStyle = ink;
  ctx.lineWidth = s * 0.01;
  ctx.lineJoin = 'round';

  ctx.fillStyle = upperColour;
  ctx.beginPath();
  ctx.ellipse(cx + side * r * 0.95, cy - r * 0.55, r * 1.05, r * 0.72, side * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = lowerColour;
  ctx.beginPath();
  ctx.ellipse(cx + side * r * 0.75, cy + r * 0.55, r * 0.72, r * 0.5, side * -0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // A little dot on each wing so it reads as painted rather than plain shapes.
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.ellipse(cx + side * r * 0.95, cy - r * 0.55, r * 0.16, r * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();

  // The body: a short ink line down the middle, with two antennae.
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.9);
  ctx.lineTo(cx, cy + r * 0.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.85);
  ctx.quadraticCurveTo(cx + side * r * 0.3, cy - r * 1.25, cx + side * r * 0.45, cy - r * 1.4);
  ctx.stroke();
}

/** Cat whiskers plus a small painted nose above the mouth. */
function drawCatWhiskers(ctx: CanvasRenderingContext2D, s: number, cx: number, layout: FaceLayout): void {
  const ink = css(ART.ink);
  const noseY = layout.eyeY * s + layout.eyeH * s * 0.55;
  const noseSize = s * 0.028;

  ctx.fillStyle = css(PALETTE.cheek);
  ctx.beginPath();
  ctx.moveTo(cx - noseSize, noseY - noseSize * 0.6);
  ctx.lineTo(cx + noseSize, noseY - noseSize * 0.6);
  ctx.lineTo(cx, noseY + noseSize * 0.8);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = ink;
  ctx.lineWidth = s * 0.009;
  ctx.lineCap = 'round';
  const whiskerY = noseY + noseSize * 0.3;
  for (const side of [-1, 1] as const) {
    for (let i = -1; i <= 1; i += 1) {
      const startX = cx + side * s * 0.09;
      const startY = whiskerY + i * s * 0.024;
      const endX = cx + side * s * 0.24;
      const endY = startY + i * s * 0.018;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
  }
}

/** A little rainbow arc on each cheek, in the park's own six-band rainbow. */
function drawRainbowCheek(ctx: CanvasRenderingContext2D, s: number, cx: number, cy: number): void {
  const outerR = s * 0.1;
  const bandWidth = outerR / ART.rainbow.length;
  ctx.lineCap = 'round';
  for (let i = 0; i < ART.rainbow.length; i += 1) {
    const radius = outerR - i * bandWidth;
    ctx.strokeStyle = css(ART.rainbow[i] ?? ART.rainbow[0] ?? 0xffffff);
    ctx.lineWidth = bandWidth * 0.92;
    ctx.beginPath();
    ctx.arc(cx, cy + outerR * 0.3, Math.max(radius, bandWidth * 0.4), Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
  }
}

/** A tiny five-petal flower on each cheek. */
function drawFlowerCheek(ctx: CanvasRenderingContext2D, s: number, cx: number, cy: number): void {
  const petalColours = [PALETTE.blossomPink, PALETTE.flowerViolet];
  const petalR = s * 0.03;
  const orbit = s * 0.034;
  for (let i = 0; i < 5; i += 1) {
    const angle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    ctx.fillStyle = css(petalColours[i % petalColours.length] ?? PALETTE.blossomPink);
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(angle) * orbit, cy + Math.sin(angle) * orbit, petalR, petalR * 0.72, angle, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = css(PALETTE.flowerYellow);
  ctx.beginPath();
  ctx.ellipse(cx, cy, petalR * 0.62, petalR * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** A little star sticker just above the outer corner of each eye. */
function drawStarEye(ctx: CanvasRenderingContext2D, s: number, cx: number, side: -1 | 1, layout: FaceLayout): void {
  const x = cx + side * ((layout.eyeGap / 2) * s + layout.eyeW * s * 1.35);
  const y = layout.eyeY * s - layout.eyeH * s * 1.05;
  ctx.fillStyle = css(PALETTE.flowerYellow);
  ctx.strokeStyle = css(ART.ink);
  ctx.lineWidth = s * 0.008;
  ctx.lineJoin = 'round';
  starPath(ctx, x, y, s * 0.042, s * 0.018);
  ctx.fill();
  ctx.stroke();
}

/**
 * Draws one face-paint design, at a given character's own face layout.
 *
 * Shared by the two ways paint reaches a face: composited over a baked face
 * (`createBakedFace`'s `setFacePaint`) and painted onto its own transparent
 * canvas for the separate overlay decal that the instanced NPC crowd still
 * needs. One implementation, so a design cannot come out differently
 * depending on which character is wearing it.
 */
export function drawFacePaint(
  ctx: CanvasRenderingContext2D,
  s: number,
  design: FacePaintDesign,
  layout: FaceLayout = DEFAULT_FACE_LAYOUT,
): void {
  const cx = s / 2;

  switch (design) {
    case 'butterfly': {
      const left = paintCheekPoint(s, -1, layout);
      const right = paintCheekPoint(s, 1, layout);
      drawButterflyWing(ctx, s, left.x, left.y, -1);
      drawButterflyWing(ctx, s, right.x, right.y, 1);
      break;
    }
    case 'catWhiskers':
      drawCatWhiskers(ctx, s, cx, layout);
      break;
    case 'rainbowCheeks': {
      const left = paintCheekPoint(s, -1, layout);
      const right = paintCheekPoint(s, 1, layout);
      drawRainbowCheek(ctx, s, left.x, left.y);
      drawRainbowCheek(ctx, s, right.x, right.y);
      break;
    }
    case 'flowerCheeks': {
      const left = paintCheekPoint(s, -1, layout);
      const right = paintCheekPoint(s, 1, layout);
      drawFlowerCheek(ctx, s, left.x, left.y);
      drawFlowerCheek(ctx, s, right.x, right.y);
      break;
    }
    case 'starEye':
      drawStarEye(ctx, s, cx, -1, layout);
      drawStarEye(ctx, s, cx, 1, layout);
      break;
    case 'ripikaCheeks': {
      const left = paintCheekPoint(s, -1, layout);
      const right = paintCheekPoint(s, 1, layout);
      // Bigger and bolder than the everyday blush (`DEFAULTS.blushR` 0.075) so
      // it reads as a deliberate paint job, not just rosy cheeks.
      //
      // `drawBlush`'s radius is a **fraction of `s`** — it multiplies by `s`
      // itself (`rad = r * s`), exactly as the two call sites above pass
      // `o.blushR`. Passing `s * 0.115` here squared it: at s = 512 that is a
      // 30,000 px disc, which painted the whole face a flat red. One number,
      // two units.
      drawBlush(ctx, s, left.x, left.y, ART.ripikaCheek, 'disc', 0.115);
      drawBlush(ctx, s, right.x, right.y, ART.ripikaCheek, 'disc', 0.115);
      break;
    }
  }
}

/** Paints one face-paint design onto a transparent canvas, for an overlay decal. */
export function paintFacePaintOverlay(design: FacePaintDesign, size = 512): CanvasTexture {
  const { canvas, ctx } = newCanvas(size);
  drawFacePaint(ctx, size, design);
  return finish(canvas);
}

/** Every design's texture, painted once and cached — see `FACE_PAINT_INFO`. */
const overlayTextureCache = new Map<string, CanvasTexture>();

/** Cached `paintFacePaintOverlay`. Same design + size always returns the same texture. */
export function facePaintOverlayTexture(design: FacePaintDesign, size = 512): CanvasTexture {
  const key = `${design}:${size}`;
  let texture = overlayTextureCache.get(key);
  if (!texture) {
    texture = markShared(paintFacePaintOverlay(design, size));
    overlayTextureCache.set(key, texture);
  }
  return texture;
}

/** Anything that can wear face paint: the baked path and the decal path alike. */
export interface FacePaintControl {
  /** Swaps the design, or removes the paint entirely for `null` ("wash off"). */
  setDesign(design: FacePaintDesign | null): void;
}

export interface FacePaintOverlayHandle extends FacePaintControl {
  /** Parent this under the character's head, alongside the base face patch. */
  readonly mesh: Mesh;
}

/**
 * A second, transparent decal patch worn over a face patch of the given
 * `radius` — the face-paint decoration layer.
 *
 * Built from the same curved geometry as {@link createFacePatch} so it wraps
 * the skull identically, at a hair larger a radius (`× 1.02` against the base
 * patch's `× 1.012`) purely to win the z-fight, and a higher `renderOrder` so
 * it always draws after — and therefore over — whatever expression is showing.
 */
export function createFacePaintOverlay(radius: number, options: { spreadX?: number; spreadY?: number; tilt?: number; size?: number } = {}): FacePaintOverlayHandle {
  const { spreadX = 1.7, spreadY = 1.7, tilt = 0.1, size = 512 } = options;
  const material = toonMaterial(0xffffff, { map: facePaintOverlayTexture('butterfly', size), transparent: true });
  material.alphaTest = 0.02;
  const mesh = decal(new Mesh(facePatchGeometry(radius * 1.02, spreadX, spreadY, tilt), material));
  mesh.name = 'facePaintOverlay';
  mesh.renderOrder = 3;
  mesh.visible = false;

  return {
    mesh,
    setDesign(design: FacePaintDesign | null) {
      if (!design) {
        mesh.visible = false;
        return;
      }
      material.map = facePaintOverlayTexture(design, size);
      material.needsUpdate = true;
      mesh.visible = true;
    },
  };
}
