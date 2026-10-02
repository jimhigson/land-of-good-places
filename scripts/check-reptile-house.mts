/**
 * **`check:reptile-house` — the Reptile House is solid, walkable, and nobody
 * can get stuck in it.**
 *
 * ```
 * pnpm run check:reptile-house
 * REPTILE_CHECK_REMOVE=lagoon pnpm run check:reptile-house   # prove it red
 * ```
 *
 * Built on the real `World` (`park-harness.mts`), so every number here is
 * measured off the colliders the game registers, never off a description of
 * them. In order, with a **control on every instrument before it is trusted**
 * (CLAUDE.md: two agents got clean, decisive, entirely wrong answers from
 * flood fills that were measuring the wrong thing):
 *
 *  1. The fill instrument sees a sealed pocket (a hollow rectangle in a world
 *     of its own) and, in a hall with nothing but its four walls, reaches the
 *     middle of the lagoon.
 *  2. A flood fill at the player's radius from the arrival reaches every
 *     keep-out — arrival, doorway, every stand spot, the inside of the Hollow
 *     Log, every path node, the exit — and **no clear cell on the plate is
 *     unreachable**: a pocket a child could land in is a hard failure.
 *  3. Every path keeps its width: a player disc sweeps every `PATHS` polyline
 *     and the clear radius at every node is at least 1.5 m.
 *  4. A player-sized body marched at every enclosure, case, planter, post
 *     and the stall from sixteen bearings at 5 cm and at `PLAYER_LONGEST_STEP`
 *     never gets inside it.
 *  5. The 1.4 m enclosure walls hold a body at jump height; a wall at 1.2 m
 *     would not (control).
 *  6. The exterior: the shell is solid from thirty-two bearings but the
 *     doorway's own cone (`check:hotel` probe 22).
 *  7. The doors work both ways at a sprint stride, through the real
 *     `ReptileHouse` on the real harness.
 *  8. Every drawn solid taller than 0.6 m under the hall root has a collider
 *     at its middle, bar a named walk-through list.
 *  9. Every animal is inside its own enclosure.
 *
 * **Proven red before trusted green**, on 2 October 2026 with
 * `REPTILE_CHECK_REMOVE=lagoon` (the lagoon's one stadium collider removed
 * after the build): clause 2 reported the lagoon's middle reachable and the
 * drawn lagoon wall with no collider, clause 4 marched inside it from 16
 * bearings, clause 9 put Snappy outside any enclosure. The geometry that was
 * proved against is `layout.ts`'s `EXHIBIT_PLACEMENTS` lagoon stadium
 * (13, −3)→(17, −3) half 3 at origin (600, −600).
 */
