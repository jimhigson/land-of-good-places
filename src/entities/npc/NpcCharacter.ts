import { Vector3 } from 'three';
import {
  PLAYER_BOB_CYCLES_PER_METRE,
  PLAYER_BOB_HEIGHT,
  PLAYER_TURN_SPEED,
} from '../../core/constants';
import { clamp01, damp, lerp, TAU, turnTowards } from '../../core/mathUtils';
import type { CollisionWorld } from '../../world/Collision';
import { terrainHeight } from '../../world/terrain';
import type { GroundSampler } from '../Player';
import type { Expression } from '../../art/style/faces';
import { createIntent, clearIntent, type CharacterDriver, type CharacterIntent } from './driver';
import type { NpcAvatar } from './npcAvatar';

/**
 * A character that is not the player.
 *
 * Deliberately the same shape as {@link Player}: accelerate towards a desired
 * velocity, resolve against the same {@link CollisionWorld}, ask the same
 * ground sampler how high the floor is, and animate off distance travelled so
 * the legs never skate. What is different is only where the intent comes from —
 * the player reads devices, this reads a {@link CharacterDriver}.
 *
 * That is the whole point of the split. Swap the driver for one fed by network
 * packets and this class becomes a remote player, with no change here: it is
 * already running the same movement and the same collision as the local one, so
 * a remote child bumps into the same wall at the same place.
 *
 * The model is whatever {@link NpcAvatar} the caller hands in. For an ordinary
 * background child that is a rig inside a `KidCrowd` — posing it means writing
 * joint transforms and letting the crowd upload the instance matrices, see
 * `kidCrowd.ts` for why — but nothing here actually depends on that: a pinned,
 * named NPC whose look needs a hat or a pet hands in a one-off
 * `CharacterModel`-backed avatar instead (see `NpcSystem.ts`'s
 * `buildIndividualAvatar`), and this class poses it exactly the same way.
 */

/** Comfortable child walking pace. A full run is this times `RUN_INTENT`. */
const NPC_WALK_SPEED = 2.55;

const NPC_ACCELERATION = 18;
const NPC_DECELERATION = 16;

/** Narrower than the player, so two children pass each other on a path. */
export { NPC_RADIUS } from '../../core/constants';
import { NPC_RADIUS } from '../../core/constants';

const NPC_JUMP_SPEED = 4.6;
const GRAVITY = 17;

/** Drop further than this below the surface under your feet and you fall. */
const FALL_THRESHOLD = 0.5;

export class NpcCharacter {
  readonly avatar: NpcAvatar;
  readonly driver: CharacterDriver;
  /** This child's name, for the floating label above their head (see NpcSystem). */
  readonly name: string;

  readonly position = new Vector3();
  readonly velocity = new Vector3();

  /** Where the ground is. The building installs the same sampler the player uses. */
  groundSampler: GroundSampler | null = null;

  private readonly intent: CharacterIntent = createIntent();
  private readonly desiredVelocity = new Vector3();
  private readonly previousPosition = new Vector3();

  private facing: number;
  private walkPhase: number;
  private gait = 0;
  private verticalVelocity = 0;
  private airborne = false;
  private expression: Expression = 'neutral';

  // --- tree climbing (see world/TreeClimbing.ts) ---------------------------
  // Deliberately the same shape as Player's beginRide/setRidePose/endRide:
  // something outside the normal move/gravity/collision loop needs to take
  // over positioning for a moment. `move()` is skipped entirely while this
  // flag is set; `TreeClimbing` drives the pose directly every frame instead.
  private climbingFlag = false;

  // --- being carried (see world/train/ParkTrain.ts) ------------------------
  // The same idea as `climbingFlag`, for the other thing that moves a child
  // rather than steering one. Re-asserted every frame by whoever is doing the
  // carrying — `ParkTrain.carryPassengers`, which `World.update` calls just
  // before `NpcSystem.update` — and cleared by `update` itself, so a frame
  // nobody claims a child is a frame they are back on their own feet. That is
  // why there is no `endCarry()`: getting off a ride is not an event the ride
  // has to remember to send.
  private carriedFlag = false;

