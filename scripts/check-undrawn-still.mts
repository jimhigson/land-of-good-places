/**
 * **`check:undrawn-still` — nothing that is not drawn is animated** (120 fps
 * plan, step 3; `docs/perf/FRAME-DROPS-2026-11.md` on #746).
 *
 * ```
 * pnpm run check:undrawn-still              # in the check chain
 * pnpm run check:undrawn-still -- --mutate  # prove it can go red
 * MEASURE=1 pnpm run check:undrawn-still    # print what moved, assert nothing
 * ```
 *
 * ## Why this exists
 *
 * The target is 120 fps, 8.3 ms a frame (CLAUDE.md). The plan's profile of the
 * park found most of a millisecond of every frame spent posing the castle
 * banquet's twenty-four diners while she was in the park, the reptile house or
 * the library — a room 600 m away that was not drawn. The roof garden's wild
 * pets ran the same way, building and disposing pet models in a space nobody
 * could see for the whole session.
 *
 * Wall-clock time cannot be asserted in CI (a software rasteriser's timings
 * describe nothing), but **this** can be asserted exactly, on any machine: a
 * frame that changes something nobody can see did work nobody can see. So
 * this counts it.
 *
 * ## What is measured
 *
 * The real `World` (`park-harness.mts`), stepped through the real
 * `world.update` at 1/60 with the player standing in the garden — where she
 * spends nearly all of a session, and where every interior is undrawn.
 *
 * Every frame, every object with an **invisible ancestor** — the castle's
 * `interiorRoot` or a storey that is not hers, the hotel, the library, the
 * reptile hall — is compared with itself a frame earlier: position, rotation
 * and scale, and for an `InstancedMesh` its instance buffer's `version` (which
 * `InstancedCrowd.flush` bumps). An object appearing under a hidden ancestor
 * counts too: something built it. Any of these is work done for a space
 * nobody is looking at, and it is attributed to the named group it happened
 * under, so a red run says *what* is still running.
 *
 * "Invisible ancestor", not "invisible": an object that hides **itself** — an
 * empty speech bubble, a withheld label — is a thing switched off in a space
 * that is drawn. What this guards is whole spaces.
 *
 * ## The controls
 *
 * A check that reads zero must be shown able to read something else, so after
 * the garden a real `Player` is walked into the castle through the door's own
 * code (`enterCastleSpawn`, what `/castle?deck=` uses):
 *
 * 1. **The great hall, drawn.** The diners must move there and their instance
 *    buffers must flush. If the instrument cannot see the banquet being posed
 *    in the one room where it is drawn, its zero in the garden means nothing.
 * 2. **The roof garden, drawn**, after the whole garden run unseen. The animals
 *    must already be out on the very first frame — the roof "was already
 *    going" when she arrived (`WildPets.catchUp`) — and must move after it.
 *
 * ## Proving it red
 *
 * `--mutate` puts back the shape before step 3 — the banquet and the wild pets
 * updated every frame wherever she is — by calling both from this script after
 * each `world.update`. The code under test stays the shipping code.
 */
import './headless-canvas.mjs';
import { InstancedMesh, Object3D, Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { IsoCamera } from '../src/core/IsoCamera.ts';
import { Player } from '../src/entities/Player.ts';
import { CASTLE_ROOF } from '../src/world/building/floors.ts';
import { CASTLE_GREAT_HALL_DECK } from '../src/world/building/castleFurniture.ts';
import { banquetGroupName, type GreatHallBanquet } from '../src/world/building/greatHallBanquet.ts';
import type { WildPets } from '../src/world/building/WildPets.ts';
import type { FrameContext } from '../src/core/types.ts';

const mutate = process.argv.includes('--mutate');
const MEASURE = process.env['MEASURE'] === '1';
const DT = 1 / 60;
/** Frames before the first comparison: the park's own first-frame settling. */
const WARM_FRAMES = 30;
/** Ten seconds in the garden: several wild-pet emergences' worth on the old code. */
const GARDEN_FRAMES = Number(process.env['FRAMES'] ?? 600);
/** Frames in each drawn room for the controls. */
const CONTROL_FRAMES = 60;

const park = buildHeadlessPark();
const world = park.world;
const scene = park.scene;
const building = world.building as unknown as { banquet: GreatHallBanquet; wildPets: WildPets };
const wildPets = building.wildPets as unknown as { root: Object3D; live: unknown[] };

const input = new InputSystem();
let playerPosition = new Vector3(0, 0, 0);
const cameraForward = new Vector3(0, 0, 1);
let frame = 0;
const step = (): void => {
  const context: FrameContext = { dt: DT, elapsed: frame * DT, input, playerPosition, cameraForward, frame };
  quietly(() => {
    world.update(context);
    if (mutate) {
      // The park before step 3: both, every frame, wherever she is.
      building.banquet.update(context.elapsed);
      building.wildPets.update(context);
    }
  });
  frame += 1;
};

// ------------------------------------------------------------- the instrument

/** Ten numbers per object: position, quaternion, scale. */
const STRIDE = 10;
const last = new Map<Object3D, Float64Array>();
const lastVersion = new Map<InstancedMesh, number>();

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

/** True when `object` sits under the named group. */
function under(object: Object3D, name: string): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (o.name === name) return true;
  return false;
}

interface Sweep {
  /** Objects under an invisible ancestor this frame. */
  readonly undrawn: number;
  /** Undrawn objects that changed since the last sweep, by space and label. */
  readonly changedUndrawn: Map<string, number>;
  /** Drawn objects under the named watch group that changed — the controls' reading. */
  readonly changedWatched: number;
}

