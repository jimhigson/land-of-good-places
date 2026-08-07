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

/**
 * Chunky rounded mosaic tiles, for The Land Hotel's reception floor.
 *
 * Jim, 6 August 2026, after playing the hotel: *"the hotel looks much too
 * plain — make the reception have an interesting and playful mosaic on the
 * tiles of the floor."*
 *
 * ### Why this is allowed to be a map at all
 *
 * ART_DIRECTION §7 is firm that **flat colours are material colours, not
 * maps** — a texture that only carries one colour is a canvas doing a
 * material's job. A mosaic is the case the same line explicitly leaves room
 * for ("tiling maps 512²"): the floor is genuinely made of *many* small
 * differently-coloured pieces, and the honest alternative — one mesh per
 * tile — is 1 300 draw calls for a lobby floor.
 *
 * ### Why it still reads under the toon ramp
 *
 * §3's governing rule: a painted texture has to look like something that
 * *could have been* built as geometry. So every tile here is a big flat fill
 * with a hard edge — an 8 × 8 grid of 64 px cells, rounded corners, a pale
 * grout gap between them, and a flat top highlight band exactly like the one
 * `pinkStoneTexture` uses to make a cobble read as domed. No gradients, no
 * noise. At the repeat the lobby uses (one canvas per 4 m) a tile is half a
 * metre across, which is chunky enough to survive being toon-banded and to be
 * legible from the iso camera rather than dissolving into fizz.
 *
 * Every sixth-ish tile carries one flat motif — a heart, a star, a flower or
 * a paw print — in another palette colour. They are what makes it *playful*
 * rather than merely tiled, and they are drawn as solid silhouettes for the
 * same reason the eyes are: a shape with an outline reads at gameplay
 * distance, a shaded one does not.
 *
 * The grid is axis-aligned at exact multiples of the cell size, so the canvas
 * wraps seamlessly and a non-integer `repeat` (the lobby is 26 × 20 m, i.e.
 * 6.5 × 5 canvases) simply cuts a tile at the plate's edge rather than
 * showing a seam.
 */
export function mosaicTexture(repeatX = 6, repeatY = 6): CanvasTexture {
  return cached(`mosaic:${repeatX}:${repeatY}`, () => {
    const size = 512;
    const cells = 8;
    const cell = size / cells;
    const { canvas, ctx } = createCanvas(size);
    const rng = new Rng(0x0541c);

    // Grout first, as a full-bleed fill: every tile is then drawn inset, and
    // what shows between them is this.
    ctx.fillStyle = hexToCss(PALETTE.stonePinkLight);
    ctx.fillRect(0, 0, size, size);

    const tileColours = [
      PALETTE.markerPink,
      PALETTE.markerMint,
      PALETTE.markerSky,
      PALETTE.markerLemon,
      PALETTE.markerLilac,
      PALETTE.blossomWhite,
      PALETTE.flowerViolet,
      PALETTE.stonePink,
    ] as const;
    const motifColours = [
      PALETTE.markerPink,
      PALETTE.markerLilac,
      PALETTE.flowerYellow,
      PALETTE.markerMint,
      PALETTE.markerSky,
    ] as const;
    const motifs = ['heart', 'star', 'flower', 'paw'] as const;

    for (let row = 0; row < cells; row += 1) {
      for (let col = 0; col < cells; col += 1) {
        const x = col * cell;
        const y = row * cell;
        const pad = 4;
        const colour = rng.pick(tileColours);
        ctx.fillStyle = hexToCss(colour);
        roundedRect(ctx, x + pad, y + pad, cell - pad * 2, cell - pad * 2, 14);
        ctx.fill();

        // The glaze highlight — one flat band across the top third, the same
        // trick (and the same strength) as the pink cobbles'.
        ctx.fillStyle = '#ffffff3a';
        roundedRect(ctx, x + pad + 4, y + pad + 3, cell - pad * 2 - 8, (cell - pad * 2) * 0.3, 8);
        ctx.fill();

        if (rng.chance(0.28)) {
          drawMotif(
            ctx,
            rng.pick(motifs),
            x + cell / 2,
            y + cell / 2,
            cell * 0.3,
            hexToCss(pickContrast(motifColours, colour, rng)),
          );
        }
      }
    }

    const texture = finish(canvas, 1);
    texture.repeat.set(repeatX, repeatY);
    return texture;
  });
}

/** A motif colour that is not the colour of the tile it is painted on. */
function pickContrast(choices: readonly number[], avoid: number, rng: Rng): number {
  const usable = choices.filter((colour) => colour !== avoid);
  return rng.pick(usable.length > 0 ? usable : choices);
}

