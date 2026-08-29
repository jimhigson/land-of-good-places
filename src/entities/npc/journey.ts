import { NavGrid, MAX_ROUTE_WAYPOINTS } from '../../world/NavGrid';
import { ARRIVE_RADIUS, WAYPOINT_RADIUS } from '../TapNavigator';
import { PARK_BOUNDARY, circleBoundary, type ParkBoundary } from '../../world/boundary';
import {
  INTERIOR_ORIGIN_X,
  INTERIOR_ORIGIN_Z,
  INTERIOR_PLAY_RADIUS,
  PLAYER_RADIUS,
} from '../../core/constants';
import { JUMP_APEX_HEIGHT } from '../Player';
import { SPACE_CASTLE, SPACE_GARDEN, type SpaceId } from '../../world/spaces';
import type { CollisionWorld } from '../../world/Collision';
import type { GroundSampler } from '../Player';
import type { LevelConnector } from '../../world/building/surfaces';
import type { Rng } from '../../core/mathUtils';
import { NPC_WALK_SPEED } from './NpcCharacter';
import type { Attraction } from './attractions';
import { announcementFor, reachableFrom } from './attractions';
import { castlePortals, portalToward, type Portal } from './portals';

/**
 * A child's trip to somewhere in particular — issue #350.
 *
 * This is what replaced the crowd's random walk, and the replacement is total:
 * there is no "wander" left to fall back on. A child picks an attraction, is
 * given a route to it by **the player's own `NavGrid`**, walks that route, and
 * on arrival picks another one. Jim, 27 August 2026:
 *
 * > "they should randomly choose an attraction in the park to go to, and use
 * > the same pathfinding as the player to get there."
 *
 * ## Why the old mechanism could not be patched
 *
 * `WanderDriver` used to take a uniformly random neighbour of its current
 * `PoiGraph` node, avoiding only the one it had just left. That is a
 * non-backtracking random walk, and a random walk is **diffusive**: run it long
 * enough and the crowd's occupancy converges on a stationary distribution
 * proportional to node degree, weighted by how long a walker dwells at each
 * node. Both weights point at the plaza — six ring nodes packed inside the
 * kerb, mutually visible so the highest degree in the graph, and every one of
 * them `interesting` and so worth a 0.62-chance pause of 1.4–4.2 s. So the
 * park's children pooled at the fountain, which is exactly what Jim saw.
 *
 * No amount of tuning fixes that, because nothing was going anywhere: the
 * distribution *is* the mechanism. Hence a destination, and hence this file
 * rather than a patch to `chooseNext`.
 *
 * ## One pathfinder, two lattices
 *
 * {@link JourneyPlanner} holds a `NavGrid` **per space**, each pinned to that
 * space's own boundary (see `NavGrid`'s `pinnedBoundary`). It is emphatically
 * not a second router: it is the same class the player's tap-to-walk uses, laid
 * over the garden's floor and over the castle's, so a child rounds a tree the
 * same way the player does and stays that way as the pathfinder is tuned.
 *
 * The player's own grid cannot simply be shared, because it follows
 * `collision.playBounds` — which is the *player's* space, swapped as they walk
 * through a door. A park child planning while the player is indoors would be
 * routed on the castle's lattice.
 *
 * ## A plan is not free
 *
 * A* over the park lattice is the single most expensive thing any child does,
 * and twenty-four of them arriving in the same second would all ask at once.
 * The planner therefore hands out a small number of plans per frame
 * ({@link PLANS_PER_FRAME}) and makes everybody else wait a frame or two, which
 * nobody can see: a child who has just arrived somewhere is standing still
 * looking at it anyway. `npm run check:solve-cost` is the guard on this.
 */

/**
 * How many children may plan a route in one frame.
 *
 * Two, not twenty-four. Arrivals cluster — a cohort that set off together
 * arrives together — and a frame that ran two dozen A* searches would be a
 * visible hitch. Waiting a frame costs a child nothing: {@link Journey} keeps
 * steering at the destination in the meantime, and they have only just stopped.
 */
const PLANS_PER_FRAME = 2;

