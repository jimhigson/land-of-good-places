/**
 * **The park map's illustration kit** — GitHub issue #334.
 *
 * Jim's ask, in his words: *"each building should have a drawing of it on the
 * map (still labelled)"*. So every attraction gets its own small flat-vector
 * picture rather than a coloured dot or a pin with an emoji on it, drawn in a
 * tilted storybook three-quarter view.
 *
 * **Nothing in this file knows where anything is.** It is handed a canvas
 * point and a size and it paints; the point always comes from
 * `parkMapContent.ts`, which reads the park that was actually generated. That
 * separation is deliberate and it is the lesson of #234: the moment a drawing
 * routine is allowed to decide *where* as well as *how*, there is a second
 * description of the park's layout for the first one to fall out of step with.
 * It is also what made this restyle free — the whole look changed here and not
 * one attraction moved.
 *
 * ### The house style, read off the reference
 *
 * Jim supplied a flat vector fun-park illustration as a **style reference
 * only** — it is watermarked commercial stock, so nothing here traces, copies
 * or reproduces it, and the file is deliberately not in this repo. These are
 * the rules taken from actually looking at it, and the first is the one that
 * matters most:
 *
 * - **No outlines.** Not thin ones — none. Every object is flat colour shapes
 *   butted against each other, with *darker tones of the same hue* doing the
 *   work an outline would otherwise do: the shaded side of a tent, the far
 *   facet of a mountain, the underside of a roof. An earlier pass of this file
 *   drew a dark ink stroke round everything, which reads as a sticker set
 *   rather than as this idiom.
 * - **One soft ellipse shadow** under each object, so it sits on the grass.
 * - **Three or four flat colours per object**, no gradients anywhere.
 * - **Generous empty lawn.** Nothing crowded; every label readable.
 */

/**
 * The map's palette, sampled from the reference.
 *
 * Deliberately its own, and deliberately *not* `core/palette.ts`. That palette
 * describes the park in three dimensions under a warm sun — pastel, high-key,
 * tuned for toon-shaded geometry. A flat illustration read at a glance on a
 * phone needs more contrast between neighbouring flat areas than those pastels
 * give, so this is the reference's own register: a yellow-leaning olive lawn
 * on cream paper, near-white paths, and a small warm-and-cool set of object
 * colours — brick red, teal, mustard, deep indigo-purple, warm grey.
 *
 * Each object colour carries a `…Deep` partner, which is the shading tone for
 * that hue. Having them named in pairs is what keeps the no-outline rule
 * workable: a shape needs a darker version of itself far more often than it
 * needs black.
 */
export const MAP_PALETTE = {
  paper: '#f2efe2',
  lawn: '#b3c74a',
  lawnDeep: '#9db03d',
  lawnEdge: '#8ba036',
  path: '#fbf9f1',
  pathEdge: '#eae4d0',

  brick: '#b0463a',
  brickDeep: '#8e3329',
  brickLight: '#c9584a',

  teal: '#4a92a4',
  tealDeep: '#37778a',
  tealLight: '#6fb3c2',

  mustard: '#efa939',
  mustardDeep: '#d18d24',

  purple: '#4e4480',
  purpleDeep: '#3b3364',
  purpleLight: '#6a5da0',

  grey: '#8f959c',
  greyDeep: '#767d85',
  greyLight: '#a8aeb4',

  water: '#4a92a4',
  waterLight: '#6fb3c2',

  cream: '#f6f2e6',
  creamDeep: '#e2dbc7',
  white: '#ffffff',

  leaf: '#4f7a3a',
  leafDeep: '#3d612c',
  trunk: '#6b4a2f',

  // The boundary wall and its gate arch are pink stone in the park
  // (`core/palette.ts`'s `stonePink` family). Carried over here so the gate on
  // the map is recognisably the thing a child just walked through, in this
  // map's slightly quieter register.
  stone: '#e9b4c9',
  stoneDeep: '#cf92aa',
  stoneLight: '#f7d9e4',

  ink: '#3f3a34',
} as const;

export type IconDrawer = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
) => void;

// ------------------------------------------------------------------ helpers

