import { Vector3 } from 'three';
import { PLAYER_RADIUS } from '../core/constants';
import { ANCHORS } from './anchors';
import { PARK_LAYOUT, RING_RADIUS, edgeDistanceAlong } from './parkLayout';
import { PARK_BOUNDARY } from './boundary';
import { TRAIN_PLAN, RAIL_CORRIDOR_CLEARANCE as RAIL_CORRIDOR_CLEARANCE_PLAN } from './train/plan';
import { STATION_GAP } from './train/fence';
import { FENCE_OFFSET } from './train/clearance';
import { DECK_HALF_LENGTH } from './train/bridgeFootprint';
import {
  CROSSING_SITES,
  LEVEL_CROSSING_SITES,
  LEVEL_CROSSING_PENALTY,
  SITE_HALF_WIDTH,
  type CrossingSite,
} from './train/crossingPlan';
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

/** Test hook: skip {@link addInterconnects} entirely, so a test can measure
 * the pre-interconnection hub-and-spoke tree on a real, currently-generated
 * park — see that function's call site. Zero/default in the game. */
const DISABLE_INTERCONNECTS = stringFromEnv('LGP_DISABLE_INTERCONNECTS') !== null;

/** Debug hook: log why a spur fell back off the street lattice. Node-only,
 * zero/default in the game, exactly like the hooks above. */
const DEBUG_STREETS = stringFromEnv('LGP_DEBUG_STREETS') !== null;

/** Set (debug only) around a re-probe of a fallen-back target so
 * `streetStubs` narrates its per-node rejections for that one point. */
let stubDebugTarget: readonly [number, number] | null = null;

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
  /**
   * `'plot'` blockers are legitimate to end a route *inside* — a doormat
   * genuinely stands close to its own plot, "arriving at a destination" is
   * real. `'archFoot'` blockers never are: nobody's destination is the post
   * of the finish rainbow, so a route endpoint that happens to land inside
   * one is a clearance failure to route around, not a place to exempt (see
   * {@link gridDetourAttempt}'s embedded-blocker filter, and issue #269 QA:
   * exempting an arch foot here is exactly what let a rail-race leg come
   * down 0.58 m from a path on seed 11 — well inside `WALKABLE_GAP`).
   */
  readonly kind: 'plot' | 'archFoot';
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
    .map((e) => ({ x: e.x, z: e.z, radius: e.boundingRadius + 2.2, kind: 'plot' as const })),
  ...[RAIL_RACE_PLAN.walkPastRing, RAIL_RACE_PLAN.raceRing]
    .flatMap((ring) => archFeet(ring))
    .map((foot) => ({ x: foot.x, z: foot.z, radius: foot.radius + ARCH_FOOT_MARGIN, kind: 'archFoot' as const })),
];



/**
 * The ring road: **a genuine smooth circle round the plaza, not a grid loop**
 * (issue #269 follow-up, Jim, 18 August 2026 — the instruction that arrived
 * mid-round-3 and was deliberately *not* acted on then, see that round's
 * HANDOFF note, and is acted on here): *"one central perfect circle is ok
 * circling the statue, and then the rest should be on a grid, with a fairly
 * high degree of connectivity between the closer nodes in the graph."*
 *
 * Rounds 1-2 of this same ring (see the history below) tried to have it both
 * ways — axis-align the ring like everything else, then simplify away the
 * staircase that produced — and both readings of the result were wrong: a
 * grid loop that still doesn't read as a grid (too few, too long a run to
 * *feel* rectilinear round something this small) fighting a circle that
 * still doesn't read as a circle (dead-straight chords). Jim's actual ask
 * was never "make the ring's staircase less ugly," it was "the ring is the
 * one thing in this network allowed to be a genuine circle, and everything
 * *else* (spurs, interconnects) is the grid." So: skip axis-alignment for
 * this one route entirely, and hand back exactly the smooth radius-per-
 * bearing profile below, unmodified — no straight chords anywhere on it.
 *
 * **Deliberately still the per-bearing profile, not one fixed radius.** A
 * literal constant-radius circle was tried first and reverted: forcing every
 * bearing to the *tightest* clearance found anywhere pulled the whole ring in
 * by up to ~5.7 m wherever the old profile had room to bulge outward (this
 * profile's own blocker-clearance solve, unchanged below), which shifted
 * enough of the paved footprint to strand a `Garden.ts` waypoint that the
 * unmodified profile does not (`check:park`'s `poi.stranded`, caught before
 * this landed — see CLAUDE.md's own "a longer path must not move distant
 * scenery" precedent, `SPUR_STRETCH`'s comment). The per-bearing profile
 * below is not new geometry invented for this round: it is the same
 * blocker-clearance solve every round of this ring has used since before
 * issue #269 existed, and the *only* thing this round changes is that
 * nothing downstream flattens it onto grid axes any more. It already reads
 * as a circle — Laplacian-relaxed smooth, no corners, no straight run longer
 * than a couple of metres — which is exactly the shape Jim is asking for;
 * "perfect" was never a request for millimetre-constant radius so much as
 * "not a polygon," and forcing literal constant radius is what broke a
 * waypoint two bearings did not need broken.
 *
 * ### History
 *
 * Round 1 (issue #269): every bearing became its own control point, axis-
 * aligned pairwise — the "staircase" round 2 fixed.
 *
 * Round 2 (issue #319, Jim: *"this fails both to draw on a grid, and also to
 * draw a circle, it is literally disgusting to look at and the worst of all
 * worlds"*): Douglas-Peucker-simplified the 32 samples down to ~12 vertices
 * before axis-aligning, which fixed the staircase but — exactly as this
 * round's own instruction says — left the ring looking like neither a grid
 * nor a circle, just a shorter staircase. The simplification/axis-alignment
 * machinery that round built (`simplifyClosedLoop`, `rdpKeep`,
 * `toAxisAlignedLoop`, `collapseCollinearClosed`) is removed in this round,
 * not kept dormant: nothing else in this file ever called it, and a ring
 * whose control points are the raw profile has no straight chords for it to
 * simplify.
 */
function solveRing(): (readonly [number, number])[] {
  // A true, constant-radius circle — nothing here reacts to plots any
  // more, because the layout solver now keeps every plot out of the ring's
  // own annulus (`parkLayout.ts`'s ring rule): the street constrains the
  // buildings, not the other way round. 32 bearings is plenty for the
  // Catmull-Rom ribbon to read as a smooth circle.
  const bearings = 32;
  const points: (readonly [number, number])[] = [];
  for (let i = 0; i < bearings; i += 1) {
    const angle = (i / bearings) * TAU_PATH;
    points.push([
      PLAZA.x + Math.cos(angle) * RING_RADIUS,
      PLAZA.z + Math.sin(angle) * RING_RADIUS,
    ]);
  }
  return points;
}


const TAU_PATH = Math.PI * 2;

/**
 * **The statue ring's four junctions — compass points, and only these**
 * (issue #269, Jim: "exactly 4 connections at compass points"). Every leg
 * that joins the ring — the gate approach, the fountain approach, every
 * spur that branches off the backbone — does so at one of these four, so
 * the circle reads as a deliberate landmark with four gateways rather than
 * a loop nibbled at from every direction.
 */
const RING_COMPASS_POINTS: readonly (readonly [number, number])[] = [
  [PLAZA.x + RING_RADIUS, PLAZA.z],
  [PLAZA.x - RING_RADIUS, PLAZA.z],
  [PLAZA.x, PLAZA.z + RING_RADIUS],
  [PLAZA.x, PLAZA.z - RING_RADIUS],
];

function nearestCompassPoint(x: number, z: number): readonly [number, number] {
  let best = RING_COMPASS_POINTS[0] as readonly [number, number];
  let bestDistance = Infinity;
  for (const point of RING_COMPASS_POINTS) {
    const d = Math.hypot(point[0] - x, point[1] - z);
    if (d < bestDistance) {
      bestDistance = d;
      best = point;
    }
  }
  return best;
}

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

/**
 * How far *outside* its own plot's blocker circle a route's true endpoint
 * may still sit and count as "arriving at a destination" for
 * {@link gridDetourAttempt}'s connector screening (issue #269 QA, seed 2/18).
 *
 * A camera-facing entry's doormat sits `standOff` (1.4 m, `parkLayout.ts`)
 * plus its own edge distance off the plot centre — routinely just outside
 * `boundingRadius` rather than inside it, so requiring literal embedding
 * (as the general mid-search exemption still does) missed it: the rail-race
 * stall's own doormat sat only 0.2 m outside its plot's blocker circle, none
 * of the 4 candidate grid corners had a fully clear connector to it, and the
 * leg gave up and fell back to a 25 m raw diagonal. 3 m comfortably covers
 * the standoff itself plus the wobble a plot's actual footprint shape (a
 * rectangle's corner reaches further than its `boundingRadius` circle
 * suggests) can add on top.
 */
const DESTINATION_ARRIVAL_MARGIN = 3;

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
  arrivalMargin = 0,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  for (const blocker of blockers) {
    // A segment ending inside (or, within `arrivalMargin`, just outside) a
    // *plot* blocker is arriving at a destination — every spur's last metres
    // run into a plot mouth — so only the segment's *approach* is asked
    // about, never whether it ends inside one. An arch foot is never a
    // destination (issue #269 QA, seed 11: exempting one here is exactly
    // what let a rail-race leg land 0.58 m from a path), so it never gets
    // this exemption regardless of where the segment ends.
    const t =
      lengthSq > 1e-9
        ? Math.max(0, Math.min(1, ((blocker.x - ax) * dx + (blocker.z - az) * dz) / lengthSq))
        : 0;
    const exempt =
      blocker.kind === 'plot' &&
      t >= 1 - 1e-9 &&
      Math.hypot(blocker.x - bx, blocker.z - bz) < blocker.radius + arrivalMargin;
    if (exempt) continue;
    const cx = ax + dx * t;
    const cz = az + dz * t;
    const dist = Math.hypot(blocker.x - cx, blocker.z - cz);
    if (dist < blocker.radius + pad) return false;
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
    // The half-metre memo, not the spline walk — this test runs on every
    // candidate leg of the fallback router and was 37 ms of the solve's one
    // main-thread block (check:park-boot, 2026-08-24).
    if (boundaryDistanceCached(x, z) < PLAYER_RADIUS) return false;
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
        // A segment ending inside a *plot* circle is arriving at a
        // destination — every spur's last metres run into a plot mouth.
        // Detouring that blocker would splice the same escape point forever
        // (measured: seven copies of one point). Only the *far* endpoint can
        // be inside a blocker: starts are junction points, kept outside every
        // circle by `bestBranchPoint`. An arch foot is never a destination
        // (issue #269 QA, seed 11), so it keeps demanding clearance right up
        // to the segment's own end, exactly like every other approach.
        if (blocker.kind === 'plot' && Math.hypot(blocker.x - b[0], blocker.z - b[1]) < blocker.radius)
          continue;
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
      blocker.kind !== 'plot' ||
      (Math.hypot(a[0] - blocker.x, a[1] - blocker.z) >= blocker.radius &&
        Math.hypot(b[0] - blocker.x, b[1] - blocker.z) >= blocker.radius),
  );
  const walkable = (ax: number, az: number, bx: number, bz: number, pad: number): boolean =>
    segmentClearOfBlockers(ax, az, bx, bz, pad, localBlockers) && segmentClearOfBoundary(ax, az, bx, bz);
  // The connector into the *true* endpoint gets a little more slack on the
  // "arriving at a destination" exemption than an ordinary mid-search edge
  // does: a doormat typically stands `standOff` (1.4 m, `parkLayout.ts`) plus
  // its own edge distance off its plot's centre, which is routinely just
  // outside the plot's `boundingRadius` circle rather than inside it — close
  // enough to be "arriving" in every sense that matters, but not literally
  // embedded, so the plain (`arrivalMargin = 0`) exemption above missed it.
  // Seed 2's rail-race stall sat only 0.2 m outside its own plot's blocker
  // circle, and none of the 4 candidate grid corners had a fully clear
  // connector to it — `goals` came back empty at every search reach, and the
  // leg fell all the way back to a 25 m raw diagonal (issue #269 QA). Applied
  // only to the one connector actually touching `a`/`b`, never to the
  // ordinary edges the A* search walks between them.
  const walkableToEndpoint = (ax: number, az: number, bx: number, bz: number): boolean =>
    segmentClearOfBlockers(ax, az, bx, bz, ROUTE_WALKER_PAD, localBlockers, DESTINATION_ARRIVAL_MARGIN) &&
    segmentClearOfBoundary(ax, az, bx, bz);

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
  // The 4 immediate touching corners can *all* fail: a stall's doormat can
  // sit in a genuinely tight pocket (seed 2/18's rail-race spur, issue #269
  // QA) where every corner right next to it is blocked either by its own
  // plot's mid-segment footprint or by a neighbouring arch foot that must
  // never be exempted (seed 11's fix). None of that makes the *point itself*
  // unreachable — a corner a couple of grid steps further out is routinely
  // clear, since the measured gaps here were as small as 0.15-0.6 m. So when
  // the immediate ring comes back empty, widen outward ring by ring (2 m grid
  // steps, Chebyshev shells) and take the first shell with any walkable
  // candidate, rather than giving up at reach 45/90/160 with a route that was
  // always going to find a point but never a way to actually stand next to
  // it.
  const MAX_ENTRY_RING = 4;
  const entryCandidates = (
    p: readonly [number, number],
    endpointWalkable: (gx: number, gz: number) => boolean,
  ): [number, number][] => {
    const immediate = touching(p).filter(([gx, gz]) => endpointWalkable(gx, gz));
    if (immediate.length > 0) return immediate;
    const cgx = Math.round(p[0] / step);
    const cgz = Math.round(p[1] / step);
    for (let radius = 1; radius <= MAX_ENTRY_RING; radius++) {
      const ring: [number, number][] = [];
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue; // outer shell only
          const gx = cgx + dx;
          const gz = cgz + dz;
          if (endpointWalkable(gx, gz)) ring.push([gx, gz]);
        }
      }
      if (ring.length > 0) return ring;
    }
    return [];
  };
  const starts = entryCandidates(a, (gx, gz) => walkableToEndpoint(a[0], a[1], toWorld(gx), toWorld(gz)));
  const goals = entryCandidates(b, (gx, gz) => walkableToEndpoint(toWorld(gx), toWorld(gz), b[0], b[1]));
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
 *
 * A third pass, {@link pushClearOfRail}, runs last: see its own comment for
 * why the railway needed a pass of its own rather than joining the first two.
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
  return collapseCollinear(pushClearOfRail(collapseCollinear(out)));
}

/**
 * The two ends of a crossing site's own straight run — where a leg leaves
 * ordinary routing, walks the crossing axis (over the future bridge, or
 * through the level crossing's fence gap), and resumes ordinary routing.
 * A bridge site's foot sits a stride past the ramp's own feasible reach so
 * the drawn ribbon runs straight under the whole ramp; a level site's just
 * far enough past the fence gap that the path arrives square.
 */
function crossingFeet(site: CrossingSite): {
  plus: readonly [number, number];
  minus: readonly [number, number];
} {
  // A foot must actually stand on its own side: near a pinch (two passes
  // of the loop a few metres apart) a full-reach foot can overshoot past
  // the loop's OTHER branch, and every leg joined to it then crosses the
  // railway somewhere no site exists. Pull the reach in until it does.
  const foot = (sign: 1 | -1, reach: number): readonly [number, number] => {
    let r = reach;
    while (r > 4) {
      const x = site.x + site.dirX * sign * (DECK_HALF_LENGTH + r);
      const z = site.z + site.dirZ * sign * (DECK_HALF_LENGTH + r);
      if (railInfoAt(x, z).side === sign) return [x, z] as const;
      r -= 1;
    }
    return [
      site.x + site.dirX * sign * (DECK_HALF_LENGTH + r),
      site.z + site.dirZ * sign * (DECK_HALF_LENGTH + r),
    ] as const;
  };
  return {
    plus: foot(1, site.bridge ? site.rampReachPos + 1.0 : 4.0),
    minus: foot(-1, site.bridge ? site.rampReachNeg + 1.0 : 4.0),
  };
}

/**
 * Route a leg that must respect the railway (Jim, 23 August 2026: the park
 * is designed around the bridge constraints, not the other way round).
 *
 * Endpoints on the same side of the loop route exactly as before. A leg
 * whose endpoints straddle the railway is routed *through a planned
 * crossing site* ({@link CROSSING_SITES}): ordinary axis-aligned routing to
 * the near ramp foot, dead straight along the crossing's own axis over the
 * rail, ordinary routing onward — so the drawn network only ever meets the
 * railway where `crossingPlan.ts` proved a bridge fits. Site choice
 * minimises real walked length, with {@link LEVEL_CROSSING_PENALTY} extra
 * charged for a level-crossing site so a bridge always wins when one is in
 * reach.
 */
function routeLeg(
  from: readonly [number, number],
  to: readonly [number, number],
): (readonly [number, number])[] {
  const fromSide = railInfoAt(from[0], from[1]).side;
  const toSide = railInfoAt(to[0], to[1]).side;
  // Same side: the street lattice first — this path only runs as a
  // fallback (a destination whose own stubs failed), but the *leg* between
  // two ordinary points is usually still lattice-servable, and the old
  // continuous router giving up in a boxed-in pocket is what left 24-30 m
  // raw diagonals on seeds 2 and 11. Then ordinary routing, still held to
  // its side, because the old routers are not rail-aware and a corner can
  // hop the rail and back mid-leg (measured: a stall connector crossed
  // twice, once *inside* a station's sealed window).
  if (fromSide === toSide) {
    const plan = planStreetBetween(from, to, false, true);
    if (plan) {
      commitStreetPlan(plan);
      return [...plan.points];
    }
    return sameSideLeg(from, to, fromSide);
  }

  const candidates = [...CROSSING_SITES, ...LEVEL_CROSSING_SITES]
    .map((site) => {
      const feet = crossingFeet(site);
      const near = fromSide === 1 ? feet.plus : feet.minus;
      const far = fromSide === 1 ? feet.minus : feet.plus;
      const cost =
        Math.hypot(from[0] - near[0], from[1] - near[1]) +
        Math.hypot(near[0] - far[0], near[1] - far[1]) +
        Math.hypot(far[0] - to[0], far[1] - to[1]) +
        (site.bridge ? 0 : LEVEL_CROSSING_PENALTY);
      return { site, near, far, cost };
    })
    .sort((a, b) => a.cost - b.cost);
  // No site anywhere on the loop (should not happen — the level tier exists
  // for exactly this): the old behaviour, an ad-hoc crossing wherever the
  // route lands, is still better than no path at all.
  if (candidates.length === 0) return manhattanRoute(from, to);

  const build = (candidate: (typeof candidates)[number]): (readonly [number, number])[] => {
    const site = candidate.site;
    return [
      // The ordinary routers know nothing about the railway, so each sub-leg
      // goes through the same side-holding pipeline as a whole same-side leg
      // (measured: the dodgems and hotel spurs each crossed the rail *three*
      // times before this, and seed 2's station spur crossed twice more at a
      // pinch even after its main crossing went via a site).
      ...sameSideLeg(from, candidate.near, fromSide),
      // The crossing axis, pinned at the deck's edges and centre so the drawn
      // Catmull-Rom curve runs dead straight over the rail rather than bowing
      // off the deck between two distant feet.
      [site.x + site.dirX * DECK_HALF_LENGTH, site.z + site.dirZ * DECK_HALF_LENGTH] as const,
      [site.x, site.z] as const,
      [site.x - site.dirX * DECK_HALF_LENGTH, site.z - site.dirZ * DECK_HALF_LENGTH] as const,
      ...sameSideLeg(candidate.far, to, toSide),
    ];
  };
  // **Backtracks on route QUALITY, not just on collision**: the cheapest
  // site can leave a sub-leg the ordinary router gives up on (a raw 20 m
  // diagonal where the castle boxes in every axis-aligned corner — seed 5's
  // building spur, 2026-08-23), while the next site over routes cleanly.
  // Try the best few sites and keep the first whose drawn legs stay on
  // grid axes; if none manage it, keep the least-diagonal offender.
  // Each `build` may commit lattice paving through its legs, so only the
  // returned candidate's state may stand — see {@link latticeStateSnapshot}.
  const before = latticeStateSnapshot();
  let fallback: (readonly [number, number])[] | null = null;
  let fallbackWorst = Infinity;
  let fallbackState: LatticeStateSnapshot | null = null;
  for (const candidate of candidates.slice(0, 4)) {
    restoreLatticeState(before);
    const points = build(candidate);
    const worst = longestOffAxisRun(points, candidate.site);
    if (worst <= MAX_OFF_AXIS_RUN) return points;
    if (worst < fallbackWorst) {
      fallbackWorst = worst;
      fallback = points;
      fallbackState = latticeStateSnapshot();
    }
  }
  if (fallback && fallbackState) {
    restoreLatticeState(fallbackState);
    return fallback;
  }
  restoreLatticeState(before);
  return build(candidates[0] as (typeof candidates)[number]);
}

