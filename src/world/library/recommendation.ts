import { Rng } from '../../core/mathUtils';
import type { GameState } from '../../state';
import { BOOKS, type LibraryBook } from './books';
import { isBookRead } from './readBooks';

/**
 * **Which book the owl recommends** (#718, plan Step 6: "Try “Fireflies at
 * Night” next!") — the first book she has not read yet, in **one seeded
 * order**.
 *
 * Stateless and deterministic on purpose. The owl keeps no "last recommended"
 * field, nothing is saved, and nothing is drawn at random when she is asked:
 * the answer is a function of the save's read-books alone, so it changes only
 * when a book is read, and the same save asked twice gets the same title
 * (`check:library`'s RECOMMEND asserts both). A six-year-old who is told "Try
 * this one next!" and comes back tomorrow is told the same book, which is what
 * a recommendation is; a different title every press would be a lottery.
 *
 * The order is `BOOKS` shuffled once, Fisher–Yates with the library's own
 * seeded stream ({@link LIBRARY_RECOMMEND_SEED}), so it is neither the shelf
 * order (which would recommend the north wall's books first, every time, for
 * every child) nor anything the game's other seeded streams are drawn from.
 * Story time (plan Step 9) reads from the same order when nothing is
 * recommended, so the two never disagree about what comes "next".
 */
export const LIBRARY_RECOMMEND_SEED = 0x0b00c9;

/**
 * `BOOKS` in the owl's reading order: a seeded Fisher–Yates shuffle, dealt
 * once at module load. For `i` from the last index down to 1, `j` is drawn in
 * `[0, i]` and the two are swapped — the textbook shuffle, so every order is
 * equally likely of the seed and the result never depends on how many times
 * anyone has asked.
 */
export const RECOMMENDATION_ORDER: readonly LibraryBook[] = (() => {
  const order = [...BOOKS];
  const rng = new Rng(LIBRARY_RECOMMEND_SEED);
  for (let i = order.length - 1; i >= 1; i -= 1) {
    const j = rng.int(0, i);
    const a = order[i]!;
    order[i] = order[j]!;
    order[j] = a;
  }
  return order;
})();

/**
 * The book the owl recommends on this save: the first in
 * {@link RECOMMENDATION_ORDER} she has not read to the end (`readBooks.ts`'s
 * `isBookRead`, the one owner of that question), or `null` once she has read
 * them all — when the owl says so instead.
 */
export function recommendFor(state: GameState): LibraryBook | null {
  return RECOMMENDATION_ORDER.find((book) => !isBookRead(state, book.id)) ?? null;
}
