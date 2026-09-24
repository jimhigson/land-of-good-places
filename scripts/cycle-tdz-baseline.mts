/**
 * **The module-scope reads that are already inside an import cycle.**
 *
 * `scripts/scan-cycle-tdz.mts --check` ratchets against this list, the same way
 * `check:coplanar` ratchets against `coplanar-baseline.mts`: an entry means
 * "already like this before the gate existed", and anything **not** in the list
 * is a new one somebody has just written.
 *
 * It ratchets in **both** directions, which the coplanar baseline does not:
 * a site that disappears must be deleted from this file in the same commit, or
 * the check fails. That is what makes the count able only to go down. A
 * baseline you may quietly leave stale is a baseline that grows.
 *
 * **Keyed on file and constant name, never on line number.** A line moves every
 * time anything above it is edited, and a baseline that churns on unrelated
 * edits is one people regenerate wholesale rather than read — which is how #520
 * orphaned `check:coplanar` entries by renaming a mesh.
 *
 * **Do not add an entry to make the check pass.** A new finding means a new
 * module-scope read of a binding from its own cycle, which is one import edge
 * away from `Cannot access 'X' before initialization` at import time. Fix it by
 * moving the constant to a module that imports nothing — `railRace/dimensions.ts`
 * is the worked example — or by moving the read inside a function, which does
 * not run at import time.
 */

/** `<path relative to the repo root>::<constant name>` */
export const CYCLE_TDZ_BASELINE: readonly string[] = [
  // The `lazyView` idiom: `planPart` returns a Proxy without forcing the solve,
  // and `parkPlan.ts`'s own state is `var` precisely so it is reachable while
  // that module is mid-evaluation. See HANDOFF-backtracking.md's rule 2.
  'src/world/coaster/plan.ts::COASTER_PLANS',
  'src/world/train/plan.ts::TRAIN_PLAN',

  // Genuinely at risk, each one import edge from crashing. Not yet moved.
  'src/art/style/artPalette.ts::ART',
  'src/world/train/bridgeFit.ts::SITE_RAMP_FLOOR',
  'src/world/train/bridgeFit.ts::SITE_RAMP_IDEAL',
];
