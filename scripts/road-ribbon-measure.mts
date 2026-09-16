/**
 * **Does the road's claim describe the road that was drawn?** — the one
 * measurement, so that the two places that ask get the same answer.
 *
 * `scripts/check-ground-claims.mts` asks it on the canonical seed, after
 * driving a real `ParkGeneration` and a real `World`; `test/procgen/
 * invariants.ts` asks it on every seed in the pool, where issue #510's whole
 * point is that a canonical-seed-only check leaves fifteen parks unmeasured.
 * Written twice it would be two definitions of one question, which is the bug
 * this repo pays for most often — so it is written here once and imported.
 *
 * ## Why this is not a bounding-box comparison any more
 *
 * It used to be. When the road was two axis-aligned runs, "the claim is the
 * ribbon" could be settled by comparing four numbers: the mesh's min/max in x
 * and z against the capsule swept by its half-width. #498's curved road ended
 * that. **The bounding box of an arc is mostly ground the arc does not hold**,
 * so a box comparison on a curve is not merely imprecise, it is measuring a
 * different shape — and it would have gone on passing while saying so.
 *
 * What replaces it is the question a placer actually asks, put to the geometry
 * a child actually walks on: **for every vertex of every ribbon the road drew,
 * is that point on ground the registry claims?** ({@link distanceOutside} is
 * the one owner of "on".) That is exact for a curve and for a straight run
 * alike, and it does not care how many runs the arc was sampled into.
 *
 * ## The two directions, and why only one of them is an equality
 *
 * - **Nothing drawn is unclaimed** — every ribbon vertex lies inside some run
 *   of the corridor. This is the safety-critical direction and it is asserted
 *   exactly (to `float32`): ground the road occupies but does not claim is
 *   ground a later placer will happily put a tree on.
 * - **Nothing claimed is undrawn** — each run has ribbon beside it. This one
 *   is deliberately **not** an equality, because the gateway approach's claim
 *   is honestly a conservative envelope: `Entrance.ts` trims each 15 cm column
 *   of it back individually against whatever surface that column would
 *   otherwise lie on, so the drawn end is a staircase inside the claimed
 *   rectangle. Asserting equality there would be asserting something the
 *   design does not promise. What is asserted is that every run is *backed* by
 *   drawing at its midpoint; how far the claim overshoots at the ends is
 *   **reported as a number on every run** rather than bounded, so drift shows
 *   up as the number moving long before anyone has to pick a threshold.
 *
 * The `float32` slack is not a tuned tolerance: mesh positions are a
 * `Float32Array` and cannot carry the owner's `float64`, so a metre read back
 * off geometry is good to about seven significant digits.
 */
import { distanceOutside, type Claim } from '../src/boot/groundClaims.ts';
import type { RoadSegment } from '../src/world/entrance/roadCorridor.ts';

/**
 * The one tolerance here, and it is a property of the mesh format rather than
 * a number anybody chose: `float32` positions against `float64` claims.
 */
export const FLOAT32_SLACK = 1e-3;

/** A point in plan. */
export interface PlanPoint {
  readonly x: number;
  readonly z: number;
}

/** One drawn ribbon: the mesh's name and its world-space vertices in plan. */
export interface DrawnRibbon {
  readonly name: string;
  readonly points: readonly PlanPoint[];
}

/** What {@link measureRoadRibbons} found. Every field is meant to be printed. */
export interface RoadRibbonMeasurement {
  /** Things that are wrong. Empty is the only passing value. */
  readonly fouls: readonly string[];
  /** How many runs of centreline had drawn geometry to measure against. */
  readonly runsMeasured: number;
  /** How many ribbon vertices were tested. Zero here means nothing was proved. */
  readonly verticesTested: number;
  /** The furthest any drawn vertex lay outside every claim, in metres. */
  readonly worstOutside: number;
  readonly worstOutsideNote: string;
  /**
   * The furthest a run's own endpoint lay from the nearest drawn vertex, over
   * and above its half-width — i.e. how far the claim reaches past the ribbon.
   * Reported, never thresholded: see the header.
   */
  readonly worstOvershoot: number;
  readonly worstOvershootNote: string;
}

/**
 * Which drawn meshes belong to a run of the corridor.
 *
 * A run names the ribbon it is part of, and a ribbon may be drawn as more than
 * one mesh: the gateway approach is a surface band plus its two kerb bands
 * (`entrance-gateway-path`, `…-kerb-left`, `…-kerb-right`), because a
 * full-width kerb slab under an opaque surface is a coplanar seam. All three
 * are the same claimed ground, so all three are measured against it.
 */
export const ribbonBelongsToRun = (meshName: string, runName: string): boolean =>
  meshName === runName || meshName.startsWith(`${runName}-`);

/**
 * Pull every ribbon the road drew out of a scene graph, in plan and in world
 * space. Given a three.js `Object3D` (the entrance's group, or the whole
 * scene); the caller is responsible for having called `updateMatrixWorld`.
 */
