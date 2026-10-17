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
 *    **And the rule agrees with it**: across a sample of every space — every
 *    cell of every railway bridge, every stair point, a stride of every room's
 *    top surfaces — every spot the router could stand on and walk out of is one
 *    the rule leaves exactly where it is (its clause 4 *is* the router's flood,
 *    over a window of the router's own lattice).
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
 * 5. **"Next day", from everywhere.** From every space, never checked in,
 *    mid-ride and mid-flight, the ☰ menu's "Next day" must end with her laid in
 *    the middle bedroom's bed with her pets asleep in theirs — a real parade,
 *    built and wired as `Game` builds it — and then awake in her suite, not
 *    riding, not flying, on tomorrow morning's clock, able to walk to the
 *    suite's door, her pets up and at her heels. For the child who never
 *    checked in, the key it gives her must do its one job: she walks out to
 *    the corridor and back into her suite. The `/hotel-cafe` link is driven
 *    too: sat at `lobby-a-1`, then left by its own "Leave breakfast".
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
import { BARE_SPACE, PUT_DOWN_WINDOW_CELLS, putDownSpot, SEARCH_REACH } from '../src/world/dismount.ts';
import { NAV_CELL, NavGrid } from '../src/world/NavGrid.ts';
import { terrainHeight } from '../src/world/terrain.ts';
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
import { Parade } from '../src/entities/parade/Parade.ts';
import { shopItem } from '../src/world/building/shops/catalogue.ts';

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
    const spot = putDownSpot(collision, flat, { x: 0, y: 0, z: 0 }, PLAYER_PUT_DOWN, {
      ...BARE_SPACE,
      openArea: () => [{ x: 0.2, z: -0.1 }],
    });
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

  // (g) A sealed box she fits inside but the router's lattice has no free cell
  // in: four walls round her with 1.32-1.60 m of floor between them, centred on
  // a corner of the router's cells, so every cell centre inside is stamped. The
  // router plans a tap from the nearest free cell *outside* — and a rule that
  // flooded from there would call the box open and leave her in it (the review
  // of 503bd56f found exactly that). She must be moved out.
  for (const innerHalf of [0.66, 0.72, 0.8]) {
    const collision = world();
    const wall = 0.1;
    collision.addRectangle(0, 0, innerHalf + wall, innerHalf + wall, wall);
    const spot = putDownSpot(collision, flat, { x: 0, y: 0, z: 0 }, PLAYER_PUT_DOWN);
    const outside = Math.max(Math.abs(spot.x), Math.abs(spot.z)) >= innerHalf + 2 * wall + PLAYER_RADIUS - 1e-6;
    if (!spot.found || !outside) {
      fail(
        `rule (g) sealed box ${(innerHalf * 2).toFixed(2)} m inside: asked (0, 0), got (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}) ` +
          `moved ${spot.moved.toFixed(2)} found=${spot.found} — LEFT INSIDE THE SEALED BOX`,
      );
    }
    notes.push(`rule (g) sealed box ${(innerHalf * 2).toFixed(2)} m inside: moved ${spot.moved.toFixed(2)} m to (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)})`);
  }

  // (g, thin) The same box with walls a tenth of a metre thick, moved 0.2 m
  // off the corner the others sit on. Now free cells of the router's lattice
  // stand within the rule's start reach of her centre, on the far side of a
  // wall, and only the swept path to the start cell (`OpenFloor.walksTo`)
  // keeps the flood from starting out there and calling the box open. The
  // final review of 18c2ecd1 found 5 of 28 such boxes leave her inside
  // without that sweep, and nothing else here noticed it missing.
  {
    const collision = world();
    const innerHalf = 0.66;
    const wall = 0.05;
    const cx = 0.2;
    const cz = 0;
    collision.addRectangle(cx, cz, innerHalf + wall, innerHalf + wall, wall);
    const spot = putDownSpot(collision, flat, { x: cx, y: 0, z: cz }, PLAYER_PUT_DOWN);
    const outside = Math.max(Math.abs(spot.x - cx), Math.abs(spot.z - cz)) >= innerHalf + 2 * wall + PLAYER_RADIUS - 1e-6;
    if (!spot.found || !outside) {
      fail(
        `rule (g) thin-walled box ${(innerHalf * 2).toFixed(2)} m inside, walls 0.10 m: asked (${cx.toFixed(2)}, ${cz.toFixed(2)}), ` +
          `got (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}) moved ${spot.moved.toFixed(2)} found=${spot.found} — LEFT INSIDE THE SEALED BOX`,
      );
    }
    notes.push(
      `rule (g) thin-walled box ${(innerHalf * 2).toFixed(2)} m inside, walls 0.10 m: moved ${spot.moved.toFixed(2)} m to (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)})`,
    );
  }

  // (f) The cost bound: one window of the router's lattice, however bad the
  // search — the window's size is the rule's own (`PUT_DOWN_WINDOW_CELLS`).
  {
    const collision = world();
    for (let i = -4; i <= 4; i += 1) collision.addWall(-9, i * 2, 9, i * 2 + 0.6, 0.1); // a maze of near-misses
    const t0 = performance.now();
    const spot = putDownSpot(collision, flat, { x: 0.1, y: 0, z: 0.3 }, PLAYER_PUT_DOWN);
    const ms = performance.now() - t0;
    if (spot.cells > PUT_DOWN_WINDOW_CELLS) fail(`rule (f) cost: ${spot.cells} cells built, over the window's ${PUT_DOWN_WINDOW_CELLS}`);
    notes.push(`rule (f) cost bound: ${spot.cells} of at most ${PUT_DOWN_WINDOW_CELLS} cells, ${ms.toFixed(1)} ms`);
  }
}

