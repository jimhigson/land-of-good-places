/**
 * **Is every crowd child on screen drawn, and is nobody off screen drawn?**
 *
 * ```
 * pnpm run check:crowd-cull                     # part of check:crowd
 * pnpm run check:crowd-cull -- --mutate=centre  # prove the "nobody culled" half red (pop-in)
 * pnpm run check:crowd-cull -- --mutate=stale   # … and again (bounds computed once)
 * pnpm run check:crowd-cull -- --mutate=uncull  # prove the "nobody wasted" half red
 * pnpm run check:crowd-cull -- --mutate=both-levels     # prove "one level of detail each" red
 * pnpm run check:crowd-cull -- --mutate=full-detail     # LOD never switches on: "far level under the ordinary camera" red
 * pnpm run check:crowd-cull -- --mutate=no-full-detail  # full detail lost up close: "full detail at CAMERA_ZOOM_MAX" red
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
 * 3. **Nobody off screen is drawn.** Every instance the main pass submits
 *    must belong to a child with some part on screen — zero tolerance, the
 *    shadow-casting parts included: since step 16 a casting part carries its
 *    off-screen children past its main-pass count, for the shadow pass alone.
 *
 * 4. **One level of detail each: the far one under the ordinary camera, full
 *    detail up close, and every shadow from the far one** (step 16). Every
 *    part with a far-level mesh is drawn for a child by exactly one of its two
 *    meshes — never both (two surfaces fighting), never neither, under every
 *    pose. On the **park poses at zoom 1** — the ordinary follow camera — that
 *    one is the far level; on the **poses at `CAMERA_ZOOM_MAX`** it is full
 *    detail for every child whose body alone fills the switch's share of the
 *    picture (measured here from her own parts; the sphere the code sizes her
 *    by encloses them, so it is larger still) — one far up a zoomed frame is
 *    small, and either level is right for her; the interiors assert one
 *    level, not which. The level is chosen by
 *    the share of the picture a child fills, which nothing about the screen's
 *    pixels enters (`cullCrowdsFor` is given none), so these hold at every
 *    device pixel ratio; the run states both clauses in CSS pixels on its own
 *    viewports — how tall the children it measured were, against the switch.
 *    And a casting part with a far level casts **from** it: its full-detail
 *    mesh never casts, and its far mesh's shadow draw (its own
 *    `onBeforeShadow`, called here as three.js calls it) holds every child in
 *    the shadow frustum.
 *
 * 5. **The far level is within its bound.** Every vertex of every part's
 *    source geometry lies within `LOD_LOW_TOLERANCE_M` of its far level's
 *    surface, in metres of world, and the far level has fewer triangles.
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
  Triangle,
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
import {
  LOD_FULL_ABOVE_SHARE,
  LOD_LOW_BELOW_SHARE,
  LOD_LOW_TOLERANCE_M,
  setLodMode,
  triangleCount,
} from '../src/core/instancedLod.ts';
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
  readonly parts: readonly CrowdPartInsides[];
  readonly members: readonly {
    readonly proxies: readonly Object3D[];
    readonly variant: Uint8Array;
    readonly shown: Uint8Array;
  }[];
}
interface CrowdPartInsides {
  readonly source: Object3D & { geometry: BufferGeometry };
  readonly variants: readonly InstancedMesh[];
  /** The far level of each variant, or null where the part has none (step 16). */
  readonly low: readonly (InstancedMesh | null)[];
  /** Whether the part throws a shadow. */
  readonly casts: boolean;
}
const insides = (crowd: InstancedCrowd): CrowdInsides & { readonly prototype: Object3D } =>
  crowd as unknown as CrowdInsides & { readonly prototype: Object3D };
/** Every mesh that may draw variant `v` of a part: full detail, then the far level if it has one. */
function levelMeshes(part: CrowdPartInsides, v: number): InstancedMesh[] {
  const full = part.variants[v];
  const low = part.low[v];
  return full ? (low ? [full, low] : [full]) : [];
}
/** Every instanced mesh of a part, both levels of every variant. */
function allMeshes(part: CrowdPartInsides): InstancedMesh[] {
  return part.variants.flatMap((_, v) => levelMeshes(part, v));
}
/** The CSS height of the viewport the current pose is drawn into (`frameOn` sets it). */
let viewportCssHeight = 900;

