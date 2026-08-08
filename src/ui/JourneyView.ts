import type { JourneyView as JourneyViewMode } from '../world/entrance/BusJourney';

/**
 * **"Look inside!" — the button that puts her on the bus.**
 *
 * Jim, 7 August 2026:
 *
 * > *"we would like to be able to see inside the bus, switch between the view
 * > inside of the children riding it and looking excited and the outside."*
 *
 * Three decisions, each one made rather than fallen into:
 *
 * 1. **On offer from the very first frame**, unlike `JourneySkip`, which has to
 *    wait for a park to exist. There is nothing to wait for here — the bus and
 *    the children on it are the only things that have been built yet — and a
 *    control that appears partway through a twenty-second ride is one a
 *    six-year-old discovers at second nineteen.
 * 2. **The label says where you are going, not where you are.** It reads *"Look
 *    inside!"* while you are outside and *"Look outside!"* while you are in.
 *    A toggle labelled with its own current state is the classic way to make a
 *    child press it twice and end up back where she started.
 * 3. **It is not a `Game` overlay**, and it is mounted on `document.body` rather
 *    than `#ui-root`, for the reason `JourneySkip` gives at length: `Hud`'s
 *    constructor *empties* `#ui-root`, and `Hud` is built by `new Game(...)`,
 *    which happens in the middle of the ride. Put in `#ui-root` this button
 *    would be silently deleted halfway through the journey it belongs to.
 */
export class JourneyView {
  private readonly root: HTMLElement;
  private readonly button: HTMLButtonElement;
  private handler: (() => void) | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'journey-view';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'journey-view__button';
    this.button.addEventListener('click', () => this.handler?.());
    this.root.append(this.button);
    document.body.append(this.root);

    // Starts describing the ride's own starting view, so the button and the
    // camera cannot disagree on the first frame — the two are set from one
    // value rather than each assuming the other.
    this.setView('outside');
  }

  /** What the button currently says. Exposed so a check can read it. */
  get label(): string {
    return this.button.textContent ?? '';
  }

  onPress(handler: () => void): void {
    this.handler = handler;
  }

  /**
   * Told what the camera is now doing, and labels itself for the *other* one.
   *
   * Driven from `BusJourney.toggleView`'s return value rather than from a copy
   * of the state kept here: one owner for "which view are we in", which is the
   * rule that would have prevented half the bugs on this feature.
   */
  setView(view: JourneyViewMode): void {
    this.button.textContent = view === 'outside' ? 'Look inside! 🚌' : 'Look outside! 🌳';
  }

  dispose(): void {
    this.handler = null;
    this.root.remove();
  }
}
