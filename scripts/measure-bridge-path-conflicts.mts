/**
 * **Does the drawn path network agree with the bridges that got built?** — #414.
 *
 * Throwaway diagnostic. Re-execs itself once per seed (`parkManifest.ts` reads
 * `LGP_SEED` at load, so one process can only ever build one park).
 *
 *   node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs \
 *     scripts/measure-bridge-path-conflicts.mts 20260728 2 5 11 18
 *
 * Per seed it reports:
 *  - how many sites `crossingPlanSolve` PROVED as bridges vs offered as levels
 *  - per measured crossing: which tier it snapped to, and whether a bridge was
 *    actually BUILT there (the disagreement #414 is about)
 *  - per built bridge: every drawn path run entering its footprint that is not
 *    the run the bridge was built along — the foreign connectors that end up
 *    under a ramp or against a flank.
 */
const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
if (seeds.length === 0) throw new Error('give me some seeds');

if (!process.env['LGP_ONE_SEED']) {
  const { execFileSync } = await import('node:child_process');
  for (const seed of seeds) {
    try {
      const out = execFileSync(
        process.execPath,
        [
          '--no-warnings',
          '--import',
          './scripts/ts-extension-resolver-register.mjs',
          'scripts/measure-bridge-path-conflicts.mts',
          String(seed),
        ],
        { env: { ...process.env, LGP_ONE_SEED: '1', LGP_SEED: String(seed) }, encoding: 'utf8' },
      );
      process.stdout.write(out);
    } catch (error) {
      process.stdout.write(`seed ${seed}: BUILD FAILED — ${(error as Error).message.split('\n')[0]}\n`);
    }
  }
  process.exit(0);
}

await inspect(seeds[0] as number);

async function inspect(seed: number): Promise<void> {
  const { buildHeadlessPark } = await import('./park-harness.mts');
  const { PARK_SEED } = await import('../src/world/parkManifest.ts');
  if (PARK_SEED !== seed) throw new Error(`harness built ${PARK_SEED} instead of ${seed}`);
  const { world } = buildHeadlessPark();
  const { CROSSING_SITES, LEVEL_CROSSING_SITES } = await import('../src/world/train/crossingPlan.ts');
  const { pathCentreline } = await import('../src/world/pathGraph.ts');
  const { terrainHeight } = await import('../src/world/terrain.ts');
  const { ENTRANCE_GATE_X, ENTRANCE_GATE_Z } = await import('../src/world/entrance/layout.ts');

  const crossings = world.train.crossings;
  const bridges = world.train.bridges;
  const samples = pathCentreline();

  const lines: string[] = [];
  lines.push(`\n=== seed ${seed} ===`);
  lines.push(
    `planner: ${CROSSING_SITES.length} PROVEN bridge sites, ` +
      `${LEVEL_CROSSING_SITES.length} level sites; ` +
      `built: ${bridges.length} bridges over ${crossings.length} measured crossings`,
  );

  const tierOf = (railDistance: number): string => {
    const near = (list: readonly { railDistance: number }[]): boolean =>
      list.some((s) => Math.abs(s.railDistance - railDistance) < 0.001);
    if (near(CROSSING_SITES)) return 'BRIDGE-site';
    if (near(LEVEL_CROSSING_SITES)) return 'level-site';
    return 'unplanned';
  };

  for (const crossing of crossings) {
    const bridge = bridges.find((b) => b.deckCovers(crossing.x, crossing.z));
    const tier = tierOf(crossing.railDistance);
    const gate = Math.hypot(crossing.x - ENTRANCE_GATE_X, crossing.z - ENTRANCE_GATE_Z);
    const verdict = bridge
      ? tier === 'BRIDGE-site'
        ? 'bridge built on a proven site — OK'
        : `*** BRIDGE BUILT ON A ${tier.toUpperCase()} ***`
      : 'no bridge (level crossing)';
    lines.push(
      `  d=${crossing.railDistance.toFixed(1)} at (${crossing.x.toFixed(1)}, ${crossing.z.toFixed(1)}) ` +
        `${gate.toFixed(1)} m from the gate — ${tier} — ${verdict}`,
    );
  }

  // --- foreign runs inside a bridge footprint -----------------------------
  for (const bridge of bridges) {
    const crossing = crossings.find((c) => bridge.deckCovers(c.x, c.z));
    if (!crossing) continue;
    // The run the bridge was built along: nearest centreline sample to the
    // crossing's own centre.
    let ownRun = -1;
    let bestDistance = Infinity;
    for (const sample of samples) {
      const d = Math.hypot(sample.x - crossing.x, sample.z - crossing.z);
      if (d < bestDistance) {
        bestDistance = d;
        ownRun = sample.run;
      }
    }
    const gate = Math.hypot(crossing.x - ENTRANCE_GATE_X, crossing.z - ENTRANCE_GATE_Z);
    lines.push(
      `\n  bridge at d=${crossing.railDistance.toFixed(1)} (${crossing.x.toFixed(1)}, ${crossing.z.toFixed(1)}), ` +
        `crown y=${bridge.deckY.toFixed(2)}, ${gate.toFixed(1)} m from the gate, built along run ${ownRun}`,
    );
    const foreign = new Map<number, { under: number; onDeck: number; worstLift: number; nearest: [number, number] }>();
    for (const sample of samples) {
      if (sample.run === ownRun) continue;
      if (!bridge.covers(sample.x, sample.z) && bridge.pavingHeightAt(sample.x, sample.z) === null) continue;
      const surface = bridge.heightAt(sample.x, sample.z);
      const ground = terrainHeight(sample.x, sample.z);
      const lift = surface - ground;
      const carried = bridge.pavingHeightAt(sample.x, sample.z) !== null;
      const entry = foreign.get(sample.run) ?? { under: 0, onDeck: 0, worstLift: 0, nearest: [sample.x, sample.z] as [number, number] };
      if (carried) entry.onDeck += 1;
      else entry.under += 1;
      if (lift > entry.worstLift) {
        entry.worstLift = lift;
        entry.nearest = [sample.x, sample.z];
      }
      foreign.set(sample.run, entry);
    }
    if (foreign.size === 0) {
      lines.push('    no foreign path run enters this footprint');
    }
    for (const [run, entry] of [...foreign].sort((a, b) => b[1].worstLift - a[1].worstLift)) {
      lines.push(
        `    *** run ${run}: ${entry.onDeck} samples lifted onto the bridge, ` +
          `${entry.under} left under it; worst lift ${entry.worstLift.toFixed(2)} m ` +
          `at (${entry.nearest[0].toFixed(1)}, ${entry.nearest[1].toFixed(1)})`,
      );
    }
  }

  process.stdout.write(lines.join('\n') + '\n');
}
