import { DirectionalLight, Group, HemisphereLight, PointLight } from 'three';
import { PALETTE } from '../../core/palette';
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

export class HotelLighting {
  readonly group = new Group();

  constructor() {
    this.group.name = 'hotel-lighting';

    // Leaning the same way the midday sun does outdoors (see
    // `DayNight.applyLook`), so stepping in from the park is a change of
    // *weather*, not a change of rendering.
    const key = new DirectionalLight(PALETTE.buildingWindowWarm, 1.55);
    key.position.set(-40, 60, -30);
    key.target.position.set(0, 0, 0);
    key.castShadow = false;

    // Warm sky over a warm floor bounce — the same cosy-rather-than-daylight
    // choice the castle makes, and the reason a crystal lobby at midnight
    // still looks like somewhere you would want to sleep.
    const ambient = new HemisphereLight(PALETTE.sunDay, PALETTE.woodLight, 1.05);

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
    }
  }
}
