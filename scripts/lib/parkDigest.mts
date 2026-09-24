/**
 * **A whole park's geometry as one hash** — every mesh in the scene, in
 * traversal order: its name, its world matrix, every vertex position, and for
 * an `InstancedMesh` every drawn instance's matrix and colour. Two parks with
 * the same digest put the same triangles in the same places.
 *
 * One owner for two instruments: `scripts/park-digest.mts` (before/after
 * proof for a generator change) and `scripts/park-file-probe.mts` (a prebuilt
 * park against a fresh solve). They must measure the same thing, so they call
 * the same function.
 */
import { createHash } from 'node:crypto';
import { InstancedMesh, Mesh, type BufferAttribute, type Object3D } from 'three';

export interface SceneDigest {
  /** sha256 of the whole scene, first 16 hex digits. */
  readonly park: string;
  readonly meshes: number;
  /** Per mesh name, the roll-up of every mesh by that name — so a moved prop is identifiable. */
  readonly byName: ReadonlyMap<string, string>;
}

export function digestScene(scene: Object3D): SceneDigest {
  const perMesh: { name: string; hash: string }[] = [];
  const whole = createHash('sha256');

  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
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
        hash.update(`${position.getX(i).toFixed(6)},${position.getY(i).toFixed(6)},${position.getZ(i).toFixed(6)};`);
      }
    }
    // **An `InstancedMesh` keeps where its instances stand in `instanceMatrix`,
    // not in `matrixWorld` or its geometry** — so without this the digest of
    // `railRace:trestle-legs` was the same number whether the legs moved or not.
    // Found on 6 Sep 2026 by the control this instrument is supposed to be: the
    // whole-park digest read byte-identical while `check:swept-bus` on the same
    // park went 28 → 0 posts. Every instance's matrix (and colour) is hashed,
    // over `count` — the instances actually drawn.
    if (object instanceof InstancedMesh) {
      const instances = object.instanceMatrix.array;
      const drawn = Math.min(object.count, object.instanceMatrix.count) * 16;
      hash.update(`instances=${object.count};`);
      for (let i = 0; i < drawn; i += 1) hash.update(`${(instances[i] ?? 0).toFixed(6)},`);
      const colours = object.instanceColor?.array;
      if (colours) {
        const drawnColours = Math.min(object.count, object.instanceColor?.count ?? 0) * 3;
        for (let i = 0; i < drawnColours; i += 1) hash.update(`${(colours[i] ?? 0).toFixed(6)},`);
      }
    }
    const digest = hash.digest('hex');
    perMesh.push({ name, hash: digest });
    whole.update(name);
    whole.update(digest);
  });

  const byName = new Map<string, ReturnType<typeof createHash>>();
  for (const mesh of perMesh) {
    let h = byName.get(mesh.name);
    if (!h) {
      h = createHash('sha256');
      byName.set(mesh.name, h);
    }
    h.update(mesh.hash);
  }
  const rolled = new Map<string, string>();
  for (const [name, h] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    rolled.set(name, h.digest('hex').slice(0, 16));
  }
  return { park: whole.digest('hex').slice(0, 16), meshes: perMesh.length, byName: rolled };
}
