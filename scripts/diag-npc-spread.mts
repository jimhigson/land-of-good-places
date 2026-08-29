import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { WanderDriver } from '../src/entities/npc/wanderDriver.ts';
import type { FrameContext } from '../src/core/types.ts';

const DT = 1 / 60;
const SECONDS = Number(process.env.SECONDS ?? 300);
const FRAMES = Math.ceil(SECONDS / DT);

const park = buildHeadlessPark();
const world = park.world;
const kids = world.npcs.all.filter((c) => c.driver instanceof WanderDriver);
console.log(`park children=${kids.length} (of ${world.npcs.all.length})`);

const input = new InputSystem();
const playerPosition = new Vector3(0, 0, 0);
const cameraForward = new Vector3(0, 0, 1);

/** Single-linkage clusters at `radius`. */
function clusters(radius: number): number[] {
  const parent = kids.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
    if (Math.hypot(kids[i]!.position.x - kids[j]!.position.x, kids[i]!.position.z - kids[j]!.position.z) < radius) {
      parent[find(i)] = find(j);
    }
  }
  const sizes = new Map<number, number>();
  for (let i = 0; i < kids.length; i++) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1);
  return [...sizes.values()].sort((a, b) => b - a);
}

function report(t: number): void {
  let cx = 0, cz = 0;
  for (const k of kids) { cx += k.position.x; cz += k.position.z; }
  cx /= kids.length; cz /= kids.length;
  let sum = 0;
  for (const k of kids) sum += (k.position.x - cx) ** 2 + (k.position.z - cz) ** 2;
  const rms = Math.sqrt(sum / kids.length);
  const c = clusters(6);
  console.log(`t=${String(t.toFixed(0)).padStart(3)}s rms=${rms.toFixed(2)} centroid=(${cx.toFixed(1)},${cz.toFixed(1)}) clusters@6m=[${c.join(',')}]`);
}

report(0);
for (let frame = 0; frame < FRAMES; frame += 1) {
  const context: FrameContext = { dt: DT, elapsed: frame * DT, input, playerPosition, cameraForward, frame };
  quietly(() => world.update(context));
  if ((frame + 1) % (20 * 60) === 0) report((frame + 1) * DT);
}
console.log('--- final ---');
for (const k of kids) {
  const d = k.driver as WanderDriver;
  console.log(`${k.name.padEnd(9)} (${k.position.x.toFixed(1)}, ${k.position.z.toFixed(1)}) target=${d.targetNode}`);
}