// ------------------------------------------------------------------ the park

// **Her pets**, two of them, bought before the park is built: the hotel dresses
// a pet bed for each companion she owns from the inventory, once, as it is
// built — as it does for a child who already has them.
gameStore.earn(1000);
const PETS: { readonly uid: string; readonly who: string }[] = [];
for (const [id, who] of [['pet.bunny', 'bunny'], ['pet.kitten', 'kitten']] as const) {
  const spec = shopItem(id);
  const bought = spec ? gameStore.buy(spec) : null;
  if (!bought || bought.outcome !== 'kept') fail(`the ${who} could not be bought — Next day's pets cannot be checked`);
  else PETS.push({ uid: bought.item.uid, who });
}
// Buying hands the newest thing to her hands; both walk in her parade instead.
gameStore.setCarried(null);
/**
 * How near her a pet must be, three seconds after she gets up, to be at her
 * heels: her parade's line is two companions long, and a companion back in it
 * walks within a few metres of her.
 */
const PET_HEEL_REACH = 4;

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
/**
 * Where she stood the instant the last put-down returned, and whether in the
 * air — what "she stands where the rule put her" is asked of, so that nothing
 * the world does in the frames after (a child walking into her) can be
 * mistaken for the rule.
 */
const placed = { x: 0, z: 0, airborne: false };
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
      Object.assign(placed, { x: player.position.x, z: player.position.z, airborne: player.isAirborne });
      putDownCount += 1;
      putDownMsTotal += ms;
      if (ms > slowest.ms) Object.assign(slowest, { ms, cells: player.lastPutDown?.cells ?? 0, site: site ?? "this check's own placement" });
    }
    return result;
  };
}

world.attachPlayer(player as never);
// Her pets' parade, built and wired as `Game` does: one parade, handed to the
// hotel and the castle, routed by her own router (below, once it exists).
const parade = new Parade(player as never, collision, camera);
scene.add(parade.group);
world.hotel.petParade = parade;
world.building.petParade = parade;
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
    // `Game`'s systems, in `Game`'s order: the parade, then the trees.
    parade.update(context as never);
    trees.update(context as never);
  }
}

// ------------------------------------------------------------------ 1b. a wedge with nowhere to go backs off

/**
 * **When the rule finds nowhere to put her, the wedge rescue waits longer
 * before it asks again** (`Player`'s `WEDGE_RETRY_MAX_SECONDS`). A real
 * `Player` on a world of her own: play bounds 1.2 m across, so no spot within
 * the rule's reach is open, and a world that reports her 0.2 m inside
 * something solid wherever she stands, so the wedge never lets up. Over 10 s,
 * half-second retries would be 20 full searches and 20 warnings; backing off,
 * doubling each time, it is four (at 0.5, 1.5, 3.5 and 7.5 s).
 */
{
  const box = new CollisionWorld();
  box.setPlayBounds(circleBoundary(1.2, 0, 0));
  const body = quietly(() => new Player(box, camera, new Vector3(0, 0, 0)));
  body.groundSampler = (): number => 0;
  box.deepestSolidOverlap = (): number => 0.2;
  const warn = console.warn;
  let warned = 0;
  console.warn = (): void => {
    warned += 1;
  };
  let clock = 0;
  for (let t = 0; t < 10 - 1e-9; t += 1 / 30) {
    clock += 1 / 30;
    body.update({ dt: 1 / 30, elapsed: clock, frame: Math.round(clock * 30), input: still, playerPosition: body.position, cameraForward: camera.forward } as never);
  }
  console.warn = warn;
  const tries = body.wedgeRescues;
  if (tries < 3 || tries > 5 || warned !== tries) {
    fail(
      `the wedge rescue with nowhere to go: ${tries} tries and ${warned} warnings in 10 s — ` +
        'it must back off, doubling its wait after each search that finds nowhere (4 tries, not 20)',
    );
  }
  notes.push(`rule (h) a wedge with nowhere to go: ${tries} tries in 10 s, ${warned} warnings (half-second retries would be 20)`);
}

