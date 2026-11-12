/**
 * **Is every crowd child on screen drawn, and is nobody off screen drawn?**
 *
 * ```
 * pnpm run check:crowd-cull                     # part of check:crowd
 * pnpm run check:crowd-cull -- --mutate=stale   # prove the "nobody culled" half red
 * pnpm run check:crowd-cull -- --mutate=uncull  # prove the "nobody wasted" half red
 * ```
 *
 * Step 4 of the 120 fps plan (docs/perf/FRAME-DROPS-2026-11.md, item 4): the
 * crowd (`InstancedCrowd` — the park's children, their pets, the banquet's
 * diners) used to be `frustumCulled = false` and drew every instance of every
 * part, every frame, from every space. Indoors that was the whole park crowd
 * drawn 844 m away; in the park it was every child in the park, plus every
 * *hidden* face/hair/bag variant drawn as a zero-scaled instance.
 *
 * Culling a crowd is exactly the kind of change that can go wrong invisibly to
 * a build and visibly to a child: a bounding sphere one frame stale, or one
 * built from the wrong instances, and a child blinks out at the screen edge. So
 * this measures both sides of it, against **what should be drawn** — read off
 * each member's own skeleton and its chosen variants, never off the instance
 * buffer the code under test writes:
 *
 * 1. **Nobody on screen is culled (main pass).** For every member, for every
 *    part it shows, if that part's box intersects the real game camera's
 *    frustum, the instanced mesh drawing it must pass three.js's own culling
 *    test *and* hold that member's matrix in a slot below its `count`. Zero
 *    tolerance.
 * 2. **No shadow is lost (shadow pass).** The same, for the shadow-casting
 *    parts against the sun's real shadow camera — a child just off the edge of
 *    the screen still throws a shadow onto it.
 * 3. **Nothing off screen is drawn.** Triangles the main pass would submit for
 *    instances that are not on screen, summed per pose. Ratcheted per scene
 *    (park / interior); today's code is far over both.
 *
 * Poses: the real `IsoCamera`, resized to the desktop (1440×900) and the phone
 * (390×844), at the default zoom and zoomed out; centred on every park child,
 * and with every child pushed to each edge and corner of the frame (just
 * inside, on, and just past it — the pop-in case); plus every interior space.
 * The world is stepped between rounds so faces blink and children move.
 *
 * Interiors use the same follow camera snapped into the room. That is not the
 * exact indoor framing (`Game` adds per-room shot overrides), but every
 * interior is hundreds of metres from every other space, so what it measures —
 * whether a crowd in another space is submitted — does not depend on it.
 */
import './headless-canvas.mjs';
import { Box3, Frustum, InstancedMesh, Matrix4, Vector3, type Object3D, type DirectionalLight } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { InstancedCrowd } from '../src/entities/npc/InstancedCrowd.ts';
import { CAMERA_ZOOM_MAX } from '../src/core/constants.ts';
import { CASTLE_FLOORS } from '../src/world/building/floors.ts';
import { HOTEL_ROOM_Z, REPTILE_SPACE_ORIGINS, SPACE_GARDEN, SPACE_LIBRARY, spaceAt } from '../src/world/spaces.ts';
import { localToWorld } from '../src/world/spaceOrigins.ts';
import type { FrameContext } from '../src/core/types.ts';

const mutation = process.argv.find((a) => a.startsWith('--mutate='))?.slice('--mutate='.length) ?? '';

// ------------------------------------------------------------ find the crowds
/**
 * Every crowd that flushes, found by watching `flush` rather than by name, so a
 * crowd added next month is measured without anyone remembering this file.
 */
const crowds = new Set<InstancedCrowd>();
const realFlush = InstancedCrowd.prototype.flush;
InstancedCrowd.prototype.flush = function (this: InstancedCrowd): void {
  crowds.add(this);
  realFlush.call(this);
};

/**
 * What each member showed at its last `commit`, per part (-1 for nothing) —
 * recorded by watching `commit`, so "what should be drawn" is what was last
 * committed and never the buffer. A member never committed is drawn by nobody
 * (a banquet diner on a storey nobody has visited yet), and is not expected.
 */
