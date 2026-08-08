import type { SolvedRailRoute } from '../world/rail/generate';
import { railRouteSearch } from '../world/rail/generate';
import { offerPrewarmedSlide } from '../world/slide/prewarm';

/**
 * **Building the park a few milliseconds at a time, while a bus is on screen.**
 *
 * Jim, 7 August 2026:
 *
 * > *"this is the time when the procgen should actually run, amortised over
 * > many small tasks over many frames, so it acts as a kind of loading screen
 * > for the park generation"*
 *
 * ## What was actually costing the boot
 *
 * Measured on this branch, not guessed: the park's boot is **~4.5 s**, of which
 * `World`'s constructor is 442 ms and **the other ~4 s is module-scope
 * generation** — every ride's route is solved by a top-level `const` as its
 * module is first imported, because `paths.ts` needs each ride's exit to build
 * the walk graph and cannot wait for a scene. `SLIDE_PLAN` alone is **~3.46 s,
 * 86% of it**.
 *
 * The ride used to cover only the 442 ms, because `main.ts` imported `Game`
 * statically: the whole four seconds was spent before the first bus frame could
 * be drawn. So the loading screen covered about a tenth of the load.
 *
 * ## Two different problems, two different answers
 *
 * **The small solves are each about a frame's worth**, so they only need to be
 * on separate frames. Dynamic `import()` gives that for free — the module
 * evaluation that runs the top-level `const` happens when the promise settles,
 * and settling returns to the event loop, so one import is one frame.
 * {@link ORDERED_MODULES} is that list, in dependency order.
 *
 * **The slide is not**, at 3.46 s, and no import boundary will help. It is one
 * `solveRailRoute` call, so it is sliced from the inside: `railRouteSearch`
 * suspends at every joint (~35 us of work), and {@link advance} runs it until a
 * millisecond budget is spent. That is the "many small tasks" half of the ask,
 * and it is the only part of the park that needed inventing anything.
 *
 * ## Why this class has no DOM, no `Game` and no renderer in it
 *
 * So that a check can build a real one and drive it. `Game` cannot be
 * constructed outside a browser — it makes a `WebGLRenderer` — and on this
 * feature *three separate guards* have already turned out to be incapable of
 * failing, one of them for exactly that reason (fixed by moving the decision
 * into `arrivalSpawn.ts`; `journeyDirector.ts` is the same pattern, and so is
 * this).
 *
 * Everything here is pure module loading and arithmetic, so
 * `scripts/check-park-boot.mts` builds one in Node, advances it with real frame
 * budgets and a real clock, and measures **what each frame actually cost** —
 * rather than asserting that a function was called. Importing `Game` itself
 * stays in `main.ts`, which is where it already lived and which has nothing
 * left to amortise.
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
 * The park's solved artefacts, in the order one depends on the next.
 *
 * Each entry is a module whose top-level `const` solves something: the boundary
 * (~43 ms), the layout (~3), the train (~44), the Sky Cruiser (~37), the rail
 * race (~13). Importing them one per frame is what turns a ~140 ms block into
 * five frames nobody notices.
 *
 * **The order matters and the list does not have to be complete.** It matters
 * because a module that is imported already-solved costs nothing, so getting
 * the order wrong just means one frame does two solves. It does not have to be
 * complete because `main.ts` imports `Game` at the end regardless, which pulls
 * in anything missed — so the failure mode of this list falling out of date as
 * the park grows is *a slightly lumpier boot*, never a wrong or half-built
 * park. That is the safe direction, and it is why this is allowed to be a
 * hand-kept list at all.
 */
const ORDERED_MODULES: readonly (() => Promise<unknown>)[] = [
  () => import('../world/boundary'),
  () => import('../world/parkLayout'),
  () => import('../world/train/plan'),
  () => import('../world/coaster/plan'),
  () => import('../world/railRace/plan'),
];

/** Roughly where generation has got to, for a caption or a check. */
export type GenerationStage =
  | 'waiting'
  | 'measuring out the park'
  | 'shaping the ginormous slide'
  | 'joining up the paths'
  | 'ready';

/**
 * Drives the park's generation in slices. One per boot; `main.ts` owns it.
 *
 * {@link advance} is synchronous and returns immediately — it either spends the
 * budget on the slide's search or starts a module import and comes back next
 * frame. Nothing here ever blocks for longer than the budget except a single
 * module evaluation, which is one small solve.
 */
