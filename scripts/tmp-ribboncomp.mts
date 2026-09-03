/** TEMP diagnostic: is the drawn paving one connected surface?
 *
 * Two paved ribbons are joined where their drawn centre lines come within the
 * sum of their half widths (their paving genuinely overlaps). Flood from the
 * backbone loop and report any ribbon that is not reached — a ribbon nobody
 * can walk to from the ring without leaving the paving.
 *
 * Control: prints the whole component census, so a seed with one component is
 * visibly distinguishable from a seed the instrument simply failed to link. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PATH_GRAPH, routeCurve } from '../src/world/pathGraph.ts';

quietly(() => buildHeadlessPark());

type Pt = readonly [number, number];
const paved = PATH_GRAPH.edges.filter((e) => e.paved);
const lines: Pt[][] = paved.map((e) => {
  const curve = routeCurve(e.route);
  const length = curve.getLength();
  const steps = Math.max(8, Math.ceil(length / 0.5));
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = curve.getPointAt(i / steps);
    pts.push([p.x, p.z]);
  }
  return pts;
});
const halfWidth = paved.map((e) => e.route.width / 2);

const n = paved.length;
const adj: number[][] = Array.from({ length: n }, () => []);
for (let i = 0; i < n; i += 1) {
  for (let j = i + 1; j < n; j += 1) {
    const reach = (halfWidth[i] as number) + (halfWidth[j] as number);
    let touch = false;
    outer: for (const a of lines[i]!) {
      for (const b of lines[j]!) {
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= reach) {
          touch = true;
          break outer;
        }
      }
    }
    if (touch) {
      adj[i]!.push(j);
      adj[j]!.push(i);
    }
  }
}

const comp = new Array<number>(n).fill(-1);
let c = 0;
for (let i = 0; i < n; i += 1) {
  if (comp[i] !== -1) continue;
  const stack = [i];
  comp[i] = c;
  while (stack.length) {
    const k = stack.pop() as number;
    for (const m of adj[k] as number[]) {
      if (comp[m] === -1) {
        comp[m] = c;
        stack.push(m);
      }
    }
  }
  c += 1;
}
const backbone = paved.findIndex((e) => e.route.closed);
const main = backbone >= 0 ? comp[backbone] : 0;
console.log(`${c} paving component(s); backbone is #${main}`);
for (let k = 0; k < c; k += 1) {
  const members = paved.filter((_e, i) => comp[i] === k).map((e) => e.route.name);
  console.log(`  component ${k}${k === main ? ' (main)' : ''}: ${members.join(', ')}`);
}
