import {
  BufferAttribute,
  Color,
  DataTexture,
  DirectionalLight,
  FrontSide,
  BackSide,
  Group,
  HemisphereLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  type Texture,
  Vector3,
  type MeshToonMaterial,
  type WebGLRenderer,
} from 'three';
import { PALETTE } from '../../../core/palette';
import { gameStore, type GameState } from '../../../state';
import { isFacePaintDesign } from '../../../entities/kidDressing';
import { minTextPx, uiUnitPx } from '../../../core/uiScale';
import { tapCandidate, tapDriftedTooFar, type TapCandidate } from '../../../core/input/tapGesture';
import { disposeTree, isShared, markShared, toonMaterial } from '../../../art/style/materials';
import {
  createReaderCover,
  READER_BLOCK_THICKNESS,
  READER_BOARD_OVERHANG,
  READER_PAGE_HEIGHT,
  READER_PAGE_WIDTH,
  type ReaderCoverHandle,
} from './readerAssets';
import { bookById, type LibraryBook } from '../books';
import { TURN_SECONDS, writeLeaf, type LeafGrid } from './pageCurl';
import { bookFaces, PAGE_CANVAS_HEIGHT, PageArtist, type PageFace, type PaintedFace } from './pageFaces';
import { pictureWarmSteps, pinPrograms, type ReaderLook } from './pagePictures';

/**
 * **The library's book reader: a real book, open in front of you** (#717).
 *
 * Jim, 13 October 2026: *"render the 3d models to textures, and then use those
 * mapped onto the pages; have a page-turning effect that simulates real paper
 * on a mesh of a page."* So this is not a panel. It is a three.js book — two
 * cover boards, a block of paper on each, and a leaf of paper for every page
 * that turns — drawn in its own little scene over the paused park, in front of
 * a dim plum vignette.
 *
 * ## A mode, like a ride
 *
 * Opening it pauses the park the way the pause menu does
 * (`gameStore.setPaused`, and only if nothing else already had — the
 * Cute-o-dex's `pausedByUs` rule), and `Game` hides the HUD's menu while it is
 * up, exactly as it does while a ride has her (`Hud.setMenuAvailable`). The
 * screen then belongs to the book: tap a page, swipe it, push a stick or a
 * d-pad, or press → / ← to turn it, and one big ✕ closes it. Escape closes it
 * too — `Game.tick` routes it here the way it routes it to the Cute-o-dex, so
 * it never pauses the park underneath.
 *
 * ## Every way to turn a page, and only one road each
 *
 * - **Tap** a page: its `<button>`'s click.
 * - **Swipe** across the book: a drag past the tap slop (`tapGesture.ts`, the
 *   one owner of where a tap ends and a drag begins), leftwards forward — and
 *   the click a mouse fires at the end of a drag is swallowed, so a swipe
 *   turns one page, never two.
 * - **Stick, d-pad, arrow keys, A/D**: one left–right value, merged by
 *   `InputSystem`; `Game.tick` hands it to {@link BookReader.steer} every
 *   frame. One push, one page; holding does not riffle.
 * - **A, Space, Enter**: {@link BookReader.pressFocused} — the button the
 *   controller last pointed at, the next page unless she moved it; it wears
 *   the HIGHLIGHT RULE's rainbow (`data-pad-focus`) so she can see which.
 * - **Page Up / Page Down**: here, because no game action is bound to them.
 *
 * ## What you can press — the HIGHLIGHT RULE
 *
 * Every tappable thing is a real `<button>`, so the house rainbow outline,
 * pointer cursor and tap flash all come from the global rule in `style.css` and
 * `ui/TapBurst.ts` with nothing drawn here. The two page buttons are laid
 * exactly over the left and right pages as they appear on screen (measured by
 * projecting the pages' corners through this camera, every layout), so the
 * rainbow rings the very page you are about to turn.
 *
 * ## Paper
 *
 * A leaf is one subdivided plane hinged at the spine, two meshes deep — its
 * front drawn front-side-only, its back back-side-only — sharing one geometry
 * whose vertices `pageCurl.ts` rewrites every frame of a turn. Each face's
 * picture and sentence are one canvas texture (`pageFaces.ts`). One leaf turns
 * at a time; a tap mid-turn queues the next one rather than starting a second.
 *
 * ## How big the words are
 *
 * The page's height on screen is measured off this camera after every layout,
 * and the words are painted no smaller than `minTextPx()` (the TEXT RULE's one
 * shared minimum) at that height. `check:book-reader` measures it again from
 * the outside, off the built meshes, and fails if a sentence is smaller.
 */