/** Fill a polygon of [x, y] offsets scaled by `size`, flat, no stroke. */
function poly(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  colour: string,
  points: readonly (readonly [number, number])[],
): void {
  ctx.beginPath();
  const [fx, fy] = points[0] ?? [0, 0];
  ctx.moveTo(cx + fx * size, cy + fy * size);
  for (let i = 1; i < points.length; i += 1) {
    const [x, y] = points[i] as readonly [number, number];
    ctx.lineTo(cx + x * size, cy + y * size);
  }
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
}

/** A flat rectangle in object units. */
function box(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  colour: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = colour;
  ctx.fillRect(cx + x * size, cy + y * size, w * size, h * size);
}

/** A flat circle in object units. */
function disc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  colour: string,
  x: number,
  y: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.arc(cx + x * size, cy + y * size, r * size, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
}

/**
 * The soft ellipse under every object.
 *
 * Drawn by `drawIcon` before the icon itself, so the whole map shares one
 * light direction and no individual drawing has to remember it. Flat art with
 * no shadow reads as stickers scattered on a background; with it, each object
 * sits on the grass.
 */
export function drawGroundShadow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(80, 92, 40, 0.15)';
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.44, size * 0.36, size * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// -------------------------------------------------------------------- icons

/**
 * A poplar — tall and narrow, as in the reference, where trees stand in
 * little clusters of three or four rather than dotting the lawn evenly.
 * Drawn at real foliage positions, never scattered by us.
 */
function drawTree(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  box(ctx, cx, cy, size, MAP_PALETTE.trunk, -0.035, 0.05, 0.07, 0.4);
  // Two leaf tones, the darker one on the left, so a cluster of these reads as
  // lit from the same side as everything else.
  poly(ctx, cx, cy, size, MAP_PALETTE.leafDeep, [
    [0, -0.5], [0.17, -0.05], [0, 0.12], [-0.17, -0.05],
  ]);
  poly(ctx, cx, cy, size, MAP_PALETTE.leaf, [
    [0, -0.5], [0.17, -0.05], [0, 0.12],
  ]);
}

function drawFerrisWheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const r = size * 0.4;
  // A-frame legs.
  poly(ctx, cx, cy, size, MAP_PALETTE.brickDeep, [
    [-0.03, 0], [0.03, 0], [0.22, 0.46], [0.14, 0.46],
  ]);
  poly(ctx, cx, cy, size, MAP_PALETTE.brickDeep, [
    [-0.03, 0], [0.03, 0], [-0.14, 0.46], [-0.22, 0.46],
  ]);
  // White spokes.
  ctx.save();
  ctx.strokeStyle = MAP_PALETTE.cream;
  ctx.lineWidth = size * 0.022;
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }
  // Twin rims.
  ctx.strokeStyle = MAP_PALETTE.brick;
  ctx.lineWidth = size * 0.05;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = size * 0.025;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // Cabins alternating red and teal, hanging off the rim.
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const bx = Math.cos(a) * r;
    const by = Math.sin(a) * r;
    const colour = i % 2 === 0 ? MAP_PALETTE.brick : MAP_PALETTE.teal;
    poly(ctx, cx, cy, size, colour, [
      [bx / size - 0.055, by / size], [bx / size + 0.055, by / size],
      [bx / size + 0.04, by / size + 0.1], [bx / size - 0.04, by / size + 0.1],
    ]);
  }
  disc(ctx, cx, cy, size, MAP_PALETTE.greyDeep, 0, 0, 0.055);
}

/**
 * The rail race — a track looping a grey mountain.
 *
 * **Draw order is the whole icon.** Drawn as two complete ellipses on top of
 * the mountain (the first version) the track reads as stray wireframe rings
 * lying across a grey pyramid — the one picture on the map a six-year-old
 * would ask what was wrong with. A loop only reads as *going round* something
 * if its back half is hidden: so the far arc goes down first, then the
 * mountain over it, then the near arc.
 */
