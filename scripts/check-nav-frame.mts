/**
 * **`check:nav-frame` — no frame spends more than its route budget finding its
 * way, and every route found is the one a whole search finds** (step 1b of the
 * 120 fps plan, second half: `docs/perf/FRAME-DROPS-2026-11.md`, items 1 and 13).
 *
 * ```
 * pnpm run check:nav-frame
 * NAV_FRAME_MUTATE=sync pnpm run check:nav-frame       # her navigator, companions and crowd plan whole, as before: must go red
 * NAV_FRAME_MUTATE=deadline pnpm run check:nav-frame   # the scheduler ignores its deadline: must go red
 * ```
 *
 * **Where CI runs it:** behind `check:nav-spaces` (`check:shard-6`), as
 * `check:nav-warm` is — the `check:nav-spaces` script entry ends
 * `&& pnpm run check:nav-warm && pnpm run check:nav-frame`. In no shard by
 * name; adding it to one as well would run it twice.
 *
 * ## What was wrong
 *
 * Every route was found in one go inside the frame that asked for it. On an M4
 * Pro (Chrome 151, seed 5, 13 Nov 2026): a far tap was 33–35 ms of A\* in one
 * frame (37–42 ms frames), a crowd child's plan up to 37 ms, and the first
 * child to plan on a castle floor built that floor's whole lattice inside its
 * plan — 55 ms, a 73 ms frame, about a minute after she walked in.
 *
 * ## The session
 *
 * The real park (`park-harness.mts`), the real `Player`, `TapNavigator`,
 * `Parade` (two pets) and crowd (`world.update`), all sharing one
 * `RouteScheduler` at the game's budget and wired exactly as `Game` wires them,
 * stepped a 120 Hz frame at a time in `Game.tick`'s order: a tap, if any,
 * *between* frames (where a DOM event lands), then `beginFrame` + `run`
 * (`Game.warmNavigation`), the world (the crowd plans), her strides and her
 * parade, then `endFrame`. Through it:
 *
 * 1. her lattice laid from cold (the cat-bus ride's work);
 * 2. taps in the park: near, middling, far, and onto a solid (the flood case);
 * 3. the whole crowd choosing somewhere new in the same frame;
 * 4. a routed walk in through the castle's front door, a crowd child's first
 *    plan on the mall (the floor's lattice laid inside it, on main), and taps
 *    across the mall;
 * 5. a tap on the mall's way out, through `TapNavigator.handleTap` and
 *    `doorwayTapTarget` as `Game` installs it — she must walk out;
 * 6. taps in the park the moment she is back (her park lattice re-laid);
 * 7. frames until nothing is left to answer.
 *
 * ## The instrument
 *
 * Every `NavGrid` method that finds a way — `findRoute`, `advanceRequest`,
 * `warm`, `canStandAt`, `reachableFrom`, `floodFrom`, `nearestStandable` —
 * wrapped on the prototype, outermost call only, timed on **this thread's own
 * CPU clock** (`process.threadCpuUsage`, which a busy machine descheduling the
 * process cannot inflate) and on the wall clock (reported), and summed per
 * frame. A tap's work between frames counts towards the frame after it, the
 * display interval it lands in. It sees any route-finding at all, through the
 * scheduler or around it.
 *
 * **Garbage collection is taken off**: a collection the world's allocations
 * trigger lands inside whichever call it interrupts, and is not that call's
 * cost. `v8.GCProfiler`, started round each call, says what the call paid for
 * collections; that is subtracted, and reported on every run.
 *
 * **The put-down rule's windows are timed apart**: `NavGrid.around` lattices
 * (`world/dismount.ts`), laid whole when she is set down (a door, a wedge
 * rescue). Not a route for a tap or a plan; reported on every run as what this
 * check does not cover.
 *
 * ## What is asserted
 *
 * - **No frame of play spent more than {@link FRAME_LIMIT_MS} of CPU finding its
 *   way** — three of the game's {@link NAV_WARM_BUDGET_MS}: the budget itself,
 *   one search chunk or lattice piece past its deadline, and a route's
 *   reconstruction, on a runner slower than this Mac; a whole far search
 *   (33+ ms here) or a lattice built in one task (55+ ms) is an order past it.
 *   "Of play" leaves out step 1 — her first lattice, laid from cold behind
 *   the cat bus by code the JIT is running for the first time — which is
 *   reported with its own worst frame instead.
 * - **Every route answered is the route a whole search gives**: each answer is
 *   compared, float for float, with `findRoute` asked the same question of the
 *   same lattice the moment it lands (the comparison is not timed).
 * - **Nothing waits for ever**: every question asked was answered by the end.
 * - **No whole lattice was built in one task** (`NAV_GRID_BUILDS`), and at
 *   least one was laid in slices — or the session never asked for one.
 * - **She sets off within two frames of every tap**, routed or not.
 * - **The doorway tap takes her out** of the castle.
 *
 * And the **control**, every run: the same instrument round today's code — a
 * navigator with no scheduler, planning whole — given one far tap and one tap
 * onto a solid, must see a frame over {@link FRAME_LIMIT_MS}. Otherwise the
 * instrument could not see what this check exists to catch.
 *
 * ## Proved red — seed 5, restart 1, on commit 85eeb4e7 (13 Nov 2026, this Mac)
 *
 * The session above, unchanged; geometry is the checked-in park's
 * (`parks/5.json`). The Mac was at a load average of ~50 for these runs (a
 * full `check`, `test:procgen` and a browser QA beside it), which is why the
 * red numbers are larger than the 33–55 ms of an idle machine. Green on the
 * same commit, same load: worst frame of play 3.23 ms CPU (crowd), p99 2.29 ms,
 * 76 answers compared, 0 lattices built in one task; GC taken off route-finding
 * calls 519.8 ms in all (worst 100.59 ms in one call — what the GC exclusion is
 * for). An earlier green, idle-ish (load ~7, 6e3f1fba): worst 3.13 ms.
 *
 * `NAV_FRAME_MUTATE=sync` — her navigator, her parade and the crowd built
 * with no scheduler, i.e. today's code (exit 1, 3 failures):
 *
 * ```
 * ✗ no frame of play spent more than 6 ms of CPU finding its way: worst 239.18 ms (castle), p99 1.50 ms, 43 over the limit, 54 over the 2 ms budget, of 5584 frames
 *   a worst frame: 953.05 ms CPU (cold): warm@379² 2.18, findRoute@379² 895.52, findRoute@379² 55.35
 *   a worst frame: 239.18 ms CPU (castle): findRoute@192² 239.17
 *   a worst frame: 138.14 ms CPU (crowd): findRoute@379² 71.52, findRoute@379² 66.62
 *   a worst frame: 82.33 ms CPU (park taps): findRoute@379² 82.32
 * ✗ every answer is the whole search's route, float for float (0 compared, 0 whose lattice had moved on before they could be)
 * ✗ after her first lattice: 0 lattice(s) laid in slices, 1 laid whole in one task (192² in castle), 1 half-laid one finished in one go — must be 0 and 0, with at least 1 sliced
 * ```
 *
 * (The 895 ms is a companion's first plan finishing her half-laid park lattice
 * in one go; the 239 ms is the mall's lattice laid whole inside a child's
 * plan — the 55 ms Chrome measured on an idle Mac.)
 *
 * `NAV_FRAME_MUTATE=deadline` — the scheduler's deadline ignored, so each
 * request it touches is answered whole (exit 1, 1 failure):
 *
 * ```
 * ✗ no frame of play spent more than 6 ms of CPU finding its way: worst 213.56 ms (castle), p99 3.69 ms, 48 over the limit, 132 over the 2 ms budget, of 5652 frames
 *   a worst frame: 213.56 ms CPU (castle): warm@192² 1.82, advanceRequest@192² 211.74
 *   a worst frame: 89.15 ms CPU (park taps): advanceRequest@379² 88.86
 * ```
 *
 * Its answers stayed equal to the whole search's (84 compared): the mutation
 * breaks the slicing, not the search, and the equality clause rightly passes.
 * The control line passed in all three runs.
 */
