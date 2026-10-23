import { Group, Sprite, SpriteMaterial, Vector3, type Material, type Mesh } from 'three';
import { damp } from '../../core/mathUtils';
import { PALETTE } from '../../core/palette';
import { glowTexture } from '../../core/textures';
import { ART } from '../../art/style/artPalette';
import { createLibrarySecretLeaf, createShelfBook, libraryBookMaterial, libraryBookShapes, libraryShelfBookShape } from '../../art/models/libraryAssets';
import { playSecretDoor, playSecretThunk } from '../../ui/chime';
import { bookcaseCentre, bookInstances, bookSpot, READABLE_PROUD, StackFader, type PlacedBook } from './furnish';
import { LIBRARY_SECRET_BOOK, LIBRARY_SECRET_BOOKCASE, type LocalPoint } from './layout';
import { libraryDenGap } from './shell';
import type { BoxFootprint, BoxWalls, LibraryProps } from './props';

/**
 * **The secret shelf's leaf** (#719, plan Step 12) — the bookcase a child
 * pulls a gold book from, which then swings slowly open into the hidden den
 * behind the reading room's west wall.
 *
 * ## The hinge
 *
 * The leaf is `createLibrarySecretLeaf`'s wall case, re-originated on its
 * back-left vertical edge, under a {@link hinge} Group stood on the west
 * wall's inner face at the doorway's south edge and turned to the case's
 * facing: the leaf's length runs north from the hinge along the wall, its
 * books face the room, and shut it stands exactly where an ordinary case
 * would. Swinging it is `leaf.rotation.y` 0 → +π/2 and nothing else: at π/2 it
 * lies flat against the den's south wall, books facing into the den, its far
 * end four metres in. (Plan Decision 21: the Artist's front-left hinge would
 * have swung it out into the room, 1.9 m across stack-2-1 and through the
 * puller.)
 *
 * ## Two collider states, both registered at construction
 *
 * The shut leaf is `bookcase west-2`, the name every existing hook knows; the
 * open one is {@link SECRET_LEAF_OPEN}. Both go through `LibraryProps.box`, so
 * both footprints are held clear of every stand spot the moment the room is
 * built, and the open set is detached at once. **The shut set holds for the
 * whole swing**, so she can never walk through a half-open leaf, and the swap
 * is one frame, on landing — there is no state in which the drawn leaf is
 * hollow (Decision 23). `openInstantly` is the guard's road (Decision 24):
 * found in the den with the leaf shut, it is open with no sound and no sweep.
 *
 * ## What she sees
 *
 * The gold book twinkles now and then while the leaf is shut. Pulled, it
 * slides {@link SLIDE} out over {@link SLIDE_SECONDS} with a creak, then the
 * whole case swings {@link SWING_SECONDS} on an ease-out cubic — quick off the
 * wall, slowing to the thunk — and the book eases home.
 */

/** The open leaf's solid, by name: the shut one keeps its case's (`bookcase west-2`). */
export const SECRET_LEAF_OPEN = 'the secret shelf, open';

/** How far the pull book slides out, metres, and over how long. */
export const SLIDE = 0.12;
export const SLIDE_SECONDS = 0.3;
/** How long the swing takes, from the end of the slide to the thunk. */
export const SWING_SECONDS = 1.6;
/**
 * Where the swing ends: a quarter turn, flat against the den's south wall.
 * **The one owner of the turn**: the drawn leaf lands here, and the open
 * collider is the shut one turned this far about the hinge
 * ({@link turnedAboutHinge}), so neither can land without the other.
 */
export const SWING_END = Math.PI / 2;
/** The pull book's ease home after the landing: a half-life. */
const BOOK_HOME_HALF_LIFE = 0.08;
/** The twinkle on the gold book: one wink every this many seconds while shut. */
export const TWINKLE_PERIOD = 4.5;
/** The twinkle's sprite: its size, and how far in front of the book's spine it floats. */
const TWINKLE_SIZE = 0.3;
const TWINKLE_OUT = 0.06;

/**
 * **A footprint turned `angle` about the hinge**, room-local, `angle` in the
 * leaf's own `rotation.y` sense: the box that covers the drawn leaf at that
 * turn, exactly as the shut footprint covers it at 0. The open collider is
 * the shut footprint turned {@link SWING_END}.
 */
export function turnedAboutHinge(box: BoxFootprint, hinge: LocalPoint, angle: number): BoxFootprint {
  const dx = box.x - hinge.x;
  const dz = box.z - hinge.z;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: hinge.x + dx * cos + dz * sin,
    z: hinge.z - dx * sin + dz * cos,
    facing: (((box.facing + (angle * 180) / Math.PI) % 360) + 360) % 360,
    halfLength: box.halfLength,
    halfDepth: box.halfDepth,
  };
}

