/**
 * Raw pointer and wheel handling for the canvas: taps, pinch-to-zoom, and the
 * mouse wheel/trackpad-scroll zoom that drives the same camera call pinch does.
 *
 * The only file in the game allowed to look at `PointerEvent`. It turns the
 * mess of pointerdown/move/up bookkeeping into three clean signals — "the
 * player tapped *here*", "the player pinched by *this much*" and "the player
 * dragged the view by *this far*" — and hands them to whoever asked, which
 * keeps gameplay code free of DOM events exactly as the keyboard and gamepad
 * are. `WheelEvent` is a fourth signal in the same spirit, bolted on here
 * rather than a file of its own because it is canvas-scoped input feeding the
 * very same zoom the pinch signal feeds.
 *
 * **A tap and a look-around drag are one decision, not two** (#419). The drag
 * signal fires off the very flag that stops a drifted pointer becoming a tap,
 * so there is no threshold anywhere in the game at which a gesture could both
 * walk her and pan the view, or neither. That matters more than it sounds:
 * GAME_DESIGN.md's CONTROL RULE is absolute, and it is this single decision —
 * plus the fact that panning only ever *translates* the camera, never turns it
 * (`IsoCamera.lookByPixels`) — that keeps dragging firmly a way to look and
 * never a way to steer.
 *
 * Works with a mouse too, deliberately: click-to-walk is genuinely nicer than
 * WASD on a trackpad, and it means the whole touch path can be tested on a
 * desktop without emulation.
 *
 * **What counts as a tap lives in `tapGesture.ts`, not here** — the park map's
 * canvas and its dimmed backdrop have to answer the same question, and three
 * different answers to it is what shipped Jim's "as soon as I touch the screen
 * the map closes".
 */
import { completesTap, tapCandidate, tapDriftedTooFar, type TapCandidate } from './tapGesture';

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
  /**
   * Fired repeatedly while **one** finger or a held mouse button drags across
   * the park — "drag to look around" (#419). `dxPixels`/`dyPixels` are that
   * move's own step in CSS pixels, `y` growing downward as `clientY` does, so
   * it can go straight to `IsoCamera.lookByPixels`.
   *
   * **A drag is defined as a tap that stopped being one.** It fires from the
   * moment `tapDriftedTooFar` disqualifies the pointer and not a pixel before,
   * which means it reads the same 18 px of slop tap-to-walk and both map
   * surfaces read, out of `tapGesture.ts` — not a copy of that number, and not
   * a second threshold of its own. There is therefore no gap and no overlap
   * between "this walked her" and "this looked around": a gesture is exactly
   * one of the two, decided once, by the flag the tap path itself uses.
   *
   * Never fires for a pointer that did not start on the canvas (a drag off a
   * HUD button is that button's business), and never during a pinch — two
   * fingers are a zoom, and the pointer that recognised the pinch is already
   * disqualified for a different reason.
   */
  onLookDrag?(dxPixels: number, dyPixels: number): void;
  /**
   * Fired for a mouse wheel notch or a trackpad two-finger scroll — the desktop
   * equivalent of {@link onPinch}, and meant to be wired to the exact same
   * `IsoCamera.nudgeZoom` call: this is a delta, not a target, and it carries no
   * range of its own. `notches` is signed and normalised so that `1` is "one
   * ordinary wheel click", regardless of whether the browser reported the raw
   * event in pixels, lines or pages — positive zooms in, matching `onPinch`
   * (spreading two fingers is also positive).
   */
  onWheelZoom(notches: number): void;
}

/**
 * A second tap within this long of the first counts as a double-tap ("run
 * there") rather than two separate walks. Generous enough for small fingers,
 * short enough that two unrelated taps in a hurry don't get mistaken for one.
 */
const DOUBLE_TAP_MAX_MILLISECONDS = 350;

/**
 * How far apart, in CSS pixels, the two taps of a double-tap may land and
 * still count as "the same spot". Looser than `tapGesture.ts`'s
 * `TAP_MAX_DRIFT_PX` because
 * it is measured between two independent touches, not one finger's wobble.
 */
const DOUBLE_TAP_MAX_DRIFT = 40;

/**
 * Pinch sensitivity. A gesture that doubles the finger separation moves the zoom
 * by about `1.0`, which is most of the camera's range — brisk, but a pinch on a
 * small screen is a small movement and anything gentler feels broken.
 */
