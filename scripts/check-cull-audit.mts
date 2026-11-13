/**
 * **`check:cull-audit` — nothing off the screen is drawn** (120 fps plan, step
 * 10; `docs/perf/FRAME-DROPS-2026-11.md` on #746, "Per-object frustum culling
 * that actually works").
 *
 * Jim, November 2026: *"we shouldn't draw anything off the screen, not just
 * crowds — generalise it."* three.js already skips a mesh whose bounding sphere
 * misses the camera's frustum, but only if (a) the mesh lets it
 * (`frustumCulled`) and (b) the sphere is small enough to miss anything. One
 * `InstancedMesh` holding every bush in the park has a sphere the size of the
 * park, so it is drawn whole — every instance, behind the camera or not —
 * whenever she can see one bush. Nothing goes red when that happens; it just
 * costs triangles a phone does not have.
 *
 * ## What it measures
 *
 * For each space (park, every castle deck, hotel, library, reptile house, the
 * rides), with the clock frozen, it walks the scene exactly as three's
 * `projectObject` does — `visible`, layers, `frustumCulled`, the object's own
 * bounding sphere — so it knows which meshes three **will draw** this frame.
 * Then, for each of those, it asks the honest question three cannot: is any of
 * it actually on the screen? A plain mesh is tested by its geometry's world
 * sphere; an `InstancedMesh` **instance by instance** (its geometry's sphere
 * through that instance's matrix). It reports:
 *
 * - **off-screen draws / triangles**: draws three submits for meshes wholly
 *   outside the frustum, and triangles for every wholly-off-screen mesh and
 *   every off-screen instance of a partly visible one. This is the budget.
 * - **offenders**, by name and cause: `frustumCulled = false`, a bound wider
 *   than {@link OVERSIZED_RADIUS_M} (one sphere for most of the park), or a
 *   **stale bound** — an instanced mesh whose live instances have moved
 *   outside the sphere three cached, which is the opposite fault (something
 *   on screen could be culled) and fails outright.
 *
 * ## Why the instrument can be trusted (its controls)
 *
 * CLAUDE.md: two agents got decisive, wrong answers from instruments that
 * measured the wrong thing, and only a control caught it. This one runs two
 * controls on **every** scene, and a failed control fails the check:
 *
 * 1. **The model of "what three draws" is three's own count.** It renders the
 *    scene once more, shadow pass off, and compares `renderer.info`'s draws
 *    and triangles with what the walk predicted. They must match exactly —
 *    if they do not, the walk is not describing the frame.
 * 2. **"Off-screen" really is off-screen.** It renders *only* what it called
 *    off-screen (every other mesh moved to a spare layer, every on-screen
 *    instance scaled to nothing) into a cleared target and counts pixels: it
 *    must be **zero**. And it renders only what it called on-screen, which
 *    must be **non-zero** — the positive control that the pixel read can see
 *    anything at all.
 *
 * ## The budgets
 *
 * {@link BUDGETS}: measured off-screen draws and triangles per space plus
 * {@link HEADROOM}, ratcheted by hand like `check:render-budget`'s. Lower one
 * when a change removes waste; never raise one to make a PR pass without
 * saying what it buys.
 *
 * ```
 * pnpm run check:served-cull-audit              # starts its own dev server
 * CHECK_CULL_AUDIT_URL=http://127.0.0.1:5947 pnpm run check:cull-audit
 * MEASURE=1 …    # print counts, assert only the controls
 * ONLY=park,hotel …
 * OUT=/path/to/audit.json …   # every scene's offenders, for reading
 * ```
 */
import { writeFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';
import { CANONICAL_PARK_SEED } from '../src/world/parkSeedPool.ts';

const BASE = (process.env.CHECK_CULL_AUDIT_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const SEED = Number(process.env.CHECK_CULL_AUDIT_SEED ?? CANONICAL_PARK_SEED);
const MEASURE = process.env.MEASURE === '1';
const OUT = process.env.OUT;
const SETTLE_FRAMES = 20;
const BOOT_TIMEOUT_MS = 240_000;
/**
 * A bound this wide is one sphere over a large part of the park: it can only
 * miss the frustum when she is looking somewhere else entirely. Tiles from
 * `core/tiledInstances.ts` are well under it (a 24 m tile's sphere is ~20 m).
 */
const OVERSIZED_RADIUS_M = 40;
/**
 * Measured + 10 %, plus a small absolute floor so a space measured at zero can
 * still move by a stray instance (the clock is frozen, but where she and the
 * NPCs stood when it froze differs a little between a GPU and SwiftShader —
 * the same reason `check:render-budget` carries headroom).
 */
const HEADROOM = 1.1;
const FLOOR_TRIS = 2_000;
const FLOOR_DRAWS = 2;

interface Scene {
  readonly path: string;
  /** What the probe must report before sampling: a space id, or its prefix. */
  readonly space: string;
  readonly riding?: boolean;
  /** Measured off-screen draws and triangles on the commit that set them, before {@link HEADROOM}. */
  readonly offDraws: number;
  readonly offTris: number;
}

/** Measured on `perf-step10-instanced-tiles`, canonical seed, 1000×700 at DPR 1. */
const BUDGETS: Readonly<Record<string, Scene>> = {
  park: { path: '/spawn', space: 'garden', offDraws: 0, offTris: 0 },
  'castle deck 0': { path: '/castle?deck=0', space: 'castle.', offDraws: 0, offTris: 0 },
  'castle deck 1': { path: '/castle?deck=1', space: 'castle.', offDraws: 0, offTris: 0 },
  'castle deck 2': { path: '/castle?deck=2', space: 'castle.', offDraws: 0, offTris: 0 },
  hotel: { path: '/hotel', space: 'hotel.', offDraws: 0, offTris: 0 },
  library: { path: '/library', space: 'library', offDraws: 0, offTris: 0 },
  'reptile house': { path: '/reptile-house', space: 'reptileHouse', offDraws: 0, offTris: 0 },
  'rail race': { path: '/rail-race', space: '', riding: true, offDraws: 0, offTris: 0 },
  'sky cruiser': { path: '/sky-cruiser', space: '', riding: true, offDraws: 0, offTris: 0 },
  ferris: { path: '/ferris', space: '', riding: true, offDraws: 0, offTris: 0 },
  slide: { path: '/slide', space: '', riding: true, offDraws: 0, offTris: 0 },
};

const at = (path: string): string => `${BASE}${path}${path.includes('?') ? '&' : '?'}seed=${SEED}&perf=1`;

/** One mesh three will draw this frame that is, wholly or in part, off the screen. */
interface Offender {
  readonly name: string;
  readonly type: string;
  /** Why it is drawn although off-screen. */
  readonly cause: 'frustumCulled=false' | 'oversized bound' | 'bound misses its contents' | 'partly visible';
  readonly offTris: number;
  readonly offDraws: number;
  readonly instances: number;
  readonly offInstances: number;
  readonly boundRadius: number;
}

interface Audit {
  readonly pass: string;
  readonly drawn: { readonly meshes: number; readonly draws: number; readonly tris: number };
  readonly off: { readonly draws: number; readonly tris: number };
  readonly control: {
    readonly infoDraws: number;
    readonly infoTris: number;
    readonly offPixels: number;
    readonly onPixels: number;
    /** Objects three drew that the walk did not predict, and the reverse — both empty when the control holds. */
    readonly walkMissed: readonly string[];
    readonly walkInvented: readonly string[];
  };
  readonly offenders: readonly Offender[];
  /** Instanced meshes whose cached bound no longer contains their live instances. */
  readonly stale: readonly string[];
  /** Drawn meshes with `frustumCulled = false`, by name, whether or not they are off-screen. */
  readonly unculled: readonly string[];
  /** Drawn meshes whose bound is wider than {@link OVERSIZED_RADIUS_M}. */
  readonly oversized: readonly string[];
}

/**
 * Runs **in the page**. Serialised by playwright, so it imports nothing: every
 * three.js type it touches arrives on the objects themselves (`isMesh`,
 * `Sphere.applyMatrix4`, `Matrix4.multiplyMatrices`), and the frustum planes
 * are extracted by hand exactly as `Frustum.setFromProjectionMatrix` does.
 */
function auditInPage(oversizedRadius: number): Audit[] {
  type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const game = (window as unknown as { game: Any }).game;
  const renderer = game.engine.renderer;
  const passes: { name: string; scene: Any; camera: Any }[] = [];
  if (!game.miniGames.hidesPark) {
    passes.push({ name: 'park scene', scene: game.engine.scene, camera: game.cameraOverride ?? game.camera.camera });
  } else if (game.miniGames.game) {
    passes.push({ name: 'mini-game scene', scene: game.miniGames.game.scene, camera: game.miniGames.game.camera });
  }

  const results: Audit[] = [];
  for (const pass of passes) {
    const { scene, camera } = pass;
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();
    const pv = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse).elements as number[];
    const me = pv;
    const raw = [
      [me[3]! - me[0]!, me[7]! - me[4]!, me[11]! - me[8]!, me[15]! - me[12]!],
      [me[3]! + me[0]!, me[7]! + me[4]!, me[11]! + me[8]!, me[15]! + me[12]!],
      [me[3]! + me[1]!, me[7]! + me[5]!, me[11]! + me[9]!, me[15]! + me[13]!],
      [me[3]! - me[1]!, me[7]! - me[5]!, me[11]! - me[9]!, me[15]! - me[13]!],
      [me[3]! - me[2]!, me[7]! - me[6]!, me[11]! - me[10]!, me[15]! - me[14]!],
      [me[3]! + me[2]!, me[7]! + me[6]!, me[11]! + me[10]!, me[15]! + me[14]!],
    ];
    const planes = raw.map(([a, b, c, d]) => {
      const l = Math.hypot(a!, b!, c!);
      return [a! / l, b! / l, c! / l, d! / l] as const;
    });
    const sphereIn = (cx: number, cy: number, cz: number, r: number): boolean => {
      for (const [a, b, c, d] of planes) if (a * cx + b * cy + c * cz + d < -r) return false;
      return true;
    };
    const SphereCtor = (() => {
      // Borrow three's Sphere class from any geometry; there is always one.
      let ctor: Any = null;
      scene.traverse((o: Any) => {
        if (ctor || !o.geometry) return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        ctor = o.geometry.boundingSphere.constructor;
      });
      return ctor;
    })();
    const Matrix4Ctor = camera.matrixWorld.constructor;
    const scratch = new SphereCtor();
    const instanceMatrix = new Matrix4Ctor();
    const world = new Matrix4Ctor();

    const nameOf = (o: Any): string => {
      const parts: string[] = [];
      // A tile of `core/tiledInstances.ts` keeps its mesh's original name; its key tells tiles apart.
      for (let n = o; n && n !== scene; n = n.parent) parts.push((n.name || n.type) + (n.userData?.tile ? `@${n.userData.tile}` : ''));
      return parts.reverse().join('/');
    };

    /**
     * Triangles three counts for one draw of `group` (or the whole geometry), as
     * `renderBufferDirect` does; -1 when it issues no draw at all.
     */
    const drawTris = (object: Any, group: Any): number => {
      const geometry = object.geometry;
      const index = geometry.index;
      const position = geometry.attributes.position;
      if (!position) return 0;
      const dataCount = index ? index.count : position.count;
      const rangeStart = geometry.drawRange.start;
      const rangeCount = geometry.drawRange.count;
      const groupStart = group ? group.start : 0;
      const groupCount = group ? group.count : Infinity;
      const drawStart = Math.max(rangeStart, groupStart);
      const drawEnd = Math.min(dataCount, rangeStart + rangeCount, groupStart + groupCount) - 1;
      const drawCount = Math.max(0, drawEnd - drawStart + 1);
      if (drawCount === 0) return -1;
      const instances = object.isInstancedMesh ? object.count : 1;
      if (object.isInstancedMesh && instances === 0) return -1;
      if (object.isSprite) return drawCount / 3; // a sprite is a quad: three counts its two triangles
      if (!object.isMesh) return 0; // lines and points are counted as draws, not triangles
      return (drawCount / 3) * instances;
    };
    /**
     * How many times three draws one item: a transparent, double-sided material
     * is drawn twice — back faces, then front (`WebGLRenderer.renderObject`,
     * unless `forceSinglePass`). `2` is three's `DoubleSide`.
     */
    const passes = (m: Any): number => (m.transparent === true && m.side === 2 && m.forceSinglePass === false ? 2 : 1);
    /** Draw items three pushes for one object: one per visible material group, or one. */
    const drawItems = (object: Any): { draws: number; tris: number; trisPerInstanceSet: number } => {
      const material = object.material;
      if (Array.isArray(material)) {
        let draws = 0;
        let tris = 0;
        for (const group of object.geometry.groups) {
          const m = material[group.materialIndex];
          if (m && m.visible) {
            const t = drawTris(object, group);
            if (t >= 0) {
              draws += passes(m);
              tris += t * passes(m);
            }
          }
        }
        return { draws, tris, trisPerInstanceSet: tris };
      }
      if (!material || !material.visible) return { draws: 0, tris: 0, trisPerInstanceSet: 0 };
      const t = drawTris(object, null);
      if (t < 0) return { draws: 0, tris: 0, trisPerInstanceSet: 0 };
      return { draws: passes(material), tris: t * passes(material), trisPerInstanceSet: t * passes(material) };
    };
    /** The sphere three culls this object by, in world space — `Frustum.intersectsObject`. */
    const cullSphere = (object: Any): Any => {
      if (object.boundingSphere !== undefined) {
        if (object.boundingSphere === null) object.computeBoundingSphere();
        return scratch.copy(object.boundingSphere).applyMatrix4(object.matrixWorld);
      }
      if (object.geometry.boundingSphere === null) object.geometry.computeBoundingSphere();
      return scratch.copy(object.geometry.boundingSphere).applyMatrix4(object.matrixWorld);
    };

    const drawnMeshes: Any[] = [];
    let drawnDraws = 0;
    let drawnTris = 0;
    const project = (object: Any): void => {
      if (object.visible === false) return;
      if (object.layers.test(camera.layers)) {
        if (object.isSprite) {
          // `Frustum.intersectsSprite`: a unit quad's half-diagonal, wider by how far its centre is offset.
          let drawn = !object.frustumCulled;
          if (!drawn) {
            const offset = Math.hypot((object.center?.x ?? 0.5) - 0.5, (object.center?.y ?? 0.5) - 0.5);
            scratch.center.set(0, 0, 0);
            scratch.radius = 0.7071067811865476 + offset;
            scratch.applyMatrix4(object.matrixWorld);
            drawn = sphereIn(scratch.center.x, scratch.center.y, scratch.center.z, scratch.radius);
          }
          const items = drawn ? drawItems(object) : { draws: 0, tris: 0 };
          if (items.draws > 0) {
            drawnMeshes.push(object);
            drawnDraws += items.draws;
            drawnTris += items.tris;
          }
        } else if (object.isMesh || object.isLine || object.isPoints) {
          if (object.isBatchedMesh) throw new Error(`BatchedMesh ${nameOf(object)} — the audit does not model it yet`);
          let drawn = !object.frustumCulled;
          if (!drawn) {
            const s = cullSphere(object);
            drawn = sphereIn(s.center.x, s.center.y, s.center.z, s.radius);
          }
          if (drawn) {
            const items = drawItems(object);
            if (items.draws > 0) {
              drawnMeshes.push(object);
              drawnDraws += items.draws;
              drawnTris += items.tris;
            }
          }
        }
      }
      for (const child of object.children) project(child);
    };
    project(scene);

    // ------------------------------------------------ what is really on screen
    const offenders: Offender[] = [];
    const stale: string[] = [];
    const unculled: string[] = [];
    const oversized: string[] = [];
    let offDraws = 0;
    let offTris = 0;
    /** Per object: on-screen instance flags (instanced) or whole-object flag. */
    const onScreen = new Map<Any, boolean | Uint8Array>();
    for (const object of drawnMeshes) {
      const name = nameOf(object);
      const items = drawItems(object);
      const boundRadius = object.frustumCulled ? cullSphere(object).radius : Infinity;
      if (!object.frustumCulled) unculled.push(name);
      else if (boundRadius > oversizedRadius) oversized.push(`${name} (${boundRadius.toFixed(0)} m)`);
      if (object.isInstancedMesh) {
        const geometry = object.geometry;
        if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
        const n = object.count;
        const flags = new Uint8Array(n);
        let off = 0;
        let escaped = 0;
        const cached = object.frustumCulled && object.boundingSphere ? scratch.clone().copy(object.boundingSphere) : null;
        for (let i = 0; i < n; i += 1) {
          object.getMatrixAt(i, instanceMatrix);
          const e = instanceMatrix.elements;
          const zero = e[0] === 0 && e[1] === 0 && e[2] === 0 && e[4] === 0 && e[5] === 0 && e[6] === 0 && e[8] === 0 && e[9] === 0 && e[10] === 0;
          if (zero) {
            off += 1;
            continue;
          }
          const local = scratch.copy(geometry.boundingSphere).applyMatrix4(instanceMatrix);
          if (cached) {
            const d = local.center.distanceTo(cached.center) + local.radius;
            if (d > cached.radius * (1 + 1e-4) + 1e-4) escaped += 1;
          }
          world.copy(object.matrixWorld).multiply(instanceMatrix);
          const s = scratch.copy(geometry.boundingSphere).applyMatrix4(world);
          if (sphereIn(s.center.x, s.center.y, s.center.z, s.radius)) flags[i] = 1;
          else off += 1;
        }
        if (escaped > 0) stale.push(`${name}: ${escaped} of ${n} instances outside the cached bound`);
        onScreen.set(object, flags);
        if (off > 0) {
          const perInstance = n > 0 ? items.tris / n : 0;
          const whole = off === n;
          const t = Math.round(perInstance * off);
          offTris += t;
          if (whole) offDraws += items.draws;
          offenders.push({
            name,
            type: object.type,
            cause: !object.frustumCulled
              ? 'frustumCulled=false'
              : escaped > 0
                ? 'bound misses its contents'
                : boundRadius > oversizedRadius
                  ? 'oversized bound'
                  : 'partly visible',
            offTris: t,
            offDraws: whole ? items.draws : 0,
            instances: n,
            offInstances: off,
            boundRadius,
          });
        }
      } else {
        let visible: boolean;
        if (object.isSprite) {
          visible = true;
        } else {
          const geometry = object.geometry;
          const sphere =
            object.boundingSphere !== undefined && object.boundingSphere !== null
              ? scratch.copy(object.boundingSphere).applyMatrix4(object.matrixWorld)
              : (geometry.boundingSphere === null && geometry.computeBoundingSphere(),
                scratch.copy(geometry.boundingSphere).applyMatrix4(object.matrixWorld));
          visible = sphereIn(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius);
        }
        onScreen.set(object, visible);
        if (!visible) {
          offDraws += items.draws;
          offTris += items.tris;
          offenders.push({
            name,
            type: object.type,
            cause: !object.frustumCulled ? 'frustumCulled=false' : boundRadius > oversizedRadius ? 'oversized bound' : 'bound misses its contents',
            offTris: items.tris,
            offDraws: items.draws,
            instances: 1,
            offInstances: 1,
            boundRadius,
          });
        }
      }
    }

    // ------------------------------------------------ control 1: three's own count
    const shadowAuto = renderer.shadowMap.autoUpdate;
    const shadowNeeds = renderer.shadowMap.needsUpdate;
    const autoReset = renderer.info.autoReset;
    const target0 = renderer.getRenderTarget();
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.info.autoReset = true;
    const W = 400;
    const H = Math.max(1, Math.round(W / (camera.aspect ?? 1)));
    const RT = renderer.getRenderTarget()?.constructor;
    // The target class: borrow it from the renderer's shadow maps if none is bound.
    let TargetCtor: Any = RT ?? null;
    if (!TargetCtor) {
      game.engine.scene.traverse((o: Any) => {
        if (!TargetCtor && o.isLight && o.shadow && o.shadow.map) TargetCtor = o.shadow.map.constructor;
      });
    }
    // Record what three really hands to the GPU, so a failed control names the
    // objects the walk got wrong instead of two numbers that differ.
    const reallyDrawn = new Set<Any>();
    const renderBufferDirect = renderer.renderBufferDirect;
    renderer.renderBufferDirect = function (this: Any, ...args: Any[]): Any {
      reallyDrawn.add(args[4]);
      return renderBufferDirect.apply(this, args);
    };
    try {
      renderer.render(scene, camera);
    } finally {
      renderer.renderBufferDirect = renderBufferDirect;
    }
    const infoDraws = renderer.info.render.calls;
    const infoTris = renderer.info.render.triangles;
    const predicted = new Set<Any>(drawnMeshes);
    const describe = (o: Any): string => `${nameOf(o) || o.type}${o.parent ? '' : ' (not in the scene graph)'}`;
    const walkMissed = [...reallyDrawn].filter((o) => !predicted.has(o) && !(o.isInstancedMesh && o.count === 0)).map(describe);
    const walkInvented = drawnMeshes.filter((o: Any) => !reallyDrawn.has(o)).map(describe);

    // ------------------------------------------------ control 2: off-screen draws nothing
    let offPixels = -1;
    let onPixels = -1;
    if (TargetCtor) {
      const target = new TargetCtor(W, H);
      const pixels = new Uint8Array(W * H * 4);
      const SPARE = 31;
      const savedCameraLayers = camera.layers.mask;
      const savedBackground = scene.background;
      const savedFog = scene.fog;
      const restoreMatrices: (() => void)[] = [];
      const renderOnly = (wantOn: boolean): number => {
        const enabled: Any[] = [];
        for (const [object, flags] of onScreen) {
          if (flags instanceof Uint8Array) {
            const want = Array.from(flags).some((f) => (f === 1) === wantOn);
            if (!want) continue;
            // Keep the array, then scale every instance of the wrong kind to nothing.
            const saved = object.instanceMatrix.array.slice();
            restoreMatrices.push(() => {
              object.instanceMatrix.array.set(saved);
              object.instanceMatrix.needsUpdate = true;
            });
            const arr = object.instanceMatrix.array;
            for (let i = 0; i < flags.length; i += 1) {
              if ((flags[i] === 1) !== wantOn) for (let k = 0; k < 16; k += 1) arr[i * 16 + k] = 0;
            }
            object.instanceMatrix.needsUpdate = true;
          } else if (flags !== wantOn) continue;
          enabled.push(object);
          object.layers.enable(SPARE);
        }
        camera.layers.set(SPARE);
        scene.background = null;
        scene.fog = null;
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, true, true);
        // Frustum culling off for the control: it must not hide what we are asking about.
        const culled: [Any, boolean][] = [];
        for (const object of enabled) {
          culled.push([object, object.frustumCulled]);
          object.frustumCulled = false;
        }
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, W, H, pixels);
        for (const [object, was] of culled) object.frustumCulled = was;
        for (const object of enabled) object.layers.disable(SPARE);
        for (const restore of restoreMatrices.splice(0)) restore();
        let lit = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i]! | pixels[i + 1]! | pixels[i + 2]! | pixels[i + 3]!) lit += 1;
        }
        return lit;
      };
      const ColorCtor = game.engine.scene.fog.color.constructor;
      const clearColor = renderer.getClearColor(new ColorCtor());
      const clearAlpha = renderer.getClearAlpha();
      try {
        offPixels = renderOnly(false);
        onPixels = renderOnly(true);
      } finally {
        camera.layers.mask = savedCameraLayers;
        scene.background = savedBackground;
        scene.fog = savedFog;
        renderer.setClearColor(clearColor, clearAlpha);
        target.dispose();
      }
    }
    renderer.setRenderTarget(target0);
    renderer.shadowMap.autoUpdate = shadowAuto;
    renderer.shadowMap.needsUpdate = shadowNeeds;
    renderer.info.autoReset = autoReset;

    offenders.sort((a, b) => b.offTris - a.offTris || b.offDraws - a.offDraws);
    results.push({
      pass: pass.name,
      drawn: { meshes: drawnMeshes.length, draws: drawnDraws, tris: drawnTris },
      off: { draws: offDraws, tris: offTris },
      control: { infoDraws, infoTris, offPixels, onPixels, walkMissed, walkInvented },
      offenders,
      stale,
      unculled,
      oversized,
    });
  }
  return results;
}

