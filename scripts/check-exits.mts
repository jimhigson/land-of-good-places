/**
 * **Every way the game puts her down passes the one rule — and every exit leaves
 * her somewhere she can walk out of.**
 *
 * ```
 * pnpm run check:exits
 * ```
 *
 * Jim, 17 October 2026: *"at leaving breakfast on the ground floor of the hotel,
 * it is possible to get soft-locked so that the player is stuck between the
 * breakfast table and the wall"*, and of the fix: *"when we choose a point to
 * put the player down, we need to check the reachability of the location, not
 * make it breakfast-specific."* Reproduced in a real browser on `main`
 * (58165723): sit at the lobby café's chair `lobby-a-1`, eat, press "Leave
 * breakfast" — `Hotel.standUp` ended the ride on the seat, the resolver escorted
 * her out of chair and table into the strip between the tables and the west
 * wall, and neither the arrow keys nor a tap could get her out of it.
 *
 * The fix is one rule, `world/dismount.ts`'s `putDownSpot`, run by `Player`
 * inside the only three methods that ever place her (`endRide`, `teleportTo`,
 * `teleport`). This check holds all of that to account, on the real built park:
 *
 * 1. **The rule's own clauses**, on small worlds built here: an open spot is
 *    left exactly where it is (the control); a spot in a sealed pocket is moved
 *    to one that reaches open floor; a spot inside a collider is moved out; a
 *    pocket holding a point of the space's open area is left alone; and the
 *    cost of one put-down is bounded.
 * 2. **The instrument, and its controls.** "She can walk out" is the router's
 *    own whole-space flood (`NavGrid.floodFrom` — what a tap can reach) from
 *    where she stands to the space's way out (`World.openAreaAt`'s first point:
 *    the arrival a door or lift lands her on). Controls first: from the way out
 *    itself it must say "out", and from inside four walls registered round a
 *    spot of open floor it must say "trapped" — or nothing below means anything.
 * 3. **Every placement, enumerated from the source.** Every call that places
 *    her (`.endRide(`, `.teleportTo(`, `.teleport(`) and every ride that takes
 *    her (`.beginRide(`) outside `Player.ts`, listed by file and line; and no
 *    other code in `src/` writes her position — read from the source, so a new
 *    one cannot slip past.
 * 4. **Every exit, entered and left.** In every space — the park, each castle
 *    floor, each hotel room, the Reptile House, the library — every interact
 *    zone's every action is pressed from its own stand spot, and every one that
 *    takes her (`player.riding`) is an exit: left by its own "leave" chip where
 *    it has one, by `Player.letGo` otherwise, then asked: did the put-down rule
 *    place her, and can she walk out? The booths' world rides and the cat bus are
 *    boarded the way the game boards them. Every placement the game makes on
 *    the way — a door, a lift, a space's arrival — is asked the same.
 * 5. **"Next day", from everywhere.** From every space, and from mid-ride, the
 *    ☰ menu's "Next day" must end with her awake in her suite, not riding, on
 *    tomorrow morning's clock, able to walk to the suite's door.
 * 6. **Coverage.** Every call site found in (3) must have been driven by (4) or
 *    (5), or be named in {@link NOT_DRIVEN} with the reason; one that is neither
 *    fails. Coverage notes go to stderr, so a passing run says what it covered.
 *
 * Red on the old breakfast: with the rule bypassed (`putDownSpot` returning the
 * spot it was given) and `standUp` ending on the seat as it did, (4) fails on
 * `lobby-a-1` and `lobby-b-1` — see the PR for the transcript and geometry.
 */
