/**
 * **Where the route lattice's cells are** — its pitch, and the frame it is laid
 * in over a space. The one owner of both: `world/NavGrid.ts` builds its lattice
 * in this frame, and `world/dismount.ts` floods in exactly the same cells, so
 * "she can walk out of here" means the same to the put-down rule as to the
 * router a child taps with.
 *
 * **A leaf, with no imports at all, on purpose.** The put-down rule is imported
 * by `Player`, and by `test/procgen/invariants.ts` statically; `NavGrid` reaches
 * `Collision.ts`, which loads the park manifest, and a static import of that
 * from the invariant suite pins every seed to the default park. So the lattice's
 * geometry lives here, where both can read it, and `NavGrid` re-exports the
 * pitch for everything that asks the lattice for it.
 */

/**
 * Lattice pitch, in metres.
 *
 * Half a metre against a 0.62 m walker radius: fine enough that the gaps
 * between trees and the doorways between stalls survive, coarse enough that the
 * whole park is a few hundred cells square and builds in a few tens of
 * milliseconds. Cells are classified by their **centre**, so the lattice is
 * very slightly optimistic about tight corners — which is the right way to be
 * wrong. An optimistic route clips a corner and the collision resolver slides
 * her round it; a pessimistic one seals a gap she can plainly see and walks her
 * the long way about.
 */
export const NAV_CELL = 0.5;

/** Metres of lattice built beyond a space's soft play boundary, for elbow room. */
export const NAV_LATTICE_MARGIN = 2;

/** Where cell (0, 0)'s centre is, and how many cells a side. */
export interface NavLatticeFrame {
  readonly originX: number;
  readonly originZ: number;
  readonly side: number;
}

/**
 * The lattice over a space whose play boundary has this extent — sized and
 * centred on the extent itself rather than on a radius about a centre, because
 * the park's edge is neither circular nor, for the castle interior, centred on
 * the origin. Cell `(i, j)`'s centre is `(originX + i·NAV_CELL, originZ +
 * j·NAV_CELL)`; a point falls in the cell whose centre rounds to it.
 */
export function navLatticeFrame(extent: {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}): NavLatticeFrame {
  const centreX = (extent.minX + extent.maxX) / 2;
  const centreZ = (extent.minZ + extent.maxZ) / 2;
  const reach = Math.max(extent.maxX - extent.minX, extent.maxZ - extent.minZ) / 2;
  const side = Math.ceil(((reach + NAV_LATTICE_MARGIN) * 2) / NAV_CELL);
  return {
    // Cell (0, 0)'s centre, half a cell in from the corner of the square.
    originX: centreX - (side * NAV_CELL) / 2 + NAV_CELL / 2,
    originZ: centreZ - (side * NAV_CELL) / 2 + NAV_CELL / 2,
    side,
  };
}