import './headless-canvas.mjs';
import { Group, Mesh, Box3, Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { clearsTop, CollisionWorld } from '../src/world/Collision.ts';
import { WalkSurfaces } from '../src/world/building/surfaces.ts';
import { MAX_FRAME_DELTA, PLAYER_LONGEST_STEP, PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';
import { TALLEST_CHILD_HEIGHT } from '../src/art/models/kid.ts';
import { bandCrossed } from '../src/world/tapSpacing.ts';
import { SPACE_REPTILE_FORECOURT, SPACE_REPTILE_HOUSE, spaceAt } from '../src/world/spaces.ts';
import { reptileKeepOuts, segmentDistance } from '../src/world/reptileHouse/props.ts';
import { buildHallShell, facadeToWorld, reptileEntryBand, reptileExitBand, REPTILE_INNER_X, REPTILE_INNER_Z } from '../src/world/reptileHouse/shell.ts';
import { pointInPolygon, distanceToOutline } from '../src/world/reptileHouse/planting.ts';
import {
  BEDS,
  EXHIBIT_PLACEMENTS,
  PATHS,
  REPTILE_ARCH_WIDTH,
  REPTILE_ARRIVAL_X,
  REPTILE_ARRIVAL_Z,
  REPTILE_BACK_WALL_ALONG,
  REPTILE_DOOR_BAND_OUTER,
  REPTILE_DOOR_X,
  REPTILE_ENCLOSURE_WALL_HEIGHT,
  REPTILE_EXIT_BAND_Z,
  REPTILE_HOUSE_ORIGIN_X,
  REPTILE_HOUSE_ORIGIN_Z,
  REPTILE_LOG_CENTRE_X,
  REPTILE_PATH_MIN_CLEAR,
  REPTILE_SHELL_RADIUS,
  STALL_POSITION,
  type ExhibitShape,
  type LocalPoint,
} from '../src/world/reptileHouse/layout.ts';
import type { FrameContext } from '../src/core/types.ts';

const OX = REPTILE_HOUSE_ORIGIN_X;
const OZ = REPTILE_HOUSE_ORIGIN_Z;
const CELL = 0.25;

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${line}`);
};
const note = (line: string): void => {
  process.stderr.write(`  note: ${line}\n`);
};

// ---------------------------------------------------------------------------
// The instrument: a flood fill over the plate at the player's radius.
// ---------------------------------------------------------------------------

interface Fill {
  readonly reached: Set<string>;
  /** Every clear cell on the plate, reached or not. */
  readonly clear: Set<string>;
}

const key = (cx: number, cz: number): string => `${cx},${cz}`;
const cellOf = (x: number, z: number): [number, number] => [Math.round((x - OX) / CELL), Math.round((z - OZ) / CELL)];

/** On the walkable plate — the floor inside the walls, plus the doorway's apron. */
function onPlate(localX: number, localZ: number): boolean {
  if (Math.abs(localX) <= REPTILE_INNER_X && Math.abs(localZ) <= REPTILE_INNER_Z) return true;
  // The doorway, out to the plate's own 0.6 m apron past the wall line.
  return Math.abs(localX - REPTILE_DOOR_X) <= 1.3 && localZ > REPTILE_INNER_Z && localZ <= REPTILE_INNER_Z + 0.85;
}

function fill(collision: CollisionWorld, fromX: number, fromZ: number, radius = PLAYER_RADIUS): Fill {
  const clear = new Set<string>();
  const reach = Math.ceil(26 / CELL);
  for (let cx = -reach; cx <= reach; cx += 1) {
    for (let cz = -reach; cz <= reach; cz += 1) {
      const x = OX + cx * CELL;
      const z = OZ + cz * CELL;
      if (!onPlate(x - OX, z - OZ)) continue;
      if (collision.isClearCircle(x, z, radius)) clear.add(key(cx, cz));
    }
  }
  const [sx, sz] = cellOf(fromX, fromZ);
  const reached = new Set<string>();
  const queue: [number, number][] = [[sx, sz]];
  if (clear.has(key(sx, sz))) reached.add(key(sx, sz));
  while (queue.length > 0) {
    const [cx, cz] = queue.pop()!;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const k = key(cx + dx, cz + dz);
      if (reached.has(k) || !clear.has(k)) continue;
      reached.add(k);
      queue.push([cx + dx, cz + dz]);
    }
  }
  return { reached, clear };
}

function reached(result: Fill, x: number, z: number): boolean {
  const [cx, cz] = cellOf(x, z);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) if (result.reached.has(key(cx + dx, cz + dz))) return true;
  }
  return false;
}

/** March a body from `from` towards `to` in `step`s; returns where it ended. */
function march(collision: CollisionWorld, from: Vector3, to: Vector3, step: number, travel = 12): Vector3 {
  const p = from.clone();
  const dir = to.clone().sub(from);
  dir.y = 0;
  dir.normalize();
  for (let t = 0; t < travel; t += step) {
    collision.resolveMovement(p, dir.x * step, dir.z * step, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
  }
  return p;
}

function insideShape(shape: ExhibitShape, p: LocalPoint, slack = 0.01): boolean {
  if (shape.kind === 'disc') return Math.hypot(p.x - shape.centre.x, p.z - shape.centre.z) < shape.radius - slack;
  return segmentDistance(shape.a, shape.b, p) < shape.half - slack;
}

function shapeCentre(shape: ExhibitShape): LocalPoint {
  return shape.kind === 'disc' ? shape.centre : { x: (shape.a.x + shape.b.x) / 2, z: (shape.a.z + shape.b.z) / 2 };
}

// ---------------------------------------------------------------------------
// 1. CONTROLS — the instrument, before the building.
// ---------------------------------------------------------------------------
console.log('CONTROL — the fill instrument:');
{
  // A hollow rectangle in an otherwise empty hall: the fill must report its
  // inside as clear-but-unreachable, which is the pocket this whole check
  // exists to find.
  const control = new CollisionWorld();
  buildHallShell(new Group(), control, new WalkSurfaces());
  control.addRectangle(OX, OZ, 3, 3, 0.3);
  const seen = fill(control, OX + REPTILE_ARRIVAL_X, OZ + REPTILE_ARRIVAL_Z);
  const pockets = [...seen.clear].filter((k) => !seen.reached.has(k));
  say(seen.reached.size > 10000, `the fill floods the empty hall: ${seen.reached.size} cells reached`);
  say(pockets.length > 50 && !reached(seen, OX, OZ), `the fill sees a sealed pocket: ${pockets.length} clear cells inside a hollow rectangle are unreachable`);
  say(!seen.clear.has(key(...cellOf(OX, OZ + 30))), 'nothing off the plate counts as floor');

  // And with nothing but the walls, every exhibit's middle is reachable —
  // the fill can say yes as well as no.
  const empty = new CollisionWorld();
  buildHallShell(new Group(), empty, new WalkSurfaces());
  const open = fill(empty, OX + REPTILE_ARRIVAL_X, OZ + REPTILE_ARRIVAL_Z);
  const lagoon = EXHIBIT_PLACEMENTS.find((e) => e.id === 'lagoon')!;
  const lagoonCentre = shapeCentre(lagoon.shape);
  say(reached(open, OX + lagoonCentre.x, OZ + lagoonCentre.z), 'with no exhibit colliders the lagoon\'s middle is reachable');
  say(reached(open, OX, OZ), "with no exhibit colliders Noodle's rock is reachable");
}

// ---------------------------------------------------------------------------
// The real building.
// ---------------------------------------------------------------------------
const { world, scene } = quietly(() => buildHeadlessPark());
const house = world.reptileHouse;
const collision = world.collision;
const remove = process.env['REPTILE_CHECK_REMOVE'];
if (remove) {
  const victim = house.solids.find((solid) => solid.what.includes(remove));
  if (!victim) throw new Error(`REPTILE_CHECK_REMOVE=${remove} names no solid`);
  if (typeof victim.handle === 'number') collision.removeCircle(victim.handle);
  else collision.removeWall(victim.handle);
  note(`REMOVED ${victim.what} on purpose — this run must go red`);
}
collision.setPlayBounds({ radius: 1e6, distanceToEdge: () => 1e6 });

console.log(`\nREACHABILITY — ${house.solids.length} solids registered by the hall:`);
{
  const seen = fill(collision, OX + REPTILE_ARRIVAL_X, OZ + REPTILE_ARRIVAL_Z);
  say(seen.reached.size > 5000, `the fill leaves the arrival: ${seen.reached.size} cells reached`);
  const keepOuts = reptileKeepOuts();
  let unreachable = 0;
  for (const spot of keepOuts) {
    if (!reached(seen, OX + spot.x, OZ + spot.z)) {
      unreachable += 1;
      say(false, `${spot.what} at (${spot.x}, ${spot.z}) is not reachable from the arrival`);
    }
  }
  say(unreachable === 0, `every keep-out is reachable: ${keepOuts.length - unreachable} of ${keepOuts.length}`);
  say(reached(seen, OX + REPTILE_LOG_CENTRE_X, OZ), 'the inside of the Hollow Log is reachable');
  say(reached(seen, OX + REPTILE_DOOR_X, OZ + REPTILE_EXIT_BAND_Z), "the exit band's centre is reachable");
  for (const exhibit of EXHIBIT_PLACEMENTS) {
    const centre = shapeCentre(exhibit.shape);
    say(!reached(seen, OX + centre.x, OZ + centre.z), `${exhibit.id}'s middle is NOT reachable`);
  }
  // The keeper's pocket behind the counter.
  const yaw = (45 * Math.PI) / 180;
  const keeperX = STALL_POSITION.x + Math.cos(yaw) * -0.9 + Math.sin(yaw) * 0.45;
  const keeperZ = STALL_POSITION.z - Math.sin(yaw) * -0.9 + Math.cos(yaw) * 0.45;
  say(!reached(seen, OX + keeperX, OZ + keeperZ), "the keeper's pocket behind the counter is NOT reachable");
  const pockets = [...seen.clear].filter((k) => !seen.reached.has(k));
  if (pockets.length > 0) {
    const sample = pockets.slice(0, 6).map((k) => {
      const [cx, cz] = k.split(',').map(Number) as [number, number];
      return `(${(cx * CELL).toFixed(2)}, ${(cz * CELL).toFixed(2)})`;
    });
    say(false, `${pockets.length} clear cell(s) on the plate are unreachable — a pocket a child could be stuck in: ${sample.join(' ')}…`);
  } else {
    say(true, `no pockets: every one of the ${seen.clear.size} clear cells on the plate is reachable`);
  }
}