import './headless-canvas.mjs';
import v8 from 'node:v8';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { NAV_GRID_BUILDS, NAV_WARM_BUDGET_MS, NavGrid, TOP_REFERENCE } from '../src/world/NavGrid.ts';
import { RouteScheduler, type RouteRequest } from '../src/world/routeScheduler.ts';
import { playerNavGrid } from '../src/world/playerLattice.ts';
import { Player } from '../src/entities/Player.ts';
import { TapNavigator } from '../src/entities/TapNavigator.ts';
import { FrameStrides } from '../src/entities/frameStrides.ts';
import { Parade } from '../src/entities/parade/Parade.ts';
import { doorwayTapTarget } from '../src/entities/doorwayTap.ts';
import { castleEntranceBand } from '../src/world/building/Building.ts';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from '../src/world/building/layout.ts';
import { BUILDING_HALF_Z } from '../src/core/constants.ts';
import { CASTLE_MALL } from '../src/world/building/floors.ts';
import { castleFloorBounds } from '../src/world/building/floorBounds.ts';
import { SPACE_GARDEN, spaceAt } from '../src/world/spaces.ts';
import { gameStore } from '../src/state/index.ts';
import { SAVE_VERSION } from '../src/state/save.ts';
import { shopItem } from '../src/world/building/shops/catalogue.ts';
import { PARK_SEED_ASKED, PARK_RESTART } from '../src/world/parkManifest.ts';
import type { FrameContext } from '../src/core/types.ts';
import type { TapPoint } from '../src/core/input/PointerControls.ts';

const MUTATE = process.env['NAV_FRAME_MUTATE'] ?? '';
if (MUTATE !== '' && MUTATE !== 'sync' && MUTATE !== 'deadline') {
  throw new Error(`NAV_FRAME_MUTATE=${MUTATE}: the mutations are 'sync' and 'deadline'`);
}

