import { candidateRng, hashString, Rng, TAU } from '../core/mathUtils';
import { CAMERA_FACING_YAW } from '../core/constants';
import {
  BOUNDARY_CLEARANCE,
  GATE_CORRIDOR_HALF_WIDTH,
  LAYOUT_VERSION,
  PARK_MANIFEST,
  PARK_SEED,
  type ManifestEntry,
} from './parkManifest';
import { cachedSolve } from '../core/solveCache';
import { layoutRestartBase, layoutStreamBump } from './parkWarp';
import { PARK_BOUNDARY } from './boundary';
import { ENTRANCE_GATE_X } from './entrance/layout';
import type { AnchorFootprint } from './anchors';

/**
 * The layout solver — L1 of Decision 5.
 *
 * Takes the manifest and the canonical seed; produces a placed park. Runs
 * once at module load (pure arithmetic beyond the boundary's own polygon, no
 * three.js), so every consumer — `anchors.ts`, `paths.ts`, the stalls, the
 * fountain, the map — imports a plain solved object exactly as they used to
 * import authored constants.
 *
 * **Placement is largest-first rejection sampling with a spread preference**
 * (issue #241). Each entry draws seeded candidates in its band, keeps every
 * candidate that satisfies every constraint, and of those takes the one
 * whose nearest neighbour is furthest away — so attractions spread across
 * the park that actually exists instead of packing the first legal pocket.
 * Two properties are load-bearing:
 *
 *  - **Every entry draws from a stream of its very own**,
 *    `candidateRng(hash(id) ^ seed, restart)` — so editing the manifest
 *    cannot move any *other* entry's candidates (the reason the old park
 *    needed 15-decimal pins is gone). See `candidateRng`'s own doc for the
 *    bug class this kills.
 *  - **The limit is the boundary, not a circle.** A plot fits wherever the
 *    spline says it fits, with {@link BOUNDARY_CLEARANCE} of lane kept to
 *    the edge, asked per candidate — `PLOT_EXTENT_LIMIT = 52` capped the
 *    park to the circle it replaced (issue #241).
 *
 * Constraints, all of which fail the *build* loudly rather than degrade:
 *  - plots fit inside the spline boundary with a walkable lane to the edge;
 *  - plots keep {@link CORRIDOR_GAP} of walkable ground between bounding
 *    circles, so a path can always be routed between neighbours;
 *  - nothing blocks the gate corridor: the entrance is the one pinned thing
 *    in the park, and a child must always be able to walk straight in;
 *  - `near` relations hold (the ball pit stays within the slide's reach of
 *    the building), and `nearEdge` bands hold against the real edge.
 */

export interface PlacedEntry {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly footprint: AnchorFootprint;
  readonly boundingRadius: number;
  /**
   * Where a visitor arrives: on the plot's edge, facing the plaza. Path
   * spurs end here, signs stand here, NPC waypoints seed here.
   */
  readonly entranceX: number;
  readonly entranceZ: number;
  /**
   * Sign yaw. Exactly {@link CAMERA_FACING_YAW} (45°, "One camera angle,
   * forever") — axis-aligned to the camera's own fixed diagonal, not an
   * arbitrary per-plot rotation (issue #269: every previous build drew this
   * from a random range, which put most signs off dead-on without any of
   * them actually reading square to the camera).
   */
  readonly signYaw: number;
}

export interface ParkLayout {
  readonly seed: number;
  readonly fountain: { readonly x: number; readonly z: number; readonly radius: number };
  readonly entries: ReadonlyMap<string, PlacedEntry>;
}

/** Walkable clearance kept between any two plots' bounding circles. */
const CORRIDOR_GAP = 5;

/**
 * **The statue ring's one radius** (issue #269, Jim: "one central perfect
 * circle is ok circling the statue") — the fountain plaza's own manifest
 * radius plus the ring ribbon's half-width, kerb and a walking verge.
 * Owned here, next to the solver that has to keep plots out of its way,
 * and read by `paths.ts`'s `solveRing`, which draws the circle at exactly
 * this radius: one owner, everyone else asks.
 *
 * The old ring was a per-bearing profile relaxed around whatever plots the
 * solver had already dropped nearby — which could never be a circle,
 * because nothing kept the plots off the circle's own ground. Jim, on the
 * live preview: "this fails both to draw on a grid, and also to draw a
 * circle." This is the joint-solve answer: the ring's annulus is a
 * constraint plots must satisfy ({@link validate}'s ring rule), not ground
 * they get first grabs on.
 */
