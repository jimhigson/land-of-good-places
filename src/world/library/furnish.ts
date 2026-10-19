import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type BufferAttribute,
  type Material,
  type MeshBasicMaterial,
  type MeshToonMaterial,
  type Object3D,
} from 'three';
import { Rng, damp } from '../../core/mathUtils';
import { PALETTE } from '../../core/palette';
import { ART } from '../../art/style/artPalette';
import {
  bakeModel,
  bakedBodyMaterial,
  bakedGlowMaterial,
  bakedOutlineMaterial,
  createLibraryArmchair,
  createLibraryCushion,
  createLibraryDesk,
  createLibraryFloorLamp,
  createLibraryReadingLamp,
  createLibraryRug,
  createLibrarySconce,
  createLibrarySecretBookcase,
  createLibrarySideTable,
  createShelfBook,
  libraryArmchairParts,
  libraryBookcaseBaked,
  libraryBookcaseSize,
  libraryBookMaterial,
  libraryBookShapes,
  libraryCushionSize,
  libraryDeskSize,
  libraryFloorLampSize,
  libraryReadingLampSize,
  libraryShelfBookShape,
  librarySideTableSize,
  LIBRARY_BOOK_COLOURS,
  type BakedModel,
  type BookShape,
  type BookcaseKind,
  type LampHandle,
} from '../../art/models/libraryAssets';
import { KID_REACH_HEIGHT } from '../../art/models/kid';
import type { LibraryProps } from './props';
import type { PoolSpot } from './lighting';
import { SHELF_BOOKS, type ShelfBook } from './shelfBooks';
import {
  LIBRARY_BOOKCASES,
  LIBRARY_DOOR_HALF,
  LIBRARY_FURNITURE,
  LIBRARY_READABLE_SLOTS,
  LIBRARY_SCONCE_HEIGHT,
  type BookcaseSpec,
  type FurnitureSpec,
  type LocalPoint,
} from './layout';

/**
 * **Furnishing the reading room** from `layout.ts`'s tables: every bookcase,
 * every book, every chair and lamp, each registered solid through
 * `LibraryProps` in the same call that draws it.
 *
 * ## Draw calls, because there are forty bookcases and thousands of books
 *
 * - The wall cases and the low bins never move or fade, so each kind is **one
 *   `InstancedMesh`** of its baked model (`libraryAssets.ts`'s `bakeModel`:
 *   every part merged, its paint carried as vertex colour) plus one for its
 *   outlines; their books are **one `InstancedMesh` per book shape**, coloured
 *   per instance from a seeded `Rng` (never `Math.random`).
 * - The free-standing stacks fade when one stands between the camera and her
 *   ({@link StackFader}), so each owns its materials: one baked mesh, one
 *   outline, and one book `InstancedMesh` of its own.
 * - Furniture is baked per piece: two or three draw calls a chair.
 */

/** A seed for the decoration, so the same room is built on every load. */
const BOOK_SEED = 0x11b7a7;

/** How far a book's spine stands back from the front edge of the board it stands on. */
const SPINE_INSET = 0.01;
/**
 * The gap at each end of a row of books, between the last spine and the side
 * panel: a finger's width, and clear of the panel's ink outline by more than
 * `check:coplanar`'s near-plane centimetre, so no book's side shares a plane
 * with the case's hull.
 */
const ROW_END_GAP = 0.05;

/** The gap left on a shelf for a readable book's slot (#718), either side of its middle. */
const SLOT_HALF = 0.1;

/**
 * **How far a readable book (#718) stands proud of its row, at most**, metres:
 * its spine this far in front of the row's spines, so a child spots it. "At
 * most" because the whole book stays inside its case's drawn front
 * ({@link readableProud}): drawn implies solid, and the case's collider stops
 * at that face.
 */
export const READABLE_PROUD = 0.03;

/**
 * **How far a readable book leans out of its row**, radians, about the middle
 * of its base: its top towards her — the plainest "this one is different" a
 * shelf can say — and the front edge of its base a centimetre down into the
 * board, where nobody can see it.
 */
