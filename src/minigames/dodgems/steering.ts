import { GAMEPAD_DEADZONE } from '../../core/constants';
import { applyRadialDeadzone } from '../../core/input';

/**
 * Steering for the dodgems.
 *
 * The mini-game framework hands every game exactly one button, because one
 * button is the only control that works the same on a keyboard, a gamepad and a
 * small thumb (`minigames/types.ts`). A dodgem needs one thing more — *which
 * way* — so this module adds it, and adds it **inside the dodgems folder**
 * rather than by widening the framework's input: the shared contract is one
 * button, and a car is not a reason to change what every other stall gets.
 *
 * Four sources, merged into one screen-space direction:
 *
 * - **Touch/mouse**: a virtual stick anchored wherever the finger went down.
 *   Press and the car goes; slide your thumb and the car goes that way. Chosen
 *   over "drive towards where you are touching" because a thumb parked at the
 *   bottom of a phone would mean "reverse", and over on-screen arrow buttons
 *   because a six-year-old's thumb does not find a 44-pixel target while a car
 *   is being rammed.
 * - **Keys**: arrows or WASD.
 * - **Gamepad**: left stick, through the same radial dead-zone the park walks
 *   on (`core/input/InputSystem.ts`), so a gentle push is a gentle drive and
 *   the analogue range past the dead-zone is the full 0..1 either side of it.
 * - **Gamepad d-pad**: the same four directions as the keys.
 *
 * All four agree by construction: every one of them ends up adding to the same
 * `x`/`y` pair, which is then clipped to a unit circle — so a diagonal is a
 * diagonal whichever pair of things is pressed to make it, and no combination
 * drives faster than one direction alone.
 *
 * Pressing a direction also counts as "go", so a child who only ever presses
 * left still drives. Holding the button with no direction drives straight on.
 *
 * Screen axes: `x` right, `y` **up**. The game turns those into world metres
 * through `core/screenBasis.ts`, because only it knows where its camera is —
 * and this module knows nothing whatever about the car, which is the CONTROL
 * RULE holding: a direction is a direction, not a turn.
 */

/** Pixels of thumb travel that count as full lock. Small — this is a phone. */
const STICK_RANGE = 62;
/** Pixels below which a wobble is not a steer. */
const STICK_DEADZONE = 9;

export interface SteerReading {
  /** Screen-space direction, length 0..1. `y` is positive upwards. */
  readonly x: number;
  readonly y: number;
  /** True when the player is asking to move, whatever they used to ask. */
  readonly wants: boolean;
  /**
   * Where the on-screen stick should be drawn, in CSS pixels, or `null` when
   * nothing is touching the screen.
   */
  readonly touch: { readonly originX: number; readonly originY: number; readonly x: number; readonly y: number } | null;
}

export interface Steering {
  read(): SteerReading;
  dispose(): void;
}

const NOTHING: SteerReading = { x: 0, y: 0, wants: false, touch: null };

export function createSteering(): Steering {
  const keys = new Set<string>();
  let pointerId: number | null = null;
  let originX = 0;
  let originY = 0;
  let currentX = 0;
  let currentY = 0;

  const onKeyDown = (event: KeyboardEvent): void => {
    keys.add(event.code);
    // The arrows scroll the page on a laptop otherwise, which slides the canvas
    // out from under the game.
    if (event.code.startsWith('Arrow')) event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    keys.delete(event.code);
  };
  const onBlur = (): void => {
    // Alt-tabbing away with a key down used to leave the car turning for ever.
    keys.clear();
    pointerId = null;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (pointerId !== null) return;
    pointerId = event.pointerId;
    originX = event.clientX;
    originY = event.clientY;
    currentX = event.clientX;
    currentY = event.clientY;
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    currentX = event.clientX;
    currentY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
  };

  // The overlay captures the pointer for its hold control, which retargets the
  // events — but they still bubble, so listening on `window` sees every one of
  // them without touching a single line the framework owns.
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);

  return {
    read(): SteerReading {
      let x = 0;
      let y = 0;
      let wants = false;

      // --- keys -------------------------------------------------------------
      if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
      if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
      if (keys.has('ArrowUp') || keys.has('KeyW')) y += 1;
      if (keys.has('ArrowDown') || keys.has('KeyS')) y -= 1;
      if (x !== 0 || y !== 0) wants = true;

      // --- gamepad ----------------------------------------------------------
      const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      for (const pad of pads) {
        if (!pad) continue;
        // The park's own dead-zone, shared rather than re-tuned here, so a
        // gentle push is a gentle drive exactly as it is a gentle walk.
        const [ax, ay] = applyRadialDeadzone(
          pad.axes[0] ?? 0,
          // Browsers report "stick up" as -1; flip it to "up the screen".
          -(pad.axes[1] ?? 0),
          GAMEPAD_DEADZONE,
        );
        if (ax !== 0 || ay !== 0) {
          x += ax;
          y += ay;
          wants = true;
        }
        if (pad.buttons[14]?.pressed) { x -= 1; wants = true; }
        if (pad.buttons[15]?.pressed) { x += 1; wants = true; }
        if (pad.buttons[12]?.pressed) { y += 1; wants = true; }
        if (pad.buttons[13]?.pressed) { y -= 1; wants = true; }
      }

      // --- thumb ------------------------------------------------------------
      let touch: SteerReading['touch'] = null;
      if (pointerId !== null) {
        wants = true;
        const dx = currentX - originX;
        const dy = currentY - originY;
        const distance = Math.hypot(dx, dy);
        touch = { originX, originY, x: currentX, y: currentY };
        if (distance > STICK_DEADZONE) {
          const strength = Math.min(1, (distance - STICK_DEADZONE) / (STICK_RANGE - STICK_DEADZONE));
          x += (dx / distance) * strength;
          y -= (dy / distance) * strength; // screen Y is positive downwards
        }
      }

      const length = Math.hypot(x, y);
      if (length > 1) {
        x /= length;
        y /= length;
      }
      if (length === 0 && !wants) return NOTHING;
      return { x, y, wants, touch };
    },

    dispose(): void {
      keys.clear();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerUp, true);
    },
  };
}