export const RING_RADIUS = (() => {
  const fountain = PARK_MANIFEST.find((entry) => entry.id === 'fountain');
  if (!fountain || fountain.footprint.kind !== 'circle') {
    throw new Error("park layout: the manifest must contain a circular 'fountain'");
  }
  return fountain.footprint.radius + 5.5;
})();

/** Clear ground kept either side of {@link RING_RADIUS}: the ribbon's own
 * half-width (1.8), its kerb (0.85) and a walker's stride (0.7) past the
 * paving. Deliberately no more: a plot standing right off the ring's kerb
 * is a plot *facing the circle*, which is what a park promenade looks
 * like — and every half-metre added here multiplies across the ring's
 * whole circumference into ground the big anchors (and then the railway,
 * squeezed outward behind them) no longer have. */
export const RING_PLOT_CLEARANCE = 3.35;

/** Candidate draws per entry before this whole-park attempt is abandoned. */
const MAX_TRIES = 3000;

/**
 * How many *valid* candidates an entry collects before choosing between
 * them. The choice is maximin — the candidate whose nearest already-placed
 * neighbour is furthest — which is what "distribute things evenly" cashes
 * out to without reserving an inch of space: a preference over legal spots,
 * never a claim on ground (Decision 6). Twelve is enough that the winner is
 * usually in a genuinely different pocket from the loser, and small enough
 * that a squeezed entry (whose valid pockets are few) still places fast.
 */
const SPREAD_CHOICES = 12;

/**
 * Whole-park restarts. Greedy placement can paint itself into a corner — an
 * unlucky big-plot arrangement leaves no sliver for a later relation — and
 * the cheap, deterministic cure is to re-roll the whole arrangement. Each
 * restart re-seeds every entry's own stream with the restart index, so
 * restart `r` is as deterministic as restart 0 and no entry ever inherits
 * another's draws.
 */
const PARK_RESTARTS = 240;

/**
 * The gate sits on the boundary wall; the corridor runs from it to centre.
 *
 * **Read from `entrance/layout.ts`, never restated.** These were
 * `Math.PI / 2` and `60` written out here with the comments "matches
 * entrance/layout.ts ENTRANCE_ANGLE" and "matches ENTRANCE_WALL_RADIUS" —
 * a promise that two numbers agree, which is not a mechanism, and which
 * CLAUDE.md names as the most common bug in this repo by a distance. Found
 * while fixing #481; nothing had drifted yet, and that is exactly when it is
 * cheap to fix.
 */

function inGateCorridor(x: number, z: number, clearance: number): boolean {
  // The corridor is the short axis-aligned strip inside the gate (which sits
  // at `ENTRANCE_ANGLE`, i.e. +Z on the boundary wall). Only the strip
  // itself must stay clear — from its mouth the approach *path* winds to
  // wherever the plaza was placed, around whatever stands in between, and
  // `check:park`'s routing invariant proves that walk exists.
  const gateX = ENTRANCE_GATE_X;
  const corridorHalf = GATE_CORRIDOR_HALF_WIDTH + clearance;
  return Math.abs(x - gateX) < corridorHalf && z > 25;
}

/**
 * How far a plot's edge lies from its centre along a direction.
 *
 * Exported for `paths.ts`'s `spur()`, which needs the same answer to keep a
 * spur's "past the doormat" extension from overshooting into the plot it is
 * approaching — see the fix note there.
 */
export function edgeDistanceAlong(footprint: AnchorFootprint, dirX: number, dirZ: number): number {
  // How far the plot's edge lies from its centre along (dirX, dirZ).
  if (footprint.kind === 'circle') return footprint.radius;
  const ax = Math.abs(dirX);
  const az = Math.abs(dirZ);
  // Distance to the rectangle's boundary along the direction, in the plot's
  // own (unrotated) frame — plots are axis-aligned, as they always were.
  const tx = ax > 1e-6 ? footprint.halfX / ax : Infinity;
  const tz = az > 1e-6 ? footprint.halfZ / az : Infinity;
  return Math.min(tx, tz);
}

