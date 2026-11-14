/**
 * **`check:undrawn-still` — nothing that is not drawn is animated** (120 fps
 * plan, steps 2 and 3; `docs/perf/FRAME-DROPS-2026-11.md`).
 *
 * ```
 * pnpm run check:undrawn-still              # in the check chain (a node shard)
 * pnpm run check:undrawn-still -- --mutate  # prove it can go red
 * MEASURE=1 pnpm run check:undrawn-still    # print what moved, assert nothing
 * ```
 *
 * ## Why this exists
 *
 * The target is 120 fps, 8.3 ms a frame (CLAUDE.md). Every space but the one
 * she stands in is out of the scene graph (`world/DrawnSpaces.ts`), and the
 * rule for what may run in it is the same one: **a frame that changes
 * something nobody can see did work nobody can see.** The plan's profile found
 * most of a millisecond of every park frame posing a banquet nobody could see;
 * this branch's found the whole park — its crowd, its train, its rides, its
 * fountain and flowers — simulated for a child standing in a hotel lobby six
 * hundred metres away, ~0.7 ms of a 4.7 ms frame on the M4 Pro.
 *
 * Wall-clock time cannot be asserted in CI (a software rasteriser's timings
 * describe nothing), but **this** can be asserted exactly, on any machine. So
 * this counts it.
 *
 * ## What is measured
 *
 * The real `World` (`park-harness.mts`) and a real `Player`, stepped through
 * the real `world.update` at 1/60:
 *
 * 1. **The garden** — where she spends most of a session, and where every
 *    interior is undrawn.
 * 2. **Every room**, walked into through its own door code and out again the
 *    way its door lets her out: the hotel lobby, the library, the Reptile
 *    House, the castle's mall, great hall and roof. In each, the park is
 *    undrawn too (`World.parkRoots`, the park's groups, hidden whole by
 *    `DrawnSpaces.showSpace`).
 *
 * Every frame, every object with an **invisible ancestor** — a space's root,
 * written `visible = false` by its owner or hidden with its whole space
 * (headless, a hidden space stays in the one graph; `DrawnSpaces` only
 * detaches in the live game) — is compared with
 * itself a frame earlier: position, rotation, scale, and for an `InstancedMesh`
 * its instance buffer's `version`. An object appearing under a hidden ancestor
 * counts too. Each change is attributed to the named group it happened under,
 * so a red run says *what* is still running.
 *
 * **The crowd is measured separately**, because its group is never hidden:
 * it is everywhere the crowd is (`World.parkRoots`' note). In a room the crowd
 * never visits, its instance buffers must not be rewritten at all — every
 * child of it is held still (`NpcSystem.crowdLiveAt`).
 *
 * ## What may move where nobody can see it, and why
 *
 * **In the castle's mall only: the train.** The mall's shoppers come in from
 * the garden, so the crowd lives while she shops (`NpcSystem.crowdLiveAt`),
 * and the train its children ride and queue for keeps the crowd's hours —
 * held still under a living crowd, its platforms would fill. Printed on every
 * run, with how much moved, so an exemption cannot widen in silence.
 *
 * ## The controls
 *
 * A check that reads zero must be shown able to read something else:
 *
 * 1. **The great hall, drawn** — the diners must move on every frame.
 * 2. **The roof, drawn** — the wild pets are already out on the first frame
 *    (`WildPets.catchUp`: the roof "was already going") and move after it.
 * 3. **The mall** — the crowd's buffers must be rewritten: the crowd probe
 *    can read a living crowd, and the mall keeps its shoppers.
 * 4. **Back in the garden** — the park must move again within a few frames,
 *    and the crowd with it: the instrument can see the park move, and the
 *    park comes back.
 *
 * ## Proving it red
 *
 * `--mutate` puts back the shape before step 3 by changing nothing in the
 * shipping code but the two questions every gate asks, and calling the gated
 * animation from here: `World.parkDrawn` answers yes everywhere, the crowd
 * lives everywhere, and the banquet, the wild pets and the hotel's rooms are
 * animated every frame wherever she is.
 *
 * Proved against: seed 5 hydrated from its prebuilt file, `perf/undrawn-indoors`
 * at 96cfe195 (the park as sixteen `garden` roots, each group its own), she
 * stands at the entrance spot (`ENTRANCE_PLAYER_X/Z`), 600 garden frames, 240
 * in each room, 14 Nov 2026. Green (exit 0), then `--mutate` (exit 1):
 *
 * ```
 * garden (garden), 600 frames, 6534 objects under a hidden ancestor: undrawn object-changes 0, on 0 of 600 frames
 * hotel lobby (hotel.lobby), 240 frames, 5707 objects under a hidden ancestor: undrawn object-changes 0, on 0 of 240 frames
 *   the crowd's buffers rewritten on 0 of 240 frames; the train still
 * … library, reptile house, castle great hall and roof the same; the mall:
 *   exempt in castle mall: the train, which the crowd living here rides — 5520 object-changes under it, the crowd rewritten on 240 of 240 frames
 * control 4, back in the garden: 10620 changes under the park's 16 groups in 60 frames, the crowd rewritten on 60, the train moved 4.00 m
 *
 * --mutate:
 * garden: 43542 changes to objects in spaces that are not drawn, on 600 of 600 frames
 *       7200  the-big-building-inside: building-shell-floor-1 > great-hall-diners-1 > crowd:BufferGeometry
 *       2400  the-land-hotel-inside: the-land-hotel-inside > kid > body
 * hotel lobby: 58350 changes to objects that are not drawn, on 240 of 240 frames
 *       6000  fairy-lights: fairy-lights > fairy-bulbs:tiles > fairy-bulbs
 *       5280  anchor-plots: anchor-plots > anchor:dodgems > dodgems:ride
 * hotel lobby: the crowd's instance buffers were rewritten on 240 of 240 frames
 * hotel lobby: the train moved from 44.32 to 60.32 m along its loop while nobody could see it
 * … and the same three for the library (60652 changes) and the reptile house (60338);
 * castle great hall: 43539 changes, the crowd rewritten, the train moved 108.66 -> 110.56 m;
 * castle mall: 52923 changes; castle roof: 52551 changes and the crowd rewritten (the
 * train stood at a platform through those 240 frames, so only the crowd caught it there).
 * ```
 *
 * The first proof (ce7f6f3d, 13 Nov, the park under one `the-park` root) read
 * the same totals; only the attribution of the park's changes moved, from
 * `the-park: fairy-lights > …` to `fairy-lights: …`, and the lobby's count of
 * objects under a hidden ancestor fell by the sixteen groups themselves (5723
 * then, each group now the hidden root rather than under one).
 *
 * Two gates the mutation does not reach, because nothing outside the class can
 * call round them, were found by this instrument before they existed (same
 * seed and spot, the commit before ce7f6f3d): **Sunny's head in the park**,
 * 240 changes in every room's 240 frames under
 * `the-reptile-house-outside > reptileHouse.exterior > rh-head-pivot`,
 * and **the castle's grown-up**, 1242 in the garden and 494 in every room
 * under `the-big-building-inside > grown-up`. Both read 0 with their gates.
 */