export class SecretLeaf {
  /** On the west wall's inner face at the doorway's south edge, turned to the case's facing; holds {@link leaf}. */
  readonly hinge = new Group();
  /** The swinging part: the case, its row of books, the pull book and its twinkle. `rotation.y` is {@link angle}. */
  readonly leaf = new Group();
  /** The gold book she pulls (`library.secretBook`), in the leaf's frame. */
  readonly pullBook: Mesh;
  /** The twinkle over the pull book — shut only. */
  readonly twinkle: Sprite;
  /** Where the pull book stands in the room while the leaf is shut — its zone sits here, and never moves (Decision 35). */
  readonly shutBookRoom: LocalPoint;
  /** The two footprints, room-local: the shut case where an ordinary one stands, and the open leaf along the den's south wall. */
  readonly shutFootprint: BoxFootprint;
  readonly openFootprint: BoxFootprint;
  /** The two collider sets, both registered through props; exactly one is in the world at any time. */
  readonly shutColliders: BoxWalls;
  readonly openColliders: BoxWalls;
  /**
   * The open leaf's fade, built on the **open** footprint: it stands between
   * the camera and a child in the den, and it can never fire while the leaf is
   * shut, when that footprint is empty den floor nobody can reach.
   */
  readonly fader: StackFader;

  private readonly props: LibraryProps;
  private readonly bookHome: Vector3;
  private readonly twinkleMaterial: SpriteMaterial;
  private state: 'shut' | 'swinging' | 'open' = 'shut';
  /** Seconds since the pull. */
  private tau = 0;
  private angleNow = 0;
  /** How far the pull book is out of its row. */
  private slide = 0;

  constructor(props: LibraryProps, roomRoot: Group, books: readonly PlacedBook[]) {
    this.props = props;
    const spec = LIBRARY_SECRET_BOOKCASE;
    const model = createLibrarySecretLeaf();
    const { length, depth, height } = model.size;
    const [, gapSouth] = libraryDenGap();
    const hingeAt: LocalPoint = { x: spec.at.x, z: gapSouth };
    const yaw = (spec.facing * Math.PI) / 180;

    // The hinge: the case's back on the wall's inner face, at the doorway's
    // south edge, turned to the case's facing — asset +X along the wall to the
    // north, asset +Z out into the room.
    this.hinge.name = 'library.secretShelf';
    this.hinge.position.set(hingeAt.x, 0, hingeAt.z);
    this.hinge.rotation.y = yaw; // flat-ok: room-local yaw in the library's own flat space at (-600, -600), off the sphere
    this.leaf.name = 'library.secretShelf.leaf';
    this.hinge.add(this.leaf);
    this.leaf.add(model.root);

    // Its row of books, carried from the case-centred frame the furnisher drew
    // them in onto the leaf's back-left origin, in a paint of the leaf's own.
    const toLeaf = new Vector3(length / 2, 0, depth / 2);
    const bookMaterial = libraryBookMaterial().clone();
    const row = bookInstances(books, libraryBookShapes(), bookMaterial, toLeaf);
    row.name = 'library.secretShelf.books';
    this.leaf.add(row);

    // The pull book: the readable books' shape, in gold, standing proud of its
    // row like a readable book does — the one book on this case that does
    // something, drawn as the one book a child's eye goes to.
    const shape = libraryShelfBookShape();
    this.pullBook = createShelfBook(ART.helmetGold);
    this.pullBook.name = 'library.secretBook';
    const outline = this.pullBook.children[0];
    if (outline) outline.name = `${this.pullBook.name}.outline`;
    this.bookHome = bookSpot(spec.kind, LIBRARY_SECRET_BOOK.shelf, LIBRARY_SECRET_BOOK.along, shape.depth, READABLE_PROUD).add(toLeaf);
    this.pullBook.position.copy(this.bookHome);
    this.leaf.add(this.pullBook);

    // The twinkle: one warm wink in front of the spine, shut only.
    this.twinkleMaterial = new SpriteMaterial({ map: glowTexture(PALETTE.fairyWarm), transparent: true, depthWrite: false, opacity: 0 });
    this.twinkle = new Sprite(this.twinkleMaterial);
    this.twinkle.name = 'library.secretBook.twinkle';
    this.twinkle.scale.setScalar(TWINKLE_SIZE);
    this.twinkle.position.copy(this.bookHome).add(new Vector3(0, shape.height * 0.6, shape.depth / 2 + TWINKLE_OUT));
    this.twinkle.visible = false;
    this.leaf.add(this.twinkle);
    roomRoot.add(this.hinge);

    // Where the shut book stands in the room: the leaf's frame at angle 0,
    // through the hinge.
    this.shutBookRoom = {
      x: hingeAt.x + this.bookHome.x * Math.cos(yaw) + this.bookHome.z * Math.sin(yaw),
      z: hingeAt.z - this.bookHome.x * Math.sin(yaw) + this.bookHome.z * Math.cos(yaw),
    };

    // Both collider states, keep-out checked as they go down; the open one
    // taken out at once. Shut, the case stands where an ordinary one would;
    // open, it is that box turned the swing's own quarter about the hinge.
    const centre = bookcaseCentre(spec);
    this.shutFootprint = { x: centre.x, z: centre.z, facing: spec.facing, halfLength: length / 2, halfDepth: depth / 2 };
    this.openFootprint = turnedAboutHinge(this.shutFootprint, hingeAt, SWING_END);
    this.shutColliders = props.box(`bookcase ${spec.id}`, this.shutFootprint, height);
    this.openColliders = props.box(SECRET_LEAF_OPEN, this.openFootprint, height);
    props.detach(this.openColliders);

    const fading: Material[] = [...model.materials, bookMaterial, this.pullBook.material as Material];
    if (outline && 'material' in outline) fading.push((outline as Mesh).material as Material);
    this.fader = new StackFader(
      'secret-shelf-open',
      this.leaf,
      { x: this.openFootprint.x, z: this.openFootprint.z },
      this.openFootprint.facing,
      { length, depth, height },
      fading,
    );
  }

