/**
 * Named places, and the origins they sit at.
 *
 * The park is not one continuous coordinate system and has not been since the
 * building became bigger on the inside: the interior is a 60 x 44 m floor plate
 * six hundred metres from the garden (`core/constants.ts`'s `INTERIOR_ORIGIN_X`
 * doc comment). ARCHITECTURE-DECISIONS **Decision 3** takes that further —
 * each castle floor becomes its own space at its own far-off origin, 300 m
 * apart, and `deckAt(x, z, y)` becomes `spaceAt(x, z)`.
 *
 * That is why this file exists, and why it exists *now*, before the split:
 * **a saved position must be a space id plus a local offset, never a raw world
 * coordinate.** A world `x` of 612 means "beside the lift" tonight and
 * "somewhere in the middle of nothing" the week Decision 3 lands. `castle` plus
 * `(12, 0, 4)` survives the change or, at worst, degrades to "we no longer know
 * that place" — and a save that does not know where she was standing still
 * knows her name, her hat, her Cute-o-dex and her whole parade.
 *
 * **Decision 3 has now landed** (#377/#380). The castle is three disjoint
 * floors — `world/building/floors.ts` owns the table — and this file simply
 * folds them in beside the hotel's rooms. The old single `castle` id is gone,
 * exactly as the paragraph that used to stand here predicted: a save written
 * before the split names a space that no longer exists, {@link localToWorld}
 * returns `null` for it, and that player spawns on the plaza **with her name,
 * her hat, her Cute-o-dex and her whole parade intact**. That is the intended
 * failure, and it is the reason this file was written a week early.
 */

import {
  HOTEL_BREAKFAST_Z,
  HOTEL_CORRIDOR_Z,
  HOTEL_FLOOR_Y,
  HOTEL_GARDEN_Z,
  HOTEL_LOBBY_Z,
  HOTEL_OCEAN_Z,
  HOTEL_ORIGIN_X,
  HOTEL_SUITE_Z,
} from '../core/constants';
import { CASTLE_FLOORS, castleFloorAt } from './building/floors';
import { BUILDING_BASE_Y } from './building/layout';

/**
 * A place, as a save file names it.
 *
 * A plain string rather than a union, deliberately: a save is read by whatever
 * build happens to be running, which may be older *or* newer than the one that
 * wrote it, so "an id I do not recognise" has to be an ordinary answer rather
 * than a type error. {@link localToWorld} returns `null` for one.
 */
export type SpaceId = string;

/** The garden, the park, everything outdoors. The world origin. */
export const SPACE_GARDEN: SpaceId = 'garden';

/**
 * **The castle's three floors — each its own space**, disjoint and hundreds of
 * metres apart, joined only by the lift (Jim's ruling on #377/#380, and the
 * same shape as the hotel below).
 *
 * Re-exported rather than declared: `world/building/floors.ts` is the one owner
 * of which floors exist, what they are called and where they stand, because the
 * castle's own plan needs the same table and a second copy of it here would be
 * this repo's commonest bug. That file imports nothing but `core/constants`,
 * which is what keeps it out of this module's own import cycle.
 *
 * There was a single `castle` id until 30 August 2026, covering all five stacked
 * decks at once; see the file comment for what its disappearance does to a save
 * written before then.
 */
export {
  SPACE_CASTLE_HALL,
  SPACE_CASTLE_MALL,
  SPACE_CASTLE_ROOF,
} from './building/floors';

/**
 * The Land Hotel's rooms — each one **its own space** (Jim's ruling on issue
 * #236): entirely disjoint worlds joined only by doors and the lift, exactly
 * the shape Decision 3 wants for the castle's floors. Bigger on the inside
 * than the outside is the point, not a compromise. Fifty storeys exist in
 * the fiction; four rooms exist in the world.
 */
