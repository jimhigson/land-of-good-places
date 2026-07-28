import type { FacePaintDesign } from '../art/style/faces';
import { FACE_PAINT_DESIGNS, FACE_PAINT_INFO } from '../art/style/faces';
import { CharacterPreview, type PreviewChoice } from './characterCreationPreview';

/**
 * The face-painting stall's picker panel.
 *
 * **This is the character-creation screen with one choice on it**, which is
 * GAME_DESIGN.md's PREVIEW RULE (28 July 2026): *"every screen that changes how
 * the character looks is the character-creation screen, with fewer choices…
 * the same component and the same code — the same preview, the same framing
 * behaviour, the same layout."* So the live 3D model here is
 * {@link CharacterPreview}, the same class the creator uses, wearing the
 * player's real hair, skin, clothes and hat; the layout classes are the
 * creator's own (`.charcreate-body` / `.charcreate-preview` /
 * `.charcreate-controls`), which is what gives this the phone-portrait fix
 * from 28 July for free — the preview is a band across the top and the
 * controls are the only thing that scrolls, so nothing ever scrolls through
 * the picture; and the paint itself is put on by `art/models/kid.ts`'s
 * `attachFacePaint`, the same call `FacePaintStall` makes on the real player.
 *
 * It differs from the creator in the one way the rule asks it to: the camera
 * **rests on the face** (`framing: 'face'`) instead of on the whole character.
 * That framing is measured off the model's own face patch, so it is right for
 * whatever the child built in the creator rather than for one assumed height.
 *
 * What has not changed: the designs, the order they come in, and everything
 * about how a chosen one is applied and saved — see `FacePaintStall`. This
 * panel still only *announces* a pick.
 *
 * The "brief painting moment" (design picked → painter leans in → the design
 * appears) plays out **inside this panel**, exactly like the shop's
 * surprise-egg reveal — see `showPaintingMoment`. `FacePaintStall` runs the
 * matching in-world beat (the painter figure leaning in, a few sparkles) on
 * its own clock in parallel; the two are not synchronised any tighter than
 * "roughly the same length", which is all a moment like this needs.
 */

export interface FacePaintPanelHandlers {
  /** A design was tapped/clicked. Fires the moment it is picked, not when it lands. */
  onPick(design: FacePaintDesign): void;
  onWashOff(): void;
  onClose(): void;
}

/**
 * How the player currently looks, minus the paint — everything the preview
 * needs to show *her* rather than a default kid.
 *
 * Assembled by `FacePaintStall` from the save, because the stall is the thing
 * that knows the store; the panel only ever pairs it with the design under the
 * cursor.
 */
export type FacePaintLook = Omit<PreviewChoice, 'facePaint'>;

/** How long the "painting…" beat holds before revealing the design. */
const PAINT_WOBBLE_MS = 1100;
/** How long the reveal stays up before the panel closes itself. */
const PAINT_SHOW_MS = 1700;

export class FacePaintPanel {
  private readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly previewWrap: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly washOffButton: HTMLButtonElement;
  private readonly moment: HTMLElement;

  private readonly handlers: FacePaintPanelHandlers;
  private rows: HTMLButtonElement[] = [];
  private selected = 0;
  private open = false;
  private momentTimers: number[] = [];

  /**
   * Built on first open, not in the constructor.
   *
   * The panel is constructed with the park (`FacePaintStall.mountUi`) and may
   * never be opened at all, and a `CharacterPreview` is a whole second WebGL
   * context with a render loop. Once built it is kept and merely paused — see
   * `CharacterPreview.setRunning` for why that beats disposing it each time.
   */
  private preview: CharacterPreview | null = null;
  private resizeObserver: ResizeObserver | null = null;
  /** The player's look as of the last {@link openWith}. */
  private look: FacePaintLook | null = null;

  constructor(container: HTMLElement, handlers: FacePaintPanelHandlers) {
    this.handlers = handlers;

    // `shop-panel` gives this the same full-screen backdrop, open/close
    // transition and centring as the shop panel for free (see style.css);
    // `facepaint-panel` exists only as a hook for anything genuinely different.
    this.root = document.createElement('div');
    this.root.className = 'facepaint-panel shop-panel';
    this.root.dataset.open = 'false';

    this.card = document.createElement('div');
    this.card.className = 'facepaint-card shop-card';

    // No `.shop-head`. There used to be a 🎨 glyph, the title "Face Painting!"
    // and the line "Pick a design — it washes off any time!". The character
    // creator dropped its own title band on 28 July 2026 — "obvious enough what
    // its purpose is" — and this screen is now that screen: a big picture of
    // your own face with six designs under it needs announcing even less, and
    // the band cost about 150px of a phone screen that the preview wants. The
    // panel keeps its `aria-label` below, so a screen reader still hears what
    // it is.
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Face painting');

    // The one control the creator has no equivalent of: that screen cannot be
    // closed (finishing it is the only way out), this one must be.
    const close = document.createElement('button');
    close.className = 'facepaint-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close face painting');
    close.textContent = '✕';
    close.addEventListener('click', () => {
      close.blur();
      this.handlers.onClose();
    });

