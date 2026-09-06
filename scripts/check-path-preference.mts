/**
 * **Does a route use the paving that is right there?**
 *
 * ```
 * pnpm run check:path-preference [--verbose]
 * ```
 *
 * Jim, 31 August 2026: *"the pathfinding seemingly gives no weighting to paths
 * (for player and NPC) - make it prefer walking on paths, but off them is
 * possible too if you with some reasonable weighting penalty"* (issue #416).
 * The park's generator lays out a street plan and then everybody who lives in
 * the park walked straight across the lawn, because `NavGrid`'s A* charged the
 * same `1` per step whatever the step was standing on.
 *
 * This measures the **real park**, with the **real router**, and it measures
 * both of the things Jim asked for at once, because either alone is easy to
 * satisfy and useless:
 *
 * 1. **Routes use the paving.** Between two junctions of the solved path
 *    network — the network's own nodes, never coordinates typed in here, and
 *    only the ones a child could actually stand at (see `standable`) — a
 *    route must spend most of its length on paving. Two statements, both about
 *    **one** population (routes that arrived, over pairs the paving can serve
 *    within {@link OFF_PATH_COST_MULTIPLIER}): a **mean** floor of 70%, and a
 *    **distribution** rule — *at least 85% of routes are at least 60% paved* —
 *    so one heroic route cannot carry a bad mean. Both numbers were derived by
 *    measuring all five procgen seeds, and the tables that derive them sit on
 *    the constants themselves. The same bar is then put to the **unweighted**
 *    router and asserted to fail, so the mutation test runs on every
 *    invocation rather than living in a transcript that goes stale.
 * 2. **It is a preference, not a wall.** The same probes are run a second time
 *    against a second lattice built with the paving forgotten, and:
 *    - **nothing may become unreachable**: every destination the unweighted
 *      router reaches, the weighted one must reach too, across a lattice of
 *      destinations spread over the whole park — grass, meadow, the gaps
 *      between attractions;
 *    - **nothing may become eccentric**: no weighted route may be longer than
 *      {@link OFF_PATH_COST_MULTIPLIER} (plus the smoother's own 8% allowance)
 *      times the unweighted one. That bound is not a tuning knob, it is
 *      arithmetic — paving costs exactly the distance walked, so an optimal
 *      weighted route can never exceed the multiplier times the direct one —
 *      and asserting it here is what stops a future "make it prefer paths
 *      harder" from walking a six-year-old round the houses. It is the
 *      machine-checkable form of *"would a watching adult say: why did she go
 *      that way?"*
 * 3. **Both movers, one penalty.** The children plan through
 *    `JourneyPlanner.plan`, not through the player's grid, so the same probes
 *    are put through a real `JourneyPlanner` and must come back with the same
 *    paving fraction. Two routers that ever stopped sharing the constant — the
 *    bug class CLAUDE.md names as this repo's most-cited — would part company
 *    here, on a number, rather than in somebody's play session.
 *
 * "On the paving" is asked of `pathGraph.ts`'s own `isOnPath`, the same
 * function the scenery placer uses, so this check cannot invent a second idea
 * of where the paths are. And it refuses to run at all unless the park
 * published some paving (`pavingIsKnown`): a check that measures a park with no
 * paths in it would sail green for ever while proving nothing, which is the
 * defect this repo has the most of.
 *
 * ## Proven red by mutation
 *
 * Re-run 1 September 2026 **after rebasing onto `origin/main`'s hoppable-wall
 * cost and after the standable-endpoint fix below**, because a transcript is a
 * measurement and measurements go stale (CLAUDE.md): the park these were
 * proved against is the park in the working tree today.
 *
 * **Mutation 2 — the smoother stops respecting the weighting** (delete the
 * `chordCost > (polyCost + legCost) * (1 + SMOOTH_CORNER_TOLERANCE)` line in
 * `NavGrid.smooth`; the feature shipped with only half of it, which is the
 * subtle way to get this wrong). This is the honest proof of the two
 * assertions below, because it does not touch `OFF_PATH_COST_MULTIPLIER`, so
 * the population is unchanged and only the routes move:
 *
 * ```
 * canonical (82 probes):
 *   ok    routes stay on the paving: mean 71.5%  (floor 70%)      [was 83.4%]
 *   FAIL  most routes are mostly paved: 65 of 82 (79.3%), bar 85% [was 79 of 82, 96.3%]
 * seed 11, the binding seed (50 probes):
 *   FAIL  routes stay on the paving: mean 57.3%  (floor 70%)      [was 74.4%]
 *   FAIL  most routes are mostly paved: 21 of 50 (42.0%), bar 85% [was 47 of 50, 94.0%]
 * exit=1
 * ```
 *
 * Note which one bites where. On the canonical park the **distribution** rule
 * is what goes red while the mean survives at +1.5 — which is exactly why the
 * distribution rule exists, and why a mean alone would have let this mutation
 * through on the one seed most people run.
 *
 * **Mutation 1 — `OFF_PATH_COST_MULTIPLIER = 1`**, the behaviour before this
 * issue. This also exits 1, but **be precise about why, because it is not the
 * paving assertions that fail**: the servable predicate is defined in terms of
 * that very multiplier, so setting it to 1 collapses the population to 2 probes
 * and the run stops at the `< 8` guard with *"only 2 of 89 probes both arrive
 * and have a paved route inside 1x (2 servable, 89 arriving)"*. Red, and
 * loudly, but it is the guard talking, not a measurement of paving. Note the
 * *89 arriving*: all of them do, which is the standable-endpoint fix showing
 * its work — before it, this line read 78 of 100.
 *
 * **A transcript is a measurement, and measurements go stale** (CLAUDE.md), so
 * what mutation 1 was *for* is asserted live instead, on every invocation, by
 * `the bar is a real bar` below. The unweighted lattice is that mutation —
 * built in this same process, at the true multiplier, over the true
 * population — and the check requires it to fail the very bar the weighted one
 * passes. It fails it by 43.5 points on the canonical park and by 38.3–71.8
 * across the five seeds. That is the strongest form of the claim available
 * here: not
 * "someone once saw this go red", but "it is red right now, in this run".
 *
 * ## Every seed, not just the canonical one
 *
 * The thresholds here were derived on **all five procgen seeds** (canonical
 * `20260728` plus 5, 11, 18, 24 — `LGP_SEED=n pnpm run check:path-preference`),
 * because a threshold read off one park is a threshold that breaks on the next
 * one: that is exactly what happened to the two constants this file used to
 * carry. Seed **11** is the binding seed on every statement below and is the
 * one to measure first if the paving moves.
 *
 * **Two things about that list have changed since, and both matter if you
 * re-derive (#510).** First, **seed 18 is retired** — it structurally needs a
 * level crossing, and since 2 Sep 2026 every rail crossing is a bridge, so its
 * park no longer builds at all. Every "all five seeds" transcript below was
 * taken while it did, and they are left at the basis they were actually
 * measured against rather than rewritten, because a transcript edited to a
 * list it was never run on stops being a measurement. Second, the sweep list
 * has an owner now: `CI_SWEEP_SEEDS` in `parkSeedPool.ts`, seven seeds today.
 * **Re-derive against that, not against the five in the line above.**
 *
 * And note what this script itself does at runtime: it builds **one** park,
 * whichever seed the process resolved to — canonical, in CI. The sweeping was
 * done by hand, by a person setting `LGP_SEED`. So a green run here is a
 * statement about the canonical park; the thresholds are what carry the other
 * seeds, and they carry them only as well as the last hand sweep did.
 */

