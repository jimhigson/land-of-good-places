import { gameStore, type GameState } from '../state';
import { isTouchDevice } from '../core/device';

/**
 * The on-screen overlay: park name, clock, purse, and the control hints.
 *
 * Plain DOM on top of the canvas rather than in-world geometry — it is crisp at
 * every resolution, costs nothing to render, and a six-year-old's tablet can
 * still read it. Styling lives in `src/style.css`.
 *
 * The HUD is a *subscriber*: it never reaches into game systems, it just reacts
 * to the store. Per-frame values that are too noisy for the store (the clock
 * face, the FPS counter) come in through {@link setClock} and {@link setFps}.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly parkPill: HTMLElement;
  private readonly clockPill: HTMLElement;
  private readonly moneyPill: HTMLElement;
  private readonly padPill: HTMLElement;
  private readonly debugPill: HTMLElement;

  private readonly unsubscribe: () => void;
  private clockText = '--:--';
  private dayText = '';
  private fps = 60;

  constructor(container: HTMLElement) {
    this.root = container;
    this.root.innerHTML = '';

    const top = document.createElement('div');
    top.className = 'hud-row';

    this.parkPill = pill('pill pill--park');
    this.clockPill = pill('pill pill--clock');
    this.moneyPill = pill('pill pill--money');
    top.append(this.parkPill, this.clockPill, this.moneyPill);

    const bottom = document.createElement('div');
    bottom.className = 'hud-row bottom';

    const hints = document.createElement('div');
    hints.className = 'hint-stack';

    // Two versions of the same hint. A phone player has no keys to press, and
    // being told about WASD is how a six-year-old decides the game is broken.
    const keyHint = pill('pill pill--soft');
    keyHint.innerHTML = isTouchDevice()
      ? '<span class="emoji">👆</span>' +
        '<span><b>Tap</b> where to walk · tap a thing to use it · ' +
        '<b>hop</b> &amp; <b>turn</b> buttons · <b>pinch</b> to zoom</span>'
      : '<span class="emoji">🕹️</span>' +
        '<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to walk · ' +
        '<kbd>Shift</kbd> run · <kbd>Space</kbd> hop · <kbd>Q</kbd>/<kbd>R</kbd> turn view · ' +
        '<kbd>+</kbd>/<kbd>−</kbd> zoom · or just <b>click</b> where to go</span>';

    this.padPill = pill('pill pill--pad');
    this.padPill.dataset.connected = 'false';
    this.padPill.innerHTML =
      '<span class="emoji">🎮</span><span>Controller connected — left stick to walk!</span>';

    hints.append(keyHint, this.padPill);

    this.debugPill = pill('pill pill--soft');
    this.debugPill.style.display = 'none';

    bottom.append(hints, this.debugPill);
    this.root.append(top, bottom);

    this.unsubscribe = gameStore.subscribe((state) => this.render(state));
  }

  /** Called every frame with the in-game time, e.g. "14:35". */
  setClock(text: string, dayCount: number): void {
    if (text === this.clockText && this.dayText === dayLabel(dayCount)) return;
    this.clockText = text;
    this.dayText = dayLabel(dayCount);
    this.render(gameStore.get());
  }

  setFps(fps: number): void {
    this.fps = fps;
  }

  /** Shows or hides the controller hint. */
  setGamepadConnected(connected: boolean): void {
    const value = connected ? 'true' : 'false';
    if (this.padPill.dataset.connected !== value) this.padPill.dataset.connected = value;
  }

  /** Refreshes the debug line. Cheap enough to call every frame when visible. */
  updateDebug(lines: readonly string[]): void {
    if (!gameStore.get().debugOverlay) {
      if (this.debugPill.style.display !== 'none') this.debugPill.style.display = 'none';
      return;
    }
    this.debugPill.style.display = '';
    this.debugPill.textContent = `${this.fps.toFixed(0)} fps · ${lines.join(' · ')}`;
  }

  dispose(): void {
    this.unsubscribe();
    this.root.innerHTML = '';
  }

  private render(state: GameState): void {
    this.parkPill.innerHTML = `<span class="emoji">🎠</span><span>${escapeHtml(state.parkName)}</span>`;

    const icon = state.world.lightsOn ? '🌙' : '☀️';
    this.clockPill.innerHTML =
      `<span class="emoji">${icon}</span><span>${this.clockText}${this.dayText}</span>`;

    // In normal mode the purse never runs out — say so, rather than showing a
    // number that never changes.
    const money =
      state.mode === 'normal'
        ? '<span class="emoji">💰</span><span>Lots!</span>'
        : `<span class="emoji">💰</span><span>${state.money}</span>`;
    this.moneyPill.innerHTML = money;
  }
}

function pill(className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

function dayLabel(dayCount: number): string {
  return dayCount > 0 ? ` · day ${dayCount + 1}` : '';
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
