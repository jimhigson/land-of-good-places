import { CanvasTexture, Group, Mesh, SRGBColorSpace, Vector3 } from 'three';
import { GATE_ARCH_GLB_BASE64 } from '../assets/gateArchGlb';
import { base64ToArrayBuffer, readGlbParts, type GlbPart } from '../style/glb';
import { addOutline, disposeTree, markShared, solid, toonMaterial } from '../style/materials';
import { visibleBounds } from '../style/measure';
import type { AssetHandle } from '../style/asset';
import { hexToCss, PALETTE } from '../../core/palette';
import { TAU } from '../../core/mathUtils';
import {
  ENTRANCE_GATE_HALF_WIDTH,
  ENTRANCE_GATE_POST_HEIGHT,
} from '../../world/entrance/layout';
import { TALLEST_CHILD_HEIGHT } from './kid';

/**
 * **The park's decorative entrance arch** — piers, a segmental arch band, a
 * hanging sign that says LAND OF GOOD PLACES, and a ferris-wheel roundel on top.
 *
 * Jim, 2026-09-03: *"what I want now is a decorative arch, designed in Blender,
 * with a project logo of a ferris wheel and 'LAND OF GOOD PLACES' written onto
 * it"*, and, asked whether the logo should be modelled: *"yeah it is fine to
 * just be a texture for the design"*.
 *
 * This is the first thing anybody sees. The cat bus stops outside it and a
 * six-year-old walks under it, so it is sized to be walked under and to be
 * *read* from out on the pavement, not from the angle a render was taken at.
 *
 * ## Where the numbers live
 *
 * Three owners, and no copies of anything:
 *
 * * **`world/entrance/layout.ts`** owns the gateway — `ENTRANCE_GATE_HALF_WIDTH`
 *   and `ENTRANCE_GATE_POST_HEIGHT`. `art/blend/gate_arch_build.py` reads both
 *   with `ts_const` and stands the piers on them, and {@link assertFitsItsGate}
 *   below re-measures the shipped mesh against the same two constants at load.
 *   The `.glb` is a rigid model, so a park that re-sizes its own gateway makes
 *   this asset stale — which is a thing to be told loudly rather than to
 *   discover as an arch standing beside its opening.
 * * **The mesh** owns every shape number. Nothing in this file re-derives an
 *   arch radius or a sign width; everything is measured off the geometry that
 *   shipped ({@link GATE_ARCH_PIER_KEEP_OUT}, {@link GATE_ARCH_CLEAR_HEIGHT},
 *   the two canvas aspect ratios). That is the bridge kit's bug pointed the
 *   other way, and the castle kit's answer to it.
 * * **This file** owns colour and paint, exactly as `castleAssets.ts` does for
 *   the castle. The `.glb` carries no material and no texture.
 *
 * ## The lettering and the logo are painted into the arch's own UV space
 *
 * Not floated in front of it on a second mesh. Two nodes carry UVs — the sign
 * plank and the roundel — and each takes one canvas painted across its own
 * surface. `src/art/models/CLAUDE.md` is the account of why: a second surface
 * has to be kept in step with the first by hand, and every property of it
 * (winding, stand-off, relief) is a way to get that wrong. There is nothing to
 * keep in step if there is only one surface.
 *
 * The painted art still has to read as *geometry* rather than as a sticker
 * (ART_DIRECTION §3's governing rule): flat fills, bold ink outlines, shapes
 * with a clear silhouette. No gradients doing shading's job.
 */

const parts: Map<string, GlbPart> = readGlbParts(base64ToArrayBuffer(GATE_ARCH_GLB_BASE64));

// ---------------------------------------------------------------------------
// Colour.
// ---------------------------------------------------------------------------

interface PartStyle {
  readonly colour: number;
  /** Inverted-hull outline thickness in local metres, or omitted for none. */
  readonly outline?: number;
  /** Painted canvas for this part, in its own UV space. */
  readonly paint?: () => CanvasTexture;
}

/**
 * One entry per node in `gateArch.glb`. A node with no entry throws at load
 * rather than rendering grey — the castle kit's rule, for the castle kit's
 * reason: a `.glb` that carries its own colours is a second palette nobody can
 * grep, and a missing entry that silently defaults is a part that ships wrong.
 *
 * The pink stone family is the boundary wall's own (`Entrance.ts` builds the
 * wall from `stonePink`/`stonePinkLight`), so the gate reads as a gap cut
 * through the ring rather than a prop dropped in front of it.
 */
