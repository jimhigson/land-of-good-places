/**
 * **Does a route use the paving that is right there?**
 *
 * ```
 * pnpm run check:path-preference [--verbose]
 * ```
 *
 * Jim, 31 August 2026: *"the pathfinding seemingly gives no weighting to paths
 * (for player and NPC) - make it prefer walking on paths, but off them is
 * possible too if you with some reasonable weighting penalty"* (issue #416).
 * The park's generator lays out a street plan and then everybody who lives in
 * the park walked straight across the lawn, because `NavGrid`'s A* charged the
 * same `1` per step whatever the step was standing on.
 *
 * This measures the **real park**, with the **real router**, and it measures
 * both of the things Jim asked for at once, because either alone is easy to
 * satisfy and useless:
 *
 * 1. **Routes use the paving.** Between two junctions of the solved path
 *    network — the network's own nodes, never coordinates typed in here, and
 *    only the ones a child could actually stand at (see `standable`) — a
 *    route must spend most of its length on paving. Two statements, both about
 *    **one** population (routes that arrived, over pairs the paving can serve
 *    within {@link OFF_PATH_COST_MULTIPLIER}): a **mean** floor of 70%, and a
 *    **distribution** rule — *at least 85% of routes are at least 60% paved* —
 *    so one heroic route cannot carry a bad mean. Both numbers were derived by
 *    measuring all five procgen seeds, and the tables that derive them sit on
 *    the constants themselves. The same bar is then put to the **unweighted**
 *    router and asserted to fail, so the mutation test runs on every
 *    invocation rather than living in a transcript that goes stale.
 * 2. **It is a preference, not a wall.** The same probes are run a second time
 *    against a second lattice built with the paving forgotten, and:
 *    - **nothing may become unreachable**: every destination the unweighted
 *      router reaches, the weighted one must reach too, across a lattice of
 *      destinations spread over the whole park — grass, meadow, the gaps
 *      between attractions;
 *    - **nothing may become eccentric**: no weighted route may be longer than
 *      {@link OFF_PATH_COST_MULTIPLIER} (plus the smoother's own 8% allowance)
 *      times the unweighted one. That bound is not a tuning knob, it is
 *      arithmetic — paving costs exactly the distance walked, so an optimal
 *      weighted route can never exceed the multiplier times the direct one —
 *      and asserting it here is what stops a future "make it prefer paths
 *      harder" from walking a six-year-old round the houses. It is the
 *      machine-checkable form of *"would a watching adult say: why did she go
 *      that way?"*
 * 3. **Both movers, one penalty.** The children plan through
 *    `JourneyPlanner.plan`, not through the player's grid, so the same probes
 *    are put through a real `JourneyPlanner` and must come back with the same
 *    paving fraction. Two routers that ever stopped sharing the constant — the
 *    bug class CLAUDE.md names as this repo's most-cited — would part company
 *    here, on a number, rather than in somebody's play session.
 *
 * "On the paving" is asked of `pathGraph.ts`'s own `isOnPath`, the same
 * function the scenery placer uses, so this check cannot invent a second idea
 * of where the paths are. And it refuses to run at all unless the park
 * published some paving (`pavingIsKnown`): a check that measures a park with no
 * paths in it would sail green for ever while proving nothing, which is the
 * defect this repo has the most of.
 *
 * ## Proven red by mutation
 *
 * Re-run 1 September 2026 **after rebasing onto `origin/main`'s hoppable-wall
 * cost and after the standable-endpoint fix below**, because a transcript is a
 * measurement and measurements go stale (CLAUDE.md): the park these were
 * proved against is the park in the working tree today.
 *
 * **Mutation 2 — the smoother stops respecting the weighting** (delete the
 * `chordCost > (polyCost + legCost) * (1 + SMOOTH_CORNER_TOLERANCE)` line in
 * `NavGrid.smooth`; the feature shipped with only half of it, which is the
 * subtle way to get this wrong). This is the honest proof of the two
 * assertions below, because it does not touch `OFF_PATH_COST_MULTIPLIER`, so
 * the population is unchanged and only the routes move:
 *
 * ```
 * canonical (82 probes):
 *   ok    routes stay on the paving: mean 71.5%  (floor 70%)      [was 83.4%]
 *   FAIL  most routes are mostly paved: 65 of 82 (79.3%), bar 85% [was 79 of 82, 96.3%]
 * seed 11, the binding seed (50 probes):
 *   FAIL  routes stay on the paving: mean 57.3%  (floor 70%)      [was 74.4%]
 *   FAIL  most routes are mostly paved: 21 of 50 (42.0%), bar 85% [was 47 of 50, 94.0%]
 * exit=1
 * ```
 *
 * Note which one bites where. On the canonical park the **distribution** rule
 * is what goes red while the mean survives at +1.5 — which is exactly why the
 * distribution rule exists, and why a mean alone would have let this mutation
 * through on the one seed most people run.
 *
 * **Mutation 1 — `OFF_PATH_COST_MULTIPLIER = 1`**, the behaviour before this
 * issue. This also exits 1, but **be precise about why, because it is not the
 * paving assertions that fail**: the servable predicate is defined in terms of
 * that very multiplier, so setting it to 1 collapses the population to 2 probes
 * and the run stops at the `< 8` guard with *"only 2 of 89 probes both arrive
 * and have a paved route inside 1x (2 servable, 89 arriving)"*. Red, and
 * loudly, but it is the guard talking, not a measurement of paving. Note the
 * *89 arriving*: all of them do, which is the standable-endpoint fix showing
 * its work — before it, this line read 78 of 100.
 *
 * **A transcript is a measurement, and measurements go stale** (CLAUDE.md), so
 * what mutation 1 was *for* is asserted live instead, on every invocation, by
 * `the bar is a real bar` below. The unweighted lattice is that mutation —
 * built in this same process, at the true multiplier, over the true
 * population — and the check requires it to fail the very bar the weighted one
 * passes. It fails it by 43.5 points on the canonical park and by 38.3–71.8
 * across the five seeds. That is the strongest form of the claim available
 * here: not
 * "someone once saw this go red", but "it is red right now, in this run".
 *
 * **Mutations 3 and 4, 25 September 2026**, on `fix/sb-pathpref` over the
 * accepted parks (`LGP_SEED=s`, restart from the committed table of that day), with every
 * sampler covering the park's own outline:
 *
 * - **3 — a band's price back to `ground * M`** (`NavGrid`'s `bandedStep`).
 *   Seed 0: `FAIL stepping off the kerb stays a step … worst 80.4% (kerb →
 *   (11, -7) 2.7 m off)`, 421 hops — a lawn bench along the kerb at
 *   z ≈ -5.25, x 6.5–13.5, walked round (8.02 m) instead of over (4.45 m).
 *   Seed 9: `… worst 117.2% (kerb → (-13, 11) 3.2 m off)`, 401 hops. Exit 1
 *   both. Fixed: 15.0% and 13.7% worst.
 * - **4 — the paved-only lattice clipped back to `GARDEN_PLAY_RADIUS + 2`.**
 *   Seed 11: `FAIL the paving is one network: 140 of 204 junction pairs have
 *   no all-paved walk at all (first: ballPit → dodgems)`, exit 1 — and, before
 *   that assertion existed, **every other assertion passed** on the 63 probes
 *   the clipping left, which is why it exists.
 *
 * **Not every "no comic detour" ceiling here is arithmetic.** The bound the
 * header states holds when neither route touches a hoppable wall; once the
 * unweighted route pays a hop, its length is less than its cost and the
 * weighted route may legitimately exceed `1.6 × 1.08` of it. The two kerb
 * failures above were that case with a real bug inside it (the hop priced 1.6×
 * dearer on the lawn); a failure here after a change to hop pricing wants the
 * same diagnosis before anyone reaches for a number.
 *
 * ## Every seed, not just the canonical one
 *
 * The thresholds here were derived on **all five procgen seeds** (canonical
 * `20260728` plus 5, 11, 18, 24 — `LGP_SEED=n pnpm run check:path-preference`),
 * because a threshold read off one park is a threshold that breaks on the next
 * one: that is exactly what happened to the two constants this file used to
 * carry. Seed **11** is the binding seed on every statement below and is the
 * one to measure first if the paving moves.
 *
 * **Two things about that list have changed since, and both matter if you
 * re-derive (#510).** First, **seed 18 is retired** — it structurally needs a
 * level crossing, and since 2 Sep 2026 every rail crossing is a bridge, so its
 * park no longer builds at all. Every "all five seeds" transcript below was
 * taken while it did, and they are left at the basis they were actually
 * measured against rather than rewritten, because a transcript edited to a
 * list it was never run on stops being a measurement. Second, the sweep list
 * has an owner now: `CI_SWEEP_SEEDS` in `parkSeedPool.ts`, seven seeds today.
 * **Re-derive against that, not against the five in the line above.**
 *
 * And note what this script itself does at runtime: it builds **one** park,
 * whichever seed the process resolved to — canonical, in CI. The sweeping was
 * done by hand, by a person setting `LGP_SEED`. So a green run here is a
 * statement about the canonical park; the thresholds are what carry the other
 * seeds, and they carry them only as well as the last hand sweep did.
 */

import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { ACCEPTANCE_SCOPE, exitVoid } from './lib/checkScope.mts';
import { pathPreference } from './lib/pathPreference.mts';

// The measurement is `lib/pathPreference.mts`'s, one owner with the acceptance loop.
const verbose = process.argv.includes('--verbose');
const result = await pathPreference(buildHeadlessPark(), { verbose });
if (result.voids.length > 0) exitVoid();
// Under the acceptance scope (`lib/checkScope.mts`) only decision clauses fail;
// the router's are reported as outside it. In CI every clause fails.
const failures = [...result.decisions, ...(ACCEPTANCE_SCOPE ? [] : result.code)];
if (ACCEPTANCE_SCOPE) {
  for (const line of result.code) console.log(`CODE (outside acceptance: fixed at cause, never restarted around) ${line}`);
}
if (verbose || failures.length > 0) for (const line of result.table) console.log(line);

if (failures.length > 0) {
  console.error(`\ncheck:path-preference — ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
console.log(result.summary);
