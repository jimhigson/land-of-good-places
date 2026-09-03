/** TEMP diagnostic: walk a straight line through a poiGraph break and print,
 * at every 25 cm, exactly what `poiGraph.isClear` sees there — same probe,
 * same clearance rule, same bridge height. Control: the same transect over a
 * stretch of the SAME lane that IS joined, so a column reading the same
 * everywhere is visible as uninformative rather than mistaken for a cause. */
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { bridgeHeightAt } from '../src/world/train/bridges.ts';
import { pointStandsOnABridgeRamp } from '../src/world/paths.ts';
import { isOnPath } from '../src/world/pathGraph.ts';
import { NPC_RADIUS } from '../src/core/constants.ts';

const park = quietly(() => buildHeadlessPark());
const world = park.world;
const CLEARANCE = 0.7;
const PAVED_CLEARANCE = NPC_RADIUS - 0.02;
const probe = new Vector3();
const height = (x: number, z: number): number | null =>
  bridgeHeightAt(world.train.bridges, x, z);

const clearAt = (x: number, z: number): { ok: boolean; push: number } => {
  probe.set(x, height(x, z) ?? 0, z);
  world.collision.resolve(probe, isOnPath(x, z, 0) ? PAVED_CLEARANCE : CLEARANCE);
  const dx = probe.x - x;
  const dz = probe.z - z;
  return { ok: dx * dx + dz * dz < 1e-6, push: Math.hypot(dx, dz) };
};

const transect = (label: string, ax: number, az: number, bx: number, bz: number): void => {
  console.log(`\n${label}: (${ax},${az}) -> (${bx},${bz})`);
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(len / 0.25);
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    const h = height(x, z);
    const c = clearAt(x, z);
    console.log(
      `  d=${(len * t).toFixed(2).padStart(5)} (${x.toFixed(2)},${z.toFixed(2)}) ` +
        `ramp=${pointStandsOnABridgeRamp(x, z) ? 'Y' : '.'} ` +
        `onPath=${isOnPath(x, z, 0) ? 'Y' : '.'} ` +
        `h=${h === null ? '  null' : h.toFixed(2).padStart(6)} ` +
        `${c.ok ? 'clear' : `BLOCKED push=${c.push.toFixed(2)}`}`,
    );
  }
};

const args = process.argv.slice(2);
if (args.length === 4) {
  transect('transect', Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3]));
} else {
  // seed 131's break: the pocket's last node -> the lane's first joined node.
  transect('BREAK gate-approach at=37 -> at=44', 0.0, 31.6, 0.5, 27.7);
  // CONTROL: two consecutive nodes of the same lane that ARE joined.
  transect('CONTROL gate-approach at=44 -> at=52', 0.5, 27.7, 3.3, 24.8);
  transect('CONTROL gate-approach at=59 -> at=66', 3.7, 20.8, 3.7, 16.8);
}
