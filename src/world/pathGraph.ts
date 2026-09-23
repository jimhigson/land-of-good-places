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
import {
  curvePoints,
  pathDivisions,
  PLAZA,
  routeCurve,
  type PathGraph,
  type RouteDefinition,
} from './paths';

/**
 * **The one Catmull-Rom every consumer of a route's drawn shape builds.**
 * Re-exported from `paths.ts`, which owns it: see that module's note on why
 * it moved (issue #414 — this file imports `paths.ts`, so while the curve
 * lived here `paths.ts` could not ask what its own routes look like, and
 * answered every geometric question against the control polyline instead).
 */
export { routeCurve };
import { lazyArrayView, lazyView } from '../boot/lazyView';
import { registerPlanCache } from '../boot/planCaches';
import { planPart } from './parkPlan';
import { publishDrawnPath, publishPaving } from './paving';

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
/** A view: the park's driver decides the graph, and may re-decide it. */
export const PATH_GRAPH: PathGraph = lazyView(() => planPart('pathGraph'));

/**
 * The ribbons actually drawn — the graph's paved edges. Exported so anything
 * that wants to *draw* the network — the park map — can rebuild the same
 * centreline from the same generated control points.
 */
let routesMemo: readonly RouteDefinition[] | null = null;
export const ROUTES: readonly RouteDefinition[] = lazyArrayView(
  () =>
    (routesMemo ??= planPart('pathGraph')
      .edges.filter((edge) => edge.paved)
      .map((edge) => edge.route)),
);
registerPlanCache(() => {
  routesMemo = null;
});

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

  // The surface first, every route of it, so each kerb can be drawn knowing
  // where every *other* route's paving lies over it — see `KerbCover`.
  const cover = new KerbCover();
  const drawn = ROUTES.map((route, owner) => {
    const curve = routeCurve(route);
    const divisions = pathDivisions(curve);
    cover.add(owner, addPathRibbon(surface, curve, route.width, divisions, PATH_SURFACE_LIFT));
    recordSamples(curve, divisions, route.width / 2);
    return { route, curve, divisions };
  });
  cover.add(PLAZA_OWNER, [addDisc(surface, PLAZA.x, PLAZA.z, PLAZA.radius, 48, 5, PATH_SURFACE_LIFT)]);

  drawn.forEach(({ route, curve, divisions }, owner) => {
    addRibbonKerb(kerb, curve, route.width, PATH_KERB_OVERHANG, divisions, PATH_KERB_LIFT, cover.drawerFor(owner));
  });
  addAnnulusKerb(
    kerb,
    PLAZA.x,
    PLAZA.z,
    PLAZA.radius,
    PLAZA.radius + PATH_KERB_OVERHANG * 2,
    48,
    PATH_KERB_LIFT,
    cover.drawerFor(PLAZA_OWNER),
  );

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

  // **And where those two surfaces were actually drawn** (`world/paving.ts`),
  // which is a different question from the one above and has to be answered
  // from the strip *between* samples rather than from discs *at* them.
  //
  // The discs published to the router pinch in between consecutive samples,
  // while the ribbon drawn from those same samples runs straight across — so a
  // surface laid up against the disc union laps over the drawn ribbon in the
  // scallops. Measured, that is 67% of the gateway path's seam against
  // `path-surface`. The kerb is worse: it is deliberately absent from the disc
  // list, so a caller could only approximate it by adding a margin to the
  // surface, and both of the gateway path's kerb seams were **entirely** on
  // ground the discs called clear.
  //
  // Segment-wise, so the answer is the swept strip itself. Consecutive samples
  // in one `run` are adjacent cross-sections of one ribbon; samples either side
  // of a `run` boundary belong to different routes and are not joined. A
  // capsule can only ever *overstate* the trapezoid drawn between two
  // cross-sections (it rounds the ends the strip cuts square), and overstating
  // is the safe direction here: a caller stops a hair early and leaves nothing
  // behind, where understating puts two surfaces in one plane.
  publishDrawnPath((x, z, layer) => {
    const overhang = layer === 'kerb' ? PATH_KERB_OVERHANG : 0;
    // The plaza's kerb is an annulus drawn out to `radius + OVERHANG * 2`, not
    // one overhang — read from the same expression that draws it above rather
    // than assuming the ribbons' reach applies here too.
    const plazaReach = PLAZA.radius + (layer === 'kerb' ? PATH_KERB_OVERHANG * 2 : 0);
    if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < plazaReach) return true;
    for (let i = 1; i < samples.length; i += 1) {
      const a = samples[i - 1] as PathSample;
      const b = samples[i] as PathSample;
      if (a.run !== b.run) continue;
      if (distanceToSegment(x, z, a.x, a.z, b.x, b.z) < a.halfWidth + overhang) return true;
    }
    return false;
  });

  return [kerbMesh, surfaceMesh];
}

