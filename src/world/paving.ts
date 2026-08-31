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
 * diagonal's length. So:
 *
 * - **At or below 1.414 the diagonal always wins** and *nothing whatsoever
 *   changes* — the feature would be inert while looking implemented. That is
 *   the number to beat, and it is why "something a bit over 1" is not an
 *   answer.
 * - **1.6** clears it with real margin: she is sent round two sides of the
 *   lawn rather than across it, which is what a person does.
 * - It also **bounds the eccentricity**, which is the other half of Jim's ask.
 *   Because on-path cost is exactly the distance walked, an optimal weighted
 *   route can never be longer than this multiple of the direct one: the worst
 *   detour the router is capable of is **60% further**, and it only spends that
 *   when it genuinely buys paving the whole way. A watching adult asking "why
 *   did she go *that* way?" is asking about a route that is twice as long, and
 *   this cannot produce one.
 * - Off-path stays **possible everywhere**. This is a multiplier, never a wall:
 *   grass, the roof garden's meadow and the gaps between attractions all
 *   remain reachable, they simply cost more to cross. Nothing is excluded, so
 *   nothing can be stranded.
 *
 * Higher was tried and rejected: at 2.5 a bench three metres off the kerb drags
 * the walk fifteen metres up the path and back, which is exactly the comic
 * detour the issue warns against.
 */
export const OFF_PATH_COST_MULTIPLIER = 1.6;

/** Cost of a metre of paving, in the same units. Paving is the yardstick. */
export const ON_PATH_COST_MULTIPLIER = 1;

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