function drawCoaster(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const track = (from: number, to: number, ex: number, ey: number, rx: number, ry: number, tilt: number): void => {
    ctx.beginPath();
    ctx.ellipse(cx + ex * size, cy + ey * size, rx * size, ry * size, tilt, from, to);
    ctx.stroke();
  };

  ctx.save();
  ctx.strokeStyle = MAP_PALETTE.ink;
  ctx.lineWidth = size * 0.035;
  ctx.lineCap = 'round';

  // Back half of both loops — the part that passes behind the peaks.
  track(Math.PI, Math.PI * 2, -0.12, 0.12, 0.42, 0.2, -0.15);
  track(Math.PI, Math.PI * 2, 0.16, -0.04, 0.28, 0.15, 0.3);

  // The mountains, over the back arcs.
  poly(ctx, cx, cy, size, MAP_PALETTE.greyDeep, [
    [0.1, 0.42], [0.3, -0.16], [0.5, 0.42],
  ]);
  poly(ctx, cx, cy, size, MAP_PALETTE.grey, [
    [-0.46, 0.42], [-0.1, -0.44], [0.26, 0.42],
  ]);
  poly(ctx, cx, cy, size, MAP_PALETTE.greyLight, [
    [-0.1, -0.44], [0.26, 0.42], [0.02, 0.42],
  ]);

  // Front half of both loops, over the mountains.
  track(0, Math.PI, -0.12, 0.12, 0.42, 0.2, -0.15);
  track(0, Math.PI, 0.16, -0.04, 0.28, 0.15, 0.3);
  ctx.restore();

  // A train of carriages on the near rail.
  poly(ctx, cx, cy, size, MAP_PALETTE.brick, [
    [-0.36, 0.26], [-0.24, 0.26], [-0.24, 0.33], [-0.36, 0.33],
  ]);
  poly(ctx, cx, cy, size, MAP_PALETTE.teal, [
    [-0.21, 0.28], [-0.09, 0.28], [-0.09, 0.35], [-0.21, 0.35],
  ]);
}

function drawSpookyHouse(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  // Body, with a darker right wall for the three-quarter turn.
  box(ctx, cx, cy, size, MAP_PALETTE.purple, -0.34, -0.04, 0.5, 0.44);
  box(ctx, cx, cy, size, MAP_PALETTE.purpleDeep, 0.16, -0.04, 0.18, 0.44);
  // Steep roof.
  poly(ctx, cx, cy, size, MAP_PALETTE.purpleLight, [
    [-0.42, -0.04], [-0.09, -0.46], [0.24, -0.04],
  ]);
  poly(ctx, cx, cy, size, MAP_PALETTE.purpleDeep, [
    [0.24, -0.04], [-0.09, -0.46], [0.06, -0.46], [0.4, -0.04],
  ]);
  // Warm windows.
  box(ctx, cx, cy, size, MAP_PALETTE.mustard, -0.26, 0.06, 0.11, 0.11);
  box(ctx, cx, cy, size, MAP_PALETTE.mustard, 0.21, 0.08, 0.08, 0.1);
  // Boarded door.
  box(ctx, cx, cy, size, MAP_PALETTE.trunk, -0.06, 0.16, 0.16, 0.24);
  // The ghost.
  ctx.beginPath();
  ctx.arc(cx + size * 0.06, cy + size * 0.18, size * 0.11, Math.PI, 0);
  ctx.lineTo(cx + size * 0.17, cy + size * 0.32);
  ctx.lineTo(cx + size * 0.115, cy + size * 0.26);
  ctx.lineTo(cx + size * 0.06, cy + size * 0.32);
  ctx.lineTo(cx + size * 0.005, cy + size * 0.26);
  ctx.lineTo(cx - size * 0.05, cy + size * 0.32);
  ctx.closePath();
  ctx.fillStyle = MAP_PALETTE.white;
  ctx.fill();
  ctx.fillStyle = MAP_PALETTE.ink;
  ctx.beginPath();
  ctx.arc(cx + size * 0.025, cy + size * 0.16, size * 0.016, 0, Math.PI * 2);
  ctx.arc(cx + size * 0.095, cy + size * 0.16, size * 0.016, 0, Math.PI * 2);
  ctx.fill();
}