  constructor(
    avatar: NpcAvatar,
    driver: CharacterDriver,
    private readonly collision: CollisionWorld,
    x: number,
    z: number,
    facing: number,
    name: string,
  ) {
    this.avatar = avatar;
    this.driver = driver;
    this.name = name;
    this.facing = facing;
    // Offset the walk cycle per child, or the whole park marches in step.
    this.walkPhase = 0;

    this.position.set(x, terrainHeight(x, z), z);
    this.previousPosition.copy(this.position);
    avatar.rig.root.position.copy(this.position);
    avatar.rig.root.rotation.y = facing;
  }

  get isAirborne(): boolean {
    return this.airborne;
  }

  /** True while `TreeClimbing` owns this character's position instead of `move()`. */
  get climbing(): boolean {
    return this.climbingFlag;
  }

  /** Hands the character to a climb: gravity and collision stop applying. */
  beginClimb(): void {
    this.climbingFlag = true;
    this.velocity.set(0, 0, 0);
    this.verticalVelocity = 0;
    this.airborne = false;
  }

  /** Called by `TreeClimbing` every frame while it owns the pose. */
  setClimbPose(x: number, y: number, z: number, facing: number): void {
    this.position.set(x, y, z);
    this.previousPosition.copy(this.position);
    this.facing = facing;
    this.avatar.rig.root.position.copy(this.position);
    this.avatar.rig.root.rotation.y = facing;
  }

  /** Gives the character back to the wander driver, standing wherever it now is. */
  endClimb(): void {
    this.climbingFlag = false;
  }

  /** True while a ride is carrying this character instead of `move()` walking it. */
  get carried(): boolean {
    return this.carriedFlag;
  }

  /**
   * "You are aboard, and it is here." Called once a frame, before
   * {@link update}, by something that carries a character rather than steering
   * one — currently just `ParkTrain.carryPassengers`.
   *
   * It takes over x and z outright, and `move()` is skipped for that frame.
   * Both halves of that matter, and the second one is a bug fix (28 July):
   *
   * - A child standing on a carriage is standing **on the track**, which is
   *   ringed by the rail-exclusion fence's colliders. `move()`'s
   *   `collision.resolve` therefore shoved every rider ~7 cm off the train,
   *   every frame.
   * - `move()` then rewrites `velocity` from how far the character actually
   *   ended up moving — the line that makes walking into a wall kill your
   *   momentum. For a rider, "how far they moved" is the ride's own write plus
   *   that shove, neither of which is speed the child asked for. It fed back:
   *   1.9 m/s on the first frame out of Bluebell Halt, 29 m/s twenty frames
   *   later, ~2200 m/s after half a minute, with the child ping-ponging 73 m
   *   between the seat and the fence every frame. That was the vibration.
   *
   * y is left alone deliberately: the carriage floor registers with
   * `WalkSurfaces` as a moving platform, so {@link rideAlong} settles onto it
   * the same way a walking child settles onto the ground.
   */
  setCarriedPose(x: number, z: number): void {
    this.carriedFlag = true;
    this.position.x = x;
    this.position.z = z;
    // Nothing a ride does to a passenger is speed they earned, so they step off
    // standing still rather than shooting away from wherever it put them down.
    this.velocity.set(0, 0, 0);
    this.avatar.rig.root.position.copy(this.position);
  }

  /** Nudges the walk cycle at spawn so children are not in lockstep. */
  setWalkPhase(phase: number): void {
    this.walkPhase = phase;
  }

