import { InstancedMesh, Matrix4, Mesh, Quaternion, Shape, ShapeGeometry, Vector3 } from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../../art/style/artPalette';
import { decal, markShared, toonMaterial } from '../../art/style/materials';
import type { HallContext } from './context';
import { PATHS, REPTILE_ARRIVAL_X, REPTILE_ARRIVAL_Z, type LocalPoint } from './layout';

/**
 * **The paths are painted as one long smiling snake to follow.**
 *
 * The hall's floor is one flat `pathSand` plate, so the path graph in
 * `layout.ts` (`PATHS`) is drawn onto it in `pathSandDark`: a trail of belly
 * scales — flat crescents, convex side forward, one every {@link SCALE_STEP}
 * along every polyline, all one `InstancedMesh` — a two-metre smiling head
 * at the arrival spot, where she starts following it, and the tail's tip at
 * the far south-west corner by the grotto. Geometry only, no canvas (the
 * spec's §3; the first cut never built it, and the hall's forking paths read
 * as nothing at all on a plate of one colour).
 *
 * Every decal lies {@link DECAL_STEP} above whatever it is painted on: the
 * scales and the head's dark shape at one step over the floor, the eyes and
 * the blush at two, the catchlights and the tongue (which crosses the smile)
 * at three. Two centimetres is
 * past `check:coplanar`'s one-centimetre "stand-off" threshold, and the
 * scales skip the head's and the tail's own footprints so no two decals of
 * one colour tile the same plane. Nothing here is solid.
 */
export const DECAL_STEP = 0.02;
/** Metres between scales along a path. */
const SCALE_STEP = 0.9;
/** A scale's outer radius: a share of the path's width, capped so the foyer's nine-metre sweep keeps the same scale as the ring. */
const SCALE_RADIUS_CAP = 1.3;
const SCALE_RADIUS_SHARE = 0.42;
/** Scales stay this far off the head's and the tail's own centres. */
const SCALE_CLEAR = 1.6;
/** The head's length, snout to nape. */
const HEAD_LENGTH = 2;
const HEAD_WIDTH = 1.6;
/** The tail tip's base, at the SW Walk's west end, and where it points. */
const TAIL_BASE: LocalPoint = { x: -19.3, z: 10.7 };
const TAIL_TIP: LocalPoint = { x: -20.9, z: 12.3 };

/** One scale: a crescent of outer radius 1, lying flat, convex side toward −z (its forward). */
function crescent(): ShapeGeometry {
  const shape = new Shape();
  const from = (25 * Math.PI) / 180;
  const to = (155 * Math.PI) / 180;
  shape.absarc(0, 0, 1, from, to, false);
  shape.absarc(0, 0, 0.7, to, from, true);
  shape.closePath();
  const geometry = new ShapeGeometry(shape, 12);
  // (x, y) → (x, 0, −y): the shape's +y is the hall's −z, and the face points up.
  geometry.rotateX(-Math.PI / 2); // flat-ok: the decal laid on the hall floor; the reptile house is its own flat space at x 600, floor y 0, off the sphere
  return geometry;
}

/** A flat shape in the hall's XZ plane, lying at `y`, from a drawing in (x, −z). */
function flat(shape: Shape, colour: number, y: number, curveSegments = 24): Mesh {
  const geometry = new ShapeGeometry(shape, curveSegments);
  geometry.rotateX(-Math.PI / 2); // flat-ok: a decal laid on the reptile hall floor, a flat space at x 600, floor y 0, off the sphere
  const mesh = decal(new Mesh(geometry, toonMaterial(colour)));
  mesh.position.y = y;
  return mesh;
}

function ellipse(cx: number, cz: number, rx: number, rz: number, colour: number, y: number): Mesh {
  const shape = new Shape();
  shape.absellipse(cx, -cz, rx, rz, 0, Math.PI * 2, false, 0);
  return flat(shape, colour, y);
}

