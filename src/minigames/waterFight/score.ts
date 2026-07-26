/**
 * The splash-point record.
 *
 * GAME_DESIGN asks for splash points *"and try to beat your best score"*, so the
 * garden has to remember something between visits. It remembers it here, in a
 * module-level number, which means:
 *
 * - it survives leaving the garden and coming back, because ES modules are
 *   evaluated once per page;
 * - it resets when the page does, which makes it a **session** best — the right
 *   scope for a game a family plays in one sitting, and one that can never feel
 *   unbeatable because of something that happened on Tuesday;
 * - it needs nothing from `state/store.ts`.
 *
 * That last point is a deliberate boundary, not an oversight. `GameState`
 * already declares `splashPoints` and `bestSplashPoints`, and lifting the record
 * into the store is the obvious next step — but the store has no action to write
 * them yet, and adding one is a change to a file every other feature in the park
 * also edits. The garden is self-contained until somebody wants the park's HUD
 * to show the score too.
 */

let best = 0;
let rounds = 0;

export interface SplashRecord {
  /** Points scored in the round just finished. */
  readonly points: number;
  /** The best of the session, including this round. */
  readonly best: number;
  /** True when this round set a new record. */
  readonly isNewBest: boolean;
  /** How many rounds have been played this session, including this one. */
  readonly rounds: number;
}

/** The score to beat, for showing in the HUD before a round starts. */
export function bestSplashPoints(): number {
  return best;
}

/** Files a finished round and says whether it was a record. */
export function recordSplashPoints(points: number): SplashRecord {
  rounds += 1;
  // Strictly greater, and never on a zero: "NEW BEST!" for scoring nothing at
  // all on your very first go would be a strange thing to celebrate.
  const isNewBest = points > best && points > 0;
  if (isNewBest) best = points;
  return { points, best, isNewBest, rounds };
}
