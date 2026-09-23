import { SolveScheduler } from './solveScheduler';
import type { GroundClaims } from './groundClaims';
import { loadPrebuiltPark } from './prebuiltPark';

/**
 * **Building the park a few milliseconds at a time, while a bus is on screen.**
 *
 * Jim, 7 August 2026:
 *
 * > *"this is the time when the procgen should actually run, amortised over
 * > many small tasks over many frames, so it acts as a kind of loading screen
 * > for the park generation"*
 *
 * And Jim, 3 September 2026, the ruling this file's shape now serves
 * (`docs/DESIGN-round-robin-generation.md`): park features are to generate
 * **all at the same time, round-robin, with backtracking** — so the driver
 * here is **one scheduler** holding every solve as a task, not a hand-ordered
 * chain of phases. Today the task graph reproduces the exact order the
 * hand-ordered chain ran in, so the park is byte-identical (proved by
 * `check:park-boot`'s sliced-vs-straight-through hashes).
 *
 * **Be honest about what serializes the order today: the import ladder, not
 * the `deps`.** Review of #499 measured it — removing the `deps` from
 * `trainSearch`, `slideSearch`, `crossingSites` and `pathGraph` leaves the
 * task order character-for-character unchanged, because each of those tasks
 * is *also* held by a `ready()` gate on a module that the strictly-ordered
 * ladder only loads behind a `gate()` on the very task the dep names. The
 * deps document the data a task genuinely reads (and become load-bearing the
 * moment the module gating loosens), but **relaxing a dep alone changes
 * nothing** — do not conclude from that experiment that the spine is inert.
 * What stage 3 actually has to do is **confront the ladder**: load a
 * migrating placer's modules eagerly (or behind data-readiness rather than
 * task-completion gates), so that its task's `ready()` answers true while
 * other tasks still run — at which point the scheduler genuinely interleaves
 * it and the `deps`/claims become the real constraints. One placer per PR,
 * never a big-bang rewrite of a monolithic driver.
 *
 * ## What was actually costing the boot
 *
 * Measured (7 Aug): the park's boot was **~4.5 s**, of which `World`'s
 * constructor is 442 ms and **the other ~4 s is module-scope generation** —
 * every ride's route is solved by a top-level `const` as its module is first
 * imported, because `paths.ts` needs each ride's exit to build the walk graph
 * and cannot wait for a scene. `SLIDE_PLAN` alone was **~3.46 s, 86% of it**.
 *
 * ## Two different problems, two different answers
 *
 * **The small solves are each about a frame's worth**, so they only need to be
 * on separate frames. Dynamic `import()` gives that for free — the module
 * evaluation that runs the top-level `const` happens when the promise settles,
 * and settling returns to the event loop, so one import is one frame. Those
 * imports are the {@link ImportStep} ladder below, in dependency order — they
 * are Vite chunk loading, not park placement, which is why they stay the
 * driver's own business rather than becoming scheduler tasks: an import
 * completes on the event loop *between* frames, and a task that waited on one
 * would busy-yield its budget away (see `SolveTaskSpec.ready`, which is the
 * clean half of the same answer).
 *
 * **The big solves are sliced from the inside** — each suspends at every joint
 * and the scheduler runs it until a millisecond budget is spent. They are the
 * {@link SolveScheduler} tasks: the cruiser's brief/search/finish, the train's
 * loop, the slide's ladder, the crossing-plan march, and the walk graph.
 *
 * ## Why this class has no DOM, no `Game` and no renderer in it
 *
 * So that a check can build a real one and drive it. `Game` cannot be
 * constructed outside a browser — it makes a `WebGLRenderer` — and on this
 * feature *three separate guards* have already turned out to be incapable of
 * failing, one of them for exactly that reason. Everything here is pure module
 * loading and arithmetic, so `scripts/check-park-boot.mts` builds one in Node,
 * advances it with real frame budgets and a real clock, and measures **what
 * each frame actually cost** — rather than asserting that a function was
 * called.
 */

/**
 * How long a frame may spend generating, in milliseconds.
 *
 * A sixty-hertz frame is 16.7 ms and the ride still has a bus, twelve children
 * and a thousand instanced trees to draw in it. Eight leaves comfortably more
 * than half the frame for that, and finishes the slide in about **7 s of a 20 s
 * ride** on this machine — early enough that the skip is on offer for most of
 * the journey.
 *
 * The temptation is to raise it, because the whole thing then finishes sooner.
 * Do not: the orbit is the shot, and a camera that stutters once a second is a
 * worse failure than a park that takes longer to be ready — nobody is waiting
 * on it, the bus has nineteen more seconds to fill. If generation genuinely
 * cannot finish inside the ride on some slower device, `JourneyDirector` holds
 * the bus at the kerb rather than handing over, which is the honest outcome.
 */
