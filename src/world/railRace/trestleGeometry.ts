/**
 * **The shape of a Rail Race trestle, as numbers.**
 *
 * A leaf module: it imports *nothing*, and in particular nothing that reaches
 * `parkManifest`. That is the whole reason it exists, and it is issue #226's
 * precedent (`train/trainDimensions.ts`, `slide/landing.ts`) rather than a new
 * idea. `test/procgen/invariants.ts` has to measure a built trestle against the
 * numbers it was built from — otherwise it is checking a second copy of them,
 * which this repo's own history says will drift. But a static import of
 * `railRace/track.ts` into `test/` would pull in `parkLayout.ts` and fix the
 * park's seed before the harness sets `LGP_SEED`, which once cost 76 silently
 * skipped assertions and one very confusing afternoon.
 *
 * So the geometry lives here, `track.ts` builds from it, and the tests measure
 * against it. One owner, reachable from both sides, seed-free.
 */

/**
 * The base post's radii, at its top and at its foot.
 *
 * **Twice** the 0.26 / 0.34 a trestle leg used to be. Jim, 5 August 2026: "the
 * supports under the race track are far too thin and angular" — and
 * ART_DIRECTION §1 agrees on principle ("chunky rounded shapes, no sharp edges,
 * **no thin parts**"), which a 0.26 m pole holding up a ring nine metres in the
 * air was quietly failing.
 */
export const POST_TOP_RADIUS = 0.52;
export const POST_FOOT_RADIUS = 0.68;

/** What a leg's foot radius used to be, so the doubling is checkable. */
export const LEGACY_LEG_FOOT_RADIUS = 0.34;

/**
 * How much slimmer each generation of branch is than the one it grew from.
 *
 * A tree that keeps its trunk's thickness all the way to the tips reads as
 * plumbing; one that tapers reads as grown. Two generations at 0.62 take the
 * 0.52 m trunk top to 0.32 m and then 0.20 m, which is still thicker at the tip
 * than the old leg's *foot* was.
 */
export const BRANCH_TAPER = 0.62;

/**
 * The angle a branch wants to make with whatever it split from — Jim's "~30º",
 * twice over.
 *
 * **It does not always fit, and that is measured rather than assumed.** Reaching
 * the race ring's four lane centres means a total sideways reach of
 * `1.5 * laneSpacing` = 4.125 m, which at 30° needs `4.125 / tan(30°)` = 7.14 m
 * of fork. Only 6.60 m exists between the ground and the trestle's tops, and
 * that is *before* leaving any base post at all — so 30° on the race ring is not
 * a tuning choice, it is geometrically impossible (the floor, with a zero trunk,
 * is 32.0°).
 *
 * So this is a *target*: {@link forkPlan} opens the angle only as far as the
 * ring's own span forces, and no further. The walk-past ring, whose half-span is
 * 1.65 m, gets exactly 30°. The race ring lands at 41.6°, and the invariant
 * measures and reports whatever it actually got rather than trusting this.
 */
export const BRANCH_ANGLE = Math.PI / 6;

/**
 * The least of the post's height that must stay unforked, as a fraction.
 *
 * Jim asked for "the base post", singular, before any splitting — so a tree
 * whose fork starts at the ground is not what was described however well it
 * reaches the lanes. This is what stops {@link forkPlan} spending the whole post
 * on branches when the span is wide.
 */
export const MIN_TRUNK_FRACTION = 0.3;

/**
 * Where one trestle's trunk stops and its branches start, solved for this post's
 * own height and this ring's own lane spacing.
 *
 * Pure, so `test/procgen/invariants.ts` can ask the same question of a built
 * trestle without re-deriving the arithmetic — the "did it actually get 30°?"
 * answer has exactly one owner.
 */
export function forkPlan(
  postHeight: number,
  laneSpacing: number,
): { readonly fork: number; readonly lower: number; readonly upper: number; readonly angle: number } {
  // The lower fork reaches a whole lane spacing sideways, the upper one half of
  // it — so giving the lower twice the height makes both angles equal, whatever
  // the total turns out to be. That is why one `angle` describes both.
  const reach = 1.5 * laneSpacing;
  const wanted = reach / Math.tan(BRANCH_ANGLE);
  const affordable = postHeight * (1 - MIN_TRUNK_FRACTION);
  const fork = Math.min(wanted, affordable);
  const lower = (fork * 2) / 3;
  return { fork, lower, upper: fork / 3, angle: Math.atan(laneSpacing / lower) };
}

/**
 * How far apart the sleepers bridging a lane's two rails sit, in metres.
 *
 * Jim, 5 August 2026: "the sky ride and race should have cross-bars like railway
 * sleepers between the tracks at about 1m intervals". A metre of real track,
 * deliberately **not** scaled by a ring's own size the way a sleeper's width is:
 * "about 1 m" is a statement about the world, not about this ring, and scaling it
 * would put 6000 sleepers on the walk-past ring for scenery nobody rides.
 *
 * Costed before building it, because nothing in this game is frustum-culled: a
 * 600.2 m lap at 1 m is 600 sleepers a lane, 2400 a ring, 4800 across both
 * rings, and a box is 12 triangles — 57,600 triangles, or 2.4% on a scene that
 * already draws 2.37 M. One `InstancedMesh` per ring, so it is one draw call
 * either way.
 */
export const SLEEPER_SPACING = 1;

/**
 * A sleeper's own dimensions, authored at the race ring's size the way every
 * other bare number in `track.ts` is (see its `ringSizeVsRace`).
 *
 * `OVERHANG` is how far it sticks out past the rail it carries on each side —
 * the detail that makes it read as a sleeper the rails are bolted to rather than
 * as a rung between them.
 */
export const SLEEPER_OVERHANG = 0.5;
export const SLEEPER_THICKNESS = 0.14;
export const SLEEPER_ALONG_TRACK = 0.42;
