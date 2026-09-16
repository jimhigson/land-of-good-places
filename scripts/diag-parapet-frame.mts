/**
 * **Why does `noBridgeParapetCanBeSeenThrough` fail on the bent bridge?**
 *
 * The clause's own data (`ParkFacts.bridgeParapetRings`), its own face
 * midpoints, its own two rays — and then ONE variable changed at a time, so a
 * difference names its own cause:
 *
 *  - `world`  — exactly what the clause does today: drop by world `y` from the
 *               wall top, fire horizontally along the PLAN normal.
 *  - `local`  — drop along the LOCAL up, fire along the plan normal projected
 *               into that point's own horizontal plane. The frame hypothesis.
 *
 * And for every judged sample it records how far the probe has gone below the
 * **wall's own height** (`PARAPET_HEIGHT + PARAPET_CROWN_LIFT` = 1.17 m), so a
 * miss that only ever happens under the wall cannot be mistaken for a hole in
 * it.
 */
import './headless-canvas.mjs';
import { Raycaster, Vector3, type Object3D } from 'three';
import { buildParkFacts } from '../test/procgen/parkFacts.ts';
import { PARAPET_HEIGHT, PARAPET_CROWN_LIFT } from '../src/world/train/bridges.ts';
import { upFor } from '../src/world/up.ts';
import { terrainHeight } from '../src/world/terrain.ts';

const seed = Number(process.env.LGP_SEED ?? 20260728);
const facts = await buildParkFacts(seed);

const STANDOFF = 3.0, INNER_STANDOFF = 1.2, HIT_SLACK = 0.25, PROBE_STEP = 0.05, PROBE_BOTTOM = 1.5;
const WALL_HEIGHT = PARAPET_HEIGHT + PARAPET_CROWN_LIFT;

const raycaster = new Raycaster();
const groups = new Map<string, Object3D>();
for (const crossing of facts.world.train.crossings) {
  const name = `bridge-${crossing.railDistance.toFixed(1)}`;
  const g = facts.world.train.group.getObjectByName(name);
  if (g) groups.set(name, g);
}
const hit = (group: Object3D) =>
  raycaster.intersectObject(group, true).some((c) => c.object.name !== 'deck');

type Row = { bridge: string; drop: number; belowWall: number; underground: number;
             world: boolean; local: boolean; tilt: number };
const rows: Row[] = [];
const rings = facts.bridgeParapetRings;

for (let i = 0; i + 1 < rings.length; i += 1) {
  const a = rings[i]!, next = rings[i + 2];
  if (!next || next.bridge !== a.bridge) continue;
  if (!a.expected || !next.expected) continue;
  const group = groups.get(a.bridge);
  if (!group) continue;
  const ox = (a.outer[0] + next.outer[0]) / 2, oz = (a.outer[1] + next.outer[1]) / 2;
  const ix = (a.inner[0] + next.inner[0]) / 2, iz = (a.inner[1] + next.inner[1]) / 2;
  const top = (a.top + next.top) / 2;
  const nx = ox - ix, nz = oz - iz;
  const norm = Math.hypot(nx, nz);
  if (norm < 1e-6) continue;
  const ux = nx / norm, uz = nz / norm;

  const up = upFor(ox, top, oz, new Vector3());
  const tilt = (Math.acos(Math.max(-1, Math.min(1, up.y))) * 180) / Math.PI;
  // plan normal projected into THIS point's own horizontal plane
  const n3 = new Vector3(ux, 0, uz);
  n3.addScaledVector(up, -n3.dot(up));
  if (n3.lengthSq() < 1e-12) continue;
  n3.normalize();

  for (let drop = 0.03; drop <= PROBE_BOTTOM + 1e-9; drop += PROBE_STEP) {
    // --- the clause's own control, unchanged: is there wall here at all?
    raycaster.set(new Vector3(ix - ux * INNER_STANDOFF, top - drop, iz - uz * INNER_STANDOFF),
                  new Vector3(ux, 0, uz));
    raycaster.far = INNER_STANDOFF + norm + HIT_SLACK;
    if (!hit(group)) continue;

    // --- variable 1: the world frame (what ships)
    raycaster.set(new Vector3(ox + ux * STANDOFF, top - drop, oz + uz * STANDOFF),
                  new Vector3(-ux, 0, -uz));
    raycaster.far = STANDOFF + HIT_SLACK;
    const world = hit(group);

    // --- variable 2: the local frame, ONLY the frame changed
    const topPt = new Vector3(ox, top, oz);
    const at = topPt.clone().addScaledVector(up, -drop);
    const start = at.clone().addScaledVector(n3, STANDOFF);
    raycaster.set(start, n3.clone().negate());
    raycaster.far = STANDOFF + HIT_SLACK;
    const local = hit(group);

    rows.push({ bridge: a.bridge, drop, belowWall: drop - WALL_HEIGHT,
                underground: (top - drop) - terrainHeight(ox, oz), world, local, tilt });
  }
}

console.log(`seed ${seed}: ${rows.length} judged samples, wall height ${WALL_HEIGHT.toFixed(2)} m, probe bottom ${PROBE_BOTTOM} m\n`);

const miss = rows.filter((r) => !r.world);
console.log(`world-frame MISSES (what the clause reports): ${miss.length}`);
if (miss.length) {
  const drops = miss.map((r) => r.drop);
  console.log(`  drop range of every miss: ${Math.min(...drops).toFixed(2)} – ${Math.max(...drops).toFixed(2)} m below the top`);
  console.log(`  of those, BELOW the wall's own ${WALL_HEIGHT.toFixed(2)} m height: ${miss.filter((r) => r.belowWall > 0).length} of ${miss.length}`);
  console.log(`  of those, UNDERGROUND: ${miss.filter((r) => r.underground < 0).length} of ${miss.length}`);
}

console.log(`\n--- the frame hypothesis, one variable ---`);
const wm = rows.filter((r) => !r.world && r.local).length;
const lm = rows.filter((r) => r.world && !r.local).length;
const bm = rows.filter((r) => !r.world && !r.local).length;
console.log(`  world MISS / local HIT (supports frame): ${wm}`);
console.log(`  world HIT  / local MISS               : ${lm}`);
console.log(`  both miss                              : ${bm}`);
console.log(`  both hit                               : ${rows.filter((r) => r.world && r.local).length}`);

console.log(`\n--- does the miss rate grow with tilt? (a frame error must) ---`);
const byBridge = new Map<string, Row[]>();
for (const r of rows) (byBridge.get(r.bridge) ?? byBridge.set(r.bridge, []).get(r.bridge)!).push(r);
const sorted = [...byBridge].sort((a, b) => (a[1][0]?.tilt ?? 0) - (b[1][0]?.tilt ?? 0));
for (const [name, rs] of sorted) {
  const m = rs.filter((r) => !r.world).length;
  console.log(`  ${name.padEnd(15)} tilt ${(rs[0]?.tilt ?? 0).toFixed(1).padStart(5)}°  world-miss ${String(m).padStart(4)} / ${String(rs.length).padStart(5)}   local-miss ${String(rs.filter((r) => !r.local).length).padStart(4)}`);
}

console.log(`\n--- CONTROL: restrict the probe to the wall's own height ---`);
const within = rows.filter((r) => r.belowWall <= 0);
console.log(`  samples at or above the wall bottom: ${within.length}`);
console.log(`  world-frame misses among them:       ${within.filter((r) => !r.world).length}`);
console.log(`  (if this is 0, every reported hole is the probe running off the bottom of the wall)`);
