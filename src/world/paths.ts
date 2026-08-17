import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { PLAYER_RADIUS } from '../core/constants';
import { PALETTE } from '../core/palette';
import { pathTexture } from '../core/textures';
import { terrainHeight, terrainNormal } from './terrain';
import { ANCHORS } from './anchors';
import { PARK_LAYOUT, edgeDistanceAlong } from './parkLayout';
import { PARK_BOUNDARY } from './boundary';
import { TRAIN_PLAN } from './train/plan';
import { COASTER_PLANS } from './coaster/plan';
import { RAIL_RACE_PLAN } from './railRace/plan';
import { archFeet } from './railRace/arch';
import { SLIDE_PLAN } from './slide/plan';
import { FERRIS_WHEEL_EXIT } from '../minigames/ferrisWheel/exit';
import { STALL_STANDS } from '../minigames/stallPlacement';

/**
 * The winding path network.
 *
 * Paths are ribbons extruded along Catmull–Rom curves and draped over the
 * terrain, rather than a texture painted on the ground: that way they follow the
 * hills exactly and the cream edging reads as a real kerb from the iso camera.
 *
 * Routes are **generated from the solved layout** (Decision 5): a ring road
 * grown around wherever the plaza landed, squeezed between the plots the
 * solver placed; a spur to every anchor's entrance; and the approach from the
 * park gate. Nothing below is authored — move the manifest and the network
 * re-grows, with `check:park` proving every attraction is still reachable.
 */

export interface RouteDefinition {
  readonly name: string;
  readonly points: readonly (readonly [number, number])[];
  readonly width: number;
  readonly closed: boolean;
}

/**
 * **Test hook: re-route one named spur, so its paving covers different lawn.**
 *
 * `LGP_SPUR_STRETCH=2 npm run test:procgen` builds a park in which the rail
 * race stall's spur alone takes a two-metre detour, and nothing else differs
 * at all. `LGP_SPUR_STRETCH_ID` picks a different spur. Both are zero/default —
 * and so the park is exactly the shipped one — unless the variables are set.
 * Node-only, read once at module load, exactly like `parkManifest.ts`'s
 * `LGP_SEED`: Vite ships no `process`, so neither can reach a player.
 *
 * The name says "stretch" and the detour does add paving between the two fixed
 * endpoints, but do not read the number as a length: bowing this spur also
 * changes where *later* spurs find their nearest branch point, so the park's
 * total paved metres can come out either side of the baseline (at 2 m it drops,
 * 329.51 -> 324.45). What it reliably changes is **which lawn is paved**, and
 * that is the input the scatter actually reacts to.
 *
 * It exists because "a longer path must not move distant scenery" is otherwise
 * an unprovable claim. That property was broken for months and nothing noticed,
 * because measuring it needs **two parks differing in exactly one way**, which
 * no ordinary input provides. `test/procgen/scatterDecoupling.test.ts` builds
 * both and compares digests of the real scatter; without this hook it would
 * have to model a park instead, and a check against a model only ever proves
 * the model.
 *
 * One spur rather than all of them, deliberately: the property worth proving is
 * *locality* — that a change here leaves scenery over there alone — and
 * perturbing every spur at once would disturb the whole lawn and prove nothing
 * about distance. It also mirrors the real case, a single booth being moved.
 *
 * ### It bows the spur sideways, and that shape was chosen the hard way
 *
 * Both endpoints stay exactly where they were; the ribbon takes a detour
 * between them. So the *only* thing that differs between the two parks is how
 * much lawn is paved and where — not the booth, not its doormat, not the plot.
 *
 * The first attempt instead carried the ribbon a few metres further *back* from
 * its branch point. That is also "a longer spur", it moved the paved-metres
 * total by exactly the amount asked for, and it was **worthless as a test**: the
 * branch point sits on the existing network, so the extra paving landed on
 * ground that was already paved, `isOnPath` answered the same everywhere, and
 * not one candidate changed. Measured on `origin/main` — which still has the
 * bug — at 1, 2, 3, 4, 6, 8, 10, 14, 18 and 24 m, the scatter digest never
 * budged once. A perturbation that cannot break the broken version cannot
 * validate the fixed one.
 */
const SPUR_STRETCH = numberFromEnv('LGP_SPUR_STRETCH');
const SPUR_STRETCH_ID = stringFromEnv('LGP_SPUR_STRETCH_ID') ?? 'stall.railRacer';

function stringFromEnv(name: string): string | null {
  try {
    const nodeProcess = (globalThis as { process?: { env?: Record<string, string> } }).process;
    return nodeProcess?.env?.[name] ?? null;
  } catch {
    return null;
  }
}