    const body = document.createElement('div');
    body.className = 'charcreate-body';

    this.previewWrap = document.createElement('div');
    this.previewWrap.className = 'charcreate-preview';

    // `charcreate-controls` for every layout rule it carries (a sticky sibling
    // column on a wide screen, the scroll region below the preview band on a
    // phone); `facepaint-controls` only to switch off its multi-column
    // formatting, which the design grid must not sit inside.
    const controls = document.createElement('div');
    controls.className = 'charcreate-controls facepaint-controls';

    this.grid = document.createElement('div');
    this.grid.className = 'facepaint-grid';
    controls.append(this.grid);

    body.append(this.previewWrap, controls);

    const footer = document.createElement('div');
    footer.className = 'shop-foot';
    this.washOffButton = document.createElement('button');
    this.washOffButton.type = 'button';
    this.washOffButton.className = 'facepaint-washoff';
    this.washOffButton.innerHTML = '<span class="emoji">💧</span><span>Wash it off</span>';
    this.washOffButton.addEventListener('click', () => {
      this.washOffButton.blur();
      this.handlers.onWashOff();
    });
    // Hovering the wash-off button shows a clean face, the same way hovering a
    // design shows that design: what you would get, before you commit to it.
    this.washOffButton.addEventListener('mouseenter', () => this.showDesign(null));
    this.washOffButton.addEventListener('mouseleave', () => this.showSelected());
    const hint = document.createElement('p');
    hint.className = 'shop-hint';
    hint.innerHTML =
      '<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> choose · <kbd>E</kbd> pick · <kbd>Esc</kbd> close · or just tap!';
    footer.append(this.washOffButton, hint);

    this.moment = document.createElement('div');
    this.moment.className = 'shop-surprise facepaint-moment';
    this.moment.dataset.show = 'false';

