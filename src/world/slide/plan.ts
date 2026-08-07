import type { PlannedSlide } from './solve';
import { planSlide } from './solve';
import { takePrewarmedSlide } from './prewarm';

/**
 * **The ginormous slide's solved plan, and nothing else.**
 *
 * Everything that *works out* the slide — the vocabulary, the door and pit
 * poses, the chute, the rideability guard — lives in `slide/solve.ts`, which
 * this re-exports in full. Importing this module is unchanged for its six
 * callers in `src/` and its three in `scripts/`: they still write
 * `import { SLIDE_PLAN } from '.../slide/plan'` and still get a finished plan.
 *
 * ## Why the file split at all
 *
 * `planSlide()` costs **~3.5 s** — 86% of the park's whole 4 s boot, and the
 * reason a child used to watch a blank screen. The cat-bus ride is meant to
 * cover it, which means solving the slide a few milliseconds at a time *while
 * the bus is on screen*.
 *
 * To do that, something has to build the brief and drive the search **without
 * importing the module that owns `SLIDE_PLAN`** — because importing that module
 * is exactly what runs the solve. So the code and the const cannot live in the
 * same file.
 *
 * They also cannot live in two files that import each other. A `plan.ts` that
 * held the code and re-exported a const from elsewhere would be a cycle
 * (`plan.ts` -> const owner -> `plan.ts`), and the const's initialiser would run
 * while `plan.ts` was still in the temporal dead zone for `SLIDE_VOCABULARY`
 * and every other `const` above it — a `ReferenceError` at import, on the boot
 * path, in production only. Hence: **`solve.ts` is how, `plan.ts` is what**, and
 * the arrow only ever points this way.
 *
 * The name stayed with the const rather than the code so that not one of the
 * nine call sites had to change, which is also what keeps this refactor
 * reviewable: the diff is a rename plus this file.
 */
export * from './solve';

/**
 * The plan. Import this; never re-solve — the same rule as `TRAIN_PLAN`.
 *
 * **Two cadences, one search.** If the cat-bus loading screen has already
 * solved the slide (`boot/parkBoot.ts`, driven a slice per frame by the ride),
 * it left the finished plan in `prewarm.ts` and this takes it. If nothing did —
 * `park-harness.mts`, `check:park`, `test:procgen`, the fingerprint scripts,
 * and the game itself whenever the arrival is skipped — this solves it straight
 * through, synchronously, exactly as it always did.
 *
 * That fallback is the load-bearing half. It is what keeps every check in CI
 * byte-identical: none of them pre-warm, so none of them take the new path, and
 * `SLIDE_PLAN` is still a module-scope `const` that is finished by the time
 * anybody can read it. The pre-warmed path is proved to agree with it by
 * `check:park-boot`, which runs both in one process and compares a SHA over the
 * built chute.
 */
export const SLIDE_PLAN: PlannedSlide = takePrewarmedSlide() ?? planSlide();
