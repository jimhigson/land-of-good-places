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
 * uses), whether the plan was hydrated, whether the backtracking driver was
 * ever constructed (it must not be: the hydrated path is the client's, which
 * has no driver — if it ran, the "hydrated" park was quietly re-solved and
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
const solver = await import('../procgen/world/planSolver.ts');
const { PARK_SEED } = await import('../src/world/parkManifest.ts');
const { buildHeadlessPark } = await import('./park-harness.mts');
const { digestScene } = await import('./lib/parkDigest.mts');

// Drive the plan the way the game does — through the park's own forcing
// path — so a hydrate run takes the client's route and a solve run the
// installed solver's (`scripts/ts-extension-resolver-register.mjs`).
const planWall = performance.now();
const planCpu = cpuMs();
plan.solveParkPlanNow();
const planCpuMs = cpuMs() - planCpu;
const planWallMs = performance.now() - planWall;

// Null when no driver was ever constructed — the hydrated path, which is the
// only path the client has. Present means the plan was searched.
const stats = solver.parkSolveStats();
if (mode === 'solve' && !stats) throw new Error('park-file-probe: the plan solved but published no stats');

const park = buildHeadlessPark();
const digest = digestScene(park.scene);

// Written after the park is built: the world phase's decisions only exist once
// a `World` has searched them.
let bytes = 0;
if (mode === 'solve') {
  const { worldPhaseDecisions } = await import('../procgen/world/worldPhaseSolver.ts');
  const world = worldPhaseDecisions();
  if (!world) throw new Error('park-file-probe: the World was built but the world phase recorded no decisions');
  const text = JSON.stringify(solver.parkPlanFile(world));
  writeFileSync(path, text);
  bytes = Buffer.byteLength(text);
}

const piecesByHydratedFeature: Record<string, number> = {};
for (const feature of PARK_FILE_FEATURES) piecesByHydratedFeature[feature] = stats?.piecesByFeature[feature] ?? 0;

console.log(
  JSON.stringify({
    mode,
    seed: PARK_SEED,
    park: digest.park,
    meshes: digest.meshes,
    byName: Object.fromEntries(digest.byName),
    hydrated: plan.parkPlanHydrated(),
    driverRan: stats !== null,
    worldSolverRan: (await import('../procgen/world/worldPhaseSolver.ts')).worldSolveTrace().length > 0,
    piecesByHydratedFeature,
    cpuMsByFeature: Object.fromEntries(Object.entries(stats?.cpuMsByFeature ?? {}).map(([k, v]) => [k, Math.round(v)])),
    planCpuMs: Math.round(planCpuMs),
    planWallMs: Math.round(planWallMs),
    worldBuildMs: Math.round(park.buildMs),
    bytes,
  }),
);
