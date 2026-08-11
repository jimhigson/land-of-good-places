import { isTouchDevice } from '../core/device';
import type { InputSystem } from '../core/input';

/**
 * The on-screen **hop** button in the bottom-right corner — and, once there is
 * a jet pack on her back and she is outdoors, the fly button too. It is the
 * same button, because it is the same key on a keyboard and the same button on
 * a gamepad: {@link Player}'s "THE JET PACK" comment has the whole scheme —
 * tap to hop, hold past a beat to climb, let go for gravity to take over.
 * {@link setJetpackAvailable} just re-skins it once that becomes true, so a
 * touch player sees the same promotion a keyboard player gets from `Player`'s
 * own doc comment on `jump` — there is a second thing this button can now do.
 *
 * ## Why this is not called `TouchControls` any more
 *
 * It was, and it was only ever built on a touch screen, because the one button
 * it had (hop) has a key on a keyboard and a thumb has nothing else to press. A
 * thumbstick would cover a quarter of a phone screen with plastic, and this game
 * is meant to be looked at; walking is a tap on the park itself.
 *
 * ## Why it is a *held* virtual button, not a tapped one
 *
 * {@link InputSystem.pressVirtual} is a two-frame pulse — right for a plain
 * hop, wrong for a control that must now tell a hold from a tap. So this wires
 * through {@link InputSystem.holdVirtual} instead, latched for exactly as long
 * as the thumb is down, the same way a real key or gamepad button already
 * reports `isDown` for as long as it is physically held. `Player` reads
 * `isDown('jump')` every frame regardless of which device produced it; this is
 * what makes a touch hold and a keyboard hold indistinguishable to it.
 */
export class ScreenControls {
  private readonly root: HTMLElement;
  private readonly buttons: HTMLElement[] = [];
  private readonly hop: HTMLButtonElement | null = null;
  private readonly hopGlyph: HTMLElement | null = null;
  private readonly hopLabel: HTMLElement | null = null;

  private jetpackAvailable = false;

  private readonly input: InputSystem;

  constructor(container: HTMLElement, input: InputSystem) {
    this.input = input;
    this.root = document.createElement('div');
    this.root.className = 'screen-controls';

    // Touch only — see the header. Held, not tapped, so it can also carry the
    // jet pack's hold-to-fly: see the class doc comment.
    if (isTouchDevice()) {
      const hop = this.button('screen-btn screen-btn--hop', '⤴', 'Hop');
      const hopLabel = label('hop');
      hop.append(hopLabel);
      this.root.append(hop);
      this.hop = hop;
      this.hopGlyph = hop.querySelector<HTMLElement>('.screen-glyph');
      this.hopLabel = hopLabel;
    }

    container.append(this.root);
  }

  /**
   * Whether a jet pack is worn and there is room here to fly — the exact fact
   * `Player.canFlyHere` answers. Re-skins the hop button to say so; does not
   * change what it is bound to; it was always `jump`.
   */
  setJetpackAvailable(available: boolean): void {
    if (available === this.jetpackAvailable) return;
    this.jetpackAvailable = available;
    this.hop?.classList.toggle('screen-btn--jetpack', available);
    this.hop?.setAttribute('aria-label', available ? 'Hop, or hold to fly' : 'Hop');
    if (this.hopGlyph) this.hopGlyph.textContent = available ? '🚀' : '⤴';
    if (this.hopLabel) this.hopLabel.textContent = available ? 'hold to fly' : 'hop';
  }

  /** Fades the whole cluster in or out — used to hide it while a ride is on. */
  setVisible(visible: boolean): void {
    this.root.dataset.hidden = visible ? 'false' : 'true';
    // A cluster that fades out under a finger never delivers the `pointerup`.
    if (!visible) this.input.clearVirtualHolds();
  }

  dispose(): void {
    this.input.clearVirtualHolds();
    for (const button of this.buttons) button.replaceWith(button.cloneNode(true));
    this.root.remove();
  }

  private button(className: string, glyph: string, ariaLabel: string): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.setAttribute('aria-label', ariaLabel);

    const face = document.createElement('span');
    face.className = 'screen-glyph';
    face.textContent = glyph;
    element.append(face);

    // pointerdown, not click: a game button must answer on the way down, and
    // `click` on iOS waits to see whether a double-tap is coming. It is also
    // the only event that gives a *mouse* a press-and-hold at all, which is
    // what lets this button's hold-to-fly work at all on a touchpad.
    element.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      // Stops the press also counting as a tap on the park behind the button.
      event.stopPropagation();
      this.input.holdVirtual('jump', true);
      element.dataset.pressed = 'true';
    });
    const release = (): void => {
      delete element.dataset.pressed;
      this.input.holdVirtual('jump', false);
    };
    element.addEventListener('pointerup', release);
    element.addEventListener('pointercancel', release);
    // `pointerleave` matters far more with a mouse than with a thumb: dragging
    // off the button is how somebody lets go of it without releasing the
    // mouse, and a hold that survived that would be a stuck throttle.
    element.addEventListener('pointerleave', release);
    element.addEventListener('contextmenu', (event) => event.preventDefault());

    this.buttons.push(element);
    return element;
  }
}

function label(text: string): HTMLElement {
  const element = document.createElement('span');
  element.className = 'screen-label';
  element.textContent = text;
  return element;
}
