/**
 * **The control for the commit-time crossing screen.**
 *
 * A screen that finds nothing on the broken seed is indistinguishable from a
 * screen that is not looking, so this runs all three legs and prints them
 * together:
 *
 * 1. **It fires** on a seed known to cross off-site (288 on the sphere branch).
 * 2. **It is silent** on a seed that builds — otherwise a screen that fouled
 *    everything would also "pass" leg 1, and prove nothing.
 * 3. **How many samples it scanned**, because zero-and-clean reads exactly like
 *    six-thousand-and-clean in every other respect.
 *
 * Run: LGP_SEED=<n> node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/probe-crossing-screen.mts
 */
import { TRAIN_PLAN } from '../src/world/train/plan.ts';
import { screenDrawnPathsForOffSiteCrossings } from '../procgen/world/train/crossingScreen.ts';
import { drawnSamplesFor, ROUTES } from '../src/world/pathGraph.ts';

const seed = process.env.LGP_SEED ?? '(default)';

// The same derivation `buildPaths()` uses: the drawing is a pure function of
// the graph, so the candidate graph's paved edges give the drawn samples.
const routes = ROUTES;
const samples = drawnSamplesFor(routes);
const result = screenDrawnPathsForOffSiteCrossings(TRAIN_PLAN.route, samples);

process.stderr.write(
  `seed ${seed}: ${routes.length} paved routes, ${result.samplesScanned} drawn samples scanned, ` +
    `${result.fouls.length} off-site crossing(s)\n`,
);
for (const foul of result.fouls) {
  const route = routes[foul.run];
  const first = route?.points[0];
  const last = route?.points[route.points.length - 1];
  process.stderr.write(
    `  FOUL railD ${foul.railDistance.toFixed(1)} at (${foul.x.toFixed(1)}, ${foul.z.toFixed(1)})` +
      ' — crosses the railway with no proven bridge site within SITE_SNAP_TOLERANCE\n' +
      (route
        ? `        drawn by route "${route.name}" (#${foul.run}, width ${route.width}, ` +
          `${route.points.length} control points` +
          (first && last
            ? `, (${first[0].toFixed(1)}, ${first[1].toFixed(1)}) -> ` +
              `(${last[0].toFixed(1)}, ${last[1].toFixed(1)})`
            : '') +
          ')\n'
        : `        run #${foul.run} is not in ROUTES\n`),
  );
}

if (result.samplesScanned === 0) {
  process.stderr.write(
    '  VOID: nothing was scanned, so "0 fouls" describes nothing. The screen is\n' +
      '        looking somewhere the drawn samples do not exist yet.\n',
  );
  process.exit(2);
}
