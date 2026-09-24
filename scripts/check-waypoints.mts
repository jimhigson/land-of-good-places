/**
 * **No waypoint may be authored inside something solid.**
 *
 * ```
 * npm run check:waypoints
 * ```
 *
 * `entities/npc/poiGraph.ts` validates a great deal about itself at boot: a
 * character of NPC width must fit at every node, and every edge is walked
 * against the finished collision world. Neither test could see the mistake the
 * table actually made. Three seeds sat inside the **facade** — the solid scenery
 * tower out in the garden that the big building's door is cut into — and:
 *
 * - the resolver said they were clear, because the facade is registered as four
 *   wall *segments* with nothing inside it, so the middle of a solid tower is
 *   empty as far as collision is concerned;
 * - the edge test said they could see each other, because they could: the line
 *   between two points inside the box never crosses its walls.
 *
 * They were labelled `indoors: true`, which was simply wrong — the interior is
 * six hundred metres away — and that label was the only thing keeping children
 * from being spawned into a solid tower.
 *
 * The graph now drops any waypoint stranded off the main path network, so this
 * class of mistake is *safe* at run time whatever anybody types. This script is
 * the other half: it makes it **loud at build time**, because a dropped
 * waypoint is a waypoint that silently stopped doing its job, and the whole
 * reason the three lasted so long is that nothing said anything.
 *
 * ## Why the facade specifically
 *
 * Because it is the one piece of solid, walk-into-able building in the garden,
 * and because it is where every mistake of this kind has actually landed —
 * "the big building" is at (−28.5, −30.5) on the map and it is entirely
 * reasonable to reach for those coordinates when adding a waypoint near it. The
 * rectangle below is derived from the same four constants
 * `Building.registerFacadeCollision` builds its walls from, so it cannot drift
 * away from the real tower.
 *
 * The lobby is **not** carved out as an exception. It is 1.8 m of airlock whose
 * only purpose is to stop a child who keeps walking during the iris ending up
 * inside solid geometry; it is not a place, and a child loitering in it is a
 * child standing in a doorway in the dark.
 */

import { BUILDING_HALF_X, BUILDING_HALF_Z } from '../src/core/constants.ts';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from '../src/world/building/layout.ts';
import { SEEDS } from '../src/entities/npc/poiGraph.ts';
import { PARK_RESTART, PARK_SEED_ASKED } from '../src/world/parkManifest.ts';
import { solveParkPlanNow } from '../src/world/parkPlan.ts';
import { SPACE_GARDEN, spaceAt } from '../src/world/spaces.ts';

interface Failure {
  readonly x: number;
  readonly z: number;
  readonly why: string;
}

const failures: Failure[] = [];

/**
 * **The facade is not where it used to be.** `BUILDING_CENTRE_X/Z` were plain
 * constants when this script was written; they are now `let`s that
 * `bindCastlePlacement` rebinds when the backtracking driver decides a layout,
 * and they read `NaN` until it does. Importing them is not enough — nothing in
 * this script's import graph solves the park, so both were `NaN` on every run,
 * the rectangle printed `x NaN..NaN`, and because every comparison against
 * `NaN` is false the `continue` that means "this waypoint is outside the
 * facade" never fired: all 245 waypoints were reported as inside it. A check
 * that cannot pass is the same disease as one that cannot fail.
 *
 * So: solve first, read after, and refuse to compare against anything that is
 * not a real number.
 */
solveParkPlanNow();

// --- inside the facade -------------------------------------------------------

const west = BUILDING_CENTRE_X - BUILDING_HALF_X;
const east = BUILDING_CENTRE_X + BUILDING_HALF_X;
const north = BUILDING_CENTRE_Z - BUILDING_HALF_Z;
const south = BUILDING_CENTRE_Z + BUILDING_HALF_Z;

for (const [name, bound] of [
  ['west', west],
  ['east', east],
  ['north', north],
  ['south', south],
] as const) {
  if (!Number.isFinite(bound)) {
    console.error(
      `\ncheck:waypoints cannot run: the facade's ${name} edge is ${bound}, not a number.\n` +
        "BUILDING_CENTRE_X/Z are rebound by bindCastlePlacement() when the driver decides a\n" +
        'layout; reading them before the park is solved bakes a NaN, and every comparison\n' +
        'against a NaN is false, so this check would report on nothing at all.\n',
    );
    process.exit(1);
  }
}

for (const seed of SEEDS) {
  const inside = seed.x >= west && seed.x <= east && seed.z >= north && seed.z <= south;
  if (!inside) continue;
  failures.push({
    x: seed.x,
    z: seed.z,
    why:
      `inside the facade (x ${west}..${east}, z ${north}..${south}), which is ` +
      'solid scenery. The building\'s inside is not here — it is 600 m away.',
  });
}

// --- in a space children cannot reach ---------------------------------------

for (const seed of SEEDS) {
  const space = spaceAt(seed.x, seed.z);
  if (space === SPACE_GARDEN) continue;
  failures.push({
    x: seed.x,
    z: seed.z,
    why:
      `in the '${space}' space. Children cannot get there: crossing the ` +
      'threshold is a teleport, not a walk. Indoor waypoints wait for the ' +
      'castle floor split (ARCHITECTURE-DECISIONS Decision 3, S2), which gives ' +
      'each floor its own space and its own portals.',
  });
}

// --- say so ------------------------------------------------------------------

const r = (n: number): string => n.toFixed(2);
console.log(
  `seed=${PARK_SEED_ASKED} restart=${PARK_RESTART} waypoints=${SEEDS.length} ` +
    `facade=(${r(west)},${r(north)})..(${r(east)},${r(south)}) ` +
    `centre=(${r(BUILDING_CENTRE_X)},${r(BUILDING_CENTRE_Z)})`,
);

if (failures.length > 0) {
  console.error(`\n${failures.length} waypoint(s) are somewhere no child could stand:\n`);
  for (const failure of failures) {
    console.error(`  (${failure.x}, ${failure.z}) — ${failure.why}`);
  }
  console.error('\nSee the header of scripts/check-waypoints.mts.\n');
  process.exitCode = 1;
} else {
  console.log('every waypoint is somewhere a child could stand.');
}