export function paintPaths(ctx: HallContext): void {
  const head: LocalPoint = { x: REPTILE_ARRIVAL_X, z: REPTILE_ARRIVAL_Z - 1.2 };

  // ---- the scales
  const stations: { x: number; z: number; yaw: number; radius: number }[] = [];
  for (const path of PATHS) {
    const radius = Math.min(SCALE_RADIUS_CAP, path.width * SCALE_RADIUS_SHARE);
    for (let i = 0; i + 1 < path.points.length; i += 1) {
      const a = path.points[i]!;
      const b = path.points[i + 1]!;
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < SCALE_STEP) continue;
      const dx = (b.x - a.x) / length;
      const dz = (b.z - a.z) / length;
      // Rotating (0, 0, −1) about y by `yaw` gives (−sin yaw, 0, −cos yaw) = the heading.
      const yaw = Math.atan2(-dx, -dz);
      for (let s = SCALE_STEP / 2; s <= length - SCALE_STEP / 2; s += SCALE_STEP) {
        const x = a.x + dx * s;
        const z = a.z + dz * s;
        if (Math.hypot(x - head.x, z - head.z) < SCALE_CLEAR) continue;
        if (Math.hypot(x - TAIL_BASE.x, z - TAIL_BASE.z) < SCALE_CLEAR) continue;
        stations.push({ x, z, yaw, radius });
      }
    }
  }
  const scales = new InstancedMesh(markShared(crescent()), toonMaterial(PALETTE.pathSandDark), Math.max(1, stations.length));
  scales.name = 'reptile-path-scales';
  scales.count = stations.length;
  decal(scales);
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0); // flat-ok: the hall floor's up; the reptile house is its own flat space at x 600, floor y 0, off the sphere
  stations.forEach((station, index) => {
    position.set(station.x, DECAL_STEP, station.z);
    quaternion.setFromAxisAngle(up, station.yaw);
    scale.set(station.radius, 1, station.radius);
    matrix.compose(position, quaternion, scale);
    scales.setMatrixAt(index, matrix);
  });
  scales.instanceMatrix.needsUpdate = true;
  ctx.root.add(scales);

  // ---- the head at her feet on arrival: a face looking up at the camera,
  // eyes to the north and the smile toward her, the scales leading off north
  const headGroup = ctx.root;
  headGroup.add(ellipse(head.x, head.z, HEAD_WIDTH / 2, HEAD_LENGTH / 2, PALETTE.pathSandDark, DECAL_STEP));
  for (const side of [-1, 1]) {
    const ex = head.x + side * HEAD_WIDTH * 0.26;
    const ez = head.z - HEAD_LENGTH * 0.12;
    headGroup.add(ellipse(ex, ez, 0.13, 0.17, ART.ink, DECAL_STEP * 2));
    headGroup.add(ellipse(ex + side * 0.05, ez - 0.06, 0.05, 0.055, ART.shine, DECAL_STEP * 3));
    headGroup.add(ellipse(ex - side * 0.055, ez + 0.06, 0.025, 0.028, ART.shine, DECAL_STEP * 3));
    headGroup.add(ellipse(ex + side * 0.3, ez + 0.3, 0.14, 0.09, ART.blush, DECAL_STEP * 2));
  }
  const smile = new Shape();
  const smileZ = -(head.z + HEAD_LENGTH * 0.18);
  smile.absarc(head.x, smileZ, 0.34, (200 * Math.PI) / 180, (340 * Math.PI) / 180, false);
  smile.absarc(head.x, smileZ, 0.26, (340 * Math.PI) / 180, (200 * Math.PI) / 180, true);
  smile.closePath();
  headGroup.add(flat(smile, ART.ink, DECAL_STEP * 2));
  // A forked tongue out of the smile, toward her toes.
  const tongue = new Shape();
  const mouthZ = head.z + HEAD_LENGTH * 0.18 + 0.26;
  tongue.moveTo(head.x - 0.05, -mouthZ);
  tongue.lineTo(head.x + 0.05, -mouthZ);
  tongue.lineTo(head.x + 0.04, -(mouthZ + 0.23));
  tongue.lineTo(head.x + 0.16, -(mouthZ + 0.43));
  tongue.lineTo(head.x + 0.06, -(mouthZ + 0.43));
  tongue.lineTo(head.x, -(mouthZ + 0.29));
  tongue.lineTo(head.x - 0.06, -(mouthZ + 0.43));
  tongue.lineTo(head.x - 0.16, -(mouthZ + 0.43));
  tongue.lineTo(head.x - 0.04, -(mouthZ + 0.23));
  tongue.closePath();
  headGroup.add(flat(tongue, PALETTE.markerPink, DECAL_STEP * 3, 4));

  // ---- the tail: a tapering wedge from the SW Walk's end into the corner, with a rattle on the tip
  const along = { x: TAIL_TIP.x - TAIL_BASE.x, z: TAIL_TIP.z - TAIL_BASE.z };
  const length = Math.hypot(along.x, along.z);
  const across = { x: -along.z / length, z: along.x / length };
  const halfWidth = 0.6;
  const wedge = new Shape();
  wedge.moveTo(TAIL_BASE.x + across.x * halfWidth, -(TAIL_BASE.z + across.z * halfWidth));
  wedge.quadraticCurveTo(
    TAIL_BASE.x + along.x * 0.55 + across.x * halfWidth * 0.75,
    -(TAIL_BASE.z + along.z * 0.55 + across.z * halfWidth * 0.75),
    TAIL_TIP.x,
    -TAIL_TIP.z,
  );
  wedge.quadraticCurveTo(
    TAIL_BASE.x + along.x * 0.55 - across.x * halfWidth * 0.75,
    -(TAIL_BASE.z + along.z * 0.55 - across.z * halfWidth * 0.75),
    TAIL_BASE.x - across.x * halfWidth,
    -(TAIL_BASE.z - across.z * halfWidth),
  );
  wedge.closePath();
  headGroup.add(flat(wedge, PALETTE.pathSandDark, DECAL_STEP, 10));
  headGroup.add(ellipse(TAIL_TIP.x, TAIL_TIP.z, 0.2, 0.2, PALETTE.flowerYellow, DECAL_STEP * 2));
}
