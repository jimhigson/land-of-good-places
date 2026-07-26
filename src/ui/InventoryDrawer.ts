import { gameStore, type GameState, type InventoryItem } from '../state';

/**
 * The backpack drawer: everything you have bought, newest first.
 *
 * A *subscriber*, like the rest of the HUD — it reads the store and never
 * reaches into a game system. Tapping a row carries that thing in your hands,
 * which is the only interaction it has, and is enough to make the list feel like
 * it belongs to the player rather than to a menu.
 *
 * The Cute-o-dex, the bedroom shelves and the parade (build step 5) all want
 * this same data; they should read `gameStore.get().inventory` rather than
 * anything in here.
 */
export interface InventoryHandlers {
  onCarry(uid: string): void;
}

export class InventoryDrawer {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly handlers: InventoryHandlers;
  private readonly unsubscribe: () => void;

  private rows: HTMLButtonElement[] = [];
  private entries: InventoryItem[] = [];
  private selected = 0;
  private open = false;

  constructor(container: HTMLElement, handlers: InventoryHandlers) {
    this.handlers = handlers;

    this.root = document.createElement('div');
    this.root.className = 'backpack';
    this.root.dataset.open = 'false';

    const head = document.createElement('div');
    head.className = 'backpack-head';

    const title = document.createElement('h2');
    title.className = 'backpack-title';
    title.innerHTML = '<span class="emoji">🎒</span><span>My backpack</span>';

    this.countEl = document.createElement('span');
    this.countEl.className = 'backpack-count';

    const close = document.createElement('button');
    close.className = 'shop-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close the backpack');
    close.textContent = '✕';
    close.addEventListener('click', () => {
      close.blur();
      this.close();
    });

    head.append(title, this.countEl, close);

    this.list = document.createElement('div');
    this.list.className = 'backpack-list';

    const hint = document.createElement('p');
    hint.className = 'shop-hint';
    hint.innerHTML = '<kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>E</kbd> carry it · <kbd>I</kbd> close';

    this.root.append(head, this.list, hint);
    container.append(this.root);

    this.unsubscribe = gameStore.subscribe((state) => this.render(state));
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.openDrawer();
  }

  openDrawer(): void {
    this.open = true;
    this.root.dataset.open = 'true';
    this.render(gameStore.get());
  }

  close(): void {
    this.open = false;
    this.root.dataset.open = 'false';
  }

  /** Returns true if the drawer used the key. See `ShopPanel.handleKey`. */
  handleKey(code: string): boolean {
    if (!this.open) return false;
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
        this.carrySelected();
        return true;
      // Esc and I are left to the game's `menu` / `inventory` actions — see the
      // note in `ShopPanel.handleKey`.
      default:
        return false;
    }
  }

  dispose(): void {
    this.unsubscribe();
    this.root.remove();
  }

  // -------------------------------------------------------------- internals

  private render(state: GameState): void {
    // Newest first: the thing you just bought is the thing you want to see.
    this.entries = [...state.inventory].reverse();
    this.countEl.textContent =
      this.entries.length === 1 ? '1 thing' : `${this.entries.length} things`;

    if (!this.open) return;

    this.selected = Math.min(this.selected, Math.max(0, this.entries.length - 1));
    this.list.innerHTML = '';

    if (this.entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'backpack-empty';
      empty.textContent = 'Nothing yet! There are seven shops in the big building.';
      this.list.append(empty);
      this.rows = [];
      return;
    }

    this.rows = this.entries.map((item, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'shop-row';
      row.dataset.available = 'true';
      row.dataset.selected = index === this.selected ? 'true' : 'false';
      row.dataset.carried = item.uid === state.carriedUid ? 'true' : 'false';
      row.innerHTML =
        `<span class="row-icon">${escapeHtml(item.icon)}</span>` +
        '<span class="row-text">' +
        `<span class="row-name">${escapeHtml(item.displayName)}</span>` +
        `<span class="row-blurb">${escapeHtml(whenLabel(item))}</span>` +
        '</span>' +
        `<span class="row-carry">${item.uid === state.carriedUid ? '🤲' : ''}</span>`;
      row.addEventListener('click', () => {
        row.blur();
        this.selected = index;
        this.carrySelected();
      });
      this.list.append(row);
      return row;
    });
  }

  private move(delta: number): void {
    if (this.entries.length === 0) return;
    this.selected = (this.selected + delta + this.entries.length) % this.entries.length;
    this.rows.forEach((row, index) => {
      row.dataset.selected = index === this.selected ? 'true' : 'false';
    });
    this.rows[this.selected]?.scrollIntoView({ block: 'nearest' });
  }

  private carrySelected(): void {
    const item = this.entries[this.selected];
    if (!item || !item.carryable) return;
    this.handlers.onCarry(item.uid);
  }
}

/** "day 2 · 14:35" — when a thing was bought, on the park clock. */
function whenLabel(item: InventoryItem): string {
  const minutes = Math.floor(item.acquiredAt.timeOfDay * 24 * 60);
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `bought on day ${item.acquiredAt.day + 1} at ${hh}:${mm}`;
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
