import { gameStore } from './store';

/**
 * What the game calls getting a thing from a shop.
 *
 * GAME_DESIGN.md, 27 July 2026, the family's words: *"since money is
 * meaningless let's change 'buy' to 'collect' unless in grown up mayhem mode
 * (currently not implemented)"*.
 *
 * They are right, and it is not only a nicer word. In normal mode `spend()`
 * tops the purse straight back up — Eleri's rule — so nothing can ever be
 * unaffordable, no purchase can ever fail, and "buy" is describing a
 * transaction that does not happen. "Collect" describes what actually happens:
 * you press it, and the thing is yours.
 *
 * **This is the one place the word is decided.** Not because twenty
 * hard-coded "Collect"s would look wrong today, but because Mayhem mode is
 * coming and will need every one of them back — and a word scattered across a
 * panel, an aria-label, a hint line and a changelog is a word somebody will
 * miss. Anything with copy about acquiring a thing asks {@link shopWords} and
 * gets a matching set.
 *
 * Keyed on `moneyIsFinite` rather than on `mode === 'mayhem'` for the same
 * reason the HUD's money pill is: the question being asked is "is money real
 * here?", and a caller should not have to know the names of the modes to ask
 * it. When Mayhem lands, `setMode` already flips that flag and the whole
 * vocabulary follows.
 */
export interface ShopWords {
  /** The verb, capitalised for a button: `Collect` / `Buy`. */
  readonly verb: string;
  /** The same verb mid-sentence: `collect` / `buy`. */
  readonly verbLower: string;
  /**
   * The past tense, mid-sentence: `collected` / `bought`.
   *
   * Its own field rather than `verbLower + 'ed'`, because "buy" does not
   * suffix — and a vocabulary that is right for one mode and gibberish for the
   * other is exactly the failure this file exists to prevent.
   */
  readonly pastLower: string;
  /** The button's emoji — a basket you fill, or a shopping bag you pay for. */
  readonly glyph: string;
  /** The whole button label, glyph and all. */
  readonly buttonLabel: string;
  /** What a row says when a thing is not out today. */
  readonly unavailable: string;
  /**
   * Whether a price is worth showing.
   *
   * GAME_DESIGN.md, 27 July 2026, the family's words: *"no prices shown unless
   * in mayhem mode"* — the question this field was left open for, now answered.
   *
   * Outside Mayhem a price is decoration rather than information, on three
   * counts at once: the number names no currency, the money pill it would be
   * counted against is already hidden, and `spend()` tops the purse back up so
   * nothing can ever be unaffordable. A number a child cannot act on and
   * cannot run out of is a number that only asks to be read and then ignored.
   *
   * In Mayhem money is finite, so the same number is the one thing she needs
   * to decide with, and it comes straight back.
   */
  readonly showPrice: boolean;
}

const COLLECT: ShopWords = {
  verb: 'Collect',
  verbLower: 'collect',
  pastLower: 'collected',
  glyph: '🧺',
  buttonLabel: '🧺 Collect',
  unavailable: 'not out today',
  showPrice: false,
};

const BUY: ShopWords = {
  verb: 'Buy',
  verbLower: 'buy',
  pastLower: 'bought',
  glyph: '🛍️',
  buttonLabel: '🛍️ Buy',
  unavailable: 'not for sale today',
  showPrice: true,
};

/**
 * The vocabulary for right now.
 *
 * Cheap enough to call per row per open — it is a flag test and a reference to
 * one of two frozen objects, with nothing allocated.
 */
export function shopWords(): ShopWords {
  return gameStore.get().moneyIsFinite ? BUY : COLLECT;
}
