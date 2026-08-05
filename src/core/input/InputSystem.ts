import { GAMEPAD_BUTTON_THRESHOLD, GAMEPAD_DEADZONE } from '../constants';
import { clamp } from '../mathUtils';
import {
  GAMEPAD_ACTION_BINDINGS,
  GAMEPAD_DPAD_BINDINGS,
  GAME_ACTIONS,
  KEYBOARD_ACTION_BINDINGS,
  KEYBOARD_MOVE_BINDINGS,
  MOUSE_ACTION_BINDINGS,
  type GameAction,
  type InteractFreeAction,
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
 * How many `update()` calls a virtual (on-screen) button press stays held for.
 *
 * It must be at least one, or a tap that lands and lifts inside a single frame
 * would never be seen. Two gives the edge a frame of slack without a stray
 * double-hop, since everything bound to a touch button is a `justPressed` query.
 */
const VIRTUAL_PRESS_FRAMES = 2;

/** Tags that own their keystrokes outright — see {@link isTextEntryTarget}. */
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * True when a keystroke belongs to something the player is *typing into*
 * rather than to the park.
 *
 * This exists because {@link InputSystem} listens on `window` and stays
 * attached for the whole session (`Game.start`/`stop`), so **every** DOM field
 * rendered over the running game shares its keyboard. Without this guard the
 * `preventDefault` below swallows the keystroke entirely: `w a s d e f i p`,
 * `Space` and `Backspace` are all bound, so a child called Wren could not type
 * her own name into the "Look" pill's character creator, and could not delete
 * a character either. See issue #189 — the character creator was simply the
 * first field to be shown over a live game, not the only one that will be
 * (the keychain shop dialog is next).
 *
 * Fixed here rather than at the call site on purpose: one guard covers every
 * dialog anyone mounts in future, whereas a fix in the "Look" pill would have
 * protected only the "Look" pill.
 *
 * Duck-typed on `tagName`/`isContentEditable` rather than
 * `instanceof HTMLInputElement`: `instanceof` is bound to one realm, so it
 * answers "no" for a field inside an iframe — and a false "no" here is exactly
 * the bug this guard exists to prevent. `SELECT` is included because its
 * keyboard is arrows and `Space`; every `INPUT` is covered rather than just
 * the text-ish ones, because a checkbox is toggled with `Space` and a range
 * slider is driven with the arrow keys.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!element) return false;
  if (element.isContentEditable === true) return true;
  return typeof element.tagName === 'string' && TEXT_ENTRY_TAGS.has(element.tagName);
}

/**
 * Merges keyboard, Gamepad API and on-screen touch input into one logical state.
 *
 * Lifecycle: construct once, call {@link attach} to start listening, call
 * {@link update} exactly once at the top of every frame, then read from it for
 * the rest of the frame. Edge queries (`justPressed`) are only valid between one
 * `update` and the next.
 *
 * Gameplay systems should depend on this class and never on DOM events.
 *
 * Touch play joins in through two doors, both of them *after* the device scan:
 *
 * - {@link pressVirtual} — an on-screen button firing a named action, which then
 *   behaves exactly like the key it stands in for.
 * - {@link setNavigationMove} — tap-to-move steering, which pushes the movement
 *   stick on the character's behalf. It defers to the hands: the moment a real
 *   key or stick is touched ({@link manualMoveActive}) the navigation input is
 *   ignored, so walking manually always wins.
 */
export class InputSystem {
  // Raw device state ------------------------------------------------------
  private readonly heldKeys = new Set<string>();
  private gamepadIndex: number | null = null;
  /** `MouseEvent.button` values currently held — see {@link MOUSE_ACTION_BINDINGS}. */
  private readonly heldMouseButtons = new Set<number>();
  /**
   * While true, a right-click's context menu is swallowed rather than shown.
   *
   * Off by default: mouse buttons are tracked (harmlessly, see
   * `actions.ts`'s `MOUSE_ACTION_BINDINGS` doc comment) everywhere in the
   * park, but suppressing the browser's own context menu everywhere would be
   * a surprising thing for this game to do outside the one ride that uses a
   * right-click at all. `RailRace` toggles this on boarding and off on
   * dismount.
   */
  private mouseCaptureActive = false;

  // Virtual state (on-screen buttons, tap-to-move) -------------------------
  private readonly virtualPresses = new Map<GameAction, number>();
  /** Actions an on-screen button is *holding* down — see {@link holdVirtual}. */
  private readonly virtualHolds = new Set<GameAction>();
  private manualMoveActiveValue = false;
  private navigationSprintValue = false;

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
    target.addEventListener('mousedown', this.onMouseDown);
    target.addEventListener('mouseup', this.onMouseUp);
    target.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(target: Window = window): void {
    if (!this.attached) return;
    this.attached = false;
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    target.removeEventListener('blur', this.onBlur);
    target.removeEventListener('gamepadconnected', this.onGamepadConnected as EventListener);
    target.removeEventListener('gamepaddisconnected', this.onGamepadDisconnected as EventListener);
    target.removeEventListener('mousedown', this.onMouseDown);
    target.removeEventListener('mouseup', this.onMouseUp);
    target.removeEventListener('contextmenu', this.onContextMenu);
  }

