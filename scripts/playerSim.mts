/**
 * **One faithful copy of `Player.update`'s movement integration**, driving the
 * **real** `CollisionWorld` — not a model of one.
 *
 * It exists because two measurement scripts need the same walking girl:
 * `measure-hop-clearance.mts` (how tall a wall does the hop actually clear?)
 * and `measure-wall-tunnelling.mts` (can a long frame carry her through one?).
 * They used to be able to drift apart, and a measurement taken against a copy
 * that no longer matches the game is worse than no measurement at all — so
 * there is exactly **one** copy here, and it is the thing to re-check against
 * `Player.update` if that is ever restructured.
 *
 * The order below is `Player.update`'s order, and the order matters:
 * accelerate → step + `resolve` → escort latch → velocity read-back →
 * auto-hop lookahead → vertical integration → `hopClearance`.
 *
 * Two things are deliberately left out, because neither script has them:
 * uneven ground (everything here stands on y = 0) and the fall-off-a-deck
 * check that goes with it.
 */
import { Vector3 } from 'three';
import type { CollisionWorld } from '../src/world/Collision.ts';
import {
  PLAYER_ACCELERATION,
  PLAYER_DECELERATION,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  PLAYER_SPRINT_MULTIPLIER,
} from '../src/core/constants.ts';

/**
 * `Player.ts`'s own numbers, restated. Not imported: `Player.ts` pulls in
 * three.js meshes and the DOM, neither of which exists here, and only
 * `JUMP_APEX_HEIGHT` is exported anyway. `CollisionWorld.checkHoppableColliders`
 * is what stops these drifting unnoticed — it compares the live apex against
 * the one recorded in `Collision.ts` as having been measured.
 */
export const JUMP_SPEED = 6.6;
export const GRAVITY = 17;
export const JUMP_APEX_HEIGHT = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
export const AUTO_HOP_LOOKAHEAD = 0.5;

/** `Player.ts`'s `approach`, verbatim. */
function approach(current: Vector3, target: Vector3, maxDelta: number): void {
  const dx = target.x - current.x;
  const dz = target.z - current.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= maxDelta || distance < 1e-6) {
    current.x = target.x;
    current.z = target.z;
    return;
  }
  const scale = maxDelta / distance;
  current.x += dx * scale;
  current.z += dz * scale;
}

/**
 * "Should a hop fire from here?", asked with the probe point `Player` would
 * have used. The default — never — is a player who only walks.
 *
 * A callback rather than a flag because the two scripts want different
 * answers. The tunnelling harness wants the real
 * `CollisionWorld.wouldAutoHopClear`; the hop-clearance harness deliberately
 * wants the same lookahead *geometry* with the height policy removed, because
 * that policy is the very thing it exists to measure and asking it would only
 * confirm it back to us.
 */
export type HopProbe = (probe: Vector3) => boolean;

export interface SimOptions {
  hopProbe?: HopProbe;
  radius?: number;
  /**
   * **The control.** `false` reproduces the single-step integration `Player`
   * used before substepping landed — `position += velocity·dt`, then one
   * `resolve` — which is what let a stuttering frame carry her clean through a
   * wall. Kept, and kept exercised by `measure-wall-tunnelling.mts`, so the
   * bug can still be *shown* rather than only asserted against: a fix nobody
   * can demonstrate the absence of is a fix nobody can defend later.
   */
  substepping?: boolean;
}

export class SimPlayer {
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly previousPosition = new Vector3();

  verticalVelocity = 0;
  airborne = false;
  /** Feet height above the ground, one frame stale — exactly as in `Player`. */
  hopClearance = 0;
  /** `Player`'s escort latch (PR #59): held until corrections stop entirely. */
  escorting = false;