/** Vertical field of view of the reader's camera, degrees. Long, so the pages are not distorted. */
const READER_FOV = 28;
/** How far the book leans back, radians — enough to read as lying open, not enough to foreshorten words. */
const READER_TILT = 0.2;
/** The grid a leaf is drawn on: enough columns for a smooth curl, enough rows for the corner lift. */
const LEAF_GRID: LeafGrid = { columns: 28, rows: 10, width: READER_PAGE_WIDTH, height: READER_PAGE_HEIGHT };
/** The height of one sheet of paper in a stack, metres. Only big enough to keep the stack in order. */
const SHEET = 0.0016;
/** The whole open book's width and height in book space (the cover boards, which stand proudest). */
const BOOK_WIDTH = (READER_PAGE_WIDTH + READER_BOARD_OVERHANG) * 2;
const BOOK_HEIGHT = READER_PAGE_HEIGHT + READER_BOARD_OVERHANG * 2;
/** Room kept clear for the close button, in UI units (rem): its size plus a gap either side. */
const CLOSE_BAND_UNITS = 4.6;
/** How far the stick must be pushed to turn a page, and how far it must come back before another push counts. */
const STEER_FIRE = 0.5;
const STEER_REARM = 0.3;

let paper: Texture | null = null;

/**
 * The paper a face shows until its own canvas is painted: one cream texel,
 * shared. Every page material starts with it, so a page always has a map and
 * only ever needs the one shader program — never a map-less one first and a
 * mapped one the moment its picture lands.
 */
function paperPlaceholder(): Texture {
  if (!paper) {
    const cream = PALETTE.signBoard;
    const texel = new Uint8Array([(cream >> 16) & 0xff, (cream >> 8) & 0xff, cream & 0xff, 0xff]);
    const texture = new DataTexture(texel, 1, 1);
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    paper = markShared(texture);
  }
  return paper;
}

/** A turning leaf's two materials: its front drawn front-side-only, its back back-side-only. */
function leafMaterials(): [MeshToonMaterial, MeshToonMaterial] {
  return [
    toonMaterial(0xffffff, { side: FrontSide, map: paperPlaceholder() }),
    toonMaterial(0xffffff, { side: BackSide, map: paperPlaceholder() }),
  ];
}

/** A fixed page's material. */
function pageMaterial(): MeshToonMaterial {
  return toonMaterial(0xffffff, { map: paperPlaceholder() });
}

/** A leaf of paper: one geometry, a front face and a back face. */
interface Leaf {
  readonly geometry: PlaneGeometry;
  readonly positions: Float32Array;
  readonly front: Mesh;
  readonly back: Mesh;
}

/** The turn in progress: which leaf, how far, which way. */
interface Turn {
  readonly leaf: number;
  /** 0 lying on the right, 1 lying on the left. */
  t: number;
  readonly direction: 1 | -1;
}

export interface BookReaderOptions {
  readonly renderer: WebGLRenderer;
  /** Where the buttons go — the HUD's root. */
  readonly container: HTMLElement;
  /** Called once each time a book is read to its last page. */
  readonly onFinished: (book: LibraryBook) => void;
  /** Called after the book closes, however it was closed. */
  readonly onClosed?: () => void;
}

/**
 * The girl in the pictures is the one reading: the player's own look, down to
 * the face paint, hat and keyring she has on right now.
 */
export function readerLookFromPlayer(state: GameState): ReaderLook {
  const player = state.player;
  /** A worn item's catalogue id, or `''` — the same lookup `WornHat` and `WornKeychain` make. */
  const worn = (uid: string | null): string =>
    (uid === null ? undefined : state.inventory.find((item) => item.uid === uid)?.id) ?? '';
  return {
    skin: player.skinColour,
    hair: player.hairColour,
    hairStyle: player.hairStyle,
    outfit: player.outfitColour,
    outfitArms: player.outfitArmsColour,
    eye: player.eyeColour,
    backpackKind: player.backpackKind,
    backpackColour: player.backpackColour,
    shoeKind: player.shoeKind,
    shoe: player.shoeColour,
    glasses: player.glassesKind,
    facePaint: isFacePaintDesign(player.facePaint) ? player.facePaint : null,
    hatId: worn(state.wornHatUid),
    keychainId: worn(state.wornKeychainUid),
  };
}

export class BookReader {
  /** The reader's own scene and camera, drawn over the park by {@link render}. */
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(READER_FOV, 1, 0.05, 30);
  /**
   * The dim vignette, in a scene of its own drawn first. It is transparent, and
   * three draws every transparent thing *after* every opaque one within a
   * scene — so in the book's own scene it would be painted over the book.
   */
  private readonly backdrop = new Scene();
  private readonly vignette: Mesh;

  private readonly onFinished: (book: LibraryBook) => void;
  private readonly onClosed: (() => void) | null;
  private readonly renderer: WebGLRenderer;
  private readonly artist: PageArtist;
  /**
   * One material for every shader program the reader draws with, kept for
   * good: three destroys a program when the last material using it is
   * disposed, and every book's own materials are disposed when it closes.
   */
  private readonly pinned: Material[] = [];
  /** The warm-up still to run, or null before it is first asked for — see {@link warmStep}. */
  private warmQueue: (() => void)[] | null = null;
  /** The game's canvas — what the book is drawn into, so what the buttons are measured against. */
  private readonly canvas: HTMLCanvasElement;
  /** Leans the book back; the book's own frame (spine base at the origin) hangs off it. */
  private readonly tilt = new Group();
  private readonly bookRoot = new Group();

  private readonly root: HTMLElement;
  private readonly prevButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;

