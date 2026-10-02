/**
 * **Is this the same park on another machine?** One seed (`LGP_SEED`, at its
 * recorded restart), built headlessly, reduced to what two platforms can be
 * compared on without shipping 49 MB of vertices between CI jobs:
 *
 * - the **decision structure**: the layout, plan-phase and world-phase solve
 *   traces (every placement, refusal, retry and unwind, in order), hashed;
 *   and every mesh's name, vertex count and instance count;
 * - the **positions**, at full precision: each mesh's centroid of world-space
 *   vertices (instances included, through their matrices).
 *
 * `scripts/compare-park-identity.mts` diffs two of these files (one per
 * platform): any difference in structure is a different park — a decision
 * that flipped on ulp drift — and the centroids say how far the identical
 * structure drifted. Written as JSON to the path given as the first argument.
 *
 * Why it exists: parks are accepted on one machine (`scripts/lib/acceptedPark.mts`)
 * and their decisions shipped from another (`build:parks` in CI). With V8's
 * own Math the two platforms disagreed, and on five seeds the disagreement
 * flipped decisions. `src/core/deterministicMath.ts` is the fix. This is the
 * measurement that says it still holds: the expected answer is 0 m drift on
 * every seed, not a small one.
 */
import './headless-canvas.mjs';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { InstancedMesh, Matrix4, Mesh, Vector3, type BufferAttribute } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { LAYOUT_TRACE } from '../src/world/parkLayout.ts';
import { parkSolveTrace } from '../src/world/parkPlan.ts';
import { worldSolveTrace } from '../src/world/worldPhase.ts';
import { PARK_RESTART, PARK_SEED_ASKED } from '../src/world/parkManifest.ts';

const park = buildHeadlessPark();
park.scene.updateMatrixWorld(true);

const hash = (lines: readonly string[]): string => createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);

interface MeshIdentity {
  readonly name: string;
  readonly vertices: number;
  readonly instances: number;
  readonly centroid: readonly [number, number, number];
}
const meshes: MeshIdentity[] = [];
const p = new Vector3();
const m = new Matrix4();
const world = new Matrix4();
park.scene.traverse((object) => {
  if (!(object instanceof Mesh)) return;
  let path = object.name || '(unnamed)';
  for (let at = object.parent; at; at = at.parent) if (at.name) path = `${at.name}/${path}`;
  const position = object.geometry.getAttribute('position') as BufferAttribute | undefined;
  const count = position?.count ?? 0;
  const instances = object instanceof InstancedMesh ? object.count : 1;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let n = 0;
  for (let k = 0; k < instances; k += 1) {
    if (object instanceof InstancedMesh) {
      object.getMatrixAt(k, m);
      world.multiplyMatrices(object.matrixWorld, m);
    } else {
      world.copy(object.matrixWorld);
    }
    for (let i = 0; i < count; i += 1) {
      p.fromBufferAttribute(position as BufferAttribute, i).applyMatrix4(world);
      sx += p.x;
      sy += p.y;
      sz += p.z;
      n += 1;
    }
  }
  meshes.push({ name: path, vertices: count, instances, centroid: n > 0 ? [sx / n, sy / n, sz / n] : [0, 0, 0] });
});
// Traversal order is the scene's own, which is deterministic; sort anyway so a
// re-parenting reads as a name change, not as every mesh moving.
meshes.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.vertices - b.vertices));

const identity = {
  seed: PARK_SEED_ASKED,
  restart: PARK_RESTART,
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  traces: {
    layout: hash(LAYOUT_TRACE),
    plan: hash(parkSolveTrace()),
    world: hash(worldSolveTrace()),
  },
  // The full text, so a comparison can name the first decision that differs.
  traceText: { layout: [...LAYOUT_TRACE], plan: [...parkSolveTrace()], world: [...worldSolveTrace()] },
  structure: hash(meshes.map((x) => `${x.name}|${x.vertices}|${x.instances}`)),
  meshes,
};
// To a file, not stdout: the identity is ~65 KB and `process.exit` does not
// wait for a pipe to drain, so a piped stdout was cut off at 64 KiB (measured).
const out = process.argv[2];
if (!out) throw new Error('usage: park-identity.mts <out.json>');
writeFileSync(out, `${JSON.stringify(identity)}\n`);
process.stderr.write(`park-identity: seed ${identity.seed} restart ${identity.restart} structure ${identity.structure} -> ${out}\n`);
process.exit(0);
