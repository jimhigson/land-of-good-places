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
 * The per-slice ceiling additionally **calibrates itself to the box it is
 * running on**, because the park is deterministic and so does the same number
 * of work units everywhere: a fixed arithmetic loop that belongs to nothing else in
 * this repo is a free and honest measurement of how fast this machine is, and the grace the ceiling allows for the one unit a slice can
 * overrun by is scaled by it. A constant in milliseconds was tried twice and
 * blocked main's deploy twice — see `ADVANCE_CEILING_MS` for the reasoning, the
 * numbers, and what it deliberately does not catch.
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
import {
  GENERATION_BUDGET_MS,
  OVERRUN_GENERATION_BUDGET_MS,
  ParkGeneration,
} from '../src/boot/parkGeneration.ts';
import { JourneyDirector } from '../src/world/entrance/journeyDirector.ts';
import { SETTLE_SECONDS } from '../src/world/entrance/BusJourney.ts';

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
// How much a single turn of this check's own frame loop costs, before any
// generation is running. The loop below awaits `setImmediate` once per frame,
// and on a slow box with thousands of frames that scheduling adds up to
// hundreds of milliseconds — none of which is the park being built. Measured
// rather than assumed, so the figure below can be honest about what is the
// park's work and what is the harness's.
const OVERHEAD_SAMPLES = 200;
const overheadStart = performance.now();
for (let i = 0; i < OVERHEAD_SAMPLES; i += 1) await nextFrame();
const perFrameOverheadMs = (performance.now() - overheadStart) / OVERHEAD_SAMPLES;

const generation = new ParkGeneration();

/** The ride is 20 s; at 60 Hz that is 1200 frames. Enough rope to hang itself. */
const MAX_FRAMES = 6000;

let frames = 0;
let worstAdvanceMs = 0;
let totalAdvanceMs = 0;
let framesThatBlockedMeasurably = 0;

// **Which phase the worst slice was in, and how many units it got through.**
//
// The message this check prints when the ceiling goes red tells the reader to
// profile the unit — and until now gave them nothing to profile it *with*, so
// the last person to read it had to build a driver of their own to find out
// which of five phases the bad frame was even in. The counts are already
// exposed per phase; the delta across one `advance()` names the phase for free.
//
// Read it as a rate. A slice that did hundreds of units simply spent its budget
// and is fine. A slice that did **one or two** and still blocked is the
// interesting one: either that unit is genuinely too big to be a unit, or the
// machine took the CPU away mid-slice. The two are told apart by the per-unit
// figure below — a unit that is expensive is expensive on every run.
type Phase = 'brief' | 'cruiserSearch' | 'cruiserFinish' | 'trainSearch' | 'slideSearch';
const PHASES: readonly Phase[] = ['brief', 'cruiserSearch', 'cruiserFinish', 'trainSearch', 'slideSearch'];
const unitsSeen: Record<Phase, number> = {
  brief: 0,
  cruiserSearch: 0,
  cruiserFinish: 0,
  trainSearch: 0,
  slideSearch: 0,
};
let worstSlice = { ms: 0, phase: 'no generator step at all', steps: 0, stage: 'waiting' };
/** Wall clock spent in slices that did each phase's work — the calibration. */
const phaseMs: Record<Phase, number> = {
  brief: 0,
  cruiserSearch: 0,
  cruiserFinish: 0,
  trainSearch: 0,
  slideSearch: 0,
};

const startedAt = performance.now();

