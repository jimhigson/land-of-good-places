/**
 * **How big a flower gets** — the two or three floats anything outside the
 * meadow needs, and nothing else.
 *
 * `./trainDimensions`'s shape, deliberately, and for the same reason (issue
 * #226): three floats should not drag three.js, the instanced meshes, the
 * interact zones and `./Scenery` in behind them. `world/Flowers.ts` imports
 * these; `test/procgen/invariants.ts` imports them too, and **could not
 * import `Flowers.ts`** — that module reaches `pathGraph`, `anchors` and
 * `Scenery`, so pulling it into `test/` would load the park before the seed
 * is set, which is the "one failure and 76 silent skips" trap CLAUDE.md
 * records. This module reaches nothing.
 *
 * ## Why it exists at all, which is a bug worth not repeating
 *
 * `flowersClearTheRailway` first measured a flower's reach by taking the
 * bounding sphere of the stem's *unscaled unit* `CylinderGeometry(0.02,
 * 0.028, 1, 4)` — **0.5008 m**, of which 0.5 is the cylinder's own half
 * *height* and 0.0008 the radius. A vertical dimension standing in for a
 * horizontal one, ignoring the per-instance scale, under a comment claiming
 * it was {@link WIDEST_FLOWER} "restated". It was not: the real figure is
 * 0.6372 m, so the invariant asked for 13.6 cm less than it said it did, and
 * a pure no-op modelling change — unit height 1 → 2, compensated in the
 * instance scale — would have silently doubled it.
 *
 * That is this repo's most common bug (CLAUDE.md, "Two definitions of one
 * thing, kept in step by hand") in its plainest form: a second definition,
 * with a comment asserting the two agree. One owner now, and everybody asks.
 */

/**
 * Size multipliers for a large flower, over the small model's targets.
 *
 * The stem grows rather more than the bloom does (2.9× against 2×), which is
 * what turns the small flower's ground-hugging blob into something that reads
 * as *a stem with a flower on top* rather than just a bigger blob.
 */
export const LARGE_STEM_SCALE = 2.9;
export const LARGE_HEAD_SCALE = 2.0;

/**
 * The tallest and widest a flower can ever grow, derived from the same two
 * ranges `Flowers.spawnAt` draws its targets from (`0.18..0.32` stem,
 * `0.17..0.27` head) and the same `1.18` wiggle flare the update applies —
 * never restated, so a retune of either moves this with it.
 *
 * {@link WIDEST_FLOWER} is a **horizontal half-extent**: how far the bloom
 * reaches from the stem it sits on. That is the number a keep-out wants, and
 * the number every caller here passes as a clearance radius —
 * `clearOfCruiser`, `clearOfRailway`, `CollisionWorld.isClearCircle`, and
 * `test/procgen`'s `no flower grows on the railway`.
 */
export const TALLEST_FLOWER = 0.32 * LARGE_STEM_SCALE + 0.27 * LARGE_HEAD_SCALE * 1.18;
export const WIDEST_FLOWER = 0.27 * LARGE_HEAD_SCALE * 1.18;
