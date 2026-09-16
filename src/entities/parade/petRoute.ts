import type { Vector3 } from 'three';
import type { GroundSampler } from '../Player';
import { MAX_ROUTE_WAYPOINTS, type NavGrid } from '../../world/NavGrid';

/**
 * **How a companion gets anywhere it is not already** — issues #602 and #605.
 *
 * Jim, playing the `?pets=5` preview: first *"the pets linearly zoom into their
 * beds, including through walls"* (#602), then, on the fix for that: *"when
 * they get out of bed they warp through walls again - I think this might be a
 * wider bug - the pets should ALWAYS use normal path finding by default to get
 * to where they need to go, including while following the player in a parade
 * formation."* (#605).
 *
 * ## It asks the router; it is not a router
 *
 * "How does a body get from A to B" has exactly one owner in this codebase —
 * {@link NavGrid}, baked out of the collision world. The player's tap-to-walk
 * plans on it and so does every NPC child, and a companion now does too, **on
 * the very same grid instance** rather than one of its own. This class is only
 * the bookkeeping between planning a route and walking it: no avoidance, no
 * second search, and nothing in here that knows a wall from a doorway.
 *
 * ### A companion-sized grid was tried, measured and deleted
 *
 * #602 shipped a `createPetNavGrid` that built a second `NavGrid` at
 * `PARADE_MEMBER_RADIUS` with no jump, on the reasoning that a pet is a third
 * her width and cannot hop. Measured on the built park, that distinction buys
 * nothing and costs a great deal, so it is gone — **do not re-add it.** A cold
 * lattice build in the garden, timed four ways:
 *
 * | walker radius | jump apex | first route |
 * |---|---|---|
 * | 0.62 m (player) | 1.2812 m | 919 ms |
 * | 0.22 m (companion) | 0 | 896 ms |
 * | 0.22 m | 1.2812 m | 843 ms |
 * | 0.62 m | 0 | 817 ms |
 *
 * The walker is not what the lattice costs. A second grid would therefore have
 * charged the first nap another ~0.4–1.0 s of blocked main thread (the hotel
 * suite measures 996 ms cold, 431 ms warm) to model a difference worth nothing.
 * Sharing the player's grid also makes "one owner" literal rather than
 * rhetorical. The one thing the wider walker costs — a run-up spot wedged
 * between two tightly packed pet beds can be unstandable at her width — is
 * already handled by the last-leg rule below. See #607 for the lattice build
 * itself, which freezes the player's own first tap in every space.
 *
 * ## Why the last leg is not a waypoint
 *
 * A route ends where the router can end it, which is not always the goal: the
 * middle bedroom packs ten beds close enough that a companion walks between
 * two of them, so a cell beside a bed may well be unstandable to a lattice
 * fattened by the player's width. Once the last waypoint is reached this stops
 * answering and the caller aims at the exact goal again — the same "the last
 * step is the ordinary seek" that `TapNavigator`'s `SHORTFALL_TOLERANCE`
 * comment describes. That leg is short and inside one room, so there is
 * nothing in it to walk through.
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
 * Seconds before a walk that got no route at all tries again.
 *
 * A route comes back empty only when the lattice does not cover where the
 * animal is standing. It is here because "never happens" plus a permanent
 * straight line is exactly the silent wall-walking this file exists to delete:
 * retrying costs one early-out inside `findRoute` per pet per half second, and
 * buys the guarantee back. Every such frame is counted (see
 * {@link PetRoute.advance}'s caller) so a run can say out loud how often it was
 * not routing.
 */
const RETRY_SECONDS = 0.5;

/**
 * How far a **moving** goal may drift from the one a route was planned to
 * before the route is thrown away and planned again, in metres.
 *
 * Bedtime has a goal that never moves, so this never fires there. Re-forming
 * behind a walking player does: the trail point a pet is heading for slides
 * away as she goes. Loose enough that a pet crossing one room re-plans once or
 * twice rather than every stride; tight enough that the route it is walking
 * still leads roughly where the line now is.
 */
const REPLAN_DRIFT = 2;

/** Least seconds between two plans for one companion. Guards the drift rule
 *  against a goal that moves smoothly and would otherwise re-plan per frame. */
const REPLAN_COOLDOWN = 0.35;