export const READABLE_LEAN = 0.1;

/** Room-local: a case's or a piece's transform. */
function placement(x: number, y: number, z: number, facingDegrees: number): Matrix4 {
  return new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (facingDegrees * Math.PI) / 180), // flat-ok: room-local yaw in the library's own flat space at (-600, -600), off the sphere
    new Vector3(1, 1, 1),
  );
}

/** Where a case stands: a wall or low case's middle is half its depth out from the wall point. */
export function bookcaseCentre(spec: BookcaseSpec): LocalPoint {
  if (spec.kind === 'stack') return spec.at;
  const depth = libraryBookcaseSize(spec.kind).depth;
  const yaw = (spec.facing * Math.PI) / 180;
  return { x: spec.at.x + Math.sin(yaw) * (depth / 2), z: spec.at.z + Math.cos(yaw) * (depth / 2) };
}

/**
 * **Every readable book within her reach** (#718's twelve): the slot's shelf
 * top, measured off the drawn case, at or under `KID_REACH_HEIGHT` — how far a
 * child's hand reaches above the floor — or the build throws. A shelf the
 * Artist moves up cannot quietly put a book out of her hand.
 */
export function assertReadableSlotsInReach(): void {
  const problems: string[] = [];
  for (const slot of LIBRARY_READABLE_SLOTS) {
    const spec = LIBRARY_BOOKCASES.find((candidate) => candidate.id === slot.bookcase);
    if (!spec) {
      problems.push(`readable slot ${slot.index + 1} names no case '${slot.bookcase}'`);
      continue;
    }
    const top = libraryBookcaseSize(spec.kind).shelfTops[slot.shelf];
    if (top === undefined) problems.push(`readable slot ${slot.index + 1} is on shelf ${slot.shelf} of ${slot.bookcase}, which has no such shelf`);
    else if (top > KID_REACH_HEIGHT) {
      problems.push(`readable slot ${slot.index + 1} (${slot.bookcase}, shelf ${slot.shelf}) stands at ${top.toFixed(3)} m, over her reach (${KID_REACH_HEIGHT} m)`);
    }
  }
  if (problems.length > 0) throw new Error(`Library: a readable book she cannot reach:\n  - ${problems.join('\n  - ')}`);
}

/** One book: its shape, colour and transform in its case's own frame. */
interface PlacedBook {
  readonly shape: number;
  readonly colour: number;
  readonly matrix: Matrix4;
}

/**
 * The books on one face of one case, in the case's own frame (front +Z).
 * `back` puts them on the far face, spines out the other way.
 */
function shelveFace(spec: BookcaseSpec, back: boolean, rng: Rng, shapes: readonly BookShape[]): PlacedBook[] {
  const size = libraryBookcaseSize(spec.kind);
  const books: PlacedBook[] = [];
  const spineZ = size.boardFront - SPINE_INSET;
  const slots = back ? [] : LIBRARY_READABLE_SLOTS.filter((slot) => slot.bookcase === spec.id);
  size.shelfTops.forEach((shelfY, shelf) => {
    const clear = size.shelfClear[shelf] ?? 0;
    const fits = shapes.map((shape, index) => ({ shape, index })).filter(({ shape }) => shape.height <= clear - 0.04);
    if (fits.length === 0) return;
    const gaps = slots.filter((slot) => slot.shelf === shelf).map((slot) => [slot.along - SLOT_HALF, slot.along + SLOT_HALF] as const);
    let x = -size.innerHalf + ROW_END_GAP;
    const end = size.innerHalf - ROW_END_GAP;
    while (x < end) {
      // Now and then a short gap, so a shelf reads as books rather than a wall of colour.
      if (rng.chance(0.06)) {
        x += rng.range(0.06, 0.18);
        continue;
      }
      const pick = rng.pick(fits);
      const t = pick.shape.thickness;
      if (x + t > end) break;
      const centre = x + t / 2;
      if (gaps.some(([from, to]) => centre + t / 2 > from && centre - t / 2 < to)) {
        x += 0.02;
        continue;
      }
      const matrix = new Matrix4().compose(
        new Vector3(centre, shelfY, back ? -spineZ + pick.shape.depth / 2 : spineZ - pick.shape.depth / 2),
        new Quaternion(),
        new Vector3(1, 1, 1),
      );
      books.push({ shape: pick.index, colour: rng.pick(LIBRARY_BOOK_COLOURS), matrix });
      x += t + 0.004;
    }
  });
  return books;
}

