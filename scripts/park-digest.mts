/**
 * Before/after proof instrument for the road-placer step.
 *
 * Builds the real headless park for ONE seed (LGP_SEED) in this process — once,
 * never twice, because `paths.ts` mutates module-level paving — and prints a
 * digest of every mesh in the scene: name, world-space vertex positions, and
 * the whole thing rolled into one sha256 per named group plus one for the park.
 *
 * Run per seed in a child process. Compare the printed lines before and after a
 * change: any difference is a park that moved.
 */
import './headless-canvas.mjs';
import { createHash } from 'node:crypto';
import { buildHeadlessPark } from './park-harness.mts';
import { digestScene } from './lib/parkDigest.mts';
import { LAYOUT_TRACE } from '../src/world/parkLayout.ts';
import { parkSolveTrace } from '../procgen/world/planSolver.ts';
import { worldSolveTrace } from '../procgen/world/worldPhaseSolver.ts';

const park = buildHeadlessPark();
// Every mesh, hashed — see `scripts/lib/parkDigest.mts`, shared with
// `scripts/park-file-probe.mts` so both instruments measure one thing.
const digest = digestScene(park.scene);

// The layout's unwind trace, hashed on its own line: a seed that starts
// needing a restart it did not need before changes this digest *by name*,
// even when the park it ends up building is byte-identical (design doc,
// "Totality, ruled and mechanised" — determinism). The text is on stderr
// already; this is the number a before/after diff compares.
const trace = createHash('sha256').update(LAYOUT_TRACE.join('\n')).digest('hex').slice(0, 16);
// The two drivers' traces (plan phase, world phase): every refusal, retry,
// accommodation and unwind in order. Two processes on one seed must agree.
const planTrace = createHash('sha256').update(parkSolveTrace().join('\n')).digest('hex').slice(0, 16);
const worldTrace = createHash('sha256').update(worldSolveTrace().join('\n')).digest('hex').slice(0, 16);

const seed = process.env['LGP_SEED'] ?? 'canonical';
console.log(`seed ${seed}: meshes=${digest.meshes} park=${digest.park}`);
console.log(`  trace ${trace} (${LAYOUT_TRACE.length} line(s))`);
console.log(`  plan-trace ${planTrace} (${parkSolveTrace().length} line(s))`);
console.log(`  world-trace ${worldTrace} (${worldSolveTrace().length} line(s))`);
for (const [name, hash] of digest.byName) console.log(`  ${name} ${hash}`);
