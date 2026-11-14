import { Frustum, Matrix4, Object3D, Sphere, type Camera, type Material, type Scene, type Sprite, type Texture, type Vector3, type WebGLRenderer } from 'three';

/**
 * **Nothing new is drawn on a frame a child can see** (120 fps plan, steps 8
 * and 9; `docs/perf/FRAME-DROPS-2026-11.md` items 14 and 19).
 *
 * ## What the long frames on a first entry were
 *
 * Measured on the shipped build (M4 Pro, Chrome 151 headless on Metal, seed 5,
 * `?perf=1`), every first entry and every first boarding hitched for the same
 * three reasons, in this order of size:
 *
 * 1. **Program links.** three.js compiles a material's program the first time
 *    that material is drawn, and the first use of a new program
 *    (`WebGLProgram.getUniforms` → `getProgramParameter`) blocks the main
 *    thread until the GPU process has linked it: 6–9 ms a program, one after
 *    another. Walking into the Reptile House linked 13 in its first frame
 *    (111 ms of CPU), the library 10 (44 ms), boarding the Rail Race 15 at the
 *    press and 10 more as the iris opened. **The program key includes the
 *    light counts** — every material's, lit or not — and every interior turns
 *    the sun's rig off (`DayNight.setIndoors`) and its own lights on, so an
 *    interior can never reuse the park's programs, and nothing compiled
 *    against the park's lights is the program an interior draws with.
 * 2. **Texture uploads** — 3–16 a first entry, 2–12 MB, in the same frame.
 * 3. **Geometry uploads** — 2–12 MB of buffers, ditto.
 *
 * ## The rule this file is the mechanism for
 *
 * Every first sight of anything happens behind a cover — the iris of a change
 * of space or a boarding, or the boot — so that is where the work goes. While
 * a {@link RevealHold} is requested, the frame draws nothing new: it works out
 * what the camera *will* draw ({@link drawnBy}, three.js's own cull), asks for
 * those programs all at once ({@link ViewWarmup.add}), and then waits —
 * without blocking — until every one reports itself linked
 * (`KHR_parallel_shader_compile`), uploading the textures a few milliseconds a
 * frame meanwhile. Then it draws one real frame, still behind the cover (the
 * geometry goes up, and anything the cull could not foresee — the shadow
 * pass's depth programs — is linked where nobody sees it), one more ordinary
 * frame, and only then lets the cover lift.
 *
 * **It warms the state that will actually be drawn**, never a prediction of
 * it. The hold is asked for after the change of space has happened (the
 * iris's midpoint has moved her, swapped the camera, switched the room on)
 * and the first collect runs where that frame's draw would have — after the
 * world has updated for the new place, so the lights, the fog and the camera
 * are exactly the ones the first visible frame uses. That is what makes the
 * programs it creates the programs that frame reuses, and `check:first-entry`
 * proves it by counting links on the frames after the cover lifts.
 */

/** Milliseconds of texture upload one held frame may spend. */
export const WARM_TEXTURE_BUDGET_MS = 6;

/**
 * The longest a hold may keep the cover shut, in milliseconds. A driver that
 * never reports a program ready, or a lost context, must not leave a child
 * looking at a closed iris for ever: past this the hold draws whatever it has
 * and lets go. Measured holds are 2–25 frames; this is twenty times that.
 */
export const WARM_HOLD_LIMIT_MS = 4000;

/** What `WebGLRenderer.properties` keeps for a material — only the field read here. */
interface MaterialState {
  readonly currentProgram?: { isReady?: () => boolean };
}

/** What `WebGLRenderer.properties` keeps for a texture — only the field read here. */
interface TextureState {
  readonly __version?: number;
}

const _frustum = new Frustum();
const _viewProjection = new Matrix4();
const _sphere = new Sphere();

/**
 * What a warm-up covers beyond the frame's own frustum — see {@link drawnBy}.
 */
export interface WarmReach {
  /** Where she stands. */
  readonly centre: Vector3;
  /** Metres round her within which everything drawable is warmed, shown or not. */
  readonly radius: number;
  /**
   * Roots of the things that go wherever she goes — her own model, her pets,
   * the highlight, the tap marker — warmed whole, shown or not, wherever they
   * happen to be standing when the cover went up.
   */
  readonly travelling: readonly Object3D[];
}

