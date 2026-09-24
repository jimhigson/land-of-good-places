/**
 * **Does the drawn paving read as a grid?** — the one owner of the two
 * measures `test/procgen/invariants.ts` rejects a park for, asked of the
 * built park by those invariants and of the path graph's own paving at the
 * point of decision by `paths.ts` / `parkPlan.ts`.
 *
 * - {@link longDiagonals}: `pathsRunOnGridAxes` — no piece of off-axis
 *   painted ground longer than {@link MAX_DIAGONAL_APPROACH}.
 * - {@link offLatticeStreetRuns}: `streetsShareLatticeLines` — every
 *   street-length straight run sits on a lattice line through the plaza.
 *
 * They lived inside the invariants file, and the generator carried its own
 * hand-copied approximation (`carriesAnOffLatticeStreetRun`, measured on
 * control points, with an escape the invariant never granted). The two
 * disagreed, and every disagreement was a park the root loop built in full
 * only to throw away: in a 0..15 sweep these two measures were 26 of 45
 * rejected attempts. One measure now, asked by both.
 *
 * **What the measure stands on is passed in** ({@link PavingGround}): the
 * invariant reads the built park (`ParkFacts`), the generator the plan it
 * is building. The measure itself — every threshold, every exemption — is
 * here and only here.
 */
import { CatmullRomCurve3 } from 'three';
import { PLAYER_RADIUS } from '../core/constants';
import {
  offAxisGround,
  offAxisGroundCarriedBy,
  type DrawnEdge,
  type GroundPoint,
  type OffAxisGround,
} from './gridAxes';

/**
 * The drawn centre line of a curve, every ~0.5 m — the sampling
 * `test/procgen/parkFacts.ts` measures the built park on (`PathEdgeFact.points`),
 * so a verdict asked of a candidate here is asked of the same points.
 */
export function drawnCentreLine(curve: CatmullRomCurve3): [number, number][] {
  const length = curve.getLength();
  const steps = Math.max(8, Math.ceil(length / 0.5));
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const point = curve.getPointAt(i / steps);
    points.push([point.x, point.z]);
  }
  return points;
}

/** What the measures stand on — the park as built, or the park as planned. */
export interface PavingGround {
  /** The plaza the street lattice is anchored through. */
  readonly plaza: { readonly x: number; readonly z: number };
  /** Every plot's axis-aligned footprint box. */
  readonly plots: readonly { readonly x: number; readonly z: number; readonly halfX: number; readonly halfZ: number }[];
  /** Signed distance to the park boundary's edge (positive inside). */
  distanceToEdge(x: number, z: number): number;
  /** Distance from (x, z) to the railway's centre line. */
  railDistance(x: number, z: number): number;
  /** True over a railway bridge's own footprint. */
  onBridge(x: number, z: number): boolean;
  /** The Rail Race finish arches' feet. */
  readonly archFeet: readonly { readonly x: number; readonly z: number; readonly radius: number }[];
}

/**
 * **The railway's own geometry is the grid rule's one measured exception**
 * (Decision 6's "genuine minority"): a crossing runs square to the TRACK
 * — which is diagonal to the world axes wherever the loop is — and a
 * fence-following leg (a pocket pinched between rail and boundary has
 * nowhere else to walk) curves with the loop. Both are the railway
 * dictating the shape, exactly as designed (`crossingPlan.ts`); a stepped
 * zigzag over a bridge deck is the absurdity this exemption avoids.
 * Measured off the built park: a hop is railway geometry when it sits
 * over a real bridge's own footprint, or when both its ends hug the rail
 * corridor (fence-follow legs run at `RAIL_CORRIDOR_CLEARANCE`, 4.2 m;
 * a level crossing's feet stand `DECK_HALF_LENGTH + 4` ≈ 7.2 m out).
 *
 * Shared by {@link longDiagonals} and {@link offLatticeStreetRuns}
 * — one owner for "is this hop the railway's shape, not the street plan's".
 */
