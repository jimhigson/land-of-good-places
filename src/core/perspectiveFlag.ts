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

let cached: boolean | null = null;

/** True when this load was asked for a perspective park camera. */
export function perspectiveParkCamera(): boolean {
  if (cached !== null) return cached;
  cached = readFlag();
  return cached;
}

function readFlag(): boolean {
  // No `location` in a check script or a headless harness; those get the
  // shipped projection, which is what every existing measurement assumes.
  const search = (globalThis as { location?: { search?: string } }).location?.search;
  if (typeof search !== 'string' || search.length === 0) return false;
  const value = new URLSearchParams(search).get('projection');
  return value === 'perspective' || value === 'persp';
}