function numberFromEnv(name: string): number {
  const raw = stringFromEnv(name);
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Fountain plaza — wherever the layout put it. Paths converge here. */
export const PLAZA = {
  x: PARK_LAYOUT.fountain.x,
  z: PARK_LAYOUT.fountain.z,
  radius: PARK_LAYOUT.fountain.radius,
};

// ------------------------------------------------------------ generation

/** Everything the ring road and the spurs must steer around. */
interface Blocker {
  readonly x: number;
  readonly z: number;
  readonly radius: number; // bounding circle, already inflated for kerbs
}

/**
 * How much room to leave round a rail-race arch foot: the post itself, plus
 * the width a child genuinely needs to walk past it, plus half the widest
 * ribbon this file draws (so the *paved edge*, not just the centreline, clears
 * the post).
 *
 * `PLAYER_RADIUS * 2` is `test/procgen/invariants.ts`'s `WALKABLE_GAP` — the
 * same number, taken from the game rather than from the check, because
 * `NavGrid` fattens every collider by a player radius before deciding a cell is
 * walkable. A margin narrower than this is a gap only on paper.
 *
 * The ribbon term is new (issue #269 QA, seed 5): `BLOCKERS` only ever kept
 * the route's *centreline* this far from a foot's own tiny post radius
 * (0.11 m); a diagonal route's centreline rarely lingered anywhere near that
 * minimum, so the plain margin above was never actually tested against a
 * ribbon's real paved width. An axis-aligned leg can hold its minimum
 * clearance in a straight line for metres, and did — `finishRainbowStandsOnTheGround`
 * measured a leg only 1.05 m from a path edge (needs `WALKABLE_GAP`, 1.24 m)
 * on seed 5, because the centreline sat at exactly the old margin while the
 * ring road's own half-width plus kerb (3.6 / 2 + 0.85 = 2.65 m) ate into it
 * from there. `RIBBON_HALF_WIDTH_CEILING` is the largest half-width plus kerb
 * any route in {@link ROUTES}/{@link solveRing} is ever built with.
 */
const RIBBON_HALF_WIDTH_CEILING = 3.6 / 2 + 0.85;
const ARCH_FOOT_MARGIN = PLAYER_RADIUS * 2 + 0.4 + RIBBON_HALF_WIDTH_CEILING;

/**
 * Everything the ring road and the spurs must steer around: every plot, and
 * the feet of the Rail Race's finish rainbow.
 *
 * **The arch is in this list because it cannot move and the paving can.** Its
 * radius is solved from rider head height and lane span, and its position is
 * the ride's own finish line — the datum the duck bars, the spark zones and
 * `RACE_DISTANCE` are all measured from, so nudging it would decouple the drawn
 * finish from the scored one. Meanwhile nothing told the paving it was there:
 * on seeds 5 and 11 twelve legs came down between 1.14 m *inside* the path and
 * 0.40 m from its edge. Decision 6's rule settles which one gives way — the
 * ride publishes what it solved (`railRace/arch.ts`), and the walk network
 * treats it as an obstacle exactly as it does a plot.
 *
 * Both rings' feet, even though only the race ring actually builds a visible
 * arch (see `RailRaceTrackOptions.showArch`, #299) — `archFeet` is a pure
 * function of a route, computed the same way whether or not `track.ts`
 * chooses to draw a rainbow there, and this file runs at module load, long
 * before any ring's visibility is decided at runtime. Keeping both rings'
 * footprints out of the paving costs nothing and means the walk-past ring's
 * feet stay excluded even if a future change makes it draw one again.
 */
const BLOCKERS: readonly Blocker[] = [
  ...[...PARK_LAYOUT.entries.values()]
    .filter((e) => e.id !== 'fountain')
    .map((e) => ({ x: e.x, z: e.z, radius: e.boundingRadius + 2.2 })),
  ...[RAIL_RACE_PLAN.walkPastRing, RAIL_RACE_PLAN.raceRing]
    .flatMap((ring) => archFeet(ring))
    .map((foot) => ({ x: foot.x, z: foot.z, radius: foot.radius + ARCH_FOOT_MARGIN })),
];

/** Distance from `(px,pz)` along unit `(dx,dz)` to `blocker`, or Infinity. */
function rayToBlocker(px: number, pz: number, dx: number, dz: number, b: Blocker): number {
  const ex = b.x - px;
  const ez = b.z - pz;
  const proj = ex * dx + ez * dz;
  if (proj <= 0) return Infinity;
  const perp2 = ex * ex + ez * ez - proj * proj;
  const r2 = b.radius * b.radius;
  if (perp2 >= r2) return Infinity;
  return proj - Math.sqrt(r2 - perp2);
}

/**
 * The ring road: a radius-per-bearing profile around the plaza, held off
 * every plot and relaxed smooth — the same shape of solve as the train
 * loop's (`train/route.ts`), two sizes smaller.
 */
function solveRing(): (readonly [number, number])[] {
  const bearings = 32;
  const low = PLAZA.radius + 4.5;
  const highCap = 30;
  const profile: number[] = [];
  for (let i = 0; i < bearings; i += 1) {
    const angle = (i / bearings) * TAU_PATH;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    let high = highCap;
    for (const b of BLOCKERS) high = Math.min(high, rayToBlocker(PLAZA.x, PLAZA.z, dx, dz, b));
    profile.push(Math.max(low, Math.min(high - 1.2, low + 0.62 * (high - low))));
  }
  // Laplacian relax, re-clamped each pass so smoothing never re-enters a plot.
  for (let pass = 0; pass < 60; pass += 1) {
    for (let i = 0; i < bearings; i += 1) {
      const prev = profile[(i + bearings - 1) % bearings] as number;
      const next = profile[(i + 1) % bearings] as number;
      const angle = (i / bearings) * TAU_PATH;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      let high = highCap;
      for (const b of BLOCKERS) high = Math.min(high, rayToBlocker(PLAZA.x, PLAZA.z, dx, dz, b));
      const target = (prev + next) / 2;
      profile[i] = Math.max(low, Math.min(high - 1.2, ((profile[i] as number) + target) / 2));
    }
  }
  const points: (readonly [number, number])[] = [];
  // Every bearing becomes a control point: the ribbon's spline interpolates
  // between them, and with 11-degree gaps it bulged into plot circles the
  // profile itself had correctly avoided.
  for (let i = 0; i < bearings; i += 1) {
    const angle = (i / bearings) * TAU_PATH;
    points.push([
      PLAZA.x + Math.cos(angle) * (profile[i] as number),
      PLAZA.z + Math.sin(angle) * (profile[i] as number),
    ]);
  }
  // The profile above still says "how far out, at this bearing" — a circle.
  // issue #269 wants the *drawn* loop on grid axes, so the last step turns
  // those 32 bearing samples into a closed axis-aligned polygon rather than
  // tracing straight (generally diagonal) lines between them.
  return toAxisAlignedLoop(points);
}

const TAU_PATH = Math.PI * 2;

/**
 * Extra clearance an axis-aligned corner or leg keeps beyond a blocker's own
 * already-inflated radius in {@link BLOCKERS}.
 *
 * The old diagonal router (`detourAroundBlockers`, unchanged below) used no
 * pad at all, and it did not need one: a smooth curve only grazes its
 * minimum clearance for an instant. An axis-aligned leg can hold that same
 * minimum clearance in a dead straight line for many metres, which is
 * exactly what squeezed a scenery waypoint's own "is there 2.2 m of clear
 * ground here" search out of existence next to one long, perfectly flat
 * run (issue #269 QA). A small pad here keeps every axis-aligned run
 * genuinely, not just nominally, clear.
 */
const ROUTE_WALKER_PAD = 0.6;

/** True if the straight segment (ax,az)-(bx,bz) stays clear of every blocker
 * by at least `pad` metres — same closest-approach test as `rayToBlocker`,
 * bounded to the segment rather than an infinite ray. */
function segmentClearOfBlockers(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  pad: number,
  blockers: readonly Blocker[] = BLOCKERS,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  for (const blocker of blockers) {
    // A segment ending inside a blocker is arriving at a destination — every
    // spur's last metres run into a plot mouth — so only the segment's
    // *approach* is asked about, never whether it ends inside one.
    const t =
      lengthSq > 1e-9
        ? Math.max(0, Math.min(1, ((blocker.x - ax) * dx + (blocker.z - az) * dz) / lengthSq))
        : 0;
    if (t >= 1 - 1e-9 && Math.hypot(blocker.x - bx, blocker.z - bz) < blocker.radius) continue;
    const cx = ax + dx * t;
    const cz = az + dz * t;
    if (Math.hypot(blocker.x - cx, blocker.z - cz) < blocker.radius + pad) return false;
  }
  return true;
}

/**
 * True if every point along the segment stays genuinely inside the park's
 * own spline edge.
 *
 * Deliberately **not** `parkManifest.ts`'s `BOUNDARY_CLEARANCE` (2.5 m) — that is the
 * margin a whole *plot* keeps, and several plots (the rail-race stall's
 * `nearEdge` band puts its booth as little as 2 m from the wall on
 * purpose) stand closer to the edge than that, so a path serving them has
 * to as well. `PLAYER_RADIUS` is what a walker's own body actually needs.
 *
 * `detourAroundBlockers`'s diagonal never needed this test: it only ever
 * runs between two points already inside the park, drifting gently from one
 * to the other. An axis-aligned corner is not so mild — it can park a
 * straight run right along the boundary for many metres if nothing else
 * told it not to, which is exactly what stranded a hotel-side waypoint
 * against the gate corridor's own wall (issue #269 QA). Sampled every 5 m
 * rather than tested only at the endpoints, because that plateau's danger
 * was in its *middle*, not at either corner.
 */
function segmentClearOfBoundary(ax: number, az: number, bx: number, bz: number): boolean {
  const length = Math.hypot(bx - ax, bz - az);
  const samples = Math.max(1, Math.ceil(length / 5));
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    if (PARK_BOUNDARY.distanceToEdge(x, z) < PLAYER_RADIUS) return false;
  }
  return true;
}

/** Combines {@link segmentClearOfBlockers} and {@link segmentClearOfBoundary}
 * — every axis-aligned candidate leg has to satisfy both. */
function segmentIsWalkable(ax: number, az: number, bx: number, bz: number, pad: number): boolean {
  return segmentClearOfBlockers(ax, az, bx, bz, pad) && segmentClearOfBoundary(ax, az, bx, bz);
}

