/**
 * **A generic round-robin scheduler for slicing park generation across frames.**
 *
 * The park is built from many solves — the boundary, the layout, each ride's
 * route, the walk graph — and every one of them has to be spread over the
 * cat-bus ride's frames so no single frame blocks (see `boot/parkGeneration.ts`
 * and `check:park-boot`). Until 11 August 2026 that slicing was hand-wired: two
 * searches (the cruiser and the slide) were generators driven a joint at a time,
 * and everything else ran whole inside its own module-import frame because it was
 * small enough to. The family's ruling that day: **everything should be a slice,
 * and the features should solve *at once* — round-robining across frames — rather
 * than one strictly after another.**
 *
 * This is the generic engine that makes that true. A {@link SolveTask} is a named
 * unit of work expressed as a resumable generator; the scheduler round-robins
 * every task whose dependencies are met, advancing each a slice at a time under a
 * per-frame budget. Independent tasks therefore interleave — they genuinely run
 * together, on different frames — instead of one being made to finish before the
 * next begins.
 *
 * ### Why a generator per task, and why that keeps it deterministic
 *
 * The same argument `rail/generate.ts` makes about its own search: a task's whole
 * state lives in its generator's locals, so suspending it between two `next()`
 * calls preserves everything and resumes at the same statement. Interleaving two
 * tasks cannot make either compute a different answer, because neither shares
 * mutable state with the other *within a step* — a task reads its dependencies'
 * finished results (a dependency is `done` before a dependent may start) and
 * writes only its own. So the park a round-robin schedule builds is byte-for-byte
 * the park a straight-through one builds, whatever order the slices fall in. The
 * scheduler is deterministic given its task set.
 *
 * ### Dependencies, not a fixed order
 *
 * A task names the tasks that must be `done` before it may start ({@link
 * SolveTaskSpec.deps}). That is the *only* ordering constraint; everything not so
 * constrained is free to run concurrently. It is what lets the train and the rail
 * race — both of which only need the cruiser's published route and the layout —
 * advance on alternating frames rather than the train waiting out the whole rail
 * race. A dependency's finished output is read when the dependent's generator is
 * first created (lazily, on its first slice), which is guaranteed to be after the
 * dependency is `done`.
 *
 * ### What this is *not* (yet)
 *
 * It round-robins independent tasks; it does not (yet) let one feature *backtrack
 * another* — move a stall so a route fits. That is a joint search over a shared
 * configuration, a larger thing built on top of this. This is the frame that
 * makes tasks first-class and interleaved; the cooperative backtracking is the
 * next layer, and it needs exactly this round-robin substrate to stand on.
 */

/**
 * A named unit of park generation, resumable a slice at a time.
 *
 * `start()` is called **lazily** — the first time the scheduler gives this task a
 * slice, which is guaranteed to be after every task in {@link deps} is `done`.
 * That is what lets the body read its dependencies' finished results (a solved
 * cruiser route, a placed layout) as ordinary values rather than as promises.
 *
 * The generator yields a progress number (whatever the task finds convenient —
 * an attempt index, a count) purely so a driver can report how far along it is;
 * nothing reads it to make a decision. It returns when the work is complete.
 */
export interface SolveTaskSpec {
  readonly name: string;
  /** Names of tasks that must be `done` before this one may start. */
  readonly deps?: readonly string[];
  /**
   * An extra gate on starting, asked fresh each time the task comes up while
   * unstarted: deps say *what work* must be finished; this says whether the
   * world outside the scheduler is ready — in practice, whether the lazily
   * imported module a task reads has landed. Without it a task would have to
   * busy-yield waiting for its module, which burns budget and makes its slice
   * count a fact about the machine instead of the park.
   */
  ready?(): boolean;
  /**
   * Builds the resumable work. Called once, on this task's first slice.
   *
   * Yield a **number** to report progress and offer the scheduler a chance to
   * stop; the task may be given another slice in the same frame if budget
   * remains. Yield **`'frame'`** to end this task's work for the whole
   * `advance()` call — the next slice comes no earlier than the next frame.
   * That is for joints that must not share a frame with the work beside them
   * (the slide judges a finished route on its own frame, deliberately), and
   * it is a *floor* on separation, never a change to what is computed — the
   * generator's locals carry across either kind of yield identically.
   */
  start(): Generator<number | 'frame', void, void>;
}

/** A clock, injected so the scheduler is testable without `performance.now()`. */
export type Clock = () => number;

interface TaskState {
  readonly spec: SolveTaskSpec;
  gen: Generator<number | 'frame', void, void> | null;
  started: boolean;
  done: boolean;
  /** Ended its own frame with a `'frame'` yield; cleared at the next advance(). */
  frameEnded: boolean;
  progress: number;
  /**
   * How many slices this task has had. Device-independent — the park is
   * deterministic, so for a given seed this is the same everywhere, and it is
   * the other half of `check:park-boot`'s guarantee (frequent chances to stop),
   * exactly as `ParkGeneration.unitCounts` was.
   */
  steps: number;
}

export class SolveScheduler {
  private readonly tasks: readonly TaskState[];
  private readonly byName: Map<string, TaskState>;
  private readonly now: Clock;
  private cursor = 0;
  private failure: Error | null = null;

  /**
   * Slices begun after the frame's deadline had already passed, and which task
   * did it — the device-independent "the scheduler stops when asked" counter,
   * carried over verbatim from `ParkGeneration`. Zero on correct code.
   */
  private overrunSlices = 0;
  private readonly overrunByTask: Record<string, number> = {};

