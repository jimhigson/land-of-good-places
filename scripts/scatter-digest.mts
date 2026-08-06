/**
 * **A fingerprint of where the park's scenery actually stands.**
 *
 * Builds the real headless park and prints a SHA-256 over every scattered
 * object's position, as JSON on stdout. Run it twice with different
 * environments and compare: identical digests mean not one tree, bush or wall
 * moved between the two parks.
 *
 * ```
 * node --experimental-transform-types --import ./scripts/ts-extension-resolver-register.mjs \
 *   scripts/scatter-digest.mts
 * LGP_SPUR_STRETCH=4 node ... scripts/scatter-digest.mts   # one spur 4 m longer
 * ```
 *
 * ### Why it is a separate process rather than a function
 *
 * `PARK_SEED` and `SPUR_STRETCH` are read **once at module load**, so a park is
 * baked into the module registry the first time anything imports it. Two parks
 * therefore need two registries, and the cheapest honest way to get two
 * registries is two processes. `test/procgen/scatterDecoupling.test.ts` spawns
 * this script rather than trying to rebuild in-process, for the same reason
 * `vitest.config.ts` keeps `isolate` on.
 *
 * ### Why positions and not a count
 *
 * A count is the check that would have passed all along. The bug being guarded
 * against reshuffles the park while planting exactly as many trees as before —
 * the ferris kiosk was stranded by a wall that *moved*, not by one that
 * appeared. Only positions can see that.
 */
import './headless-canvas.mjs';
import { createHash } from 'node:crypto';
import { buildHeadlessPark } from './park-harness.mts';
import { PARK_SEED } from '../src/world/parkManifest.ts';
import { PATH_GRAPH } from '../src/world/paths.ts';

/**
 * Rounded to a millimetre before hashing.
 *
 * Floating-point drift is not the enemy here — nothing in this comparison
 * recomputes anything, so bit-identical input gives bit-identical output — but
 * a digest that would flip on the last mantissa bit is a digest that reports
 * noise as a regression, and this check has to stay trustworthy for years.
 * A millimetre is far below anything a six-year-old could see and far above
 * any drift.
 */
function fixed(value: number): string {
  return value.toFixed(3);
}

interface Placed {
  readonly label: string;
  readonly x: number;
  readonly z: number;
}

function digestOf(items: readonly string[]): string {
  const hash = createHash('sha256');
  for (const line of items) hash.update(line + '\n');
  return hash.digest('hex').slice(0, 16);
}

const { world, buildMs } = buildHeadlessPark();

const trees: Placed[] = world.scenery.foliageOccluders.map((tree) => ({
  label: `tree ${fixed(tree.x)} ${fixed(tree.z)} r=${fixed(tree.radius)}`,
  x: tree.x,
  z: tree.z,
}));

const bushes: Placed[] = world.scenery.bushes.map((bush) => ({
  label: `bush ${fixed(bush.x)} ${fixed(bush.z)} r=${fixed(bush.radius)}`,
  x: bush.x,
  z: bush.z,
}));

const walls: Placed[] = world.scenery.wallRuns.map((run) => ({
  label:
    `wall ${run.kind} ${fixed(run.from[0])} ${fixed(run.from[1])} ` +
    `${fixed(run.to[0])} ${fixed(run.to[1])} h=${fixed(run.height)}`,
  x: (run.from[0] + run.to[0]) / 2,
  z: (run.from[1] + run.to[1]) / 2,
}));

/**
 * Sorted before hashing, so the digest is about *where things are* and not
 * about the order the generator happened to emit them in. Two parks that place
 * the same scenery in a different sequence are the same park to a child.
 */
function summarise(items: readonly Placed[]): {
  count: number;
  digest: string;
  labels: readonly string[];
} {
  const labels = items.map((item) => item.label).sort();
  return { count: items.length, digest: digestOf(labels), labels };
}

/**
 * How much paving there is, and where.
 *
 * The load-bearing half of the experiment. "The scatter did not move" is only
 * evidence if the paths *did* — otherwise a knob that silently does nothing
 * produces a perfectly green, perfectly worthless result. The decoupling test
 * asserts this digest **differs** between the two parks in the same breath as
 * asserting the scatter's matches.
 */
const pathMetres = PATH_GRAPH.edges
  .filter((edge) => edge.paved)
  .reduce((total, edge) => {
    const points = edge.route.points;
    let length = 0;
    for (let i = 1; i < points.length; i += 1) {
      const [ax, az] = points[i - 1] as readonly [number, number];
      const [bx, bz] = points[i] as readonly [number, number];
      length += Math.hypot(bx - ax, bz - az);
    }
    return total + length;
  }, 0);

const pathLabels = PATH_GRAPH.edges
  .filter((edge) => edge.paved)
  .map(
    (edge) =>
      `${edge.route.name} w=${fixed(edge.route.width)} ` +
      edge.route.points.map(([x, z]) => `${fixed(x)},${fixed(z)}`).join(' '),
  )
  .sort();

const summary = {
  seed: PARK_SEED,
  paths: { metres: Number(pathMetres.toFixed(3)), digest: digestOf(pathLabels) },
  spurStretch: Number(process.env['LGP_SPUR_STRETCH'] ?? 0),
  spurStretchId: process.env['LGP_SPUR_STRETCH_ID'] ?? 'stall.railRacer',
  buildMs: Math.round(buildMs),
  trees: summarise(trees),
  bushes: summarise(bushes),
  walls: summarise(walls),
  all: digestOf([...trees, ...bushes, ...walls].map((item) => item.label).sort()),
};

process.stdout.write(JSON.stringify(summary) + '\n');
