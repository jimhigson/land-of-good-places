import { BUILDING_FLOOR_HEIGHT, BUILDING_STEP_UP } from '../core/constants';
import type { GroundSampler } from '../entities/Player';
import { autoHopClears, type CollisionWorld } from './Collision';

/**
 * The park, as something you can find a way across.
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
 * - **the ground sampler** for the height of each free cell, so a route can
 *   never step up something too tall to walk up, nor off the edge of a deck.
 *
 * Both are read at plan time from the *finished* world, so the railway,
 * the replanned attractions and anything else built later appear in it for
 * free, with nothing to re-author. That is the whole reason it is built this
 * way rather than drawn by hand.
 *
 * ## Walls she can hop are not obstacles
 *
 * The low garden walls are `autoHoppable` (design feedback #30e): walk into one
 * and the character hops it without being asked. A route that detoured around
 * one would be strictly worse than the straight line, so hoppable colliders the
 * hop actually clears are **not stamped at all** — the route goes over them,
 * and `Player`'s existing lookahead fires the hop when she gets there. The test
 * is the same `reach >= topHeight` comparison `CollisionWorld.wouldAutoHopClear`
 * makes, from the same numbers, so the two can never disagree about which walls
 * those are.
 *
 * ## Nothing here happens per frame
 *
 * The lattice is built lazily, on the first route asked for in a space, and
 * kept until the space changes (the soft play bounds move), the collision world
 * changes (`CollisionWorld.revision`) or the walker's height moves by half a
 * storey — i.e. she has changed floor and "the ground" means something else
 * now. A route is planned **once per tap** and then simply followed; the
 * per-frame cost of a routed walk is one distance check more than an unrouted
 * one, and no allocation. Every buffer below is allocated once per lattice and
 * reused (ARCHITECTURE-REVIEW's standing complaint about per-frame garbage).
 *
 * ## When there is no route
 *
 * There is always an answer. A* keeps the reachable cell that got closest to
 * the goal, so an unreachable destination — the middle of the fountain, a
 * corner of the park behind a locked gate — yields a route to the nearest place
 * she *can* stand, and `TapNavigator` walks her there and stops. It never
 * returns nothing because the goal was hopeless; it returns nothing only when
 * it has no lattice covering where she is standing, which is `TapNavigator`'s
 * cue to fall back to the old straight-line seek and behave exactly as the game
 * did before.
 */

/**
 * Lattice pitch, in metres.
 *
 * Half a metre against a 0.62 m walker radius: fine enough that the gaps
 * between trees and the doorways between stalls survive, coarse enough that the
 * whole park is 240 cells square and builds in a few milliseconds. Cells are
 * classified by their **centre**, so the lattice is very slightly optimistic
 * about tight corners — which is the right way to be wrong. An optimistic route
 * clips a corner and the collision resolver slides her round it; a pessimistic
 * one seals a gap she can plainly see and walks her the long way about.
 */
const CELL = 0.5;
const INVERSE_CELL = 1 / CELL;

/** Metres of lattice built beyond the soft play boundary, for elbow room. */
const MARGIN = 2;

/**
 * The biggest height change between neighbouring cells a route may take.
 *
 * The same step the building already uses for "can you walk up this?", applied
 * in both directions: up, because a taller rise is not walkable at all; down,
 * because a bigger drop is a fall, and a route should not casually walk a child
 * off the edge of a deck on the way to somewhere else. The ball pit's 0.5 m lip
 * sits comfortably under it and stays walkable, as it must.
 */
const MAX_STEP = BUILDING_STEP_UP;

/**
 * How far the walker's height may drift before the lattice is rebuilt.
 *
 * Heights are sampled once, with the walker's own height as the reference —
 * exactly as `pickWalkable` does, and for the same reason: the sampler answers
 * with the surfaces within a step of *her feet*, which is the floor she is
 * standing on and can see. Half a storey never fires for the park's gentle
 * hills (whose whole range is about 1.4 m) and always fires for a change of
 * floor inside the building.
 */
const REBUILD_HEIGHT = BUILDING_FLOOR_HEIGHT * 0.5;

