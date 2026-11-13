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
  RedFormat,
  UnsignedByteType,
  ShaderMaterial,
  Sphere,
  WebGLRenderTarget,
  type Camera,
  type DirectionalLight,
  type Light,
  type Material,
  type Scene,
  type Texture,
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

/**
 * Whether the cache is switched on. **Off unless the URL says `?shadowCache=1`**
 * while it is being proved: off, `DayNight` leaves the sun's map to three.js
 * exactly as before step 12 (redrawn in full every frame).
 */
export function sunShadowCacheRequested(): boolean {
  if (typeof location === 'undefined') return false;
  const asked = new URLSearchParams(location.search).get('shadowCache');
  if (asked === '1') return true;
  if (asked === '0') return false;
  return SUN_SHADOW_CACHE_DEFAULT;
}

/**
 * The one line to flip once somebody has watched it in motion. Stills match
 * three's own pass (see HANDOFF-perf-step12.md); walking, the re-centre steps
 * and the sun's steps have been counted but not yet looked at frame by frame.
 */
export const SUN_SHADOW_CACHE_DEFAULT = false;

/**
 * Everything about one mesh that three's shadow pass reads, as it was when the
 * survey last looked. A mesh whose snapshot no longer matches has changed.
 *
 * Buffers are held **by identity as well as by version**: a freshly made
 * attribute starts at version 0 like the one it replaced, so a geometry given
 * a new position array or index compared equal by version alone — the audit
 * found it (85,885 stale texels from one swapped attribute on a fairy pole).
 */
