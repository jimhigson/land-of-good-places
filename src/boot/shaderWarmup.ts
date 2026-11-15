import {
  BackSide,
  DoubleSide,
  FrontSide,
  MeshDepthMaterial,
  VSMShadowMap,
  WebGLRenderTarget,
  type Camera,
  type Material,
  type Mesh,
  type Object3D,
  type Scene,
  type Side,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { ObjectList, texturesOf } from '../core/viewWarmup';

/**
 * How many milliseconds of shader warm-up may run in one frame of the ride.
 *
 * The same number as `GENERATION_BUDGET_MS`, and deliberately so: this runs in
 * the same loop, behind the same moving bus, under the same rule that no single
 * frame of the ride may stutter. Kept separate rather than imported so the two
 * can be tuned apart if one ever needs to be.
 */
export const WARMUP_BUDGET_MS = 8;

/**
 * How long a frame may spend compiling shaders **once the ride has overrun and
 * the drive is looping** — the warm-up's half of
 * `JourneyDirector.overrunAwareBudgetMs`, and small for exactly the reason
 * `OVERRUN_GENERATION_BUDGET_MS` now gives: the overrun is no longer a parked bus
 * but a *moving* one (the loop keeps driving until the park is ready), so a frame
 * that blocks for 200 ms judders the same moving shot the ride does. The warm-up
 * runs behind that same looping bus — after the park is built but before the
 * jump-cut hands over — so it takes the same smooth budget rather than draining
 * flat-out. See `OVERRUN_GENERATION_BUDGET_MS` for the measured judder and the
 * wait trade-off; this is the same decision applied to shader links.
 */
export const OVERRUN_WARMUP_BUDGET_MS = 12;

/**
 * The largest number of meshes {@link ShaderWarmup} will hand to one
 * `renderer.compile()` call.
 *
 * The queue is built by splitting the scene graph until every entry is under
 * this, which is what makes the work sliceable at all: `compile()` is
 * synchronous and has no budget of its own, so the only lever is how much of
 * the graph each call is given. Too high and one call overruns the frame; too
 * low and the per-call overhead (a light sweep of the whole scene, once per
 * call — see below) dominates.
 */
const MAX_MESHES_PER_SLICE = 40;

/**
 * A way the scene is lit at some point in play — the park by day, and by
 * night with its lamps and fairy lights on.
 *
 * **The light counts are part of every program's key** — every material's,
 * lit or not (`WebGLPrograms.getParameters`) — so a material drawn under two
 * lightings is two programs. Compiling only under the lighting of the moment
 * left every night program to the frame dusk fell on: measured on seed 5, 17
 * links on the frame the park's lights came on and 60 more over the night's
 * first walk.
 */
export interface WarmLighting {
  readonly name: string;
  /** Runs `fn` with the scene lit this way, and puts its lights back as they were. */
  during(fn: () => void): void;
}

/**
 * A state some materials are switched into during play that changes their
 * program — the fountain statue faded out of her way (`transparent` is part of
 * the key, and a double-sided transparent material is drawn as two).
 */
export interface WarmVariant {
  readonly name: string;
  /** What it changes: only these subtrees are compiled in it. */
  readonly roots: readonly Object3D[];
  /** Runs `fn` with them switched, and switches them back. */
  during(fn: () => void): void;
}

/** What {@link ShaderWarmup} covers beyond the materials as they stand. */
export interface ShaderWarmupOptions {
  /** Every lighting the scene is drawn under. Omitted: only as it is lit now. */
  readonly lightings?: readonly WarmLighting[];
  /** Material states switched into during play. */
  readonly variants?: readonly WarmVariant[];
  /** The shadow pass's depth programs, for every caster in the scene, seen or not. */
  readonly shadows?: boolean;
  /**
   * Not `ready` until the GPU says every program it made is linked, each has
   * had its first use, and every texture its materials sample is uploaded —
   * so nothing it covered costs a frame anything. Off, `ready` means only
   * "everything asked for".
   */
  readonly finish?: boolean;
}

/** `WebGLProgram` as three builds it — `isReady` is real but untyped. */
interface Program {
  isReady?(): boolean;
  getUniforms(): unknown;
  getAttributes(): unknown;
  /** The GL program; three clears it when the program is released. */
  readonly program?: unknown;
}

/** Still a live program: one released since (its last material disposed) has nothing to ask. */
const live = (program: Program | undefined): program is Program => program !== undefined && program.program !== undefined;

/** What `WebGLRenderer.properties` keeps for a texture — only the field read here. */
interface TextureState {
  readonly __version?: number;
}

type Phase = 'compile' | 'link' | 'first use' | 'textures' | 'done';

/**
 * **Every program the park can need, made behind a cover — the one owner of
 * that.**
 *
 * ## Why this exists
 *
 * three.js compiles a material's program the first time that material is
 * actually drawn, and the first use of a new program blocks the main thread
 * until the GPU process has linked it. Measured on an M4 Pro through headless
 * Chromium with the real Metal backend: **64 of the park's 116 shader links
 * were happening *after* the arrival ended** — i.e. while a child was walking
 * about — costing up to **152 ms for a single program**, and once stalling a
 * frame for **1.29 s**. On a phone each one is several times that: Jim's
 * iPhone, 15 Nov 2026, a continued save, *"fine at 60 fps for a while, and
 * then suddenly long pauses"* — 247 ms frames within five seconds of walking.
 *
 * ## What "every program" is
 *
 * Not only every material in the graph as it stands — that alone left 107
 * programs to be made after the park was on screen, 95 of them waited for on
 * a frame she could see, on `check:served-no-midwalk-links`'s tour of seed 5
 * against `main` 44952060:
 *
 * - **every slice of the graph, shown or not**, as before — `compile()`
 *   gathers materials with plain `traverse`, so what is hidden now is warmed
 *   too. Each slice is handed over as an {@link ObjectList}, never as the
 *   subtree itself, which `compile()` would count the lights of twice;
 * - **under every lighting** ({@link WarmLighting}) — day and night are
 *   different light counts, and so different programs, for every material;
 * - **every material state switched into in play** ({@link WarmVariant});
 * - **the shadow pass's depth programs, for every caster** (`shadows`) —
 *   `compile()` never makes these, three makes them when the shadow map first
 *   draws a caster, and the shadow camera follows her, so a caster first
 *   came into it — and linked a program — as she walked up to it;
 *
 * and then, with `finish`, **linked, used once and uploaded**: the links run
 * in parallel in the GPU process (`KHR_parallel_shader_compile`), asked about
 * here without blocking; each program's first use (its uniforms and
 * attributes read back, a round trip each) happens here, once it is linked;
 * and every texture its materials sample is uploaded a few at a time.
 *
 * ## Who drives it
 *
 * `Game` owns the one instance. Behind the bus ride, `main.ts` gives it the
 * ride's budget a frame, and the bus does not arrive until it is `ready`
 * (`JourneyDirector.parkFitToPlay`). On every other boot — a continued save,
 * a deep link, a ride whose skip was pressed first — and on the first walk out
 * of a room a save restored her into, the cover that stands over the park
 * carries it (`RevealHold.setWork`) and does not lift until it is done.
 *
 * ## Why it is sliced, and why by subtree
 *
 * `renderer.compile()` is synchronous and takes no budget, so the only way to
 * bound it is to bound *what it is given*. {@link buildQueue} splits the graph
 * until each entry holds at most {@link MAX_MESHES_PER_SLICE} meshes, and
 * {@link advance} works through the jobs until its budget is spent.
 *
 * **Compiling one mesh at a time would be far slower, not faster.** Every
 * `compile()` call sweeps the *whole* target scene for lights before it looks
 * at a single material (`WebGLRenderer.compile`'s `targetScene.traverseVisible`).
 * Per-mesh that is ~2,200 traversals of a ~2,200-node graph. Batching is what
 * keeps that overhead paid once per slice rather than once per mesh.
 *
 * ## The one side effect, and why it is undone every frame
 *
 * `compile()` shares the render state three's `render` uses for the scene,
 * and `render` draws the shadow pass **before** it sets that frame's lights —
 * so the depth programs of the next frame drawn are keyed on whatever the last
 * `compile()` lit the scene with. A frame after one under the night's lights,
 * by day, made a night depth program for every caster in sight. So each
 * {@link advance} ends by lighting the render state as the scene stands now.
 *
 * **Nor the rooms, on purpose.** Only the park is warmed: every room is out of
 * the graph while she is not in it (`world/DrawnSpaces.ts`), and a room is
 * compiled where its real lights are — behind the iris of her first walk in
 * (`core/viewWarmup.ts`).
 */
export class ShaderWarmup {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly options: ShaderWarmupOptions;

  /** Whole units of work, run in order; a job may add more behind it. */
  private jobs: (() => void)[] = [];
  private jobIndex = 0;
  private slicesTotal = 0;
  private slicesDone = 0;
  private phaseValue: Phase = 'compile';
  private startedFlag = false;
  private framesWorkedCount = 0;
  private totalMs = 0;
  private worstSliceMs = 0;
  private readyAt = -1;
  /** Units of work done — jobs, links seen finished, first uses, uploads: {@link workDone}. */
  private doneCount = 0;

  /** Every program this warm-up made. */
  private readonly made: Program[] = [];
  /** Every program there was when the compiling was done: linked, then used once. */
  private finishing: Program[] = [];
  private linking: Program[] = [];
  private firstUseIndex = 0;
  /** Every material it compiled, for their textures. */
  private readonly materials = new Set<Material>();
  private textures: Texture[] = [];
  private textureIndex = 0;
  private texturesUploadedCount = 0;
  /** A one-pixel target bound while depth programs compile — see {@link compileDepth}. */
  private depthTarget: WebGLRenderTarget | null = null;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera, options: ShaderWarmupOptions = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.options = options;
  }

  /**
   * One frame's worth of warm-up; true once it is {@link ready}.
   *
   * Takes whole jobs only. A job that overruns the budget is *finished*
   * rather than abandoned — `compile()` cannot be interrupted — so the budget
   * decides how many jobs are started, not how long one may take. That is
   * why {@link worstMs} is reported: it is the number that says whether
   * {@link MAX_MESHES_PER_SLICE} is set sensibly, and no comment can stand in
   * for it.
   */
  advance(budgetMs: number): boolean {
    if (this.phaseValue === 'done') return true;
    if (!this.startedFlag) this.start();
    const started = performance.now();
    this.framesWorkedCount += 1;
    let compiled = false;
    while (this.phaseValue === 'compile' && this.jobIndex < this.jobs.length) {
      if (performance.now() - started >= budgetMs) break;
      const job = this.jobs[this.jobIndex++];
      if (!job) continue;
      const jobStart = performance.now();
      job();
      this.doneCount += 1;
      compiled = true;
      const jobMs = performance.now() - jobStart;
      if (jobMs > this.worstSliceMs) this.worstSliceMs = jobMs;
    }
    // Leave the render state lit as the scene is (see the class note).
    if (compiled && this.options.lightings && this.options.lightings.length > 0) this.relight();
    if (this.phaseValue === 'compile' && this.jobIndex >= this.jobs.length) {
      this.jobs = [];
      this.depthTarget?.dispose();
      this.depthTarget = null;
      this.phaseValue = this.options.finish ? 'link' : 'done';
      // Every program there is by now, not only the ones made here: a cover's
      // own view warm-up (`core/viewWarmup.ts`) made the view's first, and
      // only those the cover's frames drew have had their first use.
      this.finishing = ((this.renderer.info?.programs ?? []) as unknown as Program[]).filter(live);
      this.linking = this.finishing.slice();
    }
    if (this.phaseValue === 'link') this.pollLinks();
    if (this.phaseValue === 'first use') this.useOnce(started, budgetMs);
    if (this.phaseValue === 'textures') this.upload(started, budgetMs);
    this.totalMs += performance.now() - started;
    if (this.phaseValue === 'done' && this.readyAt < 0) this.readyAt = performance.now();
    return this.phaseValue === 'done';
  }

  /** Everything asked for — and, with `finish`, linked, used and uploaded. The one completion signal; there is no timer. */
  get ready(): boolean {
    return this.phaseValue === 'done';
  }

  /** Where it has got to, for the boot report and `?perf=1`. */
  get phase(): Phase {
    return this.phaseValue;
  }

  /** `performance.now()` when it became {@link ready}; −1 until then. */
  get readyAtMs(): number {
    return this.readyAt;
  }

  /**
   * A count that only goes up as work gets done — jobs run, links seen
   * finished, first uses, uploads — so a cover waiting on this can tell a
   * slow warm-up from a stuck one (`RevealHold`'s limit).
   */
  get workDone(): number {
    return this.doneCount;
  }

  /** Slices compiled so far, and how many are left — for the boot report. */
  get progress(): { done: number; remaining: number } {
    return { done: this.slicesDone, remaining: this.slicesTotal - this.slicesDone };
  }

  /** Programs this warm-up made; with `finish`, how many are still linking. */
  get programs(): { made: number; linking: number } {
    return { made: this.made.length, linking: this.phaseValue === 'link' ? this.linking.length : 0 };
  }

  /** Textures it uploaded. */
  get texturesUploaded(): number {
    return this.texturesUploadedCount;
  }

  /** Slices compiled so far: {@link progress}'s `done` without the object, for a reader every frame. */
  get slicesCompiled(): number {
    return this.slicesDone;
  }

  /** Frames this has taken work on. */
  get framesWorked(): number {
    return this.framesWorkedCount;
  }

  /** Total milliseconds spent compiling, across every frame. */
  get spentMs(): number {
    return this.totalMs;
  }

  /** The longest single job. See {@link advance}. */
  get worstMs(): number {
    return this.worstSliceMs;
  }

  private start(): void {
    this.startedFlag = true;
    const queue = buildQueue(this.scene);
    this.slicesTotal = queue.length;
    for (const node of queue) {
      this.jobs.push(() => {
        this.underEachLighting(() => this.compileRoots([node], true));
        this.slicesDone += 1;
      });
    }
    for (const variant of this.options.variants ?? []) {
      if (variant.roots.length === 0) continue;
      this.jobs.push(() => variant.during(() => this.underEachLighting(() => this.compileRoots(variant.roots, true))));
    }
    if (this.options.shadows) {
      this.jobs.push(() => {
        // Every caster in one walk — no GL calls, so cheap — then their depth
        // programs a slice at a time, like the materials'.
        const proxies = depthProxies(this.scene, this.camera, this.renderer.shadowMap.type === VSMShadowMap);
        for (let i = 0; i < proxies.length; i += MAX_MESHES_PER_SLICE) {
          const chunk = proxies.slice(i, i + MAX_MESHES_PER_SLICE);
          this.jobs.push(() => this.underEachLighting(() => this.compileDepth(chunk)));
        }
      });
    }
  }

  private underEachLighting(fn: () => void): void {
    const lightings = this.options.lightings;
    if (!lightings || lightings.length === 0) {
      fn();
      return;
    }
    for (const lighting of lightings) lighting.during(fn);
  }

  /** Compiles `roots` against the scene's lights, keeping what it made. */
  private compileRoots(roots: readonly Object3D[], subtrees: boolean): void {
    const programs = this.renderer.info?.programs;
    const before = programs?.length ?? 0;
    // `targetScene` is the real scene, so they are compiled against the park's
    // actual lights rather than against no lights at all — which would produce
    // a different program from the one the first real frame wants.
    const compiled = this.renderer.compile(new ObjectList(roots, subtrees), this.camera, this.scene) as Set<Material> | undefined;
    if (programs) for (let i = before; i < programs.length; i += 1) this.made.push(programs[i] as unknown as Program);
    if (compiled && this.options.finish) for (const material of compiled) this.materials.add(material);
  }

  /**
   * The depth programs, keyed as the shadow pass keys them: with a render
   * target bound, as the pass draws into one — the colour space and tone
   * mapping in a program's key are the target's, and with none bound they are
   * the screen's — and **without the scene's fog**, because three draws a
   * caster's depth with no scene at all (`renderBufferDirect(…, null, …)`), so
   * its program has no fog in its key. Compiled with the park's fog, every
   * depth program here was a near miss and the shadow pass made its own.
   */
  private compileDepth(proxies: readonly Object3D[]): void {
    const renderer = this.renderer;
    this.depthTarget ??= new WebGLRenderTarget(1, 1, { depthBuffer: false });
    const previous = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace();
    const level = renderer.getActiveMipmapLevel();
    const fog = this.scene.fog;
    renderer.setRenderTarget(this.depthTarget);
    this.scene.fog = null;
    try {
      this.compileRoots(proxies, false);
    } finally {
      this.scene.fog = fog;
      renderer.setRenderTarget(previous, face, level);
    }
  }

  /** Lights the shared render state as the scene stands — the class note's one side effect, undone. */
  private relight(): void {
    this.renderer.compile(new ObjectList([]), this.camera, this.scene);
  }

  /** Asks, without blocking, which programs are still linking. */
  private pollLinks(): void {
    const before = this.linking.length;
    this.linking = this.linking.filter((program) => live(program) && program.isReady?.() === false);
    this.doneCount += before - this.linking.length;
    if (this.linking.length === 0) this.phaseValue = 'first use';
  }

  /**
   * Each program's first use: three reads its uniforms and attributes back
   * the first time it draws with it, a synchronous round trip per uniform.
   * Linked already, so nothing here waits on a link.
   */
  private useOnce(started: number, budgetMs: number): void {
    while (this.firstUseIndex < this.finishing.length) {
      if (performance.now() - started >= budgetMs) return;
      const program = this.finishing[this.firstUseIndex++];
      this.doneCount += 1;
      if (!live(program)) continue;
      program.getUniforms();
      program.getAttributes();
    }
    const textures = new Set<Texture>();
    for (const material of this.materials) texturesOf(material, textures);
    this.textures = [...textures];
    this.phaseValue = 'textures';
  }

  /** Every texture the compiled materials sample, uploaded within the budget. */
  private upload(started: number, budgetMs: number): void {
    while (this.textureIndex < this.textures.length) {
      if (performance.now() - started >= budgetMs) return;
      const texture = this.textures[this.textureIndex++];
      this.doneCount += 1;
      if (!texture) continue;
      const state = this.renderer.properties.get(texture) as TextureState;
      if (texture.version > 0 && state.__version !== texture.version) {
        this.renderer.initTexture(texture);
        this.texturesUploadedCount += 1;
      }
    }
    this.phaseValue = 'done';
  }
}

