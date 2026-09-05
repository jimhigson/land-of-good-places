/**
 * Before/after proof instrument for the road-placer step.
 *
 * Builds the real headless park for ONE seed (LGP_SEED) in this process — once,
 * never twice, because `paths.ts` mutates module-level paving — and prints a
 * digest of every mesh in the scene: name, world-space vertex positions, and
 * the whole thing rolled into one sha256 per named group plus one for the park.
 *
 * Run per seed in a child process. Compare the printed lines before and after a
 * change: any difference is a park that moved.
 */
import './headless-canvas.mjs';
import { createHash } from 'node:crypto';
import { Mesh, type BufferAttribute } from 'three';
import { buildHeadlessPark } from './park-harness.mts';

const park = buildHeadlessPark();

/** Every mesh in the scene, in traversal order, with its world matrix applied. */
const perMesh: { name: string; hash: string; verts: number }[] = [];
const whole = createHash('sha256');

park.scene.updateMatrixWorld(true);
park.scene.traverse((object) => {
  if (!(object instanceof Mesh)) return;
  const position = object.geometry.getAttribute('position') as BufferAttribute | undefined;
  const hash = createHash('sha256');
  const name = object.name || '(unnamed)';
  hash.update(name);
  hash.update(';');
  const m = object.matrixWorld.elements;
  for (const e of m) hash.update(`${e.toFixed(6)},`);
  if (position) {
    for (let i = 0; i < position.count; i += 1) {
      hash.update(
        `${position.getX(i).toFixed(6)},${position.getY(i).toFixed(6)},${position.getZ(i).toFixed(6)};`,
      );
    }
  }
  const digest = hash.digest('hex');
  perMesh.push({ name, hash: digest, verts: position?.count ?? 0 });
  whole.update(name);
  whole.update(digest);
});

// Sorted, named roll-up so a single moved prop is identifiable rather than only
// changing one opaque number.
const byName = new Map<string, ReturnType<typeof createHash>>();
for (const mesh of perMesh) {
  let h = byName.get(mesh.name);
  if (!h) {
    h = createHash('sha256');
    byName.set(mesh.name, h);
  }
  h.update(mesh.hash);
}

const seed = process.env['LGP_SEED'] ?? 'canonical';
console.log(`seed ${seed}: meshes=${perMesh.length} park=${whole.digest('hex').slice(0, 16)}`);
for (const [name, h] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${name} ${h.digest('hex').slice(0, 16)}`);
}