async function settle(page: Page, scene: Scene): Promise<void> {
  const settledFrom = await page.waitForFunction(
    ({ space, riding }) => {
      const perf = (window as unknown as { __perf?: { frameCount: number; context(): Record<string, unknown> } }).__perf;
      if (!perf) return false;
      const context = perf.context();
      if (!String(context['space']).startsWith(space)) return false;
      if (riding && context['riding'] !== true) return false;
      return perf.frameCount;
    },
    { space: scene.space, riding: scene.riding === true },
    { timeout: BOOT_TIMEOUT_MS, polling: 200 },
  );
  const from = Number(await settledFrom.jsonValue());
  await page.waitForFunction(
    (until) => (window as unknown as { __perf: { frameCount: number } }).__perf.frameCount >= until,
    from + SETTLE_FRAMES,
    { timeout: BOOT_TIMEOUT_MS, polling: 200 },
  );
  // Freeze the world (see check-render-budget.mts for why), then let two frames draw it still.
  const frozen = await page.evaluate(() => {
    const g = (window as unknown as { game?: { timeScale: number } }).game;
    if (!g) return false;
    g.timeScale = 0;
    return true;
  });
  if (!frozen) throw new Error('no window.game to freeze — run against the dev server (`check:served-cull-audit`)');
  const now = await page.evaluate(() => (window as unknown as { __perf: { frameCount: number } }).__perf.frameCount);
  await page.waitForFunction(
    (until) => (window as unknown as { __perf: { frameCount: number } }).__perf.frameCount >= until,
    now + 3,
    { timeout: BOOT_TIMEOUT_MS, polling: 100 },
  );
}

