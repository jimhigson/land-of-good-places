/** TEMP diagnostic: what does the two-pass reservation release actually do?
 * Prints, per pass, which sites the finished network is judged to cross at and
 * which reservations therefore get released.
 *
 * CONTROL: a site the network demonstrably crosses at must appear as used on
 * every pass. If every site reads as used on a seed known to have empty
 * reservations, the usage test is over-permissive and nothing below it can be
 * believed. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';

const park = quietly(() => buildHeadlessPark());
const world = park.world;

console.log(`seed ${process.env.LGP_SEED ?? 'canonical'}`);
console.log(`proven sites: ${CROSSING_SITES.length}`);
for (const site of CROSSING_SITES) {
  console.log(
    `  railD=${site.railDistance.toFixed(0)} at (${site.x.toFixed(1)},${site.z.toFixed(1)}) halfWidth=${site.halfWidth}`,
  );
}
console.log(`built crossings: ${world.train.crossings.length}`);
for (const crossing of world.train.crossings) {
  console.log(`  railD=${crossing.railDistance.toFixed(0)} at (${crossing.x.toFixed(1)},${crossing.z.toFixed(1)})`);
}
console.log(`built bridges: ${world.train.bridges.length}`);