/**
 * How many children may be inside the castle at once.
 *
 * The same order as the other whole-park caps — three climbers, four riders,
 * four being painted — and for the same reason. The castle's seven shops are a
 * third of every destination in the game, so without a cap a third of the park
 * would be indoors, which empties the park the player is standing in and piles
 * children into one room: issue #350's own symptom, reintroduced by its own
 * fix.
 */
export const MAX_INSIDE = 4;

/**
 * Longest a child will pursue one destination before giving up on it.
 *
 * A route can go stale — the level crossing's gates close, a ride's collision
 * appears, another child parks in a doorway — and the honest answer to "I have
 * been walking at this for a minute" is to want something else, not to keep
 * pushing. The old wander core had exactly this idea in its `LEG_TIMEOUT`, at a
 * quarter of a minute; a whole journey is a much longer thing than one leg, so
 * this is longer, but it is the same safety valve and it exists for the same
 * reason: re-choosing is cheaper and far less visible than a rescue teleport.
 */
const JOURNEY_TIMEOUT = 75;

/**
 * How long "I'm going to the Dodgems!" stays up.
 *
 * Long enough to read at a child's reading speed and short enough that the
 * bubble is gone well before they arrive — it is an announcement, not a label.
 */
const ANNOUNCE_SECONDS = 3.4;

/** Jim's number: "they should say 'I'm going to the x' with a 20% chance." */
const ANNOUNCE_CHANCE = 0.2;

/**
 * How close to the destination counts as having arrived.
 *
 * `NavGrid` does not promise to land on the goal — `findRoute` ends at the
 * closest reachable point when the goal itself is blocked, which for an
 * attraction entrance is routine (somebody is standing in it). `TapNavigator`
 * has the same problem and answers it the same way, with a tolerance rather
 * than a demand for the exact spot.
 */
const DESTINATION_RADIUS = 1.8;

/**
 * How many times a child will re-plan before giving up on a destination.
 *
 * `TapNavigator` allows the player one (`REPLAN_ATTEMPTS`), and this is the
 * same idea for the same reason: `findRoute` does not promise to reach the
 * goal — it ends at the closest reachable point and reports that through
 * `lastRouteReachedGoal` — so a route planned through a crowded gateway
 * legitimately stops short, and the answer is to ask again from where you
 * actually got to.
 *
 * Two rather than the player's one, because a child is jostled by twenty-three
 * siblings (`NpcSystem.separate`) and the player is jostled by nobody. Bounded
 * either way: a child who cannot get there after two honest attempts wants
 * somewhere else to go, not an infinite loop of A*.
 */
const REPLAN_ATTEMPTS = 2;

/**
 * How often to ask "are we actually getting anywhere?", and how little
 * progress counts as no.
 *
 * This exists because of a real bug, found by `check-npc-dispersal.mts` before
 * it was even wired into the build: eleven children walked off the cat bus,
 * got as far as the gate, and **stood there for seventy-five seconds** — the
 * whole of {@link JOURNEY_TIMEOUT} — before the timeout forced a re-plan that
 * then worked immediately from the very same spot. Their route had stopped
 * short in the crowd, and pushing at its dead end is not something any test on
 * position alone could see: they were in the right place, facing the right
 * way, and going nowhere.
 *
 * The bar is taken from {@link NPC_WALK_SPEED} rather than typed in, and
 * deliberately so: issue #232 exists because `trace-npc-driver` hard-coded a
 * `WALK_SPEED` that then went stale. A child genuinely walking covers
 * `NPC_WALK_SPEED * STUCK_WINDOW`; a quarter of that is a generous allowance
 * for being shoved about, squeezing past a sibling, or rounding a tight corner,
 * and still nowhere near "standing still".
 */
const STUCK_WINDOW = 3;
const STUCK_FRACTION = 0.25;

/** Boundaries by space — see the file comment. `null` for anywhere unplanned. */
function boundaryFor(space: SpaceId): ParkBoundary | null {
  if (space === SPACE_GARDEN) return PARK_BOUNDARY;
  if (space === SPACE_CASTLE) {
    // The same circle `Building.enterInterior` hands `setPlayBounds`. Taken
    // from the same three constants rather than captured from the collision
    // world, so the child's lattice covers the interior whether or not the
    // player has ever been inside.
    return circleBoundary(INTERIOR_PLAY_RADIUS, INTERIOR_ORIGIN_X, INTERIOR_ORIGIN_Z);
  }
  // The hotel's rooms are their own spaces, and their guests are driven by
  // `WaypointDriver` on a pinned circuit rather than by this. Nothing to plan.
  return null;
}

