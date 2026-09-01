/**
 * **Sweep `HOP_COST_MULTIPLIER` against the two things it has to satisfy.**
 *
 * ```
 * node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *      scripts/sweep-hop-multiplier.mts [M ...]
 * ```
 *
 * The multiplier is pulled in two directions and both are measured here rather
 * than argued about:
 *
 * - **too high** and the router walks a child round the houses to reach a spot
 *   a few metres off the kerb — `scripts/measure-kerb-detour.mts`, run on every
 *   CI seed and reported as a ratio against the same park with the crossing
 *   free (`M = 1`, the router as it behaved before #452);
 * - **too low** and a route cuts through the fountain — `check:fountain-hop`,
 *   run on every CI seed, exactly as `pnpm run check` runs it.
 *
 * It works by **editing the constant in `src/world/NavGrid.ts` and running the
 * real scripts against the real router**, restoring the file afterwards. There
 * is deliberately no test-only seam for the multiplier: the point of the
 * constant is that it has one owner and no per-caller override, and a sweep
 * that took a different code path would not be measuring what ships.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const NAV_GRID = new URL('../src/world/NavGrid.ts', import.meta.url);
const KERB = 'scripts/measure-kerb-detour.mts';
const FOUNTAIN = 'scripts/check-fountain-hop.mts';

/** The five seeds CI builds a park on — `check:fountain-hop`'s own list. */
const CI_SEEDS = [20260728, 2, 5, 11, 18] as const;

const CANDIDATES =
  process.argv.length > 2
    ? process.argv.slice(2).map(Number)
    : [1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6.4];

const original = readFileSync(NAV_GRID, 'utf8');
const PATTERN = /^const HOP_COST_MULTIPLIER = [\d.]+;$/m;
if (!PATTERN.test(original)) {
  console.error('sweep-hop-multiplier: could not find HOP_COST_MULTIPLIER in NavGrid.ts');
  process.exit(1);
}

function run(script: string, seed: number): { out: string; ok: boolean } {
  const r = spawnSync(
    process.execPath,
    ['--no-warnings', '--import', './scripts/ts-extension-resolver-register.mjs', script],
    { env: { ...process.env, LGP_SEED: String(seed) }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return { out: (r.stdout ?? '') + (r.stderr ?? ''), ok: r.status === 0 };
}

/** `x,z` → route length, for the probes that arrived. */
function kerbLengths(seed: number): Map<string, number> {
  const lengths = new Map<string, number>();
  for (const line of run(KERB, seed).out.split('\n')) {
    const m = /^KERB (\S+) (\S+) (\S+) (\S+) (\S+) (\d)$/.exec(line.trim());
    if (!m || m[6] !== '1') continue;
    lengths.set(`${m[2]},${m[3]} (${m[4]} m off)`, Number(m[5]));
  }
  return lengths;
}

interface Row {
  readonly M: number;
  readonly worst: number;
  readonly worstLabel: string;
  readonly worstSeed: number;
  readonly meanExtra: number;
  readonly n: number;
  readonly fountain: readonly number[];
}

// The baseline every ratio is taken against: the crossing free, which is the
// router as it behaved before #452. Measured once, per seed.
console.log('measuring the M = 1 baseline (the router before #452)…');
writeFileSync(NAV_GRID, original.replace(PATTERN, 'const HOP_COST_MULTIPLIER = 1;'));
const baseline = new Map<number, Map<string, number>>();
try {
  for (const seed of CI_SEEDS) baseline.set(seed, kerbLengths(seed));
} finally {
  writeFileSync(NAV_GRID, original);
}
for (const seed of CI_SEEDS) {
  console.log(`  seed ${String(seed).padStart(8)}: ${baseline.get(seed)!.size} probes arrive`);
}

const rows: Row[] = [];
try {
  for (const M of CANDIDATES) {
    writeFileSync(NAV_GRID, original.replace(PATTERN, `const HOP_COST_MULTIPLIER = ${M};`));
    let worst = 0;
    let worstLabel = '';
    let worstSeed = 0;
    let extra = 0;
    let n = 0;
    for (const seed of CI_SEEDS) {
      const base = baseline.get(seed)!;
      for (const [label, length] of kerbLengths(seed)) {
        const b = base.get(label);
        if (b === undefined || b < 0.01) continue;
        n += 1;
        extra += length - b;
        const ratio = length / b;
        if (ratio > worst) {
          worst = ratio;
          worstLabel = label;
          worstSeed = seed;
        }
      }
    }
    const fountainFailures = CI_SEEDS.filter((seed) => !run(FOUNTAIN, seed).ok);
    rows.push({ M, worst, worstLabel, worstSeed, meanExtra: extra / Math.max(n, 1), n, fountain: fountainFailures });
    const last = rows[rows.length - 1]!;
    console.log(
      `M = ${String(M).padEnd(5)} worst ${((last.worst - 1) * 100).toFixed(1).padStart(6)}%  ` +
        `mean +${last.meanExtra.toFixed(2)} m over ${last.n} probes  ` +
        `fountain ${last.fountain.length === 0 ? 'ok on all 5 seeds' : `FAILS on ${last.fountain.join(', ')}`}` +
        `  [worst: seed ${last.worstSeed}, ${last.worstLabel}]`,
    );
  }
} finally {
  writeFileSync(NAV_GRID, original);
}

console.log('\n| M | worst kerb detour | mean extra | fountain (5 seeds) |');
console.log('|---|---|---|---|');
for (const r of rows) {
  console.log(
    `| ${r.M} | ${((r.worst - 1) * 100).toFixed(1)}% | +${r.meanExtra.toFixed(2)} m | ` +
      `${r.fountain.length === 0 ? 'pass' : `**fails: ${r.fountain.join(', ')}**`} |`,
  );
}