function drawDodgems(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  // The floor, an ellipse in three-quarter.
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.16, size * 0.46, size * 0.24, 0, 0, Math.PI * 2);
  ctx.fillStyle = MAP_PALETTE.tealDeep;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.12, size * 0.42, size * 0.21, 0, 0, Math.PI * 2);
  ctx.fillStyle = MAP_PALETTE.teal;
  ctx.fill();
  // Two little cars.
  poly(ctx, cx, cy, size, MAP_PALETTE.mustardDeep, [
    [-0.28, 0.14], [-0.05, 0.14], [-0.05, 0.24], [-0.28, 0.24],
  ]);
  poly(ctx, cx, cy, size, MAP_PALETTE.mustard, [
    [-0.26, 0.04], [-0.09, 0.04], [-0.05, 0.15], [-0.28, 0.15],
  ]);
  poly(ctx, cx, cy, size, MAP_PALETTE.brickDeep, [
    [0.06, 0.08], [0.28, 0.08], [0.28, 0.18], [0.06, 0.18],
  ]);
  poly(ctx, cx, cy, size, MAP_PALETTE.brick, [
    [0.08, -0.02], [0.24, -0.02], [0.28, 0.09], [0.06, 0.09],
  ]);
  disc(ctx, cx, cy, size, MAP_PALETTE.cream, 0.17, -0.06, 0.05);
}

function drawWaterFight(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  // A pond with the reference's chevron ripples.
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.18, size * 0.44, size * 0.24, 0, 0, Math.PI * 2);
  ctx.fillStyle = MAP_PALETTE.water;
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = MAP_PALETTE.white;
  ctx.lineWidth = size * 0.028;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [rx, ry] of [[-0.16, 0.1], [0.12, 0.16], [-0.04, 0.26]] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + (rx - 0.06) * size, cy + (ry + 0.03) * size);
    ctx.lineTo(cx + rx * size, cy + (ry - 0.02) * size);
    ctx.lineTo(cx + (rx + 0.06) * size, cy + (ry + 0.03) * size);
    ctx.stroke();
  }
  ctx.restore();
  // Droplets arcing over it.
  for (const [dx, dy, s] of [[-0.13, -0.2, 0.11], [0.14, -0.3, 0.09], [0.0, -0.42, 0.07]] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * size, cy + (dy - s) * size);
    ctx.quadraticCurveTo(cx + (dx + s) * size, cy + (dy + s * 0.4) * size, cx + dx * size, cy + (dy + s) * size);
    ctx.quadraticCurveTo(cx + (dx - s) * size, cy + (dy + s * 0.4) * size, cx + dx * size, cy + (dy - s) * size);
    ctx.closePath();
    ctx.fillStyle = MAP_PALETTE.waterLight;
    ctx.fill();
  }
}

/** The sky cruiser — the reference's rocket, on its fins. */
function drawSkyCruiser(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  // Fins first, so the hull sits over them.
  poly(ctx, cx, cy, size, MAP_PALETTE.brickDeep, [
    [-0.1, 0.06], [-0.24, 0.34], [-0.1, 0.34],
  ]);
  poly(ctx, cx, cy, size, MAP_PALETTE.brickDeep, [
    [0.1, 0.06], [0.24, 0.34], [0.1, 0.34],
  ]);
  // Hull.
  poly(ctx, cx, cy, size, MAP_PALETTE.cream, [
    [0, -0.48], [0.13, -0.16], [0.13, 0.34], [-0.13, 0.34], [-0.13, -0.16],
  ]);
  // Shaded right side — the whole reason no outline is needed.
  poly(ctx, cx, cy, size, MAP_PALETTE.creamDeep, [
    [0, -0.48], [0.13, -0.16], [0.13, 0.34], [0.03, 0.34], [0.03, -0.3],
  ]);
  // Nose cone.
  poly(ctx, cx, cy, size, MAP_PALETTE.brick, [
    [0, -0.48], [0.13, -0.16], [-0.13, -0.16],
  ]);
  // Chequer band, the reference's own motif.
  for (let i = 0; i < 3; i += 1) {
    box(ctx, cx, cy, size, i % 2 === 0 ? MAP_PALETTE.teal : MAP_PALETTE.tealDeep,
      -0.13 + i * 0.087, 0.02, 0.087, 0.09);
  }
  disc(ctx, cx, cy, size, MAP_PALETTE.teal, 0, -0.08, 0.055);
  disc(ctx, cx, cy, size, MAP_PALETTE.tealLight, 0, -0.08, 0.032);
}

