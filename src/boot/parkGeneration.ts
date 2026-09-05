import type { SolvedRailRoute } from '../world/rail/generate';
import { railRouteSearch, RailRouteUnsolvable } from '../world/rail/generate';
import type { CruiserSearchStart } from '../world/coaster/solve';
import { offerPrewarmedCruiser } from '../world/coaster/prewarm';
import { offerPrewarmedSlide } from '../world/slide/prewarm';
import { offerPrewarmedTrain } from '../world/train/prewarm';
import { SolveScheduler } from './solveScheduler';
import { GroundClaims } from './groundClaims';
import { offerPrewarmedGroundClaims } from './groundClaimsPrewarm';

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
 *   and throws only when the whole `DESIRED_LENGTH_LADDER` is spent.
 */
export class ParkGeneration {
  private readonly scheduler: SolveScheduler;

  /**
   * **The park's one claims registry** — made here because the scheduler owns
   * the round-robin, and the round-robin is what claims ground.
   *
   * Handed to `World` through `groundClaimsPrewarm.ts`'s letterbox rather than
   * imported from a module-level singleton, so there is exactly one per park
   * and it cannot outlive the seed it describes. `check:park-boot` asserts
   * `World`'s registry is identically this object.
   */
  private readonly claims = new GroundClaims();

  private importIndex = 0;
  private importInFlight = false;
  private failure: Error | null = null;
  private pathsDone = false;

  // ---- module letterboxes, filled by the import ladder ----
  private cruiserModule: typeof import('../world/coaster/solve') | null = null;
  private trainModule: typeof import('../world/train/route') | null = null;
  private solveModule: typeof import('../world/slide/solve') | null = null;
  private crossingModule: typeof import('../world/train/crossingPlanSolve') | null = null;
  private crossingPrewarmModule: typeof import('../world/train/crossingPrewarm') | null = null;
  private pathsModule: typeof import('../world/paths') | null = null;
  private pathsPrewarmModule: typeof import('../world/pathsPrewarm') | null = null;
  private roadModule: typeof import('../world/entrance/roadCorridor') | null = null;

  // ---- results passed between tasks (a dep is done before a dependent starts) ----
  private cruiserStart: CruiserSearchStart | null = null;
  private cruiserRoute: SolvedRailRoute | null = null;

  /**
   * How many of `coasterProfileSearch`'s **structural seams** were taken —
   * the yields that carry zero, as against the vertical repair's passes,
   * which carry `pass + 1`.
   *
   * Kept apart from {@link units} because the two answer different
   * questions. The seam count is a fixed property of the algorithm and a
   * drop in it means a seam was skipped; the repair count is data, and a
   * park whose profile already clears the terrain legitimately takes one
   * pass where the canonical seed takes ten. A single total cannot tell
   * those apart, and `check:park-boot` spent a red run saying the first
   * when the truth was the second.
   */
  private cruiserFinishSeams = 0;

  /** Frames on which this was asked to do work and did some. */
  private workingFrames = 0;
  private slicesSeen = 0;

