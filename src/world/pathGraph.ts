import { type BufferAttribute, CatmullRomCurve3, Mesh, Vector3 } from 'three';
import {
  PATH_KERB_LIFT,
  PATH_KERB_OVERHANG,
  PATH_SURFACE_LIFT,
} from '../core/constants';
import {
  addPathRibbon,
  GeometryBuilder,
  pathKerbMaterial,
  pathSurfaceMaterial,
} from './pathSurface';
import { terrainHeight } from './terrain';
import { buildGraph, PLAZA, routeCurve, type PathGraph, type RouteDefinition } from './paths';

/**
 * **The one Catmull-Rom every consumer of a route's drawn shape builds.**
 * Re-exported from `paths.ts`, which owns it: see that module's note on why
 * it moved (issue #414 — this file imports `paths.ts`, so while the curve
 * lived here `paths.ts` could not ask what its own routes look like, and
 * answered every geometric question against the control polyline instead).
 */
export { routeCurve };
import { takePrewarmedPathGraph } from './pathsPrewarm';
import { publishPaving } from './paving';

/**
 * **The solved walk network and everything drawn from it.**
 *
 * Split out of `paths.ts` so the *machinery* (the street lattice, the
 * routers, the screens) can be imported without solving anything: this
 * module's own evaluation is what runs the solve, either by taking the graph
 * `boot/parkGeneration.ts` already drove a slice at a time behind the cat
 * bus (`pathsPrewarm.ts` — the crossingPrewarm pattern), or by draining the
 * same generator straight through, which is the path `check:park`,
 * `test:procgen` and every other Node consumer takes. Two cadences, one
 * generator, one order — the sliced boot cannot build a different park.
 */

/** The solved graph — nodes, edges, backbone. One per build, like the park. */
export const PATH_GRAPH: PathGraph = takePrewarmedPathGraph() ?? buildGraph();

/**
 * The ribbons actually drawn — the graph's paved edges. Exported so anything
 * that wants to *draw* the network — the park map — can rebuild the same
 * centreline from the same generated control points.
 */
export const ROUTES: readonly RouteDefinition[] = PATH_GRAPH.edges
  .filter((edge) => edge.paved)
  .map((edge) => edge.route);

/**
 * One straight, grid-axis-aligned stretch of a paved route, long enough to
 * stand a garden wall beside. See {@link pathBorderSegments}.
 */
export interface PathBorderSegment {
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
  /** Half the paved width here — how far the surface itself reaches from the centreline. */
  readonly halfWidth: number;
  /** 0 if this stretch runs along the X axis, PI/2 if along Z. */
  readonly axisYaw: number;
}

/** Shorter than this and a straight stretch is too small to anchor a wall against. */
const MIN_BORDER_SEGMENT_LENGTH = 4;

/**
 * Off a grid axis by more than this fraction of its own length, a control
 * segment does not count as "on axis" — matches the tolerance
 * {@link pathsRunOnGridAxes} (`test/procgen/invariants.ts`) checks the drawn
 * curve against, so a stretch this function calls on-axis is never one that
 * invariant would call diagonal, and vice versa.
 */
const BORDER_OFF_AXIS_FRACTION = 0.05;

let cachedBorderSegments: readonly PathBorderSegment[] | null = null;

/**
 * **Straight, grid-axis-aligned stretches of the paved network** — the same
 * axes the path network itself is built on (issue #269) and the same ones
 * `pathsRunOnGridAxes` polices, read straight off each route's own control
 * points rather than re-derived from the drawn curve.
 *
 * This is the *one* definition of "on the grid" that wall/scenery placement
 * gets to use (CLAUDE.md: "two definitions of one thing, kept in step by
 * hand") — reusing the fact that `paths.ts` already axis-aligns its control
 * points (see `pathsRunOnGridAxes`'s own comment) rather than a second
 * generator inventing its own idea of what counts as on-axis.
 *
 * The closed backbone ring is excluded outright: it is deliberately a true
 * circle round the statue (`ringIsATrueCircleRoundTheStatue`), never
 * axis-aligned, so no stretch of it belongs here — a wall "bordering" the
 * ring would border a curve, not a grid edge.
 *
 * Memoised like `wallPlan` in `Scenery.ts`: the route network is a pure
 * function of the seeded layout, solved once at module load.
 */
