import { Vector3 } from 'three';
import type { CollisionWorld } from './Collision';
import type { GroundSampler } from '../entities/Player';
import type { LevelConnector } from './building/surfaces';
import { BUILDING_STEP_UP } from '../core/constants';
import { NAV_CELL, NavGrid, type ReachSet } from './NavGrid';
import { withinStep } from './building/stepReach';
import { feetSampler } from './standing';

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
 * 2. **solid underfoot, on the floor it names** — the surface her feet find
 *    there is within a step of it, so she is never put over a void or onto a
 *    deck. A solid's top is such a surface, as it is under her feet: a crate
 *    she stood on when the game was saved is where she wakes;
 * 3. **clear** — a child's body there, at that floor's height, is inside no
 *    solid below its top by the resolver's own rule (`deepestSolidOverlap`,
 *    her whole height asked); the top she stands on is never in her way; and
 * 4. **connected to the space's open area** — the router's own flood, from
 *    there, reaches its arrival, its way out or a designed stand spot, or floor
 *    too far off to be a pocket ({@link OpenFloor}). This is the clause the café
 *    needed: the strip was clear floor, perfectly supported, and a dead end.
 *    On a solid's top she cannot walk off within a step, she gets down by
 *    walking off its edge, and the flood is asked from where she comes down.
 *
 * The spot asked for is tried first, and **handed back unchanged when it
 * passes** — every exit and arrival that was already sound puts her exactly
 * where it always did. Otherwise rings of {@link RING_STEP} around it, out to
 * {@link SEARCH_REACH}, nearest first, and the first spot that passes all four.
 *
 * ## Clause 4 is the router's answer
 *
 * "Can she walk out of here?" is asked of the router a child taps with — not a
 * model of it. {@link NavGrid.around} builds `NavGrid`'s own lattice over a
 * small window of the space round the exit: the very cells `Game`'s router lays
 * over it, stamped, banded, bridge-exempted, levelled and joined by stairs by
 * the same code from the same inputs ({@link PutDownSpace}), and `floodFrom`
 * floods it by the router's own steps, hops and corners — from a cell she can
 * actually get to, never the router's own start rule (see {@link OpenFloor}).
 * So a spot the router walks her out of is a spot this leaves exactly where it
 * is, which `check:exits` holds it to across every bridge, stair, deck and room
 * of the park.
 *
 * **What it costs.** A put-down averages about 6 ms, and the slowest take a
 * frame or two: `check:exits` measured 6.6 ms on average and 47 ms at the
 * slowest over the 571 put-downs it drives (17 Oct 2026, a loaded laptop). The
 * window is what keeps it there — the whole park's lattice costs 524 ms to
 * build, and one put-down builds at most {@link PUT_DOWN_WINDOW_CELLS} cells.
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
  /** Router cells this put-down built to ask clause 4 — its cost; 0 when no spot got that far. */
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
 * **The window of the router's lattice the exit itself is asked in**, in cells
 * either side of the exit's own: the flood's reach and one cell more. Enough to
 * answer the exit exactly — a flood that reaches its edge has reached floor
 * {@link OPEN_FLOOR_REACH} away — and the exit is all most put-downs ever ask.
 */
const EXIT_WINDOW_HALF = Math.ceil(OPEN_FLOOR_REACH / NAV_CELL) + 1;

/**
 * **The window the search's spots are asked in**, when the exit does not pass:
 * the search's reach plus the flood's, and one cell more, so that every spot it
 * tries has a full {@link OPEN_FLOOR_REACH} of the router's lattice round it.
 */
const SEARCH_WINDOW_HALF = Math.ceil((SEARCH_REACH + OPEN_FLOOR_REACH) / NAV_CELL) + 1;


