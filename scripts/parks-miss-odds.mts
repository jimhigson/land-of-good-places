/**
 * **The odds that a cold Parks run misses its cap — computed, not hoped.**
 *
 * ```
 * node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/parks-miss-odds.mts
 * ```
 *
 * A cold run (`parks.yml`, no cached parks) must find every seed's lowest
 * accepted restart inside the job's `timeout-minutes`. Whether it does is a
 * matter of chance — each restart is an independent draw that the acceptance
 * measures pass with probability `p` — so "it went green" says little. This
 * prints the probability, per cold run, that some seed of the sixteen misses:
 *
 * - **one runner per seed** (the layout before #708): restarts in order, four
 *   lanes at a time, until one is accepted or the job's clock runs out —
 *   simulated, with attempt times drawn from those measured on CI;
 * - **seed x block** (`parks.yml` now): blocks of four restarts, each one round
 *   on its own runner; stage A blocks 0-1 for every seed, stage B blocks 2-15
 *   for the seeds stage A did not accept. A seed misses only when all of its
 *   blocks' restarts are rejected, or a single round outruns the clock.
 *
 * `p` is taken at the **lower end** of what was measured, so the odds printed
 * are pessimistic. The inputs are below, each with where it was measured.
 */

/**
 * Share of attempts accepted (build failures count as rejections): 30 of
 * 123 attempts CI logged at 9de53b82, the first cold run of the
 * seed x block matrix, with the step cap (run 37216428224). Earlier, without
 * the cap: 30 of 107 at 52aa270d; base #706 19 of 64.
 */
const ACCEPTED = 30;
const ATTEMPTS = 123;

/** Wilson score lower bound at ~95% (z = 1.96): the pessimistic `p`. */
function wilsonLower(successes: number, trials: number, z = 1.96): number {
  const phat = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const centre = phat + (z * z) / (2 * trials);
  const spread = z * Math.sqrt((phat * (1 - phat)) / trials + (z * z) / (4 * trials * trials));
  return (centre - spread) / denominator;
}

/**
 * Attempt wall times on a CI runner with four lanes sharing its cores, seconds
 * (the same run, 123 attempts): rejected and accepted.
 */
const REJECTED_S = [
  131, 172, 194, 220, 226, 234, 244, 247, 248, 250, 250, 261, 264, 288, 312, 312, 332, 334, 339, 340, 347, 368, 375,
  384, 387, 392, 394, 396, 399, 401, 407, 411, 412, 419, 421, 427, 435, 445, 446, 450, 453, 472, 480, 497, 502, 503,
  523, 523, 524, 527, 546, 562, 571, 571, 585, 587, 593, 607, 608, 615, 625, 636, 638, 643, 670, 707, 743, 775, 801,
  812, 846, 856, 862, 866, 870, 877, 961, 966, 999, 1022, 1030, 1045, 1045, 1070, 1080, 1090, 1149, 1164, 1228, 1239,
  1386, 1423, 2051,
];
const ACCEPTED_S = [
  472, 486, 535, 586, 662, 666, 681, 822, 881, 892, 893, 923, 943, 970, 1054, 1061, 1075, 1099, 1116, 1189, 1200,
  1230, 1319, 1333, 1357, 1368, 1383, 1535, 1770, 1994,
];

/** The job's `timeout-minutes` (60), less ~4 minutes of checkout, install and the proof. */
const CLOCK_S = 56 * 60;
const SEEDS = 16;
const LANES = 4;
const BLOCK_SIZE = 4;
const STAGE_A_BLOCKS = 2;
const TOTAL_BLOCKS = 16;
const TRIALS = 2_000_000;

/** A small deterministic generator, so the printed odds are reproducible. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One seed on one runner: restarts in order, `LANES` at a time, each lane
 * taking the next restart as it frees. Returns the wall time at which the
 * lowest accepted restart's verdict is in hand (every lower restart having
 * finished too), or Infinity if it is not in hand by `CLOCK_S`.
 */