import './headless-canvas.mjs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { JUMP_APEX_HEIGHT, PLAYER_PUT_DOWN, Player } from '../src/entities/Player.ts';
import { IsoCamera } from '../src/core/IsoCamera.ts';
import { CollisionWorld } from '../src/world/Collision.ts';
import { circleBoundary, GARDEN_PLAY_BOUNDARY } from '../src/world/boundary.ts';
import { putDownSpot, SEARCH_REACH, OPEN_FLOOR_REACH } from '../src/world/dismount.ts';
import { NAV_CELL } from '../src/world/navLattice.ts';
import { NavGrid } from '../src/world/NavGrid.ts';
import { DAY_LENGTH_SECONDS, DAY_START_TIME, PLAYER_RADIUS } from '../src/core/constants.ts';
import {
  BREAKFAST,
  CORRIDOR,
  GARDEN_FLOOR,
  HOTEL_FLOORS,
  hotelDoorBands,
  LOBBY,
  MIDDLE_BEDROOM_INDEX,
  OCEAN_FLOOR,
  ROOMS,
  SUITE,
  SUITE_BED_SPOTS,
} from '../src/world/hotel/layout.ts';
import type { PortalBand } from '../src/world/tapSpacing.ts';
import type { LiftPanelSource } from '../src/world/building/liftRide.ts';
import { CASTLE_FLOORS } from '../src/world/building/floors.ts';
import { SPACE_GARDEN, SPACE_LIBRARY, SPACE_REPTILE_HOUSE, spaceAt, type SpaceId } from '../src/world/spaces.ts';
import { TreeClimbing } from '../src/world/TreeClimbing.ts';
import { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../src/world/entrance/layout.ts';
import { gameStore } from '../src/state/index.ts';
import { saveFlags } from '../src/state/flags.ts';
import { PRIMARY_ACTION, type InteractZone } from '../src/world/interact.ts';

const problems: string[] = [];
const notes: string[] = [];
const fail = (line: string): void => {
  problems.push(line);
};
const say = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

// ------------------------------------------------------------------ 1. the rule's clauses

/**
 * The rule asked of small worlds of its own: a 30 m circle of flat floor, a
 * sampler that answers 0 everywhere (and a plate where a clause adds one).
 */
{
  const flat = (): number => 0;
  const world = (): CollisionWorld => {
    const collision = new CollisionWorld();
    collision.setPlayBounds(circleBoundary(30, 0, 0));
    return collision;
  };
  const sealedRing = (collision: CollisionWorld, x: number, z: number, half: number): void => {
    collision.addRectangle(x, z, half, half, 0.2);
  };

  // (a) CONTROL: an open spot is handed back exactly as given.
  {
    const collision = world();
    const exit = { x: 3.3, y: 0, z: -2.1, facing: 1 };
    const spot = putDownSpot(collision, flat, exit, PLAYER_PUT_DOWN);
    if (!spot.found || spot.moved !== 0 || spot.x !== exit.x || spot.z !== exit.z || spot.y !== exit.y) {
      fail(
        `rule (a) control: an open spot on empty floor was not left alone — asked (3.30, 0, -2.10), ` +
          `got (${spot.x.toFixed(3)}, ${spot.y.toFixed(3)}, ${spot.z.toFixed(3)}) moved ${spot.moved.toFixed(3)} found=${spot.found}`,
      );
    }
    notes.push(`rule (a) open spot: left at (3.30, -2.10), moved ${spot.moved}, ${spot.cells} cells`);
  }

  // (b) A sealed pocket — four walls round a 2.4 m square (inside, 1.1 m of
  // free floor for her centre) — moves her out, to floor that reaches far.
  {
    const collision = world();
    sealedRing(collision, 0, 0, 1.6);
    const spot = putDownSpot(collision, flat, { x: 0, y: 0, z: 0 }, PLAYER_PUT_DOWN);
    const outside = Math.max(Math.abs(spot.x), Math.abs(spot.z)) > 1.6 + 0.2 + PLAYER_RADIUS - 1e-6;
    if (!spot.found || !outside) {
      fail(
        `rule (b) sealed pocket: asked (0, 0) inside walls at ±1.6 m, got (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}) ` +
          `found=${spot.found} — still inside the walls`,
      );
    }
    notes.push(`rule (b) sealed pocket: moved ${spot.moved.toFixed(2)} m to (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}), ${spot.cells} cells`);
  }

  // (c) Inside a collider — a 0.6 m round prop on the spot — moves her clear of it.
  {
    const collision = world();
    collision.addCircle(5, 5, 0.6);
    const spot = putDownSpot(collision, flat, { x: 5, y: 0, z: 5 }, PLAYER_PUT_DOWN);
    const overlap = collision.deepestSolidOverlap(new Vector3(spot.x, 0, spot.z), PLAYER_RADIUS, 0);
    if (!spot.found || overlap > 1e-3) {
      fail(`rule (c) inside a collider: asked (5, 5) in a 0.6 m prop, got (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}) overlapping ${overlap.toFixed(3)} m`);
    }
    notes.push(`rule (c) inside a collider: moved ${spot.moved.toFixed(2)} m, overlap after ${overlap.toFixed(3)} m`);
  }

  // (d) The same sealed pocket, holding a point of the space's open area — a
  // room whose design says she stands in it — is left alone.
  {
    const collision = world();
    sealedRing(collision, 0, 0, 1.6);
    const spot = putDownSpot(collision, flat, { x: 0, y: 0, z: 0 }, PLAYER_PUT_DOWN, [{ x: 0.2, z: -0.1 }]);
    if (!spot.found || spot.moved !== 0) {
      fail(`rule (d) open area honoured: a walled spot holding an open-area point was moved ${spot.moved.toFixed(2)} m`);
    }
  }

  // (e) A surface above the floor the exit names is not its floor: a 0.42 m
  // standable plate on a solid 0.3 m prop, exit naming the floor at its centre.
  {
    const collision = world();
    collision.addCircle(-4, 4, 0.3, 0.42, false, true);
    const seat = (x: number, z: number, y: number): number =>
      Math.abs(x + 4) <= 0.225 && Math.abs(z - 4) <= 0.225 && y + 0.62 >= 0.42 ? 0.42 : 0;
    const spot = putDownSpot(collision, seat, { x: -4, y: 0, z: 4 }, PLAYER_PUT_DOWN);
    if (!spot.found || spot.y !== 0 || Math.hypot(spot.x + 4, spot.z - 4) < 0.3 + PLAYER_RADIUS - 1e-6) {
      fail(`rule (e) a seat is not the floor: got (${spot.x.toFixed(2)}, ${spot.y.toFixed(2)}, ${spot.z.toFixed(2)})`);
    }
  }

  // (f) The cost bound: one window of the router's cells, however bad the search.
  {
    const collision = world();
    for (let i = -4; i <= 4; i += 1) collision.addWall(-9, i * 2, 9, i * 2 + 0.6, 0.1); // a maze of near-misses
    const t0 = performance.now();
    const spot = putDownSpot(collision, flat, { x: 0.1, y: 0, z: 0.3 }, PLAYER_PUT_DOWN);
    const ms = performance.now() - t0;
    const windowCells = (2 * Math.ceil((SEARCH_REACH + OPEN_FLOOR_REACH) / NAV_CELL) + 3) ** 2;
    if (spot.cells > windowCells) fail(`rule (f) cost: ${spot.cells} cells classified, over the window's ${windowCells}`);
    notes.push(`rule (f) cost bound: ${spot.cells} of at most ${windowCells} cells, ${ms.toFixed(1)} ms`);
  }
}

// ------------------------------------------------------------------ the park

const { world, scene } = quietly(() => buildHeadlessPark());
const { collision } = world;
const camera = new IsoCamera();
const player = quietly(() => new Player(collision, camera, new Vector3(ENTRANCE_PLAYER_X, 0, ENTRANCE_PLAYER_Z)));
scene.add(player.group);
// Every placement, recorded where it came from — the first frame outside Player.ts.
const PLACEMENTS = ['endRide', 'teleportTo', 'teleport', 'beginRide'] as const;
type Placement = (typeof PLACEMENTS)[number];
const driven = new Map<string, number>();
const placedBy = new Map<string, Placement>();
function callerSite(stack: string | undefined): string | null {
  for (const line of (stack ?? '').split('\n').slice(1)) {
    const match = /\((?:file:\/\/)?([^()]*?\/src\/[^():]+\.ts):(\d+):\d+\)|at (?:file:\/\/)?([^\s()]*?\/src\/[^():]+\.ts):(\d+):\d+/.exec(line);
    if (!match) continue;
    const file = match[1] ?? match[3] ?? '';
    const lineNo = match[2] ?? match[4] ?? '';
    if (file.endsWith('/src/entities/Player.ts')) continue;
    return `${file.slice(file.indexOf('/src/') + 1)}:${lineNo}`;
  }
  return null;
}
/** The slowest single placement (endRide/teleportTo/teleport), and its cost in router cells. */
const slowest = { ms: 0, cells: 0, site: '' };
let putDownCount = 0;
let putDownMsTotal = 0;
for (const name of PLACEMENTS) {
  const original = (player as unknown as Record<string, (...args: unknown[]) => unknown>)[name]!.bind(player);
  (player as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
    const site = callerSite(new Error().stack);
    if (site) {
      driven.set(site, (driven.get(site) ?? 0) + 1);
      placedBy.set(site, name);
    }
    const before = player.putDowns;
    const t0 = performance.now();
    const result = original(...args);
    const ms = performance.now() - t0;
    if (player.putDowns !== before) {
      putDownCount += 1;
      putDownMsTotal += ms;
      if (ms > slowest.ms) Object.assign(slowest, { ms, cells: player.lastPutDown?.cells ?? 0, site: site ?? "this check's own placement" });
    }
    return result;
  };
}

world.attachPlayer(player as never);
// The trees are `Game`'s system, not `World`'s; built here as `Game` builds them.
const hudStub = { setPrompt(): void {} };
const trees = new TreeClimbing(player, world.npcs, hudStub as never, world.scenery.climbableTrees);
// The booths' chips board their rides as `Game` wires them — `World.boardStallRide`.
world.stalls.onEnter = (stallId: string) => {
  world.boardStallRide(stallId);
};
const sample = (x: number, z: number, y: number): number => world.building.surfaces.sample(x, z, y);

let elapsed = 1000;
/** Nobody touching anything — with the input system's setters a ride may call on it. */
const still = {
  moveX: 0,
  moveY: 0,
  moveAmount: 0,
  manualMoveActive: false,
  isDown: () => false,
  justPressed: () => false,
  setMouseCaptureActive: (): void => {},
  setNavigationMove: (): void => {},
  setNavigationSprint: (): void => {},
};
function tick(seconds: number, input = still): void {
  const dt = 1 / 30;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    elapsed += dt;
    const context = { dt, elapsed, frame: Math.round(elapsed * 30), input, playerPosition: player.position, cameraForward: camera.forward };
    player.update(context as never);
    world.update(context as never);
    trees.update(context as never);
  }
}