/** Overlap that still counts as clear: float noise, an ordinary resolve's exact contact. */
const CLEAR_TOLERANCE = 1e-3;

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
 * **What the rule asks of the space she is put down in**, beyond its collision
 * world and its floor — one object, `World.putDownSpace`, handed to `Player`,
 * to the procgen facts and to the checks alike, so nothing asks the rule a
 * second way:
 *
 * - the space's **open area** round a point ({@link OpenAreaPoint});
 * - the router's two inputs beyond the collision world — the declared ways
 *   between levels, and every railway bridge's deck — the same two `Game`
 *   builds its router with (`World.routeConnectors`, `World.routeBridgeCovers`).
 */
export interface PutDownSpace {
  readonly openArea: (x: number, z: number) => readonly OpenAreaPoint[];
  readonly connectors: () => readonly LevelConnector[];
  readonly bridgeCovers: (x: number, z: number) => boolean;
}

/**
 * Nothing beyond the collision world — no open area, no stairs, no bridges:
 * `NavGrid`'s own defaults, for a world built without a park (the rule's own
 * clauses in `check:exits`).
 */
export const BARE_SPACE: PutDownSpace = {
  openArea: () => [],
  connectors: () => [],
  bridgeCovers: () => false,
};

/**
 * The body being put down: her radius and the apex of her hop — the numbers
 * the router is built for her with (`playerLattice.ts`), so the window of its
 * lattice is hers — how tall she is, and whether she stands on solids. Passed
 * in rather than imported: `Player` owns `PLAYER_PUT_DOWN`, and `Player`
 * imports this file.
 */
export interface PutDownMover {
  readonly radius: number;
  readonly hopApex: number;
  /**
   * Her height, metres: a solid is in her way from its base to its top, as
   * `resolve` asks it of her (`KID_HEIGHT`) — so a spot under a canopy's edge,
   * her head inside it, is not clear, and a top she stands on never is in her
   * way at all.
   */
  readonly height: number;
  /**
   * Whether she stands on solids (`NavGrid`'s `standsOnSolids`): her lattice
   * takes a solid within a step for floor, so its windows must too, or a bench
   * she stands on is a stamp the flood cannot start from.
   */
  readonly standsOnSolids: boolean;
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
  // a breakfast chair's seat (0.42 m) is not the floor a child getting up
  // from it is put down on. A hair above is float noise; more is a prop.
  return lift >= -SAME_FLOOR && lift <= reach ? { floor: under, lift: Math.max(0, lift) } : { floor: exit.y, lift: 0 };
}

/** How far the sampler's surface may stand above the floor an exit names and still be it, metres. */
const SAME_FLOOR = 0.05;

/**
 * **The one rule** — see this file's header. `collision` and `sample` are the
 * two authorities her own walking obeys — `sample` the walk surface, the
 * ground her lattice is built over — and `space` the rest of what the router
 * is built from, with the open area a flood may reach: `Player` passes its own.
 *
 * **A mover that stands on solids is stood by her feet's own rule**
 * (`world/standing.ts`'s `feetSampler` over `sample`): a solid's top within a
 * step is somewhere she stands, so it is somewhere she may be put down. The
 * rule composes it rather than being handed it, because her lattice needs the
 * walk surface itself: given her feet's sampler, `NavGrid` would find every
 * solid's own top "within a step of the ground under it" and walk onto them all.
 *
 * Bounded: one put-down builds at most three windows of the router's lattice,
 * {@link PUT_DOWN_WINDOW_CELLS} cells in all, each once — see {@link OpenFloor};
 * every flood after that is a flood of a window already built, and a spot in a
 * region already flooded is answered from it. `check:exits` prints the cost of
 * every put-down it drives.
 */
