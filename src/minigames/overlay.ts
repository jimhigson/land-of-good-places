/**
 * The mini-game DOM layer: the hold control, the quit button, and a container
 * the running game fills with its own HUD.
 *
 * Why the whole screen is the button: a mini-game here is one-button by design,
 * and on a phone the most reliable button a small hand can find is "anywhere".
 * The layer therefore swallows pointer events for as long as a game is running
 * — which also has the happy side effect of covering the park's own touch
 * controls, so a thumb reaching for the hop pad presses the go button instead
 * of hopping in a park nobody can see.
 *
 * Everything here is created by this module. It deliberately does not touch
 * `src/ui/` or `src/style.css`, so a mini-game can be added without editing a
 * single line the park owns.
 */

const STYLE_ID = 'lgp-minigame-styles';

const STYLES = `
/* While a mini-game is on, the park's own HUD fades away. Done from here with
   a data attribute and one rule rather than by reaching into ui/Hud.ts: the
   framework must be addable without the park's UI knowing it exists. */
body[data-minigame='true'] .hud-row,
body[data-minigame='true'] .hud-bar,
body[data-minigame='true'] .touch-controls {
  opacity: 0;
  /* visibility as well as opacity: several of the park's pills set
     pointer-events: auto on themselves, which beats the none below and leaves
     an invisible button sitting over the mini-game happily taking taps. A
     hidden element is not hit-tested at all. Held until the fade finishes on
     the way out, dropped instantly on the way back in. */
  visibility: hidden;
  pointer-events: none;
  transition: opacity 200ms ease, visibility 0s linear 200ms;
}

.mg-layer {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  font-family: var(--lgp-font, 'Trebuchet MS', sans-serif);
  color: var(--lgp-ink, #4a3a52);
  opacity: 0;
  transition: opacity 180ms ease;
}
.mg-layer[data-shown='true'] { opacity: 1; }
.mg-layer[data-shown='false'] { pointer-events: none; }

.mg-content {
  position: absolute;
  inset: 0;
  padding: calc(0.875rem + env(safe-area-inset-top)) calc(0.875rem + env(safe-area-inset-right))
    calc(0.875rem + env(safe-area-inset-bottom)) calc(0.875rem + env(safe-area-inset-left));
  pointer-events: none;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.mg-quit {
  position: absolute;
  top: calc(0.75rem + env(safe-area-inset-top));
  right: calc(0.75rem + env(safe-area-inset-right));
  width: 2.75rem;
  height: 2.75rem;
  border: none;
  border-radius: 50%;
  background: #fff6ea;
  box-shadow: 0 0.25rem 0 rgba(74, 58, 82, 0.2);
  color: #4a3a52;
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1;
  pointer-events: auto;
  cursor: pointer;
  z-index: 3;
}
.mg-quit:active { transform: translateY(0.1875rem); box-shadow: 0 0.0625rem 0 rgba(74, 58, 82, 0.2); }

/* The hold pad is a picture of the control, not the control itself — the whole
   layer is the button, so this must never eat the press. */
.mg-hold {
  position: absolute;
  left: 50%;
  bottom: calc(1.125rem + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 1.25rem;
  border-radius: 999px;
  background: #fff6eae6;
  box-shadow: 0 0.3125rem 0 rgba(74, 58, 82, 0.18);
  font-size: 1.0625rem;
  font-weight: 700;
  transition: transform 90ms ease, background 120ms ease;
  z-index: 2;
}
.mg-hold[data-held='true'] {
  transform: translateX(-50%) translateY(0.25rem) scale(0.98);
  background: #ffe3f1f2;
}
.mg-hold[data-hidden='true'] { opacity: 0; }
.mg-hold .mg-hold-dot {
  width: 1.375rem;
  height: 1.375rem;
  border-radius: 50%;
  background: #ff7fb6;
  box-shadow: inset 0 -0.1875rem 0 rgba(74, 58, 82, 0.18);
}
.mg-hold[data-held='true'] .mg-hold-dot { background: #7fe3c0; }

/* ------------------------------------------------------------ race HUD bits */

.mg-toprow { display: flex; gap: 0.5rem; align-items: flex-start; }

.mg-pill {
  padding: 0.4375rem 0.9375rem;
  border-radius: 999px;
  background: #fff6eae6;
  box-shadow: 0 0.25rem 0 rgba(74, 58, 82, 0.16);
  font-size: var(--lgp-text-min);
  font-weight: 700;
  white-space: nowrap;
}
.mg-pill b { font-size: 1.1875rem; }

.mg-track {
  position: relative;
  height: 0.75rem;
  margin-top: 0.25rem;
  border-radius: 999px;
  background: #fff6eacc;
  box-shadow: inset 0 0.125rem 0 rgba(74, 58, 82, 0.12);
  flex: 1 1 auto;
  min-width: 7.5rem;
  align-self: center;
}
.mg-track .mg-pip {
  position: absolute;
  top: -0.25rem;
  width: 1.25rem;
  height: 1.25rem;
  margin-left: -0.625rem;
  border-radius: 50%;
  box-shadow: 0 0.125rem 0 rgba(74, 58, 82, 0.2);
  transition: left 90ms linear;
}
.mg-track .mg-pip[data-you='true'] { width: 1.5rem; height: 1.5rem; top: -0.375rem; margin-left: -0.75rem; }

.mg-centre {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  pointer-events: none;
  text-align: center;
}

.mg-card {
  padding: 1.125rem 1.875rem;
  border-radius: 1.625rem;
  background: #fff6eaf2;
  box-shadow: 0 0.5rem 0 rgba(74, 58, 82, 0.18);
  animation: mg-pop 260ms cubic-bezier(0.25, 1.4, 0.5, 1) both;
}
.mg-card h2 { margin: 0 0 0.25rem; font-size: 1.875rem; }
.mg-card p { margin: 0.1875rem 0; font-size: 1.0625rem; opacity: 0.85; }
.mg-card .mg-sub { font-size: var(--lgp-text-min); opacity: 0.7; }

.mg-count {
  font-size: 6rem;
  font-weight: 800;
  color: #fff6ea;
  text-shadow: 0 0.375rem 0 rgba(74, 58, 82, 0.25);
  animation: mg-pop 300ms cubic-bezier(0.25, 1.4, 0.5, 1) both;
}

.mg-shout {
  padding: 0.625rem 1.5rem;
  border-radius: 999px;
  background: #ffd166;
  box-shadow: 0 0.3125rem 0 rgba(74, 58, 82, 0.2);
  font-size: 1.375rem;
  font-weight: 800;
  animation: mg-pop 240ms cubic-bezier(0.25, 1.4, 0.5, 1) both;
}

@keyframes mg-pop {
  from { transform: scale(0.7); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .mg-card, .mg-count, .mg-shout { animation: none; }
}
`;