function solve(): ParkLayout {
  // The warp vector may start the loop above zero (a whole-park re-roll the
  // offline search chose); with no warp this is the same `0` as ever.
  const base = layoutRestartBase();
  for (let restart = base; restart < base + PARK_RESTARTS; restart += 1) {
    const built = buildOnce(restart);
    if (built) return built;
  }
  throw new Error(
    `park layout: unsolvable in ${PARK_RESTARTS} restarts (seed ${PARK_SEED}) — ` +
      `loosen bands, shrink the manifest, or bump the seed`,
  );
}

/**
 * The bearing a camera-facing entry's counter (and so its doormat) faces.
 * THE one owner of the formula — `stallPlacement.ts` builds the booth with
 * it and this file places the doormat with it, which is exactly the pair
 * that drifted apart before (two authorities for which side of a booth is
 * the front; reviewer finding 4 on PR #247).
 *
 * Identity, deliberately (issue #269): `signYaw` is already
 * {@link CAMERA_FACING_YAW}, the camera's own fixed diagonal, so the
 * counter faces exactly that — no second, independently-tuned scale factor
 * (this used to be `signYaw * 0.35`, which pointed the counter at a
 * different, arbitrary angle from the sign sitting right above it) to drift
 * out of step with the sign it stands beside.
 */
export function counterFacing(signYaw: number): number {
  return signYaw;
}

/** One candidate position, with the spread score it was chosen on. */
interface Candidate {
  readonly x: number;
  readonly z: number;
  /** Gap to the nearest placed plot's bounding circle, in metres. */
  readonly spread: number;
}

function buildOnce(restart: number): ParkLayout | null {
  const placed: PlacedEntry[] = [];
  const byId = new Map<string, PlacedEntry>();

  // Largest first: the manifest is sorted here rather than trusting file
  // order, so adding an entry never changes packing feasibility by accident.
  const order: ManifestEntry[] = [...PARK_MANIFEST].sort(
    (a, b) => (a.solveOrder ?? 50) - (b.solveOrder ?? 50) || b.boundingRadius - a.boundingRadius,
  );

  for (const entry of order) {
    const near = entry.near ? byId.get(entry.near.id) : undefined;
    if (entry.near && !near) {
      throw new Error(
        `park layout: '${entry.id}' is near '${entry.near.id}', which is not placed yet — ` +
          `the near target must have the larger boundingRadius (it places first)`,
      );
    }

    // This entry's own stream — a pure function of (seed, id, restart), so
    // no other entry's fortunes can move this one's candidates.
    // `layoutStreamBump` is the warp vector's per-entry move: bumping ONE
    // entry's stream index re-draws that entry's candidates while every
    // other entry keeps the stream it had — the per-entry-stream property
    // above is exactly what makes this a local, deterministic mutation.
    const rng = candidateRng(hashString(entry.id) ^ PARK_SEED, restart + layoutStreamBump(entry.id));

    const candidates: Candidate[] = [];
    for (let attempt = 0; attempt < MAX_TRIES && candidates.length < SPREAD_CHOICES; attempt += 1) {
      const drawn = drawCandidate(entry, near, rng);
      const valid = validate(entry, near, drawn.x, drawn.z, placed);
      if (valid === null) continue;
      candidates.push({ x: drawn.x, z: drawn.z, spread: valid });
      if (entry.pin) break; // a pin is one candidate, validated
    }

    if (candidates.length === 0) return null; // dead end; the caller restarts

    // Maximin: of the legal spots, the one furthest from its nearest
    // neighbour. Ties keep draw order, which keeps the choice seeded.
    let best = candidates[0] as Candidate;
    for (const candidate of candidates) {
      if (candidate.spread > best.spread) best = candidate;
    }
    const { x, z } = best;

    // Entrance: on the plot edge. Camera-facing entries (the stall booths,
    // whose counters obey GAME_DESIGN #16's absolute readability rule) get
    // their doormat on the side the counter actually faces — the same
    // signYaw-derived bearing `stallPlacement.ts` builds the booth with, so
    // the doormat, the stand and the counter are one line by construction.
    // Everything else faces the park middle, the stable thing paths and the
    // camera both live by.
    //
    // Every entry's sign — camera-facing or not — turns to exactly
    // CAMERA_FACING_YAW (issue #269): axis-aligned to the camera's own fixed
    // diagonal, not drawn from `rng`, so there is no per-seed rotation left
    // to call "arbitrary."
    const signYaw = CAMERA_FACING_YAW;
    let dirX: number;
    let dirZ: number;
    if (entry.cameraFacing) {
      const facing = counterFacing(signYaw);
      dirX = Math.sin(facing);
      dirZ = Math.cos(facing);
    } else {
      const towardMiddle = Math.hypot(x, z) > 1e-6 ? [-x, -z] : [0, 1];
      const length = Math.hypot(towardMiddle[0] as number, towardMiddle[1] as number);
      dirX = (towardMiddle[0] as number) / length;
      dirZ = (towardMiddle[1] as number) / length;
    }
    const edge = edgeDistanceAlong(entry.footprint, dirX, dirZ);
    const standOff = 1.4; // the sign and the doormat, just clear of the plot
    const entranceX = x + dirX * (edge + standOff);
    const entranceZ = z + dirZ * (edge + standOff);

    const item: PlacedEntry = {
      id: entry.id,
      x,
      z,
      footprint: entry.footprint,
      boundingRadius: entry.boundingRadius,
      entranceX,
      entranceZ,
      signYaw,
    };
    placed.push(item);
    byId.set(entry.id, item);
  }

  const fountain = byId.get('fountain');
  if (!fountain || fountain.footprint.kind !== 'circle') {
    throw new Error(`park layout: the manifest must contain a circular 'fountain'`);
  }

  return {
    seed: PARK_SEED,
    fountain: { x: fountain.x, z: fountain.z, radius: fountain.footprint.radius },
    entries: byId,
  };
}

