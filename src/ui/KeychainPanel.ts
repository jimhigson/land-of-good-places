import type { ShopItem } from '../world/building/shops/catalogue';
import { CharacterPreview, type PreviewChoice } from './characterCreationPreview';
import { shopWords } from '../state/wording';

/**
 * The keychain stall's collect/swap picker.
 *
 * **This is the character-creation screen with one choice on it** —
 * `ui/FacePaintPanel.ts`'s own opening line, and true again here: GAME_DESIGN.md's
 * PREVIEW RULE ("every screen that changes how the character looks is the
 * character-creation screen, with fewer choices… the same component and the
 * same code") is what this panel *is*, deliberately built as a close copy of
 * that file rather than a fresh design. The live 3D model is
 * {@link CharacterPreview}, the same class the creator and the face-paint stall
 * both use, wearing the player's real hair, skin, clothes and bag; the layout
 * classes (`.charcreate-body` / `.charcreate-preview` / `.charcreate-controls`)
 * are the creator's own.
 *
 * It differs from the face-paint picker in the one way its own thing differs:
 * the camera **turns to show the back of the bag** (`framing: 'backpack'`)
 * rather than resting on the face — the turntable trick `characterCreationPreview.ts`
 * already built for the character creator's own Backpack tab, reused rather
 * than re-invented (`BACK_TURN`/`backShow`).
 *
 * What is genuinely new here, and what a design-picker did not need: a
 * keychain can be **owned or not**, tapping an unowned one is how it becomes
 * owned (a keychain is collected, never bought — `price: 0` on every catalogue
 * entry), and a row remembers which of the five is currently on the bag. A
 * design has none of that — every design is always available, and nothing is
 * ever "owned".
 */

export interface KeychainPanelHandlers {
  /**
   * A charm was tapped. Fires for both an unowned charm (collect it, then
   * wear it — the natural "yay, got one, and it's on my bag!" beat) and an
   * owned one that is not the one currently worn (just wear it). The panel
   * does not know or care which; it only announces which id was pressed.
   */
  onPick(id: string): void;
  /** "Take it off" — leaves the bag bare. */
  onTakeOff(): void;
  onClose(): void;
}

/**
 * How the player currently looks, minus the keychain — everything the
 * preview needs to show *her*, the same shape `FacePaintLook` is for the face
 * paint stall.
 */
export type KeychainLook = Omit<PreviewChoice, 'keychainId'>;

export class KeychainPanel {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly previewWrap: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly takeOffButton: HTMLButtonElement;

  private readonly handlers: KeychainPanelHandlers;
  private items: readonly ShopItem[] = [];
  private rows: HTMLButtonElement[] = [];
  private selected = 0;
  private open = false;

  /**
   * Built on first open, not in the constructor — same reasoning as
   * `FacePaintPanel.preview`: the stall is built with the park and may never
   * be opened, and a `CharacterPreview` is a whole second WebGL context.
   */
  private preview: CharacterPreview | null = null;
  private resizeObserver: ResizeObserver | null = null;
  /** The player's look as of the last {@link openWith}. */
  private look: KeychainLook | null = null;
  /** Ids currently owned, as of the last {@link openWith}/{@link setOwnership}. */
  private owned = new Set<string>();
  /** Catalogue id currently worn, `''` for none — same sentinel as `PreviewChoice.keychainId`. */
  private wornId = '';

  constructor(container: HTMLElement, handlers: KeychainPanelHandlers) {
    this.handlers = handlers;

    // `shop-panel`/`shop-card` for the same free full-screen backdrop,
    // open/close transition and centring every other panel gets.
    this.root = document.createElement('div');
    this.root.className = 'keychain-panel shop-panel';
    this.root.dataset.open = 'false';

    this.card = document.createElement('div');
    this.card.className = 'keychain-card shop-card';

    // No `.shop-head` — same ruling `FacePaintPanel` records: the character
    // creator dropped its own title band (28 July 2026), and a big picture of
    // her own bag with five charms under it needs announcing even less.
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Keychains');

    const close = document.createElement('button');
    close.className = 'keychain-close facepaint-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close keychains');
    close.textContent = '✕';
    close.addEventListener('click', () => {
      close.blur();
      this.handlers.onClose();
    });

    const body = document.createElement('div');
    body.className = 'charcreate-body';

    this.previewWrap = document.createElement('div');
    this.previewWrap.className = 'charcreate-preview';

    const controls = document.createElement('div');
    controls.className = 'charcreate-controls';

    this.grid = document.createElement('div');
    this.grid.className = 'keychain-grid facepaint-grid';
    controls.append(this.grid);

    body.append(this.previewWrap, controls);

    const footer = document.createElement('div');
    footer.className = 'shop-foot';
    this.takeOffButton = document.createElement('button');
    this.takeOffButton.type = 'button';
    this.takeOffButton.className = 'keychain-takeoff facepaint-washoff';
    this.takeOffButton.innerHTML = '<span class="emoji">🎒</span><span>Take it off</span>';
    this.takeOffButton.addEventListener('click', () => {
      this.takeOffButton.blur();
      this.handlers.onTakeOff();
    });
    // Hovering "Take it off" previews a bare bag, the same "what you would
    // get" courtesy hovering a charm gives.
    this.takeOffButton.addEventListener('mouseenter', () => this.showKeychain(null));
    this.takeOffButton.addEventListener('mouseleave', () => this.showSelected());
    const hint = document.createElement('p');
    hint.className = 'shop-hint';
    hint.innerHTML =
      '<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> choose · <kbd>E</kbd> pick · <kbd>Esc</kbd> close · or just tap!';
    footer.append(this.takeOffButton, hint);

