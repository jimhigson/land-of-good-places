import { Vector3 } from 'three';
import { LIBRARY_DEN_GLB_BASE64 } from '../assets/libraryDenGlb';
import { base64ToArrayBuffer, readGlbParts, type GlbPart } from '../style/glb';
import { eachGlbTriangle, eachGlbVertex, glbBounds, glbFirstHit, type KitBounds } from '../style/glbMeasure';
import { LIBRARY_SHELF_FOOTPRINT } from './libraryKit';

/**
 * **The Library's secret den kit, read once, and every figure the den needs
 * measured off it** (Library v2, epic #714 part 5, #719).
 *
 * `libraryDen.glb` is the 3D Artist's (`art/blend/library_den_build.py`, its
 * `CONTRACT` asserted against the emitted vertices on every build); this file
 * reads it and nothing else — no colour, no outline, no material (those are
 * `libraryDenAssets.ts`'s, the castle's split, as `libraryKit.ts` is to
 * `libraryAssets.ts`). The den's room geometry, its niches' rows and the
 * doorway are **measured** here ({@link LIBRARY_DEN_PLAN}) so the colliders,
 * the walkable plate and the books that fill the niches are readings of one
 * mesh, and no typed copy of the den's size can drift from the bytes. The kit
 * was built *from* `layout.ts`'s own figures (the wall's half-thickness and
 * height, the den's depth, its doorway's half-width, its run north past the
 * doorway), read at build time; the plan below is how the game reads them back
 * and holds them to the layout.
 *
 * Node names are hyphenated (`GLTFLoader` strips full stops): `den-floor`,
 * `den-wallWest`, …, `denLantern-glow`, `secretBook-star`.
 */

const parts: Map<string, GlbPart> = readGlbParts(base64ToArrayBuffer(LIBRARY_DEN_GLB_BASE64));

/** One node of `libraryDen.glb`, or a throw naming every node the file has. */
export function libraryDenPart(name: string): GlbPart {
  const part = parts.get(name);
  if (!part) {
    throw new Error(`libraryDenKit: '${name}' is not a node in libraryDen.glb. The file has: ${[...parts.keys()].sort().join(', ')}.`);
  }
  return part;
}

/** Every node name in the file. */
export function libraryDenPartNames(): readonly string[] {
  return [...parts.keys()];
}

/** The extent of the named nodes' vertices, in the asset's frame. */
export function denKitBounds(names: readonly string[], keep?: (x: number, y: number, z: number) => boolean): KitBounds {
  return glbBounds(names.map(libraryDenPart), keep);
}

function denFirstHit(names: readonly string[], origin: Vector3, direction: Vector3): number | null {
  return glbFirstHit(names.map(libraryDenPart), origin, direction);
}

// ---------------------------------------------------------------------------
// The den's nodes
// ---------------------------------------------------------------------------

/** The room: its floor slab, three walls, the lintel over its doorway, the niche boards and backs, the stars and the moon. */
export const LIBRARY_DEN_ROOM_NODES = [
  'den-floor',
  'den-wallWest',
  'den-wallNorth',
  'den-wallSouth',
  'den-lintel',
  'den-shelves',
  'den-nicheBacks',
  'den-stars',
  'den-moon',
] as const;

export const LIBRARY_DEN_LANTERN_NODES = ['denLantern-bracket', 'denLantern-glow'] as const;

export const LIBRARY_SECRET_BOOK_NODES = ['secretBook-cover', 'secretBook-pages', 'secretBook-star'] as const;

// ---------------------------------------------------------------------------
// The den's plan
// ---------------------------------------------------------------------------

/**
 * One book niche cut into a far wall, measured — in **its own frame**, the
 * frame `libraryBookcaseSize` describes a case in: origin on the wall's inner
 * face at the niche's middle, at floor level; X along the wall; +Z out of the
 * niche into the den. So a row of the kit's book blocks fills it with the
 * same arithmetic that fills a case: spines at `boardFront` less the spine
 * inset, between `±innerHalf`, on each `shelfTops` entry.
 */