import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { NavGrid, MAX_ROUTE_WAYPOINTS } from '../src/world/NavGrid.ts';
import {
  OFF_PATH_COST_MULTIPLIER,
  forgetPavingForTesting,
  pavingIsKnown,
} from '../src/world/paving.ts';
import { PATH_GRAPH, distanceToPath, isOnPath, pathCentreline } from '../src/world/pathGraph.ts';
import { JourneyPlanner } from '../src/entities/npc/journey.ts';
import { gardenAttractions } from '../src/entities/npc/attractions.ts';
import { SPACE_GARDEN } from '../src/world/spaces.ts';
import { GARDEN_PLAY_RADIUS, PLAYER_RADIUS } from '../src/core/constants.ts';
import { JUMP_APEX_HEIGHT } from '../src/entities/Player.ts';

const verbose = process.argv.includes('--verbose');
const failures: string[] = [];
const table: string[] = [];

function check(ok: boolean, what: string): void {
  const line = `${ok ? '  ok ' : 'FAIL '} ${what}`;
  if (ok) table.push(line);
  else failures.push(what);
  if (!ok || verbose) console.log(line);
}

// ------------------------------------------------------------------ the park

const park = buildHeadlessPark();
const world = park.world;
const collision = world.collision;

if (!pavingIsKnown()) {
  console.error(
    'check:path-preference — the built park published no paving at all ' +
      '(world/paving.ts). Either `buildPaths()` stopped publishing, or this ' +
      'harness stopped building a garden. Refusing to measure nothing.',
  );
  process.exit(1);
}

const bridgeCovers = (x: number, z: number): boolean =>
  world.train.bridges.some((bridge) => bridge.covers(x, z));

/** The lattice a finger is routed on, built exactly as `Game.ts` builds it. */
function playerGrid(): NavGrid {
  return new NavGrid(
    collision,
    PLAYER_RADIUS,
    JUMP_APEX_HEIGHT,
    () => world.building.surfaces.connectors,
    bridgeCovers,
  );
}

// --------------------------------------------------------------- the probes
//
// Junction to junction of the *solved network*, so every coordinate here comes
// from the park that was actually built. Nothing is typed in; if the generator
// moves a spur — and #414 is about to move several, near the bridges — these
// probes move with it.

/** How far apart two junctions must be to be worth routing between. */
const MIN_PROBE_SEPARATION = 30;
/** And how far is far enough that the probe stops being about the paths. */
const MAX_PROBE_SEPARATION = 140;

interface Probe {
  readonly label: string;
  readonly ax: number;
  readonly az: number;
  readonly bx: number;
  readonly bz: number;
}

// The weighted router — the one the game runs. Built here rather than further
// down because the probe set is derived *from it*: see `standable` below.
const weighted = playerGrid();

/**
 * **Is this junction somewhere a child could actually stand?**
 *
 * Asked of `NavGrid.canStandAt`, which is the very test `findRoute` applies to
 * its own goal — so this cannot invent a second idea of where a walk may end,
 * any more than `isOnPath` lets this file invent a second idea of where the
 * paving is. Nothing here is a list of node names: a junction is excluded
 * because the lattice the router walks says a body cannot occupy its cell,
 * which stays true when the park moves and a hand-maintained exclusion list
 * would not.
 *
 * **Why the probe set has to be built this way.** `PATH_GRAPH`'s nodes are
 * points on a *drawn plan*, and the plan does not know about the bollard the
 * scenery placer later put 0.97 m away. Fattened by `PLAYER_RADIUS` and
 * quantised to `NavGrid`'s 0.5 m lattice, a collider that close closes the
 * node's own cell, and the junction becomes a place a route can pass but never
 * finish. Asking for a route to it is asking for a route that cannot exist, so
 * `every probe arrives` — rightly — fails. The sample set was the defect, not
 * the assertion: before that assertion existed these probes were scored as
 * **100% paved** 3 m stubs, which is the check flattering itself with its own
 * failures.
 */
const standable = (x: number, z: number): boolean =>
  weighted.canStandAt(x, z, park.sample(x, z, 0), park.sample);