  private book: LibraryBook | null = null;
  private faces: PageFace[] = [];
  private painted: (PaintedFace | null)[] = [];
  /** The font floor each face was painted against — repainted if the screen changes it. */
  private paintedFloor: number[] = [];
  private cover: ReaderCoverHandle | null = null;
  private leftBase: Mesh | null = null;
  private rightBase: Mesh | null = null;
  private leaves: Leaf[] = [];
  private spreadIndex = 0;
  private turn: Turn | null = null;
  /** A tap that arrived mid-turn: the next turn to start, or 0. */
  private queued: -1 | 0 | 1 = 0;
  private look: ReaderLook | null = null;
  /** The smallest font, in page-canvas pixels, that meets the TEXT rule at the current layout. */
  private minFontPx = 48;
  private open = false;
  /** True when we are the reason the park is paused — see `CuteODex.pausedByUs`. */
  private pausedByUs = false;
  /** Read to the end this opening — `onFinished` fires once per opening. */
  private finishedThisOpening = false;
  /** False after a steer has turned a page, until the stick comes back towards the middle. */
  private steerArmed = true;
  /** A pointer pressed on the book, which may yet become a swipe. */
  private press: (TapCandidate & { readonly pointerId: number }) | null = null;
  /** Set by a swipe, so the click the same gesture ends in does not turn a second page. */
  private swiped = false;

  constructor(options: BookReaderOptions) {
    this.onFinished = options.onFinished;
    this.onClosed = options.onClosed ?? null;
    this.renderer = options.renderer;
    this.artist = new PageArtist(options.renderer);
    this.canvas = options.renderer.domElement;

    this.scene.name = 'library.reader';
    this.vignette = this.buildVignette();
    this.backdrop.add(this.vignette);
    this.scene.add(this.tilt);
    this.tilt.rotation.x = -READER_TILT;
    this.tilt.add(this.bookRoot);
    this.bookRoot.position.set(0, -READER_PAGE_HEIGHT / 2, 0);

    // The lamp the book is read under: the park's own three-light idea (a
    // hemisphere, a warm key, a cool fill) set so a flat page facing you sits
    // in the toon ramp's top band and a curling one bands down through the
    // rest — which is most of what makes the paper read as paper.
    this.scene.add(new HemisphereLight(PALETTE.signBoard, PALETTE.ink, 1.05));
    const key = new DirectionalLight(PALETTE.sunDay, 2.15);
    key.position.set(-0.7, 1.3, 2.2);
    this.scene.add(key);
    const fill = new DirectionalLight(PALETTE.skyDayBottom, 0.45);
    fill.position.set(1.4, -0.4, 1.2);
    this.scene.add(fill);

    // --- the buttons -------------------------------------------------------
    this.root = document.createElement('div');
    this.root.className = 'book-reader';
    this.root.dataset.open = 'false';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'A picture book');

    this.prevButton = this.turnButton('prev', 'Previous page', () => this.previous());
    this.nextButton = this.turnButton('next', 'Next page', () => this.next());

    this.closeButton = document.createElement('button');
    this.closeButton.type = 'button';
    this.closeButton.className = 'book-close';
    this.closeButton.setAttribute('aria-label', 'Close the book');
    this.closeButton.textContent = '✕';
    this.closeButton.addEventListener('click', () => {
      this.closeButton.blur();
      this.close();
    });

    this.root.append(this.prevButton, this.nextButton, this.closeButton);
    options.container.append(this.root);

