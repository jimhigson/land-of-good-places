/**
 * **The park map's illustration kit** — GitHub issue #334.
 *
 * Jim's ask, in his words: *"each building should have a drawing of it on the
 * map (still labelled)"*. So every attraction gets its own small flat-vector
 * picture rather than a coloured dot or a pin with an emoji on it, drawn in a
 * slightly tilted storybook three-quarter view: flat fills, no gradients, a
 * dark outline used sparingly, and a soft shadow underneath so the thing sits
 * on the lawn rather than floating over it.
 *
 * **Nothing in this file knows where anything is.** It is handed a canvas
 * point and a size and it paints; the point always comes from
 * `parkMapContent.ts`, which reads the park that was actually generated. That
 * separation is deliberate and it is the lesson of #234: the moment a drawing
 * routine is allowed to decide *where* as well as *how*, there is a second
 * description of the park's layout for the first one to fall out of step with.
 *
 * The style is drawn from a flat vector fun-park illustration Jim supplied as a
 * **reference only** — it is watermarked commercial stock, so nothing here
 * traces, copies or reproduces it. What was taken is the idiom: the palette
 * below, the flat-colour-plus-soft-shadow treatment, and the choice to show
 * each ride as a recognisable little object.
 *
 * The icon set began on the abandoned `origin/stylized-map` branch, which drew
 * good pictures on top of an invented park outline. The pictures were worth
 * keeping; the invented outline is exactly what this PR removes.
 */

/**
 * The map's palette.
 *
 * Deliberately its own, and deliberately *not* `core/palette.ts`. That palette
 * describes the park in three dimensions under a warm sun — pastel, high-key,
 * tuned for toon-shaded geometry. A flat illustration read at a glance on a
 * phone needs more contrast between neighbouring flat areas than those pastels
 * give, so this is the reference's own register: olive lawn, cream paths,
 * brick red, teal, mustard, deep purple, warm grey.
 */
export const MAP_PALETTE = {
  paper: '#f7f0e2',
  lawn: '#a3c057',
  lawnDeep: '#8bab45',
  lawnEdge: '#7a9a3c',
  path: '#fdf6e6',
  pathEdge: '#e6d8bb',
  water: '#4fa8c4',
  waterLight: '#7fcbe0',
  brick: '#c8553d',
  mustard: '#e8b33c',
  teal: '#3d8c9e',
  purple: '#5c4b8a',
  grey: '#9a958f',
  cream: '#fbf3e4',
  ink: '#3a3340',
} as const;

const INK = MAP_PALETTE.ink;

export type IconDrawer = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
) => void;

// ------------------------------------------------------------------ helpers

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** Fill the current path flat, then outline it. The house style, in one call. */
function outlined(ctx: CanvasRenderingContext2D, fill: string, lineWidth = 2): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/**
 * The soft ellipse under every object.
 *
 * One shadow per icon, drawn by the caller before the icon itself, so the
 * whole map shares one light direction and nothing has to remember to draw its
 * own. Flat art with no shadow reads as stickers scattered on a background;
 * with it, each object sits on the grass.
 */
export function drawGroundShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(58, 51, 64, 0.16)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.42, size * 0.4, size * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// -------------------------------------------------------------------- icons

/** A lollipop tree. Drawn at real foliage positions, never scattered by us. */
function drawTree(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.fillStyle = '#8a5a34';
  ctx.strokeStyle = INK;
  ctx.lineWidth = size * 0.05;
  roundRectPath(ctx, cx - size * 0.07, cy - size * 0.02, size * 0.14, size * 0.36, size * 0.05);
  ctx.fill();
  ctx.stroke();
  // Three overlapping blobs, so the canopy is rounded but not a plain circle.
  ctx.beginPath();
  ctx.arc(cx - size * 0.15, cy - size * 0.12, size * 0.24, 0, Math.PI * 2);
  ctx.arc(cx + size * 0.15, cy - size * 0.16, size * 0.21, 0, Math.PI * 2);
  ctx.arc(cx, cy - size * 0.32, size * 0.24, 0, Math.PI * 2);
  outlined(ctx, '#5f9440', size * 0.06);
  ctx.restore();
}

function drawFerrisWheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  const r = size * 0.42;
  ctx.strokeStyle = MAP_PALETTE.brick;
  ctx.lineWidth = size * 0.06;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.6, cy + r * 0.95);
  ctx.lineTo(cx, cy + r * 0.3);
  ctx.moveTo(cx + r * 0.6, cy + r * 0.95);
  ctx.lineTo(cx, cy + r * 0.3);
  ctx.stroke();
  // Spokes, then the rim over them, then a cabin at each spoke end.
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    ctx.strokeStyle = 'rgba(200, 85, 61, 0.55)';
    ctx.lineWidth = size * 0.025;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = MAP_PALETTE.brick;
  ctx.lineWidth = size * 0.075;
  ctx.stroke();
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, size * 0.075, 0, Math.PI * 2);
    outlined(ctx, i % 2 === 0 ? MAP_PALETTE.mustard : MAP_PALETTE.teal, size * 0.035);
  }
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.06, 0, Math.PI * 2);
  outlined(ctx, MAP_PALETTE.cream, size * 0.035);
  ctx.restore();
}

/** The rail race — a red track looping round a grey mountain. */
function drawCoaster(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.46, cy + size * 0.38);
  ctx.quadraticCurveTo(cx - size * 0.36, cy - size * 0.08, cx - size * 0.06, cy - size * 0.38);
  ctx.quadraticCurveTo(cx + size * 0.1, cy - size * 0.5, cx + size * 0.28, cy - size * 0.24);
  ctx.quadraticCurveTo(cx + size * 0.48, cy - size * 0.04, cx + size * 0.42, cy + size * 0.38);
  ctx.closePath();
  outlined(ctx, MAP_PALETTE.grey, size * 0.05);
  // Snowcap, so the mound reads as a mountain rather than a grey blob.
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.13, cy - size * 0.29);
  ctx.quadraticCurveTo(cx + size * 0.1, cy - size * 0.5, cx + size * 0.2, cy - size * 0.3);
  ctx.quadraticCurveTo(cx + size * 0.04, cy - size * 0.24, cx - size * 0.13, cy - size * 0.29);
  ctx.closePath();
  ctx.fillStyle = MAP_PALETTE.cream;
  ctx.fill();
  ctx.strokeStyle = MAP_PALETTE.brick;
  ctx.lineWidth = size * 0.075;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.48, cy + size * 0.26);
  ctx.bezierCurveTo(
    cx - size * 0.1, cy + size * 0.08,
    cx - size * 0.04, cy - size * 0.5,
    cx + size * 0.26, cy - size * 0.26,
  );
  ctx.bezierCurveTo(
    cx + size * 0.46, cy - size * 0.1,
    cx + size * 0.08, cy - size * 0.02,
    cx + size * 0.18, cy + size * 0.2,
  );
  ctx.stroke();
  ctx.restore();
}

function drawSpookyHouse(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  const halfW = size * 0.3;
  const bodyTop = cy - size * 0.04;
  const bodyH = size * 0.44;
  ctx.beginPath();
  ctx.rect(cx - halfW, bodyTop, halfW * 2, bodyH);
  outlined(ctx, MAP_PALETTE.purple, size * 0.05);
  ctx.beginPath();
  ctx.moveTo(cx - halfW * 1.2, bodyTop);
  ctx.lineTo(cx, cy - size * 0.42);
  ctx.lineTo(cx + halfW * 1.2, bodyTop);
  ctx.closePath();
  outlined(ctx, '#463571', size * 0.05);
  ctx.beginPath();
  ctx.arc(cx, bodyTop + bodyH * 0.42, size * 0.08, 0, Math.PI * 2);
  outlined(ctx, MAP_PALETTE.mustard, size * 0.035);
  // A ghost peeking round the side — the one bit of character in the set.
  ctx.save();
  ctx.translate(cx + halfW * 1.05, bodyTop + bodyH * 0.5);
  ctx.beginPath();
  ctx.arc(0, -size * 0.05, size * 0.1, Math.PI, 0);
  ctx.lineTo(size * 0.1, size * 0.09);
  ctx.quadraticCurveTo(size * 0.05, size * 0.03, 0, size * 0.09);
  ctx.quadraticCurveTo(-size * 0.05, size * 0.03, -size * 0.1, size * 0.09);
  ctx.closePath();
  outlined(ctx, '#f6f2ff', size * 0.035);
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(-size * 0.032, -size * 0.05, size * 0.014, 0, Math.PI * 2);
  ctx.arc(size * 0.032, -size * 0.05, size * 0.014, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

function drawDodgems(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.06, size * 0.46, size * 0.32, 0, 0, Math.PI * 2);
  outlined(ctx, MAP_PALETTE.teal, size * 0.05);
  ctx.fillStyle = MAP_PALETTE.mustard;
  ctx.strokeStyle = INK;
  ctx.lineWidth = size * 0.04;
  roundRectPath(ctx, cx - size * 0.2, cy - size * 0.08, size * 0.4, size * 0.2, size * 0.07);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.13, size * 0.1, 0, Math.PI * 2);
  outlined(ctx, MAP_PALETTE.brick, size * 0.04);
  ctx.strokeStyle = INK;
  ctx.lineWidth = size * 0.025;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.2);
  ctx.lineTo(cx, cy - size * 0.32);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.34, size * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = MAP_PALETTE.mustard;
  ctx.fill();
  ctx.restore();
}

