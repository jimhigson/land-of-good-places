/**
 * **The hotel tower's own dimensions** — a leaf module (imports nothing), so
 * the park layout can put the tower's doormat at its real door without
 * importing `Hotel.ts` and everything it builds. `Hotel.ts` re-exports these;
 * they are defined here and nowhere else.
 */

/**
 * The tower's collision shell — an octagon of this circumradius, in metres.
 * Sized to the crystal cluster's own standing-height mass (measured 6.0–8.4 m
 * out from the plot centre), so what looks solid is solid.
 */
export const TOWER_SHELL_RADIUS = 7.2;

/** How far in the lobby back wall stands, along the door's axis. */
export const TOWER_BACK_ALONG = TOWER_SHELL_RADIUS - 2.2;

/**
 * The facade plane: the flat of the octagon face the doorway is cut into,
 * along the door's axis. The doorway sits in the *middle* of a face rather
 * than across a corner, so this is a single distance rather than a range.
 */
export const TOWER_FACADE_ALONG = TOWER_SHELL_RADIUS * Math.cos(Math.PI / 8);