export interface LibraryDenNiche {
  /** Which far wall it is cut into: `west` (opposite the doorway) or `north` (the long run past it). */
  readonly wall: 'west' | 'north';
  /** The niche's middle on the wall's inner face, in the den's frame, at floor level. */
  readonly centre: { readonly x: number; readonly z: number };
  /** The yaw (`Player.facing` degrees: 0 along +Z, 90 along +X) that turns the niche's +Z out of its wall, in the den's frame. */
  readonly facing: number;
  /** The clear width between the niche's reveals. */
  readonly length: number;
  /** How deep the niche runs behind the wall's face, to its back panel. */
  readonly depth: number;
  /** The opening's clear height, from its bottom reveal to its top. */
  readonly height: number;
  /** Each board's top surface, metres above the den's floor: books stand on these. */
  readonly shelfTops: readonly number[];
  /** The clear height above each board, to whatever is over it. */
  readonly shelfClear: readonly number[];
  /** Half the clear width: a row of books fits between `±innerHalf`. */
  readonly innerHalf: number;
  /** The boards' front edge, niche-local z — a hair behind the wall's face (negative), so a spine stands just inside the opening. */
  readonly boardFront: number;
}

/**
 * **The drawn den's plan**, in the asset's frame — origin at the middle of its
 * doorway on the reading room's west wall's centre line, at the bottom of the
 * den's floor slab; +Z out through the doorway into the room; +X along the
 * wall toward the den's longer run (north, in the room) — measured off the
 * kit's bare vertices. What the den's colliders, its walkable plate, its
 * doorway's lintel band and its book niches are all built from.
 *
 * In the room (`layout.ts`'s frame) the den stands at `(-LIBRARY_HALF_X, 0,
 * LIBRARY_SECRET_BOOKCASE.at.z)` with `rotation.y = +π/2`: asset +Z → room +X,
 * asset +X → room −Z. Every figure below is held to `layout.ts`'s own
 * (`LIBRARY_DEN_DEPTH`, `LIBRARY_DEN_DOOR_HALF`, `DEN_NORTH_PAST_DOOR`,
 * `LIBRARY_WALL_HALF`, `LIBRARY_WALL_HEIGHT`) by the den's builder, which
 * throws on a mismatch rather than leaving a drawn wall off its collider.
 */
export interface LibraryDenPlan {
  /** The walkable floor: the slab's top, above the asset's origin (its base). Place the asset `floorTop` below the room's floor. */
  readonly floorTop: number;
  /** The slab's plan, for the walkable plate: it abuts the reading room floor's apron edge on its +Z side. */
  readonly floor: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  /** Half the walls' thickness — the lintel's, which is the room wall's — and the walls' height above the floor. */
  readonly wallHalf: number;
  readonly wallHeight: number;
  /** Half the doorway's clear width: the lintel's span, which is the secret shelf's length. */
  readonly doorHalf: number;
  /** The lintel's underside and top, above the floor: the shut shelf's top to the wall's top. */
  readonly lintelBase: number;
  readonly lintelTop: number;
  /** From the doorway wall's outer face (−wallHalf) to the far wall's inner face. */
  readonly depth: number;
  /** The far wall's inner face, asset z (= −(wallHalf + depth)). */
  readonly farInnerZ: number;
  /** The side walls' inner faces, asset x: the north wall runs on past the doorway's north edge, the south wall is flush with its south edge. */
  readonly northInnerX: number;
  readonly southInnerX: number;
  readonly northPastDoor: number;
  readonly southPastDoor: number;
  /** The book niches, west wall first (south to north), then the north wall (doorway to the far corner). */
  readonly niches: readonly LibraryDenNiche[];
  /** The furthest any drawn vertex stands from the origin in plan — the far corner, walls included. */
  readonly reach: number;
  /** The tallest drawn point above the origin. */
  readonly height: number;
}

