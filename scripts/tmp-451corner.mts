/** TEMP diagnostic: what stands on seed 451's `spur-stall.spookyHouse`?
 *
 * The predecessor named "a V of border fence". The two runs it printed share
 * an endpoint, are perpendicular, and are 4.20 m and 2.65 m long with
 * halfThick 0.30 — which is the signature of a rotated RECTANGLE, not a fence
 * line. This asks the question directly: complete the rectangle, and compare
 * it with the anchors the park placed.
 *
 * CONTROL, rebuilt because the predecessor's did not discriminate: its
 * blocker query used a flat 0.7 m clearance while `tmp-transect.mts` uses
 * `NPC_RADIUS - 0.02` on paving, so the lane end at (32.9,-34.2) read BLOCKED
 * there and clear here for no reason but the constant. This uses the SAME
 * clearance rule as the transect, so the two instruments answer one question.
 * Control rows: two points the transect measured clear, and one it measured
 * blocked. A run where all three read the same is uninformative. */
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PARK_LAYOUT } from '../src/world/parkLayout.ts';
import { isOnPath } from '../src/world/pathGraph.ts';
import { NPC_RADIUS } from '../src/core/constants.ts';

const park = quietly(() => buildHeadlessPark());
const world = park.world;
const PAVED_CLEARANCE = NPC_RADIUS - 0.02;
const OPEN_CLEARANCE = 0.7;
const clearanceAt = (x: number, z: number): number =>
  isOnPath(x, z, 0) ? PAVED_CLEARANCE : OPEN_CLEARANCE;

const probe = new Vector3();
const resolves = (x: number, z: number): { ok: boolean; push: number } => {
  probe.set(x, 0, z);
  world.collision.resolve(probe, clearanceAt(x, z));
  const dx = probe.x - x;
  const dz = probe.z - z;
  return { ok: dx * dx + dz * dz < 1e-6, push: Math.hypot(dx, dz) };
};

const walls: { a: [number, number]; b: [number, number]; half: number }[] = [];
world.collision.forEachWall((x1, z1, x2, z2, halfThickness) => {
  walls.push({ a: [x1, z1], b: [x2, z2], half: halfThickness });
});

const near = (x: number, z: number, r: number) =>
  walls.filter((w) => {
    const dx = w.b[0] - w.a[0];
    const dz = w.b[1] - w.a[1];
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - w.a[0]) * dx + (z - w.a[1]) * dz) / len2));
    return Math.hypot(w.a[0] + dx * t - x, w.a[1] + dz * t - z) < r;
  });

console.log('walls within 6 m of the blockage peak (32.82,-33.28):');
for (const w of near(32.82, -33.28, 6)) {
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const yaw = (Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]) * 180) / Math.PI;
  console.log(
    `  (${w.a[0].toFixed(2)},${w.a[1].toFixed(2)})-(${w.b[0].toFixed(2)},${w.b[1].toFixed(2)}) ` +
      `len=${len.toFixed(2)} yaw=${yaw.toFixed(1)}deg half=${w.half.toFixed(2)}`,
  );
}

console.log('\nplaced entries within 12 m of (32.0,-31.0):');
for (const e of PARK_LAYOUT.entries.values()) {
  const d = Math.hypot(e.x - 32.0, e.z + 31.0);
  if (d < 12)
    console.log(
      `  ${e.id} at (${e.x.toFixed(2)},${e.z.toFixed(2)}) r=${e.boundingRadius.toFixed(2)} ` +
        `signYaw=${((e.signYaw * 180) / Math.PI).toFixed(1)}deg d=${d.toFixed(2)} ` +
        `entrance=(${e.entranceX.toFixed(2)},${e.entranceZ.toFixed(2)}) fp=${JSON.stringify(e.footprint)}`,
    );
}

console.log('\nCONTROL rows (same clearance rule as tmp-transect.mts):');
for (const [label, x, z] of [
  ['transect said CLEAR  lane at=14', 32.7, -31.9],
  ['transect said CLEAR  lane at=7 ', 32.9, -34.2],
  ['transect said BLOCKED peak     ', 32.82, -33.28],
] as const) {
  const r = resolves(x, z);
  console.log(
    `  ${label} (${x},${z}) onPath=${isOnPath(x, z, 0) ? 'Y' : '.'} ` +
      `clearance=${clearanceAt(x, z).toFixed(2)} ` +
      `${r.ok ? 'clear' : `BLOCKED push=${r.push.toFixed(2)}`}`,
  );
}

// --- the route, at full precision, against the plot's own footprint ---
const { PATH_GRAPH } = await import('../src/world/pathGraph.ts');
const spur = PATH_GRAPH.edges.find((e) => e.route.name === 'spur-stall.spookyHouse');
const plot = [...PARK_LAYOUT.entries.values()].find((e) => e.id === 'stall.spookyHouse');
if (spur && plot) {
  console.log(`\nroute width=${spur.route.width} points:`);
  for (const p of spur.route.points) console.log(`   (${p[0]},${p[1]})`);
  const r = plot.footprint.kind === 'circle' ? plot.footprint.radius : NaN;
  console.log(`plot centre (${plot.x},${plot.z}) footprint=${JSON.stringify(plot.footprint)}`);
  const a = spur.route.points[0]!;
  const b = spur.route.points[spur.route.points.length - 1]!;
  console.log('distanceToPlotEdge along the control segment (STREET screen samples every 1.5 m):');
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(1, Math.ceil(len / 1.5));
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    console.log(
      `   d=${(len * t).toFixed(2).padStart(5)} (${x.toFixed(2)},${z.toFixed(2)}) ` +
        `edge=${(Math.hypot(x - plot.x, z - plot.z) - r).toFixed(2)}`,
    );
  }
  console.log(`endpoint edge = ${(Math.hypot(b[0] - plot.x, b[1] - plot.z) - r).toFixed(3)}`);
}