/** The most CPU one frame may spend finding its way: see the header. */
const FRAME_LIMIT_MS = 3 * NAV_WARM_BUDGET_MS;
/** A 120 Hz frame — the game's target. */
const DT = 1 / 120;
/** She must be moving by this many frames after a tap. */
const SET_OFF_FRAMES = 2;

let failures = 0;
const say = (ok: boolean, line: string): void => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${line}`);
};
const note = (line: string): void => {
  process.stderr.write(`check:nav-frame: ${line}\n`);
};

const park = quietly(() => buildHeadlessPark());
const world = park.world;
const collision = world.collision;
const camera = park.camera;
note(`seed ${PARK_SEED_ASKED} restart ${PARK_RESTART}${MUTATE ? `, MUTATED on purpose (${MUTATE}) — this run must go red` : ''}`);

// ------------------------------------------------------------- the instrument

let paused = 0;
let depth = 0;
let frameCpuUs = 0;
let frameWallMs = 0;
/** This frame's route-finding, by method and lattice size — for the worst frames' report. */
let frameParts: string[] = [];
/**
 * The put-down rule's lattices (`world/dismount.ts`, `NavGrid.around`) — a
 * small window flooded when the game sets her down (every change of space, a
 * wedge rescue). Not a route for a tap or a plan, and not this check's to
 * hold to the route budget: timed apart and reported on every run, so the
 * cover this check does not give is said out loud.
 */
let windowCpuUs = 0;
let worstWindowMs = 0;
/** Collections that landed inside route-finding calls, taken off their time — see the wrapper. */
let gcInNavUs = 0;
let worstGcInNavMs = 0;
let windowCalls = 0;
const isWindow = (grid: unknown): boolean => (grid as { windowAround: unknown }).windowAround != null;
const methods = ['findRoute', 'advanceRequest', 'warm', 'canStandAt', 'reachableFrom', 'floodFrom', 'nearestStandable'] as const;
const navProto = NavGrid.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
const original: Record<string, (...args: unknown[]) => unknown> = {};
for (const name of methods) {
  const method = navProto[name];
  if (typeof method !== 'function') throw new Error(`check:nav-frame: NavGrid.${name} is gone — the instrument would time nothing`);
  original[name] = method;
  navProto[name] = function (this: unknown, ...args: unknown[]): unknown {
    if (depth > 0 || paused > 0) return method.apply(this, args);
    depth += 1;
    // Garbage collection is not route-finding: a collection triggered by the
    // world's allocations can land inside any call, and would be charged to
    // whichever one it interrupted. V8's own profiler says what each call
    // paid for collections, and that is taken off it (and reported).
    const gc = new v8.GCProfiler();
    gc.start();
    const cpu = process.threadCpuUsage();
    const wall = performance.now();
    try {
      return method.apply(this, args);
    } finally {
      depth -= 1;
      const used = process.threadCpuUsage(cpu);
      let gcUs = 0;
      for (const collection of gc.stop().statistics) gcUs += collection.cost;
      gcInNavUs += gcUs;
      worstGcInNavMs = Math.max(worstGcInNavMs, gcUs / 1000);
      const us = Math.max(0, used.user + used.system - gcUs);
      if (isWindow(this)) {
        windowCpuUs += us;
        windowCalls += 1;
        worstWindowMs = Math.max(worstWindowMs, us / 1000);
      } else {
        frameCpuUs += us;
        frameWallMs += performance.now() - wall;
        if (us >= 500) frameParts.push(`${name}@${(this as { cells?: number }).cells ?? '?'}² ${(us / 1000).toFixed(2)}`);
      }
    }
  };
}

// A whole lattice laid in one task — `rebuild`, which only a question that
// cannot wait reaches (`ensureLattice`) — counted per grid kind: a window's is
// the put-down rule's own, any other is a lattice a route waited on whole.
let oneTaskBuilds = 0;
const oneTaskWhat: string[] = [];
const wholeRebuild = navProto['rebuild'] as (...args: unknown[]) => unknown;
navProto['rebuild'] = function (this: unknown, ...args: unknown[]): unknown {
  const result = wholeRebuild.apply(this, args);
  if (!isWindow(this) && paused === 0) {
    oneTaskBuilds += 1;
    if (oneTaskWhat.length < 5) oneTaskWhat.push(`${(this as { cells?: number }).cells ?? '?'}² in ${phase}`);
  }
  return result;
};

// Every answer, checked against a whole search of the same question on the
// same lattice — kept as it landed, and asked again of the grid after the
// frame, untimed and outside the scheduler (so neither the instrument nor the
// scheduler's own budget pays for the check). An answer whose lattice has
// moved on by then (a patch, a rebuild) cannot be compared and is counted
// apart, never as a match.
interface Answer {
  readonly grid: NavGrid;
  readonly generation: number;
  readonly sample: NonNullable<RouteRequest['sample']>;
  readonly start: readonly [number, number, number];
  readonly goal: readonly [number, number, number];
  readonly count: number;
  readonly reachedGoal: boolean;
  readonly endY: number;
  readonly out: Float32Array;
}
const answers: Answer[] = [];
let compared = 0;
let uncomparable = 0;
const mismatches: string[] = [];
const scratch = new Float32Array(256 * 2);
type GridInsides = { generation: number; latticeReady(): boolean };
const timedAdvance = navProto['advanceRequest'] as (...args: unknown[]) => unknown;
navProto['advanceRequest'] = function (this: NavGrid, ...args: unknown[]): unknown {
  const request = args[0] as RouteRequest;
  const deadline = MUTATE === 'deadline' ? Infinity : (args[1] as number);
  const answered = timedAdvance.call(this, request, deadline) as boolean;
  if (answered && request.sample) {
    answers.push({
      grid: this,
      generation: (this as unknown as GridInsides).generation,
      sample: request.sample,
      start: [request.startX, request.startZ, request.startY],
      goal: [request.goalX, request.goalZ, request.goalY],
      count: request.count,
      reachedGoal: request.reachedGoal,
      endY: request.endY,
      out: request.out.slice(0, request.count * 2),
    });
  }
  return answered;
};

/** Asks every answer of the last frame again, whole, and compares. */
const verifyAnswers = (): void => {
  paused += 1;
  try {
    for (const answer of answers) {
      const insides = answer.grid as unknown as GridInsides;
      if (insides.generation !== answer.generation || !insides.latticeReady()) {
        uncomparable += 1;
        continue;
      }
      const [sx, sz, sy] = answer.start;
      const [gx, gz, gy] = answer.goal;
      const count = answer.grid.findRoute(sx, sz, sy, gx, gz, gy, answer.sample, scratch);
      compared += 1;
      let same = count === answer.count && answer.grid.lastRouteReachedGoal === answer.reachedGoal && Object.is(answer.grid.lastRouteEndY, answer.endY);
      for (let i = 0; same && i < count * 2; i += 1) same = Object.is(scratch[i], answer.out[i]);
      if (!same && mismatches.length < 5) {
        mismatches.push(
          `(${sx.toFixed(2)}, ${sz.toFixed(2)}) → (${gx.toFixed(2)}, ${gz.toFixed(2)}): sliced ${answer.count} waypoints / reached ${answer.reachedGoal} / ends ${answer.endY}, ` +
            `whole ${count} / ${answer.grid.lastRouteReachedGoal} / ${answer.grid.lastRouteEndY}`,
        );
      }
    }
  } finally {
    paused -= 1;
    answers.length = 0;
  }
};

// ------------------------------------------------------- the game, as Game wires it

const player = quietly(() => new Player(collision, camera, new Vector3(0, 0, 0)));
park.scene.add(player.group);
quietly(() => world.attachPlayer(player));
if (player.riding) quietly(() => player.endRide({ x: 2, y: park.sample(2, 6, TOP_REFERENCE), z: 6 } as never));
if (player.riding) throw new Error('check:nav-frame: the player is still riding after endRide — nothing below could move her');
quietly(() => player.teleport(2, 6));

const herGrid = playerNavGrid(world);
const routes = new RouteScheduler(NAV_WARM_BUDGET_MS);
const sliced = MUTATE !== 'sync';
routes.keepWarm(herGrid, () => player.groundSampler);
if (sliced) world.npcs.useRouteScheduler(routes);

/** The input surface the navigator and her body use, with no devices behind it — as `check:tap-dash` builds it. */
const input = {
  moveX: 0,
  moveY: 0,
  manualMoveActive: false,
  sprint: false,
  setNavigationMove(x: number, y: number): void {
    const length = Math.hypot(x, y);
    this.moveX = length > 1 ? x / length : x;
    this.moveY = length > 1 ? y / length : y;
  },
  setNavigationSprint(active: boolean): void {
    this.sprint = active;
  },
  isDown(action: string): boolean {
    return action === 'sprint' && this.sprint;
  },
  justPressed(): boolean {
    return false;
  },
  takeInteractPress(): boolean {
    return false;
  },
};
const navigator = quietly(() => new TapNavigator(player, camera, input as never, herGrid, () => Infinity, sliced ? routes : null));
navigator.throughDoorway = (x, y, z) => doorwayTapTarget(world.doorwayExits, x, y, z);
const strides = new FrameStrides();
strides.settleAt(DT);

// Two pets, bought as a child buys them, in her parade on her grid.
gameStore.hydrate({ v: SAVE_VERSION, at: 0, purchases: 0, game: {}, flags: {} });
gameStore.earn(1000);
for (const id of ['pet.bunny', 'pet.kitten']) {
  const spec = shopItem(id);
  if (!spec || gameStore.buy(spec).outcome !== 'kept') throw new Error(`check:nav-frame: could not buy ${id}`);
}
gameStore.setCarried(null);
const parade = quietly(() => new Parade(player as never, collision, camera));
park.scene.add(parade.group);
parade.setNavGrid(herGrid, sliced ? routes : null);

const context: FrameContext = {
  dt: DT,
  elapsed: 0,
  input: input as never,
  playerPosition: player.position,
  cameraForward: camera.forward,
  frame: 0,
};
camera.resize(390, 844);
camera.snapTo(player.position);
camera.update(context, player.position, player.velocity);

// ----------------------------------------------------------------- the frames

interface FrameRecord {
  readonly cpuMs: number;
  readonly wallMs: number;
  readonly phase: string;
  readonly parts: readonly string[];
}
const frames: FrameRecord[] = [];
let phase = 'cold';

let lastSpace = spaceAt(player.position.x, player.position.z);

/**
 * One frame, in `Game.tick`'s order. `between` is what a DOM event does before
 * it: its route-finding lands in this frame's interval and is counted here.
 * `during` runs where a crowd child's update does, after the frame's budget is
 * opened.
 */
const frame = (between?: () => void, during?: () => void): void => {
  frameCpuUs = 0;
  frameWallMs = 0;
  frameParts = [];
  if (between) quietly(between);
  routes.beginFrame();
  routes.run();
  context.dt = DT;
  context.elapsed += DT;
  context.frame += 1;
  if (during) quietly(during);
  quietly(() => world.update(context));
  quietly(() => strides.step(context, navigator, player, parade));
  quietly(() => parade.update(context));
  // Through a door: what `Game`'s `InteriorControls` do on the change of
  // space, which the harness's inert ones do not — drop the walk (`cancelWalk`)
  // and put the camera on her (`snapCamera`).
  const space = spaceAt(player.position.x, player.position.z);
  if (space !== lastSpace) {
    lastSpace = space;
    navigator.cancel();
    camera.snapTo(player.position);
  }
  camera.update(context, player.position, player.velocity, player.framePath);
  routes.endFrame();
  frames.push({ cpuMs: frameCpuUs / 1000, wallMs: frameWallMs, phase, parts: frameParts });
  verifyAnswers();
};

interface TapTrace {
  readonly what: string;
  readonly metres: number;
  setOff: number;
  routed: number;
}
const taps: TapTrace[] = [];

/**
 * A tap at a world point, between frames, and the frames after it until she
 * stops or `seconds` pass — recording when she set off and when her route
 * landed.
 */
const tapAndWalk = (what: string, x: number, z: number, seconds = 2.5, how: (x: number, y: number, z: number) => void = (tx, ty, tz) => navigator.navigateTo(tx, ty, tz)): TapTrace => {
  const fromX = player.position.x;
  const fromZ = player.position.z;
  const trace: TapTrace = { what, metres: Math.hypot(x - fromX, z - fromZ), setOff: -1, routed: -1 };
  taps.push(trace);
  frame(() => how(x, park.sample(x, z, TOP_REFERENCE), z));
  for (let i = 1; i <= Math.ceil(seconds / DT); i += 1) {
    if (trace.setOff < 0 && Math.hypot(player.position.x - fromX, player.position.z - fromZ) > 1e-3) trace.setOff = i;
    if (trace.routed < 0 && !navigator.routePending) trace.routed = i;
    if (!navigator.isNavigating && i > 1) break;
    frame();
  }
  return trace;
};

const relativeTap = (what: string, dx: number, dz: number, seconds?: number): TapTrace =>
  tapAndWalk(what, player.position.x + dx, player.position.z + dz, seconds);

// 1. Her lattice from cold — the cat-bus ride's work.
for (let i = 0; i < 4000 && !routes.isWarm(herGrid); i += 1) frame();
say(routes.isWarm(herGrid), `her park lattice was laid by the scheduler (${frames.length} frames)`);
const buildsBefore = {
  full: NAV_GRID_BUILDS.full,
  sliced: NAV_GRID_BUILDS.sliced,
  forced: NAV_GRID_BUILDS.forced,
  patched: NAV_GRID_BUILDS.patched,
  patchedCells: NAV_GRID_BUILDS.patchedCells,
};
NAV_GRID_BUILDS.worstPatchMs = 0;

// 2. Taps in the park.
phase = 'park taps';
relativeTap('near, 3 m', 3, 0);
relativeTap('near, 5 m', 0, -5);
relativeTap('middling, 18 m', 15, 10);
relativeTap('middling, 21 m', -20, 5);
relativeTap('far, 67 m', 60, -30);
relativeTap('far, 80 m', -70, 40);
// Onto a solid: just inside the castle's back wall — a goal no route can
// stand on, so the search floods everything it can reach, the most expensive
// question there is. The back wall, not the front: the closest she can get to
// a point by the front door is the door, and that walks her in.
const door = castleEntranceBand();
const wallX = BUILDING_CENTRE_X;
const wallZ = BUILDING_CENTRE_Z - BUILDING_HALF_Z + 1.5;
tapAndWalk('onto the castle wall', wallX, wallZ);
relativeTap('far, 82 m', 50, 65);

// 3. The whole crowd chooses somewhere new in the same frame.
phase = 'crowd';
const characters = (world.npcs as unknown as { characters: { driver: { finishedIndoors?: () => void } }[] }).characters;
let told = 0;
for (const character of characters) {
  if (typeof character.driver.finishedIndoors === 'function') {
    character.driver.finishedIndoors();
    told += 1;
  }
}
say(told >= 10, `the crowd storm reached ${told} children — otherwise it plans nothing`);
for (let i = 0; i < 600; i += 1) frame();

// 4. In through the castle's front door, a child's first plan on the mall, taps inside.
phase = 'castle';
tapAndWalk('to the castle door', door.centreX, door.centreZ, 25);
for (let i = 0; i < 1200 && spaceAt(player.position.x, player.position.z) === SPACE_GARDEN; i += 1) frame();
const inCastle = spaceAt(player.position.x, player.position.z) === CASTLE_MALL.space;
say(inCastle, `she walked into the castle mall (${spaceAt(player.position.x, player.position.z)})`);
const planner = (world.npcs as unknown as { planner: { beginFrame: () => void; plan: (...args: unknown[]) => number } }).planner;
const childRoute = new Float32Array(256);
let childPlanned = -1;
let childFrames = 0;
const [cax, caz, cbx, cbz] = [CASTLE_MALL.originX - 9, CASTLE_MALL.originZ - 6, CASTLE_MALL.originX + 10, CASTLE_MALL.originZ + 8];
for (let i = 0; i < 3000 && childPlanned < 0; i += 1) {
  frame(undefined, () => {
    // Asked as a child asks it, every frame until answered — with the
    // frame's plan slots handed out first, as `NpcSystem` hands them out.
    planner.beginFrame();
    childPlanned = planner.plan(CASTLE_MALL.space, cax, caz, park.sample(cax, caz, TOP_REFERENCE), cbx, cbz, park.sample(cbx, cbz, TOP_REFERENCE), childRoute);
  });
  childFrames += 1;
}
say(childPlanned > 0, `a crowd child's first plan on the mall was answered (${childPlanned} waypoints, ${childFrames} frame(s))`);
if (inCastle) {
  relativeTap('mall, 4 m', 4, 0);
  relativeTap('mall, 12 m', -10, 6);
  relativeTap('mall, 15 m', 12, -9);
  relativeTap('mall, 19 m', -15, -12);
}

