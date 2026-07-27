import type { Rng } from '../../core/mathUtils';
import { clamp01 } from '../../core/mathUtils';
import { NPC_PAINT_DESIGNS, type FacePaintDesign } from '../../art/style/faces';
import { RUN_INTENT, type CharacterDriver, type CharacterIntent, type DriverContext } from './driver';
import type { PoiGraph } from './poiGraph';
// Chatting (see the additive block near the bottom of this file). Content —
// what a child says and when — lives in its own module so this file stays
// about timing and state, not word lists.
import {
  CHAT_APPROACH_TIMEOUT,
  CHAT_COOLDOWN_MIN,
  CHAT_COOLDOWN_RANGE,
  CHAT_GIVEUP_RADIUS,
  CHAT_GOODBYE_DURATION,
  CHAT_RADIUS,
  CHAT_ROLL_MAX,
  CHAT_ROLL_MIN,
  CHAT_START_CHANCE,
  CHAT_STOP_DISTANCE,
  CHAT_TALK_MAX,
  CHAT_TALK_MIN,
  CHAT_TRIGGER_STATIONARY,
  pickChatLine,
  pickGoodbyeLine,
  type ChatBudget,
} from './chatActivity';
// The park train. Used only by the additive block at the bottom of this file,
// and only through a singleton that is `null` in a world without one.
import { trainService } from '../../world/train/service';
import type { ClimbableTreeSeed } from '../../world/Scenery';

/**
 * A child with somewhere to be.
 *
 * This is the only driver the game ships with, and it is a behaviour script
 * rather than anything clever: walk to the next waypoint, and when you get
 * there decide what to do next. Everything that makes it read as a child rather
 * than as a patrolling guard is in the decisions:
 *
 * - **Never turn straight back.** A child who retraces their steps looks lost.
 *   The previous waypoint is only chosen again at a dead end.
 * - **Stop at the good bits.** Waypoints marked interesting — the fountain, the
 *   ball pit lip, the door of the big building — earn a pause, and during a
 *   pause the child looks around instead of standing to attention.
 * - **Sometimes run.** A whole park of children moving at one speed looks like
 *   a screensaver. A fifth of legs are run at, chosen per leg so the change of
 *   pace happens at a corner, where it looks intentional.
 * - **Notice the player.** Come near and a child may wave; hop near one and
 *   they will hop back. That is the entire social system and it is worth more
 *   than it costs.
 *
 * Everything random comes from a seeded {@link Rng}, so the park behaves the
 * same on every reload — which matters far more than it sounds when you are
 * trying to reproduce "that kid got stuck by the west wall".
 */

/** How close counts as having arrived at a waypoint. */
const ARRIVE_RADIUS = 0.9;

/** Chance of stopping to look at something interesting. */
const PAUSE_CHANCE = 0.62;

/** Chance a given leg is run rather than walked. */
const RUN_CHANCE = 0.2;

/** Chance of a little hop on arriving somewhere good. */
const ARRIVAL_HOP_CHANCE = 0.22;

/** The player has to be this close before a child notices them at all. */
const NOTICE_RANGE = 6.5;

/** …and this close for a hop to be worth copying. */
const COPY_HOP_RANGE = 7.5;

const WAVE_DURATION = 1.8;
const WAVE_COOLDOWN = 9;
const HOP_COOLDOWN = 1.1;

/** Longest a child will push at a waypoint before giving up and re-choosing. */
const LEG_TIMEOUT = 14;

// --- tree climbing (see world/TreeClimbing.ts) ------------------------------
//
// Item 22 of the family's design feedback: NPCs climb trees too. This driver
// owns only the *decision* and the *timing* — whether to climb, which tree,
// how long each phase lasts. `TreeClimbing` reads the small public surface
// below and does the actual posing (it owns the body-hiding and the pose
// maths, shared with the player's own climb). Kept entirely inside this
// class so the rest of the file, and everyone calling it, is unaffected.

/** How far from a waypoint a tree is still "right there" to climb. */
const CLIMB_SEARCH_RADIUS = 6.5;

/** Rolled once per arrival at *any* waypoint, not just interesting ones. */
const CLIMB_CHANCE = 0.055;

/** Longest to wait before this child is willing to climb again. */
const CLIMB_COOLDOWN_MIN = 50;
const CLIMB_COOLDOWN_RANGE = 60;

const CLIMB_UP_SECONDS = 0.5;
const CLIMB_DOWN_SECONDS = 0.42;
const CLIMB_PEEK_MIN = 3.4;
const CLIMB_PEEK_RANGE = 3.6;

/** A phase of the little scripted moment, in order. */
export type ClimbPhase = 'up' | 'peek' | 'down';

/**
 * Caps how many children are up trees across the whole park at once, so a
 * lucky run of coin flips can't put half the crowd in the branches. Shared —
 * one instance handed to every `WanderDriver` by `NpcSystem`.
 */
export interface ClimberBudget {
  active: number;
  readonly max: number;
}

