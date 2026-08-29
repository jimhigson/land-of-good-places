/**
 * #362 part 2, before designing anything: what does simulating NPCs in spaces
 * the player is not in actually cost?
 *
 * Measured by wrapping each character's own `update` and attributing the time
 * to the space that character was standing in at the time. No stubbing and no
 * behaviour change, so the park being measured is the park that ships.
 *
 * `separate()` is timed on its own because it is O(n^2) over *every* character
 * regardless of space, so it is a second, different cost that presence-marking
 * would also shrink.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { spaceAt, SPACE_GARDEN } from '../src/world/spaces.ts';
import type { FrameContext } from '../src/core/types.ts';

const DT = 1 / 60;
const SECONDS = Number(process.env['SECONDS'] ?? 180);
const park = buildHeadlessPark();
const world = park.world;
const npcs = world.npcs;
const all = npcs.all;

/** The player stands in the garden, as he does for almost all of a session. */
const playerSpace = SPACE_GARDEN;

let inSpaceMs = 0;
let offSpaceMs = 0;
let inSpaceCalls = 0;
let offSpaceCalls = 0;

for (const character of all) {
  const c = character as unknown as { update: (...args: unknown[]) => void };
  const real = c.update.bind(c);
  c.update = (...args: unknown[]) => {
    const off = spaceAt(character.position.x, character.position.z) !== playerSpace;
    const started = performance.now();
    real(...args);
    const took = performance.now() - started;
    if (off) {
      offSpaceMs += took;
      offSpaceCalls += 1;
    } else {
      inSpaceMs += took;
      inSpaceCalls += 1;
    }
  };
}

const system = npcs as unknown as { separate: (dt: number) => void };
const realSeparate = system.separate.bind(system);
let separateMs = 0;
system.separate = (dt: number) => {
  const started = performance.now();
  realSeparate(dt);
  separateMs += performance.now() - started;
};

const input = new InputSystem();
const pp = new Vector3(0, 0, 0);
const cf = new Vector3(0, 0, 1);
const FRAMES = Math.ceil(SECONDS / DT);

let npcUpdateMs = 0;
for (let f = 0; f < FRAMES; f += 1) {
  const context: FrameContext = {
    dt: DT,
    elapsed: f * DT,
    input,
    playerPosition: pp,
    cameraForward: cf,
    frame: f,
  };
  const started = performance.now();
  quietly(() => world.update(context));
  npcUpdateMs += performance.now() - started;
}

const total = inSpaceMs + offSpaceMs;
const pct = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(1) : '0.0');

console.log(`${FRAMES} frames (${SECONDS}s of park), ${all.length} NPCs, player in ${playerSpace}`);
console.log(`  whole world.update      ${npcUpdateMs.toFixed(0)} ms`);
console.log(
  `  character.update total  ${total.toFixed(0)} ms ` +
    `(${pct(total, npcUpdateMs)}% of world.update)`,
);
console.log(
  `    in the player's space ${inSpaceMs.toFixed(0)} ms over ${inSpaceCalls} calls ` +
    `(${pct(inSpaceMs, total)}%)`,
);
console.log(
  `    NOT in it             ${offSpaceMs.toFixed(0)} ms over ${offSpaceCalls} calls ` +
    `(${pct(offSpaceMs, total)}%)`,
);
console.log(
  `  separate() (O(n^2), all spaces) ${separateMs.toFixed(0)} ms ` +
    `(${pct(separateMs, npcUpdateMs)}% of world.update)`,
);
console.log(
  `\n  per-frame: ${(npcUpdateMs / FRAMES).toFixed(3)} ms world.update, of which ` +
    `${(offSpaceMs / FRAMES).toFixed(3)} ms is spent on NPCs the player cannot see`,
);
