import { Vector3, type Object3D } from 'three';
import { CAMERA_ZOOM_MIN } from '../../core/constants';
import type { IsoCamera } from '../../core/IsoCamera';
import { bookById } from './books';
import type { FurnishedShelfBook } from './furnish';
import { LIBRARY_LINES } from './libraryLines';
import { glowBeaconBase, type LibraryOwl } from './LibraryOwl';

/**
 * **The owl shows her where the book is** — the camera's glance at the
 * glowing book while the owl recommends it.
 *
 * "Say hello!" at the owl's desk names a book — "Try “The Cat Bus's Long
 * Day” next!" — and "It is glowing on its shelf!": the book's cover glows
 * and a beacon of sky-blue sparkles rises off the top of its case
 * (`LibraryOwl.glow`). But the
 * reading room is 36 m by 26 m and the camera frames about 27 m by 15 m round
 * her, so from the desk **most of the shelves are off the screen**: measured
 * with every one of the 18 books made the glowing one in turn, only 3 of them
 * had a sparkle on a 1280×720 screen from the desk's front, and on the north
 * and west walls none did (23 Oct 2026, `check:library` RECOMMEND, red on
 * main). The owl told a six-year-old a book was glowing, and the glow was
 * somewhere she could not see and had no way to guess.
 *
 * So while the owl names the book and says it is glowing, the camera slides
 * over to it — the book's case, its glowing cover and the beacon rising over
 * it — drawing back a little, if that is enough, until **she, the owl and the
 * glowing book are all in the picture**, and otherwise looking at the book
 * itself; and when the owl has finished, it comes back to her. The owl's
 * words stay true and are shown: the book she named is right there, glowing,
 * and the child has seen which way to walk. She can be shown again any time:
 * "Say hello!" recommends the same book until it is read
 * (`recommendation.ts`).
 *
 * ## It never takes the controls
 *
 * The glance only translates what the camera orbits and draws the zoom back;
 * the rig's angle never turns, so "up the stick" is up the screen throughout
 * (GAME_DESIGN.md's CONTROL rule). It starts only if she is standing still,
 * listening, when the owl names the book, and the moment she moves — the
 * stick, a key, a jump, a tap that walks her, sitting down — the camera is
 * hers again and comes straight back to her (the exhibit camera's rule,
 * `reptileHouse/exhibitCamera.ts`). Moved off, it does not come back until
 * the next "Say hello!".
 *
 * ## No new camera mechanism
 *
 * A focus claim folded into `Game`'s one `focusClaim`, and a zoom target
 * written each frame while it holds and given back exactly once when it ends —
 * the keychain rack's zoomed picker and the exhibit camera are the precedent,
 * and the camera's own damping eases it there and back. {@link apply} is the
 * single place this touches the camera: `Game.tick` calls it, and so do
 * `check:library` and `check:labels`, in `Game`'s order, so the checks measure
 * the camera the game draws.
 *
 * ## The framing is solved, never typed
 *
 * The shot is the screen-space box round everything it wants — her, feet to
 * the top of her head; the owl, to the top of hers, and her bubble where it
 * is drawn (it is drawn only while its anchor, over her head, is in shot, and
 * clamps itself on screen round it); the glowing book; and the beacon's
 * column over its case ({@link GLANCE_BEACON_COLUMN}) — measured along the
 * live camera's own screen axes, the focus at its middle and the zoom from
 * `IsoCamera.zoomToFit`, so it is right on whatever screen is there: a laptop,
 * a phone held either way up. It never comes in closer than she had it.
 *
 * **And it never draws back so far that the book is lost in the picture.**
 * Everything fits a phone held upright only at a zoom where the beacon's
 * sparkles are a few pixels across — the whole room shrunk into the middle of
 * the screen and the glow a dot by its far wall (headless Chrome, 390×844,
 * the north wall's *Cat Bus* book: zoom 0.46). So it draws back at most to
 * {@link GLANCE_DRAW_BACK} of her zoom, the beacon three quarters of the size
 * she always sees it; and when everything does not fit even there, it looks
 * at **the book itself**, in the middle of the screen, at her own zoom
 * ({@link GlanceShot.whole} false). The camera's slide from her to it is what
 * shows her which way to go.
 *
 * While the camera is the glance's, **nothing is selected** (`Game`'s
 * `selectionBlocked`): the owl is talking, and a press mid-script does
 * nothing, so her "Say hello!" chip must not show — and it is her bubble over
 * it that normally puts it away, which is not drawn while the camera looks at
 * a book she is out of shot of (seen in headless Chrome: the chip clamped to
 * the bottom of a phone's screen, offering a press that would do nothing).
 *
 * Kept outside the park closure (`scripts/lib/park-source-hash.mjs`): only
 * `Game` and the checks import it, so a camera move cannot change a park.
 */

