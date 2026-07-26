import {
  BufferGeometry,
  ExtrudeGeometry,
  Mesh,
  MeshStandardMaterial,
  MeshToonMaterial,
  Path,
  Shape,
  Vector2,
  type Material,
  type UVGenerator,
} from 'three';
import { signTexture } from '../../core/textures';
import { PALETTE } from '../../core/palette';
import { toonMaterial } from '../../art/style/materials';
import { markAsSign } from '../signs';
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

/** Plan rectangles that make up one wall run, minus any doorways in it. */
export function segmentsMinusGaps(
  from: number,
  to: number,
  gaps: readonly (readonly [number, number])[],
): [number, number][] {
  let spans: [number, number][] = [[from, to]];
  for (const [gapStart, gapEnd] of gaps) {
    const next: [number, number][] = [];
    for (const [start, end] of spans) {
      if (gapEnd <= start || gapStart >= end) {
        next.push([start, end]);
        continue;
      }
      if (gapStart > start) next.push([start, gapStart]);
      if (gapEnd < end) next.push([gapEnd, end]);
    }
    spans = next;
  }
  return spans;
}

// ------------------------------------------------------------------- signs

export interface CuteSignOptions {
  readonly title: string;
  readonly subtitle?: string;
  readonly glyph?: string;
  readonly accent?: number;
  readonly width?: number;
}

/** A flat "opening soon" board: a chunky backing plate and a painted face. */
export function cuteSign(options: CuteSignOptions): Mesh {
  const width = options.width ?? 1.9;
  const height = width * (288 / 512);
  const accent = options.accent ?? PALETTE.markerPink;

  const faceOptions: Parameters<typeof signTexture>[0] = { title: options.title, accent };
  if (options.subtitle !== undefined) faceOptions.subtitle = options.subtitle;
  if (options.glyph !== undefined) faceOptions.glyph = options.glyph;

  // One mesh, not a board plus a separate painted face: the extruded plate
  // carries the sign texture on its front cap, and the 9 cm of edge nobody ever
  // looks at is a fair price for halving the sign count.
  const geometry = new ExtrudeGeometry(roundedPlate(width, height, height * 0.18), {
    depth: 0.09,
    bevelEnabled: false,
    curveSegments: 6,
    UVGenerator: signUVs(width, height),
  });

  // Toon-shaded like the rest of the fabric — `MeshBasicMaterial` is reserved
  // for outlines and catchlights, never for something solid. The painted face
  // is *also* fed in as an emissive map, which is what keeps a sign legible
  // after dark without making it a flat sticker in daylight.
  const face = signTexture(faceOptions);
  const material = toonMaterial(0xffffff, { map: face });
  material.emissive.setHex(0xffffff);
  material.emissiveMap = face;
  material.emissiveIntensity = 0.38;

  const board = new Mesh(geometry, material);
  board.castShadow = false;
  board.receiveShadow = false;
  // Tappable: the "inspect" camera (SignInspector) reads this back off the
  // assembled scene graph rather than needing its own registry wired through
  // every builder that calls `cuteSign`.
  markAsSign(board, width, height);
  return board;
}

/**
 * Maps the sign texture across the plate rather than by world units, so the
 * whole board is exactly one copy of the painted face whatever size it is.
 */
function signUVs(width: number, height: number): UVGenerator {
  const map = (x: number, y: number): Vector2 =>
    new Vector2(x / width + 0.5, y / height + 0.5);
  return {
    generateTopUV: (_geometry, vertices, a, b, c) => [
      map(vertices[a * 3] ?? 0, vertices[a * 3 + 1] ?? 0),
      map(vertices[b * 3] ?? 0, vertices[b * 3 + 1] ?? 0),
      map(vertices[c * 3] ?? 0, vertices[c * 3 + 1] ?? 0),
    ],
    generateSideWallUV: () => [
      new Vector2(0.02, 0.5),
      new Vector2(0.02, 0.5),
      new Vector2(0.02, 0.5),
      new Vector2(0.02, 0.5),
    ],
  };
}

function roundedPlate(width: number, height: number, radius: number): Shape {
  const shape = new Shape();
  const hx = width / 2;
  const hy = height / 2;
  const r = Math.min(radius, hx, hy);
  shape.moveTo(-hx + r, -hy);
  shape.lineTo(hx - r, -hy);
  shape.quadraticCurveTo(hx, -hy, hx, -hy + r);
  shape.lineTo(hx, hy - r);
  shape.quadraticCurveTo(hx, hy, hx - r, hy);
  shape.lineTo(-hx + r, hy);
  shape.quadraticCurveTo(-hx, hy, -hx, hy - r);
  shape.lineTo(-hx, -hy + r);
  shape.quadraticCurveTo(-hx, -hy, -hx + r, -hy);
  shape.closePath();
  return shape;
}

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
