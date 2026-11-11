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
import { BUILDING_STEP_UP, NPC_RADIUS, PARADE_MEMBER_RADIUS, PLAYER_RADIUS } from '../../core/constants';
import { PALETTE } from '../../core/palette';
import type { ManagedLabel } from '../../ui/LabelManager';
import { NameLabel } from '../../ui/NameLabel';
import { SpeechBubble } from '../../ui/SpeechBubble';
import { lineSeconds } from '../../ui/speechTiming';
import { ANCHORS_BY_ID } from '../anchors';
import { createLibraryExterior, createLibrarySkirt, dressedReach, libraryCushionSize, type LibraryExterior } from '../../art/models/libraryAssets';
import { KID_HIP_HEIGHT } from '../../art/models/kid';
import { KID_HEIGHT } from '../../art/models/kidHeight';
import { kitBounds } from '../../art/models/libraryKit';
import { LibraryLighting } from './lighting';
import { LibraryProps, type LibrarySolid, type LibraryStandable } from './props';
import { furnishReadingRoom, StackFader, type FurnishedShelfBook } from './furnish';
import { LIBRARY_CHIPS } from './libraryLines';
import { shelfBookZoneId } from './shelfBooks';
import { LibraryOwl, OWL_ZONE_ID, type OwlBystander } from './LibraryOwl';
import { hasLibraryCard } from './libraryCard';
import { gameStore } from '../../state';
import { libraryResidents, type LibraryResident } from './LibraryKids';
import { StoryTime, type StoryListenerView, type StoryPhase } from './storyTime';
import type { LibraryKidDriver } from './libraryKidDriver';
import { SecretLeaf } from './secretShelf';
import { DRAGON_STAND_RADIUS, DRAGON_ZONE_ID, LibraryDen } from './LibraryDen';
import { CAT_ZONE_ID, LibraryCat } from './LibraryCat';
import {
  buildLibraryDenShell,
  buildReadingRoomShell,
  type LibraryDenShell,
  libraryDenDoorway,
  libraryEntryBand,
  libraryExitBand,
  LibraryFrame,
  LIBRARY_SECRET_BOOK_ZONE,
  registerLibraryRoofCollision,
  registerLibraryShellCollision,
  registerLibrarySteps,
  type LibraryShellSolids,
} from './shell';
import {
  libraryDenContains,
  LIBRARY_ARRIVAL,
  LIBRARY_BOUNDING_RADIUS,
  LIBRARY_CAT_PILE,
  LIBRARY_CAT_STAND,
  LIBRARY_DEN_DOORWAY_STAND,
  LIBRARY_DESK_STAND,
  LIBRARY_DRAGON_NEST,
  LIBRARY_DRAGON_STAND,
  LIBRARY_EXTERIOR_PLAN,
  LIBRARY_FLOOR_Y,
  LIBRARY_HALF_X,
  LIBRARY_HALF_Z,
  LIBRARY_LIBRARIAN_SPOT,
  LIBRARY_ORIGIN_X,
  LIBRARY_ORIGIN_Z,
  LIBRARY_PLAY_RADIUS,
  LIBRARY_PLAYER_SEATS,
  LIBRARY_SECRET_STAND,
  LIBRARY_WALL_HALF,
  LIBRARY_WALL_HEIGHT,
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
 * gaps until their chapter books land), her two story cushions offer a seat,
 * and the owl librarian stands behind her desk at `LIBRARY_LIBRARIAN_SPOT`
 * ({@link owl}, `LibraryOwl.ts`: solid, alive, the card, the recommendation,
 * the shush), and story time (#718, `storyTime.ts`) gathers her and the
 * children on the cushions while the owl reads. Every one of their stand
 * spots is a keep-out.
 *
 * ## The library cat (#719)
 *
 * By the desk, in its lamp's pool, a ginger cat sleeps on a pile of five fat
 * books ({@link cat}, `LibraryCat.ts`). **Pet the cat!** from in front of her
 * and she lifts her head, twitches her ears, smiles, sends up hearts and
 * purrs.
 *
 * ## The secret den (#719)
 *
 * A walled pocket of the reading room behind its west wall — no space of its
 * own (plan Decision 20). The west wall has a doorway the secret shelf's
 * width, a lintel over it from the shelf's top to the wall's, and beyond it
 * the den the 3D Artist modelled (`libraryDen.glb`): its floor, three walls
 * lined with book niches, stars, a moon and two glowing lanterns
 * ({@link denRoot}, `shell.ts`'s `buildLibraryDenShell`, which holds the drawn
 * den to the layout as it loads and makes it solid). The shelf is {@link secretShelf}, a leaf on a
 * hinge (`secretShelf.ts`): shut, it fills the doorway and the den is the one
 * sealed pocket the room has, hidden; **Pull the book!** on the gold book
 * swings it slowly away into the den, and it lies open along the den's south
 * wall until she leaves the library. Found in the den with it shut — a jet
 * pack over the wall, a hand-typed link — a guard opens it at once (plan
 * Decision 24): never sealed in, never swept through. `layout.ts`'s
 * `libraryDenContains` is the one owner of "she is in the den"; the west wall
 * and the open leaf fade while she is there.
 *
 * In the den's far corner a mint baby dragon sits on a nest of books
 * ({@link den}, `LibraryDen.ts`): it breathes, blinks, flicks its tail, turns
 * its head to watch her and puffs a warm glow. Meeting it gives her the
 * **Dragon friend** card; **Say hi!** makes it puff again.
 *
 * The cat's purr and the dragon's words share one bubble,
 * {@link creatureBubble} — the answer to the chip just pressed, so it is
 * `actionFeedback` for that chip's zone.
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
 * How close (XZ metres) a tap must land to the owl to count as her (#718):
 * her own plan reach is about 0.65 m, and a finger aiming at a round owl
 * lands on her rather than beside her. `check:tap-spacing` measures how near
 * any other pick comes.
 */
const OWL_PICK_RADIUS = 1.2;

/**
 * A story cushion's Sit zone (#718): a tap within this of the cushion's
 * middle lands on it (the drawn cushion is 0.45 m round), and standing within
 * {@link SIT_STAND_RADIUS} of it — on it, or a stride off it — offers the chip.
 */
const SIT_PICK_RADIUS = 0.8;
const SIT_STAND_RADIUS = 1.6;

/**
 * The secret shelf's Pull zone (#719): standing within this of its stand, in
 * front of the case, offers **Pull the book!** — a stride either way along the
 * wall, so a child who stops short of the exact spot is still offered it.
 */
const PULL_STAND_RADIUS = 2;

/** The library cat's zone (#719, its id `LibraryCat.ts`'s): its pick (the curled cat is 0.6 m across) and its reach from her stand. */
const CAT_PICK_RADIUS = 0.8;
const CAT_STAND_RADIUS = 1.6;

/** The baby dragon's zone (#719, its id and its reach `LibraryDen.ts`'s): its pick (the dragon on its nest is a metre and more across). */
const DRAGON_PICK_RADIUS = 1.0;

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
   * **The secret den** (#719): the Artist's den — its floor, three walls
   * lined with book niches, stars, a moon and two lanterns — in the reading
   * room's frame, a child of {@link roomRoot}, so it shows and hides with the
   * room and stays out of the park's drawn reach with it. Hidden while the
   * secret shelf is shut, so nothing of the den shows over the west wall.
   */
  readonly denRoot = new Group();
  /** What `buildLibraryDenShell` built: the drawn den, its niche books and lanterns, and its bodies. */
  readonly denShell: LibraryDenShell;
  /** The den's three walls' colliders: west, north, south (`den wall (…)` in {@link solids}). */
  readonly denWalls: readonly WallCollider[];
  /** The banded collider of the lintel over the den's doorway — solid from the secret shelf's top, less the jump grace, up to the wall's own top. */
  readonly lintel: WallCollider;
  /** The west wall's two spans and the den's lintel (the Artist's, hung here), one group, so they fade together while she is in the den. */
  readonly westWall: Group;
  /** Their one material, the walls' green cloned, so fading it fades no other wall. */
  readonly westMaterial: MeshToonMaterial;
  /** Every free-standing stack and its fade. */
  readonly stacks: readonly StackFader[];
  /**
   * **The secret shelf** (#719): the leaf on its hinge, its gold pull book,
   * and its two collider states — shut (`bookcase west-2`) and open (along
   * the den's south wall). Built after the furniture and before the keep-out
   * assertion, so both footprints are held clear of every stand spot.
   */
  readonly secretShelf: SecretLeaf;
  /**
   * The west wall's fade: its two spans and the lintel, through their one
   * material, translucent while she is in the den — driven by where she is,
   * never by a sightline, because from the den the wall is always between
   * her and the camera.
   */
  private readonly westWallFader: StackFader;
  /** Every sightline fade: the stacks, and the open leaf (whose fader is built on its open footprint). */
  private readonly faders: readonly StackFader[];
  /** The one Pull zone, built once: the gold book's shut position never moves. */
  private readonly pullZone: InteractZone;
  /**
   * **The baby dragon on its nest of books** (#719, plan Step 13), in the den's
   * far corner: two bodies in their own shapes, its life, its puff, the
   * meeting and **Say hi!** — `LibraryDen.ts`. Built after the leaf and before
   * the keep-out assertion, so both its solids are held clear of every stand
   * spot.
   */
  readonly den: LibraryDen;
  /** **The library cat asleep on her pile of books** by the desk (#719, plan Step 13) — `LibraryCat.ts`. */
  readonly cat: LibraryCat;
  /**
   * **What the creatures say** — the dragon's hello and its answers, the
   * cat's purr — one bubble, in the reading room's frame. `actionFeedback`
   * whose item is the zone just answered (`library-dragon`, `library-cat`),
   * so it outranks that zone's own chip while it is up.
   */
  // Drawn over the scenery (LABELS.md, "Drawn over the scenery"): the dragon
  // talks from the den's corner behind the faded west wall and the lintel,
  // and depth-tested its bubble was cut by them — its ends sliced off at
  // 390x844, and half of it hidden by the wall once she stepped back out
  // (headless Chrome on the PR preview, 11 Nov 2026).
  readonly creatureBubble = new SpeechBubble({ id: 'library-creature-says', item: '', kind: 'actionFeedback' }, PALETTE.markerLemon, { overScenery: true });
  /** How long the creature's line stays up (`lineSeconds`, the one rule every speaker holds a line by). */
  private creatureLineFor = 0;
  /** The last line the creature bubble was asked to say — kept after the bubble goes, for the checks. */
  private lastCreatureSaid: string | null = null;
  /** The two creature zones, built once: neither creature walks. */
  private readonly catZone: InteractZone;
  private readonly dragonZone: InteractZone;
  /** How many decorative books the shelves hold. */
  readonly bookCount: number;
  /**
   * **The readable books on their shelves** (#718), one per `BOOKS` entry, in
   * `SHELF_BOOKS`' order: each one's book, slot, mesh, own paint and room-local
   * spot — for their zones, the checks, and the recommendation's glow (Step 6).
   */
  readonly shelfBooks: readonly FurnishedShelfBook[];
  /**
   * **The owl librarian** (#718, plan Step 6), behind her desk: solid, alive,
   * the library card, the recommendation, the shush — `LibraryOwl.ts`. Built
   * after the furniture (her glow lights the shelf books) and before
   * `props.assertClear()`, so her solid is held to every keep-out like a
   * bookcase's.
   */
  readonly owl: LibraryOwl;
  /** The room's light rig — for the checks (no black light, the darkest floor). */
  readonly lighting: LibraryLighting;
  /** How far the building is moved along its up from the ground at its centre (`libraryBaseSink`). */
  readonly baseSink: number;
  /** Her two story cushions (`LIBRARY_PLAYER_SEATS`), each with its drawn piece. */
  private readonly playerSeats: readonly PlayerSeat[];
  /** Every furnished piece as drawn, by its `LIBRARY_FURNITURE` / `LIBRARY_BOOKCASES` id (`furnishReadingRoom`'s own map). */
  private readonly pieces: ReadonlyMap<string, Object3D>;
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
  /** Her line of pets out of the backpack ({@link attachParade}) — the owl keeps clear of them as she does of her. */
  private parade: { standing(): Iterable<Readonly<Vector3>> } | null = null;
  /** The one record {@link owlBystanders} writes and hands out, again and again: the owl reads each at once. */
  private readonly bystander: OwlBystander = { what: '', x: 0, y: 0, z: 0, radius: 0, height: 0 };
  private inside = false;
  private readonly from = new Vector3();
  private readonly cameraLocal = new Vector3();
  /** One "Read it!" zone per readable book, built once: the books never move. */
  private readonly bookZones: readonly InteractZone[];
  /** The owl's Talk zone, built once: offered only while she is at her desk (`Selection` caches her box there). */
  private readonly owlZone: InteractZone;
  /**
   * **Story time** (#718, plan Step 9, `storyTime.ts`): the clock, the owl's
   * flight to the story chair, the children's gathering, the reading, the
   * dispersal. Stepped first in {@link update}.
   */
  readonly storyTime: StoryTime;
  /** What story time asks about her, kept here and written in place — no allocation a frame. */
  private readonly listenerView = { seated: false, feet: { x: 0, y: 0, z: 0 } };
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
    this.props = new LibraryProps(collision, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z);
    // The den (#719) before the furniture, drawn from the Artist's kit, its
    // walls through the same props, so every one is held clear of every stand
    // spot like any bookcase; its lintel hung in the west wall.
    this.denRoot.name = 'the-library-den';
    this.denRoot.visible = false;
    this.roomRoot.add(this.denRoot);
    this.denShell = buildLibraryDenShell(this.denRoot, this.props, collision, surfaces, shell);
    this.denWalls = this.denShell.walls;
    this.lintel = this.denShell.lintel;
    const furnished = furnishReadingRoom(this.roomRoot, this.props);
    this.pieces = furnished.pieces;
    this.stacks = furnished.stacks;
    this.bookCount = furnished.bookCount;
    this.shelfBooks = furnished.shelfBooks;
    // The owl (#718): after the furniture, whose shelf books her glow lights,
    // and before `assertClear`, so her solid is checked against every keep-out.
    this.owl = new LibraryOwl(this.roomRoot, this.props, collision, this.shelfBooks, controls, () => this.owlBystanders());
    this.owlZone = this.buildOwlZone();
    this.bookZones = this.shelfBooks.map((placed) => this.shelfBookZone(placed));
    // The secret shelf (#719): the leaf on its hinge, with the row the
    // furnisher drew for it; both of its collider states go through the props.
    this.secretShelf = new SecretLeaf(this.props, this.roomRoot, furnished.secret.books);
    this.faders = [...this.stacks, this.secretShelf.fader];
    this.westWallFader = new StackFader(
      'west-wall',
      this.westWall,
      { x: -LIBRARY_HALF_X, z: 0 },
      90,
      { length: 2 * LIBRARY_HALF_Z, depth: 2 * LIBRARY_WALL_HALF, height: LIBRARY_WALL_HEIGHT },
      [this.westMaterial],
    );
    this.pullZone = this.secretBookZone();
    // The creatures (#719, plan Step 13): the dragon on its nest in the den,
    // the cat on her pile by the desk — every solid of theirs through the
    // props, before the keep-out assertion below.
    this.den = new LibraryDen(this.denRoot, this.props, (line) => this.sayCreature(DRAGON_ZONE_ID, line, this.den.bubbleAt));
    this.cat = new LibraryCat(this.roomRoot, this.props, (line) => this.sayCreature(CAT_ZONE_ID, line, this.cat.bubbleAt));
    this.roomRoot.add(this.creatureBubble.sprite);
    this.catZone = this.buildCatZone();
    this.dragonZone = this.buildDragonZone();
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
    // Each child plans her way round a player standing still in her way against the real world.
    this.kids = libraryResidents(this.kidsRoot, (x, z, radius) => collision.isClearCircle(x, z, radius));
    this.storyTime = new StoryTime(this.owl, () => this.kidsAttached, () => this.listener());

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

  /** Where story time is: `'idle'`, `'gathering'`, `'reading'` or `'dispersing'`. */
  get storyPhase(): StoryPhase {
    return this.storyTime.phase;
  }

  /**
   * **A story, now** — the `/library?story=now` link (`Game.enterLibrarySpawn`):
   * begun on the first frame she is inside and the owl is free.
   */
  requestStoryTime(): void {
    this.storyTime.requestStoryTime();
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

  /**
   * Every solid top in the reading room **that is in the world right now**,
   * with its drawn footprint — so a check can land a jump on each. The secret
   * shelf registers two tops and only ever has one of them in the world
   * (`LibraryProps.isPresent`); the other is not somewhere to land.
   */
  get standables(): readonly LibraryStandable[] {
    return this.props.standables.filter((standable) => this.props.isPresent(standable.handle));
  }

  /**
   * The drawn piece of the furniture `id` names (`LIBRARY_FURNITURE`'s ids:
   * `'story-chair'`, `'cushion-4'`…), or undefined — what story time's camera
   * (`storyCamera.ts`) is told its listeners and their reader sit on.
   */
  furniture(id: string): Object3D | undefined {
    return this.pieces.get(id);
  }

  /** The building's name over its door, the owl's speech bubble (#718), and the creatures' (#719). */
  get screenLabels(): readonly ManagedLabel[] {
    return [this.nameLabel, this.owl.bubble, this.creatureBubble];
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

  /** The secret shelf has landed open: the den's doorway is clear (#719). */
  get denOpen(): boolean {
    return this.secretShelf.open;
  }

  /** The secret shelf's turn from shut, radians: 0 shut, π/2 open, in between mid-swing. */
  get secretShelfAngle(): number {
    return this.secretShelf.angle;
  }

  /** The last line the dragon or the cat was given to say (#719) — kept after the bubble goes, for the checks, which cannot read a sprite. */
  get lastCreatureLine(): string | null {
    return this.lastCreatureSaid;
  }

  attachPlayer(player: Player): void {
    this.player = player;
  }

  /**
   * **Her line of pets, for the owl to keep clear of** — given by
   * `World.attachParade`, the one place her parade is introduced to the park,
   * as the train is given it. Each pet standing out of the backpack is somebody
   * the owl never flies into or comes down on.
   */
  attachParade(parade: { standing(): Iterable<Readonly<Vector3>> }): void {
    this.parade = parade;
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
    this.owl.enter();
    // The leaf as she was left: open if the save put her in the den, shut otherwise.
    this.setLeafFor(player.position.x - LIBRARY_ORIGIN_X, player.position.z - LIBRARY_ORIGIN_Z);
  }

  // --------------------------------------------------------------- doors

  /**
   * `/library`, and `/library?at=x,z&facing=deg` (`main.ts`'s `library`
   * `DeepLink`, through `Game.enterLibrarySpawn`): into the reading room —
   * **from anywhere, the room included** (a save written inside restores her
   * there before a link runs; the Reptile House's lesson). `at` is room-local
   * metres; without it, just inside the door, facing up the central aisle.
   *
   * With `sit` (`/library?sit=1`): she arrives sitting on that story cushion,
   * facing the storyteller's chair — stood on it and sat down behind the iris,
   * the Sit chip's own way down ({@link seatOn}), so the room opens on her
   * listening. `at` is then the cushion's own spot.
   */
  requestEnter(at?: { readonly x: number; readonly z: number; readonly facing?: number }, sit?: LibraryPlayerSeat): boolean {
    const player = this.player;
    if (!player || player.riding || this.spaces.isChanging) return false;
    const seat = sit === undefined ? undefined : this.playerSeats.find((candidate) => candidate.id === sit);
    const spot = seat ? { x: seat.at.x, z: seat.at.z, facing: seat.facing } : at;
    this.spaces.changeTo(() => {
      this.enterRoom(spot);
      if (seat) this.seatOn(player, seat);
    });
    return true;
  }

  /** `/library-door`: outside, on the doormat at the foot of the steps, facing the door. */
  requestEnterDoor(): boolean {
    const player = this.player;
    if (!player || player.riding || this.spaces.isChanging) return false;
    this.spaces.changeTo(() => this.standOutside(this.frame.yaw + Math.PI));
    return true;
  }

  /**
   * `/library-den` (its deep link, plan Step 14): into the reading room, just
   * inside the secret den's doorway, looking in — the leaf open, because she is
   * in the den. A road for a developer's link, not a child's: a child finds the
   * den by pulling the book.
   */
  requestEnterDen(): boolean {
    return this.requestEnter(LIBRARY_DEN_DOORWAY_STAND);
  }

  /**
   * The front door's band, the room's exit, and the secret den's doorway (which
   * fires nothing: it tells `check:tap-spacing` no other chip may sit in the
   * doorway), for the checks and the invariants. Consumers that take index 0
   * or 1 are unaffected by the third (plan Decision 36).
   */
  doorBands(): PortalBand[] {
    return [libraryEntryBand(this.frame, this.plan), libraryExitBand(), libraryDenDoorway()];
  }

  /**
   * Inside, one list (#718, #719): the owl's Talk zone while she is at her
   * desk, a "Read it!" zone on every readable book,
   * the Pull zone on the secret shelf's gold book, the cat's Pet zone, and —
   * only once the shelf has landed open — the baby dragon's Say hi zone;
   * none of those while she is riding (sitting, Step 7), when the room offers
   * her nothing to walk to. And a Sit zone on each of her two story cushions,
   * always on (the one she sits on offers 'Get up'). Outside, the building's
   * entrance.
   */
  interactZones(): InteractZone[] {
    if (!this.inside) return [this.exteriorEntranceZone()];
    const zones: InteractZone[] = [];
    if (!this.player?.riding) {
      if (this.owl.atDesk) zones.push(this.owlZone);
      zones.push(...this.bookZones, this.pullZone, this.catZone);
      if (this.secretShelf.open) zones.push(this.dragonZone);
    }
    zones.push(...this.sitZones());
    return zones;
  }

  /**
   * **Pull the book!** — the gold book on the secret shelf slides out with a
   * creak and the whole case swings away into the den (`SecretLeaf.pull`).
   * Only from inside, on her feet; false when nothing started (already open, or
   * mid-swing).
   */
  pullSecretBook(): boolean {
    if (!this.inside || this.player?.riding || this.spaces.isChanging) return false;
    return this.secretShelf.pull();
  }

  /**
   * **The leaf open, now, silently** — for the checks and the label scenes that
   * want the den without the pull (`check:labels`'s dragon visit, plan Step
   * 13), and the guard's road. The den shows from this frame.
   */
  openDenInstantly(): void {
    this.secretShelf.openInstantly();
    this.syncDen(this.player);
  }

  /**
   * **Up off her story cushion** (#718) — the 'Get up' chip, a jump
   * ({@link update}), or a tap anywhere (`Game.ts`'s `onTap`: Jim's nap rule,
   * *"tapping anywhere, clicking anywhere … wakes them"*). A safe no-op when
   * she is not sitting, so `Game` can call it unasked — `Hotel.wakeNap`'s
   * shape.
   *
   * **Up where she sat, on the cushion's top** — where her feet were before
   * she sat: she walks up onto the cushion to sit down (a low solid within a
   * step, PR #722), so getting up stands her back on it, and she walks off
   * its edge, one step down. The hotel nap's way off a mattress
   * (`Hotel.wakeNap`), not the breakfast chair's: a chair's seat is inside the
   * chair and within her table's reach, while a cushion is a soft solid open
   * on every side, and **its top is where she stands on it**. `endRide` is
   * given that top — the surface her feet find there, which the put-down rule
   * (`world/dismount.ts`, clause 2: "a solid's top is such a surface, as it is
   * under her feet") accepts as it stands and hands back unchanged; were it
   * ever not clear or not connected, the same rule would move her, as it does
   * for every seat. At story time this keeps her where she listened, between
   * the children on their cushions, rather than popping her a stride sideways
   * into them. Nothing here steps her off a seat by hand.
   */
  standUp(): void {
    if (this.seatedOn === null) return;
    const seat = this.playerSeats.find((candidate) => candidate.id === this.seatedOn);
    this.seatedOn = null;
    const player = this.player;
    if (!player?.riding) return;
    const at = seat?.at ?? { x: player.position.x - LIBRARY_ORIGIN_X, z: player.position.z - LIBRARY_ORIGIN_Z };
    const top = seat ? libraryCushionSize().top : 0;
    player.endRide({ x: LIBRARY_ORIGIN_X + at.x, y: LIBRARY_FLOOR_Y + top, z: LIBRARY_ORIGIN_Z + at.z });
  }

  update(context: FrameContext): void {
    const { dt } = context;
    this.spaces.update(dt);
    this.updateNameLabel();
    const player = this.player;
    if (!player) return;
    // The plan's order: story → owl → glow → seated jump. Story time first, so
    // a story begun this frame flies this frame; then the owl (her words, her
    // shush, her life and the recommended book's glow), then the seat.
    this.storyTime.update(dt, this.inside);
    // In the den the owl cannot see her, so no "Shhh!" there (plan item 8);
    // story time goes on regardless — its clock counts in the room or the den.
    if (this.inside) this.owl.update(dt, context.elapsed, player, this.spaces.isChanging, this.deps.camera, this.playerInDen(player));
    if (this.seatedOn !== null) this.updateSeated(player, context);
    if (this.inside) {
      this.updateSecretLeaf(player, dt, context.elapsed);
      this.updateCreatures(player, dt, context.elapsed);
      this.fadeStacks(player, dt);
    }
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
    this.seatOn(player, seat);
  }

  /**
   * The sitting itself, {@link sit}'s and the `sit` link's ({@link
   * requestEnter}, behind the iris, where `sit`'s guard against a change of
   * space would refuse it): the ride, the pose on the floor at the cushion,
   * facing the chair, and the posture after `beginRide` has reset it.
   */
  private seatOn(player: Player, seat: PlayerSeat): void {
    player.beginRide(this.cushionHolder);
    player.setRidePose(LIBRARY_ORIGIN_X + seat.at.x, LIBRARY_FLOOR_Y, LIBRARY_ORIGIN_Z + seat.at.z, (seat.facing * Math.PI) / 180);
    player.ridePosture = 'listening';
    this.seatedOn = seat.id;
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

  /**
   * **The secret shelf, every frame inside** (#719): its own clock (the
   * twinkle, the slide, the swing), then **the guard** (plan Decision 24) — if
   * she is in the den with the leaf shut and not swinging, it opens at once,
   * silently: a jet pack over the west wall or a hand-typed `/library?at=`
   * into the den must never leave her sealed in, and the leaf is never swung
   * through her. Then the den's visibility and the west wall's fade, both
   * asked of `libraryDenContains`, the one owner of "she is in the den".
   */
  private updateSecretLeaf(player: Player, dt: number, elapsed: number): void {
    const leaf = this.secretShelf;
    leaf.update(dt, elapsed);
    const inDen = this.playerInDen(player);
    if (inDen && !leaf.open && !leaf.swinging) {
      leaf.openInstantly();
      console.warn('Library: she was in the secret den with the shelf shut — the guard opened it (nobody is ever sealed in)');
    }
    this.syncDen(player);
    this.westWallFader.fadeTowards(inDen ? STACK_FADED_ALPHA : 1, dt);
  }

  /**
   * **The creatures, every frame inside** (#719), after the leaf and its guard
   * (so a child just found in the den meets the dragon in the same frame the
   * guard opens it): the cat always; the dragon while the den is drawn — no
   * one sees it otherwise, and it only ever meets her in there with the shelf
   * open. Then their one bubble's hold.
   */
  /** Her feet, room-local — one record rewritten every frame, for the dragon. */
  private readonly herInRoom = { x: 0, z: 0 };

  private updateCreatures(player: Player, dt: number, elapsed: number): void {
    this.cat.update(dt, elapsed);
    if (this.denRoot.visible) {
      const her = this.herInRoom;
      her.x = player.position.x - LIBRARY_ORIGIN_X;
      her.z = player.position.z - LIBRARY_ORIGIN_Z;
      this.den.update(dt, elapsed, her, this.playerInDen(player), this.secretShelf.open);
    }
    if (this.creatureLineFor > 0) {
      this.creatureLineFor -= dt;
      if (this.creatureLineFor <= 0) this.creatureBubble.setText(null);
      else this.creatureBubble.updateScreenSize(this.deps.camera);
    }
  }

  /**
   * **A creature says a line** — the Reptile House's `say` shape: the bubble
   * names the zone it answers (its `item`), hangs over the speaker (`at`,
   * room-local), and holds `lineSeconds` long, the one rule the hotel's and
   * the owl's lines are held by.
   */
  private sayCreature(item: string, text: string, at: { readonly x: number; readonly y: number; readonly z: number }): void {
    this.lastCreatureSaid = text;
    this.owl.giveWayToAPress();
    this.creatureBubble.identity.item = item;
    this.creatureBubble.anchorAt(at.x, at.y, at.z);
    this.creatureBubble.setText(text);
    this.creatureLineFor = lineSeconds(text);
  }

  /** Leaving the library: whatever a creature was saying stops, the cat settles, and the dragon will say hello on the next visit. */
  private leaveCreatures(): void {
    this.creatureBubble.setText(null);
    this.creatureLineFor = 0;
    this.den.leave();
    this.cat.leave();
  }

  /** Is she in the secret den? `libraryDenContains`, asked of her room-local feet. */
  private playerInDen(player: Player): boolean {
    return libraryDenContains(player.position.x - LIBRARY_ORIGIN_X, player.position.z - LIBRARY_ORIGIN_Z);
  }

  /**
   * **The den shows only when there is a way to see it** (plan Decision 25):
   * while the leaf has moved off shut, or she is in there. Shut, the dragon's
   * horns and the den's walls would otherwise stand over the 5.2 m west wall
   * for the camera to see, and give the secret away.
   */
  private syncDen(player: Player | null): void {
    this.denRoot.visible = this.secretShelf.angle > 0 || (player !== null && this.playerInDen(player));
  }

  /** The leaf for a spot she is being put at: open if the spot is in the den, shut otherwise. */
  private setLeafFor(localX: number, localZ: number): void {
    if (libraryDenContains(localX, localZ)) this.secretShelf.openInstantly();
    else this.secretShelf.closeInstantly();
    this.syncDen(this.player);
  }

  /** A stack (or the open leaf) between the camera and her eases translucent; one that is not, back to solid. */
  private fadeStacks(player: Player, dt: number): void {
    const camera = this.deps.camera.camera.position;
    this.cameraLocal.set(camera.x - LIBRARY_ORIGIN_X, camera.y - LIBRARY_FLOOR_Y, camera.z - LIBRARY_ORIGIN_Z);
    const localX = player.position.x - LIBRARY_ORIGIN_X;
    const localZ = player.position.z - LIBRARY_ORIGIN_Z;
    const feet = player.position.y - LIBRARY_FLOOR_Y; // flat-ok: height above the reading room's own flat floor, in its own space off the sphere
    for (const stack of this.faders) {
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
    // Coming in from the park (or a link): a visit. Already inside — a link
    // typed from the room, or the fall rescue below — it is not, and the owl
    // does not greet her twice.
    const arriving = !this.inside;
    this.inside = true;
    this.showRoom(true);
    this.boundToRoom();
    const spot: LocalPoint = at ?? LIBRARY_ARRIVAL;
    const facing = ((at?.facing ?? LIBRARY_ARRIVAL.facing) * Math.PI) / 180;
    player.teleportTo(LIBRARY_ORIGIN_X + spot.x, LIBRARY_FLOOR_Y, LIBRARY_ORIGIN_Z + spot.z, facing);
    // The leaf is open exactly when she is put down in the den (a link, a
    // restore); from the door it is shut, so the trick is there to find.
    this.setLeafFor(spot.x, spot.z);
    // A fresh visit starts with every stack, the leaf and the west wall solid.
    for (const fader of this.faders) fader.setAlpha(1);
    this.westWallFader.setAlpha(1);
    if (arriving) this.owl.enter();
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
    this.storyTime.abort();
    this.owl.leave();
    // Every visit starts shut (a restore into the den opens it again).
    this.secretShelf.closeInstantly();
    this.syncDen(null);
    this.leaveCreatures();
  }

  /** Out on the doormat, facing `facing` (radians): away from the door on leaving, at it for the door link. */
  private standOutside(facing: number): void {
    const player = this.player;
    if (!player) return;
    this.standUp();
    this.inside = false;
    this.showRoom(false);
    this.storyTime.abort();
    this.owl.leave();
    // Every visit from the park starts with the leaf shut, so the trick is there to find again.
    this.secretShelf.closeInstantly();
    this.syncDen(null);
    this.leaveCreatures();
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
   * **Everybody the owl must never fly into or come down on** (`LibraryOwl`'s
   * `wouldTouch`): the child — her collision radius and her height — every pet
   * of hers standing out of the backpack, and the library's three children.
   * Each as an upright cylinder from where its feet are; a pet as tall as the
   * child (shorter in fact, so the owl only ever waits a little higher over
   * one). One record, rewritten for each and read at once.
   */
  private *owlBystanders(): Generator<Readonly<OwlBystander>> {
    const one = this.bystander;
    const player = this.player;
    if (player) {
      one.what = 'the child';
      one.x = player.position.x;
      one.y = player.position.y;
      one.z = player.position.z;
      one.radius = PLAYER_RADIUS;
      one.height = KID_HEIGHT;
      yield one;
    }
    for (const kid of this.kidsAttached) {
      one.what = kid.plan.name;
      one.x = kid.body.position.x;
      one.y = kid.body.position.y;
      one.z = kid.body.position.z;
      one.radius = NPC_RADIUS;
      one.height = KID_HEIGHT;
      yield one;
    }
    if (!this.parade) return;
    for (const at of this.parade.standing()) {
      one.what = 'a pet';
      one.x = at.x;
      one.y = at.y;
      one.z = at.z;
      one.radius = PARADE_MEMBER_RADIUS;
      one.height = KID_HEIGHT;
      yield one;
    }
  }

  /** Story time's view of her: on one of her cushions, and where her feet are, room-local. */
  private listener(): StoryListenerView {
    const view = this.listenerView;
    view.seated = this.playerIsSeated;
    const at = this.player?.position;
    if (at) {
      view.feet.x = at.x - LIBRARY_ORIGIN_X;
      view.feet.y = at.y - LIBRARY_FLOOR_Y; // flat-ok: her height above the reading room's own flat floor, in its own space off the sphere
      view.feet.z = at.z - LIBRARY_ORIGIN_Z;
    }
    return view;
  }

  /**
   * **A readable book's zone** (#718): on the book itself, a metre over the
   * floor (where a tap on a book on a low shelf lands); stood at its slot's
   * stand, in front of the case, facing it; the rainbow round the book's own
   * mesh; and one chip, "Read it!", which opens that book through the attached
   * opener — the paper book over the paused park. The book the owl is
   * recommending — the one glowing on its shelf — says "Read me!" instead.
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
          this.owl.recommendedBookId === book.id ? LIBRARY_CHIPS.readGlowing : LIBRARY_CHIPS.read,
          () => {
            this.bookOpener?.open(book.id);
          },
          '📖',
        ),
    };
  }

  /**
   * **The owl's Talk zone** (#718): on the owl, a metre over the floor, picked
   * within {@link OWL_PICK_RADIUS}; stood at the desk's front
   * (`LIBRARY_DESK_STAND`), facing her across the desk; the rainbow round the
   * owl herself. One chip: "Get a library card!" until she has one, then "Say
   * hello!" — both the one press, `LibraryOwl.talk`, which knows which it is.
   * Offered only while the owl is at her desk ({@link interactZones}): the
   * selection caches her box where it first finds her, so a zone that
   * followed her flight would ring the desk while she sat on the story chair.
   */
  private buildOwlZone(): InteractZone {
    const spot = LIBRARY_LIBRARIAN_SPOT;
    const talk = (): void => {
      if (this.player) this.owl.talk(this.player);
    };
    return {
      id: OWL_ZONE_ID,
      label: 'the librarian',
      x: LIBRARY_ORIGIN_X + spot.x,
      y: LIBRARY_FLOOR_Y + 1,
      z: LIBRARY_ORIGIN_Z + spot.z,
      pickRadius: OWL_PICK_RADIUS,
      standX: LIBRARY_ORIGIN_X + LIBRARY_DESK_STAND.x,
      standZ: LIBRARY_ORIGIN_Z + LIBRARY_DESK_STAND.z,
      verb: 'Talk',
      highlight: highlightObject(this.owl.handle.root),
      actions: () => (hasLibraryCard(gameStore.get()) ? pressAction(LIBRARY_CHIPS.hello, talk, '🦉') : pressAction(LIBRARY_CHIPS.getCard, talk, '🪪')),
    };
  }

  /**
   * **The secret shelf's Pull zone** (#719): on the gold book where it stands
   * while the leaf is shut, a metre over the floor; stood at
   * `LIBRARY_SECRET_STAND`, in front of the case, facing it; the rainbow round
   * the book itself; and one chip, **Pull the book!** — offered only while the
   * leaf is shut and not swinging. Otherwise it offers nothing at all, which
   * makes it unselectable (`world/Selection.ts`), so the selection's cached box
   * for a book that has swung away is never consulted (plan Decision 35).
   */
  private secretBookZone(): InteractZone {
    const leaf = this.secretShelf;
    const at = leaf.shutBookRoom;
    return {
      id: LIBRARY_SECRET_BOOK_ZONE,
      label: 'the special book',
      x: LIBRARY_ORIGIN_X + at.x,
      y: LIBRARY_FLOOR_Y + 1,
      z: LIBRARY_ORIGIN_Z + at.z,
      pickRadius: SHELF_BOOK_PICK_RADIUS,
      standX: LIBRARY_ORIGIN_X + LIBRARY_SECRET_STAND.x,
      standZ: LIBRARY_ORIGIN_Z + LIBRARY_SECRET_STAND.z,
      standRadius: PULL_STAND_RADIUS,
      verb: 'Pull',
      highlight: highlightObject(leaf.pullBook),
      actions: () => (leaf.open || leaf.swinging ? [] : pressAction(LIBRARY_CHIPS.pull, () => this.pullSecretBook(), '📕')),
    };
  }

  /**
   * **The library cat's Pet zone** (#719): on the cat, a metre over the floor,
   * picked within {@link CAT_PICK_RADIUS}; stood at `LIBRARY_CAT_STAND`, in
   * front of her pile, within {@link CAT_STAND_RADIUS}; the rainbow round the
   * pile and the cat together; one chip, **Pet the cat!** (`LibraryCat.pet`,
   * which ignores a second press inside its guard — the chip stays, and the
   * stroke she gave a moment ago is still going).
   */
  private buildCatZone(): InteractZone {
    return {
      id: CAT_ZONE_ID,
      label: 'the library cat',
      x: LIBRARY_ORIGIN_X + LIBRARY_CAT_PILE.x,
      y: LIBRARY_FLOOR_Y + 1,
      z: LIBRARY_ORIGIN_Z + LIBRARY_CAT_PILE.z,
      pickRadius: CAT_PICK_RADIUS,
      standX: LIBRARY_ORIGIN_X + LIBRARY_CAT_STAND.x,
      standZ: LIBRARY_ORIGIN_Z + LIBRARY_CAT_STAND.z,
      standRadius: CAT_STAND_RADIUS,
      verb: 'Pet',
      highlight: highlightObject(this.cat.group),
      actions: () => pressAction(LIBRARY_CHIPS.pet, () => this.cat.pet(), '🐈'),
    };
  }

  /**
   * **The baby dragon's Say hi zone** (#719): on the dragon, a metre over the
   * floor, picked within {@link DRAGON_PICK_RADIUS}; stood at
   * `LIBRARY_DRAGON_STAND`, within {@link DRAGON_STAND_RADIUS}; the rainbow
   * round the dragon itself. Offered only once the secret shelf has landed
   * open ({@link interactZones}): shut, nobody knows it is there.
   */
  private buildDragonZone(): InteractZone {
    return {
      id: DRAGON_ZONE_ID,
      label: 'the baby dragon',
      x: LIBRARY_ORIGIN_X + LIBRARY_DRAGON_NEST.x,
      y: LIBRARY_FLOOR_Y + 1,
      z: LIBRARY_ORIGIN_Z + LIBRARY_DRAGON_NEST.z,
      pickRadius: DRAGON_PICK_RADIUS,
      standX: LIBRARY_ORIGIN_X + LIBRARY_DRAGON_STAND.x,
      standZ: LIBRARY_ORIGIN_Z + LIBRARY_DRAGON_STAND.z,
      standRadius: DRAGON_STAND_RADIUS,
      // Reached from every side of the dragon, not only its stand (LibraryDen's DRAGON_REACH_RADIUS).
      reachX: LIBRARY_ORIGIN_X + LIBRARY_DRAGON_NEST.x,
      reachZ: LIBRARY_ORIGIN_Z + LIBRARY_DRAGON_NEST.z,
      verb: 'Say hi',
      highlight: highlightObject(this.den.dragon.root),
      actions: () => pressAction(LIBRARY_CHIPS.sayHi, () => this.den.sayHi(), '🐉'),
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
