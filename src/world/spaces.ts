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
 * When Decision 3 lands, `SpaceManager` (`world/building/spaces.ts`) becomes
 * the authority on which space the player is in, and this table grows one entry
 * per floor. `castle` then stops resolving, {@link localToWorld} returns `null`
 * for it, and a save written tonight spawns tomorrow's player on the plaza with
 * everything else intact. That is the intended failure, not an oversight.
 */

import { INTERIOR_HALF_X, INTERIOR_HALF_Z, INTERIOR_ORIGIN_X, INTERIOR_ORIGIN_Z } from '../core/constants';
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
 * Everything inside the big building, all five decks of it.
 *
 * One space today because the decks share one coordinate system and are told
 * apart by height. Decision 3 replaces this single id with one per floor; see
 * the file comment for what that does to an old save.
 */
export const SPACE_CASTLE: SpaceId = 'castle';

interface SpaceOrigin {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const ORIGINS: Readonly<Record<SpaceId, SpaceOrigin>> = {
  [SPACE_GARDEN]: { x: 0, y: 0, z: 0 },
  // The interior's own floor-plate origin: its ground-floor deck height, and
  // the same pair `world/building/layout.ts`'s `worldX`/`worldZ` add.
  [SPACE_CASTLE]: { x: INTERIOR_ORIGIN_X, y: BUILDING_BASE_Y, z: INTERIOR_ORIGIN_Z },
};

/**
 * How far past the interior's floor plate still counts as being in it.
 *
 * Generous — the roof terrace overhangs, and anybody who walks off the edge of
 * deck zero lands on the plaza disc below — but nowhere near the 600 m to the
 * garden, so the two can never be confused. Decision 3 specifies a per-space
 * radius of 120 m for the same test; this is that test, one space early.
 */
const CASTLE_RADIUS = Math.max(INTERIOR_HALF_X, INTERIOR_HALF_Z) + 90;

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
  const dx = x - INTERIOR_ORIGIN_X;
  const dz = z - INTERIOR_ORIGIN_Z;
  return dx * dx + dz * dz <= CASTLE_RADIUS * CASTLE_RADIUS ? SPACE_CASTLE : SPACE_GARDEN;
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