export function pathBorderSegments(): readonly PathBorderSegment[] {
  if (cachedBorderSegments) return cachedBorderSegments;
  const segments: PathBorderSegment[] = [];
  for (const route of ROUTES) {
    if (route.closed) continue; // the ring: a true circle, not a grid edge
    const halfWidth = route.width / 2;
    for (let i = 1; i < route.points.length; i += 1) {
      const [x1, z1] = route.points[i - 1]!;
      const [x2, z2] = route.points[i]!;
      const dx = x2 - x1;
      const dz = z2 - z1;
      const length = Math.hypot(dx, dz);
      if (length < MIN_BORDER_SEGMENT_LENGTH) continue;
      const offAxisX = Math.abs(dz) / length; // deviation if this is meant to run along X
      const offAxisZ = Math.abs(dx) / length; // deviation if this is meant to run along Z
      let axisYaw: number;
      if (offAxisX <= BORDER_OFF_AXIS_FRACTION) axisYaw = 0;
      else if (offAxisZ <= BORDER_OFF_AXIS_FRACTION) axisYaw = Math.PI / 2;
      else continue; // a diagonal control segment (a booth's own doorway approach) — not a grid edge
      segments.push({ a: [x1, z1], b: [x2, z2], halfWidth, axisYaw });
    }
  }
  cachedBorderSegments = segments;
  return segments;
}

/** Sampled path centreline, used for scenery placement queries. */
export interface PathSample {
  readonly x: number;
  readonly z: number;
  readonly halfWidth: number;
  /**
   * Which drawn route this sample belongs to — a fresh id per
   * {@link recordSamples} call, i.e. per route curve. Two routes meeting at
   * a shared graph node are spatially contiguous, so a consumer walking
   * this array in order (the railway crossings' spine extraction,
   * `train/crossings.ts`) cannot tell the seam apart by stride alone; a
   * walk that silently continued across one wandered onto a *different*
   * path heading a different way (found live, seed 2: a bridge's spine
   * hair-pinned onto an adjacent route and the bridge's parapets ended up
   * crisscrossing its own roadway).
   */
  readonly run: number;
}

const samples: PathSample[] = [];
let nextRun = 0;

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
 * The two drawn layers, kept so {@link drapePathsOverBridges} can lift the
 * stretches a bridge carries once the bridges exist. Each remembers the lift
 * it was drawn at, because that is what a re-drape has to reapply over the
 * new ground.
 */
interface DrawnLayer {
  readonly mesh: Mesh;
  readonly lift: number;
}
let drawnLayers: DrawnLayer[] = [];

/**
 * Builds the whole path network as two meshes: a cream kerb and the sandy
 * surface sitting a few centimetres proud of it.
 */
export function buildPaths(): Mesh[] {
  samples.length = 0;
  nextRun = 0;

  const surface = new GeometryBuilder();
  const kerb = new GeometryBuilder();

  for (const route of ROUTES) {
    const curve = routeCurve(route);
    const divisions = Math.max(24, Math.round(curve.getLength() / 0.8));
    addPathRibbon(surface, curve, route.width, divisions, PATH_SURFACE_LIFT);
    addRibbonKerb(kerb, curve, route.width, PATH_KERB_OVERHANG, divisions, PATH_KERB_LIFT);
    recordSamples(curve, divisions, route.width / 2);
  }

  addDisc(surface, PLAZA.x, PLAZA.z, PLAZA.radius, 48, 5, PATH_SURFACE_LIFT);
  addAnnulusKerb(kerb, PLAZA.x, PLAZA.z, PLAZA.radius, PLAZA.radius + PATH_KERB_OVERHANG * 2, 48, PATH_KERB_LIFT);

  const surfaceMesh = new Mesh(surface.build(), pathSurfaceMaterial());
  surfaceMesh.name = 'path-surface';
  surfaceMesh.receiveShadow = true;

  const kerbMesh = new Mesh(kerb.build(), pathKerbMaterial());
  kerbMesh.name = 'path-kerb';
  kerbMesh.receiveShadow = true;

  drawnLayers = [
    { mesh: kerbMesh, lift: PATH_KERB_LIFT },
    { mesh: surfaceMesh, lift: PATH_SURFACE_LIFT },
  ];

  // Tell the router where the paving went (issue #416, `world/paving.ts`).
  // The same `samples` and the same `PLAZA` disc `distanceToPath` answers
  // from — read live rather than copied, so a re-drape over a bridge, or a
  // rebuild of the network, cannot leave the router describing paving that
  // has moved. The kerb is deliberately not included: a child walks the
  // surface, and the kerb is the surface's frame.
  publishPaving((sink) => {
    for (const sample of samples) sink(sample.x, sample.z, sample.halfWidth);
    sink(PLAZA.x, PLAZA.z, PLAZA.radius);
  });

  return [kerbMesh, surfaceMesh];
}

