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
  squareCorners: readonly (readonly [number, number])[],
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
