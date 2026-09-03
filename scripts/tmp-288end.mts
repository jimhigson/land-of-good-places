/**
 * TEMP diagnostic: the geometry `noPathEndsNowhere` sees at seed 288's
 * `bridge-walk-0` far end — rail side, how much other paving stands on that
 * side, and how close the end is to a proven crossing site.
 *
 * CONTROL: the same three numbers for the *near* end of the same walk, which is
 * a joined end on the populated side. An instrument that cannot tell those two
 * apart is measuring nothing.
 */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { PATH_GRAPH } from '../src/world/pathGraph.ts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { Vector3 } from 'three';

const park = quietly(() => buildHeadlessPark());
const route = park.world.train.route;
const at = new Vector3();
const tangent = new Vector3();
const railSide = (x: number, z: number): number => {
  const d = route.distanceNear(x, z);
  route.pointAt(d, at);
  route.tangentAt(d, tangent);
  return Math.sign(tangent.z * (x - at.x) - tangent.x * (z - at.z)) || 1;
};

for (const s of [1, -1]) {
  const on = PATH_GRAPH.nodes.filter((n) => railSide(n.x, n.z) === s);
  console.log(
    `side=${s}: ${on.length} path nodes — ${on.map((n) => n.id).join(', ') || '(none)'}`,
  );
}

const want = process.argv[2] ?? 'bridge-walk-0';
const edge = PATH_GRAPH.edges.find((e) => e.route.name === want);
if (!edge) {
  console.log(`no edge named ${want}; have: ${PATH_GRAPH.edges.map((e) => e.route.name).join(', ')}`);
} else {
  const pts = edge.route.points;
  for (const [which, p] of [
    ['start', pts[0] as readonly [number, number]],
    ['end', pts[pts.length - 1] as readonly [number, number]],
  ] as const) {
    const side = railSide(p[0], p[1]);
    let nearestSameSide = Infinity;
    let sameSideSamples = 0;
    let nearestAny = Infinity;
    for (const other of PATH_GRAPH.edges) {
      if (other.route.name === want) continue;
      for (const q of other.route.points) {
        const gap = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (gap < nearestAny) nearestAny = gap;
        if (railSide(q[0], q[1]) === side) {
          sameSideSamples += 1;
          if (gap < nearestSameSide) nearestSameSide = gap;
        }
      }
    }
    const sites = CROSSING_SITES.map((site) => {
      const dx = p[0] - site.x;
      const dz = p[1] - site.z;
      const along = dx * site.dirX + dz * site.dirZ;
      const across = -dx * site.dirZ + dz * site.dirX;
      return `d=${site.railDistance.toFixed(1)}[along=${along.toFixed(2)} across=${across.toFixed(2)} reach=${site.rampReachPos.toFixed(1)}/${site.rampReachNeg.toFixed(1)} halfW=${site.halfWidth.toFixed(1)}]`;
    }).join(' ');
    const nearestSite = Math.min(
      ...CROSSING_SITES.map((s) => Math.hypot(s.x - p[0], s.z - p[1])),
    );
    console.log(`  sites: ${sites}`);
    console.log(
      `${want} ${which} (${p[0].toFixed(2)},${p[1].toFixed(2)}) side=${side} ` +
        `otherPavingSamplesOnThisSide=${sameSideSamples} ` +
        `nearestOtherPavingSameSide=${nearestSameSide.toFixed(2)} ` +
        `nearestOtherPavingAnySide=${nearestAny.toFixed(2)} ` +
        `nearestProvenSiteCentre=${nearestSite.toFixed(2)}`,
    );
  }
  console.log(
    `proven sites: ${CROSSING_SITES.map((s) => `d=${s.railDistance.toFixed(1)} at (${s.x.toFixed(1)},${s.z.toFixed(1)}) rampReach=${s.rampReachPos.toFixed(1)}/${s.rampReachNeg.toFixed(1)}`).join(' | ')}`,
  );
}
