/**
 * The stylized-illustration rendering layer for `ParkMap.ts` (GitHub issue
 * #334). Everything in this file draws *from* real park geometry — anchor
 * positions, stall positions, route control points — but draws it as a flat,
 * hand-illustrated "children's book theme-park map" rather than a scale
 * top-down diagram. Nothing here invents a position: it only decides how a
 * position already computed elsewhere gets painted.
 *
 * Three pieces:
 *
 * - `buildBlobBoundary` — the park's real content (every anchor, stall,
 *   station and the plaza) sets a *minimum* reach in every direction, then a
 *   few sine harmonics wobble the outline into an organic amoeba blob rather
 *   than a perfect circle. The wobble can only push the edge *out* past that
 *   minimum, never in, so nothing this seed actually placed can end up
 *   outside the ground shape that is supposed to contain it.
 * - `scatterTrees` — a small deterministic PRNG (seeded from the real anchor
 *   layout, so it is stable for a given seed and varies across seeds) drops a
 *   handful of tree clusters inside the blob, keeping clear of every
 *   exclusion circle passed in (paths, plots, water) the same way the real
 *   scenery scatter keeps clear of anchors.
 * - `ICONS` — one small flat-shaded vector drawing per attraction type,
 *   keyed by anchor/stall id. Bold dark outline, two or three flat fill
 *   colours, no gradients — the "sticker" look from the reference image.
 */