// ------------------------------------------------------------------ 2. the instrument

/** The router, exactly as `Game` builds it — following the play bounds of the space she is in. */
const router = new NavGrid(
  collision,
  PLAYER_RADIUS,
  JUMP_APEX_HEIGHT,
  () => world.building.surfaces.connectors,
  (x, z) => world.train.bridges.some((bridge) => bridge.covers(x, z)),
);
/** The space's way out: its open area's first point — the arrival a door or lift lands her on. */
function wayOut(x: number, z: number): { x: number; z: number } | null {
  return world.openAreaAt(x, z)[0] ?? null;
}
/** Can a tap walk her from where she stands to the way out of the space she is in? */
function walksOut(): { out: boolean; why: string } {
  const p = player.position;
  const door = wayOut(p.x, p.z);
  if (!door) return { out: false, why: `no way out known for ${spaceAt(p.x, p.z)}` };
  const flood = router.floodFrom(p.x, p.z, p.y, sample);
  if (!flood) return { out: false, why: 'the router has no lattice where she stands' };
  const doorY = sample(door.x, door.z, p.y + 3);
  const out = flood.has(door.x, door.z, doorY) || nearAnyReached(flood, door);
  return { out, why: out ? '' : `the router cannot reach the way out at (${door.x.toFixed(1)}, ${door.z.toFixed(1)})` };
}
/** The way out's own cell may sit inside a stamp; a reached cell within one cell of it counts. */
function nearAnyReached(flood: { forEachCell: (visit: (x: number, z: number) => void) => void }, door: { x: number; z: number }): boolean {
  let near = false;
  flood.forEachCell((x, z) => {
    if (!near && Math.hypot(x - door.x, z - door.z) <= NAV_CELL * 1.5) near = true;
  });
  return near;
}

function releaseEverywhere(): void {
  world.building.releasePlayer();
  world.hotel.releasePlayer();
  world.reptileHouse.releasePlayer();
  world.library.releasePlayer();
}
interface SpaceVisit {
  readonly name: string;
  readonly space: SpaceId;
  enter(): void;
}
/** Every space the game has, and how a child gets into each — its own door or arrival. */
const SPACES: SpaceVisit[] = [
  {
    name: 'the park',
    space: SPACE_GARDEN,
    enter: () => {
      releaseEverywhere();
      collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
      player.teleportTo(ENTRANCE_PLAYER_X, sample(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z, 50), ENTRANCE_PLAYER_Z, Math.PI);
    },
  },
  ...CASTLE_FLOORS.map((floor) => ({
    name: `castle: ${floor.name}`,
    space: floor.space,
    enter: () => {
      releaseEverywhere();
      world.building.enterCastleSpawn(floor.index);
    },
  })),
  ...ROOMS.map((room) => ({
    name: `hotel: ${room.space}`,
    space: room.space,
    enter: () => {
      releaseEverywhere();
      const door = world.hotel.openArea(room)[0] ?? { x: room.originX, z: room.originZ };
      // A restored save's way in: the position, then the hotel adopts it.
      player.teleportTo(door.x, 0, door.z, Math.PI / 2);
      world.hotel.adoptRestoredPlayer();
    },
  })),
  {
    name: 'the Reptile House',
    space: SPACE_REPTILE_HOUSE,
    enter: () => {
      releaseEverywhere();
      world.reptileHouse.requestEnter();
    },
  },
  {
    name: 'the library',
    space: SPACE_LIBRARY,
    enter: () => {
      releaseEverywhere();
      world.library.requestEnter();
    },
  },
];

function settle(): void {
  if (player.riding) player.letGo();
  tick(0.1);
}