function drawWaterFight(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.2, size * 0.4, size * 0.16, 0, 0, Math.PI * 2);
  outlined(ctx, MAP_PALETTE.waterLight, size * 0.05);
  const drop = (dx: number, dy: number, s: number, colour: string): void => {
    ctx.save();
    ctx.translate(cx + dx, cy + dy);
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s, s * 0.4, 0, s);
    ctx.quadraticCurveTo(-s, s * 0.4, 0, -s);
    ctx.closePath();
    outlined(ctx, colour, size * 0.035);
    ctx.restore();
  };
  drop(-size * 0.13, -size * 0.14, size * 0.15, MAP_PALETTE.water);
  drop(size * 0.15, -size * 0.26, size * 0.12, MAP_PALETTE.waterLight);
  drop(size * 0.01, -size * 0.4, size * 0.09, '#a8e0ef');
  ctx.restore();
}

/** The sky cruiser — a little rocket, tilted. */
function drawSkyCruiser(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.3);
  ctx.beginPath();
  ctx.moveTo(-size * 0.13, size * 0.36);
  ctx.quadraticCurveTo(-size * 0.19, -size * 0.08, 0, -size * 0.44);
  ctx.quadraticCurveTo(size * 0.19, -size * 0.08, size * 0.13, size * 0.36);
  ctx.closePath();
  outlined(ctx, MAP_PALETTE.cream, size * 0.05);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * size * 0.13, size * 0.18);
    ctx.lineTo(side * size * 0.29, size * 0.34);
    ctx.lineTo(side * size * 0.09, size * 0.3);
    ctx.closePath();
    outlined(ctx, MAP_PALETTE.brick, size * 0.04);
  }
  ctx.beginPath();
  ctx.arc(0, -size * 0.06, size * 0.09, 0, Math.PI * 2);
  outlined(ctx, MAP_PALETTE.teal, size * 0.04);
  ctx.restore();
}

function drawBallPit(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.04, size * 0.44, size * 0.32, 0, 0, Math.PI * 2);
  outlined(ctx, MAP_PALETTE.cream, size * 0.055);
  const colours = [
    MAP_PALETTE.brick,
    MAP_PALETTE.teal,
    MAP_PALETTE.mustard,
    '#6fae4f',
    MAP_PALETTE.purple,
  ];
  // A fixed spiral rather than a random scatter: the same balls in the same
  // places every time the map opens, which a child notices and an RNG does not
  // give you for free.
  for (let i = 0; i < 9; i += 1) {
    const a = i * 2.4;
    const r = size * 0.09 * Math.sqrt(i);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + size * 0.04 + Math.sin(a) * r * 0.72, size * 0.075, 0, Math.PI * 2);
    outlined(ctx, colours[i % colours.length] ?? MAP_PALETTE.brick, size * 0.03);
  }
  ctx.restore();
}

