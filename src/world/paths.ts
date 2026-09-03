import { CatmullRomCurve3, Vector3 } from 'three';
import { PLAYER_RADIUS } from '../core/constants';
import { ANCHORS } from './anchors';
import { PARK_LAYOUT, RING_RADIUS, edgeDistanceAlong } from './parkLayout';
import { PARK_BOUNDARY } from './boundary';
import { TRAIN_PLAN, RAIL_CORRIDOR_CLEARANCE as RAIL_CORRIDOR_CLEARANCE_PLAN } from './train/plan';
import { STATION_GAP } from './train/fence';
import { FENCE_OFFSET } from './train/clearance';
import { DECK_HALF_LENGTH } from './train/bridgeFootprint';
import { CROSSING_SITES, type CrossingSite } from './train/crossingPlan';
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
    // **Both walkable: prefer the one the street screen also accepts.**
    //
    // `segmentIsWalkable` asks {@link BLOCKERS}, which holds the plots — it
    // does not know about the park boundary or the entrance arch's own
    // masonry. `streetSegmentClear` is the generator's one owner of "may a
    // street go here" (it is what the lattice itself is built with), and it
    // knows about both. Where the two elbows disagree under it, the choice
    // is not a tie and the heuristic below should not be deciding it.
    //
    // Measured on seed 5's walk in from the gate, which has to reach the
    // railD 12 crossing's minus foot at (15.8, 59.2), 3.6 m inside the
    // boundary. `debugStreetSegment` on the two elbows:
    //
    //   north-then-east  (0,47.8)->(0,59.2)->(15.8,59.2)   clear=false, false
    //   east-then-north  (0,47.8)->(15.8,47.8)->(15.8,59.2) clear=true,  true
    //
    // The `dz <= dx` rule below picked north-then-east, and the resulting
    // 15.8 m run was drawn 0.8 m from the entrance arch's own pier (a 0.55 m
    // collider at (4.30, 60.00) that `BLOCKERS` does not carry). A child
    // could not walk it — `scripts/probe-blocked-ribbons.mts` finds
    // `gate-approach` blocked solid at (4.1, 59.2) — and it sat 1.94 m off
    // the 12 m lattice, which is the invariant that caught it.
    //
    // This can never reject a leg: it only ever chooses between two corners
    // that are already walkable, so a route that solved before still solves.
    // When both elbows are street-clear, or neither is, the local rule below
    // decides exactly as it always did — so #269's "correct the small axis"
    // lesson is untouched wherever it was the thing doing the work.
    const streetVia = (corner: readonly [number, number]): boolean =>
      streetSegmentClear(a[0], a[1], corner[0], corner[1]) &&
      streetSegmentClear(corner[0], corner[1], b[0], b[1]);
    const streetX = streetVia(cornerX);
    const streetZ = streetVia(cornerZ);
    if (streetX !== streetZ) return [streetX ? cornerX : cornerZ, b];
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
    plus: foot(1, site.rampReachPos + 1.0),
    minus: foot(-1, site.rampReachNeg + 1.0),
  };
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
  // A destination standing **inside** a plot's own footprint exempts that plot
  // outright, not merely to the walk-along margin below. The ginormous slide's
  // exit is the case: the chute lands inside the castle's own plot, so every
  // sample of every candidate connector was inside it and the door had no
  // route onto the grid at all on five of the sixteen pool seeds. Its own
  // building is not an obstacle to arriving at it.
  const relaxed = exemptAt
    ? plots.filter((plot) => {
        const edge = distanceToPlotEdge(plot, exemptAt[0], exemptAt[1]);
        return edge <= exemptNear && edge >= 0;
      })
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
function segmentCutsABridgeRamp(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  exemptSite: CrossingSite | null = null,
): boolean {
  // **Solved, not sampled** (2 Sep 2026). This walked the segment in 1.5 m
  // steps and asked `pointStandsOnBridgeMasonry` at each one, under a comment
  // claiming "1.5 m is coarser than the 3 m parapet band is thick". The band is
  // `halfWidth` to `halfWidth + RAMP_SCREEN_MARGIN` — **half a metre** thick,
  // not three — so a ribbon crossing a ramp square-on stepped clean over it
  // between two samples and the screen said nothing.
  //
  // Measured on seed 225: five drawn routes crossed a parapet
  // (`spur-building`, `spur-ferrisWheel`, `spur-dodgems`, `spur-waterFight`,
  // `spur-stall.keychain`), the control polylines every bit as much as the
  // drawn curves — so it was never the fillet pass. Each crossing breaks the
  // waypoint chain of the route it is on, because the parapet is solid, and the
  // two halves fall into separate `poiGraph` pockets: seed 225's whole
  // `poi.stranded` count of 70 across three components.
  //
  // In the site's own (along, across) frame the parapet is two axis-aligned
  // rectangles, so this is an exact segment-rectangle test — no step size to be
  // wrong about, and cheaper than sampling finely enough to be safe.
  for (const site of CROSSING_SITES) {
    // **A crossing's own approach is exempt from its own site, by identity.**
    // The reservation below is forbidden ground to every *foreign* leg, which
    // is the whole point of it — but the bridge's own feet have to be joined
    // to the grid, and a foot stands only 1.0 m past `alongMax`, so a
    // connector leaving it grazes the rectangle it belongs to. #414 records
    // what happens when that is not exempted: screening the full footprint
    // refused the crossing's approach and cost seed 24 its only bridge.
    //
    // Exempting by identity rather than by distance is deliberate. A radius
    // round the foot would be a second definition of "near this bridge" that
    // could drift from the rectangle itself; passing the site says exactly
    // which bridge is being approached and exempts nothing else, so a foot's
    // connector is still screened against every OTHER site it might cross.
    if (site === exemptSite) continue;
    const alongA = (ax - site.x) * site.dirX + (az - site.z) * site.dirZ;
    const acrossA = -(ax - site.x) * site.dirZ + (az - site.z) * site.dirX;
    const alongB = (bx - site.x) * site.dirX + (bz - site.z) * site.dirZ;
    const acrossB = -(bx - site.x) * site.dirZ + (bz - site.z) * site.dirX;
    const alongMin = -(DECK_HALF_LENGTH + site.rampReachNeg + RAMP_SCREEN_MARGIN);
    const alongMax = DECK_HALF_LENGTH + site.rampReachPos + RAMP_SCREEN_MARGIN;
    // **The whole reservation, not the annulus round it.** Measured 2 Sep
    // 2026 (`scripts/tmp-sitedrift.mts`, which carries its own control): on
    // every site on seeds 24, 131 and 451 the built masonry stands at
    // |across| 1.1 to 2.7, while this band was
    // `[halfWidth, halfWidth + 0.5]` = `[4 or 5, +0.5]` — between 1.1 and
    // 2.3 m OUTSIDE the outermost solid ground. It guarded grass, and the
    // real wall lay inside the region the screen called road.
    //
    //   seed  site  halfWidth  old band      walkable   solid
    //   131   224     5.00     [5.00, 5.50]   +-1.10    +-2.70
    //   451     0     4.00     [4.00, 4.50]   +-1.30    +-2.90
    //   451    38     5.00     [5.00, 5.50]   +-1.30    +-2.90
    //    24    20     5.00     [5.00, 5.50]   +-1.10    +-2.70
    //
    // The arithmetic closes exactly: walkable is the footprint's `walkHalf`,
    // `roadHalf = walkHalf + PLAYER_RADIUS`, `halfAcross = roadHalf +
    // BRIDGE_WALL_THICKNESS`, and a 0.7 m clearance probe stops at
    // `halfAcross + 0.7` — 1.10 + 0.5 + 0.3 + 0.7 = 2.60 against 2.70.
    //
    // `site.halfWidth` is the **planner's reservation** (`SITE_HALF_WIDTH`);
    // the bridge is built as wide as the path that crosses it and no wider
    // (Jim, 2026-08-23), along that path's own curved spine. Its real width
    // therefore cannot be known here — the paths do not exist yet. The rule
    // that *can* be stated before drawing is that the reservation belongs to
    // the bridge alone, so the deck edge (a mandatory `link()`, never
    // screened) and the feet's own connectors (exempt above) are the only
    // things in it, and no later, narrower bridge can meet a foreign ribbon.
    const inner = 0;
    const outer = site.halfWidth + RAMP_SCREEN_MARGIN;
    for (const sign of [1, -1] as const) {
      if (
        segmentMeetsRect(
          alongA,
          acrossA * sign,
          alongB,
          acrossB * sign,
          alongMin,
          alongMax,
          inner,
          outer,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Liang-Barsky: does the segment meet the axis-aligned rectangle at all
 * (touching counts)? Used in a crossing site's own frame, where the parapet is
 * a rectangle and the road beside it is not. */
function segmentMeetsRect(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  xMin: number,
  xMax: number,
  zMin: number,
  zMax: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, ax - xMin) &&
    clip(dx, xMax - ax) &&
    clip(-dz, az - zMin) &&
    clip(dz, zMax - az)
  );
}

/**
 * Slack added to a site's own proven extent before this file screens anything
 * against it.
 *
 * **Half a metre, which is what the screen this replaced always used** — and
 * deliberately not more. A wider skirt looks free and is not: raising it to
 * 1.5 m (the ribbon's own half-width, which was the tempting justification)
 * pulled enough lattice edges and branch candidates out of play on seed 5 that
 * `spur-stall.facePaint` came out starting 3.10 m from any other paving,
 * failing `no paved path stops anywhere but a destination`. The screen's job is
 * to keep paths off the bridge, not to clear a plaza around it.
 *
 * The real widening in this rewrite is that the half-width now comes from the
 * **site's own** proven `halfWidth` rather than a module constant, so a narrow
 * site is screened at the width it was actually proven at.
 *
 * ## It said 0.5 and it was 1.5, for the whole of this branch (#414)
 *
 * Everything above was already written here, arguing for half a metre and
 * naming 1.5 as the value that broke seed 5 — while the constant underneath it
 * read `1.5`. The doc and the number disagreed, which is this repo's most
 * expensive recurring bug appearing in the file that documents it.
 *
 * Restored to the documented 0.5, and it is not a tuning: the skirt pads a
 * parapet that is 0.3 m thick, so a metre and a half of it refuses ground a
 * child can plainly stand on. Measured on seed 24 — the two lattice nodes the
 * screen cost it, (11.3, -33.6) and (11.3, -45.6), sit at |across| 5.98 and
 * 5.06 against a deck half-width of 5.0: **1.0 and 0.1 m clear of the
 * masonry**, inside the 1.5 m skirt and outside a 0.5 m one. Losing them
 * starved the crossing's approach to proven site 20 and left seed 24, alone of
 * every seed, with no bridge at all.
 */
const RAMP_SCREEN_MARGIN = 0.5;

/**
 * **The ground a bridge will really stand on — deck, both ramps and the
 * parapets that flank them — known before a single path is drawn.**
 *
 * This is the one owner of that rectangle in `paths.ts`, and it is
 * deliberately built from the *site's own* proven numbers rather than from
 * anything restated here:
 *
 * - `DECK_HALF_LENGTH` is imported from `train/bridgeFootprint.ts`, the
 *   module that builds the deck.
 * - `rampReachPos` / `rampReachNeg` and `halfWidth` are the reaches
 *   `train/crossingPlanSolve.ts` *proved* a ramp into when it accepted this
 *   site, and are the same figures `bridgeFootprint.ts`'s search starts its
 *   own backtracking from.
 *
 * **Keep it that way.** If the layout's idea of a bridge's footprint and the
 * builder's ever drift apart, issue #414 comes straight back wearing
 * different clothes: the drift *is* the bug. Two numbers describing one piece
 * of ground, maintained in two places, is this repo's most expensive
 * recurring mistake.
 *
 * ## Why `paths.ts` needs this at all (issue #414)
 *
 * Before this, `paths.ts` knew only the crossing *point* — enough to route a
 * rail-crossing leg through a proven site, and nothing at all about how much
 * ground the bridge would occupy. So every other router was free to put a
 * street, a lattice node or a spur's branch point inside a ramp. Measured on
 * the canonical seed: `spur-dodgems` branched off the gate approach at
 * (-22.2, 36.4) — a point on the bridge's own crown, 4.40 m in the air — and
 * ran 7 m along the ramp before turning off its side into the parapet. Jim,
 * three times: *"another path shouldn't join into a mid-ramp bridge"*, and
 * *"there is also a path that runs into the side of the bridge — basically
 * runs into a solid wall"*.
 *
 * **Only `CROSSING_SITES` carry this screen, not `LEVEL_CROSSING_SITES`**: a
 * level crossing stays flat, so there is no ramp to keep off and no masonry
 * to walk into. That holds because `bridgeFootprint.ts`'s
 * `ONLY_PROVEN_BRIDGES` refuses to build a bridge on a level site at all —
 * the two are one rule seen from its two ends, and **neither may be relaxed
 * without the other**. Before that refusal existed, four of the five swept
 * seeds built a bridge on a level site, and this screen had nothing to say
 * about the ground it stood on.
 *
 * ## Two measured dead ends, and the ticket that resolved them (#414, 31 Aug
 * 2026; grid rework, 2 Sep 2026)
 *
 * When this screen had only `edgeOk`, `linkClear` and `nearestPointOnRoute` as
 * askers, extending it to the two routers that were *not* on that list looked
 * obviously right and was not. Both were built and measured on seed 5, whose
 * `poi.stranded` baseline was **8**:
 *
 * 1. **Screening the stub search's `legClear`** — the exact clause `edgeOk`
 *    carries: **8 -> 50 stranded.** A refused lattice edge leaves the lattice
 *    with other edges; a destination whose every candidate stub leg was
 *    refused got *no* stub, `streetRoute` returned null, and the whole spur
 *    dropped through to `fallbackSpurRoute` — pushing *more* routes onto the
 *    very router that was drawing ribbons across ramps.
 * 2. **Pricing ramp metres in `fallbackSpurRoute`'s candidate score** (200 per
 *    metre): recovered **one** waypoint, 8 -> 7, and **cost an invariant** —
 *    seed 5's `no two close destinations are left with a wildly
 *    disproportionate paved detour`, because at that price the router will buy
 *    a 228.8 m detour to walk round a parapet. One waypoint for one invariant
 *    is not a trade worth making, so it was reverted too.
 *
 * The two together were worst of all: **82 stranded.**
 *
 * **Neither dead end meant the cuts were acceptable** — it meant they could
 * not be fixed from inside routers that treated a bridge as an afterthought.
 * On seed 5 the dodgems at (38.4, 36.3) had *no* ramp-free route to reach:
 * every lattice node was refused (the nearest missed `STUB_TAIL_LIMIT` by
 * 1.1 m) and all four fallback candidates crossed proven site 12's ramp, so a
 * screen had nothing to pick and a price could only choose the least-bad. The
 * fix that comment named — letting a foreign leg cross **on the deck**, Jim's
 * *"path finding needs to include bridges from the start"* — is the grid
 * rework this file now carries: a bridge is a mandatory edge of the one graph
 * every route is solved on, so the second router that made dead end 1 a dead
 * end no longer exists, and {@link computeGridConnectors} carries the screen.
 * `fallbackSpurRoute` is gone, so dead end 2 has nothing left to price.
 */
export function pointStandsOnABridgeRamp(x: number, z: number, margin = RAMP_SCREEN_MARGIN): boolean {
  for (const site of CROSSING_SITES) {
    const dx = x - site.x;
    const dz = z - site.z;
    const across = -dx * site.dirZ + dz * site.dirX;
    if (Math.abs(across) > site.halfWidth + margin) continue;
    const along = dx * site.dirX + dz * site.dirZ;
    if (along <= DECK_HALF_LENGTH + site.rampReachPos + margin &&
        along >= -(DECK_HALF_LENGTH + site.rampReachNeg + margin)) {
      return true;
    }
  }
  return false;
}

/**
 * **The masonry only — the parapet band that flanks a bridge's deck and ramps,
 * without the road surface between them.**
 *
 * {@link pointStandsOnABridgeRamp} answers "is this the bridge's ground at
 * all", which is the right question for *starting* something there and the
 * wrong one for *routing through*. A bridge's footprint is a road with two
 * walls down it: `|across| <= halfWidth` is the surface a child walks on
 * (the deck, and the ramps climbing to it), and only the ring outside that,
 * out to `halfWidth + margin`, is the parapet she cannot pass.
 *
 * Screening streets against the whole footprint therefore refused the
 * crossing's **own approach**. Measured on seed 24 (#414): the footprint is
 * 13.0 m across by 39.7 m along, and it invalidated four lattice nodes
 * including the entire row at z = -33.6 — (-12.7, -33.6), (-0.7, -33.6) and
 * (11.3, -33.6), the east-west street running straight through the site. With
 * no approach left, the crossing leg could not reach proven site 20 at all and
 * took level site 74 instead, so **seed 24 lost the only bridge its loop
 * offers** — `origin/main` builds it, this branch did not, and three
 * invariants fired: the design assertion plus two anti-vacuity guards.
 *
 * ## Why a point test is enough to tell the two apart
 *
 * A leg running **along** the axis stays inside the deck band for its whole
 * length, so no sample of it is ever masonry. A leg running **across** the
 * ramp must leave the band through the parapet on both sides, so
 * {@link segmentCutsABridgeRamp} — which samples points — refuses it. The
 * direction is implied by the geometry; nothing has to reason about headings,
 * and there is no second definition of "along" to fall out of step.
 *
 * **`nearestPointOnRoute` deliberately still asks the full footprint**, not
 * this. Refusing to *branch* in mid-air is a different question from refusing
 * to *pass*: a junction on the crown is the original #414 defect (the
 * canonical seed's `spur-dodgems` branched at (-22.2, 36.4), 4.40 m up, and
 * ran off the flank into the parapet). Passing over a bridge is what a bridge
 * is for.
 */
function pointStandsOnBridgeMasonry(x: number, z: number, margin = RAMP_SCREEN_MARGIN): boolean {
  for (const site of CROSSING_SITES) {
    const dx = x - site.x;
    const dz = z - site.z;
    const across = Math.abs(-dx * site.dirZ + dz * site.dirX);
    // Inside the deck's own width is road, not wall — keep going, another
    // site's masonry may still claim this point.
    if (across <= site.halfWidth || across > site.halfWidth + margin) continue;
    const along = dx * site.dirX + dz * site.dirZ;
    if (along <= DECK_HALF_LENGTH + site.rampReachPos + margin &&
        along >= -(DECK_HALF_LENGTH + site.rampReachNeg + margin)) {
      return true;
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

/**
 * The lattice graph, solved once from the same inputs every router uses.
 *
 * **A generator, because building it is 15.7 ms.** It is memoised and built on
 * whoever asks first, which during a sliced boot is `gateApproachSearch`'s
 * first solver — so the whole build landed inside one
 * `ParkGeneration.advance()`: 14-21 ms against an 8 ms budget and a 20 ms
 * ceiling, and `check:park-boot` failing three runs in five on it. Measured
 * with `scripts/profile-park-boot-slice.mts`. Same defect the crossing-pose
 * sweep had one layer down, and the same fix.
 *
 * It yields once per lattice column, which is nothing but a suspension point:
 * the build reads only static geometry (plots, boundary, rail, ring, the
 * crossing sites) and draws no `Rng`, so it cannot come out differently for
 * having been sliced. {@link streetLattice} drives it straight through for
 * every ordinary caller, and the memo means only the first one ever pays.
 */
function* streetLatticeSearch(): Generator<number, StreetLattice, void> {
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
    yield i;
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
      // **A node standing on a bridge's ramp is not a street crossroads.**
      // `RAIL_CLAMP_DISTANCE` keeps nodes out of the rail's own corridor,
      // which is a few metres wide; a ramp reaches ~12 m further still, so a
      // node could sit squarely on one and pass every test above. Its edges
      // were already screened (`edgeOk` below), which left exactly the case
      // #414 is about: the node itself stays valid, a route terminates *on*
      // it, and the ribbon starts halfway up a bridge.
      //
      // Measured: without this the canonical seed builds 2 bridges rather
      // than 3 and seed 18 one rather than two, because a crossing whose
      // approach wanders onto ramp ground stops landing on the planned site.
      // The masonry, not the whole footprint: refusing the deck surface too
      // refused the crossing's own approach and cost seed 24 its only bridge.
      // See {@link pointStandsOnBridgeMasonry}.
      const onRamp = pointStandsOnBridgeMasonry(x, z);
      nodeOk[index] = clear && !inRing && !onRamp && rail.dist >= RAIL_CLAMP_DISTANCE ? 1 : 0;
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
    yield i;
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
    yield i;
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

  // **Jog links: a street that steps half a cell round a plot and comes back.**
  // The pinch pass above heals a blocked *corner*; this heals a blocked *run*.
  // Measured on seed 11, whose park the 12 m grid alone cut into a 61-node
  // component holding the ring and a 35-node component holding the hotel, the
  // castle, the ball pit and the slide exit — half the park, with no grid route
  // to it at all, so every one of those doors fell to the straight-line last
  // resort and four of them drew a ribbon across the railway.
  //
  // The jog is three axis-aligned segments through offsets of half a cell, so
  // nothing diagonal is drawn and the run still reads as a street stepping
  // round an obstacle. Half-pitch, not some other number, so a jog's own two
  // legs sit on the lattice's own half-lines rather than on a private line of
  // their own — the same reason `STREET_PITCH` is the one big number.
  const JOG_OFFSET = STREET_PITCH / 2;
  const JOG_COST_FACTOR = 1.15;
  for (let i = -LATTICE_HALF_CELLS; i <= LATTICE_HALF_CELLS; i += 1) {
    yield i;
    for (let j = -LATTICE_HALF_CELLS; j <= LATTICE_HALF_CELLS; j += 1) {
      const a = indexOf(i, j);
      if (!nodeOk[a]) continue;
      for (const [di, dj, dir, back] of [
        [1, 0, 0, 1],
        [0, 1, 2, 3],
      ] as readonly (readonly [number, number, number, number])[]) {
        if (Math.abs(i + di) > LATTICE_HALF_CELLS || Math.abs(j + dj) > LATTICE_HALF_CELLS) continue;
        const b = indexOf(i + di, j + dj);
        if (!nodeOk[b] || side[a] !== side[b]) continue;
        if (di === 1 ? edgeEast[a] : edgeSouth[a]) continue; // the straight run is fine
        const ax = xs[a] as number;
        const az = zs[a] as number;
        const bx = xs[b] as number;
        const bz = zs[b] as number;
        const railSide = side[a] as 1 | -1;
        for (const sign of [1, -1] as const) {
          const offX = di === 1 ? 0 : JOG_OFFSET * sign;
          const offZ = di === 1 ? JOG_OFFSET * sign : 0;
          const shape: readonly (readonly [number, number])[] = [
            [ax, az],
            [ax + offX, az + offZ],
            [bx + offX, bz + offZ],
            [bx, bz],
          ];
          let ok = true;
          let length = 0;
          let corridor = 0;
          for (let t = 1; t < shape.length && ok; t += 1) {
            const p0 = shape[t - 1] as readonly [number, number];
            const p1 = shape[t] as readonly [number, number];
            if (
              !streetSegmentClear(p0[0], p0[1], p1[0], p1[1]) ||
              !segmentClearOfRing(p0[0], p0[1], p1[0], p1[1]) ||
              !segmentHoldsRailSide(p0[0], p0[1], p1[0], p1[1], railSide, RAIL_CLAMP_DISTANCE - 0.1) ||
              segmentCutsABridgeRamp(p0[0], p0[1], p1[0], p1[1])
            ) {
              ok = false;
              break;
            }
            corridor += slideCorridorOverlap(p0[0], p0[1], p1[0], p1[1]);
            corridor += cruiserCorridorOverlap(p0[0], p0[1], p1[0], p1[1]);
            length += Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
          }
          if (!ok || corridor > 4) continue;
          const via = shape.slice(1, -1);
          const cost = length * JOG_COST_FACTOR;
          (neighbours[a] as LatticeNeighbour[]).push({ to: b, dir, cost, via });
          (neighbours[b] as LatticeNeighbour[]).push({
            to: a,
            dir: back,
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


  return latticeCache;
}

/**
 * {@link streetLatticeSearch} driven straight through — every ordinary caller,
 * and the memo means only the first one ever builds anything.
 */
function streetLattice(): StreetLattice {
  const search = streetLatticeSearch();
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}

/** One off-grid connector from a real point onto the grid. `points` run
 * grid-node-first, point-last, including both ends. */
interface GridConnector {
  readonly node: number;
  readonly points: readonly (readonly [number, number])[];
  readonly cost: number;
}

/**
 * Every reasonable way to step from `p` onto the grid: the surrounding nodes
 * first, widening a shell at a time (the same Chebyshev-shell reasoning
 * `entryCandidates` uses, bounded by {@link STUB_TAIL_LIMIT} so no connector
 * grows its own rogue street line). Straight when clear; otherwise elbowed
 * **via the node's own street line** — the corner shares the node's x (or z),
 * so one leg of the elbow is real street and only the short tail runs
 * off-grid.
 *
 * `relax` is the backtrack (CLAUDE.md's standing procgen rule): pass 0 is the
 * tight search every ordinary door uses, pass 1 widens the shells and doubles
 * the tail limit for a door the tight search cannot reach at all. A door with
 * no connector is a door with no path, which is the whole defect this rework
 * exists to remove — so the search backtracks rather than handing the route to
 * some other router.
 *
 * Memoised on the point's coordinates: connectors depend only on static
 * geometry (grid, plots, boundary, rail, ring, bridge masonry — never on what
 * is paved). Callers only read the returned array.
 */
const gridConnectorCache = new Map<string, GridConnector[]>();
function gridConnectors(
  p: readonly [number, number],
  arrival: boolean,
  relax = 0,
  lead: readonly [number, number] | null = null,
  exemptSite: CrossingSite | null = null,
): GridConnector[] {
  const key =
    `${p[0]},${p[1]},${arrival ? 1 : 0},${relax},${lead ? `${lead[0]},${lead[1]}` : ''}` +
    `,${exemptSite ? exemptSite.railDistance : ''}`;
  const hit = gridConnectorCache.get(key);
  if (hit) return hit;
  const connectors = computeGridConnectors(p, arrival, relax, lead, exemptSite);
  gridConnectorCache.set(key, connectors);
  return connectors;
}

function computeGridConnectors(
  p: readonly [number, number],
  arrival: boolean,
  relax: number,
  lead: readonly [number, number] | null,
  exemptSite: CrossingSite | null = null,
): GridConnector[] {
  const lattice = streetLattice();
  const pSide = railInfoAt(p[0], p[1]).side;
  // A destination's own frontage (any plot the point already stands close
  // to) is exempt from full street clearance — the connector is *arriving*,
  // so it may run along that plot's face, just never through it.
  // Sized to cover a doormat's stand-off (1.4 m), its 3.5 m arrival lead
  // and a plot's own frontage wobble — the ball-pit's slide exit measured
  // 5.7 m from the plot edge, just past the first (5.6 m) version of this.
  const exemptNear = arrival ? 7 : 0.5;
  const tailLimit = relax > 0 ? STUB_TAIL_LIMIT * 2 : STUB_TAIL_LIMIT;
  const shells = relax > 0 ? 4 : 2;
  // **The bridge-masonry screen is on the connector search now**, which the
  // note in {@link pointStandsOnABridgeRamp} records as a measured dead end
  // (seed 5, 8 -> 50 stranded waypoints). It was a dead end *because* a
  // destination whose every connector was refused fell through to
  // `fallbackSpurRoute`, the router that was drawing ribbons across ramps.
  // That router is gone: a bridge is a first-class grid edge now, so a
  // refused connector is answered by another connector, a relaxed pass, or a
  // route over the deck — never by a leg that walks into a parapet. This is
  // the fix that comment names as "its own ticket".
  // **The boundary margin an arrival keeps is the ribbon's own, not a
  // crossroads'.** A grid node needs `STREET_PLOT_CLEARANCE` from the park's
  // edge because it is a public junction; a door standing 2.31 m in from the
  // spline (seed 225's and seed 267's rail-race exit, measured) is where the
  // ride actually lets a child off, and refusing to pave the last two metres to
  // it does not move the exit — it only leaves her in the grass. 2.0 m still
  // fits a 2.2 m ribbon's half-width plus its kerb (1.95 m) inside the edge.
  const boundaryMargin = arrival ? 2.0 : STREET_PLOT_CLEARANCE;
  const legClear = (ax: number, az: number, bx: number, bz: number): boolean =>
    streetSegmentClear(ax, az, bx, bz, p, exemptNear, boundaryMargin) &&
    segmentClearOfRing(ax, az, bx, bz) &&
    segmentHoldsRailSide(ax, az, bx, bz, pSide, 0) &&
    !segmentCutsABridgeRamp(ax, az, bx, bz, exemptSite);

  const ci = Math.round((p[0] - PLAZA.x) / STREET_PITCH);
  const cj = Math.round((p[1] - PLAZA.z) / STREET_PITCH);
  const found: GridConnector[] = [];
  // Shell 0 is the point's own nearest node — a doormat standing right
  // beside a street line wants a two-metre connector, not a cell-length one.
  // Every shell is searched even after a hit: the nearest reachable node
  // can be an isolated orphan (valid ground, no street can reach it), and
  // stopping at the first shell with any candidate handed the whole route
  // to exactly that orphan (seed 18's dodgems, measured: its shell-0 node
  // was a one-node island while the real network sat one shell further).
  for (let shell = 0; shell <= shells; shell += 1) {
    for (let di = -shell; di <= shell; di += 1) {
      for (let dj = -shell; dj <= shell; dj += 1) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== shell) continue;
        const i = ci + di;
        const j = cj + dj;
        if (Math.abs(i) > LATTICE_HALF_CELLS || Math.abs(j) > LATTICE_HALF_CELLS) continue;
        const index = lattice.indexOf(i, j);
        if (!lattice.nodeOk[index] || lattice.side[index] !== pSide) continue;
        const nx = lattice.xs[index] as number;
        const nz = lattice.zs[index] as number;
        const tail = Math.min(Math.abs(p[0] - nx), Math.abs(p[1] - nz));
        if (tail > tailLimit) continue;
        const direct = Math.hypot(p[0] - nx, p[1] - nz);
        // **Arrive HEAD-ON where the door has a facing.** The doormat faces the
        // park middle (the layout solver put it there), and a booth's own
        // counter walls flank it — a connector arriving far off that axis draws
        // a leg that grazes the counter's side at centimetres (seed 2's rim
        // stall stranded its whole doormat that way). So a connector via the
        // outward lead is tried first, and only its failure falls back to the
        // plain shapes below. The lead is *not* the grid node: making it one
        // (the first cut of this rework did) loses the door outright whenever
        // the ground 3.5 m out is worse than the doormat's own — seed 131's
        // hotel had a clean 7.1 m straight run to its door and no route at all
        // to the point in front of it.
        if (lead) {
          const shapes: readonly (readonly (readonly [number, number])[])[] = [
            [[nx, nz], lead, p],
            [[nx, nz], [nx, lead[1]], lead, p],
            [[nx, nz], [lead[0], nz], lead, p],
          ];
          let headOn = false;
          for (const shape of shapes) {
            let ok = true;
            let length = 0;
            for (let s = 1; s < shape.length && ok; s += 1) {
              const a = shape[s - 1] as readonly [number, number];
              const b = shape[s] as readonly [number, number];
              if (!legClear(a[0], a[1], b[0], b[1])) ok = false;
              length += Math.hypot(b[0] - a[0], b[1] - a[1]);
            }
            if (!ok || length > (tailLimit + 2) * 2) continue;
            found.push({
              node: index,
              points: collapseCollinear(shape),
              cost: length * STUB_COST_FACTOR,
            });
            headOn = true;
            break;
          }
          // A head-on arrival is strictly better than an oblique one at the
          // same node, so do not also offer the oblique shapes there.
          if (headOn) continue;
        }
        // Straight connector: shortest, slightly diagonal — fine when short.
        if (direct <= tailLimit + 2 && legClear(nx, nz, p[0], p[1])) {
          found.push({
            node: index,
            points: [[nx, nz], p],
            cost: direct * STUB_COST_FACTOR + (lead ? 0.5 : 0),
          });
          continue;
        }
        // Elbow via the node's own street line: corner shares the node's x
        // (north-south street) or z (east-west street). **Only a corner
        // whose off-street tail (corner to `p`) stays short is legal** —
        // the other orientation puts the *long* leg on the destination's
        // own private line, which is exactly the rogue street the grid
        // invariant polices (measured: a 13 m run on x = -70.8, seed 5's
        // rail-race stall, from the wrong corner being tried first).
        const corners: readonly (readonly [number, number])[] = [
          [nx, p[1]], // long leg north-south on the node's x line
          [p[0], nz], // long leg east-west on the node's z line
        ];
        for (const corner of corners) {
          const tailLength = Math.hypot(corner[0] - p[0], corner[1] - p[1]);
          if (tailLength > tailLimit) continue;
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
            break;
          }
        }
      }
    }
  }
  if (found.length === 0 && relax > 1) return relayConnectors(p, pSide, legClear);
  found.sort((a, b) => a.cost - b.cost);
  return found;
}

/**
 * **The last way onto the grid: walk out along the grid's own lines.**
 *
 * A destination beside a big plot can have no valid grid node near it at all —
 * its own building invalidates the whole cell it stands in, and the ring of
 * cells beyond is invalidated by its neighbours. Seed 24's ferris wheel is the
 * case: of the 49 nodes within three shells, exactly one is valid, and every
 * single-elbow leg to that one clips a plot.
 *
 * So: a small Dijkstra over the grid *cells* around the door, screened with the
 * **door's own arrival exemption** rather than the public street clearance, run
 * until it reaches a node that is genuinely valid in the shared lattice. Every
 * leg is a run along a grid line, so what comes out is axis-aligned and reads
 * as a street — it is simply allowed to start on ground the public grid has
 * written off, which is exactly the ground the door stands on.
 *
 * This is what replaced the old continuous fallback router. It cannot draw a
 * diagonal, cannot cross the railway (`legClear` carries the side and masonry
 * screens), and terminates on a real node, so the route it hands back joins the
 * network properly instead of ending in the grass near it.
 */
const RELAY_CELLS = 4;
function relayConnectors(
  p: readonly [number, number],
  pSide: 1 | -1,
  legClear: (ax: number, az: number, bx: number, bz: number) => boolean,
): GridConnector[] {
  const lattice = streetLattice();
  const ci = Math.round((p[0] - PLAZA.x) / STREET_PITCH);
  const cj = Math.round((p[1] - PLAZA.z) / STREET_PITCH);
  // The grid lines in range, **plus the door's own two lines**. Adding those
  // two is what makes this work at all: a door boxed in by its own building
  // can always step straight out along its own row or column to the first grid
  // line that is clear, and from there the walk is on the grid proper.
  const cells: number[] = [];
  const xs: number[] = [];
  const zs: number[] = [];
  for (let k = -RELAY_CELLS; k <= RELAY_CELLS; k += 1) {
    if (Math.abs(ci + k) <= LATTICE_HALF_CELLS) {
      xs.push(PLAZA.x + (ci + k) * STREET_PITCH);
      cells.push(ci + k);
    }
    if (Math.abs(cj + k) <= LATTICE_HALF_CELLS) zs.push(PLAZA.z + (cj + k) * STREET_PITCH);
  }
  xs.push(p[0]);
  zs.push(p[1]);
  xs.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  const w = xs.length;
  const h = zs.length;
  const at = (i: number, j: number): number => i * h + j;
  const px = xs.indexOf(p[0]);
  const pz = zs.indexOf(p[1]);
  const usable = new Uint8Array(w * h);
  for (let i = 0; i < w; i += 1) {
    for (let j = 0; j < h; j += 1) {
      const x = xs[i] as number;
      const z = zs[j] as number;
      // Deliberately only the screens `legClear` cannot express as a segment:
      // the rail SIDE (a corner may legitimately stand closer to the track
      // than a crossroads may — `segmentHoldsRailSide` on each leg is what
      // keeps the run itself off the corridor) and the bridge masonry.
      usable[at(i, j)] =
        railInfoAt(x, z).side === pSide && !pointStandsOnBridgeMasonry(x, z) && legClear(x, z, x, z)
          ? 1
          : 0;
    }
  }
  usable[at(px, pz)] = 1; // the door itself is where the walk starts
  /** Index of the lattice node standing exactly here, or -1. */
  const latticeNodeAt = (i: number, j: number): number => {
    const ii = Math.round(((xs[i] as number) - PLAZA.x) / STREET_PITCH);
    const jj = Math.round(((zs[j] as number) - PLAZA.z) / STREET_PITCH);
    if (Math.abs((xs[i] as number) - (PLAZA.x + ii * STREET_PITCH)) > 1e-6) return -1;
    if (Math.abs((zs[j] as number) - (PLAZA.z + jj * STREET_PITCH)) > 1e-6) return -1;
    if (Math.abs(ii) > LATTICE_HALF_CELLS || Math.abs(jj) > LATTICE_HALF_CELLS) return -1;
    const index = lattice.indexOf(ii, jj);
    return lattice.nodeOk[index] ? index : -1;
  };
  const cost = new Float64Array(w * h).fill(Infinity);
  const from = new Int32Array(w * h).fill(-1);
  const done = new Uint8Array(w * h);
  cost[at(px, pz)] = 0;
  const reached: { cell: number; node: number; cost: number }[] = [];
  for (;;) {
    let bestCell = -1;
    let bestCost = Infinity;
    for (let c = 0; c < w * h; c += 1) {
      if (!done[c] && (cost[c] as number) < bestCost) {
        bestCost = cost[c] as number;
        bestCell = c;
      }
    }
    if (bestCell < 0) break;
    done[bestCell] = 1;
    const i = Math.floor(bestCell / h);
    const j = bestCell % h;
    const node = latticeNodeAt(i, j);
    if (node >= 0 && bestCell !== at(px, pz)) {
      reached.push({ cell: bestCell, node, cost: bestCost });
      if (reached.length >= 3) break;
      continue; // a valid node is a terminus, not a through-route for this search
    }
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as readonly (readonly [number, number])[]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const next = at(ni, nj);
      if (!usable[next] || done[next]) continue;
      const ax = xs[i] as number;
      const az = zs[j] as number;
      const bx = xs[ni] as number;
      const bz = zs[nj] as number;
      if (!legClear(ax, az, bx, bz)) continue;
      const step = bestCost + Math.hypot(bx - ax, bz - az) * STUB_COST_FACTOR + 1;
      if (step < (cost[next] as number)) {
        cost[next] = step;
        from[next] = bestCell;
        }
    }
  }
  const connectors: GridConnector[] = [];
  for (const goal of reached) {
    const chain: (readonly [number, number])[] = [];
    for (let c = goal.cell; c !== -1; c = from[c] as number) {
      chain.push([xs[Math.floor(c / h)] as number, zs[c % h] as number]);
    }
    // `chain` runs node-first back to the door, which is exactly the order a
    // connector's points are published in.
    connectors.push({ node: goal.node, points: collapseCollinear(chain), cost: goal.cost + 2 });
  }
  connectors.sort((a, b) => a.cost - b.cost);
  return connectors;
}

/**
 * **An axis-aligned walk between two points, along the grid's own lines.**
 *
 * The generalisation of {@link relayConnectors}: the lines it may use are the
 * grid's, plus the two endpoints' own rows and columns, so every segment is
 * either a grid line or a straight step out to one. It is what serves a
 * destination the shared grid cannot reach — a district the plots have cut off
 * from the component the ring stands in — without handing the route to a
 * continuous router that would draw a diagonal and, on seed 11, four ribbons
 * across the railway.
 *
 * `legClear` carries the caller's screens, including the rail side, so this can
 * never cross the railway: a route that has to cross gets over a bridge first
 * (the deck is an edge of the shared grid) and calls this for the walk on the
 * far side.
 */
function relayPolyline(
  a: readonly [number, number],
  b: readonly [number, number],
  legClear: (ax: number, az: number, bx: number, bz: number) => boolean,
  disciplined = true,
): (readonly [number, number])[] | null {
  const pad = 2;
  const iLo = Math.round((Math.min(a[0], b[0]) - PLAZA.x) / STREET_PITCH) - pad;
  const iHi = Math.round((Math.max(a[0], b[0]) - PLAZA.x) / STREET_PITCH) + pad;
  const jLo = Math.round((Math.min(a[1], b[1]) - PLAZA.z) / STREET_PITCH) - pad;
  const jHi = Math.round((Math.max(a[1], b[1]) - PLAZA.z) / STREET_PITCH) + pad;
  const xs: number[] = [a[0], b[0]];
  const zs: number[] = [a[1], b[1]];
  // Full-pitch lines, and the **half-pitch lines between them**. Half-pitch is
  // the same grid seen one level finer, not a second grid: a run on one still
  // shares its heading and its origin with every street in the park, which is
  // what "reads as a grid" means (`streetsShareLatticeLines`). It is here
  // because the districts this router exists to rescue are cut off by pinches
  // narrower than a whole cell — a strip beside the rail fence, a gap between
  // two plots — and a router that can only stand on 12 m lines cannot see them.
  for (let i = iLo * 2; i <= iHi * 2; i += 1) {
    if (Math.abs(i) <= LATTICE_HALF_CELLS * 2) xs.push(PLAZA.x + (i * STREET_PITCH) / 2);
  }
  for (let j = jLo * 2; j <= jHi * 2; j += 1) {
    if (Math.abs(j) <= LATTICE_HALF_CELLS * 2) zs.push(PLAZA.z + (j * STREET_PITCH) / 2);
  }
  xs.sort((p, q) => p - q);
  zs.sort((p, q) => p - q);
  const w = xs.length;
  const h = zs.length;
  if (w * h > 16384) return null; // two points this far apart are not this router's job
  const at = (i: number, j: number): number => i * h + j;
  const ai = xs.indexOf(a[0]);
  const aj = zs.indexOf(a[1]);
  const bi = xs.indexOf(b[0]);
  const bj = zs.indexOf(b[1]);
  // **An endpoint's own row or column is a step out to the grid, never an
  // arterial.** The line set above is the lattice at half pitch *plus*
  // `a` and `b`'s own rows and columns, and those last four are private
  // lines: nothing else in the park shares them.
  //
  // Measured on seed 11, 2 Sep 2026. `spur-hotel` came out carrying
  // `(-42.2, 42.9) -> (-42.2, 3.2)` — **one straight run 39.7 m long on
  // x = -42.2**, the hotel door's own column — while `spur-stall.skyCruiser`
  // carried `(-43.0, 30.9) -> (-43.0, 6.9)` beside it. Two long parallel
  // arterials **0.8 m apart**, on two private lines.
  //
  // That is Jim's report #3 ("they should be on an approximate grid layout")
  // in its plainest form, and it is also why seed 11 lost a whole district:
  // `Scenery.ts` places border fences from `pathCentreline`, a fence bordering
  // one of those two ribbons necessarily lands on the other, and the fence
  // that did measured 10.3 m of solid ground straight down the middle of
  // `spur-hotel` (peak push 0.81 m at (-42.81, 12.39)). `poiGraph` then
  // dropped the two seeds it could not place, leaving a 14.27 m hole against
  // a 13 m `MAX_EDGE`, and everything past it — 19 waypoints — was stranded.
  //
  // **The fence is correct; the paths it was given were not.** This cannot be
  // fixed by asking the collision world here: the fence does not exist yet
  // when this runs, and cannot. A generator whose output is consumed by a
  // later placer cannot validate against that placer's output — the
  // constraint has to be a rule this router can honour on its own. That rule
  // is grid discipline: a private line may carry a cell only while it is
  // still within one {@link STREET_PITCH} of the endpoint that owns it, which
  // is the "short step out" it exists for. Beyond that the walk must be on a
  // line the rest of the park shares, so two routes can never end up
  // shoulder to shoulder on lines of their own.
  const HALF_PITCH = STREET_PITCH / 2;
  const sharesAGridLine = (value: number, origin: number): boolean =>
    Math.abs(Math.round((value - origin) / HALF_PITCH) * HALF_PITCH + origin - value) < 1e-6;
  /** How far a cell on `value`'s **private** line stands from the endpoint
   * that owns it. **Zero for a line the park shares**, so a lattice or
   * half-pitch cell is never constrained by this — the cap below applies to
   * private lines and nothing else. `Infinity` for a private line with no
   * owner, which cannot happen and would be refused if it did. */
  const privateReach = (
    value: number,
    origin: number,
    pick: (p: readonly [number, number]) => number,
    x: number,
    z: number,
  ): number => {
    if (sharesAGridLine(value, origin)) return 0;
    let best = Infinity;
    for (const end of [a, b] as const) {
      if (pick(end) !== value) continue;
      best = Math.min(best, Math.hypot(end[0] - x, end[1] - z));
    }
    return best;
  };
  const usable = new Uint8Array(w * h);
  for (let i = 0; i < w; i += 1) {
    for (let j = 0; j < h; j += 1) {
      const x = xs[i] as number;
      const z = zs[j] as number;
      const onGridDiscipline =
        !disciplined ||
        (privateReach(x, PLAZA.x, (p) => p[0], x, z) <= STREET_PITCH &&
          privateReach(z, PLAZA.z, (p) => p[1], x, z) <= STREET_PITCH);
      usable[at(i, j)] =
        onGridDiscipline && !pointStandsOnBridgeMasonry(x, z) && legClear(x, z, x, z) ? 1 : 0;
    }
  }
  usable[at(ai, aj)] = 1;
  usable[at(bi, bj)] = 1;
  const cost = new Float64Array(w * h).fill(Infinity);
  const from = new Int32Array(w * h).fill(-1);
  const done = new Uint8Array(w * h);
  cost[at(ai, aj)] = 0;
  for (;;) {
    let cell = -1;
    let cheapest = Infinity;
    for (let c = 0; c < w * h; c += 1) {
      if (!done[c] && (cost[c] as number) < cheapest) {
        cheapest = cost[c] as number;
        cell = c;
      }
    }
    if (cell < 0) break;
    if (cell === at(bi, bj)) break;
    done[cell] = 1;
    const i = Math.floor(cell / h);
    const j = cell % h;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as readonly (readonly [number, number])[]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const next = at(ni, nj);
      if (!usable[next] || done[next]) continue;
      const ax = xs[i] as number;
      const az = zs[j] as number;
      const bx = xs[ni] as number;
      const bz = zs[nj] as number;
      if (!legClear(ax, az, bx, bz)) continue;
      // A turn costs, so the walk prefers to run straight down one line
      // rather than staircase — the same reason `STREET_TURN_PENALTY` exists.
      const straight = from[cell] !== -1 && (Math.floor((from[cell] as number) / h) === ni || (from[cell] as number) % h === nj);
      const step = cheapest + Math.hypot(bx - ax, bz - az) + (straight ? 0 : 2);
      if (step < (cost[next] as number)) {
        cost[next] = step;
        from[next] = cell;
      }
    }
  }
  if (!Number.isFinite(cost[at(bi, bj)] as number)) return null;
  const chain: (readonly [number, number])[] = [];
  for (let c = at(bi, bj); c !== -1; c = from[c] as number) {
    chain.push([xs[Math.floor(c / h)] as number, zs[c % h] as number]);
  }
  chain.reverse();
  return collapseCollinear(chain);
}

// ------------------------------------------------------------- the grid
//
// **Grid-first path plotting** (Jim, 2 September 2026): *"it shouldn't be make
// paths and then put bridges on after the fact, these need to be considered
// together from the start"*, *"they should be on an approximate grid layout but
// they end up with twists and mini-turns etc that make no sense visually"*, and
// *"the paths don't go up to the door of the hotel or up to the castle door, or
// other attractions reliably."*
//
// One graph answers all three. It is the 12 m street lattice above, plus three
// kinds of **mandatory node** snapped into it and one kind of **mandatory
// edge**:
//
// - the four ring gateways (`RING_COMPASS_POINTS` — Decision 5's "exactly 4
//   connections at compass points"), each on a straight street out along its
//   own lattice line;
// - **every bridge foot**, from `CROSSING_SITES` via {@link crossingFeet} —
//   with each bridge's foot -> deck -> foot polyline as the **only** edge in
//   the graph that crosses the railway. There is no other way over, so the
//   network cannot knot itself round a ramp: no lattice node stands on the
//   masonry, no lattice edge, connector or interconnect may cut one, and the
//   only paving inside a bridge's own footprint is the deck edge and its two
//   feet;
// - **every destination's door** — anchors' doormats, stall stands, station
//   leads, ride exits — each joined to the grid by one straight terminal
//   connector, so the paving runs UP TO the door rather than stopping in the
//   grass near it.
//
// Every route drawn is then a path *in this graph*: Dijkstra from whatever is
// already paved to the destination's own door node. Nothing is routed in
// continuous space any more, so there is no second router to disagree about
// grid-ness, no give-up diagonal, and no fallback that can pave across a ramp.
// What comes out is axis-aligned by construction except at the deliberate
// pinch chamfers and the short terminal connectors.

/** Direction tags for the turn penalty. 0-3 street, 4-7 pinch chamfer;
 * a bridge deck and a terminal connector are their own headings so that
 * stepping onto one always reads as a turn. */
const DECK_DIR = 8;
const CONNECTOR_DIR = 9;
/** 4 street + 4 pinch + deck + connector, plus "just started". */
const GRID_DIRS = 11;

/** One place a path must be able to end: a door, and how the ribbon finishes
 * the walk once the grid has delivered it to {@link gridPoint}. */
interface GridDestination {
  readonly id: string;
  readonly kind: PathNode['kind'];
  /** The node's own coordinate — doormat, counter stand, platform stand or
   * ride exit. This is what `PathNode` publishes and what every consumer
   * (poiGraph, check:park, the invariants) calls "the destination". */
  readonly x: number;
  readonly z: number;
  /** Where the grid's terminal connector lands — the door itself for
   * everything with a doormat, and a station's own platform lead for a
   * station, whose walkable end `train/plan.ts` already solved. */
  readonly gridPoint: readonly [number, number];
  /** The outward point the connector prefers to arrive through, so the last
   * few metres run the way a visitor actually walks in. Null for a place with
   * no facing (a station, a ride exit). */
  readonly lead: readonly [number, number] | null;
  /** Points from `gridPoint` onward, ending at the door (and then any
   * past-the-doormat extension). Empty when `gridPoint` IS the door and
   * nothing extends past it. */
  readonly tail: readonly (readonly [number, number])[];
  readonly width: number;
}

interface PathGrid {
  readonly lattice: StreetLattice;
  readonly count: number;
  readonly xs: Float64Array;
  readonly zs: Float64Array;
  readonly neighbours: readonly (readonly LatticeNeighbour[])[];
  /** The four ring gateways, as nodes standing on the drawn ring itself. */
  readonly ringNodes: readonly number[];
  readonly destinations: readonly GridDestination[];
  readonly destinationNode: ReadonlyMap<string, number>;
  /** Every door node, for the rule that a door is a **terminal**: a route to
   * somewhere else never walks through somebody's doormat. Without it a later
   * route can pave straight over an earlier door, and that door's own edge
   * then has a single point in it — one that `CatmullRomCurve3` cannot make a
   * curve from at all (seeds 5 and 11 crashed the park build on exactly that
   * before doors were made terminal). */
  readonly doorNodes: ReadonlySet<number>;
  /** Node per bridge foot, in `CROSSING_SITES` order, plus then minus. */
  readonly footNodes: readonly number[];
  /** Handover node per gate-corridor mouth candidate, mouth-order. */
  readonly gateNodes: readonly { readonly mouth: readonly [number, number]; readonly node: number }[];
  /** Doors the tight connector search could not reach, so the relaxed pass
   * had to. Reported by {@link debugStreetLattice} and printed by the
   * invariants' coverage note — a park that needs many of these is a park
   * whose grid is starved, and that is worth hearing about. */
  readonly relaxedDoors: readonly string[];
}

/** The past-the-doormat extension: how far short of a plot's own edge the
 * ribbon must stop. It has to clear `poiGraph`'s clearance probe (0.7 m) and
 * a booth's wall thickness, so 1 m of daylight between the waypoint and the
 * wall it stands beside. */
const PAST_CLEARANCE = 1;

/** The outward lead a door's own ribbon arrives along: a few metres out on
 * the doormat's own outward ray (entrance minus plot centre), which is the
 * counter's facing for a camera-facing booth and the toward-middle line for
 * everything else, because the layout solver derived the entrance that way.
 * One source of truth for "which way in". Empty for anything with no
 * `PARK_LAYOUT` entry (a station, a ride exit). */
function arrivalLead(x: number, z: number, id: string): readonly [number, number][] {
  const placed = PARK_LAYOUT.entries.get(id);
  if (!placed) return [];
  const outX = x - placed.x;
  const outZ = z - placed.z;
  const out = Math.hypot(outX, outZ);
  if (out <= 1e-6) return [];
  return [[x + (outX / out) * 3.5, z + (outZ / out) * 3.5]];
}

/**
 * How far the ribbon carries on past a doormat, into the plot's own mouth —
 * capped to stop {@link PAST_CLEARANCE} short of the plot's real edge.
 *
 * A flat 2 m always overshot a stall (2.6 m footprint, 1.4 m standoff) by
 * 0.6 m: the waypoint `poiGraph` samples there landed *inside* the booth's
 * collision, and `findClearSpot`'s nudge had no notion of which side leads
 * back to the network — at the park rim that stranded the waypoint behind the
 * booth's own wall. So the cap comes from the same footprint math the layout
 * solver placed the doormat with.
 */
function pastTheDoormat(
  id: string,
  ex: number,
  ez: number,
  towardX: number,
  towardZ: number,
): readonly (readonly [number, number])[] {
  const l = Math.hypot(towardX - ex, towardZ - ez);
  if (l <= 1e-6) return [];
  const placed = PARK_LAYOUT.entries.get(id);
  let reach = 2;
  if (placed) {
    const edge = edgeDistanceAlong(placed.footprint, (ex - towardX) / l, (ez - towardZ) / l);
    reach = Math.max(0, Math.min(reach, l - edge - PAST_CLEARANCE));
  }
  if (reach <= 1e-6) return [];
  return [[ex + ((towardX - ex) / l) * reach, ez + ((towardZ - ez) / l) * reach]];
}

/**
 * Every door the network owes a path to, in the fixed order the graph is
 * grown in: anchors, stall counters, stations, ride exits.
 *
 * The stall node is the **stand point**, not the plot's doormat — the side a
 * child is actually served from, and the point `minigames/stalls.ts` registers
 * its interact zone at, `npc/poiGraph.ts` seeds a waypoint at and
 * `LampPosts.ts` keeps clear. Routing to the doormat instead left every
 * stall's ribbon stopping 3.4-6.9 m short of its own counter on all five test
 * seeds: the "paths to nowhere" the family reported (issue #114).
 *
 * A station's grid point is its **lead** — past the platform's empty end,
 * stepped into the park — so the incoming leg can arrive from any bearing
 * without paving through the canopy posts on the furnished half; the tail then
 * turns down the platform to the stand.
 *
 * The ginormous slide is in the exit list for the reason the EXIT rule exists
 * (GAME_DESIGN.md, 28 July 2026): it is the ride that did not have one, and
 * #118 is what that cost — a hand-authored chute ending inside the castle,
 * behind a wall, with a six-year-old stuck there.
 */
function gridDestinations(): readonly GridDestination[] {
  const out: GridDestination[] = [];
  const place = (
    id: string,
    kind: PathNode['kind'],
    x: number,
    z: number,
    towardX: number,
    towardZ: number,
    width: number,
    extraTail: readonly (readonly [number, number])[] = [],
  ): void => {
    const lead = arrivalLead(x, z, id);
    const tail: (readonly [number, number])[] = [...extraTail];
    tail.push(...pastTheDoormat(id, x, z, towardX, towardZ));
    out.push({
      id,
      kind,
      x,
      z,
      gridPoint: [x, z] as const,
      lead: (lead[0] ?? null) as readonly [number, number] | null,
      tail,
      width,
    });
  };
  for (const anchor of ANCHORS) {
    const [ex, ez] = anchor.entrance;
    place(
      anchor.id,
      'anchor',
      ex,
      ez,
      anchor.position[0],
      anchor.position[1],
      anchor.id === 'building' ? 2.8 : 2.6,
    );
  }
  for (const stand of STALL_STANDS) {
    place(`stall.${stand.id}`, 'stall', stand.x, stand.z, stand.x, stand.z, 2.6);
  }
  for (const station of TRAIN_PLAN.stations) {
    // The station's own lead/approach/stand chain, not an `arrivalLead` — a
    // station has no `PARK_LAYOUT` entry, and `train/plan.ts` already solved
    // which end of the platform is walkable.
    out.push({
      id: `station-${station.index}`,
      kind: 'station',
      x: station.standX,
      z: station.standZ,
      gridPoint: [station.leadX, station.leadZ] as const,
      lead: null,
      tail: [
        [station.approachX, station.approachZ] as const,
        [station.standX, station.standZ] as const,
      ],
      width: 2.6,
    });
  }
  for (const plan of [COASTER_PLANS.cruiser, RAIL_RACE_PLAN, SLIDE_PLAN]) {
    place(`exit-${plan.name}`, 'exit', plan.exitX, plan.exitZ, plan.exitX, plan.exitZ, 2.2);
  }
  place(
    'exit-ferrisWheel',
    'exit',
    FERRIS_WHEEL_EXIT.x,
    FERRIS_WHEEL_EXIT.z,
    FERRIS_WHEEL_EXIT.x,
    FERRIS_WHEEL_EXIT.z,
    2.2,
  );
  return out;
}

let pathGridCache: PathGrid | null = null;

/**
 * The whole graph, built once. A generator for the same reason
 * {@link streetLatticeSearch} is one: `boot/parkGeneration.ts` spreads the
 * solve over the cat-bus ride's frames against an 8 ms budget, and a single
 * 15.7 ms unit has failed `check:park-boot`. It reads only static geometry and
 * draws no `Rng`, so slicing cannot move a single node.
 */
function* pathGridSearch(): Generator<number, PathGrid, void> {
  if (pathGridCache) return pathGridCache;
  const lattice = yield* streetLatticeSearch();
  const xs: number[] = [];
  const zs: number[] = [];
  const neighbours: LatticeNeighbour[][] = [];
  for (let index = 0; index < lattice.count; index += 1) {
    xs.push(lattice.xs[index] as number);
    zs.push(lattice.zs[index] as number);
    neighbours.push([...(lattice.neighbours[index] as readonly LatticeNeighbour[])]);
  }
  const addNode = (x: number, z: number): number => {
    xs.push(x);
    zs.push(z);
    neighbours.push([]);
    return xs.length - 1;
  };
  const link = (
    a: number,
    b: number,
    cost: number,
    dir: number,
    via: readonly (readonly [number, number])[],
  ): void => {
    (neighbours[a] as LatticeNeighbour[]).push({ to: b, dir, cost, via });
    (neighbours[b] as LatticeNeighbour[]).push({ to: a, dir, cost, via: [...via].reverse() });
  };
  /** Join a mandatory node to the grid by its terminal connectors. Returns
   * how many it got — zero means the grid cannot serve this point at all. */
  const joinToGrid = (
    node: number,
    p: readonly [number, number],
    arrival: boolean,
    relax = 0,
    lead: readonly [number, number] | null = null,
    exemptSite: CrossingSite | null = null,
  ): number => {
    let made = 0;
    for (const connector of gridConnectors(p, arrival, relax, lead, exemptSite)) {
      link(
        node,
        connector.node,
        connector.cost,
        CONNECTOR_DIR,
        [...connector.points].reverse().slice(1, -1),
      );
      made += 1;
      // Three is plenty of choice for the search and keeps the graph small;
      // they are cost-sorted, so these are the three shortest ways in.
      if (made >= 3) break;
    }
    return made;
  };

  // The four ring gateways. Each stands ON the drawn ring, so a route that
  // starts here starts on paving — which is what makes "every route has
  // 'ring' on one end" true of the geometry and not only of the edge table.
  const ringNodes: number[] = [];
  for (const tap of lattice.taps) {
    const node = addNode(tap.rim[0], tap.rim[1]);
    link(node, tap.index, tap.cost, CONNECTOR_DIR, []);
    ringNodes.push(node);
  }

  // **Every bridge, as a mandatory edge.** The deck polyline is pinned at the
  // deck's own edges and centre so the drawn Catmull-Rom runs dead straight
  // over the rail rather than bowing off the deck between two distant feet.
  const footNodes: number[] = [];
  for (const site of CROSSING_SITES) {
    yield site.railDistance;
    const feet = crossingFeet(site);
    const plusNode = addNode(feet.plus[0], feet.plus[1]);
    const minusNode = addNode(feet.minus[0], feet.minus[1]);
    const plusDeck: readonly [number, number] = [
      site.x + site.dirX * DECK_HALF_LENGTH,
      site.z + site.dirZ * DECK_HALF_LENGTH,
    ];
    const minusDeck: readonly [number, number] = [
      site.x - site.dirX * DECK_HALF_LENGTH,
      site.z - site.dirZ * DECK_HALF_LENGTH,
    ];
    const via: readonly (readonly [number, number])[] = [
      plusDeck,
      [site.x, site.z] as const,
      minusDeck,
    ];
    const chain = [feet.plus, ...via, feet.minus];
    let length = 0;
    for (let s = 1; s < chain.length; s += 1) {
      const a = chain[s - 1] as readonly [number, number];
      const b = chain[s] as readonly [number, number];
      length += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    link(plusNode, minusNode, length, DECK_DIR, via);
    footNodes.push(plusNode, minusNode);
    for (const [node, foot] of [
      [plusNode, feet.plus],
      [minusNode, feet.minus],
    ] as readonly (readonly [number, readonly [number, number]])[]) {
      // **Screened first; its own site's exemption is the backtrack, not the
      // default** — the standing procgen rule, the same ladder every door
      // walks a few lines below.
      //
      // Handing a foot the exemption straight away was measured on 2 Sep 2026
      // and is wrong: a foot that *can* reach the grid on clear ground is then
      // free to reach it back through the reservation instead, over the
      // masonry, because a connector is chosen by cost and the way through is
      // shorter than the way round. Seed 11 went from 2 back to 22 stranded
      // and seed 208 from 0 to 3. Screened first, the exemption only ever
      // fires for a foot that has no other way onto the grid at all — which
      // is the case #414 recorded, seed 24 losing its only bridge.
      if (joinToGrid(node, foot, false) > 0) continue;
      if (joinToGrid(node, foot, false, 1) > 0) continue;
      if (joinToGrid(node, foot, false, 0, null, site) > 0) continue;
      // **A ramp landing beside the statue circle still crosses somewhere
      // real.** A foot with no connector because it stands inside the ring's
      // own guard zone (every node and leg there is deliberately invalid) is
      // not unusable — it lands beside the promenade, and the ring is the
      // paved backbone. Decision 5 still holds: the bridge feeds one of the
      // four compass gateways, not a fifth connection of its own.
      const compass = nearestCompassPoint(foot[0], foot[1]);
      const gap = Math.hypot(compass[0] - foot[0], compass[1] - foot[1]);
      const nearRing = Math.hypot(foot[0] - PLAZA.x, foot[1] - PLAZA.z) <= RING_RADIUS + 4;
      if (!nearRing || gap > 8) continue;
      const ringNode = ringNodes.find(
        (candidate) =>
          Math.abs((xs[candidate] as number) - compass[0]) < 1e-6 &&
          Math.abs((zs[candidate] as number) - compass[1]) < 1e-6,
      );
      if (ringNode !== undefined) link(node, ringNode, gap, CONNECTOR_DIR, []);
    }
  }

  // Every door, with its terminal connector.
  const destinations = gridDestinations();
  const destinationNode = new Map<string, number>();
  const relaxedDoors: string[] = [];
  for (const destination of destinations) {
    yield destinations.length;
    const node = addNode(destination.gridPoint[0], destination.gridPoint[1]);
    destinationNode.set(destination.id, node);
    if (joinToGrid(node, destination.gridPoint, true, 0, destination.lead) > 0) continue;
    // Backtrack rather than give the door away to another router: first drop
    // the head-on preference, then widen the shells and the tail limit.
    if (joinToGrid(node, destination.gridPoint, true) > 0) {
      relaxedDoors.push(`${destination.id}:oblique`);
      continue;
    }
    if (joinToGrid(node, destination.gridPoint, true, 1) > 0) {
      relaxedDoors.push(`${destination.id}:wide`);
      continue;
    }
    if (joinToGrid(node, destination.gridPoint, true, 2) > 0) {
      relaxedDoors.push(`${destination.id}:relay`);
      continue;
    }
    relaxedDoors.push(`${destination.id}!`);
  }

  // The gate corridor's candidate handover points — one node each, so the
  // avenue is solved on the same graph as everything else.
  const gateNodes: { mouth: readonly [number, number]; node: number }[] = [];
  for (const mouth of gateCorridorMouthCandidates()) {
    const handover = gateCorridorHandover(mouth);
    const node = addNode(handover[0], handover[1]);
    if (joinToGrid(node, handover, false) === 0 && joinToGrid(node, handover, false, 1) === 0) {
      joinToGrid(node, handover, false, 2);
    }
    gateNodes.push({ mouth, node });
  }

  pathGridCache = {
    lattice,
    count: xs.length,
    xs: Float64Array.from(xs),
    zs: Float64Array.from(zs),
    neighbours,
    ringNodes,
    destinations,
    destinationNode,
    doorNodes: new Set(destinationNode.values()),
    footNodes,
    gateNodes,
    relaxedDoors,
  };
  return pathGridCache;
}

/** {@link pathGridSearch} driven straight through — the memo means only the
 * first caller ever builds anything. */
function pathGrid(): PathGrid {
  const search = pathGridSearch();
  for (;;) {
    const step = search.next();
    if (step.done) return step.value;
  }
}

/** Everything already paved on the grid — grown as routes commit. */
const pavedGridNodes = new Set<number>();
const pavedGridEdges = new Set<string>();

function gridEdgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/**
 * Dijkstra over the grid with a per-turn penalty. `sources` seed the frontier;
 * `goalCost` returns the terminal cost of stopping at a node (`Infinity` = not
 * a goal). Returns the node path from the cheapest goal back to its source, or
 * null when no goal is reachable at all.
 */
function gridSearch(
  sources: readonly { node: number; cost: number }[],
  goalCost: (node: number) => number,
): number[] | null {
  const grid = pathGrid();
  const states = grid.count * GRID_DIRS;
  const stateOf = (node: number, dir: number): number => node * GRID_DIRS + dir + 1;
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
    const node = Math.floor(state / GRID_DIRS);
    const dirIn = (state % GRID_DIRS) - 1;
    const terminal = goalCost(node);
    if (Number.isFinite(terminal) && stateCost + terminal < best) {
      best = stateCost + terminal;
      bestState = state;
    }
    // **Walking through somebody's doormat costs.** A door is where a route
    // ends, not a corridor to somewhere else. Refusing it outright was tried
    // and is wrong: a door's own two or three terminal connectors can be the
    // only thing joining two islands of a lattice that plots have cut up, and
    // forbidding the hop left seed 5's ring able to reach 28 nodes of its own
    // park. So it is priced instead — high enough that any ordinary street
    // route is preferred, low enough that a district is never cut off.
    const doorHop = dirIn >= 0 && grid.doorNodes.has(node) ? DOOR_THROUGH_PENALTY : 0;
    for (const step of grid.neighbours[node] as readonly LatticeNeighbour[]) {
      const turn = dirIn >= 0 && dirIn !== step.dir ? STREET_TURN_PENALTY : 0;
      // A hair's preference for edges already paved, so equal-length routes
      // ride the existing street rather than pave a parallel one.
      const reuse = pavedGridEdges.has(gridEdgeKey(node, step.to)) ? -0.01 : 0;
      const next = stateCost + step.cost + turn + reuse + doorHop;
      const nextState = stateOf(step.to, step.dir);
      if (next < (cost[nextState] as number)) {
        cost[nextState] = next;
        from[nextState] = state;
        heap.push(nextState);
      }
    }
  }
  if (bestState === -1) {
    if (DEBUG_STREETS) {
      const settledNodes = new Set<number>();
      for (let i = 0; i < states; i += 1) if (closed[i]) settledNodes.add(Math.floor(i / GRID_DIRS));
      // eslint-disable-next-line no-console
      console.log(
        `[gridSearch] no goal: ${sources.length} sources, ${settledNodes.size} nodes: ` +
          [...settledNodes].map((n) => `${(grid.xs[n] as number).toFixed(0)},${(grid.zs[n] as number).toFixed(0)}`).join(' '),
      );
    }
    return null;
  }
  const nodes: number[] = [];
  for (let state = bestState; state !== -1; state = from[state] as number) {
    const node = Math.floor(state / GRID_DIRS);
    if (nodes.length === 0 || nodes[nodes.length - 1] !== node) nodes.push(node);
  }
  return nodes.reverse();
}

/** Metres a route is charged for passing through a door node — see
 * {@link gridSearch}. Four street cells: far more than any real detour round a
 * block, far less than losing a district. */
const DOOR_THROUGH_PENALTY = STREET_PITCH * 4;

/** The route from whatever is paved already to `goal`, as grid nodes —
 * network-first, goal-last. Null when the goal cannot be reached.
 *
 * **The goal is never its own source.** A door another route has already paved
 * through is still owed its own edge, and a zero-length one is not an edge:
 * `CatmullRomCurve3` cannot make a curve from a single point, and seeds 5 and
 * 11 crashed the park build on exactly that. Starting one node back gives the
 * edge a real, drawn arrival.
 */
function routeFromNetwork(goal: number): number[] | null {
  const sources = [...pavedGridNodes]
    .filter((node) => node !== goal)
    .map((node) => ({ node, cost: 0 }));
  if (sources.length === 0) return null;
  return gridSearch(sources, (node) => (node === goal ? 0 : Infinity));
}

/** World points of a grid node path, collapsed to its corners — a pinch link
 * or a bridge deck contributes its own intermediate points. */
function gridPathPoints(nodes: readonly number[]): (readonly [number, number])[] {
  const grid = pathGrid();
  const points: (readonly [number, number])[] = [];
  // **A bridge's own control points survive the collapse.** A deck is pinned at
  // its two edges and its centre so the drawn Catmull-Rom runs dead straight
  // over the rail rather than bowing off the deck between two distant feet —
  // and when a site's feet and deck are collinear (seed 225's front-door
  // bridge is exactly on `x = 0`), `collapseCollinear` deletes all three. What
  // is left is one 39 m straight segment with the deck somewhere in the middle
  // of it and nothing telling `drapePathsOverBridges` where the deck starts:
  // the ribbon stays at ground level under a raised bridge, the NavGrid's
  // keepout cuts the walk there, and **every waypoint on the far side of the
  // railway is stranded** — 105 of them on seed 225, all on one rail side.
  const pinned = new Set<number>();
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i] as number;
    if (i > 0) {
      const previous = nodes[i - 1] as number;
      const link = (grid.neighbours[previous] as readonly LatticeNeighbour[]).find(
        (step) => step.to === node && step.via.length > 0,
      );
      if (link) {
        for (const point of link.via) {
          if (link.dir === DECK_DIR) pinned.add(points.length);
          points.push(point);
        }
      }
    }
    points.push([grid.xs[node] as number, grid.zs[node] as number]);
  }
  return collapseCollinearKeeping(points, pinned);
}

/** {@link collapseCollinear}, except that the listed indices are never
 * dropped however collinear they look — see {@link gridPathPoints}. */
function collapseCollinearKeeping(
  points: readonly (readonly [number, number])[],
  keep: ReadonlySet<number>,
): (readonly [number, number])[] {
  if (keep.size === 0) return collapseCollinear(points);
  const out: (readonly [number, number])[] = [];
  let run: (readonly [number, number])[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const collapsed = collapseCollinear(run);
    for (const point of collapsed) {
      const last = out[out.length - 1];
      if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 1e-9) continue;
      out.push(point);
    }
    run = [];
  };
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i] as readonly [number, number];
    run.push(point);
    if (keep.has(i)) {
      flush();
      run.push(point); // the pinned point starts the next run too
    }
  }
  flush();
  return out;
}



/**
 * Debug-only window onto the solved grid — read by
 * `scripts/plot-streets.mts` (an SVG plotter for eyeballing the path graph
 * without booting a browser). Not used by the game.
 */
export function debugStreetLattice(): {
  nodes: { x: number; z: number; ok: boolean; side: number; paved: boolean }[];
  edges: { ax: number; az: number; bx: number; bz: number; paved: boolean }[];
  links: { ax: number; az: number; bx: number; bz: number; kind: 'street' | 'pinch' | 'crossing' }[];
  taps: { x: number; z: number; rimX: number; rimZ: number }[];
} {
  const grid = pathGrid();
  const lattice = grid.lattice;
  const nodes: { x: number; z: number; ok: boolean; side: number; paved: boolean }[] = [];
  const edges: { ax: number; az: number; bx: number; bz: number; paved: boolean }[] = [];
  for (let index = 0; index < lattice.count; index += 1) {
    nodes.push({
      x: lattice.xs[index] as number,
      z: lattice.zs[index] as number,
      ok: lattice.nodeOk[index] === 1,
      side: lattice.side[index] as number,
      paved: pavedGridNodes.has(index),
    });
    const [i, j] = lattice.cellOf(index);
    if (i < LATTICE_HALF_CELLS && lattice.edgeEast[index]) {
      const other = lattice.indexOf(i + 1, j);
      edges.push({
        ax: lattice.xs[index] as number,
        az: lattice.zs[index] as number,
        bx: lattice.xs[other] as number,
        bz: lattice.zs[other] as number,
        paved: pavedGridEdges.has(gridEdgeKey(index, other)),
      });
    }
    if (j < LATTICE_HALF_CELLS && lattice.edgeSouth[index]) {
      const other = lattice.indexOf(i, j + 1);
      edges.push({
        ax: lattice.xs[index] as number,
        az: lattice.zs[index] as number,
        bx: lattice.xs[other] as number,
        bz: lattice.zs[other] as number,
        paved: pavedGridEdges.has(gridEdgeKey(index, other)),
      });
    }
  }
  const links: { ax: number; az: number; bx: number; bz: number; kind: 'street' | 'pinch' | 'crossing' }[] = [];
  for (let index = 0; index < grid.count; index += 1) {
    for (const step of grid.neighbours[index] as readonly LatticeNeighbour[]) {
      if (step.to < index) continue; // one direction only
      links.push({
        ax: grid.xs[index] as number,
        az: grid.zs[index] as number,
        bx: grid.xs[step.to] as number,
        bz: grid.zs[step.to] as number,
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
 * How far a grid node may stand from the ribbon its own route draws and still
 * count as paved by it. A node on a committed path normally *is* a vertex of
 * that polyline, so the honest distance is ~0; a metre absorbs
 * `collapseCollinear`'s own rounding without admitting a node the ribbon never
 * reaches.
 */
const PAVED_NODE_ON_RIBBON = 1.0;

/**
 * **A node is paved when a ribbon is drawn through it — not when a search
 * walked through it** (issue #414).
 *
 * A route that wins commits every node of its search path, while what actually
 * gets drawn can be shorter — the gate approach stitches an authored corridor
 * onto part of a solved tail. Every node on the difference stayed flagged
 * paved with nothing under it, and any later route was free to terminate on
 * one. Measured on seed 5: the gate approach committed the node at
 * (41.12, 9.26) while the gate approach it actually drew ends at (5.1, 12.2) —
 * **33.5 m away**; `spur-stall.facePaint` then branched onto that node and
 * came out starting 3.10 m from any paving.
 *
 * So the drawn points are the authority, and the search path is only a
 * candidate list.
 */
function commitGridPathDrawn(
  nodes: readonly number[],
  drawn: readonly (readonly [number, number])[],
): void {
  const grid = pathGrid();
  const onDrawnRibbon = (x: number, z: number): boolean => {
    for (let i = 1; i < drawn.length; i += 1) {
      const a = drawn[i - 1] as readonly [number, number];
      const b = drawn[i] as readonly [number, number];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const lengthSq = dx * dx + dz * dz;
      const t =
        lengthSq > 1e-9
          ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSq))
          : 0;
      if (Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)) <= PAVED_NODE_ON_RIBBON) {
        return true;
      }
    }
    return false;
  };
  let previous = -1;
  for (const node of nodes) {
    const drawnHere = onDrawnRibbon(grid.xs[node] as number, grid.zs[node] as number);
    if (drawnHere) {
      pavedGridNodes.add(node);
      if (previous >= 0) pavedGridEdges.add(gridEdgeKey(previous, node));
    }
    previous = drawnHere ? node : -1;
  }
}

/**
 * After every route is drawn: any ring gateway no route happened to use still
 * gets its street (Decision 5 says exactly four connections, and a circle with
 * three grown streets and one missing gateway reads as an accident, not a
 * design). Each unused gateway is connected to the nearest paving — usually a
 * street already running through or near its own node.
 */
function ensureCompassTaps(edges: PathEdge[]): void {
  const grid = pathGrid();
  for (const ringNode of grid.ringNodes) {
    const already = (grid.neighbours[ringNode] as readonly LatticeNeighbour[]).some((step) =>
      pavedGridEdges.has(gridEdgeKey(ringNode, step.to)),
    );
    if (already) continue;
    // Goal: paving on the grid proper. Another gateway is not a goal — a
    // gateway-to-gateway street would be a road round the ring, not a tap.
    const path = gridSearch([{ node: ringNode, cost: 0 }], (node) =>
      node < grid.lattice.count && pavedGridNodes.has(node) ? 0 : Infinity,
    );
    if (!path || path.length < 2) continue;
    const points = trimBacktracks(gridPathPoints(path));
    if (points.length < 2) continue;
    commitGridPathDrawn(path, points);
    const di = Math.sign((grid.xs[ringNode] as number) - PLAZA.x);
    const dj = Math.sign((grid.zs[ringNode] as number) - PLAZA.z);
    const name = di > 0 ? 'east' : di < 0 ? 'west' : dj > 0 ? 'south' : 'north';
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
/**
 * **The protected gate corridor: where it starts, where it may end, and why
 * it now ends short of the railway.**
 *
 * The walk in from the gate is the one leg of the network that is *authored*
 * rather than routed: a straight run down `x = 0` from just inside the arch,
 * over the ground `ArrivalSequence` choreographs the cat bus's children
 * across. Everything else meets the railway only at a site
 * `train/crossingPlanSolve.ts` proved a bridge fits on — this one leg met it
 * wherever the loop happened to be.
 *
 * On the canonical seed that was `railDistance` 148.8, 46 deg off square,
 * with both bridge ramps running straight back along the track:
 * unbridgeable, so the park's own front door got the one flat level crossing
 * in it, 19.8 m from where the bus drops her, while the two real bridges
 * stood 25.7 m and 80.5 m away down side spurs. Jim, 26 August 2026: *"I
 * opened and no bridges."* He was describing the park accurately (#339).
 *
 * So the corridor now stops **before** the rail and hands the rest of the
 * walk to the street lattice, which can only cross at a planned site. The
 * arrival's own ground — the arch, the esplanade, the bus stop, everywhere
 * the disembarking crowd walks — is north of the loop on every seed swept,
 * so it keeps its authored corridor; only the stretch *past* the railway
 * changes, and only on the seeds where the loop is in the way at all.
 */
const GATE_CORRIDOR_START_Z = 54;

/** How far in the authored corridor runs when the loop is nowhere near it —
 * the pre-#339 value, unchanged, and still the answer on three of the five
 * swept seeds. */
const GATE_CORRIDOR_INNER_Z = 30;

/**
 * Daylight the corridor's mouth keeps from the rail centre line.
 *
 * Not a taste number: the corridor is a 3.2 m ribbon, so its own edge stands
 * 1.6 m off its centre, and `RAIL_CLAMP_DISTANCE` (4.2 m) is how close the
 * lattice lets any street's centre come to the track. A mouth inside that is
 * a path drawn on the railway.
 */
const GATE_CORRIDOR_RAIL_STANDOFF = RAIL_CLAMP_DISTANCE + 1.6;

/**
 * **How far the corridor's mouth keeps from a bridge's own ground.**
 *
 * `GATE_CORRIDOR_RAIL_STANDOFF` measures from the rail **centre line**, and a
 * ramp reaches roughly three times further than that: on seed 225 the mouth
 * came to rest at (0, 39.8) — exactly its 5.8 m standoff from the track and
 * **four metres up the front-door bridge's ramp**. The mouth is where the
 * corridor hands the walk to the grid, so it is also the node every later route
 * branches from, and a route branching there is drawn across the ramp's flank.
 * Measured on that seed: all four of the park's waypoint-chain breaks had their
 * midpoint standing on a ramp, and they cut 70 waypoints into two pockets.
 *
 * The reach comes from {@link pointStandsOnABridgeRamp}, which builds it from
 * the site's own proven `rampReachPos`/`rampReachNeg`/`halfWidth` — the one
 * owner of that rectangle, deliberately, so this cannot drift from what the
 * bridge builder does. The margin on top is the widest ribbon's own half-width
 * plus kerb, because it is the drawn *edge* that must clear the parapet, not
 * the centreline.
 */
const GATE_CORRIDOR_RAMP_MARGIN = RIBBON_HALF_WIDTH_CEILING;

/** Cached so the callers below cannot disagree, and so the stub search is
 * not repeated. */
let gateCorridorDeepestCache: readonly [number, number] | null = null;

/**
 * **The deepest the authored corridor could run on this seed's park.**
 *
 * Walks in from {@link GATE_CORRIDOR_START_Z} and takes the last point on
 * `x = 0` that is both still on the gate's own side of the loop and a full
 * {@link GATE_CORRIDOR_RAIL_STANDOFF} clear of the track.
 *
 * Whether the street lattice can actually *reach* the mouth is deliberately
 * not asked here. It was, at first — but `gateApproachSearch` already tries
 * both routers from every candidate mouth and keeps the walk that measures
 * best, so asking twice bought nothing and cost a `streetStubs` search on
 * every 20 cm of the scan.
 *
 * When neither the loop, a bridge ramp nor the rail standoff is anywhere near
 * the corridor the scan runs its whole length and ends at
 * {@link GATE_CORRIDOR_INNER_Z} — the pre-#339 answer, unchanged. It is
 * reached by scanning now rather than by an early return, because a ramp can
 * reach the corridor on a seed whose railway does not; see the body.
 */
function gateCorridorDeepestMouth(): readonly [number, number] {
  if (gateCorridorDeepestCache) return gateCorridorDeepestCache;
  const gateSide = railInfoAt(0, GATE_CORRIDOR_START_Z).side;
  const steps = Math.round((GATE_CORRIDOR_START_Z - GATE_CORRIDOR_INNER_Z) / 0.2);
  // **A ramp reaches the corridor on seeds where the railway never does.**
  //
  // This used to return the authored length outright when the loop did not
  // cross `x = 0`, on the reasoning that "a seed whose walk does not meet the
  // railway has nothing here to fix". That skipped the two guards below along
  // with the crossing test, and a bridge is much longer than the track it
  // spans: a diagonal site whose deck sits well off the corridor still sweeps
  // a ramp across it.
  //
  // Measured on seed 131 (2 Sep 2026). The loop never crosses `x = 0`, so the
  // corridor kept its authored mouth at (0, 30) — and the proven site at
  // (-9.80, 34.65), dir (0.799, -0.602), puts that mouth at across = 2.18,
  // along = 10.6 in the site's own frame: inside the footprint, on the ramp's
  // flank. `pointStandsOnABridgeRamp(0, 30)` was true the whole time and was
  // never asked. The drawn gate-approach then ran over the parapet, poiGraph
  // found 1.72 m of solid ground at z 30.14 -> 28.68 (peak push 0.62 m), and
  // the lane's outer half — six waypoints, at = 0..37 — became a pocket
  // joined to nothing. Jim's report #1, "the player can stand in 'path mess'
  // near the first bridge on the main branch", is this.
  //
  // So the scan always runs. `crossesAt = -Infinity` makes its own break
  // unreachable, which reproduces the old early return exactly on any seed
  // where no ramp and no standoff intervenes: the walk then ends at
  // `GATE_CORRIDOR_INNER_Z`, which is what `full` was.
  let crossesAt = -Infinity;
  for (let step = 0; step <= steps; step += 1) {
    const z = GATE_CORRIDOR_START_Z - step * 0.2;
    if (railInfoAt(0, z).side !== gateSide) {
      crossesAt = z;
      break;
    }
  }
  let deepest: readonly [number, number] = [0, GATE_CORRIDOR_START_Z] as const;
  for (let step = 0; step <= steps; step += 1) {
    const z = GATE_CORRIDOR_START_Z - step * 0.2;
    if (z <= crossesAt) break;
    if (railInfoAt(0, z).dist < GATE_CORRIDOR_RAIL_STANDOFF) break;
    if (pointStandsOnABridgeRamp(0, z, GATE_CORRIDOR_RAMP_MARGIN)) break;
    deepest = [0, z] as const;
  }
  gateCorridorDeepestCache = deepest;
  return deepest;
}

/**
 * The point the lattice is asked to reach from a given corridor mouth.
 *
 * Three metres past the mouth when the corridor runs its full length — the
 * way the pre-#339 code asked for `[0, 27]` past `[0, 30]`, so the street's
 * own stub has somewhere to arrive from — and the mouth itself when the loop
 * cut the corridor short, because three metres further would be three metres
 * nearer the track than the standoff the mouth was chosen for.
 */
function gateCorridorHandover(mouth: readonly [number, number]): readonly [number, number] {
  if (mouth[1] <= GATE_CORRIDOR_INNER_Z + 1e-6) return [mouth[0], mouth[1] - 3] as const;
  return mouth;
}

/** How much of a walk is walked twice: at every corner sharper than a right
 * angle and a half, the shorter of the two legs meeting there is ground the
 * walker covers, turns round, and covers again. */
const ABOUT_TURN_COSINE = Math.cos((135 * Math.PI) / 180);

function retracedLength(points: readonly (readonly [number, number])[]): number {
  let retraced = 0;
  for (let i = 2; i < points.length; i += 1) {
    const a = points[i - 2] as readonly [number, number];
    const b = points[i - 1] as readonly [number, number];
    const c = points[i] as readonly [number, number];
    const inX = b[0] - a[0];
    const inZ = b[1] - a[1];
    const outX = c[0] - b[0];
    const outZ = c[1] - b[1];
    const inLength = Math.hypot(inX, inZ);
    const outLength = Math.hypot(outX, outZ);
    if (inLength < 1e-6 || outLength < 1e-6) continue;
    const cosine = (inX * outX + inZ * outZ) / (inLength * outLength);
    if (cosine > ABOUT_TURN_COSINE) continue;
    retraced += Math.min(inLength, outLength);
  }
  return retraced;
}

/** A retraced metre is charged this many ordinary metres. High enough that
 * the avenue will happily walk a good deal further round to avoid doubling
 * back on itself, which is what a park path looks like and a shortest-path
 * solve does not. */
const RETRACE_PENALTY = 8;

/**
 * **The park's main avenue: authored corridor from the arch, then a solved
 * street to one of the ring's four gateways.**
 *
 * Two decisions here are made by *trying them and measuring the walk*, not by
 * arithmetic — because both of them only became decisions at all once the
 * walk started crossing the railway on a bridge (issue #339), and the obvious
 * answer to each is wrong on a seed:
 *
 * - **How far the authored corridor runs.** Its deepest legal end
 *   ({@link gateCorridorDeepestMouth}) is right on the canonical seed and
 *   badly wrong on seed 5, where the bridge the walk wants stands with its
 *   ramp foot *north* of the gate: marching 13 m in and then 16 m back out to
 *   reach that foot is a 29 m out-and-back where 5 m of walking would do.
 * - **Which of the ring's four gateways it arrives at.** The nearest one to
 *   the gate was free while the walk came straight down `x = 0`; coming off a
 *   bridge ramp it is not. On the canonical seed the ramp runs 15 m past the
 *   north gateway's latitude before it levels out, so the walk overshot and
 *   hooked 4.8 m back on itself to reach a gateway it had already gone by.
 *   The west gateway is straight ahead of the same ramp.
 *
 * Scored on the walk itself: every about-turn costs the ground that gets
 * retraced, at {@link RETRACE_PENALTY} times its length, and total length
 * breaks the tie. Backtracking on a decision until one works is how the rest
 * of the procgen behaves (CLAUDE.md, Jim, 22 August 2026); a corridor length
 * and a gateway are just two more decisions.
 *
 * Both routers commit lattice paving as their sub-legs solve, so every try
 * runs from the same snapshot and only the winner's paving is allowed to
 * stand — see {@link latticeStateSnapshot}.
 */
function* gateApproachSearch(
  progress: number,
): Generator<number, { points: (readonly [number, number])[]; progress: number }, void> {
  const grid = pathGrid();
  let best: {
    points: (readonly [number, number])[];
    path: readonly number[];
    score: number;
    retraced: number;
  } | null = null;
  for (const gate of grid.gateNodes) {
    // **The longest authored corridor is tried first and kept if it works.**
    // Shortening it further is a change to the ground the cat-bus arrival
    // choreographs, so it is only worth making when the walk the longer
    // corridor produces actually doubles back on itself.
    if (best && best.retraced < 0.05) break;
    // **One candidate per slice.** Each of these is a whole network solve, and
    // `boot/parkGeneration.ts` spreads this generator over the cat-bus ride's
    // frames against an 8 ms budget — running the lot inside one step put
    // 77.6 ms into a single `advance()` and `check:park-boot` said so.
    yield (progress += 1);
    const path = routeFromNetwork(gate.node);
    if (!path) continue;
    // The search runs network-first; the avenue is drawn gate-first.
    const points = trimBacktracks(assembleGateApproach(gate.mouth, [...gridPathPoints(path)].reverse()));
    if (points.length < 2) continue;
    const retraced = retracedLength(points);
    const score = retraced * RETRACE_PENALTY + polylineLength(points);
    if (DEBUG_STREETS) {
      // eslint-disable-next-line no-console
      console.log(
        `[avenue] mouth (${gate.mouth[0].toFixed(2)},${gate.mouth[1].toFixed(2)}): ` +
          `length ${polylineLength(points).toFixed(1)} retraced ${retraced.toFixed(1)} ` +
          `score ${score.toFixed(1)}` +
          `\n[avenue]   shape ${points.map((q) => `(${q[0].toFixed(1)},${q[1].toFixed(1)})`).join(' ')}`,
      );
    }
    if (best && score >= best.score) continue;
    best = { points, path, score, retraced };
  }
  if (!best) {
    // **Nothing solved at all.** The old fallback here ran a straight line from
    // the corridor's mouth to the nearest ring gateway, and on the canonical
    // seed that line crossed the railway 20.9 m from the nearest proven bridge
    // site — a park that fails its own every-crossing-is-a-bridge rule at the
    // front door. So the fallback is an axis-aligned walk on the grid's lines
    // instead, held to the mouth's own side of the track; and if even that
    // finds nothing, the avenue is the authored corridor alone, which is short
    // and legal and leaves the failure where an invariant can see it.
    const mouth = gateCorridorDeepestMouth();
    const handover = gateCorridorHandover(mouth);
    const side = railInfoAt(handover[0], handover[1]).side;
    const gateway = nearestCompassPoint(handover[0], handover[1]);
    const walk = relayPolyline(
      handover,
      gateway,
      (ax, az, bx, bz) =>
        streetSegmentClear(ax, az, bx, bz, handover, 7, 2.0) &&
        segmentHoldsRailSide(ax, az, bx, bz, side, 0) &&
        !segmentCutsABridgeRamp(ax, az, bx, bz),
    );
    return {
      points: trimBacktracks(
        walk
          ? assembleGateApproach(mouth, walk)
          : [
              [0, GATE_CORRIDOR_START_Z] as readonly [number, number],
              // A mouth that never left the arch leaves no corridor to draw, so
              // the avenue is one short step in — enough to be a curve, and
              // honest about how little of it solved.
              mouth[1] < GATE_CORRIDOR_START_Z - 1e-6
                ? mouth
                : ([0, GATE_CORRIDOR_START_Z - 2] as readonly [number, number]),
            ],
      ),
      progress,
    };
  }
  commitGridPathDrawn(best.path, best.points);
  return { points: best.points, progress };
}

/**
 * The corridor lengths worth trying. Exactly one when the loop is nowhere
 * near the corridor — that is the pre-#339 park, and it must not move — and
 * otherwise the deepest legal end, the arch end (no corridor at all, the walk
 * routed from the gate node itself), and the midpoint between them.
 */
function gateCorridorMouthCandidates(): readonly (readonly [number, number])[] {
  const deepest = gateCorridorDeepestMouth();
  if (deepest[1] <= GATE_CORRIDOR_INNER_Z + 1e-6) return [deepest];
  const candidates: (readonly [number, number])[] = [deepest];
  const midpoint = (deepest[1] + GATE_CORRIDOR_START_Z) / 2;
  if (midpoint - deepest[1] > 2) candidates.push([0, midpoint] as const);
  if (GATE_CORRIDOR_START_Z - deepest[1] > 2) {
    candidates.push([0, GATE_CORRIDOR_START_Z] as const);
  }
  return candidates;
}


/**
 * Stitch the authored corridor onto a solved tail, dropping the seam's own
 * dead end.
 *
 * `solved` runs handover-first. Its own first point *is* the handover, so it
 * is dropped; and the mouth goes with it whenever the tail's next point
 * stands back up the corridor rather than on from it — otherwise corridor and
 * tail walk the same stretch of `x = 0` twice, out and back, leaving a
 * dead-end stub on the end of the park's main avenue (measured on the
 * canonical seed: the corridor ran to `(0, 50.4)` and the tail's first real
 * point was `(0, 54.48)`, a 4 m about-turn).
 */
function assembleGateApproach(
  mouth: readonly [number, number],
  solved: readonly (readonly [number, number])[],
): (readonly [number, number])[] {
  const start = [0, GATE_CORRIDOR_START_Z] as const;
  const tail = solved.slice(1);
  const rejoin = tail[0];
  const backUpTheCorridor =
    rejoin !== undefined && Math.abs(rejoin[0] - mouth[0]) < 1.5 && rejoin[1] >= mouth[1] - 0.05;
  const corridor: (readonly [number, number])[] =
    backUpTheCorridor || Math.abs(mouth[1] - start[1]) < 0.05 ? [] : [mouth];
  const points = [start, ...corridor, ...tail];
  // Drop repeats the stitching can produce (a mouth that is its own handover,
  // a tail whose first point is the gate node) — a zero-length segment has no
  // direction, and every consumer downstream takes directions off this list.
  return points.filter((point, index) => {
    if (index === 0) return true;
    const previous = points[index - 1] as readonly [number, number];
    return Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 0.05;
  });
}

export function* pathGraphSearch(): Generator<number, PathGraph, void> {
  let progress = 0;
  // **The whole grid first, sliced, before anything asks for it.** It is
  // memoised and expensive to build, so whoever touched it first paid the lot
  // in one frame; warming it here through its own generator makes it many
  // suspension points instead of one long unit. See {@link pathGridSearch}.
  const grid = yield* pathGridSearch();
  // A second build in the same process must produce the same park: the paved
  // bookkeeping is the one piece of solve state that outlives a build.
  pavedGridNodes.clear();
  pavedGridEdges.clear();

  const ringPoints = solveRing();
  const ring: RouteDefinition = { name: 'main-loop', width: 3.6, closed: true, points: ringPoints };

  const nodes: PathNode[] = [
    { id: 'gate', kind: 'gate', x: 0, z: 54 },
    { id: 'plaza', kind: 'plaza', x: PLAZA.x, z: PLAZA.z },
  ];
  // The ring is drawn paving from the outset, and its four gateways stand on
  // it — so every route below starts from real ribbon rather than from a
  // promise that one will be drawn later.
  for (const ringNode of grid.ringNodes) pavedGridNodes.add(ringNode);

  // Solved before the edge table is assembled, because it is the one edge whose
  // solve is a search over candidates rather than a single route — see
  // {@link gateApproachSearch}, which yields between them.
  const gateApproach = yield* gateApproachSearch(progress);
  progress = gateApproach.progress;

  const edges: PathEdge[] = [
    // The backbone, as an edge from itself to itself: everything hangs off it.
    { from: 'ring', to: 'ring', paved: true, route: ring },
    // The approach: from just inside the park gate, down the protected
    // corridor, then onto the grid.
    {
      from: 'gate',
      to: 'ring',
      paved: true,
      route: {
        name: 'gate-approach',
        width: 3.2,
        closed: false,
        points: gateApproach.points,
      },
    },
    // From the ring to the plaza edge nearest the gate side, so the two
    // networks always touch. Left on `detourAroundBlockers` rather than grid-
    // routed (issue #269 QA): this short fixed connector sits inside the ring,
    // where the grid deliberately has no nodes at all.
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

  const strandedDoors: string[] = [];
  yield (progress += 1); // the ring is solved; each destination now gets its own slice
  for (const destination of grid.destinations) {
    nodes.push({
      id: destination.id,
      kind: destination.kind,
      x: destination.x,
      z: destination.z,
    });
    const goal = grid.destinationNode.get(destination.id);
    let path = goal === undefined ? null : routeFromNetwork(goal);
    let routed = path ? gridPathPoints(path) : null;
    if (!routed) {
      // **The shared grid could not reach this door**, because the plots have
      // cut its district off from the component the ring stands in — seed 11
      // splits into a 61-node component holding the ring and a 35-node one
      // holding the hotel, the castle, the ball pit and the slide exit.
      //
      // So: get onto the door's own side of the railway by the shared grid
      // (over a bridge if that is what it takes — the deck is an edge of that
      // grid), then walk in on {@link relayPolyline}'s axis-aligned lines,
      // screened with this door's own arrival exemption. Every metre is still
      // on a grid line and still cannot cross the railway anywhere but a
      // bridge; what it gives up is only the *shared* grid's clearance, which
      // is what made the district unreachable in the first place.
      const door = destination.gridPoint;
      const doorSide = railInfoAt(door[0], door[1]).side;
      // Everything the paved network can already reach, on the door's own side
      // of the railway — the possible bridgeheads, nearest to the door first.
      const reachable = new Set<number>(pavedGridNodes);
      const queue = [...pavedGridNodes];
      while (queue.length > 0) {
        const here = queue.pop() as number;
        for (const step of grid.neighbours[here] as readonly LatticeNeighbour[]) {
          if (reachable.has(step.to)) continue;
          reachable.add(step.to);
          queue.push(step.to);
        }
      }
      const heads = [...reachable]
        .filter(
          (node) =>
            node < grid.lattice.count &&
            railInfoAt(grid.xs[node] as number, grid.zs[node] as number).side === doorSide,
        )
        .sort(
          (m, n) =>
            Math.hypot((grid.xs[m] as number) - door[0], (grid.zs[m] as number) - door[1]) -
            Math.hypot((grid.xs[n] as number) - door[0], (grid.zs[n] as number) - door[1]),
        )
        .slice(0, 6);
      // **Backtracking, CLAUDE.md's standing procgen rule**: several
      // bridgeheads, and a plot clearance that tightens one step at a time
      // before it gives up. 2.2 m still keeps a 2.6 m ribbon's own paved edge
      // (1.3 + 0.85 = 2.15 m) off the plot it passes; below that it would not,
      // so the ladder stops there.
      if (DEBUG_STREETS) {
        // eslint-disable-next-line no-console
        console.log(
          `[rescue] ${destination.id} door (${door[0].toFixed(1)},${door[1].toFixed(1)}) side ${doorSide}: ` +
            `${reachable.size} reachable, ${heads.length} heads` +
            (heads[0] !== undefined
              ? ` nearest (${(grid.xs[heads[0]] as number).toFixed(1)},${(grid.zs[heads[0]] as number).toFixed(1)})`
              : ''),
        );
      }
      // **Grid discipline first, its own private line only as the backtrack.**
      // `relayPolyline` may walk an endpoint's own row or column, and left
      // unbounded that is how seed 11 got two 39.7 m and 24 m arterials on
      // private lines 0.8 m apart — see that function's own note. Bounding it
      // to one `STREET_PITCH` from the owning endpoint fixes seed 11 (22 -> 4
      // stranded) and, applied unconditionally, starves the doors that
      // genuinely need a longer step out: canonical 4 -> 7, seeds 267 and 428
      // each 0 -> 2, two green seeds lost. Measured, both ways.
      //
      // So it is a ladder, the same shape the bridge feet walk above: every
      // bridgehead and margin under discipline, and only if the whole of that
      // finds nothing does the private line get its full length back. A long
      // private run is still far better than the straight-line last resort
      // below, which draws a ribbon nobody can walk to.
      for (const withDiscipline of [true, false]) {
        for (const margin of [STREET_PLOT_CLEARANCE, 2.2]) {
          for (const head of heads) {
            const toHead = gridSearch(
              [...pavedGridNodes].map((node) => ({ node, cost: 0 })),
              (node) => (node === head ? 0 : Infinity),
            );
            if (!toHead) continue;
            const walk = relayPolyline(
              [grid.xs[head] as number, grid.zs[head] as number],
              door,
              (ax, az, bx, bz) =>
                streetSegmentClear(ax, az, bx, bz, door, 7, 2.0, margin) &&
                segmentClearOfRing(ax, az, bx, bz) &&
                segmentHoldsRailSide(ax, az, bx, bz, doorSide, 0) &&
                !segmentCutsABridgeRamp(ax, az, bx, bz),
              withDiscipline,
            );
            if (!walk) continue;
            path = toHead;
            routed = [...gridPathPoints(toHead), ...walk.slice(1)];
            break;
          }
          if (routed) break;
        }
        if (routed) break;
      }
    }
    let paved = true;
    if (!routed) {
      // **Nothing legal reaches it.** The straight run to the nearest paving is
      // the last resort — but only when it stays on the door's own side of the
      // railway. A straight line that hops the rail is not a worse path, it is
      // an illegal one: `train/crossings.ts` fails the whole build on it (Jim,
      // 2 Sep: every crossing is a bridge), so it would hide a stranded door
      // behind a crash in a different file. Where even that is not available,
      // the edge stays a connectivity fact with no ribbon, and
      // {@link strandedDoorsOfLastSolve} says so.
      path = null;
      const near = nearestGridPaving(destination.gridPoint);
      const doorSide = railInfoAt(destination.gridPoint[0], destination.gridPoint[1]).side;
      if (
        segmentHoldsRailSide(
          near[0],
          near[1],
          destination.gridPoint[0],
          destination.gridPoint[1],
          doorSide,
          0,
        )
      ) {
        routed = [near, destination.gridPoint];
      } else {
        routed = [destination.gridPoint];
        paved = false;
      }
      strandedDoors.push(destination.id);
    }
    const points: (readonly [number, number])[] = trimBacktracks([...routed, ...destination.tail]);
    if (SPUR_STRETCH > 0 && destination.id === SPUR_STRETCH_ID) bowMidSegment(points);
    if (path) commitGridPathDrawn(path, points);
    if (points.length < 2) {
      // Every route must be a curve, and a curve needs two points. A stranded
      // door with nothing past it gets a one-metre stub along its own outward
      // ray so the edge is still a real, drawable arrival.
      const outward = destination.lead ?? [destination.x, destination.z + 1];
      const dx = outward[0] - destination.gridPoint[0];
      const dz = outward[1] - destination.gridPoint[1];
      const l = Math.hypot(dx, dz) || 1;
      points.push([destination.gridPoint[0] + dx / l, destination.gridPoint[1] + dz / l]);
    }
    edges.push({
      from: 'ring',
      to: destination.id,
      paved,
      route: {
        name: `spur-${destination.id}`,
        width: destination.width,
        closed: false,
        points,
      },
    });
    yield (progress += 1);
  }

  // **Every proven bridge gets walked on.**
  //
  // A bridge exists in the built park only where a drawn path crosses the
  // railway (`train/crossings.ts` measures the ribbons, `bridgeFootprint.ts`
  // builds from that list), and the fence seals the rail corridor everywhere
  // else. So an unwalked crossing site is not merely an unused shortcut: it is
  // a **gap in the fence that never opens**, and any pocket of park that the
  // rail loop and the boundary between them cut off has no way in or out at
  // all.
  //
  // Measured on seed 225: the parent branch's per-destination router happened
  // to use all three of that seed's proven sites, this one's shortest-path
  // solve used two, and the 105 waypoints in the pocket behind the third —
  // every one of them on the same side of the railway — were in "a pocket of
  // the garden graph nobody can walk to". Not one of them was near a door, so
  // no reachability check saw it; `poi.stranded` did.
  //
  // Paving all of them is also the shape Jim asked for — bridges as first-class
  // citizens of the layout rather than an afterthought — and a park with three
  // bridges in it is a better park for a six-year-old than one with two.
  yield (progress += 1);
  yield* walkEveryBridge(edges, progress);

  // Every ring gateway that no route happened to use still gets its street —
  // Decision 5's "exactly 4 connections at compass points" is a property of the
  // built ring, not a hope about routing order.
  yield (progress += 1);
  ensureCompassTaps(edges);
  yield (progress += 1);

  // Test hook, same pattern as `SPUR_STRETCH_ID`: zero/default in the game, set
  // only by the invariant that proves `detourRatiosStayReasonable` can actually
  // fail (it re-solves the park with this set, to measure the pre-
  // interconnection hub-and-spoke tree directly).
  if (!DISABLE_INTERCONNECTS) yield* addInterconnects(nodes, edges, progress);

  lastStrandedDoors = strandedDoors;
  return { nodes, edges, ring };
}

/**
 * Doors the grid could not reach on the park just built, if any — each one a
 * straight run to the nearest paving rather than a street. Read by
 * `test/procgen/invariants.ts` so a park that loses a door's grid route says so
 * on every run, rather than passing quietly on a ribbon that happens to land in
 * the right place.
 */
let lastStrandedDoors: readonly string[] = [];
export function strandedDoorsOfLastSolve(): readonly string[] {
  return lastStrandedDoors;
}


/**
 * One route over every proven crossing site whose deck no other route already
 * walks — see the call site for why an unwalked site is a sealed pocket rather
 * than an unused shortcut.
 *
 * The route runs from the paved network to whichever foot is cheaper to reach,
 * straight over the deck, and then on to the far side's own paving where there
 * is any, so it does not end in mid-air. Where the far side has nothing paved
 * yet, the foot is the end: a bridge foot is a real place to arrive, and the
 * next destination on that side will branch from it.
 */
function* walkEveryBridge(edges: PathEdge[], progress: number): Generator<number, number, void> {
  const grid = pathGrid();
  for (let site = 0; site * 2 + 1 < grid.footNodes.length; site += 1) {
    yield (progress += 1);
    const plus = grid.footNodes[site * 2] as number;
    const minus = grid.footNodes[site * 2 + 1] as number;
    if (pavedGridEdges.has(gridEdgeKey(plus, minus))) continue;
    const deck = (grid.neighbours[plus] as readonly LatticeNeighbour[]).find(
      (step) => step.to === minus && step.dir === DECK_DIR,
    );
    if (!deck) continue;
    let best: { near: number; far: number; path: number[] } | null = null;
    for (const [near, far] of [
      [plus, minus],
      [minus, plus],
    ] as readonly (readonly [number, number])[]) {
      const path = routeFromNetwork(near);
      if (!path) continue;
      if (best && path.length >= best.path.length) continue;
      best = { near, far, path };
    }
    if (!best) continue;
    const onward = (() => {
      const sources = [...pavedGridNodes];
      if (sources.length === 0) return null;
      // The far side's own paving, if it has any — never back over this deck.
      const settled = gridSearch([{ node: best.far, cost: 0 }], (node) =>
        node !== best.far &&
        pavedGridNodes.has(node) &&
        railInfoAt(grid.xs[node] as number, grid.zs[node] as number).side ===
          railInfoAt(grid.xs[best.far] as number, grid.zs[best.far] as number).side
          ? 0
          : Infinity,
      );
      return settled && settled.length > 1 ? settled : null;
    })();
    const via = best.near === plus ? deck.via : [...deck.via].reverse();
    const points: (readonly [number, number])[] = trimBacktracks([
      ...gridPathPoints(best.path),
      ...via,
      [grid.xs[best.far] as number, grid.zs[best.far] as number],
      ...(onward ? gridPathPoints(onward).slice(1) : []),
    ]);
    commitGridPathDrawn(best.path, points);
    pavedGridNodes.add(best.near);
    pavedGridNodes.add(best.far);
    pavedGridEdges.add(gridEdgeKey(plus, minus));
    if (onward) commitGridPathDrawn(onward, points);
    edges.push({
      from: 'ring',
      to: 'ring',
      paved: true,
      route: { name: `bridge-walk-${site}`, width: 3.0, closed: false, points },
    });
  }
  return progress;
}


/**
 * **Nothing this file draws may double back on itself.**
 *
 * A control polyline that walks out and comes back along the same line — seed
 * 225's `spur-building` ran `(0, 43.1) -> (36.5, 43.1) -> (25.4, 43.1)`, 11 m
 * of pure overshoot — is not merely untidy. `routeCurve`'s fillet pass and the
 * Catmull-Rom through it have no sensible answer at a 180 degree vertex, so the
 * ribbon folds over itself; that is Jim's "path mess", and the waypoints
 * `poiGraph` samples at the fold land off the paving.
 *
 * The seams are where it comes from: a solved grid path joined to a relay walk,
 * or a bridge route joined to its onward leg, can meet head to head. Rather
 * than teach four callers to trim their own seams, every route is trimmed here,
 * once, on the way out.
 *
 * Deleting the middle vertex of an about-turn leaves exactly the net movement
 * the walk actually makes, and always shortens the polyline, so the pass
 * terminates.
 */
const ABOUT_TURN_COSINE_DRAWN = Math.cos((150 * Math.PI) / 180);

function trimBacktracks(
  points: readonly (readonly [number, number])[],
): (readonly [number, number])[] {
  // Repeats first: a zero-length hop has no direction, and every consumer
  // downstream takes directions off this list. A route that collapses to a
  // single point is one `CatmullRomCurve3` cannot curve at all — seed 5 crashed
  // the park build in `poiGraph`'s own sampler when the gate corridor's mouth
  // came out equal to its start.
  const out: (readonly [number, number])[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 1e-6) continue;
    out.push([point[0], point[1]] as readonly [number, number]);
  }
  for (let pass = 0; pass < out.length; pass += 1) {
    let cut = -1;
    for (let i = 1; i < out.length - 1; i += 1) {
      const a = out[i - 1] as readonly [number, number];
      const b = out[i] as readonly [number, number];
      const c = out[i + 1] as readonly [number, number];
      const inX = b[0] - a[0];
      const inZ = b[1] - a[1];
      const outX = c[0] - b[0];
      const outZ = c[1] - b[1];
      const inLength = Math.hypot(inX, inZ);
      const outLength = Math.hypot(outX, outZ);
      if (inLength < 1e-6 || outLength < 1e-6) continue;
      const cosine = (inX * outX + inZ * outZ) / (inLength * outLength);
      if (cosine > ABOUT_TURN_COSINE_DRAWN) continue;
      cut = i;
      break;
    }
    if (cut < 0) break;
    out.splice(cut, 1);
  }
  return out;
}

/** The nearest point on anything already paved — the last-resort terminal for
 * a door the grid could not route to. */
function nearestGridPaving(p: readonly [number, number]): readonly [number, number] {
  const grid = pathGrid();
  let best: readonly [number, number] = [PLAZA.x + RING_RADIUS, PLAZA.z];
  let bestDistance = Infinity;
  for (const node of pavedGridNodes) {
    const x = grid.xs[node] as number;
    const z = grid.zs[node] as number;
    const distance = Math.hypot(x - p[0], z - p[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [x, z];
    }
  }
  return best;
}

/**
 * See {@link SPUR_STRETCH}: no-op in the game, non-zero only for the test that
 * proves a longer spur leaves distant scenery where it was.
 *
 * Bows the segment carrying the polyline's arc-length midpoint, sideways off
 * that one segment — not the head-to-tail chord: on a route with many control
 * points a chord midpoint spliced near the head is a park-crossing zigzag
 * (measured: +50 m of paving from a "2 m" bow), the very opposite of the small,
 * local paving perturbation this hook exists to make.
 */
function bowMidSegment(points: (readonly [number, number])[]): void {
  if (points.length < 2) return;
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i - 1] as readonly [number, number];
    const q = points[i] as readonly [number, number];
    total += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  let walked = 0;
  for (let i = 1; i < points.length; i += 1) {
    const p = points[i - 1] as readonly [number, number];
    const q = points[i] as readonly [number, number];
    const segment = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (walked + segment >= total / 2 && segment > 1e-6) {
      points.splice(i, 0, [
        (p[0] + q[0]) / 2 + (-(q[1] - p[1]) / segment) * SPUR_STRETCH,
        (p[1] + q[1]) / 2 + ((q[0] - p[0]) / segment) * SPUR_STRETCH,
      ]);
      return;
    }
    walked += segment;
  }
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
 * **2.5, and the constraint that pinned it at 2.0 no longer reproduces.**
 *
 * This sat at **2.0** for a fortnight, held there not by anything about
 * connectors but by `Scenery.ts`'s hiding maze. `generateWallMaze` records a
 * piece's corner — and so its 12 m+ exclusion zone — only *after* the piece has
 * cleared `runIsClear` and `fitsAmong`, both of which ask about the world as it
 * stands. A refusal caused by a new connector ribbon therefore releases that
 * zone and lets a later candidate take it, and on 18 August 2026 the full 3.5x
 * set shifted a maze piece across a paving-free NPC waypoint chord near the
 * hotel spur, stranding **38 waypoints**. Sweep then: 3.5x → 38 stranded,
 * 3.0x → 37, 2.5x → 3, 2.0x → 0.
 *
 * **Re-measured on 31 August 2026, that stranding is simply gone** — with the
 * maze completely untouched. The park has been re-laid several times since
 * (the railway rework of #431 most of all), and `check:park` now reports
 * `poi.stranded` **0 at 2.0, 2.5, 3.0 and 3.5 alike**. The old figures were a
 * true measurement of a park that no longer exists. Connectors built, per seed
 * (`LGP_CONNECTOR_CAP`):
 *
 * | cap | canonical | seed 2 | seed 5 | seed 11 | seed 18 |
 * | --- | --- | --- | --- | --- | --- |
 * | 2.0 | 3 | 5 | 4 | 3 | 3 |
 * | **2.5** | **4** | 7 | 4 | 5 | 3 |
 *
 * So the cap moves on the evidence of the whole invariant suite rather than on
 * `poi.stranded`, which is canonical-only (issue #437). `test:procgen` across
 * all five seeds: **2.5 → 497 passed. 3.0 → two failures**, and they are
 * independent of each other:
 *
 * 1. `connector-stall.railRacer-stall.waterFight` draws a **26.2 m diagonal**
 *    through Decision 3, because above 2.5 the cap admits pairs the street
 *    lattice cannot serve and the connector falls back to the continuous
 *    router. A limit of the router, not a tolerance to widen.
 * 2. `scatterDecoupling` — *"bowing spur-stall.railRacer by 2 m changed scenery
 *    more than 30 m away"*. **This is the maze coupling above, still real**, and
 *    it starts to bite at 3.0 while staying quiet at 2.5.
 *
 * **2.5 is therefore measured, not chosen**: the largest multiple green on
 * every seed, and reachable without touching the maze. On the canonical park it
 * restores exactly the connector the railway rework cost —
 * `stall.spaceFerrisWheel` ↔ `stall.facePaint`, a pair 27.79 m apart that never
 * moved (issue #416).
 *
 * Going beyond 2.5 needs **both** of the above fixed, and note that the maze
 * one is not the easy half: the late reservation that causes the coupling is
 * also the maze's only *retry*, and removing it naively drops the flush-wall
 * count below #423's floor. See `HANDOFF-maze-index-locked.md`.
 */
const CONNECTOR_SPACING_CAP_MULTIPLE = numberFromEnv('LGP_CONNECTOR_CAP') || 2.5;

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


/**
 * **The interconnection pass.** Everything earlier in {@link pathGraphSearch}
 * builds a pure hub-and-spoke tree: the ring plus one route per destination,
 * each taking the shortest grid path from whatever is already paved —
 * nothing in that process ever asks whether two *different* destinations end
 * up needlessly far apart from each other. A real park's path network is a
 * mesh: two neighbouring stalls on different branches get a paved line
 * between them, not just a shared ring three turns away (Jim, PR #286:
 * "there aren't enough edges between nodes that are close but currently
 * unlinked ... they should be inter-connected").
 *
 * For every pair of real destinations that are both close (within
 * {@link CONNECTOR_SPACING_CAP_MULTIPLE} plot-hops, straight-line) and whose
 * *current* paved walk is a disproportionate multiple of both that
 * straight-line distance ({@link CONNECTOR_RATIO_THRESHOLD}) and the park's
 * own typical plot spacing ({@link CONNECTOR_MIN_WASTE_MULTIPLE}), adds one
 * edge between them — **routed on the grid**, door node to door node, so it
 * lands on the same lines as the rest of the network rather than drawing its
 * own private diagonal across the park.
 *
 * Candidates are processed nearest-first, and the distance oracle is rebuilt
 * after every addition, so a pair a just-added connector already fixes is
 * never connected a second time — over-connecting into a fully-meshed graph
 * is exactly what {@link CONNECTOR_SPACING_CAP_MULTIPLE} and
 * {@link CONNECTOR_MIN_WASTE_MULTIPLE} exist to prevent.
 */
function* addInterconnects(
  nodes: PathNode[],
  edges: PathEdge[],
  progress: number,
): Generator<number, number, void> {
  const grid = pathGrid();
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
      // sense this pass fixes: the walk between them is over a bridge, and a
      // direct connector here would draw a second, redundant crossing run.
      if (railInfoAt(a.x, a.z).side !== railInfoAt(b.x, b.z).side) continue;
      candidates.push({ a, b, straight });
    }
  }
  // Nearest pairs first, ties broken by original (deterministic) order.
  candidates.sort((x, y) => x.straight - y.straight);

  // Rebuilding the distance oracle is the expensive part (it re-splices every
  // edge against every other), so it is only ever rebuilt lazily, the first
  // time a query follows an addition — not once per candidate.
  let graph = buildRouteDistanceGraph(edges);
  let stale = false;
  for (const { a, b, straight } of candidates) {
    // One candidate pair per slice opportunity: each accepted connector runs a
    // grid search, which is exactly the per-unit cost the boot budget is
    // sized for.
    yield (progress += 1);
    if (stale) {
      graph = buildRouteDistanceGraph(edges);
      stale = false;
    }
    const paved = graph.distanceBetween(a.x, a.z, b.x, b.z);
    if (!Number.isFinite(paved)) continue; // not actually connected — a different bug, not this pass's job
    if (paved < straight * CONNECTOR_RATIO_THRESHOLD) continue;
    if (paved - straight < minWaste) continue;

    // **A connector is a street like any other**, routed on the same grid as
    // every other metre of paving (this is what replaced the old pass's direct
    // diagonals): door node to door node, riding existing lines where they run.
    // A genuinely adjacent pair (the ferris wheel and its own kiosk stand 2.3 m
    // apart) is beneath the grid's resolution — routing doorstep to doorstep
    // via each one's own terminal connector can measure longer than the detour
    // this pass exists to fix — so close pairs connect direct.
    const nodeA = grid.destinationNode.get(a.id);
    const nodeB = grid.destinationNode.get(b.id);
    let points: (readonly [number, number])[] | null = null;
    let path: number[] | null = null;
    if (straight > 10 && nodeA !== undefined && nodeB !== undefined) {
      path = gridSearch([{ node: nodeA, cost: 0 }], (node) => (node === nodeB ? 0 : Infinity));
      if (path) {
        const middle = gridPathPoints(path);
        points = [
          ...(Math.hypot((middle[0] as readonly [number, number])[0] - a.x, (middle[0] as readonly [number, number])[1] - a.z) > 1e-6
            ? [[a.x, a.z] as readonly [number, number]]
            : []),
          ...middle,
          ...(Math.hypot(
            (middle[middle.length - 1] as readonly [number, number])[0] - b.x,
            (middle[middle.length - 1] as readonly [number, number])[1] - b.z,
          ) > 1e-6
            ? [[b.x, b.z] as readonly [number, number]]
            : []),
        ];
      }
    } else if (straight <= 10) {
      const side = railInfoAt(a.x, a.z).side;
      if (
        streetSegmentClear(a.x, a.z, b.x, b.z, [a.x, a.z], 7) &&
        segmentHoldsRailSide(a.x, a.z, b.x, b.z, side, 0) &&
        !segmentCutsABridgeRamp(a.x, a.z, b.x, b.z)
      ) {
        points = [
          [a.x, a.z],
          [b.x, b.z],
        ];
      }
    }
    if (!points || points.length < 2) continue;

    // A doorstep-to-doorstep link is exempt from the corridor screen: both
    // ends' own routes already carry lamps there, so the marginal lamp risk is
    // nil, while a cross-park shortcut under a ride's track is exactly the
    // measured pylon-starvation case the screen exists for.
    if (straight > 8 && routeCrossesARideCorridor(points)) {
      if (DEBUG_STREETS) {
        // eslint-disable-next-line no-console
        console.log(`[connect] ${a.id}-${b.id}: rejected, crosses a ride corridor`);
      }
      continue;
    }
    // **The disproportion escape** (issue #361). The screens below drop paving
    // on the principle that a *shortcut* never outranks the park's own
    // structure. That holds right up to the point where the structure-
    // respecting alternative stops being a detour and becomes a walk round the
    // park: seed 11 put `ballPit` and `exit-ginormousSlide` 14.1 m apart and
    // 238.7 m apart by paving — 17x — and a six-year-old who can see the slide
    // exit from the ball pit is not walking that.
    //
    // The line between "tidy" and "absurd" is taken from the park's own
    // geometry, never a typed ratio (issue #292's lesson): a route that
    // respects the grid only ever turns at right angles, so it costs at worst
    // the **Manhattan** distance between the pair, plus up to one whole
    // `STREET_PITCH` of dog-leg at each end to get onto a grid line and back
    // off it at the door.
    const gridHonestWalk = Math.abs(a.x - b.x) + Math.abs(a.z - b.z) + 2 * STREET_PITCH;
    const detourIsDisproportionate = paved > gridHonestWalk;
    if (DEBUG_STREETS && detourIsDisproportionate) {
      // eslint-disable-next-line no-console
      console.log(
        `[escape] ${a.id}-${b.id}: ${straight.toFixed(1)} m apart, ${paved.toFixed(1)} m by paving ` +
          `(${(paved / straight).toFixed(2)}x) against a grid-honest ${gridHonestWalk.toFixed(1)} m — ` +
          'the structure screens yield',
      );
    }

    // A connector running along the ginormous slide's leg corridor starves the
    // chute of standable ground (`slide/supports.ts`) — an optional shortcut
    // never outranks the slide's own legs. Measured on seed 11: with this
    // connector drawn the 72 m chute could stand only 2 legs.
    let slideOverlap = 0;
    for (let i = 1; i < points.length && slideOverlap <= 8; i += 1) {
      const p = points[i - 1] as readonly [number, number];
      const q = points[i] as readonly [number, number];
      slideOverlap += slideCorridorOverlap(p[0], p[1], q[0], q[1]);
    }
    // ...with the same escape, and only where the corridor is not something
    // this connector *chose* to run along. Where a destination stands inside
    // the leg corridor, that ground is already paved and lamped by its own
    // mandatory route, so a connector arriving there adds no marginal risk.
    // Which destinations those are is **measured, never assumed**: seed 11 puts
    // `exit-ginormousSlide` inside the corridor, seed 2 puts it outside.
    // **Read `theGinormousSlideStandsOnSomething`'s margin before widening
    // this**: seed 11's chute stands on 3 legs against a floor of 3.
    const corridorIsADoorstep =
      detourIsDisproportionate &&
      (pointInSlideCorridor(a.x, a.z) || pointInSlideCorridor(b.x, b.z));
    if (slideOverlap > 8 && !corridorIsADoorstep) {
      if (DEBUG_STREETS) {
        // eslint-disable-next-line no-console
        console.log(`[connect] ${a.id}-${b.id}: rejected, runs along the slide corridor`);
      }
      continue;
    }
    if (path) commitGridPathDrawn(path, points);

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
/**
 * ## Why the drawn curve lives HERE and not in `pathGraph.ts`
 *
 * It used to live there, and that was the wrong module: `pathGraph.ts`
 * *draws* routes, `paths.ts` *decides* them, and this is the definition of
 * what a decided route looks like once drawn. Keeping them apart meant
 * `paths.ts` could not ask what its own routes look like — `pathGraph.ts`
 * imports `paths.ts`, so the dependency could only go one way — and so every
 * geometric question in this file was answered against the **control
 * polyline** instead of the swept curve.
 *
 * On a bend those are metres apart. Issue #414: `bestBranchPoint` picked a
 * junction on a route's control polyline, the ribbon was drawn on the curve,
 * and seed 5's `spur-stall.facePaint` came out branching off nothing —
 * starting 3.10 m from the nearest paving. Same disease as #349, where
 * `pavingHeightAt` computed on an analytic frame while the masonry was built
 * from chords: two descriptions of one curve, drifting where it turns.
 *
 * `pathGraph.ts` re-exports {@link routeCurve} so its own consumers (the
 * ribbon extruder, `LampPosts.ts`, `poiGraph.ts`, `ParkMap.ts`,
 * `test/procgen/parkFacts.ts`) are unchanged.
 */

/** Fillet radius at a street corner — Decision 3: "rounded corners,
 * 1.5-2 m fillets; square junctions otherwise". */
const CORNER_FILLET = 1.75;

/** Sampling pitches for {@link drawnPolyline}: dense enough that the
 * Catmull-Rom the ribbon extruder sweeps hugs the polyline (a Catmull-Rom
 * through collinear points *is* the straight line), coarse enough to cost
 * nothing. */
const STRAIGHT_SAMPLE = 2.5;
const ARC_SAMPLE = 0.6;

/**
 * **The one owner of what an open route's drawn centreline looks like**:
 * dead-straight runs between corners, each corner rounded by a real
 * {@link CORNER_FILLET} arc — not the old behaviour, where the sparse
 * control points fed a tension-0.4 Catmull-Rom whose corner rounding grew
 * with segment length, so a 20 m street corner bowed for many metres and
 * the whole "axis-aligned" network drew as organic sweeps (Jim, 23 August
 * 2026: "that top-down view looks nothing like how we discussed"). The
 * returned points are dense (every couple of metres on straights, ~0.6 m
 * round each fillet), so the Catmull-Rom built from them cannot depart
 * from the shape they describe.
 */
function drawnPolyline(
  points: readonly (readonly [number, number])[],
): (readonly [number, number])[] {
  // Collapse near-duplicates first — a zero-length leg is a NaN tangent.
  const src: [number, number][] = [];
  for (const p of points) {
    const last = src[src.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.05) continue;
    src.push([p[0], p[1]]);
  }
  if (src.length < 2) return src;

  const out: [number, number][] = [src[0] as [number, number]];
  const emitStraightTo = (to: readonly [number, number]): void => {
    const from = out[out.length - 1] as readonly [number, number];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (length < 1e-6) return;
    const steps = Math.max(1, Math.ceil(length / STRAIGHT_SAMPLE));
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      out.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
    }
  };

  for (let k = 1; k < src.length - 1; k += 1) {
    const a = src[k - 1] as readonly [number, number];
    const c = src[k] as readonly [number, number];
    const b = src[k + 1] as readonly [number, number];
    const lenIn = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const lenOut = Math.hypot(b[0] - c[0], b[1] - c[1]);
    const dirInX = (c[0] - a[0]) / lenIn;
    const dirInZ = (c[1] - a[1]) / lenIn;
    const dirOutX = (b[0] - c[0]) / lenOut;
    const dirOutZ = (b[1] - c[1]) / lenOut;
    const turn = Math.abs(Math.atan2(dirInX * dirOutZ - dirInZ * dirOutX, dirInX * dirOutX + dirInZ * dirOutZ));
    if (turn < 0.05) {
      emitStraightTo(c);
      continue;
    }
    // Clamp the fillet so two nearby corners never eat each other's legs.
    const fillet = Math.min(CORNER_FILLET, lenIn * 0.45, lenOut * 0.45);
    const pIn: readonly [number, number] = [c[0] - dirInX * fillet, c[1] - dirInZ * fillet];
    const pOut: readonly [number, number] = [c[0] + dirOutX * fillet, c[1] + dirOutZ * fillet];
    emitStraightTo(pIn);
    // Quadratic Bezier through the corner: a clean constant-ish-radius
    // rounding for any turn angle, sampled finely enough to read as an arc.
    const arcLength = fillet * turn; // close enough for choosing a sample count
    const steps = Math.max(2, Math.ceil(arcLength / ARC_SAMPLE));
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps;
      const u = 1 - t;
      out.push([
        u * u * pIn[0] + 2 * u * t * c[0] + t * t * pOut[0],
        u * u * pIn[1] + 2 * u * t * c[1] + t * t * pOut[1],
      ]);
    }
  }
  emitStraightTo(src[src.length - 1] as readonly [number, number]);
  return out;
}

/**
 * **The one Catmull-Rom every consumer of a route's drawn shape builds** —
 * the ribbon extruder here, the lamp walker (`LampPosts.ts`), the NPC
 * waypoint seeder (`poiGraph.ts`), the park map (`ParkMap.ts`) and the
 * procgen facts (`test/procgen/parkFacts.ts`) all ask this instead of each
 * repeating the `new CatmullRomCurve3(..., 0.4)` incantation over raw
 * control points — CLAUDE.md's "one owner; everyone else asks", after this
 * file's fillet pass made the drawn shape more than the control points.
 * The closed backbone ring keeps its raw points: it is a circle through 32
 * bearings, and filleting a circle's own samples would only dent it.
 */
export function routeCurve(route: RouteDefinition): CatmullRomCurve3 {
  const points = route.closed ? route.points : drawnPolyline(route.points);
  const vectors = points.map(([x, z]) => new Vector3(x, 0, z));
  return new CatmullRomCurve3(vectors, route.closed, 'catmullrom', 0.4);
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



/** TEMP diagnostic. */
export function debugRelaxedDoors(): readonly string[] {
  return pathGrid().relaxedDoors;
}

/** TEMP diagnostic: why can this point not reach the grid? */
export function debugDoorReach(p: readonly [number, number]): unknown {
  const lattice = streetLattice();
  const pSide = railInfoAt(p[0], p[1]).side;
  const out: unknown[] = [];
  const ci = Math.round((p[0] - PLAZA.x) / STREET_PITCH);
  const cj = Math.round((p[1] - PLAZA.z) / STREET_PITCH);
  for (let shell = 0; shell <= 3; shell += 1) {
    for (let di = -shell; di <= shell; di += 1) {
      for (let dj = -shell; dj <= shell; dj += 1) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== shell) continue;
        const i = ci + di;
        const j = cj + dj;
        if (Math.abs(i) > LATTICE_HALF_CELLS || Math.abs(j) > LATTICE_HALF_CELLS) continue;
        const index = lattice.indexOf(i, j);
        const nx = lattice.xs[index] as number;
        const nz = lattice.zs[index] as number;
        out.push({
          n: `${nx.toFixed(1)},${nz.toFixed(1)}`,
          ok: lattice.nodeOk[index] === 1,
          side: lattice.side[index],
          pSide,
          tail: Math.min(Math.abs(p[0] - nx), Math.abs(p[1] - nz)).toFixed(1),
          direct: Math.hypot(p[0] - nx, p[1] - nz).toFixed(1),
          clear: streetSegmentClear(nx, nz, p[0], p[1], p, 7),
          ring: segmentClearOfRing(nx, nz, p[0], p[1]),
          railSide: segmentHoldsRailSide(nx, nz, p[0], p[1], pSide, 0),
          ramp: !segmentCutsABridgeRamp(nx, nz, p[0], p[1]),
          elbowA: [
            streetSegmentClear(nx, nz, nx, p[1], p, 7),
            segmentClearOfRing(nx, nz, nx, p[1]),
            segmentHoldsRailSide(nx, nz, nx, p[1], pSide, 0),
            !segmentCutsABridgeRamp(nx, nz, nx, p[1]),
            streetSegmentClear(nx, p[1], p[0], p[1], p, 7),
            segmentClearOfRing(nx, p[1], p[0], p[1]),
            segmentHoldsRailSide(nx, p[1], p[0], p[1], pSide, 0),
            !segmentCutsABridgeRamp(nx, p[1], p[0], p[1]),
          ].join(''),
          elbowB: [
            streetSegmentClear(nx, nz, p[0], nz, p, 7),
            segmentClearOfRing(nx, nz, p[0], nz),
            segmentHoldsRailSide(nx, nz, p[0], nz, pSide, 0),
            !segmentCutsABridgeRamp(nx, nz, p[0], nz),
            streetSegmentClear(p[0], nz, p[0], p[1], p, 7),
            segmentClearOfRing(p[0], nz, p[0], p[1]),
            segmentHoldsRailSide(p[0], nz, p[0], p[1], pSide, 0),
            !segmentCutsABridgeRamp(p[0], nz, p[0], p[1]),
          ].join(''),
        });
      }
    }
  }
  return { p, pSide, ringDist: Math.hypot(p[0] - PLAZA.x, p[1] - PLAZA.z).toFixed(1), RING_RADIUS, out };
}

/** TEMP diagnostic: which destinations are reachable in the grid at all, and
 * how many connectors each bridge foot got. */
export function debugGridReach(): unknown {
  const grid = pathGrid();
  const seen = new Set<number>(grid.ringNodes);
  const queue = [...grid.ringNodes];
  while (queue.length) {
    const n = queue.pop() as number;
    for (const step of grid.neighbours[n] as readonly LatticeNeighbour[]) {
      if (seen.has(step.to)) continue;
      seen.add(step.to);
      queue.push(step.to);
    }
  }
  const noSearch = grid.destinations
    .filter((d) => {
      pavedGridNodes.clear();
      for (const n of grid.ringNodes) pavedGridNodes.add(n);
      return routeFromNetwork(grid.destinationNode.get(d.id) as number) === null;
    })
    .map((d) => d.id);
  const unreachable = grid.destinations
    .filter((d) => !seen.has(grid.destinationNode.get(d.id) as number))
    .map((d) => d.id);
  const feet = grid.footNodes.map((n, i) => ({
    i,
    at: `${(grid.xs[n] as number).toFixed(1)},${(grid.zs[n] as number).toFixed(1)}`,
    links: (grid.neighbours[n] as readonly LatticeNeighbour[]).length,
    reachable: seen.has(n),
  }));
  const comp = new Map<number, number>();
  let next = 0;
  for (let n = 0; n < grid.count; n += 1) {
    if (comp.has(n)) continue;
    if (n < grid.lattice.count && !grid.lattice.nodeOk[n]) continue;
    const id = next++;
    const q = [n];
    comp.set(n, id);
    while (q.length) {
      const cur = q.pop() as number;
      for (const step of grid.neighbours[cur] as readonly LatticeNeighbour[]) {
        if (comp.has(step.to)) continue;
        comp.set(step.to, id);
        q.push(step.to);
      }
    }
  }
  const sizes = new Map<number, number>();
  for (const id of comp.values()) sizes.set(id, (sizes.get(id) ?? 0) + 1);
  const ringComp = grid.ringNodes.map((n) => comp.get(n));
  return {
    unreachable,
    noSearch,
    feet,
    components: [...sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    ringComp,
    doorComp: grid.destinations.map((d) => `${d.id}:${comp.get(grid.destinationNode.get(d.id) as number)}`),
    map: (() => {
      const rows: string[] = [];
      for (let j = -LATTICE_HALF_CELLS; j <= LATTICE_HALF_CELLS; j += 1) {
        let row = '';
        for (let i = -LATTICE_HALF_CELLS; i <= LATTICE_HALF_CELLS; i += 1) {
          const n = grid.lattice.indexOf(i, j);
          row += grid.lattice.nodeOk[n] ? String(comp.get(n) ?? '?') : (grid.lattice.side[n] === 1 ? '.' : ',');
        }
        rows.push(row);
      }
      return rows;
    })(),
  };
}

/** TEMP diagnostic: the parapet band only — what `segmentCutsABridgeRamp`
 * actually screens against. */
export function debugPointStandsOnBridgeMasonry(x: number, z: number): boolean {
  return pointStandsOnBridgeMasonry(x, z);
}