// =============================================================================
// Face painting stall (additive, self-contained). See ART_DIRECTION.md's face
// patch section and `world/FacePaintStall.ts` for the feature this feeds.
//
// A `WanderDriver` never learns where the stall is by being told about it
// directly — `NpcSystem`/`kidCrowd.ts`/`NpcCharacter.ts` stay untouched by this
// PR. Instead the stall registers its own position here once, at construction
// (`registerFacePaintStall`), and every driver — spawned before or after that
// call — reads the same module-level target. Painted state is likewise read
// back out through a module-level registry (`paintedNpcFaces`) rather than a
// new field threaded through `NpcSystem`, which is what lets this whole feature
// live in one file plus the stall's own.
//
// Two other PRs also add blocks to this file; this one touches nothing above
// `LEG_TIMEOUT` and nothing in the existing methods below except the two
// marked call-outs inside `update()`.
// =============================================================================

/** Where a child stands to be painted, and how close counts as "there". */
export interface FacePaintStallTarget {
  readonly x: number;
  readonly z: number;
  readonly standX: number;
  readonly standZ: number;
}

/** Set once by `FacePaintStall` after it places itself in the garden. */
let facePaintStallTarget: FacePaintStallTarget | null = null;

/** Called by `world/FacePaintStall.ts` once, when the stall is built. */
export function registerFacePaintStall(x: number, z: number, standX: number, standZ: number): void {
  facePaintStallTarget = { x, z, standX, standZ };
}

/** Every driver alive, so a painted face can be found without a new registry in `NpcSystem`. */
const wanderDrivers = new Set<WanderDriver>();

export interface PaintedNpcFace {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly design: FacePaintDesign;
}

/**
 * Every currently-painted child's approximate head position, for
 * `FacePaintStall` to plant a small floating paint decal near.
 *
 * "Approximate" is the operative word: a driver only ever knows its own
 * character's *feet* position (`DriverContext.position`) and an inferred
 * facing, never the real head transform inside the instanced crowd's skeleton
 * (see `kidCrowd.ts` / `InstancedCrowd.ts`) — reaching into either is exactly
 * what this block is written not to do. The decal's own head-height offset is
 * applied by the caller.
 */
export function paintedNpcFaces(): PaintedNpcFace[] {
  const faces: PaintedNpcFace[] = [];
  for (const driver of wanderDrivers) {
    if (driver.paintDesign) {
      faces.push({ x: driver.faceX, z: driver.faceZ, yaw: driver.faceYaw, design: driver.paintDesign });
    }
  }
  return faces;
}

/**
 * How many children may be mid-visit or freshly painted at once.
 *
 * Matches `FacePaintStall`'s own decal pool size (see the comment there) — a
 * child who is painted but has no decal slot free would just be an invisible
 * design, which is worse than not offering them a turn yet.
 */
const MAX_CONCURRENT_PAINTED = 4;

/** Chance a child who has reached the front of the queue actually goes in. */
const PAINT_VISIT_CHANCE = 0.4;

function paintedOrVisitingCount(): number {
  let count = 0;
  for (const driver of wanderDrivers) {
    if (driver.paintDesign || driver.paintVisit !== 'none') count += 1;
  }
  return count;
}

export interface WanderOptions {
  readonly graph: PoiGraph;
  readonly rng: Rng;
  /** Index of the waypoint the child starts on. */
  readonly startNode: number;
  /** Multiplies every walking speed for this child. Not everyone is brisk. */
  readonly pace?: number;
  /** Trees big enough to climb. Omit (or leave empty) and nobody ever does. */
  readonly climbableTrees?: readonly ClimbableTreeSeed[];
  /** Shared across every child, to keep the whole-park total gentle. */
  readonly climberBudget?: ClimberBudget;
  /** Shared across every child, so standing still draws one or two chatters, not a mob. */
  readonly chatBudget?: ChatBudget;
}

export class WanderDriver implements CharacterDriver {
  readonly name = 'wander';

  private readonly graph: PoiGraph;
  private readonly rng: Rng;
  private readonly pace: number;

  private current: number;
  private target: number;
  private previous: number;

  private pausing = false;
  private pauseRemaining = 0;
  private legElapsed = 0;
  private running = false;

  private lookYaw: number | null = null;
  private lookRemaining = 0;

  private waveRemaining = 0;
  private waveCooldown = 0;
  private waveAmount = 0;
  private hopCooldown = 0;
  private hopRequest = false;

  private blinkTimer: number;
  private blinkRemaining = 0;

  // --- tree climbing state (see block comment above `WanderOptions`) -------
  private readonly climbableTrees: readonly ClimbableTreeSeed[];
  private readonly climberBudget: ClimberBudget | undefined;
  private climbCooldown: number;
  private climbPhaseValue: ClimbPhase | null = null;
  private climbTreeValue: ClimbableTreeSeed | null = null;
  private climbTimer = 0;
  private climbPeekFor = 0;
  private climbStartX = 0;
  private climbStartZ = 0;

  // ---- face painting stall (additive — see the block above the class) ----
  // Not `private`: read from the module-level `paintedNpcFaces()` /
  // `paintedOrVisitingCount()` helpers above, which live outside the class
  // body. Nothing outside this file touches them.
  /** `none` = ordinary wandering; anything else overrides movement for a frame. */
  paintVisit: 'none' | 'walking' | 'pausing' = 'none';
  /** The design worn home, or `null` before a first (successful) visit. */
  paintDesign: FacePaintDesign | null = null;
  private paintCooldown: number;
  private paintPauseRemaining = 0;
  /** Approximate head-tracking, updated every frame regardless of state. */
  faceX = 0;
  faceZ = 0;
  faceYaw = 0;

