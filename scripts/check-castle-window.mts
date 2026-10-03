import { buildHeadlessPark, quietly } from './park-harness.mts';
import { WINDOW_HEAD_Y, WINDOW_SILL_Y } from '../src/world/coaster/castleWindows';
import { castleWindowFindings } from './lib/rideFindings.mts';

/**
 * **The Sky Cruiser's castle pass, measured on the park that was built** (#113).
 *
 * Two checks, deliberately of different kinds. `checkCastleWindows` reasons
 * about the opening from geometry and says *why* something is wrong in words a
 * person can act on; `sweptCartHits` fires the car's four envelope corners
 * through the castle as rays and reports what they actually struck, against
 * whatever the scene turned out to contain. The first is diagnosable, the second
 * is true, and neither is a substitute for the other.
 *
 * A seed whose loop misses the castle has no windows and no pass, and that is a
 * pass, not a skip — nothing in the park reserves the castle for the coaster.
 */

const park = quietly(() => buildHeadlessPark());
// The measurement is `lib/rideFindings.mts`'s, one owner with the acceptance loop.
const found = await castleWindowFindings(park);
console.log(
  `check:castle-window: drawn shell vs CASTLE_FRAME ${found.offMetres.toExponential(1)} m, ${found.offRadians.toExponential(1)} rad`,
);
if (found.complaints.length > 0) {
  console.error('check:castle-window: FAILED');
  for (const complaint of found.complaints) console.error(`  - ${complaint}`);
  process.exitCode = 1;
} else if (found.openings.length === 0) {
  console.log(
    'check:castle-window: this seed sends the loop round the castle, not through it — ' +
      'no openings cut, castle intact.',
  );
} else {
  console.log(
    `check:castle-window: ${found.openings.length} opening(s) — ${found.openings.join(', ')}; ` +
      `sill ${WINDOW_SILL_Y.toFixed(2)} m, head ${WINDOW_HEAD_Y.toFixed(2)} m; ` +
      `car swept through both, clear of every mesh in the castle. ${park.buildMs} ms.`,
  );
}