// 5. A tap on the mall's way out, through the real tap path.
phase = 'doorway';
const exit = world.doorwayExits.find((candidate) => candidate.band.what.includes('castle'));
let walkedOut = false;
if (inCastle && exit) {
  const o = exit.placed.frame.opening;
  const x = exit.placed.originX + (o.minX + o.maxX) / 2;
  const z = exit.placed.originZ + o.z;
  const y = exit.placed.originY + o.floorY;
  // Walk to within a few metres first, so the opening is on screen.
  tapAndWalk('towards the way out', x, z - Math.sign(o.z || 1) * 4, 6);
  camera.snapTo(player.position);
  camera.update(context, player.position, player.velocity);
  camera.camera.updateMatrixWorld();
  const onScreen = new Vector3(x, y, z).project(camera.camera);
  const point: TapPoint = { ndcX: onScreen.x, ndcY: onScreen.y, doubleTap: false };
  let found = false;
  tapAndWalk('the way out, by its own tap path', x, z, 8, () => {
    found = navigator.handleTap(point);
  });
  say(found, `the tap on the way out found somewhere to walk (ndc ${onScreen.x.toFixed(2)}, ${onScreen.y.toFixed(2)})`);
  for (let i = 0; i < 1500 && spaceAt(player.position.x, player.position.z) !== SPACE_GARDEN; i += 1) frame();
  walkedOut = spaceAt(player.position.x, player.position.z) === SPACE_GARDEN;
}
say(walkedOut, `the doorway tap walked her out of the castle (${exit ? exit.band.what : 'no castle exit found'})`);

