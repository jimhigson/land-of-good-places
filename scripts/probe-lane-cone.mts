/** Throwaway probe: what is standing in the journey lane's carriageway. */
import './headless-canvas.mjs';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import { BusJourney, JOURNEY_GATE_Z, BUS_WAIT_Z, JOURNEY_SECONDS } from '../src/world/entrance/BusJourney.ts';
import { ROAD_HALF_WIDTH } from '../src/world/entrance/road.ts';
import { CROWD_HAIR_STYLES } from '../src/art/models/hair.ts';

const rider = {
  skin: 0xffccaa,
  hair: 0x4b2e2e,
  outfit: 0xff88aa,
  hairStyle: CROWD_HAIR_STYLES[0]!,
};

const journey = new BusJourney(rider as never);

console.log('ROAD_HALF_WIDTH', ROAD_HALF_WIDTH.toFixed(3));
console.log('JOURNEY_GATE_Z', JOURNEY_GATE_Z, 'BUS_WAIT_Z', BUS_WAIT_Z, 'JOURNEY_SECONDS', JOURNEY_SECONDS);

const matrix = new Matrix4();
const box = new Box3();
const size = new Vector3();
const centre = new Vector3();

interface Hit {
  name: string;
  index: number;
  x: number;
  z: number;
  halfX: number;
  intrusion: number;
  height: number;
}
const hits: Hit[] = [];

journey.scene.updateMatrixWorld(true);
journey.scene.traverse((node) => {
  if (node instanceof InstancedMesh) {
    node.geometry.computeBoundingBox();
    const local = node.geometry.boundingBox;
    if (!local) return;
    for (let i = 0; i < node.count; i += 1) {
      node.getMatrixAt(i, matrix);
      box.copy(local).applyMatrix4(matrix).applyMatrix4(node.matrixWorld);
      box.getSize(size);
      box.getCenter(centre);
      const halfX = size.x / 2;
      const intrusion = ROAD_HALF_WIDTH + halfX - Math.abs(centre.x);
      if (intrusion > 0) {
        hits.push({
          name: node.name || '(unnamed instanced)',
          index: i,
          x: centre.x,
          z: centre.z,
          halfX,
          intrusion,
          height: size.y,
        });
      }
    }
    return;
  }
  if (node instanceof Mesh) {
    node.geometry.computeBoundingBox();
    const local = node.geometry.boundingBox;
    if (!local) return;
    box.copy(local).applyMatrix4(node.matrixWorld);
    box.getSize(size);
    box.getCenter(centre);
    const halfX = size.x / 2;
    const intrusion = ROAD_HALF_WIDTH + halfX - Math.abs(centre.x);
    if (intrusion > 0 && node.name !== 'journey-road') {
      hits.push({
        name: node.name || `(unnamed mesh ${node.type})`,
        index: -1,
        x: centre.x,
        z: centre.z,
        halfX,
        intrusion,
        height: size.y,
      });
    }
  }
});

hits.sort((a, b) => b.intrusion - a.intrusion);
console.log(`\n${hits.length} objects overlapping the carriageway corridor (|x| <= ${ROAD_HALF_WIDTH.toFixed(2)}):`);
for (const hit of hits.slice(0, 40)) {
  console.log(
    `  ${hit.name.padEnd(26)} #${String(hit.index).padStart(3)}  x=${hit.x.toFixed(2).padStart(7)}  z=${hit.z.toFixed(1).padStart(8)}  halfX=${hit.halfX.toFixed(2)}  intrudes=${hit.intrusion.toFixed(2)} m  h=${hit.height.toFixed(1)}`,
  );
}

// What does a road mesh actually span?
journey.scene.traverse((node) => {
  if (node instanceof Mesh && node.name === 'journey-road') {
    node.geometry.computeBoundingBox();
    const local = node.geometry.boundingBox;
    if (!local) return;
    box.copy(local).applyMatrix4(node.matrixWorld);
    console.log(`\njourney-road spans z ${box.min.z.toFixed(1)} .. ${box.max.z.toFixed(1)}, x ${box.min.x.toFixed(2)} .. ${box.max.x.toFixed(2)}`);
  }
});

// Names present, for orientation.
const names = new Set<string>();
journey.scene.traverse((n) => {
  if (n.name) names.add(n.name);
});
console.log('\nnamed nodes:', [...names].sort().join(', '));
