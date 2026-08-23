import {
  BackSide,
  BufferGeometry,
  Color,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
  type BufferAttribute,
  type Material,
  type Texture,
} from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ART } from './artPalette';

/**
 * The house material system for Land of Good Places.
 *
 * ONE decision underpins the whole look: **toy objects are toon-shaded, the
 * ground is not.** Characters, creatures, props, shop shells and ride parts use
 * {@link toonMaterial} — banded, flat, sticker-bright. Terrain, water and glass
 * keep `MeshStandardMaterial`, because banding a 140-metre lawn looks like a
 * rendering bug rather than a style.
 *
 * The ramp is deliberately gentle. Hard two-tone cel shading reads as "anime
 * action", not "soft plush toy": the lit side must stay the true palette colour
 * and the shadow side must stay obviously the same colour, only cosier.
 */

/**
 * The shared toon ramp: four bands, in LINEAR light space.
 *
 * Band boundaries land at N·L = -0.5, 0.0 and +0.5, so a sphere gets a wide lit
 * cap, two thin transition crescents and a soft terminator. Perceived (sRGB)
 * brightness of the bands is roughly 68% / 82% / 94% / 100% — shadows that
 * *shape* the form without ever going murky.
 *
 * Do not darken these. Every time someone drops the first band below ~0.35 the
 * park starts to look like it is under a storm cloud.
 */
export const TOON_RAMP = [0.42, 0.64, 0.85, 1.0] as const;

// =============================================================================
// Ownership: who is allowed to free what.
//
// {@link disposeTree} walks a subtree and frees its GPU resources. That is only
// safe for resources the subtree OWNS. This game leans hard on module-level
// caches — one toon ramp for every material in the park (`toonRamp` below), one
// face per pet species (`sharedFace.ts`), one canvas per wall pattern
// (`core/textures.ts`) — and freeing one of those because a single wearer of it
// was thrown away corrupts every *other* wearer. That is a far worse bug than
// the leak it would be fixing, and it is invisible until something re-renders.
//
// So resources carry their ownership on `userData`:
//
//  - {@link markShared} — "a cache owns me; never free me from a tree walk."
//    Applied at the point of caching, so a new cache cannot forget it by being
//    added somewhere `disposeTree` was never considered.
//  - {@link ownTextures} — "this material owns these textures even though it is
//    not currently pointing at them." The face system needs this: a face patch
//    paints FIVE expression canvases and `material.map` only ever references
//    one of them, so scanning the material's slots finds a fifth of the leak.
//
// Caches free their own resources through their own teardown functions
// (`disposeMaterialCache`, `disposeSharedFaces`), which is the only correct
// place to do it.
// =============================================================================

const SHARED_FLAG = 'lgpShared';
const OWNED_TEXTURES = 'lgpOwnedTextures';

interface HasUserData {
  userData: Record<string, unknown>;
}

/** Marks a cached texture/geometry/material so {@link disposeTree} leaves it alone. */
export function markShared<T extends HasUserData>(resource: T): T {
  resource.userData[SHARED_FLAG] = true;
  return resource;
}

/** True if `resource` belongs to a module-level cache — see {@link markShared}. */
export function isShared(resource: Partial<HasUserData> | null | undefined): boolean {
  return resource?.userData?.[SHARED_FLAG] === true;
}

/**
 * Declares textures a material owns but does not currently reference.
 *
 * Only needed where a material swaps between several textures it alone paid
 * for — expression sets, essentially. A texture that is always in a material
 * slot (`map`, `emissiveMap`, …) needs nothing: {@link disposeTree} finds it by
 * scanning the slots.
 */
export function ownTextures(material: Material, textures: Iterable<Texture>): void {
  (material as unknown as HasUserData).userData[OWNED_TEXTURES] = [...textures];
}

let rampTexture: DataTexture | null = null;

