import { hexToCss } from '../core/palette';

/**
 * The purchase panel.
 *
 * Plain DOM over the canvas, in the same pill-and-cream language as the HUD, and
 * built to be used two ways at once:
 *
 * - **Fingers.** Every row is its own big buy button (56 px minimum), plus a
 *   whopping "Buy it!" at the bottom for the highlighted thing. Money never runs
 *   out in normal mode, so a mis-tap costs nothing and a child can just prod.
 * - **Keyboard.** ↑/↓ move the highlight, Enter / E / Space buys it, Esc closes.
 *   Nothing here relies on focus, because a focused button would fire its own
 *   click on Enter *as well* as our handler and buy two of everything.
 */

export interface ShopPanelItem {
  readonly id: string;
  readonly displayName: string;
  readonly blurb: string;
  readonly icon: string;
  readonly price: number;
  /** False for the rainbow floss when it is not being spun today. */
  readonly available: boolean;
}

export interface ShopPanelContent {
  readonly title: string;
  readonly glyph: string;
  readonly greeting: string;
  /** Shop accent colour, as a hex number from the palette. */
  readonly accent: number;
  readonly items: readonly ShopPanelItem[];
}

export interface ShopPanelHandlers {
  /** Fired for a buy. The panel does not know what a purchase *is*. */
  onBuy(itemId: string): void;
  onClose(): void;
}

/** How long the egg wobbles before it cracks open, in milliseconds. */
const HATCH_WOBBLE_MS = 1100;
/** How long the prize stays up before the panel takes itself away. */
const HATCH_SHOW_MS = 2600;

export class ShopPanel {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly glyphEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly greetingEl: HTMLElement;
  private readonly list: HTMLElement;
  private readonly buyButton: HTMLButtonElement;
  private readonly surprise: HTMLElement;

  private readonly handlers: ShopPanelHandlers;
  private rows: HTMLButtonElement[] = [];
  private items: readonly ShopPanelItem[] = [];
  private selected = 0;
  private open = false;
  private hatchTimers: number[] = [];

  constructor(container: HTMLElement, handlers: ShopPanelHandlers) {
    this.handlers = handlers;

    this.root = document.createElement('div');
    this.root.className = 'shop-panel';
    this.root.dataset.open = 'false';

    this.card = document.createElement('div');
    this.card.className = 'shop-card';

    const header = document.createElement('div');
    header.className = 'shop-head';

    this.glyphEl = document.createElement('div');
    this.glyphEl.className = 'shop-glyph';

    const titles = document.createElement('div');
    titles.className = 'shop-titles';
    this.titleEl = document.createElement('h2');
    this.titleEl.className = 'shop-title';
    this.greetingEl = document.createElement('p');
    this.greetingEl.className = 'shop-greeting';
    titles.append(this.titleEl, this.greetingEl);

    const close = document.createElement('button');
    close.className = 'shop-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close the shop');
    close.textContent = '✕';
    close.addEventListener('click', () => {
      close.blur();
      this.handlers.onClose();
    });

    header.append(this.glyphEl, titles, close);

    this.list = document.createElement('div');
    this.list.className = 'shop-list';

    this.buyButton = document.createElement('button');
    this.buyButton.className = 'shop-buy';
    this.buyButton.type = 'button';
    this.buyButton.addEventListener('click', () => {
      this.buyButton.blur();
      this.buySelected();
    });

    const footer = document.createElement('div');
    footer.className = 'shop-foot';
    const hint = document.createElement('p');
    hint.className = 'shop-hint';
    hint.innerHTML =
      '<kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>E</kbd> buy · <kbd>Esc</kbd> close · or just tap!';
    footer.append(this.buyButton, hint);

    this.surprise = document.createElement('div');
    this.surprise.className = 'shop-surprise';
    this.surprise.dataset.show = 'false';