import './headless-canvas.mjs';
import { InstancedMesh, type Mesh, Object3D, Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { saveFlags } from '../src/state/flags.ts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { Player } from '../src/entities/Player.ts';
import { CASTLE_ROOF } from '../src/world/building/floors.ts';
import { CASTLE_GREAT_HALL_DECK } from '../src/world/building/castleFurniture.ts';
import { banquetGroupName, type GreatHallBanquet } from '../src/world/building/greatHallBanquet.ts';
import type { WildPets } from '../src/world/building/WildPets.ts';
import { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../src/world/entrance/layout.ts';
import { spaceAt } from '../src/world/spaces.ts';
import type { FrameContext } from '../src/core/types.ts';

const mutate = process.argv.includes('--mutate');
const MEASURE = process.env['MEASURE'] === '1';
const DT = 1 / 60;
/** Frames before the first comparison: the park's own first-frame settling. */
const WARM_FRAMES = 30;
/** Ten seconds in the garden. */
const GARDEN_FRAMES = Number(process.env['FRAMES'] ?? 600);
/** Four seconds in each room. */
const ROOM_FRAMES = Number(process.env['ROOM_FRAMES'] ?? 240);
/** Frames for each control. */
const CONTROL_FRAMES = 60;

// No cat bus: she is standing in the park, as a returning save or a deep link has her.
saveFlags.markArrived();
const park = quietly(() => buildHeadlessPark());
const { world, scene, camera } = park;
const building = world.building as unknown as {
  banquet: GreatHallBanquet;
  wildPets: WildPets;
  spaces: { changeTo(midpoint: () => void): void };
  leaveInterior(): void;
};
const wildPets = building.wildPets as unknown as { root: Object3D; live: unknown[] };
const hotelInterior = (): { animate(context: FrameContext): void; leaveToPark(): void } | null =>
  (world.hotel as unknown as { interior: { animate(context: FrameContext): void; leaveToPark(): void } | null }).interior;

const input = new InputSystem();
const player = quietly(() => new Player(world.collision, camera, new Vector3(ENTRANCE_PLAYER_X, 0, ENTRANCE_PLAYER_Z)));
scene.add(player.group);
quietly(() => world.attachPlayer(player));
const standInPark = (): void => {
  player.teleportTo(ENTRANCE_PLAYER_X, world.building.surfaces.sample(ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z, 3), ENTRANCE_PLAYER_Z, 0);
};
standInPark();

if (mutate) {
  // The park before step 3: every park updater and the whole crowd, every
  // frame, wherever she is. Only the questions change; the gates are the
  // shipping code's.
  Object.defineProperty(world, 'parkDrawn', { get: () => true });
  world.npcs.crowdLiveAt = () => true;
}

const cameraForward = new Vector3(0, 0, 1);
let frame = 0;
const step = (): void => {
  const context: FrameContext = { dt: DT, elapsed: frame * DT, input, playerPosition: player.position, cameraForward, frame };
  // The camera breathes in and out a little every frame, as a child's pinches
  // and the camera's own follow keep it doing: anything that re-sizes itself
  // to the screen for a space nobody can see (a name pill, a bubble) moves,
  // and is counted. A camera standing dead still would hide all of it.
  camera.snapTo(player.position);
  camera.snapZoomTarget(1 + 0.15 * Math.sin(frame * 0.05));
  quietly(() => {
    world.update(context);
    // …and the labels decided after every system, as `Game.tick` does.
    world.labels.resolve({ camera: camera.camera, width: 1280, height: 720 }, DT);
    if (mutate) {
      building.banquet.update(context.elapsed);
      building.wildPets.update(context);
      hotelInterior()?.animate(context);
    }
  });
  frame += 1;
};

// ------------------------------------------------------------- the instrument

/** Ten numbers per object: position, quaternion, scale. */
const STRIDE = 10;
const last = new Map<Object3D, Float64Array>();
const lastVersion = new Map<Object3D, number>();

/** The nearest few names above an object, so a change is attributed to something a person can find. */
function label(object: Object3D): string {
  const names: string[] = [];
  for (let o: Object3D | null = object; o && names.length < 3; o = o.parent) {
    if (o.name) names.unshift(o.name);
  }
  return names.join(' > ') || object.type;
}

/** The highest hidden ancestor's name — the space an object is undrawn in. */
function hiddenSpace(object: Object3D): string {
  let found = '';
  for (let o: Object3D | null = object.parent; o && o !== scene; o = o.parent) {
    if (!o.visible) found = o.name || o.type;
  }
  return found;
}

/** What a control watches: a root, the group of that name, or any of several roots (the park's). */
type Watched = Object3D | string | readonly Object3D[];

/** True when `object` sits under `root`, under the group named `root`, or under any of the roots listed. */
function under(object: Object3D, root: Watched): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) {
    if (typeof root === 'string' ? o.name === root : Array.isArray(root) ? root.includes(o) : o === root) return true;
  }
  return false;
}

