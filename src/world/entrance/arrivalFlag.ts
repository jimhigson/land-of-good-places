/**
 * "Have we already done the cat bus once?" — a tiny, additive, self-contained
 * flag, checked synchronously at boot exactly like `ui/WhatsNew.ts`'s
 * `lastSeenWhatsNewId`.
 *
 * A brand-new player (nothing stored yet) gets the arrival sequence: the cat
 * bus rolls up, they hop out, and {@link markArrived} is called the moment they
 * are free to walk — after that, every future load (refresh, tomorrow, a new
 * tab) finds the flag set and spawns normally, on the plaza, exactly as the
 * game did before this feature existed.
 */

const STORAGE_KEY = 'lgp:hasArrivedByBus';

/** True once this browser has already seen the cat bus arrive. */
export function hasArrivedBefore(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Safari private mode throws on *access*, not just on write — treat it as
    // "always new", which just means the intro can play more than once. A
    // harmless failure mode next to the alternative of throwing at boot.
    return false;
  }
}

/** Records that the player has arrived — never shown again on this device. */
export function markArrived(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Nothing to do about a full or disabled store; worst case the bus
    // arrives again next time, which is a fine failure mode.
  }
}
