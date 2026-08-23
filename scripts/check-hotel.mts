/**
 * **Does the hotel hold its people up, and stop them walking through the
 * furniture?**
 *
 * ```
 * npm run check:hotel
 * ```
 *
 * Four assertions, one per rule Jim asked for after playing the hotel
 * (7 August 2026), all measured on the **real built park** rather than on the
 * rules that built it:
 *
 * 1. **Nobody falls through the world.** Family QA found all seven hotel
 *    guests at y = −16.4…−16.9 m — the park's raw terrain height out at the
 *    hotel's coordinates — under rooms whose floors are `WalkSurfaces`
 *    platforms at y = 0. The residents were already using the park's own
 *    sampler; what was wrong was where they *asked from*.
 *    `WalkSurfaces.sample(x, z, y)` only offers a platform within a step **up**
 *    of `y`, and `NpcCharacter`'s constructor seeds y from `terrainHeight`, so
 *    a body starting 16 m below its own floor is told, correctly, that it has
 *    none — and falls for ever. Fixed by `NpcCharacter.settle(from)` and
 *    `ResidentSpec.floorY`. This is QA's own suggested regression, widened
 *    from the residents to **every** child in the game, because the next one
 *    of these will be somebody else.
 * 2. **Every prop is solid.** Jim: *"the statues and chairs you can clip
 *    through are weird."* One footprint per prop, registered by
 *    `world/hotel/place.ts`, feeds both `CollisionWorld` and the guest
 *    keep-outs — so this asks the collision world, which is the consumer that
 *    a child actually meets.
 * 3. **…except the beds.** They are platforms you stand on, and a wall round
 *    the edge of one would shove a jumping child back off it. Asserted
 *    explicitly rather than left as an absence, because "we forgot the beds"
 *    and "the beds are deliberately soft" look identical from outside.
 * 4. **Every declared window is built.** Rooms declare windows in
 *    `layout.ts` and `Hotel.glazeWall` clips them to the wall's solid spans,
 *    so a careless number is silently dropped rather than left floating in a
 *    doorway. Silent is the problem: this counts them.
 * 5. **The suite door is locked by collision, not by dialogue** — and the key
 *    genuinely opens it. Jim walked through the "locked" door and fell into
 *    the void: the lock was a trigger, and its own refusal cooldown gated the
 *    check that was the lock.
 * 6. **A player below the floor is caught.** The backstop in `Hotel.update`
 *    stands anyone under y = −2 back in their room — the net under every
 *    doorway bug not written yet.
 *
 * Proven red before it was trusted green: restoring the old settle height
 * fails (1) with all seven residents at −16.5 m; making a chair soft fails
 * (2); making a bed solid fails (3); widening a declared window past its
 * doorway fails (4); removing the lock wall fails (5) with the march 3.00 m
 * past the plane; disabling the backstop fails (6) with the player still at
 * −6 m; registering one flat walk-wedge per stair tread instead of
 * quarter-riser slices fails (14) with a 0.64 m single-stride rise.
 */