const committed = new WeakMap<object, Int16Array>();
const realCommit = InstancedCrowd.prototype.commit;
InstancedCrowd.prototype.commit = function (this: InstancedCrowd, member): void {
  realCommit.call(this, member);
  const choice = committed.get(member) ?? new Int16Array(member.proxies.length);
  for (let p = 0; p < member.proxies.length; p += 1) choice[p] = member.shown[p] ? member.variant[p]! : -1;
  committed.set(member, choice);
};

/** The fields this check reads; present before and after step 4. */
interface CrowdInsides {
  readonly parts: readonly { readonly source: { geometry: import('three').BufferGeometry }; readonly variants: readonly InstancedMesh[] }[];
  readonly members: readonly {
    readonly proxies: readonly Object3D[];
    readonly variant: Uint8Array;
    readonly shown: Uint8Array;
  }[];
}
const insides = (crowd: InstancedCrowd): CrowdInsides => crowd as unknown as CrowdInsides;

const park = buildHeadlessPark();
const { world, camera: iso, scene } = park;
const input = new InputSystem();
const DT = 1 / 60;
let frame = 0;
const playerPosition = new Vector3();
const zero = new Vector3();

function step(at: Vector3, frames = 1): FrameContext {
  let context!: FrameContext;
  for (let i = 0; i < frames; i += 1) {
    playerPosition.copy(at);
    context = {
      dt: DT,
      elapsed: frame * DT,
      input,
      playerPosition,
      cameraForward: iso.forward as Vector3,
      frame,
    };
    quietly(() => world.update(context));
    frame += 1;
  }
  return context;
}

step(zero, 120);
if (crowds.size === 0) {
  console.error('check:crowd-cull: no InstancedCrowd flushed — this check found nothing to measure');
  process.exit(1);
}

if (mutation === 'uncull') {
  // Today's code before step 4: never culled.
  for (const crowd of crowds) for (const part of insides(crowd).parts) for (const mesh of part.variants) mesh.frustumCulled = false;
}
if (mutation === 'stale') {
  // The obvious wrong fix the class comment always warned about: culling on,
  // with a bounding sphere computed once and never again.
  for (const crowd of crowds) {
    for (const part of insides(crowd).parts) {
      for (const mesh of part.variants) {
        mesh.frustumCulled = true;
        mesh.computeBoundingSphere();
        Object.defineProperty(mesh, 'boundingSphere', { value: mesh.boundingSphere, writable: false });
      }
    }
  }
}

// ------------------------------------------------------------- the light
let sun: DirectionalLight | null = null;
scene.traverse((o) => {
  const light = o as DirectionalLight;
  if (light.isDirectionalLight && light.castShadow && !sun) sun = light;
});
if (!sun) {
  console.error('check:crowd-cull: no shadow-casting sun in the scene');
  process.exit(1);
}
const sunLight: DirectionalLight = sun;

// ------------------------------------------------------------- measuring
const triangles = new WeakMap<InstancedMesh, number>();
function trisOf(mesh: InstancedMesh): number {
  let t = triangles.get(mesh);
  if (t === undefined) {
    const g = mesh.geometry;
    t = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    triangles.set(mesh, t);
  }
  return t;
}

function visibleChain(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** Whether three.js's own projectObject / shadow pass would submit it. */
function passes(mesh: InstancedMesh, frustum: Frustum): boolean {
  if (!visibleChain(mesh)) return false;
  if (mesh.count === 0) return false;
  return !mesh.frustumCulled || frustum.intersectsObject(mesh);
}

const box = new Box3();
const slotMatrix = new Matrix4();
/** Does a slot below `count` hold this matrix? */
function holds(mesh: InstancedMesh, matrix: Matrix4): boolean {
  const e = matrix.elements;
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, slotMatrix);
    const s = slotMatrix.elements;
    if (Math.abs(s[12]! - e[12]!) < 1e-5 && Math.abs(s[13]! - e[13]!) < 1e-5 && Math.abs(s[14]! - e[14]!) < 1e-5 &&
        Math.abs(s[0]! - e[0]!) < 1e-5 && Math.abs(s[5]! - e[5]!) < 1e-5) return true;
  }
  return false;
}