/**
 * Straight line from `from` to `to`, detouring around any blocker it clips:
 * the offending circle contributes a tangent-side waypoint, repeatedly,
 * until the polyline is clear. This is `paths.ts`'s original router
 * (formerly `routeAround`, issue #241/#114-era) — proven, on every seed, to
 * reliably connect any two valid park points around the plots between them —
 * kept unchanged as the first pass so axis-aligning its output (below) never
 * has to re-solve "can these two points be connected at all," only "can the
 * already-proven connection be bent onto grid axes."
 */
function detourAroundBlockers(
  from: readonly [number, number],
  to: readonly [number, number],
): (readonly [number, number])[] {
  const points: [number, number][] = [[from[0], from[1]], [to[0], to[1]]];
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (let i = 0; i < points.length - 1 && !changed; i += 1) {
      const a = points[i] as [number, number];
      const b = points[i + 1] as [number, number];
      const abx = b[0] - a[0];
      const abz = b[1] - a[1];
      const length = Math.hypot(abx, abz);
      if (length < 1e-6) continue;
      const dx = abx / length;
      const dz = abz / length;
      for (const blocker of BLOCKERS) {
        // A segment ending inside the circle is arriving at a destination —
        // every spur's last metres run into a plot mouth. Detouring that
        // blocker would splice the same escape point forever (measured:
        // seven copies of one point). Only the *far* endpoint can be inside
        // a blocker: starts are junction points, kept outside every circle
        // by `bestBranchPoint`.
        if (Math.hypot(blocker.x - b[0], blocker.z - b[1]) < blocker.radius) continue;
        const t = Math.max(0, Math.min(length, (blocker.x - a[0]) * dx + (blocker.z - a[1]) * dz));
        const cx = a[0] + dx * t;
        const cz = a[1] + dz * t;
        const distance = Math.hypot(blocker.x - cx, blocker.z - cz);
        if (distance >= blocker.radius) continue;
        // Step out of the circle, on the side the segment already favours.
        const sideX = distance > 1e-6 ? (cx - blocker.x) / distance : -dz;
        const sideZ = distance > 1e-6 ? (cz - blocker.z) / distance : dx;
        const out = blocker.radius + 1.6;
        points.splice(i + 1, 0, [blocker.x + sideX * out, blocker.z + sideZ * out]);
        changed = true;
        break;
      }
    }
    if (!changed) break;
  }
  // Collapse any near-identical neighbours: a zero-length Catmull-Rom
  // segment is a NaN tangent waiting for the ribbon extruder.
  const clean: [number, number][] = [];
  for (const point of points) {
    const last = clean[clean.length - 1];
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 0.4) continue;
    clean.push(point);
  }
  if (clean.length < 2) clean.push([to[0], to[1]]);
  return clean;
}

/**
 * Turns one already-clear leg `a` -> `b` into one or two axis-aligned legs
 * (issue #269): an "L" via whichever of the two right-angle corners keeps
 * both new legs clear of every blocker. `detourAroundBlockers` already
 * proved the direct `a`-`b` line clear, so a corner failing is the corner
 * cutting through a blocker that line happened to miss — rare, and handled
 * by nudging the corner outward, in fixed steps, until it clears or the
 * search gives up and falls back to the direct (diagonal) leg rather than
 * failing the whole build.
 */
function elbowLeg(a: readonly [number, number], b: readonly [number, number]): (readonly [number, number])[] {
  if (Math.abs(a[0] - b[0]) < 1e-6 || Math.abs(a[1] - b[1]) < 1e-6) return [b]; // already axis-aligned
  const cornerX: readonly [number, number] = [b[0], a[1]]; // horizontal, then vertical
  const cornerZ: readonly [number, number] = [a[0], b[1]]; // vertical, then horizontal
  const clearVia = (corner: readonly [number, number]): boolean =>
    segmentIsWalkable(a[0], a[1], corner[0], corner[1], ROUTE_WALKER_PAD) &&
    segmentIsWalkable(corner[0], corner[1], b[0], b[1], ROUTE_WALKER_PAD);
  const okX = clearVia(cornerX);
  const okZ = clearVia(cornerZ);
  if (okX && !okZ) return [cornerX, b];
  if (okZ && !okX) return [cornerZ, b];
  if (okX && okZ) {
    // Both clear: correct whichever axis moves *less* over this one leg
    // first, then run the dominant axis the rest of the way. This is a
    // purely local choice — every leg decides from its own two endpoints,
    // never from where an *earlier* leg's corner landed.
    //
    // A global rule ("prefer whichever corner sits further from the
    // plaza") was tried first and chained: `detourAroundBlockers` had
    // already bulged the original diagonal a little north to clear one
    // obstacle, four short legs in a row each independently chose the
    // *more northward* of their own two corners, and the result was one
    // 40 m dead-flat plateau sitting at the single most extreme point of
    // what used to be a brief bulge — long enough that it stranded a
    // waypoint on the far side (issue #269 QA). Correcting the small axis
    // per leg keeps each corner near where that leg's own endpoints
    // already were, so the axis-aligned route tracks the shape of the
    // proven diagonal it was built from, instead of drifting away from it.
    const dx = Math.abs(b[0] - a[0]);
    const dz = Math.abs(b[1] - a[1]);
    return [dz <= dx ? cornerZ : cornerX, b];
  }
  // Neither raw right-angle corner is clear: something sits off the direct
  // a-b diagonal (which `detourAroundBlockers` already proved clear) but
  // inside both of the L-shapes' bounding boxes — a blocker in the "wedge"
  // between the diagonal and a corner. A single extra corner (a "Z") is not
  // guaranteed to have room either — two blockers deliberately placed close
  // together (`near` relations exist for exactly this) can need a proper
  // multi-turn staircase to get round both. `gridDetour` finds one by
  // search rather than by guessing a shape, and only ever runs here: the
  // common case above resolves in two clearance tests, so this is rare
  // enough that a small grid search costs nothing measurable.
  return gridDetour(a, b);
}

/**
 * Rare-path fallback for {@link elbowLeg}: an axis-aligned route from `a` to
 * `b` found by a bounded grid search, for the "two blockers in the way"
 * cases a single corner or a single Z cannot get around. Unlike
 * `manhattanRoute`'s first, abandoned design (issue #269 QA), this is not
 * asked to run on every leg of every route — only when the cheap two-corner
 * check above has already failed — so quantizing `a`/`b` onto the grid via
 * their touching corners, screened by a real connector segment each, is
 * affordable here where it was a 100x solver regression as the general case.
 */
/**
 * Search reaches tried in order, widening until one finds a route.
 *
 * A single fixed reach was tried first (45 m) and was not enough: seed 5's
 * sky-cruiser stall (tucked in the castle's tight west pocket) needed it
 * widened from an original 30 m to clear, and seed 18's ball-pit spur then
 * needed more still — a squeeze between two `near`-related plots can be
 * arbitrarily tight depending on where the solver happened to land them, so
 * there is no one constant that is "enough" for every seed. Widening on
 * failure, rather than picking one large number up front, keeps the common
 * case (a small search, resolved in microseconds) cheap and only pays for a
 * bigger one when the smaller one actually failed.
 */
const GRID_DETOUR_REACHES: readonly number[] = [45, 90, 160];

function gridDetour(a: readonly [number, number], b: readonly [number, number]): (readonly [number, number])[] {
  for (const reach of GRID_DETOUR_REACHES) {
    const found = gridDetourAttempt(a, b, reach);
    if (found) return found;
  }
  // Every reach failed: the direct diagonal is the one leg
  // `detourAroundBlockers` already proved clear, so this keeps the route
  // connected rather than failing the build. `test/procgen/invariants.ts`'s
  // axis-alignment check measures how often this actually fires.
  return [b];
}

