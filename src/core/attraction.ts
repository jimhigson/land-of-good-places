/**
 * **Is an attraction running right now, rather than ordinary play?**
 *
 * Jim, 30 August 2026: *"There are times when the menu button is not
 * appropriate, nor the map. The menu button should only show during normal
 * gameplay. It should hide during attractions."* (issue #404)
 *
 * ## Why this is derived and not a flag
 *
 * The obvious implementation is a boolean every ride sets on the way in and
 * clears on the way out. That is this repo's most expensive bug shape — two
 * definitions of one thing kept in step by hand — and it fails in the worst
 * possible direction: a ride added in six months' time forgets the `false`,
 * and the menu button silently reappears mid-slide with nobody able to say
 * when it started.
 *
 * So nothing here is *set*. Both terms are read back off state the game
 * already maintains for its own reasons:
 *
 * - **`riding`** is `Player.riding`, which is the flag `Player.beginRide()`
 *   raises and `Player.endRide()` lowers. That is not bookkeeping a ride does
 *   *as well as* running — it is **how a ride takes the character at all**:
 *   until it is raised, input, collision and gravity are still live and the
 *   child would walk out of her own seat. A new attraction cannot opt out of
 *   it and still be an attraction. Every one of them goes through it today —
 *   the giant slide and the helter-skelter (`Building.startRide`), the glass
 *   lift (`liftRide.ts`), the Rail Race, the ferris wheel, the train, the Sky
 *   Cruiser, both hotel lifts, the cat-bus arrival sequence, the keychain
 *   rack's zoom, and a climb up a tree.
 * - **`miniGameFrozen`** is `MiniGameHost.frozen`, for the curtain games
 *   (dodgems, the water fight, the spooky house). Those never pose the player
 *   — they freeze the park and draw a scene of their own over it — so they
 *   are genuinely a second case rather than a redundant one.
 *
 * ## Where the line is drawn: rides, not transitions
 *
 * A door iris or a wipe (`ui/Transitions.ts`) is *not* an attraction. Nothing
 * is happening that a menu would interrupt, it is over in half a second, and
 * making the button flicker on every doorway would read as a bug. It does not
 * call `beginRide`, so it is on the right side of this line for free.
 *
 * The glass lift *is* one, because it does call `beginRide` — it carries her,
 * she cannot walk, and pressing "Menu" in it is exactly the moment Jim
 * described. That matters more than it looks: the lift is to become the
 * castle's only way between floors, so this is about to be one of the most
 * ridden things in the park.
 *
 * Kept free of every import so a check, the HUD and `Game` can all share it.
 */

/** The two facts an attraction is read back off. Both are already maintained. */
export interface AttractionState {
  /** `Player.riding` — a ride is posing the character instead of the player. */
  readonly riding: boolean;
  /** `MiniGameHost.frozen` — a curtain mini-game has the park frozen behind it. */
  readonly miniGameFrozen: boolean;
}

/**
 * True while an attraction has the child, so the menu button, the map pill and
 * everything else in the HUD's drawer should be off the screen.
 *
 * The single owner of that question. `Game` reads it in two places — the HUD's
 * per-frame `setMenuAvailable`, and the `ParkMap`'s `blocked` dependency —
 * which were previously two hand-written copies of the same expression.
 */
export function attractionOwnsTheScreen(state: AttractionState): boolean {
  return state.riding || state.miniGameFrozen;
}