/**
 * How far the leaning readable book reaches from the middle of its base,
 * measured off the shape's own vertices turned by {@link READABLE_LEAN}:
 * forward (+Z, out of the case), up, and down (negative: into the board).
 */
function leaningReach(): { readonly forward: number; readonly top: number; readonly bottom: number } {
  const shape = libraryShelfBookShape();
  const lean = new Matrix4().makeRotationX(READABLE_LEAN);
  const position = shape.geometry.getAttribute('position') as BufferAttribute;
  const point = new Vector3();
  let forward = -Infinity;
  let top = -Infinity;
  let bottom = Infinity;
  for (let i = 0; i < position.count; i += 1) {
    point.fromBufferAttribute(position, i).applyMatrix4(lean);
    forward = Math.max(forward, point.z);
    top = Math.max(top, point.y);
    bottom = Math.min(bottom, point.y);
  }
  return { forward, top, bottom };
}

/**
 * **How far a readable book stands proud of its row on a case of this kind**:
 * {@link READABLE_PROUD}, or less if the lean would carry its top past the
 * case's drawn front — the face the case's collider stops at — so no part of a
 * book she can see stands where she could walk. Measured: the row's spines,
 * the book's depth, the case's front, the lean's reach.
 *
 * Measured on 16 Oct 2026 off the kit's wall case and stack alike: the case's
 * front stands 6 cm in front of the row's spines and the lean carries the
 * book's top 4.1 cm forward, so a book stands 1.9 cm proud at its base and its
 * top meets the case's front face. Throws if a case leaves no room at all: a
 * readable book must stand at least as far out as its row.
 */
function readableProud(kind: BookcaseKind): number {
  const size = libraryBookcaseSize(kind);
  const shape = libraryShelfBookShape();
  const spine = size.boardFront - SPINE_INSET;
  const room = size.depth / 2 - (spine - shape.depth / 2) - leaningReach().forward;
  if (room < 0) {
    throw new Error(
      `Library: a readable book leaning ${READABLE_LEAN} rad cannot stay inside a ${kind} case: its top would stand ${(-room).toFixed(3)} m past the case's front even level with its row`,
    );
  }
  return Math.min(READABLE_PROUD, room);
}

/**
 * **A readable book on its shelf** (#718), in its case's own frame (front
 * +Z): `slot.along` across, its base on the slot's board, its spine
 * {@link readableProud} in front of the row's, leaning {@link READABLE_LEAN}.
 * `shelveFace` left the gap for it ({@link SLOT_HALF} either side), and the
 * build throws if the book does not fit there — through a side panel, or
 * through the board above.
 */