export function railwayGeometryTest(ground: PavingGround): (a: GroundPoint, b: GroundPoint) => boolean {
  return (a, b) => {
    if (ground.onBridge((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) return true;
    return ground.railDistance(a[0], a[1]) <= 8.5 && ground.railDistance(b[0], b[1]) <= 8.5;
  };
}

/**
 * Longest continuous stretch of any paved ribbon allowed to run diagonally
 * rather than along a grid axis (issue #269).
 *
 * Not zero, on purpose. Two things legitimately still run at an angle:
 *
 * - **A booth's own doorway approach.** `paths.ts`'s `spur()` deliberately
 *   carries the last few metres of a camera-facing booth's spur along the
 *   counter's own facing diagonal so the ribbon arrives head-on rather than
 *   grazing the counter's side wall (see that function's "Arrive HEAD-ON,
 *   not obliquely" note) — a short, intentional exception to the rule this
 *   invariant otherwise enforces.
 * - **A train platform's fixed final approach**, which predates issue #269
 *   and is out of its scope: the platform turn is authored geometry, not
 *   part of the axis-aligned trunk network `paths.ts` grows.
 *
 * The closed backbone ring is exempt outright, not just tolerated — see
 * `ringIsATrueCircleRoundTheStatue`. It is not a lapse in this
 * invariant's coverage: Jim's own follow-up instruction (issue #269, 18
 * August 2026) is that the ring is deliberately the one route in the network
 * allowed to be a genuine circle, off grid axes for its entire circumference,
 * while everything else — every spur, every interconnect — stays on the
 * grid this invariant polices.
 *
 * Measured, not guessed: the canonical seed's longest such stretch (outside
 * the now-exempt ring) is 11.2 m
 * (the west station's own platform approach). This is set generously above
 * that measured worst case — the same shape of bound
 * `TRESTLE_GAP_TOLERANCE` uses — so what actually trips it is a
 * regression: a long run of the *trunk* network (a ring segment, a spur's
 * main body) left diagonal, not a legitimate short approach.
 */
export const MAX_DIAGONAL_APPROACH = 16;

/**
 * Every piece of off-axis painted ground longer than
 * {@link MAX_DIAGONAL_APPROACH} — `pathsRunOnGridAxes`' whole verdict.
 * Measured on the drawn curve and as painted ground, not route objects —
 * see `gridAxes.ts`.
 */
export function longDiagonals(edges: readonly DrawnEdge[], ground: PavingGround): OffAxisGround[] {
  return offAxisGround(edges, railwayGeometryTest(ground)).filter((piece) => piece.extent > MAX_DIAGONAL_APPROACH);
}

/**
 * The pieces of {@link longDiagonals} that the edge named `carrier` paints,
 * and only those — the same verdict, for a screen asking about one
 * candidate among an already-drawn network.
 */
export function longDiagonalsCarriedBy(
  edges: readonly DrawnEdge[],
  carrier: string,
  ground: PavingGround,
): OffAxisGround[] {
  return offAxisGroundCarriedBy(edges, carrier, railwayGeometryTest(ground)).filter(
    (piece) => piece.extent > MAX_DIAGONAL_APPROACH,
  );
}

/**
 * How long an axis-aligned straight run must be before it counts as a
 * *street* (and so must sit on a lattice line): door stubs, arrival leads
 * and fillet transitions are all shorter than this; anything longer is a
 * run a person would read as a street line on the map.
 */
export const MIN_STREET_RUN = 8;

/**
 * How far a street run's own line may sit off the nearest lattice line.
 * The drawn curve on a straight is exact (dense collinear control points),
 * so this headroom only has to absorb the fillet's own approach at the
 * run's two ends — measured worst case across the five seeds: 0.31 m.
 */
export const STREET_LINE_TOLERANCE = 0.9;

/**
 * How much of an edge's either end counts as its door approach (see the
 * exemption list on `streetsShareLatticeLines`): the doormat's
 * stand-off (1.4 m), its 3.5 m arrival lead, the into-the-plot `past`
 * extension (2 m), the up-to-7 m off-street stub tail and a fillet's own
 * give. A run must fit entirely inside this reach to be exempt, so no
 * street-length line can hide in it: the longest exemptable run is by
 * construction shorter than this constant.
 */
export const DOOR_APPROACH_REACH = 15;

/** One street-length straight run standing on its own private line. */
export interface OffLatticeRun {
  readonly edge: string;
  /** `'z'`: north-south (constant x); `'x'`: east-west (constant z). */
  readonly axis: 'x' | 'z';
  readonly length: number;
  /** The run's own line: the mean of its cross-axis coordinate. */
  readonly line: number;
  /** How far that line sits off the nearest lattice line. */
  readonly off: number;
}

/**
 * Every axis-aligned drawn run long enough to read as a street
 * ({@link MIN_STREET_RUN}) that sits further than
 * {@link STREET_LINE_TOLERANCE} off a lattice line at `pitch` through the
 * plaza — `streetsShareLatticeLines`' whole verdict; see that invariant for
 * why, and for every exemption below.
 *
 * `pitch` is the caller's: the invariant passes its own literal, so a change
 * to the generator's pitch cannot make the check true by definition.
 *
 * `edges` must include the backbone ring when there is one: the statue
 * circle's ground is measured off its drawn radius. A caller screening one
 * candidate passes `ringRadius` instead.
 */
export function offLatticeStreetRuns(
  edges: readonly DrawnEdge[],
  ground: PavingGround,
  pitch: number,
  ringRadius: number = backboneRadius(edges, ground.plaza),
): OffLatticeRun[] {
  const found: OffLatticeRun[] = [];
  const railwayGeometry = railwayGeometryTest(ground);
  const plaza = ground.plaza;
  const offLattice = (coordinate: number, anchor: number): number => {
    const remainder = ((((coordinate - anchor) % pitch) + pitch) % pitch);
    return Math.min(remainder, pitch - remainder);
  };

  // Is a straight lattice-line segment obstructed anywhere along the span?
  // Sampled every 2 m. The margins mirror what the generator itself demands
  // of a street (`paths.ts`: plots at `STREET_PLOT_CLEARANCE` 2.6, the rail
  // corridor at 4.2, the boundary at a fallback route's own walkable margin)
  // — a hair under each, so float noise never flips a genuinely usable line
  // to "blocked", while a line the generator would refuse anyway never
  // counts as available (calling it available would make the violation
  // unfixable, not stricter).
  // A Rail Race arch foot blocks a street the same way it blocks the
  // generator: `paths.ts`'s `ARCH_FOOT_MARGIN` (a walkable gap plus the
  // widest ribbon's own half-width and kerb) keeps paving this far off every
  // foot, drawn or not — matched to the formula, a hair under, so a
  // borderline-clear spot never flips the wrong way.
  const ARCH_FOOT_REACH = PLAYER_RADIUS * 2 + 0.4 + (3.6 / 2 + 0.85) - 0.02;
  const blockedAt = (x: number, z: number): boolean => {
    for (const plot of ground.plots) {
      const dx = Math.max(Math.abs(x - plot.x) - plot.halfX, 0);
      const dz = Math.max(Math.abs(z - plot.z) - plot.halfZ, 0);
      if (Math.hypot(dx, dz) < 2.55) return true;
    }
    if (ground.distanceToEdge(x, z) < 2.55) return true;
    // The statue circle's ground blocks a street exactly as the generator's
    // own ring guard does.
    if (Math.hypot(x - plaza.x, z - plaza.z) < ringRadius + 0.4) return true;
    if (ground.railDistance(x, z) < 4.0) return true;
    return false;
  };
  const lineBlocked = (axis: 'x' | 'z', line: number, spanStart: number, spanEnd: number): boolean => {
    const from = Math.min(spanStart, spanEnd);
    const to = Math.max(spanStart, spanEnd);
    const steps = Math.max(1, Math.ceil((to - from) / 2));
    for (let s = 0; s <= steps; s += 1) {
      const along = from + ((to - from) * s) / steps;
      const x = axis === 'z' ? line : along;
      const z = axis === 'z' ? along : line;
      if (blockedAt(x, z)) return true;
      for (const foot of ground.archFeet) {
        if (Math.hypot(x - foot.x, z - foot.z) < foot.radius + ARCH_FOOT_REACH) return true;
      }
    }
    return false;
  };

  for (const edge of edges) {
    if (edge.backbone) continue;
    if (edge.name === 'fountain-approach') continue;
    const points = edge.points;

    // Arc length at each sample, for the door-approach exemption below.
    const along: number[] = [0];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1] as GroundPoint;
      const b = points[i] as GroundPoint;
      along.push((along[i - 1] as number) + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = along[along.length - 1] as number;

    // Group consecutive same-axis hops into maximal straight runs.
    let axis: 'x' | 'z' | null = null;
    let runStart = 0;
    const flush = (endIndex: number): void => {
      if (axis === null || endIndex <= runStart) return;
      const a = points[runStart] as GroundPoint;
      const b = points[endIndex] as GroundPoint;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const runAxis = axis;
      const startAlong = along[runStart] as number;
      const endAlong = along[endIndex] as number;
      axis = null;
      if (length < MIN_STREET_RUN) return;
      // The door's own approach.
      if (endAlong <= DOOR_APPROACH_REACH || startAlong >= total - DOOR_APPROACH_REACH) return;
      let sum = 0;
      for (let i = runStart; i <= endIndex; i += 1) {
        sum += (points[i] as GroundPoint)[runAxis === 'z' ? 0 : 1];
      }
      const line = sum / (endIndex - runStart + 1);
      if (edge.name === 'gate-approach' && runAxis === 'z' && Math.abs(line) < 1) return;
      const anchor = runAxis === 'z' ? plaza.x : plaza.z;
      const off = offLattice(line, anchor);
      if (off <= STREET_LINE_TOLERANCE) return;
      // Threading ground the lattice does not serve: both neighbouring
      // lines must be obstructed over the run's own span for the run to be
      // excused.
      const rem = ((((line - anchor) % pitch) + pitch) % pitch);
      const lower = line - rem;
      const upper = lower + pitch;
      const spanStart = runAxis === 'z' ? a[1] : a[0];
      const spanEnd = runAxis === 'z' ? b[1] : b[0];
      // A neighbouring line is *usable* only when the line itself is clear
      // over the run's span AND the run could actually have joined it — a
      // short perpendicular connector from at least one of the run's own
      // ends must also be clear. A locally-clear line walled off behind a
      // field of rainbow-arch feet (seed 11's rim stall) is not a street
      // this run declined; it is ground the router could never reach.
      const usable = (candidateLine: number): boolean => {
        if (lineBlocked(runAxis, candidateLine, spanStart, spanEnd)) return false;
        const joins: (readonly [number, number, number, number])[] =
          runAxis === 'z'
            ? [
                [line, spanStart, candidateLine, spanStart],
                [line, spanEnd, candidateLine, spanEnd],
              ]
            : [
                [spanStart, line, spanStart, candidateLine],
                [spanEnd, line, spanEnd, candidateLine],
              ];
        return joins.some(([jax, jaz, jbx, jbz]) => {
          const steps = Math.max(1, Math.ceil(Math.hypot(jbx - jax, jbz - jaz) / 1.5));
          for (let s = 0; s <= steps; s += 1) {
            const t = s / steps;
            const x = jax + (jbx - jax) * t;
            const z = jaz + (jbz - jaz) * t;
            for (const foot of ground.archFeet) {
              if (Math.hypot(x - foot.x, z - foot.z) < foot.radius + ARCH_FOOT_REACH) return false;
            }
            if (blockedAt(x, z)) return false;
          }
          return true;
        });
      };
      if (!usable(lower) && !usable(upper)) return;
      found.push({ edge: edge.name, axis: runAxis, length, line, off });
    };
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1] as GroundPoint;
      const b = points[i] as GroundPoint;
      const dx = Math.abs(b[0] - a[0]);
      const dz = Math.abs(b[1] - a[1]);
      const hop = Math.hypot(dx, dz);
      if (hop < 1e-6) continue;
      const hopAxis: 'x' | 'z' | null = dz / hop <= 0.15 ? 'x' : dx / hop <= 0.15 ? 'z' : null;
      if (hopAxis === null || railwayGeometry(a, b)) {
        flush(i - 1);
        continue;
      }
      if (axis === null) {
        axis = hopAxis;
        runStart = i - 1;
      } else if (axis !== hopAxis) {
        flush(i - 1);
        axis = hopAxis;
        runStart = i - 1;
      }
    }
    flush(points.length - 1);
  }
  return found;
}

/** The backbone ring's drawn radius about the plaza — the statue circle's ground. */
export function backboneRadius(
  edges: readonly DrawnEdge[],
  plaza: { readonly x: number; readonly z: number },
): number {
  const backbone = edges.find((edge) => edge.backbone);
  if (!backbone) return 0;
  let sum = 0;
  for (const [x, z] of backbone.points) sum += Math.hypot(x - plaza.x, z - plaza.z);
  return sum / backbone.points.length;
}
