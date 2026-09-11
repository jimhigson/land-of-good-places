/**
 * **Which quantity is actually too tight when two children leave the bus at
 * once?**
 *
 * `check:cat-bus` reports "two children left the bus only 0.02 s apart". It
 * measures the moment a child's position leaves the bus's own footprint. The
 * handoff before this one proposed pacing `delay + aisleSeconds` — the moment a
 * child reaches the *door drop* — on the theory that a short-aisle child catches
 * a long-aisle one.
 *
 * Those are two different instants, and the seats are handed out **nearest the
 * door first**, which should already make `delay + aisleSeconds` monotone. So
 * before anything is changed, this prints all three per child:
 *
 * - `delay`  — observed: when they first move out of their seat.
 * - `aisle`  — read off the walk: `seatDistance / NPC_WALK_SPEED`.
 * - `door`   — `delay + aisle`, the instant they reach the drop.
 * - `exit`   — observed: when they first leave the bus's own footprint.
 *
 * and the tightest consecutive gap in each, so the fix is aimed at whichever
 * one is actually short.
 */
import './headless-canvas.mjs';
import { Box3, Object3D, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { ARRIVAL_DURATION, ARRIVAL_KID_COUNT } from '../src/world/entrance/ArrivalSequence.ts';
import { CAT_BUS_LONGEST_WALK_TO_DOOR } from '../src/world/entrance/catBus.ts';
import { NPC_WALK_SPEED } from '../src/entities/npc/NpcCharacter.ts';
import type { FrameContext } from '../src/engine/FrameContext.ts';
import type { Player } from '../src/player/Player.ts';

const DT = 1 / 60;

class StubPlayer {
  riding = false;
  ridePosture: 'seated' | 'reclined' | 'walking' = 'seated';
  scriptedWalk = 0;
  readonly position = new Vector3();
  beginRide(): void {
    this.riding = true;
  }
  endRide(): void {
    this.riding = false;
  }
  setScriptedWalk(speed: number): void {
    this.scriptedWalk = Math.max(0, speed);
  }
  setRidePose(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
  }
  teleportTo(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
  }
  nudge(): void {}
}

const CONTEXT_PLAYER = new Vector3();
const CONTEXT_FORWARD = new Vector3(0, 0, -1);
function frame(elapsed: number, at?: Vector3): FrameContext {
  if (at) CONTEXT_PLAYER.copy(at);
  return {
    dt: DT,
    elapsed,
    frame: Math.round(elapsed / DT),
    input: { justPressed: () => false } as unknown as FrameContext['input'],
    playerPosition: CONTEXT_PLAYER as unknown as FrameContext['playerPosition'],
    cameraForward: CONTEXT_FORWARD as unknown as FrameContext['cameraForward'],
  };
}

function localFootprint(bus: Object3D): Box3 {
  const position = bus.position.clone();
  const rotation = bus.rotation.y;
  bus.position.set(0, 0, 0);
  bus.rotation.y = 0;
  bus.updateMatrixWorld(true);
  const box = new Box3().setFromObject(bus);
  bus.position.copy(position);
  bus.rotation.y = rotation;
  bus.updateMatrixWorld(true);
  return box;
}

function insideFootprint(bus: Object3D, localBox: Box3, at: Vector3): boolean {
  const local = bus.worldToLocal(at.clone());
  return (
    local.x >= localBox.min.x &&
    local.x <= localBox.max.x &&
    local.z >= localBox.min.z &&
    local.z <= localBox.max.z
  );
}

function findByName(root: Object3D, name: string): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((object) => {
    if (object.name === name) found = object;
  });
  return found;
}

const park = buildHeadlessPark();
const world = park.world;
const arrival = world.entrance.arrival;
if (!arrival) {
  console.error('no arrival built');
  process.exit(1);
}

const player = new StubPlayer();
world.entrance.attachPlayer(player as unknown as Player);

const kids = world.npcs.all.slice(0, ARRIVAL_KID_COUNT);
const busRoot = findByName(arrival.group, 'cat-bus');
if (!busRoot) {
  console.error('no cat-bus node');
  process.exit(1);
}
const busLocalBox = localFootprint(busRoot);

/** Read off the sequence's own per-child walks — the numbers the fix would change. */
const walks = (arrival as unknown as { kidWalks: { aisleSeconds: number; route: { from: { x: number; z: number } } }[] })
  .kidWalks;

// --- where was the bus when the aisle walks were measured? ----------------
//
// `World`'s constructor calls `attachNpcs`, which reads each seat's **world**
// position. If the bus is not standing at the stop by then, every one of those
// distances carries the whole length of the road it has yet to drive.
{
  const drop = (arrival as unknown as { playerRoute: { from: { x: number; z: number } } }).playerRoute.from;
  busRoot.updateMatrixWorld(true);
  const at = busRoot.getWorldPosition(new Vector3());
  console.log(`bus stands at ${at.x.toFixed(2)}, ${at.z.toFixed(2)} when attachNpcs measured the aisles`);
  console.log(`the drop is at ${drop.x.toFixed(2)}, ${drop.z.toFixed(2)}`);
  console.log(`bus -> drop   ${Math.hypot(at.x - drop.x, at.z - drop.z).toFixed(2)} m`);
  console.log(
    `longest walk down the bus itself: ${CAT_BUS_LONGEST_WALK_TO_DOOR.toFixed(2)} m ` +
      `= ${(CAT_BUS_LONGEST_WALK_TO_DOOR / NPC_WALK_SPEED).toFixed(2)} s (KID_AISLE_SECONDS, what the timeline budgets)`,
  );
  console.log('');
}

