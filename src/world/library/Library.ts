import { Group, Vector3 } from 'three';
import type { CollisionWorld, WallCollider } from '../Collision';
import type { WalkSurfaces } from '../building/surfaces';
import type { InteriorControls } from '../building/Building';
import { SpaceManager } from '../SpaceManager';
import { bandCrossed, type PortalBand } from '../tapSpacing';
import { circleBoundary, GARDEN_PLAY_BOUNDARY } from '../boundary';
import { SPACE_LIBRARY, spaceAt } from '../spaces';
import { pressAction, type InteractZone } from '../interact';
import { highlightObject } from '../highlight';
import type { PlacedEntry } from '../parkLayout';
import { standInPlot, type AnchorPlots } from '../AnchorPlots';
import { terrainHeight } from '../terrain';
import type { Player } from '../../entities/Player';
import type { FrameContext, GameSystem } from '../../core/types';
import type { IsoCamera } from '../../core/IsoCamera';
import { BUILDING_STEP_UP } from '../../core/constants';
import type { ManagedLabel } from '../../ui/LabelManager';
import { NameLabel } from '../../ui/NameLabel';
import { ANCHORS_BY_ID } from '../anchors';
import { createLibraryExterior, createLibrarySkirt, dressedReach, type LibraryExterior } from '../../art/models/libraryAssets';
import { kitBounds } from '../../art/models/libraryKit';
import { LibraryLighting } from './lighting';
import { LibraryProps, type LibrarySolid, type LibraryStandable } from './props';
import { furnishReadingRoom, type FurnishedShelfBook, type StackFader } from './furnish';
import { LIBRARY_CHIPS } from './libraryLines';
import { shelfBookZoneId } from './shelfBooks';
import {
  buildReadingRoomShell,
  libraryEntryBand,
  libraryExitBand,
  LibraryFrame,
  registerLibraryShellCollision,
  registerLibrarySteps,
  type LibraryShellSolids,
} from './shell';
import {
  LIBRARY_ARRIVAL,
  LIBRARY_BOUNDING_RADIUS,
  LIBRARY_EXTERIOR_PLAN,
  LIBRARY_FLOOR_Y,
  LIBRARY_ORIGIN_X,
  LIBRARY_ORIGIN_Z,
  LIBRARY_PLAY_RADIUS,
  libraryStandSpots,
  type LibraryExteriorPlan,
  type LocalPoint,
} from './layout';
import type { OpenAreaPoint } from '../dismount';

/**
 * **The Library** (#714, part 2: #716) — Jim, 13 October 2026: *"a library,
 * including many readable books, a librarian, and many other cute features and
 * a dimly lit atmosphere. Just one floor with shelves of many books."*
 *
 * ## Two places, one door
 *
 * The exterior — a classic pillared library in toy proportions: two full-width
 * steps, six fat columns, an entablature and a pediment with a book carved in
 * it — stands on the park's `library` plot, turned to face the camera. Its
 * arched door is the one way in: walking through it (a swept `PortalBand`,
 * `bandCrossed` against `Player.previousPosition`, so a long frame cannot skip
 * it) changes space through `SpaceManager` into the reading room, a disjoint
 * flat space at (-600, -600) — a hotel room in shape, open-topped for the
 * camera, 36 x 26 m behind a facade half its width. Walking out of the room's
 * doorway puts her back on the plot's doormat. `Hotel.ts` and
 * `ReptileHouse.ts` are the precedent for every one of those moves.
 *
 * ## What is solid
 *
 * Everything drawn. Outside, every collider is built from the drawn shell's
 * own vertices (`libraryKit.ts`): the cella is a closed ring with one aperture,
 * the door's recess (enterable, leavable), its outside corners squared; the
 * six columns are their round feet; the plinth's sides and back are thin walls
 * on its drawn edges, so the steps are the one way up; and the plinth and the
 * steps are surfaces she walks up. Inside: every bookcase, the desk, every
 * chair, lamp and table goes through {@link LibraryProps}, which refuses a
 * collider on any spot `libraryKeepOuts` says she must stand on, and nothing
 * is a rectangle with a hollow middle. `scripts/check-library.mts` floods the
 * floor from the arrival (with a control first), marches at the facade from
 * forty-eight bearings, lands a jump on every top she can stand on, and walks
 * the door both ways.
 *
 * ## Its name
 *
 * "The Library" floats over the door as a name pill (`NameLabel`, the label
 * system's `name` kind), read from the plot's own sign title — the one owner
 * of what the building is called. A pill rather than painted letters: the
 * frieze is half a metre of stone, so a painted word there is under the TEXT
 * RULE's minimum on screen at the park camera, and the 28 July family ruling
 * keeps words off in-world boards (`core/textures.ts`); the pill is screen
 * constant, so it is never too small to read.
 *
 * ## What later PRs add (#714 parts 3-5)
 *
 * The twelve readable books stand in `LIBRARY_READABLE_SLOTS` (#718: a gap is
 * already left on each shelf), the owl librarian behind the desk at
 * `LIBRARY_LIBRARIAN_SPOT`, and the secret den behind `LIBRARY_SECRET_BOOKCASE`
 * (#719). Their stand spots are kept clear today.
 */