  /**
   * Whether a right-click should open the browser's context menu.
   *
   * `RailRace` calls this `true` the moment she boards (right mouse button is
   * the desktop duck control) and `false` again the moment she gets off. See
   * {@link mouseCaptureActive}'s own doc comment for why this is scoped
   * rather than a permanent, park-wide suppression.
   */
  setMouseCaptureActive(active: boolean): void {
    this.mouseCaptureActive = active;
    if (!active) this.heldMouseButtons.clear();
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

  /**
   * True when a real key or stick is asking for movement this frame.
   *
   * Tap-to-move watches this and gives way immediately: pressing W while the
   * character is walking to a tapped spot cancels the walk rather than fighting
   * it.
   */
  get manualMoveActive(): boolean {
    return this.manualMoveActiveValue;
  }

  /**
   * Fires an action from something that is not a key or a button — an on-screen
   * touch control, or a tap that arrived at what it was walking towards.
   *
   * The press is held for a couple of frames so that `justPressed` sees a clean
   * edge even if the finger was quicker than the frame.
   *
   * **Not `interact`** — that is the same exclusion {@link justPressed} makes,
   * and it closes the last back door onto issue #122. A synthesised interact
   * edge is *unaddressed*: it says "somebody use something", which is precisely
   * the bug. An action chip runs its zone's own `run()` closure now
   * (`world/interact.ts`), so it reaches one named thing and nothing else.
   */
  pressVirtual(action: InteractFreeAction): void {
    this.virtualPresses.set(action, VIRTUAL_PRESS_FRAMES);
  }

  /**
   * Holds an action down from an on-screen button, for as long as a thumb is on
   * it — {@link pressVirtual}'s twin for a control that is *held* rather than
   * tapped.
   *
   * `jump` needs this: the on-screen hop button doubles as the jet pack's fly
   * button (see `ui/ScreenControls.ts` and `Player.ts`'s "THE JET PACK"
   * comment), and `Player` tells a tap from a hold by reading `isDown` over
   * several frames — the same way a real key or gamepad button already
   * reports "held" for as long as it is physically down. `pressVirtual`'s
   * two-frame pulse could only ever produce an edge, never a state, so it
   * cannot stand in for a key here.
   *
   * The caller owns both ends. `ui/ScreenControls.ts` clears it on `pointerup`,
   * `pointercancel` *and* `pointerleave`, which is the same triple that already
   * clears the pressed styling — so a thumb sliding off the button stops the
   * climb exactly as it stops the glow.
   */
  holdVirtual(action: InteractFreeAction, held: boolean): void {
    if (held) this.virtualHolds.add(action);
    else this.virtualHolds.delete(action);
  }

  /** Lets go of every on-screen hold. Called when the buttons are hidden. */
  clearVirtualHolds(): void {
    this.virtualHolds.clear();
  }

  /**
   * Pushes the movement stick on the character's behalf, in the same
   * camera-relative axes as {@link moveX} / {@link moveY}.
   *
   * Call it *after* {@link update} and before anything reads the movement, once
   * per frame — the navigator passes `(0, 0)` when it has nowhere to be. Real
   * input always wins: if {@link manualMoveActive} this call does nothing.
   */
  setNavigationMove(x: number, y: number): void {
    if (this.manualMoveActiveValue) return;
    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    this.moveXValue = x;
    this.moveYValue = y;
    this.moveAmountValue = clamp(Math.hypot(x, y), 0, 1);
  }

  /**
   * Holds the `sprint` action on the tap-navigator's behalf, for a double-tap
   * "run there". Mirrors {@link setNavigationMove}: call it every frame with
   * the desired state, `false` once nothing needs it. It only ever adds to
   * `sprint`, never masks it, so a real Shift held at the same time still
   * works exactly as it always did.
   */
  setNavigationSprint(active: boolean): void {
    this.navigationSprintValue = active;
  }

  /** True for every frame the action is held. */
  isDown(action: GameAction): boolean {
    if (action === 'sprint' && this.navigationSprintValue) return true;
    return this.down.has(action);
  }

  /**
   * True only on the frame the action went down.
   *
   * **`interact` is deliberately not askable here** — see
   * {@link takeInteractPress}. The exclusion is the whole of issue #122's fix:
   * it is what makes "a handler acts on something other than the chip a child
   * is looking at" a compile error rather than a thing to remember.
   */
  justPressed(action: InteractFreeAction): boolean {
    return this.pressed.has(action);
  }

  /**
   * The interact edge, taken once.
   *
   * Every other action may be read by anyone, any number of times, because
   * every other action means the same thing wherever you are standing: `jump`
   * hops, `menu` opens the menu. `interact` does not — it means *"use the thing
   * I am looking at"*, and only `world/Selection.ts` knows what that is.
   *
   * So this is the one door, and `world/InteractRouter.ts` is the one caller.
   * Reading it **consumes** it: a second caller in the same frame gets `false`.
   * That is belt and braces on top of {@link justPressed}'s type excluding
   * `interact` — the type stops the code being written, this stops it working
   * if it ever is.
   *
   * The bug that earned all this (family QA, 28 July 2026): the chip over the
   * platform said "Get on", and E picked a flower. Twelve systems each read
   * this edge and each decided for itself, from its own radius, whether the
   * press was meant for it.
   */
  takeInteractPress(): boolean {
    if (!this.pressed.has('interact')) return false;
    this.pressed.delete('interact');
    return true;
  }

  /** True only on the frame the action came back up. */
  justReleased(action: InteractFreeAction): boolean {
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

    // --- mouse buttons ----------------------------------------------------
    // Same shape as the gamepad loop above: a held button's bound action goes
    // into `this.down` for the frame. Tracked whether or not `mouseCaptureActive`
    // is on — see that flag's own doc comment for why only the context-menu
    // suppression, not the tracking itself, is scoped to the ride.
    for (const button of this.heldMouseButtons) {
      const action = MOUSE_ACTION_BINDINGS[button];
      if (action) this.down.add(action);
    }

    // --- on-screen buttons ----------------------------------------------
    // Merged in with the devices so that a thumb on the hop button is
    // indistinguishable, downstream, from a thumb on the space bar.
    for (const [action, framesLeft] of this.virtualPresses) {
      this.down.add(action);
      if (framesLeft <= 1) this.virtualPresses.delete(action);
      else this.virtualPresses.set(action, framesLeft - 1);
    }
    // Held buttons never expire on their own — the button that set one clears
    // it. See `holdVirtual`.
    for (const action of this.virtualHolds) this.down.add(action);

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
    // Recorded before tap-to-move gets a look in, so it means "hands on the
    // controls", not "the character is moving".
    this.manualMoveActiveValue = keyboardActive || padActive;

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
    // She is typing, not playing — see {@link isTextEntryTarget}. Bail before
    // both the `preventDefault` (which would eat the character) and the
    // `heldKeys.add` (which would walk her off while she types).
    if (isTextEntryTarget(event.target)) return;
    if (KEYBOARD_MOVE_BINDINGS[event.code] || KEYBOARD_ACTION_BINDINGS[event.code]) {
      // Stop the page scrolling / F3 opening browser search while playing.
      event.preventDefault();
    }
    this.heldKeys.add(event.code);
    this.lastDeviceUsed = 'keyboard';
  };

  /**
   * Deliberately **not** guarded by {@link isTextEntryTarget}, unlike
   * {@link onKeyDown}: this only ever *releases* a key, which is always safe.
   * Guarding it would strand a key that was held while walking and then
   * released after a text field took focus — she would keep running forever.
   */
  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.heldKeys.delete(event.code);
  };

