/**
 * **A CPU clock you are allowed to trust, and the control that earns it.**
 *
 * Extracted from `check-park-boot.mts` when `check-solve-cost.mts` became the
 * **second** check to need it. Both had the same disease and `check:park-boot`
 * had already cured it: a wall-clock budget on a machine shared with a dozen
 * agents is non-deterministic by construction, because a descheduled process
 * is charged for time it did not compute in. `check:solve-cost` read 260.3 ms
 * against a 250 ms budget once, at load average 14.82, and 96.6 / 98.0 / 99.3
 * ms when the box was quiet — the same commit, six readings, one red.
 *
 * Copying the instrument across would have been this project's most common bug
 * (CLAUDE.md, "Two definitions of one thing, kept in step by hand"): the
 * `threadCpuUsage`-not-`cpuUsage` distinction below was found by measurement
 * and is exactly the sort of hard-won number that drifts when it lives in two
 * files. One owner; both checks ask.
 *
 * Everything from here to the end of `controlOfCpuClock` is verbatim from
 * `check-park-boot.mts`, prose included, because the prose *is* the finding.
 */
import { performance } from 'node:perf_hooks';

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
export const cpuMs = (): number => {
  const used = process.threadCpuUsage();
  return (used.user + used.system) / 1000;
};

/** Deterministic arithmetic, no allocation: real work for a known duration. */
export const spin = (iterations: number): number => {
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
export const churn = (rounds: number): number => {
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

export type ClockControl = {
  usable: boolean;
  smallCpuMs: number;
  bigCpuMs: number;
  idleWallMs: number;
  idleCpuMs: number;
  churnWallMs: number;
  churnCpuMs: number;
  failures: string[];
};

export const controlOfCpuClock = (): ClockControl => {
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

/**
 * The part of a wall-clock span the process can be **shown** to have computed.
 *
 * With the instrument controlled it is `min(wall, cpu)`; without it, raw wall
 * clock — so a runtime whose CPU clock cannot be trusted gets the old, flaky
 * check rather than a check that passes everything.
 */
export const busyMsOf = (control: ClockControl, wallMs: number, cpuDeltaMs: number): number =>
  control.usable ? Math.min(wallMs, cpuDeltaMs) : wallMs;

/**
 * What the number `busyMsOf` returned actually is, in words.
 *
 * Every message that quotes one says which, because on the fallback path it is
 * plain wall clock and a message calling that "attested CPU time" would be the
 * disease both these checks exist to catch: an assertion reporting something it
 * is not describing.
 */
export const busyLabel = (control: ClockControl): string =>
  control.usable
    ? 'attested busy time'
    : 'wall clock (the CPU clock failed its control, so there is no attestation)';

/** The control's own readings, for the transcript, so a reader can judge the instrument. */
export const describeControl = (control: ClockControl): string =>
  `CPU clock control: ${control.smallCpuMs.toFixed(2)} ms for one megaflop and ` +
  `${control.bigCpuMs.toFixed(2)} ms for four; ${control.idleCpuMs.toFixed(2)} ms for ` +
  `${control.idleWallMs.toFixed(1)} ms of descheduled sleep; ${control.churnCpuMs.toFixed(1)} ms ` +
  `over a ${control.churnWallMs.toFixed(1)} ms allocation churn — ` +
  `${control.usable ? 'usable' : `NOT USABLE (${control.failures.join('; ')})`}`;
