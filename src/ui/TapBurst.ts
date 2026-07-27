/**
 * The activation flash for the interface — the DOM half of the "you touched
 * it" burst in GAME_DESIGN.md's HIGHLIGHT RULE.
 *
 * The park's half lives in `world/Highlights.ts` and reuses the hop rainbow's
 * mesh pool. This is the same idea for buttons: press one and the same rainbow
 * radiates off it for half a second, with a scatter of sparks. Hover says "you
 * can press this"; this says "you pressed it" — and on a phone, where there is
 * no hover at all, it is the only feedback there is.
 *
 * Three decisions:
 *
 *  - **One delegated listener, not a handler per button.** Same reasoning as
 *    the global CSS rule it goes with (see the HIGHLIGHT RULE block in
 *    `style.css`): a button added to a mini-game HUD next month bursts without
 *    its author knowing this file exists.
 *  - **The `click` event, deliberately.** It is the one event every input
 *    method already agrees on: a finger, a mouse, and — this is the point —
 *    Enter or Space on a focused button. The rule has to fire for a child
 *    driving the UI from a keyboard or a controller, and this gets that free
 *    rather than by adding a second key handler that would drift.
 *  - **A fixed pool of overlay elements, allocated once.** Per-tap DOM is the
 *    same mistake as per-trigger meshes (ARCHITECTURE-REVIEW's allocation
 *    list), and a six-year-old presses a *lot* of buttons. The burst is drawn
 *    over the button rather than inside it, so it never disturbs the button's
 *    own layout, never inherits `overflow: hidden` from a scrolling panel, and
 *    leaves the button's `::after` free for the steady hover outline.
 */

/** What counts as pressable. Kept in step with the selector list in `style.css`. */
const CLICKABLE = 'button, summary, a[href], [role="button"]';

/** Never burst on something the child cannot actually use. */
const INERT = ':disabled, [aria-disabled="true"]';

/**
 * Bursts alive at once. Four covers a child drumming on the shop list; past
 * that the oldest is recycled, which is invisible because it is already fading.
 */
const POOL_SIZE = 4;

export class TapBurst {
  private readonly pool: HTMLElement[] = [];
  private next = 0;
  private attached = false;

  constructor(container: HTMLElement) {
    for (let i = 0; i < POOL_SIZE; i += 1) {
      const burst = document.createElement('div');
      burst.className = 'lgp-burst';
      burst.dataset.play = 'false';
      // Purely decorative: nothing here should ever reach a screen reader, and
      // `pointer-events: none` in the stylesheet keeps it out of the way of the
      // very button it is advertising.
      burst.setAttribute('aria-hidden', 'true');
      container.append(burst);
      this.pool.push(burst);
    }
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    // Capture phase: a handler that stops propagation (the sign overlay does)
    // must not be able to swallow the confirmation for the button it belongs to.
    document.addEventListener('click', this.onClick, true);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    document.removeEventListener('click', this.onClick, true);
  }

  dispose(): void {
    this.detach();
    for (const burst of this.pool) burst.remove();
    this.pool.length = 0;
  }

  // ------------------------------------------------------------- internals

  private readonly onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const element = target.closest(CLICKABLE);
    if (!element || element.matches(INERT)) return;
    this.playOver(element);
  };

  private playOver(element: Element): void {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const burst = this.pool[this.next];
    if (!burst) return;
    this.next = (this.next + 1) % POOL_SIZE;

    // Geometry in px because it is a measurement of something already on
    // screen, not a size anybody chose — the rem scale is about chosen sizes.
    burst.style.left = `${rect.left}px`;
    burst.style.top = `${rect.top}px`;
    burst.style.width = `${rect.width}px`;
    burst.style.height = `${rect.height}px`;
    // Borrow the button's own corners so the ring hugs a pill like a pill and a
    // card like a card.
    burst.style.borderRadius = window.getComputedStyle(element).borderRadius;

    // Restarting a CSS animation needs the old one taken off and the layout
    // flushed in between, or a second press inside half a second does nothing
    // at all — which is exactly the case this exists for.
    burst.dataset.play = 'false';
    void burst.offsetWidth;
    burst.dataset.play = 'true';
  }
}
