

/**
 * How far a booth may step aside, in metres.
 *
 * Deliberately about a stride and a half: far enough to clear a lamp's
 * clearance disc or a trestle foot, short enough that the counter stays on the
 * apron the path spur already paved. It is a **cap on the search**, not the
 * safety argument — {@link accepts} below measures the stand point on every
 * candidate, so a shift of 0.3 m that stranded a doormat would be refused just
 * as a shift of 3 m would.
 */
export const STALL_SHIFT_REACH = 1.5;

/**
 * A booth that has been built, as far as this builder needs to know it: take
 * your colliders out of the world so a candidate can be tested without you
 * refusing yourself, and put yourself — mesh, colliders and all — at a spot.
 *
 * `null` from {@link BoothRelocator} means *this booth does not move*, which is
 * a legitimate answer for a booth whose geometry is derived from world
 * coordinates in a hundred places rather than hung off one group.
 */
export interface BoothPlacement {
  withdrawCollision(): void;
  placeAt(x: number, z: number): void;
}

export type BoothRelocator = (id: string) => BoothPlacement | null;
