import type { ParkBoundary } from './boundary';
import { BUILDING_STEP_UP } from '../core/constants';
import type { GroundSampler } from '../entities/Player';
import type { LevelConnector } from './building/surfaces';
import { MAX_AUTO_HOP_HEIGHT, autoHopClears, type CollisionWorld } from './Collision';

/**
 * The park, as something you can find a way across — **on every level of it**.
 *
 * A six-year-old plays this game by tapping where she wants to be. Steering
 * straight at that point — which is all tap-to-move used to do — works right up
 * until a tree, a bench, a stall or a garden wall is in the line, and then it
 * grinds against it until the stuck timer gives up and hands back a character
 * standing in a bush. That is the single most-reported problem with the game.
 *
 * So: a **routed** walk. This is the map it is routed on.
 *
 * ## Why a grid, and not the NPC waypoint graph
 *
 * The children already walk `entities/npc/poiGraph.ts`, whose edges are
 * validated against the finished collision world — so the obvious move is to
 * put the player on it too. It was tried on paper and refused, for three
 * reasons:
 *
 * - **Its nodes are hand-authored** (forty-odd seeds along the ring road and
 *   the plaza) and ARCHITECTURE-DECISIONS Decision 4 replans the entire park
 *   around a railway. Hand-authored routes are days from being thrown away;
 *   *derived* ones are not.
 * - **It is far too coarse for a finger.** A child taps a specific patch of
 *   grass, not a junction. Snapping her destination to the nearest of forty
 *   waypoints, or walking her out to the ring road to get four metres round a
 *   bench, is a different bug wearing the first one's coat.
 * - **It only covers the park.** There are three nodes inside the building.
 *
 * A **navmesh** was the other candidate, and there is nothing to build one
 * from: this game has no walkable geometry. The floor of the world is a
 * *function* — `WalkSurfaces.sample()` — and the meshes are only its portrait
 * (see `world/pickWalkable.ts`, which makes exactly the same point about
 * raycasting). Anything that wants to know where you can stand has to *ask*,
 * point by point.
 *
 * So this asks, point by point, on a half-metre lattice, and it asks the two
 * authorities that already decide where a character may stand:
 *
 * - **`CollisionWorld`** for the solid things. Every registered collider is
 *   stamped into the lattice, fattened by the walker's own radius, so a cell is
 *   free exactly when a character of that width could stand in it.
 * - **the ground sampler** for the heights of each free cell — note the
 *   plural, which is the whole of Decision 11 (see below).
 *
 * Both are read at plan time from the *finished* world, so the railway,
 * the replanned attractions and anything else built later appear in it for
 * free, with nothing to re-author. That is the whole reason it is built this
 * way rather than drawn by hand.
 *
 * ## Levels (ARCHITECTURE-DECISIONS Decision 11)
 *
 * Jim, having climbed the lobby's mezzanine and tapped the floor below
 * (8 August 2026): *"Route planning in general needs to work between levels.
 * It can't be a purely 2D algo."* The lattice used to keep **one** height per
 * cell — whichever surface sat within a step of the walker's own feet when
 * the lattice was built — so a route could never see the floor from the deck,
 * and the tap walked her to the balustrade and gave up there.
 *
 * So a cell now keeps **every** walkable surface over it, asked of the same
 * sampler top-down, and a route node is *(cell, level)* rather than a bare
 * cell: the deck over the lobby floor is a different node from the floor
 * beneath it. Neighbouring nodes connect when their heights are within the
 * game's own step (`BUILDING_STEP_UP`), exactly the rule a walking foot obeys
 * — which is what lets a ramp's gentle slope join its levels with no more
 * declaration than being walkable.
 *
 * **Blocked stays two-dimensional, and that is deliberate.** `CollisionWorld`
 * is height-agnostic for everything but a jump (see `Mezzanine`'s header for
 * the law, and Decision 8 for why the rail fence's `Infinity` top must never
 * become a number): a wall pushes a walker back at any height, so a lattice
 * that blocked per-level would promise routes the resolver refuses. One
 * blocked bit per cell mirrors the physics that will actually run.
 *
 * ## Connectors: a stair is an edge, declared by its own plan
 *
 * A stair whose flanks are solid — the lobby's sweeping arc — is *physically*
 * narrower than any lattice pitch once those flanks are fattened by the
 * walker's radius: the free band up the middle is centimetres wide, cells are
 * classified by their centres, and no layering fixes that. The honest answer
 * is the one the rest of this repo keeps arriving at: **the plan that built
 * the stair declares the way up it.** `WalkSurfaces.addConnector` takes the
 * walk path (derived from the same numbers as the treads — never typed in
 * beside them), and the router consumes it as an ordinary edge between the
 * two levels, its cost the path's real length, its geometry spliced into the
 * route so the walk descends the actual arc. Multi-flight compositions chain
 * for free, because a route through two edges is just a route.
 *
 * ## Walls she can hop cost something to cross
 *
 * The low garden walls are `autoHoppable` (design feedback #30e): walk into one
 * and the character hops it without being asked. They used to be **not stamped
 * at all** — free, so a route preferred the straight line over one every time.
 *
 * That was wrong twice over, and Jim ruled on it directly: *"give hoppable
 * walls a high penalty so the route finding goes around them unless they are a
 * much better path — for example the destination is the water in the fountain
 * itself."* A wall a child *can* vault is not a wall she *should* be sent over
 * on the way to the ice cream, and once the fountain rim became hoppable, free
 * meant routing children straight through the water for a two-metre saving.
 *
 * So a hoppable collider is stamped into {@link hopBand} instead of into
 * `blocked`, and the cells it covers cost {@link HOP_COST_MULTIPLIER} times the
 * distance walked through them. Which colliders those are is still decided by
 * the same `autoHopClears` call `CollisionWorld.wouldAutoHopClear` makes, from
 * the same numbers, so the two can never disagree about which walls she hops.
 *
 * **A multiplier on distance, never a flat toll, and that is what keeps A\*
 * honest.** Every edge then costs *at least* its own geometric length, so the
 * octile heuristic — which prices every cell at 1 — stays a lower bound on the
 * true remaining cost, and the search stays admissible: the first time the goal
 * comes off the heap it really is the cheapest way there. A flat toll charged
 * at the band edge could not make that promise, and an inadmissible heuristic
 * fails silently, by quietly returning a route that is not the best one.
 *
 * **Inside a band the level rule is the hop's, not the walk's.** Getting across
 * a hoppable wall is a jump, so an edge touching a band may change height by
 * {@link MAX_AUTO_HOP_HEIGHT} — `Collision.ts`'s own measured ceiling, asked of
 * it rather than restated — where an ordinary walking edge is held to
 * `BUILDING_STEP_UP`.
 *
 * Without it the fountain's water can be out of reach altogether. The wading
 * surface stands **0.63–0.66 m** above the paving that rings it
 * (`scripts/measure-fountain-rim-step.mts`) against a 0.62 m walking step — so
 * whether a route can get in at all comes down to whether the terrain happens
 * to run high enough on *some* bearing round the rim. Measured with this rule
 * removed: four of the five CI seeds still get in, by luck; **seed 11 does not
 * get in anywhere** (0.658 m of step over ground that varies by 5 mm all the
 * way round). Which is a fair description of why the rule belongs here rather
 * than as a nudge to `BUILDING_STEP_UP`: a child hopping a wall is not taking
 * a step, and holding her to one was never right — it merely happened to be
 * survivable while nothing hoppable had a drop behind it.
 *
 * ## Nothing here happens per frame
 *
 * The lattice is built lazily, on the first route asked for in a space, and
 * kept until the space changes (the soft play bounds move) or the collision
 * world changes (`CollisionWorld.revision`). It no longer cares how high the
 * walker stands — every level is in it, so climbing the deck does not force a
 * rebuild the way moving half a storey used to. A route is planned **once per
 * tap** and then simply followed; the per-frame cost of a routed walk is one
 * distance check more than an unrouted one, and no allocation. Every buffer
 * below is allocated per lattice and reused.
 *
 * ## When there is no route
 *
 * There is always an answer. A* keeps the reachable node that got closest to
 * the goal — closest planar, with a gentle preference for the goal's own level
 * among near-ties — so an unreachable destination yields a route to the
 * nearest place she *can* stand, and `TapNavigator` walks her there and stops.
 * It returns nothing only when it has no lattice covering where she is
 * standing, which is `TapNavigator`'s cue to fall back to the old
 * straight-line seek and behave exactly as the game did before.
 */