// CONTROLS on the instrument, before anything below is read.
{
  const park = SPACES[0]!;
  settle();
  park.enter();
  tick(0.3);
  const atDoor = walksOut();
  if (!atDoor.out) {
    fail(`instrument CONTROL: from the park's own way out it says "trapped" (${atDoor.why}) — it measures nothing`);
  }
  // Four walls round her, on open floor 6 m into the park.
  const cx = ENTRANCE_PLAYER_X;
  const cz = ENTRANCE_PLAYER_Z - 6;
  const walls = [
    collision.addWall(cx - 1.6, cz - 1.6, cx + 1.6, cz - 1.6, 0.2),
    collision.addWall(cx + 1.6, cz - 1.6, cx + 1.6, cz + 1.6, 0.2),
    collision.addWall(cx + 1.6, cz + 1.6, cx - 1.6, cz + 1.6, 0.2),
    collision.addWall(cx - 1.6, cz + 1.6, cx - 1.6, cz - 1.6, 0.2),
  ];
  // Put there raw — the rule would (rightly) refuse the pocket.
  player.position.set(cx, sample(cx, cz, 50), cz);
  const inPocket = walksOut();
  if (inPocket.out) fail('instrument CONTROL: from inside four walls it says "out" — it cannot say "trapped", so it proves nothing');
  for (const wall of walls) collision.removeWall(wall);
  notes.push(`instrument controls: way out → out=${atDoor.out}; walled pocket → out=${inPocket.out}`);
}

// ------------------------------------------------------------------ 3. the source

const SRC = new URL('../src/', import.meta.url).pathname;
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}
/** A source line with its comment cut off; `''` for a comment line. */
function codeOf(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//')) return '';
  const cut = line.indexOf('//');
  return cut >= 0 ? line.slice(0, cut) : line;
}
const sites = new Map<string, Placement>();
/**
 * Each site's name in `NOT_DRIVEN` (6): its file and its own code — never its
 * line number, which moves with every edit above it in a 6,000-line file. A
 * line that occurs more than once in its file is told apart by its order, `#2`.
 */
const siteKeys = new Map<string, string>();
const writes: string[] = [];
for (const file of sourceFiles(SRC)) {
  const name = relative(new URL('../', import.meta.url).pathname, file);
  if (name === 'src/entities/Player.ts') continue;
  const seen = new Map<string, number>();
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const code = codeOf(line);
      for (const placement of PLACEMENTS) {
        if (!new RegExp(`\\.${placement}\\(`).test(code)) continue;
        const site = `${name}:${index + 1}`;
        const text = code.trim();
        const nth = (seen.get(text) ?? 0) + 1;
        seen.set(text, nth);
        sites.set(site, placement);
        siteKeys.set(site, `${name}: ${text}${nth > 1 ? ` #${nth}` : ''}`);
      }
      // Anything else that writes her position — a receiver named for her.
      if (/\b(?:player|this\.player|napper|walker)\??\.(?:position|previousPosition)\.(?:set|copy|add|sub|setX|setY|setZ|addScaledVector|lerp|applyMatrix4)\(|\b(?:player|this\.player)\??\.position\.[xyz]\s*(?:[-+*/]?=)(?!=)/.test(code)) {
        writes.push(`${name}:${index + 1}: ${line.trim()}`);
      }
    });
}
if (writes.length > 0) {
  fail(`${writes.length} line(s) in src/ write her position without the put-down rule:\n      ${writes.join('\n      ')}`);
}

interface ExitRecord {
  readonly what: string;
  readonly holding: string;
  readonly left: string;
  readonly space: SpaceId;
  readonly moved: number;
  readonly cells: number;
  readonly ms: number;
}
const exits: ExitRecord[] = [];
const arrivals: string[] = [];

// ------------------------------------------------------------------ 5. Next day (the helper; run first keyless, the rest after 4)

const suiteBed = SUITE_BED_SPOTS[MIDDLE_BEDROOM_INDEX];
const nextDays: string[] = [];
function nextDayFrom(label: string, setUp: () => void): void {
  settle();
  setUp();
  const dayBefore = gameStore.get().world.dayCount;
  const wasRiding = player.riding;
  // As `Game.nextDay` does it: let go of whatever has her, then the world's own.
  player.letGo();
  if (!world.nextDay()) {
    fail(`Next day from ${label}: refused (riding=${player.riding})`);
    return;
  }
  let laidInBed = false;
  for (let t = 0; t < 6 && (player.riding || !laidInBed); t += 0.1) {
    tick(0.1);
    if (player.sleeping && suiteBed) {
      const bx = SUITE.originX + suiteBed[0];
      const bz = SUITE.originZ + suiteBed[1];
      if (Math.hypot(player.position.x - bx, player.position.z - bz) < 1.2) laidInBed = true;
    }
  }
  const { dayCount, timeOfDay } = gameStore.get().world;
  const space = spaceAt(player.position.x, player.position.z);
  const expectedTime = DAY_START_TIME + 6 / DAY_LENGTH_SECONDS;
  const clauses: string[] = [];
  if (player.riding) clauses.push(`still riding (${player.rideHolder?.holding ?? '?'})`);
  if (space !== SUITE.space) clauses.push(`woke in ${space}, not ${SUITE.space}`);
  if (dayCount !== dayBefore + 1) clauses.push(`day ${dayBefore} → ${dayCount}, not ${dayBefore + 1}`);
  if (timeOfDay < DAY_START_TIME || timeOfDay > expectedTime + 0.01) {
    clauses.push(`the clock reads ${timeOfDay.toFixed(3)}, not the morning (${DAY_START_TIME} plus the seconds since)`);
  }
  if (!laidInBed) clauses.push('she was never lying in the middle bedroom’s bed');
  if (!saveFlags.hasHotelKey()) clauses.push('no key: the suite would lock her in');
  const out = walksOut();
  if (!out.out) clauses.push(`cannot walk to the suite's door — ${out.why}`);
  if (clauses.length > 0) fail(`Next day from ${label}${wasRiding ? ' (mid-ride)' : ''}: ${clauses.join('; ')}`);
  nextDays.push(`${label}${wasRiding ? ' (mid-ride)' : ''}: ${clauses.length === 0 ? 'awake in the suite, day ' + dayCount : 'FAILED'}`);
}
// ------------------------------------------------------------------ 4a. doors, both ways

