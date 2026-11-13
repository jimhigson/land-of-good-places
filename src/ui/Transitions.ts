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
  /** Counts wipes, so a reveal that a newer wipe overtook during its hold does not open the newer one's iris. */
  private wipeSerial = 0;
  /**
   * What must be done behind the shut iris, after the midpoint and before it
   * opens — `Game`'s `RevealHold` (`core/viewWarmup.ts`): the view the
   * midpoint has just put behind the iris, warmed, so the first frame it
   * opens on links no program and uploads nothing. Null until the game sets
   * it, and then the iris opens straight after the midpoint as it always did.
   */
  private holdOpen: (() => Promise<void>) | null = null;

  constructor(container: HTMLElement) {
    this.iris = document.createElement('div');
    this.iris.className = 'iris';
    this.iris.dataset.closed = 'false';
    this.iris.style.setProperty('--iris-close', `${IRIS_CLOSE_SECONDS}s`);
    this.iris.style.setProperty('--iris-open', `${IRIS_OPEN_SECONDS}s`);
    const eye = document.createElement('div');
    eye.className = 'iris-eye';
    this.iris.append(eye);
    // The "still on its way" dots, shown only while a held wipe waits on a
    // room (`irisWipe`'s `ready`) — see `.iris-wait` in style.css.
    const wait = document.createElement('div');
    wait.className = 'iris-wait';
    wait.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
    this.iris.append(wait);

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
   * The work the iris waits for between its midpoint and opening — see
   * {@link holdOpen}. Set once, by `Game`.
   */
  setHoldOpen(hold: () => Promise<void>): void {
    this.holdOpen = hold;
  }

  /**
   * Closes the iris, runs `midpoint` behind it, then opens it again.
   *
   * `midpoint` is where the world changes — the teleport, the camera snap, the
   * collision boundary moving. It runs exactly once, on a timer rather than on a
   * transition event, because a backgrounded tab never fires `transitionend` and
   * a child coming back to the game would find the screen permanently dark.
   *
   * `ready`, when given, holds the iris shut until it settles. **A function is
   * called only once the iris is shut**, and its promise waited on: work that
   * must not be seen — building a room (`SpaceManager.changeToFurnished`) —
   * starts behind the closed iris rather than in the frame that asked for it,
   * which is a frame a child is still looking at.
   *
   * After the midpoint, the iris stays shut until {@link holdOpen} says the
   * view behind it is warm (`core/viewWarmup.ts`).
   */
  irisWipe(midpoint: () => void, onOpened?: () => void, ready?: Promise<unknown> | (() => Promise<unknown>)): void {
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
    const serial = ++this.wipeSerial;
    // **`ready`: hold shut until a room being fetched has landed** (a lazy
    // interior, `world/LazyPart.ts`). Settled either way — a failed fetch still
    // runs the midpoint, which is the owner's to refuse, so the iris can never
    // stay shut for ever. A promise is watched from now; a function is not
    // called until the iris is shut (see above).
    let settled = ready === undefined;
    if (ready !== undefined && typeof ready !== 'function') {
      ready.then(
        () => (settled = true),
        () => (settled = true),
      );
    }
    const reveal = (): void => {
      // A newer wipe started while this one held: it owns the iris now.
      if (serial !== this.wipeSerial) return;
      this.iris.dataset.closed = 'false';
      this.openTimer = window.setTimeout(() => {
        this.irisRunning = false;
        onOpened?.();
      }, IRIS_OPEN_SECONDS * 1000);
    };
    const open = (): void => {
      if (this.pendingMidpoint !== midpoint) return;
      this.pendingMidpoint = null;
      midpoint();
      // **Still shut until what the midpoint put behind it is warm**: its
      // programs linked and its textures up, then drawn once where nobody sees
      // the frame it costs (`core/viewWarmup.ts`). Without this the first frame
      // of a new room is the one that links its programs — 44–111 ms measured,
      // on the frame the iris starts opening.
      const held = this.holdOpen?.();
      if (held) held.then(reveal, reveal);
      else reveal();
    };
    this.closeTimer = window.setTimeout(() => {
      const waitFor = typeof ready === 'function' ? ready() : ready;
      if (settled || !waitFor) {
        open();
        return;
      }
      this.iris.dataset.waiting = 'true';
      const done = (): void => {
        delete this.iris.dataset.waiting;
        open();
      };
      waitFor.then(done, done);
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