export const collectRoadRibbons = (
  root: {
    traverse: (visit: (object: Object3DLike) => void) => void;
  },
  segments: readonly RoadSegment[],
): DrawnRibbon[] => {
  const wanted = [...new Set(segments.map((segment) => segment.name))];
  const found: DrawnRibbon[] = [];
  root.traverse((object) => {
    if (!wanted.some((name) => ribbonBelongsToRun(object.name, name))) return;
    const geometry = object.geometry;
    if (!geometry) return;
    const position = geometry.getAttribute('position');
    if (!position) return;
    const points: PlanPoint[] = [];
    for (let i = 0; i < position.count; i += 1) {
      // The road's ribbons are built in world space and hung on groups at the
      // origin, so a local read is a world read — but say it with the matrix
      // rather than trusting that, because a group that moves would otherwise
      // make every number here quietly wrong.
      const x = position.getX(i);
      const z = position.getZ(i);
      const y = position.getY(i);
      const m = object.matrixWorld?.elements;
      points.push(
        m
          ? {
              x: (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
              z: (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
            }
          : { x, z },
      );
    }
    found.push({ name: object.name, points });
  });
  return found;
};

/** The slice of three.js this file reads. Structural, so no import of it. */
interface Object3DLike {
  readonly name: string;
  readonly geometry?: {
    getAttribute: (name: string) =>
      | { readonly count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number }
      | undefined;
  };
  readonly matrixWorld?: { readonly elements: ArrayLike<number> };
}

/**
 * Measure the corridor's claims against the ribbons that were drawn.
 *
 * `claims` and `segments` are index-matched — `entranceRoadClaims()` maps one
 * to one over `entranceRoadSegments()` — which is how a run is paired with its
 * claim without guessing an axis off the numbers. A geometric guess stops
 * finding the right run the moment anything moves, which is exactly when the
 * measurement matters most.
 */
export const measureRoadRibbons = (
  segments: readonly RoadSegment[],
  claims: readonly Claim[],
  ribbons: readonly DrawnRibbon[],
): RoadRibbonMeasurement => {
  const fouls: string[] = [];

  if (claims.length !== segments.length) {
    fouls.push(
      `the registry holds ${claims.length} corridor run(s) and the owner produces ` +
        `${segments.length} — they no longer describe the same road, so nothing below could be ` +
        'paired up honestly',
    );
    return {
      fouls,
      runsMeasured: 0,
      verticesTested: 0,
      worstOutside: 0,
      worstOutsideNote: 'not measured — run counts disagree',
      worstOvershoot: 0,
      worstOvershootNote: 'not measured — run counts disagree',
    };
  }

  // --- nothing drawn is unclaimed ------------------------------------------
  let verticesTested = 0;
  let worstOutside = -Infinity;
  let worstOutsideNote = 'nothing measured';
  const shapes = claims.map((claim) => claim.shape);
  const reported = new Set<string>();
  for (const ribbon of ribbons) {
    for (const point of ribbon.points) {
      verticesTested += 1;
      let outside = Infinity;
      for (const shape of shapes) {
        outside = Math.min(outside, distanceOutside(point.x, point.z, shape));
        if (outside <= 0) break;
      }
      if (outside > worstOutside) {
        worstOutside = outside;
        worstOutsideNote =
          `"${ribbon.name}" at (${point.x.toFixed(3)}, ${point.z.toFixed(3)})` +
          `, ${outside.toExponential(2)} m outside the nearest claim`;
      }
      if (outside > FLOAT32_SLACK && !reported.has(ribbon.name)) {
        reported.add(ribbon.name);
        fouls.push(
          `the road was drawn on ground it does not claim — "${ribbon.name}" has a vertex at ` +
            `(${point.x.toFixed(3)}, ${point.z.toFixed(3)}) lying ${outside.toFixed(4)} m outside ` +
            'every run of the corridor. A child walks on the mesh; every later placer negotiates ' +
            'against the claim, so this is ground a tree may be planted in',
        );
      }
    }
  }

  // --- nothing claimed is undrawn ------------------------------------------
  let runsMeasured = 0;
  let worstOvershoot = -Infinity;
  let worstOvershootNote = 'nothing measured';
  for (const [index, segment] of segments.entries()) {
    const shape = claims[index]?.shape;
    if (shape?.shape !== 'capsule') {
      fouls.push(
        `run ${index} ("${segment.name}") is claimed as a ${shape?.shape ?? 'missing'} rather ` +
          'than a capsule — a run of road is a swept segment, and the pairing with the owner is ' +
          'no longer meaningful',
      );
      continue;
    }
    const mine = ribbons.filter((ribbon) => ribbonBelongsToRun(ribbon.name, segment.name));
    if (mine.length === 0) {
      fouls.push(
        `the registry claims a corridor run for "${segment.name}" but no such ribbon is in the ` +
          'scene — the claim describes a road nobody drew',
      );
      continue;
    }
    const nearestVertex = (px: number, pz: number): number => {
      let best = Infinity;
      for (const ribbon of mine) {
        for (const point of ribbon.points) {
          best = Math.min(best, Math.hypot(point.x - px, point.z - pz));
        }
      }
      return best;
    };
    const midX = (segment.from.x + segment.to.x) / 2;
    const midZ = (segment.from.z + segment.to.z) / 2;
    const atMid = nearestVertex(midX, midZ);
    if (atMid > segment.halfWidth + FLOAT32_SLACK) {
      fouls.push(
        `the corridor's run ${index} of "${segment.name}" claims ground with no ribbon on it — ` +
          `its midpoint (${midX.toFixed(2)}, ${midZ.toFixed(2)}) is ${atMid.toFixed(3)} m from ` +
          `the nearest drawn vertex, further than its own half-width ${segment.halfWidth.toFixed(3)}`,
      );
      continue;
    }
    runsMeasured += 1;
    for (const [end, point] of [
      ['from', segment.from],
      ['to', segment.to],
    ] as const) {
      const overshoot = nearestVertex(point.x, point.z) - segment.halfWidth;
      if (overshoot > worstOvershoot) {
        worstOvershoot = overshoot;
        worstOvershootNote = `"${segment.name}" run ${index} ${end} end, ${overshoot.toFixed(3)} m past the ribbon`;
      }
    }
  }

  return {
    fouls,
    runsMeasured,
    verticesTested,
    worstOutside: Number.isFinite(worstOutside) ? worstOutside : 0,
    worstOutsideNote,
    worstOvershoot: Number.isFinite(worstOvershoot) ? worstOvershoot : 0,
    worstOvershootNote,
  };
};