/** One `gridDetour` search at a given `reach`, or `null` if it finds nothing. */
function gridDetourAttempt(
  a: readonly [number, number],
  b: readonly [number, number],
  reach: number,
): (readonly [number, number])[] | null {
  const step = 2;
  const toWorld = (g: number) => g * step;

  // `a` or `b` can genuinely sit *inside* a blocker's circle — arriving at a
  // destination, exactly as `detourAroundBlockers`'s own "only the far
  // endpoint may be inside a blocker" rule allows (seed 18's ball-pit spur:
  // its own intermediate waypoint sits 17.3 m from the castle's centre,
  // inside its 21.5 m radius). `segmentClearOfBlockers`'s endpoint exemption
  // covers the *direct* connector into that point, but a grid search still
  // has to walk actual cells to reach it — and every cell approaching an
  // embedded point is, correctly, inside the same blocker too. So any
  // blocker that already contains `a` or `b` is dropped from this search
  // entirely, not just exempted at the one point touching it: the search
  // would otherwise have a walkable goal with no walkable way to reach it.
  const localBlockers = BLOCKERS.filter(
    (blocker) =>
      Math.hypot(a[0] - blocker.x, a[1] - blocker.z) >= blocker.radius &&
      Math.hypot(b[0] - blocker.x, b[1] - blocker.z) >= blocker.radius,
  );
  const walkable = (ax: number, az: number, bx: number, bz: number, pad: number): boolean =>
    segmentClearOfBlockers(ax, az, bx, bz, pad, localBlockers) && segmentClearOfBoundary(ax, az, bx, bz);

  const touching = (p: readonly [number, number]): [number, number][] => {
    const fx = Math.floor(p[0] / step);
    const cx = Math.ceil(p[0] / step);
    const fz = Math.floor(p[1] / step);
    const cz = Math.ceil(p[1] / step);
    const xs = fx === cx ? [fx] : [fx, cx];
    const zs = fz === cz ? [fz] : [fz, cz];
    const nodes: [number, number][] = [];
    for (const gx of xs) for (const gz of zs) nodes.push([gx, gz]);
    return nodes;
  };
  const starts = touching(a).filter(([gx, gz]) => walkable(a[0], a[1], toWorld(gx), toWorld(gz), ROUTE_WALKER_PAD));
  const goals = touching(b).filter(([gx, gz]) => walkable(toWorld(gx), toWorld(gz), b[0], b[1], ROUTE_WALKER_PAD));
  if (starts.length === 0 || goals.length === 0) return null; // no clear entry/exit at this reach

  const reachCells = Math.ceil(reach / step);
  const allGx = [...starts, ...goals].map((n) => n[0]);
  const allGz = [...starts, ...goals].map((n) => n[1]);
  const minGx = Math.min(...allGx) - reachCells;
  const maxGx = Math.max(...allGx) + reachCells;
  const minGz = Math.min(...allGz) - reachCells;
  const maxGz = Math.max(...allGz) + reachCells;
  const widthZ = maxGz - minGz + 1;
  const cellCount = (maxGx - minGx + 1) * widthZ;
  const index = (gx: number, gz: number): number => (gx - minGx) * widthZ + (gz - minGz);
  const gxOf = (i: number): number => minGx + Math.floor(i / widthZ);
  const gzOf = (i: number): number => minGz + (i % widthZ);
  const isStart = (gx: number, gz: number): boolean => starts.some(([sx, sz]) => sx === gx && sz === gz);
  const isGoal = (gx: number, gz: number): boolean => goals.some(([tx, tz]) => tx === gx && tz === gz);
  const inBounds = (gx: number, gz: number): boolean =>
    gx >= minGx && gx <= maxGx && gz >= minGz && gz <= maxGz;

  const goalGx = goals.reduce((sum, n) => sum + n[0], 0) / goals.length;
  const goalGz = goals.reduce((sum, n) => sum + n[1], 0) / goals.length;
  const heuristic = (gx: number, gz: number): number => (Math.abs(gx - goalGx) + Math.abs(gz - goalGz)) * step;

  const gScore = new Float64Array(cellCount).fill(Infinity);
  const fScore = new Float64Array(cellCount).fill(Infinity);
  const cameFrom = new Int32Array(cellCount).fill(-1);
  const closed = new Uint8Array(cellCount);
  const open = new MinHeap(fScore);
  for (const [gx, gz] of starts) {
    if (!inBounds(gx, gz)) continue;
    const idx = index(gx, gz);
    gScore[idx] = 0;
    fScore[idx] = heuristic(gx, gz);
    open.push(idx);
  }

  let reachedIdx = -1;
  while (open.size > 0) {
    const currentIdx = open.pop();
    if (closed[currentIdx]) continue;
    closed[currentIdx] = 1;
    const cgx = gxOf(currentIdx);
    const cgz = gzOf(currentIdx);
    if (isGoal(cgx, cgz)) {
      reachedIdx = currentIdx;
      break;
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ngx = cgx + dx;
      const ngz = cgz + dz;
      if (!inBounds(ngx, ngz)) continue;
      const nIdx = index(ngx, ngz);
      if (closed[nIdx]) continue;
      const startOrGoal = isStart(ngx, ngz) || isGoal(ngx, ngz) || isStart(cgx, cgz) || isGoal(cgx, cgz);
      if (
        !startOrGoal &&
        !walkable(toWorld(cgx), toWorld(cgz), toWorld(ngx), toWorld(ngz), ROUTE_WALKER_PAD)
      )
        continue;
      const tentative = (gScore[currentIdx] as number) + step;
      if (tentative < (gScore[nIdx] as number)) {
        gScore[nIdx] = tentative;
        fScore[nIdx] = tentative + heuristic(ngx, ngz);
        cameFrom[nIdx] = currentIdx;
        open.push(nIdx);
      }
    }
  }

  if (reachedIdx === -1) return null; // no route found within this reach

  const gridPoints: [number, number][] = [];
  let cur = reachedIdx;
  for (;;) {
    gridPoints.push([toWorld(gxOf(cur)), toWorld(gzOf(cur))]);
    const prev = cameFrom[cur] as number;
    if (prev === -1) break;
    cur = prev;
  }
  gridPoints.reverse();
  gridPoints.push([b[0], b[1]]);
  return collapseCollinear(gridPoints);
}

/** Minimal binary min-heap of grid-cell indices, ordered by `priority[i]`. Used
 * only by {@link gridDetour}, the rare fallback search — every other route in
 * this file is built in continuous space. */
class MinHeap {
  private readonly heap: number[] = [];
  private readonly priority: Float64Array;
  constructor(priority: Float64Array) {
    this.priority = priority;
  }

  get size(): number {
    return this.heap.length;
  }

