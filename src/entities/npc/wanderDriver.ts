import type { Rng } from '../../core/mathUtils';
import { createBlinkClock, type BlinkClock } from '../../art/style/faceLife';
import { clamp01 } from '../../core/mathUtils';
import { RUN_INTENT, type CharacterDriver, type CharacterIntent, type DriverContext } from './driver';
import type { PoiGraph } from './poiGraph';
// The things a child does instead of wandering. See `activities/activity.ts`
// for what an `Activity` is and why it has the shape it has; this file keeps
// only the wander core and the small amount of glue that runs them.
import type { Activity, ActivityHold, ActivityHost, Rejoin } from './activities/activity';
import { TreeClimb, type ClimbPhase, type ClimberBudget } from './activities/treeClimb';
import { BusArrival } from './activities/busArrival';
import { TrainTrip } from './activities/trainTrip';
import { ChatToPlayer } from './activities/chatToPlayer';
import { FacePaintVisit } from './activities/facePaintVisit';
// Chatting: the budget is handed to every driver by `NpcSystem`; the state
// machine itself lives in `activities/chatToPlayer.ts`.
import type { ChatBudget } from './chatActivity';
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

// Re-exported so the climb's consumers (`world/TreeClimbing.ts`,
// `NpcSystem.ts`) do not have to care that it moved into `activities/`.
export type { ClimbPhase, ClimberBudget };

// Re-exported so `world/FacePaintStall.ts` does not have to care that the
// visit moved into `activities/`.
export {
  registerFacePaintStall,
  paintedNpcFaces,
  type FacePaintStallTarget,
  type PaintedNpcFace,
} from './activities/facePaintVisit';

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
  /**
   * This child rides in on the cat bus and is not to be steered until they are
   * off it. Eleven of the park's own children start life aboard — see
   * `activities/busArrival.ts`.
   */
  readonly arrivesByBus?: boolean;
}

export class WanderDriver implements CharacterDriver, ActivityHost {
  readonly name = 'wander';

  private readonly graph: PoiGraph;
  readonly rng: Rng;
  readonly pace: number;

  /**
   * Everything this child does instead of wandering, in the order they are
   * offered the frame. Built once, at construction — nothing here allocates
   * per frame, because there are eighteen children and they are drawn with an
   * `InstancedMesh`.
   */
  private readonly activities: readonly Activity[];
  private readonly climb: TreeClimb;
  private readonly train: TrainTrip;
  private readonly bus: BusArrival;
  private readonly chat: ChatToPlayer;
  private readonly paint: FacePaintVisit;

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

  /** The one blink beat, on this child's own seeded random. See `faceLife.ts`. */
  private readonly blinkClock: BlinkClock;
  private blinkingNow = false;

  constructor(options: WanderOptions) {
    this.graph = options.graph;
    this.rng = options.rng;
    this.pace = options.pace ?? 1;
    this.current = options.startNode;
    this.previous = options.startNode;
    this.target = options.startNode;
    this.blinkClock = createBlinkClock(() => this.rng.range(0, 1));
    // Activities are constructed exactly where their state used to be
    // initialised, because several of them draw from this child's seeded
    // stream and the order of those draws is behaviour, not detail.
    this.climb = new TreeClimb(this.rng, options.climbableTrees ?? [], options.climberBudget);
    // Draws nothing from the seeded stream, so its position in this sequence is
    // free — but it must exist before `activities` is assembled below.
    this.bus = new BusArrival(options.arrivesByBus ?? false);
    // The trip draws nothing from the stream until the first time it wonders
    // about the train, so it can be built anywhere in here.
    this.train = new TrainTrip();
    // Stagger the first decision so the whole park does not set off in step.
    this.pausing = true;
    this.pauseRemaining = this.rng.range(0, 2.5);
    this.chooseNext();

    // Stagger the first face-paint roll too, and start tracking the head at
    // whatever waypoint this child spawned on.
    const startNode = this.graph.node(options.startNode);
    this.paint = new FacePaintVisit(this.rng, startNode?.x ?? 0, startNode?.z ?? 0);
    // Stagger the first chat roll too, so nobody is eligible in the opening seconds.
    this.chat = new ChatToPlayer(this.rng, options.chatBudget);

    // The order the frame is offered in. Unchanged from the chain of `if`s
    // this replaced — the climb pre-empts everything (see `ActivityHold`), then
    // chat, then the train, then the paint stall — except that the bus now
    // comes first of all. It has to: a child on the bus has not arrived in the
    // park yet, and every other activity here assumes a child who is standing
    // in it. Being ahead of the climb is not a priority judgement so much as
    // the observation that you cannot climb a tree from a moving vehicle.
    this.activities = [this.bus, this.climb, this.chat, this.train, this.paint];
  }