/**
 * How far from a point the nearest standable ground is, so an exclusion can
 * report *how badly* the junction misses rather than only that it did. A
 * knife-edge miss (one lattice cell) is a different park defect from a
 * junction several metres inside something, and the two want different fixes.
 * `Infinity` if nothing within {@link EXCLUSION_PROBE_REACH}.
 */
const EXCLUSION_PROBE_REACH = 6;
function distanceToStandable(x: number, z: number): number {
  for (let radius = 0.25; radius <= EXCLUSION_PROBE_REACH; radius += 0.25) {
    for (let bearing = 0; bearing < 16; bearing += 1) {
      const angle = (bearing / 16) * Math.PI * 2;
      if (standable(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius)) return radius;
    }
  }
  return Infinity;
}

const onPathNodes = PATH_GRAPH.nodes
  .filter((node) => isOnPath(node.x, node.z))
  .slice()
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const junctions = onPathNodes.filter((node) => standable(node.x, node.z));
const excluded = onPathNodes.filter((node) => !standable(node.x, node.z));

// **Say what was dropped, every run.** A probe set that silently shrinks is how
// the next regression hides: excluding endpoints can only make this check
// easier, so the count and the reason belong on the screen next to the numbers
// they shaped. On stderr, per CLAUDE.md — vitest aside, a note that only
// appears when something else fails is a note nobody reads on the run it
// matters for.
process.stderr.write(
  `check:path-preference — ${junctions.length} of ${onPathNodes.length} path-network ` +
    `junctions are somewhere a child can stand; ${excluded.length} excluded from the ` +
    'probe set because `NavGrid` (the lattice the router itself walks) will not let a ' +
    "body occupy the junction's own cell, so no route could ever end there:\n",
);
for (const node of excluded) {
  const clear = distanceToStandable(node.x, node.z);
  process.stderr.write(
    `  · ${node.id} at (${node.x.toFixed(2)}, ${node.z.toFixed(2)}) — nearest standable ` +
      `ground ${Number.isFinite(clear) ? `${clear.toFixed(2)} m away` : `over ${EXCLUSION_PROBE_REACH} m away`}\n`,
  );
}
if (excluded.length === 0) {
  process.stderr.write('  · none — every junction of the network is standable\n');
}

const probes: Probe[] = [];
for (let i = 0; i < junctions.length; i += 1) {
  for (let j = i + 1; j < junctions.length; j += 1) {
    const a = junctions[i]!;
    const b = junctions[j]!;
    const separation = Math.hypot(a.x - b.x, a.z - b.z);
    if (separation < MIN_PROBE_SEPARATION || separation > MAX_PROBE_SEPARATION) continue;
    // Both ends must be inside the garden's own play bounds, or the router
    // is being asked about somewhere it does not plan.
    if (Math.hypot(a.x, a.z) > GARDEN_PLAY_RADIUS - 2) continue;
    if (Math.hypot(b.x, b.z) > GARDEN_PLAY_RADIUS - 2) continue;
    probes.push({ label: `${a.id} → ${b.id}`, ax: a.x, az: a.z, bx: b.x, bz: b.z });
  }
}

// **The guard that makes the exclusion above safe.** Dropping unstandable
// endpoints can only shrink the probe set, and a check measuring three routes
// would sail green while proving nothing. So if exclusion ever eats the set,
// this is loud rather than quiet — and it names the exclusion as a suspect,
// because "the park grew a lot of blocked junctions" and "the network changed
// shape" are different diagnoses with the same symptom.
if (probes.length < 8) {
  console.error(
    `check:path-preference — only ${probes.length} junction pairs in the solved ` +
      `network are both far enough apart to route between and standable at each end ` +
      `(${junctions.length} of ${onPathNodes.length} junctions are standable, ` +
      `${excluded.length} excluded — listed above). The network has changed ` +
      'shape; re-derive the probes rather than lowering the bar.',
  );
  process.exit(1);
}

// ------------------------------- can the paving actually serve a pair at all?
//
// Some junction pairs have no paved route the router could take *without*
// taking a detour this feature is designed to refuse. The worst-route floor
// below must not gate on those, because satisfying it and satisfying
// `OFF_PATH_COST_MULTIPLIER` are mutually exclusive there — see the header.
//
// So: the shortest route that stays on paving the whole way, measured on a
// lattice whose cells are paved according to `isOnPath` — the same function
// every other "on the paving" question in this file is asked of, so this
// cannot invent a second idea of where the paths are.

/** Cell size of the paved-only lattice. `NavGrid`'s own `CELL`. */
const PAVED_CELL = 0.5;
const PAVED_REACH = GARDEN_PLAY_RADIUS + 2;
const pavedSide = Math.ceil((PAVED_REACH * 2) / PAVED_CELL);
const pavedOrigin = -PAVED_REACH + PAVED_CELL / 2;
const pavedCells = new Uint8Array(pavedSide * pavedSide);
let pavedCellCount = 0;
for (let cz = 0; cz < pavedSide; cz += 1) {
  for (let cx = 0; cx < pavedSide; cx += 1) {
    if (isOnPath(pavedOrigin + cx * PAVED_CELL, pavedOrigin + cz * PAVED_CELL)) {
      pavedCells[cz * pavedSide + cx] = 1;
      pavedCellCount += 1;
    }
  }
}
if (pavedCellCount < 100) {
  console.error(
    `check:path-preference — the paved-only lattice found just ${pavedCellCount} ` +
      'paved cells. `isOnPath` has stopped agreeing with the drawn network; ' +
      'refusing to measure servability against nothing.',
  );
  process.exit(1);
}