if (mutation === 'full-detail') {
  // Level of detail never switching on — what the first version did on a 3×
  // screen, where a rule in device pixels made every child look close.
  setLodMode('off');
}
if (mutation === 'no-full-detail') {
  // The far level everywhere: a child brought close keeps the cheap model.
  setLodMode('low');
}
if (mutation === 'both-levels') {
  // Step 16 without its level filter: every child the far mesh draws in the
  // main pass is drawn by the full-detail mesh as well.
  interface Draw { mesh: InstancedMesh; slots: Int32Array; main: number; written: number }
  const proto = InstancedCrowd.prototype as unknown as {
    pack(this: unknown, p: number, v: number, keep: Uint8Array | null): void;
    packMember(this: unknown, draw: Draw, m: number, p: number): void;
  };
  const realPack = proto.pack;
  proto.pack = function (this: unknown, p: number, v: number, keep: Uint8Array | null): void {
    realPack.call(this, p, v, keep);
    const self = this as { parts: readonly CrowdPartInsides[]; draws: Map<InstancedMesh, Draw> };
    const part = self.parts[p];
    const full = part?.variants[v] ? self.draws.get(part.variants[v]) : undefined;
    const low = part?.low[v] ? self.draws.get(part.low[v]) : undefined;
    if (!full || !low || full.written !== full.main) return;
    for (let i = 0; i < low.main; i += 1) proto.packMember.call(this, full, low.slots[i]!, p);
    full.main = full.written;
    full.mesh.count = full.main;
    full.mesh.visible = full.main > 0;
    full.mesh.instanceMatrix.needsUpdate = true;
  };
}

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
  for (const crowd of crowds) for (const part of insides(crowd).parts) for (const mesh of allMeshes(part)) mesh.frustumCulled = false;
}
if (mutation === 'stale') {
  // The obvious wrong fix the class comment always warned about: culling on,
  // with a bounding sphere computed once and never again. Every read hands
  // back a fresh copy of that first sphere, so nothing can update it.
  for (const crowd of crowds) {
    for (const part of insides(crowd).parts) {
      for (const mesh of allMeshes(part)) {
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

/** Whether three.js's own projectObject would submit it to the main pass. */
function passes(mesh: InstancedMesh, frustum: Frustum): boolean {
  if (!visibleChain(mesh)) return false;
  if (mesh.count === 0) return false;
  return !mesh.frustumCulled || frustum.intersectsObject(mesh);
}

/**
 * How many instances the shadow pass draws of `mesh` — read by calling its own
 * `onBeforeShadow` and `onAfterShadow` exactly as three.js's `WebGLShadowMap`
 * does round the draw, so this is the count that pass really submits.
 */
function shadowCount(mesh: InstancedMesh): number {
  const main = mesh.count;
  const hooks = mesh as unknown as { onBeforeShadow(): void; onAfterShadow(): void };
  hooks.onBeforeShadow();
  const drawn = mesh.count;
  hooks.onAfterShadow();
  if (mesh.count !== main) failures.push(`${mesh.name}: onAfterShadow left its count at ${mesh.count}, the main pass had ${main}`);
  return drawn;
}

/** Whether three.js's shadow pass would submit it: cast, visible, something to draw, in the light's frustum. */
function passesShadow(mesh: InstancedMesh, frustum: Frustum): boolean {
  if (!mesh.castShadow || !visibleChain(mesh)) return false;
  if (shadowCount(mesh) === 0) return false;
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
 * Does a slot below `count` (the main pass's, unless told) hold this matrix?
 * Compared at float32 precision — the instance buffer is a `Float32Array`, and
 * 600 m out (the castle's floors) a float32 is only good to ~6e-5 m, which an
 * early version of this check read as a missing child.
 */
function holds(mesh: InstancedMesh, matrix: Matrix4, count = mesh.count): boolean {
  const e = matrix.elements;
  for (let i = 0; i < count; i += 1) {
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
  /** Triangles the shadow pass submits for the crowd (the sun only), summed over poses. */
  shadowPassTris: number;
  /** Main-pass instances drawn for a child wholly off screen — forbidden. */
  wasteTris: number;
  wasteReports: number;
}
const freshTally = (): SceneTally => ({ poses: 0, drawCalls: 0, tris: 0, shadowPassTris: 0, wasteTris: 0, wasteReports: 0 });
const tally: Record<'park' | 'interior', SceneTally> = { park: freshTally(), interior: freshTally() };
const failures: string[] = [];
/** On-screen parts that have a far level, checked for one level each. */
let partsWithLevels = 0;
/** Of those, the ones on a pose where one level is the only right answer, and how many had the other. */
let partsFarExpected = 0;
let partsAtFullDetail = 0;
let partsFullExpected = 0;
let partsAtFarLevel = 0;
let levelReports = 0;
let partsOnScreen = 0;
let partsInShadow = 0;
/** Casting parts with a far level, and how many of them cast from full detail. */
let castingPartsChecked = 0;
let castFromFull = 0;
/**
 * How tall the children were on screen, in CSS pixels, measured here from
 * their own parts' spheres (never from the sphere the code under test sizes
 * them by) — per kind of pose, the shortest and tallest child with anything
 * on screen.
 */
const tallCss = { ordinary: { min: Infinity, max: 0 }, close: { min: Infinity, max: 0 } };
const worldMatrix = new Matrix4();
const viewPoint = new Vector3();

/**
 * `expect`: which level every on-screen part with two must be drawn at on
 * this pose — `far` under the ordinary camera, `full` at `CAMERA_ZOOM_MAX`,
 * or `either` (interiors) where only "exactly one" is asserted.
 */
function measure(label: string, kind: 'park' | 'interior', expect: 'far' | 'full' | 'either' = 'either'): void {
  scene.updateMatrixWorld(true);
  const cam = iso.camera;
  cam.updateMatrixWorld(true);
  const view = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
  );
  sunLight.shadow.updateMatrices(sunLight);
  const shadow = sunLight.shadow.getFrustum();
  const lens = cam.projectionMatrix.elements[5]!;

  const membersNearScreen = new Set<object>();
  for (const crowd of crowds) {
    const { parts, members } = insides(crowd);
    // Whether this crowd is drawn at all (an interior she is not in is not).
    // Asked of the crowd, never of a part's mesh: since step 16 a mesh holding
    // nobody this draw is hidden, and the full-detail one usually is.
    if (!visibleChain(crowd.group)) continue;
    for (const member of members) {
      const choice = committed.get(member);
      if (!choice) continue;
      // Her height on screen, from her own parts (never from the sphere the
      // code under test sizes her by): clip-space y over w, as a share of the
      // picture. The code's sphere encloses every part, so it is never shorter.
      let top = -Infinity, bottom = Infinity;
      for (let p = 0; p < parts.length; p += 1) {
        const proxy = member.proxies[p];
        if (choice[p]! < 0 || !proxy) continue;
        worldMatrix.multiplyMatrices(crowd.group.matrixWorld, proxy.matrixWorld);
        partSphere.copy(enclosingSphere(parts[p]!.source.geometry)).applyMatrix4(worldMatrix);
        viewPoint.copy(partSphere.center).applyMatrix4(cam.matrixWorldInverse);
        const w = -viewPoint.z;
        if (w <= 1e-6) continue;
        const y = (lens * viewPoint.y) / w;
        const r = (lens * partSphere.radius) / w;
        if (y + r > top) top = y + r;
        if (y - r < bottom) bottom = y - r;
      }
      const bodyShare = top > bottom ? (top - bottom) / 2 : 0;
      // At `CAMERA_ZOOM_MAX` full detail is required of every child whose body
      // alone fills the switch's share; one far up a zoomed frame is small,
      // and the far level is right for her.
      const close = expect === 'full' && bodyShare >= LOD_FULL_ABOVE_SHARE;
      let seen = false;
      for (let p = 0; p < parts.length; p += 1) {
        const chosen = choice[p]!;
        if (chosen < 0) continue;
        const part = parts[p]!;
        const levels = levelMeshes(part, chosen);
        const proxy = member.proxies[p];
        if (levels.length === 0 || !proxy) continue;
        // The mesh drawing her in the main pass: whichever level holds her
        // instance below its count. Before step 16 that was the only mesh.
        const drawing = levels.filter((candidate) => candidate.count > 0 && holds(candidate, proxy.matrixWorld));
        const mesh = drawing[0] ?? levels[0]!;
        worldMatrix.multiplyMatrices(mesh.matrixWorld, proxy.matrixWorld);
        partSphere.copy(enclosingSphere(part.source.geometry)).applyMatrix4(worldMatrix);
        // The "drawn for nobody" side is judged with the crowd's own margin and
        // 2 cm more, so float32 rounding in the buffer can never turn a child
        // the renderer was right to keep into a failure, nor the reverse.
        nearSphere.copy(partSphere);
        nearSphere.radius += CROWD_BOUNDS_MARGIN + 0.02;
        if (view.intersectsSphere(nearSphere)) membersNearScreen.add(member);
        if (view.intersectsSphere(partSphere)) {
          seen = true;
          if (levels.length > 1) {
            partsWithLevels += 1;
            if (drawing.length > 1) {
              failures.push(`${label}: ${mesh.name} draws one child at both levels of detail (${drawing.map((d) => d.name).join(' and ')})`);
            } else if (expect === 'far') {
              partsFarExpected += 1;
              if (drawing[0] === levels[0]) {
                partsAtFullDetail += 1;
                if (levelReports < 6) {
                  levelReports += 1;
                  failures.push(
                    `${label}: ${mesh.name} drawn at full detail (${trisOf(mesh)} triangles, far level ${trisOf(levels[1]!)}) ` +
                      `under the ordinary camera, on a ${viewportCssHeight} CSS px tall viewport`,
                  );
                }
              }
            } else if (close) {
              partsFullExpected += 1;
              if (drawing[0] === levels[1]) {
                partsAtFarLevel += 1;
                if (levelReports < 6) {
                  levelReports += 1;
                  failures.push(
                    `${label}: ${mesh.name} drawn at the far level for a child ${(bodyShare * viewportCssHeight).toFixed(0)} CSS px tall ` +
                      `on a ${viewportCssHeight} px viewport (${bodyShare.toFixed(2)} of the picture), at CAMERA_ZOOM_MAX`,
                  );
                }
              }
            }
          }
          partsOnScreen += 1;
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
        if (part.casts) {
          // Every shadow from the far level: the full-detail mesh of a part
          // that has a far one never casts, and the far one does.
          const castFrom = levels.filter((candidate) => candidate.castShadow);
          if (levels.length > 1) {
            castingPartsChecked += 1;
            if (levels[0]!.castShadow) {
              castFromFull += 1;
              if (castFromFull <= 3) failures.push(`${label}: ${levels[0]!.name} casts its shadow from full detail, beside its far level ${levels[1]!.name}`);
            }
          }
          if (castFrom.length !== 1) {
            failures.push(`${label}: ${levels[0]!.name} casts from ${castFrom.length} meshes, not one`);
          } else if (shadow.intersectsSphere(partSphere)) {
            partsInShadow += 1;
            const caster = castFrom[0]!;
            if (!holds(caster, proxy.matrixWorld, shadowCount(caster))) {
              failures.push(`${label}: ${caster.name} holds no instance for a child in the shadow frustum, within its shadow draw`);
            } else if (!passesShadow(caster, shadow)) {
              failures.push(`${label}: ${caster.name} culled from the shadow pass with a child in the shadow frustum`);
            }
          }
        }
      }
      if (seen && bodyShare > 0 && (expect === 'far' || close)) {
        const px = bodyShare * viewportCssHeight;
        const bucket = expect === 'far' ? tallCss.ordinary : tallCss.close;
        if (px < bucket.min) bucket.min = px;
        if (px > bucket.max) bucket.max = px;
      }
    }
  }

  const t = tally[kind];
  t.poses += 1;
  for (const crowd of crowds) {
    const { parts, members } = insides(crowd);
    for (let p = 0; p < parts.length; p += 1) {
      const part = parts[p]!;
      for (let v = 0; v < part.variants.length; v += 1) for (const mesh of levelMeshes(part, v)) {
        if (passesShadow(mesh, shadow)) t.shadowPassTris += trisOf(mesh) * shadowCount(mesh);
        if (!passes(mesh, view)) continue;
        t.drawCalls += 1;
        t.tris += trisOf(mesh) * mesh.count;
        // Every instance the main pass draws must be a child with something on
        // screen — the casting parts too, whose off-screen children ride past
        // the main pass's count for the shadow pass alone.
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
}

function sameTranslation(a: Matrix4, b: Matrix4): boolean {
  const x = a.elements;
  const y = b.elements;
  for (const k of [12, 13, 14]) if (Math.abs(x[k]! - Math.fround(y[k]!)) > 1e-6 * Math.max(1, Math.abs(y[k]!))) return false;
  return true;
}

/** Places the camera as `Game` would after a door: snapped, then one update. */
function frameOn(focus: Vector3, width: number, height: number, zoomedIn: boolean): void {
  const context = step(focus);
  iso.resize(width, height);
  viewportCssHeight = height;
  if (zoomedIn) iso.snapZoomTarget(CAMERA_ZOOM_MAX);
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
    // `CAMERA_ZOOM_MAX` is the closest the camera gets (larger is closer).
    for (const zoomedIn of [false, true]) {
      // Children in the park, each one put in turn at every edge of the frame.
      for (let k = round % 2; k < kids.length; k += 2) {
        const kid = kids[k]!;
        if (spaceAt(kid.position.x, kid.position.z) !== SPACE_GARDEN) continue;
        target.copy(kid.position);
        frameOn(target, width, height, zoomedIn);
        for (const [ox, oy] of edgeOffsets) {
          // Pushing the child to the right of the frame moves the focus left.
          focus.copy(target)
            .addScaledVector(iso.screenRightAxis as Vector3, -ox * iso.viewHalfWidth)
            .addScaledVector(iso.screenUpAxis as Vector3, -oy * iso.viewHalfHeight);
          focus.y = target.y;
          frameOn(focus, width, height, zoomedIn);
          measure(`round ${round} ${name}${zoomedIn ? ' at CAMERA_ZOOM_MAX' : ''}, ${kid.name} at (${ox},${oy})`, 'park', zoomedIn ? 'full' : 'far');
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
const fmt = (n: number): string => Math.round(n).toLocaleString('en-GB');
for (const kind of ['park', 'interior'] as const) {
  const t = tally[kind];
  console.log(
    `check:crowd-cull ${kind}: ${t.poses} poses; per pose ${(t.drawCalls / t.poses).toFixed(1)} crowd draw calls, ` +
      `${fmt(t.tris / t.poses)} crowd tris in the main pass, ${fmt(t.shadowPassTris / t.poses)} in the sun's shadow pass; ` +
      `main pass off screen: ${fmt(t.wasteTris / t.poses)} (must be 0, casting parts included)`,
  );
  if (t.wasteTris > 0) failures.push(`${kind}: ${fmt(t.wasteTris)} triangles drawn in all for children wholly off screen`);
}
process.stderr.write(
  `check:crowd-cull: ${crowds.size} crowds, ${partsOnScreen} on-screen parts and ${partsInShadow} shadow-frustum parts checked\n`,
);
if (partsOnScreen === 0 || partsInShadow === 0) failures.push('no crowd part was ever on screen — the check measured nothing');

// The far level itself: fewer triangles, and every source vertex within the
// bound of its surface — measured here, point to triangle, in metres of world.
let fullTris = 0;
let lowTris = 0;
let partsWithFarLevel = 0;
let partTotal = 0;
let worstDeviation = 0;
let worstPart = '';
const measuredGeometry = new WeakSet<BufferGeometry>();
const triangle = new Triangle();
const ta = new Vector3(), tb = new Vector3(), tc = new Vector3(), tp = new Vector3(), tq = new Vector3();
const toPrototype = new Matrix4();
for (const crowd of crowds) {
  const prototype = insides(crowd).prototype;
  prototype.updateWorldMatrix(true, true);
  for (const part of insides(crowd).parts) {
    partTotal += 1;
    const source = part.source.geometry;
    const lowMesh = part.low[0];
    const full = triangleCount(source);
    const low = lowMesh ? triangleCount(lowMesh.geometry) : full;
    fullTris += full;
    lowTris += low;
    if (!lowMesh) continue;
    partsWithFarLevel += 1;
    if (!(low < full) || low < 4) failures.push(`${crowd.group.name}: ${lowMesh.name} has ${low} triangles for a ${full}-triangle part`);
    if (measuredGeometry.has(source)) continue;
    measuredGeometry.add(source);
    const scale = toPrototype.copy(prototype.matrixWorld).invert().multiply(part.source.matrixWorld).getMaxScaleOnAxis();
    const sp = source.getAttribute('position');
    const lp = lowMesh.geometry.getAttribute('position');
    const li = lowMesh.geometry.index;
    const lowCorner = (k: number): number => (li ? li.getX(k) : k);
    let worst = 0;
    for (let i = 0; i < sp.count; i += 1) {
      tp.fromBufferAttribute(sp, i);
      let best = Infinity;
      for (let k = 0; k < low * 3 && best > 0; k += 3) {
        ta.fromBufferAttribute(lp, lowCorner(k));
        tb.fromBufferAttribute(lp, lowCorner(k + 1));
        tc.fromBufferAttribute(lp, lowCorner(k + 2));
        triangle.set(ta, tb, tc).closestPointToPoint(tp, tq);
        const d = tq.distanceToSquared(tp);
        if (d < best) best = d;
      }
      if (best > worst) worst = best;
    }
    const metres = Math.sqrt(worst) * scale;
    if (metres > worstDeviation) {
      worstDeviation = metres;
      worstPart = lowMesh.name;
    }
    if (!(metres <= LOD_LOW_TOLERANCE_M)) {
      failures.push(`${crowd.group.name}: ${lowMesh.name} leaves a source vertex ${(metres * 1000).toFixed(2)} mm from its surface, bound ${LOD_LOW_TOLERANCE_M * 1000} mm`);
    }
  }
}
const cssRange = (r: { min: number; max: number }): string => (r.max > 0 ? `${r.min.toFixed(0)}–${r.max.toFixed(0)}` : 'none');
process.stderr.write(
  `check:crowd-cull: level of detail — ${partsWithFarLevel} of ${partTotal} parts have a far level; every part of every crowd ` +
    `${fmt(fullTris)} triangles at full detail, ${fmt(lowTris)} at the far level; worst source vertex ${(worstDeviation * 1000).toFixed(2)} mm ` +
    `from its far level (${worstPart || '—'}), bound ${LOD_LOW_TOLERANCE_M * 1000} mm.\n` +
    `  ${partsWithLevels} on-screen parts with two levels checked for one level each.\n` +
    `  Ordinary camera (park poses at zoom 1, 1440×900 and 390×844 CSS px): children ${cssRange(tallCss.ordinary)} CSS px tall; ` +
    `${partsFarExpected} parts required at the far level, ${partsAtFullDetail} at full detail (must be 0).\n` +
    `  Close (park poses at CAMERA_ZOOM_MAX, children whose body alone is ${LOD_FULL_ABOVE_SHARE} of the picture or more): children ${cssRange(tallCss.close)} CSS px tall; ` +
    `${partsFullExpected} parts required at full detail, ${partsAtFarLevel} at the far level (must be 0).\n` +
    `  The switch is a child's sphere ${LOD_FULL_ABOVE_SHARE} of the picture's height going up, ${LOD_LOW_BELOW_SHARE} coming down — ` +
    `${(LOD_FULL_ABOVE_SHARE * 900).toFixed(0)} / ${(LOD_LOW_BELOW_SHARE * 900).toFixed(0)} CSS px on a 900 px tall viewport, ` +
    `${(LOD_FULL_ABOVE_SHARE * 844).toFixed(0)} / ${(LOD_LOW_BELOW_SHARE * 844).toFixed(0)} on an 844 px one; no pixel ratio enters it, ` +
    `so these verdicts are the same at device pixel ratio 1, 2 and 3. Interiors assert one level, not which.\n` +
    `  Shadows: ${castingPartsChecked} casting parts with a far level checked (per child per pose), ${castFromFull} casting from full detail (must be 0).\n`,
);
if (partsWithLevels === 0) failures.push('no on-screen part had a far level — the level-of-detail half measured nothing');
if (partsFarExpected === 0) failures.push('no part with a far level was on screen on a park pose at zoom 1 — "the far level under the ordinary camera" measured nothing');
if (partsFullExpected === 0) failures.push('no part with a far level was on screen at CAMERA_ZOOM_MAX — "full detail up close" measured nothing');
if (castingPartsChecked === 0) failures.push('no casting part with a far level was measured — "every shadow from the far level" measured nothing');
if (partsWithFarLevel === 0) failures.push('no part of any crowd has a far level — every one was refused or too small');

if (failures.length > 0) {
  const shown = failures.slice(0, 20);
  console.error(`check:crowd-cull FAILED (${failures.length}):\n  ${shown.join('\n  ')}`);
  process.exit(1);
}
console.log('check:crowd-cull passed');
process.exit(0);
