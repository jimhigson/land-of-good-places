import type { FrameContext, GameSystem } from '../core/types';

/**
 * The hotel's floor read-out — Eleri (issue #236): *"It shows on the screen
 * which floor you are on, on the HUD."*
 *
 * A little pill that exists only while the hotel does: `source()` returns
 * the floor label ("Lobby", "Floor 1", "Floor 50") or `null` anywhere else,
 * and null is the pill gone — not blanked, gone, because the family already
 * ruled the top bar eats too much screen and an empty pill is spent screen.
 * Follows `LiftPanel`'s pattern: a `GameSystem` that owns a bit of DOM and
 * reads one seam.
 */
export class FloorPill implements GameSystem {
  readonly name = 'hotelFloorPill';

  private readonly root: HTMLElement;
  private shown: string | null = null;

  constructor(container: HTMLElement, private readonly source: () => string | null) {
    this.root = document.createElement('div');
    this.root.className = 'hotel-floor-pill';
    this.root.dataset.show = 'false';
    container.append(this.root);
  }

  update(_context: FrameContext): void {
    const label = this.source();
    if (label === this.shown) return;
    this.shown = label;
    if (label === null) {
      this.root.dataset.show = 'false';
      return;
    }
    this.root.textContent = `\u{1F3E8} ${label}`;
    this.root.dataset.show = 'true';
  }

  dispose(): void {
    this.root.remove();
  }
}
