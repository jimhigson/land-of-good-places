import {
  BufferAttribute,
  BufferGeometry,
  DepthFormat,
  DepthTexture,
  FloatType,
  Frustum,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  Object3D,
  RGFormat,
  ShaderMaterial,
  Sphere,
  WebGLRenderTarget,
  type Camera,
  type DirectionalLight,
  type Light,
  type Material,
  type Scene,
  type WebGLRenderer,
} from 'three';

/**
 * **The sun's shadow map, drawn only when something in it changed** (120 fps
 * plan, step 12; `docs/perf/FRAME-DROPS-2026-11.md` on #746, item 7).
 *
 * Measured before this: the sun's 2048² VSM was re-rendered every frame —
 * about 300 of the park's ~600 draw calls and ≈1.0 ms of the 8.3 ms budget —
 * although almost everything in it (the ground, stalls, trees, walls) had not
 * moved since the last frame. Three.js offers one switch, `shadow.autoUpdate`,
 * which is all or nothing: freeze the map and her shadow stays behind when she
 * walks off.
 *
 * So the map is split in two, and only the cheap half is redrawn per frame:
 *
 * - **The static cache** — every caster that has not changed for
 *   {@link SETTLE_MS}, drawn into a depth texture of its own. Redrawn only
 *   when the light moves (`DayNight` moves it in steps: when the sun has
 *   swung far enough to move a shadow by a texel or so, or when she has
 *   walked {@link DayNight}'s re-centre distance) or when a caster in it
 *   changes — moves, appears, disappears, swaps its geometry.
 * - **The composite** — the real map three.js samples. The static depth is
 *   copied in by one full-screen triangle (the {@link sentinel}, which writes
 *   `gl_FragDepth` from the cache), then only the casters that are moving
 *   right now are drawn on top: her, her pets, the NPCs walking near her, a
 *   ride turning. Depth testing makes the result exactly the nearer of the
 *   two, which is what one full pass would have drawn. Then three's own VSM
 *   blur runs as before.
 *
 * Nothing has to be tagged "static" or "dynamic" for this to be right: every
 * frame each shadow-relevant mesh's world matrix, geometry, instance matrices
 * and material are compared with what they were, and anything that changed is
 * moved out of the cache (forcing one cache redraw) and drawn per frame until
 * it has been still for {@link SETTLE_MS}, when it is folded back in. A thing
 * that never moves costs nothing per frame; a thing that never stops costs its
 * own draw calls; nothing is ever drawn in a stale place. That is what keeps a
 * new animated prop correct without anyone remembering to register it.
 *
 * Night is unchanged: below {@link DayNight}'s threshold the map is not drawn
 * at all, as before.
 *
 * ## How it attaches
 *
 * Three's `WebGLShadowMap.render` is wrapped on this one renderer. The sun's
 * shadow is kept at `autoUpdate = false`, so three's own pass skips it, and the
 * wrapper draws it — inside `WebGLRenderer.render`, after the scene's matrices
 * are updated, exactly where three would have. The wrapper calls three's own
 * `render` for both passes, so depth materials, alpha-tested cut-outs,
 * clipping, VSM's "receivers are drawn too" rule and the blur are three's code,
 * not a copy of it; and it decides what each pass sees only with the switches
 * three already reads (`castShadow`/`receiveShadow`, and the root it walks).
 */

/** How long a caster must be unchanged before it is folded back into the cache. */
const SETTLE_MS = 750;

/**
 * Casters this small are left out of both passes: smaller than a toddler's
 * fist across (a bounding sphere of radius {@link TINY_CASTER_RADIUS}), they
 * throw a shadow of a texel or two that VSM's blur all but erases, and
 * they are hundreds of draw calls. See the PR for what this measured.
 */
export const TINY_CASTER_RADIUS = 0;

interface Entry {
  readonly matrix: Float64Array;
  geometry: BufferGeometry | null;
  positionVersion: number;
  indexVersion: number;
  instanceVersion: number;
  count: number;
  drawStart: number;
  drawCount: number;
  material: Material | Material[] | null;
  materialVisible: boolean;
  /** `performance.now()` when a change was last seen; −∞ for "never". */
  changedAt: number;
  /** Whether this mesh is in the static cache as it was last drawn. */
  inStatic: boolean;
  /** Whether it was outside the shadow frustum when last tested at {@link frustumStamp}. */
  outside: boolean;
  frustumStamp: number;
  tiny: boolean;
  /** Frame stamp of the last survey that saw it. */
  seen: number;
  /** Flags saved while a pass hides it. */
  savedCast: boolean;
  savedReceive: boolean;
}