/** Distance from a point to a line segment, in the ground plane. */
function distanceToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  // A zero-length segment — two samples on top of one another, which a curve
  // with a stationary point can produce — degenerates to its own endpoint
  // rather than dividing by zero and answering `NaN`. `NaN < r` is false, so
  // the surface would silently read as clear: this repo's own worked example
  // of a check that cannot fail.
  if (lengthSquared === 0) return Math.hypot(x - ax, z - az);
  let t = ((x - ax) * dx + (z - az) * dz) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
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
  const run = nextRun;
  nextRun += 1;
  for (const sample of sampleCurve(curve, divisions, halfWidth, run)) samples.push(sample);
}

/**
 * **How finely a route's curve is drawn — the one owner.**
 *
 * `buildPaths` uses it to divide the ribbon, the kerb and the samples, and the
 * generator's commit-time crossing screen uses it to reproduce exactly the
 * samples the drawing will lay down. A second `max(24, len / 0.8)` written
 * beside either would be two definitions of "how smooth is a path", and it
 * would drift the first time anybody tuned smoothness — with the screen then
 * measuring a slightly different curve from the one drawn, which is the whole
 * disease this work exists to remove, one level down.
 */
// `pathDivisions` and `curvePoints` live in `paths.ts`, beside `routeCurve`.
// They moved there so the ROUTER can reproduce the drawn geometry before it
// commits a decision — `crossings.ts` imports this file, so anything the router
// needs cannot live here without a cycle. That import direction is exactly why
// the crossing check could only ever run after the graph was published.

/**
 * The samples a curve lays down when it is drawn — **post fillet and
 * Catmull-Rom**, which is the geometry a child actually walks and the only
 * geometry worth asking the railway about. The control polyline is not this.
 */
function sampleCurve(
  curve: CatmullRomCurve3,
  divisions: number,
  halfWidth: number,
  run: number,
): PathSample[] {
  return curvePoints(curve, divisions).map((p) => ({ x: p.x, z: p.z, halfWidth, run }));
}

/**
 * **The drawn samples a candidate set of routes would produce, without drawing
 * anything.**
 *
 * The generator's `pathGraph` task needs the drawn geometry *before* it commits
 * a graph, and a reviewer's first question is reasonably "how can you have
 * drawn samples before anything is drawn". The answer is that **the drawing is
 * a pure function of the graph**: `buildPaths` derives `ROUTES` from
 * `PATH_GRAPH.edges`, turns each into a curve with {@link routeCurve}, and
 * samples it at {@link pathDivisions}. Given the candidate edges, the same
 * three steps give the same samples — so this shares those steps rather than
 * restating them.
 */
export function drawnSamplesFor(routes: readonly RouteDefinition[]): PathSample[] {
  const out: PathSample[] = [];
  let run = 0;
  for (const route of routes) {
    const curve = routeCurve(route);
    for (const sample of sampleCurve(curve, pathDivisions(curve), route.width / 2, run)) {
      out.push(sample);
    }
    run += 1;
  }
  return out;
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
  draw: KerbQuad,
): void {
  // Inner edge exactly where the surface's own edge falls: both ribbons walk
  // the same curve at the same `divisions`, so the two edges share their
  // stations and there is no hairline between them to fill.
  addRibbonBand(builder, curve, width / 2, width / 2 + overhang, divisions, lift, draw);
  addRibbonBand(builder, curve, -width / 2 - overhang, -width / 2, divisions, lift, draw);
}

