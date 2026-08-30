import {
  BUILDING_BASE_Y,
  facadeX,
  facadeZ,
  worldX,
  worldZ,
} from '../../world/building/layout';
import { castleEntranceBand, castleExitBand } from '../../world/building/Building';
import { BUILDING_HALF_Z, INTERIOR_HALF_Z } from '../../core/constants';
import { SPACE_CASTLE_MALL, SPACE_GARDEN, type SpaceId } from '../../world/spaces';

/**
 * How a child gets from one space to another — issue #350.
 *
 * `poiGraph.ts` states the rule this file implements: *"Crossing between spaces
 * is a **portal**, not a walk, and belongs to the building."* The garden and
 * the castle's interior are six hundred metres apart with nothing but empty
 * world between them, so a route planned across the gap would be a very long
 * stroll through nothing. Two spaces are joined by a door, and a door is a
 * step, not a path.
 *
 * ## Why children needed this at all
 *
 * Jim's original sentence ended *"This can include things inside the castle."*
 * The first cut of #350 built the castle's shops into the attraction list, gave
 * the planner a castle lattice and threaded the deck connectors through — and
 * **none of it ever ran**, because children spawn only on garden waypoints and
 * nothing could ever move one across the threshold. A ten-minute census of the
 * running park found 14400 of 14400 child-samples outdoors and not one shop
 * ever chosen. Every castle-side piece was unreachable code, while this file's
 * neighbours confidently described children the player would meet indoors.
 * There were none. This is what makes them real.
 *
 * ## Nothing here is a coordinate
 *
 * Both doors are **derived from the building's own portal bands** —
 * `castleEntranceBand()` and `castleExitBand()`, the same two functions the
 * *player's* threshold test uses (`Building.updateSpaceChange`). And both
 * landing spots are the ones the player is put down on,
 * `Building.enterInterior`/`leaveInterior`, taken from the same layout helpers
 * rather than copied as numbers.
 *
 * That matters more than it looks. If the castle's front door moves, the
 * player's crossing and the children's crossing move together, because they are
 * reading the same thing. A pasted coordinate here would put children walking
 * into a wall the week somebody nudged the facade — the exact failure mode
 * `poiGraph.ts`'s "nothing here is typed in" section was written about.
 */
export interface Portal {
  readonly id: string;
  /** The space a child must be standing in to use it. */
  readonly from: SpaceId;
  /** Where they end up. */
  readonly to: SpaceId;
  /** Walk to here, in {@link from} — the door, from this side. */
  readonly nearX: number;
  readonly nearZ: number;
  readonly nearY: number;
  /** Step out here, in {@link to}. */
  readonly farX: number;
  readonly farY: number;
  readonly farZ: number;
  /** Which way to be facing on arrival, in radians. */
  readonly farFacing: number;
}

/**
 * How far into the interior a child lands — the same 6.5 m clear of the south
 * wall that `Building.enterInterior` puts the player, and for the reason its
 * comment gives: the camera looks in along the +X+Z diagonal, so anybody
 * standing on the threshold is behind the south wall's parapet.
 */
const INTERIOR_LANDING_INSET = 6.5;

/** How far out into the park a child lands, matching `leaveInterior`. */
const GARDEN_LANDING_OUTSET = 2.4;

/**
 * The doors, both ways. Built on demand rather than at module load, because
 * the bands are functions of a *generated* park and this file must not pin
 * them at import time.
 */
export function castlePortals(
  /** The game's own ground sampler, for the garden side's terrain height. */
  sample: (x: number, z: number, y: number) => number,
): Portal[] {
  const inBand = castleEntranceBand();
  const outBand = castleExitBand();

  const gardenDoorX = inBand.centreX;
  const gardenDoorZ = inBand.centreZ;
  // Where `leaveInterior` puts the player: just outside the facade, facing +Z
  // out into the park, which is also the way the camera looks.
  const gardenLandingX = facadeX(1.5);
  const gardenLandingZ = facadeZ(BUILDING_HALF_Z + GARDEN_LANDING_OUTSET);

  return [
    {
      id: 'portal:castle-in',
      from: SPACE_GARDEN,
      to: SPACE_CASTLE_MALL,
      nearX: gardenDoorX,
      nearZ: gardenDoorZ,
      nearY: sample(gardenDoorX, gardenDoorZ, BUILDING_BASE_Y + 1),
      farX: worldX(0),
      farY: BUILDING_BASE_Y,
      farZ: worldZ(INTERIOR_HALF_Z - INTERIOR_LANDING_INSET),
      // Facing north, into the room — `enterInterior`'s own facing.
      farFacing: Math.PI,
    },
    {
      id: 'portal:castle-out',
      from: SPACE_CASTLE_MALL,
      to: SPACE_GARDEN,
      nearX: outBand.centreX,
      nearZ: outBand.centreZ,
      nearY: outBand.y,
      farX: gardenLandingX,
      farY: sample(gardenLandingX, gardenLandingZ, BUILDING_BASE_Y + 1),
      farZ: gardenLandingZ,
      farFacing: 0,
    },
  ];
}

/**
 * The portal that gets a child in `from` closer to `goal`, or `null` if there
 * is none.
 *
 * One hop only, deliberately: the park has exactly two joined spaces today and
 * a child who needs two doors to reach a shop would be walking a plan far
 * longer than anything they can be relied on to finish. The hotel's rooms are
 * their own spaces and have no portal here at all, so their residents — who are
 * on `WaypointDriver` anyway — are unaffected.
 */
export function portalToward(
  portals: readonly Portal[],
  from: SpaceId,
  goal: SpaceId,
): Portal | null {
  for (const portal of portals) {
    if (portal.from === from && portal.to === goal) return portal;
  }
  return null;
}
