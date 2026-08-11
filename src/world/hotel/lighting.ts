import { Color, DirectionalLight, Group, HemisphereLight, PointLight } from 'three';
import { PALETTE } from '../../core/palette';
import { clamp01, lerp } from '../../core/mathUtils';
import { ROOMS } from './layout';

/**
 * The hotel's own light: a warm afternoon that never changes on its own — with
 * one exception, {@link HotelLighting.setNight}, which eases the whole rig to a
 * pale, dim blue while the player naps in the suite (and back again on waking),
 * so getting into bed reads as nighttime. `Hotel` drives that from its nap clock.
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

// ---------------------------------------------------------------------------
// The nighttime look, reached only while the player is napping (see `setNight`).
// "Pale and dim blue", Jim's words: a soft moonlit wash, not blackout — the room
// must still read as a room, just plainly after-dark. The blues are the same
// cool family `DayNight` uses for the outdoor night sky (`ambientSky 0x4a5590`),
// lightened toward pale so the pastels underneath stay pastel rather than going
// muddy. Intensities drop to roughly a third: dim, but never off.
// ---------------------------------------------------------------------------
const NIGHT_AMBIENT_SKY = 0x7d8bc4;
const NIGHT_AMBIENT_GROUND = 0x3b4168;
const NIGHT_AMBIENT_INTENSITY = 0.5;
const NIGHT_KEY_COLOUR = 0x8f9bce;
const NIGHT_KEY_INTENSITY = 0.35;
const NIGHT_POOL_COLOUR = 0x9aa8dc;
const NIGHT_POOL_INTENSITY = 1.2;

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

export class HotelLighting {
  readonly group = new Group();

  /** The direction-only key, the hemisphere fill, and one warm pool per room —
   * kept so {@link setNight} can ease them to blue and back. */
  private readonly key: DirectionalLight;
  private readonly ambient: HemisphereLight;
  private readonly pools: PointLight[] = [];

  // The daytime colours, held as `Color`s so `setNight` can lerp from them
  // without re-reading the palette each frame.
  private readonly dayKey = new Color(PALETTE.buildingWindowWarm);
  private readonly nightKey = new Color(NIGHT_KEY_COLOUR);
  private readonly dayAmbientSky = new Color(PALETTE.sunDay);
  private readonly nightAmbientSky = new Color(NIGHT_AMBIENT_SKY);
  private readonly dayAmbientGround = new Color(PALETTE.woodLight);
  private readonly nightAmbientGround = new Color(NIGHT_AMBIENT_GROUND);
  private readonly dayPool = new Color(PALETTE.fairyWarm);
  private readonly nightPool = new Color(NIGHT_POOL_COLOUR);

  constructor() {
    this.group.name = 'hotel-lighting';

    // Leaning the same way the midday sun does outdoors (see
    // `DayNight.applyLook`), so stepping in from the park is a change of
    // *weather*, not a change of rendering.
    this.key = new DirectionalLight(PALETTE.buildingWindowWarm, 1.55);
    this.key.position.set(-40, 60, -30);
    this.key.target.position.set(0, 0, 0);
    this.key.castShadow = false;

    // Warm sky over a warm floor bounce — the same cosy-rather-than-daylight
    // choice the castle makes, and the reason a crystal lobby at midnight
    // still looks like somewhere you would want to sleep.
    this.ambient = new HemisphereLight(PALETTE.sunDay, PALETTE.woodLight, 1.05);

    this.group.add(this.key, this.key.target, this.ambient);

    // Read off `ROOMS` rather than listed again here: a floor added to the
    // hotel gets its light for free, and a floor that moves takes its light
    // with it. A hand-kept copy of the floor plan is the bug this project
    // files most often (CLAUDE.md).
    for (const room of ROOMS) {
      const pool = new PointLight(PALETTE.fairyWarm, POOL_INTENSITY, POOL_DISTANCE, POOL_DECAY);
      pool.position.set(room.originX, POOL_HEIGHT, room.originZ);
      pool.castShadow = false;
      this.pools.push(pool);
      this.group.add(pool);
    }
  }

  /**
   * Ease the whole rig between its warm afternoon (`factor = 0`) and a pale,
   * dim blue night (`factor = 1`). Called every frame from `Hotel.update` with
   * the nap clock's eased value, so the lights fade down as the pets curl up and
   * back up when she wakes. Absolute (it lerps from the stored day colours each
   * call), so it is self-correcting and leaves the rig exactly at day when
   * `factor` returns to 0 — nothing to reset by hand.
   */
  setNight(factor: number): void {
    const f = clamp01(factor);
    this.key.color.copy(this.dayKey).lerp(this.nightKey, f);
    this.key.intensity = lerp(1.55, NIGHT_KEY_INTENSITY, f);
    this.ambient.color.copy(this.dayAmbientSky).lerp(this.nightAmbientSky, f);
    this.ambient.groundColor.copy(this.dayAmbientGround).lerp(this.nightAmbientGround, f);
    this.ambient.intensity = lerp(1.05, NIGHT_AMBIENT_INTENSITY, f);
    for (const pool of this.pools) {
      pool.color.copy(this.dayPool).lerp(this.nightPool, f);
      pool.intensity = lerp(POOL_INTENSITY, NIGHT_POOL_INTENSITY, f);
    }
  }
}