/** The stick held along world (dx, dz), through the camera's ground basis, as a thumb holds it. */
function stickAlong(dx: number, dz: number): typeof still {
  const len = Math.hypot(dx, dz) || 1;
  return {
    ...still,
    moveX: (dx / len) * camera.right.x + (dz / len) * camera.right.z,
    moveY: (dx / len) * camera.forward.x + (dz / len) * camera.forward.z,
    moveAmount: 1,
    manualMoveActive: true,
  };
}
const jumpOnce = { ...still, justPressed: (key: string) => key === 'jump' };

/** Every doorway band the game publishes — the ones `check:tap-spacing` holds taps clear of. */
function everyBand(): PortalBand[] {
  return [
    world.hotel.towerDoorBand(),
    ...world.building.doorBands(),
    ...world.reptileHouse.doorBands(),
    ...world.library.doorBands(),
    ...ROOMS.flatMap((room) => hotelDoorBands(room).filter((band) => band.kind !== 'lift')),
  ];
}

/**
 * Walk across one band, from 1.6 m short of it on each side that lies in this
 * space, holding the stick through it — the way every door is used. Whatever
 * the door does with her (a change of space, a refusal), every put-down it
 * makes is asked whether she can walk out.
 */
function walkAcross(visit: SpaceVisit, band: PortalBand): void {
  const dirX = Math.sin(band.yaw);
  const dirZ = Math.cos(band.yaw);
  for (const sign of [1, -1]) {
    const startX = band.centreX - sign * dirX * (band.halfAlong + 1.6);
    const startZ = band.centreZ - sign * dirZ * (band.halfAlong + 1.6);
    if (spaceAt(startX, startZ) !== visit.space) continue;
    settle();
    visit.enter();
    // Past the arrival's cooldown (`SpaceManager.settling`, 0.9 s): no doorway
    // fires in it, which is the point of it, and a walk through one inside it
    // walks off the end of the room's floor instead.
    tick(1.2);
    player.teleportTo(startX, sample(startX, startZ, player.position.y + 1), startZ);
    tick(0.1);
    const from = spaceAt(player.position.x, player.position.z);
    const before = player.putDowns;
    for (let t = 0; t < 3 && spaceAt(player.position.x, player.position.z) === from; t += 0.1) {
      tick(0.1, stickAlong(sign * dirX, sign * dirZ));
    }
    tick(0.3);
    if (player.putDowns === before) continue; // walked on past it: nothing placed her
    const to = spaceAt(player.position.x, player.position.z);
    const out = walksOut();
    arrivals.push(`${band.what}, walked ${sign > 0 ? 'along' : 'against'} it from ${from}: now in ${to}, out=${out.out}`);
    if (!out.out) fail(`${band.what}: walked through from ${from}, put down in ${to} unable to walk out — ${out.why}`);
  }
}

// **Keyless, first** — the key is only ever given, never taken back. The
// suite's own door refuses her, by a step back (`Hotel.refuseSuite`), a
// put-down like any other; and then "Next day" must give her the key, or her
// own suite's lock would hold her in it.
if (saveFlags.hasHotelKey()) fail('the key was already given before the keyless suite door and Next day could be tried');
{
  const corridor = SPACES.find((visit) => visit.space === CORRIDOR.space)!;
  for (const band of hotelDoorBands(CORRIDOR).filter((candidate) => candidate.kind === 'suite-door')) walkAcross(corridor, band);
}
nextDayFrom('the park, never checked in', () => SPACES[0]!.enter());

for (const visit of SPACES) {
  for (const band of everyBand()) walkAcross(visit, band);
}

// ------------------------------------------------------------------ 4. every exit


/**
 * She has just been given back (or placed): was it the rule, and can she walk
 * out? `putDowns` must have moved on since `before`, and she must stand where
 * the last put-down left her, before anything else has moved her.
 */
function judge(what: string, before: number, holding: string, left: string, ms: number): void {
  const spot = player.lastPutDown;
  const p = player.position;
  const space = spaceAt(p.x, p.z);
  if (player.putDowns === before || !spot) {
    fail(`${what}: she was let go without the put-down rule (no put-down since the ride began)`);
    return;
  }
  if (!spot.found) fail(`${what}: the rule found no clear, open spot within ${SEARCH_REACH} m of (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)})`);
  // A fling lands where gravity takes her; anything else stands where she was put.
  if (Math.hypot(p.x - spot.x, p.z - spot.z) > 1e-6 && !player.isAirborne) {
    fail(`${what}: she stands at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}), not where the rule put her (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)})`);
  }
  tick(1); // let a fling land
  const out = walksOut();
  if (!out.out) {
    fail(
      `${what}: left by ${left} in ${space} at (${player.position.x.toFixed(2)}, ${player.position.y.toFixed(2)}, ${player.position.z.toFixed(2)}) — ` +
        `${out.why}; the rule ${spot.moved > 0 ? `moved her ${spot.moved.toFixed(2)} m` : 'left the exit as given'}`,
    );
  }
  exits.push({ what, holding, left, space, moved: spot.moved, cells: spot.cells, ms });
}

/** Leave whatever has her: its own way-off chip if a zone offers one while riding, else `letGo`. */
function leave(zoneId: string, enteredBy: string): string {
  const holding = player.rideHolder?.holding ?? '?';
  const zones = [...world.interactZones(), ...trees.interactZones()].filter((zone) => zone.selectableWhileRiding);
  const own = zones.find((zone) => zone.id === zoneId);
  for (const zone of own ? [own] : []) {
    for (const action of zone.actions?.() ?? []) {
      if (action.id === enteredBy || action.id.startsWith('eat-')) continue;
      action.run();
      if (!player.riding) return `its own "${action.label}" chip`;
      tick(0.4);
      if (!player.riding) return `its own "${action.label}" chip`;
    }
  }
  if (player.riding) player.letGo();
  return player.riding ? `nothing — ${holding} would not let her go` : 'Player.letGo';
}

function zonesIn(space: SpaceId): InteractZone[] {
  return [...world.interactZones(), ...trees.interactZones()].filter((zone) => spaceAt(zone.standX, zone.standZ) === space);
}

