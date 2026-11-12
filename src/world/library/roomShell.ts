import { Box3, BoxGeometry, Group, Mesh, type InstancedMesh, type MeshToonMaterial } from 'three';
import { JUMP_CLEARANCE_GRACE, type BoxCollider, type CollisionWorld, type WallCollider } from '../Collision';
import type { WalkSurfaces } from '../building/surfaces';
import { Plate } from '../hotel/place';
import { segmentsMinusGaps, cornerClosedSpans } from '../wallRuns';
import { PALETTE } from '../../core/palette';
import { solid, toonMaterial } from '../../art/style/materials';
import { libraryBookcaseSize } from '../../art/models/libraryAssets';
import { createLibraryDen, createLibraryDenLantern, type LibraryDenHandle } from '../../art/models/libraryDenAssets';
import { LIBRARY_DEN_PLAN, type LibraryDenNiche, type LibraryDenPlan } from '../../art/models/libraryDenKit';
import { shelveDenNiches } from './furnish';
import { LIBRARY_INTERIOR_LIFT } from './lighting';
import type { LibraryProps } from './props';
import { libraryDenGap, libraryDoorGap } from './shell';
import {
  DEN_NORTH_PAST_DOOR,
  LIBRARY_DEN_DEPTH,
  LIBRARY_DEN_DOOR_HALF,
  LIBRARY_DEN_INNER,
  LIBRARY_FLOOR_Y,
  LIBRARY_HALF_X,
  LIBRARY_HALF_Z,
  LIBRARY_INNER_X,
  LIBRARY_ORIGIN_X,
  LIBRARY_ORIGIN_Z,
  LIBRARY_SCONCE_HEIGHT,
  LIBRARY_SECRET_BOOKCASE,
  LIBRARY_WALL_HALF,
  LIBRARY_WALL_HEIGHT,
  type LocalPoint,
} from './layout';

/**
 * **The reading room's shell and the secret den's** — the floor, the four
 * walls with the front doorway and the den's, and the Artist's den behind the
 * west wall, every one of them solid as it is built.
 *
 * Split out of `shell.ts` (which keeps the building in the park, its frame,
 * its colliders and the bands of every doorway) so it can be part of the
 * reading room's lazy chunk (`room.ts`, `world/interiors.ts`'s `LIBRARY_ROOM`):
 * the den's kit is drawn only in here, and nothing in here is built until she
 * first goes in. Every collider is registered as its piece is built, and the
 * door holds its iris shut until all of them are (`SpaceManager.changeToFurnished`).
 */


/**
 * How far the reading room's floor slab runs on past each wall's centre line:
 * the wall's whole thickness, so the doorway's threshold has floor under it
 * and the slab's edge is the wall's outer face. The den's floor (#719) abuts
 * that edge, so the two slabs meet at a line and share no face.
 */
const FLOOR_APRON = LIBRARY_WALL_HALF * 2;
/** The floor slab's thickness, its top on the floor. */
const FLOOR_THICKNESS = 0.5;

/**
 * **How far the lintel's base sits below the height at which a flier clears
 * the shut shelf** (the shelf's top less `JUMP_CLEARANCE_GRACE`), so the band
 * the shelf holds and the band the lintel holds overlap: there is no height at
 * which she slips through between the two (`check:library`'s LINTEL sweeps
 * every height to prove it).
 */
const LINTEL_OVERLAP = 0.05;

/** The reading room's own paint, for anything built of the same stuff — the secret den (#719). */
export interface ReadingRoomFabric {
  /** The floor's boards. */
  readonly floor: MeshToonMaterial;
  /** The walls' green — the north, south and east walls' own material (never the west wall's, which fades). */
  readonly wall: MeshToonMaterial;
}

/** What {@link buildReadingRoomShell} built. */
export interface ReadingRoomShell {
  /** Every room wall's collider, in registration order, the west wall's two spans either side of the den's doorway among them. */
  readonly walls: readonly WallCollider[];
  /**
   * **The west wall, as one group**: its two spans either side of the den's
   * doorway, and — once the den is built ({@link buildLibraryDenShell}) — the
   * Artist's lintel over the doorway (#719). One group with one material of
   * its own ({@link westMaterial}), so it can fade while she is in the den
   * (plan Step 12) without fading the north wall.
   */
  readonly westWall: Group;
  /** The west wall's material: the walls' green, cloned, so fading it fades nothing else. */
  readonly westMaterial: MeshToonMaterial;
  readonly fabric: ReadingRoomFabric;
}

