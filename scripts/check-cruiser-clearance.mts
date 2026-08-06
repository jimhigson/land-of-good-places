/**
 * **Does the Sky Cruiser fly through anything?**
 *
 * Wired into `build` as `check:cruiser-clearance`. It was deliberately *not*
 * wired in when it was written, because it could not pass: it had just found
 * issue #198, the ride flying through a tree canopy and a bush beside its own
 * station, on every seed. Turning that red would have been reporting an
 * inherited bug as this branch's failure. It goes in now that #198 is fixed —
 * the same sequencing #192 used for `typecheck:test`.
 *
 * The measurement it replaces asked a hard-coded list of two plot ids whether
 * the loop cleared them. This asks the park.
 */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { cruiserStrikes, thingsTheCruiserPasses } from '../src/world/coaster/clearance';

const park = quietly(() => buildHeadlessPark());
const route = park.world.coaster.route;
const ignore = [park.world.coaster.group];

const t0 = Date.now();
const passed = thingsTheCruiserPasses(route, park.world.coaster.group, ignore);
const strikes = cruiserStrikes(route, park.world.coaster.group, ignore);
console.log(`measured in ${Date.now() - t0} ms`);

// Printed whether or not anything failed. A pass/fail alone would never tell
// anyone the ride skims a statue by two metres, and the point of this list is
// that the *next* tall thing is noticed while it is still a near miss.
console.log('--- tightest 12 things the loop passes ---');
for (const thing of passed.slice(0, 12)) {
  console.log(
    `  ${thing.clearance.toFixed(2)} m  at ${thing.along.toFixed(0)} m along  ` +
      `top y ${thing.topY.toFixed(2)}  ${thing.name}`,
  );
}

if (strikes.length > 0) {
  console.error(`\n${strikes.length} thing(s) in the Sky Cruiser's way:`);
  for (const strike of strikes) console.error(`  ${strike}`);
  console.error(
    '\nThe car\'s own envelope intersects real geometry. If what it struck is ' +
      'scenery, `clearOfCruiser` in src/world/Scenery.ts is what keeps the ' +
      'scatter out of the ride\'s way — see #198.',
  );
  process.exit(1);
}

console.log('\nthe Sky Cruiser flies clear of everything in the park');
