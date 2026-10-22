import { Group, Mesh, Vector3, type Material, type MeshToonMaterial } from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../style/artPalette';
import { markShared, toonMaterial } from '../style/materials';
import { visibleBounds } from '../style/measure';
import type { AssetHandle } from '../style/asset';
import { dressGlbPart, type LampHandle, type PartStyle } from './libraryAssets';
import {
  LIBRARY_DEN_LANTERN_NODES,
  LIBRARY_DEN_ROOM_NODES,
  LIBRARY_SECRET_BOOK_NODES,
  denKitBounds,
  libraryDenPart,
  libraryDenPartNames,
} from './libraryDenKit';

/**
 * **The secret den's models** (Library v2, epic #714 part 5, #719) — the room
 * behind the reading room's west wall, its lantern, and the pull book on the
 * secret shelf, dressed.
 *
 * The same split as `libraryAssets.ts`, whose dresser this file borrows
 * (`dressGlbPart`): the 3D Artist owns **shape** (`libraryDen.glb`,
 * `art/blend/library_den_build.py`, read once by `libraryDenKit.ts`); this
 * file owns every colour, outline and glow ({@link LIBRARY_DEN_GLB_STYLES}),
 * which `art/blend/library_den_render.py` reads back out of this file for its
 * review renders. Every size is `libraryDenKit.ts`'s, measured; nothing here
 * types one.
 *
 * Every root's origin is where the kit put it (ASSET_MANIFEST's contract):
 * the den at the middle of its doorway on the wall's centre line, at the
 * bottom of its floor slab (`LIBRARY_DEN_PLAN.floorTop` up to the floor she
 * walks on); the lantern with its back on the wall and its bottom at zero;
 * the book on its base, spine to +Z.
 */

/**
 * **Every node in `libraryDen.glb`, dressed.** A node with no row throws at
 * load, and a row naming no node throws too (the check below the table).
 * Exported, keyed by node name with literal `PALETTE.`/`ART.` keys, because the
 * Artist's render script reads each row's colour key out of this file's text
 * with a regex (so no example row may appear in a comment here).
 *
 * The room is the reading room's own stuff — its floor's wood and its walls'
 * green are the defaults here, and the den's builder passes the room's actual
 * materials in ({@link createLibraryDen}'s `paint`), so one material is the
 * floor in both and the lintel fades with the west wall it is part of. The
 * niches are the cases' wood; the stars and the moon are self-lit a little,
 * the lantern's ball fully: the den's magic is emissive, never a `PointLight`.
 */
export const LIBRARY_DEN_GLB_STYLES: Readonly<Record<string, PartStyle>> = {
  // --- the room -------------------------------------------------------------
  'den-floor': { colour: PALETTE.wood },
  'den-wallWest': { colour: PALETTE.buildingTrimDeep },
  'den-wallNorth': { colour: PALETTE.buildingTrimDeep },
  'den-wallSouth': { colour: PALETTE.buildingTrimDeep },
  'den-lintel': { colour: PALETTE.buildingTrimDeep },
  // --- the niches -----------------------------------------------------------
  'den-nicheBacks': { colour: PALETTE.woodDark },
  'den-shelves': { colour: PALETTE.wood, outline: 0.012 },
  // --- the magic ------------------------------------------------------------
  'den-stars': { colour: PALETTE.liftFrame, lift: 0.45 },
  'den-moon': { colour: ART.cream, lift: 0.45 },
  'denLantern-bracket': { colour: PALETTE.liftFrame, outline: 0.01 },
  'denLantern-glow': { colour: PALETTE.fairyWarm, glow: true },
  // --- the pull book ----------------------------------------------------------
  'secretBook-cover': { colour: ART.helmetGold, outline: 0.012 },
  'secretBook-pages': { colour: ART.cream },
  'secretBook-star': { colour: ART.shine, lift: 0.6 },
};

