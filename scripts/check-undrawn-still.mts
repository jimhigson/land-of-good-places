/**
 * **`check:undrawn-still` — nothing that is not drawn is animated** (120 fps
 * plan, step 3; `docs/perf/FRAME-DROPS-2026-11.md` on #746).
 *
 * ```
 * pnpm run check:undrawn-still              # in the check chain
 * pnpm run check:undrawn-still -- --mutate  # prove it can go red
 * ```
 *
 * ## Why this exists
 *
 * The target is 120 fps, 8.3 ms a frame (CLAUDE.md). The plan's profile of the
 * park found **0.96 ms of every frame** — `GreatHallBanquet.update`, 115 ms a
 * second — spent posing twenty-four diners in the castle's great hall while
 * she was in the park, the reptile house or the library: 600 m from a room
 * that is not drawn. Nobody could see a single one of those frames of work.
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
 * Every frame, every object in the scene with an **invisible ancestor** — the
 * castle's `interiorRoot` or a storey that is not hers, the hotel, the
 * library, the reptile hall — is compared with itself a frame earlier:
 * position, rotation and scale, and for an `InstancedMesh` its instance
 * buffer's `version` (which `InstancedCrowd.flush` bumps). Any change at all
 * is work done for a space nobody is looking at, and it is attributed to the
 * named group it happened under, so a red run says *what* is still running.
 *
 * "Invisible ancestor", not "invisible": an object that hides **itself** —
 * an empty speech bubble, a label withheld — is a thing switched off in a
 * space that is drawn, and moving it is a different question (and a cheap
 * one). What this guards is whole spaces.
 *
 * ## The control
 *
 * A check that reads zero must be able to read something else, so the run
 * ends by walking her **into the castle's great hall** — the banquet's own
 * storey, drawn — and stepping again. There the diners *must* move, and the
 * instance buffers *must* flush: if the instrument cannot see the banquet
 * being posed in the one room where it is drawn, its zero in the garden means
 * nothing, and the check says so and fails. The roof garden gets the same
 * control for the wild pets, and an undrawn-to-drawn transition proves the
 * animals are already out when she arrives (the roof "was already going").
 *
 * ## Proving it red
 *
 * `--mutate` puts back the shape before step 3: the banquet and the wild pets
 * updated every frame wherever she is. Patched on the prototype so the code
 * under test stays the shipping code and the mutation is confined to this
 * script.
 */
import './headless-canvas.mjs';
import { InstancedMesh, Object3D, Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import type { FrameContext } from '../src/core/types.ts';

const DT = 1 / 60;
const WARM_FRAMES = 30;
const FRAMES = Number(process.env['FRAMES'] ?? 600);
const MEASURE = process.env['MEASURE'] === '1';

const park = buildHeadlessPark();
const world = park.world;
const scene = park.scene;

const input = new InputSystem();
const playerPosition = new Vector3(0, 0, 0);
const cameraForward = new Vector3(0, 0, 1);
let frame = 0;
const step = (): void => {
  const context: FrameContext = { dt: DT, elapsed: frame * DT, input, playerPosition, cameraForward, frame };
  quietly(() => world.update(context));
  frame += 1;
};

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

/** The highest named ancestor below the scene that is hidden — the space this object is undrawn in. */
function hiddenSpace(object: Object3D): string {
  let found = '';
  for (let o: Object3D | null = object.parent; o && o !== scene; o = o.parent) {
    if (!o.visible) found = o.name || o.type;
  }
  return found;
}

interface Sweep {
  /** Objects under an invisible ancestor this frame. */
  readonly undrawn: number;
  /** Of those, how many changed since last frame, by label. */
  readonly changed: Map<string, number>;
}

/**
 * Walks the scene once, carrying "an ancestor is hidden" down the tree, and
 * compares every undrawn object with the snapshot from the previous sweep.
 * Every object's snapshot is refreshed, drawn or not, so an object that has
 * just become undrawn is compared against where it really was.
 */
function sweep(): Sweep {
  const changed = new Map<string, number>();
  let undrawn = 0;
  const visit = (object: Object3D, ancestorHidden: boolean): void => {
    let snap = last.get(object);
    const fresh = !snap;
    if (!snap) {
      snap = new Float64Array(STRIDE);
      last.set(object, snap);
    }
    const p = object.position;
    const q = object.quaternion;
    const s = object.scale;
    let moved = false;
    if (!fresh) {
      moved =
        snap[0] !== p.x || snap[1] !== p.y || snap[2] !== p.z ||
        snap[3] !== q.x || snap[4] !== q.y || snap[5] !== q.z || snap[6] !== q.w ||
        snap[7] !== s.x || snap[8] !== s.y || snap[9] !== s.z;
    }
    snap[0] = p.x; snap[1] = p.y; snap[2] = p.z;
    snap[3] = q.x; snap[4] = q.y; snap[5] = q.z; snap[6] = q.w;
    snap[7] = s.x; snap[8] = s.y; snap[9] = s.z;
    if (object instanceof InstancedMesh) {
      const version = object.instanceMatrix.version;
      const before = lastVersion.get(object);
      if (before !== undefined && before !== version) moved = true;
      lastVersion.set(object, version);
    }
    // A new object under a hidden ancestor is work too: something built it.
    if (fresh && ancestorHidden && frame > WARM_FRAMES) moved = true;
    if (ancestorHidden) {
      undrawn += 1;
      if (moved) {
        const key = `${hiddenSpace(object)}: ${label(object)}`;
        changed.set(key, (changed.get(key) ?? 0) + 1);
      }
    }
    const hidden = ancestorHidden || !object.visible;
    for (const child of object.children) visit(child, hidden);
  };
  for (const child of scene.children) visit(child, !child.visible ? false : false);
  // The top level's own visibility is a hidden *ancestor* for its children,
  // handled by `visit` passing `!object.visible` down.
  return { undrawn, changed };
}

// ------------------------------------------------------------------- garden
for (let i = 0; i < WARM_FRAMES; i += 1) step();
sweep();

const totals = new Map<string, number>();
let undrawnSeen = 0;
let changedFrames = 0;
for (let i = 0; i < FRAMES; i += 1) {
  step();
  const result = sweep();
  undrawnSeen = Math.max(undrawnSeen, result.undrawn);
  if (result.changed.size > 0) changedFrames += 1;
  for (const [key, n] of result.changed) totals.set(key, (totals.get(key) ?? 0) + n);
}

const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
console.log(`garden, ${FRAMES} frames at ${DT.toFixed(4)} s: ${undrawnSeen} objects under a hidden ancestor`);
console.log(`  frames on which something undrawn changed: ${changedFrames} of ${FRAMES}`);
for (const [key, n] of ranked.slice(0, 40)) console.log(`  ${String(n).padStart(8)}  ${key}`);
if (MEASURE) process.exit(0);