function drawBallPit(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.18, size * 0.46, size * 0.24, 0, 0, Math.PI * 2);
  ctx.fillStyle = MAP_PALETTE.creamDeep;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.14, size * 0.42, size * 0.21, 0, 0, Math.PI * 2);
  ctx.fillStyle = MAP_PALETTE.cream;
  ctx.fill();
  // A fixed spiral of balls: the same balls in the same places every time the
  // map opens, which a child notices and an RNG does not give you for free.
  const colours = [
    MAP_PALETTE.brick, MAP_PALETTE.teal, MAP_PALETTE.mustard,
    MAP_PALETTE.purpleLight, MAP_PALETTE.leaf,
  ];
  for (let i = 0; i < 10; i += 1) {
    const a = i * 2.4;
    const r = 0.085 * Math.sqrt(i);
    disc(ctx, cx, cy, size, colours[i % colours.length] ?? MAP_PALETTE.brick,
      Math.cos(a) * r, 0.13 + Math.sin(a) * r * 0.5, 0.068);
  }
}

function drawCastle(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  // Keep, with a shaded right face.
  box(ctx, cx, cy, size, MAP_PALETTE.cream, -0.3, -0.1, 0.42, 0.5);
  box(ctx, cx, cy, size, MAP_PALETTE.creamDeep, 0.12, -0.1, 0.18, 0.5);
  // Crenellations along the top.
  for (let i = 0; i < 4; i += 1) {
    box(ctx, cx, cy, size, MAP_PALETTE.cream, -0.3 + i * 0.12, -0.17, 0.07, 0.07);
  }
  // Twin towers with conical roofs.
  for (const dx of [-0.4, 0.24] as const) {
    box(ctx, cx, cy, size, MAP_PALETTE.cream, dx, -0.28, 0.16, 0.68);
    box(ctx, cx, cy, size, MAP_PALETTE.creamDeep, dx + 0.1, -0.28, 0.06, 0.68);
    poly(ctx, cx, cy, size, MAP_PALETTE.brick, [
      [dx - 0.04, -0.28], [dx + 0.08, -0.52], [dx + 0.2, -0.28],
    ]);
    poly(ctx, cx, cy, size, MAP_PALETTE.brickDeep, [
      [dx + 0.08, -0.52], [dx + 0.2, -0.28], [dx + 0.12, -0.28],
    ]);
  }
  // Arched door.
  ctx.beginPath();
  ctx.arc(cx - size * 0.09, cy + size * 0.26, size * 0.09, Math.PI, 0);
  ctx.lineTo(cx, cy + size * 0.4);
  ctx.lineTo(cx - size * 0.18, cy + size * 0.4);
  ctx.closePath();
  ctx.fillStyle = MAP_PALETTE.purple;
  ctx.fill();
}

function drawHotel(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  box(ctx, cx, cy, size, MAP_PALETTE.purple, -0.26, -0.34, 0.38, 0.74);
  box(ctx, cx, cy, size, MAP_PALETTE.purpleDeep, 0.12, -0.34, 0.14, 0.74);
  // Flat canopy over the door.
  poly(ctx, cx, cy, size, MAP_PALETTE.brick, [
    [-0.32, -0.34], [0.32, -0.34], [0.26, -0.44], [-0.26, -0.44],
  ]);
  // Lit windows, four rows of two.
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      box(ctx, cx, cy, size, MAP_PALETTE.mustard,
        -0.2 + col * 0.16, -0.24 + row * 0.15, 0.1, 0.09);
    }
    box(ctx, cx, cy, size, MAP_PALETTE.mustardDeep, 0.15, -0.24 + row * 0.15, 0.07, 0.09);
  }
  // Flagpole.
  box(ctx, cx, cy, size, MAP_PALETTE.greyDeep, -0.03, -0.58, 0.02, 0.14);
  poly(ctx, cx, cy, size, MAP_PALETTE.brick, [
    [-0.01, -0.58], [0.14, -0.53], [-0.01, -0.48],
  ]);
}