export interface LibraryDeps {
  /** The park's plot for the building. */
  readonly plot: PlacedEntry;
  /** The park's reserved plots: the exterior stands in `anchor:library`, leant to the sphere. */
  readonly anchorPlots: AnchorPlots;
  /** For the stacks' sightline fade. */
  readonly camera: IsoCamera;
}

/**
 * **What opens a library book** (#718): `Game`'s one opener, the same object
 * the Cute-o-dex's bookmarks press (`CuteODex.setBookReader`, whose
 * `DexBookReader` is this shape), so a book taken off the shelf and a book
 * reopened from its bookmark open the one way.
 */
export interface LibraryBookOpener {
  /** Opens a book at its title page; false for an id that is not a book. */
  open(bookId: string): boolean;
  isOpen(): boolean;
}

/** The exterior's tap zone's id — and its band's own zone. */
const ENTRANCE_ZONE = 'library-entrance';

/** How translucent a stack goes while it hides her: never gone, just out of the way. */
const STACK_FADED_ALPHA = 0.28;

/**
 * How close (XZ metres) a tap must land to a readable book to count as that
 * book: a book's width and a finger's slack. `check:tap-spacing` measures how
 * near any two picks come.
 */
const SHELF_BOOK_PICK_RADIUS = 0.7;

export class Library implements GameSystem {
  readonly name = 'library';
  /** The reading room, at its own origin, hidden unless she is inside. */
  readonly roomRoot = new Group();
  /** The building in the park, inside `anchor:library`. */
  readonly parkRoot = new Group();
  /** The building's frame and the plan measured off its model — for the checks. */
  readonly frame: LibraryFrame;
  readonly plan: LibraryExteriorPlan;
  /** The exterior's colliders, in registration order — so a check can open one and go red. */
  readonly shellSolids: LibraryShellSolids;
  /** How deep the plinth's skirt runs under its base, to meet the lowest ground round it. */
  readonly skirtDepth: number;
  /** "The Library", over the door. */
  readonly nameLabel: NameLabel;
  /** The reading room's own four walls' colliders. */
  readonly roomWalls: readonly WallCollider[];
  /** Every free-standing stack and its fade. */
  readonly stacks: readonly StackFader[];
  /** How many decorative books the shelves hold. */
  readonly bookCount: number;
  /**
   * **The readable books on their shelves** (#718), one per `BOOKS` entry, in
   * `SHELF_BOOKS`' order: each one's book, slot, mesh, own paint and room-local
   * spot — for their zones, the checks, and the recommendation's glow (Step 6).
   */
  readonly shelfBooks: readonly FurnishedShelfBook[];
  /** The room's light rig — for the checks (no black light, the darkest floor). */
  readonly lighting: LibraryLighting;
  /** How far the building is moved along its up from the ground at its centre (`libraryBaseSink`). */
  readonly baseSink: number;

