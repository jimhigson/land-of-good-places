import '../headless-canvas.mjs';
import { buildHeadlessPark } from '../park-harness.mts';
const { world } = buildHeadlessPark();
const { RaceCamera, FULL_PULL_BACK_SPEED } = await import('../../src/world/railRace/camera.ts');
const route = world.railRace.raceRoute;
const cam = new RaceCamera(route);
cam.resize(1600, 900);
const ceil = (cam as unknown as { zoomCeiling: number[] }).zoomCeiling;
let min = Infinity, at = 0, below1 = 0;
ceil.forEach((v, i) => { if (v < min) { min = v; at = i; } if (v < 1) below1++; });
console.log(`ceiling min ${min.toFixed(3)} at station ${at} (${(at / ceil.length * route.path.length).toFixed(1)} m of path), stations below 1: ${below1}/${ceil.length}`);
for (const speed of [0, FULL_PULL_BACK_SPEED]) {
  let worst = Infinity, wAt = 0, back = 0; const pts: [number, number][] = [];
  const n = Math.floor(route.length / 0.25);
  for (let i = 0; i < n; i++) { cam.reset(i * 0.25, speed); pts.push([cam.camera.position.x, cam.camera.position.z]); }
  for (let i = 0; i < n; i++) { const h = route.path.sampleAt(route.startDistance + i * 0.25); const a = pts[i]!, b = pts[(i + 1) % n]!;
    const f = ((b[0] - a[0]) * h.tangentX + (b[1] - a[1]) * h.tangentZ) / 0.25; if (f < 0) back++; if (f < worst) { worst = f; wAt = i * 0.25; } }
  console.log(`speed ${speed}: least forward ${worst.toFixed(3)} at ${wAt.toFixed(1)} m, backwards ${back}/${n}`);
}