function shelfBookMesh(entry: ShelfBook, spec: BookcaseSpec): Mesh {
  const size = libraryBookcaseSize(spec.kind);
  const shape = libraryShelfBookShape();
  const shelfY = size.shelfTops[entry.slot.shelf];
  const clear = size.shelfClear[entry.slot.shelf];
  const where = `'${entry.book.id}' (readable slot ${entry.slot.index + 1}, ${spec.id} shelf ${entry.slot.shelf})`;
  if (shelfY === undefined || clear === undefined) throw new Error(`Library: ${where} names a shelf the case does not have`);
  const reach = leaningReach();
  if (reach.top >= clear) throw new Error(`Library: ${where} stands ${reach.top.toFixed(3)} m tall leaning, but the board above is ${clear.toFixed(3)} m over it`);
  if (Math.abs(entry.slot.along) + shape.thickness / 2 > size.innerHalf) {
    throw new Error(`Library: ${where} is ${entry.slot.along} m along, through the case's side (${size.innerHalf.toFixed(3)} m from its middle)`);
  }
  if (shape.thickness / 2 >= SLOT_HALF) throw new Error(`Library: ${where} is ${shape.thickness.toFixed(3)} m thick, wider than the gap its row leaves (${(SLOT_HALF * 2).toFixed(2)} m)`);
  const mesh = createShelfBook(PALETTE[entry.book.cover]);
  mesh.name = `library.book.${entry.book.id}`;
  const outline = mesh.children[0];
  if (outline) outline.name = `${mesh.name}.outline`;
  mesh.position.set(entry.slot.along, shelfY, size.boardFront - SPINE_INSET - shape.depth / 2 + readableProud(spec.kind));
  mesh.rotation.x = READABLE_LEAN;
  return mesh;
}

/**
 * One case's books as a single `InstancedMesh`: every shape is the first
 * book's geometry scaled to its own measured size, so one case is one draw
 * call — the stacks fade and the secret shelf swings, so each owns its books.
 */
function bookInstances(books: readonly PlacedBook[], shapes: readonly BookShape[], material: Material): InstancedMesh {
  const base = shapes[0]!;
  const instanced = new InstancedMesh(base.geometry, material, books.length);
  const scaled = new Matrix4();
  const colour = new Color();
  books.forEach((book, index) => {
    const shape = shapes[book.shape]!;
    scaled.makeScale(shape.thickness / base.thickness, shape.height / base.height, shape.depth / base.depth).premultiply(book.matrix);
    instanced.setMatrixAt(index, scaled);
    instanced.setColorAt(index, colour.setHex(book.colour));
  });
  instanced.instanceMatrix.needsUpdate = true;
  if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
  instanced.computeBoundingSphere();
  return instanced;
}

/**
 * **A free-standing stack that gets out of the way.** The fixed camera looks
 * down from +X+Z at 38 degrees, so a 3.2 m case hides about four metres of
 * floor behind it, and the aisles between the stacks are exactly that floor.
 * When the line from her to the camera passes through a stack, the stack
 * eases to translucent; when it clears, back to solid — FoliageFade's trees,
 * for bookcases.
 */
export class StackFader {
  readonly id: string;
  readonly group: Group;
  readonly centre: LocalPoint;
  readonly facing: number;
  readonly halfLength: number;
  readonly halfDepth: number;
  readonly height: number;
  private readonly materials: (MeshToonMaterial | MeshBasicMaterial | Material)[];
  private alphaNow = 1;

  constructor(id: string, group: Group, centre: LocalPoint, facing: number, size: { length: number; depth: number; height: number }, materials: Material[]) {
    this.id = id;
    this.group = group;
    this.centre = centre;
    this.facing = facing;
    this.halfLength = size.length / 2;
    this.halfDepth = size.depth / 2;
    this.height = size.height;
    this.materials = materials;
  }

  get alpha(): number {
    return this.alphaNow;
  }

  /**
   * Does the line from a room-local point up to the camera pass through this
   * case (grown by `margin`)? The slab test in the case's own frame.
   */
  hides(from: Vector3, camera: Vector3, margin = 0.35): boolean {
    const yaw = (this.facing * Math.PI) / 180;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const local = (p: Vector3): [number, number, number] => {
      const dx = p.x - this.centre.x;
      const dz = p.z - this.centre.z;
      return [dx * cos - dz * sin, p.y, dx * sin + dz * cos];
    };
    const a = local(from);
    const b = local(camera);
    const lo = [-this.halfLength - margin, 0, -this.halfDepth - margin];
    const hi = [this.halfLength + margin, this.height + margin, this.halfDepth + margin];
    let enter = 0;
    let exit = 1;
    for (let axis = 0; axis < 3; axis += 1) {
      const start = a[axis]!;
      const delta = b[axis]! - start;
      if (Math.abs(delta) < 1e-9) {
        if (start < lo[axis]! || start > hi[axis]!) return false;
        continue;
      }
      const t1 = (lo[axis]! - start) / delta;
      const t2 = (hi[axis]! - start) / delta;
      enter = Math.max(enter, Math.min(t1, t2));
      exit = Math.min(exit, Math.max(t1, t2));
      if (enter > exit) return false;
    }
    return true;
  }