/**
 * The reading room's floor plate and walls, in `root` (which stands at the
 * room's origin), registered with the collision world in world metres.
 *
 * **The west wall has a doorway into the secret den** (#719,
 * {@link libraryDenGap}), so it is two spans; the lintel over the gap is the
 * Artist's, drawn and made solid with the rest of the den
 * ({@link buildLibraryDenShell}), and hung in this wall's group. The secret
 * shelf fills the doorway shut (`secretShelf.ts`), so the den beyond is a
 * sealed pocket until the shelf swings.
 *
 * Returns the colliders and the west wall's group, for a check to open one
 * deliberately and for the west wall's fade.
 */
export function buildReadingRoomShell(root: Group, collision: CollisionWorld, surfaces: WalkSurfaces): ReadingRoomShell {
  const originX = LIBRARY_ORIGIN_X;
  const originZ = LIBRARY_ORIGIN_Z;

  // The floor: warm boards under the dim light, one slab with a little apron
  // past the walls so the doorway's threshold has floor under it.
  const floorMaterial = roomMaterial(PALETTE.wood);
  const floor = solid(
    new Mesh(new BoxGeometry(LIBRARY_HALF_X * 2 + FLOOR_APRON * 2, FLOOR_THICKNESS, LIBRARY_HALF_Z * 2 + FLOOR_APRON * 2), floorMaterial),
  );
  floor.position.set(0, -FLOOR_THICKNESS / 2, 0);
  floor.name = 'library.floor';
  root.add(floor);
  surfaces.addPlatform(
    new Plate(
      LIBRARY_FLOOR_Y,
      originX - LIBRARY_HALF_X - FLOOR_APRON,
      originX + LIBRARY_HALF_X + FLOOR_APRON,
      originZ - LIBRARY_HALF_Z - FLOOR_APRON,
      originZ + LIBRARY_HALF_Z + FLOOR_APRON,
    ),
  );

  // The walls: the classic reading-room green. The west wall's spans (and the
  // den's lintel, hung here when the den is built) are one group in a material
  // of their own, so they can fade together while she is in the den behind them.
  const sides = [
    { side: 'north', x1: -LIBRARY_HALF_X, z1: -LIBRARY_HALF_Z, x2: LIBRARY_HALF_X, z2: -LIBRARY_HALF_Z, hidden: false },
    { side: 'south', x1: -LIBRARY_HALF_X, z1: LIBRARY_HALF_Z, x2: LIBRARY_HALF_X, z2: LIBRARY_HALF_Z, hidden: true },
    { side: 'west', x1: -LIBRARY_HALF_X, z1: -LIBRARY_HALF_Z, x2: -LIBRARY_HALF_X, z2: LIBRARY_HALF_Z, hidden: false },
    { side: 'east', x1: LIBRARY_HALF_X, z1: -LIBRARY_HALF_Z, x2: LIBRARY_HALF_X, z2: LIBRARY_HALF_Z, hidden: true },
  ] as const;
  const material = roomMaterial(PALETTE.buildingTrimDeep);
  const westMaterial = material.clone();
  const westWall = new Group();
  westWall.name = 'library.westWall';
  root.add(westWall);
  const denGap = libraryDenGap();
  const walls: WallCollider[] = [];
  for (const { side, x1, z1, x2, z2, hidden } of sides) {
    const along = side === 'north' || side === 'south' ? 'x' : 'z';
    const from = along === 'x' ? x1 : z1;
    const to = along === 'x' ? x2 : z2;
    const gaps: (readonly [number, number])[] = side === 'south' ? [libraryDoorGap()] : side === 'west' ? [denGap] : [];
    const spans = segmentsMinusGaps(from, to, gaps);
    // North and south take the corners; east and west stop short of them by
    // the wall's depth, so no two boxes share a corner column (the reptile
    // hall's rule, which `check:coplanar` taught it).
    const drawn =
      along === 'x'
        ? cornerClosedSpans(spans, from, to, LIBRARY_WALL_HALF)
        : spans.map(([a, b]): [number, number] => [a <= from + 1e-6 ? a + LIBRARY_WALL_HALF : a, b >= to - 1e-6 ? b - LIBRARY_WALL_HALF : b]);
    const west = side === 'west';
    for (const [index, [a, b]] of spans.entries()) {
      if (b - a < 0.05) continue;
      const [drawnA, drawnB] = drawn[index] ?? [a, b];
      const length = drawnB - drawnA;
      const mid = (drawnA + drawnB) / 2;
      const box = solid(
        new Mesh(
          along === 'x'
            ? new BoxGeometry(length, LIBRARY_WALL_HEIGHT, LIBRARY_WALL_HALF * 2)
            : new BoxGeometry(LIBRARY_WALL_HALF * 2, LIBRARY_WALL_HEIGHT, length),
          west ? westMaterial : material,
        ),
      );
      box.name = `library.wall.${side}`;
      box.position.set(along === 'x' ? mid : x1, LIBRARY_WALL_HEIGHT / 2, along === 'x' ? z1 : mid);
      // Hidden, not shortened: the collider below is the same either way.
      if (hidden) box.visible = false;
      (west ? westWall : root).add(box);
      walls.push(
        collision.kinded('library room wall', () =>
          collision.addWall(
            originX + (along === 'x' ? a : x1),
            originZ + (along === 'x' ? z1 : a),
            originX + (along === 'x' ? b : x1),
            originZ + (along === 'x' ? z1 : b),
            LIBRARY_WALL_HALF,
            LIBRARY_WALL_HEIGHT,
            false,
            true,
          ),
        ),
      );
    }
  }

  return { walls, westWall, westMaterial, fabric: { floor: floorMaterial, wall: material } };
}

