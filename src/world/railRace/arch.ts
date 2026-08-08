import { Vector3 } from 'three';
import { RIDER_HEAD_TOP_AT_PARK_SCALE } from './hazards';
import { RIDE_SCALE, type RailRaceRoute, UNDULATION_REACH } from './route';

/**
 * **Where the finish rainbow's feet come down — the one owner of that answer.**
 *
 * `track.ts` builds the arch and `paths.ts` has to keep the paving out from
 * under it, and before this they could not both know: the formula lived inside
 * `buildArch`, which runs when the scene is built, long after the walk network
 * has been drawn. So the arch simply came down wherever it came down, and on
 * seeds 5 and 11 that was **on the path** — twelve legs between 1.14 m *inside*
 * the paving and 0.40 m from its edge, against the 1.24 m (two player radii) a
 * child needs to get past. Nothing checked it, because nothing could.
 *
 * The fix is Decision 6's, not a nudge: the ride **publishes what it solved**
 * and the walk network treats it as an obstacle, exactly as it already does for
 * every plot. The arch does not move — it cannot; its radius is solved from
 * rider head height and lane span and its position is the ride's own finish
 * line, which the duck bars, the spark zones and `RACE_DISTANCE` are all
 * measured from. The paths move, which is what a real park does when somebody
 * builds something enormous on it.
 *
 * Kept in its own module so `paths.ts` can reach it without importing
 * `track.ts` — that file pulls in the whole scene-building world, and
 * `paths.ts` runs at module load.
 */

/** Rainbow bands. `ART.rainbow` in `track.ts` is the art; this is the count. */
export const ARCH_BAND_COUNT = 6;

/** Headroom over the tallest rider, and shoulder room past the outermost lane. */
const ARCH_HEADROOM = 1.2;
const ARCH_SHOULDER_ROOM = 2.4;

export interface ArchFoot {
  readonly x: number;
  readonly z: number;
  /** The post's own radius — half the band's tube. */
  readonly radius: number;
}

/**
 * The feet of one ring's arch, inner and outer, for every band.
 *
 * **This is the same arithmetic `buildArch` uses to place the meshes**, and
 * `buildArch` calls it rather than repeating it — two copies of this formula is
 * precisely the bug class that put the legs on the path in the first place.
 */
export function archFeet(route: RailRaceRoute): ArchFoot[] {
  // Derived from the route rather than passed in, so a caller cannot hand in
  // the wrong ring's scale — `track.ts` computes the identical quotient.
  const ringSizeVsRace = route.scale / RIDE_SCALE;
  const at = route.startDistance;
  const outward = route.outwardAt(at, new Vector3());
  const sample = route.path.sampleAt(at);

  const footY = route.base - UNDULATION_REACH - 1.4;
  const clearHeight =
    route.base +
    UNDULATION_REACH +
    RIDER_HEAD_TOP_AT_PARK_SCALE * RIDE_SCALE +
    ARCH_HEADROOM -
    footY;
  const halfWidth = route.laneSpan / 2 + ARCH_SHOULDER_ROOM;
  const innerRadius = Math.hypot(halfWidth, clearHeight);

  const band = 0.55 * ringSizeVsRace;
  const tube = band * 0.5;
  const feet: ArchFoot[] = [];
  for (let i = 0; i < ARCH_BAND_COUNT; i += 1) {
    const radius = innerRadius + i * band;
    for (const side of [-1, 1] as const) {
      feet.push({
        x: sample.x + outward.x * side * radius,
        z: sample.z + outward.z * side * radius,
        radius: tube,
      });
    }
  }
  return feet;
}
