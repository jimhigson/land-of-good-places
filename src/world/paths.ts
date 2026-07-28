import {
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three';
import { PALETTE } from '../core/palette';
import { pathTexture } from '../core/textures';
import { terrainHeight, terrainNormal } from './terrain';
import { ANCHORS } from './anchors';
import { PARK_LAYOUT } from './parkLayout';

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

const BLOCKERS: readonly Blocker[] = [...PARK_LAYOUT.entries.values()]
  .filter((e) => e.id !== 'fountain')
  .map((e) => ({ x: e.x, z: e.z, radius: e.boundingRadius + 2.2 }));

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
  for (let i = 0; i < bearings; i += 2) {
    const angle = (i / bearings) * TAU_PATH;
    points.push([
      PLAZA.x + Math.cos(angle) * (profile[i] as number),
      PLAZA.z + Math.sin(angle) * (profile[i] as number),
    ]);
  }
  return points;
}

const TAU_PATH = Math.PI * 2;

/**
 * Straight line from `from` to `to`, detouring around any blocker it clips:
 * the offending circle contributes a tangent-side waypoint, repeatedly,
 * until the polyline is clear. Greedy but bounded, and the ribbon curve
 * smooths the corners it leaves.
 */
function routeAround(
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
  return points;
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

function buildRoutes(): readonly RouteDefinition[] {
  const ring = solveRing();
  const routes: RouteDefinition[] = [
    { name: 'main-loop', width: 3.6, closed: true, points: ring },
    // The approach: from just inside the park gate, down the protected
    // corridor, then around whatever stands between it and the plaza.
    {
      name: 'gate-approach',
      width: 3.2,
      closed: false,
      points: [
        [0, 54] as const,
        [0, 30] as const,
        ...routeAround([0, 27], nearestRingPoint(ring, 0, 27)).slice(1),
      ],
    },
    // From the ring to the plaza edge nearest the gate side, so the two
    // networks always touch.
    {
      name: 'fountain-approach',
      width: 3.0,
      closed: false,
      points: routeAround(
        nearestRingPoint(ring, PLAZA.x, PLAZA.z + PLAZA.radius + 4),
        [PLAZA.x, PLAZA.z + PLAZA.radius - 1],
      ),
    },
  ];
  for (const anchor of ANCHORS) {
    const [ex, ez] = anchor.entrance;
    const start = nearestRingPoint(ring, ex, ez);
    // Carry the spur a couple of metres past the doormat into the plot mouth,
    // as the authored spurs always did.
    const towards = [anchor.position[0] - ex, anchor.position[1] - ez];
    const l = Math.hypot(towards[0] as number, towards[1] as number) || 1;
    const past: readonly [number, number] = [
      ex + ((towards[0] as number) / l) * 2,
      ez + ((towards[1] as number) / l) * 2,
    ];
    routes.push({
      name: `spur-${anchor.id}`,
      width: anchor.id === 'building' ? 2.8 : 2.6,
      closed: false,
      points: [...routeAround(start, [ex, ez]), past],
    });
  }
  return routes;
}

/**
 * Exported so anything that wants to *draw* the network — the park map — can
 * rebuild the same centreline from the same generated control points.
 */
export const ROUTES: readonly RouteDefinition[] = buildRoutes();

/** Sampled path centreline, used for scenery placement queries. */
interface PathSample {
  readonly x: number;
  readonly z: number;
  readonly halfWidth: number;
}

const samples: PathSample[] = [];

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