  /**
   * Puts the character down on whatever the ground sampler finds under it,
   * looking from the height `from`.
   *
   * The constructor has to guess a starting height and it guesses
   * `terrainHeight` — right for anybody spawned in the park, and meaningless
   * for anybody spawned somewhere the terrain function has never heard of. A
   * hotel room six hundred metres out is a floor *plate* registered with
   * `WalkSurfaces`, not a hill; `terrainHeight` there is whatever the park's
   * falloff happens to say, tens of metres down.
   *
   * That is why `from` is a parameter rather than "wherever you currently
   * are": `WalkSurfaces.sample` only offers a platform that is within a step
   * *up* of where you are asking from, so a body that begins the frame far
   * below its own floor is told there is no floor, decides it is falling, and
   * falls for ever. Measured before this existed: hotel guests at y = −16.5 m
   * and still going after ninety seconds. Only the space knows where its own
   * floor is, so only the space can answer this — see `NpcSystem`'s
   * `ResidentSpec.floorY`.
   *
   * Called by whoever installs the sampler, once, immediately after doing so:
   * a body cannot ask the question before it has been handed the thing that
   * answers it.
   */
  settle(from: number): void {
    this.position.y = this.groundAt(this.position.x, this.position.z, from);
    this.previousPosition.copy(this.position);
    this.avatar.rig.root.position.copy(this.position);
  }

  /**
   * One frame of life. `elapsed` drives idle motion, `playerHopped` is the cue
   * for the giggle-hop, and `dt` is the only thing that moves anybody.
   */
  update(
    dt: number,
    elapsed: number,
    playerPosition: Readonly<Vector3>,
    playerHopped: boolean,
    // Chatting (additive): everything else about `DriverContext` was already
    // enough for the wander driver to decide who to wave at; noticing that
    // the player has *stopped* and whether they have a hat on needed two more
    // read-only facts, both computed once per frame in `NpcSystem` and handed
    // down here rather than duplicated per character.
    playerStationaryFor: number = 0,
    playerWearingHat: boolean = false,
  ): void {
    clearIntent(this.intent);
    this.driver.update(
      {
        dt,
        elapsed,
        position: this.position,
        playerPosition,
        playerHopped,
        grounded: !this.airborne,
        playerStationaryFor,
        playerWearingHat,
      },
      this.intent,
    );

    // While a climb owns the pose, `setClimbPose` is doing the positioning —
    // running `move()` too would immediately drag the character back down to
    // the ground via gravity and the ground sampler. `animate()` still runs
    // so blink/expression transitions (driven by `intent`, set above) and the
    // idle breathing motion keep working while perched. A carried child is the
    // same bargain with a different owner — see `setCarriedPose`.
    if (this.climbingFlag) {
      // TreeClimbing owns everything, including y.
    } else if (this.carriedFlag) {
      this.rideAlong(dt);
    } else {
      this.move(dt);
    }
    // The carry is re-asserted every frame; one that is not is over.
    this.carriedFlag = false;
    this.animate(elapsed);
  }

  /**
   * Pushes the character apart from a neighbour standing on top of them.
   *
   * Children are not colliders — registering a dozen moving circles with a
   * collision world built for tree trunks would make every one of them a wall.
   * Instead the system relaxes overlaps directly, which cannot jitter because
   * it moves both parties half way and then stops.
   */
  separateFrom(other: NpcCharacter, minimum: number): void {
    // A climbing character's (x, z) is the tree it is up, not somewhere it is
    // standing — shoving it "apart" from a passer-by at ground level would
    // knock it out of setClimbPose's next call for nothing visible in return.
    if (this.climbingFlag || other.climbingFlag) return;
    const dx = other.position.x - this.position.x;
    const dz = other.position.z - this.position.z;
    const distanceSquared = dx * dx + dz * dz;
    if (distanceSquared >= minimum * minimum || distanceSquared < 1e-8) return;

    const distance = Math.sqrt(distanceSquared);
    const push = (minimum - distance) * 0.5;
    const nx = (dx / distance) * push;
    const nz = (dz / distance) * push;
    this.position.x -= nx;
    this.position.z -= nz;
    other.position.x += nx;
    other.position.z += nz;
  }

  /** Re-seats the model after any position change made outside `update`. */
  syncTransform(): void {
    this.avatar.rig.root.position.copy(this.position);
  }