    this.card.append(header, this.list, footer, this.surprise);
    this.root.append(this.card);
    // Tapping the dimmed area outside the card closes the shop. It also stops
    // that tap reaching the canvas, where it would have been read as "walk over
    // there" and remembered until the game un-paused.
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.handlers.onClose();
    });
    container.append(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** The catalogue id currently highlighted, or null. */
  get selectedId(): string | null {
    return this.items[this.selected]?.id ?? null;
  }

  openWith(content: ShopPanelContent): void {
    this.clearHatch();
    this.items = content.items;
    this.selected = Math.max(
      0,
      content.items.findIndex((item) => item.available),
    );

    const accent = hexToCss(content.accent);
    this.card.style.setProperty('--shop-accent', accent);
    this.glyphEl.textContent = content.glyph;
    this.titleEl.textContent = content.title;
    this.greetingEl.textContent = content.greeting;

    this.list.innerHTML = '';
    this.rows = content.items.map((item, index) => this.buildRow(item, index));
    for (const row of this.rows) this.list.append(row);

    this.applySelection();
    this.open = true;
    this.root.dataset.open = 'true';
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.dataset.open = 'false';
    this.clearHatch();
  }

  /**
   * The surprise-egg reveal: the egg wobbles, cracks, and there is a toy in it.
   *
   * Deliberately in the panel rather than in the world — the child is looking at
   * the shop when they buy, and a 3D hatch would happen behind the card they are
   * reading.
   */
  showSurprise(icon: string, name: string, blurb: string, onDone: () => void): void {
    this.clearHatch();
    this.surprise.dataset.show = 'true';
    this.surprise.dataset.phase = 'wobble';
    this.surprise.innerHTML =
      '<div class="surprise-egg">🥚</div>' +
      '<p class="surprise-line">what is inside…?</p>';

    this.hatchTimers.push(
      window.setTimeout(() => {
        this.surprise.dataset.phase = 'open';
        this.surprise.innerHTML =
          `<div class="surprise-prize">${escapeHtml(icon)}</div>` +
          `<h3 class="surprise-name">${escapeHtml(name)}</h3>` +
          `<p class="surprise-line">${escapeHtml(blurb)}</p>`;
        onDone();
      }, HATCH_WOBBLE_MS),
    );
    this.hatchTimers.push(
      window.setTimeout(() => {
        this.surprise.dataset.show = 'false';
      }, HATCH_SHOW_MS),
    );
  }

  /** True if a reveal is on screen — the caller swallows input while it is. */
  get isRevealing(): boolean {
    return this.surprise.dataset.show === 'true';
  }

  /**
   * Keyboard handling, called by the owner rather than bound here.
   *
   * The game's InputSystem already listens on `window` and was registered first;
   * a second window listener could not reliably stop it. Routing through the
   * owner keeps one clear rule: while the panel is open, it gets the keys.
   */
  handleKey(code: string): boolean {
    if (!this.open) return false;

    if (this.isRevealing) {
      // Any key dismisses a reveal early.
      this.surprise.dataset.show = 'false';
      return true;
    }

    switch (code) {
      case 'ArrowDown':
      case 'KeyS':
        this.move(1);
        return true;
      case 'ArrowUp':
      case 'KeyW':
        this.move(-1);
        return true;
      case 'Enter':
      case 'KeyE':
      case 'KeyF':
      case 'Space':
        this.buySelected();
        return true;
      // Escape is deliberately NOT handled here. It is bound to the game's
      // `menu` action, and consuming it in the DOM would close the panel a
      // frame before the game saw the key — which is how you end up with a shop
      // that closes and a park that pauses behind it.
      default:
        return false;
    }
  }

  dispose(): void {
    this.clearHatch();
    this.root.remove();
  }

  // -------------------------------------------------------------- internals

  private buildRow(item: ShopPanelItem, index: number): HTMLButtonElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'shop-row';
    row.dataset.available = item.available ? 'true' : 'false';
    row.innerHTML =
      `<span class="row-icon">${escapeHtml(item.icon)}</span>` +
      '<span class="row-text">' +
      `<span class="row-name">${escapeHtml(item.displayName)}</span>` +
      `<span class="row-blurb">${escapeHtml(item.available ? item.blurb : 'back soon!')}</span>` +
      '</span>' +
      `<span class="row-price">${item.price}</span>`;

    row.addEventListener('click', () => {
      row.blur();
      this.selected = index;
      this.applySelection();
      this.buySelected();
    });
    return row;
  }

  private move(delta: number): void {
    if (this.items.length === 0) return;
    let next = this.selected;
    for (let step = 0; step < this.items.length; step += 1) {
      next = (next + delta + this.items.length) % this.items.length;
      if (this.items[next]?.available) break;
    }
    this.selected = next;
    this.applySelection();
  }

  private applySelection(): void {
    this.rows.forEach((row, index) => {
      row.dataset.selected = index === this.selected ? 'true' : 'false';
    });
    this.rows[this.selected]?.scrollIntoView({ block: 'nearest' });

    const item = this.items[this.selected];
    const buyable = item?.available ?? false;
    this.buyButton.disabled = !buyable;
    this.buyButton.innerHTML = item
      ? `<span class="emoji">🛍️</span><span>${escapeHtml(
          buyable ? `Buy ${item.displayName}!` : 'Not today…',
        )}</span>`
      : '<span>Nothing here!</span>';
  }

  private buySelected(): void {
    const item = this.items[this.selected];
    if (!item || !item.available) return;
    this.handlers.onBuy(item.id);
  }

  private clearHatch(): void {
    for (const timer of this.hatchTimers) window.clearTimeout(timer);
    this.hatchTimers = [];
    this.surprise.dataset.show = 'false';
  }
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
