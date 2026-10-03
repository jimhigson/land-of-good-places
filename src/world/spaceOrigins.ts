/**
 * **Where each space's origin stands — the frame a save records a position in.**
 *
 * Split out of `spaces.ts` because a castle floor's origin is at the castle's
 * placed height (`BUILDING_BASE_Y`), which is derived from the solved park
 * layout — and `spaces.ts` must stay a leaf (see its header). Everything a save
 * needs is here: `worldToLocal` when writing, `localToWorld` when reading, and
 * `null` for a space the running build no longer knows.
 */

import { HOTEL_FLOOR_Y, HOTEL_ORIGIN_X } from '../core/constants';
import { registerPlanCache } from '../boot/planCaches';
import { CASTLE_FLOORS } from './building/floors';
import { BUILDING_BASE_Y } from './building/layout';
import { HOTEL_ROOM_Z, SPACE_GARDEN, type SpaceId } from './spaces';

interface SpaceOrigin {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function originsNow(): Readonly<Record<SpaceId, SpaceOrigin>> {
  return {
  [SPACE_GARDEN]: { x: 0, y: 0, z: 0 },
  // Every castle floor stands at the same height — they are not stacked any
  // more, so `BUILDING_BASE_Y` is simply the floor you walk on, on all three.
  ...Object.fromEntries(
    CASTLE_FLOORS.map((floor) => [
      floor.space,
      { x: floor.originX, y: BUILDING_BASE_Y, z: floor.originZ },
    ]),
  ),
  ...Object.fromEntries(
    HOTEL_ROOM_Z.map(([space, z]) => [space, { x: HOTEL_ORIGIN_X, y: HOTEL_FLOOR_Y, z }]),
  ),
  };
}
let originsMemo: Readonly<Record<SpaceId, SpaceOrigin>> | null = null;
/** Built on first use: the castle's floor height is decided by the park's driver, not at import. */
function origins(): Readonly<Record<SpaceId, SpaceOrigin>> {
  return (originsMemo ??= originsNow());
}
registerPlanCache(() => {
  originsMemo = null;
});

/** World position -> the offset a save records, relative to its space. */
export function worldToLocal(
  space: SpaceId,
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number } {
  const origin = origins()[space] ?? origins()[SPACE_GARDEN];
  // `SPACE_GARDEN` is a literal key of the origins table, so this cannot actually be
  // undefined; the fallback is for a caller that invented an id.
  if (!origin) return { x, y, z };
  return { x: x - origin.x, y: y - origin.y, z: z - origin.z };
}

/**
 * A saved offset -> world position, or `null` if that space no longer exists.
 *
 * `null` is the whole point of the space id (see the file comment): the caller
 * spawns at the default place and loads everything else.
 */
export function localToWorld(
  space: SpaceId,
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number } | null {
  const origin = origins()[space];
  if (!origin) return null;
  return { x: x + origin.x, y: y + origin.y, z: z + origin.z };
}
