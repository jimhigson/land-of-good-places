import type { Rng } from '../../core/mathUtils';
import { clamp01 } from '../../core/mathUtils';
import { RUN_INTENT, type CharacterDriver, type CharacterIntent, type DriverContext } from './driver';
import type { PoiGraph } from './poiGraph';
// The park train. Used only by the additive block at the bottom of this file,
// and only through a singleton that is `null` in a world without one.
import { trainService } from '../../world/train/service';

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

export interface WanderOptions {
  readonly graph: PoiGraph;
  readonly rng: Rng;
  /** Index of the waypoint the child starts on. */
  readonly startNode: number;
  /** Multiplies every walking speed for this child. Not everyone is brisk. */
  readonly pace?: number;
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

  constructor(options: WanderOptions) {
    this.graph = options.graph;
    this.rng = options.rng;
    this.pace = options.pace ?? 1;
    this.current = options.startNode;
    this.previous = options.startNode;
    this.target = options.startNode;
    this.blinkTimer = this.rng.range(1.5, 5.5);
    // Stagger the first decision so the whole park does not set off in step.
    this.pausing = true;
    this.pauseRemaining = this.rng.range(0, 2.5);
    this.chooseNext();
  }

  /** Where this child is heading, for debugging and for the pet to follow. */
  get targetNode(): number {
    return this.target;
  }

  update(context: DriverContext, intent: CharacterIntent): void {
    const { dt } = context;

    this.waveCooldown -= dt;
    this.hopCooldown -= dt;
    this.blinkTimer -= dt;
    if (this.blinkRemaining > 0) this.blinkRemaining -= dt;

    this.reactToPlayer(context);

    // Catching the park train, if there is one and this child fancies it. The
    // whole behaviour is in the additive block at the bottom of this file; when
    // it is handling the frame, it has filled the intent in itself.
    if (this.updateTrainTrip(context, intent)) return;

    // --- where am I trying to be? -------------------------------------------
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
        this.arrive();
      } else {
        const speed = this.running ? RUN_INTENT : 1;
        const scale = (speed * this.pace) / distance;
        intent.moveX = dx * scale;
        intent.moveZ = dz * scale;
      }

      // A child who has been walking at the same waypoint for a quarter of a
      // minute is stuck on something the edge test did not catch. Re-choosing
      // is a cheaper and far less visible fix than a rescue teleport.
      if (this.legElapsed > LEG_TIMEOUT) {
        this.current = this.target;
        this.chooseNext();
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
    if (this.blinkTimer <= 0) {
      this.blinkTimer = this.rng.range(2.4, 6.2);
      this.blinkRemaining = 0.12;
    }

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

  private arrive(): void {
    this.previous = this.current;
    this.current = this.target;
    this.legElapsed = 0;

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