  // ---- chatting (additive — see the block above the `WanderDriver` class,
  // and the state machine near the bottom of it) ----
  private readonly chatBudget: ChatBudget | undefined;
  private chatState: 'none' | 'approaching' | 'talking' | 'leaving' = 'none';
  private chatCooldown: number;
  private chatRollTimer = 0;
  private chatElapsed = 0;
  private chatTalkRemaining = 0;
  private chatLeaveRemaining = 0;
  private chatLine: string | null = null;

  constructor(options: WanderOptions) {
    this.graph = options.graph;
    this.rng = options.rng;
    this.pace = options.pace ?? 1;
    this.current = options.startNode;
    this.previous = options.startNode;
    this.target = options.startNode;
    this.blinkTimer = this.rng.range(1.5, 5.5);
    this.climbableTrees = options.climbableTrees ?? [];
    this.climberBudget = options.climberBudget;
    this.chatBudget = options.chatBudget;
    // Staggered like the first pause below, so the park doesn't decide to
    // climb in step either — and nobody is eligible in the first minute.
    this.climbCooldown = this.rng.range(10, 70);
    // Stagger the first decision so the whole park does not set off in step.
    this.pausing = true;
    this.pauseRemaining = this.rng.range(0, 2.5);
    this.chooseNext();

    // Stagger the first face-paint roll too, and start tracking the head at
    // whatever waypoint this child spawned on.
    this.paintCooldown = this.rng.range(12, 40);
    const startNode = this.graph.node(options.startNode);
    this.faceX = startNode?.x ?? 0;
    this.faceZ = startNode?.z ?? 0;
    // Stagger the first chat roll too, so nobody is eligible in the opening seconds.
    this.chatCooldown = this.rng.range(3, 20);
    wanderDrivers.add(this);
  }

  /** Where this child is heading, for debugging and for the pet to follow. */
  get targetNode(): number {
    return this.target;
  }

  /** True for the whole climb — up, peeking and down. */
  get climbing(): boolean {
    return this.climbPhaseValue !== null;
  }

  /** Which tree, while {@link climbing}. */
  get climbTree(): ClimbableTreeSeed | null {
    return this.climbTreeValue;
  }

  /** Which part of the climb. `null` when not climbing. */
  get climbPhase(): ClimbPhase | null {
    return this.climbPhaseValue;
  }

  /** 0..1 through the current phase. Meaningless (and unused) during `peek`. */
  get climbProgress(): number {
    if (this.climbPhaseValue === 'up') return clamp01(this.climbTimer / CLIMB_UP_SECONDS);
    if (this.climbPhaseValue === 'down') return clamp01(this.climbTimer / CLIMB_DOWN_SECONDS);
    return 1;
  }

  /** Where the child was standing when it started up — the base of the scramble. */
  get climbGroundSpot(): { readonly x: number; readonly z: number } {
    return { x: this.climbStartX, z: this.climbStartZ };
  }

  /**
   * What this child is saying right now, for `NpcSystem` to show in a
   * {@link SpeechBubble} — `null` whenever they are not mid-chat. `null`
   * during `approaching` on purpose: the line is chosen on arrival, not
   * before, so the bubble appears exactly when they stop and turn to face
   * the player.
   */
  get chatBubbleText(): string | null {
    return this.chatState === 'talking' || this.chatState === 'leaving' ? this.chatLine : null;
  }

  update(context: DriverContext, intent: CharacterIntent): void {
    const { dt } = context;

    this.waveCooldown -= dt;
    this.hopCooldown -= dt;
    this.blinkTimer -= dt;
    if (this.blinkRemaining > 0) this.blinkRemaining -= dt;
    // Moved up from the bottom of this method so a child blinks whether they
    // are wandering or up a tree — climbing returns early, below.
    if (this.blinkTimer <= 0) {
      this.blinkTimer = this.rng.range(2.4, 6.2);
      this.blinkRemaining = 0.12;
    }
    this.climbCooldown -= dt;

    if (this.climbPhaseValue !== null) {
      this.updateClimb(dt, intent);
      return;
    }

    this.reactToPlayer(context);

    // Chatting (additive): claims the frame — in place of the train trip and
    // the face-paint visit below — while a chat is starting, happening, or
    // being said goodbye to. See the block near the bottom of this file for
    // the state machine; every other method on this class is unchanged.
    const chatting = this.updateChatActivity(context, intent, dt);

    if (!chatting) {
      // Catching the park train, if there is one and this child fancies it. The
      // whole behaviour is in the additive block at the bottom of this file; when
      // it is handling the frame, it has filled the intent in itself.
      if (this.updateTrainTrip(context, intent)) return;

      // --- where am I trying to be? -------------------------------------------
      // Face painting stall (additive): a child mid-visit — or one who has just
      // decided to start one — has movement handled entirely by
      // `driveFacePaintVisit` for this frame, in place of the ordinary node
      // logic below. See the block above the class for the state this reads
      // and writes; every other method on this class is unchanged.
      if (!this.driveFacePaintVisit(context, intent, dt)) {
        const node = this.graph.node(this.target);

        if (this.pausing) {
          this.pauseRemaining -= dt;
          this.updateLook(context, dt);
          if (this.pauseRemaining <= 0) {
            this.pausing = false;
            this.chooseNext();
          }
        } else if (node) {
          this.legElapsed += dt;
          const dx = node.x - context.position.x;
          const dz = node.z - context.position.z;
          const distance = Math.hypot(dx, dz);

          if (distance <= ARRIVE_RADIUS) {
            this.arrive(context);
          } else {
            const speed = this.running ? RUN_INTENT : 1;
            const scale = (speed * this.pace) / distance;
            intent.moveX = dx * scale;
            intent.moveZ = dz * scale;
          }

          // A child who has been walking at the same waypoint for a quarter of a
          // minute is stuck on something the edge test did not catch.
          // Re-choosing is a cheaper and far less visible fix than a rescue
          // teleport.
          if (this.legElapsed > LEG_TIMEOUT) {
            this.current = this.target;
            this.chooseNext();
          }
        }
      }
    }

    // --- the bits that make them look like children -------------------------
    this.waveAmount = approach(this.waveAmount, this.waveRemaining > 0 ? 1 : 0, dt * 4.5);
    if (this.waveRemaining > 0) this.waveRemaining -= dt;

    intent.wave = this.waveAmount;
    if (this.pausing && this.lookYaw !== null) intent.lookAt = this.lookYaw;

    if (this.hopRequest && context.grounded) {
      intent.hop = true;
      this.hopRequest = false;
      this.hopCooldown = HOP_COOLDOWN;
    }

    // Blinking is an expression hint, not an animation: the body only pushes it
    // to the model when it changes, because a blink is a texture swap.
    intent.expression =
      this.waveAmount > 0.15 ? 'happy' : this.blinkRemaining > 0 ? 'blink' : 'neutral';
  }

