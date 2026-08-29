/**
 * Is seed 11's ballPit / exit-ginormousSlide pair genuinely separated by the
 * railway, or is the invariant's `sideOf` sign heuristic misreading it?
 */
import './scripts/headless-canvas.mjs';
import { buildParkFacts } from './test/procgen/parkFacts.ts';
import { Vector3 } from 'three';

const facts = await buildParkFacts(11);
const route = facts.world.train.route;

const wanted = new Set(['ballPit', 'exit-ginormousSlide']);
const nodes = facts.pathNodes.filter((n) => wanted.has(n.id));
console.log('nodes:', nodes.map((n) => `${n.id} (${n.x.toFixed(2)}, ${n.z.toFixed(2)}) kind=${n.kind}`).join('\n       '));
if (nodes.length !== 2) { console.log('did not find both'); process.exit(0); }
const [a, b] = nodes as [typeof nodes[0], typeof nodes[0]];

const p = new Vector3();
const t = new Vector3();
const sideOf = (x: number, z: number): { side: number; d: number; at: string } => {
  const dist = route.distanceNear(x, z);
  route.tangentAt(dist, t);
  route.pointAt(dist, p);
  const s = Math.sign(t.z * (x - p.x) - t.x * (z - p.z)) >= 0 ? 1 : -1;
  return { side: s, d: dist, at: `(${p.x.toFixed(2)}, ${p.z.toFixed(2)})` };
};
const sa = sideOf(a.x, a.z);
const sb = sideOf(b.x, b.z);
console.log(`\nsideOf A: side=${sa.side} nearest rail d=${sa.d.toFixed(1)} at ${sa.at}`);
console.log(`sideOf B: side=${sb.side} nearest rail d=${sb.d.toFixed(1)} at ${sb.at}`);
console.log(`heuristic says ${sa.side !== sb.side ? 'SEPARATED (exempt)' : 'SAME SIDE (not exempt)'}`);

// The honest question: does the straight line between them actually cross the
// rail centreline?
let crossings = 0;
const STEP = 0.25;
const straight = Math.hypot(a.x - b.x, a.z - b.z);
let prevSide = 0;
for (let s = 0; s <= straight; s += STEP) {
  const f = s / straight;
  const x = a.x + (b.x - a.x) * f;
  const z = a.z + (b.z - a.z) * f;
  const dist = route.distanceNear(x, z);
  route.tangentAt(dist, t);
  route.pointAt(dist, p);
  const near = Math.hypot(x - p.x, z - p.z);
  const side = Math.sign(t.z * (x - p.x) - t.x * (z - p.z)) >= 0 ? 1 : -1;
  if (prevSide !== 0 && side !== prevSide && near < 6) crossings += 1;
  prevSide = side;
}
console.log(`\nstraight-line distance ${straight.toFixed(2)} m`);
console.log(`the straight line between them changes rail side ${crossings} time(s) within 6 m of the loop`);
console.log(crossings > 0 ? '-> the RAILWAY IS BETWEEN THEM; the detour is by design' : '-> genuinely same side; this is a real routing gap');

console.log(`\ncrossings=${facts.world.train.crossings.length} bridges=${facts.world.train.bridges.length} fallbacks=${facts.world.train.fallbackCrossings.length}`);
