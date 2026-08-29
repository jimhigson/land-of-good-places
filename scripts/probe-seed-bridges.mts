/**
 * **Which seeds carry long bridges?** — throwaway diagnostic for #349.
 *
 * Seed 2 is the sweep seed that exercises the 36.7 m bridges the paving fix was
 * measured on (PR #352 died having only ever measured 22 m geometry, where the
 * same error is 0.371 m instead of 0.513 m). If seed 2 has to be swapped, the
 * replacement must be picked for *comparable geometry*, not merely for being
 * green — otherwise the swap throws away the coverage that caught the bug.
 *
 * Run: node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *        scripts/probe-seed-bridges.mts 3 4 6 7
 */
const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
if (seeds.length === 0) throw new Error('give me some seeds');

for (const seed of seeds) {
  const result = await measure(seed);
  console.log(result);
}

async function measure(seed: number): Promise<string> {
  // Each seed needs its own module registry — `parkManifest.ts` reads LGP_SEED
  // once at load. A single process can only ever build one seed, so this
  // re-execs itself per seed.
  const { execFileSync } = await import('node:child_process');
  if (!process.env['LGP_ONE_SEED']) {
    try {
      return execFileSync(
        process.execPath,
        [
          '--no-warnings',
          '--import',
          './scripts/ts-extension-resolver-register.mjs',
          'scripts/probe-seed-bridges.mts',
          String(seed),
        ],
        { env: { ...process.env, LGP_ONE_SEED: '1', LGP_SEED: String(seed) }, encoding: 'utf8' },
      ).trim();
    } catch (error) {
      return `seed ${seed}: BUILD FAILED — ${(error as Error).message.split('\n')[0]}`;
    }
  }
  return await inspect(seed);
}

async function inspect(seed: number): Promise<string> {
  const { buildHeadlessPark } = await import('./park-harness.mts');
  const { PARK_SEED } = await import('../src/world/parkManifest.ts');
  if (PARK_SEED !== seed) return `seed ${seed}: harness built ${PARK_SEED} instead`;
  const { world } = buildHeadlessPark();
  const { frameFor } = await import('../src/world/train/bridgeSpine.ts');

  const spans: string[] = [];
  for (const crossing of world.train.crossings) {
    const bridge = world.train.bridges.find((b) => b.deckCovers(crossing.x, crossing.z));
    if (!bridge) {
      spans.push('level');
      continue;
    }
    const frame = frameFor(crossing);
    const reach = (sign: 1 | -1): number => {
      let last = 0;
      for (let d = 0; d <= 40; d += 0.25) {
        const p = frame.pointAt(d * sign);
        if (!bridge.covers(p.x, p.z)) break;
        last = d;
      }
      return last;
    };
    spans.push((reach(1) + reach(-1)).toFixed(1));
  }
  const real = spans.filter((s) => s !== 'level');
  const longest = real.length ? Math.max(...real.map(Number)) : 0;
  return (
    `seed ${seed}: ${real.length}/${world.train.crossings.length} bridges, ` +
    `longest ${longest.toFixed(1)} m, spans [${spans.join(', ')}]`
  );
}
