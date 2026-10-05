import { BUILDING_CENTRE_NUDGE, BUILDING_HALF_X, BUILDING_HALF_Z, BUILDING_WALL_THICKNESS, CASTLE_TURRET_BASE_RADIUS, CASTLE_TURRET_CORNERS, SPUR_PAVED_REACH } from '../core/constants';
import { TOWER_JAMB_HALF_THICKNESS, TOWER_JAMB_REACH } from './hotel/towerDimensions';
import {
  REPTILE_LIPS_REACH,
  REPTILE_TAIL_BASE_RADIUS,
  REPTILE_TAIL_BEARING_OFFSET,
  REPTILE_TAIL_REACH,
} from './reptileHouse/layout';
import { BOUNDARY_WALL_COLLISION_HALF, PARK_BOUNDARY } from './boundary';
import { distanceToBoothBodies } from '../minigames/stallPlacement';
import { ENTRANCE_GATE_HALF_WIDTH, ENTRANCE_GATE_X } from './entrance/layout';
import { type CrossingSite } from './train/crossingPlan';
import { DECK_HALF_LENGTH } from './train/bridgeFootprint';
import { CROSSING_SITES } from './train/crossingPlan';
import { ENTRANCE_GATE_Z } from './entrance/layout';
import { CatmullRomCurve3, Vector3 } from 'three';
import { lazyView } from '../boot/lazyView';
import { MAIN_LOOP_WIDTH } from '../core/constants';
import { PARK_LAYOUT } from './parkLayout';
import { registerPlanCache } from '../boot/planCaches';

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
  /**
   * Interior corners another paved route starts or ends on — **junctions**,
   * which {@link routeCurve} draws square instead of filleting. Decision 3:
   * "rounded corners, 1.5-2 m fillets; square junctions otherwise". Filled in
   * by {@link squareJunctionCorners}; omitted on a route nothing joins at a
   * corner.
   */
  readonly squareCorners?: readonly (readonly [number, number])[];
}

export { MAIN_LOOP_WIDTH };

/** Fountain plaza — wherever the layout put it. Paths converge here. */
export const PLAZA: { readonly x: number; readonly z: number; readonly radius: number } = lazyView(() => ({
  x: PARK_LAYOUT.fountain.x,
  z: PARK_LAYOUT.fountain.z,
  radius: PARK_LAYOUT.fountain.radius,
}));

// ------------------------------------------------------------ generation

