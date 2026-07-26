import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import {
  GARDEN_HALF_SIZE,
  TERRAIN_RADIUS,
  TERRAIN_HEIGHT_SCALE,
  TERRAIN_SEGMENTS,
} from '../core/constants';
import { PALETTE } from '../core/palette';
import { Rng } from '../core/mathUtils';
import { grassTexture, pinkStoneTexture } from '../core/textures';
import { terrainHeight } from './terrain';
import { buildPaths } from './paths';
import type { CollisionWorld } from './Collision';

/**
 * The ground itself: grassy terrain, the winding paths and the pink stone
 * boundary wall.
 *
 * Everything here is static — built once, never updated — so it is a plain
 * builder rather than a GameSystem.
 */
export class Garden {
  readonly group = new Group();

  constructor(collision: CollisionWorld) {
    this.group.name = 'garden';

    this.group.add(buildTerrain());
    for (const mesh of buildPaths()) this.group.add(mesh);
    this.group.add(buildBoundaryWall(collision));
  }
}

/**
 * Rolling grass, built as a disc that ends a little way past the boundary wall.
 *
 * Why a disc and not an endless plane? Because the camera is orthographic and
 * tilted 38° down, so it only ever shows about 36 metres of ground depth — an
 * endless plane fills the frame completely and you never see the sky, which
 * would waste the entire day/night cycle. Ending the ground at
 * {@link TERRAIN_RADIUS} turns the park into a diorama on a hilltop: walk near
 * the edge and the sunset, the stars and the distant hills come into view.
 *
 * The visible cut edge is masked by the treeline in `Scenery`.
 */