  private readonly collision: CollisionWorld;
  private readonly controls: InteriorControls;
  private readonly surfaces: WalkSurfaces;
  private readonly deps: LibraryDeps;
  private readonly spaces: SpaceManager;
  private readonly props: LibraryProps;
  /** The drawn building. */
  readonly exterior: LibraryExterior;
  private player: Player | null = null;
  private inside = false;
  private readonly from = new Vector3();
  private readonly cameraLocal = new Vector3();
  /** One "Read it!" zone per readable book, built once: the books never move. */
  private readonly bookZones: readonly InteractZone[];
  /** What a Read chip opens a book with ({@link attachBookReader}); null until `Game` attaches it, and headless. */
  private bookOpener: LibraryBookOpener | null = null;

  constructor(collision: CollisionWorld, controls: InteriorControls, surfaces: WalkSurfaces, deps: LibraryDeps) {
    this.collision = collision;
    this.controls = controls;
    this.surfaces = surfaces;
    this.deps = deps;
    this.spaces = new SpaceManager(controls);

    // ------------------------------------------------------ the reading room
    this.roomRoot.name = 'the-library-inside';
    this.roomRoot.position.set(LIBRARY_ORIGIN_X, LIBRARY_FLOOR_Y, LIBRARY_ORIGIN_Z);
    this.roomRoot.visible = false;
    this.roomWalls = buildReadingRoomShell(this.roomRoot, collision, surfaces);
    this.props = new LibraryProps(collision, surfaces, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z);
    const furnished = furnishReadingRoom(this.roomRoot, this.props);
    this.stacks = furnished.stacks;
    this.bookCount = furnished.bookCount;
    this.shelfBooks = furnished.shelfBooks;
    this.bookZones = this.shelfBooks.map((placed) => this.shelfBookZone(placed));
    this.lighting = new LibraryLighting(furnished.pools);
    this.roomRoot.add(this.lighting.group);
    this.props.assertClear();

    // ------------------------------------------------------- the building
    const plot = deps.plot;
    const yaw = Math.atan2(plot.entranceX - plot.x, plot.entranceZ - plot.z);
    this.exterior = createLibraryExterior();
    this.plan = LIBRARY_EXTERIOR_PLAN;
    this.assertDressedInsideThePlot();
    // **Set down to meet the ground at the foot of its steps.** The building
    // stands square to the local up at its centre, and the planet falls away
    // from that on every side — 0.11 m at the step's front on a flat seed,
    // more or less where the ground's waves rise and fall across it. Stood on
    // its centre, the bottom riser could be the drawn 0.18 plus all of that.
    // So the building is lowered (or raised) until the ground where the path
    // arrives — the middle of the step's front — is level with its base, and
    // no further than keeps every other riser along the front inside the step
    // a child can take (`libraryBaseSink`). `aChildWalksUpTheLibraryStepsAndIn`
    // walks up it on every seed. The plinth's skirt runs a metre into the
    // ground, so nothing shows a gap.
    const centreGround = terrainHeight(plot.x, plot.z);
    const sink = libraryBaseSink(new LibraryFrame(plot.x, plot.z, yaw, centreGround), this.plan);
    this.baseSink = sink;
    this.frame = new LibraryFrame(plot.x, plot.z, yaw, centreGround + sink);
    const group = deps.anchorPlots.getGroup('library');
    this.parkRoot.name = 'the-library-outside';
    // The plot's own origin is the ground under the building, leant to the
    // local up; `standInPlot` carries the world transform back through it, so
    // the plinth stands on the sphere (the hotel's 13 Sep "floating" fix).
    standInPlot(group, this.parkRoot, plot.x, plot.z, sink, yaw);
    this.parkRoot.add(this.exterior.root);
    // The skirt runs down to the lowest ground round the plinth, and a little
    // past it, so a gap never opens under a corner the planet falls away from.
    this.skirtDepth = librarySkirtDepth(this.frame, this.plan);
    this.parkRoot.add(createLibrarySkirt(this.skirtDepth));
    group.add(this.parkRoot);
    deps.anchorPlots.setPlaceholderVisible('library', false);
    this.shellSolids = registerLibraryShellCollision(collision, this.frame, this.plan);
    registerLibrarySteps(surfaces, this.frame, this.plan);

    // "The Library", over the middle of the entablature, just proud of it.
    const entablature = kitBounds(['shell-entablature']);
    this.nameLabel = new NameLabel({ id: 'library-name', item: ENTRANCE_ZONE, kind: 'name' }, ANCHORS_BY_ID.library.signTitle, ANCHORS_BY_ID.library.accent);
    this.nameLabel.sprite.position.set(0, (entablature.minY + entablature.maxY) / 2, entablature.maxZ + 0.1);
    this.parkRoot.add(this.nameLabel.sprite);
  }