const DOOR = (arrival as unknown as { bus: { doorDrop: { x: number; z: number } } }).bus.doorDrop;
const startedAt = new Array<number>(ARRIVAL_KID_COUNT).fill(Number.NaN);
const exitAt = new Array<number>(ARRIVAL_KID_COUNT).fill(Number.NaN);
const exitLocal = new Array<{ x: number; z: number } | null>(ARRIVAL_KID_COUNT).fill(null);
const atDoorAt = new Array<number>(ARRIVAL_KID_COUNT).fill(Number.NaN);
const offTheBus = new Array<boolean>(ARRIVAL_KID_COUNT).fill(false);
const last = kids.map((kid) => kid.position.clone());

const frames = Math.ceil(ARRIVAL_DURATION / DT);
for (let index = 0; index < frames; index += 1) {
  const elapsed = index * DT;
  world.update(frame(elapsed, player.position));
  for (let k = 0; k < kids.length; k += 1) {
    const kid = kids[k]!;
    const moved = Math.hypot(kid.position.x - last[k]!.x, kid.position.z - last[k]!.z);
    last[k]!.copy(kid.position);
    if (Number.isNaN(startedAt[k]!) && moved > 1e-3) startedAt[k] = elapsed;
    if (!offTheBus[k]! && !insideFootprint(busRoot, busLocalBox, kid.position)) offTheBus[k] = true;
    if (Number.isNaN(exitAt[k]!) && offTheBus[k]!) {
      exitAt[k] = elapsed;
      // **Where** did they cross the bodywork? In the bus's own frame, against
      // the door's own local position: a child who walks out of the door
      // crosses near it, one who cuts a diagonal from their seat crosses the
      // side wall metres away from it.
      const local = busRoot.worldToLocal(kid.position.clone());
      exitLocal[k] = { x: local.x, z: local.z };
    }
    const from = walks[k]?.route.from;
    if (from && Number.isNaN(atDoorAt[k]!)) {
      if (Math.hypot(kid.position.x - from.x, kid.position.z - from.z) < 0.15) atDoorAt[k] = elapsed;
    }
  }
}

console.log('  n   delay   aisle    door   exit   (door = delay + aisle)');
const rows: { delay: number; aisle: number; door: number; exit: number }[] = [];
for (let k = 0; k < ARRIVAL_KID_COUNT; k += 1) {
  const delay = startedAt[k]!;
  const aisle = walks[k]?.aisleSeconds ?? Number.NaN;
  const door = delay + aisle;
  const exit = exitAt[k]!;
  rows.push({ delay, aisle, door, exit });
  console.log(
    `${String(k).padStart(3)}  ${delay.toFixed(2).padStart(6)}  ${aisle.toFixed(2).padStart(6)}  ` +
      `${door.toFixed(2).padStart(6)}  ${exit.toFixed(2).padStart(6)}   reachedDrop ${atDoorAt[k]!.toFixed(2)}` +
      `   crossed the bodywork at local ${exitLocal[k] ? `${exitLocal[k]!.x.toFixed(2)}, ${exitLocal[k]!.z.toFixed(2)}` : 'never'}` +
      `   (door is at ${DOOR.x.toFixed(2)}, ${DOOR.z.toFixed(2)}, ${exitLocal[k] ? Math.hypot(exitLocal[k]!.x - DOOR.x, exitLocal[k]!.z - DOOR.z).toFixed(2) : '-'} m away)`,
  );
}

function tightest(values: number[]): { gap: number; at: number } {
  const sorted = values.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  let gap = Infinity;
  let at = -1;
  for (let i = 1; i < sorted.length; i += 1) {
    const d = sorted[i]! - sorted[i - 1]!;
    if (d < gap) {
      gap = d;
      at = i;
    }
  }
  return { gap, at };
}

const doorGap = tightest(rows.map((r) => r.door));
const exitGap = tightest(rows.map((r) => r.exit));
const startGap = tightest(rows.map((r) => r.delay));
console.log('');
console.log(`tightest gap in delay (leaving the seat) : ${startGap.gap.toFixed(3)} s`);
console.log(`tightest gap in door  (reaching the drop): ${doorGap.gap.toFixed(3)} s`);
console.log(`tightest gap in exit  (what check:cat-bus measures): ${exitGap.gap.toFixed(3)} s`);
console.log('');
console.log('aisle seconds in seat order (should be non-decreasing: nearest the door first)');
console.log(rows.map((r) => r.aisle.toFixed(2)).join('  '));