    this.card.append(close, body, footer);
    this.root.append(this.card);
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.handlers.onClose();
    });
    container.append(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * Opens the picker: `items` is the fixed catalogue (`keychainItems()`),
   * `wornId` is the currently-worn one's catalogue id (`''` for none),
   * `ownedIds` is which of the five she already has, and `look` is how she
   * otherwise looks. Everything is read fresh on every open, exactly like
   * `FacePaintPanel.openWith` — she may have collected one since her last
   * visit, or changed her hair.
   */
  openWith(
    items: readonly ShopItem[],
    wornId: string,
    ownedIds: ReadonlySet<string>,
    look: KeychainLook,
  ): void {
    this.items = items;
    this.look = look;
    this.owned = new Set(ownedIds);
    this.wornId = wornId;
    this.selected = Math.max(
      0,
      items.findIndex((item) => item.id === wornId),
    );

    this.grid.innerHTML = '';
    this.rows = items.map((item, index) => this.buildRow(item, index));
    for (const row of this.rows) this.grid.append(row);
    this.takeOffButton.disabled = wornId === '';

    this.ensurePreview().setRunning(true);
    this.applySelection();
    this.open = true;
    this.root.dataset.open = 'true';
  }

  /**
   * Tells the panel what she owns and wears now, without a full reopen — the
   * moment a collect or a swap actually lands. `FacePaintPanel.setWearing`'s
   * twin: the picker stays up after a pick, so the "Take it off" button and
   * every row's own worn/collect tag (`.row-action`, the same pill
   * `ui/InventoryDrawer.ts`'s backpack rows use) have to come alive
   * immediately rather than waiting for the next visit.
   */
  setOwnership(wornId: string, ownedIds: ReadonlySet<string>): void {
    this.owned = new Set(ownedIds);
    this.wornId = wornId;
    this.takeOffButton.disabled = wornId === '';
    this.rows.forEach((row, index) => {
      const item = this.items[index];
      if (!item) return;
      this.applyRowState(row, item);
    });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.dataset.open = 'false';
    this.preview?.setRunning(false);
  }

  /** Mirrors `FacePaintPanel.handleKey` exactly — see its own doc comment. */
  handleKey(code: string): boolean {
    if (!this.open) return false;

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
      default:
        return false;
    }
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.preview?.dispose();
    this.root.remove();
  }

  // -------------------------------------------------------------- internals

  private ensurePreview(): CharacterPreview {
    const existing = this.preview;
    if (existing) return existing;

    const preview = new CharacterPreview({ framing: 'backpack' });
    this.previewWrap.append(preview.canvas);
    this.preview = preview;

    this.resizeObserver = new ResizeObserver(() => {
      preview.resize(preview.canvas.clientWidth, preview.canvas.clientHeight);
    });
    this.resizeObserver.observe(preview.canvas);
    return preview;
  }

  /** Puts a charm (or a bare bag) on the model, without choosing it. */
  private showKeychain(id: string | null): void {
    const look = this.look;
    if (!look) return;
    this.ensurePreview().update({ ...look, keychainId: id ?? '' });
  }

  private showSelected(): void {
    this.showKeychain(this.items[this.selected]?.id ?? null);
  }

  private buildRow(item: ShopItem, index: number): HTMLButtonElement {
    const row = document.createElement('button');
    row.type = 'button';
    // `.shop-row` for the same card language and `[data-worn='true']`/
    // `[data-selected='true']` styling `ui/InventoryDrawer.ts`'s backpack
    // rows already carry; `.facepaint-row` for the picture-and-name layout
    // `ui/FacePaintPanel.ts` built; `.keychain-row` only as a hook for
    // anything genuinely different, same convention as `.facepaint-panel`.
    row.className = 'shop-row facepaint-row keychain-row';
    row.innerHTML =
      `<span class="row-icon">${item.icon}</span>` +
      `<span class="row-name">${escapeHtml(item.displayName)}</span>` +
      // `.row-action`: the same "what will pressing this do" pill
      // `InventoryDrawer.ts`'s backpack rows use — its text is set below,
      // once, from `applyRowState`, so this file is not a second place that
      // decides the wording.
      '<span class="row-action"></span>';
    this.applyRowState(row, item);
    row.addEventListener('mouseenter', () => this.showKeychain(item.id));
    row.addEventListener('mouseleave', () => this.showSelected());
    row.addEventListener('click', () => {
      row.blur();
      this.selected = index;
      this.applySelection();
      this.pickSelected();
    });
    return row;
  }

  /** Sets one row's owned/worn dataset and its `.row-action` pill text. */
  private applyRowState(row: HTMLButtonElement, item: ShopItem): void {
    const owned = this.owned.has(item.id);
    const worn = item.id === this.wornId;
    row.dataset.worn = worn ? 'true' : 'false';
    const action = row.querySelector<HTMLElement>('.row-action');
    if (action) action.textContent = worn ? 'Worn' : owned ? 'Wear' : shopWords().verb;
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
    this.showSelected();
  }

  private pickSelected(): void {
    const item = this.items[this.selected];
    if (!item) return;
    this.handlers.onPick(item.id);
  }
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
