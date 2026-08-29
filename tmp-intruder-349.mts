/**
 * What is clipping into the bridges? Every mesh in the scene whose own
 * world-space bounds overlap a bridge's masonry bounds, excluding that
 * bridge's own group.
 */
import './scripts/headless-canvas.mjs';
import { buildHeadlessPark } from './scripts/park-harness.mts';
import { Box3, Mesh, InstancedMesh, type Object3D } from 'three';

const park = buildHeadlessPark();
const scene = (park as unknown as { scene: Object3D }).scene;
const train = park.world.train;
const bridgesGroup = train.group.getObjectByName('railway-bridges')!;
scene.updateMatrixWorld(true);

const pathOf = (o: Object3D): string => {
  const parts: string[] = [];
  let n: Object3D | null = o;
  while (n) {
    parts.unshift(n.name || n.type);
    n = n.parent;
  }
  return parts.join('/');
};

for (const group of bridgesGroup.children) {
  // The masonry's own bounds, ignoring the invisible clearance marker.
  const masonry = new Box3();
  group.traverse((o) => {
    if (o instanceof Mesh && o.name !== 'deck') masonry.expandByObject(o);
  });
  // Shrink slightly so things merely touching the outside face don't count.
  const probe = masonry.clone().expandByScalar(-0.15);

  console.log(`\n=== ${group.name} masonry bounds ===`);
  console.log(`  x ${masonry.min.x.toFixed(2)}..${masonry.max.x.toFixed(2)}  y ${masonry.min.y.toFixed(2)}..${masonry.max.y.toFixed(2)}  z ${masonry.min.z.toFixed(2)}..${masonry.max.z.toFixed(2)}`);

  const hits: { path: string; kind: string; vol: number; box: Box3 }[] = [];
  scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    if (o.name === 'deck') return;
    // Skip anything belonging to this bridge itself.
    let n: Object3D | null = o;
    while (n) {
      if (n === group) return;
      n = n.parent;
    }
    const b = new Box3().setFromObject(o);
    if (!b.intersectsBox(probe)) return;
    const size = b.getSize(new (b.min.constructor as new () => typeof b.min)());
    hits.push({
      path: pathOf(o),
      kind: o instanceof InstancedMesh ? `instanced x${o.count}` : 'mesh',
      vol: size.x * size.y * size.z,
      box: b,
    });
  });
  hits.sort((a, b) => b.vol - a.vol);
  console.log(`  ${hits.length} foreign meshes overlap it:`);
  for (const h of hits.slice(0, 14)) {
    console.log(
      `    vol=${h.vol.toFixed(1).padStart(9)}  ${h.kind.padEnd(14)} ` +
        `y ${h.box.min.y.toFixed(2)}..${h.box.max.y.toFixed(2)}  ${h.path}`,
    );
  }
}
