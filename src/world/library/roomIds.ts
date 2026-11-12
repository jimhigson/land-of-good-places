/**
 * **The reading room's names and reaches that the building asks before the
 * room is here** — the zone ids its creatures' chips and bubbles answer to, and
 * the dragon's reach.
 *
 * `Library.ts` loads with the park and builds every chip in the reading room,
 * but the owl, the cat and the dragon themselves are in the room's lazy chunk
 * (`room.ts`, `world/interiors.ts`'s `LIBRARY_ROOM`): a constant imported from
 * `LibraryOwl.ts` would pull the whole owl, her kit and the room with her into
 * the boot. So the figures both sides need live here, once, and the creature
 * modules re-export them where they always were. No imports.
 */

/** The owl's Talk zone's id — and the item her bubble answers (`LibraryOwl.ts`). */
export const OWL_ZONE_ID = 'library-owl';

/** Its Say hi zone's id (`Library.ts` builds the zone) — the item the dragon's words' bubble answers. */
export const DRAGON_ZONE_ID = 'library-dragon';

/** Her Pet zone's id (`Library.ts` builds the zone) — the item her purr's bubble answers. */
export const CAT_ZONE_ID = 'library-cat';

/**
 * **"Say hi!" is offered within this of the nest's middle, from every side**
 * (metres) — the zone's reach is measured from the nest (`reachX/reachZ`),
 * not from its stand, so a child who walks up against the dragon on the keys
 * from the east, the north or the west, or bumps its nest head-on, gets the
 * chip. (Measured from the stand alone at 0.55 m, the chip almost never came
 * on the keys: PR #739's QA round 2, 48 approaches.) The stand stays inside it
 * with a tapped walk's arrival to spare (`ARRIVE_RADIUS`), asserted in
 * `LibraryDen.ts`, so a tap still lands her in reach.
 */
export const DRAGON_REACH_RADIUS = 3;

/** The zone's reach, for `Library.ts`'s Say hi zone. */
export const DRAGON_STAND_RADIUS = DRAGON_REACH_RADIUS;
