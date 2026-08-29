import { ANCHORS } from '../world/anchors';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from '../world/building/layout';
import { STALL_PLACEMENTS } from '../minigames/stallPlacement';

/**
 * **What is on the park map, and where.** GitHub issues #334 and #234.
 *
 * One list, derived from the park that was actually built, read by two
 * customers that must never disagree:
 *
 * - `ui/ParkMap.ts` draws each feature — a little picture of *that* attraction
 *   plus its name, per Jim's ask on #334.
 * - `scripts/check-park-map.mts` measures each feature back out of the map's
 *   own projection and compares it to the attraction's true world position.
 *
 * That second customer is the whole reason this is a module rather than a loop
 * inside the renderer. A drawing routine that reads a position and paints it
 * cannot be checked from outside; a *list* of positions can, and the check then
 * fails the moment the map starts drawing something somewhere the park did not
 * put it. CLAUDE.md's "two definitions of one thing, kept in step by hand" is
 * the failure this is shaped to prevent, and #234 is what it looks like when it
 * happens.
 *
 * **Positions only.** No copy, no colour, no icon choice. Those belong to the
 * owners that already hold them (`anchors.ts`'s `signTitle`, `stalls.ts`'s
 * `title`, a station's `name`), and `ParkMap` joins them on `id` at draw time.
 * Keeping this file to coordinates is also what keeps it headless: it imports
 * `stallPlacement.ts` — the deliberately three.js-free half of the stall
 * tables — rather than `stalls.ts`, so the check runs on plain Node.
 */

/** What kind of thing a feature is, which decides how it is drawn. */
export type MapFeatureKind = 'anchor' | 'stall' | 'station' | 'fountain' | 'castle';

export interface MapFeature {
  /**
   * Joins to the owner of this feature's copy: an `AnchorId`, a stall id, or
   * a station id. `ParkMap` looks the name up rather than being told it.
   */
  readonly id: string;
  readonly kind: MapFeatureKind;
  /** True world position, in metres. The thing the fidelity check pins. */
  readonly x: number;
  readonly z: number;
}

/**
 * The parts of the map's content that only the *running* world knows.
 *
 * Anchors and stalls are solved at module load and can simply be imported;
 * the train's stations come out of a route the train solved, and the fountain
 * is placed by the layout. Passing them in keeps this module importable
 * without booting a park, while still leaving the built world as their one
 * owner — `ParkMap` reads them straight off `World`, and the check reads them
 * off the harness's `World`.
 */
export interface ParkMapFacts {
  readonly stations: readonly { readonly id: string; readonly x: number; readonly z: number }[];
  readonly fountain: { readonly x: number; readonly z: number };
}

/**
 * Anchors whose ride already has a fairground booth standing in for its ticket
 * office. The booth is what a child walks up to, so the booth is what gets the
 * picture and the name; drawing the plot as well would put two labels on one
 * ride. Moved here from `ParkMap` so the check sees the same de-duplication the
 * renderer does rather than a second copy of the rule.
 */
export const ANCHORS_WITH_STALL_ENTRY: ReadonlySet<string> = new Set([
  'ferrisWheel',
  'dodgems',
  'waterFight',
]);

/**
 * Every feature the outdoor map draws, in draw order.
 *
 * Order is priority order, and it matters: `ParkMap.drawLabel` drops a name
 * that would land on one already drawn, so whatever is listed first keeps its
 * label when the park gets crowded. Big landmarks first, small furniture last.
 */
export function parkMapFeatures(facts: ParkMapFacts): readonly MapFeature[] {
  const features: MapFeature[] = [];

  // The castle is drawn at its real facade centre rather than its reserved
  // plot centre — `layout.ts` nudges the building in from the plot, and the
  // facade is the thing a child sees and walks to.
  features.push({ id: 'building', kind: 'castle', x: BUILDING_CENTRE_X, z: BUILDING_CENTRE_Z });

  for (const anchor of ANCHORS) {
    if (anchor.id === 'building') continue;
    if (ANCHORS_WITH_STALL_ENTRY.has(anchor.id)) continue;
    // The entrance, not the plot centre: it is where the path arrives, where
    // the sign stands, and where a tap on the map should take her.
    const [x, z] = anchor.entrance;
    features.push({ id: anchor.id, kind: 'anchor', x, z });
  }

  for (const [id, placement] of Object.entries(STALL_PLACEMENTS)) {
    const [x, z] = placement.position;
    features.push({ id, kind: 'stall', x, z });
  }

  features.push({ id: 'fountain', kind: 'fountain', x: facts.fountain.x, z: facts.fountain.z });

  for (const station of facts.stations) {
    features.push({ id: station.id, kind: 'station', x: station.x, z: station.z });
  }

  return features;
}
