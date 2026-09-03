/** TEMP diagnostic: for a door, every grid connector the search offered, with
 * the two elbow shapes reconstructed at each node.
 *
 * The question: when BOTH elbows are rogue (`leadDx` and `leadDz` both past
 * `STUB_TAIL_LIMIT`) they have IDENTICAL Manhattan length, so identical cost,
 * and the push order alone decides which is drawn. `elbowViaColumn` is pushed
 * first unconditionally. Its private leg is `leadDx`; `elbowViaRow`'s is
 * `leadDz`. So whenever `leadDz < leadDx` the search draws the longer private
 * run for no reason a cost can see.
 *
 * CONTROL: `winner` is reconstructed from push order alone and must match the
 * shape `debugNodeEdges` reports as actually drawn (`viaMatches`). If it does
 * not, the reconstruction is wrong and every other column here is worthless.
 */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugNodeEdges } from '../src/world/paths.ts';

quietly(() => buildHeadlessPark());

const STUB_TAIL_LIMIT = 7.8;
const doorX = Number(process.argv[2]);
const doorZ = Number(process.argv[3]);

const r = debugNodeEdges(doorX, doorZ) as {
  at: string;
  distanceFromAsked: string;
  edges: { to: string; cost: string; via: string }[];
};
console.log(`door node ${r.at} (asked ${doorX},${doorZ}, off by ${r.distanceFromAsked})`);

for (const e of r.edges) {
  const vias = [...e.via.matchAll(/\(([-\d.]+),([-\d.]+)\)/g)].map(
    (m) => [Number(m[1]), Number(m[2])] as const,
  );
  const lead = vias[0];
  const [nx, nz] = e.to.split(',').map(Number) as [number, number];
  if (!lead) {
    console.log(`  -> ${e.to.padEnd(16)} cost ${e.cost.padStart(6)}  no lead in via — not a head-on shape`);
    continue;
  }
  const leadDx = Math.abs(nx - lead[0]);
  const leadDz = Math.abs(nz - lead[1]);
  const colRogue = leadDx > STUB_TAIL_LIMIT;
  const rowRogue = leadDz > STUB_TAIL_LIMIT;
  // push order: disciplined (col before row), then straight, then rogue (col before row)
  const bucket = (c: boolean) => (c ? 'rogue' : 'discip');
  // `elbowViaColumn`'s corner is (nx, lead[1]); `elbowViaRow`'s is (lead[0], nz).
  const drawnCorner = vias[1];
  const winner = !drawnCorner
    ? 'straightToLead'
    : Math.abs(drawnCorner[0] - nx) < 1e-6
      ? 'elbowViaColumn'
      : 'elbowViaRow';
  // Models the SHIPPED order: bucket first (disciplined before rogue), then
  // within a bucket the shorter private leg. Keep this in step with
  // `computeGridConnectors` or the control below stops discriminating.
  const predicted =
    colRogue !== rowRogue
      ? colRogue
        ? 'elbowViaRow'
        : 'elbowViaColumn'
      : leadDz < leadDx
        ? 'elbowViaRow'
        : 'elbowViaColumn';
  const viaMatches = winner === 'straightToLead' ? 'n/a' : winner === predicted ? 'Y' : 'N';
  console.log(
    `  -> ${e.to.padEnd(16)} cost ${e.cost.padStart(6)}  lead(${lead[0].toFixed(3)},${lead[1].toFixed(3)})\n` +
      `       leadDx=${leadDx.toFixed(2)} (${bucket(colRogue)}, viaColumn's private leg)  ` +
      `leadDz=${leadDz.toFixed(2)} (${bucket(rowRogue)}, viaRow's private leg)\n` +
      `       drawn=${winner}  predictedByPushOrder=${predicted}  control:viaMatches=${viaMatches}` +
      (winner === 'elbowViaColumn' && leadDz < leadDx
        ? `\n       *** SWAPPABLE: same length, private run ${leadDx.toFixed(2)} -> ${leadDz.toFixed(2)} m ***`
        : ''),
  );
}