/**
 * Longest continuous off-axis (diagonal) stretch of a polyline, ignoring
 * hops that are the railway's own geometry (over/near the corridor — the
 * crossing axis and any fence-follow run), mirroring the exemption
 * `test/procgen/invariants.ts`'s `pathsRunOnGridAxes` measures with.
 */
const MAX_OFF_AXIS_RUN = 15;

function longestOffAxisRun(
  points: readonly (readonly [number, number])[],
  crossedSite: CrossingSite | null = null,
): number {
  let worst = 0;
  let run = 0;
  const flush = (): void => {
    worst = Math.max(worst, run);
    run = 0;
  };
  // A sample is the railway's own geometry when it hugs the corridor (a
  // fence-follow run) or stands inside a planned crossing's own footprint
  // band (the crossing axis, whose feet legitimately reach well past the
  // corridor). Mirrors `pathsRunOnGridAxes`'s measured exemptions.
  const exempt = (x: number, z: number): boolean => {
    if (railInfoAt(x, z).dist < 8.5) return true;
    // Only the leg's OWN crossing site earns a footprint exemption — a hop
    // that happens to pass along some other, unused site's would-be ramp
    // corridor gets no bridge built over it, so the invariant this metric
    // mirrors will count every metre of it (seed 5, 2026-08-23: a 39.8 m
    // raw diagonal read as 9.9 because an unrelated site's band split it).
    if (crossedSite) {
      const dx = x - crossedSite.x;
      const dz = z - crossedSite.z;
      const along = dx * crossedSite.dirX + dz * crossedSite.dirZ;
      const across = -dx * crossedSite.dirZ + dz * crossedSite.dirX;
      const reach =
        DECK_HALF_LENGTH + Math.max(crossedSite.rampReachPos, crossedSite.rampReachNeg) + 2;
      if (Math.abs(across) <= 6.5 && Math.abs(along) <= reach) return true;
    }
    return false;
  };
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as readonly [number, number];
    const b = points[i] as readonly [number, number];
    const dx = Math.abs(b[0] - a[0]);
    const dz = Math.abs(b[1] - a[1]);
    const hop = Math.hypot(dx, dz);
    if (hop < 1e-6) continue;
    if (Math.min(dx, dz) / hop <= 0.15) {
      flush();
      continue;
    }
    // Off-axis hop: accumulate only its non-exempt sampled length — a 39 m
    // hop whose midpoint alone was tested read as "near the rail" while
    // most of its length ran over open lawn (seed 5, 2026-08-23).
    const steps = Math.max(1, Math.ceil(hop / 2));
    for (let step = 0; step <= steps; step += 1) {
      const x = a[0] + ((b[0] - a[0]) * step) / steps;
      const z = a[1] + ((b[1] - a[1]) * step) / steps;
      if (exempt(x, z)) flush();
      else run += hop / steps;
    }
    worst = Math.max(worst, run);
  }
  flush();
  return worst;
}

/**
 * One leg held entirely on `side` of the railway: ordinary routing,
 * side-enforced; where enforcement cannot win — a clamp cannot fix
 * topology, and when the loop passes twice through the same few metres
 * (seed 2: two rail passes 9 m apart with a plot in the strip between
 * them) every direct line pierces the wedge between the passes — the
 * honest connected route is the one along the fence itself, around the
 * pinch on the leg's own side ({@link fenceFollowRoute}).
 */
function sameSideLeg(
  from: readonly [number, number],
  to: readonly [number, number],
  side: 1 | -1,
  allowDoubleCrossing = true,
): (readonly [number, number])[] {
  const direct = enforceRailSide(manhattanRoute(from, to), side);
  const directCrosses = polylineCrossesRail(direct);
  if (!directCrosses && longestOffAxisRun(direct) <= MAX_OFF_AXIS_RUN) return direct;
  // A fence-follow can commit lattice paving through a double-crossing's
  // legs; if the direct route wins the comparison below, that paving was
  // never drawn — roll it back (see {@link latticeStateSnapshot}).
  const beforeFence = latticeStateSnapshot();
  const fence = fenceFollowRoute(from, to, side, allowDoubleCrossing);
  if (directCrosses) return fence;
  // Both candidates stay on their side; the direct one merely carries a
  // long raw diagonal (an elbow give-up in a boxed-in pocket — seed 5's
  // building spur, 2026-08-23). A fence-following run is legal geometry
  // (the railway's own shape, exempt from the grid rule by measurement),
  // so pick whichever keeps the drawn network straighter.
  if (longestOffAxisRun(fence) < longestOffAxisRun(direct)) return fence;
  restoreLatticeState(beforeFence);
  return direct;
}

/**
 * Serve a same-side leg by crossing the railway twice — in through one
 * planned site, across the loop's other side (the park's main body, always
 * walkable), back out through another. The last resort for a pocket whose
 * own side pinches out against the boundary in both directions along the
 * fence: the ground the leg needs simply does not exist on its own side,
 * and this is exactly what the crossings are FOR (seed 2: the waterFight
 * anchor's strip narrowed under a ribbon's width both ways, and its walk
 * measurably stopped 21 m short of the plot).
 */
function doubleCrossingLeg(
  from: readonly [number, number],
  to: readonly [number, number],
  side: 1 | -1,
): (readonly [number, number])[] | null {
  const sites = [...CROSSING_SITES, ...LEVEL_CROSSING_SITES];
  if (sites.length < 2) return null;
  const pick = (x: number, z: number, not: CrossingSite | null): CrossingSite | null => {
    let best: CrossingSite | null = null;
    let bestCost = Infinity;
    for (const site of sites) {
      if (site === not) continue;
      const cost =
        Math.hypot(site.x - x, site.z - z) + (site.bridge ? 0 : LEVEL_CROSSING_PENALTY);
      if (cost < bestCost) {
        bestCost = cost;
        best = site;
      }
    }
    return best;
  };
  const siteIn = pick(from[0], from[1], null);
  const siteOut = pick(to[0], to[1], siteIn);
  if (!siteIn || !siteOut) return null;
  const inner: 1 | -1 = side === 1 ? -1 : 1;
  const feetIn = crossingFeet(siteIn);
  const feetOut = crossingFeet(siteOut);
  const nearIn = side === 1 ? feetIn.plus : feetIn.minus;
  const farIn = side === 1 ? feetIn.minus : feetIn.plus;
  const nearOut = side === 1 ? feetOut.minus : feetOut.plus;
  const farOut = side === 1 ? feetOut.plus : feetOut.minus;
  const axis = (site: CrossingSite): (readonly [number, number])[] => [
    [site.x + site.dirX * DECK_HALF_LENGTH, site.z + site.dirZ * DECK_HALF_LENGTH] as const,
    [site.x, site.z] as const,
    [site.x - site.dirX * DECK_HALF_LENGTH, site.z - site.dirZ * DECK_HALF_LENGTH] as const,
  ];
  // Each leg prefers the street lattice (committing its paving) and only
  // falls back to the old side-held continuous router where the lattice
  // cannot serve the ground — a double-crossing's legs run between
  // crossing feet across whole districts, exactly the runs that otherwise
  // land on private off-lattice lines (seed 18's dodgems spur: a 58 m
  // clamped run and two rogue streets, all from one of these legs).
  const leg = (
    a: readonly [number, number],
    b: readonly [number, number],
    legSide: 1 | -1,
    arrivalAtB: boolean,
  ): (readonly [number, number])[] => {
    const plan = planStreetBetween(a, b, false, arrivalAtB);
    if (plan) {
      commitStreetPlan(plan);
      return [...plan.points];
    }
    return sameSideLeg(a, b, legSide, false);
  };
  return [
    ...leg(from, nearIn, side, false),
    ...axis(siteIn),
    ...leg(farIn, nearOut, inner, false),
    ...axis(siteOut),
    ...leg(farOut, to, side, true),
  ];
}

/**
 * How far a clamped point stands from the rail centre line —
 * `RAIL_CORRIDOR_CLEARANCE` (`train/plan.ts`), the same "how far must a
 * structure stand off the rail" answer everything else uses: far enough
 * that the ribbon's own paved edge (half-width + kerb, up to 2.15 m for a
 * spur) stays outside the fence line, and past `crossings.ts`'s
 * `TOUCH_DISTANCE` so a clamped run does not smear the measured crossings
 * it was moved to stay out of.
 */
const RAIL_CLAMP_DISTANCE = RAIL_CORRIDOR_CLEARANCE_PLAN;

/**
 * Memoised "which side of the railway, and how far from it" — the two
 * questions every leg repair below asks thousands of times over the same
 * half-metre of ground (`enforceRailSide` re-scans each pass, the quality
 * metric samples every hop, and `routeLeg` tries several candidate sites).
 * `TrainRoute.distanceNear` walks the whole solved loop per query, and
 * unmemoised this took the `paths` solve stage from 12 ms to over a second
 * (`check:solve-cost`, 2026-08-23). Keyed on a 0.5 m grid — comfortably
 * finer than any decision threshold these queries feed (the clamp distance,
 * the 8.5 m exemption band), and deterministic.
 */
const railInfoCache = new Map<number, { side: 1 | -1; dist: number }>();
const railInfoScratch = { x: 0, z: 0 };
const railInfoTangent = new Vector3();

function railInfoAt(x: number, z: number): { side: 1 | -1; dist: number } {
  const key = (Math.round(x * 2) + 8192) * 32768 + (Math.round(z * 2) + 8192);
  const hit = railInfoCache.get(key);
  if (hit) return hit;
  const route = TRAIN_PLAN.route;
  const d = route.distanceNear(x, z);
  // `flatPointAt`, not `pointAt`: only x/z are read, and `pointAt` pays a
  // `terrainHeight` boundary walk to fill a y nobody looks at (25.7 ms of
  // the solve's one main-thread block, check:park-boot 2026-08-24).
  const p = route.flatPointAt(d, railInfoScratch);
  const t = route.tangentAt(d, railInfoTangent);
  const side: 1 | -1 = Math.sign(t.z * (x - p.x) - t.x * (z - p.z)) >= 0 ? 1 : -1;
  const info = { side, dist: Math.hypot(x - p.x, z - p.z) };
  railInfoCache.set(key, info);
  return info;
}

/** One point pulled to `side` of the rail at {@link RAIL_CLAMP_DISTANCE}. */
function clampPoint(x: number, z: number, side: 1 | -1): readonly [number, number] {
  const route = TRAIN_PLAN.route;
  const d = route.distanceNear(x, z);
  const p = route.pointAt(d, clampScratch);
  const t = route.tangentAt(d, clampTangent);
  // `side = +1` lies along (tangent.z, -tangent.x) — crossings.ts's own
  // convention, same as crossingPlan.ts's railSideOf.
  return [p.x + t.z * side * RAIL_CLAMP_DISTANCE, p.z - t.x * side * RAIL_CLAMP_DISTANCE] as const;
}

/**
 * Hold a whole routed leg on one side of the railway — the repair that
 * keeps a leg from ever actually crossing it mid-run. The ordinary routers
 * (`detourAroundBlockers`, `elbowLeg`, `gridDetour`) have never been
 * rail-aware, and making them so was measured (see the HANDOFF dead-ends)
 * to be either ruinously slow or too fat to thread the narrow strips
 * between rail and boundary. Three passes, iterated to a fixed point:
 *
 * 1. every wrong-side control point is pulled back to `side`;
 * 2. any segment that still slips across (sampled every metre — a pair of
 *    correct-side corners can straddle a narrow dip of the loop, which is
 *    exactly how one seed-2 spur crossed the railway twice with every
 *    corner individually "clear") gets a clamped midpoint inserted;
 * 3. any long segment running near the rail gets midpoints too, because
 *    the drawn ribbon is a Catmull-Rom through these points, and a sparse
 *    polyline hugging a bend lets the *curve* cut the corner the polyline
 *    avoided — control points every couple of metres pin it to the fence.
 */
function enforceRailSide(
  points: readonly (readonly [number, number])[],
  side: 1 | -1,
): (readonly [number, number])[] {
  // A leg's own two ENDPOINTS are destinations and stay exactly where they
  // are — a station's stand legitimately lives beside the platform, well
  // inside the corridor clearance, and clamping it moved four connectors'
  // terminals 2.05 m short of their own station nodes (seeds 2/18,
  // noPathEndsNowhere). Only the run between the ends is held clear.
  let out = points.map(([x, z], index) =>
    index === 0 ||
    index === points.length - 1 ||
    (railInfoAt(x, z).side === side && railInfoAt(x, z).dist >= RAIL_CLAMP_DISTANCE - 0.1)
      ? ([x, z] as const)
      : clampPoint(x, z, side),
  );
  for (let pass = 0; pass < 6; pass += 1) {
    let changed = false;
    const next: (readonly [number, number])[] = [];
    for (let i = 0; i < out.length; i += 1) {
      const a = out[i] as readonly [number, number];
      next.push(a);
      const b = out[i + 1];
      if (!b) break;
      // The final approach to either endpoint is allowed to enter the
      // corridor band — see the endpoint note above.
      if (i === 0 || i + 2 === out.length) continue;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 2.5) continue;
      // Does the segment slip across, or run sparsely near the rail?
      let slips = false;
      let nearRail = false;
      const steps = Math.ceil(length);
      for (let s = 1; s < steps; s += 1) {
        const x = a[0] + ((b[0] - a[0]) * s) / steps;
        const z = a[1] + ((b[1] - a[1]) * s) / steps;
        // "Slips" now covers converging as well as crossing: a run that
        // stays on its own side while drifting inside the corridor is a
        // path drawn down the middle of the railway (the canonical seed's
        // waterFight spur ran 20 m dead along the centre line, side never
        // changing, and its waypoints spawned inside the fence box).
        const info = railInfoAt(x, z);
        if (info.side !== side || info.dist < RAIL_CLAMP_DISTANCE - 0.1) slips = true;
        if (info.dist < RAIL_CLAMP_DISTANCE + 2.5) nearRail = true;
      }
      if (slips || (nearRail && length > 4)) {
        const mx = (a[0] + b[0]) / 2;
        const mz = (a[1] + b[1]) / 2;
        const mid =
          railInfoAt(mx, mz).side === side && !slips
            ? ([mx, mz] as const)
            : clampPoint(mx, mz, side);
        next.push(mid);
        changed = true;
      }
    }
    out = next;
    if (!changed) break;
  }
  return out;
}

const clampScratch = new Vector3();
const clampTangent = new Vector3();

/** Does the drawn polyline change rail sides anywhere along its length?
 * Sampled every metre — the same resolution `enforceRailSide` repairs at. */
function polylineCrossesRail(points: readonly (readonly [number, number])[]): boolean {
  let side: 1 | -1 | null = null;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i] as readonly [number, number];
    const b = points[i + 1] as readonly [number, number];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
    for (let s = 0; s <= steps; s += 1) {
      const x = a[0] + ((b[0] - a[0]) * s) / steps;
      const z = a[1] + ((b[1] - a[1]) * s) / steps;
      const here = railInfoAt(x, z).side;
      if (side !== null && here !== side) return true;
      side = here;
    }
  }
  return false;
}

/**
 * A leg that follows the railway fence, on `side`, from `from`'s stretch of
 * the loop to `to`'s — the last-resort connected route through a pinch (see
 * `routeLeg`'s own comment). Walks the shorter way round, one fence point
 * every ~3 m so the drawn curve genuinely follows the fence line rather
 * than chording across the very ground this route exists to avoid.
 */
function fenceFollowRoute(
  from: readonly [number, number],
  to: readonly [number, number],
  side: 1 | -1,
  allowDouble = true,
): (readonly [number, number])[] {
  const route = TRAIN_PLAN.route;
  const dFrom = route.distanceNear(from[0], from[1]);
  const dTo = route.distanceNear(to[0], to[1]);
  const forward = route.wrap(dTo - dFrom);

  const walkOf = (signed: number): (readonly [number, number])[] => {
    const steps = Math.max(1, Math.ceil(Math.abs(signed) / 3));
    const points: (readonly [number, number])[] = [from];
    for (let i = 0; i <= steps; i += 1) {
      const d = route.wrap(dFrom + (signed * i) / steps);
      const p = route.pointAt(d, clampScratch);
      points.push(clampPoint(p.x, p.z, side));
    }
    points.push(to);
    return points;
  };
  // How much of a candidate walk is genuinely standable ground: a fence
  // path squeezed against the boundary (the strips between rail and rim
  // pinch below a ribbon's width in places) is a route whose waypoints
  // spawn inside the wall, which is worse than a longer way round.
  const blockedCount = (points: readonly (readonly [number, number])[]): number => {
    let blocked = 0;
    for (const [x, z] of points) {
      if (PARK_BOUNDARY.distanceToEdge(x, z) < PLAYER_RADIUS + 1.3) blocked += 1;
    }
    return blocked;
  };
  const short = forward <= route.length / 2 ? forward : forward - route.length;
  const long = short > 0 ? short - route.length : short + route.length;
  const shortWalk = walkOf(short);
  const shortBlocked = blockedCount(shortWalk);
  if (shortBlocked === 0) return enforceRailSide(shortWalk, side);
  const longWalk = walkOf(long);
  const longBlocked = blockedCount(longWalk);
  if (longBlocked === 0) return enforceRailSide(longWalk, side);
  // Both ways round pinch out against the boundary: the ground this leg
  // needs does not exist on its own side. Cross the railway twice instead
  // — through planned sites, over the loop's other side — rather than
  // draw a ribbon through the boundary wall (see {@link doubleCrossingLeg}).
  if (allowDouble) {
    const doubled = doubleCrossingLeg(from, to, side);
    if (doubled) return doubled;
  }
  return enforceRailSide(longBlocked < shortBlocked ? longWalk : shortWalk, side);
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

// ---------------------------------------------------------------- streets
//
// **The street lattice** (issue #269 rework, 23 August 2026 — Jim, on the
// previous "axis-aligned" network's top-down view: "that top-down view looks
// nothing like how we discussed"). The old pipeline routed every spur
// independently in continuous space (`detourAroundBlockers`) and then folded
// each diagonal into elbows (`elbowLeg`) — so every corner landed wherever
// its own diagonal happened to be, and the built network's north-south runs
// sat on ~19 different x-positions with nothing sharing a street line
// anywhere. Every segment was axis-aligned; the network still read as
// organic wandering, because "reads as a grid" is a property of the *set of
// lines* the segments sit on, not of any one segment's own heading.
//
// So routes are now solved ON a fixed lattice first, and the old machinery
// is kept only as a fallback for ground the lattice genuinely cannot serve
// (a pocket pinched between rail and boundary too narrow for any lattice
// node — the same ground `fenceFollowRoute` exists for):
//
// - **One grid, fixed pitch** (`STREET_PITCH`, 12 m — Decision 1), anchored
//   at the plaza so the statue circle's four compass streets (Decision 5)
//   lie exactly on lattice lines whatever the seed.
// - **Routing is Dijkstra on the lattice graph** against the same blockers,
//   boundary and railway screens the old routers used, with a turn penalty
//   (streets prefer to run straight — `STREET_TURN_PENALTY`) and
//   terminate-at-network goals (a route stops the moment it reaches paving,
//   so later routes extend earlier streets instead of paving parallel ones).
// - **Junctions land only on lattice nodes**, shared exactly (same float
//   coordinates), so `buildRouteDistanceGraph` sees real crossroads.
// - **Doors keep their doormats**: a short stub (at most one lattice cell,
//   elbowed via the node's own street line) connects each destination's
//   lead point to the lattice — the genuine minority of off-grid metres
//   Decision 6 allows, alongside the railway's own crossing geometry.

/** Lattice pitch — Decision 1's "grid pitch 12 m". The one big number. */
const STREET_PITCH = 12;

/** Cells each way from the plaza the lattice extends. ±14 cells is ±168 m,
 * comfortably past every boundary spline the generator produces (measured
 * extent on the canonical seed: x -51..83, z -48..58 about a plaza near the
 * origin); nodes outside the boundary are simply invalid. */
const LATTICE_HALF_CELLS = 14;

/**
 * Extra metres a turn costs the street search. Any positive value picks the
 * fewest-turns route among equal-length Manhattan paths (they are all the
 * same length, so the penalty is the only tie-breaker that matters); a
 * larger one also accepts a slightly longer route to avoid zig-zagging.
 * Half a cell reads well: a street will run straight past one blocked-off
 * shortcut rather than staircase around it, but never detour a whole block.
 */
const STREET_TURN_PENALTY = 6;

/** A stub or connector's metres count a little more than street metres, so
 * the search prefers walking the lattice over long off-grid connectors. */
const STUB_COST_FACTOR = 1.25;

/** How far off a lattice node's own cell a stub's off-lattice tail may run.
 * A stub elbowed via the node's own street line keeps one leg exactly on
 * the lattice; the other (the tail, along the destination's own x or z) must
 * stay shorter than the new lattice invariant's own straight-run threshold,
 * or the stub itself would read as a rogue street line. */
const STUB_TAIL_LIMIT = 7.8;

/**
 * Clearance a street keeps from a plot's **real footprint edge** and from
 * the boundary: the ribbon's own half-width plus kerb (up to 1.6 + 0.85 for
 * a 3.2 m street) and a small walking verge. The lattice screens against
 * real footprints, not `BLOCKERS`' bounding circles, deliberately: a
 * bounding circle over-approximates a big rectangular anchor by many
 * metres, and at a fixed 12 m pitch that over-approximation starved the
 * whole park interior of edges (measured: the first lattice attempt had
 * almost no valid edges inside the rail loop — the exact ground the
 * streets exist to serve). The old continuous routers keep their circles;
 * they weave at arbitrary angles and never needed the precision.
 */
const STREET_PLOT_CLEARANCE = 2.6;

/** Distance from a point to a placed plot's own footprint edge (negative
 * inside). Plots are axis-aligned by construction (`edgeDistanceAlong`'s
 * own comment). */
function distanceToPlotEdge(
  entry: { x: number; z: number; footprint: { kind: 'circle'; radius: number } | { kind: 'rect'; halfX: number; halfZ: number } },
  x: number,
  z: number,
): number {
  if (entry.footprint.kind === 'circle') {
    return Math.hypot(x - entry.x, z - entry.z) - entry.footprint.radius;
  }
  const dx = Math.abs(x - entry.x) - entry.footprint.halfX;
  const dz = Math.abs(z - entry.z) - entry.footprint.halfZ;
  const ox = Math.max(dx, 0);
  const oz = Math.max(dz, 0);
  const outside = Math.hypot(ox, oz);
  return outside > 0 ? outside : Math.max(dx, dz);
}

/** The placed plots a street must clear — every layout entry except the
 * fountain (the plaza is paving, not an obstacle). */
let streetPlotsCache:
  | readonly { x: number; z: number; footprint: { kind: 'circle'; radius: number } | { kind: 'rect'; halfX: number; halfZ: number } }[]
  | null = null;
function streetPlots(): readonly {
  x: number;
  z: number;
  footprint: { kind: 'circle'; radius: number } | { kind: 'rect'; halfX: number; halfZ: number };
}[] {
  if (!streetPlotsCache) {
    streetPlotsCache = [...PARK_LAYOUT.entries.values()]
      .filter((entry) => entry.id !== 'fountain')
      .map((entry) => ({ x: entry.x, z: entry.z, footprint: entry.footprint }));
  }
  return streetPlotsCache;
}

/** The arch-foot circles from {@link BLOCKERS} — posts are genuinely round,
 * so the circle test stays exact for them. */
let archFootBlockersCache: readonly Blocker[] | null = null;
function archFootBlockers(): readonly Blocker[] {
  if (!archFootBlockersCache) {
    archFootBlockersCache = BLOCKERS.filter((blocker) => blocker.kind === 'archFoot');
  }
  return archFootBlockersCache;
}

/**
 * Memoised {@link PARK_BOUNDARY} edge distance on a half-metre grid — the
 * street screens ask this thousands of times along the same lattice lines,
 * and the spline walk behind `distanceToEdge` was the paths solve's single
 * biggest cost (`check:park-boot` polices the whole solve as one
 * main-thread block). Same shape and key as {@link railInfoCache}; the
 * half-metre quantisation is far finer than any screen threshold here.
 */
const boundaryDistanceCache = new Map<number, number>();
function boundaryDistanceCached(x: number, z: number): number {
  const key = (Math.round(x * 2) + 8192) * 32768 + (Math.round(z * 2) + 8192);
  const hit = boundaryDistanceCache.get(key);
  if (hit !== undefined) return hit;
  const distance = PARK_BOUNDARY.distanceToEdge(x, z);
  boundaryDistanceCache.set(key, distance);
  return distance;
}

/**
 * True when every ~1.5 m sample of the segment keeps
 * {@link STREET_PLOT_CLEARANCE} from every plot's real footprint (plots
 * within `exemptNear` metres of `exemptAt` are skipped — the "arriving at a
 * destination" allowance, exactly the reasoning `segmentClearOfBlockers`'s
 * own endpoint exemption encodes), the same clearance from the boundary,
 * and clear of every arch foot.
 */
function streetSegmentClear(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  exemptAt: readonly [number, number] | null = null,
  exemptNear = 0,
  boundaryMargin = STREET_PLOT_CLEARANCE,
  plotMargin = STREET_PLOT_CLEARANCE,
): boolean {
  const plots = streetPlots();
  const active = exemptAt
    ? plots.filter((plot) => distanceToPlotEdge(plot, exemptAt[0], exemptAt[1]) > exemptNear)
    : plots;
  const relaxed = exemptAt
    ? plots.filter((plot) => distanceToPlotEdge(plot, exemptAt[0], exemptAt[1]) <= exemptNear)
    : [];
  const length = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(length / 1.5));
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    for (const plot of active) {
      if (distanceToPlotEdge(plot, x, z) < plotMargin) return false;
    }
    // A destination's own frontage may be walked along, never through.
    for (const plot of relaxed) {
      if (distanceToPlotEdge(plot, x, z) < 0.3) return false;
    }
    if (boundaryDistanceCached(x, z) < boundaryMargin) return false;
    for (const foot of archFootBlockers()) {
      if (Math.hypot(x - foot.x, z - foot.z) < foot.radius) return false;
    }
  }
  return true;
}

