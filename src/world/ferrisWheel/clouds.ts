import { Group, InstancedMesh, Matrix4, Quaternion, SphereGeometry, Vector3 } from 'three';
import { PALETTE } from '../../core/palette';
import { Rng, TAU, clamp01 } from '../../core/mathUtils';
import { disposeTree, toonMaterial } from '../../art/style/materials';

/**
 * The cloud band the ferris wheel climbs through, at a real height over the
 * real park.
 *
 * Lifted from `minigames/ferrisWheel/below.ts`, where the same clouds hung over
 * a forty-metre diorama and were slid downwards to fake a climb. Here nothing is
 * faked: the gondola genuinely rises, and these genuinely sit at
 * {@link CLOUD_BASE} metres over the wheel, so a child flies through them.
 *
 * **The band is where both halves of the swap happen**, which is the whole
 * reason it survives the move. Below it you are looking down at the actual park
 * — the actual building, the actual trees, the actual crowd. Inside it the park
 * is put away and the Earth comes out (`ferrisWheel/space.ts`), three hundred
 * metres of it, over a park only a hundred and ten metres across. Those two
 * pictures can never share a frame, and a curtain of cloud is the oldest way in
 * theatre to change the set between them. {@link CloudBand.enveloped} is the
 * one number both halves run off.
 *
 * It is also what saves the view on the way up. The park has a boundary wall
 * and then nothing; from high enough it would read as an island floating on
 * emptiness. The band closes over well before that happens.
 *
 * **Every puff is one instance of one sphere.** At this size that matters:
 * there are getting on for six hundred of them, and the first version built a
 * fresh `SphereGeometry` for each and drew it as its own mesh. One geometry,
 * one material, one draw call now — the same idiom as the wheel's own twelve
 * cars (`wheelProp.ts`) and the tree scatter.
 */

/** Where the underside of the band sits, in metres over the park. */
export const CLOUD_BASE = 96;

/** How deep the band is. Thick enough that the swap has somewhere to happen. */
const CLOUD_DEPTH = 68;

/** How far above the band's top the last of the cloud fades away to nothing. */
const CLOUD_FADE = 110;

/** How far out from the wheel the band spreads. */
const CLOUD_SPREAD = 150;

/**
 * How many clouds.
 *
 * Six times the first attempt, in two goes of Jim riding it and asking for
 * more. The band has to be genuinely **opaque overhead** — the whole staging
 * argument is that the park is put away and the Earth brought out while there
 * is cloud in the way — and the first number was taken from the diorama's own
 * band without allowing for it being spread over six times the area.
 */
const CLOUD_COUNT = 156;

/** Puffs per cloud. Chunky and three-lobed, the park's own painted-toy cloud. */
const PUFFS_MIN = 3;
const PUFFS_MAX = 5;

/**
 * How big a puff is, in metres.
 *
 * Doubled along with the count. Bigger clouds close over with far fewer gaps
 * than more small ones do, and at this scale a child is flying *through* them
 * rather than past them.
 */
const PUFF_RADIUS_MIN = 6.4;
const PUFF_RADIUS_MAX = 12.8;

/** How far a puff sits from its cloud's own centre. Doubled with the radius. */
const PUFF_SPREAD_X = 14;
const PUFF_SPREAD_Y = 3.2;
const PUFF_SPREAD_Z = 6;

export interface CloudBand {
  readonly root: Group;
  /**
   * How far through the band you are, 0..1.
   *
   * **The one number the whole swap runs off.** The Earth is brought out on it
   * and the real park is put away on it, so both changes happen while there is
   * cloud in the way rather than in clear air — and moving {@link CLOUD_BASE}
   * moves them together instead of leaving a comment somewhere to go stale.
   */
  enveloped(altitude: number): number;
  /**
   * Fades the band out above itself, and hides it once there is nothing left.
   *
   * In space there is no weather. Left at full strength the band sat below the
   * gondola for the whole forty seconds up there — a white floor under a child
   * who is supposed to be looking at the Earth.
   */
  setAltitude(altitude: number): void;
  update(dt: number, elapsed: number): void;
  dispose(): void;
}

interface Puff {
  /** Which cloud it belongs to. */
  readonly cloud: number;
  readonly offset: Vector3;
  readonly radius: number;
  /** How squashed. Clouds are wider than they are tall. */
  readonly flatten: number;
}

