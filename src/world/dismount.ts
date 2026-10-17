import { Vector3 } from 'three';
import type { CollisionWorld } from './Collision';
import type { GroundSampler } from '../entities/Player';
import { BUILDING_STEP_UP } from '../core/constants';
import { NAV_CELL, navLatticeFrame } from './navLattice';
import { carryReference, withinStep } from './building/stepReach';

/**
 * **Where she may be put down — the one owner, for every way the game places
 * her.**
 *
 * Jim, 17 October 2026: *"at leaving breakfast on the ground floor of the hotel,
 * it is possible to get soft-locked so that the player is stuck between the
 * breakfast table and the wall"* — and then, of the fix: *"in general, when we
 * choose a point to put the player down, we need to check the reachability of
 * the location, not make it breakfast-specific."* `Hotel.standUp` ended the
 * ride on the chair's own seat, inside the chair and within her table's reach;
 * the resolver pushed her out to the nearest face, which at the lobby café is a
 * strip between two tables and the west wall with no gap a 1.24 m child fits
 * through.
 *
 * This file was already called "the universal safety net" for ride exits
 * (GAME_DESIGN.md's EXIT RULE), and it was universal in name only: five rides
 * remembered to call it, and the breakfast chair, the nap, both lifts, the
 * banquet, the trees, the keychain rack, the cat bus, every doorway and every
 * deep link did not. A rule a caller may forget is a fix copied into each
 * caller, and a copy is always the one that is missing.
 *
 * So no caller calls it. **`Player` does, inside the three ways she is ever
 * placed** — `endRide` (every ride, seat, nap, set piece and cinematic gives
 * her back through it, and must say where), and `teleportTo` / `teleport`
 * (every change of space, every deep link, a restored save, the "Next day"
 * bed) whenever they leave her on her own feet. Nothing else in the game writes
 * her position (`check:exits` proves it, by reading the source).
 *
 * ## The rule
 *
 * A spot is somewhere she may be put down when it is:
 *
 * 1. **inside the space's play bounds** — the soft boundary would not shove her
 *    ({@link CollisionWorld.clearOfBoundary});
 * 2. **solid underfoot, on the floor it names** — the walk surface there is
 *    within a step of it, so she is never put over a void or onto a deck;
 * 3. **clear** — a child's body there, at that floor's height, overlaps nothing
 *    solid by the resolver's own rule (`deepestSolidOverlap`); and
 * 4. **connected to the space's open area** — a bounded flood over the
 *    router's own player-sized cells reaches its arrival, its way out or a
 *    designed stand spot, or is too big to be a pocket ({@link OpenFloor}).
 *    This is the clause the café needed: the strip was clear floor, perfectly
 *    supported, and a dead end.
 *
 * The spot asked for is tried first, and **handed back unchanged when it
 * passes** — every exit and arrival that was already sound puts her exactly
 * where it always did. Otherwise rings of {@link RING_STEP} around it, out to
 * {@link SEARCH_REACH}, nearest first, and the first spot that passes all four.
 *
 * ## The flood is the checks' flood
 *
 * Clause 4 floods in the cells `NavGrid` builds its lattice in
 * (`navLattice.ts`), classified by the rule `NavGrid` stamps them by
 * (`Collision.ts`'s `routeStamp`), stepped by the walk's own reach
 * (`stepReach.ts`) — so "open" here is what the router a child taps with can
 * walk out of, and `check:exits`, which floods the whole space with `NavGrid`
 * itself, measures the same thing at a larger scale. It is bounded so it fits in
 * a frame: a whole-park lattice costs 524 ms to build (measured 17 Oct 2026),
 * and one put-down here classifies at most one window of 1,849 cells.
 */

/**
 * **Where a ride, a seat or a set piece means to hand her back** — its
 * designated exit, world metres. Every `Player.endRide` takes one.
 */
export interface RideExit {
  readonly x: number;
  readonly z: number;
  /**
   * The floor she gets off onto, world Y — the floor, never the seat. For a ride
   * that hands her back moving (`velocity`), the height she is let go at, which
   * may stand a little above that floor (the slide's drop into the balls).
   */
  readonly y: number;
  /** Which way she faces once down, radians as `Player.facing`. Omitted: as she is. */
  readonly facing?: number;
  /** Handed back moving — the slide's delivery into the balls, the tortoise's hop off. */
  readonly velocity?: { readonly x: number; readonly y: number; readonly z: number };
}

