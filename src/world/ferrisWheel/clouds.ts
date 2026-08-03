import { Group, Mesh, SphereGeometry } from 'three';
import { PALETTE } from '../../core/palette';
import { Rng, TAU } from '../../core/mathUtils';
import { decal, disposeTree, toonMaterial } from '../../art/style/materials';

/**
 * The cloud band the ferris wheel climbs through, at a real height over the
 * real park.
 *
 * Lifted from `minigames/ferrisWheel/below.ts`, where the same clouds hung over
 * a forty-metre diorama and were slid downwards to fake a climb. Here nothing is
 * faked: the gondola genuinely rises, and these genuinely sit at
 * {@link CLOUD_BASE} metres over the wheel, so a child flies through them.
 *
 * **The band is still where the swap happens**, which is the whole reason it
 * survives the move. Below it you are looking down at the actual park — the
 * actual building, the actual trees, the actual crowd. Above it the Earth comes
 * out (`ferrisWheel/space.ts`), three hundred metres of it, and swallows a park
 * that is only a hundred and ten metres across. Those two pictures can never
 * share a frame, and a curtain of cloud is the oldest way in theatre to change
 * the set between them.
 *
 * It is also what saves the view on the way up. The park has a boundary wall
 * and then nothing; from high enough it would read as an island floating on
 * emptiness. The band closes over well before that happens.
 */

/** Where the underside of the band sits, in metres over the park. */
export const CLOUD_BASE = 96;

/** How deep the band is. Thick enough that the swap has somewhere to happen. */
const CLOUD_DEPTH = 68;

/** How far out from the wheel the band spreads. */
const CLOUD_SPREAD = 150;

/** How many clouds. Enough to close over you, few enough to stay a toy sky. */
const CLOUD_COUNT = 26;

export interface CloudBand {
  readonly root: Group;
  /** Fully inside the band, 0..1 — 1 is the moment the park is out of sight. */
  enveloped(altitude: number): number;
  update(dt: number, elapsed: number): void;
  dispose(): void;
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

  for (let i = 0; i < CLOUD_COUNT; i += 1) {
    const cloud = new Group();
    const angle = rng.range(0, TAU);
    const radius = rng.range(8, CLOUD_SPREAD);
    cloud.position.set(
      centreX + Math.cos(angle) * radius,
      CLOUD_BASE + rng.range(0, CLOUD_DEPTH),
      centreZ + Math.sin(angle) * radius,
    );
    cloud.rotation.y = rng.range(0, TAU);
    const puffs = 3 + Math.floor(rng.range(0, 3));
    for (let p = 0; p < puffs; p += 1) {
      const puff = decal(new Mesh(new SphereGeometry(rng.range(3.2, 6.4), 14, 10), material));
      puff.position.set(rng.range(-7, 7), rng.range(-1.2, 1.6), rng.range(-3, 3));
      puff.scale.set(1, rng.range(0.5, 0.8), 1);
      cloud.add(puff);
    }
    cloud.userData.drift = rng.range(0.4, 1.5);
    // Where it was put. The bob below is measured from here every frame rather
    // than accumulated onto the current position — see `update`.
    cloud.userData.baseY = cloud.position.y;
    root.add(cloud);
  }

  return {
    root,

    /**
     * How far through the band you are. The Earth is brought out on this, and
     * the real park is put away on it, so that both changes happen while there
     * is cloud in the way rather than in clear air.
     */
    enveloped(altitude: number): number {
      const through = (altitude - CLOUD_BASE) / CLOUD_DEPTH;
      return through <= 0 ? 0 : through >= 1 ? 1 : through;
    },

    update(dt: number, elapsed: number): void {
      for (const cloud of root.children) {
        const drift = (cloud.userData.drift as number) ?? 1;
        cloud.rotation.y += dt * 0.02 * drift;
        // **Set, never accumulate.** This was `+= sin(...) * dt`, which
        // integrates a sine instead of offsetting by one: the ride clock always
        // runs 0 to 90 seconds, so every ride left a *net* displacement — about
        // 7 m for the slowest clouds and 11 m for the middling ones, while the
        // fastest happened to land back where they started. Ten rides in, the
        // band had pulled itself apart and CLOUD_BASE meant nothing. The band
        // used to be rebuilt for every visit, which is why it never showed.
        const baseY = (cloud.userData.baseY as number) ?? cloud.position.y;
        cloud.position.y = baseY + Math.sin(elapsed * 0.14 * drift) * 1.4;
      }
    },

    dispose(): void {
      disposeTree(root);
    },
  };
}
