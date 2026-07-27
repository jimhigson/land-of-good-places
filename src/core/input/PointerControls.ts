/**
 * Raw pointer handling for the canvas: taps, and pinch-to-zoom.
 *
 * The only file in the game allowed to look at `PointerEvent`. It turns the
 * mess of pointerdown/move/up bookkeeping into two clean signals — "the player
 * tapped *here*" and "the player pinched by *this much*" — and hands them to
 * whoever asked, which keeps gameplay code free of DOM events exactly as the
 * keyboard and gamepad are.
 *
 * Works with a mouse too, deliberately: click-to-walk is genuinely nicer than
 * WASD on a trackpad, and it means the whole touch path can be tested on a
 * desktop without emulation.
 */

/** A point on the canvas in normalised device coordinates, ready for a camera ray. */
export interface ScreenPoint {
  /** -1 (left) .. +1 (right). */
  readonly ndcX: number;
  /** -1 (bottom) .. +1 (top). */
  readonly ndcY: number;
}

/** A tap in normalised device coordinates, ready for a camera ray. */
export interface TapPoint extends ScreenPoint {
  /** True if this tap landed soon enough after, and close enough to, the last
   *  one to count as a double-tap — the "run there" gesture. */
  readonly doubleTap: boolean;
}

export interface PointerControlsOptions {
  /** Fired when a press-and-release lands in the same spot, quickly enough. */
  onTap(point: TapPoint): void;
  /**
   * Where the **mouse** is, or `null` when it has left the canvas. Never fired
   * for a finger or a pen: a touch has no hover state, and reporting the last
   * place a finger happened to be would leave something outlined in rainbow
   * long after it was let go of.
   *
   * This is the mouse half of GAME_DESIGN.md's HIGHLIGHT RULE — "anything
   * clickable is outlined on hover" — and it is here rather than anywhere else
   * because this is the one file in the game allowed to look at a
   * `PointerEvent`.
   */
  onHover?(point: ScreenPoint | null): void;
  /**
   * Fired repeatedly while two fingers spread or close. `delta` is signed, in
   * the same units as `CAMERA_ZOOM_STEP`, so it can go straight to the camera.
   */
  onPinch(delta: number): void;
}

/** Longer than this and it was a considered press, not a tap. */
const TAP_MAX_MILLISECONDS = 600;

/**
 * A second tap within this long of the first counts as a double-tap ("run
 * there") rather than two separate walks. Generous enough for small fingers,
 * short enough that two unrelated taps in a hurry don't get mistaken for one.
 */
const DOUBLE_TAP_MAX_MILLISECONDS = 350;

/**
 * How far apart, in CSS pixels, the two taps of a double-tap may land and
 * still count as "the same spot". Looser than {@link TAP_MAX_DRIFT} because
 * it is measured between two independent touches, not one finger's wobble.
 */
const DOUBLE_TAP_MAX_DRIFT = 40;

/**
 * How far a finger may slide and still count as a tap, in CSS pixels.
 *
 * Generous, because it has to be: a six-year-old's tap on a phone routinely
 * travels ten pixels, and the cost of being too strict is a tap that silently
 * does nothing.
 */
const TAP_MAX_DRIFT = 18;

/**
 * Pinch sensitivity. A gesture that doubles the finger separation moves the zoom
 * by about `1.0`, which is most of the camera's range — brisk, but a pinch on a
 * small screen is a small movement and anything gentler feels broken.
 */
const PINCH_GAIN = 1.0;

/** WebKit-only gesture events, swallowed so the page never zooms. */
const SAFARI_GESTURES = ['gesturestart', 'gesturechange', 'gestureend'] as const;

interface ActivePointer {
  x: number;
  y: number;
  readonly startX: number;
  readonly startY: number;
  readonly startTime: number;
  /** Set once a second finger lands, or once the drift budget is spent. */
  disqualified: boolean;
}

export class PointerControls {
  private readonly pointers = new Map<number, ActivePointer>();
  private pinchDistance = 0;
  private attached = false;

