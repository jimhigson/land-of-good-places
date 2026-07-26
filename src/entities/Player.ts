import { Group, Vector3 } from 'three';
import {
  CAMERA_YAW_DEGREES,
  PLAYER_ACCELERATION,
  PLAYER_BOB_CYCLES_PER_METRE,
  PLAYER_BOB_HEIGHT,
  PLAYER_DECELERATION,
  PLAYER_MAX_SPEED,
  PLAYER_RADIUS,
  PLAYER_TURN_SPEED,
} from '../core/constants';
import { PALETTE } from '../core/palette';
import { clamp01, damp, DEG, lerp, TAU, turnTowards } from '../core/mathUtils';
import type { FrameContext, GameSystem } from '../core/types';
import type { IsoCamera } from '../core/IsoCamera';
import type { CollisionWorld } from '../world/Collision';
import { terrainHeight } from '../world/terrain';
import { CharacterModel } from './CharacterModel';
import { NameLabel } from '../ui/NameLabel';
import { gameStore } from '../state';

/** Extra speed multiplier while the sprint action is held. */
const SPRINT_MULTIPLIER = 1.5;

const JUMP_SPEED = 5.4;
const GRAVITY = 17;

/**
 * The player character: movement, collision, and the walk animation.
 *
 * Movement is camera-relative — pushing the stick "up" always walks up the
 * screen, whichever of the four isometric views is active — and velocity is
 * accelerated towards the target rather than snapped, so starting and stopping
 * has a bit of weight to it.
 *
 * The walk cycle is driven by *distance travelled*, not by time. That is what
 * stops the legs skating: at half speed the character takes half as many steps
 * over the same ground, exactly as it should.
 */
export class Player implements GameSystem {
  readonly name = 'player';
  readonly group = new Group();
  readonly model: CharacterModel;
  readonly label: NameLabel;

  /** Feet position in world space. */
  readonly position = new Vector3();
  readonly velocity = new Vector3();

  private readonly desiredVelocity = new Vector3();
  private readonly moveDirection = new Vector3();
  private readonly previousPosition = new Vector3();

  /** Start facing the camera, so the first thing you see is her face. */
  private facing = CAMERA_YAW_DEGREES * DEG;
  private walkPhase = 0;
  /** 0 = standing still, 1 = flat out. Smoothed, drives animation blending. */
  private gait = 0;
  private verticalVelocity = 0;
  private airborne = false;
  private blinkTimer = 2.4;
  private blinkAmount = 0;

  constructor(
    private readonly collision: CollisionWorld,
    private readonly camera: IsoCamera,
    spawn: Vector3,
  ) {
    this.group.name = 'player';

    const playerState = gameStore.get().player;
    this.model = new CharacterModel({
      skin: PALETTE.skin,
      hair: playerState.hairColour,
      outfit: playerState.outfitColour,
      shoe: PALETTE.shoe,
    });
    this.group.add(this.model.root);

    this.label = new NameLabel(playerState.name);
    this.label.sprite.position.y = this.model.height + 0.42;
    this.group.add(this.label.sprite);

    this.position.copy(spawn);
    this.position.y = terrainHeight(spawn.x, spawn.z);
    this.previousPosition.copy(this.position);
    this.group.position.copy(this.position);
  }

  /** Puts the character somewhere immediately, clearing momentum. */
  teleport(x: number, z: number): void {
    this.position.set(x, terrainHeight(x, z), z);
    this.previousPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.group.position.copy(this.position);
  }

  update(context: FrameContext): void {
    const { dt, input } = context;

    // --- intent -----------------------------------------------------------
    // Map stick/keys onto the camera's ground basis so "up" is always up-screen.
    this.moveDirection
      .set(0, 0, 0)
      .addScaledVector(this.camera.right, input.moveX)
      .addScaledVector(this.camera.forward, input.moveY);

    const inputLength = this.moveDirection.length();
    const speedLimit = PLAYER_MAX_SPEED * (input.isDown('sprint') ? SPRINT_MULTIPLIER : 1);

    if (inputLength > 1e-4) {
      this.desiredVelocity.copy(this.moveDirection).multiplyScalar(speedLimit);
    } else {
      this.desiredVelocity.set(0, 0, 0);
    }

    // --- acceleration -------------------------------------------------------
    const rate = inputLength > 1e-4 ? PLAYER_ACCELERATION : PLAYER_DECELERATION;
    approach(this.velocity, this.desiredVelocity, rate * dt);

    // --- horizontal movement + collision ------------------------------------
    this.previousPosition.copy(this.position);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.collision.resolve(this.position, PLAYER_RADIUS);

    // Trust the resolved position over the intended one, so walking into a wall
    // actually kills the momentum instead of grinding against it.
    if (dt > 0) {
      this.velocity.x = (this.position.x - this.previousPosition.x) / dt;
      this.velocity.z = (this.position.z - this.previousPosition.z) / dt;
    }

    const groundY = terrainHeight(this.position.x, this.position.z);

    // --- hop ----------------------------------------------------------------
    if (input.justPressed('jump') && !this.airborne) {
      this.verticalVelocity = JUMP_SPEED;
      this.airborne = true;
    }
    let hopHeight = 0;
    if (this.airborne) {
      this.verticalVelocity -= GRAVITY * dt;
      this.position.y += this.verticalVelocity * dt;
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.verticalVelocity = 0;
        this.airborne = false;
      }
      hopHeight = this.position.y - groundY;
    } else {
      // Damp onto the ground so walking over the gentle hills isn't jittery.
      this.position.y = damp(this.position.y, groundY, 0.04, dt);
    }

