/**
 * Look-around control for a **first-person ride**: drag anywhere to turn, or use
 * the keyboard.
 *
 * This is the ferris wheel's control, moved here **verbatim** — same deadzone,
 * same range, same signs — because ARCHITECTURE-DECISIONS Decision 4 §8 says
 * extract, never rewrite: its directions are family-confirmed and the train and
 * the coaster get *this* one rather than a second opinion. What reads it is
 * {@link RideCamera} in `core/RideCamera.ts`, which is what a ride should
 * actually reach for; this file is only the reading. `check:ride-camera` hashes
 * the result of the two together.
 *
 * Built as a straight copy of the dodgems' on-screen joystick idiom
 * (`dodgems/steering.ts`) rather than a second one invented for this ride — a
 * child who has already driven the dodgems should not have to learn a new way
 * of holding the screen. The differences are only in what the reading *means*:
 * a dodgem's stick is a *direction to travel*; here it sets a **turn rate**,
 * so the further from where the finger went down, the faster the view spins,
 * and letting go — or bringing the finger back to the middle — lets it drift
 * to a stop rather than snapping back.
 *
 * **This is the one kind of control the CONTROL RULE carves out.** Turning by
 * holding a direction is banned everywhere in the game (GAME_DESIGN.md; the
 * reasoning and the shared movement basis live in `core/screenBasis.ts`) —
 * *except* in first person, which is exactly what this ride is. Nothing here
 * moves the gondola; it only points the child's eyes. The same carve-out
 * covers the first-person train and the coaster, and nothing else. If you are
 * copying this file for a ride the player looks *at* rather than *out of*, you
 * want `dodgems/steering.ts` instead.
 *
 * **Why this lives outside the framework's one-button input.** Exactly the
 * dodgems' reasoning: the mini-game contract is one button
 * (`minigames/types.ts`), and a ride that also wants to know *where* the
 * finger is is not a reason to widen what every other stall gets. So this
 * listens on `window` directly, the same way the dodgems' steering does —
 * the framework's overlay captures the pointer for its own hold control, but
 * capturing does not stop the initial event bubbling, so a window listener
 * still sees every press, move and release.
 *
 * **Why `dragging` matters.** The framework's hold gesture — press anywhere,
 * and after {@link HOLD_SECONDS} you go home — is *also* "press anywhere",
 * and a child dragging their view around is pressing the whole time they do
 * it. Without a way to tell the two gestures apart, looking around for a
 * second and a half would send you home by accident. So this module tracks
 * whether the finger has actually travelled past a small deadzone since it
 * touched down, and the ride only counts held time towards going home while
 * it has not — resting a thumb still leaves early; sliding it looks around.
 */

/** Pixels of thumb travel that count as full turn rate. Small — this is a phone. */
const STICK_RANGE = 70;
/** Pixels below which the touch has not yet become a drag. */
const STICK_DEADZONE = 10;

export interface LookReading {
  /** Turn rate, screen-space, -1..1. `x` is drag-right, `y` is drag-up. */
  readonly x: number;
  readonly y: number;
  /** True once the current touch has moved past the deadzone. */
  readonly dragging: boolean;
  /** Where to draw the on-screen stick, or `null` when nothing is touching. */
  readonly touch: { readonly originX: number; readonly originY: number; readonly x: number; readonly y: number } | null;
}

export interface LookControl {
  read(): LookReading;
  dispose(): void;
}

const NOTHING: LookReading = { x: 0, y: 0, dragging: false, touch: null };

export function createLookControl(): LookControl {
  const keys = new Set<string>();
  let pointerId: number | null = null;
  let originX = 0;
  let originY = 0;
  let currentX = 0;
  let currentY = 0;

  const onKeyDown = (event: KeyboardEvent): void => {
    keys.add(event.code);
    if (event.code.startsWith('Arrow')) event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    keys.delete(event.code);
  };
  const onBlur = (): void => {
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

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerUp, true);

  return {
    read(): LookReading {
      let x = 0;
      let y = 0;

      // --- keys: arrows or A/D + W/S, yaw and a gentle pitch ------------------
      if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
      if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
      if (keys.has('ArrowUp') || keys.has('KeyW')) y += 1;
      if (keys.has('ArrowDown') || keys.has('KeyS')) y -= 1;

      // --- thumb / mouse drag --------------------------------------------------
      let touch: LookReading['touch'] = null;
      let dragging = false;
      if (pointerId !== null) {
        const dx = currentX - originX;
        const dy = currentY - originY;
        const distance = Math.hypot(dx, dy);
        touch = { originX, originY, x: currentX, y: currentY };
        if (distance > STICK_DEADZONE) {
          dragging = true;
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
      if (length === 0 && !dragging) return touch ? { ...NOTHING, touch } : NOTHING;
      return { x, y, dragging, touch };
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
