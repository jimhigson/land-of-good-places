import {
  BufferGeometry,
  ExtrudeGeometry,
  Mesh,
  MeshStandardMaterial,
  MeshToonMaterial,
  Path,
  Shape,
  type Material,
} from 'three';
import { PALETTE } from '../../core/palette';
import { toonMaterial } from '../../art/style/materials';
import type { Region } from './layout';

/**
 * Shared odds and ends for the building builders.
 *
 * The plan lives in local metres with +Z pointing south. Extruded geometry is
 * authored in the shape plane and then laid down with `rotation.x = -PI/2`,
 * which maps shape `(sx, sy)` to world `(sx, ·, -sy)` and extrudes *upwards*.
 * Every helper here negates z for you, so callers only ever think in plan
 * coordinates.
 */

/**
 * The house material for the building fabric: walls, trim, pillars, awnings,
 * fittings, the roof and the plinth.
 *
 * Toon-shaded, because the tower is a toy like everything else in the park
 * (ART_DIRECTION.md §2). `roughness` is kept in the signature so the ~30 call
 * sites do not have to change and is deliberately ignored — under toon shading
 * the ramp, not a roughness value, decides how a surface shades.
 */
export function softMaterial(colour: number, _roughness = 0.68): MeshToonMaterial {
  return toonMaterial(colour);
}

/**
 * The same, for anything *inside* the building.
 *
 * A two-metre wall throws a long shadow across a floor plate at this sun angle,
 * so a physically-correct interior comes out grey and gloomy under a cutaway
 * that is supposed to look like a doll's house. A little emissive lifts it back
 * to the colour it is painted without adding a single light to the scene.
 *
 * Kept low: the toon ramp's darkest band already sits at 0.42, and piling
 * emissive on top of that flattens the four bands into one flat sticker.
 */
export function interiorMaterial(colour: number, _roughness = 0.72): MeshToonMaterial {
  return toonMaterial(colour, { emissive: colour, emissiveIntensity: INTERIOR_LIFT });
}

const INTERIOR_LIFT = 0.16;

/**
 * Glass: barely there, never casts a shadow, always lets the park through.
 *
 * Stays `MeshStandardMaterial` on purpose. Glass is on the ground/water/glass
 * side of the material rule — banding a transparent pane looks like a rendering
 * fault, and the faint specular is the only thing that says "window".
 */
export function glassMaterial(opacity = 0.24): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color: PALETTE.glassTint,
    roughness: 0.12,
    metalness: 0,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}

export function castAndReceive(mesh: Mesh): Mesh {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// ------------------------------------------------------------------ shapes

/** A rectangle in plan coordinates, wound anticlockwise in shape space. */
export function planRect(minX: number, maxX: number, minZ: number, maxZ: number): Shape {
  const shape = new Shape();
  shape.moveTo(minX, -maxZ);
  shape.lineTo(maxX, -maxZ);
  shape.lineTo(maxX, -minZ);
  shape.lineTo(minX, -minZ);
  shape.closePath();
  return shape;
}

/** A hole to punch in a plan shape, wound the opposite way round. */
export function planHole(region: Region): Path {
  const path = new Path();
  if (region.kind === 'rect') {
    path.moveTo(region.minX, -region.maxZ);
    path.lineTo(region.minX, -region.minZ);
    path.lineTo(region.maxX, -region.minZ);
    path.lineTo(region.maxX, -region.maxZ);
    path.closePath();
    return path;
  }
  path.absarc(region.x, -region.z, region.radius, 0, Math.PI * 2, true);
  return path;
}

/**
 * Extrudes plan shapes upwards into one geometry — several shapes in, one draw
 * call out. Used for deck slabs (with their holes) and for walls, whose
 * doorways simply become gaps between segments.
 */
export function extrudePlan(shapes: Shape[], height: number): BufferGeometry {
  const geometry = new ExtrudeGeometry(shapes, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 20,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

// `segmentsMinusGaps` lived here until 8 August 2026; it is now
// `world/wallRuns.ts`, shared with the hotel's room shells — see that file for
// the corner rule that made sharing it matter.

export function disposeTree(root: { traverse(cb: (o: unknown) => void): void }): void {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as Material | Material[] | undefined;
    if (!material) return;
    if (Array.isArray(material)) for (const one of material) one.dispose();
    else material.dispose();
  });
}
