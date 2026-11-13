/**
 * **Is every crowd child on screen drawn, and is nobody off screen drawn?**
 *
 * ```
 * pnpm run check:crowd-cull                     # part of check:crowd
 * pnpm run check:crowd-cull -- --mutate=centre  # prove the "nobody culled" half red (pop-in)
 * pnpm run check:crowd-cull -- --mutate=stale   # … and again (bounds computed once)
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
 *    part it shows, if that part's enclosing sphere meets the real game camera's
 *    frustum, the instanced mesh drawing it must pass three.js's own culling
 *    test *and* hold that member's matrix in a slot below its `count`. Zero
 *    tolerance.
 * 2. **No shadow is lost (shadow pass).** The same, for the shadow-casting
 *    parts against the sun's real shadow camera — a child just off the edge of
 *    the screen still throws a shadow onto it.
 * 3. **Nobody off screen is drawn.** Every instance a drawn part submits
 *    must belong to a child with some part on screen — zero tolerance — except
 *    the shadow-casting parts, which keep every child because the same buffer
 *    feeds the shadow pass. Their off-screen triangles are counted and held to
 *    a ratcheted budget per scene (park / interior).
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
import {
  Box3,
  Frustum,
  InstancedMesh,
  Matrix4,
  Sphere,
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
  type DirectionalLight,
  type Object3D,
} from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { CROWD_BOUNDS_MARGIN, InstancedCrowd, cullCrowdsFor } from '../src/entities/npc/InstancedCrowd.ts';
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
  readonly parts: readonly { readonly source: { geometry: BufferGeometry }; readonly variants: readonly InstancedMesh[] }[];
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
  // with a bounding sphere computed once and never again. Every read hands
  // back a fresh copy of that first sphere, so nothing can update it.
  for (const crowd of crowds) {
    for (const part of insides(crowd).parts) {
      for (const mesh of part.variants) {
        mesh.frustumCulled = true;
        const stale = (mesh.boundingSphere ?? new Sphere()).clone();
        Object.defineProperty(mesh, 'boundingSphere', { get: () => stale.clone(), set: () => {} });
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

/**
 * Each part's own enclosing sphere, computed here from its vertices rather
 * than read off `geometry.boundingSphere`, which the code under test also
 * reads. A part whose sphere misses the frustum has no vertex on screen, so
 * this is a sound "might be on screen": a box would not be — `intersectsBox`
 * says yes for a box corner poking into the frustum that no vertex reaches,
 * and an early version of this check failed the renderer for disagreeing with
 * exactly that (a bob of hair whose own sphere, r 1.02, cleared the frustum).
 */
const spheres = new WeakMap<BufferGeometry, Sphere>();
function enclosingSphere(geometry: BufferGeometry): Sphere {
  let sphere = spheres.get(geometry);
  if (!sphere) {
    const position = geometry.getAttribute('position');
    const bounds = new Box3().setFromBufferAttribute(position as BufferAttribute);
    const centre = bounds.getCenter(new Vector3());
    let radiusSq = 0;
    const v = new Vector3();
    for (let i = 0; i < position.count; i += 1) radiusSq = Math.max(radiusSq, centre.distanceToSquared(v.fromBufferAttribute(position, i)));
    sphere = new Sphere(centre, Math.sqrt(radiusSq));
    spheres.set(geometry, sphere);
  }
  return sphere;
}
const partSphere = new Sphere();
const nearSphere = new Sphere();
const slotMatrix = new Matrix4();
/**
 * Does a slot below `count` hold this matrix? Compared at float32 precision —
 * the instance buffer is a `Float32Array`, and 600 m out (the castle's floors)
 * a float32 is only good to ~6e-5 m, which an early version of this check
 * read as a missing child.
 */
