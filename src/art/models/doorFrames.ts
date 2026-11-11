/**
 * **A doorway frame round an interior's way out** — no door, just the frame,
 * so a child can see from across the room where the exit is.
 *
 * Jim, 11 November 2026: *"in the game when in interior spaces the exit to
 * outside is usually a door in a hidden wall, with no visual indicator where
 * the door is."* The hotel lobby's, the Reptile House's and the library's way
 * out are all gaps in the wall nearest the camera — the wall that is hidden so
 * the fixed camera can see in — so nothing at all was drawn there. The
 * castle's is in a drawn wall, but behind its porch roof.
 *
 * The geometry is the 3D Artist's (`art/blend/doorframes_build.py` →
 * `doorframes.glb`): per style, a **post** (stood once each side), a **lintel
 * tile** (repeated across the posts and the gap) and a **crest** (once, on the
 * lintel's middle). This file knows **no opening**: every room hands its own
 * gap, from its own owner, to {@link buildDoorFrame}, and every figure about
 * the frame itself — a post's width, depth and height, a tile's width and
 * height — is **measured** off the shipped geometry here, so the kit is the one
 * owner of those.
 *
 * ## Placed round the gap, never in it
 *
 * Each post's inner face stands **on** its gap edge, so the clear opening is
 * exactly the gap the room's own walls leave — the frame narrows nothing.
 * `check:doorframes` walks a player-sized body through every opening, both
 * ways, at 5 cm and at `PLAYER_LONGEST_STEP`, with and without the frame, and
 * holds the two to the same lanes; its control narrows a frame and must go red.
 *
 * ## Solid, from the drawn shape
 *
 * {@link registerDoorFrameSolids} gives each post a box over its drawn
 * footprint (moss and all) to the lintel's top, which is what stands over it,
 * and the lintel a box **banded** from its underside to its top, so only a
 * flier ever meets it — a walker and a jump pass under (`Collision.ts`'s
 * `baseHeight`). Nothing about the frame is in the route lattice: the posts
 * stand where each wall's own collider already was, and a banded box is never
 * stamped.
 *
 * ## No face in a wall's plane
 *
 * `check:coplanar` sweeps hidden meshes too, and a post's inner face on the
 * gap edge is exactly where the hidden wall's end face was. So each room draws
 * its wall short of the gap by {@link doorFramePostWidth} — the post's own
 * width, asked of the kit — and the post's outer face meets the wall's end
 * face back to back (opposite normals never fight). The wall's **collider** is
 * untouched.
 */
import { BufferGeometry, Group, Mesh, type Material } from 'three';
import { PALETTE } from '../../core/palette';
import { ART } from '../style/artPalette';
import { DOORFRAMES_GLB_BASE64 } from '../assets/doorframesGlb';
import { base64ToArrayBuffer, readGlbParts, type GlbPart } from '../style/glb';
import { addOutline, markShared, solid, toonMaterial } from '../style/materials';
import type { BoxCollider, CollisionWorld } from '../../world/Collision';

/** The four interiors with a way out to the park, one style each. */
export type DoorFrameStyle = 'hotel' | 'library' | 'reptile' | 'castle';
export const DOOR_FRAME_STYLES: readonly DoorFrameStyle[] = ['hotel', 'library', 'reptile', 'castle'];

/**
 * **Every node's colour and outline** — the loader's to own, the kit is shape
 * only. `doorframes_render.py` reads this table (by its `colour:` keys) so the
 * review renders are the game's colours.
 */
