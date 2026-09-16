/**
 * **The one feature the Rail Race claims ground under.**
 *
 * There is one rail race, drawn at two scales: the walk-past ring a child
 * strolls past and the race ring she rides. Jim, 7 Sep 2026: *"either the
 * small one or the big one is shown — it is purely a visual trick, they never
 * occupy the world at the same time."* `RailRace.setActiveRing` shows exactly
 * one, and the race ring registers no collider at all. So the two rings are
 * one feature to the registry: neither can refuse the other (a feature is its
 * own business — `GroundClaims.refusalsOf` skips the asker's own claims), and
 * everything else — the road, a later placer — sees the union of both rings'
 * supports as one claim set.
 *
 * A leaf module so scripts and tests can read the name without importing the
 * track (which pins the seed).
 */
export const RAIL_RACE_FEATURE = 'railRace';
