/** Throwaway probe: what is standing in the journey lane's carriageway. */
import './headless-canvas.mjs';
import { InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import {
  BusJourney,
  JOURNEY_GATE_Z,
  BUS_WAIT_Z,
} from '../src/world/entrance/BusJourney.ts';
import { ROAD_HALF_WIDTH } from '../src/world/entrance/road.ts';
import { CROWD_HAIR_STYLES } from '../src/art/models/hair.ts';

const journey = new BusJourney({
  skin: 0xffccaa,
  hair: 0x4b2e2e,
  outfit: 0xff88aa,
  hairStyle: CROWD_HAIR_STYLES[0]!,
});

console.log('ROAD_HALF_WIDTH', ROAD_HALF_WIDTH.toFixed(3));
console.log('JOURNEY_GATE_Z', JOURNEY_GATE_Z, 'BUS_WAIT_Z', BUS_WAIT_Z);

/** The road itself, the ground it is painted on, and the bus and everyone in it. */
const EXEMPT = new Set(['journey-road', 'journey-ground']);

const worst = new Map<string, { x: number; z: number; y: number; over: number; index: number }>();
const local = new Vector3();
const world = new Vector3();
const instance = new Matrix4();

journey.scene.updateMatrixWorld(true);

function note(name: string, index: number, p: Vector3): void {
  const over = ROAD_HALF_WIDTH - Math.abs(p.x);
  if (over <= 0) return;
  const prev = worst.get(name);
  if (!prev || over > prev.over) worst.set(name, { x: p.x, z: p.z, y: p.y, over, index });
}

journey.scene.traverse((node) => {
  if (EXEMPT.has(node.name)) return;
  // Anything hanging off the bus is the bus, and the bus is meant to be on the road.
  for (let a: typeof node | null = node; a; a = a.parent) {
    if (a.name === 'cat-bus') return;
  }
  const mesh = node as Mesh;
  if (!(node instanceof Mesh) && !(node instanceof InstancedMesh)) return;
  const position = mesh.geometry?.getAttribute('position');
  if (!position) return;

  if (node instanceof InstancedMesh) {
    for (let i = 0; i < node.count; i += 1) {
      node.getMatrixAt(i, instance);
      for (let v = 0; v < position.count; v += 1) {
        local.fromBufferAttribute(position, v);
        world.copy(local).applyMatrix4(instance).applyMatrix4(node.matrixWorld);
        note(node.name || '(unnamed instanced)', i, world);
      }
    }
    return;
  }
  for (let v = 0; v < position.count; v += 1) {
    local.fromBufferAttribute(position, v);
    world.copy(local).applyMatrix4(node.matrixWorld);
    note(node.name || `(unnamed ${node.type})`, -1, world);
  }
});

const rows = [...worst.entries()].sort((a, b) => b[1].over - a[1].over);
console.log(`\n${rows.length} distinct nodes reach inside the carriageway (|x| < ${ROAD_HALF_WIDTH.toFixed(2)}):`);
for (const [name, hit] of rows) {
  console.log(
    `  ${name.padEnd(26)} #${String(hit.index).padStart(3)}  x=${hit.x.toFixed(2).padStart(7)}  y=${hit.y.toFixed(2).padStart(6)}  z=${hit.z.toFixed(1).padStart(8)}  reaches ${hit.over.toFixed(2)} m in`,
  );
}
if (rows.length === 0) console.log('  (none — the carriageway is clear)');