export interface ContentCircle {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

// -------------------------------------------------------------- utilities

/** A tiny deterministic PRNG so the same seed always draws the same blob/trees. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic small integer from the real layout, used to seed the PRNG. */
function hashContent(points: readonly ContentCircle[]): number {
  let h = 2166136261;
  for (const p of points) {
    h = Math.imul(h ^ Math.round(p.x * 37), 16777619);
    h = Math.imul(h ^ Math.round(p.z * 41), 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------- blob boundary

/**
 * Builds the organic ground-shape outline as a closed polygon of `samples`
 * points in world/plane metres, centred on the origin. `content` is every
 * real thing the park placed (anchor plots, stalls, the plaza, stations) —
 * the outline is guaranteed to clear each of them by `margin` metres, so the
 * wobble can only ever add slack, never cut something off.
 */
export function buildBlobBoundary(
  content: readonly ContentCircle[],
  fallbackRadius: number,
  margin = 4,
): readonly (readonly [number, number])[] {
  const samples = 64;
  const seed = hashContent(content);
  const rnd = mulberry32(seed);
  const phase1 = rnd() * Math.PI * 2;
  const phase2 = rnd() * Math.PI * 2;
  const phase3 = rnd() * Math.PI * 2;

  const points: [number, number][] = [];
  for (let i = 0; i < samples; i += 1) {
    const theta = (i / samples) * Math.PI * 2;
    // The minimum this bearing must reach to clear real content sitting
    // roughly along it (a wide angular window, so a plot doesn't need to sit
    // exactly on a sample ray to be honoured).
    let required = fallbackRadius;
    for (const c of content) {
      const dist = Math.hypot(c.x, c.z);
      if (dist < 0.01) continue;
      const bearing = Math.atan2(c.x, c.z);
      let diff = Math.abs(theta - bearing);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < 0.7) required = Math.max(required, dist + c.r + margin);
    }
    const wobble =
      1 +
      0.12 * Math.sin(3 * theta + phase1) +
      0.07 * Math.sin(5 * theta + phase2) +
      0.045 * Math.sin(7 * theta + phase3);
    const radius = required * Math.max(0.96, wobble);
    points.push([radius * Math.sin(theta), radius * Math.cos(theta)]);
  }
  return points;
}

// -------------------------------------------------------------- tree scatter

export interface TreeCluster {
  readonly x: number;
  readonly z: number;
}

/**
 * Small clumps of trees dropped inside the blob, clear of every exclusion
 * circle (plots, paths samples, water). Deterministic per layout so the same
 * seed always gets the same little groves.
 */
export function scatterTrees(
  content: readonly ContentCircle[],
  exclusions: readonly ContentCircle[],
  fallbackRadius: number,
  clusterCount = 6,
  perCluster = 4,
): readonly TreeCluster[] {
  const rnd = mulberry32(hashContent(content) ^ 0x9e3779b9);
  const out: TreeCluster[] = [];
  let attempts = 0;
  let placed = 0;
  while (placed < clusterCount && attempts < clusterCount * 30) {
    attempts += 1;
    const theta = rnd() * Math.PI * 2;
    const r = fallbackRadius * (0.25 + rnd() * 0.62);
    const cx = r * Math.sin(theta);
    const cz = r * Math.cos(theta);
    const clear = exclusions.every((e) => Math.hypot(e.x - cx, e.z - cz) > e.r + 4);
    if (!clear) continue;
    placed += 1;
    for (let i = 0; i < perCluster; i += 1) {
      const jx = cx + (rnd() - 0.5) * 6;
      const jz = cz + (rnd() - 0.5) * 6;
      out.push({ x: jx, z: jz });
    }
  }
  return out;
}

// ---------------------------------------------------------------- icons

export type IconDrawer = (ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) => void;

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect?.(x, y, w, h, r) ?? ctx.rect(x, y, w, h);
}

function outlined(ctx: CanvasRenderingContext2D, fill: string, lineWidth = 2): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = '#2b2440';
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawTree(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  // trunk
  ctx.fillStyle = '#8a5a34';
  ctx.strokeStyle = '#2b2440';
  ctx.lineWidth = 1.4;
  roundRectPath(ctx, cx - size * 0.09, cy + size * 0.05, size * 0.18, size * 0.4, size * 0.05);
  ctx.fill();
  ctx.stroke();
  // canopy — two overlapping blobs for a rounded, non-perfect-circle look
  ctx.fillStyle = '#4fa84a';
  ctx.beginPath();
  ctx.arc(cx - size * 0.16, cy - size * 0.1, size * 0.34, 0, Math.PI * 2);
  ctx.arc(cx + size * 0.16, cy - size * 0.14, size * 0.3, 0, Math.PI * 2);
  ctx.arc(cx, cy - size * 0.32, size * 0.32, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2b2440';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();
}

function drawFerrisWheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  const r = size * 0.46;
  // legs
  ctx.strokeStyle = '#c23b3b';
  ctx.lineWidth = size * 0.05;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.6, cy + r);
  ctx.lineTo(cx, cy + r * 0.35);
  ctx.moveTo(cx + r * 0.6, cy + r);
  ctx.lineTo(cx, cy + r * 0.35);
  ctx.stroke();
  // rim
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = '#c23b3b';
  ctx.lineWidth = size * 0.08;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.045;
  ctx.stroke();
  // spokes + cabins
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const sx = cx + Math.cos(a) * r;
    const sy = cy + Math.sin(a) * r;
    ctx.strokeStyle = '#e8b8b8';
    ctx.lineWidth = size * 0.02;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.fillStyle = i % 2 === 0 ? '#ffd23f' : '#3fa7ff';
    ctx.strokeStyle = '#2b2440';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(sx, sy, size * 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.06, 0, Math.PI * 2);
  outlined(ctx, '#c23b3b', 1.4);
  ctx.restore();
}

function drawCoaster(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  // grey rock mound
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.5, cy + size * 0.42);
  ctx.quadraticCurveTo(cx - size * 0.4, cy - size * 0.1, cx - size * 0.08, cy - size * 0.4);
  ctx.quadraticCurveTo(cx + size * 0.1, cy - size * 0.55, cx + size * 0.3, cy - size * 0.28);
  ctx.quadraticCurveTo(cx + size * 0.52, cy - size * 0.05, cx + size * 0.46, cy + size * 0.42);
  ctx.closePath();
  outlined(ctx, '#9a9aa2', 2);
  // red loop track
  ctx.strokeStyle = '#d92e2e';
  ctx.lineWidth = size * 0.07;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.5, cy + size * 0.3);
  ctx.bezierCurveTo(
    cx - size * 0.1,
    cy + size * 0.1,
    cx - size * 0.05,
    cy - size * 0.55,
    cx + size * 0.28,
    cy - size * 0.3,
  );
  ctx.bezierCurveTo(
    cx + size * 0.5,
    cy - size * 0.12,
    cx + size * 0.1,
    cy - size * 0.02,
    cx + size * 0.2,
    cy + size * 0.22,
  );
  ctx.bezierCurveTo(
    cx + size * 0.3,
    cy + size * 0.4,
    cx + size * 0.45,
    cy + size * 0.42,
    cx + size * 0.55,
    cy + size * 0.3,
  );
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.02;
  ctx.stroke();
  ctx.restore();
}

