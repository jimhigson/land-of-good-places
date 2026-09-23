/**
 * **The Rail Race's dimensional constants, in a module that imports nothing.**
 *
 * Every number here is a plain literal (or arithmetic on one) describing how
 * big the ride is. They used to live in `./route.ts` beside the
 * {@link RailRaceRoute} class that spends them, which read better and was a
 * latent import-time crash.
 *
 * ## Why they had to move
 *
 * `route.ts` imports `parkLayout`, which reaches back round to the rail race:
 * `hazards` -> `route` -> `parkLayout` -> ... -> `hazards`. Inside an import
 * cycle there is no "first" module — evaluation order is whichever side the
 * entry point reaches first — so a module-scope `const` computed from a
 * binding imported out of the same cycle can be evaluated while that binding
 * is still in its **temporal dead zone**. It does not fail sometimes; it fails
 * for one set of entry points and works for every other, which is the worst
 * way for a thing to fail. Two whole check steps — `check:cart-shape` and
 * `check:ground-claims` — died at import with
 * `Cannot access 'RIDE_SCALE' before initialization` and
 * `Cannot access 'NOMINAL_OUTSET' before initialization`, before either could
 * check anything at all.
 *
 * **A module with no imports of its own cannot be caught by this**, and that
 * is the whole mechanism: ES module evaluation is a post-order walk of the
 * dependency graph, so a leaf is always evaluated before anything that imports
 * it, whatever the entry point and whatever order the import statements are
 * written in. That is measured, not assumed — see the commit that added this
 * file.
 *
 * ## The rule that follows, and it is not "be careful"
 *
 * Two things that do **not** work, both tried:
 *
 * - *Re-exporting* these from `route.ts` (`export { RIDE_SCALE } from
 *   './dimensions'`) does not help a module-scope reader. The indirect binding
 *   still resolves through `route.ts`, whose own imports are walked first, so
 *   the leaf may not have been evaluated yet. **A module-scope reader must
 *   import from this file directly.** `route.ts` re-exports them anyway, so
 *   that the many callers who only read them *inside functions* did not have
 *   to change — those are safe either way, because a function body does not
 *   run at import time.
 * - Making each offending constant lazy (a getter, a function) fixes that one
 *   constant and pushes the problem onto its callers, who then have to be lazy
 *   too. `ENTRANCE_ROAD_OUTSET` is the worked example: it is eager, and it
 *   reads an eager thing that reads this file.
 *
 * **`pnpm exec node --no-warnings scripts/scan-cycle-tdz.mts`** lists every
 * module-scope initialiser in `src/` that still reads a binding from its own
 * import cycle. Run it after adding a constant to any module in one; if the
 * constant is a plain dimension, it belongs here.
 */

/** Four lanes, one per racer. */
export const LANE_COUNT = 4;

/**
 * The lane the player rides: the **outermost**, and so the one nearest a camera
 * that sits outside the ring looking in.
 *
 * Straight from the retired 2D game's note on the same choice: the player wants
 * the row of the picture where nothing can ever be drawn in front of them.
 */
export const PLAYER_LANE = LANE_COUNT - 1;

/**
 * The circle the shared arc length `s` is measured on — the same for both
 * rings, so `travelled` means the same distance whichever one a rider is on.
 *
 * **Chosen by the wide ring's outer edge, not by taste.** The race ring is four
 * lanes at `LANE_SPACING_AT_PARK_SCALE * RIDE_SCALE` = 2.75 m plus a 1.55 m
 * gauge: 9.80 m of radial width, 4.90 m of it either side of this circle. At
 * 65.5 m its innermost rail sits at 60.6 m — clear of the boundary masonry at
 * `ENTRANCE_WALL_RADIUS` (60 m), which is what "outside the park" has to mean if
 * it is to mean anything. Any smaller and the inner rail is back over the wall;
 * any larger and the outer rail walks out onto the hillside for no gain.
 */
export const NOMINAL_OUTSET = 6.5;