interface Sweep {
  /** Objects under an invisible ancestor this frame. */
  readonly undrawn: number;
  /** Undrawn objects that changed since the last sweep, by space and label. */
  readonly changedUndrawn: Map<string, number>;
  /** Undrawn objects that changed under an exempt root (see the header). */
  readonly changedExempt: number;
  /** Drawn objects under the watched group or root that changed — the controls' reading. */
  readonly changedWatched: number;
}

/**
 * Walks the scene once, carrying "an ancestor is hidden" down the tree, and
 * compares every object with its snapshot from the previous sweep. Every
 * snapshot is refreshed, drawn or not, so an object that has just become
 * undrawn is compared against where it really was.
 */
function sweep(watch: Watched | null = null, exempt: readonly Object3D[] = []): Sweep {
  const changedUndrawn = new Map<string, number>();
  let changedWatched = 0;
  let changedExempt = 0;
  let undrawn = 0;
  const visit = (object: Object3D, ancestorHidden: boolean): void => {
    let snap = last.get(object);
    const fresh = snap === undefined;
    if (!snap) {
      snap = new Float64Array(STRIDE);
      last.set(object, snap);
    }
    const p = object.position;
    const q = object.quaternion;
    const s = object.scale;
    let changed =
      fresh ||
      snap[0] !== p.x || snap[1] !== p.y || snap[2] !== p.z ||
      snap[3] !== q.x || snap[4] !== q.y || snap[5] !== q.z || snap[6] !== q.w ||
      snap[7] !== s.x || snap[8] !== s.y || snap[9] !== s.z;
    snap[0] = p.x; snap[1] = p.y; snap[2] = p.z;
    snap[3] = q.x; snap[4] = q.y; snap[5] = q.z; snap[6] = q.w;
    snap[7] = s.x; snap[8] = s.y; snap[9] = s.z;
    // Buffers rewritten count too: an instance buffer (`InstancedCrowd.flush`,
    // a twinkling string's colours) or a vertex buffer (the fountain's
    // ripples). Versions only ever grow, so their sum moves when any one does.
    const mesh = object as Partial<Mesh> & { instanceColor?: { version: number } | null };
    if (mesh.isMesh === true && mesh.geometry) {
      let version = mesh.geometry.getAttribute('position')?.version ?? 0;
      if (object instanceof InstancedMesh) version += object.instanceMatrix.version + (object.instanceColor?.version ?? 0);
      if (lastVersion.get(object) !== version) changed = true;
      lastVersion.set(object, version);
    }
    if (ancestorHidden) {
      undrawn += 1;
      if (changed) {
        if (exempt.some((root) => under(object, root))) {
          changedExempt += 1;
        } else {
          const key = `${hiddenSpace(object)}: ${label(object)}`;
          changedUndrawn.set(key, (changedUndrawn.get(key) ?? 0) + 1);
        }
      }
    }
    if (changed && watch !== null && under(object, watch) && !ancestorHidden) changedWatched += 1;
    const hidden = ancestorHidden || !object.visible;
    for (const child of object.children) visit(child, hidden);
  };
  for (const child of scene.children) visit(child, false);
  return { undrawn, changedUndrawn, changedExempt, changedWatched };
}