  // ---------------------------------------------------------------- internals

  /** Waves at the player, and copies their hops. */
  private reactToPlayer(context: DriverContext): void {
    const dx = context.playerPosition.x - context.position.x;
    const dz = context.playerPosition.z - context.position.z;
    const distanceSquared = dx * dx + dz * dz;

    if (context.playerHopped && distanceSquared < COPY_HOP_RANGE * COPY_HOP_RANGE) {
      if (this.hopCooldown <= 0) {
        this.hopRequest = true;
        // A copied hop comes with a grin, whether or not a wave was due.
        this.waveRemaining = Math.max(this.waveRemaining, 0.7);
      }
      return;
    }

    if (distanceSquared > NOTICE_RANGE * NOTICE_RANGE) return;
    if (this.waveCooldown > 0 || this.waveRemaining > 0) return;
    // Rolled once a second or so rather than every frame, so passing close by
    // is a good chance of a wave rather than a certainty.
    if (!this.rng.chance(0.012)) return;

    this.waveRemaining = WAVE_DURATION;
    this.waveCooldown = WAVE_COOLDOWN;
    this.lookYaw = Math.atan2(dx, dz);
    this.lookRemaining = WAVE_DURATION;
  }

  /** Turns the head somewhere new every second or two while stopped. */
  private updateLook(context: DriverContext, dt: number): void {
    this.lookRemaining -= dt;
    if (this.lookRemaining > 0) return;
    this.lookRemaining = this.rng.range(0.9, 2.1);

    // Half the time look at whatever is nearest and most interesting: the
    // player if they are about, otherwise back the way you came.
    const dx = context.playerPosition.x - context.position.x;
    const dz = context.playerPosition.z - context.position.z;
    if (dx * dx + dz * dz < NOTICE_RANGE * NOTICE_RANGE && this.rng.chance(0.55)) {
      this.lookYaw = Math.atan2(dx, dz);
      return;
    }
    this.lookYaw = this.rng.range(-Math.PI, Math.PI);
  }

  private arrive(context: DriverContext): void {
    this.previous = this.current;
    this.current = this.target;
    this.legElapsed = 0;

    // Climbing takes priority over the ordinary pause at this waypoint — it
    // is its own "stop and look around" moment, just a more memorable one.
    if (this.tryStartClimb(context)) return;

    const node = this.graph.node(this.current);
    if (node?.interesting && this.rng.chance(PAUSE_CHANCE)) {
      this.pausing = true;
      this.pauseRemaining = this.rng.range(1.4, 4.2);
      this.lookRemaining = 0;
      if (this.hopCooldown <= 0 && this.rng.chance(ARRIVAL_HOP_CHANCE)) this.hopRequest = true;
      return;
    }

    this.chooseNext();
  }

  /** Picks the next waypoint: any neighbour but the one just left. */
  private chooseNext(): void {
    const node = this.graph.node(this.current);
    if (!node || node.neighbours.length === 0) return;

    const options = node.neighbours.filter((index) => index !== this.previous);
    const pool = options.length > 0 ? options : node.neighbours;
    this.target = pool[this.rng.int(0, pool.length - 1)] ?? this.current;
    this.running = this.rng.chance(RUN_CHANCE);
    this.legElapsed = 0;
  }

  // ===========================================================================
  // ADDITIVE BLOCK — riding the park train (`world/train`).
  //
  // Self-contained on purpose: every field it uses is declared here, it hooks
  // into `update` in exactly one place, and it talks to the train through the
  // `trainService()` singleton rather than through anything the crowd owns.
  // Delete this block and its one call and the driver is exactly what it was.
  //
  // The shape of a trip: walk out to a station, wait on the platform, take a
  // seat when the train pulls in, ride a stop or two, get off, walk back into
  // the park. Only the riding part is unusual — while a child is aboard the
  // train writes their x and z (see `ParkTrain.carryPassengers`) and this
  // driver simply asks for nothing, which is exactly what a passenger does.
  // ===========================================================================