/**
 * What three's shadow pass draws each caster with, standing in for it: a
 * copy of the caster whose material is the depth material
 * `WebGLShadowMap.getDepthMaterial` picks for it, set as that function sets
 * it. Compiled, these make exactly the programs the shadow pass looks up —
 * programs are shared by key — without drawing anything, so they link in
 * parallel rather than on the frame the caster first enters the sun's view.
 *
 * Every caster, whatever it shows now and wherever it stands: the shadow pass
 * only draws what is visible and inside the shadow camera, which follows her.
 *
 * **Each caster's own key, never "the program in use".** three's shadow pass
 * shares one depth material between casters and asks for a new program only
 * when something it tests changes between one caster and the next (instancing,
 * batching, morphs — not the side): which program a double-sided slide gets
 * depends on what was drawn before it. So any caster may be the one a change
 * is keyed on, and every caster's key is compiled.
 *
 * Replicates three r185's choice; if a three.js upgrade changes it, the
 * programs made here stop matching and `check:served-no-midwalk-links` goes
 * red on the first depth program made in play.
 */
function depthProxies(scene: Object3D, camera: Camera, vsm: boolean): Object3D[] {
  const proxies: Object3D[] = [];
  const add = (object: Object3D, material: Material): void => {
    const custom = (object as Mesh).customDepthMaterial;
    const depth = (custom ?? DEPTH_MATERIAL).clone();
    const source = material as Material & {
      wireframe?: boolean;
      alphaMap?: Texture | null;
      map?: Texture | null;
      displacementMap?: Texture | null;
      displacementScale?: number;
      displacementBias?: number;
      wireframeLinewidth?: number;
      linewidth?: number;
    };
    const target = depth as Material & Record<string, unknown>;
    target.visible = true;
    target['wireframe'] = source.wireframe ?? false;
    target.side = source.shadowSide ?? (vsm ? source.side : SHADOW_SIDE[source.side]);
    target['alphaMap'] = source.alphaMap ?? null;
    target.alphaTest = source.alphaToCoverage ? 0.5 : source.alphaTest;
    target['map'] = source.map ?? null;
    target.clipShadows = source.clipShadows;
    target.clippingPlanes = source.clippingPlanes;
    target.clipIntersection = source.clipIntersection;
    target['displacementMap'] = source.displacementMap ?? null;
    target['displacementScale'] = source.displacementScale ?? 1;
    target['displacementBias'] = source.displacementBias ?? 0;
    const proxy = Object.create(object) as Mesh;
    proxy.material = depth;
    proxies.push(proxy);
  };
  const visit = (object: Object3D): void => {
    const o = object as Mesh & { isLine?: boolean; isPoints?: boolean };
    if (
      object.layers.test(camera.layers) &&
      (o.isMesh === true || o.isLine === true || o.isPoints === true) &&
      (object.castShadow || (object.receiveShadow && vsm))
    ) {
      const material = o.material;
      if (Array.isArray(material)) {
        for (const group of o.geometry.groups) {
          const part = material[group.materialIndex ?? 0];
          if (part) add(object, part);
        }
      } else if (material) {
        add(object, material);
      }
    }
    for (const child of object.children) visit(child);
  };
  visit(scene);
  return proxies;
}

