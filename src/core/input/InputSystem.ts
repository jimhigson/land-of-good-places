import { GAMEPAD_BUTTON_THRESHOLD, GAMEPAD_DEADZONE } from '../constants';
import { clamp } from '../mathUtils';
import {
  GAMEPAD_ACTION_BINDINGS,
  GAMEPAD_DPAD_BINDINGS,
  GAME_ACTIONS,
  KEYBOARD_ACTION_BINDINGS,
  KEYBOARD_MOVE_BINDINGS,
  type GameAction,
} from './actions';

/** A read-only snapshot of "what the player is asking for" this frame. */
export interface InputSnapshot {
  /** Movement intent on the ground plane. x = right, y = forward. |v| <= 1. */
  readonly moveX: number;
  readonly moveY: number;
  /** Magnitude of the movement vector, 0..1. Analogue on a gamepad stick. */
  readonly moveAmount: number;
  /** True while any gamepad is connected — used to swap on-screen hints. */
  readonly gamepadConnected: boolean;
  /** The most recent device the player actually used. */
  readonly lastDevice: 'keyboard' | 'gamepad';
}

/**
 * Merges keyboard and Gamepad API input into one logical state.
 *
 * Lifecycle: construct once, call {@link attach} to start listening, call
 * {@link update} exactly once at the top of every frame, then read from it for
 * the rest of the frame. Edge queries (`justPressed`) are only valid between one
 * `update` and the next.
 *
 * Gameplay systems should depend on this class and never on DOM events.
 */
export class InputSystem {
  // Raw device state ------------------------------------------------------
  private readonly heldKeys = new Set<string>();
  private gamepadIndex: number | null = null;

  // Merged logical state --------------------------------------------------
  private readonly down = new Set<GameAction>();
  private readonly pressed = new Set<GameAction>();
  private readonly released = new Set<GameAction>();
  private readonly downPrevious = new Set<GameAction>();

  private moveXValue = 0;
  private moveYValue = 0;
  private moveAmountValue = 0;
  private lastDeviceUsed: 'keyboard' | 'gamepad' = 'keyboard';

  private attached = false;

  // ---------------------------------------------------------------- setup

  attach(target: Window = window): void {
    if (this.attached) return;
    this.attached = true;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
    target.addEventListener('gamepadconnected', this.onGamepadConnected as EventListener);
    target.addEventListener('gamepaddisconnected', this.onGamepadDisconnected as EventListener);
  }