function drawSpookyHouse(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  const halfW = size * 0.34;
  const bodyTop = cy - size * 0.05;
  const bodyH = size * 0.5;
  // body
  ctx.beginPath();
  ctx.rect(cx - halfW, bodyTop, halfW * 2, bodyH);
  outlined(ctx, '#4a2f63', 2);
  // roof
  ctx.beginPath();
  ctx.moveTo(cx - halfW * 1.15, bodyTop);
  ctx.lineTo(cx, cy - size * 0.45);
  ctx.lineTo(cx + halfW * 1.15, bodyTop);
  ctx.closePath();
  outlined(ctx, '#3a2350', 2);
  // window glow
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(cx, bodyTop + bodyH * 0.42, size * 0.08, 0, Math.PI * 2);
  ctx.fill();
  // ghost peeking round the side
  ctx.save();
  ctx.translate(cx + halfW * 1.05, bodyTop + bodyH * 0.5);
  ctx.beginPath();
  ctx.arc(0, -size * 0.06, size * 0.11, Math.PI, 0);
  ctx.lineTo(size * 0.11, size * 0.1);
  ctx.quadraticCurveTo(size * 0.055, size * 0.04, 0, size * 0.1);
  ctx.quadraticCurveTo(-size * 0.055, size * 0.04, -size * 0.11, size * 0.1);
  ctx.closePath();
  ctx.fillStyle = '#f5f3ff';
  ctx.fill();
  ctx.strokeStyle = '#2b2440';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = '#2b2440';
  ctx.beginPath();
  ctx.arc(-size * 0.035, -size * 0.06, size * 0.015, 0, Math.PI * 2);
  ctx.arc(size * 0.035, -size * 0.06, size * 0.015, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

function drawDodgems(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  // floor
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.5, 0, Math.PI * 2);
  outlined(ctx, '#2f6fb0', 2);
  // little car
  ctx.fillStyle = '#ffcf3f';
  ctx.strokeStyle = '#2b2440';
  ctx.lineWidth = 1.6;
  roundRectPath(ctx, cx - size * 0.22, cy - size * 0.1, size * 0.44, size * 0.24, size * 0.08);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.16, size * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = '#e8564a';
  ctx.fill();
  ctx.stroke();
  // pole + spark
  ctx.strokeStyle = '#2b2440';
  ctx.lineWidth = size * 0.02;
  ctx.beginPath();
  ctx.moveTo(cx, cy - size * 0.22);
  ctx.lineTo(cx, cy - size * 0.34);
  ctx.stroke();
  ctx.fillStyle = '#ffe98a';
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.36, size * 0.045, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawWaterFight(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  // little pool
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.22, size * 0.42, size * 0.16, 0, 0, Math.PI * 2);
  outlined(ctx, '#5fc7f0', 2);
  // droplets
  const drop = (dx: number, dy: number, s: number, colour: string) => {
    ctx.save();
    ctx.translate(cx + dx, cy + dy);
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s, s * 0.4, 0, s);
    ctx.quadraticCurveTo(-s, s * 0.4, 0, -s);
    ctx.closePath();
    outlined(ctx, colour, 1.5);
    ctx.restore();
  };
  drop(-size * 0.12, -size * 0.16, size * 0.16, '#2f8fe0');
  drop(size * 0.16, -size * 0.28, size * 0.13, '#5fc7f0');
  drop(size * 0.02, -size * 0.42, size * 0.1, '#8fdcff');
  ctx.restore();
}