const PINCH_GAIN = 1.0;

/** WebKit-only gesture events, swallowed so the page never zooms. */
const SAFARI_GESTURES = ['gesturestart', 'gesturechange', 'gestureend'] as const;

/**
 * `WheelEvent.deltaY` arrives in one of three units — `DOM_DELTA_PIXEL`,
 * `DOM_DELTA_LINE` or `DOM_DELTA_PAGE` — and the three differ by roughly two
 * orders of magnitude, not by some fixed device factor: an ordinary mouse
 * wheel typically reports pixel-mode deltas around 100 per notch (Chrome,
 * Safari) or line-mode deltas around 3 per notch (Firefox on Windows); a
 * trackpad's two-finger scroll always reports pixel mode, in a stream of much
 * smaller deltas per event. A handler that reads `deltaY` raw feels right on
 * whichever browser it was written against and flies or crawls on the others.
 * Converting every mode to an estimated CSS-pixel distance first, then to a
 * device-independent "notch count", is what keeps one wheel click the same
 * size everywhere. `WHEEL_LINE_PIXELS` and `WHEEL_PAGE_PIXELS` are not
 * measured against a specific mouse — they only need to put line- and
 * page-mode events in the right ballpark relative to a pixel-mode notch.
 *
 * `WheelEvent.DOM_DELTA_LINE`/`DOM_DELTA_PAGE` are deliberately not read off
 * the `WheelEvent` constructor: this file's wheel handling has to stay
 * callable from a synthetic `Event` in tests, the same reasoning
 * `isTextEntryTarget` gives for duck-typing over `instanceof`.
 */
const WHEEL_NOTCH_PIXELS = 100;
const WHEEL_LINE_PIXELS = WHEEL_NOTCH_PIXELS / 3;
const WHEEL_PAGE_PIXELS = WHEEL_NOTCH_PIXELS * 8;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

/**
 * Exported for `ui/ParkMap.ts` (#359), which has its own wheel-to-zoom on the
 * map overlay. It first hand-copied `WHEEL_NOTCH_PIXELS` and divided by it
 * directly, which left this normalisation behind: measured live, five
 * Firefox line-mode notches moved the map's zoom to 1.03 where five
 * pixel-mode notches reached 2.80. A copied number that leaves its owner's
 * logic behind is this repo's most common bug, so the function is shared
 * rather than the constant.
 *
 * Normalises a wheel/trackpad event to a signed "notch count" — see
 * {@link WHEEL_NOTCH_PIXELS}. Positive means "zoom in": wheel-up (and a
 * trackpad two-finger scroll up) is a *negative* `deltaY` by platform
 * convention, on both a plain wheel and macOS's "natural" scrolling — the OS
 * already folds that preference into the sign it hands the browser, so there
 * is deliberately no separate case for it here. Guessing at "natural" from
 * inside the page would be guessing at something the platform already solved.
 */
export function wheelNotches(event: WheelEvent): number {
  const pixels =
    event.deltaMode === DOM_DELTA_LINE
      ? event.deltaY * WHEEL_LINE_PIXELS
      : event.deltaMode === DOM_DELTA_PAGE
        ? event.deltaY * WHEEL_PAGE_PIXELS
        : event.deltaY; // DOM_DELTA_PIXEL, and the sane fallback for anything else
  return -pixels / WHEEL_NOTCH_PIXELS;
}

interface ActivePointer extends TapCandidate {
  x: number;
  y: number;
  /**
   * True only if this pointer's very first event actually hit our own
   * canvas — see "Why window, not the canvas" above `attach`. A finger that
   * came down over a HUD button, an action chip, or any other tap target
   * still counts fully towards recognising and measuring a pinch; it just
   * can never itself become a tap, a walk, or a hover, and it is
   * disqualified from the moment it is created rather than only once it
   * drifts, so a press-and-release on that button can never *also* read as a
   * tap on whatever is in the park behind it.
   */
  readonly startedOnCanvas: boolean;
  /** Set once a second finger lands, or once the drift budget is spent. */
  disqualified: boolean;
  /**
   * Set once this pointer has drifted past `tapGesture.ts`'s slop while alone
   * on the canvas: it is a look-around drag from here until it lifts.
   *
   * Separate from {@link disqualified} because that flag has three causes and
   * only one of them is a drag — a pointer that started on a HUD button, or one
   * that was drafted into a pinch, is disqualified too, and neither should pan
   * the park.
   */
  looking: boolean;
  /**
   * Set for good the moment a second finger joins, so lifting one finger of a
   * pinch cannot leave the other one panning the park. `ParkMap`'s `hadTwo`
   * guards its own tap against exactly this.
   */
  pinched: boolean;
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