/**
 * **Everything that can be drawn while she is where she is now**, without
 * drawing it — three.js's own cull (`WebGLRenderer`'s `projectObject`)
 * widened to the next few seconds:
 *
 * - **shown and in the frustum** — what this very frame draws (layers tested
 *   against the camera, as three does);
 * - **within `reach.radius` of her, shown or not** — the rest of the room. She
 *   walks on, the camera follows, a twinkle on a secret shelf switches on, and
 *   each of those was a link on a frame she could see (measured with the
 *   frustum alone, the library's first walk-in: three);
 * - **never frustum-culled, shown or not** — drawn from anywhere, so from here;
 * - **everything under `reach.travelling`** — the highlight that rings
 *   whatever she next walks up to was standing in the park when the cover went
 *   up, and links on the first selection indoors otherwise.
 *
 * Not the whole scene: the park stays in the graph while she is in the
 * library, and compiling its hundreds of materials against the library's
 * lights would create programs nothing ever draws. Every space is its own
 * plate hundreds of metres from the next, so a ball round her is the room
 * she is in — and, outdoors, the stretch of park she reaches before the bus
 * ride's warm-up (or `Game.warmTheRestInBackground`) has covered the rest.
 */
export function drawnBy(scene: Object3D, camera: Camera, reach?: WarmReach, frustum: Frustum = _frustum): Object3D[] {
  if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld();
  if (camera.parent === null && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld();
  _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(_viewProjection);
  const out = new Set<Object3D>();
  const near = reach;
  const nearby = (object: Object3D): boolean => {
    if (!near) return false;
    const geometry = (object as { geometry?: { boundingSphere: Sphere | null; computeBoundingSphere(): void } }).geometry;
    const own = (object as { boundingSphere?: Sphere | null; computeBoundingSphere?: () => void });
    // An instanced or batched mesh keeps a sphere round all its instances.
    if (own.boundingSphere !== undefined && own.computeBoundingSphere) {
      if (own.boundingSphere === null) own.computeBoundingSphere();
      if (!own.boundingSphere) return false;
      _sphere.copy(own.boundingSphere);
    } else if (geometry) {
      if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
      if (!geometry.boundingSphere) return false;
      _sphere.copy(geometry.boundingSphere);
    } else {
      return false;
    }
    _sphere.applyMatrix4(object.matrixWorld);
    return _sphere.center.distanceTo(near.centre) - _sphere.radius <= near.radius;
  };
  const visit = (object: Object3D, shownAbove: boolean): void => {
    const shown = shownAbove && object.visible;
    if (object.layers.test(camera.layers)) {
      const o = object as Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
      const sprite = o.isSprite === true;
      if (sprite || o.isMesh === true || o.isLine === true || o.isPoints === true) {
        const inFrustum = shown && object.frustumCulled && (sprite ? frustum.intersectsSprite(object as Sprite) : frustum.intersectsObject(object));
        if (!object.frustumCulled || inFrustum || nearby(object)) out.add(object);
      }
    }
    for (const child of object.children) visit(child, shown);
  };
  visit(scene, true);
  for (const root of reach?.travelling ?? []) {
    root.traverse((object) => {
      const o = object as Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
      if ((o.isMesh === true || o.isLine === true || o.isPoints === true || o.isSprite === true) && object.layers.test(camera.layers)) out.add(object);
    });
  }
  return [...out];
}

/** Every drawable in `scene` on `camera`'s layers, shown or not. */
function everythingIn(scene: Object3D, camera: Camera): Object3D[] {
  const out: Object3D[] = [];
  scene.traverse((object) => {
    const o = object as Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean };
    if ((o.isMesh === true || o.isLine === true || o.isPoints === true || o.isSprite === true) && object.layers.test(camera.layers)) out.push(object);
  });
  return out;
}

/**
 * A list of objects that `WebGLRenderer.compile` can be handed as if it were a
 * subtree. `compile(scene, camera, targetScene)` gathers lights from
 * `targetScene` (the real scene, so the programs are keyed on the real lights)
 * and from `scene.traverseVisible` — nothing here, the list holds no lights —
 * and then prepares the material of everything `scene.traverse` visits. One
 * call for the whole view, so the scene's lights are gathered once rather
 * than once per object.
 */
class ObjectList extends Object3D {
  private readonly list: readonly Object3D[];

  constructor(list: readonly Object3D[]) {
    super();
    this.list = list;
  }

  override traverse(callback: (object: Object3D) => void): void {
    for (const object of this.list) callback(object);
  }

  override traverseVisible(): void {
    // No lights of its own: every light that counts is in the target scene.
  }
}

/** Every texture a material samples: its maps, and a shader material's texture uniforms. */
export function texturesOf(material: Material, into: Set<Texture>): void {
  for (const value of Object.values(material)) {
    if (isUploadable(value)) into.add(value);
  }
  const uniforms = (material as { uniforms?: Record<string, { value?: unknown } | undefined> }).uniforms;
  if (!uniforms) return;
  for (const uniform of Object.values(uniforms)) {
    const value = uniform?.value;
    if (isUploadable(value)) into.add(value);
    else if (Array.isArray(value)) for (const item of value) if (isUploadable(item)) into.add(item);
  }
}

