import type { PathGraph } from './paths';

/**
 * **A one-slot letterbox for a walk graph solved before `pathGraph.ts` was
 * loaded.**
 *
 * The same mechanism as `train/crossingPrewarm.ts`, `train/prewarm.ts`,
 * `coaster/prewarm.ts` and `slide/prewarm.ts`, for the same reason and
 * deliberately not a second design — see those files for the full argument.
 * What differs is only which solve it covers.
 *
 * ### Why the walk graph needed one (24 August 2026)
 *
 * The street-lattice rework (PR #286) made `buildGraph()` solve every route
 * ON a shared 12 m lattice — Dijkstra per destination, clearance screens per
 * edge — which took the module-scope solve from a frame's worth to ~215 ms
 * in one un-sliceable block on a CI-speed box. `check:park-boot`'s event-loop
 * lag timer sees exactly that kind of import-time block (250 ms ceiling), so
 * the solve is now spread over the cat-bus ride's frames — driven a
 * destination at a time by `boot/parkGeneration.ts`'s slice scheduler over
 * `paths.ts`'s `pathGraphSearch()` and handed here.
 *
 * ### Why it is take-once
 *
 * {@link takePrewarmedPathGraph} clears the slot as it reads it, so a graph
 * can never be served twice. A stale graph is the dangerous failure: it is a
 * function of `PARK_SEED`, and a leftover from an earlier seed would put
 * every path, lamp and NPC waypoint over a park that no longer exists —
 * silently, and only on the second park built in one process.
 *
 * Nothing calls {@link offerPrewarmedPathGraph} in Node: the harness,
 * `check:park` and `test:procgen` never pre-warm, so `PATH_GRAPH` solves
 * straight through exactly as it always has and CI is untouched.
 */
let waiting: PathGraph | null = null;

/**
 * Hands over a walk graph solved elsewhere. The next `pathGraph.ts` load
 * takes it. Must be called **before** anything imports `pathGraph.ts`
 * directly or transitively — after that `PATH_GRAPH` has already solved the
 * slow way and this would be ignored. `boot/parkGeneration.ts` sequences
 * that, and is the only caller.
 */
export function offerPrewarmedPathGraph(graph: PathGraph): void {
  waiting = graph;
}

/** Takes the waiting graph, if there is one, emptying the slot. */
export function takePrewarmedPathGraph(): PathGraph | null {
  const graph = waiting;
  waiting = null;
  return graph;
}