// 6. Taps in the park the moment she is back: her park lattice comes off the
// shelf it was put on at the door, patched, rather than laid again.
phase = 'back in the park';
const unshelvedBefore = NAV_GRID_BUILDS.unshelved;
relativeTap('just out, 6 m', 0, 6);
const cameDown = NAV_GRID_BUILDS.unshelved - unshelvedBefore;
say(!walkedOut || cameDown === 1, `back in the park, her park lattice came off the shelf (${cameDown} time(s)) rather than being laid again`);
relativeTap('just out, 40 m', -30, 26);
tapAndWalk('just out, onto the castle wall', wallX, wallZ);

// 7. Until nothing is left to answer.
phase = 'drain';
let drained = 0;
for (; drained < 2400 && routes.pendingCount > 0; drained += 1) frame();
for (let i = 0; i < 120; i += 1) frame();

// ------------------------------------------------------------------- verdicts

// Her first lattice from cold is the cat-bus ride's work, laid behind the bus
// by code running for the first time in the process — the JIT's first pass,
// which no frame of play repeats. Reported, not held to the limit.
const played = frames.filter((f) => f.phase !== 'cold');
const coldWorst = Math.max(0, ...frames.filter((f) => f.phase === 'cold').map((f) => f.cpuMs));
const worst = played.reduce((a, b) => (b.cpuMs > a.cpuMs ? b : a), played[0] ?? { cpuMs: 0, wallMs: 0, phase: 'none', parts: [] });
const sortedCpu = played.map((f) => f.cpuMs).sort((a, b) => a - b);
const p99 = sortedCpu[Math.floor(sortedCpu.length * 0.99)] ?? 0;
const over = played.filter((f) => f.cpuMs > FRAME_LIMIT_MS);
const overBudget = played.filter((f) => f.cpuMs > NAV_WARM_BUDGET_MS).length;
const worstWall = Math.max(...played.map((f) => f.wallMs));
say(
  played.length > 1000 && over.length === 0,
  `no frame of play spent more than ${FRAME_LIMIT_MS} ms of CPU finding its way: worst ${worst.cpuMs.toFixed(2)} ms (${worst.phase}), p99 ${p99.toFixed(2)} ms, ` +
    `${over.length} over the limit, ${overBudget} over the ${NAV_WARM_BUDGET_MS} ms budget, of ${played.length} frames`,
);
note(
  `NOT asserted: her first lattice from cold (the bus ride's work, first-run JIT) — worst frame ${coldWorst.toFixed(2)} ms CPU over ${frames.length - played.length} frames; ` +
    `garbage collections inside route-finding calls, taken off them: ${(gcInNavUs / 1000).toFixed(1)} ms in all, worst ${worstGcInNavMs.toFixed(2)} ms in one call`,
);
note(`wall clock (reported, not asserted): worst frame ${worstWall.toFixed(2)} ms of route-finding; scheduler: ${JSON.stringify(routes.stats)}`);
const byPhase = new Map<string, number>();
for (const f of frames) byPhase.set(f.phase, Math.max(byPhase.get(f.phase) ?? 0, f.cpuMs));
note(`worst frame by phase (CPU ms): ${[...byPhase.entries()].map(([p, ms]) => `${p} ${ms.toFixed(2)}`).join(', ')}`);
for (const f of [...frames].sort((a, b) => b.cpuMs - a.cpuMs).slice(0, 6)) note(`  a worst frame: ${f.cpuMs.toFixed(2)} ms CPU (${f.phase}): ${f.parts.join(', ') || 'calls under 0.5 ms each'}`);