function drawFountain(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  // Basin.
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.2, size * 0.44, size * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = MAP_PALETTE.creamDeep;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.17, size * 0.38, size * 0.18, 0, 0, Math.PI * 2);
  ctx.fillStyle = MAP_PALETTE.water;
  ctx.fill();
  // Pedestal and upper bowl.
  box(ctx, cx, cy, size, MAP_PALETTE.cream, -0.05, -0.16, 0.1, 0.3);
  ctx.beginPath();
  ctx.ellipse(cx, cy - size * 0.16, size * 0.18, size * 0.08, 0, 0, Math.PI * 2);
  ctx.fillStyle = MAP_PALETTE.cream;
  ctx.fill();
  // Jets.
  ctx.save();
  ctx.strokeStyle = MAP_PALETTE.waterLight;
  ctx.lineWidth = size * 0.035;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.2);
  ctx.lineTo(cx, cy - size * 0.42);
  ctx.stroke();
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 0.4);
    ctx.quadraticCurveTo(
      cx + side * size * 0.24, cy - size * 0.44,
      cx + side * size * 0.26, cy - size * 0.16,
    );
    ctx.stroke();
  }
  ctx.restore();
}

/** A little station house with a pitched canopy. */
function drawStation(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  box(ctx, cx, cy, size, MAP_PALETTE.cream, -0.28, 0, 0.44, 0.36);
  box(ctx, cx, cy, size, MAP_PALETTE.creamDeep, 0.16, 0, 0.12, 0.36);
  poly(ctx, cx, cy, size, MAP_PALETTE.brick, [
    [-0.38, 0], [-0.06, -0.3], [0.26, 0],
  ]);
  poly(ctx, cx, cy, size, MAP_PALETTE.brickDeep, [
    [-0.06, -0.3], [0.26, 0], [0.38, 0], [0.06, -0.3],
  ]);
  box(ctx, cx, cy, size, MAP_PALETTE.teal, -0.16, 0.14, 0.14, 0.22);
}

/**
 * A striped fairground booth — the generic stall, and the shape of the set.
 * The reference's cafe is the model: a flat-roofed hut with a bright awning.
 */
function drawBooth(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  stripe: string,
): void {
  box(ctx, cx, cy, size, MAP_PALETTE.cream, -0.3, -0.02, 0.5, 0.4);
  box(ctx, cx, cy, size, MAP_PALETTE.creamDeep, 0.2, -0.02, 0.1, 0.4);
  // Scalloped awning.
  const half = 0.34;
  ctx.beginPath();
  ctx.moveTo(cx - half * size, cy - 0.14 * size);
  ctx.lineTo(cx + half * size, cy - 0.14 * size);
  ctx.lineTo(cx + half * size, cy - 0.02 * size);
  const scallops = 4;
  for (let i = scallops; i > 0; i -= 1) {
    const x1 = -half + ((i - 1) / scallops) * half * 2;
    const x0 = -half + (i / scallops) * half * 2;
    ctx.quadraticCurveTo(
      cx + ((x0 + x1) / 2) * size, cy + 0.08 * size,
      cx + x1 * size, cy - 0.02 * size,
    );
  }
  ctx.closePath();
  ctx.fillStyle = stripe;
  ctx.fill();
  box(ctx, cx, cy, size, MAP_PALETTE.tealLight, -0.22, 0.1, 0.28, 0.16);
}

function drawFacePaint(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  drawBooth(ctx, cx, cy, size, MAP_PALETTE.mustard);
  // A paint palette on the counter.
  ctx.beginPath();
  ctx.ellipse(cx - size * 0.02, cy + size * 0.18, size * 0.15, size * 0.1, -0.25, 0, Math.PI * 2);
  ctx.fillStyle = MAP_PALETTE.cream;
  ctx.fill();
  for (const [dx, dy, colour] of [
    [-0.07, -0.01, MAP_PALETTE.brick],
    [0.0, -0.04, MAP_PALETTE.teal],
    [0.06, 0.0, MAP_PALETTE.purpleLight],
  ] as const) {
    disc(ctx, cx, cy, size, colour, dx, 0.18 + dy, 0.03);
  }
}