  /** Where this child is heading, for debugging and for the pet to follow. */
  get targetNode(): number {
    return this.target;
  }

  // The climb's public surface, read by `world/TreeClimbing.ts`. Delegated
  // rather than moved so that file is untouched by this refactor.

  /** True for the whole climb — up, peeking and down. */
  get climbing(): boolean {
    return this.climb.busy;
  }

  /** Which tree, while {@link climbing}. */
  get climbTree(): ClimbableTreeSeed | null {
    return this.climb.climbTree;
  }

  /** Which part of the climb. `null` when not climbing. */
  get climbPhase(): ClimbPhase | null {
    return this.climb.climbPhase;
  }

  /** 0..1 through the current phase. Meaningless (and unused) during `peek`. */
  get climbProgress(): number {
    return this.climb.climbProgress;
  }

  /** Where the child was standing when it started up — the base of the scramble. */
  get climbGroundSpot(): { readonly x: number; readonly z: number } {
    return this.climb.climbGroundSpot;
  }

  // The bus arrival's public surface, read and driven by
  // `world/entrance/ArrivalSequence.ts`. Delegated for the same reason the
  // climb's is: the owning system talks to the driver, never to the activity.

  /** True while this child is still aboard the cat bus. */
  get ridingBus(): boolean {
    return this.bus.riding;
  }

  /**
   * "You are off the bus." The child rejoins the waypoint graph on their next
   * frame and walks into the park as an ordinary member of the crowd.
   */
  leaveBus(): void {
    this.bus.disembark();
  }

  /**
   * What this child is saying right now, for `NpcSystem` to show in a
   * {@link SpeechBubble} — `null` whenever they are not mid-chat. `null`
   * during `approaching` on purpose: the line is chosen on arrival, not
   * before, so the bubble appears exactly when they stop and turn to face
   * the player.
   */
  get chatBubbleText(): string | null {
    return this.chat.bubbleText;
  }

  /** The seat this child is in, if any. `ParkTrain` reads this every frame —
   *  see the structural `TrainPassenger` type in `world/train/service.ts`. */
  get trainSeat(): number | null {
    return this.train.trainSeat;
  }

  update(context: DriverContext, intent: CharacterIntent): void {
    const { dt } = context;

    this.waveCooldown -= dt;
    this.hopCooldown -= dt;
    // Kept above the activities so a child blinks whether they are wandering,
    // riding or up a tree: an activity holding the whole intent never reaches
    // the expression line at the bottom of this method.
    this.blinkingNow = this.blinkClock.expressionFor(dt, 'neutral') === 'blink';

    // Where a painted child's face is, for the stall to hang their decal near.
    // Above the activities rather than inside the visit, because a climb or a
    // train trip takes the frame before the visit is ever offered it, and a
    // child does not stop having a face while they are up a tree
    // (ARCHITECTURE-REVIEW C2).
    this.paint.trackHead(context);

    // An activity that holds the whole child gets the frame before the child
    // even notices the player: nobody waves from up a tree.
    let hold = this.offerFrame(true, context, intent);

    if (hold === null) {
      this.reactToPlayer(context);

      hold = this.offerFrame(false, context, intent);

      if (hold === null) this.updateWander(context, intent, dt);
    }

    // `'intent'` and `'child'` hold the whole intent, so the social tail below
    // does not run for them — they write their own expression. See
    // `ActivityHold`.
    if (hold === 'intent' || hold === 'child') {
      // Nothing is going to consume what the social half of this method was
      // saving up, so drop it rather than let it queue (ARCHITECTURE-REVIEW C3).
      //
      // `reactToPlayer` still runs before a `'intent'` activity claims the
      // frame — it has to, because it draws from the seeded stream and skipping
      // it would shift every later decision this child makes. What it asks for
      // is what leaked. A hop copied from the player on the platform sat in
      // `hopRequest` for the whole ride and fired when the child stepped off the
      // train, a minute after the hop it was copying. And `waveAmount` froze
      // part-way through its blend while the arm itself snapped down (the body
      // clears the intent every frame), so the arm jumped back up to where the
      // blend had stopped when the trip let go.
      //
      // Two blocks' assumptions colliding: the social tail assumed it always
      // ran, the trip assumed it owned everything. The trip does own everything
      // — so the answer is that a child who gets on a train has finished
      // waving.
      this.hopRequest = false;
      this.waveRemaining = 0;
      this.waveAmount = 0;
      return;
    }

    // --- the bits that make them look like children -------------------------
    this.waveAmount = approach(this.waveAmount, this.waveRemaining > 0 ? 1 : 0, dt * 4.5);
    if (this.waveRemaining > 0) this.waveRemaining -= dt;

    intent.wave = this.waveAmount;

    // Where a child looks while paused belongs to the wander core, so it is
    // only applied on the frames the core is actually steering them.
    //
    // A `'steering'` activity leaves this tail running — that is the point of
    // the hold, so a chatting child still blends their wave — but where they
    // walk and where they look are one decision, not two, and the activity
    // making it is the one that knows. Without the `hold` test, a chat that
    // began while the child happened to be mid-pause had them talking to the
    // player while gazing off at whatever the pause had last picked out, and a
    // child walking to the paint stall looked somewhere other than the stall.
    //
    // The pause itself is left alone: neither chat nor paint clears `pausing`
    // when it takes over (they rejoin `'legacy'`), so the child resumes the
    // pause afterwards exactly as before. Unifying that with the train's
    // `'full'` rejoin is a separate behaviour change — see `Rejoin`.
    if (hold === null && this.pausing && this.lookYaw !== null) intent.lookAt = this.lookYaw;

    if (this.hopRequest && context.grounded) {
      intent.hop = true;
      this.hopRequest = false;
      this.hopCooldown = HOP_COOLDOWN;
    }

    // Blinking is an expression hint, not an animation: the body only pushes it
    // to the model when it changes, because a blink is a texture swap.
    intent.expression =
      this.waveAmount > 0.15 ? 'happy' : this.blinkingNow ? 'blink' : 'neutral';
  }

