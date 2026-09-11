/**
 * Throwaway instrument: **how far inside the park's edge does the railway
 * actually run?**
 *
 * The boundary wall and the rail fence interpenetrate on several pool seeds.
 * Before deciding which of the two gives way, this asks the prior question the
 * proposal skipped: is the track *crossing* the outline (in which case the wall
 * has to open, like a level crossing), or merely running *alongside* it close
 * enough that the fence clips the stone (in which case the track wants to move
 * a metre or two and nothing needs a hole in it)?
 *
 * Measured off the plan, which is a module-load constant and therefore the
 * same route the built park lays track on.
 */
import './headless-canvas.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Vector3 } from 'three';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { PARK_SEED_POOL } from '../src/world/parkSeedPool.ts';
import { PARK_BOUNDARY } from '../src/world/boundary.ts';
import { TRAIN_PLAN } from '../src/world/train/plan.ts';

const OUT = process.env['LGP_RB_OUT'] ?? '/tmp/rail-boundary';

/** Half the fence's reach either side of the track centre. */
const FENCE_HALF = 2.0;
/** Half the drawn masonry's thickness. */
const MASONRY_HALF = 0.86;

interface Report {
  readonly seed: number;
  readonly routeLength: number;
  /** Signed distance to the edge, positive inside. */
  readonly minEdge: number;
  readonly minEdgeAt: readonly [number, number];
  /** Metres of route whose fence would reach the masonry. */
  readonly clippingLength: number;
  /** Metres of route whose *centre* is outside the outline. */
  readonly outsideLength: number;
}

if (process.env['LGP_RB_CHILD'] === '1') {
  const route = TRAIN_PLAN.route;
  const length = route.length;
  const step = 0.25;
  const probe = new Vector3();
  let minEdge = Infinity;
  let minEdgeAt: readonly [number, number] = [0, 0];
  let clipping = 0;
  let outside = 0;
  for (let s = 0; s < length; s += step) {
    route.pointAt(s, probe);
    const d = PARK_BOUNDARY.distanceToEdge(probe.x, probe.z);
    if (d < minEdge) {
      minEdge = d;
      minEdgeAt = [probe.x, probe.z];
    }
    if (d < FENCE_HALF + MASONRY_HALF) clipping += step;
    if (d < 0) outside += step;
  }
  const report: Report = {
    seed: PARK_SEED,
    routeLength: length,
    minEdge,
    minEdgeAt,
    clippingLength: clipping,
    outsideLength: outside,
  };
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
          'scripts/probe-rail-boundary.mts',
        ],
        {
          env: { ...process.env, LGP_SEED: String(seed), LGP_RB_CHILD: '1', LGP_RB_OUT: OUT },
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        },
      );
    }),
  );
  process.stdout.write(
    `fence half ${FENCE_HALF} m + masonry half ${MASONRY_HALF} m = ${FENCE_HALF + MASONRY_HALF} m wanted inside the edge\n`,
  );
  for (const seed of seeds) {
    const r = JSON.parse(await readFile(`${OUT}/seed-${seed}.json`, 'utf8')) as Report;
    process.stdout.write(
      `seed ${String(r.seed).padStart(8)}: route ${r.routeLength.toFixed(0)} m; ` +
        `closest approach to the edge ${r.minEdge.toFixed(2)} m at (${r.minEdgeAt[0].toFixed(1)}, ${r.minEdgeAt[1].toFixed(1)}); ` +
        `${r.clippingLength.toFixed(1)} m of route clips the masonry; ` +
        `${r.outsideLength.toFixed(1)} m of route is outside the park\n`,
    );
  }
}