/** The paved cell nearest a world point, or -1 if none is within 3 m. */
function pavedCellAt(x: number, z: number): number {
  const cx = Math.round((x - pavedOrigin) / PAVED_CELL);
  const cz = Math.round((z - pavedOrigin) / PAVED_CELL);
  const reach = Math.ceil(3 / PAVED_CELL);
  let best = -1;
  let bestD = Infinity;
  for (let dz = -reach; dz <= reach; dz += 1) {
    for (let dx = -reach; dx <= reach; dx += 1) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= pavedSide || nz >= pavedSide) continue;
      const c = nz * pavedSide + nx;
      if (!pavedCells[c]) continue;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  return best;
}

/** Dijkstra over paved cells only, 8-connected. One field per source, cached. */
function pavedOnlyField(source: number): Float64Array {
  const dist = new Float64Array(pavedSide * pavedSide).fill(Infinity);
  const heapCell: number[] = [source];
  const heapDist: number[] = [0];
  dist[source] = 0;
  const swap = (i: number, j: number): void => {
    [heapCell[i], heapCell[j]] = [heapCell[j]!, heapCell[i]!];
    [heapDist[i], heapDist[j]] = [heapDist[j]!, heapDist[i]!];
  };
  const up = (i: number): void => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapDist[p]! <= heapDist[i]!) break;
      swap(i, p);
      i = p;
    }
  };
  const down = (i: number): void => {
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let s = i;
      if (l < heapDist.length && heapDist[l]! < heapDist[s]!) s = l;
      if (r < heapDist.length && heapDist[r]! < heapDist[s]!) s = r;
      if (s === i) break;
      swap(i, s);
      i = s;
    }
  };
  while (heapDist.length > 0) {
    const c = heapCell[0]!;
    const d = heapDist[0]!;
    const lastCell = heapCell.pop()!;
    const lastDist = heapDist.pop()!;
    if (heapDist.length > 0) {
      heapCell[0] = lastCell;
      heapDist[0] = lastDist;
      down(0);
    }
    if (d > dist[c]!) continue;
    const cx = c % pavedSide;
    const cz = (c / pavedSide) | 0;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= pavedSide || nz >= pavedSide) continue;
        const n = nz * pavedSide + nx;
        if (!pavedCells[n]) continue;
        const step = (dx !== 0 && dz !== 0 ? Math.SQRT2 : 1) * PAVED_CELL;
        const nd = d + step;
        if (nd < dist[n]!) {
          dist[n] = nd;
          heapCell.push(n);
          heapDist.push(nd);
          up(heapDist.length - 1);
        }
      }
    }
  }
  return dist;
}

const pavedFields = new Map<number, Float64Array>();
/** Length of the shortest all-paved walk between two points, or Infinity. */
function pavedOnlyDistance(ax: number, az: number, bx: number, bz: number): number {
  const a = pavedCellAt(ax, az);
  const b = pavedCellAt(bx, bz);
  if (a < 0 || b < 0) return Infinity;
  let field = pavedFields.get(a);
  if (field === undefined) {
    field = pavedOnlyField(a);
    pavedFields.set(a, field);
  }
  return field[b] ?? Infinity;
}

// ------------------------------------------------------------- measurement

const out = new Float32Array(MAX_ROUTE_WAYPOINTS * 2);

/** How finely a route's length is walked when asking what it is standing on. */
const TRACE_STEP = 0.25;

interface Traced {
  /** Planar length of the smoothed walk, in metres. */
  readonly length: number;
  /** Metres of it spent on paving. */
  readonly paved: number;
  readonly waypoints: number;
  readonly reachedGoal: boolean;
}

/**
 * Walks the smoothed waypoints `findRoute` just wrote into {@link out} and
 * measures how much of the walk stands on paving.
 *
 * Shared by the player's grid and the children's planner, so the two can never
 * be measured by two slightly different rulers — the whole point of the "both
 * movers" probe below is that its number is comparable.
 */
function measure(count: number, ax: number, az: number, reachedGoal: boolean): Traced {
  let length = 0;
  let paved = 0;
  let px = ax;
  let pz = az;
  for (let i = 0; i < count; i += 1) {
    const wx = out[i * 2] ?? px;
    const wz = out[i * 2 + 1] ?? pz;
    const legLength = Math.hypot(wx - px, wz - pz);
    const steps = Math.max(1, Math.ceil(legLength / TRACE_STEP));
    const slice = legLength / steps;
    // Midpoint of each slice, so a slice is counted paved when most of it is.
    for (let s = 0; s < steps; s += 1) {
      const t = (s + 0.5) / steps;
      if (isOnPath(px + (wx - px) * t, pz + (wz - pz) * t)) paved += slice;
    }
    length += legLength;
    px = wx;
    pz = wz;
  }
  return { length, paved, waypoints: count, reachedGoal };
}

function trace(
  grid: NavGrid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): Traced {
  const ay = park.sample(ax, az, 0);
  const by = park.sample(bx, bz, 0);
  const count = grid.findRoute(ax, az, ay, bx, bz, by, park.sample, out);
  return measure(count, ax, az, grid.lastRouteReachedGoal);
}

const weightedRuns = probes.map((probe) => trace(weighted, probe.ax, probe.az, probe.bx, probe.bz));

// The children's own planner, on the same probes. A real `JourneyPlanner`,
// built exactly as `NpcSystem` builds one.
const planner = new JourneyPlanner(
  collision,
  park.sample,
  () => world.building.surfaces.connectors,
  bridgeCovers,
  gardenAttractions(park.sample),
);
const npcRuns = probes.map((probe) => {
  planner.beginFrame();
  const ay = park.sample(probe.ax, probe.az, 0);
  const by = park.sample(probe.bx, probe.bz, 0);
  const count = planner.plan(
    SPACE_GARDEN,
    probe.ax,
    probe.az,
    ay,
    probe.bx,
    probe.bz,
    by,
    out,
  );
  return measure(count, probe.ax, probe.az, true);
});

