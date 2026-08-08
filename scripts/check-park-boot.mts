/**
 * **Does the ride actually cover the park's generation — without stuttering?**
 *
 * `check:bus-journey` owns whether the bus is on screen and the skip is honest.
 * This owns the thing the ride is *for*: that the ~4 s of procedural generation
 * happens **during** it, spread over hundreds of frames, and that nobody is let
 * into the park until it is finished.
 *
 * ## What makes this check hard to write honestly
 *
 * Three guards on this feature have already turned out to be incapable of
 * failing — one counted an array instead of the built scene, one lived in a
 * class that cannot be constructed headlessly, one had its occlusion test
 * inverted. The trap here is a fourth of the same family: **asserting that
 * generation was sliced by asking the slicer whether it sliced.** A check that
 * counts calls to `advance()`, or reads `framesWorked`, passes on an
 * implementation that does the whole 3.46 s solve inside the first call.
 *
 * So the load-bearing measurement is a **wall clock**, in two places:
 *
 * - **How long each `advance()` blocked**, directly timed. This catches a
 *   solver slice that overruns the budget it was given.
 * - **The worst the event loop was blocked for**, from a 2 ms timer measuring
 *   its own lateness. This catches *everything*, including the module
 *   evaluations that run a ride's top-level `const` when a dynamic `import()`
 *   settles — work that happens nowhere near `advance()` and which timing
 *   `advance()` alone would completely miss. A frame that blocks is exactly
 *   what a stutter in the orbit is, so this is the number that corresponds to
 *   the thing Jim would actually see.
 *
 * Both are compared against thresholds derived from **the game's own**
 * `GENERATION_BUDGET_MS`, not from whatever this machine happened to produce.
 *
 * ## And that the pre-warmed park is the same park
 *
 * Slicing a search is only safe if it cannot move the result. That is argued in
 * `rail/generate.ts` — the search's whole state is generator locals, so
 * suspending it cannot reorder an `Rng` draw — and it is *proved* here, in one
 * process, for **both** sliced rides:
 *
 * - the `SLIDE_PLAN` the game gets from the pre-warmed path is hashed against a
 *   straight-through `planSlide()`, over 4000 sampled route points and every
 *   point of the built chute;
 * - `COASTER_PLANS.cruiser` likewise against a straight-through `planCruiser()`,
 *   over 4000 sampled loop points plus the station and the exit.
 *
 * The cruiser is asked separately rather than being assumed to follow from the
 * slide, because it is solved *first*: the train's low corridor, the slide's own
 * air and the castle's window are all measured against whatever loop it
 * produced.
 *
 * `ParkGeneration` is reachable from here at all because it deliberately has no
 * DOM, no renderer and no `Game` in it — the same property that lets
 * `journeyDirector.ts` and `arrivalSpawn.ts` be checked.
 */
import { createHash } from 'node:crypto';
import { Vector3 } from 'three';
import { performance } from 'node:perf_hooks';
import { GENERATION_BUDGET_MS, ParkGeneration } from '../src/boot/parkGeneration.ts';
import { JourneyDirector } from '../src/world/entrance/journeyDirector.ts';

const fouls: string[] = [];
const said: string[] = [];

/** A frame, near enough: give the loop a turn so a pending import can settle. */
const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