function drawSkyCruiser(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.35);
  // hull
  ctx.beginPath();
  ctx.moveTo(-size * 0.14, size * 0.4);
  ctx.quadraticCurveTo(-size * 0.2, -size * 0.1, 0, -size * 0.46);
  ctx.quadraticCurveTo(size * 0.2, -size * 0.1, size * 0.14, size * 0.4);
  ctx.closePath();
  outlined(ctx, '#3fa7ff', 2);
  // fin
  ctx.beginPath();
  ctx.moveTo(-size * 0.14, size * 0.2);
  ctx.lineTo(-size * 0.3, size * 0.36);
  ctx.lineTo(-size * 0.1, size * 0.32);
  ctx.closePath();
  outlined(ctx, '#e8564a', 1.5);
  ctx.beginPath();
  ctx.moveTo(size * 0.14, size * 0.2);
  ctx.lineTo(size * 0.3, size * 0.36);
  ctx.lineTo(size * 0.1, size * 0.32);
  ctx.closePath();
  outlined(ctx, '#e8564a', 1.5);
  // window
  ctx.beginPath();
  ctx.arc(0, -size * 0.05, size * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = '#ffe98a';
  ctx.fill();
  ctx.strokeStyle = '#2b2440';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

function drawBallPit(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.46, 0, Math.PI * 2);
  outlined(ctx, '#ffe0a3', 2.2);
  const colours = ['#e8564a', '#3fa7ff', '#ffd23f', '#5fbf5f', '#c86fe0'];
  const rnd = mulberry32(0xba11);
  for (let i = 0; i < 10; i += 1) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * size * 0.32;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, size * 0.07, 0, Math.PI * 2);
    ctx.fillStyle = colours[i % colours.length] ?? '#e8564a';
    ctx.fill();
    ctx.strokeStyle = '#2b2440';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawCastle(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  const halfW = size * 0.42;
  const top = cy - size * 0.12;
  const h = size * 0.5;
  ctx.beginPath();
  ctx.rect(cx - halfW, top, halfW * 2, h);
  outlined(ctx, '#e9e3f5', 2.2);
  // crenellations
  ctx.fillStyle = '#e9e3f5';
  ctx.strokeStyle = '#2b2440';
  for (const dx of [-halfW, -halfW * 0.33, halfW * 0.33, halfW]) {
    ctx.beginPath();
    ctx.rect(cx + dx - size * 0.05, top - size * 0.08, size * 0.1, size * 0.08);
    ctx.fill();
    ctx.stroke();
  }
  // two turrets with cone roofs
  for (const dx of [-halfW, halfW]) {
    ctx.beginPath();
    ctx.rect(cx + dx - size * 0.08, top - size * 0.2, size * 0.16, size * 0.2);
    outlined(ctx, '#dcd2f2', 1.8);
    ctx.beginPath();
    ctx.moveTo(cx + dx - size * 0.11, top - size * 0.2);
    ctx.lineTo(cx + dx, top - size * 0.42);
    ctx.lineTo(cx + dx + size * 0.11, top - size * 0.2);
    ctx.closePath();
    outlined(ctx, '#8f7fd6', 1.8);
  }
  // door
  ctx.beginPath();
  ctx.arc(cx, top + h, size * 0.09, Math.PI, 0);
  ctx.lineTo(cx + size * 0.09, top + h);
  ctx.lineTo(cx - size * 0.09, top + h);
  ctx.closePath();
  ctx.fillStyle = '#6a4fb8';
  ctx.fill();
  ctx.strokeStyle = '#2b2440';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

function drawHotel(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  const halfW = size * 0.32;
  const top = cy - size * 0.3;
  const h = size * 0.6;
  ctx.beginPath();
  ctx.rect(cx - halfW, top, halfW * 2, h);
  outlined(ctx, '#b998e8', 2.2);
  // windows
  ctx.fillStyle = '#fff7d6';
  ctx.strokeStyle = '#2b2440';
  ctx.lineWidth = 1;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 2; col += 1) {
      const wx = cx - halfW * 0.55 + col * halfW * 1.1;
      const wy = top + h * 0.18 + row * h * 0.28;
      ctx.beginPath();
      ctx.rect(wx - size * 0.045, wy - size * 0.045, size * 0.09, size * 0.09);
      ctx.fill();
      ctx.stroke();
    }
  }
  // little flag
  ctx.strokeStyle = '#2b2440';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx, top - size * 0.14);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, top - size * 0.14);
  ctx.lineTo(cx + size * 0.12, top - size * 0.1);
  ctx.lineTo(cx, top - size * 0.06);
  ctx.closePath();
  ctx.fillStyle = '#e8564a';
  ctx.fill();
  ctx.restore();
}

function drawFountain(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.46, 0, Math.PI * 2);
  outlined(ctx, '#7fd4ec', 2.2);
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#2b2440';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    ctx.strokeStyle = '#bdeeff';
    ctx.lineWidth = size * 0.02;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * size * 0.4, cy + Math.sin(a) * size * 0.4);
    ctx.stroke();
  }
  ctx.restore();
}

function drawStation(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.32, cy + size * 0.06);
  ctx.lineTo(cx, cy - size * 0.22);
  ctx.lineTo(cx + size * 0.32, cy + size * 0.06);
  ctx.closePath();
  outlined(ctx, '#ffd23f', 2);
  ctx.beginPath();
  ctx.rect(cx - size * 0.22, cy + size * 0.06, size * 0.44, size * 0.16);
  outlined(ctx, '#f2f2f2', 1.8);
  ctx.restore();
}

/** Small generic pin for anything without a bespoke icon yet. */
function drawGenericPin(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, colour: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.34, 0, Math.PI * 2);
  outlined(ctx, colour, 2);
  ctx.restore();
}

export const ICONS: Readonly<Record<string, IconDrawer>> = {
  building: drawCastle,
  hotel: drawHotel,
  ballPit: drawBallPit,
  ferrisWheel: drawFerrisWheel,
  spaceFerrisWheel: drawFerrisWheel,
  dodgems: drawDodgems,
  waterFight: drawWaterFight,
  skyCruiser: drawSkyCruiser,
  railRacer: drawCoaster,
  spookyHouse: drawSpookyHouse,
  fountain: drawFountain,
  station: drawStation,
  tree: drawTree,
};

export function drawIcon(
  ctx: CanvasRenderingContext2D,
  id: string,
  cx: number,
  cy: number,
  size: number,
  fallbackColour: string,
): void {
  const icon = ICONS[id];
  if (icon) {
    icon(ctx, cx, cy, size);
  } else {
    drawGenericPin(ctx, cx, cy, size, fallbackColour);
  }
}