  /** Ease towards `target` opacity. */
  fadeTowards(target: number, dt: number): void {
    if (this.alphaNow === target) return;
    const next = damp(this.alphaNow, target, 0.09, dt);
    this.setAlpha(Math.abs(next - target) < 1e-3 ? target : next);
  }

  setAlpha(alpha: number): void {
    const wasOpaque = this.alphaNow >= 0.999;
    this.alphaNow = alpha;
    const opaque = alpha >= 0.999;
    for (const material of this.materials) {
      material.opacity = alpha;
      if (opaque !== wasOpaque) {
        material.transparent = !opaque;
        material.depthWrite = opaque;
        material.needsUpdate = true;
      }
    }
  }
}

/** One readable book (#718) as furnished: its book and slot (`shelfBooks.ts`'s pairing), and what was drawn. */
export interface FurnishedShelfBook extends ShelfBook {
  /**
   * `library.book.<bookId>`, its outline `library.book.<bookId>.outline`: in a
   * stack, under the stack's group (it fades with the stack); on a wall case,
   * under the room with its case's transform composed.
   */
  readonly mesh: Mesh;
  /** Its own paint, nobody else's — the recommendation's glow (#718, Step 6) lights exactly this book. */
  readonly material: MeshToonMaterial;
  /** Where the mesh's origin — the middle of the book's base — stands, room-local. */
  readonly local: LocalPoint;
}

/** What furnishing the room hands back. */
export interface Furnished {
  readonly stacks: readonly StackFader[];
  readonly pools: readonly PoolSpot[];
  readonly bookCount: number;
  /** Every placed piece's drawn group, by layout id — for the checks to measure against its collider. */
  readonly pieces: ReadonlyMap<string, Object3D>;
  /** The readable books (#718), in `SHELF_BOOKS`' order: one per `BOOKS` entry. */
  readonly shelfBooks: readonly FurnishedShelfBook[];
}

/** The cloth of each chair's frame and each cushion — the park's own bright colours, a different one each; the storyteller's chair the castle's tapestry red. */
const CHAIR_CLOTH: Readonly<Record<string, number>> = {
  'story-chair': ART.castleTapestry,
  'story-armchair-west': PALETTE.markerLilac,
  'story-armchair-east': PALETTE.markerMint,
  'nook-armchair': PALETTE.markerSky,
  'east-armchair': PALETTE.markerPink,
};
const CUSHION_CLOTH = [PALETTE.markerLemon, PALETTE.markerMint, PALETTE.markerSky, PALETTE.markerPink, PALETTE.markerLilac] as const;

/** The story rug's drawn size. */
const RUG_WIDTH = 7;
const RUG_DEPTH = 4.4;
/** How deep the doormat inside the way out is. */
const DOORMAT_DEPTH = 1.2;

