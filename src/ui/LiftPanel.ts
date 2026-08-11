import type { FrameContext, GameSystem } from '../core/types';
import type { FloorInfo, LiftPanelMode, LiftPanelSource } from '../world/building/liftRide';
import { playLiftDing, playOpenChime } from './chime';

/**
 * The lift's control panel — a lovely toy version of a real one.
 *
 * The family's note (GAME_DESIGN.md, "Riding the lift"): walk near the lift and
 * **a call button appears, styled like a real elevator control panel**; press it
 * and the lift comes; you get on automatically; **the panel then shows all the
 * floors** and pressing one takes you **straight there**.
 *
 * So it is a brushed-metal plate screwed to the side of the screen, with a
 * floor readout at the top and round glowing buttons under it, and it has
 * exactly two faces: one enormous call button when you are waiting at the
 * doors, and the list of floors once you are in the car. Nothing else, ever —
 * a six-year-old should never have to read this panel, only press the round
 * thing that is lit.
 *
 * **It talks to the world through two methods.** `floors()` and `go(n)` (see
 * `world/building/liftRide.ts`) are the seam ARCHITECTURE-DECISIONS Decision 3
 * names: when castle floors become separate spaces the lift is re-conceived as
 * an any-floor portal and nothing real travels, but those two methods still
 * mean exactly what they mean now, so this file survives the change unedited.
 * `panelState()` and `call()` are today's proximity-and-summon glue and are
 * expected to disappear with the car.
 *
 * The buttons are ordinary `<button>`s, so the HIGHLIGHT RULE's rainbow
 * outline, pointer cursor and activation flash all arrive for free from
 * `style.css` and `ui/TapBurst.ts`. Nothing here draws a highlight of its own.
 */
export class LiftPanel implements GameSystem {
  readonly name = 'liftPanel';

  private readonly root: HTMLElement;
  private readonly indicator: HTMLElement;
  private readonly callButton: HTMLButtonElement;
  private readonly floorList: HTMLElement;
  /** One row per floor, keyed by deck index; built once, then only re-lit. */
  private readonly floorButtons = new Map<number, HTMLButtonElement>();

  private mode: LiftPanelMode | null = null;
  private indicatorText = '';
  /** Last frame's `LiftPanelState.arrived`, so the ding fires once per arrival. */
  private wasArriving = false;

  private readonly lift: LiftPanelSource;
  private readonly isBlocked: () => boolean;

  constructor(
    container: HTMLElement,
    lift: LiftPanelSource,
    /** True while a shop, book, map, menu or overlay already owns the screen. */
    isBlocked: () => boolean,
  ) {
    this.lift = lift;
    this.isBlocked = isBlocked;
    this.root = document.createElement('div');
    this.root.className = 'lift-panel';
    this.root.dataset.show = 'false';

    const plate = document.createElement('div');
    plate.className = 'lift-plate';

    const head = document.createElement('div');
    head.className = 'lift-head';
    const glyph = document.createElement('span');
    glyph.className = 'lift-head-glyph';
    glyph.textContent = '🛗';
    this.indicator = document.createElement('span');
    this.indicator.className = 'lift-indicator';
    head.append(glyph, this.indicator);

    this.callButton = document.createElement('button');
    this.callButton.type = 'button';
    this.callButton.className = 'lift-call';
    this.callButton.setAttribute('aria-label', 'Call the lift');
    this.callButton.innerHTML =
      '<span class="lift-call-disc"><span class="lift-call-arrows">⬍</span></span>' +
      '<span class="lift-call-word">Call the lift</span>';
    this.callButton.addEventListener('click', () => {
      this.callButton.blur();
      playOpenChime();
      this.lift.call();
    });

    this.floorList = document.createElement('div');
    this.floorList.className = 'lift-floors';
    // Built once from the seam, because the set of floors in a building does
    // not change while a child is standing in it.
    for (const floor of this.lift.floors()) {
      const button = this.buildFloorButton(floor);
      this.floorButtons.set(floor.index, button);
      this.floorList.append(button);
    }

    plate.append(head, this.callButton, this.floorList);
    this.root.append(plate);
    container.append(this.root);
  }

