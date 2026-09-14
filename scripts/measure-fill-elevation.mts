import { Vector3 } from 'three';
import { terrainHeight, upAt } from '../src/world/terrain.ts';

const RISE = 0.55;

/** Elevation of the fill above the local horizon, old form and new, in degrees. */
function compare(d: number, sunElev: number) {
  const key = new Vector3(Math.cos(sunElev), Math.sin(sunElev), -0.3).normalize();
  const x = d, z = 0;
  const y = terrainHeight(x, z);
  const up = upAt(x, y, z, new Vector3());
  const bearing = key.clone().negate();

  const oldDir = new Vector3(bearing.x, RISE, bearing.z).normalize();
  const oldAbove = Math.asin(oldDir.dot(up)) * 180 / Math.PI;

  const horizontal = Math.hypot(bearing.x, bearing.z);
  const flat = bearing.clone().addScaledVector(up, -bearing.dot(up));
  const t = flat.length();
  if (t > 1e-4) flat.multiplyScalar(horizontal / t);
  const newDir = flat.addScaledVector(up, RISE).normalize();
  const newAbove = Math.asin(newDir.dot(up)) * 180 / Math.PI;
  const lean = Math.acos(up.y) * 180 / Math.PI;
  return { lean, oldAbove, newAbove };
}

for (const sunElev of [0.52, 1.3]) {
  console.log(`\nsun ${(sunElev*180/Math.PI).toFixed(0)}deg up:`);
  for (const d of [0, 40, 100, 157]) {
    const { lean, oldAbove, newAbove } = compare(d, sunElev);
    console.log(`  d=${String(d).padStart(3)}m lean=${lean.toFixed(1).padStart(4)}deg  fill above LOCAL horizon: before ${oldAbove.toFixed(1).padStart(6)}deg -> after ${newAbove.toFixed(1).padStart(5)}deg`);
  }
}