  /** What this child is doing about the train. */
  private trainMode: 'none' | 'walking' | 'waiting' | 'riding' = 'none';

  /** Seat number while aboard. Read by `ParkTrain` — see `TrainPassenger`. */
  private seat: number | null = null;

  /** Which stop is being walked to, waited at, or was boarded at. */
  private trainStop = 0;

  /** Seconds until this child next considers a trip. */
  private trainCooldown = 0;

  /** Guards the walk out and the wait, so nobody queues for ever. */
  private trainElapsed = 0;

  private stopsRidden = 0;
  private stopsWanted = 1;
  private lastSeenStop: number | null = null;

  /** Stuck detection for the off-graph walk to the platform. */
  private lastProgressX = 0;
  private lastProgressZ = 0;
  private progressTimer = 0;
  private sidestep = 0;

  /** The seat this child is in, if any. `ParkTrain` reads this every frame. */
  get trainSeat(): number | null {
    return this.seat;
  }

  /**
   * Returns true when the train has this child's attention, in which case the
   * intent has been filled in and the wander behaviour must not run.
   */
  private updateTrainTrip(context: DriverContext, intent: CharacterIntent): boolean {
    const { dt } = context;
    const service = trainService();

    if (!service) {
      // No train in this world (or it has gone away mid-ride).
      this.seat = null;
      this.trainMode = 'none';
      return false;
    }

    switch (this.trainMode) {
      case 'none': {
        this.trainCooldown -= dt;
        if (this.trainCooldown > 0) return false;
        this.trainCooldown = this.rng.range(TRAIN_INTERVAL_MIN, TRAIN_INTERVAL_MAX);
        if (!this.rng.chance(TRAIN_CHANCE)) return false;

        const stop = service.nearestStop(context.position.x, context.position.z);
        if (!stop) return false;

        this.trainStop = stop.index;
        this.trainMode = 'walking';
        this.trainElapsed = 0;
        this.beginProgressCheck(context);
        return false;
      }

      case 'walking': {
        const stop = service.stops[this.trainStop];
        if (!stop) return this.abandonTrip();

        this.trainElapsed += dt;
        if (this.trainElapsed > WALK_TIMEOUT) return this.abandonTrip();

        const dx = stop.x - context.position.x;
        const dz = stop.z - context.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance <= PLATFORM_ARRIVE) {
          this.trainMode = 'waiting';
          this.trainElapsed = 0;
          return true;
        }

        this.steerTowards(context, intent, dx, dz, distance, dt);
        intent.expression = this.blinkRemaining > 0 ? 'blink' : 'neutral';
        return true;
      }

      case 'waiting': {
        this.trainElapsed += dt;
        if (this.trainElapsed > WAIT_TIMEOUT) return this.abandonTrip();

        // Look out along the track, the way anybody waits for a train.
        intent.lookAt = Math.atan2(-context.position.x, -context.position.z) + Math.PI;
        intent.expression = this.blinkRemaining > 0 ? 'blink' : 'happy';

        const seat = service.claimSeat(this.trainStop);
        if (seat !== null) {
          this.seat = seat;
          this.trainMode = 'riding';
          this.stopsRidden = 0;
          this.stopsWanted = this.rng.int(1, 2);
          this.lastSeenStop = this.trainStop;
        }
        return true;
      }

      case 'riding': {
        const seat = this.seat;
        if (seat === null || !service.seatValid(seat)) {
          this.seat = null;
          return this.abandonTrip();
        }

        // Ask for nothing: the train is doing the moving.
        intent.expression = this.blinkRemaining > 0 ? 'blink' : 'happy';
        intent.wave = 0;

        const stopped = service.stoppedAt();
        if (stopped !== null && stopped !== this.lastSeenStop) {
          this.lastSeenStop = stopped;
          this.stopsRidden += 1;

          if (this.stopsRidden >= this.stopsWanted) {
            service.leaveSeat(seat);
            this.seat = null;
            // Straight back into the park: rejoin the waypoint graph at
            // whatever is nearest, which from a platform is the ring road.
            const node = this.graph.nearest(context.position.x, context.position.z);
            if (node) {
              this.current = node.index;
              this.previous = node.index;
              this.target = node.index;
              this.chooseNext();
            }
            this.trainMode = 'none';
            this.trainCooldown = this.rng.range(TRAIN_INTERVAL_MIN, TRAIN_INTERVAL_MAX);
            this.pausing = false;
            this.legElapsed = 0;
            return false;
          }
        }
        return true;
      }

      default:
        return false;
    }
  }

  /**
   * Steers straight at a point, with a sidestep when that stops working.
   *
   * The stations are off the waypoint graph — they are out at the park edge,
   * where there is no paving to author waypoints along — so this is the one
   * place a child steers rather than walks a validated edge. Trees are sparse
   * out there and collision resolution slides them round most things, but a
   * child who has not moved for a few seconds is wedged, and a couple of metres
   * of sideways gets them past it.
   */
  private steerTowards(
    context: DriverContext,
    intent: CharacterIntent,
    dx: number,
    dz: number,
    distance: number,
    dt: number,
  ): void {
    this.progressTimer += dt;
    if (this.progressTimer > STUCK_WINDOW) {
      const moved = Math.hypot(
        context.position.x - this.lastProgressX,
        context.position.z - this.lastProgressZ,
      );
      this.sidestep = moved < STUCK_DISTANCE ? (this.rng.chance(0.5) ? 1 : -1) : 0;
      this.beginProgressCheck(context);
    }

    const scale = this.pace / distance;
    // Perpendicular in the ground plane, which for a heading (dx, dz) is
    // (dz, -dx) — no need to normalise, the scale is shared.
    intent.moveX = (dx + dz * this.sidestep * 0.9) * scale;
    intent.moveZ = (dz - dx * this.sidestep * 0.9) * scale;
  }

  private beginProgressCheck(context: DriverContext): void {
    this.lastProgressX = context.position.x;
    this.lastProgressZ = context.position.z;
    this.progressTimer = 0;
  }

  /** Gives up on the train and goes back to wandering. Always returns false. */
  private abandonTrip(): boolean {
    this.trainMode = 'none';
    this.seat = null;
    this.sidestep = 0;
    this.trainCooldown = this.rng.range(TRAIN_INTERVAL_MIN, TRAIN_INTERVAL_MAX);
    return false;
  }

  // -------------------------------------------------------------- climbing

  /**
   * Rolls the dice on climbing whatever climbable tree is nearest, if any is
   * within reach. True if a climb started — the caller should treat that
   * exactly like beginning a pause.
   */
  private tryStartClimb(context: DriverContext): boolean {
    if (this.climbableTrees.length === 0) return false;
    if (this.climbCooldown > 0) return false;
    if (this.climberBudget && this.climberBudget.active >= this.climberBudget.max) return false;
    if (!this.rng.chance(CLIMB_CHANCE)) return false;

    const tree = nearestTree(
      this.climbableTrees,
      context.position.x,
      context.position.z,
      CLIMB_SEARCH_RADIUS,
    );
    if (!tree) return false;

    this.climbTreeValue = tree;
    this.climbStartX = context.position.x;
    this.climbStartZ = context.position.z;
    this.climbPhaseValue = 'up';
    this.climbTimer = 0;
    if (this.climberBudget) this.climberBudget.active += 1;
    return true;
  }

  /** Runs the up/peek/down timer while a climb owns the character. */
  private updateClimb(dt: number, intent: CharacterIntent): void {
    // Nothing walks, waves or reacts to the player while up a tree — the pose
    // itself is TreeClimbing's job, driven by `climbTree`/`climbPhase`/
    // `climbProgress` below.
    intent.moveX = 0;
    intent.moveZ = 0;
    intent.hop = false;
    intent.interact = false;
    intent.lookAt = null;
    intent.wave = 0;
    // A tree is a nice place to be: happy rather than the usual neutral
    // resting face, blinking exactly as normal.
    intent.expression = this.blinkRemaining > 0 ? 'blink' : 'happy';

    this.climbTimer += dt;
    switch (this.climbPhaseValue) {
      case 'up':
        if (this.climbTimer >= CLIMB_UP_SECONDS) {
          this.climbPhaseValue = 'peek';
          this.climbTimer = 0;
          this.climbPeekFor = this.rng.range(CLIMB_PEEK_MIN, CLIMB_PEEK_MIN + CLIMB_PEEK_RANGE);
        }
        return;
      case 'peek':
        if (this.climbTimer >= this.climbPeekFor) {
          this.climbPhaseValue = 'down';
          this.climbTimer = 0;
        }
        return;
      case 'down':
        if (this.climbTimer >= CLIMB_DOWN_SECONDS) this.endClimb();
        return;
    }
  }

  private endClimb(): void {
    this.climbPhaseValue = null;
    this.climbTreeValue = null;
    if (this.climberBudget) this.climberBudget.active -= 1;
    this.climbCooldown = this.rng.range(CLIMB_COOLDOWN_MIN, CLIMB_COOLDOWN_MIN + CLIMB_COOLDOWN_RANGE);
    // Straight back to ordinary wandering from wherever the climb left it —
    // `current`/`target` never changed, so this is exactly a fresh pause end.
    this.chooseNext();
  }


  // ---- face painting stall (additive — see the block above the class) ----

  /**
   * One frame of "on the way to, or being painted at, the face-painting
   * stall". Returns `true` the moment it has taken movement over for this
   * frame — the caller skips the ordinary wander logic entirely when it does.
   *
   * Every early `return false` leaves every field it touched back where the
   * ordinary wander logic expects it, so a child who never gets picked for a
   * visit costs this method nothing beyond the position bookkeeping at the
   * top, which the stall's decal renderer needs regardless.
   */
  private driveFacePaintVisit(context: DriverContext, intent: CharacterIntent, dt: number): boolean {
    // Cheap approximate head tracking, kept up to date every frame whether or
    // not this child ever visits — `FacePaintStall` reads it straight off the
    // registry in `paintedNpcFaces()`.
    this.faceX = context.position.x;
    this.faceZ = context.position.z;

    if (this.paintVisit === 'none') {
      if (this.paintDesign !== null) return false; // one coat is plenty
      this.paintCooldown -= dt;
      if (this.paintCooldown > 0) return false;

      if (!facePaintStallTarget || paintedOrVisitingCount() >= MAX_CONCURRENT_PAINTED) {
        // No stall yet, or every decal slot is spoken for — try again soon
        // rather than queuing, since there is nowhere to queue.
        this.paintCooldown = this.rng.range(6, 16);
        return false;
      }
      if (!this.rng.chance(PAINT_VISIT_CHANCE)) {
        this.paintCooldown = this.rng.range(15, 40);
        return false;
      }
      this.paintVisit = 'walking';
    }

    const stall = facePaintStallTarget;
    if (!stall) {
      // The stall vanished from under a child already on the way — cannot
      // happen in practice (it is built once and never disposed while the
      // park is up), but bail cleanly rather than walking towards nothing.
      this.paintVisit = 'none';
      return false;
    }

    if (this.paintVisit === 'walking') {
      const dx = stall.standX - context.position.x;
      const dz = stall.standZ - context.position.z;
      const distance = Math.hypot(dx, dz);

      if (distance <= ARRIVE_RADIUS) {
        this.paintVisit = 'pausing';
        this.paintPauseRemaining = this.rng.range(1.6, 2.4);
        this.faceYaw = Math.atan2(stall.x - context.position.x, stall.z - context.position.z);
        intent.lookAt = this.faceYaw;
        return true;
      }

      const scale = this.pace / distance;
      intent.moveX = dx * scale;
      intent.moveZ = dz * scale;
      this.faceYaw = Math.atan2(dx, dz);
      return true;
    }

    // `pausing`: stand and face the painter. `FacePaintStall` drives the
    // actual painter-leans-in-and-sparkles cutscene visuals on its own clock;
    // this only has to keep the child politely still for roughly as long.
    this.paintPauseRemaining -= dt;
    intent.lookAt = this.faceYaw;
    if (this.paintPauseRemaining > 0) return true;

    this.paintDesign = this.rng.pick(NPC_PAINT_DESIGNS);
    this.paintVisit = 'none';

    // Back into the ordinary graph from wherever the stall turned out to be —
    // the nearest waypoint becomes "current" so `chooseNext` has somewhere
    // sane to carry on from, exactly as the `LEG_TIMEOUT` rescue re-route does.
    const nearest = this.graph.nearest(context.position.x, context.position.z);
    if (nearest) {
      this.current = nearest.index;
      this.previous = nearest.index;
    }
    this.chooseNext();
    return false;
  }

  // ===========================================================================
  // ADDITIVE BLOCK — chatting with the player (`entities/npc/chatActivity.ts`).
  //
  // The fourth additive block in this file (train, tree climbing, face paint,
  // and now this) — see ARCHITECTURE-DECISIONS.md, Decision 2: the architect's
  // standing recommendation is that a proper `Activity` abstraction is now
  // warranted to absorb these mechanically. Not done here, on purpose — this
  // block is kept exactly the same shape as its three neighbours (self-
  // contained state, one call from `update`, a single tuning/content module
  // alongside it) specifically so that future refactor can lift it wholesale.
  //
  // The shape of a chat: notice the player has stood still for a couple of
  // seconds, walk over, stop short of them, say something, wave and smile for
  // a few seconds, then say goodbye and go back to ordinary wandering — early,
  // if the player wanders off first. `NpcSystem` reads `chatBubbleText` (see
  // the getter above) to float a `SpeechBubble` over whichever child is
  // talking; this file never touches rendering.
  // ===========================================================================

  /**
   * One frame of "on the way to, mid, or waving goodbye from, a chat with the
   * player". Returns `true` the moment it has taken the frame over — the
   * caller (`update`) skips the train trip and the face-paint visit entirely
   * while this is happening, exactly as those two already skip each other.
   *
   * Every early `return false` leaves state exactly where the caller expects
   * it, so a child who is never eligible (busy, out of range, capped by the
   * shared budget, unlucky on the roll) costs this method nothing beyond the
   * cooldown bookkeeping at the top.
   */
  private updateChatActivity(context: DriverContext, intent: CharacterIntent, dt: number): boolean {
    this.chatCooldown -= dt;

    if (this.chatState === 'none') {
      this.chatRollTimer -= dt;
      if (this.chatCooldown > 0) return false;
      // Never poaches a child already committed to the train or the paint
      // stall — and a climbing child never reaches this line at all, since
      // `update` returns out of `updateClimb` before getting here.
      if (this.trainMode !== 'none' || this.paintVisit !== 'none') return false;
      if (this.chatRollTimer > 0) return false;
      this.chatRollTimer = this.rng.range(CHAT_ROLL_MIN, CHAT_ROLL_MAX);

      if (context.playerStationaryFor < CHAT_TRIGGER_STATIONARY) return false;

      const dx = context.playerPosition.x - context.position.x;
      const dz = context.playerPosition.z - context.position.z;
      if (dx * dx + dz * dz > CHAT_RADIUS * CHAT_RADIUS) return false;

      if (!this.chatBudget || this.chatBudget.active >= this.chatBudget.max) {
        // Capped for the whole park right now — try again soon rather than
        // queuing, exactly like a full face-paint stall.
        this.chatCooldown = this.rng.range(2, 5);
        return false;
      }
      if (!this.rng.chance(CHAT_START_CHANCE)) return false;

      this.chatBudget.active += 1;
      this.chatState = 'approaching';
      this.chatElapsed = 0;
    }

    if (this.chatState === 'approaching') {
      this.chatElapsed += dt;
      const dx = context.playerPosition.x - context.position.x;
      const dz = context.playerPosition.z - context.position.z;
      const distance = Math.hypot(dx, dz);

      // The player wandered off, or this is taking too long (stuck on
      // something) — give up quietly rather than chasing forever.
      if (distance > CHAT_GIVEUP_RADIUS || this.chatElapsed > CHAT_APPROACH_TIMEOUT) {
        this.endChat(context);
        return false;
      }

      if (distance <= CHAT_STOP_DISTANCE) {
        // Arrived: turn to face them, pick a line, and start talking. Stopping
        // at `CHAT_STOP_DISTANCE` — well outside `PLAYER_SEPARATION` in
        // `NpcSystem.ts` — is what keeps this a friendly stop rather than a
        // shoving match once player↔NPC collision gets involved.
        this.chatState = 'talking';
        this.chatTalkRemaining = this.rng.range(CHAT_TALK_MIN, CHAT_TALK_MAX);
        this.chatLine = pickChatLine(this.rng, context.playerWearingHat);
        intent.moveX = 0;
        intent.moveZ = 0;
        intent.lookAt = Math.atan2(dx, dz);
        // Piggy-backs the ordinary wave/happy blend in `update`'s tail — see
        // that field's own doc comment.
        this.waveRemaining = Math.max(this.waveRemaining, 0.5);
        return true;
      }

      const scale = this.pace / distance;
      intent.moveX = dx * scale;
      intent.moveZ = dz * scale;
      intent.lookAt = Math.atan2(dx, dz);
      return true;
    }

    if (this.chatState === 'talking') {
      const dx = context.playerPosition.x - context.position.x;
      const dz = context.playerPosition.z - context.position.z;
      const distance = Math.hypot(dx, dz);

      intent.moveX = 0;
      intent.moveZ = 0;
      intent.lookAt = Math.atan2(dx, dz);
      this.waveRemaining = Math.max(this.waveRemaining, 0.3);

      this.chatTalkRemaining -= dt;
      // `playerStationaryFor` drops to zero the instant the player takes a
      // step — the cue to wrap up "as soon as the player moves away" rather
      // than waiting out the timer.
      const playerLeft = distance > CHAT_GIVEUP_RADIUS || context.playerStationaryFor <= 0;

      if (playerLeft || this.chatTalkRemaining <= 0) {
        this.chatState = 'leaving';
        this.chatLeaveRemaining = CHAT_GOODBYE_DURATION;
        this.chatLine = pickGoodbyeLine(this.rng);
      }
      return true;
    }

    // 'leaving': a brief goodbye wave, still facing the player, before handing
    // back to ordinary wandering.
    const dx = context.playerPosition.x - context.position.x;
    const dz = context.playerPosition.z - context.position.z;
    intent.moveX = 0;
    intent.moveZ = 0;
    intent.lookAt = Math.atan2(dx, dz);
    this.waveRemaining = Math.max(this.waveRemaining, 0.3);

    this.chatLeaveRemaining -= dt;
    if (this.chatLeaveRemaining <= 0) {
      this.endChat(context);
      return false;
    }
    return true;
  }

  /**
   * Ends a chat, whatever state it got to — abandoned mid-approach or a
   * completed goodbye. Always frees the shared budget slot exactly once (it
   * is claimed exactly once, on starting) and sends the child back into
   * ordinary wandering from wherever they ended up — the same re-anchor-to-
   * the-graph move `driveFacePaintVisit` makes on its own way out.
   */
  private endChat(context: DriverContext): void {
    if (this.chatBudget) this.chatBudget.active = Math.max(0, this.chatBudget.active - 1);
    this.chatState = 'none';
    this.chatLine = null;
    this.chatCooldown = this.rng.range(CHAT_COOLDOWN_MIN, CHAT_COOLDOWN_MIN + CHAT_COOLDOWN_RANGE);

    const nearest = this.graph.nearest(context.position.x, context.position.z);
    if (nearest) {
      this.current = nearest.index;
      this.previous = nearest.index;
    }
    this.chooseNext();
  }
}