/** What the last frame did, for `?perf=1`, checks and the PR's measurements. */
export interface SunShadowStats {
  /** Frames the wrapper has handled with the sun up. */
  frames: number;
  /** Times the static cache was redrawn. */
  staticPasses: number;
  /** Times the composite (cache + movers) was drawn. */
  compositePasses: number;
  /** Frames on which nothing was drawn at all. */
  skipped: number;
  /** Draw calls the shadow work cost on the last frame. */
  lastDraws: number;
  /** Movers drawn per frame on the last composite. */
  lastMovers: number;
  /** Meshes in the static cache. */
  staticMeshes: number;
  /** Why the cache was last redrawn. */
  lastReason: string;
}

/** An interleaved attribute keeps its version on its buffer. */
function positionVersion(geometry: BufferGeometry): number {
  const attribute = geometry.attributes['position'];
  if (attribute === undefined) return -1;
  return 'isInterleavedBufferAttribute' in attribute ? attribute.data.version : attribute.version;
}

type ShadowRender = (lights: Light[], scene: Object3D, camera: Camera) => void;

export class SunShadowCache {
  private readonly light: DirectionalLight;
  private readonly scene: Scene;
  /** Whether the sun is strong enough to be worth a shadow; set by `DayNight`. */
  active = true;

  private readonly entries = new Map<Object3D, Entry>();
  private readonly seenList: Entry[] = [];
  private readonly seenObjects: Object3D[] = [];
  /** Movers this frame, top-most only (a mover's children are drawn by three's own recursion). */
  private readonly movers: Object3D[] = [];
  private stamp = 0;
  private staticCount = 0;
  private staticSeen = 0;
  private staticTarget: WebGLRenderTarget | null = null;
  /** Light pose the cache was drawn from. */
  private readonly cachedLight = new Matrix4();
  private readonly cachedTarget = new Matrix4();
  private cacheValid = false;
  private frustumStamp = 0;
  private readonly frustum = new Frustum();
  private readonly frustumMatrix = new Matrix4();
  private readonly sphere = new Sphere();
  private dirtyReason = '';

  private readonly proxy = new Object3D();
  private readonly sentinel: Mesh;
  private readonly sentinelDepth: ShaderMaterial;

  private readonly statsValue: SunShadowStats = {
    frames: 0,
    staticPasses: 0,
    compositePasses: 0,
    skipped: 0,
    lastDraws: 0,
    lastMovers: 0,
    staticMeshes: 0,
    lastReason: '',
  };

