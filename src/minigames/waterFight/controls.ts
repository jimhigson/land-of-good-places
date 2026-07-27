/**
 * The water fight's own reading of the keyboard and the screen.
 *
 * The mini-game framework hands every game a **one-button** input
 * (`MiniGameInput`), because one button is the only scheme that works
 * identically on a keyboard, a gamepad and a six-year-old's thumb. The rail
 * racer needs nothing more. A water fight does: you have to *walk*, and you have
 * to say *who* you are squirting.
 *
 * So this file adds exactly two channels the framework does not carry, and
 * nothing else:
 *
 * - **A walk axis** from WASD and the arrow keys.
 * - **Where the finger is**, in client pixels, plus press and release edges.
 *
 * It listens on `window` in the capture phase. The framework's overlay swallows
 * pointer events for its hold pad — it calls `preventDefault`, but never
 * `stopPropagation` — so a capture-phase listener sees every press before the
 * overlay does and neither of us has to know about the other. Nothing in
 * `minigames/` outside this folder is touched to make it work.
 *
 * `Space` is deliberately *not* read here: it arrives as `MiniGameInput.hold`
 * along with the gamepad's A button and the on-screen pad, and reading it twice
 * would fire two squirts. See the note on precedence in `WaterFight.update`.
 */

/** How far a finger may slide and still count as a tap rather than a drag. */
const DRAG_SLOP = 12;

const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const UP_KEYS = new Set(['KeyW', 'ArrowUp']);
const DOWN_KEYS = new Set(['KeyS', 'ArrowDown']);

export interface WaterFightControls {
  /** -1..1, positive is right on the screen. */
  readonly moveX: number;
  /** -1..1, positive is up the screen. */
  readonly moveY: number;
  readonly pointerDown: boolean;
  /** True only on the frame the finger went down. */
  readonly pointerPressed: boolean;
  /** True only on the frame it came up. */
  readonly pointerReleased: boolean;
  /** Client pixels, i.e. what a `PointerEvent` reports. */
  readonly pointerX: number;
  readonly pointerY: number;
  /** True once the finger has slid far enough to be a drag, not a tap. */
  readonly dragged: boolean;
  /** Clears the one-frame edges. Call at the very end of the game's update. */
  endFrame(): void;
  dispose(): void;
}

export function createControls(): WaterFightControls {
  const held = new Set<string>();
  let pointerDown = false;
  let pointerPressed = false;
  let pointerReleased = false;
  let pointerX = 0;
  let pointerY = 0;
  let startX = 0;
  let startY = 0;
  let dragged = false;

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    held.add(event.code);
    // The arrow keys scroll the page, and a garden that scrolls out from under
    // a child mid-fight is not a garden anybody can play in.
    if (event.code.startsWith('Arrow')) event.preventDefault();
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    held.delete(event.code);
  };

  /** Everything letting go: a lost focus must not leave a child running. */
  const onBlur = (): void => {
    held.clear();
    if (pointerDown) pointerReleased = true;
    pointerDown = false;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerDown = true;
    pointerPressed = true;
    dragged = false;
    pointerX = event.clientX;
    pointerY = event.clientY;
    startX = event.clientX;
    startY = event.clientY;
  };

  const onPointerMove = (event: PointerEvent): void => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (pointerDown && Math.hypot(event.clientX - startX, event.clientY - startY) > DRAG_SLOP) {
      dragged = true;
    }
  };

  const onPointerUp = (): void => {
    if (pointerDown) pointerReleased = true;
    pointerDown = false;
  };

  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });
  window.addEventListener('blur', onBlur);
  window.addEventListener('pointerdown', onPointerDown, { capture: true });
  window.addEventListener('pointermove', onPointerMove, { capture: true });
  window.addEventListener('pointerup', onPointerUp, { capture: true });
  window.addEventListener('pointercancel', onPointerUp, { capture: true });

  function axis(negative: ReadonlySet<string>, positive: ReadonlySet<string>): number {
    let value = 0;
    for (const code of held) {
      if (negative.has(code)) value -= 1;
      if (positive.has(code)) value += 1;
    }
    return value < -1 ? -1 : value > 1 ? 1 : value;
  }

  return {
    get moveX(): number {
      return axis(LEFT_KEYS, RIGHT_KEYS);
    },
    get moveY(): number {
      return axis(DOWN_KEYS, UP_KEYS);
    },
    get pointerDown(): boolean {
      return pointerDown;
    },
    get pointerPressed(): boolean {
      return pointerPressed;
    },
    get pointerReleased(): boolean {
      return pointerReleased;
    },
    get pointerX(): number {
      return pointerX;
    },
    get pointerY(): number {
      return pointerY;
    },
    get dragged(): boolean {
      return dragged;
    },

    endFrame(): void {
      pointerPressed = false;
      pointerReleased = false;
    },

    dispose(): void {
      held.clear();
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointermove', onPointerMove, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onPointerUp, { capture: true });
    },
  };
}
