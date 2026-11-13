import { AmbientLight, Color, DirectionalLight, Group, HemisphereLight, PointLight } from 'three';
import { PALETTE } from '../../core/palette';
import { EXHIBIT_PLACEMENTS, GROTTO_ROCK } from './layout';
import { buildLightPools } from './lightPools';

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
 * - **Six warm pools** along the paths, plus the nursery's pink heat lamp and
 *   the grotto's blue waterfall glow.
 *
 * **The light budget (perf step 15): at most {@link REPTILE_POINT_LIGHT_BUDGET}
 * point lights.** The six pools used to be six `PointLight`s, eight in the
 * hall with the two coloured lamps — and every one of them is evaluated on
 * every lit pixel of every toon material in the room. Measured in the perf
 * plan (`docs/perf/FRAME-DROPS-2026-11.md`, item 9): hiding the point lights
 * took the hall's GPU-bound frame drops from 11 to 0. So the six pools are
 * now:
 *
 * - **two warm fills** high over the hall, fitted (least squares, over the
 *   floor and head-height walls, through the toon ramp) to the summed light
 *   the six gave;
 * - **a warm ambient** for the part of that sum two lights cannot reach — an
 *   ambient is one uniform add, not a per-light loop;
 * - **six painted pools** on the floor where the six lights hung
 *   (`lightPools.ts`), so the paths still walk from glow to glow.
 *
 * The pink lamp and the blue mist stay real lights: they are the two whose
 * colour falls on the animals a child is looking at.
 *
 * Inside the hall root, so it costs nothing while she is in the park.
 */

/** The most point lights this hall may hold. The constructor counts and throws past it. */
export const REPTILE_POINT_LIGHT_BUDGET = 4;

const POOL_DECAY = 1.0;

/** The warm pools' hall-local spots — along the paths, never over a case. */
const POOLS: readonly (readonly [number, number])[] = [
  [-14, -8],
  [0, -10],
  [14, -8],
  [-10, 9],
  [8, 12],
  [18, 0],
];

/**
 * The two fills standing in for the six pools' reach. Fitted against six
 * `PointLight(fairyWarm, 3.2, 30, decay 1)` at 5 m over {@link POOLS}: the
 * six summed to a mean 0.67 over the hall (0.74 on the floor); these two with
 * {@link WARM_AMBIENT} match it to 0.17 RMS, and what is left over is the
 * brighter patch under each old light — which is what the painted pools are.
 */
const FILLS: readonly (readonly [number, number])[] = [
  [-9, -3],
  [11, 3],
];
const FILL_HEIGHT = 10;
const FILL_INTENSITY = 6.5;
const FILL_DISTANCE = 40;
const WARM_AMBIENT = 0.19;

/**
 * A painted pool's reach, and how much light its middle adds. The fit's
 * shortfall under an old pool is 0.1–0.37, but the sand is already close to
 * white under the key, and the first cut at 0.3 clipped to six yellow discs
 * (seen in a screenshot, not predicted). A third of that reads as a glow.
 */
const POOL_GLOW_RADIUS = 6;
const POOL_GLOW_PEAK = 0.1;

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
    this.group.add(new AmbientLight(PALETTE.fairyWarm, WARM_AMBIENT));

    for (const [x, z] of FILLS) {
      const fill = new PointLight(PALETTE.fairyWarm, FILL_INTENSITY, FILL_DISTANCE, POOL_DECAY);
      fill.position.set(originX + x, FILL_HEIGHT, originZ + z);
      fill.castShadow = false;
      this.group.add(fill);
    }

    // What a light of POOL_GLOW_PEAK adds to the sand it falls on: light ×
    // albedo ÷ π, the same Lambert term the toon shader applies to a real one.
    const glow = new Color(PALETTE.fairyWarm)
      .multiply(new Color(PALETTE.pathSand))
      .multiplyScalar(POOL_GLOW_PEAK / Math.PI);
    this.group.add(
      buildLightPools(
        POOLS.map(([x, z]) => ({ x: originX + x, z: originZ + z })),
        POOL_GLOW_RADIUS,
        glow,
      ),
    );

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

    const pointLights = countPointLights(this.group);
    if (pointLights > REPTILE_POINT_LIGHT_BUDGET) {
      throw new Error(
        `Reptile House lighting: ${pointLights} point lights, over the budget of ${REPTILE_POINT_LIGHT_BUDGET}. ` +
          'Every point light is evaluated on every lit pixel in the hall — paint the glow (lightPools.ts) instead.',
      );
    }
  }
}

/** Point lights under `group`, counted off the built graph rather than off the lists above. */
export function countPointLights(group: Group): number {
  let count = 0;
  group.traverse((object) => {
    if (object instanceof PointLight) count += 1;
  });
  return count;
}