/**
 * What a {@link Journey} needs from the world in order to go somewhere.
 *
 * An interface rather than the class directly, because a driver's *decisions*
 * are testable without a park. `scripts/trace-npc-driver.mts` drives real
 * `WanderDriver`s over a synthetic 5x5 waypoint grid with **no
 * `CollisionWorld` at all** — its own header says so: "no collision, because
 * collision is not what a driver decides" — and building a `NavGrid` lattice
 * needs a collision world and a park boundary. That script asks whether a
 * child gets wedged and whether the activity budgets hold, and neither
 * question wants a quarter of a million lattice cells behind it.
 *
 * So the shipping implementation is {@link JourneyPlanner} below, and a
 * checker may hand over a simpler one. The driver cannot tell, which is the
 * point.
 */
export interface RoutePlanner {
  beginFrame(): void;
  destinationsIn(space: SpaceId): Attraction[];
  /** The door that gets a child in `from` toward `goal`, or `null`. */
  portalToward(from: SpaceId, goal: SpaceId): Portal | null;
  plan(
    space: SpaceId,
    startX: number,
    startZ: number,
    startY: number,
    goalX: number,
    goalZ: number,
    goalY: number,
    out: Float32Array,
  ): number;
}

/**
 * Every child's shared route planner: one `NavGrid` per space, and a per-frame
 * budget so a crowd of arrivals cannot stall a frame between them.
 */
export class JourneyPlanner implements RoutePlanner {
  private readonly grids = new Map<SpaceId, NavGrid | null>();
  private budget = PLANS_PER_FRAME;
  private readonly portals: Portal[];
  /**
   * How many children are inside the castle right now — **counted**, not
   * booked.
   *
   * `NpcSystem` recounts it every frame from where the children actually are.
   * That is deliberate and it is the same lesson `budget.ts`'s header teaches
   * from the other direction: a claimed-and-released slot leaks the moment one
   * exit forgets to release, and a leaked slot is indistinguishable from the
   * feature being switched off. A child can leave the castle by walking out, by
   * a journey timing out, or by any activity that rejoins them elsewhere — three
   * exits, and a fourth the day somebody adds one. A number recomputed from the
   * world cannot drift from it.
   */
  private insideCount = 0;

  private readonly collision: CollisionWorld;
  private readonly sample: GroundSampler;
  private readonly connectors: () => readonly LevelConnector[];
  private readonly bridgeCovers: (x: number, z: number) => boolean;
  /** Every attraction in the world, in every space. See `attractions.ts`. */
  readonly attractions: readonly Attraction[];

  constructor(
    collision: CollisionWorld,
    sample: GroundSampler,
    connectors: () => readonly LevelConnector[],
    bridgeCovers: (x: number, z: number) => boolean,
    attractions: readonly Attraction[],
  ) {
    this.collision = collision;
    this.sample = sample;
    this.connectors = connectors;
    this.bridgeCovers = bridgeCovers;
    this.attractions = attractions;
    this.portals = castlePortals(sample);
  }

  /** See {@link insideCount} — called once a frame by `NpcSystem`. */
  setInsideCount(count: number): void {
    this.insideCount = count;
  }

  portalToward(from: SpaceId, goal: SpaceId): Portal | null {
    return portalToward(this.portals, from, goal);
  }

  /** Called once a frame by `NpcSystem`, before any child is updated. */
  beginFrame(): void {
    this.budget = PLANS_PER_FRAME;
  }

