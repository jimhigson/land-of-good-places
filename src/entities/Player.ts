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
import type { WornHat } from './WornHat';

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

/**
 * The height a jump actually reaches, in metres — the ≈1.28 m the doc above
 * derives `JUMP_SPEED` from. Shared with the auto-hop check below so "would
 * an automatic hop clear this?" asks the exact same question the manual jump
 * already answers, rather than a second, independently-tuned number that
 * could quietly drift out of step with it.
 *
 * Exported for the same reason, one consumer further out: `world/NavGrid.ts`
 * leaves a wall this clears out of the walkable map altogether, so that
 * tap-to-move hops a low garden wall instead of routing the long way round it.
 * All three questions are answered by `Collision.ts`'s `autoHopClears` from
 * this one number.
 */
export const JUMP_APEX_HEIGHT = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);

/**
 * How far ahead — in the direction actually being walked — the auto-hop
 * feature (design feedback #30e) looks for a wall it could jump. Small: this
 * only needs to fire a moment before contact, not give a long run-up, and a
 * bigger number would hop over things well before they were ever really in
 * the way.
 */
const AUTO_HOP_LOOKAHEAD = 0.5;

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

  /**
   * The system that draws whatever hat is currently worn — left `null` until
   * `Game` wires it up (it is built just after `Player`, from
   * `this.model.hatAnchor`; see `Game.ts`). Read only to size the name label
   * so it clears the hat instead of sitting at a fixed bare-head height.
   */
  wornHat: WornHat | null = null;

  private readonly desiredVelocity = new Vector3();
  private readonly moveDirection = new Vector3();
  private readonly previousPosition = new Vector3();
  /** Scratch point for the auto-hop lookahead — see `wouldAutoHopClear` below. */
  private readonly hopProbe = new Vector3();

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
  /**
   * True while an escort out of a deep overlap is still running — see the
   * velocity read-back in `update`.
   *
   * Being walked back out of something is a *process*, several frames long,
   * and only its first frames are deep enough for `resolve` to call them an
   * escort. Latching it here, and holding it until the corrections stop
   * altogether, is what stops the shallow tail of an escort being mistaken
   * for ordinary contact and banked as speed.
   */
  private escorting = false;
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
        skin: playerState.skinColour,
        hair: playerState.hairColour,
        outfit: playerState.outfitColour,
        shoe: PALETTE.shoe,
      },
      // Hair style, skin tone and eye colour are chosen in the character
      // creator (`ui/CharacterCreation.ts`) and have already been written to
      // the store by the time this constructor runs — see `main.ts`'s
      // `boot()`, which applies them before `Game` (and therefore `Player`)
      // is ever built.
      { hairStyle: playerState.hairStyle, eyeColour: playerState.eyeColour },
    );
    this.group.add(this.model.root);

    this.label = new NameLabel(playerState.name);
    this.label.sprite.position.y = this.labelTopHeight() + 0.42;
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
    // Whatever she was being walked out of, she is not in it any more.
    this.escorting = false;
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
    // A ride hands back a fresh velocity of its own choosing; nothing about
    // the overlap she was in before it took over still applies.
    this.escorting = false;
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
    const { clearedWall, escorting, corrected } = this.collision.resolve(
      this.position,
      PLAYER_RADIUS,
      this.hopClearance,
      dt,
    );

    // An escort runs until the pushing stops, not until it goes quiet.
    //
    // `escorting` is true only while *this frame's* correction is deeper than
    // ordinary contact, and the last frames of any escort are shallow by
    // definition — the overlap is nearly gone, which is the point of it. So
    // the flag drops while the mover is still being pushed, and the frame it
    // drops on gets its correction banked as velocity after all.
    //
    // That is the wall fling ("jumping over walls the player sometimes gets a
    // burst of extreme speed"): a wall the jump only just clears stops being
    // solid at the apex, goes solid again under her on the way down while she
    // is inside its footprint, and the resulting escort's tail is still ~0.4 m
    // — a hair under `SHALLOW_OVERLAP`, so it is called ordinary contact and
    // read back as ~25 m/s against a walking pace of 7.4. Same feedback loop
    // as design feedback #17, entered through the door the #17 fix left open.
    //
    // Latching until `corrected` goes false closes it: the whole escort, deep
    // frames and shallow tail alike, is treated as the external nudge it is.
    this.escorting = corrected && (escorting || this.escorting);

    // Trust the resolved position over the intended one, so walking into a wall
    // actually kills the momentum instead of grinding against it — but never
    // while an escort is running: that distance is an external nudge, not
    // something achieved under her own power. Leaving velocity alone lets it
    // simply decelerate normally, as if nothing solid were there at all.
    if (dt > 0 && !this.escorting) {
      const previousSpeed = Math.hypot(this.velocity.x, this.velocity.z);
      const derivedX = (this.position.x - this.previousPosition.x) / dt;
      const derivedZ = (this.position.z - this.previousPosition.z) / dt;
      // Second line of defence, and an invariant worth stating outright:
      // being blocked is a *constraint*, so it can only ever take speed away.
      // If a resolved position ever implies she came out of a collision going
      // faster than she went in, that is not her walking into a wall, whatever
      // produced it — so decline it rather than launch a six-year-old across
      // the park. Never fires on ordinary contact, where the correction can
      // only undo part of the step that caused it.
      if (Math.hypot(derivedX, derivedZ) <= previousSpeed) {
        this.velocity.x = derivedX;
        this.velocity.z = derivedZ;
      }
    }

    const groundY = this.groundAt(this.position.x, this.position.z, this.position.y);

    // Walk off the edge of a deck — or over one of the shafts inside the big
    // building — and the surface under your feet drops away. Start falling.
    if (!this.airborne && this.position.y - groundY > FALL_THRESHOLD) {
      this.airborne = true;
      this.verticalVelocity = 0;
    }

    // --- auto-hop (design feedback #30e) -------------------------------------
    // Walking into a jumpable wall — most naturally via tap-to-move, which
    // steers exactly like a thumbstick held down (see `TapNavigator`) — used
    // to just stop there. A short lookahead in the direction actually being
    // walked asks `Collision.ts` the same question the button already
    // answers: "would a jump from here clear what's in the way?" Only
    // `autoHoppable` colliders count — the garden's wooden and stone walls,
    // registered that way in `Scenery.ts` — so this can never fire for the
    // fountain rim, a deck edge (which isn't a collider at all) or a wall
    // too tall to clear; manual jump is completely untouched.
    let autoHopWanted = false;
    if (!this.airborne && inputLength > 1e-4) {
      const inverse = 1 / inputLength;
      this.hopProbe
        .copy(this.position)
        .addScaledVector(this.moveDirection, AUTO_HOP_LOOKAHEAD * inverse);
      autoHopWanted = this.collision.wouldAutoHopClear(this.hopProbe, PLAYER_RADIUS, JUMP_APEX_HEIGHT);
    }

    // --- hop ----------------------------------------------------------------
    if ((input.justPressed('jump') || autoHopWanted) && !this.airborne) {
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

  /**
   * Top of the character right now, in metres above the feet, for the name
   * label to clear — bare hair height normally, or the top of whatever hat is
   * worn when that reaches higher. `Math.max` rather than a straight swap
   * because a few hats (the flower crown, say) sit lower than the hair itself
   * does; only a hat that actually reaches above the hair should ever move
   * the label, so a bare-headed child's label — or one in a low hat — stays
   * exactly where it always was.
   */
  private labelTopHeight(): number {
    const hatHeight = this.wornHat?.hatHeight ?? null;
    if (hatHeight === null) return this.model.height;
    return Math.max(this.model.height, this.model.hatAnchorHeight + hatHeight);
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
    this.label.sprite.position.y = this.labelTopHeight() + 0.42 + bob + Math.sin(elapsed * 1.3) * 0.03;
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
