/** TEMP diagnostic: does every paved ribbon END on something?
 *
 * For each paved (non-backbone) edge, take its two drawn endpoints and measure
 * the distance to the nearest point on ANY OTHER paved edge's drawn centre
 * line, and separately to the nearest entrance/doormat-ish anchor point. An end
 * that is far from both is a lane terminating in open ground.
 *
 * Control: the same column printed for every edge, so the reachable majority
 * can be read beside the suspects. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PATH_GRAPH, routeCurve } from '../src/world/pathGraph.ts';

quietly(() => buildHeadlessPark());

type Pt = readonly [number, number];

const sample = (route: (typeof PATH_GRAPH.edges)[number]['route']): Pt[] => {
  const curve = routeCurve(route);
  const length = curve.getLength();
  const steps = Math.max(8, Math.ceil(length / 0.5));
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = curve.getPointAt(i / steps);
    pts.push([p.x, p.z]);
  }
  return pts;
};

const paved = PATH_GRAPH.edges.filter((e) => e.paved);
const lines = paved.map((e) => sample(e.route));

const nearestOther = (p: Pt, skip: number): { d: number; who: string } => {
  let best = Infinity;
  let who = '';
  for (let i = 0; i < paved.length; i += 1) {
    if (i === skip) continue;
    for (const q of lines[i]!) {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < best) {
        best = d;
        who = paved[i]!.route.name;
      }
    }
  }
  return { d: best, who };
};

const rows: { name: string; end: string; d: number; who: string; p: Pt }[] = [];
for (let i = 0; i < paved.length; i += 1) {
  const e = paved[i]!;
  if (e.route.closed) continue;
  const pts = lines[i]!;
  const len = pts.reduce(
    (a, _p, j) => (j === 0 ? 0 : a + Math.hypot(pts[j]![0] - pts[j - 1]![0], pts[j]![1] - pts[j - 1]![1])),
    0,
  );
  for (const [label, p] of [
    ['start', pts[0]!],
    ['end', pts[pts.length - 1]!],
  ] as const) {
    const n = nearestOther(p, i);
    rows.push({ name: `${e.route.name} (len ${len.toFixed(1)})`, end: label, d: n.d, who: n.who, p });
  }
}
rows.sort((a, b) => b.d - a.d);
for (const r of rows) {
  console.log(
    `${r.d.toFixed(2).padStart(7)}m  ${r.name.padEnd(44)} ${r.end.padEnd(5)} at ${r.p[0].toFixed(1)},${r.p[1].toFixed(1)}  nearest=${r.who}`,
  );
}
