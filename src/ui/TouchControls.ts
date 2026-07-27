import type { GameAction } from '../core/input';
import type { InputSystem } from '../core/input';

/**
 * The on-screen buttons: hop. That's it.
 *
 * Only one of them, and only on a touch screen. Everything else a child needs
 * is a tap on the park itself, which is the whole idea — a thumbstick would
 * cover a quarter of a phone screen with plastic, and this game is meant to be
 * looked at. There used to be a pair of turn buttons here too, spinning the
 * view in 90° steps; the camera no longer rotates at all (GAME_DESIGN.md #16),
 * so there is nothing left for them to do.
 *
 * Zoom, which *is* continuous, is a pinch instead (see `PointerControls`).
 *
 * Every button goes through {@link InputSystem.pressVirtual}, so downstream a
 * thumb on "hop" is indistinguishable from a thumb on the space bar.
 */
export class TouchControls {
  private readonly root: HTMLElement;
  private readonly buttons: HTMLElement[] = [];

  constructor(container: HTMLElement, private readonly input: InputSystem) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';

    const hop = this.button('touch-btn touch-btn--hop', '⤴', 'Hop', 'jump');
    hop.append(hopLabel());

    this.root.append(hop);
    container.append(this.root);
  }

  /** Fades the whole cluster in or out — used to hide it while a ride is on. */
  setVisible(visible: boolean): void {
    this.root.dataset.hidden = visible ? 'false' : 'true';
  }

  dispose(): void {
    for (const button of this.buttons) button.replaceWith(button.cloneNode(true));
    this.root.remove();
  }

  private button(
    className: string,
    glyph: string,
    label: string,
    action: GameAction,
  ): HTMLElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.setAttribute('aria-label', label);

    const face = document.createElement('span');
    face.className = 'touch-glyph';
    face.textContent = glyph;
    element.append(face);

    // pointerdown, not click: a game button must answer on the way down, and
    // `click` on iOS waits to see whether a double-tap is coming.
    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      // Stops the press also counting as a tap on the park behind the button.
      event.stopPropagation();
      this.input.pressVirtual(action);
      element.dataset.pressed = 'true';
    });
    const release = (): void => {
      delete element.dataset.pressed;
    };
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('pointerleave', release);
    element.addEventListener('contextmenu', (event) => event.preventDefault());

    this.buttons.push(element);
    return element;
  }
}

function hopLabel(): HTMLElement {
  const label = document.createElement('span');
  label.className = 'touch-label';
  label.textContent = 'hop';
  return label;
}
