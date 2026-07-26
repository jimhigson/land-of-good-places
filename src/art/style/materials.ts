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
  const base = (mesh.material as { color?: Color }).color;
  const tint = colour ?? inkTint(base ? base.getHex() : ART.ink);
  const outline = new Mesh(
    outlineGeometry(mesh.geometry, thickness),
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

/** Convenience for disposing a mesh tree built by an asset factory. */
export function disposeTree(root: { traverse(cb: (o: unknown) => void): void }): void {
  root.traverse((object) => {
    const mesh = object as Partial<Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else material?.dispose();
  });
}
