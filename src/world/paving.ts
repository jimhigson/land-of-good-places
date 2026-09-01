/**
 * **What paving is worth to a walker — the one number, and the one map.**
 *
 * Jim, 31 August 2026: *"the pathfinding seemingly gives no weighting to paths
 * (for player and NPC) - make it prefer walking on paths, but off them is
 * possible too if you with some reasonable weighting penalty"* (issue #416).
 *
 * Routes used to cut across grass as readily as they followed paving, because
 * `NavGrid`'s A* charged every lattice step the same `1` (or `√2`) whatever it
 * was standing on. The park's path network was therefore decoration: the
 * generator worked hard to lay out a street plan nobody who lives in the park
 * ever used.
 *
 * ## Why this module exists at all
 *
 * Both movers already share **one router** — `world/NavGrid.ts`. The player's
 * tap-to-walk builds one (`Game.ts`), and `JourneyPlanner` builds one per space
 * for the children (`entities/npc/journey.ts`); both call the same `findRoute`.
 * So the penalty has exactly one home, inside that A*, and there is no second
 * constant anywhere to keep in step by hand (CLAUDE.md, "two definitions of one
 * thing"). This module holds it, and holds the map it is charged against, so
 * that neither can be re-derived by a third party.
 *
 * `NavGrid` cannot simply `import { isOnPath } from './pathGraph'`: that
 * module's body *runs the whole path solve*
 * (`PATH_GRAPH = takePrewarmedPathGraph() ?? buildGraph()`), and `NavGrid` is
 * imported by the castle and hotel interiors and by checks that must never
 * generate a park. So the direction is inverted — the owner of the drawn
 * network **publishes** where it put the paving, and the router reads it.
 * `buildPaths()` is the publisher, because it is the one function that knows
 * where the ribbons actually went.
 *
 * ## Nothing published means nothing changes
 *
 * Before `buildPaths()` runs — and for ever, in an interior test harness that
 * never builds a garden — {@link forEachPavedDisc} reports that no paving is
 * known, and `NavGrid` charges the flat cost it always did. That keeps the
 * hotel and castle lattices (where "paving" is not a thing) bit-for-bit as they
 * were, and it is why {@link pavingIsKnown} is exported: a check that means to
 * measure path preference must assert paving was published, or it would pass
 * green while measuring nothing at all.
 */

/**
 * **What a metre off the paving costs, as a multiple of a metre on it.**
 *
 * The one definition, read by the one router both movers share.
 *
 * Tuned against a six-year-old rather than against a metric, and the geometry
 * picks the floor for us. A path network laid on a grid (Decision 3 — the
 * routes run on grid axes) offers, against any diagonal shortcut across the
 * grass inside it, a right-angled walk of exactly **√2 ≈ 1.414** times the
 * diagonal's length. Below that the diagonal always wins and *nothing whatever
 * changes*, so "a bit over 1" is not an answer — it ships the feature inert.
 *
 * Measured on the canonical park with `scripts/check-path-preference.mts`,
 * over 87 junction-to-junction routes and 109 short hops out onto the grass:
 *
 * | multiplier | route length on paving | worst detour | worst short hop |
 * | ---------- | ---------------------- | ------------ | --------------- |
 * | 1 (before) | 55.0%                  | —            | —               |
 * | 1.2        | 63.6%                  | +7.7%        | —               |
 * | **1.414**  | **71.9%**              | +12.3%       | —               |
 * | **1.6**    | **79.8%**              | **+19.0%**   | **+0.2%**       |
 * | 1.8        | 85.9%                  | +25.4%       | —               |
 * | 2.0        | 92.3%                  | +33.8%       | +4.6%           |
 * | 2.5        | 94.1%                  | +34.5%       | +21.5%          |
 *
 * **1.6** is the answer, and the number that decided it was not in the table.
 * Routes were drawn over the park's own paving at 1.6 and at 2.0 and looked at:
 * at 2.0 the walk from the gate to the far ride runs along the top street,
 * **dips off it and comes back up** — a visible U, the exact shape of Jim's
 * *"why did she go that way?"* — and at 1.6 the same walk is clean. Numerically
 * 2.0 is the better park; to a watching adult it is the worse one, and Jim's
 * test is the adult, so 1.6 it is. (2.5 fails on the other side too: it starts
 * charging real detours for the bench three metres off the kerb.)
 *
 * Two properties come free with a multiplier of 1.6, and both are asserted by
 * `check:path-preference` rather than merely believed:
 *
 * - **Eccentricity is bounded by arithmetic.** On-path cost is exactly the
 *   distance walked, so an optimal weighted route can never be longer than this
 *   multiple of the direct one — **60% at the very worst**, and only when it
 *   buys paving the whole way. Measured, it never spends more than 19%.
 * - **Off-path stays possible everywhere.** A multiplier is a preference, never
 *   a wall: grass, the roof garden's meadow and the gaps between attractions
 *   all remain reachable, they simply cost more to cross. Nothing is excluded,
 *   so nothing can be stranded — measured at 200 reachable destinations before
 *   and 200 after.
 */
export const OFF_PATH_COST_MULTIPLIER = 1.6;

// There is deliberately no `ON_PATH_COST_MULTIPLIER` beside it. Paving is not
// priced, it *is* the unit — one cost unit per cell walked — and that is load
// bearing rather than tidy: `NavGrid`'s octile heuristic measures in cell units
// at cost 1, so it only stays admissible (and A* only stays optimal) while
// nothing is cheaper than paving. A constant here would invite someone to set
// it to 0.8 and quietly break the search.

/** A round patch of paving, in world metres. */
export type PavedDiscSink = (x: number, z: number, radius: number) => void;

/** Something that can enumerate every paved patch it drew. */
export type PavedDiscSource = (sink: PavedDiscSink) => void;

let source: PavedDiscSource | null = null;

/**
 * **Declares where the paving went.** Called by `pathGraph.ts`'s `buildPaths()`
 * — the one function that draws the ribbons — with a reader over the same
 * centreline samples `distanceToPath` already answers from, so the router and
 * the scenery placer cannot end up with different ideas of where the paving is.
 *
 * Idempotent: a rebuild simply replaces the reader, and the reader is live, so
 * a re-drape (`drapePathsOverBridges`, which only moves paving in *y*) needs no
 * republication.
 */
export function publishPaving(reader: PavedDiscSource): void {
  source = reader;
}

/**
 * Hands every paved patch to `sink`. Returns false — having called `sink`
 * exactly nought times — when no paving has been published, which is the
 * honest state of an interior harness and the state in which routing is
 * unweighted.
 */
export function forEachPavedDisc(sink: PavedDiscSink): boolean {
  if (!source) return false;
  source(sink);
  return true;
}

/**
 * Has anywhere published paving yet? Exported so a check that means to measure
 * path preference can refuse to run rather than pass green against a park with
 * no paving in it — a check that cannot fail is this repo's dominant defect.
 */
export function pavingIsKnown(): boolean {
  return source !== null;
}

/**
 * Forgets the published paving. **For tests and checks only**, so one process
 * can measure a weighted router and an unweighted one without two parks.
 */
export function forgetPavingForTesting(): void {
  source = null;
}