say(
  compared > 0 && mismatches.length === 0,
  `every answer is the whole search's route, float for float (${compared} compared, ${uncomparable} whose lattice had moved on before they could be)${mismatches.length ? `: ${mismatches.join(' | ')}` : ''}`,
);
if (!sliced) note('no route went through the scheduler (sync), so the comparison above compared nothing');

say(routes.pendingCount === 0, `nothing was left waiting (${routes.pendingCount} pending after ${drained} drain frames)`);

const sliceBuilt = NAV_GRID_BUILDS.sliced - buildsBefore.sliced;
note(
  `NOT asserted: patches (a collider came or went) are still done in one go inside a warm — ${NAV_GRID_BUILDS.patched - buildsBefore.patched} this session, ` +
    `${NAV_GRID_BUILDS.patchedCells - buildsBefore.patchedCells} cells redone in all, worst ${NAV_GRID_BUILDS.worstPatchMs.toFixed(2)} ms (wall). A burst of colliders in one ` +
    `place is one patch; 24 dropped at once in the park cost ~17 ms (Node, 13 Nov). Counted in the frame limit above whenever one lands in the session.`,
);
const forced = NAV_GRID_BUILDS.forced - buildsBefore.forced;
say(
  oneTaskBuilds === 0 && forced === 0 && sliceBuilt >= 1,
  `after her first lattice: ${sliceBuilt} lattice(s) laid in slices, ${oneTaskBuilds} laid whole in one task${oneTaskWhat.length ? ` (${oneTaskWhat.join(', ')})` : ''}, ` +
    `${forced} half-laid one finished in one go — must be 0 and 0, with at least 1 sliced`,
);
note(
  `NOT asserted: the put-down rule's windows (world/dismount.ts) — ${windowCalls} call(s), ${(windowCpuUs / 1000).toFixed(1)} ms in all, ` +
    `worst ${worstWindowMs.toFixed(2)} ms in one call; each is laid whole when she is set down (a door, a wedge rescue). Not route search; not this check's.`,
);