import './headless-canvas.mjs';
import { BackSide, Box3, Mesh, type Object3D, Raycaster, Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { HotelCinematic, MIN_SHOT_DISTANCE } from '../src/world/hotel/cinematic.ts';
import { IsoCamera } from '../src/core/IsoCamera.ts';
import { JUMP_APEX_HEIGHT, Player } from '../src/entities/Player.ts';
import { BED_MATTRESS_TOP, STAIR_RAIL_RADIUS } from '../src/art/models/hotelAssets.ts';
import {
  CAMERA_DISTANCE,
  CAMERA_YAW_DEGREES,
  CAMERA_PITCH_DEGREES,
  HOTEL_PLAY_RADIUS,
  MAX_FRAME_DELTA,
  NPC_RADIUS,
  PLAYER_LONGEST_STEP,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  PLAYER_SPRINT_MULTIPLIER,
} from '../src/core/constants.ts';
import { damp } from '../src/core/mathUtils.ts';
import {
  ROOMS,
  BREAKFAST,
  CORRIDOR,
  DOORWAY_THROUGH_DEPTH,
  GARDEN_FLOOR,
  type HotelRoom,
  HOTEL_FLOORS,
  LOBBY,
  LOBBY_FOYER_GROWTH,
  RECEPTION_ORIGIN_SHIFT,
  LOBBY_HALL_DOOR_X,
  OCEAN_FLOOR,
  SUITE,
  SUITE_BEDSIDE_X,
  SUITE_BEDSIDE_Z,
  SUITE_BEDSIDE_RADIUS,
  SUITE_BED_SPOTS,
  SUITE_BED_HALF_X,
  SUITE_BED_HALF_Z,
  SUITE_DOOR_WIDTH,
  petBedSlots,
  PET_BED_FOOTPRINT_RADIUS,
  clearFloorAround,
  doorwayClearanceZones,
  relativeLuminance,
  THEME_FLOOR_CONTRAST_MIN,
  mezzanineGuardedEdges,
  mezzanineHidesPoint,
} from '../src/world/hotel/layout.ts';
import { isClearOfDoorways } from '../src/world/hotel/place.ts';
import { ZONE_HEIGHT_TOLERANCE, pickInteractZone } from '../src/world/interact.ts';
import { cameraOffset } from '../src/core/cameraRig.ts';
import { segmentsMinusGaps } from '../src/world/wallRuns.ts';
import { BUFFET_TOP, SOFA_SEAT_TOP } from '../src/world/hotel/dressing.ts';
import { spaceAt, SPACE_GARDEN } from '../src/world/spaces.ts';
import { placedEntry } from '../src/world/parkLayout.ts';
import {
  TOWER_DOOR_HALF,
  TOWER_FACADE_ALONG,
  RECEPTION_X,
  RECEPTION_Z,
} from '../src/world/hotel/Hotel.ts';
import { saveFlags } from '../src/state/flags.ts';

/** Deep enough that no floor in the game is near it, shallow enough to catch a fall early. */
const FLOOR_OF_THE_WORLD = -2;

/** How long the crowd is run before anybody is asked where they are. */
const SETTLE_SECONDS = 8;

const problems: string[] = [];
const { world, scene } = quietly(() => buildHeadlessPark());
const { collision, npcs, hotel } = world;

// ---------------------------------------------------------------- 1. falling

const fakeInput = { justPressed: () => false } as never;
const playerPosition = new Vector3(0, 0, 0);
for (let frame = 0; frame < 60 * SETTLE_SECONDS; frame += 1) {
  npcs.update({
    dt: 1 / 60,
    elapsed: frame / 60,
    input: fakeInput,
    playerPosition,
    cameraForward: new Vector3(0, 0, 1),
    frame,
  });
}

let lowest = Infinity;
for (const character of npcs.all) {
  lowest = Math.min(lowest, character.position.y);
  if (character.position.y < FLOOR_OF_THE_WORLD) {
    problems.push(
      `${character.name} is at y=${character.position.y.toFixed(2)} m after ${SETTLE_SECONDS} s — ` +
        `below ${FLOOR_OF_THE_WORLD} m, i.e. falling through the world`,
    );
  }
}

// Every resident should also still be in the room they belong to.
for (const resident of hotel.residents) {
  const first = resident.waypoints[0];
  if (!first) {
    problems.push(`${resident.name} has no waypoints at all`);
    continue;
  }
  const room = ROOMS.find((r) => Math.hypot(first.x - r.originX, first.z - r.originZ) < 40);
  if (!room) {
    problems.push(`${resident.name}'s circuit is not in any room`);
    continue;
  }
  for (const point of resident.waypoints) {
    const probe = new Vector3(point.x, 0, point.z);
    collision.resolve(probe, NPC_RADIUS);
    const pushed = Math.hypot(probe.x - point.x, probe.z - point.z);
    if (pushed > 0.01) {
      problems.push(
        `${resident.name} has a waypoint inside something solid at ` +
          `(${point.x.toFixed(1)}, ${point.z.toFixed(1)}) — pushed ${pushed.toFixed(2)} m`,
      );
    }
  }
}

// ------------------------------------------------------- 2/3. solid and soft

/** How far a player-sized body standing on this spot is pushed out of it. */
function deflection(worldX: number, worldZ: number): number {
  const probe = new Vector3(worldX, 0, worldZ);
  collision.resolve(probe, PLAYER_RADIUS);
  return Math.hypot(probe.x - worldX, probe.z - worldZ);
}

// The play boundary is the leash for the space you are in, and a probe out at
// the hotel is not in the park — so it is turned off here rather than left to
// answer for the furniture. (See `BOUNDARY_LEASH_REACH` in `Collision.ts`.)
collision.setPlayBounds({ radius: 1e6, distanceToEdge: () => 1e6 });

const mustBeSolid: readonly [string, number, number][] = [
  // On the axis south of the arch (the imperial relayout) — the walk-through
  // runs entrance → statue medallion → under the arch, and you go round it.
  // z carries `LOBBY_FOYER_GROWTH` and, since 18 Aug 2026's reception-room
  // split, `RECEPTION_ORIGIN_SHIFT` too (both `layout.ts`), same as the
  // statue itself — this literal duplicates `Hotel.ts`'s `STATUE_Z`, which
  // is exactly the "two definitions of one thing" trap CLAUDE.md warns
  // about, but `STATUE_Z` is a private `const` inside `dressLobby` with
  // nothing exported to import instead.
  ['the lobby RiPika statue', LOBBY.originX + 0, LOBBY.originZ + 4.6 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT],
  // Reception stands in the entrance foyer now, a few strides inside the
  // front door (issue #270) — imported from `Hotel.ts` rather than typed
  // again beside it, because a second literal here is exactly how the *last*
  // relayout went stale: this line kept the desk's old spot after the desk
  // moved, and it kept passing anyway because that old spot happened to sit
  // inside the staircase's own solid wedge. Probe 13 separately asserts the
  // interact zone is anchored on this same footprint.
  ['the reception desk', LOBBY.originX + RECEPTION_X, LOBBY.originZ + RECEPTION_Z],
  // z carries `LOBBY_FOYER_GROWTH` and `RECEPTION_ORIGIN_SHIFT`, same as the sofa itself.
  ['a lobby sofa', LOBBY.originX + 5.9, LOBBY.originZ + 4.8 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT],
  // z carries `LOBBY_FOYER_GROWTH` (−) and `RECEPTION_ORIGIN_SHIFT` (−) with
  // the rest of the hall it stands in.
  ['a lobby crystal column', LOBBY.originX - 11.9, LOBBY.originZ - 6.6 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT],
  ['a Floor 12 hedge', GARDEN_FLOOR.originX - 6.4, GARDEN_FLOOR.originZ - 6.4],
  ['a Floor 12 bench', GARDEN_FLOOR.originX + 2.2, GARDEN_FLOOR.originZ + 5.2],
  ['a Floor 33 seaweed clump', OCEAN_FLOOR.originX - 8.4, OCEAN_FLOOR.originZ - 6.4],
  ['a Floor 33 bench', OCEAN_FLOOR.originX + 0, OCEAN_FLOOR.originZ + 5.4],
  // Table b1-a's spot — moved 8 Aug 2026 for the tap-spacing rule; if it
  // moves again, `dressBreakfast`'s table list is the owner to copy from.
  ['a breakfast table', BREAKFAST.originX - 6.4, BREAKFAST.originZ + 6.2],
  ['the buffet counter', BREAKFAST.originX + 1.5, BREAKFAST.originZ - 7.4],
  ['a Floor 50 pet plinth', CORRIDOR.originX - 7.5, CORRIDOR.originZ - CORRIDOR.halfZ + 1.4],
  ['a suite bedside table', SUITE.originX + (SUITE_BEDSIDE_X[0] ?? 0), SUITE.originZ + SUITE_BEDSIDE_Z],
];
for (const [what, x, z] of mustBeSolid) {
  if (deflection(x, z) < 0.1) problems.push(`${what} is not solid — a child walks straight through it`);
}

// A breakfast chair, found the way the game finds one: from the table it was
// built around, so this cannot drift if the layout does.
//
// **Probed 0.4 m beyond the chair's own centre, on purpose.** A chair sits
// 1.05 m from its table, and a player-sized body at the chair's centre is
// already inside the *table's* reach (0.6 + 0.62 = 1.22 m) — so the obvious
// probe passes whether the chair is solid or not, and it did: making the chair
// soft left this check green. That is CLAUDE.md's "green can mean incapable of
// failing", caught by mutating it. Out here the table cannot reach (1.45 m)
// and the chair still can (0.4 m against 0.3 + 0.62), so the answer is about
// the chair.
const chairYaw = 0.34;
const chairX = BREAKFAST.originX - 6.4 + Math.sin(chairYaw) * 1.45;
const chairZ = BREAKFAST.originZ + 6.2 + Math.cos(chairYaw) * 1.45;
if (deflection(chairX, chairZ) < 0.1) {
  problems.push('a breakfast chair is not solid — Jim asked for exactly this one');
}

// -------------------------------------------- 11. furniture is landable-on
//
// Jim, live play, 7 Aug 2026: *"jumping is also very underpowered in the
// hotel... I can't even jump onto a sofa that's much less tall than my jump —
// I should be able to jump onto any solid item that's not too high."* Root
// cause: every prop went through `place.ts` with the default
// `topHeight = Infinity`, making a 0.5 m sofa an infinitely tall pillar.
//
// Three claims per exemplar prop, each asked of the built world:
//  * solid from the floor (the existing mustBeSolid probes above);
//  * **yielding to feet on its top** — a probe stood at the prop's own top
//    height is not pushed, which is what lets her stand there;
//  * **standable** — `WalkSurfaces.sample` offers a surface on it.
// Plus a sweep: no circle collider inside any hotel room may be infinitely
// tall, so the next prop placed cannot regress to a pillar silently.
//
// Proven red before trusted green, on the pre-fix build: the sofa-top probe
// was deflected 1.10 m, the sofa sample said 0.00 m, and the sweep counted
// 76 infinite pillars.
function deflectionAt(worldX: number, worldY: number, worldZ: number): number {
  const probe = new Vector3(worldX, worldY, worldZ);
  collision.resolve(probe, PLAYER_RADIUS);
  return Math.hypot(probe.x - worldX, probe.z - worldZ);
}

const mustBeMountable: readonly [string, number, number, number][] = [
  ['a lobby sofa', LOBBY.originX + 5.9, LOBBY.originZ + 4.8 + LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT, SOFA_SEAT_TOP],
  ['the buffet counter', BREAKFAST.originX + 1.5, BREAKFAST.originZ - 7.4, BUFFET_TOP],
  ['a breakfast table', BREAKFAST.originX - 6.4, BREAKFAST.originZ + 6.2, 0.74],
  ['a Floor 50 pet plinth', CORRIDOR.originX - 7.5, CORRIDOR.originZ - CORRIDOR.halfZ + 1.4, 0.4],
];
for (const [what, x, z, top] of mustBeMountable) {
  const atop = deflectionAt(x, top + 0.05, z);
  if (atop > 0.01) {
    problems.push(
      `${what} pushes a child stood on its own ${top.toFixed(2)} m top ${atop.toFixed(2)} m ` +
        `sideways — solid and standable are still fighting each other`,
    );
  }
  const surface = world.building.surfaces.sample(x, z, top + 0.5);
  if (surface < top - 0.05) {
    problems.push(
      `${what} has no standing surface: sample says ${surface.toFixed(2)} m where its top is ` +
        `${top.toFixed(2)} m — she can jump over it but never onto it`,
    );
  }
}

let infinitePillars = 0;
collision.forEachCircle((x, z, _radius, topHeight) => {
  const inHotelRoom = ROOMS.some(
    (room) =>
      Math.abs(x - room.originX) <= room.halfX + 4 && Math.abs(z - room.originZ) <= room.halfZ + 4,
  );
  if (inHotelRoom && !Number.isFinite(topHeight)) infinitePillars += 1;
});
if (infinitePillars > 0) {
  problems.push(
    `${infinitePillars} hotel prop collider(s) are infinitely tall pillars — every prop must ` +
      `register its real top so a jump can carry a child onto it (world/hotel/place.ts)`,
  );
}

// Read off `layout.ts` rather than copied: these three pairs used to live here
// as literals, and the day the suite became four rooms every one of them went
// stale at once — six failures about beds that had simply moved.
for (const [index, spot] of SUITE_BED_SPOTS.entries()) {
  const what = `bed ${index + 1}`;
  const x = SUITE.originX + spot[0];
  const z = SUITE.originZ + spot[1];
  if (deflection(x, z) > 0.01) {
    problems.push(
      `${what} is solid — it is a walk surface, so a child stood on it would be shoved off ` +
        `(see world/hotel/place.ts). Jumpy-jumpy is Eleri's.`,
    );
  }
  const top = world.building.surfaces.sample(x, z, 1);
  if (top < 0.4) problems.push(`${what} has no standing surface — sample says ${top.toFixed(2)} m`);

  // **Each bed is in its own bedroom**, not in a partition. The suite's
  // internal walls and its beds are two lists in `layout.ts`, and nothing but
  // this stops somebody moving one without the other — which would put a bed
  // half inside a wall, looking almost right from above and unusable from
  // inside. Measured against the built collision world, so it is about where
  // the wall actually went.
  if (deflection(x, z + 1.3) > 0.01 && deflection(x, z - 1.3) > 0.01) {
    problems.push(
      `${what} is boxed in at (${spot[0]}, ${spot[1]}) — solid within 1.3 m on both sides, so it ` +
        `is standing in a partition rather than in a bedroom`,
    );
  }
}

// ------------------------------------------ 3b. every pet bed slot is usable
//
// Issue #275: a small pet bed for every pet she owns, one per
// `layout.ts`'s `petBedSlots(count)` slot. `store.ts` puts **no ceiling** on
// how many pets a child can own, so review on #279 found the original
// hand-typed, fixed-length slot list placing every pet past its own length
// at the exact same coordinates as the last slot — identical, overlapping
// bed and pet meshes, not graceful degradation. This checks the function
// itself at several counts, including well past the shop's four species —
// 1 (the fresh-save fallback), 8 (what the review specifically asked to be
// exercised), 20 (well into the bedroom's real 27-slot capacity — 28 raw
// tile positions, minus one `clearsDoorways` throws out for grazing the hall
// doorway's own zone at this room's geometry) and 30 (past that capacity,
// proving the cap degrades by drawing *fewer* beds than requested rather
// than by overlapping two of them) — proving by pure
// geometry, for every count, that no two returned slots coincide or
// overlap, every slot clears the human bed, its bedside table and every
// doorway, and every slot stays on the bedroom's own real floor (derived
// the same way `Hotel.dressPetBeds` derives it — `clearFloorAround`, never
// a hand-typed wall position, so a future move of the bedroom's own walls
// cannot go unnoticed here either).
{
  const doors = doorwayClearanceZones(SUITE, PLAYER_RADIUS);
  const humanBed = SUITE_BED_SPOTS[1] ?? [0, 0];
  const bedsideX = SUITE_BEDSIDE_X[1] ?? 0;

  for (const count of [1, 8, 20, 30]) {
    const slots = petBedSlots(count);
    if (slots.length > count) {
      problems.push(`petBedSlots(${count}) returned ${slots.length} slots — more than asked for`);
      continue;
    }
    if (slots.length < count && count <= 27) {
      problems.push(
        `petBedSlots(${count}) returned only ${slots.length} slots, short of the bedroom's own ` +
          `27-slot capacity (28 raw tile positions minus one doorway-zone reject) — a slot ` +
          `generator regression, not real capacity`,
      );
    }
    for (const [index, slot] of slots.entries()) {
      const { x, z } = slot;
      const bounds = { x, z, radius: PET_BED_FOOTPRINT_RADIUS };
      if (!isClearOfDoorways(bounds, doors)) {
        problems.push(
          `petBedSlots(${count})[${index}] at local (${x.toFixed(2)}, ${z.toFixed(2)}) sits ` +
            `inside a doorway's clearance zone — a bed there would leave the hall too narrow to use`,
        );
      }
      // Clear of the bedroom's own real floor — the two partitions either
      // side of it, derived exactly the way `petBedSlots` itself derives
      // them, not a copy of their positions.
      const rect = clearFloorAround(SUITE, 0, z);
      if (x - PET_BED_FOOTPRINT_RADIUS < rect.minX || x + PET_BED_FOOTPRINT_RADIUS > rect.maxX) {
        problems.push(
          `petBedSlots(${count})[${index}] at local (${x.toFixed(2)}, ${z.toFixed(2)}) reaches ` +
            `past the bedroom's own wall (clear floor is ${rect.minX.toFixed(2)}…${rect.maxX.toFixed(2)})`,
        );
      }
      // Clear of the human bed ({@link SUITE_BED_HALF_X}/{@link SUITE_BED_HALF_Z}
      // half-extents) and its bedside table ({@link SUITE_BEDSIDE_RADIUS}),
      // both at z ≈ SUITE_BEDSIDE_Z — the same three numbers `dressSuite`
      // itself places them with, not a fresh copy (review on #279 found this
      // probe's first draft hardcoding its own 0.7/1/0.36).
      const bedDX = Math.max(Math.abs(x - humanBed[0]) - SUITE_BED_HALF_X, 0);
      const bedDZ = Math.max(Math.abs(z - humanBed[1]) - SUITE_BED_HALF_Z, 0);
      if (Math.hypot(bedDX, bedDZ) < PET_BED_FOOTPRINT_RADIUS) {
        problems.push(
          `petBedSlots(${count})[${index}] at local (${x.toFixed(2)}, ${z.toFixed(2)}) overlaps ` +
            `the human bed`,
        );
      }
      if (Math.hypot(x - bedsideX, z - SUITE_BEDSIDE_Z) < PET_BED_FOOTPRINT_RADIUS + SUITE_BEDSIDE_RADIUS) {
        problems.push(
          `petBedSlots(${count})[${index}] at local (${x.toFixed(2)}, ${z.toFixed(2)}) overlaps ` +
            `its bedside table`,
        );
      }
      // Clear of every other slot at this same count — the actual bug #279's
      // review found: every pet past the list's own length landing on top
      // of the last one.
      for (const other of slots.slice(index + 1)) {
        if (Math.hypot(x - other.x, z - other.z) < PET_BED_FOOTPRINT_RADIUS * 2) {
          problems.push(
            `petBedSlots(${count}) has two slots within ${(PET_BED_FOOTPRINT_RADIUS * 2).toFixed(2)} m ` +
              `of each other, at (${x.toFixed(2)}, ${z.toFixed(2)}) and ` +
              `(${other.x.toFixed(2)}, ${other.z.toFixed(2)}) — their beds would overlap`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------- 4. windows

let panes = 0;
let declared = 0;
for (const room of ROOMS) {
  const shell = hotel.hotelRoot.children.find((child) => child.name === `hotel:${room.space}`);
  const built = shell ? shell.children.filter((child) => child.name === 'hotel.window').length : 0;
  const wanted = Object.values(room.windows).reduce((total, wall) => total + wall.at.length, 0);
  panes += built;
  declared += wanted;
  if (built !== wanted) {
    problems.push(
      `${room.space} declares ${wanted} window panes but built ${built} — ` +
        (built < wanted
          ? 'one landed in a doorway or off the end of a wall and was dropped'
          : 'one straddles a doorway and came out as two halves of a window'),
    );
  }
  if (wanted === 0) problems.push(`${room.space} has no windows at all`);
}

// ------------------------------------------------- 5. every room is findable
//
// **A room the position test cannot see does not exist.** Every hotel room is
// its own space at its own far-off origin, and `spaceAt` is the *only* thing
// that turns a coordinate back into a room: `Hotel.currentRoom` asks it, and
// so does the floor pill, the lift's `floors()` and every interact zone.
//
// The trap this closes is specific and was live in this repo until Floor 12
// and Floor 33 landed: the room→origin table existed **twice**, once in
// `spaces.ts`'s `ORIGINS` and once written out again inside `spaceAt` itself.
// A floor added to only one of them builds, lights, furnishes and dresses
// perfectly, and then the lift drops you into a room the game thinks is the
// garden — no pill, no zones, no way back. Nothing else in this check would
// have noticed, because every other assertion here is about geometry.
for (const room of ROOMS) {
  const found = spaceAt(room.originX, room.originZ);
  if (found !== room.space) {
    problems.push(
      `${room.space}'s own origin reports as '${found}' — spaceAt cannot see this room, so the ` +
        `lift lands in it and the game believes she is somewhere else`,
    );
  }
}

// …and every lift button points at a room that is really there.
HOTEL_FLOORS.forEach((floor, index) => {
  if (floor.room.liftFloor !== index && ROOMS.every((room) => room.liftFloor !== index)) {
    problems.push(
      `lift button ${index} ('${floor.name}') is not the lift floor of any room — ` +
        `HOTEL_FLOORS was reordered without fixing the rooms' liftFloor indexes`,
    );
  }
});

// ------------------------------------------- 6. the composition holds her up
//
// The imperial rework's facts, each measured on the built lobby:
//  * the gallery deck and the landing are standable at their own heights;
//  * every flight climbs, tread by tread, and *ends on the level it serves* —
//    reaching the right height in mid-air beside the landing is the exact bug
//    this file caught on the first run after the original stair landed;
//  * the arch under the landing is genuinely open: a walker crosses the whole
//    room on the axis, entrance to north wall, and is never pushed;
//  * the banded balustrades hold **both ways**: a deck-height body at the rail
//    is deflected, a ground body at the same XZ is not (Collision.ts
//    `baseHeight` — the mechanism the whole overhang design rests on).
//
// Proven red both ways on 9 Aug 2026: removing the banded rails greens the
// walk-through and lets the deck body sail off the edge (held-at-rail probe
// fails); registering them height-agnostic (base −Infinity) holds the deck
// body and *fails the axis march*, which stalls at the arch mouth at
// z ≈ −2.0 local.
const mezzanine = LOBBY.mezzanine;
if (!mezzanine) {
  problems.push('the lobby has no mezzanine — Jim asked for the imperial composition');
} else {
  const { landing, straight } = mezzanine;
  const deckX = LOBBY.originX + (mezzanine.minX + mezzanine.maxX) / 2;
  const deckZ = LOBBY.originZ + (mezzanine.minZ + mezzanine.maxZ) / 2;
  const top = world.building.surfaces.sample(deckX, deckZ, mezzanine.height);
  if (Math.abs(top - mezzanine.height) > 0.01) {
    problems.push(
      `the gallery deck is not standable: sample says ${top.toFixed(2)} m where the deck is ` +
        `${mezzanine.height.toFixed(2)} m`,
    );
  }
  // On the landing's open stage — between the front balustrade and the
  // straight flight's bottom riser. The landing's *centre* is under the
  // flight, whose first ramp slice answers instead (measured: 3.92).
  const landingX = LOBBY.originX + (landing.minX + landing.maxX) / 2;
  const landingZ = LOBBY.originZ + (landing.maxZ + straight.frontZ) / 2;
  const landingTop = world.building.surfaces.sample(landingX, landingZ, landing.height);
  if (Math.abs(landingTop - landing.height) > 0.01) {
    problems.push(
      `the landing is not standable: sample says ${landingTop.toFixed(2)} m where it is ` +
        `${landing.height.toFixed(2)} m`,
    );
  }

  // Each curve: every tread standable, each step within one stride of the
  // last, and the top tread ON the landing.
  for (const stair of mezzanine.stairs) {
    const hand = stair.toAngle > stair.fromAngle ? 'right' : 'left';
    const radius = (stair.innerRadius + stair.outerRadius) / 2;
    let previous = 0;
    for (let i = 0; i < stair.treads; i += 1) {
      const angle =
        stair.fromAngle + ((stair.toAngle - stair.fromAngle) * (i + 0.5)) / stair.treads;
      const x = LOBBY.originX + stair.centreX - Math.sin(angle) * radius;
      const z = LOBBY.originZ + stair.centreZ + Math.cos(angle) * radius;
      const height = world.building.surfaces.sample(x, z, previous);
      if (height <= previous - 0.01) {
        problems.push(
          `the ${hand} curve's tread ${i} does not rise: sample says ${height.toFixed(2)} m, ` +
            `standing on ${previous.toFixed(2)} m — the flight cannot be climbed past here`,
        );
        break;
      }
      previous = height;
    }
    // The last tread's *mid* sits inside its own ramp slices (a quarter or
    // half riser shy of the top — that is the slices working), so the "tops
    // out" claim is made where the flight actually delivers her: one stride
    // past the top tread, on the landing, along the climb direction — the
    // same point the nav connector exits at. This is also the mid-air check:
    // a curve swept about the wrong centre climbs perfectly and its exit
    // point simply is not the landing.
    const sign = Math.sign(stair.toAngle - stair.fromAngle);
    const exitX = stair.centreX - Math.sin(stair.toAngle) * radius - Math.cos(stair.toAngle) * 1.2 * sign;
    const exitZ = stair.centreZ + Math.cos(stair.toAngle) * radius - Math.sin(stair.toAngle) * 1.2 * sign;
    const delivered = world.building.surfaces.sample(
      LOBBY.originX + exitX,
      LOBBY.originZ + exitZ,
      previous,
    );
    if (Math.abs(delivered - landing.height) > 0.01) {
      problems.push(
        `the ${hand} curve delivers onto ${delivered.toFixed(2)} m at (${exitX.toFixed(1)}, ` +
          `${exitZ.toFixed(1)}), but the landing is at ${landing.height.toFixed(2)} m — the ` +
          `flight climbs and stops in mid-air beside the landing`,
      );
    }
  }

  // The straight flight: landing to gallery, same tread-by-tread claim.
  {
    let previous = landing.height;
    const run = straight.frontZ - mezzanine.maxZ;
    for (let i = 0; i < straight.treads; i += 1) {
      const z = LOBBY.originZ + straight.frontZ - (run * (i + 0.5)) / straight.treads;
      const x = LOBBY.originX + straight.centreX;
      const height = world.building.surfaces.sample(x, z, previous);
      if (height <= previous - 0.01) {
        problems.push(
          `the straight flight's tread ${i} does not rise: sample says ${height.toFixed(2)} m, ` +
            `standing on ${previous.toFixed(2)} m`,
        );
        break;
      }
      previous = height;
    }
    // Same delivered-onto claim as the curves: one stride past the top edge,
    // on the gallery deck.
    const delivered = world.building.surfaces.sample(
      LOBBY.originX + straight.centreX,
      LOBBY.originZ + mezzanine.maxZ - 1.2,
      previous,
    );
    if (Math.abs(delivered - mezzanine.height) > 0.01) {
      problems.push(
        `the straight flight delivers onto ${delivered.toFixed(2)} m but the gallery is at ` +
          `${mezzanine.height.toFixed(2)} m`,
      );
    }
  }

  // **The arch is a walk-through.** A ground body marched up the doorway
  // crosses the whole room — under the landing, through the colonnade, to
  // the north wall — without being pushed off the line. This is the
  // see-through Jim asked for, as a walk; a naive (height-agnostic)
  // balustrade collider stalls it at the arch mouth, measured before the
  // banded mechanism landed.
  //
  // **Marched at `LOBBY_HALL_DOOR_X`, not the room's own x = 0 axis.** Issue
  // #270's own fix moved the foyer/hall doorway off the promenade axis (that
  // constant's own doc in `layout.ts`), specifically so it would *not* line
  // up with the statue's footprint any more — so a walker on the true axis
  // now meets solid partition, by design, and this probe would be measuring
  // the thing #270 deliberately built rather than a bug. The colonnade
  // itself stays open underneath the whole gallery width, so the walk-through
  // still holds off-axis.
  {
    const AXIS_X = LOBBY.originX + LOBBY_HALL_DOOR_X;
    const probe = new Vector3(AXIS_X, 0, LOBBY.originZ + 2);
    const steps = Math.ceil((2 - (-LOBBY.halfZ + 1.2)) / 0.05);
    for (let step = 0; step < steps; step += 1) {
      probe.z -= 0.05;
      collision.resolve(probe, PLAYER_RADIUS);
    }
    const reachedZ = probe.z - LOBBY.originZ;
    if (reachedZ > -LOBBY.halfZ + 2.0) {
      problems.push(
        `a walker on the doorway line is stopped at local z = ${reachedZ.toFixed(2)} — the arch ` +
          `under the landing is not a walk-through (something invisible stands in it)`,
      );
    }
    if (Math.abs(probe.x - AXIS_X) > 0.5) {
      problems.push(
        `a walker on the doorway line is pushed ${(probe.x - AXIS_X).toFixed(2)} m sideways — ` +
          `the arch is not clear on that line`,
      );
    }

    // …and `Hotel.update` must leave her there. The resolver march above
    // passed on 9 Aug 2026 while the LIVE walk reset to the room's origin at
    // z ≈ −7.5 on every attempt: the old solid-mass rescue net still covered
    // the mezzanine rectangle, which the colonnade made honest floor. A
    // frame's update on a player standing in the colonnade must not move her.
    // z carries `LOBBY_FOYER_GROWTH` (−) with the rest of the hall she is
    // standing in — the colonnade this once probed at local z = −9 is now
    // 7 m further north.
    {
      const walker = {
        position: new Vector3(LOBBY.originX, 0, LOBBY.originZ - 9 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT),
        riding: false,
        model: { setExpression: () => {} },
        teleportTo(x: number, y: number, z: number) {
          walker.position.set(x, y, z);
        },
      };
      hotel.attachPlayer(walker as never);
      hotel.adoptRestoredPlayer();
      hotel.update({ dt: 1 / 60, elapsed: 0 } as never);
      const moved = Math.hypot(
        walker.position.x - LOBBY.originX,
        walker.position.z - (LOBBY.originZ - 9 - LOBBY_FOYER_GROWTH - RECEPTION_ORIGIN_SHIFT),
      );
      if (moved > 0.05) {
        problems.push(
          `a frame of Hotel.update moved a walker standing in the colonnade ${moved.toFixed(2)} m ` +
            `(to y=${walker.position.y.toFixed(2)}) — a stale rescue net is teleporting her off ` +
            `her own room's floor`,
        );
      }
    }
  }

  // **Every guarded edge, walked off, at every level.** Not a hand-picked
  // few: `mezzanineGuardedEdges` is the same schedule `Hotel` builds the
  // rails from, so an edge that exists in the room is an edge that is tested
  // here, and adding an edge to the plan without guarding it is a red test.
  //
  // The three spot checks this replaces passed while the landing's **north**
  // edge had no collider at all at landing height: the gallery's balustrade
  // is drawn on that line but banded to its own 4.94 m, so a child on the
  // landing at 3.84 m walked through the rail she could see and fell 3.84 m
  // to the lobby floor. Nothing had ever told the check that edge existed —
  // CLAUDE.md's "a check can pass without checking anything", in the geometry
  // rather than in the assertion.
  //
  // Both directions, as before: the rail must hold a body at its own deck's
  // height, and must not touch a ground body at the same XZ, or the arch
  // stops being a walk-through.
  for (const edge of mezzanineGuardedEdges(mezzanine, STAIR_RAIL_RADIUS)) {
    const length = Math.hypot(edge.x2 - edge.x1, edge.z2 - edge.z1);
    if (length < 0.01) continue;
    // Sample along the span rather than at one point: a rail can be present
    // for most of an edge and absent over the stretch that matters.
    // Stand well clear of the rail to begin with — a body started inside the
    // rail's own fattened zone is already overlapping it, and the resolver
    // may push it *either* way out, which reads as a walk-through that never
    // happened. And keep off the ends, where the room's perimeter walls and
    // the flight's flanks stand.
    const inset = 0.7;
    const usable = length - inset * 2;
    if (usable <= 0) continue;
    const samples = Math.max(1, Math.ceil(usable / 0.9));
    const ux = (edge.x2 - edge.x1) / length;
    const uz = (edge.z2 - edge.z1) / length;
    for (let i = 0; i <= samples; i += 1) {
      const along = inset + (usable * i) / samples;
      const startX = LOBBY.originX + edge.x1 + ux * along - edge.outwardX * 0.9;
      const startZ = LOBBY.originZ + edge.z1 + uz * along - edge.outwardZ * 0.9;
      // Walk her off it the way the game moves her: many small steps, each
      // one resolved, not one 0.6 m teleport.
      const body = new Vector3(startX, edge.deckHeight, startZ);
      for (let step = 0; step < 30; step += 1) {
        collision.resolveMovement(
          body,
          edge.outwardX * 0.06,
          edge.outwardZ * 0.06,
          PLAYER_RADIUS,
          0,
          1 / 60,
        );
      }
      // How far past the edge line she ended up, along the outward normal.
      const past =
        (body.x - (LOBBY.originX + edge.x1)) * edge.outwardX +
        (body.z - (LOBBY.originZ + edge.z1)) * edge.outwardZ;
      if (past > -0.1) {
        problems.push(
          `${edge.what} lets a body at ${edge.deckHeight.toFixed(2)} m walk ` +
            `${past.toFixed(2)} m past the edge at ` +
            `(${(body.x - LOBBY.originX).toFixed(1)}, ${(body.z - LOBBY.originZ).toFixed(1)}) ` +
            `— she falls ${edge.deckHeight.toFixed(2)} m to the floor through a rail she can see`,
        );
        break;
      }
    }
    // …and the other direction, which is what `baseHeight` exists for: the
    // rail must be nothing at all to anyone on the floor below, or the arch
    // stops being a walk-through.
    //
    // Asserted on the **band itself** rather than by standing a body under
    // it. A body sampled along a 26 m edge meets planters, sofas, columns and
    // the curves' own masonry, all of which are supposed to block it — so
    // that version of the test measured the room's furniture and failed on
    // five edges that were perfectly correct. The band is the property that
    // actually decides it, and it cannot be confounded. (That the arch is
    // genuinely walkable end to end is probe 6's axis walk, above.)
    if (edge.base <= JUMP_APEX_HEIGHT) {
      problems.push(
        `${edge.what} is banded at ${edge.base.toFixed(2)} m, within reach of a ground jump ` +
          `(apex ${JUMP_APEX_HEIGHT.toFixed(2)} m) — it would be an invisible wall under the ` +
          `overhang, which is the exact disease baseHeight exists to cure`,
      );
    }
  }
}

// -------------------------------------------- 7. you can stand and look
//
// **Every painting has somewhere to stand in front of it.** "Look!" walks her
// to a point 1.9 m off the wall and then flies the camera in; a picture hung
// behind the buffet, a sofa or a crystal column gives her a stand point inside
// something solid, and the walk simply never arrives — a chip that does
// nothing, which is the worst thing a button can do to a six-year-old.
//
// Asked of the built collision world, at the player's own girth, and taken
// from `Hotel` itself rather than recomputed here so the check cannot agree
// with a stale copy of the arithmetic.
for (const stand of hotel.artworkStands) {
  if (deflection(stand.x, stand.z) > 0.01) {
    problems.push(
      `a painting's viewing spot at (${stand.x.toFixed(1)}, ${stand.z.toFixed(1)}) is inside ` +
        `something solid — "Look!" would walk her into furniture and never arrive`,
    );
  }
}

// …and the five shared canvases really are shared. §7 caps the whole game at
// forty textures; thirteen paintings drawing thirteen of them would be a third
// of the budget spent on wall art nobody asked to be unique.
const distinctArt = new Set(hotel.artworkStands.map((stand) => stand.art));
if (distinctArt.size > 5) {
  problems.push(
    `the hotel hangs ${distinctArt.size} distinct artworks — the budget is five shared canvases ` +
      `(ART_DIRECTION §7 caps the game at forty textures)`,
  );
}

// ------------------------------------------- 8. the windows look somewhere
//
// The view out of a hotel window is fetched from four hundred metres away —
// the camera goes to the tower's real place in the park at this storey's
// proportional height (see `Hotel.windowVantage`). Two things have to hold, and
// neither is obvious from reading the formula:
//
//  * the vantage is **on the tower**, not underground and not above its tip;
//  * a higher floor really does look from higher up, which is the entire
//    reason the hotel has fifty storeys in its fiction.
const ground = world.building.surfaces.sample(
  placedEntry('hotel').x,
  placedEntry('hotel').z,
  3,
);
let previousStorey = -1;
let previousHeight = -Infinity;
for (const floor of HOTEL_FLOORS) {
  const eye = hotel.windowVantage(floor.room);
  if (eye.y < ground) {
    problems.push(`${floor.name}'s window looks out from ${eye.y.toFixed(1)} m — below the ground`);
  }
  if (eye.y > ground + 28.1) {
    problems.push(
      `${floor.name}'s window looks out from ${eye.y.toFixed(1)} m — above the top of a 28 m tower`,
    );
  }
  if (floor.storey > previousStorey && eye.y <= previousHeight) {
    problems.push(
      `${floor.name} (storey ${floor.storey}) looks out from ${eye.y.toFixed(1)} m, no higher than ` +
        `the floor below it at ${previousHeight.toFixed(1)} m — the storeys are not stacked`,
    );
  }
  previousStorey = floor.storey;
  previousHeight = eye.y;
}

// ------------------------------------------------- 5. the locked suite door

// Jim, live play, 7 Aug 2026: *"if you don't have the key, the corridor to
// your room lets you walk through the door and then fall into a void."* The
// lock was a trigger in `checkDoorways`, and its own refusal cooldown gated
// the very check that was the lock — so a second push walked through the open
// doorway and off the floor slab. Now the lock is a collision wall, and this
// walks into it the way she did: a player-sized probe marched at the doorway
// in 5 cm steps, resolved by the collision world after each one.
function marchAtSuiteDoor(): number {
  const probe = new Vector3(CORRIDOR.originX + CORRIDOR.halfX - 3, 0, CORRIDOR.originZ);
  for (let step = 0; step < 120; step += 1) {
    probe.x += 0.05;
    collision.resolve(probe, PLAYER_RADIUS);
  }
  return probe.x - (CORRIDOR.originX + CORRIDOR.halfX);
}

const keylessReach = marchAtSuiteDoor();
if (keylessReach > -0.5) {
  problems.push(
    `without the key, a march at the suite door reaches ${keylessReach.toFixed(2)} m past ` +
      `the wall plane it should be held at least 0.5 m short of — the door is not locked`,
  );
}

// And the key must actually open it: grant it, let one frame turn the lock,
// and the same march must now pass clean through the doorway.
saveFlags.giveHotelKey();
hotel.update({ dt: 1 / 60, elapsed: 0 } as never);
const keyedReach = marchAtSuiteDoor();
if (keyedReach < 1) {
  problems.push(
    `with the key, the same march stops ${(-keyedReach).toFixed(2)} m short of the doorway — ` +
      `the suite door never unlocks`,
  );
}

// ------------------------------------- 10. the deck plane has exactly one owner
//
// Jim, live play, 7 Aug 2026: *"the mezzanine level flickers like crazy on
// the floor due to two faces overlapping."* Measured cause: the deck slab's
// top, the gallery's front and side face tops and the final stair tread's top
// were all built at exactly y = 3.2 with overlapping footprints — four
// authors of one plane, so the renderer dithers between them per pixel.
//
// This scans every BoxGeometry mesh in the lobby shell and reports any two
// whose world-space top faces are coplanar (within half a millimetre) in the
// deck's own band *and* overlap in plan by more than a sliver. Scoped to the
// deck band on purpose: wall-corner joins share their (much higher) top edges
// too, and unpicking every T-joint in the hotel is not what Jim reported.
//
// Proven red before trusted green: on the unfixed build it reported five
// pairs, the largest 'both top at y=3.200 m and overlap 3.87 m^2 in plan'.
{
  hotel.hotelRoot.updateMatrixWorld(true);
  const shell = hotel.hotelRoot.children.find((child) => child.name === `hotel:${LOBBY.space}`);
  // Two walking planes now — the landing and the gallery deck — so two bands,
  // each around its own slab top.
  const landingY = LOBBY.mezzanine?.landing.height ?? 0;
  const deckY = LOBBY.mezzanine?.height ?? 0;
  for (const deckBand of [
    [landingY - 0.35, landingY + 0.1],
    [deckY - 0.35, deckY + 0.1],
  ] as const) {
    const tops: { readonly what: string; readonly box: Box3 }[] = [];
    shell?.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      if (object.geometry.type !== 'BoxGeometry') return;
      object.geometry.computeBoundingBox();
      const bounds = object.geometry.boundingBox;
      if (!bounds) return;
      const box = bounds.clone().applyMatrix4(object.matrixWorld);
      if (box.max.y < deckBand[0] || box.max.y > deckBand[1]) return;
      tops.push({ what: object.name || object.parent?.name || 'a box', box });
    });
    for (let a = 0; a < tops.length; a += 1) {
      for (let b = a + 1; b < tops.length; b += 1) {
        const one = tops[a]!;
        const two = tops[b]!;
        if (Math.abs(one.box.max.y - two.box.max.y) > 5e-4) continue;
        const overlapX =
          Math.min(one.box.max.x, two.box.max.x) - Math.max(one.box.min.x, two.box.min.x);
        const overlapZ =
          Math.min(one.box.max.z, two.box.max.z) - Math.max(one.box.min.z, two.box.min.z);
        if (overlapX < 0.03 || overlapZ < 0.03) continue;
        problems.push(
          `mezzanine z-fight: two slab-like faces both top at y=${one.box.max.y.toFixed(3)} m and ` +
            `overlap ${(overlapX * overlapZ).toFixed(2)} m^2 in plan — the deck plane needs one owner`,
        );
      }
    }
  }
}

// ---------------------------------------- 12. no painting hangs over a window
//
// Jim, live play, 7 Aug 2026: *"some paintings overlap the windows and clip
// into them."* Confirmed numerically by QA on the lobby's west wall: painting
// span 3.15–4.85 across a pane spanning 2.3–4.1 at overlapping heights.
// Pictures used to be hung with no knowledge of the glazing; now
// `Hotel.hangOnWalls` asks the same declared-pane authority `glazeWall`
// builds from and slides along the wall to clear the glass.
//
// Measured on the built scene, not the declarations: every 'hotel.artwork'
// group's world box against every 'hotel.window' pane's. Proven red before
// trusted green — pre-fix this reported exactly the lobby overlap above.
{
  hotel.hotelRoot.updateMatrixWorld(true);
  const panes2: Box3[] = [];
  const frames2: Box3[] = [];
  hotel.hotelRoot.traverse((object) => {
    if (object.name === 'hotel.window' && object instanceof Mesh) {
      object.geometry.computeBoundingBox();
      const bounds = object.geometry.boundingBox;
      if (bounds) panes2.push(bounds.clone().applyMatrix4(object.matrixWorld));
    }
    if (object.name === 'hotel.artwork') {
      frames2.push(new Box3().setFromObject(object));
    }
  });
  for (const frame of frames2) {
    for (const pane of panes2) {
      const shrunk = frame.clone().expandByScalar(-0.01);
      if (!shrunk.intersectsBox(pane)) continue;
      const centre = new Vector3();
      shrunk.getCenter(centre);
      problems.push(
        `a painting centred at (${centre.x.toFixed(1)}, ${centre.y.toFixed(1)}, ` +
          `${centre.z.toFixed(1)}) intersects a window pane — it is hung across the glass`,
      );
    }
  }
  if (frames2.length === 0) problems.push('no hotel.artwork groups found — the paintings are gone');
}

// ---------------------- 26. no painting hangs where the mezzanine hides it
//
// Issue #271, Jim: the lobby's paintings could be highlighted and "Look!"ed
// at while actually standing behind the gallery deck from the fixed camera's
// own point of view — the highlight and the interact zone are pure distance,
// with no idea a deck stands between the canvas and the lens. Root cause:
// both were declared on the north wall, and `LOBBY.mezzanine` reaches the
// *whole* width of that wall, so every point on it is permanently in the
// deck's shadow — not a placement mistake `hangOnWalls`' glass-and-doorway
// search would ever have caught, because it had never been taught the deck
// was a third kind of "spoken for".
//
// `Hotel.hangOnWalls`'s `clearOfGlass` now refuses a spot `mezzanineHidesPoint`
// calls hidden, the same way it already refuses one over glass or a doorway
// gap — this probe is the belt to that generator-time brace: it re-asks the
// same question of the **built** `hotel.artworks` list (never the layout
// declarations that produced it), against every room that has a mezzanine.
// Today only the lobby does; the loop is written for whichever room next
// grows one.
//
// Proven red before trusted green: reverting `clearOfGlass`'s mezzanine
// check while leaving the lobby's old north-wall picture declarations in
// place reproduces exactly the two hidden paintings this was written for.
for (const placement of hotel.artworkPlacements) {
  const plan = placement.room.mezzanine;
  if (!plan) continue;
  const localX = placement.x - placement.room.originX;
  const localY = placement.y;
  const localZ = placement.z - placement.room.originZ;
  if (mezzanineHidesPoint(plan, localX, localY, localZ)) {
    problems.push(
      `${placement.room.space}: a painting at local (${localX.toFixed(1)}, ${localY.toFixed(1)}, ` +
        `${localZ.toFixed(1)}) is hidden behind the mezzanine from the fixed camera — it can still ` +
        `be highlighted and "Look!"ed at, but there is never anything to see`,
    );
  }
}

// ------------------------------------------ 9. the close-ups keep their distance
//
// Jim, live play, 7 Aug 2026: the breakfast push-in *"often zooms in to
// inside the characters head"*. The old end pose was offset in **world** axes
// (`+0.9, +0.9`), so a chair facing south-west put the lens ~1.06 m from the
// diner — inside near-plane-plus-head range. Every shot the hotel can produce
// is measured here, exactly as the game would play it, against the machine's
// own MIN_SHOT_DISTANCE — and against the walls of the room it plays in,
// because an end pose outside the room is a camera in the void.
//
// Proven red before trusted green: with the world-axis formula in place this
// reported `shot food-b1-e-0 ends 1.09 m from its subject` — under the 1.10 m
// floor — before the chair-frame fix took it to a uniform 2.2 m.
for (const { id, room, shot } of hotel.cinematicShots) {
  const gap = shot.to.distanceTo(shot.lookAt);
  if (gap < MIN_SHOT_DISTANCE - 1e-6) {
    problems.push(
      `shot ${id} ends ${gap.toFixed(2)} m from its subject — closer than the ` +
        `${MIN_SHOT_DISTANCE.toFixed(2)} m the near plane plus a head needs`,
    );
  }
  const outX = Math.abs(shot.to.x - room.originX) - (room.halfX - 0.2);
  const outZ = Math.abs(shot.to.z - room.originZ) - (room.halfZ - 0.2);
  if (outX > 0 || outZ > 0) {
    problems.push(
      `shot ${id} ends ${Math.max(outX, outZ).toFixed(2)} m outside ${room.space}'s walls at ` +
        `(${shot.to.x.toFixed(1)}, ${shot.to.z.toFixed(1)}) — the camera would sit in a wall or the void`,
    );
  }
  if (shot.to.y < 0.35) {
    problems.push(`shot ${id} ends at y=${shot.to.y.toFixed(2)} m — in the floor`);
  }
}

// …and the machine itself refuses an end pose inside the subject, whatever a
// call site asks for. This is the belt to probe 9's braces: a *future* call
// site with bad arithmetic hits this clamp, not a child's face. Proven red by
// knocking the clamp out of `HotelCinematic.play` — the camera then holds
// 0.05 m from the subject.
{
  const fakeIso = {
    camera: { position: new Vector3(45, 55, 45) },
    focusPoint: new Vector3(0, 0, 0),
    viewHalfHeight: 7.5,
  } as never;
  const cine = new HotelCinematic(fakeIso);
  const subject = new Vector3(5, 1.2, 5);
  cine.play({
    from: new Vector3(8, 1.2, 5),
    to: new Vector3(5.05, 1.2, 5),
    lookAt: subject,
    easeSeconds: 0.01,
    holdSeconds: 0,
  });
  cine.update(1);
  const gap = cine.camera.position.distanceTo(subject);
  if (gap < MIN_SHOT_DISTANCE - 1e-6) {
    problems.push(
      `HotelCinematic accepted an end pose ${gap.toFixed(2)} m from its subject — the ` +
        `MIN_SHOT_DISTANCE clamp is not holding`,
    );
  }
}

// ------------------------------------------------- 6. the void backstop

// The doorway audit above proves the door; this proves the net under
// everything else. A player already 6 m below the corridor's floor — however
// they got there — must be stood back in the room within a frame, not left
// falling for ever.
const fallenPlayer = {
  position: new Vector3(CORRIDOR.originX, -6, CORRIDOR.originZ),
  // A double that is only ever *put* places, never walked: aliasing the two
  // makes every move it makes a teleport, which is exactly what it is — and
  // what `Hotel.checkDoorways`' swept test reads (`Player.previousPosition`).
  get previousPosition() {
    return fallenPlayer.position;
  },
  riding: false,
  model: { setExpression: () => {} },
  teleportTo(x: number, y: number, z: number) {
    fallenPlayer.position.set(x, y, z);
  },
};
hotel.attachPlayer(fallenPlayer as never);
hotel.adoptRestoredPlayer();
hotel.update({ dt: 1 / 60, elapsed: 0 } as never);
if (fallenPlayer.position.y < 0) {
  problems.push(
    `a player 6 m below the corridor floor is still at y=${fallenPlayer.position.y.toFixed(2)} m ` +
      `after a frame — the void backstop did not catch them`,
  );
}

// ------------------------------------- 13. the signs stand where the things are
//
// Jim, live play, 7 Aug 2026: *"the hotel reception suggests getting a key
// near the staircase."* QA's root cause: the reception zone hardcoded the
// desk's OLD spot (lobby local 5, −6.2 — beside the stair's bottom tread)
// while the desk itself had moved. So: the zone's anchor must stand **on the
// desk's own solid footprint**, asked of the collision world — one owner,
// measured, immune to the desk moving again.
//
// And the "yours" door's sign must actually be able to appear:
// `Selection.selectable` drops any zone whose `actions()` is empty, and the
// door zone deliberately returned [] — a sign that could never be shown.
//
// Proven red before trusted green: pre-fix, the zone anchor deflected 0.00 m
// (open floor beside the staircase) and the door zone offered 0 actions.
{
  fallenPlayer.position.set(LOBBY.originX, 0, LOBBY.originZ);
  const receptionZone = hotel.interactZones().find((zone) => zone.id === 'hotel-reception');
  if (!receptionZone) {
    problems.push('the lobby offers no reception zone at all');
  } else {
    // Solid alone is not proof it is the desk: the stale anchor sat inside
    // the *staircase* wedge, which is also solid — the first draft of this
    // probe passed on the broken build for exactly that reason. So: anchor
    // solid, anchor not on the stair's arc, and the stand spot walkable.
    if (deflection(receptionZone.x, receptionZone.z) < 0.1) {
      problems.push(
        `the reception zone's anchor at (${receptionZone.x.toFixed(1)}, ` +
          `${receptionZone.z.toFixed(1)}) is open floor, not the desk — its "get your key" sign ` +
          `floats somewhere else`,
      );
    }
    // "Not on a staircase" is radial band AND angular sweep now: the desk in
    // the east bay is radially inside the right arc's band but 90°+ outside
    // its quarter-turn, which is open floor. The radial test alone would
    // false-alarm on every legal spot east of the composition.
    for (const stair of LOBBY.mezzanine?.stairs ?? []) {
      const dx = receptionZone.x - (LOBBY.originX + stair.centreX);
      const dz = receptionZone.z - (LOBBY.originZ + stair.centreZ);
      const toStair = Math.hypot(dx, dz);
      const angle = Math.atan2(-dx, dz);
      const lo = Math.min(stair.fromAngle, stair.toAngle) - 0.35;
      const hi = Math.max(stair.fromAngle, stair.toAngle) + 0.35;
      if (
        toStair > stair.innerRadius - 0.8 &&
        toStair < stair.outerRadius + 0.8 &&
        angle >= lo &&
        angle <= hi
      ) {
        problems.push(
          `the reception zone's anchor is ${toStair.toFixed(1)} m from a curve's centre, inside ` +
            `its sweep — on the staircase, which is QA's "get a key near the staircase" bug exactly`,
        );
      }
    }
    if (
      receptionZone.standX !== undefined &&
      receptionZone.standZ !== undefined &&
      deflection(receptionZone.standX, receptionZone.standZ) > 0.01
    ) {
      problems.push(
        'the reception zone asks her to stand inside something solid — the walk-to never arrives',
      );
    }
  }

  fallenPlayer.position.set(CORRIDOR.originX + CORRIDOR.halfX - 2, 0, CORRIDOR.originZ);
  const doorZone = hotel.interactZones().find((zone) => zone.id === 'hotel-yours-door');
  if (!doorZone) {
    problems.push('the corridor offers no yours-door zone at all');
  } else if ((doorZone.actions?.() ?? []).length === 0) {
    problems.push(
      'the yours-door zone offers no actions — Selection.selectable filters it out, so its ' +
        '"get your key at reception!" sign can never appear',
    );
  }
}

// --------------------------------- 14. the stairs climb at walking pace too
//
// Probe 6 asks each tread "are you standable?" from the tread below — an
// instant query, which is exactly how it stayed green while no real player
// could climb the thing (QA, 8 Aug 2026). A real player's y *damps* onto the
// ground (`Player`'s 0.04 s time constant), so at speed her sampled height
// lags the surface, and once the lag eats the step-up ceiling the next tread
// is never offered. This probe walks the way she walks — a damped y, sprint
// pace — up all **three** flights of the imperial composition: both curves'
// mid-radius spirals from the floor to the landing, and the straight flight
// from the landing to the gallery. The quarter-riser slices are what make
// every march end well; registering one flat wedge per tread fails with the
// march finishing on the floor it started from.
//
// The damp-lag rule is then asserted on the surface itself: no sprint-pace
// stride up any flight may present a full riser at once (the slices present
// a quarter each; a flat wedge presents 0.32–0.64, which the ground damp was
// measured unable to climb). The old "push west across the fan" trap line is
// deliberately gone: it proved a walker could not end up under the flight
// inside the gallery's solid mass's hollow, and the colonnade design has no
// hollow — under the flights is honest walkable floor now, guarded by probe
// 6's walk-through and banded-rail assertions instead.
{
  const mez = LOBBY.mezzanine;
  if (mez) {
    const surfaces = world.building.surfaces;
    const dt = 1 / 60;
    // Player's own ground damp: `damp(y, groundY, 0.04, dt)` — the real
    // half-life form from mathUtils, imported rather than re-derived,
    // because an approximation of it is exactly how the first draft of this
    // probe stayed green against geometry a real player could not climb.
    const GROUND_DAMP_HALF_LIFE = 0.04;
    const sprint = PLAYER_MAX_SPEED * PLAYER_SPRINT_MULTIPLIER;

    const dampWalk = (
      points: (s: number) => [number, number],
      metres: number,
      startY: number,
    ): number => {
      let y = startY;
      const steps = Math.ceil(metres / (sprint * dt));
      for (let s = 0; s <= steps; s += 1) {
        const [x, z] = points(s / steps);
        const floor = surfaces.sample(x, z, y);
        y = damp(y, floor, GROUND_DAMP_HALF_LIFE, dt);
        if (y - floor > 0.5) y = floor;
      }
      return y;
    };

    for (const stair of mez.stairs) {
      const hand = stair.toAngle > stair.fromAngle ? 'right' : 'left';
      const midR = (stair.innerRadius + stair.outerRadius) / 2;
      const arcLength = Math.abs(stair.toAngle - stair.fromAngle) * midR;
      const spiralEnd = dampWalk(
        (t) => {
          const a = stair.fromAngle + (stair.toAngle - stair.fromAngle) * t;
          return [
            LOBBY.originX + stair.centreX - Math.sin(a) * midR,
            LOBBY.originZ + stair.centreZ + Math.cos(a) * midR,
          ];
        },
        arcLength,
        0,
      );
      if (Math.abs(spiralEnd - mez.landing.height) > 0.45) {
        problems.push(
          `sprinting up the ${hand} curve's spiral ends at y=${spiralEnd.toFixed(2)} m, not the ` +
            `landing's ${mez.landing.height.toFixed(2)} m — the flight defeats the ground damp ` +
            `and cannot be climbed`,
        );
      }

      // The damp-lag rule on the surface itself, along three radii; the scan
      // stops where it enters the landing (probe 6 owns the landing's edge).
      let worstStepRise = 0;
      const stride = sprint * dt;
      const sweepSign = Math.sign(stair.toAngle - stair.fromAngle);
      for (const r of [stair.innerRadius + 0.2, midR, stair.outerRadius - 0.2]) {
        let floorHere = 0;
        for (let along = stride; along < arcLength; along += stride) {
          const a = stair.fromAngle + (sweepSign * along) / r;
          if (Math.abs(a - stair.fromAngle) > Math.abs(stair.toAngle - stair.fromAngle)) break;
          const x = LOBBY.originX + stair.centreX - Math.sin(a) * r;
          const z = LOBBY.originZ + stair.centreZ + Math.cos(a) * r;
          const lx = x - LOBBY.originX;
          const lz = z - LOBBY.originZ;
          if (
            lx > mez.landing.minX &&
            lx < mez.landing.maxX &&
            lz > mez.landing.minZ &&
            lz < mez.landing.maxZ
          ) {
            break;
          }
          const next = surfaces.sample(x, z, floorHere + 0.01);
          worstStepRise = Math.max(worstStepRise, next - floorHere);
          floorHere = next;
        }
      }
      const riser = mez.landing.height / stair.treads;
      if (worstStepRise > riser - 0.02) {
        problems.push(
          `one sprint-pace step up the ${hand} curve raises the floor ` +
            `${worstStepRise.toFixed(2)} m — a whole riser (${riser.toFixed(2)} m) or more at ` +
            `once, which is exactly the geometry the ground damp was measured unable to climb`,
        );
      }
    }

    // The straight flight, from the landing: the same damped sprint, and the
    // same stride rule along three lanes of its width.
    {
      const { straight } = mez;
      const run = straight.frontZ - mez.maxZ;
      const start = straight.frontZ + 1.0;
      const total = start - (mez.maxZ - 1.0);
      const flightEnd = dampWalk(
        (t) => [LOBBY.originX + straight.centreX, LOBBY.originZ + start - total * t],
        total,
        mez.landing.height,
      );
      if (Math.abs(flightEnd - mez.height) > 0.45) {
        problems.push(
          `sprinting up the straight flight ends at y=${flightEnd.toFixed(2)} m, not the ` +
            `gallery's ${mez.height.toFixed(2)} m — the grand flight defeats the ground damp`,
        );
      }

      let worstStepRise = 0;
      const stride = sprint * dt;
      for (const lane of [
        straight.centreX - straight.walkWidth / 2 + 0.2,
        straight.centreX,
        straight.centreX + straight.walkWidth / 2 - 0.2,
      ]) {
        let floorHere = mez.landing.height;
        for (let along = stride; along < run; along += stride) {
          const z = straight.frontZ - along;
          if (z < mez.maxZ) break;
          const next = surfaces.sample(
            LOBBY.originX + lane,
            LOBBY.originZ + z,
            floorHere + 0.01,
          );
          worstStepRise = Math.max(worstStepRise, next - floorHere);
          floorHere = next;
        }
      }
      const riser = straight.rise / straight.treads;
      if (worstStepRise > riser - 0.02) {
        problems.push(
          `one sprint-pace step up the straight flight raises the floor ` +
            `${worstStepRise.toFixed(2)} m — a whole riser (${riser.toFixed(2)} m) or more at once`,
        );
      }
    }
  }
}

// ------------------------------ 16. a napping child is visibly in bed
//
// Jim, live play, 8 Aug 2026: *"the hotel room beds, once the character gets
// into them, they sort-of vanish — they should lie in a bed visibly with a
// blanket on them."* Measured cause: `Hotel.nap` reclined her twice — the
// shared `'reclined'` ride posture (model root −1.35) **and** a −π/2 pitch on
// the player group — ≈ −167° in all, folding her backwards through the
// mattress: her head ended 0.64 m *below the floor*.
//
// This runs the real thing: a real `Player`, stood at the first suite bed,
// running the bed zone's own Sleep action, ticked frame by frame so the ride
// pose is applied exactly as the game applies it. Then, measured on the posed
// kid and the built bed:
//  * her head is **above the mattress top** and at the pillow end;
//  * a straight-down ray at her head hits *her*, not a blanket — head out;
//  * a straight-down ray over her body hits the bed's nap blanket — tucked in;
//  * **a whole grid of them does**, over the blanket's own footprint — see
//    below;
//  * **her eyes are shut, and stay shut** — likewise;
//  * every pet bed is empty before she naps and has its own pet asleep in it
//    afterwards — probe 16c.
//
// Proven red before trusted green, on the pre-fix build:
//   x a napping child's head is at y=-0.66 m — the mattress top is 0.55 m,
//     so she has vanished into the bed
//   x nothing over the napping child's body says 'blanket' — no blanket mesh
//
// ## The grid, and the eyes — Jim, live play, 21 Aug 2026
//
// *"The player's character doesn't close their eyes when in bed, and clips
// into the sheets."* Both had been green here the whole time, and both for
// the same reason: **one ray over one point is not "under the covers", and a
// call to `setExpression` is not "her eyes are shut".**
//
// The single `firstHit(bedX, bedZ + 0.35)` above hit blanket because the
// blanket's slab happened to be over that one spot. Measured on the same
// build, her chest stood at 1.00 m, her collar at 1.02 m and her shirt hem at
// 1.07 m against a blanket whose top face was 0.97 m — she was through the
// covers at 16 of 91 points on this grid, and the probe could not see any of
// them. So the grid: rays down over the blanket's whole footprint, and none of
// them may reach the child.
//
// The eyes are the same disease. `Hotel.nap` really did call
// `setExpression('blink')`; `Player.animate`'s own blink clock rewrote the
// face from its resting mood within one frame, every frame, so the eyes were
// open for all but the first. Nothing here could have caught it, because
// nothing here ever looked at the face. So: **find the blink texture the way
// the game makes one** — tick her awake until the ordinary blink cycle swaps
// it in, and keep that texture — then assert the face wears exactly that one,
// on every frame of the nap, and goes back to its resting face on waking.
// A held expression and a natural blink are the same texture, so the "held"
// half is what the many frames prove.
{
  const napCamera = new IsoCamera();
  const napper = quietly(
    () => new Player(collision, napCamera, new Vector3(SUITE.originX, 0, SUITE.originZ)),
  );
  scene.add(napper.group);
  hotel.attachPlayer(napper as never);
  hotel.adoptRestoredPlayer();
  const spot = SUITE_BED_SPOTS[0];
  const bedX = SUITE.originX + (spot?.[0] ?? 0);
  const bedZ = SUITE.originZ + (spot?.[1] ?? 0);
  napper.position.set(bedX, BED_MATTRESS_TOP, bedZ + 1.4);
  napper.group.position.copy(napper.position);

  const bedZone = hotel.interactZones().find((zone) => zone.id === 'hotel-bed-bed-0');
  if (!bedZone) {
    problems.push('the suite offers no zone for bed 0 — Sleep! cannot be reached');
  } else {
    const sleep = bedZone.actions?.()[0];
    if (!sleep) {
      problems.push('bed 0 offers no Sleep action');
    } else {
      // ---- her face, before she sleeps. `napFaceTexture` is whatever the
      // baked face is currently showing (`art/style/faces.ts` swaps
      // `material.map`); the *blink* one is found by watching for the swap
      // the ordinary blink clock makes, rather than being named here.
      const faceTexture = (): unknown => {
        let map: unknown = null;
        napper.model.head.traverse((object: Object3D) => {
          const mesh = object as Mesh & { material?: { map?: unknown } };
          if (mesh.isMesh && mesh.material && 'map' in mesh.material && map === null) {
            map = mesh.material.map;
          }
        });
        return map;
      };
      const tickPlayer = (seconds: number, from: number): void => {
        for (let t = 0; t < seconds; t += 1 / 60) {
          napper.update({
            dt: 1 / 60,
            elapsed: from + t,
            input: { justPressed: () => false, isDown: () => false },
          } as never);
        }
      };
      const restingFace = faceTexture();
      let blinkFace: unknown = null;
      // Two whole blink gaps' worth (`faceLife.ts`: 2.6 s + up to 3.4 s), so a
      // blink is certain rather than likely.
      for (let t = 0; t < 15 && blinkFace === null; t += 1 / 60) {
        tickPlayer(1 / 60, t);
        const now = faceTexture();
        if (now !== restingFace) blinkFace = now;
      }
      if (blinkFace === null) {
        problems.push(
          'a waking child never blinked in 15 s of frames — the face texture never changed, ' +
            'so the eyes-shut check below cannot mean anything',
        );
      }
      if (faceTexture() !== restingFace) tickPlayer(0.5, 15);

      // ---- every pet bed is **empty** until she naps (Jim, 21 Aug 2026).
      for (const { pet, asleep, x } of hotel.petBeds) {
        if (asleep || pet.root.visible) {
          problems.push(
            `a pet bed at local x=${x.toFixed(2)} already has its pet in it before the player ` +
              `naps (visible ${pet.root.visible}, asleep ${asleep}) — a child walking in sees a ` +
              `pet already asleep in bed while her real one still follows her about`,
          );
        }
      }

      sleep.run();
      // Long enough for every pet's trot to finish, well inside the 2.6 s nap.
      const NAP_FRAMES = 90;
      let sleepingFaceWrong = 0;
      for (let frame = 0; frame < NAP_FRAMES; frame += 1) {
        const elapsed = 16 + frame / 60;
        hotel.update({ dt: 1 / 60, elapsed } as never);
        napper.update({
          dt: 1 / 60,
          elapsed,
          input: { justPressed: () => false, isDown: () => false },
        } as never);
        if (blinkFace !== null && faceTexture() !== blinkFace) sleepingFaceWrong += 1;
      }
      if (sleepingFaceWrong > 0) {
        problems.push(
          `a napping child's eyes were open on ${sleepingFaceWrong} of ${NAP_FRAMES} frames — ` +
            `the face was not the shut-eye texture the blink cycle uses`,
        );
      }
      hotel.hotelRoot.updateMatrixWorld(true);
      napper.group.updateMatrixWorld(true);

      const head = new Vector3();
      napper.model.head.getWorldPosition(head);
      if (head.y < BED_MATTRESS_TOP + 0.1) {
        problems.push(
          `a napping child's head is at y=${head.y.toFixed(2)} m — the mattress top is ` +
            `${BED_MATTRESS_TOP.toFixed(2)} m, so she has vanished into the bed`,
        );
      }
      // The pillow is the −Z end of the bed (halfZ 1.0); "on the pillow" is
      // the outer half-metre of that end, under her head's own plan position.
      if (head.z > bedZ - 0.35 || head.z < bedZ - 1.1 || Math.abs(head.x - bedX) > 0.4) {
        problems.push(
          `a napping child's head is at (${(head.x - bedX).toFixed(2)}, ` +
            `${(head.z - bedZ).toFixed(2)}) bed-local — not on the pillow end (z −1.1…−0.35)`,
        );
      }

      // What a straight-down look actually meets: her at the pillow, the
      // blanket over her body.
      const downcast = new Raycaster();
      // The player's name label is a Sprite, and Sprite.raycast wants to know
      // the camera; without one it throws headless.
      downcast.camera = napCamera.camera;
      const isKid = (object: unknown): boolean => {
        let walk = object as { parent?: unknown } | null;
        while (walk) {
          if (walk === napper.group) return true;
          walk = (walk as { parent?: null }).parent ?? null;
        }
        return false;
      };
      const isBlanket = (object: unknown): boolean => {
        let walk = object as { name?: string; parent?: unknown } | null;
        while (walk) {
          if (walk.name === 'hotel.napBlanket') return true;
          walk = (walk as { parent?: null }).parent ?? null;
        }
        return false;
      };
      const firstHit = (x: number, z: number): unknown => {
        downcast.set(new Vector3(x, BED_MATTRESS_TOP + 4, z), new Vector3(0, -1, 0));
        const hits = downcast.intersectObjects([...hotel.hotelRoot.children, napper.group], true);
        return hits[0]?.object ?? null;
      };
      const overHead = firstHit(head.x, head.z);
      if (!overHead || !isKid(overHead)) {
        problems.push(
          'looking straight down at a napping child\'s head does not meet the child — ' +
            'her face is covered or buried',
        );
      }
      const overBody = firstHit(bedX, bedZ + 0.35);
      if (!overBody || !isBlanket(overBody)) {
        problems.push(
          "nothing over the napping child's body says 'blanket' — she is lying on the " +
            'covers, not under them',
        );
      }

      // ---- **the whole of her, under the whole of the covers.** The grid
      // this probe's header is about: the blanket's own built footprint, in
      // both directions, inset a little from its edges so a ray grazing the
      // very lip of the mound is not counted as her sticking out of it.
      const blanket = hotel.hotelRoot.getObjectByName('hotel.napBlanket');
      const blanketBox = blanket ? new Box3().setFromObject(blanket) : null;
      if (!blanketBox || blanketBox.isEmpty()) {
        problems.push('no nap blanket was built for bed 0 — the drape grid has nothing to probe');
      } else {
        const inset = 0.06;
        const minX = blanketBox.min.x + inset;
        const maxX = blanketBox.max.x - inset;
        const minZ = blanketBox.min.z + inset;
        const maxZ = blanketBox.max.z - inset;
        const exposed: string[] = [];
        const STEPS_X = 8;
        const STEPS_Z = 16;
        for (let ix = 0; ix <= STEPS_X; ix += 1) {
          for (let iz = 0; iz <= STEPS_Z; iz += 1) {
            const x = minX + ((maxX - minX) * ix) / STEPS_X;
            const z = minZ + ((maxZ - minZ) * iz) / STEPS_Z;
            if (isKid(firstHit(x, z))) {
              exposed.push(`(${(x - bedX).toFixed(2)}, ${(z - bedZ).toFixed(2)})`);
            }
          }
        }
        if (exposed.length > 0) {
          problems.push(
            `a napping child pokes out through the bedclothes at ${exposed.length} of ` +
              `${(STEPS_X + 1) * (STEPS_Z + 1)} points over the blanket — first few, bed-local: ` +
              `${exposed.slice(0, 6).join(' ')}`,
          );
        }
      }

      // **Issue #275: the pets go to sleep too, all together** — and, since
      // 21 Aug 2026, only *now*, not since the room was built. Every pet bed's
      // pet should be visible and lying down — `Hotel.layPetDown`'s rotation,
      // read off the public `petBeds` list rather than re-derived here.
      for (const { pet, x, asleep } of hotel.petBeds) {
        if (!asleep || !pet.root.visible || Math.abs(pet.root.rotation.x + Math.PI / 2) > 0.01) {
          problems.push(
            `a pet bed's pet at local x=${x.toFixed(2)} is not lying in it while the player ` +
              `naps (visible ${pet.root.visible}, asleep ${asleep}, rotation.x ` +
              `${pet.root.rotation.x.toFixed(2)}) — issue #275 wants every pet asleep too`,
          );
        }
      }

      // Hand the room back the way the earlier probes left it: one giant tick
      // outlasts any nap. The pets should get up and go back out with it —
      // out of the bed *and* off the screen, which is what "the beds are
      // empty until she naps" means at the other end of a nap.
      hotel.update({ dt: 999, elapsed: 0 } as never);
      for (const { pet, x, asleep } of hotel.petBeds) {
        if (asleep || pet.root.visible || Math.abs(pet.root.rotation.x) > 0.01) {
          problems.push(
            `a pet bed's pet at local x=${x.toFixed(2)} did not get out of bed when the nap ` +
              `ended (visible ${pet.root.visible}, asleep ${asleep})`,
          );
        }
      }
      // And her eyes open again with them.
      tickPlayer(0.2, 20);
      if (blinkFace !== null && faceTexture() === blinkFace) {
        problems.push('a woken child still has her eyes shut — the sleeping face never cleared');
      }
      scene.remove(napper.group);
    }
  }
}

// ---------------- 16b. every bed's own nap has a sleeping pet she can see
//
// Jim, live play, 18 Aug 2026, from `/hotel-suite`: *"the pet didn't get into
// any bed when I did [went to sleep]."* Root cause: every pet bed used to
// live only in the middle bedroom (`SUITE_BED_SPOTS[1]`'s room). `Hotel.nap`
// really did lay every pet down — probe 16 above proves the rotation flips —
// but `Hotel.enterSuite`'s own doc comment has her reaching **bedroom 1's**
// door first, not bedroom 2's, and a 2.2 m partition plus the fixed camera's
// field of view put bedroom 2 nowhere in frame from bedroom 1 or bedroom 3.
// The data changed; nothing she was looking at did — which reads as exactly
// what she reported, and probe 16 stayed green through it the whole time
// because it only ever checks bed 0's rotation numbers, never whether bed
// 0's own room has a pet bed in it at all.
//
// So this asks that question directly, for **all three** beds: run each
// bed's own real Sleep action, then require at least one pet in the public
// `hotel.petBeds` list to be both lying down and standing on *that bed's
// own* real clear floor (`clearFloorAround` — the same rectangle the room's
// actual walls build, not a hand-typed span) — i.e. visibly in the room she
// is in, not merely somewhere in the data.
//
// Proven red on the pre-fix build (pet beds only ever in bedroom 2): bed 0's
// own floor is x -14.55…-8.20 and every pet bed sat at x ≈ -2.39, so no pet
// bed's a chair the bedroom 0 checkist would ever have counted as "in this
// room" — likewise for bed 2's floor at x 7.40…14.55.
{
  const napper2 = quietly(
    () => new Player(collision, new IsoCamera(), new Vector3(SUITE.originX, 0, SUITE.originZ)),
  );
  scene.add(napper2.group);
  hotel.attachPlayer(napper2 as never);
  hotel.adoptRestoredPlayer();

  for (const bedIndex of [0, 1, 2] as const) {
    const spot = SUITE_BED_SPOTS[bedIndex];
    if (!spot) {
      problems.push(`SUITE_BED_SPOTS has no entry ${bedIndex}`);
      continue;
    }
    const bedZone = hotel.interactZones().find((zone) => zone.id === `hotel-bed-bed-${bedIndex}`);
    const sleep = bedZone?.actions?.()[0];
    if (!sleep) {
      problems.push(`bed ${bedIndex} offers no Sleep action for the visible-pet check`);
      continue;
    }
    sleep.run();
    // Long enough for the trot from the floor into the bed to finish — since
    // 21 Aug 2026 a pet is not *already* in its bed at `sleep.run()`, it walks
    // there, and this probe is about what she sees when it has arrived. Still
    // well inside the nap's own 2.6 s.
    for (let frame = 0; frame < 90; frame += 1) {
      hotel.update({ dt: 1 / 60, elapsed: frame / 60 } as never);
    }

    const room = clearFloorAround(SUITE, spot[0], spot[1]);
    const visible = hotel.petBeds.some(({ pet, x, z, asleep }) => {
      const lying = asleep && pet.root.visible && Math.abs(pet.root.rotation.x + Math.PI / 2) < 0.01;
      const inThisRoom = x >= room.minX && x <= room.maxX && z >= room.minZ && z <= room.maxZ;
      return lying && inThisRoom;
    });
    if (!visible) {
      problems.push(
        `napping at bed ${bedIndex} (its own room floor is local x ${room.minX.toFixed(2)}…` +
          `${room.maxX.toFixed(2)}, z ${room.minZ.toFixed(2)}…${room.maxZ.toFixed(2)}) lies every ` +
          `pet down somewhere, but none of them is on that bedroom's own floor — a child sleeping ` +
          `there sees no pet go to bed at all (issue #275, live-play regression)`,
      );
    }

    // One giant tick ends the nap before the next bed's turn — same idiom as
    // probe 16's own hand-back.
    hotel.update({ dt: 999, elapsed: 0 } as never);
  }
  scene.remove(napper2.group);
}

// --------------------------------- 15. the walls abut: no notch at any corner
//
// Jim, live play, 8 Aug 2026: *"the walls don't abut each other properly, they
// stop leaving gaps ... even where they join they don't abut nicely."*
// Measured cause: every wall box stopped at the room's half-extent — the
// perpendicular wall's **centre line** — so at each outer corner the two walls
// each stopped half a thickness short of the other, leaving an empty
// see-through column 0.25 m square, floor to ceiling, on the exact corners the
// iso camera views diagonally. The fix is `world/wallRuns.ts` (shared with the
// castle, which already closed its corners): north/south spans extend past the
// run's ends by the wall half-thickness, east/west butt between them.
//
// This walks the perimeter of every room as built: two fibres per wall — the
// centre line and the outer skin, where the notch lived — sampled every 5 cm,
// skipping declared doorway gaps, and asserts every sample sits inside some
// wall's world box. Walls are found structurally (tall thin boxes on the
// shell), not by name, so the probe cannot be satisfied by naming alone.
//
// Proven red before trusted green: on the pre-fix build it reports all four
// corners open in every room — see the commit message for the run.
/**
 * Every wall-like box on a room shell, found structurally (tall thin boxes),
 * never by name — so no probe using these can be satisfied by naming alone.
 * Shared by probes 15 (perimeter) and 18 (partition ends).
 */
function wallBoxesOf(shell: { traverse(cb: (object: unknown) => void): void }): Box3[] {
  const wallBoxes: Box3[] = [];
  shell.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.geometry.computeBoundingBox();
    const bounds = object.geometry.boundingBox;
    if (!bounds) return;
    const box = bounds.clone().applyMatrix4(object.matrixWorld);
    const height = box.max.y - box.min.y;
    const thickness = Math.min(box.max.x - box.min.x, box.max.z - box.min.z);
    if (height >= 1.4 && thickness <= 0.6) wallBoxes.push(box.expandByScalar(1e-4));
  });
  return wallBoxes;
}

{
  hotel.hotelRoot.updateMatrixWorld(true);
  const WALL_HALF = 0.25;
  for (const room of ROOMS) {
    const shell = hotel.hotelRoot.children.find((child) => child.name === `hotel:${room.space}`);
    if (!shell) {
      problems.push(`${room.space} has no shell at all`);
      continue;
    }
    const wallBoxes = wallBoxesOf(shell);

    const sides = [
      { side: 'north' as const, along: 'x' as const, cross: -room.halfZ, out: -1 },
      { side: 'south' as const, along: 'x' as const, cross: room.halfZ, out: 1 },
      { side: 'west' as const, along: 'z' as const, cross: -room.halfX, out: -1 },
      { side: 'east' as const, along: 'z' as const, cross: room.halfX, out: 1 },
    ];
    let openings = 0;
    const spots: string[] = [];
    const point = new Vector3();
    for (const { side, along, cross, out } of sides) {
      const gap = room.gaps[side];
      // North and south own the corner columns, so their scan runs past the
      // room's half-extent; east and west butt between them and stop short.
      const reach = along === 'x' ? room.halfX + WALL_HALF - 0.05 : room.halfZ - 0.05;
      for (const fibre of [cross, cross + out * (WALL_HALF / 2)]) {
        for (let t = -reach; t <= reach; t += 0.05) {
          if (gap && t > gap[0] - 0.01 && t < gap[1] + 0.01) continue;
          point.set(
            room.originX + (along === 'x' ? t : fibre),
            1.2,
            room.originZ + (along === 'x' ? fibre : t),
          );
          if (wallBoxes.some((box) => box.containsPoint(point))) continue;
          openings += 1;
          if (spots.length < 4) spots.push(`${side} at ${t.toFixed(2)}`);
        }
      }
    }
    if (openings > 0) {
      problems.push(
        `${room.space}'s perimeter has ${openings} unwalled sample(s) outside its doorways ` +
          `(${spots.join(', ')}…) — walls that stop short of abutting, i.e. a see-through gap`,
      );
    }
  }
}

// ------------------------- 17. the floor-decal ladder keeps its steps apart
//
// Jim, live play, 8 Aug 2026: *"Rugs etc are coplanar with floors, so they
// snap in and out and flicker due to z-buffer rounding."* The camera is
// orthographic (far = CAMERA_DISTANCE·3) and WebGL guarantees only a 16-bit
// depth buffer on the family's phones, so one depth step is ~4.1 mm along the
// view axis — ~6.7 mm of height at the 38° pitch. Any two upward faces closer
// than about two steps and overlapping in plan dither per pixel: measured on
// the pre-fix build, the garden's lawn rug sat *exactly* coplanar with its
// path rug over 5.4 m², the lobby mosaic 10 mm under every rug, the sunburst's
// own discs 8 mm apart, and the lift car's floor at exactly the room plate's
// 0.000.
//
// So: across every room, no two upward faces in the floor band (top ≤ 0.35 m)
// that overlap by more than a hand's area may sit within two depth steps of
// each other. The threshold is derived from the same constants the renderer
// uses, not invented; the fix (`DECAL_STEP` in `hotel/dressing.ts`) spaces the
// ladder at three steps, comfortably clear. Outline shells (back-side
// materials) are not faces a viewer ever sees from above and are skipped.
//
// Proven red before trusted green: 12 problem(s) on the pre-fix build — see
// the commit message for the run.
{
  const DEPTH_STEP = (CAMERA_DISTANCE * 3 - 0.1) / 65536;
  const MIN_DECAL_GAP = (2 * DEPTH_STEP) / Math.sin((CAMERA_PITCH_DEGREES * Math.PI) / 180);
  hotel.hotelRoot.updateMatrixWorld(true);
  for (const room of ROOMS) {
    const shell = hotel.hotelRoot.children.find((child) => child.name === `hotel:${room.space}`);
    if (!shell) continue;
    // Only geometry with a genuinely *flat* top can shimmer plane-on-plane:
    // spheres and cones (tufts, crystals) meet their neighbours along curves,
    // which is ordinary intersection, not a depth fight. Baked assets come in
    // as plain BufferGeometry and are kept — the lift car's floor is one.
    const FLAT_TOPPED = new Set([
      'BoxGeometry',
      'BufferGeometry',
      'CylinderGeometry',
      'ExtrudeGeometry',
      'PlaneGeometry',
      'RingGeometry',
      'ShapeGeometry',
    ]);
    const tops: { readonly what: string; readonly box: Box3; readonly mesh: Mesh }[] = [];
    shell.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      if (!FLAT_TOPPED.has(object.geometry.type)) return;
      const material = object.material as { side?: number } | { side?: number }[];
      const side = Array.isArray(material) ? material[0]?.side : material.side;
      if (side === BackSide) return; // an outline shell, never seen from above
      object.geometry.computeBoundingBox();
      const bounds = object.geometry.boundingBox;
      if (!bounds) return;
      const box = bounds.clone().applyMatrix4(object.matrixWorld);
      if (box.max.y > 0.35 || box.max.y < -0.1) return;
      if (box.max.x - box.min.x < 0.05 || box.max.z - box.min.z < 0.05) return;
      tops.push({ what: object.name || object.parent?.name || object.geometry.type, box, mesh: object });
    });
    const reported = new Set<string>();
    for (let a = 0; a < tops.length; a += 1) {
      for (let b = a + 1; b < tops.length; b += 1) {
        const one = tops[a]!;
        const two = tops[b]!;
        // Two rings of one inlay are concentric annuli: disjoint by
        // construction, coplanar by design, and only their *bounding boxes*
        // overlap (a ring's box includes its own hole).
        if (
          one.mesh.geometry.type === 'RingGeometry' &&
          two.mesh.geometry.type === 'RingGeometry' &&
          one.mesh.parent === two.mesh.parent
        ) {
          continue;
        }
        const gap = Math.abs(one.box.max.y - two.box.max.y);
        if (gap >= MIN_DECAL_GAP) continue;
        const overlapX =
          Math.min(one.box.max.x, two.box.max.x) - Math.max(one.box.min.x, two.box.min.x);
        const overlapZ =
          Math.min(one.box.max.z, two.box.max.z) - Math.max(one.box.min.z, two.box.min.z);
        if (overlapX <= 0 || overlapZ <= 0 || overlapX * overlapZ < 0.05) continue;
        const key = `${room.space}|${one.what}|${two.what}`;
        if (reported.has(key)) continue;
        reported.add(key);
        problems.push(
          `${room.space}: '${one.what}' (top ${one.box.max.y.toFixed(3)} m) and '${two.what}' ` +
            `(top ${two.box.max.y.toFixed(3)} m) overlap ${(overlapX * overlapZ).toFixed(1)} m² ` +
            `${(gap * 1000).toFixed(1)} mm apart — inside the ${(MIN_DECAL_GAP * 1000).toFixed(1)} mm ` +
            `a 16-bit depth buffer can tell apart, so they flicker`,
        );
      }
    }
  }
}

// ------------------- 18. every partition end meets a wall or is a doorway
//
// Jim, looking at the suite bedroom, 8 Aug 2026: *"The dividing walls don't
// go to the edge of the space"* — the two long SuitePartition runs declared
// `from: −9.4` while the suite's west wall stands at −11, leaving a
// free-standing 1.6 m opening at each west end that reads as a wall somebody
// forgot to finish (and whose bare end corner interrupts a slide along the
// partition face). The owner is the partition DATA: the builder cannot know
// that −9.4 "meant" the wall, so a run that should reach a wall must say so,
// and this probe holds every partition end in the hotel to it.
//
// For each declared partition, the built spans (the same `segmentsMinusGaps`
// arithmetic `partitionRoom` uses) are walked and every span end must be one
// of exactly two things: a **declared doorway jamb**, or **abutting a
// perpendicular wall** — proven against the *built* wall boxes by sampling a
// point just past the end, which must land inside some wall (outer wall or a
// crossing partition). Free air past a partition end is the bug.
{
  hotel.hotelRoot.updateMatrixWorld(true);
  const half = SUITE_DOOR_WIDTH / 2;
  const point = new Vector3();
  for (const room of ROOMS) {
    if (!room.partitions || room.partitions.length === 0) continue;
    const shell = hotel.hotelRoot.children.find((child) => child.name === `hotel:${room.space}`);
    if (!shell) continue;
    const wallBoxes = wallBoxesOf(shell);
    for (const [index, run] of room.partitions.entries()) {
      const spans = segmentsMinusGaps(
        run.from,
        run.to,
        run.doors.map((door) => [door - half, door + half] as const),
      );
      for (const [a, b] of spans) {
        if (b - a < 0.05) continue;
        for (const [end, outward] of [
          [a, -1],
          [b, 1],
        ] as const) {
          const jamb = run.doors.some(
            (door) => Math.abs(end - (door - half)) < 0.01 || Math.abs(end - (door + half)) < 0.01,
          );
          if (jamb) continue;
          // Just past the end, halfway up the partition: inside a wall, or open air.
          const t = end + outward * 0.05;
          point.set(
            room.originX + (run.along === 'x' ? t : run.at),
            1.1,
            room.originZ + (run.along === 'x' ? run.at : t),
          );
          if (wallBoxes.some((box) => box.containsPoint(point))) continue;
          problems.push(
            `${room.space}: partition ${index} (along ${run.along} at ${run.at}) ends at ` +
              `${end.toFixed(2)} in open air — neither a declared doorway jamb nor abutting a ` +
              `wall, i.e. a dividing wall that stops short of the edge of the space`,
          );
        }
      }
    }
  }
}

// ------------------------------- 19. no rug runs under a wall or partition
//
// Jim, looking at the suite bedroom, 8 Aug 2026: *"The rainbow rug goes
// under the walls."* Measured cause: the hall's rainbow rug was hand-sized —
// 0.8 m core plus six 0.3 m bands is a 2.6 m radius — in a hall whose clear
// width is z ±1.5, so it ran ~1.1 m under both long partitions and surfaced
// in the bedrooms and the lounge as a sliver of someone else's rug against
// the skirting.
//
// The fix has an owner: `layout.ts`'s `clearFloorAround` derives each rug's
// available floor from the partition plan itself, so a rug *cannot* reach a
// wall and a future partition move re-fits the rugs automatically. This
// probe holds the built scene to it: every rug-family group's world box,
// against every wall box (structural, as everywhere else in this file), may
// not overlap in plan by more than a paint line.
{
  hotel.hotelRoot.updateMatrixWorld(true);
  const RUG_NAMES = ['hotel.rug', 'hotel.rug.round', 'hotel.rainbowRug', 'hotel.rainbowRing'];
  for (const room of ROOMS) {
    const shell = hotel.hotelRoot.children.find((child) => child.name === `hotel:${room.space}`);
    if (!shell) continue;
    // Walls by name *and* shape here, unlike the purely structural sweeps in
    // probes 15 and 18: the structural test alone also catches the garden's
    // trellis arches, and a lawn running under a rose arch is the design, not
    // a rug under a wall. A wall that loses its name cannot hide from those
    // two probes, so the name is safe to lean on for this one.
    const wallBoxes: Box3[] = [];
    shell.traverse((object) => {
      if (!(object instanceof Mesh) || object.name !== 'hotel.wall') return;
      object.geometry.computeBoundingBox();
      const bounds = object.geometry.boundingBox;
      if (!bounds) return;
      wallBoxes.push(bounds.clone().applyMatrix4(object.matrixWorld));
    });
    const rugBoxes: { readonly what: string; readonly box: Box3 }[] = [];
    shell.traverse((object) => {
      if (!RUG_NAMES.includes(object.name)) return;
      rugBoxes.push({ what: object.name, box: new Box3().setFromObject(object) });
    });
    for (const rug of rugBoxes) {
      for (const wall of wallBoxes) {
        const overlapX = Math.min(rug.box.max.x, wall.max.x) - Math.max(rug.box.min.x, wall.min.x);
        const overlapZ = Math.min(rug.box.max.z, wall.max.z) - Math.max(rug.box.min.z, wall.min.z);
        if (overlapX <= 0.02 || overlapZ <= 0.02) continue;
        problems.push(
          `${room.space}: a '${rug.what}' reaches ${overlapX.toFixed(2)} × ${overlapZ.toFixed(2)} m ` +
            `under a wall at (${((wall.min.x + wall.max.x) / 2 - room.originX).toFixed(1)}, ` +
            `${((wall.min.z + wall.max.z) / 2 - room.originZ).toFixed(1)}) local — rugs must lie on ` +
            `their own room's clear floor (layout.ts clearFloorAround)`,
        );
        break;
      }
    }
  }
}

// ---------------------- 20. every floor reads apart from its own walls
//
// Jim, looking at the suite, 8 Aug 2026: *"The walls and floor colours are
// too similar — hard to distinguish."* The rule, its measurement and its
// measured threshold live with the themes (`layout.ts`'s
// `relativeLuminance` / `THEME_FLOOR_CONTRAST_MIN`); this applies it to
// every room so no future theme can go cream-on-cream unnoticed. Proven red
// before trusted green: on the pre-fix palette the suite measured 0.115 and
// the breakfast room 0.009 against good readers at 0.186–0.274.
for (const room of ROOMS) {
  const wall = relativeLuminance(room.theme.wall);
  const floor = relativeLuminance(room.theme.floor);
  const delta = Math.abs(wall - floor);
  if (delta < THEME_FLOOR_CONTRAST_MIN) {
    problems.push(
      `${room.space}: wall luminance ${wall.toFixed(3)} and floor ${floor.toFixed(3)} differ by ` +
        `${delta.toFixed(3)} — under the ${THEME_FLOOR_CONTRAST_MIN} the good-reading floors set, ` +
        `so wall and floor blur together at a glance (layout.ts THEME_FLOOR_CONTRAST_MIN)`,
    );
  }
}

// ------------------- 21. every floor has a bathroom with the manners
//
// Jim, 8 Aug 2026, of the suite's own: *"Add a bathroom using the models and
// rules from the bathroom in the other big building."* Issue #272 widened
// that to every floor: *"every floor needs a bathroom with a toilet, reusing
// the castle's toilet code."* The castle's rules (`building/Toilets.ts`, from
// GAME_DESIGN.md): the pan and basin are the shared factories, using one is
// the two-beat flush-then-wash routine, and a **privacy roof** slides over
// the room while she is in it and lifts at the wash beat — on before she is
// out of sight, never able to trap her.
//
// This probe walks `hotel.bathroomRooms` — the hotel's own list, not a copy
// of it (CLAUDE.md's "one owner; everyone else asks") — so a floor that gains
// a `dress*` method without a bathroom, or loses the one it had, is a probe
// failure rather than a silent gap. The one exception is deliberate:
// `CORRIDOR` (Floor 50) has no rectangle left for a nook of its own (see
// `Hotel.dressCorridor`'s comment — the room is 8 m deep, both crystal
// clusters and the statue row already claim the east wall, and the middle is
// `marchAtSuiteDoor`'s own straight probe to the "yours" door), so this
// probe accepts the suite's bathroom, one door down the same corridor and
// answering to the same "Yours! · Floor 50" lift button, in its place. For
// every floor it checks the built result behaves like the castle's:
//  * the pan and basin are solid (place.ts registered them), the pan
//    mountable like any low flat-topped prop;
//  * a bathroom zone exists, offers a real action, and its stand spot is
//    walkable;
//  * a player standing in the bathroom is covered by the roof, and the wash
//    beat lifts it while she is still inside.
{
  const bathroomRooms = hotel.bathroomRooms;
  // Every floor a child can actually reach with the lift must lead to a
  // bathroom — but CORRIDOR and SUITE are one floor by the lift's own
  // reckoning (both answer to "Yours! · Floor 50"), so CORRIDOR is covered
  // if SUITE has one, without needing a rectangle of its own.
  const coveredFloors = HOTEL_FLOORS.filter(
    (floor) =>
      bathroomRooms.includes(floor.room) ||
      (floor.room === CORRIDOR && bathroomRooms.includes(SUITE)),
  );
  if (coveredFloors.length < HOTEL_FLOORS.length) {
    const missing = HOTEL_FLOORS.filter((floor) => !coveredFloors.includes(floor));
    problems.push(
      `${missing.length} of ${HOTEL_FLOORS.length} hotel floors have no bathroom reachable ` +
        `from them at all: ${missing.map((floor) => floor.name).join(', ')}`,
    );
  }

  for (const room of bathroomRooms) {
    const fixtures = hotel.bathroomFixtures(room);
    if (!fixtures) {
      problems.push(`${room.space}: bathroomRooms lists it but bathroomFixtures returns nothing`);
      continue;
    }
    const { pan, basin } = fixtures;
    if (deflection(pan.x, pan.z) < 0.1) {
      problems.push(`${room.space}'s bathroom pan is not solid — a child walks straight through it`);
    }
    if (deflection(basin.x, basin.z) < 0.1) {
      problems.push(`${room.space}'s bathroom basin is not solid — a child walks straight through it`);
    }
    const atopPan = deflectionAt(pan.x, 0.75, pan.z);
    if (atopPan > 0.01) {
      problems.push(
        `${room.space}'s bathroom pan pushes a child stood on its top ${atopPan.toFixed(2)} m ` +
          'sideways — solid and standable are fighting (place.ts)',
      );
    }

    hotel.attachPlayer(fallenPlayer as never);
    fallenPlayer.position.set(pan.x, 0, pan.z);
    hotel.adoptRestoredPlayer();
    const bathroomZone = hotel
      .interactZones()
      .find((zone) => zone.id === `hotel-bathroom-${room.space}`);
    if (!bathroomZone) {
      problems.push(`${room.space} offers no bathroom zone at all — nothing to tap, no routine to run`);
      continue;
    }
    if ((bathroomZone.actions?.() ?? []).length === 0) {
      problems.push(`${room.space}'s bathroom zone offers no actions — its sign can never appear`);
    }
    if (
      bathroomZone.standX !== undefined &&
      bathroomZone.standZ !== undefined &&
      deflection(bathroomZone.standX, bathroomZone.standZ) > 0.01
    ) {
      problems.push(`${room.space}'s bathroom zone asks her to stand inside something solid`);
    }

    // The privacy roof, driven exactly as the game drives it: she stands in
    // the room, frames pass, the lid covers; the wash beat lifts it while
    // she is still there (the castle's rule, `building/Toilets.ts`).
    const roomShell = hotel.hotelRoot.children.find((child) => child.name === `hotel:${room.space}`);
    let roofGroup: { visible: boolean } | null = null;
    roomShell?.traverse((object) => {
      if (object.name === 'toilet-roof') roofGroup = object;
    });
    if (!roofGroup) {
      problems.push(`${room.space}'s bathroom has no privacy roof — the castle rule it must honour`);
      continue;
    }
    const tick = (seconds: number): void => {
      for (let i = 0; i < Math.ceil(seconds * 60); i += 1) {
        hotel.update({ dt: 1 / 60, elapsed: i / 60 } as never);
      }
    };
    tick(1.2);
    if (!(roofGroup as { visible: boolean }).visible) {
      problems.push(
        `a child standing in ${room.space}'s bathroom is not covered by the privacy roof — ` +
          'the lid must lead her in',
      );
    }
    const useAction = (bathroomZone.actions?.() ?? [])[0];
    useAction?.run();
    tick(3.0);
    if ((roofGroup as { visible: boolean }).visible) {
      problems.push(
        `${room.space}'s privacy roof is still down after the wash beat — the lid must lift ` +
          'while she washes her hands, not trap her',
      );
    }
    // Out of the room: nothing remembered, the roof stays up.
    fallenPlayer.position.set(room.originX, 0, room.originZ);
    tick(1.0);
    if ((roofGroup as { visible: boolean }).visible) {
      problems.push(`${room.space}'s privacy roof stayed on over an empty bathroom`);
    }
  }
}

// ------------------- 22. the tower is solid from every bearing but the door
//
// Jim, playing, 9 Aug 2026: *"The hotel building is not solid. I can walk
// straight through it."* He was right, and the reason was in
// `registerTowerCollision`: the octagon was built by trimming the *start* of
// every sector by the door's arc, so six evenly-spaced 0.32 rad gaps stood
// open round the tower and the "doorway" itself was a 1.43 rad hole, nearly
// four times the door.
//
// So this walks up to the building the way a child does, from all round it:
// a player-sized body marched at the centre from 16 m out, on 32 bearings,
// **twice** — once creeping at 5 cm and once at `PLAYER_LONGEST_STEP`, the
// longest stride the loop can hand out, because a gap you cannot walk into
// you may still be able to tunnel into on a stuttering frame.
//
// Every bearing but the doorway's own cone must be stopped outside the shell.
// The doorway's cone must let her in, and the count of bearings that actually
// reach the shell is asserted too — otherwise a park that happened to fence
// the tower off with trees would pass this without ever testing the tower.
//
// Proven red before trusted green, on the pre-fix build: **19 of the 64
// marches walked inside the 6.65 m shell**, at nine distinct bearings from 23°
// to 169° off the doorway, and the closest approach was 0.00 m — the middle of
// the tower. It also trips the reach guard ("only 25 of 64 marches reached the
// shell"), because a body that walks straight through a wall never stops
// against it.
{
  // The bounds are still the 1e6 sentinel section 2 fitted; the tower is out
  // in the park and its own leash is nothing to do with this.
  collision.setPlayBounds({ radius: 1e6, distanceToEdge: () => 1e6 });
  const plot = placedEntry('hotel');
  const facadeYaw = Math.atan2(plot.entranceX - plot.x, plot.entranceZ - plot.z);
  /** Where a bearing has to stop to count as "outside": the shell's own flat. */
  const facade = TOWER_FACADE_ALONG;
  /** Half the angle the doorway subtends at the tower's centre. */
  const doorCone = Math.atan2(TOWER_DOOR_HALF, facade);

  const marchIn = (bearing: number, step: number): number => {
    const probe = new Vector3(
      plot.x + Math.sin(bearing) * 16,
      0,
      plot.z + Math.cos(bearing) * 16,
    );
    let closest = Infinity;
    for (let travelled = 0; travelled < 20; travelled += step) {
      collision.resolveMovement(
        probe,
        -Math.sin(bearing) * step,
        -Math.cos(bearing) * step,
        PLAYER_RADIUS,
        0,
        MAX_FRAME_DELTA,
      );
      closest = Math.min(closest, Math.hypot(probe.x - plot.x, probe.z - plot.z));
    }
    return closest;
  };

  const BEARINGS = 32;
  let reachedShell = 0;
  let doorwaysIn = 0;
  for (let i = 0; i < BEARINGS; i += 1) {
    const bearing = facadeYaw + (i / BEARINGS) * Math.PI * 2;
    // Signed angle off the door's axis, wrapped into (−π, π].
    const offAxis = Math.abs(
      Math.atan2(Math.sin(bearing - facadeYaw), Math.cos(bearing - facadeYaw)),
    );
    for (const step of [0.05, PLAYER_LONGEST_STEP]) {
      const closest = marchIn(bearing, step);
      if (closest < facade + 1.2) reachedShell += 1;
      if (offAxis > doorCone) {
        if (closest < facade) {
          problems.push(
            `the hotel tower is not solid ${((offAxis * 180) / Math.PI).toFixed(0)}° off its ` +
              `doorway: a player-sized body marched at it in ${step.toFixed(2)} m steps got to ` +
              `${closest.toFixed(2)} m from the centre, inside the ${facade.toFixed(2)} m shell ` +
              `(world/hotel/Hotel.ts registerTowerCollision)`,
          );
        }
      } else if (closest < facade) {
        doorwaysIn += 1;
      }
    }
  }
  if (doorwaysIn === 0) {
    problems.push(
      'no bearing inside the tower doorwaylets a child in at all — the front door is walled up',
    );
  }
  // Green must mean "measured", not "never got near it".
  if (reachedShell < BEARINGS) {
    problems.push(
      `only ${reachedShell} of ${BEARINGS * 2} marches at the hotel tower reached its shell at ` +
        `all — the rest were stopped by other scenery, so this probe is not measuring the tower`,
    );
  }
}

// -------- 23. every doorway fires on the line she walked, at any stride
//
// Jim, playing, 9 Aug 2026: *"The entry is too hard to trigger… it only
// occasionally triggers the entry if I step into exactly the right point. It
// should trigger precisely when walking through the doors but also reliably."*
//
// `checkDoorways` used to ask `bandContains(band, where she is)` once a frame.
// A door tested that way works only for as long as its band stays deeper than
// a stride — and the band's depth, the wall behind it, the sprint speed and
// the frame clamp are four numbers in four files, none of which knows the
// others exist. It now asks `bandCrossed(band, where she was, where she is)`:
// the same question `CollisionWorld.resolveMovement` asks about walls, of the
// same segment, so a door and a wall stop being two different geometry
// problems.
//
// This walks every portal in the hotel for real — the built park's own bands,
// the real collision world resolving each step, `Hotel.update` driving
// `checkDoorways` — in **both** directions, at four stride lengths, eight
// phases of the frame clock each. Every walk must arrive.
//
// The two longest strides are past what `Loop` clamps a frame to, and they are
// the point: they are here for exactly the reason
// `CollisionWorld.checkSubstepBudget` exists — the wall code already refuses to
// take another file's clamp on trust, because the day somebody shortens a
// band, moves the wall behind it or lifts the clamp, the failure is silent and
// only on the stuttering frames. A doorway is the same geometry pointed the
// other way.
//
// Proven red before trusted green, three ways:
//
//  * `checkDoorways` put back on the point test — **9 of the 128 walks never
//    arrived**, all at the 1.85 m stride, and all three portals whose band is
//    1.2 m deep (the lobby's way out, and the suite pair both ways). A child
//    walked clean through the doorway and out the far side with the door never
//    noticing. The tower's own door survives the point test, because its band
//    is 2.05 m deep and the lobby back wall happens to stop her inside it —
//    which is the coincidence this replaces, not a reason to keep leaning on
//    it.
//  * the tower band fattened to stand 2.5 m proud of the facade — **4 false
//    entries**, so the "walking past does not fire" half is not vacuous.
//  * and, for what Jim actually felt: it is probe 22, the open shell, that
//    made the entry seem to need "exactly the right point" — you could walk in
//    beside the jambs and never touch the band at all.
{
  const plot = placedEntry('hotel');
  const facadeYaw = Math.atan2(plot.entranceX - plot.x, plot.entranceZ - plot.z);
  const alongX = Math.sin(facadeYaw);
  const alongZ = Math.cos(facadeYaw);

  /** A player as `Hotel` reads one: a position, and the line she walked to it. */
  const walker = {
    position: new Vector3(),
    previousPosition: new Vector3(),
    riding: false,
    model: { setExpression: () => {} },
    teleportTo(x: number, y: number, z: number) {
      walker.position.set(x, y, z);
      walker.previousPosition.set(x, y, z);
    },
  };
  hotel.attachPlayer(walker as never);

  /** Frames with nobody moving — how a change of space's cooldown runs off. */
  const settle = (frames: number): void => {
    for (let frame = 0; frame < frames; frame += 1) {
      hotel.update({ dt: MAX_FRAME_DELTA, elapsed: frame / 12 } as never);
    }
  };

  interface Portal {
    readonly what: string;
    /** Where she sets off from, and which way she walks. */
    readonly startX: number;
    readonly startZ: number;
    readonly dirX: number;
    readonly dirZ: number;
    /** The space she must end up in. */
    readonly arrive: string;
    /** True if she starts indoors — the hotel has to be told she is. */
    readonly indoors: boolean;
    /** How far she should have to walk; twice this is given up as failed. */
    readonly reach: number;
  }

  // Every walk-through portal the hotel has, both ways round. The suite pair
  // needs the key, which section 5 has already granted.
  const portals: Portal[] = [
    {
      what: "the tower's front door, from the park",
      startX: plot.x + alongX * 11,
      startZ: plot.z + alongZ * 11,
      dirX: -alongX,
      dirZ: -alongZ,
      arrive: LOBBY.space,
      indoors: false,
      reach: 6,
    },
    {
      what: 'the lobby, back out to the park',
      startX: LOBBY.originX,
      startZ: LOBBY.originZ + LOBBY.halfZ - 4,
      dirX: 0,
      dirZ: 1,
      arrive: SPACE_GARDEN,
      indoors: true,
      reach: 6,
    },
    {
      what: 'the "yours" door, into the suite',
      startX: CORRIDOR.originX + CORRIDOR.halfX - 4,
      startZ: CORRIDOR.originZ,
      dirX: 1,
      dirZ: 0,
      arrive: SUITE.space,
      indoors: true,
      reach: 6,
    },
    {
      what: 'the suite, back out to the corridor',
      startX: SUITE.originX - SUITE.halfX + 4,
      startZ: SUITE.originZ,
      dirX: -1,
      dirZ: 0,
      arrive: CORRIDOR.space,
      indoors: true,
      reach: 6,
    },
  ];

  /**
   * Put the hotel back to *she is outside*, honestly — by walking her out of
   * the lobby through its own doors, which is the only way out there is.
   * Needed because being outdoors is a fact the hotel holds, not one the
   * walker's coordinates imply, and the probe before this one left a player
   * standing in the suite.
   */
  const standInPark = (): void => {
    walker.teleportTo(LOBBY.originX, 0, LOBBY.originZ + LOBBY.halfZ - 4);
    hotel.adoptRestoredPlayer();
    settle(24);
    for (let frame = 0; frame < 60; frame += 1) {
      if (spaceAt(walker.position.x, walker.position.z) === SPACE_GARDEN) break;
      walker.previousPosition.copy(walker.position);
      collision.resolveMovement(
        walker.position,
        0,
        PLAYER_LONGEST_STEP / 2,
        PLAYER_RADIUS,
        0,
        MAX_FRAME_DELTA,
      );
      hotel.update({ dt: MAX_FRAME_DELTA, elapsed: frame / 12 } as never);
    }
    collision.setPlayBounds({ radius: 1e6, distanceToEdge: () => 1e6 });
  };

  /** One walk at one stride and one phase. Returns the frame she arrived on. */
  const walkThrough = (portal: Portal, step: number, offset: number): number => {
    // Stand her at the start — offset back along her own path by a fraction of
    // a stride, so the samples land at every phase relative to the doorway.
    const x = portal.startX - portal.dirX * offset;
    const z = portal.startZ - portal.dirZ * offset;
    if (!portal.indoors) standInPark();
    walker.teleportTo(x, 0, z);
    if (portal.indoors) hotel.adoptRestoredPlayer();
    settle(24);
    walker.teleportTo(x, 0, z);

    const frames = Math.ceil((portal.reach * 2 + offset) / step) + 4;
    for (let frame = 0; frame < frames; frame += 1) {
      walker.previousPosition.copy(walker.position);
      collision.resolveMovement(
        walker.position,
        portal.dirX * step,
        portal.dirZ * step,
        PLAYER_RADIUS,
        0,
        MAX_FRAME_DELTA,
      );
      hotel.update({ dt: MAX_FRAME_DELTA, elapsed: frame / 12 } as never);
      if (spaceAt(walker.position.x, walker.position.z) === portal.arrive) return frame;
    }
    return -1;
  };

  const PHASES = 8;
  const strides = [0.05, PLAYER_LONGEST_STEP / 2, PLAYER_LONGEST_STEP, PLAYER_LONGEST_STEP * 2];
  let walks = 0;
  let missed = 0;
  for (const portal of portals) {
    for (const step of strides) {
      for (let phase = 0; phase < PHASES; phase += 1) {
        walks += 1;
        if (walkThrough(portal, step, (phase / PHASES) * step) < 0) {
          missed += 1;
          problems.push(
            `walking through ${portal.what} in ${step.toFixed(2)} m strides (phase ` +
              `${phase}/${PHASES}) never arrived — the doorway did not notice her going ` +
              `through it (world/tapSpacing.ts bandCrossed, Hotel.checkDoorways)`,
          );
        }
      }
    }
  }

  // …and walking *past* the tower's facade, parallel to it, must not fire.
  // Eight passes at 1 m spacings out from the shell, both ways, at a full
  // stride: a swept test that fired on these would open the hotel every time
  // she walked round the outside of it.
  let falseEntries = 0;
  for (let out = 1; out <= 8; out += 1) {
    for (const direction of [1, -1]) {
      const from = TOWER_FACADE_ALONG + out;
      standInPark();
      // Start 14 m off to one side and walk *across* the doorway's axis, so
      // every pass genuinely goes past the front of the building.
      walker.teleportTo(
        plot.x + alongX * from + alongZ * 14 * direction,
        0,
        plot.z + alongZ * from - alongX * 14 * direction,
      );
      settle(24);
      let entered = false;
      for (let frame = 0; frame < 40 && !entered; frame += 1) {
        walker.previousPosition.copy(walker.position);
        collision.resolveMovement(
          walker.position,
          -alongZ * PLAYER_LONGEST_STEP * direction,
          alongX * PLAYER_LONGEST_STEP * direction,
          PLAYER_RADIUS,
          0,
          MAX_FRAME_DELTA,
        );
        hotel.update({ dt: MAX_FRAME_DELTA, elapsed: frame / 12 } as never);
        entered = spaceAt(walker.position.x, walker.position.z) === LOBBY.space;
      }
      if (entered) {
        falseEntries += 1;
        problems.push(
          `walking past the hotel facade ${out} m clear of it, parallel to the doors, entered ` +
            `the lobby — the door fires on somebody who never went through it`,
        );
      }
    }
  }

  console.log(
    `check:hotel — ${walks} walk-throughs of ${portals.length} portals across ` +
      `${strides.length} stride lengths: ${missed} never arrived; ${falseEntries} false entries ` +
      `from walking past the facade.`,
  );
}

// ------------- 24. a room with windows can actually be looked out of
//
// **Built is not offered.** Probe 4 counts panes and probe 8 checks where the
// camera would fly to; between them a room can have all its glass, a vantage
// worked out for it, and no way for a child to ask. That is what happened to
// the lobby: its west wall carries the "Look out" zone, the zone is created
// every frame, its stand spot is clear floor — and `y` is the midpoint of the
// glass, which for a grand room's 1.2–3.6 m glazing is 2.4 m. Every selection
// path drops a zone more than `ZONE_HEIGHT_TOLERANCE` (2.2 m) from the
// player's own `y`, so from the lobby floor at 0 the verb could never appear,
// at any spot in the room. 19 sampled spots along the west wall offered
// nothing but "🏨 Lobby".
//
// So this asks the question the child asks: **standing where the game says to
// stand, on the floor she is on, does `pickInteractZone` hand back the
// window?** It uses the game's own picker rather than re-deriving the rule,
// so it cannot agree with a stale copy of the tolerance.
{
  for (const room of ROOMS) {
    const lookable = (['north', 'west'] as const).filter((side) => {
      const wall = room.windows?.[side];
      return wall && wall.at.length > 0 && wall.lookZone !== false;
    });
    if (lookable.length === 0) continue;
    // **Stand her in the room and tell the hotel so.** Probe 23 walks her out
    // of the building past the facade, which leaves `Hotel.inside` false and
    // `interactZones()` returning nothing at all — this probe used to read
    // that as "the room offers no window" for all six rooms. Ask the public
    // seam rather than inherit whatever the last probe left behind.
    // **Take the player back, and stand her in the room.** Probes 22 and 23
    // attach a `walker` of their own and march it at the building from
    // outside, so by the time this runs the hotel's player is somebody else
    // standing in the park and `interactZones()` returns nothing at all —
    // which this probe read as "no window zone" for all six rooms.
    hotel.attachPlayer(fallenPlayer as never);
    fallenPlayer.position.set(room.originX, 0, room.originZ);
    hotel.adoptRestoredPlayer();
    const zones = hotel.interactZones();
    const windows = zones.filter((zone) => zone.id.startsWith(`hotel-window-${room.space}`));
    if (windows.length === 0) {
      problems.push(
        `${room.space} declares ${lookable.length} lookable window wall(s) and offers no ` +
          `"Look out" zone at all`,
      );
      continue;
    }
    // At least one of them must be selectable from where she actually ends
    // up. The stand spot is resolved through collision first, because that is
    // what the walk does to her: a spot nudged a couple of centimetres by a
    // skirting is not a broken stand spot, and demanding a pixel-perfect one
    // failed two rooms whose verb works perfectly well in the game.
    const standing = (zone: (typeof windows)[number]): { x: number; z: number } => {
      const probe = new Vector3(zone.standX ?? zone.x, 0, zone.standZ ?? zone.z);
      collision.resolve(probe, PLAYER_RADIUS);
      return { x: probe.x, z: probe.z };
    };
    const usable = windows.some((zone) => {
      const at = standing(zone);
      return pickInteractZone(zones, at.x, 0, at.z)?.id === zone.id;
    });
    if (!usable) {
      const shown = windows
        .map((zone) => {
          const at = standing(zone);
          const picked = pickInteractZone(zones, at.x, 0, at.z);
          return (
            `${zone.id} at y=${zone.y.toFixed(2)} m ` +
            `(picker returns ${picked ? picked.id : 'nothing'})`
          );
        })
        .join('; ');
      problems.push(
        `${room.space} has windows but no child standing on its floor can ever be offered ` +
          `"Look outside!" — ${shown}. A zone further than ZONE_HEIGHT_TOLERANCE ` +
          `(${ZONE_HEIGHT_TOLERANCE} m) from her own y is dropped by every selection path`,
      );
    }
  }
}

let occlusionReport = 'occlusion not measured';

// ------------- 25. a child can see herself anywhere in the lobby
//
// **The headline feature led somewhere she could not see herself.** The
// gallery deck is 4.8 m deep and 26 m wide at 5.44 m; at the camera's 38°
// that hid roughly the northern 10 m of a 24.8 m room, and QA walking under
// the arch saw only her pet's head and a sliver of hat. Nothing in the hotel
// had ever faded anything.
//
// `Hotel.updateOverhangCutaway` ghosts the overhang using
// `mezzanineHidesPoint`, which is arithmetic. This probe does **not** re-run
// that arithmetic — it casts a real ray at the **built meshes**, along the
// rig's own view direction, from three heights up her body, exactly the way
// `check:statue-occlusion` does. So the fade's answer and the geometry's
// answer are two independent questions, and the probe fails if the real room
// hides her anywhere the fade would not have fired.
{
  const plan = LOBBY.mezzanine;
  const lobbyShell = hotel.hotelRoot.children.find(
    (child) => child.name === `hotel:${LOBBY.space}`,
  );
  if (!plan || !lobbyShell) {
    problems.push('the lobby has no mezzanine or no shell to measure occlusion against');
  } else {
    hotel.hotelRoot.updateMatrixWorld(true);
    const overhang = lobbyShell.children.find(
      (child) => child.name === 'hotel:lobby/overhang',
    );
    if (!overhang) {
      problems.push(
        'the lobby has no overhang group — nothing can be faded, so a child under the ' +
          'gallery is drawn behind 4.8 m of deck',
      );
    } else {
      const eye = cameraOffset(
        (CAMERA_YAW_DEGREES * Math.PI) / 180,
        (CAMERA_PITCH_DEGREES * Math.PI) / 180,
        CAMERA_DISTANCE,
      );
      const toCamera = new Vector3(eye.x, eye.y, eye.z).normalize();
      const meshes: Object3D[] = [];
      overhang.traverse((node) => {
        if ((node as Mesh).isMesh === true) meshes.push(node);
      });
      const ray = new Raycaster();
      ray.far = 400;
      const PLAYER_HEIGHT = 2.12;
      let sampled = 0;
      let hiddenNotFaded = 0;
      const worst: string[] = [];
      // Every spot on the lobby floor a child can actually stand.
      for (let lx = -LOBBY.halfX + 1; lx <= LOBBY.halfX - 1; lx += 0.5) {
        for (let lz = -LOBBY.halfZ + 1; lz <= LOBBY.halfZ - 1; lz += 0.5) {
          const x = LOBBY.originX + lx;
          const z = LOBBY.originZ + lz;
          if (Math.abs(world.building.surfaces.sample(x, z, 0.3)) > 0.05) continue;
          if (deflection(x, z) > 0.01) continue;
          sampled += 1;
          let hidden = false;
          for (const fraction of [1, 0.75, 0.5]) {
            ray.set(new Vector3(x, PLAYER_HEIGHT * fraction, z), toCamera);
            if (ray.intersectObjects(meshes, false).length > 0) {
              hidden = true;
              break;
            }
          }
          if (!hidden) continue;
          // The room really does hide her here. The fade must know it.
          const fades = [1, 0.75, 0.5].some((fraction) =>
            mezzanineHidesPoint(plan, lx, PLAYER_HEIGHT * fraction, lz),
          );
          if (!fades) {
            hiddenNotFaded += 1;
            if (worst.length < 6) worst.push(`(${lx.toFixed(1)}, ${lz.toFixed(1)})`);
          }
        }
      }
      if (sampled === 0) {
        problems.push('no standable lobby floor was sampled for occlusion — the probe is blind');
      }
      if (hiddenNotFaded > 0) {
        problems.push(
          `${hiddenNotFaded} of ${sampled} standable lobby spots hide the player behind the ` +
            `overhang with nothing fading it — she is invisible at ${worst.join(', ')}` +
            `${hiddenNotFaded > worst.length ? ' and more' : ''}`,
        );
      }
      occlusionReport =
        `${sampled} standable lobby spots, ${hiddenNotFaded} where the overhang hides her ` +
        `unfaded`;
    }
  }
}

// -------------- 26. every doorway leaves a real stride of floor past it

// Jim, 18 Aug 2026, on `/hotel-suite`: *"is this a joke? … dumb furniture
// clearly still in the way … non-functional by any degree."* The lounge
// sofa's own placement comment had claimed a clean 0.28 m margin from the
// doorway — true, and useless: `HotelProps.assertDoorwaysClear` (issue #273)
// only ever asked whether a footprint overlapped a thin band hugging the
// wall, sized to keep the *opening* clear. Nothing asked whether a body could
// take a single stride past that band before meeting something solid, so a
// sofa parked just past the band still choked most of the doorway's own
// width — `layout.ts`'s `DOORWAY_THROUGH_DEPTH` is the fix for that gap.
//
// This probe asks that question directly, and **independently of the
// geometry `isClearOfDoorways` checks** — CLAUDE.md's "a check can pass
// without checking anything" the other way round: a bug in the zone math
// itself (exactly what shipped here — a zone too shallow to matter) cannot
// blind a check built from different first principles. It reads the same
// `HotelRoom.gaps`/`.partitions` data `doorwayClearanceZones` is built from,
// but never calls that function: instead it marches a player-sized body at
// the real `CollisionWorld`, from outside, across several bearings spanning
// each doorway's width, both directions, and asserts she can clear a full
// `DOORWAY_THROUGH_DEPTH` past the wall plane from every one of them — the
// same "probe it from outside, from many bearings" standard the hotel-shell
// bug (9 Aug 2026) forced on the tower's own front door (probe 22).
//
// Proven red first: run this against the pre-fix suite (sofa at z = 3.9,
// TV at `FLOOR_Z + 0.4`) and it reports both doorways short by 0.4–0.6 m.

interface DoorwayCrossing {
  readonly room: string;
  readonly throughAxis: 'x' | 'z';
  /** World coordinate of the wall plane, along `throughAxis`. */
  readonly wallPos: number;
  /** World coordinate of the doorway's own centre, along the other axis. */
  readonly alongCenter: number;
  readonly alongHalfWidth: number;
}

/**
 * Every doorway a body can walk through in `room` — outer wall gaps and
 * partition doors alike — as a crossing a probe can be marched at. Kept
 * deliberately separate from `layout.ts`'s `doorwayClearanceZones`: both read
 * `HotelRoom.gaps`/`.partitions`, but this one never calls that function, so
 * a mistake in *its* geometry cannot also be baked into the thing checking
 * it (the same reasoning `park-harness.mts`'s inert `iris` documents for why
 * a headless check has to drive the real thing, not a description of it).
 */
function doorwayCrossings(room: HotelRoom): DoorwayCrossing[] {
  const crossings: DoorwayCrossing[] = [];
  for (const side of ['north', 'south', 'east', 'west'] as const) {
    const gap = room.gaps[side];
    if (!gap) continue;
    const [from, to] = gap;
    if (side === 'north' || side === 'south') {
      crossings.push({
        room: room.space,
        throughAxis: 'z',
        wallPos: room.originZ + (side === 'north' ? -room.halfZ : room.halfZ),
        alongCenter: room.originX + (from + to) / 2,
        alongHalfWidth: (to - from) / 2,
      });
    } else {
      crossings.push({
        room: room.space,
        throughAxis: 'x',
        wallPos: room.originX + (side === 'west' ? -room.halfX : room.halfX),
        alongCenter: room.originZ + (from + to) / 2,
        alongHalfWidth: (to - from) / 2,
      });
    }
  }
  for (const run of room.partitions ?? []) {
    const doorHalf = SUITE_DOOR_WIDTH / 2;
    for (const at of run.doors) {
      crossings.push(
        run.along === 'x'
          ? {
              room: room.space,
              throughAxis: 'z',
              wallPos: room.originZ + run.at,
              alongCenter: room.originX + at,
              alongHalfWidth: doorHalf,
            }
          : {
              room: room.space,
              throughAxis: 'x',
              wallPos: room.originX + run.at,
              alongCenter: room.originZ + at,
              alongHalfWidth: doorHalf,
            },
      );
    }
  }
  return crossings;
}

/** How far before the wall plane each march starts. */
const CROSSING_APPROACH = 1.0;
// Exactly what `DOORWAY_THROUGH_DEPTH` promises a *body*, not a point: the
// zone keeps every solid footprint's near edge at least `clearance +
// DOORWAY_THROUGH_DEPTH` from the wall, and `clearance` is `PLAYER_RADIUS`
// itself (`place.ts`'s `DOORWAY_CLEARANCE`) — so a body's own centre,
// stopped `PLAYER_RADIUS` short of whatever it meets, can always reach
// `(clearance + DOORWAY_THROUGH_DEPTH) − PLAYER_RADIUS` = `DOORWAY_THROUGH_DEPTH`
// past the wall. Asking for more here would be asking this probe to prove a
// promise the zone never made; asking for less would let furniture creep
// back to where `assertDoorwaysClear` alone already missed it once.
const CROSSING_TARGET = DOORWAY_THROUGH_DEPTH;
const CROSSING_STEP = 0.03;
/** Samples across a doorway's width, inset so a bearing is never aimed at a jamb. */
const CROSSING_BEARINGS = 5;

/**
 * Marches a player-sized body through one doorway crossing, from `sign`'s
 * side, at `offset` from the doorway's own centre. Returns how far past the
 * wall plane she actually got (negative if she never reached it at all).
 */
function marchCrossing(crossing: DoorwayCrossing, sign: 1 | -1, offset: number): number {
  const along = crossing.alongCenter + offset;
  const probe =
    crossing.throughAxis === 'z'
      ? new Vector3(along, 0, crossing.wallPos - sign * CROSSING_APPROACH)
      : new Vector3(crossing.wallPos - sign * CROSSING_APPROACH, 0, along);
  const steps = Math.round((CROSSING_APPROACH + CROSSING_TARGET + 0.3) / CROSSING_STEP);
  for (let i = 0; i < steps; i += 1) {
    if (crossing.throughAxis === 'z') probe.z += sign * CROSSING_STEP;
    else probe.x += sign * CROSSING_STEP;
    collision.resolve(probe, PLAYER_RADIUS);
  }
  const reachedAt = crossing.throughAxis === 'z' ? probe.z : probe.x;
  return (reachedAt - crossing.wallPos) * sign;
}

let crossingsChecked = 0;
const crossingFailures: string[] = [];
for (const room of ROOMS) {
  for (const crossing of doorwayCrossings(room)) {
    const usable = crossing.alongHalfWidth - PLAYER_RADIUS;
    const offsets =
      usable <= 0
        ? [0]
        : Array.from({ length: CROSSING_BEARINGS }, (_, i) =>
            usable * (-1 + (2 * i) / (CROSSING_BEARINGS - 1)),
          );
    for (const sign of [1, -1] as const) {
      for (const offset of offsets) {
        crossingsChecked += 1;
        const reached = marchCrossing(crossing, sign, offset);
        if (reached < CROSSING_TARGET - 0.1) {
          crossingFailures.push(
            `${crossing.room} doorway at ${crossing.throughAxis}=${crossing.wallPos.toFixed(2)} ` +
              `(along ${crossing.alongCenter.toFixed(2)}, offset ${offset.toFixed(2)}, ` +
              `${sign > 0 ? '+' : '-'}${crossing.throughAxis}): a player-sized march only reached ` +
              `${reached.toFixed(2)} m past the wall, short of the ${CROSSING_TARGET.toFixed(2)} m a ` +
              `real stride needs`,
          );
        }
      }
    }
  }
}
if (crossingsChecked === 0) {
  problems.push('no doorway crossings were built to march at — the probe is blind');
}
if (crossingFailures.length > 0) {
  // One line per doorway/bearing would drown the report in near-duplicates
  // (five bearings times two directions per doorway); name the doorways,
  // not every bearing that failed at each one.
  const byDoorway = new Set(
    crossingFailures.map((line) => line.slice(0, line.indexOf(':'))),
  );
  problems.push(
    `${crossingFailures.length}/${crossingsChecked} doorway crossing march(es) fell short across ` +
      `${byDoorway.size} doorway(s): ${[...byDoorway].join('; ')}`,
  );
}

// -------------- 27. no piece of furniture sits inside a wall's solid band

// PR #281 review, 18 Aug 2026: the breakfast bathroom's new west partition
// wall overlapped a pre-existing chair at table b1-d by 0.324 m — a real
// child-visible bug (CLAUDE.md's "anything that looks solid must be solid"),
// invisible to every check that ran green. `mustBeSolid`'s "is this one
// chair solid" probe (2/3, above) only ever asks about b1-a; `check:tap-spacing`
// measures interaction zones, not physical footprints. Nothing anywhere asked
// whether one piece of registered hotel furniture physically overlaps a wall,
// so a partition move that happened to graze a chair could only ever be found
// by a reviewer doing the arithmetic by hand — exactly the "check that can't
// fail" gap CLAUDE.md warns about, just never written down as a probe.
//
// **General, not the one instance.** Every round footprint `HotelProps.place`
// registered as a real solid `CollisionWorld` circle — chairs, tables,
// columns, statues, planters, plinths, bedside tables, pet plinths, the lot —
// against every wall segment `CollisionWorld.forEachWall` holds (a room's
// own outer walls and every partition), using the exact same
// clamped-point-to-segment distance `CollisionWorld.resolve` itself uses.
// That clamp is what makes a wall's *end* a rounded cap rather than a flat
// face — the same shape that made the b1-d chair's overlap live at a
// partition's corner rather than along either wall's own face, which is
// exactly why the review had to trace it by hand instead of eyeballing a
// wall's straight run. Asking the real `CollisionWorld` the real question
// means this probe cannot disagree with what a child's own body would meet.
//
// Scoped to each room by distance from its own origin (`HOTEL_PLAY_RADIUS`,
// the same leash the room's own play boundary already uses) rather than by
// object identity — no collider carries a tag saying which room built it, and
// "is this near this room" is the honest question, not a guess at which prop
// belongs to which list. Rectangular footprints (`addRectangle`, a counter, a
// sofa) are wall-shaped themselves and are deliberately out of scope — the
// reviewer's own suggested shape for this check ("any registered circle
// collider vs any wall collider") is what is implemented here.
//
// Running this exhaustively found more than the one instance: eight
// pre-existing pairs (four lobby crystal clusters/columns against the outer
// wall and a reception-area wall, two suite pieces against a partition and
// the north wall) also register a few centimetres of overlap — and diffing
// against the state of the tree *before* this task's own fix confirms they
// are unchanged by it (same eight, same numbers, on both sides of the b1-d
// fix). Two different severities live inside "overlap", and this probe tells
// them apart the same way the review itself described the real bug — not by
// how much the disc's *edge* pokes in, but by whether the disc's own **centre**
// ends up inside the wall's solid band at all:
//
//  * b1-d's chair: centre 0.226 m from the wall's own line, **inside** its
//    0.25 m half-thickness by 0.024 m — the wall's line passes through the
//    chair's own middle, which is the "roughly half the chair is embedded"
//    the review described, and can only happen when a piece of furniture is
//    placed too close to a wall it was never checked against.
//  * The eight pre-existing pairs: every one has its centre 0.5–0.7 m clear
//    of its wall's line — comfortably outside the half-thickness band — and
//    only the *outer edge* of an oversized, deliberately generic collider
//    (`Hotel.placeProps`'s scatter-prop default, `radius: 0.6`, shared by
//    every crystal/planter regardless of its own visual size — never sized
//    down to the individual model) grazes a few centimetres past the wall's
//    face. Nothing here is a hole a body can walk through, and the mesh
//    itself was never near the wall to begin with.
//
// A **centre** inside a wall's own band is a hard failure — a piece of
// furniture placed there was never checked against the wall at all, which is
// this probe's whole reason to exist. A grazed **edge**, centre still clear,
// is reported as a warning (this file's `check:tap-spacing` sibling already
// has exactly this two-tier pattern for its own "harmless ambiguity" case) —
// visible for a future pass on the scatter-prop radius, but not a reason to
// block a PR that never touched it.
//
// Proven red before trusted green: run against the pre-fix `BREAKFAST.partitions`
// (west wall at local x=8.6, z 5.8–11.3) and this probe reports the breakfast
// room's chair with its centre 0.024 m inside the wall's own band — the exact
// number the review measured by hand.

/** How far inside a wall's own half-thickness a furniture disc's *centre* may sit before this probe calls it embedded. */
const FURNITURE_CENTRE_TOLERANCE = 0.005;
/** How far a furniture disc's *edge* may overlap a wall (centre still clear) before it is even worth a warning. */
const FURNITURE_EDGE_TOLERANCE = 0.02;

/** The point on segment `(x1,z1)`–`(x2,z2)` nearest `(px,pz)` — `CollisionWorld.resolve`'s own clamp, read back. */
function closestPointOnWall(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): { x: number; z: number } {
  const ax = x2 - x1;
  const az = z2 - z1;
  const lengthSquared = ax * ax + az * az;
  if (lengthSquared < 1e-8) return { x: x1, z: z1 };
  let t = ((px - x1) * ax + (pz - z1) * az) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: x1 + ax * t, z: z1 + az * t };
}

