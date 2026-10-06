import { Vector3, type Camera } from 'three';
import { isTouchDevice } from '../core/device';
import type { FrameContext, GameSystem } from '../core/types';
import type { Selection } from '../world/Selection';
import { PRIMARY_ACTION, type InteractZone, type ZoneAction } from '../world/interact';
import type { LabelIdentity, LabelView, ManagedLabel, ScreenRect } from './LabelManager';

/**
 * The action chips — GAME_DESIGN.md's SELECTION RULE, step 2: *"once selected,
 * the possible actions show over the item itself"*.
 *
 * Little buttons floating over the selected thing: "Race the carts!", "Pick the
 * flower!", "Toys". They are plain `<button>`s, mounted in the ordinary
 * UI root, so the HIGHLIGHT RULE's rainbow hover/focus outline, the pointer
 * cursor and the activation flash all arrive for free from `style.css`'s global
 * rule and `ui/TapBurst.ts` — nothing here draws feedback of its own.
 *
 * They are positioned by projecting the item's world point to the screen every
 * frame, which is the same idea `NameLabel` and `SpeechBubble` use to keep a
 * label over a head. Those are sprites and these are DOM, for one reason: a
 * chip has to be *pressable*, and a sprite is not. The projection therefore
 * happens here rather than in three.js, through whichever camera the frame is
 * actually being drawn with — including a first-person ride camera, so that the
 * "Get off" chip is still there over the platform when a child is sitting in
 * the train looking at it.
 *
 * ### One box, not two (10 August 2026)
 *
 * There used to be a second box above the chips — a `SignCard` naming the thing
 * ("Reception", "The Rail Race!") with a line under it. The family's ruling that
 * day: *"the helpful text is a bit excessive… roll it into just the action."* So
 * the heading bubble is gone and the chip itself now carries the whole call to
 * action — "See the view", "Race the carts!" — which is why the labels below are
 * fuller than the old one-word verbs. One box, one thing to read.
 *
 * The DOM is rebuilt only when the action list actually changes, because that
 * changes about once a minute and the position changes sixty times a second.
 *
 * ### The chips are a label like any other (6 October 2026)
 *
 * They are the call to action for the selected item, and the `LabelManager`
 * decides whether they are drawn, exactly as it does for every pill and bubble
 * — which is how a chip goes away while its own action is talking (rule 1 in
 * `ui/LabelManager.ts`) instead of sitting on top of the answer. Their item is
 * the selected zone's id, so the reptile's "peep!" over the same exhibit is
 * the same item.
 */

/** How high above the item the chips float, as a floor and a ceiling in metres. */
const MIN_LIFT = 1.2;
const MAX_LIFT = 2.6;

/** How close to the edge of the screen a chip may be pushed, in CSS pixels. */
const EDGE_MARGIN = 14;

/** Keys the chips name, in order. The first is the ordinary interact key. */
const ACTION_KEYS = ['E', 'F', 'R'] as const;

export class ActionChips implements GameSystem, ManagedLabel {
  readonly name = 'actionChips';
  readonly identity: LabelIdentity = { id: 'action-chips', item: '', kind: 'callToAction' };

  private readonly root: HTMLElement;
  private readonly row: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly projected = new Vector3();

  /** What is currently on screen, so a rebuild is only ever a real change. */
  private signature = '';
  /** There is a selection with actions, so the chips want to be drawn. */
  private wanted = false;
  /** The manager's verdict for this frame. */
  private granted = false;
  private shown = false;
  /** Where the row's top-left corner and size were put this frame, in CSS px. */
  private readonly laidOut: ScreenRect = { left: 0, top: 0, right: 0, bottom: 0 };
  /**
   * Sizes measured when the row is rebuilt rather than every frame — the row
   * only changes size when its words do, and these are layout reads.
   */
  private rowWidth = 0;
  private rowHeight = 0;

  private readonly selection: Selection;
  private readonly activeCamera: () => Camera;
  private readonly riding: () => boolean;

  constructor(
    container: HTMLElement,
    selection: Selection,
    /** The camera the frame is being rendered with — the iso one, or a ride's. */
    activeCamera: () => Camera,
    /** True while a ride owns the character — see {@link place}. */
    riding: () => boolean,
  ) {
    this.selection = selection;
    this.activeCamera = activeCamera;
    this.riding = riding;
    this.root = document.createElement('div');
    this.root.className = 'action-chips';
    this.root.dataset.show = 'false';

    this.row = document.createElement('div');
    this.row.className = 'action-chip-row';

    this.root.append(this.row);
    container.append(this.root);
  }

  update(_context: FrameContext): void {
    const zone = this.selection.selected;
    const actions = this.selection.actions;

    if (!zone || actions.length === 0) {
      this.wanted = false;
      this.apply();
      return;
    }

    this.identity.item = zone.id;
    this.sync(actions);
    this.wanted = this.place(zone);
    this.apply();
  }

  measure(_view: LabelView, out: ScreenRect): boolean {
    if (!this.wanted) return false;
    out.left = this.laidOut.left;
    out.top = this.laidOut.top;
    out.right = this.laidOut.right;
    out.bottom = this.laidOut.bottom;
    return true;
  }

  grant(shown: boolean): void {
    this.granted = shown;
    this.apply();
  }

  /** True while the chips are on screen — the manager's verdict, applied. */
  get drawn(): boolean {
    return this.shown;
  }

  dispose(): void {
    this.root.remove();
  }

  // -------------------------------------------------------------- internals

