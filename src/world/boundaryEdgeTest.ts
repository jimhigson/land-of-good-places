import type { ParkBoundary } from './boundary';

/**
 * **`(x, z, margin) => boundary.distanceToEdge(x, z) < margin`, the same
 * boolean for every input, as fast as this boundary can give it.**
 *
 * A boundary built by `profileBoundary` (the park's own) registers an exact
 * test that answers most queries from a per-cell lower bound on the distance,
 * without measuring it (see the note on `closerThan` in `boundary.ts`); any
 * other boundary is measured. Ask once per search and keep the function.
 *
 * Its own module, holding nothing but types and this registry, so the rail
 * generator can ask without importing `boundary.ts` (and through it the seed,
 * the manifest and the entrance) at module scope.
 */
export function edgeCloserThan(boundary: ParkBoundary): (x: number, z: number, margin: number) => boolean {
  return fastEdgeTests.get(boundary) ?? ((x, z, margin) => boundary.distanceToEdge(x, z) < margin);
}

/** Called by `profileBoundary` for each boundary it builds. */
export function registerFastEdgeTest(
  boundary: ParkBoundary,
  test: (x: number, z: number, margin: number) => boolean,
): void {
  fastEdgeTests.set(boundary, test);
}

const fastEdgeTests = new WeakMap<ParkBoundary, (x: number, z: number, margin: number) => boolean>();