  private readonly canvas: HTMLCanvasElement;
  private readonly options: PointerControlsOptions;

  constructor(
    canvas: HTMLCanvasElement,
    options: PointerControlsOptions,
  ) {
    this.canvas = canvas;
    this.options = options;
  }

  /**
   * Why `window`, capture phase, not the canvas (issue #282).
   *
   * `#ui-root` sits on top of the canvas the whole game long, and its
   * interactive children — the menu pill, an action chip floating "over the
   * item itself", the hop/fly button, a minigame hotspot — are real DOM
   * elements with `pointer-events: auto`. A finger that comes down on one of
   * them hit-tests to *that* element, never to the canvas, so a
   * canvas-scoped `pointerdown` listener simply never fires for it — no
   * `stopPropagation` involved, the event never reaches the canvas at all.
   * Pinch needs exactly two fingers tracked to compute a distance; losing
   * either one to whatever happened to be underneath it silently breaks the
   * gesture, which is exactly what was reported: pinch "sometimes" doesn't
   * work, precisely when a finger starts over a button or a chip.
   *
   * Listening on `window` in the capture phase instead — the same pattern
   * `core/rideLook.ts`, `minigames/dodgems/steering.ts` and
   * `minigames/waterFight/controls.ts` already use for their own input —
   * means this file sees every pointer down anywhere on the page, before the
   * element underneath it and before anything of its own could call
   * `stopPropagation`. It changes nothing about what that element does:
   * this file never calls `preventDefault` or `stopPropagation` on a pointer
   * that didn't start on the canvas, so the button still presses normally.
   * `startedOnCanvas` on {@link ActivePointer} is what keeps a tap, a walk
   * and a hover exactly as canvas-only as they always were — only pinch
   * recognition widens to the whole page.
   */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('pointermove', this.onPointerMove, true);
    window.addEventListener('pointerup', this.onPointerUp, true);
    window.addEventListener('pointercancel', this.onPointerCancel, true);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('dblclick', preventDefault);
    this.canvas.addEventListener('contextmenu', preventDefault);
    // `{ passive: false }` is what makes `preventDefault()` inside `onWheel`
    // actually stop the page/browser from scrolling or zooming — spelled out
    // rather than relied on as a default, since that default is exactly the
    // kind of thing a future browser change could quietly flip. Kept on the
    // canvas, unlike the pointer listeners above: a wheel notch is only ever
    // the desktop zoom gesture when it happens directly over the park, and
    // this is what keeps the shop, the Cute-o-dex and character creation
    // scrolling normally without this file needing to know they exist (see
    // issue #189).
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    // Safari on iOS still fires its own pinch and double-tap zoom gestures on
    // top of pointer events; without these the whole page scales instead of
    // the camera. Also moved to `window`/capture for the same reason as the
    // pointer listeners above: the gesture that needs swallowing can start
    // over a HUD button exactly as easily as it can start over the park.
    // They are not in the DOM typings, hence the EventTarget view.
    for (const type of SAFARI_GESTURES) {
      (window as EventTarget).addEventListener(type, preventDefault, true);
    }
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('pointermove', this.onPointerMove, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);
    window.removeEventListener('pointercancel', this.onPointerCancel, true);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('dblclick', preventDefault);
    this.canvas.removeEventListener('contextmenu', preventDefault);
    this.canvas.removeEventListener('wheel', this.onWheel);
    for (const type of SAFARI_GESTURES) {
      (window as EventTarget).removeEventListener(type, preventDefault, true);
    }
    this.pointers.clear();
  }

  // ------------------------------------------------------------- handlers

  private readonly onPointerDown = (event: PointerEvent): void => {
    const startedOnCanvas = event.target === this.canvas;
    // A mouse can never pinch — the only thing a mouse pointer could ever
    // become here is a tap — so one that didn't land on the canvas (or used
    // a right/middle button) isn't worth tracking at all, exactly as when
    // this listener lived on the canvas alone.
    if (event.pointerType === 'mouse' && (event.button !== 0 || !startedOnCanvas)) return;
    // Pointer capture is a canvas-only trick for keeping a tap's `pointerup`
    // coming to *us* even if the finger drifts — see `capture`'s doc comment.
    // Taking it for a pointer that started on a button would steal that
    // button's own `pointerup`/`pointerleave`, which is exactly the kind of
    // interference this file must not cause.
    if (startedOnCanvas) capture(this.canvas, event.pointerId, true);

    this.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      // `event.timeStamp`, not `performance.now()` — see `TapCandidate`.
      ...tapCandidate(event.clientX, event.clientY, event.timeStamp),
      startedOnCanvas,
      // A pointer that didn't start on the canvas can never itself be a tap
      // — see `ActivePointer.startedOnCanvas` — but it still fully counts
      // towards recognising and measuring a pinch below.
      disqualified: !startedOnCanvas,
      looking: false,
      pinched: false,
    });

    // Second finger down: this is a pinch, so neither finger is a tap any more
    // — nor a look-around drag, for as long as either of them is on the glass.
    if (this.pointers.size === 2) {
      for (const pointer of this.pointers.values()) {
        pointer.disqualified = true;
        pointer.looking = false;
        pointer.pinched = true;
      }
      this.pinchDistance = this.currentPinchDistance();
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    // Hover is reported whether or not a button is down, and whether or not this
    // pointer is one we are tracking for a tap — the highlight follows the mouse
    // even while it is being dragged across the park. Restricted to the canvas
    // itself (unlike the tracking below, which now sees the whole page): a mouse
    // gliding over a HUD panel must not raycast into the park underneath it.
    if (event.pointerType === 'mouse' && event.target === this.canvas) this.reportHover(event);

    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    const stepX = event.clientX - pointer.x;
    const stepY = event.clientY - pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    // The shared definition, not a local one — see `tapGesture.ts`.
    if (tapDriftedTooFar(pointer, event.clientX, event.clientY)) {
      pointer.disqualified = true;
      // ...and the same instant, and off the same answer, this becomes a
      // look-around drag (#419). One question, asked once: a gesture cannot be
      // both, and cannot be neither.
      if (pointer.startedOnCanvas && !pointer.pinched && this.pointers.size === 1) {
        pointer.looking = true;
      }
    }

    // Per-step, and reported after the flag is set, so the very move that
    // crossed the slop line already pans. The 18 px spent *reaching* that line
    // are deliberately not replayed: they are the cost of the game having
    // waited to find out whether this was a tap, and pouring them in at once
    // would start every look-around with a lurch. `ParkMap` swallows the same
    // 18 px for the same reason, which is a second sense in which this is the
    // map's gesture and not a new one.
    if (pointer.looking) this.options.onLookDrag?.(stepX, stepY);

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
    if (pointer?.startedOnCanvas) capture(this.canvas, event.pointerId, false);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (!pointer || pointer.disqualified) return;
    const now = event.timeStamp;
    // Down and up in the same place, soon enough: `tapGesture.ts`'s one
    // definition of a definite tap, shared with the park map.
    if (!completesTap(pointer, event.clientX, event.clientY, now)) return;

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

  /**
   * The desktop equivalent of {@link onPointerMove}'s pinch branch — a wheel
   * notch or trackpad scroll, converted to a notch count and handed straight
   * to {@link PointerControlsOptions.onWheelZoom}. `preventDefault` always
   * fires (the page must never scroll or zoom under a wheel that landed on the
   * canvas); it is the caller's own business, not this file's, whether a ride
   * in progress means the notch should actually move the camera.
   */
  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.options.onWheelZoom(wheelNotches(event));
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
 * Exported for `ui/ParkMap.ts` (#359), which called `setPointerCapture` raw
 * and inherited exactly the throw this documents — and worse, called it
 * *first*, so when it threw the rest of the handler never ran and a pan or
 * pinch silently failed to start.
 *
 * The try/catch is not defensive padding: `setPointerCapture` throws
 * `NotFoundError` whenever the id is not an *active* pointer, and a tap quick
 * enough to have already been released — or one synthesised by a test — is
 * exactly that. Losing the capture is harmless; losing the tap is not.
 */
export function capture(canvas: HTMLCanvasElement, pointerId: number, take: boolean): void {
  try {
    if (take) canvas.setPointerCapture(pointerId);
    else canvas.releasePointerCapture(pointerId);
  } catch {
    // Nothing to do: the pointer has already gone.
  }
}