interface Entry {
  readonly matrix: Float64Array;
  geometry: BufferGeometry | null;
  /** The position attribute, or the interleaved buffer that holds it. */
  position: object | null;
  positionVersion: number;
  index: object | null;
  indexVersion: number;
  instanceMatrix: object | null;
  instanceVersion: number;
  count: number;
  drawStart: number;
  drawCount: number;
  material: Material | Material[] | null;
  /** Which of the materials draw (bit `i` for `material[i]`; bit 0 for a single one). */
  materialVisible: number;
  /** What three's depth pass copies off a single material (`WebGLShadowMap.getDepthMaterial`). */
  side: number;
  shadowSide: number | null;
  alphaTest: number;
  /** The textures it alpha-tests with; null when `alphaTest` is 0, as three then ignores them. */
  alphaMap: Texture | null;
  map: Texture | null;
  wireframe: boolean;
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

/**
 * What {@link SunShadowCache.audit} found: the map the cache produced this
 * frame against the map three.js's own pass draws from the same light pose,
 * texel by texel. A correct cache differs in **zero** texels — the composite is
 * the nearer of two depths that one full pass would also have drawn, and the
 * blur is three's — so any non-zero count is a caster the survey missed.
 */
export interface SunShadowAudit {
  /** What the cache did this frame: redrew the cache, drew movers over it, or kept last frame's map. */
  readonly frame: 'static' | 'composite' | 'skipped';
  /** Texels compared (the whole map). */
  readonly texels: number;
  /** Texels whose blurred moments differ at all. */
  readonly differing: number;
  /** Largest difference in the first moment (light-space depth, 0..1). */
  readonly maxDepthDiff: number;
  /** Texels where the reference was drawn at all (depth < 1): proves the comparison saw a map. */
  readonly drawnTexels: number;
  /** Bounding box of the differing texels, `[minX, minY, maxX, maxY]`, or null. */
  readonly box: readonly [number, number, number, number] | null;
  readonly movers: number;
  readonly staticMeshes: number;
}

/** An interleaved attribute keeps its data, and its version, on its buffer. */
function positionSource(geometry: BufferGeometry): { version: number } | null {
  const attribute = geometry.attributes['position'];
  if (attribute === undefined) return null;
  return 'isInterleavedBufferAttribute' in attribute ? attribute.data : attribute;
}

/** A material's `map` or `alphaMap`, which only some material types have. */
function textureOf(material: Material, key: 'map' | 'alphaMap'): Texture | null {
  return ((material as unknown as Record<string, unknown>)[key] as Texture | null | undefined) ?? null;
}

/** Bit `i` set when material `i` draws; a single material is bit 0. */
function visibilityMask(material: Material | Material[] | null): number {
  if (material === null) return 0;
  if (!Array.isArray(material)) return material.visible ? 1 : 0;
  let mask = 0;
  for (let i = 0, n = Math.min(material.length, 31); i < n; i++) if (material[i]?.visible) mask |= 1 << i;
  return mask;
}

/**
 * A mesh whose shape is decided in the vertex shader from state the survey
 * cannot compare cheaply — bones, morph weights — is treated as moving every
 * frame: drawn per frame, never cached. None exist in the park today; this is
 * so the first one does not freeze its own shadow.
 */
function deformsInShader(object: Object3D): boolean {
  const mesh = object as Mesh & { isSkinnedMesh?: boolean };
  return mesh.isSkinnedMesh === true || (mesh.morphTargetInfluences !== undefined && mesh.morphTargetInfluences.length > 0);
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
  /**
   * Where the static pass's depth is **kept**. Three's VSM blur ends by
   * clearing the map it has just blurred — depth included — so the depth the
   * static pass drew is gone by the time `render` returns. {@link tap} copies
   * it here first, and this is what the {@link sentinel} restores from.
   */
  private keepTarget: WebGLRenderTarget | null = null;
  /** Drawn last in the static pass (it draws nothing); its `onAfterShadow` copies the finished depth out. */
  private readonly tap: Mesh;
  private renderer: WebGLRenderer | null = null;
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

  /** Audits asked for and not yet run; each is answered on the next frame the sun is drawn. See {@link audit}. */
  private readonly auditsPending: ((result: SunShadowAudit) => void)[] = [];
  /** Where an audit draws three's own map. Made on the first audit, never otherwise. */
  private auditTarget: WebGLRenderTarget | null = null;

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
    // The tap: the same triangle, moved wholly outside clip space.
    this.tap = new Mesh(triangle, new MeshBasicMaterial());
    this.tap.name = 'sunShadowCache.tap';
    this.tap.castShadow = true;
    this.tap.frustumCulled = false;
    this.tap.customDepthMaterial = new ShaderMaterial({
      name: 'sunShadowCache.tap',
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }
      `,
      // Clipped away by the vertex stage; the colour is written only so the
      // program has the output WebGL 2 insists on (see the sentinel's note).
      fragmentShader: /* glsl */ `
        void main() {
          gl_FragColor = vec4(1.0);
        }
      `,
    });
    this.tap.onAfterShadow = () => {
      const from = this.staticTarget?.depthTexture;
      const to = this.keepTarget?.depthTexture;
      if (this.renderer && from && to) this.renderer.copyTextureToTexture(from, to);
    };
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
    // Three's own pass must never touch the sun again: the wrapper owns it.
    this.light.shadow.autoUpdate = false;
    this.light.shadow.needsUpdate = false;
    this.renderer = renderer;
    const shadowMap = renderer.shadowMap;
    const original = shadowMap.render.bind(shadowMap) as ShadowRender;
    shadowMap.render = (lights: Light[], scene: Scene, camera: Camera): void => {
      // Three's own switch for the whole pass, read before its render clears
      // `needsUpdate`. Off, three draws nothing — and nor may the cache, or it
      // would mark a map it never drew as valid (`check:cull-audit` renders
      // with the pass off to count the main pass's draws alone).
      const passOn = shadowMap.enabled && (shadowMap.autoUpdate || shadowMap.needsUpdate);
      original(lights, scene, camera);
      if (!passOn || scene !== this.scene || (camera.layers.mask & 1) === 0) return;
      if (!lights.includes(this.light)) return;
      const oneShot = !shadowMap.autoUpdate;
      try {
        // A one-shot global update (`autoUpdate` off, `needsUpdate` on) was
        // spent by the call above; the sun's own calls need it again.
        if (oneShot) shadowMap.autoUpdate = true;
        this.renderSun(renderer, original, camera);
      } finally {
        if (oneShot) shadowMap.autoUpdate = false;
      }
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
    if (this.auditsPending.length > 0) {
      this.runAudit(renderer, original, camera, drew ? 'static' : this.movers.length > 0 ? 'composite' : 'skipped');
    }
  }

  /**
   * **Checks the cache against three.js itself**, on the next frame the sun is
   * drawn: after the cache has produced its map, three's own pass draws the
   * whole map again from the same light pose into a target of its own, and the
   * two are compared texel by texel. Resolves with what it found.
   *
   * For checks and harnesses (`window.game` on the dev server); nothing in the
   * game calls it, and until something does it costs nothing — not even the
   * target, which is made on the first audit. An audit frame is slow: it draws
   * the sun's map twice and reads two maps back.
   */
  audit(): Promise<SunShadowAudit> {
    return new Promise((resolve) => this.auditsPending.push(resolve));
  }

  private runAudit(renderer: WebGLRenderer, original: ShadowRender, camera: Camera, frame: SunShadowAudit['frame']): void {
    const shadow = this.light.shadow;
    const map = shadow.map;
    if (map === null) return;
    const width = map.width;
    const height = map.height;
    if (!this.auditTarget || this.auditTarget.width !== width || this.auditTarget.height !== height) {
      this.auditTarget?.depthTexture?.dispose();
      this.auditTarget?.dispose();
      this.auditTarget = this.vsmTarget(width, height, 'sunShadowCache.audit');
    }
    // Three's WebGL renderer makes the sun's map a WebGLRenderTarget; the type
    // says only RenderTarget because the light is shared with WebGPU.
    const cached = this.readMoments(renderer, map as WebGLRenderTarget);
    shadow.map = this.auditTarget;
    shadow.needsUpdate = true;
    try {
      original([this.light], this.scene, camera);
    } finally {
      shadow.map = map;
      shadow.needsUpdate = false;
    }
    const reference = this.readMoments(renderer, this.auditTarget);
    let differing = 0;
    let drawnTexels = 0;
    let maxDepthDiff = 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0, n = width * height; i < n; i++) {
      const r = reference[i * 4]!;
      if (r < 1) drawnTexels++;
      const depthDiff = Math.abs(cached[i * 4]! - r);
      if (depthDiff === 0 && cached[i * 4 + 1] === reference[i * 4 + 1]) continue;
      differing++;
      if (depthDiff > maxDepthDiff) maxDepthDiff = depthDiff;
      const x = i % width;
      const y = (i - x) / width;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const result: SunShadowAudit = {
      frame,
      texels: width * height,
      differing,
      maxDepthDiff,
      drawnTexels,
      box: differing > 0 ? [minX, minY, maxX, maxY] : null,
      movers: this.movers.length,
      staticMeshes: this.staticCount,
    };
    const waiting = this.auditsPending.splice(0);
    for (const resolve of waiting) resolve(result);
  }

  /** A VSM map's colour (the blurred moments), read back as RGBA floats. */
  private readMoments(renderer: WebGLRenderer, target: WebGLRenderTarget): Float32Array {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const previous = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace();
    const level = renderer.getActiveMipmapLevel();
    const out = new Float32Array(target.width * target.height * 4);
    renderer.setRenderTarget(target);
    // RGBA/FLOAT is the read every float colour buffer accepts in WebGL 2.
    gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.FLOAT, out);
    renderer.setRenderTarget(previous, face, level);
    return out;
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
        position: null,
        positionVersion: -1,
        index: null,
        indexVersion: -1,
        instanceMatrix: null,
        instanceVersion: -1,
        count: -1,
        drawStart: -1,
        drawCount: -1,
        material: null,
        materialVisible: 0,
        side: -1,
        shadowSide: null,
        alphaTest: 0,
        alphaMap: null,
        map: null,
        wireframe: false,
        // A mesh that deforms in its shader is a mover from the first frame.
        changedAt: deformsInShader(object) ? now : -Infinity,
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
    if (deformsInShader(object)) return true;
    const m = object.matrixWorld.elements;
    const s = entry.matrix;
    for (let i = 0; i < 16; i++) if (m[i] !== s[i]) return true;
    const mesh = object as Mesh;
    const geometry = (mesh.geometry as BufferGeometry | undefined) ?? null;
    if (geometry !== entry.geometry) return true;
    if (geometry !== null) {
      const position = positionSource(geometry);
      if (position !== entry.position || (position?.version ?? -1) !== entry.positionVersion) return true;
      const index = geometry.index;
      if (index !== entry.index || (index?.version ?? -1) !== entry.indexVersion) return true;
      if (geometry.drawRange.start !== entry.drawStart || geometry.drawRange.count !== entry.drawCount) return true;
    }
    const instanced = object as unknown as { isInstancedMesh?: boolean; instanceMatrix?: { version: number }; count?: number };
    if (instanced.isInstancedMesh === true) {
      const matrices = instanced.instanceMatrix ?? null;
      if (matrices !== entry.instanceMatrix || (matrices?.version ?? -1) !== entry.instanceVersion) return true;
      if ((instanced.count ?? -1) !== entry.count) return true;
    }
    const material = (mesh.material as Material | Material[] | undefined) ?? null;
    if (material !== entry.material) return true;
    if (visibilityMask(material) !== entry.materialVisible) return true;
    if (material !== null && !Array.isArray(material)) {
      const alphaTest = material.alphaTest;
      if (
        material.side !== entry.side ||
        material.shadowSide !== entry.shadowSide ||
        alphaTest !== entry.alphaTest ||
        ((material as Material & { wireframe?: boolean }).wireframe === true) !== entry.wireframe ||
        (alphaTest > 0 && (textureOf(material, 'alphaMap') !== entry.alphaMap || textureOf(material, 'map') !== entry.map))
      ) {
        return true;
      }
    }
    return false;
  }

  private snapshot(object: Object3D, entry: Entry): void {
    entry.matrix.set(object.matrixWorld.elements);
    const mesh = object as Mesh;
    const geometry = (mesh.geometry as BufferGeometry | undefined) ?? null;
    entry.geometry = geometry;
    const position = geometry === null ? null : positionSource(geometry);
    entry.position = position;
    entry.positionVersion = position?.version ?? -1;
    entry.index = geometry?.index ?? null;
    entry.indexVersion = geometry?.index?.version ?? -1;
    entry.drawStart = geometry?.drawRange.start ?? -1;
    entry.drawCount = geometry?.drawRange.count ?? -1;
    const instanced = object as unknown as { isInstancedMesh?: boolean; instanceMatrix?: { version: number }; count?: number };
    const matrices = instanced.isInstancedMesh === true ? (instanced.instanceMatrix ?? null) : null;
    entry.instanceMatrix = matrices;
    entry.instanceVersion = matrices?.version ?? -1;
    entry.count = instanced.isInstancedMesh === true ? (instanced.count ?? -1) : -1;
    const material = (mesh.material as Material | Material[] | undefined) ?? null;
    entry.material = material;
    entry.materialVisible = visibilityMask(material);
    const single = material !== null && !Array.isArray(material) ? material : null;
    entry.side = single?.side ?? -1;
    entry.shadowSide = single?.shadowSide ?? null;
    entry.alphaTest = single?.alphaTest ?? 0;
    entry.wireframe = (single as (Material & { wireframe?: boolean }) | null)?.wireframe === true;
    entry.alphaMap = single !== null && single.alphaTest > 0 ? textureOf(single, 'alphaMap') : null;
    entry.map = single !== null && single.alphaTest > 0 ? textureOf(single, 'map') : null;
  }

  private ensureStaticTarget(): WebGLRenderTarget {
    const map = this.light.shadow.map!;
    const width = map.width;
    const height = map.height;
    if (this.staticTarget && this.staticTarget.width === width && this.staticTarget.height === height) return this.staticTarget;
    this.staticTarget?.depthTexture?.dispose();
    this.staticTarget?.dispose();
    const target = this.vsmTarget(width, height, 'sunShadowCache.static');
    this.staticTarget = target;
    // The kept copy: only its depth matters; the colour is the smallest three allows.
    this.keepTarget?.depthTexture?.dispose();
    this.keepTarget?.dispose();
    const keep = new WebGLRenderTarget(width, height, { format: RedFormat, type: UnsignedByteType, generateMipmaps: false });
    keep.texture.name = 'sunShadowCache.keep';
    const keepDepth = new DepthTexture(width, height, FloatType);
    keepDepth.name = 'sunShadowCache.keepDepth';
    keepDepth.format = DepthFormat;
    keepDepth.compareFunction = null;
    keepDepth.minFilter = NearestFilter;
    keepDepth.magFilter = NearestFilter;
    keep.depthTexture = keepDepth;
    this.renderer?.initRenderTarget(keep);
    this.keepTarget = keep;
    this.sentinelDepth.uniforms['staticDepth']!.value = keepDepth;
    return target;
  }

  /**
   * The same shape three gives a VSM map (`WebGLShadowMap`): half-float
   * moments plus a float depth texture the blur reads. So three's pass draws
   * into it exactly as it would into the real one.
   */
  private vsmTarget(width: number, height: number, name: string): WebGLRenderTarget {
    const target = new WebGLRenderTarget(width, height, {
      format: RGFormat,
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: false,
    });
    target.texture.name = name;
    const depth = new DepthTexture(width, height, FloatType);
    depth.name = `${name}Depth`;
    depth.format = DepthFormat;
    depth.compareFunction = null;
    depth.minFilter = NearestFilter;
    depth.magFilter = NearestFilter;
    target.depthTexture = depth;
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
    // Last child of the root, so three's walk draws it after every caster.
    this.scene.children.push(this.tap);
    try {
      original([this.light], this.scene, camera);
    } finally {
      this.scene.children.pop();
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