/** Everything the ring road and the spurs must steer around. */
export interface Blocker {
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

export interface LatticeTap {
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
export interface LatticeNeighbour {
  readonly to: number;
  /** 0-3: the four street directions; 4-7: the four diagonals. */
  readonly dir: number;
  readonly cost: number;
  readonly via: readonly (readonly [number, number])[];
}

export interface StreetLattice {
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
export const pavedLatticeNodes = new Set<number>();
export const pavedLatticeEdges = new Set<string>();
export const usedTaps = new Set<number>();

/**
 * Snapshot/restore of the paved-lattice bookkeeping, for candidate
 * exploration: `routeLeg` commits street paving as its legs solve, so a
 * caller trying several candidate routes and keeping one (the fallback's
 * quality scoring) must roll the state back between tries — a losing
 * candidate's paving is never drawn, and a later route terminating on it
 * would "branch off nothing" (measured: seed 18's station spur started
 * 11 m from any real paving, on a phantom node a rejected candidate left
 * marked paved).
 *
 * Also what a prebuilt park (`world/prebuilt/parkFile.ts`) carries: the paving
 * the path search left behind is a decision the drawn paths read, and a
 * hydrated park restores it here rather than searching for it.
 */
export interface LatticeStateSnapshot {
  readonly nodes: readonly number[];
  readonly edges: readonly string[];
  readonly taps: readonly number[];
  readonly rims: readonly number[];
}

export function latticeStateSnapshot(): LatticeStateSnapshot {
  return {
    nodes: [...pavedLatticeNodes],
    edges: [...pavedLatticeEdges],
    taps: [...usedTaps],
    rims: [...tapRimsDrawn],
  };
}

export function restoreLatticeState(snapshot: LatticeStateSnapshot): void {
  pavedLatticeNodes.clear();
  for (const node of snapshot.nodes) pavedLatticeNodes.add(node);
  pavedLatticeEdges.clear();
  for (const edge of snapshot.edges) pavedLatticeEdges.add(edge);
  usedTaps.clear();
  for (const tap of snapshot.taps) usedTaps.add(tap);
  tapRimsDrawn.clear();
  for (const rim of snapshot.rims) tapRimsDrawn.add(rim);
}

/** One off-grid connector from a real point onto the lattice. `points` run
 * node-first, point-last, including both ends. */
export interface StreetStub {
  readonly node: number;
  readonly points: readonly (readonly [number, number])[];
  readonly cost: number;
}

/** Compass taps whose rim segment (ring edge to first lattice node) has
 * already been drawn by some route — {@link ensureCompassTaps} completes
 * the set at the end. */
export const tapRimsDrawn = new Set<number>();

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

/** How close another route's end must be to a corner to be a junction on it.
 * Junctions are the same lattice coordinate reached by two plans, so they
 * agree to rounding, not to a tolerance anyone should tune. */
export const JUNCTION_SNAP = 0.05;

/** Sampling pitches for {@link drawnPolyline}: dense enough that the
 * Catmull-Rom the ribbon extruder sweeps hugs the polyline (a Catmull-Rom
 * through collinear points *is* the straight line), coarse enough to cost
 * nothing. */
const STRAIGHT_SAMPLE = 2.5;
const ARC_SAMPLE = 0.6;

/**
 * **A leg shorter than this, metres, cannot be drawn as a turn** — the
 * narrowest drawn path's half-width is 1.1 m (the ride exits, 2.2 m wide), and
 * a ribbon swept round two corners closer together than its own half-width
 * folds over itself between them, however the corners are rounded.
 */
const SHORT_LEG = 1.0;

/**
 * How gently a jog is eased out: metres of run taken either side of it per
 * metre of sideways step. Ten to one keeps the eased stretch under 6 degrees
 * off its axis, well inside the 15% `pavingLegibility.ts` still calls on-axis.
 */
const JOG_EASE = 5;

/** Legs this parallel (cosine) either side of a short step make it a jog, not a turn. */
const JOG_PARALLEL_COS = 0.9;

/**
 * **Two shapes a route's control points take that no ribbon can be drawn
 * along, taken out before anything is drawn** (mutates `src`).
 *
 * Both come from the lattice: a route is snapped to lattice lines, and where
 * two snaps disagree by a few centimetres, or a doorway sits a hand's width
 * off the line that reaches it, the control points carry a step far shorter
 * than the path is wide. Swept as drawn, a 2.6 m ribbon round two corners
 * 0.37 m apart folds face-down between them (the fold `ribbonEdges` has to
 * pinch shut — a bow-tie gap across the whole path); swept round a corner
 * 0.22 m from its end, its last cross-section swings sideways and the end
 * fans out past the kerb as a fin. Measured before this, on the built parks:
 *
 * - **A jog** — a step of under {@link SHORT_LEG} between two legs running
 *   the same way. Pool seed 15's `spur-stall.dodgems` steps 0.37 m sideways at
 *   (58.0, 32.0); pinched shut there, 1.2 m² of path is lawn. Eased instead:
 *   the two corners are replaced by a gentle diagonal from
 *   {@link JOG_EASE} times the step back along the leg before it to as far
 *   along the leg after it.
 * - **An overshoot** — a step of under {@link SHORT_LEG} between two legs
 *   that are not parallel: the route runs past its corner and comes back to
 *   it. Seed 0's `spur-ballPit` runs east to (37.87, 44.99) and
 *   0.55 m back west before turning south-east — 0.90 m² of lawn in the
 *   paving there. The two corners become the one corner where the two legs'
 *   lines meet.
 * - **A stub** — a first or last leg under {@link SHORT_LEG}. Pool seed 5's
 *   `spur-exit-ferrisWheel` runs 12 m north and then 0.22 m east to its end
 *   at (16.75, 38.53). The corner before the stub is dropped, so the last leg
 *   runs straight to the end point, which does not move: the end is a
 *   doorway, the corner was only where the lattice line happened to be.
 *
 * A corner another route starts on (a square junction corner) is never moved
 * — that route's paving is drawn from it.
 */
function easeJogsAndStubs(
  src: [number, number][],
  squareCorners: readonly (readonly [number, number])[],
): void {
  const isJunction = (c: readonly [number, number]): boolean =>
    squareCorners.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) <= JUNCTION_SNAP);
  const gap = (a: readonly [number, number], b: readonly [number, number]): number =>
    Math.hypot(b[0] - a[0], b[1] - a[1]);

