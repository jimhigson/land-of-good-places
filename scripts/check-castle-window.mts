import { buildHeadlessPark, quietly } from './park-harness.mts';
import {
  CASTLE_WINDOWS,
  WINDOW_HEAD_Y,
  WINDOW_SILL_Y,
  checkCastleWindows,
  sweptCartHits,
} from '../src/world/coaster/castleWindows';

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
const route = park.world.coaster.route;

const castleRoot = park.scene.getObjectByName('the-big-building-outside');
if (!castleRoot) {
  console.error('check:castle-window: could not find the garden castle in the built scene');
  process.exitCode = 1;
} else {
  const complaints = [
    ...checkCastleWindows(route, CASTLE_WINDOWS),
    ...sweptCartHits(route, castleRoot),
  ];

  if (complaints.length > 0) {
    console.error('check:castle-window: FAILED');
    for (const complaint of complaints) console.error(`  - ${complaint}`);
    process.exitCode = 1;
  } else if (CASTLE_WINDOWS.length === 0) {
    console.log(
      'check:castle-window: this seed sends the loop round the castle, not through it — ' +
        'no openings cut, castle intact.',
    );
  } else {
    const shape = CASTLE_WINDOWS.map(
      (w) => `${w.wall} ${(w.maxZ - w.minZ).toFixed(2)} m wide at z ${w.trackZ.toFixed(2)}`,
    ).join(', ');
    console.log(
      `check:castle-window: ${CASTLE_WINDOWS.length} opening(s) — ${shape}; ` +
        `sill ${WINDOW_SILL_Y.toFixed(2)} m, head ${WINDOW_HEAD_Y.toFixed(2)} m; ` +
        `car swept through both, clear of every mesh in the castle. ${park.buildMs} ms.`,
    );
  }
}