export const GENERATION_BUDGET_MS = 8;

/**
 * How long a frame may spend generating **once the ride has overrun its nominal
 * length and the drive is looping** while it waits for the park — see
 * `JourneyDirector.overrunAwareBudgetMs`.
 *
 * It was **200 ms**, on a premise that no longer holds: that once the ride
 * ended the bus *parked*, so there was no moving shot left to keep smooth. The
 * bus now **loops and keeps moving** throughout the overrun, so a frame that
 * blocks for 200 ms jerks the moving bus, its orbiting camera and the rolling
 * countryside alike — measured on a throttled overrun, the 200 ms budget
 * produced a p99 frame interval of ~209 ms, the "jumpy while it generates" Jim
 * reported. At 12 ms a frame is budget + at most one work unit (the slide's
 * dearest is ~2 ms), inside one 60 Hz refresh with room for the light looping
 * scene to draw.
 *
 * **The trade, stated honestly.** A smaller budget means a longer wait on a
 * slow device: the loop drains at 12 ms a frame rather than 200. Jim reported
 * *jumpiness, not slowness*, and a smooth loop that lasts a few seconds longer
 * reads far better than a juddering one that ends a moment sooner. If the raw
 * wait is itself too long on real hardware the fix is cheaper generation, not
 * a fatter budget that trades the smoothness back away.
 *
 * `check:park-boot` drives generation at this budget and asserts no single
 * frame blocks past one refresh's worth of work; `check:arrival-completes`
 * asserts the loop still *completes* at whatever budget this is.
 */
export const OVERRUN_GENERATION_BUDGET_MS = 12;

/** Roughly where generation has got to, for a caption or a check. */
export type GenerationStage =
  | 'waiting'
  | 'measuring out the park'
  | 'flying the sky cruiser'
  | 'laying the railway'
  | 'shaping the ginormous slide'
  | 'joining up the paths'
  | 'ready';

/**
 * One rung of the import ladder: a dynamic import to run on its own frame,
 * held until `gate()` (if given) answers true. The ladder is strictly ordered —
 * rung n+1 is never considered before rung n has completed — because module
 * evaluation order is meaning here: a top-level `const` initialises on first
 * import, and several of them read letterboxes a solve task must fill first.
 */
interface ImportStep {
  /** Why this import exists / what it unblocks — for a failure that names it. */
  readonly name: string;
  readonly begin: () => Promise<unknown>;
  /** Held until this answers true. Omitted: ready as soon as it is reached. */
  readonly gate?: () => boolean;
}

/**
 * Drives the park's generation in slices. One per boot; `main.ts` owns it.
 *
 * {@link advance} is synchronous and returns immediately — it either spends the
 * budget in the scheduler or starts a module import and comes back next frame.
 * Nothing here ever blocks for longer than the budget except a single module
 * evaluation, which is one small solve.
 *
 * ### The shape: one import ladder + one scheduler
 *
 * - The {@link ImportStep} ladder loads modules one per frame, each rung gated
 *   on the solve whose letterbox it reads (`train/route` waits for the solved
 *   cruiser; the crossing modules wait for the solved slide; `pathGraph` waits
 *   for the solved walk graph).
 * - The {@link SolveScheduler} holds every solve as a task. Tasks gate on
 *   their modules with `ready()` and name the data they read as `deps`.
 *   **Today the ladder's gates make four of the six deps inert** (see the
 *   module header) — the order is the ladder's, byte-identical to the old
 *   chain, and a placer joins the genuine round-robin at stage 3 by
 *   loosening its module gating, not by touching deps alone.
 *
 * ### Failure semantics, preserved exactly
 *
 * - A cruiser ladder that exhausts even its rescue tier throws
 *   `RailRouteUnsolvable` out of the task; the scheduler records it as
 *   `failed`, nothing is offered to the letterbox, and `COASTER_PLANS`
 *   re-solves and throws in exactly the place and shape it always did.
 * - The slide catches `RailRouteUnsolvable` *per rung* (a target that admits
 *   no route is a rung that did not work, not a park that cannot be built)
 *   and throws only when every one of `SLIDE_ATTEMPTS` is spent.
 */
