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
// A crossing's fence gap is its own `halfGap` — self-measured for obliquity.
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

  // --- 1. the open intervals: crossings and platforms, merged --------------
  // Everything else is a CLOSED stretch, and each closed stretch is fenced as
  // a sealed box: both sides, plus an end cap at each end. Airtight by
  // construction — overlapping gaps, oblique paths and station spacing can
  // change where the boxes are, never whether they seal. (The first version
  // fenced the loop with gaps and added compartment walls separately;
  // overlapping gaps let a child slalom around a compartment wall whose side
  // fence was absent — measured as 229 of 392 track points strollable.)
  interface Interval {
    from: number;
    to: number;
  }
  const length = route.length;
  const open: Interval[] = [];
  for (const crossing of crossings) {
    open.push({ from: crossing.railDistance - crossing.halfGap, to: crossing.railDistance + crossing.halfGap });
  }
  for (const station of stations) {
    open.push({ from: station.distance - STATION_GAP, to: station.distance + STATION_GAP });
  }
  // Unwrap the circle at a seam that lies in CLOSED track, so no open
  // interval straddles it. (Seaming at the middle of the first gap fenced
  // half of that very gap — the wrap-adjusted span ran past the loop's end
  // and the complement swallowed the other half.)
  const contains = (interval: Interval, d: number): boolean => {
    const span = ((interval.to - interval.from) % length + length) % length;
    const into = ((d - interval.from) % length + length) % length;
    return into <= span;
  };
  let seam = open.length ? ((open[0] as Interval).to % length + length) % length + 0.01 : 0;
  for (let guard = 0; guard < open.length + 1; guard += 1) {
    const inside = open.find((interval) => contains(interval, seam));
    if (!inside) break;
    seam = ((inside.to % length + length) % length) + 0.01;
  }
  const unwrap = (d: number): number => {
    let value = (d - seam) % length;
    if (value < 0) value += length;
    return value;
  };
  const spans = open
    .map((interval) => {
      const from = unwrap(interval.from);
      let to = unwrap(interval.to);
      if (to < from) to += length; // cannot straddle the seam; guard anyway
      return { from, to };
    })
    .sort((a, b) => a.from - b.from);
  const merged: Interval[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to + 0.5) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }
  const closed: Interval[] = [];
  let cursor = 0;
  for (const span of merged) {
    if (span.from > cursor + 1) closed.push({ from: cursor, to: span.from });
    cursor = Math.max(cursor, span.to);
  }
  if (cursor < length - 1) closed.push({ from: cursor, to: length });

  // --- 2. build each sealed box -------------------------------------------
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

  const sideAt = (distance: number, side: number): Post => {
    route.pointAt(distance + seam, point);
    route.tangentAt(distance + seam, tangent);
    const x = point.x + tangent.z * side * FENCE_OFFSET;
    const z = point.z - tangent.x * side * FENCE_OFFSET;
    return { x, z, y: terrainHeight(x, z) };
  };
  const link = (a: Post, b: Post) => {
    collision.addWall(a.x, a.z, b.x, b.z, 0.18);
    rails.push({
      x: (a.x + b.x) / 2,
      z: (a.z + b.z) / 2,
      y: (a.y + b.y) / 2 + 0.62,
      yaw: Math.atan2(b.x - a.x, b.z - a.z),
      length: Math.hypot(b.x - a.x, b.z - a.z),
    });
  };

  for (const box of closed) {
    let previousLeft: Post | null = null;
    let previousRight: Post | null = null;
    const steps = Math.max(2, Math.ceil((box.to - box.from) / STEP));
    for (let i = 0; i <= steps; i += 1) {
      const distance = box.from + ((box.to - box.from) * i) / steps;
      const left = sideAt(distance, 1);
      const right = sideAt(distance, -1);
      posts.push(left, right);
      if (previousLeft && previousRight) {
        link(previousLeft, left);
        link(previousRight, right);
      } else {
        link(left, right); // the cap at this end of the box
      }
      previousLeft = left;
      previousRight = right;
    }
    if (previousLeft && previousRight) link(previousLeft, previousRight); // far cap
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
