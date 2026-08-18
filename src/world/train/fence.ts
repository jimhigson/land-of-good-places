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
import type { Bridge } from './bridges';
import { FENCE_OFFSET, FENCE_SEAM_MARGIN } from './clearance';
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
 * than as an invisible force. A gap along every platform, for boarding; no
 * gap anywhere else — not even at a crossing, since issue #116 (Decision 8)
 * a path crosses on a bridge, and the fence runs on underneath it. Where a
 * bridge's own deck stands directly over a run of posts, that run's wall
 * gets an absolute top pinned just under the deck instead of the usual
 * `Infinity`: solid at ground height (nobody reachable there clears it),
 * open at the deck's own height (see `bridges.ts`'s header for why that is
 * safe against the jump-the-fence hazard Decision 8 records). Continuous by
 * construction everywhere else — which is what closes `check:park`'s
 * rail.exclusion and rail.walkable ratchets.
 */

const STEP = 2.4;
/** Fence gap half-length around a station, along the loop. Exported so
 * `check:park` can subtract the *declared* open stretches and hold the rest
 * of the loop to zero holes. */
export const STATION_GAP = 6.5;

interface StationSpan {
  readonly distance: number;
}

export function buildRailFence(
  route: TrainRoute,
  collision: CollisionWorld,
  bridges: readonly Bridge[],
  stations: readonly StationSpan[],
): Group {
  const group = new Group();
  group.name = 'rail-fence';

  /**
   * The deck height directly over `(x, z)`, or `null` off every bridge —
   * consulted by every wall segment this function adds, so a run of fence
   * that happens to fall under a deck gets the `topIsAbsolute` seam instead
   * of the ordinary always-solid wall. See the file header.
   */
  const deckSpanAt = (x: number, z: number): number | null => {
    for (const bridge of bridges) {
      if (bridge.deckCovers(x, z)) return bridge.deckY;
    }
    return null;
  };

  // --- 1. the open intervals: platforms only --------------------------------
  // Everything else is a CLOSED stretch, and each closed stretch is fenced as
  // a sealed box: both sides, plus an end cap at each end. Airtight by
  // construction — overlapping gaps and station spacing can change where the
  // boxes are, never whether they seal. (The first version fenced the loop
  // with gaps and added compartment walls separately; overlapping gaps let a
  // child slalom around a compartment wall whose side fence was absent —
  // measured as 229 of 392 track points strollable.) A crossing no longer
  // opens one of these — issue #116/Decision 8, the fence runs on underneath
  // every bridge instead.
  interface Interval {
    from: number;
    to: number;
  }
  const length = route.length;
  const open: Interval[] = [];
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
  /** Every wall segment this file adds goes through here, so a run that
   * passes under a bridge deck always gets the seam instead of the ordinary
   * always-solid wall — see `deckSpanAt` above. */
  const addFenceWall = (a: Post, b: Post): void => {
    const deckY = deckSpanAt((a.x + b.x) / 2, (a.z + b.z) / 2);
    if (deckY === null) {
      collision.addWall(a.x, a.z, b.x, b.z, 0.18);
    } else {
      collision.addWall(a.x, a.z, b.x, b.z, 0.18, deckY - FENCE_SEAM_MARGIN, false, true);
    }
  };
  const link = (a: Post, b: Post) => {
    addFenceWall(a, b);
    rails.push({
      x: (a.x + b.x) / 2,
      z: (a.z + b.z) / 2,
      y: (a.y + b.y) / 2 + 0.62,
      yaw: Math.atan2(b.x - a.x, b.z - a.z),
      length: Math.hypot(b.x - a.x, b.z - a.z),
    });
  };
  /**
   * A box end cap crosses the track, and the train drives through it four
   * times a lap — so the *collision* wall keeps its full span (the seal is a
   * rule, and rules are airtight), but the *visible* rail is two short stubs
   * flanking the rails with the middle left open. What a child sees is the
   * fence turning in to meet the crossing; what the train sees is nothing.
   */
  const cap = (a: Post, b: Post) => {
    addFenceWall(a, b);
    const span = Math.hypot(b.x - a.x, b.z - a.z);
    const stub = Math.max(0, span / 2 - 1.1) / span; // fraction of the way in
    for (const [from, to] of [
      [a, { x: a.x + (b.x - a.x) * stub, z: a.z + (b.z - a.z) * stub, y: a.y }],
      [b, { x: b.x + (a.x - b.x) * stub, z: b.z + (a.z - b.z) * stub, y: b.y }],
    ] as const) {
      rails.push({
        x: (from.x + to.x) / 2,
        z: (from.z + to.z) / 2,
        y: (from.y + to.y) / 2 + 0.62,
        yaw: Math.atan2(to.x - from.x, to.z - from.z),
        length: Math.hypot(to.x - from.x, to.z - from.z),
      });
    }
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
        cap(left, right); // the cap at this end of the box
      }
      previousLeft = left;
      previousRight = right;
    }
    if (previousLeft && previousRight) cap(previousLeft, previousRight); // far cap
  }

  // --- 3. the far rail of every platform stays fenced ----------------------
  // A station's gap exists so a child can board from the platform — the
  // *park* side. Open on both sides (as it first shipped), the gap was also
  // the cheapest way ACROSS the railway, and the tap-to-move router found
  // it: once issue #241 spread the plots to both sides of the loop, walks
  // to anything beyond it cut straight over the rails at a platform
  // (`check:park`'s route.crossesRail). Crossing belongs to bridges;
  // boarding belongs to platforms; so the platform's far side carries the
  // same fence as any closed stretch, with no break — if a bridge happens to
  // stand in a platform's window, `addFenceWall` gives that run the same
  // seam as anywhere else a deck crosses it.
  const stationRun = (station: StationSpan) => {
    route.pointAt(station.distance, point);
    route.tangentAt(station.distance, tangent);
    // Same side math as `train/plan.ts`'s `stationStand`: the platform is on
    // the park side (towards the origin); the fence goes opposite.
    const parkIsRight = tangent.z * -point.x - tangent.x * -point.z >= 0;
    const farSide = parkIsRight ? -1 : 1;
    let previous: Post | null = null;
    const steps = Math.max(2, Math.ceil((STATION_GAP * 2) / STEP));
    for (let i = 0; i <= steps; i += 1) {
      const distance = route.wrap(station.distance - STATION_GAP + (STATION_GAP * 2 * i) / steps);
      route.pointAt(distance, point);
      route.tangentAt(distance, tangent);
      const x = point.x + tangent.z * farSide * FENCE_OFFSET;
      const z = point.z - tangent.x * farSide * FENCE_OFFSET;
      const post: Post = { x, z, y: terrainHeight(x, z) };
      posts.push(post);
      if (previous) link(previous, post);
      previous = post;
    }
  };
  for (const station of stations) stationRun(station);

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

  // The crossings themselves no longer get a flat timber deck here — every
  // one now has a real hump-back bridge, built and added to the scene by
  // `bridges.ts`/`ParkTrain` alongside this fence.

  return group;
}
