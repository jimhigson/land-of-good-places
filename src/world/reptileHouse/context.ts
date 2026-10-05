import type { Group } from 'three';
import type { Rng } from '../../core/mathUtils';
import type { SnakeSegmentPool } from '../../art/models/snake';
import type { LocalPoint } from './layout';
import type { ReptileProps } from './props';
import type { SignAtlas } from './signs';

/**
 * What every part of the hall is built with and talks back through — the
 * exhibits, the planting and the stall all take one of these rather than the
 * `ReptileHouse` itself, so none of them can reach into the building's
 * doors, bounds or player.
 *
 * Everything is **hall-local metres**; `root` sits at the hall's world
 * origin, so a child added to it at (x, 0, z) stands at local (x, z).
 */
export interface HallContext {
  readonly root: Group;
  readonly props: ReptileProps;
  readonly atlas: SignAtlas;
  /** Every adult snake's body segments, one draw call. */
  readonly adults: SnakeSegmentPool;
  /** Every baby's and grove snake's segments, one draw call. */
  readonly babies: SnakeSegmentPool;
  readonly rng: Rng;
  /** A speech bubble over a spot, for a few seconds. */
  say(text: string, at: LocalPoint, y: number): void;
  /** A puff of hearts over a spot. */
  hearts(at: LocalPoint, y: number): void;
  /** An exhibit was greeted — towards the "Reptile friend" deed. */
  greet(exhibitId: string): void;
  /** A hidden baby was found — towards the "Snake spotter" secret. */
  findBaby(index: number): void;
  /** Open a shop panel — the stall's, the nursery's. */
  openShop(shopId: string): void;
  /** How tall she is right now, hat and all, in metres. */
  playerHeight(): number;
}