const late = taps.filter((t) => t.setOff < 0 || t.setOff > SET_OFF_FRAMES);
say(late.length === 0, `she set off within ${SET_OFF_FRAMES} frames of every tap (${taps.length} taps)${late.length ? `; late: ${late.map((t) => `${t.what} ${t.setOff}`).join(', ')}` : ''}`);
note(`taps — frames until she moved / until her route landed: ${taps.map((t) => `${t.what} (${t.metres.toFixed(0)} m) ${t.setOff}/${t.routed}`).join('; ')}`);

// ------------------------------------------------------------------ the shelf

// Her grid puts the park's lattice on a shelf when she walks into a room and
// takes it down when she walks out (`NavGrid`'s `shelf`). Proved here, after
// the session so its colliders cannot touch the session's lattices, on a
// still world — nothing stepped, so nothing moves under the comparison: a
// lattice of the park, a room's lattice laid over it (the park's shelved),
// colliders dropped in the park while she is "in the room", and the park's
// taken down again and patched. It must come down rather than be laid again,
// see the dropped colliders, and equal a whole rebuild cell for cell. (On a
// running world no lattice equals a whole rebuild for long, shelved or not: a
// moving collider — the train — never bumps the revision, so the cells it
// crosses keep the levels they had when laid. Measured on a lattice that never
// left the park: cell 127,221 differs after 20 s of world.update. That is
// step 1's rule for moving colliders, not the shelf's.)
{
  const twin = playerNavGrid(world);
  const parkBounds = collision.playBounds;
  const sample = player.groundSampler;
  if (!sample) throw new Error('check:nav-frame: no ground sampler to lay a lattice with');
  paused += 1;
  while (!twin.warm(sample, 50));
  const before = { unshelved: NAV_GRID_BUILDS.unshelved, full: NAV_GRID_BUILDS.full, mismatches: NAV_GRID_BUILDS.mismatches.length };
  const blockedBefore = (twin as unknown as { blocked: Uint8Array }).blocked.slice();
  collision.setPlayBounds(castleFloorBounds(CASTLE_MALL));
  while (!twin.warm(sample, 50));
  const dropped = Array.from({ length: 24 }, (_, i) => collision.addCircle((i % 6) * 5 - 12, Math.floor(i / 6) * 5 - 20, 1));
  collision.setPlayBounds(parkBounds);
  const wholeBefore = NAV_GRID_BUILDS.full;
  while (!twin.warm(sample, 50));
  const cameDownHere = NAV_GRID_BUILDS.unshelved - before.unshelved;
  const laidAgain = NAV_GRID_BUILDS.full - wholeBefore;
  const blockedAfter = (twin as unknown as { blocked: Uint8Array }).blocked;
  let seen = 0;
  for (let i = 0; i < blockedAfter.length; i += 1) if (blockedAfter[i] !== blockedBefore[i]) seen += 1;
  (twin as unknown as { verifyAgainstWhole(boundary: unknown, sample: unknown): void }).verifyAgainstWhole(parkBounds, sample);
  const differs = NAV_GRID_BUILDS.mismatches.slice(before.mismatches);
  for (const id of dropped) collision.removeCircle(id);
  paused -= 1;
  say(
    cameDownHere === 1 && laidAgain === 0 && differs.length === 0,
    `the shelf: back from a room, her park lattice came off the shelf (${cameDownHere}), was laid again ${laidAgain} time(s), and equals a whole rebuild` +
      (differs.length ? `: ${differs.slice(0, 2).join(' | ')}` : ''),
  );
  say(seen > 0, `CONTROL: the ${dropped.length} colliders dropped in the park while she was "in the room" are in the lattice that came down (${seen} cells changed) — the comparison above can see a change`);
}

