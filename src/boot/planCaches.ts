/**
 * **Derived caches that must forget when a decision is unwound.**
 *
 * Several generator modules memoise things derived from an upstream decision
 * at module level — the railway's corridor samples, the street lattice, the
 * bridge keep-outs, the road's stations. They were written for a world where a
 * decision was made once per process. With backtracking a decision can be
 * re-made, and every memo derived from the old one is then a stale answer
 * nobody announced. So each such cache registers a reset here, and the driver
 * clears them all after any unwind — cheaper and safer than a hand-kept list
 * of which cache depends on which decision (that list would be a second
 * definition of the dependency graph, kept in step by hand).
 */

const resets: (() => void)[] = [];

/** Register a reset for a module-level memo. Called once, at module load. */
export function registerPlanCache(reset: () => void): void {
  resets.push(reset);
}

/** Forget every registered memo. The driver calls this after every unwind. */
export function resetPlanCaches(): void {
  for (const reset of resets) reset();
}

/** For the trace: how many caches are registered — a coverage number, so a silent zero is visible. */
export function planCacheCount(): number {
  return resets.length;
}