// --------------------------------------------- and the same park, unweighted
//
// A second lattice with the paving forgotten: the router exactly as it behaved
// before #416. Everything below is a *comparison*, which is the only honest way
// to say "reachability did not shrink" or "this route is not a detour".

// ------------------------------------------------- the short hop onto grass
//
// **The case Jim actually named**: *"too strong and she takes a comic detour to
// reach something two metres away across grass."* Every probe above has both
// ends on the paving, so none of them can catch it — a router that walked her
// fifteen metres up the path and back to reach a bench three metres off the
// kerb would sail through all of them. So: a destination a few metres out on
// the grass, started from the nearest paved point to it, which is the geometry
// of tapping the bench you are standing next to.

/** How far off the kerb "just across the grass" means. */
const HOP_MIN = 2;
const HOP_MAX = 6;

interface Hop {
  readonly label: string;
  readonly fromX: number;
  readonly fromZ: number;
  readonly toX: number;
  readonly toZ: number;
}

const hops: Hop[] = [];
{
  const centreline = pathCentreline();
  // A deterministic spread over the park, thinned so the probe set is a
  // handful of dozens rather than hundreds — every third lattice point.
  let seen = 0;
  for (let x = -GARDEN_PLAY_RADIUS; x <= GARDEN_PLAY_RADIUS; x += 3) {
    for (let z = -GARDEN_PLAY_RADIUS; z <= GARDEN_PLAY_RADIUS; z += 3) {
      if (Math.hypot(x, z) > GARDEN_PLAY_RADIUS - 4) continue;
      const off = distanceToPath(x, z);
      if (off < HOP_MIN || off > HOP_MAX) continue;
      seen += 1;
      if (seen % 3 !== 0) continue;
      let bestX = 0;
      let bestZ = 0;
      let best = Infinity;
      for (const sample of centreline) {
        const d = Math.hypot(sample.x - x, sample.z - z);
        if (d < best) {
          best = d;
          bestX = sample.x;
          bestZ = sample.z;
        }
      }
      hops.push({
        label: `kerb → (${x.toFixed(0)}, ${z.toFixed(0)}) ${off.toFixed(1)} m off`,
        fromX: bestX,
        fromZ: bestZ,
        toX: x,
        toZ: z,
      });
    }
  }
}

if (hops.length < 8) {
  console.error(
    `check:path-preference — only ${hops.length} points in the park sit ${HOP_MIN}–${HOP_MAX} m ` +
      'off the paving. That is not a park with grass in it; re-derive these probes.',
  );
  process.exit(1);
}

const weightedHops = hops.map((hop) => trace(weighted, hop.fromX, hop.fromZ, hop.toX, hop.toZ));

// Destinations for the reachability sweep are chosen *before* the paving is
// forgotten, because they are chosen from the park, not from the router.
const REACH_PITCH = 6;
const reachTargets: { x: number; z: number }[] = [];
for (let x = -GARDEN_PLAY_RADIUS; x <= GARDEN_PLAY_RADIUS; x += REACH_PITCH) {
  for (let z = -GARDEN_PLAY_RADIUS; z <= GARDEN_PLAY_RADIUS; z += REACH_PITCH) {
    if (Math.hypot(x, z) > GARDEN_PLAY_RADIUS - 2) continue;
    reachTargets.push({ x, z });
  }
}
const reachFrom = junctions[0]!;
const weightedReach = reachTargets.map((t) =>
  trace(weighted, reachFrom.x, reachFrom.z, t.x, t.z),
);

forgetPavingForTesting();
const unweighted = playerGrid();
const unweightedRuns = probes.map((probe) =>
  trace(unweighted, probe.ax, probe.az, probe.bx, probe.bz),
);
const unweightedReach = reachTargets.map((t) =>
  trace(unweighted, reachFrom.x, reachFrom.z, t.x, t.z),
);
const unweightedHops = hops.map((hop) => trace(unweighted, hop.fromX, hop.fromZ, hop.toX, hop.toZ));

// ------------------------------------------------------------- the findings

const fraction = (run: Traced | { length: number; paved: number }): number =>
  run.length > 0.01 ? run.paved / run.length : 1;

const weightedPaved = weightedRuns.map(fraction);
const unweightedPaved = unweightedRuns.map(fraction);
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

console.log(
  `— ${probes.length} junction-to-junction routes across the built park —`,
);
for (let i = 0; i < probes.length; i += 1) {
  const probe = probes[i]!;
  const w = weightedRuns[i]!;
  const u = unweightedRuns[i]!;
  table.push(
    `  ${probe.label.padEnd(34)} paved ${(weightedPaved[i]! * 100).toFixed(0).padStart(3)}% ` +
      `(was ${(unweightedPaved[i]! * 100).toFixed(0).padStart(3)}%)  ` +
      `${w.length.toFixed(1).padStart(6)} m (was ${u.length.toFixed(1)} m, ` +
      `${((w.length / Math.max(u.length, 0.01) - 1) * 100).toFixed(0)}%)`,
  );
}

/**
 * **Every probe must actually arrive.**
 *
 * `findRoute` reports whether it reached the goal, and until 31 August 2026
 * this file recorded that on all 100 probes and then never read it — the field
 * was asserted only on the reachability lattice below. A route that gave up
 * partway was measured and averaged exactly like one that arrived, and because
 * an abandoned route is short and starts on the spur it gave up from, **it
 * scored better than a real one**: `plaza → stall.facePaint`, whose ends are
 * 39.8 m apart, returned a single waypoint 3.2 m away and was counted as
 * **100% paved**.
 *
 * 22 of the 100 probes were in that state, six of them scoring a perfect 100%,
 * which lifted the headline mean from a true 79.5% to a reported 81.4%. This
 * is CLAUDE.md's "a check can pass without checking anything" exactly: the
 * fraction being averaged was not describing the thing the check claims to
 * measure. Asserting arrival can only ever make this check harder to pass.
 *
 * **What it then caught was a faulty sample, not a faulty router** (1 Sep
 * 2026). Every remaining failure was a probe *ending* at a junction whose own
 * lattice cell is blocked — a body cannot occupy it, so no route can finish
 * there and the unweighted router failed identically. The probe set is now
 * built from junctions the router itself calls standable (`standable`, above),
 * which is a fix to the sample and leaves this assertion at full strength:
 * every pair it is asked about is a pair that *can* be walked.
 */
