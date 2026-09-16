import { terrainHeight } from '../src/world/terrain.ts';
import { GROUND_SPHERE_RADIUS, TERRAIN_HEIGHT_SCALE } from '../src/core/constants.ts';

// ---- CONTROL: the instrument must report a known slope ----------------
function gradOf(f: (x: number, z: number) => number, x: number, z: number, e: number) {
  const dx = (f(x + e, z) - f(x - e, z)) / (2 * e);
  const dz = (f(x, z + e) - f(x, z - e)) / (2 * e);
  return { mag: Math.hypot(dx, dz), dx, dz };
}
const plane = (x: number, _z: number) => 0.15 * x;                 // known 15%
const ramp = (x: number, z: number) => 0.03 * x + 0.04 * z;        // known 5%
for (const [name, f, want] of [['15% plane', plane, 0.15], ['3/4 -> 5% ramp', ramp, 0.05]] as const) {
  const g = gradOf(f, 37, -12, 0.25);
  console.log(`CONTROL ${name}: measured ${(g.mag * 100).toFixed(4)}% expected ${(want * 100).toFixed(2)}%`);
}
// control 2: the cap alone, with the sine waves switched off, must equal d/sqrt(R^2-d^2)
const capOnly = (x: number, z: number) => {
  const d2 = x * x + z * z;
  return -(GROUND_SPHERE_RADIUS - Math.sqrt(GROUND_SPHERE_RADIUS * GROUND_SPHERE_RADIUS - d2));
};
for (const d of [50, 105, 117]) {
  const g = gradOf(capOnly, d, 0, 0.25);
  const analytic = d / Math.sqrt(GROUND_SPHERE_RADIUS ** 2 - d * d);
  console.log(`CONTROL cap at ${d} m: measured ${(g.mag * 100).toFixed(4)}%  analytic ${(analytic * 100).toFixed(4)}%`);
}
// control 3: step-size sensitivity on the real terrain
const probe: [number, number] = [61.5, -44.25];
for (const e of [0.05, 0.1, 0.25, 0.6, 1.5]) {
  console.log(`  step e=${e}: ${(gradOf(terrainHeight, probe[0], probe[1], e).mag * 100).toFixed(3)}%`);
}

// ---- THE MAP ----------------------------------------------------------
console.log(`\nGROUND_SPHERE_RADIUS=${GROUND_SPHERE_RADIUS} TERRAIN_HEIGHT_SCALE=${TERRAIN_HEIGHT_SCALE}`);
const E = 0.25; // half a stride; finer than the 0.6 terrainNormal uses
type Row = { r: number; worst: number; wx: number; wz: number; mean: number; n: number; capOnly: number };
const rows: Row[] = [];
const RINGS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 105, 110, 117, 120];
for (const r of RINGS) {
  let worst = 0, wx = 0, wz = 0, sum = 0, n = 0;
  const steps = Math.max(360, Math.round((2 * Math.PI * r) / 0.5));
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const g = gradOf(terrainHeight, x, z, E).mag;
    sum += g; n += 1;
    if (g > worst) { worst = g; wx = x; wz = z; }
  }
  rows.push({ r, worst, wx, wz, mean: sum / n, n, capOnly: r / Math.sqrt(GROUND_SPHERE_RADIUS ** 2 - r * r) });
}
console.log('\nring(m)  cap-alone%   mean%   worst%   worst deg   at (x,z)');
for (const q of rows) {
  console.log(
    `${String(q.r).padStart(5)}   ${(q.capOnly * 100).toFixed(2).padStart(8)}  ${(q.mean * 100).toFixed(2).padStart(6)}  ${(q.worst * 100).toFixed(2).padStart(7)}  ${((Math.atan(q.worst) * 180) / Math.PI).toFixed(2).padStart(8)}    ${q.wx.toFixed(1)},${q.wz.toFixed(1)}`,
  );
}

// full-disc grid sweep, 0.5 m
let gWorst = 0, gx = 0, gz = 0;
const hist = new Map<number, number>();
let cells = 0;
for (let x = -122; x <= 122; x += 0.5) {
  for (let z = -122; z <= 122; z += 0.5) {
    const d = Math.hypot(x, z);
    if (d > 122) continue;
    const g = gradOf(terrainHeight, x, z, E).mag;
    cells += 1;
    const b = Math.floor(g * 100);
    hist.set(b, (hist.get(b) ?? 0) + 1);
    if (g > gWorst) { gWorst = g; gx = x; gz = z; }
  }
}
console.log(`\ngrid sweep 0.5 m, ${cells} cells inside r<=122 m`);
console.log(`WORST ANYWHERE: ${(gWorst * 100).toFixed(2)}% (${((Math.atan(gWorst) * 180) / Math.PI).toFixed(2)} deg) at ${gx.toFixed(1)}, ${gz.toFixed(1)} (r=${Math.hypot(gx, gz).toFixed(1)} m)`);
console.log('\ngradient histogram (whole-percent bucket: share of disc)');
const keys = [...hist.keys()].sort((a, b) => a - b);
for (const k of keys) console.log(`  ${k}-${k + 1}%  ${((hist.get(k)! / cells) * 100).toFixed(1)}%`);

// what a smaller sphere would cost: worst grade including the sine waves
console.log('\nif GROUND_SPHERE_RADIUS changed (sine waves unchanged, worst case adds ~same):');
const sineWorst = (() => {
  // measure the sine-wave part alone
  const base = (x: number, z: number) => {
    const broad = Math.sin(x * 0.055) * Math.cos(z * 0.048) * 0.62;
    const medium = Math.sin(x * 0.108 + 1.7) * Math.sin(z * 0.094 - 0.6) * 0.3;
    const fine = Math.cos((x + z) * 0.031) * 0.34;
    return (broad + medium + fine) * TERRAIN_HEIGHT_SCALE;
  };
  let w = 0;
  for (let x = -122; x <= 122; x += 0.5) for (let z = -122; z <= 122; z += 0.5) {
    if (Math.hypot(x, z) > 122) continue;
    const g = gradOf(base, x, z, E).mag;
    if (g > w) w = g;
  }
  return w;
})();
console.log(`  the rolling sine waves alone reach ${(sineWorst * 100).toFixed(2)}% at their worst`);
for (const R of [400, 500, 600, 800, 1000, 1200, 1600, 2000]) {
  const capAt117 = 117 / Math.sqrt(R * R - 117 * 117);
  const capAt105 = 105 / Math.sqrt(R * R - 105 * 105);
  const drop117 = R - Math.sqrt(R * R - 117 * 117);
  console.log(
    `  R=${String(R).padStart(4)} m: cap grade @105 m ${(capAt105 * 100).toFixed(2)}%, @117 m ${(capAt117 * 100).toFixed(2)}%; ` +
    `plausible worst-with-waves ~${((capAt117 + sineWorst) * 100).toFixed(1)}%; ground drops ${drop117.toFixed(2)} m over 117 m; horizon at ${(Math.sqrt(2 * R * 1.2)).toFixed(0)} m for 1.2 m eyes`,
  );
}