  /**
   * **The dressed building inside the plot the park was solved with.** The
   * plot's radius and the paths' clearance are the drawn shell's own bare
   * vertices (`libraryKit.ts`), so they agree by construction; what the plan
   * cannot see is the ink outline every part is dressed with, which the
   * manifest's bounding radius allows a hand's breadth for. Measured here, on
   * the dressed model, so a thicker outline is a build failure rather than a
   * neighbour's tree growing through the roof's ink.
   */
  private assertDressedInsideThePlot(): void {
    const reach = dressedReach(this.exterior.root);
    if (reach > LIBRARY_BOUNDING_RADIUS) {
      throw new Error(`Library: a dressed vertex (outline included) stands ${reach.toFixed(3)} m out, past the plot's bounding radius ${LIBRARY_BOUNDING_RADIUS.toFixed(3)}`);
    }
  }

  // --------------------------------------------------------------- state

  /** In the reading room: the sky's lights go off and the room lights itself. */
  get playerIsInside(): boolean {
    return this.inside;
  }

  /** Where she stands outside: the plot's doormat, the one the paths are routed to. */
  get doormat(): { readonly x: number; readonly z: number } {
    return { x: this.deps.plot.entranceX, z: this.deps.plot.entranceZ };
  }

  /** Every solid the reading room registered, with its collision handle — so a check can remove one and go red. */
  get solids(): readonly LibrarySolid[] {
    return this.props.solids;
  }

  /** Every top in the reading room she may stand on, with its drawn footprint — so a check can land a jump on each. */
  get standables(): readonly LibraryStandable[] {
    return this.props.standables;
  }

  /** The building's name over its door (the owl's bubbles arrive with #714 part 4). */
  get screenLabels(): readonly ManagedLabel[] {
    return [this.nameLabel];
  }

  attachPlayer(player: Player): void {
    this.player = player;
  }

  /**
   * **The book reader the shelves open** (#718): `Game`'s one
   * {@link LibraryBookOpener}, the object the Cute-o-dex's bookmarks use too.
   * Late-bound, because the reader is DOM and WebGL built after the world; with
   * none attached — headless, or a check's own stub swapped back out — a Read
   * chip is offered and does nothing.
   */
  attachBookReader(opener: LibraryBookOpener | null): void {
    this.bookOpener = opener;
  }

  /**
   * Adopt a player restored into the reading room — being there is a position
   * plus the room switched on and the bounds bound, none of which a
   * constructor can do. A no-op for a park spawn.
   */
  adoptRestoredPlayer(): void {
    const player = this.player;
    if (!player) return;
    if (spaceAt(player.position.x, player.position.z) !== SPACE_LIBRARY) return;
    this.inside = true;
    this.roomRoot.visible = true;
    this.boundToRoom();
    this.spaces.holdOff();
  }