/** The shared 4-step gradient map. Built once, reused by every toon material. */
export function toonRamp(): DataTexture {
  if (rampTexture) return rampTexture;
  const data = new Uint8Array(TOON_RAMP.length);
  for (let i = 0; i < TOON_RAMP.length; i += 1) {
    data[i] = Math.round((TOON_RAMP[i] ?? 1) * 255);
  }
  const texture = new DataTexture(data, TOON_RAMP.length, 1, RedFormat, UnsignedByteType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  // The single most important `markShared` in the game: this one texture is the
  // `gradientMap` of EVERY toon material there is. A `disposeTree` that freed it
  // would blank the whole park's shading, not just the tree it was called on.
  markShared(texture);
  rampTexture = texture;
  return texture;
}

export interface ToonOptions {
  /** Optional canvas map (face patches, jumper decals, wall stone…). */
  map?: Texture;
  /** Use for face patches and any cut-out decal. */
  transparent?: boolean;
  /** Self-lit amount — for fairy lights, eyes-in-the-dark, ride bulbs. */
  emissive?: number;
  emissiveIntensity?: number;
  /** Set false for decals that sit on top of another surface. */
  depthWrite?: boolean;
  opacity?: number;
  side?: typeof BackSide | 0 | 2;
}

/**
 * The default material for every toy object in the park.
 *
 * `MeshToonMaterial` + the shared ramp. No roughness, no metalness, no
 * specular — a toy in this park is matte painted wood, not plastic.
 */
export function toonMaterial(colour: number, options: ToonOptions = {}): MeshToonMaterial {
  const material = new MeshToonMaterial({
    color: colour,
    gradientMap: toonRamp(),
  });
  if (options.map) material.map = options.map;
  if (options.transparent) {
    material.transparent = true;
    material.depthWrite = options.depthWrite ?? false;
  }
  if (options.depthWrite !== undefined) material.depthWrite = options.depthWrite;
  if (options.opacity !== undefined) material.opacity = options.opacity;
  if (options.emissive !== undefined) {
    material.emissive = new Color(options.emissive);
    material.emissiveIntensity = options.emissiveIntensity ?? 1;
  }
  if (options.side !== undefined) material.side = options.side;
  return material;
}

/**
 * The ground/water/glass material — kept from the existing world code so the
 * terrain does not band. Matches `CharacterModel.softMaterial` exactly.
 */
export function softMaterial(colour: number, roughness = 0.62): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: colour, roughness, metalness: 0 });
}

/**
 * Mixes a colour towards the ink plum and darkens it — the outline colour.
 *
 * Outlines are NEVER black. A black line around a pastel yellow mouse makes it
 * look like clip-art; a dark-plum-yellow line makes it look like it was painted
 * by hand.
 */
export function inkTint(colour: number, amount = 0.62): number {
  return new Color(colour).lerp(new Color(ART.ink), amount).multiplyScalar(0.86).getHex();
}

/**
 * Builds the inverted-hull outline shell for a geometry.
 *
 * Vertices are pushed along their own normals by `thickness` **in local metres**,
 * then drawn back-face-only. Because the push is baked into the geometry rather
 * than done with `mesh.scale`, the line stays an even width on squashed and
 * stretched parts — which matters, since almost every part of every character
 * here is a squashed sphere.
 */
export function outlineGeometry(geometry: BufferGeometry, thickness: number): BufferGeometry {
  const clone = geometry.clone();
  const position = clone.getAttribute('position') as BufferAttribute | undefined;
  const normal = clone.getAttribute('normal') as BufferAttribute | undefined;
  if (!position || !normal) return clone;
  for (let i = 0; i < position.count; i += 1) {
    position.setXYZ(
      i,
      position.getX(i) + normal.getX(i) * thickness,
      position.getY(i) + normal.getY(i) * thickness,
      position.getZ(i) + normal.getZ(i) * thickness,
    );
  }
  position.needsUpdate = true;
  clone.computeBoundingSphere();
  return clone;
}

/**
 * Gives a mesh a hand-painted outline and returns the outline mesh.
 *
 * Only apply this to parts that define the **silhouette** — head, body, ears,
 * limbs, big props. Outlining every little sphere fills the character with
 * internal lines and it stops reading as one creature.
 */
export function addOutline(mesh: Mesh, thickness = 0.016, colour?: number): Mesh {
  return addOutlineFromGeometry(mesh, mesh.geometry, thickness, colour);
}

/**
 * {@link addOutline} for a mesh whose geometry has **hard edges or an apex** —
 * a cone, an extrusion, anything with duplicated vertices carrying per-face
 * normals.
 *
 * The plain inverted hull pushes every vertex along its *own* normal, so a
 * cone's apex — one point stored as a ring of duplicates, each with a
 * different normal — is blown apart into a fan of dark flaps with gaps
 * between them. Invisible at a few centimetres; at the keychains' 2.5x worn
 * scale it read as a broken outline hanging off the strawberry's tip (Jim's
 * screenshot, 23 August 2026). Welding the duplicates and re-deriving
 * smooth (averaged) normals first gives the push one direction per *point*,
 * so the hull stays closed and hugs the silhouette. Only the outline copy is
 * welded — the visible mesh keeps its own crisp shading normals.
 */