function drawKeychainCart(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  // A garden cart: a box on two wheels with keyrings hanging off a rail.
  box(ctx, cx, cy, size, MAP_PALETTE.teal, -0.28, 0.02, 0.52, 0.26);
  box(ctx, cx, cy, size, MAP_PALETTE.tealDeep, 0.24, 0.02, 0.08, 0.26);
  disc(ctx, cx, cy, size, MAP_PALETTE.greyDeep, -0.16, 0.3, 0.09);
  disc(ctx, cx, cy, size, MAP_PALETTE.grey, -0.16, 0.3, 0.045);
  disc(ctx, cx, cy, size, MAP_PALETTE.greyDeep, 0.16, 0.3, 0.09);
  disc(ctx, cx, cy, size, MAP_PALETTE.grey, 0.16, 0.3, 0.045);
  // Rail and three keyrings.
  box(ctx, cx, cy, size, MAP_PALETTE.greyDeep, -0.28, -0.28, 0.56, 0.03);
  const colours = [MAP_PALETTE.brick, MAP_PALETTE.mustard, MAP_PALETTE.purpleLight];
  for (let i = 0; i < 3; i += 1) {
    const kx = -0.17 + i * 0.17;
    box(ctx, cx, cy, size, MAP_PALETTE.greyDeep, kx - 0.008, -0.26, 0.016, 0.09);
    disc(ctx, cx, cy, size, colours[i] ?? MAP_PALETTE.brick, kx, -0.13, 0.05);
  }
}

/**
 * **The entrance arch**, drawn front-on: two pink-stone posts with domed caps
 * and a round crossbar over the gap, which is exactly what `Entrance.ts` builds
 * — a pair of cylinders on the wall's tangent, sphere caps, and a half-torus
 * spanning them. A child who has walked in through it should recognise it.
 *
 * The crossbar is a filled half-annulus rather than a stroked arc, so the whole
 * icon stays flat shapes with no outline strokes, per the reference.
 *
 * Knows only how to paint an arch. Where the arch goes is
 * `parkMapContent.ts`'s `entranceGate` feature and nothing else.
 */
function drawEntranceGate(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const postHalf = 0.075;
  const postX = 0.325;
  const springY = -0.1; // where the posts stop and the arch springs from
  const outer = postX + postHalf;
  const inner = postX - postHalf;

  // The gap read as paving between the posts, so the gate is a way *through*
  // rather than a wall.
  box(ctx, cx, cy, size, MAP_PALETTE.path, -inner, springY, inner * 2, 0.45);

  for (const side of [-1, 1] as const) {
    // Flat face, then a darker sliver down the inner edge: the same light
    // direction the rest of the set is shaded to.
    box(ctx, cx, cy, size, MAP_PALETTE.stone, side * postX - postHalf, springY, postHalf * 2, 0.45);
    box(
      ctx, cx, cy, size, MAP_PALETTE.stoneDeep,
      side > 0 ? postX + postHalf * 0.45 : -postX - postHalf,
      springY, postHalf * 0.55, 0.45,
    );
  }

  // The arch: outer edge over, inner edge back, filled as one band.
  ctx.beginPath();
  ctx.arc(cx, cy + springY * size, outer * size, Math.PI, 0, false);
  ctx.arc(cx, cy + springY * size, inner * size, 0, Math.PI, true);
  ctx.closePath();
  ctx.fillStyle = MAP_PALETTE.stone;
  ctx.fill();

  // Domed caps on the posts, as in the park.
  for (const side of [-1, 1] as const) {
    ctx.beginPath();
    ctx.ellipse(cx + side * postX * size, cy + springY * size, postHalf * 1.25 * size, postHalf * 0.9 * size, 0, 0, Math.PI * 2);
    ctx.fillStyle = MAP_PALETTE.stoneLight;
    ctx.fill();
  }

  // The gate's paw print, which the real posts carry.
  const pawY = -0.34;
  disc(ctx, cx, cy, size, MAP_PALETTE.stoneDeep, 0, pawY + 0.035, 0.055);
  for (const toe of [-0.062, -0.021, 0.021, 0.062] as const) {
    disc(ctx, cx, cy, size, MAP_PALETTE.stoneDeep, toe, pawY - 0.045, 0.026);
  }
}

