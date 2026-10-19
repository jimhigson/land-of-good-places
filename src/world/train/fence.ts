import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import type { TrainRoute } from './route';
import { TRACK_CLEARANCE } from './route';
import type { Bridge } from './bridges';
import { FENCE_HALF_THICKNESS, FENCE_OFFSET, FENCE_SEAM_MARGIN, STATION_GAP } from './clearance';
import { PLAYER_RADIUS } from '../../core/constants';
import type { MovingPlatform } from '../building/surfaces';
import { JUMP_PLAN_REACH, guardRadiusNeeded, type Takeoff } from '../jumpReach';
import type { CollisionWorld, WallCollider } from '../Collision';
import { reachableTops, type ReachableTop } from '../reachableTops';
import { GUARD_OVER_FEET, riseOverTakeoff } from '../jumpReach';
import { PALETTE } from '../../core/palette';
import { toonMaterial } from '../../art/style/materials';
import { placeOnSphere, planetRadiusAt, terrainHeight, yAtAltitude } from '../terrain';

/**
 * The exclusion fence — Decision 4 §6, "keeping feet off the track".
 *
 * Two picket runs offset either side of the solved loop: invisible walls for
 * the collision world (full height — the fence is a rule, not a hurdle), and
 * a visible pink post-and-rail fence so the rule reads as scenery rather
 * than as an invisible force. A gap along every platform, for boarding; no
 * gap anywhere else — not even at a crossing, since issue #116 (Decision 8)
 * a path crosses on a bridge, and the fence runs on underneath it. Where a
 * bridge's own deck stands directly over a run of posts, that run's wall
 * gets an absolute top pinned just under the deck instead of the usual
 * `Infinity`: solid at ground height (nobody reachable there clears it),
 * open at the deck's own height (see `bridges.ts`'s header for why that is
 * safe against the jump-the-fence hazard Decision 8 records). Continuous by
 * construction everywhere else — which is what closes `check:park`'s
 * rail.exclusion and rail.walkable ratchets.
 */

const STEP = 2.4;
/**
 * A fence post: its foot radius, its length, and where its middle stands above
 * the ground — so its top is `POST_TOP`. One owner for the mesh and the solid.
 */
const POST_RADIUS = 0.11;
/**
 * **Taller than she can jump** (the engine rework, 17 Oct 2026). Every solid
 * now has its real top and a jump lands on whatever it reaches, so a fence is
 * a guard only by its height: the knee-high fence that stood here (0.95 m
 * posts, one rail at 0.62 m) was a top she could hop onto and walk along,
 * straight across the track on a box's end cap. Her jump comes down on
 * nothing higher than 1.43 m over where she took off (`JUMP_APEX_HEIGHT` and
 * the clearance grace), so the rail now stands at 1.67 m with its posts over
 * it, and the old rail at knee height stays as the fence's lower bar.
 */
const POST_LENGTH = 1.75;
const POST_MIDDLE = 0.88;
const POST_TOP = POST_MIDDLE + POST_LENGTH / 2;
/**
 * A guard rail's own section — its drawn width and depth — for the fence's
 * rails and the bridges' railings alike (`bridges.ts`). Its width is what of
 * it she could put a foot on: not enough (`FOOT_HALF_WIDTH`).
 */
export const GUARD_RAIL_WIDTH = 0.09;
export const GUARD_RAIL_DEPTH = 0.1;
/** The rails: the lower bar's centre and the top rail's above the ground, so the top is `RAIL_TOP`. */
const RAIL_CENTRE = 0.62;
const TOP_RAIL_CENTRE = 1.62;
const RAIL_DEPTH = GUARD_RAIL_DEPTH;
const RAIL_TOP = TOP_RAIL_CENTRE + RAIL_DEPTH / 2;

/**
 * **The railway's guard height** — the fence's top rail's top over the ground,
 * and the top of the railing along each bridge's parapets over the road
 * (`bridges.ts`): wherever she could otherwise get onto the line, this is how
 * high what stops her stands. One owner.
 */
export const RAILWAY_GUARD_TOP = RAIL_TOP;
const RAIL_WIDTH = GUARD_RAIL_WIDTH;
/**
 * How far apart the rails of a fence stood taller than designed are, metres —
 * the designed fence's own gap between its lower bar and its top rail — and
 * how far under the top rail the highest of them stops.
 */
const MID_RAIL_GAP = TOP_RAIL_CENTRE - RAIL_CENTRE;
const MID_RAIL_CLEAR = 0.25;
/** How many pieces a bay or a cap is cut into for the tops' need along it (`topsLiftAlong`). */
const BAY_SAMPLES = 16;
/** The most rails between a bay's top rail and its lower bar's: a fence stood over four metres taller. */
const MAX_MID_RAILS = 5;
/** A post's drawn top radius: what of it she could put a foot on — not enough (`FOOT_HALF_WIDTH`). */
const POST_TOP_RADIUS = 0.09;
// Re-exported so existing importers keep one obvious home for it; the value
// itself lives in the leaf module (see clearance.ts's own note).
export { STATION_GAP } from './clearance';

interface StationSpan {
  readonly distance: number;
  /** Its platform's deck, where a jump at the fence beside it can leave from higher than the ground. */
  readonly platform?: MovingPlatform;
  /** Its waiting train's carriage floors (`ParkTrain.dwellFloors`): stepped onto from the platform, and a jump's takeoff too. */
  readonly floors?: readonly MovingPlatform[];
}

/**
 * The railway's fence, built: its group, and the one thing left to do once
 * the park round the line is finished.
 */