lastTick = performance.now();
while (!generation.ready && !generation.failed && frames < MAX_FRAMES) {
  const stage = generation.stage;
  const before = performance.now();
  generation.advance(GENERATION_BUDGET_MS);
  const spent = performance.now() - before;
  frames += 1;
  totalAdvanceMs += spent;
  // Exactly one phase does work in any one `advance()` — every branch of it
  // returns — so the single non-zero delta names the slice.
  let did: Phase | null = null;
  let steps = 0;
  for (const phase of PHASES) {
    const done = generation.unitCounts[phase] - unitsSeen[phase];
    unitsSeen[phase] = generation.unitCounts[phase];
    if (done > 0) {
      did = phase;
      steps = done;
    }
  }
  if (did) phaseMs[did] += spent;
  if (spent > worstAdvanceMs) {
    worstAdvanceMs = spent;
    worstSlice = { ms: spent, phase: did ?? 'no generator step at all', steps, stage };
  }
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
said.push(
  `that worst slice was ${worstSlice.phase}, ${worstSlice.steps} work units in ` +
    `${worstSlice.ms.toFixed(1)} ms, during "${worstSlice.stage}"`,
);
said.push(`the slide's search reached attempt ${generation.attempts}`);

// ---------------------------------------------------------------------------
// **How fast is this box?** Measured from the run itself, not assumed.
//
// The park is deterministic, so the number of work units it is divided into is
// the same everywhere: the GitHub runner that failed run 31288279104 printed
// `152 / 29142 / 11 / 415337`, byte-identical to this laptop on the same
// commit, differing only in taking 14.33 s over it against 5.82 s. (The 11 is
// 19 now — that phase gained its seam yields on this branch.) The time those
// units took is therefore a clean measurement of the machine, and it is free:
// the run has already done it.
//
// This is `check-solve-cost.mts`'s idiom — "budgets stated as a multiple of
// measured cost" — with the multiplier measured here rather than written down,
// because the thing being calibrated out is precisely the box.
//
// **The Sky Cruiser's plan-view search is the ruler, and not just because it is
// convenient.** A calibration has to be taken from work that will not itself
// change when somebody regresses the thing being guarded, or the ceiling rises
// to meet the regression and the guard goes quiet. Tried first on the run's
// whole mean: a mutation making the slide's `satisfies` five times dearer took
// the worst slice from 9.7 ms to 18.2 ms *and* the mean from 13.2 to 15.7 us,
// which lifted the ceiling by nearly as much as the fault it was supposed to
// catch. The cruiser's search is 29,142 steps of one homogeneous kind — laying
// rail pieces in plan view, no terrain, no chute rebuilds, no cold start,
// nothing a future ride will touch — so it measures the machine and only the
// machine.
// ---------------------------------------------------------------------------
const units = generation.unitCounts;

/**
 * **The ruler is a fixed arithmetic loop, not any of this repo's own work.**
 *
 * The first version timed the Sky Cruiser's plan-view search, reasoning that
 * 29,142 homogeneous steps measure the machine and only the machine. It was
 * right about regressions and wrong about *improvements*, which is the same
 * hazard from the other side: #258 made a cruiser joint 13x cheaper, so the
 * reference recorded hours earlier (41.5 us) was met by every box on earth.
 * `slowness` floored at 1.00 everywhere, CI lost all its grace, and this check
 * went red on an unrelated PR — a gate failing for a reason its author could
 * not have caused, which is exactly what the file's own comments say must not
 * happen. Measured on this laptop after that merge: **3.1 us** per joint
 * against a 41.5 us reference.
 *
 * A calibration constant has to be tied to work nobody is trying to make
 * faster, or it is two definitions of one thing kept in step by hand — the
 * repo's most common bug, wearing a stopwatch. So the ruler below is a
 * deterministic float loop that exists for no other purpose: it cannot be
 * optimised by a solver change, cannot regress when a unit gets dearer, and
 * has no cold start worth speaking of after its own warm-up pass.
 */
function msPerMegaflop(): number {
  const run = (): number => {
    const started = performance.now();
    let x = 1.000001;
    let sum = 0;
    for (let i = 0; i < 1_000_000; i += 1) {
      x = x * 1.0000001 + 1e-9;
      sum += Math.sqrt(x) * 0.5;
    }
    // Consumed so no engine can fold the loop away.
    if (!Number.isFinite(sum)) throw new Error('calibration loop diverged');
    return performance.now() - started;
  };
  run();
  return Math.min(run(), run(), run());
}

const calibrationMs = msPerMegaflop();

/**
 * Five best-of-three passes on the machine named here: 1.41, 1.38, **1.34**,
 * 1.30, 1.28 ms — median 1.34.
 *
 * Machine: Apple `Mac16,8`, macOS 26.5.2, Node v25.6.1, idle.
 * Date: 9 August 2026.
 * Re-measure by running `npm run check:park-boot` and reading the calibration
 * line it prints — and if you change it, say which machine and when, because
 * this is the only place the two are tied together. Changing the loop's body
 * invalidates this number: change both together or not at all.
 */
const REFERENCE_CALIBRATION_MS = 1.34;

/**
 * How much slower this box is than the reference, never below 1.
 *
 * Floored at 1 so a *faster* machine than the reference does not quietly
 * tighten the ceiling below the value it was reasoned about at — a check that
 * gets stricter on its author's next laptop is a check that starts failing for
 * reasons nobody chose.
 */
const slowness = Math.max(1, calibrationMs / REFERENCE_CALIBRATION_MS);
said.push(
  `this box runs the calibration loop in ${calibrationMs.toFixed(2)} ms against the ` +
    `reference ${REFERENCE_CALIBRATION_MS.toFixed(2)} ms — ${slowness.toFixed(2)}x`,
);

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
// A slice stops the moment the clock says its budget is gone, so the most it
// can overrun by is **the one unit it was in the middle of**. That is the whole
// content of this assertion: budget, plus one unit's worth of grace.
//
// **Why the grace is scaled and the old fixed number was not tenable.** This
// was `GENERATION_BUDGET_MS * 3` — 24 ms, a constant. It passed on an M4 Pro at
// 18 ms, failed on a runner at 54.6 ms, was fixed, then failed again on 9
// August 2026 at **27.6 ms with identical unit counts to the laptop's** and
// blocked main's deploy for a day. A number in milliseconds cannot survive
// that, because it is a question about the machine wearing the clothes of a
// question about the code: the budget the driver is given is wall clock and so
// does not shrink on a slow box, but the unit it overruns by *does* grow, so
// the overrun is exactly the part that must be allowed to scale.
//
// So the grace is stated in the reference machine's milliseconds and scaled by
// how much slower this box measured itself to be, above. `slowness` is
// computed from the run's own work units, which are the same number everywhere,
// so nothing here has to be re-tuned when the hardware changes.
//
// **12 ms is ~2.5x the largest unit in the build.** Profiled a unit at a time —
// drive `advance(0)` and every drive loop does exactly one step, so the slice
// time *is* the unit cost — the worst is the castle-window carve at 4.85 ms
// (cold; 0.27 ms once V8 has tiered `terrainHeight` up), then the slide's
// route-closure steps at 2.2-2.7 ms where `satisfies` rebuilds the whole chute.
// Idle, this machine's worst slice is 9.5-10.7 ms, so 2.5x leaves about 2x
// headroom — room for a garbage collection landing inside a slice, which is
// real (a handful of steps a run already begin late for that reason) and which
// no amount of correct code prevents.
//
// **Confirmed on the machine that was actually failing.** The same code on a
// GitHub runner (run 31293136532) measures itself at **2.45x** and reports:
//
//     worst single advance() 19.0 ms against a 8 ms budget
//     that worst slice was cruiserFinish, 5 work units in 19.0 ms
//     this box costs 101.7 us per cruiser joint against the reference 41.5 us
//     so one slice may block for 37.4 ms
//
// 27.6 ms before this branch, 19.0 ms after, against a ceiling that scaled to
// 37.4 — so the same ~2x headroom the laptop has, which is the whole point of
// scaling it. Note what the new diagnostic line buys: the worst slice is still
// `cruiserFinish`, but it is five units now rather than one.
//
// **Measured sensitivity, stated rather than assumed.** Mutations run against
// this on 9 August 2026:
//
// - removing the eight seam yields from `coasterProfileSearch` — the exact
//   shape that blocked main — is **red on the piece counts below**, at 11
//   pieces against 12, and *not* red here: its worst slice measured 10.7 and
//   12.8 ms on two runs against a ~20 ms ceiling. That is the division of
//   labour working as written. The counts are the guarantee; this is the
//   secondary observation.
// - a driver that only looks at the clock every 4096 steps is **red here**, at
//   61.1 ms against a 20.2 ms ceiling, naming "slideSearch, 4096 work units".
// - making the slide's `satisfies` five times dearer (its unit 2.7 -> 13.5 ms)
//   is **not caught**: the worst slice came out at 17.7 ms against 20.0. It sits
//   just inside, because a fat unit only shows in full when it happens to start
//   right on a deadline. Tightening the grace until that went red leaves ~1.4x
//   headroom on CI, and a guard that goes red when the runner is busy is one
//   people learn to re-run rather than read. So: this catches a unit about three
//   times the largest, not two, and that is a choice rather than an oversight.
//
// **What it deliberately cannot catch, and who does.** If the park's units got
// uniformly more expensive, that is a cost regression rather than a granularity
// one, and `check:solve-cost` owns it — each solver stage against 8x its
// measured median. One owner per question. The tell here is the printed "us per
// cruiser joint" line: on a machine you believe is fast, a number far above the
// reference means the work got dearer, not that the box got slower.
const WORST_UNIT_GRACE_MS = 12;
const ADVANCE_CEILING_MS = GENERATION_BUDGET_MS + WORST_UNIT_GRACE_MS * slowness;
said.push(
  `so one slice may block for ${ADVANCE_CEILING_MS.toFixed(1)} ms ` +
    `(${GENERATION_BUDGET_MS} ms budget + ${WORST_UNIT_GRACE_MS} ms of grace x ${slowness.toFixed(2)})`,
);
if (worstAdvanceMs > ADVANCE_CEILING_MS) {
  fouls.push(
    `one advance() blocked for ${worstAdvanceMs.toFixed(1)} ms against a ${GENERATION_BUDGET_MS} ms ` +
      `budget and a ${ADVANCE_CEILING_MS.toFixed(1)} ms ceiling already scaled ${slowness.toFixed(2)}x ` +
      `for this box's speed — so this is NOT simply a slow machine. Read the worst-slice line ` +
      `above: if it got through hundreds of work units it merely spent its budget and something ` +
      `else is wrong; if it got through one or two, that unit is too big to be a unit. Profile it ` +
      `with \`generation.advance(0)\`, which makes every drive loop do exactly one step so the ` +
      `slice time IS the unit cost. Do not raise the ceiling: it stutters the orbit on a phone ` +
      `whatever CI says`,
  );
}

// ---------------------------------------------------------------------------
// The same question asked in units of WORK rather than of time.
//
// **Why this exists, and why it is the load-bearing half.** The assertion above
// is wall-clock, so it is really a question about the machine that ran it: this
// check passed on an M4 Pro at 18 ms and failed on a CI runner at 54.6 ms with
// identical code. Neither box is the one that matters — Eleri plays on a phone,
// which is far closer to the slow runner than to the laptop. A budget tuned
// until CI goes quiet would be a check that can no longer catch the stutter it
// was built for.
//
// So the guarantee is stated in numbers that are the same everywhere. The park
// is deterministic, so for a given seed the amount of work is fixed; what
// changes between devices is only how much of it fits in a frame. Two things
// then say precisely what "sliced finely enough" means:
//
//   1. **Nothing runs after the driver was told to stop.** Every drive loop
//      checks the clock after each step, so a step can never *begin* past its
//      deadline. Zero on correct code, positive the moment a loop is written
//      without that check — which is exactly the fault the wall-clock message
//      describes as "the search cannot be stopped where it was asked to stop".
//
//   2. **Each phase really is divided into many pieces.** A phase that collapses
//      to one indivisible unit still satisfies (1) — it just does all its work
//      in a single step — so the piece counts are asserted too. These floors are
//      taken from the algorithms (512 boundary bearings in 8s, 704 candidate
//      spots in 8s, ten repair passes) and sit below the real figures with room
//      for the searches to vary by seed.
//
// What this pair cannot do is promise "one slice fits in one frame" on an
// unnamed device: that depends on the device, and no device-independent number
// can settle it. It promises the thing that is actually in this code's gift —
// that the work is offered up in the smallest pieces the algorithms admit, and
// that the driver takes the first chance to stop. The wall-clock ceiling above
// is kept as the secondary observation that catches a unit growing *more
// expensive*, which these counts would not notice — and it is now scaled by
// this box's own measured speed, so that half is a question about the code too.
//
// **A floor is only worth what it counts.** The 9 August 2026 failure was an
// un-sliced prologue in `coasterProfileSearch`, and this half missed it: the
// floor below said "ten repair passes", the prologue was outside the repair
// loop, and eleven pieces cleared a floor of ten while one of them was doing
// 6.7 ms in a single step. The wall clock caught it on a slow box, which is the
// worst place to find out. So a floor here has to enumerate **every** seam the
// algorithm admits, not the loop that happens to be easiest to count.
// ---------------------------------------------------------------------------
said.push(
  `work units: brief ${units.brief}, cruiser search ${units.cruiserSearch}, ` +
    `cruiser finish ${units.cruiserFinish}, slide search ${units.slideSearch}`,
);
const lateByPhase = Object.entries(generation.lateStepsByPhase)
  .map(([phase, count]) => `${phase} ${count}`)
  .join(', ');
said.push(
  `steps begun after their slice's deadline: ${generation.stepsPastDeadline}` +
    (lateByPhase ? ` (${lateByPhase})` : ''),
);

// **Reported, deliberately not a gate — and the reason is worth the paragraph.**
//
// This counter was written to be the primary device-independent assertion, and
// it earned its place immediately: it found a slice that finished one phase and
// went straight on to start the next, which no stopwatch on a fast machine had
// shown. That bug is fixed.
//
// It cannot be a *gate*, though, and the attempt to make one is the useful
// finding. "The loop checks the clock between steps" is a property of the
// source, but anything measured from a clock also counts pauses the code did
// not cause: a garbage collection between one step's check and the next step's
// makes a correctly-written loop look late. Measured on a deliberately slowed
// machine it reported 13 late steps out of 415,337 — 0.003%, all in the loop
// with the largest heap churn, with every clock check present. Excluding the
// first step of each slice removed the false positives caused by the budget
// being gone on arrival; nothing can remove the ones caused by GC.
//
// A gate that goes red for reasons the author cannot fix is a gate people learn
// to re-run rather than read, which is the failure this whole file exists to
// avoid. So the number is printed — a jump in it still means something, and it
// names the loop — and the guarantee is carried by the piece counts below,
// which are exact.
// Floors from the algorithms, not from what this machine printed.
const MIN_UNITS: Readonly<Record<keyof typeof units, number>> = {
  // 512 boundary bearings in 8s (64) + 704 station spots in 8s (88), less slack.
  brief: 120,
  // Seed-dependent, but a search that solves at all takes thousands of joints.
  cruiserSearch: 500,
  // Eight structural seams that always run — the plan sampling, the station
  // scan, the hill and station carve, the castle span, the window carve, the
  // first curve build, and two in the tail — plus the vertical repair's
  // up-to-ten passes and the final step.
  //
  // **This floor is 10 because that is what the algorithm admits, and the real
  // guarantee is the exact seam count asserted below, not this number.** The
  // repair loop breaks the moment a pass finds nothing to lift, so its count is
  // data: the canonical seed takes all ten passes (19 units), a park whose
  // profile already clears the terrain takes one (10 units). A single total
  // cannot tell a skipped seam from an unneeded repair, and a floor of 12 set
  // to make one historical count red did exactly that — it prosecuted a park
  // for having a *better* profile, in the very words of a comment that had
  // already worked out that ten was legitimate.
  cruiserFinish: 10,
  // The train's loop is grown by the same rail generator as the cruiser, so a
  // solve takes hundreds to thousands of joints and yields at every one. The
  // floor is conservative — the loop is shorter than the cruiser's and a lucky
  // start pose solves in fewer — but comfortably proves it is not done in one
  // lump, which is the regression this exists to catch (its old bespoke solver
  // was one ~1.1 s block). Lowered 100 -> 60 on 2026-08-23: the statue-ring
  // layout rule (parkLayout.ts's ring annulus) re-rolled the canonical park
  // and its rail loop legitimately solves smaller (224.6 m, was 359 —
  // measured 98 pieces, two under the old floor); 60 still proves
  // many-pieces without prosecuting a genuinely quicker solve.
  trainSearch: 60,
  slideSearch: 500,
};
for (const [phase, floor] of Object.entries(MIN_UNITS) as [keyof typeof units, number][]) {
  if (units[phase] < floor) {
    fouls.push(
      `the ${phase} phase was divided into only ${units[phase]} pieces, against ${floor} the ` +
        'algorithm admits — it is being done in lumps the driver cannot stop in the middle of, ' +
        'which is a stutter on any device slow enough to notice',
    );
  }
}

/**
 * **Every structural seam in the cruiser finish was actually taken.**
 *
 * This is the guarantee `cruiserFinish`'s unit floor was reaching for and
 * could not express. `coasterProfileSearch` suspends in two different kinds
 * of place: eight seams between the phases, which are a fixed property of
 * the algorithm and always run, and the vertical repair loop, whose count is
 * data — it breaks as soon as a pass finds nothing to lift.
 *
 * Counting them together can only say "eleven pieces", which is the same
 * number whether a seam was skipped (a real stutter: a phase done in one
 * unstoppable lump) or a repair was simply not needed (a park whose profile
 * already clears the terrain, which is *better*). It went red on the second
 * while describing the first.
 *
 * So they are counted apart — the seams yield zero, the repair yields
 * `pass + 1` — and this asserts the seam count **exactly**. Exactly, not a
 * floor: one fewer means a phase stopped being interruptible, and one more
 * means a seam was added that nobody has re-measured the budget against.
 * Both are things a person should look at.
 */
const CRUISER_FINISH_SEAMS = 8;
const seamsSeen = generation.cruiserFinishSeamCount;
said.push(
  `cruiser finish seams: ${seamsSeen} of ${CRUISER_FINISH_SEAMS}, ` +
    `plus ${units.cruiserFinish - seamsSeen - 1} vertical repair pass(es) and the result`,
);
if (seamsSeen !== CRUISER_FINISH_SEAMS) {
  fouls.push(
    `the cruiser finish took ${seamsSeen} of its ${CRUISER_FINISH_SEAMS} structural seams — ` +
      'a phase of it is being done in one lump the driver cannot stop in the middle of, ' +
      'which is a stutter on any device slow enough to notice',
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
// So 250 ms now sits about **6x above the worst legitimate block and 3x below
// the cheapest failure** — an unsliced cruiser, ~0.8 s since the 8 Aug 2026
// hot-path pass (this line said "32x below … ~1.3 s" before that pass; the
// failure got cheaper, which narrows the margin on that side, and 3x is still
// separation, not a coin toss). The separation was restored by fixing the cost
// rather than by moving the line — which is the whole point of writing the
// thin version down instead of quietly living with it.
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
// between them; an unsliced ride solve costs ~0.8 s (cruiser) or 3.46 s (slide).
// A one-second ceiling sits clear of the first and below both of the others.
// `wallClock - advance` is everything that was not inside a slice, which
// includes this check's own frame loop as well as the module evaluations it is
// meant to catch. On a slow runner that scheduling is the larger half — 200
// frames of it are measured above, and the estimate is subtracted here so the
// number means what the sentence says.
const outsideAdvanceMs = wallClockMs - totalAdvanceMs;
const loopOverheadMs = perFrameOverheadMs * frames;
const unbudgetedMs = Math.max(0, outsideAdvanceMs - loopOverheadMs);
said.push(
  `${unbudgetedMs.toFixed(0)} ms of generation happened outside a budgeted slice ` +
    `(${outsideAdvanceMs.toFixed(0)} ms outside advance(), less ${loopOverheadMs.toFixed(0)} ms ` +
    `of this check's own frame loop: ${frames} frames x ${perFrameOverheadMs.toFixed(3)} ms)`,
);
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
      'Sky Cruiser is ~0.8 s and the ginormous slide ~3.46 s. Check which module evaluation the ' +
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
      'generated — coaster/plan.ts is not collecting it, so the ~0.8 s solve ran twice and the ' +
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
  // The drive may now cut to the park — but the hand-over still waits out the
  // closing approach (`SETTLE_SECONDS`), so the settle onto the park bearing is
  // never thrown away. See `JourneyDirector.readyToArrive`/`readyToHandOver`.
  if (!director.readyToArrive) {
    fouls.push('the park exists and is warmed and the minimum ride is done, but the drive will not cut to it');
  }
  if (director.readyToHandOver) {
    fouls.push('the drive handed over the instant the park was ready, skipping the closing settle');
  }
  for (let t = 0; t < SETTLE_SECONDS + 0.1; t += 1 / 60) director.advance(1 / 60);
  if (!director.readyToHandOver) {
    fouls.push('the park exists and is warmed and the closing approach has played, and the ride still will not hand over');
  }
  said.push(
    'the World is withheld until generation finishes, and the skip until the World exists — ' +
      'checked in both directions',
  );
  said.push('hand-over additionally waits for the shader warm-up and the closing approach, in both directions');
}

// ---------------------------------------------------------------------------
// **The moving-bus budget: no frame of the LOOPING overrun may block past a
// refresh of the moving bus.**
//
// The drive above measures generation at `GENERATION_BUDGET_MS` (8 ms), the
// budget while the ride is rolling. But this branch keeps the bus *moving*
// through the overrun too — orbiting camera, rolling countryside, a busload of
// children — and drains generation at `OVERRUN_GENERATION_BUDGET_MS` while it
// loops. A frame that blocks on that generation is a frame the moving bus jumps
// across: at the old 200 ms overrun budget the throttled loop ran at ~5 fps, the
// jumpiness Jim reported. Nothing here drove generation at that budget, so the
// judder shipped unguarded — this is the missing half.
//
// So drive a real generation at the overrun budget and time every `advance()`.
// The ceiling is **one 60 Hz refresh plus one worst unit's grace, scaled by this
// box's speed** — a moving-bus frame, plus the single work unit a slice can
// overshoot its budget by (`WORST_UNIT_GRACE_MS`, reused from the rolling ceiling
// above). Crucially the base is the *refresh*, not the budget, so it does NOT
// rise with the budget: a revert to 200 ms is red because 200 ms is far past one
// refresh however fast the box, which is the whole point. `advance()` stops the
// moment its budget is spent, so the worst it can block for is the budget plus
// the unit it was mid-way through — a budget chosen at or under a refresh keeps
// that inside the ceiling; a 200 ms budget cannot.
//
// **Proven red**: with `OVERRUN_GENERATION_BUDGET_MS` at its old 200, the worst
// advance here is ~200 ms against a ~29 ms ceiling. At the smooth 12 ms it is the
// budget plus the castle-window carve (~4 ms cold), well inside it.
{
  const FRAME_MS = 1000 / 60;
  const overrunGen = new ParkGeneration();
  const advances: number[] = [];
  let worst = 0;
  let overrunFrames = 0;
  while (!overrunGen.ready && !overrunGen.failed && overrunFrames < MAX_FRAMES) {
    const before = performance.now();
    overrunGen.advance(OVERRUN_GENERATION_BUDGET_MS);
    const spent = performance.now() - before;
    advances.push(spent);
    if (spent > worst) worst = spent;
    overrunFrames += 1;
    await nextFrame();
  }
  const sorted = [...advances].sort((a, b) => a - b);
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(0.99 * sorted.length))] ?? 0;
  const overRefresh = advances.filter((a) => a > FRAME_MS).length;
  const OVERRUN_ADVANCE_CEILING_MS = FRAME_MS + WORST_UNIT_GRACE_MS * slowness;
  said.push(
    `overrun budget ${OVERRUN_GENERATION_BUDGET_MS} ms: ${overrunFrames} frames, worst advance ` +
      `${worst.toFixed(1)} ms, p99 ${p99.toFixed(1)} ms, ${overRefresh} over one 60 Hz refresh ` +
      `(${FRAME_MS.toFixed(1)} ms)`,
  );
  said.push(
    `so one looping-overrun slice may block for ${OVERRUN_ADVANCE_CEILING_MS.toFixed(1)} ms ` +
      `(one refresh + ${WORST_UNIT_GRACE_MS} ms of grace x ${slowness.toFixed(2)})`,
  );
  if (!overrunGen.ready) {
    fouls.push(
      `generation never finished at the ${OVERRUN_GENERATION_BUDGET_MS} ms overrun budget in ` +
        `${overrunFrames} frames — the looping bus would drive forever`,
    );
  }
  if (worst > OVERRUN_ADVANCE_CEILING_MS) {
    fouls.push(
      `one advance() at the ${OVERRUN_GENERATION_BUDGET_MS} ms overrun budget blocked for ` +
        `${worst.toFixed(1)} ms against a ${OVERRUN_ADVANCE_CEILING_MS.toFixed(1)} ms ceiling ` +
        `(one 60 Hz refresh + grace, scaled ${slowness.toFixed(2)}x for this box). The bus is MOVING ` +
        'through the overrun now, so a frame that blocks this long jumps the bus, the camera and the ' +
        'countryside across — the judder Jim reported. The overrun budget is too large for a moving ' +
        'shot: bias it toward smoothness (near the rolling budget), do not drain flat-out',
    );
  }
}

for (const line of said) console.log(`  ${line}`);
if (fouls.length > 0) {
  console.error('\ncheck:park-boot FAILED');
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('\ncheck:park-boot passed');
