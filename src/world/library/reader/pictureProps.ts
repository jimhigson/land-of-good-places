import { BoxGeometry, ConeGeometry, CylinderGeometry, type BufferGeometry, Group, Mesh, SphereGeometry, TorusGeometry } from 'three';
import { PALETTE } from '../../../core/palette';
import { addOutline, addSmoothOutline, solid, toonMaterial } from '../../../art/style/materials';
import { visibleBounds } from '../../../art/style/measure';
import type { AssetHandle } from '../../../art/style/asset';
import type { PropPart } from '../books';

/**
 * **A picture's `prop`: anything no factory builds, made of primitive shapes**
 * (track D of #714, for the chapter books' pictures).
 *
 * The chapter books' pictures need things the park has no model for — a
 * magnifying glass, a picnic blanket, a trail of pancake footprints, a rubber
 * duck, a stand-in Ferris wheel — and a book's own file may hold only data
 * (`books.ts`: importable from Node, nothing in it touches the DOM). So a
 * `prop` actor names its pieces as data ({@link PropPart}) and this builds
 * them, in the house look every model in a picture has: the toon ramp, and an
 * ink outline a size that suits the piece.
 *
 * Every size is baked into its geometry rather than set as a mesh scale, so a
 * squashed ball's outline is as thick all round as a round one's, and the
 * piece measures what it says it is.
 */

const DEG = Math.PI / 180;

/** The ink line round a piece: the creatures' 1.6 cm on anything big, thinner on small things. */
function outlineFor(part: PropPart): number {
  const [w, h, d] = part.size;
  const largest = Math.max(w, h, part.shape === 'ring' ? w : d);
  return Math.min(0.016, Math.max(0.004, largest * 0.04));
}

function geometryFor(part: PropPart): { geometry: BufferGeometry; hardEdges: boolean } {
  const [w, h, d] = part.size;
  switch (part.shape) {
    case 'box':
      return { geometry: new BoxGeometry(w, h, d), hardEdges: true };
    case 'ball':
      return { geometry: new SphereGeometry(0.5, 28, 20).scale(w, h, d), hardEdges: false };
    case 'cylinder':
      return { geometry: new CylinderGeometry(0.5, 0.5, 1, part.sides ?? 28).scale(w, h, d), hardEdges: true };
    case 'cone':
      return { geometry: new ConeGeometry(0.5, 1, part.sides ?? 28).scale(w, h, d), hardEdges: true };
    case 'ring': {
      const tube = Math.max(0.002, Math.min(h, w / 2) / 2);
      const radius = Math.max(tube, w / 2 - tube);
      return { geometry: new TorusGeometry(radius, tube, 14, 56, (part.arc ?? 360) * DEG), hardEdges: false };
    }
  }
}

/** One piece, built, turned and tilted, at its place in the prop. */
function partMesh(part: PropPart): Mesh {
  const colour = PALETTE[part.colour];
  const material = toonMaterial(colour, part.glow ? { emissive: colour, emissiveIntensity: 0.85 } : {});
  const { geometry, hardEdges } = geometryFor(part);
  const mesh = solid(new Mesh(geometry, material));
  mesh.name = `prop.${part.shape}`;
  const [x, y, z] = part.at ?? [0, 0, 0];
  mesh.position.set(x, y, z);
  // Turned about the vertical first, then tipped and leant in its own frame.
  mesh.rotation.set((part.tilt?.[0] ?? 0) * DEG, (part.turn ?? 0) * DEG, (part.tilt?.[1] ?? 0) * DEG, 'YXZ');
  if (part.outline !== false) {
    if (hardEdges) addSmoothOutline(mesh, outlineFor(part));
    else addOutline(mesh, outlineFor(part));
  }
  return mesh;
}

/** A `prop` actor's model: its pieces in one group, standing where they say. */
export function buildPictureProp(parts: readonly PropPart[]): AssetHandle {
  const root = new Group();
  root.name = 'library.pictureProp';
  for (const part of parts) root.add(partMesh(part));
  return { root, height: parts.length > 0 ? Math.max(0, visibleBounds(root).top) : 0 };
}

/**
 * One piece of every kind, glowing and plain, outlined and not: what the
 * picture warm-up compiles (`pagePictures.ts`'s `pictureWarmSteps`), so the
 * first prop a book shows links no shader program.
 */
export const WARM_PROP_PARTS: readonly PropPart[] = [
  { shape: 'box', size: [0.3, 0.2, 0.3], colour: 'woodLight' },
  { shape: 'ball', size: [0.3, 0.2, 0.4], at: [0.5, 0, 0], colour: 'flowerYellow' },
  { shape: 'cylinder', size: [0.2, 0.3, 0.2], at: [1, 0, 0], colour: 'markerPink', sides: 3 },
  { shape: 'cone', size: [0.2, 0.3, 0.2], at: [1.5, 0, 0], colour: 'markerSky' },
  { shape: 'ring', size: [0.4, 0.05, 0], at: [2, 0, 0], colour: 'stoneGrey', arc: 180 },
  { shape: 'ball', size: [0.1, 0.1, 0.1], at: [2.5, 0, 0], colour: 'flowerYellow', glow: true, outline: false },
];