interface TreadPatch {
  readonly y: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Every flat, up-facing triangle of the boards, unmerged — so niches can be told apart by where their boards lie. */
function boardPatches(): TreadPatch[] {
  const ab = new Vector3();
  const ac = new Vector3();
  const patches: TreadPatch[] = [];
  eachGlbTriangle(libraryDenPart('den-shelves'), (a, b, c) => {
    const normal = ab.subVectors(b, a).cross(ac.subVectors(c, a));
    const length = normal.length();
    if (length < 1e-9 || normal.y / length < 0.999) return;
    patches.push({
      y: (a.y + b.y + c.y) / 3,
      minX: Math.min(a.x, b.x, c.x),
      maxX: Math.max(a.x, b.x, c.x),
      minZ: Math.min(a.z, b.z, c.z),
      maxZ: Math.max(a.z, b.z, c.z),
    });
  });
  return patches;
}

function measureNiches(floorTop: number, farInnerZ: number, northInnerX: number): LibraryDenNiche[] {
  // A board on the far wall lies behind that wall's inner face (z below it);
  // one on the north wall lies behind the north wall's face (x beyond it). The
  // boards of one niche all span the same stretch along their wall, and the
  // piers between niches keep the stretches apart, so merging overlapping
  // stretches per wall finds the niches without any typed count.
  const patches = boardPatches();
  if (patches.length === 0) throw new Error('libraryDenKit: den-shelves has no flat tread to measure');
  const clusters: { wall: 'west' | 'north'; from: number; to: number; patches: TreadPatch[] }[] = [];
  for (const patch of patches) {
    const wall: 'west' | 'north' = patch.maxZ < farInnerZ + 1e-6 ? 'west' : 'north';
    if (wall === 'north' && patch.minX < northInnerX - 1e-6) {
      throw new Error(`libraryDenKit: a board at x ${patch.minX.toFixed(3)}, z ${patch.maxZ.toFixed(3)} lies in neither far wall`);
    }
    const [from, to] = wall === 'west' ? [patch.minX, patch.maxX] : [patch.minZ, patch.maxZ];
    const mine = clusters.find((cluster) => cluster.wall === wall && from < cluster.to + 1e-6 && to > cluster.from - 1e-6);
    if (mine) {
      mine.from = Math.min(mine.from, from);
      mine.to = Math.max(mine.to, to);
      mine.patches.push(patch);
    } else {
      clusters.push({ wall, from, to, patches: [patch] });
    }
  }
  clusters.sort((p, q) => (p.wall === q.wall ? (p.wall === 'west' ? p.from - q.from : q.to - p.to) : p.wall === 'west' ? -1 : 1));

  const solidNames = ['den-wallWest', 'den-wallNorth', 'den-shelves', 'den-nicheBacks'];
  return clusters.map((cluster) => {
    const along = (cluster.from + cluster.to) / 2;
    const tops = [...new Set(cluster.patches.map((patch) => Math.round(patch.y * 1000)))].sort((a, b) => a - b).map((key) => key / 1000);
    const lowest = tops[0];
    if (lowest === undefined) throw new Error('libraryDenKit: a niche with no board');
    // The niche's own frame: X along the wall, +Z out of the wall. Rays in the
    // den's frame, converted back.
    const west = cluster.wall === 'west';
    const face = west ? farInnerZ : northInnerX;
    // The boards' own extent (their bevelled edges included, as
    // `libraryBookcaseSize` reads a case's), not the flat tread's: every
    // vertex of the boards that lies along this niche, behind its wall.
    const boards = denKitBounds(['den-shelves'], (x, y, z) => {
      const alongAt = west ? x : z;
      const behind = west ? z <= face + 1e-6 : x >= face - 1e-6;
      return behind && alongAt >= cluster.from - 0.05 && alongAt <= cluster.to + 0.05 && y >= lowest - 0.1;
    });
    const boardFrontDen = west ? boards.maxZ : boards.minX;
    const boardFront = west ? boardFrontDen - face : face - boardFrontDen;
    const boardBackDen = west ? boards.minZ : boards.maxX;
    const depthToBoardBack = Math.abs(boardBackDen - face);
    // Into the niche: a point a book's own depth in from the face.
    const probeDepth = -0.1;
    const denPoint = (alongAt: number, y: number, inward: number): Vector3 =>
      west ? new Vector3(alongAt, y, face + inward) : new Vector3(face - inward, y, alongAt);
    const up = new Vector3(0, 1, 0); // flat-ok: up the den kit's own unplaced asset frame, object-local
    const shelfClear = tops.map((top) => {
      const hit = denFirstHit(solidNames, denPoint(along, top + 0.005, probeDepth), up);
      if (hit === null) throw new Error(`libraryDenKit: nothing over the ${cluster.wall} niche's board at ${top.toFixed(3)}`);
      return hit + 0.005;
    });
    const sideA = west ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
    const sideB = sideA.clone().negate();
    const chest = denPoint(along, lowest + 0.1, probeDepth);
    const a = denFirstHit(['den-wallWest', 'den-wallNorth'], chest, sideA);
    const b = denFirstHit(['den-wallWest', 'den-wallNorth'], chest, sideB);
    if (a === null || b === null) throw new Error(`libraryDenKit: no reveal found either side of the ${cluster.wall} niche at ${along.toFixed(3)}`);
    const innerHalf = Math.min(a, b);
    // The niche's clear height: from its bottom reveal (under the lowest
    // board) to its top, by rays down and up from the lowest row's middle.
    const down = denFirstHit(['den-wallWest', 'den-wallNorth'], denPoint(along, lowest - 0.005, probeDepth), up.clone().negate());
    const over = denFirstHit(['den-wallWest', 'den-wallNorth'], denPoint(along, lowest + 0.1, probeDepth), up);
    if (down === null || over === null) throw new Error(`libraryDenKit: the ${cluster.wall} niche at ${along.toFixed(3)} has no bottom or top reveal`);
    const bottom = lowest - 0.005 - down;
    const top = lowest + 0.1 + over;
    // How deep the niche runs: a ray from just in front of the face into it, to the back panel.
    const back = denFirstHit(solidNames, denPoint(along, lowest + 0.25, 0.01), west ? new Vector3(0, 0, -1) : new Vector3(1, 0, 0));
    if (back === null) throw new Error(`libraryDenKit: the ${cluster.wall} niche at ${along.toFixed(3)} has no back`);
    const depth = back - 0.01;
    if (depth < depthToBoardBack - 1e-3) throw new Error(`libraryDenKit: the ${cluster.wall} niche's boards run ${depthToBoardBack.toFixed(3)} m back, past its back panel at ${depth.toFixed(3)}`);
    return {
      wall: cluster.wall,
      centre: west ? { x: along, z: face } : { x: face, z: along },
      facing: west ? 0 : 270,
      length: innerHalf * 2,
      depth,
      height: top - bottom,
      shelfTops: tops.map((y) => y - floorTop),
      shelfClear,
      innerHalf,
      boardFront,
    };
  });
}

function measureDen(): LibraryDenPlan {
  const floor = denKitBounds(['den-floor']);
  const lintel = denKitBounds(['den-lintel']);
  const west = denKitBounds(['den-wallWest']);
  const north = denKitBounds(['den-wallNorth']);
  const south = denKitBounds(['den-wallSouth']);
  const floorTop = floor.maxY;
  if (Math.abs(lintel.minX + lintel.maxX) > 1e-3 || Math.abs(lintel.minZ + lintel.maxZ) > 1e-3) {
    throw new Error(`libraryDenKit: the doorway's middle is not the asset's origin (lintel x ${lintel.minX.toFixed(3)}..${lintel.maxX.toFixed(3)}, z ${lintel.minZ.toFixed(3)}..${lintel.maxZ.toFixed(3)})`);
  }
  const wallHalf = (lintel.maxZ - lintel.minZ) / 2;
  const doorHalf = (lintel.maxX - lintel.minX) / 2;
  if (Math.abs(doorHalf * 2 - LIBRARY_SHELF_FOOTPRINT.length) > 0.005) {
    throw new Error(
      `libraryDenKit: the den's doorway is ${(doorHalf * 2).toFixed(3)} m wide and the drawn bookcase that fills it is ${LIBRARY_SHELF_FOOTPRINT.length.toFixed(3)} m long`,
    );
  }
  if (Math.abs(lintel.minY - floorTop - LIBRARY_SHELF_FOOTPRINT.height) > 0.005) {
    throw new Error(`libraryDenKit: the lintel's base is ${(lintel.minY - floorTop).toFixed(3)} m up and the shut shelf's top is ${LIBRARY_SHELF_FOOTPRINT.height.toFixed(3)}`);
  }
  // The far wall's inner face is the nearest it comes to the doorway; the
  // side walls' inner faces likewise — nothing of a wall node stands proud of
  // its own face (the niches are cut into it).
  const farInnerZ = west.maxZ;
  const northInnerX = north.minX;
  const southInnerX = south.maxX;
  const wallHeight = west.maxY - floorTop;
  if (Math.abs(north.maxY - west.maxY) > 1e-6 || Math.abs(south.maxY - west.maxY) > 1e-6 || Math.abs(lintel.maxY - west.maxY) > 1e-6) {
    throw new Error('libraryDenKit: the den\'s walls and lintel do not share a top');
  }
  let reach = 0;
  let height = 0;
  for (const name of LIBRARY_DEN_ROOM_NODES) {
    eachGlbVertex(libraryDenPart(name), (x, y, z) => {
      reach = Math.max(reach, Math.hypot(x, z));
      height = Math.max(height, y);
    });
  }
  return {
    floorTop,
    floor: { minX: floor.minX, maxX: floor.maxX, minZ: floor.minZ, maxZ: floor.maxZ },
    wallHalf,
    wallHeight,
    doorHalf,
    lintelBase: lintel.minY - floorTop,
    lintelTop: lintel.maxY - floorTop,
    depth: -farInnerZ - wallHalf,
    farInnerZ,
    northInnerX,
    southInnerX,
    northPastDoor: northInnerX - doorHalf,
    southPastDoor: -doorHalf - southInnerX,
    niches: measureNiches(floorTop, farInnerZ, northInnerX),
    reach,
    height,
  };
}

/** The den's plan, measured once at load. */
export const LIBRARY_DEN_PLAN: LibraryDenPlan = measureDen();
