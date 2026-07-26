import { gameStore, type CuteCategory, type GameState } from '../state';
import { EGG_PRIZES, SHOP_ITEMS, type ShopItem } from '../world/building/shops/catalogue';
import { isTouchDevice } from '../core/device';

/**
 * The Cute-o-dex — the collection book.
 *
 * "Is recorded in the Cute-o-dex, a collection book showing what you've found
 * and what's still missing." Collecting only means something if you can see the
 * gaps, so this shows **every cute thing in the game**, not just the ones you
 * own: the found ones in full colour with their names, and the rest as adorable
 * dark silhouettes labelled `???`. The silhouette is the item's own emoji with
 * the colour crushed out of it, so the shape still tells you *something* — which
 * is the difference between a locked box and a promise.
 *
 * It is also where the parade is commanded from. Pressing a cute thing you own
 * sends it to the backpack, or brings it back out — the same toggle as tapping
 * the thing itself out in the park, because a child who cannot reach the toy
 * (it is behind a wall, it is one of the ones waiting its turn) still wants to
 * say who comes along.
 *
 * A *subscriber*, like the rest of the HUD: it reads `gameStore` and never
 * reaches into a game system. It also mounts its own button into the HUD's top
 * row, so `Hud.ts` needs no change.
 */

/** Section order, and what each one is called in the book. */
const SECTIONS: readonly { category: CuteCategory; title: string; glyph: string }[] = [
  { category: 'toy', title: 'Toys', glyph: '🧸' },
  { category: 'pet', title: 'Little pets', glyph: '🐾' },
  { category: 'balloon', title: 'Balloons', glyph: '🎈' },
  { category: 'candyfloss', title: 'Candy floss', glyph: '🍬' },
  { category: 'icecream', title: 'Ice creams', glyph: '🍦' },
  { category: 'hat', title: 'Hats', glyph: '👒' },
  { category: 'sticker', title: 'Stickers', glyph: '✨' },
  { category: 'egg', title: 'Surprise eggs', glyph: '🥚' },
  { category: 'secret', title: 'Secrets', glyph: '🌟' },
];

/**
 * Everything there is to find.
 *
 * Sourced from the shop catalogue rather than from a second list, so a new toy
 * appears in the book the moment it goes on a shelf and a page can never quietly
 * fall out of step with the shops.
 */
const CATALOGUE: readonly ShopItem[] = [...SHOP_ITEMS, ...EGG_PRIZES];

/** Kinds that can walk or float behind you. Mirrors the store's rule. */
const PARADEABLE = new Set(['toy', 'pet', 'balloon']);

export class CuteODex {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly pages: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly unsubscribe: () => void;

  private open = false;
  /** True when we are the reason the park is paused — see `Shopping.setPaused`. */
  private pausedByUs = false;

  constructor(container: HTMLElement) {
    // --- the HUD button ---------------------------------------------------
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'pill pill--dex';
    this.button.setAttribute('aria-label', 'Open my Cute-o-dex');
    this.button.innerHTML = '<span class="emoji">📖</span><span>Cute-o-dex</span>';
    this.button.addEventListener('click', () => {
      this.button.blur();
      this.toggle();
    });
    // Slot into the HUD's own top row so it sits with the other pills and wraps
    // with them on a phone. Falling back to the container keeps this working if
    // the HUD is ever restructured.
    (container.querySelector('.hud-row') ?? container).append(this.button);

    // --- the book ---------------------------------------------------------
    this.root = document.createElement('div');
    this.root.className = 'cutodex';
    this.root.dataset.open = 'false';

    const card = document.createElement('div');
    card.className = 'cutodex-card';

    const head = document.createElement('div');
    head.className = 'shop-head';

    const glyph = document.createElement('span');
    glyph.className = 'shop-glyph';
    glyph.textContent = '📖';

    const titles = document.createElement('div');
    titles.className = 'shop-titles';
    const title = document.createElement('h2');
    title.className = 'shop-title';
    title.textContent = 'My Cute-o-dex';
    const greeting = document.createElement('p');
    greeting.className = 'shop-greeting';
    greeting.textContent = 'Every cute thing in the whole park!';
    titles.append(title, greeting);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'shop-close';
    close.setAttribute('aria-label', 'Close the Cute-o-dex');
    close.textContent = '✕';
    close.addEventListener('click', () => {
      close.blur();
      this.close();
    });

    head.append(glyph, titles, close);

    const progress = document.createElement('div');
    progress.className = 'dex-progress';
    this.countEl = document.createElement('span');
    this.countEl.className = 'dex-count';
    const bar = document.createElement('span');
    bar.className = 'dex-bar';
    this.barFill = document.createElement('span');
    this.barFill.className = 'dex-bar-fill';
    bar.append(this.barFill);
    progress.append(this.countEl, bar);

    this.pages = document.createElement('div');
    this.pages.className = 'dex-pages';

    const hint = document.createElement('p');
    hint.className = 'shop-hint';
    hint.innerHTML = isTouchDevice()
      ? '<span>Tap a cute thing to bring it out or put it away · tap one in the parade to send it to your backpack</span>'
      : '<kbd>C</kbd> open &amp; close · click a cute thing to bring it out or put it away';

    card.append(head, progress, this.pages, hint);
    this.root.append(card);
    container.append(this.root);

    window.addEventListener('keydown', this.onKeyDown);
    this.unsubscribe = gameStore.subscribe((state) => this.render(state));
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openBook();
  }

