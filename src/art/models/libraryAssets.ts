import {
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  Shape,
  SphereGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../../core/palette';
import { ART } from '../style/artPalette';
import { addOutline, decal, markShared, solid, toonMaterial, type ToonOptions } from '../style/materials';
import { visiblePoints } from '../style/measure';
import type { AssetHandle } from '../style/asset';
import { COUNTER_TOP_Y } from '../../world/building/shops/stallShape';
import {
  LIBRARY_CELLA_BACK_Z,
  LIBRARY_CELLA_FRONT_Z,
  LIBRARY_CELLA_HALF_X,
  LIBRARY_COLUMN_XS,
  LIBRARY_COLUMN_Z,
  LIBRARY_DOOR_HEIGHT,
  LIBRARY_DOOR_WIDTH,
  LIBRARY_PLINTH_HALF_X,
  LIBRARY_PLINTH_HALF_Z,
  LIBRARY_PLINTH_TOP,
  LIBRARY_RECESS_BACK_Z,
  LIBRARY_STEP_RISE,
  LIBRARY_STEP_TREAD,
} from '../../world/library/layout';

/**
 * **The Library's models** (#716) — the building and everything that
 * furnishes its reading room.
 *
 * ## Primitives today, the 3D Artist's `library.glb` tomorrow — one file swaps
 *
 * The real meshes are being authored headless in Blender on `art/library-715`
 * (#715, `art/blend/library_build.py`), with an asserted `CONTRACT`: shell
 * 18 x 14 x 12 m, plinth 0.36 m, steps 0.18 m risers, columns 1.2 m across to
 * 7.0 m, shelf 4.0 x 0.6 x 3.2 m, desk 3.0 x 1.0 m at the kiosk counter's
 * height, lamps 0.7 / 2.4 m, armchair seat 0.55 m, books 0.42 / 0.36 / 0.30 m
 * tall, 0.06 / 0.09 m thick, 0.26 m deep. Until those bytes exist, everything
 * here is built from three.js primitives **at exactly those sizes**, behind
 * the same factory functions the glb will sit behind — `castleAssets.ts` is
 * the shape this file grows into.
 *
 * **Nothing outside this file types a model's size.** Every collider, plate,
 * keep-out clearance and book row the room builds is measured off the model
 * this file returns ({@link measurePlan}, {@link libraryBookcaseSize}, …),
 * so when the glb lands the swap is this file and nothing else: the colliders
 * follow the new mesh, and the numbers typed below for the primitives go with
 * them. The one exception is the exterior's plan, which the park needs before
 * any mesh exists — `world/library/layout.ts` owns those literals and the
 * primitives below are built from them; `Library.ts` measures the drawn
 * exterior and throws if it disagrees, which is the check that keeps the glb
 * honest when it replaces these.
 *
 * Shape only lives in the model; colour and outline are this file's
 * ({@link STYLE}), exactly `castleAssets.ts`'s split.
 */

// ---------------------------------------------------------------------------
// Dressing — the one place a library colour is chosen
// ---------------------------------------------------------------------------

/** A part's paint. From `PALETTE` or `ART` only (ART_DIRECTION §5). */
interface PartStyle {
  readonly colour: number;
  readonly outline?: number;
  /** Self-lit: a lamp's shade, the doorway's glow. Casts and catches nothing. */
  readonly glow?: true;
}

const STYLE = {
  plinth: { colour: PALETTE.stoneGreyLight, outline: 0.03 },
  step: { colour: PALETTE.stoneGrey, outline: 0.03 },
  cella: { colour: PALETTE.buildingWall, outline: 0.03 },
  column: { colour: PALETTE.signBoard, outline: 0.03 },
  columnTrim: { colour: PALETTE.stoneGreyLight, outline: 0.025 },
  entablature: { colour: PALETTE.buildingWall, outline: 0.03 },
  frieze: { colour: PALETTE.markerSky, outline: 0.02 },
  pediment: { colour: PALETTE.buildingWall, outline: 0.03 },
  roof: { colour: PALETTE.markerLilac, outline: 0.03 },
  bookCover: { colour: PALETTE.markerSky, outline: 0.02 },
  bookPages: { colour: PALETTE.signBoard, outline: 0.015 },
  doorFrame: { colour: PALETTE.woodDark, outline: 0.02 },
  doorGlow: { colour: PALETTE.fairyWarm, glow: true },
  windowGlow: { colour: PALETTE.buildingWindowWarm, glow: true },
  shelfFrame: { colour: PALETTE.woodDark, outline: 0.02 },
  shelfBoard: { colour: PALETTE.wood },
  shelfBack: { colour: PALETTE.barkDark },
  deskBody: { colour: PALETTE.wood, outline: 0.02 },
  deskTop: { colour: PALETTE.woodLight, outline: 0.018 },
  deskTrim: { colour: PALETTE.markerSky, outline: 0.012 },
  chairWood: { colour: PALETTE.woodDark, outline: 0.016 },
  lampMetal: { colour: ART.castleIron, outline: 0.01 },
  lampShade: { colour: PALETTE.fairyWarm, glow: true },
  bulb: { colour: PALETTE.buildingWindowWarm, glow: true },
  tableWood: { colour: PALETTE.wood, outline: 0.014 },
  rug: { colour: PALETTE.markerPink },
  rugBorder: { colour: PALETTE.flowerYellow },
} satisfies Record<string, PartStyle>;

/** One material per style, shared by every part painted with it. */
const materials = new Map<string, Material>();
function paint(style: PartStyle): Material {
  const key = `${style.colour}:${style.glow ? 'glow' : 'toon'}`;
  let material = materials.get(key);
  if (!material) {
    const options: ToonOptions = style.glow ? { emissive: style.colour, emissiveIntensity: 0.9 } : {};
    material = markShared(toonMaterial(style.colour, options));
    materials.set(key, material);
  }
  return material;
}

/** A part: its geometry, painted, outlined and shadowed by its style. */
function part(name: string, geometry: BufferGeometry, style: PartStyle): Mesh {
  const mesh = new Mesh(geometry, paint(style));
  mesh.name = name;
  if (style.glow) decal(mesh);
  else solid(mesh);
  if (style.outline) addOutline(mesh, style.outline);
  return mesh;
}

/** A rounded box, chunky-toy edges — ART_DIRECTION's "no sharp edges". */
function roundedBox(width: number, height: number, depth: number, radius = 0.05): BufferGeometry {
  const r = Math.min(radius, width / 2 - 1e-3, height / 2 - 1e-3, depth / 2 - 1e-3);
  return new RoundedBoxGeometry(width, height, depth, 3, Math.max(r, 0.001));
}

/** A rounded box with its base at y 0 (or at `base`), centred on X and Z there. */
function boxAt(name: string, style: PartStyle, w: number, h: number, d: number, x: number, base: number, z: number, radius?: number): Mesh {
  const mesh = part(name, roundedBox(w, h, d, radius), style);
  mesh.position.set(x, base + h / 2, z);
  return mesh;
}

// ---------------------------------------------------------------------------
// Measuring — every size the room needs is read off the model
// ---------------------------------------------------------------------------

/** A model's extent in its own frame. */
export interface PlanBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Every visible vertex's extent, `root`'s own frame — `visiblePoints`, never a bounding box. */
export function measurePlan(root: Object3D, only?: (name: string) => boolean): PlanBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const measure = (node: Object3D): void => {
    visiblePoints(
      node,
      (p) => {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      },
      root,
    );
  };
  if (only) {
    root.traverse((node) => {
      if (node !== root && node instanceof Mesh && only(node.name)) measure(node);
    });
  } else {
    measure(root);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

// ---------------------------------------------------------------------------
// The exterior — plinth, steps, six fat columns, entablature, pediment
// ---------------------------------------------------------------------------

export interface LibraryExterior {
  readonly root: Group;
  /** The warm glow at the back of the doorway: the reading room's lamplight showing through. */
  readonly doorGlow: Mesh;
  /** The two tall front windows' glow, brighter after dark. */
  readonly windows: readonly Mesh[];
}

/** The cella's walls stand from the plinth top to the entablature. */
const WALL_TOP = 7;
const ENTABLATURE_TOP = 8.2;
const ROOF_RIDGE = 11.7;
const ROOF_THICKNESS = 0.32;
/** The plinth and step reach this far below the ground, so the sphere's fall never shows a gap under them. */
const SKIRT = 1.2;
/** The front wall's thickness, and the jambs'. */
const FRONT_WALL_DEPTH = 0.5;

/** The arched doorway's outline, for the front wall's cut-out: a rectangle under a half circle. */
function archedWall(halfWidth: number, height: number, doorHalf: number, doorTop: number): Shape {
  const springing = doorTop - doorHalf;
  const shape = new Shape();
  shape.moveTo(-halfWidth, 0);
  shape.lineTo(-doorHalf, 0);
  shape.lineTo(-doorHalf, springing);
  shape.absarc(0, springing, doorHalf, Math.PI, 0, true);
  shape.lineTo(doorHalf, 0);
  shape.lineTo(halfWidth, 0);
  shape.lineTo(halfWidth, height);
  shape.lineTo(-halfWidth, height);
  shape.closePath();
  return shape;
}

/** An arched window's or doorway's glowing fill: the same arch, closed at the bottom. */
function archShape(halfWidth: number, top: number): Shape {
  const springing = top - halfWidth;
  const shape = new Shape();
  shape.moveTo(-halfWidth, 0);
  shape.lineTo(-halfWidth, springing);
  shape.absarc(0, springing, halfWidth, Math.PI, 0, true);
  shape.lineTo(halfWidth, 0);
  shape.closePath();
  return shape;
}

export function createLibraryExterior(): LibraryExterior {
  const root = new Group();
  root.name = 'library.exterior';
  const halfX = LIBRARY_PLINTH_HALF_X;
  const halfZ = LIBRARY_PLINTH_HALF_Z;
  const stepBack = halfZ - LIBRARY_STEP_TREAD;

  // The plinth and its full-width lower step, both reaching down past the
  // ground so the planet's curve never opens a gap under a corner.
  root.add(
    boxAt('library-plinth', STYLE.plinth, halfX * 2, LIBRARY_PLINTH_TOP + SKIRT, halfZ + stepBack, 0, -SKIRT, (stepBack - halfZ) / 2, 0.08),
    boxAt('library-step', STYLE.step, halfX * 2, LIBRARY_STEP_RISE + SKIRT, LIBRARY_STEP_TREAD, 0, -SKIRT, halfZ - LIBRARY_STEP_TREAD / 2, 0.06),
  );

  // The cella. The door's recess is a tunnel through the front of it, so the
  // walls are four blocks round that tunnel: the hall behind its back wall,
  // the two flanks either side of it, and the lintel over it. The front wall,
  // cut with the arched doorway, stands across the front of all four.
  const doorHalf = LIBRARY_DOOR_WIDTH / 2;
  const wallHeight = WALL_TOP - LIBRARY_PLINTH_TOP;
  const flankFront = LIBRARY_CELLA_FRONT_Z - FRONT_WALL_DEPTH;
  const flankDepth = flankFront - LIBRARY_RECESS_BACK_Z;
  const hallDepth = LIBRARY_RECESS_BACK_Z - LIBRARY_CELLA_BACK_Z;
  const flankWidth = LIBRARY_CELLA_HALF_X - doorHalf;
  root.add(
    boxAt('library-cella', STYLE.cella, LIBRARY_CELLA_HALF_X * 2, wallHeight, hallDepth, 0, LIBRARY_PLINTH_TOP, LIBRARY_CELLA_BACK_Z + hallDepth / 2, 0.1),
    boxAt('library-cella-flank-west', STYLE.cella, flankWidth, wallHeight, flankDepth, -(doorHalf + flankWidth / 2), LIBRARY_PLINTH_TOP, LIBRARY_RECESS_BACK_Z + flankDepth / 2, 0.02),
    boxAt('library-cella-flank-east', STYLE.cella, flankWidth, wallHeight, flankDepth, doorHalf + flankWidth / 2, LIBRARY_PLINTH_TOP, LIBRARY_RECESS_BACK_Z + flankDepth / 2, 0.02),
    boxAt(
      'library-cella-lintel',
      STYLE.cella,
      doorHalf * 2,
      WALL_TOP - LIBRARY_PLINTH_TOP - LIBRARY_DOOR_HEIGHT,
      flankDepth,
      0,
      LIBRARY_PLINTH_TOP + LIBRARY_DOOR_HEIGHT,
      LIBRARY_RECESS_BACK_Z + flankDepth / 2,
      0.02,
    ),
  );
  const front = part(
    'library-front-wall',
    new ExtrudeGeometry(archedWall(LIBRARY_CELLA_HALF_X, wallHeight, doorHalf, LIBRARY_DOOR_HEIGHT), {
      depth: FRONT_WALL_DEPTH,
      bevelEnabled: false,
      curveSegments: 16,
    }),
    STYLE.cella,
  );
  front.position.set(0, LIBRARY_PLINTH_TOP, flankFront);
  root.add(front);
  // The door frame: a chunky wooden surround just proud of the wall.
  const frame = part(
    'library-door-frame',
    new ExtrudeGeometry(archedWall(doorHalf + 0.28, LIBRARY_DOOR_HEIGHT + 0.28, doorHalf, LIBRARY_DOOR_HEIGHT), {
      depth: 0.12,
      bevelEnabled: false,
      curveSegments: 16,
    }),
    STYLE.doorFrame,
  );
  frame.position.set(0, LIBRARY_PLINTH_TOP, LIBRARY_CELLA_FRONT_Z);
  root.add(frame);
  // The lamplight at the back of the doorway — the room inside, showing.
  const glow = part('library-door-glow', new ExtrudeGeometry(archShape(doorHalf, LIBRARY_DOOR_HEIGHT), { depth: 0.05, bevelEnabled: false, curveSegments: 16 }), STYLE.doorGlow);
  // A hair in front of the hall's own face, so the two never share a plane.
  glow.position.set(0, LIBRARY_PLINTH_TOP, LIBRARY_RECESS_BACK_Z + 0.004);
  root.add(glow);

  // Two tall arched windows, between the outer columns' lines.
  const windows: Mesh[] = [];
  for (const side of [-1, 1]) {
    const window = part(`library-window-${side < 0 ? 'west' : 'east'}`, new ExtrudeGeometry(archShape(0.75, 3.4), { depth: 0.06, bevelEnabled: false, curveSegments: 12 }), STYLE.windowGlow);
    window.position.set(side * 5.6, LIBRARY_PLINTH_TOP + 1.4, LIBRARY_CELLA_FRONT_Z + 0.005);
    root.add(window);
    windows.push(window);
  }

  // Six fat columns: a chunky base, a fat shaft, a cushion capital.
  const shaftBottom = LIBRARY_PLINTH_TOP + 0.34;
  const shaftTop = WALL_TOP - 0.42;
  LIBRARY_COLUMN_XS.forEach((x, i) => {
    // The base is round, so the disc that is its collider is its drawn edge.
    const base = part(`library-column-base-${i + 1}`, new CylinderGeometry(0.75, 0.75, 0.34, 24), STYLE.columnTrim);
    base.position.set(x, LIBRARY_PLINTH_TOP + 0.17, LIBRARY_COLUMN_Z);
    const shaft = part(`library-column-${i + 1}`, new CylinderGeometry(0.56, 0.6, shaftTop - shaftBottom, 20), STYLE.column);
    shaft.position.set(x, (shaftBottom + shaftTop) / 2, LIBRARY_COLUMN_Z);
    const capital = boxAt(`library-column-capital-${i + 1}`, STYLE.columnTrim, 1.5, 0.42, 1.5, x, shaftTop, LIBRARY_COLUMN_Z, 0.12);
    root.add(base, shaft, capital);
  });

  // The entablature over the columns and the cella, with a sky-blue frieze band.
  const entFront = LIBRARY_COLUMN_Z + 0.8;
  const entBack = LIBRARY_CELLA_BACK_Z - 0.1;
  root.add(
    boxAt('library-entablature', STYLE.entablature, halfX * 2, ENTABLATURE_TOP - WALL_TOP, entFront - entBack, 0, WALL_TOP, (entFront + entBack) / 2, 0.08),
    boxAt('library-frieze', STYLE.frieze, halfX * 2 - 0.6, 0.36, 0.06, 0, WALL_TOP + 0.4, entFront + 0.02, 0.02),
  );

  // The pediment: a low triangle on the front, and the roof's two slopes behind it.
  const pedimentHeight = ROOF_RIDGE - ENTABLATURE_TOP - 0.3;
  const triangle = new Shape();
  triangle.moveTo(-halfX + 0.2, 0);
  triangle.lineTo(halfX - 0.2, 0);
  triangle.lineTo(0, pedimentHeight);
  triangle.closePath();
  const pediment = part('library-pediment', new ExtrudeGeometry(triangle, { depth: 0.6, bevelEnabled: false }), STYLE.pediment);
  pediment.position.set(0, ENTABLATURE_TOP, entFront - 0.6);
  root.add(pediment);
  const slope = Math.atan2(ROOF_RIDGE - ENTABLATURE_TOP, halfX);
  const slabLength = Math.hypot(halfX, ROOF_RIDGE - ENTABLATURE_TOP);
  for (const side of [-1, 1]) {
    const roof = part(`library-roof-${side < 0 ? 'west' : 'east'}`, roundedBox(slabLength, ROOF_THICKNESS, entFront - entBack, 0.08), STYLE.roof);
    roof.position.set((side * halfX) / 2, (ENTABLATURE_TOP + ROOF_RIDGE) / 2 - ROOF_THICKNESS / 2, (entFront + entBack) / 2 - 0.05);
    roof.rotation.z = side * -slope;
    root.add(roof);
  }

  // The book carved in the pediment: an open book, two covers and two page blocks.
  const book = new Group();
  book.name = 'library-book-relief';
  for (const side of [-1, 1]) {
    const cover = part(`library-book-cover-${side < 0 ? 'west' : 'east'}`, roundedBox(1.5, 1.1, 0.12, 0.05), STYLE.bookCover);
    cover.position.set(side * 0.74, 0, 0);
    cover.rotation.y = side * 0.18;
    const pages = part(`library-book-pages-${side < 0 ? 'west' : 'east'}`, roundedBox(1.36, 0.96, 0.12, 0.04), STYLE.bookPages);
    pages.position.set(side * 0.72, 0.02, 0.09);
    pages.rotation.y = side * 0.18;
    book.add(cover, pages);
  }
  book.position.set(0, ENTABLATURE_TOP + 1.1, entFront + 0.08);
  root.add(book);

  return { root, doorGlow: glow, windows };
}

/**
 * **The drawn exterior's plan, measured** — what `Library.ts` asserts the
 * layout's plan-time literals against, and the colliders are built from.
 */
export interface LibraryExteriorPlan {
  /** The plinth's own extent, step included: x half-width, the back, the step's front. */
  readonly plinthHalfX: number;
  readonly plinthBackZ: number;
  readonly stepFrontZ: number;
  /** The plinth's walkable top and the step's. */
  readonly plinthTop: number;
  readonly stepTop: number;
  /** The cella's outer faces (the front wall's face included). */
  readonly cellaHalfX: number;
  readonly cellaBackZ: number;
  readonly cellaFrontZ: number;
  /** The doorway's clear half-width and how deep its recess runs. */
  readonly doorHalf: number;
  readonly recessBackZ: number;
  /** Each column's base footprint: the widest thing at a child's height. */
  readonly columns: readonly { readonly x: number; readonly z: number; readonly radius: number }[];
  /** The furthest any drawn vertex stands from the centre, in plan. */
  readonly reach: number;
  /** The tallest drawn point. */
  readonly height: number;
}

export function measureLibraryExterior(exterior: LibraryExterior): LibraryExteriorPlan {
  const root = exterior.root;
  const plinth = measurePlan(root, (name) => name === 'library-plinth' || name === 'library-step');
  const plinthTop = measurePlan(root, (name) => name === 'library-plinth').maxY;
  const step = measurePlan(root, (name) => name === 'library-step');
  const cella = measurePlan(root, (name) => name.startsWith('library-cella') || name === 'library-front-wall');
  const recess = measurePlan(root, (name) => name === 'library-door-glow');
  const columns = LIBRARY_COLUMN_XS.map((_, i) => {
    const base = measurePlan(root, (name) => name === `library-column-base-${i + 1}`);
    return {
      x: (base.minX + base.maxX) / 2,
      z: (base.minZ + base.maxZ) / 2,
      // The base is round: its collider is its drawn edge, not a metre more
      // ("generous-light", hotel/place.ts).
      radius: Math.max(base.maxX - base.minX, base.maxZ - base.minZ) / 2,
    };
  });
  let reach = 0;
  let height = 0;
  visiblePoints(root, (p) => {
    reach = Math.max(reach, Math.hypot(p.x, p.z));
    height = Math.max(height, p.y);
  });
  return {
    plinthHalfX: Math.max(-plinth.minX, plinth.maxX),
    plinthBackZ: plinth.minZ,
    stepFrontZ: step.maxZ,
    plinthTop,
    stepTop: step.maxY,
    cellaHalfX: Math.max(-cella.minX, cella.maxX),
    cellaBackZ: cella.minZ,
    cellaFrontZ: cella.maxZ,
    doorHalf: (recess.maxX - recess.minX) / 2,
    recessBackZ: recess.minZ,
    columns,
    reach,
    height,
  };
}

// ---------------------------------------------------------------------------
// The reading room — bookcases
// ---------------------------------------------------------------------------

export type BookcaseKind = 'wall' | 'low' | 'stack';

/** A bookcase unit, measured: how long, deep and tall, and where its books stand. */
export interface BookcaseSize {
  readonly length: number;
  readonly depth: number;
  readonly height: number;
  /** Each shelf's top surface, metres up: books stand on these. */
  readonly shelfTops: readonly number[];
  /** The clear height above each shelf, to the next board up. */
  readonly shelfClear: readonly number[];
  /** Half the clear width between the side panels: a row of books fits in it. */
  readonly innerHalf: number;
}

/** The primitives' contract sizes — the art contract's shelf, and the low bins the room adds. */
const CASE_LENGTH = 4;
const CASE_DEPTH = 0.6;
const PANEL = 0.12;
const BOARD = 0.06;
const SHELF_SPEC: Record<BookcaseKind, { readonly height: number; readonly shelves: readonly number[] }> = {
  // Five shelves to 3.2 m; the bottom board on a plinth, the top under the crown.
  wall: { height: 3.2, shelves: [0.12, 0.7, 1.28, 1.86, 2.44] },
  stack: { height: 3.2, shelves: [0.12, 0.7, 1.28, 1.86, 2.44] },
  // Knee-high picture-book bins: two shelves, a top a child could jump onto.
  low: { height: 1, shelves: [0.1, 0.52] },
};

function buildBookcase(kind: BookcaseKind): Group {
  const spec = SHELF_SPEC[kind];
  const root = new Group();
  root.name = `library.bookcase.${kind}`;
  const half = CASE_LENGTH / 2;
  // The two side panels and the crown, the case's silhouette.
  for (const side of [-1, 1]) {
    root.add(boxAt(`bookcase-side-${side < 0 ? 'left' : 'right'}`, STYLE.shelfFrame, PANEL, spec.height, CASE_DEPTH, side * (half - PANEL / 2), 0, 0, 0.03));
  }
  root.add(boxAt('bookcase-crown', STYLE.shelfFrame, CASE_LENGTH, 0.14, CASE_DEPTH, 0, spec.height - 0.14, 0, 0.04));
  // The shelves themselves.
  spec.shelves.forEach((y, i) => {
    root.add(boxAt(`bookcase-shelf-${i}`, STYLE.shelfBoard, CASE_LENGTH - PANEL * 2, BOARD, CASE_DEPTH - 0.04, 0, y - BOARD, 0, 0.012));
  });
  // A wall case and a bin have a back; a stack has a divider down its middle
  // so its two faces are two cases back to back.
  if (kind === 'stack') {
    root.add(boxAt('bookcase-divider', STYLE.shelfBack, CASE_LENGTH - PANEL * 2, spec.height - 0.14, 0.04, 0, 0, 0, 0.01));
  } else {
    root.add(boxAt('bookcase-back', STYLE.shelfBack, CASE_LENGTH - PANEL * 2, spec.height - 0.14, 0.04, 0, 0, -CASE_DEPTH / 2 + 0.03, 0.01));
  }
  return root;
}

const caseSizes = new Map<BookcaseKind, BookcaseSize>();

/** A bookcase's measured size — off the built model, never off the numbers above. */
export function libraryBookcaseSize(kind: BookcaseKind): BookcaseSize {
  const known = caseSizes.get(kind);
  if (known) return known;
  const root = buildBookcase(kind);
  const all = measurePlan(root);
  const shelfTops: number[] = [];
  for (let i = 0; ; i += 1) {
    let found = false;
    root.traverse((node) => {
      if (node.name === `bookcase-shelf-${i}`) found = true;
    });
    if (!found) break;
    shelfTops.push(measurePlan(root, (name) => name === `bookcase-shelf-${i}`).maxY);
  }
  const crownBottom = measurePlan(root, (name) => name === 'bookcase-crown').minY;
  const shelfClear = shelfTops.map((top, i) => (i + 1 < shelfTops.length ? (shelfTops[i + 1] ?? crownBottom) - BOARD : crownBottom) - top);
  const side = measurePlan(root, (name) => name === 'bookcase-side-right');
  const size: BookcaseSize = {
    length: all.maxX - all.minX,
    depth: all.maxZ - all.minZ,
    height: all.maxY - all.minY,
    shelfTops,
    shelfClear,
    innerHalf: side.minX,
  };
  caseSizes.set(kind, size);
  return size;
}

/** One bookcase unit: its front faces local +Z, its back on z = -depth/2, centred on X. */
export function createLibraryBookcase(kind: BookcaseKind): AssetHandle {
  const root = buildBookcase(kind);
  return { root, height: libraryBookcaseSize(kind).height };
}

// ---------------------------------------------------------------------------
// The reading room — books
// ---------------------------------------------------------------------------

/** One book shape, for instancing: three heights by two thicknesses (the art contract). */
export interface BookShape {
  readonly height: number;
  readonly thickness: number;
  readonly depth: number;
  readonly geometry: BufferGeometry;
}

const BOOK_HEIGHTS = [0.42, 0.36, 0.3] as const;
const BOOK_THICKNESSES = [0.06, 0.09] as const;
const BOOK_DEPTH = 0.26;

let bookShapes: readonly BookShape[] | null = null;

/**
 * The six book shapes, standing on their base, spine facing +Z, measured off
 * their own geometry. Shared: every book in the room is an instance of one.
 */
export function libraryBookShapes(): readonly BookShape[] {
  if (bookShapes) return bookShapes;
  const shapes: BookShape[] = [];
  for (const height of BOOK_HEIGHTS) {
    for (const thickness of BOOK_THICKNESSES) {
      const geometry = markShared(roundedBox(thickness, height, BOOK_DEPTH, 0.012));
      geometry.translate(0, height / 2, 0);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      shapes.push({ height: box.max.y - box.min.y, thickness: box.max.x - box.min.x, depth: box.max.z - box.min.z, geometry });
    }
  }
  bookShapes = shapes;
  return shapes;
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

// ---------------------------------------------------------------------------
// The reading room — furniture
// ---------------------------------------------------------------------------

/** The librarian's desk: 3 m wide (along X), 1 m deep, its top at the kiosk counter's height. Front faces +Z. */
export function createLibraryDesk(): AssetHandle {
  const root = new Group();
  root.name = 'library.desk';
  const top = COUNTER_TOP_Y;
  root.add(
    boxAt('desk-body', STYLE.deskBody, 2.9, top - 0.08, 0.9, 0, 0, 0, 0.06),
    boxAt('desk-top', STYLE.deskTop, 3, 0.08, 1, 0, top - 0.08, 0, 0.03),
    boxAt('desk-trim', STYLE.deskTrim, 2.6, 0.12, 0.04, 0, top - 0.32, 0.46, 0.02),
  );
  return { root, height: top };
}

/** The desk's measured top and footprint. */
export function libraryDeskSize(): { readonly width: number; readonly depth: number; readonly top: number } {
  const plan = measurePlan(createLibraryDesk().root);
  return { width: plan.maxX - plan.minX, depth: plan.maxZ - plan.minZ, top: plan.maxY };
}

/** A reading armchair, sitter facing +Z: seat 0.55 m up. `big` is the storyteller's wingback. */
export function createLibraryArmchair(colour: number, big = false): AssetHandle {
  const root = new Group();
  root.name = big ? 'library.storyChair' : 'library.armchair';
  const width = big ? 1.5 : 1.1;
  const depth = big ? 1.1 : 0.95;
  const seat = 0.55;
  const back = big ? 1.9 : 1.15;
  const cloth: PartStyle = { colour, outline: 0.018 };
  root.add(
    boxAt('chair-seat', cloth, width - 0.3, 0.24, depth - 0.25, 0, seat - 0.24, 0.1, 0.1),
    boxAt('chair-base', cloth, width, seat - 0.24, depth, 0, 0, 0, 0.08),
    boxAt('chair-back', cloth, width, back, 0.3, 0, 0, -depth / 2 + 0.15, 0.12),
  );
  for (const side of [-1, 1]) root.add(boxAt(`chair-arm-${side}`, cloth, 0.22, seat + 0.2, depth, side * (width / 2 - 0.11), 0, 0, 0.08));
  return { root, height: back };
}

/** The chair's measured seat height and footprint radius. */
export function libraryArmchairSize(big = false): { readonly seat: number; readonly radius: number; readonly height: number } {
  const chair = createLibraryArmchair(PALETTE.markerPink, big).root;
  const plan = measurePlan(chair);
  const seat = measurePlan(chair, (name) => name === 'chair-seat').maxY;
  return { seat, radius: Math.max(plan.maxX - plan.minX, plan.maxZ - plan.minZ) / 2, height: plan.maxY };
}

export interface LampHandle extends AssetHandle {
  /** Where the bulb is, local, for the light's pool. */
  readonly bulbY: number;
}

/** A floor lamp, 2.4 m to the top of its shade. */
export function createLibraryFloorLamp(): LampHandle {
  const root = new Group();
  root.name = 'library.floorLamp';
  const base = part('lamp-base', new CylinderGeometry(0.28, 0.32, 0.1, 16), STYLE.lampMetal);
  base.position.y = 0.05;
  const pole = part('lamp-pole', new CylinderGeometry(0.06, 0.06, 1.95, 10), STYLE.lampMetal);
  pole.position.y = 0.1 + 1.95 / 2;
  const shade = part('lamp-shade', new CylinderGeometry(0.24, 0.4, 0.42, 18, 1, true), STYLE.lampShade);
  shade.position.y = 2.4 - 0.21;
  const bulb = part('lamp-bulb', new SphereGeometry(0.12, 12, 8), STYLE.bulb);
  bulb.position.y = 2.12;
  root.add(base, pole, shade, bulb);
  return { root, height: 2.4, bulbY: 2.12 };
}

/** A reading lamp, 0.7 m tall, for a side table or the desk. */
export function createLibraryReadingLamp(): LampHandle {
  const root = new Group();
  root.name = 'library.readingLamp';
  const base = part('reading-lamp-base', new CylinderGeometry(0.12, 0.14, 0.06, 14), STYLE.lampMetal);
  base.position.y = 0.03;
  const stem = part('reading-lamp-stem', new CylinderGeometry(0.035, 0.035, 0.44, 8), STYLE.lampMetal);
  stem.position.y = 0.06 + 0.22;
  const shade = part('reading-lamp-shade', new CylinderGeometry(0.12, 0.22, 0.24, 16, 1, true), STYLE.lampShade);
  shade.position.y = 0.7 - 0.12;
  const bulb = part('reading-lamp-bulb', new SphereGeometry(0.07, 10, 6), STYLE.bulb);
  bulb.position.y = 0.52;
  root.add(base, stem, shade, bulb);
  return { root, height: 0.7, bulbY: 0.52 };
}

/** A round side table, its top 0.6 m up. */
export function createLibrarySideTable(): AssetHandle {
  const root = new Group();
  root.name = 'library.sideTable';
  const top = part('table-top', new CylinderGeometry(0.4, 0.4, 0.07, 20), STYLE.tableWood);
  top.position.y = 0.6 - 0.035;
  const leg = part('table-leg', new CylinderGeometry(0.07, 0.09, 0.53, 10), STYLE.tableWood);
  leg.position.y = 0.53 / 2;
  const foot = part('table-foot', new CylinderGeometry(0.24, 0.26, 0.05, 16), STYLE.tableWood);
  foot.position.y = 0.025;
  root.add(top, leg, foot);
  return { root, height: 0.6 };
}

/** A floor cushion on the story rug: a squashy disc 0.22 m high. */
export function createLibraryCushion(colour: number): AssetHandle {
  const root = new Group();
  root.name = 'library.cushion';
  const cushion = part('cushion', new SphereGeometry(0.45, 18, 10), { colour, outline: 0.014 });
  cushion.scale.set(1, 0.25, 1);
  cushion.position.y = 0.11;
  root.add(cushion);
  return { root, height: 0.22 };
}

/** The cushion's measured top and radius. */
export function libraryCushionSize(): { readonly top: number; readonly radius: number } {
  const plan = measurePlan(createLibraryCushion(PALETTE.markerMint).root);
  return { top: plan.maxY, radius: (plan.maxX - plan.minX) / 2 };
}

/** The story rug: a rounded rectangle with a sunny border, flat on the floor. */
export function createLibraryRug(width: number, depth: number): AssetHandle {
  const root = new Group();
  root.name = 'library.rug';
  const border = decal(part('rug-border', roundedBox(width, 0.02, depth, 0.009), STYLE.rugBorder));
  border.position.y = 0.01;
  const field = decal(part('rug-field', roundedBox(width - 0.5, 0.02, depth - 0.5, 0.009), STYLE.rug));
  field.position.y = 0.03;
  root.add(border, field);
  return { root, height: 0.04 };
}

/** A wall sconce: a backplate, an arm and a glowing cup. Its back on z 0, facing +Z. */
export function createLibrarySconce(): LampHandle {
  const root = new Group();
  root.name = 'library.sconce';
  root.add(boxAt('sconce-plate', STYLE.lampMetal, 0.26, 0.4, 0.06, 0, -0.2, 0.03, 0.02));
  const arm = part('sconce-arm', new CylinderGeometry(0.04, 0.04, 0.3, 8), STYLE.lampMetal);
  arm.rotation.x = Math.PI / 2;
  arm.position.set(0, 0, 0.2);
  const cup = part('sconce-shade', new CylinderGeometry(0.16, 0.1, 0.22, 14, 1, true), STYLE.lampShade);
  cup.position.set(0, 0.06, 0.36);
  const bulb = part('sconce-bulb', new SphereGeometry(0.08, 10, 6), STYLE.bulb);
  bulb.position.set(0, 0.12, 0.36);
  root.add(arm, cup, bulb);
  return { root, height: 0.3, bulbY: 0.12 };
}