  // ---------------------------------------------------------------- internals

  /**
   * One frame aboard something that is carrying you.
   *
   * `setCarriedPose` has already written x and z, so all that is left is what a
   * passenger genuinely does: settle onto whatever is under their feet — the
   * carriage floor, which registers with `WalkSurfaces` as a moving platform,
   * exactly like the lift car — turn their head if the driver asked, and let
   * the walk cycle wind down to a stand.
   *
   * Deliberately a separate path rather than `move()` with a flag threaded
   * through it: the whole point is that **none** of `move()`'s horizontal half
   * may run for a rider, and a branch that says so is harder to reintroduce a
   * bug into than four scattered `if`s.
   */
  private rideAlong(dt: number): void {
    // A ride cannot drop you, and it cannot launch you either: no gravity, no
    // hop (a giggle-hop banked just before boarding would otherwise fire from
    // the seat), no falling off the edge of the carriage floor.
    this.verticalVelocity = 0;
    this.airborne = false;

    const groundY = this.groundAt(this.position.x, this.position.z, this.position.y);
    this.position.y = damp(this.position.y, groundY, 0.04, dt);

    if (this.intent.lookAt !== null) {
      this.facing = turnTowards(this.facing, this.intent.lookAt, 4.5 * dt);
    }

    const root = this.avatar.rig.root;
    root.position.copy(this.position);
    root.rotation.y = this.facing;

    // Standing, holding on. `animate` reads `gait`, so easing it down is what
    // stops the legs from walking on the spot for a second after boarding.
    this.gait = damp(this.gait, 0, 0.07, dt);
  }

  private move(dt: number): void {
    const intentLength = Math.hypot(this.intent.moveX, this.intent.moveZ);

    if (intentLength > 1e-4) {
      const speed = NPC_WALK_SPEED;
      this.desiredVelocity.set(this.intent.moveX * speed, 0, this.intent.moveZ * speed);
    } else {
      this.desiredVelocity.set(0, 0, 0);
    }

    const rate = intentLength > 1e-4 ? NPC_ACCELERATION : NPC_DECELERATION;
    approach(this.velocity, this.desiredVelocity, rate * dt);

    this.previousPosition.copy(this.position);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.collision.resolve(this.position, NPC_RADIUS);

    // Trust the resolved position over the intended one, so walking into a wall
    // kills the momentum instead of grinding against it.
    if (dt > 0) {
      this.velocity.x = (this.position.x - this.previousPosition.x) / dt;
      this.velocity.z = (this.position.z - this.previousPosition.z) / dt;
    }

    const groundY = this.groundAt(this.position.x, this.position.z, this.position.y);

    if (!this.airborne && this.position.y - groundY > FALL_THRESHOLD) {
      this.airborne = true;
      this.verticalVelocity = 0;
    }

    if (this.intent.hop && !this.airborne) {
      this.verticalVelocity = NPC_JUMP_SPEED;
      this.airborne = true;
    }

    if (this.airborne) {
      this.verticalVelocity -= GRAVITY * dt;
      this.position.y += this.verticalVelocity * dt;
      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.verticalVelocity = 0;
        this.airborne = false;
      }
    } else {
      this.position.y = damp(this.position.y, groundY, 0.04, dt);
    }

    // --- facing ---------------------------------------------------------
    const planarSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (planarSpeed > 0.3) {
      this.facing = turnTowards(
        this.facing,
        Math.atan2(this.velocity.x, this.velocity.z),
        PLAYER_TURN_SPEED * dt,
      );
    } else if (this.intent.lookAt !== null) {
      this.facing = turnTowards(this.facing, this.intent.lookAt, 4.5 * dt);
    }

    const root = this.avatar.rig.root;
    root.position.copy(this.position);
    root.rotation.y = this.facing;