/** Where {@link putDownSpot} put her. */
export interface PutDown {
  readonly x: number;
  readonly z: number;
  /** The height to let her go at: the floor there, plus whatever lift the exit asked for. */
  readonly y: number;
  /** The floor under her there — her feet's surface once she lands. */
  readonly floor: number;
  /** How far the rule moved her from the exit she was given, metres; 0 when it passed. */
  readonly moved: number;
  /** False when nothing within reach passed — she is put at the exit regardless, loudly. */
  readonly found: boolean;
  /** Router cells this put-down classified — its cost. */
  readonly cells: number;
}

/** How far from its exit the rule may move her, metres. */
export const SEARCH_REACH = 4;

/** Ring spacing of the search, metres — fine enough to find a gap beside a chair. */
const RING_STEP = 0.25;

/**
 * **How far she must be able to walk from a spot for it to count as open
 * floor without reaching the open area itself**, metres — the flood's bound.
 * The café's strip is 3.4 m end to end and the worst pocket probe 31 ever found
 * is 2.5 m²; a region she can walk six metres out across is a room, not a pocket.
 */
export const OPEN_FLOOR_REACH = 6;

/**
 * Half the side of the one window of the router's cells a put-down works in,
 * metres: the search's reach plus the flood's, so that every candidate the
 * search tries has a full {@link OPEN_FLOOR_REACH} of window around it.
 */
const WINDOW_REACH = SEARCH_REACH + OPEN_FLOOR_REACH;

/** Overlap that still counts as clear: float noise, an ordinary resolve's exact contact. */
const CLEAR_TOLERANCE = 1e-3;

/** Two surfaces in one cell closer than this are one level, asked twice. */
const LEVEL_EPSILON = 0.05;

/** Feet heights within this of each other ask a cell for its surface once, metres. */
const SURFACE_BUCKET = 0.05;

/**
 * **A point of a space's open area** — where the space's own design says a
 * child stands: its arrival, its way out, a designed stand spot (`keepOutsFor`,
 * `libraryStandSpots`, a hotel room's entry). The flood is open the moment it
 * reaches one. World metres.
 */
export interface OpenAreaPoint {
  readonly x: number;
  readonly z: number;
}

/**
 * The body being put down: her radius, and the apex of her hop — so the flood
 * crosses the low walls she hops without being asked, exactly as the router
 * does. Passed in rather than imported: `Player` owns `JUMP_APEX_HEIGHT`, and
 * `Player` imports this file.
 */
export interface PutDownMover {
  readonly radius: number;
  readonly hopApex: number;
}

/**
 * How far above its floor a ride that hands her back **moving** may let her go,
 * metres — the slide's `LANDING_DROP` (0.85 m) into the balls is the tallest.
 * An exit standing still must name its floor to within a step.
 */
const FLING_MAX_LIFT = 1;

/**
 * **The floor an exit means**, and how far above it she is let go.
 *
 * The sampler's surface under the exit, asked from the exit's own height — when
 * that lies within reach below it (a step for an exit standing still,
 * {@link FLING_MAX_LIFT} for one handed back moving). Otherwise the sampler and
 * the exit disagree about where the floor is — an exit stood over a void, or
 * named a deck the floor is not — and the exit's own `y` is taken as the floor
 * it meant: clause 2 then refuses the spot, and the search looks for one whose
 * floor really is there.
 */
function floorOf(sample: GroundSampler, exit: RideExit): { floor: number; lift: number } {
  const under = sample(exit.x, exit.z, exit.y);
  const lift = exit.y - under;
  const reach = exit.velocity ? FLING_MAX_LIFT : BUILDING_STEP_UP;
  // A surface found *above* the height the exit names is never its floor —
  // within a step up, the sampler offers the top of whatever stands there, and
  // a breakfast chair's seat plate (0.42 m) is not the floor a child getting up
  // from it is put down on. A hair above is float noise; more is a prop.
  return lift >= -SAME_FLOOR && lift <= reach ? { floor: under, lift: Math.max(0, lift) } : { floor: exit.y, lift: 0 };
}

/** How far the sampler's surface may stand above the floor an exit names and still be it, metres. */
const SAME_FLOOR = 0.05;