// ------------------------------------------------------------------ 2. the instrument

/** The router, exactly as `Game` builds it — following the play bounds of the space she is in. */
const router = new NavGrid(collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT, world.routeConnectors, world.routeBridgeCovers);
parade.setNavGrid(router);
/** The rule, asked for a spot exactly as `Player` asks it. */
function putDownAt(x: number, y: number, z: number): ReturnType<typeof putDownSpot> {
  return putDownSpot(collision, sample, { x, y, z }, PLAYER_PUT_DOWN, world.putDownSpace);
}
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
/**
 * **How far she gets on her own feet** from `(x, y, z)`: a real `Player`,
 * stood there and stepped by its own `update`, the stick held each of eight
 * ways for 2.5 s — the farthest she gets from the spot. The body's answer, not
 * the router's, so this cannot share the rule's blind spots: the review of
 * 503bd56f found the router's start rule calling sealed nooks open, and every
 * instrument here that asked only the router agreed with it.
 *
 * `enough`, when given, stops at the first walk that gets that far — the
 * sweep's question is only "can she get {@link WALK_AWAY} m?", and asking it
 * of thousands of spots for the full 20 s each would cost minutes.
 */
function walkAway(x: number, y: number, z: number, enough = Infinity, what = ''): number {
  let farthest = 0;
  for (let k = 0; k < 8 && farthest < enough; k += 1) {
    const heading = (k * Math.PI) / 4;
    const input = stickAlong(Math.sin(heading), Math.cos(heading));
    player.position.set(x, y, z);
    player.previousPosition.copy(player.position);
    player.launch(0);
    let rescues = player.wedgeRescues;
    for (let t = 0; t < 2.5 && farthest < enough; t += 1 / 30) {
      elapsed += 1 / 30;
      player.update({ dt: 1 / 30, elapsed, frame: Math.round(elapsed * 30), input, playerPosition: player.position, cameraForward: camera.forward } as never);
      farthest = Math.max(farthest, Math.hypot(player.position.x - x, player.position.z - z));
      rescues = noteRescue(
        `${what ? `${what}: ` : ''}walking away from (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}) heading ${k * 45}°`,
        rescues,
      );
    }
  }
  walksWatched += 1;
  player.position.set(x, y, z);
  player.previousPosition.copy(player.position);
  player.launch(0);
  return farthest;
}
/**
 * **The wedge rescue never misfires on an ordinary walk.** `Player` lets go of
 * her when she has been stuck inside something solid for half a second: a
 * wedge, a gap narrower than she is that a hop or a drop put her in
 * (`check:hotel` probe 33 finds those on purpose). Walking on the flat can
 * never put her in one — `resolveMovement` refuses a step that leaves her
 * deeper in anything — so a rescue that is not straight after a landing is
 * the rescue misfiring: catching her leaning on a wall, say, and teleporting
 * her. Every rescue on these walks is collected; one whose wedge took hold
 * more than {@link WEDGE_AFTER_LANDING} after her last landing fails the
 * check. One straight after a landing is a real wedge she dropped into, and is
 * named on every run. (Walking off the suite's bed onto the floor beside a
 * pet bed is one: with two pets, the pet bed stands where she comes down,
 * 0.67 m inside its footprint.)
 */
