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
import { Matrix4, Vector3 } from 'three';
import { CollisionWorld } from '../src/world/Collision.ts';
import {
  registerBenchCollision,
  registerInteriorCollision,
} from '../src/world/building/Building.ts';
import {
  BENCH_DEPTH,
  BENCH_HEIGHT,
  BENCH_LENGTH,
  benchFootprints,
  keepOutsFor,
} from '../src/world/building/dressing.ts';
import { buildRoofMeadow, roofMeadow, MEADOW_GRASS_HEIGHT } from '../src/world/building/roofMeadow.ts';
import { CASTLE_FLOORS, floorX, floorZ, type CastleFloor } from '../src/world/building/floors.ts';
import { BUILDING_BASE_Y, insideInterior, TOP_DECK } from '../src/world/building/layout.ts';
import { PET_RENDER_HEIGHT } from '../src/art/models/pets.ts';
import {
  INTERIOR_HALF_X,
  INTERIOR_HALF_Z,
  PLAYER_LONGEST_STEP,
  PLAYER_RADIUS,
} from '../src/core/constants.ts';

const failures: string[] = [];
function fail(message: string): void {
  failures.push(message);
}

/** Every floor's collision, exactly as `Building` registers it. */
function worldFor(floor: CastleFloor): CollisionWorld {
  const world = new CollisionWorld();
  registerInteriorCollision(world, floor);
  registerBenchCollision(world, floor);
  return world;
}

/** The same shell with **no** benches — what "before" looked like, so the
 *  reachability clause can report what the benches actually cost. */
function bareWorldFor(floor: CastleFloor): CollisionWorld {
  const world = new CollisionWorld();
  registerInteriorCollision(world, floor);
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
    fail(`floor ${floor.index} (${floor.name}) has no benches to check at all`);
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
  // A ring of walls round the roundel's middle. If the fill is genuinely
  // consulting the collision world, that point goes from reachable to not.
  const roundel = keepOutsFor(floor.index)[1];
  if (!roundel) {
    fail(`${floor.name}: keepOutsFor no longer has a roundel to run the collider control on`);
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

  // What the benches actually cost, reported whether or not anything failed —
  // a number nobody has to take on trust, and the tell if a future bench
  // count starts eating the floor.
  const bare = reachable(bareWorldFor(floor), floor, ARRIVAL);
  const lost = bare.size - seen.size;
  process.stderr.write(
    `check:benches — ${floor.name}: ${benchFootprints(floor.index).length} solid benches cost ` +
      `${lost} of ${bare.size} walkable cells (${((lost / bare.size) * 100).toFixed(2)}%), and ` +
      `nothing became unreachable.\n`,
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
    `(${BENCH_LENGTH} × ${BENCH_DEPTH} × ${BENCH_HEIGHT} m) solid from ${BEARINGS} bearings, ` +
    `none of them a trap, nothing walled off, and the long grass measured.\n`,
);
