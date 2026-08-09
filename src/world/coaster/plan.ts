import type { PlannedCoaster } from './solve';
import { planCruiser } from './solve';
import { takePrewarmedCruiser } from './prewarm';

/**
 * **The Sky Cruiser's solved plan, and nothing else.**
 *
 * Everything that *works out* the cruiser — the station poses, the brief, the
 * exit hunt, the height profile — lives in `coaster/solve.ts`, which this
 * re-exports in full. Importing this module is unchanged for all fifteen of its
 * callers in `src/` and its seven in `scripts/`: they still write
 * `import { COASTER_PLANS } from '.../coaster/plan'` and still get a finished
 * plan.
 *
 * ## Why the file split at all
 *
 * The identical reason `slide/plan.ts` split from `slide/solve.ts`, and this is
 * deliberately that same shape rather than a second design. The cruiser's solve
 * costs **~1.3 s** on the canonical seed, and the cat-bus ride is meant to cover
 * it, which means solving it a few milliseconds at a time *while the bus is on
 * screen*.
 *
 * To do that, something has to build the brief and drive the search **without
 * importing the module that owns `COASTER_PLANS`** — because importing that
 * module is exactly what runs the solve. So the code and the const cannot live
 * in the same file. They also cannot live in two files that import each other:
 * that would be a cycle whose const initialiser runs while the other module is
 * still in its temporal dead zone — a `ReferenceError` at import, on the boot
 * path, in production only. Hence **`solve.ts` is how, `plan.ts` is what**, and
 * the arrow only ever points this way.
 *
 * ## Why the cruiser and not the train
 *
 * Issue #252 named `train/plan.ts` as the 1.4 s module, and that attribution was
 * a billing accident: `train/plan.ts` imports `COASTER_PLANS`, so whichever of
 * the two is imported first is charged for both. `ParkGeneration` listed the
 * train first, and the train duly measured 1439.6 ms against the cruiser's
 * 0.3 ms. Importing each dependency first splits it honestly — cruiser ~1264 ms,
 * the train's own ~157 ms — and slicing the train was measured not to fix it
 * (worst block 1354 ms to 1300 ms, against a 250 ms ceiling). See
 * `coaster/prewarm.ts`.
 */
export * from './solve';

/**
 * The plans. Import this; never re-solve — the same rule as `TRAIN_PLAN`.
 *
 * There is only one loop now. The Rail Race used to be a second solved loop
 * here, steering clear of the cruiser; the reform of 31 July 2026 moved it out
 * to the park's perimeter, where it needs no solver at all — it is a circle. Its
 * plan lives in `railRace/plan.ts` and satisfies the same shape `paths.ts`
 * wants, which is why the walk network still gives its exit a node alongside
 * this one.
 *
 * **Two cadences, one search.** If the cat-bus loading screen has already solved
 * the cruiser (`boot/parkGeneration.ts`, driven a slice per frame by the ride),
 * it left the finished plan in `prewarm.ts` and this takes it. If nothing did —
 * `park-harness.mts`, `check:park`, `test:procgen`, the fingerprint scripts, and
 * the game itself whenever the arrival is skipped — this solves it straight
 * through, synchronously, exactly as it always did.
 *
 * That fallback is the load-bearing half. It is what keeps every check in CI
 * byte-identical: none of them pre-warm, so none of them take the new path, and
 * `COASTER_PLANS` is still a module-scope `const` that is finished by the time
 * anybody can read it. The pre-warmed path is proved to agree with it by
 * `check:park-boot`, which runs both in one process and compares a SHA over the
 * built loop.
 */
export const COASTER_PLANS: {
  readonly cruiser: PlannedCoaster;
} = { cruiser: takePrewarmedCruiser() ?? planCruiser() };
