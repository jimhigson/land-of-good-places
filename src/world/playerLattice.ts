import { PLAYER_RADIUS } from '../core/constants';
import { JUMP_APEX_HEIGHT } from '../entities/Player';
import type { CollisionWorld } from './Collision';
import { NavGrid } from './NavGrid';
import type { LevelConnector } from './building/surfaces';

/** What {@link playerNavGrid} needs of the world: its solids, its stairs, its bridges. */
export interface PlayerLatticeWorld {
  readonly collision: CollisionWorld;
  readonly building: { readonly surfaces: { readonly connectors: readonly LevelConnector[] } };
  readonly train: { readonly bridges: readonly { covers(x: number, z: number): boolean }[] };
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
 * - her own width and jump (`PLAYER_RADIUS`, `JUMP_APEX_HEIGHT`);
 * - the declared ways between levels — the lobby's stair (Decision 11);
 * - every railway bridge's deck and ramps (#116, Decision 8);
 * - **and she stands on solids** (`NavGrid`'s `standsOnSolids`): a bed, a
 *   bench, a cushion within one step of the floor is somewhere she walks, so
 *   the route may cross it, as the engine lets her.
 */
export function playerNavGrid(world: PlayerLatticeWorld): NavGrid {
  return new NavGrid(
    world.collision,
    PLAYER_RADIUS,
    JUMP_APEX_HEIGHT,
    () => world.building.surfaces.connectors,
    (x, z) => world.train.bridges.some((bridge) => bridge.covers(x, z)),
    null,
    true,
  );
}
