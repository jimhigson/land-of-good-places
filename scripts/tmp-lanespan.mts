/** TEMP diagnostic: for every paved path edge, print the drawn length, the
 * straight-line distance between the two graph nodes it names, and the gap
 * between each drawn end and the node it should be standing on. A degenerate
 * lane is one whose ribbon is far shorter than the span it claims. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PATH_GRAPH, routeCurve } from '../src/world/pathGraph.ts';

quietly(() => buildHeadlessPark());

const nodeById = new Map(PATH_GRAPH.nodes.map((n) => [n.id, n]));

for (const edge of PATH_GRAPH.edges) {
  if (!edge.paved) continue;
  if (edge.route.closed) continue;
  const curve = routeCurve(edge.route);
  const steps = 200;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const p = curve.getPointAt(i / steps);
    pts.push([p.x, p.z]);
  }
  let drawn = 0;
  for (let i = 1; i < pts.length; i += 1) {
    drawn += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  }
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const a = nodeById.get(edge.from);
  const b = nodeById.get(edge.to);
  if (!a || !b) {
    console.log(
      `${edge.route.name}: drawn=${drawn.toFixed(1)} from=${edge.from} to=${edge.to} ends=${first[0].toFixed(1)},${first[1].toFixed(1)} -> ${last[0].toFixed(1)},${last[1].toFixed(1)} (missing node)`,
    );
    continue;
  }
  const span = Math.hypot(a.x - b.x, a.z - b.z);
  const gapA = Math.min(
    Math.hypot(first[0] - a.x, first[1] - a.z),
    Math.hypot(last[0] - a.x, last[1] - a.z),
  );
  const gapB = Math.min(
    Math.hypot(first[0] - b.x, first[1] - b.z),
    Math.hypot(last[0] - b.x, last[1] - b.z),
  );
  console.log(
    `${edge.route.name.padEnd(32)} drawn=${drawn.toFixed(1).padStart(6)} span=${span
      .toFixed(1)
      .padStart(6)} gapFrom(${edge.from})=${gapA.toFixed(2).padStart(6)} gapTo(${edge.to})=${gapB
      .toFixed(2)
      .padStart(6)}`,
  );
}