const unreached = probes
  .map((probe, i) => ({ probe, w: weightedRuns[i]!, u: unweightedRuns[i]! }))
  .filter((r) => !r.w.reachedGoal || !r.u.reachedGoal);
for (const r of unreached) {
  const separation = Math.hypot(r.probe.ax - r.probe.bx, r.probe.az - r.probe.bz);
  table.push(
    `  never arrived: ${r.probe.label} — ${r.w.waypoints} waypoint(s), ` +
      `${r.w.length.toFixed(1)} m of walking between ends ${separation.toFixed(1)} m apart` +
      (r.u.reachedGoal ? '' : ' (the unweighted router does not arrive either)'),
  );
}
check(
  unreached.length === 0,
  `every probe arrives: all ${probes.length} junction-to-junction routes reached ` +
    `their goal${unreached.length > 0 ? `, but ${unreached.length} did not` : ''}`,
);

/**
 * **The pairs the paving is able to serve at all.**
 *
 * A pair is servable when an all-paved walk exists that costs no more than
 * {@link OFF_PATH_COST_MULTIPLIER} times the unweighted route — i.e. when the
 * router could have taken the paving without breaking the very bound the
 * `no comic detour` assertion enforces. The comparison is against the
 * unweighted route rather than the straight line because that is the walk the
 * router actually had the option of, obstacles included, and it is the
 * conservative choice: it excludes fewer pairs than a straight line would.
 *
 * On a non-servable pair, satisfying a paving floor and satisfying
 * {@link OFF_PATH_COST_MULTIPLIER} are **mutually exclusive**: the weighted A*
 * is optimal under its own cost function, so if it chose an unpaved route then
 * every paved alternative costs more than the multiplier times the direct one,
 * and the `no comic detour` assertion below positively *forbids* taking it.
 * Cutting the corner is the correct behaviour there, and a watching adult would
 * not ask why she went that way.
 */
const servable = probes.map((probe, i) => {
  const paved = pavedOnlyDistance(probe.ax, probe.az, probe.bx, probe.bz);
  const budget = OFF_PATH_COST_MULTIPLIER * unweightedRuns[i]!.length;
  return { paved, budget, ok: paved <= budget };
});
const servableCount = servable.filter((s) => s.ok).length;

for (let i = 0; i < probes.length; i += 1) {
  const s = servable[i]!;
  if (s.ok) continue;
  table.push(
    `  not servable by paving: ${probes[i]!.label} — the shortest all-paved walk is ` +
      `${Number.isFinite(s.paved) ? `${s.paved.toFixed(1)} m` : 'nonexistent'} against a ` +
      `${s.budget.toFixed(1)} m budget (${OFF_PATH_COST_MULTIPLIER}x the ` +
      `${(s.budget / OFF_PATH_COST_MULTIPLIER).toFixed(1)} m unweighted route)`,
  );
}

// ------------------------------------- the population every claim is made about
//
// **Arrived, and servable.** One population, so the two paving statements below
// cannot quietly be about two different sets of routes.
//
// - **Arrived**, because a route that gave up is not a route. Until 31 August
//   2026 the fraction was averaged over probes that never got there, and since
//   an abandoned route is short and starts on the spur it gave up from, it
//   *scored better than a real one* — six 1-waypoint stubs counted as 100%
//   paved, lifting the canonical mean from a true 79.5% to a reported 81.4%.
// - **Servable**, because on the other pairs a paving floor and
//   `OFF_PATH_COST_MULTIPLIER` cannot both be satisfied — see the comment on
//   `servable` above. Asserting a paving floor there would be asserting that
//   the router should do the thing `no comic detour` forbids.

interface Measured {
  readonly label: string;
  readonly w: number;
  readonly u: number;
}

const population: Measured[] = probes
  .map((probe, i) => ({
    label: probe.label,
    w: weightedPaved[i]!,
    u: unweightedPaved[i]!,
    arrived: weightedRuns[i]!.reachedGoal && unweightedRuns[i]!.reachedGoal,
    servable: servable[i]!.ok,
  }))
  .filter((r) => r.arrived && r.servable);

if (population.length < 8) {
  console.error(
    `check:path-preference — only ${population.length} of ${probes.length} probes both ` +
      `arrive and have a paved route inside ${OFF_PATH_COST_MULTIPLIER}x ` +
      `(${servableCount} servable, ${probes.length - unreached.length} arriving), which is ` +
      'too few to assert a distribution over. Either the paving or the multiplier ' +
      'has moved a long way; re-derive the probes rather than lowering the bar.',
  );
  process.exit(1);
}

const populationWeighted = population.map((r) => r.w);
const populationUnweighted = population.map((r) => r.u);