{
  const names = libraryDenPartNames();
  const undressed = names.filter((name) => !LIBRARY_DEN_GLB_STYLES[name]);
  const stale = Object.keys(LIBRARY_DEN_GLB_STYLES).filter((name) => !names.includes(name));
  if (undressed.length > 0 || stale.length > 0) {
    throw new Error(
      `libraryDenAssets: LIBRARY_DEN_GLB_STYLES and libraryDen.glb disagree — undressed nodes: ${undressed.join(', ') || 'none'}; ` +
        `rows naming no node: ${stale.join(', ') || 'none'}`,
    );
  }
  for (const name of names) markShared(libraryDenPart(name).geometry);
}

/** A node's row, or a throw naming it. */
function styleOf(name: string): PartStyle {
  const style = LIBRARY_DEN_GLB_STYLES[name];
  if (!style) throw new Error(`libraryDenAssets: no style for node '${name}'`);
  return style;
}

/**
 * **One node of the den kit, dressed by {@link LIBRARY_DEN_GLB_STYLES}** —
 * its paint, ink outline, shadow flags and node transform. `material`
 * replaces the table's shared paint for a part that must own its material
 * (the room's floor and walls take the reading room's own, so they are one
 * paint; a star that twinkles animates its own); the row's outline and shadow
 * flags still apply.
 */
export function libraryDenMesh(name: string, material?: Material): Mesh {
  return dressGlbPart(libraryDenPart(name), styleOf(name), material);
}

// ---------------------------------------------------------------------------
// The den
// ---------------------------------------------------------------------------

/**
 * The reading room's own materials, for the pieces of the den that are the
 * room's stuff: its floor is the room floor's boards, its walls the room's
 * green, and the lintel is part of the west wall, which fades while she is in
 * the den — so it takes that wall's cloned material. Omitted, a piece takes
 * the table's default.
 */
export interface LibraryDenPaint {
  readonly floor?: Material;
  readonly wall?: Material;
  readonly lintel?: Material;
}

export interface LibraryDenHandle extends AssetHandle {
  /** The floor slab: its top is `LIBRARY_DEN_PLAN.floorTop` above the root. */
  readonly floor: Mesh;
  /** The three walls. `south` is the camera's near side — the room's rule hides it. */
  readonly walls: { readonly west: Mesh; readonly north: Mesh; readonly south: Mesh };
  /**
   * The lintel over the doorway, from the shut shelf's top to the wall's top:
   * a child of the root like the rest, placed by the same transform — re-parent
   * it under the west wall's group (same world transform) to fade it with the
   * spans either side of the doorway.
   */
  readonly lintel: Mesh;
  /** The niche boards (the kit's shelf wood), their back panels, and the raised stars and moon on the far walls. */
  readonly shelves: Mesh;
  readonly nicheBacks: Mesh;
  readonly stars: Mesh;
  readonly moon: Mesh;
}

/**
 * **The den** — floor, three walls with book niches, the lintel, the stars and
 * the moon — every node a direct child of the root at the kit's own
 * transform. Place the root at the doorway's middle on the wall's centre line
 * (`LIBRARY_DEN_PLAN` says where everything else is from there), `floorTop`
 * below the room's floor. The books that line the niches are the library
 * kit's instancing blocks, placed by whoever furnishes the den on
 * `LIBRARY_DEN_PLAN.niches`.
 */
export function createLibraryDen(paint: LibraryDenPaint = {}): LibraryDenHandle {
  const root = new Group();
  root.name = 'library.den';
  const made = new Map<string, Mesh>();
  const materialFor = (name: string): Material | undefined => {
    if (name === 'den-floor') return paint.floor;
    if (name === 'den-lintel') return paint.lintel;
    if (name.startsWith('den-wall')) return paint.wall;
    return undefined;
  };
  for (const name of LIBRARY_DEN_ROOM_NODES) {
    const mesh = libraryDenMesh(name, materialFor(name));
    made.set(name, mesh);
    root.add(mesh);
  }
  const node = (name: string): Mesh => {
    const mesh = made.get(name);
    if (!mesh) throw new Error(`libraryDenAssets: the den has no '${name}'`);
    return mesh;
  };
  return {
    root,
    height: visibleBounds(root).top,
    floor: node('den-floor'),
    walls: { west: node('den-wallWest'), north: node('den-wallNorth'), south: node('den-wallSouth') },
    lintel: node('den-lintel'),
    shelves: node('den-shelves'),
    nicheBacks: node('den-nicheBacks'),
    stars: node('den-stars'),
    moon: node('den-moon'),
  };
}

