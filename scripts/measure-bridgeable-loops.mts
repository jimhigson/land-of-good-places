/**
 * **How often does a solved railway loop admit a bridge at all?** — #414,
 * Jim's ruling that a park with no bridge is an invalid park:
 *
 * > "level crossings are now not allowed, but also I think the procgen should
 * > be able to make parks that meet constraints and this should be a constraint"
 *
 * Making that a generator constraint means rejecting a loop that proves no
 * bridge site and laying another. The cost of such a constraint is the
 * rejection rate: if most loops are bridgeable, retrying is nearly free; if
 * few are, park generation gets slow and #324's flaky boot check gets worse.
 *
 * This measures the rate directly, and cheaply: it stops at
 * `crossingPlan.ts`'s solve (the rail loop plus the plots plus the crossing
 * march, a couple of seconds) rather than building a whole park.
 *
 *   node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/measure-bridgeable-loops.mts 20260728 2 5 11 18 3 4 6 7 8 9
 */
const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
if (seeds.length === 0) throw new Error('give me some seeds');

if (!process.env['LGP_ONE_SEED']) {
  const { execFileSync } = await import('node:child_process');
  let bridgeable = 0;
  let counted = 0;
  for (const seed of seeds) {
    let line: string;
    try {
      line = execFileSync(
        process.execPath,
        [
          '--no-warnings',
          '--import',
          './scripts/ts-extension-resolver-register.mjs',
          'scripts/measure-bridgeable-loops.mts',
          String(seed),
        ],
        { env: { ...process.env, LGP_ONE_SEED: '1', LGP_SEED: String(seed) }, encoding: 'utf8' },
      ).trim();
    } catch (error) {
      line = `seed ${seed}: LOOP UNSOLVABLE — ${(error as Error).message.split('\n')[0]}`;
    }
    console.log(line);
    if (line.includes('bridge sites')) {
      counted += 1;
      if (!line.includes(' 0 bridge sites')) bridgeable += 1;
    }
  }
  if (counted > 0) {
    const rate = (bridgeable / counted) * 100;
    console.log(
      `\n${bridgeable}/${counted} loops admit at least one bridge (${rate.toFixed(0)}%). ` +
        `Expected attempts per park under the constraint: ${(counted / Math.max(1, bridgeable)).toFixed(2)}.`,
    );
  }
  process.exit(0);
}

const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { CROSSING_SITES } = await import('../src/world/train/crossingPlan.ts');
console.log(
  `seed ${PARK_SEED}: ${CROSSING_SITES.length} bridge sites`,
);