  openBook(): void {
    // Never open on top of a shop, a surprise egg or the backpack drawer: those
    // paused the park, and closing this would un-pause it out from under them.
    if (gameStore.get().paused && !this.pausedByUs) return;
    this.open = true;
    this.root.dataset.open = 'true';
    this.button.dataset.active = 'true';
    if (!gameStore.get().paused) {
      this.pausedByUs = true;
      gameStore.setPaused(true);
    }
    this.render(gameStore.get());
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.dataset.open = 'false';
    this.button.dataset.active = 'false';
    if (this.pausedByUs) {
      this.pausedByUs = false;
      gameStore.setPaused(false);
    }
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.unsubscribe();
    this.root.remove();
    this.button.remove();
  }

  // -------------------------------------------------------------- internals

  /**
   * `C` opens and closes the book.
   *
   * A DOM listener rather than a new entry in `input/actions.ts`, for the same
   * reason `Shopping` uses one: this is a screen that wants a key, not a game
   * action that wants a binding, and adding it here touches nothing else.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (event.code !== 'KeyC') return;
    event.preventDefault();
    this.toggle();
  };

  private render(state: GameState): void {
    const found = CATALOGUE.filter((item) => state.collection[item.id]?.discovered).length;
    this.button.innerHTML =
      `<span class="emoji">📖</span><span>${found}/${CATALOGUE.length}</span>`;
    this.button.dataset.active = this.open ? 'true' : 'false';

    if (!this.open) return;

    this.countEl.textContent =
      found === 0
        ? 'None found yet — the big building has seven shops!'
        : `${found} of ${CATALOGUE.length} found`;
    this.barFill.style.width = `${Math.round((found / CATALOGUE.length) * 100)}%`;

    this.pages.innerHTML = '';
    for (const section of SECTIONS) {
      const items = CATALOGUE.filter((item) => item.category === section.category);
      if (items.length === 0) continue;
      this.pages.append(this.renderSection(section.title, section.glyph, items, state));
    }
  }

  private renderSection(
    title: string,
    glyph: string,
    items: readonly ShopItem[],
    state: GameState,
  ): HTMLElement {
    const section = document.createElement('section');
    section.className = 'dex-section';

    const heading = document.createElement('h3');
    heading.className = 'dex-heading';
    const owned = items.filter((item) => state.collection[item.id]?.discovered).length;
    heading.innerHTML =
      `<span class="emoji">${glyph}</span><span>${escapeHtml(title)}</span>` +
      `<span class="dex-tally">${owned}/${items.length}</span>`;

    const grid = document.createElement('div');
    grid.className = 'dex-grid';
    for (const item of items) grid.append(this.renderCard(item, state));

    section.append(heading, grid);
    return section;
  }

  private renderCard(item: ShopItem, state: GameState): HTMLElement {
    const entry = state.collection[item.id];
    const discovered = entry?.discovered === true;

    if (!discovered) {
      // A silhouette of the real thing: the emoji with its colour crushed out.
      // Still a shape, still a clue, and much more inviting than an empty box.
      const unknown = document.createElement('div');
      unknown.className = 'dex-card';
      unknown.dataset.owned = 'false';
      unknown.setAttribute('aria-label', 'Not found yet');
      unknown.innerHTML =
        `<span class="dex-icon dex-icon--hidden">${escapeHtml(item.icon)}</span>` +
        '<span class="dex-name">???</span>';
      return unknown;
    }

    const paradeable = PARADEABLE.has(item.kind);
    const out = paradeable && gameStore.isOut(item.id);
    const carried = state.inventory.some(
      (owned) => owned.id === item.id && owned.uid === state.carriedUid,
    );

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'dex-card';
    card.dataset.owned = 'true';
    card.dataset.out = out ? 'true' : 'false';
    card.disabled = !paradeable;

    const count = entry?.count ?? 1;
    const where = carried ? 'In my hands' : out ? 'Walking with me' : 'In my backpack';

    card.innerHTML =
      `<span class="dex-icon">${escapeHtml(item.icon)}</span>` +
      `<span class="dex-name">${escapeHtml(item.displayName)}</span>` +
      `<span class="dex-state">${escapeHtml(where)}</span>` +
      (count > 1 ? `<span class="dex-badge">×${count}</span>` : '');

    if (paradeable) {
      card.setAttribute(
        'aria-label',
        `${item.displayName} — ${out ? 'put away' : 'bring out with me'}`,
      );
      card.addEventListener('click', () => {
        card.blur();
        gameStore.setStowedById(item.id, out);
      });
    }

    return card;
  }
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