const rescuedOnWalks: { what: string; afterLanding: boolean }[] = [];
let walksWatched = 0;
/** How soon after a landing a wedge she came down in takes hold, seconds. */
const WEDGE_AFTER_LANDING = 0.5;
/** Records any rescue since `before`, under `what`; returns the count to watch from. */
function noteRescue(what: string, before: number): number {
  if (player.wedgeRescues === before || !player.lastWedge) return player.wedgeRescues;
  const held = player.lastWedge;
  rescuedOnWalks.push({
    what:
      `${what}: a wedge let go of her, held at (${held.x.toFixed(2)}, ${held.y.toFixed(2)}, ${held.z.toFixed(2)}) ` +
      `${held.depth.toFixed(3)} m deep, taking hold ${Number.isFinite(held.afterLanding) ? `${held.afterLanding.toFixed(2)} s after a landing` : 'with no landing before it'}`,
    afterLanding: held.afterLanding <= WEDGE_AFTER_LANDING,
  });
  return player.wedgeRescues;
}
/** How far she must be able to walk from anywhere she was put down, metres. */
const WALK_AWAY = 1.5;
/** The shortest walk-away any put-down gave, for the report. */
const nearest = { walked: Infinity, what: '' };
function judgeWalkAway(what: string): void {
  const p = player.position.clone();
  const walked = walkAway(p.x, p.y, p.z, Infinity, what);
  if (walked < nearest.walked) Object.assign(nearest, { walked, what });
  if (walked < WALK_AWAY) {
    fail(
      `${what}: from (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) she walks at most ${walked.toFixed(2)} m on her own feet ` +
        `— eight ways, 2.5 s each; she must get ${WALK_AWAY} m`,
    );
  }
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
      // A restored save's way in, in `Game`'s own order: `Player` is built
      // standing there, the hotel adopts her (the room's bounds), and then she
      // is put down there — under the room's bounds, not the last space's.
      player.position.set(door.x, 0, door.z);
      player.previousPosition.copy(player.position);
      world.hotel.adoptRestoredPlayer();
      player.teleportTo(door.x, 0, door.z, Math.PI / 2);
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

// ------------------------------------------------------------------ 2b. the rule agrees with the router

/**
 * **Wherever the router can walk her out of, the rule leaves her exactly as
 * asked.** The rule's clause 4 claims to be the router's own answer to "can she
 * walk out of here?", and this holds it to that across a sample of real points
 * in every space — every cell of every railway bridge's deck and ramps, every
 * point of every declared stair, and a stride of every space's cells at each
 * of their top surfaces (the lobby's gallery, the castle's decks). A point is
 * in the sample when the router could stand there (`canStandAt`), her body is
 * clear there by the resolver's own test, the soft boundary leaves her alone,
 * and the router's flood from the space's way out reaches it. Every one of
 * those must come back from the rule unmoved.
 */
const TOP = 500;
const AGREE_STRIDE = 3;
let agreeAsked = 0;
const agreeMoved: string[] = [];
const agreeBySpace: string[] = [];
for (const visit of SPACES) {
  settle();
  visit.enter();
  tick(0.3);
  const door = wayOut(player.position.x, player.position.z);
  if (!door) continue;
  const doorY = sample(door.x, door.z, player.position.y + 3);
  const fromDoor = router.floodFrom(door.x, door.z, doorY, sample);
  if (!fromDoor) {
    fail(`router agreement: no flood from ${visit.name}'s way out — the clause cannot ask anything there`);
    continue;
  }
  const points: { x: number; y: number; z: number; what: string }[] = [];
  let column = 0;
  router.forEachCellCentre(sample, (x, z, blocked) => {
    column += 1;
    if (blocked || spaceAt(x, z) !== visit.space) return;
    const onBridge = world.routeBridgeCovers(x, z);
    const strided = Math.round(x / NAV_CELL) % AGREE_STRIDE === 0 && Math.round(z / NAV_CELL) % AGREE_STRIDE === 0;
    if (visit.space === SPACE_GARDEN ? !onBridge : !strided) return;
    points.push({ x, y: sample(x, z, TOP), z, what: onBridge ? 'a bridge' : 'a top surface' });
  });
  for (const connector of world.routeConnectors()) {
    for (const point of connector.points) {
      if (spaceAt(point.x, point.z) === visit.space) points.push({ x: point.x, y: point.y, z: point.z, what: 'a stair' });
    }
  }
  let asked = 0;
  let moved = 0;
  for (const point of points) {
    if (!router.canStandAt(point.x, point.z, point.y, sample)) continue;
    if (!collision.clearOfBoundary(point.x, point.z, PLAYER_RADIUS)) continue;
    if (collision.deepestSolidOverlap(new Vector3(point.x, point.y, point.z), PLAYER_RADIUS, 0) > 1e-3) continue;
    if (!fromDoor.has(point.x, point.z, point.y)) continue;
    asked += 1;
    const spot = putDownAt(point.x, point.y, point.z);
    if (spot.moved > 0 || !spot.found) {
      moved += 1;
      agreeMoved.push(
        `${visit.name}, ${point.what} at (${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)}): ` +
          `moved ${spot.moved.toFixed(2)} m to (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)})${spot.found ? '' : ', found nothing'}`,
      );
    }
  }
  agreeAsked += asked;
  agreeBySpace.push(`${visit.name}: ${asked} points the router walks out of, ${moved} moved`);
}
if (agreeAsked < 200) fail(`router agreement: only ${agreeAsked} points asked — too few to mean anything`);
if (agreeMoved.length > 0) {
  fail(
    `router agreement: the rule moved ${agreeMoved.length} of ${agreeAsked} points the router walks her out of exactly as given:\n      ` +
      agreeMoved.slice(0, 12).join('\n      ') +
      (agreeMoved.length > 12 ? `\n      … and ${agreeMoved.length - 12} more` : ''),
  );
}
notes.push(`router agreement: ${agreeAsked} points, ${agreeMoved.length} moved — ${agreeBySpace.join('; ')}`);

// ------------------------------------------------------------------ 2c. off the lattice, still free

/**
 * **Wherever the rule puts her that the router could not stand her on, she can
 * still walk away** — the review of 503bd56f's own sweep. Would-be exits at
 * floor level over every space, each asked of the rule; every one it accepts
 * on a spot `canStandAt` refuses (a cell the lattice stamps beside furniture,
 * a sliver between two props) is walked away from by the body, eight ways: at
 * least {@link WALK_AWAY} m.
 *
 * Only the edges are swept: a cell within {@link SWEEP_BAND} cells of a cell
 * she cannot stand on *and* of one she can. An exit out on open floor is
 * accepted where it is, on the lattice, and has nothing to say here; an exit
 * in the void beyond a room's walls has nowhere to go. Every third cell of an
 * interior's band, every sixth of the park's: about 10,600 exits on seed 5,
 * and at that density it finds 503bd56f's sealed nooks — five exits in the
 * Reptile House and the park put where she walks at most 0.10–0.28 m.
 */
const SWEEP_BAND = 3;
let sweepAsked = 0;
let sweepOffLattice = 0;
const sweepBySpace: string[] = [];
for (const visit of SPACES) {
  settle();
  visit.enter();
  tick(0.3);
  const arrival = player.position.clone();
  // **Where she is, not where the visit meant her to be.** A walk-away that
  // ended at a slide's mouth once carried her out of the next room into the
  // park, and the sweep went on calling the park's floor that room's.
  if (player.riding || spaceAt(arrival.x, arrival.z) !== visit.space) {
    fail(
      `off the lattice: the sweep could not stand her in ${visit.name} — she is in ${spaceAt(arrival.x, arrival.z)}` +
        `${player.riding ? ', riding' : ''}, at (${arrival.x.toFixed(2)}, ${arrival.y.toFixed(2)}, ${arrival.z.toFixed(2)})`,
    );
    continue;
  }
  // The floor she arrived on, carried across the space: the highest surface at
  // or below her own feet, so a dais she was spawned on does not lift the
  // whole floor 1.2 m into the air (the castle mall's spawn does).
  const floorAt = (x: number, z: number): number =>
    visit.space === SPACE_GARDEN ? terrainHeight(x, z) : sample(x, z, arrival.y + 0.05);
  const cellKey = (x: number, z: number): string => `${Math.round(x / NAV_CELL)},${Math.round(z / NAV_CELL)}`;
  const standable = new Set<string>();
  const refused = new Set<string>();
  const cells: { x: number; z: number }[] = [];
  router.forEachCellCentre(sample, (x, z, blocked) => {
    if (spaceAt(x, z) !== visit.space) return;
    cells.push({ x, z });
    if (!blocked && router.canStandAt(x, z, floorAt(x, z), sample)) standable.add(cellKey(x, z));
    else refused.add(cellKey(x, z));
  });
  const within = (set: Set<string>, x: number, z: number): boolean => {
    for (let dx = -SWEEP_BAND; dx <= SWEEP_BAND; dx += 1) {
      for (let dz = -SWEEP_BAND; dz <= SWEEP_BAND; dz += 1) if (set.has(cellKey(x + dx * NAV_CELL, z + dz * NAV_CELL))) return true;
    }
    return false;
  };
  const stride = visit.space === SPACE_GARDEN ? 6 : 3;
  const points = cells.filter(
    (cell) =>
      Math.round(cell.x / NAV_CELL) % stride === 0 &&
      Math.round(cell.z / NAV_CELL) % stride === 0 &&
      within(standable, cell.x, cell.z) &&
      within(refused, cell.x, cell.z),
  );
  let asked = 0;
  let offLattice = 0;
  // The rule says so when nothing within reach passes; the count is reported
  // here instead, rather than one line per hopeless exit into a wall.
  const warn = console.warn;
  let hopeless = 0;
  console.warn = (): void => {
    hopeless += 1;
  };
  for (const point of points) {
    const y = floorAt(point.x, point.z);
    const spot = putDownAt(point.x, y, point.z);
    asked += 1;
    if (!spot.found || router.canStandAt(spot.x, spot.z, spot.y, sample)) continue;
    offLattice += 1;
    const walked = walkAway(spot.x, spot.y, spot.z, WALK_AWAY, `off the lattice, ${visit.name}`);
    if (walked < WALK_AWAY) {
      fail(
        `off the lattice: ${visit.name}, an exit at (${point.x.toFixed(2)}, ${y.toFixed(2)}, ${point.z.toFixed(2)}) is put down at ` +
          `(${spot.x.toFixed(2)}, ${spot.y.toFixed(2)}, ${spot.z.toFixed(2)}), where the router cannot stand her, and she walks ` +
          `at most ${walked.toFixed(2)} m from there`,
      );
    }
  }
  console.warn = warn;
  // Back where she came in, before anything ticks: the last walk-away leaves
  // her on whatever spot it was judging, and that may be a ride's mouth.
  player.teleportTo(arrival.x, arrival.y, arrival.z);
  if (asked < 50) fail(`off the lattice: only ${asked} would-be exits in ${visit.name} — too few to mean anything`);
  sweepAsked += asked;
  sweepOffLattice += offLattice;
  sweepBySpace.push(`${visit.name}: ${asked} exits, ${offLattice} put off the lattice, ${hopeless} with nowhere within reach`);
}
notes.push(`off the lattice: ${sweepAsked} would-be exits, ${sweepOffLattice} put where the router cannot stand her, each walked away from — ${sweepBySpace.join('; ')}`);

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
  const hadKey = saveFlags.hasHotelKey();
  let laidInBed = false;
  let petsAbed = false;
  for (let t = 0; t < 6 && (player.riding || !laidInBed); t += 0.1) {
    tick(0.1);
    if (player.sleeping && suiteBed) {
      const bx = SUITE.originX + suiteBed[0];
      const bz = SUITE.originZ + suiteBed[1];
      if (Math.hypot(player.position.x - bx, player.position.z - bz) < 1.2) laidInBed = true;
      if (petsInTheirBeds()) petsAbed = true;
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
  if (player.isFlying) clauses.push('still flying');
  if (!petsAbed) clauses.push(`her pets were never all asleep in their own beds while she slept (${petsNow()})`);
  const out = walksOut();
  if (!out.out) clauses.push(`cannot walk to the suite's door — ${out.why}`);
  judgeWalkAway(`Next day from ${label}: waking`);
  const following = petsFollowHer();
  if (following) clauses.push(following);
  // The key's one job, for a child who had none: the suite's own door out has
  // no lock, and the corridor's door back in has (`Hotel.suiteLock`) — so
  // without it she would be shut out of her own suite the moment she stepped
  // out of it.
  if (!hadKey) {
    const home = outAndBackIn();
    if (home !== SUITE.space) {
      clauses.push(`locked out of her own suite: she walked out to the corridor, and its door would not let her back in (left in ${home})`);
    }
  }
  if (clauses.length > 0) fail(`Next day from ${label}${wasRiding ? ' (mid-ride)' : ''}: ${clauses.join('; ')}`);
  nextDays.push(
    `${label}${wasRiding ? ' (mid-ride)' : ''}: ` +
      (clauses.length > 0
        ? 'FAILED'
        : `awake in the suite, day ${dayCount}; her ${PETS.length} pets asleep in their beds, then at her heels` +
          (hadKey ? '' : '; out to the corridor and back in, with the key it gave her')),
  );
}
/** Every pet she owns asleep in its own bed in the middle bedroom, as the hotel's beds report it. */
function petsInTheirBeds(): boolean {
  const beds = world.hotel.petBeds;
  return PETS.every((pet) => beds.some((bed) => bed.uid === pet.uid && bed.bedIndex === MIDDLE_BEDROOM_INDEX && bed.asleep));
}
/** Where her pets are now, for a failure message. */
function petsNow(): string {
  return PETS.map((pet) => {
    const state = parade.petState(pet.uid);
    if (!state) return `the ${pet.who}: not in the parade`;
    const away = Math.hypot(state.x - player.position.x, state.z - player.position.z);
    return `the ${pet.who}: ${state.bedPhase ?? 'up'}, ${away.toFixed(1)} m from her`;
  }).join(', ');
}
/**
 * **Up, and her pets come with her**: she walks for three seconds toward the
 * suite's door, and every pet must be out of its bed and at her heels.
 */
function petsFollowHer(): string | null {
  const door = hotelDoorBands(SUITE).find((band) => band.kind === 'corridor-door');
  if (!door) return 'the suite has no corridor door to walk toward';
  for (let t = 0; t < 3; t += 0.1) {
    tick(0.1, stickAlong(door.centreX - player.position.x, door.centreZ - player.position.z));
  }
  const lagging = PETS.filter((pet) => {
    const state = parade.petState(pet.uid);
    return !state || state.bedPhase !== null || Math.hypot(state.x - player.position.x, state.z - player.position.z) > PET_HEEL_REACH;
  });
  return lagging.length === 0 ? null : `her pets did not get up and follow her (${petsNow()})`;
}
/** Out of the suite by its own door, then back by the corridor's: the space she ends in. */
function outAndBackIn(): SpaceId {
  const out = hotelDoorBands(SUITE).find((band) => band.kind === 'corridor-door');
  const back = hotelDoorBands(CORRIDOR).find((band) => band.kind === 'suite-portal');
  if (!out || !back) return spaceAt(player.position.x, player.position.z);
  for (const sign of [1, -1] as const) {
    if (spaceAt(...startOf(out, sign)) === SUITE.space) crossBand(out, sign);
  }
  if (spaceAt(player.position.x, player.position.z) !== CORRIDOR.space) return spaceAt(player.position.x, player.position.z);
  for (const sign of [1, -1] as const) {
    if (spaceAt(...startOf(back, sign)) === CORRIDOR.space) crossBand(back, sign);
  }
  return spaceAt(player.position.x, player.position.z);
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

/** Where a walk across `band` starts on its `sign` side: 1.6 m short of it. */
function startOf(band: PortalBand, sign: 1 | -1): [number, number] {
  return [
    band.centreX - sign * Math.sin(band.yaw) * (band.halfAlong + 1.6),
    band.centreZ - sign * Math.cos(band.yaw) * (band.halfAlong + 1.6),
  ];
}

/**
 * Walk her across `band` from its `sign` side — stood 1.6 m short of it, the
 * stick held through it, the way every door is used — until the space she is
 * in changes or three seconds pass. True when the door placed her (a change
 * of space, a refusal's step back): something besides the walk to its start.
 */
function crossBand(band: PortalBand, sign: 1 | -1): boolean {
  const [startX, startZ] = startOf(band, sign);
  // Past an arrival's cooldown (`SpaceManager.settling`, 0.9 s): no doorway
  // fires in it, which is the point of it, and a walk through one inside it
  // walks off the end of the room's floor instead.
  tick(1.2);
  player.teleportTo(startX, sample(startX, startZ, player.position.y + 1), startZ);
  tick(0.1);
  const before = player.putDowns;
  let rescues = player.wedgeRescues;
  const from = spaceAt(player.position.x, player.position.z);
  const walking = `walking ${sign > 0 ? 'along' : 'against'} ${band.what} from ${from}`;
  for (let t = 0; t < 3 && spaceAt(player.position.x, player.position.z) === from; t += 0.1) {
    tick(0.1, stickAlong(sign * Math.sin(band.yaw), sign * Math.cos(band.yaw)));
    rescues = noteRescue(walking, rescues);
  }
  tick(0.3);
  noteRescue(walking, rescues);
  walksWatched += 1;
  return player.putDowns !== before;
}

/**
 * Walk across one band, from 1.6 m short of it on each side that lies in this
 * space, holding the stick through it — the way every door is used. Whatever
 * the door does with her (a change of space, a refusal), every put-down it
 * makes is asked whether she can walk out.
 */
function walkAcross(visit: SpaceVisit, band: PortalBand): void {
  for (const sign of [1, -1] as const) {
    if (spaceAt(...startOf(band, sign)) !== visit.space) continue;
    settle();
    visit.enter();
    const from = visit.space;
    if (!crossBand(band, sign)) continue; // walked on past it: nothing placed her
    const to = spaceAt(player.position.x, player.position.z);
    const out = walksOut();
    arrivals.push(`${band.what}, walked ${sign > 0 ? 'along' : 'against'} it from ${from}: now in ${to}, out=${out.out}`);
    if (!out.out) fail(`${band.what}: walked through from ${from}, put down in ${to} unable to walk out — ${out.why}`);
    judgeWalkAway(`${band.what}, walked through from ${from}`);
  }
}

// **Keyless, first** — the key is only ever given, never taken back. The
// suite's own door refuses her, by a step back (`Hotel.refuseSuite`), a
// put-down like any other; and then "Next day" must give her the key, or the
// lock on the corridor's door would shut her out of the suite she woke in the
// moment she stepped out of it.
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
  // A fling lands where gravity takes her; anything else stands where she was
  // put — asked of the instant the put-down returned (`placed`).
  if (Math.hypot(placed.x - spot.x, placed.z - spot.z) > 1e-6 && !placed.airborne) {
    fail(`${what}: she was left at (${placed.x.toFixed(2)}, ${placed.z.toFixed(2)}), not where the rule put her (${spot.x.toFixed(2)}, ${spot.z.toFixed(2)})`);
  }
  tick(1); // let a fling land
  judgeWalkAway(`${what}: left by ${left}`);
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
  judgeWalkAway(`${visit.name}: its own arrival`);

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
  judgeWalkAway(label);
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
// …and in the air under the jet pack — not a ride, so the ☰ menu is up for it.
nextDayFrom('a jet-pack flight', () => {
  SPACES[0]!.enter();
  tick(0.2);
  // As holding the hop button leaves her: off the ground, the pack holding her.
  player.position.y += 3;
  player.launch(0);
  (player as unknown as { flying: boolean }).flying = true;
  tick(0.05);
  if (!player.isFlying) fail('Next day from a jet-pack flight: the set-up never had her flying, so the case asserts nothing');
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

// ------------------------------------------------------------------ the wedge rescue, never on a walk

if (walksWatched < 100) fail(`the wedge rescue's watch saw only ${walksWatched} walks — too few to say it never misfires on one`);
const misfires = rescuedOnWalks.filter((rescue) => !rescue.afterLanding);
if (misfires.length > 0) {
  fail(
    `the wedge rescue fired ${misfires.length} time(s) on ordinary walks for a wedge that took hold with no landing in the ${WEDGE_AFTER_LANDING} s before — ` +
      `it must only ever let go of a wedge she landed in:\n      ` +
      misfires.slice(0, 12).map((rescue) => rescue.what).join('\n      ') +
      (misfires.length > 12 ? `\n      … and ${misfires.length - 12} more` : ''),
  );
}

// ------------------------------------------------------------------ report

const moved = exits.filter((exit) => exit.moved > 0);
say(`check:exits — the rule's own clauses:\n  ${notes.filter((note) => note.startsWith('rule')).join('\n  ')}`);
say(`check:exits — ${notes.find((note) => note.startsWith('instrument')) ?? 'instrument controls: NOT RUN'}`);
say(`check:exits — ${notes.find((note) => note.startsWith('router agreement')) ?? 'router agreement: NOT RUN'}`);
say(`check:exits — ${notes.find((note) => note.startsWith('off the lattice')) ?? 'off the lattice: NOT RUN'}`);
say(`check:exits — walked away from every put-down on her own feet: the shortest walk was ${nearest.walked.toFixed(2)} m (${nearest.what}); she must get ${WALK_AWAY} m`);
say(
  `check:exits — the wedge rescue on ordinary walking: ${rescuedOnWalks.length} firing(s) over ${walksWatched} walk-aways and doorway walks, ` +
    `${misfires.length} with no landing just before (must be 0)` +
    rescuedOnWalks
      .filter((rescue) => rescue.afterLanding)
      .map((rescue) => `\n  after a landing, a real wedge: ${rescue.what}`)
      .join(''),
);
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
for (const note of notes.filter((note) => !note.startsWith('rule') && !note.startsWith('instrument') && !note.startsWith('router agreement') && !note.startsWith('off the lattice'))) say(`  note: ${note}`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error(`check:exits FAILED — ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('check:exits OK');
