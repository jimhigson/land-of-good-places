import type { Vector3 } from 'three';
import type { CollisionWorld } from './Collision';
import type { GroundSampler } from '../entities/Player';
import { carryReference, stepCeilingAt } from './building/stepReach';
import { PLAYER_RADIUS } from '../core/constants';
import { KID_HEIGHT } from '../art/models/kidHeight';

/**
 * **Where her feet come to rest at `(x, z)`, reached from height `y`** — the
 * higher of the ground there (the terrain, a castle floor, a ramp, a bridge
 * deck: whatever the walk sampler says) and the top of the highest solid whose
 * footprint covers the point, within the same one-step reach.
 *
 * Jim, 17 Oct 2026: *"anything should be jumpable with no special 'floor'
 * being marked to make it so."* This is the whole of that, for the feet: a
 * solid's top is somewhere to land because the solid is solid. Nothing
 * registers a floor on top of a bench, a crate or a garden wall; the
 * `CollisionWorld` that stops her walking through one is asked where its top
 * is ({@link CollisionWorld.highestTopAt}) and that is the answer.
 *
 * The one owner of the rule, for everything that moves her: `Player`'s own
 * ground query, and `scripts/playerSim.mts`, the measuring rigs' copy of her
 * movement, which must land where she lands or measure a different girl.
 *
 * The reach is {@link stepCeilingAt}'s, the same one the walk sampler spends,
 * measured from the same reference — so a top is in reach exactly when a deck
 * at that height would be, and a jump that has carried her feet within a step
 * of a top, over it, puts her on it — and only where she fits under whatever
 * hangs over it ({@link solidStepCeiling}).
 *
 * Deliberately **not** what the route lattice, the crowd or the park generator
 * stand on. They ask the walk sampler alone (`WalkSurfaces.sample`), the
 * ground: nobody else in the park jumps, so a solid's top is somewhere only
 * she can be, and keeping it out of their world keeps every route, every
 * crowd walk and every generated park exactly what it was. See
 * HANDOFF-engine-solids.md, "who stands on what".
 */
export function standingHeight(ground: number, collision: CollisionWorld, x: number, z: number, y: number): number {
  const top = collision.highestTopAt(x, z, solidStepCeiling(collision, x, z, y));
  return top > ground ? top : ground;
}

/**
 * **Her feet's sampler** — `ground`'s surface, or the top of a solid within a
 * step, whichever is higher: {@link standingHeight} over a whole sampler. What
 * `Player` stands on (`groundAt`), what her lattice reads its levels from
 * (`NavGrid`'s `standsOnSolids`), and what a check that asks the put-down rule
 * "as `Player` asks it" must hand the rule.
 */
export function feetSampler(ground: GroundSampler, collision: CollisionWorld): GroundSampler {
  return (x, z, y) => standingHeight(ground(x, z, y), collision, x, z, y);
}

/**
 * **The highest solid top she can step or come down onto at `(x, z)`, from
 * `reference`** — one step's reach ({@link stepCeilingAt}, the walk sampler's
 * own), and no higher than leaves room for her whole body under whatever hangs
 * over the point (`CollisionWorld.ceilingAt`, the underside her rising head
 * stops at in {@link riseUnder}).
 *
 * **Headroom.** A bench under a bus shelter's canopy, a cart under its
 * parasol: a top she cannot stand on without her head inside the solid above
 * it is not somewhere to stand. Measured against the reach rather than after
 * it, so the lateral rule (`resolve`'s `'stepped'`), her feet
 * ({@link standingHeight}) and her lattice all refuse the same tops — such a
 * top is a side she bumps, not a step she takes and is then shoved off by the
 * thing over it. The one owner of the rule for everything that stands on
 * solids.
 */
export function solidStepCeiling(collision: CollisionWorld, x: number, z: number, reference: number): number {
  return Math.min(stepCeilingAt(x, z, reference), collision.ceilingAt(x, z, reference) - KID_HEIGHT);
}

