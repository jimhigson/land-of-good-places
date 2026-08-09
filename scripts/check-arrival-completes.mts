/**
 * **Does the cat-bus arrival actually finish on a slow device — or does the bus
 * idle at the gate for so long it reads as "stopped forever"?**
 *
 * This is the guard whose absence let an unstartable game deploy. Jim, on the
 * deployed game (9 August 2026): *"The cat bus still doesn't work. It gets to the
 * same point and just stops forever. We need a test that the game actually
 * starts."*
 *
 * ## What actually broke, and why the existing checks did not see it
 *
 * Hand-over waits for `JourneyDirector.readyToHandOver` — the ride is over AND
 * the park is generated AND its shaders are warmed. Generation is budgeted in
 * **wall-clock milliseconds per frame** (`GENERATION_BUDGET_MS`, 8 ms), so a slow
 * device completes fewer generator steps per frame and needs proportionally more
 * *frames*. The ride, meanwhile, is a fixed ~240 frames (twenty seconds of `dt`
 * clamped to 1/12 s). Below roughly twelve frames a second, generation outlasts
 * the ride and the bus idles at the gate for the difference — minutes on a
 * low-end tablet.
 *
 * `check:park-boot` and `check:bus-journey` both already "pass". They cannot see
 * this, and the way they cannot is the point:
 *
 * - `check:park-boot` drives generation to completion on the CI box with real
 *   millisecond budgets and asserts it *finishes* — it does, on a fast box, in
 *   ~440 frames. It never models a device slow enough that generation outlasts
 *   the ride.
 * - Both then check the hand-over gate by constructing a `JourneyDirector` and
 *   **hand-feeding it `noteParkReady()` / `noteWarmupReady()`**, then asserting
 *   `readyToHandOver`. That proves the booleans are wired; it never runs a real
 *   generation against the ride's own frame budget, so the frames-outlast-the-
 *   ride failure is invisible to it.
 *
 * ## What this checks instead — and why it is device-independent
 *
 * It drives the **real** `ParkGeneration` and the **real** `JourneyDirector`
 * through the **real** budget policy (`overrunAwareBudgetMs`), one frame at a
 * time, and measures how many frames the generation takes *after the ride has
 * ended* — the frames during which the bus is parked at the gate with nothing to
 * show but a loading caption.
 *
 * The device is modelled as a fixed number of generator **steps per frame**,
 * `advance(0)` being exactly one step (the drive loops read the clock after every
 * step, so a zero budget stops after one). The park is deterministic, so the
 * number of steps is the same on every machine; what a real device varies is only
 * how many steps fit in a frame. Expressing the model in steps rather than
 * milliseconds is what makes the frame counts below identical on a phone and on
 * CI — the same reason `check:park-boot` states its guarantees in work units.
 *
 * The load-bearing fact the fix turns on: during the ride the budget is
 * `GENERATION_BUDGET_MS` (protect the orbit); once the bus has parked it is
 * `OVERRUN_GENERATION_BUDGET_MS`, ~25x larger (nothing to protect, drain
 * flat-out). So the overrun takes ~25x fewer frames with the fix than without.
 * Revert the fix — make the parked budget equal the rolling one — and the overrun
 * frame count explodes past the ceiling. That is exactly the mutation that models
 * today's broken `main`, and it is proven below.
 *
 * **This does not claim the wait is *short*** — on a genuinely slow device the
 * residual wait is the device's raw generation cost and no scheduling beats it;
 * that number is measured in wall-clock in the PR, and the honest answer is that
 * the real cure is cheaper generation. This claims only that the arrival
 * *completes* in a bounded, dramatically-reduced number of parked frames rather
 * than the effectively-unbounded idle `main` ships.
 */
import { performance } from 'node:perf_hooks';
import {
  GENERATION_BUDGET_MS,
  OVERRUN_GENERATION_BUDGET_MS,
  ParkGeneration,
} from '../src/boot/parkGeneration.ts';
import { JourneyDirector } from '../src/world/entrance/journeyDirector.ts';

const fouls: string[] = [];
const said: string[] = [];