/** `WebGLShadowMap`'s own `_depthMaterial`, as three r185 makes it. */
const DEPTH_MATERIAL = new MeshDepthMaterial();

/** `WebGLShadowMap`'s side flip for a shadow map that is not VSM. */
const SHADOW_SIDE: Record<Side, Side> = { [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide };

/**
 * Splits a scene graph into chunks of at most {@link MAX_MESHES_PER_SLICE}
 * meshes, such that **every** renderable node lands in exactly one chunk.
 *
 * Descends only through nodes that draw nothing themselves. Descending past a
 * `Mesh` would drop that mesh's own material on the floor — `compile()` is
 * given a subtree root and traverses down from it, so a skipped root is a
 * skipped material, and the whole point here is coverage. A renderable node
 * with a large subtree is therefore taken whole, oversized, rather than split.
 */
export function buildQueue(root: Object3D, maxMeshes = MAX_MESHES_PER_SLICE): Object3D[] {
  const out: Object3D[] = [];
  const walk = (node: Object3D): void => {
    const meshes = countMeshes(node);
    if (meshes === 0) return;
    const drawsSomething = isRenderable(node);
    if (meshes <= maxMeshes || drawsSomething || node.children.length === 0) {
      out.push(node);
      return;
    }
    for (const child of node.children) walk(child);
  };
  // The root itself is a Scene, which draws nothing; start at its children so a
  // single oversized chunk is not the only possible answer.
  if (isRenderable(root) || root.children.length === 0) {
    if (countMeshes(root) > 0) out.push(root);
    return out;
  }
  for (const child of root.children) walk(child);
  return out;
}

function isRenderable(node: Object3D): boolean {
  const o = node as Object3D & {
    isMesh?: boolean;
    isPoints?: boolean;
    isLine?: boolean;
    isSprite?: boolean;
  };
  return o.isMesh === true || o.isPoints === true || o.isLine === true || o.isSprite === true;
}

function countMeshes(node: Object3D): number {
  let n = 0;
  node.traverse((child) => {
    if (isRenderable(child)) n += 1;
  });
  return n;
}
