import { buildHeadlessPark } from './scripts/park-harness.mts';
import { frameFor } from './src/world/train/bridgeSpine.ts';
import { terrainHeight } from './src/world/terrain.ts';

const t = buildHeadlessPark().world.train;
for (const c of t.crossings) {
  const name = `bridge-${c.railDistance.toFixed(1)}`;
  if (name !== 'bridge-172.0') continue;
  const frame = frameFor(c);
  const at0 = frame.pointAt(0);
  // The worst protrusion the measurement found, from the handoff.
  const W = { x: -20.45, y: 4.35, z: 38.71 };
  // Which side of the deck is it on? Project it into the frame.
  const p = frame.project(W.x, W.z, 0);
  const side = p.across >= 0 ? 1 : -1;
  const ax = at0.acrossX * side;
  const az = at0.acrossZ * side;
  for (const out of [7, 10]) {
    const cx = W.x + ax * out;
    const cz = W.z + az * out;
    const ground = terrainHeight(cx, cz);
    const cy = ground + 1.8;
    const dx = W.x - cx;
    const dy = W.y - cy;
    const dz = W.z - cz;
    console.log(
      `out=${out}  camPos=${cx.toFixed(2)},${cy.toFixed(2)},${cz.toFixed(2)}` +
        `  camDir=${dx.toFixed(3)},${dy.toFixed(3)},${dz.toFixed(3)}`,
    );
  }
  console.log(`crossing (${c.x.toFixed(2)}, ${c.z.toFixed(2)}) across=(${ax.toFixed(3)}, ${az.toFixed(3)}) projAcross=${p.across.toFixed(3)}`);
}
