import { GRAVITY, GROUND_SPHERE_RADIUS, JUMP_SPEED, PLAYER_HEIGHT_DAMP_HALF_LIFE, PLAYER_MAX_SPEED, PLAYER_SPRINT_MULTIPLIER } from '../core/constants';
import { SPACE_GARDEN, spaceAt } from './spaces';
import { JUMP_CLEARANCE_GRACE } from './Collision';

/**
 * **How high her feet can be, anywhere a jump can take them** — the one owner
 * of the question a guard has to answer: is it taller than every jump she can
 * make at it?
 *
 * QA on PR #722: a sprint down a humpback bridge's ramp, then a jump, cleared
 * its 1.67 m railing by half a metre and dropped her four metres — the deck
 * falls away from her as she flies, so over it her feet are higher than the
 * 1.28 m she jumps. Her jump is right (the same in every direction since the
 * flight carries her radius); a guard measured only against the ground beside
 * it is what was wrong. So a guard is measured against the highest her feet
 * can actually get over its line: from every point she can leave within a
 * jump of it, at any speed up to her sprint, along the radial up her flight
 * keeps — {@link jumpRiseAt}.
 */

/** Her fastest across the ground, metres/second: a sprint. */
export const SPRINT_SPEED = PLAYER_MAX_SPEED * PLAYER_SPRINT_MULTIPLIER;

/** Her jump's top over the ground she left, in the limit of a fine frame clock. */
const APEX = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
/** How long she takes to rise to it. */
const APEX_TIME = JUMP_SPEED / GRAVITY;

/**
 * How far on in plan a sprint-jump comes back down to the height it left
 * from: past this, nothing she leaves from is over the guard.
 */
export const JUMP_PLAN_REACH = SPRINT_SPEED * 2 * APEX_TIME;

/**
 * **The highest her feet can be over the ground she left, `distance` metres
 * on in plan** — the envelope of every jump she can make: at her apex for
 * anything up to a sprint's run to it (she can run slower and top out there),
 * and on her sprint's own arc beyond it, coming down. In metres along the
 * radial up, which is the height her flight keeps.
 */
export function jumpRiseAt(distance: number): number {
  if (distance <= SPRINT_SPEED * APEX_TIME) return APEX;
  const t = distance / SPRINT_SPEED;
  return JUMP_SPEED * t - (GRAVITY * t * t) / 2;
}

/**
 * **How far her feet trail above ground falling away under a run**, metres,
 * for ground falling `descent` metres per metre she runs at her sprint: the
 * height damping (`PLAYER_HEIGHT_DAMP_HALF_LIFE`) follows a falling ground
 * from above, so a jump off a ramp she sprints down leaves from that much
 * over it (about 0.2 m on a ramp falling 0.3 m a metre).
 */
export function runLagOver(descent: number): number {
  return descent > 0 ? (SPRINT_SPEED * descent * PLAYER_HEIGHT_DAMP_HALF_LIFE) / Math.LN2 : 0;
}

/**
 * **How fast a run across the planet takes the ground down under her, in
 * world `y`, metres a metre** — for a run from `(x, z)` the way `(dirX,
 * dirZ)` (a unit vector) goes, over ground that is level over the planet:
 * the lean alone, outward. Her drawn height damps after the ground in world
 * `y`, so a run outward leaves her above whatever she runs on, level or not —
 * a row of bushes at the park's edge as much as a bank — and a jump leaves
 * from there (`Player`'s take-off: her drawn height, where it is over the
 * ground). PR #722, round three: sprinting along bush tops 77 m out on seed
 * 10, she took off 0.34 m over them and cleared a fence sized as if a top
 * were somewhere she could not lag over.
 */
export function leanFall(x: number, z: number, dirX: number, dirZ: number): number {
  const r = Math.hypot(x, z);
  if (r < 1e-6 || spaceAt(x, z) !== SPACE_GARDEN) return 0;
  const outward = (x * dirX + z * dirZ) / r;
  if (outward <= 0) return 0;
  return (r / Math.sqrt(Math.max(1, GROUND_SPHERE_RADIUS * GROUND_SPHERE_RADIUS - r * r))) * outward;
}

/**
 * **The highest her feet get at `(x, z)` over a takeoff at `(fromX, fromZ)`,
 * `distance` metres short of it in plan** — {@link jumpRiseAt}, over the lag
 * a run that way leaves her at: `descent`, the takeoff's own ground falling
 * along the run (a level top's is 0), and the planet's lean ({@link
 * leanFall}). `distance` is the jump's own: to a top's nearest edge, it is
 * less than the way from its middle, which gives the run's direction alone.
 */
export function riseOverTakeoff(fromX: number, fromZ: number, x: number, z: number, distance: number, descent = 0): number {
  const across = Math.hypot(x - fromX, z - fromZ);
  const ux = across > 1e-6 ? (x - fromX) / across : 0;
  const uz = across > 1e-6 ? (z - fromZ) / across : 0;
  return runLagOver(descent + leanFall(fromX, fromZ, ux, uz)) + jumpRiseAt(distance);
}

/**
 * How much a guard keeps over what she can clear, past the clearance grace
 * below. Her frame clock only ever takes her lower than the continuous arc
 * {@link jumpRiseAt} is (1.2267 m at 60 fps, 1.2538 m at 120, against
 * 1.2812 m in the limit), so this is for the guard's own sampling, not for her.
 */
export const GUARD_MARGIN = 0.05;

/**
 * **What a guard has to stand over the highest her feet get**: the resolver
 * lets her through anything whose top is within `JUMP_CLEARANCE_GRACE` of her
 * feet (a jump that grazes a wall's top hops it), so a guard under her feet's
 * highest by less than that is a guard she clears — and once she is over its
 * line, it pushes her out on the far side. Seed 4: a sprint along a bridge's
 * deck over the line, a jump down the ramp, her feet 3.7 cm under the railing,
 * and she was through it and on the track five metres below. Plus
 * {@link GUARD_MARGIN}.
 */
export const GUARD_OVER_FEET = JUMP_CLEARANCE_GRACE + GUARD_MARGIN;

/** A place she can jump from: its plan position, the radius her feet leave from, and how fast that ground falls away along each axis. */
export interface Takeoff {
  readonly x: number;
  readonly z: number;
  /** Her feet's distance from the planet's centre, standing there. */
  readonly radius: number;
  /** The ground's radius gained per metre along +x and +z, there (its gradient). */
  readonly slopeX: number;
  readonly slopeZ: number;
}

/**
 * **The radius a guard at `(x, z)` must stand to, to stop every jump she can
 * make at it** from `takeoffs` — the highest her feet get over its line
 * ({@link jumpRiseAt} from each, with the lag a run down that ground leaves
 * her at, {@link runLagOver}), plus {@link GUARD_OVER_FEET}. `-Infinity` when
 * no takeoff is within a jump of it.
 */
export function guardRadiusNeeded(takeoffs: Iterable<Takeoff>, x: number, z: number): number {
  let need = -Infinity;
  for (const q of takeoffs) {
    const dx = x - q.x;
    const dz = z - q.z;
    const distance = Math.hypot(dx, dz);
    if (distance > JUMP_PLAN_REACH) continue;
    // The ground's fall along her run towards the guard, and the planet's.
    const descent = distance > 1e-6 ? -(q.slopeX * dx + q.slopeZ * dz) / distance : 0;
    need = Math.max(need, q.radius + riseOverTakeoff(q.x, q.z, x, z, distance, descent));
  }
  return need + GUARD_OVER_FEET;
}