  constructor(specs: readonly SolveTaskSpec[], now: Clock = () => performance.now()) {
    this.now = now;
    this.tasks = specs.map((spec) => ({
      spec,
      gen: null,
      started: false,
      done: false,
      frameEnded: false,
      progress: 0,
      steps: 0,
    }));
    this.byName = new Map(this.tasks.map((task) => [task.spec.name, task]));
    if (this.byName.size !== this.tasks.length) {
      throw new Error('SolveScheduler: two tasks share a name');
    }
    for (const task of this.tasks) {
      for (const dep of task.spec.deps ?? []) {
        if (!this.byName.has(dep)) {
          throw new Error(`SolveScheduler: task '${task.spec.name}' depends on unknown task '${dep}'`);
        }
      }
    }
    this.assertNoCycles();
  }

  /** Every task has finished. */
  get done(): boolean {
    return this.tasks.every((task) => task.done);
  }

  /** The error a task threw, if one did. Generation is over when this is set. */
  get failed(): Error | null {
    return this.failure;
  }

  /** Slices begun after a frame's deadline. Zero, on correct code. */
  get slicesPastDeadline(): number {
    return this.overrunSlices;
  }

  /** Which tasks began a slice late — the diagnosis, not just the count. */
  get lateSlicesByTask(): Readonly<Record<string, number>> {
    return this.overrunByTask;
  }

  /** How many slices each task has had. Device-independent piece counts. */
  get sliceCounts(): Readonly<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const task of this.tasks) out[task.spec.name] = task.steps;
    return out;
  }

  /** The last progress number `name` yielded, or 0. For a driver's reporting. */
  progressOf(name: string): number {
    return this.byName.get(name)?.progress ?? 0;
  }

  /** Has `name` finished? Unknown names are simply not done, never a throw. */
  isDone(name: string): boolean {
    return this.byName.get(name)?.done ?? false;
  }

  /** The tasks started but not finished — what is "running" this frame. */
  get running(): readonly string[] {
    return this.tasks.filter((task) => task.started && !task.done).map((task) => task.spec.name);
  }

  /**
   * Advance generation for up to `budgetMs`, round-robining every runnable task.
   *
   * Safe to call every frame, including after it is done or has failed. Each turn
   * of the loop finds the next runnable task from a rotating cursor and gives it
   * exactly one slice (`gen.next()`), so tasks take turns both within one frame
   * and across frames. The clock is read after every slice, so once a slice has
   * run the loop never *begins* another past the deadline — the overrun counter
   * is therefore 0 on correct code, the same guarantee `ParkGeneration` proved.
   */
  advance(budgetMs: number): void {
    if (this.failure || this.done) return;
    // A 'frame' yield ends a task's frame, and this is the next frame.
    for (const task of this.tasks) task.frameEnded = false;
    const deadline = this.now() + budgetMs;
    let sliced = 0;
    for (;;) {
      const task = this.nextRunnable();
      if (!task) return; // nothing runnable — done, failed, or (a bug) deadlocked
      if (sliced > 0 && this.now() >= deadline) {
        this.overrunSlices += 1;
        this.overrunByTask[task.spec.name] = (this.overrunByTask[task.spec.name] ?? 0) + 1;
      }
      sliced += 1;
      try {
        if (!task.started) {
          task.gen = task.spec.start();
          task.started = true;
        }
        const step = (task.gen as Generator<number | 'frame', void, void>).next();
        task.steps += 1;
        if (step.done) {
          task.done = true;
          task.gen = null;
        } else if (step.value === 'frame') {
          task.frameEnded = true;
        } else {
          task.progress = step.value;
        }
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error(String(error));
        return;
      }
      if (this.now() >= deadline) return;
    }
  }

  // -------------------------------------------------------------- internals

  /** A task is runnable if it is unfinished and either in flight or ready to start. */
  private runnable(task: TaskState): boolean {
    if (task.done || task.frameEnded) return false;
    if (task.started) return true;
    for (const dep of task.spec.deps ?? []) {
      if (!(this.byName.get(dep) as TaskState).done) return false;
    }
    return !task.spec.ready || task.spec.ready();
  }

  /** The next runnable task from the rotating cursor, or null. Advances the cursor. */
  private nextRunnable(): TaskState | null {
    const n = this.tasks.length;
    for (let i = 0; i < n; i += 1) {
      const index = (this.cursor + i) % n;
      const task = this.tasks[index] as TaskState;
      if (this.runnable(task)) {
        this.cursor = (index + 1) % n;
        return task;
      }
    }
    return null;
  }

  /** Kahn's algorithm, so a bad dependency graph fails loudly at construction. */
  private assertNoCycles(): void {
    const indegree = new Map<string, number>();
    for (const task of this.tasks) indegree.set(task.spec.name, 0);
    for (const task of this.tasks) {
      for (const _dep of task.spec.deps ?? []) {
        indegree.set(task.spec.name, (indegree.get(task.spec.name) as number) + 1);
      }
    }
    const queue = [...indegree.entries()].filter(([, d]) => d === 0).map(([name]) => name);
    let visited = 0;
    while (queue.length > 0) {
      const name = queue.pop() as string;
      visited += 1;
      for (const task of this.tasks) {
        if ((task.spec.deps ?? []).includes(name)) {
          const left = (indegree.get(task.spec.name) as number) - 1;
          indegree.set(task.spec.name, left);
          if (left === 0) queue.push(task.spec.name);
        }
      }
    }
    if (visited !== this.tasks.length) {
      throw new Error('SolveScheduler: the task dependency graph has a cycle');
    }
  }
}