/**
 * Walks the scene once, carrying "an ancestor is hidden" down the tree, and
 * compares every object with its snapshot from the previous sweep. Every
 * snapshot is refreshed, drawn or not, so an object that has just become
 * undrawn is compared against where it really was.
 */
function sweep(watch: string | null = null): Sweep {
  const changedUndrawn = new Map<string, number>();
  let changedWatched = 0;
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
    if (object instanceof InstancedMesh) {
      const version = object.instanceMatrix.version;
      if (lastVersion.get(object) !== version) changed = true;
      lastVersion.set(object, version);
    }
    if (ancestorHidden) {
      undrawn += 1;
      if (changed) {
        const key = `${hiddenSpace(object)}: ${label(object)}`;
        changedUndrawn.set(key, (changedUndrawn.get(key) ?? 0) + 1);
      }
    } else if (changed && watch !== null && under(object, watch)) {
      changedWatched += 1;
    }
    const hidden = ancestorHidden || !object.visible;
    for (const child of object.children) visit(child, hidden);
  };
  for (const child of scene.children) visit(child, false);
  return { undrawn, changedUndrawn, changedWatched };
}

const failures: string[] = [];
const check = (ok: boolean, message: string): void => {
  if (!ok) failures.push(message);
};

// ------------------------------------------------------------------- garden

for (let i = 0; i < WARM_FRAMES; i += 1) step();
sweep(); // the baseline every later sweep compares against

const totals = new Map<string, number>();
let undrawnSeen = 0;
let changedFrames = 0;
for (let i = 0; i < GARDEN_FRAMES; i += 1) {
  step();
  const result = sweep();
  undrawnSeen = Math.max(undrawnSeen, result.undrawn);
  if (result.changedUndrawn.size > 0) changedFrames += 1;
  for (const [key, n] of result.changedUndrawn) totals.set(key, (totals.get(key) ?? 0) + n);
}
const changedTotal = [...totals.values()].reduce((a, b) => a + b, 0);
const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);

console.log(
  `garden: ${GARDEN_FRAMES} frames at ${DT.toFixed(4)} s, ${undrawnSeen} objects under a hidden ancestor` +
    (mutate ? ' (--mutate: banquet and wild pets updated every frame, as before step 3)' : ''),
);
console.log(`  frames on which something undrawn changed: ${changedFrames} of ${GARDEN_FRAMES}`);
console.log(`  undrawn object-changes: ${changedTotal}${ranked.length === 0 ? ' (none)' : ', by space and group:'}`);
for (const [key, n] of ranked.slice(0, 30)) console.log(`  ${String(n).padStart(8)}  ${key}`);

check(undrawnSeen > 1000, `only ${undrawnSeen} objects were under a hidden ancestor in the garden — the interiors are not where this check thinks, so its zero would mean nothing`);
check(
  changedTotal === 0,
  `${changedTotal} changes to objects in spaces that are not drawn, on ${changedFrames} of ${GARDEN_FRAMES} frames ` +
    `(worst: ${ranked.slice(0, 3).map(([k, n]) => `${n}× ${k}`).join('; ')}). Something is being animated ` +
    'where nobody can see it — gate it on `isDrawn` (src/core/drawn.ts)',
);

// ------------------------------------------------------------- the controls

const camera = new IsoCamera();
const player = quietly(() => new Player(world.collision, camera, new Vector3(0, 0, 0)));
scene.add(player.group);
world.building.attachPlayer(player);
playerPosition = player.position;

/** Into `deck` through the door's own code; steps once so the iris's midpoint has run. */
function enter(deck: number): void {
  const ok = world.building.enterCastleSpawn(deck);
  check(ok, `enterCastleSpawn(${deck}) refused — the control cannot reach the room it measures`);
}

// 1. The great hall: the diners are drawn and must be posed.
const hall = banquetGroupName(CASTLE_GREAT_HALL_DECK);
enter(CASTLE_GREAT_HALL_DECK);
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
console.log(`control, the great hall drawn: ${hallChanged} changes under ${hall}, on ${hallFrames} of ${CONTROL_FRAMES} frames`);
check(
  hallFrames === CONTROL_FRAMES,
  `in the great hall, drawn, the diners changed on only ${hallFrames} of ${CONTROL_FRAMES} frames — ` +
    'either the banquet is not being posed where she can see it, or this instrument cannot see it being posed',
);

// 2. The roof: lived in arrears, so already out on the first frame.
enter(CASTLE_ROOF.index);
step();
const outOnArrival = wildPets.live.length;
sweep();
let roofChanged = 0;
for (let i = 0; i < CONTROL_FRAMES; i += 1) {
  step();
  roofChanged += sweep(wildPets.root.name).changedWatched;
}
console.log(`control, the roof drawn: ${outOnArrival} wild pets out on the first frame, ${roofChanged} changes under ${wildPets.root.name} in ${CONTROL_FRAMES} frames`);
check(
  outOnArrival > 0,
  'the roof was empty on the first frame she could see it — the time it spent undrawn was not lived, ' +
    'so she arrives to a roof that starts when she looks at it (Building.update promises the opposite)',
);
check(roofChanged > 0, `on the roof, drawn, nothing under ${wildPets.root.name} moved in ${CONTROL_FRAMES} frames`);

// ------------------------------------------------------------------- verdict

if (MEASURE) process.exit(0);
if (failures.length > 0) {
  console.error(`\nFAIL: work is being done where nobody can see it${mutate ? ' (--mutate: expected)' : ''}.`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nundrawn still OK');
