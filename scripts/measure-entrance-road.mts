/** Scratch: where does the entrance road end, and what is near it? */
import './headless-canvas.mjs';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_BOUNDARY, edgeRadiusAt } from '../src/world/boundary.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import {
  ENTRANCE_BUS_STOP_Z,
  ENTRANCE_BUS_ARRIVE_X,
  ENTRANCE_BUS_VANISH_X,
  ENTRANCE_GATE_Z,
} from '../src/world/entrance/layout.ts';
import { TERRAIN_RADIUS, RIM_OUTSET_START, RIM_OUTSET_END } from '../src/core/constants.ts';

const park = buildHeadlessPark();

// road extents
const roadBox = new Box3();
roadBox.makeEmpty();
const perMesh: string[] = [];
park.scene.traverse((o) => {
  const m = o as Mesh;
  if (!m.isMesh || !m.name.startsWith('entrance-road')) return;
  const b = new Box3().setFromObject(m);
  perMesh.push(`${m.name}: x ${b.min.x.toFixed(2)}..${b.max.x.toFixed(2)}  z ${b.min.z.toFixed(2)}..${b.max.z.toFixed(2)}  y ${b.min.y.toFixed(2)}..${b.max.y.toFixed(2)}`);
  roadBox.union(b);
});
console.log('ROAD MESHES:'); for (const l of perMesh) console.log('  ' + l);

// trestle legs
const legs: Vector3[] = [];
const mat = new Matrix4();
park.scene.traverse((o) => {
  const im = o as InstancedMesh;
  if (!im.isInstancedMesh || im.name !== 'railRace:trestle-legs') return;
  for (let i = 0; i < im.count; i += 1) {
    im.getMatrixAt(i, mat);
    const at = new Vector3().setFromMatrixPosition(mat);
    im.localToWorld(at);
    legs.push(at);
  }
});
console.log(`\nTRESTLE LEGS: ${legs.length}`);
const near = legs
  .map((l) => ({ l, d: Math.abs(l.z - ENTRANCE_BUS_STOP_Z) }))
  .filter((e) => e.d < 25 && e.l.z > 40)
  .sort((a, b) => a.d - b.d);
for (const { l, d } of near.slice(0, 20)) {
  console.log(`  leg x ${l.x.toFixed(2)} z ${l.z.toFixed(2)} r ${Math.hypot(l.x, l.z).toFixed(2)} | dz from kerb ${d.toFixed(2)}`);
}

// boundary + terrain along the kerb line
console.log(`\nALONG THE KERB (z = ${ENTRANCE_BUS_STOP_Z}):`);
console.log('    x   boundaryR   hypot  inside?   terrainY   beyondEdge');
for (let x = -60; x <= 60; x += 5) {
  const z = ENTRANCE_BUS_STOP_Z;
  const r = Math.hypot(x, z);
  const er = edgeRadiusAt(PARK_BOUNDARY, Math.atan2(z, x));
  console.log(`  ${x.toString().padStart(4)}  ${er.toFixed(2).padStart(8)} ${r.toFixed(2).padStart(8)}  ${(r < er ? 'IN ' : 'out')}  ${terrainHeight(x, z).toFixed(2).padStart(8)}  ${(-PARK_BOUNDARY.distanceToEdge(x, z)).toFixed(2).padStart(8)}`);
}

console.log(`\nOUTWARD FROM THE GATE (x = 0):`);
console.log('     z   terrainY  beyondEdge');
for (let z = 58; z <= 110; z += 2) {
  console.log(`  ${z.toString().padStart(4)}  ${terrainHeight(0, z).toFixed(2).padStart(8)}  ${(-PARK_BOUNDARY.distanceToEdge(0, z)).toFixed(2).padStart(8)}`);
}
console.log(`\nTERRAIN_RADIUS ${TERRAIN_RADIUS}, RIM ${RIM_OUTSET_START}..${RIM_OUTSET_END}, gateZ ${ENTRANCE_GATE_Z}, busRun x ${ENTRANCE_BUS_ARRIVE_X}..${ENTRANCE_BUS_VANISH_X}`);