for (const visit of SPACES) {
  settle();
  visit.enter();
  tick(0.3);
  const before = player.putDowns;
  void before;
  const arrived = walksOut();
  arrivals.push(`${visit.name}: arrived at (${player.position.x.toFixed(1)}, ${player.position.z.toFixed(1)}) out=${arrived.out}`);
  if (spaceAt(player.position.x, player.position.z) !== visit.space) {
    fail(`${visit.name}: entering it left her in ${spaceAt(player.position.x, player.position.z)}`);
    continue;
  }
  if (!arrived.out) fail(`${visit.name}: its own arrival cannot walk out — ${arrived.why}`);

  const ids = zonesIn(visit.space).map((zone) => zone.id);
  for (const id of ids) {
    // Fresh each time: zones are rebuilt every frame, and a press changes them.
    let actionIds = (zonesIn(visit.space).find((zone) => zone.id === id)?.actions?.() ?? []).map((action) => action.id);
    for (const actionId of actionIds) {
      settle();
      if (spaceAt(player.position.x, player.position.z) !== visit.space) {
        visit.enter();
        tick(0.2);
      }
      const zone = zonesIn(visit.space).find((candidate) => candidate.id === id);
      if (!zone) continue;
      player.teleportTo(zone.standX, sample(zone.standX, zone.standZ, player.position.y + 1), zone.standZ);
      tick(0.15);
      const action = zone.actions?.().find((candidate) => candidate.id === actionId);
      if (!action) continue;
      const startedAt = player.putDowns;
      try {
        action.run();
        for (let t = 0; t < 2.5 && !player.riding; t += 0.1) tick(0.1);
      } catch (error) {
        notes.push(`${id} "${action.label}": threw ${String(error).split('\n')[0]}`);
        continue;
      }
      if (!player.riding) {
        if (spaceAt(player.position.x, player.position.z) !== visit.space) {
          const out = walksOut();
          arrivals.push(`${id} "${action.label}" took her to ${spaceAt(player.position.x, player.position.z)}: out=${out.out}`);
          if (!out.out) fail(`${id} "${action.label}": its arrival in ${spaceAt(player.position.x, player.position.z)} cannot walk out — ${out.why}`);
        }
        continue;
      }
      const holding = player.rideHolder?.holding ?? '?';
      const t0 = performance.now();
      const left = leave(id, actionId);
      const ms = performance.now() - t0;
      if (player.riding) {
        fail(`${id} "${action.label}": ${holding} could not be left — ${left}`);
        continue;
      }
      judge(`${visit.name} — ${id} "${action.label}" (${holding})`, startedAt, holding, left, ms);
    }
    actionIds = [];
  }
}

// The booths' world rides, boarded as the booths board them, and left.
for (const stallId of ['railRacer', 'skyCruiser', 'spaceFerrisWheel']) {
  settle();
  SPACES[0]!.enter();
  tick(0.2);
  const startedAt = player.putDowns;
  const boarded = world.boardStallRide(stallId);
  tick(0.5);
  if (!boarded || !player.riding) {
    notes.push(`booth ride ${stallId}: would not board now (${boarded})`);
    continue;
  }
  const holding = player.rideHolder?.holding ?? '?';
  player.letGo();
  tick(0.1);
  judge(`booth ride ${stallId} (${holding})`, startedAt, holding, 'Player.letGo', 0);
}
// The ginormous slide, from the roof, ridden to its landing in the balls.
{
  settle();
  const startedAt = player.putDowns;
  if (world.building.requestBoardSlide(false)) {
    for (let t = 0; t < 40 && !player.riding; t += 0.2) tick(0.2);
    for (let t = 0; t < 60 && player.riding; t += 0.2) tick(0.2);
    if (player.riding) player.letGo();
    judge('the ginormous slide (ridden to the bottom)', startedAt, 'a slide', 'its own landing', 0);
  } else {
    notes.push('the ginormous slide: would not board from here');
  }
}

// ------------------------------------------------------------------ 4b. lifts, the train, ride ends, backstops

/** Call a lift where she stands, ride it in, then off — by the floor button, or let go. */
function rideLift(label: string, visit: SpaceVisit, panel: LiftPanelSource, doors: { x: number; z: number }, how: 'button' | 'letGo'): void {
  settle();
  visit.enter();
  tick(0.2);
  player.teleportTo(doors.x, sample(doors.x, doors.z, player.position.y + 1), doors.z);
  tick(0.3);
  panel.call();
  for (let t = 0; t < 5 && !player.riding; t += 0.1) tick(0.1);
  if (!player.riding) {
    notes.push(`${label}: the lift would not take her (${JSON.stringify(panel.panelState())})`);
    return;
  }
  const holding = player.rideHolder?.holding ?? '?';
  const startedAt = player.putDowns;
  if (how === 'button') {
    tick(0.6);
    const here = panel.floors().find((floor) => floor.here);
    const other = panel.floors().find((floor) => !floor.here && floor.reachable);
    if (!other) {
      notes.push(`${label}: no other floor to press (here ${here?.name})`);
      player.letGo();
    } else {
      panel.go(other.index);
      for (let t = 0; t < 10 && player.riding; t += 0.1) tick(0.1);
    }
  } else {
    player.letGo();
  }
  if (player.riding) {
    fail(`${label}: the lift never let her off`);
    return;
  }
  judge(label, startedAt, holding, how === 'button' ? 'a floor button' : 'Player.letGo', 0);
}
for (const floor of HOTEL_FLOORS) {
  const visit = SPACES.find((candidate) => candidate.space === floor.room.space);
  const lift = hotelDoorBands(floor.room).find((band) => band.kind === 'lift');
  if (!visit || !lift) continue;
  rideLift(`the hotel lift from ${floor.name}`, visit, world.hotel.liftPanel, { x: lift.centreX, z: lift.centreZ }, 'button');
}
{
  const lobbyLift = hotelDoorBands(LOBBY).find((band) => band.kind === 'lift');
  const lobby = SPACES.find((candidate) => candidate.space === LOBBY.space)!;
  if (lobbyLift) rideLift('the hotel lift, let go', lobby, world.hotel.liftPanel, { x: lobbyLift.centreX, z: lobbyLift.centreZ }, 'letGo');
}
for (const floor of CASTLE_FLOORS) {
  const visit = SPACES.find((candidate) => candidate.space === floor.space)!;
  rideLift(`the castle lift from ${floor.name}`, visit, world.building.liftPanel, world.building.openArea(floor)[0]!, 'button');
}