/** One seeded draw for an entry: its pin, its relation ring, or its band. */
function drawCandidate(
  entry: ManifestEntry,
  near: PlacedEntry | undefined,
  rng: Rng,
): { x: number; z: number } {
  if (entry.pin) return { x: entry.pin[0], z: entry.pin[1] };
  if (near && entry.near) {
    // Draw around the relation target; the band still applies afterwards.
    const angle = rng.range(0, TAU);
    const distance = rng.range(entry.near.min, entry.near.max);
    return { x: near.x + Math.cos(angle) * distance, z: near.z + Math.sin(angle) * distance };
  }
  // Area-uniform draw inside the band annulus, capped at the furthest the
  // boundary ever reaches — beyond that a candidate cannot possibly fit, so
  // drawing there only spends tries.
  const angle = rng.range(0, TAU);
  const max = Math.min(entry.band.max, PARK_BOUNDARY.maxRadius);
  const r2min = entry.band.min * entry.band.min;
  const r2max = max * max;
  const radius = Math.sqrt(rng.range(r2min, Math.max(r2min, r2max)));
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/**
 * Every constraint on one candidate, or `null` if any fails. On success,
 * returns the spread score (gap to the nearest placed plot) for maximin.
 * A pinned entry that fails throws instead: a pin must still make a
 * working park.
 */
function validate(
  entry: ManifestEntry,
  near: PlacedEntry | undefined,
  x: number,
  z: number,
  placed: readonly PlacedEntry[],
): number | null {
  const fail = (reason: string): null => {
    if (entry.pin) {
      throw new Error(
        `park layout: pinned entry '${entry.id}' at [${x}, ${z}] ${reason} — ` +
          `a pin must still make a working park`,
      );
    }
    return null;
  };

  const centreDistance = Math.hypot(x, z);
  if (centreDistance < entry.band.min - 1e-6 || centreDistance > entry.band.max + 1e-6) {
    return fail('leaves its band');
  }

  // The park's real edge, per bearing — the constraint that replaced the
  // 52 m circle (issue #241).
  const edgeGap = PARK_BOUNDARY.distanceToEdge(x, z) - entry.boundingRadius;
  if (edgeGap < BOUNDARY_CLEARANCE) return fail('does not fit inside the boundary');
  if (entry.nearEdge && (edgeGap < entry.nearEdge.min || edgeGap > entry.nearEdge.max)) {
    return fail('misses its nearEdge band');
  }

  if (inGateCorridor(x, z, entry.boundingRadius)) return fail('blocks the gate corridor');

  // Keep every plot's bounding circle clear of the statue ring's annulus —
  // the fountain is solveOrder 0, so it is always already placed when any
  // other entry validates. (The fountain itself is the ring's centre; the
  // ring stands RING_RADIUS outside it by construction, so it needs no
  // check of its own.)
  if (entry.id !== 'fountain') {
    const fountainEntry = placed.find((other) => other.id === 'fountain');
    if (fountainEntry) {
      const ringGap = Math.abs(
        Math.hypot(x - fountainEntry.x, z - fountainEntry.z) - RING_RADIUS,
      );
      if (ringGap < entry.boundingRadius + RING_PLOT_CLEARANCE) {
        return fail('stands in the statue ring');
      }
    }
  }

  let spread = Infinity;
  for (const other of placed) {
    const gap = Math.hypot(x - other.x, z - other.z) - entry.boundingRadius - other.boundingRadius;
    // The near-target pair is deliberately close; its manifest min is the
    // rule. Everyone else keeps a walkable corridor.
    const isNearTarget = near !== undefined && other.id === near.id;
    if (!isNearTarget && gap < CORRIDOR_GAP) return fail(`crowds '${other.id}'`);
    if (gap < spread) spread = gap;
  }
  return spread;
}

/**
 * The solved park. Import this; never re-run the solver — one canonical
 * layout per build is the whole point.
 */
export const PARK_LAYOUT: ParkLayout = cachedSolve(
  'layout',
  `${PARK_SEED}:${LAYOUT_VERSION}`,
  solve,
  (layout) => ({
    seed: layout.seed,
    fountain: layout.fountain,
    entries: [...layout.entries.values()],
  }),
  (raw) => {
    const packed = raw as {
      seed: number;
      fountain: ParkLayout['fountain'];
      entries: PlacedEntry[];
    };
    if (packed.seed !== PARK_SEED) throw new Error('stale seed');
    return {
      seed: packed.seed,
      fountain: packed.fountain,
      entries: new Map(packed.entries.map((entry) => [entry.id, entry])),
    };
  },
);

/**
 * The plots as a flat array, built once.
 *
 * `PARK_LAYOUT.entries` is a `Map`, and `for (const e of map.values())`
 * allocates an iterator on every call. That is invisible when a lamp post
 * asks once; the Sky Cruiser's route search asks {@link clearOfFootprints}
 * on **every sample of every candidate piece** — a Node CPU profile put the
 * two functions below at 14% of the whole solve, most of it iterator churn
 * and property loads off a `ReadonlyMap`. Same entries, same order, no
 * allocation. Lazily built because `PARK_LAYOUT` is initialised in this very
 * module and a top-level `[...values()]` here would read it mid-definition.
 */
interface PlotColumns {
  readonly count: number;
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly boundingRadius: Float64Array;
  /** A circle's radius, or a rectangle's half-extent in x. */
  readonly halfX: Float64Array;
  /** A circle's radius again, or a rectangle's half-extent in z. */
  readonly halfZ: Float64Array;
  readonly isRect: Uint8Array;
  readonly ids: readonly string[];
}

let plotColumns: PlotColumns | null = null;

function plots(): PlotColumns {
  if (plotColumns) return plotColumns;
  const entries = [...PARK_LAYOUT.entries.values()];
  const count = entries.length;
  const columns: PlotColumns = {
    count,
    x: new Float64Array(count),
    z: new Float64Array(count),
    boundingRadius: new Float64Array(count),
    halfX: new Float64Array(count),
    halfZ: new Float64Array(count),
    isRect: new Uint8Array(count),
    ids: entries.map((entry) => entry.id),
  };
  for (let i = 0; i < count; i += 1) {
    const entry = entries[i] as PlacedEntry;
    columns.x[i] = entry.x;
    columns.z[i] = entry.z;
    columns.boundingRadius[i] = entry.boundingRadius;
    if (entry.footprint.kind === 'circle') {
      columns.halfX[i] = entry.footprint.radius;
      columns.halfZ[i] = entry.footprint.radius;
    } else {
      columns.isRect[i] = 1;
      columns.halfX[i] = entry.footprint.halfX;
      columns.halfZ[i] = entry.footprint.halfZ;
    }
  }
  plotColumns = columns;
  return columns;
}

/** The index of an id in {@link plots}, or -1. Cached: the callers below ask
 * with the same constant id millions of times in one route solve. */
const exceptIndices = new Map<string, number>();
function exceptIndex(exceptId: string | undefined): number {
  if (exceptId === undefined) return -1;
  const known = exceptIndices.get(exceptId);
  if (known !== undefined) return known;
  const found = plots().ids.indexOf(exceptId);
  exceptIndices.set(exceptId, found);
  return found;
}

/**
 * Which plots could possibly matter near each patch of ground.
 *
 * {@link clearOfFootprints} and {@link clearOfPlots} scanned every plot per
 * query — with exact axis prefilters, and it was *still* 12-14% of a Sky
 * Cruiser solve, because the route search asks on every sample of every
 * candidate piece. This is the grid-bucket the prefilters were standing in
 * for: per cell, the indices of every plot whose bounding box, inflated by
 * {@link GRID_MARGIN_CEILING}, touches that cell. A query at `margin` at most
 * the ceiling walks its cell's shortlist and runs the **same per-plot test in
 * the same index order**; plots not on the shortlist provably cannot answer
 * "blocked" for any point in the cell at any admissible margin, so skipping
 * them is exact, never approximate. A query wider than the ceiling — nothing
 * in the park's own generation makes one — falls back to the full scan.
 */
const GRID_CELL = 12;
const GRID_MARGIN_CEILING = 8;

interface PlotGrid {
  readonly minGx: number;
  readonly minGz: number;
  readonly cellsWide: number;
  readonly cellsDeep: number;
  /** Plot indices per cell, indexed `gx * cellsDeep + gz`. */
  readonly shortlists: readonly (readonly number[])[];
}

let plotGridCache: PlotGrid | null = null;

function plotGrid(): PlotGrid {
  if (plotGridCache) return plotGridCache;
  const plot = plots();
  // Reach: the furthest a plot can matter from its centre, at the widest
  // admissible margin. `boundingRadius` is taken alongside the half-extents
  // rather than trusted to contain them, so a manifest entry whose bounding
  // radius understates its rectangle cannot silently fall off a shortlist.
  const reaches = new Float64Array(plot.count);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < plot.count; i += 1) {
    const reach =
      Math.max(
        plot.boundingRadius[i] as number,
        plot.halfX[i] as number,
        plot.halfZ[i] as number,
      ) + GRID_MARGIN_CEILING;
    reaches[i] = reach;
    minX = Math.min(minX, (plot.x[i] as number) - reach);
    maxX = Math.max(maxX, (plot.x[i] as number) + reach);
    minZ = Math.min(minZ, (plot.z[i] as number) - reach);
    maxZ = Math.max(maxZ, (plot.z[i] as number) + reach);
  }
  const minGx = Math.floor(minX / GRID_CELL);
  const minGz = Math.floor(minZ / GRID_CELL);
  const cellsWide = Math.floor(maxX / GRID_CELL) - minGx + 1;
  const cellsDeep = Math.floor(maxZ / GRID_CELL) - minGz + 1;
  const shortlists: number[][] = Array.from({ length: cellsWide * cellsDeep }, () => []);
  for (let i = 0; i < plot.count; i += 1) {
    const reach = reaches[i] as number;
    const loGx = Math.floor(((plot.x[i] as number) - reach) / GRID_CELL) - minGx;
    const hiGx = Math.floor(((plot.x[i] as number) + reach) / GRID_CELL) - minGx;
    const loGz = Math.floor(((plot.z[i] as number) - reach) / GRID_CELL) - minGz;
    const hiGz = Math.floor(((plot.z[i] as number) + reach) / GRID_CELL) - minGz;
    for (let gx = loGx; gx <= hiGx; gx += 1) {
      for (let gz = loGz; gz <= hiGz; gz += 1) {
        (shortlists[gx * cellsDeep + gz] as number[]).push(i);
      }
    }
  }
  plotGridCache = { minGx, minGz, cellsWide, cellsDeep, shortlists };
  return plotGridCache;
}