console.log('\nPATH WIDTHS — a player disc swept along every path, then grown at every node:');
{
  let stations = 0;
  let blocked = 0;
  for (const path of PATHS) {
    for (let i = 0; i + 1 < path.points.length; i += 1) {
      const a = path.points[i]!;
      const b = path.points[i + 1]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s <= length; s += CELL) {
        const t = length === 0 ? 0 : s / length;
        const x = OX + a.x + (b.x - a.x) * t;
        const z = OZ + a.z + (b.z - a.z) * t;
        stations += 1;
        if (!collision.isClearCircle(x, z, PLAYER_RADIUS)) {
          blocked += 1;
          if (blocked <= 5) say(false, `path '${path.id}' is blocked at (${(x - OX).toFixed(2)}, ${(z - OZ).toFixed(2)})`);
        }
      }
    }
    for (const node of path.points) {
      let radius = PLAYER_RADIUS;
      while (radius < 3 && collision.isClearCircle(OX + node.x, OZ + node.z, radius + 0.05)) radius += 0.05;
      if (radius < REPTILE_PATH_MIN_CLEAR / 2) {
        say(false, `path '${path.id}' node (${node.x}, ${node.z}) has only ${(radius * 2).toFixed(2)} m clear (rule: ${REPTILE_PATH_MIN_CLEAR})`);
      }
    }
  }
  say(blocked === 0, `${stations} stations swept on ${PATHS.length} paths, ${blocked} blocked`);
}