/** A texture with something to upload — not a render target's, not a video's (which uploads every frame anyway). */
function isUploadable(value: unknown): value is Texture {
  const t = value as { isTexture?: boolean; isRenderTargetTexture?: boolean; isVideoTexture?: boolean; version?: number } | null;
  return !!t && t.isTexture === true && t.isRenderTargetTexture !== true && t.isVideoTexture !== true && (t.version ?? 0) > 0;
}

/** What one warm-up did — for the boot report, `?perf=1` and the check. */
export interface WarmReport {
  /** Renderables the camera would draw. */
  readonly objects: number;
  /** Distinct materials among them. */
  readonly materials: number;
  /** Programs that did not exist before this warm-up asked for them. */
  readonly programsCreated: number;
  /** Textures uploaded by this warm-up. */
  readonly texturesUploaded: number;
  /** Milliseconds `compile` took — the only part of the program work on this thread. */
  readonly compileMs: number;
}

/**
 * **Warms one view: its programs linked, its textures uploaded.**
 *
 * {@link begin}, {@link add} each pass the frame will draw, then {@link step}
 * once a frame until it says the view is ready. Nothing here draws.
 */
export class ViewWarmup {
  private readonly renderer: WebGLRenderer;
  private materials: Material[] = [];
  private textures: Texture[] = [];
  private textureIndex = 0;
  private report: WarmReport = { objects: 0, materials: 0, programsCreated: 0, texturesUploaded: 0, compileMs: 0 };

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
  }

  /** Forgets the last view: the next {@link add} starts a new one. */
  begin(): void {
    this.materials = [];
    this.textures = [];
    this.textureIndex = 0;
    this.report = { objects: 0, materials: 0, programsCreated: 0, texturesUploaded: 0, compileMs: 0 };
  }

  /**
   * Collects what `camera` would draw of `scene` and asks for every program
   * it needs, in one `compile`. With `KHR_parallel_shader_compile` (every
   * desktop and phone browser we target) that call only *starts* the links:
   * the GPU process builds them side by side while this thread carries on,
   * and {@link step} asks — without blocking — whether they are done.
   *
   * Called once per pass the frame draws (`Game.warmPasses`): the park's,
   * and the ferris car's second pass on its own layer, whose lights differ.
   */
  add(scene: Scene, camera: Camera, reach?: WarmReach | 'whole'): void {
    // `'whole'`: a little world of its own (a curtain game's), every part of
    // which is drawn soon — all of it, shown or not.
    const objects = reach === 'whole' ? everythingIn(scene, camera) : drawnBy(scene, camera, reach);
    const programsBefore = this.renderer.info.programs?.length ?? 0;
    const started = performance.now();
    const compiled = this.renderer.compile(new ObjectList(objects), camera, scene);
    const compileMs = performance.now() - started;
    const materials = new Set(this.materials);
    for (const material of compiled) materials.add(material);
    this.materials = [...materials];
    const textures = new Set(this.textures);
    for (const material of compiled) texturesOf(material, textures);
    this.textures = [...textures];
    this.report = {
      objects: this.report.objects + objects.length,
      materials: this.materials.length,
      programsCreated: this.report.programsCreated + Math.max(0, (this.renderer.info.programs?.length ?? 0) - programsBefore),
      texturesUploaded: this.report.texturesUploaded,
      compileMs: this.report.compileMs + compileMs,
    };
  }

  /**
   * One frame's work: uploads textures until `budgetMs` is spent, then asks
   * whether every program is linked. True once the view can be drawn without
   * linking or uploading anything.
   */
  step(budgetMs: number): boolean {
    const started = performance.now();
    let uploaded = 0;
    while (this.textureIndex < this.textures.length && performance.now() - started < budgetMs) {
      const texture = this.textures[this.textureIndex++];
      if (!texture) continue;
      const state = this.renderer.properties.get(texture) as TextureState;
      if (texture.version > 0 && state.__version !== texture.version) {
        this.renderer.initTexture(texture);
        uploaded += 1;
      }
    }
    if (uploaded > 0) this.report = { ...this.report, texturesUploaded: this.report.texturesUploaded + uploaded };
    if (this.textureIndex < this.textures.length) return false;
    return this.materials.every((material) => {
      const program = (this.renderer.properties.get(material) as MaterialState).currentProgram;
      return !program?.isReady || program.isReady();
    });
  }

  /** What the view since the last {@link begin} needed, and what has been done about it. */
  get last(): WarmReport {
    return this.report;
  }
}

