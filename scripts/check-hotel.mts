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
 *
 * Proven red before it was trusted green: restoring the old settle height
 * fails (1) with all seven residents at −16.5 m; making a chair soft fails
 * (2); making a bed solid fails (3); widening a declared window past its
 * doorway fails (4).
 */

import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
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
import { spaceAt } from '../src/world/spaces.ts';

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