/**
 * How far ahead of her centre, along the way she is walking, a step up is
 * looked for: just past her front edge (`PLAYER_RADIUS` and a hand's breadth).
 */
export const STEP_LOOKAHEAD = PLAYER_RADIUS + 0.1;

/** How many points along her front half {@link walkingOntoStep} asks, from her middle to {@link STEP_LOOKAHEAD}. */
const STEP_SAMPLES = 8;

/**
 * **Is she walking straight into a solid she can step up onto?** — a top
 * within one step of the surface she stands on, under any point of the
 * stretch from her middle to just past her front edge in the direction she is
 * walking (`dirX`/`dirZ`, a unit vector).
 *
 * A step up onto a 0.44 m bench is the step up onto a 0.44 m deck: one step,
 * `BUILDING_STEP_UP`, the same reach the walk sampler has always spent on the
 * castle's porch and the hotel's stairs. Floors are not a special kind of
 * thing any more, so neither is stepping onto one.
 *
 * Asked along the way she is walking, never beside her, for the one reason
 * that makes it look right: walking *into* a bench she climbs it, and walking
 * *past* one she brushes along its side — a bench beside her is a side to
 * slide along, never something her body sinks into; once her middle is over
 * the top, the sampler stands her on it.
 *
 * **The whole stretch, not its far end** (PR #722's QA). A top narrower than
 * that stretch — the reptile house's foyer log, standable ±0.2 m either side
 * of its line — is under the point past her front edge only for the first
 * part of the way in: asked there alone, she was let in while that point was
 * over the log, shoved back out the moment it had passed beyond it, and let
 * in again, eight times a second, never climbing. Under any point of her
 * front half, it is a step for the whole of the way in, and she stands on it.
 */
export function walkingOntoStep(
  collision: CollisionWorld,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  reference: number,
): boolean {
  for (let i = 1; i <= STEP_SAMPLES; i += 1) {
    const along = (STEP_LOOKAHEAD * i) / STEP_SAMPLES;
    const aheadX = x + dirX * along;
    const aheadZ = z + dirZ * along;
    const from = carryReference(x, z, reference, aheadX, aheadZ);
    const ceiling = solidStepCeiling(collision, aheadX, aheadZ, from);
    // A top over the surface she stands on: a step *up*. The top she is
    // already on — her own wall's, met by the near half of the stretch — is
    // not one, or walking along a wall she would sink into a bench beside it.
    if (collision.highestTopAt(aheadX, aheadZ, ceiling) > from + STEP_ABOVE) return true;
  }
  return false;
}

/** How far over the surface she stands on a top must be to be a step up rather than where she is: float noise and the clearance grace's flat edge. */
const STEP_ABOVE = 0.02;

/**
 * **One frame of vertical motion in the air, and a head that stops at an
 * underside** — moves `position.y` by `velocity·dt` and returns the vertical
 * velocity she keeps.
 *
 * A solid that begins above the ground (a canopy, a deck's rail) is a ceiling
 * to a body moving up into it: rising, the top of her head (`bodyHeight` above
 * her feet) may not pass the lowest underside over her
 * (`CollisionWorld.ceilingAt`), and meeting one takes her upward speed away,
 * so she drops back rather than standing with her head through a roof. The
 * sides of such a solid are the lateral rule's (`resolve`, given her height);
 * this is the one direction that rule cannot see. `Player` and
 * `scripts/playerSim.mts` both rise through here.
 */
export function riseUnder(collision: CollisionWorld, position: Vector3, velocity: number, dt: number, bodyHeight: number): number {
  const head = position.y + bodyHeight;
  position.y += velocity * dt;
  if (velocity <= 0) return velocity;
  const ceiling = collision.ceilingAt(position.x, position.z, head - 1e-6);
  if (position.y + bodyHeight <= ceiling) return velocity;
  position.y = ceiling - bodyHeight;
  return 0;
}