/**
 * **The one rule** — see this file's header. `collision` and `sample` are the
 * two authorities her own walking obeys, and `openArea` the space's own points
 * a flood may reach: `Player` passes its own three.
 *
 * Bounded: one put-down classifies at most the cells of one window — `(2 ·
 * ⌈WINDOW_REACH / NAV_CELL⌉ + 3)²`, 1,849 router cells — each one scan of the
 * few colliders near the exit and, if walkable, one sample per floor it is
 * stepped onto from, because every flood the search runs shares the window's
 * cells and the regions already found in it, and a flood stops the moment it
 * knows its floor is open. Measured by `check:exits` over the 541 put-downs it
 * drives on seed 5 (17 Oct 2026): 1.8–2.0 ms on average, never more than 360
 * cells, the slowest under 15 ms — it prints the cost on every run.
 */
export function putDownSpot(
  collision: CollisionWorld,
  sample: GroundSampler,
  exit: RideExit,
  mover: PutDownMover,
  openArea: readonly OpenAreaPoint[] = [],
): PutDown {
  const { floor: exitFloor, lift } = floorOf(sample, exit);
  const solids = collision.near(exit.x, exit.z, WINDOW_REACH + mover.radius + 2 * NAV_CELL);
  const floor = new OpenFloor(collision, solids, sample, exit.x, exit.z, mover, openArea);
  const probe = new Vector3();

  const accept = (x: number, z: number): PutDown | null => {
    if (!collision.clearOfBoundary(x, z, mover.radius)) return null;
    const surface = sample(x, z, exit.y);
    if (!withinStep(exit.x, exitFloor, exit.z, x, surface, z)) return null;
    // Clear at the exit's own floor, not only at the surface found here: the
    // top of a chair or a table is a surface too, and standing up from one
    // seat onto the next one's cushion is not being put down on the floor.
    probe.set(x, Math.min(surface, exitFloor), z);
    if (solids.deepestSolidOverlap(probe, mover.radius, 0) > CLEAR_TOLERANCE) return null;
    if (!floor.isOpen(x, surface, z)) return null;
    return { x, z, y: surface + lift, floor: surface, moved: Math.hypot(x - exit.x, z - exit.z), found: true, cells: floor.cellsClassified };
  };

  const here = accept(exit.x, exit.z);
  if (here) return here;
  for (let ring = RING_STEP; ring <= SEARCH_REACH + 1e-9; ring += RING_STEP) {
    const samples = Math.max(8, Math.round((ring * Math.PI * 2) / RING_STEP));
    for (let i = 0; i < samples; i += 1) {
      const angle = (i / samples) * Math.PI * 2;
      const spot = accept(exit.x + Math.cos(angle) * ring, exit.z + Math.sin(angle) * ring);
      if (spot) return spot;
    }
  }
  // Nothing within reach passed. Say so loudly — a silent teleport nobody can
  // find in QA is worse — and hand back the exit: it is still the best guess,
  // and there is nowhere else to put her. `check:exits` fails on any put-down
  // the game makes that lands here.
  console.warn(
    `dismount: no clear, open spot within ${SEARCH_REACH} m of ` +
      `(${exit.x.toFixed(2)}, ${exit.y.toFixed(2)}, ${exit.z.toFixed(2)})`,
  );
  return { x: exit.x, z: exit.z, y: exit.y, floor: exitFloor, moved: 0, found: false, cells: floor.cellsClassified };
}

/**
 * **Is the floor at a spot connected to the space's open area?** — clause 4 of
 * the rule, the question a pocket fails, asked in **the router's own cells**:
 * `navLattice.ts`'s frame for the space's current play bounds, so these are
 * exactly the cell centres `NavGrid` lays over the space. That matters more than
 * it looks: a lattice centred on the spot itself sees squeezes the router's does
 * not, and the first version of this rule, so centred, stood a child up from
 * the lobby café's middle chair on an island south of the tables that a stick
 * could wriggle out of and a tap never could (probe 31's 1.5 m² island).
 *
 * One window of those cells, {@link WINDOW_REACH} round the exit, built lazily
 * and shared by every flood of one put-down:
 *
 * - a **cell** is blocked when a body of the mover's radius at its centre is
 *   not clear of the play boundary, or overlaps any collider the router stamps
 *   (`Collision.ts`'s `routeStamp`, the one rule `NavGrid` stamps its own
 *   lattice by): height-blind, so the top of a table is no more a road out than
 *   its legs, and the walls she hops left open;
 * - a **node** is a walkable cell at one level, its surface asked of the
 *   sampler from the height of the foot stepping onto it (`carryReference`, as
 *   her own walk asks); nodes join when the step is within her reach
 *   (`withinStep`, up or down, as `NavGrid` holds a route to it), and a diagonal
 *   only when both straight cells beside it are walkable — the router's
 *   no-corner-cutting rule;
 * - a **region** is every node one flood reaches. It is **open** when it holds a
 *   cell beside a point of the space's open area, or reaches
 *   {@link OPEN_FLOOR_REACH} from where the flood began — no pocket is that big.
 *   Otherwise it is a pocket, flooded whole. Every later spot in a labelled
 *   region is answered from the label.
 */
