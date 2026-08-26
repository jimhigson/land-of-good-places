import { createRandom } from '../../core/mathUtils';
import type { Expression } from './faces';

/**
 * **Blinking, once, for everybody with a face.**
 *
 * Every character in this park is painted rather than rigged — a face is a
 * texture on a canvas and an expression is a swap (`faces.ts`). Blinking is
 * therefore three lines of state and one rule, and it had been written out
 * **five separate times**, each with its own idea of how often: the player
 * (2.6–6.0 s), the character-creation preview (2.2–5.6), the park's wandering
 * children (2.4–6.2), the grown-ups indoors (2.4–5.4), and the ferris wheel's
 * gondola. Nobody was wrong; there was just nowhere to put it.
 *
 * The rule that is easy to get wrong, and the reason this owns the swap rather
 * than just handing back an expression: **only ever set on a transition.**
 * Calling `setExpression` every frame flips `needsUpdate` every frame and
 * re-uploads a texture to the GPU every frame, for a face that has not
 * changed. Every copy of this got that right; a fifth one might not.
 */

/**
 * How long the eyes stay shut. Any longer and they look sleepy, not blinking.
 *
 * Exported because a check that wants to tell a blink from a nap needs to know
 * how long a blink can possibly last, and a hand-copied `0.11` in a script is
 * the "two definitions of one thing" bug CLAUDE.md opens with. One owner.
 */
export const BLINK_DURATION = 0.11;

/** The gap between blinks: this much, plus up to this much again. */
const BLINK_GAP_MIN = 2.6;
const BLINK_GAP_RANGE = 3.4;

/**
 * Just the clock, for callers that do not own the face.
 *
 * Two callers need the beat without the swap. `entities/npc/wanderDriver.ts`
 * puts a wandering child's expression into a `CharacterIntent` that an
 * activity may override, so it has to *ask* whether it is blinking rather than
 * paint it — and it must ask with its **own seeded** random, because
 * `check:crowd` traces that driver and a park that blinks differently every
 * run is a park that cannot be traced. `world/building/GrownUp.ts` does not
 * have a painted face at all: its eyes are meshes, and it blinks by squashing
 * them. Both share the timing; only the timing was ever really common.
 *
 * {@link createFaceLife} is this plus the swap, for everyone with a texture.
 */
export interface BlinkClock {
  /** Advance, and say what the face should show — a blink, or `resting`. */
  expressionFor(dt: number, resting: Expression): Expression;
}

/**
 * The stream a clock draws from when its caller does not hand it one — and it
 * is **seeded**, like everything else in this park.
 *
 * The default used to be `Math.random`, and this file's own doc comment above
 * already knew why that was a hazard: a park that blinks differently every run
 * is a park that cannot be traced. Only `wanderDriver` and `waypointDriver`
 * ever acted on it, because only they were traced by a check at the time. The
 * player's clock kept the unseeded default, and on 26 August 2026 that held
 * `main` red (#343): `check:hotel` asked "are her eyes shut?" one instant after
 * waking her, an ordinary blink answered yes on 3% of runs, and the check
 * reported a child who never woke up.
 *
 * So the seed lives here rather than at the four call sites that would each
 * have to remember it. What the randomness is actually *for* is
 * de-synchronising faces built together — a car of toys or a crowd of children
 * blinking in unison is considerably more unsettling than none of them blinking
 * at all — and one shared stream does that just as well as entropy does, since
 * consecutive clocks still start at unrelated phases. It simply starts at the
 * same place every run.
 */
const blinkPhases = createRandom(0x62_6c_6e_6b);

export function createBlinkClock(random: () => number = blinkPhases): BlinkClock {
  // Randomised rather than starting from a fixed value, which matters wherever
  // faces are built together: a car of toys or a crowd of children blinking in
  // unison is considerably more unsettling than none of them blinking at all.
  let until = random() * (BLINK_GAP_MIN + BLINK_GAP_RANGE);
  let shut = 0;
  return {
    expressionFor(dt: number, resting: Expression): Expression {
      until -= dt;
      if (until <= 0) {
        until = BLINK_GAP_MIN + random() * BLINK_GAP_RANGE;
        shut = BLINK_DURATION;
      }
      if (shut > 0) shut -= dt;
      return shut > 0 ? 'blink' : resting;
    },
  };
}

export interface FaceLife {
  /**
   * Advance the clock and apply whatever the face should be showing.
   *
   * `resting` is what it shows *between* blinks — 'happy' while something nice
   * is happening, 'neutral' the rest of the time, whatever the caller's own
   * mood logic decides. A blink is punched through it and hands it straight
   * back, so this never argues with the caller about the face.
   */
  update(dt: number, resting: Expression): void;
}

/**
 * @param setExpression  the face's own swap — `KidAvatar.setExpression`,
 *   `CreatureHandle.setExpression`, whatever this face is attached to.
 */
export function createFaceLife(setExpression: (expression: Expression) => void): FaceLife {
  const clock = createBlinkClock();
  let showing: Expression | null = null;

  return {
    update(dt: number, resting: Expression): void {
      const wanted = clock.expressionFor(dt, resting);
      if (wanted === showing) return;
      showing = wanted;
      setExpression(wanted);
    },
  };
}