  /** What the last step's `resolve` reported, for a caller that watches it. */
  clearedWall = false;
  corrected = false;
  /** True if the last step's correction was deep enough to count as an escort. */
  deepThisStep = false;
  /**
   * How much **further** the last step actually carried her than she asked to
   * go, in metres — the fling watch.
   *
   * Zero or negative every ordinary frame: being blocked is a constraint, so
   * it can only ever take distance away. Positive means something pushed her
   * along, and the only thing allowed to is a depenetration escort, which is
   * capped at `MAX_DEPENETRATION_SPEED · dt`. Anything above that cap is
   * design feedback #17's fling coming back.
   */
  lastOvershoot = 0;

  private readonly collision: CollisionWorld;
  private readonly hopProbe: HopProbe;
  readonly radius: number;
  private readonly substepping: boolean;

  private readonly moveDirection = new Vector3();
  private readonly desired = new Vector3();
  private readonly probe = new Vector3();

  constructor(collision: CollisionWorld, options: SimOptions = {}) {
    this.collision = collision;
    this.hopProbe = options.hopProbe ?? (() => false);
    this.radius = options.radius ?? PLAYER_RADIUS;
    this.substepping = options.substepping ?? true;
  }

  /**
   * One frame. `dirX`/`dirZ` are the stick, already in world space (the camera
   * basis is a rotation, so measuring against an axis-aligned wall loses
   * nothing); `sprint` is the button.
   */
  step(dt: number, dirX: number, dirZ: number, sprint: boolean): void {
    this.moveDirection.set(dirX, 0, dirZ);
    const inputLength = this.moveDirection.length();
    const speedLimit = PLAYER_MAX_SPEED * (sprint ? PLAYER_SPRINT_MULTIPLIER : 1);

    this.desired.set(0, 0, 0);
    if (inputLength > 1e-4) this.desired.copy(this.moveDirection).multiplyScalar(speedLimit);

    const rate = inputLength > 1e-4 ? PLAYER_ACCELERATION : PLAYER_DECELERATION;
    approach(this.velocity, this.desired, rate * dt);

    this.previousPosition.copy(this.position);
    const deltaX = this.velocity.x * dt;
    const deltaZ = this.velocity.z * dt;

    let result;
    if (this.substepping) {
      result = this.collision.resolveMovement(
        this.position,
        deltaX,
        deltaZ,
        this.radius,
        this.hopClearance,
        dt,
      );
    } else {
      this.position.x += deltaX;
      this.position.z += deltaZ;
      result = this.collision.resolve(this.position, this.radius, this.hopClearance, dt);
    }

    this.clearedWall = result.clearedWall;
    this.corrected = result.corrected;
    this.deepThisStep = result.escorting;
    this.lastOvershoot =
      Math.hypot(
        this.position.x - this.previousPosition.x,
        this.position.z - this.previousPosition.z,
      ) - Math.hypot(deltaX, deltaZ);
    this.escorting = result.corrected && (result.escorting || this.escorting);

    if (dt > 0 && !this.escorting) {
      const previousSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      const derivedX = (this.position.x - this.previousPosition.x) / dt;
      const derivedZ = (this.position.z - this.previousPosition.z) / dt;
      if (Math.hypot(derivedX, derivedZ) <= previousSpeed) {
        this.velocity.x = derivedX;
        this.velocity.z = derivedZ;
      }
    }

    let autoHopWanted = false;
    if (!this.airborne && inputLength > 1e-4) {
      const inverse = 1 / inputLength;
      this.probe
        .copy(this.position)
        .addScaledVector(this.moveDirection, AUTO_HOP_LOOKAHEAD * inverse);
      autoHopWanted = this.hopProbe(this.probe);
    }
    if (autoHopWanted && !this.airborne) {
      this.verticalVelocity = JUMP_SPEED;
      this.airborne = true;
    }

    if (this.airborne) {
      this.verticalVelocity -= GRAVITY * dt;
      this.position.y += this.verticalVelocity * dt;
      if (this.position.y <= 0) {
        this.position.y = 0;
        this.verticalVelocity = 0;
        this.airborne = false;
      }
    }
    this.hopClearance = this.position.y;
  }
}
