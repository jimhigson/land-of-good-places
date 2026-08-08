import type { SolvedRailRoute } from '../world/rail/generate';
import { railRouteSearch, RailRouteUnsolvable } from '../world/rail/generate';
import type { CruiserSearchStart } from '../world/coaster/solve';
import { offerPrewarmedCruiser } from '../world/coaster/prewarm';
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
 * {@link MODULES_BEFORE_CRUISER} and {@link MODULES_AFTER_CRUISER} are those
 * lists, in dependency order.
 *
 * **Two of them are not small**, and no import boundary helps either: each is
 * one `solveRailRoute` call. They are sliced from the inside instead —
 * `railRouteSearch` suspends at every joint (~35 us of work), and {@link advance}
 * runs it until a millisecond budget is spent. That is the "many small tasks"
 * half of the ask, and it is the only part of the park that needed inventing
 * anything.
 *
 * - **the ginormous slide**, at ~3.46 s;
 * - **the Sky Cruiser**, at ~1.3 s, sliced second (#252) once the cost stopped
 *   being billed to the train that merely imports it — see
 *   {@link MODULES_AFTER_CRUISER}.
 *
 * The two sit either side of the module list rather than together, because
 * `train/plan.ts` and everything after it read `COASTER_PLANS`: the cruiser has
 * to be in its letterbox before the first module that imports it is evaluated,
 * or the const it feeds has already initialised the slow way.
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
 * The ground the Sky Cruiser measures itself against, before it is solved.
 *
 * The boundary (~55 ms) and the layout (~9 ms). Each is one module whose
 * top-level `const` solves something, and importing them one per frame is what
 * turns one block into two frames nobody notices.
 *
 * They are listed separately from {@link MODULES_AFTER_CRUISER} rather than
 * being pulled in transitively by `coaster/solve` — which imports both — because
 * a single import settling would evaluate all three in **one** block. Naming
 * them here is what buys them a frame each.
 */
const MODULES_BEFORE_CRUISER: readonly (() => Promise<unknown>)[] = [
  () => import('../world/boundary'),
  () => import('../world/parkLayout'),
];

/**
 * The park's remaining solved artefacts, in the order one depends on the next.
 *
 * The train (~157 ms of its own) and the rail race (~13 ms). **Both are after
 * the cruiser, and that ordering is the fix for a real bug rather than a
 * tidy-up.**
 *
 * `train/plan.ts` imports `COASTER_PLANS`, and this list used to load
 * `train/plan` *first* — so the cruiser's entire ~1.3 s solve was evaluated
 * inside the train's import and billed to the train's frame. Measured in that
 * order: `train/plan` 1439.6 ms, `coaster/plan` **0.3 ms**. Issue #252 read that
 * number off this list and went after the train's search, which could not have
 * fixed it: with PR #253's train fix applied the worst block moved 1354 ms to
 * 1300 ms against a 250 ms ceiling, because ~1288 ms of it was never the train.
 *
 * A module whose measured cost is really its dependency's is a measurement that
 * lies in the most expensive way — it sends the next person to the wrong file.
 * Solving the cruiser above means each of these is now billed for its own work.
 *
 * **The list does not have to be complete.** `main.ts` imports `Game` at the end
 * regardless, which pulls in anything missed — so the failure mode of this list
 * falling out of date as the park grows is *a slightly lumpier boot*, never a
 * wrong or half-built park. That is the safe direction, and it is why this is
 * allowed to be a hand-kept list at all.
 */
const MODULES_AFTER_CRUISER: readonly (() => Promise<unknown>)[] = [
  () => import('../world/train/plan'),
  () => import('../world/railRace/plan'),
];

/** Roughly where generation has got to, for a caption or a check. */
export type GenerationStage =
  | 'waiting'
  | 'measuring out the park'
  | 'flying the sky cruiser'
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
  private afterIndex = 0;
  private importInFlight = false;
  private search: Generator<number, SolvedRailRoute, void> | null = null;

  /** The cruiser's how-module, once loaded. Holds no solved route itself. */
  private cruiserModule: typeof import('../world/coaster/solve') | null = null;
  private cruiserStart: CruiserSearchStart | null = null;
  private cruiserStartSearch: Generator<number, CruiserSearchStart, void> | null = null;
  private cruiserSearch: Generator<number, SolvedRailRoute, void> | null = null;
  /**
   * Whether the harder-pulling retry is the one being searched.
   *
   * The straight-through path solves the first brief, and re-solves with twice
   * the castle influence if the loop it got never crossed the castle. This walks
   * the same two steps in the same order — one policy, two cadences, exactly as
   * the slide's length ladder is walked by both `planSlide()` and this class.
   */
  private cruiserEscalated = false;
  private cruiserSolved = false;
  private cruiserAttemptsSeen = 0;

  /**
   * Which rung of `DESIRED_LENGTH_LADDER` the sliced search is on. The hotel
   * merge brought the ladder in (seed 5: a fixed 60 m target solved 123
   * routes and threw every one away), and the sliced path must walk the SAME
   * ladder `planSlide()` walks or the two cadences stop being one search.
   */
  private rung = 0;

  /** The last rung's complaint, for the error if the whole ladder fails. */
  private lastComplaint = 'never solved a route at all';
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
    if (this.cruiserSolved) return 'shaping the ginormous slide';
    if (this.moduleIndex >= MODULES_BEFORE_CRUISER.length) return 'flying the sky cruiser';
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

  /** How many of the Sky Cruiser search's attempts have been started. */
  get cruiserAttempts(): number {
    return this.cruiserAttemptsSeen;
  }

  /**
   * Generate for up to `budgetMs`, then get out of the way.
   *
   * Safe to call every frame, including after it is ready or has failed. Never
   * re-enters an import that is still in flight.
   */
  advance(budgetMs: number): void {
    if (this.pathsDone || this.failure || this.importInFlight) return;

    // The ground the cruiser is measured against: one module, one frame.
    const before = MODULES_BEFORE_CRUISER[this.moduleIndex];
    if (before) {
      this.moduleIndex += 1;
      this.workingFrames += 1;
      this.runImport(before());
      return;
    }

    // The cruiser's own how-module. Nothing in it solves at module scope —
    // that is the whole point of the `solve.ts`/`plan.ts` split.
    if (!this.cruiserModule) {
      this.workingFrames += 1;
      this.runImport(
        import('../world/coaster/solve').then((module) => {
          this.cruiserModule = module;
        }),
      );
      return;
    }

    // The ~1.3 s, in eight-millisecond pieces. Everything below imports
    // `COASTER_PLANS` sooner or later, so this has to finish first or the
    // letterbox is read after the const it feeds has already initialised.
    if (!this.cruiserSolved) {
      this.advanceCruiser(this.cruiserModule, budgetMs);
      return;
    }

    // The small solves that depend on the cruiser: one module, one frame.
    const after = MODULES_AFTER_CRUISER[this.afterIndex];
    if (after) {
      this.afterIndex += 1;
      this.workingFrames += 1;
      this.runImport(after());
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
   * Runs the Sky Cruiser's search until the budget is gone.
   *
   * The same driver as {@link advanceSlide} over the same generator, and the
   * same argument for why the cadence cannot move the route: the search's whole
   * state is generator locals, so suspending it cannot reorder an `Rng` draw
   * (`rail/generate.ts`). `check:park-boot` proves it rather than asserting it,
   * by hashing this loop against a straight-through `planCruiser()`.
   *
   * A `RailRouteUnsolvable` is **not** caught, unlike the slide's per-rung
   * throw. The straight-through path does not catch it either — it comes out of
   * `COASTER_PLANS`'s initialiser and `check:cruiser-solves` is what reports it —
   * so swallowing it here would make the two cadences disagree about what a
   * park that cannot be built looks like. It becomes `failed`, nothing is
   * offered to the letterbox, and `COASTER_PLANS` re-solves and throws in
   * exactly the place and shape it always did.
   */
  private advanceCruiser(
    solve: typeof import('../world/coaster/solve'),
    budgetMs: number,
  ): void {
    this.workingFrames += 1;
    const deadline = performance.now() + budgetMs;

    // Phase one: the briefs, a ring of candidate stations at a time. ~19 ms of
    // `boundary.distanceToEdge`, which is too much for one frame on its own, so
    // it is driven to the same budget as the search that follows it.
    if (!this.cruiserStart) {
      const building = (this.cruiserStartSearch ??= solve.cruiserStartSearch());
      for (;;) {
        const step = building.next();
        if (step.done) {
          this.cruiserStart = step.value;
          this.cruiserStartSearch = null;
          break;
        }
        if (performance.now() >= deadline) return;
      }
    }
    const start = this.cruiserStart;

    // Phase two: the route itself.
    const search = (this.cruiserSearch ??= railRouteSearch(
      this.cruiserEscalated ? start.briefs.escalated : start.briefs.first,
    ));

    try {
      for (;;) {
        const step = search.next();
        if (step.done) {
          // **The same verdict, in the same order, as the constructor's**:
          // a loop that never crossed the castle earns one re-solve at twice
          // the influence, and whatever the second search returns is taken.
          if (!this.cruiserEscalated && !step.value.report.satisfied) {
            this.cruiserEscalated = true;
            this.cruiserSearch = null;
            return;
          }
          offerPrewarmedCruiser(solve.finishCruiserPlan(step.value, start.rng));
          this.cruiserSolved = true;
          return;
        }
        this.cruiserAttemptsSeen = step.value;
        if (performance.now() >= deadline) return;
      }
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
    }
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
    const ladder = solve.DESIRED_LENGTH_LADDER;
    const target = ladder[this.rung];
    if (target === undefined) {
      // Every rung tried, none rideable — the same terminal answer
      // `planSlide()` gives, with the same shape of message.
      this.failure = new Error(
        `the ginormous slide never solved to a chute a child could ride: ` +
          `after ${ladder.length} target lengths (${ladder.join(', ')} m), ` +
          `the best on offer ${this.lastComplaint}.`,
      );
      return;
    }
    // Built once per rung, on the frame that rung starts — the brief is pure
    // but `doorPoses()` and `pitPoses()` are not free.
    const search = (this.search ??= railRouteSearch(solve.slideRouteBriefAt(target)));

    const deadline = performance.now() + budgetMs;
    try {
      for (;;) {
        const step = search.next();
        if (step.done) {
          // **The same verdict, in the same order, as `planSlide()`**: judge
          // the rung's route, step to the next rung on a complaint, finish
          // and hand over on a clean one.
          const complaint = solve.unrideableComplaint(step.value);
          if (complaint === null) {
            offerPrewarmedSlide(solve.finishSlidePlan(step.value));
            this.slideSolved = true;
          } else {
            this.lastComplaint = `${complaint} (at a ${target} m target)`;
            this.rung += 1;
            this.search = null;
          }
          return;
        }
        this.attemptsSeen = step.value;
        if (performance.now() >= deadline) return;
      }
    } catch (error) {
      if (error instanceof RailRouteUnsolvable) {
        // A target that admits no route at all is a rung that did not work,
        // not a park that cannot be built — the next rung gets its turn,
        // exactly as `solveChuteAt` treats the same throw.
        this.lastComplaint = `admitted no route at a ${target} m target`;
        this.rung += 1;
        this.search = null;
        return;
      }
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
