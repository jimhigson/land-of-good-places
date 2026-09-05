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
 * ended* — the frames during which the bus keeps driving its looping world while
 * the last of the park is built behind it. (The bus no longer parks at the gate;
 * it loops until the park is ready and a jump-cut hands over. What this file
 * guards is that the loop still *completes* — whatever the bus is doing on screen,
 * generation must finish in bounded frames, or the wait is unbounded and the game
 * never starts.)
 *
 * The device is modelled as a fixed number of generator **steps per frame**,
 * `advance(0)` being exactly one step (the drive loops read the clock after every
 * step, so a zero budget stops after one). The park is deterministic, so the
 * number of steps is the same on every machine; what a real device varies is only
 * how many steps fit in a frame. Expressing the model in steps rather than
 * milliseconds is what makes the frame counts below identical on a phone and on
 * CI — the same reason `check:park-boot` states its guarantees in work units.
 *
 * ## What this used to demand, and why that was inverted (9 August 2026)
 *
 * This file once required the overrun to drain **~25x faster** than the ride —
 * `OVERRUN_GENERATION_BUDGET_MS` was 200 ms against an 8 ms rolling budget — on the
 * premise that once the ride ended *the bus parked*, so a chunky frame rate was
 * free and the generator should drain flat-out. A `SPEEDUP_FLOOR` of 10x enforced
 * it.
 *
 * The looping-bus branch overturns that premise. The overrun is no longer a parked
 * bus: the drive **keeps moving** — orbiting camera, rolling countryside, a busload
 * of children — until the park is ready. A 200 ms frame jerks all of that; measured
 * on a throttled overrun it was the moving bus at ~5 fps, which is exactly the
 * jumpiness Jim reported. So the overrun budget is now chosen for **smoothness**,
 * a little above the rolling budget rather than 25x it (see
 * `OVERRUN_GENERATION_BUDGET_MS`). That makes the `SPEEDUP_FLOOR` unsatisfiable
 * *and wrong to satisfy*: any budget large enough to clear a 10x floor is a budget
 * that drops frames of the moving bus.
 *
 * So the guarantee this file owns is re-aimed at the invariant that actually
 * survived the design change:
 *
 * - **The loop still completes** in a bounded number of frames — the anti-"stuck
 *   forever" core, unchanged, and the reason the file exists. A budget of zero, or
 *   a generator that never finishes, is still caught here.
 * - **The overrun budget sits in the smooth-and-progressing band** — at least the
 *   rolling budget (so the wait never gets *worse* than the ride) and no more than
 *   one 60 Hz refresh (so a single slice cannot, on its own, eat a whole frame of
 *   the moving bus). A revert to 200 ms is red on the upper bound; a budget below
 *   the rolling one is red on the lower.
 * - **Whether that budget is smooth *in wall-clock*** — no single frame blocking
 *   past a refresh's worth of work — is `check:park-boot`'s, which drives real
 *   generation at this budget and times each `advance()`. One owner per question.
 *
 * **This does not claim the wait is *short*** — on a genuinely slow device the
 * residual wait is the device's raw generation cost and no scheduling beats it;
 * that number is measured in wall-clock in the PR, and the honest answer is that
 * the real cure is cheaper generation. It claims the loop *completes*, and that it
 * drains at a budget chosen to keep the moving bus smooth rather than to finish a
 * moment sooner and judder.
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
/** Every distinct budget the switch handed out, on each side of the ride's end. */
const budgetsWhileRolling = new Set<number>();
const budgetsWhileLooping = new Set<number>();
const startedAt = performance.now();

