/**
 * **"Go to the park!" — the button that lets her out of the ride.**
 *
 * Jim, 7 August 2026, revising an earlier "not skippable":
 *
 * > *"actually, make it skippable only once the park has generated"*
 *
 * Three requirements came with it, and each one is a decision here rather than
 * an accident:
 *
 * 1. **Driven by the generator's real completion signal, not a timer.** This
 *    class has no clock of its own and no duration anywhere in it. It is
 *    hidden until somebody calls {@link show}, and the only caller does so on
 *    the line after `new Game(...)` returns — i.e. when a park demonstrably
 *    exists, because the object is in hand. *"A button that appears and then
 *    does nothing for four seconds is worse than one that appears late."*
 * 2. **Obvious when it becomes available.** A six-year-old will not discover a
 *    control that silently changes state, so it does not fade in politely: it
 *    pops, with the same spring the boot splash uses, and it carries a word and
 *    an arrow rather than an icon alone. Sized in `rem`, which is
 *    GAME_DESIGN.md's TEXT/UI-SCALE rule expressed once in `style.css` (see
 *    `core/uiScale.ts`) — nothing here restates a pixel size.
 * 3. **Never offered before there is anywhere to go.** Hidden is the initial
 *    state, and there is no path to visible except {@link show}.
 *
 * It is deliberately **not** a `Game`-owned overlay. `Game` does not exist for
 * the first second of the ride, which is precisely the window in which the
 * button must already be known to be absent.
 */
export class JourneySkip {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private handler: (() => void) | null = null;
  private shown = false;

  /**
   * Mounted on `document.body`, **not** on `#ui-root`, and that is not a
   * stylistic choice: `Hud`'s constructor *empties* `#ui-root`, and `Hud` is
   * built by `new Game(...)` — which happens in the middle of the ride, which
   * is exactly when this button is on screen. Put here it would be silently
   * deleted at the very moment it became useful. (`World.mountUi` exists for
   * the same reason and says so.)
   */
  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'journey-skip';
    // Hidden by class, not by absence: the element exists from the first frame
    // so that a check can find it and assert it is *not* being offered, which
    // is half of what Jim asked to be guarded. An element that is not in the
    // document is indistinguishable from one that was never built.
    this.root.classList.add('journey-skip--waiting');

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'journey-skip__button';
    this.button.textContent = 'Go to the park! →';
    this.button.addEventListener('click', () => this.handler?.());
    this.root.append(this.button);
    document.body.append(this.root);
  }

  /** True once the park exists and the button is really on screen. */
  get offered(): boolean {
    return this.shown;
  }

  onPress(handler: () => void): void {
    this.handler = handler;
  }

  /** Called when — and only when — there is a built park to skip to. */
  show(): void {
    if (this.shown) return;
    this.shown = true;
    this.root.classList.remove('journey-skip--waiting');
    this.root.classList.add('journey-skip--ready');
  }

  dispose(): void {
    this.handler = null;
    this.root.remove();
  }
}