export function furnishReadingRoom(root: Group, props: LibraryProps): Furnished {
  assertReadableSlotsInReach();
  const rng = new Rng(BOOK_SEED);
  const shapes = libraryBookShapes();
  const bodyMaterial = bakedBodyMaterial();
  const outlineMaterial = bakedOutlineMaterial();
  const pieces = new Map<string, Object3D>();

  /** A baked model's meshes, under `group`, with the given body/outline materials. */
  const addBaked = (group: Group, baked: BakedModel, body: Material, outline: Material): void => {
    const mesh = new Mesh(baked.body, body);
    mesh.name = `${group.name}.body`;
    group.add(mesh);
    if (baked.outline) {
      const shell = new Mesh(baked.outline, outline);
      shell.name = `${group.name}.outline`;
      shell.renderOrder = -1;
      group.add(shell);
    }
    for (const glow of baked.glows) {
      const lit = new Mesh(glow.geometry, bakedGlowMaterial(glow.colour, glow.intensity));
      lit.name = `${group.name}.glow`;
      group.add(lit);
    }
  };

  // ------------------------------------------------------------ bookcases
  const fixedMatrices = new Map<BookcaseKind, Matrix4[]>();
  const fixedBooks: { shape: number; colour: number; matrix: Matrix4 }[] = [];
  const stacks: StackFader[] = [];
  const shelved = new Map<number, FurnishedShelfBook>();
  let bookCount = 0;
  for (const spec of LIBRARY_BOOKCASES) {
    const size = libraryBookcaseSize(spec.kind);
    const centre = bookcaseCentre(spec);
    const transform = placement(centre.x, 0, centre.z, spec.facing);
    props.box(`bookcase ${spec.id}`, { x: centre.x, z: centre.z, facing: spec.facing, halfLength: size.length / 2, halfDepth: size.depth / 2 }, size.height);
    const books = [...shelveFace(spec, false, rng, shapes), ...(spec.kind === 'stack' ? shelveFace(spec, true, rng, shapes) : [])];
    bookCount += books.length;
    // The readable books standing in this case's gaps (#718), each in its own
    // case-local place; where each goes in the scene is the case kind's own.
    const readable = SHELF_BOOKS.filter((entry) => entry.slot.bookcase === spec.id).map((entry) => {
      const mesh = shelfBookMesh(entry, spec);
      const at = mesh.position.clone().applyMatrix4(transform);
      const placed: FurnishedShelfBook = { ...entry, mesh, material: mesh.material as MeshToonMaterial, local: { x: at.x, z: at.z } };
      shelved.set(entry.slot.index, placed);
      return placed;
    });
    if (spec.secret && readable.length > 0) {
      // The secret shelf swings open (#719), so a book on it would have to
      // ride its door; and the gold book a child pulls there is the one book
      // on that case that does something. Neither is decided for a readable
      // book, so one is never quietly put there.
      throw new Error(`Library: readable book(s) ${readable.map((placed) => `'${placed.book.id}'`).join(', ')} stand on the secret shelf ${spec.id}, which swings open`);
    }
    if (spec.secret) {
      // The secret shelf (#719) is drawn from the kit's hinge-origin twin, its
      // books on its own door so they swing with it. Closed, it stands exactly
      // where an ordinary case would.
      const secret = createLibrarySecretBookcase();
      secret.root.name = `library.secret.${spec.id}`;
      secret.root.applyMatrix4(transform);
      const instanced = bookInstances(books, shapes, libraryBookMaterial());
      instanced.position.copy(secret.offset).negate();
      secret.door.add(instanced);
      root.add(secret.root);
      pieces.set(spec.id, secret.root);
      continue;
    }
    if (spec.kind !== 'stack') {
      const list = fixedMatrices.get(spec.kind) ?? [];
      list.push(transform);
      fixedMatrices.set(spec.kind, list);
      for (const book of books) fixedBooks.push({ ...book, matrix: new Matrix4().multiplyMatrices(transform, book.matrix) });
      // A wall case never fades: its readable books stand in the room itself.
      for (const placed of readable) {
        placed.mesh.applyMatrix4(transform);
        root.add(placed.mesh);
      }
      continue;
    }
    // A stack: its own materials, so it can fade on its own.
    const group = new Group();
    group.name = `library.stack.${spec.id}`;
    group.applyMatrix4(transform);
    const body = bakedBodyMaterial();
    const outline = bakedOutlineMaterial();
    addBaked(group, libraryBookcaseBaked('stack'), body, outline);
    const bookMaterial = libraryBookMaterial().clone();
    const instanced = bookInstances(books, shapes, bookMaterial);
    instanced.name = `${group.name}.books`;
    group.add(instanced);
    // Its readable books ride its group and fade with it, ink outlines and all:
    // a book left solid in a stack gone glassy would float in the air.
    const fading: Material[] = [body, outline, bookMaterial];
    for (const placed of readable) {
      group.add(placed.mesh);
      placed.mesh.traverse((part) => {
        if (part instanceof Mesh) fading.push(part.material as Material);
      });
    }
    root.add(group);
    pieces.set(spec.id, group);
    stacks.push(new StackFader(spec.id, group, centre, spec.facing, size, fading));
  }
  for (const [kind, matrices] of fixedMatrices) {
    const baked = libraryBookcaseBaked(kind);
    const cases = new InstancedMesh(baked.body, bodyMaterial, matrices.length);
    cases.name = `library.cases.${kind}`;
    matrices.forEach((matrix, index) => cases.setMatrixAt(index, matrix));
    cases.instanceMatrix.needsUpdate = true;
    cases.computeBoundingSphere();
    root.add(cases);
    if (baked.outline) {
      const shells = new InstancedMesh(baked.outline, outlineMaterial, matrices.length);
      shells.name = `library.cases.${kind}.outline`;
      shells.renderOrder = -1;
      matrices.forEach((matrix, index) => shells.setMatrixAt(index, matrix));
      shells.instanceMatrix.needsUpdate = true;
      shells.computeBoundingSphere();
      root.add(shells);
    }
  }
  shapes.forEach((shape, index) => {
    const mine = fixedBooks.filter((book) => book.shape === index);
    if (mine.length === 0) return;
    const instanced = new InstancedMesh(shape.geometry, libraryBookMaterial(), mine.length);
    instanced.name = `library.books.${index}`;
    const colour = new Color();
    mine.forEach((book, i) => {
      instanced.setMatrixAt(i, book.matrix);
      instanced.setColorAt(i, colour.setHex(book.colour));
    });
    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    instanced.computeBoundingSphere();
    root.add(instanced);
  });

  // ------------------------------------------------------------ furniture
  const pools: PoolSpot[] = [];
  const desk = LIBRARY_FURNITURE.find((piece) => piece.kind === 'desk');
  const deskSize = libraryDeskSize();
  const tables = LIBRARY_FURNITURE.filter((piece) => piece.kind === 'sideTable');
  const tableSize = librarySideTableSize();
  const lampSize = libraryReadingLampSize();
  const on = (a: LocalPoint, b: LocalPoint): boolean => Math.hypot(a.x - b.x, a.z - b.z) < 0.05;
  /** A reading lamp stands on whatever it is placed over: a side table, or the desk. */
  const standsOn = (piece: FurnitureSpec): number => {
    if (tables.some((table) => on(table.at, piece.at))) return tableSize.top;
    if (desk && Math.abs(piece.at.x - desk.at.x) <= deskSize.width / 2 && Math.abs(piece.at.z - desk.at.z) <= deskSize.depth / 2) return deskSize.top;
    return 0;
  };
  /** A model's own-frame point carried to a spot and turned with it. */
  const turned = (piece: FurnitureSpec, x: number, z: number): LocalPoint => {
    const yaw = (piece.facing * Math.PI) / 180;
    return { x: piece.at.x + x * Math.cos(yaw) + z * Math.sin(yaw), z: piece.at.z - x * Math.sin(yaw) + z * Math.cos(yaw) };
  };
  /** Bake a model and stand it at a spot; a lamp marked `pool` hangs its light in the middle of its glowing shade. */
  const place = (piece: FurnitureSpec, model: Object3D, y: number, lamp?: LampHandle): void => {
    const group = new Group();
    group.name = `library.${piece.id}`;
    addBaked(group, bakeModel(model), bodyMaterial, outlineMaterial);
    group.applyMatrix4(placement(piece.at.x, y, piece.at.z, piece.facing));
    root.add(group);
    pieces.set(piece.id, group);
    if (piece.pool && lamp) {
      const at = lamp.bulb.clone().applyMatrix4(placement(piece.at.x, y, piece.at.z, piece.facing));
      pools.push({ id: piece.id, x: at.x, y: at.y, z: at.z });
    }
  };

  let cushion = 0;
  for (const piece of LIBRARY_FURNITURE) {
    switch (piece.kind) {
      case 'desk': {
        place(piece, createLibraryDesk().root, 0);
        const centre = turned(piece, deskSize.centreX, deskSize.centreZ);
        props.box('the desk', { x: centre.x, z: centre.z, facing: piece.facing, halfLength: deskSize.width / 2, halfDepth: deskSize.depth / 2 }, deskSize.top);
        break;
      }
      case 'armchair':
      case 'storyChair': {
        const cloth = CHAIR_CLOTH[piece.id] ?? PALETTE.markerPink;
        place(piece, createLibraryArmchair(cloth).root, 0);
        // Its seat to the cushion, and its arms and back each to its own top,
        // tiling the chair's drawn plan (`libraryArmchairParts`): she sits and
        // stands on the seat; the rolled arms and the back's roll measure too
        // narrow a crown for her feet, so the width rule has her bump them.
        for (const part of libraryArmchairParts()) {
          const centre = turned(piece, part.centreX, part.centreZ);
          props.box(piece.id, { x: centre.x, z: centre.z, facing: piece.facing, halfLength: part.halfX, halfDepth: part.halfZ }, part.top, part.topHalf);
        }
        break;
      }
      case 'floorLamp': {
        const lamp = createLibraryFloorLamp();
        place(piece, lamp.root, 0, lamp);
        const size = libraryFloorLampSize();
        props.disc(piece.id, piece.at.x, piece.at.z, size.radius, size.height, size.topHalf);
        break;
      }
      case 'readingLamp': {
        const lamp = createLibraryReadingLamp();
        const base = standsOn(piece);
        place(piece, lamp.root, base, lamp);
        // Solid like everything drawn: a jump onto the desk, or over a side
        // table, meets the lamp on it. Its crown is its finial's point, so
        // nothing lands on it (its measured top width, `topHalf`).
        props.disc(piece.id, piece.at.x, piece.at.z, lampSize.radius, base + lampSize.height, lampSize.topHalf);
        break;
      }
      case 'sideTable': {
        place(piece, createLibrarySideTable().root, 0);
        // The table's own top; a lamp on it is its own solid
        // (`readingLamp`, above), so the tabletop round the lamp's foot is
        // somewhere to land and the lamp is something to bump.
        props.disc(piece.id, piece.at.x, piece.at.z, tableSize.radius, tableSize.top);
        break;
      }
      case 'rug': {
        place(piece, createLibraryRug(RUG_WIDTH, RUG_DEPTH).root, 0);
        break;
      }
      case 'doormat': {
        // As wide as the doorway less a hand's breadth each side, and deep
        // enough to read from across the room.
        place(piece, createLibraryRug(LIBRARY_DOOR_HALF * 2 - 0.4, DOORMAT_DEPTH, 'doormat').root, 0);
        break;
      }
      case 'cushion': {
        place(piece, createLibraryCushion(CUSHION_CLOTH[cushion % CUSHION_CLOTH.length]!).root, 0);
        cushion += 1;
        const size = libraryCushionSize();
        // Solid, like everything she can see: a cushion is a low soft lump to
        // hop onto, not a floor with no body.
        props.disc(piece.id, piece.at.x, piece.at.z, size.radius, size.top);
        break;
      }
      case 'sconce': {
        const sconce = createLibrarySconce();
        place(piece, sconce.root, LIBRARY_SCONCE_HEIGHT, sconce);
        break;
      }
    }
  }
  const shelfBooks = SHELF_BOOKS.map((entry) => {
    const placed = shelved.get(entry.slot.index);
    if (!placed) throw new Error(`Library: readable book '${entry.book.id}' names case '${entry.slot.bookcase}', which the room does not build`);
    return placed;
  });
  return { stacks, pools, bookCount, pieces, shelfBooks };
}