/**
 * Lattice pitch, in metres.
 *
 * Half a metre against a 0.62 m walker radius: fine enough that the gaps
 * between trees and the doorways between stalls survive, coarse enough that the
 * whole park is a few hundred cells square and builds in a few tens of
 * milliseconds. Cells are classified by their **centre**, so the lattice is
 * very slightly optimistic about tight corners — which is the right way to be
 * wrong. An optimistic route clips a corner and the collision resolver slides
 * her round it; a pessimistic one seals a gap she can plainly see and walks her
 * the long way about.
 */
const CELL = 0.5;
const INVERSE_CELL = 1 / CELL;

/** Metres of lattice built beyond the soft play boundary, for elbow room. */
const MARGIN = 2;

/**
 * The biggest height change between neighbouring nodes a route may take.
 *
 * The same step the building already uses for "can you walk up this?", applied
 * in both directions: up, because a taller rise is not walkable at all; down,
 * because a bigger drop is a fall, and a route should not casually walk a child
 * off the edge of a deck on the way to somewhere else. The ball pit's 0.5 m lip
 * sits comfortably under it and stays walkable, as it must.
 */
const MAX_STEP = BUILDING_STEP_UP;

/**
 * How much dearer a metre walked through a hoppable wall's band is than a
 * metre of open park. **6.4, and it is a measurement, not a round number.**
 *
 * `scripts/measure-hop-detours.mts` stands two points either side of every
 * hoppable collider in the built park and asks what a walker with **no jump at
 * all** must do to get between them (`hopApex = 0`, which makes `autoHopClears`
 * false for everything and stamps every hoppable collider solid; no second code
 * path, the same `NavGrid` told she cannot jump). How much longer that is than
 * the straight line through the wall is the real price of going round *that*
 * wall — measured against the straight line, never against a routed crossing,
 * or this number would be deriving itself.
 *
 * Pooled over the five CI seeds, 73 crossings:
 *
 * ```
 * p0 3.34   p25 4.77   p50 5.67   p75 7.59   p90 10.32   p95 14.02   p100 21.76
 * ```
 *
 * A multiplier `M` prices a crossing of a band `w` wide at `(M - 1) * w` metres
 * over walking through it, and the median fattened band is 1.92 m
 * (`2 * (halfThickness + PLAYER_RADIUS)` for the park's garden walls). Setting
 * that price at the **p90 detour** gives `1 + 10.32 / 1.92 = 6.38`, so 6.4.
 *
 * That is what Jim's "high penalty… unless they are a much better path" means
 * in numbers: **86% of the park's hoppable walls are now walked round**, and
 * the rest are the ones where going round costs more than any ordinary garden
 * wall ever asks — up to 21.8 m. Both ends were checked rather than assumed: at
 * `M = 2` not one of the 73 goes round, so it would barely be a change, and by
 * `M = 16` every one does, which is a wall that is blocked in all but name.
 * 6.4 sits where the ruling puts it.
 *
 * Set from the *detours the park actually has*, so it is not a knob to be
 * nudged when a route looks wrong. If the park's walls change shape, re-run the
 * script and re-derive it.
 */
const HOP_COST_MULTIPLIER = 6.4;

/**
 * How far apart two levels of one cell may match a height being looked up —
 * the same step, because "the level your feet are on" and "a level you could
 * step to" are the same fact to a walker.
 */
export const MAX_LEVEL_GAP = MAX_STEP;

/**
 * A reference height above everything walkable, for asking the sampler
 * "what is the topmost surface here?". The tallest walkable thing in the game
 * is the castle's top deck at ~18 m; nothing legitimate approaches this.
 *
 * Exported so `scripts/check-park.mts` can ask the same "what's the topmost
 * surface here" question its own invariant 2 needs (a bridge deck stands
 * several metres up, so a check that samples from ground level never finds
 * it) without a second "high enough" number that could drift from this one.
 */
export const TOP_REFERENCE = 500;

/** Surfaces closer than this are one surface, asked twice. */
const LEVEL_EPSILON = 0.01;

/** Most levels one cell can carry. The castle's tower is six (five decks and
 *  the ground); nothing else in the game reaches four. */
const MAX_LEVELS_PER_CELL = 8;

/** Rings of cells searched for somewhere to stand when the walker is inside something. */
const START_SEARCH_RINGS = 8;

/**
 * Ceiling on A* expansions, as insurance rather than as tuning.
 *
 * A reachable goal is found in a few thousand; a hopeless one floods the whole
 * lattice, and this protects against that flood being exceeded by some future,
 * larger space. Nodes rather than cells now, but the park is single-level
 * almost everywhere, so the count is the same.
 */
const MAX_EXPANSIONS = 160_000;

/**
 * How much a metre of height error counts against a candidate "closest
 * reachable" ending, in cell units. Deliberately gentle: it breaks planar
 * near-ties toward the tapped level (the floor by the stair mouth beats the
 * deck edge directly above the target) without ever dragging a route metres
 * out of its way to end on the right level of the wrong place.
 */
