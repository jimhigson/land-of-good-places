import whatsnewData from '../../whatsnew.json';
import { gameStore } from '../state';

/**
 * The "what's new" welcome panel.
 *
 * `whatsnew.json` (repo root) is a curated, kid-friendly changelog — one entry
 * per feature a player would actually notice. This panel compares the newest
 * entry's id against `lastSeenWhatsNewId` in `localStorage`:
 *
 * - **First-ever visit** (nothing stored yet): a short welcome, plus only the
 *   **3 newest** entries — a returning six-year-old does not want to read the
 *   whole history of the park on day one, just a taste of what is here.
 * - **Returning visit with unseen entries**: "✨ While you were away…" and
 *   every entry newer than what they last saw.
 * - **Nothing unseen**: the panel never appears. Most loads take this path,
 *   which is why the check has to be free — see {@link maybeShow}.
 *
 * Built exactly like `CuteODex`: a self-mounting overlay that pauses the game
 * itself (guarded by `pausedByUs`, never stealing a pause a grown-up already
 * asked for) and is closed from `Game.tick()`'s existing `menu`/`cancel`/
 * `interact` actions, the same way `CuteODex.isOpen` already works — no new
 * key-handling plumbing needed. The OK button and a tap on the dimmed
 * backdrop close it too, for fingers with no keyboard.
 */

export interface WhatsNewEntry {
  readonly id: number;
  readonly emoji: string;
  readonly title: string;
  readonly line: string;
}

/** How many of the newest entries a brand-new player is shown, not the lot. */
const WELCOME_ENTRY_COUNT = 3;

const STORAGE_KEY = 'lgp:lastSeenWhatsNewId';

/** Newest first, however the file happens to be ordered. */
const ENTRIES: readonly WhatsNewEntry[] = [...whatsnewData.entries].sort((a, b) => b.id - a.id);

const NEWEST_ID = ENTRIES[0]?.id ?? 0;

export class WhatsNew {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly greetingEl: HTMLElement;
  private readonly list: HTMLElement;
  private readonly okButton: HTMLButtonElement;

  private open = false;
  /** True when we are the reason the park is paused — see `CuteODex`. */
  private pausedByUs = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'whatsnew';
    this.root.dataset.open = 'false';

    this.card = document.createElement('div');
    this.card.className = 'whatsnew-card';

    const head = document.createElement('div');
    head.className = 'shop-head whatsnew-head';

    const glyph = document.createElement('span');
    glyph.className = 'shop-glyph';
    glyph.textContent = '✨';

    const titles = document.createElement('div');
    titles.className = 'shop-titles';
    this.titleEl = document.createElement('h2');
    this.titleEl.className = 'shop-title';
    this.greetingEl = document.createElement('p');
    this.greetingEl.className = 'shop-greeting';
    titles.append(this.titleEl, this.greetingEl);

    head.append(glyph, titles);

    this.list = document.createElement('div');
    this.list.className = 'whatsnew-list';

    this.okButton = document.createElement('button');
    this.okButton.type = 'button';
    this.okButton.className = 'shop-buy whatsnew-ok';
    this.okButton.innerHTML = '<span class="emoji">👍</span><span>OK, let’s go!</span>';
    this.okButton.addEventListener('click', () => {
      this.okButton.blur();
      this.close();
    });

    const footer = document.createElement('div');
    footer.className = 'shop-foot';
    footer.append(this.okButton);

    this.card.append(head, this.list, footer);
    this.root.append(this.card);

    // Tapping the dimmed area outside the card closes it too, same as the shop
    // and the backpack — and stops that tap reaching the canvas underneath.
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.close();
    });

    container.append(this.root);

    // Checking storage is synchronous and cheap; doing it here (rather than
    // waiting to be told) means the panel can never delay the first frame —
    // the world builds and renders underneath exactly as it would without it.
    this.maybeShow();
  }

  get isOpen(): boolean {
    return this.open;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.dataset.open = 'false';
    if (this.pausedByUs) {
      this.pausedByUs = false;
      gameStore.setPaused(false);
    }
    // Every close path — OK button, backdrop tap, Esc/E/Enter from Game.tick()
    // — ends up here, so the newest id is always the one that gets remembered.
    writeLastSeenId(NEWEST_ID);
  }

  dispose(): void {
    this.root.remove();
  }

  // -------------------------------------------------------------- internals

  private maybeShow(): void {
    if (ENTRIES.length === 0) return;

    const stored = readLastSeenId();
    const firstVisit = stored === null;
    const lastSeen = stored ?? 0;
    const unseen = ENTRIES.filter((entry) => entry.id > lastSeen);

    if (firstVisit) {
      this.show(
        'Welcome to Land of Good Places!',
        // The standard credit line (see README.md / index.html / vite.config.ts's
        // manifest description) — kept in sync by hand rather than imported, since
        // it is one string and pulling in a whole shared-constants module for it
        // would be a bigger dependency than the thing it replaces.
        'By Eleri age 6, and Jim age 44 — here’s a few things to try:',
        ENTRIES.slice(0, WELCOME_ENTRY_COUNT),
      );
      return;
    }

    if (unseen.length > 0) {
      this.show('✨ While you were away…', 'The park grew a little!', unseen);
    }
    // Nothing unseen: say nothing, show nothing. Most loads end here.
  }

  private show(title: string, greeting: string, entries: readonly WhatsNewEntry[]): void {
    this.titleEl.textContent = title;
    this.greetingEl.textContent = greeting;

    this.list.innerHTML = '';
    for (const entry of entries) this.list.append(this.buildRow(entry));

    this.open = true;
    this.root.dataset.open = 'true';

    // Never steal a pause a grown-up already asked for — only ever restore one
    // we ourselves put in place, exactly like the Cute-o-dex and the shops.
    if (!gameStore.get().paused) {
      this.pausedByUs = true;
      gameStore.setPaused(true);
    }
  }

  private buildRow(entry: WhatsNewEntry): HTMLElement {
    const row = document.createElement('div');
    row.className = 'whatsnew-row';
    row.innerHTML =
      `<span class="row-icon">${escapeHtml(entry.emoji)}</span>` +
      '<span class="row-text">' +
      `<span class="row-name">${escapeHtml(entry.title)}</span>` +
      `<span class="row-blurb">${escapeHtml(entry.line)}</span>` +
      '</span>';
    return row;
  }
}

/** `null` on a first-ever visit, or if storage is unavailable (private mode). */
function readLastSeenId(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    // Safari private mode throws on *access*, not just on write.
    return null;
  }
}

function writeLastSeenId(id: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    // Nothing we can do about a full or disabled store — worst case the
    // welcome panel shows again next time, which is a fine failure mode.
  }
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
