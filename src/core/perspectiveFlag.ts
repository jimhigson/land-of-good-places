/**
 * **PROTOTYPE FLAG (#511): is the park camera a perspective one this load?**
 *
 * A developer's URL switch, never a button a child presses, and **not a
 * migration** — it exists so Jim can flip between the two projections on the
 * same park at the same spot and choose from two frames rather than from a
 * description.
 *
 * ```
 * /spawn?pos=0,0                              the park as it ships (orthographic)
 * /spawn?pos=0,0&projection=perspective       the same spot, perspective
 * ```
 *
 * Works on any route — `/spawn`, `/view`, a ride deep link, or the bare root —
 * because it reads the query string directly rather than being threaded through
 * the deep-link parser. That is deliberate for a prototype: the point is to
 * compare *the same* URL twice with one word added.
 *
 * ## Why this exists
 *
 * #511 asked for the park not to sit on a hill. Measured, the hill turned out
 * to be the only thing letting the sky be seen at ground level: under an
 * orthographic camera pitched 38°, **sky can only appear where the ground is
 * steeper than tan(38°) = 78%**, because ortho rays are parallel and a gentler
 * slope never falls away from them. Jim's proposed sphere is gentle by
 * construction — bus-safe needs a radius of ~1400 m, putting its horizon at
 * 870 m — and an orthographic camera draws a horizon at its true distance
 * rather than compressing it, so 870 m is 870 m up-screen, against a frame
 * ~29 m tall and a ground that clips at 270 m.
 *
 * Jim, 4 September 2026, on being shown that: *"Maybe we just use a perspective
 * camera then"*. He is right that the geometry was never the problem — the
 * projection was. This is that experiment.
 *
 * **Read once per load.** The camera is built at boot and the flag cannot
 * change under it; caching also keeps this off the per-frame path.
 */

import { CAMERA_ZOOM_MAX } from './constants';

let cached: boolean | null = null;
/** `undefined` = not yet read; `null` = read, and no usable override present. */
let cachedZoomMin: number | null | undefined;

/** True when this load was asked for a perspective park camera. */
export function perspectiveParkCamera(): boolean {
  if (cached !== null) return cached;
  cached = readFlag();
  return cached;
}

function readFlag(): boolean {
  const search = querystring();
  if (search === null) return false;
  const value = new URLSearchParams(search).get('projection');
  return value === 'perspective' || value === 'persp';
}

/**
 * **PROTOTYPE (#511): how far out `?zoomMin=` lets this load zoom.**
 *
 * ```
 * /spawn?pos=0,0&projection=perspective&zoomMin=0.107
 * ```
 *
 * `null` when absent or unreadable, and the caller then uses the shipped
 * `CAMERA_ZOOM_MIN`, so **a real player's zoom range is untouched**. Any
 * positive value below `CAMERA_ZOOM_MAX` is accepted rather than a menu of
 * three, because the point is for Jim to zoom out with the ordinary control and
 * find the number that feels right — a value somebody discovers by trying beats
 * one an agent picked off a table.
 *
 * A developer's URL switch, never a button a child presses.
 *
 * **Why the number in the example is 0.107 and not 0.25.** The horizon enters a
 * 38°-pitched frame only once the vertical FOV reaches 76°, and FOV comes from
 * the zoom as `2·atan((base/zoom) / CAMERA_DISTANCE)` with `base` = 7.5 m on a
 * landscape screen. That solves to zoom **0.107**. An earlier handoff said
 * 0.254; it had used 17.86 m as the base, which is really the half-height at
 * zoom 0.42, so it was out by 2.38×. Measured on the live camera: `fov` is
 * 9.53° at zoom 1.00 and 22.34° at zoom 0.42.
 *
 * **A bad value never breaks the boot** — it warns and falls back to the
 * shipped floor, the same rule `/spawn` follows for an unreadable coordinate,
 * because these are typed by hand off a screenshot.
 */
export function zoomMinOverride(): number | null {
  if (cachedZoomMin !== undefined) return cachedZoomMin;
  cachedZoomMin = readZoomMin();
  return cachedZoomMin;
}

function readZoomMin(): number | null {
  const search = querystring();
  if (search === null) return null;
  const raw = new URLSearchParams(search).get('zoomMin');
  if (raw === null) return null;
  const value = Number(raw);
  // `Number('')` is 0 and `Number('abc')` is NaN, so both are caught here.
  if (!Number.isFinite(value) || value <= 0 || value >= CAMERA_ZOOM_MAX) {
    console.warn(
      `[#511 prototype] ignoring zoomMin=${raw}: expected a number above 0 and below ` +
        `CAMERA_ZOOM_MAX (${CAMERA_ZOOM_MAX}). Using the shipped zoom floor instead.`,
    );
    return null;
  }
  return value;
}

/** The query string, or `null` where there is no `location` at all — a check
 *  script or a headless harness, which must get the shipped behaviour because
 *  that is what every existing measurement assumes. */
function querystring(): string | null {
  const search = (globalThis as { location?: { search?: string } }).location?.search;
  return typeof search === 'string' && search.length > 0 ? search : null;
}
