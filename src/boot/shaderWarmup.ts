import type { Camera, Object3D, Scene, WebGLRenderer } from 'three';

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
 * **Compiles the park's shader programs during the bus ride, a few
 * milliseconds at a time.**
 *
 * ## Why this exists
 *
 * three.js compiles a material's program the first time that material is
 * actually drawn, and finishing that compile blocks the main thread on a
 * synchronous round-trip to the GPU process. Measured on an M4 Pro through
 * headless Chromium with the real Metal backend: **64 of the park's 116 shader
 * links were happening *after* the arrival ended** — i.e. while a child was
 * walking about — costing up to **152 ms for a single program**, and once
 * stalling a frame for **1.29 s**. Standing still never triggered one; walking
 * into a part of the park whose materials had not been drawn yet always did.
 *
 * The park is already generated during the ride precisely so the wait happens
 * somewhere a child is looking at a bus instead of a frozen park. The shader
 * programs belong in exactly the same place, for exactly the same reason.
 *
 * ## Why it is sliced, and why by subtree
 *
 * `renderer.compile()` is synchronous and takes no budget, so the only way to
 * bound it is to bound *what it is given*. {@link buildQueue} splits the graph
 * until each entry holds at most {@link MAX_MESHES_PER_SLICE} meshes, and
 * {@link advance} works through that queue until its budget is spent.
 *
 * **Compiling one mesh at a time would be far slower, not faster.** Every
 * `compile()` call sweeps the *whole* target scene for lights before it looks
 * at a single material (`WebGLRenderer.compile`'s `targetScene.traverseVisible`).
 * Per-mesh that is ~2,200 traversals of a ~2,200-node graph. Batching is what
 * keeps that overhead paid once per slice rather than once per mesh.
 *
 * ## The one thing it relies on
 *
 * `compile()` gathers lights with `traverseVisible` but gathers **materials
 * with plain `traverse`** — so it warms objects that are currently invisible
 * too. That is the whole reason this can work: the programs that were arriving
 * late are mostly things not yet on screen, and a warm-up that only covered
 * what was already visible would have missed precisely the ones that hurt.
 *
 * ## What it does not cover
 *
 * The shadow pass draws with its own depth materials, and `compile()` does not
 * prepare those — they are compiled when the shadow map first renders them.
 * That is why this is measured by counting links after hand-over rather than
 * assumed to have caught everything.
 */
export class ShaderWarmup {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: Camera;

  private queue: Object3D[] = [];
  private startedFlag = false;
  private doneFlag = false;
  private slicesDone = 0;
  private framesWorkedCount = 0;
  private totalMs = 0;
  private worstSliceMs = 0;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
  }

  /**
   * One frame's worth of warm-up.
   *
   * Takes whole slices only. A slice that overruns the budget is *finished*
   * rather than abandoned — `compile()` cannot be interrupted — so the budget
   * decides how many slices are started, not how long one may take. That is
   * why {@link worstSliceMs} is reported: it is the number that says whether
   * {@link MAX_MESHES_PER_SLICE} is set sensibly, and no comment can stand in
   * for it.
   */
  advance(budgetMs: number): void {
    if (this.doneFlag) return;
    if (!this.startedFlag) {
      this.queue = buildQueue(this.scene);
      this.startedFlag = true;
    }
    const started = performance.now();
    this.framesWorkedCount += 1;
    while (this.queue.length > 0) {
      const elapsed = performance.now() - started;
      if (elapsed >= budgetMs) break;
      const node = this.queue.shift();
      if (!node) break;
      const sliceStart = performance.now();
      // `targetScene` is the real scene, so the subtree is compiled against the
      // park's actual lights rather than against no lights at all — which would
      // produce a different program from the one the first real frame wants,
      // and warm the wrong thing.
      this.renderer.compile(node, this.camera, this.scene);
      const sliceMs = performance.now() - sliceStart;
      if (sliceMs > this.worstSliceMs) this.worstSliceMs = sliceMs;
      this.slicesDone += 1;
    }
    this.totalMs += performance.now() - started;
    if (this.queue.length === 0 && this.startedFlag) this.doneFlag = true;
  }

  /** Every slice compiled. The one completion signal; there is no timer. */
  get ready(): boolean {
    return this.doneFlag;
  }

  /** Slices compiled so far, and how many are left — for the boot report. */
  get progress(): { done: number; remaining: number } {
    return { done: this.slicesDone, remaining: this.queue.length };
  }

  /** Frames this has taken work on. */
  get framesWorked(): number {
    return this.framesWorkedCount;
  }

  /** Total milliseconds spent compiling, across every frame. */
  get spentMs(): number {
    return this.totalMs;
  }

  /** The longest single `compile()` call. See {@link advance}. */
  get worstMs(): number {
    return this.worstSliceMs;
  }
}

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