function drawCastle(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  const halfW = size * 0.36;
  const top = cy - size * 0.1;
  const h = size * 0.44;
  ctx.beginPath();
  ctx.rect(cx - halfW, top, halfW * 2, h);
  outlined(ctx, MAP_PALETTE.cream, size * 0.05);
  ctx.fillStyle = MAP_PALETTE.cream;
  ctx.strokeStyle = INK;
  ctx.lineWidth = size * 0.04;
  for (const dx of [-halfW * 0.55, 0, halfW * 0.55]) {
    ctx.beginPath();
    ctx.rect(cx + dx - size * 0.045, top - size * 0.07, size * 0.09, size * 0.07);
    ctx.fill();
    ctx.stroke();
  }
  // Two turrets with cone roofs.
  for (const dx of [-halfW, halfW]) {
    ctx.beginPath();
    ctx.rect(cx + dx - size * 0.075, top - size * 0.18, size * 0.15, size * 0.62);
    outlined(ctx, '#efe6d2', size * 0.045);
    ctx.beginPath();
    ctx.moveTo(cx + dx - size * 0.11, top - size * 0.18);
    ctx.lineTo(cx + dx, top - size * 0.4);
    ctx.lineTo(cx + dx + size * 0.11, top - size * 0.18);
    ctx.closePath();
    outlined(ctx, MAP_PALETTE.brick, size * 0.045);
  }
  ctx.beginPath();
  ctx.arc(cx, top + h, size * 0.085, Math.PI, 0);
  ctx.lineTo(cx + size * 0.085, top + h);
  ctx.lineTo(cx - size * 0.085, top + h);
  ctx.closePath();
  outlined(ctx, MAP_PALETTE.purple, size * 0.04);
  ctx.restore();
}

function drawHotel(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  const halfW = size * 0.26;
  const top = cy - size * 0.34;
  const h = size * 0.6;
  ctx.beginPath();
  ctx.rect(cx - halfW, top, halfW * 2, h);
  outlined(ctx, MAP_PALETTE.purple, size * 0.05);
  ctx.fillStyle = MAP_PALETTE.mustard;
  ctx.strokeStyle = INK;
  ctx.lineWidth = size * 0.025;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      const wx = cx - halfW * 0.5 + col * halfW;
      const wy = top + h * 0.16 + row * h * 0.26;
      ctx.beginPath();
      ctx.rect(wx - size * 0.04, wy - size * 0.04, size * 0.08, size * 0.08);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = size * 0.03;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx, top - size * 0.14);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, top - size * 0.14);
  ctx.lineTo(cx + size * 0.12, top - size * 0.1);
  ctx.lineTo(cx, top - size * 0.06);
  ctx.closePath();
  outlined(ctx, MAP_PALETTE.brick, size * 0.03);
  ctx.restore();
}

function drawFountain(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.08, size * 0.44, size * 0.3, 0, 0, Math.PI * 2);
  outlined(ctx, MAP_PALETTE.water, size * 0.05);
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.08, size * 0.2, size * 0.13, 0, 0, Math.PI * 2);
  outlined(ctx, MAP_PALETTE.waterLight, size * 0.035);
  // A spout of water.
  ctx.strokeStyle = MAP_PALETTE.waterLight;
  ctx.lineWidth = size * 0.05;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * 0.06);
  ctx.lineTo(cx, cy - size * 0.26);
  ctx.stroke();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 0.24);
    ctx.quadraticCurveTo(cx + side * size * 0.2, cy - size * 0.32, cx + side * size * 0.22, cy - size * 0.06);
    ctx.stroke();
  }
  ctx.restore();
}

/** A little station house — a pitched canopy over a platform. */
function drawStation(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - size * 0.24, cy + size * 0.02, size * 0.48, size * 0.2);
  outlined(ctx, MAP_PALETTE.cream, size * 0.045);
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.34, cy + size * 0.02);
  ctx.lineTo(cx, cy - size * 0.26);
  ctx.lineTo(cx + size * 0.34, cy + size * 0.02);
  ctx.closePath();
  outlined(ctx, MAP_PALETTE.brick, size * 0.045);
  ctx.restore();
}