/** One band of a ribbon, between two signed offsets from its centre line. */
function addRibbonBand(
  builder: GeometryBuilder,
  curve: CatmullRomCurve3,
  fromOffset: number,
  toOffset: number,
  divisions: number,
  lift: number,
  draw: KerbQuad,
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
      draw(builder, base, base + 1, base + 2, base + 3);
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
  draw: KerbQuad,
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
    draw(builder, a, a + 1, a + stride, a + stride + 1);
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
): PlanPolygon {
  const first = builder.vertexCount;
  /** The outer ring, in plan — the disc's whole footprint, convex. */
  const outline: [number, number][] = [];
  for (let r = 0; r <= rings; r += 1) {
    const radiusAt = (r / rings) * radius;
    for (let s = 0; s <= segments; s += 1) {
      const angle = (s / segments) * Math.PI * 2;
      const x = cx + Math.cos(angle) * radiusAt;
      const z = cz + Math.sin(angle) * radiusAt;
      builder.vertex(x, terrainHeight(x, z) + lift, z, x / 6, z / 6);
      if (r === rings && s < segments) outline.push([x, z]);
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
  return outline;
}

// ------------------------------------------------------ the kerb's cover

/** A convex polygon in plan, `(x, z)` corners in order. */
type PlanPolygon = readonly (readonly [number, number])[];

/** How a kerb quad is handed over to be drawn: `quad`'s own (a, b) (c, d). */
type KerbQuad = (builder: GeometryBuilder, a: number, b: number, c: number, d: number) => void;

/** The owner id the plaza's disc and annulus are filed under. */
const PLAZA_OWNER = -1;

/** Pieces smaller than this in plan are dropped, m². A kerb sliver this thin is float noise. */
const KERB_SLIVER_AREA = 1e-6;

/**
 * **Where the paving lies over the kerb, so the kerb is not drawn there.**
 *
 * Each route's kerb is two bands along its own edges, and at a junction those
 * bands run on under the *other* route's surface, 25 mm down. That is a buried
 * face, and it was only invisible while 25 mm stayed 25 mm. Over a bridge the
 * drape lifts both layers vertex by vertex, and the triangles that straddle
 * the bridge's edge turn into steep ramps between deck and ground — two
 * routes' ramps meeting at a junction there come out within a centimetre of
 * one plane, same way up. `check:coplanar`: `path-kerb|path-surface`, 0.651 m²
 * at 7.7 mm on seed 24 and 0.200 m² at 9.9 mm on the canonical seed, both at
 * junctions on bridges. `ART_DIRECTION.md` §7's cure is to delete the face
 * nobody can see, which also means there is no gap left for a slope to eat.
 *
 * So the surface is drawn first, every triangle of it filed here by the route
 * that laid it, and a kerb triangle that other routes' paving covers
 * **entirely** is not drawn. Covered is an exact polygon difference in plan,
 * never a distance test, because a capsule round the centreline overstates the
 * ribbon and would cut kerb a child can see. A route's own surface is never
 * subtracted from its own kerb: the two share an edge by construction.
 *
 * **Whole triangles only, deliberately.** Cutting a partly covered triangle
 * down to its uncovered part was tried first and is worse: the pieces are
 * small, and `check:coplanar` measures a pair of triangles by their furthest
 * vertices, so small pieces of kerb that were always within a few millimetres
 * of the coarse terrain mesh became findings that the whole triangle had
 * hidden — 0.755 m² of `path-kerb|terrain` at 2 mm on seed 11, and a bridge's
 * shell on seed 128. Those are real, and they are the terrain mesh's chords,
 * not this. Dropping only whole triangles cannot make any remaining pair
 * closer than it was, and on the canonical seed and seeds 11, 24 and 128 it
 * clears every `path-kerb` finding. The partly covered triangles keep their
 * buried share, 25 mm down, where it was harmless before a slope got to it.
 * Vertices are still laid for a dropped triangle — only its index goes — so
 * every per-vertex measure of the kerb (the bridge-carrying invariant counts
 * them) is unchanged.
 */
class KerbCover {
  private readonly polygons: { owner: number; polygon: PlanPolygon; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  private readonly grid = new Map<string, number[]>();

  add(owner: number, polygons: readonly PlanPolygon[]): void {
    for (const polygon of polygons) {
      const xs = polygon.map((p) => p[0]);
      const zs = polygon.map((p) => p[1]);
      const entry = {
        owner,
        polygon,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minZ: Math.min(...zs),
        maxZ: Math.max(...zs),
      };
      const id = this.polygons.push(entry) - 1;
      for (const key of cellsOf(entry.minX, entry.maxX, entry.minZ, entry.maxZ)) {
        const list = this.grid.get(key);
        if (list) list.push(id);
        else this.grid.set(key, [id]);
      }
    }
  }

  /** The {@link KerbQuad} for one owner's kerb. */
  drawerFor(owner: number): KerbQuad {
    return (builder, a, b, c, d) => {
      // `quad`'s own split, so an uncut quad is exactly what it always was.
      this.triangle(builder, owner, a, b, c);
      this.triangle(builder, owner, b, d, c);
    };
  }

  private triangle(builder: GeometryBuilder, owner: number, i0: number, i1: number, i2: number): void {
    const plan = [i0, i1, i2].map((index) => {
      const { x, z } = builder.vertexAt(index);
      return [x, z] as [number, number];
    });
    const minX = Math.min(...plan.map((p) => p[0]));
    const maxX = Math.max(...plan.map((p) => p[0]));
    const minZ = Math.min(...plan.map((p) => p[1]));
    const maxZ = Math.max(...plan.map((p) => p[1]));

    // What of this triangle no other route's paving covers, as convex pieces.
    const seen = new Set<number>();
    let uncovered: [number, number][][] = [plan];
    for (const key of cellsOf(minX, maxX, minZ, maxZ)) {
      for (const id of this.grid.get(key) ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        const cover = this.polygons[id]!;
        if (cover.owner === owner) continue;
        if (cover.maxX <= minX || cover.minX >= maxX || cover.maxZ <= minZ || cover.minZ >= maxZ) continue;
        uncovered = uncovered.flatMap((piece) => subtractConvex(piece, cover.polygon) ?? [piece]);
        if (uncovered.length === 0) return; // buried whole: not drawn
      }
    }
    builder.triangle(i0, i1, i2);
  }
}

/** Grid cell side for {@link KerbCover}'s lookup, metres. */
const KERB_COVER_CELL = 4;

function cellsOf(minX: number, maxX: number, minZ: number, maxZ: number): string[] {
  const keys: string[] = [];
  for (let i = Math.floor(minX / KERB_COVER_CELL); i <= Math.floor(maxX / KERB_COVER_CELL); i += 1) {
    for (let j = Math.floor(minZ / KERB_COVER_CELL); j <= Math.floor(maxZ / KERB_COVER_CELL); j += 1) {
      keys.push(`${i},${j}`);
    }
  }
  return keys;
}

function signedArea(polygon: readonly (readonly [number, number])[]): number {
  let area = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const [ax, az] = polygon[i]!;
    const [bx, bz] = polygon[(i + 1) % polygon.length]!;
    area += ax * bz - bx * az;
  }
  return area / 2;
}

/**
 * `piece` minus the convex `cover`, as convex pieces in `piece`'s own winding
 * — or `null` if the cover takes nothing measurable from it.
 *
 * The standard split: walking the cover's edges, whatever of the piece lies
 * outside edge *k* but inside edges *0..k-1* is one piece of the answer, and
 * whatever is inside every edge is the part covered.
 */
function subtractConvex(
  piece: readonly [number, number][],
  cover: PlanPolygon,
): [number, number][][] | null {
  const orientation = Math.sign(signedArea(cover));
  if (orientation === 0) return null;
  const out: [number, number][][] = [];
  let rest: [number, number][] = [...piece];
  for (let k = 0; k < cover.length && rest.length >= 3; k += 1) {
    const [ax, az] = cover[k]!;
    const [bx, bz] = cover[(k + 1) % cover.length]!;
    // > 0 inside this edge's half-plane, for either winding of the cover.
    const side = ([x, z]: [number, number]): number =>
      orientation * ((bx - ax) * (z - az) - (bz - az) * (x - ax));
    const outside = clipToSide(rest, (p) => -side(p));
    if (outside.length >= 3 && Math.abs(signedArea(outside)) >= KERB_SLIVER_AREA) out.push(outside);
    rest = clipToSide(rest, side);
  }
  if (rest.length < 3 || Math.abs(signedArea(rest)) < KERB_SLIVER_AREA) return null;
  return out;
}

/** Sutherland–Hodgman against one half-plane: keeps where `side(p) >= 0`. */
function clipToSide(
  polygon: readonly [number, number][],
  side: (p: [number, number]) => number,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % polygon.length]!;
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) {
      const t = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

// Derived from a decision the park's driver may unwind: forgotten with it.
registerPlanCache(() => {
  cachedBorderSegments = null;
  drawnLayers = [];
  nextRun = 0;
});
