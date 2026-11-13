import {
  BackSide,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../../core/palette';
import { ART } from '../style/artPalette';
import { addSmoothOutline, decal, solid, toonMaterial } from '../style/materials';
import { visibleBounds } from '../style/measure';
import type { AssetHandle } from '../style/asset';
import { kitBounds, kitTop, libraryPart, libraryPartNames } from './libraryKit';
import { markShared } from '../style/materials';
import { LIBRARY_ROOM_PART_NAMES } from './libraryRoomKit';
import {
  assemble,
  boxAt,
  buildBookcase,
  LIBRARY_GLB_STYLES,
  measurePlan,
  OWN,
  ownPart,
  paint,
  libraryBookcaseSize,
  type BookcaseKind,
  type BookcaseSize,
} from './libraryAssets';

/**
 * **The reading room's models, dressed** — everything drawn only inside the
 * Library: the secret shelf, the books, the desk, the armchair, the lamps, the
 * side table, the rug, the sconce, and the baked models the room is drawn
 * with. Split out of `libraryAssets.ts` (which keeps the building, the
 * bookcase and the cushion the boot measures, and the one dresser and style
 * table every piece is painted by) so it can be a lazy chunk: it is in the
 * reading room's (`world/interiors.ts`'s `LIBRARY_ROOM`), with the room's piece
 * of the kit (`libraryRoomKit.ts`), fetched when she first goes in.
 */

// The style table and the whole file must name the same nodes — a node the
// table misses would arrive undressed, a row the file lacks is a stale name.
// The boot half (`libraryAssets.ts`) can only see the building's nodes; with
// the room's registered (`libraryRoomKit.ts`, imported above), every node is
// here to ask.
{
  const names = libraryPartNames();
  const undressed = names.filter((name) => !LIBRARY_GLB_STYLES[name]);
  const stale = Object.keys(LIBRARY_GLB_STYLES).filter((name) => !names.includes(name));
  if (undressed.length > 0 || stale.length > 0) {
    throw new Error(
      `libraryRoomAssets: LIBRARY_GLB_STYLES and library.glb disagree — undressed nodes: ${undressed.join(', ') || 'none'}; ` +
        `rows naming no node: ${stale.join(', ') || 'none'}`,
    );
  }
  for (const name of LIBRARY_ROOM_PART_NAMES) markShared(libraryPart(name).geometry);
}

/** The kit's secret-shelf twin of the wall case: the same case vertex for vertex, its origin on one vertical edge. */
const SECRET_SHELF_NODES = ['secretShelf-carcass', 'secretShelf-shelves'] as const;

/** How far the drawn leaf's own measured size may stand from the wall case's and still be the same case. */
const SECRET_LEAF_TOLERANCE = 0.005;

/** The secret shelf's swinging leaf (#719), dressed, with the figures the hinge is built from. */
export interface LibrarySecretLeaf {
  /**
   * The leaf: its origin on its **back-left** vertical edge (left as a child
   * facing its books sees it), spanning x 0..`size.length`, z 0..`size.depth`,
   * its books' front on z = `size.depth`.
   */
  readonly root: Group;
  /** The wall case's measured size — the leaf's own, asserted equal within {@link SECRET_LEAF_TOLERANCE}. */
  readonly size: BookcaseSize;
  /** Its materials, its own (the baked body's and its outline's), so it can fade without fading the forty cases drawn from the same source. */
  readonly materials: readonly Material[];
}

/**
 * **The secret shelf's leaf** (#719): the wall case, drawn from the kit's
 * `secretShelf-*` twin of it — the same case the four cases beside it are
 * instanced from, so a child sees five of a kind — re-originated on its
 * **back-left** vertical edge, where the game hinges it (plan Decision 21: it
 * swings into the den behind the wall, not out into the room the Artist's
 * front-left origin was cut for; the shift is the carcass's measured depth,
 * never typed). Baked like a stack, so it is two draw calls with two materials
 * of its own: the leaf fades when it stands between the camera and her, and a
 * shared paint would fade every case in the room with it.
 *
 * Throws unless the leaf's own measured bounds are the wall case's
 * ({@link libraryBookcaseSize}) within 5 mm, with its origin on that edge: the
 * den's doorway, the leaf's two collider states and the books on it are all
 * laid out from the wall case's figures, and a twin of another size would leave
 * a slit beside the shut leaf or a leaf drawn through the wall.
 */
export function createLibrarySecretLeaf(): LibrarySecretLeaf {
  const size = libraryBookcaseSize('wall');
  const bounds = kitBounds(SECRET_SHELF_NODES);
  const parts = assemble('library.secretLeaf.parts', SECRET_SHELF_NODES);
  parts.position.set(-bounds.minX, -bounds.minY, -bounds.minZ);
  const source = new Group();
  source.add(parts);
  const baked = bakeModel(source);
  if (baked.glows.length > 0) throw new Error('libraryAssets: the secret leaf has a glowing part, whose shared paint its fader could not own');
  const root = new Group();
  root.name = 'library.secretLeaf';
  const body = bakedBodyMaterial();
  const bodyMesh = solid(new Mesh(baked.body, body));
  bodyMesh.name = 'library.secretLeaf.body';
  root.add(bodyMesh);
  const materials: Material[] = [body];
  if (baked.outline) {
    const outline = bakedOutlineMaterial();
    const shell = new Mesh(baked.outline, outline);
    shell.name = 'library.secretLeaf.outline';
    shell.renderOrder = -1;
    root.add(shell);
    materials.push(outline);
  }
  const plan = measurePlan(root);
  const off = Math.max(
    Math.abs(plan.minX),
    Math.abs(plan.minY),
    Math.abs(plan.minZ),
    Math.abs(plan.maxX - size.length),
    Math.abs(plan.maxY - size.height),
    Math.abs(plan.maxZ - size.depth),
  );
  if (off > SECRET_LEAF_TOLERANCE) {
    throw new Error(
      `libraryAssets: the secret leaf measures x ${plan.minX.toFixed(3)}..${plan.maxX.toFixed(3)}, y ${plan.minY.toFixed(3)}..${plan.maxY.toFixed(3)}, ` +
        `z ${plan.minZ.toFixed(3)}..${plan.maxZ.toFixed(3)} on its back-left edge, against the wall case's ${size.length.toFixed(3)} x ${size.height.toFixed(3)} x ` +
        `${size.depth.toFixed(3)} (${(off * 1000).toFixed(1)} mm off, ${(SECRET_LEAF_TOLERANCE * 1000).toFixed(0)} allowed): secretShelf-* is not the wall case any more`,
    );
  }
  return { root, size, materials };
}

// ---------------------------------------------------------------------------
// The reading room — books
// ---------------------------------------------------------------------------

/** One book shape, for instancing: the kit's six blocks, three heights by two thicknesses. */
export interface BookShape {
  readonly height: number;
  readonly thickness: number;
  readonly depth: number;
  readonly geometry: BufferGeometry;
}

const BOOK_NODES = ['book-tall-thin', 'book-tall-thick', 'book-mid-thin', 'book-mid-thick', 'book-short-thin', 'book-short-thick'] as const;

let bookShapes: readonly BookShape[] | null = null;

/**
 * The six book shapes, standing on their base, spine facing +Z, measured off
 * their own geometry. Shared: every book in the room is an instance of one.
 */
export function libraryBookShapes(): readonly BookShape[] {
  if (bookShapes) return bookShapes;
  bookShapes = BOOK_NODES.map((name) => {
    const box = kitBounds([name]);
    return { height: box.maxY - box.minY, thickness: box.maxX - box.minX, depth: box.maxZ - box.minZ, geometry: libraryPart(name).geometry };
  });
  return bookShapes;
}

/**
 * The books' colours, seeded per instance — bright spines from the park's own
 * palette, never a colour of the room's own (ART_DIRECTION §5).
 */
export const LIBRARY_BOOK_COLOURS: readonly number[] = [
  PALETTE.markerPink,
  PALETTE.markerMint,
  PALETTE.markerSky,
  PALETTE.markerLemon,
  PALETTE.markerLilac,
  PALETTE.flowerRed,
  PALETTE.flowerBlue,
  PALETTE.flowerViolet,
  PALETTE.buildingTrimDeep,
  PALETTE.slideChute,
  PALETTE.ballPitA,
  PALETTE.ballPitD,
  ART.castleTapestry,
  ART.snakeMint,
  ART.hothouseClay,
];

/**
 * The books' shared material. White is not a paint here but the identity of
 * three.js's instance colouring (`instanceColor` multiplies the material's
 * colour), so each book's spine is exactly its seeded `LIBRARY_BOOK_COLOURS`
 * entry.
 */
export function libraryBookMaterial(): Material {
  return paint({ colour: 0xffffff });
}

/**
 * **The shape a readable book is drawn in** (#718): the tallest of the kit's
 * books, and of the tallest the thickest — chosen by measuring them, never by
 * where a shape sits in {@link libraryBookShapes}' list, so the day the Artist
 * adds a taller book the readable ones grow with it. The biggest spine on the
 * shelf is the one a child can open.
 */
export function libraryShelfBookShape(): BookShape {
  const shapes = libraryBookShapes();
  const first = shapes[0];
  if (!first) throw new Error('libraryAssets: the kit has no book shapes to draw a readable book from');
  return shapes.reduce((best, shape) =>
    shape.height > best.height || (shape.height === best.height && shape.thickness > best.thickness) ? shape : best,
  first);
}

/**
 * A readable book's ink outline, metres: a small prop's (ART_DIRECTION §2).
 * The decorative books on the shelves draw none, so it is part of what makes
 * a readable one stand out.
 */
const SHELF_BOOK_OUTLINE = 0.012;

/**
 * **One readable book** (#718), its cover in `colour`: the
 * {@link libraryShelfBookShape}, standing on the middle of its base with its
 * spine facing +Z, like every book on the shelves.
 *
 * Unlike them it is a mesh of its own rather than an instance, in a paint of
 * its own whose emissive is its own colour at intensity 0 — so the owl's
 * recommendation can make exactly this book glow (#718, Step 6) and a stack can
 * fade it with itself — and with an ink outline. The outline is
 * `addSmoothOutline`'s: the kit's book has a hard edge at every corner (14 of
 * its 16 corners carry more than one normal, measured), and a plain inverted
 * hull pushed along split normals comes apart into separate flaps there.
 */
export function createShelfBook(colour: number): Mesh {
  const mesh = solid(new Mesh(libraryShelfBookShape().geometry, toonMaterial(colour, { emissive: colour, emissiveIntensity: 0 })));
  addSmoothOutline(mesh, SHELF_BOOK_OUTLINE);
  return mesh;
}

// ---------------------------------------------------------------------------
// The reading room — furniture
// ---------------------------------------------------------------------------

/** The librarian's desk: its long side across its front (+Z), its top at the kiosk counter's height. */
export function createLibraryDesk(): AssetHandle {
  const root = assemble('library.desk', ['desk-body', 'desk-top']);
  return { root, height: visibleBounds(root).top };
}

/** The desk's measured top and footprint, off the bare geometry. */
export function libraryDeskSize(): { readonly width: number; readonly depth: number; readonly top: number; readonly centreX: number; readonly centreZ: number } {
  const plan = kitBounds(['desk-body', 'desk-top']);
  return { width: plan.maxX - plan.minX, depth: plan.maxZ - plan.minZ, top: plan.maxY, centreX: (plan.minX + plan.maxX) / 2, centreZ: (plan.minZ + plan.maxZ) / 2 };
}

/** A reading armchair, sitter facing +Z, in `cloth` (its frame; the seat cushion keeps the table's colour). */
export function createLibraryArmchair(cloth: number): AssetHandle {
  const root = assemble('library.armchair', ['armchair-frame', 'armchair-seat', 'armchair-feet'], { 'armchair-frame': cloth });
  return { root, height: visibleBounds(root).top };
}

/**
 * The chair's measured seat height and footprint, off the bare geometry: the
 * seat cushion's top (#715's contract puts it at `KID_HIP_HEIGHT`, the one
 * height where her feet reach the floor) and the whole chair's plan, with its
 * centre — the chair is deeper behind its origin than in front of it.
 *
 * `seatCentre` is the middle of the seat cushion itself, in the chair's own
 * frame (sitter facing +Z): where a sitter's hips go — the owl's perch on the
 * story chair at story time (#718). Measured off the seat part alone, never
 * the whole chair's plan, whose middle is pulled back by the chair's back.
 */
export function libraryArmchairSize(): {
  readonly seat: number;
  readonly seatCentre: { readonly x: number; readonly z: number };
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly centreX: number;
  readonly centreZ: number;
} {
  const plan = kitBounds(['armchair-frame', 'armchair-seat', 'armchair-feet']);
  const seat = kitBounds(['armchair-seat']);
  return {
    seat: seat.maxY,
    seatCentre: { x: (seat.minX + seat.maxX) / 2, z: (seat.minZ + seat.maxZ) / 2 },
    width: plan.maxX - plan.minX,
    depth: plan.maxZ - plan.minZ,
    height: plan.maxY,
    centreX: (plan.minX + plan.maxX) / 2,
    centreZ: (plan.minZ + plan.maxZ) / 2,
  };
}

/**
 * One solid part of the armchair, chair-local: its middle, half-extents across
 * (x) and back-to-front (z), its top, and how much of that top she could stand
 * on (`kitTop`'s measure; omitted, all of it).
 */
export interface ArmchairPart {
  readonly centreX: number;
  readonly centreZ: number;
  readonly halfX: number;
  readonly halfZ: number;
  readonly top: number;
  readonly topHalf?: number;
}

/**
 * **The armchair as the solids she meets** — measured off the kit's own
 * vertices: the seat cushion to its top (first), and the frame round it (an
 * arm either side, the back behind) each to its own. One box over the whole chair at the
 * seat's height stood her 0.3 m deep in an arm wherever she stood on its edge
 * (`check:solids`, 17 Oct 2026). The parts tile the chair's plan, so it is the
 * one solid it was, stepped.
 */
export function libraryArmchairParts(): readonly ArmchairPart[] {
  const plan = kitBounds(['armchair-frame', 'armchair-seat', 'armchair-feet']);
  const seat = kitBounds(['armchair-seat']);
  // The frame over a part of the plan: its top, and the crown of it a foot
  // could stand on — a rolled arm's tube, the back's roll (PR #722: these
  // were `ledge: false`, never stood on whatever they measured).
  const frameOver = (minX: number, maxX: number, minZ: number, maxZ: number): ArmchairPart => {
    const measured = kitTop(['armchair-frame'], (x, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ);
    return { ...box(minX, maxX, minZ, maxZ, measured.top), topHalf: measured.topHalf };
  };
  const box = (minX: number, maxX: number, minZ: number, maxZ: number, top: number): ArmchairPart => ({
    centreX: (minX + maxX) / 2,
    centreZ: (minZ + maxZ) / 2,
    halfX: (maxX - minX) / 2,
    halfZ: (maxZ - minZ) / 2,
    top,
  });
  // Where the back stands: the arms and the seat begin where the frame over
  // an arm is no taller than the arm's own crown (measured over its front
  // half, clear of the back) — found by halving, because the back leans and
  // its front face is not one z. Split at the seat's back instead, the back's
  // ends reached into the arms and stood them 1.1 m tall, where the roll is
  // 0.72.
  const overArm = (fromZ: number): number => kitTop(['armchair-frame'], (x, z) => x < seat.minX && z >= fromZ).top;
  const armCrest = overArm((seat.minZ + plan.maxZ) / 2);
  let behind = plan.minZ;
  let clear = (seat.minZ + plan.maxZ) / 2;
  for (let i = 0; i < 16; i += 1) {
    const mid = (behind + clear) / 2;
    if (overArm(mid) > armCrest + 0.01) behind = mid;
    else clear = mid;
  }
  const backFront = clear;
  return [
    box(seat.minX, seat.maxX, backFront, plan.maxZ, seat.maxY),
    frameOver(plan.minX, seat.minX, backFront, plan.maxZ),
    frameOver(seat.maxX, plan.maxX, backFront, plan.maxZ),
    frameOver(plan.minX, plan.maxX, plan.minZ, backFront),
  ];
}

export interface LampHandle extends AssetHandle {
  /** The middle of the glowing shade, local — where its light's pool is hung. */
  readonly bulb: Vector3;
}

/** A lamp's measured footprint radius, height and the middle of its shade. */
function lampFigures(nodes: readonly string[], shade: string): { readonly radius: number; readonly height: number; readonly bulb: Vector3; readonly shadeRadius: number } {
  const all = kitBounds(nodes);
  const lit = kitBounds([shade]);
  return {
    radius: Math.max(-all.minX, all.maxX, -all.minZ, all.maxZ),
    height: all.maxY,
    bulb: new Vector3((lit.minX + lit.maxX) / 2, (lit.minY + lit.maxY) / 2, (lit.minZ + lit.maxZ) / 2),
    shadeRadius: Math.max(-lit.minX, lit.maxX, -lit.minZ, lit.maxZ),
  };
}

const FLOOR_LAMP = ['floorLamp-base', 'floorLamp-stem', 'floorLamp-shade'] as const;
const READING_LAMP = ['readingLamp-stem', 'readingLamp-shade'] as const;

/** A floor lamp, its shade glowing. */
export function createLibraryFloorLamp(): LampHandle {
  const root = assemble('library.floorLamp', FLOOR_LAMP);
  return { root, height: visibleBounds(root).top, bulb: lampFigures(FLOOR_LAMP, 'floorLamp-shade').bulb };
}

/** The floor lamp's measured figures: the widest it is about its own foot, and how tall. */
export function libraryFloorLampSize(): { readonly radius: number; readonly height: number; readonly topHalf: number } {
  const figures = lampFigures(FLOOR_LAMP, 'floorLamp-shade');
  // Its crown is its finial: as much of its top as a foot could stand on.
  return { radius: figures.radius, height: figures.height, topHalf: kitTop(FLOOR_LAMP).topHalf };
}

/** A reading lamp for a side table or the desk, its shade glowing. */
export function createLibraryReadingLamp(): LampHandle {
  const root = assemble('library.readingLamp', READING_LAMP);
  return { root, height: visibleBounds(root).top, bulb: lampFigures(READING_LAMP, 'readingLamp-shade').bulb };
}

/** The reading lamp's measured figures: the widest it reaches about its own foot (its shade leans out), and how tall. */
export function libraryReadingLampSize(): { readonly radius: number; readonly height: number; readonly topHalf: number } {
  const figures = lampFigures(READING_LAMP, 'readingLamp-shade');
  // Its crown is its finial (PR #722, round three: stood on, the disc's
  // shade-wide top put her 0.17 m over the drawn lamp on the nook table).
  return { radius: figures.radius, height: figures.height, topHalf: kitTop(READING_LAMP).topHalf };
}

/** A round side table — this file's own piece: a top at a reading lamp's comfortable height beside a chair. */
export function createLibrarySideTable(): AssetHandle {
  const root = new Group();
  root.name = 'library.sideTable';
  const topY = 0.6;
  const top = ownPart('table-top', new CylinderGeometry(0.4, 0.4, 0.07, 20), OWN.tableWood);
  top.position.y = topY - 0.035;
  const leg = ownPart('table-leg', new CylinderGeometry(0.07, 0.09, topY - 0.07, 10), OWN.tableWood);
  leg.position.y = (topY - 0.07) / 2;
  const foot = ownPart('table-foot', new CylinderGeometry(0.24, 0.26, 0.05, 16), OWN.tableWood);
  foot.position.y = 0.025;
  root.add(top, leg, foot);
  return { root, height: visibleBounds(root).top };
}

/** The side table's measured top and radius. */
export function librarySideTableSize(): { readonly top: number; readonly radius: number } {
  const plan = measurePlan(createLibrarySideTable().root);
  return { top: plan.maxY, radius: Math.max(plan.maxX - plan.minX, plan.maxZ - plan.minZ) / 2 };
}

/**
 * A rug — this file's own piece: a rounded rectangle with a border, flat on the
 * floor. The story rug is pink with a sunny border; the doormat inside the way
 * out is cream with a sky-blue one.
 */
export function createLibraryRug(width: number, depth: number, kind: 'story' | 'doormat' = 'story'): AssetHandle {
  const root = new Group();
  root.name = kind === 'story' ? 'library.rug' : 'library.doormat';
  const [fieldStyle, borderStyle] = kind === 'story' ? [OWN.rugField, OWN.rugBorder] : [OWN.doormatField, OWN.doormatBorder];
  // A border a quarter of a metre wide on the story rug, half that on a doormat.
  const rim = Math.min(0.25, Math.min(width, depth) / 8);
  const border = decal(ownPart('rug-border', new RoundedBoxGeometry(width, 0.02, depth, 2, 0.009), borderStyle));
  border.position.y = 0.01;
  const field = decal(ownPart('rug-field', new RoundedBoxGeometry(width - rim * 2, 0.02, depth - rim * 2, 2, 0.009), fieldStyle));
  field.position.y = 0.03;
  root.add(border, field);
  return { root, height: visibleBounds(root).top };
}

/** A wall sconce — this file's own piece: a backplate, an arm and a glowing cup. Its back on z 0, facing +Z. */
export function createLibrarySconce(): LampHandle {
  const root = new Group();
  root.name = 'library.sconce';
  root.add(boxAt('sconce-plate', OWN.sconceMetal, 0.26, 0.4, 0.06, 0, -0.2, 0.03, 0.02));
  const arm = ownPart('sconce-arm', new CylinderGeometry(0.04, 0.04, 0.3, 8), OWN.sconceMetal);
  arm.rotation.x = Math.PI / 2; // flat-ok: the sconce's arm laid along its own +Z, object-local in the unplaced model
  arm.position.set(0, 0, 0.2);
  const cup = ownPart('sconce-shade', new CylinderGeometry(0.16, 0.1, 0.22, 14), OWN.sconceShade);
  cup.position.set(0, 0.06, 0.36);
  root.add(arm, cup);
  const shade = measurePlan(root, (name) => name === 'sconce-shade');
  return { root, height: visibleBounds(root).top, bulb: new Vector3((shade.minX + shade.maxX) / 2, (shade.minY + shade.maxY) / 2, (shade.minZ + shade.maxZ) / 2) };
}

// ---------------------------------------------------------------------------
// Baking — a model's parts into a handful of draw calls
// ---------------------------------------------------------------------------

/**
 * **A model, baked**: every painted part merged into one geometry carrying
 * its paint as vertex colour, every outline into one more, and each glow
 * colour into its own (a glow is an emissive material, which a vertex colour
 * cannot carry). A bookcase of two parts and two outlines becomes two draw
 * calls, which is what lets the reading room hold forty of them.
 */
export interface BakedModel {
  readonly body: BufferGeometry;
  readonly outline: BufferGeometry | null;
  /** Each self-lit colour, with how strongly it glows — a lamp's shade, or a softly lit doormat. */
  readonly glows: readonly { readonly colour: number; readonly intensity: number; readonly geometry: BufferGeometry }[];
}

function coloured(geometry: BufferGeometry, transform: Matrix4, colour: Color): BufferGeometry {
  const flat = (geometry.index ? geometry.toNonIndexed() : geometry.clone()).applyMatrix4(transform);
  for (const name of Object.keys(flat.attributes)) if (name !== 'position' && name !== 'normal') flat.deleteAttribute(name);
  const count = flat.getAttribute('position').count;
  const colours = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colours[i * 3] = colour.r;
    colours[i * 3 + 1] = colour.g;
    colours[i * 3 + 2] = colour.b;
  }
  flat.setAttribute('color', new Float32BufferAttribute(colours, 3));
  return flat;
}

export function bakeModel(root: Object3D): BakedModel {
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const bodies: BufferGeometry[] = [];
  const outlines: BufferGeometry[] = [];
  const glows = new Map<string, { colour: number; intensity: number; list: BufferGeometry[] }>();
  root.traverse((node) => {
    if (!(node instanceof Mesh) || !node.visible) return;
    const transform = new Matrix4().multiplyMatrices(toRoot, node.matrixWorld);
    const material = node.material as Material;
    if (material instanceof MeshBasicMaterial && material.side === BackSide) {
      outlines.push(coloured(node.geometry, transform, material.color));
      return;
    }
    if (material instanceof MeshToonMaterial && material.emissive.getHex() !== 0) {
      const hex = material.color.getHex();
      const key = `${hex}:${material.emissiveIntensity}`;
      const glow = glows.get(key) ?? { colour: hex, intensity: material.emissiveIntensity, list: [] };
      glow.list.push(coloured(node.geometry, transform, material.color));
      glows.set(key, glow);
      return;
    }
    const colour = (material as Material & { color?: Color }).color ?? new Color(PALETTE.ink);
    bodies.push(coloured(node.geometry, transform, colour));
  });
  const merge = (list: BufferGeometry[]): BufferGeometry => {
    const merged = mergeGeometries(list, false);
    if (!merged) throw new Error('libraryAssets: a model would not merge');
    merged.computeBoundingSphere();
    return merged;
  };
  return {
    body: merge(bodies),
    outline: outlines.length > 0 ? merge(outlines) : null,
    glows: [...glows.values()].map(({ colour, intensity, list }) => ({ colour, intensity, geometry: merge(list) })),
  };
}

/**
 * The baked parts' materials: a white toon body under the vertex colours
 * (white being the identity of the multiply, not a paint), and the outlines'
 * back-face shell, both fresh per call so a model that fades can own its
 * opacity.
 */
export function bakedBodyMaterial(): MeshToonMaterial {
  const material = toonMaterial(0xffffff);
  material.vertexColors = true;
  return material;
}

export function bakedOutlineMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: BackSide });
}

/** A glow part's material, shared by colour and strength: a lamp's full glow, or a softer lift. */
export function bakedGlowMaterial(colour: number, intensity: number): Material {
  return paint(intensity >= 0.9 ? { colour, glow: true } : { colour, lift: intensity });
}

/** Every bookcase kind, baked once. */
const bakedCases = new Map<BookcaseKind, BakedModel>();
export function libraryBookcaseBaked(kind: BookcaseKind): BakedModel {
  let baked = bakedCases.get(kind);
  if (!baked) {
    baked = bakeModel(buildBookcase(kind));
    bakedCases.set(kind, baked);
  }
  return baked;
}
