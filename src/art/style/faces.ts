import { CanvasTexture, Mesh, SphereGeometry, SRGBColorSpace } from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from './artPalette';
import { decal, markShared, ownTextures, toonMaterial } from './materials';

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

function css(hex: number): string {
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

/**
 * Paints the whole expression set for one character in a single call.
 *
 * Callers keep the record and swap `material.map` — that is the entire
 * expression system. Nothing else in the game animates a face.
 */
export function paintExpressions(base: FacePaintOptions = {}): Record<Expression, CanvasTexture> {
  const happyMouth: MouthStyle = base.mouth === 'grin' ? 'grin' : 'bigSmile';
  return {
    neutral: paintFace(base),
    blink: paintFace({ ...base, eyeStyle: 'closedHappy' }),
    happy: paintFace({ ...base, eyeStyle: 'archHappy', mouth: happyMouth }),
    surprised: paintFace({ ...base, eyeStyle: 'wide', mouth: 'oh', brows: true }),
    sad: paintFace({ ...base, eyeStyle: 'worried', mouth: 'wobble', blush: base.blush ?? null }),
  };
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

/** Canvas-fraction landmarks shared with the default face layout (`DEFAULTS`). */
const PAINT_EYE_Y = DEFAULTS.eyeY;
const PAINT_GAP_HALF = DEFAULTS.eyeGap / 2;
const PAINT_EYE_W = DEFAULTS.eyeW;
const PAINT_EYE_H = DEFAULTS.eyeH;

/** Centre of the cheek blush spot, mirroring the maths in `paintFace`. */
function paintCheekPoint(s: number, side: -1 | 1): { x: number; y: number } {
  const blushY = PAINT_EYE_Y * s + PAINT_EYE_H * s * 0.95;
  const blushX = PAINT_GAP_HALF * s + PAINT_EYE_W * s * 1.25;
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
function drawCatWhiskers(ctx: CanvasRenderingContext2D, s: number, cx: number): void {
  const ink = css(ART.ink);
  const noseY = PAINT_EYE_Y * s + PAINT_EYE_H * s * 0.55;
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
function drawStarEye(ctx: CanvasRenderingContext2D, s: number, cx: number, side: -1 | 1): void {
  const x = cx + side * (PAINT_GAP_HALF * s + PAINT_EYE_W * s * 1.35);
  const y = PAINT_EYE_Y * s - PAINT_EYE_H * s * 1.05;
  ctx.fillStyle = css(PALETTE.flowerYellow);
  ctx.strokeStyle = css(ART.ink);
  ctx.lineWidth = s * 0.008;
  ctx.lineJoin = 'round';
  starPath(ctx, x, y, s * 0.042, s * 0.018);
  ctx.fill();
  ctx.stroke();
}

/** Paints one face-paint design onto a transparent canvas. */
export function paintFacePaintOverlay(design: FacePaintDesign, size = 512): CanvasTexture {
  const { canvas, ctx } = newCanvas(size);
  const s = size;
  const cx = s / 2;

  switch (design) {
    case 'butterfly': {
      const left = paintCheekPoint(s, -1);
      const right = paintCheekPoint(s, 1);
      drawButterflyWing(ctx, s, left.x, left.y, -1);
      drawButterflyWing(ctx, s, right.x, right.y, 1);
      break;
    }
    case 'catWhiskers':
      drawCatWhiskers(ctx, s, cx);
      break;
    case 'rainbowCheeks': {
      const left = paintCheekPoint(s, -1);
      const right = paintCheekPoint(s, 1);
      drawRainbowCheek(ctx, s, left.x, left.y);
      drawRainbowCheek(ctx, s, right.x, right.y);
      break;
    }
    case 'flowerCheeks': {
      const left = paintCheekPoint(s, -1);
      const right = paintCheekPoint(s, 1);
      drawFlowerCheek(ctx, s, left.x, left.y);
      drawFlowerCheek(ctx, s, right.x, right.y);
      break;
    }
    case 'starEye':
      drawStarEye(ctx, s, cx, -1);
      drawStarEye(ctx, s, cx, 1);
      break;
    case 'ripikaCheeks': {
      const left = paintCheekPoint(s, -1);
      const right = paintCheekPoint(s, 1);
      // Bigger and bolder than the everyday blush (`DEFAULTS.blushR` 0.075) so
      // it reads as a deliberate paint job, not just rosy cheeks.
      drawBlush(ctx, s, left.x, left.y, ART.ripikaCheek, 'disc', s * 0.115);
      drawBlush(ctx, s, right.x, right.y, ART.ripikaCheek, 'disc', s * 0.115);
      break;
    }
  }

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

export interface FacePaintOverlayHandle {
  /** Parent this under the character's head, alongside the base face patch. */
  readonly mesh: Mesh;
  /** Swaps the design, or hides the paint entirely for `null` ("wash off"). */
  setDesign(design: FacePaintDesign | null): void;
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