const STYLES: Record<string, PartStyle> = {
  'gate-arch-piers': { colour: PALETTE.stonePink, outline: 0.022 },
  'gate-arch-band': { colour: PALETTE.stonePinkLight, outline: 0.022 },
  // The one deliberately loud colour. Nine lemon balls along the top of a pink
  // arch is the whole of what makes this a fairground gate rather than a
  // municipal one, and it is also the asymmetric-ish silhouette break
  // ART_DIRECTION §4 asks for.
  'gate-arch-bobbles': { colour: PALETTE.markerLemon, outline: 0.016 },
  // White base under the map: the cream comes from the painted canvas, so the
  // board's colour and the border painted on it are one decision.
  'gate-arch-sign': { colour: 0xffffff, outline: 0.02, paint: () => gateArchSignTexture() },
  'gate-arch-medallion': {
    colour: 0xffffff,
    outline: 0.022,
    paint: () => gateArchLogoTexture(),
  },
};

// ---------------------------------------------------------------------------
// What the mesh actually is — measured, never re-derived.
// ---------------------------------------------------------------------------

function gateArchPart(name: string): GlbPart {
  const part = parts.get(name);
  if (!part) {
    throw new Error(
      `gateArch: '${name}' is not a node in gateArch.glb. The file has: ` +
        `${[...parts.keys()].sort().join(', ')}.`,
    );
  }
  return part;
}

interface Extent {
  readonly min: Vector3;
  readonly max: Vector3;
}

/** A node's own bounds, straight off the shipped vertices. */
function extentOf(name: string): Extent {
  const geometry = gateArchPart(name).geometry;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) throw new Error(`gateArch: '${name}' has no vertices`);
  return { min: box.min.clone(), max: box.max.clone() };
}

const PIERS = extentOf('gate-arch-piers');
const SIGN = extentOf('gate-arch-sign');
const MEDALLION = extentOf('gate-arch-medallion');

/**
 * Radius of the circle each pier needs, measured from the widest thing on it.
 *
 * **This is the collider, and it is the only collision this asset wants.** Two
 * circles, one per pier, at `x = ±ENTRANCE_GATE_HALF_WIDTH` in the arch's own
 * frame. Nothing else here is solid: the band, the sign and the roundel are all
 * over 3.5 m up, and CLAUDE.md's rule that a child must never walk through what
 * she can see is about things she can reach.
 *
 * The thing this must not cost is the gateway itself — `keepOutsFor` is the
 * single owner of where she has to be able to stand, and a gate that blocks its
 * own doorway is the worst instance of that there is. See
 * {@link GATE_ARCH_CLEAR_WIDTH}, which is what is left between the two circles.
 */
export const GATE_ARCH_PIER_KEEP_OUT = Math.max(
  PIERS.max.x - ENTRANCE_GATE_HALF_WIDTH,
  ENTRANCE_GATE_HALF_WIDTH + PIERS.min.x,
);

/** Clear floor between the two pier colliders, in metres. */
export const GATE_ARCH_CLEAR_WIDTH = 2 * (ENTRANCE_GATE_HALF_WIDTH - GATE_ARCH_PIER_KEEP_OUT);

/**
 * How much air there is under the lowest thing over the gateway — the sign
 * plank's underside.
 *
 * Measured, because the number that matters is where the mesh ended up and not
 * where a constant said to put it. `gate_arch_build.py` asserts the same
 * clearance against `TALLEST_CHILD_HEIGHT` from the other side of the pipeline.
 */
export const GATE_ARCH_CLEAR_HEIGHT = SIGN.min.y;

/**
 * The arch is one rigid model of a gateway the park sizes for itself, so the
 * two can disagree. They cannot disagree *quietly*.
 *
 * A stale `.glb` here is not cosmetic — the piers would stand somewhere other
 * than where `Entrance.ts` cut the wall, and the collider derived above would
 * be in the wrong place with it. Re-run `pnpm run blend:gate-arch`.
 */
function assertFitsItsGate(): void {
  const spanned = PIERS.max.x - PIERS.min.x - 2 * GATE_ARCH_PIER_KEEP_OUT;
  const wanted = 2 * ENTRANCE_GATE_HALF_WIDTH;
  if (Math.abs(spanned - wanted) > 1e-3) {
    throw new Error(
      `gateArch.glb was built for a ${spanned.toFixed(3)} m gateway but ` +
        `ENTRANCE_GATE_HALF_WIDTH now says ${wanted.toFixed(3)} m. ` +
        'Re-run `pnpm run blend:gate-arch`.',
    );
  }
  if (PIERS.max.y < ENTRANCE_GATE_POST_HEIGHT) {
    throw new Error(
      `gateArch.glb's piers stop at ${PIERS.max.y.toFixed(3)} m, below the ` +
        `${ENTRANCE_GATE_POST_HEIGHT} m ENTRANCE_GATE_POST_HEIGHT they were built to.`,
    );
  }
  if (GATE_ARCH_CLEAR_HEIGHT <= TALLEST_CHILD_HEIGHT) {
    throw new Error(
      `gateArch.glb leaves only ${GATE_ARCH_CLEAR_HEIGHT.toFixed(3)} m under its sign, ` +
        `which a ${TALLEST_CHILD_HEIGHT} m child in the tallest hat does not fit through.`,
    );
  }
}