class OpenFloor {
  /** How many cells this window has classified — the cost of one put-down. */
  cellsClassified = 0;

  private readonly collision: CollisionWorld;
  private readonly solids: CollisionWorld;
  private readonly sample: GroundSampler;
  private readonly mover: PutDownMover;
  private readonly originX: number;
  private readonly originZ: number;
  /** Global lattice indices of window cell (0, 0). */
  private readonly baseI: number;
  private readonly baseJ: number;
  private readonly side: number;
  /** 0 not yet asked, 1 walkable, 2 blocked. Height-blind, like the router's. */
  private readonly blocked: Uint8Array;
  /** 1 where the cell is beside a point of the open area. */
  private readonly anchor: Uint8Array;
  /** Each cell's levels found so far, and the region each belongs to (-1: not flooded yet). */
  private readonly levels: { y: number; region: number }[][];
  /**
   * Each cell's surface as asked from a given height — `[reference bucket,
   * surface, …]` — so a cell stepped onto from eight neighbours on one floor
   * asks the sampler once, not eight times (the sampler is the flood's whole
   * cost: 3.9 µs a call over the hotel's 222 plates, measured 17 Oct 2026).
   */
  private readonly surfaces: number[][];
  /** Whether each region found is open. */
  private readonly regionOpen: boolean[] = [];

  constructor(
    collision: CollisionWorld,
    solids: CollisionWorld,
    sample: GroundSampler,
    centreX: number,
    centreZ: number,
    mover: PutDownMover,
    openArea: readonly OpenAreaPoint[],
  ) {
    this.collision = collision;
    this.solids = solids;
    this.sample = sample;
    this.mover = mover;
    const frame = navLatticeFrame(collision.playBounds.extent);
    this.originX = frame.originX;
    this.originZ = frame.originZ;
    const half = Math.ceil(WINDOW_REACH / NAV_CELL) + 1;
    this.side = half * 2 + 1;
    this.baseI = Math.round((centreX - frame.originX) / NAV_CELL) - half;
    this.baseJ = Math.round((centreZ - frame.originZ) / NAV_CELL) - half;
    this.blocked = new Uint8Array(this.side * this.side);
    this.anchor = new Uint8Array(this.side * this.side);
    this.levels = Array.from({ length: this.side * this.side }, () => []);
    this.surfaces = Array.from({ length: this.side * this.side }, () => []);
    for (const point of openArea) {
      const i = Math.round((point.x - frame.originX) / NAV_CELL) - this.baseI;
      const j = Math.round((point.z - frame.originZ) / NAV_CELL) - this.baseJ;
      // Its own cell and the eight beside it: a stand spot drawn against a
      // counter may have its own cell's centre inside the counter's stamp.
      for (let dj = -1; dj <= 1; dj += 1) {
        for (let di = -1; di <= 1; di += 1) {
          const ni = i + di;
          const nj = j + dj;
          if (ni >= 0 && nj >= 0 && ni < this.side && nj < this.side) this.anchor[nj * this.side + ni] = 1;
        }
      }
    }
  }

  /** Is the floor at `(x, floor, z)` connected to the open area? See the class. */
  isOpen(x: number, floor: number, z: number): boolean {
    const home = this.cellOf(x, z);
    if (home < 0) return true; // off the window: the search never asks this far out
    // Where the router would start her: her own cell, or the nearest free one
    // beside it when her own cell's centre is in something (its `findRoute`).
    let start = -1;
    let startLevel = 0;
    let best = Infinity;
    const homeI = home % this.side;
    const homeJ = (home - homeI) / this.side;
    for (let k = -1; k < 8; k += 1) {
      const i = homeI + (k < 0 ? 0 : NEIGHBOUR_I[k]!);
      const j = homeJ + (k < 0 ? 0 : NEIGHBOUR_J[k]!);
      if (i < 0 || j < 0 || i >= this.side || j >= this.side) continue;
      const cell = j * this.side + i;
      if (!this.walkable(cell)) continue;
      const level = this.levelIndex(cell, x, floor, z);
      if (level < 0) continue;
      const distance = Math.hypot(this.cellX(cell) - x, this.cellZ(cell) - z);
      if (k < 0) {
        start = cell;
        startLevel = level;
        break;
      }
      if (distance < best) {
        best = distance;
        start = cell;
        startLevel = level;
      }
    }
    if (start < 0) return false;
    const node = this.levels[start]![startLevel]!;
    if (node.region < 0) this.flood(start, startLevel);
    return this.regionOpen[node.region] ?? false;
  }

