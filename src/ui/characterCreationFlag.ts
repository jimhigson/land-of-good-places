/**
 * "Has this browser already made a character?" — a tiny, additive, self-
 * contained flag, checked synchronously at boot exactly like
 * `world/entrance/arrivalFlag.ts`'s `hasArrivedBefore` and `ui/WhatsNew.ts`'s
 * `lastSeenWhatsNewId`.
 *
 * A brand-new player (nothing stored yet) sees the character creator before
 * anything else in `main.ts`'s `boot()`; every future load (refresh,
 * tomorrow, a new tab) finds the flag set and goes straight into the park.
 */

const STORAGE_KEY = 'lgp:hasCreatedCharacter';

/** True once this browser has already been through the character creator. */
export function hasCreatedCharacter(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Safari private mode throws on *access*, not just on write — treat it as
    // "always new", which just means the chooser can show more than once. A
    // harmless failure mode next to the alternative of throwing at boot.
    return false;
  }
}

/** Records that a character has been made — never shown again on this device. */
export function markCharacterCreated(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Nothing to do about a full or disabled store; worst case the chooser
    // appears again next time, which is a fine failure mode.
  }
}