// ---------------------------------------------------------------------------
// The event loop's own lateness. A 2 ms timer that fires 40 ms late was blocked
// for 38 ms, and a blocked main thread is precisely what a dropped frame is.
// This sees work that `advance()` does not — above all a dynamic import's
// module evaluation, which is where the boundary's ~55 ms and the train's own
// ~157 ms actually get spent. (The train's figure is its own cost, measured by
// importing its dependencies first; imported cold it also carries the cruiser's
// ~1.3 s, which is the misreading behind issue #252.)
// ---------------------------------------------------------------------------
const LAG_INTERVAL_MS = 2;
let worstBlockMs = 0;
let blockedOver16 = 0;
let lastTick = performance.now();
const lagTimer = setInterval(() => {
  const now = performance.now();
  const blocked = now - lastTick - LAG_INTERVAL_MS;
  if (blocked > worstBlockMs) worstBlockMs = blocked;
  if (blocked > 16.7) blockedOver16 += 1;
  lastTick = now;
}, LAG_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Drive a real `ParkGeneration` exactly as `main.ts`'s ride loop drives it.
// ---------------------------------------------------------------------------
const generation = new ParkGeneration();

/** The ride is 20 s; at 60 Hz that is 1200 frames. Enough rope to hang itself. */
const MAX_FRAMES = 6000;

let frames = 0;
let worstAdvanceMs = 0;
let totalAdvanceMs = 0;
let framesThatBlockedMeasurably = 0;
const startedAt = performance.now();

lastTick = performance.now();
while (!generation.ready && !generation.failed && frames < MAX_FRAMES) {
  const before = performance.now();
  generation.advance(GENERATION_BUDGET_MS);
  const spent = performance.now() - before;
  frames += 1;
  totalAdvanceMs += spent;
  if (spent > worstAdvanceMs) worstAdvanceMs = spent;
  if (spent > 1) framesThatBlockedMeasurably += 1;
  await nextFrame();
}
const wallClockMs = performance.now() - startedAt;
clearInterval(lagTimer);

if (generation.failed) {
  fouls.push(`the park's generation threw during the ride: ${generation.failed.message}`);
}
if (!generation.ready) {
  fouls.push(
    `the park never finished generating: ${frames} frames of ${GENERATION_BUDGET_MS} ms and it is ` +
      `still at "${generation.stage}" — the bus would idle at the gate forever`,
  );
}

said.push(
  `generation finished in ${frames} frames / ${(wallClockMs / 1000).toFixed(2)} s wall clock, ` +
    `${(totalAdvanceMs / 1000).toFixed(2)} s of it inside advance()`,
);
said.push(
  `worst single advance() ${worstAdvanceMs.toFixed(1)} ms against a ${GENERATION_BUDGET_MS} ms budget; ` +
    `${framesThatBlockedMeasurably} frames did over a millisecond of work`,
);
said.push(
  `worst the event loop was blocked: ${worstBlockMs.toFixed(1)} ms, ` +
    `over one 60 Hz frame on ${blockedOver16} occasions`,
);
said.push(`the slide's search reached attempt ${generation.attempts}`);

// --- it is SPREAD, not merely done -----------------------------------------
// The whole ask is "amortised over many small tasks over many frames". One
// frame doing 3.46 s of work would satisfy "the park generated during the ride"
// and be exactly the failure this exists to prevent.
//
// The floor is derived, not observed: 3.46 s of slide search at
// GENERATION_BUDGET_MS a frame cannot take fewer than ~430 frames, so 100 is a
// long way below anything a working implementation produces and a long way
// above what a broken one does.
const MIN_WORKING_FRAMES = 100;
if (frames < MIN_WORKING_FRAMES) {
  fouls.push(
    `the park generated in only ${frames} frames — Jim asked for it "amortised over many small ` +
      'tasks over many frames", and this is a lump with a bus in front of it',
  );
}

// --- no frame is allowed to hitch ------------------------------------------
// A slice may overrun its budget by at most the one joint it was in the middle
// of (~35 us), so a multiple of the budget is generous and still catches a
// search that can only be stopped between whole attempts (~17 ms each on the
// canonical seed, and far worse on seed 5).
//
// Three times rather than two because this machine measures 8.8 ms idle and
// 11.6 ms with a full build running alongside, and a guard that goes red when
// the box is busy is a guard people learn to re-run rather than read. The
// mutation that removes the joint-level yield measures **69 ms**, so the
// separation is still sixfold.
const ADVANCE_CEILING_MS = GENERATION_BUDGET_MS * 3;
if (worstAdvanceMs > ADVANCE_CEILING_MS) {
  fouls.push(
    `one advance() blocked for ${worstAdvanceMs.toFixed(1)} ms against a ${GENERATION_BUDGET_MS} ms ` +
      `budget — the search cannot be stopped where it was asked to stop, and the orbit will stutter`,
  );
}

// The event loop's own view, which covers the module evaluations too.
//
// **Derived from the mechanism, not from what this machine printed** — and the
// first version of this line was the latter, at 67 ms, which promptly went red
// at 69.6 ms because a full `npm run build` happened to be running alongside.
// A threshold taken from one idle observation is the same mistake as taking one
// from the generator's own target instead of the game's.
//
// So: the largest *legitimate* block here is one ride plan's module evaluation.
// The smallest *illegitimate* one is a ride's whole solve landing in a single
// block instead of being sliced — the Sky Cruiser at ~1300 ms, the slide at
// ~3460 ms.
//
// **Re-measured 8 August 2026, because the number that used to be here was
// wrong in the way that costs the most.** It said "the train's is ~44 ms
// (measured 47 ms idle, 70 ms under load)". That figure predated the Land Hotel
// merge (#241), which doubled the park's area and took the train's own module
// evaluation to ~157 ms — and this file was the only place in the repo carrying
// the stale claim, so issue #252 quoted it as evidence against the train.
//
// Measured on this branch with the cruiser sliced, twice, because the answer
// moved under us mid-session:
//
// - before #253 landed, the worst legitimate block was `train/plan.ts`'s own
//   evaluation at **153-169 ms**, leaving 250 ms only ~1.5x clear of it. That
//   was recorded here as too thin rather than papered over, with the fix named:
//   bring the train's own cost down, do not raise this ceiling.
// - #253 then merged, doing exactly that. Re-measured over three runs: the
//   worst block is **39.3-40.3 ms**.
//
// So 250 ms now sits about **6x above the worst legitimate block and 32x below
// the cheapest failure** (an unsliced cruiser at ~1.3 s). That is the separation
// this ceiling was chosen for, restored by fixing the cost rather than by moving
// the line — which is the whole point of writing the thin version down instead
// of quietly living with it.
//
// It does not need to be tighter: the mutation that makes slices too coarse is
// caught by ADVANCE_CEILING_MS above, which is the assertion that owns that
// question. This one exists for the work that never passes through `advance()`
// at all.
const BLOCK_CEILING_MS = 250;
if (worstBlockMs > BLOCK_CEILING_MS) {
  fouls.push(
    `the main thread was blocked for ${worstBlockMs.toFixed(0)} ms in one go — that is ` +
      `${(worstBlockMs / 16.7).toFixed(0)} dropped frames, and a hitch in the orbit is a failure ` +
      'even when the totals look good',
  );
}

// ---------------------------------------------------------------------------
// The pre-warmed park is the same park — and it really was pre-warmed.
// ---------------------------------------------------------------------------
const { SLIDE_PLAN } = await import('../src/world/slide/plan.ts');

// **Timing this import proves nothing, and finding that out is worth writing
// down.** The first version of this check asserted it was fast. It is always
// fast — `ParkGeneration` imports `world/paths`, which imports `slide/plan`, so
// the module is *always* already in the cache by the time the check asks for
// it, pre-warmed or not. Under a mutation that made `plan.ts` ignore the
// pre-warm entirely it still reported 0 ms. An assertion that cannot fail, in a
// check written to catch assertions that cannot fail.
//
// Two things that can fail replace it.
//
// **One: the letterbox is empty**, because `slide/plan.ts` took what was in it.
// A full slot means the plan was solved during the ride and then ignored.
const { takePrewarmedSlide } = await import('../src/world/slide/prewarm.ts');
if (takePrewarmedSlide() !== null) {
  fouls.push(
    'a pre-warmed slide is still sitting in prewarm.ts after the whole park has generated — ' +
      'slide/plan.ts is not collecting it, so the 3.46 s search ran twice and the ride covered ' +
      'none of it',
  );
}

// **Two: no generation happened outside a budgeted slice.** The complement of
// the assertion above, and what catches the case where nothing is ever *offered*
// to the letterbox — the slot is then legitimately empty, but `slide/plan.ts`
// re-solves the slide inside the `world/paths` import, which is wall-clock time
// that never passed through `advance()` and was never budgeted.
//
// The ride plans' own module evaluations live in this gap too and cost ~240 ms
// between them; an unsliced ride solve costs 1.3 s (cruiser) or 3.46 s (slide).
// A one-second ceiling sits clear of the first and below both of the others.
const unbudgetedMs = wallClockMs - totalAdvanceMs;
said.push(`${unbudgetedMs.toFixed(0)} ms of generation happened outside a budgeted slice`);
const UNBUDGETED_CEILING_MS = 1000;
if (unbudgetedMs > UNBUDGETED_CEILING_MS) {
  // **This message used to name the cause, and named the wrong one.** It said
  // "at this size it is the slide being solved a second time" — but when this
  // check first went red after the hotel merge it was neither the slide nor the
  // train: it was the Sky Cruiser's ~1.3 s solve, evaluated whole inside
  // whichever module imported `COASTER_PLANS` first. A message asserting a cause
  // it did not measure sent an agent to `train/plan.ts` for a day.
  //
  // So it now reports what it actually measured and lists the candidates by
  // size, leaving the diagnosis to whoever reads the number.
  fouls.push(
    `${(unbudgetedMs / 1000).toFixed(2)} s of work happened outside any budgeted slice — ` +
      'generation the ride does not control is generation the ride cannot spread. At this size ' +
      'it is a whole ride solve landing in one module evaluation rather than being sliced: the ' +
      'Sky Cruiser is ~1.3 s and the ginormous slide ~3.46 s. Check which module evaluation the ' +
      'worst block above lands in — and note that whichever module imports a solved plan FIRST ' +
      'is billed for it, so the expensive module is not always the one named',
  );
}

const { planSlide } = await import('../src/world/slide/solve.ts');
const straightThrough = planSlide();

const hashOfRoute = (plan: typeof SLIDE_PLAN): string => {
  const hash = createHash('sha256');
  const at = { x: 0, z: 0 };
  for (let i = 0; i < 4000; i += 1) {
    plan.route.pointAt((i / 4000) * plan.route.length, at);
    hash.update(`${at.x.toFixed(6)},${at.z.toFixed(6)};`);
  }
  return hash.digest('hex');
};
const hashOfChute = (plan: typeof SLIDE_PLAN): string => {
  const hash = createHash('sha256');
  for (const point of plan.points) {
    hash.update(`${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)};`);
  }
  return hash.digest('hex');
};

const ridden = { route: hashOfRoute(SLIDE_PLAN), chute: hashOfChute(SLIDE_PLAN) };
const plain = { route: hashOfRoute(straightThrough), chute: hashOfChute(straightThrough) };

said.push(`slide solved in slices: ${SLIDE_PLAN.route.length.toFixed(4)} m, route ${ridden.route.slice(0, 12)}`);
said.push(`slide solved straight through: ${straightThrough.route.length.toFixed(4)} m, route ${plain.route.slice(0, 12)}`);

if (ridden.route !== plain.route) {
  fouls.push(
    `the slide solved a slice at a time is a DIFFERENT ROUTE from the one solved straight through ` +
      `(${SLIDE_PLAN.route.length.toFixed(2)} m vs ${straightThrough.route.length.toFixed(2)} m) — ` +
      'the park a child boots into is not the park CI checks',
  );
}
if (ridden.chute !== plain.chute) {
  fouls.push(
    'the slide chute built from the sliced solve differs from the straight-through one — ' +
      'the castle doorway and the ball-pit landing will not agree with the ride',
  );
}
if (ridden.route === plain.route && ridden.chute === plain.chute) {
  said.push('sliced and straight-through solves are identical: same route SHA, same chute SHA');
}

// ---------------------------------------------------------------------------
// The same two questions for the Sky Cruiser, which is sliced the same way.
//
// Asked separately rather than folded into the slide's, because they can fail
// independently: the cruiser is solved *first* and everything downstream —
// the train's low corridor, the slide's air, the castle's window — is measured
// against whatever loop it produced. A cruiser that came out of the sliced path
// different from the straight-through one would move all three, and the slide's
// own hash would only show it by accident.
// ---------------------------------------------------------------------------
const { takePrewarmedCruiser } = await import('../src/world/coaster/prewarm.ts');
if (takePrewarmedCruiser() !== null) {
  fouls.push(
    'a pre-warmed Sky Cruiser is still sitting in coaster/prewarm.ts after the whole park has ' +
      'generated — coaster/plan.ts is not collecting it, so the ~1.3 s solve ran twice and the ' +
      'ride covered none of it',
  );
}

const { COASTER_PLANS } = await import('../src/world/coaster/plan.ts');
const { planCruiser } = await import('../src/world/coaster/solve.ts');
const cruiserStraightThrough = planCruiser();

const hashOfLoop = (plan: typeof COASTER_PLANS.cruiser): string => {
  const hash = createHash('sha256');
  const at = new Vector3();
  for (let i = 0; i < 4000; i += 1) {
    plan.route.pointAt((i / 4000) * plan.route.length, at);
    hash.update(`${at.x.toFixed(6)},${at.y.toFixed(6)},${at.z.toFixed(6)};`);
  }
  // The exit and the station are what the rest of the park is built against, so
  // they are hashed too rather than assumed to follow from the curve.
  hash.update(
    `|${plan.route.stationDistance.toFixed(6)}|${plan.exitX.toFixed(6)},${plan.exitZ.toFixed(6)}`,
  );
  return hash.digest('hex');
};

const cruiserRidden = hashOfLoop(COASTER_PLANS.cruiser);
const cruiserPlain = hashOfLoop(cruiserStraightThrough);
said.push(
  `cruiser solved in slices: ${COASTER_PLANS.cruiser.route.length.toFixed(4)} m, ` +
    `loop ${cruiserRidden.slice(0, 12)}`,
);
said.push(
  `cruiser solved straight through: ${cruiserStraightThrough.route.length.toFixed(4)} m, ` +
    `loop ${cruiserPlain.slice(0, 12)}`,
);
if (cruiserRidden !== cruiserPlain) {
  fouls.push(
    `the Sky Cruiser solved a slice at a time is a DIFFERENT LOOP from the one solved straight ` +
      `through (${COASTER_PLANS.cruiser.route.length.toFixed(2)} m vs ` +
      `${cruiserStraightThrough.route.length.toFixed(2)} m) — the train's low corridor, the ` +
      "slide's air and the castle's window are all measured against this loop, so the park a " +
      'child boots into is not the park CI checks',
  );
} else {
  said.push('sliced and straight-through Sky Cruiser are identical: same loop SHA');
}

// ---------------------------------------------------------------------------
// Nobody is let into a half-built park. Both directions.
// ---------------------------------------------------------------------------
{
  const director = new JourneyDirector();
  director.advance(1 / 60);
  director.advance(1 / 60);

  // Two frames in, generation incomplete: no build, no skip, no hand-over.
  if (director.shouldBuildPark()) {
    fouls.push(
      'the World is built while the park is still generating — `new World(...)` reads PATH_GRAPH ' +
        'and SLIDE_PLAN, so asking early does not build a smaller park, it blocks the frame ' +
        'solving all of it',
    );
  }
  if (!director.shouldAdvanceGeneration()) {
    fouls.push('generation is never advanced, so the ride covers nothing at all');
  }

  // Run the ride out. Still generating: the bus waits.
  for (let t = 0; t < 25; t += 1 / 60) director.advance(1 / 60);
  if (director.readyToHandOver) {
    fouls.push(
      'the ride hands over while the park is still generating — a loading screen that lies is ' +
        'worse than one that waits',
    );
  }
  if (!director.overrunning) {
    fouls.push('the ride has outrun the generation but does not know it, so the bus will not idle');
  }
  if (director.skipOffered) {
    fouls.push('the skip is offered while the park is still generating');
  }

  // Generation done — but the World is not built yet, so still no skip.
  director.noteGenerationReady();
  if (!director.shouldBuildPark()) {
    fouls.push('generation has finished and the World is still never asked for — the ride never ends');
  }
  if (director.skipOffered) {
    fouls.push(
      'the skip is offered the moment generation finishes, before the World exists — there is ' +
        'nothing to skip *to* yet',
    );
  }
  if (director.readyToHandOver) {
    fouls.push('the ride hands over before the World has been built');
  }

  // And now the park itself exists — but its shaders are not compiled yet, so
  // hand-over still waits. See `boot/shaderWarmup.ts`: handing over here gives
  // a park that stutters through its first seconds of play, which is the same
  // promise broken as handing over a half-built one.
  director.noteParkReady();
  if (!director.skipOffered) fouls.push('the skip is never offered even once the park exists');
  if (director.readyToHandOver) {
    fouls.push('the ride hands over before the park\'s shaders have been warmed');
  }
  director.noteWarmupReady();
  if (!director.readyToHandOver) {
    fouls.push('the park exists and is warmed, and the ride still will not hand over');
  }
  said.push(
    'the World is withheld until generation finishes, and the skip until the World exists — ' +
      'checked in both directions',
  );
  said.push('hand-over additionally waits for the shader warm-up, checked in both directions');
}

for (const line of said) console.log(`  ${line}`);
if (fouls.length > 0) {
  console.error('\ncheck:park-boot FAILED');
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('\ncheck:park-boot passed');
