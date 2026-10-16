import {
  BackSide,
  BoxGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  Raycaster,
  Vector3,
  type BufferAttribute,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../../core/palette';
import { ART } from '../style/artPalette';
import { addOutline, addSmoothOutline, decal, markShared, solid, toonMaterial, type ToonOptions } from '../style/materials';
import { visibleBounds, visiblePoints } from '../style/measure';
import type { AssetHandle } from '../style/asset';
import { kitBounds, kitTreads, libraryPart, libraryPartNames, LIBRARY_SHELF_FOOTPRINT, LIBRARY_SHELL_NODES } from './libraryKit';

/**
 * **The Library's models** (#716) — the building and everything that
 * furnishes its reading room, dressed.
 *
 * ## The split, and why the glb carries no colour
 *
 * `castleAssets.ts`'s split, followed rather than reinvented. The 3D Artist
 * owns **shape**: `library.glb` (#715, `art/blend/library_build.py`, its
 * `CONTRACT` asserted against the emitted vertices on every build), read once
 * by `libraryKit.ts`. Everything below — the {@link LIBRARY_GLB_STYLES} table,
 * the ink outlines, the shadow flags, the glow of a lamp's shade — is this
 * file's. `art/blend/library_render.py` reads {@link LIBRARY_GLB_STYLES} back
 * out of this file for its review renders and copies no hex.
 *
 * ## No size is typed here
 *
 * Every figure the room builds against — a shelf's board heights, a chair's
 * seat, the desk's top, a lamp's shade — is **measured off the loaded mesh**
 * ({@link libraryBookcaseSize}, {@link libraryArmchairSize}, …; `visibleBounds`
 * for a dressed model's height), so when the Artist moves a board the books,
 * the colliders and the walkable tops move with it. The exterior's plan is
 * `libraryKit.ts`'s `LIBRARY_EXTERIOR_PLAN`, measured the same way.
 *
 * ## The few pieces the kit does not have
 *
 * The side table, the story rug, the wall sconce and the knee-high picture-book
 * bins are not in #715's kit, so they are built from primitives here. They are
 * this file's own pieces, not stand-ins for a contract figure: the bins take
 * their length and depth **from the drawn shelf** so a row of them lines up
 * with a row of cases, and their own height is theirs.
 */

// ---------------------------------------------------------------------------
// Dressing — the one place a library colour is chosen
// ---------------------------------------------------------------------------

/** A part's paint. From `PALETTE` or `ART` only (ART_DIRECTION §5). */
export interface PartStyle {
  readonly colour: number;
  /** Inverted-hull outline thickness in metres; omitted for parts that draw no silhouette. */
  readonly outline?: number;
  /** Self-lit: a lamp's shade, a lit window. Casts and catches nothing. */
  readonly glow?: true;
  /** A soft glow of its own colour, this share of it — less than a lamp's. */
  readonly lift?: number;
}

/**
 * **Every node in `library.glb`, dressed** — all of them, the owl, dragon and
 * cat of parts 4 and 5 included, so the kit has one owner of its colours and
 * the Artist's review renders read the game's own. A node with no row here
 * throws at load rather than arriving undressed, and a row naming no node
 * throws too (see the check below the table).
 *
 * **Exported, and keyed by node name with literal `PALETTE.`/`ART.` keys**,
 * for two readers. `art/blend/library_render.py` reads each row's colour key
 * out of this file's text with a regex (so no example row may appear in a
 * comment here), and a colour computed or aliased here would silently fall
 * back to the Artist's proposal in the review renders. And the storybook's dragon
 * (`world/library/reader/readerAssets.ts`, `createStoryDragon`) reads its
 * body, belly, horn and wing colours from the `dragon-*` rows, so the dragon
 * a child reads about and the one she finds in the den are one dragon — which
 * is why `dragon-wings` is `ART.miniLilac`, the storybook dragon's wings,
 * rather than the Artist's proposed pink.
 *
 * The creatures are dressed through {@link libraryKitMesh}
 * (`art/models/libraryCreatures.ts`); a faced head and the dragon's glowing
 * belly own their materials, and still take their colour and outline from here.
 *
 * The building is the park's stone, cream and sky-blue: a pale plinth and
 * darker steps a child reads as somewhere to climb, rose-stone walls, cream
 * columns and entablature, the gold open book on the pediment, a roof in the
 * park's deep sky blue, and warm lit windows. Inside, the wood is three tones
 * by weight (light tops, mid boards, dark frames — the castle's rule), the
 * lamps' shades glow, and each chair and cushion takes its own bright cloth
 * from the furnisher (the colour here is the default).
 */
export const LIBRARY_GLB_STYLES: Readonly<Record<string, PartStyle>> = {
  // --- the building -----------------------------------------------------------
  'shell-plinth': { colour: PALETTE.stoneGreyLight, outline: 0.03 },
  'shell-steps': { colour: PALETTE.stoneGrey, outline: 0.03 },
  'shell-walls': { colour: PALETTE.stonePink, outline: 0.03 },
  'shell-windows': { colour: PALETTE.buildingWindowWarm, glow: true },
  // The door and the carved book draw no outline: neither is part of the
  // building's silhouette (ART_DIRECTION §4 — outline what defines the shape),
  // and each hull lands exactly on a face of the Artist's (the door's centre
  // strip on the plinth's top, the book's raised lines on its own page block),
  // which check:coplanar rightly calls a seam.
  'shell-door': { colour: PALETTE.woodDark },
  'shell-columns': { colour: ART.cream, outline: 0.03 },
  'shell-entablature': { colour: ART.cream, outline: 0.03 },
  'shell-pediment': { colour: ART.creamDark, outline: 0.03 },
  'shell-pedimentBook': { colour: PALETTE.liftFrame },
  'shell-roof': { colour: PALETTE.buildingRoofDeep, outline: 0.03 },

  // --- the bookcases ----------------------------------------------------------
  'shelf-carcass': { colour: PALETTE.woodDark, outline: 0.02 },
  'shelf-shelves': { colour: PALETTE.wood, outline: 0.012 },
  'secretShelf-carcass': { colour: PALETTE.woodDark, outline: 0.02 },
  'secretShelf-shelves': { colour: PALETTE.wood, outline: 0.012 },

  // --- furniture --------------------------------------------------------------
  'desk-body': { colour: PALETTE.woodDark, outline: 0.02 },
  'desk-top': { colour: PALETTE.woodLight, outline: 0.018 },
  // No outline on the lamp's brass: a hair-thin stem needs none, and its
  // hull's foot would lie in the plane of the desk or table it stands on.
  'readingLamp-stem': { colour: PALETTE.liftFrame },
  'readingLamp-shade': { colour: PALETTE.buildingWindowWarm, glow: true },
  'floorLamp-base': { colour: PALETTE.woodDark, outline: 0.016 },
  'floorLamp-stem': { colour: PALETTE.liftFrame, outline: 0.01 },
  'floorLamp-shade': { colour: PALETTE.fairyWarm, glow: true },
  'armchair-frame': { colour: ART.jumperRed, outline: 0.018 },
  'armchair-seat': { colour: ART.heartPink, outline: 0.016 },
  'armchair-feet': { colour: PALETTE.woodDark, outline: 0.012 },
  'cushion-body': { colour: PALETTE.markerLilac, outline: 0.014 },

  // --- books (each instance takes its own spine colour; these are the renders') --
  'book-tall-thin': { colour: PALETTE.markerSky },
  'book-tall-thick': { colour: PALETTE.markerPink },
  'book-mid-thin': { colour: PALETTE.markerMint },
  'book-mid-thick': { colour: PALETTE.markerLemon },
  'book-short-thin': { colour: PALETTE.markerLilac },
  'book-short-thick': { colour: ART.jumperRed },
  'bookPile-cover1': { colour: PALETTE.markerSky, outline: 0.012 },
  'bookPile-cover2': { colour: ART.jumperRed, outline: 0.012 },
  'bookPile-cover3': { colour: PALETTE.markerMint, outline: 0.012 },
  'bookPile-cover4': { colour: PALETTE.markerLemon, outline: 0.012 },
  'bookPile-cover5': { colour: PALETTE.markerLilac, outline: 0.012 },
  'bookPile-pages': { colour: ART.cream },
  'reader-cover': { colour: ART.jumperRed, outline: 0.012 },

  // --- the owl librarian (#714 part 4) -----------------------------------------
  'owl-body': { colour: PALETTE.markerLilac, outline: 0.02 },
  'owl-bib': { colour: ART.biscuitMuzzle, outline: 0.012 },
  'owl-buttons': { colour: PALETTE.liftFrame },
  'owl-head': { colour: ART.biscuitFur, outline: 0.02 },
  'owl-beak': { colour: ART.chickenBeak, outline: 0.012 },
  'owl-glasses': { colour: PALETTE.liftFrame, outline: 0.01 },
  'owl-wingL': { colour: ART.biscuitFurDark, outline: 0.016 },
  'owl-wingR': { colour: ART.biscuitFurDark, outline: 0.016 },
  'owl-feet': { colour: ART.chickenBeak, outline: 0.012 },
  'owl-heldBook': { colour: ART.jumperRed, outline: 0.012 },

  // --- the secret den (#714 part 5) --------------------------------------------
  'dragon-body': { colour: ART.snakeMint, outline: 0.016 },
  'dragon-belly': { colour: ART.snakeBelly },
  'dragon-head': { colour: ART.snakeMint, outline: 0.016 },
  'dragon-horns': { colour: ART.miniHorn, outline: 0.01 },
  'dragon-spines': { colour: ART.miniHorn, outline: 0.01 },
  'dragon-wings': { colour: ART.miniLilac, outline: 0.012 },
  'dragon-tail': { colour: ART.snakeMint, outline: 0.016 },
  'dragonNest-pad': { colour: ART.heartPink, outline: 0.012 },
  'dragonNest-coversA': { colour: PALETTE.markerSky, outline: 0.012 },
  'dragonNest-coversB': { colour: PALETTE.markerLemon, outline: 0.012 },
  'dragonNest-coversC': { colour: ART.jumperRed, outline: 0.012 },
  'dragonNest-pages': { colour: ART.cream },
  'cat-body': { colour: ART.corgiTan, outline: 0.012 },
  'cat-head': { colour: ART.corgiTan, outline: 0.012 },
  'cat-tail': { colour: ART.corgiTan, outline: 0.01 },
  'cat-earL': { colour: ART.corgiTan, outline: 0.01 },
  'cat-earR': { colour: ART.corgiTan, outline: 0.01 },
};

// The table and the file must name the same nodes — a node the table misses
// would arrive undressed, a row the file lacks is a stale name.
{
  const names = libraryPartNames();
  const undressed = names.filter((name) => !LIBRARY_GLB_STYLES[name]);
  const stale = Object.keys(LIBRARY_GLB_STYLES).filter((name) => !names.includes(name));
  if (undressed.length > 0 || stale.length > 0) {
    throw new Error(
      `libraryAssets: LIBRARY_GLB_STYLES and library.glb disagree — undressed nodes: ${undressed.join(', ') || 'none'}; ` +
        `rows naming no node: ${stale.join(', ') || 'none'}`,
    );
  }
  for (const name of names) markShared(libraryPart(name).geometry);
}

/** The pieces the kit does not have (see the header): this file's own primitives' paint. */
const OWN = {
  tableWood: { colour: PALETTE.wood, outline: 0.014 },
  sconceMetal: { colour: PALETTE.liftFrame, outline: 0.01 },
  sconceShade: { colour: PALETTE.fairyWarm, glow: true },
  binFrame: { colour: PALETTE.woodDark, outline: 0.02 },
  binBoard: { colour: PALETTE.wood, outline: 0.012 },
  // The bins line the two walls the camera looks in over, so it is their backs
  // it sees: a warm wood, never the near-black bark a dim room would make of it.
  binBack: { colour: PALETTE.woodDark },
  rugField: { colour: PALETTE.markerPink },
  rugBorder: { colour: PALETTE.flowerYellow },
  // The doormat inside the way out: daylight cream edged in sky blue, the
  // lightest thing on the dim floor, so the door reads from across the room.
  doormatField: { colour: ART.cream, lift: 0.35 },
  doormatBorder: { colour: PALETTE.markerSky },
  skirtPlinth: { colour: PALETTE.stoneGreyLight },
  skirtSteps: { colour: PALETTE.stoneGrey },
} satisfies Record<string, PartStyle>;

/** One material per paint, shared by every part painted with it. */
const materials = new Map<string, Material>();
function paint(style: PartStyle): Material {
  const key = `${style.colour}:${style.glow ? 'glow' : 'toon'}:${style.lift ?? 0}`;
  let material = materials.get(key);
  if (!material) {
    const options: ToonOptions = style.glow
      ? { emissive: style.colour, emissiveIntensity: 0.9 }
      : style.lift !== undefined
        ? { emissive: style.colour, emissiveIntensity: style.lift }
        : {};
    material = markShared(toonMaterial(style.colour, options));
    materials.set(key, material);
  }
  return material;
}

/** A mesh, painted, shadowed and outlined by its style. */
function dress(mesh: Mesh, style: PartStyle): Mesh {
  if (style.glow) decal(mesh);
  else solid(mesh);
  if (style.outline !== undefined) addOutline(mesh, style.outline);
  return mesh;
}

/** A node's row in {@link LIBRARY_GLB_STYLES}, or a throw naming it. */
function styleOf(name: string): PartStyle {
  const style = LIBRARY_GLB_STYLES[name];
  if (!style) throw new Error(`libraryAssets: no style for node '${name}'`);
  return style;
}

/** A node's shape in `material`, its node transform carried across with it, dressed by `style`. */
function placedKitMesh(name: string, material: Material, style: PartStyle): Mesh {
  const part = libraryPart(name);
  const mesh = new Mesh(part.geometry, material);
  mesh.name = name;
  mesh.position.copy(part.position);
  mesh.quaternion.copy(part.quaternion);
  mesh.scale.copy(part.scale);
  return dress(mesh, style);
}

/** One node of the kit, dressed, its node transform carried across with its shape. `colour` overrides the table's (a chair's cloth). */
function kitMesh(name: string, colour?: number): Mesh {
  const style = styleOf(name);
  const used = colour === undefined ? style : { ...style, colour };
  return placedKitMesh(name, paint(used), used);
}

/**
 * **One node of the kit, dressed by {@link LIBRARY_GLB_STYLES}** — its paint,
 * its ink outline, its shadow flags and its node transform (a pivoted node's
 * translation is its pivot) — for the creature factories in
 * `libraryCreatures.ts`. The same dressing every piece of the room gets: one
 * decode (`libraryKit.ts`), one table, one dresser.
 *
 * `material` replaces the table's shared paint for a part that has to own its
 * material — a head whose face map is swapped to blink, a belly whose glow is
 * animated — so changing it can never reach another part painted the same
 * colour. The row's outline and shadow flags still apply.
 */
export function libraryKitMesh(name: string, material?: Material): Mesh {
  return material ? placedKitMesh(name, material, styleOf(name)) : kitMesh(name);
}

/** A named group of dressed kit nodes. */
function assemble(key: string, names: readonly string[], colours: Readonly<Record<string, number>> = {}): Group {
  const root = new Group();
  root.name = key;
  for (const name of names) root.add(kitMesh(name, colours[name]));
  return root;
}

/** One of this file's own primitive parts. */
function ownPart(name: string, geometry: BufferGeometry, style: PartStyle): Mesh {
  const mesh = new Mesh(geometry, paint(style));
  mesh.name = name;
  return dress(mesh, style);
}

/** A rounded box with its base at `base`, centred on X and Z there — chunky-toy edges. */
function boxAt(name: string, style: PartStyle, w: number, h: number, d: number, x: number, base: number, z: number, radius = 0.05): Mesh {
  const r = Math.max(0.001, Math.min(radius, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const mesh = ownPart(name, new RoundedBoxGeometry(w, h, d, 3, r), style);
  mesh.position.set(x, base + h / 2, z);
  return mesh;
}

// ---------------------------------------------------------------------------
// Measuring a built model
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

/** Is this mesh an ink outline (an inverted hull), rather than the shape it outlines? */
function isOutline(mesh: Mesh): boolean {
  const material = mesh.material as Material;
  return material instanceof MeshBasicMaterial && material.side === BackSide;
}

/**
 * The extent of a built model's **shape** in `root`'s own frame — every
 * visible vertex of every painted part, never a bounding box, and never an
 * outline (the ink round a shape is not the shape: measuring it made a plinth
 * 3 cm wider than the one the park was solved with). `only` picks parts by name.
 */
export function measurePlan(root: Object3D, only?: (name: string) => boolean): PlanBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  root.updateMatrixWorld(true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const combined = new Matrix4();
  const point = new Vector3();
  root.traverse((node) => {
    if (!(node instanceof Mesh) || isOutline(node)) return;
    for (let up: Object3D | null = node; up && up !== root; up = up.parent) if (!up.visible) return;
    if (only && !only(node.name)) return;
    const position = node.geometry.getAttribute('position');
    if (!position) return;
    combined.multiplyMatrices(toRoot, node.matrixWorld);
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position as BufferAttribute, i).applyMatrix4(combined);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
  });
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/**
 * How far a ray from `origin` along `direction` travels before it meets the
 * outside of one of `root`'s painted parts — front faces only, so a ray up
 * from a shelf meets the underside of the board over it, never the inside of
 * the board it starts in.
 */
function rayTo(root: Object3D, origin: Vector3, direction: Vector3): number | null {
  root.updateMatrixWorld(true);
  const ray = new Raycaster(origin, direction.clone().normalize());
  const targets: Mesh[] = [];
  root.traverse((node) => {
    if (node instanceof Mesh && !isOutline(node)) targets.push(node);
  });
  let best: number | null = null;
  for (const hit of ray.intersectObjects(targets, false)) best = best === null ? hit.distance : Math.min(best, hit.distance);
  return best;
}

/**
 * The furthest a dressed model reaches from its origin in plan, **outlines
 * included** (`anchor.reach` counts them) — what `Library.ts` holds against the
 * manifest's bounding radius.
 */
export function dressedReach(root: Object3D): number {
  let reach = 0;
  visiblePoints(root, (p) => {
    reach = Math.max(reach, Math.hypot(p.x, p.z));
  });
  return reach;
}

// ---------------------------------------------------------------------------
// The exterior
// ---------------------------------------------------------------------------

export interface LibraryExterior {
  readonly root: Group;
  /** The front and side windows' panes — lit from inside, warm. */
  readonly windows: Mesh;
}

/**
 * The building: plinth, two full-width steps, six fat columns, the cella with
 * its round-headed door, the entablature, the pediment with its open book,
 * and the roof — `library.shell`, every node. Building-local: origin on the
 * ground at the plot's centre, the door facing +Z.
 */
export function createLibraryExterior(): LibraryExterior {
  const root = assemble('library.exterior', LIBRARY_SHELL_NODES);
  const windows = root.getObjectByName('shell-windows');
  if (!(windows instanceof Mesh)) throw new Error('libraryAssets: the shell has no windows node');
  return { root, windows };
}

/**
 * **The plinth's skirt** — the stone under the plinth and the steps, down to
 * `depth` below the base, so the planet falling away under a corner never
 * shows a gap beneath a building that stands square to the up at its centre.
 * The drawn plinth is 0.36 m of stone from its base up; this is the same
 * stone carried on into the ground, 2 cm inside the plinth's faces so no face
 * of it shares a plane with one of the Artist's (`check:coplanar`). Its
 * footprint is the drawn plinth's and steps', measured; `Library.ts` measures
 * the ground round the plinth and asks for the depth that reaches it.
 */
export function createLibrarySkirt(depth: number): Group {
  const root = new Group();
  root.name = 'library.skirt';
  const inset = 0.02;
  const plinth = kitBounds(['shell-plinth']);
  const steps = kitBounds(['shell-steps']);
  for (const [name, bounds, style] of [
    ['library-skirt-plinth', plinth, OWN.skirtPlinth],
    ['library-skirt-steps', steps, OWN.skirtSteps],
  ] as const) {
    const width = bounds.maxX - bounds.minX - inset * 2;
    // The two blocks meet back to back where the steps' back meets the
    // plinth's front, as the drawn plinth and steps do (opposite faces only).
    const backZ = bounds.minZ + (name === 'library-skirt-steps' ? 0 : inset);
    const frontZ = bounds.maxZ - (name === 'library-skirt-plinth' ? 0 : inset);
    const mesh = ownPart(name, new BoxGeometry(width, depth, frontZ - backZ), style);
    mesh.position.set((bounds.minX + bounds.maxX) / 2, -depth / 2, (backZ + frontZ) / 2);
    root.add(mesh);
  }
  return root;
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
  /** The clear height above each shelf, to whatever is over it. */
  readonly shelfClear: readonly number[];
  /** Half the clear width between the side panels: a row of books fits in it. */
  readonly innerHalf: number;
  /** How far out the front edge of the shelf boards stands from the case's middle: a spine stands just behind it. */
  readonly boardFront: number;
}

/** The kit's bookcase, dressed: front on +Z, back on z = -depth/2, centred on X. */
function kitShelf(): Group {
  return assemble('library.shelf', ['shelf-carcass', 'shelf-shelves']);
}

/**
 * The knee-high picture-book bins — this file's own piece: the drawn shelf's
 * length and depth (so a row of bins lines up with a row of cases), a bin's
 * own height and two shelves of picture books, a back, and a top a child can
 * jump onto.
 */
function buildBin(): Group {
  const root = new Group();
  root.name = 'library.bin';
  const length = LIBRARY_SHELF_FOOTPRINT.length;
  const depth = LIBRARY_SHELF_FOOTPRINT.depth;
  const height = 1;
  const panel = 0.12;
  const board = 0.06;
  for (const side of [-1, 1]) {
    root.add(boxAt(`bin-side-${side < 0 ? 'left' : 'right'}`, OWN.binFrame, panel, height - 0.1, depth, side * (length / 2 - panel / 2), 0, 0, 0.03));
  }
  // The top spans the panels, so no face of it shares a plane with theirs.
  root.add(boxAt('bin-top', OWN.binFrame, length, 0.1, depth, 0, height - 0.1, 0, 0.04));
  [0.1, 0.52].forEach((y, i) => root.add(boxAt(`bin-shelf-${i}`, OWN.binBoard, length - panel * 2, board, depth - 0.06, 0, y - board, 0.01, 0.012)));
  root.add(boxAt('bin-back', OWN.binBack, length - panel * 2, height - 0.1, 0.04, 0, 0, -depth / 2 + 0.035, 0.01));
  return root;
}

/** A stack: two drawn shelves back to back, books on both faces. */
function buildStack(): Group {
  const root = new Group();
  root.name = 'library.stack';
  const halfDepth = LIBRARY_SHELF_FOOTPRINT.depth / 2;
  const front = kitShelf();
  front.position.z = halfDepth;
  const back = kitShelf();
  back.rotation.y = Math.PI;
  back.position.z = -halfDepth;
  root.add(front, back);
  return root;
}

function buildBookcase(kind: BookcaseKind): Group {
  if (kind === 'low') return buildBin();
  if (kind === 'stack') return buildStack();
  return kitShelf();
}

const caseSizes = new Map<BookcaseKind, BookcaseSize>();

/**
 * A bookcase's measured size — off the built model, never off a number typed
 * here. A book stands on the up-facing top of a shelf board (the kit's
 * `shelf-shelves` treads, or the bin's own boards); the room over it is a ray
 * up to the underside of whatever is above; the side panels are a ray along
 * the bottom shelf each way.
 */
export function libraryBookcaseSize(kind: BookcaseKind): BookcaseSize {
  const known = caseSizes.get(kind);
  if (known) return known;
  const root = buildBookcase(kind);
  const all = measurePlan(root);
  // A stack's two faces are one shelf turned round, so measure that shelf and
  // carry its board front out to where the stack's front shelf stands.
  const face = kind === 'stack' ? kitShelf() : root;
  const faceOffset = kind === 'stack' ? LIBRARY_SHELF_FOOTPRINT.depth / 2 : 0;
  const plan = measurePlan(face);
  const shelfTops =
    kind === 'low'
      ? [...Array(2).keys()].map((i) => measurePlan(face, (name) => name === `bin-shelf-${i}`).maxY)
      : kitTreads('shelf-shelves').map((tread) => tread.y);
  const boards = kind === 'low' ? measurePlan(face, (name) => name.startsWith('bin-shelf')) : kitBounds(['shelf-shelves']);
  // Probe a book's own depth in from the boards' front edge.
  const probeZ = boards.maxZ - 0.1;
  const shelfClear = shelfTops.map((top) => {
    const up = rayTo(face, new Vector3(0, top + 0.005, probeZ), new Vector3(0, 1, 0)); // flat-ok: up the bookcase's own unplaced model frame, object-local
    return up === null ? plan.maxY - top : up + 0.005;
  });
  const lowest = shelfTops[0];
  if (lowest === undefined) throw new Error(`libraryAssets: the ${kind} case has no shelves to measure`);
  const right = rayTo(face, new Vector3(0, lowest + 0.1, probeZ), new Vector3(1, 0, 0));
  const left = rayTo(face, new Vector3(0, lowest + 0.1, probeZ), new Vector3(-1, 0, 0));
  if (right === null || left === null) throw new Error(`libraryAssets: no side panels found either side of the ${kind} case's bottom shelf`);
  const size: BookcaseSize = {
    length: all.maxX - all.minX,
    depth: all.maxZ - all.minZ,
    height: all.maxY - all.minY,
    shelfTops,
    shelfClear,
    innerHalf: Math.min(right, left),
    boardFront: boards.maxZ + faceOffset,
  };
  caseSizes.set(kind, size);
  return size;
}

/** One bookcase unit: its front faces local +Z, centred on X and Z (a stack's middle is its two backs). */
export function createLibraryBookcase(kind: BookcaseKind): AssetHandle {
  const root = buildBookcase(kind);
  return { root, height: visibleBounds(root).top };
}

/**
 * **The secret shelf** (#719): the drawn bookcase vertex for vertex, but with
 * its origin on its hinge — the vertical line through its front-left corner —
 * so swinging it open is `door.rotation.y` 0 → -π/2 and nothing else.
 * `offset` is where the hinge stands in an ordinary case's frame, measured, so
 * the closed secret shelf stands exactly where an ordinary one would.
 */
export function createLibrarySecretBookcase(): { readonly root: Group; readonly door: Group; readonly offset: Vector3 } {
  const root = new Group();
  root.name = 'library.secretShelf';
  const door = assemble('library.secretShelf.door', ['secretShelf-carcass', 'secretShelf-shelves']);
  const ordinary = kitBounds(['shelf-carcass', 'shelf-shelves']);
  const secret = kitBounds(['secretShelf-carcass', 'secretShelf-shelves']);
  const offset = new Vector3(ordinary.minX - secret.minX, 0, ordinary.maxZ - secret.maxZ);
  door.position.copy(offset);
  root.add(door);
  return { root, door, offset };
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
 */
export function libraryArmchairSize(): {
  readonly seat: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
  readonly centreX: number;
  readonly centreZ: number;
} {
  const plan = kitBounds(['armchair-frame', 'armchair-seat', 'armchair-feet']);
  return {
    seat: kitBounds(['armchair-seat']).maxY,
    width: plan.maxX - plan.minX,
    depth: plan.maxZ - plan.minZ,
    height: plan.maxY,
    centreX: (plan.minX + plan.maxX) / 2,
    centreZ: (plan.minZ + plan.maxZ) / 2,
  };
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
export function libraryFloorLampSize(): { readonly radius: number; readonly height: number } {
  const figures = lampFigures(FLOOR_LAMP, 'floorLamp-shade');
  return { radius: figures.radius, height: figures.height };
}

/** A reading lamp for a side table or the desk, its shade glowing. */
export function createLibraryReadingLamp(): LampHandle {
  const root = assemble('library.readingLamp', READING_LAMP);
  return { root, height: visibleBounds(root).top, bulb: lampFigures(READING_LAMP, 'readingLamp-shade').bulb };
}

/** The reading lamp's measured figures: the widest it reaches about its own foot (its shade leans out), and how tall. */
export function libraryReadingLampSize(): { readonly radius: number; readonly height: number } {
  const figures = lampFigures(READING_LAMP, 'readingLamp-shade');
  return { radius: figures.radius, height: figures.height };
}

/** A floor cushion on the story rug, in `colour`. */
export function createLibraryCushion(colour: number): AssetHandle {
  const root = assemble('library.cushion', ['cushion-body'], { 'cushion-body': colour });
  return { root, height: visibleBounds(root).top };
}

/** The cushion's measured top and radius (#715: its top at `KID_HIP_HEIGHT`, a seat). */
export function libraryCushionSize(): { readonly top: number; readonly radius: number } {
  const plan = kitBounds(['cushion-body']);
  return { top: plan.maxY, radius: Math.max(plan.maxX - plan.minX, plan.maxZ - plan.minZ) / 2 };
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
