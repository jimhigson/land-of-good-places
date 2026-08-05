import { gameStore } from '../state';

/**
 * Freezes the park while a full-screen overlay owns it, by **re-deriving** the
 * pause every frame rather than toggling it when the overlay opens and closes.
 *
 * ## Why re-derived, and not a pair of toggles
 *
 * This shape exists because the obvious one is wrong, in a way that took a
 * full review round to find and is invisible on the page it is written on.
 *
 * The "Look" pill's character creator first took its pause with a
 * `setPaused(true)` on open and a restore on completion. But the creator is
 * not in `Game.tick`'s "who owns Escape" chain and has no close button of its
 * own, so Escape fell straight through to the ordinary pause toggle and
 * **unpaused the park behind the still-open dialog**. From there the player
 * could walk away or board a ride while the creator was up; and under `/view`,
 * where the park is deliberately frozen, the captured "was it already paused?"
 * then meant finishing never re-froze it.
 *
 * Patching Escape alone would have closed that one door and left the shape
 * that opened it. Re-deriving closes the *class*: however the flag gets
 * flipped — Escape, a debug camera, some key nobody has written yet — the very
 * next frame reconciles it, so nothing can win an argument with an open
 * overlay. That is the property worth having, and it is why
 * `Shopping.syncPaused` and `FacePaintStall.syncPaused` are shaped this way
 * too; this is those two, lifted out so the behaviour can be tested without a
 * WebGL context. They are deliberately left alone rather than migrated in the
 * same change.
 *
 * ## It only ever unpauses what it paused
 *
 * A park that was already frozen when the overlay opened — `/view`'s debug
 * camera, or a grown-up who hit pause — is left frozen when it closes. The
 * overlay never claims a pause it did not take.
 */
export class OverlayPause {
  /** True when *we* are the reason the park is paused. */
  private pausedByUs = false;

  /**
   * Call once a frame with "does my overlay own the screen right now?".
   *
   * Safe to call every frame forever: it compares before it writes, so a
   * steady state costs one boolean read and nothing else.
   */
  sync(open: boolean): void {
    if (open) {
      if (!gameStore.get().paused) {
        this.pausedByUs = true;
        gameStore.setPaused(true);
      }
      return;
    }
    if (this.pausedByUs) {
      this.pausedByUs = false;
      gameStore.setPaused(false);
    }
  }

  /** True while this overlay is the one holding the park still. */
  get holdingPause(): boolean {
    return this.pausedByUs;
  }
}