async function runScene(name: string, scene: Scene): Promise<{ result?: Audit[]; space?: string; error?: string }> {
  const args = ['--mute-audio', ...(process.env.SWIFTSHADER === '1' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])];
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args });
  const errors: string[] = [];
  const seeds: number[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String((e as Error)?.message ?? e)));
    page.on('console', (message) => {
      const said = /park seed (\d+)/.exec(message.text());
      if (said) seeds.push(Number(said[1]));
    });
    await page.goto(at(scene.path), { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await settle(page, scene);
    const result = await page.evaluate(auditInPage, OVERSIZED_RADIUS_M);
    const space = await page.evaluate(() =>
      String((window as unknown as { __perf: { context(): Record<string, unknown> } }).__perf.context()['space']),
    );
    const wrong = seeds.filter((s) => s !== SEED);
    if (seeds.length === 0) return { error: `${name}: the page never reported its park seed, so the pin to ${SEED} is unproven` };
    if (wrong.length > 0) return { error: `${name}: asked for park seed ${SEED}, the page built ${wrong.join(', ')}` };
    if (errors.length > 0) return { error: `${name}: page errors: ${errors.slice(0, 3).join(' | ')}` };
    return { result, space };
  } catch (error) {
    return { error: `${name} (${scene.path}): ${String((error as Error)?.message ?? error).split('\n')[0]}${errors.length ? ` — page errors: ${errors.slice(0, 3).join(' | ')}` : ''}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

const say = (line: string): void => {
  process.stderr.write(`[cull-audit] ${line}\n`);
};

try {
  const response = await fetch(`${BASE}/`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
} catch (error) {
  throw new Error(
    `check:cull-audit: nothing is serving ${BASE} (${String(error)}). ` +
      'Run `pnpm run check:served-cull-audit`, or point CHECK_CULL_AUDIT_URL at your own dev server.',
  );
}

const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const failures: string[] = [];
const dump: Record<string, unknown> = {};
let measured = 0;
for (const [name, scene] of Object.entries(BUDGETS)) {
  if (only && !only.has(name)) continue;
  const started = Date.now();
  const { result, space, error } = await runScene(name, scene);
  const secs = ((Date.now() - started) / 1000).toFixed(0);
  if (error || !result) {
    failures.push(error ?? `${name}: no result`);
    say(`${name}: FAILED to measure (${secs} s) — ${error}`);
    continue;
  }
  if (result.length === 0) {
    failures.push(`${name}: no scene was being drawn, so nothing was audited`);
    continue;
  }
  measured += 1;
  dump[name] = { space, passes: result };
  let offDraws = 0;
  let offTris = 0;
  for (const audit of result) {
    offDraws += audit.off.draws;
    offTris += audit.off.tris;
    const c = audit.control;
    say(
      `${name.padEnd(14)} ${String(space).padEnd(14)} ${audit.pass}: drawn ${audit.drawn.meshes} meshes, ${audit.drawn.draws} draws, ${audit.drawn.tris} tris` +
        ` | OFF-SCREEN ${audit.off.draws} draws, ${audit.off.tris} tris | ${secs} s`,
    );
    say(`  control: three counted ${c.infoDraws} draws, ${c.infoTris} tris; pixels from off-screen set ${c.offPixels}, from on-screen set ${c.onPixels}`);
    for (const o of audit.offenders.slice(0, 8)) {
      say(
        `    ${o.offTris.toString().padStart(9)} tris ${o.offDraws.toString().padStart(3)} draws  ${o.cause.padEnd(26)} ` +
          `${o.offInstances}/${o.instances} inst, r ${Number.isFinite(o.boundRadius) ? o.boundRadius.toFixed(0) : '∞'} m  ${o.name}`,
      );
    }
    if (audit.offenders.length > 8) say(`    … ${audit.offenders.length - 8} more offenders`);
    if (audit.unculled.length) say(`  frustumCulled=false and drawn: ${audit.unculled.length} (${audit.unculled.slice(0, 6).join(', ')}${audit.unculled.length > 6 ? ', …' : ''})`);
    if (audit.oversized.length) say(`  bound wider than ${OVERSIZED_RADIUS_M} m: ${audit.oversized.join(', ')}`);
    // Controls fail the check whatever MEASURE says: an instrument that fails its control measured nothing.
    if (c.infoDraws !== audit.drawn.draws || c.infoTris !== audit.drawn.tris) {
      failures.push(
        `${name}: CONTROL — the walk predicted ${audit.drawn.draws} draws / ${audit.drawn.tris} tris, three drew ${c.infoDraws} / ${c.infoTris}; the audit is not describing the frame` +
          ` (three drew but the walk missed: ${c.walkMissed.slice(0, 5).join(', ') || 'nothing'}; the walk predicted but three skipped: ${c.walkInvented.slice(0, 5).join(', ') || 'nothing'})`,
      );
    }
    if (c.offPixels !== 0) failures.push(`${name}: CONTROL — what the audit called off-screen lit ${c.offPixels} pixels; its "off-screen" is wrong`);
    if (!(c.onPixels > 0)) failures.push(`${name}: CONTROL — what the audit called on-screen lit ${c.onPixels} pixels; the pixel read cannot see anything`);
    for (const s of audit.stale) failures.push(`${name}: stale bound — ${s} (three may cull something on screen)`);
  }
  if (MEASURE) continue;
  const drawCeiling = Math.max(FLOOR_DRAWS, Math.ceil(scene.offDraws * HEADROOM));
  const triCeiling = Math.max(FLOOR_TRIS, Math.ceil(scene.offTris * HEADROOM));
  say(`  budget: off-screen draws ${offDraws} / ceiling ${drawCeiling}, off-screen tris ${offTris} / ceiling ${triCeiling}`);
  if (offDraws > drawCeiling) failures.push(`${name}: ${offDraws} draws a frame for meshes wholly off the screen, ceiling ${drawCeiling} (measured ${scene.offDraws})`);
  if (offTris > triCeiling) failures.push(`${name}: ${offTris} triangles a frame off the screen, ceiling ${triCeiling} (measured ${scene.offTris})`);
}

if (OUT) writeFileSync(OUT, JSON.stringify(dump, null, 2));
say(`audited ${measured} of ${Object.keys(BUDGETS).length} spaces on park seed ${SEED}; the game camera's frustum only (the shadow pass culls against the light's)`);
if (failures.length > 0) {
  console.error(`\ncheck:cull-audit FAILED:\n  - ${failures.join('\n  - ')}`);
  process.exitCode = 1;
} else if (MEASURE) {
  say('MEASURE=1: counts printed, budgets not asserted (controls were)');
} else {
  console.log('check:cull-audit: every space is within its off-screen budget, and both controls held.');
}
