/**
 * **The park train's tightest turn — one number, in a leaf module.**
 *
 * The whole point of putting it here (imports nothing, reaches nothing seeded)
 * is that both sides can read it without dragging a module graph along: the
 * route generator (`train/route.ts`, which reaches `parkManifest` and so pins
 * the seed the moment it is imported) *and* the procgen invariant that measures
 * the built curve against it (`test/procgen/`, which must not pin the seed
 * early). Same shape as `trainDimensions.ts`.
 *
 * ### Why the train has one at all now
 *
 * Until 11 August 2026 the train's route was a bespoke *radius-per-bearing*
 * profile with **no curvature constraint anywhere** — a sharp radial dip between
 * two control bearings produced a bend as tight as **0.60 m** on the canonical
 * seed, on a train 1.5 m across the buffers whose carriages then overlapped
 * through it. Switching the train to the generic `rail/generate.ts` solver (the
 * one the Sky Cruiser and Rail Race already use) makes the turning radius a
 * *number in the vocabulary* rather than an emergent accident — see
 * `rail/segments.ts`'s own note on why arcs, not free cubics.
 *
 * ### Why 10 m
 *
 * Gentle enough to read as a slow park train weaving between the stalls, and
 * comfortably inside the Sky Cruiser's 12 m (`coaster/route.ts`) so the family's
 * "the cruiser is the tightest of the three" ordering still holds (the Rail Race
 * ring is 57 m). A shade tighter than the cruiser because the train hugs the rim
 * and has to thread past booths the cruiser flies over. It is measured on the
 * built centre line by the procgen invariant, not merely aimed at.
 */
export const TRAIN_MIN_TURN_RADIUS = 10;