// ---------------------------------------------------------------------------
// The secret den (#719): the Artist's kit, held to the layout, made solid
// ---------------------------------------------------------------------------

/** How far a drawn den figure may stand off the layout's before the build refuses it: the art contract's 5 mm. */
const DEN_DRAWN_TOLERANCE = 0.005;

/**
 * **Where the drawn den stands in the reading room** (#719): the Artist's kit
 * (`libraryDen.glb`, measured once as `LIBRARY_DEN_PLAN`) with its origin —
 * the middle of the doorway, on the west wall's centre line, at the bottom of
 * its floor slab — at the doorway's middle, `floorTop` under the room's floor,
 * and turned to the secret shelf's own facing, so the kit's +Z runs out
 * through the doorway into the room.
 */
export interface LibraryDenPlacement {
  /** The kit's root, room-local. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Its turn: `Player.facing` degrees (the secret shelf's), and as `rotation.y`. */
  readonly facing: number;
  readonly yaw: number;
  /** A point of the kit's own plan (asset x, z), room-local. */
  toRoom(ax: number, az: number): LocalPoint;
}

/**
 * **The drawn den's placement, held to the layout as it loads** (#719). The
 * layout owns where the den is — `LIBRARY_DEN_INNER`, the one rectangle
 * `libraryDenContains` asks and every body below is laid out from — and the
 * Artist's kit owns what is drawn there, built from those same figures. This
 * reads every drawn figure back into the room (the doorway, the three inner
 * faces, the walls' thickness and height, the lintel's band, the floor slab's
 * edges) and throws, naming each one, unless the two agree within 5 mm: a
 * wall a child walks up to is never drawn off the body that stops her, and
 * neither number is taken on the other's word.
 */