  /**
   * The import ladder, in the order the old hand-ordered driver ran them.
   *
   * The first block is the ground the Sky Cruiser measures itself against —
   * each is one module whose top-level `const` solves something, and importing
   * them one per frame is what turns one block into several frames nobody
   * notices. They are named individually rather than pulled in transitively
   * because a single `import()` does a chunk of synchronous resolve-and-compile
   * work for every file in the graph it has not seen (measured at 70 ms for
   * `coaster/solve`'s whole graph in one call): naming the heavy sub-graphs
   * buys each its own frame.
   *
   * `train/plan` is **after** the cruiser's solve on purpose — it imports
   * `COASTER_PLANS`, and loading it earlier evaluated the cruiser's entire
   * ~1.3 s solve inside the train's import, billing it to the train's frame
   * (issue #252 was sent to the wrong file by exactly that misattribution).
   */
  private readonly importLadder: readonly ImportStep[] = [
    { name: 'boundary', begin: () => import('../world/boundary') },
    { name: 'parkLayout', begin: () => import('../world/parkLayout') },
    { name: 'rail/generate', begin: () => import('../world/rail/generate') },
    { name: 'terrain', begin: () => import('../world/terrain') },
    { name: 'building/layout', begin: () => import('../world/building/layout') },
    { name: 'building/cruiserWindow', begin: () => import('../world/building/cruiserWindow') },
    { name: 'coaster/route', begin: () => import('../world/coaster/route') },
    {
      name: 'coaster/solve',
      begin: () =>
        import('../world/coaster/solve').then((module) => {
          this.cruiserModule = module;
        }),
    },
    {
      name: 'train/route',
      gate: () => this.scheduler.isDone('cruiserFinish'),
      begin: () =>
        import('../world/train/route').then((module) => {
          this.trainModule = module;
        }),
    },
    {
      name: 'train/plan',
      gate: () => this.scheduler.isDone('trainSearch'),
      begin: () => import('../world/train/plan'),
    },
    { name: 'railRace/plan', begin: () => import('../world/railRace/plan') },
    {
      name: 'slide/solve',
      begin: () =>
        import('../world/slide/solve').then((module) => {
          this.solveModule = module;
        }),
    },
    {
      name: 'train/crossingPlan',
      gate: () => this.scheduler.isDone('slideSearch'),
      begin: () =>
        Promise.all([
          import('../world/train/crossingPlanSolve'),
          import('../world/train/crossingPrewarm'),
        ]).then(([solveModule, prewarmModule]) => {
          this.crossingModule = solveModule;
          this.crossingPrewarmModule = prewarmModule;
        }),
    },
    {
      name: 'paths',
      gate: () => this.scheduler.isDone('crossingSites'),
      begin: () =>
        Promise.all([import('../world/paths'), import('../world/pathsPrewarm')]).then(
          ([pathsModule, prewarmModule]) => {
            this.pathsModule = pathsModule;
            this.pathsPrewarmModule = prewarmModule;
          },
        ),
    },
    {
      // The road's own owner, loaded before its claim task can run. Cheap —
      // `roadCorridor.ts` reads the boundary and the (as yet unpublished)
      // paving map, neither of which solves anything.
      name: 'entrance/roadCorridor',
      begin: () =>
        import('../world/entrance/roadCorridor').then((module) => {
          this.roadModule = module;
        }),
    },
    {
      name: 'pathGraph',
      gate: () => this.scheduler.isDone('pathGraph') && this.scheduler.isDone('roadCorridor'),
      begin: () =>
        import('../world/pathGraph').then(() => {
          this.pathsDone = true;
        }),
    },
  ];

