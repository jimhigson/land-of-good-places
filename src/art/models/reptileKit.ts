import { Mesh, type BufferAttribute } from 'three';
import { base64ToArrayBuffer, readGlbParts, type GlbPart } from '../style/glb';
import {
  addOutline,
  decal,
  markShared,
  solid,
  toonMaterial,
  type ToonOptions,
} from '../style/materials';

/**
 * **The six Reptile House kits share one loader**, so the second half of the
 * Artist↔Engineer contract (`castleAssets.ts`'s header) is written once rather
 * than six times: every node is dressed from a `STYLES` table keyed by node
 * name, a node with no entry throws at load, every geometry is `markShared`,
 * and a part's node transform (the hinge-origin nodes — Noodle's head, the
 * croc's jaw) is carried across with its shape.
 *
 * The `.glb`s carry shape and, for the painted heads and sign planks, UVs —
 * **no colour, no material**. Everything a reader could call "the look" is in
 * the kit files beside this one, where `art/blend/reptile_*_render.py` reads
 * it back for the review renders without copying a hex.
 */

/** How a part is dressed. Colour and shading only — never shape. */
export interface PartStyle {
  /** From `PALETTE` or `ART`. Never an inline hex (ART_DIRECTION §5). */
  readonly colour: number;
  /** Inverted-hull outline thickness in metres; omitted for non-silhouette parts. */
  readonly outline?: number;
  /** Flat appliqué or self-lit: casts and catches no shadow. */
  readonly flat?: true;
  readonly material?: ToonOptions;
}

export interface ReptileKit {
  readonly label: string;
  /** Every node in the file, sorted. */
  readonly names: readonly string[];
  /** The raw part — shape plus node transform. Throws for an unknown node. */
  part(name: string): GlbPart;
  /** The part dressed from the kit's `STYLES` (or `style`), transform copied across. */
  mesh(name: string, style?: PartStyle): Mesh;
}

export function loadReptileKit(
  label: string,
  base64: string,
  styles: Readonly<Record<string, PartStyle>>,
): ReptileKit {
  const parts = readGlbParts(base64ToArrayBuffer(base64));
  for (const part of parts.values()) markShared(part.geometry);
  const names = [...parts.keys()].sort();

  const part = (name: string): GlbPart => {
    const found = parts.get(name);
    if (!found) {
      throw new Error(`${label}: '${name}' is not a node in the kit. The file has: ${names.join(', ')}.`);
    }
    return found;
  };

  const mesh = (name: string, override?: PartStyle): Mesh => {
    const style = override ?? styles[name];
    if (!style) throw new Error(`${label}: no style for part '${name}'.`);
    const found = part(name);
    const built = new Mesh(found.geometry, toonMaterial(style.colour, style.material ?? {}));
    built.name = name;
    built.position.copy(found.position);
    built.quaternion.copy(found.quaternion);
    built.scale.copy(found.scale);
    if (style.flat) decal(built);
    else solid(built);
    if (style.outline !== undefined) addOutline(built, style.outline);
    return built;
  };

  return { label, names, part, mesh };
}

/** The furthest any vertex of a part sits from its node origin in plan. */
export function partRadiusXZ(part: GlbPart): number {
  const position = part.geometry.getAttribute('position') as BufferAttribute;
  let radius = 0;
  for (let i = 0; i < position.count; i += 1) {
    radius = Math.max(radius, Math.hypot(position.getX(i), position.getZ(i)));
  }
  return radius;
}

/** The axis-aligned extent of a part's own vertices, before its node transform. */
export function partBox(part: GlbPart): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
} {
  if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
  const box = part.geometry.boundingBox!;
  return {
    minX: box.min.x,
    maxX: box.max.x,
    minY: box.min.y,
    maxY: box.max.y,
    minZ: box.min.z,
    maxZ: box.max.z,
  };
}

/** Throws unless `measured` is within `tolerance` of `expected` — the load-time half of a contract. */
export function assertMeasured(
  label: string,
  what: string,
  measured: number,
  expected: number,
  tolerance = 0.02,
): void {
  if (Math.abs(measured - expected) > tolerance) {
    throw new Error(
      `${label}: ${what} measures ${measured.toFixed(3)} m but the game expects ` +
        `${expected.toFixed(3)} m (tolerance ${tolerance}). The kit and src/world/reptileHouse/layout.ts ` +
        'have drifted apart — rebuild the kit from the same constant.',
    );
  }
}