  // ------------------------------------------------------------- running them

  /**
   * Offers the frame to each activity in turn; the first to take it wins and
   * nothing after it runs.
   *
   * Two passes, because activities do not all take the same amount of the
   * child: `preemptive` selects the ones that hold the whole child
   * (`hold: 'child'`), which are offered the frame before `reactToPlayer` —
   * so a child up a tree does not roll for a wave, and does not consume a
   * draw from their seeded stream doing it.
   *
   * Indexed loop, no closures, no iterators: this runs for every child every
   * frame.
   */
  private offerFrame(
    preemptive: boolean,
    context: DriverContext,
    intent: CharacterIntent,
  ): ActivityHold | null {
    for (let i = 0; i < this.activities.length; i += 1) {
      const activity = this.activities[i];
      if (!activity) continue;
      if ((activity.hold === 'child') !== preemptive) continue;
      if (activity.update(this, context, intent)) return activity.hold;
    }
    return null;
  }

  // -------------------------------------------------------- ActivityHost

  /** True on the frames this child's eyes are shut. */
  get blinking(): boolean {
    return this.blinkingNow;
  }

  /** True if any activity other than `asking` is mid-something. */
  othersBusy(asking: Activity): boolean {
    for (let i = 0; i < this.activities.length; i += 1) {
      const activity = this.activities[i];
      if (!activity || activity === asking) continue;
      if (activity.busy) return true;
    }
    return false;
  }

  /** Asks for a wave of at least `seconds`, eased in by the social tail. */
  requestWave(seconds: number): void {
    this.waveRemaining = Math.max(this.waveRemaining, seconds);
  }

  /**
   * Puts the child back into ordinary wandering when an activity lets go.
   * The three variants are pre-existing and differ in ways nobody recorded —
   * see {@link Rejoin} and HANDOFF-activity.md.
   */
  rejoinGraph(context: DriverContext, how: Rejoin): void {
    if (how !== 'inPlace') {
      // Rejoin at whatever waypoint is nearest, which from a station platform
      // is the ring road, and from the paint stall is the path outside it.
      const nearest = this.graph.nearest(context.position.x, context.position.z);
      if (nearest) {
        this.current = nearest.index;
        this.previous = nearest.index;
        if (how === 'full') this.target = nearest.index;
      }
    }
    this.chooseNext();
    if (how === 'full') {
      this.pausing = false;
      this.legElapsed = 0;
    }
  }

  // ---------------------------------------------------------------- internals

  /** Walk to the next waypoint, or stand at this one and look around. */
  private updateWander(context: DriverContext, intent: CharacterIntent, dt: number): void {
    const node = this.graph.node(this.target);

    if (this.pausing) {
      this.pauseRemaining -= dt;
      this.updateLook(context, dt);
      if (this.pauseRemaining <= 0) {
        this.pausing = false;
        this.chooseNext();
      }
      return;
    }

    if (!node) return;

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
    // minute is stuck on something the edge test did not catch. Re-choosing is
    // a cheaper and far less visible fix than a rescue teleport.
    if (this.legElapsed > LEG_TIMEOUT) {
      this.current = this.target;
      this.chooseNext();
    }
  }

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

    // An activity may claim the arrival itself — climbing a tree takes
    // priority over the ordinary pause at this waypoint, being its own "stop
    // and look around" moment, just a more memorable one.
    for (let i = 0; i < this.activities.length; i += 1) {
      const activity = this.activities[i];
      if (activity?.onArrive?.(this, context)) return;
    }

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
