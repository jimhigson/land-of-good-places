import type { FacePaintDesign } from '../art/style/faces';
import { FACE_PAINT_DESIGNS, FACE_PAINT_INFO } from '../art/style/faces';

/**
 * The face-painting stall's picker panel.
 *
 * Same pill-and-cream HUD language as {@link ShopPanel} (see that file for the
 * two-input-methods rationale — this is deliberately a near-copy of its shape
 * rather than a shared base class, because the two panels' content is different
 * enough — a fixed grid of designs plus a "wash off" toggle, not a scrolling
 * priced list — that factoring them together would mostly be indirection).
 *
 * The "brief painting moment" (design picked → painter leans in → the design
 * appears) plays out **inside this panel**, exactly like the shop's
 * surprise-egg reveal — see `showPaintingMoment`. `FacePaintStall` runs the
 * matching in-world beat (the painter figure leaning in, a few sparkles) on
 * its own clock in parallel; the two are not synchronised any tighter than
 * "roughly the same length", which is all a moment like this needs.
 */

export interface FacePaintPanelHandlers {
  /** A design was tapped/clicked. Fires the moment it is picked, not when it lands. */
  onPick(design: FacePaintDesign): void;
  onWashOff(): void;
  onClose(): void;
}

/** How long the "painting…" beat holds before revealing the design. */
const PAINT_WOBBLE_MS = 1100;
/** How long the reveal stays up before the panel closes itself. */
const PAINT_SHOW_MS = 1700;

export class FacePaintPanel {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly washOffButton: HTMLButtonElement;
  private readonly moment: HTMLElement;

  private readonly handlers: FacePaintPanelHandlers;
  private rows: HTMLButtonElement[] = [];
  private selected = 0;
  private open = false;
  private momentTimers: number[] = [];

  constructor(container: HTMLElement, handlers: FacePaintPanelHandlers) {
    this.handlers = handlers;

    // `shop-panel` gives this the same full-screen backdrop, open/close
    // transition and centring as the shop panel for free (see style.css);
    // `facepaint-panel` exists only as a hook for anything genuinely different.
    this.root = document.createElement('div');
    this.root.className = 'facepaint-panel shop-panel';
    this.root.dataset.open = 'false';

    this.card = document.createElement('div');
    this.card.className = 'facepaint-card shop-card';

    const header = document.createElement('div');
    header.className = 'shop-head';

    const glyph = document.createElement('div');
    glyph.className = 'shop-glyph';
    glyph.textContent = '🎨';

    const titles = document.createElement('div');
    titles.className = 'shop-titles';
    const title = document.createElement('h2');
    title.className = 'shop-title';
    title.textContent = 'Face Painting!';
    const greeting = document.createElement('p');
    greeting.className = 'shop-greeting';
    greeting.textContent = 'Pick a design — it washes off any time!';
    titles.append(title, greeting);

    const close = document.createElement('button');
    close.className = 'shop-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close face painting');
    close.textContent = '✕';
    close.addEventListener('click', () => {
      close.blur();
      this.handlers.onClose();
    });

    header.append(glyph, titles, close);

    this.grid = document.createElement('div');
    this.grid.className = 'facepaint-grid';

    const footer = document.createElement('div');
    footer.className = 'shop-foot';
    this.washOffButton = document.createElement('button');
    this.washOffButton.type = 'button';
    this.washOffButton.className = 'facepaint-washoff';
    this.washOffButton.innerHTML = '<span class="emoji">💧</span><span>Wash it off</span>';
    this.washOffButton.addEventListener('click', () => {
      this.washOffButton.blur();
      this.handlers.onWashOff();
    });
    const hint = document.createElement('p');
    hint.className = 'shop-hint';
    hint.innerHTML =
      '<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> choose · <kbd>E</kbd> pick · <kbd>Esc</kbd> close · or just tap!';
    footer.append(this.washOffButton, hint);

    this.moment = document.createElement('div');
    this.moment.className = 'shop-surprise facepaint-moment';
    this.moment.dataset.show = 'false';

