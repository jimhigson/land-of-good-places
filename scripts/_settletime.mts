/**
 * #362 constraint 2: how long does a hotel resident need before their body is
 * settled on its own floor?
 *
 * This decides whether "freeze an NPC in a space the player is not in" can be
 * applied from frame 0. `check:hotel` fails any character below
 * `FLOOR_OF_THE_WORLD`, and its own header records that regression firing with
 * "all seven residents at -16.5 m". Residents start at the park's terrain
 * height and `NpcCharacter.settle` walks them onto a floor plate six hundred
 * metres away — if that needs frames, freezing at t=0 strands them under it.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { WanderDriver } from '../src/entities/npc/wanderDriver.ts';
import type { FrameContext } from '../src/core/types.ts';

const DT = 1 / 60;
const park = buildHeadlessPark();
const world = park.world;
const residents = world.npcs.all.filter((c) => !(c.driver instanceof WanderDriver));

const report = (label: string): void => {
  console.log(
    `${label.padEnd(12)} ` +
      residents.map((r) => `${r.name}=${r.position.y.toFixed(2)}`).join(' '),
  );
};

report('t=0');

const input = new InputSystem();
const pp = new Vector3(0, 0, 0);
const cf = new Vector3(0, 0, 1);
for (let f = 0; f < Math.ceil(10 / DT); f += 1) {
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
  const t = (f + 1) * DT;
  if (Math.abs(t - 0.1) < DT / 2) report('t=0.1s');
  if (Math.abs(t - 0.5) < DT / 2) report('t=0.5s');
  if (Math.abs(t - 1) < DT / 2) report('t=1s');
  if (Math.abs(t - 3) < DT / 2) report('t=3s');
  if (Math.abs(t - 10) < DT / 2) report('t=10s');
}
