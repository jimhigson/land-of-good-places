import { AdditiveBlending, BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three';
import { DECAL_STEP } from './floorPaint';

/**
 * **A pool of light that is not a light** (perf step 15).
 *
 * A `PointLight` is paid for by every lit fragment of every material in the
 * scene — three.js loops over `NUM_POINT_LIGHTS` in each toon shader — so a
 * hall with eight of them costs eight light evaluations on every pixel to
 * draw six soft patches on a floor. This draws the patches instead: one
 * additive mesh of radial-gradient discs lying just over the floor, coloured
 * in the vertices, no texture, no lighting, **one draw call for every pool in
 * the room**.
 *
 * It is a picture of light, so it is honest only on the flat floor it lies
 * on; the room's real fill comes from the few lights `lighting.ts` keeps.
 *
 * Nothing here is solid and nothing here can be tapped: the mesh opts out of
 * raycasts, so a tap on the floor still lands on the floor.
 */

/** Rings per disc and segments per ring: enough that the falloff reads smooth at arm's length. */
const RINGS = 5;
const SEGMENTS = 28;

/**
 * Over the floor's painted snake (which uses steps one to three), so a pool
 * warms the scales it lies across the way the light it replaces did.
 */
const POOL_LIFT = DECAL_STEP * 4;

export interface LightPoolSpot {
  readonly x: number;
  readonly z: number;
}

/**
 * One mesh of gradient discs, one per spot, in the parent's own metres.
 *
 * @param colour  What the pool adds at its very middle, in linear light —
 *   already multiplied by whatever it falls on. It fades to nothing at `radius`.
 */
export function buildLightPools(spots: readonly LightPoolSpot[], radius: number, colour: Color): Mesh {
  const positions: number[] = [];
  const colours: number[] = [];
  const indices: number[] = [];
  for (const spot of spots) {
    const base = positions.length / 3;
    positions.push(spot.x, POOL_LIFT, spot.z);
    colours.push(colour.r, colour.g, colour.b);
    for (let ring = 1; ring <= RINGS; ring += 1) {
      const t = ring / RINGS;
      // (1 − t²)²: flat in the middle, and both the value and its slope reach
      // zero at the rim, so the disc has no edge to see.
      const glow = (1 - t * t) ** 2;
      for (let segment = 0; segment < SEGMENTS; segment += 1) {
        const angle = (segment / SEGMENTS) * Math.PI * 2;
        positions.push(spot.x + Math.cos(angle) * radius * t, POOL_LIFT, spot.z + Math.sin(angle) * radius * t);
        colours.push(colour.r * glow, colour.g * glow, colour.b * glow);
      }
    }
    // The middle fan, wound to face up (+y).
    for (let segment = 0; segment < SEGMENTS; segment += 1) {
      const next = (segment + 1) % SEGMENTS;
      indices.push(base, base + 1 + next, base + 1 + segment);
    }
    for (let ring = 1; ring < RINGS; ring += 1) {
      const inner = base + 1 + (ring - 1) * SEGMENTS;
      const outer = inner + SEGMENTS;
      for (let segment = 0; segment < SEGMENTS; segment += 1) {
        const next = (segment + 1) % SEGMENTS;
        indices.push(inner + segment, inner + next, outer + segment);
        indices.push(inner + next, outer + next, outer + segment);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  // The bound three.js culls by: computed from the discs themselves, so it
  // contains everything this mesh draws.
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  const material = new MeshBasicMaterial({
    vertexColors: true,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = 'reptile-house-light-pools';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // Light is not a thing to tap or to stand on.
  mesh.raycast = () => {};
  return mesh;
}
