/** TEMP diagnostic: how many ring gateways each seed gets, and which of them
 * were rescued by the elbow rung rather than found straight along their own
 * compass line.
 *
 * A straight compass tap's node stands on the compass axis through the plaza,
 * so its node shares the rim's x (for a north/south rim) or its z (for an
 * east/west one). Anything else was reached by the elbow.
 *
 * CONTROL: prints the tap count too. Four is the designed number (Decision 5);
 * a seed showing fewer than four still has a compass point with no gateway,
 * and the rescue did not manage it. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { debugStreetLattice, latticeComponentsWithoutAGateway } from '../src/world/paths.ts';

quietly(() => buildHeadlessPark());
const lattice = debugStreetLattice() as {
  taps: { x: number; z: number; rimX: number; rimZ: number }[];
};
const seed = process.env.LGP_SEED ?? 'canonical';
const rescued = lattice.taps.filter(
  (tap) => Math.abs(tap.x - tap.rimX) > 0.01 && Math.abs(tap.z - tap.rimZ) > 0.01,
);
const orphaned = latticeComponentsWithoutAGateway();
console.log(
  `${seed}\ttaps=${lattice.taps.length}/4\trescued=${rescued.length}` +
    `${rescued.length > 0 ? ' at ' + rescued.map((t) => `(${t.rimX.toFixed(1)},${t.rimZ.toFixed(1)})->(${t.x.toFixed(1)},${t.z.toFixed(1)})`).join(' ') : ''}` +
    `\torphanedComponents=[${orphaned.join(',')}]`,
);
