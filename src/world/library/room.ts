import type { Group, MeshToonMaterial, Object3D } from 'three';
import type { CollisionWorld, WallCollider } from '../Collision';
import type { WalkSurfaces } from '../building/surfaces';
import type { InteriorControls } from '../building/Building';
import type { SpeechBubble } from '../../ui/SpeechBubble';
import type { PlacedDoorFrame } from '../../art/models/doorFrames';
import { KID_HIP_HEIGHT } from '../../art/models/kid';
import { libraryCushionSize } from '../../art/models/libraryAssets';
import { LibraryLighting } from './lighting';
import { LibraryProps } from './props';
import { bookInstances, furnishReadingRoom, shelveFace, StackFader, type FurnishedShelfBook } from './furnish';
import { createLibraryOwl } from '../../art/models/libraryCreatures';
import { createLibraryDesk, createLibraryReadingLamp, libraryBookMaterial, libraryBookShapes } from '../../art/models/libraryRoomAssets';
import { LibraryOwl, type OwlBystander } from './LibraryOwl';
import { SecretLeaf } from './secretShelf';
import { LibraryDen } from './LibraryDen';
import { LibraryCat } from './LibraryCat';
import { buildLibraryDenShell, buildReadingRoomShell, type LibraryDenShell } from './roomShell';
import { CAT_ZONE_ID, DRAGON_ZONE_ID } from './roomIds';
import {
  LIBRARY_FLOOR_Y,
  LIBRARY_HALF_X,
  LIBRARY_HALF_Z,
  LIBRARY_ORIGIN_X,
  LIBRARY_ORIGIN_Z,
  LIBRARY_PLAYER_SEATS,
  LIBRARY_WALL_HALF,
  LIBRARY_WALL_HEIGHT,
  libraryCushion,
  libraryFacingStoryChair,
  type LibraryPlayerSeat,
  type LocalPoint,
} from './layout';

/**
 * **The Library's reading room, furnished** — its shell, the secret den and
 * its lintel, every bookcase and book, the desk, the chairs and lamps, the
 * owl librarian, the secret shelf, the baby dragon on its nest, the cat on her
 * pile, and the room's lights — fetched when she first goes in, not at boot.
 *
 * It is a lazy chunk (`world/interiors.ts`'s `LIBRARY_ROOM`; Jim, 12 Nov 2026:
 * *"all interiors should be loaded on-demand on entering that room"*): the
 * reading room's piece of the Library kit (`libraryRoomGlb.ts`) and the den's
 * kit are most of 700 KB, and a child who never goes in has no use for any of
 * it. `Library.ts` keeps the building in the park, its door, the children,
 * and the bubbles every label is registered with at boot; this builds the
 * room, in the order it was always built.
 *
 * Everything here is solid the moment it exists: every collider goes through
 * `LibraryProps`, which refuses one on any spot `libraryKeepOuts` says she
 * must stand on (`assertClear`, last). The door holds its iris shut until this
 * has run (`SpaceManager.changeToFurnished`), so she never stands in the room
 * before its solids are there.
 */

/**
 * **The reading room's models a storybook page draws** (`reader/pagePictures.ts`):
 * handed over through this chunk rather than imported by the reader's, so no
 * module is shared between two lazy chunks (see `pagePictures.ts`'s
 * `libraryArt`).
 */
export const LIBRARY_PICTURE_ART = {
  createLibraryOwl,
  createLibraryDesk,
  createLibraryReadingLamp,
  libraryBookMaterial,
  libraryBookShapes,
  bookInstances,
  shelveFace,
};

/** What a page may draw from the reading room. */
export type LibraryPictureArt = typeof LIBRARY_PICTURE_ART;

/** One of her two story cushions: where it is, which way she faces on it, and its drawn piece. */
export interface PlayerSeat {
  readonly id: LibraryPlayerSeat;
  readonly at: LocalPoint;
  /** `Player.facing` degrees: at the storyteller's chair (`libraryFacingStoryChair`). */
  readonly facing: number;
  /** The cushion as drawn — what the rainbow hugs while its chip is up. */
  readonly piece: Object3D;
}

/** What the building hands the room to be furnished into. */
export interface LibraryRoomDeps {
  /** The reading room's root, at its own origin (`Library.roomRoot`). */
  readonly roomRoot: Group;
  /** The den's root, a child of the room's (`Library.denRoot`). */
  readonly denRoot: Group;
  readonly collision: CollisionWorld;
  readonly controls: InteriorControls;
  readonly surfaces: WalkSurfaces;
  /** The owl's bubble, made at boot so the label manager has it from the start. */
  readonly owlBubble: SpeechBubble;
  /** Everybody the owl must never fly into (`Library`'s `owlBystanders`). */
  readonly owlBystanders: () => Iterable<Readonly<OwlBystander>>;
  /** A creature says a line: the zone it answers, the words, and where (room-local) the bubble hangs. */
  readonly sayCreature: (item: string, line: string, at: { readonly x: number; readonly y: number; readonly z: number }) => void;
}

