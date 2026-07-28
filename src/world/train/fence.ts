import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import type { TrainRoute } from './route';
import type { LevelCrossing } from './crossings';
import type { CollisionWorld } from '../Collision';
import { PALETTE } from '../../core/palette';
import { toonMaterial } from '../../art/style/materials';
import { terrainHeight } from '../terrain';

/**
 * The exclusion fence — Decision 4 §6, "keeping feet off the track".
 *
 * Two picket runs offset either side of the solved loop: invisible walls for
 * the collision world (full height — the fence is a rule, not a hurdle), and
 * a visible pink post-and-rail fence so the rule reads as scenery rather
 * than as an invisible force. Gaps at every level crossing and along every
 * platform; everywhere else, continuous by construction — which is what
 * finally closes `check:park`'s rail.exclusion and rail.walkable ratchets.
 */

const FENCE_OFFSET = 2.0;
const STEP = 2.4;
/** Fence gap half-length around a crossing, along the loop. */
const CROSSING_GAP = 4.5;
/** Fence gap half-length around a station, along the loop. */
const STATION_GAP = 6.5;

interface StationSpan {
  readonly distance: number;
}

export function buildRailFence(
  route: TrainRoute,
  collision: CollisionWorld,
  crossings: readonly LevelCrossing[],
  stations: readonly StationSpan[],
): Group {
  const group = new Group();
  group.name = 'rail-fence';

  const wrapGap = (a: number, b: number): number => {
    const raw = Math.abs(a - b) % route.length;
    return Math.min(raw, route.length - raw);
  };
  const inGap = (distance: number): boolean =>
    crossings.some((crossing) => wrapGap(distance, crossing.railDistance) < CROSSING_GAP) ||
    stations.some((station) => wrapGap(distance, station.distance) < STATION_GAP);

  const point = new Vector3();
  const tangent = new Vector3();
  interface Post {
    x: number;
    z: number;
    y: number;
  }
  interface Rail {
    x: number;
    z: number;
    y: number;
    yaw: number;
    length: number;
  }
  const posts: Post[] = [];
  const rails: Rail[] = [];

  for (const side of [-1, 1] as const) {
    let previous: Post | null = null;
    for (let distance = 0; distance < route.length; distance += STEP) {
      if (inGap(distance)) {
        previous = null;
        continue;
      }
      route.pointAt(distance, point);
      route.tangentAt(distance, tangent);
      const x = point.x + tangent.z * side * FENCE_OFFSET;
      const z = point.z - tangent.x * side * FENCE_OFFSET;
      const y = terrainHeight(x, z);
      const post: Post = { x, z, y };
      posts.push(post);
      if (previous) {
        collision.addWall(previous.x, previous.z, x, z, 0.18);
        rails.push({
          x: (previous.x + x) / 2,
          z: (previous.z + z) / 2,
          y: (previous.y + y) / 2 + 0.62,
          yaw: Math.atan2(x - previous.x, z - previous.z),
          length: Math.hypot(x - previous.x, z - previous.z),
        });
      }
      previous = post;
    }
  }

  // --- compartment walls at every crossing gap ----------------------------
  // Without these, a child who enters the fence gap at a legal crossing can
  // turn and stroll down the line between the fences (measured: 267 of 414
  // track points reachable). Each crossing gets two walls ACROSS the
  // corridor, one at each end of its fence gap, spanning fence line to
  // fence line — the path crosses in the middle of the gap and never meets
  // them; walking along the rails does, immediately.
  const compartmentEnds: number[] = [];
  for (const crossing of crossings) {
    for (const gapEnd of [-1, 1] as const) {
      compartmentEnds.push(crossing.railDistance + gapEnd * CROSSING_GAP);
    }
  }
  // The station gaps are strolled into just as easily as the crossings'.
  for (const station of stations) {
    for (const gapEnd of [-1, 1] as const) {
      compartmentEnds.push(station.distance + gapEnd * STATION_GAP);
    }
  }
  for (const atDistance of compartmentEnds) {
    {
      route.pointAt(atDistance, point);
      route.tangentAt(atDistance, tangent);
      const nx = tangent.z;
      const nz = -tangent.x;
      const fromX = point.x + nx * (FENCE_OFFSET + 0.2);
      const fromZ = point.z + nz * (FENCE_OFFSET + 0.2);
      const toX = point.x - nx * (FENCE_OFFSET + 0.2);
      const toZ = point.z - nz * (FENCE_OFFSET + 0.2);
      collision.addWall(fromX, fromZ, toX, toZ, 0.18);
      rails.push({
        x: (fromX + toX) / 2,
        z: (fromZ + toZ) / 2,
        y: (terrainHeight(fromX, fromZ) + terrainHeight(toX, toZ)) / 2 + 0.62,
        yaw: Math.atan2(toX - fromX, toZ - fromZ),
        length: Math.hypot(toX - fromX, toZ - fromZ),
      });
      posts.push({ x: fromX, z: fromZ, y: terrainHeight(fromX, fromZ) });
      posts.push({ x: toX, z: toZ, y: terrainHeight(toX, toZ) });
    }
  }

  const postMaterial = toonMaterial(PALETTE.stonePink);
  const railMaterial = toonMaterial(PALETTE.stonePinkLight);
  const postMesh = new InstancedMesh(new CylinderGeometry(0.09, 0.11, 0.95, 6), postMaterial, posts.length);
  const railMesh = new InstancedMesh(new BoxGeometry(0.09, 0.1, 1), railMaterial, rails.length);
  postMesh.castShadow = false;
  railMesh.castShadow = false;

  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const axis = new Vector3(0, 1, 0);
  const one = new Vector3(1, 1, 1);
  const position = new Vector3();
  posts.forEach((post, index) => {
    position.set(post.x, post.y + 0.48, post.z);
    matrix.compose(position, rotation.identity(), one);
    postMesh.setMatrixAt(index, matrix);
  });
  const stretch = new Vector3();
  rails.forEach((rail, index) => {
    rotation.setFromAxisAngle(axis, rail.yaw);
    position.set(rail.x, rail.y, rail.z);
    stretch.set(1, 1, rail.length);
    matrix.compose(position, rotation, stretch);
    railMesh.setMatrixAt(index, matrix);
  });
  postMesh.instanceMatrix.needsUpdate = true;
  railMesh.instanceMatrix.needsUpdate = true;
  group.add(postMesh, railMesh);

  // --- the crossings themselves: a timber deck between the rails ---------
  const deckMaterial = toonMaterial(PALETTE.woodLight);
  for (const crossing of crossings) {
    const deck = new InstancedMesh(new BoxGeometry(1.1, 0.06, 0.52), deckMaterial, 7);
    const deckTangent = route.tangentAt(crossing.railDistance, new Vector3());
    for (let i = 0; i < 7; i += 1) {
      const along = (i - 3) * 0.62;
      const x = crossing.x + deckTangent.x * along;
      const z = crossing.z + deckTangent.z * along;
      rotation.setFromAxisAngle(axis, Math.atan2(deckTangent.x, deckTangent.z));
      position.set(x, terrainHeight(x, z) + 0.055, z);
      matrix.compose(position, rotation, one);
      deck.setMatrixAt(i, matrix);
    }
    deck.instanceMatrix.needsUpdate = true;
    group.add(deck);
  }

  return group;
}
