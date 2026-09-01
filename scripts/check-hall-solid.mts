import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { CollisionWorld } from '../src/world/Collision.ts';
import { CASTLE_HALL, floorX, floorZ } from '../src/world/building/floors.ts';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import {
  BUILDING_BASE_Y,
  LIFT_STAND_X,
  LIFT_DOOR_Z,
  insideInterior,
} from '../src/world/building/layout.ts';
import { INTERIOR_HALF_X, INTERIOR_HALF_Z, PARADE_MEMBER_RADIUS } from '../src/core/constants.ts';
import {
  CASTLE_GREAT_HALL_DECK,
  greatHallFreePlaces,
  greatHallPetPlaces,
  greatHallSolids,
} from '../src/world/building/castleFurniture.ts';
import { registerHallCollision } from '../src/world/building/Building.ts';

/**
 * **The banquet is solid, and she can still walk to a place and sit down.**
 *
 * Jim, on #453: *"Banquet hall looks good but you can walk straight through the
 * tables — they should be solid."* Making them solid is half a fix; the other
 * half is that the hall's whole point is that she can sit and eat, and a
 * collider that walls off a free place turns that action into a tease. Both
 * halves are one question — *what floor can she still reach?* — so they are one
 * check.
 *
 * Can she still walk from the lift to every place she is invited to sit in,
 * now the banquet is solid? And is the banquet actually solid?
 *
 * A flood fill over the hall's floor, at the player's own radius, from where
 * the lift puts her down. **With a control run first**, because a fill that
 * agrees with you for the wrong reason is worse than no fill: if the fill
 * cannot leave the lift alcove it will report every seat unreachable and look
 * exactly like a correct catastrophic finding.
 */

const CELL = 0.2;

/** The hall's collision, built exactly the way `Building` builds it. */
function hallWorld(withBanquet: boolean): CollisionWorld {
  const collision = new CollisionWorld();
  const west = floorX(CASTLE_HALL, -INTERIOR_HALF_X);
  const east = floorX(CASTLE_HALL, INTERIOR_HALF_X);
  const north = floorZ(CASTLE_HALL, -INTERIOR_HALF_Z);
  const south = floorZ(CASTLE_HALL, INTERIOR_HALF_Z);
  collision.addWall(west, north, east, north, 0.3);
  collision.addWall(west, north, west, south, 0.3);
  collision.addWall(west, south, east, south, 0.3);
  collision.addWall(east, north, east, floorZ(CASTLE_HALL, LIFT_DOOR_Z - 1.4), 0.3);
  collision.addWall(east, floorZ(CASTLE_HALL, LIFT_DOOR_Z + 1.4), east, south, 0.3);
  // **The game's own registration, not a copy of it.** `Building` exports it
  // for exactly this: a check that rebuilt these rectangles itself would keep
  // passing after the real ones changed shape.
  if (withBanquet) registerHallCollision(collision, CASTLE_HALL);
  return collision;
}

/** Every cell of the hall's floor a player-sized body can walk to from the lift. */
function fill(collision: CollisionWorld, radius = PLAYER_RADIUS): Set<string> {
  const startX = floorX(CASTLE_HALL, LIFT_STAND_X);
  const startZ = floorZ(CASTLE_HALL, LIFT_DOOR_Z);
  const key = (cx: number, cz: number): string => `${cx},${cz}`;
  // **Walkable floor, not merely clear air.** The first draft asked only
  // `isClearCircle`, and its control caught it: the fill walked straight out
  // through the lift doorway and flooded 354516 cells of the empty world
  // outside the shell, so "reachable" would have meant "reachable, possibly by
  // walking through the wall of the castle". Off the plate there is no floor —
  // `WalkSurfaces.sample` drops to the plaza disc — so the plate is the fill's
  // real boundary and `insideInterior` is the function that owns it.
  const clear = (cx: number, cz: number): boolean => {
    const x = startX + cx * CELL;
    const z = startZ + cz * CELL;
    if (!insideInterior(x - CASTLE_HALL.originX, z - CASTLE_HALL.originZ)) return false;
    return collision.isClearCircle(x, z, radius);
  };

  const seen = new Set<string>();
  const queue: [number, number][] = [[0, 0]];
  seen.add(key(0, 0));
  const REACH = Math.ceil(60 / CELL);
  while (queue.length > 0) {
    const [cx, cz] = queue.pop()!;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (Math.abs(nx) > REACH || Math.abs(nz) > REACH) continue;
      const k = key(nx, nz);
      if (seen.has(k)) continue;
      if (!clear(nx, nz)) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  return seen;
}

/** Is a world point within half a cell of somewhere the fill reached? */
function reached(seen: Set<string>, x: number, z: number): boolean {
  const cx = Math.round((x - floorX(CASTLE_HALL, LIFT_STAND_X)) / CELL);
  const cz = Math.round((z - floorZ(CASTLE_HALL, LIFT_DOOR_Z)) / CELL);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dz = -1; dz <= 1; dz += 1) {
      if (seen.has(`${cx + dx},${cz + dz}`)) return true;
    }
  }
  return false;
}