    // Swipes, and dropping the controller's rainbow the moment a finger or a
    // mouse takes over.
    this.root.addEventListener('pointerdown', this.onPointerDown);
    this.root.addEventListener('pointerup', this.onPointerUp);
    this.root.addEventListener('pointercancel', this.onPointerCancel);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('resize', this.onResize);
  }

  // ---------------------------------------------------------------- state

  get isOpen(): boolean {
    return this.open;
  }

  /** The open book's id, or null. */
  get bookId(): string | null {
    return this.book?.id ?? null;
  }

  /** Which spread is showing: 0 holds the title page (`pageFaces.ts`'s `bookFaces` says which side). */
  get spread(): number {
    return this.spreadIndex;
  }

  /** How many spreads the open book has. */
  get spreadCount(): number {
    return this.faces.length / 2;
  }

  /** True while a page is mid-turn. */
  get turning(): boolean {
    return this.turn !== null;
  }

  /**
   * What each face of the open book was painted with — read by
   * `check:book-reader`, which measures the words' on-screen size from these
   * and the meshes in {@link faceMesh}, and checks every picture drew.
   */
  facesPainted(): readonly (PaintedFace | null)[] {
    return this.painted;
  }

  /** The mesh that shows face `index` of the open book, or null. */
  faceMesh(index: number): Mesh | null {
    const last = this.faces.length - 1;
    if (index === 0) return this.leftBase;
    if (index === last) return this.rightBase;
    const leaf = this.leaves[Math.floor((index - 1) / 2)];
    if (!leaf) return null;
    return index % 2 === 1 ? leaf.front : leaf.back;
  }

  /** The faces showing now, left and right. */
  visibleFaces(): { left: number; right: number } {
    return { left: this.spreadIndex * 2, right: this.spreadIndex * 2 + 1 };
  }

  // -------------------------------------------------------------- opening

  /**
   * Opens `bookId` at its title page. Returns false for an id that is not one
   * of the twelve. Opening a different book while one is open swaps them.
   */
  openBook(bookId: string): boolean {
    const book = bookById(bookId);
    if (!book) return false;
    // Already done behind the bus ride, normally; a deep link straight into a
    // book pays it here, once.
    this.ensureWarm();
    if (this.open) this.teardown();
    this.book = book;
    this.faces = bookFaces(book);
    this.painted = this.faces.map(() => null);
    this.paintedFloor = this.faces.map(() => 0);
    this.spreadIndex = 0;
    this.turn = null;
    this.queued = 0;
    this.finishedThisOpening = false;
    this.look = readerLookFromPlayer(gameStore.get());

    if (!this.open) {
      this.open = true;
      if (!gameStore.get().paused) {
        this.pausedByUs = true;
        gameStore.setPaused(true);
      }
    }
    this.root.dataset.open = 'true';
    this.build(book);
    this.layout();
    // The two faces on show straight away; the rest a face a frame (`update`)
    // — a picture is a render and a readback, and four in the opening frame
    // was a hitch you could feel.
    const { left, right } = this.visibleFaces();
    this.ensurePainted(left);
    this.ensurePainted(right);
    this.refreshButtons();
    this.nextButton.focus({ preventScroll: true });
    return true;
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.dataset.open = 'false';
    this.padFocus(null);
    this.press = null;
    this.swiped = false;
    this.teardown();
    // A closed book keeps nothing: its pictures are a book's worth of
    // canvases, and a child walking about the park has no use for them.
    this.artist.clear();
    if (this.pausedByUs) {
      this.pausedByUs = false;
      gameStore.setPaused(false);
    }
    this.onClosed?.();
  }

  /** Turns to the next spread — or, mid-turn, asks for it next. */
  next(): void {
    if (!this.open) return;
    if (this.turn) {
      if (this.queued === 0) this.queued = 1;
      return;
    }
    if (this.spreadIndex >= this.spreadCount - 1) return;
    const leaf = this.spreadIndex;
    this.ensurePainted(leaf * 2 + 1);
    this.ensurePainted(leaf * 2 + 2);
    this.ensurePainted(leaf * 2 + 3);
    this.turn = { leaf, t: 0, direction: 1 };
    this.refreshButtons();
  }

  /** Turns back a spread — or, mid-turn, asks for it next. */
  previous(): void {
    if (!this.open) return;
    if (this.turn) {
      if (this.queued === 0) this.queued = -1;
      return;
    }
    if (this.spreadIndex <= 0) return;
    const leaf = this.spreadIndex - 1;
    this.ensurePainted(leaf * 2);
    this.ensurePainted(leaf * 2 + 1);
    this.turn = { leaf, t: 1, direction: -1 };
    this.refreshButtons();
  }

  /**
   * The movement input's left–right value, every frame the book is open
   * (`Game.tick`): a stick, a d-pad, the arrow keys or A/D, merged by
   * `InputSystem` so each reaches here by one road and none twice. A push past
   * {@link STEER_FIRE} turns one page; it must come back inside
   * {@link STEER_REARM} before another push counts.
   */
  steer(moveX: number): void {
    if (!this.open) return;
    if (Math.abs(moveX) < STEER_REARM) {
      this.steerArmed = true;
      return;
    }
    if (!this.steerArmed || Math.abs(moveX) < STEER_FIRE) return;
    this.steerArmed = false;
    if (moveX > 0) {
      this.padFocus(this.nextButton);
      this.next();
    } else {
      this.padFocus(this.prevButton);
      this.previous();
    }
  }

  /**
   * A, Space or Enter (`Game.tick` and the interact router): presses the
   * button the controller last pointed at — the next page, unless she has
   * moved it — by a real click, so the tap flash comes with it.
   */
  pressFocused(): void {
    if (!this.open) return;
    const focused = document.activeElement;
    const target =
      focused === this.prevButton || focused === this.closeButton ? (focused as HTMLButtonElement) : this.nextButton;
    if (target.disabled) return;
    this.padFocus(target);
    target.click();
  }

  // ---------------------------------------------------------------- frame

  /** Real (unpaused) seconds — the park is frozen while this is open. */
  update(dt: number): void {
    if (!this.open) return;
    const turn = this.turn;
    if (turn) {
      turn.t += (turn.direction * dt) / TURN_SECONDS;
      const done = turn.direction > 0 ? turn.t >= 1 : turn.t <= 0;
      const leaf = this.leaves[turn.leaf];
      if (leaf) this.placeLeaf(turn.leaf, Math.min(1, Math.max(0, turn.t)));
      if (done) {
        this.turn = null;
        this.spreadIndex += turn.direction;
        this.refreshButtons();
        if (this.spreadIndex === this.spreadCount - 1 && !this.finishedThisOpening && this.book) {
          this.finishedThisOpening = true;
          this.onFinished(this.book);
        }
        const queued = this.queued;
        this.queued = 0;
        if (queued === 1) this.next();
        else if (queued === -1) this.previous();
      }
    }
    // One face a frame, never more, and never while a page is turning: a
    // picture is a render and a readback, and the rest of the book can wait
    // the few frames it takes to be read. A turn paints the faces it needs
    // itself, before it starts.
    if (!this.turn) {
      const pending = this.painted.findIndex((face) => face === null);
      if (pending >= 0) this.ensurePainted(pending);
    }
  }

  // ------------------------------------------------------------- warm-up

  /**
   * Runs one step of compiling every shader program the reader draws with,
   * and returns whether any are left — for a warm-up that slices its work
   * across frames (the bus ride does, after the park's own; see
   * `boot/shaderWarmup.ts` for why it matters). The steps: the book itself,
   * under the reader's lamp, and every picture model under both picture rigs
   * (`pagePictures.ts`'s `pictureWarmSteps`). One material per program is
   * pinned for good, so no book ever links a program again.
   */
  warmStep(): boolean {
    if (!this.warmQueue) {
      this.warmQueue = [
        () => this.warmBook(),
        ...pictureWarmSteps(this.renderer, readerLookFromPlayer(gameStore.get()), this.pinned),
      ];
    }
    this.warmQueue.shift()?.();
    return this.warmQueue.length > 0;
  }

  /** Whatever of the warm-up has not run yet, all at once. */
  private ensureWarm(): void {
    while (this.warmStep()) {
      // Each call runs one step.
    }
  }

  /** The book's own programs: a cover, a leaf front and back and a fixed page, under the reader's lights. */
  private warmBook(): void {
    const set = new Group();
    set.add(createReaderCover(PALETTE.blossomPink).root);
    const [front, back] = leafMaterials();
    const leaf = new PlaneGeometry(READER_PAGE_WIDTH, READER_PAGE_HEIGHT);
    set.add(new Mesh(leaf, front), new Mesh(leaf, back));
    set.add(new Mesh(new PlaneGeometry(READER_PAGE_WIDTH, READER_PAGE_HEIGHT), pageMaterial()));
    this.renderer.compile(set, this.camera, this.scene);
    this.renderer.compile(this.backdrop, this.camera);
    pinPrograms(this.renderer, set, this.pinned, new Set());
  }

  /** Draws the book over whatever has already been drawn this frame. */
  render(renderer: WebGLRenderer): void {
    if (!this.open) return;
    renderer.clearDepth();
    renderer.render(this.backdrop, this.camera);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.close();
    this.root.removeEventListener('pointerdown', this.onPointerDown);
    this.root.removeEventListener('pointerup', this.onPointerUp);
    this.root.removeEventListener('pointercancel', this.onPointerCancel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }

  // ------------------------------------------------------------ internals

  private turnButton(which: 'prev' | 'next', label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `book-turn book-turn--${which}`;
    button.setAttribute('aria-label', label);
    // The chevron inside is drawn by the stylesheet: a text ‹ › is a small
    // glyph that sits low in its circle, too faint for "tap here".
    const glyph = document.createElement('span');
    glyph.className = 'book-turn-arrow';
    glyph.setAttribute('aria-hidden', 'true');
    button.append(glyph);
    button.addEventListener('click', () => {
      // The click a mouse fires at the end of a swipe: the swipe has already
      // turned the page.
      if (this.swiped) {
        this.swiped = false;
        return;
      }
      action();
    });
    return button;
  }

  /**
   * The controller's rainbow: `data-pad-focus` is a term of the HIGHLIGHT
   * RULE's shared selector (`style.css`), so the button a stick or d-pad last
   * pointed at — the one A will press — is ringed whatever `:focus-visible`
   * thinks of the last input. `null` takes it off everything.
   */
  private padFocus(button: HTMLButtonElement | null): void {
    for (const each of [this.prevButton, this.nextButton, this.closeButton]) {
      if (each === button) each.dataset.padFocus = 'true';
      else delete each.dataset.padFocus;
    }
    button?.focus({ preventScroll: true });
  }

  /**
   * Page Up and Page Down. The arrow keys and A/D are not here: they are
   * movement keys, which reach {@link steer} through `InputSystem` — reading
   * them here as well would turn two pages a press. Escape is `Game.tick`'s.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.open || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === 'PageDown') {
      event.preventDefault();
      this.next();
    } else if (event.code === 'PageUp') {
      event.preventDefault();
      this.previous();
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.open) return;
    // A finger or a mouse has taken over: the controller's ring goes.
    this.padFocus(null);
    this.swiped = false;
    this.press = (event.target as Element | null)?.closest('.book-close')
      ? null
      : { ...tapCandidate(event.clientX, event.clientY, event.timeStamp), pointerId: event.pointerId };
  };

  /** A drag past the tap slop that is more across than up or down: a swipe, leftwards forward. */
  private readonly onPointerUp = (event: PointerEvent): void => {
    const press = this.press;
    this.press = null;
    if (!this.open || !press || press.pointerId !== event.pointerId) return;
    const dx = event.clientX - press.startX;
    const dy = event.clientY - press.startY;
    if (!tapDriftedTooFar(press, event.clientX, event.clientY) || Math.abs(dx) <= Math.abs(dy)) return;
    this.swiped = true;
    // Whatever click this gesture still fires is dispatched straight after
    // this event; after that, a stale flag must not eat a real tap.
    setTimeout(() => {
      this.swiped = false;
    }, 0);
    if (dx < 0) this.next();
    else this.previous();
  };

  private readonly onPointerCancel = (): void => {
    this.press = null;
  };

  private readonly onResize = (): void => {
    if (this.open) this.layout();
  };

  /** A dim plum vignette over the paused park, fixed to the camera so it always fills the view. */
  private buildVignette(): Mesh {
    const geometry = new PlaneGeometry(2, 2, 12, 12);
    const position = geometry.getAttribute('position');
    const colours = new Float32Array(position.count * 4);
    const ink = new Color(PALETTE.ink);
    for (let i = 0; i < position.count; i += 1) {
      const r = Math.min(1, Math.hypot(position.getX(i), position.getY(i)) / Math.SQRT2);
      const eased = r * r * (3 - 2 * r);
      colours.set([ink.r, ink.g, ink.b, 0.5 + 0.38 * eased], i * 4);
    }
    geometry.setAttribute('color', new BufferAttribute(colours, 4));
    const material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.name = 'reader.vignette';
    mesh.frustumCulled = false;
    return mesh;
  }

  /** Builds the cover, the two fixed pages and a leaf for every page that turns. */
  private build(book: LibraryBook): void {
    this.cover = createReaderCover(PALETTE[book.cover]);
    this.bookRoot.add(this.cover.root);

    const baseZ = READER_BLOCK_THICKNESS + 0.0004;
    this.leftBase = this.flatPage(-1, baseZ);
    this.rightBase = this.flatPage(1, baseZ);

    const leafCount = this.faces.length / 2 - 1;
    for (let index = 0; index < leafCount; index += 1) {
      const geometry = new PlaneGeometry(READER_PAGE_WIDTH, READER_PAGE_HEIGHT, LEAF_GRID.columns, LEAF_GRID.rows);
      const positions = geometry.getAttribute('position').array as Float32Array;
      const [frontMaterial, backMaterial] = leafMaterials();
      const front = new Mesh(geometry, frontMaterial);
      const back = new Mesh(geometry, backMaterial);
      front.name = `reader.leaf${index}.front`;
      back.name = `reader.leaf${index}.back`;
      // The leaf moves; its bounds are not worth keeping in step for a culling
      // test the whole-screen book would always pass.
      front.frustumCulled = false;
      back.frustumCulled = false;
      this.bookRoot.add(front, back);
      this.leaves.push({ geometry, positions, front, back });
      this.placeLeaf(index, 0);
    }
  }

  /** A fixed page lying on the paper block: −1 the left, +1 the right. */
  private flatPage(side: -1 | 1, z: number): Mesh {
    const mesh = new Mesh(new PlaneGeometry(READER_PAGE_WIDTH, READER_PAGE_HEIGHT), pageMaterial());
    mesh.position.set((side * READER_PAGE_WIDTH) / 2, READER_PAGE_HEIGHT / 2, z);
    mesh.name = side < 0 ? 'reader.page.left' : 'reader.page.right';
    this.bookRoot.add(mesh);
    return mesh;
  }

  /** Where leaf `index` lies in each stack: lower leaves under higher ones. */
  private stackHeights(index: number): { right: number; left: number } {
    const leafCount = this.faces.length / 2 - 1;
    return {
      right: READER_BLOCK_THICKNESS + (leafCount - index) * SHEET,
      left: READER_BLOCK_THICKNESS + (index + 1) * SHEET,
    };
  }

  /** Writes leaf `index`'s shape at turn progress `t` (0 right, 1 left). */
  private placeLeaf(index: number, t: number): void {
    const leaf = this.leaves[index];
    if (!leaf) return;
    const { right, left } = this.stackHeights(index);
    writeLeaf(t, LEAF_GRID, right, left, leaf.positions);
    const position = leaf.geometry.getAttribute('position');
    position.needsUpdate = true;
    leaf.geometry.computeVertexNormals();
    leaf.geometry.computeBoundingSphere();
  }

  /** Puts every leaf where the current spread says it lies. */
  private settleLeaves(): void {
    for (let index = 0; index < this.leaves.length; index += 1) {
      this.placeLeaf(index, index < this.spreadIndex ? 1 : 0);
    }
  }

  /** Paints face `index` if it has not been, or if the screen now needs bigger words. */
  private ensurePainted(index: number): void {
    const book = this.book;
    const look = this.look;
    if (!book || !look || index < 0 || index >= this.faces.length) return;
    const existing = this.painted[index];
    if (existing && this.paintedFloor[index] === this.minFontPx) return;
    const painted = this.artist.paint({ book, faceIndex: index, look, minFontPx: this.minFontPx });
    const mesh = this.faceMesh(index);
    if (mesh) {
      const material = mesh.material as MeshToonMaterial;
      if (material.side === BackSide) {
        // Seen from behind, a leaf's own u runs the wrong way: mirror the
        // texture, not the geometry, so the shared grid stays one grid.
        painted.texture.repeat.set(-1, 1);
        painted.texture.offset.set(1, 0);
      }
      // The paper placeholder is shared; only a face's own canvas is this one's to free.
      if (material.map && !isShared(material.map)) material.map.dispose();
      material.map = painted.texture;
      material.needsUpdate = true;
    } else {
      painted.texture.dispose();
    }
    this.painted[index] = painted;
    this.paintedFloor[index] = this.minFontPx;
  }

  /**
   * Fits the camera to the book and the screen, lays the page buttons over the
   * pages, and works out the TEXT rule's floor for this layout.
   *
   * The book is made as big as it can be while staying clear of the close
   * button: either leave a band clear at the top and bottom, or one at both
   * sides — whichever lets the book be bigger on this screen.
   */
  private layout(): void {
    const view = this.canvas.getBoundingClientRect();
    const width = Math.max(1, view.width || window.innerWidth);
    const height = Math.max(1, view.height || window.innerHeight);
    this.camera.aspect = width / height;
    const band = uiUnitPx() * CLOSE_BAND_UNITS;
    const aspect = BOOK_WIDTH / BOOK_HEIGHT;
    const tallBand = Math.min(height - 2 * band, (width * 0.96) / aspect);
    const wideBand = Math.min(height * 0.94, (width - 2 * band) / aspect);
    const bookPx = Math.max(80, Math.max(tallBand, wideBand));
    const tanHalf = Math.tan(((READER_FOV * Math.PI) / 180) / 2);
    const distance = (BOOK_HEIGHT * height) / (2 * bookPx * tanHalf);
    this.camera.position.set(0, 0, distance);
    this.camera.lookAt(0, 0, 0);
    // Never past a metre: the vignette hangs one metre in front of the lens.
    this.camera.near = Math.min(0.5, Math.max(0.01, distance * 0.2));
    this.camera.far = distance * 4;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);

    // The vignette: one metre in front of the lens, square on to it, and
    // stretched past the edges of the frustum with room to spare.
    this.vignette.position.set(0, 0, distance - 1);
    this.vignette.quaternion.copy(this.camera.quaternion);
    this.vignette.scale.set(tanHalf * this.camera.aspect * 1.2, tanHalf * 1.2, 1);
    this.vignette.updateMatrixWorld(true);

    this.scene.updateMatrixWorld(true);
    this.placeButtons();

    // The TEXT rule's floor at this layout, in page-canvas pixels.
    const pageScreen = this.pageScreenHeight();
    const floor = Math.ceil((minTextPx() * PAGE_CANVAS_HEIGHT) / Math.max(1, pageScreen)) + 1;
    if (floor !== this.minFontPx) {
      this.minFontPx = floor;
      // Faces painted for another screen are repainted (a face at a time, by
      // `update`) — and the ones on show right now straight away.
      if (this.open) {
        const { left, right } = this.visibleFaces();
        this.ensurePainted(left);
        this.ensurePainted(right);
        for (let i = 0; i < this.painted.length; i += 1) {
          if (this.paintedFloor[i] !== this.minFontPx && this.painted[i]) {
            this.painted[i]?.texture.dispose();
            const mesh = this.faceMesh(i);
            if (mesh) (mesh.material as MeshToonMaterial).map = paperPlaceholder();
            this.painted[i] = null;
          }
        }
      }
    }
  }

  /**
   * A page's height on screen in CSS pixels, the shorter of the two — measured
   * on the top of the paper block, the farthest from the lens any page ever
   * lies (the fixed pages sit a hair above it, every leaf a sheet or more
   * above that), so the smallest any page is ever drawn. A floor taken from it
   * therefore holds for every face of the book, whichever leaf it is on.
   */
  private pageScreenHeight(): number {
    let shortest = Infinity;
    for (const side of [-1, 1] as const) {
      const x = (side * READER_PAGE_WIDTH) / 2;
      const top = this.toScreen(new Vector3(x, READER_PAGE_HEIGHT, READER_BLOCK_THICKNESS));
      const bottom = this.toScreen(new Vector3(x, 0, READER_BLOCK_THICKNESS));
      shortest = Math.min(shortest, Math.abs(bottom.y - top.y)); // flat-ok: CSS pixels on screen, not metres
    }
    return Number.isFinite(shortest) ? shortest : this.canvas.getBoundingClientRect().height;
  }

  /** A book-space point, in CSS pixels from the top left of the window (client coordinates). */
  private toScreen(point: Vector3): { x: number; y: number } {
    const view = this.canvas.getBoundingClientRect();
    const world = point.clone().applyMatrix4(this.bookRoot.matrixWorld);
    const ndc = world.project(this.camera);
    return {
      x: view.left + ((ndc.x + 1) / 2) * view.width,
      y: view.top + ((1 - ndc.y) / 2) * view.height,
    };
  }

  /**
   * The rectangle `mesh` covers on screen, in CSS pixels from the window's top
   * left: every one of its vertices, where they are right now, projected
   * through this camera.
   *
   * The mesh is the one owner of where a page is. A resting leaf lies a few
   * sheets proud of the paper block — how many depends on the spread — and on
   * a laptop that parallax is a couple of pixels, so a page measured on any
   * plane but its own comes out narrower than the paper drawn there. This is
   * the same sum `check:book-reader` does from outside, off the same mesh.
   */
  private screenRect(mesh: Mesh): { left: number; top: number; right: number; bottom: number } {
    mesh.updateWorldMatrix(true, false);
    const position = mesh.geometry.getAttribute('position');
    const view = this.canvas.getBoundingClientRect();
    const point = new Vector3();
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).project(this.camera);
      const x = view.left + ((point.x + 1) / 2) * view.width;
      const y = view.top + ((1 - point.y) / 2) * view.height;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
    return { left, top, right, bottom };
  }

  /**
   * Lays each page button over the page showing on its side, exactly where that
   * page is drawn. Run on every layout and after every turn settles, because
   * which leaf is showing — and so how far it stands off the block — changes
   * with the spread.
   */
  private placeButtons(): void {
    const { left, right } = this.visibleFaces();
    this.placeButton(this.prevButton, -1, this.faceMesh(left));
    this.placeButton(this.nextButton, 1, this.faceMesh(right));
  }

  private placeButton(button: HTMLButtonElement, side: -1 | 1, page: Mesh | null): void {
    if (!page) return;
    const rect = this.screenRect(page);
    // The buttons live in the reader's own box; the page was measured in the
    // window's, so take the one from the other.
    const origin = this.root.getBoundingClientRect();
    button.style.left = `${rect.left - origin.left}px`;
    button.style.top = `${rect.top - origin.top}px`;
    button.style.width = `${rect.right - rect.left}px`;
    button.style.height = `${rect.bottom - rect.top}px`; // flat-ok: CSS pixels on screen, not metres
    // The round "tap here" arrow hangs half off the page's outer edge, so it
    // never sits on a word — unless the page runs to the edge of the screen,
    // where half of it would hang off the glass. Then it comes in just far
    // enough to be whole. Its size is read off the arrow itself, so the
    // stylesheet stays its one owner.
    const arrow = button.firstElementChild as HTMLElement | null;
    const bubble = arrow?.offsetWidth ?? 0;
    const room = side > 0 ? origin.right - rect.right : rect.left - origin.left;
    const overhang = Math.min(bubble / 2, room - uiUnitPx() * 0.25);
    button.style.setProperty('--book-arrow-overhang', `${overhang}px`);
  }

  /** Hides a page button with nothing to turn to. */
  private refreshButtons(): void {
    const atStart = this.spreadIndex <= 0 && !(this.turn && this.turn.direction > 0);
    const atEnd = this.spreadIndex >= this.spreadCount - 1 && !(this.turn && this.turn.direction < 0);
    this.prevButton.dataset.show = atStart ? 'false' : 'true';
    this.nextButton.dataset.show = atEnd ? 'false' : 'true';
    // A button about to be disabled under keyboard focus would drop the focus
    // on the floor; hand it to whatever is still useful — the other page, or
    // at the very end, the ✕ that is the only thing left to press.
    // The controller's ring goes with it.
    const focused = document.activeElement;
    if (atEnd && focused === this.nextButton) {
      if (this.nextButton.dataset.padFocus) this.padFocus(this.closeButton);
      else this.closeButton.focus({ preventScroll: true });
    }
    if (atStart && focused === this.prevButton) {
      if (this.prevButton.dataset.padFocus) this.padFocus(this.nextButton);
      else this.nextButton.focus({ preventScroll: true });
    }
    this.prevButton.disabled = atStart;
    this.nextButton.disabled = atEnd;
    this.settleIfIdle();
    // After the leaves are where the spread says: the page now showing on each
    // side may be a different leaf, a sheet higher or lower than the last.
    this.placeButtons();
  }

  /** With no turn running, every leaf is put exactly where the spread says. */
  private settleIfIdle(): void {
    if (!this.turn) this.settleLeaves();
  }

  /** Throws away everything built for the open book. The picture cache is `close`'s to drop. */
  private teardown(): void {
    for (const face of this.painted) face?.texture.dispose();
    this.painted = [];
    this.paintedFloor = [];
    for (const leaf of this.leaves) {
      this.bookRoot.remove(leaf.front, leaf.back);
      leaf.geometry.dispose();
      (leaf.front.material as MeshToonMaterial).dispose();
      (leaf.back.material as MeshToonMaterial).dispose();
    }
    this.leaves = [];
    for (const page of [this.leftBase, this.rightBase]) {
      if (!page) continue;
      this.bookRoot.remove(page);
      page.geometry.dispose();
      (page.material as MeshToonMaterial).dispose();
    }
    this.leftBase = null;
    this.rightBase = null;
    if (this.cover) {
      this.bookRoot.remove(this.cover.root);
      disposeTree(this.cover.root);
      this.cover = null;
    }
    this.book = null;
    this.faces = [];
    this.turn = null;
    this.queued = 0;
  }
}