  // Stubs, at either end. **Never when dropping the corner leaves no leg**: an
  // out-and-back `A → B → A` (seed 15 restart 7: a bridge-repair detour 0.86 m
  // out and straight back) has a "stub" last leg, and dropping `B` left `A → A`
  // — one point once collapsed, a Catmull-Rom that throws `reading 'x'` when
  // asked its length, and a whole park build thrown away by a TypeError.
  if (src.length >= 3) {
    const last = src.length - 1;
    const corner = src[last - 1] as [number, number];
    if (
      gap(corner, src[last] as [number, number]) < SHORT_LEG &&
      !isJunction(corner) &&
      gap(src[last - 2] as [number, number], src[last] as [number, number]) >= COINCIDENT
    ) {
      src.splice(last - 1, 1);
    }
  }
  if (src.length >= 3) {
    const corner = src[1] as [number, number];
    if (
      gap(src[0] as [number, number], corner) < SHORT_LEG &&
      !isJunction(corner) &&
      gap(src[0] as [number, number], src[2] as [number, number]) >= COINCIDENT
    ) {
      src.splice(1, 1);
    }
  }

  // Jogs.
  for (let k = 1; k + 2 < src.length; k += 1) {
    const a = src[k - 1] as [number, number];
    const c1 = src[k] as [number, number];
    const c2 = src[k + 1] as [number, number];
    const b = src[k + 2] as [number, number];
    const step = gap(c1, c2);
    if (step >= SHORT_LEG || isJunction(c1) || isJunction(c2)) continue;
    const lenIn = gap(a, c1);
    const lenOut = gap(c2, b);
    if (lenIn < 1e-6 || lenOut < 1e-6) continue;
    const inX = (c1[0] - a[0]) / lenIn;
    const inZ = (c1[1] - a[1]) / lenIn;
    const outX = (b[0] - c2[0]) / lenOut;
    const outZ = (b[1] - c2[1]) / lenOut;
    // Legs that are not parallel: the two corners are one corner, where the
    // legs' own lines meet — so long as that is within reach of both.
    const cross = inX * outZ - inZ * outX;
    if (Math.abs(cross) > 1e-6) {
      const qx = c2[0] - c1[0];
      const qz = c2[1] - c1[1];
      const along = (qx * outZ - qz * outX) / cross; // c1 + in * along
      const back = (qx * inZ - qz * inX) / cross; // c2 + out * back
      if (along >= -0.9 * lenIn && along <= SHORT_LEG && back <= 0.9 * lenOut && back >= -SHORT_LEG) {
        src.splice(k, 2, [c1[0] + inX * along, c1[1] + inZ * along]);
        continue;
      }
    }
    if (inX * outX + inZ * outZ < JOG_PARALLEL_COS) continue;
    const ease = Math.min(JOG_EASE * step, lenIn * 0.45, lenOut * 0.45);
    src.splice(k, 2, [c1[0] - inX * ease, c1[1] - inZ * ease], [c2[0] + outX * ease, c2[1] + outZ * ease]);
    k += 1;
  }
}

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
/** Two drawn points nearer than this are one point: {@link drawnPolyline} collapses them. */
const COINCIDENT = 0.05;

function drawnPolyline(
  points: readonly (readonly [number, number])[],
  squareCorners: readonly (readonly [number, number])[],
): (readonly [number, number])[] {
  // Collapse near-duplicates first — a zero-length leg is a NaN tangent.
  const collapse = (from: readonly (readonly [number, number])[]): [number, number][] => {
    const out: [number, number][] = [];
    for (const p of from) {
      const last = out[out.length - 1];
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < COINCIDENT) continue;
      out.push([p[0], p[1]]);
    }
    return out;
  };
  let src = collapse(points);
  if (src.length < 2) return src;
  easeJogsAndStubs(src, squareCorners);
  // ...and again after easing, which moves corners and can land one on its neighbour.
  src = collapse(src);
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
    if (turn < 0.05 || squareCorners.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) <= JUNCTION_SNAP)) {
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
/**
 * **How finely a route's curve is drawn — the one owner.**
 *
 * Beside {@link routeCurve} because the two go together: the curve is what gets
 * drawn and this is how densely. `pathGraph.ts`'s `buildPaths` divides the
 * ribbon, the kerb and its samples by it; the router asks it to reproduce
 * exactly the geometry a decision will lay down, *before* committing to that
 * decision.
 *
 * **Nobody reimplements this.** A second `max(24, len / 0.8)` beside either
 * caller would be two definitions of "how smooth is a path", and it would drift
 * the first time somebody tuned smoothness — with the screen then measuring a
 * slightly different curve from the one drawn, which is this work's own disease
 * one level down.
 */
export function pathDivisions(curve: CatmullRomCurve3): number {
  return Math.max(24, Math.round(curve.getLength() / 0.8));
}

/**
 * **The points a curve actually lays down when drawn** — post fillet and
 * Catmull-Rom.
 *
 * This is the geometry a child walks and the only geometry worth asking the
 * railway about. **The control polyline is not this**, and the difference is
 * not academic: on seed 288 the control points held their side of the rail
 * while the drawn curve bulged across it, so a screen written against the
 * polyline (`segmentHoldsRailSide` on the straight segments) was structurally
 * unable to see the fault — measured, it changed not one of 1342 samples.
 */
export function curvePoints(
  curve: CatmullRomCurve3,
  divisions: number,
): { readonly x: number; readonly z: number }[] {
  const point = new Vector3();
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i <= divisions; i += 1) {
    curve.getPoint(i / divisions, point);
    out.push({ x: point.x, z: point.z });
  }
  return out;
}

