import type { RaceLevel } from '../world/railRace/hazards';
import {
  createPortraitStrip,
  type PortraitInfo,
  type PortraitStrip,
} from '../minigames/portraitStrip';

/** Spelled out rather than computed: four racers, four words, no arithmetic. */
const PLACE_NAMES: readonly string[] = ['1st', '2nd', '3rd', '4th'];

/**
 * The Rail Race's framing: which level, the 3-2-1, the lap, and how it ended.
 *
 * The race happens out in the real park rather than inside the mini-game
 * framework, so it cannot borrow `minigames/overlay.ts` — that layer only
 * exists while a mini-game owns the screen. This is the park's own equivalent,
 * living in the HUD root and styled from `src/style.css` like everything else
 * the park owns.
 *
 * ### It is also the phone's whole control scheme
 *
 * `Game.screenIsBusy()` hides the touch controls while a ride has hold of you,
 * which is right for the train and the Sky Cruiser and would have made the
 * race literally unplayable on a phone: tapping fast is the whole game, and a
 * tiny on-screen button is not something a small thumb can find and re-find
 * many times a second. So this layer takes the mini-game framework's answer,
 * for the mini-game framework's reason: **the whole screen is the pad**,
 * because the most reliable target a small hand can find is "anywhere" — and
 * it now has to tell two gestures apart on that one pad, since boost and duck
 * are separate controls (2 August 2026 tap-rate rework):
 *
 * - A quick tap, released before it has dragged far, is a **boost press** —
 *   queued in {@link pendingBoostPresses} and drained once a frame by
 *   `RailRace` via {@link takeBoostPresses}, never read as a level, because a
 *   press is a discrete event and a finger can tap faster than a frame.
 * - A finger that drags down past {@link DUCK_DRAG_PX} before release enters
 *   **duck**, held for as long as it stays down there — read every frame via
 *   {@link ducking}. One finger cannot do both at once, which is the same
 *   trade-off duck-vs-boost has on a keyboard (see `simulate.ts`'s header):
 *   being safe costs you the speed.
 *
 * Everything else in here is `pointer-events: none`, so no pill, banner,
 * countdown digit or level card can ever swallow a press meant for the pad
 * underneath it — except the level cards themselves while they're shown,
 * which are real buttons and need to catch a tap on purpose.
 */

/** How far a finger has to drag down, in CSS pixels, before it counts as duck rather than a tap. */
const DUCK_DRAG_PX = 40;

interface RacePointer {
  readonly startY: number;
  ducking: boolean;
}

const LEVEL_COPY: readonly { readonly level: RaceLevel; readonly title: string; readonly line: string }[] = [
  { level: 1, title: 'Level 1', line: 'Clear track — just for fun!' },
  { level: 2, title: 'Level 2', line: 'Watch out for the black spark track!' },
  { level: 3, title: 'Level 3', line: 'Spark track AND duck-under bars!' },
];

export class RaceHud {
  private readonly root: HTMLElement;
  private readonly pad: HTMLElement;
  private readonly levels: HTMLElement;
  private readonly lap: HTMLElement;
  private readonly count: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bonk: HTMLElement;

  private readonly pointers = new Map<number, RacePointer>();
  private pendingBoostPresses = 0;

  /**
   * The four racers' heads along the top, in running order.
   *
   * Built on boarding rather than in the constructor, because who is racing —
   * and what colour the player's own hair is — is not known until then. Torn
   * down on `setShown(false)`, the same moment everything else on this layer
   * is cleared.
   */
  private portraits: PortraitStrip | null = null;

  /** Fires the moment a level card is tapped or clicked. Wired by `Game`. */
  onChooseLevel: ((level: RaceLevel) => void) | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'racehud';
    this.root.dataset.shown = 'false';

