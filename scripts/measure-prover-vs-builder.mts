/**
 * **Where do the bridge prover and the bridge builder disagree, and why?** — #414.
 *
 *   node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/measure-prover-vs-builder.mts 20260728 2 5 11 18
 *
 * `crossingPlanSolve.ts` proves where a bridge fits, before any path is
 * drawn. `bridgeFootprint.ts`'s late `planReal` pass builds bridges against
 * the finished park, and on most seeds it builds at least one on a crossing
 * the prover offered only as a *level* crossing — so the path network was
 * laid out for a world without that bridge.
 *
 * Whether that is "the prover is too strict" or "the builder is too keen"
 * has been an untested suspicion through three rounds of work here. This
 * prints, for every crossing that got a bridge the prover did not prove,
 * exactly which gate the prover closed, through the prover's own probe.
 */
const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
if (seeds.length === 0) throw new Error('give me some seeds');

if (!process.env['LGP_ONE_SEED']) {
  const { execFileSync } = await import('node:child_process');
  for (const seed of seeds) {
    try {
      process.stdout.write(
        execFileSync(
          process.execPath,
          [
            '--no-warnings',
            '--import',
            './scripts/ts-extension-resolver-register.mjs',
            'scripts/measure-prover-vs-builder.mts',
            String(seed),
          ],
          { env: { ...process.env, LGP_ONE_SEED: '1', LGP_SEED: String(seed) }, encoding: 'utf8' },
        ),
      );
    } catch (error) {
      process.stdout.write(`seed ${seed}: BUILD FAILED — ${(error as Error).message.split('\n')[0]}\n`);
    }
  }
  process.exit(0);
}

const { buildHeadlessPark } = await import('./park-harness.mts');
const { world } = buildHeadlessPark();
const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { CROSSING_SITES } = await import('../src/world/train/crossingPlan.ts');
const { explainBridgeRefusal } = await import('../src/world/train/crossingPlanSolve.ts');

console.log(`\n=== seed ${PARK_SEED} ===`);
let disagreements = 0;
for (const crossing of world.train.crossings) {
  const bridge = world.train.bridges.find((b) => b.deckCovers(crossing.x, crossing.z));
  if (!bridge) continue;
  const proven = CROSSING_SITES.some(
    (s) => Math.abs(s.railDistance - crossing.railDistance) < 0.001,
  );
  if (proven) continue;
  disagreements += 1;
  console.log(
    `\nBUILT but NOT PROVEN — crown ${bridge.deckY.toFixed(2)} m, ` +
      `the prover's own account of the same spot:`,
  );
  for (const line of explainBridgeRefusal(crossing.railDistance)) console.log(line);
}
if (disagreements === 0) console.log('every built bridge stands on a proven site');