  /** Losing focus mid-stride would otherwise leave the player walking forever. */
  private readonly onBlur = (): void => {
    this.heldKeys.clear();
    // And an on-screen hold would otherwise leave her climbing forever: a
    // window that loses focus mid-press never delivers the `pointerup`.
    this.virtualHolds.clear();
    // Same failure mode as a held key: a window switch mid-click never
    // delivers the `mouseup`, which would otherwise leave duck stuck on.
    this.heldMouseButtons.clear();
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    this.heldMouseButtons.add(event.button);
    this.lastDeviceUsed = 'keyboard';
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    this.heldMouseButtons.delete(event.button);
  };

  private readonly onContextMenu = (event: Event): void => {
    if (this.mouseCaptureActive) event.preventDefault();
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
 *
 * Exported because a mini-game that reads the pad itself — the dodgems, which
 * needs a *direction* and so cannot go through the framework's one-button
 * input — must feel identical to walking about the park. One stick, one feel,
 * whichever side of a stall door the child is on.
 */
export function applyRadialDeadzone(x: number, y: number, deadzone: number): [number, number] {
  const length = Math.hypot(x, y);
  if (length < deadzone) return [0, 0];
  const scaled = Math.min(1, (length - deadzone) / (1 - deadzone)) / length;
  return [x * scaled, y * scaled];
}
