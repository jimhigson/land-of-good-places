import { Vector3, type Camera, type Object3D, type Sprite } from 'three';

/**
 * **The one owner of every text label drawn over the world.**
 *
 * Jim, 6 October 2026: *"each item needs to have at most one text label — the
 * call to action is sometimes still shown while the action is happening, and
 * covers up any labels that the action wants to show. We need to design a
 * system where text labels are managed and guaranteed non-overlapping, and also
 * have a precedence number so that two that would have been overlapping, the
 * higher precedence is shown only. For two of equal precedence, either can be
 * shown so long as the choice is stable."*
 *
 * The full design, the inventory of labels and the reasons for the order are
 * in `docs/design/LABELS.md`. In one paragraph: every label — the action chips,
 * the name pills, the speech bubbles, the reptile house's "peep!" — says
 * whether it *wants* to be drawn and where it would be, and this decides, once
 * a frame, which of them actually are. A label never sets its own visibility
 * any more; it is drawn exactly when it wants to be **and** this granted it.
 * So a label nobody registered is never drawn, which makes forgetting loud.
 *
 * The rules, in the order they are applied:
 *
 * 1. **At most one label per item.** Labels name the thing they belong to
 *    (`item`); of an item's wanted labels only the highest-precedence one is a
 *    candidate. That is what puts a call to action away while its action is
 *    talking: the reptile's "peep!" (`actionFeedback`) and the "Say hi!" chip
 *    (`callToAction`) are both `reptile:skink`, and only one survives.
 *    A candidate crowded out by rule 2 is **not** replaced by the item's next
 *    label — the item is saying something more important, and a lesser label
 *    popping up in its place would be the very flicker rule 3 exists to stop.
 * 2. **No two drawn labels overlap.** Candidates are tried in precedence
 *    order against the ones already accepted, by their real laid-out screen
 *    rectangles, with {@link LABEL_MARGIN_PX} of clear air required between.
 * 3. **Ties are stable, and losing sticks.** Equal precedence goes to the one
 *    already on screen, then to the one that has been on longest, then by id.
 *    A label that loses an overlap is held off for {@link LABEL_HOLD_SECONDS}
 *    after its last loss, so two labels brushing past each other do not
 *    strobe.
 */

/**
 * **The precedence table — the one place a label's importance is decided.**
 *
 * Higher wins. The order, and why (see `docs/design/LABELS.md` for the long
 * form):
 *
 * - `actionFeedback` — what an action she just started is saying: an
 *   exhibit's "peep!", the receptionist's check-in script. She caused it and
 *   is waiting for it; it is short-lived by construction (every producer runs
 *   it on a timer of a few seconds); and it is the reason this file exists.
 * - `callToAction` — the action chip over what she has selected. Beats
 *   everything that is not the answer to her own press, so the thing she is
 *   standing at is never lost to somebody's chatter or a name.
 * - `speech` — somebody else talking: a park child's chat, a wild animal's
 *   arrival.
 * - `playerName` — her own name pill. Above the crowd's names, so in a busy
 *   plaza she can still find herself.
 * - `name` — everyone else's name pill. The most numerous and the least
 *   needed, so it yields to everything.
 */
export const LABEL_PRECEDENCE = {
  actionFeedback: 50,
  callToAction: 40,
  speech: 30,
  playerName: 20,
  name: 10,
} as const;

export type LabelKind = keyof typeof LABEL_PRECEDENCE;

/** Clear air required between two drawn labels, in CSS pixels. */
export const LABEL_MARGIN_PX = 4;

/**
 * How long a label that lost an overlap stays down after the overlap last
 * held, in seconds. Long enough that two pills drifting past each other do not
 * strobe; short enough that a name comes back promptly once there is room.
 */
export const LABEL_HOLD_SECONDS = 0.35;

/** A laid-out rectangle on screen, CSS pixels from the viewport's top left. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What the frame is drawn with: the camera and the viewport in CSS pixels. */
export interface LabelView {
  readonly camera: Camera;
  readonly width: number;
  readonly height: number;
}

