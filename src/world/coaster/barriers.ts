import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { toonMaterial } from '../../art/style/materials';
import { PALETTE } from '../../core/palette';
import type { CoasterRoute } from './route';

/**
 * The duck-under barriers, dressed so a six-year-old can see them coming.
 *
 * They began as one lemon box on a stick, and from the chase camera — which
 * sits 3.4 m behind the cart and a little above it — a lemon box against a
 * park full of lemon flowers is not a thing you duck under, it is scenery.
 * The family's note was that the bars must *read*: a barrier now has two
 * candy-striped posts, a barber's pole of a bar between them in alternating
 * pink and cream, and a little line of bunting pennants strung over the top,
 * which is the bit that catches the eye at distance because it is above the
 * skyline of the track.
 *
 * ### One draw call per part, not per barrier
 *
 * Eight or nine barriers × a dozen little meshes each would be a hundred
 * draw calls for decoration. Every part is an `InstancedMesh` across *all*
 * the barriers instead, so the whole set costs five, whatever the solver
 * decides the loop is long enough for. The pattern (compose a matrix from a
 * point on the curve and its tangent) is the same one `Coaster.buildTrack`
 * uses for the ties.
 */

/** How high above the rail the bar hangs — low enough to have to duck. */
export const BARRIER_HEIGHT = 1.05;

/** Half-width of the bar, so the posts land just outside the track. */
const HALF_SPAN = 2.2;

/** Stripes along the bar. Even count keeps the two colours balanced. */
const STRIPES = 8;

/** Pennants on the string above the bar. */
const PENNANTS = 5;

/**
 * Builds the dressing for every barrier on a route.
 *
 * @param distances Where the barriers are, in metres along the loop.
 * @returns A group to add to the coaster. Nothing here has collision: the
 *   barriers are 1 m above a track nobody walks on, and the bonk is a
 *   distance check in `Coaster.update`, not a physical one.
 */
export function buildBarriers(route: CoasterRoute, distances: readonly number[]): Group {
  const group = new Group();
  group.name = 'coaster:barriers';
  if (distances.length === 0) return group;

  const count = distances.length;
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const position = new Vector3();
  const one = new Vector3(1, 1, 1);
  const point = new Vector3();
  const tangent = new Vector3();
  const forward = new Vector3(0, 0, 1);

  // Two posts a barrier, one striped bar in `STRIPES` pieces, one pennant
  // string in `PENNANTS` triangles. Each part is instanced across the lot.
  const posts = new InstancedMesh(
    new CylinderGeometry(0.13, 0.16, BARRIER_HEIGHT + 0.55, 8),
    toonMaterial(PALETTE.markerPink),
    count * 2,
  );
  const stripeGeometry = new BoxGeometry((HALF_SPAN * 2) / STRIPES, 0.2, 0.2);
  const stripesLight = new InstancedMesh(
    stripeGeometry,
    toonMaterial(PALETTE.blossomWhite),
    count * Math.ceil(STRIPES / 2),
  );
  const stripesDark = new InstancedMesh(
    stripeGeometry,
    toonMaterial(PALETTE.markerPink),
    count * Math.ceil(STRIPES / 2),
  );
  // A pennant is a flat cone: three sides makes a triangle, pointing down,
  // which is exactly a bunting flag and costs six vertices.
  const pennantGeometry = new ConeGeometry(0.17, 0.34, 3);
  const pennantsA = new InstancedMesh(
    pennantGeometry,
    toonMaterial(PALETTE.markerLemon),
    count * Math.ceil(PENNANTS / 2),
  );
  const pennantsB = new InstancedMesh(
    pennantGeometry,
    toonMaterial(PALETTE.markerMint),
    count * Math.ceil(PENNANTS / 2),
  );

  let postIndex = 0;
  let lightIndex = 0;
  let darkIndex = 0;
  let pennantAIndex = 0;
  let pennantBIndex = 0;

  for (const distance of distances) {
    route.pointAt(distance, point);
    route.tangentAt(distance, tangent);
    // Across the track, in the ground plane — the same horizontal normal the
    // rails are offset along.
    const sideX = tangent.z;
    const sideZ = -tangent.x;
    const norm = Math.hypot(sideX, sideZ) || 1;
    const acrossX = sideX / norm;
    const acrossZ = sideZ / norm;
    rotation.setFromUnitVectors(forward, tangent.clone().normalize());
    // The bar and its bunting lie across the track, so they are the track's
    // heading turned a quarter turn.
    const acrossYaw = Math.atan2(tangent.x, tangent.z) + Math.PI / 2;
    const acrossRotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), acrossYaw);

    // --- the two posts ---------------------------------------------------
    for (const side of [-1, 1]) {
      position.set(
        point.x + acrossX * side * HALF_SPAN,
        point.y + BARRIER_HEIGHT - (BARRIER_HEIGHT + 0.55) / 2 + 0.5,
        point.z + acrossZ * side * HALF_SPAN,
      );
      matrix.compose(position, rotation, one);
      posts.setMatrixAt(postIndex, matrix);
      postIndex += 1;
    }

    // --- the striped bar --------------------------------------------------
    for (let i = 0; i < STRIPES; i += 1) {
      // Centre of stripe `i`, measured across the bar from one post to the other.
      const t = (i + 0.5) / STRIPES - 0.5;
      const offset = t * HALF_SPAN * 2;
      position.set(
        point.x + acrossX * offset,
        point.y + BARRIER_HEIGHT,
        point.z + acrossZ * offset,
      );
      matrix.compose(position, acrossRotation, one);
      if (i % 2 === 0) {
        stripesLight.setMatrixAt(lightIndex, matrix);
        lightIndex += 1;
      } else {
        stripesDark.setMatrixAt(darkIndex, matrix);
        darkIndex += 1;
      }
    }

    // --- the bunting ------------------------------------------------------
    // Strung in a shallow sag above the bar: the highest thing on the barrier,
    // so it breaks the skyline and is what you actually notice first.
    for (let i = 0; i < PENNANTS; i += 1) {
      const t = (i + 0.5) / PENNANTS - 0.5;
      const offset = t * HALF_SPAN * 1.7;
      const sag = Math.cos(t * Math.PI) * 0.18;
      position.set(
        point.x + acrossX * offset,
        point.y + BARRIER_HEIGHT + 0.62 - sag,
        point.z + acrossZ * offset,
      );
      // Point-down: a cone's tip is +Y, so half a turn about X hangs it.
      const hang = acrossRotation
        .clone()
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI));
      matrix.compose(position, hang, one);
      if (i % 2 === 0) {
        pennantsA.setMatrixAt(pennantAIndex, matrix);
        pennantAIndex += 1;
      } else {
        pennantsB.setMatrixAt(pennantBIndex, matrix);
        pennantBIndex += 1;
      }
    }
  }

  // Instanced meshes are allocated for the worst case above (an odd stripe
  // count would give one colour more than the other); tell each how many it
  // actually filled so the unwritten tail is not drawn at the origin.
  posts.count = postIndex;
  stripesLight.count = lightIndex;
  stripesDark.count = darkIndex;
  pennantsA.count = pennantAIndex;
  pennantsB.count = pennantBIndex;
  for (const mesh of [posts, stripesLight, stripesDark, pennantsA, pennantsB]) {
    mesh.instanceMatrix.needsUpdate = true;
    // The barriers stand well above the ground on a loop that is mostly out of
    // shot; culling per instance is not worth the bounds maths.
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}