    this.group.position.copy(this.position);

    // --- facing -------------------------------------------------------------
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (planarSpeed > 0.35) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      this.facing = turnTowards(this.facing, target, PLAYER_TURN_SPEED * dt);
    }
    this.group.rotation.y = this.facing;

    // --- animation ----------------------------------------------------------
    this.gait = damp(this.gait, clamp01(planarSpeed / PLAYER_MAX_SPEED), 0.07, dt);
    this.walkPhase += planarSpeed * PLAYER_BOB_CYCLES_PER_METRE * TAU * dt;
    if (this.walkPhase > TAU) this.walkPhase -= TAU;

    this.animate(context, hopHeight);
  }

  /** Renames the character and rebuilds the floating label. */
  setName(name: string): void {
    gameStore.setPlayerName(name);
    this.label.setName(gameStore.get().player.name);
  }

  dispose(): void {
    this.label.dispose();
  }

  // -------------------------------------------------------------- internals

  private animate({ elapsed, dt }: FrameContext, hopHeight: number): void {
    const model = this.model;
    const gait = this.gait;
    const phase = this.walkPhase;

    // Bob: the body rises on each step. Two bumps per stride, hence phase * 2.
    const bob = Math.abs(Math.sin(phase)) * PLAYER_BOB_HEIGHT * gait;
    // Idle breathing keeps the character alive when standing still.
    const breathe = Math.sin(elapsed * 1.9) * 0.014 * (1 - gait);
    model.body.position.y = bob + breathe + hopHeight * 0.12;

    // Squash and stretch: compressed at the bottom of the step, stretched at
    // the top. Small numbers — any more and it looks like jelly.
    const squash = 1 - Math.cos(phase * 2) * 0.045 * gait;
    model.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));

    // Lean into the run, and roll gently side to side.
    model.body.rotation.x = lerp(0, -0.13, gait) + (this.airborne ? -0.1 : 0);
    model.body.rotation.z = Math.sin(phase) * 0.045 * gait;

    // Head lags behind the body a touch — a tiny bit of secondary motion does
    // more for the feeling of weight than anything else here.
    model.head.rotation.z = -Math.sin(phase) * 0.07 * gait;
    model.head.rotation.x = Math.sin(phase * 2 + 0.6) * 0.035 * gait + breathe * 2;
    model.head.position.y = 1.34 + Math.sin(phase * 2 + 1.2) * 0.012 * gait;

    // Arms and legs swing in opposition.
    const swing = Math.sin(phase) * (0.95 * gait);
    const armLift = this.airborne ? -0.9 : 0;
    model.leftArm.rotation.x = swing + armLift;
    model.rightArm.rotation.x = -swing + armLift;
    model.leftArm.rotation.z = 0.12 + gait * 0.08;
    model.rightArm.rotation.z = -0.12 - gait * 0.08;

    const legSwing = Math.sin(phase) * (0.85 * gait);
    model.leftLeg.rotation.x = -legSwing;
    model.rightLeg.rotation.x = legSwing;

    // Blinking: a long pause, then a quick close-and-open.
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2.6 + Math.random() * 3.4;
      this.blinkAmount = 1;
    }
    this.blinkAmount = Math.max(0, this.blinkAmount - dt * 9);
    const eyeScale = 1 - this.blinkAmount * 0.92;
    for (const eye of model.eyes) eye.scale.y = eyeScale;

    // The name label counter-rotates so it never tips with the character.
    this.label.sprite.position.y =
      this.model.height + 0.42 + bob + Math.sin(elapsed * 1.3) * 0.03;
  }
}

/** Moves `current` towards `target` by at most `maxDelta`, componentwise in XZ. */
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