let bad = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) bad += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${line}`);
};

const solids = greatHallSolids(CASTLE_GREAT_HALL_DECK);
const free = greatHallFreePlaces(CASTLE_GREAT_HALL_DECK);
const pets = greatHallPetPlaces(CASTLE_GREAT_HALL_DECK);
console.log(`banquet: ${solids.length} solids, ${free.length} free places, ${pets.length} pet places\n`);

// **#453 itself.** One run per feast row plus the pets' table: fewer than two
// solids means the hall is back to furniture you walk through, which is the
// state Jim reported and the whole reason this file exists.
say(
  solids.length >= 2,
  `the banquet registers ${solids.length} solid footprints (a run each, plus the pets' table)`,
);

// ---------------------------------------------------------------------------
// CONTROL. Run the fill on a hall with NO banquet collision at all. If the
// instrument is sound, every free place is reachable and every table centre is
// too — because without colliders there is nothing to stop her. A control that
// fails means the fill is measuring the alcove, the wall or the grid, and
// nothing it says about the real run can be believed.
// ---------------------------------------------------------------------------
console.log('CONTROL — the same fill on a hall with no banquet collision:');
{
  const seen = fill(hallWorld(false));
  say(seen.size > 2000, `the fill leaves the lift alcove: ${seen.size} cells reached`);
  say(
    free.every((seat) => reached(seen, floorX(CASTLE_HALL, seat.standX), floorZ(CASTLE_HALL, seat.standZ))),
    'every free place\'s stand spot is reachable with nothing in the way',
  );
  say(
    solids.every((solid) => reached(seen, floorX(CASTLE_HALL, solid.x), floorZ(CASTLE_HALL, solid.z))),
    'the middle of every table is reachable with nothing in the way (it must be, or the fill is wrong)',
  );
  // And the fill must be able to say NO. Outside the shell there is no floor.
  say(
    !reached(seen, floorX(CASTLE_HALL, 0), floorZ(CASTLE_HALL, INTERIOR_HALF_Z + 4)),
    'a point outside the south wall is NOT reachable',
  );
}

// ---------------------------------------------------------------------------
// THE REAL RUN.
// ---------------------------------------------------------------------------
console.log('\nWITH the banquet solid:');
{
  const seen = fill(hallWorld(true));
  say(seen.size > 2000, `the fill still leaves the lift alcove: ${seen.size} cells reached`);

  for (const [i, seat] of free.entries()) {
    const sx = floorX(CASTLE_HALL, seat.standX);
    const sz = floorZ(CASTLE_HALL, seat.standZ);
    say(reached(seen, sx, sz), `free place ${i} — she can walk to its stand spot (${seat.standX.toFixed(2)}, ${seat.standZ.toFixed(2)})`);
  }
  // **A companion is 0.22 m, not 0.62 m** — and it does not consult the
  // collision world at all (`ParadeMember` walks a spring to its place), so
  // the question that matters is whether its place is *inside* a solid, not
  // whether a player-sized body could flood-fill to it. The first draft asked
  // at `PLAYER_RADIUS` and failed the pet at the north end of the table, which
  // stands 0.68 m clear of the run's face: no room for a child, all the room
  // in the world for a rabbit.
  const petSeen = fill(hallWorld(true), PARADE_MEMBER_RADIUS);
  for (const [i, place] of pets.entries()) {
    say(
      reached(petSeen, floorX(CASTLE_HALL, place.x), floorZ(CASTLE_HALL, place.z)),
      `pet place ${i} — a companion can still reach its bowl`,
    );
  }
  for (const [i, solid] of solids.entries()) {
    say(
      !reached(seen, floorX(CASTLE_HALL, solid.x), floorZ(CASTLE_HALL, solid.z)),
      `solid ${i} — the middle of it is NOT walkable any more`,
    );
  }
}

// ---------------------------------------------------------------------------
// And march a body at a run from every bearing, per CLAUDE.md's "probe it from
// outside, from many bearings" rule — a fill on a lattice can miss a hole
// narrower than its own cell.
// ---------------------------------------------------------------------------
console.log('\nMARCHED at every solid from 48 bearings each:');
if (solids.length === 0) {
  say(false, 'there is nothing to march at — the banquet registered nothing solid');
} else {
  const collision = hallWorld(true);
  for (const [i, target] of solids.entries()) {
    const tx = floorX(CASTLE_HALL, target.x);
    const tz = floorZ(CASTLE_HALL, target.z);
    let inside = 0;
    for (let b = 0; b < 48; b += 1) {
      const angle = (b / 48) * Math.PI * 2;
      const p = new Vector3(tx + Math.cos(angle) * 12, BUILDING_BASE_Y, tz + Math.sin(angle) * 12);
      // 0.12 m a step rather than 0.01: a gap you cannot walk into at a
      // crawl you may still tunnel into at a real stride. See CLAUDE.md.
      for (let step = 0; step < 200; step += 1) {
        collision.resolveMovement(
          p,
          -Math.cos(angle) * 0.12,
          -Math.sin(angle) * 0.12,
          PLAYER_RADIUS,
          0,
          1 / 60,
        );
      }
      if (
        Math.abs(p.x - tx) < target.halfX - PLAYER_RADIUS &&
        Math.abs(p.z - tz) < target.halfZ - PLAYER_RADIUS
      ) {
        inside += 1;
      }
    }
    say(inside === 0, `solid ${i} — ${inside} of 48 bearings got inside it`);
  }
}

console.log(bad === 0 ? '\nAll clauses passed.' : `\n${bad} clause(s) FAILED.`);
process.exit(bad === 0 ? 0 : 1);
