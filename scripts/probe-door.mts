/** Where does the bus's door actually land, now the road curves? */
import './headless-canvas.mjs';
import { createCatBus } from '../src/world/entrance/catBus.ts';
import { entranceRoadAt, entranceRoadFacing } from '../src/world/entrance/roadRoute.ts';
import { ENTRANCE_GATE_X, ENTRANCE_GATE_Z, ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../src/world/entrance/layout.ts';

const bus = createCatBus();
const stopAt = bus.doorDrop.z;
const stop = entranceRoadAt(stopAt);
const facing = entranceRoadFacing(stopAt);
const cos = Math.cos(facing);
const sin = Math.sin(facing);
const { x: lx, z: lz } = bus.doorDrop;
const door = { x: stop.x + lx * cos + lz * sin, z: stop.z - lx * sin + lz * cos };

console.log(`doorDrop local  x ${lx.toFixed(2)} z ${lz.toFixed(2)}`);
console.log(`stopAt ${stopAt.toFixed(2)}  bus centre ${stop.x.toFixed(2)}, ${stop.z.toFixed(2)}  facing ${((facing * 180) / Math.PI).toFixed(1)}deg`);
console.log(`door lands at   ${door.x.toFixed(2)}, ${door.z.toFixed(2)}`);
console.log(`gate is at      ${ENTRANCE_GATE_X.toFixed(2)}, ${ENTRANCE_GATE_Z.toFixed(2)}   (door should be just outside it, +z)`);
console.log(`she ends up at  ${ENTRANCE_PLAYER_X.toFixed(2)}, ${ENTRANCE_PLAYER_Z.toFixed(2)}`);
console.log(`door -> gate    ${Math.hypot(door.x - ENTRANCE_GATE_X, door.z - ENTRANCE_GATE_Z).toFixed(2)} m`);
console.log(`door -> her     ${Math.hypot(door.x - ENTRANCE_PLAYER_X, door.z - ENTRANCE_PLAYER_Z).toFixed(2)} m`);
bus.dispose();