    this.gait = damp(this.gait, clamp01(planarSpeed / NPC_WALK_SPEED), 0.07, dt);
    this.walkPhase += planarSpeed * PLAYER_BOB_CYCLES_PER_METRE * TAU * dt;
    if (this.walkPhase > TAU) this.walkPhase -= TAU;
  }

  /**
   * The house walk cycle, posed onto the rig.
   *
   * Deliberately the same maths as `Player.animate` — bob on each step, squash
   * at the bottom of it, arms and legs in opposition, head lagging a touch —
   * because a park where the background children move differently from the one
   * you are steering reads as two games stitched together.
   *
   * Nothing here hardcodes a joint's rest position; the head's is read off the
   * model at build time, so retuning the kid's proportions carries through.
   */
  private animate(elapsed: number): void {
    const rig = this.avatar.rig;
    const gait = this.gait;
    const phase = this.walkPhase;
    const groundY = this.groundAt(this.position.x, this.position.z, this.position.y);
    // The little tuck a child pulls their knees into on the way up from a hop —
    // scaled by how far off the ground they are, which is fine for a hop and
    // **wrong for a climb**, where "off the ground" is the whole height of the
    // tree. Left at 0 while climbing, exactly as `Player.update`'s riding
    // branch has always done by passing a hop height of 0 into its own
    // `animate`; this is the crowd catching up with her, not a new rule.
    //
    // It was measurable before anyone could see it — the term lifted a climbing
    // NPC's head 0.30–0.67 m clear of the topmost leaf on ~31 climbers — but
    // while only a head was drawn it read as a peeking child rather than as a
    // fault. Drawing the whole body (`world/TreeClimbing.ts`, Jim's *"make
    // nobody ever just a head"*) makes it a child hovering bodily above the
    // canopy, which is why it is fixed now and was left alone before.
    const hopHeight = this.climbingFlag ? 0 : Math.max(0, this.position.y - groundY);

    const bob = Math.abs(Math.sin(phase)) * PLAYER_BOB_HEIGHT * gait;
    const breathe = Math.sin(elapsed * 1.9 + this.walkPhase) * 0.014 * (1 - gait);
    rig.body.position.y = bob + breathe + hopHeight * 0.12;

    const squash = 1 - Math.cos(phase * 2) * 0.045 * gait;
    rig.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));

    rig.body.rotation.x = lerp(0, -0.13, gait) + (this.airborne ? -0.1 : 0);
    rig.body.rotation.z = Math.sin(phase) * 0.045 * gait;

    rig.head.rotation.z = -Math.sin(phase) * 0.07 * gait;
    rig.head.rotation.x = Math.sin(phase * 2 + 0.6) * 0.035 * gait + breathe * 2;
    rig.head.position.y = this.avatar.headBaseY + Math.sin(phase * 2 + 1.2) * 0.012 * gait;

    const swing = Math.sin(phase) * (0.95 * gait);
    const armLift = this.airborne ? -0.9 : 0;
    rig.leftArm.rotation.x = swing + armLift;
    rig.leftArm.rotation.z = 0.12 + gait * 0.08;

    // The right arm is the waving arm: it lifts over the head and wags, blended
    // against whatever the walk cycle wanted so a child can wave mid-stride.
    const wave = this.intent.wave;
    const waggle = Math.sin(elapsed * 11) * 0.42;
    rig.rightArm.rotation.x = lerp(-swing + armLift, -2.45, wave);
    rig.rightArm.rotation.z = lerp(-0.12 - gait * 0.08, -0.75 + waggle, wave);

    const legSwing = Math.sin(phase) * (0.85 * gait);
    rig.leftLeg.rotation.x = -legSwing;
    rig.rightLeg.rotation.x = legSwing;

    // A texture swap, so only ever on a transition.
    if (this.intent.expression !== this.expression) {
      this.expression = this.intent.expression;
      this.avatar.setExpression(this.expression);
    }

  }

  private groundAt(x: number, z: number, y: number): number {
    return this.groundSampler ? this.groundSampler(x, z, y) : terrainHeight(x, z);
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
