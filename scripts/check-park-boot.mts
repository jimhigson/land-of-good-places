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
 * So the load-bearing measurement is a **clock**, in two places:
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
 * **And both are measured in *attested busy time*, not raw wall clock (#606).**
 * A wall clock answers "how long did this take", which on a contended box is a
 * question about the box: this check failed three runs out of six on a loaded
 * laptop, three of its worst slices having done **zero work units**. So every
 * span here is charged only for the CPU time the process can be shown to have
 * spent inside it — `busyMsOf`, whose instrument is controlled against a known
 * busy loop and a known sleep before anything is measured. See the block above
 * `cpuMs` for the full argument and for what it deliberately stops covering.
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
// **Busy, not blocked — and a control on the instrument before it is trusted.**
//
// Issue #606. Every ceiling in this file used to be a *wall clock* compared
// against a budget for *generator work*, and those are only the same number on
// an idle machine. A box under contention does not run everything uniformly
// slower: it deschedules one slice for tens of milliseconds while the rest run
// at full speed. So this check failed three runs out of six on a loaded laptop
// and passed six out of six on a quiet one with the same commits — and its own
// failure message said, on three of the seven worst slices, **"no generator
// step at all, 0 work units in 29.8 ms"**. A slice that did zero work cannot
// have blown a budget on the cost of a work unit. It was blocked, not busy.
//
// The fix is to gate on the part of the wall clock the process can be *shown*
// to have spent computing, and to report the rest as an observation:
//
//     busyMs = min(wall clock elapsed, CPU time consumed)
//
// A CPU clock does not advance while its thread is descheduled, so a stall
// costs wall clock and no CPU and drops straight out of the minimum.
//
// **It must be `process.threadCpuUsage()`, not `process.cpuUsage()`, and that
// distinction was found by measurement rather than by reading.** The first
// version of this used `process.cpuUsage()`, which is `getrusage(RUSAGE_SELF)`
// — **every thread of the process**, including V8's concurrent marker and its
// background optimizing compiler. So an allocation-heavy slice gets charged
// work done on another core while its own thread was waiting for one, and the
// attestation quietly fails in the one case it exists for. Measured on this
// laptop, one allocation-churning stretch: 25.2 ms wall, **44.7 ms** of process
// CPU, **18.9 ms** of thread CPU. And measured on the real thing, with four
// other agents on the machine: under `process.cpuUsage()` the `pathGraph` task
// breached the ceiling on one slice of nine, on every run of three, worst 33.9
// ms — a fat unit that did not exist. Under `process.threadCpuUsage()`, on the
// same loaded box, three runs: **zero breaches on every task**, `pathGraph`
// worst 17.9-24.9 ms against ceilings of 25.9-28.6 ms.
//
// Thread CPU is still never *less* than the main thread's own work, so the
// `min` remains safe in the direction that matters: it can fail to clear a
// stall, it can never wrongly clear a busy slice, and nothing this check used
// to catch can hide behind it.
//
// **The control runs first, because this file's whole subject is instruments
// that cannot fail.** A CPU clock with millisecond granularity, or one that
// simply returns zero on some future runtime, would clear *every* slice and
// leave a check that reports success about nothing at all. So before anything
// is measured, the instrument is shown three known answers.
//
// **None of the three is a ratio against wall clock, and that matters.** The
// first version of this control asked that a busy loop attest at least 0.8 of
// its own wall clock — and on a loaded box the main thread is descheduled
// *inside the control itself*, so the control failed, the attestation was
// dropped, and the ceilings fell back to wall clock exactly on the runs that
// needed them most. Measured: it failed on this laptop with four other agents
// running. A control whose verdict depends on the machine's mood is the very
// fault being fixed, one layer out. So:
//
//  1. **It scales with work.** `spin(4M)` must attest at least twice `spin(1M)`,
//     and 1M must resolve above a fifth of a millisecond. A clock stuck at
//     zero, or too coarse to see a slice, fails here — and descheduling cannot
//     make it pass, because being descheduled does not add CPU time.
//  2. **It stops when the thread stops.** A 30 ms `Atomics.wait` must attest
//     near zero. This is the property the whole fix rests on.
//  3. **It is the *thread's* clock, not the process's.** Churn allocations hard
//     enough to start V8's concurrent marker: a per-thread clock cannot exceed
//     its own wall clock, a process-wide one can and does. This is the probe
//     that rejects `process.cpuUsage()` — measured 44.7 ms of CPU against 25.2
//     ms of wall — and it exists because that clock was used here first and was
//     wrong in a way nothing else caught.
//
// Fail any of the three and the attestation is abandoned, the ceilings go back
// to raw wall clock, and the run says so on stderr rather than quietly gating
// on nothing.
// ---------------------------------------------------------------------------
const cpuMs = (): number => {
  const used = process.threadCpuUsage();
  return (used.user + used.system) / 1000;
};

/** Deterministic arithmetic, no allocation: real work for a known duration. */
const spin = (iterations: number): number => {
  let x = 1.000001;
  let sum = 0;
  for (let i = 0; i < iterations; i += 1) {
    x = x * 1.0000001 + 1e-9;
    sum += Math.sqrt(x) * 0.5;
  }
  if (!Number.isFinite(sum)) throw new Error('spin diverged');
  return sum;
};

/** A real deschedule: the thread sleeps, so no CPU time may be charged for it. */
const sleepBlocking = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** Churn garbage hard enough to put V8's concurrent marker on another core. */
const churn = (rounds: number): number => {
  let kept: { a: number; b: number[] }[] = [];
  let seen = 0;
  for (let i = 0; i < rounds; i += 1) {
    kept.push({ a: i, b: [i, i + 1, i + 2] });
    seen += kept.length;
    if (kept.length > 50_000) kept = [];
  }
  return seen;
};

const CONTROL_SLEEP_MS = 30;
/** `spin(4M)` must attest at least this multiple of `spin(1M)`. */
const SCALING_CONTROL_FLOOR = 2;
/** `spin(1M)` must resolve at least this many ms, or the clock is too coarse. */
const RESOLUTION_CONTROL_FLOOR_MS = 0.2;
/** A descheduled sleep may attest at most this fraction of its wall clock. */
const IDLE_CONTROL_CEILING = 0.2;
/** A per-thread clock may exceed its own wall clock by at most this much. */
const THREAD_LOCAL_CONTROL_CEILING = 1.1;

type ClockControl = {
  usable: boolean;
  smallCpuMs: number;
  bigCpuMs: number;
  idleWallMs: number;
  idleCpuMs: number;
  churnWallMs: number;
  churnCpuMs: number;
  failures: string[];
};

const controlOfCpuClock = (): ClockControl => {
  spin(200_000); // warm-up, so the probes measure steady-state arithmetic

  // 1. Does it scale with work? Two sizes, four times apart.
  const smallCpu0 = cpuMs();
  spin(1_000_000);
  const smallCpuMs = cpuMs() - smallCpu0;
  const bigCpu0 = cpuMs();
  spin(4_000_000);
  const bigCpuMs = cpuMs() - bigCpu0;

  // 2. Does it stop when the thread does?
  const idleWall0 = performance.now();
  const idleCpu0 = cpuMs();
  sleepBlocking(CONTROL_SLEEP_MS);
  const idleWallMs = performance.now() - idleWall0;
  const idleCpuMs = cpuMs() - idleCpu0;

  // 3. Is it the thread's clock, or the whole process's? Worst of three, since
  //    the concurrent marker does not start on every round.
  let churnWallMs = 0;
  let churnCpuMs = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const wall0 = performance.now();
    const cpu0 = cpuMs();
    churn(400_000);
    const wall = performance.now() - wall0;
    const cpu = cpuMs() - cpu0;
    if (wall > 0 && cpu / wall > (churnWallMs > 0 ? churnCpuMs / churnWallMs : 0)) {
      churnWallMs = wall;
      churnCpuMs = cpu;
    }
  }

  const failures: string[] = [];
  if (smallCpuMs < RESOLUTION_CONTROL_FLOOR_MS) {
    failures.push(
      `it cannot resolve a slice: ${smallCpuMs.toFixed(3)} ms for a megaflop, under the ` +
        `${RESOLUTION_CONTROL_FLOOR_MS} ms floor`,
    );
  }
  if (bigCpuMs < smallCpuMs * SCALING_CONTROL_FLOOR) {
    failures.push(
      `it does not scale with work: ${bigCpuMs.toFixed(2)} ms for four megaflops against ` +
        `${smallCpuMs.toFixed(2)} ms for one, under the ${SCALING_CONTROL_FLOOR}x floor`,
    );
  }
  if (idleWallMs < CONTROL_SLEEP_MS * 0.5) {
    failures.push(`the idle probe never slept: ${idleWallMs.toFixed(1)} ms of wall clock`);
  } else if (idleCpuMs > idleWallMs * IDLE_CONTROL_CEILING) {
    failures.push(
      `it keeps running while the thread sleeps: ${idleCpuMs.toFixed(2)} ms charged for ` +
        `${idleWallMs.toFixed(1)} ms of Atomics.wait`,
    );
  }
  if (churnWallMs > 0 && churnCpuMs > churnWallMs * THREAD_LOCAL_CONTROL_CEILING) {
    failures.push(
      `it is not this thread's clock: ${churnCpuMs.toFixed(1)} ms charged over a ` +
        `${churnWallMs.toFixed(1)} ms allocation churn, which one thread cannot have done`,
    );
  }

  return {
    usable: failures.length === 0,
    smallCpuMs,
    bigCpuMs,
    idleWallMs,
    idleCpuMs,
    churnWallMs,
    churnCpuMs,
    failures,
  };
};

