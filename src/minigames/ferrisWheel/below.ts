import {
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from '../../core/palette';
import { Rng, TAU, clamp01 } from '../../core/mathUtils';
import { decal, disposeTree, solid, toonMaterial } from '../../art/style/materials';

/**
 * Everything underneath you on the way up: the park shrinking away, the cloud
 * band you climb through, and the colour of the sky at every height.
 *
 * **The park down there is a toy of a toy.** It is not the real park — that one
 * is frozen behind the curtain and is far too expensive to be a background.
 * It is a forty-metre diorama with the four landmarks a child will look for (the
 * big building, the ball pit, the fountain, the boundary wall) and a scatter of
 * lollipop trees, and it drops away on a curve rather than at a rate, so the
 * climb *feels* like a climb without anybody having to model a kilometre.
 *
 * **The cloud band is where the swap happens.** Somewhere in the middle of it
 * the park is put away and the whole Earth is brought out (`space.ts`). Two
 * things that could never share a scale change places behind a curtain of
 * cloud, which is the oldest trick in theatre and still the best one.
 */

/** Radius of the toy park, in metres. */
const PARK_RADIUS = 42;

/** How far the park has fallen away by the time you are in space. */
const PARK_FALL = 340;

/** Where the park starts, relative to the gondola floor. */
const PARK_START = 3.2;

/**
 * The sky, by height. Same idea as `DayNight`'s keyframe table: art-directing
 * "space should be *this* indigo" beats deriving it from anything.
 */
const SKY_KEYS: readonly (readonly [number, number])[] = [
  [0, PALETTE.skyDayBottom],
  [0.3, PALETTE.skyDayTop],
  [0.52, PALETTE.skyDawnTop],
  [0.72, PALETTE.skyNightBottom],
  [1, PALETTE.skyNightTop],
];

export interface WorldBelow {
  readonly root: Group;
  /** The sky colour at a given climb height, 0..1. */
  skyColour(height: number, into: Color): Color;
  /** Drives the whole climb. 0 = on the platform, 1 = space. */
  setHeight(height: number): void;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

export function createWorldBelow(): WorldBelow {
  const root = new Group();
  root.name = 'ferris:below';

  const rng = new Rng(0x9a12c4);

  // --- the toy park -----------------------------------------------------------
  const park = new Group();
  park.name = 'toy-park';
  root.add(park);

  const ground = solid(
    new Mesh(new CylinderGeometry(PARK_RADIUS, PARK_RADIUS * 0.92, 2.4, 48), toonMaterial(PALETTE.grass)),
  );
  ground.position.y = -1.2;
  park.add(ground);

  // The pink boundary wall, which from up here is the shape of the park.
  const wall = decal(
    new Mesh(new TorusGeometry(PARK_RADIUS - 1.4, 0.55, 6, 60), toonMaterial(PALETTE.stonePink)),
  );
  wall.rotation.x = Math.PI / 2;
  park.add(wall);

  // Paths: two pale ribbons crossing at the fountain. Flat discs rather than
  // real ribbons — at this distance a path is a shape, not a surface.
  const pathMaterial = toonMaterial(PALETTE.pathSand);
  for (const rotation of [0.2, 1.5]) {
    const path = decal(new Mesh(new CylinderGeometry(PARK_RADIUS * 0.9, PARK_RADIUS * 0.9, 0.3, 40), pathMaterial));
    path.scale.set(1, 1, 0.09);
    path.rotation.y = rotation;
    path.position.y = 0.1;
    park.add(path);
  }

  // The fountain in the middle.
  const fountain = decal(new Mesh(new CylinderGeometry(3.4, 3.4, 0.8, 20), toonMaterial(PALETTE.waterTop)));
  fountain.position.y = 0.3;
  park.add(fountain);

  // The big building, on the same corner it stands on in the real park.
  const building = solid(
    new Mesh(new RoundedBoxGeometry(15, 11, 11, 3, 0.5), toonMaterial(PALETTE.buildingWall)),
  );
  building.position.set(-16, 5.5, -13);
  park.add(building);

  const roof = solid(new Mesh(new RoundedBoxGeometry(16, 1.2, 12, 3, 0.4), toonMaterial(PALETTE.buildingRoof)));
  roof.position.set(-16, 11.4, -13);
  park.add(roof);

  for (let i = 0; i < 3; i += 1) {
    const band = decal(new Mesh(new RoundedBoxGeometry(15.4, 1.1, 11.4, 3, 0.4), toonMaterial(PALETTE.buildingWallDark)));
    band.position.set(-16, 2 + i * 3.2, -13);
    park.add(band);
  }

  // The ball pit, a bright dot of colour beside it.
  const ballPit = decal(new Mesh(new CylinderGeometry(4.2, 4.2, 0.9, 22), toonMaterial(PALETTE.markerPink)));
  ballPit.position.set(-5, 0.4, -7);
  park.add(ballPit);

  // Lollipop trees, instanced: two meshes for sixty trees.
  const treeCount = 64;
  const trunks = new InstancedMesh(
    new CylinderGeometry(0.28, 0.36, 2.2, 6),
    toonMaterial(PALETTE.bark),
    treeCount,
  );
  const canopies = new InstancedMesh(
    new SphereGeometry(1.7, 12, 9),
    toonMaterial(PALETTE.leafMid),
    treeCount,
  );
  trunks.frustumCulled = false;
  canopies.frustumCulled = false;
  park.add(trunks, canopies);

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3(1, 1, 1);
  const canopyColour = new Color();
  const leafTints = [PALETTE.leafMid, PALETTE.leafLight, PALETTE.leafDeep, PALETTE.leafBlue];

  for (let i = 0; i < treeCount; i += 1) {
    const angle = rng.range(0, TAU);
    const radius = Math.sqrt(rng.range(0.06, 1)) * (PARK_RADIUS - 4);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const size = rng.range(0.75, 1.35);

    position.set(x, 1.1 * size, z);
    scale.setScalar(size);
    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(i, matrix);

    position.set(x, (2.4 + rng.range(0, 0.5)) * size, z);
    matrix.compose(position, quaternion, scale);
    canopies.setMatrixAt(i, matrix);
    canopyColour.setHex(rng.pick(leafTints));
    canopies.setColorAt(i, canopyColour);
  }
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;

  // --- clouds -------------------------------------------------------------------
  // Chunky, three-lobed and unshaded on the underside — the same painted-toy
  // cloud the park's own sky uses, at a size you can fly through.
  const clouds = new Group();
  clouds.name = 'clouds';
  root.add(clouds);

  const cloudMaterial = toonMaterial(PALETTE.blossomWhite);
  for (let i = 0; i < 16; i += 1) {
    const cloud = new Group();
    const angle = rng.range(0, TAU);
    const radius = rng.range(8, 60);
    cloud.position.set(
      Math.cos(angle) * radius,
      rng.range(28, 96),
      Math.sin(angle) * radius - 18,
    );
    cloud.rotation.y = rng.range(0, TAU);
    const puffs = 3 + Math.floor(rng.range(0, 3));
    for (let p = 0; p < puffs; p += 1) {
      const puff = decal(new Mesh(new SphereGeometry(rng.range(3.2, 6.4), 14, 10), cloudMaterial));
      puff.position.set(rng.range(-7, 7), rng.range(-1.2, 1.6), rng.range(-3, 3));
      puff.scale.set(1, rng.range(0.5, 0.8), 1);
      cloud.add(puff);
    }
    cloud.userData.drift = rng.range(0.4, 1.5);
    clouds.add(cloud);
  }

  const keyA = new Color();
  const keyB = new Color();

  let height = 0;

  return {
    root,

    skyColour(at: number, into: Color): Color {
      const t = clamp01(at);
      for (let i = 1; i < SKY_KEYS.length; i += 1) {
        const previous = SKY_KEYS[i - 1];
        const next = SKY_KEYS[i];
        if (!previous || !next) continue;
        if (t <= next[0] || i === SKY_KEYS.length - 1) {
          const span = Math.max(1e-4, next[0] - previous[0]);
          const blend = clamp01((t - previous[0]) / span);
          keyA.setHex(previous[1]);
          keyB.setHex(next[1]);
          return into.copy(keyA).lerp(keyB, blend);
        }
      }
      return into.setHex(PALETTE.skyNightTop);
    },

    setHeight(next: number): void {
      height = clamp01(next);
      // Falls away on a curve. Linear reads as a lift; this reads as a climb
      // that gets away from you, which is what a wheel actually does.
      const drop = PARK_START + height ** 1.7 * PARK_FALL;
      park.position.y = -drop;
      clouds.position.y = -drop * 0.86;

      // The park is put away inside the cloud band, and the Earth comes out on
      // the other side of it. Neither swap is ever seen.
      park.visible = height < 0.66;
      clouds.visible = height < 0.82;
    },

    update(_dt: number, elapsed: number): void {
      park.rotation.y = 0.06 + elapsed * 0.004;
      for (const cloud of clouds.children) {
        const drift = (cloud.userData.drift as number | undefined) ?? 1;
        cloud.position.x += Math.sin(elapsed * 0.08 * drift) * 0.006;
        cloud.rotation.y += drift * 0.0004;
      }
    },

    dispose(): void {
      disposeTree(root);
      trunks.dispose();
      canopies.dispose();
    },
  };
}
