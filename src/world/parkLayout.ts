
import { PARK_MANIFEST, PARK_SEED } from './parkManifest';
import { lazyView } from '../boot/lazyView';
import { planPart } from './parkPlan';
import { registerPlanCache } from '../boot/planCaches';
import { MAIN_LOOP_WIDTH, PATH_KERB_OVERHANG } from '../core/constants';
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

/**
 * Clear ground kept either side of {@link RING_RADIUS}: the ribbon's own
 * half-width, its kerb, and a walker's stride past the paving. Deliberately
 * no more: a plot standing right off the ring's kerb is a plot *facing the
 * circle*, which is what a park promenade looks like — and every half-metre
 * added here multiplies across the ring's whole circumference into ground the
 * big anchors (and then the railway, squeezed outward behind them) no longer
 * have.
 *
 * **Asked for, not written down.** This was the literal `3.35`, with a comment
 * asserting it was 1.8 + 0.85 + 0.7 — a promise that three numbers agree,
 * which is not a mechanism. The first two now come from their owners
 * (`MAIN_LOOP_WIDTH`, `PATH_KERB_OVERHANG`), so a change to the loop's width
 * or its kerb moves this with it instead of silently disagreeing. Only the
 * stride is a judgement of this file's own, so only the stride is a literal
 * here.
 */
const RING_PLOT_WALKING_STRIDE = 0.7;
export const RING_PLOT_CLEARANCE =
  MAIN_LOOP_WIDTH / 2 + PATH_KERB_OVERHANG * 2 + RING_PLOT_WALKING_STRIDE;

/**
 * Whole-park restarts. Greedy placement can paint itself into a corner — an
 * unlucky big-plot arrangement leaves no sliver for a later relation — and
 * the cheap, deterministic cure is to re-roll the whole arrangement. Each
 * restart re-seeds every entry's own stream with the restart index, so
 * restart `r` is as deterministic as restart 0 and no entry ever inherits
 * another's draws.
 */
export const PARK_RESTARTS = 240;

/**
 * **The layout's unwind trace** — one line per decision the restart loop
 * took, in the order it took them (design doc, "Totality, ruled and
 * mechanised": *the unwind trace is printed to stderr on every build and
 * its hash is folded into the park digest*).
 *
 * `restart r` is **decision zero**: the whole park re-drawn from the same
 * seed. A trace that reads `solved restart=0` needed no unwinding; one that
 * reads `dead-end restart=0 entry=hotel … solved restart=3` reached decision
 * zero three times, and that number is a *quality* measurement
 * (`check:every-seed-builds`'s "built well" line), never a buildability
 * verdict. It is a pure function of the seed and the fixed entry order — no
 * timing, no map iteration — so two processes print the same lines, which is
 * what lets `scripts/park-digest.mts` hash them.
 *
 * Empty when nothing in this process forced the layout decision — importing
 * this module decides nothing, since `PARK_LAYOUT` is a lazy view over the
 * park's driver. The exit note below says so ("nothing forced the layout
 * decision"), so an empty trace must never read as "no unwinding".
 */
const layoutTrace: string[] = [];
export const LAYOUT_TRACE: readonly string[] = layoutTrace;

export function traceLine(text: string): void {
  const line = `layout-trace: seed=${PARK_SEED} ${text}`;
  layoutTrace.push(line);
  // stderr, not console.log: vitest shows stdout from failing tests only,
  // and this line exists precisely for the passing run (CLAUDE.md).
  try {
    const nodeProcess = (globalThis as { process?: { stderr?: { write: (s: string) => void } } })
      .process;
    nodeProcess?.stderr?.write(`${line}\n`);
  } catch {
    /* browser: the trace is still readable from LAYOUT_TRACE */
  }
}

/**
 * **The unwind ladder** (design doc, "Totality, ruled and mechanised"): a
 * point of interest whose doormat no child could reach is a *refusal*, never
 * a throw, and the answer to a refusal is a different decision —
 *
 * 1. **the refused entry redraws** — its next-best candidate (see
 *    {@link buildOnce}: the budget is the candidates it already drew);
 * 2. **the entries it collided with redraw**, most recently placed first —
 *    named by {@link footprintsBlocking}, from the same plot table every
 *    other clearance question reads, never a hand-picked list;
 * 3. **decision zero** — `restart + 1`, the whole park drawn again from the
 *    same seed. Counted, in the trace, never silent.
 *
 * Every attempt is a pure function of `(seed, entry, restart, attempt)` and
 * the refusal order is the placement order, so the trace replays exactly in
 * another process — `scripts/park-digest.mts` hashes it. The one legal throw
 * is the whole budget spent, and it carries the whole trace.
 */
