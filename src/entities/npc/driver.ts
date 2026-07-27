import type { Vector3 } from 'three';
import type { Expression } from '../../art/style/faces';

/**
 * What drives a character.
 *
 * A character in this park is a *body* — a model, a walk cycle, collision, and
 * "how high is the ground?" — with no opinion whatsoever about where it should
 * go. Something else supplies that opinion, one frame at a time, as a
 * {@link CharacterIntent}. That something is a **driver**.
 *
 * Today there are two kinds of body and one kind of driver:
 *
 * | Body | Driven by |
 * | --- | --- |
 * | `entities/Player` | the local input system, read directly |
 * | `entities/npc/NpcCharacter` | a {@link CharacterDriver} — currently only the wander behaviour script |
 *
 * The point of the split is what it makes possible later. A **networked
 * player is not a new kind of character**: it is exactly the same
 * `NpcCharacter`, with a driver that fills the intent in from packets off the
 * wire instead of from a behaviour script. Likewise a cut-scene is a driver
 * that plays a recording, and a "follow me" pet is a driver that steers towards
 * whoever it belongs to. None of them touch the body.
 *
 * The intent is deliberately the *same* shape as a gamepad snapshot — a stick,
 * two buttons, and a couple of hints — rather than a position. Sending
 * positions over a network makes every remote character teleport and slide;
 * sending intent lets the receiving end run the identical movement code, so
 * remote children walk, accelerate and bump into walls exactly like local ones.
 */
export interface CharacterIntent {
  /**
   * Desired movement in **world** XZ. Length 0 is standing still, 1 is a walk,
   * up to {@link RUN_INTENT} is a run. Not camera-relative — the camera is a
   * local concern and a driver may be running on another machine.
   */
  moveX: number;
  moveZ: number;
  /** Edge-triggered: hop once when this is true on a frame the body is grounded. */
  hop: boolean;
  /** Edge-triggered: "use the thing in front of me". Nothing consumes it yet. */
  interact: boolean;
  /**
   * Yaw in radians to face while standing still, or `null` to keep the current
   * facing. Ignored while moving — walking characters face where they walk.
   */
  lookAt: number | null;
  /** The face to wear. The body only pushes it to the model on a *transition*. */
  expression: Expression;
  /** 0 = arms down, 1 = arm up and waving. Blended, so it can be eased. */
  wave: number;
}

/** Intent length that counts as a full run. Below 1 is a walk. */
export const RUN_INTENT = 1.75;

/** What a driver is allowed to know about the world when it decides. */
export interface DriverContext {
  readonly dt: number;
  readonly elapsed: number;
  /** Feet position of the character being driven. */
  readonly position: Readonly<Vector3>;
  readonly playerPosition: Readonly<Vector3>;
  /** True on the frame the player left the ground — the cue to giggle-hop. */
  readonly playerHopped: boolean;
  /** False while the character is in the air; most scripts pause then. */
  readonly grounded: boolean;
  /**
   * Seconds since the player was last moving faster than a gentle nudge —
   * `0` while they are walking or running. The cue for the chatting feature
   * (see `entities/npc/chatActivity.ts`): nobody starts a conversation with
   * someone on the move.
   */
  readonly playerStationaryFor: number;
  /** Whether the player currently has a hat on — the "notices you" touch in a chat. */
  readonly playerWearingHat: boolean;
}

/**
 * Produces one {@link CharacterIntent} per frame.
 *
 * `update` is handed the intent to fill in rather than returning one, so a
 * driver never allocates. Implementations must write **every** field: the
 * object is reused frame to frame and stale values would leak (an NPC stuck
 * mid-wave is always a driver that forgot to clear `wave`).
 */
export interface CharacterDriver {
  readonly name: string;
  update(context: DriverContext, intent: CharacterIntent): void;
}

/** A fresh, neutral intent. Allocate one per character, at spawn, never later. */
export function createIntent(): CharacterIntent {
  return {
    moveX: 0,
    moveZ: 0,
    hop: false,
    interact: false,
    lookAt: null,
    expression: 'neutral',
    wave: 0,
  };
}

/** Resets an intent to neutral. Call at the top of `update` and fill in from there. */
export function clearIntent(intent: CharacterIntent): void {
  intent.moveX = 0;
  intent.moveZ = 0;
  intent.hop = false;
  intent.interact = false;
  intent.lookAt = null;
  intent.expression = 'neutral';
  intent.wave = 0;
}