/** Every instance buffer the crowd draws its children and their pets with. */
const crowdMeshes: InstancedMesh[] = [];
world.npcs.group.traverse((object) => {
  if (object instanceof InstancedMesh) crowdMeshes.push(object);
});
const crowdVersions = new Map<InstancedMesh, number>();
/** How many of the crowd's instance buffers were rewritten since the last call. */
function crowdRewrites(): number {
  let rewritten = 0;
  for (const mesh of crowdMeshes) {
    const version = mesh.instanceMatrix.version;
    if (crowdVersions.has(mesh) && crowdVersions.get(mesh) !== version) rewritten += 1;
    crowdVersions.set(mesh, version);
  }
  return rewritten;
}

const failures: string[] = [];
const check = (ok: boolean, message: string): void => {
  if (!ok) failures.push(message);
};
const report = (heading: string, totals: Map<string, number>, frames: number, changedFrames: number): number => {
  const changedTotal = [...totals.values()].reduce((a, b) => a + b, 0);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`${heading}: undrawn object-changes ${changedTotal}, on ${changedFrames} of ${frames} frames${ranked.length === 0 ? '' : ', by space and group:'}`);
  for (const [key, n] of ranked.slice(0, 12)) console.log(`  ${String(n).padStart(8)}  ${key}`);
  return changedTotal;
};

/** Steps `frames` frames, sweeping each, and returns what changed where nobody could see it. */
function measure(frames: number, exempt: readonly Object3D[] = []): { totals: Map<string, number>; changedFrames: number; exempt: number; undrawn: number; crowd: number } {
  const totals = new Map<string, number>();
  let changedFrames = 0;
  let exemptChanges = 0;
  let undrawn = 0;
  let crowd = 0;
  for (let i = 0; i < frames; i += 1) {
    step();
    const result = sweep(null, exempt);
    undrawn = Math.max(undrawn, result.undrawn);
    exemptChanges += result.changedExempt;
    if (result.changedUndrawn.size > 0) changedFrames += 1;
    for (const [key, n] of result.changedUndrawn) totals.set(key, (totals.get(key) ?? 0) + n);
    if (crowdRewrites() > 0) crowd += 1;
  }
  return { totals, changedFrames, exempt: exemptChanges, undrawn, crowd };
}

