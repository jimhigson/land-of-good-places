import { CanvasTexture, Mesh, PlaneGeometry, SRGBColorSpace } from 'three';
import { ART } from '../../art/style/artPalette';
import { decal, toonMaterial } from '../../art/style/materials';
import { hexToCss, PALETTE } from '../../core/palette';

/**
 * Floor arrows — cute painted decals marking which way an escalator or stair
 * flight goes (GAME_DESIGN.md item 31a/b: "make it obvious what the thing
 * is"). A ride reads as "an escalator, going up" far more readily with a
 * chevron painted at each end than from the geometry alone, especially at
 * iso distance on a small screen.
 *
 * One canvas-textured plane, laid flat like a road marking: a soft rounded
 * pad in the building's own trim colour, with a bold double chevron on top
 * in the cheerful marker-lemon accent used for callouts elsewhere (the party
 * hat's stripe). Painted once and shared by every arrow in the game — see
 * the "under 40 canvas textures" budget note in ART_DIRECTION.md §7 — since
 * every arrow is the same glyph, just placed and turned differently by its
 * caller.
 *
 * **Orientation contract**: with no extra rotation, `createFloorArrow()`
 * points world **-Z**. To turn it, set `rotation.z` (NOT `.y`) *before* the
 * mesh's own baked-in `rotation.x` has laid it flat conceptually turns the
 * decal round on the table before it goes down — `.y` is the in-plane axis
 * the flattening rotates *out* of horizontal, so it silently no-ops on which
 * way the chevron points once flat. `rotation.z = Math.PI` flips it to point
 * +Z; see the callers in `Escalators.ts` (unrotated, both ends) and
 * `Stairs.ts` (one end flipped, for the switchback's reversed top flight).
 */

let arrowTexture: CanvasTexture | null = null;

function floorArrowTexture(): CanvasTexture {
  if (arrowTexture) return arrowTexture;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot paint a floor arrow.');

  // The pad: a soft rounded rectangle, so the chevrons read as "a sign
  // painted on the floor" rather than shapes floating over bare tile.
  const padW = size * 0.6;
  const padH = size * 0.86;
  roundedRect(ctx, (size - padW) / 2, (size - padH) / 2, padW, padH, padW * 0.24);
  ctx.globalAlpha = 0.82;
  ctx.fillStyle = hexToCss(PALETTE.buildingTrim);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Two stacked chevrons pointing at the top of the canvas — see the module
  // doc comment for how that maps to world -Z once the plane is laid flat.
  // Two ticks, not one, reads as *movement* rather than a static signpost.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  paintChevron(ctx, size * 0.5, size * 0.42, size * 0.15);
  paintChevron(ctx, size * 0.5, size * 0.61, size * 0.15);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  arrowTexture = texture;
  return texture;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** One thick "^" tick, apex at the top — an ink outline stroke under a bright fill stroke. */
function paintChevron(ctx: CanvasRenderingContext2D, cx: number, cy: number, half: number): void {
  const stroke = (lineWidth: number, colour: string) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(cx - half, cy + half * 0.85);
    ctx.lineTo(cx, cy - half * 0.85);
    ctx.lineTo(cx + half, cy + half * 0.85);
    ctx.stroke();
  };
  stroke(half * 0.66, hexToCss(ART.ink));
  stroke(half * 0.42, hexToCss(PALETTE.markerLemon));
}

export interface FloorArrowOptions {
  /** Across the direction of travel, in metres. */
  readonly width?: number;
  /** Along the direction of travel, in metres. */
  readonly length?: number;
}

/**
 * One floor arrow, laid flat and ready to place: set its `.position`, then
 * rotate `.rotation.y` to point the way the ramp actually climbs (see the
 * module doc comment — unrotated, it points -Z). Never casts or receives a
 * shadow, and sits a hair off the deck's own `renderOrder` to avoid
 * z-fighting with the floor it is painted on.
 */
export function createFloorArrow(options: FloorArrowOptions = {}): Mesh {
  const width = options.width ?? 1.0;
  const length = options.length ?? 1.3;

  const material = toonMaterial(0xffffff, {
    map: floorArrowTexture(),
    transparent: true,
    depthWrite: false,
  });
  const mesh = decal(new Mesh(new PlaneGeometry(width, length), material));
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  return mesh;
}