/** A frame: let the loop turn so a pending dynamic import can settle. */
const nextFrame = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * One generator step per `advance(0)`. The park's whole search is generator
 * locals, so stepping it one joint at a time cannot change the route (proved by
 * `check:park-boot`'s byte-identity hashes); here it is simply the finest,
 * device-independent grain in which to meter progress.
 */
const STEPS_PER_MS = 1;

/**
 * The clamped frame delta of a slow device. `MAX_FRAME_DELTA` is 1/12, so a
 * device below twelve frames a second — the ones this bug bites — advances the
 * ride clock by exactly this each frame, and the ride is over after
 * `JOURNEY_SECONDS / this` = 240 frames however slow the machine is.
 */
const SLOW_DEVICE_DT = 1 / 12;

/** A safety cap: generation must finish inside this many frames or something is
 *  structurally wrong (an infinite idle is exactly the bug). */
const MAX_FRAMES = 2_000_000;

const generation = new ParkGeneration();
const director = new JourneyDirector();

const stepsDone = (): number => {
  const u = generation.unitCounts;
  return u.brief + u.cruiserSearch + u.cruiserFinish + u.slideSearch;
};

let frames = 0;
let rideEndFrame = -1;
let genReadyFrame = -1;
let stepsDuringRide = 0;
let stepsDuringOverrun = 0;
const startedAt = performance.now();

while (!generation.ready && !generation.failed && frames < MAX_FRAMES) {
  director.advance(SLOW_DEVICE_DT);
  if (rideEndFrame < 0 && director.rideOver) rideEndFrame = frames;

  if (director.shouldAdvanceGeneration()) {
    // The real budget policy, in the real place: 8 ms while the bus is rolling,
    // 200 ms once it has parked. Converted to this device's steps-per-frame.
    const budgetMs = director.overrunAwareBudgetMs(
      GENERATION_BUDGET_MS,
      OVERRUN_GENERATION_BUDGET_MS,
    );
    const stepBudget = Math.max(1, Math.round(budgetMs * STEPS_PER_MS));
    for (let i = 0; i < stepBudget; i += 1) {
      const before = stepsDone();
      generation.advance(0);
      const did = stepsDone() - before;
      if (did > 0) {
        if (director.rideOver) stepsDuringOverrun += did;
        else stepsDuringRide += did;
      } else {
        // No step: an import is settling, or a phase is being set up. Both cost a
        // real frame and are resolved by yielding — so stop spending this frame's
        // budget and let the loop turn, exactly as the ride's own frame does.
        break;
      }
      if (generation.ready || generation.failed) break;
    }
  }

  // The generation gate the director exposes to `main.ts`. `noteGenerationReady`
  // is what unblocks `shouldBuildPark`, so this is the real hand-over path, not a
  // hand-fed flag.
  if (generation.ready && !director.generationReady) director.noteGenerationReady();

  frames += 1;
  await nextFrame();
  // **Read readiness after the yield, not before it.** The last generation step
  // is a dynamic `import('world/paths')`, and `pathsDone` — what `ready` returns —
  // is set inside that import's microtask, which runs during the `await` above.
  // Checking before the yield therefore always misses it by a frame, and the
  // whole point of this file is not to miss a frame.
  if (genReadyFrame < 0 && generation.ready) genReadyFrame = frames;
}

const wallMs = performance.now() - startedAt;

if (generation.failed) {
  fouls.push(`the park's generation threw while being driven a step at a time: ${generation.failed.message}`);
}
if (!generation.ready) {
  fouls.push(
    `generation never finished in ${frames} frames — the bus would idle at the gate forever, ` +
      'which is exactly the "stops forever" Jim reported',
  );
}

const overrunFrames = genReadyFrame >= 0 && rideEndFrame >= 0 ? genReadyFrame - rideEndFrame : -1;
const totalSteps = stepsDone();

said.push(
  `generation took ${frames} frames (${(wallMs / 1000).toFixed(2)} s here); the ride ends at frame ` +
    `${rideEndFrame}, generation at frame ${genReadyFrame}`,
);
said.push(
  `${totalSteps} generator steps total: ${stepsDuringRide} behind the moving bus, ` +
    `${stepsDuringOverrun} while parked at the gate`,
);
said.push(
  `so the bus idles at the gate for ${overrunFrames} frames while it finishes — the parked wait, ` +
    `in device-independent frames`,
);
said.push(
  `budgets: ${GENERATION_BUDGET_MS} ms rolling, ${OVERRUN_GENERATION_BUDGET_MS} ms parked ` +
    `(${(OVERRUN_GENERATION_BUDGET_MS / GENERATION_BUDGET_MS).toFixed(0)}x)`,
);

// ---------------------------------------------------------------------------
// The bound: **the parked frames must each drain far more generation than the
// rolling ones did.** That is the whole fix — and stated this way it is
// independent of both the machine and the seed.
//
// An absolute frame ceiling was tried first and rejected: the number of
// generator steps is seed-dependent (the slide's rung retries vary), so a bare
// "under N frames" is a tripwire that a harder seed trips with the fix perfectly
// in place. What does NOT vary by seed is the *ratio* of work-per-frame between
// the two phases, because it is set by the two budgets: ~25x with the fix, ~1x
// without it. So the guard measures the ratio the generation actually ran at.
//
// **Proven at both ends by mutation**, canonical seed, 9 August 2026:
//   fix  (parked budget 200): ~200 steps/parked-frame vs ~8/rolling  -> ~26x, passes
//   main (parked budget   8): ~8 steps/parked-frame  vs ~8/rolling  -> ~1x,  RED
//
// The floor is 10 — comfortably above 1 (a reverted fix), comfortably below 25
// (the real ratio), so it is neither a tripwire on the fix nor passable by main.
//
// This does not claim the wait is short in seconds — on a slow enough device the
// residual is the raw generation cost and no scheduling beats it (that number is
// measured in wall-clock in the PR). It claims the parked wait drains at the
// parked budget rather than the rolling one, which is the difference between a
// bounded loading screen and the effectively-endless idle `main` ships.
// ---------------------------------------------------------------------------
const RIDE_FRAMES = Math.round(20 / SLOW_DEVICE_DT); // 240
const rollingRate = rideEndFrame > 0 ? stepsDuringRide / rideEndFrame : 0;
const parkedRate = overrunFrames > 0 ? stepsDuringOverrun / overrunFrames : 0;
const speedup = rollingRate > 0 ? parkedRate / rollingRate : 0;
const SPEEDUP_FLOOR = 10;
said.push(
  `work per frame: ${rollingRate.toFixed(1)} steps while rolling, ${parkedRate.toFixed(1)} while ` +
    `parked — the parked frames drain ${speedup.toFixed(1)}x faster (floor ${SPEEDUP_FLOOR}x)`,
);
said.push(
  `so the parked wait is ${overrunFrames} frames (~${(overrunFrames / RIDE_FRAMES).toFixed(0)} rides); ` +
    `at the rolling budget it would be ~${(stepsDuringOverrun / Math.max(rollingRate, 1)).toFixed(0)} — ` +
    `the ${speedup.toFixed(0)}x the fix buys`,
);

if (overrunFrames < 0) {
  fouls.push('could not measure the parked wait — the ride never ended or generation never finished');
} else if (speedup < SPEEDUP_FLOOR) {
  fouls.push(
    `the bus's parked frames drain only ${speedup.toFixed(1)}x faster than its rolling ones ` +
      `(${parkedRate.toFixed(1)} vs ${rollingRate.toFixed(1)} steps/frame), under the ${SPEEDUP_FLOOR}x floor. ` +
      'Generation is being metered at the rolling budget while the bus is parked, so the wait at the ' +
      'gate is not draining any faster than it did during the ride — the unbounded idle Jim reported. ' +
      'Check that `overrunAwareBudgetMs` still hands the parked frames OVERRUN_GENERATION_BUDGET_MS and ' +
      'that `overrunning` fires once the ride is over',
  );
}

for (const line of said) console.log(`  ${line}`);
if (fouls.length > 0) {
  console.error('\ncheck:arrival-completes FAILED');
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('\ncheck:arrival-completes passed');