if (mutate) console.log('--mutate: the park and its crowd updated wherever she is, the banquet, the wild pets and the hotel animated every frame — as before step 3\n');
// What this cannot see, said on every run (CLAUDE.md, "a check can pass
// without checking anything"): it reads transforms and buffers, so a system
// that only writes a material (a light's intensity, an emissive colour) or a
// label's screen size for a space nobody can see is invisible to it.
process.stderr.write('undrawn-still: not measured — material and uniform writes (light intensities, colours) and label sizing; transforms and vertex/instance buffers only\n');

// ------------------------------------------------------------------- garden

for (let i = 0; i < WARM_FRAMES; i += 1) step();
sweep(); // the baseline every later sweep compares against
crowdRewrites();
{
  const garden = measure(GARDEN_FRAMES);
  const total = report(`garden (${spaceAt(player.position.x, player.position.z)}), ${GARDEN_FRAMES} frames, ${garden.undrawn} objects under a hidden ancestor`, garden.totals, GARDEN_FRAMES, garden.changedFrames);
  check(garden.undrawn > 1000, `only ${garden.undrawn} objects were under a hidden ancestor in the garden — the interiors are not where this check thinks, so its zero would mean nothing`);
  check(total === 0, `the garden: ${total} changes to objects in spaces that are not drawn, on ${garden.changedFrames} of ${GARDEN_FRAMES} frames — gate it on \`isDrawn\` (src/core/drawn.ts)`);
}

// -------------------------------------------------------------------- rooms

interface Room {
  readonly name: string;
  readonly enter: () => boolean;
  readonly leave: () => void;
  /** The crowd lives here (`NpcSystem.crowdLiveAt`), and with it the train. */
  readonly crowdLives: boolean;
}

const leaveCastle = (): void => building.spaces.changeTo(() => building.leaveInterior());
const rooms: Room[] = [
  {
    name: 'hotel lobby',
    enter: () => world.hotel.requestEnterLobby(),
    leave: () => hotelInterior()?.leaveToPark(),
    crowdLives: false,
  },
  {
    name: 'library',
    enter: () => world.library.requestEnter(),
    leave: () => (world.library as unknown as { standOutside(facing: number): void }).standOutside(0),
    crowdLives: false,
  },
  {
    name: 'reptile house',
    enter: () => world.reptileHouse.requestEnter(),
    leave: () => (world.reptileHouse as unknown as { leaveToOutside(): void }).leaveToOutside(),
    crowdLives: false,
  },
  { name: 'castle mall', enter: () => world.building.enterCastleSpawn(0), leave: leaveCastle, crowdLives: true },
  { name: 'castle great hall', enter: () => world.building.enterCastleSpawn(CASTLE_GREAT_HALL_DECK), leave: leaveCastle, crowdLives: false },
  { name: 'castle roof', enter: () => world.building.enterCastleSpawn(CASTLE_ROOF.index), leave: leaveCastle, crowdLives: false },
];

const train = world.train as unknown as { group: Object3D; distance: number };
let mallCrowdFrames = 0;
for (const room of rooms) {
  const entered = quietly(() => room.enter());
  check(entered, `${room.name}: its door refused her — the room cannot be measured`);
  step(); // the door's midpoint has run; she is in the room
  const space = spaceAt(player.position.x, player.position.z);
  sweep();
  crowdRewrites();
  const trainAt = train.distance;
  const exempt = room.crowdLives ? [train.group] : [];
  const result = measure(ROOM_FRAMES, exempt);
  const total = report(`${room.name} (${space}), ${ROOM_FRAMES} frames, ${result.undrawn} objects under a hidden ancestor`, result.totals, ROOM_FRAMES, result.changedFrames);
  check(world.parkDrawn === false || mutate, `${room.name}: the park still says it is drawn while she is in '${space}'`);
  check(result.undrawn > 1000, `${room.name}: only ${result.undrawn} objects under a hidden ancestor — the park and the other rooms are not where this check thinks`);
  check(total === 0, `${room.name}: ${total} changes to objects that are not drawn, on ${result.changedFrames} of ${ROOM_FRAMES} frames — gate it on \`isDrawn\` (src/core/drawn.ts)`);
  if (room.crowdLives) {
    process.stderr.write(`  exempt in ${room.name}: the train, which the crowd living here rides — ${result.exempt} object-changes under it, the crowd rewritten on ${result.crowd} of ${ROOM_FRAMES} frames\n`);
    mallCrowdFrames = result.crowd;
  } else {
    console.log(`  the crowd's buffers rewritten on ${result.crowd} of ${ROOM_FRAMES} frames; the train ${train.distance === trainAt ? 'still' : `moved ${(train.distance - trainAt).toFixed(2)} m`}`);
    check(result.crowd === 0, `${room.name}: the crowd's instance buffers were rewritten on ${result.crowd} of ${ROOM_FRAMES} frames — a crowd that never comes in here is being simulated`);
    check(train.distance === trainAt, `${room.name}: the train moved from ${trainAt.toFixed(2)} to ${train.distance.toFixed(2)} m along its loop while nobody could see it`);
  }
  quietly(() => room.leave());
  step();
  check(spaceAt(player.position.x, player.position.z) === 'garden', `${room.name}: leaving put her in '${spaceAt(player.position.x, player.position.z)}', not the garden`);
}