interface LatticeTap {
  /** Node the tap street reaches, on the compass lattice line — or, for a
   * `crossing` tap, the far foot's own stub node across the railway. */
  readonly index: number;
  /** Where the tap leaves the ring's own drawn circle — one of
   * {@link RING_COMPASS_POINTS}, which are all ring control points. */
  readonly rim: readonly [number, number];
  /** `compass`: a straight street from the rim out along its lattice line.
   * `crossing`: a planned rail crossing whose near ramp lands beside the
   * statue circle — the route runs rim, ramp foot, deck, far foot, node
   * ({@link via}). Decision 5 still holds: the bridge feeds into one of
   * the four compass gateways, not a fifth connection of its own. */
  readonly kind: 'compass' | 'crossing';
  /** Intermediate points from just after {@link rim} to just before the
   * node, in rim-to-node order. Empty for a compass tap. */
  readonly via: readonly (readonly [number, number])[];
  /** Extra route-cost of terminating here (the rim-to-node walk, plus the
   * level-crossing penalty where the site is not a bridge). */
  readonly cost: number;
}

/** One neighbour reachable from a lattice node: a straight street edge, or
 * a pinch link (Decision 6's minority diagonal — see {@link streetLattice}'s
 * pinch pass). `via` carries a pinch link's intermediate points, in
 * from→to order; empty for a straight edge. */
interface LatticeNeighbour {
  readonly to: number;
  /** 0-3: the four street directions; 4-7: the four diagonals. */
  readonly dir: number;
  readonly cost: number;
  readonly via: readonly (readonly [number, number])[];
}

interface StreetLattice {
  readonly count: number;
  /** World coordinates per node index (invalid nodes still have these). */
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly nodeOk: Uint8Array;
  readonly side: Int8Array;
  /** Walkable edge from node to its +x / +z neighbour. */
  readonly edgeEast: Uint8Array;
  readonly edgeSouth: Uint8Array;
  /** Full adjacency, straight edges plus pinch links. */
  readonly neighbours: readonly (readonly LatticeNeighbour[])[];
  /** The statue ring's four compass streets — Decision 5's only ring
   * connections, one per compass point that has a reachable node. */
  readonly taps: readonly LatticeTap[];
  readonly indexOf: (i: number, j: number) => number;
  readonly cellOf: (index: number) => readonly [number, number];
}

/** Everything already paved on the lattice — grown as routes commit. */
const pavedLatticeNodes = new Set<number>();
const pavedLatticeEdges = new Set<string>();
const usedTaps = new Set<number>();

/**
 * Snapshot/restore of the paved-lattice bookkeeping, for candidate
 * exploration: `routeLeg` commits street paving as its legs solve, so a
 * caller trying several candidate routes and keeping one (the fallback's
 * quality scoring) must roll the state back between tries — a losing
 * candidate's paving is never drawn, and a later route terminating on it
 * would "branch off nothing" (measured: seed 18's station spur started
 * 11 m from any real paving, on a phantom node a rejected candidate left
 * marked paved).
 */
interface LatticeStateSnapshot {
  readonly nodes: readonly number[];
  readonly edges: readonly string[];
  readonly taps: readonly number[];
  readonly rims: readonly number[];
}

function latticeStateSnapshot(): LatticeStateSnapshot {
  return {
    nodes: [...pavedLatticeNodes],
    edges: [...pavedLatticeEdges],
    taps: [...usedTaps],
    rims: [...tapRimsDrawn],
  };
}

function restoreLatticeState(snapshot: LatticeStateSnapshot): void {
  pavedLatticeNodes.clear();
  for (const node of snapshot.nodes) pavedLatticeNodes.add(node);
  pavedLatticeEdges.clear();
  for (const edge of snapshot.edges) pavedLatticeEdges.add(edge);
  usedTaps.clear();
  for (const tap of snapshot.taps) usedTaps.add(tap);
  tapRimsDrawn.clear();
  for (const rim of snapshot.rims) tapRimsDrawn.add(rim);
}

function latticeEdgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** True if the segment keeps genuinely clear of the statue circle — streets
 * never cut through the ring's own ground (the plaza and statue live there,
 * and the ring must stay a clean circle with exactly four compass taps). */
function segmentClearOfRing(ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq > 1e-9
      ? Math.max(0, Math.min(1, ((PLAZA.x - ax) * dx + (PLAZA.z - az) * dz) / lengthSq))
      : 0;
  return Math.hypot(PLAZA.x - (ax + dx * t), PLAZA.z - (az + dz * t)) >= RING_RADIUS + 0.5;
}

/** Rail screen for a lattice edge or stub: every sample stays on `side` and
 * (for street edges) outside the rail corridor. Stubs pass `0` for
 * `minDistance` — a station's own lead legitimately stands near the rail. */
function segmentHoldsRailSide(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  side: 1 | -1,
  minDistance: number,
): boolean {
  const length = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(length / 2));
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const info = railInfoAt(ax + (bx - ax) * t, az + (bz - az) * t);
    if (info.side !== side || info.dist < minDistance) return false;
  }
  return true;
}

/**
 * The ginormous slide's ground track, sampled coarsely — the corridor its
 * legs must land in. A street running *along* it starves every leg of
 * standable ground (`slide/supports.ts`'s `PATH_CLEARANCE` rejects a post
 * within 2.8 m of paving; measured on seed 11: 53 of 61 track samples were
 * on paving and the 72 m chute built 0 legs). Streets crossing under the
 * chute are fine — the legs' own placement nudges around a crossing — so
 * this screens whole lattice edges, whose 12 m runs are exactly the
 * along-track case, and leaves stubs and fallback legs alone.
 */
let slideTrackSamplesCache: readonly (readonly [number, number])[] | null = null;
function slideTrackSamples(): readonly (readonly [number, number])[] {
  if (slideTrackSamplesCache) return slideTrackSamplesCache;
  const samples: [number, number][] = [];
  const route = SLIDE_PLAN.route;
  const point = new Vector3();
  if (Number.isFinite(route.length) && route.length > 0) {
    const steps = Math.max(2, Math.ceil(route.length / 3));
    for (let i = 0; i <= steps; i += 1) {
      route.pointAt((i / steps) * route.length, point);
      samples.push([point.x, point.z]);
    }
  }
  slideTrackSamplesCache = samples;
  return samples;
}

/** How much of the segment runs within a leg's clearance of the slide's
 * ground track, in metres of overlap — a crossing measures ~7 m, a street
 * running along the corridor measures most of its own length. */
function slideCorridorOverlap(ax: number, az: number, bx: number, bz: number): number {
  const track = slideTrackSamples();
  if (track.length === 0) return 0;
  const length = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(length / 1.5));
  let overlap = 0;
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    for (const [tx, tz] of track) {
      if (Math.hypot(x - tx, z - tz) < 3.6) {
        overlap += length / steps;
        break;
      }
    }
  }
  return overlap;
}

/** The slide-corridor rule for one street edge, with the overlap computed
 * once: crossing under the chute is fine (both endpoints clear of the
 * band), running along it is not. */
function slideEdgeAllowed(ax: number, az: number, bx: number, bz: number): boolean {
  const overlap = slideCorridorOverlap(ax, az, bx, bz);
  if (overlap <= 0.01) return true;
  return overlap <= 8 && !pointInSlideCorridor(ax, az) && !pointInSlideCorridor(bx, bz);
}

/** True when the point stands inside the slide legs' clearance band. */
function pointInSlideCorridor(x: number, z: number): boolean {
  for (const [tx, tz] of slideTrackSamples()) {
    if (Math.hypot(x - tx, z - tz) < 3.6) return true;
  }
  return false;
}

/**
 * True when the segment cuts **sideways through a planned bridge site's own
 * ramp corridor**. A route that crosses the railway HERE becomes the
 * bridge: a humpback deck flanked by parapet walls running the whole ramp
 * (`train/bridges.ts`). A street crossing that corridor at an angle slams
 * into those parapets from the side — 2D-clear at path-solve time, a solid
 * wall once the bridge is built over it (found on the merged bridge
 * geometry: an east-west avenue crossed the ferris crossing's ramp and ten
 * `poiGraph` waypoints along it could no longer be walked to). The
 * crossing's own chain travels ALONG the axis via its own points, never
 * through this screen. Level-crossing sites stay flat, so only bridge
 * sites carry it.
 */
function segmentCutsABridgeRamp(ax: number, az: number, bx: number, bz: number): boolean {
  const length = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(length / 1.5));
  for (const site of CROSSING_SITES) {
    if (!site.bridge) continue;
    const reachPos = DECK_HALF_LENGTH + site.rampReachPos + 1.5;
    const reachNeg = DECK_HALF_LENGTH + site.rampReachNeg + 1.5;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      const dx = x - site.x;
      const dz = z - site.z;
      const along = dx * site.dirX + dz * site.dirZ;
      const across = -dx * site.dirZ + dz * site.dirX;
      if (Math.abs(across) <= SITE_HALF_WIDTH + 0.5 && along <= reachPos && along >= -reachNeg) {
        return true;
      }
    }
  }
  return false;
}

/** The Sky Cruiser's pylons have the same relationship to streets as the
 * slide's legs: `LampPosts.ts` lights every ribbon, and a lamp is exactly
 * what steals a pylon's spot (`skyCruiserStandsOnItsOwnSupports`, and
 * {@link routeCrossesARideCorridor}'s own history). Same screen, same
 * shape: crossing under the track is fine, running along it is not. */
function cruiserCorridorOverlap(ax: number, az: number, bx: number, bz: number): number {
  const track = rideCorridorSamples();
  if (track.length === 0) return 0;
  const length = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(length / 1.5));
  let overlap = 0;
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    for (const [tx, tz] of track) {
      if (Math.hypot(x - tx, z - tz) < RIDE_CORRIDOR_CLEARANCE) {
        overlap += length / steps;
        break;
      }
    }
  }
  return overlap;
}


let latticeCache: StreetLattice | null = null;

