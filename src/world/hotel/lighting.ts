import { DirectionalLight, Group, HemisphereLight, PointLight } from 'three';
import { PALETTE } from '../../core/palette';
import { clamp01, lerp } from '../../core/mathUtils';
import { ROOMS } from './layout';

/**
 * The hotel's own light, which never changes.
 *
 * Jim, having played it: *"the hotel shouldn't have a night/day cycle like
 * outdoors."* `World` now asks one question — *is the player in **any**
 * interior?* — and hands the answer to `DayNight.setIndoors`, which switches
 * the sun, the moon, the fill and the sky's ambient off (see its own doc
 * comment). That is the right rule and it leaves a hole: switch the sky's
 * lights off in a hotel room and the room goes black, because until now the
 * only thing that lit an interior was `building/InteriorLighting.ts` — and
 * that rig is framed, positioned and shadow-cammed to the **castle's** floor
 * plate. Pointing it at a hotel four hundred metres away would light nothing
 * and cast its shadows into an empty field.
 *
 * So the hotel gets its own tiny equivalent: the same idea, a fifth of the
 * machinery.
 *
 * - **No shadows.** The castle's rig casts them because a castle floor is a
 *   room with a ceiling. Hotel rooms are open-topped — the iso camera looks
 *   straight down into them — so a shadow-casting key would need a frustum per
 *   room, four of them, for shadows nobody can see the underside of.
 * - **A key with a direction but no place.** A `DirectionalLight` is
 *   direction-only once it is not casting shadows, so one of them lights all
 *   four rooms identically however far apart they are. That is exactly what is
 *   wanted here: every floor of this hotel is meant to look like the same
 *   sunny afternoon.
 * - **One warm fill per room**, at its centre, above the wall line. This is
 *   the part a directional cannot do: it is what makes a room read as a *room*
 *   — brighter in the middle, falling off into the corners — rather than as a
 *   flat lit plane. Bounded by `POOL_DISTANCE` so a room's own pool cannot
 *   reach the next room along.
 *
 * Lives inside `Hotel.hotelRoot`, which is invisible unless the player is
 * actually in the hotel — three.js skips an invisible subtree when it gathers
 * lights, so all of this costs precisely nothing while she is in the park.
 *
 * Deliberately not a `GameSystem`, for the same reason `InteriorLighting` is
 * not one: a light that never changes needs no frame.
 */

/** How far a room's own warm pool reaches. Rooms are 260 m apart; this is not. */
const POOL_DISTANCE = 34;

/** Matches the park's lamp posts, so a pool of light falls off the same way. */
const POOL_DECAY = 1.0;

/** Bright enough to read as sunlight through a window, gentle enough to be cosy. */
const POOL_INTENSITY = 3.6;

/** How far above the floor a room's fill hangs. Clear of every wall in the hotel. */
const POOL_HEIGHT = 5.2;

/**
 * The light a hung fitting casts — the lobby chandelier's, so far.
 *
 * Here rather than beside the fitting because this file owns what hotel light
 * *is*: the same decay and no-shadow rules as the room pools, warm like the
 * chandelier's own drops, a shade under the pools' intensity so the fitting
 * reads as a glowing ornament in an already-lit room rather than fighting to
 * be the room's key (the disco ball's lesson — a fitting bright enough to be
 * the light source blows the pastels to white). Position it at the cluster's
 * middle; it lives in the hotel root, so it costs nothing outdoors.
 */
export function pendantLight(): PointLight {
  const light = new PointLight(PALETTE.buildingWindowWarm, POOL_INTENSITY * 0.75, 24, POOL_DECAY);
  light.castShadow = false;
  return light;
}

/**
 * How dark the hotel's own light goes while somebody naps, as a fraction of
 * its usual self — **never zero**. ART_DIRECTION's "nothing in this park
 * bottoms out at black" rule applies here exactly as it does to `DayNight`'s
 * own midnight: a nap is meant to read as a cosy, starlit room, not a room
 * with the lights switched off.
 */
const NAP_DIM_FACTOR = 0.34;

export class HotelLighting {
  readonly group = new Group();

  private readonly key: DirectionalLight;
  private readonly ambient: HemisphereLight;
  private readonly baseKeyIntensity: number;
  private readonly baseAmbientIntensity: number;
  /** Every room's own warm pool, so {@link setNapDim} can dim all of them
   *  together — a child asleep in the suite is the only one anybody is
   *  looking at, but the light rig is shared across the whole hotel and
   *  dimming just one room's pool would leave the key and ambient lights
   *  (which reach every room alike) still at full daytime strength. */
  private readonly pools: PointLight[] = [];

  constructor() {
    this.group.name = 'hotel-lighting';

    // Leaning the same way the midday sun does outdoors (see
    // `DayNight.applyLook`), so stepping in from the park is a change of
    // *weather*, not a change of rendering.
    const key = new DirectionalLight(PALETTE.buildingWindowWarm, 1.55);
    key.position.set(-40, 60, -30);
    key.target.position.set(0, 0, 0);
    key.castShadow = false;
    this.key = key;
    this.baseKeyIntensity = key.intensity;

    // Warm sky over a warm floor bounce — the same cosy-rather-than-daylight
    // choice the castle makes, and the reason a crystal lobby at midnight
    // still looks like somewhere you would want to sleep.
    const ambient = new HemisphereLight(PALETTE.sunDay, PALETTE.woodLight, 1.05);
    this.ambient = ambient;
    this.baseAmbientIntensity = ambient.intensity;

    this.group.add(key, key.target, ambient);

    // Read off `ROOMS` rather than listed again here: a floor added to the
    // hotel gets its light for free, and a floor that moves takes its light
    // with it. A hand-kept copy of the floor plan is the bug this project
    // files most often (CLAUDE.md).
    for (const room of ROOMS) {
      const pool = new PointLight(PALETTE.fairyWarm, POOL_INTENSITY, POOL_DISTANCE, POOL_DECAY);
      pool.position.set(room.originX, POOL_HEIGHT, room.originZ);
      pool.castShadow = false;
      this.group.add(pool);
      this.pools.push(pool);
    }
  }

  /**
   * Dims the hotel's whole light rig toward {@link NAP_DIM_FACTOR} of its
   * usual self, for issue #279's follow-up — *"the lighting should dim when
   * sleeping"* (Jim, 18 Aug 2026). `amount` is 0 (wide awake) to 1 (settled
   * into the nap); `Hotel.update` eases it up when a nap starts and back
   * down when it ends, so the change reads as the room dimming rather than
   * a light switching.
   *
   * Scales every light **from its own base intensity**, not by repeatedly
   * multiplying whatever the light is currently at — the latter would drift
   * further from the truth every time a nap started before the last one's
   * fade had finished, which is exactly the "two definitions of one thing"
   * trap CLAUDE.md opens with.
   */
  setNapDim(amount: number): void {
    const factor = lerp(1, NAP_DIM_FACTOR, clamp01(amount));
    this.key.intensity = this.baseKeyIntensity * factor;
    this.ambient.intensity = this.baseAmbientIntensity * factor;
    for (const pool of this.pools) pool.intensity = POOL_INTENSITY * factor;
  }
}