  // --------------------------------------------------------------- doors

  /**
   * `/library`, and `/library?at=x,z&facing=deg` (`main.ts`'s `library`
   * `DeepLink`, through `Game.enterLibrarySpawn`): into the reading room —
   * **from anywhere, the room included** (a save written inside restores her
   * there before a link runs; the Reptile House's lesson). `at` is room-local
   * metres; without it, just inside the door, facing up the central aisle.
   */
  requestEnter(at?: { readonly x: number; readonly z: number; readonly facing?: number }): boolean {
    const player = this.player;
    if (!player || player.riding || this.spaces.isChanging) return false;
    this.spaces.changeTo(() => this.enterRoom(at));
    return true;
  }

  /** `/library-door`: outside, on the doormat at the foot of the steps, facing the door. */
  requestEnterDoor(): boolean {
    const player = this.player;
    if (!player || player.riding || this.spaces.isChanging) return false;
    this.spaces.changeTo(() => this.standOutside(this.frame.yaw + Math.PI));
    return true;
  }

  /** The front door's band and the room's exit, for the tap-spacing check and the invariants. */
  doorBands(): PortalBand[] {
    return [libraryEntryBand(this.frame, this.plan), libraryExitBand()];
  }

  /**
   * Inside, a "Read it!" zone on every readable book — unless she is riding
   * (sitting, #718 Step 7), when the room offers her nothing to walk to.
   * Outside, the building's entrance.
   */
  interactZones(): InteractZone[] {
    if (this.inside) return this.player?.riding ? [] : [...this.bookZones];
    return [this.exteriorEntranceZone()];
  }

  update(context: FrameContext): void {
    const { dt } = context;
    this.spaces.update(dt);
    this.updateNameLabel();
    const player = this.player;
    if (!player) return;
    if (this.inside) this.fadeStacks(player, dt);
    if (!this.spaces.isChanging && !player.riding) this.checkDoorways(player);

    // Nobody falls out of the world: a slipped trigger lands her back at the arrival.
    if (this.inside && !this.spaces.isChanging && player.position.y < LIBRARY_FLOOR_Y - 2) { // flat-ok: two metres under the reading room's floor; the library is its own flat space at (-600, -600), off the sphere
      this.enterRoom();
      this.controls.snapCamera();
    }
  }

  dispose(): void {
    // Nothing per-frame to tear down: the room's meshes and lights live in the scene graph.
  }

  // ------------------------------------------------------------ private

  /** The name pill: screen-constant like every name, wanted outside and within a name's reach of the camera. */
  private updateNameLabel(): void {
    if (this.inside) {
      this.nameLabel.withhold();
      return;
    }
    const camera = this.deps.camera;
    const at = this.nameLabel.sprite.getWorldPosition(this.from);
    this.nameLabel.updateScreenSize(camera.worldUnitsPerPixel, at.distanceTo(camera.focusPoint));
  }

  /** A stack between the camera and her eases translucent; one that is not, back to solid. */
  private fadeStacks(player: Player, dt: number): void {
    const camera = this.deps.camera.camera.position;
    this.cameraLocal.set(camera.x - LIBRARY_ORIGIN_X, camera.y - LIBRARY_FLOOR_Y, camera.z - LIBRARY_ORIGIN_Z);
    const localX = player.position.x - LIBRARY_ORIGIN_X;
    const localZ = player.position.z - LIBRARY_ORIGIN_Z;
    const feet = player.position.y - LIBRARY_FLOOR_Y; // flat-ok: height above the reading room's own flat floor, in its own space off the sphere
    for (const stack of this.stacks) {
      let hides = false;
      for (const up of [0.3, 1, 1.7]) {
        this.from.set(localX, feet + up, localZ);
        if (stack.hides(this.from, this.cameraLocal)) {
          hides = true;
          break;
        }
      }
      stack.fadeTowards(hides ? STACK_FADED_ALPHA : 1, dt);
    }
  }