export const SPACE_HOTEL_LOBBY: SpaceId = 'hotel.lobby';
export const SPACE_HOTEL_BREAKFAST: SpaceId = 'hotel.breakfast';
export const SPACE_HOTEL_CORRIDOR: SpaceId = 'hotel.corridor';
export const SPACE_HOTEL_SUITE: SpaceId = 'hotel.suite';
/**
 * Two floors with schemes of their own — Jim, 7 August 2026: *"you should be
 * able to go to certain other floors with their own schemes."* Floor 12 is an
 * indoor meadow and Floor 33 is under the sea; `world/hotel/layout.ts` owns
 * what they look like and `core/constants.ts` owns where they are.
 */
export const SPACE_HOTEL_GARDEN: SpaceId = 'hotel.garden';
export const SPACE_HOTEL_OCEAN: SpaceId = 'hotel.ocean';

interface SpaceOrigin {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * **Every hotel room's Z, written once.**
 *
 * This list used to exist twice — once in `ORIGINS` and once, spelled out
 * again as a tuple array, inside {@link spaceAt}. Adding a floor therefore
 * meant editing both, and forgetting the second gives a room that is fully
 * built, fully lit and fully furnished but which `spaceAt` reports as
 * `garden`: the lift lands you in it, `Hotel.currentRoom` returns null, and
 * the floor pill goes blank. That is CLAUDE.md's opening bug — two
 * definitions of one thing kept in step by hand — so there is now one.
 */
const HOTEL_ROOM_Z: readonly (readonly [SpaceId, number])[] = [
  [SPACE_HOTEL_LOBBY, HOTEL_LOBBY_Z],
  [SPACE_HOTEL_BREAKFAST, HOTEL_BREAKFAST_Z],
  [SPACE_HOTEL_CORRIDOR, HOTEL_CORRIDOR_Z],
  [SPACE_HOTEL_SUITE, HOTEL_SUITE_Z],
  [SPACE_HOTEL_GARDEN, HOTEL_GARDEN_Z],
  [SPACE_HOTEL_OCEAN, HOTEL_OCEAN_Z],
];

const ORIGINS: Readonly<Record<SpaceId, SpaceOrigin>> = {
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

/** Rooms are ~30 m across; anywhere within this of a room's origin is in it. */
const HOTEL_ROOM_RADIUS = 70;

/**
 * Which space a world position is in — **purely positional**, exactly as
 * Decision 3 requires of `spaceAt(x, z)`.
 *
 * Position alone answering the question is the load-bearing choice both the
 * original interior offset and Decision 3 made: no mode flag threads through
 * `CollisionWorld` or `WalkSurfaces`, and nothing has to be told when the
 * player changes rooms.
 */
export function spaceAt(x: number, z: number): SpaceId {
  // `castleFloorAt` owns the castle's own radius test, so "which floor am I
  // on?" is asked in exactly one place — `Building` asks it directly all the
  // time, and a second copy of the arithmetic here is how the floor pill and
  // the play bounds would come to disagree.
  const floor = castleFloorAt(x, z);
  if (floor) return floor.space;
  for (const [space, roomZ] of HOTEL_ROOM_Z) {
    const hx = x - HOTEL_ORIGIN_X;
    const hz = z - roomZ;
    if (hx * hx + hz * hz <= HOTEL_ROOM_RADIUS * HOTEL_ROOM_RADIUS) return space;
  }
  return SPACE_GARDEN;
}

/** World position -> the offset a save records, relative to its space. */
export function worldToLocal(
  space: SpaceId,
  x: number,
  y: number,
  z: number,
): { x: number; y: number; z: number } {
  const origin = ORIGINS[space] ?? ORIGINS[SPACE_GARDEN];
  // `SPACE_GARDEN` is a literal key of ORIGINS, so this cannot actually be
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
  const origin = ORIGINS[space];
  if (!origin) return null;
  return { x: x + origin.x, y: y + origin.y, z: z + origin.z };
}
