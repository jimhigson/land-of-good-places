import { Color, DirectionalLight, Group, HemisphereLight, PointLight, Vector3, type Light } from 'three';
import { PALETTE } from '../../core/palette';
import { LIGHT_DECAY } from '../LampPosts';

/**
 * **The reading room's own light — dim, warm, and the same at midnight as at
 * noon.** Jim's brief (#714): *"a dimly lit atmosphere"*, decided as *warm
 * pools of lamplight from reading lamps and sconces, plum shadows between the
 * stacks, never black.*
 *
 * `World.playerInAnyInterior` switches the sky's own lights off indoors
 * (`DayNight.setIndoors`, the hotel's rule), so the room lights itself, and
 * because nothing here follows the clock there is no day or night inside.
 *
 * - **A low plum fill**: a hemisphere of lilac over plum ink — what the
 *   shadows between the stacks are made of. Low, so the room reads dim; never
 *   zero, so nothing bottoms out at black.
 * - **A dim warm key over the camera's shoulder** (the fixed rig looks from
 *   +X+Z, so the light does too): the faces the camera sees keep their shape
 *   without the room reading lit.
 * - **The room's own materials barely glow** ({@link LIBRARY_INTERIOR_LIFT}):
 *   the park's other interiors lift every surface by a sixth of its colour so a
 *   cutaway never reads gloomy, which is right for a doll's house and wrong for
 *   a dim reading room — at that lift the floor read lit with no lamps at all.
 * - **Warm pools**: one `PointLight` per lamp the layout marks `pool` — the
 *   story corner's two floor lamps, the nooks' lamps, the desk lamp and three
 *   sconces. Every other lamp and sconce glows (an emissive shade) without a
 *   light of its own.
 *
 * **The budget is eight point lights**, the Reptile House hall's count — the
 * most any room in the park lights itself with (`hotel/lighting.ts` gives each
 * room one pool; the castle spends none, `castleLighting.ts`, because its
 * cutaway shows several storeys at once). The room root is invisible outside,
 * and three.js skips an invisible subtree's lights, so none of this costs
 * anything in the park.
 */

/**
 * How bright one lamp's pool is, and how far it reaches before it is gone.
 * Short on purpose: eleven metres of reach (the first cut) overlapped every
 * pool with every other and lit the whole room the same warm orange, so there
 * were no pools at all. At five and a half, each lamp lights its own corner
 * and the aisles between stay dim.
 */
export const LIBRARY_POOL_INTENSITY = 4.5;
export const LIBRARY_POOL_DISTANCE = 5.5;
/** The point lights a room in this park may spend. */
export const LIBRARY_LIGHT_BUDGET = 8;

/**
 * The fill and the key: low, so the room reads dim and its lamps read as
 * pools, and high enough that its darkest floor — the aisles between the
 * stacks, out of every lamp's reach — still renders brighter than
 * `PALETTE.ink` (`check:library`'s LIGHT clause, which measures it with the
 * floor's own small lift and asserts the lift alone could not pass). The hotel
 * lights its rooms with a daylight fill of 1.05 and a key of 1.55; this is the
 * park's dimmest room on purpose.
 */
const FILL_INTENSITY = 0.4;
const KEY_INTENSITY = 0.25;

/**
 * How much the reading room's floor and walls glow by themselves, as a share
 * of their own colour — a quarter of the park's other interiors' lift
 * (`building/parts.ts`'s `interiorMaterial`), so the lights, not the paint,
 * decide how bright the room is.
 */
export const LIBRARY_INTERIOR_LIFT = 0.04;

export interface PoolSpot {
  readonly id: string;
  /** Room-local. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class LibraryLighting {
  readonly group = new Group();
  /** Every light, for the checks: none may be black, and the pools are within budget. */
  readonly lights: Light[] = [];

  constructor(pools: readonly PoolSpot[]) {
    this.group.name = 'library-lighting';
    if (pools.length > LIBRARY_LIGHT_BUDGET) {
      throw new Error(`Library: ${pools.length} lamp pools asked for, the budget is ${LIBRARY_LIGHT_BUDGET} — mark fewer lamps 'pool' in layout.ts`);
    }

    const fill = new HemisphereLight(PALETTE.markerLilac, PALETTE.ink, FILL_INTENSITY);
    fill.name = 'library-fill';
    const key = new DirectionalLight(PALETTE.fairyWarm, KEY_INTENSITY);
    key.name = 'library-key';
    key.position.set(20, 40, 28);
    key.target.position.set(0, 0, 0);
    key.castShadow = false;
    this.group.add(fill, key, key.target);
    this.lights.push(fill, key);

    for (const pool of pools) {
      // The park's lamp posts' own falloff, asked of them: a pool of light dies the same way everywhere.
      const light = new PointLight(PALETTE.fairyWarm, LIBRARY_POOL_INTENSITY, LIBRARY_POOL_DISTANCE, LIGHT_DECAY);
      light.name = `library-pool-${pool.id}`;
      light.position.set(pool.x, pool.y, pool.z);
      light.castShadow = false;
      this.group.add(light);
      this.lights.push(light);
    }
  }
}

/**
 * **How much light reaches an up-facing patch of floor at room-local (x, z)**
 * — the irradiance three.js's own lighting sums for it, from the lights
 * actually built: the hemisphere's sky term, the key's cosine, and each
 * pool's inverse-distance falloff times its range window (three.js's
 * `getDistanceAttenuation`, `decay` 1) times its cosine. Linear RGB.
 *
 * `check:library` asks it across the whole plate and holds the darkest
 * patch's rendered brightness above the park's own darkest colour,
 * `PALETTE.ink`. A measure of the rig as built, not of the numbers above.
 */
export function floorIrradiance(lights: readonly Light[], x: number, z: number, target = new Color()): Color {
  target.setRGB(0, 0, 0);
  const point = new Vector3(x, 0, z);
  const toLight = new Vector3();
  for (const light of lights) {
    if (light instanceof HemisphereLight) {
      // An up-facing normal sees all sky.
      target.r += light.color.r * light.intensity;
      target.g += light.color.g * light.intensity;
      target.b += light.color.b * light.intensity;
    } else if (light instanceof DirectionalLight) {
      toLight.copy(light.position).sub(light.target.position).normalize();
      const cos = Math.max(0, toLight.y);
      target.r += light.color.r * light.intensity * cos;
      target.g += light.color.g * light.intensity * cos;
      target.b += light.color.b * light.intensity * cos;
    } else if (light instanceof PointLight) {
      toLight.copy(light.position).sub(point);
      const d = toLight.length();
      if (light.distance > 0 && d >= light.distance) continue;
      let falloff = 1 / Math.max(Math.pow(d, light.decay), 0.01);
      if (light.distance > 0) falloff *= Math.pow(Math.max(0, 1 - Math.pow(d / light.distance, 4)), 2);
      const cos = Math.max(0, toLight.y / d);
      target.r += light.color.r * light.intensity * falloff * cos;
      target.g += light.color.g * light.intensity * falloff * cos;
      target.b += light.color.b * light.intensity * falloff * cos;
    }
  }
  return target;
}