  /**
   * Floods one region from a node and labels every node it reaches — and stops
   * the moment the region is known to be open: a cell beside the open area, or
   * one {@link OPEN_FLOOR_REACH} from where the flood began. A pocket is small,
   * so it is always flooded whole; open floor is answered in a few hundred
   * cells. (The rest of an open region stays unlabelled; a later spot there
   * floods again, and finds the same.)
   */
  private flood(startCell: number, startLevel: number): void {
    const region = this.regionOpen.length;
    let open = false;
    const startX = this.cellX(startCell);
    const startZ = this.cellZ(startCell);
    const reachSquared = OPEN_FLOOR_REACH * OPEN_FLOOR_REACH;
    const queueCell: number[] = [startCell];
    const queueLevel: number[] = [startLevel];
    this.levels[startCell]![startLevel]!.region = region;
    for (let head = 0; head < queueCell.length && !open; head += 1) {
      const cell = queueCell[head]!;
      const level = queueLevel[head]!;
      const i = cell % this.side;
      const j = (cell - i) / this.side;
      const dx = this.cellX(cell) - startX;
      const dz = this.cellZ(cell) - startZ;
      if (
        this.anchor[cell] === 1 ||
        dx * dx + dz * dz >= reachSquared ||
        i === 0 ||
        j === 0 ||
        i === this.side - 1 ||
        j === this.side - 1
      ) {
        open = true;
        break;
      }
      const fromX = this.cellX(cell);
      const fromZ = this.cellZ(cell);
      const fromY = this.levels[cell]![level]!.y;
      for (let k = 0; k < 8; k += 1) {
        const ni = i + NEIGHBOUR_I[k]!;
        const nj = j + NEIGHBOUR_J[k]!;
        if (ni < 0 || nj < 0 || ni >= this.side || nj >= this.side) continue;
        const next = nj * this.side + ni;
        if (!this.walkable(next)) continue;
        // No cutting corners — `NavGrid`'s rule, for the reason it gives there.
        if (k >= 4 && (!this.walkable(j * this.side + ni) || !this.walkable(nj * this.side + i))) continue;
        const nextLevel = this.levelIndex(next, fromX, fromY, fromZ);
        if (nextLevel < 0) continue;
        const node = this.levels[next]![nextLevel]!;
        if (node.region >= 0) continue;
        node.region = region;
        queueCell.push(next);
        queueLevel.push(nextLevel);
      }
    }
    this.regionOpen.push(open);
  }

  /** The cell's height-blind verdict, asked once. */
  private walkable(cell: number): boolean {
    if (this.blocked[cell] === 0) {
      this.cellsClassified += 1;
      const x = this.cellX(cell);
      const z = this.cellZ(cell);
      const clear =
        this.collision.clearOfBoundary(x, z, this.mover.radius) &&
        !this.solids.routeBlocked(x, z, this.mover.radius, this.mover.hopApex);
      this.blocked[cell] = clear ? 1 : 2;
    }
    return this.blocked[cell] === 1;
  }

  /**
   * The level of `cell` a foot at `(fromX, fromY, fromZ)` steps onto — found or
   * added — or -1 when the surface there is beyond her step.
   */
  private levelIndex(cell: number, fromX: number, fromY: number, fromZ: number): number {
    const x = this.cellX(cell);
    const z = this.cellZ(cell);
    const bucket = Math.round(fromY / SURFACE_BUCKET);
    const asked = this.surfaces[cell]!;
    let surface = Number.NaN;
    for (let k = 0; k < asked.length; k += 2) {
      if (asked[k] === bucket) {
        surface = asked[k + 1]!;
        break;
      }
    }
    if (Number.isNaN(surface)) {
      surface = this.sample(x, z, carryReference(fromX, fromZ, fromY, x, z));
      asked.push(bucket, surface);
    }
    if (!withinStep(fromX, fromY, fromZ, x, surface, z)) return -1;
    const levels = this.levels[cell]!;
    for (let k = 0; k < levels.length; k += 1) {
      if (Math.abs(levels[k]!.y - surface) <= LEVEL_EPSILON) return k;
    }
    levels.push({ y: surface, region: -1 });
    return levels.length - 1;
  }