export class ParkGeneration {
  private moduleIndex = 0;
  private importInFlight = false;
  private search: Generator<number, SolvedRailRoute, void> | null = null;
  private solveModule: typeof import('../world/slide/solve') | null = null;
  private slideSolved = false;
  private pathsDone = false;
  private failure: Error | null = null;

  /** Frames on which this was asked to do work and did some. */
  private workingFrames = 0;
  /** Attempts the slide's search has begun — the only progress figure there is. */
  private attemptsSeen = 0;

  /** Everything is solved and `SLIDE_PLAN` will be free when it is imported. */
  get ready(): boolean {
    return this.pathsDone;
  }

  /**
   * The generation that failed, if one did.
   *
   * A slide that cannot be solved throws — `planSlide` refuses the unsatisfied
   * fallback, deliberately. When that happens here nothing is pre-warmed, so
   * `SLIDE_PLAN` solves again the ordinary way when `Game` is imported and
   * throws in exactly the place and shape it always did, reaching `main.ts`'s
   * own "Oh no!" card. Costly on an error path, and identical behaviour, which
   * is worth more.
   */
  get failed(): Error | null {
    return this.failure;
  }

  get stage(): GenerationStage {
    if (this.pathsDone) return 'ready';
    if (this.slideSolved) return 'joining up the paths';
    if (this.moduleIndex >= ORDERED_MODULES.length) return 'shaping the ginormous slide';
    if (this.moduleIndex > 0 || this.importInFlight) return 'measuring out the park';
    return 'waiting';
  }

  /** How many frames have done real generation work. */
  get framesWorked(): number {
    return this.workingFrames;
  }

  /** How many of the slide search's attempts have been started. */
  get attempts(): number {
    return this.attemptsSeen;
  }

  /**
   * Generate for up to `budgetMs`, then get out of the way.
   *
   * Safe to call every frame, including after it is ready or has failed. Never
   * re-enters an import that is still in flight.
   */
  advance(budgetMs: number): void {
    if (this.pathsDone || this.failure || this.importInFlight) return;

    // The small solves: one module, one frame.
    const next = ORDERED_MODULES[this.moduleIndex];
    if (next) {
      this.moduleIndex += 1;
      this.workingFrames += 1;
      this.runImport(next());
      return;
    }

    // The slide's own module, which brings the castle and the coaster it
    // measures itself against with it.
    if (!this.solveModule) {
      this.workingFrames += 1;
      this.runImport(
        import('../world/slide/solve').then((module) => {
          this.solveModule = module;
        }),
      );
      return;
    }

    // The 3.46 s, in eight-millisecond pieces.
    if (!this.slideSolved) {
      this.advanceSlide(this.solveModule, budgetMs);
      return;
    }

    // `paths.ts` last: it reads `SLIDE_PLAN`, so it must not be imported until
    // the pre-warmed plan is in the letterbox above.
    this.workingFrames += 1;
    this.runImport(
      import('../world/paths').then(() => {
        this.pathsDone = true;
      }),
    );
  }

  /**
   * Runs the search until the budget is gone.
   *
   * The clock is read every joint rather than every N joints: a joint is ~35 us
   * and `performance.now()` is a few tens of nanoseconds, so the check costs
   * well under a percent and buys an exact budget instead of an estimated one.
   */
  private advanceSlide(solve: typeof import('../world/slide/solve'), budgetMs: number): void {
    this.workingFrames += 1;
    // Built once, on the frame the search starts, and never again — the brief
    // is pure but `doorPoses()` and `pitPoses()` are not free.
    const search = (this.search ??= railRouteSearch(solve.slideRouteBrief()));

    const deadline = performance.now() + budgetMs;
    try {
      for (;;) {
        const step = search.next();
        if (step.done) {
          // **The same three steps, in the same order, as `planSlide()`.**
          // Solved here, finished by the slide's own code, and handed over.
          offerPrewarmedSlide(solve.finishSlidePlan(step.value));
          this.slideSolved = true;
          return;
        }
        this.attemptsSeen = step.value;
        if (performance.now() >= deadline) return;
      }
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
    }
  }

  /** Marks an import in flight so no frame starts a second one on top of it. */
  private runImport(work: Promise<unknown>): void {
    this.importInFlight = true;
    work
      .catch((error: unknown) => {
        this.failure = error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => {
        this.importInFlight = false;
      });
  }
}
