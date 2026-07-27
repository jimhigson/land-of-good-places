import { gameStore, wearableSlot, type GameState, type InventoryItem } from '../state';
import { shopWords } from '../state/wording';

/**
 * The backpack drawer: everything you own, newest first.
 *
 * A *subscriber*, like the rest of the HUD — it reads the store and never
 * reaches into a game system.
 *
 * ### One tap, one rule
 *
 * Every row is a single button and tapping it *uses* that thing; tapping it
 * again puts it back. What "use" means comes from the thing itself, not from
 * anything the child has to choose:
 *
 *  - a **hat** goes on your head, a **flower** goes in your hair
 *    (`gameStore.setWornHat` / `setWornFlower`, drawn by `entities/WornHat.ts`
 *    and `entities/WornFlower.ts`);
 *  - anything else you can hold goes into your **hands**
 *    (`gameStore.setCarried`).
 *
 * There is deliberately no second button, no long-press and no submenu: a
 * six-year-old should be able to put a crown on by pressing the crown. A hat is
 * *also* carryable, and wearing wins — see `wearableSlot` in `state/store.ts`
 * for why that is the right way round.
 *
 * The rows are ordinary `<button>`s, so the rainbow outline and the activation
 * flash of GAME_DESIGN.md's HIGHLIGHT RULE arrive on their own from the global
 * rule in `style.css`. Nothing in here draws a highlight, and nothing in here
 * should.
 *
 * The Cute-o-dex, the bedroom shelves and the parade (build step 5) all want
 * this same data; they should read `gameStore.get().inventory` rather than
 * anything in here.
 */
export interface InventoryHandlers {
  /** `null` empties the hands — putting a thing down is the same gesture. */
  onCarry(uid: string | null): void;
}

/**
 * What tapping a row will do, worked out once and used for the pill, the
 * label and the tap itself so the three can never describe different things.
 */
interface RowAction {
  /** `wear` covers both slots; the store call picks which. */
  readonly kind: 'wear' | 'carry' | 'none';
  /** True when the thing is currently in use, so the tap undoes it. */
  readonly active: boolean;
  /** The words on the pill: "Wear" / "Take off" / "Hold" / "Put down". */
  readonly label: string;
  /** The glyph in the trailing cell, or '' for a thing at rest. */
  readonly glyph: string;
}

function actionFor(item: InventoryItem, state: GameState): RowAction {
  const slot = wearableSlot(item.kind);
  if (slot === 'hat') {
    const active = item.uid === state.wornHatUid;
    return { kind: 'wear', active, label: active ? 'Take off' : 'Wear', glyph: active ? '🧑‍🎤' : '' };
  }
  if (slot === 'flower') {
    const active = item.uid === state.wornFlowerUid;
    return { kind: 'wear', active, label: active ? 'Take out' : 'Wear', glyph: active ? '💐' : '' };
  }
  if (item.carryable) {
    const active = item.uid === state.carriedUid;
    return { kind: 'carry', active, label: active ? 'Put down' : 'Hold', glyph: active ? '🤲' : '' };
  }
  return { kind: 'none', active: false, label: '', glyph: '' };
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
    hint.innerHTML =
      '<kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>E</kbd> wear or hold it · <kbd>I</kbd> close';

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
        this.useSelected();
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
      // A friendly illustration rather than a bare line of text — and, just
      // as importantly, one with enough presence that the drawer never
      // collapses down into a thin, see-through stub (see the note on
      // `align-content` in style.css for why that used to happen).
      const empty = document.createElement('div');
      empty.className = 'backpack-empty';
      empty.innerHTML =
        '<span class="backpack-empty-emoji" aria-hidden="true">🎒</span>' +
        '<p class="backpack-empty-title">Your backpack is empty!</p>' +
        '<p class="backpack-empty-hint">Go and find some cute things to put in it.</p>';
      this.list.append(empty);
      this.rows = [];
      return;
    }

    this.rows = this.entries.map((item, index) => {
      const action = actionFor(item, state);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'shop-row';
      // A row with nothing to do is still a row you can select and read, so it
      // is `aria-disabled` rather than `disabled`. That is also the exact
      // attribute the global HIGHLIGHT rule and `ui/TapBurst.ts` both skip, so
      // nothing promises a child a press that would do nothing.
      row.dataset.available = action.kind === 'none' ? 'false' : 'true';
      if (action.kind === 'none') row.setAttribute('aria-disabled', 'true');
      row.dataset.selected = index === this.selected ? 'true' : 'false';
      row.dataset.carried = item.uid === state.carriedUid ? 'true' : 'false';
      row.dataset.worn = action.kind === 'wear' && action.active ? 'true' : 'false';
      row.setAttribute('aria-pressed', action.active ? 'true' : 'false');
      row.setAttribute(
        'aria-label',
        action.kind === 'none'
          ? item.displayName
          : `${item.displayName} — ${action.label.toLowerCase()}`,
      );
      row.innerHTML =
        `<span class="row-icon">${escapeHtml(item.icon)}</span>` +
        '<span class="row-text">' +
        `<span class="row-name">${escapeHtml(item.displayName)}</span>` +
        `<span class="row-blurb">${escapeHtml(whenLabel(item))}</span>` +
        '</span>' +
        (action.label === ''
          ? ''
          : `<span class="row-action" aria-hidden="true">${escapeHtml(action.label)}</span>`) +
        // Only when there is something to show: an always-present cell would
        // reserve its width on every row and squeeze the names for nothing.
        (action.glyph === ''
          ? ''
          : `<span class="row-carry" aria-hidden="true">${action.glyph}</span>`);
      row.addEventListener('click', () => {
        row.blur();
        this.selected = index;
        this.useSelected();
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

  /**
   * Does whatever the selected row says it does — the single activation path,
   * shared by a tap and by the keyboard, so the two can never drift apart.
   *
   * Wearing goes straight to the store rather than out through
   * {@link InventoryHandlers}: `Shopping` has nothing to add to it (unlike
   * carrying, which it owns because `CarriedItem` hangs off the player model),
   * and a handler that only ever forwards is a hop with no purpose. Both worn
   * slots are store subscribers, so this is the whole of the wiring.
   */
  private useSelected(): void {
    const item = this.entries[this.selected];
    if (!item) return;
    const action = actionFor(item, gameStore.get());
    const slot = wearableSlot(item.kind);

    if (slot === 'hat') gameStore.setWornHat(action.active ? null : item.uid);
    else if (slot === 'flower') gameStore.setWornFlower(action.active ? null : item.uid);
    else if (action.kind === 'carry') this.handlers.onCarry(action.active ? null : item.uid);
  }
}

/**
 * "collected on day 2 at 14:35" — when a thing was got, on the park clock.
 *
 * The most-repeated bit of copy in the whole game: it is under *every* row of
 * the backpack, once per owned thing, forever. So it takes its verb from
 * `shopWords()` like the shop panel does rather than saying "bought" — which
 * would be doubly wrong here, since a picked flower was never bought at all.
 */
function whenLabel(item: InventoryItem): string {
  const minutes = Math.floor(item.acquiredAt.timeOfDay * 24 * 60);
  const hh = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${shopWords().pastLower} on day ${item.acquiredAt.day + 1} at ${hh}:${mm}`;
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