  constructor() {
    // `self` because the task generators must read the letterboxes lazily —
    // at slice time, when their `ready()` gates have guaranteed the module is
    // there — and an arrow generator does not exist in the language.
    const self = this;
    this.scheduler = new SolveScheduler([
      {
        // The cruiser's brief: a ring of candidate stations. ~19 ms of
        // `boundary.distanceToEdge`, too much for one frame on its own.
        name: 'brief',
        ready: () => self.cruiserModule !== null,
        *start() {
          const solve = self.cruiserModule as typeof import('../world/coaster/solve');
          const building = solve.cruiserStartSearch();
          for (;;) {
            const step = building.next();
            if (step.done) {
              self.cruiserStart = step.value;
              return;
            }
            yield step.value;
          }
        },
      },
      {
        // The route itself — the whole retry ladder (first brief, escalated
        // castle pull, rescue) as ONE generator, `cruiserRouteSearch`, so the
        // tier transitions are the policy's own to sequence, not this
        // driver's. The rescue tier's pose construction is one ~20 ms
        // un-yielding block, reachable only on a seed where the park
        // previously failed to build at all — a trade a loading screen takes.
        name: 'cruiserSearch',
        deps: ['brief'],
        *start() {
          const solve = self.cruiserModule as typeof import('../world/coaster/solve');
          const start = self.cruiserStart as CruiserSearchStart;
          const search = solve.cruiserRouteSearch(start.briefs);
          for (;;) {
            const step = search.next();
            if (step.done) {
              self.cruiserRoute = step.value;
              return;
            }
            yield step.value;
          }
        },
      },
      {
        // The hill profile, the carves and the vertical repair, one repair
        // pass at a time — run whole, this block failed CI at 54.6 ms against
        // a 24 ms ceiling.
        name: 'cruiserFinish',
        deps: ['cruiserSearch'],
        *start() {
          const solve = self.cruiserModule as typeof import('../world/coaster/solve');
          const start = self.cruiserStart as CruiserSearchStart;
          const finishing = solve.finishCruiserPlanSearch(
            self.cruiserRoute as SolvedRailRoute,
            start.rng,
          );
          for (;;) {
            const step = finishing.next();
            if (step.done) {
              offerPrewarmedCruiser(step.value);
              return;
            }
            // The structural seams are the yields that carry zero; the
            // vertical repair's passes carry `pass + 1`. Counted apart
            // because only the seams are a fixed property of the algorithm —
            // see `coasterProfileSearch` and `check:park-boot`'s seam
            // assertion.
            if (step.value === 0) self.cruiserFinishSeams += 1;
            yield step.value;
          }
        },
      },
      {
        // The train's loop. Its brief reads the cruiser's published low
        // corridor (`COASTER_PLANS`, built cheap by the `train/route` import
        // from the pre-warmed cruiser), and its result must reach
        // `train/prewarm.ts` before `train/plan` is imported.
        name: 'trainSearch',
        deps: ['cruiserFinish'],
        ready: () => self.trainModule !== null,
        *start() {
          const module = self.trainModule as typeof import('../world/train/route');
          const route = yield* module.trainRouteSearch();
          offerPrewarmedTrain(route);
        },
      },
      {
        // The ginormous slide: the `DESIRED_LENGTH_LADDER` walked rung by
        // rung, exactly as `planSlide()` walks it, so the sliced path and the
        // straight-through path are one search (`check:park-boot` hashes the
        // two against each other).
        name: 'slideSearch',
        deps: ['trainSearch'],
        ready: () => self.solveModule !== null,
        *start() {
          const solve = self.solveModule as typeof import('../world/slide/solve');
          const ladder = solve.DESIRED_LENGTH_LADDER;
          let lastComplaint = 'never solved a route at all';
          for (let rung = 0; ; rung += 1) {
            const target = ladder[rung];
            if (target === undefined) {
              // Every rung tried, none rideable — the same terminal answer
              // `planSlide()` gives, with the same shape of message.
              throw new Error(
                `the ginormous slide never solved to a chute a child could ride: ` +
                  `after ${ladder.length} target lengths (${ladder.join(', ')} m), ` +
                  `the best on offer ${lastComplaint}.`,
              );
            }
            // The brief gets its own frame: it is pure, but `doorPoses()` and
            // `pitPoses()` both filter through `PARK_BOUNDARY`, and it
            // measured 13.7 ms sharing a frame with the search.
            const search = railRouteSearch(solve.slideRouteBriefAt(target));
            yield 'frame';
            let route: SolvedRailRoute;
            try {
              for (;;) {
                const step = search.next();
                if (step.done) {
                  route = step.value;
                  break;
                }
                yield step.value;
              }
            } catch (error) {
              if (error instanceof RailRouteUnsolvable) {
                // A target that admits no route at all is a rung that did not
                // work, not a park that cannot be built — the next rung gets
                // its turn, exactly as `solveChuteAt` treats the same throw.
                lastComplaint = `admitted no route at a ${target} m target`;
                yield 'frame';
                continue;
              }
              throw error;
            }
            // **A finished route is judged and built on its own frame.**
            // `unrideableComplaint` rebuilds the whole chute and measures it
            // in three dimensions, and `finishSlidePlan` builds it again for
            // keeps; doing either on the frame whose search produced the
            // route made that frame the worst in the entire park build.
            yield 'frame';
            const complaint = solve.unrideableComplaint(route);
            if (complaint === null) {
              offerPrewarmedSlide(solve.finishSlidePlan(route));
              return;
            }
            lastComplaint = `${complaint} (at a ${target} m target)`;
            // The next rung's brief must not share the frame that just
            // rebuilt and measured a whole chute — same rule as above.
            yield 'frame';
          }
        },
      },
      {
        // The railway crossing plan — the feasibility march deciding where a
        // bridge provably fits — solved a candidate at a time and offered to
        // `crossingPrewarm` before `paths.ts` (whose import would otherwise
        // run the whole ~300 ms march inside one frame).
        name: 'crossingSites',
        deps: ['slideSearch'],
        ready: () => self.crossingModule !== null && self.crossingPrewarmModule !== null,
        *start() {
          const solveModule = self
            .crossingModule as typeof import('../world/train/crossingPlanSolve');
          const prewarmModule = self
            .crossingPrewarmModule as typeof import('../world/train/crossingPrewarm');
          const sites = yield* solveModule.crossingSitesSearch();
          prewarmModule.offerPrewarmedCrossingSites(sites);
        },
      },
      {
        // The walk graph itself — every spur, street and interconnect, solved
        // a destination at a time and offered to `pathsPrewarm` so
        // `pathGraph.ts`'s import takes a pre-warmed graph instead of
        // blocking a frame on the whole street-lattice solve (~215 ms).
        name: 'pathGraph',
        deps: ['crossingSites'],
        ready: () => self.pathsModule !== null && self.pathsPrewarmModule !== null,
        *start() {
          const pathsModule = self.pathsModule as typeof import('../world/paths');
          const prewarmModule = self
            .pathsPrewarmModule as typeof import('../world/pathsPrewarm');
          const graph = yield* pathsModule.pathGraphSearch();
          prewarmModule.offerPrewarmedPathGraph(graph);
        },
      },
      {
        // **The entrance road claims its corridor.** The first production
        // placer: everything above solves a route and hands it to a letterbox,
        // and this one publishes the ground it occupies to the registry every
        // later placer will have to ask.
        //
        // There is no search to slice here — the road does not move — so the
        // task is one commit. It sits last because that is where the road sits
        // in today's order (`Entrance` is built near the end of `World`'s
        // constructor), and this step is required to leave the park
        // byte-identical: it does not confront the import ladder, which is
        // step 3's job.
        //
        // **What this claim can and cannot know, stated plainly.** The
        // road's spur stops where the plaza's paving starts, and paving is
        // published by `buildPaths()` inside `new World(...)` — after every
        // rung here has run. So at this point `entranceRoadClaims()` honestly
        // reports the road's full ground, in to `ENTRANCE_STOP_Z`, which is
        // the conservative claim to make while the park is still being
        // decided. `World` re-commits the same feature from the same owner
        // once the paths exist; see the call there.
        name: 'roadCorridor',
        deps: ['pathGraph'],
        ready: () => self.roadModule !== null,
        *start() {
          const module = self.roadModule as typeof import('../world/entrance/roadCorridor');
          self.claims.commit(module.ROAD_FEATURE, { claims: module.entranceRoadClaims() });
          // Nothing else runs in the generator after this, so the registry is
          // complete as far as generation is concerned: hand it on.
          offerPrewarmedGroundClaims(self.claims);
        },
      },
    ]);
  }

