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
import { ANCHORS_BY_ID } from './anchors';

/**
 * The winding path network.
 *
 * Paths are ribbons extruded along Catmull–Rom curves and draped over the
 * terrain, rather than a texture painted on the ground: that way they follow the
 * hills exactly and the cream edging reads as a real kerb from the iso camera.
 *
 * Routes are authored as plain [x, z] control points below. The main loop is the
 * park's ring road; every other route is a spur that ends at an anchor's
 * `entrance`, so moving an anchor automatically moves its path.
 */

interface RouteDefinition {
  readonly name: string;
  readonly points: readonly (readonly [number, number])[];
  readonly width: number;
  readonly closed: boolean;
}

const anchor = ANCHORS_BY_ID;

const ROUTES: readonly RouteDefinition[] = [
  {
    name: 'main-loop',
    width: 3.6,
    closed: true,
    points: [
      [0, -21],
      [15, -20],
      [24, -12],
      [25, 2],
      [18, 15],
      [4, 22],
      [-12, 22],
      [-23, 13],
      [-24, -3],
      [-17, -16],
    ],
  },
  {
    name: 'fountain-approach',
    width: 3.0,
    closed: false,
    points: [
      [0, -21],
      [0, -15],
      [0, -9],
    ],
  },
  {
    name: 'spur-building',
    width: 2.8,
    closed: false,
    points: [[-19, -15], [-23, -18], anchor.building.entrance, [-29, -23]],
  },
  {
    name: 'spur-ballpit',
    width: 2.4,
    closed: false,
    points: [[-2, -16], [-4, -12], anchor.ballPit.entrance, [-8, -8.5]],
  },
  {
    name: 'spur-ferris',
    width: 2.8,
    closed: false,
    points: [[24, -11], anchor.ferrisWheel.entrance, [29, -19]],
  },
  {
    name: 'spur-dodgems',
    width: 2.8,
    closed: false,
    points: [[19, 13], anchor.dodgems.entrance, [26, 17]],
  },
  {
    name: 'spur-water',
    width: 2.8,
    closed: false,
    points: [[-19, 17], anchor.waterFight.entrance, [-25, 20]],
  },
];

/** Fountain plaza — a wide circle of paving where the paths converge. */
const PLAZA = { x: 0, z: 0, radius: 9.4 };

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

    const v = travelled / Math.max(1, width);
    builder.vertex(lx, terrainHeight(lx, lz) + lift, lz, 0, v);
    builder.vertex(rx, terrainHeight(rx, rz) + lift, rz, 1, v);

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
      builder.quad(a, c, b, d);
    }
  }
}

/**
 * Minimal geometry accumulator so the whole path network collapses into a
 * single draw call per layer.
 */
class GeometryBuilder {
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  vertex(x: number, y: number, z: number, u: number, v: number): void {
    this.positions.push(x, y, z);
    this.uvs.push(u, v);
  }

  /** Two triangles for a quad given as (a, b) then (c, d) vertex pairs. */
  quad(a: number, b: number, c: number, d: number): void {
    this.indices.push(a, b, c, b, d, c);
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}
