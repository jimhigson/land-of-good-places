/** Throwaway instrument: does the train loop still solve, on every pool seed? */
import './headless-canvas.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Vector3 } from 'three';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';
import { PARK_BOUNDARY } from '../src/world/boundary.ts';

const OUT = process.env['LGP_TS_OUT'] ?? '/tmp/train-solves';

interface Report {
  readonly seed: number;
  readonly solved: boolean;
  readonly length: number;
  readonly minEdge: number;
  readonly note: string;
}

if (process.env['LGP_TS_CHILD'] === '1') {
  let report: Report;
  try {
    const { TRAIN_PLAN } = await import('../src/world/train/plan.ts');
    const route = TRAIN_PLAN.route;
    const probe = new Vector3();
    let minEdge = Infinity;
    for (let s = 0; s < route.length; s += 0.25) {
      route.pointAt(s, probe);
      minEdge = Math.min(minEdge, PARK_BOUNDARY.distanceToEdge(probe.x, probe.z));
    }
    report = { seed: PARK_SEED, solved: true, length: route.length, minEdge, note: '' };
  } catch (error) {
    report = {
      seed: PARK_SEED,
      solved: false,
      length: 0,
      minEdge: 0,
      note: (error as Error).message.split('\n')[0] ?? String(error),
    };
  }
  await writeFile(`${OUT}/seed-${PARK_SEED}.json`, JSON.stringify(report), 'utf8');
} else {
  const run = promisify(execFile);
  await mkdir(OUT, { recursive: true });
  const seeds = [...new Set([PARK_SEED, ...PARK_SEED_POOL])].sort((a, b) => a - b);
  await Promise.all(
    seeds.map(async (seed) => {
      await run(
        process.execPath,
        [
          '--no-warnings',
          '--import',
          './scripts/ts-extension-resolver-register.mjs',
          'scripts/probe-train-solves.mts',
        ],
        {
          env: { ...process.env, LGP_SEED: String(seed), LGP_TS_CHILD: '1', LGP_TS_OUT: OUT },
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        },
      );
    }),
  );
  let solvedCount = 0;
  for (const seed of seeds) {
    const r = JSON.parse(await readFile(`${OUT}/seed-${seed}.json`, 'utf8')) as Report;
    if (r.solved) solvedCount += 1;
    process.stdout.write(
      r.solved
        ? `seed ${String(r.seed).padStart(8)}: SOLVED  ${r.length.toFixed(0)} m, closest to edge ${r.minEdge.toFixed(2)} m\n`
        : `seed ${String(r.seed).padStart(8)}: FAILED  ${r.note}\n`,
    );
  }
  process.stdout.write(`${solvedCount}/${seeds.length} seeds solve\n`);
}