  // Double-tap bookkeeping: remembers only the *previous accepted tap*, never
  // a tap that was itself a double — so three quick taps read as "double,
  // then single", not a runaway chain of doubles.
  private lastTapTime = -Infinity;
  private lastTapX = 0;
  private lastTapY = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: PointerControlsOptions,
  ) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerCancel);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('dblclick', preventDefault);
    this.canvas.addEventListener('contextmenu', preventDefault);
    // Safari on iOS still fires its own pinch and double-tap zoom gestures on
    // top of pointer events; without these the whole page scales instead of the
    // camera. They are not in the DOM typings, hence the EventTarget view.
    for (const type of SAFARI_GESTURES) {
      (this.canvas as EventTarget).addEventListener(type, preventDefault);
    }
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerCancel);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('dblclick', preventDefault);
    this.canvas.removeEventListener('contextmenu', preventDefault);
    for (const type of SAFARI_GESTURES) {
      (this.canvas as EventTarget).removeEventListener(type, preventDefault);
    }
    this.pointers.clear();
  }

  // ------------------------------------------------------------- handlers

  private readonly onPointerDown = (event: PointerEvent): void => {
    // Right and middle mouse buttons are not walk commands.
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    capture(this.canvas, event.pointerId, true);

    this.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      startTime: performance.now(),
      disqualified: false,
    });

    // Second finger down: this is a pinch, so neither finger is a tap any more.
    if (this.pointers.size === 2) {
      for (const pointer of this.pointers.values()) pointer.disqualified = true;
      this.pinchDistance = this.currentPinchDistance();
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    // Hover is reported whether or not a button is down, and whether or not this
    // pointer is one we are tracking for a tap — the highlight follows the mouse
    // even while it is being dragged across the park.
    if (event.pointerType === 'mouse') this.reportHover(event);

    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > TAP_MAX_DRIFT) {
      pointer.disqualified = true;
    }

    if (this.pointers.size === 2 && this.pinchDistance > 0) {
      const distance = this.currentPinchDistance();
      if (distance > 0) {
        // Ratio rather than difference: spreading two fingers by a centimetre
        // means far more when they started a centimetre apart.
        this.options.onPinch((distance / this.pinchDistance - 1) * PINCH_GAIN);
        this.pinchDistance = distance;
      }
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    this.pointers.delete(event.pointerId);
    capture(this.canvas, event.pointerId, false);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (!pointer || pointer.disqualified) return;
    const now = performance.now();
    if (now - pointer.startTime > TAP_MAX_MILLISECONDS) return;

    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const doubleTap =
      now - this.lastTapTime <= DOUBLE_TAP_MAX_MILLISECONDS &&
      Math.hypot(event.clientX - this.lastTapX, event.clientY - this.lastTapY) <= DOUBLE_TAP_MAX_DRIFT;

    // A tap that completed a double doesn't itself start a new pair — lifting
    // off and tapping again starts fresh, rather than every third tap chaining
    // into another "double".
    this.lastTapTime = doubleTap ? -Infinity : now;
    this.lastTapX = event.clientX;
    this.lastTapY = event.clientY;

    this.options.onTap({
      ndcX: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      ndcY: -((event.clientY - rect.top) / rect.height) * 2 + 1,
      doubleTap,
    });
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
  };

  /** The mouse has gone: over the HUD, out of the window, or off the screen. */
  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse') return;
    this.options.onHover?.(null);
  };

  private reportHover(event: PointerEvent): void {
    const hover = this.options.onHover;
    if (!hover) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    hover({
      ndcX: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      ndcY: -((event.clientY - rect.top) / rect.height) * 2 + 1,
    });
  }

  private currentPinchDistance(): number {
    const [first, second] = [...this.pointers.values()];
    if (!first || !second) return 0;
    return Math.hypot(first.x - second.x, first.y - second.y);
  }
}

function preventDefault(event: Event): void {
  event.preventDefault();
}

/**
 * Takes or releases pointer capture, tolerating failure.
 *
 * Capture keeps the finger's `pointerup` coming to the canvas even if it drifts
 * over the HUD before lifting, which is the difference between a tap near the
 * clock pill working and silently doing nothing.
 *
 * The try/catch is not defensive padding: `setPointerCapture` throws
 * `NotFoundError` whenever the id is not an *active* pointer, and a tap quick
 * enough to have already been released — or one synthesised by a test — is
 * exactly that. Losing the capture is harmless; losing the tap is not.
 */
function capture(canvas: HTMLCanvasElement, pointerId: number, take: boolean): void {
  try {
    if (take) canvas.setPointerCapture(pointerId);
    else canvas.releasePointerCapture(pointerId);
  } catch {
    // Nothing to do: the pointer has already gone.
  }
}