  push(index: number): void {
    this.heap.push(index);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.priority[this.heap[parent] as number] as number) <= (this.priority[this.heap[i] as number] as number))
        break;
      [this.heap[parent], this.heap[i]] = [this.heap[i] as number, this.heap[parent] as number];
      i = parent;
    }
  }

  pop(): number {
    const top = this.heap[0] as number;
    const last = this.heap.pop() as number;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = i * 2 + 2;
        let smallest = i;
        if (left < this.heap.length && (this.priority[this.heap[left] as number] as number) < (this.priority[this.heap[smallest] as number] as number))
          smallest = left;
        if (right < this.heap.length && (this.priority[this.heap[right] as number] as number) < (this.priority[this.heap[smallest] as number] as number))
          smallest = right;
        if (smallest === i) break;
        [this.heap[i], this.heap[smallest]] = [this.heap[smallest] as number, this.heap[i] as number];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * Axis-aligned (Manhattan) route from `from` to `to` (issue #269): every
 * edge of the returned polyline is purely horizontal or purely vertical.
 * Two passes — `detourAroundBlockers` finds a clear (generally diagonal)
 * path first, `elbowLeg` then bends each of its legs onto grid axes — so
 * the well-tested "can these two points connect around whatever plots
 * stand between them" question is never re-asked in a stricter form than
 * the park was actually built to answer.
 */
function manhattanRoute(
  from: readonly [number, number],
  to: readonly [number, number],
): (readonly [number, number])[] {
  const clear = detourAroundBlockers(from, to);
  const first = clear[0] as readonly [number, number];
  const out: [number, number][] = [[first[0], first[1]]];
  for (let i = 1; i < clear.length; i += 1) {
    const a = out[out.length - 1] as readonly [number, number];
    const b = clear[i] as readonly [number, number];
    for (const point of elbowLeg(a, b)) out.push([point[0], point[1]]);
  }
  return collapseCollinear(out);
}

/** Drops interior points that lie on the same straight run as their
 * neighbours — a 20 m corridor of grid steps collapses to its two ends,
 * which keeps the Catmull-Rom curve from wobbling at every grid seam. */
function collapseCollinear(points: readonly (readonly [number, number])[]): (readonly [number, number])[] {
  if (points.length < 3) return points.map((p) => [p[0], p[1]] as [number, number]);
  const out: [number, number][] = [points[0] as [number, number]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = out[out.length - 1] as readonly [number, number];
    const cur = points[i] as readonly [number, number];
    const next = points[i + 1] as readonly [number, number];
    const sameX = Math.abs(prev[0] - cur[0]) < 1e-6 && Math.abs(cur[0] - next[0]) < 1e-6;
    const sameZ = Math.abs(prev[1] - cur[1]) < 1e-6 && Math.abs(cur[1] - next[1]) < 1e-6;
    if (sameX || sameZ) continue; // still on the same straight run
    out.push([cur[0], cur[1]]);
  }
  out.push(points[points.length - 1] as [number, number]);
  return out;
}

/**
 * Turns the ring's per-bearing profile vertices into a closed axis-aligned
 * loop (issue #269): every edge purely horizontal or vertical, via
 * {@link manhattanRoute} between each consecutive pair. Adjacent bearings
 * are close together (32 samples round the loop), so each hop is a short,
 * cheap search — the same router the spurs use, not a separate shape.
 */
function toAxisAlignedLoop(
  vertices: readonly (readonly [number, number])[],
): (readonly [number, number])[] {
  const n = vertices.length;
  if (n === 0) return [];
  const first = vertices[0] as readonly [number, number];
  const out: [number, number][] = [[first[0], first[1]]];
  for (let i = 0; i < n; i += 1) {
    const a = vertices[i] as readonly [number, number];
    const b = vertices[(i + 1) % n] as readonly [number, number];
    const leg = manhattanRoute(a, b);
    // Every leg repeats its own start point (`out`'s last entry already);
    // the very last leg also repeats the loop's own start point, which
    // `route.closed` already connects the last entry back to — so it is
    // left off the end rather than duplicated.
    const upper = i === n - 1 ? leg.length - 1 : leg.length;
    for (let j = 1; j < upper; j += 1) out.push(leg[j] as [number, number]);
  }
  return out;
}

function nearestRingPoint(
  ring: readonly (readonly [number, number])[],
  x: number,
  z: number,
): readonly [number, number] {
  let best = ring[0] as readonly [number, number];
  let bestDistance = Infinity;
  for (const point of ring) {
    const distance = Math.hypot(point[0] - x, point[1] - z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

/**
 * The network as a *graph* first: named nodes (every place a child might be
 * going) and solved edges between them. The drawn ribbons, the crossings, the
 * NPC destinations and `check:park`'s reachability all derive from this one
 * structure, so "is everywhere connected?" is a property of the data rather
 * than an accident of which ribbons happen to touch.
 *
 * Nodes: the park gate, the fountain plaza, every anchor's entrance, every
 * stall's doormat, and — now that `train/plan.ts` solves the railway before
 * any path is drawn — both train station platforms. Edges: the ring road
 * backbone, plus a spur from the network to every node, each routed round
 * the placed plots. A node already standing on the network keeps its edge
 * unpaved (`paved: false`): connected in the graph, no double ribbon drawn.
 */
export interface PathNode {
  readonly id: string;
  readonly kind: 'gate' | 'plaza' | 'anchor' | 'stall' | 'station' | 'exit';
  readonly x: number;
  readonly z: number;
}

export interface PathEdge {
  /** Node ids; `'ring'` means the backbone itself. */
  readonly from: string;
  readonly to: string;
  readonly route: RouteDefinition;
  /** False when the node stands on the network already — no ribbon drawn. */
  readonly paved: boolean;
}

export interface PathGraph {
  readonly nodes: readonly PathNode[];
  readonly edges: readonly PathEdge[];
  /** The closed backbone the spurs hang off. */
  readonly ring: RouteDefinition;
}

function buildGraph(): PathGraph {
  const ringPoints = solveRing();
  const ring: RouteDefinition = { name: 'main-loop', width: 3.6, closed: true, points: ringPoints };

  const nodes: PathNode[] = [
    { id: 'gate', kind: 'gate', x: 0, z: 54 },
    { id: 'plaza', kind: 'plaza', x: PLAZA.x, z: PLAZA.z },
  ];
  const edges: PathEdge[] = [
    // The backbone, as an edge from itself to itself: everything hangs off it.
    { from: 'ring', to: 'ring', paved: true, route: ring },
    // The approach: from just inside the park gate, down the protected
    // corridor, then around whatever stands between it and the plaza.
    //
    // Left on `detourAroundBlockers` rather than axis-aligned (issue #269
    // QA): both of these two short, fixed connectors sit in the same small
    // patch of ground the cat bus arrival choreographs its own crowd through
    // (`check:cat-bus`), and re-shaping either one measurably shifted where a
    // background child's own wander route crosses a scripted arrival child's
    // — the two are not procgen-coupled today, so any change to the ground
    // they cross can move a close pass from "fine" to "not." Fixing that
    // crossing properly is a `NpcSystem` job (arrival-aware crowd avoidance),
    // not a path-shape one, so these two connectors keep the proven diagonal
    // rather than trading a real regression there for grid-alignment on two
    // segments nobody would call "the trunk network" anyway.
    {
      from: 'gate',
      to: 'ring',
      paved: true,
      route: {
        name: 'gate-approach',
        width: 3.2,
        closed: false,
        points: [
          [0, 54] as const,
          [0, 30] as const,
          ...detourAroundBlockers([0, 27], nearestRingPoint(ringPoints, 0, 27)).slice(1),
        ],
      },
    },
    // From the ring to the plaza edge nearest the gate side, so the two
    // networks always touch.
    {
      from: 'ring',
      to: 'plaza',
      paved: true,
      route: {
        name: 'fountain-approach',
        width: 3.0,
        closed: false,
        points: detourAroundBlockers(
          nearestRingPoint(ringPoints, PLAZA.x, PLAZA.z + PLAZA.radius + 4),
          [PLAZA.x, PLAZA.z + PLAZA.radius - 1],
        ),
      },
    },
  ];

  // Only paved edges are real paving: a later spur may branch off them, and
  // "already on the network" is measured against them. An unpaved edge is a
  // connectivity fact, not a ribbon — branching off one paved from a booth's
  // doormat once, and the junction waypoint seeded inside the booth.
  const network = (): readonly RouteDefinition[] =>
    edges.filter((edge) => edge.paved).map((edge) => edge.route);

  /**
   * How far short of a plot's own edge the "past the doormat" extension below
   * must stop.
   *
   * Without this, `past` can overshoot *through* the doormat and land inside
   * the plot's own solid collision — see the note on `past` below. The margin
   * has to clear two things: `poiGraph`'s own clearance probe (0.7 m) and a
   * booth's wall thickness, so 1 m of daylight between the waypoint and the
   * wall it is standing beside.
   */
  const PAST_CLEARANCE = 1;

  /** A spur edge from the network to (ex, ez), routed round the plots. When
   * the destination already stands on the network the edge is kept but not
   * paved — connectivity is a graph fact either way. `past` carries the
   * ribbon a couple of metres beyond the doormat into the plot mouth. */
  const spur = (
    id: string,
    kind: PathNode['kind'],
    ex: number,
    ez: number,
    towardX: number,
    towardZ: number,
    width: number,
  ): void => {
    nodes.push({ id, kind, x: ex, z: ez });
    const already = distanceToRouteNetwork(network(), ex, ez) < 4;
    // Branch from wherever the *network* comes nearest — an earlier spur is
    // as good a trunk as the ring. Starting from the nearest ring vertex sent
    // the west station's spur on a 45 m wander from (-8.7, 5) around three
    // booths; from the sky cruiser's spur it is a 21 m walk.
    const start = bestBranchPoint(network(), ringPoints, ex, ez);
    const l = Math.hypot(towardX - ex, towardZ - ez);
    // `past` used to walk a flat 2 m towards the destination regardless of
    // how far the doormat actually stands from the plot's own edge. For a
    // stall (2.6 m footprint, 1.4 m standoff) that 2 m always overshoots the
    // edge by 0.6 m — the waypoint `poiGraph` samples there lands *inside*
    // the booth's own collision, and `findClearSpot`'s nudge search then has
    // to rescue it with no notion of which side leads back to the path
    // network. Inland, where waypoints are dense on every side, the rescued
    // spot usually still sees a neighbour by luck; at the park rim, with
    // nothing else nearby, a nudge onto the booth's far side strands the
    // waypoint behind the booth's own wall — the exact failure that blocked
    // moving the rail-race stall to the rim (see `parkManifest.ts`). So `past`
    // is capped to stop `PAST_CLEARANCE` short of the plot's real edge,
    // computed from the same footprint math the layout solver placed the
    // doormat with, rather than trusting a flat distance to clear every plot
    // shape and standoff combination.
    const placedTarget = PARK_LAYOUT.entries.get(id);
    let pastReach = 2;
    if (placedTarget && l > 1e-6) {
      const edge = edgeDistanceAlong(placedTarget.footprint, (ex - towardX) / l, (ez - towardZ) / l);
      pastReach = Math.max(0, Math.min(pastReach, l - edge - PAST_CLEARANCE));
    }
    const past: readonly (readonly [number, number])[] =
      l > 1e-6 && pastReach > 1e-6
        ? [[ex + ((towardX - ex) / l) * pastReach, ez + ((towardZ - ez) / l) * pastReach]]
        : []; // no "past the doormat" when the node is its own destination
    // Arrive HEAD-ON, not obliquely. The doormat faces the park middle (the
    // solver put it there), and the booth's own counter walls flank it — a
    // branch point far off that axis used to draw a straight leg that grazed
    // the counter's side at centimetres (seed 2's rim stall stranded its
    // whole doormat that way). Routing via a lead a few metres out along the
    // facing line makes the last leg run the way a visitor actually walks
    // in; for a branch already on-axis the lead is collinear and free.
    const lead: (readonly [number, number])[] = [];
    if (placedTarget) {
      // Along the doormat's own outward ray (entrance minus plot centre) —
      // which is the counter's facing for a camera-facing booth and the
      // toward-middle line for everything else, because the solver derived
      // the entrance that way. One source of truth for "which way in".
      const outX = ex - placedTarget.x;
      const outZ = ez - placedTarget.z;
      const out = Math.hypot(outX, outZ);
      if (out > 1e-6) lead.push([ex + (outX / out) * 3.5, ez + (outZ / out) * 3.5]);
    }
    // See {@link SPUR_STRETCH}: no-op in the game, non-zero only for the test
    // that proves a longer spur leaves distant scenery where it was.
    const routed = [...manhattanRoute(start, lead.length ? (lead[0] as [number, number]) : [ex, ez]), ...(lead.length ? [[ex, ez] as readonly [number, number]] : [])];
    if (SPUR_STRETCH > 0 && id === SPUR_STRETCH_ID && routed.length >= 2) {
      const head = routed[0] as readonly [number, number];
      const tail = routed[routed.length - 1] as readonly [number, number];
      const runX = tail[0] - head[0];
      const runZ = tail[1] - head[1];
      const runLength = Math.hypot(runX, runZ);
      if (runLength > 1e-6) {
        routed.splice(1, 0, [
          (head[0] + tail[0]) / 2 + (-runZ / runLength) * SPUR_STRETCH,
          (head[1] + tail[1]) / 2 + (runX / runLength) * SPUR_STRETCH,
        ]);
      }
    }
    edges.push({
      from: 'ring',
      to: id,
      paved: !already,
      route: {
        name: `spur-${id}`,
        width,
        closed: false,
        points: [...routed, ...past],
      },
    });
  };

  for (const anchor of ANCHORS) {
    const [ex, ez] = anchor.entrance;
    spur(
      anchor.id,
      'anchor',
      ex,
      ez,
      anchor.position[0],
      anchor.position[1],
      anchor.id === 'building' ? 2.8 : 2.6,
    );
  }
  // Every stall counter is a node too — the sky cruiser's booth sits in the
  // castle's west pocket, a 30 m walk from the nearest path before its spur
  // existed.
  //
  // The node is the **stand point**, not the plot's doormat. A booth has two
  // candidate points and they lie on different bearings: `PlacedEntry`'s
  // entrance sits 1.4 m off the plot edge along the line toward the park
  // middle, while `STALL_STANDS` sits in front of the counter, which is the
  // side a child is actually served from — and the point `minigames/stalls.ts`
  // registers its interact zone at, `npc/poiGraph.ts` seeds a waypoint at and
  // `LampPosts.ts` keeps clear. Routing to the doormat instead left every
  // stall's ribbon stopping 3.4–6.9 m short of its own counter, on all five
  // test seeds: the "paths to nowhere" the family reported (issue #114). The
  // ribbon is only half the width of that gap, so what you saw in the park was
  // paving that simply stopped in the grass beside a booth.
  //
  // Driving the loop off `STALL_STANDS` rather than off the `stall.` entries in
  // `PARK_LAYOUT` also picks up the ferris kiosk, which is placed by relation
  // to the wheel's own entrance (`stallPlacement.ts`'s `ferrisKiosk`) rather
  // than by the layout solver. It has no `stall.` entry for that loop to find,
  // so it had **no node at all** and survived only by standing near the wheel's
  // own spur. It is the only booth that was missing outright.
  //
  // The face-paint stall is a different case worth not confusing with it: it
  // does have a manifest entry (`parkManifest.ts`, `stall.facePaint`) and did
  // have a node, at the doormat, 4.4 m from its counter — the same
  // wrong-point bug as every other stall, not a missing one. What it lacked
  // was a shared *stand*: `world/FacePaintStall.ts` computed its own from a
  // private pair of constants, so its destination was a coordinate only it
  // knew. That is why it now lives in `STALL_PLACEMENTS` too.
  //
  // A counter is a destination in itself, like a ride exit, so `toward` equals
  // the node and there is no past-the-doormat extension: walking past a
  // counter walks into the booth.
  for (const stand of STALL_STANDS) {
    spur(`stall.${stand.id}`, 'stall', stand.x, stand.z, stand.x, stand.z, 2.6);
  }
  // And the train stations — plannable at all only because `train/plan.ts`
  // solves the railway before any path is drawn. The stand is the node, but
  // the spur routes to the *approach* (the platform's empty half) and only
  // then turns down the platform: arriving radially put the canopy posts
  // square across the waypoint graph's line to the stand.
  for (const station of TRAIN_PLAN.stations) {
    const id = `station-${station.index}`;
    nodes.push({ id, kind: 'station', x: station.standX, z: station.standZ });
    // Via the lead — past the platform's empty end, stepped into the park —
    // so the incoming leg can arrive from any bearing without paving through
    // the canopy posts on the furnished half (see `PlannedStation.leadX`).
    const start = bestBranchPoint(network(), ringPoints, station.leadX, station.leadZ);
    edges.push({
      from: 'ring',
      to: id,
      paved: true,
      route: {
        name: `spur-${id}`,
        width: 2.6,
        closed: false,
        points: [
          ...manhattanRoute(start, [station.leadX, station.leadZ]),
          [station.approachX, station.approachZ],
          [station.standX, station.standZ],
        ],
      },
    });
  }

  // Ride exits (GAME_DESIGN.md's EXIT rule, 28 July 2026): every ride's
  // dismount point is a node in this same graph, exactly like a station or a
  // stall's doormat — so `check:park` can prove a rider can actually be
  // walked there and back, and so nothing about "where does this ride let
  // you off" is ever a coordinate known only to the ride itself. The `spur`
  // helper's `towardX/towardZ` equal to `(ex, ez)` is the same "no past-the-
  // doormat extension" case a station's own node would use if it needed one:
  // an exit is a destination in itself, not a doorway into a plot.
  //
  // The ginormous slide is in this list for the reason the rule exists: it is
  // the ride that did not have an exit, and #118 is what that cost — its
  // hand-authored chute ended inside the castle, behind a wall, and a
  // six-year-old who went down it was stuck there. Being in this loop is what
  // makes "you can walk away from the bottom of the slide" a thing the park
  // proves on every seed rather than a thing anyone remembered to check.
  for (const plan of [COASTER_PLANS.cruiser, RAIL_RACE_PLAN, SLIDE_PLAN]) {
    spur(`exit-${plan.name}`, 'exit', plan.exitX, plan.exitZ, plan.exitX, plan.exitZ, 2.2);
  }
  spur(
    'exit-ferrisWheel',
    'exit',
    FERRIS_WHEEL_EXIT.x,
    FERRIS_WHEEL_EXIT.z,
    FERRIS_WHEEL_EXIT.x,
    FERRIS_WHEEL_EXIT.z,
    2.2,
  );

  return { nodes, edges, ring };
}

/** The closest point on one route to `(x, z)`, or null if it has none usable. */
function nearestPointOnRoute(
  route: RouteDefinition,
  x: number,
  z: number,
): readonly [number, number] | null {
  let best: readonly [number, number] | null = null;
  let bestDistance = Infinity;
  const points = route.points;
  const count = route.closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i += 1) {
    const [ax, az] = points[i] as readonly [number, number];
    const [bx, bz] = points[(i + 1) % points.length] as readonly [number, number];
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSq = dx * dx + dz * dz;
    const t =
      lengthSq > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0;
    const px = ax + dx * t;
    const pz = az + dz * t;
    // Never branch from inside a plot's blocker circle: every spur's last
    // couple of metres run into a plot mouth, and a junction there routes
    // the new spur straight through the booth it belongs to.
    if (BLOCKERS.some((b) => Math.hypot(px - b.x, pz - b.z) < b.radius)) continue;
    const distance = Math.hypot(x - px, z - pz);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [px, pz];
    }
  }
  return best;
}

/** How far a walk along this polyline actually is. */
function polylineLength(points: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [ax, az] = points[i - 1] as readonly [number, number];
    const [bx, bz] = points[i] as readonly [number, number];
    total += Math.hypot(bx - ax, bz - az);
  }
  return total;
}

/**
 * Where a new spur should branch off the network — **the junction that gives
 * the shortest walk**, not the junction that is nearest.
 *
 * ### The fault this replaces
 *
 * This used to be `nearestNetworkPoint`: the closest point on any paved route,
 * full stop. That is *first-fit* — it commits to whichever junction happens to
 * be nearest in a straight line and never asks what the resulting walk is like.
 * It is the same fault the rail route solver had (return the first satisfying
 * route rather than the best) and the castle crossing had (four solves that
 * closed before reaching it), and it fails the same way: an arbitrary early
 * choice silently constrains everything after it.
 *
 * The straight-line distance to a junction is not the thing anybody cares
 * about. A junction 6 m away whose run to the destination has to squeeze round
 * two plots is a worse place to start than one 9 m away with a clear line — and
 * worse in the way that matters, because the ribbon that snakes round the back
 * of a plot is what leaves a destination's own waypoint in a pocket nothing
 * else can reach.
 *
 * ### What it cost, on 5 August 2026
 *
 * `STALL_STANDS` is iterated in `STALL_PLACEMENTS` order, which puts the
 * **rail-race booth first**. Move that booth out to the park's rim — which its
 * `atRim` relation does, because the ride it boards now follows the park's edge
 * — and its long spur is laid down before anything else. The **ferris-wheel
 * kiosk**, which has nothing to do with the rail race, then found that spur
 * nearest, branched off it, and ended up in a pocket its own stand could not be
 * walked out of. `check:park` reported one stranded waypoint at (20.9, 20.2)
 * and nothing else. Measured exhaustively: **all 344** positions the rail-race
 * booth could legally take stranded that same one waypoint.
 *
 * Growing the spurs in a different order does not fix it — it only moves it.
 * Nearest-destination-first was tried and simply stranded the rail-race booth
 * and its own ride exit instead, because whichever spur is grown while the
 * network is wrong *for it* is the one that suffers. The order was never the
 * disease; choosing a junction without looking at where it leads was.
 *
 * ### Best-fit
 *
 * So every route offers its own nearest point as a **candidate**, each candidate
 * is routed to the destination around the real plots, and the one with the
 * shortest actual walk wins. Branching off an earlier spur is still very much
 * allowed — it is what saves the west station a 45 m wander — but now it has to
 * *earn* it by being a better walk, rather than winning on proximity alone.
 *
 * Ties keep the earlier route, so the network stays deterministic.
 */
function bestBranchPoint(
  routes: readonly RouteDefinition[],
  ringPoints: readonly (readonly [number, number])[],
  x: number,
  z: number,
): readonly [number, number] {
  const candidates: (readonly [number, number])[] = [];
  for (const route of routes) {
    const point = nearestPointOnRoute(route, x, z);
    if (point) candidates.push(point);
  }
  // The ring is always a legal place to start from, and it is the fallback if
  // no paved route offered a junction outside every plot.
  candidates.push(nearestRingPoint(ringPoints, x, z));

  let best = candidates[candidates.length - 1] as readonly [number, number];
  let shortest = Infinity;
  for (const candidate of candidates) {
    // Scored on `detourAroundBlockers`'s distance, not the axis-aligned
    // `manhattanRoute`'s: axis-aligning can only ever add length to a route
    // (a straight line is the shortest connection between two points, an
    // L or a Z around it is never shorter), so a candidate whose *diagonal*
    // walk is genuinely shortest is still the best network junction to
    // grow the spur from — scoring on the axis-aligned length instead
    // rewarded whichever candidate happened to make `elbowLeg` give up and
    // fall back to a raw diagonal (issue #269 QA): that fallback reports
    // the direct distance, which reads as suspiciously short exactly when
    // it is hiding the worst-shaped route on offer.
    const walk = polylineLength(detourAroundBlockers(candidate, [x, z]));
    if (walk < shortest - 1e-9) {
      shortest = walk;
      best = candidate;
    }
  }
  return best;
}

/** Min distance from (x, z) to any segment of the routes built so far. */
function distanceToRouteNetwork(
  routes: readonly RouteDefinition[],
  x: number,
  z: number,
): number {
  let best = Infinity;
  for (const route of routes) {
    const points = route.points;
    const count = route.closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i += 1) {
      const [ax, az] = points[i] as readonly [number, number];
      const [bx, bz] = points[(i + 1) % points.length] as readonly [number, number];
      const dx = bx - ax;
      const dz = bz - az;
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0;
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
    }
  }
  return best;
}

/** The solved graph — nodes, edges, backbone. One per build, like the park. */
export const PATH_GRAPH: PathGraph = buildGraph();

/**
 * The ribbons actually drawn — the graph's paved edges. Exported so anything
 * that wants to *draw* the network — the park map — can rebuild the same
 * centreline from the same generated control points.
 */
export const ROUTES: readonly RouteDefinition[] = PATH_GRAPH.edges
  .filter((edge) => edge.paved)
  .map((edge) => edge.route);

/** Sampled path centreline, used for scenery placement queries. */
export interface PathSample {
  readonly x: number;
  readonly z: number;
  readonly halfWidth: number;
}

const samples: PathSample[] = [];

/**
 * The drawn network's centreline samples — the ground truth the crossings
 * computation walks (Decision 4: crossings are computed from the solved
 * curves at boot, so they can never drift off either the track or the path).
 * Populated by {@link buildPaths}, which Garden runs before the train exists.
 */
export function pathCentreline(): readonly PathSample[] {
  return samples;
}

/**
 * Distance from (x, z) to the nearest path *edge*.
 * Negative means the point is on the paving.
 */
export function distanceToPath(x: number, z: number): number {
  const plazaDistance = Math.hypot(x - PLAZA.x, z - PLAZA.z) - PLAZA.radius;
  let best = plazaDistance;
  for (const sample of samples) {
    const d = Math.hypot(x - sample.x, z - sample.z) - sample.halfWidth;
    if (d < best) best = d;
  }
  return best;
}

/** True if the point is paved (or within `margin` of paving). */
export function isOnPath(x: number, z: number, margin = 0): boolean {
  return distanceToPath(x, z) < margin;
}

/**
 * Builds the whole path network as two meshes: a cream kerb and the sandy
 * surface sitting a few centimetres proud of it.
 */
export function buildPaths(): Mesh[] {
  samples.length = 0;

  const surface = new GeometryBuilder();
  const kerb = new GeometryBuilder();

  for (const route of ROUTES) {
    const curve = makeCurve(route.points, route.closed);
    const divisions = Math.max(24, Math.round(curve.getLength() / 0.8));
    addRibbon(surface, curve, route.width, divisions, 0.055);
    addRibbon(kerb, curve, route.width + 0.85, divisions, 0.03);
    recordSamples(curve, divisions, route.width / 2);
  }

  addDisc(surface, PLAZA.x, PLAZA.z, PLAZA.radius, 48, 5, 0.055);
  addDisc(kerb, PLAZA.x, PLAZA.z, PLAZA.radius + 0.85, 48, 5, 0.03);

  const surfaceMaterial = new MeshStandardMaterial({
    map: pathTexture(1),
    roughness: 0.95,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const kerbMaterial = new MeshStandardMaterial({
    color: PALETTE.pathEdge,
    roughness: 0.9,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const surfaceMesh = new Mesh(surface.build(), surfaceMaterial);
  surfaceMesh.name = 'path-surface';
  surfaceMesh.receiveShadow = true;

  const kerbMesh = new Mesh(kerb.build(), kerbMaterial);
  kerbMesh.name = 'path-kerb';
  kerbMesh.receiveShadow = true;

  return [kerbMesh, surfaceMesh];
}

// ---------------------------------------------------------------- internals

function makeCurve(points: readonly (readonly [number, number])[], closed: boolean): CatmullRomCurve3 {
  const vectors = points.map(([x, z]) => new Vector3(x, 0, z));
  const curve = new CatmullRomCurve3(vectors, closed, 'catmullrom', 0.4);
  return curve;
}

function recordSamples(curve: CatmullRomCurve3, divisions: number, halfWidth: number): void {
  const point = new Vector3();
  for (let i = 0; i <= divisions; i += 1) {
    curve.getPoint(i / divisions, point);
    samples.push({ x: point.x, z: point.z, halfWidth });
  }
}

/** Sweeps a flat ribbon of `width` along the curve, draped onto the terrain. */
function addRibbon(
  builder: GeometryBuilder,
  curve: CatmullRomCurve3,
  width: number,
  divisions: number,
  lift: number,
): void {
  const half = width / 2;
  const point = new Vector3();
  const tangent = new Vector3();
  let travelled = 0;
  let previousX = 0;
  let previousZ = 0;

  for (let i = 0; i <= divisions; i += 1) {
    const t = i / divisions;
    curve.getPoint(t, point);
    curve.getTangent(t, tangent);
    // Perpendicular on the ground plane.
    const nx = -tangent.z;
    const nz = tangent.x;
    const length = Math.hypot(nx, nz) || 1;

    if (i > 0) travelled += Math.hypot(point.x - previousX, point.z - previousZ);
    previousX = point.x;
    previousZ = point.z;

    const lx = point.x + (nx / length) * half;
    const lz = point.z + (nz / length) * half;
    const rx = point.x - (nx / length) * half;
    const rz = point.z - (nz / length) * half;

    // Right edge before left edge: that ordering makes the quads wind
    // anticlockwise seen from above, so the ribbon faces the sky.
    const v = travelled / Math.max(1, width);
    builder.vertex(rx, terrainHeight(rx, rz) + lift, rz, 0, v);
    builder.vertex(lx, terrainHeight(lx, lz) + lift, lz, 1, v);

    if (i > 0) {
      const base = builder.vertexCount - 4;
      builder.quad(base, base + 1, base + 2, base + 3);
    }
  }
}

/** A paved circle (the fountain plaza), built as concentric rings. */
function addDisc(
  builder: GeometryBuilder,
  cx: number,
  cz: number,
  radius: number,
  segments: number,
  rings: number,
  lift: number,
): void {
  const first = builder.vertexCount;
  for (let r = 0; r <= rings; r += 1) {
    const radiusAt = (r / rings) * radius;
    for (let s = 0; s <= segments; s += 1) {
      const angle = (s / segments) * Math.PI * 2;
      const x = cx + Math.cos(angle) * radiusAt;
      const z = cz + Math.sin(angle) * radiusAt;
      builder.vertex(x, terrainHeight(x, z) + lift, z, x / 6, z / 6);
    }
  }
  const stride = segments + 1;
  for (let r = 0; r < rings; r += 1) {
    for (let s = 0; s < segments; s += 1) {
      const a = first + r * stride + s;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      builder.quad(a, b, c, d);
    }
  }
}

/**
 * Minimal geometry accumulator so the whole path network collapses into a
 * single draw call per layer.
 */
class GeometryBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];
  private readonly scratchNormal = new Vector3();

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  vertex(x: number, y: number, z: number, u: number, v: number): void {
    this.positions.push(x, y, z);
    // Normals come from the terrain function rather than computeVertexNormals():
    // the plaza fan has degenerate triangles at its centre, which would leave
    // those vertices with a zero-length normal and a black splodge in the middle
    // of the paving.
    const normal = terrainNormal(x, z, this.scratchNormal);
    this.normals.push(normal.x, normal.y, normal.z);
    this.uvs.push(u, v);
  }

  /** Two triangles for a quad given as (a, b) then (c, d) vertex pairs. */
  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, b, d, c);
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}
