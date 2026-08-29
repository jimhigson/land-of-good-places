/**
 * #362 part 1: does any child *spawn* inside the castle, or do they all walk in?
 *
 * Decided by watching, not by reading the spawn code. Every crossing goes
 * through `NpcCharacter.stepThroughDoor` (#350's portal), so a child who is
 * indoors and has never called it did not walk in — it was put there.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { WanderDriver } from '../src/entities/npc/wanderDriver.ts';
import { spaceAt, SPACE_GARDEN } from '../src/world/spaces.ts';
import type { FrameContext } from '../src/core/types.ts';

const DT = 1 / 60;
const SECONDS = Number(process.env['SECONDS'] ?? 300);
const park = buildHeadlessPark();
const world = park.world;
const all = world.npcs.all;
const kids = all.filter((c) => c.driver instanceof WanderDriver);
const others = all.filter((c) => !(c.driver instanceof WanderDriver));

console.log(`${all.length} NPCs: ${kids.length} park children, ${others.length} other`);

// --- t=0, before a single update ------------------------------------------
const atSpawn = new Map<string, string>();
for (const c of all) atSpawn.set(c.name, spaceAt(c.position.x, c.position.z));
const spawnCensus = new Map<string, number>();
for (const s of atSpawn.values()) spawnCensus.set(s, (spawnCensus.get(s) ?? 0) + 1);
console.log('SPAWN census (t=0, before any update):', JSON.stringify([...spawnCensus]));
for (const [name, space] of atSpawn) {
  if (space !== SPACE_GARDEN) {
    const c = all.find((x) => x.name === name)!;
    console.log(
      `  spawned OUTSIDE the garden: ${name} in ${space} at ` +
        `(${c.position.x.toFixed(1)}, ${c.position.z.toFixed(1)}) ` +
        `driver=${c.driver.name}`,
    );
  }
}

// --- every crossing, recorded ---------------------------------------------
const crossings = new Map<string, number>();
for (const c of all) {
  const character = c as unknown as {
    name: string;
    stepThroughDoor?: (x: number, y: number, z: number, f: number) => void;
  };
  const real = character.stepThroughDoor?.bind(character);
  if (!real) continue;
  character.stepThroughDoor = (x, y, z, f) => {
    real(x, y, z, f);
    crossings.set(c.name, (crossings.get(c.name) ?? 0) + 1);
  };
}

const input = new InputSystem();
const pp = new Vector3(0, 0, 0);
const cf = new Vector3(0, 0, 1);
/** Anybody seen indoors, and whether they had crossed by then. */
const indoorsWithoutCrossing = new Set<string>();
const everIndoors = new Set<string>();

for (let f = 0; f < Math.ceil(SECONDS / DT); f += 1) {
  quietly(() =>
    world.update({
      dt: DT,
      elapsed: f * DT,
      input,
      playerPosition: pp,
      cameraForward: cf,
      frame: f,
    } as FrameContext),
  );
  for (const c of kids) {
    if (spaceAt(c.position.x, c.position.z) === SPACE_GARDEN) continue;
    everIndoors.add(c.name);
    if (!crossings.has(c.name)) indoorsWithoutCrossing.add(c.name);
  }
}

console.log(`\nafter ${SECONDS}s:`);
console.log(`  children ever indoors: ${everIndoors.size} ${JSON.stringify([...everIndoors])}`);
console.log(`  children who crossed a portal: ${crossings.size} ${JSON.stringify([...crossings])}`);
console.log(
  `  INDOORS WITHOUT EVER CROSSING: ${indoorsWithoutCrossing.size} ` +
    JSON.stringify([...indoorsWithoutCrossing]),
);
console.log(
  indoorsWithoutCrossing.size === 0
    ? '  => nobody appears inside the castle except by walking in through the door.'
    : '  => somebody is inside the castle without having walked in. That is a spawn.',
);