/** Rings of cells searched for somewhere to stand when the walker is inside something. */
const START_SEARCH_RINGS = 8;

/**
 * Ceiling on A* expansions, as insurance rather than as tuning.
 *
 * A reachable goal is found in a few thousand; a hopeless one floods the whole
 * lattice, which is 57 600 cells for the park, and that is the number this
 * protects against being exceeded by some future, larger space.
 */
const MAX_EXPANSIONS = 80_000;

/** Waypoints a single route may have after smoothing. Real ones use under ten. */
export const MAX_ROUTE_WAYPOINTS = 64;

const NEW = 0;
const OPEN = 1;
const CLOSED = 2;

/** Neighbour offsets: four straight, then four diagonal. */
const NEIGHBOUR_X = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const NEIGHBOUR_Z = [0, 0, 1, -1, 1, -1, 1, -1] as const;

export class NavGrid {
  /** Cells per side. 0 until the first lattice is built. */
  private cells = 0;
  /** World position of the centre of cell (0, 0). */
  private originX = 0;
  private originZ = 0;

  private blocked = new Uint8Array(0);
  private height = new Float32Array(0);

  private gScore = new Float32Array(0);
  private fScore = new Float32Array(0);
  private cameFrom = new Int32Array(0);
  private state = new Uint8Array(0);
  private heap = new Int32Array(0);
  private heapLength = 0;

  /** The cell path A* found, start-first, before smoothing. */
  private path = new Int32Array(0);
  /** The same as world points, plus the true start and goal at the ends. */
  private pointX = new Float32Array(0);
  private pointZ = new Float32Array(0);

  private built = false;
  private builtCentreX = 0;
  private builtCentreZ = 0;
  private builtRadius = 0;
  private builtY = 0;
  private builtRevision = -1;

  private reachedGoal = false;

