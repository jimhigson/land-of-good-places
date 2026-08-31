/**
 * **What does solving the train loop actually cost?** — #427.
 *
 *   node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/measure-train-solve-budget.mts 20260728 2 5 11 18 3 4 6 7
 *
 * Growing the loop from a chosen crossing pose replaces a ring of 96 candidate
 * rim bearings with a handful of interior poses. `budgets.restarts` is set
 * from `startPoses.length`, so that is a real reduction in the search's
 * outermost freedom, and the risk is that loops stop solving.
 *
 * This reports the numbers to judge it by, before and after: which start pose
 * won, how many restarts and backtracks it took, and how long.
 */
const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
if (seeds.length === 0) throw new Error('give me some seeds');

if (!process.env['LGP_ONE_SEED']) {
  const { execFileSync } = await import('node:child_process');
  const rows: string[] = [];
  for (const seed of seeds) {
    let line: string;
    try {
      line = execFileSync(
        process.execPath,
        [
          '--no-warnings',
          '--import',
          './scripts/ts-extension-resolver-register.mjs',
          'scripts/measure-train-solve-budget.mts',
          String(seed),
        ],
        { env: { ...process.env, LGP_ONE_SEED: '1', LGP_SEED: String(seed) }, encoding: 'utf8' },
      ).trim();
    } catch (error) {
      line = `seed ${seed}: UNSOLVABLE — ${(error as Error).message.split('\n')[0].slice(0, 80)}`;
    }
    console.log(line);
    rows.push(line);
  }
  const solved = rows.filter((r) => r.includes('poses=')).length;
  console.log(`\n${solved}/${rows.length} seeds solved a train loop.`);
  process.exit(0);
}

const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
const report = TRAIN_PLAN.route.solveReport;
console.log(
  `seed ${PARK_SEED}: poses=${report.startPoseCount} won=#${report.startPoseIndex} ` +
    `restarts=${report.restarts} backtracks=${report.backtracks} ` +
    `candidates=${report.candidatesTried} length=${report.length.toFixed(0)}m ` +
    `${report.elapsedMs.toFixed(0)}ms`,
);