/** The furnished room, as `Library` holds it. */
export interface LibraryRoomContent {
  readonly props: LibraryProps;
  /** The reading room's own four walls' colliders. */
  readonly roomWalls: readonly WallCollider[];
  /** The doorway frame round the room's way out (`doorFrames.ts`), built with the shell. */
  readonly exitDoorFrame: PlacedDoorFrame;
  readonly westWall: Group;
  readonly westMaterial: MeshToonMaterial;
  readonly denShell: LibraryDenShell;
  /** Every furnished piece as drawn, by its `LIBRARY_FURNITURE` / `LIBRARY_BOOKCASES` id. */
  readonly pieces: ReadonlyMap<string, Object3D>;
  readonly stacks: readonly StackFader[];
  readonly bookCount: number;
  readonly shelfBooks: readonly FurnishedShelfBook[];
  readonly owl: LibraryOwl;
  readonly secretShelf: SecretLeaf;
  /** Every sightline fade: the stacks, and the open leaf. */
  readonly faders: readonly StackFader[];
  /** The west wall's fade, while she is in the den. */
  readonly westWallFader: StackFader;
  readonly den: LibraryDen;
  readonly cat: LibraryCat;
  readonly lighting: LibraryLighting;
  readonly playerSeats: readonly PlayerSeat[];
}

/**
 * How far a story cushion's measured top may stand from `KID_HIP_HEIGHT` and
 * still be a seat — see {@link assertCushionsAreSeats}.
 */
const CUSHION_SEAT_TOLERANCE = 0.02;

/** Furnishes the reading room into `deps.roomRoot`: every solid registered, every keep-out held clear. */
export function furnishLibraryRoom(deps: LibraryRoomDeps): LibraryRoomContent {
  const { roomRoot, denRoot, collision, controls, surfaces } = deps;
  const shell = buildReadingRoomShell(roomRoot, collision, surfaces);
  const props = new LibraryProps(collision, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z);
  // The den (#719) before the furniture, drawn from the Artist's kit, its
  // walls through the same props, so every one is held clear of every stand
  // spot like any bookcase; its lintel hung in the west wall.
  const denShell = buildLibraryDenShell(denRoot, props, collision, surfaces, shell);
  const furnished = furnishReadingRoom(roomRoot, props);
  // The owl (#718): after the furniture, whose shelf books her glow lights,
  // and before `assertClear`, so her solid is checked against every keep-out.
  const owl = new LibraryOwl(roomRoot, props, collision, furnished.shelfBooks, controls, deps.owlBystanders, deps.owlBubble);
  // The secret shelf (#719): the leaf on its hinge, with the row the
  // furnisher drew for it; both of its collider states go through the props.
  const secretShelf = new SecretLeaf(props, roomRoot, furnished.secret.books);
  const faders = [...furnished.stacks, secretShelf.fader];
  const westWallFader = new StackFader(
    'west-wall',
    shell.westWall,
    { x: -LIBRARY_HALF_X, z: 0 },
    90,
    { length: 2 * LIBRARY_HALF_Z, depth: 2 * LIBRARY_WALL_HALF, height: LIBRARY_WALL_HEIGHT },
    [shell.westMaterial],
  );
  // The creatures (#719, plan Step 13): the dragon on its nest in the den,
  // the cat on her pile by the desk — every solid of theirs through the
  // props, before the keep-out assertion below.
  const den: LibraryDen = new LibraryDen(denRoot, props, (line) => deps.sayCreature(DRAGON_ZONE_ID, line, den.bubbleAt));
  const cat: LibraryCat = new LibraryCat(roomRoot, props, (line) => deps.sayCreature(CAT_ZONE_ID, line, cat.bubbleAt));
  const lighting = new LibraryLighting(furnished.pools);
  roomRoot.add(lighting.group);
  // Her two story cushions (#718): seats only if cut to her hip height.
  assertCushionsAreSeats();
  const playerSeats = LIBRARY_PLAYER_SEATS.map((id): PlayerSeat => {
    const cushion = libraryCushion(id);
    const piece = furnished.pieces.get(id);
    if (!piece) throw new Error(`Library: ${id} was never furnished, so there is no cushion to offer her`);
    return { id, at: cushion.at, facing: libraryFacingStoryChair(cushion.at), piece };
  });
  props.assertClear();
  return {
    props,
    roomWalls: shell.walls,
    exitDoorFrame: { frame: shell.exitFrame, solids: shell.exitFrameSolids, originX: LIBRARY_ORIGIN_X, originZ: LIBRARY_ORIGIN_Z, originY: LIBRARY_FLOOR_Y },
    westWall: shell.westWall,
    westMaterial: shell.westMaterial,
    denShell,
    pieces: furnished.pieces,
    stacks: furnished.stacks,
    bookCount: furnished.bookCount,
    shelfBooks: furnished.shelfBooks,
    owl,
    secretShelf,
    faders,
    westWallFader,
    den,
    cat,
    lighting,
    playerSeats,
  };
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