/** Who a label is: its own id, the item it belongs to, and its kind. */
export interface LabelIdentity {
  /** Unique among a manager's labels; the last word on a tie. */
  readonly id: string;
  /** The thing it is a label *for* — an interact zone's id where there is one. */
  item: string;
  readonly kind: LabelKind;
}

/** Everything the manager asks of a label. */
export interface ManagedLabel {
  readonly identity: LabelIdentity;
  /**
   * Whether the label wants to be drawn this frame and, if so, where: the
   * laid-out rectangle is written into `out`. `false` means "not this frame",
   * for any reason of the label's own (no text, too far, nobody selected).
   */
  measure(view: LabelView, out: ScreenRect): boolean;
  /** The verdict for this frame. Drawn exactly when it wanted to be and this is true. */
  grant(shown: boolean): void;
}

/**
 * Why a label is or is not drawn this frame.
 *
 * - `shown` — drawn.
 * - `unwanted` — the label did not ask to be (or is entirely off screen).
 * - `item` — another label of the same item outranks it (rule 1).
 * - `overlap` — it would cover a label that outranks it (rule 2).
 * - `hold` — it lost an overlap less than {@link LABEL_HOLD_SECONDS} ago (rule 3).
 */
export type LabelVerdict = 'shown' | 'unwanted' | 'item' | 'overlap' | 'hold';

/** One label as this frame left it — read by `check:labels`. */
export interface LabelState {
  readonly label: ManagedLabel;
  readonly rect: Readonly<ScreenRect>;
  readonly wanted: boolean;
  readonly verdict: LabelVerdict;
}

interface Entry extends LabelState {
  readonly label: ManagedLabel;
  readonly rect: ScreenRect;
  wanted: boolean;
  verdict: LabelVerdict;
  /** Registration order — the tie-break below the id, so nothing is ever left to sort order. */
  readonly seq: number;
  wasShown: boolean;
  shownSince: number;
  heldUntil: number;
}

export class LabelManager {
  private readonly entries: Entry[] = [];
  private readonly byLabel = new Map<ManagedLabel, Entry>();
  private readonly accepted: Entry[] = [];
  private readonly contenders: Entry[] = [];
  private readonly itemBest = new Map<string, Entry>();
  private clock = 0;
  private nextSeq = 0;

  /** Registers a label. Until it is, it is never drawn. Returns it, for chaining. */
  add<T extends ManagedLabel>(label: T): T {
    if (this.byLabel.has(label)) return label;
    const entry: Entry = {
      label,
      rect: { left: 0, top: 0, right: 0, bottom: 0 },
      wanted: false,
      verdict: 'unwanted',
      seq: this.nextSeq++,
      wasShown: false,
      shownSince: 0,
      heldUntil: -Infinity,
    };
    this.entries.push(entry);
    this.byLabel.set(label, entry);
    label.grant(false);
    return label;
  }

  remove(label: ManagedLabel): void {
    const entry = this.byLabel.get(label);
    if (!entry) return;
    this.byLabel.delete(label);
    this.entries.splice(this.entries.indexOf(entry), 1);
    label.grant(false);
  }

  /** Every registered label as the last {@link resolve} left it. */
  get states(): readonly LabelState[] {
    return this.entries;
  }

  /** This frame's verdict for one label, or `undefined` if it is not registered here. */
  verdictOf(label: ManagedLabel): LabelVerdict | undefined {
    return this.byLabel.get(label)?.verdict;
  }