/** The lattice graph, solved once from the same inputs every router uses. */
function streetLattice(): StreetLattice {
  if (latticeCache) return latticeCache;
  const size = LATTICE_HALF_CELLS * 2 + 1;
  const count = size * size;
  const indexOf = (i: number, j: number): number =>
    (i + LATTICE_HALF_CELLS) * size + (j + LATTICE_HALF_CELLS);
  const cellOf = (index: number): readonly [number, number] => [
    Math.floor(index / size) - LATTICE_HALF_CELLS,
    (index % size) - LATTICE_HALF_CELLS,
  ];
  const xs = new Float64Array(count);
  const zs = new Float64Array(count);
  const nodeOk = new Uint8Array(count);
  const side = new Int8Array(count);
  for (let i = -LATTICE_HALF_CELLS; i <= LATTICE_HALF_CELLS; i += 1) {
    for (let j = -LATTICE_HALF_CELLS; j <= LATTICE_HALF_CELLS; j += 1) {
      const index = indexOf(i, j);
      const x = PLAZA.x + i * STREET_PITCH;
      const z = PLAZA.z + j * STREET_PITCH;
      xs[index] = x;
      zs[index] = z;
      // A node needs room for the ribbon's own paved edge (real footprints,
      // not bounding circles — see {@link STREET_PLOT_CLEARANCE}), must
      // stand off the statue circle's ground and out of the rail corridor
      // (the fence's own wall stands at RAIL_CLAMP_DISTANCE).
      const clear = streetSegmentClear(x, z, x, z);
      const inRing = Math.hypot(x - PLAZA.x, z - PLAZA.z) < RING_RADIUS + 1;
      const rail = railInfoAt(x, z);
      nodeOk[index] = clear && !inRing && rail.dist >= RAIL_CLAMP_DISTANCE ? 1 : 0;
      side[index] = rail.side;
    }
  }
  const edgeEast = new Uint8Array(count);
  const edgeSouth = new Uint8Array(count);
  const edgeOk = (a: number, b: number): boolean => {
    if (!nodeOk[a] || !nodeOk[b] || side[a] !== side[b]) return false;
    const ax = xs[a] as number;
    const az = zs[a] as number;
    const bx = xs[b] as number;
    const bz = zs[b] as number;
    return (
      streetSegmentClear(ax, az, bx, bz) &&
      segmentClearOfRing(ax, az, bx, bz) &&
      segmentHoldsRailSide(ax, az, bx, bz, side[a] as 1 | -1, RAIL_CLAMP_DISTANCE - 0.1) &&
      // Crossing under the chute is fine — the legs' own placement nudges
      // step around a perpendicular band of paving — but running *along*
      // the corridor starves them, and several consecutive edges each just
      // under a flat overlap cap still added up to a 28 m corridor-long
      // street on seed 11. So an edge may only touch the corridor at all
      // when it genuinely passes through (both endpoints clear of the
      // band), and never for more than a perpendicular crossing's worth.
      slideEdgeAllowed(ax, az, bx, bz) &&
      cruiserCorridorOverlap(ax, az, bx, bz) <= 9 &&
      !segmentCutsABridgeRamp(ax, az, bx, bz)
    );
  };
  for (let i = -LATTICE_HALF_CELLS; i <= LATTICE_HALF_CELLS; i += 1) {
    for (let j = -LATTICE_HALF_CELLS; j <= LATTICE_HALF_CELLS; j += 1) {
      const index = indexOf(i, j);
      if (i < LATTICE_HALF_CELLS) edgeEast[index] = edgeOk(index, indexOf(i + 1, j)) ? 1 : 0;
      if (j < LATTICE_HALF_CELLS) edgeSouth[index] = edgeOk(index, indexOf(i, j + 1)) ? 1 : 0;
    }
  }

  // Full adjacency: the straight street edges above, plus **pinch links** —
  // Decision 6's "genuine minority" diagonals, added *only* where the grid
  // itself is blocked: two diagonal-neighbour nodes whose both L-shaped
  // street routes are unavailable (a plot or the boundary pinches the
  // block) get one chamfered shortcut — a short on-street stub out of each
  // node with a diagonal between them, so the drawn run stays well inside
  // `MAX_DIAGONAL_APPROACH` and the link reads as a deliberate cut corner,
  // not a street on its own heading. Where the grid works, no diagonal is
  // ever added, which is what keeps them a minority by construction.
  const neighbours: LatticeNeighbour[][] = Array.from({ length: count }, () => []);
  for (let i = -LATTICE_HALF_CELLS; i <= LATTICE_HALF_CELLS; i += 1) {
    for (let j = -LATTICE_HALF_CELLS; j <= LATTICE_HALF_CELLS; j += 1) {
      const index = indexOf(i, j);
      if (i < LATTICE_HALF_CELLS && edgeEast[index]) {
        const other = indexOf(i + 1, j);
        (neighbours[index] as LatticeNeighbour[]).push({ to: other, dir: 0, cost: STREET_PITCH, via: [] });
        (neighbours[other] as LatticeNeighbour[]).push({ to: index, dir: 1, cost: STREET_PITCH, via: [] });
      }
      if (j < LATTICE_HALF_CELLS && edgeSouth[index]) {
        const other = indexOf(i, j + 1);
        (neighbours[index] as LatticeNeighbour[]).push({ to: other, dir: 2, cost: STREET_PITCH, via: [] });
        (neighbours[other] as LatticeNeighbour[]).push({ to: index, dir: 3, cost: STREET_PITCH, via: [] });
      }
    }
  }
  const PINCH_STUB = 4;
  const PINCH_COST_FACTOR = 1.3;
  for (let i = -LATTICE_HALF_CELLS; i < LATTICE_HALF_CELLS; i += 1) {
    for (let j = -LATTICE_HALF_CELLS; j <= LATTICE_HALF_CELLS; j += 1) {
      for (const dj of [1, -1] as const) {
        if (Math.abs(j + dj) > LATTICE_HALF_CELLS) continue;
        const a = indexOf(i, j);
        const b = indexOf(i + 1, j + dj);
        if (!nodeOk[a] || !nodeOk[b] || side[a] !== side[b]) continue;
        // Is either L available? Corner nodes are (i+1, j) and (i, j+dj).
        const eastEdge = edgeEast[a];
        const cornerA = indexOf(i + 1, j);
        const cornerB = indexOf(i, j + dj);
        const lViaEast =
          eastEdge && (dj === 1 ? edgeSouth[cornerA] : edgeSouth[indexOf(i + 1, j + dj)]);
        const lViaSouth =
          (dj === 1 ? edgeSouth[a] : edgeSouth[indexOf(i, j - 1)]) && edgeEast[cornerB];
        if (lViaEast || lViaSouth) continue;
        const ax = xs[a] as number;
        const az = zs[a] as number;
        const bx = xs[b] as number;
        const bz = zs[b] as number;
        const railSide = side[a] as 1 | -1;
        const linkClear = (
          points: readonly (readonly [number, number])[],
        ): boolean => {
          let slideOverlap = 0;
          for (let s = 1; s < points.length; s += 1) {
            const p = points[s - 1] as readonly [number, number];
            const q = points[s] as readonly [number, number];
            if (
              !streetSegmentClear(p[0], p[1], q[0], q[1]) ||
              !segmentClearOfRing(p[0], p[1], q[0], q[1]) ||
              !segmentHoldsRailSide(p[0], p[1], q[0], q[1], railSide, RAIL_CLAMP_DISTANCE - 0.1)
            )
              return false;
            if (segmentCutsABridgeRamp(p[0], p[1], q[0], q[1])) return false;
            slideOverlap += slideCorridorOverlap(p[0], p[1], q[0], q[1]);
            slideOverlap += cruiserCorridorOverlap(p[0], p[1], q[0], q[1]);
          }
          // A pinch link's diagonal is the shape most prone to running
          // *along* a ride's support corridor (the track curves; the
          // chamfer cuts the same corner) — same starvation the straight
          // edges are screened for, for the slide's legs and the
          // cruiser's pylons alike.
          return slideOverlap <= 4;
        };
        // Two chamfer shapes: leave both nodes along x, or both along z.
        const shapes: readonly (readonly (readonly [number, number])[])[] = [
          [
            [ax, az],
            [ax + PINCH_STUB, az],
            [bx - PINCH_STUB, bz],
            [bx, bz],
          ],
          [
            [ax, az],
            [ax, az + PINCH_STUB * dj],
            [bx, bz - PINCH_STUB * dj],
            [bx, bz],
          ],
        ];
        for (const shape of shapes) {
          if (!linkClear(shape)) continue;
          let length = 0;
          for (let s = 1; s < shape.length; s += 1) {
            const p = shape[s - 1] as readonly [number, number];
            const q = shape[s] as readonly [number, number];
            length += Math.hypot(q[0] - p[0], q[1] - p[1]);
          }
          const cost = length * PINCH_COST_FACTOR;
          const via = shape.slice(1, -1);
          const dirAB = dj === 1 ? 4 : 5;
          const dirBA = dj === 1 ? 6 : 7;
          (neighbours[a] as LatticeNeighbour[]).push({ to: b, dir: dirAB, cost, via });
          (neighbours[b] as LatticeNeighbour[]).push({
            to: a,
            dir: dirBA,
            cost,
            via: [...via].reverse(),
          });
          break;
        }
      }
    }
  }

  // The four compass taps (Decision 5: "exactly 4 connections at compass
  // points"): each walks outward from the ring's rim along its own compass
  // lattice line to the first valid node with a clear, on-line street
  // segment between them.
  const taps: LatticeTap[] = [];
  const compassDirs: readonly (readonly [number, number])[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const [di, dj] of compassDirs) {
    const rim: readonly [number, number] = [
      PLAZA.x + di * RING_RADIUS,
      PLAZA.z + dj * RING_RADIUS,
    ];
    const firstCell = Math.floor(RING_RADIUS / STREET_PITCH) + 1;
    for (let cell = firstCell; cell <= firstCell + 2; cell += 1) {
      const i = di * cell;
      const j = dj * cell;
      if (Math.abs(i) > LATTICE_HALF_CELLS || Math.abs(j) > LATTICE_HALF_CELLS) break;
      const index = indexOf(i, j);
      if (!nodeOk[index]) continue;
      const nx = xs[index] as number;
      const nz = zs[index] as number;
      if (
        streetSegmentClear(rim[0], rim[1], nx, nz) &&
        segmentHoldsRailSide(rim[0], rim[1], nx, nz, side[index] as 1 | -1, 0)
      ) {
        taps.push({
          index,
          rim,
          kind: 'compass',
          via: [],
          cost: Math.hypot(rim[0] - nx, rim[1] - nz),
        });
        break;
      }
    }
  }

  latticeCache = { count, xs, zs, nodeOk, side, edgeEast, edgeSouth, neighbours, taps, indexOf, cellOf };

  // **Planned crossings are lattice edges too.** Every crossing site links
  // the lattice node nearest each of its two feet, via the feet and the
  // deck axis — so ONE search serves any destination, however many rail
  // crossings and islands lie between it and the paved network. The first
  // architecture routed each crossing with bespoke two-leg planning
  // ("near leg to the network, far leg to the target") and could not
  // bootstrap: a crossing whose near foot stood on a not-yet-paved island
  // failed even though a second crossing would have connected that island
  // — exactly the shape of park seed 18 builds (a rail lobe two crossings
  // from the gate). Encoding the sites as graph edges makes multi-crossing
  // routes fall out of plain Dijkstra rather than being a special case.
  // Registered after the cache is set because the stub search below reads
  // the finished node/edge tables through it.
  for (const site of [...CROSSING_SITES, ...LEVEL_CROSSING_SITES]) {
    const feet = crossingFeet(site);
    const stubsPlus = streetStubs(feet.plus, false);
    const stubsMinus = streetStubs(feet.minus, false);
    if (stubsPlus.length === 0 || stubsMinus.length === 0) {
      // **A ramp landing beside the statue circle still crosses somewhere
      // real.** A foot with no lattice stub because it stands inside the
      // ring's own guard zone (every node and leg there is deliberately
      // invalid) is not unusable — it lands beside the promenade, and the
      // ring is the paved backbone. When that foot sits close to one of
      // the four compass gateways, the crossing is registered as a
      // `crossing` tap: routes on the far side may terminate over the
      // bridge onto the ring, still through a compass point (Decision 5).
      const plusFootless = stubsPlus.length === 0;
      const footless = plusFootless ? feet.plus : feet.minus;
      const otherStubs = plusFootless ? stubsMinus : stubsPlus;
      const compass = nearestCompassPoint(footless[0], footless[1]);
      const compassGap = Math.hypot(compass[0] - footless[0], compass[1] - footless[1]);
      const nearRing =
        Math.hypot(footless[0] - PLAZA.x, footless[1] - PLAZA.z) <= RING_RADIUS + 4;
      if (otherStubs.length > 0 && nearRing && compassGap <= 8) {
        const stub = otherStubs[0] as StreetStub;
        const plusDeck: readonly [number, number] = [
          site.x + site.dirX * DECK_HALF_LENGTH,
          site.z + site.dirZ * DECK_HALF_LENGTH,
        ];
        const minusDeck: readonly [number, number] = [
          site.x - site.dirX * DECK_HALF_LENGTH,
          site.z - site.dirZ * DECK_HALF_LENGTH,
        ];
        const via: (readonly [number, number])[] = [
          footless,
          ...(plusFootless
            ? [plusDeck, [site.x, site.z] as const, minusDeck]
            : [minusDeck, [site.x, site.z] as const, plusDeck]),
          ...[...stub.points.slice(1)].reverse(), // far foot, then its corner if any
        ];
        const chain = [
          compass,
          ...via,
          [xs[stub.node] as number, zs[stub.node] as number] as const,
        ];
        let tapLength = 0;
        for (let s = 1; s < chain.length; s += 1) {
          const p = chain[s - 1] as readonly [number, number];
          const q = chain[s] as readonly [number, number];
          tapLength += Math.hypot(q[0] - p[0], q[1] - p[1]);
        }
        taps.push({
          index: stub.node,
          rim: compass,
          kind: 'crossing',
          via,
          cost: tapLength + (site.bridge ? 0 : LEVEL_CROSSING_PENALTY * 2),
        });
        continue;
      }
      if (DEBUG_STREETS) {
        // eslint-disable-next-line no-console
        console.log(
          `[lattice] crossing at ${site.x.toFixed(1)},${site.z.toFixed(1)} NOT linked: ` +
            `plus foot ${feet.plus[0].toFixed(1)},${feet.plus[1].toFixed(1)} stubs ${stubsPlus.length}, ` +
            `minus foot ${feet.minus[0].toFixed(1)},${feet.minus[1].toFixed(1)} stubs ${stubsMinus.length}`,
        );
      }
      continue;
    }
    const stubPlus = stubsPlus[0] as StreetStub;
    const stubMinus = stubsMinus[0] as StreetStub;
    if (stubPlus.node === stubMinus.node) continue;
    const plusDeck: readonly [number, number] = [
      site.x + site.dirX * DECK_HALF_LENGTH,
      site.z + site.dirZ * DECK_HALF_LENGTH,
    ];
    const minusDeck: readonly [number, number] = [
      site.x - site.dirX * DECK_HALF_LENGTH,
      site.z - site.dirZ * DECK_HALF_LENGTH,
    ];
    // From the plus node: its stub out to the plus foot, over the deck,
    // then the minus stub in reverse (foot first, node last).
    const viaPlusToMinus: (readonly [number, number])[] = [
      ...stubPlus.points.slice(1), // corner?, plus foot
      plusDeck,
      [site.x, site.z],
      minusDeck,
      ...[...stubMinus.points.slice(1)].reverse(), // minus foot, corner?
    ];
    let length = 0;
    const chain: (readonly [number, number])[] = [
      [xs[stubPlus.node] as number, zs[stubPlus.node] as number],
      ...viaPlusToMinus,
      [xs[stubMinus.node] as number, zs[stubMinus.node] as number],
    ];
    for (let s = 1; s < chain.length; s += 1) {
      const p = chain[s - 1] as readonly [number, number];
      const q = chain[s] as readonly [number, number];
      length += Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    // Twice the routeLeg-era penalty, deliberately: the graph search
    // compares whole-network walks where terminating on any already-paved
    // street makes a nearby level crossing look cheap in a way the old
    // two-leg comparison never saw — measured on seed 11, a level site
    // 31 m from a perfectly good bridge won under the plain penalty and
    // put a level crossing where Decision 8 wants the rare exception.
    const cost = length + (site.bridge ? 0 : LEVEL_CROSSING_PENALTY * 2);
    (neighbours[stubPlus.node] as LatticeNeighbour[]).push({
      to: stubMinus.node,
      dir: 8,
      cost,
      via: viaPlusToMinus,
    });
    (neighbours[stubMinus.node] as LatticeNeighbour[]).push({
      to: stubPlus.node,
      dir: 8,
      cost,
      via: [...viaPlusToMinus].reverse(),
    });
  }

  return latticeCache;
}

/** One off-grid connector from a real point onto the lattice. `points` run
 * node-first, point-last, including both ends. */
interface StreetStub {
  readonly node: number;
  readonly points: readonly (readonly [number, number])[];
  readonly cost: number;
}

/**
 * Every reasonable way to step from `p` onto the lattice: the four
 * surrounding nodes first, widening one shell if the whole cell is blocked
 * (the same Chebyshev-shell reasoning `entryCandidates` uses, bounded by
 * {@link STUB_TAIL_LIMIT} so no stub grows its own rogue street line).
 * Straight when clear; otherwise elbowed **via the node's own street line**
 * — the corner shares the node's x (or z), so one leg of the elbow is real
 * street and only the short tail runs off-grid.
 *
 * Memoised on the point's coordinates: a waypoint's stubs depend only on
 * static geometry (lattice, plots, boundary, rail, ring — never on what is
 * paved), and the interconnect pass asks for the same waypoint's stubs once
 * per candidate pair. Callers only read the returned array. Bypassed under
 * `DEBUG_STREETS` so the diagnostic re-call actually re-runs and logs.
 */
const streetStubsCache = new Map<string, StreetStub[]>();
function streetStubs(p: readonly [number, number], arrival: boolean): StreetStub[] {
  if (DEBUG_STREETS) return computeStreetStubs(p, arrival);
  const key = `${p[0]},${p[1]},${arrival ? 1 : 0}`;
  const hit = streetStubsCache.get(key);
  if (hit) return hit;
  const stubs = computeStreetStubs(p, arrival);
  streetStubsCache.set(key, stubs);
  return stubs;
}

function computeStreetStubs(p: readonly [number, number], arrival: boolean): StreetStub[] {
  const lattice = streetLattice();
  const pSide = railInfoAt(p[0], p[1]).side;
  // A destination's own frontage (any plot the point already stands close
  // to) is exempt from full street clearance — the stub is *arriving*, so
  // it may run along that plot's face, just never through it.
  // Sized to cover a doormat's stand-off (1.4 m), its 3.5 m arrival lead
  // and a plot's own frontage wobble — the ball-pit's slide exit measured
  // 5.7 m from the plot edge, just past the first (5.6 m) version of this.
  const exemptNear = arrival ? 7 : 0.5;
  const legClear = (ax: number, az: number, bx: number, bz: number): boolean =>
    streetSegmentClear(ax, az, bx, bz, p, exemptNear) &&
    segmentClearOfRing(ax, az, bx, bz) &&
    segmentHoldsRailSide(ax, az, bx, bz, pSide, 0);

  const ci = Math.round((p[0] - PLAZA.x) / STREET_PITCH);
  const cj = Math.round((p[1] - PLAZA.z) / STREET_PITCH);
  const found: StreetStub[] = [];
  const verbose = DEBUG_STREETS && stubDebugTarget === p;
  // Shell 0 is the point's own nearest node — a doormat standing right
  // beside a street line wants a two-metre stub, not a cell-length one.
  // Every shell is searched even after a hit: the nearest reachable node
  // can be an isolated orphan (valid ground, no street can reach it), and
  // stopping at the first shell with any candidate handed the whole spur
  // to exactly that orphan (seed 18's dodgems, measured: its shell-0 node
  // was a one-node island while the real network sat one shell further).
  for (let shell = 0; shell <= 2; shell += 1) {
    for (let di = -shell; di <= shell; di += 1) {
      for (let dj = -shell; dj <= shell; dj += 1) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== shell) continue;
        const i = ci + di;
        const j = cj + dj;
        if (Math.abs(i) > LATTICE_HALF_CELLS || Math.abs(j) > LATTICE_HALF_CELLS) continue;
        const index = lattice.indexOf(i, j);
        if (!lattice.nodeOk[index] || lattice.side[index] !== pSide) {
          if (verbose) {
            // eslint-disable-next-line no-console
            console.log(
              `[stubs]   node ${(lattice.xs[index] as number).toFixed(1)},${(lattice.zs[index] as number).toFixed(1)}: ` +
                (lattice.nodeOk[index] ? `side ${lattice.side[index]} != ${pSide}` : 'node invalid'),
            );
          }
          continue;
        }
        const nx = lattice.xs[index] as number;
        const nz = lattice.zs[index] as number;
        const tail = Math.min(Math.abs(p[0] - nx), Math.abs(p[1] - nz));
        if (tail > STUB_TAIL_LIMIT) {
          if (verbose) {
            // eslint-disable-next-line no-console
            console.log(`[stubs]   node ${nx.toFixed(1)},${nz.toFixed(1)}: tail ${tail.toFixed(1)} > ${STUB_TAIL_LIMIT}`);
          }
          continue;
        }
        const direct = Math.hypot(p[0] - nx, p[1] - nz);
        // Straight stub: shortest, slightly diagonal — fine when short.
        if (direct <= STUB_TAIL_LIMIT + 2 && legClear(nx, nz, p[0], p[1])) {
          found.push({ node: index, points: [[nx, nz], p], cost: direct * STUB_COST_FACTOR });
          continue;
        }
        // Elbow via the node's own street line: corner shares the node's x
        // (north-south street) or z (east-west street). **Only a corner
        // whose off-street tail (corner to `p`) stays short is legal** —
        // the other orientation puts the *long* leg on the destination's
        // own private line, which is exactly the rogue street the lattice
        // invariant polices (measured: a 13 m run on x = -70.8, seed 5's
        // rail-race stall, from the wrong corner being tried first).
        const corners: readonly (readonly [number, number])[] = [
          [nx, p[1]], // long leg north-south on the node's x line
          [p[0], nz], // long leg east-west on the node's z line
        ];
        let elbowed = false;
        for (const corner of corners) {
          const tailLength = Math.hypot(corner[0] - p[0], corner[1] - p[1]);
          if (tailLength > STUB_TAIL_LIMIT) continue;
          if (
            legClear(nx, nz, corner[0], corner[1]) &&
            legClear(corner[0], corner[1], p[0], p[1])
          ) {
            const length = Math.hypot(nx - corner[0], nz - corner[1]) + tailLength;
            found.push({
              node: index,
              points: [[nx, nz], corner, p],
              cost: length * STUB_COST_FACTOR + 1,
            });
            elbowed = true;
            break;
          }
        }
        if (verbose && !elbowed) {
          // eslint-disable-next-line no-console
          console.log(
            `[stubs]   node ${nx.toFixed(1)},${nz.toFixed(1)}: no clear straight or elbow leg ` +
              `(direct ${direct.toFixed(1)})`,
          );
        }
      }
    }
  }
  found.sort((a, b) => a.cost - b.cost);
  return found;
}

/**
 * Dijkstra over the lattice with a per-turn penalty. `sources` seed the
 * frontier (a stub's node, at the stub's own cost); `goalCost` returns the
 * terminal cost of stopping at a node (`Infinity` = not a goal). Returns
 * the node-index path from the cheapest goal back to its source, or null.
 */
function latticeSearch(
  sources: readonly { node: number; cost: number }[],
  goalCost: (node: number) => number,
): number[] | null {
  const lattice = streetLattice();
  const DIRS = 10; // 4 street + 4 pinch + 1 crossing arrival directions, + "just started"
  const states = lattice.count * DIRS;
  const stateOf = (node: number, dir: number): number => node * DIRS + dir + 1;
  const cost = new Float64Array(states).fill(Infinity);
  const from = new Int32Array(states).fill(-1);
  const closed = new Uint8Array(states);
  const heap = new MinHeap(cost);
  for (const source of sources) {
    const state = stateOf(source.node, -1);
    if (source.cost < (cost[state] as number)) {
      cost[state] = source.cost;
      heap.push(state);
    }
  }
  let best = Infinity;
  let bestState = -1;
  while (heap.size > 0) {
    const state = heap.pop();
    if (closed[state]) continue;
    closed[state] = 1;
    const stateCost = cost[state] as number;
    if (stateCost >= best) break; // nothing cheaper can still be found
    const node = Math.floor(state / DIRS);
    const dirIn = (state % DIRS) - 1;
    const terminal = goalCost(node);
    if (Number.isFinite(terminal) && stateCost + terminal < best) {
      best = stateCost + terminal;
      bestState = state;
    }
    for (const step of lattice.neighbours[node] as readonly LatticeNeighbour[]) {
      const turn = dirIn >= 0 && dirIn !== step.dir ? STREET_TURN_PENALTY : 0;
      // A hair's preference for edges already paved, so equal-length routes
      // ride the existing street rather than pave a parallel one.
      const reuse = pavedLatticeEdges.has(latticeEdgeKey(node, step.to)) ? -0.01 : 0;
      const next = stateCost + step.cost + turn + reuse;
      const nextState = stateOf(step.to, step.dir);
      if (next < (cost[nextState] as number)) {
        cost[nextState] = next;
        from[nextState] = state;
        heap.push(nextState);
      }
    }
  }
  if (bestState === -1) return null;
  const nodes: number[] = [];
  for (let state = bestState; state !== -1; state = from[state] as number) {
    const node = Math.floor(state / DIRS);
    if (nodes.length === 0 || nodes[nodes.length - 1] !== node) nodes.push(node);
  }
  return nodes.reverse();
}

/** Marks a lattice node path (and the tap it may have started from) paved. */
function commitLatticePath(nodes: readonly number[]): void {
  const lattice = streetLattice();
  for (let i = 0; i < nodes.length; i += 1) {
    pavedLatticeNodes.add(nodes[i] as number);
    if (i > 0) pavedLatticeEdges.add(latticeEdgeKey(nodes[i - 1] as number, nodes[i] as number));
  }
  for (const tap of lattice.taps) {
    if (nodes.length > 0 && nodes[0] === tap.index) usedTaps.add(tap.index);
  }
}

/** World points of a lattice node path, collapsed to its corners — a pinch
 * link contributes its chamfer's own intermediate points. */
function latticePathPoints(nodes: readonly number[]): (readonly [number, number])[] {
  const lattice = streetLattice();
  const points: (readonly [number, number])[] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i] as number;
    if (i > 0) {
      const prev = nodes[i - 1] as number;
      const link = (lattice.neighbours[prev] as readonly LatticeNeighbour[]).find(
        (step) => step.to === node && step.via.length > 0,
      );
      if (link) points.push(...link.via);
    }
    points.push([lattice.xs[node] as number, lattice.zs[node] as number]);
  }
  return collapseCollinear(points);
}

/**
 * A solved-but-not-yet-committed street route: control points to draw, the
 * lattice node paths to mark paved **only once the whole composition is
 * accepted** (a crossing needs two legs, and the interconnection pass can
 * still reject a route after solving it — paving the lattice for a ribbon
 * that is never drawn would teach every later route to terminate on
 * phantom streets), and the compass tap it opens, if any.
 */
