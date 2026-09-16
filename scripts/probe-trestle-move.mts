/**
 * **What moved in the Rail Race when the entrance-road corridor started
 * working?** (#488)
 *
 * The corridor clause was very nearly inert until this branch, and then wrong in
 * a second way (see `track.ts`'s `TrestleTree`). Making it real moves trestle
 * posts on every seed — a change to the park that nothing else reports, because
 * `check:entrance-road` only asks whether the bus is clear, not what the ride
 * did to get there.
 *
 * So this prints, per seed, a count and a **hash of every post's foot position**
 * per ring. Run it on two commits and diff the output: identical hashes mean the
 * ride is byte-for-byte where it was, and a different one names the seed that
 * moved.
 *
 * ```
 * for s in ...; do LGP_SEED=$s node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/probe-trestle-move.mts; done
 * ```
 *
 * Every warning the build emitted is printed too: the trestle search warns
 * loudly when a *mandatory* slot (one with a duck bar scheduled on it) has to
 * reach past its safe radial range, and a corridor that binds harder is exactly
 * what would start provoking that.
 */
import './headless-canvas.mjs';
import { createHash } from 'node:crypto';
import { InstancedMesh, Matrix4, type Object3D, Vector3 } from 'three';

const { buildHeadlessPark } = await import('./park-harness.mts');
const { PARK_SEED } = await import('../src/world/parkManifest.ts');

const park = buildHeadlessPark();

const feet = new Map<string, string[]>();
const matrix = new Matrix4();
const centre = new Vector3();
const axis = new Vector3();
park.scene.traverse((object) => {
  const mesh = object as InstancedMesh;
  if (!mesh.isInstancedMesh || mesh.name !== 'railRace:trestle-legs') return;
  let ring = 'unknown';
  for (let node: Object3D | null = mesh; node; node = node.parent) {
    if (node.name.includes('walk-past')) { ring = 'walk-past'; break; }
    if (node.name.includes('race-ring')) { ring = 'race'; break; }
  }
  const list = feet.get(ring) ?? [];
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    centre.setFromMatrixPosition(matrix);
    axis.setFromMatrixColumn(matrix, 1);
    const length = axis.length() || 1;
    axis.divideScalar(length);
    // The foot, not the matrix's own origin: `strut` composes about the midpoint
    // of foot-to-top, and on a leaning post those are up to 2 m apart.
    list.push(
      `${(centre.x - axis.x * (length / 2)).toFixed(3)},` +
        `${(centre.z - axis.z * (length / 2)).toFixed(3)}`,
    );
  }
  feet.set(ring, list);
});

for (const ring of [...feet.keys()].sort()) {
  // Sorted, so the hash answers "are the posts in the same places" rather than
  // "were they written in the same order" — an instance index is an artefact of
  // the draw loop, not a fact about the park.
  const sorted = [...feet.get(ring)!].sort();
  const hash = createHash('sha256').update(sorted.join(';')).digest('hex').slice(0, 12);
  process.stdout.write(
    `seed ${String(PARK_SEED).padStart(8)}  ring ${ring.padEnd(9)}  posts ${String(sorted.length).padStart(4)}  ${hash}\n`,
  );
}

for (const said of park.said) {
  if (said.includes('trestle')) process.stdout.write(`  WARN seed ${PARK_SEED}: ${said}\n`);
}
