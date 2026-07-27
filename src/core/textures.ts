import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { hexToCss, PALETTE } from './palette';
import { Rng } from './mathUtils';
import { markShared } from '../art/style/materials';

/**
 * Every texture in the game is drawn here with the 2D canvas API.
 *
 * The design rule is "no external assets of any kind", so there are no image
 * files, no fonts to download and no atlases — just code that paints pixels.
 * Textures are cached by key because several systems ask for the same wood or
 * stone map and uploading it once keeps the GPU happy.
 */

const cache = new Map<string, Texture>();

function createCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot generate textures.');
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement, repeat: number): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function cached<T extends Texture>(key: string, build: () => T): T {
  const existing = cache.get(key);
  if (existing) return existing as T;
  // This cache owns every texture it hands out, so `disposeTree` must never
  // free one — see the ownership note in `art/style/materials.ts`.
  const texture = markShared(build());
  cache.set(key, texture);
  return texture;
}

/** Soft blotchy grass with little blades and the odd daisy. */
export function grassTexture(repeat = 26): CanvasTexture {
  return cached(`grass:${repeat}`, () => {
    const size = 512;
    const { canvas, ctx } = createCanvas(size);
    const rng = new Rng(0x6a51d);

    ctx.fillStyle = hexToCss(PALETTE.grass);
    ctx.fillRect(0, 0, size, size);

    // Broad soft patches so large areas of lawn don't read as flat colour.
    for (let i = 0; i < 90; i += 1) {
      const x = rng.range(0, size);
      const y = rng.range(0, size);
      const r = rng.range(28, 92);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
      const tone = rng.chance(0.5) ? PALETTE.grassLight : PALETTE.grassDark;
      gradient.addColorStop(0, `${hexToCss(tone)}55`);
      gradient.addColorStop(1, `${hexToCss(tone)}00`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Blades. Drawn four times with wrap offsets so the tile seams disappear.
    ctx.lineCap = 'round';
    for (let i = 0; i < 1400; i += 1) {
      const x = rng.range(0, size);
      const y = rng.range(0, size);
      const height = rng.range(4, 11);
      const lean = rng.range(-3, 3);
      ctx.strokeStyle = rng.chance(0.5) ? hexToCss(PALETTE.grassLight) : hexToCss(PALETTE.grassDark);
      ctx.globalAlpha = rng.range(0.25, 0.6);
      ctx.lineWidth = rng.range(1, 2.2);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + lean * 0.5, y - height * 0.6, x + lean, y - height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Daisies and buttercups — tiny, but they make the lawn feel loved.
    for (let i = 0; i < 60; i += 1) {
      const x = rng.range(0, size);
      const y = rng.range(0, size);
      const petal = rng.chance(0.6) ? PALETTE.blossomWhite : PALETTE.flowerYellow;
      ctx.fillStyle = hexToCss(petal);
      for (let p = 0; p < 5; p += 1) {
        const angle = (p / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(angle) * 2.4, y + Math.sin(angle) * 2.4, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = hexToCss(PALETTE.flowerYellow);
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    return finish(canvas, repeat);
  });
}

/** Warm sandy path with pebbles, for the winding walkways. */
export function pathTexture(repeat = 8): CanvasTexture {
  return cached(`path:${repeat}`, () => {
    const size = 256;
    const { canvas, ctx } = createCanvas(size);
    const rng = new Rng(0x1f00d);

    ctx.fillStyle = hexToCss(PALETTE.pathSand);
    ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 220; i += 1) {
      const x = rng.range(0, size);
      const y = rng.range(0, size);
      const r = rng.range(1.2, 4.4);
      ctx.fillStyle = rng.chance(0.55)
        ? hexToCss(PALETTE.pathSandDark)
        : hexToCss(PALETTE.pathEdge);
      ctx.globalAlpha = rng.range(0.3, 0.85);
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * rng.range(0.6, 1), rng.range(0, Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    return finish(canvas, repeat);
  });
}

/** Rounded pink cobbles — the park's signature wall material. */
export function pinkStoneTexture(repeatX = 4, repeatY = 1): CanvasTexture {
  return cached(`pinkStone:${repeatX}:${repeatY}`, () => {
    const size = 256;
    const { canvas, ctx } = createCanvas(size);
    const rng = new Rng(0xb100d5);

    ctx.fillStyle = hexToCss(PALETTE.stonePinkDark);
    ctx.fillRect(0, 0, size, size);

    const rows = 5;
    const rowHeight = size / rows;
    for (let row = 0; row < rows; row += 1) {
      const offset = row % 2 === 0 ? 0 : rowHeight * 0.9;
      for (let col = -1; col < 5; col += 1) {
        const w = rowHeight * 1.8;
        const x = col * w + offset;
        const y = row * rowHeight;
        const pad = 3;
        const shade = rng.range(0, 1);
        ctx.fillStyle =
          shade > 0.7
            ? hexToCss(PALETTE.stonePinkLight)
            : shade > 0.3
              ? hexToCss(PALETTE.stonePink)
              : '#ffd2e3';
        roundedRect(ctx, x + pad, y + pad, w - pad * 2, rowHeight - pad * 2, 9);
        ctx.fill();
        // Top highlight makes each cobble read as domed rather than flat.
        ctx.fillStyle = '#ffffff44';
        roundedRect(ctx, x + pad + 3, y + pad + 2, w - pad * 2 - 6, rowHeight * 0.3, 6);
        ctx.fill();
      }
    }

    const texture = finish(canvas, 1);
    texture.repeat.set(repeatX, repeatY);
    return texture;
  });
}

/** Vertical plank boards with knots, for the wooden hiding walls. */
export function woodTexture(repeatX = 3, repeatY = 1): CanvasTexture {
  return cached(`wood:${repeatX}:${repeatY}`, () => {
    const size = 256;
    const { canvas, ctx } = createCanvas(size);
    const rng = new Rng(0xdecaf);

    ctx.fillStyle = hexToCss(PALETTE.wood);
    ctx.fillRect(0, 0, size, size);

    const planks = 5;
    const plankWidth = size / planks;
    for (let i = 0; i < planks; i += 1) {
      const x = i * plankWidth;
      const tint = rng.range(0, 1);
      ctx.fillStyle =
        tint > 0.66
          ? hexToCss(PALETTE.woodLight)
          : tint > 0.33
            ? hexToCss(PALETTE.wood)
            : hexToCss(PALETTE.woodDark);
      ctx.fillRect(x + 1.5, 0, plankWidth - 3, size);

      // Grain
      ctx.strokeStyle = `${hexToCss(PALETTE.woodDark)}55`;
      ctx.lineWidth = 1;
      for (let g = 0; g < 7; g += 1) {
        const gx = x + rng.range(4, plankWidth - 4);
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.bezierCurveTo(gx + rng.range(-4, 4), size / 3, gx + rng.range(-4, 4), (size * 2) / 3, gx, size);
        ctx.stroke();
      }

      // A knot or two per plank
      if (rng.chance(0.7)) {
        const kx = x + plankWidth / 2 + rng.range(-6, 6);
        const ky = rng.range(20, size - 20);
        ctx.strokeStyle = `${hexToCss(PALETTE.woodDark)}aa`;
        ctx.lineWidth = 1.6;
        for (let r = 2; r < 8; r += 2) {
          ctx.beginPath();
          ctx.ellipse(kx, ky, r, r * 1.5, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Plank gap shadow
      ctx.fillStyle = '#00000022';
      ctx.fillRect(x, 0, 2, size);
    }

    const texture = finish(canvas, 1);
    texture.repeat.set(repeatX, repeatY);
    return texture;
  });
}

/* ---------------------------------------------------------------------------
   Canvas-painted text and the TEXT RULE (GAME_DESIGN.md).

   A canvas texture has no "font size on screen" of its own: what a child
   actually sees is the font's size *as a fraction of the canvas*, multiplied
   by however many screen pixels the thing wearing that texture covers. So the
   rule is kept in two places, and both are exported from here rather than
   being copied around:

   - the fractions below say how big the text is relative to its canvas;
   - the caller (`ui/NameLabel.ts`, `ui/SpeechBubble.ts`, `.sign-reader-face`
     in style.css) sizes the canvas on screen so that fraction lands at or
     above `uiScale.ts`'s `minTextPx()`.
--------------------------------------------------------------------------- */

/** Canvas height of the name pill (see {@link nameLabelTexture}). */
export const NAME_LABEL_CANVAS_HEIGHT = 160;
/** Font size the name is painted at inside that canvas. */
export const NAME_LABEL_FONT_PX = 62;
/** Canvas width of a sign board (see {@link signTexture}). */
export const SIGN_CANVAS_WIDTH = 512;
/** The smallest text on a sign board: its subtitle. */
export const SIGN_SUBTITLE_FONT_PX = 40;

export interface SignOptions {
  /** Main line, e.g. "Ferris wheel". */
  title: string;
  /** Small line underneath, e.g. "coming soon!". */
  subtitle?: string;
  /** Big emoji-ish glyph drawn above the text. Plain text — no image assets. */
  glyph?: string;
  /** Board colour behind the text. */
  background?: number;
  /** Accent used for the border and the title. */
  accent?: number;
}

/**
 * A cute wooden-sign face: rounded board, chunky border, hand-lettered feel.
 * Used for the "coming soon" plots and any future signage.
 */
export function signTexture(options: SignOptions): CanvasTexture {
  const key = `sign:${options.title}|${options.subtitle ?? ''}|${options.glyph ?? ''}|${options.background ?? 0}|${options.accent ?? 0}`;
  return cached(key, () => {
    const width = SIGN_CANVAS_WIDTH;
    const height = 288;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');

    const background = options.background ?? PALETTE.signBoard;
    const accent = options.accent ?? PALETTE.markerPink;

    ctx.fillStyle = hexToCss(background);
    roundedRect(ctx, 0, 0, width, height, 34);
    ctx.fill();

    ctx.strokeStyle = hexToCss(accent);
    ctx.lineWidth = 14;
    roundedRect(ctx, 9, 9, width - 18, height - 18, 28);
    ctx.stroke();

    ctx.strokeStyle = '#ffffffcc';
    ctx.lineWidth = 4;
    roundedRect(ctx, 22, 22, width - 44, height - 44, 20);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let textCentre = height / 2 + 6;
    if (options.glyph) {
      ctx.font = '64px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
      ctx.fillText(options.glyph, width / 2, 86);
      textCentre = height / 2 + 34;
    }

    // `fillText`'s max-width argument condenses a long title rather than
    // letting it run off the board — the alternative (shrinking the font) is
    // exactly what the TEXT RULE forbids.
    ctx.font = 'bold 56px "Trebuchet MS", "Segoe UI", sans-serif';
    ctx.fillStyle = hexToCss(accent);
    ctx.fillText(options.title, width / 2, textCentre, width - 80);

    if (options.subtitle) {
      // Bumped from 34px: at the size the sign reader shows a board (see
      // `.sign-reader-face` in style.css) this is the line that decides
      // whether the smallest text on a sign clears the minimum.
      ctx.font = `bold ${SIGN_SUBTITLE_FONT_PX}px "Trebuchet MS", "Segoe UI", sans-serif`;
      ctx.fillStyle = hexToCss(PALETTE.ink);
      ctx.globalAlpha = 0.75;
      ctx.fillText(options.subtitle, width / 2, textCentre + 52, width - 80);
      ctx.globalAlpha = 1;
    }

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  });
}

/**
 * The floating name pill above a character's head.
 *
 * Not cached by key alone — names change when the player renames themselves —
 * so callers should dispose the previous texture when they rebuild it.
 */
export function nameLabelTexture(name: string, accent: number = PALETTE.markerPink): CanvasTexture {
  const width = 512;
  const height = NAME_LABEL_CANVAS_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  ctx.font = `bold ${NAME_LABEL_FONT_PX}px "Trebuchet MS", "Segoe UI", sans-serif`;
  const textWidth = ctx.measureText(name).width;
  const pillWidth = Math.min(width - 16, textWidth + 96);
  const pillX = (width - pillWidth) / 2;
  const pillY = 26;
  const pillHeight = 96;

  // Drop shadow
  ctx.fillStyle = '#4a3a5233';
  roundedRect(ctx, pillX, pillY + 8, pillWidth, pillHeight, pillHeight / 2);
  ctx.fill();

  ctx.fillStyle = '#fff6ea';
  roundedRect(ctx, pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
  ctx.fill();

  ctx.strokeStyle = hexToCss(accent);
  ctx.lineWidth = 8;
  roundedRect(ctx, pillX + 4, pillY + 4, pillWidth - 8, pillHeight - 8, (pillHeight - 8) / 2);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = hexToCss(PALETTE.ink);
  ctx.fillText(name, width / 2, pillY + pillHeight / 2 + 3);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Soft round blob used for fairy-light glows and the sun/moon halo. */
export function glowTexture(colour = 0xffffff): CanvasTexture {
  return cached(`glow:${colour}`, () => {
    const size = 128;
    const { canvas, ctx } = createCanvas(size);
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    const css = hexToCss(colour);
    gradient.addColorStop(0, `${css}ff`);
    gradient.addColorStop(0.35, `${css}88`);
    gradient.addColorStop(1, `${css}00`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  });
}

/** Frees every cached texture. Only needed when tearing the game down. */
export function disposeTextureCache(): void {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