  /**
   * Decides, for this frame, which labels are drawn. Call once a frame, after
   * every label has been updated and before the frame is rendered.
   *
   * `dt` is wall-clock seconds, not game time: a paused park still has to let
   * a held label come back.
   */
  resolve(view: LabelView, dt: number): void {
    this.clock += Math.max(0, dt);
    view.camera.updateMatrixWorld();

    // 1 — who wants to be drawn, and where.
    for (const entry of this.entries) {
      entry.wanted = entry.label.measure(view, entry.rect) && onScreen(entry.rect, view);
      entry.verdict = 'unwanted';
    }

    // 2 — one candidate per item.
    this.itemBest.clear();
    for (const entry of this.entries) {
      if (!entry.wanted) continue;
      const item = this.itemOf(entry);
      const best = this.itemBest.get(item);
      if (!best || this.precedes(entry, best)) this.itemBest.set(item, entry);
    }
    this.contenders.length = 0;
    for (const entry of this.entries) {
      if (!entry.wanted) continue;
      if (this.itemBest.get(this.itemOf(entry)) === entry) this.contenders.push(entry);
      else entry.verdict = 'item';
    }

    // 3 — the contenders, most important first, against everything accepted.
    this.contenders.sort((a, b) => (this.precedes(a, b) ? -1 : this.precedes(b, a) ? 1 : 0));
    this.accepted.length = 0;
    for (const entry of this.contenders) {
      if (this.collides(entry, this.accepted)) {
        entry.verdict = 'overlap';
        entry.heldUntil = this.clock + this.holdSeconds();
        continue;
      }
      if (!entry.wasShown && this.clock < entry.heldUntil) {
        entry.verdict = 'hold';
        continue;
      }
      entry.verdict = 'shown';
      this.accepted.push(entry);
    }

    // 4 — tell them.
    for (const entry of this.entries) {
      const shown = entry.verdict === 'shown';
      if (shown && !entry.wasShown) entry.shownSince = this.clock;
      entry.wasShown = shown;
      entry.label.grant(shown);
    }
  }

  // The three rules' own small questions, one method each, so `check:labels`
  // can break exactly one of them and watch its own assertion go red.

  /** Rule 1's key: which item a label speaks for. */
  private itemOf(entry: Entry): string {
    return entry.label.identity.item;
  }

  /** Rule 2's order: the label's place in {@link LABEL_PRECEDENCE}. */
  private rank(entry: Entry): number {
    return LABEL_PRECEDENCE[entry.label.identity.kind];
  }

  /** Rule 3's hysteresis. */
  private holdSeconds(): number {
    return LABEL_HOLD_SECONDS;
  }

  /** True if `a` goes before `b`: precedence, then the incumbent, then the elder, then the id. */
  private precedes(a: Entry, b: Entry): boolean {
    const pa = this.rank(a);
    const pb = this.rank(b);
    if (pa !== pb) return pa > pb;
    if (a.wasShown !== b.wasShown) return a.wasShown;
    if (a.wasShown && a.shownSince !== b.shownSince) return a.shownSince < b.shownSince;
    const ia = a.label.identity.id;
    const ib = b.label.identity.id;
    if (ia !== ib) return ia < ib;
    return a.seq < b.seq;
  }

  private collides(entry: Entry, accepted: readonly Entry[]): boolean {
    for (const other of accepted) {
      if (rectsTouch(entry.rect, other.rect, LABEL_MARGIN_PX)) return true;
    }
    return false;
  }
}

/** True when `a` and `b` come within `margin` pixels of each other. */
export function rectsTouch(a: ScreenRect, b: ScreenRect, margin: number): boolean {
  return (
    a.left < b.right + margin &&
    b.left < a.right + margin &&
    a.top < b.bottom + margin &&
    b.top < a.bottom + margin
  );
}

function onScreen(rect: ScreenRect, view: LabelView): boolean {
  return (
    rect.right > rect.left &&
    rect.bottom > rect.top &&
    rect.right > 0 &&
    rect.left < view.width &&
    rect.bottom > 0 &&
    rect.top < view.height
  );
}

/**
 * The part of a label sprite's texture that is actually painted, as fractions
 * of the canvas from its top left — a name pill is a 512-wide canvas with a
 * pill in the middle of it, and two short names side by side must not be
 * judged by their transparent margins.
 */
export interface ContentBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