const BEST_HEIGHT_WEIGHT = 0.25 / CELL;

/**
 * Waypoints a single route may have after smoothing.
 *
 * A route across open park smooths to one; the worst case measured — corner to
 * corner of a park-sized space stuffed with fourteen hundred obstacles — was
 * 28, and a stair connector splices in about a dozen more. This is deliberately
 * several times that, because the overflow behaviour (end the route at the
 * destination regardless, rather than stop somewhere arbitrary) is the one
 * place in here that can put a leg through scenery, and the cost of never
 * reaching it is a 1 KB array.
 */
export const MAX_ROUTE_WAYPOINTS = 128;

const NEW = 0;
const OPEN = 1;
const CLOSED = 2;

/** Neighbour offsets: four straight, then four diagonal. */
const NEIGHBOUR_X = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const NEIGHBOUR_Z = [0, 0, 1, -1, 1, -1, 1, -1] as const;

/** A connector edge out of a node, resolved against the current lattice. */
interface ConnectorEdge {
  readonly to: number;
  /** Path length in cell units, so it compares with lattice g-scores. */
  readonly cost: number;
  /**
   * Which connector, walked which way: `index + 1` first-to-last,
   * `-(index + 1)` last-to-first. Recorded in `cameVia` so reconstruction can
   * splice the real path back in.
   */
  readonly via: number;
}

export class NavGrid {
  /** Cells per side. 0 until the first lattice is built. */
  private cells = 0;
  /** World position of the centre of cell (0, 0). */
  private originX = 0;
  private originZ = 0;

  private blocked = new Uint8Array(0);
  /**
   * 1 where a hoppable collider's fattened footprint falls — a cell she may
   * cross, at {@link HOP_COST_MULTIPLIER} times the price. A flag rather than a
   * per-cell cost because every hoppable wall in the game is priced the same:
   * one number, one owner, and no per-collider tuning to drift. `blocked` still
   * wins wherever both apply, since the search reads it first.
   */
  private hopBand = new Uint8Array(0);
  /** Level count prefix: cell `c`'s nodes are `levelStart[c] .. levelStart[c+1]`. */
  private levelStart = new Int32Array(0);
  /** Height of each node's surface, descending within a cell. */
  private nodeHeight = new Float32Array(0);
  /** The cell each node stands in. */
  private nodeCell = new Int32Array(0);
  private nodeCount = 0;

  private gScore = new Float32Array(0);
  private fScore = new Float32Array(0);
  private cameFrom = new Int32Array(0);
  private cameVia = new Int32Array(0);
  private state = new Uint8Array(0);
  private heap = new Int32Array(0);
  private heapLength = 0;

  /** The node path A* found, start-first, and how each step was taken. */
  private path = new Int32Array(0);
  private pathVia = new Int32Array(0);
  /** The path as world points plus heights. */
  private pointX = new Float32Array(0);
  private pointZ = new Float32Array(0);
  private pointY = new Float32Array(0);
  /**
   * Points the string-pull must emit exactly as they stand, and never
   * straighten across: a connector's own stair treads, and any point standing
   * in a hoppable wall's band. Both for the same reason — the route was planned
   * to pass through *that* spot, and a chord that cuts the corner off it is a
   * chord across somebody's stair or over a wall the route decided to pay for.
   */
  private pointRigid = new Uint8Array(0);

  /** Connector edges by node, rebuilt with the lattice. */
  private readonly connectorEdges = new Map<number, ConnectorEdge[]>();
  private builtConnectors: readonly LevelConnector[] = [];

  private built = false;
  private builtBoundary: ParkBoundary | null = null;
  private builtRevision = -1;

  private reachedGoal = false;
  private routeEndY = 0;

  /** The best fallback ending seen by the current search. Fields rather than
   *  captured locals so a relaxation allocates nothing. */
  private searchBestNode = -1;
  private searchBestScore = Infinity;

  private readonly collision: CollisionWorld;
  /** The walker's own half-width — every collider is fattened by it. */
  private readonly walkerRadius: number;
  /**
   * The apex of the walker's jump above their own feet — `Player`'s
   * `JUMP_APEX_HEIGHT`, the same number its auto-hop lookahead is fed. Passed
   * in rather than imported so the one derivation of it stays in `Player`,
   * and handed straight to `Collision`'s shared {@link autoHopClears}.
   */
  private readonly hopApex: number;
  /**
   * The declared ways between levels — `WalkSurfaces.connectors`, read at
   * lattice build so a connector registered while the world goes up is in
   * the first lattice anyone asks for. See the file comment.
   */
  private readonly connectors: () => readonly LevelConnector[];
  /**
   * True over any registered bridge deck or ramp — `ParkTrain.bridges`, one
   * `covers(x, z)` per bridge, OR'd together. Every cell this answers true
   * for is exempt from collider stamping (Decision 8: the deck wins the
   * cell, because what is under it — the fenced rail corridor — was already
   * unwalkable) and is given exactly one level, the bridge's own surface —
   * see `rebuild`'s two uses of this. Defaults to "no bridges anywhere",
   * which is every space but the park itself.
   */
  private readonly bridgeCovers: (x: number, z: number) => boolean;
  /**
   * The one space this grid plans in, or `null` to follow the player.
   *
   * `collision.playBounds` is a **single mutable** (`Collision.ts`'s
   * `setPlayBounds`) that is swapped as the *player* changes space — the
   * garden's boundary out in the park, a circle round the interior origin when
   * they walk into the castle, another when they enter a hotel room. The
   * player's own `NavGrid` wants exactly that, because the player is who it
   * plans for, so `null` is the default and `Game.ts`'s instance is unchanged.
   *
   * Nobody else can use it. Issue #350 gives the park's children real
   * destinations planned on this same pathfinder, and a grid that followed
   * `playBounds` would be wrong twice over: it would rebuild its whole lattice
   * every time the player crossed a threshold, and — much worse — it would
   * plan a *park* child's walk on the *castle's* lattice for as long as the
   * player was indoors. Two spaces, two grids, each pinned to the boundary of
   * the space it plans in.
   *
   * This is deliberately not a second pathfinder. It is the same class, the
   * same lattice, the same A*; the only thing a caller may vary is which
   * space's floor it is laid over. Requirement 2 of #350 is that children walk
   * on "the same pathfinding as the player", and sharing the implementation is
   * the only way that stays true as the pathfinder changes.
   */
  private readonly pinnedBoundary: ParkBoundary | null;

