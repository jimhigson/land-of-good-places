/**
 * **GENERATED — `pnpm run accept:parks -- <seeds> --write`. Do not edit by hand.**
 *
 * For each shipped seed, the restart the root acceptance loop accepted: the
 * first restart (`parkRestart.ts`) whose finished park passed every
 * acceptance measure — every procgen invariant and every `check:park` key
 * (`scripts/lib/acceptedPark.mts`). So the park a seed *is* — in the browser,
 * in every check, in the prebuilt park file — is restart `ACCEPTED_RESTARTS[seed]`
 * of it, known at import with no search.
 *
 * This is the loop's answer recorded, never a second opinion kept in step by
 * hand: `test:procgen` builds every seed here at its recorded restart and asks
 * the same measures again (a seed file per entry — `check:accepted-restarts`
 * proves the two lists agree), so a generator change that makes a recorded
 * park fail goes red in CI, and the remedy is to re-run the loop with
 * `--write`, which searches again from restart 0. A seed not listed here has
 * no recorded answer: Node runs the loop for it (`acceptParkCached`), the
 * browser builds restart 0.
 */
export const ACCEPTED_RESTARTS: Readonly<Record<number, number>> = {
  0: 2,
  1: 6,
  2: 0,
  3: 0,
  4: 2,
  5: 2,
  6: 0,
  7: 2,
  8: 1,
  9: 0,
  10: 1,
  11: 0,
  12: 0,
  13: 0,
  14: 0,
  15: 0,
};