/**
 * One flat mosaic motif, centred, drawn as a solid silhouette.
 *
 * Each is built from arcs and straight lines only — no curve a child could not
 * have cut out of card — because the whole point is that it reads as an inlaid
 * tile shape rather than as a picture printed on the floor.
 */
function drawMotif(
  ctx: CanvasRenderingContext2D,
  motif: 'heart' | 'star' | 'flower' | 'paw',
  cx: number,
  cy: number,
  r: number,
  colour: string,
): void {
  ctx.fillStyle = colour;
  switch (motif) {
    case 'heart': {
      ctx.beginPath();
      ctx.arc(cx - r * 0.45, cy - r * 0.28, r * 0.5, Math.PI * 0.9, Math.PI * 1.95);
      ctx.arc(cx + r * 0.45, cy - r * 0.28, r * 0.5, Math.PI * 1.05, Math.PI * 0.1);
      ctx.lineTo(cx, cy + r * 0.85);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const radius = i % 2 === 0 ? r : r * 0.44;
        const px = cx + Math.cos(angle) * radius;
        const py = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'flower': {
      for (let i = 0; i < 5; i += 1) {
        const angle = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * r * 0.52, cy + Math.sin(angle) * r * 0.52, r * 0.42, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = hexToCss(PALETTE.flowerYellow);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case 'paw': {
      ctx.beginPath();
      ctx.ellipse(cx, cy + r * 0.34, r * 0.56, r * 0.46, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const [dx, dy, rr] of [
        [-0.66, -0.5, 0.24],
        [-0.24, -0.78, 0.25],
        [0.24, -0.78, 0.25],
        [0.66, -0.5, 0.24],
      ] as const) {
        ctx.beginPath();
        ctx.arc(cx + dx * r, cy + dy * r, rr * r, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
  }
}

/**
 * Diagonal yellow-and-black hazard tape, for the Rail Race duck bar.
 *
 * Jim, 1 August 2026: "give it a yellow-and-black texture like diagonal
 * hazard/warning tape." Painted here, not baked into the Blender asset —
 * the same "shape from the asset, appearance from code" split the kid's
 * skin/hair and the cart's lane colour already use (ART_DIRECTION.md §7),
 * so the bar's material stays a plain, swappable texture rather than a
 * second copy of it living inside the geometry file. The asset's own UVs
 * (`art/blend/duckbar_export.py`, a cube projection) run `u` along the bar's
 * length, which is what makes the stripes repeat evenly along it rather
 * than stretching across its short ends.
 *
 * Drawn by rotating the canvas 45° and filling wide vertical bands across a
 * generously oversized area (comfortably past the rotated canvas's own
 * diagonal, `size * sqrt(2)`) — simpler and exactly as sharp as computing
 * each stripe's clipped parallelogram by hand, and immune to the classic
 * rotated-fill trap of leaving corners unpainted.
 */
export function hazardTapeTexture(repeat = 4): CanvasTexture {
  return cached(`hazardTape:${repeat}`, () => {
    const size = 256;
    const { canvas, ctx } = createCanvas(size);

    ctx.fillStyle = hexToCss(PALETTE.markerLemon);
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = hexToCss(PALETTE.ink);
    const stripe = size / 4;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(Math.PI / 4);
    ctx.translate(-size, -size);
    for (let x = -size; x < size * 3; x += stripe * 2) {
      ctx.fillRect(x, -size, stripe, size * 4);
    }
    ctx.restore();

    const texture = finish(canvas, 1);
    // Repeats along the bar's length only — see this function's own doc
    // comment on why that is the `u` axis, not both.
    texture.repeat.set(repeat, 1);
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
   - the caller (`ui/NameLabel.ts`, `ui/SpeechBubble.ts`) sizes the canvas on
     screen so that fraction lands at or above `uiScale.ts`'s `minTextPx()`.

   The park's sign boards used to be the third of these. There are no sign
   boards any more (family ruling, 28 July 2026) and `signTexture` went with
   them: what a thing is called is DOM text now, so it is simply covered by the
   TEXT RULE's ordinary `--lgp-text-min` like every other word in the game.
--------------------------------------------------------------------------- */

/** Canvas height of the name pill (see {@link nameLabelTexture}). */
export const NAME_LABEL_CANVAS_HEIGHT = 160;
/** Font size the name is painted at inside that canvas. */
export const NAME_LABEL_FONT_PX = 62;
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