const DOORFRAME_NODE_STYLES: Readonly<Record<string, { readonly colour: number; readonly outline?: number }>> = {
  // The lobby: painted cream trim, a pink fan bonnet, a gold star.
  'doorframe-hotel-post': { colour: ART.cream, outline: 0.018 },
  'doorframe-hotel-lintel': { colour: ART.cream, outline: 0.018 },
  'doorframe-hotel-crest': { colour: PALETTE.markerPink, outline: 0.018 },
  'doorframe-hotel-crest-star': { colour: PALETTE.flowerYellow },
  // The library: books in the reading room's own jolly spine colours.
  'doorframe-library-post-a': { colour: PALETTE.markerSky, outline: 0.016 },
  'doorframe-library-post-b': { colour: ART.jumperRed, outline: 0.016 },
  'doorframe-library-post-c': { colour: PALETTE.markerMint, outline: 0.016 },
  'doorframe-library-lintel-a': { colour: PALETTE.markerLemon, outline: 0.016 },
  'doorframe-library-lintel-b': { colour: PALETTE.markerLilac, outline: 0.016 },
  'doorframe-library-lintel-c': { colour: PALETTE.markerPink, outline: 0.016 },
  'doorframe-library-crest-cover': { colour: ART.jumperRed, outline: 0.016 },
  'doorframe-library-crest-pages': { colour: ART.cream },
  // The Reptile House: warm sandstone with moss, and a green snake.
  'doorframe-reptile-post': { colour: PALETTE.stonePinkLight, outline: 0.018 },
  'doorframe-reptile-post-moss': { colour: PALETTE.leafLight },
  'doorframe-reptile-lintel': { colour: PALETTE.leafMid, outline: 0.016 },
  'doorframe-reptile-lintel-spots': { colour: PALETTE.flowerYellow },
  'doorframe-reptile-crest': { colour: PALETTE.leafMid, outline: 0.016 },
  'doorframe-reptile-crest-eyes': { colour: PALETTE.eyeWhite },
  'doorframe-reptile-crest-pupils': { colour: PALETTE.ink },
  'doorframe-reptile-crest-tongue': { colour: PALETTE.flowerRed },
  // The castle: pale grey stone, a darker keystone.
  'doorframe-castle-post': { colour: PALETTE.stoneGreyLight, outline: 0.018 },
  'doorframe-castle-lintel': { colour: PALETTE.stoneGreyLight, outline: 0.018 },
  'doorframe-castle-crest': { colour: PALETTE.stoneGreyMid, outline: 0.018 },
};

/** Dressing on a post — drawn and solid, but not what the lintel sits on. */
const DRESSING_SUFFIX = '-moss';

interface KitStyle {
  readonly posts: readonly GlbPart[];
  readonly lintels: readonly GlbPart[];
  readonly crests: readonly GlbPart[];
  /** A post's footprint, every node of it: half-width across, half-depth. */
  readonly postHalfX: number;
  readonly postHalfZ: number;
  /** Where the lintel sits: the post's own top, dressing aside. */
  readonly seat: number;
  /** One lintel tile: its width across, height and half-depth. */
  readonly tileWidth: number;
  readonly lintelHeight: number;
  readonly lintelHalfZ: number;
}

let decoded: Map<string, KitStyle> | null = null;
const materials = new Map<string, Material>();

function boundsOf(parts: readonly GlbPart[]): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } {
  const out = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    const box = part.geometry.boundingBox;
    if (!box) continue;
    out.minX = Math.min(out.minX, box.min.x);
    out.maxX = Math.max(out.maxX, box.max.x);
    out.minY = Math.min(out.minY, box.min.y);
    out.maxY = Math.max(out.maxY, box.max.y);
    out.minZ = Math.min(out.minZ, box.min.z);
    out.maxZ = Math.max(out.maxZ, box.max.z);
  }
  return out;
}