  private apply(): void {
    const visible = this.wanted && this.granted;
    if (this.shown === visible) return;
    this.shown = visible;
    this.root.dataset.show = visible ? 'true' : 'false';
  }

  /** Rebuilds the row when — and only when — the actions change. */
  private sync(actions: readonly ZoneAction[]): void {
    // The key hint is part of the signature: it appears the moment she is close
    // enough for the key to actually do something (see `keyFor`).
    const signature = actions
      .map((action, index) => `${action.id} ${action.glyph ?? ''}${action.label} ${this.keyFor(action, index)}`)
      .join('');
    if (signature === this.signature) return;
    this.signature = signature;

    while (this.buttons.length > actions.length) {
      this.buttons.pop()?.remove();
    }
    while (this.buttons.length < actions.length) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'action-chip';
      const at = this.buttons.length;
      button.addEventListener('click', () => {
        button.blur();
        // Read fresh: a chip is pressed a frame or two after it was drawn, and
        // by then the train may have started moving.
        const action = this.selection.actions[at];
        if (action) this.selection.commit(action);
      });
      this.buttons.push(button);
      this.row.append(button);
    }

    actions.forEach((action, index) => {
      const button = this.buttons[index];
      if (!button) return;
      const key = this.keyFor(action, index);
      button.setAttribute('aria-label', action.label);
      button.innerHTML =
        (action.glyph ? `<span class="emoji">${escapeHtml(action.glyph)}</span>` : '') +
        `<span>${escapeHtml(action.label)}</span>` +
        (key ? `<kbd>${key}</kbd>` : '');
    });

    // Measured here rather than in `place`, which runs every frame: these are
    // layout reads, and the row only changes size when its words do.
    const row = this.row.getBoundingClientRect?.();
    this.rowWidth = row?.width ?? 0;
    this.rowHeight = row?.height ?? 0;
  }

  /**
   * The key this chip names, or `''` for none.
   *
   * Touch players have no keys, and a key hint on a thing she is standing too
   * far from would be a lie — the systems that own these zones only listen for
   * the press when she is standing at them, and from further off the chip walks
   * her over instead. So the hint appears exactly when the key works.
   */
  private keyFor(action: ZoneAction, index: number): string {
    if (isTouchDevice()) return '';
    if (!this.selection.inReach) return '';
    if (action.id === PRIMARY_ACTION || index === 0) return ACTION_KEYS[0];
    return ACTION_KEYS[Math.min(index, ACTION_KEYS.length - 1)] ?? '';
  }

  /**
   * Puts the chips over the item — and, when the item is not somewhere a chip
   * can sit, as near to it as one can while staying pressable.
   *
   * **Placed, never hidden**, and that is not a nicety: on the train the whole
   * point is that "Get off" is there while a child is sitting in the
   * first-person seat. QA found the chip existing, saying the right word, and
   * sitting half its own width off the left edge of the world; a first attempt
   * at clamping then parked it underneath the Menu button. A button she cannot
   * reach is worse than no button, so riding has a home of its own.
   */
  private place(zone: InteractZone): boolean {
    const width = this.root.parentElement?.clientWidth ?? window.innerWidth;
    const height = this.root.parentElement?.clientHeight ?? window.innerHeight;
    const halfRow = (this.rowWidth || 120) / 2;
    const rowHeight = this.rowHeight || 44;

    let x: number;
    let y: number;

    if (this.riding()) {
      // Riding, so she is *inside* the thing the chip is for: from the train's
      // first-person seat the platform she is standing at projects to a couple
      // of pixels off the left of the screen, and "over the item" has stopped
      // meaning anything useful. Home is the bottom middle — clear of the Menu
      // button in the opposite corner, and where a thumb already is.
      x = width / 2;
      y = height - EDGE_MARGIN;
    } else {
      const lift = Math.min(MAX_LIFT, Math.max(MIN_LIFT, 1.1 + zone.pickRadius * 0.3));
      this.projected.set(zone.x, zone.y + lift, zone.z).project(this.activeCamera());
      x = (this.projected.x * 0.5 + 0.5) * width;
      y = (1 - (this.projected.y * 0.5 + 0.5)) * height;

      // Off screen altogether — the camera has swung round it — goes home too,
      // rather than being dragged to whichever corner is nearest.
      if (this.projected.z > 1 || x < 0 || y < 0 || x > width || y > height) {
        x = width / 2;
        y = height - EDGE_MARGIN;
      }
    }

    // Everything that *is* on screen is merely nudged clear of the edges.
    // `translate(-50%, -100%)` means the row hangs up and to the left of this
    // point, so the margins are asymmetric: half a row to either side, a whole
    // row above, nothing below.
    x = clamp(x, halfRow + EDGE_MARGIN, width - halfRow - EDGE_MARGIN);
    y = clamp(y, rowHeight + EDGE_MARGIN, height - EDGE_MARGIN);

    this.root.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    // The rectangle the row occupies — the `translate(-50%, -100%)` above,
    // spelled out — which is what the label manager judges overlap by.
    this.laidOut.left = x - halfRow;
    this.laidOut.right = x + halfRow;
    this.laidOut.top = y - rowHeight;
    this.laidOut.bottom = y;
    return true;
  }
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}

function clamp(value: number, low: number, high: number): number {
  // A viewport narrower than the row itself would give `low > high`; centring is
  // the only sane answer, and a phone in portrait with three chips can reach it.
  if (low > high) return (low + high) / 2;
  return Math.min(high, Math.max(low, value));
}
