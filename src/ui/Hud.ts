import { gameStore, type GameState } from '../state';
import { isTouchDevice } from '../core/device';

/**
 * The on-screen overlay: one menu button, the things behind it, and the
 * control hints.
 *
 * Plain DOM on top of the canvas rather than in-world geometry — it is crisp at
 * every resolution, costs nothing to render, and a six-year-old's tablet can
 * still read it. Styling lives in `src/style.css`.
 *
 * The HUD is a *subscriber*: it never reaches into game systems, it just reacts
 * to the store. Per-frame values that are too noisy for the store (the FPS
 * counter) come in through {@link setFps}.
 *
 * ## The menu (GAME_DESIGN.md, "The top bar takes too much space")
 *
 * The family: *"All the buttons at the top take up too much space. Hide them
 * behind a single menu button that expands to show them. The clock icon isn't
 * even useful so remove it entirely."*
 *
 * So the top-left is now **one** button. Pressing it drops the park name, the
 * purse, the backpack, the Cute-o-dex and the map out underneath it; pressing
 * it again, pressing any of them, or touching anything else puts them away.
 * The clock is **gone** — not moved in here, deleted, along with
 * `Hud.setClock` and its call site. The day/night cycle itself is untouched;
 * `DayNight.formatClock()` survives for the debug line and for whatever wants
 * it later.
 *
 * **The menu owns no game state at all** — no pause, no input capture, no
 * `uiOpen`. That is deliberate, and it is the lesson of the backpack bug that
 * once left taps, hops and the camera dead after a panel closed: the fix there
 * was `Shopping.syncPaused` re-deriving pause from `uiOpen` every frame rather
 * than toggling it at each call site, and the same principle taken one step
 * further says a dropdown that pauses nothing cannot leave anything paused.
 * The one flag it does own, {@link menuOpen}, is written to the DOM in exactly
 * one place ({@link applyMenu}) so the button, its `aria-expanded` and the
 * panel can never disagree either.
 *
 * The panel is `visibility: hidden` when closed, not merely transparent, so
 * the pills inside it — which carry `pointer-events: auto` of their own —
 * cannot swallow a tap meant for the park.
 */
export class Hud {
  private readonly root: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly menuItems: HTMLElement;
  private readonly parkPill: HTMLElement;
  private readonly moneyPill: HTMLElement;
  private readonly padPill: HTMLElement;
  private readonly debugPill: HTMLElement;
  private readonly backpackButton: HTMLButtonElement;
  private readonly promptPill: HTMLElement;
  private readonly hintToggle: HTMLButtonElement;
  private readonly keyHint: HTMLElement;

  private readonly unsubscribe: () => void;
  private fps = 60;
  private menuOpen = false;
  private backpackHandler: (() => void) | null = null;
  private promptText: string | null = null;
  private hintOpen = false;

