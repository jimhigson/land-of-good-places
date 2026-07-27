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
import type { Expression } from '../art/style/faces';
import { createRainbowRings, type RainbowRings } from '../art/effects/rainbowRing';
import { NameLabel } from '../ui/NameLabel';
import { gameStore } from '../state';

/** Extra speed multiplier while the sprint action is held. */
const SPRINT_MULTIPLIER = 1.5;

/**
 * Tuned so the jump clears the low and mid garden walls but not the tall
 * ones (design feedback #10 — "jump over walls").
 *
 * Wooden + stone wall heights across the garden (`Scenery.ts`), sorted:
 * 0.7, 0.7, 0.85, 0.85, 0.95, 0.95, 0.95, 1.15, 1.2, 1.2, 1.25, 1.4 | 1.5,
 * 1.75, 1.8, 2.1, 2.3, 2.6 — the lower two-thirds (12 of 18) top out at 1.4 m,
 * the tallest third starts at 1.5 m. `JUMP_SPEED` gives an apex of
 * `JUMP_SPEED² / (2·GRAVITY)` ≈ 1.28 m; added to `JUMP_CLEARANCE_GRACE` in
 * `Collision.ts` (0.15 m) that is 1.43 m of clearance — comfortably over every
 * wall ≤ 1.4 m, comfortably short of every wall ≥ 1.5 m. Buildings and tree
 * trunks stay `Infinity` (unjumpable) — see `Collision.ts`.
 */
const JUMP_SPEED = 6.6;
const GRAVITY = 17;

/** Drop further than this below the surface under your feet and you fall. */
const FALL_THRESHOLD = 0.5;

/** How long the eyes stay shut. Any longer and she looks sleepy, not blinking. */
const BLINK_DURATION = 0.11;

/**
 * Answers "how high is the ground at this point?" for a character standing at
 * height `y`.
 *
 * The default is `terrainHeight`, but the building installs its own so that
 * decks, stairs, escalators, lifts and the floating bubble all become walkable
 * without the player knowing anything about them. Passing the walker's current
 * height is what lets the same point mean "deck three" or "the grass" depending
 * on where they came from.
 */