/** One hold's record, kept for `?perf=1`, the console and `check:first-entry`. */
export interface HoldRecord extends WarmReport {
  /** Why the cover was up — `iris`, `boot`, … — as the caller named it. */
  readonly why: string;
  /** Frames the draw was held back for, the two drawn behind the cover not counted. */
  readonly heldFrames: number;
  /** Milliseconds from the request to the cover being let go. */
  readonly heldMs: number;
  /** True when the hold gave up at {@link WARM_HOLD_LIMIT_MS} rather than finishing. */
  readonly timedOut: boolean;
}

type HoldPhase = 'idle' | 'collect' | 'wait' | 'behind' | 'settle';

/**
 * **A cover is up; draw nothing new until the view behind it is warm.**
 *
 * The one owner of "may the frame draw yet?". Whoever puts a cover up and is
 * about to change what is behind it — the iris (`ui/Transitions.ts`, every
 * change of space and every boarding), the boot (`main.ts`, a deep link or a
 * continued save) — calls {@link request} and lifts the cover when the
 * promise resolves. `Game.render` routes every frame through {@link frame}.
 *
 * The phases, one frame each except the second:
 *
 * - `collect` — {@link ViewWarmup.add} for each pass this frame would draw.
 *   Nothing is drawn: the canvas keeps its last picture, under the cover.
 * - `wait` — textures up, links polled; nothing drawn, until all are done.
 * - `behind` — one real draw behind the cover: geometry uploads, and whatever
 *   the cull did not foresee (the shadow pass's own depth programs) links
 *   here, where nobody can see the frame it costs.
 * - `settle` — one more ordinary draw, so the frame the cover starts lifting
 *   on is an ordinary one rather than the one that carried the uploads (a
 *   long frame there would jump the iris's opening by its own length).
 *
 * A request while one is running starts again from `collect` — the view
 * changed again — and every waiter is answered when the newest one is done.
 */
export class RevealHold {
  private readonly renderer: WebGLRenderer;
  private readonly warmup: ViewWarmup;
  private phase: HoldPhase = 'idle';
  private waiters: (() => void)[] = [];
  private why = '';
  private requestedAt = 0;
  private heldFrames = 0;
  private limitTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly history: HoldRecord[] = [];

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.warmup = new ViewWarmup(renderer);
  }

  /**
   * The cover is up and what is behind it is about to change (or just has).
   * Resolves once the view is warm and has been drawn behind the cover —
   * never later than {@link WARM_HOLD_LIMIT_MS}, frames or no frames.
   */
  request(why: string): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      if (this.phase === 'idle') {
        this.requestedAt = performance.now();
        this.heldFrames = 0;
        this.why = why;
      } else {
        this.why = `${this.why}+${why}`;
      }
      this.phase = 'collect';
      clearTimeout(this.limitTimer);
      // A hidden tab runs no frames; the cover must still come off.
      this.limitTimer = setTimeout(() => this.letGo(true), WARM_HOLD_LIMIT_MS);
    });
  }

  /** True while a cover is being held for the view behind it. */
  get holding(): boolean {
    return this.phase !== 'idle';
  }

  /** Every hold this session, oldest first — at most the last 32. */
  get holds(): readonly HoldRecord[] {
    return this.history;
  }

  /**
   * This frame's draw, or not. `collect` adds every pass the frame is about
   * to draw to the warm-up it is handed (`ViewWarmup.add`); `null` when the
   * frame draws no park at all (a curtain game has the screen), in which case
   * there is nothing of ours to warm.
   */
  frame(collect: ((warmup: ViewWarmup) => void) | null, draw: () => void): void {
    switch (this.phase) {
      case 'idle':
        draw();
        return;
      case 'collect':
        if (!collect || this.renderer.getContext().isContextLost()) {
          draw();
          this.letGo(false);
          return;
        }
        this.warmup.begin();
        collect(this.warmup);
        this.phase = 'wait';
        this.heldFrames += 1;
        // Polled at once: a view that is already warm is ready this frame.
        if (!this.warmup.step(WARM_TEXTURE_BUDGET_MS)) return;
        this.phase = 'behind';
        return;
      case 'wait':
        this.heldFrames += 1;
        if (!this.warmup.step(WARM_TEXTURE_BUDGET_MS)) return;
        this.phase = 'behind';
        return;
      case 'behind':
        draw();
        this.phase = 'settle';
        return;
      case 'settle':
        draw();
        this.letGo(false);
        return;
    }
  }

  private letGo(timedOut: boolean): void {
    clearTimeout(this.limitTimer);
    if (this.phase === 'idle') return;
    const record: HoldRecord = {
      ...this.warmup.last,
      why: this.why,
      heldFrames: this.heldFrames,
      heldMs: performance.now() - this.requestedAt,
      timedOut,
    };
    this.history.push(record);
    if (this.history.length > 32) this.history.shift();
    this.phase = 'idle';
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }
}