  constructor(
    collision: CollisionWorld,
    /** The walker's own half-width — every collider is fattened by it. */
    walkerRadius: number,
    /**
     * The apex of the walker's jump above their own feet — `Player`'s
     * `JUMP_APEX_HEIGHT`, the same number its auto-hop lookahead is fed. Passed
     * in rather than imported so the one derivation of it stays in `Player`,
     * and handed straight to `Collision`'s shared {@link autoHopClears}.
     */
    hopApex: number,
    /**
     * The declared ways between levels — `WalkSurfaces.connectors`, read at
     * lattice build so a connector registered while the world goes up is in
     * the first lattice anyone asks for. See the file comment.
     */
    connectors: () => readonly LevelConnector[] = () => [],
    /** See {@link bridgeCovers}. */
    bridgeCovers: (x: number, z: number) => boolean = () => false,
    /** See {@link pinnedBoundary}. */
    pinnedBoundary: ParkBoundary | null = null,
  ) {
    this.collision = collision;
    this.walkerRadius = walkerRadius;
    this.hopApex = hopApex;
    this.connectors = connectors;
    this.bridgeCovers = bridgeCovers;
    this.pinnedBoundary = pinnedBoundary;
  }

  /**
   * Did the last {@link findRoute} actually get where it was asked to go?
   *
   * False means the route ends at the closest reachable point instead, which is
   * a destination in its own right — see the file comment's last section.
   */
  get lastRouteReachedGoal(): boolean {
    return this.reachedGoal;
  }

  /**
   * The height of the surface the last route ends on — the goal's own level
   * when it was reached, and the level of the closest reachable point when it
   * was not. `TapNavigator` moves the marker there, so a child sees the level
   * her character is really going to.
   */
  get lastRouteEndY(): number {
    return this.routeEndY;
  }

  /**
   * Plans a walk from one world point to another, writing `x, z` pairs into
   * `out` and returning how many it wrote.
   *
   * `startY` and `goalY` say **which level** each end means — the walker's own
   * feet, and the height the tap's pick landed on. Two taps at the same `x, z`
   * on different levels are different destinations now, which is the point.
   *
   * Returns 0 only when there is no lattice covering the start — a walker
   * outside the current space's play bounds altogether — which the caller
   * should read as "route unknown, steer straight at it" rather than as "you
   * cannot get there".
   *
   * The final waypoint is the exact goal when it was reachable, and the closest
   * reachable point when it was not.
   */
  findRoute(
    startX: number,
    startZ: number,
    startY: number,
    goalX: number,
    goalZ: number,
    goalY: number,
    sample: GroundSampler,
    out: Float32Array,
  ): number {
    this.reachedGoal = false;
    this.routeEndY = startY;
    if (!this.ensureLattice(sample)) return 0;

    let startCell = this.cellAt(startX, startZ);
    if (startCell < 0) return 0;
    if (this.blocked[startCell] === 1) {
      // Standing inside something — squeezed against a wall, or dropped in by a
      // ride. Route from the nearest place she could stand instead; the walk
      // out of the overlap is the collision resolver's job and it is already
      // doing it.
      startCell = this.nearestFreeCell(startCell);
      if (startCell < 0) return 0;
    }
    const startNode = this.nodeNearest(startCell, startY);
    if (startNode < 0) return 0;

    const goalCell = this.cellAt(goalX, goalZ);
    // A goal off the edge of the lattice is not "unreachable", it is
    // unknowable. Say so, and let the caller fall back.
    if (goalCell < 0) return 0;
    const goalNode = this.blocked[goalCell] === 0 ? this.nodeNearest(goalCell, goalY) : -1;

    const endNode = this.search(startNode, goalNode, goalCell, goalY);
    // Reaching the goal *node* is reaching the goal: the node was chosen as
    // the goal cell's level nearest `goalY`, so the level agreement is already
    // in the choice — a caller who only knows "somewhere on the ground" still
    // gets an honest yes on a hilltop whose one level is the hill.
    this.reachedGoal = endNode === goalNode && goalNode >= 0;
    this.routeEndY = this.nodeHeight[endNode] ?? startY;

    const pathLength = this.reconstruct(startNode, endNode);
    return this.smooth(startX, startZ, startY, goalX, goalZ, pathLength, out);
  }

  // ------------------------------------------------------------- the lattice

  /**
   * Builds or rebuilds the lattice if the one in hand does not describe the
   * space the walker is in. Returns false if there is no usable lattice at all.
   */
  private ensureLattice(sample: GroundSampler): boolean {
    // See {@link pinnedBoundary}: `null` means "wherever the player is", which
    // is what the player's own grid wants and what this has always done.
    const boundary = this.pinnedBoundary ?? this.collision.playBounds;

    if (
      this.built &&
      this.builtRevision === this.collision.revision &&
      this.builtBoundary === boundary
    ) {
      return true;
    }

    this.rebuild(boundary, sample);
    return this.built;
  }