console.log('\nMARCHED at every solid from 16 bearings, at 5 cm and at the sprint stride:');
{
  let marches = 0;
  let got = 0;
  for (const exhibit of EXHIBIT_PLACEMENTS) {
    const centre = shapeCentre(exhibit.shape);
    let inside = 0;
    for (let b = 0; b < 16; b += 1) {
      const angle = (b / 16) * Math.PI * 2;
      for (const step of [0.05, PLAYER_LONGEST_STEP]) {
        marches += 1;
        const from = new Vector3(OX + centre.x + Math.cos(angle) * 9, 0, OZ + centre.z + Math.sin(angle) * 9);
        const end = march(collision, from, new Vector3(OX + centre.x, 0, OZ + centre.z), step);
        if (insideShape(exhibit.shape, { x: end.x - OX, z: end.z - OZ })) inside += 1;
      }
    }
    got += inside;
    say(inside === 0, `${exhibit.id} — ${inside} of 32 marches got inside it`);
  }
  for (const bed of BEDS) {
    let deepest = 0;
    const targets = bed.outline;
    for (let b = 0; b < 12; b += 1) {
      const target = targets[b % targets.length]!;
      const centre = targets.reduce((acc, p) => ({ x: acc.x + p.x / targets.length, z: acc.z + p.z / targets.length }), { x: 0, z: 0 });
      const angle = (b / 12) * Math.PI * 2;
      for (const step of [0.05, PLAYER_LONGEST_STEP]) {
        marches += 1;
        const from = new Vector3(OX + centre.x + Math.cos(angle) * 14, 0, OZ + centre.z + Math.sin(angle) * 14);
        const end = march(collision, from, new Vector3(OX + target.x, 0, OZ + target.z), step, 16);
        const local = { x: end.x - OX, z: end.z - OZ };
        if (pointInPolygon(local, bed.outline)) deepest = Math.max(deepest, distanceToOutline(local, bed.outline));
      }
    }
    // The disc tiling covers to within a disc's fringe of the drawn edge.
    say(deepest < 0.45, `bed '${bed.id}' — deepest a body got into it: ${deepest.toFixed(2)} m (limit 0.45)`);
  }
  // The walls: from inside, at 12 stations a side, nobody leaves the plate but through the door.
  let escaped = 0;
  for (let i = 0; i < 12; i += 1) {
    const t = -0.9 + (1.8 * i) / 11;
    for (const [from, to] of [
      [new Vector3(OX + t * REPTILE_INNER_X, 0, OZ - 10), new Vector3(OX + t * REPTILE_INNER_X, 0, OZ - 30)],
      [new Vector3(OX + t * REPTILE_INNER_X, 0, OZ + 8), new Vector3(OX + t * REPTILE_INNER_X, 0, OZ + 30)],
      [new Vector3(OX - 10, 0, OZ + t * REPTILE_INNER_Z), new Vector3(OX - 30, 0, OZ + t * REPTILE_INNER_Z)],
      [new Vector3(OX + 10, 0, OZ + t * REPTILE_INNER_Z), new Vector3(OX + 30, 0, OZ + t * REPTILE_INNER_Z)],
    ] as const) {
      marches += 1;
      const end = march(collision, from, to, PLAYER_LONGEST_STEP, 24);
      const lx = end.x - OX;
      const lz = end.z - OZ;
      const throughDoor = Math.abs(lx - REPTILE_DOOR_X) < 1.4 && lz > REPTILE_INNER_Z;
      if ((Math.abs(lx) > REPTILE_INNER_X + 0.05 || Math.abs(lz) > REPTILE_INNER_Z + 0.05) && !throughDoor) escaped += 1;
    }
  }
  say(escaped === 0, `the walls hold: ${escaped} of 48 marches left the plate other than through the door`);
  note(`${marches} marches in all, ${got} got inside an exhibit`);
}

