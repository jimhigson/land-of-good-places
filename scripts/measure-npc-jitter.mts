/**
 * **Does any child in the park vibrate?**
 *
 * Builds the real park headlessly (`scripts/park-harness.mts`) and runs
 * `World.update` frame by frame at a fixed 60 Hz, recording every child's
 * position at three points in each frame:
 *
 *   p0  start of frame
 *   p1  after `ParkTrain.carryPassengers` (the only thing outside `NpcSystem`
 *       that writes a child's x/z)
 *   p2  after `NpcSystem.update` (their own movement + separation)
 *
 * A vibrating child shows as a large per-frame step whose sign alternates: the
 * two writers are fighting, and each undoes the other. A child *walking* moves
 * at most `NPC_WALK_SPEED * dt` = 4.25 cm per frame.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../src/world/entrance/layout.ts';
import type { FrameContext } from '../src/core/types.ts';

const DT = 1 / 60;
const FRAMES = Number(process.argv[2] ?? 24_000); // ~6.5 minutes of park

const { world } = buildHeadlessPark();

const input = new InputSystem();
const playerPosition = new Vector3(ENTRANCE_PLAYER_X, 0, ENTRANCE_PLAYER_Z);
const cameraForward = new Vector3(0, 0, 1);

const characters = world.npcs.riders;
const stations = world.train.stations.map((s) => ({ name: s.name, x: s.standX, z: s.standZ }));

interface Sample {
  frame: number;
  who: number;
  name: string;
  x: number;
  z: number;
  trainStep: number;
  npcStep: number;
  total: number;
  nearStation: string | null;
}

const p0x = new Float64Array(characters.length);
const p0z = new Float64Array(characters.length);
const p1x = new Float64Array(characters.length);
const p1z = new Float64Array(characters.length);

/** Previous frame's total step vector, for the alternating-sign test. */
const prevDx = new Float64Array(characters.length);
const prevDz = new Float64Array(characters.length);

const worst: Sample[] = [];
let oscillations = 0;
const oscByChild = new Map<string, number>();
const oscSamples: Sample[] = [];

// Wrap carryPassengers so we can see exactly what the train wrote.
const train = world.train;
const realCarry = train.carryPassengers.bind(train);
train.carryPassengers = (chars) => {
  realCarry(chars);
  for (let i = 0; i < characters.length; i += 1) {
    p1x[i] = characters[i]!.position.x;
    p1z[i] = characters[i]!.position.z;
  }
};

function nearStation(x: number, z: number): string | null {
  for (const station of stations) {
    if (Math.hypot(station.x - x, station.z - z) < 14) return station.name;
  }
  return null;
}

for (let frame = 0; frame < FRAMES; frame += 1) {
  for (let i = 0; i < characters.length; i += 1) {
    p0x[i] = characters[i]!.position.x;
    p0z[i] = characters[i]!.position.z;
    p1x[i] = p0x[i]!;
    p1z[i] = p0z[i]!;
  }

  const context: FrameContext = {
    dt: DT,
    elapsed: frame * DT,
    input,
    playerPosition,
    cameraForward,
    frame,
  };
  quietly(() => world.update(context));

  for (let i = 0; i < characters.length; i += 1) {
    const character = characters[i]!;
    const x = character.position.x;
    const z = character.position.z;
    const trainStep = Math.hypot(p1x[i]! - p0x[i]!, p1z[i]! - p0z[i]!);
    const npcStep = Math.hypot(x - p1x[i]!, z - p1z[i]!);
    const dx = x - p0x[i]!;
    const dz = z - p0z[i]!;
    const total = Math.hypot(dx, dz);

    const sample: Sample = {
      frame,
      who: i,
      name: character.name,
      x,
      z,
      trainStep,
      npcStep,
      total,
      nearStation: nearStation(x, z),
    };

    // A step this big is not walking (walk = 4.25 cm/frame at 60 Hz).
    if (total > 0.2) worst.push(sample);

    // Alternating sign: this frame's step points back the way the last one
    // came, and both are big. That is vibration, not travel.
    const dot = dx * prevDx[i]! + dz * prevDz[i]!;
    const prevLength = Math.hypot(prevDx[i]!, prevDz[i]!);
    if (total > 0.15 && prevLength > 0.15 && dot < -0.5 * total * prevLength) {
      oscillations += 1;
      oscByChild.set(character.name, (oscByChild.get(character.name) ?? 0) + 1);
      if (oscSamples.length < 40) oscSamples.push(sample);
    }

    prevDx[i] = dx;
    prevDz[i] = dz;
  }
}

worst.sort((a, b) => b.total - a.total);

console.log(`frames: ${FRAMES}  children: ${characters.length}  dt: ${DT.toFixed(5)}`);
console.log(`stations: ${stations.map((s) => `${s.name} (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`).join('  ')}`);
console.log(`\nsteps > 0.20 m in one frame: ${worst.length}`);
for (const sample of worst.slice(0, 25)) {
  console.log(
    `  f${String(sample.frame).padStart(6)} ${sample.name.padEnd(8)} ` +
      `total=${sample.total.toFixed(3)} train=${sample.trainStep.toFixed(3)} npc=${sample.npcStep.toFixed(3)} ` +
      `at (${sample.x.toFixed(2)}, ${sample.z.toFixed(2)}) ${sample.nearStation ?? ''}`,
  );
}

console.log(`\nalternating-sign frames (vibration): ${oscillations}`);
for (const [name, count] of [...oscByChild].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(8)} ${count}`);
}
for (const sample of oscSamples.slice(0, 20)) {
  console.log(
    `  osc f${String(sample.frame).padStart(6)} ${sample.name.padEnd(8)} ` +
      `total=${sample.total.toFixed(3)} train=${sample.trainStep.toFixed(3)} npc=${sample.npcStep.toFixed(3)} ` +
      `at (${sample.x.toFixed(2)}, ${sample.z.toFixed(2)}) ${sample.nearStation ?? ''}`,
  );
}