const cpuClock = controlOfCpuClock();
said.push(
  `CPU clock control: ${cpuClock.smallCpuMs.toFixed(2)} ms for one megaflop and ` +
    `${cpuClock.bigCpuMs.toFixed(2)} ms for four; ${cpuClock.idleCpuMs.toFixed(2)} ms for ` +
    `${cpuClock.idleWallMs.toFixed(1)} ms of descheduled sleep; ${cpuClock.churnCpuMs.toFixed(1)} ms ` +
    `over a ${cpuClock.churnWallMs.toFixed(1)} ms allocation churn — ` +
    `${cpuClock.usable ? 'usable' : `NOT USABLE (${cpuClock.failures.join('; ')})`}`,
);

/**
 * The part of a wall-clock span the process can be **shown** to have computed.
 *
 * This is what every ceiling below is compared against. With the instrument
 * controlled it is `min(wall, cpu)`; without it, the old raw wall clock, so a
 * runtime whose CPU clock cannot be trusted gets the pre-#606 check rather than
 * a check that passes everything.
 */
const busyMsOf = (wallMs: number, cpuDeltaMs: number): number =>
  cpuClock.usable ? Math.min(wallMs, cpuDeltaMs) : wallMs;

/**
 * What the number `busyMsOf` returned actually is, in words.
 *
 * Every message that quotes one says which, because on the fallback path it is
 * plain wall clock and a message calling that "attested CPU time" would be this
 * file's own disease: an assertion reporting something it is not describing.
 */
