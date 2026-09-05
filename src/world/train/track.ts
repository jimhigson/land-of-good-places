import {
  BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  TubeGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { pathTexture, woodTexture } from '../../core/textures';
import { toonMaterial } from '../../art/style/materials';
import { terrainHeight, terrainNormal } from '../terrain';
import type { TrainRoute } from './route';

/**
 * The track: a ballast ribbon, wooden sleepers and two rails.
 *
 * Three draw calls for 325 metres. The sleepers are one `InstancedMesh` — there
 * are four hundred of them and nothing else in the park would survive four
 * hundred draw calls — and each rail is a single tube swept along its own
 * offset of the route.
 *
 * Everything is draped: each sleeper sits at `terrainHeight` under its own
 * centre and tips with the slope, so the track follows the hills the way the
 * path ribbons do rather than floating over the dips.
 */

/** Distance between sleeper centres. */
const SLEEPER_SPACING = 0.78;

/** Rail centre-to-centre. Narrow gauge, because it is a toy train. */
export const TRACK_GAUGE = 1.0;

/** Height of the rail head above the ground. The train's wheels sit on this. */
export const RAIL_HEIGHT = 0.17;

const SLEEPER_LENGTH = 1.5;
const SLEEPER_WIDTH = 0.26;
const SLEEPER_THICKNESS = 0.12;

/**
 * Half-width of the sandy ballast strip under the sleepers.
 *
 * Exported because the entrance's gateway path has to stop short of it: two
 * sandy surfaces drawn on the same ground within a centimetre of each other is
 * a coplanar seam, and on seed 288 the railway crosses the gate's own approach
 * 4.5 m inside the wall. Asked for rather than restated — a 1.05 written down
 * in `Entrance.ts` would be the second definition this repo pays for most.
 */
export const BALLAST_HALF_WIDTH = 1.05;

const UP = new Vector3(0, 1, 0);

export interface Track {
  readonly group: Group;
  dispose(): void;
}

export function buildTrack(route: TrainRoute): Track {
  const group = new Group();
  group.name = 'train-track';

  const sleeperCount = Math.max(8, Math.round(route.length / SLEEPER_SPACING));
  const disposables: { dispose(): void }[] = [];

  // --- ballast -------------------------------------------------------------
  const ballastGeometry = buildBallast(route, sleeperCount * 2);
  const ballastMaterial = new MeshStandardMaterial({
    map: pathTexture(1),
    color: PALETTE.pathSandDark,
    roughness: 1,
    metalness: 0,
    // Same trick the paths use: the strip lies a few centimetres above the
    // grass and would still z-fight on the flatter stretches without this.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const ballast = new Mesh(ballastGeometry, ballastMaterial);
  ballast.name = 'track-ballast';
  ballast.receiveShadow = true;
  group.add(ballast);
  disposables.push(ballastGeometry, ballastMaterial);

  // --- sleepers ------------------------------------------------------------
  const sleeperGeometry = new BoxGeometry(SLEEPER_LENGTH, SLEEPER_THICKNESS, SLEEPER_WIDTH);
  const sleeperMaterial = toonMaterial(0xffffff, { map: woodTexture(1, 1) });
  const sleepers = new InstancedMesh(sleeperGeometry, sleeperMaterial, sleeperCount);
  sleepers.name = 'track-sleepers';
  // Four hundred sleepers casting shadows would double the cheapest thing on
  // the track into the most expensive. The rails cast; these receive.
  sleepers.castShadow = false;
  sleepers.receiveShadow = true;

  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const point = new Vector3();
  const tangent = new Vector3();
  const colour = new Color();
  const rng = new Rng(0x51ee7e);

  for (let i = 0; i < sleeperCount; i += 1) {
    const distance = (i / sleeperCount) * route.length;
    route.pointAt(distance, point);
    route.tangentAt(distance, tangent);

    position.set(point.x, terrainHeight(point.x, point.z) + SLEEPER_THICKNESS * 0.5, point.z);
    // The box's long axis is X and has to lie *across* the track, so the yaw is
    // the tangent's bearing turned a quarter turn.
    rotation.setFromAxisAngle(UP, Math.atan2(tangent.x, tangent.z) + Math.PI / 2);
    matrix.compose(position, rotation, scale);
    sleepers.setMatrixAt(i, matrix);

    // Creosote never weathers evenly.
    const shade = 0.82 + rng.unit() * 0.3;
    colour.setRGB(shade, shade * 0.96, shade * 0.92);
    sleepers.setColorAt(i, colour);
  }
  sleepers.instanceMatrix.needsUpdate = true;
  if (sleepers.instanceColor) sleepers.instanceColor.needsUpdate = true;
  group.add(sleepers);
  disposables.push(sleeperGeometry, sleeperMaterial);

  // --- rails ---------------------------------------------------------------
  const railMaterial = toonMaterial(PALETTE.liftFrame);
  const railSegments = Math.max(64, Math.round(route.length / 0.6));
  for (const side of [-1, 1] as const) {
    const railGeometry = new TubeGeometry(
      railCurve(route, (side * TRACK_GAUGE) / 2, railSegments),
      railSegments,
      0.055,
      6,
      true,
    );
    const rail = new Mesh(railGeometry, railMaterial);
    rail.name = `track-rail-${side < 0 ? 'left' : 'right'}`;
    rail.castShadow = true;
    rail.receiveShadow = true;
    group.add(rail);
    disposables.push(railGeometry);
  }
  disposables.push(railMaterial);

  return {
    group,
    dispose(): void {
      for (const item of disposables) item.dispose();
    },
  };
}

/** One rail, as a closed curve offset sideways from the route centre line. */
function railCurve(route: TrainRoute, offset: number, samples: number): CatmullRomCurve3 {
  const points: Vector3[] = [];
  const point = new Vector3();
  const tangent = new Vector3();

  // Every fourth sample: a tube through 540 control points is slower to build
  // than it is to draw, and the rail is already smoother than the eye can tell.
  const stride = 4;
  for (let i = 0; i < samples; i += stride) {
    const distance = (i / samples) * route.length;
    route.pointAt(distance, point);
    route.tangentAt(distance, tangent);
    const x = point.x - tangent.z * offset;
    const z = point.z + tangent.x * offset;
    points.push(new Vector3(x, terrainHeight(x, z) + RAIL_HEIGHT, z));
  }

  return new CatmullRomCurve3(points, true, 'catmullrom', 0.5);
}

/**
 * The sandy strip the sleepers are bedded into.
 *
 * A ribbon draped on the terrain, exactly like `world/paths.ts` builds its
 * paving — normals come from `terrainNormal` rather than from the triangles, so
 * the strip lights like the ground it is lying on.
 */
function buildBallast(route: TrainRoute, divisions: number): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const point = new Vector3();
  const tangent = new Vector3();
  const normal = new Vector3();
  let travelled = 0;
  let previousX = 0;
  let previousZ = 0;

  const push = (x: number, z: number, u: number, v: number): void => {
    positions.push(x, terrainHeight(x, z) + 0.045, z);
    terrainNormal(x, z, normal);
    normals.push(normal.x, normal.y, normal.z);
    uvs.push(u, v);
  };

  for (let i = 0; i <= divisions; i += 1) {
    const distance = (i / divisions) * route.length;
    route.pointAt(distance, point);
    route.tangentAt(distance, tangent);

    if (i > 0) travelled += Math.hypot(point.x - previousX, point.z - previousZ);
    previousX = point.x;
    previousZ = point.z;

    const leftX = point.x - tangent.z * BALLAST_HALF_WIDTH;
    const leftZ = point.z + tangent.x * BALLAST_HALF_WIDTH;
    const rightX = point.x + tangent.z * BALLAST_HALF_WIDTH;
    const rightZ = point.z - tangent.x * BALLAST_HALF_WIDTH;

    // Right edge first, so the quads wind anticlockwise seen from above and the
    // strip faces the sky.
    const v = travelled / 2;
    push(rightX, rightZ, 0, v);
    push(leftX, leftZ, 1, v);

    if (i > 0) {
      const base = positions.length / 3 - 4;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