function oneRunner(p: number, random: () => number): number {
  const lanes = new Array<number>(LANES).fill(0);
  let restart = 0;
  let doneThrough = 0; // the time by which every restart so far has finished
  for (; restart < 400; restart += 1) {
    lanes.sort((a, b) => a - b);
    const start = lanes[0] as number;
    if (start > CLOCK_S) return Infinity;
    const accepted = random() < p;
    const pool = accepted ? ACCEPTED_S : REJECTED_S;
    const end = start + (pool[Math.floor(random() * pool.length)] as number);
    lanes[0] = end;
    doneThrough = Math.max(doneThrough, end);
    if (accepted) return doneThrough <= CLOCK_S ? doneThrough : Infinity;
  }
  return Infinity;
}

const p = wilsonLower(ACCEPTED, ATTEMPTS);
const random = rng(708);

// --- before: one runner per seed --------------------------------------------
let seedMisses = 0;
for (let i = 0; i < TRIALS; i += 1) if (oneRunner(p, random) === Infinity) seedMisses += 1;
const seedMissBefore = seedMisses / TRIALS;
const runMissBefore = 1 - (1 - seedMissBefore) ** SEEDS;

// --- after: seed x block --------------------------------------------------------
// A block is one round: its slowest attempt. With every lane busy from the
// start it is the max of four draws (pessimistic: an accepted restart ends the
// round as soon as every lower one in the block is in).
const allTimes = [...REJECTED_S, ...ACCEPTED_S];
let roundOver = 0;
for (let i = 0; i < TRIALS; i += 1) {
  let longest = 0;
  for (let lane = 0; lane < LANES; lane += 1) {
    longest = Math.max(longest, allTimes[Math.floor(random() * allTimes.length)] as number);
  }
  if (longest > CLOCK_S) roundOver += 1;
}
const roundMiss = roundOver / TRIALS;
const restarts = TOTAL_BLOCKS * BLOCK_SIZE;
const allRejected = (1 - p) ** restarts;
// A seed's blocks: stage A always, stage B when stage A found nothing.
const stageBNeeded = (1 - p) ** (STAGE_A_BLOCKS * BLOCK_SIZE);
const blocksRun = STAGE_A_BLOCKS + stageBNeeded * (TOTAL_BLOCKS - STAGE_A_BLOCKS);
const seedMissAfter = allRejected + blocksRun * roundMiss;
const runMissAfter = 1 - (1 - seedMissAfter) ** SEEDS;

const pct = (x: number): string => (x >= 0.001 ? `${(x * 100).toFixed(2)}%` : `${x.toExponential(2)}`);
const oneIn = (x: number): string => (x > 0 ? `1 in ${Math.round(1 / x).toLocaleString('en-GB')}` : 'never');
console.log(`acceptance per attempt: ${ACCEPTED}/${ATTEMPTS} measured, p = ${p.toFixed(3)} (Wilson 95% lower bound)`);
console.log(`attempt times on CI: ${allTimes.length} measured, longest ${Math.max(...allTimes)} s; clock ${CLOCK_S} s`);
console.log('');
console.log('one runner per seed (before):');
console.log(`  a seed misses the clock      ${pct(seedMissBefore)}`);
console.log(`  some seed of ${SEEDS} misses     ${pct(runMissBefore)}  (${oneIn(runMissBefore)} cold runs)`);
console.log('');
console.log(`seed x block, ${BLOCK_SIZE} restarts a block, blocks 0-${STAGE_A_BLOCKS - 1} then up to ${TOTAL_BLOCKS - 1} (after):`);
console.log(`  all ${restarts} restarts rejected   ${pct(allRejected)}`);
console.log(`  one round over the clock     ${pct(roundMiss)}  (${blocksRun.toFixed(2)} rounds a seed on average)`);
console.log(`  some seed of ${SEEDS} misses     ${pct(runMissAfter)}  (${oneIn(runMissAfter)} cold runs)`);
console.log(`  runners a cold run           ${SEEDS * STAGE_A_BLOCKS} + ~${(SEEDS * stageBNeeded * (TOTAL_BLOCKS - STAGE_A_BLOCKS)).toFixed(0)}`);
