/**
 * **Is a build that threw a park that could not be made, or a bug?**
 *
 * The root acceptance loop (`acceptedPark.mts`) starts a park again when its
 * build throws, because a solver giving up — `park solve: decision zero
 * exhausted`, `RailRouteUnsolvable`, a refusal nothing could answer — is a
 * stream this seed cannot make a park from. A bug is not that. Seed 15 restart
 * 7 threw `TypeError: Cannot read properties of undefined (reading 'x')` from
 * deep inside three's Catmull-Rom, and the loop simply tried restart 8: the bug
 * was filed as one more failed park, every run, and nothing said so.
 *
 * So a build error is a **bug** when anything in its `cause` chain is one of
 * JavaScript's own programming-error classes — `TypeError`, `RangeError`,
 * `ReferenceError`, `SyntaxError`. Decided **by class, never by message**:
 * solvers throw `Error` or their own subclasses of it, and a generator that
 * finds an impossible state on purpose (`paths.ts` `routeCurve` on a
 * one-point route) throws a `RangeError` so that it lands here. The chain is
 * walked because the plan's driver wraps whatever a builder threw in an `Error`
 * carrying the trace (`parkPlan.ts` `solveParkPlanNow`), with the original as
 * its `cause`.
 *
 * `park-attempt.mts` reports such an attempt as `broken`, which stops the loop.
 */
const BUG_CLASSES: readonly (new (...args: never[]) => Error)[] = [TypeError, RangeError, ReferenceError, SyntaxError];

/** The programming error in `error`'s cause chain, or null when it is an ordinary failure to make a park. */
export function buildBug(error: unknown): Error | null {
  const seen = new Set<unknown>();
  for (let at: unknown = error; at instanceof Error && !seen.has(at); at = at.cause) {
    seen.add(at);
    if (BUG_CLASSES.some((kind) => at instanceof kind)) return at;
  }
  return null;
}
