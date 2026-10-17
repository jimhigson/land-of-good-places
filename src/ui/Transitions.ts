import {
  IRIS_CLOSE_SECONDS,
  IRIS_OPEN_SECONDS,
  STAIR_RIDE_FADE_SECONDS,
} from '../core/constants';

/**
 * The cute wipes: an iris for changing space, and a whoosh for fast-forward.
 *
 * Both are plain DOM over the canvas, for the same reason the HUD is: they are
 * crisp at any resolution, they cost the renderer nothing, and a CSS transition
 * keeps running smoothly even on the frame where the game teleports a child six
 * hundred metres sideways into the building's own space.
 *
 * **The iris is not decoration — it is load-bearing.** Walking through the front
 * door moves the player into a different place entirely, and the camera has to
 * be snapped rather than followed there. Doing that behind a closed iris is the
 * difference between "you went inside" and "the screen glitched".
 */
export class Transitions {
  private readonly iris: HTMLElement;
  private readonly whoosh: HTMLElement;
  private readonly flashPane: HTMLElement;

  private closeTimer = 0;
  private openTimer = 0;
  private flashTimer = 0;
  private irisRunning = false;
  /** The midpoint of a wipe still closing — see {@link irisWipe}. */
  private pendingMidpoint: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.iris = document.createElement('div');
    this.iris.className = 'iris';
    this.iris.dataset.closed = 'false';
    this.iris.style.setProperty('--iris-close', `${IRIS_CLOSE_SECONDS}s`);
    this.iris.style.setProperty('--iris-open', `${IRIS_OPEN_SECONDS}s`);
    const eye = document.createElement('div');
    eye.className = 'iris-eye';
    this.iris.append(eye);

    this.whoosh = document.createElement('div');
    this.whoosh.className = 'whoosh';
    this.whoosh.dataset.on = 'false';
    this.whoosh.style.setProperty('--whoosh-fade', `${STAIR_RIDE_FADE_SECONDS}s`);

    this.flashPane = document.createElement('div');
    this.flashPane.className = 'flash';
    this.flashPane.dataset.on = 'false';

    container.append(this.whoosh, this.flashPane, this.iris);
  }

  /**
   * Closes the iris, runs `midpoint` behind it, then opens it again.
   *
   * `midpoint` is where the world changes — the teleport, the camera snap, the
   * collision boundary moving. It runs exactly once, on a timer rather than on a
   * transition event, because a backgrounded tab never fires `transitionend` and
   * a child coming back to the game would find the screen permanently dark.
   */
  irisWipe(midpoint: () => void, onOpened?: () => void): void {
    window.clearTimeout(this.closeTimer);
    window.clearTimeout(this.openTimer);
    // **A wipe that starts while another is still closing runs the first one's
    // midpoint now**, rather than dropping it with its timer. A midpoint is a
    // change to the world — a ride's camera handed back, a gondola put away —
    // and losing one leaves it undone for good: the "Next day" button lets a
    // ride go (whose exit starts a wipe) and starts its own wipe in the same
    // frame, and the ride's camera stayed the one being drawn in the suite.
    const pending = this.pendingMidpoint;
    this.pendingMidpoint = null;
    pending?.();

    this.irisRunning = true;
    this.iris.dataset.closed = 'true';
    this.pendingMidpoint = midpoint;
    this.closeTimer = window.setTimeout(() => {
      this.pendingMidpoint = null;
      midpoint();
      this.iris.dataset.closed = 'false';
      this.openTimer = window.setTimeout(() => {
        this.irisRunning = false;
        onOpened?.();
      }, IRIS_OPEN_SECONDS * 1000);
    }, IRIS_CLOSE_SECONDS * 1000);
  }

  /**
   * True from the moment the iris starts closing until it has finished opening
   * again — which is to say, while the player is being moved between spaces.
   *
   * The autosave asks (see `SaveSystem`): a position sampled halfway through a
   * teleport is the one coordinate that could strand a child somewhere she
   * cannot walk out of.
   */
  get wiping(): boolean {
    return this.irisRunning;
  }

  /** The speed-lines vignette, on while the world is running fast. */
  setWhoosh(on: boolean): void {
    const value = on ? 'true' : 'false';
    if (this.whoosh.dataset.on !== value) this.whoosh.dataset.on = value;
  }

  /** A quick soft blink — "you have arrived". */
  flash(): void {
    window.clearTimeout(this.flashTimer);
    this.flashPane.dataset.on = 'true';
    this.flashTimer = window.setTimeout(() => {
      this.flashPane.dataset.on = 'false';
    }, 90);
  }

  dispose(): void {
    window.clearTimeout(this.closeTimer);
    window.clearTimeout(this.openTimer);
    window.clearTimeout(this.flashTimer);
    this.iris.remove();
    this.whoosh.remove();
    this.flashPane.remove();
  }
}