// ------------------------------------------------------------------ the control

// Today's code under the same instrument: a navigator with no scheduler plans
// every route whole, in the frame that asks. It must be seen.
phase = 'control';
navigator.cancel();
quietly(() => player.teleport(2, 6));
for (let i = 0; i < 4; i += 1) frame();
const control = quietly(() => new TapNavigator(player, camera, input as never, herGrid, () => Infinity, null));
const controlFrames: number[] = [];
const controlTap = (x: number, z: number): void => {
  navigator.cancel();
  frameCpuUs = 0;
  frameWallMs = 0;
  quietly(() => control.navigateTo(x, park.sample(x, z, TOP_REFERENCE), z));
  controlFrames.push(frameCpuUs / 1000);
  note(`control tap from (${player.position.x.toFixed(1)}, ${player.position.z.toFixed(1)}) to (${x.toFixed(1)}, ${z.toFixed(1)}): ${(frameCpuUs / 1000).toFixed(2)} ms, ${(control as unknown as { routeLength: number }).routeLength} waypoints, navigating ${control.isNavigating}`);
  control.cancel();
};
controlTap(wallX, wallZ);
controlTap(player.position.x + 60, player.position.z - 30);
const controlWorst = Math.max(...controlFrames);
say(
  controlWorst > FRAME_LIMIT_MS,
  `CONTROL: the same instrument round today's whole-route navigator sees ${controlFrames.map((ms) => ms.toFixed(1)).join(' and ')} ms in one frame — over the ${FRAME_LIMIT_MS} ms limit, so the limit can be seen`,
);

for (const name of methods) navProto[name] = original[name] as (...args: unknown[]) => unknown;

if (failures > 0) {
  console.error(`check:nav-frame: ${failures} failure(s)`);
  process.exit(1);
}
console.log('check:nav-frame passed');
