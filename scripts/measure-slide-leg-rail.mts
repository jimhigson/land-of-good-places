/**
 * **Measures the ginormous slide's legs against the railway** (issue #501).
 *
 * One line per leg that stands inside the train's envelope, per seed, plus a
 * per-seed leg count so a "fix" that simply stops building legs is visible as a
 * fix that made the park worse rather than as a clean run.
 *
 * ```
 * LGP_SEED=5 pnpm exec node --no-warnings \
 *   --import ./scripts/ts-extension-resolver-register.mjs \
 *   scripts/measure-slide-leg-rail.mts
 * ```
 *
 * Thresholds come from the game: `TRACK_CLEARANCE` is the half-width anything
 * counts as "inside the train" within, and the leg's foot radius is the leg's
 * own. Nothing here re-derives the placement rule — it reads the built park's
 * legs back off `World` and asks `distanceToRailCorridor` where the solved
 * centre line is.
 */
import { buildHeadlessPark } from './park-harness.mts';
import { distanceToRailCorridor } from '../src/world/train/plan.ts';
import { TRACK_CLEARANCE } from '../src/world/train/route.ts';
import { PARK_SEED } from '../src/world/parkManifest.ts';

/** The leg's foot, off `slide/supports.ts` — the widest part of the post. */
const FOOT_RADIUS = 0.52;

const { world } = buildHeadlessPark();
const legs = world.building.slideLegs;

let worst = Infinity;
const fouls: string[] = [];
for (const leg of legs) {
  const gap = distanceToRailCorridor(leg.x, leg.z) - FOOT_RADIUS;
  worst = Math.min(worst, gap);
  if (gap < TRACK_CLEARANCE) {
    fouls.push(
      `  leg at (${leg.x.toFixed(1)},${leg.z.toFixed(1)}) is ${(TRACK_CLEARANCE - gap).toFixed(2)} m ` +
        `inside the envelope (face ${gap.toFixed(2)} m from the centre line)`,
    );
  }
}

process.stdout.write(
  `seed ${PARK_SEED}: ${legs.length} legs, worst face-to-centre-line ` +
    `${worst === Infinity ? 'n/a (no legs)' : `${worst.toFixed(2)} m`} ` +
    `(needs ${TRACK_CLEARANCE} m), ${fouls.length} inside the train\n`,
);
for (const foul of fouls) process.stdout.write(`${foul}\n`);

process.exit(fouls.length === 0 ? 0 : 1);