interface SceneTally {
  poses: number;
  drawCalls: number;
  tris: number;
  offTris: number;
  worstOffTris: number;
  worstOffPose: string;
}
const tally: Record<'park' | 'interior', SceneTally> = {
  park: { poses: 0, drawCalls: 0, tris: 0, offTris: 0, worstOffTris: 0, worstOffPose: '' },
  interior: { poses: 0, drawCalls: 0, tris: 0, offTris: 0, worstOffTris: 0, worstOffPose: '' },
};
const failures: string[] = [];
let partsOnScreen = 0;
let partsInShadow = 0;
const worldMatrix = new Matrix4();

function measure(label: string, kind: 'park' | 'interior'): void {
  scene.updateMatrixWorld(true);
  const cam = iso.camera;
  cam.updateMatrixWorld(true);
  const view = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
  );
  sunLight.shadow.updateMatrices(sunLight);
  const shadow = sunLight.shadow.getFrustum();

  const onScreen = new Map<InstancedMesh, number>();
  for (const crowd of crowds) {
    const { parts, members } = insides(crowd);
    for (const member of members) {
      const choice = committed.get(member);
      if (!choice) continue;
      for (let p = 0; p < parts.length; p += 1) {
        const chosen = choice[p]!;
        if (chosen < 0) continue;
        const part = parts[p]!;
        const mesh = part.variants[chosen];
        const proxy = member.proxies[p];
        if (!mesh || !proxy || !visibleChain(mesh)) continue;
        const geometry = part.source.geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        worldMatrix.multiplyMatrices(mesh.matrixWorld, proxy.matrixWorld);
        box.copy(geometry.boundingBox!).applyMatrix4(worldMatrix);
        if (view.intersectsBox(box)) {
          partsOnScreen += 1;
          onScreen.set(mesh, (onScreen.get(mesh) ?? 0) + 1);
          if (!passes(mesh, view)) {
            failures.push(`${label}: ${mesh.name} culled from the main pass with a child on screen at (${box.min.x.toFixed(1)}, ${box.min.z.toFixed(1)})`);
          } else if (!holds(mesh, proxy.matrixWorld)) {
            failures.push(`${label}: ${mesh.name} drawn but missing an on-screen child's instance`);
          }
        }
        if (mesh.castShadow && shadow.intersectsBox(box)) {
          partsInShadow += 1;
          if (!passes(mesh, shadow)) {
            failures.push(`${label}: ${mesh.name} culled from the shadow pass with a child in the shadow frustum`);
          }
        }
      }
    }
  }

  const t = tally[kind];
  t.poses += 1;
  let offTris = 0;
  for (const crowd of crowds) {
    for (const part of insides(crowd).parts) {
      for (const mesh of part.variants) {
        if (!passes(mesh, view)) continue;
        const drawnInstances = mesh.count;
        t.drawCalls += 1;
        t.tris += trisOf(mesh) * drawnInstances;
        offTris += trisOf(mesh) * Math.max(0, drawnInstances - (onScreen.get(mesh) ?? 0));
      }
    }
  }
  t.offTris += offTris;
  if (offTris > t.worstOffTris) {
    t.worstOffTris = offTris;
    t.worstOffPose = label;
  }
}

/** Places the camera as `Game` would after a door: snapped, then one update. */
function frameOn(focus: Vector3, width: number, height: number, zoomedOut: boolean): void {
  const context = step(focus);
  iso.resize(width, height);
  if (zoomedOut) iso.snapZoomTarget(CAMERA_ZOOM_MAX);
  else iso.snapZoomTarget(1);
  iso.snapTo(focus);
  iso.update(context, focus, zero);
}