export class ParkGeneration {
  private readonly scheduler: SolveScheduler;
  private importIndex = 0;
  private importInFlight = false;
  private failure: Error | null = null;
  private pathsDone = false;
  private planModule: typeof import('../world/parkPlan') | null = null;
  private workingFrames = 0;
  private slicesSeen = 0;
  /**
   * The import ladder. `world/parkPlan.ts` imports every solver the park's
   * driver needs, so the ladder is three rungs: the prebuilt park file, the
   * plan (solvers), then the graph and world modules that read the decided
   * plan.
   */
  private readonly importLadder: readonly ImportStep[] = [
    // **First, this park's prebuilt decisions** (`boot/prebuiltPark.ts`): the
    // plan's driver reads the offered file once, when it starts, so the fetch
    // has to have settled — found, refused or given up on — before the plan
    // task can be ready. On an installed game it is a precache hit.
    {
      name: 'prebuiltPark',
      begin: () => loadPrebuiltPark(),
    },
    {
      name: 'parkPlan',
      begin: () =>
        import('../world/parkPlan').then((module) => {
          this.planModule = module;
        }),
    },
    {
      name: 'pathGraph',
      gate: () => this.scheduler.isDone('parkPlan'),
      begin: () =>
        import('../world/pathGraph').then(() => {
          this.pathsDone = true;
        }),
    },
  ];

  constructor() {
    const self = this;
    this.scheduler = new SolveScheduler([
      {
        name: 'parkPlan',
        ready: () => self.planModule !== null,
        *start() {
          const module = self.planModule as typeof import('../world/parkPlan');
          yield* module.parkPlanSearch();
        },
      },
    ]);
  }

  /** The registry the driver's builders committed into — the same object the `World` adopts. */
  get groundClaims(): GroundClaims {
    if (!this.planModule) throw new Error('park generation: the plan has not been imported yet');
    return this.planModule.parkPlanClaims();
  }

  get ready(): boolean {
    return this.pathsDone;
  }

  get failed(): Error | null {
    return this.failure ?? this.scheduler.failed;
  }

  /** What the park is doing, for the boot screen — read off the decisions placed so far. */
  get stage(): GenerationStage {
    if (this.pathsDone) return 'ready';
    const placed = new Set(this.planModule?.parkPlanPlaced() ?? []);
    if (placed.has('crossings') || placed.has('slide')) return 'joining up the paths';
    if (placed.has('train')) return 'shaping the ginormous slide';
    if (placed.has('cruiser')) return 'laying the railway';
    if (placed.has('layout')) return 'flying the sky cruiser';
    if (this.importIndex > 0 || this.importInFlight) return 'measuring out the park';
    return 'waiting';
  }

  get framesWorked(): number {
    return this.workingFrames;
  }

  /** Retries plus unwinds the driver has spent — the boot screen's "still trying" number. */
  get attempts(): number {
    const stats = this.planModule?.parkSolveStats();
    return stats ? stats.retries + stats.unwinds : 0;
  }

  get cruiserAttempts(): number {
    return this.planModule?.parkSolveStats()?.turnsByFeature['cruiser'] ?? 0;
  }

  get stepsPastDeadline(): number {
    return this.scheduler.slicesPastDeadline;
  }

  get lateStepsByPhase(): Readonly<Record<string, number>> {
    return this.scheduler.lateSlicesByTask;
  }

  /** Work units per phase, by the driver's own count of turns each feature took. */
  get unitCounts(): Readonly<
    Record<'brief' | 'cruiserSearch' | 'cruiserFinish' | 'trainSearch' | 'slideSearch', number>
  > {
    // Pieces: the yields each feature's advance made, not its turns — the
    // count a boot that stops between frames can actually use.
    const pieces = this.planModule?.parkSolveStats()?.piecesByFeature ?? {};
    const finish = this.planModule?.parkPlanCruiserFinishPieces() ?? 0;
    return {
      brief: pieces['layout'] ?? 0,
      cruiserSearch: Math.max(0, (pieces['cruiser'] ?? 0) - finish),
      cruiserFinish: finish,
      trainSearch: pieces['train'] ?? 0,
      slideSearch: pieces['slide'] ?? 0,
    };
  }

  get sliceCountsByTask(): Readonly<Record<string, number>> {
    return this.scheduler.sliceCounts;
  }

  get cruiserFinishSeamCount(): number {
    return this.planModule?.parkPlanCruiserFinishSeams() ?? 0;
  }

  advance(budgetMs: number): void {
    if (this.pathsDone || this.failed || this.importInFlight) return;
    const step = this.importLadder[this.importIndex];
    if (step && (!step.gate || step.gate())) {
      this.importIndex += 1;
      this.workingFrames += 1;
      this.runImport(step);
      return;
    }
    this.scheduler.advance(budgetMs);
    const sliced = Object.values(this.scheduler.sliceCounts).reduce((a, b) => a + b, 0);
    if (sliced > this.slicesSeen) {
      this.slicesSeen = sliced;
      this.workingFrames += 1;
    }
  }

  private runImport(step: ImportStep): void {
    this.importInFlight = true;
    queueMicrotask(() => {
      step
        .begin()
        .catch((error: unknown) => {
          this.failure =
            error instanceof Error
              ? error
              : new Error(`importing ${step.name}: ${String(error)}`);
        })
        .finally(() => {
          this.importInFlight = false;
        });
    });
  }
}
