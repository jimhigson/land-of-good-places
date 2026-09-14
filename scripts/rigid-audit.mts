/**
 * **Which outdoor structures are too wide to stand rigidly on one up?**
 *
 * **This is the reusable result of the bend-exteriors work — more so than any
 * individual bend.** Every lane that follows has the same question to answer
 * about its own geometry, and the point of this script is that none of them has
 * to re-argue it: run it, read the verdict column, bend what is over the line
 * and leave what is not. The answers are frequently not what a brief assumes —
 * it is what established that the park's 165 wall runs are all *inside*
 * tolerance and needed nothing, after a day had been spent preparing to bend
 * them.
 *
 * Each `standOnSphere` call site takes ONE tilt for a whole object. That is
 * honest only while the object's own footprint stays inside the radius a flat
 * patch is good for — `flatRadiusFor(0.05)` = 4.69 m on this planet — and
 * `flatDeparture` says exactly what a wider one is costing.
 *
 * ## Two ways this instrument lied before it was fixed, both worth knowing
 *
 * Both are the same disease: **the instrument named the wrong object and
 * answered confidently.**
 *
 * - An earlier pass called `Box3.setFromObject` on every mesh and reported the
 *   treeline at **325 m** and the rail race at **318 m**. Those are
 *   `InstancedMesh`es whose box spans every instance in the park, so it was
 *   measuring the park's own radius and calling it a footprint. The unit that
 *   matters is **the thing that gets one tilt**, which is why this reads a
 *   named list rather than traversing everything.
 * - A sibling probe looking for long wall runs matched mesh names on a loose
 *   regex and found a 37.3 m run with the ground falling 12.44 m along it. That
 *   was a **bridge parapet** (`wallTop`/`coping`, `world/train/bridges.ts`), and
 *   a bridge not following the ground is what a bridge is *for*.
 *
 * So: measure the structure, not the scene graph node; and check what a name
 * actually belongs to before believing a number attached to it.
 *
 * Interiors are excluded by construction — they stay flat by Jim's ruling and
 * sit hundreds of metres out where the radial formula is meaningless.
 *
 * Run: `node --import ./scripts/ts-extension-resolver-register.mjs scripts/rigid-audit.mts`
 */
import './headless-canvas.mjs';
import { Box3, Vector3, type Object3D } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { flatDeparture, flatRadiusFor } from '../src/world/geo/Chart.ts';

const LIMIT = flatRadiusFor(0.05);
const park = buildHeadlessPark();
park.scene.updateMatrixWorld(true);

// Every structure in this engineer's lane that takes a single `standOnSphere`.
const WANTED = [
  'fountain', 'bus-shelter', 'welcome-sign', 'keychainShop', 'facePaintStall',
  'entrance-arch', 'gate-arch', 'building-facade', 'the-land-hotel-outside',
];

const found: { name: string; radius: number; height: number }[] = [];
const seen = new Set<string>();
park.scene.traverse((o: Object3D) => {
  const match = WANTED.find((w) => o.name === w || o.name.endsWith(`-${w}`) || /arch$/.test(o.name) && w === 'gate-arch');
  if (!match || seen.has(o.name)) return;
  seen.add(o.name);
  const at = o.getWorldPosition(new Vector3());
  const box = new Box3().setFromObject(o);
  if (box.isEmpty()) return;
  const radius = Math.max(
    Math.hypot(box.max.x - at.x, box.max.z - at.z),
    Math.hypot(box.min.x - at.x, box.min.z - at.z),
  );
  found.push({ name: o.name, radius, height: box.max.y - box.min.y });
});

found.sort((a, b) => b.radius - a.radius);
console.log(`a flat patch is honest to ${LIMIT.toFixed(2)} m of radius (5 cm tolerance)\n`);
for (const f of found) {
  const over = f.radius > LIMIT;
  console.log(
    `  ${f.radius.toFixed(2).padStart(6)} m radius   departs ${(flatDeparture(f.radius) * 100).toFixed(1).padStart(6)} cm   ` +
      `${f.name.padEnd(24)} ${over ? '<-- MUST BEND' : 'fine rigid'}`,
  );
}
console.log(`\n${found.filter((f) => f.radius > LIMIT).length} of ${found.length} structures exceed the limit`);
