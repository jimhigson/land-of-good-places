/**
 * Scratch measurement: the entrance road, the rail-race trestles near it, and
 * the band of ground either could stand on. One line of JSON per seed.
 *
 *   LGP_SEED=5 node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/measure-entrance-road.mts
 */
import './headless-canvas.mjs';
import { Box3, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_BOUNDARY } from '../src/world/boundary.ts';
import { terrainHeight } from '../src/world/terrain.ts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { ROAD_HALF_WIDTH } from '../src/world/entrance/road.ts';
import {
  ENTRANCE_BUS_STOP_Z,
  ENTRANCE_BUS_ARRIVE_X,
  ENTRANCE_BUS_VANISH_X,
} from '../src/world/entrance/layout.ts';
import { CAT_BUS_LENGTH, CAT_BUS_WIDTH } from '../src/world/entrance/catBus.ts';

const park = buildHeadlessPark();

const roadBoxes: { name: string; box: Box3 }[] = [];
park.scene.traverse((o) => {
  const m = o as Mesh;
  if (!m.isMesh || !m.name.startsWith('entrance-road')) return;
  roadBoxes.push({ name: m.name, box: new Box3().setFromObject(m) });
});

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

const busHalfLength = CAT_BUS_LENGTH / 2;
const busHalfWidth = CAT_BUS_WIDTH / 2;
const sweptMinX = Math.min(ENTRANCE_BUS_ARRIVE_X, ENTRANCE_BUS_VANISH_X) - busHalfLength;
const sweptMaxX = Math.max(ENTRANCE_BUS_ARRIVE_X, ENTRANCE_BUS_VANISH_X) + busHalfLength;

const inBusSweep = legs.filter(
  (l) =>
    l.x >= sweptMinX && l.x <= sweptMaxX && Math.abs(l.z - ENTRANCE_BUS_STOP_Z) <= busHalfWidth,
);
const inRoad = legs.filter((l) =>
  roadBoxes.some(
    (r) => l.x >= r.box.min.x && l.x <= r.box.max.x && l.z >= r.box.min.z && l.z <= r.box.max.z,
  ),
);

const nearGate = legs
  .filter((l) => Math.hypot(l.x, l.z - ENTRANCE_BUS_STOP_Z) < 45)
  .map((l) => ({ l, beyond: -PARK_BOUNDARY.distanceToEdge(l.x, l.z) }))
  .sort((a, b) => a.beyond - b.beyond);

console.log(
  JSON.stringify({
    seed: PARK_SEED,
    road: roadBoxes.map(
      (r) =>
        `${r.name.replace('entrance-road-', '')} x ${r.box.min.x.toFixed(1)}..${r.box.max.x.toFixed(1)} z ${r.box.min.z.toFixed(1)}..${r.box.max.z.toFixed(1)}`,
    ),
    legs: legs.length,
    legsInBusSweep: inBusSweep.length,
    legsInRoadFootprint: inRoad.length,
    worstBusIntrusion: inBusSweep.length
      ? Number(
          Math.max(...inBusSweep.map((l) => busHalfWidth - Math.abs(l.z - ENTRANCE_BUS_STOP_Z))).toFixed(2),
        )
      : 0,
    nearGateLegsBeyondEdge: nearGate.map((e) => Number(e.beyond.toFixed(1))),
  }),
);

if (process.env['LGP_VERBOSE']) {
  for (const { l, beyond } of nearGate) {
    console.log(
      `   leg x ${l.x.toFixed(2)} z ${l.z.toFixed(2)} beyondEdge ${beyond.toFixed(2)} groundY ${terrainHeight(l.x, l.z).toFixed(2)}`,
    );
  }
  console.log(
    `  road half width ${ROAD_HALF_WIDTH.toFixed(2)}, bus ${CAT_BUS_LENGTH.toFixed(1)} x ${CAT_BUS_WIDTH.toFixed(1)}`,
  );
}