interface Cloud {
  readonly x: number;
  readonly baseY: number;
  readonly z: number;
  readonly drift: number;
  yaw: number;
}

/**
 * @param centreX  where the wheel stands, so the band is thickest overhead
 * @param centreZ  ditto
 */
export function createCloudBand(centreX: number, centreZ: number): CloudBand {
  const root = new Group();
  root.name = 'ferris:clouds';

  // The same seed the diorama used, so the band a child already knows is the
  // band that ends up over the park.
  const rng = new Rng(0x9a12c4);
  const material = toonMaterial(PALETTE.blossomWhite);
  // Needed from the moment it starts fading; costs nothing before that.
  material.transparent = true;

  const clouds: Cloud[] = [];
  const puffs: Puff[] = [];

  for (let i = 0; i < CLOUD_COUNT; i += 1) {
    const angle = rng.range(0, TAU);
    const radius = rng.range(8, CLOUD_SPREAD);
    clouds.push({
      x: centreX + Math.cos(angle) * radius,
      baseY: CLOUD_BASE + rng.range(0, CLOUD_DEPTH),
      z: centreZ + Math.sin(angle) * radius,
      drift: rng.range(0.4, 1.5),
      yaw: rng.range(0, TAU),
    });
    const count = PUFFS_MIN + Math.floor(rng.range(0, PUFFS_MAX - PUFFS_MIN + 1));
    for (let p = 0; p < count; p += 1) {
      puffs.push({
        cloud: i,
        offset: new Vector3(
          rng.range(-PUFF_SPREAD_X, PUFF_SPREAD_X),
          rng.range(-PUFF_SPREAD_Y * 0.75, PUFF_SPREAD_Y),
          rng.range(-PUFF_SPREAD_Z, PUFF_SPREAD_Z),
        ),
        radius: rng.range(PUFF_RADIUS_MIN, PUFF_RADIUS_MAX),
        flatten: rng.range(0.5, 0.8),
      });
    }
  }

  // One unit sphere for all of them; each puff's size lives in its instance
  // matrix. Modest segment counts — these are painted toys seen from inside.
  const mesh = new InstancedMesh(new SphereGeometry(1, 12, 9), material, puffs.length);
  mesh.name = 'cloud-puffs';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  // A band three hundred metres across that the camera sits inside: culling it
  // as one object is exactly wrong, and the test costs more than it saves.
  mesh.frustumCulled = false;
  root.add(mesh);

  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);

  /** Re-poses every puff from its cloud's current bob and spin. */
  function pose(elapsed: number): void {
    for (let i = 0; i < puffs.length; i += 1) {
      const puff = puffs[i] as Puff;
      const cloud = clouds[puff.cloud] as Cloud;
      // **Set, never accumulate.** This was `+= sin(...) * dt`, which
      // integrates a sine instead of offsetting by one: the ride clock always
      // runs 0 to 90 seconds, so every ride left a *net* displacement of
      // 7-11 m, and after ten rides the band had pulled itself apart. It never
      // showed before because the band was rebuilt for every visit.
      const y = cloud.baseY + Math.sin(elapsed * 0.14 * cloud.drift) * 1.4;
      rotation.setFromAxisAngle(up, cloud.yaw);
      position.copy(puff.offset).applyQuaternion(rotation);
      position.set(cloud.x + position.x, y + position.y, cloud.z + position.z);
      scale.set(puff.radius, puff.radius * puff.flatten, puff.radius);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  pose(0);

  return {
    root,

    enveloped(altitude: number): number {
      return clamp01((altitude - CLOUD_BASE) / CLOUD_DEPTH);
    },

    setAltitude(altitude: number): void {
      const above = altitude - (CLOUD_BASE + CLOUD_DEPTH);
      const opacity = 1 - clamp01(above / CLOUD_FADE);
      material.opacity = opacity;
      // Below about a hundredth there is nothing left to see, and every one of
      // these is still a transparent surface to sort and blend.
      root.visible = opacity > 0.01;
    },

    update(dt: number, elapsed: number): void {
      if (!root.visible) return;
      for (const cloud of clouds) cloud.yaw += dt * 0.02 * cloud.drift;
      pose(elapsed);
    },

    dispose(): void {
      disposeTree(root);
      mesh.dispose();
    },
  };
}
