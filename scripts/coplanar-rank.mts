/**
 * **Which coplanar seams matter, in the order somebody should fix them.**
 *
 * `coplanar-sweep.mts` says *where* two faces share a plane. That is a long
 * list and a long list is not a plan, so this answers the two questions #472
 * asks of it — **can the camera actually see it, and how close does a child
 * get** — and multiplies them into one ordering.
 *
 * ## The sight line is decidable here
 *
 * The park has one camera angle forever, so "can this ever be seen?" is not a
 * guess. The sweep has already thrown away every face pointing away from the
 * eye; what is left is a face pointing *at* it, which may still be buried
 * inside a table leg or under a deck. So the seam is asked the same question
 * the game asks: fire a ray from it along the camera's own direction and see
 * whether anything stands in the way. That is exactly how #467 dismissed its
 * last pair with confidence — 18 m below the floor, facing down, unreachable
 * by any camera — instead of leaving it on the list forever as a maybe.
 *
 * **Every object is made visible for the cast, and put back afterwards.** Most
 * of the game is `visible = false` until you walk into the room; a ray that
 * honoured that would sail straight through every wall of the castle and call
 * the whole interior unoccluded. The spaces are hundreds of metres apart, so
 * nothing in one can shadow anything in another.
 *
 * ## "How close can she get" is asked of the collision world, not of a rule
 *
 * The distance is to the nearest place a **player-sized** body could actually
 * stand — `CollisionWorld.isClearCircle` at her own `PLAYER_RADIUS`, on ground
 * the game's own `WalkSurfaces` sampler offers her. Not to the nearest path,
 * not to the nearest waypoint: a seam behind a locked door and a seam at the
 * front step read identically to those, and differently to this.
 */
import { Raycaster, Vector3, type Object3D } from 'three';
import { CAMERA_DISTANCE, PLAYER_RADIUS } from '../src/core/constants.ts';
import type { CollisionWorld } from '../src/world/Collision.ts';
import { EYE_DIRECTION, type CoplanarPair } from './coplanar-sweep.mts';

/** A seam, plus what decides where it comes in the queue. */
export interface RankedSeam extends CoplanarPair {
  /** Something solid stands between this seam and the camera, always. */
  readonly occluded: boolean;
  /**
   * Metres from the seam to the nearest spot a child could stand, or
   * {@link OUT_OF_REACH} if she cannot get within {@link SEARCH_LIMIT} of it.
   */
  readonly reach: number;
  /**
   * Visible area divided by how far away she has to stay. Zero for anything
   * occluded — it is not that it matters less, it is that no camera can see
   * it, so it cannot be the flicker anybody reported.
   */
  readonly score: number;
}

/** How far out the search for a standing spot goes before giving up. */
const SEARCH_LIMIT = 12;
/** Reported reach for a seam with nowhere to stand within {@link SEARCH_LIMIT}. */
export const OUT_OF_REACH = Infinity;
/**
 * How far off the surface the sight-line ray starts, so a seam is never
 * occluded by the two faces that make it. A tenth of a millimetre — smaller
 * than anything else the sweep can resolve, and the two faces are behind it.
 */
const RAY_LIFT = 1e-4;

export interface RankInputs {
  readonly scene: Object3D;
  readonly collision: CollisionWorld;
  /** `WalkSurfaces.sample(x, z, y)` — the ground under a point, as she meets it. */
  readonly sample: (x: number, z: number, y: number) => number;
}

/**
 * Sorts `pairs` worst-first, having measured each one's sight line and reach.
 *
 * The visibility pass flips `visible` on the whole scene for the duration and
 * restores exactly what was there — a sweep that left the castle switched on
 * would leave the next check measuring a game nobody plays.
 */
export function rankSeams(pairs: readonly CoplanarPair[], world: RankInputs): RankedSeam[] {
  const restore = new Map<Object3D, boolean>();
  world.scene.traverse((node) => {
    if (!node.visible) {
      restore.set(node, node.visible);
      node.visible = true;
    }
  });

  /**
   * What can stand in the way.
   *
   * Meshes only, and only ones that write depth. A `Sprite` is a billboard
   * that turns to face whatever camera is looking (and three refuses to
   * raycast one without a camera to turn it towards), a glass pane or a glow
   * is drawn through, and neither hides a seam from anybody. Counting them
   * would *dismiss* real findings, which is the one direction this must never
   * err in.
   */
  const occluders: Object3D[] = [];
  world.scene.traverse((node) => {
    const mesh = node as { isMesh?: boolean; material?: unknown };
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const solid = materials.some((material) => {
      const record = material as { transparent?: boolean; depthWrite?: boolean } | undefined;
      return record ? record.depthWrite !== false && record.transparent !== true : false;
    });
    if (solid) occluders.push(node);
  });

  const raycaster = new Raycaster();
  raycaster.far = CAMERA_DISTANCE;
  const origin = new Vector3();
  const ranked: RankedSeam[] = [];
  try {
    for (const pair of pairs) {
      origin.copy(pair.normal).multiplyScalar(RAY_LIFT).add(pair.at);
      raycaster.set(origin, EYE_DIRECTION);
      const occluded = raycaster.intersectObjects(occluders, false).length > 0;
      const reach = occluded ? OUT_OF_REACH : nearestStandingSpot(pair.at, world);
      ranked.push({
        ...pair,
        occluded,
        reach,
        // A metre is the floor on the divisor: a seam she is standing on top
        // of is not infinitely worse than one a metre away, and without it the
        // ordering would be decided by rounding.
        score: occluded || reach === OUT_OF_REACH ? 0 : pair.area / Math.max(reach, 1),
      });
    }
  } finally {
    for (const [node, was] of restore) node.visible = was;
  }

  ranked.sort((a, b) => b.score - a.score || b.area - a.area);
  return ranked;
}

/**
 * Distance to the nearest spot a child could stand and look at this seam.
 *
 * A ring search rather than a grid: the answer wanted is the *nearest*, so the
 * first ring that offers anything is the answer and there is no need to visit
 * the rest. Half-metre rings, sixteen bearings — fine enough that a seam in a
 * doorway is not reported as unreachable because both probes missed the gap.
 */
function nearestStandingSpot(at: Vector3, world: RankInputs): number {
  let best = OUT_OF_REACH;
  for (let radius = 0.5; radius <= SEARCH_LIMIT; radius += 0.5) {
    for (let bearing = 0; bearing < 16; bearing += 1) {
      const angle = (bearing / 16) * Math.PI * 2;
      const x = at.x + Math.cos(angle) * radius;
      const z = at.z + Math.sin(angle) * radius;
      if (!world.collision.isClearCircle(x, z, PLAYER_RADIUS)) continue;
      const y = world.sample(x, z, at.y);
      const distance = Math.hypot(x - at.x, y - at.y, z - at.z);
      if (distance < best) best = distance;
    }
    if (best < OUT_OF_REACH) return best;
  }
  return best;
}