// ---------------------------------------------------------------------------
// The lantern
// ---------------------------------------------------------------------------

/**
 * **A den lantern** — a glowing paper ball on a curly brass bracket. Its back
 * is on z = 0 (hang it on a wall's inner face, facing out, +Z), its bottom at
 * zero; `bulb` is the ball's measured middle, should a pool ever be hung there
 * (none is: the lighting budget is full, and the ball glows on its own).
 */
export function createLibraryDenLantern(): LampHandle {
  const root = new Group();
  root.name = 'library.denLantern';
  for (const name of LIBRARY_DEN_LANTERN_NODES) root.add(libraryDenMesh(name));
  const glow = denKitBounds(['denLantern-glow']);
  return {
    root,
    height: visibleBounds(root).top,
    bulb: new Vector3((glow.minX + glow.maxX) / 2, (glow.minY + glow.maxY) / 2, (glow.minZ + glow.maxZ) / 2),
  };
}

/** The lantern's measured size: how far it stands out from its wall, its half-width, and its height. */
export function libraryDenLanternSize(): { readonly out: number; readonly halfWidth: number; readonly height: number } {
  const all = denKitBounds([...LIBRARY_DEN_LANTERN_NODES]);
  return { out: all.maxZ, halfWidth: Math.max(-all.minX, all.maxX), height: all.maxY };
}

// ---------------------------------------------------------------------------
// The pull book
// ---------------------------------------------------------------------------

export interface SecretBookHandle extends AssetHandle {
  /** The star on its spine, which twinkles: it owns its material, so its glow can be driven without touching any other part. */
  readonly star: Mesh;
  readonly starMaterial: MeshToonMaterial;
}

/**
 * **The pull book** on the secret shelf: a fat gold tome, taller than any
 * book in the room, a raised star on its spine. Shelved like a kit book —
 * base-centred, thickness along X, spine to +Z — and stood a little proud of
 * its row by whoever shelves it. Its star's `emissiveIntensity` is the
 * twinkle's to animate.
 */
export function createLibrarySecretBook(): SecretBookHandle {
  const root = new Group();
  root.name = 'library.secretBook';
  const starStyle = styleOf('secretBook-star');
  const starMaterial = toonMaterial(starStyle.colour, { emissive: starStyle.colour, emissiveIntensity: starStyle.lift ?? 0 });
  let star: Mesh | null = null;
  for (const name of LIBRARY_SECRET_BOOK_NODES) {
    const mesh = name === 'secretBook-star' ? libraryDenMesh(name, starMaterial) : libraryDenMesh(name);
    if (name === 'secretBook-star') star = mesh;
    root.add(mesh);
  }
  if (!star) throw new Error('libraryDenAssets: the secret book has no star');
  return { root, height: visibleBounds(root).top, star, starMaterial };
}

/**
 * The pull book's measured size, in a shelf's terms: how tall it stands, how
 * thick along the row, and how deep its boards run behind the row's front —
 * the spine and its star stand proud of that, as a book's spine does.
 */
export function librarySecretBookSize(): { readonly height: number; readonly thickness: number; readonly depth: number; readonly proud: number } {
  const all = denKitBounds([...LIBRARY_SECRET_BOOK_NODES]);
  const cover = denKitBounds(['secretBook-cover']);
  // Built about its own middle: the boards' back edge is half their depth behind it.
  const depth = -cover.minZ * 2;
  return { height: all.maxY, thickness: all.maxX - all.minX, depth, proud: all.maxZ - depth / 2 };
}
