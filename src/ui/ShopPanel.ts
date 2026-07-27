import { hexToCss } from '../core/palette';
import { shopWords } from '../state/wording';

/**
 * The purchase panel.
 *
 * Plain DOM over the canvas, in the same pill-and-cream language as the HUD.
 *
 * **One click is enough** (GAME_DESIGN.md, "Buying things", 27 July 2026). The
 * family said choosing a thing and *then* pressing the button was two steps too
 * many, so there is no chosen thing any more: the panel is a list of items with
 * their descriptions, and every one of them has its own big button sitting right
 * next to it. Press it and it is yours. No highlight to move, no confirmation to
 * dismiss, nothing to undo — money never runs out in normal play, so a mis-tap
 * costs a child nothing and the generous thing to do is let her prod.
 *
 * **The word on that button is never written here.** In normal play money is
 * meaningless, so the button says *Collect*; in Mayhem it will say *Buy* again.
 * Every label, aria-label and hint in this file comes from `shopWords()` — see
 * `state/wording.ts` for why one place decides it.
 *
 * Three things follow from that, and they are the whole design:
 *
 * - **The buttons are ordinary `<button>`s.** That is how they pick up the
 *   HIGHLIGHT RULE for free — the rainbow hover/focus outline, the pointer
 *   cursor and the half-second activation flash all come from the global rules
 *   in `style.css` and `ui/TapBurst.ts`, and nothing here hand-rolls any of it.
 * - **Keyboard is focus, not a private highlight.** ↑/↓ move the *browser's*
 *   focus from one button to the next; Enter and Space are left entirely to
 *   the browser, which activates the focused button natively (and fires the same
 *   `click` the flash and the burst listen for). The old panel could not do this
 *   — it tracked its own selection and had to keep focus off the buttons, or
 *   Enter would fire its handler *and* the button and take two of everything.
 *   With one handler per button and none on Enter, that hazard is gone.
 * - **"It's yours" is said twice.** The button itself answers back for a moment,
 *   and the row keeps a little "Yours!" tag (with a ×count if she bought several)
 *   for as long as the shop is open. On a phone there is no hover to have seen,
 *   so the answer has to be in the row she just pressed.
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
  /** Fired when a row's button is pressed. The panel does not know what that *does*. */
  onBuy(itemId: string): void;
  onClose(): void;
}

/** How long the egg wobbles before it cracks open, in milliseconds. */
const HATCH_WOBBLE_MS = 1100;
/** How long the prize stays up before the panel takes itself away. */
const HATCH_SHOW_MS = 2600;
/** How long the button says "Yours!" back before going quiet again. */
const BOUGHT_FLASH_MS = 1000;

/** One item's row: the description, the button, and how it answers back. */
interface Row {
  readonly item: ShopPanelItem;
  readonly root: HTMLElement;
  readonly buy: HTMLButtonElement;
  readonly label: HTMLElement;
  readonly tag: HTMLElement;
  /** How many of this one she has taken since the shop opened. */
  count: number;
  /** Timer putting the button's label back, or 0. */
  flashTimer: number;
}

export class ShopPanel {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly glyphEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly greetingEl: HTMLElement;
  private readonly list: HTMLElement;
  private readonly surprise: HTMLElement;
  private readonly hint: HTMLElement;

  private readonly handlers: ShopPanelHandlers;
  private rows: Row[] = [];
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

    const footer = document.createElement('div');
    footer.className = 'shop-foot';
    this.hint = document.createElement('p');
    this.hint.className = 'shop-hint';
    footer.append(this.hint);

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

  openWith(content: ShopPanelContent): void {
    this.clearHatch();
    this.clearRows();

    const accent = hexToCss(content.accent);
    this.card.style.setProperty('--shop-accent', accent);
    this.glyphEl.textContent = content.glyph;
    this.titleEl.textContent = content.title;
    this.greetingEl.textContent = content.greeting;

    this.list.innerHTML = '';
    this.rows = content.items.map((item) => this.buildRow(item));
    for (const row of this.rows) this.list.append(row.root);

    // Written on open rather than in the constructor: the word depends on the
    // mode, and a grown-up can change the mode between two visits to a shop.
    const words = shopWords();
    this.hint.innerHTML =
      `Press <b>${words.verb}</b> and it is yours — as many as you like! · ` +
      '<kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Esc</kbd> close';

    this.open = true;
    this.root.dataset.open = 'true';

    // Focus the first thing she can take, so a keyboard player can press Enter
    // straight away instead of hunting for the list with Tab. Next frame,
    // because on this one the panel is still `visibility: hidden` — and an
    // invisible element cannot take focus.
    requestAnimationFrame(() => {
      if (!this.open) return;
      this.rows.find((row) => row.item.available)?.buy.focus();
    });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.dataset.open = 'false';
    this.clearHatch();
    this.clearRows();
  }