/** Adds the stylesheet once per document. */
export function ensureMiniGameStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.append(style);
}

/**
 * The framework's screen layer.
 *
 * Owns the pointer half of the "hold" control and hands the running game an
 * empty element to hang its HUD on.
 */
export class MiniGameOverlay {
  readonly root: HTMLElement;
  readonly content: HTMLElement;

  private readonly hold: HTMLElement;
  private readonly holdText: HTMLElement;
  private readonly quitButton: HTMLButtonElement;

  private pointerHeld = false;
  private quitRequested = false;

  constructor(container: HTMLElement) {
    ensureMiniGameStyles();

    this.root = document.createElement('div');
    this.root.className = 'mg-layer';
    this.root.dataset.shown = 'false';

    this.content = document.createElement('div');
    this.content.className = 'mg-content';

    this.hold = document.createElement('div');
    this.hold.className = 'mg-hold';
    const dot = document.createElement('span');
    dot.className = 'mg-hold-dot';
    this.holdText = document.createElement('span');
    this.holdText.textContent = 'HOLD to go!';
    this.hold.append(dot, this.holdText);

    this.quitButton = document.createElement('button');
    this.quitButton.type = 'button';
    this.quitButton.className = 'mg-quit';
    this.quitButton.textContent = '✕';
    this.quitButton.setAttribute('aria-label', 'Back to the park');

    this.root.append(this.content, this.hold, this.quitButton);
    container.append(this.root);

    // pointerdown/up rather than click: a game button has to answer on the way
    // down, and this one has to keep answering all the way until it is let go.
    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('pointerup', this.onPointerUp);
    this.root.addEventListener('pointercancel', this.onPointerUp);
    this.root.addEventListener('pointerleave', this.onPointerUp);
    this.root.addEventListener('contextmenu', preventDefault);
    this.quitButton.addEventListener('pointerdown', this.onQuit);
  }

  /** True while a finger or mouse button is down anywhere on the layer. */
  get held(): boolean {
    return this.pointerHeld;
  }

  /** One-shot: true once after the ✕ is pressed, then cleared. */
  takeQuitRequest(): boolean {
    const requested = this.quitRequested;
    this.quitRequested = false;
    return requested;
  }

  /** Shows or hides the whole layer. Hidden means it stops eating taps too. */
  setShown(shown: boolean): void {
    this.root.dataset.shown = shown ? 'true' : 'false';
    // Fades the park's HUD and touch buttons out from underneath us — see the
    // rule at the top of the stylesheet.
    if (shown) document.body.dataset.minigame = 'true';
    else delete document.body.dataset.minigame;
    if (!shown) {
      this.pointerHeld = false;
      this.hold.dataset.held = 'false';
    }
  }

  /** Lights the hold pad up while the go button is down. */
  setHeld(held: boolean): void {
    this.hold.dataset.held = held ? 'true' : 'false';
  }

  /** Swaps the prompt: keyboard players get told about Space. */
  setHoldLabel(text: string): void {
    this.holdText.textContent = text;
  }

  setHoldVisible(visible: boolean): void {
    this.hold.dataset.hidden = visible ? 'false' : 'true';
  }

  /** Empties the game's HUD container, ready for the next visit. */
  clearContent(): void {
    this.content.replaceChildren();
  }

  dispose(): void {
    delete document.body.dataset.minigame;
    this.root.removeEventListener('pointerdown', this.onPointerDown);
    this.root.removeEventListener('pointerup', this.onPointerUp);
    this.root.removeEventListener('pointercancel', this.onPointerUp);
    this.root.removeEventListener('pointerleave', this.onPointerUp);
    this.root.removeEventListener('contextmenu', preventDefault);
    this.quitButton.removeEventListener('pointerdown', this.onQuit);
    this.root.remove();
  }

  // -------------------------------------------------------------- handlers

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    this.pointerHeld = true;
    try {
      this.root.setPointerCapture(event.pointerId);
    } catch {
      // The pointer has already gone — losing the capture is harmless.
    }
  };

  private readonly onPointerUp = (): void => {
    this.pointerHeld = false;
  };

  private readonly onQuit = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.quitRequested = true;
  };
}

function preventDefault(event: Event): void {
  event.preventDefault();
}