  private cellOf(x: number, z: number): number {
    const i = Math.round((x - this.originX) / NAV_CELL) - this.baseI;
    const j = Math.round((z - this.originZ) / NAV_CELL) - this.baseJ;
    if (i < 0 || j < 0 || i >= this.side || j >= this.side) return -1;
    return j * this.side + i;
  }

  private cellX(cell: number): number {
    return this.originX + (this.baseI + (cell % this.side)) * NAV_CELL;
  }

  private cellZ(cell: number): number {
    return this.originZ + (this.baseJ + Math.floor(cell / this.side)) * NAV_CELL;
  }
}

/** Neighbour offsets: four straight, then four diagonal — `NavGrid`'s order. */
const NEIGHBOUR_I = [1, -1, 0, 0, 1, 1, -1, -1] as const;
const NEIGHBOUR_J = [0, 0, 1, -1, 1, -1, 1, -1] as const;

/** A spot somebody is already standing on, in world metres. */
export interface OccupiedSpot {
  readonly x: number;
  readonly z: number;
  /** How much room that body needs around itself. */
  readonly radius: number;
}

/**
 * **Where a group of cosmetic riders steps off** — the Rail Race's crowd of
 * racers: several bodies stepping off together, none of them standing inside
 * the geometry and none of them standing inside each other.
 *
 * Not the player's rule: she is put down by {@link putDownSpot} (through
 * `Player.endRide`), first, and passed in here in `occupied`, so nobody can
 * ever appear standing on top of her. A single-point search asked three times
 * hands back the same answer three times, which is precisely wrong for a crowd,
 * so a candidate here is only accepted if it is clear of the geometry *and* of
 * everybody already placed, the caller's own `occupied` list included.
 *
 * Bodies are placed in the order asked for, each one starting its own search
 * from a point fanned around `preferredX/Z`, so the result reads as a little
 * group gathered round a spot rather than a queue marching away from it.
 */
export function resolveDismountGroup(
  collision: CollisionWorld,
  preferredX: number,
  preferredZ: number,
  radius: number,
  count: number,
  occupied: readonly OccupiedSpot[] = [],
): { x: number; z: number }[] {
  const placed: OccupiedSpot[] = [...occupied];
  const out: { x: number; z: number }[] = [];

  // Fan the *starting guesses* around the exit rather than all searching from
  // its centre: three bodies spiralling out of one point find three spots in a
  // line, because they all walk the same ring in the same order.
  const spread = radius * 2.4;
  for (let i = 0; i < count; i += 1) {
    const angle = ((i + 0.5) / count) * Math.PI * 2;
    const seedX = preferredX + Math.cos(angle) * spread;
    const seedZ = preferredZ + Math.sin(angle) * spread;

    const clear = (x: number, z: number): boolean =>
      collision.isClearCircle(x, z, radius) &&
      placed.every((o) => Math.hypot(x - o.x, z - o.z) >= radius + o.radius);

    let spot: { x: number; z: number } | null = clear(seedX, seedZ)
      ? { x: seedX, z: seedZ }
      : null;

    if (!spot) {
      const ringStep = 0.6;
      const maxRing = 6;
      search: for (let ring = ringStep; ring <= maxRing; ring += ringStep) {
        const samples = Math.max(8, Math.round((ring * Math.PI * 2) / ringStep));
        for (let s = 0; s < samples; s += 1) {
          // Start each body's sweep at its own bearing, so two bodies that
          // fall back to the same ring do not both take the first sample.
          const a = angle + (s / samples) * Math.PI * 2;
          const x = seedX + Math.cos(a) * ring;
          const z = seedZ + Math.sin(a) * ring;
          if (clear(x, z)) {
            spot = { x, z };
            break search;
          }
        }
      }
    }

    // Same contract as `putDownSpot`: say so loudly, hand back the best
    // guess, never drop a body on the floor. These are cosmetic characters, so
    // the worst case is two of them overlapping for a few seconds — never a
    // player stuck in anything.
    if (!spot) {
      console.warn(
        `dismount: no clear group spot ${i + 1}/${count} near ` +
          `(${preferredX.toFixed(1)}, ${preferredZ.toFixed(1)})`,
      );
      spot = { x: seedX, z: seedZ };
    }

    placed.push({ x: spot.x, z: spot.z, radius });
    out.push(spot);
  }

  return out;
}
