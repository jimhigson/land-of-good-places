/**
 * **The Sky Cruiser's track, as numbers.**
 *
 * A leaf module importing *nothing*, for the reason `railRace/trestleGeometry.ts`
 * and `train/trainDimensions.ts` exist: `test/procgen/invariants.ts` has to
 * measure the built ride against the numbers it was built from, and a static
 * import of `coaster/Coaster.ts` into `test/` would drag in `parkLayout.ts` and
 * fix the park's seed before the harness sets `LGP_SEED` — the failure that once
 * cost 76 silently skipped assertions.
 *
 * Split out on 7 August 2026, when the invariant asking "does a pylon actually
 * touch the track?" needed to know how deep the track's own structure is and the
 * only alternative was writing 0.075 and 0.08 out again in the test. A tolerance
 * copied from the geometry it is judging is not a measurement of it.
 */

/** The radius of one of the Cruiser's two swept rail tubes. */
export const RAIL_RADIUS = 0.075;

/** How thick a tie is, top to bottom. */
export const TIE_THICKNESS = 0.08;

/**
 * How far below the track's centre line a tie's own centre sits.
 *
 * So the track's structure occupies `TIE_DROP + TIE_THICKNESS / 2` = 0.16 m
 * below the centre line, and a rail's underside sits at {@link RAIL_RADIUS}
 * below it, resting on the tie.
 */
export const TIE_DROP = 0.12;

/**
 * How far a support's tip may stop short of the middle of the track and still be
 * carrying it.
 *
 * One rail radius plus half a tie — the same rule the Rail Race's branches are
 * judged by, written from this ride's own numbers. The point is that the tip
 * must be inside the tie, with material around it, rather than grazing its
 * lowest fibre.
 *
 * **That distinction is the whole of it, and it was measured.** The pylons used
 * to be sunk a flat 0.15 m under the centre line while the ties occupy 0.08 to
 * 0.16 m below it: the tops were inside the tie by **one centimetre**. So they
 * did touch — the Sky Cruiser was never floating the way the Rail Race was — but
 * a centimetre of engagement on a 0.68 m post is contact by luck rather than by
 * design, and nothing was measuring it either way. At 0.115 m this goes red on
 * that old geometry and green with room on a pylon that reaches the middle.
 */
export const SUPPORT_REACH_TOLERANCE = RAIL_RADIUS + TIE_THICKNESS / 2;
