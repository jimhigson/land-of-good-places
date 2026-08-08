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

/*
 * **A branch ends at the middle of the lane it carries. There is nothing above
 * it.**
 *
 * This is Jim's ruling of 7 August 2026, and it replaces a shape that did not
 * hold the track up:
 *
 * > *"actually the track supports don't even join to the track"*
 * > *"just make the branches terminate at the middle of the track — the
 * > different branches can all reach different heights"*
 * > *"that vertical section of supports under the rail ride isn't needed"*
 *
 * ## What was wrong, measured
 *
 * Until now a trestle's four tops were all **level**, at a `beamY` plane below
 * the lowest the rails ever get, and eight 0.124 m *droppers* carried on from
 * there to the rails. Measured off the built scene on the canonical seed, the
 * chunky part of the tree finished **0.58 m to 4.30 m short** of the middle of
 * the lane above it. The droppers did touch — they landed exactly half a rail
 * gauge either side of the lane centre — but at an eighth of the trunk's
 * thickness, what a rider sees is a solid tree stopping in mid-air with threads
 * going on above it. Both of Jim's notes describe that one picture.
 *
 * So the droppers are **deleted**, not thinned or thickened, and the branch runs
 * the whole way. One member from fork to track: there is no second piece that
 * has to be positioned by a formula tracking the first (CLAUDE.md, *"two
 * definitions of one thing, kept in step by hand"*).
 *
 * ## Why the tops were level, and what replaces that reason
 *
 * The level plane was not arbitrary. Each lane undulates on its **own** phase
 * (`route.ts`'s `undulation` rotates by `lane * LANE_ROTATION`), so at one
 * station the four lanes stand at four different heights — measured on the built
 * ring, spread up to **4.38 m** across the four, and up to **3.02 m** between the
 * two lanes of a single pair. Hanging all four branches from one level fork
 * would therefore swing a branch between near-vertical and near-horizontal, which
 * is exactly what the old comment here predicted and why it kept the tops level.
 *
 * Jim's *"the different branches can all reach different heights"* is the
 * permission that dissolves it, but the permission alone is not a design. The
 * design is {@link forkPlan}'s drop being measured **down from the lowest lane a
 * fork carries**, not from a plane and not from the pair's mean:
 *
 * - the branch carrying the **lower** of the two lanes gets exactly the solved
 *   drop, so it opens at exactly the solved angle;
 * - the other one has further to climb, so it stands *more upright*, never wider.
 *
 * The solved angle therefore becomes the **widest the fork ever opens**, rather
 * than an angle it can miss in either direction. A branch reaching a higher lane
 * is simply longer and more upright, which reads as the structure following the
 * track — and nothing ever goes near horizontal. That is a stronger property
 * than the old code had, and it is what the invariant asserts.
 */

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
 * How far under the lowest a rail ever gets the notional deck sits that
 * {@link forkPlan} is **solved against**.
 *
 * Moved here from `track.ts` on 7 August. Nothing is built on this plane any
 * more — the branches end at their own lane's middle — but `forkPlan` still
 * needs one post height to solve an angle from, and taking the lowest the track
 * ever gets is what keeps that angle exactly what Jim settled: 30.0 deg on the
 * walk-past ring, 41.6 deg on the race ring.
 *
 * It lives in this leaf module rather than in `track.ts` because
 * `test/procgen/invariants.ts` has to solve the *same* plan in order to say
 * whether the built tree agrees with it. With the number private to `track.ts`
 * the test had been re-deriving the post height from the built branch tops,
 * which stopped meaning the same thing the moment those tops rose to meet the
 * lanes — a second definition of one thing, in the file this repo keeps
 * relearning that lesson in.
 */
export const BEAM_DROP = 0.2;

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

/**
 * Rail centre-to-centre within one lane, **at park scale**. Narrow: it is a
 * one-child cart.
 *
 * A ring builds its own rails at this times its own `route.scale`, so the two
 * rings are two genuinely different structures rather than one geometry with a
 * group transform on it. See `route.ts`'s header for why that matters.
 */
export const RAIL_GAUGE_AT_PARK_SCALE = 0.62;

/** How far a duck bar reaches either side of its lane's centre, at park scale. */
export const BAR_HALF_SPAN_AT_PARK_SCALE = 1.15;

/**
 * The radius of one rail's swept tube, **at park scale**.
 *
 * Lifted out of `track.ts` on 7 August, where it was a bare `0.075` inside the
 * sleeper arithmetic. `test/procgen/invariants.ts` needs it to say how deep the
 * band of real structure under the middle of the track is — which is the
 * tolerance for "a support reaches what it carries" — and copying the number
 * into the test would be exactly the two-definitions-of-one-thing this repo
 * keeps being bitten by. A ring's own rails are this times its `route.scale`.
 */
export const RAIL_RADIUS_AT_PARK_SCALE = 0.075;
