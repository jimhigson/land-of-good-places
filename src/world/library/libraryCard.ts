import { gameStore, type GameState, type InventoryItem, type PurchaseSpec } from '../../state';

/**
 * **The library card — what it is, whether she has one, and how she gets it.**
 *
 * The owl at the library desk hands every child a library card on her first
 * "Get a library card!" (#718). The brief asks for it to be "shown in the
 * inventory", so it is an inventory item: kind and category `card`, granted
 * through `gameStore.grantKeepsakeOnce`, stowed in the backpack where she can
 * see it.
 *
 * **The inventory is the one owner of "has she got the card".** There is no
 * `state/flags.ts` field beside it, on purpose: a flag plus an item would be
 * two owners of one fact, kept in step by hand, and the day they disagreed a
 * child would be offered a second card she already holds — or told she has
 * one she cannot find. The inventory is already saved, restored, drawn and
 * tolerant of older builds (`state/save.ts`), so asking it costs nothing.
 */

/** The card itself, as the store files it. A gift, so it costs nothing. */
export const LIBRARY_CARD: PurchaseSpec = {
  id: 'card.library',
  kind: 'card',
  displayName: 'Library card',
  icon: '🪪',
  category: 'card',
  shopId: 'library',
  price: 0,
  carryable: false,
};

/** Has she been given her library card? Read off the inventory, the one owner. */
export function hasLibraryCard(state: GameState): boolean {
  return state.inventory.some((item) => item.id === LIBRARY_CARD.id);
}

/**
 * Gives her the card — once. A second call hands back the card she already
 * holds (`grantKeepsakeOnce` is idempotent by catalogue id), so the owl's
 * chip can be pressed as often as a six-year-old likes.
 */
export function giveLibraryCard(): InventoryItem {
  return gameStore.grantKeepsakeOnce(LIBRARY_CARD);
}
