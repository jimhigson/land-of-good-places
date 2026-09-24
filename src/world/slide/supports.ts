import { CylinderGeometry, Group, Mesh } from 'three';
import { PALETTE } from '../../core/palette';
import { toonMaterial } from '../../art/style/materials';
import type { CollisionWorld } from '../Collision';

/** Radius of the post at the top, and at its foot. */
const TOP_RADIUS = 0.34;
export const FOOT_RADIUS = 0.52;

/** What the post occupies in the collision world. */
const POST_COLLISION_RADIUS = 0.42;

export interface SlideLeg {
  readonly x: number;
  readonly z: number;
  /** Terrain height at its foot. */
  readonly ground: number;
  /** Height of the chute floor above it. */
  readonly top: number;
}

/**
 * Builds the legs, in **world space**, to be added at park level.
 *
 * Deliberately *not* under the castle's own anchor group, where the chute
 * itself hangs. `check:park`'s invariant 6 measures everything under an
 * anchor's group against the `boundingRadius` that anchor declares — the
 * promise every other builder routes and scatters around — and a leg 19.1 m
 * from the castle's centre breaks a 19 m promise. Which is the check being
 * right, not inconvenient: content out there is content nobody planned around.
 *
 * But a leg is not the castle's content. This ride *spans* two plots, and its
 * supports stand in the park between them, so the honest place for them is the
 * park, not the tower. They earn their own safety instead of inheriting the
 * castle's: every one stands on ground vetted by `isClearCircle`, keeps
 * {@link PATH_CLEARANCE} off the paved network, and is registered as a solid
 * circle so the nav lattice knows it is there.
 */
export function buildSlideSupports(
  legs: readonly SlideLeg[],
  collision: CollisionWorld,
): Group {
  const group = new Group();
  group.name = 'ginormous-slide-supports';

  // One unit-height cylinder, scaled per leg: a handful of posts, so the
  // sharing is for tidiness rather than for draw calls. Tapered, and chunkier
  // at the foot, because a straight thin pole reads as scaffolding and this
  // park's things are meant to look planted.
  const geometry = new CylinderGeometry(TOP_RADIUS, FOOT_RADIUS, 1, 10);
  const material = toonMaterial(PALETTE.slideRail);

  for (const leg of legs) {
    const height = leg.top - leg.ground;
    const post = new Mesh(geometry, material);
    post.name = 'ginormous-slide-leg';
    post.scale.set(1, height, 1);
    // Sunk slightly, so a leg never floats above uneven ground.
    post.position.set(leg.x, leg.ground + height / 2 - 0.15, leg.z);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);

    collision.addCircle(leg.x, leg.z, POST_COLLISION_RADIUS);
  }

  return group;
}