assertFitsItsGate();

// ---------------------------------------------------------------------------
// The paint.
// ---------------------------------------------------------------------------

/** The words. One definition; the canvas below is the only place it is drawn. */
export const GATE_ARCH_WORDS = 'LAND OF GOOD PLACES';

/**
 * Canvas width for the painted sign, in pixels.
 *
 * 1024 across a 5.70 m board is 180 px per metre, which puts a 0.38 m capital
 * at 68 px — comfortably legible at the 10–20 m a child reads this from
 * walking up the road. The height is **derived from the mesh's own aspect
 * ratio** rather than typed, so the pixels stay square whatever the plank
 * becomes.
 */
const SIGN_CANVAS_WIDTH = 1024;
const LOGO_CANVAS_SIZE = 512;

let signTexture: CanvasTexture | null = null;
let logoTexture: CanvasTexture | null = null;

function canvasOf(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable — cannot paint the gate arch.');
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  // Shared and owned here, so `disposeTree` must never free it.
  return markShared(texture);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** A fat five-pointed star, filled with an ink outline. Painted, never built. */
function star(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  fill: string,
  ink: string,
  lineWidth: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? outer : outer * 0.46;
    const a = -Math.PI / 2 + (i * TAU) / 10;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (lineWidth > 0) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

/**
 * **LAND OF GOOD PLACES, painted across the sign plank's own UV map.**
 *
 * A cream board with a pink band round it and the words in plum ink — the
 * park's own signage voice (`welcomeSignTexture`, the hotel's picture mounts),
 * in the rounded playground face rather than the welcome sign's serif, because
 * this is a fairground gate and not a plaque.
 *
 * The type is **fitted to the board's width** rather than set at a fixed pixel
 * size. That is not the TEXT RULE's forbidden shrink-to-fit — that rule is
 * about UI copy, which must reflow rather than shrink. This is one fixed string
 * on one fixed board, and the platform's fallback font metrics are not knowable
 * from here: a size that fits on one machine overflows the plank on another,
 * and a word running off the end of the gate is worse than a word 4% smaller.
 */
function gateArchSignTexture(): CanvasTexture {
  if (signTexture) return signTexture;
  const aspect = (SIGN.max.x - SIGN.min.x) / (SIGN.max.y - SIGN.min.y);
  const width = SIGN_CANVAS_WIDTH;
  const height = Math.round(width / aspect);
  const { canvas, ctx } = canvasOf(width, height);

  const ink = hexToCss(PALETTE.ink);

  // The board face. Fills the whole canvas: everything outside the plank's
  // silhouette clamps to this, which is what makes the rounded ends come out
  // the right cream from the same one texture (ART_DIRECTION §3's
  // `FACE_FILL_INSET` point, applied to a plank).
  ctx.fillStyle = hexToCss(PALETTE.signBoard);
  ctx.fillRect(0, 0, width, height);

  // A painted band round the edge. It reads as a moulding — the thing a
  // painted texture is allowed to be, per §3: something that could have been
  // geometry and wasn't.
  const inset = Math.round(height * 0.075);
  ctx.strokeStyle = hexToCss(PALETTE.markerPink);
  ctx.lineWidth = Math.round(height * 0.075);
  roundedRect(ctx, inset, inset, width - 2 * inset, height - 2 * inset, height * 0.24);
  ctx.stroke();

  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(2, Math.round(height * 0.016));
  const hair = inset + ctx.lineWidth * 2.6;
  roundedRect(ctx, hair, hair, width - 2 * hair, height - 2 * hair, height * 0.2);
  ctx.stroke();

  // Two little stars, one either end, where the words leave room. The park is
  // full of them and they stop the board reading as an empty rectangle with
  // text in it.
  const starR = height * 0.11;
  for (const cx of [width * 0.062, width * 0.938]) {
    star(ctx, cx, height / 2, starR, hexToCss(PALETTE.markerLemon), ink, starR * 0.24);
  }

  const maxTextWidth = width * 0.82;
  let fontPx = Math.round(height * 0.5);
  const face = '900 %PX%px "Trebuchet MS", "Segoe UI Semibold", "Segoe UI", sans-serif';
  ctx.font = face.replace('%PX%', String(fontPx));
  while (ctx.measureText(GATE_ARCH_WORDS).width > maxTextWidth && fontPx > 8) {
    fontPx -= 1;
    ctx.font = face.replace('%PX%', String(fontPx));
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // A soft plum shadow a couple of pixels down. Not a gradient and not
  // shading: it is the offset second colour a sign-writer paints, which is
  // exactly the "could have been geometry" test.
  ctx.fillStyle = hexToCss(PALETTE.stonePinkDark);
  ctx.fillText(GATE_ARCH_WORDS, width / 2, height / 2 + Math.round(height * 0.035));
  ctx.fillStyle = ink;
  ctx.fillText(GATE_ARCH_WORDS, width / 2, height / 2);

  signTexture = finish(canvas);
  return signTexture;
}

/**
 * **The project's mark: the park's own ferris wheel, painted into the roundel's
 * UV map.**
 *
 * Drawn from the ride that is actually standing in the park
 * (`minigames/ferrisWheel/wheelProp.ts`) rather than from a generic wheel, so
 * the emblem and the thing it stands for belong to each other: **twelve**
 * gondolas in the ride's own six colours, cream spokes, a lilac hub, a pink rim
 * and the two splayed pink A-frame legs on their fat pads. The sky behind it is
 * marker-sky with a few stars in it, because it is the *Space* Ferris Wheel and
 * the stars come out on the way up.
 *
 * Flat fills and ink outlines throughout (ART_DIRECTION §3). Nothing here is a
 * gradient, and nothing is shading.
 */
function gateArchLogoTexture(): CanvasTexture {
  if (logoTexture) return logoTexture;
  const size = LOGO_CANVAS_SIZE;
  const { canvas, ctx } = canvasOf(size, size);
  const half = size / 2;
  const ink = hexToCss(PALETTE.ink);

  // The geometric rim of the roundel runs from 0.86 to 1.00 of its radius, so
  // the outer band of this canvas lands on that sloping rim. Painting it the
  // rim colour is what makes the picture stop at the edge of the flat face.
  ctx.fillStyle = hexToCss(PALETTE.stonePinkDark);
  ctx.fillRect(0, 0, size, size);

  const faceR = half * 0.84;
  ctx.beginPath();
  ctx.arc(half, half, faceR, 0, TAU);
  ctx.fillStyle = hexToCss(PALETTE.markerSky);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = size * 0.028;
  ctx.stroke();

  // Stars in the sky behind the wheel, at fixed points — no `Math.random()`
  // anywhere in a builder, and there is nothing here that wants to vary.
  for (const [sx, sy, sr] of [
    [0.24, 0.24, 0.030],
    [0.79, 0.28, 0.024],
    [0.16, 0.55, 0.020],
    [0.86, 0.60, 0.028],
    [0.50, 0.12, 0.022],
  ] as const) {
    star(ctx, sx * size, sy * size, sr * size, hexToCss(PALETTE.blossomWhite), ink, size * 0.006);
  }

  const hubX = half;
  const hubY = half * 0.94;
  const wheelR = size * 0.225;
  const footY = half * 1.66;
  const lineInk = size * 0.014;

  // --- legs, drawn first so the wheel stands in front of them ---------------
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const side of [-1, 1] as const) {
    const topX = hubX + side * size * 0.026;
    const footX = hubX + side * size * 0.215;
    ctx.beginPath();
    ctx.moveTo(topX - side * size * 0.022, hubY);
    ctx.lineTo(topX + side * size * 0.022, hubY);
    ctx.lineTo(footX + side * size * 0.036, footY);
    ctx.lineTo(footX - side * size * 0.036, footY);
    ctx.closePath();
    ctx.fillStyle = hexToCss(PALETTE.stonePink);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = lineInk;
    ctx.stroke();

    // The fat pad under each foot — the wheel sits ON the grass.
    roundedRect(
      ctx,
      footX - size * 0.062,
      footY - size * 0.012,
      size * 0.124,
      size * 0.048,
      size * 0.02,
    );
    ctx.fillStyle = hexToCss(PALETTE.stonePinkDark);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = lineInk;
    ctx.stroke();
  }

  // --- gondolas, hanging from the rim --------------------------------------
  const carColours = [
    PALETTE.markerPink,
    PALETTE.markerLemon,
    PALETTE.markerMint,
    PALETTE.markerSky,
    PALETTE.markerLilac,
    PALETTE.blossomWhite,
  ];
  const cars = 12;
  const carW = size * 0.068;
  const carH = size * 0.056;
  for (let i = 0; i < cars; i += 1) {
    const a = -Math.PI / 2 + (i * TAU) / cars;
    const rx = hubX + Math.cos(a) * wheelR;
    const ry = hubY + Math.sin(a) * wheelR;
    // Every car hangs level, whatever the rim is doing — which is the one
    // thing a ferris wheel drawing has to get right, and the same reason the
    // real ride re-poses its gondolas every frame.
    const top = ry + size * 0.016;
    roundedRect(ctx, rx - carW / 2, top, carW, carH, size * 0.018);
    ctx.fillStyle = hexToCss(carColours[i % carColours.length] as number);
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = lineInk;
    ctx.stroke();
    // The hanger, a short bar up to the rim.
    ctx.beginPath();
    ctx.moveTo(rx, ry);
    ctx.lineTo(rx, top);
    ctx.strokeStyle = ink;
    ctx.lineWidth = size * 0.011;
    ctx.stroke();
  }

  // --- spokes ---------------------------------------------------------------
  for (let i = 0; i < cars; i += 1) {
    const a = -Math.PI / 2 + (i * TAU) / cars;
    const ex = hubX + Math.cos(a) * wheelR;
    const ey = hubY + Math.sin(a) * wheelR;
    ctx.beginPath();
    ctx.moveTo(hubX, hubY);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = ink;
    ctx.lineWidth = size * 0.026;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hubX, hubY);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = hexToCss(PALETTE.buildingWall);
    ctx.lineWidth = size * 0.015;
    ctx.stroke();
  }

  // --- the rim: two rings, the way the ride carries two --------------------
  for (const r of [wheelR, wheelR - size * 0.030]) {
    ctx.beginPath();
    ctx.arc(hubX, hubY, r, 0, TAU);
    ctx.strokeStyle = ink;
    ctx.lineWidth = size * 0.034;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hubX, hubY, r, 0, TAU);
    ctx.strokeStyle = hexToCss(PALETTE.stonePink);
    ctx.lineWidth = size * 0.022;
    ctx.stroke();
  }

  // --- hub ------------------------------------------------------------------
  ctx.beginPath();
  ctx.arc(hubX, hubY, size * 0.055, 0, TAU);
  ctx.fillStyle = hexToCss(PALETTE.markerLilac);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = lineInk;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(hubX, hubY, size * 0.022, 0, TAU);
  ctx.fillStyle = hexToCss(PALETTE.buildingWall);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = size * 0.008;
  ctx.stroke();

  logoTexture = finish(canvas);
  return logoTexture;
}

