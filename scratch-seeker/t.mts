import { GROUND_SPHERE_RADIUS } from '../src/core/constants.ts';
import { terrainHeight } from '../src/world/terrain.ts';
console.log('R =', GROUND_SPHERE_RADIUS);
for (const d of [0, 20, 40, 57, 80, 100, 120, 140, 157, 180]) {
  const y = terrainHeight(d, 0);
  const lean = (Math.asin(Math.min(1, d / GROUND_SPHERE_RADIUS)) * 180) / Math.PI;
  const grad = d / Math.sqrt(Math.max(1e-9, GROUND_SPHERE_RADIUS ** 2 - d * d));
  console.log(`d=${d}\ty=${y.toFixed(2)}\tlean=${lean.toFixed(1)}\tcos=${Math.cos((lean * Math.PI) / 180).toFixed(3)}\tgrad=${grad.toFixed(2)}`);
}
