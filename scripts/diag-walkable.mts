/**
 * Diagnostic: which track centre-line points can a child stand on, and what
 * is near them — a bridge abutment, a station, open line?
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';

const { buildHeadlessPark } = await import('./park-harness.mts');
const seed = process.env['LGP_SEED'] ?? 'default(canonical)';
const park = buildHeadlessPark();
const { computeCrossings } = await import('../src/world/train/crossings.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');

const route = TRAIN_PLAN.route;
const crossings = computeCrossings(route);
const bridges = park.world.train.bridges;
const SAMPLES = 763;
const step = route.length / SAMPLES;
const p = new Vector3();
console.log(`seed ${seed}: loop ${route.length.toFixed(1)} m, ${crossings.length} crossings, ${park.world.train.stations.length} stations`);
for (let i = 0; i < SAMPLES; i += 1) {
  const d = i * step;
  route.pointAt(d, p);
  const onBridge = bridges.some((b) => b.covers(p.x, p.z));
  if (onBridge) continue;
  const ground = park.sample(p.x, p.z, 0);
  // Nearest crossing, along the loop.
  let nearest = Infinity;
  for (const c of crossings) {
    const along = Math.abs(route.wrap(d - c.railDistance + route.length / 2) - route.length / 2);
    if (along < nearest) nearest = along;
  }
  let nearestStation = Infinity;
  for (const s of park.world.train.stations) {
    const along = Math.abs(route.wrap(d - s.distance + route.length / 2) - route.length / 2);
    if (along < nearestStation) nearestStation = along;
  }
  // Report only points whose ground is meaningfully above the sleeper line —
  // the check's own `isStandable` is not exported, so this prints the raw
  // geometry for every point near a crossing instead, and the caller reads it.
  if (nearest <= 12) {
    console.log(
      `  railD ${d.toFixed(1)} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) ground ${ground.toFixed(2)} ` +
        `— ${nearest.toFixed(1)} m from a crossing, ${nearestStation.toFixed(1)} m from a station`,
    );
  }
}
