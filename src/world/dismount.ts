import { Vector3 } from 'three';
import type { CollisionWorld } from './Collision';
import type { GroundSampler } from '../entities/Player';
import { BUILDING_STEP_UP } from '../core/constants';
import { NAV_CELL, navLatticeFrame } from './navLattice';
import { carryReference, withinStep } from './building/stepReach';

/**
 * **Where every ride, seat and set piece puts her down — the one owner.**
 *
 * GAME_DESIGN.md's EXIT RULE (28 July 2026) says every ride has a designated
 * exit. This file used to be the "universal safety net" under it, and it was
 * universal in name only: `resolveDismount` was *called* by the five rides that
 * remembered to call it, and the hotel's breakfast chair, its nap, its two
 * cinematics, both lifts, the castle banquet, tree climbing, the keychain rack
 * and the cat bus did not. Jim, 17 October 2026: *"at leaving breakfast on the
 * ground floor of the hotel, it is possible to get soft-locked so that the
 * player is stuck between the breakfast table and the wall."* `Hotel.standUp`
 * ended the ride on the chair's own seat — inside the chair, and 0.17 m inside
 * her table's reach — and the resolver pushed her out to the nearest face,
 * which at the lobby café is a strip between two tables and the west wall with
 * no gap a 1.24 m child fits through. A safety net nobody is obliged to use is
 * a fix copied into each caller, and a copy is always the one that is missing.
 *
 * So it is no longer something a ride calls. **`Player.endRide` takes a
 * {@link RideExit} — required — and runs {@link putDownSpot} on it itself**, so
 * there is no way to give her back without saying where, and no way to say
 * where without the rule being applied.
 *
 * ## The rule
 *
 * A spot is somewhere she may be put down when it is:
 *
 * 1. **inside the space's play bounds** — the soft boundary would not shove her
 *    ({@link CollisionWorld.clearOfBoundary});
 * 2. **solid underfoot, on the exit's own level** — the walk surface there is
 *    within a step of the floor the exit names, so she is never put over a
 *    void or onto the deck above;
 * 3. **clear** — a child's body there, at that floor's height, overlaps nothing
 *    solid, by the resolver's own rule (`deepestSolidOverlap`); and
 * 4. **open** — she can walk from it to at least {@link OPEN_FLOOR_REACH} away
 *    ({@link openFloorFrom}). This is the clause the café needed: the strip was
 *    clear floor, perfectly supported, and a dead end.
 *
 * The exit itself is tried first, and **handed back unchanged when it passes**
 * — every planned exit that was already sound puts her exactly where it always
 * did. Otherwise rings of {@link RING_STEP} around it, out to
 * {@link SEARCH_REACH}, nearest first, and the first spot that passes all four.
 *
 * ## What "open" can and cannot promise
 *
 * Clause 4 is a *local* question by design: a whole-space flood costs 524 ms in
 * the park (the router's lattice, measured 17 Oct 2026) and a put-down has to
 * fit in a frame. So it asks what a pocket would fail — can she get five metres
 * from here — in the router's own cells (`navLattice.ts`'s frame, the very
 * cells `NavGrid` lays over the space), so it is pessimistic in exactly the
 * narrow gaps the router is, with the router's no-corner-cutting rule and the
 * walk's own step reach. Whether every exit really reaches its space's
 * way out is a whole-space question, and `check:exits` answers it for every
 * exit the game has, with a control that can say "trapped".
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
}

/** How far from its exit the rule may move her, metres. */
export const SEARCH_REACH = 4;

/** Ring spacing of the search, metres — fine enough to find a gap beside a chair. */
const RING_STEP = 0.25;

/**
 * **How far she must be able to walk from a spot for it to be open floor**,
 * metres. The café's strip is 3.4 m end to end; a room is far more than this.
 * A pocket she cannot walk five metres out of is a pocket, whatever it holds.
 */
export const OPEN_FLOOR_REACH = 5;

/** Overlap that still counts as clear: float noise, an ordinary resolve's exact contact. */
const CLEAR_TOLERANCE = 1e-3;

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
  // A little below its floor is the floor (a terrain height a hair under the
  // paving); a step or more off either way is a disagreement.
  return lift >= -BUILDING_STEP_UP && lift <= reach ? { floor: under, lift: Math.max(0, lift) } : { floor: exit.y, lift: 0 };
}

