import type { GroundClaims } from './groundClaims';
import { loadPrebuiltPark } from './prebuiltPark';

/**
 * **Loading the park while a bus is on screen.**
 *
 * Jim, 7 August 2026: *"this is the time when the procgen should actually run,
 * amortised over many small tasks over many frames, so it acts as a kind of
 * loading screen for the park generation."* That was when the device solved
 * the park, seconds of search sliced across the cat-bus ride.
 *
 * Since 24 September 2026 it does not: *"there should be no ability to build
 * built into the game as delivered"* (Jim). Parks are solved at build time
 * (`pnpm run build:parks`, `procgen/`) and the game downloads each one's
 * decisions (`docs/design/PREBUILT-PARKS.md`). What is left here is loading:
 * the park file, the plan hydrated from it, and the modules that read it.
 *
 * ## Why this class has no DOM, no `Game` and no renderer in it
 *
 * So that a check can build a real one and drive it in Node
 * (`scripts/check-ground-claims.mts`).
 */

/**
 * How long a frame may spend loading the park, in milliseconds, while the bus
 * is rolling. Since prebuilt parks the whole of it — fetch, hydrate, import —
 * is a few milliseconds and a handful of frames, so this bounds nothing in
 * practice; it stays as the pacing `JourneyDirector` hands out, shared with the
 * shader warm-up's own budget. (It was the solver's frame budget, policed by
 * `check:park-boot` and `check:arrival-completes`; both retired with the
 * client-side solve on 24 September 2026.)
 */
export const GENERATION_BUDGET_MS = 8;

/**
 * The same, once the ride has overrun its nominal length and the drive is
 * looping while it waits for the park — see
 * `JourneyDirector.overrunAwareBudgetMs`. Kept a little above the rolling
 * budget so a moving bus never juddered for it.
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
 * Drives the park's loading. One per boot; `main.ts` owns it.
 *
 * Since prebuilt parks (`docs/design/PREBUILT-PARKS.md`) the game searches for
 * nothing: the park's decisions come from its park file, fetched first, and
 * the plan is **hydrated** from it a feature per step — a few milliseconds in
 * all. So what was a solver sliced across the ride is now three small steps:
 * fetch the file, hydrate the plan, load the modules that read it. A park with
 * no usable file fails with `ParkUnavailable` and the boot shows it.
 *
 * {@link advance} is synchronous and returns immediately — it either runs
 * hydration steps until the budget is spent or starts a module import and
 * comes back next frame.
 */
export class ParkGeneration {
  private importIndex = 0;
  private importInFlight = false;
  private failure: Error | null = null;
  private pathsDone = false;
  private planModule: typeof import('../world/parkPlan') | null = null;
  private plan: Generator<number, void, void> | null = null;
  private planDone = false;
  private workingFrames = 0;
  /**
   * The import ladder: the park file (the plan reads it once, when it starts),
   * the plan module, then the graph and world modules that read the decided
   * plan.
   */
  private readonly importLadder: readonly ImportStep[] = [
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
      gate: () => this.planDone,
      begin: () =>
        import('../world/pathGraph').then(() => {
          this.pathsDone = true;
        }),
    },
  ];

  /** The registry the plan committed into — the same object the `World` adopts. */
  get groundClaims(): GroundClaims {
    if (!this.planModule) throw new Error('park generation: the plan has not been imported yet');
    return this.planModule.parkPlanClaims();
  }

  get ready(): boolean {
    return this.pathsDone;
  }

  get failed(): Error | null {
    return this.failure;
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

  advance(budgetMs: number): void {
    if (this.pathsDone || this.failed || this.importInFlight) return;
    const step = this.importLadder[this.importIndex];
    if (step && (!step.gate || step.gate())) {
      this.importIndex += 1;
      this.workingFrames += 1;
      this.runImport(step);
      return;
    }
    if (!this.planModule || this.planDone) return;
    this.workingFrames += 1;
    const started = performance.now();
    try {
      this.plan ??= this.planModule.parkPlanSearch();
      while (performance.now() - started < budgetMs) {
        if (this.plan.next().done) {
          this.planDone = true;
          return;
        }
      }
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error(String(error));
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