  /**
   * The grid for a space, built on first use.
   *
   * Lazily, because the castle's lattice is only worth the memory and the
   * build if somebody is actually indoors to walk it, and on a first visit the
   * cost lands inside the door transition's wipe where nothing is smooth
   * anyway.
   */
  private gridFor(space: SpaceId): NavGrid | null {
    const existing = this.grids.get(space);
    if (existing !== undefined) return existing;
    const boundary = boundaryFor(space);
    const grid = boundary
      ? new NavGrid(
          this.collision,
          // The children are the same size as the player as far as the floor is
          // concerned; `NPC_RADIUS` is the push-apart radius, not the walker's.
          // Planning at the player's width is also what makes "the same
          // pathfinding" true — a route the player could not walk is not the
          // player's route.
          PLAYER_RADIUS,
          JUMP_APEX_HEIGHT,
          this.connectors,
          this.bridgeCovers,
          boundary,
        )
      : null;
    this.grids.set(space, grid);
    return grid;
  }

  /**
   * Everywhere a child standing in `space` may choose to go.
   *
   * Somewhere else in this space, or somewhere one door away — but the door
   * closes once {@link MAX_INSIDE} children are already in there. Without that
   * the park empties: every child rolls for the castle independently and the
   * seven shops are a third of everywhere there is to go, which is the same
   * trap the train fell into (issue #350's third cause) with the same symptom,
   * a crowd all in one place. A child indoors may always choose the garden, so
   * the cap can only ever slow the way in, never trap anybody inside.
   */
  destinationsIn(space: SpaceId): Attraction[] {
    const full = this.insideCount >= MAX_INSIDE;
    return this.attractions.filter((a) => {
      if (!reachableFrom(space, a, this.portals)) return false;
      if (full && a.space !== space && a.space === SPACE_CASTLE) return false;
      return true;
    });
  }

  /**
   * Plans a route, if this frame still has the budget for one.
   *
   * Returns the waypoint count written into `out` (x, z pairs), `0` for "no
   * route" and `-1` for "ask again next frame" — which the caller must not
   * confuse, because the first means choose somewhere else and the second
   * means wait.
   */
  plan(
    space: SpaceId,
    startX: number,
    startZ: number,
    startY: number,
    goalX: number,
    goalZ: number,
    goalY: number,
    out: Float32Array,
  ): number {
    if (this.budget <= 0) return -1;
    const grid = this.gridFor(space);
    if (!grid) return 0;
    this.budget -= 1;
    return grid.findRoute(startX, startZ, startY, goalX, goalZ, goalY, this.sample, out);
  }
}

/**
 * One child's current trip: where they are going, the route there, and how far
 * along it they are.
 *
 * Owned by `WanderDriver` and stepped by it. Allocates its route buffer once,
 * at construction — there are twenty-four of these and they are stepped every
 * frame.
 */
export class Journey {
  /** Where this child is going. `null` before the first choice. */
  private goal: Attraction | null = null;