export function putDownSpot(
  collision: CollisionWorld,
  sample: GroundSampler,
  exit: RideExit,
  mover: PutDownMover,
  space: PutDownSpace = BARE_SPACE,
): PutDown {
  const feet = mover.standsOnSolids ? feetSampler(sample, collision) : sample;
  const { floor: exitFloor, lift } = floorOf(feet, exit);
  // Clauses 3 and 4 ask about solids round every spot the search tries, and
  // along the walk from each to where the router would start her: the ones
  // within her reach of the farthest of those. (A walk off a solid's top asks
  // further out, in a wider view of its own — `OpenFloor.getsDown`.)
  const solids = collision.near(exit.x, exit.z, SEARCH_REACH + START_REACH + mover.radius + NAV_CELL);
  const floor = new OpenFloor(collision, solids, sample, feet, exit, mover, space);
  const probe = new Vector3();

  const accept = (x: number, z: number): PutDown | null => {
    if (!collision.clearOfBoundary(x, z, mover.radius)) return null;
    const surface = feet(x, z, exit.y);
    if (!withinStep(exit.x, exitFloor, exit.z, x, surface, z)) return null;
    // Clear at the exit's own floor, not only at the surface found here: the
    // top of a chair or a table is a surface too, and standing up from one
    // seat onto the next one's cushion is not being put down on the floor.
    probe.set(x, Math.min(surface, exitFloor), z);
    if (solids.deepestSolidOverlap(probe, mover.radius, 0, undefined, mover.height) > CLEAR_TOLERANCE) return null;
    if (!floor.isOpen(x, surface, z)) return null;
    return { x, z, y: surface + lift, floor: surface, moved: Math.hypot(x - exit.x, z - exit.z), found: true, cells: floor.cells };
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
  return { x: exit.x, z: exit.z, y: exit.y, floor: exitFloor, moved: 0, found: false, cells: floor.cells };
}

/**
 * **How far from a spot the cell the flood starts in may be**, metres: three
 * of the router's cells. The router itself, planning a tap, starts from the
 * first free cell within four metres of a walker squeezed against something —
 * right for a tap, where the resolver pushes her out of whatever she is
 * squeezed against, and wrong for "can she walk out of here?": a sealed nook
 * with no free cell inside it would be flooded from outside it and called
 * open. So clause 4 starts only from a cell she can actually get to (see
 * {@link OpenFloor}), and only this near.
 */
const START_REACH = 3 * NAV_CELL;

/** How finely the walk from a spot to its start cell is swept for solids, metres. */
const SWEEP_STEP = 0.1;

/**
 * **How far across a solid's top she may walk to find its edge**, metres — see
 * {@link OpenFloor} on getting down. A garden wall's coping, a crate, the
 * fountain's rim and a table are a step or two across. From a top wider than
 * this every way she is moved to its edge by the search, like any spot shut in.
 */
const WALK_OFF_REACH = START_REACH;

/**
 * **How far past a top's edge she may come down**, metres: her own width and a
 * hand's breadth. Off the edge she drops, and the side of what she was on
 * pushes her clear of it as she passes its top — so she lands a body's width
 * beyond the edge, wherever there is room for her body there.
 */
const WALK_OFF_CLEAR = 1;

/** The bearings she tries walking off a top along. */
const WALK_OFF_BEARINGS = 16;

/**
 * **The window a walk off a top is asked in**: every spot the search tries,
 * walked off and come down, with a full {@link OPEN_FLOOR_REACH} of the
 * router's lattice round where she lands. Built only for a spot on a solid's
 * top that she cannot walk out of on foot.
 */
const DROP_WINDOW_HALF = Math.ceil((SEARCH_REACH + WALK_OFF_REACH + WALK_OFF_CLEAR + OPEN_FLOOR_REACH) / NAV_CELL) + 1;

/** The most cells one put-down ever builds: all three windows. */
export const PUT_DOWN_WINDOW_CELLS =
  (2 * EXIT_WINDOW_HALF + 1) ** 2 + (2 * SEARCH_WINDOW_HALF + 1) ** 2 + (2 * DROP_WINDOW_HALF + 1) ** 2;

/**
 * **Clause 4: can she walk out of here?** — asked of the router itself.
 *
 * A window of `NavGrid`'s own lattice round the exit ({@link NavGrid.around}),
 * built from the same inputs her router is ({@link PutDownSpace}, and her
 * {@link PutDownMover}: her lattice stands on solids), and flooded by the
 * router's own `floodFrom` — its steps, hops, corners and stairs. A spot is
 * open when that flood reaches a cell beside a point of the space's open area,
 * or one {@link OPEN_FLOOR_REACH} from the spot: no pocket is that big.
 *
 * **The flood starts only where she can get to**: the nearest cell of the
 * router's lattice within {@link START_REACH} that it could stand her in
 * (`NavGrid.nearestStandable`), whose floor is within a step of hers, and to
 * whose centre a body of her radius walks from the spot touching nothing
 * solid. Her own cell, when it is free, is that cell. A spot with no such cell
 * — inside four walls with no free cell between them, say — is not open.
 *
 * **On a solid's top, she gets down the way anyone does: she walks off its
 * edge.** Her lattice walks onto a solid within a step of the floor round it
 * and no higher, so a garden wall's coping, a crate or the fountain's rim is
 * no level of it: there is no cell within a step to start from, and the flood
 * alone would call her shut in on anything she had jumped onto. So a spot on a
 * top that she cannot walk out of on foot is walked off, along
 * {@link WALK_OFF_BEARINGS} bearings at the height she stands at — each until
 * a side in her way at that height shuts it, or the floor drops away under her
 * by more than a step — and comes down past the edge where her body fits
 * ({@link WALK_OFF_CLEAR}). It is open if the flood from where she lands is.
 * Coming down is gravity, never refused; a top whose every way off is walled
 * in above her, or lands her in a pocket, is shut as any pocket is.
 *
 * Windows are built lazily, each at most once per put-down: the exit is asked
 * in one just big enough to answer it ({@link EXIT_WINDOW_HALF}), and only when
 * the search goes looking are its spots asked in one big enough for every spot
 * it tries ({@link SEARCH_WINDOW_HALF}) — and a walk off a top in one big
 * enough for every landing ({@link DROP_WINDOW_HALF}). All answer exactly: a
 * flood that reaches a window's edge has reached floor {@link OPEN_FLOOR_REACH}
 * away. Every flood is kept, and a later spot in a region already flooded is
 * answered from that region rather than flooded again.
 */
class OpenFloor {
  /** Cells of the router's lattice this put-down built — its cost. */
  cells = 0;

  private readonly collision: CollisionWorld;
  private readonly solids: CollisionWorld;
  /**
   * The solids a walk off a top and its landing ask about — the walk's own
   * reach and its landing's past {@link solids}'. Built on first asking: only a
   * spot on a top she cannot walk out of on foot needs it.
   */
  private wideSolids: CollisionWorld | null = null;
  /** The view {@link blocked} asks: {@link solids}, or the wide one while a walk off a top is asked. */
  private view: CollisionWorld;
  /** The walk surface her lattice is built over. */
  private readonly sample: GroundSampler;
  /** What her feet stand on: {@link sample}, or a solid's top within a step. */
  private readonly feet: GroundSampler;
  private readonly exit: RideExit;
  private readonly mover: PutDownMover;
  private readonly space: PutDownSpace;
  private readonly windows = new Map<number, { readonly router: NavGrid; readonly regions: Region[] }>();
  private anchors: readonly OpenAreaPoint[] | null = null;
  private readonly probe = new Vector3();

  constructor(
    collision: CollisionWorld,
    solids: CollisionWorld,
    sample: GroundSampler,
    feet: GroundSampler,
    exit: RideExit,
    mover: PutDownMover,
    space: PutDownSpace,
  ) {
    this.collision = collision;
    this.solids = solids;
    this.view = solids;
    this.sample = sample;
    this.feet = feet;
    this.exit = exit;
    this.mover = mover;
    this.space = space;
  }

  /** Is the floor at `(x, floor, z)` one she gets out of? See the class. */
  isOpen(x: number, floor: number, z: number): boolean {
    // In another space altogether, as far as the play bounds go: the router has
    // no lattice there and nothing to say, as the soft boundary has no push.
    if (this.collision.inAnotherSpace(x, z)) return true;
    const atExit = x === this.exit.x && z === this.exit.z;
    if (this.walksOut(atExit ? EXIT_WINDOW_HALF : SEARCH_WINDOW_HALF, x, floor, z)) return true;
    return this.onSolidTop(x, floor, z) && this.getsDown(x, floor, z);
  }

  /** The router's own answer from `(x, floor, z)`, in the window of `half` cells. See the class. */
  private walksOut(half: number, x: number, floor: number, z: number): boolean {
    const window = this.window(half);
    const reachable = (cx: number, cz: number, cy: number): boolean => this.walksTo(x, floor, z, cx, cy, cz);
    const start = window.router.nearestStandable(x, z, floor, this.sample, START_REACH, reachable);
    // No cell she can get to: shut in, however open the floor beyond the walls.
    if (!start || !reachable(start.x, start.z, start.y)) return false;
    for (const region of window.regions) {
      if (region.reach.has(start.x, start.z, start.y)) return region.openFrom(x, z);
    }
    const reach = window.router.floodFrom(start.x, start.z, start.y, this.sample);
    if (!reach) return false;
    const region = new Region(reach, this.openArea());
    window.regions.push(region);
    return region.openFrom(x, z);
  }

  /** Is `floor` the top of a solid at `(x, z)` — somewhere she can only be by standing on it? */
  private onSolidTop(x: number, floor: number, z: number): boolean {
    return Math.abs(this.solids.highestTopAt(x, z, floor + SAME_FLOOR) - floor) <= SAME_FLOOR;
  }

  /** Off a solid's top along any bearing, to a landing the router walks her out of? See the class. */
  private getsDown(x: number, floor: number, z: number): boolean {
    const { exit, mover } = this;
    this.wideSolids ??= this.collision.near(
      exit.x,
      exit.z,
      SEARCH_REACH + WALK_OFF_REACH + WALK_OFF_CLEAR + START_REACH + mover.radius + NAV_CELL,
    );
    this.view = this.wideSolids;
    try {
      for (let i = 0; i < WALK_OFF_BEARINGS; i += 1) {
        const angle = (i / WALK_OFF_BEARINGS) * Math.PI * 2;
        const landing = this.walkOff(x, floor, z, Math.cos(angle), Math.sin(angle));
        if (landing && this.walksOut(DROP_WINDOW_HALF, landing.x, landing.y, landing.z)) return true;
      }
      return false;
    } finally {
      this.view = this.solids;
    }
  }

  /**
   * Walks off the top at `(x, floor, z)` along `(dx, dz)` and says where she
   * comes down — or `null` if a side in her way at the height she walks at
   * shuts this bearing, the top runs on past {@link WALK_OFF_REACH}, or there is
   * no room for her body within {@link WALK_OFF_CLEAR} past its edge inside the
   * play bounds.
   */
  private walkOff(x: number, floor: number, z: number, dx: number, dz: number): { x: number; y: number; z: number } | null {
    let edge = -1;
    for (let d = SWEEP_STEP; d <= WALK_OFF_REACH + WALK_OFF_CLEAR + 1e-9; d += SWEEP_STEP) {
      const px = x + dx * d;
      const pz = z + dz * d;
      if (this.blocked(px, floor, pz)) return null;
      const below = this.feet(px, pz, floor);
      if (edge < 0) {
        // Still on her top, or within a step of it: that is walking, the flood's.
        if (below >= floor - BUILDING_STEP_UP) {
          if (d >= WALK_OFF_REACH) return null;
          continue;
        }
        edge = d;
      }
      if (!this.collision.clearOfBoundary(px, pz, this.mover.radius)) return null;
      if (!this.blocked(px, below, pz)) return { x: px, y: below, z: pz };
      if (d - edge >= WALK_OFF_CLEAR) return null;
    }
    return null;
  }

  /**
   * Can she get from `(x, floor, z)` to the cell centre `(cx, cy, cz)` on her
   * own feet? Its floor within a step of hers, either way, and her body swept
   * along the straight line between them, at her own floor's height,
   * overlapping nothing solid by the resolver's own rule.
   */
  private walksTo(x: number, floor: number, z: number, cx: number, cy: number, cz: number): boolean {
    if (!withinStep(x, floor, z, cx, cy, cz)) return false;
    const length = Math.hypot(cx - x, cz - z);
    const steps = Math.max(1, Math.ceil(length / SWEEP_STEP));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      if (this.blocked(x + (cx - x) * t, floor, z + (cz - z) * t)) return false;
    }
    return true;
  }

  /**
   * Is her body at `(x, z)`, feet at `feet`, inside something solid — a body
   * below its top and above its base, by the resolver's own rule
   * (`deepestSolidOverlap`, her whole height asked)?
   */
  private blocked(x: number, feet: number, z: number): boolean {
    this.probe.set(x, feet, z);
    return this.view.deepestSolidOverlap(this.probe, this.mover.radius, 0, undefined, this.mover.height) > CLEAR_TOLERANCE;
  }

  /** The window of `half` cells round the exit, built on first asking. */
  private window(half: number): { readonly router: NavGrid; readonly regions: Region[] } {
    let window = this.windows.get(half);
    if (!window) {
      const { exit, mover, space } = this;
      const router = NavGrid.around(
        this.collision,
        mover.radius,
        mover.hopApex,
        space.connectors,
        space.bridgeCovers,
        exit.x,
        exit.z,
        half,
        mover.standsOnSolids,
      );
      window = { router, regions: [] };
      this.windows.set(half, window);
      this.cells += (2 * half + 1) ** 2;
    }
    return window;
  }

  private openArea(): readonly OpenAreaPoint[] {
    this.anchors ??= this.space.openArea(this.exit.x, this.exit.z);
    return this.anchors;
  }
}