/**
 * The shortlist for (x, z) at `margin`, or `null` meaning "scan everything".
 *
 * A point outside the grid entirely is beyond every plot's inflated reach, so
 * the empty shortlist it gets is the honest answer, not a fallback.
 */
const EMPTY_SHORTLIST: readonly number[] = [];
function shortlistFor(x: number, z: number, margin: number): readonly number[] | null {
  if (margin > GRID_MARGIN_CEILING) return null;
  const g = plotGrid();
  const gx = Math.floor(x / GRID_CELL) - g.minGx;
  const gz = Math.floor(z / GRID_CELL) - g.minGz;
  if (gx < 0 || gx >= g.cellsWide || gz < 0 || gz >= g.cellsDeep) return EMPTY_SHORTLIST;
  return g.shortlists[gx * g.cellsDeep + gz] as readonly number[];
}

/** Clear of every plot's bounding circle by `radius`. Pure, for the plans
 * solved at module load (train, coaster, ferris exit) — lives here so none
 * of them has to import another ride's plan just to ask about the layout. */
export function clearOfPlots(x: number, z: number, radius: number): boolean {
  const plot = plots();
  const px = plot.x;
  const pz = plot.z;
  const pr = plot.boundingRadius;
  const shortlist = shortlistFor(x, z, radius);
  const count = shortlist ? shortlist.length : plot.count;
  for (let at = 0; at < count; at += 1) {
    const i = shortlist ? (shortlist[at] as number) : at;
    const reach = (pr[i] as number) + radius;
    // `hypot(a, b) >= |a|` always, so either axis alone being out of reach
    // settles it — and settles it exactly as the hypot would have, for a
    // fraction of the cost. This is a prefilter, never a second rule.
    const dx = x - (px[i] as number);
    if (dx >= reach || -dx >= reach) continue;
    const dz = z - (pz[i] as number);
    if (dz >= reach || -dz >= reach) continue;
    if (Math.hypot(dx, dz) < reach) return false;
  }
  return true;
}

