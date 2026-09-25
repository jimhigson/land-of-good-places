import { type BufferAttribute, CatmullRomCurve3, Mesh } from 'three';
import {
  PATH_KERB_LIFT,
  PATH_KERB_OVERHANG,
  PATH_SURFACE_LIFT,
} from '../core/constants';
import {
  addPathRibbon,
  addRibbonStrip,
  GeometryBuilder,
  pathKerbMaterial,
  pathCrossSection,
  pathSurfaceMaterial,
  ribbonEdges,
  ribbonStations,
} from './pathSurface';
import { terrainHeight } from './terrain';
import { CAMERA_PITCH_DEGREES, CAMERA_YAW_DEGREES } from '../core/constants';
import { cameraOffset } from '../core/cameraRig';
import { DEG } from '../core/mathUtils';
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
/** Decides which kerb triangles are buried — rebuilt with the paths, re-asked after a drape. */
let kerbCover: KerbCover | null = null;

/**
 * Builds the whole path network as two meshes: a cream kerb and the sandy
 * surface sitting a few centimetres proud of it.
 */
export function buildPaths(): Mesh[] {
  samples.length = 0;
  nextRun = 0;

  const surface = new GeometryBuilder();
  const kerb = new GeometryBuilder();

  // Every triangle of paving is filed by the route that laid it, so the kerb
  // can later leave out what another route's paving buries — see `KerbCover`.
  const surfaceOwners: number[] = [];
  const kerbOwners: number[] = [];
  const own = (list: number[], builder: GeometryBuilder, owner: number): void => {
    while (list.length < builder.triangleCount) list.push(owner);
  };
  ROUTES.forEach((route, owner) => {
    const curve = routeCurve(route);
    const divisions = pathDivisions(curve);
    addPathRibbon(surface, curve, route.width, divisions, PATH_SURFACE_LIFT);
    own(surfaceOwners, surface, owner);
    addRibbonKerb(kerb, curve, route.width, PATH_KERB_OVERHANG, divisions, PATH_KERB_LIFT);
    own(kerbOwners, kerb, owner);
    recordSamples(curve, divisions, route.width / 2);
  });

  addDisc(surface, PLAZA.x, PLAZA.z, PLAZA.radius, 48, 5, PATH_SURFACE_LIFT);
  own(surfaceOwners, surface, PLAZA_OWNER);
  addAnnulusKerb(kerb, PLAZA.x, PLAZA.z, PLAZA.radius, PLAZA.radius + PATH_KERB_OVERHANG * 2, 48, PATH_KERB_LIFT);
  own(kerbOwners, kerb, PLAZA_OWNER);

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
  kerbCover = new KerbCover(surface, surfaceOwners, kerb, kerbOwners, kerbMesh, surfaceMesh);
  kerbCover.apply();

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
  // The drape moves paving and kerb apart in height, so what is buried has to
  // be asked again of the heights as they now stand.
  kerbCover?.apply();
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
  // Inner edge exactly where the surface's own edge falls: both are swept from
  // one cross-section (`pathCrossSection`) by one call, so the two edges are
  // one line — trimmed at a tight corner identically — with no hairline
  // between them to fill.
  const stations = ribbonStations(curve, divisions);
  const [outerRight, right, left, outerLeft] = ribbonEdges(stations, pathCrossSection(width));
  const vAt = (travelled: number): number => travelled / Math.max(1, overhang);
  addRibbonStrip(builder, stations, left!, outerLeft!, lift, vAt);
  addRibbonStrip(builder, stations, outerRight!, right!, lift, vAt);
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

// ------------------------------------------------------ the kerb's cover

/** A convex polygon in plan, `(x, z)` corners in order. */
type PlanPolygon = readonly (readonly [number, number])[];

/** The owner id the plaza's disc and annulus are filed under. */
const PLAZA_OWNER = -1;

/** Pieces smaller than this in plan are dropped, m². A kerb sliver this thin is float noise. */
const KERB_SLIVER_AREA = 1e-6;

/**
 * **How far above the kerb paving may lie and still bury it**, metres: twice
 * the drawn difference between the two lifts (`PATH_SURFACE_LIFT -
 * PATH_KERB_LIFT`, 25 mm).
 *
 * Buried means *laid on top of it*, not *somewhere above it*. The paving is a
 * ribbon with no thickness and no skirt, so kerb under it is hidden only where
 * the gap is too thin to see into from the one camera: at its ~38° elevation a
 * gap of `h` shows kerb up to `h / tan 38°` in from the paving's edge — 3 cm
 * at the drawn 25 mm. Paving a metre overhead (a route carried over a bridge
 * across another route's kerb) hides nothing, and kerb *above* paving (a kerb
 * carried onto a deck over paving left on the ground) is the visible surface.
 * Both happen: #701's first version tested plan alone and dropped kerb up to
 * 2.03 m *above* its "cover" on the canonical seed, visible on 9 of 10 seeds.
 */
const KERB_BURY_MAX = 2 * (PATH_SURFACE_LIFT - PATH_KERB_LIFT);

/**
 * **How far the kerb may stand proud of other routes' paving and still be the
 * paving's to hide**, metres: the drawn difference between the two lifts, the
 * other way up.
 *
 * On the ground the kerb lies 25 mm under another route's paving, as drawn.
 * Over a bridge it cannot be trusted to: `drapePathsOverBridges` lifts each
 * mesh's *vertices* onto the hump, and the two meshes put their vertices in
 * different places, so between them each is a different chord of one curved
 * surface. On pool seed 24, where route 13's kerb band runs under another
 * route's paving on a ramp at (-7.8, -25.8), the paving's chords come out as
 * much as 2.8 mm *below* the kerb's — so the kerb pokes through the paving and
 * the two share a plane: `check:coplanar`'s `path-kerb|path-surface`, 0.222 m²
 * at 6.1 mm. This used to be a float tolerance of 0.1 mm, which read that kerb
 * as "above the paving, so visible" and kept it.
 *
 * A kerb that close is not a surface of its own: it is the same surface as the
 * paving it sits in, fighting it. The plan test has already proved the paving
 * covers all of it, so deleting it shows the paving that was meant to be there.
 * Kerb metres above paving — carried onto a deck over paving left on the
 * ground — is still well outside this, and still drawn.
 */
const KERB_PROUD_MAX = PATH_SURFACE_LIFT - PATH_KERB_LIFT;

/**
 * **How far above the kerb paving may lie and still bury it, where the plan
 * allows it**, metres: four times the drawn stand-off, 100 mm.
 *
 * The same drape error as {@link KERB_PROUD_MAX}, the other way. On the
 * canonical seed's steep ramp at (-35.6, -43.9), route 23's kerb triangle under
 * a junction's paving has three routes' triangles over it: one 8.7-11 mm above
 * (fighting it — `path-kerb|path-surface`, 0.200 m² at 9.9 mm) and two at
 * 42-63 mm, past {@link KERB_BURY_MAX}. Those two were refused as cover, so the
 * kerb was kept, and fought the third.
 *
 * Paving further overhead hides the kerb only if it also covers the wider strip
 * its sight-lines cross before they climb that high — {@link sightShadow} at
 * this height rather than at `KERB_BURY_MAX`. So this is asked only of a kerb
 * triangle whose wider strip other routes' paving covers in plan, and only after
 * the ordinary test has said no: it can drop more kerb, never less. Paving a
 * metre overhead (a deck over another route's kerb) is still well outside it.
 */
const KERB_HIDE_MAX = 4 * (PATH_SURFACE_LIFT - PATH_KERB_LIFT);

/** A kerb triangle whose plan another route's paving covers, and by what. */
interface KerbCandidate {
  /** Its triangle number in the kerb's full index. */
  readonly triangle: number;
  /** Its three kerb vertex indices. */
  readonly corners: readonly [number, number, number];
  readonly plan: [number, number][];
  /** The triangle and its {@link sightShadow} — what has to be covered for it to be out of sight. */
  readonly sight: [number, number][];
  /**
   * The same for paving up to {@link KERB_HIDE_MAX} overhead — or `null` if
   * other routes' paving does not cover that wider strip in plan, when only
   * `sight` can ever be asked.
   */
  readonly deepSight: [number, number][] | null;
  /**
   * Every other-owner paving triangle overlapping `deepSight` in plan (a
   * superset of `sight`), with both overlap polygons; `overlap` is empty when
   * it reaches only the wider strip.
   */
  readonly covers: readonly {
    readonly corners: readonly [number, number, number];
    readonly plan: PlanPolygon;
    readonly overlap: PlanPolygon;
    readonly deepOverlap: PlanPolygon;
  }[];
}

/**
 * **Where the paving lies on top of the kerb, so the kerb is not drawn there.**
 *
 * Each route's kerb is two bands along its own edges, and at a junction those
 * bands run on under the *other* route's surface, 25 mm down. That is a buried
 * face, invisible only while 25 mm stays 25 mm: over a bridge the drape lifts
 * vertices one by one, and the triangles straddling the deck's edge become
 * steep ramps — two routes' ramps meeting at a junction there come out within
 * a centimetre of one plane, same way up. `check:coplanar`:
 * `path-kerb|path-surface`, 0.651 m² at 7.7 mm on seed 24 and 0.200 m² at
 * 9.9 mm on the canonical seed. `ART_DIRECTION.md` §7's cure is to delete the
 * face nobody can see.
 *
 * A kerb triangle is dropped only when other routes' face-up paving covers
 * **all** of it in plan — and the strip its sight-lines cross on the way to the
 * camera, {@link sightShadow} — **and** lies on top of it — from {@link KERB_PROUD_MAX} below it to {@link KERB_BURY_MAX}
 * above it — over every part of the overlap. Both are exact: the plan test is a
 * convex polygon difference (never a capsule, which overstates the ribbon), and
 * the height test compares the two triangles' planes at every corner of their
 * overlap polygon, which bounds it everywhere between (both are linear there).
 * Only paving that passes the height test counts towards the cover.
 *
 * The plan half is decided once, when the paths are drawn — plan never moves.
 * The height half is decided by {@link apply}, which reads the meshes' current
 * vertices, so it is asked again after `drapePathsOverBridges` has moved them:
 * before a drape every route lies on the ground and 25 mm is 25 mm everywhere.
 * `apply` rewrites the kerb's index only; every vertex stays where it was laid,
 * so per-vertex measures of the kerb (the bridge-carrying invariant counts
 * them) are unchanged. A route's own surface is never subtracted from its own
 * kerb: the two share an edge by construction.
 *
 * **Whole triangles only.** Cutting partly covered triangles down to their
 * uncovered part was tried and is worse: `check:coplanar` measures a pair of
 * triangles by their furthest vertices, so small pieces of kerb that were
 * always within a few millimetres of the coarse terrain mesh became findings
 * the whole triangle had hidden (0.755 m² of `path-kerb|terrain` on seed 11).
 */
class KerbCover {
  private readonly all: number[];
  private readonly candidates: KerbCandidate[] = [];
  private readonly kerbMesh: Mesh;
  private readonly surfaceMesh: Mesh;

  constructor(
    surface: GeometryBuilder,
    surfaceOwners: readonly number[],
    kerb: GeometryBuilder,
    kerbOwners: readonly number[],
    kerbMesh: Mesh,
    surfaceMesh: Mesh,
  ) {
    this.kerbMesh = kerbMesh;
    this.surfaceMesh = surfaceMesh;
    this.all = Array.from(kerbMesh.geometry.index?.array ?? []);

    // The paving, in a plan grid.
    const paving: { owner: number; corners: [number, number, number]; plan: PlanPolygon; box: Box }[] = [];
    const grid = new Map<string, number[]>();
    for (let t = 0; t < surface.triangleCount; t += 1) {
      const corners = surface.triangleAt(t);
      const plan = corners.map((i) => surface.planAt(i));
      // Only paving the camera sees the top of can hide anything. A ribbon
      // that folds back on itself (a hairpin tighter than its own half-width)
      // lays some triangles wound face-down, and `FrontSide` culls them: kerb
      // under one of those is on screen. Pool seed 451 has one, at (-9.0, -4.4).
      if (facesUp(plan) <= 0) continue;
      const box = boxOf(plan);
      const id = paving.push({ owner: surfaceOwners[t] as number, corners, plan, box }) - 1;
      for (const key of cellsOf(box)) {
        const list = grid.get(key);
        if (list) list.push(id);
        else grid.set(key, [id]);
      }
    }

    // Every kerb triangle that the union of other routes' paving covers in plan.
    for (let t = 0; t < kerb.triangleCount; t += 1) {
      const corners = kerb.triangleAt(t);
      const plan = corners.map((i) => kerb.planAt(i));
      const sight = sightShadow(plan, KERB_BURY_MAX);
      // Contains `sight`: both are the triangle swept towards the camera, this one further.
      const deep = sightShadow(plan, KERB_HIDE_MAX);
      const box = boxOf(deep);
      const owner = kerbOwners[t] as number;
      const seen = new Set<number>();
      const covers: KerbCandidate['covers'][number][] = [];
      let uncovered: [number, number][][] = [sight];
      let deepUncovered: [number, number][][] = [deep];
      for (const key of cellsOf(box)) {
        for (const id of grid.get(key) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const cover = paving[id]!;
          if (cover.owner === owner || !boxesOverlap(cover.box, box)) continue;
          const deepOverlap = intersectConvex(deep, cover.plan);
          if (deepOverlap.length < 3 || Math.abs(signedArea(deepOverlap)) < KERB_SLIVER_AREA) continue;
          deepUncovered = deepUncovered.flatMap((piece) => subtractConvex(piece, cover.plan) ?? [piece]);
          const near = intersectConvex(sight, cover.plan);
          const overlap = near.length < 3 || Math.abs(signedArea(near)) < KERB_SLIVER_AREA ? [] : near;
          covers.push({ corners: cover.corners, plan: cover.plan, overlap, deepOverlap });
          if (overlap.length > 0) {
            uncovered = uncovered.flatMap((piece) => subtractConvex(piece, cover.plan) ?? [piece]);
          }
        }
      }
      if (uncovered.length === 0) {
        const deepSight = deepUncovered.length === 0 ? deep : null;
        this.candidates.push({ triangle: t, corners, plan, sight, deepSight, covers });
      }
    }
  }

  /** Re-decide which candidates are buried, from the meshes' current heights, and rewrite the kerb's index. */
  apply(): void {
    const kerbY = this.kerbMesh.geometry.getAttribute('position');
    const surfaceY = this.surfaceMesh.geometry.getAttribute('position');
    const kerbAt = (corners: readonly [number, number, number], plan: PlanPolygon) =>
      planeHeight(plan, corners.map((i) => kerbY.getY(i)) as [number, number, number]);
    const dropped = new Set<number>();
    for (const candidate of this.candidates) {
      const kerbHeight = kerbAt(candidate.corners, candidate.plan);
      // Hidden if the paving over it covers the strip its sight-lines cross
      // while they are still under that paving: first asked of paving within
      // the drawn stand-off's reach, then — where the plan allows — of paving
      // lying higher over it, which has to cover a wider strip.
      const hiddenUnder = (shadow: [number, number][], deep: boolean, most: number): boolean => {
        let uncovered: [number, number][][] = [shadow];
        for (const cover of candidate.covers) {
          const overlap = deep ? cover.deepOverlap : cover.overlap;
          if (overlap.length === 0) continue;
          const coverHeight = planeHeight(
            cover.plan,
            cover.corners.map((i) => surfaceY.getY(i)) as [number, number, number],
          );
          const onTop = overlap.every(([x, z]) => {
            const gap = coverHeight(x, z) - kerbHeight(x, z);
            return gap >= -KERB_PROUD_MAX && gap <= most;
          });
          if (!onTop) continue;
          uncovered = uncovered.flatMap((piece) => subtractConvex(piece, cover.plan) ?? [piece]);
          if (uncovered.length === 0) return true;
        }
        return false;
      };
      if (
        hiddenUnder(candidate.sight, false, KERB_BURY_MAX) ||
        (candidate.deepSight !== null && hiddenUnder(candidate.deepSight, true, KERB_HIDE_MAX))
      ) {
        dropped.add(candidate.triangle);
      }
    }
    const index: number[] = [];
    for (let t = 0; t < this.all.length / 3; t += 1) {
      if (dropped.has(t)) continue;
      index.push(this.all[t * 3] as number, this.all[t * 3 + 1] as number, this.all[t * 3 + 2] as number);
    }
    this.kerbMesh.geometry.setIndex(index);
  }
}

/**
 * The camera's direction, unit length — the same derivation `IsoCamera` and
 * `check:coplanar` use, from the one yaw and pitch this game has.
 */
const EYE = cameraOffset(CAMERA_YAW_DEGREES * DEG, CAMERA_PITCH_DEGREES * DEG, 1);

/**
 * **A kerb triangle together with the ground its sight-lines to the camera
 * cross while they are still under paving `height` above it** — asked at
 * {@link KERB_BURY_MAX}, and at {@link KERB_HIDE_MAX} for paving lying higher.
 *
 * Paving is a ribbon with no skirt, so kerb under it is hidden only if every
 * line from the kerb to the camera meets the paving before it climbs out from
 * under its edge. A sight-line rises `EYE.y` per unit and runs `EYE.xz` across
 * the ground, so by the time it is `KERB_BURY_MAX` up it has moved
 * `KERB_BURY_MAX · EYE.xz / EYE.y` in plan — about 3 cm at 38°. Requiring the
 * paving to cover the triangle swept that far towards the camera, not just the
 * triangle, is what keeps a kerb triangle hard against a paving edge from
 * being dropped while it still shows through the slot under it (one such, on
 * pool seed 451, 22 mm under paving and in view).
 */
function sightShadow(plan: readonly [number, number][], height: number): [number, number][] {
  const reach = height / EYE.y;
  const shifted = plan.map(([x, z]) => [x + EYE.x * reach, z + EYE.z * reach] as [number, number]);
  return convexHull([...plan, ...shifted]);
}

/** Andrew's monotone chain; anticlockwise in (x, z). */
function convexHull(points: readonly [number, number][]): [number, number][] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

interface Box {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function boxOf(plan: readonly (readonly [number, number])[]): Box {
  const xs = plan.map((p) => p[0]);
  const zs = plan.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

function boxesOverlap(a: Box, b: Box): boolean {
  return a.maxX > b.minX && a.minX < b.maxX && a.maxZ > b.minZ && a.minZ < b.maxZ;
}

/** The height of the plane through a triangle's three corners, as a function of plan position. */
function planeHeight(
  plan: PlanPolygon,
  heights: readonly [number, number, number],
): (x: number, z: number) => number {
  const [[x0, z0], [x1, z1], [x2, z2]] = plan as [[number, number], [number, number], [number, number]];
  const det = (x1 - x0) * (z2 - z0) - (x2 - x0) * (z1 - z0);
  const [h0, h1, h2] = heights;
  if (Math.abs(det) < 1e-12) return () => Math.max(h0, h1, h2);
  return (x, z) => {
    const w1 = ((x - x0) * (z2 - z0) - (x2 - x0) * (z - z0)) / det;
    const w2 = ((x1 - x0) * (z - z0) - (x - x0) * (z1 - z0)) / det;
    return (1 - w1 - w2) * h0 + w1 * h1 + w2 * h2;
  };
}

/**
 * Positive when a triangle given in plan, in its index order, is wound to face
 * the sky — the `y` of `(b - a) × (c - a)`.
 */
function facesUp(plan: readonly (readonly [number, number])[]): number {
  const [[ax, az], [bx, bz], [cx, cz]] = plan as [[number, number], [number, number], [number, number]];
  return (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
}

/** The intersection of two convex polygons in plan. */
function intersectConvex(piece: readonly [number, number][], cover: PlanPolygon): [number, number][] {
  const orientation = Math.sign(signedArea(cover));
  if (orientation === 0) return [];
  let rest: [number, number][] = [...piece];
  for (let k = 0; k < cover.length && rest.length >= 3; k += 1) {
    const [ax, az] = cover[k]!;
    const [bx, bz] = cover[(k + 1) % cover.length]!;
    rest = clipToSide(rest, ([x, z]) => orientation * ((bx - ax) * (z - az) - (bz - az) * (x - ax)));
  }
  return rest;
}

/** Grid cell side for {@link KerbCover}'s lookup, metres. */
const KERB_COVER_CELL = 4;

function cellsOf(box: Box): string[] {
  const keys: string[] = [];
  for (let i = Math.floor(box.minX / KERB_COVER_CELL); i <= Math.floor(box.maxX / KERB_COVER_CELL); i += 1) {
    for (let j = Math.floor(box.minZ / KERB_COVER_CELL); j <= Math.floor(box.maxZ / KERB_COVER_CELL); j += 1) {
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
  kerbCover = null;
  nextRun = 0;
});