// --- tuning for the additive block above -------------------------------------

/** Seconds between one child wondering about the train and the next time. */
const TRAIN_INTERVAL_MIN = 22;
const TRAIN_INTERVAL_MAX = 70;

/** …and the chance they actually go, when they do wonder. */
const TRAIN_CHANCE = 0.55;

/** Close enough to the middle of the platform to count as waiting on it. */
const PLATFORM_ARRIVE = 1.6;

/** Longest a child spends walking to a station, or standing on one. */
const WALK_TIMEOUT = 60;
const WAIT_TIMEOUT = 45;

/** Moving less than this in this long means something is in the way. */
const STUCK_WINDOW = 2.5;
const STUCK_DISTANCE = 0.8;

/** Moves `value` towards `target` by at most `step`. */
function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step);
  if (value > target) return Math.max(target, value - step);
  return clamp01(value);
}

/** Nearest tree to (x, z) within `maxDistance`, or `null`. */
function nearestTree(
  trees: readonly ClimbableTreeSeed[],
  x: number,
  z: number,
  maxDistance: number,
): ClimbableTreeSeed | null {
  let best: ClimbableTreeSeed | null = null;
  let bestDistance = maxDistance;
  for (const tree of trees) {
    const distance = Math.hypot(tree.x - x, tree.z - z);
    if (distance < bestDistance) {
      best = tree;
      bestDistance = distance;
    }
  }
  return best;
}
