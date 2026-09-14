/**
 * Where does the ginormous slide actually run, and does it cross the
 * indoor/outdoor seam?
 *
 * The chute is drawn un-leaned while the ground it lands on is leaned. Before
 * any of that can be fixed, one fact decides the shape of the fix: does the
 * chute live in one space or two? `spaceAt` calls the castle roof an interior,
 * and interiors are real coordinates hundreds of metres from the park.
 */
import { Vector3 } from 'three';
import { SLIDE_PLAN } from '../src/world/slide/plan';
import { spaceAt, SPACE_GARDEN } from '../src/world/spaces';
import { terrainHeight } from '../src/world/terrain';

const route = SLIDE_PLAN?.points;
if (!route) {
  console.error('VOID: no giant slide on this seed, so nothing below is measured.');
  process.exit(1);
}

console.log(`chute points: ${route.length}`);
const spaces = new Map<string, number>();
let minR = Infinity;
let maxR = -Infinity;
for (const p of route) {
  const r = Math.hypot(p.x, p.z);
  minR = Math.min(minR, r);
  maxR = Math.max(maxR, r);
  const sp = String(spaceAt(p.x, p.z));
  spaces.set(sp, (spaces.get(sp) ?? 0) + 1);
}
console.log(`plan radius from the park origin: ${minR.toFixed(1)} m .. ${maxR.toFixed(1)} m`);
console.log('spaces the chute passes through:');
for (const [sp, n] of spaces) {
  console.log(`  ${sp === String(SPACE_GARDEN) ? 'GARDEN (outdoors)' : sp} : ${n} points`);
}

const first = route[0]!;
const last = route[route.length - 1]!;
for (const [name, p] of [['start', first], ['end', last]] as const) {
  const r = Math.hypot(p.x, p.z);
  console.log(
    `${name}: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})  r=${r.toFixed(1)} m  ` +
      `space=${String(spaceAt(p.x, p.z))}  ground=${terrainHeight(p.x, p.z).toFixed(1)}`,
  );
}