    this.pad = document.createElement('div');
    this.pad.className = 'racehud-pad';
    // pointerdown/up rather than click, exactly as `ui/ScreenControls.ts`: a
    // game control must answer on the way down (to start tracking a possible
    // duck-drag) and on the way up (to know whether it ended as a tap).
    this.pad.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.pointers.set(event.pointerId, { startY: event.clientY, ducking: false });
    });
    this.pad.addEventListener('pointermove', (event) => {
      const pointer = this.pointers.get(event.pointerId);
      if (!pointer || pointer.ducking) return;
      if (event.clientY - pointer.startY > DUCK_DRAG_PX) pointer.ducking = true;
    });
    const release = (event: PointerEvent): void => {
      const pointer = this.pointers.get(event.pointerId);
      this.pointers.delete(event.pointerId);
      // A pointer that never crossed the drag threshold was a tap, not a duck
      // — queue a boost press. One that was already ducking just ends the
      // duck; it was never a tap and does not also fire a press on release.
      if (pointer && !pointer.ducking) this.pendingBoostPresses += 1;
    };
    this.pad.addEventListener('pointerup', release);
    this.pad.addEventListener('pointercancel', release);
    this.pad.addEventListener('pointerleave', release);
    this.pad.addEventListener('contextmenu', (event) => event.preventDefault());

    this.levels = document.createElement('div');
    this.levels.className = 'racehud-levels';
    this.levels.dataset.shown = 'false';
    const tip = document.createElement('div');
    tip.className = 'racehud-levels-tip';
    tip.textContent = 'Tap the screen as fast as you can to zoom ahead!';
    this.levels.append(tip);
    for (const { level, title, line } of LEVEL_COPY) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'racehud-level';
      const strong = document.createElement('strong');
      strong.textContent = title;
      const span = document.createElement('span');
      span.textContent = line;
      button.append(strong, span);
      button.addEventListener('click', () => this.onChooseLevel?.(level));
      this.levels.append(button);
    }

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

    this.root.append(this.pad, this.levels, this.lap, this.count, this.banner, this.bonk);
    container.append(this.root);
  }

  /**
   * Drains every boost press queued since the last call — `RailRace` calls
   * this once a frame. Draining rather than peeking means a tap that lands
   * and lifts between two frames is never lost, and two taps in one frame
   * both count.
   */
  takeBoostPresses(): number {
    const presses = this.pendingBoostPresses;
    this.pendingBoostPresses = 0;
    return presses;
  }

  /** True while any finger is doing the drag-down-and-hold duck gesture. */
  get ducking(): boolean {
    for (const pointer of this.pointers.values()) {
      if (pointer.ducking) return true;
    }
    return false;
  }

  /** Shows or hides the whole layer. Hiding clears everything on it. */
  setShown(shown: boolean): void {
    this.root.dataset.shown = shown ? 'true' : 'false';
    if (!shown) {
      this.pointers.clear();
      this.pendingBoostPresses = 0;
      this.setLevelSelect(false);
      this.setCount(null);
      this.setLap(null);
      this.setBanner(null);
      this.bonk.dataset.shown = 'false';
      this.portraits?.dispose();
      this.portraits = null;
    }
  }

  /** The "which level?" screen, shown after boarding and before the countdown. */
  setLevelSelect(shown: boolean): void {
    this.levels.dataset.shown = shown ? 'true' : 'false';
  }

  /**
   * Puts up a head for every racer, along the top edge.
   *
   * The same shared `createPortraitStrip` the water fight and the dodgems use
   * — painted faces, name labels, the pop — asked for its `row` layout rather
   * than the two banks, because this strip is a *running order* and an order
   * split across the left and right edges of the screen is not one. See
   * `minigames/portraitStrip.ts`.
   *
   * Order in `racers` is the caller's own and is never re-derived: index `i`
   * here is index `i` in every {@link setStandings} call after it.
   */
  setRacers(racers: readonly PortraitInfo[]): void {
    this.portraits?.dispose();
    this.portraits = createPortraitStrip(this.root, racers, { layout: 'row' });
  }

  /**
   * Who is currently winning: `order` holds racer indices, leader first.
   *
   * Both the place text and the left-to-right position come from this one
   * call, so the label under a head and where that head sits can never
   * disagree. Position is CSS `order`, so nothing moves in the DOM.
   */
  setStandings(order: readonly number[]): void {
    const strip = this.portraits;
    if (!strip) return;
    order.forEach((racer, place) => {
      strip.setOrder(racer, place);
      strip.setSubtitle(racer, PLACE_NAMES[place] ?? `${place + 1}th`);
    });
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
    this.portraits?.dispose();
    this.portraits = null;
    this.root.remove();
  }
}
