/**
 * **One park, one process: solve it and write its park file, or hydrate it
 * from one — and digest what was built either way.** The instrument behind
 * `check:prebuilt-park` and `build:parks` (`docs/design/PREBUILT-PARKS.md`).
 *
 * ```
 * LGP_SEED=11 node … scripts/park-file-probe.mts solve   <out.json>
 * LGP_SEED=11 node … scripts/park-file-probe.mts hydrate <in.json>
 * LGP_SEED=11 node … scripts/park-file-probe.mts perturb <in.json>
 * ```
 *
 * One park per process because the seed is read once at import and
 * `paths.ts` keeps module state: a second park in the same process would be
 * measuring the first one's leftovers. The last line on stdout is JSON — the
 * digest (`scripts/lib/parkDigest.mts`, the same function `park-digest.mts`
 * uses), whether the plan was hydrated, how many search pieces each hydrated
 * feature ran (must be zero, or the "hydrated" park was quietly re-solved and
 * matching the fresh one proves nothing), and what each stage cost.
 *
 * `perturb` hydrates from the file with the Sky Cruiser's track raised half a
 * metre: the control on the instrument. Its digest must differ from the
 * file's, or the comparison is blind to the file's contents.
 */
import './headless-canvas.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { cpuMs } from './lib/cpuClock.mts';
import type { Json, ParkFile } from '../src/world/prebuilt/parkFile.ts';
import { PARK_FILE_FEATURES } from '../src/world/prebuilt/parkFile.ts';
import { offerParkFile } from '../src/world/prebuilt/parkFileStore.ts';

const [mode, path] = process.argv.slice(2);
if ((mode !== 'solve' && mode !== 'hydrate' && mode !== 'perturb') || !path) {
  throw new Error('usage: park-file-probe.mts solve|hydrate|perturb <file.json>');
}

if (mode !== 'solve') {
  const file = JSON.parse(readFileSync(path, 'utf8')) as ParkFile;
  if (mode === 'perturb') {
    const points = file.features.cruiser.profile.points as Json[];
    for (let i = 1; i < points.length; i += 3) points[i] = (points[i] as number) + 0.5;
  }
  // Before anything imports the plan: the driver reads the letterbox once, when it starts.
  offerParkFile(file);
}

// Dynamic, so the offer above lands first whatever the import graph does.
const plan = await import('../src/world/parkPlan.ts');
const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { buildHeadlessPark } = await import('./park-harness.mts');
const { digestScene } = await import('./lib/parkDigest.mts');

const planWall = performance.now();
const planCpu = cpuMs();
plan.solveParkPlanNow();
const planCpuMs = cpuMs() - planCpu;
const planWallMs = performance.now() - planWall;

const stats = plan.parkSolveStats();
if (!stats) throw new Error('park-file-probe: the plan solved but published no stats');

let bytes = 0;
if (mode === 'solve') {
  const text = JSON.stringify(plan.parkPlanFile());
  writeFileSync(path, text);
  bytes = Buffer.byteLength(text);
}

const park = buildHeadlessPark();
const digest = digestScene(park.scene);

const piecesByHydratedFeature: Record<string, number> = {};
for (const feature of PARK_FILE_FEATURES) piecesByHydratedFeature[feature] = stats.piecesByFeature[feature] ?? 0;

console.log(
  JSON.stringify({
    mode,
    seed: PARK_SEED,
    park: digest.park,
    meshes: digest.meshes,
    byName: Object.fromEntries(digest.byName),
    hydrated: plan.parkPlanHydrated(),
    piecesByHydratedFeature,
    cpuMsByFeature: Object.fromEntries(Object.entries(stats.cpuMsByFeature).map(([k, v]) => [k, Math.round(v)])),
    planCpuMs: Math.round(planCpuMs),
    planWallMs: Math.round(planWallMs),
    worldBuildMs: Math.round(park.buildMs),
    bytes,
  }),
);
