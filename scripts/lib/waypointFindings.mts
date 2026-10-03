/**
 * **`check:waypoints`' measurement, one owner** — asked by the script and by
 * the root acceptance loop (`scripts/park-attempt.mts`). The waypoints are
 * sampled off the park's own paths and the facade stands where the layout put
 * the castle, so a waypoint inside it is a park's decision: a different restart
 * can clear it. Why the facade, and why a waypoint indoors is wrong, is the
 * script's header.
 */

export interface WaypointFailure {
  readonly x: number;
  readonly z: number;
  readonly why: string;
}

export interface WaypointFindings {
  /** The facade could not be read (a NaN bound): the instrument measured nothing. */
  readonly voids: readonly string[];
  readonly failures: readonly WaypointFailure[];
  /** For the transcript. */
  readonly summary: string;
}

export async function waypointFindings(): Promise<WaypointFindings> {
  const { BUILDING_HALF_X, BUILDING_HALF_Z } = await import('../../src/core/constants.ts');
  const layout = await import('../../src/world/building/layout.ts');
  const { SEEDS } = await import('../../src/entities/npc/poiGraph.ts');
  const { PARK_RESTART, PARK_SEED_ASKED } = await import('../../src/world/parkManifest.ts');
  const { solveParkPlanNow } = await import('../../src/world/parkPlan.ts');
  const { SPACE_GARDEN, spaceAt } = await import('../../src/world/spaces.ts');
  const failures: WaypointFailure[] = [];
  solveParkPlanNow();
  // Read after the solve: the castle's centre is rebound when the driver decides a layout.
  const west = layout.BUILDING_CENTRE_X - BUILDING_HALF_X;
  const east = layout.BUILDING_CENTRE_X + BUILDING_HALF_X;
  const north = layout.BUILDING_CENTRE_Z - BUILDING_HALF_Z;
  const south = layout.BUILDING_CENTRE_Z + BUILDING_HALF_Z;
  for (const [name, bound] of [
    ['west', west],
    ['east', east],
    ['north', north],
    ['south', south],
  ] as const) {
    if (!Number.isFinite(bound)) {
      return {
        voids: [
          `the facade's ${name} edge is ${bound}, not a number. BUILDING_CENTRE_X/Z are rebound by ` +
            'bindCastlePlacement() when the driver decides a layout; reading them before the park is ' +
            'solved bakes a NaN, and every comparison against a NaN is false, so this check would ' +
            'report on nothing at all.',
        ],
        failures,
        summary: '',
      };
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
        "solid scenery. The building's inside is not here — it is 600 m away.",
    });
  }
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
  const r = (n: number): string => n.toFixed(2);
  return {
    voids: [],
    failures,
    summary:
      `seed=${PARK_SEED_ASKED} restart=${PARK_RESTART} waypoints=${SEEDS.length} ` +
      `facade=(${r(west)},${r(north)})..(${r(east)},${r(south)}) ` +
      `centre=(${r(layout.BUILDING_CENTRE_X)},${r(layout.BUILDING_CENTRE_Z)})`,
  };
}