  private readonly route = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);
  private routeLength = 0;
  private routeIndex = 0;
  /** True once a plan has been made for {@link goal}; false while waiting. */
  private planned = false;
  /** Re-plans left before this destination is abandoned. See {@link REPLAN_ATTEMPTS}. */
  private replansLeft = REPLAN_ATTEMPTS;

  private elapsed = 0;

  /**
   * The door this child is walking to, when the destination is in another
   * space. `null` for an ordinary trip across the park.
   *
   * A cross-space journey is two legs: walk to the door, step through, walk to
   * the shop. Only the first is a route — the step is a portal, and `Journey`
   * cannot perform it because a driver may not move a body. It asks instead:
   * {@link portalRequest} goes up through `WanderDriver` for `NpcSystem` to
   * carry out, exactly the way `TreeClimbing` reads `climbPhase` and does the
   * posing. The driver owns the decision; the system owns the character.
   */
  private via: Portal | null = null;
  /** Set on arriving at a door; cleared once `NpcSystem` has done the step. */
  private pendingPortal: Portal | null = null;

  /** Where this child was when progress was last checked, and how long ago. */
  private progressX = 0;
  private progressZ = 0;
  private sinceProgressCheck = 0;

  /** "I'm going to the Dodgems!", while it is still up. */
  private announcement: string | null = null;
  private announceRemaining = 0;

  private readonly rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  /** What this child would say they are doing, or `null`. */
  get bubbleText(): string | null {
    return this.announcement;
  }

  /** Where they are going — read by the dispersal check and for debugging. */
  get destination(): Attraction | null {
    return this.goal;
  }

  /** "Put me down on the other side of this door." See {@link via}. */
  get portalRequest(): Portal | null {
    return this.pendingPortal;
  }

  /**
   * `NpcSystem` has carried out the step. The next frame re-plans from where
   * the child now actually is, in their new space.
   */
  portalTaken(): void {
    this.pendingPortal = null;
    this.via = null;
    this.planned = false;
    this.routeLength = 0;
    this.routeIndex = 0;
    // A fresh side of the door is a fresh chance to get somewhere, so the
    // re-plan budget is restored: the walk that remains is a different walk.
    this.replansLeft = REPLAN_ATTEMPTS;
    this.sinceProgressCheck = 0;
  }

  /** True once there is a destination and a route to it. */
  get underway(): boolean {
    return this.goal !== null;
  }

  /**
   * Picks somewhere new to go, and — one time in five — says so.
   *
   * The roll happens here rather than on arrival because the line is about the
   * *next* place, and because a child who announces a destination they then
   * fail to plan a route to has told the player something untrue.
   */
  chooseDestination(space: SpaceId, planner: RoutePlanner): void {
    const options = planner.destinationsIn(space);
    if (options.length === 0) {
      this.goal = null;
      return;
    }
    // Never pick the one just left: a child who arrives and immediately
    // re-chooses the same attraction stands still, which reads as stuck — the
    // same reason the walk this replaced refused to turn straight back.
    let pick = options[this.rng.int(0, options.length - 1)] ?? null;
    if (options.length > 1 && pick && this.goal && pick.id === this.goal.id) {
      const others = options.filter((a) => a.id !== this.goal?.id);
      pick = others[this.rng.int(0, others.length - 1)] ?? pick;
    }

    this.goal = pick;
    this.via = pick ? planner.portalToward(space, pick.space) : null;
    this.pendingPortal = null;
    this.planned = false;
    this.replansLeft = REPLAN_ATTEMPTS;
    this.routeLength = 0;
    this.routeIndex = 0;
    this.elapsed = 0;
    this.sinceProgressCheck = 0;

    if (pick && this.rng.chance(ANNOUNCE_CHANCE)) {
      this.announcement = announcementFor(pick);
      this.announceRemaining = ANNOUNCE_SECONDS;
    }
  }

  /** Drops the current trip — an activity has taken the child somewhere else. */
  abandon(): void {
    this.goal = null;
    this.via = null;
    this.pendingPortal = null;
    this.planned = false;
    this.routeLength = 0;
    this.routeIndex = 0;
  }

  /**
   * Steps the announcement's timer. Kept apart from {@link steer} so the line
   * still expires while a child is up a tree or on the train — a bubble frozen
   * over a passenger for a whole circuit is the leak `wanderDriver.ts`'s own
   * note about `hopRequest` and `waveAmount` describes.
   */
  tick(dt: number): void {
    if (this.announceRemaining <= 0) return;
    this.announceRemaining -= dt;
    if (this.announceRemaining <= 0) this.announcement = null;
  }

  /**
   * Walks one frame towards the destination, writing into `moveX`/`moveZ`.
   *
   * Returns true when the child has arrived — the caller's cue to stop, look
   * around, and choose again.
   */
  steer(
    space: SpaceId,
    x: number,
    z: number,
    y: number,
    dt: number,
    planner: RoutePlanner,
    move: { x: number; z: number },
  ): boolean {
    move.x = 0;
    move.z = 0;
    const goal = this.goal;
    if (!goal) return true;
    // Waiting for `NpcSystem` to step us through: stand still, do not re-plan.
    if (this.pendingPortal) return false;

    this.elapsed += dt;
    if (this.elapsed > JOURNEY_TIMEOUT) return true;

    // Through a door, the immediate target is the door itself. `aim` is what
    // every test below measures against, so one substitution covers arrival,
    // the stuck detector and the shortfall re-plan alike.
    const aim = this.via
      ? { x: this.via.nearX, z: this.via.nearZ, y: this.via.nearY }
      : { x: goal.x, z: goal.z, y: goal.y };

    if (!this.planned) {
      const count = planner.plan(space, x, z, y, aim.x, aim.z, aim.y, this.route);
      // -1 is "the frame is out of budget": hold still and ask again. 0 is a
      // real answer — there is no route — so give up on this destination and
      // let the caller choose another.
      if (count < 0) return false;
      this.planned = true;
      this.routeLength = count;
      this.routeIndex = 0;
      // Fresh plan, fresh progress baseline: a child who has just been given a
      // new route has not failed to make progress along it yet.
      this.progressX = x;
      this.progressZ = z;
      this.sinceProgressCheck = 0;
      if (count === 0) return true;
    }

    // Are we actually getting anywhere? See {@link STUCK_WINDOW} — this is the
    // guard on the bug where eleven children pushed at a route that had stopped
    // short in the gateway for seventy-five seconds. Checked before the
    // waypoint advance so a child wedged *on* a waypoint is caught too.
    this.sinceProgressCheck += dt;
    if (this.sinceProgressCheck >= STUCK_WINDOW) {
      const moved = Math.hypot(x - this.progressX, z - this.progressZ);
      this.progressX = x;
      this.progressZ = z;
      this.sinceProgressCheck = 0;
      if (moved < NPC_WALK_SPEED * STUCK_WINDOW * STUCK_FRACTION) {
        // Ask again from where we actually got to — which is what fixed it
        // every time the old timeout eventually forced the same thing, only
        // seventy-two seconds sooner. Out of attempts means this destination is
        // not working out; arriving is the caller's cue to choose another.
        if (this.replansLeft <= 0) return true;
        this.replansLeft -= 1;
        this.planned = false;
        return false;
      }
    }

    // Arrived? Measured against what we are aiming at, not the last waypoint:
    // a route that stopped short still counts if it stopped close enough, and
    // one that overshot the tolerance has not.
    if (Math.hypot(aim.x - x, aim.z - z) <= DESTINATION_RADIUS) {
      // At a door rather than at the destination: ask to be stepped through,
      // and keep the journey alive — the shop on the other side is still where
      // this child is going.
      if (this.via) {
        this.pendingPortal = this.via;
        return false;
      }
      return true;
    }

    // Advance past every waypoint already behind us. `WAYPOINT_RADIUS` is the
    // player's own "passed the corner" figure — see `TapNavigator`.
    while (this.routeIndex < this.routeLength - 1) {
      const wx = this.route[this.routeIndex * 2] ?? 0;
      const wz = this.route[this.routeIndex * 2 + 1] ?? 0;
      if (Math.hypot(wx - x, wz - z) > WAYPOINT_RADIUS) break;
      this.routeIndex += 1;
    }

    // The route ran out and the destination is still not underfoot: it stopped
    // short. `NavGrid.findRoute` is explicit that it may — it ends at the
    // closest reachable point — and `TapNavigator` handles the same case the
    // same way. Re-plan from here rather than declaring an arrival somewhere
    // the child never got to.
    if (this.routeIndex >= this.routeLength) {
      if (this.replansLeft <= 0) return true;
      this.replansLeft -= 1;
      this.planned = false;
      return false;
    }

    const targetX = this.route[this.routeIndex * 2] ?? aim.x;
    const targetZ = this.route[this.routeIndex * 2 + 1] ?? aim.z;
    const dx = targetX - x;
    const dz = targetZ - z;
    const distance = Math.hypot(dx, dz);

    // The last waypoint is the destination, so reaching it at the tighter
    // `ARRIVE_RADIUS` is arriving.
    if (this.routeIndex === this.routeLength - 1 && distance <= ARRIVE_RADIUS) {
      // Standing on the last waypoint is only arriving if the last waypoint is
      // the destination. When the route stopped short it is not, and the honest
      // move is another attempt from here.
      if (Math.hypot(aim.x - x, aim.z - z) <= DESTINATION_RADIUS) {
        if (this.via) {
          this.pendingPortal = this.via;
          return false;
        }
        return true;
      }
      if (this.replansLeft <= 0) return true;
      this.replansLeft -= 1;
      this.planned = false;
      return false;
    }
    if (distance < 1e-4) return false;

    move.x = dx / distance;
    move.z = dz / distance;
    return false;
  }
}
