import { PATH_GRAPH } from '../src/world/pathGraph.ts';
import { routeCurve } from '../src/world/paths.ts';
import { Vector3 } from 'three';
const pts = [...process.argv.slice(2).join(' ').matchAll(/\(([-\d.]+), ([-\d.]+)\)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
const samples: { name: string; x: number; z: number }[] = [];
for (const e of PATH_GRAPH.edges) {
  if (!e.paved) continue;
  const curve = routeCurve(e.route);
  const n = Math.max(8, Math.ceil(curve.getLength() / 1));
  const p = new Vector3();
  for (let i = 0; i <= n; i += 1) { curve.getPointAt(i / n, p); samples.push({ name: e.route.name, x: p.x, z: p.z }); }
}
const tally = new Map<string, number>();
for (const [x, z] of pts) {
  let best = 'FAR'; let bd = 6;
  for (const s of samples) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s.name; } }
  tally.set(best, (tally.get(best) ?? 0) + 1);
}
console.log([...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