/** One flood of the window: every cell it reached, and whether one is beside the open area. */
class Region {
  readonly reach: ReachSet;
  private readonly cellX: number[] = [];
  private readonly cellZ: number[] = [];
  private readonly holdsOpenArea: boolean;

  constructor(reach: ReachSet, anchors: readonly OpenAreaPoint[]) {
    this.reach = reach;
    let holds = false;
    reach.forEachCell((x, z) => {
      this.cellX.push(x);
      this.cellZ.push(z);
      // Its own cell and the eight beside it: a stand spot drawn against a
      // counter may have its own cell's centre inside the counter's stamp.
      if (!holds && anchors.some((point) => Math.abs(point.x - x) <= ANCHOR_REACH && Math.abs(point.z - z) <= ANCHOR_REACH)) {
        holds = true;
      }
    });
    this.holdsOpenArea = holds;
  }

  /** Open as seen from `(x, z)`: it holds the open area, or floor {@link OPEN_FLOOR_REACH} away. */
  openFrom(x: number, z: number): boolean {
    if (this.holdsOpenArea) return true;
    const far = OPEN_FLOOR_REACH * OPEN_FLOOR_REACH;
    for (let i = 0; i < this.cellX.length; i += 1) {
      const dx = this.cellX[i]! - x;
      const dz = this.cellZ[i]! - z;
      if (dx * dx + dz * dz >= far) return true;
    }
    return false;
  }
}

/** How near an open-area point a reached cell's centre must be to count: within the cell beside it. */
const ANCHOR_REACH = NAV_CELL * 1.5;

