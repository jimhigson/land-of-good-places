/**
 * **A check script run as an acceptance measure** — `LGP_CHECK_SCOPE=acceptance`,
 * set by `scripts/park-attempt.mts` for the scripts in `ACCEPTANCE_CHECK_SCRIPTS`.
 *
 * A check judges two kinds of thing, and the root loop must treat them apart:
 *
 * - **decision** clauses, which a park's own decisions set — a different
 *   restart can pass them, so a failure is a reason to start the park again;
 * - **code** clauses, which judge behaviour that is the same on every park —
 *   a failure is fixed at cause, and searching restarts for a park where it
 *   happens not to show would hide it (and, failing on every park, would run
 *   the loop to `MAX_RESTARTS`).
 *
 * Plus the instrument's own **voids** — a control that misbehaved, or nothing
 * found to measure — which no restart can fix: the loop stops on them.
 *
 * So under this scope a script exits **0** unless a decision clause failed
 * (exit **1**, `FAIL` lines on stderr) or it could not measure (exit
 * {@link VOID_EXIT}). Code clauses still run and still print, marked as outside
 * acceptance. Without the scope nothing changes: the script fails on all three,
 * as CI runs it.
 */

/** True when this process is a check being asked as an acceptance measure. */
export const ACCEPTANCE_SCOPE = process.env['LGP_CHECK_SCOPE'] === 'acceptance';

/** The exit code that means "this instrument could not measure" — a broken measure to the loop. */
export const VOID_EXIT = 3;

/** What kind of clause a failure came from. */
export type ClauseKind = 'decision' | 'code';

/** Exit for a void: {@link VOID_EXIT} under the acceptance scope, 1 otherwise (as CI always had it). */
export function exitVoid(): never {
  process.exit(ACCEPTANCE_SCOPE ? VOID_EXIT : 1);
}

/**
 * Whether a failure of this kind fails the run: every kind in CI, only
 * decisions under the acceptance scope.
 */
export function counts(kind: ClauseKind): boolean {
  return !ACCEPTANCE_SCOPE || kind === 'decision';
}
