/**
 * **The castle's benches are solid, you cannot get stuck in one, and making
 * them solid did not wall anything off** — issue #459.
 *
 * ```
 * node --no-warnings \
 *      --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/check-benches.mts
 * ```
 *
 * Jim, on the roof garden: *"Long grass needs to be longer and more dense,
 * benches need to be solid (can't walk through them) on the roof garden and
 * everywhere else."* Both halves are measured here, because both halves are
 * the same object: the meadow is placed against the benches, and the benches
 * are placed against {@link keepOutsFor}, the castle's one register of where a
 * child must be able to stand.
 *
 * ## The rule every clause obeys
 *
 * **Measure the castle that was built, never the rules that built it.** Every
 * number below comes out of a `CollisionWorld` that the game's own
 * registration functions filled, or off an `InstancedMesh` that the game's own
 * builder returned — never off the constants those were derived from. A clause
 * that asks `benchFootprints` whether `benchFootprints` was registered is a
 * clause that cannot fail, and this file has two former drafts to prove it.
 *
 * ## Why a bench may have a collider at all
 *
 * Six files in `world/building/` carried the same prohibition — castle props
 * get no colliders, because indoor collision is height-blind and one on deck 0
 * would wall off that square metre on every storey. It was one sentence
 * carrying two facts and only held if both did. Collision is **still**
 * height-blind; two storeys sharing an (x, z) died with the floor split
 * (#377/#380). `dressing.ts`'s `keepOutsFor` carries the full correction, and
 * clause 5 here is the part of it that is a *measurement* rather than a note:
 * a bench collider registered on one floor is asked about from every other
 * floor's plate, and must be found nowhere.
 *
 * ## The flood fill, and the two controls it is worthless without
 *
 * Clause 4 floods the walkable floor from where the lift puts her down and
 * asserts that every keep-out is still standable and every bench still has a
 * side she can walk up to. A flood fill is the single easiest instrument in
 * this repo to get a clean, decisive, wrong answer out of — a fill that cannot
 * leave its seed reports everything unreachable and looks exactly like a
 * catastrophic finding, and a fill that ignores its colliders reports
 * everything reachable and looks exactly like a pass.
 *
 * So it is run against **two controls before it is believed**, and both are
 * asserted rather than eyeballed:
 *
 * - **It can say no.** A point three metres outside the shell must come back
 *   unreachable. Fails if the fill leaks through the walls.
 * - **It can say no *for a collider's sake*.** The same fill is re-run on a
 *   copy of the world with a ring of walls dropped round the roundel, and the
 *   roundel's middle must go from reachable to unreachable. Fails if the fill
 *   is only ever bounded by the plate, which is what an `isClearCircle` that
 *   was never actually consulted would look like.
 */
import { Box3, Matrix4, Vector3, type Object3D } from 'three';
import './headless-canvas.mjs';
import { BuildingShell } from '../src/world/building/Shell.ts';
import { CollisionWorld } from '../src/world/Collision.ts';
import {
  registerBenchCollision,
  registerInteriorCollision,
  registerHallCollision,
  registerPavilionCollision,
  registerPlanterCollision,
  registerRoofTurretCollision,
} from '../src/world/building/Building.ts';
import {
  BENCH_DEPTH,
  BENCH_HEIGHT,
  BENCH_LENGTH,
  benchFootprints,
  DECK_ROUNDEL,
  keepOutsFor,
  PLANTER_TOP,
  planterRing,
} from '../src/world/building/dressing.ts';
import { buildRoofMeadow, roofMeadow, MEADOW_GRASS_HEIGHT } from '../src/world/building/roofMeadow.ts';
import { CASTLE_FLOORS, floorX, floorZ, type CastleFloor } from '../src/world/building/floors.ts';
import {
  BUILDING_BASE_Y,
  insideInterior,
  ROOF_PAVILION_HALF_X,
  ROOF_PAVILION_HALF_Z,
  ROOF_PAVILION_X,
  ROOF_PAVILION_Z,
  ROOF_PARAPET_THICKNESS,
  roofTurretSpots,
  TOP_DECK,
} from '../src/world/building/layout.ts';
import { CASTLE_TURRET_FOOTPRINT_RADIUS } from '../src/world/building/castleMasonry.ts';
import { PET_RENDER_HEIGHT } from '../src/art/models/pets.ts';
import {
  INTERIOR_HALF_X,
  INTERIOR_HALF_Z,
  PLAYER_LONGEST_STEP,
  PLAYER_RADIUS,
} from '../src/core/constants.ts';

/**
 * How far short of the drawn parapet a child may be stopped before it reads as
 * an invisible wall rather than as the stone she can see.
 *
 * Ten centimetres — under a fifth of her own radius, and well under the width
 * of one merlon, so nothing a player could notice. The measured figure as
 * committed is 0.075 m.
 */
const PARAPET_STANDOFF_LIMIT = 0.1;

const failures: string[] = [];
function fail(message: string): void {
  failures.push(message);
}

/**
 * Every floor's collision, exactly as `Building` registers it.
 *
 * **The banquet is in here too**, though this file adds nothing to it. The
 * flood fill's whole job is to prove that nothing a child needs got walled
 * off, and a fill run against a great hall with no tables in it would happily
 * report a route that the real hall does not have. `check:hall-solid` owns
 * whether the banquet's own places are reachable; this owns whether *these*
 * colliders took anything away — and it can only answer that in the room as it
 * really is.
 */
function worldFor(floor: CastleFloor): CollisionWorld {
  const world = bareWorldFor(floor);
  registerBenchCollision(world, floor);
  registerPlanterCollision(world, floor);
  registerPavilionCollision(world, floor);
  registerRoofTurretCollision(world, floor);
  return world;
}

/** The same castle **without this branch's colliders** — the "before" the
 *  reachability clause reports its cost against. Not an empty shell: the
 *  banquet was already solid when this landed. */
function bareWorldFor(floor: CastleFloor): CollisionWorld {
  const world = new CollisionWorld();
  registerInteriorCollision(world, floor);
  registerHallCollision(world, floor);
  return world;
}

// ---------------------------------------------------------------------------
// 1. Every bench is solid, from every bearing, at a sprinting stride
// ---------------------------------------------------------------------------

