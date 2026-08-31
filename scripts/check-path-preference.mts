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
 *    network — the network's own nodes, never coordinates typed in here — a
 *    route must spend most of its length on paving. Proven red by mutation; see
 *    the transcript at the foot of this comment.
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
 * With `OFF_PATH_COST_MULTIPLIER` set to 1 in `src/world/paving.ts` — i.e. the
 * behaviour before this issue — this check fails; the transcript is in the PR
 * for #416. It also fails with the multiplier left alone but the smoother's
 * weighted-chord test reverted to a bare walkability test, which is the subtler
 * of the two ways to ship this feature inert.
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

const junctions = PATH_GRAPH.nodes
  .filter((node) => isOnPath(node.x, node.z))
  .slice()
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

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

if (probes.length < 8) {
  console.error(
    `check:path-preference — only ${probes.length} junction pairs in the solved ` +
      'network are far enough apart to route between. The network has changed ' +
      'shape; re-derive the probes rather than lowering the bar.',
  );
  process.exit(1);
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

// The weighted router — the one the game runs.
const weighted = playerGrid();
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
 * How much of a junction-to-junction route must be on paving, on average.
 *
 * Not every metre can be: a junction is a point on a spur's *end*, and the
 * network does not join every pair of them directly, so a legitimate route
 * crosses grass between two spurs. Measured on the canonical park the weighted
 * router manages far more than this; the bar is set where an unweighted router
 * cannot reach it, which is what makes the check able to fail.
 */
const MEAN_PAVED_FLOOR = 0.75;

check(
  mean(weightedPaved) >= MEAN_PAVED_FLOOR,
  `routes stay on the paving: mean ${(mean(weightedPaved) * 100).toFixed(1)}% of route ` +
    `length is paved (floor ${(MEAN_PAVED_FLOOR * 100).toFixed(0)}%; ` +
    `unweighted, the same routes manage ${(mean(unweightedPaved) * 100).toFixed(1)}%)`,
);

/** Every probe individually, so one heroic route cannot carry a bad mean. */
const WORST_PAVED_FLOOR = 0.45;
let worst = 1;
let worstLabel = '';
for (let i = 0; i < probes.length; i += 1) {
  if (weightedPaved[i]! < worst) {
    worst = weightedPaved[i]!;
    worstLabel = probes[i]!.label;
  }
}
check(
  worst >= WORST_PAVED_FLOOR,
  `even the worst route uses the paving: ${(worst * 100).toFixed(1)}% on ${worstLabel} ` +
    `(floor ${(WORST_PAVED_FLOOR * 100).toFixed(0)}%)`,
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
  `\ncheck:path-preference — all green (mean ${(mean(weightedPaved) * 100).toFixed(1)}% paved, ` +
    `was ${(mean(unweightedPaved) * 100).toFixed(1)}%)`,
);
