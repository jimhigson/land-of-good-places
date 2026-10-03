/**
 * **check:castle-towers — the castle's four corner turrets are solid, and
 * solidity has not cost anyone a place to stand.** (Issue #549.)
 *
 * The facade's own collider is a 24 x 18 m rectangle. The towers stand
 * *outside* it: their axes sit half a wall thickness beyond each corner and
 * their flared feet bulge 2.21 m further out again. So there was about 2.1 m of
 * drawn stone at each of four corners with nothing behind it, and a child
 * walked into a turret and came out the other side. Measured before the fix, on
 * 48 bearings at two strides, all four towers: a player-sized body reached
 * **0.60 m** of the axis of a 2.214 m turret.
 *
 * Nothing was missing from a list. `CASTLE_TOWERS` existed and was correct,
 * `slide/plan.ts` routed around it, and a procgen invariant measured it — the
 * collision world had simply never been told the towers were there. That is
 * CLAUDE.md's opening rule and its stated cause: scenery built with no collider
 * at all. This is the check that would have caught it.
 *
 * ## Why it marches rather than reading the collider list
 *
 * The hotel is the worked example (9 Aug 2026): its collider list was long, the
 * crystals were drawn, the code read plausibly, and six 1.49 m gaps stood open
 * round the building against a 1.24 m-wide child. `check:hotel` had twenty
 * probes about the *inside* and none about walking up to it. Asserting that
 * `addCircle` was called proves a call was made; marching a player-sized body
 * at the thing and asserting where it stops is the only kind of check that can
 * see the class of bug. Two strides are used because a gap you cannot walk into
 * at 5 cm a step you may still tunnel into at `PLAYER_LONGEST_STEP`.
 *
 * ## Every clause carries a control
 *
 * CLAUDE.md records two agents getting clean, decisive, entirely wrong answers
 * from instruments that were measuring the wrong thing, caught only by a
 * control. So the solidity sweep is bracketed by a march at known-solid stone
 * and a march across known-open lawn, and the stand-spot test is bracketed by a
 * point known to be inside a tower and one known to be far away. If a control
 * misbehaves this check fails, because every other number in it would then be
 * meaningless.
 *
 * One park build serves both halves — `checks.yml` runs at 25 minutes against a
 * 30-minute cap, so a second build here would be real cost for nothing.
 */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { castleTowerFindings } from './lib/castleTowers.mts';

// The measurement is `lib/castleTowers.mts`'s, one owner with the acceptance loop.
const { said, voids, code, decisions } = await castleTowerFindings(buildHeadlessPark());
const problems = [...voids, ...code, ...decisions];
for (const line of said) console.log(`  ${line}`);
if (problems.length > 0) {
  console.error(`\ncheck:castle-towers FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\ncheck:castle-towers OK — every corner turret is solid from every bearing, and no ' +
  'doorway or stand spot was lost to making it so.');