  private rebuild(boundary: ParkBoundary, sample: GroundSampler): void {
    // Sized and centred on the boundary's own extent rather than on a radius
    // about a centre: the park's edge is neither circular nor, for the castle
    // interior, centred on the origin.
    const { minX, maxX, minZ, maxZ } = boundary.extent;
    const centreX = (minX + maxX) / 2;
    const centreZ = (minZ + maxZ) / 2;
    const reach = Math.max(maxX - minX, maxZ - minZ) / 2;
    const side = Math.ceil(((reach + MARGIN) * 2) / CELL);
    if (side <= 0) {
      this.built = false;
      return;
    }

    this.cells = side;
    // Cell (0, 0)'s centre, half a cell in from the corner of the square.
    this.originX = centreX - (side * CELL) / 2 + CELL / 2;
    this.originZ = centreZ - (side * CELL) / 2 + CELL / 2;

    const total = side * side;
    if (this.blocked.length !== total) {
      this.blocked = new Uint8Array(total);
      this.hopBand = new Uint8Array(total);
      this.levelStart = new Int32Array(total + 1);
    } else {
      this.blocked.fill(0);
      this.hopBand.fill(0);
    }

    // The soft boundary first: everything the resolver would push her back
    // inside of is simply not part of the map.
    // Asked of the boundary itself, so the lattice and `CollisionWorld`'s
    // clamp cannot disagree about where the park ends. If they ever do,
    // tap-to-move routes to somewhere walking refuses to go.
    for (let cz = 0; cz < side; cz += 1) {
      const z = this.originZ + cz * CELL;
      const row = cz * side;
      for (let cx = 0; cx < side; cx += 1) {
        const x = this.originX + cx * CELL;
        if (boundary.distanceToEdge(x, z) < this.walkerRadius) this.blocked[row + cx] = 1;
      }
    }

    // Then everything solid, fattened by the walker's own width — the walls
    // she hops without being asked going into `hopBand` rather than into
    // `blocked`, so a route may cross one at a price instead of pretending it
    // is not there (see the header), and skipping **banded** colliders (a finite `baseHeight` — the balustrade on
    // an overhanging deck's edge). A banded collider guards an edge rather
    // than occupying the column of space: the lattice's own level rule (no
    // edge between nodes more than a step apart) already refuses every route
    // the rail refuses, and stamping it would block the walkable floor
    // *beneath* the overhang — the lobby's walk-through arch — at every
    // level. See `Collision.ts`'s `baseHeight` header.
    this.collision.forEachCircle(
      (x, z, colliderRadius, topHeight, autoHoppable, baseHeight, navStamped) => {
        const hoppable = autoHoppable && autoHopClears(topHeight, this.hopApex);
        if (!hoppable && Number.isFinite(baseHeight) && !navStamped) return;
        this.stampCircle(
          x,
          z,
          colliderRadius + this.walkerRadius,
          hoppable ? this.hopBand : this.blocked,
        );
      },
    );
    this.collision.forEachWall(
      (x1, z1, x2, z2, halfThickness, topHeight, autoHoppable, baseHeight, navStamped) => {
        const hoppable = autoHoppable && autoHopClears(topHeight, this.hopApex);
        if (!hoppable && Number.isFinite(baseHeight) && !navStamped) return;
        this.stampSegment(
          x1,
          z1,
          x2,
          z2,
          halfThickness + this.walkerRadius,
          hoppable ? this.hopBand : this.blocked,
        );
      },
    );

    // Bridges (Decision 8): a cell a deck or ramp covers is exempt from
    // everything just stamped, however it got blocked — the rail fence
    // that would otherwise wall off the deck's own cells included. Safe
    // because what a bridge stands over is the fenced rail corridor, which
    // was never walkable ground to begin with; nothing is lost by letting
    // the surface a level up win. See `bridges.ts`'s header for the
    // physical half of this (the fence's own `topIsAbsolute` seam) — this
    // is only the lattice's own bookkeeping.
    for (let cz = 0; cz < side; cz += 1) {
      const z = this.originZ + cz * CELL;
      const row = cz * side;
      for (let cx = 0; cx < side; cx += 1) {
        const x = this.originX + cx * CELL;
        if (!this.bridgeCovers(x, z)) continue;
        this.blocked[row + cx] = 0;
        this.hopBand[row + cx] = 0;
      }
    }

    // Levels, for the free cells only — a blocked cell is never stepped on, so
    // its heights are never asked for, and this is much the most expensive
    // part. Top-down: the topmost surface first, then whatever the sampler
    // offers from just over a step beneath it, until it repeats itself (the
    // unconditional ground). Surfaces within a step of one another are one
    // walking level, and the higher one speaks for it — exactly as the old
    // single-height lattice behaved around the ball pit's lip.
    this.growNodes(total + 64);
    let nodes = 0;
    for (let cz = 0; cz < side; cz += 1) {
      const z = this.originZ + cz * CELL;
      const row = cz * side;
      for (let cx = 0; cx < side; cx += 1) {
        const index = row + cx;
        this.levelStart[index] = nodes;
        if (this.blocked[index] === 1) continue;
        const x = this.originX + cx * CELL;

        let cursor = sample(x, z, TOP_REFERENCE);
        if (nodes + MAX_LEVELS_PER_CELL > this.nodeHeight.length) {
          this.growNodes(this.nodeHeight.length * 2);
        }
        this.nodeHeight[nodes] = cursor;
        this.nodeCell[nodes] = index;
        let kept = cursor;
        nodes += 1;
        // A bridge cell stops here, at its one level — the deck (or ramp
        // tread) itself. `sample` always has *something* to say further
        // down (the raw, unconditional ground, `WalkSurfaces`'s own
        // comment for it), and under a bridge that ground is the fenced
        // rail corridor: a level the physical fence refuses ever getting a
        // route from the resolver it cannot deliver. See the exemption
        // pass above.
        const onBridge = this.bridgeCovers(x, z);
        for (let level = 1; !onBridge && level < MAX_LEVELS_PER_CELL; level += 1) {
          const next = sample(x, z, cursor - MAX_STEP - LEVEL_EPSILON);
          if (next >= cursor - LEVEL_EPSILON) break;
          cursor = next;
          if (next < kept - MAX_STEP) {
            this.nodeHeight[nodes] = next;
            this.nodeCell[nodes] = index;
            kept = next;
            nodes += 1;
          }
        }
      }
    }
    this.levelStart[total] = nodes;
    this.nodeCount = nodes;

    if (this.gScore.length < nodes) {
      this.gScore = new Float32Array(this.nodeHeight.length);
      this.fScore = new Float32Array(this.nodeHeight.length);
      this.cameFrom = new Int32Array(this.nodeHeight.length);
      this.cameVia = new Int32Array(this.nodeHeight.length);
      this.state = new Uint8Array(this.nodeHeight.length);
      this.heap = new Int32Array(this.nodeHeight.length);
      this.path = new Int32Array(this.nodeHeight.length);
      this.pathVia = new Int32Array(this.nodeHeight.length);
    }
    this.resolveConnectors();
    this.sizePointBuffers();

    this.built = true;
    this.builtBoundary = boundary;
    this.builtRevision = this.collision.revision;
  }

  private growNodes(capacity: number): void {
    if (this.nodeHeight.length >= capacity) return;
    const heights = new Float32Array(capacity);
    heights.set(this.nodeHeight);
    this.nodeHeight = heights;
    const cellsOf = new Int32Array(capacity);
    cellsOf.set(this.nodeCell);
    this.nodeCell = cellsOf;
  }

  /**
   * Ties every declared connector's endpoints to nodes of this lattice.
   *
   * A connector whose endpoints fall off the lattice, in a blocked cell or on
   * no level of it belongs to another space (the lobby's stair, seen from the
   * park) and is skipped without comment. Cost is the walk path's real 3D
   * length; both directions are edges, because a stair goes down as well as up.
   */
  private resolveConnectors(): void {
    this.connectorEdges.clear();
    this.builtConnectors = this.connectors();
    this.builtConnectors.forEach((connector, index) => {
      const first = connector.points[0];
      const last = connector.points[connector.points.length - 1];
      if (!first || !last) return;
      const from = this.nodeAt(first.x, first.z, first.y);
      const to = this.nodeAt(last.x, last.z, last.y);
      if (from < 0 || to < 0) return;

      let length = 0;
      for (let i = 1; i < connector.points.length; i += 1) {
        const a = connector.points[i - 1];
        const b = connector.points[i];
        if (!a || !b) continue;
        length += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      }
      const cost = length * INVERSE_CELL;
      this.addConnectorEdge(from, { to, cost, via: index + 1 });
      this.addConnectorEdge(to, { to: from, cost, via: -(index + 1) });
    });
  }

