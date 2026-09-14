import { terrainHeight } from '../src/world/terrain.ts';
let first = null;
for (let d = 0; d < 200; d += 0.1) {
  for (const ang of [0, 1, 2, 3]) {
    const x = d * Math.cos((ang * Math.PI) / 2);
    const z = d * Math.sin((ang * Math.PI) / 2);
    if (terrainHeight(x, z) < -2 && first === null) first = [d, ang, terrainHeight(x, z)];
  }
}
console.log('first grass below y=-2 at d =', first);
