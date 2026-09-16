/**
 * **Does the cat bus drive through trees on its approach, and whose job is it
 * to move?**
 *
 * Jim, 3 September 2026: the bus drives through trees on its final approach.
 *
 * Measures the built park: every treeline trunk and canopy against the corridor
 * the bus actually sweeps (`distanceToEntranceCorridor`), per seed. Prints the
 * count, the worst intrusion, and where the offenders stand in outset — which
 * is what says whether this is the treeline's band overlapping the road's tails
 * or something else entirely.
 *
 * ```
 * LGP_SEED=<n> node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/probe-road-trees.mts
 * ```
 */
import './headless-canvas.mjs';
import { InstancedMesh, Matrix4, Vector3 } from 'three';

const { buildHeadlessPark } = await import('./park-harness.mts');
const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { distanceToEntranceCorridor, entranceRoadOutsetAt } = await import(
  '../src/world/entrance/roadRoute.ts'
);

const park = buildHeadlessPark();

const matrix = new Matrix4();
const at = new Vector3();
const scale = new Vector3();
const quaternion = new (await import('three')).Quaternion();

interface Hit {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly reach: number;
  readonly inside: number;
  readonly outset: number;
}
const hits: Hit[] = [];
let counted = 0;

park.scene.traverse((object) => {
  const mesh = object as InstancedMesh;
  if (!(mesh as { isInstancedMesh?: boolean }).isInstancedMesh) return;
  if (!mesh.name.startsWith('treeline')) return;
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, matrix);
    matrix.decompose(at, quaternion, scale);
    at.applyMatrix4(mesh.matrixWorld);
    counted += 1;
    // A canopy's reach is its horizontal scale; a trunk's is its own radius.
    const reach = Math.max(scale.x, scale.z);
    const outside = distanceToEntranceCorridor(at.x, at.z);
    if (outside < reach) {
      hits.push({
        name: mesh.name,
        x: at.x,
        z: at.z,
        reach,
        inside: reach - outside,
        outset: entranceRoadOutsetAt(at.x, at.z),
      });
    }
  }
});

hits.sort((a, b) => b.inside - a.inside);
console.log(
  `seed ${PARK_SEED}: ${counted} treeline instances, ${hits.length} reaching into the bus's corridor`,
);
for (const hit of hits.slice(0, 10)) {
  console.log(
    `   ${hit.name.padEnd(20)} at ${hit.x.toFixed(1).padStart(7)}, ${hit.z.toFixed(1).padStart(7)}` +
      `  reach ${hit.reach.toFixed(2)}  ${hit.inside.toFixed(2)} m inside  outset ${hit.outset.toFixed(1)}`,
  );
}