console.log('\nHOP — the 1.4 m walls hold a body at jump height:');
{
  // The control first: a 1.2 m wall would not.
  const probe = new Vector3(0, JUMP_APEX_HEIGHT, 0);
  const low = new CollisionWorld();
  low.addCircle(0, 0, 2.4, JUMP_APEX_HEIGHT - 0.08, false, true);
  probe.set(5, JUMP_APEX_HEIGHT, 0);
  const lowEnd = march(low, probe, new Vector3(0, 0, 0), 0.1, 6);
  say(Math.hypot(lowEnd.x, lowEnd.z) < 2.4, `CONTROL: a wall ${(JUMP_APEX_HEIGHT - 0.08).toFixed(2)} m tall lets a body at the apex in (ended ${Math.hypot(lowEnd.x, lowEnd.z).toFixed(2)} m from the centre)`);
  say(!clearsTop(REPTILE_ENCLOSURE_WALL_HEIGHT, JUMP_APEX_HEIGHT), `the engine's own rule holds a body at the apex under a ${REPTILE_ENCLOSURE_WALL_HEIGHT} m wall (clearsTop)`);
  let breached = 0;
  for (const exhibit of EXHIBIT_PLACEMENTS) {
    if (!['snakeGrove', 'tortoiseGarden', 'lagoon', 'iguanaRocks', 'nursery'].includes(exhibit.id)) continue;
    const centre = shapeCentre(exhibit.shape);
    for (let b = 0; b < 12; b += 1) {
      const angle = (b / 12) * Math.PI * 2;
      const from = new Vector3(OX + centre.x + Math.cos(angle) * 8, JUMP_APEX_HEIGHT, OZ + centre.z + Math.sin(angle) * 8);
      const end = march(collision, from, new Vector3(OX + centre.x, JUMP_APEX_HEIGHT, OZ + centre.z), 0.1, 9);
      if (insideShape(exhibit.shape, { x: end.x - OX, z: end.z - OZ })) breached += 1;
    }
  }
  say(breached === 0, `${breached} of 60 jump-height marches got over a ${REPTILE_ENCLOSURE_WALL_HEIGHT} m wall (apex ${JUMP_APEX_HEIGHT.toFixed(2)} m)`);
}

