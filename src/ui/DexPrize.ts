import { gameStore } from '../state';
import { saveFlags } from '../state/flags';

/**
 * The Cute-o-dex completion prize.
 *
 * "Every cute thing in the whole park" is a real destination, not just a
 * number filling up — so reaching it gets a real moment: the whole screen,
 * confetti, fireworks, every cutie you ever found marching past, and a decree
 * (address to the grown-up holding the other end of the tablet) that
 * real-life sweeties are now owed. Once. The Cute-o-dex is the only thing
 * that knows *when* 100% happens (it already owns the catalogue and the
 * count), so it owns triggering this; this file only owns *what happens*
 * once triggered.
 *
 * A flag remembers "has this already fired". It used to be this file's own
 * `localStorage` key (`lgp:dexPrizeSeen`) because there was no save file to
 * put it in; it now lives in `state/flags.ts` with the other one-time things
 * and rides to disk on the autosave.
 */

/** True once the celebration has fired for this save, ever. */
export function hasSeenDexPrize(): boolean {
  return saveFlags.dexPrizeSeen;
}

/** Marks the celebration as fired, so it never auto-fires again. */
export function markDexPrizeSeen(): void {
  saveFlags.markDexPrizeSeen();
}

/** One cutie's worth of parade — just enough to draw its icon and say its name. */
export interface PrizeParadeItem {
  readonly icon: string;
  readonly displayName: string;
}

const CONFETTI_COUNT = 42;
const FIREWORK_COUNT = 7;
const CONFETTI_COLOURS = [
  '#ffb4d6',
  '#ff7fb6',
  '#b8f2d8',
  '#8fd3ff',
  '#ffe066',
  '#d7b3ff',
  '#fff3f8',
];

export class DexPrize {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly okButton: HTMLButtonElement;
  private readonly titleEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly paradeTrack: HTMLElement;
  private readonly confettiPieces: HTMLElement[] = [];
  private readonly fireworkPieces: HTMLElement[] = [];

  private open = false;
  /** True when we are the reason the park is paused — see `CuteODex.pausedByUs`. */
  private pausedByUs = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'dexprize';
    this.root.dataset.open = 'false';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'You found every cute thing!');

    const confetti = document.createElement('div');
    confetti.className = 'dexprize-confetti';
    confetti.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < CONFETTI_COUNT; i += 1) {
      const piece = document.createElement('span');
      piece.className = 'dexprize-confetti-piece';
      confetti.append(piece);
      this.confettiPieces.push(piece);
    }

    const fireworks = document.createElement('div');
    fireworks.className = 'dexprize-fireworks';
    fireworks.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < FIREWORK_COUNT; i += 1) {
      const burst = document.createElement('span');
      burst.className = 'dexprize-firework';
      fireworks.append(burst);
      this.fireworkPieces.push(burst);
    }

    const paradeStrip = document.createElement('div');
    paradeStrip.className = 'dexprize-parade';
    paradeStrip.setAttribute('aria-hidden', 'true');
    this.paradeTrack = document.createElement('div');
    this.paradeTrack.className = 'dexprize-parade-track';
    paradeStrip.append(this.paradeTrack);

    this.card = document.createElement('div');
    this.card.className = 'dexprize-card';

    this.titleEl = document.createElement('h2');
    this.titleEl.className = 'dexprize-title';
    this.titleEl.textContent = '⭐ YOU FOUND EVERY CUTE THING! ⭐';

    this.noteEl = document.createElement('p');
    this.noteEl.className = 'dexprize-note';

    this.okButton = document.createElement('button');
    this.okButton.type = 'button';
    this.okButton.className = 'dexprize-ok';
    this.okButton.textContent = 'OK! 🎉';
    this.okButton.setAttribute('aria-label', 'OK, close this');
    this.okButton.addEventListener('click', () => {
      this.okButton.blur();
      this.close();
    });

    this.card.append(this.titleEl, this.noteEl, this.okButton);
    this.root.append(confetti, fireworks, paradeStrip, this.card);
    container.append(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * Shows the celebration. Safe to call whether this is the very first time
   * (100% just reached) or a replay from the Cute-o-dex's ⭐ button — either
   * way the parade and the name are refreshed from what is true right now.
   */
  show(items: readonly PrizeParadeItem[], playerName: string): void {
    this.noteEl.innerHTML =
      `Dear Mummy or Daddy: <strong>${escapeHtml(playerName)}</strong> completed the whole ` +
      'Cute-o-dex. Please award real-life sweeties immediately. 🍬<br>' +
      '<span class="dexprize-sign">— Land of Good Places management</span>';

    this.buildParade(items);
    this.restartEffects();

    if (this.open) return;
    this.open = true;
    this.root.dataset.open = 'true';
    if (!gameStore.get().paused) {
      this.pausedByUs = true;
      gameStore.setPaused(true);
    }
    // A child (or a grown-up) can press Enter/Space the instant it appears.
    this.okButton.focus();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.dataset.open = 'false';
    if (this.pausedByUs) {
      this.pausedByUs = false;
      gameStore.setPaused(false);
    }
  }

  dispose(): void {
    this.root.remove();
  }

  // -------------------------------------------------------------- internals

  /** Lays the parade track out twice back to back, so the loop never jumps. */
  private buildParade(items: readonly PrizeParadeItem[]): void {
    this.paradeTrack.innerHTML = '';
    if (items.length === 0) return;
    for (let lap = 0; lap < 2; lap += 1) {
      for (const item of items) {
        const icon = document.createElement('span');
        icon.className = 'dexprize-parade-item';
        icon.textContent = item.icon;
        icon.title = item.displayName;
        this.paradeTrack.append(icon);
      }
    }
    // Roughly a second per cutie, so a big Cute-o-dex parades a bit longer
    // rather than whipping past unreadably fast.
    const seconds = Math.max(8, items.length * 1.1);
    this.paradeTrack.style.animationDuration = `${seconds}s`;
  }

  /** Re-randomises and restarts the confetti/fireworks so a replay looks fresh. */
  private restartEffects(): void {
    for (const piece of this.confettiPieces) {
      piece.style.setProperty('--x', `${Math.random() * 100}%`);
      piece.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 160)}`);
      piece.style.setProperty('--duration', `${(2.6 + Math.random() * 2.2).toFixed(2)}s`);
      piece.style.setProperty('--delay', `${(Math.random() * 2.6).toFixed(2)}s`);
      piece.style.backgroundColor =
        CONFETTI_COLOURS[Math.floor(Math.random() * CONFETTI_COLOURS.length)] ?? '#fff';
      restartAnimation(piece);
    }
    for (const burst of this.fireworkPieces) {
      burst.style.setProperty('--fx', `${10 + Math.random() * 80}%`);
      burst.style.setProperty('--fy', `${8 + Math.random() * 60}%`);
      burst.style.setProperty('--fc', CONFETTI_COLOURS[Math.floor(Math.random() * CONFETTI_COLOURS.length)] ?? '#fff');
      burst.style.setProperty('--fdelay', `${(Math.random() * 1.8).toFixed(2)}s`);
      burst.style.setProperty('--fduration', `${(1.3 + Math.random() * 0.9).toFixed(2)}s`);
      restartAnimation(burst);
    }
  }
}

/** Forces a CSS animation to restart from its 0% frame, even if already running. */
function restartAnimation(element: HTMLElement): void {
  element.style.animation = 'none';
  // Reading a layout property flushes the style change before it is undone.
  void element.offsetHeight;
  element.style.animation = '';
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
