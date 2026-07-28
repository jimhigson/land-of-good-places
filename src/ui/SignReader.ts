import type { FrameContext, GameSystem } from '../core/types';
import type { SignZone } from '../world/signs';
import { gameStore } from '../state';

/**
 * Reading a sign: a full-screen overlay of its own painted face.
 *
 * The *offer* is not here any more. It used to be: a proximity-and-facing gate
 * and a "Read" pill anchored to the corner of the screen, which was a second
 * way of saying "you can use this thing" alongside the action pill's. GAME_DESIGN.md's
 * SELECTION RULE (28 July 2026) collapsed both into one — a sign is now an
 * ordinary {@link InteractZone} like a shop or a stall (`signInteractZone` in
 * `world/signs.ts`), it is selected the same way everything else is, and its one
 * action is a "Read" chip floating over the board itself. Which is better than
 * the pill was on its own terms too: the chip is *at the sign*, so a child can
 * see which of two signs she is about to read.
 *
 * What is left here is the overlay and the pause that goes with it. {@link open}
 * is what the chip calls.
 *
 * Pausing follows the same "mirror {@link active} every frame" idiom as
 * `Shopping.syncPaused` — see that class's doc for why this is what makes a
 * dismiss path unable to forget to restore movement/hop/zoom (QA-PLAYBOOK.md's
 * standing close-path rule, seeded by the backpack input-freeze bug).
 */
export class SignReader implements GameSystem {
  readonly name = 'signReader';

  private readonly overlay: HTMLElement;
  private readonly face: HTMLElement;

  private openSign: SignZone | null = null;
  private wasPausedByUs = false;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'sign-reader';
    this.overlay.dataset.open = 'false';

    const frame = document.createElement('div');
    frame.className = 'sign-reader-frame';

    this.face = document.createElement('div');
    this.face.className = 'sign-reader-face';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'shop-close sign-reader-close';
    close.setAttribute('aria-label', 'Stop reading');
    close.textContent = '✕';
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      this.close();
    });

    const hint = document.createElement('p');
    hint.className = 'shop-hint';
    hint.textContent = 'Tap anywhere to close';

    frame.append(this.face, close, hint);
    this.overlay.append(frame);
    // Tapping ANYWHERE — the frame, the sign face, the dimmed edge — closes it
    // instantly. Unlike the shop panel, there is no "tap outside the card"
    // distinction: the whole point is that reading a sign is a single, cheap,
    // no-ceremony action to back out of.
    this.overlay.addEventListener('pointerdown', () => this.close());
    container.append(this.overlay);
  }

  /** True while the full-screen sign is up — the park stays paused for exactly this long. */
  get active(): boolean {
    return this.openSign !== null;
  }

  update(context: FrameContext): void {
    this.syncPaused();
    if (!this.active) return;

    // Any of the ordinary "back out" actions closes it, same vocabulary as
    // every other overlay in the game (see `Game.tick`).
    if (
      context.input.justPressed('interact') ||
      context.input.justPressed('menu') ||
      context.input.justPressed('cancel')
    ) {
      this.close();
    }
  }

  dispose(): void {
    this.overlay.remove();
  }

  /** Show this sign, full screen. What the "Read" chip calls. */
  open(zone: SignZone): void {
    this.openSign = zone;
    // The sign's own canvas, straight off its in-world texture — not a
    // redraw, so it reads exactly as it does on the board, just bigger. See
    // `world/signs.ts`'s `findSignCanvas` for where this comes from.
    this.face.replaceChildren(zone.canvas);
    this.overlay.dataset.open = 'true';
  }

  private close(): void {
    if (!this.active) return;
    this.openSign = null;
    this.overlay.dataset.open = 'false';
  }

  /**
   * Keeps the park's pause state a mirror of {@link active}, checked fresh
   * every frame — the same pattern `Shopping.syncPaused` and the old
   * `SignInspector.syncPaused` used, and for the same reason: whichever of the
   * dismiss paths (tap, Esc, the interact key, the ✕ button) closed the
   * overlay, this is the one place that notices and hands movement back.
   */
  private syncPaused(): void {
    if (this.active) {
      if (!gameStore.get().paused) {
        this.wasPausedByUs = true;
        gameStore.setPaused(true);
      }
      return;
    }
    if (this.wasPausedByUs) {
      this.wasPausedByUs = false;
      gameStore.setPaused(false);
    }
  }
}