  constructor(light: DirectionalLight, scene: Scene) {
    this.light = light;
    this.scene = scene;
    // Three's own pass must never touch the sun again: the wrapper owns it.
    light.shadow.autoUpdate = false;
    light.shadow.needsUpdate = false;

    // One triangle covering the whole map; its depth is the cache's.
    const triangle = new BufferGeometry();
    triangle.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.sentinelDepth = new ShaderMaterial({
      name: 'sunShadowCache.restore',
      // Not `glslVersion: GLSL3`: with it three declares no colour output for
      // a ShaderMaterial, and WebGL 2 then *drops the draw* ("active draw
      // buffers with missing fragment shader outputs") — the map's colour
      // attachment is live during the depth pass. Three compiles every
      // ShaderMaterial as `#version 300 es` regardless, so `texelFetch` and
      // `gl_FragDepth` are there, and `gl_FragColor` is its declared output.
      uniforms: { staticDepth: { value: null } },
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform highp sampler2D staticDepth;
        void main() {
          gl_FragDepth = texelFetch(staticDepth, ivec2(gl_FragCoord.xy), 0).r;
          // Overwritten by three's VSM blur, which reads only the depth.
          gl_FragColor = vec4(1.0);
        }
      `,
    });
    this.sentinel = new Mesh(triangle, new MeshBasicMaterial());
    this.sentinel.name = 'sunShadowCache.sentinel';
    this.sentinel.castShadow = true;
    this.sentinel.frustumCulled = false;
    this.sentinel.customDepthMaterial = this.sentinelDepth;
  }

  stats(): Readonly<SunShadowStats> {
    return this.statsValue;
  }

  /** Forget the cache: the next frame redraws it. For anything that changes a caster in a way the survey cannot see. */
  invalidate(reason = 'invalidated'): void {
    this.cacheValid = false;
    this.dirtyReason = reason;
  }

  /**
   * Wraps `renderer.shadowMap.render`. Everything except the sun goes through
   * untouched; the sun is drawn by {@link renderSun}, once per frame, on the
   * world pass (a camera that sees layer 0 — not the ferris car's viewmodel
   * pass, which draws the same scene again on its own layer).
   */
  install(renderer: WebGLRenderer): void {
    const shadowMap = renderer.shadowMap;
    const original = shadowMap.render.bind(shadowMap) as ShadowRender;
    shadowMap.render = (lights: Light[], scene: Scene, camera: Camera): void => {
      original(lights, scene, camera);
      if (scene !== this.scene || (camera.layers.mask & 1) === 0) return;
      if (!lights.includes(this.light)) return;
      this.renderSun(renderer, original, camera);
    };
  }

  private renderSun(renderer: WebGLRenderer, original: ShadowRender, camera: Camera): void {
    const shadow = this.light.shadow;
    const info = renderer.info.render;
    const callsBefore = info.calls;
    if (shadow.map === null) {
      // The first frame: three makes the map (and the shader needs one to
      // sample even at night), drawn the ordinary way.
      shadow.needsUpdate = true;
      original([this.light], this.scene, camera);
      this.cacheValid = false;
      this.dirtyReason = 'first map';
    }
    if (!this.active) {
      this.statsValue.lastDraws = info.calls - callsBefore;
      return;
    }
    this.statsValue.frames++;
    const now = performance.now();

    // The light only moves when DayNight steps it; any step invalidates the cache.
    if (this.cacheValid && (!this.cachedLight.equals(this.light.matrixWorld) || !this.cachedTarget.equals(this.light.target.matrixWorld))) {
      this.cacheValid = false;
      this.dirtyReason = 'light moved';
    }
    if (!this.cacheValid) {
      this.frustumStamp++;
      this.updateFrustum();
    }
    this.survey(camera, now);

    let drew = false;
    if (!this.cacheValid) {
      this.renderStatic(original, camera, now);
      drew = true;
    }
    if (drew || this.movers.length > 0) {
      this.renderComposite(original, camera);
      this.statsValue.compositePasses++;
      this.statsValue.lastMovers = this.movers.length;
    } else {
      this.statsValue.skipped++;
      this.statsValue.lastMovers = 0;
    }
    this.statsValue.lastDraws = info.calls - callsBefore;
  }

  private updateFrustum(): void {
    const camera = this.light.shadow.camera;
    // Exactly what `DirectionalLightShadow.updateMatrices` will do on the pass.
    camera.position.setFromMatrixPosition(this.light.matrixWorld);
    this.sphere.center.setFromMatrixPosition(this.light.target.matrixWorld);
    camera.lookAt(this.sphere.center);
    camera.updateMatrixWorld();
    this.frustumMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.frustumMatrix);
  }

  private inFrustum(object: Object3D): boolean {
    if (!object.frustumCulled) return true;
    return this.frustum.intersectsObject(object as Mesh);
  }

  /**
   * Walks the scene the way three's shadow pass does (`visible` prunes a
   * subtree; the camera's layers decide whether a mesh is drawn; VSM draws
   * receivers as well as casters), and decides for each shadow-relevant mesh
   * whether it changed, whether it is a mover this frame, and whether the
   * cache has to be redrawn.
   */
  private survey(camera: Camera, now: number): void {
    this.stamp++;
    this.seenList.length = 0;
    this.seenObjects.length = 0;
    this.movers.length = 0;
    this.staticSeen = 0;
    this.visit(this.scene, camera.layers.mask, now, false);
    if (this.cacheValid && this.staticSeen !== this.staticCount) {
      this.cacheValid = false;
      this.dirtyReason = 'a cached caster disappeared';
    }
  }

  private visit(object: Object3D, layerMask: number, now: number, underMover: boolean): void {
    if (object.visible === false) return;
    let mover = false;
    const drawable = (object as Mesh).isMesh === true || (object as unknown as { isLine?: boolean }).isLine === true || (object as unknown as { isPoints?: boolean }).isPoints === true;
    if (drawable && (object.castShadow || object.receiveShadow) && (object.layers.mask & layerMask) !== 0) {
      mover = this.classify(object, now);
      if (mover && !underMover) this.movers.push(object);
    }
    const children = object.children;
    for (let i = 0, n = children.length; i < n; i++) {
      this.visit(children[i]!, layerMask, now, underMover || mover);
    }
  }

  /** Returns whether `object` is drawn per frame this frame. */
  private classify(object: Object3D, now: number): boolean {
    let entry = this.entries.get(object);
    if (entry === undefined) {
      entry = {
        matrix: new Float64Array(16),
        geometry: null,
        positionVersion: -1,
        indexVersion: -1,
        instanceVersion: -1,
        count: -1,
        drawStart: -1,
        drawCount: -1,
        material: null,
        materialVisible: true,
        changedAt: -Infinity,
        inStatic: false,
        outside: false,
        frustumStamp: -1,
        tiny: false,
        seen: 0,
        savedCast: false,
        savedReceive: false,
      };
      this.entries.set(object, entry);
      this.snapshot(object, entry);
      entry.tiny = this.isTiny(object as Mesh);
    } else if (this.changed(object, entry)) {
      this.snapshot(object, entry);
      entry.changedAt = now;
      entry.tiny = this.isTiny(object as Mesh);
      entry.frustumStamp = -1;
      if (entry.inStatic && this.cacheValid) {
        this.cacheValid = false;
        this.dirtyReason = `${object.name || object.type} changed`;
      }
    }
    entry.seen = this.stamp;
    this.seenList.push(entry);
    this.seenObjects.push(object);
    if (entry.inStatic) this.staticSeen++;
    if (entry.tiny) return false;

    const moving = now - entry.changedAt < SETTLE_MS;
    if (entry.inStatic && !moving) return false;
    // Not in the cache: does it matter at all? Only if the sun can see it.
    if (entry.frustumStamp !== this.frustumStamp) {
      entry.outside = !this.inFrustum(object);
      entry.frustumStamp = moving ? -1 : this.frustumStamp;
    }
    if (entry.outside) return false;
    if (!moving && this.cacheValid) {
      // Still, in sight, and not cached: it has settled (or just appeared).
      this.cacheValid = false;
      this.dirtyReason = `${object.name || object.type} settled`;
    }
    return moving;
  }

  private isTiny(mesh: Mesh): boolean {
    if (TINY_CASTER_RADIUS <= 0) return false;
    if ((mesh as unknown as { isInstancedMesh?: boolean }).isInstancedMesh === true) return false;
    const geometry = mesh.geometry as BufferGeometry | undefined;
    if (!geometry) return false;
    if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
    const radius = geometry.boundingSphere?.radius ?? Infinity;
    return radius * mesh.matrixWorld.getMaxScaleOnAxis() < TINY_CASTER_RADIUS;
  }

  private changed(object: Object3D, entry: Entry): boolean {
    const m = object.matrixWorld.elements;
    const s = entry.matrix;
    for (let i = 0; i < 16; i++) if (m[i] !== s[i]) return true;
    const mesh = object as Mesh;
    const geometry = (mesh.geometry as BufferGeometry | undefined) ?? null;
    if (geometry !== entry.geometry) return true;
    if (geometry !== null) {
      if (positionVersion(geometry) !== entry.positionVersion) return true;
      if ((geometry.index?.version ?? -1) !== entry.indexVersion) return true;
      if (geometry.drawRange.start !== entry.drawStart || geometry.drawRange.count !== entry.drawCount) return true;
    }
    const instanced = object as unknown as { isInstancedMesh?: boolean; instanceMatrix?: { version: number }; count?: number };
    if (instanced.isInstancedMesh === true) {
      if ((instanced.instanceMatrix?.version ?? -1) !== entry.instanceVersion) return true;
      if ((instanced.count ?? -1) !== entry.count) return true;
    }
    const material = (mesh.material as Material | Material[] | undefined) ?? null;
    if (material !== entry.material) return true;
    if (material !== null && !Array.isArray(material) && material.visible !== entry.materialVisible) return true;
    return false;
  }

  private snapshot(object: Object3D, entry: Entry): void {
    entry.matrix.set(object.matrixWorld.elements);
    const mesh = object as Mesh;
    const geometry = (mesh.geometry as BufferGeometry | undefined) ?? null;
    entry.geometry = geometry;
    entry.positionVersion = geometry === null ? -1 : positionVersion(geometry);
    entry.indexVersion = geometry?.index?.version ?? -1;
    entry.drawStart = geometry?.drawRange.start ?? -1;
    entry.drawCount = geometry?.drawRange.count ?? -1;
    const instanced = object as unknown as { isInstancedMesh?: boolean; instanceMatrix?: { version: number }; count?: number };
    entry.instanceVersion = instanced.isInstancedMesh === true ? (instanced.instanceMatrix?.version ?? -1) : -1;
    entry.count = instanced.isInstancedMesh === true ? (instanced.count ?? -1) : -1;
    const material = (mesh.material as Material | Material[] | undefined) ?? null;
    entry.material = material;
    entry.materialVisible = material !== null && !Array.isArray(material) ? material.visible : true;
  }

  private ensureStaticTarget(): WebGLRenderTarget {
    const map = this.light.shadow.map!;
    const width = map.width;
    const height = map.height;
    if (this.staticTarget && this.staticTarget.width === width && this.staticTarget.height === height) return this.staticTarget;
    this.staticTarget?.depthTexture?.dispose();
    this.staticTarget?.dispose();
    // The same shape three gives a VSM map (WebGLShadowMap), so the pass
    // draws into it exactly as it would into the real one.
    const target = new WebGLRenderTarget(width, height, {
      format: RGFormat,
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
    });
    target.texture.name = 'sunShadowCache.static';
    const depth = new DepthTexture(width, height, FloatType);
    depth.name = 'sunShadowCache.staticDepth';
    depth.format = DepthFormat;
    depth.compareFunction = null;
    depth.minFilter = NearestFilter;
    depth.magFilter = NearestFilter;
    target.depthTexture = depth;
    this.staticTarget = target;
    this.sentinelDepth.uniforms['staticDepth']!.value = depth;
    return target;
  }

  /** Draws every settled caster, and nothing that is moving or tiny, into the cache. */
  private renderStatic(original: ShadowRender, camera: Camera, now: number): void {
    const shadow = this.light.shadow;
    const target = this.ensureStaticTarget();
    // Decide the cache's membership now, and hide everything outside it.
    const hidden: Entry[] = [];
    const hiddenObjects: Object3D[] = [];
    this.staticCount = 0;
    for (let i = 0; i < this.seenList.length; i++) {
      const entry = this.seenList[i]!;
      const object = this.seenObjects[i]!;
      const moving = now - entry.changedAt < SETTLE_MS;
      if (!moving && !entry.tiny && entry.frustumStamp !== this.frustumStamp) {
        entry.outside = !this.inFrustum(object);
        entry.frustumStamp = this.frustumStamp;
      }
      // Out of the sun's sight it is not cached either, so a far-off NPC
      // stopping and starting never costs a redraw.
      entry.inStatic = !moving && !entry.tiny && !entry.outside;
      if (entry.inStatic) {
        this.staticCount++;
      } else {
        entry.savedCast = object.castShadow;
        entry.savedReceive = object.receiveShadow;
        object.castShadow = false;
        object.receiveShadow = false;
        hidden.push(entry);
        hiddenObjects.push(object);
      }
    }
    // Entries not seen this frame are gone (removed or hidden): forget them.
    if (this.entries.size !== this.seenList.length) {
      for (const [object, entry] of this.entries) if (entry.seen !== this.stamp) this.entries.delete(object);
    }
    const real = shadow.map;
    shadow.map = target;
    shadow.needsUpdate = true;
    try {
      original([this.light], this.scene, camera);
    } finally {
      shadow.map = real;
      shadow.needsUpdate = false;
      for (let i = 0; i < hidden.length; i++) {
        hiddenObjects[i]!.castShadow = hidden[i]!.savedCast;
        hiddenObjects[i]!.receiveShadow = hidden[i]!.savedReceive;
      }
    }
    this.cachedLight.copy(this.light.matrixWorld);
    this.cachedTarget.copy(this.light.target.matrixWorld);
    this.cacheValid = true;
    this.statsValue.staticPasses++;
    this.statsValue.staticMeshes = this.staticCount;
    this.statsValue.lastReason = this.dirtyReason;
    // Movers are exactly the seen, non-tiny, non-cached entries in sight;
    // `survey` already collected them, and they stay as they are.
  }

  /** The real map: the cache's depth, then this frame's movers on top, then three's blur. */
  private renderComposite(original: ShadowRender, camera: Camera): void {
    const shadow = this.light.shadow;
    const children = this.proxy.children;
    children.length = 0;
    children.push(this.sentinel);
    for (let i = 0; i < this.movers.length; i++) children.push(this.movers[i]!);
    // Tiny movers' own flags are left alone: a tiny mesh *under* a mover is
    // drawn by three's recursion, which is harmless (a few draws) and keeps
    // the walk identical to three's.
    shadow.needsUpdate = true;
    try {
      original([this.light], this.proxy, camera);
    } finally {
      shadow.needsUpdate = false;
      children.length = 0;
    }
  }
}
