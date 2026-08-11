import { PLAYER_RADIUS } from '../core/constants';

/**
 * The four numbers that tune `FoliageFade`'s sightline test.
 *
 * ## Why they are not just consts inside `FoliageFade.ts`
 *
 * `scripts/check-statue-occlusion.mts` proves the fountain statue always fades
 * before it can hide a child. To be worth having, that check **re-implements
 * the sightline maths from scratch** rather than calling into `FoliageFade` —
 * two independent derivations of the same answer catch a mistake that one
 * shared helper called twice never would.
 *
 * **That argument covers the algorithm and not the numbers.** The check used to
 * hand-copy these four, and a copied parameter is not independence, it is
 * duplication with a delay fuse: widen `SIGHTLINE_MARGIN` in the game and the
 * check would go on measuring the old fade and **reporting success** — exactly
 * the fail-open hazard that check's own preconditions exist to prevent,
 * arriving from the other side of the test. So the maths stays re-derived and
 * the numbers are shared.
 *
 * They live here, in their own module, rather than being exported from
 * `FoliageFade.ts`, so a check script can read the numbers without importing
 * the whole system (three.js, the scenery graph) behind a headless run. The
 * original reason was sharper — `FoliageFade`'s constructor used a *parameter
 * property*, which Node's type-stripping rejects, so importing that file at all
 * threw `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. That hazard is now gone repo-wide
 * (`erasableSyntaxOnly` in `tsconfig.json` forbids parameter properties, so
 * every file is import-safe on plain Node), but the split still earns its keep
 * on import weight alone, so it stays.
 *
 * If you are about to "restore consistency" by folding these back into
 * `FoliageFade.ts`, that is the change this note is asking you not to make: it
 * would break every check that imports them, and quietly invite the copies back.
 */

/**
 * Trees further than this from the player are never considered, however they
 * line up — the cheap reject that keeps this a distance test rather than a
 * real query. A tree that could hide the player is always close to them; one
 * lining up with the sightline from much further away is background scenery,
 * not something "in the way".
 */
export const NEAR_PLAYER_RADIUS = 9;

/**
 * Heights sampled up a `SightlineOccluder`'s axis. See
 * `FoliageFade.capsuleOnSightline` for why sampling is enough.
 */
export const CAPSULE_SAMPLES = 9;

/**
 * How much slack the sightline test gives a tree's own bounding radius, in
 * metres — the player's own girth plus a little forgiveness so the fade
 * begins a touch before the tree is dead centre on the line, rather than
 * flickering right at the geometric edge of "in the way".
 */
export const SIGHTLINE_MARGIN = PLAYER_RADIUS + 0.35;

/**
 * Never treat a tree at (or past) the player themselves as "in front of"
 * them — only the segment strictly between the camera and the player counts.
 */
export const MAX_LINE_T = 0.985;