function buildTerrain(): Mesh {
  const rings = TERRAIN_SEGMENTS;
  const segments = 128;
  const vertexCount = (rings + 1) * (segments + 1);

  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colours = new Float32Array(vertexCount * 3);
  const indices: number[] = [];

  const tint = new Color();
  const grass = new Color(PALETTE.grass);
  const grassLight = new Color(PALETTE.grassLight);
  const grassDark = new Color(PALETTE.grassDark);

  for (let ring = 0; ring <= rings; ring += 1) {
    // Squared distribution puts more detail where the player actually walks.
    const radius = Math.pow(ring / rings, 1.35) * TERRAIN_RADIUS;
    for (let segment = 0; segment <= segments; segment += 1) {
      const index = ring * (segments + 1) + segment;
      const angle = (segment / segments) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const height = terrainHeight(x, z);

      positions[index * 3] = x;
      positions[index * 3 + 1] = height;
      positions[index * 3 + 2] = z;

      // UVs come from world position so the grass tiles at a constant scale
      // instead of smearing out towards the rim.
      uvs[index * 2] = x / GRASS_TILE_METRES;
      uvs[index * 2 + 1] = z / GRASS_TILE_METRES;

      // High ground catches more light, hollows read cooler and darker.
      const t = height / (TERRAIN_HEIGHT_SCALE * 1.3);
      if (t >= 0) tint.copy(grass).lerp(grassLight, Math.min(1, t));
      else tint.copy(grass).lerp(grassDark, Math.min(1, -t));

      // A slow wobble breaks up the regularity of the sine hills.
      const wobble = 0.94 + 0.12 * Math.sin(x * 0.31 + z * 0.27);
      colours[index * 3] = tint.r * wobble;
      colours[index * 3 + 1] = tint.g * wobble;
      colours[index * 3 + 2] = tint.b * wobble;
    }
  }

  const stride = segments + 1;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * stride + segment;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new BufferAttribute(colours, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new MeshStandardMaterial({
    map: grassTexture(1),
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = 'terrain';
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The cute pink stone boundary wall: two courses of cobbles laid in a ring,
 * with fatter pillars capped by rounded knobs at regular intervals.
 */
function buildBoundaryWall(collision: CollisionWorld): Group {
  const group = new Group();
  group.name = 'boundary-wall';

  const radius = GARDEN_HALF_SIZE - 2;
  const blockWidth = 1.7;
  const blockCount = Math.round((Math.PI * 2 * radius) / blockWidth);
  const courses = 2;
  const courseHeight = 0.62;

  const blockGeometry = new BoxGeometry(blockWidth * 0.96, courseHeight, 0.7);
  const blockMaterial = new MeshStandardMaterial({
    map: pinkStoneTexture(1, 1),
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0,
  });
  const blocks = new InstancedMesh(blockGeometry, blockMaterial, blockCount * courses);
  blocks.name = 'boundary-blocks';
  blocks.castShadow = true;
  blocks.receiveShadow = true;

  const matrix = new Matrix4();
  const positionVector = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const rng = new Rng(0x5701e);
  const colour = new Color();

  let index = 0;
  for (let course = 0; course < courses; course += 1) {
    // Half-block offset on alternate courses gives a proper bonded look.
    const angleOffset = course % 2 === 0 ? 0 : Math.PI / blockCount;
    for (let i = 0; i < blockCount; i += 1) {
      const angle = (i / blockCount) * Math.PI * 2 + angleOffset;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = terrainHeight(x, z) + courseHeight * (course + 0.5);
      positionVector.set(x, y, z);
      // The box's long axis is X, and it must lie along the *tangent* of the
      // ring. Rotating by -angle alone points it radially, which turns the wall
      // into a ring of separate tombstones — hence the extra quarter turn.
      quaternion.setFromAxisAngle(UP, -(angle + Math.PI / 2));
      matrix.compose(positionVector, quaternion, scale);
      blocks.setMatrixAt(index, matrix);
      // Gentle per-block colour jitter so the ring isn't a flat pink band.
      const shade = 0.9 + rng.unit() * 0.2;
      colour.setRGB(shade, shade * 0.98, shade);
      blocks.setColorAt(index, colour);
      index += 1;
    }
  }
  blocks.instanceMatrix.needsUpdate = true;
  if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
  group.add(blocks);

  // Pillars with rounded caps.
  const pillarCount = 28;
  const pillarGeometry = new BoxGeometry(1.5, 2.1, 1.5);
  const pillarMaterial = new MeshStandardMaterial({
    map: pinkStoneTexture(1, 1),
    roughness: 0.85,
    metalness: 0,
  });
  const pillars = new InstancedMesh(pillarGeometry, pillarMaterial, pillarCount);
  pillars.castShadow = true;
  pillars.receiveShadow = true;

  const capGeometry = new SphereGeometry(0.86, 14, 10);
  const capMaterial = new MeshStandardMaterial({
    color: PALETTE.stonePinkLight,
    roughness: 0.6,
    metalness: 0,
  });
  const caps = new InstancedMesh(capGeometry, capMaterial, pillarCount);
  caps.castShadow = true;

  for (let i = 0; i < pillarCount; i += 1) {
    const angle = (i / pillarCount) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const ground = terrainHeight(x, z);

    positionVector.set(x, ground + 1.05, z);
    quaternion.setFromAxisAngle(UP, -(angle + Math.PI / 2));
    matrix.compose(positionVector, quaternion, scale);
    pillars.setMatrixAt(i, matrix);

    positionVector.set(x, ground + 2.15, z);
    matrix.compose(positionVector, quaternion, SQUASHED_CAP);
    caps.setMatrixAt(i, matrix);
  }
  pillars.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  group.add(pillars, caps);

  // The wall is solid: approximate the ring with a many-sided polygon.
  const collisionSegments = 64;
  for (let i = 0; i < collisionSegments; i += 1) {
    const a = (i / collisionSegments) * Math.PI * 2;
    const b = ((i + 1) / collisionSegments) * Math.PI * 2;
    collision.addWall(
      Math.cos(a) * radius,
      Math.sin(a) * radius,
      Math.cos(b) * radius,
      Math.sin(b) * radius,
      0.45,
    );
  }

  return group;
}

/*
 * A note for anyone tempted to add distant scenery (hills, mountains, a skyline)
 * beyond the park: it does not work the way you expect under an orthographic
 * camera. There is no perspective convergence, so a point `d` metres further
 * away at height `h` lands at `d*sin(pitch) + h*cos(pitch)` up the screen —
 * distance pushes things *up and off the top of the frame*, not towards a
 * horizon. An earlier build had a ring of big hills here; all that was ever
 * visible was their sunken flanks filling the gap above the crest with green.
 * If you want a horizon, paint it into the Sky shader instead.
 */

const UP = new Vector3(0, 1, 0);
const SQUASHED_CAP = new Vector3(1, 0.72, 1);

/** Metres of ground covered by one repeat of the grass texture. */
const GRASS_TILE_METRES = 6;