/** The kit, decoded once and measured — every figure below is read off it. */
function kit(style: DoorFrameStyle): KitStyle {
  if (!decoded) {
    const parts = readGlbParts(base64ToArrayBuffer(DOORFRAMES_GLB_BASE64));
    decoded = new Map();
    for (const name of DOOR_FRAME_STYLES) {
      const prefix = `doorframe-${name}-`;
      const of = (role: string): GlbPart[] =>
        [...parts.values()].filter((p) => p.name === `${prefix}${role}` || p.name.startsWith(`${prefix}${role}-`)).sort((a, b) => a.name.localeCompare(b.name));
      const posts = of('post');
      const lintels = of('lintel');
      const crests = of('crest');
      if (posts.length === 0 || lintels.length === 0 || crests.length === 0) {
        throw new Error(`doorFrames: doorframes.glb has no ${name} post, lintel or crest — run \`pnpm run blend:doorframes\``);
      }
      for (const part of [...posts, ...lintels, ...crests]) {
        if (!DOORFRAME_NODE_STYLES[part.name]) throw new Error(`doorFrames: ${part.name} has no colour in DOORFRAME_NODE_STYLES`);
        markShared(part.geometry);
      }
      const post = boundsOf(posts);
      const stone = boundsOf(posts.filter((p) => !p.name.endsWith(DRESSING_SUFFIX)));
      const lintel = boundsOf(lintels);
      decoded.set(name, {
        posts,
        lintels,
        crests,
        postHalfX: Math.max(-post.minX, post.maxX),
        postHalfZ: Math.max(-post.minZ, post.maxZ),
        seat: stone.maxY,
        tileWidth: lintel.maxX - lintel.minX,
        lintelHeight: lintel.maxY,
        lintelHalfZ: Math.max(-lintel.minZ, lintel.maxZ),
      });
    }
  }
  const found = decoded.get(style);
  if (!found) throw new Error(`doorFrames: no style ${style}`);
  return found;
}

/**
 * **A post's width across the wall** — how far each room draws its wall back
 * from the gap edge, so the post stands where the wall's end was and no two
 * faces share a plane. Measured, the drawn post's whole footprint.
 */
export function doorFramePostWidth(style: DoorFrameStyle): number {
  return kit(style).postHalfX * 2;
}

/** Where a frame goes: the gap, in the room's own frame, on a wall running along X. */
export interface DoorOpening {
  /** The gap's two edges along X — straight from the room's owner of its doorway. */
  readonly minX: number;
  readonly maxX: number;
  /** The wall's centre line. */
  readonly z: number;
  /** The floor under it. */
  readonly floorY: number;
}

/** A frame as built: its meshes, and the figures its colliders and its check need. */
export interface DoorFrame {
  readonly style: DoorFrameStyle;
  readonly group: Group;
  readonly opening: DoorOpening;
  /** Each post's drawn footprint, in the same frame as the opening. */
  readonly posts: readonly { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }[];
  /** The lintel's underside — the clear height of the opening — over the floor. */
  readonly clearHeight: number;
  /** The lintel's top over the floor. */
  readonly lintelTop: number;
  /** The lintel's half-depth about the wall line. */
  readonly lintelHalfZ: number;
  /** The highest anything in the frame reaches over the floor, crest included. */
  readonly top: number;
}

function partMesh(part: GlbPart): Mesh {
  const style = DOORFRAME_NODE_STYLES[part.name];
  if (!style) throw new Error(`doorFrames: ${part.name} has no colour`);
  let material = materials.get(part.name);
  if (!material) {
    material = markShared(toonMaterial(style.colour));
    materials.set(part.name, material);
  }
  const mesh = solid(new Mesh(part.geometry as BufferGeometry, material));
  mesh.name = part.name;
  if (style.outline !== undefined) addOutline(mesh, style.outline);
  return mesh;
}

/**
 * **Builds a frame round `opening`**, in the opening's own frame (the room's
 * local metres). Add `group` to the room; register the solids with
 * {@link registerDoorFrameSolids}.
 */