/** Half-stride used to read the slope of a bridge's surface for the lifted
 * vertices' normals — small enough to be local, big enough that the smooth
 * hump profile actually changes across it. */
const DRAPE_NORMAL_STEP = 0.35;

/**
 * **Lifts the stretch of the drawn path a bridge carries onto that bridge.**
 *
 * Jim, 2026-08-24: *"the 'floor' on the bridge should be the normal path
 * texture — it should read as a continuous path that goes over a bridge."*
 * It is the normal path texture because it is the normal path: this moves
 * the vertices of the ribbon and kerb {@link buildPaths} already drew, so
 * the material, the tiling, the kerb and the mesh over a bridge are the
 * same ones a metre before its ramp foot, with no second surface to keep in
 * step (CLAUDE.md, "one surface, one texture"). It also stops the ribbon
 * draping *through* the arch, which is the same bug seen from the other
 * side — paths are drawn before the train has solved its loop, so the
 * paving used to lie on the terrain under a bridge that was built over it
 * afterwards.
 *
 * `surfaceAt` is `bridges.ts`'s `bridgePavingHeightAt` bound to the built
 * bridges — `null` on ordinary ground, the hump's own surface where a
 * bridge carries the paving. Called by `World.ts` the moment `ParkTrain`
 * has built its bridges, which is the earliest anything can answer.
 *
 * Normals are re-derived from the surface's own slope rather than left at
 * the terrain's: a hump climbs at up to ~0.56, and a lit ribbon still
 * shaded as though it were flat lawn reads as a decal rather than a road.
 */
export function drapePathsOverBridges(
  surfaceAt: (x: number, z: number) => number | null,
): void {
  for (const { mesh, lift } of drawnLayers) {
    const position = mesh.geometry.getAttribute('position') as BufferAttribute;
    const normal = mesh.geometry.getAttribute('normal') as BufferAttribute;
    let lifted = 0;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const surface = surfaceAt(x, z);
      if (surface === null) continue;
      position.setY(i, surface + lift);
      lifted += 1;
      // Slope of the hump here, by central difference through the same
      // sampler. Off the bridge's own edge the sampler answers `null`, so
      // fall back to the one-sided difference rather than to flat.
      const east = surfaceAt(x + DRAPE_NORMAL_STEP, z) ?? surface;
      const west = surfaceAt(x - DRAPE_NORMAL_STEP, z) ?? surface;
      const north = surfaceAt(x, z + DRAPE_NORMAL_STEP) ?? surface;
      const south = surfaceAt(x, z - DRAPE_NORMAL_STEP) ?? surface;
      const dydx = (east - west) / (2 * DRAPE_NORMAL_STEP);
      const dydz = (north - south) / (2 * DRAPE_NORMAL_STEP);
      const length = Math.hypot(dydx, 1, dydz);
      normal.setXYZ(i, -dydx / length, 1 / length, -dydz / length);
    }
    if (lifted === 0) continue;
    position.needsUpdate = true;
    normal.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
  }
}

// ---------------------------------------------------------------- internals


function recordSamples(curve: CatmullRomCurve3, divisions: number, halfWidth: number): void {
  const point = new Vector3();
  const run = nextRun;
  nextRun += 1;
  for (let i = 0; i <= divisions; i += 1) {
    curve.getPoint(i / divisions, point);
    samples.push({ x: point.x, z: point.z, halfWidth, run });
  }
}