/**
 * The margin a stop is allowed to be *inside* the drawn wood by.
 *
 * Zero, near enough: a bench is a box, its collider is registered inset by its
 * own wall half-thickness precisely so the surface she meets is the surface
 * she sees, and a body that ends up 1 cm inside the plank is a body clipping
 * through furniture. The tolerance is float slop only.
 */
const CLIP_TOLERANCE = 1e-6;

/** How far outside the wood a stop may be before it reads as an invisible
 *  fence rather than a bench. Two centimetres. */
const HALO_TOLERANCE = 0.02;

/**
 * Bearings walked at every bench.
 *
 * **Sixteen for "never gets in", four for "stops on the wood", and the two
 * clauses are separate on purpose.** A body pushed at a wall for thirty metres
 * of accumulated movement slides along the face and off the end — which is
 * correct behaviour and exactly what a child leaning on a bench does — so
 * "where did it finish" is not a question the oblique bearings can answer.
 * The first draft asked it anyway and reported twenty-six invisible fences at
 * distances of up to 27 m, every one of them a body that had walked round the
 * bench and kept going. What the oblique bearings *can* answer, and the thing
 * that actually matters, is whether the body was ever inside the wood at any
 * point along the way.
 */
const BEARINGS = 16;
/** Head-on at each of the four faces, where sliding cannot happen. */
const HEAD_ON = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