/**
 * **How much of a route is on paving, on average.**
 *
 * Not every metre can be: a junction is a point on a spur's *end*, and the
 * network does not join every pair of them directly, so a legitimate route
 * crosses grass between two spurs.
 *
 * **Derived, 1 September 2026** — measured on all five procgen seeds, over the
 * population above (arrived and servable). This replaces an earlier `0.75`
 * which had been read off the canonical park alone and **did not hold**: seed
 * 11 came in at 71.0% and seed 18 at 73.1%, so the old floor was green only
 * because nothing but the canonical seed was ever run through it.
 *
 * **Re-measured 1 September 2026** on `origin/main` with the hoppable-wall
 * cost in it, and over the standable-endpoint probe set (see `standable`):
 *
 * | seed | n | weighted mean | unweighted mean | margin over floor |
 * |---|---|---|---|---|
 * | canonical (20260728) | 82 | 83.4% | 55.4% | +13.4 |
 * | 5 | 50 | 81.5% | 52.9% | +11.5 |
 * | **11 (binding)** | 50 | **74.4%** | 47.6% | **+4.4** |
 * | 18 | 38 | 78.9% | 42.1% | +8.9 |
 * | 24 | 45 | 81.2% | 56.8% | +11.2 |
 *
 * Every seed moved by under a point and a half, and the binding seed and its
 * margin are unchanged (11, +4.3 → +4.4): **dropping the unstandable
 * endpoints did not buy this floor any headroom**, which is what you would
 * expect, since the probes it removed were ones that never arrived and were
 * therefore already outside this population.
 *
 * 70% is the highest round figure every seed clears, and it clears the best
 * **unweighted** mean (56.8%, seed 24) by **13.2 points** — that gap is what
 * makes this assertion able to fail, and `the bar is a real bar` below asserts
 * it rather than trusting this table.
 *
 * Seed 11 is the binding seed on every statement in this file; if a future
 * change moves the paving, that is the seed to measure first.
 */
const MEAN_PAVED_FLOOR = 0.7;

check(
  mean(populationWeighted) >= MEAN_PAVED_FLOOR,
  `routes stay on the paving: mean ${(mean(populationWeighted) * 100).toFixed(1)}% of route ` +
    `length is paved over the ${population.length} of ${probes.length} probes that arrive and ` +
    `the paving can serve within ${OFF_PATH_COST_MULTIPLIER}x ` +
    `(floor ${(MEAN_PAVED_FLOOR * 100).toFixed(0)}%; ` +
    `unweighted, the same routes manage ${(mean(populationUnweighted) * 100).toFixed(1)}%)`,
);

/**
 * **And the bad end of the distribution, so one heroic route cannot carry a
 * bad mean: at least 85% of routes are at least 60% paved.**
 *
 * Jim's own form of the rule, 1 September 2026: *"at least 90% should be at
 * least 60% on paths"*. He took 85 over his first 90 once the sweep came back —
 * see the margins below.
 *
 * **This replaces a `WORST_PAVED_FLOOR = 0.45`**, a bare constant with no
 * derivation recorded anywhere, which was red on three of the five seeds. Two
 * of those three failures were not even real: the worst-route loop skipped
 * non-servable probes but not *abandoned* ones, so seed 11's reported 29.9% and
 * seed 18's 27.1% were routes that never arrived being scored. A single worst
 * case is also the wrong instrument for this — it hands the whole assertion to
 * one pair of junctions, and the park regenerates on every seed.
 *
 * **Derived, 1 September 2026** — measured on all five seeds, over the
 * population above:
 *
 * **Re-measured 1 September 2026** on `origin/main` with the hoppable-wall
 * cost in it, and over the standable-endpoint probe set (see `standable`):
 *
 * | seed | n | weighted ≥60% | unweighted ≥60% | margin over 85% |
 * |---|---|---|---|---|
 * | canonical (20260728) | 82 | 79/82 = **96.3%** | 34/82 = 41.5% | +11.3 |
 * | **5 (binding)** | 50 | 47/50 = **94.0%** | 14/50 = 28.0% | **+9.0** |
 * | **11 (binding)** | 50 | 47/50 = **94.0%** | 11/50 = 22.0% | **+9.0** |
 * | 18 | 38 | 36/38 = **94.7%** | 5/38 = 13.2% | +9.7 |
 * | 24 | 45 | 43/45 = **95.6%** | 21/45 = 46.7% | +10.6 |
 *
 * At Jim's original 90% the binding margin was **+1.8**, under one probe's
 * worth. 85% keeps three or four probes of headroom on the binding seed and
 * keeps a 48-point separation from the unweighted router at its best.
 *
 * **The percentages are coarse, and deliberately quoted as counts too.** The
 * populations are 38–82 probes, so seed 18's share moves in **2.6-point steps**
 * — 85 and 86 are the same rule there, and so are 87 and 88. Do not read a
 * one-point change of this constant as a one-point change of strictness.
 *
 * The `60%` half of the rule is Jim's, and it is also where the two routers
 * separate most cleanly: the unweighted router puts only 13.2–46.7% of its
 * routes over that line on any seed.
 */
const PAVED_FLOOR = 0.6;
/** …and the share of routes that must clear {@link PAVED_FLOOR}. */
const PAVED_SHARE = 0.85;

const overFloor = populationWeighted.filter((v) => v >= PAVED_FLOOR).length;
const share = overFloor / population.length;

for (const r of population) {
  if (r.w >= PAVED_FLOOR) continue;
  table.push(
    `  under the floor: ${r.label.padEnd(34)} paved ${(r.w * 100).toFixed(1)}% ` +
      `(unweighted ${(r.u * 100).toFixed(1)}%)`,
  );
}

check(
  share >= PAVED_SHARE,
  `most routes are mostly paved: ${overFloor} of ${population.length} routes ` +
    `(${(share * 100).toFixed(1)}%) are at least ${(PAVED_FLOOR * 100).toFixed(0)}% paved, ` +
    `bar ${(PAVED_SHARE * 100).toFixed(0)}% (over the probes that arrive and the paving can ` +
    `serve within ${OFF_PATH_COST_MULTIPLIER}x, of ${probes.length} probes in all)`,
);