  /**
   * **The registry this generation claimed against**, read-only to callers.
   *
   * Exposed so a check can assert the `World` that follows took *this* object
   * out of the letterbox rather than making a second one — see
   * `scripts/check-ground-claims.mts`. Nothing in the game reads it here; the
   * game reads `World.groundClaims`.
   */
  get groundClaims(): GroundClaims {
    return this.claims;
  }

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
    return this.failure ?? this.scheduler.failed;
  }

  get stage(): GenerationStage {
    if (this.pathsDone) return 'ready';
    if (this.scheduler.isDone('slideSearch')) return 'joining up the paths';
    // The train and the rail race sit between the two big solves. They had no
    // stage of their own once, so every frame of theirs was reported as the
    // slide's — which made a 28.8 ms train-import hitch look like a slide
    // problem while it was being profiled. A stage that lies about which work
    // is running is a measurement bug, not a cosmetic one.
    if (this.scheduler.isDone('cruiserFinish')) {
      if (!this.scheduler.isDone('trainSearch')) return 'laying the railway';
      return this.importsCompletedThrough('railRace/plan')
        ? 'shaping the ginormous slide'
        : 'laying the railway';
    }
    if (this.importsCompletedThrough('coaster/route')) return 'flying the sky cruiser';
    if (this.importIndex > 0 || this.importInFlight) return 'measuring out the park';
    return 'waiting';
  }

  /** How many frames have done real generation work. */
  get framesWorked(): number {
    return this.workingFrames;
  }

  /** How many of the slide search's attempts have been started. */
  get attempts(): number {
    return this.scheduler.progressOf('slideSearch');
  }

  /** How many of the Sky Cruiser search's attempts have been started. */
  get cruiserAttempts(): number {
    return this.scheduler.progressOf('cruiserSearch');
  }

  /**
   * Steps begun after a slice's deadline had passed. Zero, on correct code —
   * the device-independent "the search can be stopped where it was asked to
   * stop" (a step count, not a millisecond count, because how long a step
   * takes is a fact about the machine; how many run after the driver was told
   * to stop is a fact about this code). The first step of a slice is
   * deliberately exempt: a GC between computing the deadline and entering the
   * loop spends the budget before any step has run, and counting that made
   * the check flaky-by-design on a slowed machine.
   */
  get stepsPastDeadline(): number {
    return this.scheduler.slicesPastDeadline;
  }

  /** Which loops began a step late — the diagnosis, not just the count. */
  get lateStepsByPhase(): Readonly<Record<string, number>> {
    return this.scheduler.lateSlicesByTask;
  }

  /**
   * How many pieces each sliced phase was divided into.
   *
   * Device-independent: the park is deterministic, so for a given seed these
   * are the same numbers everywhere — a phone that is ten times slower does
   * fewer units per frame, not fewer units. (The slide's count includes its
   * ladder's own frame boundaries — the brief and judgement frames — which
   * are equally deterministic.)
   */
  get unitCounts(): Readonly<
    Record<'brief' | 'cruiserSearch' | 'cruiserFinish' | 'trainSearch' | 'slideSearch', number>
  > {
    const counts = this.scheduler.sliceCounts;
    return {
      brief: counts['brief'] ?? 0,
      cruiserSearch: counts['cruiserSearch'] ?? 0,
      cruiserFinish: counts['cruiserFinish'] ?? 0,
      trainSearch: counts['trainSearch'] ?? 0,
      slideSearch: counts['slideSearch'] ?? 0,
    };
  }

  /** How many of the cruiser finish's structural seams were taken. */
  get cruiserFinishSeamCount(): number {
    return this.cruiserFinishSeams;
  }

  /**
   * Generate for up to `budgetMs`, then get out of the way.
   *
   * Safe to call every frame, including after it is ready or has failed. Never
   * re-enters an import that is still in flight. Each frame is either **one
   * module import** (the ladder's next rung, if its gate is open) or **a
   * budget's worth of scheduler slices** — the same one-or-the-other the old
   * hand-ordered driver kept, which is what keeps every import on its own
   * frame.
   */
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

  /**
   * Marks an import in flight so no frame starts a second one on top of it,
   * and **starts it off the frame rather than inside it.**
   *
   * ### Why the `queueMicrotask`, which is not a dodge
   *
   * In a browser, `import()` hands back a promise essentially immediately and
   * the module's own work happens when that promise settles — which is
   * *already* off `advance()`'s books, and is measured instead by
   * `check:park-boot`'s event-loop lag. That is the behaviour this class is
   * written for and the one a phone actually runs.
   *
   * In Node under the TypeScript loader the check uses, `import()`
   * additionally does the whole resolve-and-compile of every file in the
   * graph **synchronously, before returning the promise** (measured: 41.4 ms
   * for a module's first import, 0.2 ms once the graph is in the module
   * cache). So it is per-file loader work that exists only in the harness,
   * and calling `import()` inside `advance()` charged the frame budget for a
   * cost the game does not have. Scheduling the call one microtask out puts
   * that cost where the equivalent browser cost already lands: on the event
   * loop, under the block ceiling that owns work which does not pass through
   * `advance()`.
   *
   * `importInFlight` is still set **synchronously**, so the very next
   * `advance()` cannot start a second import on top of this one.
   */
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

  /** Has the ladder finished every rung up to and including `name`? */
  private importsCompletedThrough(name: string): boolean {
    const index = this.importLadder.findIndex((step) => step.name === name);
    return this.importIndex > index && !this.importInFlight;
  }
}