/** One companion's route to one place. Held by `Parade`, one per companion. */
export class PetRoute {
  /** `x, z` pairs. Allocated once and overwritten in place — walking must not
   *  make garbage, and there is one of these per companion. */
  private readonly points = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);
  private length = 0;
  private index = 0;
  /** True once a plan has been made and not cleared. */
  private planned = false;
  /** The goal that plan was made for, so a moved goal can be noticed. */
  private goalX = 0;
  private goalZ = 0;
  private retryIn = 0;
  private sincePlan = 0;

  /** How many times this companion's route has actually been planned. Read by
   *  `Parade` so a check can report the routing cost it really paid. */
  plans = 0;

  /**
   * **Did the last plan come back with anything at all?**
   *
   * This is what separates the two very different things a `false` from
   * {@link advance} can mean, and `Parade` counts them apart because #605 asks
   * for the fallback to be visible: a route that ran out of waypoints has
   * genuinely routed and is on its short last leg, while a route that never
   * had any is a companion moving with no router behind it — the failure this
   * whole file exists to make impossible.
   */
  get hasRoute(): boolean {
    return this.length > 0;
  }

  /**
   * Where this animal should be walking **this frame**, written into `out`
   * as `x, z` (the caller owns `y`), or `false` when the route has nothing
   * left to say and the caller should aim at the goal itself.
   *
   * `bodyX, bodyZ` are the drawn body's own plan position, taken off
   * `ParadeMember.root` by the caller — never the target, which is a waypoint
   * from the frame it is written and would call every leg walked before the
   * animal had moved at all. (The same trap `ParadeMember`'s own arrival
   * checks name.)
   */
  advance(
    navGrid: NavGrid,
    sampler: GroundSampler,
    goalX: number,
    goalZ: number,
    goalY: number,
    bodyX: number,
    bodyZ: number,
    bodyY: number,
    dt: number,
    out: Vector3,
  ): boolean {
    this.sincePlan += dt;
    const drifted = Math.hypot(goalX - this.goalX, goalZ - this.goalZ) > REPLAN_DRIFT;

    if (!this.planned) {
      this.plan(navGrid, sampler, goalX, goalZ, goalY, bodyX, bodyZ, bodyY);
    } else if (drifted && this.sincePlan >= REPLAN_COOLDOWN) {
      this.plan(navGrid, sampler, goalX, goalZ, goalY, bodyX, bodyZ, bodyY);
    } else if (this.length === 0) {
      this.retryIn -= dt;
      if (this.retryIn <= 0) {
        this.plan(navGrid, sampler, goalX, goalZ, goalY, bodyX, bodyZ, bodyY);
      }
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
    // Every waypoint walked. **The route stays planned**, deliberately: a
    // route that honestly stops short of its goal — the ordinary case for a
    // run-up spot wedged between two pet beds — would otherwise be re-planned
    // every frame, and each fresh plan resets to a first waypoint the animal
    // has already passed, so it jitters on the spot and never arrives. (It
    // did: 1 of 3 companions failed to reach its bed in 10 s, over 187 plans,
    // the first time this was written the other way.) A goal that is still
    // moving is caught by the drift rule above instead; a goal that is not is
    // finished by the caller's own short seek, which is the last-leg rule in
    // the file comment.
    return false;
  }

  /**
   * Forget the route. Called when a companion is back on the line, or is stood
   * down from a bed, so the next walk plans afresh from wherever the body has
   * got to rather than replaying waypoints laid out for a body that was
   * somewhere else entirely.
   */
  clear(): void {
    this.planned = false;
    this.length = 0;
    this.index = 0;
  }

  private plan(
    navGrid: NavGrid,
    sampler: GroundSampler,
    goalX: number,
    goalZ: number,
    goalY: number,
    bodyX: number,
    bodyZ: number,
    bodyY: number,
  ): void {
    this.planned = true;
    this.index = 0;
    this.retryIn = RETRY_SECONDS;
    this.sincePlan = 0;
    this.goalX = goalX;
    this.goalZ = goalZ;
    this.plans += 1;
    this.length = navGrid.findRoute(
      bodyX,
      bodyZ,
      bodyY,
      goalX,
      goalZ,
      goalY,
      sampler,
      this.points,
    );
  }
}