  /** Landed open: the open set is in the world and the shut one out. */
  get open(): boolean {
    return this.state === 'open';
  }

  /** Mid-swing: the shut set still holds, the leaf is turning. */
  get swinging(): boolean {
    return this.state === 'swinging';
  }

  /** The leaf's turn from shut, radians, 0 to `SWING_END`. */
  get angle(): number {
    return this.angleNow;
  }

  /**
   * **Pull the book.** Ignored unless the leaf is shut (a second press
   * mid-swing, or on an open leaf, does nothing): the creak, the slide, then
   * the swing, frame by frame in {@link update}. True when it started.
   */
  pull(): boolean {
    if (this.state !== 'shut') return false;
    this.state = 'swinging';
    this.tau = 0;
    playSecretDoor();
    return true;
  }

  /**
   * One frame: the twinkle while shut; the slide and the swing while
   * swinging — the angle is `SWING_END · (1 − (1 − u)³)` with `u` the swing's
   * own clock, monotone and never past `SWING_END`; on `u ≥ 1` the landing,
   * which is the one frame the colliders swap; and the book easing home after.
   */
  update(dt: number, elapsed: number): void {
    const shut = this.state === 'shut';
    this.twinkleMaterial.opacity = shut ? Math.max(0, Math.sin((elapsed * 2 * Math.PI) / TWINKLE_PERIOD)) ** 8 : 0;
    this.twinkle.visible = this.twinkleMaterial.opacity > 0.001;
    if (this.state === 'swinging') {
      this.tau += dt;
      this.slide = SLIDE * Math.min(1, this.tau / SLIDE_SECONDS);
      const u = Math.min(1, Math.max(0, (this.tau - SLIDE_SECONDS) / SWING_SECONDS));
      this.setAngle(SWING_END * (1 - (1 - u) ** 3));
      if (u >= 1) this.land(true);
    } else if (this.slide > 0) {
      this.slide = damp(this.slide, 0, BOOK_HOME_HALF_LIFE, dt);
      if (this.slide < 1e-3) this.slide = 0;
    }
    this.pullBook.position.z = this.bookHome.z + this.slide;
  }

  /**
   * **Open, now, silently** — the guard's road (plan Decision 24), and the way
   * a `/library?at=` link into the den, or a save restored there, finds the
   * leaf: no creak, no swing through anyone, the colliders swapped this frame.
   */
  openInstantly(): void {
    if (this.state === 'open') return;
    this.land(false);
    this.slide = 0;
    this.pullBook.position.z = this.bookHome.z;
  }

  /** **Shut, now** — every visit from the park starts shut, so the trick is there to find again. */
  closeInstantly(): void {
    if (this.state === 'shut') return;
    this.state = 'shut';
    this.tau = 0;
    this.slide = 0;
    this.setAngle(0);
    this.props.detach(this.openColliders);
    this.props.attach(this.shutColliders);
    this.pullBook.position.z = this.bookHome.z;
  }

  /** The landing: exactly `SWING_END`, the one-frame swap of the colliders, and the thunk if it was a swing. */
  private land(sound: boolean): void {
    this.setAngle(SWING_END);
    this.state = 'open';
    this.props.detach(this.shutColliders);
    this.props.attach(this.openColliders);
    if (sound) playSecretThunk();
  }

  private setAngle(angle: number): void {
    this.angleNow = angle;
    this.leaf.rotation.y = angle; // flat-ok: the leaf's turn on its own hinge, room-local in the library's flat space
  }
}