export function libraryDenPlacement(plan: LibraryDenPlan = LIBRARY_DEN_PLAN): LibraryDenPlacement {
  const facing = LIBRARY_SECRET_BOOKCASE.facing;
  const yaw = (facing * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const x = -LIBRARY_HALF_X;
  const z = LIBRARY_SECRET_BOOKCASE.at.z;
  const toRoom = (ax: number, az: number): LocalPoint => ({ x: x + ax * cos + az * sin, z: z - ax * sin + az * cos });
  const inner = LIBRARY_DEN_INNER;
  const [gapNorth, gapSouth] = libraryDenGap();
  const floorA = toRoom(plan.floor.minX, plan.floor.minZ);
  const floorB = toRoom(plan.floor.maxX, plan.floor.maxZ);
  const figures: readonly (readonly [what: string, drawn: number, laidOut: number])[] = [
    ["the walls' half-thickness", plan.wallHalf, LIBRARY_WALL_HALF],
    ["the walls' height", plan.wallHeight, LIBRARY_WALL_HEIGHT],
    ["the doorway's half-width", plan.doorHalf, LIBRARY_DEN_DOOR_HALF],
    ["the doorway's north edge, z", toRoom(plan.doorHalf, 0).z, gapNorth],
    ["the doorway's south edge, z", toRoom(-plan.doorHalf, 0).z, gapSouth],
    ["the far (west) wall's inner face, x", toRoom(0, plan.farInnerZ).x, inner.west],
    ["the north wall's inner face, z", toRoom(plan.northInnerX, 0).z, inner.north],
    ["the south wall's inner face, z", toRoom(plan.southInnerX, 0).z, inner.south],
    ["the den's depth", plan.depth, LIBRARY_DEN_DEPTH],
    ['its run north past the doorway', plan.northPastDoor, DEN_NORTH_PAST_DOOR],
    ["the lintel's underside over the floor (the shut shelf's top)", plan.lintelBase, libraryBookcaseSize(LIBRARY_SECRET_BOOKCASE.kind).height],
    ["the lintel's top over the floor (the wall's)", plan.lintelTop, LIBRARY_WALL_HEIGHT],
    ["the floor slab's west edge, x", Math.min(floorA.x, floorB.x), inner.west - 2 * LIBRARY_WALL_HALF],
    ["the floor slab's east edge, x (on the room floor's apron edge)", Math.max(floorA.x, floorB.x), -LIBRARY_HALF_X - FLOOR_APRON],
    ["the floor slab's north edge, z", Math.min(floorA.z, floorB.z), inner.north - 2 * LIBRARY_WALL_HALF],
    ["the floor slab's south edge, z", Math.max(floorA.z, floorB.z), inner.south + 2 * LIBRARY_WALL_HALF],
  ];
  const off = figures.filter(([, drawn, laidOut]) => !(Math.abs(drawn - laidOut) <= DEN_DRAWN_TOLERANCE));
  if (off.length > 0) {
    throw new Error(
      `Library: the drawn den (libraryDen.glb) is not where layout.ts lays it out, so its walls would stand off the bodies that stop her:\n` +
        off.map(([what, drawn, laidOut]) => `  - ${what}: drawn ${drawn.toFixed(3)}, laid out ${laidOut.toFixed(3)}`).join('\n'),
    );
  }
  return { x, y: -plan.floorTop, z, facing, yaw, toRoom };
}

/**
 * **Where the den's two lanterns hang** (#719), in the kit's own frame: on the
 * far (west) wall over the pier between its first two niches, and on the north
 * wall over the pier between its last two — one glow over each run of books,
 * clear of every star and the moon — turned out of their wall as its niches
 * are. Their bottoms hang at the reading room's sconce height,
 * `LIBRARY_SCONCE_HEIGHT`, out of every reach a child has, a jumping head
 * included — the sconces' own reason for being drawn and lit with no body —
 * and like the sconces they light nothing: the room's eight pools are spent.
 */
export function libraryDenLanternSpots(plan: LibraryDenPlan = LIBRARY_DEN_PLAN): readonly { readonly x: number; readonly y: number; readonly z: number; readonly facing: number }[] {
  const west = plan.niches.filter((niche) => niche.wall === 'west');
  const north = plan.niches.filter((niche) => niche.wall === 'north');
  const along = (niche: LibraryDenNiche): number => (niche.wall === 'west' ? niche.centre.x : niche.centre.z);
  /** The middle of the pier between two niches on one wall: between their nearer reveals. */
  const pier = (a: LibraryDenNiche, b: LibraryDenNiche): number => {
    const step = Math.sign(along(b) - along(a));
    return (along(a) + step * a.innerHalf + along(b) - step * b.innerHalf) / 2;
  };
  const [w0, w1] = west;
  const [n1, n2] = north.slice(-2);
  if (!w0 || !w1 || !n1 || !n2) throw new Error(`Library: the den kit has ${west.length} west and ${north.length} north niche(s); its lanterns hang over a pier between two on each`);
  const y = plan.floorTop + LIBRARY_SCONCE_HEIGHT;
  return [
    { x: pier(w0, w1), y, z: w0.centre.z, facing: w0.facing },
    { x: n1.centre.x, y, z: pier(n1, n2), facing: n1.facing },
  ];
}

/** What {@link buildLibraryDenShell} built. */
export interface LibraryDenShell {
  /**
   * **The Artist's den, drawn** (`createLibraryDen`): its floor slab, its three
   * walls with their book niches (the south one hidden: the camera's near
   * side, the room's rule), the niches' boards and backs, the stars and the
   * moon — every node but the lintel, which hangs in the west wall's group.
   */
  readonly model: LibraryDenHandle;
  /** The den's three walls' bodies — west, north, south — registered through `LibraryProps` as `den wall (west|north|south)`. */
  readonly walls: readonly [west: WallCollider, north: WallCollider, south: WallCollider];
  /**
   * **The lintel's body** — banded: absent to anything whose feet are below
   * its base (`baseHeight`), so a walker and a jump pass under it and the
   * ground fill sees a doorway; solid from there to the wall's own top, which
   * is every room wall's top too (real tops, PR #722 — over it the walls hold
   * nobody, and neither does this). Registered raw, like the room's walls:
   * `LibraryProps`' keep-out test is two-dimensional and would misread a body
   * that is only there above the case's top.
   */
  readonly lintel: WallCollider;
  /** The books on the niches' boards, one `InstancedMesh` in the kit's frame (`furnish.ts`'s `shelveDenNiches`). */
  readonly books: InstancedMesh;
  /** The two lanterns, each `library.denLantern` ({@link libraryDenLanternSpots}). */
  readonly lanterns: readonly Group[];
  /**
   * **Each lantern's body** — its own drawn box (outline included), banded from
   * its lowest drawn point to its top, as the lintel is: out of a walker's and
   * a jumper's reach, so it only ever meets a jet-pack flier, who now bumps a
   * lantern rather than flying through it (anything drawn is solid). Raw, for
   * the lintel's reason.
   */
  readonly lanternBodies: readonly BoxCollider[];
}

/**
 * **The secret den** (#719): a walled pocket of the reading room behind its
 * west wall — not a space of its own, so no iris, no boundary and no save
 * plumbing (plan Decision 20) — **drawn from the Artist's Blender kit**
 * (`libraryDen.glb`), in `denRoot`, which stands at the room's origin.
 *
 * - **What is drawn** is `createLibraryDen`'s, in the room's own paint (its
 *   floor the room floor's boards, its walls the room's green), placed by
 *   {@link libraryDenPlacement}, which throws unless every drawn figure is the
 *   layout's within 5 mm. Its book niches are filled from a seed of their own
 *   (`shelveDenNiches`), and two lanterns glow over them. The south wall is
 *   the camera's near side, so it is hidden, not shortened. **The lintel**
 *   over the doorway is the kit's too, moved into the west wall's group
 *   (`attach` keeps where it stands): it is part of that wall, painted in its
 *   cloned material so it fades with it, and seen from the room while the den
 *   itself is hidden.
 * - **What is solid** is laid out from the layout's figures, which the drawn
 *   den has just been held to: the floor's walkable plate from the den's west
 *   edge to the room's inner wall face, so the doorway has floor under it
 *   from both sides; three walls, each one capsule through `LibraryProps` to
 *   the wall's real top, held clear of every stand spot and removable by name
 *   (`den wall (west|north|south)`) — the west one through both corners, the
 *   north and south from it to the room's west wall's centre line, the room
 *   walls' own shape; and the lintel's band. Everything else drawn here is
 *   inside one of those walls (the niches' boards, backs and books, behind
 *   their inner faces), a relief within a line's width of one (the stars and
 *   the moon, 25 mm proud, over every reach), or hung out of every reach
 *   (the lanterns).
 *
 * Its east side is the reading room's west wall, with the doorway in it.
 */
export function buildLibraryDenShell(denRoot: Group, props: LibraryProps, collision: CollisionWorld, surfaces: WalkSurfaces, room: ReadingRoomShell): LibraryDenShell {
  const place = libraryDenPlacement();
  const plan = LIBRARY_DEN_PLAN;

  // What is drawn: the Artist's den, in the room's own paint.
  const model = createLibraryDen({ floor: room.fabric.floor, wall: room.fabric.wall, lintel: room.westMaterial });
  model.root.position.set(place.x, place.y, place.z);
  model.root.rotation.y = place.yaw; // flat-ok: room-local yaw in the library's own flat space at (-600, -600), off the sphere
  denRoot.add(model.root);
  // Hidden, not shortened: its body is the same either way.
  model.walls.south.visible = false;
  // The lintel is the west wall's: shown with the room while the den is
  // hidden, and faded with the wall's spans while she is in the den.
  room.westWall.attach(model.lintel);
  const books = shelveDenNiches(plan.niches, plan.floorTop);
  model.root.add(books);
  const lanterns = libraryDenLanternSpots(plan).map((spot) => {
    const lantern = createLibraryDenLantern().root;
    lantern.position.set(spot.x, spot.y, spot.z);
    lantern.rotation.y = (spot.facing * Math.PI) / 180; // flat-ok: the lantern turned out of its wall, in the den kit's own frame
    model.root.add(lantern);
    return lantern;
  });

  // What is solid, from the layout the drawn den was just held to.
  const t = LIBRARY_WALL_HALF;
  const inner = LIBRARY_DEN_INNER;
  // The walls' centre lines, and the room's west wall's centre line.
  const westX = inner.west - t;
  const northZ = inner.north - t;
  const southZ = inner.south + t;
  const roomWallX = -LIBRARY_HALF_X;
  surfaces.addPlatform(
    new Plate(LIBRARY_FLOOR_Y, LIBRARY_ORIGIN_X + westX - t, LIBRARY_ORIGIN_X - LIBRARY_INNER_X, LIBRARY_ORIGIN_Z + northZ - t, LIBRARY_ORIGIN_Z + southZ + t),
  );
  // To the drawn wall's own top, as every room wall is (real tops, PR #722):
  // nothing drawn carries a flag for a top any more.
  const west = props.wall('den wall (west)', { x: westX, z: northZ }, { x: westX, z: southZ }, t, LIBRARY_WALL_HEIGHT);
  const north = props.wall('den wall (north)', { x: westX, z: northZ }, { x: roomWallX, z: northZ }, t, LIBRARY_WALL_HEIGHT);
  const south = props.wall('den wall (south)', { x: westX, z: southZ }, { x: roomWallX, z: southZ }, t, LIBRARY_WALL_HEIGHT);
  // The lintel's band: from `JUMP_CLEARANCE_GRACE` + `LINTEL_OVERLAP` under
  // the shut shelf's top (measured, never typed) up to the wall's own top. A
  // flier high enough to clear the shut shelf meets it, a walker and a jump
  // never do, and over the wall's top it holds nobody — exactly as the wall
  // beside it holds nobody there.
  const [gapNorth, gapSouth] = libraryDenGap();
  const shelfTop = libraryBookcaseSize(LIBRARY_SECRET_BOOKCASE.kind).height;
  const lintel = collision.kinded('library lintel', () =>
    collision.addWall(
      LIBRARY_ORIGIN_X + roomWallX,
      LIBRARY_ORIGIN_Z + gapNorth,
      LIBRARY_ORIGIN_X + roomWallX,
      LIBRARY_ORIGIN_Z + gapSouth,
      t,
      LIBRARY_FLOOR_Y + LIBRARY_WALL_HEIGHT,
      false,
      true,
      LIBRARY_FLOOR_Y + shelfTop - JUMP_CLEARANCE_GRACE - LINTEL_OVERLAP,
    ),
  );
  const drawn = new Box3();
  const lanternBodies = lanterns.map((lantern) => {
    lantern.updateWorldMatrix(true, true);
    drawn.setFromObject(lantern, true);
    return collision.kinded('library den lantern', () =>
      collision.addBox(
        (drawn.min.x + drawn.max.x) / 2,
        (drawn.min.z + drawn.max.z) / 2,
        (drawn.max.x - drawn.min.x) / 2,
        (drawn.max.z - drawn.min.z) / 2,
        0,
        0,
        drawn.max.y, // flat-ok: the lantern's own drawn top, in the library's flat space
        false,
        true,
        drawn.min.y, // flat-ok: its own lowest drawn point
      ),
    );
  });
  return { model, walls: [west, north, south], lintel, books, lanterns, lanternBodies };
}

/**
 * The reading room's own fabric — floor and walls: toon-shaded like every
 * interior, with the room's own small lift (`lighting.ts`'s
 * `LIBRARY_INTERIOR_LIFT`) so the lamps, not the paint, light it.
 */
function roomMaterial(colour: number) {
  return toonMaterial(colour, { emissive: colour, emissiveIntensity: LIBRARY_INTERIOR_LIFT });
}

