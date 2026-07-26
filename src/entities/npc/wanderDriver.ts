import type { Rng } from '../../core/mathUtils';
import { clamp01 } from '../../core/mathUtils';
import { RUN_INTENT, type CharacterDriver, type CharacterIntent, type DriverContext } from './driver';
import type { PoiGraph } from './poiGraph';

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
}

/** Moves `value` towards `target` by at most `step`. */
function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step);
  if (value > target) return Math.max(target, value - step);
  return clamp01(value);
}