const ASPECTS: readonly (readonly [string, number, number])[] = [
  ['desktop', 1440, 900],
  ['phone', 390, 844],
];
/** Where on the frame a child is put: centre, every edge and corner, inside / on / past. */
const edgeOffsets: [number, number][] = [[0, 0]];
for (const reach of [0.92, 1.0, 1.08]) {
  for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    edgeOffsets.push([sx * reach, sy * reach]);
  }
}

const ROUNDS = Number(process.env['ROUNDS'] ?? 4);
const kids = world.npcs.all;
const target = new Vector3();
const focus = new Vector3();

for (let round = 0; round < ROUNDS; round += 1) {
  step(zero, 600);
  for (const [name, width, height] of ASPECTS) {
    for (const zoomedOut of [false, true]) {
      // Children in the park, each one put in turn at every edge of the frame.
      for (let k = round % 2; k < kids.length; k += 2) {
        const kid = kids[k]!;
        if (spaceAt(kid.position.x, kid.position.z) !== SPACE_GARDEN) continue;
        target.copy(kid.position);
        frameOn(target, width, height, zoomedOut);
        for (const [ox, oy] of edgeOffsets) {
          // Pushing the child to the right of the frame moves the focus left.
          focus.copy(target)
            .addScaledVector(iso.screenRightAxis as Vector3, -ox * iso.viewHalfWidth)
            .addScaledVector(iso.screenUpAxis as Vector3, -oy * iso.viewHalfHeight);
          focus.y = target.y;
          frameOn(focus, width, height, zoomedOut);
          measure(`round ${round} ${name}${zoomedOut ? ' zoomed out' : ''}, ${kid.name} at (${ox},${oy})`, 'park');
        }
      }
    }
  }
}

// Every interior, at its origin and a few metres about it.
const interiors = [
  ...CASTLE_FLOORS.map((f) => f.space),
  ...HOTEL_ROOM_Z.map(([s]) => s),
  ...REPTILE_SPACE_ORIGINS.map(([s]) => s),
  SPACE_LIBRARY,
];
for (const space of interiors) {
  for (const [dx, dz] of [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8]] as const) {
    const at = localToWorld(space, dx, 0, dz);
    if (!at) continue;
    for (const [name, width, height] of ASPECTS) {
      focus.set(at.x, at.y, at.z);
      frameOn(focus, width, height, false);
      measure(`${space} (${dx},${dz}) ${name}`, 'interior');
    }
  }
}

// ------------------------------------------------------------- the verdict
/**
 * Off-screen triangles the main pass may submit, mean per pose. Ratchet these
 * down, never up. What is left in the park is the union-sphere cost: a part
 * whose few instances straddle the frame is drawn whole.
 */
const BUDGET = { park: 120_000, interior: 0 } as const;

const fmt = (n: number): string => Math.round(n).toLocaleString('en-GB');
for (const kind of ['park', 'interior'] as const) {
  const t = tally[kind];
  const meanOff = t.offTris / Math.max(1, t.poses);
  console.log(
    `check:crowd-cull ${kind}: ${t.poses} poses; per pose ${(t.drawCalls / t.poses).toFixed(1)} crowd draw calls, ` +
      `${fmt(t.tris / t.poses)} crowd tris, ${fmt(meanOff)} of them off screen ` +
      `(budget ${fmt(BUDGET[kind])}); worst ${fmt(t.worstOffTris)} at ${t.worstOffPose || '—'}`,
  );
  if (meanOff > BUDGET[kind]) {
    failures.push(`${kind}: ${fmt(meanOff)} off-screen crowd triangles per pose, budget ${fmt(BUDGET[kind])}`);
  }
}
process.stderr.write(
  `check:crowd-cull: ${crowds.size} crowds, ${partsOnScreen} on-screen parts and ${partsInShadow} shadow-frustum parts checked\n`,
);
if (partsOnScreen === 0 || partsInShadow === 0) failures.push('no crowd part was ever on screen — the check measured nothing');

if (failures.length > 0) {
  const shown = failures.slice(0, 20);
  console.error(`check:crowd-cull FAILED (${failures.length}):\n  ${shown.join('\n  ')}`);
  process.exit(1);
}
console.log('check:crowd-cull passed');
process.exit(0);