  constructor(
    private readonly collision: CollisionWorld,
    /** The walker's own half-width — every collider is fattened by it. */
    private readonly walkerRadius: number,
    /**
     * The apex of the walker's jump above their own feet — `Player`'s
     * `JUMP_APEX_HEIGHT`, the same number its auto-hop lookahead is fed. Passed
     * in rather than imported so the one derivation of it stays in `Player`,
     * and handed straight to `Collision`'s shared {@link autoHopClears}.
     */
    private readonly hopApex: number,
  ) {}

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
   * Plans a walk from one world point to another, writing `x, z` pairs into
   * `out` and returning how many it wrote.
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
    goalX: number,
    goalZ: number,
    sample: GroundSampler,
    referenceY: number,
    out: Float32Array,
  ): number {
    this.reachedGoal = false;
    if (!this.ensureLattice(sample, referenceY)) return 0;

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

    const goalCell = this.cellAt(goalX, goalZ);
    // A goal off the edge of the lattice is not "unreachable", it is
    // unknowable. Say so, and let the caller fall back.
    if (goalCell < 0) return 0;

    const endCell = this.search(startCell, goalCell);
    this.reachedGoal = endCell === goalCell && this.blocked[goalCell] === 0;

    const pathLength = this.reconstruct(startCell, endCell);
    return this.smooth(startX, startZ, goalX, goalZ, pathLength, out);
  }

  // ------------------------------------------------------------- the lattice

  /**
   * Builds or rebuilds the lattice if the one in hand does not describe the
   * space the walker is in. Returns false if there is no usable lattice at all.
   */
  private ensureLattice(sample: GroundSampler, referenceY: number): boolean {
    const centreX = this.collision.playBoundsX;
    const centreZ = this.collision.playBoundsZ;
    const radius = this.collision.playBoundsRadius;

    if (
      this.built &&
      this.builtRevision === this.collision.revision &&
      this.builtCentreX === centreX &&
      this.builtCentreZ === centreZ &&
      this.builtRadius === radius &&
      Math.abs(referenceY - this.builtY) <= REBUILD_HEIGHT
    ) {
      return true;
    }

    this.rebuild(centreX, centreZ, radius, sample, referenceY);
    return this.built;
  }

  private rebuild(
    centreX: number,
    centreZ: number,
    radius: number,
    sample: GroundSampler,
    referenceY: number,
  ): void {
    const side = Math.ceil(((radius + MARGIN) * 2) / CELL);
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
      this.height = new Float32Array(total);
      this.gScore = new Float32Array(total);
      this.fScore = new Float32Array(total);
      this.cameFrom = new Int32Array(total);
      this.state = new Uint8Array(total);
      this.heap = new Int32Array(total);
      this.path = new Int32Array(total);
      this.pointX = new Float32Array(total + 2);
      this.pointZ = new Float32Array(total + 2);
    } else {
      this.blocked.fill(0);
    }

    // The soft boundary first: everything the resolver would push her back
    // inside of is simply not part of the map.
    const limit = radius - this.walkerRadius;
    const limitSquared = limit * limit;
    for (let cz = 0; cz < side; cz += 1) {
      const z = this.originZ + cz * CELL;
      const dz = z - centreZ;
      const row = cz * side;
      for (let cx = 0; cx < side; cx += 1) {
        const dx = this.originX + cx * CELL - centreX;
        if (dx * dx + dz * dz > limitSquared) this.blocked[row + cx] = 1;
      }
    }

    // Then everything solid, fattened by the walker's own width — skipping the
    // walls she hops without being asked, which are not obstacles to her.
    this.collision.forEachCircle((x, z, colliderRadius, topHeight, autoHoppable) => {
      if (autoHoppable && autoHopClears(topHeight, this.hopApex)) return;
      this.stampCircle(x, z, colliderRadius + this.walkerRadius);
    });
    this.collision.forEachWall((x1, z1, x2, z2, halfThickness, topHeight, autoHoppable) => {
      if (autoHoppable && autoHopClears(topHeight, this.hopApex)) return;
      this.stampSegment(x1, z1, x2, z2, halfThickness + this.walkerRadius);
    });

    // Heights, for the free cells only — a blocked cell is never stepped on, so
    // its height is never asked for, and this is much the most expensive part.
    for (let cz = 0; cz < side; cz += 1) {
      const z = this.originZ + cz * CELL;
      const row = cz * side;
      for (let cx = 0; cx < side; cx += 1) {
        const index = row + cx;
        if (this.blocked[index] === 1) continue;
        this.height[index] = sample(this.originX + cx * CELL, z, referenceY);
      }
    }

    this.built = true;
    this.builtCentreX = centreX;
    this.builtCentreZ = centreZ;
    this.builtRadius = radius;
    this.builtY = referenceY;
    this.builtRevision = this.collision.revision;
  }

  private stampCircle(x: number, z: number, radius: number): void {
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
        if (dx * dx + dz * dz <= radiusSquared) this.blocked[row + cx] = 1;
      }
    }
  }

  private stampSegment(
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    radius: number,
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
        if (dx * dx + dz * dz <= radiusSquared) this.blocked[row + cx] = 1;
      }
    }
  }

  // --------------------------------------------------------------- the search

  /**
   * A* from one cell to another, over an eight-connected lattice.
   *
   * Returns the cell the route ends on: the goal when it was reached, and
   * otherwise the reachable cell that got nearest to it, which is what makes
   * "no route exists" degrade into "walk as close as you can and stop" rather
   * than into a shrug.
   */
  private search(startCell: number, goalCell: number): number {
    const total = this.cells * this.cells;
    this.state.fill(NEW, 0, total);
    this.heapLength = 0;

    const goalX = goalCell % this.cells;
    const goalZ = (goalCell - goalX) / this.cells;

    this.gScore[startCell] = 0;
    this.fScore[startCell] = this.heuristic(startCell, goalX, goalZ);
    this.cameFrom[startCell] = -1;
    this.state[startCell] = OPEN;
    this.push(startCell);

    let bestCell = startCell;
    let bestHeuristic = this.fScore[startCell] ?? 0;
    let expansions = 0;

    while (this.heapLength > 0) {
      const cell = this.pop();
      if (cell === goalCell) return cell;
      if (this.state[cell] === CLOSED) continue;
      this.state[cell] = CLOSED;

      expansions += 1;
      if (expansions > MAX_EXPANSIONS) break;

      const cx = cell % this.cells;
      const cz = (cell - cx) / this.cells;
      const cellHeight = this.height[cell] ?? 0;
      const cellCost = this.gScore[cell] ?? 0;

      for (let i = 0; i < 8; i += 1) {
        const nx = cx + (NEIGHBOUR_X[i] ?? 0);
        const nz = cz + (NEIGHBOUR_Z[i] ?? 0);
        if (nx < 0 || nz < 0 || nx >= this.cells || nz >= this.cells) continue;

        const neighbour = nz * this.cells + nx;
        if (this.blocked[neighbour] === 1) continue;
        if (Math.abs((this.height[neighbour] ?? 0) - cellHeight) > MAX_STEP) continue;

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

        const tentative = cellCost + step;
        if (this.state[neighbour] !== NEW && tentative >= (this.gScore[neighbour] ?? 0)) {
          continue;
        }

        const heuristic = this.heuristic(neighbour, goalX, goalZ);
        this.gScore[neighbour] = tentative;
        this.fScore[neighbour] = tentative + heuristic;
        this.cameFrom[neighbour] = cell;
        this.state[neighbour] = OPEN;
        this.push(neighbour);

        if (heuristic < bestHeuristic) {
          bestHeuristic = heuristic;
          bestCell = neighbour;
        }
      }
    }

    return bestCell;
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
  private reconstruct(startCell: number, endCell: number): number {
    let length = 0;
    for (let cell = endCell; cell >= 0; cell = this.cameFrom[cell] ?? -1) {
      this.path[length] = cell;
      length += 1;
      if (cell === startCell) break;
      if (length >= this.path.length) break;
    }

    for (let i = 0, j = length - 1; i < j; i += 1, j -= 1) {
      const swap = this.path[i] ?? 0;
      this.path[i] = this.path[j] ?? 0;
      this.path[j] = swap;
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
   */
  private smooth(
    startX: number,
    startZ: number,
    goalX: number,
    goalZ: number,
    pathLength: number,
    out: Float32Array,
  ): number {
    // The true start, then the cell centres, then — if we got there — the true
    // goal, so the last step lands on the tapped spot rather than on a lattice
    // centre up to 35 cm away from it.
    let points = 0;
    this.pointX[points] = startX;
    this.pointZ[points] = startZ;
    points += 1;
    for (let i = 1; i < pathLength; i += 1) {
      const cell = this.path[i] ?? 0;
      const cx = cell % this.cells;
      const cz = (cell - cx) / this.cells;
      this.pointX[points] = this.originX + cx * CELL;
      this.pointZ[points] = this.originZ + cz * CELL;
      points += 1;
    }
    if (this.reachedGoal) {
      this.pointX[points] = goalX;
      this.pointZ[points] = goalZ;
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
      while (
        furthest + 1 < points &&
        this.lineIsWalkable(
          this.pointX[anchor] ?? 0,
          this.pointZ[anchor] ?? 0,
          this.pointX[furthest + 1] ?? 0,
          this.pointZ[furthest + 1] ?? 0,
        )
      ) {
        furthest += 1;
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
   * Is the straight line between two world points walkable end to end?
   *
   * Samples at half a cell, which cannot step over a blocked cell, and carries
   * the height along so a line that crosses a deck edge or a drop fails for the
   * same reason a step across one does.
   */
  private lineIsWalkable(ax: number, az: number, bx: number, bz: number): boolean {
    const startCell = this.cellAt(ax, az);
    if (startCell < 0 || this.blocked[startCell] === 1) return false;

    const distance = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(distance / (CELL * 0.5)));
    let previousHeight = this.height[startCell] ?? 0;

    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const cell = this.cellAt(ax + (bx - ax) * t, az + (bz - az) * t);
      if (cell < 0 || this.blocked[cell] === 1) return false;
      const height = this.height[cell] ?? 0;
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

  private push(cell: number): void {
    let i = this.heapLength;
    this.heapLength += 1;
    this.heap[i] = cell;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentCell = this.heap[parent] ?? 0;
      const own = this.heap[i] ?? 0;
      if ((this.fScore[parentCell] ?? 0) <= (this.fScore[own] ?? 0)) break;
      this.heap[parent] = own;
      this.heap[i] = parentCell;
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