    this.card.append(close, body, footer, this.moment);
    this.root.append(this.card);
    // Tapping the dimmed area outside the card closes the panel, and keeps the
    // tap from reaching the canvas as a "walk over there" — same trick as
    // every other full-screen panel in the game.
    this.root.addEventListener('pointerdown', (event) => {
      if (event.target === this.root) this.handlers.onClose();
    });
    container.append(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** True while the painting-moment reveal owns the screen. */
  get isRevealing(): boolean {
    return this.moment.dataset.show === 'true';
  }

  /**
   * Opens the picker, showing `look` wearing `current`.
   *
   * `look` is passed in on every open rather than read once, because the
   * player can change between visits — a hat bought at the hat shop, and one
   * day whatever else alters her appearance.
   */
  openWith(current: FacePaintDesign | null, look: FacePaintLook): void {
    this.clearMoment();
    this.look = look;
    this.selected = Math.max(0, FACE_PAINT_DESIGNS.indexOf(current ?? FACE_PAINT_DESIGNS[0]!));

    this.grid.innerHTML = '';
    this.rows = FACE_PAINT_DESIGNS.map((design, index) => this.buildRow(design, index));
    for (const row of this.rows) this.grid.append(row);
    this.washOffButton.disabled = current === null;

    this.ensurePreview().setRunning(true);
    this.applySelection();
    this.open = true;
    this.root.dataset.open = 'true';
  }

  /**
   * Tells the panel what the player is now wearing, without rebuilding it.
   *
   * The picker stays up after the reveal, so "Wash it off" has to come alive
   * the moment a design actually lands — `openWith` alone would only catch it
   * the *next* time the stall was opened.
   */
  setWearing(current: FacePaintDesign | null): void {
    this.washOffButton.disabled = current === null;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.dataset.open = 'false';
    this.clearMoment();
    // Nothing to draw for and nobody watching: stop the render loop rather
    // than leave a second WebGL context running behind the park.
    this.preview?.setRunning(false);
  }

  /**
   * The brief painting moment: a wiggling paintbrush and a sparkle or two,
   * then the design revealed on a big smiling face. In the panel rather than
   * only in the world for the same reason the shop's egg hatch is — the child
   * is looking at the card they just tapped.
   */
  showPaintingMoment(design: FacePaintDesign, onDone: () => void): void {
    this.clearMoment();
    const info = FACE_PAINT_INFO[design];
    this.moment.dataset.show = 'true';
    this.moment.dataset.phase = 'wobble';
    this.moment.innerHTML =
      '<div class="facepaint-brush">🖌️<span class="facepaint-sparkle facepaint-sparkle-a">✨</span>' +
      '<span class="facepaint-sparkle facepaint-sparkle-b">✨</span></div>' +
      '<p class="surprise-line">painting your face…</p>';

    this.momentTimers.push(
      window.setTimeout(() => {
        this.moment.dataset.phase = 'open';
        this.moment.innerHTML =
          `<div class="surprise-prize">${info.glyph}</div>` +
          `<h3 class="surprise-name">${escapeHtml(info.label)}!</h3>` +
          '<p class="surprise-line">all done — looking cute!</p>';
        onDone();
      }, PAINT_WOBBLE_MS),
    );
    this.momentTimers.push(
      window.setTimeout(() => {
        this.moment.dataset.show = 'false';
      }, PAINT_WOBBLE_MS + PAINT_SHOW_MS),
    );
  }

  /**
   * Keyboard handling, called by the owner rather than bound here — see
   * `ShopPanel.handleKey` for why (the game's own `InputSystem` listener was
   * registered first, so a second `window` listener cannot reliably beat it).
   *
   * Unchanged by the move to the shared preview: arrows or WASD move the
   * selection — which is now also what the model is wearing — and E, Enter,
   * F or Space is the one that commits.
   */
  handleKey(code: string): boolean {
    if (!this.open) return false;
    if (this.isRevealing) return true; // swallow keys, but nothing to do yet

    const columns = 2;
    switch (code) {
      case 'ArrowRight':
      case 'KeyD':
        this.move(1);
        return true;
      case 'ArrowLeft':
      case 'KeyA':
        this.move(-1);
        return true;
      case 'ArrowDown':
      case 'KeyS':
        this.move(columns);
        return true;
      case 'ArrowUp':
      case 'KeyW':
        this.move(-columns);
        return true;
      case 'Enter':
      case 'KeyE':
      case 'KeyF':
      case 'Space':
        this.pickSelected();
        return true;
      // Escape is deliberately not handled here — see `ShopPanel.handleKey`.
      default:
        return false;
    }
  }

  dispose(): void {
    this.clearMoment();
    this.resizeObserver?.disconnect();
    this.preview?.dispose();
    this.root.remove();
  }

  // -------------------------------------------------------------- internals

  private ensurePreview(): CharacterPreview {
    const existing = this.preview;
    if (existing) return existing;

    // The one difference from the character creator, and the reason the
    // framing option exists: the camera lives on the face here.
    const preview = new CharacterPreview({ framing: 'face' });
    this.previewWrap.append(preview.canvas);
    this.preview = preview;

    // Watch the canvas's OWN box, not the wrapper's — see the identical note
    // in `CharacterCreation`, which this is deliberately a copy of because it
    // is the same canvas in the same two layouts.
    this.resizeObserver = new ResizeObserver(() => {
      preview.resize(preview.canvas.clientWidth, preview.canvas.clientHeight);
    });
    this.resizeObserver.observe(preview.canvas);
    return preview;
  }

  /** Puts a design (or a clean face) on the model, without choosing it. */
  private showDesign(design: FacePaintDesign | null): void {
    const look = this.look;
    if (!look) return;
    this.ensurePreview().update({ ...look, facePaint: design });
  }

  private showSelected(): void {
    this.showDesign(FACE_PAINT_DESIGNS[this.selected] ?? null);
  }

  private buildRow(design: FacePaintDesign, index: number): HTMLButtonElement {
    const info = FACE_PAINT_INFO[design];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'shop-row facepaint-row';
    row.innerHTML =
      `<span class="row-icon">${info.glyph}</span>` +
      `<span class="row-name">${escapeHtml(info.label)}</span>`;
    // Hover shows it on your face; a tap is still what picks it, exactly as
    // before this panel grew a preview.
    row.addEventListener('mouseenter', () => this.showDesign(design));
    row.addEventListener('mouseleave', () => this.showSelected());
    row.addEventListener('click', () => {
      row.blur();
      this.selected = index;
      this.applySelection();
      this.pickSelected();
    });
    return row;
  }

  private move(delta: number): void {
    if (this.rows.length === 0) return;
    this.selected = (this.selected + delta + this.rows.length) % this.rows.length;
    this.applySelection();
  }

  private applySelection(): void {
    this.rows.forEach((row, index) => {
      row.dataset.selected = index === this.selected ? 'true' : 'false';
    });
    this.rows[this.selected]?.scrollIntoView({ block: 'nearest' });
    // The selection *is* what the model wears: a child pressing E gets what
    // she is looking at. Same grammar as the creator, where the swatch you
    // pressed is on the character the moment you press it.
    this.showSelected();
  }

  private pickSelected(): void {
    const design = FACE_PAINT_DESIGNS[this.selected];
    if (!design) return;
    this.handlers.onPick(design);
  }

  private clearMoment(): void {
    for (const timer of this.momentTimers) window.clearTimeout(timer);
    this.momentTimers = [];
    this.moment.dataset.show = 'false';
  }
}

function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character,
  );
}
