import { Group, Vector3, type MeshToonMaterial, type Object3D } from 'three';
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
import type { Player, RideHolder } from '../../entities/Player';
import type { CharacterModel } from '../../entities/CharacterModel';
import type { NpcCharacter, ResidentSpec } from '../../entities/npc';
import type { FrameContext, GameSystem } from '../../core/types';
import type { IsoCamera } from '../../core/IsoCamera';
import { BUILDING_STEP_UP } from '../../core/constants';
import type { ManagedLabel } from '../../ui/LabelManager';
import { NameLabel } from '../../ui/NameLabel';
import { ANCHORS_BY_ID } from '../anchors';
import { createLibraryExterior, createLibrarySkirt, dressedReach, libraryCushionSize, type LibraryExterior } from '../../art/models/libraryAssets';
import { KID_HIP_HEIGHT } from '../../art/models/kid';
import { kitBounds } from '../../art/models/libraryKit';
import { LibraryLighting } from './lighting';
import { LibraryProps, type LibrarySolid, type LibraryStandable } from './props';
import { furnishReadingRoom, type FurnishedShelfBook, type StackFader } from './furnish';
import { LIBRARY_CHIPS } from './libraryLines';
import { shelfBookZoneId } from './shelfBooks';
import { libraryResidents, type LibraryResident } from './LibraryKids';
import type { LibraryKidDriver } from './libraryKidDriver';
import {
  buildLibraryDenShell,
  buildReadingRoomShell,
  libraryEntryBand,
  libraryExitBand,
  LibraryFrame,
  registerLibraryRoofCollision,
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
  LIBRARY_PLAYER_SEATS,
  libraryCushion,
  libraryFacingStoryChair,
  libraryStandSpots,
  type LibraryExteriorPlan,
  type LibraryKidPlan,
  type LibraryPlayerSeat,
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
 * ## What the rest of the Library adds (#714 parts 4-5)
 *
 * The readable books stand in `LIBRARY_READABLE_SLOTS` (#718, `shelfBooks.ts`:
 * the twelve picture books, then the big readers' shelf, whose slots wait as
 * gaps until their chapter books land), and her two story cushions offer a
 * seat. Still to come on their own tracks: the owl librarian behind the desk
 * at `LIBRARY_LIBRARIAN_SPOT` and story time (#718), and the secret shelf
 * swinging open onto the den below, with its dragon and the cat (#719). Every
 * one of their stand spots is a keep-out already.
 *
 * ## The secret den (#719)
 *
 * A walled pocket of the reading room behind its west wall — no space of its
 * own (plan Decision 20). The west wall has a doorway the secret shelf's
 * width, a lintel over it from the shelf's top to the wall's, and the den's
 * floor and three walls beyond ({@link denRoot}, `shell.ts`'s
 * `buildLibraryDenShell`). The shelf is still an ordinary case with its own
 * collider, so the doorway is shut and the den is the one sealed pocket the
 * room has, hidden; the shelf swings open onto it in plan Step 12.
 * `layout.ts`'s `libraryDenContains` is the one owner of "she is in the den".
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

/**
 * A story cushion's Sit zone (#718): a tap within this of the cushion's
 * middle lands on it (the drawn cushion is 0.45 m round), and standing within
 * {@link SIT_STAND_RADIUS} of it — on it, or a stride off it — offers the chip.
 */
const SIT_PICK_RADIUS = 0.8;
const SIT_STAND_RADIUS = 1.6;

/**
 * How far a story cushion's measured top may stand from `KID_HIP_HEIGHT` and
 * still be a seat — see {@link assertCushionsAreSeats}.
 */
const CUSHION_SEAT_TOLERANCE = 0.02;

/** One of her two story cushions: where it is, which way she faces on it, and its drawn piece. */
interface PlayerSeat {
  readonly id: LibraryPlayerSeat;
  readonly at: LocalPoint;
  /** `Player.facing` degrees: at the storyteller's chair (`libraryFacingStoryChair`). */
  readonly facing: number;
  /** The cushion as drawn — what the rainbow hugs while its chip is up. */
  readonly piece: Object3D;
}

/**
 * **One of the library's three children, met again in the crowd** (#718):
 * her plan (`LIBRARY_KID_PLANS`), the driver the Library handed in, the body
 * `NpcSystem` built round it, and the model she is drawn with — for story
 * time (plan Step 9), which sits her and stands her up, and for the checks.
 */
export interface LibraryKid {
  readonly plan: LibraryKidPlan;
  readonly driver: LibraryKidDriver;
  readonly body: NpcCharacter;
  readonly model: CharacterModel;
}

export class Library implements GameSystem {
  readonly name = 'library';
  /** The reading room, at its own origin, hidden unless she is inside. */
  readonly roomRoot = new Group();
  /**
   * **The library's children's models** (#718, `LibraryKids.ts`) — a root of
   * its own at an **identity transform**, because an `NpcCharacter` writes
   * world positions straight onto its model's root and the room's root stands
   * at (−600, −600). In the scene beside {@link roomRoot} (World adds it),
   * shown and hidden with the room ({@link showRoom}), and excluded from the
   * park's drawn reach with it (`test/procgen/parkFacts.ts`), or every seed
   * would measure three children 850 m from the park's middle.
   */
  readonly kidsRoot = new Group();
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
  /** The reading room's own four walls' colliders (the west wall's two spans either side of the den's doorway among them). */
  readonly roomWalls: readonly WallCollider[];
  /**
   * **The secret den** (#719): its floor and three walls, in the reading
   * room's frame — a child of {@link roomRoot}, so it shows and hides with the
   * room and stays out of the park's drawn reach with it. Hidden while the
   * secret shelf is shut, so nothing of the den shows over the west wall.
   */
  readonly denRoot = new Group();
  /** The den's three walls' colliders: west, north, south (`den wall (…)` in {@link solids}). */
  readonly denWalls: readonly WallCollider[];
  /** The banded collider of the lintel over the den's doorway — solid from the secret shelf's top, less the jump grace, up to the wall's own top. */
  readonly lintel: WallCollider;
  /** The west wall's two spans and the lintel, one group, so they can fade while she is in the den (plan Step 12). */
  readonly westWall: Group;
  /** Their one material, the walls' green cloned, so fading it fades no other wall. */
  readonly westMaterial: MeshToonMaterial;
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
  /** Her two story cushions (`LIBRARY_PLAYER_SEATS`), each with its drawn piece. */
  private readonly playerSeats: readonly PlayerSeat[];
  /** The cushion she is sitting on, or null when she is not. */
  private seatedOn: LibraryPlayerSeat | null = null;
  /**
   * Whoever sits on a story cushion is held by this (`Player.beginRide` takes
   * a `RideHolder`), and let go by getting up — the "Next day" button's way
   * off, and `check:exits`'. **A seat, not a ride** (Jim, 19 Oct 2026: her pets
   * ride along only on a ride): her line stays out at her heels, as at the
   * hotel's breakfast chairs and the castle's banquet.
   */
  private readonly cushionHolder: RideHolder = { holding: 'a story cushion', letGo: () => this.standUp(), companion: 'not a ride' };
  /** The children as built (`libraryResidents`): their specs go to `NpcSystem`, their drivers come back through it. */
  private readonly kids: readonly LibraryResident[];
  /** The children met again in the crowd ({@link attachNpcs}); empty until World introduces them. */
  private kidsAttached: readonly LibraryKid[] = [];

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
    const shell = buildReadingRoomShell(this.roomRoot, collision, surfaces);
    this.roomWalls = shell.walls;
    this.westWall = shell.westWall;
    this.westMaterial = shell.westMaterial;
    this.lintel = shell.lintel;
    this.props = new LibraryProps(collision, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z);
    // The den (#719) before the furniture, its walls through the same props,
    // so every one is held clear of every stand spot like any bookcase.
    this.denRoot.name = 'the-library-den';
    this.denRoot.visible = false;
    this.roomRoot.add(this.denRoot);
    this.denWalls = buildLibraryDenShell(this.denRoot, this.props, surfaces, shell.fabric).walls;
    const furnished = furnishReadingRoom(this.roomRoot, this.props);
    this.stacks = furnished.stacks;
    this.bookCount = furnished.bookCount;
    this.shelfBooks = furnished.shelfBooks;
    this.bookZones = this.shelfBooks.map((placed) => this.shelfBookZone(placed));
    this.lighting = new LibraryLighting(furnished.pools);
    this.roomRoot.add(this.lighting.group);
    // Her two story cushions (#718): seats only if cut to her hip height.
    assertCushionsAreSeats();
    this.playerSeats = LIBRARY_PLAYER_SEATS.map((id) => {
      const cushion = libraryCushion(id);
      const piece = furnished.pieces.get(id);
      if (!piece) throw new Error(`Library: ${id} was never furnished, so there is no cushion to offer her`);
      return { id, at: cushion.at, facing: libraryFacingStoryChair(cushion.at), piece };
    });
    this.props.assertClear();
    // The library's children (#718): built here, run by `NpcSystem` (World
    // hands it {@link residents}), and met again in {@link attachNpcs}.
    this.kidsRoot.name = 'the-library-children';
    this.kidsRoot.visible = false;
    this.kids = libraryResidents(this.kidsRoot);

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
    registerLibraryRoofCollision(collision, this.frame, this.plan);
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

  /**
   * Sitting on one of her story cushions (#718) — for `Game`'s "a tap anywhere
   * gets her up" and for the checks. True only while the cushion still has
   * her: a ride ended by anything else is not a seat.
   */
  get playerIsSeated(): boolean {
    return this.seatedOn !== null && (this.player?.riding ?? false);
  }

  /** Where she stands outside: the plot's doormat, the one the paths are routed to. */
  get doormat(): { readonly x: number; readonly z: number } {
    return { x: this.deps.plot.entranceX, z: this.deps.plot.entranceZ };
  }

  /** Every solid the reading room registered, with its collision handle — so a check can remove one and go red. */
  get solids(): readonly LibrarySolid[] {
    return this.props.solids;
  }

  /** Every solid top in the reading room, with its drawn footprint — so a check can land a jump on each. */
  get standables(): readonly LibraryStandable[] {
    return this.props.standables;
  }

  /** The building's name over its door (the owl's bubbles arrive with #714 part 4). */
  get screenLabels(): readonly ManagedLabel[] {
    return [this.nameLabel];
  }

  /**
   * **The library's children, as residents for `NpcSystem` to run** (#718) —
   * read once, by `World`, when it builds the crowd, which is why the Library
   * is constructed before `NpcSystem` there. Each spec hands in its own
   * `LibraryKidDriver`; see `LibraryKids.ts` and `NpcSystem`'s `ResidentSpec`.
   */
  get residents(): readonly ResidentSpec[] {
    return this.kids.map((kid) => kid.spec);
  }

  /**
   * **The children, met again in the crowd** — one {@link LibraryKid} per plan,
   * once `World` has called {@link attachNpcs}; empty before. Story time (plan
   * Step 9) summons, sits and dismisses them through these; the checks measure
   * them.
   */
  get children(): readonly LibraryKid[] {
    return this.kidsAttached;
  }

  attachPlayer(player: Player): void {
    this.player = player;
  }

  /**
   * **Introduces the crowd's bodies to the Library** (#718): of every character
   * `NpcSystem` built, the ones driven by one of this Library's own drivers are
   * its children. `World` calls this once the crowd exists — the same
   * late-binding `Entrance.attachNpcs` uses, for the same reason: the crowd
   * needs the finished collision world, and the Library is built before it.
   * Throws if a child has no body, which means `World` never handed
   * {@link residents} to `NpcSystem`.
   */
  attachNpcs(all: readonly NpcCharacter[]): void {
    this.kidsAttached = this.kids.map((kid): LibraryKid => {
      const driver = kid.driver;
      const body = driver ? all.find((candidate) => candidate.driver === driver) : undefined;
      if (!driver || !body) {
        throw new Error(`Library: ${kid.plan.name} has no body in the crowd — World must hand library.residents to NpcSystem before library.attachNpcs`);
      }
      return { plan: kid.plan, driver, body, model: kid.model };
    });
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
    this.showRoom(true);
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
   * Inside, one list (#718): a "Read it!" zone on every readable book — unless
   * she is riding (sitting, Step 7), when the room offers her nothing to walk
   * to — and a Sit zone on each of her two story cushions, always on (the one
   * she sits on offers 'Get up'). Outside, the building's entrance.
   */
  interactZones(): InteractZone[] {
    if (!this.inside) return [this.exteriorEntranceZone()];
    return [...(this.player?.riding ? [] : this.bookZones), ...this.sitZones()];
  }

  /**
   * **Up off her story cushion** (#718) — the 'Get up' chip, a jump
   * ({@link update}), or a tap anywhere (`Game.ts`'s `onTap`: Jim's nap rule,
   * *"tapping anywhere, clicking anywhere … wakes them"*). A safe no-op when
   * she is not sitting, so `Game` can call it unasked — `Hotel.wakeNap`'s
   * shape.
   *
   * `endRide` is given the cushion's own spot on the floor — the floor, never
   * the seat, as every `RideExit` is — and the put-down rule
   * (`world/dismount.ts`) does the rest, as it does for every seat in the game:
   * the cushion is a solid now (a low one she steps up onto), so its middle is
   * not clear floor at the floor's height, and the rule stands her on the
   * nearest clear floor that reaches the room, beside it. Nothing here steps
   * her off a seat by hand.
   */
  standUp(): void {
    if (this.seatedOn === null) return;
    const seat = this.playerSeats.find((candidate) => candidate.id === this.seatedOn);
    this.seatedOn = null;
    const player = this.player;
    if (!player?.riding) return;
    const at = seat?.at ?? { x: player.position.x - LIBRARY_ORIGIN_X, z: player.position.z - LIBRARY_ORIGIN_Z };
    player.endRide({ x: LIBRARY_ORIGIN_X + at.x, y: LIBRARY_FLOOR_Y, z: LIBRARY_ORIGIN_Z + at.z });
  }

  update(context: FrameContext): void {
    const { dt } = context;
    this.spaces.update(dt);
    this.updateNameLabel();
    const player = this.player;
    if (!player) return;
    if (this.seatedOn !== null) this.updateSeated(player, context);
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

  /**
   * **A Sit chip on each of her two story cushions** (#718) — always on while
   * she is inside, story or no story. The library's children take the other
   * three cushions at story time, so these two never have to refuse her.
   *
   * The breakfast chair's shape (`Hotel.ts`), down to the two details that are
   * easy to leave out and expensive to leave out:
   *
   * - **`selectableWhileRiding`.** Sitting is a ride as far as the engine
   *   cares, and a zone is not offered while riding unless it says so: without
   *   it, sitting down would eat every chip, the way back up included.
   * - **No chip that refuses.** Sitting on one cushion, the other offers
   *   nothing (a tap anywhere gets her up first); `sit` would refuse a child
   *   who is already sitting, and a chip that appears and then does nothing
   *   teaches a six-year-old that chips sometimes lie.
   *
   * The seat is the stand: she walks onto the cushion and sits where she
   * stands, so the stand spot is the cushion's own middle.
   */
  private sitZones(): InteractZone[] {
    return this.playerSeats.map((seat): InteractZone => ({
      id: `library-sit:${seat.id}`,
      label: 'a story cushion',
      x: LIBRARY_ORIGIN_X + seat.at.x,
      y: LIBRARY_FLOOR_Y + 1,
      z: LIBRARY_ORIGIN_Z + seat.at.z,
      pickRadius: SIT_PICK_RADIUS,
      standX: LIBRARY_ORIGIN_X + seat.at.x,
      standZ: LIBRARY_ORIGIN_Z + seat.at.z,
      standRadius: SIT_STAND_RADIUS,
      selectableWhileRiding: true,
      verb: 'Sit',
      highlight: highlightObject(seat.piece),
      actions: () => {
        if (this.seatedOn === seat.id) return [{ id: 'get-up', label: LIBRARY_CHIPS.getUp, run: () => this.standUp() }];
        if (this.player?.riding) return [];
        return pressAction(LIBRARY_CHIPS.sit, () => this.sit(seat.id), '🧘');
      },
    }));
  }

  /**
   * **Down onto a story cushion** (#718): the breakfast chair's shape
   * (`beginRide`, then `setRidePose`) and the castle banquet's rule for where
   * her root goes — **the floor**, never the cushion's top. The cushion is cut
   * to `KID_HIP_HEIGHT` ({@link assertCushionsAreSeats}), so with her legs
   * hanging straight down (`ridePose.ts`'s `'listening'`; the rig has no knee)
   * her feet land on the floor and her hips on the cushion. She faces the
   * storyteller's chair. The posture is set **after** `beginRide`, which
   * resets it to `'seated'`.
   */
  private sit(id: LibraryPlayerSeat): void {
    const player = this.player;
    const seat = this.playerSeats.find((candidate) => candidate.id === id);
    if (!player || !seat || !this.inside || player.riding || this.spaces.isChanging) return;
    player.beginRide(this.cushionHolder);
    player.setRidePose(LIBRARY_ORIGIN_X + seat.at.x, LIBRARY_FLOOR_Y, LIBRARY_ORIGIN_Z + seat.at.z, (seat.facing * Math.PI) / 180);
    player.ridePosture = 'listening';
    this.seatedOn = id;
  }

  /**
   * While she sits: a jump gets her up. Read here, not in `Player`, because
   * `Player.update` returns early for the whole time she rides and never
   * reaches its own jump (`Hotel.update`'s nap, the same reason). And a ride
   * that something else ended leaves no seat behind it — or every later tap
   * would try to stand up a child who is already standing.
   */
  private updateSeated(player: Player, context: FrameContext): void {
    if (!player.riding) {
      this.seatedOn = null;
      return;
    }
    if (context.input.justPressed('jump')) this.standUp();
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
    // Every road in refuses a sitting child, so this is a belt: nobody is put
    // somewhere new still sitting on a cushion she has left.
    this.standUp();
    this.inside = true;
    this.showRoom(true);
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
    this.showRoom(false);
  }

  /** Out on the doormat, facing `facing` (radians): away from the door on leaving, at it for the door link. */
  private standOutside(facing: number): void {
    const player = this.player;
    if (!player) return;
    this.standUp();
    this.inside = false;
    this.showRoom(false);
    this.collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
    const mat = this.doormat;
    player.teleportTo(mat.x, this.surfaces.sample(mat.x, mat.z, terrainHeight(mat.x, mat.z) + 3), mat.z, facing);
  }

  private boundToRoom(): void {
    this.collision.setPlayBounds(circleBoundary(LIBRARY_PLAY_RADIUS, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z));
  }

  /**
   * **The reading room and its children appear and vanish together.** The
   * children's models hang under {@link kidsRoot}, not {@link roomRoot} (its
   * transform is not the identity), so whoever shows or hides the room goes
   * through here — the one place both are written.
   */
  private showRoom(visible: boolean): void {
    this.roomRoot.visible = visible;
    this.kidsRoot.visible = visible;
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
 * **The story cushions are seats, or the build stops** (#718). A sitter's
 * root is on the floor and her legs hang straight down — the rig has no knee
 * (`ridePose.ts`'s `'listening'`) — so her hips land on the cushion only if
 * its top is `KID_HIP_HEIGHT`. A taller cushion buries her hips in it, a
 * lower one leaves her sitting on air, and both look fine until she sits.
 * `library.glb`'s cushion is cut to it today; this is what keeps it cut.
 */
function assertCushionsAreSeats(): void {
  const top = libraryCushionSize().top;
  if (Math.abs(top - KID_HIP_HEIGHT) > CUSHION_SEAT_TOLERANCE) {
    throw new Error(
      `Library: the story cushion's top is ${top.toFixed(3)} m, but a seat must be KID_HIP_HEIGHT (${KID_HIP_HEIGHT} m) to within ${CUSHION_SEAT_TOLERANCE} m, ` +
        `or a listener's hips sit ${(Math.abs(top - KID_HIP_HEIGHT) * 1000).toFixed(0)} mm ${top > KID_HIP_HEIGHT ? 'inside' : 'above'} it: ` +
        `cut library.glb's cushion-body (or createLibraryCushion) to KID_HIP_HEIGHT`,
    );
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