// ---------------------------------------------------------------------------
// The factory.
// ---------------------------------------------------------------------------

function gateArchMesh(name: string): Mesh {
  const style = STYLES[name];
  if (!style) throw new Error(`gateArch: no style for part '${name}'.`);
  const part = gateArchPart(name);
  const map = style.paint?.();
  const mesh = new Mesh(
    part.geometry,
    toonMaterial(style.colour, map ? { map } : {}),
  );
  mesh.name = name;
  // Every node of this arch is authored in the arch's own frame with its
  // placement baked into vertex positions — `gate_arch_export.py` asserts that
  // no node carries a transform at all — so there is nothing to copy across.
  solid(mesh);
  if (style.outline !== undefined) addOutline(mesh, style.outline);
  return mesh;
}

/**
 * Builds the whole arch: five nodes, all at the handle's origin.
 *
 * **Origin** is the middle of the gateway, on the ground, so
 * `root.position.set(gateX, terrainHeight(gateX, gateZ), gateZ)` seats it with
 * no fudge. **Forward is +Z**, and forward here means *out of the park at the
 * arriving child* — the lettering faces her, so `root.rotation.y` should point
 * +Z down the road the bus comes in on.
 *
 * `height` is measured to the top of the roundel, outline included.
 */
export function createGateArch(): AssetHandle {
  const root = new Group();
  root.name = 'prop.gateArch';
  for (const name of Object.keys(STYLES)) root.add(gateArchMesh(name));
  return {
    root,
    height: visibleBounds(root).top,
    dispose: () => disposeTree(root),
  };
}

/**
 * Where the roundel's middle is, in the arch's own frame — for anyone wanting
 * to hang a light on it or point a `/view` camera at it. Measured, not typed.
 */
export const GATE_ARCH_LOGO_CENTRE_Y = (MEDALLION.min.y + MEDALLION.max.y) / 2;
