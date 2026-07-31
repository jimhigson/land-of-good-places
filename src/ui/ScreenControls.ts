import { isTouchDevice } from '../core/device';
import type { GameAction } from '../core/input';
import type { InputSystem } from '../core/input';

/**
 * The on-screen buttons in the bottom-right corner: **hop**, and — once there
 * is a jet pack on her back and she is outdoors — **up** and **down**.
 *
 * ## Why this is not called `TouchControls` any more
 *
 * It was, and it was only ever built on a touch screen, because the one button
 * it had (hop) has a key on a keyboard and a thumb has nothing else to press. A
 * thumbstick would cover a quarter of a phone screen with plastic, and this game
 * is meant to be looked at; walking is a tap on the park itself.
 *
 * Then the jet pack landed and Jim played it on a desktop: *"there's no way to
 * see or use flight there beyond knowing to press G/R blind."* He is right, and
 * it is the same complaint the game answers everywhere else — an invisible
 * control is not a control. So the cluster now mounts on **every** device, and
 * each button decides for itself whether it belongs:
 *
 * - **hop** is touch-only, because the space bar is right there and a mouse
 *   button for it would be clutter a desktop player never asked for;
 * - **up** and **down** are on both, because until now they existed only as two
 *   letters nobody had been told about.
 *
 * ## The buttons are wired two different ways, on purpose
 *
 * **Hop** is an *edge*: {@link InputSystem.pressVirtual}, a two-frame pulse, so
 * downstream a thumb on hop is indistinguishable from a thumb on the space bar
 * and a lost `pointerup` cannot leave a child hopping forever.
 *
 * **Up** and **down** are *states*: {@link InputSystem.holdVirtual}, latched for
 * exactly as long as the button is held. Eleri's rule, in one line — *tap it and
 * you take off, hold it and you go up, let go and you come gently down* — needs
 * a held button, not a pulse.
 *
 * ## Why there is a down button at all
 *
 * Because "let go and you come down" is, as a *control*, invisible: the way to
 * descend was to stop doing something, which is the least discoverable
 * instruction there is and is Jim's complaint in another form. So **down** is a
 * real control that does a real thing — hold it and she drops about twice as
 * briskly as she would on her own — and letting go of everything still floats
 * her gently down exactly as it always did. Nothing a child has already learned
 * changes; there is simply now a button for the thing that used to be an
 * absence.
 *
 * They are stacked rather than side by side, with **up above down**, because
 * the button that is higher on the screen taking you higher is a thing a
 * six-year-old reads without being told.
 *
 * ## What decides whether they are there
 *
 * {@link setFlyControls}, called every frame from `Game`. Both facts are read
 * from one place each and neither is re-derived here: `Player.canFlyHere` —
 * itself "a pack is worn *and* there is room here to fly", see
 * `entities/Player.ts` — and `Player.isFlying`. A button that does nothing is
 * worse than no button: it promises a six-year-old something and then does not
 * deliver.
 */
export class ScreenControls {
  private readonly root: HTMLElement;
  private readonly buttons: HTMLElement[] = [];
  /** Up and down together, so one `hidden` shows or hides the pair. */
  private readonly flyStack: HTMLElement;
  private readonly flyDown: HTMLButtonElement;

  private flyAvailable = false;
  private descendEnabled = false;

  constructor(container: HTMLElement, private readonly input: InputSystem) {
    this.root = document.createElement('div');
    this.root.className = 'screen-controls';

    // The fly pair first in the DOM so it sits to the *left* of hop: the hop
    // button has been under that thumb since the game had one button, and
    // moving it now would be a change to a control a child already knows.
    this.flyStack = document.createElement('div');
    this.flyStack.className = 'screen-fly';
    this.flyStack.hidden = true;

    const up = this.button('screen-btn screen-btn--fly-up', '🚀', 'Fly up', 'fly', true);
    up.append(label('up'));

    this.flyDown = this.button('screen-btn screen-btn--fly-down', '⬇', 'Fly down', 'flyDown', true);
    this.flyDown.append(label('down'));
    // Nothing to come down from until she is actually up. `disabled` rather
    // than dimmed-but-live: the global HIGHLIGHT rule already skips
    // `:disabled`, so it neither glows a promise nor can latch a hold.
    this.flyDown.disabled = true;

    this.flyStack.append(up, this.flyDown);
    this.root.append(this.flyStack);

    // Touch only — see the header.
    if (isTouchDevice()) {
      const hop = this.button('screen-btn screen-btn--hop', '⤴', 'Hop', 'jump', false);
      hop.append(label('hop'));
      this.root.append(hop);
    }

    container.append(this.root);
  }

  /**
   * Shows or hides the up/down pair, and says whether down has anything to do.
   *
   * @param available a jet pack is worn *and* there is room here to fly.
   * @param canDescend she is off the ground, so "down" means something.
   */
  setFlyControls(available: boolean, canDescend: boolean): void {
    if (available !== this.flyAvailable) {
      this.flyAvailable = available;
      this.flyStack.hidden = !available;
      // Taking the pack off — or stepping through the castle door — with a
      // finger still down must not leave the thrust latched on.
      if (!available) {
        this.input.holdVirtual('fly', false);
        this.input.holdVirtual('flyDown', false);
        for (const button of this.buttons) delete button.dataset.pressed;
      }
    }

    if (canDescend === this.descendEnabled) return;
    this.descendEnabled = canDescend;
    this.flyDown.disabled = !canDescend;
    // A button disabled under a finger never gets its own `pointerup`.
    if (!canDescend) {
      this.input.holdVirtual('flyDown', false);
      delete this.flyDown.dataset.pressed;
    }
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

  private button(
    className: string,
    glyph: string,
    label: string,
    action: GameAction,
    held: boolean,
  ): HTMLButtonElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.setAttribute('aria-label', label);

    const face = document.createElement('span');
    face.className = 'screen-glyph';
    face.textContent = glyph;
    element.append(face);

    // pointerdown, not click: a game button must answer on the way down, and
    // `click` on iOS waits to see whether a double-tap is coming. It is also
    // the only event that gives a *mouse* a press-and-hold at all, which is
    // the whole of how the two fly buttons work.
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
