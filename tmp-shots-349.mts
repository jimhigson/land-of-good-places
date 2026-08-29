/**
 * Emits a JSON list of camera shots that walk right round both bridges at a
 * child's eye height, plus close-ups at each ramp foot — the places the first
 * round did NOT look.
 */
import './scripts/headless-canvas.mjs';
import { buildHeadlessPark } from './scripts/park-harness.mts';
import { terrainHeight } from './src/world/terrain.ts';
import { frameFor } from './src/world/train/bridgeSpine.ts';
import { Box3 } from 'three';

const park = buildHeadlessPark();
const train = park.world.train;
const bridgesGroup = train.group.getObjectByName('railway-bridges')!;
bridgesGroup.updateMatrixWorld(true);

const shots: [string, string, string][] = [];
const EYE = 1.35; // a six-year-old's eye height

for (const group of bridgesGroup.children) {
  const crossing = train.crossings.find((c) => `bridge-${c.railDistance.toFixed(1)}` === group.name);
  if (!crossing) continue;
  const frame = frameFor(crossing);
  const box = new Box3().setFromObject(group);
  const mid = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 };
  const tag = group.name.replace(/[^a-z0-9]/gi, '');

  // Right round the bridge at eye height, 16 m out.
  for (let a = 0; a < 360; a += 45) {
    const r = 16;
    const cx = mid.x + Math.cos((a * Math.PI) / 180) * r;
    const cz = mid.z + Math.sin((a * Math.PI) / 180) * r;
    const cy = terrainHeight(cx, cz) + EYE + 1.0;
    shots.push([
      `${tag}-orbit${a}`,
      `${cx.toFixed(2)},${cy.toFixed(2)},${cz.toFixed(2)}`,
      `${(mid.x - cx).toFixed(3)},${(mid.y - cy).toFixed(3)},${(mid.z - cz).toFixed(3)}`,
    ]);
  }

  // The ramp feet: stand just beyond where the masonry ends, at eye height,
  // looking back up the ramp. This is the spot the first round argued about
  // instead of looking at.
  for (const sign of [1, -1] as const) {
    for (const along of [19, 21, 24]) {
      const foot = frame.worldAt(along * sign, 0, 0);
      const beyond = frame.worldAt((along + 6) * sign, 0, 0);
      const cy = terrainHeight(beyond.x, beyond.z) + EYE;
      const ty = terrainHeight(foot.x, foot.z) + 1.0;
      shots.push([
        `${tag}-foot${sign > 0 ? 'pos' : 'neg'}${along}`,
        `${beyond.x.toFixed(2)},${cy.toFixed(2)},${beyond.z.toFixed(2)}`,
        `${(foot.x - beyond.x).toFixed(3)},${(ty - cy).toFixed(3)},${(foot.z - beyond.z).toFixed(3)}`,
      ]);
    }
    // And from the side of the ramp foot, low, where an overhang would show
    // against the grass.
    const foot = frame.worldAt(20 * sign, 0, 0);
    const at0 = frame.pointAt(0);
    for (const side of [1, -1] as const) {
      const cx = foot.x + at0.acrossX * 7 * side;
      const cz = foot.z + at0.acrossZ * 7 * side;
      const cy = terrainHeight(cx, cz) + EYE;
      shots.push([
        `${tag}-footside${sign > 0 ? 'pos' : 'neg'}${side > 0 ? 'A' : 'B'}`,
        `${cx.toFixed(2)},${cy.toFixed(2)},${cz.toFixed(2)}`,
        `${(foot.x - cx).toFixed(3)},${(terrainHeight(foot.x, foot.z) + 0.8 - cy).toFixed(3)},${(foot.z - cz).toFixed(3)}`,
      ]);
    }
  }
}

console.log(JSON.stringify(shots));
