import { PARADE_MEMBER_RADIUS } from '../../core/constants';
import { NavGrid } from '../../world/NavGrid';
import type { World } from '../../world/World';

/**
 * **The map a companion's bedtime walk is routed on** — issue #602.
 *
 * The same {@link NavGrid} class the player's tap-to-walk and every NPC child
 * plan on, and the same lattice code, laid out for a companion instead of for
 * her. `Game` hands one to `Parade`; `check-hotel.mts` builds one for the same
 * parade in its own headless park.
 *
 * **It is a function rather than two `new NavGrid(...)` calls because there
 * were nearly two**, and the ones a walker's grid takes are exactly the
 * arguments that go quietly stale: a hand-copied connector list in the check
 * would keep passing while the real game's pets walked round the outside of a
 * stair, which is this repo's most common bug wearing a router's clothes. One
 * owner, both callers ask.
 *
 * Two ways it differs from the player's own grid, and both are facts about
 * the animal rather than tuning:
 *
 * - **{@link PARADE_MEMBER_RADIUS}, not `PLAYER_RADIUS`** — 0.22 m against her
 *   0.62 m. It matters indoors: the middle bedroom packs ten pet beds close
 *   enough that a companion walks between two of them where she could not fit
 *   at all, and a route planned at her width would stop short of the bed.
 * - **No jump.** A parade member has no hop, so a wall she would clear is a
 *   wall it walks round, and the apex passed in is 0.
 */
export function createPetNavGrid(world: World): NavGrid {
  return new NavGrid(
    world.collision,
    PARADE_MEMBER_RADIUS,
    0,
    () => world.building.surfaces.connectors,
    (x, z) => world.train.bridges.some((bridge) => bridge.covers(x, z)),
  );
}