console.log('\nFACADE — the shell is solid from 32 bearings but the doorway:');
{
  const frame = house.facade;
  const facade = REPTILE_SHELL_RADIUS * Math.cos(Math.PI / 16);
  const doorCone = Math.atan2(REPTILE_ARCH_WIDTH / 2, facade);
  const alongOf = (px: number, pz: number): number => (px - frame.x) * Math.sin(frame.yaw) + (pz - frame.z) * Math.cos(frame.yaw);
  const acrossOf = (px: number, pz: number): number =>
    (px - frame.x) * Math.sin(frame.yaw + Math.PI / 2) + (pz - frame.z) * Math.cos(frame.yaw + Math.PI / 2);
  let reachedShell = 0;
  let doorwaysIn = 0;
  let holes = 0;
  for (let i = 0; i < 32; i += 1) {
    const bearing = frame.yaw + (i / 32) * Math.PI * 2;
    const offAxis = Math.abs(Math.atan2(Math.sin(bearing - frame.yaw), Math.cos(bearing - frame.yaw)));
    for (const step of [0.05, PLAYER_LONGEST_STEP]) {
      const probe = new Vector3(frame.x + Math.sin(bearing) * 14, 0, frame.z + Math.cos(bearing) * 14);
      let closest = Infinity;
      let closestNotByDoor = Infinity;
      let byDoor = false;
      for (let travelled = 0; travelled < 18; travelled += step) {
        const fromAlong = alongOf(probe.x, probe.z);
        const fromAcross = acrossOf(probe.x, probe.z);
        collision.resolveMovement(probe, -Math.sin(bearing) * step, -Math.cos(bearing) * step, PLAYER_RADIUS, 0, MAX_FRAME_DELTA);
        const toAlong = alongOf(probe.x, probe.z);
        const toAcross = acrossOf(probe.x, probe.z);
        if (!byDoor && fromAlong >= facade && toAlong < facade) {
          const t = (fromAlong - facade) / (fromAlong - toAlong);
          if (Math.abs(fromAcross + t * (toAcross - fromAcross)) < REPTILE_ARCH_WIDTH / 2) byDoor = true;
        }
        const r = Math.hypot(probe.x - frame.x, probe.z - frame.z);
        closest = Math.min(closest, r);
        if (!byDoor) closestNotByDoor = Math.min(closestNotByDoor, r);
      }
      if (closest < facade + 2.5) reachedShell += 1;
      if (offAxis > doorCone) {
        if (closestNotByDoor < facade - 0.05) {
          holes += 1;
          say(false, `the shell is open ${((offAxis * 180) / Math.PI).toFixed(0)}° off the doorway: a body in ${step.toFixed(2)} m steps got to ${closestNotByDoor.toFixed(2)} m from the centre`);
        }
      } else if (closest < facade) doorwaysIn += 1;
    }
  }
  say(holes === 0, `no bearing off the doorway got inside the ${facade.toFixed(2)} m shell`);
  say(doorwaysIn > 0, `the doorway lets a body in: ${doorwaysIn} marches entered through it`);
  say(reachedShell >= 48, `${reachedShell} of 64 marches reached the shell (the rest met the tail or the sign)`);
  // A sprinter through the door stops on the back wall within two metres.
  const band = reptileEntryBand(frame);
  const start = facadeToWorld(frame, REPTILE_DOOR_BAND_OUTER + 3, 0);
  const probe = new Vector3(start.x, 0, start.z);
  const end = march(collision, probe, new Vector3(frame.x, 0, frame.z), PLAYER_LONGEST_STEP, 8);
  const stoppedAt = alongOf(end.x, end.z);
  say(
    stoppedAt > REPTILE_BACK_WALL_ALONG && stoppedAt < (REPTILE_BACK_WALL_ALONG + REPTILE_DOOR_BAND_OUTER) / 2 + 2,
    `a sprinter through the door stops at ${stoppedAt.toFixed(2)} m along (back wall ${REPTILE_BACK_WALL_ALONG.toFixed(2)} m, band ${band.halfAlong.toFixed(2)} m deep)`,
  );
}