while (!generation.ready && !generation.failed && frames < MAX_FRAMES) {
  director.advance(SLOW_DEVICE_DT);
  if (rideEndFrame < 0 && director.rideOver) rideEndFrame = frames;

  if (director.shouldAdvanceGeneration()) {
    // The real budget policy, in the real place: 8 ms during the nominal ride,
    // 200 ms once it has overrun. Converted to this device's steps-per-frame.
    const budgetMs = director.overrunAwareBudgetMs(
      GENERATION_BUDGET_MS,
      OVERRUN_GENERATION_BUDGET_MS,
    );
    // **The budget the switch actually handed this frame**, recorded per frame
    // and per side of the ride's end. This is the mechanism the clause below
    // asserts on — `overrunAwareBudgetMs` is the switch, so asking it what it
    // returned is the question itself rather than a proxy for it.
    (director.rideOver ? budgetsWhileLooping : budgetsWhileRolling).add(budgetMs);
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
    `generation never finished in ${frames} frames — the drive would loop forever with the park never ` +
      'arriving, which is exactly the "stops forever" Jim reported wearing a different surface',
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
    `${stepsDuringOverrun} while the drive is looping`,
);
said.push(
  `so the drive loops for ${overrunFrames} frames while it finishes — the residual wait behind the ` +
    `moving bus, in device-independent frames`,
);
said.push(
  `budgets: ${GENERATION_BUDGET_MS} ms rolling, ${OVERRUN_GENERATION_BUDGET_MS} ms while looping ` +
    `(${(OVERRUN_GENERATION_BUDGET_MS / GENERATION_BUDGET_MS).toFixed(1)}x — smooth, not flat-out)`,
);

// ---------------------------------------------------------------------------
// The bound: **the overrun budget sits in the smooth-and-progressing band, and
// the loop drains at it rather than at the rolling rate.**
//
// This replaced a `SPEEDUP_FLOOR` of 10x on 9 August 2026. That floor required
// the overrun to drain *far faster* than the ride, which was right for a parked
// bus and wrong for a moving one: any budget large enough to clear it (>=80 ms
// against the 8 ms ride) drops frames of the looping bus. See the header. So the
// two ends of the band replace the one-sided floor:
//
//   - **lower bound `GENERATION_BUDGET_MS`** — the overrun must not drain *slower*
//     than the ride, or a slow device's wait gets worse the moment the bus starts
//     looping. `parkedRate >= rollingRate` is the same statement measured on the
//     run: the budget switch (`overrunAwareBudgetMs` -> `overrunning`) still fires
//     and still hands the loop at least the rolling budget.
//   - **upper bound one 60 Hz refresh** — a single generation slice that alone
//     needs a whole frame cannot leave any of that frame to draw the moving bus,
//     so it *must* judder. A revert to the old 200 ms is red here.
//
// Whether the chosen budget is smooth *in wall-clock* — no single `advance()`
// blocking past a refresh's worth of work — is `check:park-boot`'s to prove, by
// driving real generation at this budget and timing each slice. This file owns
// only that the loop **completes** (asserted above, the anti-"stuck forever"
// core) and that its budget is in the sane band. One owner per question.
//
// **Proven red both ways**, canonical seed: a revert to 200 ms trips the upper
// bound; an overrun budget below the 8 ms rolling one trips the lower.
// ---------------------------------------------------------------------------
const RIDE_FRAMES = Math.round(20 / SLOW_DEVICE_DT); // 240
const rollingRate = rideEndFrame > 0 ? stepsDuringRide / rideEndFrame : 0;
const parkedRate = overrunFrames > 0 ? stepsDuringOverrun / overrunFrames : 0;
const speedup = rollingRate > 0 ? parkedRate / rollingRate : 0;
/** One 60 Hz refresh: a slice at or above this cannot leave the moving bus a frame to draw. */
const SMOOTH_OVERRUN_CEILING_MS = 16;
said.push(
  `work per frame: ${rollingRate.toFixed(1)} counted steps while rolling, ${parkedRate.toFixed(1)} ` +
    `while looping (${speedup.toFixed(1)}x) — NARRATION, not an assertion. It is counted steps per ` +
    'frame, and the phases with no step counter behind them (the path solve, an import settling) ' +
    'end a frame early while still counting as a frame, so this reads below 1.5x whenever those ' +
    'land on the looping side. It cannot see the budget; the switch line below can',
);
said.push(
  `so the residual wait is ${overrunFrames} frames (~${(overrunFrames / RIDE_FRAMES).toFixed(0)} rides) ` +
    `of a moving, child-filled bus — longer than a flat-out drain, and smooth instead of juddering`,
);
said.push(
  `overrun budget ${OVERRUN_GENERATION_BUDGET_MS} ms must sit in [${GENERATION_BUDGET_MS}, ` +
    `${SMOOTH_OVERRUN_CEILING_MS}] ms: at least the rolling budget, at most one 60 Hz refresh`,
);

if (overrunFrames < 0) {
  fouls.push('could not measure the residual wait — the ride never ended or generation never finished');
}
if (OVERRUN_GENERATION_BUDGET_MS > SMOOTH_OVERRUN_CEILING_MS) {
  fouls.push(
    `the overrun generation budget is ${OVERRUN_GENERATION_BUDGET_MS} ms, over the ` +
      `${SMOOTH_OVERRUN_CEILING_MS} ms ceiling (one 60 Hz refresh). The bus keeps MOVING through the ` +
      'overrun now, so a slice that eats a whole frame judders the moving shot — which is exactly the ' +
      'jumpiness this branch exists to remove. Bias the budget toward smoothness, not toward draining fastest',
  );
}
if (OVERRUN_GENERATION_BUDGET_MS < GENERATION_BUDGET_MS) {
  fouls.push(
    `the overrun generation budget is ${OVERRUN_GENERATION_BUDGET_MS} ms, below the ${GENERATION_BUDGET_MS} ms ` +
      'rolling budget — the wait would drain SLOWER once the bus starts looping than it did during the ride, ' +
      'which makes a slow device wait longer for no smoothness gained',
  );
}
// ---------------------------------------------------------------------------
// **Did the switch actually hand the loop the overrun budget?** Asked of
// `overrunAwareBudgetMs` itself, every frame, on each side of the ride's end.
//
// This replaced `parkedRate >= rollingRate` on 2 Sep 2026. That clause's own
// comment called it "the same statement measured on the run", and it is not:
// steps are not a fixed size, and the two windows do not contain the same
// work. The harness turns the budget into a STEP budget
// (`budgetMs * STEPS_PER_MS`), so a frame that got the bigger budget still
// records fewer steps whenever it `break`s on an advance that did no counted
// step at all — an import settling, a phase being set up, or the path solve,
// which has no step counter behind it. On the canonical park those frames are
// almost all in the looping window, so the rate fell to 5.3 against 7.7 and
// the check reported that the budget switch was not firing. Measured, it was:
// every looping frame was handed 12 ms and every rolling frame 8 ms.
//
// So the rates below stay as narration, because a jump in them still means
// something, and they carry the note that they are NOT the assertion. What is
// asserted is the switch's own output, which is exact, device-independent, and
// cannot be moved by which phase happened to land in which window.
// ---------------------------------------------------------------------------
const oneBudget = (seen: ReadonlySet<number>): string =>
  seen.size === 0 ? 'never asked' : [...seen].map((ms) => `${ms} ms`).join(', ');
said.push(
  `the budget switch handed out ${oneBudget(budgetsWhileRolling)} while the bus was rolling and ` +
    `${oneBudget(budgetsWhileLooping)} while it looped — this is the assertion; the steps-per-frame ` +
    'above is narration, and cannot see the phases that have no step counter (the path solve)',
);
if (budgetsWhileRolling.size !== 1 || !budgetsWhileRolling.has(GENERATION_BUDGET_MS)) {
  fouls.push(
    `while the bus was still rolling the budget switch handed out ${oneBudget(budgetsWhileRolling)}, ` +
      `not the ${GENERATION_BUDGET_MS} ms rolling budget — \`overrunAwareBudgetMs\` is applying the ` +
      'wrong budget before the ride is over',
  );
}
if (overrunFrames > 0 && (budgetsWhileLooping.size !== 1 || !budgetsWhileLooping.has(OVERRUN_GENERATION_BUDGET_MS))) {
  fouls.push(
    `once the ride was over the budget switch handed out ${oneBudget(budgetsWhileLooping)}, not the ` +
      `${OVERRUN_GENERATION_BUDGET_MS} ms overrun budget — \`overrunAwareBudgetMs\`/\`overrunning\` is ` +
      'not applying the overrun budget once the ride is over, so the residual wait drains at the ride rate',
  );
}

for (const line of said) console.log(`  ${line}`);
if (fouls.length > 0) {
  console.error('\ncheck:arrival-completes FAILED');
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('\ncheck:arrival-completes passed');