  /**
   * The surprise-egg reveal: the egg wobbles, cracks, and there is a toy in it.
   *
   * Deliberately in the panel rather than in the world — the child is looking at
   * the shop when she presses it, and a 3D hatch would happen behind the card
   * she is reading.
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
   *
   * Returning `true` means "used, and the owner should call `preventDefault`",
   * which is why **Enter and Space are never claimed**: preventing the default
   * on those is exactly what would stop the focused button being pressed. The
   * browser presses it for us, and the rainbow activation flash comes with the
   * `click` it dispatches.
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
        this.moveFocus(1);
        return true;
      case 'ArrowUp':
      case 'KeyW':
        this.moveFocus(-1);
        return true;
      case 'KeyE':
      case 'KeyF':
        // E is the game's "use this" key everywhere else, so it takes whatever
        // is focused. `click()` rather than calling the handler directly, so it
        // goes down the one path the burst and the chime already watch.
        this.focusedRow()?.buy.click();
        return true;
      // Enter / Space: see the doc comment. Left to the browser on purpose.
      //
      // Escape is deliberately NOT handled here either. It is bound to the
      // game's `menu` action, and consuming it in the DOM would close the panel
      // a frame before the game saw the key — which is how you end up with a
      // shop that closes and a park that pauses behind it.
      default:
        return false;
    }
  }

  dispose(): void {
    this.clearHatch();
    this.clearRows();
    this.root.remove();
  }

  // -------------------------------------------------------------- internals

  private buildRow(item: ShopPanelItem): Row {
    const words = shopWords();

    const root = document.createElement('div');
    root.className = 'shop-item';
    root.dataset.available = item.available ? 'true' : 'false';

    const icon = document.createElement('span');
    icon.className = 'row-icon';
    icon.textContent = item.icon;

    const text = document.createElement('span');
    text.className = 'row-text';
    const name = document.createElement('span');
    name.className = 'row-name';
    name.textContent = item.displayName;
    const blurb = document.createElement('span');
    blurb.className = 'row-blurb';
    blurb.textContent = item.available ? item.blurb : 'back soon!';
    text.append(name, blurb);

    // Shown or not by the one wording switch, not by a check on the mode here
    // — see `ShopWords.showPrice`, which is where the family's open question
    // about whether a price a child can always afford is worth showing at all
    // will be answered.
    const price = document.createElement('span');
    price.className = 'row-price';
    price.hidden = !words.showPrice;
    price.textContent = String(item.price);

    const tag = document.createElement('span');
    tag.className = 'shop-item-tag';
    tag.dataset.show = 'false';

    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'shop-item-buy';
    buy.disabled = !item.available;
    buy.setAttribute(
      'aria-label',
      item.available
        ? `${words.verb} ${item.displayName}`
        : `${item.displayName} is ${words.unavailable}`,
    );
    const label = document.createElement('span');
    label.className = 'buy-label';
    buy.append(label);

    root.append(icon, text, price, tag, buy);

    const row: Row = { item, root, buy, label, tag, count: 0, flashTimer: 0 };
    setBuyLabel(row, false);

    buy.addEventListener('click', () => {
      if (!item.available) return;
      this.handlers.onBuy(item.id);
      this.confirm(row);
    });

    return row;
  }

  /**
   * "That one is yours now."
   *
   * The row keeps its tag for the rest of the visit; the button says so loudly
   * and then calms down, so the next press still reads as a fresh one.
   */
  private confirm(row: Row): void {
    row.count += 1;
    row.root.dataset.bought = 'true';
    row.tag.dataset.show = 'true';
    row.tag.textContent = row.count > 1 ? `Yours! ×${row.count}` : 'Yours!';

    setBuyLabel(row, true);
    window.clearTimeout(row.flashTimer);
    row.flashTimer = window.setTimeout(() => {
      row.flashTimer = 0;
      setBuyLabel(row, false);
    }, BOUGHT_FLASH_MS);
  }

  /** The row whose button has focus, if any. */
  private focusedRow(): Row | null {
    const active = document.activeElement;
    return this.rows.find((row) => row.buy === active) ?? null;
  }

  /** ↑/↓ walk the browser's focus along the available rows, wrapping round. */
  private moveFocus(delta: number): void {
    const rows = this.rows.filter((row) => row.item.available);
    if (rows.length === 0) return;
    const current = rows.findIndex((row) => row.buy === document.activeElement);
    const next = current < 0 ? 0 : (current + delta + rows.length) % rows.length;
    const row = rows[next];
    if (!row) return;
    row.buy.focus();
    row.root.scrollIntoView({ block: 'nearest' });
  }

  private clearRows(): void {
    for (const row of this.rows) window.clearTimeout(row.flashTimer);
    this.rows = [];
  }

  private clearHatch(): void {
    for (const timer of this.hatchTimers) window.clearTimeout(timer);
    this.hatchTimers = [];
    this.surprise.dataset.show = 'false';
  }
}

function setBuyLabel(row: Row, justBought: boolean): void {
  if (!row.item.available) {
    row.label.textContent = 'Not today…';
    return;
  }
  row.label.textContent = justBought ? '✓ Yours!' : shopWords().buttonLabel;
  row.buy.dataset.bought = justBought ? 'true' : 'false';
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
