import type { Rng } from '../../core/mathUtils';

/**
 * Content and tuning for the "a child comes over for a chat" feature (see
 * GAME_DESIGN.md, "Chatting (27 July 2026)"). The state machine itself lives
 * in `activities/chatToPlayer.ts` — this file is just the "what to say and
 * when" half, kept separate so that half can grow (more lines, more things
 * noticed) without the state machine file getting any longer.
 */

/** How many children may be mid-chat (approaching, talking, or waving
 *  goodbye) across the whole park at once. Shared — one instance handed to
 *  every `WanderDriver` by `NpcSystem`, exactly like `ClimberBudget`. Both are
 *  an `ActivityBudget` (`activities/activity.ts`); claim and release it through
 *  a `BudgetSlot` rather than by hand. */
export interface ChatBudget {
  active: number;
  readonly max: number;
}

/** The player has to be within this many metres, standing still, to be noticed. */
export const CHAT_RADIUS = 8.5;

/** "A couple of seconds" of not moving before a child considers coming over. */
export const CHAT_TRIGGER_STATIONARY = 2.1;

/**
 * Where a child stops, short of the player. Comfortably further out than
 * `PLAYER_SEPARATION` (child + player radius) in `NpcSystem.ts`, so arriving
 * at this distance never triggers the gentle push-apart — the approach ends
 * in a friendly stop, not a shoving match.
 */
export const CHAT_STOP_DISTANCE = 1.7;

/** Further than this and a child gives up — the player has clearly wandered off. */
export const CHAT_GIVEUP_RADIUS = 12;

/** Longest a child will spend walking over before giving up. */
export const CHAT_APPROACH_TIMEOUT = 9;

/** How long the chat itself lasts, absent the player walking away first. */
export const CHAT_TALK_MIN = 3.2;
export const CHAT_TALK_MAX = 5.5;

/** How long the goodbye wave lingers before the child turns back to wandering. */
export const CHAT_GOODBYE_DURATION = 1.1;

/** Per-child cooldown after a chat (or a failed attempt), so the same face
 *  doesn't come back a moment later. */
export const CHAT_COOLDOWN_MIN = 35;
export const CHAT_COOLDOWN_RANGE = 55;

/** How often an eligible child re-rolls whether to start a chat. */
export const CHAT_ROLL_MIN = 0.4;
export const CHAT_ROLL_MAX = 0.9;

/** Chance of actually starting, on a roll where the child is eligible. */
export const CHAT_START_CHANCE = 0.6;

/** Below this speed the player counts as "not moving" for `NpcSystem`'s
 *  stationary timer — comfortably above the tiny per-frame nudges of the
 *  player↔NPC separation, comfortably below an actual walk. */
export const CHAT_STATIONARY_SPEED_EPS = 0.25;

/**
 * Short, warm, six-year-old-friendly things to say. Plain greetings and
 * park chat, picked at random so the same child doesn't always say the same
 * thing twice in a row.
 */
const GREETING_LINES: readonly string[] = [
  'Hello!',
  'Hi there!',
  'Isn’t the park fun today?',
  'Have you been on the ferris wheel?',
  'My favourite is the ball pit!',
  'Do you like candy floss?',
  'I found a shiny stone earlier!',
  'The slide is SO fast!',
  'Want to race to the fountain?',
  'I can hop on one foot — watch!',
  'I saw a puppy this morning!',
  'This is the best park ever.',
];

/**
 * Lines for when the player is wearing a hat — the small "notices you"
 * touch the brief asks for. `pickChatLine` mixes these in rather than
 * always leading with them, so it reads as noticing, not narrating.
 *
 * Pets and parades get the same treatment once those parallel PRs land —
 * `pickChatLine`'s signature already has room (see its doc comment).
 */
const HAT_LINES: readonly string[] = [
  'I like your hat!',
  'Ooh, your hat is so cool!',
  'Where did you get that hat?',
];

const GOODBYE_LINES: readonly string[] = [
  'Bye bye!',
  'See you later!',
  'Gotta go play now!',
  'Byee, this was fun!',
  'Catch you later!',
];

/**
 * Picks something for a child to say on arrival.
 *
 * `wearingHat` is the only thing noticed today — the player doesn't have a
 * pet or a parade to notice until their PRs land. Extending this to weigh in
 * `hasPet`/`hasParade` later is a matter of adding a line pool and an `if`
 * here, not touching the state machine that calls it.
 */
export function pickChatLine(rng: Rng, wearingHat: boolean): string {
  if (wearingHat && rng.chance(0.5)) return rng.pick(HAT_LINES);
  return rng.pick(GREETING_LINES);
}

/** Picks something for a child to say on the way out. */
export function pickGoodbyeLine(rng: Rng): string {
  return rng.pick(GOODBYE_LINES);
}