/** How far around a spot the solids are gathered for one put-down. */
function gatherReach(mover: PutDownMover): number {
  return SEARCH_REACH + OPEN_FLOOR_REACH + mover.radius + 2 * NAV_CELL;
}

/**
 * **The one rule** — see this file's header. `collision` and `sample` are the
 * two authorities her own walking obeys: `Player.endRide` passes its own.
 */
export function putDownSpot(
  collision: CollisionWorld,
  sample: GroundSampler,
  exit: RideExit,
  mover: PutDownMover,
): PutDown {
  const { floor: exitFloor, lift } = floorOf(sample, exit);
  const solids = collision.near(exit.x, exit.z, gatherReach(mover));
  const probe = new Vector3();

  const accept = (x: number, z: number): PutDown | null => {
    if (!collision.clearOfBoundary(x, z, mover.radius)) return null;
    const floor = sample(x, z, exit.y);
    if (!withinStep(exit.x, exitFloor, exit.z, x, floor, z)) return null;
    // Clear at the exit's own floor, not only at the surface found here: the
    // top of a chair or a table is a surface too, and standing up from one
    // seat onto the next one's cushion is not being put down on the floor.
    probe.set(x, Math.min(floor, exitFloor), z);
    if (solids.deepestSolidOverlap(probe, mover.radius, 0) > CLEAR_TOLERANCE) return null;
    if (!openFloorFrom(collision, sample, x, floor, z, mover, solids)) return null;
    return { x, z, y: floor + lift, floor, moved: Math.hypot(x - exit.x, z - exit.z), found: true };
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
  // and there is nowhere else to put her. `check:exits` fails on any exit the
  // game has that lands here.
  console.warn(
    `dismount: no clear, open spot within ${SEARCH_REACH} m of the exit at ` +
      `(${exit.x.toFixed(2)}, ${exit.y.toFixed(2)}, ${exit.z.toFixed(2)})`,
  );
  return { x: exit.x, z: exit.z, y: exit.y, floor: exitFloor, moved: 0, found: false };
}

/**
 * **Can she walk from `(x, floor, z)` to somewhere {@link OPEN_FLOOR_REACH}
 * away — as the router a child taps with would walk her?** Clause 4 of the
 * rule, and the question a pocket fails.
 *
 * A breadth-first flood over **the router's own cells**: `navLattice.ts`'s
 * frame for the space's current play bounds, so these are exactly the cell
 * centres `NavGrid` classifies there. That matters more than it looks: a
 * lattice centred on the spot itself sees squeezes the router's does not, and
 * the first version of this rule, so centred, put a child up from the lobby
 * café's middle chair onto an island south of the tables that a stick could
 * wriggle out of and a tap never could (probe 31's 1.5 m² island).
 *
 * A cell is walkable when a body of the mover's radius at its centre is clear
 * of the play boundary and of every collider the router stamps — `Collision.ts`'s
 * `routeStamp`, the one rule `NavGrid` stamps its own lattice by: height-blind,
 * so the top of a table is no more a road out than its legs are, and the walls
 * she hops left open. Neighbours join when the step between them is within her reach (the
 * walk's own `withinStep`, up or down, as `NavGrid` holds a route to it), and a
 * diagonal only when both straight cells beside it are walkable too — the
 * router's no-corner-cutting rule. It starts in the cell she stands in, or, if
 * that cell's centre is in something, the nearest free one beside it, as the
 * router's own `findRoute` does. Open the moment any reached cell is far enough
 * away; a pocket is exhausted long before that.
 *
 * `solids` is the caller's local view of the colliders near here
 * ({@link putDownSpot} builds it once for a whole search).
 */
export function openFloorFrom(
  collision: CollisionWorld,
  sample: GroundSampler,
  x: number,
  floor: number,
  z: number,
  mover: PutDownMover,
  solids: CollisionWorld = collision.near(x, z, gatherReach(mover)),
): boolean {
  const frame = navLatticeFrame(collision.playBounds.extent);
  const homeI = Math.round((x - frame.originX) / NAV_CELL);
  const homeJ = Math.round((z - frame.originZ) / NAV_CELL);
  const half = Math.ceil(OPEN_FLOOR_REACH / NAV_CELL) + 2;
  const side = half * 2 + 1;
  const cells = side * side;
  /** 0 not yet asked, 1 walkable at `level`, 2 blocked by a solid or the boundary. */
  const state = new Uint8Array(cells);
  const level = new Float64Array(cells);
  const reached = new Uint8Array(cells);
  const queue = new Int32Array(cells);
  const reachSquared = OPEN_FLOOR_REACH * OPEN_FLOOR_REACH;
  const cellX = (index: number): number => frame.originX + (homeI - half + (index % side)) * NAV_CELL;
  const cellZ = (index: number): number => frame.originZ + (homeJ - half + Math.floor(index / side)) * NAV_CELL;

  /** Classify a cell the first time it is approached, from a foot at `(fromX, fromY, fromZ)`. */
  const classify = (index: number, fromX: number, fromY: number, fromZ: number): void => {
    const toX = cellX(index);
    const toZ = cellZ(index);
    const clear = collision.clearOfBoundary(toX, toZ, mover.radius) && !solids.routeBlocked(toX, toZ, mover.radius, mover.hopApex);
    state[index] = clear ? 1 : 2;
    level[index] = clear ? sample(toX, toZ, carryReference(fromX, fromZ, fromY, toX, toZ)) : Number.NaN;
  };
  /** Can a foot at cell `from` step to cell `to`? */
  const steps = (from: number, to: number): boolean => {
    if (state[to] === 0) classify(to, cellX(from), level[from]!, cellZ(from));
    if (state[to] === 2) return false;
    return withinStep(cellX(from), level[from]!, cellZ(from), cellX(to), level[to]!, cellZ(to));
  };

  // Where the router would start her: her own cell, or the nearest free one
  // beside it when her own cell's centre is in something.
  const home = half * side + half;
  classify(home, x, floor, z);
  let start = -1;
  if (state[home] === 1 && withinStep(x, floor, z, cellX(home), level[home]!, cellZ(home))) {
    start = home;
  } else {
    let best = Infinity;
    for (let k = 0; k < 8; k += 1) {
      const next = (half + NEIGHBOUR_J[k]!) * side + half + NEIGHBOUR_I[k]!;
      if (state[next] === 0) classify(next, x, floor, z);
      if (state[next] !== 1 || !withinStep(x, floor, z, cellX(next), level[next]!, cellZ(next))) continue;
      const distance = Math.hypot(cellX(next) - x, cellZ(next) - z);
      if (distance < best) {
        best = distance;
        start = next;
      }
    }
  }
  if (start < 0) return false;

  reached[start] = 1;
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  while (head < tail) {
    const at = queue[head++]!;
    const i = at % side;
    const j = (at - i) / side;
    for (let k = 0; k < 8; k += 1) {
      const ni = i + NEIGHBOUR_I[k]!;
      const nj = j + NEIGHBOUR_J[k]!;
      if (ni < 0 || nj < 0 || ni >= side || nj >= side) continue;
      const next = nj * side + ni;
      if (reached[next] === 1) continue;
      // No cutting corners — `NavGrid`'s rule, for the reason it gives there.
      if (k >= 4 && (!steps(at, j * side + ni) || !steps(at, nj * side + i))) continue;
      if (!steps(at, next)) continue;
      reached[next] = 1;
      const dx = cellX(next) - x;
      const dz = cellZ(next) - z;
      if (dx * dx + dz * dz >= reachSquared) return true;
      queue[tail++] = next;
    }
  }
  return false;
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
 * The same question for a *group*: several bodies stepping off together, none
 * of them standing inside the geometry and none of them standing inside each
 * other.
 *
 * {@link resolveDismount} is stateless and single-point — ask it three times
 * and it hands back the same answer three times, which is precisely wrong for
 * a crowd. This wraps it with the one extra rule a crowd needs: a candidate is
 * only accepted if it also clears everybody already placed, the caller's own
 * `occupied` list included. That list is how the player keeps her personal
 * space; she is put down first and passed in here, so nobody can ever appear
 * standing on top of her.
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

    // Same contract as `resolveDismount`: say so loudly, hand back the best
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
