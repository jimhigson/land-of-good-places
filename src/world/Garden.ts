import { alongBoundary, PARK_BOUNDARY, TERRAIN_EDGE_RADIUS, type EdgeStation } from './boundary';
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
/**
 * Half the width the boundary masonry occupies about the park's outline, in
 * metres — the pillar caps, which are the widest part of it.
 *
 * Exported because anything asking "is this thing clear of the park wall?" has
 * to measure against the *widest* stone, not the collision half-width (0.45)
 * that only the physics sees. A rail passing 0.5 m outside the outline would
 * clear the collider and still be driven straight through a pillar cap.
 *
 * Exported rather than copied, deliberately. This session alone has produced
 * four bugs of the form "the same number declared twice, then diverging" —
 * two stall stand points (#114), two `ParkBoundary` types, two `circleBoundary`
 * functions, and a `BRIDGE_RISE` that no longer matched the locomotive it was
 * supposed to clear. A number that describes built geometry belongs to the
 * module that builds it.
 */
export const BOUNDARY_MASONRY_HALF_WIDTH = 0.86;

/**
 * Half-thickness of the boundary wall as **collision** sees it — what a child
 * is actually stopped by, as opposed to the stone she can see.
 *
 * Narrower than {@link BOUNDARY_MASONRY_HALF_WIDTH} because the pillar caps
 * bulge past the run of blocks and nothing needs to collide with a decorative
 * bulge. Both numbers are real and they answer different questions: "could a
 * child be standing here?" is this one, "is there stone here?" is that one.
 */
export const BOUNDARY_WALL_COLLISION_HALF = 0.45;

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
    const radius = Math.pow(ring / rings, 1.35) * TERRAIN_EDGE_RADIUS;
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

  // Laid out along the park's own edge. Every number below that used to be an
  // angle is now a distance walked round the outline, because on a boundary
  // running from 57 m to 110 m an even angular step is not an even spacing:
  // it would bond the masonry at the pinch and stretch it into a picket fence
  // at the bulge.
  const blockWidth = 1.7;
  const courses = 2;
  const courseStations = [
    alongBoundary(PARK_BOUNDARY, blockWidth),
    // Half a block along the edge, which is what makes alternate courses bond.
    alongBoundary(PARK_BOUNDARY, blockWidth, blockWidth / 2),
  ];
  const blockCount = courseStations[0]!.length;
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
    const stations = courseStations[course % courseStations.length] as EdgeStation[];
    for (let i = 0; i < blockCount; i += 1) {
      const station = stations[i % stations.length] as EdgeStation;
      const { x, z } = station;
      const y = terrainHeight(x, z) + courseHeight * (course + 0.5);
      positionVector.set(x, y, z);
      // The box's long axis is X and must lie *along* the edge. `alongBoundary`
      // hands back the yaw that does it; pointing it across instead turns the
      // wall into a ring of separate tombstones.
      quaternion.setFromAxisAngle(UP, station.yaw);
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

  const capGeometry = new SphereGeometry(BOUNDARY_MASONRY_HALF_WIDTH, 14, 10);
  const capMaterial = new MeshStandardMaterial({
    color: PALETTE.stonePinkLight,
    roughness: 0.6,
    metalness: 0,
  });
  const caps = new InstancedMesh(capGeometry, capMaterial, pillarCount);
  caps.castShadow = true;

  const pillarStations = alongBoundary(PARK_BOUNDARY, PARK_BOUNDARY.perimeter / pillarCount);
  for (let i = 0; i < pillarCount; i += 1) {
    const station = pillarStations[i % pillarStations.length] as EdgeStation;
    const { x, z } = station;
    const ground = terrainHeight(x, z);

    positionVector.set(x, ground + 1.05, z);
    quaternion.setFromAxisAngle(UP, station.yaw);
    matrix.compose(positionVector, quaternion, scale);
    pillars.setMatrixAt(i, matrix);

    positionVector.set(x, ground + 2.15, z);
    matrix.compose(positionVector, quaternion, SQUASHED_CAP);
    caps.setMatrixAt(i, matrix);
  }
  pillars.instanceMatrix.needsUpdate = true;
  caps.instanceMatrix.needsUpdate = true;
  group.add(pillars, caps);

  // The wall is solid. The collision polygon walks the same outline the blocks
  // do, at a coarser step — one segment per ~2 m of edge, so the chord never
  // bows further from the drawn masonry than the masonry is thick.
  const collisionStations = alongBoundary(PARK_BOUNDARY, 2);
  for (let i = 0; i < collisionStations.length; i += 1) {
    const a = collisionStations[i] as EdgeStation;
    const b = collisionStations[(i + 1) % collisionStations.length] as EdgeStation;
    collision.addWall(a.x, a.z, b.x, b.z, BOUNDARY_WALL_COLLISION_HALF);
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
