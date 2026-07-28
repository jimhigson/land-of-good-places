import type { Rng } from '../../../core/mathUtils';
import type { CharacterIntent, DriverContext } from '../driver';
// Content — what a child says and when — lives in its own module so this file
// stays about timing and state, not word lists.
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
} from '../chatActivity';
import type { Activity, ActivityHold, ActivityHost } from './activity';
import { BudgetSlot } from './budget';
import { Errand } from './errand';

/**
 * Coming over for a chat with the player.
 *
 * The shape of a chat: notice the player has stood still for a couple of
 * seconds, walk over, stop short of them, say something, wave and smile for a
 * few seconds, then say goodbye and go back to ordinary wandering — early, if
 * the player wanders off first. `NpcSystem` reads {@link bubbleText} to float a
 * `SpeechBubble` over whichever child is talking; this file never touches
 * rendering.
 *
 * The short one, and the one whose *target moves*. Both show up in what it
 * asks of the shared pieces:
 *
 * - It holds only `'steering'`. A chat is mostly a wave and a face, and both
 *   of those belong to the core's social tail — so it asks for the wave
 *   (`host.requestWave`) and lets the tail ease it in, rather than writing the
 *   intent itself.
 * - Its errand has an `abandonRadius`. The player is the only target in the
 *   park that can walk away, and "give up quietly rather than chasing for
 *   ever" is the difference between a child coming to say hello and a child
 *   following you around the park.
 * - It is the one activity that asks {@link ActivityHost.othersBusy}: it never
 *   poaches a child already committed to the train or the paint stall, because
 *   being carried off mid-sentence looks like a bug, and is one.
 */
export class ChatToPlayer implements Activity {
  readonly name = 'chatToPlayer';
  readonly hold: ActivityHold = 'steering';

  private readonly slot: BudgetSlot;
  private state: 'none' | 'approaching' | 'talking' | 'leaving' = 'none';
  private cooldown: number;
  private rollTimer = 0;
  private talkRemaining = 0;
  private leaveRemaining = 0;
  private line: string | null = null;

  /** The walk over. No `unstick`: this is a short hop across open ground, and
   *  the approach timeout is the guard that matters. */
  private readonly approach = new Errand({
    arriveRadius: CHAT_STOP_DISTANCE,
    timeout: CHAT_APPROACH_TIMEOUT,
    abandonRadius: CHAT_GIVEUP_RADIUS,
    unstick: false,
  });

  constructor(rng: Rng, budget: ChatBudget | undefined) {
    // A missing budget means "nobody chats", which is how the chat block read
    // it before this refactor — the opposite of the climb's reading. See
    // `BudgetSlot`.
    this.slot = new BudgetSlot(budget, 'refuse');
    // Stagger the first chat roll, so nobody is eligible in the opening seconds.
    this.cooldown = rng.range(3, 20);
  }

  /** True from the first step towards the player until the goodbye is done. */
  get busy(): boolean {
    return this.state !== 'none';
  }

  /**
   * What this child is saying right now, for `NpcSystem` to show in a
   * `SpeechBubble` — `null` whenever they are not mid-chat. `null` during
   * `approaching` on purpose: the line is chosen on arrival, not before, so the
   * bubble appears exactly when they stop and turn to face the player.
   */
  get bubbleText(): string | null {
    return this.state === 'talking' || this.state === 'leaving' ? this.line : null;
  }

