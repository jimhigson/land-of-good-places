/**
 * The Rail Race's framing: the 3-2-1, the lap, and how it ended.
 *
 * The race happens out in the real park rather than inside the mini-game
 * framework, so it cannot borrow `minigames/overlay.ts` — that layer only
 * exists while a mini-game owns the screen. This is the park's own equivalent,
 * living in the HUD root and styled from `src/style.css` like everything else
 * the park owns.
 *
 * ### It is also the phone's go button
 *
 * `Game.screenIsBusy()` hides the touch controls while a ride has hold of you,
 * which is right for the train and the Sky Cruiser and would have made the
 * race literally unplayable on a phone: holding is the whole game, and the hop
 * button — the only thing bound to `jump` a finger can reach — is hidden the
 * moment she boards. So this layer takes the mini-game framework's answer, for
 * the mini-game framework's reason: **the whole screen is the button**, because
 * the most reliable button a small hand can find is "anywhere". `holding` is
 * read by `world/coaster/Coaster.ts` alongside the keyboard, never instead of
 * it.
 *
 * Everything else in here is `pointer-events: none`, so no pill, banner or
 * countdown digit can ever swallow a press meant for the pad underneath.
 */
export class RaceHud {
  private readonly root: HTMLElement;
  private readonly pad: HTMLElement;
  private readonly lap: HTMLElement;
  private readonly count: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bonk: HTMLElement;

  /** True while a finger (or a mouse) is down on the pad. */
  private held = false;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'racehud';
    this.root.dataset.shown = 'false';

    this.pad = document.createElement('div');
    this.pad.className = 'racehud-pad';
    // pointerdown/up rather than click, exactly as `ui/ScreenControls.ts`: a
    // game control must answer on the way down, and this one has to answer on
    // the way *up* too, which `click` cannot express at all.
    this.pad.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.held = true;
    });
    const release = (): void => {
      this.held = false;
    };
    this.pad.addEventListener('pointerup', release);
    this.pad.addEventListener('pointercancel', release);
    this.pad.addEventListener('pointerleave', release);
    this.pad.addEventListener('contextmenu', (event) => event.preventDefault());

    this.lap = document.createElement('div');
    this.lap.className = 'racehud-lap';

    this.count = document.createElement('div');
    this.count.className = 'racehud-count';

    this.banner = document.createElement('div');
    this.banner.className = 'racehud-banner';

    this.bonk = document.createElement('div');
    this.bonk.className = 'racehud-bonk';
    // Always the same friendly nudge, never a scold — GAME_DESIGN.md's "you
    // cannot fail": a bonk is a wobble and lost speed, not a failure state.
    this.bonk.textContent = 'Whoops — duck a little sooner!';

    this.root.append(this.pad, this.lap, this.count, this.banner, this.bonk);
    container.append(this.root);
  }

  /** What `Coaster` asks every frame: is she holding? */
  get holding(): boolean {
    return this.held;
  }

  /** Shows or hides the whole layer. Hiding clears everything on it. */
  setShown(shown: boolean): void {
    this.root.dataset.shown = shown ? 'true' : 'false';
    if (!shown) {
      this.held = false;
      this.setCount(null);
      this.setLap(null);
      this.setBanner(null);
      this.bonk.dataset.shown = 'false';
    }
  }

  /** The big centred digit: '3', '2', '1', 'GO!'. `null` clears it. */
  setCount(text: string | null): void {
    if (text === null) {
      this.count.dataset.shown = 'false';
      return;
    }
    // Re-trigger the pop animation by swapping the flag off and on: the same
    // element with new text would otherwise keep the animation it is mid-way
    // through and the '2' would appear already full size.
    this.count.dataset.shown = 'false';
    this.count.textContent = text;
    // Reading `offsetWidth` forces the style change above to be committed
    // before the one below, which is what actually restarts the animation.
    void this.count.offsetWidth;
    this.count.dataset.shown = 'true';
  }

  /**
   * A brief, friendly word when she bonks a duck bar.
   *
   * Fire-and-forget, unlike `setCount`/`setLap`/`setBanner`: a bonk is a
   * one-off moment with nothing to clear it later, so the CSS animation pops
   * it in and fades it back out on its own. Re-triggered the same way as
   * `setCount` — flag off, then on, with a forced reflow between — so two
   * bonks close together each get their own pop rather than the second being
   * swallowed by the first's animation still running.
   */
  flashBonk(): void {
    this.bonk.dataset.shown = 'false';
    void this.bonk.offsetWidth;
    this.bonk.dataset.shown = 'true';
  }

  /** 'Lap 1 of 2', or `null` for nothing. */
  setLap(text: string | null): void {
    this.lap.textContent = text ?? '';
    this.lap.dataset.shown = text === null ? 'false' : 'true';
  }

  /**
   * The end of the race.
   *
   * Never mean: this is Land of Good Places and the losing card says "so
   * close!" and invites her to go again, because a six-year-old who is told
   * she lost stops pressing the thing. `null` clears the banner.
   */
  setBanner(result: 'won' | 'lost' | null): void {
    if (result === null) {
      this.banner.dataset.shown = 'false';
      this.banner.replaceChildren();
      return;
    }
    const title = document.createElement('strong');
    const line = document.createElement('span');
    if (result === 'won') {
      title.textContent = '🏆 You won!';
      line.textContent = 'First past the bunting!';
    } else {
      title.textContent = '💛 So close!';
      line.textContent = 'Again? You nearly had them!';
    }
    this.banner.replaceChildren(title, line);
    this.banner.dataset.shown = 'true';
  }

  dispose(): void {
    this.root.remove();
  }
}