  private checkDoorways(player: Player): void {
    const { x, z } = player.position;
    const fromX = player.previousPosition.x;
    const fromZ = player.previousPosition.z;
    if (!this.inside) {
      // The cooldown guards the band that just fired: she is put down on the
      // doormat, well outside the entry band, and must not be pulled straight
      // back in. Inside, the arrival is 1.8 m from the exit band, so the exit
      // is checked from the first frame (the Reptile House's solidity review).
      if (this.spaces.settling) return;
      if (bandCrossed(libraryEntryBand(this.frame, this.plan), fromX, fromZ, x, z)) {
        this.spaces.changeTo(() => this.enterRoom());
      }
      return;
    }
    if (bandCrossed(libraryExitBand(), fromX, fromZ, x, z)) {
      this.spaces.changeTo(() => this.standOutside(this.frame.yaw));
    }
  }

  private enterRoom(at?: { readonly x: number; readonly z: number; readonly facing?: number }): void {
    const player = this.player;
    if (!player) return;
    this.inside = true;
    this.roomRoot.visible = true;
    this.boundToRoom();
    const spot: LocalPoint = at ?? LIBRARY_ARRIVAL;
    const facing = ((at?.facing ?? LIBRARY_ARRIVAL.facing) * Math.PI) / 180;
    player.teleportTo(LIBRARY_ORIGIN_X + spot.x, LIBRARY_FLOOR_Y, LIBRARY_ORIGIN_Z + spot.z, facing);
    // A fresh visit starts with every stack solid.
    for (const stack of this.stacks) stack.setAlpha(1);
  }

  /**
   * **The reading room's open area**, for the put-down rule
   * (`world/dismount.ts`): `libraryStandSpots`, the single owner of every spot
   * a child must be able to stand on in here — the arrival, the doorway, the
   * desk, every seat's front, every readable book's stand. World metres.
   */
  openArea(): OpenAreaPoint[] {
    return libraryStandSpots().map((spot) => ({ x: LIBRARY_ORIGIN_X + spot.x, z: LIBRARY_ORIGIN_Z + spot.z }));
  }

  /**
   * **She has been taken somewhere else, behind an iris somebody else is
   * running** — the "Next day" button, from the reading room. The room stops
   * being where she is, as walking out would leave it; no teleport and no play
   * bounds, which the space she was taken to owns.
   */
  releasePlayer(): void {
    if (!this.inside) return;
    this.inside = false;
    this.roomRoot.visible = false;
  }

  /** Out on the doormat, facing `facing` (radians): away from the door on leaving, at it for the door link. */
  private standOutside(facing: number): void {
    const player = this.player;
    if (!player) return;
    this.inside = false;
    this.roomRoot.visible = false;
    this.collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
    const mat = this.doormat;
    player.teleportTo(mat.x, this.surfaces.sample(mat.x, mat.z, terrainHeight(mat.x, mat.z) + 3), mat.z, facing);
  }

  private boundToRoom(): void {
    this.collision.setPlayBounds(circleBoundary(LIBRARY_PLAY_RADIUS, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z));
  }

  /**
   * **A readable book's zone** (#718): on the book itself, a metre over the
   * floor (where a tap on a book on a low shelf lands); stood at its slot's
   * stand, in front of the case, facing it; the rainbow round the book's own
   * mesh; and one chip, "Read it!", which opens that book through the attached
   * opener — the paper book over the paused park.
   */
  private shelfBookZone(placed: FurnishedShelfBook): InteractZone {
    const { book, slot, mesh, local } = placed;
    return {
      id: shelfBookZoneId(book.id),
      label: book.title,
      x: LIBRARY_ORIGIN_X + local.x,
      y: LIBRARY_FLOOR_Y + 1,
      z: LIBRARY_ORIGIN_Z + local.z,
      pickRadius: SHELF_BOOK_PICK_RADIUS,
      standX: LIBRARY_ORIGIN_X + slot.stand.x,
      standZ: LIBRARY_ORIGIN_Z + slot.stand.z,
      verb: 'Read',
      highlight: highlightObject(mesh),
      actions: () =>
        pressAction(
          LIBRARY_CHIPS.read,
          () => {
            this.bookOpener?.open(book.id);
          },
          '📖',
        ),
    };
  }

