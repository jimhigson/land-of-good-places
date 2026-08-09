/**
 * "Have we already done the cat bus once?"
 *
 * A brand-new player gets the arrival sequence: the cat bus rolls up, they hop
 * out, and {@link markArrived} is called the moment they are free to walk —
 * after that, continuing a save spawns them normally, on the plaza.
 *
 * This used to be its own `localStorage` key (`lgp:hasArrivedByBus`) because
 * there was no save file to put it in. There is one now, so the flag lives in
 * `state/flags.ts` with the other three one-time things and is written to disk
 * by the autosave along with everything else. These two functions stay because
 * they say what they mean at the place that will call them.
 */

import { saveFlags } from '../../state/flags';

/** True once this player has already seen the cat bus arrive. */
export function hasArrivedBefore(): boolean {
  return saveFlags.arrivedByBus;
}

/** Records that the player has arrived — never shown again on this save. */
export function markArrived(): void {
  saveFlags.markArrived();
}

/**
 * **Is the arrival due for this player?** One question, asked in one place.
 *
 * It lives *here*, in the file that owns the flag, rather than in
 * `ArrivalSequence.ts` where it used to — and that move is load-bearing rather
 * than tidying. `main.ts` has to ask this **before** it decides whether to play
 * the ride, and therefore before the park may be imported: importing
 * `ArrivalSequence.ts` pulls in `terrain`, `entrance/layout` and `boundary`,
 * which solves `PARK_BOUNDARY` at module scope. Asking the question would have
 * paid for a chunk of the very generation the ride exists to hide.
 *
 * `ArrivalSequence.ts` re-exports it so `Entrance` still reads it from where it
 * always did, and there is still exactly one definition.
 */
export function arrivalIsDue(): boolean {
  return !hasArrivedBefore();
}