export type GroundSampler = (x: number, z: number, y: number) => number;

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

  /**
   * The rainbow that flicks out from under her feet on every hop.
   *
   * Deliberately **not** a child of `this.group`: the ring is left behind in the
   * world where the jump happened, so parenting it to the character would drag
   * it along and spin it. It attaches itself to whatever the player was added
   * to, the first time it is needed — which keeps the wiring inside this class
   * instead of spreading a new field through Game and World.
   */
  readonly hopRings: RainbowRings = createRainbowRings();

  /** Feet position in world space. */
  readonly position = new Vector3();
  readonly velocity = new Vector3();

  /**
   * Where the ground is. Left `null` the character walks on the terrain; the
   * building swaps in its own so the decks, stairs, lift and bubble are solid.
   */
  groundSampler: GroundSampler | null = null;

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
  /**
   * How high the feet are above the local ground right now — 0 while
   * walking, positive mid-jump. Fed into `collision.resolve` as `clearance`
   * so a jump can sail over a low wall (see `Collision.ts`); one frame stale
   * by construction (this frame's value is only known after this frame's
   * collision pass), which is well inside `JUMP_CLEARANCE_GRACE`.
   */
  private hopClearance = 0;
  /** Edge-detects "just cleared a wall" so the poof effect fires once, not every frame. */
  private wasClearingWall = false;
  private blinkTimer = 2.4;
  private blinkRemaining = 0;
  private currentExpression: Expression = 'neutral';
  private ridingFlag = false;

  /**
   * Multiplies the speed limit below — 1 normally. The fountain sets this to
   * ~0.6 while the player's feet are in its water (see `Fountain.ts`), so
   * wading feels like wading without this class knowing anything about water.
   * Read once per frame here; written externally by whichever system
   * currently owns the ground underfoot. One frame stale by construction,
   * the same tolerance `hopClearance` already documents above.
   */
  speedMultiplier = 1;

  /**
   * True while some other system wants the face to read happy without
   * fighting the blink state machine in `animate()` — the fountain sets this
   * while the player is standing in its water.
   */
  waterHappy = false;

  constructor(
    private readonly collision: CollisionWorld,
    private readonly camera: IsoCamera,
    spawn: Vector3,
  ) {
    this.group.name = 'player';

    const playerState = gameStore.get().player;
    this.model = new CharacterModel(
      {
        skin: PALETTE.skin,
        hair: playerState.hairColour,
        outfit: playerState.outfitColour,
        shoe: PALETTE.shoe,
      },
      // Hair style is chosen in the character creator (`ui/CharacterCreation.ts`)
      // and has already been written to the store by the time this constructor
      // runs — see `main.ts`'s `boot()`, which applies it before `Game` (and
      // therefore `Player`) is ever built.
      { hairStyle: playerState.hairStyle },
    );
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
    this.teleportTo(x, this.groundAt(x, z, Infinity), z);
  }

  /**
   * The same, but you say how high as well.
   *
   * Needed by anything that moves the character between the park and the
   * building's own space, where "the ground" is not a function of the terrain
   * and asking for it at the destination before you are there gives the wrong
   * answer.
   */
  teleportTo(x: number, y: number, z: number, facing?: number): void {
    this.position.set(x, y, z);
    this.previousPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.airborne = false;
    if (facing !== undefined) this.facing = facing;
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;
  }

  /** True while a ride is driving the character instead of the player. */
  get riding(): boolean {
    return this.ridingFlag;
  }

  /** Downward speed, negative while falling. Rides and trampolines read this. */
  get verticalSpeed(): number {
    return this.verticalVelocity;
  }

  get isAirborne(): boolean {
    return this.airborne;
  }

  /** Throws the character upwards — the trampoline, later the corgi balloon. */
  launch(speed: number): void {
    this.verticalVelocity = speed;
    this.airborne = true;
  }

  /**
   * Shoves the character sideways without them asking — escalators, and any
   * moving walkway that comes later. Collision still applies.
   */
  nudge(dx: number, dz: number): void {
    this.position.x += dx;
    this.position.z += dz;
    this.collision.resolve(this.position, PLAYER_RADIUS, this.hopClearance);
    this.group.position.copy(this.position);
  }

  /** Hands the character to a ride: input, collision and gravity stop applying. */
  beginRide(): void {
    this.ridingFlag = true;
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.airborne = false;
  }

  /** Called by the ride every frame while it owns the character. */
  setRidePose(x: number, y: number, z: number, facing: number): void {
    this.position.set(x, y, z);
    this.previousPosition.copy(this.position);
    this.facing = facing;
    this.group.position.copy(this.position);
    this.group.rotation.y = facing;
  }

  /** Gives the character back, optionally still moving. */
  endRide(velocityX = 0, velocityY = 0, velocityZ = 0): void {
    this.ridingFlag = false;
    this.velocity.set(velocityX, 0, velocityZ);
    this.verticalVelocity = velocityY;
    this.airborne = true;
  }

  update(context: FrameContext): void {
    const { dt, input } = context;

    // Before the ride check, so a rainbow started on the ground still finishes
    // if you hop straight onto something.
    this.hopRings.update(dt);

    if (this.ridingFlag) {
      // The ride positions us; all we do is hold a suitably delighted pose.
      this.gait = damp(this.gait, 0, 0.1, dt);
      this.animate(context, 0);
      this.model.leftArm.rotation.x = -2.5;
      this.model.rightArm.rotation.x = -2.5;
      this.model.leftArm.rotation.z = 0.5;
      this.model.rightArm.rotation.z = -0.5;
      this.model.body.rotation.x = 0.3;
      this.model.leftLeg.rotation.x = -0.7;
      this.model.rightLeg.rotation.x = -0.55;
      return;
    }

    // --- intent -----------------------------------------------------------
    // Map stick/keys onto the camera's ground basis so "up" is always up-screen.
    this.moveDirection
      .set(0, 0, 0)
      .addScaledVector(this.camera.right, input.moveX)
      .addScaledVector(this.camera.forward, input.moveY);

    const inputLength = this.moveDirection.length();
    const speedLimit =
      PLAYER_MAX_SPEED * (input.isDown('sprint') ? SPRINT_MULTIPLIER : 1) * this.speedMultiplier;

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
    // `hopClearance` (this jumper's height above local ground, as of last
    // frame) lets a wall the player has jumped above stop pushing back — see
    // Collision.ts. Grounded, it's 0, so every wall blocks exactly as before.
    // Passing `dt` is what lets a *deep* overlap (spawned or stepped inside
    // something) resolve as a gentle, capped escort rather than a one-frame
    // shove — see `Collision.ts`'s `MAX_DEPENETRATION_SPEED` (design feedback
    // #17, "the fling"). Ordinary shallow contact against a wall is
    // unaffected and stays exactly as crisp as before.
    const { clearedWall, escorting } = this.collision.resolve(
      this.position,
      PLAYER_RADIUS,
      this.hopClearance,
      dt,
    );

    // Trust the resolved position over the intended one, so walking into a wall
    // actually kills the momentum instead of grinding against it — but *not*
    // while being escorted out of a deep overlap: that distance is an
    // external nudge, not something achieved under her own power, and reading
    // it back as velocity is exactly what caused the fling (design feedback
    // #17) — the escort got banked as speed, which then carried her further
    // into the same overlap next frame, which escorted her again, banking
    // more speed still. Leaving velocity alone here lets it simply decelerate
    // normally, as if nothing solid were there at all.
    if (dt > 0 && !escorting) {
      this.velocity.x = (this.position.x - this.previousPosition.x) / dt;
      this.velocity.z = (this.position.z - this.previousPosition.z) / dt;
    }

    const groundY = this.groundAt(this.position.x, this.position.z, this.position.y);

    // Walk off the edge of a deck — or over one of the shafts inside the big
    // building — and the surface under your feet drops away. Start falling.
    if (!this.airborne && this.position.y - groundY > FALL_THRESHOLD) {
      this.airborne = true;
      this.verticalVelocity = 0;
    }

    // --- hop ----------------------------------------------------------------
    if (input.justPressed('jump') && !this.airborne) {
      this.verticalVelocity = JUMP_SPEED;
      this.airborne = true;
      this.spawnHopRing(groundY);
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
    this.hopClearance = hopHeight;

    // A little sparkle the moment the jump actually carries her over a wall's
    // footprint, rather than every frame she's above it.
    if (clearedWall && !this.wasClearingWall) this.spawnClearPoof();
    this.wasClearingWall = clearedWall;

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
    this.hopRings.root.removeFromParent();
    this.hopRings.dispose();
  }

  // -------------------------------------------------------------- internals

  /**
   * Drops a rainbow ring at the feet, in world space.
   *
   * The effect group is parented lazily to whatever holds the player — the
   * scene, in practice — because a `Player` is constructed before it is added to
   * anything, and rings pinned to the character would ride around with her.
   */
  private spawnHopRing(groundY: number): void {
    const world = this.group.parent;
    if (!world) return;
    if (this.hopRings.root.parent !== world) world.add(this.hopRings.root);
    this.hopRings.burst(this.position.x, groundY, this.position.z);
  }

  /**
   * A dinky puff at wall-top height the instant a jump clears a wall.
   *
   * Reuses the hop rainbow's own pool at low strength rather than building a
   * second effect — it is already a free-floating, ground-agnostic ring, so
   * bursting it at the current (elevated, mid-air) position just works.
   */
  private spawnClearPoof(): void {
    const world = this.group.parent;
    if (!world) return;
    if (this.hopRings.root.parent !== world) world.add(this.hopRings.root);
    this.hopRings.burst(this.position.x, this.position.y - 0.05, this.position.z, 0.4);
  }

  private groundAt(x: number, z: number, y: number): number {
    return this.groundSampler ? this.groundSampler(x, z, y) : terrainHeight(x, z);
  }

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
    model.head.position.y = model.headHeight + Math.sin(phase * 2 + 1.2) * 0.012 * gait;

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
    //
    // The face is painted onto a canvas now rather than built out of spheres,
    // so a blink is a texture swap. That makes it cheap, but only if it happens
    // on the two TRANSITIONS — calling `setExpression` every frame would flip
    // `needsUpdate` every frame and re-upload the texture to the GPU.
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) {
      this.blinkTimer = 2.6 + Math.random() * 3.4;
      this.blinkRemaining = BLINK_DURATION;
    }
    if (this.blinkRemaining > 0) this.blinkRemaining -= dt;

    const blinking = this.blinkRemaining > 0;
    const desiredExpression: Expression = blinking ? 'blink' : this.waterHappy ? 'happy' : 'neutral';
    if (desiredExpression !== this.currentExpression) {
      this.currentExpression = desiredExpression;
      model.setExpression(desiredExpression);
    }

    // The name label counter-rotates so it never tips with the character.
    this.label.sprite.position.y =
      this.model.height + 0.42 + bob + Math.sin(elapsed * 1.3) * 0.03;
    // Kept a constant size on screen rather than in the world — see
    // `NameLabel.updateScreenSize` for why a fixed world scale is the bug.
    // Distance is measured from what the camera is *looking at*, not from the
    // camera's own position — this is an orthographic rig, so the camera sits
    // a fixed distance back at every zoom level, and a straight line to it is
    // roughly constant regardless of what's actually on screen.
    this.label.updateScreenSize(
      this.camera.worldUnitsPerPixel,
      this.camera.focusPoint.distanceTo(this.position),
    );
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