interface StreetPlan {
  readonly points: (readonly [number, number])[];
  readonly paths: readonly (readonly number[])[];
  readonly tapNode: number | null;
}

/** Marks a plan's paving real: routes solved after this can terminate on it. */
function commitStreetPlan(plan: StreetPlan): void {
  for (const path of plan.paths) commitLatticePath(path);
  if (plan.tapNode !== null) {
    tapRimsDrawn.add(plan.tapNode);
    usedTaps.add(plan.tapNode);
  }
}

/**
 * **The street router: from the paved network to `target`.** The plan's
 * points run network-first, target-last — the paved end lands exactly on an
 * already-paved lattice node (a real crossroads) or on one of the ring's
 * four compass rims — or `null` when the lattice cannot serve this target
 * (no reachable stub, or the paved network is across the railway; the
 * caller falls back to a planned crossing or the proven old machinery).
 */
function planStreetToNetwork(target: readonly [number, number]): StreetPlan | null {
  const lattice = streetLattice();
  const stubs = streetStubs(target, true);
  if (stubs.length === 0) return null;
  const tapByNode = new Map<number, LatticeTap>();
  for (const tap of lattice.taps) {
    const existing = tapByNode.get(tap.index);
    if (!existing || tap.cost < existing.cost) tapByNode.set(tap.index, tap);
  }
  const goalCost = (node: number): number => {
    if (pavedLatticeNodes.has(node)) return 0;
    return tapByNode.get(node)?.cost ?? Infinity;
  };
  const path = latticeSearch(
    stubs.map((stub) => ({ node: stub.node, cost: stub.cost })),
    goalCost,
  );
  if (!path) return null;
  // The search ran target-side-out, so the path starts at a stub's node and
  // ends at the network; flip it network-first and re-attach the stub.
  const ordered = [...path].reverse();
  const stub = stubs.find((candidate) => candidate.node === ordered[ordered.length - 1]);
  if (!stub) return null;
  const terminal = ordered[0] as number;
  // A route that terminated at a compass tap (rather than on paving some
  // earlier route laid) opens that tap: its ribbon starts on the ring's own
  // rim, which is the tap's whole street until anything else reuses it.
  const opensTap = tapByNode.get(terminal) !== undefined && !pavedLatticeNodes.has(terminal);
  const tap = opensTap ? (tapByNode.get(terminal) as LatticeTap) : null;
  const head: (readonly [number, number])[] = tap ? [tap.rim, ...tap.via] : [];
  return {
    points: collapseCollinear([...head, ...latticePathPoints(ordered), ...stub.points.slice(1)]),
    paths: [path],
    tapNode: opensTap ? terminal : null,
  };
}

/** Compass taps whose rim segment (ring edge to first lattice node) has
 * already been drawn by some route — {@link ensureCompassTaps} completes
 * the set at the end. */
const tapRimsDrawn = new Set<number>();

/**
 * Street route between two real points (both off-lattice), used by the
 * interconnection pass and the crossing legs: stubs at both ends, lattice
 * between. The plan's points run `a`-first.
 */
function planStreetBetween(
  a: readonly [number, number],
  b: readonly [number, number],
  arrivalAtA: boolean,
  arrivalAtB: boolean,
): StreetPlan | null {
  const stubsA = streetStubs(a, arrivalAtA);
  const stubsB = streetStubs(b, arrivalAtB);
  if (stubsA.length === 0 || stubsB.length === 0) return null;
  const goalByNode = new Map<number, StreetStub>();
  for (const stub of stubsB) {
    const existing = goalByNode.get(stub.node);
    if (!existing || stub.cost < existing.cost) goalByNode.set(stub.node, stub);
  }
  const path = latticeSearch(
    stubsA.map((stub) => ({ node: stub.node, cost: stub.cost })),
    (node) => goalByNode.get(node)?.cost ?? Infinity,
  );
  if (!path) return null;
  const startStub = stubsA.find((candidate) => candidate.node === path[0]);
  const endStub = goalByNode.get(path[path.length - 1] as number);
  if (!startStub || !endStub) return null;
  return {
    points: collapseCollinear([
      a,
      ...[...startStub.points].reverse().slice(1), // a's corner (if any), then its node
      ...latticePathPoints(path).slice(1),
      ...endStub.points.slice(1, -1), // b's corner, if any
      b,
    ]),
    paths: [path],
    tapNode: null,
  };
}

/**
 * **Pulls a fallback route's own street-length runs onto the lattice.**
 * The old continuous routers put an elbow's corner wherever the folded
 * diagonal happened to be, which is exactly the "19 different x-positions"
 * disease; a route they build is still asked to share the same street
 * lines as everything else wherever clearance allows. Each maximal
 * axis-aligned interior run (never one carrying the route's own endpoints
 * — a doormat and a branch point are fixed facts other systems depend on)
 * whose shared coordinate sits off the plaza lattice is shifted onto the
 * nearest lattice line when the shifted run and both its connecting hops
 * stay clear of plots, boundary, ring and railway. Runs hugging the rail
 * (within 8.5 m — the invariants' own exemption band) are left alone:
 * their shape is the railway's, not the street plan's.
 */
function snapRunsToLattice(
  points: readonly (readonly [number, number])[],
): (readonly [number, number])[] {
  let out: [number, number][] = points.map((p) => [p[0], p[1]] as [number, number]);
  if (out.length < 3) return out;
  const destination = out[out.length - 1] as [number, number];
  // A hop is on-axis by the same 15% minor/major ratio the invariants
  // classify with — never by exact float equality: a clamped run's points
  // wobble by centimetres (`enforceRailSide` clamps each to its own
  // nearest rail point), and an exact-collinearity test simply never saw
  // those runs at all (seed 11's building spur carried a 15 m near-axis
  // clamped leg the snap silently skipped).
  const hopAxis = (a: readonly [number, number], b: readonly [number, number]): 'x' | 'z' | null => {
    const dx = Math.abs(b[0] - a[0]);
    const dz = Math.abs(b[1] - a[1]);
    const hop = Math.hypot(dx, dz);
    if (hop < 1e-6) return null;
    if (dx / hop <= 0.15) return 'x'; // north-south run, x nearly constant
    if (dz / hop <= 0.15) return 'z'; // east-west run, z nearly constant
    return null;
  };
  let i = 1;
  while (i < out.length) {
    const a = out[i - 1] as [number, number];
    const b = out[i] as [number, number];
    const axis = hopAxis(a, b);
    if (axis === null) {
      i += 1;
      continue;
    }
    const sameX = axis === 'x';
    // Extend to the run's end.
    let end = i;
    while (
      end < out.length - 1 &&
      hopAxis(out[end] as [number, number], out[end + 1] as [number, number]) === axis
    ) {
      end += 1;
    }
    const startIdx = i - 1;
    const runStart = out[startIdx] as [number, number];
    const runEnd = out[end] as [number, number];
    const length = Math.hypot(runEnd[0] - runStart[0], runEnd[1] - runStart[1]);
    // The run's own line: mean of the near-constant coordinate.
    let sharedSum = 0;
    for (let k = startIdx; k <= end; k += 1) {
      sharedSum += (out[k] as [number, number])[sameX ? 0 : 1];
    }
    const shared = sharedSum / (end - startIdx + 1);
    const anchor = sameX ? PLAZA.x : PLAZA.z;
    const remainder = ((((shared - anchor) % STREET_PITCH) + STREET_PITCH) % STREET_PITCH);
    const offset = remainder <= STREET_PITCH / 2 ? -remainder : STREET_PITCH - remainder;
    // Only the run's longest **open** stretch (off the railway's 8.5 m
    // exemption band — the same band the invariants use) is a street the
    // lattice rule binds: a stretch hugging the corridor takes the
    // railway's shape and stays where the clamp put it. The whole-run
    // versions of this were both wrong in turn — skipping any run touching
    // the corridor left 20 m of open lawn on a private line (seed 18's
    // dodgems), and shifting whole mixed runs was vetoed by the very rail
    // the near end legitimately hugs (seed 5's water-fight spur). So the
    // run is *split*: the open interval shifts onto the lattice line with
    // a short jog at each cut, and the clamped remainder keeps its shape.
    if (length >= 6 && Math.abs(offset) > 0.3) {
      const side = railInfoAt(runStart[0], runStart[1]).side;
      // Screens no stricter than what the fallback router itself
      // guaranteed: the run being shifted was routed under the old
      // clearances (boundary at a walker's radius, not a street's), and
      // demanding more here just means no run ever qualifies. The rail
      // floor is the run's own measured clearance, capped at the corridor.
      let railFloor = RAIL_CLAMP_DISTANCE;
      for (let k = startIdx; k <= end; k += 1) {
        const p = out[k] as [number, number];
        railFloor = Math.min(railFloor, railInfoAt(p[0], p[1]).dist);
      }
      const clear = (ax: number, az: number, bx: number, bz: number): boolean =>
        streetSegmentClear(ax, az, bx, bz, destination, 7, PLAYER_RADIUS + 0.5) &&
        segmentClearOfRing(ax, az, bx, bz) &&
        segmentHoldsRailSide(ax, az, bx, bz, side, Math.max(0, railFloor - 0.1));
      // A connecting segment re-covers ground the fallback route already
      // walks (plus the few metres of shift), so it is screened at the
      // fallback router's own grade — bounding-circle blockers and a
      // walker's boundary margin — not the street grade: re-litigating an
      // already-accepted route at street clearances only vetoes the snap
      // (measured: seed 18's z=46 run could reach its lattice line, but
      // its connector shares the old route's own sub-street clearance
      // past the dodgems stall).
      // Footprints, not bounding circles: a connecting jog only re-covers
      // ground beside the old route, and a big rectangular anchor's fat
      // bounding circle vetoed jogs that were metres clear of its actual
      // walls (measured: seed 11's rim stall, every candidate line
      // reachable at street margins yet every jog "blocked").
      // No ring test here, deliberately: a join mostly re-covers a
      // retained neighbour leg, and the old router never held its legs to
      // the ring guard — re-testing the neighbour's own ground against a
      // rule it legally predates only vetoes the snap (measured: seed 5's
      // ball-pit spur, a join whose first 20 m were the untouched
      // neighbour leg inside the ring's guard band).
      // Nor a rail-side test: where the old route legally crossed or
      // hugged the railway (a crossing's own feet, a clamped run), its
      // join does too, a couple of metres over — the run itself is still
      // held to its side and floor above.
      const connectorClear = (ax: number, az: number, bx: number, bz: number): boolean =>
        streetSegmentClear(ax, az, bx, bz, destination, 7, PLAYER_RADIUS + 0.5, 0.6);
      // The nearest lattice line first, then its neighbour on the other
      // side — a run pushed off its nearest line by the very plot that
      // forced it off-lattice can still often reach the next one over.
      const candidates =
        Math.abs(offset) <= STREET_PITCH / 2
          ? [shared + offset, shared + offset + (offset <= 0 ? STREET_PITCH : -STREET_PITCH)]
          : [shared + offset];
      for (const snapped of candidates) {
        if (Math.abs(snapped - shared) > STREET_PITCH) continue;
        // Only the run's **shiftable** stretch moves to this candidate
        // line: a sample is shiftable when the original point is off the
        // railway's 8.5 m exemption band (a clamped stretch takes the
        // railway's shape and stays) AND the candidate line's own point
        // respects the ring guard and the rail corridor (the plaza's
        // street line legitimately exists only outside the statue circle
        // — seed 5's water-fight spur skirts the circle's south, and only
        // its eastern half has a street line to move to). The remainder
        // keeps its shape, joined to the shifted part by a short jog; an
        // unshifted leftover shorter than a street run is exactly what
        // the lattice invariant tolerates.
        const samples = Math.max(2, Math.ceil(length));
        const shiftable = (s: number): boolean => {
          const t = s / samples;
          const ox = runStart[0] + (runEnd[0] - runStart[0]) * t;
          const oz = runStart[1] + (runEnd[1] - runStart[1]) * t;
          if (railInfoAt(ox, oz).dist <= 8.5) return false;
          const sx = sameX ? snapped : ox;
          const sz = sameX ? oz : snapped;
          if (Math.hypot(sx - PLAZA.x, sz - PLAZA.z) < RING_RADIUS + 0.6) return false;
          if (railInfoAt(sx, sz).dist < RAIL_CLAMP_DISTANCE - 0.1) return false;
          return true;
        };
        let openA = -1;
        let openB = -1;
        {
          let currentStart = -1;
          for (let s = 0; s <= samples; s += 1) {
            const open = shiftable(s);
            if (open && currentStart < 0) currentStart = s;
            if ((!open || s === samples) && currentStart >= 0) {
              const endSample = open ? s : s - 1;
              if (endSample - currentStart > openB - openA) {
                openA = currentStart;
                openB = endSample;
              }
              currentStart = -1;
            }
          }
        }
        if (openA < 0) continue;
        const openStart = openA / samples;
        const openEnd = openB / samples;
        if ((openEnd - openStart) * length < 6) continue;
        // A run carrying the route's own first or last point keeps that
        // point where it is (a branch point sits on the network, a
        // destination is a doormat) and takes a short jog to the snapped
        // line instead; interior runs shift whole. A retained stretch at
        // either end is likewise kept, with the shift starting at its edge.
        const trimHead = openStart > 0.02;
        const trimTail = openEnd < 0.98;
        const keepHead = !trimHead && startIdx === 0;
        const keepTail = !trimTail && end === out.length - 1;
        const headPoint = trimHead
          ? ([
              runStart[0] + (runEnd[0] - runStart[0]) * openStart,
              runStart[1] + (runEnd[1] - runStart[1]) * openStart,
            ] as [number, number])
          : (out[startIdx] as [number, number]);
        const tailPoint = trimTail
          ? ([
              runStart[0] + (runEnd[0] - runStart[0]) * openEnd,
              runStart[1] + (runEnd[1] - runStart[1]) * openEnd,
            ] as [number, number])
          : (out[end] as [number, number]);
        const movedHead: readonly [number, number] = sameX
          ? [snapped, headPoint[1]]
          : [headPoint[0], snapped];
        const movedTail: readonly [number, number] = sameX
          ? [snapped, tailPoint[1]]
          : [tailPoint[0], snapped];
        const prev = startIdx > 0 ? (out[startIdx - 1] as [number, number]) : null;
        const next = end < out.length - 1 ? (out[end + 1] as [number, number]) : null;
        // A connector joins the shifted run to its fixed neighbour: the
        // straight line when clear, otherwise either L-shaped elbow — the
        // diagonal can clip an arch foot the elbow steps around (seed 11's
        // rim stall, measured: the run's lattice line was clear but the
        // 3 m diagonal join grazed a rainbow leg).
        const joinVia = (
          p: readonly [number, number],
          q: readonly [number, number],
        ): (readonly [number, number])[] | null => {
          if (connectorClear(p[0], p[1], q[0], q[1])) return [];
          for (const corner of [
            [p[0], q[1]] as const,
            [q[0], p[1]] as const,
          ]) {
            if (
              connectorClear(p[0], p[1], corner[0], corner[1]) &&
              connectorClear(corner[0], corner[1], q[0], q[1])
            ) {
              return [corner];
            }
          }
          return null;
        };
        const headJoin =
          trimHead || keepHead
            ? joinVia(headPoint, movedHead) // jog off the retained stretch (or fixed endpoint)
            : prev
              ? joinVia(prev, movedHead)
              : [];
        const tailJoin =
          trimTail || keepTail
            ? joinVia(movedTail, tailPoint)
            : next
              ? joinVia(movedTail, next)
              : [];
        const allClear =
          headJoin !== null &&
          tailJoin !== null &&
          clear(movedHead[0], movedHead[1], movedTail[0], movedTail[1]);
        if (!allClear) {
          if (DEBUG_STREETS) {
            // eslint-disable-next-line no-console
            console.log(
              `[snap] run ${sameX ? 'x' : 'z'}=${shared.toFixed(2)} (${length.toFixed(1)} m, ` +
                `${runStart[0].toFixed(1)},${runStart[1].toFixed(1)} -> ${runEnd[0].toFixed(1)},${runEnd[1].toFixed(1)}): ` +
                `candidate ${snapped.toFixed(2)} blocked ` +
                `(run ${clear(movedHead[0], movedHead[1], movedTail[0], movedTail[1]) ? 'ok' : 'BLOCKED'}, ` +
                `head ${headJoin === null ? 'BLOCKED' : 'ok'}, tail ${tailJoin === null ? 'BLOCKED' : 'ok'})`,
            );
          }
          continue;
        }
        const tOf = (p: readonly [number, number]): number =>
          Math.hypot(p[0] - runStart[0], p[1] - runStart[1]) / length;
        const replacement: [number, number][] = [];
        if (trimHead) {
          // The clamped stretch keeps its own points, then the cut point.
          for (let k = startIdx; k <= end; k += 1) {
            const p = out[k] as [number, number];
            if (tOf(p) < openStart - 0.01) replacement.push(p);
          }
          replacement.push(headPoint);
        } else if (keepHead) {
          replacement.push(headPoint);
        }
        for (const c of headJoin as (readonly [number, number])[]) replacement.push([c[0], c[1]]);
        replacement.push([movedHead[0], movedHead[1]], [movedTail[0], movedTail[1]]);
        for (const c of tailJoin as (readonly [number, number])[]) replacement.push([c[0], c[1]]);
        if (trimTail) {
          replacement.push(tailPoint);
          for (let k = startIdx; k <= end; k += 1) {
            const p = out[k] as [number, number];
            if (tOf(p) > openEnd + 0.01) replacement.push(p);
          }
        } else if (keepTail) {
          replacement.push(tailPoint);
        }
        out = [
          ...out.slice(0, startIdx),
          ...replacement,
          ...out.slice(end + 1),
        ];
        end = startIdx + replacement.length - 1;
        break;
      }
    }
    i = end + 1;
  }
  return collapseCollinear(out);
}

/**
 * True when `points` carries an axis-aligned straight run long enough to
 * read as a street (8 m — the same threshold the lattice invariant uses)
 * whose line sits well off the plaza-anchored lattice, away from the
 * railway's own exempt corridor. Used to screen *optional* paving (an
 * interconnect whose lattice plan failed and fell back to the old
 * continuous router): a shortcut is not worth drawing a rogue street line
 * for, where a spur — mandatory connectivity — is allowed the fallback.
 */