  /**
   * The building from outside: one zone over its body and its doormat, no
   * actions (walking through the doorway is what enters), its stand spot the
   * band's own centre — `Hotel.exteriorEntranceZone`'s shape and reasoning.
   */
  private exteriorEntranceZone(): InteractZone {
    const band = libraryEntryBand(this.frame, this.plan);
    const plot = this.deps.plot;
    const reach = Math.hypot(plot.entranceX - plot.x, plot.entranceZ - plot.z);
    return {
      id: ENTRANCE_ZONE,
      label: 'The Library',
      x: plot.x,
      y: this.surfaces.sample(plot.x, plot.z, terrainHeight(plot.x, plot.z) + 3),
      z: plot.z,
      pickRadius: reach + 0.5,
      standX: band.centreX,
      standZ: band.centreZ,
    };
  }
}

/**
 * **How deep the skirt under the plinth must run**: the lowest ground round
 * the plinth and the steps, in the building's own frame (its base at local
 * y 0), and a hand's breadth past it — the stone carried on into the ground
 * wherever the planet, or a wave of it, falls away from a building that stands
 * square to the up at its centre.
 */
export function librarySkirtDepth(frame: LibraryFrame, plan: LibraryExteriorPlan): number {
  const local = new Vector3();
  let lowest = 0;
  const ground = (x: number, z: number): void => {
    const at = frame.foot(x, z);
    lowest = Math.min(lowest, frame.toLocal(at.x, terrainHeight(at.x, at.z), at.z, local).y);
  };
  for (let x = -plan.plinthHalfX; x <= plan.plinthHalfX + 1e-6; x += 0.5) {
    ground(x, plan.plinthBackZ);
    ground(x, plan.stepFrontZ);
  }
  for (let z = plan.plinthBackZ; z <= plan.stepFrontZ + 1e-6; z += 0.5) {
    ground(-plan.plinthHalfX, z);
    ground(plan.plinthHalfX, z);
  }
  return -lowest + SKIRT_MARGIN;
}

/** How far past the lowest ground round the plinth its skirt runs. */
const SKIRT_MARGIN = 0.3;

/**
 * **How far to move the building along its own up so a child can walk onto its
 * step anywhere along it.** Metres; negative lowers it.
 *
 * The ground along the front of the lower tread, a few centimetres out where
 * her feet are before she steps up, in the building's own frame. The middle
 * of it — where the path arrives — is set level with the base, so the path's
 * paving meets the step's foot and the riser there is the drawn one. Unless
 * that leaves the lowest point along the front with a riser past
 * `BUILDING_STEP_UP` (less a 0.1 m margin): then the building goes down to
 * there, and the middle of the step is a little sunk in the lawn instead.
 */
export function libraryBaseSink(frame: LibraryFrame, plan: LibraryExteriorPlan): number {
  const groundAt = (across: number): number => {
    const at = frame.foot(across, plan.stepFrontZ + 0.1);
    return frame.toLocal(at.x, terrainHeight(at.x, at.z), at.z, new Vector3()).y;
  };
  let lowest = Infinity;
  for (let across = -plan.plinthHalfX; across <= plan.plinthHalfX + 1e-6; across += 0.5) lowest = Math.min(lowest, groundAt(across));
  const steepest = BUILDING_STEP_UP - 0.1 - plan.stepTop;
  return Math.min(groundAt(0), lowest + steepest);
}
