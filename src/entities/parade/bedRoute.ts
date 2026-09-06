import type { Vector3 } from 'three';
import type { GroundSampler } from '../Player';
import { MAX_ROUTE_WAYPOINTS, type NavGrid } from '../../world/NavGrid';
import type { PetBedSpot } from '../../world/hotel/Hotel';

/**
 * **The walk to bed, routed** — issue #602.
 *
 * Jim, playing the `?pets=5` preview, 6 September 2026: *"the pets linearly
 * zoom into their beds, including through walls - make them use the normal
 * pathfinding algo like player and npcs use instead."*
 *
 * Bedtime is the one moment a pet navigates on its own account. Everywhere
 * else it follows the player's breadcrumb trail, which is a route she already
 * walked and so cannot cross a wall; at bedtime the parade used to point the
 * follow spring straight at the bed's run-up spot, and the spring is a spring —
 * it has no idea there is a partition in the way. Indoors that is not a rare
 * edge case but the ordinary case: the hotel suite is small rooms joined by
 * doorways, and a companion with no bed in the room she chose is sent to its
 * bed in the *middle* bedroom, so there is **always** a wall between the animal
 * and where it is going.
 *
 * ## It asks the router; it is not a router
 *
 * "How does a body get from A to B" has exactly one owner in this codebase —
 * {@link NavGrid}, baked out of the collision world, with `JourneyPlanner` and
 * `PoiGraph` over it for the children. The player's tap-to-walk plans on it and
 * so does every NPC child, and this now does too: one `findRoute` call at
 * bedtime, and then the ordinary follow spring walked from waypoint to
 * waypoint. There is deliberately no obstacle avoidance in here, no second
 * search, and no knowledge of walls at all — only "which waypoint is this
 * animal on".
 *
 * ## What it does *not* change
 *
 * The mover. A pet still crosses the room on the same critically-damped follow
 * spring, at the same speed, with the same turn-to-face and the same walk
 * cycle, and it still hands itself to `ParadeMember`'s scripted climb by
 * arriving at the run-up spot — so the climb, the pose and the "Z" glyphs are
 * untouched. All that changed is *where the spring is pointed while it walks*.
 *
 * ## Why the last leg is not a waypoint
 *
 * The route ends where the router can end it, which is not always the run-up
 * spot: the middle bedroom packs ten beds tightly enough that a pet walks
 * between them, so a cell beside a bed may well be unstandable to the lattice.
 * Once the last waypoint is reached this stops answering and the parade aims at
 * the exact run-up spot again, exactly as it did before — the same "the last
 * step is the ordinary seek" that `TapNavigator`'s `SHORTFALL_TOLERANCE`
 * comment describes. That leg is inside one room, so there is nothing in it to
 * walk through.
 */

/**
 * How close the **drawn body** must get to a waypoint before it is aimed at the
 * next one, in metres.
 *
 * Much tighter than `TapNavigator.WAYPOINT_RADIUS` (0.7), and for a reason that
 * is specific to this mover rather than a taste difference: the player is
 * pushed out of anything solid by `CollisionWorld` every frame, so cutting a
 * corner by 0.7 m merely scuffs a wall. A parade member has **no collision on
 * its own body** — the parade resolves its *target* and the spring follows —
 * so a corner cut here is a corner cut *through*. Snug enough that the animal
 * visits every waypoint it is given; loose enough that the spring's own settle
 * can never leave it pecking at one for ever.
 */
const WAYPOINT_RADIUS = 0.3;

/**
 * Seconds before a bedtime walk that got no route at all tries again.
 *
 * A route comes back empty only when the lattice does not cover where the
 * animal is standing, which at bedtime should never happen — she is in the
 * suite, the play bounds are the suite. It is here because "never happens"
 * plus a permanent straight line is exactly the silent wall-walking this file
 * exists to delete: retrying costs one early-out inside `findRoute` per pet per
 * half second, and buys the guarantee back.
 */
const RETRY_SECONDS = 0.5;

/** One pet's route to one bed. Held by `Parade`, one per pet on its way. */
export class BedRoute {
  /** `x, z` pairs. Allocated once and overwritten in place — walking to bed
   *  must not make garbage, and there is one of these per companion. */
  private readonly points = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);
  private length = 0;
  private index = 0;
  /** The bed these waypoints lead to, so a re-send re-plans. */
  private planned: PetBedSpot | null = null;
  private retryIn = 0;

  /**
   * Where this animal should be walking **this frame**, written into `out`
   * as `x, z` (the caller owns `y`), or `false` when the route has nothing
   * left to say and the parade should aim at the run-up spot itself.
   *
   * `bodyX, bodyZ` are the drawn body's own plan position, taken off
   * `ParadeMember.root` by the caller — never the target, which is a waypoint
   * from the first frame and would call every leg walked before the animal had
   * moved at all. (The same trap `ParadeMember`'s own arrival checks name.)
   */
  advance(
    navGrid: NavGrid,
    sampler: GroundSampler,
    bed: PetBedSpot,
    bodyX: number,
    bodyZ: number,
    bodyY: number,
    dt: number,
    out: Vector3,
  ): boolean {
    if (this.planned !== bed) {
      this.plan(navGrid, sampler, bed, bodyX, bodyZ, bodyY);
    } else if (this.length === 0) {
      this.retryIn -= dt;
      if (this.retryIn <= 0) this.plan(navGrid, sampler, bed, bodyX, bodyZ, bodyY);
    }

    while (this.index < this.length) {
      const x = this.points[this.index * 2]!;
      const z = this.points[this.index * 2 + 1]!;
      if (Math.hypot(bodyX - x, bodyZ - z) > WAYPOINT_RADIUS) {
        out.x = x;
        out.z = z;
        return true;
      }
      this.index += 1;
    }
    return false;
  }

  /** Forget the route. Called when a pet is stood back down, so the next nap
   *  plans afresh from wherever it has got to rather than replaying an old one. */
  clear(): void {
    this.planned = null;
    this.length = 0;
    this.index = 0;
  }

  private plan(
    navGrid: NavGrid,
    sampler: GroundSampler,
    bed: PetBedSpot,
    bodyX: number,
    bodyZ: number,
    bodyY: number,
  ): void {
    this.planned = bed;
    this.index = 0;
    this.retryIn = RETRY_SECONDS;
    this.length = navGrid.findRoute(
      bodyX,
      bodyZ,
      bodyY,
      bed.runUpX,
      bed.runUpZ,
      bed.runUpY,
      sampler,
      this.points,
    );
  }
}
