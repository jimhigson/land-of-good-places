import type { Rng } from '../../../core/mathUtils';
import type { CharacterIntent, DriverContext } from '../driver';

/**
 * Something a child does *instead of* wandering.
 *
 * The wander core knows how to walk a waypoint graph and look like a child
 * while doing it. Everything else a child does — riding the park train,
 * climbing a tree, getting their face painted, coming over for a chat, and
 * soon standing in a ride queue — is an `Activity`: a small state machine that
 * asks for the frame, and gets it until it says it is finished.
 *
 * This interface is deliberately *descriptive*. It was extracted from four
 * blocks that already existed and already worked, and it says only what those
 * four blocks turned out to have in common. There is no behaviour tree, no
 * priority system, no blackboard: activities are tried in array order and the
 * first one to say "mine" owns the frame.
 *
 * The three things that are **not** obvious, and that four hand-written blocks
 * each solved differently, are {@link hold} (how much of the child an activity
 * takes), {@link busy} (whether it may be interrupted), and the shared rails in
 * `errand.ts` (what happens when it goes wrong). Those are the parts worth
 * reading before writing a fifth one.
 */
export interface Activity {
  /** For debugging and for reading a stack trace six months from now. */
  readonly name: string;

  /** How much of the child this activity takes while it is running. */
  readonly hold: ActivityHold;

  /**
   * True while this activity is mid-something it would be visibly wrong to
   * abandon — a child left standing in a tree, or carried off by a train
   * halfway through a sentence.
   *
   * Ask about *other* activities through {@link ActivityHost.othersBusy}
   * rather than reaching into their fields, which is what the blocks that
   * preceded this interface had to do.
   */
  readonly busy: boolean;

  /**
   * One frame. Returns `true` the moment this activity has taken the frame
   * over — the core then skips the wander logic, and skips whatever else
   * {@link hold} says this activity owns.
   *
   * Called every frame whether or not the activity is running, so this is
   * also where an idle activity ticks its own cooldown and rolls its own
   * dice. Every early `return false` must leave the child exactly as the
   * wander core expects to find them.
   *
   * **Must not allocate.** Children are drawn with an `InstancedMesh` and
   * there are eighteen of them; a single object literal here is 18 objects a
   * frame. Write into `intent`, never return a new one.
   */
  update(host: ActivityHost, context: DriverContext, intent: CharacterIntent): boolean;

  /**
   * Optional: claim the *moment of arriving* at a waypoint, before the core
   * decides whether to pause there. Returns `true` if this activity took the
   * arrival, in which case the core treats it exactly like beginning a pause.
   *
   * Only the tree climb needs this — a climb is a thing you start because you
   * have just walked up to a tree, not a thing you decide in mid-stride.
   */
  onArrive?(host: ActivityHost, context: DriverContext): boolean;
}

/**
 * How much of the child an activity takes while it owns the frame.
 *
 * The four original blocks disagreed about this, and the disagreements are all
 * visible in play, so it is a property rather than a convention:
 *
 * - `'steering'` — owns *where the child walks*. The social tail still runs
 *   over the top, so the child keeps blending their wave, keeps their hop and
 *   keeps their expression. Chatting depends on this: it asks for a wave
 *   (`ActivityHost.requestWave`) and lets the tail ease it in.
 * - `'intent'` — owns the whole intent. The social tail does not run, so an
 *   activity holding this way must write its own `expression`.
 * - `'child'` — owns the child completely. Offered the frame *before* the
 *   child even notices the player, so no waves are rolled and a player's hop
 *   is not copied. A child up a tree is somewhere else entirely.
 */
export type ActivityHold = 'steering' | 'intent' | 'child';

/**
 * How to put a child back on the waypoint graph when an activity lets go.
 *
 * There were three of these before this refactor and two of them differed for
 * no reason anyone recorded. They are preserved as named variants rather than
 * quietly unified, because unifying them changes behaviour — which is a
 * follow-up PR, not this one.
 */
export type Rejoin =
  /**
   * The full version, and the canonical one: the nearest waypoint becomes
   * `current`, `previous` **and** `target`, any pause the activity interrupted
   * is cancelled, and a fresh leg is chosen. Setting `target` matters at a dead
   * end, where choosing a leg can fail and leave a stale one behind.
   */
  | 'full'
  /**
   * As `'full'`, but leaves `target` and any in-progress pause alone. What the
   * chat and face-paint blocks did. Should become `'full'`; see
   * HANDOFF-activity.md.
   */
  | 'legacy'
  /**
   * The child never moved (a climb ends where it started), so nothing needs
   * re-anchoring — just pick a fresh leg.
   */
  | 'inPlace';

/**
 * A whole-park cap: how many children may be doing one thing at once, so a
 * lucky run of coin flips cannot put half the crowd in the branches.
 *
 * One instance is shared by every child's copy of an activity — `NpcSystem`
 * builds it and hands it to every `WanderDriver`. Claim and release it through
 * a {@link BudgetSlot} (`budget.ts`) rather than by hand: a slot that leaks is
 * indistinguishable from the feature being switched off.
 */
export interface ActivityBudget {
  active: number;
  readonly max: number;
}

/**
 * What an activity is allowed to know and ask of the child it is driving.
 *
 * Deliberately small. An activity gets the dice, the walking speed, a way to
 * ask for a wave, a way to ask whether anyone else is busy, and a way to hand
 * the child back to the wander core. It does not get the driver.
 */
export interface ActivityHost {
  /** This child's own seeded stream. Order of draws is behaviour — see the
   *  determinism note in `wanderDriver.ts`. */
  readonly rng: Rng;

  /** Multiplies every walking speed for this child. Not everyone is brisk. */
  readonly pace: number;

  /** True on the frames this child's eyes are shut. Needed by any activity
   *  that writes its own `expression` (`hold: 'intent'` and `'child'`). */
  readonly blinking: boolean;

  /** True if any activity other than `asking` is {@link Activity.busy}. */
  othersBusy(asking: Activity): boolean;

  /** Asks for a wave of at least this many seconds, eased in by the social
   *  tail. Only meaningful for `hold: 'steering'`, which is the only hold that
   *  leaves the tail running. */
  requestWave(seconds: number): void;

  /** Hands the child back to the wander core. See {@link Rejoin}. */
  rejoinGraph(context: DriverContext, how: Rejoin): void;
}
