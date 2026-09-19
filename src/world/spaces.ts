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
 * before the split names a space that no longer exists, `localToWorld`
 * (`spaceOrigins.ts`) returns `null` for it, and that player spawns on the plaza **with her name,
 * her hat, her Cute-o-dex and her whole parade intact**. That is the intended
 * failure, and it is the reason this file was written a week early.
 *
 * **This module is a leaf on purpose** — `core/constants` and `building/floors`
 * and nothing else — because `spaceAt` is what the step-reach rule
 * (`building/stepReach.ts`) asks to tell indoors from outdoors, and that rule is
 * what `NavGrid` walks, and `parkLayout.ts` floods a `NavGrid` while it is still
 * solving the park. The origins a save is written against need the castle's
 * placed height, which needs the solved layout, so they live in
 * `spaceOrigins.ts`; had they stayed here the layout would have imported the
 * castle which imports the layout, and `PARK_LAYOUT` was read before it
 * existed (a `ReferenceError` on every seed, found landing the procgen rework
 * on the sphere).
 */

import {
  HOTEL_BREAKFAST_Z,
  HOTEL_CORRIDOR_Z,
  HOTEL_GARDEN_Z,
  HOTEL_LOBBY_Z,
  HOTEL_OCEAN_Z,
  HOTEL_ORIGIN_X,
  HOTEL_SUITE_Z,
} from '../core/constants';
import { castleFloorAt } from './building/floors';

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

/**
 * **Every hotel room's Z, written once.**
 *
 * This list used to exist twice — once in the save origins' table and once,
 * spelled out again as a tuple array, inside {@link spaceAt}. Adding a floor therefore
 * meant editing both, and forgetting the second gives a room that is fully
 * built, fully lit and fully furnished but which `spaceAt` reports as
 * `garden`: the lift lands you in it, `Hotel.currentRoom` returns null, and
 * the floor pill goes blank. That is CLAUDE.md's opening bug — two
 * definitions of one thing kept in step by hand — so there is now one.
 */
export const HOTEL_ROOM_Z: readonly (readonly [SpaceId, number])[] = [
  [SPACE_HOTEL_LOBBY, HOTEL_LOBBY_Z],
  [SPACE_HOTEL_BREAKFAST, HOTEL_BREAKFAST_Z],
  [SPACE_HOTEL_CORRIDOR, HOTEL_CORRIDOR_Z],
  [SPACE_HOTEL_SUITE, HOTEL_SUITE_Z],
  [SPACE_HOTEL_GARDEN, HOTEL_GARDEN_Z],
  [SPACE_HOTEL_OCEAN, HOTEL_OCEAN_Z],
];

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
