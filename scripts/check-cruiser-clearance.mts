import { buildHeadlessPark, quietly } from './park-harness.mts';
import { cruiserStrikes, thingsTheCruiserPasses } from '../src/world/coaster/clearance';

const park = quietly(() => buildHeadlessPark());
const route = park.world.coaster.route;
const ignore = [park.world.coaster.group];

const t0 = Date.now();
const passed = thingsTheCruiserPasses(route, park.world.coaster.group, ignore);
const strikes = cruiserStrikes(route, park.world.coaster.group, ignore);
console.log(`measured in ${Date.now() - t0} ms`);
console.log('--- tightest 12 things the loop passes ---');
for (const thing of passed.slice(0, 12)) {
  console.log(
    `  ${thing.clearance.toFixed(2)} m  at ${thing.along.toFixed(0)} m along  top y ${thing.topY.toFixed(2)}  ${thing.name}`,
  );
}
console.log(`--- strikes: ${strikes.length} ---`);
for (const s of strikes) console.log(`  ${s}`);
