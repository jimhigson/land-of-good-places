/**
 * Throwaway probe: what the cat bus's lane is actually made of.
 *
 * Prints, off the built scene: every drawn node with its instance and triangle
 * count, whether its geometry is the park's own foliage geometry *by identity*,
 * and anything reaching inside the carriageway. Run across seeds with
 * `LGP_SEED=n`.
 */
import './headless-canvas.mjs';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import { BusJourney, JOURNEY_GATE_Z, BUS_WAIT_Z, laneHeight } from '../src/world/entrance/BusJourney.ts';
import { ROAD_HALF_WIDTH } from '../src/world/entrance/road.ts';
import { FOLIAGE_GEOMETRY } from '../src/world/treeModel.ts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { CROWD_HAIR_STYLES } from '../src/art/models/hair.ts';

const journey = new BusJourney({
  skin: 0xffccaa,
  hair: 0x4b2e2e,
  outfit: 0xff88aa,
  hairStyle: CROWD_HAIR_STYLES[0]!,
});
journey.scene.updateMatrixWorld(true);

console.log(`PARK_SEED ${PARK_SEED}   ROAD_HALF_WIDTH ${ROAD_HALF_WIDTH.toFixed(3)}`);
console.log(`JOURNEY_GATE_Z ${JOURNEY_GATE_Z}   BUS_WAIT_Z ${BUS_WAIT_Z}`);

const parkGeometry = new Map(Object.entries(FOLIAGE_GEOMETRY).map(([k, g]) => [g, k]));

// --- what the lane is made of ----------------------------------------------
let totalTris = 0;
const rows: string[] = [];
journey.scene.traverse((node) => {
  if (!node.name.startsWith('journey-')) return;
  const drawn = node instanceof InstancedMesh || node instanceof Mesh;
  if (!drawn) return;
  const geometry = (node as Mesh).geometry;
  const position = geometry?.getAttribute('position');
  if (!position) return;
  const count = node instanceof InstancedMesh ? node.count : 1;
  const perInstance = (geometry.index ? geometry.index.count : position.count) / 3;
  const tris = perInstance * count;
  totalTris += tris;
  const shared = parkGeometry.get(geometry);
  rows.push(
    `${node.name.padEnd(30)} ${String(count).padStart(5)} inst  ${String(Math.round(tris)).padStart(8)} tris  ` +
      `${shared ? `park FOLIAGE_GEOMETRY.${shared}` : geometry.type}`,
  );
});
console.log('\n--- lane contents ---');
for (const r of rows.sort()) console.log(r);
console.log(`${' '.repeat(30)} ${String(Math.round(totalTris)).padStart(19)} tris total`);

// --- anything still standing on the road ------------------------------------
let busTop = 0;
const box = new Box3();
journey.scene.traverse((n) => {
  if (n.name === 'cat-bus') busTop = box.setFromObject(n).max.y;
});

const EXEMPT = new Set(['journey-road', 'journey-ground']);
const worst = new Map<string, { x: number; z: number; y: number; reach: number; index: number }>();
const local = new Vector3();
const world = new Vector3();
const instance = new Matrix4();

const note = (name: string, index: number, p: Vector3): void => {
  const reach = ROAD_HALF_WIDTH - Math.abs(p.x);
  if (reach <= 0) return;
  if (p.y > laneHeight(p.z) + busTop) return;
  const prev = worst.get(name);
  if (!prev || reach > prev.reach) worst.set(name, { x: p.x, z: p.z, y: p.y, reach, index });
};

journey.scene.traverse((node) => {
  if (EXEMPT.has(node.name)) return;
  for (let up: typeof node | null = node; up; up = up.parent) {
    if (up.name === 'cat-bus' || up.name === 'journey-park-gate') return;
  }
  const drawn = node instanceof InstancedMesh || node instanceof Mesh;
  if (!drawn) return;
  const position = (node as Mesh).geometry?.getAttribute('position');
  if (!position) return;
  const name = node.name || `(unnamed ${node.type})`;
  if (node instanceof InstancedMesh) {
    for (let i = 0; i < node.count; i += 1) {
      node.getMatrixAt(i, instance);
      for (let v = 0; v < position.count; v += 1) {
        local.fromBufferAttribute(position, v);
        world.copy(local).applyMatrix4(instance).applyMatrix4(node.matrixWorld);
        note(name, i, world);
      }
    }
    return;
  }
  for (let v = 0; v < position.count; v += 1) {
    local.fromBufferAttribute(position, v);
    world.copy(local).applyMatrix4(node.matrixWorld);
    note(name, -1, world);
  }
});

console.log(`\n--- inside the carriageway (|x| < ${ROAD_HALF_WIDTH.toFixed(2)}, below bus top ${busTop.toFixed(2)}) ---`);
if (worst.size === 0) console.log('nothing. the road is clear.');
for (const [name, w] of [...worst.entries()].sort((a, b) => b[1].reach - a[1].reach)) {
  console.log(`${name} #${w.index}  x=${w.x.toFixed(2)} z=${w.z.toFixed(1)} y=${w.y.toFixed(2)}  reaches ${w.reach.toFixed(2)} m in`);
}

journey.dispose();
