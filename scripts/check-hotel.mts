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
import { BackSide, Box3, Mesh, Raycaster, Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { HotelCinematic, MIN_SHOT_DISTANCE } from '../src/world/hotel/cinematic.ts';
import { IsoCamera } from '../src/core/IsoCamera.ts';
import { Player } from '../src/entities/Player.ts';
import { BED_MATTRESS_TOP } from '../src/art/models/hotelAssets.ts';
import {
  CAMERA_DISTANCE,
  CAMERA_PITCH_DEGREES,
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
  GARDEN_FLOOR,
  HOTEL_FLOORS,
  LOBBY,
  OCEAN_FLOOR,
  SUITE,
  SUITE_BEDSIDE_X,
  SUITE_BEDSIDE_Z,
  SUITE_BED_SPOTS,
  SUITE_DOOR_WIDTH,
  relativeLuminance,
  THEME_FLOOR_CONTRAST_MIN,
} from '../src/world/hotel/layout.ts';
import { segmentsMinusGaps } from '../src/world/wallRuns.ts';
import { BUFFET_TOP, SOFA_SEAT_TOP } from '../src/world/hotel/dressing.ts';
import { spaceAt, SPACE_GARDEN } from '../src/world/spaces.ts';
import { placedEntry } from '../src/world/parkLayout.ts';
import { TOWER_DOOR_HALF, TOWER_FACADE_ALONG } from '../src/world/hotel/Hotel.ts';
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
  ['the lobby RiPika statue', LOBBY.originX + 0, LOBBY.originZ - 1],
  // Reception sits on the entrance axis now (the 7 Aug relayout): straight up
  // the runner from the doors, against the gallery face. Probe 13 separately
  // asserts the interact zone is anchored on this same footprint.
  ['the reception desk', LOBBY.originX + 0, LOBBY.originZ - 5.9],
  ['a lobby sofa', LOBBY.originX + 5.9, LOBBY.originZ + 3.6],
  ['a lobby crystal column', LOBBY.originX - 11.9, LOBBY.originZ - 6.6],
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
  ['a lobby sofa', LOBBY.originX + 5.9, LOBBY.originZ + 3.6, SOFA_SEAT_TOP],
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

// ------------------------------------------- 6. the mezzanine holds her up
//
// Two facts, and they are the two the whole design rests on (see
// `layout.ts`'s `Mezzanine`): the deck is somewhere you can stand, and the
// mass under it is solid from the lobby floor — because the balustrade on top
// is deliberately *not* a collider, and the front face is the only thing
// standing between a child and a three-metre drop.
const mezzanine = LOBBY.mezzanine;
if (!mezzanine) {
  problems.push('the lobby has no mezzanine — Jim asked for a double-height lobby with one');
} else {
  const deckX = LOBBY.originX + (mezzanine.minX + mezzanine.maxX) / 2;
  const deckZ = LOBBY.originZ + (mezzanine.minZ + mezzanine.maxZ) / 2;
  const top = world.building.surfaces.sample(deckX, deckZ, mezzanine.height);
  if (Math.abs(top - mezzanine.height) > 0.01) {
    problems.push(
      `the mezzanine deck is not standable: sample says ${top.toFixed(2)} m where the deck is ` +
        `${mezzanine.height.toFixed(2)} m`,
    );
  }
  // Its front, probed from the lobby side.
  if (deflection(deckX, LOBBY.originZ + mezzanine.maxZ + 0.5) < 0.1) {
    problems.push(
      'the mezzanine has no solid front — a child walks under the gallery, and the balustrade ' +
        'above her is deliberately not a collider, so nothing is holding anyone up',
    );
  }

  // The sweeping stair: every tread standable, and each step within one stride
  // of the last. A stair whose rise exceeds `BUILDING_STEP_UP` is a stair that
  // looks perfect and cannot be climbed.
  const { stair } = mezzanine;
  let previous = 0;
  for (let i = 0; i < stair.treads; i += 1) {
    const angle = stair.fromAngle + ((stair.toAngle - stair.fromAngle) * (i + 0.5)) / stair.treads;
    const radius = (stair.innerRadius + stair.outerRadius) / 2;
    const x = LOBBY.originX + stair.centreX - Math.sin(angle) * radius;
    const z = LOBBY.originZ + stair.centreZ + Math.cos(angle) * radius;
    const height = world.building.surfaces.sample(x, z, previous);
    if (height <= previous - 0.01) {
      problems.push(
        `sweeping-stair tread ${i} does not rise: sample says ${height.toFixed(2)} m, standing on ` +
          `${previous.toFixed(2)} m — the flight cannot be climbed past here`,
      );
      break;
    }
    previous = height;
  }
  if (Math.abs(previous - mezzanine.height) > 0.01) {
    problems.push(
      `the sweeping stair tops out at ${previous.toFixed(2)} m but the deck is at ` +
        `${mezzanine.height.toFixed(2)} m — the flight does not climb the full height`,
    );
  }

  // **…and the top tread has to be ON the gallery.**
  //
  // Reaching 3.2 m is not the same claim, and asserting only that is a green
  // that cannot fail: a stair swept about the wrong centre still climbs its
  // full height perfectly and simply tops out in mid-air, one step from a deck
  // it never touches. That is the exact bug this file caught on the first run
  // after the stair landed (the arc's centre had never been updated from a
  // first draft), and re-mutating the centre afterwards showed the height
  // check sailing through it. Measured on the built numbers, so it is a claim
  // about where the flight actually ends.
  const topAngle = stair.toAngle - (stair.toAngle - stair.fromAngle) / (stair.treads * 2);
  const topRadius = (stair.innerRadius + stair.outerRadius) / 2;
  const topX = stair.centreX - Math.sin(topAngle) * topRadius;
  const topZ = stair.centreZ + Math.cos(topAngle) * topRadius;
  const onDeck =
    topX >= mezzanine.minX &&
    topX <= mezzanine.maxX &&
    topZ >= mezzanine.minZ &&
    topZ <= mezzanine.maxZ;
  if (!onDeck) {
    problems.push(
      `the sweeping stair's top tread is at (${topX.toFixed(1)}, ${topZ.toFixed(1)}), outside the ` +
        `gallery's (${mezzanine.minX}…${mezzanine.maxX}, ${mezzanine.minZ}…${mezzanine.maxZ}) — ` +
        `it climbs the full height and stops in mid-air beside the deck`,
    );
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
  const deckBand: [number, number] = [2.5, 3.3];
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
    const stair = LOBBY.mezzanine?.stair;
    if (stair) {
      const toStair = Math.hypot(
        receptionZone.x - (LOBBY.originX + stair.centreX),
        receptionZone.z - (LOBBY.originZ + stair.centreZ),
      );
      if (toStair > stair.innerRadius - 0.8 && toStair < stair.outerRadius + 0.8) {
        problems.push(
          `the reception zone's anchor is ${toStair.toFixed(1)} m from the stair's centre — on ` +
            `the staircase, which is QA's "get a key near the staircase" bug exactly`,
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

// --------------------------------- 14. the stair climbs at walking pace too
//
// Probe 6 asks each tread "are you standable?" from the tread below — an
// instant query, which is exactly how it stayed green while no real player
// could climb the thing (QA, 8 Aug 2026). A real player's y *damps* onto the
// ground (`Player`'s 0.04 s time constant), so at speed her sampled height
// lags the surface, and once the lag eats the step-up ceiling the next tread
// is never offered: the floor snaps to the slab and she walks under the
// flight into the gallery's hollow. This probe walks the way she walks — a
// damped y, sprint pace — along the mid-radius spiral, and straight west
// across the fan on QA's exact trap line. The stair's quarter-riser slices
// are what make both end well; registering one flat wedge per tread fails
// this with the spiral march finishing on the slab.
{
  const mez = LOBBY.mezzanine;
  if (mez) {
    const { stair } = mez;
    const midR = (stair.innerRadius + stair.outerRadius) / 2;
    const surfaces = world.building.surfaces;
    const dt = 1 / 60;
    // Player's own ground damp: `damp(y, groundY, 0.04, dt)` — the real
    // half-life form from mathUtils, imported rather than re-derived,
    // because an approximation of it is exactly how the first draft of this
    // probe stayed green against geometry a real player could not climb.
    const GROUND_DAMP_HALF_LIFE = 0.04;
    const sprint = PLAYER_MAX_SPEED * PLAYER_SPRINT_MULTIPLIER;

    const dampWalk = (points: (s: number) => [number, number], metres: number): number => {
      let y = 0;
      const steps = Math.ceil(metres / (sprint * dt));
      for (let s = 0; s <= steps; s += 1) {
        const [x, z] = points(s / steps);
        const floor = surfaces.sample(x, z, y);
        y = damp(y, floor, GROUND_DAMP_HALF_LIFE, dt);
        if (y - floor > 0.5) y = floor;
      }
      return y;
    };

    const arcLength = (stair.toAngle - stair.fromAngle) * midR;
    const spiralEnd = dampWalk((t) => {
      const a = stair.fromAngle + (stair.toAngle - stair.fromAngle) * t;
      return [
        LOBBY.originX + stair.centreX - Math.sin(a) * midR,
        LOBBY.originZ + stair.centreZ + Math.cos(a) * midR,
      ];
    }, arcLength);
    if (Math.abs(spiralEnd - mez.height) > 0.45) {
      problems.push(
        `sprinting up the stair's own spiral ends at y=${spiralEnd.toFixed(2)} m, not the deck's ` +
          `${mez.height.toFixed(2)} m — the flight defeats the ground damp and cannot be climbed`,
      );
    }

    // The damp-lag rule, asserted on the surface itself. The march above is
    // a smoke test — an idealised walker turns out to climb geometry a real
    // one cannot (measured live, 8 Aug 2026: teleporting onto any tread
    // stood her at its height while walking up never rose above 0.00), so
    // the discriminating assertion is geometric: no sprint-pace stride up
    // the flight may present a full riser at once. The slices present a
    // quarter-riser each (measured 0.16 a stride here); the one flat wedge
    // per tread this replaced presents 0.32–0.64 a stride, which the ground
    // damp demonstrably cannot follow. The boundary sits between the two at
    // the riser's own height minus a shim. The scan stops where it enters
    // the deck rectangle: the deck's edge is a legitimate step *onto* the
    // deck from the top treads, and probe 6 owns the deck.
    let worstStepRise = 0;
    const stride = sprint * dt;
    for (const r of [stair.innerRadius + 0.2, midR, stair.outerRadius - 0.2]) {
      let floorHere = 0;
      for (let along = stride; along < arcLength; along += stride) {
        const a = stair.fromAngle + along / r;
        if (a > stair.toAngle) break;
        const x = LOBBY.originX + stair.centreX - Math.sin(a) * r;
        const z = LOBBY.originZ + stair.centreZ + Math.cos(a) * r;
        const lx = x - LOBBY.originX;
        const lz = z - LOBBY.originZ;
        if (lx > mez.minX && lx < mez.maxX && lz > mez.minZ && lz < mez.maxZ) break;
        const next = surfaces.sample(x, z, floorHere + 0.01);
        worstStepRise = Math.max(worstStepRise, next - floorHere);
        floorHere = next;
      }
    }
    const riser = mez.height / stair.treads;
    const stepBudget = riser - 0.02;
    if (worstStepRise > stepBudget) {
      problems.push(
        `one sprint-pace step up the stair raises the floor ${worstStepRise.toFixed(2)} m — ` +
          `a whole riser (${riser.toFixed(2)} m) or more at once, which is exactly the ` +
          `geometry the ground damp was measured unable to climb`,
      );
    }

    // QA's trap line: pushing due west across the fan from the open floor,
    // with the real collision world deflecting the body as it goes — the
    // strings and balustrade are what turn "across the fan" into "up the
    // fan", so a kinematic line without them walks through the outer string
    // and proves nothing. Pre-fix this ends at y = 0 inside the gallery's
    // hollow; post-fix the body is carried up the flight as it slides.
    const trap = new Vector3(LOBBY.originX + 7.9, 0, LOBBY.originZ - 5.4);
    let trapY = 0;
    for (let s = 0; s < Math.ceil(6.0 / (sprint * dt)); s += 1) {
      trap.x -= sprint * dt;
      collision.resolve(trap, PLAYER_RADIUS, trapY, dt);
      const floor = surfaces.sample(trap.x, trap.z, trapY);
      trapY = damp(trapY, floor, GROUND_DAMP_HALF_LIFE, dt);
      if (trapY - floor > 0.5) trapY = floor;
    }
    if (trapY < 0.9) {
      problems.push(
        `pushing west across the stair fan leaves a player at y=${trapY.toFixed(2)} m — ` +
          `under the flight at ground level, on the way into the gallery's hollow`,
      );
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
// running the bed zone's own Sleep action, ticked one frame so the ride pose
// is applied exactly as the game applies it. Then three claims, measured on
// the posed kid and the built bed:
//  * her head is **above the mattress top** and at the pillow end;
//  * a straight-down ray at her head hits *her*, not a blanket — head out;
//  * a straight-down ray over her body hits the bed's nap blanket — tucked in.
//
// Proven red before trusted green, on the pre-fix build:
//   x a napping child's head is at y=-0.66 m — the mattress top is 0.55 m,
//     so she has vanished into the bed
//   x nothing over the napping child's body says 'blanket' — no blanket mesh
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
      sleep.run();
      napper.update({
        dt: 1 / 60,
        elapsed: 0,
        input: { justPressed: () => false, isDown: () => false },
      } as never);
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

      // Hand the room back the way the earlier probes left it: one giant tick
      // outlasts any nap.
      hotel.update({ dt: 999, elapsed: 0 } as never);
      scene.remove(napper.group);
    }
  }
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

// ------------------------- 21. the suite has a bathroom with the manners
//
// Jim, 8 Aug 2026: *"Add a bathroom using the models and rules from the
// bathroom in the other big building."* The castle's rules
// (`building/Toilets.ts`, from GAME_DESIGN.md): the pan and basin are the
// shared factories, using one is the two-beat flush-then-wash routine, and a
// **privacy roof** slides over the room while she is in it and lifts at the
// wash beat — on before she is out of sight, never able to trap her. The
// suite's bathroom reuses those exact owners; this probe checks the built
// result behaves like the castle's:
//  * the pan and basin are solid (place.ts registered them), the pan
//    mountable like any low flat-topped prop;
//  * a bathroom zone exists, offers a real action, and its stand spot is
//    walkable;
//  * a player standing in the bathroom is covered by the roof, and the wash
//    beat lifts it while she is still inside.
{
  const bathX = SUITE.originX - 7.8;
  const bathZ = SUITE.originZ + 4.6;
  if (deflection(bathX, bathZ) < 0.1) {
    problems.push('the suite bathroom pan is not solid — a child walks straight through it');
  }
  if (deflection(SUITE.originX - 9.7, SUITE.originZ + 2.45) < 0.1) {
    problems.push('the suite bathroom basin is not solid — a child walks straight through it');
  }
  const atopPan = deflectionAt(bathX, 0.75, bathZ);
  if (atopPan > 0.01) {
    problems.push(
      `the suite bathroom pan pushes a child stood on its top ${atopPan.toFixed(2)} m sideways — ` +
        'solid and standable are fighting (place.ts)',
    );
  }

  hotel.attachPlayer(fallenPlayer as never);
  fallenPlayer.position.set(SUITE.originX - 7.6, 0, SUITE.originZ + 4.8);
  hotel.adoptRestoredPlayer();
  const bathroomZone = hotel.interactZones().find((zone) => zone.id === 'hotel-bathroom');
  if (!bathroomZone) {
    problems.push('the suite offers no bathroom zone at all — nothing to tap, no routine to run');
  } else {
    if ((bathroomZone.actions?.() ?? []).length === 0) {
      problems.push('the bathroom zone offers no actions — its sign can never appear');
    }
    if (
      bathroomZone.standX !== undefined &&
      bathroomZone.standZ !== undefined &&
      deflection(bathroomZone.standX, bathroomZone.standZ) > 0.01
    ) {
      problems.push('the bathroom zone asks her to stand inside something solid');
    }

    // The privacy roof, driven exactly as the game drives it: she stands in
    // the room, frames pass, the lid covers; the wash beat lifts it while
    // she is still there (the castle's rule, `building/Toilets.ts`).
    const suiteShell = hotel.hotelRoot.children.find(
      (child) => child.name === `hotel:${SUITE.space}`,
    );
    let roofGroup: { visible: boolean } | null = null;
    suiteShell?.traverse((object) => {
      if (object.name === 'toilet-roof') roofGroup = object;
    });
    if (!roofGroup) {
      problems.push('the suite bathroom has no privacy roof — the castle rule it must honour');
    } else {
      const tick = (seconds: number): void => {
        for (let i = 0; i < Math.ceil(seconds * 60); i += 1) {
          hotel.update({ dt: 1 / 60, elapsed: i / 60 } as never);
        }
      };
      tick(1.2);
      if (!(roofGroup as { visible: boolean }).visible) {
        problems.push(
          'a child standing in the suite bathroom is not covered by the privacy roof — ' +
            'the lid must lead her in',
        );
      }
      const useAction = (bathroomZone.actions?.() ?? [])[0];
      useAction?.run();
      tick(3.0);
      if ((roofGroup as { visible: boolean }).visible) {
        problems.push(
          'the privacy roof is still down after the wash beat — the lid must lift while she ' +
            'washes her hands, not trap her',
        );
      }
      // Out of the room: nothing remembered, the roof stays up.
      fallenPlayer.position.set(SUITE.originX, 0, SUITE.originZ);
      tick(1.0);
      if ((roofGroup as { visible: boolean }).visible) {
        problems.push('the privacy roof stayed on over an empty bathroom');
      }
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

// ----------------------------------------------------------------- report

console.log(
  `check:hotel — ${npcs.all.length} children (${hotel.residents.length} of them hotel residents), ` +
    `lowest foot at y=${lowest.toFixed(2)} m after ${SETTLE_SECONDS} s; ` +
    `${mustBeSolid.length + 1} props solid, 3 beds soft and standable; ` +
    `${panes}/${declared} declared window panes built.`,
);

if (problems.length > 0) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(`check:hotel FAILED — ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('check:hotel OK');