/**
 * Clear of every plot's actual FOOTPRINT (rect or circle) by `margin`.
 *
 * The bounding circle overstates a rectangular plot's corners by metres —
 * fine for spacing, wrong for a ride that deliberately flies close: the Sky
 * Cruiser's station is placed beside the castle on purpose, and testing its
 * low-altitude window against the castle's 19 m circle rejects every pose
 * the near-relation just arranged. The footprint is what is really built.
 */
export function clearOfFootprints(x: number, z: number, margin: number, exceptId?: string): boolean {
  const plot = plots();
  const skip = exceptIndex(exceptId);
  const px = plot.x;
  const pz = plot.z;
  const hx = plot.halfX;
  const hz = plot.halfZ;
  const rect = plot.isRect;
  const shortlist = shortlistFor(x, z, margin);
  const count = shortlist ? shortlist.length : plot.count;
  for (let at = 0; at < count; at += 1) {
    const i = shortlist ? (shortlist[at] as number) : at;
    if (i === skip) continue;
    if (rect[i] === 0) {
      const reach = (hx[i] as number) + margin;
      // Axis prefilters, exact rather than approximate: `hypot(a, b) >= |a|`,
      // so either axis alone exceeding the reach settles the hypot too.
      const dx = x - (px[i] as number);
      if (dx >= reach || -dx >= reach) continue;
      const dz = z - (pz[i] as number);
      if (dz >= reach || -dz >= reach) continue;
      if (Math.hypot(dx, dz) < reach) return false;
      continue;
    }
    const dx = Math.abs(x - (px[i] as number)) - (hx[i] as number);
    // Same argument on the rectangle: `outside >= max(dx, 0)`, so a `dx` at or
    // past the margin cannot be inside it, and `dx > 0` rules out the
    // both-negative case as well.
    if (dx >= margin) continue;
    const dz = Math.abs(z - (pz[i] as number)) - (hz[i] as number);
    if (dz >= margin) continue;
    const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
    if ((dx <= 0 && dz <= 0) || outside < margin) return false;
  }
  return true;
}

/** Convenience: the placed entry, or a loud failure naming the id. */
export function placedEntry(id: string): PlacedEntry {
  const entry = PARK_LAYOUT.entries.get(id);
  if (!entry) throw new Error(`park layout: no entry '${id}' in the manifest`);
  return entry;
}
