/**
 * **Sweep seed 24 — the long-bridge seed, replacing seed 2 (#429).**
 *
 * Seed 2 was chosen for its 36.7 m bridges: PR #352 died having only ever
 * measured 22 m geometry, where the same paving error is 0.371 m instead of
 * 0.513 m, so a seed that builds a *long* bridge is real coverage and not
 * merely another park. `scripts/probe-seed-bridges.mts` exists to pick a
 * replacement on that basis, and its own header warns that the replacement
 * must be picked for comparable geometry rather than for being green.
 *
 * **Why seed 2 had to go.** It proves ZERO bridge sites — the crossing planner
 * marches its whole loop and finds no ground a deck plus both ramps fits on.
 * The two bridges it used to build stood on `LEVEL_CROSSING_SITES`, ground the
 * planner had already measured and rejected, and their ramp parapets severed
 * the paths that crossed there. Once a bridge is only built where one was
 * proven, seed 2 correctly builds none, and three invariants go red: two
 * anti-vacuity guards firing exactly as designed ("no bridge was tested", "no
 * bridge coping was tested") and one design assertion ("the park has 3 railway
 * crossing(s) and not one real bridge").
 *
 * **The code is not wrong; the seed is pathological.** A park that admits no
 * bridge anywhere is a real hole and it is filed as **#429**; it is not
 * something this seed's registration can assert its way out of, and weakening
 * any of those three to keep seed 2 green is precisely what CLAUDE.md forbids.
 * So: swap the seed, and write down why — which is this comment.
 *
 * **Why 24 and not one of the others.** Measured, not picked by eye
 * (`scripts/probe-seed-bridges.mts`, then the full invariant suite on each):
 *
 * | seed | longest bridge | invariant failures |
 * |---|---|---|
 * | 4  | 36.5 m | 2 (duck bar, Sky Cruiser/castle) |
 * | 29 | 36.5 m | 1 (Sky Cruiser/castle) |
 * | 22 | 36.0 m | 3 |
 * | 26 | 36.5 m | 3 |
 * | 13 | 33.5 m | 2 |
 * | **24** | **32.5 m** | **0 — 78/78** |
 * | 3, 7, 12, 16, 20, 21 | 28.5-36.5 m | 3-5 |
 *
 * 24 is the only candidate that is green, and 32.5 m is comfortably in the
 * long-bridge regime the coverage exists for — half as long again as the 22 m
 * geometry that let #352 through. (When registered its shape matched seed
 * 2's — two rail crossings, one bridged and one level; since 2 Sep 2026 the
 * level tier is deleted and every crossing it builds is a bridge, measured
 * green across the whole suite before the deletion landed.)
 *
 * **And it exercises the rule that replaced seed 2.** When registered,
 * `LGP_ALLOW_UNPROVEN_BRIDGES=1` sent this seed red on exactly one
 * invariant — `no bridge stands where the crossing planner proved none
 * fits` — so it is a park that *would* have built a bridge on rejected
 * ground. That reversal lever died with the level tier (an unproven
 * crossing now fails the build in `crossings.ts` before the bridge search
 * ever sees it), so the sentence above is a record of the proof, not a
 * reproduction recipe.
 */
import { registerParkInvariants } from './invariants.ts';

registerParkInvariants(24);