console.log('\nDOORS — both ways, on the real building:');
{
  const probe = {
    position: new Vector3(0, 0, 0),
    previousPosition: new Vector3(0, 0, 0),
    riding: false,
    model: { height: 2.12 },
    teleportTo(x: number, y: number, z: number) {
      probe.position.set(x, y, z);
      probe.previousPosition.set(x, y, z);
    },
  };
  house.attachPlayer(probe as never);
  const context = { dt: 1 / 60, elapsed: 1, playerPosition: probe.position, frame: 1 } as unknown as FrameContext;
  say(house.requestEnterDoor(), '/reptile-house-door puts her outside the door');
  for (let i = 0; i < 70; i += 1) house.update(context);
  say(spaceAt(probe.position.x, probe.position.z) === SPACE_REPTILE_FORECOURT, `she stands on the forecourt (${spaceAt(probe.position.x, probe.position.z)})`);
  say(house.interactZones().some((zone) => zone.id === 'reptile-entrance'), 'the entrance zone is offered from outside');
  // Walk in through the band, at a sprint stride.
  const band = reptileEntryBand(house.facade);
  const outside = facadeToWorld(house.facade, REPTILE_DOOR_BAND_OUTER + 0.3, 0);
  const in1 = facadeToWorld(house.facade, REPTILE_DOOR_BAND_OUTER + 0.3 - PLAYER_LONGEST_STEP, 0);
  say(bandCrossed(band, outside.x, outside.z, in1.x, in1.z), 'a sprint stride across the front band fires it');
  probe.previousPosition.set(outside.x, 0, outside.z);
  probe.position.set(in1.x, 0, in1.z);
  house.update(context);
  for (let i = 0; i < 70; i += 1) house.update(context);
  const local = { x: probe.position.x - OX, z: probe.position.z - OZ };
  const off = Math.hypot(local.x - REPTILE_ARRIVAL_X, local.z - REPTILE_ARRIVAL_Z);
  say(spaceAt(probe.position.x, probe.position.z) === SPACE_REPTILE_HOUSE && house.playerIsInside, 'walking through the front door enters the hall');
  say(off < 0.5, `she arrives ${off.toFixed(2)} m from the arrival (${REPTILE_ARRIVAL_X}, ${REPTILE_ARRIVAL_Z})`);
  say(house.interactZones().length >= 17, `${house.interactZones().length} zones are offered inside`);
  say(world.shopStands().some((stand) => stand.id === 'reptileStall') && world.shopStands().some((stand) => stand.id === 'reptileNursery'), 'both shop stands are found by World.shopStands()');
  // And out again through the exit band.
  const exit = reptileExitBand();
  probe.previousPosition.set(OX + REPTILE_DOOR_X, 0, OZ + REPTILE_EXIT_BAND_Z - 1.2);
  probe.position.set(OX + REPTILE_DOOR_X, 0, OZ + REPTILE_EXIT_BAND_Z - 1.2 + PLAYER_LONGEST_STEP);
  say(bandCrossed(exit, probe.previousPosition.x, probe.previousPosition.z, probe.position.x, probe.position.z), 'a sprint stride across the exit band fires it');
  house.update(context);
  for (let i = 0; i < 70; i += 1) house.update(context);
  say(!house.playerIsInside && spaceAt(probe.position.x, probe.position.z) === SPACE_REPTILE_FORECOURT, 'walking out through the exit leaves to the forecourt');
  say(collision.isClearCircle(probe.position.x, probe.position.z, PLAYER_RADIUS), 'she lands on clear ground outside the door');
  // Back in by the deep link, at a chosen spot.
  say(house.requestEnter({ x: REPTILE_LOG_CENTRE_X, z: 0, facing: 90 }), '/reptile-house?at= enters at a spot');
  for (let i = 0; i < 70; i += 1) house.update(context);
  say(Math.abs(probe.position.x - OX - REPTILE_LOG_CENTRE_X) < 0.01 && Math.abs(probe.position.z - OZ) < 0.01, 'and she stands exactly there, inside the log');
}