const BUSY_LABEL = cpuClock.usable
  ? 'attested busy time'
  : 'wall clock (the CPU clock failed its control, so there is no attestation)';

/** What the gates stopped prosecuting, so the run can say so out loud. */
const clearedAsDescheduled: { count: number; worstWallMs: number; worstBusyMs: number; where: string }[] =
  [];
const noteCleared = (label: string, wallMs: number, busyMs: number): void => {
  const existing = clearedAsDescheduled.find((entry) => entry.where === label);
  if (existing) {
    existing.count += 1;
    if (wallMs > existing.worstWallMs) {
      existing.worstWallMs = wallMs;
      existing.worstBusyMs = busyMs;
    }
    return;
  }
  clearedAsDescheduled.push({ count: 1, worstWallMs: wallMs, worstBusyMs: busyMs, where: label });
};

// ---------------------------------------------------------------------------
// The event loop's own lateness. A 2 ms timer that fires 40 ms late was blocked
// for 38 ms, and a blocked main thread is precisely what a dropped frame is.
// This sees work that `advance()` does not — above all a dynamic import's
// module evaluation, which is where the boundary's ~55 ms and the train's own
// ~157 ms actually get spent. (The train's figure is its own cost, measured by
// importing its dependencies first; imported cold it also carries the cruiser's
// ~1.3 s, which is the misreading behind issue #252.)
// ---------------------------------------------------------------------------
//
// Attested the same way as a slice (#606): the gap between two ticks is wall
// clock, and a gap the process spent descheduled is the machine's, not the
// park's. `worstBlockMs` stays the raw number — it is printed, and a reader
// wants to know the loop really did go quiet — while `worstBusyBlockMs` is the
// part of it the process can be shown to have been computing through, and that
// is the one the ceiling prosecutes.
const LAG_INTERVAL_MS = 2;
let worstBlockMs = 0;
let worstBusyBlockMs = 0;
let worstBusyBlockWallMs = 0;
let blockedOver16 = 0;
let lastTick = performance.now();
let lastTickCpu = cpuMs();
const lagTimer = setInterval(() => {
  const now = performance.now();
  const nowCpu = cpuMs();
  const blocked = now - lastTick - LAG_INTERVAL_MS;
  const busy = busyMsOf(blocked, nowCpu - lastTickCpu);
  if (blocked > worstBlockMs) worstBlockMs = blocked;
  if (busy > worstBusyBlockMs) {
    worstBusyBlockMs = busy;
    worstBusyBlockWallMs = blocked;
  }
  if (blocked > 16.7) blockedOver16 += 1;
  lastTick = now;
  lastTickCpu = nowCpu;
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
let worstBusyAdvanceMs = 0;
let totalAdvanceMs = 0;
let totalAdvanceCpuMs = 0;
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
//
// **And it asks the scheduler for EVERY task, not the five that carry floors
// (#606).** This loop used to walk `PHASES`, which is the five phases with
// piece-count floors below — so a slice spent in the path graph, the rail race
// or the crossings was faithfully reported as **"no generator step at all, 0
// work units"**. Three of the seven worst slices on the runs that opened #606
// said exactly that, and the issue reasonably read it as the process having
// been descheduled. It was not: it was a task this driver could not see. A
// diagnosis that names the wrong cause is worse than one that names none, so
// the attribution now comes from `sliceCountsByTask` — one owner, and a task
// added tomorrow is named the day it exists.
/** Slices seen so far, per scheduler task — the delta across one `advance()`. */
const unitsSeen: Record<string, number> = {};

/**
 * Which tasks moved across one `advance()`, from the scheduler's own counts.
 *
 * Mutates `seen` to the new totals, so it is called exactly once per slice.
 */
const tasksThatMoved = (
  counts: Readonly<Record<string, number>>,
  seen: Record<string, number>,
): { steps: number; key: string; label: string } => {
  let steps = 0;
  const moved: string[] = [];
  const labels: string[] = [];
  for (const [task, count] of Object.entries(counts)) {
    const done = count - (seen[task] ?? 0);
    seen[task] = count;
    if (done > 0) {
      steps += done;
      moved.push(task);
      labels.push(`${task} x${done}`);
    }
  }
  if (moved.length === 0) {
    return { steps: 0, key: 'no scheduler slice at all', label: 'no scheduler slice at all' };
  }
  return { steps, key: [...moved].sort().join(' + '), label: labels.join(' + ') };
};
type SliceRecord = {
  /** Wall clock the `advance()` took. */
  ms: number;
  /** The part of it the process can be shown to have computed — `busyMsOf`. */
  busyMs: number;
  /**
   * **The tasks that moved in this slice, sorted and joined — not a guess at
   * which one hit the deadline.**
   *
   * More than one task may move in a single `advance()`: a task finishing
   * mid-budget hands the rest of the frame to the next runnable one. The
   * comment here used to claim this named "the LAST phase that moved ... the
   * one that ran up against the deadline", and it did not: it named whichever
   * task the scheduler happened to register last, which is an artefact of
   * declaration order and nothing to do with the deadline. Slice counts cannot
   * tell you execution order, so the honest label is the whole set, and the
   * honest grouping key is the whole set too — a task's slices group together
   * consistently, which is all the corroboration below needs.
   */
  key: string;
  /** Every task that moved, with its unit count, for the diagnosis. */
  phase: string;
  steps: number;
  stage: string;
};
let worstSlice: SliceRecord = {
  ms: 0,
  busyMs: 0,
  key: 'no scheduler slice at all',
  phase: 'no scheduler slice at all',
  steps: 0,
  stage: 'waiting',
};
/** The worst slice by *wall clock*, kept separately so both can be printed. */
let worstWallSlice: SliceRecord = { ...worstSlice };
/**
 * Every slice of the run, kept so the ceiling can ask a question about the
 * *distribution* rather than about one sample — see `MIN_CORROBORATING_SLICES`.
 */
const slices: SliceRecord[] = [];
const startedAt = performance.now();
const startedAtCpu = cpuMs();

lastTick = performance.now();
lastTickCpu = cpuMs();
while (!generation.ready && !generation.failed && frames < MAX_FRAMES) {
  const stage = generation.stage;
  const beforeCpu = cpuMs();
  const before = performance.now();
  generation.advance(GENERATION_BUDGET_MS);
  const spent = performance.now() - before;
  const cpuSpent = cpuMs() - beforeCpu;
  const busy = busyMsOf(spent, cpuSpent);
  frames += 1;
  totalAdvanceMs += spent;
  totalAdvanceCpuMs += cpuSpent;
  const { steps, key, label } = tasksThatMoved(generation.sliceCountsByTask, unitsSeen);
  const record = { ms: spent, busyMs: busy, key, phase: label, steps, stage };
  slices.push(record);
  if (spent > worstAdvanceMs) {
    worstAdvanceMs = spent;
    worstWallSlice = record;
  }
  if (busy > worstBusyAdvanceMs) {
    worstBusyAdvanceMs = busy;
    worstSlice = record;
  }
  if (spent > 1) framesThatBlockedMeasurably += 1;
  await nextFrame();
}
const wallClockMs = performance.now() - startedAt;
const totalRunCpuMs = cpuMs() - startedAtCpu;
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
  `worst single advance() ${worstBusyAdvanceMs.toFixed(1)} ms of ${BUSY_LABEL} against a ` +
    `${GENERATION_BUDGET_MS} ms budget; ${framesThatBlockedMeasurably} frames did over a ` +
    'millisecond of work',
);
said.push(
  `that worst slice was ${worstSlice.phase}, ${worstSlice.steps} work units in ` +
    `${worstSlice.busyMs.toFixed(1)} ms busy of ${worstSlice.ms.toFixed(1)} ms wall, ` +
    `during "${worstSlice.stage}"`,
);
said.push(
  `worst single advance() by WALL clock ${worstAdvanceMs.toFixed(1)} ms — ` +
    `${worstWallSlice.phase}, ${worstWallSlice.steps} work units, ` +
    `${worstWallSlice.busyMs.toFixed(1)} ms of it attested busy (the rest was this box, not the park)`,
);
said.push(
  `worst the event loop was blocked: ${worstBlockMs.toFixed(1)} ms wall, worst attested busy ` +
    `${worstBusyBlockMs.toFixed(1)} ms (of a ${worstBusyBlockWallMs.toFixed(1)} ms gap), ` +
    `over one 60 Hz frame on ${blockedOver16} occasions`,
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
 * has no cold start worth speaking of after its own warm-up pass. Its body is
 * `spin()` above — the same arithmetic the CPU-clock control uses, so there is
 * one owner of the loop rather than two copies to keep in step.
 *
 * **And it is timed the same way the slices are (#606).** A ruler read off a
 * wall clock measures the box *and whatever else the box is doing*: the runs
 * that failed this check read 1.80-1.99x on a laptop that reads 1.00x idle,
 * which inflated the ceiling on exactly the runs that then failed anyway. Best
 * of three took the edge off and could not remove it, because contention is not
 * a constant factor. Attested busy time is a question about the machine alone.
 */
function msPerMegaflop(): number {
  const run = (): number => {
    const startedCpu = cpuMs();
    const started = performance.now();
    // Consumed so no engine can fold the loop away.
    spin(1_000_000);
    return busyMsOf(performance.now() - started, cpuMs() - startedCpu);
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
  `this box runs the calibration loop in ${calibrationMs.toFixed(2)} ms of ${BUSY_LABEL} ` +
    `against the reference ${REFERENCE_CALIBRATION_MS.toFixed(2)} ms — ${slowness.toFixed(2)}x`,
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
//
// **And what it is compared against is attested busy time, not wall clock
// (#606).** The paragraphs above are the history of trying to make a wall clock
// answer a question about work: a constant in milliseconds twice blocked main's
// deploy, and scaling it by the box's speed fixed the "uniformly slower box"
// half while leaving the other half — a box that deschedules one slice for 30
// ms. Three of the seven worst slices recorded on the failing runs did **zero
// work units**, which no budget for the cost of a work unit can be blown by.
// `busyMsOf` drops that stall out of the number before it is compared, so a
// slice is prosecuted for the work it did and nothing else. A genuinely fat
// unit is unaffected: it spends the CPU it costs, so its busy time is its wall
// time, and the ceiling meets it exactly as before.
//
// **Proved every way round on 11 September 2026, by mutation, on a laptop
// carrying four other agents** — which is the box this check kept failing on,
// so the numbers are from the hard case rather than the easy one. The mutations
// are written out in full because a red-run transcript is a measurement and
// measurements go stale: repeat these exactly, or the numbers say nothing about
// the check as it stands then.
//
// *Mutation A — a unit that is genuinely too big.* In `parkGeneration.ts`'s
// `brief` task, immediately before `yield step.value`, a **fixed** 20-million
// iteration burn per unit (fixed, not a wall-clock-bounded spin: a time-bounded
// one does less work on a slow box and is therefore not the regression this
// guards against — the first attempt at this mutation made that mistake and
// slipped under a ceiling that had scaled to 2.08x):
//
//     let x = 1.000001; let sum = 0;
//     for (let i = 0; i < 20_000_000; i += 1) { x = x * 1.0000001 + 1e-9; sum += Math.sqrt(x) * 0.5; }
//     if (!Number.isFinite(sum)) throw new Error('mutation diverged');
//
// → **exit 1**: `151 slices of "brief" went past the ceiling, worst 91.6 ms of
// attested busy time (141.2 ms wall) against a 8 ms budget and a 28.6 ms
// ceiling already scaled 1.72x`. Note 151 of 152 — a fat unit is fat on every
// slice that runs it, which is exactly what the corroboration clause is for.
//
// *Mutation B — the machine takes the CPU away.* The same place, once only:
//
//     Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
//
// → **exit 0**, with `worst single advance() by WALL clock 47.0 ms — brief x1,
// 1 work units, 1.7 ms of it attested busy`, and two stderr notes naming the
// cleared spans. The **control** is the pre-#606 copy of this file run against
// the identical mutated generator: **exit 1**, twice — `one advance() blocked
// for 50.8 ms against a ... 20.0 ms ceiling` and `one advance() at the 12 ms
// overrun budget blocked for 42.9 ms`. Issue #606 in one pair of runs.
//
// *Mutation D — the same burn in a task that runs ONCE.* The review finding on
// #615: `roadCorridor` commits in a single `advance()` by design, so put
// mutation A's identical burn in its generator instead, before
// `self.claims.commit(module.ROAD_FEATURE, ...)`:
//
// → **exit 1**, both ceilings, `1 of the 1 slices of "pathGraph + roadCorridor"
// went past the ceiling, worst 36.9 ms of attested busy time (53.0 ms wall)
// against a 8 ms budget and a 22.2 ms ceiling already scaled 1.18x`. Under the
// count-only clause this branch shipped for a day it was **exit 0** at 44.5 ms
// against a 25.2 ms ceiling, while `main` caught it — a measured coverage
// regression, which is what the exhaustive clause exists to close.
//
// *Mutation E — the control on D.* Replace that burn with a 40 ms
// `Atomics.wait` in the same once-only slice, the case where an exhaustive
// clause could wrongly prosecute a stall: **exit 0**, `worst single advance()
// by WALL clock 48.2 ms — pathGraph x9 + roadCorridor x1, 10 work units, 2.3 ms
// of it attested busy`. The two clauses are independent — attestation clears
// the stall before the breach set is built, so "every slice of a once-only
// task" never becomes a back door for the flakiness #606 was about.
//
// *Mutation C — the instrument itself.* Swap `process.threadCpuUsage()` for
// `process.cpuUsage()` in `cpuMs` and the control rejects it by name: `it is
// not this thread's clock: 56.4 ms charged over a 28.8 ms allocation churn,
// which one thread cannot have done`. With mutation A also in place that run is
// **exit 1** on raw wall clock — `151 slices of "brief" ... worst 216.1 ms of
// wall clock (the CPU clock failed its control, so there is no attestation)` —
// so the fallback is a live path that still prosecutes a real fault, not a
// comforting sentence.
const WORST_UNIT_GRACE_MS = 12;
const ADVANCE_CEILING_MS = GENERATION_BUDGET_MS + WORST_UNIT_GRACE_MS * slowness;
said.push(
  `so one slice may spend ${ADVANCE_CEILING_MS.toFixed(1)} ms of ${BUSY_LABEL} ` +
    `(${GENERATION_BUDGET_MS} ms budget + ${WORST_UNIT_GRACE_MS} ms of grace x ${slowness.toFixed(2)})`,
);
if (worstAdvanceMs > ADVANCE_CEILING_MS && worstBusyAdvanceMs <= ADVANCE_CEILING_MS) {
  noteCleared('advance() at the rolling budget', worstAdvanceMs, worstWallSlice.busyMs);
}

// ---------------------------------------------------------------------------
// **A breach has to happen more than once, to the same task, before it is a
// foul — because the fault it is looking for is reproducible and an outlier is
// not.**
//
// `busyMsOf` removes the deschedule, and `process.threadCpuUsage()` removes the
// background threads — but a main-thread garbage collection landing inside one
// slice is still charged to it, correctly (the game pays that too) and
// unpredictably. That is precisely the distortion this file already records as
// unavoidable: "room for a garbage collection landing inside a slice, which is
// real ... and which no amount of correct code prevents".
//
// One sample cannot tell such a slice from a unit that is genuinely too big.
// The distribution can. The park is deterministic, so a unit that is too big is
// too big **every time that unit runs** — mutation A below breached on all 152
// of the `brief` task's slices — while a GC or a contention artefact lands on
// one slice and is somewhere else next run. So the gate asks for corroboration:
// two or more slices of the same task over the ceiling. That is a question
// about work, and it is the difference between a check and a coin toss.
//
// Measured on a box carrying four other agents, three runs, unmutated: **zero
// breaches on any task**, so the corroboration rule is a second line of defence
// here rather than the thing doing the work. It earned its place under the
// weaker `process.cpuUsage()` instrument, where `pathGraph` breached once per
// run on every run — and it is kept because it is the clause that says what
// kind of fault this check is for.
//
// **What it therefore cannot catch, and this is announced on every run:** a
// single unit that is dear *on its own*, where the task runs it once — the
// castle-window carve is the real example. That was never caught here anyway
// (this file's own note: "making the slide's satisfies five times dearer is not
// caught ... it sits just inside"), and `check:solve-cost` owns per-unit cost.
// What is new is that the gap is now stated rather than implied.
const MIN_CORROBORATING_SLICES = 2;

type Breach = { count: number; total: number; worst: SliceRecord };

/**
 * Which task groups broke `ceilingMs`, and whether the breach is corroborated.
 *
 * Corroborated means **repeated, or exhaustive**: two or more slices of the
 * group, *or* every slice the group has. The second clause is what makes a
 * once-only task catchable, and it is not a softening — a task that runs one
 * slice and blows the ceiling on it has breached on 100% of the slices it will
 * ever run, which is exactly the evidence the first clause asks for from a task
 * that runs many.
 */
const breachesIn = (records: readonly SliceRecord[], ceilingMs: number): Map<string, Breach> => {
  const totals = new Map<string, number>();
  for (const slice of records) totals.set(slice.key, (totals.get(slice.key) ?? 0) + 1);
  const found = new Map<string, Breach>();
  for (const slice of records) {
    if (slice.busyMs <= ceilingMs) continue;
    const existing = found.get(slice.key);
    if (!existing) {
      found.set(slice.key, { count: 1, total: totals.get(slice.key) ?? 1, worst: slice });
    } else {
      existing.count += 1;
      if (slice.busyMs > existing.worst.busyMs) existing.worst = slice;
    }
  }
  return found;
};

const isCorroborated = (breach: Breach): boolean =>
  breach.count >= MIN_CORROBORATING_SLICES || breach.count === breach.total;

const breaches = breachesIn(slices, ADVANCE_CEILING_MS);
const corroborated = [...breaches.entries()].filter(([, breach]) => isCorroborated(breach));
for (const [task, breach] of breaches) {
  if (isCorroborated(breach)) continue;
  process.stderr.write(
    `check:park-boot NOTE: ${breach.count} slice(s) of "${task}" went past the ` +
      `${ADVANCE_CEILING_MS.toFixed(1)} ms ceiling — worst ${breach.worst.busyMs.toFixed(1)} ms busy of ` +
      `${breach.worst.ms.toFixed(1)} ms wall, ${breach.worst.steps} work unit(s) — and were NOT ` +
      `prosecuted, because that is ${breach.count} of the ${breach.total} slices that group ran, ` +
      'and one sample cannot tell a unit that is too big from a garbage collection landing inside ' +
      'one slice. A unit that is genuinely too big breaches on every slice that runs it; ' +
      `${MIN_CORROBORATING_SLICES}, or all of them, would have been a foul (issue #606). If you ` +
      'see this line run after run, naming the same task, that is the check telling you it IS the ' +
      'code.\n',
  );
}
if (corroborated.length > 0) {
  const [task, breach] = corroborated.sort((a, b) => b[1].worst.busyMs - a[1].worst.busyMs)[0]!;
  fouls.push(
    `${breach.count} of the ${breach.total} slices of "${task}" went past the ceiling, worst ` +
      `${breach.worst.busyMs.toFixed(1)} ms of ${BUSY_LABEL} (${breach.worst.ms.toFixed(1)} ms ` +
      `wall) against a ${GENERATION_BUDGET_MS} ms budget and a ${ADVANCE_CEILING_MS.toFixed(1)} ms ` +
      `ceiling already scaled ${slowness.toFixed(2)}x for this box's speed. ` +
      (cpuClock.usable
        ? 'Attested busy time does not advance while the process is descheduled, so this is NOT a '
        : 'NOTE that with no attestation this is raw wall clock, so a descheduled slice can reach it — ') +
      (cpuClock.usable ? 'loaded machine either. ' : 'fix the CPU clock reading before reading further. ') +
      (breach.count >= MIN_CORROBORATING_SLICES
        ? `And it happened ${breach.count} times to the same task, so it is not one unlucky slice either: `
        : 'And it happened on EVERY slice that group ran, so it is not one unlucky slice either: ') +
      `a unit that is too big is too big every time it runs. That worst one did ` +
      `${breach.worst.steps} work unit(s) (${breach.worst.phase}) during ` +
      `"${breach.worst.stage}" — if it got through hundreds of work units it merely spent its budget ` +
      `and something else is wrong; if it got through one or two, that unit is too big to be a ` +
      `unit. Profile it with \`generation.advance(0)\`, which makes every drive loop do exactly ` +
      `one step so the slice time IS the unit cost. Do not raise the ceiling: it stutters the ` +
      `orbit on a phone whatever CI says`,
  );
}

// ---------------------------------------------------------------------------
// The same question asked in units of WORK rather than of time.
//
// **Why this exists, and why it is the load-bearing half.** The assertion above
// is a clock, so even now it is partly a question about the machine that ran
// it: this check passed on an M4 Pro at 18 ms and failed on a CI runner at 54.6
// ms with identical code. Since #606 it is charged only for work the process
// can be shown to have done, and scaled by the box's measured speed, which
// removes the *load* half of that — but a genuinely slow device still spends
// more wall clock on the same unit, and no clock can be told otherwise. Neither box is the one that matters — Eleri plays on a phone,
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
// that the driver takes the first chance to stop. The busy-time ceiling above
// is kept as the secondary observation that catches a unit growing *more
// expensive*, which these counts would not notice — and it is scaled by this
// box's own measured speed and charged only for attested work (#606), so that
// half is a question about the code too.
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
//
// Prosecuted on attested busy time (#606), like every other ceiling here: an
// event loop that went quiet because the OS took the CPU away is not a module
// evaluation hogging it, and only the second is something a commit can cause.
const BLOCK_CEILING_MS = 250;
if (worstBlockMs > BLOCK_CEILING_MS && worstBusyBlockMs <= BLOCK_CEILING_MS) {
  noteCleared('the event loop between two 2 ms ticks', worstBlockMs, worstBusyBlockMs);
}
if (worstBusyBlockMs > BLOCK_CEILING_MS) {
  fouls.push(
    `the main thread was busy for ${worstBusyBlockMs.toFixed(0)} ms in one go ` +
      `(${worstBusyBlockWallMs.toFixed(0)} ms of wall clock) — that is ` +
      `${(worstBusyBlockMs / 16.7).toFixed(0)} dropped frames, and a hitch in the orbit is a failure ` +
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
//
// Attested too (#606). `wallClock - advance` on a contended box carries every
// millisecond the process spent waiting for a core, which is not generation at
// all; `busyMsOf` keeps only the part it can be shown to have computed, and the
// module evaluations this exists to catch are pure computation.
const outsideAdvanceMs = wallClockMs - totalAdvanceMs;
const outsideAdvanceCpuMs = Math.max(0, totalRunCpuMs - totalAdvanceCpuMs);
const loopOverheadMs = perFrameOverheadMs * frames;
const unbudgetedWallMs = Math.max(0, outsideAdvanceMs - loopOverheadMs);
const unbudgetedMs = Math.max(0, busyMsOf(outsideAdvanceMs, outsideAdvanceCpuMs) - loopOverheadMs);
said.push(
  `${unbudgetedMs.toFixed(0)} ms of generation happened outside a budgeted slice ` +
    `(${outsideAdvanceMs.toFixed(0)} ms outside advance() against ${outsideAdvanceCpuMs.toFixed(0)} ms ` +
    `of thread CPU over the same span — the lesser of the two, less ${loopOverheadMs.toFixed(0)} ms ` +
    `of this check's own frame loop: ${frames} frames x ${perFrameOverheadMs.toFixed(3)} ms)`,
);
const UNBUDGETED_CEILING_MS = 1000;
if (unbudgetedWallMs > UNBUDGETED_CEILING_MS && unbudgetedMs <= UNBUDGETED_CEILING_MS) {
  noteCleared('generation outside a budgeted slice', unbudgetedWallMs, unbudgetedMs);
}
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
  /** Per-task, exactly as the rolling loop — see `breachesIn`. */
  const overrunSlices: SliceRecord[] = [];
  const overrunUnitsSeen: Record<string, number> = {};
  let worst = 0;
  let worstWall = 0;
  let overrunFrames = 0;
  while (!overrunGen.ready && !overrunGen.failed && overrunFrames < MAX_FRAMES) {
    const stage = overrunGen.stage;
    const beforeCpu = cpuMs();
    const before = performance.now();
    overrunGen.advance(OVERRUN_GENERATION_BUDGET_MS);
    const wall = performance.now() - before;
    // Attested busy time, exactly as the rolling budget above (#606): this
    // ceiling is one 60 Hz refresh plus a unit's grace, so it is the *tightest*
    // in the file and the one a 30 ms deschedule reddens most easily.
    const spent = busyMsOf(wall, cpuMs() - beforeCpu);
    const { steps, key, label } = tasksThatMoved(overrunGen.sliceCountsByTask, overrunUnitsSeen);
    advances.push(spent);
    overrunSlices.push({ ms: wall, busyMs: spent, key, phase: label, steps, stage });
    if (spent > worst) worst = spent;
    if (wall > worstWall) worstWall = wall;
    overrunFrames += 1;
    await nextFrame();
  }
  const sorted = [...advances].sort((a, b) => a - b);
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(0.99 * sorted.length))] ?? 0;
  const overRefresh = advances.filter((a) => a > FRAME_MS).length;
  const OVERRUN_ADVANCE_CEILING_MS = FRAME_MS + WORST_UNIT_GRACE_MS * slowness;
  said.push(
    `overrun budget ${OVERRUN_GENERATION_BUDGET_MS} ms: ${overrunFrames} frames, worst advance ` +
      `${worst.toFixed(1)} ms busy (${worstWall.toFixed(1)} ms wall), p99 ${p99.toFixed(1)} ms, ` +
      `${overRefresh} over one 60 Hz refresh (${FRAME_MS.toFixed(1)} ms)`,
  );
  said.push(
    `so one looping-overrun slice may spend ${OVERRUN_ADVANCE_CEILING_MS.toFixed(1)} ms of ${BUSY_LABEL} ` +
      `(one refresh + ${WORST_UNIT_GRACE_MS} ms of grace x ${slowness.toFixed(2)})`,
  );
  if (!overrunGen.ready) {
    fouls.push(
      `generation never finished at the ${OVERRUN_GENERATION_BUDGET_MS} ms overrun budget in ` +
        `${overrunFrames} frames — the looping bus would drive forever`,
    );
  }
  if (worstWall > OVERRUN_ADVANCE_CEILING_MS && worst <= OVERRUN_ADVANCE_CEILING_MS) {
    noteCleared('advance() at the overrun budget', worstWall, worst);
  }
  // Corroborated the same way as the rolling ceiling above (#606) — **per task
  // group, and exhaustively**, not as a bare count across the whole run. A bare
  // count was the review finding on #615: `roadCorridor` runs one unit in one
  // advance by design ("the task is one commit", and it is the first production
  // placer, so that shape is the growth path rather than an oddity), so a fat
  // unit there produces exactly one breach out of a hundred-odd overrun slices
  // and a plain `count >= 2` let it straight through.
  const overrunBreaches = breachesIn(overrunSlices, OVERRUN_ADVANCE_CEILING_MS);
  const overrunCorroborated = [...overrunBreaches.entries()].filter(([, breach]) =>
    isCorroborated(breach),
  );
  for (const [task, breach] of overrunBreaches) {
    if (isCorroborated(breach)) continue;
    process.stderr.write(
      `check:park-boot NOTE: ${breach.count} slice(s) of "${task}" at the ` +
        `${OVERRUN_GENERATION_BUDGET_MS} ms overrun budget went past the ` +
        `${OVERRUN_ADVANCE_CEILING_MS.toFixed(1)} ms ceiling — worst ` +
        `${breach.worst.busyMs.toFixed(1)} ms busy of ${breach.worst.ms.toFixed(1)} ms wall — and ` +
        `were NOT prosecuted, being ${breach.count} of the ${breach.total} slices that group ran ` +
        '(issue #606).\n',
    );
  }
  if (overrunCorroborated.length > 0) {
    const [task, breach] = overrunCorroborated.sort(
      (a, b) => b[1].worst.busyMs - a[1].worst.busyMs,
    )[0]!;
    fouls.push(
      `${breach.count} of the ${breach.total} slices of "${task}" at the ` +
        `${OVERRUN_GENERATION_BUDGET_MS} ms overrun budget were busy for up to ` +
        `${breach.worst.busyMs.toFixed(1)} ms against a ${OVERRUN_ADVANCE_CEILING_MS.toFixed(1)} ms ceiling ` +
        `(one 60 Hz refresh + grace, scaled ${slowness.toFixed(2)}x for this box). The bus is MOVING ` +
        'through the overrun now, so a frame that blocks this long jumps the bus, the camera and the ' +
        'countryside across — the judder Jim reported. The overrun budget is too large for a moving ' +
        'shot: bias it toward smoothness (near the rolling budget), do not drain flat-out',
    );
  }

}

// ---------------------------------------------------------------------------
// **What this run did NOT prosecute, said out loud, on every run.**
//
// Since #606 the four wall-clock ceilings above are compared against attested
// busy time, which is deliberately *less* coverage than raw wall clock: a slice
// that blocked for 30 ms while the OS had the CPU elsewhere is now cleared,
// because a generator-step budget cannot be blown by a step that did not run.
// That is the right trade — the alternative is a gate that reddens on the
// machine's mood — but it is a trade, and a gate that quietly stopped
// prosecuting something is how the next reader inherits a false belief.
//
// So every run says which spans were cleared and by how much, and says it on
// `process.stderr`, because `console.log` from a passing run is exactly the
// output nobody sees.
//
// It also says when the *instrument* failed its control, in which case there is
// no attestation at all and every ceiling is back on raw wall clock — the
// pre-#606 behaviour, flakiness included. That is loud on purpose.
if (!cpuClock.usable) {
  process.stderr.write(
    'check:park-boot NOTE: this runtime\'s CPU clock failed its control — ' +
      `${cpuClock.failures.join('; ')}. ` +
      'Every ceiling in this run was therefore compared against RAW WALL CLOCK, ' +
      'so a busy machine can redden it for reasons no commit caused (issue #606). Fix the clock ' +
      'reading, do not raise the ceilings.\n',
  );
} else {
  // The standing coverage statement: what this check structurally does not
  // assert, printed whether or not it bit this run, so nobody has to infer it
  // from a quiet green line.
  process.stderr.write(
    'check:park-boot NOTE: this check does NOT assert on (a) a slice whose wall clock overran ' +
      'while the process was descheduled, nor (b) a lone slice over the ceiling in a task group ' +
      'that ran others inside it. (a) is not work the park did; (b) cannot be told from a garbage ' +
      'collection landing inside one slice. A unit that is genuinely too big breaches on every ' +
      `slice that runs it, so ${MIN_CORROBORATING_SLICES} slices — OR every slice a group ran, ` +
      'which is how a once-only task like roadCorridor is caught — is a foul here (issue #606).\n',
  );
  for (const cleared of clearedAsDescheduled) {
    process.stderr.write(
      `check:park-boot NOTE: ${cleared.count} span(s) of ${cleared.where} went past the ceiling on ` +
        `wall clock and were NOT prosecuted, because the process was descheduled rather than ` +
        `working — worst ${cleared.worstWallMs.toFixed(1)} ms wall, of which only ` +
        `${cleared.worstBusyMs.toFixed(1)} ms was attested busy. This check does not assert on ` +
        'those; a generator-step budget cannot be blown by a step that did not run (issue #606).\n',
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
