import type { Rng } from '../../../core/mathUtils';
import { clamp01 } from '../../../core/mathUtils';
import type { ClimbableTreeSeed } from '../../../world/Scenery';
import type { CharacterIntent, DriverContext } from '../driver';
import type { Activity, ActivityBudget, ActivityHold, ActivityHost } from './activity';
import { BudgetSlot } from './budget';

/**
 * Climbing a tree (item 22 of the family's design feedback).
 *
 * This owns only the *decision* and the *timing* — whether to climb, which
 * tree, how long each phase lasts. `world/TreeClimbing.ts` reads the small
 * public surface below and does the actual posing; it owns the body-hiding and
 * the pose maths, shared with the player's own climb.
 *
 * The odd one out among the activities, in two ways, and both are why
 * `Activity` has the shape it has:
 *
 * - It holds the **whole child** (`hold: 'child'`). Nothing walks, waves or
 *   notices the player while a child is up a tree — they are somewhere else.
 * - It starts from {@link onArrive} rather than {@link update}, because a climb
 *   is a thing you do because you have just walked up to a tree, not something
 *   you decide in mid-stride. It takes the place of the ordinary pause at that
 *   waypoint — it is its own "stop and look around" moment, just a more
 *   memorable one.
 *
 * It is also the one activity that never fails: it starts where the child
 * already stands, so there is no walk to wedge and no target to vanish. When
 * it lets go it rejoins `'inPlace'` — the child is exactly where the climb
 * found them.
 */
export class TreeClimb implements Activity {
  readonly name = 'treeClimb';
  readonly hold: ActivityHold = 'child';

  private readonly trees: readonly ClimbableTreeSeed[];
  private readonly slot: BudgetSlot;
  private cooldown: number;

  private phase: ClimbPhase | null = null;
  private tree: ClimbableTreeSeed | null = null;
  private timer = 0;
  private peekFor = 0;
  /** Where the child stood when the climb began. Handed out by
   *  {@link climbGroundSpot}; rewritten, never replaced. */
  private readonly groundSpot = { x: 0, z: 0 };

  constructor(rng: Rng, trees: readonly ClimbableTreeSeed[], budget: ActivityBudget | undefined) {
    this.trees = trees;
    // A missing budget means "no cap", which is how the climb block read it
    // before this refactor. See `BudgetSlot`.
    this.slot = new BudgetSlot(budget, 'allow');
    // Staggered like the first pause, so the park doesn't decide to climb in
    // step either — and nobody is eligible in the first minute.
    this.cooldown = rng.range(10, 70);
  }

  /** True for the whole climb — up, peeking and down. */
  get busy(): boolean {
    return this.phase !== null;
  }

  /** Which tree, while {@link busy}. */
  get climbTree(): ClimbableTreeSeed | null {
    return this.tree;
  }

  /** Which part of the climb. `null` when not climbing. */
  get climbPhase(): ClimbPhase | null {
    return this.phase;
  }

  /** 0..1 through the current phase. Meaningless (and unused) during `peek`. */
  get climbProgress(): number {
    if (this.phase === 'up') return clamp01(this.timer / CLIMB_UP_SECONDS);
    if (this.phase === 'down') return clamp01(this.timer / CLIMB_DOWN_SECONDS);
    return 1;
  }

  /**
   * Where the child was standing when it started up — the base of the scramble.
   *
   * Returns the same object every time, rewritten when a climb begins.
   * `TreeClimbing.updateNpcClimbs` reads this once per climbing child per
   * frame, so a fresh literal here was up to three objects a frame for as long
   * as anybody was up a tree, which is the sort of thing the standing GC-pause
   * complaint is made of. Read it and use it; do not keep it.
   */
  get climbGroundSpot(): { readonly x: number; readonly z: number } {
    return this.groundSpot;
  }

  /**
   * Rolls the dice on climbing whatever climbable tree is nearest, if any is
   * within reach. `true` if a climb started — the core treats that exactly like
   * beginning a pause.
   */
  onArrive(host: ActivityHost, context: DriverContext): boolean {
    if (this.trees.length === 0) return false;
    if (this.cooldown > 0) return false;
    if (this.slot.full) return false;
    if (!host.rng.chance(CLIMB_CHANCE)) return false;

    const tree = nearestTree(this.trees, context.position.x, context.position.z, CLIMB_SEARCH_RADIUS);
    if (!tree) return false;

    this.tree = tree;
    this.groundSpot.x = context.position.x;
    this.groundSpot.z = context.position.z;
    this.phase = 'up';
    this.timer = 0;
    this.slot.claim();
    return true;
  }

  /** Runs the up/peek/down timer while a climb owns the character. */
  update(host: ActivityHost, context: DriverContext, intent: CharacterIntent): boolean {
    const { dt } = context;
    // Ticks whatever else the child is doing, so a trip or a chat does not
    // also postpone the next climb.
    this.cooldown -= dt;
    if (this.phase === null) return false;

    // Nothing walks, waves or reacts to the player while up a tree — the pose
    // itself is TreeClimbing's job, driven by `climbTree`/`climbPhase`/
    // `climbProgress` above.
    intent.moveX = 0;
    intent.moveZ = 0;
    intent.hop = false;
    intent.interact = false;
    intent.lookAt = null;
    intent.wave = 0;
    // A tree is a nice place to be: happy rather than the usual neutral
    // resting face, blinking exactly as normal.
    intent.expression = host.blinking ? 'blink' : 'happy';

    this.timer += dt;
    switch (this.phase) {
      case 'up':
        if (this.timer >= CLIMB_UP_SECONDS) {
          this.phase = 'peek';
          this.timer = 0;
          this.peekFor = host.rng.range(CLIMB_PEEK_MIN, CLIMB_PEEK_MIN + CLIMB_PEEK_RANGE);
        }
        return true;
      case 'peek':
        if (this.timer >= this.peekFor) {
          this.phase = 'down';
          this.timer = 0;
        }
        return true;
      case 'down':
        if (this.timer >= CLIMB_DOWN_SECONDS) this.endClimb(host, context);
        return true;
    }
  }

  private endClimb(host: ActivityHost, context: DriverContext): void {
    this.phase = null;
    this.tree = null;
    this.slot.release();
    this.cooldown = host.rng.range(CLIMB_COOLDOWN_MIN, CLIMB_COOLDOWN_MIN + CLIMB_COOLDOWN_RANGE);
    // Straight back to ordinary wandering from wherever the climb left it —
    // the child never moved, so this is exactly a fresh pause end.
    host.rejoinGraph(context, 'inPlace');
  }
}

/** A phase of the little scripted moment, in order. */
export type ClimbPhase = 'up' | 'peek' | 'down';

/**
 * Caps how many children are up trees across the whole park at once, so a
 * lucky run of coin flips can't put half the crowd in the branches. Shared —
 * one instance handed to every `WanderDriver` by `NpcSystem`.
 */
export type ClimberBudget = ActivityBudget;

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
