/**
 * **What a check means by "she can stand here"**, in the one engine's terms —
 * so a flood, a sweep or a landing probe measures the rule `Player` obeys, not
 * an older picture of it.
 *
 * Since the engine rework (HANDOFF-engine-solids.md) a solid is somewhere she
 * stands as well as something she bumps: a top within one step of her feet
 * (`BUILDING_STEP_UP`) is climbed exactly as a deck of that height is, and a
 * jump that carries her over any top within reach puts her on it
 * (`world/standing.ts`). A floor-level `isClearCircle` therefore says a
 * cushion on the story rug walls the rug off, when she simply steps onto it.
 */
import { Vector3 } from 'three';
import type { CollisionWorld } from '../../src/world/Collision.ts';
import { stepCeilingAt } from '../../src/world/building/stepReach.ts';
import { standingHeight } from '../../src/world/standing.ts';

const probe = new Vector3();

/**
 * Can a body of `radius` stand at `(x, z)` with her feet at `feetY` — clear of
 * every solid she could not step up onto from there? The lateral rule `resolve`
 * enforces, asked as a question: `deepestSolidOverlap` with her step's reach.
 */
export function walkableAt(collision: CollisionWorld, x: number, z: number, radius: number, feetY: number): boolean {
  probe.set(x, feetY, z);
  return collision.deepestSolidOverlap(probe, radius, 0, (px, pz) => stepCeilingAt(px, pz, feetY)) <= 1e-9;
}

/**
 * Where her feet come to rest at `(x, z)` reached from `y`: the walk sampler's
 * ground or the top of a solid she is over, whichever is higher and within a
 * step — `Player.groundAt`'s own rule, through the one function it asks.
 */
export function standingAt(
  collision: CollisionWorld,
  sample: (x: number, z: number, y: number) => number,
  x: number,
  z: number,
  y: number,
): number {
  return standingHeight(sample(x, z, y), collision, x, z, y);
}