  private addConnectorEdge(from: number, edge: ConnectorEdge): void {
    const list = this.connectorEdges.get(from);
    if (list) list.push(edge);
    else this.connectorEdges.set(from, [edge]);
  }

  /** Node at a world point on the level nearest `y`, or -1. */
  private nodeAt(x: number, z: number, y: number): number {
    const cell = this.cellAt(x, z);
    if (cell < 0 || this.blocked[cell] === 1) return -1;
    const node = this.nodeNearest(cell, y);
    if (node < 0) return -1;
    return Math.abs((this.nodeHeight[node] ?? 0) - y) <= MAX_LEVEL_GAP ? node : -1;
  }

  /** The node of `cell` whose surface is nearest `y`, or -1 for a blocked cell. */
  private nodeNearest(cell: number, y: number): number {
    const from = this.levelStart[cell] ?? 0;
    const to = this.levelStart[cell + 1] ?? 0;
    let best = -1;
    let bestGap = Infinity;
    for (let node = from; node < to; node += 1) {
      const gap = Math.abs((this.nodeHeight[node] ?? 0) - y);
      if (gap < bestGap) {
        bestGap = gap;
        best = node;
      }
    }
    return best;
  }

  private sizePointBuffers(): void {
    let connectorPoints = 0;
    for (const connector of this.builtConnectors) connectorPoints += connector.points.length;
    const size = this.nodeHeight.length + connectorPoints + 2;
    if (this.pointX.length >= size) return;
    this.pointX = new Float32Array(size);
    this.pointZ = new Float32Array(size);
    this.pointY = new Float32Array(size);
    this.pointRigid = new Uint8Array(size);
  }

  /** Marks every cell whose centre is within `radius` of a point in `into`. */
  private stampCircle(x: number, z: number, radius: number, into: Uint8Array): void {
    const minX = this.columnOf(x - radius);
    const maxX = this.columnOf(x + radius);
    const minZ = this.rowOf(z - radius);
    const maxZ = this.rowOf(z + radius);
    if (maxX < 0 || maxZ < 0 || minX >= this.cells || minZ >= this.cells) return;

    const fromX = minX < 0 ? 0 : minX;
    const toX = maxX >= this.cells ? this.cells - 1 : maxX;
    const fromZ = minZ < 0 ? 0 : minZ;
    const toZ = maxZ >= this.cells ? this.cells - 1 : maxZ;
    const radiusSquared = radius * radius;

    for (let cz = fromZ; cz <= toZ; cz += 1) {
      const dz = this.originZ + cz * CELL - z;
      const row = cz * this.cells;
      for (let cx = fromX; cx <= toX; cx += 1) {
        const dx = this.originX + cx * CELL - x;
        if (dx * dx + dz * dz <= radiusSquared) into[row + cx] = 1;
      }
    }
  }

  /** The same, for the fattened footprint of a wall segment. */
  private stampSegment(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    radius: number,
    into: Uint8Array,
  ): void {
    const minX = this.columnOf(Math.min(x1, x2) - radius);
    const maxX = this.columnOf(Math.max(x1, x2) + radius);
    const minZ = this.rowOf(Math.min(z1, z2) - radius);
    const maxZ = this.rowOf(Math.max(z1, z2) + radius);
    if (maxX < 0 || maxZ < 0 || minX >= this.cells || minZ >= this.cells) return;

    const fromX = minX < 0 ? 0 : minX;
    const toX = maxX >= this.cells ? this.cells - 1 : maxX;
    const fromZ = minZ < 0 ? 0 : minZ;
    const toZ = maxZ >= this.cells ? this.cells - 1 : maxZ;

    const ax = x2 - x1;
    const az = z2 - z1;
    const lengthSquared = ax * ax + az * az;
    const radiusSquared = radius * radius;

    for (let cz = fromZ; cz <= toZ; cz += 1) {
      const z = this.originZ + cz * CELL;
      const row = cz * this.cells;
      for (let cx = fromX; cx <= toX; cx += 1) {
        const x = this.originX + cx * CELL;
        let t =
          lengthSquared < 1e-8 ? 0 : ((x - x1) * ax + (z - z1) * az) / lengthSquared;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - (x1 + ax * t);
        const dz = z - (z1 + az * t);
        if (dx * dx + dz * dz <= radiusSquared) into[row + cx] = 1;
      }
    }
  }

  // --------------------------------------------------------------- the search

  /**
   * A* from one node to another, over the eight-connected lattice plus the
   * connector edges.
   *
   * Returns the node the route ends on: the goal when it was reached, and
   * otherwise the reachable node that got nearest to it — nearest planar, with
   * {@link BEST_HEIGHT_WEIGHT}'s gentle preference for the goal's own level —
   * which is what makes "no route exists" degrade into "walk as close as you
   * can and stop" rather than into a shrug.
   */
  private search(startNode: number, goalNode: number, goalCell: number, goalY: number): number {
    this.state.fill(NEW, 0, this.nodeCount);
    this.heapLength = 0;

    const goalX = goalCell % this.cells;
    const goalZ = (goalCell - goalX) / this.cells;

    this.gScore[startNode] = 0;
    this.fScore[startNode] = this.heuristic(this.nodeCell[startNode] ?? 0, goalX, goalZ);
    this.cameFrom[startNode] = -1;
    this.cameVia[startNode] = 0;
    this.state[startNode] = OPEN;
    this.push(startNode);

    this.searchBestNode = startNode;
    this.searchBestScore =
      this.heuristic(this.nodeCell[startNode] ?? 0, goalX, goalZ) +
      Math.abs((this.nodeHeight[startNode] ?? 0) - goalY) * BEST_HEIGHT_WEIGHT;
    let expansions = 0;

    while (this.heapLength > 0) {
      const node = this.pop();
      if (node === goalNode) return node;
      if (this.state[node] === CLOSED) continue;
      this.state[node] = CLOSED;

      expansions += 1;
      if (expansions > MAX_EXPANSIONS) break;

      const cell = this.nodeCell[node] ?? 0;
      const cx = cell % this.cells;
      const cz = (cell - cx) / this.cells;
      const nodeHeight = this.nodeHeight[node] ?? 0;
      const nodeCost = this.gScore[node] ?? 0;
      const onBand = this.hopBand[cell] === 1;

      for (let i = 0; i < 8; i += 1) {
        const nx = cx + (NEIGHBOUR_X[i] ?? 0);
        const nz = cz + (NEIGHBOUR_Z[i] ?? 0);
        if (nx < 0 || nz < 0 || nx >= this.cells || nz >= this.cells) continue;

        const neighbourCell = nz * this.cells + nx;
        if (this.blocked[neighbourCell] === 1) continue;

        let step = 1;
        if (i >= 4) {
          // No cutting corners: a diagonal is only a step if both of the
          // straight cells it passes between are walkable too. Without this a
          // route slips through the gap where two walls meet, which the
          // resolver then refuses to let her through.
          if (this.blocked[cz * this.cells + nx] === 1) continue;
          if (this.blocked[nz * this.cells + cx] === 1) continue;
          step = Math.SQRT2;
        }

        // An edge touching a hoppable wall's band is a *hop*, so it is priced
        // at the multiplier and held to the hop's own reach rather than to a
        // walking step. Both facts come from the same place — see the header —
        // and neither applies anywhere a hoppable collider is not stamped.
        const intoBand = this.hopBand[neighbourCell] === 1;
        if (intoBand) step *= HOP_COST_MULTIPLIER;
        const rise = onBand || intoBand ? MAX_AUTO_HOP_HEIGHT : MAX_STEP;

        // Every level of the neighbouring cell a walking foot could reach.
        // Levels of one cell are more than a step apart by construction, so
        // at most one matches; the loop is over the cell's own short range.
        const from = this.levelStart[neighbourCell] ?? 0;
        const to = this.levelStart[neighbourCell + 1] ?? 0;
        for (let neighbour = from; neighbour < to; neighbour += 1) {
          if (Math.abs((this.nodeHeight[neighbour] ?? 0) - nodeHeight) > rise) continue;
          this.relax(node, neighbour, nodeCost + step, 0, goalX, goalZ, goalY);
        }
      }

      const edges = this.connectorEdges.get(node);
      if (edges) {
        for (const edge of edges) {
          this.relax(node, edge.to, nodeCost + edge.cost, edge.via, goalX, goalZ, goalY);
        }
      }
    }

    return this.searchBestNode;
  }