function holds(mesh: InstancedMesh, matrix: Matrix4): boolean {
  const e = matrix.elements;
  for (let i = 0; i < mesh.count; i += 1) {
    mesh.getMatrixAt(i, slotMatrix);
    const s = slotMatrix.elements;
    let same = true;
    for (let k = 0; k < 16 && same; k += 1) {
      same = Math.abs(s[k]! - Math.fround(e[k]!)) <= 1e-6 * Math.max(1, Math.abs(e[k]!));
    }
    if (same) return true;
  }
  return false;
}

interface SceneTally {
  poses: number;
  drawCalls: number;
  tris: number;
  /** Shadow-casting parts drawn off screen — legitimate, budgeted. */
  shadowTris: number;
  worstShadowTris: number;
  worstShadowPose: string;
  /** Non-shadow parts drawn for a child wholly off screen — forbidden. */
  wasteTris: number;
  wasteReports: number;
}
const freshTally = (): SceneTally => ({
  poses: 0, drawCalls: 0, tris: 0, shadowTris: 0, worstShadowTris: 0, worstShadowPose: '', wasteTris: 0, wasteReports: 0,
});
const tally: Record<'park' | 'interior', SceneTally> = { park: freshTally(), interior: freshTally() };
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
  const membersNearScreen = new Set<object>();
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
        worldMatrix.multiplyMatrices(mesh.matrixWorld, proxy.matrixWorld);
        partSphere.copy(enclosingSphere(part.source.geometry)).applyMatrix4(worldMatrix);
        // The "drawn for nobody" side is judged with the crowd's own margin and
        // 2 cm more, so float32 rounding in the buffer can never turn a child
        // the renderer was right to keep into a failure, nor the reverse.
        nearSphere.copy(partSphere);
        nearSphere.radius += CROWD_BOUNDS_MARGIN + 0.02;
        if (view.intersectsSphere(nearSphere)) membersNearScreen.add(member);
        if (view.intersectsSphere(partSphere)) {
          partsOnScreen += 1;
          onScreen.set(mesh, (onScreen.get(mesh) ?? 0) + 1);
          if (!passes(mesh, view)) {
            const s = mesh.boundingSphere ? mesh.boundingSphere.clone().applyMatrix4(mesh.matrixWorld) : null;
            const c = partSphere.center;
            failures.push(
              `${label}: ${mesh.name} culled from the main pass with a child on screen, part centre ` +
                `(${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}); its sphere ` +
                (s ? `(${s.center.x.toFixed(2)}, ${s.center.y.toFixed(2)}, ${s.center.z.toFixed(2)}) r ${s.radius.toFixed(2)}` : 'none') +
                `, count ${mesh.count}, holds the instance: ${holds(mesh, proxy.matrixWorld)}`,
            );
            if (process.env['STOP_AFTER'] && failures.length >= Number(process.env['STOP_AFTER'])) { console.error(failures.join('\n')); process.exit(1); }
          } else if (!holds(mesh, proxy.matrixWorld)) {
            let nearest = Infinity;
            const e = proxy.matrixWorld.elements;
            for (let i = 0; i < mesh.count; i += 1) {
              mesh.getMatrixAt(i, slotMatrix);
              const t = slotMatrix.elements;
              nearest = Math.min(nearest, Math.hypot(t[12]! - e[12]!, t[13]! - e[13]!, t[14]! - e[14]!));
            }
            failures.push(
              `${label}: ${mesh.name} drawn but missing an on-screen child's instance at ` +
                `(${e[12]!.toFixed(2)}, ${e[13]!.toFixed(2)}, ${e[14]!.toFixed(2)}) in its crowd's frame; nearest slot ${nearest.toFixed(3)} m away`,
            );
            if (process.env['STOP_AFTER'] && failures.length >= Number(process.env['STOP_AFTER'])) { console.error(failures.join('\n')); process.exit(1); }
          }
        }
        if (mesh.castShadow && shadow.intersectsSphere(partSphere)) {
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
  let shadowTris = 0;
  for (const crowd of crowds) {
    const { parts, members } = insides(crowd);
    for (let p = 0; p < parts.length; p += 1) {
      const part = parts[p]!;
      for (let v = 0; v < part.variants.length; v += 1) {
        const mesh = part.variants[v]!;
        if (!passes(mesh, view)) continue;
        t.drawCalls += 1;
        t.tris += trisOf(mesh) * mesh.count;
        if (mesh.castShadow) {
          // Kept for the shadow pass; counted, budgeted, not forbidden.
          shadowTris += trisOf(mesh) * Math.max(0, mesh.count - (onScreen.get(mesh) ?? 0));
          continue;
        }
        // Every other drawn instance must be a child with something on screen.
        for (let i = 0; i < mesh.count; i += 1) {
          mesh.getMatrixAt(i, slotMatrix);
          const owner = members.find((m) => committed.get(m)?.[p] === v && sameTranslation(slotMatrix, m.proxies[p]!.matrixWorld));
          if (!owner) {
            failures.push(`${label}: ${mesh.name} slot ${i} holds no committed child`);
          } else if (!membersNearScreen.has(owner)) {
            t.wasteTris += trisOf(mesh);
            if (t.wasteReports < 5) {
              t.wasteReports += 1;
              failures.push(`${label}: ${mesh.name} drawn for a child wholly off screen`);
            }
          }
        }
      }
    }
  }
  t.shadowTris += shadowTris;
  if (shadowTris > t.worstShadowTris) {
    t.worstShadowTris = shadowTris;
    t.worstShadowPose = label;
  }
}