  constructor(container: HTMLElement) {
    this.root = container;
    this.root.innerHTML = '';

    const top = document.createElement('div');
    top.className = 'hud-bar';

    // One button, and everything else tucked behind it.
    this.menu = document.createElement('div');
    this.menu.className = 'hud-menu';
    this.menu.dataset.open = 'false';

    this.menuButton = document.createElement('button');
    this.menuButton.type = 'button';
    // A real `<button>`, so GAME_DESIGN.md's HIGHLIGHT RULE covers it for
    // nothing: the rainbow hover/focus outline and pointer cursor come from
    // the global rule in `style.css`, and the activation flash from the
    // delegated listener in `ui/TapBurst.ts`.
    this.menuButton.className = 'pill pill--menu is-new';
    this.menuButton.setAttribute('aria-controls', 'hud-menu-items');
    this.menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      // Deliberately NOT blurred, unlike the pills that open a panel: this one
      // is a toggle, and a keyboard player has to be able to press it again to
      // put the menu away. A tap leaves no visible ring — `:focus-visible`
      // only lights up for keyboard focus.
      this.setMenuOpen(!this.menuOpen);
    });
    this.menuButton.addEventListener(
      'animationend',
      () => this.menuButton.classList.remove('is-new'),
      { once: true },
    );

    // Carries `hud-row` as well as its own class so it keeps the pill spacing
    // the top row always had — and `hud-menu-items` is what `CuteODex` and
    // `ParkMap` look for when they mount their own pills, so a panel that
    // wants a pill in the menu says so by name rather than by position.
    this.menuItems = document.createElement('div');
    this.menuItems.className = 'hud-row hud-menu-items';
    this.menuItems.id = 'hud-menu-items';
    // Choosing something is also "I am done with the menu". Delegated, so the
    // pills mounted later by other panels are covered without them knowing.
    this.menuItems.addEventListener('click', () => this.setMenuOpen(false));

    this.parkPill = pill('pill pill--park');
    this.moneyPill = pill('pill pill--money');

    // The backpack is the one HUD element you can press. It is a real button so
    // that a finger, a mouse and a screen reader all get the same thing; the
    // handler is injected, because the HUD still knows nothing about the game.
    this.backpackButton = document.createElement('button');
    this.backpackButton.type = 'button';
    this.backpackButton.className = 'pill pill--backpack';
    this.backpackButton.setAttribute('aria-label', 'Open my backpack');
    this.backpackButton.addEventListener('click', () => {
      this.backpackButton.blur();
      this.backpackHandler?.();
    });

    this.menuItems.append(this.parkPill, this.moneyPill, this.backpackButton);
    this.menu.append(this.menuButton, this.menuItems);
    top.append(this.menu);
    this.applyMenu();

    const bottom = document.createElement('div');
    bottom.className = 'hud-row bottom';

    const hints = document.createElement('div');
    hints.className = 'hint-stack';

    // A small "?" pill that reveals the controls hint on demand — the hint
    // bar used to sit on screen permanently, which is a lot of real estate for
    // something you only need to read once. Same idea for both variants below.
    this.hintToggle = document.createElement('button');
    this.hintToggle.type = 'button';
    this.hintToggle.className = 'hint-toggle is-new';
    this.hintToggle.setAttribute('aria-label', 'Show controls help');
    this.hintToggle.setAttribute('aria-expanded', 'false');
    this.hintToggle.textContent = '?';
    this.hintToggle.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setHintOpen(!this.hintOpen);
    });
    // The pulse is a one-time "look at me" for a first-time player; once they
    // have noticed it (played, or opened it), it should not nag them again.
    this.hintToggle.addEventListener(
      'animationend',
      () => this.hintToggle.classList.remove('is-new'),
      { once: true },
    );

    // Two versions of the same hint. A phone player has no keys to press, and
    // being told about WASD is how a six-year-old decides the game is broken.
    this.keyHint = pill('pill pill--soft hint-panel');
    this.keyHint.dataset.open = 'false';
    this.keyHint.innerHTML = isTouchDevice()
      ? '<span class="emoji">👆</span>' +
        '<span><b>Tap</b> where to walk · tap a thing to use it · ' +
        '<b>hop</b> button · <b>pinch</b> to zoom</span>'
      : '<span class="emoji">🕹️</span>' +
        '<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to walk · ' +
        '<kbd>Shift</kbd> run · <kbd>Space</kbd> hop · ' +
        '<kbd>+</kbd>/<kbd>−</kbd> zoom · or just <b>click</b> where to go</span>';

    this.padPill = pill('pill pill--pad');
    this.padPill.dataset.connected = 'false';
    this.padPill.innerHTML =
      '<span class="emoji">🎮</span><span>Controller connected — left stick to walk!</span>';

    // "Press E to shop!" — shown only when standing at something you can use.
    this.promptPill = pill('pill pill--prompt');
    this.promptPill.dataset.show = 'false';

    hints.append(this.hintToggle, this.promptPill, this.padPill);

    this.debugPill = pill('pill pill--soft');
    this.debugPill.style.display = 'none';

    bottom.append(hints, this.debugPill);
    this.root.append(top, bottom, this.keyHint);

    // Tapping/clicking anywhere that isn't the toggle or the open panel closes
    // it — "tap elsewhere", and just as much "start playing": the very next
    // tap-to-walk on the canvas reaches this listener too, since it is not
    // stopped or prevented here.
    document.addEventListener('pointerdown', this.onOutsidePointerDown, true);

    this.unsubscribe = gameStore.subscribe((state) => this.render(state));
  }

  setFps(fps: number): void {
    this.fps = fps;
  }

  /** Who to tell when the backpack pill is pressed. */
  setBackpackHandler(handler: () => void): void {
    this.backpackHandler = handler;
  }

  /**
   * The little "you can use this" line. Pass `null` to clear it.
   *
   * Called every frame by whoever is watching the player's surroundings, so it
   * short-circuits when the text has not changed.
   */
  setPrompt(text: string | null): void {
    if (text === this.promptText) return;
    this.promptText = text;
    this.promptPill.dataset.show = text ? 'true' : 'false';
    if (text) this.promptPill.innerHTML = `<span class="emoji">✨</span><span>${escapeHtml(text)}</span>`;
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
    document.removeEventListener('pointerdown', this.onOutsidePointerDown, true);
    this.unsubscribe();
    this.root.innerHTML = '';
  }

  // -------------------------------------------------------------- internals

  /**
   * Opens or closes the menu.
   *
   * Nothing else in the game is told, because nothing else in the game needs
   * to know: the menu pauses nothing, captures no keys and blocks no taps.
   */
  private setMenuOpen(open: boolean): void {
    if (this.menuOpen === open) return;
    this.menuOpen = open;
    this.applyMenu();
  }

  /** The single place the menu's one flag reaches the DOM. */
  private applyMenu(): void {
    this.menu.dataset.open = this.menuOpen ? 'true' : 'false';
    this.menuButton.setAttribute('aria-expanded', this.menuOpen ? 'true' : 'false');
    this.menuButton.setAttribute('aria-label', this.menuOpen ? 'Close the menu' : 'Open the menu');
    this.menuButton.innerHTML =
      `<span class="emoji">${this.menuOpen ? '✕' : '☰'}</span><span>Menu</span>`;
    if (this.menuOpen) this.menuButton.classList.remove('is-new');
  }

  /** Shows or hides the controls hint panel, keeping the toggle's a11y state in step. */
  private setHintOpen(open: boolean): void {
    if (this.hintOpen === open) return;
    this.hintOpen = open;
    this.keyHint.dataset.open = open ? 'true' : 'false';
    this.hintToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.hintToggle.setAttribute('aria-label', open ? 'Hide controls help' : 'Show controls help');
    this.hintToggle.classList.remove('is-new');
  }

  private readonly onOutsidePointerDown = (event: PointerEvent): void => {
    const target = event.target as Node | null;

    if (this.hintOpen && !(target && (this.hintToggle.contains(target) || this.keyHint.contains(target)))) {
      this.setHintOpen(false);
    }

    // Same rule for the menu, and the same reason this listener does not stop
    // or prevent the event: the tap that puts the menu away is also the tap
    // that walks the character, which is what "get out of the way" means.
    if (this.menuOpen && !(target && (this.menuButton.contains(target) || this.menuItems.contains(target)))) {
      this.setMenuOpen(false);
    }
  };

  private render(state: GameState): void {
    this.parkPill.innerHTML = `<span class="emoji">🎠</span><span>${escapeHtml(state.parkName)}</span>`;

    // Money only means anything once it can run out (mayhem mode) — in normal
    // mode there is no number worth showing, so the pill is hidden entirely
    // rather than saying "Lots!".
    this.moneyPill.style.display = state.moneyIsFinite ? '' : 'none';
    if (state.moneyIsFinite) {
      this.moneyPill.innerHTML = `<span class="emoji">💰</span><span>${state.money}</span>`;
    }

    const count = state.inventory.length;
    this.backpackButton.innerHTML =
      `<span class="emoji">🎒</span><span>${count === 0 ? 'Backpack' : count}</span>`;
  }
}

function pill(className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