interface HotelWallSegment {
  readonly x1: number;
  readonly z1: number;
  readonly x2: number;
  readonly z2: number;
  readonly halfThickness: number;
}
interface HotelFurnitureCircle {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

let furnitureWallPairsChecked = 0;
const furnitureWallEmbeds: string[] = [];
const furnitureWallGrazes: string[] = [];
for (const room of ROOMS) {
  const nearRoom = (x: number, z: number): boolean =>
    Math.hypot(x - room.originX, z - room.originZ) < HOTEL_PLAY_RADIUS;

  const walls: HotelWallSegment[] = [];
  collision.forEachWall((x1, z1, x2, z2, halfThickness) => {
    if (nearRoom(x1, z1) || nearRoom(x2, z2)) walls.push({ x1, z1, x2, z2, halfThickness });
  });

  const circles: HotelFurnitureCircle[] = [];
  collision.forEachCircle((x, z, radius) => {
    if (radius > 0 && nearRoom(x, z)) circles.push({ x, z, radius });
  });

  for (const circle of circles) {
    for (const wall of walls) {
      furnitureWallPairsChecked += 1;
      const closest = closestPointOnWall(circle.x, circle.z, wall.x1, wall.z1, wall.x2, wall.z2);
      const distance = Math.hypot(circle.x - closest.x, circle.z - closest.z);
      const centreEmbed = wall.halfThickness - distance;
      const edgeOverlap = wall.halfThickness + circle.radius - distance;
      const where =
        `${room.space}: furniture at local (${(circle.x - room.originX).toFixed(2)}, ` +
        `${(circle.z - room.originZ).toFixed(2)}) r=${circle.radius.toFixed(2)} vs the wall local ` +
        `(${(wall.x1 - room.originX).toFixed(2)}, ${(wall.z1 - room.originZ).toFixed(2)})–` +
        `(${(wall.x2 - room.originX).toFixed(2)}, ${(wall.z2 - room.originZ).toFixed(2)})`;
      if (centreEmbed > FURNITURE_CENTRE_TOLERANCE) {
        furnitureWallEmbeds.push(`${where}: centre is ${centreEmbed.toFixed(3)} m inside the wall's own band`);
      } else if (edgeOverlap > FURNITURE_EDGE_TOLERANCE) {
        furnitureWallGrazes.push(`${where}: edge overlaps by ${edgeOverlap.toFixed(3)} m, centre clear`);
      }
    }
  }
}
if (furnitureWallPairsChecked === 0) {
  problems.push('no furniture-vs-wall pairs were checked in the hotel — the probe is blind');
}
if (furnitureWallEmbeds.length > 0) {
  problems.push(
    `${furnitureWallEmbeds.length}/${furnitureWallPairsChecked} furniture-vs-wall pair(s) have a ` +
      `furniture centre embedded inside the wall's own band: ${furnitureWallEmbeds.join('; ')}`,
  );
}
for (const graze of furnitureWallGrazes) console.log(`  ~ ${graze}`);

// ----------------------------------------------------------------- report

console.log(
  `check:hotel — ${npcs.all.length} children (${hotel.residents.length} of them hotel residents), ` +
    `lowest foot at y=${lowest.toFixed(2)} m after ${SETTLE_SECONDS} s; ` +
    `${mustBeSolid.length + 1} props solid, 3 beds soft and standable; ` +
    `${panes}/${declared} declared window panes built; ${occlusionReport}; ` +
    `${crossingsChecked} doorway crossing marches, ${crossingFailures.length} fell short; ` +
    `${furnitureWallPairsChecked} furniture-vs-wall pairs, ${furnitureWallEmbeds.length} embedded, ` +
    `${furnitureWallGrazes.length} grazed (warnings).`,
);

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(`check:hotel FAILED — ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('check:hotel OK');
