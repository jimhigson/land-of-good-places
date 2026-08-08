/**
 * **Where the park's build time actually goes, and how many seeds survive it.**
 *
 * Two metrics, one script, because they are the same disease (HANDOFF-hotel-236):
 * a generator that solves by rejection is both slow AND brittle, and any change
 * to it has to be judged against both numbers at once.
 *
 *   npm run measure:procgen            # canonical seed, per-stage breakdown
 *   npm run measure:procgen -- 1 60    # sweep seeds 1..60, solve-rate + times
 *
 * Every solve in this codebase runs at MODULE LOAD (`PARK_BOUNDARY`,
 * `PARK_LAYOUT`, `COASTER_PLANS`, `TRAIN_PLAN`, `SLIDE_PLAN`, `RAIL_RACE_PLAN`,
 * `PATH_GRAPH`), so a "stage" here is a dynamic `import()` in dependency order:
 * ESM caches modules, so importing them one at a time bills each stage only for
 * the work it added. The three.js import is warmed first so its parse cost does
 * not land on whichever stage happens to touch it first.
 *
 * A seed needs its own module registry, so a sweep is one child process per
 * seed (the same reason `sweep-park-seeds.mts` shells out), run POOLED across
 * cores. Each child reports JSON on stdout; failures report which stage threw.
 */
import { execFile } from 'node:child_process';
import { availableParallelism } from 'node:os';

interface StageTime {
  readonly stage: string;
  readonly ms: number;
}

interface SeedResult {
  readonly seed: number;
  readonly ok: boolean;
  readonly stages: readonly StageTime[];
  readonly totalMs: number;
  /** Stage that threw, when `ok` is false. */
  readonly failedStage?: string;
  readonly failure?: string;
}

/** The stages, in dependency order. Each is imported alone and timed. */
const STAGES: readonly { readonly name: string; readonly load: () => Promise<unknown> }[] = [
  { name: 'boundary', load: () => import('../src/world/boundary.ts') },
  { name: 'layout', load: () => import('../src/world/parkLayout.ts') },
  { name: 'cruiser', load: () => import('../src/world/coaster/plan.ts') },
  { name: 'train', load: () => import('../src/world/train/plan.ts') },
  { name: 'slide', load: () => import('../src/world/slide/plan.ts') },
  { name: 'railRace', load: () => import('../src/world/railRace/plan.ts') },
  { name: 'paths', load: () => import('../src/world/paths.ts') },
];

/** Builds the whole world (scenery, colliders, NavGrid, poiGraph) after the plans. */
async function measureWorldStages(): Promise<StageTime[]> {
  const out: StageTime[] = [];
  await import('./headless-canvas.mjs');
  const { Scene } = await import('three');
  const { World } = await import('../src/world/World.ts');
  const { Sky } = await import('../src/world/Sky.ts');
  const { IsoCamera } = await import('../src/core/IsoCamera.ts');
  const { NavGrid } = await import('../src/world/NavGrid.ts');
  const { PoiGraph } = await import('../src/entities/npc/poiGraph.ts');
  const { PLAYER_RADIUS } = await import('../src/core/constants.ts');
  const { JUMP_APEX_HEIGHT } = await import('../src/entities/Player.ts');

  const warn = console.warn;
  const error = console.error;
  console.warn = () => {};
  console.error = () => {};
  try {
    const refuse = (): never => {
      throw new Error('measure-procgen: the world drove the player while building');
    };
    const controls = {
      walkTo: refuse,
      cancelWalk: refuse,
      setTimeScale: refuse,
      setWhoosh: refuse,
      iris: refuse,
      flash: refuse,
      snapCamera: refuse,
      openStairMenu: refuse,
      openShop: refuse,
      closeStairMenu: refuse,
    };
    let at = performance.now();
    const world = new World(
      new Scene(),
      new Sky(),
      controls as unknown as Parameters<typeof World.prototype.constructor>[2],
      new IsoCamera(),
    );
    out.push({ stage: 'world(scene+scatter)', ms: performance.now() - at });

    at = performance.now();
    new NavGrid(world.collision, PLAYER_RADIUS, JUMP_APEX_HEIGHT);
    out.push({ stage: 'navGrid', ms: performance.now() - at });

    at = performance.now();
    new PoiGraph(world.collision);
    out.push({ stage: 'poiGraph', ms: performance.now() - at });
  } finally {
    console.warn = warn;
    console.error = error;
  }
  return out;
}

async function measureOneSeed(withWorld: boolean): Promise<SeedResult> {
  const seed = Number(process.env['LGP_SEED'] ?? 0);
  const stages: StageTime[] = [];
  // Warm three.js so its parse cost is not billed to a solver stage.
  await import('three');
  const started = performance.now();
  for (const stage of STAGES) {
    const at = performance.now();
    try {
      await stage.load();
    } catch (error) {
      return {
        seed,
        ok: false,
        stages,
        totalMs: performance.now() - started,
        failedStage: stage.name,
        failure: error instanceof Error ? error.message.slice(0, 200) : String(error),
      };
    }
    stages.push({ stage: stage.name, ms: performance.now() - at });
  }
  if (withWorld) {
    try {
      stages.push(...(await measureWorldStages()));
    } catch (error) {
      return {
        seed,
        ok: false,
        stages,
        totalMs: performance.now() - started,
        failedStage: 'world',
        failure: error instanceof Error ? error.message.slice(0, 200) : String(error),
      };
    }
  }
  return { seed, ok: true, stages, totalMs: performance.now() - started };
}