const CORNER = new Vector3();
const CENTRE = new Vector3();
const RIGHT = new Vector3();
const UP = new Vector3();

/**
 * The laid-out rectangle of a camera-facing sprite label, in CSS pixels.
 * Returns `false` if it is not in the scene's drawn set at all (a hidden
 * ancestor) or any corner is behind the camera.
 *
 * Works for the park's orthographic rig and a ride's perspective camera alike:
 * the four painted corners are placed along the camera's own right and up axes,
 * which is exactly how three.js draws a sprite, and projected.
 */
export function measureSprite(sprite: Sprite, box: ContentBox, view: LabelView, out: ScreenRect): boolean {
  if (!ancestorsVisible(sprite)) return false;
  sprite.updateWorldMatrix(true, false);
  const e = sprite.matrixWorld.elements;
  const scaleX = Math.hypot(e[0] ?? 0, e[1] ?? 0, e[2] ?? 0);
  const scaleY = Math.hypot(e[4] ?? 0, e[5] ?? 0, e[6] ?? 0);
  CENTRE.setFromMatrixPosition(sprite.matrixWorld);
  const c = view.camera.matrixWorld.elements;
  RIGHT.set(c[0] ?? 1, c[1] ?? 0, c[2] ?? 0).normalize();
  UP.set(c[4] ?? 0, c[5] ?? 1, c[6] ?? 0).normalize();

  out.left = Infinity;
  out.top = Infinity;
  out.right = -Infinity;
  out.bottom = -Infinity;
  for (const fx of [box.x0, box.x1]) {
    for (const fy of [box.y0, box.y1]) {
      CORNER.copy(CENTRE)
        .addScaledVector(RIGHT, (fx - sprite.center.x) * scaleX)
        .addScaledVector(UP, (1 - fy - sprite.center.y) * scaleY)
        .project(view.camera);
      if (!(CORNER.z >= -1 && CORNER.z <= 1)) return false;
      const px = (CORNER.x * 0.5 + 0.5) * view.width;
      const py = (1 - (CORNER.y * 0.5 + 0.5)) * view.height;
      out.left = Math.min(out.left, px);
      out.right = Math.max(out.right, px);
      out.top = Math.min(out.top, py);
      out.bottom = Math.max(out.bottom, py);
    }
  }
  return true;
}

/** Is everything above `object` drawn? Its own flag is the manager's to set. */
function ancestorsVisible(object: Object3D): boolean {
  for (let node = object.parent; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

const FULL_BOX: ContentBox = { x0: 0, y0: 0, x1: 1, y1: 1 };

/**
 * Any camera-facing sprite that carries words, made into a managed label: the
 * owner says whether it {@link want}s to be drawn, the manager grants it.
 *
 * For the labels that are not a `NameLabel` or a `SpeechBubble` — the
 * dodgems' "TWEET!?" and its giggles. Owning `sprite.visible` is the whole
 * point, so an owner must never write that flag itself once it has wrapped
 * the sprite in one of these.
 */
export class SpriteLabel implements ManagedLabel {
  readonly identity: LabelIdentity;
  readonly sprite: Sprite;
  readonly contentBox: ContentBox;
  private wanted = false;
  private granted = false;

  constructor(identity: LabelIdentity, sprite: Sprite, box: ContentBox = FULL_BOX) {
    this.identity = identity;
    this.sprite = sprite;
    this.contentBox = box;
    this.sprite.visible = false;
  }

  /** Whether it would like to be drawn — from this frame until told otherwise. */
  want(wanted: boolean): void {
    this.wanted = wanted;
    this.sprite.visible = wanted && this.granted;
  }

  get wants(): boolean {
    return this.wanted;
  }

  measure(view: LabelView, out: ScreenRect): boolean {
    if (!this.wanted) return false;
    return measureSprite(this.sprite, this.contentBox, view, out);
  }

  grant(shown: boolean): void {
    this.granted = shown;
    this.sprite.visible = this.wanted && shown;
  }
}