/** A striped fairground booth — the generic stall, and the shape of the set. */
function drawBooth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  stripe: string,
): void {
  ctx.save();
  const halfW = size * 0.32;
  const top = cy - size * 0.06;
  ctx.beginPath();
  ctx.rect(cx - halfW * 0.86, top, halfW * 1.72, size * 0.4);
  outlined(ctx, MAP_PALETTE.cream, size * 0.045);
  // Scalloped awning, the thing that makes it read as a fairground stall.
  ctx.beginPath();
  ctx.moveTo(cx - halfW, top);
  ctx.lineTo(cx - halfW, top - size * 0.02);
  ctx.lineTo(cx + halfW, top - size * 0.02);
  ctx.lineTo(cx + halfW, top);
  const scallops = 4;
  for (let i = scallops; i > 0; i -= 1) {
    const x1 = cx - halfW + ((i - 1) / scallops) * halfW * 2;
    const x0 = cx - halfW + (i / scallops) * halfW * 2;
    ctx.quadraticCurveTo((x0 + x1) / 2, top + size * 0.12, x1, top);
  }
  ctx.closePath();
  outlined(ctx, stripe, size * 0.045);
  ctx.restore();
}

function drawFacePaint(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  drawBooth(ctx, cx, cy, size, MAP_PALETTE.mustard);
  ctx.save();
  // A paint palette with three blobs on it, sitting on the counter.
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.2, size * 0.15, size * 0.11, -0.3, 0, Math.PI * 2);
  outlined(ctx, MAP_PALETTE.cream, size * 0.03);
  for (const [dx, dy, colour] of [
    [-0.06, -0.02, MAP_PALETTE.brick],
    [0.02, -0.05, MAP_PALETTE.teal],
    [0.07, 0.02, MAP_PALETTE.purple],
  ] as const) {
    ctx.beginPath();
    ctx.arc(cx + size * dx, cy + size * (0.2 + dy), size * 0.032, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
  }
  ctx.restore();
}

function drawKeychainCart(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  // A little garden cart: a box on two wheels with keyrings hanging off a rail.
  ctx.beginPath();
  ctx.rect(cx - size * 0.28, cy - size * 0.06, size * 0.56, size * 0.28);
  outlined(ctx, MAP_PALETTE.teal, size * 0.045);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + side * size * 0.18, cy + size * 0.26, size * 0.08, 0, Math.PI * 2);
    outlined(ctx, MAP_PALETTE.grey, size * 0.035);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = size * 0.03;
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.26, cy - size * 0.24);
  ctx.lineTo(cx + size * 0.26, cy - size * 0.24);
  ctx.stroke();
  const colours = [MAP_PALETTE.brick, MAP_PALETTE.mustard, MAP_PALETTE.purple];
  for (let i = 0; i < 3; i += 1) {
    const kx = cx - size * 0.16 + i * size * 0.16;
    ctx.strokeStyle = INK;
    ctx.lineWidth = size * 0.02;
    ctx.beginPath();
    ctx.moveTo(kx, cy - size * 0.24);
    ctx.lineTo(kx, cy - size * 0.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(kx, cy - size * 0.11, size * 0.045, 0, Math.PI * 2);
    outlined(ctx, colours[i] ?? MAP_PALETTE.brick, size * 0.025);
  }
  ctx.restore();
}

/**
 * One drawing per attraction, keyed by the id `parkMapContent.ts` hands over —
 * an `AnchorId`, a stall id, or `station`/`fountain`/`tree`.
 */
export const ICONS: Readonly<Record<string, IconDrawer>> = {
  // anchors
  building: drawCastle,
  hotel: drawHotel,
  ballPit: drawBallPit,
  ferrisWheel: drawFerrisWheel,
  dodgems: drawDodgems,
  waterFight: drawWaterFight,
  // stalls
  railRacer: drawCoaster,
  skyCruiser: drawSkyCruiser,
  spookyHouse: drawSpookyHouse,
  spaceFerrisWheel: drawFerrisWheel,
  facePaint: drawFacePaint,
  keychain: drawKeychainCart,
  // furniture
  fountain: drawFountain,
  station: drawStation,
  tree: drawTree,
};

/**
 * Draws `id`'s picture at a canvas point, with its shadow.
 *
 * Anything without a bespoke drawing falls back to a striped booth in its own
 * accent colour rather than to nothing — a new stall appears on the map the day
 * it is added, looking like a stall, and can be given its own picture later.
 */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  id: string,
  cx: number,
  cy: number,
  size: number,
  fallbackColour: string,
): void {
  drawGroundShadow(ctx, cx, cy, size);
  const icon = ICONS[id];
  if (icon) icon(ctx, cx, cy, size);
  else drawBooth(ctx, cx, cy, size, fallbackColour);
}