export function buildDoorFrame(style: DoorFrameStyle, opening: DoorOpening): DoorFrame {
  const k = kit(style);
  const group = new Group();
  group.name = `doorframe.${style}`;
  const w = k.postHalfX;
  const posts = [
    { centre: opening.minX - w },
    { centre: opening.maxX + w },
  ].map(({ centre }) => {
    for (const part of k.posts) {
      const mesh = partMesh(part);
      mesh.position.set(centre, opening.floorY, opening.z);
      group.add(mesh);
    }
    return { minX: centre - w, maxX: centre + w, minZ: opening.z - k.postHalfZ, maxZ: opening.z + k.postHalfZ };
  });

  // The lintel spans post to post, outer face to outer face, in whole tiles
  // stretched a little to fit exactly.
  const from = opening.minX - 2 * w;
  const to = opening.maxX + 2 * w;
  const span = to - from;
  const count = Math.max(1, Math.round(span / k.tileWidth));
  const stretch = span / (count * k.tileWidth);
  for (let i = 0; i < count; i += 1) {
    const x = from + (span * (i + 0.5)) / count;
    for (const part of k.lintels) {
      const mesh = partMesh(part);
      mesh.position.set(x, opening.floorY + k.seat, opening.z);
      mesh.scale.x = stretch;
      group.add(mesh);
    }
  }

  const middle = (opening.minX + opening.maxX) / 2;
  let crestTop = 0;
  for (const part of k.crests) {
    const mesh = partMesh(part);
    mesh.position.set(middle, opening.floorY + k.seat + k.lintelHeight, opening.z);
    group.add(mesh);
    part.geometry.computeBoundingBox();
    crestTop = Math.max(crestTop, part.geometry.boundingBox?.max.y ?? 0);
  }

  return {
    style,
    group,
    opening,
    posts,
    clearHeight: k.seat,
    lintelTop: k.seat + k.lintelHeight,
    lintelHalfZ: k.lintelHalfZ,
    top: k.seat + k.lintelHeight + Math.max(0, crestTop),
  };
}

/** The colliders {@link registerDoorFrameSolids} registered. */
export interface DoorFrameSolids {
  readonly posts: readonly BoxCollider[];
  readonly lintel: BoxCollider;
}

/**
 * **The frame's solids**, in world metres: `originX`/`originZ` take the
 * frame's local metres to the world (the room's origin, `originY` its height). Each post a crisp box
 * over its drawn footprint to the lintel's top, which is what stands over it;
 * the lintel a box over the opening **banded** from its underside — inert to
 * anyone on the floor, a walk or a jump (`baseHeight`).
 */
export function registerDoorFrameSolids(collision: CollisionWorld, frame: DoorFrame, originX: number, originZ: number, originY = 0): DoorFrameSolids {
  const floor = originY + frame.opening.floorY;
  return collision.kinded('door frame', () => {
    const posts = frame.posts.map((p) =>
      collision.addBox(
        originX + (p.minX + p.maxX) / 2,
        originZ + (p.minZ + p.maxZ) / 2,
        (p.maxX - p.minX) / 2,
        (p.maxZ - p.minZ) / 2,
        0,
        0,
        floor + frame.lintelTop,
        false,
        true,
      ),
    );
    const lintel = collision.addBox(
      originX + (frame.opening.minX + frame.opening.maxX) / 2,
      originZ + frame.opening.z,
      (frame.opening.maxX - frame.opening.minX) / 2,
      frame.lintelHalfZ,
      0,
      0,
      floor + frame.lintelTop,
      false,
      true,
      floor + frame.clearHeight,
    );
    return { posts, lintel };
  });
}

/**
 * **A wall's drawn spans, drawn back from a framed gap** by the post's width,
 * so each post stands where the wall's end was and no face of the one lies in
 * a face of the other (`check:coplanar`). A span ending on the gap's edge is
 * shortened; every other span, and every collider, is left exactly as it was.
 */
export function drawnClearOfFrame(
  drawn: readonly (readonly [number, number])[],
  gap: readonly [number, number],
  style: DoorFrameStyle,
): [number, number][] {
  const w = doorFramePostWidth(style);
  return drawn.map(([a, b]): [number, number] => [
    Math.abs(a - gap[1]) < 1e-6 ? a + w : a,
    Math.abs(b - gap[0]) < 1e-6 ? b - w : b,
  ]);
}

/** A frame as a room built it — what `check:doorframes` asks each room for. */
export interface PlacedDoorFrame {
  readonly frame: DoorFrame;
  readonly solids: DoorFrameSolids;
  /** The room's origin: the frame's local metres plus this are the world's. */
  readonly originX: number;
  readonly originZ: number;
  readonly originY: number;
}