// ------------------------------------------------------------- the controls

// 1. The great hall: the diners are drawn and must be posed.
const hall = banquetGroupName(CASTLE_GREAT_HALL_DECK);
check(quietly(() => world.building.enterCastleSpawn(CASTLE_GREAT_HALL_DECK)), 'the great hall refused her — control 1 cannot run');
step();
sweep();
let hallChanged = 0;
let hallFrames = 0;
for (let i = 0; i < CONTROL_FRAMES; i += 1) {
  step();
  const result = sweep(hall);
  hallChanged += result.changedWatched;
  if (result.changedWatched > 0) hallFrames += 1;
}
console.log(`control 1, the great hall drawn: ${hallChanged} changes under ${hall}, on ${hallFrames} of ${CONTROL_FRAMES} frames`);
check(
  hallFrames === CONTROL_FRAMES,
  `in the great hall, drawn, the diners changed on only ${hallFrames} of ${CONTROL_FRAMES} frames — ` +
    'either the banquet is not being posed where she can see it, or this instrument cannot see it being posed',
);

// 2. The roof: lived in arrears, so already out on the first frame.
check(quietly(() => world.building.enterCastleSpawn(CASTLE_ROOF.index)), 'the roof refused her — control 2 cannot run');
step();
const outOnArrival = wildPets.live.length;
sweep();
let roofChanged = 0;
for (let i = 0; i < CONTROL_FRAMES; i += 1) {
  step();
  roofChanged += sweep(wildPets.root).changedWatched;
}
console.log(`control 2, the roof drawn: ${outOnArrival} wild pets out on the first frame, ${roofChanged} changes under ${wildPets.root.name} in ${CONTROL_FRAMES} frames`);
check(outOnArrival > 0, 'the roof was empty on the first frame she could see it — the time it spent undrawn was not lived');
check(roofChanged > 0, `on the roof, drawn, nothing under ${wildPets.root.name} moved in ${CONTROL_FRAMES} frames`);

// 3. The mall: measured above — the crowd lives there.
console.log(`control 3, the mall: the crowd's buffers rewritten on ${mallCrowdFrames} of ${ROOM_FRAMES} frames`);
check(mallCrowdFrames > ROOM_FRAMES / 2, `in the castle's mall the crowd was rewritten on only ${mallCrowdFrames} of ${ROOM_FRAMES} frames — the crowd that shops there is not living, or this probe cannot see it live`);

// 4. Back in the garden: the park and its crowd carry on.
quietly(leaveCastle);
step();
sweep();
crowdRewrites();
const trainBack = train.distance;
let parkChanged = 0;
let crowdBack = 0;
for (let i = 0; i < CONTROL_FRAMES; i += 1) {
  step();
  parkChanged += sweep(world.parkRoots).changedWatched;
  if (crowdRewrites() > 0) crowdBack += 1;
}
console.log(
  `control 4, back in the garden: ${parkChanged} changes under the park's ${world.parkRoots.length} groups in ${CONTROL_FRAMES} frames, ` +
    `the crowd rewritten on ${crowdBack}, the train moved ${(train.distance - trainBack).toFixed(2)} m`,
);
check(parkChanged > CONTROL_FRAMES, `back in the garden, only ${parkChanged} changes under the park in ${CONTROL_FRAMES} frames — the park did not come back, or this instrument cannot see it move`);
check(crowdBack > CONTROL_FRAMES / 2, `back in the garden, the crowd was rewritten on only ${crowdBack} of ${CONTROL_FRAMES} frames`);

// ------------------------------------------------------------------- verdict

if (MEASURE) process.exit(0);
if (failures.length > 0) {
  console.error(`\nFAIL: work is being done where nobody can see it${mutate ? ' (--mutate: expected)' : ''}.`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nundrawn still OK');
