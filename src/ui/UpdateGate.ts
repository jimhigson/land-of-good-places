/**
 * "A new park is ready" — the full-screen, unskippable update notice.
 *
 * GAME_DESIGN.md, "Updates are not optional" (27 July 2026), in the family's
 * words: *"let's make the new version unskippable and the notification for it
 * full screen with only the option to go there. No option to not upgrade."*
 *
 * So this is a **gate**, not a toast. It used to be a gentle pill near the
 * bottom of the screen with a Refresh button and a ✕ — which had two problems
 * the family hit at once: it could be dismissed, and (separately reported, and
 * superseded by this) it sat on top of the character-creation card and
 * obstructed the hair-style row. A full-screen panel with one button fixes
 * both, because there is nothing left to obstruct and nothing left to dismiss.
 *
 * ## Getting behind it must be impossible
 *
 * Not merely discouraged — a six-year-old presses everything. Four ways out
 * are closed deliberately:
 *
 * 1. **No dismiss control exists.** There is one button and it goes forwards.
 * 2. **Clicking outside does nothing.** The backdrop is part of the panel and
 *    swallows pointer events; the canvas underneath never sees them, so
 *    `PointerControls` cannot walk her anywhere either.
 * 3. **Escape does nothing, and neither does any other key.** Every keydown
 *    and keyup is swallowed in the capture phase before `InputSystem` or any
 *    panel can read it — the one exception being Enter/Space on the button
 *    itself, which is how a keyboard presses it.
 * 4. **Focus cannot leave.** Tab is swallowed by the same handler, and a
 *    `focusin` trap puts focus back on the button if anything else takes it.
 *
 * ## It must survive the day the park does not
 *
 * `main.ts` sets this up *outside* `boot()`'s try/catch, and that is
 * load-bearing: a new version of the **code** is exactly what a family needs
 * on the day `Game`'s constructor throws and the splash turns into an apology.
 * So nothing here touches `gameStore`, `Game` or any world system — it is
 * plain DOM over whatever is (or is not) on screen.
 *
 * ## And it must look like the game
 *
 * A browser's own "reload?" bar reads as something has gone wrong. This reads
 * as a present: the park's own card, the park's own colours, a balloon, and a
 * button that says where it goes.
 */

/** Highest thing in the game. Above `.lgp-burst` (90), which was the previous top. */
export class UpdateGate {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;

  private open = false;
  private onRefresh: (() => void) | null = null;
  private reloadFallback = 0;

  /**
   * Swallows the whole keyboard while the gate is up.
   *
   * Capture phase on `window`, so it runs before `InputSystem`'s own listeners
   * and before any panel that closes on Escape. Enter and Space on the button
   * are let through untouched — that is a real press, and cancelling it would
   * make the gate unusable without a mouse.
   */
  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.open) return;
    if (event.target === this.button && (event.key === 'Enter' || event.key === ' ')) return;
    event.stopPropagation();
    event.preventDefault();
  };

  /** Puts focus back if anything at all steals it. */
  private readonly onFocusIn = (event: FocusEvent): void => {
    if (!this.open) return;
    const target = event.target;
    if (target instanceof Node && this.root.contains(target)) return;
    this.button.focus();
  };

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'update-gate';
    this.root.dataset.show = 'false';
    // It is the only thing on screen and it is not optional, so say so to a
    // screen reader as well: nothing behind it is reachable anyway.
    this.root.setAttribute('role', 'alertdialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'A new version of the park is ready');

    const card = document.createElement('div');
    card.className = 'update-gate-card';
    card.innerHTML =
      '<div class="update-gate-glyph">🎈</div>' +
      '<h1 class="update-gate-title">A brand new park!</h1>' +
      '<p class="update-gate-line">There is a newer Land of Good Places ready ' +
      'for you, with new things in it.</p>';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'shop-buy update-gate-go';
    this.button.innerHTML = '<span class="emoji">✨</span><span>Take me there!</span>';
    this.button.addEventListener('click', () => this.go());

    card.append(this.button);
    this.root.append(card);
    container.append(this.root);
  }

  /**
   * Raises the gate, wiring `onRefresh` to the one button.
   *
   * A no-op once it is up: `onNeedRefresh` firing twice must not rebuild the
   * panel under a finger that is already on its way to the button.
   */
  show(onRefresh: () => void): void {
    if (this.open) return;
    this.open = true;
    this.onRefresh = onRefresh;
    this.root.dataset.show = 'true';

    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKey, true);
    document.addEventListener('focusin', this.onFocusIn, true);
    this.button.focus();
  }

  /**
   * Raises the gate **and presses its own button** — the returning-player path
   * (issue #341).
   *
   * A plain reload cannot promote a waiting service worker (see
   * `update-adoption.ts` for why), so on a page nobody has touched yet the page
   * presses the button itself: same card, same copy, same one code path
   * forwards, just with no six-year-old required in the middle of it. She sees
   * the balloon and "Getting it…" for as long as the swap takes, and then the
   * new park.
   *
   * Deliberately the same `show`/`go` pair a finger goes through rather than a
   * shortcut past them: two ways into an update is how you end up with one of
   * them rotting.
   */
  showAndGo(onRefresh: () => void): void {
    this.show(onRefresh);
    this.go();
  }

  dispose(): void {
    window.clearTimeout(this.reloadFallback);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('keyup', this.onKey, true);
    document.removeEventListener('focusin', this.onFocusIn, true);
    this.root.remove();
  }

  // -------------------------------------------------------------- internal

  private go(): void {
    if (this.button.disabled) return;
    this.button.disabled = true;
    this.button.innerHTML = '<span class="emoji">🌀</span><span>Getting it…</span>';
    this.onRefresh?.();

    // `updateSW(true)` tells the waiting service worker to take over and
    // reloads the page when it does. If that handover stalls — a worker in an
    // odd state, a flaky network on the last fetch — a child is left looking
    // at a spinner with no way forward, which is precisely the dead end this
    // whole feature exists to avoid. Reload ourselves after a few seconds:
    // worst case the new version is picked up on the load after this one.
    this.reloadFallback = window.setTimeout(() => window.location.reload(), 4000);
  }
}
