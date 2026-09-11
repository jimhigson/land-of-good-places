/**
 * How many companions walk behind the player at once.
 *
 * Its own module, with no imports, for one reason: `Parade.ts` owns the
 * behaviour but reaches `three`, `Player`, the collision world and the hotel
 * to do it, so anything that only wants the *number* cannot ask it without
 * dragging the entity graph along. `main.ts` is exactly that caller — it is
 * the boot entry, it lazy-loads `Game` on purpose, and a static import of
 * `Parade` there would pull the whole scene into the first chunk.
 *
 * So the constant lives here and {@link Parade} asks for it, rather than the
 * two keeping a copy each. CLAUDE.md's "one owner; everyone else asks" — the
 * copy is always the one found wrong, and this one would have been found
 * wrong by a `?pets=` URL quietly disagreeing with the line it describes.
 */

/**
 * How many walk behind you at once. More than this and the park disappears.
 *
 * Beyond it the line still holds everything she owns — `Parade`'s window
 * rotates through them so owning twenty things means seeing twenty things,
 * in turns — but only this many have a body in the park at any moment.
 *
 * **That makes it a ceiling on anything done to a walking pet**, which is not
 * obvious from here: `Parade.sendPetToBed` is a no-op for a companion with no
 * body in the line, so a child owning more than this has pets that no amount
 * of bed-building can put to bed (#582's second, separate limit).
 */
export const MAX_PARADE_VISIBLE = 8;
