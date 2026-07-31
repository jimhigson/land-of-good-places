import type { GameAction } from '../core/input';
import type { InputSystem } from '../core/input';

/**
 * The on-screen buttons: hop, and — once you own a jet pack — fly.
 *
 * Two of them, and only on a touch screen. Everything else a child needs is a
 * tap on the park itself, which is the whole idea — a thumbstick would cover a
 * quarter of a phone screen with plastic, and this game is meant to be looked
 * at. There used to be a pair of turn buttons here too, spinning the view in
 * 90° steps; the camera no longer rotates at all (GAME_DESIGN.md #16), so there
 * is nothing left for them to do.
 *
 * Zoom, which *is* continuous, is a pinch instead (see `PointerControls`).
 *
 * ## The two buttons are wired differently, on purpose
 *
 * **Hop** is an *edge*: {@link InputSystem.pressVirtual}, a two-frame pulse, so
 * downstream a thumb on hop is indistinguishable from a thumb on the space bar
 * and a lost `pointerup` cannot leave a child hopping forever.
 *
 * **Fly** is a *state*: {@link InputSystem.holdVirtual}, latched for exactly as
 * long as the thumb is down. Eleri's rule, in one line — *tap it and you take
 * off, hold it and you go up, let go and you come gently down*. That needs a
 * held button, not a pulse.
 *
 * ## Fly only exists when there is a jet pack on her back
 *
 * {@link setFlyAvailable} is called every frame from `Game`, off
 * `WornJetpack.isWorn`. A button that does nothing is worse than no button: it
 * promises a six-year-old something and then does not deliver.
 */
export class TouchControls {
  private readonly root: HTMLElement;
  private readonly buttons: HTMLElement[] = [];
  private readonly fly: HTMLElement;

  private flyAvailable = false;

  constructor(container: HTMLElement, private readonly input: InputSystem) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';

    // Fly first in the DOM so it sits to the *left* of hop in the row: the hop
    // button has been under that thumb since the game had one button, and
    // moving it now would be a change to a control a child already knows.
    this.fly = this.button('touch-btn touch-btn--fly', '🚀', 'Fly', 'fly', true);
    this.fly.append(label('fly'));
    this.fly.hidden = true;

    const hop = this.button('touch-btn touch-btn--hop', '⤴', 'Hop', 'jump', false);
    hop.append(label('hop'));

    this.root.append(this.fly, hop);
    container.append(this.root);
  }

  /** Shows or hides the fly button. Driven by whether a jet pack is worn. */
  setFlyAvailable(available: boolean): void {
    if (available === this.flyAvailable) return;
    this.flyAvailable = available;
    this.fly.hidden = !available;
    // Taking the jet pack off with a thumb still on the button must not leave
    // the thrust latched on.
    if (!available) this.release(this.fly, 'fly');
  }

  /** Fades the whole cluster in or out — used to hide it while a ride is on. */
  setVisible(visible: boolean): void {
    this.root.dataset.hidden = visible ? 'false' : 'true';
    // A cluster that fades out under a thumb never delivers the `pointerup`.
    if (!visible) this.input.clearVirtualHolds();
  }

  dispose(): void {
    this.input.clearVirtualHolds();
    for (const button of this.buttons) button.replaceWith(button.cloneNode(true));
    this.root.remove();
  }

  private release(element: HTMLElement, action: GameAction): void {
    delete element.dataset.pressed;
    this.input.holdVirtual(action, false);
  }

  private button(
    className: string,
    glyph: string,
    label: string,
    action: GameAction,
    held: boolean,
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
      if (held) this.input.holdVirtual(action, true);
      else this.input.pressVirtual(action);
      element.dataset.pressed = 'true';
    });
    const release = (): void => {
      delete element.dataset.pressed;
      if (held) this.input.holdVirtual(action, false);
    };
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    element.addEventListener('pointerleave', release);
    element.addEventListener('contextmenu', (event) => event.preventDefault());

    this.buttons.push(element);
    return element;
  }
}

function label(text: string): HTMLElement {
  const element = document.createElement('span');
  element.className = 'touch-label';
  element.textContent = text;
  return element;
}