    this.card.append(header, this.grid, footer, this.moment);
    this.root.append(this.card);
    // Tapping the dimmed area outside the card closes the panel, and keeps the
    // tap from reaching the canvas as a "walk over there" — same trick as
    // every other full-screen panel in the game.
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.handlers.onClose();
    });
    container.append(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** True while the painting-moment reveal owns the screen. */
  get isRevealing(): boolean {
    return this.moment.dataset.show === 'true';
  }

  openWith(current: FacePaintDesign | null): void {
    this.clearMoment();
    this.selected = Math.max(0, FACE_PAINT_DESIGNS.indexOf(current ?? FACE_PAINT_DESIGNS[0]!));

    this.grid.innerHTML = '';
    this.rows = FACE_PAINT_DESIGNS.map((design, index) => this.buildRow(design, index));
    for (const row of this.rows) this.grid.append(row);
    this.washOffButton.disabled = current === null;

    this.applySelection();
    this.open = true;
    this.root.dataset.open = 'true';
  }

  /**
   * Tells the panel what the player is now wearing, without rebuilding it.
   *
   * The picker stays up after the reveal, so "Wash it off" has to come alive
   * the moment a design actually lands — `openWith` alone would only catch it
   * the *next* time the stall was opened.
   */
  setWearing(current: FacePaintDesign | null): void {
    this.washOffButton.disabled = current === null;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.dataset.open = 'false';
    this.clearMoment();
  }

  /**
   * The brief painting moment: a wiggling paintbrush and a sparkle or two,
   * then the design revealed on a big smiling face. In the panel rather than
   * only in the world for the same reason the shop's egg hatch is — the child
   * is looking at the card they just tapped.
   */
  showPaintingMoment(design: FacePaintDesign, onDone: () => void): void {
    this.clearMoment();
    const info = FACE_PAINT_INFO[design];
    this.moment.dataset.show = 'true';
    this.moment.dataset.phase = 'wobble';
    this.moment.innerHTML =
      '<div class="facepaint-brush">🖌️<span class="facepaint-sparkle facepaint-sparkle-a">✨</span>' +
      '<span class="facepaint-sparkle facepaint-sparkle-b">✨</span></div>' +
      '<p class="surprise-line">painting your face…</p>';

    this.momentTimers.push(
      window.setTimeout(() => {
        this.moment.dataset.phase = 'open';
        this.moment.innerHTML =
          `<div class="surprise-prize">${info.glyph}</div>` +
          `<h3 class="surprise-name">${escapeHtml(info.label)}!</h3>` +
          '<p class="surprise-line">all done — looking cute!</p>';
        onDone();
      }, PAINT_WOBBLE_MS),
    );
    this.momentTimers.push(
      window.setTimeout(() => {
        this.moment.dataset.show = 'false';
      }, PAINT_WOBBLE_MS + PAINT_SHOW_MS),
    );
  }

  /**
   * Keyboard handling, called by the owner rather than bound here — see
   * `ShopPanel.handleKey` for why (the game's own `InputSystem` listener was
   * registered first, so a second `window` listener cannot reliably beat it).
   */
  handleKey(code: string): boolean {
    if (!this.open) return false;
    if (this.isRevealing) return true; // swallow keys, but nothing to do yet

    const columns = 2;
    switch (code) {
      case 'ArrowRight':
      case 'KeyD':
        this.move(1);
        return true;
      case 'ArrowLeft':
      case 'KeyA':
        this.move(-1);
        return true;
      case 'ArrowDown':
      case 'KeyS':
        this.move(columns);
        return true;
      case 'ArrowUp':
      case 'KeyW':
        this.move(-columns);
        return true;
      case 'Enter':
      case 'KeyE':
      case 'KeyF':
      case 'Space':
        this.pickSelected();
        return true;
      // Escape is deliberately not handled here — see `ShopPanel.handleKey`.
      default:
        return false;
    }
  }

  dispose(): void {
    this.clearMoment();
    this.root.remove();
  }

  // -------------------------------------------------------------- internals

  private buildRow(design: FacePaintDesign, index: number): HTMLButtonElement {
    const info = FACE_PAINT_INFO[design];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'shop-row facepaint-row';
    row.innerHTML =
      `<span class="row-icon">${info.glyph}</span>` +
      `<span class="row-name">${escapeHtml(info.label)}</span>`;
    row.addEventListener('click', () => {
      row.blur();
      this.selected = index;
      this.applySelection();
      this.pickSelected();
    });
    return row;
  }

  private move(delta: number): void {
    if (this.rows.length === 0) return;
    this.selected = (this.selected + delta + this.rows.length) % this.rows.length;
    this.applySelection();
  }

  private applySelection(): void {
    this.rows.forEach((row, index) => {
      row.dataset.selected = index === this.selected ? 'true' : 'false';
    });
    this.rows[this.selected]?.scrollIntoView({ block: 'nearest' });
  }

  private pickSelected(): void {
    const design = FACE_PAINT_DESIGNS[this.selected];
    if (!design) return;
    this.handlers.onPick(design);
  }

  private clearMoment(): void {
    for (const timer of this.momentTimers) window.clearTimeout(timer);
    this.momentTimers = [];
    this.moment.dataset.show = 'false';
  }
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
