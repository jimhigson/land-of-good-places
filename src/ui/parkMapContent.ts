import { ANCHORS } from '../world/anchors';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from '../world/building/layout';
import { STALL_PLACEMENTS } from '../minigames/stallPlacement';
import {
  ENTRANCE_BUS_DOOR_X,
  ENTRANCE_GATE_X,
  ENTRANCE_GATE_Z,
} from '../world/entrance/layout';
import { entranceRoadAt } from '../world/entrance/roadRoute';

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
export type MapFeatureKind =
  | 'anchor'
  | 'stall'
  | 'station'
  | 'fountain'
  | 'castle'
  | 'gate'
  | 'catBus';

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
 * Booths that are a ride's ticket office rather than an attraction of their
 * own, keyed by stall id.
 *
 * **This used to be the other way round, and it was a bug** (found in review of
 * PR #353). The map skipped these three *rides* and drew each one's picture at
 * its ticket booth instead, on the reasoning that the booth is what a child
 * walks up to. But a booth stands well clear of the ride it sells for, so the
 * ride was drawn a long way from where it is: dodgems **22.0 m** out,
 * waterFight 20.9 m, ferrisWheel 13.4 m — 35x the 0.62 m the fidelity check
 * holds everything else to, and further than an icon is wide.
 *
 * Jim's requirement on this ticket is that the map "accurately reflect park
 * geometry", so the ride wins: the picture goes on the ride, at the ride's own
 * position, and the duplicate booth is left off rather than labelled twice.
 * `ParkMap` also draws the anchor's real footprint under it, so the ride's true
 * extent on the ground is visible whatever size the picture is drawn at.
 */
export const STALLS_DUPLICATING_A_RIDE: ReadonlySet<string> = new Set([
  'spaceFerrisWheel',
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

  // --- the way in ---------------------------------------------------------
  // Jim, 29 August: "put the cat bus on too, near the entrance gates, and also
  // the gates themselves." High in the list because these are the two things a
  // child arrives at and leaves by — the map's only fixed point of reference
  // that is the same on every visit — and because they stand alone on the
  // park's southern edge, where nothing else is competing for the space.
  //
  // Both read from `world/entrance/layout.ts`, the one owner of entrance
  // geometry, joined by id like everything else here. `layout.ts` imports only
  // `core/constants` and `core/mathUtils`, so this module stays headless and
  // `check:park-map` still runs on plain Node.

  // The centre of the gap cut in the boundary wall, which is where `Entrance.ts`
  // stands the arch: two posts on the wall's tangent and a crossbar over the
  // middle. The wall radius alone would not do — a gate is a point on a ring,
  // not the ring.
  features.push({ id: 'entranceGate', kind: 'gate', x: ENTRANCE_GATE_X, z: ENTRANCE_GATE_Z });

  /**
   * **The cat bus is drawn at its stop, not wherever it currently is** — and
   * that is forced rather than preferred.
   *
   * The bus is not park furniture. `Entrance.ts` builds the arrival only when
   * one is due; the bus rolls in along the kerb from `ENTRANCE_BUS_ARRIVE_X`,
   * and once it has driven off past `ENTRANCE_BUS_VANISH_X` it is disposed. For
   * nearly all of a save there is **no bus in the world at all**, so "where it
   * is now" is undefined most of the time and no check could ever pin it. Its
   * route is a line, not a point.
   *
   * What is permanent, owned and checkable is the stop — and a picture of a bus
   * marking a bus stop is exactly what a paper map does. `ENTRANCE_BUS_DOOR_X`
   * names where the bus's **door** comes to rest, dead in front of the gate,
   * which is both the half a child cares about and the stable half: the door is
   * the fixed target and `ArrivalSequence` works the vehicle's centre back from
   * it through `bus.doorDrop`, so a longer bus still stops with its door here.
   *
   * This lands on the road just outside the boundary wall, which is correct
   * and deliberate: a bus is not a park vehicle, and it parking inside the park
   * is the exact thing Jim objected to on 7 August 2026 (#195). It is still
   * inside the map's viewport, which frames `PARK_BOUNDARY.extent` — the
   * boundary bulges past z = 71 either side of the gate.
   */
  // Asked of the road, not of a coordinate that used to describe it: the kerb
  // follows the park's edge now, so where the bus stands is `entranceRoadAt(0)`.
  features.push({ id: 'catBus', kind: 'catBus', x: ENTRANCE_BUS_DOOR_X, z: entranceRoadAt(0).z });

  for (const anchor of ANCHORS) {
    if (anchor.id === 'building') continue;
    // The ride's own centre, which is what the picture depicts and what its
    // footprint is drawn around. Not the entrance: the entrance is where the
    // path arrives, several metres off the ride itself, and a picture of a
    // ferris wheel standing on its queue rather than on the wheel is the same
    // class of error as the booth substitution above.
    const [x, z] = anchor.position;
    features.push({ id: anchor.id, kind: 'anchor', x, z });
  }

  for (const [id, placement] of Object.entries(STALL_PLACEMENTS)) {
    if (STALLS_DUPLICATING_A_RIDE.has(id)) continue;
    const [x, z] = placement.position;
    features.push({ id, kind: 'stall', x, z });
  }

  features.push({ id: 'fountain', kind: 'fountain', x: facts.fountain.x, z: facts.fountain.z });

  for (const station of facts.stations) {
    features.push({ id: station.id, kind: 'station', x: station.x, z: station.z });
  }

  return features;
}