/** The share of the framed box left clear round it — room for the owl's bubble and the HUD at the screen's edges. */
export const GLANCE_MARGIN = 0.2;
/** How much of the beacon's rising column over its case the shot holds (metres over the beacon's base). */
export const GLANCE_BEACON_COLUMN = 1;
/** How far she may drift (a nudge from a passing child) before it counts as walking off. Metres — the exhibit camera's figure. */
export const GLANCE_MOVE_CANCEL = 0.25;
/**
 * The furthest the glance draws back, as a share of the zoom she had: the
 * beacon's sparkles never drawn smaller than three quarters of the size they
 * are at her own zoom (see the module doc).
 */
export const GLANCE_DRAW_BACK = 0.75;

/** One frame's glance: what the camera orbits, at what zoom, for which book. */
export interface GlanceShot {
  readonly bookId: string;
  /** The world point the camera orbits — the middle of the framed box, at the height the camera orbited her at when the glance took it. */
  readonly focus: Vector3;
  readonly zoom: number;
  /** She, the owl and the book all fitted at {@link zoom}; false — the book itself, in the middle, at her own zoom (see the module doc). */
  readonly whole: boolean;
}

/** What the glance reads of the library: the owl's words and the shelf. */
export interface GlanceLibrary {
  readonly owl: Pick<LibraryOwl, 'atDesk' | 'speaking' | 'lastSaid' | 'recommendedBookId' | 'bubble' | 'handle' | 'top'>;
  readonly shelfBooks: readonly FurnishedShelfBook[];
  readonly roomRoot: Object3D;
  readonly playerIsInside: boolean;
}

/** What the glance reads of her. */
export interface GlancePlayer {
  readonly position: Vector3;
  /** `Player.isStandingStill` — the one owner of "standing still". */
  readonly isStandingStill: boolean;
  /** Her height, hat and all (`Player.topHeight`). */
  readonly topHeight: number;
}

type GlanceState = 'idle' | 'showing' | 'spent';

const SCRATCH_ROOM = new Vector3();

export class BookGlance {
  private readonly library: GlanceLibrary;
  private state: GlanceState = 'idle';
  /** It has written the zoom: the zoom she had is to be given back. */
  private engaged = false;
  private zoomBefore = 1;
  /**
   * The height the camera orbited her at when the glance took it: the glance's focus stays at it, so the
   * camera only slides across and draws back, and comes home along the same level. Read off the camera,
   * never re-derived — where the follow puts its height is the camera's business.
   */
  private focusHeight = 0;
  private readonly anchor = new Vector3();
  private current: GlanceShot | null = null;
  /** Her feet and head, the owl's head, her bubble, the book, the beacon's base and the top of its column — in that order. */
  private readonly points: Vector3[] = Array.from({ length: 7 }, () => new Vector3());
  /** The last three of {@link points}, the same vectors: the book and its beacon. */
  private readonly bookPoints: readonly Vector3[] = this.points.slice(4);
  /** The focus the camera is given — kept, so a frame of the glance allocates nothing. */
  private readonly focus = new Vector3();
  private readonly everything = { minR: 0, maxR: 0, minU: 0, maxU: 0 };
  private readonly bookBox = { minR: 0, maxR: 0, minU: 0, maxU: 0 };

  constructor(library: GlanceLibrary) {
    this.library = library;
  }

  /** The shot the camera was given this frame, or null — for the checks. */
  get shot(): GlanceShot | null {
    return this.current;
  }

  /** The camera is the glance's this frame. */
  get active(): boolean {
    return this.current !== null;
  }

  /**
   * **One frame**: decides whether the glance holds, writes the zoom, and
   * returns the focus it claims — or `null`, and on the frame it lets go,
   * gives the zoom back exactly once (writing a constant zoom every frame
   * would swallow every pinch: #329). `Game` folds the claim into its one
   * `focusClaim`; a check sets or clears the focus override with it, as
   * `Game` does.
   */
  apply(camera: IsoCamera, player: GlancePlayer): Readonly<Vector3> | null {
    const placed = this.showing(player);
    const shot = placed ? this.solve(camera, player, placed) : null;
    if (!shot) {
      this.current = null;
      if (this.engaged) {
        this.engaged = false;
        camera.setZoomTarget(this.zoomBefore);
      }
      return null;
    }
    camera.setZoomTarget(shot.zoom);
    this.current = shot;
    return shot.focus;
  }

  /**
   * The book to show this frame, or null. The window is the owl at her desk
   * saying the two lines of her recommendation that name the book and its
   * glow; the glance opens in it only on a child standing still, and once she
   * moves it is spent until the window closes.
   */
  private showing(player: GlancePlayer): FurnishedShelfBook | null {
    const placed = this.window();
    if (!placed) {
      this.state = 'idle';
      return null;
    }
    if (this.state === 'spent') return null;
    const at = player.position;
    if (this.state === 'idle') {
      if (!player.isStandingStill) {
        this.state = 'spent';
        return null;
      }
      this.state = 'showing';
      this.anchor.copy(at);
    }
    if (!player.isStandingStill || Math.hypot(at.x - this.anchor.x, at.z - this.anchor.z) > GLANCE_MOVE_CANCEL) {
      this.state = 'spent';
      return null;
    }
    return placed;
  }