/** Sweeps a flat ribbon of `width` along the curve, draped onto the terrain. */
/**
 * **The kerb, as the two bands you can actually see.**
 *
 * `ART_DIRECTION.md` §7: delete the hidden face, never hold two surfaces apart
 * with an offset. The kerb used to be a full-width ribbon laid `PATH_KERB_LIFT`
 * (0.03 m) under a `PATH_SURFACE_LIFT` (0.055 m) surface ribbon that is only
 * `PATH_KERB_OVERHANG` narrower each side — so every square metre of it except
 * two 0.425 m bands was **buried under the path**, sharing a plane with it, held
 * apart by 25 mm that somebody has to maintain. `check:coplanar` scored the pair
 * at **3.99 m² of shared plane**, the largest garden seam in its whole baseline.
 *
 * Only the bands are drawn now. Nothing changes on screen: the deleted middle
 * was never visible from any camera, being flat under an opaque surface at the
 * same drape. What changes is that there is no longer a stand-off to maintain,
 * and the seam leaves the ratchet rather than sitting in it forever.
 *
 * Found by #481, which does not touch paths: moving pool seed 288's railway
 * moved its bridges, `drapePathsOverBridges` lifted different stretches, and the
 * same two ribbons came to share a plane at five facings instead of one. The
 * ratchet reported it as worse. It was not worse — it was the same buried face
 * seen from more angles, which is what a buried face does when the park moves.
 */
function addRibbonKerb(
  builder: GeometryBuilder,
  curve: CatmullRomCurve3,
  width: number,
  overhang: number,
  divisions: number,
  lift: number,
): void {
  // Inner edge exactly where the surface's own edge falls: both ribbons walk
  // the same curve at the same `divisions`, so the two edges share their
  // stations and there is no hairline between them to fill.
  addRibbonBand(builder, curve, width / 2, width / 2 + overhang, divisions, lift);
  addRibbonBand(builder, curve, -width / 2 - overhang, -width / 2, divisions, lift);
}

/** One band of a ribbon, between two signed offsets from its centre line. */
function addRibbonBand(
  builder: GeometryBuilder,
  curve: CatmullRomCurve3,
  fromOffset: number,
  toOffset: number,
  divisions: number,
  lift: number,
): void {
  const point = new Vector3();
  const tangent = new Vector3();
  let travelled = 0;
  let previousX = 0;
  let previousZ = 0;

  for (let i = 0; i <= divisions; i += 1) {
    const t = i / divisions;
    curve.getPoint(t, point);
    curve.getTangent(t, tangent);
    const nx = -tangent.z;
    const nz = tangent.x;
    const length = Math.hypot(nx, nz) || 1;

    if (i > 0) travelled += Math.hypot(point.x - previousX, point.z - previousZ);
    previousX = point.x;
    previousZ = point.z;

    const ax = point.x + (nx / length) * fromOffset;
    const az = point.z + (nz / length) * fromOffset;
    const bx = point.x + (nx / length) * toOffset;
    const bz = point.z + (nz / length) * toOffset;

    // Same winding rule as `addRibbon`: the lower offset first, so the quads
    // wind anticlockwise seen from above and the band faces the sky.
    const v = travelled / Math.max(1, toOffset - fromOffset);
    builder.vertex(ax, terrainHeight(ax, az) + lift, az, 0, v);
    builder.vertex(bx, terrainHeight(bx, bz) + lift, bz, 1, v);

    if (i > 0) {
      const base = builder.vertexCount - 4;
      builder.quad(base, base + 1, base + 2, base + 3);
    }
  }
}

/** The plaza's kerb: the same idea round a disc, so its middle is not buried. */
function addAnnulusKerb(
  builder: GeometryBuilder,
  cx: number,
  cz: number,
  innerRadius: number,
  outerRadius: number,
  segments: number,
  lift: number,
): void {
  const first = builder.vertexCount;
  for (let r = 0; r <= 1; r += 1) {
    const radiusAt = r === 0 ? innerRadius : outerRadius;
    for (let s = 0; s <= segments; s += 1) {
      const angle = (s / segments) * Math.PI * 2;
      const x = cx + Math.cos(angle) * radiusAt;
      const z = cz + Math.sin(angle) * radiusAt;
      builder.vertex(x, terrainHeight(x, z) + lift, z, x / 6, z / 6);
    }
  }
  const stride = segments + 1;
  for (let s = 0; s < segments; s += 1) {
    const a = first + s;
    builder.quad(a, a + 1, a + stride, a + stride + 1);
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