  /** One A* relaxation, tracking the best fallback ending as it goes. */
  private relax(
    node: number,
    neighbour: number,
    tentative: number,
    via: number,
    goalX: number,
    goalZ: number,
    goalY: number,
  ): void {
    if (this.state[neighbour] !== NEW && tentative >= (this.gScore[neighbour] ?? 0)) {
      return;
    }
    const heuristic = this.heuristic(this.nodeCell[neighbour] ?? 0, goalX, goalZ);
    this.gScore[neighbour] = tentative;
    this.fScore[neighbour] = tentative + heuristic;
    this.cameFrom[neighbour] = node;
    this.cameVia[neighbour] = via;
    this.state[neighbour] = OPEN;
    this.push(neighbour);

    const score =
      heuristic + Math.abs((this.nodeHeight[neighbour] ?? 0) - goalY) * BEST_HEIGHT_WEIGHT;
    if (score < this.searchBestScore) {
      this.searchBestScore = score;
      this.searchBestNode = neighbour;
    }
  }

  /** Octile distance, in cells: exact for an eight-connected lattice. */
  private heuristic(cell: number, goalX: number, goalZ: number): number {
    const cx = cell % this.cells;
    const cz = (cell - cx) / this.cells;
    const dx = Math.abs(cx - goalX);
    const dz = Math.abs(cz - goalZ);
    return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
  }

  /** Walks `cameFrom` back from the end, writing the path start-first. */
  private reconstruct(startNode: number, endNode: number): number {
    let length = 0;
    for (let node = endNode; node >= 0; node = this.cameFrom[node] ?? -1) {
      this.path[length] = node;
      this.pathVia[length] = this.cameVia[node] ?? 0;
      length += 1;
      if (node === startNode) break;
      if (length >= this.path.length) break;
    }

    for (let i = 0, j = length - 1; i < j; i += 1, j -= 1) {
      const swapNode = this.path[i] ?? 0;
      this.path[i] = this.path[j] ?? 0;
      this.path[j] = swapNode;
      const swapVia = this.pathVia[i] ?? 0;
      this.pathVia[i] = this.pathVia[j] ?? 0;
      this.pathVia[j] = swapVia;
    }
    return length;
  }

  // -------------------------------------------------------------- smoothing

  /**
   * Turns a staircase of cells into the handful of corners a person would
   * actually walk.
   *
   * Straight string-pulling: keep the last waypoint, run forward as long as the
   * straight line back to it is walkable, and emit the last point that was. On
   * open ground the whole route collapses to a single waypoint — the goal — and
   * the walk is bit-for-bit the straight line tap-to-move always did.
   *
   * A connector's spliced-in walk path is exempt: its points are somebody's
   * real stair, emitted verbatim and never string-pulled across — a straight
   * line from the floor to the deck is exactly the line the levels exist to
   * refuse.
   */
  private smooth(
    startX: number,
    startZ: number,
    startY: number,
    goalX: number,
    goalZ: number,
    pathLength: number,
    out: Float32Array,
  ): number {
    // The true start, then the node centres — with each connector's own walk
    // path spliced in where the route took its edge — then, if we got there,
    // the true goal, so the last step lands on the tapped spot rather than on
    // a lattice centre up to 35 cm away from it.
    let points = 0;
    this.pointX[points] = startX;
    this.pointZ[points] = startZ;
    this.pointY[points] = startY;
    this.pointRigid[points] = 0;
    points += 1;
    for (let i = 1; i < pathLength; i += 1) {
      const via = this.pathVia[i] ?? 0;
      if (via !== 0) {
        const connector = this.builtConnectors[Math.abs(via) - 1];
        if (connector) {
          // The whole path, its own first point included: the previous entry
          // is the endpoint's *cell centre*, up to a third of a metre off the
          // true stand point, and the walk should funnel through the true one.
          const count = connector.points.length;
          for (let p = 0; p < count; p += 1) {
            const point = connector.points[via > 0 ? p : count - 1 - p];
            if (!point) continue;
            this.pointX[points] = point.x;
            this.pointZ[points] = point.z;
            this.pointY[points] = point.y;
            this.pointRigid[points] = 1;
            points += 1;
          }
          continue;
        }
      }
      const node = this.path[i] ?? 0;
      const cell = this.nodeCell[node] ?? 0;
      const cx = cell % this.cells;
      const cz = (cell - cx) / this.cells;
      this.pointX[points] = this.originX + cx * CELL;
      this.pointZ[points] = this.originZ + cz * CELL;
      this.pointY[points] = this.nodeHeight[node] ?? 0;
      this.pointRigid[points] = this.hopBand[cell] ?? 0;
      points += 1;
    }
    if (this.reachedGoal) {
      this.pointX[points] = goalX;
      this.pointZ[points] = goalZ;
      this.pointY[points] = this.routeEndY;
      this.pointRigid[points] = 0;
      points += 1;
    }
    if (points < 2) {
      // Already standing on the closest reachable spot there is. That *is* the
      // answer — one waypoint, exactly here — and it makes the caller stop
      // rather than lean on a wall for the length of its stuck timer.
      out[0] = startX;
      out[1] = startZ;
      return 1;
    }

    let written = 0;
    let anchor = 0;
    while (anchor < points - 1 && written < MAX_ROUTE_WAYPOINTS) {
      let furthest = anchor + 1;
      // A rigid point is emitted as it stands: never pulled, never pulled
      // across. Only a run of ordinary lattice points may be straightened.
      if (this.pointRigid[furthest] !== 1) {
        while (
          furthest + 1 < points &&
          this.pointRigid[furthest + 1] !== 1 &&
          this.lineIsWalkable(
            this.pointX[anchor] ?? 0,
            this.pointZ[anchor] ?? 0,
            this.pointY[anchor] ?? 0,
            this.pointX[furthest + 1] ?? 0,
            this.pointZ[furthest + 1] ?? 0,
          )
        ) {
          furthest += 1;
        }
      }
      out[written * 2] = this.pointX[furthest] ?? 0;
      out[written * 2 + 1] = this.pointZ[furthest] ?? 0;
      written += 1;
      anchor = furthest;
    }

    // A route long enough to run out of waypoints is a route round most of the
    // park; end it where it was going rather than wherever it was cut off.
    if (written === MAX_ROUTE_WAYPOINTS) {
      out[(written - 1) * 2] = this.pointX[points - 1] ?? 0;
      out[(written - 1) * 2 + 1] = this.pointZ[points - 1] ?? 0;
    }
    return written;
  }

