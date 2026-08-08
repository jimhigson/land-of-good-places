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
 * −6 m.
 */

import './headless-canvas.mjs';
import { Box3, Mesh, Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { HotelCinematic, MIN_SHOT_DISTANCE } from '../src/world/hotel/cinematic.ts';
import { NPC_RADIUS, PLAYER_RADIUS } from '../src/core/constants.ts';
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
} from '../src/world/hotel/layout.ts';
import { BUFFET_TOP, SOFA_SEAT_TOP } from '../src/world/hotel/dressing.ts';
import { spaceAt } from '../src/world/spaces.ts';
import { placedEntry } from '../src/world/parkLayout.ts';
import { saveFlags } from '../src/state/flags.ts';

/** Deep enough that no floor in the game is near it, shallow enough to catch a fall early. */
const FLOOR_OF_THE_WORLD = -2;

/** How long the crowd is run before anybody is asked where they are. */
const SETTLE_SECONDS = 8;

const problems: string[] = [];
const { world } = quietly(() => buildHeadlessPark());
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
  // Reception moved to the east bay when the gallery took the north strip —
  // its old spot at (5, −7.2) is now inside the gallery's own solid mass,
  // where this probe would have passed for entirely the wrong reason.
  ['the reception desk', LOBBY.originX + 10, LOBBY.originZ - 9.5],
  ['a lobby sofa', LOBBY.originX + 5.8, LOBBY.originZ + 2.4],
  ['a lobby crystal column', LOBBY.originX - 11.9, LOBBY.originZ - 6.6],
  ['a Floor 12 hedge', GARDEN_FLOOR.originX - 6.4, GARDEN_FLOOR.originZ - 6.4],
  ['a Floor 12 bench', GARDEN_FLOOR.originX + 2.2, GARDEN_FLOOR.originZ + 5.2],
  ['a Floor 33 seaweed clump', OCEAN_FLOOR.originX - 8.4, OCEAN_FLOOR.originZ - 6.4],
  ['a Floor 33 bench', OCEAN_FLOOR.originX + 0, OCEAN_FLOOR.originZ + 5.4],
  ['a breakfast table', BREAKFAST.originX - 7.6, BREAKFAST.originZ + 5.4],
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
const chairX = BREAKFAST.originX - 7.6 + Math.sin(chairYaw) * 1.45;
const chairZ = BREAKFAST.originZ + 5.4 + Math.cos(chairYaw) * 1.45;
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
  ['a lobby sofa', LOBBY.originX + 5.8, LOBBY.originZ + 2.4, SOFA_SEAT_TOP],
  ['the buffet counter', BREAKFAST.originX + 1.5, BREAKFAST.originZ - 7.4, BUFFET_TOP],
  ['a breakfast table', BREAKFAST.originX - 7.6, BREAKFAST.originZ + 5.4, 0.74],
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