/** What one restart of the layout solve produced — a layout, or the reason this restart could not. */
export type LayoutRestartOutcome =
  | { readonly kind: 'layout'; readonly layout: ParkLayout }
  | { readonly kind: 'refused'; readonly reason: string };

// ------------------------------------------------- the doormat probe (rung 1)

/**
 * What a placement is refused for — one shape, the design doc's.
 *
 * `blockers` are manifest ids from {@link footprintsBlocking}, the plots whose
 * footprints stand within a waypoint's search reach of the door (the ones a
 * boxed-in door is boxed in by); `nonPlotBlockers` names what this rung
 * cannot move — the boundary, today — so the trace says when a refusal is
 * not this rung's to answer.
 */
export interface LayoutRefusal {
  readonly kind: 'poi.stranded' | 'poi.nospot';
  readonly entry: string;
  readonly blockers: readonly string[];
  readonly nonPlotBlockers: readonly ('boundary' | string)[];
  readonly at: { readonly x: number; readonly z: number };
}

/**
 * The refusals the rung would have unwound on but did not, because
 * `LGP_LAYOUT_RUNG=off` — for `check:park`'s `layout.falseRefusal`: every
 * one of these must be a door the BUILT park cannot reach either, or the
 * probe refused something real that the real park allows (seed 1's ball
 * pit), which is the rung's one failure mode and the one this catches.
 */
export const ignoredRefusals: LayoutRefusal[] = [];
export const LAYOUT_REFUSALS_IGNORED: readonly LayoutRefusal[] = ignoredRefusals;

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

/**
 * The solved park. Import this; never re-run the solver — one canonical
 * layout per build is the whole point.
 */
/**
 * **The layout, as the park's backtracking driver decided it** — a view of
 * `parkPlan.ts`'s state. Every consumer reads it exactly as before; what
 * changed is that the decision behind it can be re-made (decision zero) when
 * a later feature refuses, and this constant follows.
 */
export const PARK_LAYOUT: ParkLayout = lazyView(() => planPart('layout'));

// An empty trace must never read as "solved first time" — the same disease as
// a check that asserts nothing. But WHEN to say so changed under backtracking:
// `PARK_LAYOUT` is now a lazy view, so at module-evaluation time the trace is
// *always* empty and a note emitted here was printed on every run, including
// the runs that went on to solve. (That stale note is what let
// `check:layout-rung`'s machinery clause read a trace of one line and score
// zero refusals as a measurement rather than as an absence.) The honest moment
// is process exit: by then, either something forced the decision and traced it,
// or nothing ever asked and the trace is empty because no layout was decided.
try {
  const nodeProcess = (
    globalThis as { process?: { on?: (event: string, handler: () => void) => void } }
  ).process;
  nodeProcess?.on?.('exit', () => {
    if (layoutTrace.length === 0) {
      traceLine('no solve ran in this process — nothing forced the layout decision');
    }
  });
} catch {
  /* browser: no process to hook, and the trace is readable from LAYOUT_TRACE */
}

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
export interface PlotColumns {
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

export function plots(): PlotColumns {
  if (plotColumns) return plotColumns;
  plotColumns = columnsOf([...PARK_LAYOUT.entries.values()]);
  return plotColumns;
}

/**
 * The columns for any list of placed entries — {@link plots} for the solved
 * park, and {@link doormatRefusals} for a *candidate* park still inside the
 * solver, which must never read the memoised table (it does not exist yet,
 * and a redraw would not invalidate it).
 */
export function columnsOf(entries: readonly PlacedEntry[]): PlotColumns {
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
  return columns;
}

/** The index of an id in {@link plots}, or -1. Cached: the callers below ask
 * with the same constant id millions of times in one route solve. */
export const exceptIndices = new Map<string, number>();

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
export function shortlistFor(x: number, z: number, margin: number): readonly number[] | null {
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

/** Convenience: the placed entry, or a loud failure naming the id. */
export function placedEntry(id: string): PlacedEntry {
  const entry = PARK_LAYOUT.entries.get(id);
  if (!entry) throw new Error(`park layout: no entry '${id}' in the manifest`);
  return entry;
}

// The plot memos below are derived from the decided layout. Under
// backtracking the layout can be re-decided (decision zero); every reader of
// `plots()`, `clearOfPlots` and the plot grid — the cruiser, the loop, the
// crossing sites, the paths — must then see the new plots, or the whole park
// is solved against a layout that no longer exists. That is exactly what
// happened before this registration: seed 8 produced two different parks from
// two entry points, and a bridge site was "proven" through the hotel's walls.
registerPlanCache(() => {
  plotColumns = null;
  exceptIndices.clear();
  plotGridCache = null;
});
