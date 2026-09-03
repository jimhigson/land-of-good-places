/** TEMP diagnostic: the control polyline of a named route. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PATH_GRAPH } from '../src/world/pathGraph.ts';
quietly(() => buildHeadlessPark());
const want = process.argv.slice(2);
for (const edge of PATH_GRAPH.edges) {
  if (want.length && !want.includes(edge.route.name)) continue;
  console.log(
    `${edge.route.name} paved=${edge.paved} ${edge.from}->${edge.to}\n  ` +
      edge.route.points.map((p) => `(${p[0].toFixed(1)},${p[1].toFixed(1)})`).join(' '),
  );
}
