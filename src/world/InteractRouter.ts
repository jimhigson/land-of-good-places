import type { FrameContext, GameSystem } from '../core/types';
import type { Selection } from './Selection';

/**
 * The one place the interact key is read, and the one place it is decided what
 * a press means.
 *
 * ## Why this exists
 *
 * Family QA, 28 July 2026: waiting at the station, the chip over the platform
 * said **"Get on"**, and pressing E picked a flower. A six-year-old pressed the
 * button the game told her to press and got something else — GitHub issue #122.
 *
 * The cause was not the flowers. It was that *twelve* systems read
 * `justPressed('interact')` every frame, and each one decided **for itself**,
 * from its own hand-written proximity radius, whether the press had been meant
 * for it: `Flowers` within 1.3 m, `TreeClimbing` within `trunkRadius + 2.4`,
 * `MiniGameHost` within 3.4, `FacePaintStall` within 3.2, `Building` within
 * three separate rectangles. Those radii disagreed with each other and with
 * `standRadiusOf`, which is what the chip is drawn from. Standing where two of
 * them overlapped, the press went to whichever system happened to run first in
 * the frame — and `Flowers` runs long before the selection is even consulted.
 *
 * Worse, the chips did not help: a chip's `run` was a *broadcast*
 * (`pressVirtual('interact')`), so tapping "Get on" with a finger produced the
 * same unaddressed edge and the same race.
 *
 * ## The rule
 *
 * **A single E press routes to the zone the selection currently shows.**
 *
 * This system is registered after `Selection`, so by the time it runs the
 * selection for this frame has settled and `ui/ActionChips` is about to draw
 * exactly what it picked. Whatever runs here is therefore, by construction, the
 * thing a child is looking at.
 *
 * ## Claims, and why they are not a way back to the old bug
 *
 * A few things own the player *exclusively* — up a tree, an end card on screen,
 * the lift's panel under her hand, the what's-new welcome. These are not
 * proximity checks and so have nothing to disagree about: either the card is on
 * screen or it is not. Each declares an {@link InteractClaim}, they are tried in
 * order, and the first active one takes the press. Nothing further down the list
 * — including the selection — sees it.
 *
 * The test for a legitimate claim is: **could two of them be active at once, or
 * could one be active while a chip shows something else?** If either is
 * possible, it is a proximity check wearing a disguise and it belongs in a
 * zone's `actions()` instead.
 *
 * ## What makes it stick
 *
 * `InputSystem.justPressed` does not accept `'interact'` — the type forbids it
 * (`InteractFreeAction`). The only reader is `takeInteractPress()`, called here
 * and nowhere else, and it *consumes* the edge so a second caller gets nothing.
 * A future handler that wants to poll the interact key can no longer be written:
 * it does not compile.
 */
export interface InteractClaim {
  /** For debugging and for reading the list. Never shown to a player. */
  readonly name: string;
  /**
   * True while this claimant has the player exclusively. Must not be a
   * proximity test — see the class doc.
   */
  active(): boolean;
  /** Take the press. Only ever called when {@link active} just returned true. */
  run(): void;
}

export class InteractRouter implements GameSystem {
  readonly name = 'interactRouter';

  /**
   * @param claims Tried in order, before the selection. Order is priority:
   *   the most modal thing first, so a card over a ride beats the ride under it.
   * @param selection Where a press goes when nothing claims it — which is
   *   almost always, and is the case issue #122 is about.
   */
  private readonly claims: readonly InteractClaim[];
  private readonly selection: Selection;

  constructor(
    claims: readonly InteractClaim[],
    selection: Selection,
  ) {
    this.claims = claims;
    this.selection = selection;
  }

  update(context: FrameContext): void {
    if (!context.input.takeInteractPress()) return;

    for (const claim of this.claims) {
      if (!claim.active()) continue;
      claim.run();
      return;
    }

    this.selection.handleInteractPress();
  }
}