  detach(target: Window = window): void {
    if (!this.attached) return;
    this.attached = false;
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
    target.removeEventListener('gamepadconnected', this.onGamepadConnected as EventListener);
    target.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected as EventListener);
  }

  // ----------------------------------------------------------- public API

  /** Movement intent, x = strafe right, y = forward. Camera-relative mapping
   *  happens in the consumer (see PlayerController). */
  get moveX(): number {
    return this.moveXValue;
  }

  get moveY(): number {
    return this.moveYValue;
  }

  get moveAmount(): number {
    return this.moveAmountValue;
  }

  get gamepadConnected(): boolean {
    return this.gamepadIndex !== null;
  }

  get lastDevice(): 'keyboard' | 'gamepad' {
    return this.lastDeviceUsed;
  }

  /** True for every frame the action is held. */
  isDown(action: GameAction): boolean {
    return this.down.has(action);
  }

  /** True only on the frame the action went down. */
  justPressed(action: GameAction): boolean {
    return this.pressed.has(action);
  }

  /** True only on the frame the action came back up. */
  justReleased(action: GameAction): boolean {
    return this.released.has(action);
  }

  snapshot(): InputSnapshot {
    return {
      moveX: this.moveXValue,
      moveY: this.moveYValue,
      moveAmount: this.moveAmountValue,
      gamepadConnected: this.gamepadConnected,
      lastDevice: this.lastDeviceUsed,
    };
  }

  /**
   * Recomputes the merged state. Call once per frame, before anything reads it.
   */
  update(): void {
    this.downPrevious.clear();
    for (const action of this.down) this.downPrevious.add(action);
    this.down.clear();

    let moveX = 0;
    let moveY = 0;

    // --- keyboard -------------------------------------------------------
    for (const code of this.heldKeys) {
      const axis = KEYBOARD_MOVE_BINDINGS[code];
      if (axis) {
        moveX += axis[0];
        moveY += axis[1];
      }
      const action = KEYBOARD_ACTION_BINDINGS[code];
      if (action) this.down.add(action);
    }

    // Normalise so diagonal keyboard walking isn't 1.41x faster.
    const keyboardLength = Math.hypot(moveX, moveY);
    if (keyboardLength > 1) {
      moveX /= keyboardLength;
      moveY /= keyboardLength;
    }
    const keyboardActive = keyboardLength > 0;

    // --- gamepad --------------------------------------------------------
    const pad = this.readGamepad();
    let padX = 0;
    let padY = 0;
    if (pad) {
      const rawX = pad.axes[0] ?? 0;
      // Browsers report "stick up" as -1 on the Y axis; flip it to "forward".
      const rawY = -(pad.axes[1] ?? 0);
      [padX, padY] = applyRadialDeadzone(rawX, rawY, GAMEPAD_DEADZONE);

      for (const [indexText, action] of Object.entries(GAMEPAD_ACTION_BINDINGS)) {
        if (isButtonPressed(pad, Number(indexText))) this.down.add(action);
      }
      for (const [indexText, axis] of Object.entries(GAMEPAD_DPAD_BINDINGS)) {
        if (isButtonPressed(pad, Number(indexText))) {
          padX += axis[0];
          padY += axis[1];
        }
      }
      const padLength = Math.hypot(padX, padY);
      if (padLength > 1) {
        padX /= padLength;
        padY /= padLength;
      }
    }
    const padActive = Math.hypot(padX, padY) > 0;

    // --- merge ----------------------------------------------------------
    // Whichever device is being pushed hardest wins, so a resting stick never
    // fights the keyboard and vice versa.
    if (padActive && Math.hypot(padX, padY) >= Math.hypot(moveX, moveY)) {
      this.moveXValue = padX;
      this.moveYValue = padY;
      this.lastDeviceUsed = 'gamepad';
    } else {
      this.moveXValue = moveX;
      this.moveYValue = moveY;
      if (keyboardActive) this.lastDeviceUsed = 'keyboard';
    }
    this.moveAmountValue = clamp(Math.hypot(this.moveXValue, this.moveYValue), 0, 1);

    // --- edges ----------------------------------------------------------
    this.pressed.clear();
    this.released.clear();
    for (const action of GAME_ACTIONS) {
      const isDown = this.down.has(action);
      const wasDown = this.downPrevious.has(action);
      if (isDown && !wasDown) this.pressed.add(action);
      else if (!isDown && wasDown) this.released.add(action);
    }
  }

  // ------------------------------------------------------------- internal

  private readGamepad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    // Prefer the pad we already latched onto, otherwise adopt the first live one.
    if (this.gamepadIndex !== null) {
      const existing = pads[this.gamepadIndex];
      if (existing && existing.connected) return existing;
      this.gamepadIndex = null;
    }
    for (const pad of pads) {
      if (pad && pad.connected) {
        this.gamepadIndex = pad.index;
        return pad;
      }
    }
    return null;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    if (KEYBOARD_MOVE_BINDINGS[event.code] || KEYBOARD_ACTION_BINDINGS[event.code]) {
      // Stop the page scrolling / F3 opening browser search while playing.
      event.preventDefault();
    }
    this.heldKeys.add(event.code);
    this.lastDeviceUsed = 'keyboard';
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.heldKeys.delete(event.code);
  };

  /** Losing focus mid-stride would otherwise leave the player walking forever. */
  private readonly onBlur = (): void => {
    this.heldKeys.clear();
  };

  private readonly onGamepadConnected = (event: GamepadEvent): void => {
    this.gamepadIndex = event.gamepad.index;
    this.lastDeviceUsed = 'gamepad';
  };

  private readonly onGamepadDisconnected = (event: GamepadEvent): void => {
    if (this.gamepadIndex === event.gamepad.index) this.gamepadIndex = null;
  };
}

function isButtonPressed(pad: Gamepad, index: number): boolean {
  const button = pad.buttons[index];
  if (!button) return false;
  return button.pressed || button.value > GAMEPAD_BUTTON_THRESHOLD;
}

/**
 * Radial dead-zone: kills stick drift near centre while keeping the full 0..1
 * analogue range beyond it, so a gentle push really is a gentle walk.
 */
function applyRadialDeadzone(x: number, y: number, deadzone: number): [number, number] {
  const length = Math.hypot(x, y);
  if (length < deadzone) return [0, 0];
  const scaled = Math.min(1, (length - deadzone) / (1 - deadzone)) / length;
  return [x * scaled, y * scaled];
}