// The train: wait at the park for it to stand at a platform, get on, get off.
{
  settle();
  SPACES[0]!.enter();
  tick(0.2);
  let boarded = false;
  for (let t = 0; t < 180 && !boarded; t += 0.5) {
    const station = world.train
      .interactZones()
      .find((zone) => zone.actions?.().some((action) => action.label === 'Get on'));
    if (station) {
      player.teleportTo(station.standX, sample(station.standX, station.standZ, player.position.y + 2), station.standZ);
      tick(0.05);
      station.actions?.().find((action) => action.label === 'Get on')?.run();
      boarded = player.riding;
    }
    if (!boarded) tick(0.5);
  }
  if (!boarded) {
    notes.push('the train: never stood at a platform she could board in 180 s');
  } else {
    const startedAt = player.putDowns;
    tick(2); // under way
    player.letGo();
    judge('the train (let go between platforms)', startedAt, 'the train', 'Player.letGo', 0);
  }
}

// A tree climbed and come down the way a child comes down: a hop.
{
  settle();
  SPACES[0]!.enter();
  tick(0.2);
  const tree = trees.interactZones()[0];
  if (tree) {
    player.teleportTo(tree.standX, sample(tree.standX, tree.standZ, 50), tree.standZ);
    tick(0.1);
    tree.actions?.()[0]?.run();
    tick(4);
    const startedAt = player.putDowns;
    tick(0.05, jumpOnce);
    for (let t = 0; t < 6 && player.riding; t += 0.1) tick(0.1);
    if (player.riding) fail('a tree: hopping down never brought her down');
    else judge('a tree, come down by a hop', startedAt, 'a tree', 'its own scramble down', 0);
  }
}

// The tortoise ridden all the way round, to its own stop.
{
  settle();
  const hall = SPACES.find((candidate) => candidate.space === SPACE_REPTILE_HOUSE)!;
  hall.enter();
  tick(0.3);
  // It may still be finishing the lap it walked without her (section 4 let her
  // off it): it takes nobody until it has parked again.
  for (let t = 0; t < 180 && !player.riding; t += 1) {
    world.reptileHouse.requestTortoiseRide();
    tick(1);
  }
  if (player.riding) {
    const startedAt = player.putDowns;
    for (let t = 0; t < 180 && player.riding; t += 0.5) tick(0.5);
    if (player.riding) fail('the tortoise: never brought her back to its stop in 180 s');
    else judge('the tortoise, ridden round to its stop', startedAt, 'the tortoise', 'its own stop', 0);
  } else {
    notes.push('the tortoise: would not take her');
  }
}

// The backstops: fallen through a floor, she is stood back in the room.
for (const name of ['hotel: hotel.lobby', 'the Reptile House']) {
  const visit = SPACES.find((candidate) => candidate.name === name)!;
  settle();
  visit.enter();
  tick(0.2);
  const startedAt = player.putDowns;
  // A slipped trigger, as the backstop's own comment puts it: below the
  // room's floor and falling, with nothing under her but the park's terrain.
  player.position.y = -3;
  player.launch(-4);
  tick(0.5);
  if (player.putDowns === startedAt) fail(`${name}: the void backstop did not stand her back up`);
  else judge(`${name}: the void backstop`, startedAt, 'nothing', 'the backstop', 0);
}

// The space links the game offers from the park: the hotel's front door and
// each floor's bathroom, the Reptile House's and the library's doormats.
for (const [label, go] of [
  ['the /hotel link', () => world.hotel.requestEnterLobby()],
  ['the /hotel-bathroom link', () => world.hotel.requestEnterBathroom(BREAKFAST)],
  ['the /hotel-bathroom-lobby link', () => world.hotel.requestEnterBathroom(LOBBY)],
  ['the /hotel-bathroom-garden link', () => world.hotel.requestEnterBathroom(GARDEN_FLOOR)],
  ['the /hotel-bathroom-ocean link', () => world.hotel.requestEnterBathroom(OCEAN_FLOOR)],
  ['the /hotel-suite link', () => world.hotel.requestEnterSuite()],
  ['the /reptile-house-door link', () => world.reptileHouse.requestEnterDoor()],
  ['the /library-door link', () => world.library.requestEnterDoor()],
] as const) {
  settle();
  SPACES[0]!.enter();
  tick(0.2);
  const startedAt = player.putDowns;
  if (!go()) {
    notes.push(`${label}: refused from the park`);
    continue;
  }
  tick(0.3);
  if (player.putDowns === startedAt) {
    fail(`${label}: placed her without a put-down`);
    continue;
  }
  const out = walksOut();
  arrivals.push(`${label}: now in ${spaceAt(player.position.x, player.position.z)}, out=${out.out}`);
  if (!out.out) fail(`${label}: put her where she cannot walk out — ${out.why}`);
}

// The /hotel-cafe link: sat at the lobby café's middle chair — the one "Leave
// breakfast" used to strand her behind — and that chip, from there, gets her out.
{
  settle();
  SPACES[0]!.enter();
  tick(0.2);
  const startedAt = player.putDowns;
  const seatZone = 'hotel-chair-lobby-a-1';
  if (!world.hotel.requestEnterCafe()) fail('the /hotel-cafe link: refused from the park');
  else {
    tick(0.3);
    const seated = zonesIn('hotel.lobby')
      .find((zone) => zone.id === seatZone)
      ?.actions?.()
      .some((action) => action.label === 'Leave breakfast');
    if (!player.riding || !seated) {
      fail(`the /hotel-cafe link: not sat at ${seatZone} (riding=${player.riding}, holder ${player.rideHolder?.holding ?? 'none'})`);
    } else {
      const left = leave(seatZone, PRIMARY_ACTION);
      judge(`the /hotel-cafe link — ${seatZone} "Leave breakfast"`, startedAt, 'a breakfast chair', left, 0);
      arrivals.push(`the /hotel-cafe link: sat at ${seatZone}, left by ${left}`);
    }
  }
}

