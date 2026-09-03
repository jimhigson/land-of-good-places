/** TEMP diagnostic: every axis-aligned drawn run >= 8 m, with how far its line
 * sits off the 12 m lattice and off the 6 m half-lattice through the plaza.
 * Control: the full-pitch column must read ~0 for the ring's compass streets. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PATH_GRAPH, routeCurve } from '../src/world/pathGraph.ts';

quietly(() => buildHeadlessPark());
const plaza = PATH_GRAPH.nodes.find((n) => n.kind === 'plaza');
if (!plaza) throw new Error('no plaza node');
const off = (v: number, anchor: number, pitch: number): number => {
  const r = (((v - anchor) % pitch) + pitch) % pitch;
  return Math.min(r, pitch - r);
};
for (const edge of PATH_GRAPH.edges) {
  if (!edge.paved || edge.route.closed) continue;
  const curve = routeCurve(edge.route);
  const len = curve.getLength();
  const steps = Math.max(8, Math.ceil(len / 0.5));
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = curve.getPointAt(i / steps);
    pts.push([p.x, p.z]);
  }
  let axis: 'x' | 'z' | null = null;
  let start = 0;
  const flush = (end: number): void => {
    if (axis === null || end <= start) return;
    const a = pts[start]!;
    const b = pts[end]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const runAxis = axis;
    axis = null;
    if (length < 8) return;
    let sum = 0;
    for (let i = start; i <= end; i += 1) sum += pts[i]![runAxis === 'z' ? 0 : 1];
    const line = sum / (end - start + 1);
    const anchor = runAxis === 'z' ? plaza.x : plaza.z;
    console.log(
      `${edge.route.name.padEnd(30)} ${runAxis === 'z' ? 'NS' : 'EW'} len=${length.toFixed(1).padStart(6)} line=${line.toFixed(2).padStart(8)} off12=${off(line, anchor, 12).toFixed(2).padStart(5)} off6=${off(line, anchor, 6).toFixed(2).padStart(5)}`,
    );
  };
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = Math.abs(b[0] - a[0]);
    const dz = Math.abs(b[1] - a[1]);
    const hop = Math.hypot(dx, dz);
    const next: 'x' | 'z' | null = hop < 1e-6 ? axis : dx > dz ? 'x' : 'z';
    const straight = hop > 1e-6 && Math.min(dx, dz) / hop < 0.15;
    if (!straight) {
      flush(i - 1);
      continue;
    }
    if (next !== axis) {
      flush(i - 1);
      axis = next;
      start = i - 1;
    }
  }
  flush(pts.length - 1);
}
