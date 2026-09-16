import './headless-canvas.mjs';
import {
  ENTRANCE_ROAD_KERB_HALF_RUN,
  ENTRANCE_ROAD_OUTSET,
  ENTRANCE_ROAD_TAIL_OUTSET,
  entranceRoadExtent,
  entranceRoadAt,
} from '../src/world/entrance/roadRoute.ts';
import { PARK_BOUNDARY } from '../src/world/boundary.ts';
import { terrainHeight } from '../src/world/terrain.ts';

const { from, to } = entranceRoadExtent();
console.log(
  `road outset ${ENTRANCE_ROAD_OUTSET.toFixed(2)} -> ${ENTRANCE_ROAD_TAIL_OUTSET.toFixed(2)}, kerb half run ${ENTRANCE_ROAD_KERB_HALF_RUN.toFixed(1)}, extent ${from.toFixed(1)}..${to.toFixed(1)}`,
);
console.log('     at        x        z   outset   groundY');
for (let at = Math.ceil(from); at <= to; at += 2) {
  const s = entranceRoadAt(at);
  console.log(
    `  ${at.toFixed(0).padStart(5)} ${s.x.toFixed(2).padStart(8)} ${s.z.toFixed(2).padStart(8)} ${(-PARK_BOUNDARY.distanceToEdge(s.x, s.z)).toFixed(2).padStart(8)} ${terrainHeight(s.x, s.z).toFixed(2).padStart(9)}`,
  );
}
