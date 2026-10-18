import { PLAYER_PUT_DOWN } from '../entities/Player';
import type { CollisionWorld } from './Collision';
import { NavGrid } from './NavGrid';
import type { LevelConnector } from './building/surfaces';

/**
 * What {@link playerNavGrid} needs of the world: its solids, and the router's
 * two other inputs from their one owner, `World` (`routeConnectors`,
 * `routeBridgeCovers`) — which the put-down rule's windows of this lattice
 * read too (`World.putDownSpace`).
 */
export interface PlayerLatticeWorld {
  readonly collision: CollisionWorld;
  readonly routeConnectors: () => readonly LevelConnector[];
  readonly routeBridgeCovers: (x: number, z: number) => boolean;
}

/**
 * **The player's own route lattice** — the one her tap-to-walk plans on and
 * her parade shares (`Game.ts`), and the one a check that means "the router
 * she walks with" must build.
 *
 * One owner because it had two: `Game.ts` built it and `check:hotel` rebuilt
 * it beside it, "with exactly the arguments `Game.ts` gives it", which is the
 * repo's most common bug waiting to happen (CLAUDE.md, "two definitions of
 * one thing").
 *
 * - her own body, from the one object the put-down rule measures her by
 *   (`PLAYER_PUT_DOWN`): her width and her jump;
 * - the declared ways between levels — the lobby's stair (Decision 11);
 * - every railway bridge's deck and ramps (#116, Decision 8);
 * - **and she stands on solids** (`NavGrid`'s `standsOnSolids`): a bed, a
 *   bench, a cushion within one step of the floor is somewhere she walks, so
 *   the route may cross it, as the engine lets her. The put-down rule's
 *   windows (`NavGrid.around`) are built the same way, from the same object.
 */
export function playerNavGrid(world: PlayerLatticeWorld): NavGrid {
  return new NavGrid(
    world.collision,
    PLAYER_PUT_DOWN.radius,
    PLAYER_PUT_DOWN.hopApex,
    world.routeConnectors,
    world.routeBridgeCovers,
    null,
    PLAYER_PUT_DOWN.standsOnSolids,
  );
}
