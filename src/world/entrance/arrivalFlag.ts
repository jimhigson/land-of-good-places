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