export function routeCurve(route: RouteDefinition): CatmullRomCurve3 {
  const points = route.closed ? route.points : drawnPolyline(route.points, route.squareCorners ?? []);
  // A curve through one point has no length, and three's Catmull-Rom answers
  // that with `Cannot read properties of undefined (reading 'x')` from deep in
  // `getLength` — which reads as a park that failed rather than the bug it is.
  // A RangeError says what happened and where, and `park-attempt` reports it
  // as broken, never as a reason to start the park again.
  if (points.length < 2) {
    throw new RangeError(
      `paths.ts routeCurve: route '${route.name}' draws ${points.length} point(s) from ${route.points.length} ` +
        `control point(s) — a path needs two`,
    );
  }
  const vectors = points.map(([x, z]) => new Vector3(x, 0, z));
  return new CatmullRomCurve3(vectors, route.closed, 'catmullrom', 0.4);
}

/**
 * **Forget everything this module accumulated for the last path graph.** The
 * four lattice accumulators are process-lifetime state the router reads as
 * inputs (a second `pathGraphSearch` in one process would otherwise return a
 * different graph), and the memo caches derive from decisions the park's
 * driver may have just unwound. Called by the paths builder before every
 * solve and whenever it backs out.
 */
export function resetPathsState(): void {
  pavedLatticeNodes.clear();
  pavedLatticeEdges.clear();
  usedTaps.clear();
  tapRimsDrawn.clear();
}
registerPlanCache(resetPathsState);

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
 * ## Two measured dead ends — do not rebuild either (#414, 31 Aug 2026)
 *
 * `edgeOk`, `linkClear` and `nearestPointOnRoute` are the *only* askers, and
 * that is deliberate. Extending the screen to the two routers that are not on
 * that list looks obviously right and is not; both were built and measured on
 * seed 5, whose `poi.stranded` baseline was **8**:
 *
 * 1. **Screening `computeStreetStubs`' `legClear`** — the exact clause
 *    `edgeOk` carries, added to the stub search: **8 -> 50 stranded.**
 *    A refused lattice edge leaves the lattice with other edges; a
 *    destination whose every candidate stub leg is refused gets *no* stub, so
 *    `streetStubs` comes back empty, `streetRoute` returns null, and the whole
 *    spur drops through to `fallbackSpurRoute`. Screening there pushes *more*
 *    routes onto the router that was drawing ribbons across ramps, and severs
 *    the gate approach as well.
 * 2. **Pricing ramp metres in `fallbackSpurRoute`'s candidate score** (200 per
 *    metre): recovered **one** waypoint, 8 -> 7, and **cost an invariant** —
 *    seed 5's `no two close destinations are left with a wildly
 *    disproportionate paved detour`, because at that price the router will buy
 *    a 228.8 m detour to walk round a parapet. One waypoint for one invariant
 *    is not a trade worth making, so it was reverted too.
 *
 * The two together were worst of all: **82 stranded.**
 *
 * **Neither dead end means the remaining cuts are acceptable** — it means they
 * cannot be fixed from inside the path routers. On seed 5 the dodgems at
 * (38.4, 36.3) has *no* ramp-free route to reach: every lattice node is
 * refused (the nearest misses `STUB_TAIL_LIMIT` by 1.1 m) and all four
 * fallback candidates cross proven site 12's ramp, so a screen has nothing to
 * pick and a price can only choose the least-bad. The real fix is letting a
 * foreign leg cross **on the deck** — Jim's *"path finding needs to include
 * bridges from the start"* — which is its own ticket.
 */
export function pointStandsOnABridgeRamp(x: number, z: number, margin = RAMP_SCREEN_MARGIN): boolean {
  return standsOnSomeBridge(x, z, margin, true);
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
/**
 * How far inside the arch the authored corridor's outer end sits, and how far
 * in it runs. **Both measured from the gate, which owns where the gate is.**
 *
 * These were written as bare z coordinates — 54 and 30 — and that was a
 * hand-copy of `ENTRANCE_GATE_Z - 6` and `ENTRANCE_GATE_Z - 30` taken while the
 * gate happened to stand at `z = 60`. It is exactly CLAUDE.md's "two
 * definitions of one thing, kept in step by hand", and the day the gate moved
 * the copy did not: with `GROUND_SPHERE_RADIUS` at 220 the park scales by 2.335
 * and the arch stands at `z = 142.8`, so the corridor began **88.8 m inside the
 * doorway**. Measured on the canonical seed at that scale: the nearest drawn
 * path sample to the arch was **76.3 m away**, the walk in from the gate was
 * undrawn ground for its whole length, and `crossings.ts`'s hand-sampled
 * esplanade march — which only stops when it finds paving underfoot — ran its
 * full 32 m, flipped sides on the railway at (0, 125.8) and threw the park's
 * build with "snaps to no proven bridge site".
 *
 * So they are offsets from the arch now, and nothing but the arch decides where
 * the corridor is. At the authored park size (`PARK_SURFACE_SCALE` 1, gate at
 * `z = 60`) they are 54 and 30, unchanged.
 */
const GATE_CORRIDOR_ARCH_INSET = 6;



/** Where the gate approach starts: on the gate's axis, {@link GATE_CORRIDOR_ARCH_INSET} in from the arch. */
export const GATE_CORRIDOR_START_Z = ENTRANCE_GATE_Z - GATE_CORRIDOR_ARCH_INSET;

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
export const RAMP_SCREEN_MARGIN = 0.5;



/**
 * **The one owner of "is this point inside a bridge's footprint".**
 *
 * Both questions below are this loop with one clause different — the site
 * sweep, the `across` projection onto the crossing's normal, and the `along`
 * bounds that reach `DECK_HALF_LENGTH` plus each ramp's own measured reach.
 * They were written out twice and a third copy was very nearly added; that is
 * this repo's most-cited bug, and the two would have drifted the first time
 * anybody touched `rampReachPos`.
 *
 * `deckCounts` is the whole difference. A bridge's footprint is a road with a
 * wall down each side: `across <= halfWidth` is the surface a child walks on,
 * and only the ring outside it is parapet.
 *
 * - `true` — the bridge's ground **at all**, deck included. The right question
 *   for starting or branching something there.
 * - `false` — the **masonry only**. The right question for routing through,
 *   because a street crossing a bridge is what a bridge is for.
 */
export function standsOnSomeBridge(
  x: number,
  z: number,
  margin: number,
  deckCounts: boolean,
): boolean {
  for (const site of CROSSING_SITES) {
    const bounds = siteFootprint(site, margin);
    const { along, across: signedAcross } = siteFrame(site, x, z);
    const across = Math.abs(signedAcross);
    if (across > bounds.acrossHalf) continue;
    // Inside the deck's own width is road, not wall — keep going, another
    // site's masonry may still claim this point.
    if (!deckCounts && across <= site.halfWidth) continue;
    if (along <= bounds.alongMax && along >= bounds.alongMin) return true;
  }
  return false;
}

/** A point in a crossing site's own frame: `along` its axis from the crossing,
 * `across` it (signed). The one owner of that projection in this file. */
export function siteFrame(site: CrossingSite, x: number, z: number): { along: number; across: number } {
  const dx = x - site.x;
  const dz = z - site.z;
  return { along: dx * site.dirX + dz * site.dirZ, across: -dx * site.dirZ + dz * site.dirX };
}


/** The ground a planned bridge will stand on, padded by `margin`, in its own
 * frame — deck plus each ramp's proven reach along, the proven half-width
 * across. Shared by the point and segment screens so they cannot disagree. */
export function siteFootprint(
  site: CrossingSite,
  margin: number,
): { alongMin: number; alongMax: number; acrossHalf: number } {
  return {
    alongMin: -(DECK_HALF_LENGTH + site.rampReachNeg + margin),
    alongMax: DECK_HALF_LENGTH + site.rampReachPos + margin,
    acrossHalf: site.halfWidth + margin,
  };
}

/**
 * True if a route's paving stays clear of every finish-rainbow foot by the
 * same margin {@link BLOCKERS} holds every route to — on its control polygon
 * and on the Catmull-Rom actually drawn through it. **The one owner of that
 * question** for both kinds of optional-shape routing: a connector that fails
 * it is not drawn (see the screen in {@link addInterconnects}), and a spur's
 * fallback candidate that fails it is passed over for the next
 * ({@link fallbackSpurRoute}).
 */
/**
 * **How far (x, z) stands from the nearest built solid** a path may not run
 * under — every booth's body (`distanceToBoothBodies`), the hotel tower's
 * shell out to the ends of its doorway jambs, the castle's walls and corner
 * turrets, and the boundary wall — negative inside one. Plan-time owners of the shapes the colliders
 * are built from; `test/procgen`'s `noDrawnPavingUnderASolid` measures the
 * built park against the colliders themselves.
 */
export function distanceToBuiltSolids(x: number, z: number): number {
  let best = distanceToBoothBodies(x, z);
  // The boundary wall — except across the gateway, where the wall stops and
  // the gate approach carries the paving out through the arch.
  if (Math.hypot(x - ENTRANCE_GATE_X, z - ENTRANCE_GATE_Z) > ENTRANCE_GATE_HALF_WIDTH + SPUR_PAVED_REACH + 2) {
    best = Math.min(best, PARK_BOUNDARY.distanceToEdge(x, z) - BOUNDARY_WALL_COLLISION_HALF);
  }
  const hotel = PARK_LAYOUT.entries.get('hotel');
  if (hotel) best = Math.min(best, Math.hypot(x - hotel.x, z - hotel.z) - (TOWER_JAMB_REACH + TOWER_JAMB_HALF_THICKNESS));
  // The Reptile House: everything solid round the shell and the mouth stands
  // inside `REPTILE_LIPS_REACH` (held to the mesh at load), and the tail base
  // stands outside it on its own bearing. Missing from this list, the router
  // chose routes under the building it could not see and the plan or the
  // acceptance loop threw the whole layout away for them (#708, seed 14).
  const reptile = PARK_LAYOUT.entries.get('reptileHouse');
  if (reptile) {
    best = Math.min(best, Math.hypot(x - reptile.x, z - reptile.z) - REPTILE_LIPS_REACH);
    const yaw = Math.atan2(reptile.entranceX - reptile.x, reptile.entranceZ - reptile.z);
    const bearing = yaw + (REPTILE_TAIL_BEARING_OFFSET * Math.PI) / 180;
    const tailX = reptile.x + Math.sin(bearing) * REPTILE_TAIL_REACH;
    const tailZ = reptile.z + Math.cos(bearing) * REPTILE_TAIL_REACH;
    best = Math.min(best, Math.hypot(x - tailX, z - tailZ) - REPTILE_TAIL_BASE_RADIUS);
  }
  const castle = PARK_LAYOUT.entries.get('building');
  if (castle) {
    const length = Math.hypot(castle.x, castle.z) || 1;
    const cx = castle.x - (castle.x / length) * BUILDING_CENTRE_NUDGE;
    const cz = castle.z - (castle.z / length) * BUILDING_CENTRE_NUDGE;
    const dx = Math.abs(x - cx) - (BUILDING_HALF_X + BUILDING_WALL_THICKNESS);
    const dz = Math.abs(z - cz) - (BUILDING_HALF_Z + BUILDING_WALL_THICKNESS);
    const outside = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
    best = Math.min(best, outside > 0 ? outside : Math.max(dx, dz));
    for (const [tx, tz] of CASTLE_TURRET_CORNERS) {
      best = Math.min(best, Math.hypot(x - cx - tx, z - cz - tz) - CASTLE_TURRET_BASE_RADIUS);
    }
  }
  return best;
}


/** Owned by `core/constants.ts` (the park manifest places a doormat from it too). */
export { BUILT_SOLID_MARGIN } from '../core/constants';