/**
 * **The cat bus**, side-on with its face turned to the reader.
 *
 * Cream body and a yellow roof, as `catBus.ts` builds it
 * (`CAT_BUS_BODY_COLOUR` is `pathEdge`, the roof a lightened `flowerYellow`),
 * plus the ears, whiskers and route number that make it a cat and not a coach.
 *
 * Drawn nose-right, which is the direction it faces at the stop — but that is a
 * drawing decision only. Where the bus goes on the map is the `catBus` feature
 * in `parkMapContent.ts`, and it is the bus *stop*, for the reasons set out
 * there.
 */
function drawCatBus(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const bodyTop = -0.16;
  const bodyBottom = 0.26;

  // Wheels first, so the body sits over them.
  for (const wx of [-0.26, 0.24] as const) {
    disc(ctx, cx, cy, size, MAP_PALETTE.greyDeep, wx, bodyBottom + 0.02, 0.085);
    disc(ctx, cx, cy, size, MAP_PALETTE.greyLight, wx, bodyBottom + 0.02, 0.036);
  }

  // Ears, behind the head so they read as sticking up out of it.
  for (const [ex, tip] of [[0.24, 0.16], [0.42, 0.34]] as const) {
    poly(ctx, cx, cy, size, MAP_PALETTE.creamDeep, [
      [ex, -0.24], [tip, -0.46], [ex + 0.13, -0.22],
    ]);
  }

  // Body: cream flank, darker skirt below the windows.
  box(ctx, cx, cy, size, MAP_PALETTE.cream, -0.44, bodyTop, 0.86, bodyBottom - bodyTop);
  box(ctx, cx, cy, size, MAP_PALETTE.creamDeep, -0.44, 0.14, 0.86, bodyBottom - 0.14);
  // Roof, in the bus's own yellow.
  box(ctx, cx, cy, size, MAP_PALETTE.mustard, -0.44, bodyTop, 0.86, 0.07);

  // Windows: three down the flank, plus the door as a gap in the skirt.
  for (const wx of [-0.4, -0.24, -0.08] as const) {
    box(ctx, cx, cy, size, MAP_PALETTE.tealLight, wx, -0.06, 0.13, 0.15);
  }
  box(ctx, cx, cy, size, MAP_PALETTE.teal, 0.09, -0.06, 0.09, 0.3);

  // The face, on the front of the bus.
  disc(ctx, cx, cy, size, MAP_PALETTE.cream, 0.33, -0.02, 0.22);
  disc(ctx, cx, cy, size, MAP_PALETTE.ink, 0.26, -0.08, 0.032);
  disc(ctx, cx, cy, size, MAP_PALETTE.ink, 0.4, -0.08, 0.032);
  poly(ctx, cx, cy, size, MAP_PALETTE.stoneDeep, [
    [0.305, 0.02], [0.355, 0.02], [0.33, 0.055],
  ]);

  // Whiskers — the one place a line is the shape, as with the fountain's jets.
  ctx.save();
  ctx.strokeStyle = MAP_PALETTE.greyLight;
  ctx.lineWidth = size * 0.018;
  ctx.lineCap = 'round';
  for (const side of [-1, 1] as const) {
    for (const dy of [-0.02, 0.03] as const) {
      ctx.beginPath();
      ctx.moveTo(cx + (0.33 + side * 0.06) * size, cy + (0.03 + dy) * size);
      ctx.lineTo(cx + (0.33 + side * 0.2) * size, cy + (0.01 + dy * 1.6) * size);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Route 67's destination blind — a cream slot on the yellow roof.
  box(ctx, cx, cy, size, MAP_PALETTE.paper, -0.32, -0.145, 0.24, 0.05);
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
  // the way in
  entranceGate: drawEntranceGate,
  catBus: drawCatBus,
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
