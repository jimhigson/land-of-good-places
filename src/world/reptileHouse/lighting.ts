import { DirectionalLight, Group, HemisphereLight, PointLight } from 'three';
import { PALETTE } from '../../core/palette';
import { EXHIBIT_PLACEMENTS, GROTTO_ROCK } from './layout';

/**
 * **The hothouse's own light — warm golden hour, constant day and night.**
 *
 * `World.playerInAnyInterior` switches the sky's lights off indoors, so an
 * interior must light itself (`hotel/lighting.ts`'s rule, copied here rather
 * than the castle's plate-framed `InteriorLighting`, which is framed to the
 * castle's floor and lights nothing twelve hundred metres away).
 *
 * - **A key over the camera's shoulder.** The fixed rig looks from +X+Z, so
 *   the light comes from +X+Z too: the faces the camera sees are the lit ones.
 *   Direction-only, no shadows — the hall is open-topped for the camera, and a
 *   shadow map over a 48 × 36 m plate buys nothing a six-year-old would see.
 * - **Green bounce** from a hemisphere, mint over bark: the canopy's own light.
 * - **Six warm pools** at head height along the paths, plus the nursery's
 *   pink heat lamp and the grotto's blue waterfall glow.
 *
 * Inside the hall root, so it costs nothing while she is in the park.
 */
const POOL_INTENSITY = 3.2;
const POOL_DISTANCE = 30;
const POOL_DECAY = 1.0;
const POOL_HEIGHT = 5;

/** The warm pools' hall-local spots — along the paths, never over a case. */
const POOLS: readonly (readonly [number, number])[] = [
  [-14, -8],
  [0, -10],
  [14, -8],
  [-10, 9],
  [8, 12],
  [18, 0],
];

export class ReptileLighting {
  readonly group = new Group();

  constructor(originX: number, originZ: number) {
    this.group.name = 'reptile-house-lighting';

    const key = new DirectionalLight(PALETTE.buildingWindowWarm, 1.4);
    key.position.set(originX + 20, 40, originZ + 28);
    key.target.position.set(originX, 0, originZ);
    key.castShadow = false;
    this.group.add(key, key.target);

    this.group.add(new HemisphereLight(PALETTE.markerMint, PALETTE.barkDark, 0.6));

    for (const [x, z] of POOLS) {
      const pool = new PointLight(PALETTE.fairyWarm, POOL_INTENSITY, POOL_DISTANCE, POOL_DECAY);
      pool.position.set(originX + x, POOL_HEIGHT, originZ + z);
      pool.castShadow = false;
      this.group.add(pool);
    }

    const nursery = EXHIBIT_PLACEMENTS.find((exhibit) => exhibit.id === 'nursery');
    if (nursery && nursery.shape.kind === 'disc') {
      const lamp = new PointLight(PALETTE.fairyPink, 2.4, 12, POOL_DECAY);
      lamp.position.set(originX + nursery.shape.centre.x, 2.6, originZ + nursery.shape.centre.z);
      lamp.castShadow = false;
      this.group.add(lamp);
    }

    const mist = new PointLight(PALETTE.fairyBlue, 2, 12, POOL_DECAY);
    mist.position.set(originX + GROTTO_ROCK.x + 1.5, 2.2, originZ + GROTTO_ROCK.z);
    mist.castShadow = false;
    this.group.add(mist);
  }
}