for (const visit of SPACES) nextDayFrom(visit.name, () => visit.enter());
// Mid-ride: at breakfast, up a tree, on the train's platform ride, in the castle lift.
nextDayFrom('a breakfast chair', () => {
  const lobby = SPACES.find((visit) => visit.name === 'hotel: hotel.lobby')!;
  lobby.enter();
  tick(0.2);
  const chair = zonesIn(lobby.space).find((zone) => zone.id === 'hotel-chair-lobby-a-1')!;
  player.teleportTo(chair.standX, 0, chair.standZ);
  chair.actions?.()[0]?.run();
  tick(0.3);
});
nextDayFrom('up a tree', () => {
  SPACES[0]!.enter();
  tick(0.2);
  const tree = trees.interactZones()[0];
  if (!tree) return;
  player.teleportTo(tree.standX, sample(tree.standX, tree.standZ, 50), tree.standZ);
  tick(0.1);
  tree.actions?.()[0]?.run();
  tick(1);
});
nextDayFrom('the Rail Race', () => {
  SPACES[0]!.enter();
  tick(0.2);
  world.boardStallRide('railRacer');
  tick(0.5);
});

// ------------------------------------------------------------------ 6. coverage

/**
 * Call sites (3) this check cannot drive (4/5) — each with the reason, so none
 * passes silently. Named by file and code (see `siteKeys`), so an edit
 * elsewhere in the file leaves them standing; a changed line must be named again.
 */
const NOT_DRIVEN: Readonly<Record<string, string>> = {
  'src/world/TreeClimbing.ts: else if (this.player.riding) this.player.endRide(this.startSpot());':
    'the tree holder let go with no tree in hand — defensive: a climb always has its tree; the same endRide as the driven letGo beside it',
  'src/world/TreeClimbing.ts: if (this.player.riding) this.player.endRide(this.startSpot());':
    'the climb bailing out because its tree vanished mid-climb — defensive, unreachable in a built park; endRide through the rule like every other',
  'src/world/building/Building.ts: player.endRide({ #2':
    "the helter-skelter's own landing — no trigger in this build starts a non-giant slide (`startRide` is only called for the ginormous slide)",
  'src/world/hotel/Hotel.ts: player.teleportTo(BREAKFAST.originX, 0, BREAKFAST.originZ, 0);':
    '/hotel-breakfast with every Floor 1 chair taken — guests take 3 of its 14 chairs, so the link always seats her (driven via the chairs)',
  'src/world/hotel/Hotel.ts: player.endRide(stood);':
    "a window view let go before its iris reached the middle — headless, the iris's middle runs at once, so the shot is always up by then",
  'src/world/reptileHouse/ReptileHouse.ts: player.teleportTo(mat.x, REPTILE_HOUSE_FLOOR_Y, mat.z, facing);':
    "the Reptile House's doormat on its own forecourt — only when the park has no plot for the building; this park has one (the plot's doormat is driven)",
  'src/Game.ts: this.player.teleportTo(spawn.x, spawn.y, spawn.z, options.startPlace.facing);':
    'restoring a save into a space: Game is not constructible headless — the same Player.teleportTo, and (4) drives the hotel restore it pairs with',
  'src/Game.ts: this.player.teleportTo(spawn.x, this.player.position.y, spawn.z, DEFAULT_SPAWN_FACING);':
    'restoring a save in the park: Game is not constructible headless — the same Player.teleportTo',
  'src/Game.ts: if (y === undefined) this.player.teleport(x, z, yaw);': '/spawn?pos=x,z: Game.enterDebugSpawn — the same Player.teleport',
  'src/Game.ts: else this.player.teleportTo(x, y, z, yaw);': '/spawn?pos=x,y,z: Game.enterDebugSpawn — the same Player.teleportTo',
};
const undriven: string[] = [];
const covered: string[] = [];
for (const [site, placement] of [...sites].sort()) {
  const key = siteKeys.get(site)!;
  // Runtime frames carry the line the call starts on, which is the line matched.
  if (driven.has(site)) {
    covered.push(`${site} (${placement}) ×${driven.get(site)}`);
  } else if (NOT_DRIVEN[key]) {
    undriven.push(`${site} (${placement}): ${NOT_DRIVEN[key]}`);
  } else {
    undriven.push(`${site} (${placement}): NOT DRIVEN and no reason given`);
    fail(`${site} (${placement}) places her and this check never drove it — drive it in (4)/(5), or name it in NOT_DRIVEN as '${key}' with why`);
  }
}
const keys = new Set(siteKeys.values());
for (const key of Object.keys(NOT_DRIVEN)) {
  if (!keys.has(key)) fail(`NOT_DRIVEN names '${key}', which is no longer a placement — remove it, or name the line as it now reads`);
}

// ------------------------------------------------------------------ report

const moved = exits.filter((exit) => exit.moved > 0);
say(`check:exits — the rule's own clauses:\n  ${notes.filter((note) => note.startsWith('rule')).join('\n  ')}`);
say(`check:exits — ${notes.find((note) => note.startsWith('instrument')) ?? 'instrument controls: NOT RUN'}`);
say(
  `check:exits — ${sites.size} placement call sites in src/ outside Player.ts (endRide/teleportTo/teleport/beginRide), ` +
    `${covered.length} driven here, ${undriven.length} not:\n  ` +
    [...covered.map((line) => `driven   ${line}`), ...undriven.map((line) => `NOT      ${line}`)].join('\n  '),
);
say(
  `check:exits — ${exits.length} exits entered and left in ${SPACES.length} spaces; ${moved.length} of them the rule moved ` +
    `(worst ${Math.max(0, ...moved.map((exit) => exit.moved)).toFixed(2)} m). ${putDownCount} put-downs, ` +
    `${(putDownMsTotal / Math.max(1, putDownCount)).toFixed(1)} ms on average; the slowest ${slowest.ms.toFixed(1)} ms ` +
    `(${slowest.cells} router cells) at ${slowest.site}:\n  ` +
    exits.map((exit) => `${exit.what} → ${exit.left}${exit.moved > 0 ? `, moved ${exit.moved.toFixed(2)} m` : ''}`).join('\n  '),
);
say(`check:exits — arrivals:\n  ${arrivals.join('\n  ')}`);
say(`check:exits — Next day:\n  ${nextDays.join('\n  ')}`);
for (const note of notes.filter((note) => !note.startsWith('rule') && !note.startsWith('instrument'))) say(`  note: ${note}`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(`check:exits FAILED — ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('check:exits OK');