  /**
   * One frame of "on the way to, mid, or waving goodbye from, a chat with the
   * player".
   *
   * Every early `return false` leaves state exactly where the core expects it,
   * so a child who is never eligible (busy, out of range, capped by the shared
   * budget, unlucky on the roll) costs this method nothing beyond the cooldown
   * bookkeeping at the top.
   */
  update(host: ActivityHost, context: DriverContext, intent: CharacterIntent): boolean {
    const { dt } = context;
    this.cooldown -= dt;

    if (this.state === 'none') {
      this.rollTimer -= dt;
      if (this.cooldown > 0) return false;
      // Never poaches a child already committed to the train or the paint
      // stall — and a climbing child never reaches this line at all, since the
      // climb holds the whole child and is offered the frame first.
      if (host.othersBusy(this)) return false;
      if (this.rollTimer > 0) return false;
      this.rollTimer = host.rng.range(CHAT_ROLL_MIN, CHAT_ROLL_MAX);

      if (context.playerStationaryFor < CHAT_TRIGGER_STATIONARY) return false;

      const dx = context.playerPosition.x - context.position.x;
      const dz = context.playerPosition.z - context.position.z;
      if (dx * dx + dz * dz > CHAT_RADIUS * CHAT_RADIUS) return false;

      if (this.slot.full) {
        // Capped for the whole park right now — try again soon rather than
        // queuing, exactly like a full face-paint stall.
        this.cooldown = host.rng.range(2, 5);
        return false;
      }
      if (!host.rng.chance(CHAT_START_CHANCE)) return false;

      this.slot.claim();
      this.state = 'approaching';
      this.approach.begin(context);
    }

    if (this.state === 'approaching') {
      const step = this.approach.step(
        host,
        context,
        intent,
        context.playerPosition.x,
        context.playerPosition.z,
      );

      // The player wandered off, or this is taking too long (stuck on
      // something) — give up quietly rather than chasing forever.
      if (step === 'givenUp') {
        this.endChat(host, context);
        return false;
      }

      if (step === 'arrived') {
        // Turn to face them, pick a line, and start talking. Stopping at
        // `CHAT_STOP_DISTANCE` — well outside `PLAYER_SEPARATION` in
        // `NpcSystem.ts` — is what keeps this a friendly stop rather than a
        // shoving match once player↔NPC collision gets involved.
        this.state = 'talking';
        this.talkRemaining = host.rng.range(CHAT_TALK_MIN, CHAT_TALK_MAX);
        this.line = pickChatLine(host.rng, context.playerWearingHat);
        intent.moveX = 0;
        intent.moveZ = 0;
        intent.lookAt = Math.atan2(this.approach.dx, this.approach.dz);
        // Piggy-backs the ordinary wave/happy blend in the core's social tail,
        // which `hold: 'steering'` leaves running.
        host.requestWave(0.5);
        return true;
      }

      intent.lookAt = Math.atan2(this.approach.dx, this.approach.dz);
      return true;
    }

    const dx = context.playerPosition.x - context.position.x;
    const dz = context.playerPosition.z - context.position.z;

    if (this.state === 'talking') {
      const distance = Math.hypot(dx, dz);

      intent.moveX = 0;
      intent.moveZ = 0;
      intent.lookAt = Math.atan2(dx, dz);
      host.requestWave(0.3);

      this.talkRemaining -= dt;
      // `playerStationaryFor` drops to zero the instant the player takes a
      // step — the cue to wrap up "as soon as the player moves away" rather
      // than waiting out the timer.
      const playerLeft = distance > CHAT_GIVEUP_RADIUS || context.playerStationaryFor <= 0;

      if (playerLeft || this.talkRemaining <= 0) {
        this.state = 'leaving';
        this.leaveRemaining = CHAT_GOODBYE_DURATION;
        this.line = pickGoodbyeLine(host.rng);
      }
      return true;
    }

    // 'leaving': a brief goodbye wave, still facing the player, before handing
    // back to ordinary wandering.
    intent.moveX = 0;
    intent.moveZ = 0;
    intent.lookAt = Math.atan2(dx, dz);
    host.requestWave(0.3);

    this.leaveRemaining -= dt;
    if (this.leaveRemaining <= 0) {
      this.endChat(host, context);
      return false;
    }
    return true;
  }

  /**
   * Ends a chat, whatever state it got to — abandoned mid-approach or a
   * completed goodbye. The shared budget slot is freed exactly once by
   * `BudgetSlot`, whichever way out this is.
   */
  private endChat(host: ActivityHost, context: DriverContext): void {
    this.slot.release();
    this.state = 'none';
    this.line = null;
    this.cooldown = host.rng.range(CHAT_COOLDOWN_MIN, CHAT_COOLDOWN_MIN + CHAT_COOLDOWN_RANGE);
    host.rejoinGraph(context, 'legacy');
  }
}