console.log('\nDRAWN ⇒ SOLID — every tall solid mesh under the hall root has a collider at its middle:');
{
  // Things drawn with no collider at their middle on purpose, by name, with
  // the reason. Anything whose lowest point is above the tallest hat is
  // overhead and never met at all, so it is skipped before this list.
  const walkThrough: readonly [string, string][] = [
    ['shopkeeper', 'behind the counter, in the pocket the fill proved unreachable'],
    ['reptile.wall', 'the walls are colliders themselves and the probe above marches at them'],
    ['rp-log-hollow', "a walk-through: its middle is the Log Walk, its walls are the two capsules marched above"],
    ['rs-awning-posts', "both posts stand inside the counter's capsule; the pair's middle is the sealed pocket"],
  ];
  let checked = 0;
  let naked = 0;
  const box = new Box3();
  house.hallRoot.updateWorldMatrix(true, true);
  house.hallRoot.traverse((object) => {
    if (!(object instanceof Mesh) || !object.castShadow || !object.visible) return;
    if ((object as Mesh & { isInstancedMesh?: boolean }).isInstancedMesh) return;
    box.setFromObject(object);
    const height = box.max.y - box.min.y;
    if (height < 0.6 || !Number.isFinite(height)) return;
    if (box.min.y > TALLEST_CHILD_HEIGHT) return;
    let ancestor: typeof object.parent = object;
    let name = object.name;
    while (ancestor) {
      name = `${ancestor.name}/${name}`;
      ancestor = ancestor.parent;
      if (ancestor === house.hallRoot) break;
    }
    if (walkThrough.some(([prefix]) => name.includes(prefix))) return;
    checked += 1;
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    if (collision.isClearCircle(cx, cz, 0.1)) {
      naked += 1;
      if (naked <= 8) say(false, `${name} (${height.toFixed(2)} m tall) has no collider at (${(cx - OX).toFixed(2)}, ${(cz - OZ).toFixed(2)})`);
    }
  });
  say(naked === 0, `${checked} tall drawn solids checked, ${naked} with no collider`);
  note(`walk-through list: ${walkThrough.map(([prefix, why]) => `${prefix} (${why})`).join('; ')}`);
}

console.log('\nANIMALS — every one inside its own enclosure:');
{
  const spots = house.animalSpots();
  let outside = 0;
  for (const spot of spots) {
    const exhibit = EXHIBIT_PLACEMENTS.find((e) => e.id === spot.id);
    if (!exhibit || !insideShape(exhibit.shape, spot, -0.3)) {
      outside += 1;
      say(false, `${spot.id}'s animal at (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}) is outside its enclosure`);
    }
  }
  say(spots.length >= 15 && outside === 0, `${spots.length} animals measured, ${outside} outside`);
}

console.log('\nHOUSEKEEPING:');
{
  let lights = 0;
  house.hallRoot.traverse((object) => {
    if ((object as { isLight?: boolean }).isLight) lights += 1;
  });
  say(lights >= 8, `${lights} lights under the hall root`);
  say(spaceAt(OX, OZ) === SPACE_REPTILE_HOUSE, `spaceAt the hall origin is '${spaceAt(OX, OZ)}'`);
  say(scene.children.includes(house.hallRoot) && scene.children.includes(house.forecourtRoot), 'both roots are in the scene');
  note(`${EXHIBIT_PLACEMENTS.length} exhibits probed, ${BEDS.length} beds marched, ${PATHS.length} paths swept, facade marched on the forecourt (no plot yet)`);
}

console.log(bad === 0 ? '\nAll clauses passed.' : `\n${bad} clause(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
