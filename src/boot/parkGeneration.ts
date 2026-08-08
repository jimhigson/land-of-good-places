import type { SolvedRailRoute } from '../world/rail/generate';
import { railRouteSearch, RailRouteUnsolvable } from '../world/rail/generate';
import type { CruiserSearchStart, PlannedCoaster } from '../world/coaster/solve';
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
  // The rail generator and the cruiser's own route module, imported on their
  // own frames rather than being dragged in wholesale by `coaster/solve`.
  //
  // **This is a slice, not tidiness.** A dynamic `import()` does a chunk of
  // synchronous work in the calling frame before it ever returns a promise —
  // resolving and compiling every file in the graph it has not seen. Pulling
  // `coaster/solve`'s whole graph in one call measured **70 ms** on a machine
  // running at CI's speed, which is a dropped-frame hitch that no budget can
  // interrupt because it happens inside a single expression. Naming the two
  // heaviest sub-graphs here buys each of them its own frame, and leaves the
  // `coaster/solve` import with almost nothing left to resolve.
  () => import('../world/rail/generate'),
  // `coaster/route` drags these three in, and together they measured 21.8 ms of
  // synchronous resolution in one frame. Named individually, the largest is
  // ~6 ms and `coaster/route` itself is what is left over.
  () => import('../world/terrain'),
  () => import('../world/building/layout'),
  () => import('../world/building/cruiserWindow'),
  () => import('../world/coaster/route'),
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
  | 'laying the railway'
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
  /** The solved plan view, held between the search finishing and the finisher. */
  private cruiserRoute: SolvedRailRoute | null = null;
  private cruiserFinish: Generator<number, PlannedCoaster, void> | null = null;
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
  /** A solved chute waiting to be judged and built, on a frame of its own. */
  private slidePending: { readonly route: SolvedRailRoute; readonly target: number } | null = null;
  private slideSolved = false;
  private pathsDone = false;
  private failure: Error | null = null;

  /**
   * Generator steps begun **after** this slice's deadline had already passed.
   *
   * The device-independent form of "the search can be stopped where it was
   * asked to stop". Every drive loop here checks the clock after each step and
   * returns, so a step can never *begin* past the deadline — this counter is
   * therefore 0 on a correct implementation, on a phone and on a fast laptop
   * alike, and goes positive the moment a loop is written without that check.
   *
   * It is not a millisecond count on purpose. How long a step takes is a fact
   * about the machine; how many steps run after the driver was told to stop is
   * a fact about this code.
   */
  private overrunSteps = 0;

  /** Which phase began a step late, so the report names the loop at fault. */
  private overrunByPhase: Record<string, number> = {};

  /**
   * How many pieces each sliced phase was divided into.
   *
   * Also device-independent, and the other half of the guarantee: `overrunSteps`
   * proves the driver stops when asked, and these prove there are frequent
   * opportunities to. The park is deterministic, so for a given seed these are
   * the same numbers everywhere — a phone that is ten times slower does fewer
   * units per frame, not fewer units.
   */
  private units = { brief: 0, cruiserSearch: 0, cruiserFinish: 0, slideSearch: 0 };

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
    // The train and the rail race sit between the two sliced solves. They had
    // no stage of their own, so every frame of theirs was reported as the
    // slide's — which made a 28.8 ms train-import hitch look like a slide
    // problem while it was being profiled. A stage that lies about which work
    // is running is a measurement bug, not a cosmetic one.
    if (this.cruiserSolved) {
      return this.afterIndex >= MODULES_AFTER_CRUISER.length
        ? 'shaping the ginormous slide'
        : 'laying the railway';
    }
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

  /** Steps begun after a slice's deadline had passed. Zero, on correct code. */
  get stepsPastDeadline(): number {
    return this.overrunSteps;
  }

  /** Which loops began a step late — the diagnosis, not just the count. */
  get lateStepsByPhase(): Readonly<Record<string, number>> {
    return this.overrunByPhase;
  }

  /** How many pieces each sliced phase was divided into. Device-independent. */
  get unitCounts(): Readonly<Record<'brief' | 'cruiserSearch' | 'cruiserFinish' | 'slideSearch', number>> {
    return this.units;
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
      this.runImport(before);
      return;
    }

    // The cruiser's own how-module. Nothing in it solves at module scope —
    // that is the whole point of the `solve.ts`/`plan.ts` split.
    if (!this.cruiserModule) {
      this.workingFrames += 1;
      this.runImport(() =>
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
      this.runImport(after);
      return;
    }

    // The slide's own module, which brings the castle and the coaster it
    // measures itself against with it.
    if (!this.solveModule) {
      this.workingFrames += 1;
      this.runImport(() =>
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
    this.runImport(() =>
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
        if (performance.now() >= deadline) this.noteLateStep('brief');
        const step = building.next();
        this.units.brief += 1;
        if (step.done) {
          this.cruiserStart = step.value;
          this.cruiserStartSearch = null;
          break;
        }
        if (performance.now() >= deadline) return;
      }
      // **A finished phase does not entitle this slice to start the next one.**
      // Falling straight through into the search below meant the frame that
      // completed the brief also began solving the route, which is a step begun
      // after the deadline — invisible on a fast machine and eight dropped
      // frames on a slow one. Found by `stepsPastDeadline`, not by a stopwatch.
      if (performance.now() >= deadline) return;
    }
    const start = this.cruiserStart;

    try {
      // Phase two: the route itself.
      //
      // Guarded on `cruiserRoute` rather than falling through, because a
      // generator that has already returned answers `next()` with
      // `{ done: true, value: undefined }` — so re-entering this on the frame
      // after the search finished would overwrite the solved route with
      // `undefined` and then read `.report` off it. Phases that have completed
      // must be skipped, not merely finished.
      if (!this.cruiserRoute) {
        const search = (this.cruiserSearch ??= railRouteSearch(
          this.cruiserEscalated ? start.briefs.escalated : start.briefs.first,
        ));
        for (;;) {
          if (performance.now() >= deadline) this.noteLateStep('cruiserSearch');
          const step = search.next();
          this.units.cruiserSearch += 1;
          if (step.done) {
            // **The same verdict, in the same order, as the constructor's**:
            // a loop that never crossed the castle earns one re-solve at twice
            // the influence, and whatever the second search returns is taken.
            if (!this.cruiserEscalated && !step.value.report.satisfied) {
              this.cruiserEscalated = true;
              this.cruiserSearch = null;
              return;
            }
            this.cruiserRoute = step.value;
            break;
          }
          this.cruiserAttemptsSeen = step.value;
          if (performance.now() >= deadline) return;
        }
        if (performance.now() >= deadline) return;
      }

      // Phase three: finish it — the hill profile, the carves and the vertical
      // repair, one repair pass at a time. This block, run whole, is what CI
      // failed on at 54.6 ms against a 24 ms ceiling.
      const finishing = (this.cruiserFinish ??= solve.finishCruiserPlanSearch(
        this.cruiserRoute,
        start.rng,
      ));
      for (;;) {
        if (performance.now() >= deadline) this.noteLateStep('cruiserFinish');
        const step = finishing.next();
        this.units.cruiserFinish += 1;
        if (step.done) {
          offerPrewarmedCruiser(step.value);
          this.cruiserSolved = true;
          return;
        }
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
    const deadline = performance.now() + budgetMs;

    // **A finished route is judged and built on its own frame.**
    //
    // `unrideableComplaint` rebuilds the whole chute and measures it in three
    // dimensions, and `finishSlidePlan` builds it again for keeps. Doing both on
    // the same frame as the search step that produced the route made that frame
    // the worst in the entire park build — a budget's worth of searching plus
    // two chute builds, none of it interruptible. Deferring by one frame does
    // not make the work smaller, but it stops it being *added* to a slice that
    // had already spent its budget.
    const pending = this.slidePending;
    if (pending) {
      this.slidePending = null;
      const complaint = solve.unrideableComplaint(pending.route);
      if (complaint === null) {
        offerPrewarmedSlide(solve.finishSlidePlan(pending.route));
        this.slideSolved = true;
      } else {
        this.lastComplaint = `${complaint} (at a ${pending.target} m target)`;
        this.rung += 1;
        this.search = null;
      }
      return;
    }

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

    // The brief gets its own frame too: it is pure, but `doorPoses()` and
    // `pitPoses()` both filter their candidates through `PARK_BOUNDARY`, which
    // is not free, and it measured 13.7 ms sharing a frame with the search.
    if (!this.search) {
      this.search = railRouteSearch(solve.slideRouteBriefAt(target));
      return;
    }
    const search = this.search;

    try {
      for (;;) {
        if (performance.now() >= deadline) this.noteLateStep('slideSearch');
        const step = search.next();
        this.units.slideSearch += 1;
        if (step.done) {
          // **The same verdict, in the same order, as `planSlide()`** — just
          // taken on the next frame rather than this one. See above.
          this.slidePending = { route: step.value, target };
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

  /**
   * Marks an import in flight so no frame starts a second one on top of it, and
   * **starts it off the frame rather than inside it.**
   *
   * ### Why the `queueMicrotask`, which is not a dodge
   *
   * In a browser, `import()` hands back a promise essentially immediately and
   * the module's own work happens when that promise settles — which is *already*
   * off `advance()`'s books, and is measured instead by `check:park-boot`'s
   * event-loop lag. That is the behaviour this class is written for and the one
   * a phone actually runs.
   *
   * In Node under the TypeScript loader the check uses, `import()` additionally
   * does the whole resolve-and-compile of every file in the graph
   * **synchronously, before returning the promise**. Measured: 41.4 ms for a
   * module's first import and 0.2 ms for the same import once the graph is in
   * the module cache; a dependency-free module costs 0.1 ms. So it is per-file
   * loader work, not the module's own work, and it exists only in the harness.
   *
   * Calling `import()` inside `advance()` therefore charged the frame budget for
   * a cost the game does not have, and it was the largest thing left in there —
   * four of the six worst slices on a deliberately slowed machine were imports
   * rather than generation. Scheduling the call one microtask out puts that cost
   * where the equivalent browser cost already lands: on the event loop, under the
   * block ceiling that owns work which does not pass through `advance()`.
   *
   * `importInFlight` is still set **synchronously**, so the very next
   * `advance()` cannot start a second import on top of this one.
   */
  /**
   * Records a step that began after its slice's deadline, and which loop did it.
   *
   * The count alone says a driver overran; the phase says which one, which is
   * the difference between a diagnosis and a hunt. Both are device-independent.
   */
  private noteLateStep(phase: string): void {
    this.overrunSteps += 1;
    this.overrunByPhase[phase] = (this.overrunByPhase[phase] ?? 0) + 1;
  }

  private runImport(begin: () => Promise<unknown>): void {
    this.importInFlight = true;
    queueMicrotask(() => {
      begin()
        .catch((error: unknown) => {
          this.failure = error instanceof Error ? error : new Error(String(error));
        })
        .finally(() => {
          this.importInFlight = false;
        });
    });
  }
}