  /**
   * True while the panel is under her hand and waiting to be pressed.
   *
   * `world/InteractRouter.ts` reads this as a claim. It is exclusive rather than
   * a proximity test: the panel is either showing a pressable face or it is
   * not, and while it is, the lift is the thing she is using.
   */
  get awaitingPress(): boolean {
    if (this.isBlocked()) return false;
    const mode = this.lift.panelState()?.mode;
    return mode === 'call' || mode === 'floors';
  }

  /**
   * E — the game's "use this" key — works the panel too, so a keyboard or
   * controller player never has to reach for the mouse. It presses the button
   * rather than calling the seam directly, so the rainbow activation flash and
   * the chime come along exactly as they do for a finger.
   */
  pressFocused(): void {
    const state = this.isBlocked() ? null : this.lift.panelState();
    if (!state) return;
    if (state.mode === 'call') this.callButton.click();
    else if (state.mode === 'floors') this.focusedFloor()?.click();
  }

  update(_context: FrameContext): void {
    const state = this.isBlocked() ? null : this.lift.panelState();

    if (!state) {
      if (this.mode !== null) {
        this.mode = null;
        this.root.dataset.show = 'false';
      }
      return;
    }

    if (state.indicator !== this.indicatorText) {
      this.indicatorText = state.indicator;
      this.indicator.textContent = state.indicator;
    }

    // The arrival ding, on the edge rather than every frame — the doors are
    // opening at the floor she pressed. Checked before the early return below,
    // because arriving does not change the panel's *face*: travelling and
    // arriving are both `'going'`, which is exactly why the seam reports this
    // as its own fact rather than leaving the panel to infer it.
    const arrived = state.arrived === true;
    if (arrived && !this.wasArriving) playLiftDing();
    this.wasArriving = arrived;

    if (state.mode === this.mode) {
      // The floor lights still move while the car does, so they are refreshed
      // even when the panel's face has not changed.
      if (state.mode === 'floors' || state.mode === 'going') this.lightFloors();
      return;
    }

    // A ding as the doors open, both when the car arrives for her and when it
    // sets her down. It is the sound every lift in the world makes, and it is
    // how a child knows without looking that something happened.
    if (state.mode === 'floors' && this.mode === 'coming') playLiftDing();

    this.mode = state.mode;
    this.root.dataset.show = 'true';
    this.root.dataset.mode = state.mode;
    this.lightFloors();

    // Stepping into the car puts the keyboard on a floor button, so Enter,
    // Space, E or a controller's A all work without hunting with Tab. The
    // topmost floor she is *not* already on, because that is what a child gets
    // in a lift for.
    if (state.mode === 'floors') {
      for (const floor of this.lift.floors()) {
        if (floor.here) continue;
        this.floorButtons.get(floor.index)?.focus();
        break;
      }
    }
  }

  dispose(): void {
    this.root.remove();
  }

  // -------------------------------------------------------------- internals

  private buildFloorButton(floor: FloorInfo): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lift-floor';
    button.dataset.here = 'false';
    button.setAttribute('aria-label', `Go to ${floor.name}`);
    button.innerHTML =
      `<span class="lift-floor-disc">${floor.glyph}</span>` +
      `<span class="lift-floor-name">${floor.name}</span>` +
      '<span class="lift-floor-here">you are here</span>';
    button.addEventListener('click', () => {
      button.blur();
      this.lift.go(floor.index);
    });
    return button;
  }

  /** The floor button the keyboard is on, if it is one of ours. */
  private focusedFloor(): HTMLButtonElement | null {
    const active = document.activeElement;
    for (const button of this.floorButtons.values()) {
      if (button === active) return button;
    }
    return null;
  }

  /** Re-reads the seam and lights whichever floor the rider is on. */
  private lightFloors(): void {
    for (const floor of this.lift.floors()) {
      const button = this.floorButtons.get(floor.index);
      if (!button) continue;
      button.dataset.here = floor.here ? 'true' : 'false';
      // Pressing the floor you are on means "let me out here", so it is never
      // disabled — see `LiftRide.go`.
      button.disabled = !floor.reachable && !floor.here;
      button.setAttribute(
        'aria-label',
        floor.here ? `Get out at ${floor.name}` : `Go to ${floor.name}`,
      );
    }
  }
}