/**
 * **The same bar, put to the router this feature replaced — it must fail.**
 *
 * This is the mutation test, run on every invocation rather than written down
 * in a comment that goes stale. `unweightedRuns` came from a second lattice
 * built with the paving forgotten, i.e. `NavGrid` exactly as it behaved before
 * issue #416, so if `OFF_PATH_COST_MULTIPLIER` were reverted to 1 the two
 * columns would coincide and **this assertion would fail before the one above
 * did**. A bar the unweighted router also clears is a bar that proves nothing
 * about the feature — which is precisely how the old `MEAN_PAVED_FLOOR = 0.75`
 * was justified, and it is worth asserting rather than asserting in prose.
 *
 * Measured margin on the five seeds (1 September 2026, on `origin/main` with
 * the hoppable-wall cost, over the standable-endpoint probe set): the
 * unweighted router clears the 60% floor on 13.2–46.7% of routes against an
 * 85% bar, so it fails by **38.3 to 71.8 points**. There is no seed on which
 * this is close.
 */
const unweightedOverFloor = populationUnweighted.filter((v) => v >= PAVED_FLOOR).length;
const unweightedShare = unweightedOverFloor / population.length;

check(
  unweightedShare < PAVED_SHARE,
  `the bar is a real bar: the unweighted router — the same park with the paving ` +
    `forgotten — gets only ${unweightedOverFloor} of ${population.length} routes ` +
    `(${(unweightedShare * 100).toFixed(1)}%) over the ${(PAVED_FLOOR * 100).toFixed(0)}% ` +
    `floor, failing the ${(PAVED_SHARE * 100).toFixed(0)}% bar by ` +
    `${((PAVED_SHARE - unweightedShare) * 100).toFixed(1)} points`,
);

/**
 * The arithmetic bound on eccentricity — see this file's header. `1.08` is
 * `SMOOTH_CORNER_TOLERANCE` from `NavGrid`, the only slack the smoother is
 * allowed, and it is written as a product rather than as a single number so
 * that changing either constant moves this bar with it instead of leaving a
 * stale one behind.
 */
const DETOUR_CEILING = OFF_PATH_COST_MULTIPLIER * 1.08;
let longest = 0;
let longestLabel = '';
for (let i = 0; i < probes.length; i += 1) {
  const ratio = weightedRuns[i]!.length / Math.max(unweightedRuns[i]!.length, 0.01);
  if (ratio > longest) {
    longest = ratio;
    longestLabel = probes[i]!.label;
  }
}
check(
  longest <= DETOUR_CEILING,
  `no comic detour: the worst route is ${((longest - 1) * 100).toFixed(1)}% longer than ` +
    `the direct one (${longestLabel}), ceiling ${((DETOUR_CEILING - 1) * 100).toFixed(0)}%`,
);

// The short hop onto the grass — the case Jim named. Same ceiling, because it
// is the same arithmetic; reported separately because it is the one an adult
// watching over her shoulder would notice first.
let worstHop = 0;
let worstHopLabel = '';
let hopExtra = 0;
for (let i = 0; i < hops.length; i += 1) {
  const w = weightedHops[i]!;
  const u = unweightedHops[i]!;
  hopExtra += w.length - u.length;
  const ratio = w.length / Math.max(u.length, 0.01);
  if (ratio > worstHop) {
    worstHop = ratio;
    worstHopLabel = hops[i]!.label;
  }
}
check(
  worstHop <= DETOUR_CEILING,
  `stepping off the kerb stays a step: across ${hops.length} destinations ${HOP_MIN}–${HOP_MAX} m ` +
    `out on the grass the walk grew by ${(hopExtra / hops.length).toFixed(2)} m on average, ` +
    `worst ${((worstHop - 1) * 100).toFixed(1)}% (${worstHopLabel}), ceiling ` +
    `${((DETOUR_CEILING - 1) * 100).toFixed(0)}%`,
);

// Reachability: a preference, not a wall.
let lost = 0;
let lostExample = '';
for (let i = 0; i < reachTargets.length; i += 1) {
  if (unweightedReach[i]!.reachedGoal && !weightedReach[i]!.reachedGoal) {
    lost += 1;
    if (!lostExample) {
      const t = reachTargets[i]!;
      lostExample = `(${t.x.toFixed(0)}, ${t.z.toFixed(0)})`;
    }
  }
}
check(
  lost === 0,
  `reachability did not shrink: of ${reachTargets.length} destinations across the park, ` +
    `${unweightedReach.filter((r) => r.reachedGoal).length} were reachable unweighted and ` +
    `${weightedReach.filter((r) => r.reachedGoal).length} are reachable weighted` +
    `${lost > 0 ? ` — lost ${lost}, first at ${lostExample}` : ''}`,
);

// Both movers, one penalty.
let widestDisagreement = 0;
let disagreementLabel = '';
for (let i = 0; i < probes.length; i += 1) {
  const gap = Math.abs(fraction(npcRuns[i]!) - weightedPaved[i]!);
  if (gap > widestDisagreement) {
    widestDisagreement = gap;
    disagreementLabel = probes[i]!.label;
  }
}
check(
  widestDisagreement < 0.001,
  `the children route exactly as the player does: worst disagreement in paved fraction ` +
    `${(widestDisagreement * 100).toFixed(3)}% (${disagreementLabel || 'none'})`,
);

// ------------------------------------------------------------------- report

if (verbose || failures.length > 0) for (const line of table) console.log(line);

if (failures.length > 0) {
  console.error(`\ncheck:path-preference — ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(
  `\ncheck:path-preference — all green (mean ${(mean(populationWeighted) * 100).toFixed(1)}% paved ` +
    `over ${population.length} routes, was ${(mean(populationUnweighted) * 100).toFixed(1)}%; ` +
    `${overFloor} of them — ${(share * 100).toFixed(1)}% — at least ` +
    `${(PAVED_FLOOR * 100).toFixed(0)}% paved)`,
);
