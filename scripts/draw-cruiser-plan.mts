/**
 * Draws the Sky Cruiser's loop in plan view, as an SVG.
 *
 * Migrating the ride to the new generator changes the *shape* of its loop on a
 * park the family has already approved, and a shape question is best answered
 * by looking at the shape. A 3D screenshot shows what a rider sees; this shows
 * the whole loop at once, with the castle and the big wheel it has to go
 * around, which is the thing actually being decided.
 *
 * It also draws several route salts side by side, so the choice is between real
 * alternatives rather than take-it-or-leave-it.
 *
 * Writes to `art-samples/` by default; pass a directory to change that. Needs
 * no browser and no dev server, so it costs nothing to regenerate.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outDir = resolve(process.argv[2] ?? 'art-samples');
mkdirSync(outDir, { recursive: true });

const { CoasterRoute } = await import('../src/world/coaster/route.ts');
const { placedEntry, PARK_LAYOUT } = await import('../src/world/parkLayout.ts');
const { Vector3 } = await import('three');

/** Metres shown either side of the park's middle. */
const EXTENT = 62;
const SIZE = 620;

const toPx = (metres: number): number => ((metres + EXTENT) / (EXTENT * 2)) * SIZE;

interface Drawn {
  readonly salt: number;
  readonly label: string;
}

/**
 * The canonical ride's salt, plus a few alternatives.
 *
 * The first is what this branch actually ships. The rest exist so the shape can
 * be chosen rather than merely accepted — changing `CRUISER_SEED.routeSalt` in
 * `coaster/plan.ts` is a one-line change if a different one is preferred.
 */
const VARIANTS: readonly Drawn[] = [
  { salt: 0xc0a57e, label: 'as shipped (routeSalt 0xc0a57e)' },
  { salt: 0xc0a580, label: 'alternative A (routeSalt 0xc0a580)' },
  { salt: 0xc0a590, label: 'alternative B (routeSalt 0xc0a590)' },
  { salt: 0xc0a5a0, label: 'alternative C (routeSalt 0xc0a5a0)' },
];

function draw(variant: Drawn): string {
  const route = new CoasterRoute({ salt: variant.salt, stationStallId: 'stall.skyCruiser' });
  const castle = placedEntry('building');
  const wheel = placedEntry('ferrisWheel');
  const stall = placedEntry('stall.skyCruiser');

  const parts: string[] = [];
  parts.push(
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE + 54}" fill="#f7f4ec"/>`,
    // The park's own edge, and the band the coaster is not allowed into.
    `<circle cx="${toPx(0)}" cy="${toPx(0)}" r="${(58 / (EXTENT * 2)) * SIZE}" fill="none" stroke="#d8d0bd" stroke-width="1.5"/>`,
    `<circle cx="${toPx(0)}" cy="${toPx(0)}" r="${(47 / (EXTENT * 2)) * SIZE}" fill="none" stroke="#e4dcc8" stroke-width="1" stroke-dasharray="4 4"/>`,
  );

  // Every plot, faintly — the loop flies over these, but they say where the
  // park's furniture is.
  for (const entry of PARK_LAYOUT.entries.values()) {
    parts.push(
      `<circle cx="${toPx(entry.x)}" cy="${toPx(entry.z)}" r="${(entry.boundingRadius / (EXTENT * 2)) * SIZE}" fill="#ece6d6" stroke="none"/>`,
    );
  }

  // The two it cannot fly over, in a colour that says so.
  for (const [obstacle, name] of [
    [castle, 'castle'],
    [wheel, 'big wheel'],
  ] as const) {
    parts.push(
      `<circle cx="${toPx(obstacle.x)}" cy="${toPx(obstacle.z)}" r="${(obstacle.boundingRadius / (EXTENT * 2)) * SIZE}" fill="#f3c9c2" stroke="#c9756a" stroke-width="1.5"/>`,
      `<text x="${toPx(obstacle.x)}" y="${toPx(obstacle.z)}" font-family="system-ui,sans-serif" font-size="11" fill="#8a4a41" text-anchor="middle" dominant-baseline="middle">${name}</text>`,
    );
  }

  // The track itself, sampled off the finished curve.
  const point = new Vector3();
  const steps = 600;
  const path: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    route.pointAt((i / steps) * route.length, point);
    path.push(`${i === 0 ? 'M' : 'L'}${toPx(point.x).toFixed(1)} ${toPx(point.z).toFixed(1)}`);
  }
  parts.push(
    `<path d="${path.join(' ')}" fill="none" stroke="#2f6f8f" stroke-width="3" stroke-linejoin="round"/>`,
  );

  // The station and the booth that boards it.
  route.pointAt(route.stationDistance, point);
  parts.push(
    `<circle cx="${toPx(stall.x)}" cy="${toPx(stall.z)}" r="5" fill="#e0a84a"/>`,
    `<circle cx="${toPx(point.x)}" cy="${toPx(point.z)}" r="6" fill="#2f6f8f"/>`,
    `<line x1="${toPx(stall.x)}" y1="${toPx(stall.z)}" x2="${toPx(point.x)}" y2="${toPx(point.z)}" stroke="#e0a84a" stroke-width="1.5" stroke-dasharray="3 3"/>`,
  );

  // What the numbers came out at, on the picture rather than in a log.
  let worstCastle = Infinity;
  let worstWheel = Infinity;
  for (let d = 0; d < route.length; d += 1) {
    route.pointAt(d, point);
    worstCastle = Math.min(
      worstCastle,
      Math.hypot(point.x - castle.x, point.z - castle.z) - castle.boundingRadius,
    );
    worstWheel = Math.min(
      worstWheel,
      Math.hypot(point.x - wheel.x, point.z - wheel.z) - wheel.boundingRadius,
    );
  }
  parts.push(
    `<text x="12" y="${SIZE + 20}" font-family="system-ui,sans-serif" font-size="14" fill="#33302a">${variant.label}</text>`,
    `<text x="12" y="${SIZE + 40}" font-family="system-ui,sans-serif" font-size="12" fill="#6b665c">` +
      `${route.length.toFixed(0)} m of track · tightest turn ${route.plan.minCurvature.toFixed(1)} m · ` +
      `clears the castle by ${worstCastle.toFixed(1)} m · clears the wheel by ${worstWheel.toFixed(1)} m</text>`,
  );

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE + 54}" viewBox="0 0 ${SIZE} ${SIZE + 54}">` +
    parts.join('') +
    '</svg>'
  );
}

for (const variant of VARIANTS) {
  const name = `cruiser-plan-${variant.salt.toString(16)}.svg`;
  writeFileSync(resolve(outDir, name), draw(variant));
  console.log(`wrote ${resolve(outDir, name)}`);
}