  /**
   * Is the straight line between two world points walkable end to end, on the
   * levels a walking foot would take?
   *
   * Samples at half a cell, which cannot step over a blocked cell, and follows
   * the nearest level along, so a line that crosses a deck edge or a drop
   * fails for the same reason a step across one does.
   *
   * **A hoppable wall's band is not walkable for this purpose, whatever the
   * search decided.** The pull's whole job is to replace a staircase of cells
   * with the chord across it, and a chord that clips a band is a wall the route
   * never chose to pay for — free again by the back door, which is exactly what
   * this change exists to stop. Where the route genuinely does cross a band,
   * those points are rigid (see {@link pointRigid}) and are emitted as planned
   * rather than pulled, so nothing is lost by refusing here.
   *
   * It reads the floor, and only the floor. That is deliberate, and it is why
   * a ramp's flank must be stamped into the lattice (`navStamped`, see
   * `Collision.ts`): given an unstamped flank, a chord between two of a
   * ramp's waypoints can swing sideways onto the level plateau beside it and
   * read walkable the whole way, because every step of it *is* walkable —
   * just not on the ramp. Making this function also demand that the line
   * arrive at the level of the node it is pulling to was tried as the cure on
   * 9 Aug 2026 and rejected: with the flank stamped it never once changes an
   * answer (measured, 0 firings in 1,678 lobby routes across all three levels
   * and 13,053 park-wide routes), so it bought nothing but an untestable
   * branch on the router's hot path.
   */
  private lineIsWalkable(
    ax: number,
    az: number,
    aHeight: number,
    bx: number,
    bz: number,
  ): boolean {
    const startCell = this.cellAt(ax, az);
    if (startCell < 0 || this.blocked[startCell] === 1 || this.hopBand[startCell] === 1) {
      return false;
    }

    const distance = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(distance / (CELL * 0.5)));
    let previousHeight = aHeight;

    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const cell = this.cellAt(ax + (bx - ax) * t, az + (bz - az) * t);
      if (cell < 0 || this.blocked[cell] === 1 || this.hopBand[cell] === 1) return false;
      const node = this.nodeNearest(cell, previousHeight);
      if (node < 0) return false;
      const height = this.nodeHeight[node] ?? 0;
      if (Math.abs(height - previousHeight) > MAX_STEP) return false;
      previousHeight = height;
    }
    return true;
  }

  // ---------------------------------------------------------------- plumbing

  /** Lattice column a world x falls in. May be out of range; callers clamp. */
  private columnOf(x: number): number {
    return Math.round((x - this.originX) * INVERSE_CELL);
  }

  /** Lattice row a world z falls in. May be out of range; callers clamp. */
  private rowOf(z: number): number {
    return Math.round((z - this.originZ) * INVERSE_CELL);
  }

  /** Cell index for a world point, or -1 if it is off the lattice. */
  private cellAt(x: number, z: number): number {
    const cx = this.columnOf(x);
    const cz = this.rowOf(z);
    if (cx < 0 || cz < 0 || cx >= this.cells || cz >= this.cells) return -1;
    return cz * this.cells + cx;
  }

  /** The closest cell to `cell` a walker could stand in, or -1 if none is near. */
  private nearestFreeCell(cell: number): number {
    const cx = cell % this.cells;
    const cz = (cell - cx) / this.cells;
    for (let ring = 1; ring <= START_SEARCH_RINGS; ring += 1) {
      for (let dz = -ring; dz <= ring; dz += 1) {
        const z = cz + dz;
        if (z < 0 || z >= this.cells) continue;
        const edge = Math.abs(dz) === ring;
        for (let dx = -ring; dx <= ring; dx += edge ? 1 : 2 * ring) {
          const x = cx + dx;
          if (x < 0 || x >= this.cells) continue;
          const candidate = z * this.cells + x;
          if (this.blocked[candidate] === 0) return candidate;
        }
      }
    }
    return -1;
  }

  private push(node: number): void {
    let i = this.heapLength;
    this.heapLength += 1;
    this.heap[i] = node;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentNode = this.heap[parent] ?? 0;
      const own = this.heap[i] ?? 0;
      if ((this.fScore[parentNode] ?? 0) <= (this.fScore[own] ?? 0)) break;
      this.heap[parent] = own;
      this.heap[i] = parentNode;
      i = parent;
    }
  }

  private pop(): number {
    const top = this.heap[0] ?? 0;
    this.heapLength -= 1;
    const last = this.heap[this.heapLength] ?? 0;
    if (this.heapLength === 0) return top;

    this.heap[0] = last;
    let i = 0;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (
        left < this.heapLength &&
        (this.fScore[this.heap[left] ?? 0] ?? 0) < (this.fScore[this.heap[smallest] ?? 0] ?? 0)
      ) {
        smallest = left;
      }
      if (
        right < this.heapLength &&
        (this.fScore[this.heap[right] ?? 0] ?? 0) < (this.fScore[this.heap[smallest] ?? 0] ?? 0)
      ) {
        smallest = right;
      }
      if (smallest === i) break;
      const swap = this.heap[i] ?? 0;
      this.heap[i] = this.heap[smallest] ?? 0;
      this.heap[smallest] = swap;
      i = smallest;
    }
    return top;
  }
}
