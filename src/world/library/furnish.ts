import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
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
  createLibrarySideTable,
  libraryArmchairSize,
  libraryBookcaseBaked,
  libraryBookcaseSize,
  libraryBookMaterial,
  libraryBookShapes,
  libraryCushionSize,
  libraryDeskSize,
  measurePlan,
  LIBRARY_BOOK_COLOURS,
  type BakedModel,
  type BookShape,
  type BookcaseKind,
} from '../../art/models/libraryAssets';
import type { LibraryProps } from './props';
import type { PoolSpot } from './lighting';
import {
  LIBRARY_BOOKCASES,
  LIBRARY_FURNITURE,
  LIBRARY_READABLE_SLOTS,
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

/** How far a book's spine stands back from its case's front edge. */
const SPINE_INSET = 0.04;
/** The gap left on a shelf for a readable book's slot (#718), either side of its middle. */
const SLOT_HALF = 0.1;

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
  const spineZ = size.depth / 2 - SPINE_INSET;
  const slots = back ? [] : LIBRARY_READABLE_SLOTS.filter((slot) => slot.bookcase === spec.id);
  size.shelfTops.forEach((shelfY, shelf) => {
    const clear = size.shelfClear[shelf] ?? 0;
    const fits = shapes.map((shape, index) => ({ shape, index })).filter(({ shape }) => shape.height <= clear - 0.04);
    if (fits.length === 0) return;
    const gaps = slots.filter((slot) => slot.shelf === shelf).map((slot) => [slot.along - SLOT_HALF, slot.along + SLOT_HALF] as const);
    let x = -size.innerHalf + 0.03;
    const end = size.innerHalf - 0.03;
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

/** What furnishing the room hands back. */
export interface Furnished {
  readonly stacks: readonly StackFader[];
  readonly pools: readonly PoolSpot[];
  readonly bookCount: number;
  /** Every placed piece's drawn group, by layout id — for the checks to measure against its collider. */
  readonly pieces: ReadonlyMap<string, Object3D>;
}

/** The cloth of each chair and cushion — the park's own bright colours, a different one each. */
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

export function furnishReadingRoom(root: Group, props: LibraryProps): Furnished {
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
      const lit = new Mesh(glow.geometry, bakedGlowMaterial(glow.colour));
      lit.name = `${group.name}.glow`;
      group.add(lit);
    }
  };

  // ------------------------------------------------------------ bookcases
  const fixedMatrices = new Map<BookcaseKind, Matrix4[]>();
  const fixedBooks: { shape: number; colour: number; matrix: Matrix4 }[] = [];
  const stacks: StackFader[] = [];
  let bookCount = 0;
  for (const spec of LIBRARY_BOOKCASES) {
    const size = libraryBookcaseSize(spec.kind);
    const centre = bookcaseCentre(spec);
    const transform = placement(centre.x, 0, centre.z, spec.facing);
    props.box(`bookcase ${spec.id}`, { x: centre.x, z: centre.z, facing: spec.facing, halfLength: size.length / 2, halfDepth: size.depth / 2 }, size.height);
    const books = [...shelveFace(spec, false, rng, shapes), ...(spec.kind === 'stack' ? shelveFace(spec, true, rng, shapes) : [])];
    bookCount += books.length;
    if (spec.kind !== 'stack') {
      const list = fixedMatrices.get(spec.kind) ?? [];
      list.push(transform);
      fixedMatrices.set(spec.kind, list);
      for (const book of books) fixedBooks.push({ ...book, matrix: new Matrix4().multiplyMatrices(transform, book.matrix) });
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
    const base = shapes[0]!;
    const instanced = new InstancedMesh(base.geometry, bookMaterial, books.length);
    instanced.name = `${group.name}.books`;
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
    group.add(instanced);
    root.add(group);
    pieces.set(spec.id, group);
    stacks.push(new StackFader(spec.id, group, centre, spec.facing, size, [body, outline, bookMaterial]));
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
  const tableTop = measurePlan(createLibrarySideTable().root).maxY;
  /** A reading lamp stands on whatever it is placed over: a side table, or the desk. */
  const standsOn = (piece: FurnitureSpec): number => {
    if (tables.some((table) => Math.hypot(table.at.x - piece.at.x, table.at.z - piece.at.z) < 0.05)) return tableTop;
    if (desk && Math.abs(piece.at.x - desk.at.x) <= deskSize.width / 2 && Math.abs(piece.at.z - desk.at.z) <= deskSize.depth / 2) return deskSize.top;
    return 0;
  };
  /** Bake a model, stand it at a spot, and say where its bulb ended up. */
  const place = (piece: FurnitureSpec, model: Object3D, y: number, bulbName?: string): void => {
    const group = new Group();
    group.name = `library.${piece.id}`;
    addBaked(group, bakeModel(model), bodyMaterial, outlineMaterial);
    group.applyMatrix4(placement(piece.at.x, y, piece.at.z, piece.facing));
    root.add(group);
    pieces.set(piece.id, group);
    if (piece.pool && bulbName) {
      let bulb: Object3D | undefined;
      model.traverse((node) => {
        if (node.name === bulbName) bulb = node;
      });
      if (!bulb) throw new Error(`Library: ${piece.id}'s model has no '${bulbName}' to hang its light on`);
      model.updateMatrixWorld(true);
      const at = new Vector3().setFromMatrixPosition(bulb.matrixWorld).applyMatrix4(placement(piece.at.x, y, piece.at.z, piece.facing));
      pools.push({ id: piece.id, x: at.x, y: at.y, z: at.z });
    }
  };

  let cushion = 0;
  for (const piece of LIBRARY_FURNITURE) {
    switch (piece.kind) {
      case 'desk': {
        place(piece, createLibraryDesk().root, 0);
        props.box('the desk', { x: piece.at.x, z: piece.at.z, facing: piece.facing, halfLength: deskSize.width / 2, halfDepth: deskSize.depth / 2 }, deskSize.top);
        break;
      }
      case 'armchair':
      case 'storyChair': {
        const big = piece.kind === 'storyChair';
        const cloth = CHAIR_CLOTH[piece.id] ?? PALETTE.markerPink;
        const model = createLibraryArmchair(cloth, big).root;
        place(piece, model, 0);
        const plan = measurePlan(model);
        const seat = libraryArmchairSize(big).seat;
        props.box(piece.id, { x: piece.at.x, z: piece.at.z, facing: piece.facing, halfLength: (plan.maxX - plan.minX) / 2, halfDepth: (plan.maxZ - plan.minZ) / 2 }, seat);
        break;
      }
      case 'floorLamp': {
        const lamp = createLibraryFloorLamp();
        place(piece, lamp.root, 0, 'lamp-bulb');
        const plan = measurePlan(lamp.root);
        props.disc(piece.id, piece.at.x, piece.at.z, (plan.maxX - plan.minX) / 2, lamp.height, { stand: false });
        break;
      }
      case 'readingLamp': {
        place(piece, createLibraryReadingLamp().root, standsOn(piece), 'reading-lamp-bulb');
        break;
      }
      case 'sideTable': {
        const table = createLibrarySideTable().root;
        place(piece, table, 0);
        const plan = measurePlan(table);
        // A lamp stands on it, so its top is not a floor.
        props.disc(piece.id, piece.at.x, piece.at.z, (plan.maxX - plan.minX) / 2, plan.maxY, { stand: false });
        break;
      }
      case 'rug': {
        place(piece, createLibraryRug(RUG_WIDTH, RUG_DEPTH).root, 0);
        break;
      }
      case 'cushion': {
        place(piece, createLibraryCushion(CUSHION_CLOTH[cushion % CUSHION_CLOTH.length]!).root, 0);
        cushion += 1;
        const size = libraryCushionSize();
        props.soft(size.top, piece.at.x, piece.at.z, size.radius);
        break;
      }
      case 'sconce': {
        place(piece, createLibrarySconce().root, piece.y ?? 3.9, 'sconce-bulb');
        break;
      }
    }
  }
  return { stacks, pools, bookCount, pieces };
}