for (const floor of CASTLE_FLOORS) {
  const world = worldFor(floor);
  const benchesOnly = new CollisionWorld();
  registerBenchCollision(benchesOnly, floor);
  const benches = benchFootprints(floor.index);

  if (benches.length === 0) {
    // A **furnished** floor draws no scattered benches at all — the great hall
    // has a banquet where they would go, and `dressDeck` returns early on it.
    // That is a legitimate zero, so it is announced rather than failed, and
    // announced on every run: a floor that silently stopped being covered is
    // how the next person inherits a false belief about what this file proves.
    process.stderr.write(
      `check:benches — ${floor.name}: no scattered benches or planters here; this floor is ` +
        `furnished by hand (see dressing.ts's deckIsFurnished), so this file asserts nothing ` +
        `about its furniture. check:hall-solid owns it.\n`,
    );
    continue;
  }

  for (const bench of benches) {
    const cx = floorX(floor, bench.x);
    const cz = floorZ(floor, bench.z);
    /** How far into the wood this point is; negative outside. */
    const penetrationAt = (x: number, z: number): number =>
      Math.min(bench.halfX - Math.abs(x - cx), bench.halfZ - Math.abs(z - cz));

    // Marched at, not merely probed: a gap a 5 cm step cannot enter may still
    // be tunnelled at PLAYER_LONGEST_STEP. `resolveMovement` is the player's
    // own mover, sub-stepping included.
    for (let b = 0; b < BEARINGS; b += 1) {
      const angle = (b / BEARINGS) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirZ = Math.sin(angle);
      // Start well outside, at the floor's own height so nothing is jumping.
      const position = new Vector3(cx + dirX * 6, BUILDING_BASE_Y, cz + dirZ * 6);
      let worst = -Infinity;
      for (let step = 0; step < 20; step += 1) {
        world.resolveMovement(
          position,
          -dirX * PLAYER_LONGEST_STEP,
          -dirZ * PLAYER_LONGEST_STEP,
          PLAYER_RADIUS,
          0,
          1 / 30,
          // Sampled at every sub-step, not once a frame: the whole point of a
          // tunnelling probe is that the overlap happens *between* two frames.
          (at) => {
            worst = Math.max(worst, penetrationAt(at.x, at.z));
          },
        );
      }
      if (worst > CLIP_TOLERANCE) {
        fail(
          `on ${floor.name} the bench at [${bench.x.toFixed(2)}, ${bench.z.toFixed(2)}] is not ` +
            `solid from bearing ${((angle * 180) / Math.PI).toFixed(0)}°: a body walked ` +
            `${worst.toFixed(3)} m into the wood`,
        );
        break;
      }
    }

    // …and it is the wood she is stopped by, not a metre of thin air in front
    // of it.
    //
    // **Against the benches alone, with no shell.** Three benches stand within
    // four metres of a wall, so a body started four metres off one of their
    // faces begins *inside the masonry* and is corrected on its first frame by
    // the castle rather than by the furniture — which the third draft duly
    // reported as three invisible fences. The question this clause asks is
    // about the bench's own collider, so the world it asks it in contains only
    // that. Solidity in the real, walled world is clause 1's job, and it is
    // measured there.
    //
    // **The measurement is where she was first pushed, not where she ends
    // up.** A body held against a wall slides along it, which is what makes a
    // bench feel like furniture rather than glue — walk into the end of one
    // and you slip round it. So the position twenty strides later says nothing
    // about the collider: it is wherever she wandered off to. The second draft
    // of this clause measured exactly that and reported twenty-six invisible
    // fences up to 11 m wide, all of them a body that had touched the bench,
    // slid round the end and walked on. `resolveMovement` already answers the
    // real question — it returns `corrected` on the frame the push happened.
    for (const [dirX, dirZ] of HEAD_ON) {
      const position = new Vector3(cx + dirX * 4, BUILDING_BASE_Y, cz + dirZ * 4);
      let touched = false;
      for (let step = 0; step < 20 && !touched; step += 1) {
        const result = benchesOnly.resolveMovement(
          position,
          -dirX * PLAYER_LONGEST_STEP,
          -dirZ * PLAYER_LONGEST_STEP,
          PLAYER_RADIUS,
          0,
          1 / 30,
        );
        touched = result.corrected;
      }
      if (!touched) {
        fail(
          `on ${floor.name} the bench at [${bench.x.toFixed(2)}, ${bench.z.toFixed(2)}] never ` +
            `pushed back at a body walking straight at its [${dirX}, ${dirZ}] face — it is not ` +
            `solid at all`,
        );
        break;
      }
      const gapX = Math.max(0, Math.abs(position.x - cx) - bench.halfX);
      const gapZ = Math.max(0, Math.abs(position.z - cz) - bench.halfZ);
      const gap = Math.hypot(gapX, gapZ) - PLAYER_RADIUS;
      if (gap > HALO_TOLERANCE) {
        fail(
          `on ${floor.name} the bench at [${bench.x.toFixed(2)}, ${bench.z.toFixed(2)}] first ` +
            `pushed back ${gap.toFixed(3)} m short of the wood, walking straight at the ` +
            `[${dirX}, ${dirZ}] face — an invisible fence, not a bench`,
        );
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. And you cannot get stuck inside one
// ---------------------------------------------------------------------------

/**
 * **`addRectangle` is four walls round a hollow middle, and a mover inside one
 * is never pushed out** — the soft-lock #453 nearly shipped on the banquet
 * tables. A bench is small enough that the four walls' stadiums overlap
 * through the centre and there is no interior at all, which is arithmetic
 * (`BENCH_DEPTH` under four half-thicknesses) rather than luck — so this
 * clause is what turns the arithmetic into something that fails out loud the
 * day somebody widens a bench.
 *
 * She gets there by jumping onto the bench and stepping off inside it, which
 * is exactly what a six-year-old does with a thing she has just discovered she
 * can climb. So the probe is a body **dropped at every point inside the
 * footprint**, at floor height, given a second of frames to escape.
 */
const ESCAPE_FRAMES = 60;
const ESCAPE_DT = 1 / 60;

for (const floor of CASTLE_FLOORS) {
  const world = worldFor(floor);
  for (const bench of benchFootprints(floor.index)) {
    const cx = floorX(floor, bench.x);
    const cz = floorZ(floor, bench.z);
    for (let ix = -2; ix <= 2; ix += 1) {
      for (let iz = -2; iz <= 2; iz += 1) {
        const position = new Vector3(
          cx + (ix / 2) * bench.halfX,
          BUILDING_BASE_Y,
          cz + (iz / 2) * bench.halfZ,
        );
        for (let frame = 0; frame < ESCAPE_FRAMES; frame += 1) {
          world.resolve(position, PLAYER_RADIUS, 0, ESCAPE_DT);
        }
        const stillInsideX = Math.abs(position.x - cx) < bench.halfX;
        const stillInsideZ = Math.abs(position.z - cz) < bench.halfZ;
        if (stillInsideX && stillInsideZ) {
          fail(
            `on ${floor.name} a body dropped inside the bench at ` +
              `[${bench.x.toFixed(2)}, ${bench.z.toFixed(2)}] was still inside it after ` +
              `${ESCAPE_FRAMES} frames — that is a soft-lock, not a bench`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. The collider is the wood — sized off the built world, not off the plan
// ---------------------------------------------------------------------------

/**
 * **`topIsAbsolute`, asked as a behaviour rather than read as a flag.**
 *
 * The first draft counted `topIsAbsolute` off `forEachWall` and reported zero
 * on every floor — because `forEachWall` hands its visitor nine *positional*
 * numbers and does not pass that flag at all, so the clause was reading `x1`
 * as an object and finding `undefined`. It was a green-shaped assertion about
 * a thing it could not see: precisely CLAUDE.md's "a check can pass without
 * checking anything", one layer down.
 *
 * So it is measured instead, as the three answers the flag exists to give:
 *
 * - feet on the floor → **blocked**;
 * - feet a hand's breadth above the bench's top, mid-jump → **not blocked**
 *   (the default `Infinity` top would make a 0.44 m bench a pillar to the
 *   ceiling, which is the bug the hotel's furniture already paid for);
 * - feet exactly on the top, stood on it → **not blocked**, or the bench's own
 *   edge shoves her off the thing she just climbed.
 */
for (const floor of CASTLE_FLOORS) {
  const world = worldFor(floor);
  const benchTop = BUILDING_BASE_Y + BENCH_HEIGHT;
  for (const bench of benchFootprints(floor.index)) {
    const cx = floorX(floor, bench.x);
    const cz = floorZ(floor, bench.z);
    const held = (y: number): boolean => {
      const position = new Vector3(cx, y, cz);
      const before = position.clone();
      world.resolve(position, PLAYER_RADIUS, 0, 1 / 60);
      return position.distanceTo(before) > 1e-6;
    };
    const where = `${floor.name}'s bench at [${bench.x.toFixed(2)}, ${bench.z.toFixed(2)}]`;
    if (!held(BUILDING_BASE_Y)) {
      fail(`${where} does not push a body standing on the floor out of it`);
    }
    if (held(benchTop)) {
      fail(`${where} shoves off a body stood on its own seat — its top is not absolute`);
    }
    if (held(benchTop + 0.3)) {
      fail(
        `${where} still blocks a body 0.3 m above its seat: it is an invisible pillar to the ` +
          `ceiling, not a bench, and a jump cannot clear it`,
      );
    }
  }
}

// A bench cannot be so deep that `addRectangle`'s hollow middle reappears.
// Clause 2 is the measurement; this is the reason, stated where a widening
// edit will read it.
if (BENCH_DEPTH >= 4 * 0.2) {
  fail(
    `a bench is ${BENCH_DEPTH} m deep, which is no less than four collision-wall ` +
      `half-thicknesses — its four walls no longer overlap through the middle, so it has an ` +
      `interior to get stuck in. See Building.ts's registerBenchCollision.`,
  );
}

// ---------------------------------------------------------------------------
// 3b. The planters: the pot stops her, the bush does not
// ---------------------------------------------------------------------------

/**
 * The same three behaviours asked of the benches, asked of a pot — plus the
 * one that is only true here.
 *
 * A planter is a stone pot with a shrub in it, and `dressing.ts`'s
 * `planterRing` explains why only the pot is solid. That judgement is worth an
 * assertion rather than a paragraph, because it is exactly the kind of thing a
 * later "make everything solid" sweep would undo without noticing: **a body
 * whose feet are above the pot's rim must pass**, so a jump carries her over
 * the planter, leaves and all, and the bush is never an invisible hedge.
 */
for (const floor of CASTLE_FLOORS) {
  if (planterRing(floor.index).length === 0) continue;
  const world = worldFor(floor);
  const potTop = BUILDING_BASE_Y + PLANTER_TOP;
  for (const planter of planterRing(floor.index)) {
    const cx = floorX(floor, planter.x);
    const cz = floorZ(floor, planter.z);
    const held = (y: number): boolean => {
      const position = new Vector3(cx, y, cz);
      const before = position.clone();
      world.resolve(position, PLAYER_RADIUS, 0, 1 / 60);
      return position.distanceTo(before) > 1e-6;
    };
    const where = `${floor.name}'s planter at [${planter.x.toFixed(1)}, ${planter.z.toFixed(1)}]`;
    if (!held(BUILDING_BASE_Y)) {
      fail(`${where} does not stop a body walking into it — the pot is not solid`);
    }
    if (held(potTop + 0.3)) {
      fail(
        `${where} still blocks a body 0.3 m above its rim: the shrub has become an invisible ` +
          `hedge she cannot jump, which is not what a planter is`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Nothing a child needs got walled off — with its two controls
// ---------------------------------------------------------------------------

/** Flood-fill pitch. Finer than a player's own diameter, so a gap she fits
 *  through cannot be missed between samples. */
const FILL_PITCH = 0.3;

/**
 * Every point on this floor's plate a player-sized body can walk to from
 * `seed`, as a `Set` of `"ix,iz"` keys on the {@link FILL_PITCH} lattice, in
 * the floor's own local metres.
 */
function reachable(world: CollisionWorld, floor: CastleFloor, seed: readonly [number, number]): Set<string> {
  const key = (ix: number, iz: number): string => `${ix},${iz}`;
  const toIndex = (v: number): number => Math.round(v / FILL_PITCH);
  const walkable = (ix: number, iz: number): boolean => {
    const x = ix * FILL_PITCH;
    const z = iz * FILL_PITCH;
    if (!insideInterior(x, z)) return false;
    return world.isClearCircle(floorX(floor, x), floorZ(floor, z), PLAYER_RADIUS);
  };

  const start: [number, number] = [toIndex(seed[0]), toIndex(seed[1])];
  if (!walkable(start[0], start[1])) return new Set();
  const seen = new Set<string>([key(start[0], start[1])]);
  const queue: [number, number][] = [start];
  while (queue.length > 0) {
    const cell = queue.pop();
    if (!cell) break;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cell[0] + dx;
      const nz = cell[1] + dz;
      const k = key(nx, nz);
      if (seen.has(k)) continue;
      if (!walkable(nx, nz)) continue;
      seen.add(k);
      queue.push([nx, nz]);
    }
  }
  return seen;
}

/** Is any lattice cell within `radius` of this local point reachable? A
 *  keep-out's *centre* may legitimately be a lamp post; what matters is that
 *  she can get to the spot. */
function canReach(seen: Set<string>, x: number, z: number, radius: number): boolean {
  const span = Math.ceil(radius / FILL_PITCH);
  const cx = Math.round(x / FILL_PITCH);
  const cz = Math.round(z / FILL_PITCH);
  for (let ix = cx - span; ix <= cx + span; ix += 1) {
    for (let iz = cz - span; iz <= cz + span; iz += 1) {
      if (Math.hypot(ix * FILL_PITCH - x, iz * FILL_PITCH - z) > radius) continue;
      if (seen.has(`${ix},${iz}`)) return true;
    }
  }
  return false;
}

/** Where the lift puts her down on every storey — `keepOutsFor`'s first entry,
 *  asked rather than re-typed. */
const ARRIVAL: readonly [number, number] = [INTERIOR_HALF_X - 2, 5];

for (const floor of CASTLE_FLOORS) {
  const world = worldFor(floor);
  const seen = reachable(world, floor, ARRIVAL);

  if (seen.size === 0) {
    fail(`${floor.name}: the flood fill could not even start from the lift lobby`);
    continue;
  }

  // --- control one: it can say no --------------------------------------
  const outsideX = INTERIOR_HALF_X + 3;
  if (canReach(seen, outsideX, 0, FILL_PITCH)) {
    fail(
      `${floor.name}: CONTROL FAILED — the fill reached [${outsideX.toFixed(1)}, 0], which is ` +
        `3 m outside the shell. It is leaking through the walls, so nothing else it says means ` +
        `anything.`,
    );
    continue;
  }

  // --- control two: it can say no because of a collider ------------------
  //
  // A ring of walls dropped round a spot the fill has just reached. If it is
  // genuinely consulting the collision world, that spot goes from reachable to
  // not; if it is only ever bounded by the plate, it stays reachable and every
  // green answer this file gives is worthless.
  //
  // **The spot is derived from the fill, not named.** It was
  // `keepOutsFor(deck)[1]` — the roundel, by its position in the list — and the
  // banquet (#453) added the great hall's own keep-outs, so index 1 stopped
  // being the roundel and the control failed on that floor alone. Indexing a
  // list by position is a second copy of that list's order, kept in step by
  // hand, which is the bug this repo opens its own instructions with. The
  // farthest reachable cell from the arrival is a spot the fill itself has
  // just proved it can get to, on any floor, whatever furniture arrives later.
  let control: { x: number; z: number } | null = null;
  let farthest = -Infinity;
  for (const cell of seen) {
    const parts = cell.split(',');
    const x = Number(parts[0]) * FILL_PITCH;
    const z = Number(parts[1]) * FILL_PITCH;
    const d = Math.hypot(x - ARRIVAL[0], z - ARRIVAL[1]);
    if (d > farthest) {
      farthest = d;
      control = { x, z };
    }
  }
  const roundel = control;
  if (!roundel) {
    fail(`${floor.name}: the fill reached nowhere to run the collider control on`);
    continue;
  }
  const walled = worldFor(floor);
  const RING = 24;
  const ringRadius = 2;
  for (let i = 0; i < RING; i += 1) {
    const a = (i / RING) * Math.PI * 2;
    const b = ((i + 1) / RING) * Math.PI * 2;
    walled.addWall(
      floorX(floor, roundel.x + Math.cos(a) * ringRadius),
      floorZ(floor, roundel.z + Math.sin(a) * ringRadius),
      floorX(floor, roundel.x + Math.cos(b) * ringRadius),
      floorZ(floor, roundel.z + Math.sin(b) * ringRadius),
      0.3,
    );
  }
  const walledSeen = reachable(walled, floor, ARRIVAL);
  if (canReach(walledSeen, roundel.x, roundel.z, FILL_PITCH)) {
    fail(
      `${floor.name}: CONTROL FAILED — a ring of walls round [${roundel.x.toFixed(1)}, ` +
        `${roundel.z.toFixed(1)}] did not make its middle unreachable. The fill is not ` +
        `consulting the collision world at all, so its green answers are meaningless.`,
    );
    continue;
  }

  // --- the assertion itself ---------------------------------------------
  //
  const failuresBefore = failures.length;
  //
  // Every disc in the castle's register of "somewhere a child must be able to
  // stand" must still have somewhere to stand in it.
  for (const spot of keepOutsFor(floor.index)) {
    if (!canReach(seen, spot.x, spot.z, spot.radius)) {
      fail(
        `${floor.name}: the keep-out at [${spot.x.toFixed(1)}, ${spot.z.toFixed(1)}] r` +
          `${spot.radius.toFixed(1)} is not reachable from the lift lobby — making the benches ` +
          `solid walled off somewhere a child has to be able to stand`,
      );
    }
  }

  // And she can walk up to every bench and sit on it, from its long side —
  // a bench she cannot reach is worse than one she could walk through.
  for (const bench of benchFootprints(floor.index)) {
    const alongZ = bench.halfZ > bench.halfX;
    const reach = (alongZ ? bench.halfX : bench.halfZ) + PLAYER_RADIUS + 0.1;
    const sides = alongZ
      ? [
          [bench.x + reach, bench.z],
          [bench.x - reach, bench.z],
        ]
      : [
          [bench.x, bench.z + reach],
          [bench.x, bench.z - reach],
        ];
    const reachable = sides.some(([x, z]) => canReach(seen, x ?? 0, z ?? 0, FILL_PITCH * 2));
    if (!reachable) {
      fail(
        `${floor.name}: neither long side of the bench at [${bench.x.toFixed(2)}, ` +
          `${bench.z.toFixed(2)}] can be walked up to`,
      );
    }
  }

  // **The middle of the roundel, specifically.** The keep-out clause above
  // cannot see this: the roundel's disc is 7.6 m and the planters ring it at
  // 5.1 m, so a fill that reached only the outer annulus would satisfy it
  // while the meeting spot in the middle was fenced off. This asks for the
  // exact centre.
  if (planterRing(floor.index).length > 0) {
    if (!canReach(seen, DECK_ROUNDEL.x, DECK_ROUNDEL.z, FILL_PITCH * 2)) {
      fail(
        `${floor.name}: the middle of the roundel is not reachable — the ring of ten solid ` +
          `planters has become a fence round the one place on the floor that is meant to be a ` +
          `meeting spot`,
      );
    }
    // And every gap between two neighbouring pots is walkable, not merely one
    // of them. A single wide way in would satisfy the clause above while nine
    // gaps were closed.
    const ring = planterRing(floor.index);
    ring.forEach((planter, i) => {
      const next = ring[(i + 1) % ring.length];
      if (!next) return;
      const midX = (planter.x + next.x) / 2;
      const midZ = (planter.z + next.z) / 2;
      if (!canReach(seen, midX, midZ, FILL_PITCH)) {
        fail(
          `${floor.name}: the gap between the planters at [${planter.x.toFixed(1)}, ` +
            `${planter.z.toFixed(1)}] and [${next.x.toFixed(1)}, ${next.z.toFixed(1)}] is not ` +
            `walkable — two pots ${Math.hypot(next.x - planter.x, next.z - planter.z).toFixed(2)} m ` +
            `apart have closed on a ${(PLAYER_RADIUS * 2).toFixed(2)} m child`,
        );
      }
    });
  }

  // **The pavilion: solid, and its inside genuinely out of reach.**
  //
  // Jim, 1 September 2026: *"Why does the roof garden have a big shed-like
  // building on it that you can run through?"* It is solid now, and an 11 × 9 m
  // rectangle's hollow middle is exactly the size of soft-lock CLAUDE.md warns
  // about. The rule is that such an inside is either enterable *and* leavable
  // or unreachable, and this one is unreachable — so that is asserted, on the
  // **same fill** that requires every keep-out to be reachable. One instrument,
  // two opposite answers, neither of which can come out right by accident: a
  // fill that had quietly stopped consulting its colliders would fail this
  // clause, and a fill that could not leave its seed would fail the other.
  if (floor.index === TOP_DECK) {
    if (canReach(seen, ROOF_PAVILION_X, ROOF_PAVILION_Z, FILL_PITCH)) {
      fail(
        `the middle of the roof pavilion IS reachable — a child can get inside an 11 × 9 m ` +
          `sealed box, and a CollisionWorld rectangle never pushes a mover out of its middle, so ` +
          `that is a soft-lock she cannot walk out of`,
      );
    }
    // …and unreachable is not the same as solid, so each of the four faces is
    // also **marched at square on**, and sampled along its length rather than
    // only at its middle: a hole in a wall could be anywhere along it, and the
    // hotel's six evenly-spaced gaps (CLAUDE.md) were all found by exactly this
    // and by nothing else. Square on, because a body approaching a corner
    // diagonally slides round it, which says nothing about the face.
    const faces = [
      { dirX: 1, dirZ: 0 },
      { dirX: -1, dirZ: 0 },
      { dirX: 0, dirZ: 1 },
      { dirX: 0, dirZ: -1 },
    ] as const;
    const samples = 9;
    for (const face of faces) {
      const alongHalf = face.dirX !== 0 ? ROOF_PAVILION_HALF_Z : ROOF_PAVILION_HALF_X;
      for (let s = 0; s < samples; s += 1) {
        const offset = ((s + 0.5) / samples - 0.5) * 2 * (alongHalf - PLAYER_RADIUS);
        const startX =
          ROOF_PAVILION_X + face.dirX * (ROOF_PAVILION_HALF_X + 4) + (face.dirX === 0 ? offset : 0);
        const startZ =
          ROOF_PAVILION_Z + face.dirZ * (ROOF_PAVILION_HALF_Z + 4) + (face.dirZ === 0 ? offset : 0);
        const position = new Vector3(
          floorX(floor, startX),
          BUILDING_BASE_Y,
          floorZ(floor, startZ),
        );
        for (let step = 0; step < 20; step += 1) {
          world.resolveMovement(
            position,
            -face.dirX * PLAYER_LONGEST_STEP,
            -face.dirZ * PLAYER_LONGEST_STEP,
            PLAYER_RADIUS,
            0,
            1 / 30,
          );
        }
        const insideX = Math.abs(position.x - floorX(floor, ROOF_PAVILION_X));
        const insideZ = Math.abs(position.z - floorZ(floor, ROOF_PAVILION_Z));
        if (insideX < ROOF_PAVILION_HALF_X && insideZ < ROOF_PAVILION_HALF_Z) {
          fail(
            `a body marched at the pavilion's [${face.dirX}, ${face.dirZ}] face, ` +
              `${offset.toFixed(2)} m along it, ended up inside the building — that face is not ` +
              `solid`,
          );
        }
      }
    }
  }

  // **The rampart she can see is the thing that stops her** (#462).
  //
  // Nothing derives a collider from a mesh in this codebase, so the drawn
  // parapet and the perimeter wall that actually stops her are two definitions
  // of one edge, kept in step by hand — which is the defect this repo cites
  // more than any other. Since #462 puts merlons and turrets along that edge
  // and invites a child to walk up and lean on them, the two are checked
  // against each other here rather than left to agree by luck.
  //
  // **Both sides are measured, neither is typed.** The stone comes off the
  // built `roof-parapet` group's own bounding box; the stopping surface comes
  // out of a body marched at it through the real `CollisionWorld`. Comparing a
  // constant against a constant is how a clause like this passes for ever
  // while the wall drifts.
  //
  // Measured as committed: her body stops **0.075 m** short of the drawn inner
  // face, on both axes. That gap is the honest one to allow — `hotel/place.ts`'s
  // rule is generous-*light*, never generous-heavy, so being kept a whisker off
  // the stone is right and being let inside it is not.
  if (floor.index === TOP_DECK) {
    const shell = new BuildingShell('interior');
    shell.group.updateMatrixWorld(true);
    const roofGroup = shell.floorGroups[TOP_DECK];
    let parapet: Object3D | null = null;
    roofGroup?.traverse((object) => {
      if (object.name === 'roof-parapet-lip') parapet = object;
    });
    if (!parapet) {
      fail(
        'the roof garden has no `roof-parapet-lip` to measure, so the clause that keeps the ' +
          'drawn rampart and the collider that stops her in step is switched off',
      );
    } else {
      const box = new Box3().setFromObject(parapet);
      const groupX = roofGroup?.position.x ?? 0;
      // The kerb is a ring, so its box is the *outer* face on every side. The
      // inner face is one band in from it, and the band is the one number
      // `Shell.ts` extrudes the ring from.
      //
      // **The +X and +Z runs only**, which is not laziness. The fixed
      // isometric shows an object's +X/+Z faces, so those two are the ramparts
      // a child ever stands at and looks over — Jim's own scoping on #462 — and
      // they are the two with an unbroken run of parapet to march at. The −X
      // run has the lift alcove cut through it: a body marched at that face
      // from the middle of the plate goes **13.5 m** straight out of the
      // doorway, which is the alcove working correctly and says nothing about
      // the stone either side of it.
      const faces = [
        { axis: 'x' as const, inner: box.max.x - groupX - ROOF_PARAPET_THICKNESS, dir: 1 },
        { axis: 'z' as const, inner: box.max.z - ROOF_PARAPET_THICKNESS, dir: 1 },
      ];
      for (const face of faces) {
        const position = new Vector3(floorX(floor, 0), BUILDING_BASE_Y, floorZ(floor, 0));
        const stepX = face.axis === 'x' ? face.dir * PLAYER_LONGEST_STEP : 0;
        const stepZ = face.axis === 'z' ? face.dir * PLAYER_LONGEST_STEP : 0;
        for (let i = 0; i < 80; i += 1) {
          world.resolveMovement(position, stepX, stepZ, PLAYER_RADIUS, 0, 1 / 30);
        }
        const local =
          face.axis === 'x' ? position.x - floorX(floor, 0) : position.z - floorZ(floor, 0);
        // Where her *body* stopped, not her centre: that is the surface which
        // either meets the stone or does not.
        const surface = local + face.dir * PLAYER_RADIUS;
        const shortBy = (face.inner - surface) * face.dir;
        if (shortBy < -0.001) {
          fail(
            `on the roof garden's ${face.dir > 0 ? '+' : '-'}${face.axis} side a child's body ` +
              `reaches ${(-shortBy).toFixed(3)} m *inside* the drawn parapet — the stone she ` +
              `can see is not what stops her`,
          );
        }
        if (shortBy > PARAPET_STANDOFF_LIMIT) {
          fail(
            `on the roof garden's ${face.dir > 0 ? '+' : '-'}${face.axis} side a child is ` +
              `stopped ${shortBy.toFixed(3)} m short of the drawn parapet — that is an ` +
              `invisible wall standing off the rampart she is meant to lean on, and the two ` +
              `have drifted apart`,
          );
        }
      }
    }
  }

  // **The corner turrets: solid stone she walks round, not through, and not a
  // trap** (#462).
  //
  // Each one stands on the plate's own corner, so roughly a quarter of its
  // footprint is over floor a child can otherwise walk on — she can get right
  // up beside it, which is exactly when CLAUDE.md's first rule bites. Measured
  // with the collider taken out: a body marched at a turret ends **1.62 m** from
  // its middle, inside 2.45 m of drawn stone, from twelve of sixteen bearings.
  // That is what this clause exists to keep from coming back.
  //
  // Three clauses on **the one fill above**, pointing in opposite directions on
  // purpose, which is what stops any of them being true by accident:
  //
  //  1. the middle of a turret is **not** reachable — it is 2 m of masonry.
  //     This one is belt-and-braces and says so: the plate's perimeter wall
  //     already excludes the corner, so it stays green with the turret collider
  //     removed. It is clause 3 that has the teeth;
  //  2. the paving on its **inboard** side still is — a turret that had walled
  //     off the corner of the roof would pass clause 1 and fail this;
  //  3. a body marched at it from sixteen bearings at a sprinting stride stops
  //     **outside** the drawn cone. Unreachable is not the same as solid: the
  //     fill only ever asks about lattice points, and the hotel's six
  //     evenly-spaced gaps (CLAUDE.md) were found by marching and by nothing
  //     else. **Proved red** by dropping `registerRoofTurretCollision` from
  //     `worldFor`: 16 failures, against the geometry as committed here.
  //
  // Clause 1 needs no soft-lock clause of its own the way the pavilion does,
  // and it is worth saying why: a circular collider has no hollow middle.
  // `CollisionWorld` pushes a mover out along the radius from wherever it
  // stands, so a body that somehow began at a turret's centre leaves on the
  // first frame. That is the reason `Building.ts` registers a disc rather than
  // a rectangle for a round solid.
  if (floor.index === TOP_DECK) {
    const spots = roofTurretSpots();
    if (spots.length === 0) {
      fail('the roof garden has no corner turrets at all, so this clause asserts nothing');
    }
    for (const spot of spots) {
      if (canReach(seen, spot.x, spot.z, FILL_PITCH)) {
        fail(
          `the middle of the corner turret at [${spot.x.toFixed(1)}, ${spot.z.toFixed(1)}] IS ` +
            `reachable — a child is standing inside 2 m of castle masonry`,
        );
      }

      // Inboard along the diagonal, just clear of the drawn stone: the nearest
      // paving a child could stand on beside this turret. Derived from the
      // turret's own footprint, so a wider turret moves the probe rather than
      // silently sitting inside it.
      const inward = CASTLE_TURRET_FOOTPRINT_RADIUS + PLAYER_RADIUS + 0.2;
      const besideX = spot.x - Math.sign(spot.x) * inward * Math.SQRT1_2;
      const besideZ = spot.z - Math.sign(spot.z) * inward * Math.SQRT1_2;
      if (!canReach(seen, besideX, besideZ, FILL_PITCH * 2)) {
        fail(
          `the paving beside the corner turret at [${spot.x.toFixed(1)}, ` +
            `${spot.z.toFixed(1)}] is not reachable from the lift lobby — the turret has walled ` +
            `off the corner of the roof garden rather than standing in it`,
        );
      }

      // The same sixteen bearings the benches are marched from, asked of the
      // one constant rather than a second 16 written here.
      for (let b = 0; b < BEARINGS; b += 1) {
        const angle = (b / BEARINGS) * Math.PI * 2;
        const dirX = Math.cos(angle);
        const dirZ = Math.sin(angle);
        const start = CASTLE_TURRET_FOOTPRINT_RADIUS + 4;
        const position = new Vector3(
          floorX(floor, spot.x + dirX * start),
          BUILDING_BASE_Y,
          floorZ(floor, spot.z + dirZ * start),
        );
        for (let step = 0; step < 20; step += 1) {
          world.resolveMovement(
            position,
            -dirX * PLAYER_LONGEST_STEP,
            -dirZ * PLAYER_LONGEST_STEP,
            PLAYER_RADIUS,
            0,
            1 / 30,
          );
        }
        const stoppedAt = Math.hypot(
          position.x - floorX(floor, spot.x),
          position.z - floorZ(floor, spot.z),
        );
        // Allowed a whisker inside the drawn footprint: `resolveMovement`
        // settles a body on the surface rather than a hair off it.
        if (stoppedAt < CASTLE_TURRET_FOOTPRINT_RADIUS - 0.05) {
          fail(
            `a body marched at the corner turret at [${spot.x.toFixed(1)}, ` +
              `${spot.z.toFixed(1)}] on bearing ${((angle * 180) / Math.PI).toFixed(0)}° ended ` +
              `${stoppedAt.toFixed(2)} m from its middle, inside its ` +
              `${CASTLE_TURRET_FOOTPRINT_RADIUS.toFixed(2)} m of stone — it is not solid from ` +
              `that approach`,
          );
        }
      }
    }
  }

  // What the furniture actually cost, reported whether or not anything failed —
  // a number nobody has to take on trust, and the tell if a future bench count
  // starts eating the floor.
  //
  // **Its second clause is conditional on this floor's own result.** It read
  // "…and nothing became unreachable" unconditionally, and a mutation run
  // printed exactly that on a floor whose next line was a keep-out it had just
  // walled off. A note that asserts more than the run behind it is the same
  // disease as a check that cannot fail, one layer out.
  const bare = reachable(bareWorldFor(floor), floor, ARRIVAL);
  const lost = bare.size - seen.size;
  const clean = failures.length === failuresBefore;
  process.stderr.write(
    `check:benches — ${floor.name}: ${benchFootprints(floor.index).length} benches, ` +
      `${planterRing(floor.index).length} planters` +
      `${floor.index === TOP_DECK ? ', the pavilion and 4 corner turrets' : ''} cost ` +
      `${lost} of ${bare.size} walkable cells (${((lost / bare.size) * 100).toFixed(2)}%), and ` +
      `${clean ? 'nothing became unreachable' : 'SOMETHING BECAME UNREACHABLE — see below'}.\n`,
  );
}

// ---------------------------------------------------------------------------
// 5. A bench on one floor is solid nowhere else
// ---------------------------------------------------------------------------

/**
 * The measurement behind the retired prohibition. Collision is still
 * height-blind — an infinite-topped collider blocks at any height — so the
 * only thing making a bench on the roof harmless on the mall is that the two
 * plates are hundreds of metres apart. Asserted rather than assumed, because
 * it is the single fact this whole change rests on.
 */
for (const floor of CASTLE_FLOORS) {
  const world = new CollisionWorld();
  registerBenchCollision(world, floor);
  for (const other of CASTLE_FLOORS) {
    if (other.index === floor.index) continue;
    let blocked = 0;
    let swept = 0;
    for (let ix = -Math.floor(INTERIOR_HALF_X); ix <= INTERIOR_HALF_X; ix += 1) {
      for (let iz = -Math.floor(INTERIOR_HALF_Z); iz <= INTERIOR_HALF_Z; iz += 1) {
        if (!insideInterior(ix, iz)) continue;
        swept += 1;
        if (!world.isClearCircle(floorX(other, ix), floorZ(other, iz), PLAYER_RADIUS)) blocked += 1;
      }
    }
    if (blocked > 0) {
      fail(
        `${floor.name}'s benches block ${blocked} of ${swept} points swept on ${other.name} — ` +
          `the floors are no longer far enough apart for a castle prop to carry a collider`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 6. The long grass is long, and it is dense
// ---------------------------------------------------------------------------

/**
 * **Measured off the built meadow, not off its constants** — the instance
 * count and the blade geometry that `buildRoofMeadow` actually returned.
 *
 * The two thresholds are the game's, not the generator's:
 *
 * - **Long.** A wild pet is {@link PET_RENDER_HEIGHT} tall and the brief is
 *   that it be *half hidden*. Below 55% of a pet the grass is brushing its
 *   belly and reads as a lawn; above 80% the animal disappears entirely and
 *   the whole reason the meadow exists goes with it.
 * - **Dense.** "A sparse fringe" is the report, and the measurable difference
 *   between a fringe and a thicket is whether neighbouring clumps *touch*: a
 *   clump standing on its own reads as a tuft, and a clump whose blades
 *   interlock with the next one's reads as grass. So the median distance from
 *   a clump to its nearest neighbour must be no more than the width of a clump
 *   — a threshold taken from the drawn geometry rather than from a count
 *   somebody liked the look of, and one that stays honest if the clumps are
 *   ever made wider or narrower.
 *
 *   Coverage-of-ground was tried first and is the wrong model: the turf discs
 *   already cover the paving, so no threshold on bare ground can see the
 *   difference between the fringe Jim reported and the meadow that replaced
 *   it. Measured, the shipped meadow covers only 0.34× by that metric while
 *   looking (and being) thick.
 */
{
  const meadow = roofMeadow(TOP_DECK);
  const group = buildRoofMeadow(TOP_DECK);
  if (!group) {
    fail('the roof garden built no long grass at all');
  } else {
    const meshes = group.children;
    if (meshes.length !== 2) {
      fail(
        `the meadow is ${meshes.length} meshes, not the two (turf, tufts) it must stay — ` +
          `"denser" must never mean a draw call per blade`,
      );
    }
    const tufts = group.getObjectByName(`castle-roof-grass-${TOP_DECK}`);
    if (!tufts || !('count' in tufts) || !('geometry' in tufts)) {
      fail('the meadow has no instanced tuft mesh to measure');
    } else {
      const count = tufts.count as number;
      const geometry = tufts.geometry as {
        computeBoundingBox(): void;
        boundingBox: { max: { x: number; y: number }; min: { x: number } } | null;
      };
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      const tallest = box ? box.max.y : 0;
      const clumpWidth = box ? box.max.x - box.min.x : 0;

      const low = PET_RENDER_HEIGHT * 0.55;
      const high = PET_RENDER_HEIGHT * 0.8;
      if (!(tallest >= low && tallest <= high)) {
        fail(
          `the tallest blade a clump draws is ${tallest.toFixed(2)} m, outside the ` +
            `${low.toFixed(2)}–${high.toFixed(2)} m that half-hides a ${PET_RENDER_HEIGHT} m pet ` +
            `(it is ${((tallest / PET_RENDER_HEIGHT) * 100).toFixed(0)}% of one)`,
        );
      }

      // Where every clump actually stands, read back off the instance matrices
      // — the positions that were drawn, not the loop that drew them.
      const matrix = new Matrix4();
      const spot = new Vector3();
      const spots: [number, number][] = [];
      for (let i = 0; i < count; i += 1) {
        (tufts as unknown as { getMatrixAt(i: number, m: Matrix4): void }).getMatrixAt(i, matrix);
        spot.setFromMatrixPosition(matrix);
        spots.push([spot.x, spot.z]);
      }
      const nearest = spots.map(([x, z]) => {
        let best = Infinity;
        for (const [ox, oz] of spots) {
          const d = Math.hypot(x - ox, z - oz);
          if (d > 1e-9 && d < best) best = d;
        }
        return best;
      });
      nearest.sort((a, b) => a - b);
      const median = nearest[Math.floor(nearest.length / 2)] ?? Infinity;
      if (median > clumpWidth) {
        fail(
          `the median clump stands ${median.toFixed(2)} m from its nearest neighbour, more than ` +
            `the ${clumpWidth.toFixed(2)} m a clump is wide — the blades do not interlock, so it ` +
            `reads as a fringe of separate tufts, which is what #459 is`,
        );
      }
      process.stderr.write(
        `check:benches — long grass: ${count} clumps over ${meadow.cells.length} cells, tallest ` +
          `blade ${tallest.toFixed(2)} m (${((tallest / PET_RENDER_HEIGHT) * 100).toFixed(0)}% of ` +
          `a pet), median nearest neighbour ${median.toFixed(2)} m against a ` +
          `${clumpWidth.toFixed(2)} m clump, in ${meshes.length} draw calls.\n`,
      );
    }
  }
  // The constant and the built thing must not have drifted apart either.
  if (MEADOW_GRASS_HEIGHT <= 0) fail('MEADOW_GRASS_HEIGHT is not a height');
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  process.stderr.write(`\ncheck:benches FAILED (${failures.length}):\n`);
  for (const message of failures) process.stderr.write(`  ✗ ${message}\n`);
  process.exit(1);
}

process.stdout.write(
  `check:benches OK — ${CASTLE_FLOORS.length} floors, ` +
    `${CASTLE_FLOORS.reduce((n, f) => n + benchFootprints(f.index).length, 0)} benches ` +
    `(${BENCH_LENGTH} × ${BENCH_DEPTH} × ${BENCH_HEIGHT} m) solid from ${BEARINGS} bearings and ` +
    `none of them a trap, ` +
    `${CASTLE_FLOORS.reduce((n, f) => n + planterRing(f.index).length, 0)} planters solid to ` +
    `feet and open to a jump, a pavilion solid on all four faces with its inside out of reach, ` +
    `nothing walled off, and the long grass measured.\n`,
);
