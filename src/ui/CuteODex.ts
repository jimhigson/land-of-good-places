import {
  FLOWER_COLOURS,
  FLOWER_ICON,
  SECRETS,
  gameStore,
  type CuteCategory,
  type FlowerColour,
  type GameState,
  type Secret,
} from '../state';
import { EGG_PRIZES, SHOP_ITEMS, type ShopItem } from '../world/building/shops/catalogue';
import { isTouchDevice } from '../core/device';
import { DexPrize, hasSeenDexPrize, markDexPrizeSeen } from './DexPrize';

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
 *
 * It also owns the moment the book fills up completely: `render` is where the
 * count is already being worked out, so it is also where "is that 100%?" is
 * asked, and where the one-time completion prize (`DexPrize.ts`) is set off.
 * The book's own ⭐ button asks for the same prize again on demand, for a
 * grown-up who missed it the first time.
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
  // Free finds from the meadow, not sold in any shop — rendered from
  // `FLOWER_COLOURS` rather than the shop catalogue, see `renderFlowerSection`.
  { category: 'flower', title: 'Flowers', glyph: '🌷' },
  // Things you *do* rather than things you own, so they come from `SECRETS`
  // rather than the shop catalogue — see `renderSecretSection`.
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
  private readonly starButton: HTMLButtonElement;
  private readonly pages: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly prize: DexPrize;
  private readonly unsubscribe: () => void;

  private open = false;
  /** True when we are the reason the park is paused — see `Shopping.setPaused`. */
  private pausedByUs = false;
  /** Guards the automatic celebration so it only ever fires once per browser. */
  private prizeAutoShown = hasSeenDexPrize();

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
    // Slot into the HUD's menu drawer so it sits with the other pills behind
    // the one menu button (GAME_DESIGN.md, "The top bar takes too much
    // space"). Falling back to the container keeps this working if the HUD is
    // ever restructured again.
    (container.querySelector('.hud-menu-items') ?? container).append(this.button);

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

    // Only shown once the book is full — see `render`. Lets a grown-up who
    // missed the celebration (or wants to show it off again) bring it back.
    this.starButton = document.createElement('button');
    this.starButton.type = 'button';
    this.starButton.className = 'dex-star';
    this.starButton.hidden = true;
    this.starButton.setAttribute('aria-label', 'Show the completion celebration again');
    this.starButton.textContent = '⭐';
    this.starButton.addEventListener('click', () => {
      this.starButton.blur();
      this.prize.show(this.paradeItems(gameStore.get()), gameStore.get().player.name);
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'shop-close';
    close.setAttribute('aria-label', 'Close the Cute-o-dex');
    close.textContent = '✕';
    close.addEventListener('click', () => {
      close.blur();
      this.close();
    });

    head.append(glyph, titles, this.starButton, close);

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

    // The full-screen celebration. A separate class (its own confetti,
    // fireworks and parade), but triggered from here — see the class doc.
    this.prize = new DexPrize(container);

    window.addEventListener('keydown', this.onKeyDown);
    this.unsubscribe = gameStore.subscribe((state) => this.render(state));
  }

  get isOpen(): boolean {
    return this.open || this.prize.isOpen;
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
    // The celebration sits on top of the book and owns its own pause flag —
    // if it's showing, a "close" gesture (Escape, the HUD, `Game.tick`'s
    // "the dex has the screen" branch) means "close that", not the book
    // underneath it.
    if (this.prize.isOpen) {
      this.prize.close();
      return;
    }
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
    this.prize.dispose();
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
    const flowerFound = FLOWER_COLOURS.filter(
      (colour) => state.collection[`flower.${colour}`]?.discovered,
    ).length;
    const secretFound = SECRETS.filter((secret) => state.collection[secret.id]?.discovered).length;
    const found =
      CATALOGUE.filter((item) => state.collection[item.id]?.discovered).length +
      flowerFound +
      secretFound;
    const total = CATALOGUE.length + FLOWER_COLOURS.length + SECRETS.length;
    const complete = found === total;
    this.button.innerHTML = `<span class="emoji">📖</span><span>${found}/${total}</span>`;
    this.button.dataset.active = this.open ? 'true' : 'false';

    // The book is full: fire the celebration, exactly once per browser ever
    // (see `hasSeenDexPrize`), and from then on keep the ⭐ button around so it
    // can be shown off again on request.
    this.starButton.hidden = !complete;
    if (complete && !this.prizeAutoShown) {
      this.prizeAutoShown = true;
      markDexPrizeSeen();
      this.prize.show(this.paradeItems(state), state.player.name);
    }

    if (!this.open) return;

    this.countEl.textContent =
      found === 0
        ? 'None found yet — the big building has seven shops!'
        : `${found} of ${total} found!`;
    this.barFill.style.width = `${Math.round((found / total) * 100)}%`;

    this.pages.innerHTML = '';
    for (const section of SECTIONS) {
      if (section.category === 'flower') {
        this.pages.append(this.renderFlowerSection(section.title, section.glyph, state));
        continue;
      }
      if (section.category === 'secret') {
        this.pages.append(this.renderSecretSection(section.title, section.glyph, state));
        continue;
      }
      const items = CATALOGUE.filter((item) => item.category === section.category);
      if (items.length === 0) continue;
      this.pages.append(this.renderSection(section.title, section.glyph, items, state));
    }
  }

  /**
   * Flowers are picked, not bought, so they have no `ShopItem` and do not
   * live in `CATALOGUE` — this reads `FLOWER_COLOURS` and the collection
   * directly instead. Everything else about the book (sections, silhouettes,
   * progress bar) is untouched.
   */
  private renderFlowerSection(title: string, glyph: string, state: GameState): HTMLElement {
    const section = document.createElement('section');
    section.className = 'dex-section';

    const heading = document.createElement('h3');
    heading.className = 'dex-heading';
    const owned = FLOWER_COLOURS.filter(
      (colour) => state.collection[`flower.${colour}`]?.discovered,
    ).length;
    heading.innerHTML =
      `<span class="emoji">${glyph}</span><span>${escapeHtml(title)}</span>` +
      `<span class="dex-tally">${owned}/${FLOWER_COLOURS.length}</span>`;

    const grid = document.createElement('div');
    grid.className = 'dex-grid';
    for (const colour of FLOWER_COLOURS) grid.append(this.renderFlowerCard(colour, state));

    section.append(heading, grid);
    return section;
  }

  /**
   * A picked flower's card toggles whether it is worn in the hair — the same
   * "tap it to bring it out / put it away" idea the rest of the book uses,
   * just wired to `gameStore.setWornFlower` instead of stow/parade. Picking a
   * flower already wears it by default; this is the undo/switch path.
   */
  private renderFlowerCard(colour: FlowerColour, state: GameState): HTMLElement {
    const id = `flower.${colour}`;
    const entry = state.collection[id];
    const discovered = entry?.discovered === true;

    if (!discovered) {
      const unknown = document.createElement('div');
      unknown.className = 'dex-card';
      unknown.dataset.owned = 'false';
      unknown.setAttribute('aria-label', 'Not found yet');
      unknown.innerHTML =
        `<span class="dex-icon dex-icon--hidden">${escapeHtml(FLOWER_ICON[colour])}</span>` +
        '<span class="dex-name">???</span>';
      return unknown;
    }

    const owned = state.inventory.find((item) => item.flowerColour === colour);
    const worn = owned !== undefined && owned.uid === state.wornFlowerUid;
    const displayName = `${colour.charAt(0).toUpperCase()}${colour.slice(1)} flower`;
    const count = entry?.count ?? 1;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'dex-card';
    card.dataset.owned = 'true';
    card.dataset.out = worn ? 'true' : 'false';
    card.disabled = !owned;

    card.innerHTML =
      `<span class="dex-icon">${escapeHtml(FLOWER_ICON[colour])}</span>` +
      `<span class="dex-name">${escapeHtml(displayName)}</span>` +
      `<span class="dex-state">${escapeHtml(worn ? 'Worn in my hair' : 'In my backpack')}</span>` +
      (count > 1 ? `<span class="dex-badge">×${count}</span>` : '');

    if (owned) {
      card.setAttribute('aria-label', `${displayName} — ${worn ? 'take off' : 'wear in my hair'}`);
      card.addEventListener('click', () => {
        card.blur();
        gameStore.setWornFlower(worn ? null : owned.uid);
      });
    }

    return card;
  }

  /**
   * Every found cutie's icon and name, in book order — the parade the prize
   * celebration marches across the screen. Catalogue items first (shop order),
   * then any found flowers, so the parade reads in the same order as the pages.
   */
  private paradeItems(state: GameState): { icon: string; displayName: string }[] {
    const catalogueFound = CATALOGUE.filter((item) => state.collection[item.id]?.discovered).map(
      (item) => ({ icon: item.icon, displayName: item.displayName }),
    );
    const flowersFound = FLOWER_COLOURS.filter(
      (colour) => state.collection[`flower.${colour}`]?.discovered,
    ).map((colour) => ({
      icon: FLOWER_ICON[colour],
      displayName: `${colour.charAt(0).toUpperCase()}${colour.slice(1)} flower`,
    }));
    return [...catalogueFound, ...flowersFound];
  }

  /**
   * Secrets are things you have *done*, so no shop sells them and they are not
   * in `CATALOGUE` — this reads `SECRETS` and the collection directly, exactly
   * as `renderFlowerSection` does.
   *
   * The cards are plain `<div>`s, not buttons: there is nothing to toggle. A
   * deed cannot be sent to the backpack or brought out for the parade, and a
   * disabled button that never does anything is a worse promise than a card
   * that never looked pressable.
   */
  private renderSecretSection(title: string, glyph: string, state: GameState): HTMLElement {
    const section = document.createElement('section');
    section.className = 'dex-section';

    const heading = document.createElement('h3');
    heading.className = 'dex-heading';
    const done = SECRETS.filter((secret) => state.collection[secret.id]?.discovered).length;
    heading.innerHTML =
      `<span class="emoji">${glyph}</span><span>${escapeHtml(title)}</span>` +
      `<span class="dex-tally">${done}/${SECRETS.length}</span>`;

    const grid = document.createElement('div');
    grid.className = 'dex-grid';
    for (const secret of SECRETS) grid.append(this.renderSecretCard(secret, state));

    section.append(heading, grid);
    return section;
  }

  private renderSecretCard(secret: Secret, state: GameState): HTMLElement {
    const discovered = state.collection[secret.id]?.discovered === true;

    const card = document.createElement('div');
    card.className = 'dex-card';
    card.dataset.owned = discovered ? 'true' : 'false';

    if (!discovered) {
      // No hint at all beyond the shape. Being told what to do would spoil the
      // only thing a secret has.
      card.setAttribute('aria-label', 'Not found yet');
      card.innerHTML =
        `<span class="dex-icon dex-icon--hidden">${escapeHtml(secret.icon)}</span>` +
        '<span class="dex-name">???</span>';
      return card;
    }

    card.setAttribute('aria-label', `${secret.name} — ${secret.done}`);
    card.innerHTML =
      `<span class="dex-icon">${escapeHtml(secret.icon)}</span>` +
      `<span class="dex-name">${escapeHtml(secret.name)}</span>` +
      `<span class="dex-state">${escapeHtml(secret.done)}</span>`;
    return card;
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

    const count = entry?.count ?? 1;

    // Something eaten is a thing she *did*, not a thing she has, so its card is
    // shaped like a secret's: a plain `<div>` with nothing to press, because a
    // finished ice cream cannot be brought out for the parade or put away. Read
    // off the placement rather than off `item.kind`, so a save from before food
    // stopped being kept still tells the truth about the candy floss that is
    // genuinely still in its backpack.
    if (entry?.placement === 'eaten') {
      const eaten = document.createElement('div');
      eaten.className = 'dex-card';
      eaten.dataset.owned = 'true';
      const eatenState = count > 1 ? `Eaten ${count} of them! Yum!` : 'Eaten! Yum!';
      eaten.setAttribute('aria-label', `${item.displayName} — ${eatenState}`);
      eaten.innerHTML =
        `<span class="dex-icon">${escapeHtml(item.icon)}</span>` +
        `<span class="dex-name">${escapeHtml(item.displayName)}</span>` +
        `<span class="dex-state">${escapeHtml(eatenState)}</span>` +
        (count > 1 ? `<span class="dex-badge">×${count}</span>` : '');
      return eaten;
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
