import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { CROSSING_SITES, LEVEL_CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { ROUTES } from '../src/world/pathGraph.ts';
import { DECK_HALF_LENGTH } from '../src/world/train/clearance.ts';
import { PoiGraph, SEEDS } from '../src/entities/npc/poiGraph.ts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';
import { quietly } from './park-harness.mts';

const park = buildHeadlessPark();
console.log(`seed ${PARK_SEED}  deckHalf=${DECK_HALF_LENGTH}`);
for (const s of [...CROSSING_SITES, ...LEVEL_CROSSING_SITES]) {
  const tag = CROSSING_SITES.includes(s) ? (s.bridge ? 'PROVEN' : 'crossing') : 'level';
  const fp = (sign: 1|-1, reach: number) => [s.x + s.dirX*sign*(DECK_HALF_LENGTH+reach), s.z + s.dirZ*sign*(DECK_HALF_LENGTH+reach)];
  const p = fp(1, (s as any).rampReachPos ?? 4), m = fp(-1, (s as any).rampReachNeg ?? 4);
  console.log(`  ${tag.padEnd(8)} railD ${s.railDistance.toFixed(0).padStart(4)} centre (${s.x.toFixed(1)},${s.z.toFixed(1)}) toes (${p[0]!.toFixed(1)},${p[1]!.toFixed(1)}) / (${m[0]!.toFixed(1)},${m[1]!.toFixed(1)})`);
}
console.log(`built bridges: ${park.world.train.bridges.length}`);
const graph = quietly(() => new PoiGraph(park.world.collision, (x, z) => bridgeHeightAt(park.world.train.bridges, x, z)));
const stranded = graph.nodes.filter((n) => !n.reachable);
console.log(`poi: ${graph.nodes.length}/${SEEDS.length} placed, ${stranded.length} stranded`);
for (const n of stranded) console.log(`    stranded ${n.id ?? ''} (${n.x.toFixed(1)}, ${n.z.toFixed(1)})`);
console.log(`routes: ${ROUTES.length}`);