/**
 * **How wide a cart is at park scale — the one number the ring is built around.**
 *
 * The tub is authored in `art/blend/cart.blend`, not here, so this is a
 * *statement about the asset* rather than a second definition of it:
 * `check:cart-shape` measures the built hopper's own widest vertices and fails
 * the build if they disagree with this number. That is what stops the two
 * drifting apart, which is this repo's most common bug by a distance.
 *
 * ### 7 August 2026: 1.04 -> 1.10, because her arm came through the side
 *
 * Jim, having ridden it: *"the characters arm clips through the mine cart -
 * make the box of the cart wider until this no longer happens"*. Measured by
 * ray-casting the built hopper against every vertex her arms draw, her hand
 * reached **0.285 m outside the tub** at ride scale.
 *
 * The cause was the *taper*, not the width: the tub was 0.62 m across at its
 * floor and 1.04 m at its rim, and her hands hang only **24% of the way up that
 * wall**. So most of the fix is shape — the wall is now vertical from the bevel
 * to the rim instead of sloping — and only 0.06 m of it is extra footprint. A
 * uniform widening big enough to fix the floor would have needed 1.36 here, and
 * the corridor below has nothing like that much room.
 *
 * **1.10 is a ceiling, not a preference.** Every extra centimetre here walks the
 * outermost lane — the one the player rides — further out, and the race camera
 * stands off *that* lane round a ~22 m hairpin where it is already turning
 * tighter than she is. Swept against the park's own
 * `raceCameraNeverRunsBackwards` invariant: 1.04, 1.06, 1.08 and 1.10 pass;
 * **1.12 fails on seed 5** at 0.049 m of camera per metre of rider against its
 * 0.05 floor. So this is the widest the ring can carry, and it is enough.
 *
 * Worst remaining clearance across the four poses that move her arms: **0.058 m**
 * (seated and boost; the duck has more, and the victory jump lifts her arms clear
 * of the tub altogether). Guarded in `check:rail-race`.
 */
export const CART_WIDTH_AT_PARK_SCALE = 1.10;

/**
 * Metres between neighbouring rails **at park scale**. A ring's own spacing is
 * this times its {@link RailRaceRoute.scale}, so the race ring keeps the 2.8 m
 * of lane pitch its carts need and the walk-past ring is a genuinely narrower
 * structure rather than the same one drawn small.
 *
 * **Exactly one cart wide, and derived rather than copied.** It was an
 * independent 1.04 that happened to equal the cart's own 1.04, with nothing
 * anywhere saying they had to agree — so the four carts sat side by side with
 * zero gap by coincidence, and any widening of the cart would silently have made
 * neighbours interpenetrate. Lanes are one cart apart because a cart has to fit
 * in one; that is the rule, and this is now the only place it is written.
 */
export const LANE_SPACING_AT_PARK_SCALE = CART_WIDTH_AT_PARK_SCALE;

/**
 * The size-up of the carts, riders, rail gauge and lane spacing on the **race
 * ring** — `RailRaceRoute.scale` for that ring, and the multiplier the cart and
 * rider models take while they are on it.
 *
 * Deliberately not physics: the arc length, the undulation and every hazard's
 * position are shared with the walk-past ring, so nothing about *when* anything
 * happens in a race moves. Only how big the ring and the things riding it are.
 *
 * A scratch fix (1 August 2026) tried making the camera stand closer with a
 * wider lens instead, and hit a real ceiling: past ~120° horizontal FOV the
 * rider — pinned near the screen's edge by `RaceCamera`'s own
 * `RIDER_SCREEN_X_PORTRAIT` — grew too big for her own anchor point and
 * clipped off it, the opposite of "the character should be the focus of the
 * screen." Worse, the solve at 130° broke down numerically (a bisection that
 * had assumed a moderate lens produced a nonsense 140 m "visible ahead").
 * Scaling what is actually drawn sidesteps both problems: no camera geometry
 * to re-derive, and nothing to clip, since the anchor point itself does not
 * move.
 *
 * The value is the family's own pick from a screenshot sweep at 1.5×, 2×,
 * 2.5× and 3× — 1.5× already read clearly bigger without losing the park
 * behind her; 3× was mostly a hat filling the screen. 2.5× is the answer.
 */
export const RIDE_SCALE = 2.5;

/**
 * How high the rails fly above the ground under the nominal circle.
 *
 * Nothing in the park has to be cleared out here any more — the rings stand on
 * the empty hilltop apron outside the wall — so this is now a *sightline*
 * number rather than a clearance one: high enough that the side-on camera,
 * standing outside the ring, looks in over the boundary wall and the treeline
 * at the park rather than at masonry. Kept at the value the family already
 * approved the race's framing at rather than re-picked, and still asserted
 * against the ground it crosses by `scripts/check-rail-race.mts`.
 */
export const BASE_HEIGHT = 9.5;
