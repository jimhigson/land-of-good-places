import type { Rng } from '../../core/mathUtils';
import { clamp01 } from '../../core/mathUtils';
import { RUN_INTENT, type CharacterDriver, type CharacterIntent, type DriverContext } from './driver';
import type { PoiGraph } from './poiGraph';
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
    // Staggered like the first pause below, so the park doesn't decide to
    // climb in step either — and nobody is eligible in the first minute.
    this.climbCooldown = this.rng.range(10, 70);
    // Stagger the first decision so the whole park does not set off in step.
    this.pausing = true;
    this.pauseRemaining = this.rng.range(0, 2.5);
    this.chooseNext();
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
        this.arrive(context);
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

/** Moves `value` towards `target` by at most `step`. */
function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step);
  if (value > target) return Math.max(target, value - step);
  return clamp01(value);
}
