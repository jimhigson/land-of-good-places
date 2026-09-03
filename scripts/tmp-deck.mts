/** TEMP diagnostic: the bridge nearest a point, in its own frame — where its
 * deck is, where `bridgeHeightAt` covers, and what the drawn gate-approach
 * does relative to it. */
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { CROSSING_SITES } from '../src/world/train/crossingPlan.ts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';
import { ROUTES } from '../src/world/pathGraph.ts';

const park = quietly(() => buildHeadlessPark());
const world = park.world;
const px = Number(process.argv[2] ?? 0);
const pz = Number(process.argv[3] ?? 30);

for (const site of CROSSING_SITES) {
  const d = Math.hypot(site.x - px, site.z - pz);
  if (d > 30) continue;
  console.log(
    `site railDistance=${site.railDistance.toFixed(1)} at (${site.x.toFixed(2)},${site.z.toFixed(2)}) ` +
      `dir=(${site.dirX.toFixed(3)},${site.dirZ.toFixed(3)}) halfWidth=${(site as { halfWidth?: number }).halfWidth ?? '?'} ` +
      `reachPlus=${(site as { reachPlus?: number }).reachPlus ?? '?'} reachMinus=${(site as { reachMinus?: number }).reachMinus ?? '?'} ` +
      `distance to probe ${d.toFixed(2)}`,
  );
  console.log('  keys:', Object.keys(site).join(','));
  // Walk the site's own axis and print where bridgeHeightAt is defined.
  for (let a = -30; a <= 30; a += 1) {
    const x = site.x + site.dirX * a;
    const z = site.z + site.dirZ * a;
    const h = bridgeHeightAt(world.train.bridges, x, z);
    console.log(
      `   along=${String(a).padStart(4)} (${x.toFixed(2)},${z.toFixed(2)}) h=${h === null ? 'null' : h.toFixed(2)}`,
    );
  }
}

const route = ROUTES.find((r) => r.name === 'gate-approach');
console.log('\ngate-approach control polyline:');
console.log(route ? route.points.map((p) => `(${p[0].toFixed(2)},${p[1].toFixed(2)})`).join(' ') : 'MISSING');
console.log('width', route?.width);

// Every route whose polyline passes within 12 m of the probe, for context.
console.log('\nroutes near the probe:');
for (const r of ROUTES) {
  const near = r.points.some((p) => Math.hypot(p[0] - px, p[1] - pz) < 12);
  if (near) console.log(`  ${r.name} w=${r.width}: ${r.points.map((p) => `(${p[0].toFixed(1)},${p[1].toFixed(1)})`).join(' ')}`);
}