function sameTranslation(a: Matrix4, b: Matrix4): boolean {
  const x = a.elements;
  const y = b.elements;
  for (const k of [12, 13, 14]) if (Math.abs(x[k]! - Math.fround(y[k]!)) > 1e-6 * Math.max(1, Math.abs(y[k]!))) return false;
  return true;
}

/** Places the camera as `Game` would after a door: snapped, then one update. */
function frameOn(focus: Vector3, width: number, height: number, zoomedOut: boolean): void {
  const context = step(focus);
  iso.resize(width, height);
  if (zoomedOut) iso.snapZoomTarget(CAMERA_ZOOM_MAX);
  else iso.snapZoomTarget(1);
  iso.snapTo(focus);
  iso.update(context, focus, zero);
  // Exactly what `Game.render` does before it draws.
  if (mutation !== 'uncull') cullForThisDraw();
}

/** `cullCrowdsFor`, or under `--mutate=centre` the classic pop-in bug: a child kept only if her middle is on screen. */
function cullForThisDraw(): void {
  if (mutation !== 'centre') {
    cullCrowdsFor(scene, iso.camera);
    return;
  }
  const real = Frustum.prototype.intersectsSphere;
  Frustum.prototype.intersectsSphere = function (this: Frustum, sphere: Sphere): boolean {
    return this.containsPoint(sphere.center);
  };
  try {
    cullCrowdsFor(scene, iso.camera);
  } finally {
    Frustum.prototype.intersectsSphere = real;
  }
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

/** Rounds alternate odd and even children, so two put every child at every edge. */
const ROUNDS = Number(process.env['ROUNDS'] ?? 2);
const kids = world.npcs.all;
const target = new Vector3();
const focus = new Vector3();

for (let round = 0; round < ROUNDS; round += 1) {
  step(zero, 600);
  for (const [name, width, height] of ASPECTS) {
    if (process.env['SKIP_PARK']) break;
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

// ---------------------------------------------------------------- interiors
/**
 * Indoors, as `Game` draws it: the space she is in is switched on. Headless,
 * nothing ever walks through a door, so every interior root stays hidden and a
 * banquet diner would be "correctly" invisible in the hall she is standing in.
 * So for these poses every ancestor of every crowd is switched on — more than
 * the game ever shows at once (all three castle floors), which only makes the
 * "nothing off screen drawn" half harder to pass.
 */
function withCrowdsShown(body: () => void): void {
  const hidden: Object3D[] = [];
  for (const crowd of crowds) {
    for (let o: Object3D | null = crowd.group; o; o = o.parent) {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    }
  }
  try {
    body();
  } finally {
    for (const o of hidden) o.visible = false;
  }
}

const interiors = [
  ...CASTLE_FLOORS.map((f) => f.space),
  ...HOTEL_ROOM_Z.map(([s]) => s),
  ...REPTILE_SPACE_ORIGINS.map(([s]) => s),
  SPACE_LIBRARY,
];
const memberAt = new Vector3();
withCrowdsShown(() => {
  // Every interior, at its origin and a few metres about it.
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
  // Every crowd member indoors — banquet diners, and park children who have
  // wandered in — at the centre and on every edge of the frame.
  for (const crowd of crowds) {
    // A banquet seats a hundred-odd children at one set of tables; every third
    // one at every edge still frames every table from every side, at a third
    // of the run time. Park children indoors are all taken.
    const stride = insides(crowd).members.length > 60 ? 3 : 1;
    for (const [i, member] of insides(crowd).members.entries()) {
      if (i % stride !== 0) continue;
      if (!committed.has(member)) continue;
      const root = (member as unknown as { root: Object3D }).root;
      memberAt.copy(root.position).applyMatrix4(crowd.group.matrixWorld);
      const space = spaceAt(memberAt.x, memberAt.z);
      if (space === SPACE_GARDEN) continue;
      target.copy(memberAt);
      for (const [name, width, height] of ASPECTS) {
        frameOn(target, width, height, false);
        for (const [ox, oy] of edgeOffsets) {
          if (Math.abs(ox) > 1.01 || Math.abs(oy) > 1.01) continue;
          focus.copy(target)
            .addScaledVector(iso.screenRightAxis as Vector3, -ox * iso.viewHalfWidth)
            .addScaledVector(iso.screenUpAxis as Vector3, -oy * iso.viewHalfHeight);
          focus.y = target.y;
          frameOn(focus, width, height, false);
          measure(`${space} ${name}, ${crowd.group.name} member ${(member as unknown as { index: number }).index} at (${ox},${oy})`, 'interior');
        }
      }
    }
  }
});

// ------------------------------------------------------------- the verdict
/**
 * Off-screen triangles of **shadow-casting** parts, **mean** per pose — a budget
 * on the mean, not a cap on any one pose (the worst poses run well over it). Those parts
 * keep every child, because the buffer they draw from also feeds the shadow
 * pass (`InstancedCrowd.cullTo`). Ratchet down, never up. Every other part
 * drawn for a child wholly off screen is a failure outright, above.
 *
 * Measured (seed 5): park 86,986 at ROUNDS=1 and 95,654 at the default 2 —
 * it moves with which children the rounds put at which edge, so the budget
 * carries ~15 % over the higher figure; interior 439,449, mostly the great
 * hall's banquet, every diner's head and body kept for the castle key light's
 * shadow.
 */
const SHADOW_BUDGET = { park: 110_000, interior: 500_000 } as const;

const fmt = (n: number): string => Math.round(n).toLocaleString('en-GB');
for (const kind of ['park', 'interior'] as const) {
  const t = tally[kind];
  const meanShadow = t.shadowTris / Math.max(1, t.poses);
  console.log(
    `check:crowd-cull ${kind}: ${t.poses} poses; per pose ${(t.drawCalls / t.poses).toFixed(1)} crowd draw calls, ` +
      `${fmt(t.tris / t.poses)} crowd tris; off screen: ${fmt(t.wasteTris / t.poses)} non-shadow (must be 0), ` +
      `mean ${fmt(meanShadow)} shadow-casting (mean budget ${fmt(SHADOW_BUDGET[kind])}; worst single pose ${fmt(t.worstShadowTris)}, not capped, at ${t.worstShadowPose || '—'})`,
  );
  if (meanShadow > SHADOW_BUDGET[kind]) {
    failures.push(`${kind}: ${fmt(meanShadow)} off-screen shadow-casting crowd triangles per pose, budget ${fmt(SHADOW_BUDGET[kind])}`);
  }
  if (t.wasteTris > 0) failures.push(`${kind}: ${fmt(t.wasteTris)} triangles drawn in all for children wholly off screen`);
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
