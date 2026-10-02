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

/**
 * The outer edge of the front door's walk-through trigger, along the door's
 * axis — 0.4 m out past the facade, so the trigger's outer face is on the
 * lawn a child walks up on. `Hotel.towerDoorBand` builds the band from it,
 * and the park layout stands the hotel's doormat on it: walking off the end of
 * the path is walking in.
 */
export const TOWER_DOOR_BAND_OUTER = TOWER_FACADE_ALONG + 0.4;

/**
 * **Where the tower's front door is drawn**, along the door's axis from the
 * plot centre: the face of the doorway's recess panel (`tower-door-glow`'s
 * outward extent in the glb, measured 1.768 m), which the sliding leaves stand
 * in front of (`Hotel.fitAutoDoors`). The drawn tower is far slimmer than its
 * collision shell, so the door stands ~4.9 m inside the facade plane, at the
 * back of a recess between the crystals; the paving runs on into it so the
 * path visibly arrives at the doors.
 *
 * A number about an authored asset, so it is held to the asset by
 * `test/procgen`'s `drawnPavingReachesEveryDoor`, which measures the drawn
 * door off the built tower and fails if the paving does not reach it.
 */
export const TOWER_DRAWN_DOOR_ALONG = 1.77;
