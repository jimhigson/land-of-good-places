/**
 * **Does the park's crowd actually spread out across the park?**
 *
 * ```
 * npm run check:npc-dispersal            # part of npm run build
 * LGP_SEED=20260801 npm run check:npc-dispersal
 * npm run check:npc-dispersal -- --mutate   # prove it can go red
 * ```
 *
 * ## Why this exists
 *
 * Issue #350, reported by Jim on 27 August 2026: *"on entering the park, all
 * the NPCs gather in one place quite soon."* They did. `WanderDriver` walked a
 * non-backtracking random walk on `PoiGraph` — no destination anywhere in the
 * system — and a random walk is **diffusive**, so the crowd's occupancy
 * converged on whichever region had the highest node degree and the longest
 * dwell. In this park that is the plaza: six waypoints packed inside the kerb,
 * mutually visible, every one of them `interesting` and so worth a 0.62-chance
 * pause. Twenty-four children, one fountain.
 *
 * The fix gives every child a real destination and the player's own `NavGrid`
 * to get there. This check is what stops the crowd quietly pooling again — a
 * regression nothing else in the build could see, because the park is
 * perfectly *valid* with every child standing on the same paving slab.
 *
 * ## What is measured, off the running simulation
 *
 * The **real** `World`, stepped through the **real** `world.update` at 1/60 for
 * {@link RUN_SECONDS}. Nothing here models a crowd; it builds one and watches
 * it, which is the same rule `check-npc-separation.mts` and `park-harness.mts`
 * follow.
 *
 * Measured over the children the **journey system is actually steering** —
 * those no activity currently owns (`WanderDriver.occupied`). This is not a
 * loophole, and assertion 4 below is what stops it becoming one.
 *
 * It is necessary because the park deliberately gathers children in places.
 * Investigating a clump this check flagged at the gate turned up ten of the
 * eleven bus children held by `TrainTrip` — **queueing on a station platform
 * for a train**, for about thirty seconds. That is the game working: they are
 * standing together on purpose, at a thing you wait at. Counting them measures
 * the railway timetable, not whether children choose their own destinations.
 * The same goes for a child up a tree, mid-chat, being face-painted, or still
 * aboard the cat bus.
 *
 * Four assertions, and they are deliberately different in kind:
 *
 * 1. **Spread.** The crowd's RMS radius about its own centroid, against the RMS
 *    a *uniform* scatter over the park's own area would have.
 * 2. **No single clump.** No disc a tenth of the park wide holds more than a
 *    third of the children.
 * 3. **The mechanism is what did it.** The children are walking to several
 *    genuinely different attractions. A geometric test alone cannot tell "they
 *    spread out because each is going somewhere" from "they happened to drift
 *    apart", and the second would pass a build that had lost the feature.
 * 4. **Children really do go inside the castle.** Jim asked for it — "This can
 *    include things inside the castle" — and the first cut of this feature
 *    shipped every castle-side piece as *unreachable code*: the shops were in
 *    the attraction list, the planner had a castle lattice, the deck connectors
 *    were threaded through, and no child could ever choose any of it, because
 *    they spawn only on garden waypoints and nothing crossed the threshold. A
 *    ten-minute census found 14400 of 14400 child-samples outdoors. Nothing in
 *    the build could see it: the park was valid, the checks were green, and a
 *    whole requirement was quietly absent. This is the assertion that would
 *    have caught it, so it is here rather than in a note.
 * 5. **Most of the crowd is actually free.** At least half the children must be
 *    out walking rather than held by an activity. Without this, a regression
 *    that parked twenty of the twenty-four on a station platform for ever would
 *    pass by leaving four well-spread children to be measured — the check would
 *    have excused exactly the bug it exists to catch.
 *
 * ## Where the thresholds come from — and why none of them is a number
 *
 * CLAUDE.md: *take thresholds from the game rather than from the generator's
 * own target*, and a check whose limit is a magic constant is a check that gets
 * loosened the first time it is inconvenient. Every threshold below is derived
 * from {@link PARK_BOUNDARY} — the park's own shape — so a park that grows or
 * changes shape re-derives them rather than needing this file edited.
 *
 * - {@link PARK_EQUIVALENT_RADIUS} = `sqrt(area / π)`: the radius of a disc of
 *   the park's own area. The park is a gentle spline, not a circle, so its
 *   `maxRadius` overstates it and its area does not — area is the honest
 *   single number for "how big is this place".
 * - {@link UNIFORM_RMS} = `PARK_EQUIVALENT_RADIUS / √2`: the **exact** RMS
 *   distance from the centre for points scattered uniformly over that disc
 *   (∫₀ᴿ r² · 2r/R² dr = R²/2). This is the honest yardstick: it is what
 *   "spread out over this park" measures, computed rather than guessed.
 * - {@link CLUMP_RADIUS} = `PARK_EQUIVALENT_RADIUS / 10`: "in one place" means
 *   within a tenth of the park's width. On the canonical park that is about
 *   8 m — a knot of children you would read as a crowd rather than as
 *   passers-by, and it is the park that decides it, not this file.
 *
 * ## The clump metric is a disc, not a cluster — and that matters
 *
 * The first version of this check used single-linkage clustering, and it was
 * wrong in a way worth recording. Single linkage is **transitive**: it joins A
 * to C whenever some B sits between them. Eleven children walking away from the
 * gate down the same paved corridor, strung out over eighty metres and plainly
 * not gathered anywhere, came out as one cluster of eleven and failed the
 * check — for the whole first eighty seconds, on correct behaviour.
 *
 * A queue is not a crowd. What Jim reported was children *gathered in one
 * place*, so what is measured is the densest **disc**: the largest number of
 * children within {@link CLUMP_RADIUS} of any one of them. That cannot chain
 * along a path, and it is a direct reading of the words in the complaint.
 *
 * ## Which of these actually has teeth
 *
 * Assertion 1 is the weakest of the three, and it is worth saying so here rather
 * than letting the arithmetic imply otherwise. An N-attraction probe shows the
 * 50% RMS bar **alone** would still pass a crowd narrowed to four destinations:
 * four well-separated attractions spread a dozen children nearly as widely as
 * twelve do. It is assertions **2 and 3** — no dense disc, and a real count of
 * distinct destinations — that would catch that narrowing, and assertion 3 that
 * catches "spread out, but not because anybody chose anything".
 *
 * So read assertion 1 as a floor against gross pooling, not as the proof that
 * the feature works. The `--mutate` run below fails all three, which is the
 * shape to expect: they overlap deliberately, and only their conjunction says
 * what this check claims.
 *
 * The two *fractions* ({@link MIN_SPREAD_FRACTION}, {@link MAX_CLUMP_FRACTION})
 * are the actual judgement being made, and they are stated as fractions on
 * purpose so that judgement is visible and arguable rather than buried inside a
 * metre figure that looks derived. Children congregate at attractions, and
 * attractions are not uniformly scattered, so the crowd can never reach a
 * uniform scatter's spread — half of it is a real bar that the pre-fix
 * behaviour misses comfortably and the fixed behaviour clears comfortably. See
 * the `--mutate` numbers in the PR.
 *
 * ## Proving the check is real
 *
 * `--mutate` gives every child the **same** destination, which is precisely the
 * park Jim complained about: a crowd with somewhere to be, all of it the same
 * somewhere. It is a truer mutation than deleting the feature would be, because
 * it leaves the pathfinding, the arrivals and the pauses all working and
 * changes only the thing this check is about. It must fail. CLAUDE.md has a
 * whole section on checks that pass without checking anything; this is the
 * answer to it, and the red output is quoted in the PR.
 */
import './headless-canvas.mjs';
import { buildHeadlessPark } from './park-harness.mts';
import { ACCEPTANCE_SCOPE } from './lib/checkScope.mts';
import { npcDispersal } from './lib/npcDispersal.mts';

const mutate = process.argv.includes('--mutate');
// The check is `lib/npcDispersal.mts`'s, one owner with the acceptance loop.
const result = await npcDispersal(() => buildHeadlessPark(), { mutate });
for (const note of result.notes) console.log(note);
// Under the acceptance scope (`lib/checkScope.mts`) only decision clauses fail;
// in CI every clause does.
if (ACCEPTANCE_SCOPE) {
  for (const line of result.code) console.log(`  CODE (outside acceptance: fixed at cause, never restarted around) ${line}`);
}
const failures = [...result.decisions, ...(ACCEPTANCE_SCOPE ? [] : result.code)];
if (failures.length > 0) {
  console.error(`\nFAIL: the park's children are not spread across the park${mutate ? ' (--mutate: expected)' : ''}.`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nnpc dispersal OK');