function runChild(seed: number, withWorld: boolean): Promise<SeedResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [
        '--experimental-transform-types',
        '--no-warnings',
        '--import',
        './scripts/ts-extension-resolver-register.mjs',
        'scripts/measure-procgen.mts',
        '--child',
        ...(withWorld ? ['--world'] : []),
      ],
      {
        env: { ...process.env, LGP_SEED: String(seed) },
        maxBuffer: 32 * 1024 * 1024,
        timeout: 300_000,
      },
      (error, stdout) => {
        const line = stdout.split('\n').find((l) => l.startsWith('{"seed"'));
        if (line) {
          resolve(JSON.parse(line) as SeedResult);
          return;
        }
        resolve({
          seed,
          ok: false,
          stages: [],
          totalMs: 0,
          failedStage: 'process',
          failure: (error?.message ?? 'no result line').slice(0, 200),
        });
      },
    );
  });
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index] as number;
}

async function pool<T>(items: readonly number[], width: number, run: (n: number) => Promise<T>) {
  const out: T[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(width, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      out[index] = await run(items[index] as number);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--child')) {
    const result = await measureOneSeed(argv.includes('--world'));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  const numbers = argv.filter((a) => !a.startsWith('--')).map(Number);
  const withWorld = !argv.includes('--no-world');
  const seeds: number[] =
    numbers.length >= 2
      ? Array.from(
          { length: (numbers[1] as number) - (numbers[0] as number) + 1 },
          (_, i) => (numbers[0] as number) + i,
        )
      : numbers.length === 1
        ? [numbers[0] as number]
        : [20260728];

  const width = Math.max(1, Math.min(availableParallelism() - 1, 8));
  const started = Date.now();
  const results = await pool(seeds, width, (seed) => runChild(seed, withWorld));
  const wall = Date.now() - started;

  const solved = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  if (seeds.length === 1) {
    const only = results[0] as SeedResult;
    console.log(`seed ${only.seed}: ${only.ok ? 'SOLVED' : `FAILED at ${only.failedStage}`}`);
    for (const stage of only.stages) {
      console.log(`  ${stage.stage.padEnd(22)} ${stage.ms.toFixed(1).padStart(9)} ms`);
    }
    console.log(`  ${'TOTAL'.padEnd(22)} ${only.totalMs.toFixed(1).padStart(9)} ms`);
    if (!only.ok) console.log(`  failure: ${only.failure}`);
    return;
  }

  console.log(`\n=== ${seeds.length} seeds, ${width}-wide, ${(wall / 1000).toFixed(1)} s wall ===`);
  console.log(
    `SOLVE RATE: ${solved.length}/${results.length} = ${((100 * solved.length) / results.length).toFixed(0)}%`,
  );

  if (solved.length === 0) {
    console.log('\nNo seed solved — there are no per-stage times to report.');
  }
  const byStage = new Map<string, number[]>();
  for (const result of solved) {
    for (const stage of result.stages) {
      const list = byStage.get(stage.stage) ?? [];
      list.push(stage.ms);
      byStage.set(stage.stage, list);
    }
  }
  console.log('\nper-stage ms over SOLVED seeds (median / p90 / max / share of total):');
  const totals = solved.map((r) => r.totalMs).sort((a, b) => a - b);
  const grandMedian = percentile(totals, 0.5);
  const worstTotal = totals.length > 0 ? (totals[totals.length - 1] as number) : 0;
  for (const [stage, list] of byStage) {
    const sorted = [...list].sort((a, b) => a - b);
    const median = percentile(sorted, 0.5);
    console.log(
      `  ${stage.padEnd(22)} ${median.toFixed(1).padStart(8)} ${percentile(sorted, 0.9)
        .toFixed(1)
        .padStart(9)} ${(sorted[sorted.length - 1] as number).toFixed(1).padStart(10)}   ${(
        (100 * median) /
        Math.max(1, grandMedian)
      ).toFixed(0)}%`,
    );
  }
  console.log(
    `  ${'TOTAL'.padEnd(22)} ${grandMedian.toFixed(1).padStart(8)} ${percentile(totals, 0.9)
      .toFixed(1)
      .padStart(9)} ${worstTotal.toFixed(1).padStart(10)}`,
  );

  if (failed.length > 0) {
    const killers = new Map<string, number>();
    for (const f of failed) killers.set(f.failedStage ?? '?', (killers.get(f.failedStage ?? '?') ?? 0) + 1);
    console.log('\nwhich stage killed each failure:');
    for (const [stage, count] of [...killers].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${stage.padEnd(22)} ${String(count).padStart(3)}`);
    }
    console.log('\nfailed seeds:');
    for (const f of failed) {
      console.log(`  ${String(f.seed).padStart(5)}  ${f.failedStage}: ${(f.failure ?? '').slice(0, 110)}`);
    }
  }
  const slowest = [...solved].sort((a, b) => b.totalMs - a.totalMs).slice(0, 8);
  console.log('\nslowest solved seeds:');
  for (const s of slowest) {
    const worst = [...s.stages].sort((a, b) => b.ms - a.ms)[0];
    console.log(
      `  ${String(s.seed).padStart(5)}  ${s.totalMs.toFixed(0).padStart(7)} ms   worst: ${worst?.stage} ${worst?.ms.toFixed(0)} ms`,
    );
  }
}

await main();