  /** The glowing book while the owl, at her desk, names it or says it is glowing — else null. */
  private window(): FurnishedShelfBook | null {
    const { owl } = this.library;
    const id = owl.recommendedBookId;
    if (!this.library.playerIsInside || !owl.atDesk || !owl.speaking || id === null) return null;
    const book = bookById(id);
    if (!book) return null;
    const said = owl.lastSaid;
    if (said !== LIBRARY_LINES.owl.recommend(book.title) && said !== LIBRARY_LINES.owl.recommendGlow) return null;
    return this.library.shelfBooks.find((candidate) => candidate.book.id === id) ?? null;
  }

  /** The shot that holds her, the owl's bubble and the glowing book with its beacon — see the module doc. */
  private solve(camera: IsoCamera, player: GlancePlayer, placed: FurnishedShelfBook): GlanceShot | null {
    if (!this.engaged) {
      this.engaged = true;
      this.zoomBefore = camera.targetZoom;
      this.focusHeight = camera.focusPoint.y;
    }
    const { owl, roomRoot: room } = this.library;
    const [feet, head, owlHead, bubble, book, base, column] = this.points as [Vector3, Vector3, Vector3, Vector3, Vector3, Vector3, Vector3];
    feet.copy(player.position);
    head.copy(player.position);
    head.y += player.topHeight;
    owl.handle.root.getWorldPosition(owlHead);
    owlHead.y += owl.top;
    // Where her bubble is drawn: at its anchor over her head, or nudged inside the frame by its own clamp.
    owl.bubble.sprite.getWorldPosition(bubble);
    placed.mesh.getWorldPosition(book);
    // The beacon's base as `LibraryOwl.glow` puffs it: over the book, at its case's measured top.
    room.updateWorldMatrix(true, false);
    room.worldToLocal(SCRATCH_ROOM.copy(book));
    base.set(SCRATCH_ROOM.x, glowBeaconBase(placed), SCRATCH_ROOM.z);
    room.localToWorld(base);
    column.copy(base);
    column.y += GLANCE_BEACON_COLUMN;

    // The box round everything, and round the book with its beacon, along the camera's screen axes.
    const right = camera.screenRightAxis;
    const up = camera.screenUpAxis;
    const all = screenBox(this.points, right, up, this.everything);
    const bookBox = screenBox(this.bookPoints, right, up, this.bookBox);
    const fit = camera.zoomToFit((all.maxR - all.minR) / 2, (all.maxU - all.minU) / 2, GLANCE_MARGIN);
    const nearest = Math.max(CAMERA_ZOOM_MIN, this.zoomBefore * GLANCE_DRAW_BACK);
    const whole = fit >= nearest;
    // Everything, round its middle — or, when everything does not fit, the book and its beacon round
    // theirs, at her own zoom.
    const box = whole ? all : bookBox;
    const zoom = whole ? Math.min(this.zoomBefore, fit) : this.zoomBefore;
    if (!onScreenAxes(this.focus, right, up, (box.minR + box.maxR) / 2, (box.minU + box.maxU) / 2, this.focusHeight)) return null;
    return { bookId: placed.book.id, focus: this.focus, zoom, whole };
  }
}

/** A box along the screen's axes: `right` from `minR` to `maxR`, `up` from `minU` to `maxU` (metres). */
interface ScreenBox {
  minR: number;
  maxR: number;
  minU: number;
  maxU: number;
}

/** The box round `points` along `right` and `up`, written into `out`. */
function screenBox(points: readonly Vector3[], right: Readonly<Vector3>, up: Readonly<Vector3>, out: ScreenBox): ScreenBox {
  out.minR = Infinity;
  out.maxR = -Infinity;
  out.minU = Infinity;
  out.maxU = -Infinity;
  for (const point of points) {
    const r = point.dot(right);
    const u = point.dot(up);
    out.minR = Math.min(out.minR, r);
    out.maxR = Math.max(out.maxR, r);
    out.minU = Math.min(out.minU, u);
    out.maxU = Math.max(out.maxU, u);
  }
  return out;
}

/**
 * The world point at `height` whose screen coordinates are (`r`, `u`), written into `out`: `right` is level
 * (the rig never rolls), so x·rx + z·rz = r and x·ux + height·uy + z·uz = u solve for x and z. False on a
 * camera not yet aimed — its screen axes are zero until its first frame.
 */
function onScreenAxes(out: Vector3, right: Readonly<Vector3>, up: Readonly<Vector3>, r: number, u: number, height: number): boolean {
  const det = right.x * up.z - right.z * up.x;
  if (!(Math.abs(det) > 1e-6)) return false;
  const level = u - height * up.y;
  out.set((r * up.z - right.z * level) / det, height, (right.x * level - r * up.x) / det);
  return true;
}