export function addSmoothOutline(mesh: Mesh, thickness = 0.016, colour?: number): Mesh {
  const source = mesh.geometry.clone();
  // `mergeVertices` only welds bit-identical vertices, and the duplicates at
  // a hard edge differ in exactly the attribute being fixed — the normal. An
  // outline never reads normals-as-shading or UVs, so drop both and weld on
  // position alone.
  source.deleteAttribute('normal');
  source.deleteAttribute('uv');
  const welded = mergeVertices(source);
  welded.computeVertexNormals();
  return addOutlineFromGeometry(mesh, welded, thickness, colour);
}

/** The shared tail of {@link addOutline}/{@link addSmoothOutline}. */
function addOutlineFromGeometry(
  mesh: Mesh,
  geometry: BufferGeometry,
  thickness: number,
  colour?: number,
): Mesh {
  const base = (mesh.material as { color?: Color }).color;
  const tint = colour ?? inkTint(base ? base.getHex() : ART.ink);
  const outline = new Mesh(
    outlineGeometry(geometry, thickness),
    new MeshBasicMaterial({ color: tint, side: BackSide }),
  );
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.renderOrder = -1;
  mesh.add(outline);
  return outline;
}

/** Marks a mesh as a solid, shadow-casting part of the world. */
export function solid<T extends Mesh>(mesh: T): T {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Marks a mesh as a decal / shine / glow: lit, but casts and catches nothing. */
export function decal<T extends Mesh>(mesh: T): T {
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/** Frees the shared ramp. Only needed when tearing everything down. */
export function disposeMaterialCache(): void {
  rampTexture?.dispose();
  rampTexture = null;
}

/** Frees `texture` unless a cache owns it, or this walk has already freed it. */
function disposeTexture(value: unknown, freed: Set<Texture>): void {
  const texture = value as (Texture & { isTexture?: boolean }) | null | undefined;
  if (!texture || texture.isTexture !== true) return;
  if (isShared(texture) || freed.has(texture)) return;
  freed.add(texture);
  texture.dispose();
}

/**
 * Frees a material and every texture it owns.
 *
 * The slots are found by scanning the material's own properties for anything
 * with `isTexture`, rather than by listing `map`, `emissiveMap`, `alphaMap` and
 * the rest by hand: a hand-written list is a list somebody will forget to
 * extend, and the whole reason this function exists is that the old one only
 * ever looked at `map`.
 */
function disposeMaterial(material: Material, freed: Set<Texture>): void {
  if (isShared(material)) return;
  const owned = (material as unknown as HasUserData).userData[OWNED_TEXTURES];
  if (Array.isArray(owned)) for (const texture of owned) disposeTexture(texture, freed);
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    disposeTexture(value, freed);
  }
  material.dispose();
}

/**
 * Frees a mesh tree built by an asset factory: geometries, materials, and the
 * materials' textures.
 *
 * **Textures were the missing third of this** until 27 July 2026. The character
 * creator's preview rebuilds its kid from scratch on every single tap — every
 * swatch, every hat, every pet — and each rebuild paints a fresh set of five
 * 512² face canvases (`faces.ts`, `paintExpressions`). Disposing only geometry
 * and materials left all five stranded on the GPU, so a child idly trying on
 * hats could run a phone out of texture memory before ever reaching the park.
 *
 * Shared resources are skipped — see the ownership note at the top of this file.
 * That is not a nicety: the pet models the same preview builds wear a face from
 * `sharedFace.ts`, whose geometry AND textures are cached across every pet in
 * the game, and this function was already freeing that shared geometry.
 */
export function disposeTree(root: { traverse(cb: (o: unknown) => void): void }): void {
  const freed = new Set<Texture>();
  root.traverse((object) => {
    const mesh = object as Partial<Mesh>;
    if (mesh.geometry && !isShared(mesh.geometry)) mesh.geometry.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(material)) for (const one of material) disposeMaterial(one, freed);
    else if (material) disposeMaterial(material, freed);
  });
}