export interface RailFence {
  readonly group: Group;
  /**
   * **Stands every post and bay as tall as every jump at it needs** — from the
   * walk beside it, and from every top she can stand on and reach near it
   * (`reachableTops`): a bush, a garden wall, a bench. Those are planted by
   * the world phase, after the railway is built, so this is asked once they
   * stand (`World`, through `ParkTrain.raiseGuards`). PR #722's review, round
   * two: from a bush 2 m off the fence she sprint-jumped over it into a fenced
   * box on the line, because the fence had been sized against the walk alone.
   */
  raise(): void;
}

/**
 * @param walkSurface The highest surface she can walk on at `(x, z)` — the
 *   ground, a path, a plinth: where a jump at the fence can leave from. The
 *   terrain when not given.
 */
export function buildRailFence(
  route: TrainRoute,
  collision: CollisionWorld,
  bridges: readonly Bridge[],
  stations: readonly StationSpan[],
  walkSurface: (x: number, z: number) => number = terrainHeight,
): RailFence {
  const group = new Group();
  group.name = 'rail-fence';

  /**
   * The deck height directly over `(x, z)`, or `null` off every bridge —
   * consulted by every wall segment this function adds, so a run of fence
   * that happens to fall under a deck gets the `topIsAbsolute` seam instead
   * of the ordinary always-solid wall. See the file header.
   *
   * `margin` pads `deckCovers`'s own exact edge outward — see that method's
   * own doc comment on why a caller whose wall has real thickness needs one:
   * an un-seamed wall run just past the deck's exact geometric edge can
   * still physically reach a probe standing on the deck, because its own
   * half-thickness extends the collision boundary past where its centreline
   * stops. Each call site below sizes its own margin off its own wall's
   * half-thickness.
   */
  const deckSpanAt = (x: number, z: number, margin: number): number | null => {
    // NOTE (2026-08-23 humpback rework): the height returned is the
    // bridge's own LOCAL surface at this point (`heightAt`), not one flat
    // `deckY` — the hump's surface at the fence line sits below the crown,
    // and a seam pinned at the crown minus the margin would stand ABOVE a
    // walker's feet there, blocking her on her own bridge.
    // The *lowest* deck over this point, not the first in list order and
    // — this is the one place in the whole feature that is deliberately
    // NOT `bridgeHeightAt`'s own "tallest, never first" rule, despite
    // looking like the same situation. `bridgeHeightAt` answers "how high
    // does a walker actually stand here", and the highest overlapping
    // surface is the right answer to that (the same "highest within a
    // step" rule `WalkSurfaces.sample` already uses). This answers a
    // different question — "at what height does the ground-level fence
    // stop blocking" — and a *single* `topIsAbsolute` wall has only one
    // threshold, so when two crossings close enough together genuinely
    // overlap the same fence run at two different deck heights, picking
    // the TALLER one strands a walker on the SHORTER deck below the seam:
    // still genuinely on a real deck, still genuinely blocked (issue #116,
    // canonical seed: a 4.62 m deck sat under a neighbour's 5.05 m seam,
    // and a probe standing on its own deck was pushed off). Picking the
    // lower one instead opens the fence the moment EITHER deck's own
    // walker reaches it, and never opens it for anyone actually still on
    // the ground — the lowest bridge rise in this whole park is still
    // several metres up, so there is no height between "on the ground"
    // and "on the lower of two decks" for this to open early for.
    let best: number | null = null;
    for (const bridge of bridges) {
      if (!bridge.deckCovers(x, z, margin)) continue;
      // The LOWEST surface within the wall's own collision reach of this
      // point, not just the surface directly above it. The hump slopes:
      // a walker is stopped by this wall while her body is still `margin`
      // (the wall's half-thickness plus her own radius) short of the wall
      // line, where the surface — and so her feet — are genuinely lower
      // than at the line itself. A seam pinned to the at-the-line height
      // stood 0.26 m proud of her feet at that approach and jammed her on
      // her own bridge (real-browser QA, canonical seed, bridge A's south
      // slope). Ground walkers are unaffected: every sampled surface is
      // still several metres up.
      for (const [ox, oz] of [
        [0, 0],
        [margin, 0],
        [-margin, 0],
        [0, margin],
        [0, -margin],
      ] as const) {
        // Only a probe the bridge actually covers may vote. An offset that
        // falls just OFF the deck's end reads the ground there, and the
        // minimum then set the seam's top at ground level beside the deck —
        // a half-metre of bare rail a child could stand on, `check:park`'s
        // `rail.walkable: 1` on seeds 4, 6 and 9 (one sample each, always the
        // sample just before a deck begins).
        if ((ox !== 0 || oz !== 0) && !bridge.covers(x + ox, z + oz)) continue;
        const height = bridge.heightAt(x + ox, z + oz);
        if (best === null || height < best) best = height;
      }
    }
    return best;
  };

  /**
   * The same question, asked of a whole SEGMENT rather than one point.
   *
   * A fence segment is `STEP` (2.4 m) long, and a deck's own edge does not
   * fall on a post — so the one segment straddling that edge has one end
   * genuinely under the deck and the other genuinely not. Testing only the
   * midpoint (the original approach) can miss both: a short, off-centre
   * deck can leave the midpoint just outside `deckCovers` while one whole
   * end sits under it, and that segment then goes up as an ordinary
   * always-solid wall — ordinary walls ignore a mover's real elevation
   * entirely, so it blocks a probe standing on the deck above it exactly
   * like any other relative-height collider would (see
   * `bridgeKeepout.ts`'s own note on the same failure mode). Found live,
   * issue #116 seed 11: the centre-line run one segment short of a tight
   * (halfGap-floor) crossing was still an `Inf`-height wall, and a probe
   * standing on the real deck above it was pushed sideways.
   *
   * Sampling both endpoints as well as the midpoint and taking whichever
   * gives the LOWEST deck (never "first covered", same "lowest, not
   * highest" convention as `deckSpanAt` above, for the same reason) means a
   * segment gets the seam the moment ANY part of it is under a deck —
   * erring toward one short (<= 2.4 m) stretch of fence reading as
   * open-above when a sliver of it is not, rather than leaving a hole in
   * "the deck is walkable" that a child actually finds — while still never
   * stranding a walker on whichever of two overlapping decks happens to be
   * shorter.
   */
  const deckSpanForSegment = (a: Post, b: Post, wallHalfThickness: number): number | null => {
    const margin = wallHalfThickness + PLAYER_RADIUS;
    let best: number | null = null;
    for (const [x, z] of [
      [a.x, a.z],
      [b.x, b.z],
      [(a.x + b.x) / 2, (a.z + b.z) / 2],
    ] as const) {
      const deckY = deckSpanAt(x, z, margin);
      if (deckY !== null && (best === null || deckY < best)) best = deckY;
    }
    return best;
  };

  // --- 1. the open intervals: platforms only --------------------------------
  // Everything else is a CLOSED stretch, and each closed stretch is fenced as
  // a sealed box: both sides, plus an end cap at each end. Airtight by
  // construction — overlapping gaps and station spacing can change where the
  // boxes are, never whether they seal. (The first version fenced the loop
  // with gaps and added compartment walls separately; overlapping gaps let a
  // child slalom around a compartment wall whose side fence was absent —
  // measured as 229 of 392 track points strollable.) A crossing no longer
  // opens one of these — issue #116/Decision 8, the fence runs on underneath
  // every bridge instead.
  interface Interval {
    from: number;
    to: number;
  }
  const length = route.length;
  const open: Interval[] = [];
  for (const station of stations) {
    open.push({ from: station.distance - STATION_GAP, to: station.distance + STATION_GAP });
  }
  // The fence opens ONLY at stations. A crossing never opens it: every
  // crossing carries a bridge over the fence line (Jim, 2 Sep 2026 — the
  // ground-level fallback gap died with the level tier).
  // Unwrap the circle at a seam that lies in CLOSED track, so no open
  // interval straddles it. (Seaming at the middle of the first gap fenced
  // half of that very gap — the wrap-adjusted span ran past the loop's end
  // and the complement swallowed the other half.)
  const contains = (interval: Interval, d: number): boolean => {
    const span = ((interval.to - interval.from) % length + length) % length;
    const into = ((d - interval.from) % length + length) % length;
    return into <= span;
  };
  let seam = open.length ? ((open[0] as Interval).to % length + length) % length + 0.01 : 0;
  for (let guard = 0; guard < open.length + 1; guard += 1) {
    const inside = open.find((interval) => contains(interval, seam));
    if (!inside) break;
    seam = ((inside.to % length + length) % length) + 0.01;
  }
  const unwrap = (d: number): number => {
    let value = (d - seam) % length;
    if (value < 0) value += length;
    return value;
  };
  const spans = open
    .map((interval) => {
      const from = unwrap(interval.from);
      let to = unwrap(interval.to);
      if (to < from) to += length; // cannot straddle the seam; guard anyway
      return { from, to };
    })
    .sort((a, b) => a.from - b.from);
  const merged: Interval[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to + 0.5) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  const closed: Interval[] = [];
  let cursor = 0;
  for (const span of merged) {
    if (span.from > cursor + 1) closed.push({ from: cursor, to: span.from });
    cursor = Math.max(cursor, span.to);
  }
  if (cursor < length - 1) closed.push({ from: cursor, to: length });
  if ((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.['LGP_DEBUG_FENCE']) {
    const say = (s: string) =>
      (globalThis as unknown as { process: { stdout: { write: (s: string) => void } } }).process.stdout.write(s + '\n');
    say('fence seam ' + seam.toFixed(1));
    say('fence open ' + open.map((i) => `[${i.from.toFixed(1)},${i.to.toFixed(1)}]`).join(' '));
    say('fence merged(unwrapped) ' + merged.map((i) => `[${i.from.toFixed(1)},${i.to.toFixed(1)}]`).join(' '));
    say('fence closed(unwrapped) ' + closed.map((i) => `[${i.from.toFixed(1)},${i.to.toFixed(1)}]`).join(' '));
  }

  // --- 2. build each sealed box -------------------------------------------
  const point = new Vector3();
  const tangent = new Vector3();
  interface Post {
    x: number;
    z: number;
    y: number;
    /**
     * How much taller than designed this post and the top rail at it stand
     * (`liftAt`): 0, except where a jump from higher ground beside the fence
     * — a platform's end, a bank falling towards it, a bush or a wall she
     * stands on — carries her feet over the 1.67 m rail. Set by `raise`.
     */
    lift: number;
  }
  /**
   * A bay's rails, from the foot they start over to the one they end over —
   * a post's, or a stub's end, which keeps its post's foot height — drawn
   * twice, lower bar and top rail.
   */
  interface Rail {
    from: Post;
    to: Post;
  }
  const posts: Post[] = [];
  const rails: Rail[] = [];

  // --- 1b. how tall each stretch must stand -----------------------------------
  // **Taller than every jump she can make at it** (`jumpReach.ts`; QA on PR
  // #722). On level ground her feet top out at 1.28 m over it, and a guard has
  // to stand `GUARD_OVER_FEET` (0.2 m) over that — the rail is 1.67 m; but
  // from a platform's end beside a box, or a bank falling towards the fence,
  // she leaves from higher than the fence's foot, and a sprint off the north
  // station's end on seed 5 cleared the end cap into the box. So each post
  // stands as tall as the highest her feet can get over its line from the
  // ground she can reach beside it, where that is over the rail. That ground
  // is everything she walks on — a building's plinth by the line as much as a
  // platform (seed 6: a sprint off the library's plinth cleared the fence
  // beside it) — and a waiting train's floors (seed 8); **and every top she
  // can stand on and reach near it** (`reachableTops`): from a bush 2 m off
  // the fence, a sprint-jump carried her feet 0.73 m over it and into a box
  // (the review, round two). Those are planted after the railway is built,
  // so the heights are found by `raise`, once they stand.
  const platforms = stations.flatMap((station) => [...(station.platform ? [station.platform] : []), ...(station.floors ?? [])]);
  const walkY = (x: number, z: number): number => {
    let y = walkSurface(x, z);
    for (const platform of platforms) if (platform.surfaceY > y && platform.covers(x, z)) y = platform.surfaceY;
    return y;
  };
  const walkRadius = (x: number, z: number): number => planetRadiusAt(x, walkY(x, z), z);
  const LIFT_GRID = 0.25;
  /**
   * Every grid point within a jump of the fence, once: where it is, its walk
   * surface's radius, and that ground's fall along each axis (both one-sided
   * differences, and only where they agree — a platform's edge is a step,
   * not a slope she runs down). Off every bridge: a deck's parapet is that
   * jump's own guard.
   */
  const cells = new Map<number, Takeoff | null>();
  const radiusAt = new Map<number, number>();
  const keyOf = (i: number, j: number): number => (i + 32768) * 65536 + (j + 32768);
  const radiusOf = (i: number, j: number): number => {
    const key = keyOf(i, j);
    let r = radiusAt.get(key);
    if (r === undefined) {
      r = walkRadius(i * LIFT_GRID, j * LIFT_GRID);
      radiusAt.set(key, r);
    }
    return r;
  };
  const cellOf = (i: number, j: number): Takeoff | null => {
    const key = keyOf(i, j);
    const known = cells.get(key);
    if (known !== undefined) return known;
    const x = i * LIFT_GRID;
    const z = j * LIFT_GRID;
    let cell: Takeoff | null = null;
    // Inside a box is the line itself — the corridor's closures, built first
    // (2b) — and a bridge's deck is its parapet's to guard.
    if (!collision.closedAt(x, z) && !bridges.some((bridge) => bridge.footprintNear(x, z, 0.1))) {
      const here = radiusOf(i, j);
      const slope = (ahead: number, behind: number): number => {
        const a = (ahead - here) / LIFT_GRID;
        const b = (here - behind) / LIFT_GRID;
        return Math.sign(a) === Math.sign(b) && Math.abs(a - b) <= 0.25 ? (a + b) / 2 : 0;
      };
      cell = { x, z, radius: here, slopeX: slope(radiusOf(i + 1, j), radiusOf(i - 1, j)), slopeZ: slope(radiusOf(i, j + 1), radiusOf(i, j - 1)) };
    }
    cells.set(key, cell);
    return cell;
  };
  /**
   * How far over the designed rail a fence point at unwrapped route distance
   * `distance` must stand: the highest her feet get over it from every point
   * near it she can stand on, either side — never inside a box, which is the
   * line itself — less the rail's own height (`guardRadiusNeeded`). Either
   * side: a station's far fence is approached across its own track from the
   * platform, and the strip beyond it is ground she could not get back from.
   */
  // The tops she can reach near the line, bucketed: set by `raise`.
  const TOP_BUCKET = 8;
  let topBuckets = new Map<number, ReachableTop[]>();
  const liftAt = (x: number, z: number): number => {
    const ground = planetRadiusAt(x, terrainHeight(x, z), z);
    const reach = JUMP_PLAN_REACH;
    const takeoffs: Takeoff[] = [];
    for (let i = Math.floor((x - reach) / LIFT_GRID); i <= Math.ceil((x + reach) / LIFT_GRID); i += 1) {
      for (let j = Math.floor((z - reach) / LIFT_GRID); j <= Math.ceil((z + reach) / LIFT_GRID); j += 1) {
        if (Math.hypot(i * LIFT_GRID - x, j * LIFT_GRID - z) > reach) continue;
        const cell = cellOf(i, j);
        if (cell) takeoffs.push(cell);
      }
    }
    const need = Math.max(guardRadiusNeeded(takeoffs, x, z), topsNeedAt(x, z));
    return Math.max(0, need - ground - RAIL_TOP);
  };
  /**
   * The radius a guard at `(x, z)` must stand to for every top she can reach
   * within a jump of it — the highest her feet get over this point from the
   * nearest of each, a top being level — or `-Infinity`.
   */
  const topsNeedAt = (x: number, z: number): number => {
    let need = -Infinity;
    const span = JUMP_PLAN_REACH + 4;
    for (let i = Math.floor((x - span) / TOP_BUCKET); i <= Math.floor((x + span) / TOP_BUCKET); i += 1) {
      for (let j = Math.floor((z - span) / TOP_BUCKET); j <= Math.floor((z + span) / TOP_BUCKET); j += 1) {
        for (const top of topBuckets.get(keyOf(i, j)) ?? []) {
          const apart = Math.max(0, -top.solid.depthAt(x, z));
          if (apart > JUMP_PLAN_REACH) continue;
          need = Math.max(need, top.radius + riseOverTakeoff(top.solid.centreX, top.solid.centreZ, x, z, apart) + GUARD_OVER_FEET);
        }
      }
    }
    return need;
  };

  /** A point `side` fence offsets across the line at unwrapped `distance`, as drawn: no lift. */
  const railAt = (distance: number, side: number): Post => {
    route.pointAt(distance + seam, point);
    route.tangentAt(distance + seam, tangent);
    const x = point.x + tangent.z * side * FENCE_OFFSET;
    const z = point.z - tangent.x * side * FENCE_OFFSET;
    return { x, z, y: terrainHeight(x, z), lift: 0 };
  };
  /** Every run of posts, in order along it — each side of each box, each station's far fence — for `raise`. */
  const runs: Post[][] = [];
  /** Each box end's two cap posts, for `raise`. */
  const caps: [Post, Post][] = [];
  /** Each post's solid, and each bay's and cap's, so `raise` can stand them to the heights it finds. */
  const postSolids = new Map<Post, number>();
  const baySolids: { readonly a: Post; readonly b: Post; readonly wall: WallCollider }[] = [];
  /** Each end cap's stubs' open ends, and the post each stands as tall as. */
  const stubEnds: { readonly end: Post; readonly of: Post }[] = [];
  /**
   * Every wall segment this file adds goes through here.
   *
   * **Its top is the rail she can see** (the engine rework): a bay of fence is
   * a solid up to its rail's top, `RAIL_TOP` above the ground at the bay's
   * middle, along the local up the rail is leant along — not an infinitely
   * tall rule. A post stands at each end of the bay, taller (`POST_TOP`), and
   * is its own solid. What keeps a child off the track is how tall that is;
   * see the census in `check:solids`.
   *
   * Under a bridge deck the bay used to need a "seam" — an absolute top just
   * under the deck, so the deck's walkers were not stopped by a wall meant for
   * the ground (`deckSpanAt` above). A real top is that already: the deck is
   * metres above a fence rail, so nothing on it meets one.
   */
  /** The top rail's top over a post, as a world `y`: where its bay's solid stands to there. */
  const railTopAt = (p: Post): number => yAtAltitude(p.x, p.z, p.y + RAIL_TOP + p.lift - terrainHeight(p.x, p.z));
  /** A post's own top, as a world `y`. */
  const postTopAt = (p: Post): number => yAtAltitude(p.x, p.z, POST_TOP + p.lift);
  const addFenceWall = (a: Post, b: Post): void => {
    // The rail runs from one post's top to the other's, so its solid's top
    // does too: one end each (`TopSlope`), where the posts' own feet differ.
    // Fattened to be met square; stood on only where drawn — a 9 cm rail is
    // an edge, not a ledge, so she jumps over a fence and never perches on it.
    const wall = collision.kinded('railway fence', () =>
      collision.toppedNarrow(RAIL_WIDTH / 2, () =>
        collision.addWall(a.x, a.z, b.x, b.z, FENCE_HALF_THICKNESS, railTopAt(a), false, true, -Infinity, false, Number.NaN, railTopAt(b)),
      ),
    );
    baySolids.push({ a, b, wall });
  };
  /** A post at `p`, its own solid: the rail's ends stand on it. */
  const addFencePost = (p: Post): void => {
    const id = collision.kinded('railway fence post', () =>
      collision.toppedNarrow(POST_TOP_RADIUS, () => collision.addCircle(p.x, p.z, POST_RADIUS, postTopAt(p), false, true)),
    );
    postSolids.set(p, id);
  };
  const link = (a: Post, b: Post) => {
    addFenceWall(a, b);
    rails.push({ from: a, to: b });
  };
  /**
   * A box end cap crosses the track, and the train drives through it four
   * times a lap — so the *collision* wall keeps its full span (the seal is a
   * rule, and rules are airtight), but the *visible* rail is two short stubs
   * flanking the rails with the middle left open. What a child sees is the
   * fence turning in to meet the crossing; what the train sees is nothing.
   */
  const cap = (a: Post, b: Post) => {
    addFenceWall(a, b);
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    const stub = Math.max(0, span / 2 - 1.1) / span; // fraction of the way in
    for (const [from, to] of [
      [a, { x: a.x + (b.x - a.x) * stub, z: a.z + (b.z - a.z) * stub, y: a.y, lift: a.lift }],
      [b, { x: b.x + (a.x - b.x) * stub, z: b.z + (a.z - b.z) * stub, y: b.y, lift: b.lift }],
    ] as const) {
      rails.push({ from, to });
      // The stub's open end stands as its post does, however `raise` lifts it.
      stubEnds.push({ end: to, of: from });
    }
  };

  // --- 2b. the rail itself, down the centre of every closed stretch --------
  // The two flanking runs above are thin (FENCE_HALF_THICKNESS) lines offset FENCE_OFFSET
  // either side of the centre line — collision-solid, but only *there*.
  // Nothing ever stamped the ground *between* them, so a walker's own
  // fattened reach (`walkerRadius`) from each flank reaches a couple of
  // steps in and no further, leaving an un-stamped strip down the middle of
  // the whole loop. Nobody could walk there from open ground (the flanks
  // still block that), but the strip is internally connected end to end —
  // exactly a `check:park` invariant 4 finding waited for: one bridge
  // giving that strip a single legitimate connection to the rest of the
  // lattice let `NavGrid` route the *entire uncovered ring* as reachable,
  // not just the bridge's own cells. A third, invisible run straight down
  // the rail — half of `TRACK_CLEARANCE` wider than the flanks reach solo —
  // closes it, and (see `addFenceWall`) gets exactly the same `topIsAbsolute`
  // seam under a bridge deck that the flanks get, so nothing here narrows
  // what a bridge already opened.
  //
  // **And it reaches the fences' inner faces.** At `TRACK_CLEARANCE` it
  // stopped 0.52 m short of each, a strip the lattice left unstamped beside
  // each fence; a fill run down each side closes it, as the band itself
  // closed the strip down the middle, and inside the stamp the fences and the
  // band already make, so no lattice cell changes — which is why each fill
  // stops its own half-width short of the box's end: run to the end cap, its
  // round end stamped one cell beyond the cap's own (seed 5, the north
  // station).
  //
  // **A closure, not a body** (`CollisionWorld.asClosure`, PR #722). The band
  // and its fills are invisible, so they are never what stops her: Jim's
  // ruling is that what stops her is something she can see, of real height.
  // They are here for the router and the planner — `NavGrid` stamps them, so
  // no tap is routed along the track, and the planner's ground queries read
  // them, so nothing is placed on it — and no mover meets them, nothing
  // stands on them, and no NPC needs them: the crowd walks routes the band
  // closes, between fences it cannot climb. What keeps a child off the line
  // is the fence beside it and the railings on the bridges over it, by their
  // height; `check:solids`' `guards-alone` mutation shows that with every
  // top as wide as its footprint too.
  const linkBand = (a: Post, b: Post, half: number): void => {
    const deckY = deckSpanForSegment(a, b, half);
    collision.kinded('railway corridor', () =>
      collision.asClosure(() => {
        if (deckY === null) {
          collision.addWall(a.x, a.z, b.x, b.z, half);
        } else {
          collision.addWall(a.x, a.z, b.x, b.z, half, deckY - FENCE_SEAM_MARGIN, false, true);
        }
      }),
    );
  };
  const fillHalf = (FENCE_OFFSET - FENCE_HALF_THICKNESS - TRACK_CLEARANCE) / 2;
  const fillSide = (TRACK_CLEARANCE + fillHalf) / FENCE_OFFSET;
  for (const box of closed) {
    let previous: Post[] | null = null;
    const steps = Math.max(2, Math.ceil((box.to - box.from) / STEP));
    for (let i = 0; i <= steps; i += 1) {
      const distance = box.from + ((box.to - box.from) * i) / steps;
      const inset = box.from + fillHalf + ((box.to - box.from - 2 * fillHalf) * i) / steps;
      const runs = [railAt(distance, 0), railAt(inset, fillSide), railAt(inset, -fillSide)];
      if (previous) {
        linkBand(previous[0] as Post, runs[0] as Post, TRACK_CLEARANCE);
        linkBand(previous[1] as Post, runs[1] as Post, fillHalf);
        linkBand(previous[2] as Post, runs[2] as Post, fillHalf);
      }
      previous = runs;
    }
  }

  /**
   * An end cap's own lift, across the track from `left` to `right`: what a
   * jump from the station beside the box, along the line, needs it to stand
   * (the cap's middle, where the train passes, is a solid no one can see —
   * the one guard here that is not drawn — and stands as tall as its stubs).
   */
  const capLift = (left: Post, right: Post): number => {
    let lift = 0;
    for (let k = 0; k <= 4; k += 1) {
      const t = k / 4;
      lift = Math.max(lift, liftAt(left.x + (right.x - left.x) * t, left.z + (right.z - left.z) * t));
    }
    // A cap is level from post to post: the tops' need anywhere along it.
    return Math.max(lift, topsLiftAlong(left, right, () => 0));
  };
  /**
   * **The most the tops she can reach beside a run from `a` to `b` need it to
   * stand over `under(t)`** — asked at `BAY_SAMPLES` points along it and at
   * the point of it nearest each top, where that top's need peaks (seed 0: a
   * bush 7 m off a bay, its need steep with distance there, peaked between
   * the eighths and left the bay 3 cm short).
   */
  const topsLiftAlong = (a: Post, b: Post, under: (t: number) => number): number => {
    let short = -Infinity;
    const at = (t: number): void => {
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      short = Math.max(short, topsNeedAt(x, z) - planetRadiusAt(x, terrainHeight(x, z), z) - RAIL_TOP - under(t));
    };
    for (let k = 0; k <= BAY_SAMPLES; k += 1) at(k / BAY_SAMPLES);
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared > 1e-9) {
      const span = JUMP_PLAN_REACH + 4;
      const midX = (a.x + b.x) / 2;
      const midZ = (a.z + b.z) / 2;
      for (let i = Math.floor((midX - span) / TOP_BUCKET); i <= Math.floor((midX + span) / TOP_BUCKET); i += 1) {
        for (let j = Math.floor((midZ - span) / TOP_BUCKET); j <= Math.floor((midZ + span) / TOP_BUCKET); j += 1) {
          for (const top of topBuckets.get(keyOf(i, j)) ?? []) at(Math.max(0, Math.min(1, ((top.solid.centreX - a.x) * dx + (top.solid.centreZ - a.z) * dz) / lengthSquared)));
        }
      }
    }
    return short;
  };
  /**
   * A bay's rail runs straight from post to post, so where every jump at the
   * bay's middle needs more than the two posts' lifts give it there, both
   * posts stand that much taller — and the same along the bay for every top
   * she can reach beside it, whose need peaks wherever the bay passes
   * nearest it (seed 5: a stone wall by the line, a bay 3 cm short between
   * its posts).
   */
  const liftBay = (a: Post, b: Post): void => {
    const short = Math.max(
      liftAt((a.x + b.x) / 2, (a.z + b.z) / 2) - (a.lift + b.lift) / 2,
      topsLiftAlong(a, b, (t) => a.lift * (1 - t) + b.lift * t),
    );
    if (short <= 0) return;
    a.lift += short;
    b.lift += short;
  };
  for (const box of closed) {
    const steps = Math.max(2, Math.ceil((box.to - box.from) / STEP));
    const lefts: Post[] = [];
    const rights: Post[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const distance = box.from + ((box.to - box.from) * i) / steps;
      lefts.push(railAt(distance, 1));
      rights.push(railAt(distance, -1));
    }
    runs.push(lefts, rights);
    caps.push([lefts[0] as Post, rights[0] as Post], [lefts[steps] as Post, rights[steps] as Post]);
    for (let i = 0; i <= steps; i += 1) {
      const left = lefts[i] as Post;
      const right = rights[i] as Post;
      posts.push(left, right);
      addFencePost(left);
      addFencePost(right);
      if (i > 0) {
        link(lefts[i - 1] as Post, left);
        link(rights[i - 1] as Post, right);
      } else {
        cap(left, right); // the cap at this end of the box
      }
    }
    cap(lefts[steps] as Post, rights[steps] as Post); // far cap
  }

  // --- 3. the far rail of every platform stays fenced ----------------------
  // A station's gap exists so a child can board from the platform — the
  // *park* side. Open on both sides (as it first shipped), the gap was also
  // the cheapest way ACROSS the railway, and the tap-to-move router found
  // it: once issue #241 spread the plots to both sides of the loop, walks
  // to anything beyond it cut straight over the rails at a platform
  // (`check:park`'s route.crossesRail). Crossing belongs to bridges;
  // boarding belongs to platforms; so the platform's far side carries the
  // same fence as any closed stretch, with no break — if a bridge happens to
  // stand in a platform's window, `addFenceWall` gives that run the same
  // seam as anywhere else a deck crosses it.
  const stationRun = (station: StationSpan) => {
    route.pointAt(station.distance, point);
    route.tangentAt(station.distance, tangent);
    // Same side math as `train/plan.ts`'s `stationStand`: the platform is on
    // the park side (towards the origin); the fence goes opposite.
    const parkIsRight = tangent.z * -point.x - tangent.x * -point.z >= 0;
    const farSide = parkIsRight ? -1 : 1;
    const run: Post[] = [];
    const steps = Math.max(2, Math.ceil((STATION_GAP * 2) / STEP));
    for (let i = 0; i <= steps; i += 1) {
      const distance = route.wrap(station.distance - STATION_GAP + (STATION_GAP * 2 * i) / steps);
      route.pointAt(distance, point);
      route.tangentAt(distance, tangent);
      const x = point.x + tangent.z * farSide * FENCE_OFFSET;
      const z = point.z - tangent.x * farSide * FENCE_OFFSET;
      run.push({ x, z, y: terrainHeight(x, z), lift: 0 });
    }
    runs.push(run);
    let previous: Post | null = null;
    for (const post of run) {
      posts.push(post);
      addFencePost(post);
      if (previous) link(previous, post);
      previous = post;
    }
  };
  for (const station of stations) stationRun(station);

  const postMaterial = toonMaterial(PALETTE.stonePink);
  const railMaterial = toonMaterial(PALETTE.stonePinkLight);
  const postMesh = new InstancedMesh(new CylinderGeometry(POST_TOP_RADIUS, POST_RADIUS, POST_LENGTH, 6), postMaterial, posts.length);
  // Room for each bay's lower bar and top rail, and the rails between them a
  // fence `raise` stands taller needs (`MID_RAIL_GAP`): drawn up to `count`.
  const railMesh = new InstancedMesh(new BoxGeometry(RAIL_WIDTH, RAIL_DEPTH, 1), railMaterial, rails.length * (2 + MAX_MID_RAILS));
  postMesh.castShadow = false;
  railMesh.castShadow = false;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const position = new Vector3();
  const flat = new Vector3();
  const lifted = new Vector3();
  const stretch = new Vector3();
  const endFrom = new Vector3();
  const endTo = new Vector3();
  const along = new Vector3();
  const drawnAlong = new Vector3();
  const turn = new Quaternion();
  const unused = new Quaternion();
  const atMiddle = new Vector3();
  /** Every post and rail drawn as tall as its lift now stands. */
  const compose = (): void => {
    posts.forEach((post, index) => {
      // A lifted post is the same post, longer: its foot where it was, its top
      // `lift` higher.
      flat.set(post.x, post.y + POST_MIDDLE + post.lift / 2, post.z);
      placeOnSphere(flat, 0, position, rotation);
      matrix.compose(position, rotation, post.lift > 0 ? lifted.set(1, (POST_LENGTH + post.lift) / POST_LENGTH, 1) : one);
      postMesh.setMatrixAt(index, matrix);
    });
    let drawn = 0;
    rails.forEach((rail) => {
      const { from, to } = rail;
      // **A rail runs from post to post: each end is where its post puts that
      // height** — leant at the post's own foot, exactly as the post is
      // (`placeOnSphere`), so at every post the top rail's top is the 8.5 cm
      // under the cap it was authored at, and the drawn rail lies along the
      // line its solid's top runs (`addFenceWall`'s `TopSlope`).
      //
      // It used to be placed from its own midpoint, level and leant as one
      // piece. On the sphere that is a straight line tangent at the middle of
      // the bay, and wherever a bay runs across the slope of the planet its ends
      // came out up to a quarter of a metre off their posts' heights — one end
      // through the top of its post, and somewhere in every park a top rail's
      // top in a cap's plane (`check:coplanar`, seeds 3 and 9, 17 Oct 2026).
      // A fence stood taller is the same fence with more rails, never a top
      // rail over an open gap a child would read as a way through: a level
      // rail where the top rail used to be and one every `MID_RAIL_GAP` over
      // it, as far up as stays `MID_RAIL_CLEAR` under the top rail at both its
      // posts.
      const lowest = Math.min(from.lift, to.lift);
      const mids = lowest > MID_RAIL_CLEAR ? Math.min(MAX_MID_RAILS, Math.floor((lowest - MID_RAIL_CLEAR) / MID_RAIL_GAP) + 1) : 0;
      const levels: { centre: number; rides: boolean }[] = [
        { centre: RAIL_CENTRE, rides: false },
        { centre: TOP_RAIL_CENTRE, rides: true },
      ];
      for (let k = 0; k < mids; k += 1) levels.push({ centre: TOP_RAIL_CENTRE + k * MID_RAIL_GAP, rides: false });
      for (const { centre, rides } of levels) {
        // The top rail rides its posts' lift; the lower bar and the rails
        // between stay level at their own heights.
        flat.set(from.x, from.y + centre + (rides ? from.lift : 0), from.z);
        placeOnSphere(flat, 0, endFrom, unused);
        flat.set(to.x, to.y + centre + (rides ? to.lift : 0), to.z);
        placeOnSphere(flat, 0, endTo, unused);
        position.addVectors(endFrom, endTo).multiplyScalar(0.5);
        along.subVectors(endTo, endFrom);
        const length = along.length();
        along.divideScalar(length);
        // Turned as its middle leans it — its width level across the bay — and
        // then swung, the least way, to lie along the line between its ends.
        flat.set((from.x + to.x) / 2, (from.y + to.y) / 2 + centre + (rides ? (from.lift + to.lift) / 2 : 0), (from.z + to.z) / 2);
        placeOnSphere(flat, Math.atan2(to.x - from.x, to.z - from.z), atMiddle, rotation);
        drawnAlong.set(0, 0, 1).applyQuaternion(rotation);
        rotation.premultiply(turn.setFromUnitVectors(drawnAlong, along));
        stretch.set(1, 1, length);
        matrix.compose(position, rotation, stretch);
        railMesh.setMatrixAt(drawn, matrix);
        drawn += 1;
      }
    });
    railMesh.count = drawn;
    postMesh.instanceMatrix.needsUpdate = true;
    railMesh.instanceMatrix.needsUpdate = true;
  };
  compose();
  group.add(postMesh, railMesh);

  // The crossings themselves no longer get a flat timber deck here — every
  // one now has a real hump-back bridge, built and added to the scene by
  // `bridges.ts`/`ParkTrain` alongside this fence.

  // Where the fence runs, bucketed: what "near the line" means to `raise`.
  const POST_BUCKET = 8;
  const postBuckets = new Set<number>();
  for (const post of posts) postBuckets.add(keyOf(Math.floor(post.x / POST_BUCKET), Math.floor(post.z / POST_BUCKET)));
  /** Is a solid's footprint within a jump, or a jump and a chain's first link, of any post? */
  const nearLine = (x: number, z: number, reach: number): boolean => {
    const span = reach + 2 * JUMP_PLAN_REACH;
    for (let i = Math.floor((x - span) / POST_BUCKET); i <= Math.floor((x + span) / POST_BUCKET); i += 1) {
      for (let j = Math.floor((z - span) / POST_BUCKET); j <= Math.floor((z + span) / POST_BUCKET); j += 1) {
        if (postBuckets.has(keyOf(i, j))) return true;
      }
    }
    return false;
  };

  const raise = (): void => {
    // The tops she can reach near the line: takeoffs, as the walk's cells are.
    topBuckets = new Map();
    for (const top of reachableTops(collision, nearLine, walkRadius)) {
      const span = top.solid.reach;
      for (let i = Math.floor((top.solid.centreX - span) / TOP_BUCKET); i <= Math.floor((top.solid.centreX + span) / TOP_BUCKET); i += 1) {
        for (let j = Math.floor((top.solid.centreZ - span) / TOP_BUCKET); j <= Math.floor((top.solid.centreZ + span) / TOP_BUCKET); j += 1) {
          const k = keyOf(i, j);
          let list = topBuckets.get(k);
          if (!list) topBuckets.set(k, (list = []));
          if (!list.includes(top)) list.push(top);
        }
      }
    }
    // Each post as tall as every jump at it needs; each bay's middle; each
    // box's end caps, across the track.
    for (const post of posts) post.lift = liftAt(post.x, post.z);
    for (const run of runs) for (let i = 1; i < run.length; i += 1) liftBay(run[i - 1] as Post, run[i] as Post);
    for (const [left, right] of caps) {
      const lift = capLift(left, right);
      left.lift = Math.max(left.lift, lift);
      right.lift = Math.max(right.lift, lift);
    }
    for (const { end, of } of stubEnds) end.lift = of.lift;
    // The solids to what is drawn, and what is drawn to them.
    const postTops = new Map<number, number>();
    for (const [post, id] of postSolids) postTops.set(id, postTopAt(post));
    collision.retopCircles(postTops);
    for (const { a, b, wall } of baySolids) collision.retopWall(wall, railTopAt(a), railTopAt(b));
    compose();
  };

  return { group, raise };
}