function carriesAnOffLatticeStreetRun(points: readonly (readonly [number, number])[]): boolean {
  // Arc length per point, for the door-approach allowance (the same one
  // the invariant grants — a run confined to a route's last metres is the
  // door's own geometry, not a street).
  const along: number[] = [0];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as readonly [number, number];
    const b = points[i] as readonly [number, number];
    along.push((along[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = along[along.length - 1] as number;

  let axis: 'x' | 'z' | null = null;
  let runStart = 0;
  const check = (endIndex: number): boolean => {
    if (axis === null || endIndex <= runStart) return false;
    const a = points[runStart] as readonly [number, number];
    const b = points[endIndex] as readonly [number, number];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const runAxis = axis;
    const startAlong = along[runStart] as number;
    const endAlong = along[endIndex] as number;
    axis = null;
    if (length < 8) return false;
    if (endAlong <= 15 || startAlong >= total - 15) return false; // door approach
    const line = runAxis === 'z' ? (a[0] + b[0]) / 2 : (a[1] + b[1]) / 2;
    const anchor = runAxis === 'z' ? PLAZA.x : PLAZA.z;
    const remainder = ((((line - anchor) % STREET_PITCH) + STREET_PITCH) % STREET_PITCH);
    if (Math.min(remainder, STREET_PITCH - remainder) <= 0.9) return false;
    // Threading ground the lattice does not serve: when both neighbouring
    // lattice lines are obstructed over this run's own span, the run is
    // excused — the same allowance the invariant grants, measured with the
    // same generator screens the streets themselves use.
    const lower = line - remainder;
    const upper = lower + STREET_PITCH;
    const lineAvailable = (candidate: number): boolean => {
      const [ax, az, bx, bz] =
        runAxis === 'z'
          ? [candidate, a[1], candidate, b[1]]
          : [a[0], candidate, b[0], candidate];
      return (
        streetSegmentClear(ax, az, bx, bz) &&
        segmentHoldsRailSide(ax, az, bx, bz, railInfoAt(ax, az).side, RAIL_CLAMP_DISTANCE - 0.1)
      );
    };
    return lineAvailable(lower) || lineAvailable(upper);
  };
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as readonly [number, number];
    const b = points[i] as readonly [number, number];
    const dx = Math.abs(b[0] - a[0]);
    const dz = Math.abs(b[1] - a[1]);
    const hop = Math.hypot(dx, dz);
    if (hop < 1e-6) continue;
    const hopAxis: 'x' | 'z' | null = dz / hop <= 0.15 ? 'x' : dx / hop <= 0.15 ? 'z' : null;
    const nearRail = railInfoAt(a[0], a[1]).dist <= 8.5 && railInfoAt(b[0], b[1]).dist <= 8.5;
    if (hopAxis === null || nearRail) {
      if (check(i - 1)) return true;
      continue;
    }
    if (axis === null) {
      axis = hopAxis;
      runStart = i - 1;
    } else if (axis !== hopAxis) {
      if (check(i - 1)) return true;
      axis = hopAxis;
      runStart = i - 1;
    }
  }
  return check(points.length - 1);
}

/**
 * The one entry point the graph builder uses: a street route from the paved
 * network to `target`, crossing the railway through a planned site when the
 * network is on the other side, or `null` for the old machinery to handle
 * (its own fence-follows and double-crossings cover the pockets the lattice
 * cannot). Commits the winning plan's paving — callers that need to reject
 * a solved route after seeing it (the interconnection pass) use the plan
 * functions directly instead.
 */
function streetRoute(target: readonly [number, number]): (readonly [number, number])[] | null {
  const plan = planStreetToNetwork(target);
  if (!plan) return null;
  commitStreetPlan(plan);
  return plan.points;
}

/** Debug-only: why is there no street edge (or node) here? Reports each
 * screen's verdict for a candidate segment. Not used by the game. */
export function debugStreetSegment(
  ax: number,
  az: number,
  bx: number,
  bz: number,
): Record<string, boolean | number> {
  const sideA = railInfoAt(ax, az);
  const sideB = railInfoAt(bx, bz);
  return {
    clearOfPlotsBoundaryArches: streetSegmentClear(ax, az, bx, bz),
    clearOfRing: segmentClearOfRing(ax, az, bx, bz),
    sameSide: sideA.side === sideB.side,
    holdsRailSide: segmentHoldsRailSide(ax, az, bx, bz, sideA.side, RAIL_CLAMP_DISTANCE - 0.1),
    railDistA: Number(sideA.dist.toFixed(2)),
    railDistB: Number(sideB.dist.toFixed(2)),
    sideA: sideA.side,
    sideB: sideB.side,
    oldBlockersPad0: segmentClearOfBlockers(ax, az, bx, bz, 0, BLOCKERS, DESTINATION_ARRIVAL_MARGIN),
    boundaryWalk: segmentClearOfBoundary(ax, az, bx, bz),
  };
}

/**
 * Debug-only window onto the solved lattice — read by
 * `scripts/plot-streets.mts` (an SVG plotter for eyeballing the street
 * graph without booting a browser). Not used by the game.
 */
export function debugStreetLattice(): {
  nodes: { x: number; z: number; ok: boolean; side: number; paved: boolean }[];
  edges: { ax: number; az: number; bx: number; bz: number; paved: boolean }[];
  links: { ax: number; az: number; bx: number; bz: number; kind: 'street' | 'pinch' | 'crossing' }[];
  taps: { x: number; z: number; rimX: number; rimZ: number }[];
} {
  const lattice = streetLattice();
  const nodes: { x: number; z: number; ok: boolean; side: number; paved: boolean }[] = [];
  const edges: { ax: number; az: number; bx: number; bz: number; paved: boolean }[] = [];
  for (let index = 0; index < lattice.count; index += 1) {
    nodes.push({
      x: lattice.xs[index] as number,
      z: lattice.zs[index] as number,
      ok: lattice.nodeOk[index] === 1,
      side: lattice.side[index] as number,
      paved: pavedLatticeNodes.has(index),
    });
    const [i, j] = lattice.cellOf(index);
    if (i < LATTICE_HALF_CELLS && lattice.edgeEast[index]) {
      const other = lattice.indexOf(i + 1, j);
      edges.push({
        ax: lattice.xs[index] as number,
        az: lattice.zs[index] as number,
        bx: lattice.xs[other] as number,
        bz: lattice.zs[other] as number,
        paved: pavedLatticeEdges.has(latticeEdgeKey(index, other)),
      });
    }
    if (j < LATTICE_HALF_CELLS && lattice.edgeSouth[index]) {
      const other = lattice.indexOf(i, j + 1);
      edges.push({
        ax: lattice.xs[index] as number,
        az: lattice.zs[index] as number,
        bx: lattice.xs[other] as number,
        bz: lattice.zs[other] as number,
        paved: pavedLatticeEdges.has(latticeEdgeKey(index, other)),
      });
    }
  }
  const links: { ax: number; az: number; bx: number; bz: number; kind: 'street' | 'pinch' | 'crossing' }[] = [];
  for (let index = 0; index < lattice.count; index += 1) {
    for (const step of lattice.neighbours[index] as readonly LatticeNeighbour[]) {
      if (step.to < index) continue; // one direction only
      links.push({
        ax: lattice.xs[index] as number,
        az: lattice.zs[index] as number,
        bx: lattice.xs[step.to] as number,
        bz: lattice.zs[step.to] as number,
        kind: step.dir < 4 ? 'street' : step.dir < 8 ? 'pinch' : 'crossing',
      });
    }
  }
  return {
    nodes,
    edges,
    links,
    taps: lattice.taps.map((tap) => ({
      x: lattice.xs[tap.index] as number,
      z: lattice.zs[tap.index] as number,
      rimX: tap.rim[0],
      rimZ: tap.rim[1],
    })),
  };
}

/**
 * After every spur is routed: any compass tap no route happened to use
 * still gets its street (Decision 5 says exactly four connections, and a
 * circle with three grown streets and one missing gateway reads as an
 * accident, not a design). Each unused tap is connected to the nearest
 * paving — usually a street already running through or near its own node.
 */
function ensureCompassTaps(edges: PathEdge[]): void {
  const lattice = streetLattice();
  for (const tap of lattice.taps) {
    // Only the four compass streets are owed a connection — a `crossing`
    // tap is an opportunity (a bridge landing by the ring), not a promise.
    if (tap.kind !== 'compass') continue;
    if (usedTaps.has(tap.index) || tapRimsDrawn.has(tap.index)) continue;
    let points: (readonly [number, number])[] | null = null;
    if (pavedLatticeNodes.has(tap.index)) {
      // A street already runs through the tap's own node: the rim segment
      // alone completes the connection.
      points = [
        tap.rim,
        [lattice.xs[tap.index] as number, lattice.zs[tap.index] as number] as const,
      ];
    } else {
      const path = latticeSearch([{ node: tap.index, cost: 0 }], (node) =>
        pavedLatticeNodes.has(node) ? 0 : Infinity,
      );
      if (path) {
        commitLatticePath(path);
        points = [tap.rim, ...latticePathPoints(path)];
      }
    }
    if (!points) continue; // nothing paved on this side at all — leave it
    tapRimsDrawn.add(tap.index);
    usedTaps.add(tap.index);
    const [di, dj] = [
      Math.sign(tap.rim[0] - PLAZA.x),
      Math.sign(tap.rim[1] - PLAZA.z),
    ];
    const name =
      di > 0 ? 'east' : di < 0 ? 'west' : dj > 0 ? 'south' : 'north';
    edges.push({
      from: 'ring',
      to: 'ring',
      paved: true,
      route: { name: `street-tap-${name}`, width: 3.0, closed: false, points },
    });
  }
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
 * backbone, a spur from the network to every node (each routed round the
 * placed plots), plus a final interconnection pass ({@link addInterconnects})
 * that adds a direct edge between any two destinations that are close but
 * only reachable via a far-off shared branch point — without it the graph is
 * a pure hub-and-spoke tree, which reads fine node-by-node but forces a
 * long paved detour between two things standing right next to each other
 * (Jim, PR #286: "there aren't enough edges between nodes that are close
 * but currently unlinked ... they should be inter-connected"). A node
 * already standing on the network keeps its edge unpaved (`paved: false`):
 * connected in the graph, no double ribbon drawn.
 */
export interface PathNode {
  readonly id: string;
  readonly kind: 'gate' | 'plaza' | 'anchor' | 'stall' | 'station' | 'exit';
  readonly x: number;
  readonly z: number;
}

export interface PathEdge {
  /** Node ids; `'ring'` means the backbone itself. A direct interconnection
   * edge (`addInterconnects`) has two real node ids on both ends, unlike
   * every other edge here, which always has `'ring'` on one end. */
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

/**
 * **The walk-graph solve, one destination at a time.**
 *
 * The same crossingPrewarm shape (`train/crossingPlanSolve.ts`): a generator
 * that suspends between destinations so `boot/parkGeneration.ts` can spread
 * the solve over the cat-bus ride's frames instead of paying it as one
 * module-evaluation block (`check:park-boot` measured the lattice rework's
 * whole-graph solve at ~215 ms in one go against a 250 ms ceiling, with no
 * frame budget able to touch it). Every yield sits between two destinations'
 * routes — all state is generator locals plus this module's lattice paving,
 * mutated in exactly the order {@link buildGraph}'s straight-through drain
 * mutates it, so the cadence cannot move a single route.
 */
export function* pathGraphSearch(): Generator<number, PathGraph, void> {
  let progress = 0;
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
          // The tail joins the street lattice (the reversed street route
          // runs corridor-mouth-first), entering the ring at a compass tap
          // when nothing else is paved yet — which, built first, makes this
          // the park's main avenue for every later spur to terminate on.
          // The corridor itself ([0,54]->[0,30]) stays exactly as it always
          // was — the ground the cat-bus arrival choreographs. Falls back
          // to the old axis-aligned router only if the lattice cannot
          // reach the corridor mouth at all.
          ...(streetRoute([0, 27]) ?? routeLeg(nearestCompassPoint(0, 27), [0, 27]))
            .slice()
            .reverse()
            .slice(1),
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
          nearestCompassPoint(PLAZA.x, PLAZA.z + PLAZA.radius + 4),
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
    // The street lattice serves the spur (network-first, lead-last); the
    // old continuous router is only the fallback for ground the lattice
    // cannot reach — a doormat in a pocket with every stub blocked, or a
    // strip the fence-follow machinery exists for. `bestBranchPoint` is
    // deliberately not consulted first any more: the lattice search itself
    // finds the junction giving the shortest real walk, and its junctions
    // land only on shared street crossroads.
    const routeTarget = lead.length ? (lead[0] as [number, number]) : ([ex, ez] as const);
    const streets = streetRoute(routeTarget);
    if (!streets && DEBUG_STREETS) {
      // eslint-disable-next-line no-console
      console.log(
        `[streets] fallback for ${id}: target ${routeTarget[0].toFixed(1)},${routeTarget[1].toFixed(1)} ` +
          `side ${railInfoAt(routeTarget[0], routeTarget[1]).side}`,
      );
      stubDebugTarget = routeTarget;
      const stubs = streetStubs(routeTarget, true);
      stubDebugTarget = null;
      // eslint-disable-next-line no-console
      console.log(`[streets]   stubs found: ${stubs.length}`);
    }
    // See {@link SPUR_STRETCH}: no-op in the game, non-zero only for the test
    // that proves a longer spur leaves distant scenery where it was.
    const routed = [
      ...(streets ?? fallbackSpurRoute(network(), routeTarget)),
      ...(lead.length ? [[ex, ez] as readonly [number, number]] : []),
    ];
    if (SPUR_STRETCH > 0 && id === SPUR_STRETCH_ID && routed.length >= 2) {
      // Bow the segment carrying the polyline's arc-length midpoint,
      // sideways off that one segment — not the head-to-tail chord: on a
      // route with many control points a chord midpoint spliced near the
      // head is a park-crossing zigzag (measured: +50 m of paving from a
      // "2 m" bow), which is the very opposite of the small, local paving
      // perturbation this hook exists to make.
      let total = 0;
      for (let i = 1; i < routed.length; i += 1) {
        const p = routed[i - 1] as readonly [number, number];
        const q = routed[i] as readonly [number, number];
        total += Math.hypot(q[0] - p[0], q[1] - p[1]);
      }
      let walked = 0;
      for (let i = 1; i < routed.length; i += 1) {
        const p = routed[i - 1] as readonly [number, number];
        const q = routed[i] as readonly [number, number];
        const segment = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (walked + segment >= total / 2 && segment > 1e-6) {
          routed.splice(i, 0, [
            (p[0] + q[0]) / 2 + (-(q[1] - p[1]) / segment) * SPUR_STRETCH,
            (p[1] + q[1]) / 2 + (((q[0] - p[0])) / segment) * SPUR_STRETCH,
          ]);
          break;
        }
        walked += segment;
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

  yield (progress += 1); // the ring is solved; each destination now gets its own slice
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
    yield (progress += 1);
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
    yield (progress += 1);
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
    const stationLead: readonly [number, number] = [station.leadX, station.leadZ];
    const stationStreets = streetRoute(stationLead);
    edges.push({
      from: 'ring',
      to: id,
      paved: true,
      route: {
        name: `spur-${id}`,
        width: 2.6,
        closed: false,
        points: [
          ...(stationStreets ?? fallbackSpurRoute(network(), stationLead)),
          [station.approachX, station.approachZ],
          [station.standX, station.standZ],
        ],
      },
    });
    yield (progress += 1);
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
    yield (progress += 1);
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

  // The interconnection pass (Jim, PR #286, 18 August 2026, on the grid-
  // aligned network above): "yes it is now grid-based and that's fine, but
  // also nothing like a real layout and you have to walk on the grass to
  // get anywhere fast - in the node and edge based routing, there aren't
  // enough edges between nodes that are close but currently unlinked, which
  // makes most things into branches off a central hub, whereas they should
  // be inter-connected." See {@link addInterconnects}'s own comment for the
  // measured numbers behind it.
  // Every compass tap that no spur happened to terminate at still gets its
  // street — Decision 5's "exactly 4 connections at compass points" is a
  // property of the built ring, not a hope about routing order.
  yield (progress += 1);
  ensureCompassTaps(edges);
  yield (progress += 1);

  // Test hook, same pattern as `SPUR_STRETCH_ID` above: zero/default in the
  // game, set only by the invariant that proves `detourRatiosStayReasonable`
  // can actually fail (it re-solves the park with this set, to measure the
  // pre-interconnection hub-and-spoke tree directly, rather than trusting
  // the invariant's own arithmetic).
  if (!DISABLE_INTERCONNECTS) yield* addInterconnects(nodes, edges, progress);

  return { nodes, edges, ring };
}

/**
 * The straight-through drain of {@link pathGraphSearch} — what `pathGraph.ts`
 * runs when nothing pre-warmed the solve (`check:park`, `test:procgen`, a
 * continued save). Same generator, same order, so the two cadences cannot
 * disagree about the park they build.
 */
export function buildGraph(): PathGraph {
  const search = pathGraphSearch();
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}

/** Destination kinds {@link addInterconnects} considers connecting directly
 * — real places a child is going, not the ring/gate/plaza structural nodes
 * (the plaza's own recorded coordinate is its centre, not the paved arrival
 * point on its rim, so it has no exact vertex for {@link buildRouteDistanceGraph}
 * to find anyway). */
const DESTINATION_KINDS: ReadonlySet<PathNode['kind']> = new Set(['anchor', 'stall', 'station', 'exit']);

/**
 * The multiple of straight-line distance a pair's *current* paved distance
 * must clear before this pass calls it "the tree makes this an unreasonable
 * detour" rather than "already fine."
 *
 * Measured across all five procgen seeds (canonical + sweep 2/5/11/18), 18
 * August 2026, on the built destination graph: pairs that are already fine —
 * a ride and its own exit, sharing one spur — sit at ratio 1.2-2.0. Every
 * pair that actually reads as hub-and-spoke (two doormats on different
 * spurs, walkable to each other in a few strides but paved only via a
 * shared branch point several times further away) sits at 2.4-10.9 — e.g.
 * the canonical seed's `building`/`stall.skyCruiser` (11.0 m straight,
 * 77.0 m paved, 7.0x) and seed 5's `stall.skyCruiser`/`exit.skyCruiser`
 * (12.4 m straight, 134.4 m paved, 10.9x). 2.5 sits in the gap between the
 * two populations.
 */
const CONNECTOR_RATIO_THRESHOLD = 2.5;

/**
 * How many "typical plot hops" — {@link medianNearestNeighbourSpacing} on
 * the built park's own destination graph, 13.1-15.6 m across the five
 * measured seeds — a pair may be apart, straight-line, and still be a
 * connector candidate. Keeps this pass to "close but unlinked" (Jim's own
 * phrase): without a cap, a bad ratio between two destinations that are
 * each merely hugging opposite sides of the park would draw a shortcut
 * clear across it, which is over-connecting, not fixing a hub-and-spoke
 * local pocket.
 *
 * 2.0, not the more generous 3.5 the "close but unlinked" reasoning above
 * would alone justify — brought down by a second, independent constraint
 * measured directly against `check:park`'s "every waypoint is reachable"
 * invariant, 18 August 2026: `Scenery.ts`'s hiding maze (`generateWallMaze`)
 * places its L-shaped pieces by walking `MAZE_CANDIDATES` = 2600 index-seeded
 * attempts, each testing clear ground against the *current* path network and
 * against every already-placed piece — so rejecting one candidate (because
 * it now overlaps a brand-new connector ribbon) can let a *later* candidate
 * fill ground the earlier one would otherwise have claimed
 * (`test/procgen/scatterDecoupling.test.ts` documents this exact mechanism
 * and tolerates up to 30 m of it for a 2 m spur bow). A whole new connector
 * is a far bigger perturbation than a 2 m bow, and on the canonical seed the
 * full 8-connector set (3.5x cap) reliably shifted a maze piece across a
 * paving-free NPC waypoint chord near the hotel spur, stranding 38 waypoints
 * — reproduced with `LGP_DISABLE_INTERCONNECTS`/cap sweeps, not a one-off.
 * Measured cap sweep on the canonical seed: 3.5x/8 connectors → 38 stranded,
 * 3.0x/7 → 37, 2.5x/6 → 3 (a different pocket, near the ferris wheel),
 * 2.0x/3-4 → 0, confirmed 0 again on seed 2. Fewer, shorter connectors is a
 * real reduction in total *new* paved ground for the maze to collide with —
 * not a proxy that happens to correlate — so 2.0 is kept as the operating
 * cap until the maze generator gets the same index-locked-against-neighbours
 * treatment its own benches already have (`BENCH_CANDIDATES`/`candidateRng`
 * in the same file), which would remove this constraint entirely rather
 * than requiring a conservative cap here.
 */
const CONNECTOR_SPACING_CAP_MULTIPLE = 2.0;

/**
 * How many "typical plot hops" of *wasted* paved walking (paved distance
 * minus straight-line distance) a pair must be losing before a whole new
 * ribbon is worth drawing for it. Without this, a pair only 3 m apart by
 * paving already (e.g. `stall.railRacer`/`exit-railRace`, 2.9 m straight /
 * 7.0 m paved) can still clear {@link CONNECTOR_RATIO_THRESHOLD} — small
 * numbers divide dramatically — while the child actually walks a handful of
 * extra metres, not the tens of metres this pass exists to fix.
 */
const CONNECTOR_MIN_WASTE_MULTIPLE = 1.5;

/** Width of a direct connector ribbon — matches the common stall-spur width
 * (`spur`'s own default for everything but the building and ride exits), so
 * a connector reads as an ordinary secondary path, not a special case. */
const CONNECTOR_WIDTH = 2.6;

/**
 * Real distances between neighbouring destinations in the *built* park —
 * sizes {@link addInterconnects}'s thresholds off the park itself rather
 * than a metre literal invented for no seed in particular (CLAUDE.md's
 * procgen-threshold rule).
 */
function medianNearestNeighbourSpacing(points: readonly PathNode[]): number {
  if (points.length < 2) return 0;
  const gaps: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    let best = Infinity;
    for (let j = 0; j < points.length; j += 1) {
      if (i === j) continue;
      const a = points[i] as PathNode;
      const b = points[j] as PathNode;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < best) best = d;
    }
    gaps.push(best);
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] as number;
}

/** Millimetre-scale merge tolerance for a graph junction that is supposed to
 * be an exact floating-point coincidence — see {@link buildRouteDistanceGraph}. */
const JUNCTION_EPSILON = 1e-3;

function keyForVertex(x: number, z: number): string {
  return `${Math.round(x / JUNCTION_EPSILON)},${Math.round(z / JUNCTION_EPSILON)}`;
}

/**
 * Builds an exact shortest-path oracle over a set of paved-graph edges'
 * *raw* control polylines — the same points `manhattanRoute` produced, not
 * the Catmull-Rom-smoothed curve `parkFacts.ts` draws for rendering. The
 * topology lives in the straight control segments; the curve never departs
 * far enough from them to change which detour is shortest, and every
 * `PathNode`'s own coordinate is guaranteed (by construction — see `spur`
 * above) to appear verbatim as one of its own edge's control points, so a
 * query for it always lands exactly on a graph vertex.
 *
 * A spur's *start* point is a projection onto whichever route it branched
 * from (`bestBranchPoint`) — a point on that route's segment, not
 * necessarily one of its vertices. So before the graph can see the
 * junction, every edge's two ends are spliced onto whichever *other* edge's
 * segment they land on, turning the implicit "this point sits on that line"
 * fact `bestBranchPoint` already proved into a shared graph vertex.
 */
function buildRouteDistanceGraph(edges: readonly PathEdge[]): {
  distanceBetween: (ax: number, az: number, bx: number, bz: number) => number;
} {
  const polylines: [number, number][][] = edges.map((edge) =>
    edge.route.points.map((p) => [p[0], p[1]] as [number, number]),
  );
  const closedFlags = edges.map((edge) => edge.route.closed);

  const spliceOnto = (targetIdx: number, px: number, pz: number): void => {
    const pts = polylines[targetIdx] as [number, number][];
    const segCount = closedFlags[targetIdx] ? pts.length : pts.length - 1;
    for (let i = 0; i < segCount; i += 1) {
      const a = pts[i] as [number, number];
      const b = pts[(i + 1) % pts.length] as [number, number];
      if (Math.hypot(px - a[0], pz - a[1]) < JUNCTION_EPSILON) return; // already a vertex
      if (Math.hypot(px - b[0], pz - b[1]) < JUNCTION_EPSILON) return;
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const lengthSq = dx * dx + dz * dz;
      if (lengthSq < 1e-12) continue;
      const t = ((px - a[0]) * dx + (pz - a[1]) * dz) / lengthSq;
      if (t < -1e-6 || t > 1 + 1e-6) continue; // not on this segment
      const clampedT = Math.max(0, Math.min(1, t));
      const projX = a[0] + dx * clampedT;
      const projZ = a[1] + dz * clampedT;
      if (Math.hypot(px - projX, pz - projZ) < 0.01) {
        pts.splice(i + 1, 0, [px, pz]);
        return;
      }
    }
  };

  for (let i = 0; i < polylines.length; i += 1) {
    const pts = polylines[i] as [number, number][];
    if (pts.length === 0) continue;
    const first = pts[0] as [number, number];
    const last = pts[pts.length - 1] as [number, number];
    for (let j = 0; j < polylines.length; j += 1) {
      if (j === i) continue;
      spliceOnto(j, first[0], first[1]);
      spliceOnto(j, last[0], last[1]);
    }
  }

  const vertexIndex = new Map<string, number>();
  const adjacency: { to: number; weight: number }[][] = [];
  const idOf = (x: number, z: number): number => {
    const key = keyForVertex(x, z);
    let id = vertexIndex.get(key);
    if (id === undefined) {
      id = adjacency.length;
      vertexIndex.set(key, id);
      adjacency.push([]);
    }
    return id;
  };
  const addEdge = (aId: number, bId: number, weight: number): void => {
    if (aId === bId) return;
    (adjacency[aId] as { to: number; weight: number }[]).push({ to: bId, weight });
    (adjacency[bId] as { to: number; weight: number }[]).push({ to: aId, weight });
  };
  for (let i = 0; i < polylines.length; i += 1) {
    const pts = polylines[i] as [number, number][];
    const segCount = closedFlags[i] ? pts.length : pts.length - 1;
    for (let s = 0; s < segCount; s += 1) {
      const a = pts[s] as [number, number];
      const b = pts[(s + 1) % pts.length] as [number, number];
      const weight = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (weight < 1e-9) continue;
      addEdge(idOf(a[0], a[1]), idOf(b[0], b[1]), weight);
    }
  }

  return {
    distanceBetween(ax, az, bx, bz) {
      const startId = vertexIndex.get(keyForVertex(ax, az));
      const goalId = vertexIndex.get(keyForVertex(bx, bz));
      if (startId === undefined || goalId === undefined) return Infinity;
      const dist = new Float64Array(adjacency.length).fill(Infinity);
      dist[startId] = 0;
      const visited = new Uint8Array(adjacency.length);
      for (;;) {
        let curId = -1;
        let curDist = Infinity;
        for (let i = 0; i < dist.length; i += 1) {
          const d = dist[i] as number;
          if (!visited[i] && d < curDist) {
            curDist = d;
            curId = i;
          }
        }
        if (curId === -1) break;
        if (curId === goalId) return curDist;
        visited[curId] = 1;
        for (const { to, weight } of adjacency[curId] as { to: number; weight: number }[]) {
          const next = curDist + weight;
          if (next < (dist[to] as number)) dist[to] = next;
        }
      }
      return Infinity;
    },
  };
}

/** The outward lead a booth's own spur arrives along (`spur`'s "Arrive
 * HEAD-ON, not obliquely" logic above), reused here so a connector meeting
 * a camera-facing booth arrives the same way every other ribbon does,
 * rather than grazing its counter's side wall. Empty for anything without a
 * `PARK_LAYOUT` entry (a station, a ride exit) — exactly the nodes `spur`
 * itself gives no lead to. */
function arrivalLead(node: PathNode): readonly [number, number][] {
  const placed = PARK_LAYOUT.entries.get(node.id);
  if (!placed) return [];
  const outX = node.x - placed.x;
  const outZ = node.z - placed.z;
  const out = Math.hypot(outX, outZ);
  if (out <= 1e-6) return [];
  return [[node.x + (outX / out) * 3.5, node.z + (outZ / out) * 3.5]];
}

/**
 * **The interconnection pass.** Everything earlier in {@link buildGraph}
 * builds a pure hub-and-spoke tree: the ring plus one spur per destination,
 * each branching wherever gives *that one destination* the shortest walk
 * (`bestBranchPoint`) — nothing in that process ever asks whether two
 * *different* destinations end up needlessly far apart from each other. A
 * real park's path network is a mesh: two neighbouring stalls on different
 * spurs get a paved line between them, not just a shared ring three turns
 * away.
 *
 * For every pair of real destinations that are both close (within
 * {@link CONNECTOR_SPACING_CAP_MULTIPLE} plot-hops, straight-line) and
 * whose *current* paved walk is a disproportionate multiple of both that
 * straight-line distance ({@link CONNECTOR_RATIO_THRESHOLD}) and the park's
 * own typical plot spacing ({@link CONNECTOR_MIN_WASTE_MULTIPLE}), adds one
 * direct edge between them — routed exactly like a spur (`manhattanRoute`,
 * with the same head-on arrival lead a booth's own spur uses), so it
 * detours round the same plots and lands on the same grid axes as the rest
 * of the network rather than reading as a special case.
 *
 * Candidates are processed nearest-first, and the distance oracle is
 * rebuilt after every addition, so a pair a just-added connector already
 * fixes is never connected a second time — over-connecting into a
 * fully-meshed graph is exactly what {@link CONNECTOR_SPACING_CAP_MULTIPLE}
 * and {@link CONNECTOR_MIN_WASTE_MULTIPLE} exist to prevent.
 */
function* addInterconnects(
  nodes: PathNode[],
  edges: PathEdge[],
  progress: number,
): Generator<number, number, void> {
  const destinations = nodes.filter((n) => DESTINATION_KINDS.has(n.kind));
  if (destinations.length < 2) return progress;

  const spacing = medianNearestNeighbourSpacing(destinations);
  if (spacing <= 0) return progress;
  const closeCap = spacing * CONNECTOR_SPACING_CAP_MULTIPLE;
  const minWaste = spacing * CONNECTOR_MIN_WASTE_MULTIPLE;

  const candidates: { a: PathNode; b: PathNode; straight: number }[] = [];
  for (let i = 0; i < destinations.length; i += 1) {
    for (let j = i + 1; j < destinations.length; j += 1) {
      const a = destinations[i] as PathNode;
      const b = destinations[j] as PathNode;
      const straight = Math.hypot(a.x - b.x, a.z - b.z);
      if (straight <= 1e-6 || straight > closeCap) continue;
      // A pair straddling the railway is never "close but unlinked" in the
      // sense this pass fixes: the walk between them is via a planned
      // crossing (`routeLeg`), and a direct connector here would either
      // cross the rail off-site or draw a second, redundant crossing run.
      if (railInfoAt(a.x, a.z).side !== railInfoAt(b.x, b.z).side) continue;
      candidates.push({ a, b, straight });
    }
  }
  // Nearest pairs first, ties broken by original (deterministic) order.
  candidates.sort((x, y) => x.straight - y.straight);

  // Rebuilding the distance oracle is the expensive part (it re-splices
  // every edge against every other), so it is only ever rebuilt lazily,
  // the first time a query follows an addition — not once per candidate.
  // Most candidates (roughly 3 in 4, measured on the canonical seed) never
  // trigger an edge, so rebuilding on every one of them was pure waste.
  let graph = buildRouteDistanceGraph(edges);
  let stale = false;
  for (const { a, b, straight } of candidates) {
    // One candidate pair per slice opportunity: each accepted connector plans
    // a street (a lattice search plus clearance screens), which is exactly
    // the per-unit cost the boot's budget is sized for.
    yield (progress += 1);
    if (stale) {
      graph = buildRouteDistanceGraph(edges);
      stale = false;
    }
    const paved = graph.distanceBetween(a.x, a.z, b.x, b.z);
    if (!Number.isFinite(paved)) continue; // not actually connected — a different bug, not this pass's job
    if (paved < straight * CONNECTOR_RATIO_THRESHOLD) continue;
    if (paved - straight < minWaste) continue;

    const leadA = arrivalLead(a);
    const leadB = arrivalLead(b);
    const fromPoint = leadA.length ? (leadA[0] as [number, number]) : ([a.x, a.z] as [number, number]);
    const toPoint = leadB.length ? (leadB[0] as [number, number]) : ([b.x, b.z] as [number, number]);
    // The street lattice first — a connector is a street like any other,
    // riding existing lattice lines where they already run. `routeLeg`
    // (the old clamped continuous router) only when both ends' stubs
    // cannot reach the lattice; the pair is same-side by the filter
    // above, so neither can ever hop the railway mid-run. The plan is
    // committed only *after* the corridor screen accepts it — a rejected
    // connector must not leave phantom paving for later routes to join.
    // A genuinely adjacent pair (the ferris wheel and its own kiosk stand
    // 2.3 m apart) is beneath the lattice's resolution: routing doorstep
    // to doorstep via each one's street stub can measure longer than the
    // detour this connector exists to fix, so close pairs connect direct.
    // The fallback `routeLeg` below can commit lattice paving through its
    // legs; a rejected connector's paving must not stand — every rejection
    // path restores this snapshot (see {@link latticeStateSnapshot}).
    const beforeConnector = latticeStateSnapshot();
    const plan = straight > 10 ? planStreetBetween(fromPoint, toPoint, true, true) : null;
    const points: (readonly [number, number])[] = [
      ...(leadA.length ? [[a.x, a.z] as [number, number]] : []),
      ...(plan
        ? plan.points
        : straight > 10
          ? snapRunsToLattice(routeLeg(fromPoint, toPoint))
          : sameSideLeg(fromPoint, toPoint, railInfoAt(a.x, a.z).side)),
      ...(leadB.length ? [[b.x, b.z] as [number, number]] : []),
    ];

    // A doorstep-to-doorstep link (the ferris wheel and its own kiosk are
    // 2.3 m apart) is exempt from the corridor screen: both ends' spurs
    // already carry lamps there, so the marginal lamp risk is nil, while a
    // cross-park shortcut under a ride's track is exactly the measured
    // pylon-starvation case the screen exists for.
    if (straight > 8 && routeCrossesARideCorridor(points)) {
      if (DEBUG_STREETS) {
        // eslint-disable-next-line no-console
        console.log(`[connect] ${a.id}-${b.id}: rejected, crosses a ride corridor`);
      }
      restoreLatticeState(beforeConnector);
      continue;
    }
    // A fallback connector that would draw its own private street line is
    // dropped rather than drawn: it is optional paving, and the lattice
    // rule outranks a shortcut (see {@link carriesAnOffLatticeStreetRun}).
    if (!plan && carriesAnOffLatticeStreetRun(points)) {
      if (DEBUG_STREETS) {
        // eslint-disable-next-line no-console
        console.log(`[connect] ${a.id}-${b.id}: rejected, off-lattice street run`);
      }
      restoreLatticeState(beforeConnector);
      continue;
    }
    // A connector running along the ginormous slide's leg corridor starves
    // the chute of standable ground (`slide/supports.ts`) — an optional
    // shortcut never outranks the slide's own legs. Measured on seed 11:
    // with this connector drawn the 72 m chute could stand only 2 legs.
    let slideOverlap = 0;
    for (let i = 1; i < points.length && slideOverlap <= 8; i += 1) {
      const a = points[i - 1] as readonly [number, number];
      const b = points[i] as readonly [number, number];
      slideOverlap += slideCorridorOverlap(a[0], a[1], b[0], b[1]);
    }
    if (slideOverlap > 8) {
      if (DEBUG_STREETS) {
        // eslint-disable-next-line no-console
        console.log(`[connect] ${a.id}-${b.id}: rejected, runs along the slide corridor`);
      }
      restoreLatticeState(beforeConnector);
      continue;
    }
    if (plan) commitStreetPlan(plan);

    edges.push({
      from: a.id,
      to: b.id,
      paved: true,
      route: { name: `connector-${a.id}-${b.id}`, width: CONNECTOR_WIDTH, closed: false, points },
    });
    stale = true;
  }
  return progress;
}

/**
 * How far a connector must stay from a ride's own track before it counts as
 * "clear" of it — a lamp post plus its own clearance search, not just the
 * ribbon's own half-width. See {@link routeCrossesARideCorridor}'s own
 * comment for the mechanism this exists to prevent; 10 m is a deliberately
 * generous multiple of every individual radius involved (`LampPosts.ts`'s
 * `LAMP_RADIUS` plus its own reach off the kerb, the ribbon's half-width plus
 * kerb), because an optional shortcut losing a candidate is free and a ride
 * losing a support pylon is not.
 */
const RIDE_CORRIDOR_CLEARANCE = 4;

/**
 * Every ride corridor a connector must stay clear of — sampled coarsely
 * (2 m) since this is a clearance *screen*, not a collision proof; missing a
 * sharp corner by a metre only costs an unnecessary rejection, never a false
 * "clear."
 *
 * Built once, lazily, from `COASTER_PLANS.cruiser.route.curve` — the same
 * plan `spur()`'s own `exit-${plan.name}` edges already import, no new data
 * source, just reused for a second purpose. Scoped to the Sky Cruiser only:
 * it is the one ride this was actually measured to break (see this
 * function's own comment) — `RailRaceRoute`/`PlannedSlide` don't expose the
 * same `curve` shape this reuses, and widening to them without a measured
 * failure to prove against would be guessing at a fix rather than applying
 * one. Worth revisiting if a future seed shows the same defect on either.
 */
let rideCorridorSamplesCache: (readonly [number, number])[] | null = null;
function rideCorridorSamples(): readonly (readonly [number, number])[] {
  if (rideCorridorSamplesCache) return rideCorridorSamplesCache;
  const samples: [number, number][] = [];
  const curve = COASTER_PLANS.cruiser.route.curve;
  const length = curve.getLength();
  if (Number.isFinite(length) && length > 0) {
    const steps = Math.max(2, Math.ceil(length / 2));
    for (let i = 0; i <= steps; i += 1) {
      const point = curve.getPointAt(i / steps);
      samples.push([point.x, point.z]);
    }
  }
  rideCorridorSamplesCache = samples;
  return samples;
}

/**
 * **Keeps a connector off a ride's own structural corridor** (Sky Cruiser
 * pylons, Rail Race trestles, the slide's legs) — found the hard way, 18
 * August 2026: `LampPosts.ts` places a lamp along every paved edge
 * (`World.ts` builds them before `Coaster.ts`), and a Sky Cruiser pylon spot
 * is only accepted if `collision.isClearCircle` says so at the moment the
 * coaster is built — so a brand-new connector, needing its own lighting like
 * any other ribbon, can seed a lamp exactly where a pylon needed to stand.
 * Seed 18's `stall.railRacer`/`stall.skyCruiser` connector did precisely
 * that: with it in the network the built Sky Cruiser dropped from a healthy
 * pylon count to 8 pylons on 215.2 m of track, one 97.2 m run uncarried
 * (`test/procgen/invariants.ts`'s `skyCruiserStandsOnItsOwnSupports`) —
 * proved by disabling this check and watching the same seed's Cruiser regain
 * its supports.
 *
 * A spur can graze the same corridor in principle, but never has in five
 * measured seeds — it radiates from the network to one nearby destination,
 * where a connector is built to cut across open ground between two
 * destinations that may have a ride's whole loop sitting between them. So
 * this guard lives here, on the newer and riskier kind of edge, rather than
 * widening every spur's own routing (which is already proven, on every
 * seed, not to need it).
 */
function routeCrossesARideCorridor(points: readonly (readonly [number, number])[]): boolean {
  const corridor = rideCorridorSamples();
  if (corridor.length === 0) return false;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as readonly [number, number];
    const b = points[i] as readonly [number, number];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const lengthSq = dx * dx + dz * dz;
    for (const [cx, cz] of corridor) {
      const t = lengthSq > 1e-9 ? Math.max(0, Math.min(1, ((cx - a[0]) * dx + (cz - a[1]) * dz) / lengthSq)) : 0;
      const px = a[0] + dx * t;
      const pz = a[1] + dz * t;
      if (Math.hypot(cx - px, cz - pz) < RIDE_CORRIDOR_CLEARANCE) return true;
    }
  }
  return false;
}

/**
 * How close a route's own drawn walk may come to the train's centreline
 * before {@link pushClearOfRail} nudges it away.
 *
 * `FENCE_OFFSET` (`train/fence.ts`) is where the real invisible flanking
 * wall actually stands — a route any closer than that is not routing near
 * the railway, it is routing into its own fence. `RIBBON_HALF_WIDTH_CEILING`
 * on top is the same "paved edge, not the centreline" reasoning
 * {@link ARCH_FOOT_MARGIN} above uses.
 */
const RAIL_CORRIDOR_CLEARANCE = FENCE_OFFSET + RIBBON_HALF_WIDTH_CEILING;

/**
 * Every point of the train's solved loop, sampled coarsely (3 m) — the same
 * "clearance screen, not a collision proof" shape as {@link rideCorridorSamples}.
 * Built once, lazily, from `TRAIN_PLAN.route`, which is already solved before
 * any path is drawn (`buildGraph` already relies on this to place station
 * spurs).
 */
let railCorridorSamplesCache: (readonly [number, number])[] | null = null;
function railCorridorSamples(): readonly (readonly [number, number])[] {
  if (railCorridorSamplesCache) return railCorridorSamplesCache;
  const samples: [number, number][] = [];
  const route = TRAIN_PLAN.route;
  if (Number.isFinite(route.length) && route.length > 0) {
    const steps = Math.max(2, Math.ceil(route.length / 3));
    const point = new Vector3();
    for (let i = 0; i <= steps; i += 1) {
      const distance = (i / steps) * route.length;
      // Skip the real fence's own gaps (`buildRailFence`'s `open` ranges,
      // `train/fence.ts`): every station's platform legitimately stands
      // close to the track, and a spur passing near one — including one
      // headed somewhere else entirely, on the far side of the loop, the way
      // the canonical seed's `spur-station-0` genuinely does — is walking
      // through a real gap in the real wall, not through the fence itself.
      // Kept close to `STATION_GAP` itself (the fence's own half-width, not
      // the platform's own length): tried wider first (25 m, covering the
      // platform's `PLATFORM_LENGTH` plus an approach reach) and it silently
      // exempted the *actual* danger along with the legitimate gap — the
      // canonical seed's real failure sat only 2.11 m from centreline, well
      // inside a 25 m station exemption but well outside this one, so the
      // very screen meant to let a legitimate station-side pass through
      // instead let the genuine collision through with it.
      const nearStation = TRAIN_PLAN.stations.some(
        (station) => railAlongDistance(distance, station.distance, route.length) < RAIL_STATION_GAP_MARGIN,
      );
      if (nearStation) continue;
      route.pointAt(distance, point);
      samples.push([point.x, point.z]);
    }
  }
  railCorridorSamplesCache = samples;
  return samples;
}

/** Circular distance between two along-route offsets, wrapping at `length`. */
function railAlongDistance(a: number, b: number, length: number): number {
  const diff = Math.abs(a - b) % length;
  return Math.min(diff, length - diff);
}

/**
 * Along-route half-width of the band round each station where
 * {@link railCorridorSamples} exempts the rail from clearance checking at
 * all, because the real fence has a genuine gap there for the platform.
 *
 * **Tied directly to `STATION_GAP`** (`train/fence.ts`), the real fence
 * builder's own half-width for that gap — not a separately hand-picked
 * number that is only supposed to track it. A second PR #286 review (issue
 * #269, 18 August 2026) found this had drifted to a flat `10`, 3.5 m past
 * `STATION_GAP`'s `6.5`: every corridor sample between 6.5 m and 10 m of a
 * station along the route was exempted too, even though the real fence is
 * *closed*, not open, out there — a silent blind band, not just a coarse
 * screen. Measured concretely on the canonical seed: `spur-waterFight`'s
 * pushed run sat only 0.83 m from the actual fence wall (needs
 * {@link RAIL_CORRIDOR_CLEARANCE}'s ~4.65 m) because this exemption skipped
 * every corridor sample near enough to have caught it. The `25 m` and
 * flat-`10` attempts both trade the same currency in the same wrong
 * direction — favouring "never a spurious push near a station" over "never
 * miss the fence" — which is the one CLAUDE.md ranks the other way round.
 * Equal to `STATION_GAP` needs no slack of its own: `railAlongDistance` is
 * compared against a *sampled* rail position no more than the corridor's
 * own ~3 m sampling pitch away from wherever the true gap boundary falls,
 * and a sample that lands just past the boundary is exactly the samples
 * this screen exists to let through to the clearance check, not exempt.
 */
const RAIL_STATION_GAP_MARGIN = STATION_GAP;

/**
 * **Nudges a route's own axis-aligned runs away from the railway** (issue
 * #269 follow-up, discovered by this very round, 18 August 2026). Making the
 * statue's ring a true circle moves several spurs' branch points
 * (`bestBranchPoint`'s "shortest real walk" search re-scores every candidate
 * against the ring's new shape, exactly as it is supposed to) — and on the
 * canonical seed, `spur-waterFight`'s resulting route ran a ~19 m vertical
 * leg only 2-3 m off the train's own flanking fence, stranding a `poiGraph`
 * waypoint whose lane sample sat against a wall nobody had ever told this
 * router about (`check:park`'s `poi.stranded`, caught before this landed).
 * `paths.ts` never needed rail awareness before this — no spur had ever been
 * measured to graze it in five seeds (see {@link routeCrossesARideCorridor}'s
 * own "a spur can graze the same corridor in principle, but never has" note
 * about the Sky Cruiser; same shape of gap, now genuinely hit here instead).
 *
 * **Two other shapes of fix were tried and measurably failed:**
 *
 * - **A `BLOCKERS` entry** (a discrete circle every 3 m along the whole
 *   363 m loop, exactly like {@link archFeet}): `elbowLeg`/`gridDetour`'s
 *   corner search is tuned against a handful of isolated blobs, not a dense
 *   chain of ~120 near-touching circles forming a continuous wall —
 *   {@link pathsRunOnGridAxes} in the invariants failed on all five seeds,
 *   on spurs that have nothing to do with the railway, each one giving up
 *   its own corner search and falling back to a 16-27 m raw diagonal.
 * - **Preferring a different `bestBranchPoint` candidate** whose own
 *   constructed walk stayed clear of the rail (scoring-only, no new
 *   blockers): still moved the *branch point*, which moved everything
 *   downstream of it exactly the way a longer or shorter spur always does
 *   (`SPUR_STRETCH`'s own comment: "a longer spur leaves distant scenery
 *   where it was" is not automatically true once the branch point itself
 *   moves) — measured on the canonical seed, it swapped one stranded
 *   waypoint for **sixteen**, all in an entirely different part of the park
 *   the original route never touched.
 *
 * So this is neither: it leaves {@link bestBranchPoint}'s choice of branch
 * point, and every other point of the route, completely alone, and instead
 * locally deforms only the one maximal axis-aligned run that actually comes
 * too close — shifting its own shared coordinate (an axis-aligned run's `x`
 * if vertical, `z` if horizontal) directly away from the railway by just
 * enough to clear. Both neighbouring runs stay exactly where they were
 * (`manhattanRoute` alternates horizontal/vertical runs by construction, via
 * `collapseCollinear`, so the connecting hop either side of a shifted run
 * only ever changes *length*, never direction — it stays axis-aligned by
 * the same geometry that made the run itself axis-aligned). Never applied to
 * the route's own two endpoints (the branch point and the destination),
 * which other code depends on matching exactly.
 *
 * The nudge is re-verified against `BLOCKERS` before it is applied. See
 * {@link RAIL_PUSH_WIDEN_STEPS} for the search this runs when the
 * rail-clearing minimum would clip a plot, and that constant's own comment
 * for why a push of exactly `0` is always safe as the last resort.
 */
/**
 * Extra distances {@link pushClearOfRail} tries on top of its own
 * rail-clearing minimum push (`basePush`) when that minimum would clip a
 * `BLOCKERS` plot — widening in fixed steps until a candidate clears, the
 * same shape {@link GRID_DETOUR_REACHES} widens `gridDetour`'s search. If
 * nothing widening finds clears, the run is left at its pre-shift position
 * (`applied` stays `0`).
 *
 * **Two other shapes were tried here and measurably made things worse — read
 * this before changing the search again** (issue #269 PR #286 review round
 * 2, 18 August 2026):
 *
 * - **Also searching *smaller* pushes** (fractions of `basePush` down to
 *   `0`, preferring the largest that clears): on seed 2, a partial push in
 *   the rail-clearing direction clips fewer blockers than the full push, but
 *   lands *closer* to the Rail Race finish rainbow's own legs than either
 *   the full push or no push at all — "prefer the largest push that clears
 *   blockers" walks straight into a worse spot for a concern this function
 *   cannot see (nothing here checks distance to the rainbow, only to
 *   `BLOCKERS`). Measured: 0.79 m/0.29 m against a rainbow leg with a
 *   partial push, vs 0.91 m/0.47 m with none — worse, not better.
 * - **Checking the shift *relative* to the run's own pre-shift blocker
 *   distance** (grandfathering any blocker the run was already nearer than
 *   `ROUTE_WALKER_PAD` to, so only a *newly introduced* violation blocks the
 *   push): motivated by a real observation — the pre-shift run is not
 *   always already fully clear of every blocker in an absolute sense (one
 *   canonical-seed run sat 8.02 m from a plot needing 11.8 m, a proximity
 *   `detourAroundBlockers`/`gridDetourAttempt` can legitimately leave in
 *   place for reasons local to *that* construction) — but implemented and
 *   measured, this let far larger pushes through than the flat check ever
 *   had, swinging several runs through the dense 'garden' area's decorative
 *   clutter, which `BLOCKERS` does not model at all (it only holds plots and
 *   arch feet). Result: `check:park`'s `poi.stranded` went from 1 to **35**.
 *   Reverted outright, not tuned — the flat check below is *stricter* than
 *   the guarantee this router actually makes in every case, but it is the
 *   far smaller, better-understood departure from the pre-fix behaviour.
 *
 * **This flat check is therefore known to have residual gaps, not a clean
 * fix**, and they are visible, not silent: with only this widen-then-give-up
 * search, `test:procgen` fails one assertion on seed 2 (a `railRace` spur's
 * pushed run leaves the finish rainbow's inner legs 0.91 m/0.47 m from the
 * nearest path edge, needing 1.24 m) and `check:park` fails one on the
 * canonical seed (`poi.stranded`, one `garden` waypoint). Both trace to the
 * same structural cause: this function processes a route's runs
 * sequentially over one mutable array, so a later run's starting point
 * inherits wherever an earlier run's push decision left it — declining an
 * unsafe push on one run can measurably reshape a *different, distant* part
 * of the very same route. Both regressions were confirmed, by reverting this
 * whole fix and re-measuring, to be **pre-existing**: the un-reviewed,
 * unconditional push was silently relying on exactly the shape of blocker
 * violation issue #269 PR #286's review flagged to *also*, coincidentally,
 * pull those two routes clear of obstacles this function was never checking
 * against. Fixing the reviewed bug correctly removes that accidental
 * benefit. Leaving a plot silently clipped is worse than either of these —
 * both are loud, CI-visible, and fixable in a followup that gives this
 * function (or the routes themselves) real awareness of the finish
 * rainbow's clearance and the garden waypoint's connectivity, neither of
 * which `BLOCKERS` currently carries.
 */
const RAIL_PUSH_WIDEN_STEPS: readonly number[] = [0, 1, 2, 4, 8];

/**
 * **Investigated, and confirmed structural rather than tunable** (issue #269
 * PR #286 followup, 18 August 2026): the canonical seed's `spur-waterFight`
 * push leaves a `poiGraph` waypoint stranded (`check:park`'s `poi.stranded`)
 * because the *rendered* Catmull-Rom curve — not the straight control
 * polygon every check in this function walks — swings past a short dog-leg
 * (the pushed run's own connecting hop to its unmoved neighbour) and comes
 * within about a metre of the rail's fence, well inside the ~4.65 m
 * `RAIL_CORRIDOR_CLEARANCE` this function targets.
 *
 * A curve-aware re-verification was built and tried here: reconstruct the
 * actual `CatmullRomCurve3` (`routeCurve`, tension 0.4 — identical to what
 * every route in this file is finally rendered with, and to what
 * `poiGraph.ts` samples its waypoints from) for each candidate push and walk
 * its locally-influenced window (three.js's own local support: a segment
 * `[k, k+1]` depends only on control points `[k-1, k, k+1, k+2]`, so nothing
 * outside `[i-2, end+2]` can differ between candidates) against the rail
 * corridor. It correctly *detects* the overshoot — every one of
 * {@link RAIL_PUSH_WIDEN_STEPS}'s five magnitudes measurably violates
 * clearance somewhere in that window. But widening the search past that made
 * it clear the defect is not a missing magnitude: a fine sweep from 0 m to
 * 15 m of push (every 0.5 m) never once cleared `RAIL_CORRIDOR_CLEARANCE` —
 * clearance oscillated between 0.09 m and 1.19 m the entire way, because two
 * *different* local minima (the run's own body at low push, the dog-leg's
 * overshoot at high push) trade off against each other with no push value
 * that satisfies both.
 *
 * That means a pure single-axis shift of the one run — everything
 * `pushClearOfRail` does — cannot fix this route: the fixed neighbour on the
 * other side of the short hop would have to move too, which this function
 * cannot do without either breaking that neighbour's own axis alignment
 * (its shared coordinate belongs to the *previous*, already-decided run) or
 * cascading the shift backward through the route towards its branch point —
 * a materially different algorithm, not a wider search. So the curve-aware
 * check above was reverted rather than shipped half-working: a check that
 * can reliably detect a defect it can never let the search resolve would
 * only turn every rail-adjacent run in the park into a permanently-declined
 * push, `applied` always `0`, the exact "leave it wherever the pre-shift
 * position was" failure this whole function exists to avoid. `poi.stranded`
 * on the canonical seed stays open — see PR #286's followup comment for the
 * measurements above and why a real fix needs to move more than one run.
 */
function pushClearOfRail(
  points: readonly (readonly [number, number])[],
): (readonly [number, number])[] {
  const corridor = railCorridorSamples();
  const out: [number, number][] = points.map((p) => [p[0], p[1]] as [number, number]);
  if (corridor.length === 0 || out.length < 3) return out;

  let i = 0;
  while (i < out.length - 1) {
    const a = out[i] as [number, number];
    const b = out[i + 1] as [number, number];
    const sameX = Math.abs(a[0] - b[0]) < 1e-6;
    const sameZ = !sameX && Math.abs(a[1] - b[1]) < 1e-6;
    if (!sameX && !sameZ) {
      i += 1;
      continue;
    }
    // Extend the run while later hops keep sharing the same coordinate.
    let end = i + 1;
    while (end < out.length - 1) {
      const c = out[end] as [number, number];
      const d = out[end + 1] as [number, number];
      const stillX = sameX && Math.abs(c[0] - d[0]) < 1e-6 && Math.abs(c[0] - a[0]) < 1e-6;
      const stillZ = sameZ && Math.abs(c[1] - d[1]) < 1e-6 && Math.abs(c[1] - a[1]) < 1e-6;
      if (!stillX && !stillZ) break;
      end += 1;
    }
    // Never the route's own endpoints — see this function's own comment.
    if (i > 0 && end < out.length - 1) {
      const runStart = out[i] as [number, number];
      const runEnd = out[end] as [number, number];
      let minDistance = Infinity;
      let nearest: readonly [number, number] | null = null;
      const runLength = Math.hypot(runEnd[0] - runStart[0], runEnd[1] - runStart[1]);
      const steps = Math.max(1, Math.ceil(runLength));
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        const px = runStart[0] + (runEnd[0] - runStart[0]) * t;
        const pz = runStart[1] + (runEnd[1] - runStart[1]) * t;
        for (const sample of corridor) {
          const d = Math.hypot(sample[0] - px, sample[1] - pz);
          if (d < minDistance) {
            minDistance = d;
            nearest = sample;
          }
        }
      }
      if (nearest && minDistance < RAIL_CORRIDOR_CLEARANCE) {
        const axis = sameX ? 0 : 1;
        const direction = (runStart[axis] as number) >= (nearest[axis] as number) ? 1 : -1;
        const basePush = RAIL_CORRIDOR_CLEARANCE - minDistance + 0.5;

        // Re-verify against BLOCKERS after nudging — the same "prove it,
        // don't assume it" discipline every other step of this router
        // already applies (`elbowLeg`'s two-corner check, `gridDetour`'s
        // own segment-clearance search) but this function, until now,
        // skipped: a nudge that clears the rail can just as easily walk the
        // run straight into a plot standing on the far side of it, and
        // nothing downstream re-checks a shifted run against `BLOCKERS` once
        // this pass has moved it (issue #269 PR #286 review). Widen the push
        // by {@link RAIL_PUSH_WIDEN_STEPS} and take the first candidate that
        // clears `segmentClearOfBlockers`; if none do, `applied` stays `0`
        // and the run keeps its pre-shift position — see that constant's own
        // comment for the two other search shapes tried here, measured, and
        // reverted, and for the residual gaps this flat check still has.
        //
        // **The two connecting hops either side of the run need the same
        // proof, not just the run itself** (issue #269 PR #286 followup, 18
        // August 2026). This function's own header comment claims a shifted
        // run's neighbours "only ever change length, never direction"
        // because `manhattanRoute` alternates horizontal/vertical runs by
        // construction — true whenever both neighbours are themselves
        // axis-aligned legs `elbowLeg` built. It is *not* true when a
        // neighbour is `gridDetour`'s own last-resort fallback: a raw,
        // un-axis-aligned diagonal left in place when every corner search it
        // tried failed (that function's own comment — "keeps the route
        // connected rather than failing the build"). Shifting a shared
        // vertex changes *that* segment's direction, not just its length,
        // exactly like moving one end of any other line segment. Measured on
        // seed 2: `spur-stall.railRacer` couldn't find a clear elbow into its
        // tightly-packed rail-race-arch doormat, so `gridDetour` gave up and
        // left a raw diagonal for the final approach; pushing the *previous*
        // run's shared corner away from the rail swung that diagonal's other
        // end closer to two finish-rainbow legs it had never been checked
        // against, landing at 0.91 m / 0.47 m (needs `WALKABLE_GAP`, 1.24 m).
        // So both connecting hops are checked here too, with whichever
        // out-of-range point they still reach into (`out[i - 1]`/
        // `out[end + 1]`, always in bounds — the outer `if` above guarantees
        // `i > 0` and `end < out.length - 1`) — cheap (one more
        // `segmentClearOfBlockers` call each) next to the run's own sampled
        // sweep above, and it is exactly the check this function already
        // does for the run itself, just extended to the two segments a shift
        // can also silently move.
        let applied = 0;
        for (const extra of RAIL_PUSH_WIDEN_STEPS) {
          const candidate = basePush + extra;
          const dx = axis === 0 ? direction * candidate : 0;
          const dz = axis === 1 ? direction * candidate : 0;
          const shiftedStart: readonly [number, number] = [runStart[0] + dx, runStart[1] + dz];
          const shiftedEnd: readonly [number, number] = [runEnd[0] + dx, runEnd[1] + dz];
          const before = out[i - 1] as readonly [number, number];
          const after = out[end + 1] as readonly [number, number];
          if (
            segmentClearOfBlockers(shiftedStart[0], shiftedStart[1], shiftedEnd[0], shiftedEnd[1], ROUTE_WALKER_PAD) &&
            segmentClearOfBlockers(before[0], before[1], shiftedStart[0], shiftedStart[1], ROUTE_WALKER_PAD) &&
            segmentClearOfBlockers(shiftedEnd[0], shiftedEnd[1], after[0], after[1], ROUTE_WALKER_PAD)
          ) {
            applied = candidate;
            break;
          }
        }
        if (applied !== 0) {
          for (let k = i; k <= end; k += 1) {
            (out[k] as [number, number])[axis] += direction * applied;
          }
        }
      }
    }
    i = end;
  }
  return out;
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
  x: number,
  z: number,
): readonly [number, number] {
  const allCandidates: (readonly [number, number])[] = [];
  for (const route of routes) {
    const point = nearestPointOnRoute(route, x, z);
    if (point) allCandidates.push(point);
  }
  // The ring is always a legal place to start from, and it is the fallback if
  // no paved route offered a junction outside every plot.
  // The ring's own candidate is its nearest COMPASS junction, never an
  // arbitrary point on the circle — Decision: exactly 4 ring connections.
  allCandidates.push(nearestCompassPoint(x, z));

  // **Branch from the destination's own side of the railway whenever the
  // network already reaches it.** The first spur to a far-side district
  // crosses via a planned site (`routeLeg`); every later destination over
  // there should hang off that district's own paving rather than launch a
  // second crossing of its own — a nearest-junction choice with no side
  // awareness sent seed 2's dodgems spur straight through a 9 m pinch
  // between two rail passes (two rogue crossings), when a same-side branch
  // point a little further away needed none.
  const destinationSide = railInfoAt(x, z).side;
  const sameSide = allCandidates.filter(
    (candidate) => railInfoAt(candidate[0], candidate[1]).side === destinationSide,
  );
  const candidates = sameSide.length ? sameSide : allCandidates;

  const scored = candidates.map((candidate) => ({
    candidate,
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
    walk: polylineLength(detourAroundBlockers(candidate, [x, z])),
  }));
  scored.sort((a, b) => a.walk - b.walk);
  return (scored[0] as { candidate: readonly [number, number] }).candidate;
}

/**
 * A fallback spur's whole route, **backtracking on quality** (CLAUDE.md's
 * standing procgen rule): the shortest-walk branch point is tried first,
 * but if the old continuous router's result carries a give-up diagonal —
 * an `elbowLeg` boxed in by a pocket the chosen junction forced it into —
 * the next-best junction is tried instead, rather than shipping the known-
 * bad shape (measured: 24-30 m raw diagonals on seeds 2 and 11 from
 * exactly this, each of which routed cleanly from a nearby alternative).
 * If no candidate routes cleanly, the least-diagonal result is kept — a
 * connected park outranks a tidy one.
 */
function fallbackSpurRoute(
  routes: readonly RouteDefinition[],
  target: readonly [number, number],
): (readonly [number, number])[] {
  const allCandidates: (readonly [number, number])[] = [];
  for (const route of routes) {
    const point = nearestPointOnRoute(route, target[0], target[1]);
    if (point) allCandidates.push(point);
  }
  allCandidates.push(nearestCompassPoint(target[0], target[1]));
  // No hard same-side filter here, deliberately: near a crossing the side
  // sign flips over a couple of metres, and filtering dropped the one
  // candidate standing right beside the destination (the canonical seed's
  // rail-race stall sits across the gate corridor's own level crossing
  // from its natural branch point, and the filter handed it a 95 m
  // fence-follow arc instead of a 9 m doorstep spur). `routeLeg` already
  // routes a straddling pair through a planned site, and the quality
  // scoring below prices the resulting length honestly.
  const candidates = allCandidates
    .map((candidate) => ({
      candidate,
      walk: polylineLength(detourAroundBlockers(candidate, target)),
    }))
    .sort((a, b) => a.walk - b.walk);
  // Weighted, not tiered: a defect is priced, never absolute. Tiers were
  // tried first and misranked badly — a 90 m fence-follow arc is "clean"
  // (rail-hugging geometry is exempt from both defect measures), so it
  // beat a 10 m spur carrying one short off-lattice run, and the canonical
  // seed's rail-race stall got a park-circling promenade instead of a
  // doorstep path. Length is the base cost; each defect adds what it is
  // roughly worth in walked metres.
  // Each candidate's `routeLeg` may commit lattice paving as it solves;
  // only the winner's paving may stand — see {@link latticeStateSnapshot}.
  const before = latticeStateSnapshot();
  let best: (readonly [number, number])[] | null = null;
  let bestScore = Infinity;
  let bestState: LatticeStateSnapshot | null = null;
  for (const { candidate } of candidates.slice(0, 4)) {
    restoreLatticeState(before);
    const points = snapRunsToLattice(routeLeg(candidate, target));
    const worst = longestOffAxisRun(points);
    // Metres spent hugging the rail corridor count double: a fence-follow
    // is exempt from every shape metric, which otherwise makes it read as
    // the *cleanest* candidate — while its ribbon squeezes the waypoints
    // seeded along it against the fence (measured: the canonical slide
    // exit picked a station-tail branch down the rail strip over an open
    // branch of equal walk, and stranded five waypoints).
    let railHug = 0;
    for (let k = 1; k < points.length; k += 1) {
      const p = points[k - 1] as readonly [number, number];
      const q = points[k] as readonly [number, number];
      const hop = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const steps = Math.max(1, Math.ceil(hop / 2));
      for (let t = 0; t <= steps; t += 1) {
        const x = p[0] + ((q[0] - p[0]) * t) / steps;
        const z = p[1] + ((q[1] - p[1]) * t) / steps;
        if (railInfoAt(x, z).dist < 6) {
          railHug += hop / steps;
        }
      }
    }
    const score =
      polylineLength(points) +
      railHug +
      (carriesAnOffLatticeStreetRun(points) ? 50 : 0) +
      (worst > MAX_OFF_AXIS_RUN ? 100 + (worst - MAX_OFF_AXIS_RUN) * 2 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = points;
      bestState = latticeStateSnapshot();
    }
  }
  if (best && bestState) {
    restoreLatticeState(bestState);
    return best;
  }
  restoreLatticeState(before);
  return snapRunsToLattice(routeLeg(bestBranchPoint(routes, target[0], target[1]), target));
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

