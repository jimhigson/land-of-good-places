import { gameStore } from '../../state';

/**
 * The splash-point record.
 *
 * GAME_DESIGN asks for splash points *"and try to beat your best score"*, so
 * the garden has to remember something between visits — and, now that there is
 * a save file, between *days*. The record lives in `gameStore`
 * (`bestSplashPoints`, which the state has always declared and nothing ever
 * wrote), so it is written to disk by the autosave along with everything else
 * and is there when she comes back tomorrow.
 *
 * It used to be a module-level number here, deliberately session-scoped: "one
 * sitting" was the right span for a record when nothing survived a refresh,
 * and the doc comment said lifting it into the store was the obvious next step
 * once somebody wanted it to persist. Saving is that somebody.
 *
 * `rounds` stays local and stays session-scoped: it counts how many goes she
 * has had *this visit*, which is what the end-of-round card uses to decide how
 * chatty to be. That is genuinely about this sitting.
 */

let rounds = 0;

export interface SplashRecord {
  /** Points scored in the round just finished. */
  readonly points: number;
  /** The best ever, including this round. */
  readonly best: number;
  /** True when this round set a new record. */
  readonly isNewBest: boolean;
  /** How many rounds have been played this session, including this one. */
  readonly rounds: number;
}

/** The score to beat, for showing in the HUD before a round starts. */
export function bestSplashPoints(): number {
  return gameStore.get().bestSplashPoints;
}

/** Files a finished round and says whether it was a record. */
export function recordSplashPoints(points: number): SplashRecord {
  rounds += 1;
  const previousBest = gameStore.get().bestSplashPoints;
  // Strictly greater, and never on a zero: "NEW BEST!" for scoring nothing at
  // all on your very first go would be a strange thing to celebrate.
  const isNewBest = points > previousBest && points > 0;
  gameStore.setSplashPoints(points, isNewBest ? points : previousBest);
  return { points, best: gameStore.get().bestSplashPoints, isNewBest, rounds };
}
