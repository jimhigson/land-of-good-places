/**
 * The train's **vertical dimensions, and nothing else** — no three.js, no
 * geometry, no imports at all.
 *
 * ## Why these live apart from `trainModel.ts`
 *
 * They used to be declared there, next to the meshes built from them, which is
 * where you would naturally look for them. Moving them out keeps the numbers
 * reachable from anywhere without dragging `trainModel.ts`'s module graph along
 * — it pulls in three.js, the palette, the textures and `./track`, for callers
 * (`check-park.mts`, `test/procgen/`) that want three floats.
 *
 * That is issue #226's shape — a shared *number* sitting in a module with much
 * heavier load behaviour than the number needs — and the established remedy is
 * this one: extract the numbers into their own leaf module and have both sides
 * import it, rather than hand-copying them and letting the two drift.
 *
 * ### What this is *not* defending against — checked, 5 August 2026
 *
 * An earlier version of this comment claimed `trainModel.ts` reaches
 * `world/parkManifest.ts` (via `./track` → `./route` → the layout), and that
 * `parkManifest` reading `LGP_SEED` **at module load** therefore made a static
 * import from `test/procgen/` actively dangerous. **That was wrong, and it is
 * worth saying so rather than leaving a plausible-sounding hazard in place.**
 * `track.ts` imports `TrainRoute` with `import type`, which TypeScript erases,
 * so the chain does not exist at runtime. Two independent checks:
 *
 * - Importing `trainModel.ts`, *then* setting `LGP_SEED`, *then* importing
 *   `parkManifest` gives the late seed — so nothing was fixed early.
 * - Review pointed the invariant suite's import back at `trainModel.ts` on
 *   purpose: 132 passed, nothing skipped.
 *
 * And had it been real, it would not have been silent: `buildParkFacts`
 * asserts `PARK_SEED === seed`, so a fork building the wrong park fails loudly
 * (*"asked for seed 2 but the park built with 20260728"*) rather than quietly
 * measuring the canonical park five times.
 *
 * So this separation is **defence against a plausible import path, not a
 * demonstrated one** — one `import type` becoming a value import restores the
 * whole chain, and nothing would warn. That is a good enough reason to keep a
 * leaf module, and not a good enough reason to have claimed a bug that was not
 * there.
 *
 * `trainModel.ts` re-exports all three, so nothing that already imported them
 * from there had to change.
 */

/** Height of a carriage floor above the sleepers. */
export const CAR_FLOOR_Y = 0.58;

/** Where a passenger's feet go: the top of the bench. */
export const SEAT_Y = CAR_FLOOR_Y + 0.42;

/**
 * The top of the **locomotive's own bodywork** — the funnel tip — above the top
 * of the sleepers. `buildLocomotive` positions the funnel from it, so retuning
 * the loco moves this with it rather than leaving a constant quietly stale.
 *
 * ### This is *not* the clearance anything built over the railway must meet
 *
 * It was called `LOCO_TOP_Y` and documented as "the tallest point of the whole
 * train" and "the number anything built over the railway has to clear". It is
 * neither, **because the train carries passengers and they are taller than the
 * funnel** — `ParkTrain.carryPassengers` stands NPC riders on the carriage
 * floor, and `Player.setRidePose` applies no seated fold, so the player rides
 * bolt upright with her feet on the bench at {@link SEAT_Y}. A deck built to
 * clear 2.42 m would pass over Percy and through the children behind her.
 *
 * The renaming is the fix as much as the arithmetic is: the old name is what
 * invited a caller to treat a locomotive measurement as a whole-train one, and
 * a deck derived from it would have been wrong in the one direction that hurts.
 *
 * **For the clearance, use `TRAIN_CLEARANCE_Y` from `train/clearance.ts`**,
 * which derives it from this *and* from the riders.
 *
 * ### The datum, which is easy to get wrong
 *
 * A car's root is placed at `route.pointAt(...)`, whose Y is `terrainHeight` —
 * the loco's origin is the sleeper top, so **model-local Y is metres above the
 * ground beside the track**. That makes this directly comparable with anything
 * else measured from the terrain, and it is why `RAIL_HEIGHT` is *not* part of
 * it: the rail head is 0.17 m of rail sitting on that same ground, not the datum
 * the body is measured from.
 *
 * Watch for the naming trap next door: `check-park.mts`'s `crossesTrack` returns
 * a field called `rail` that holds the **terrain** height under the centre line,
 * not the rail head. It happens to be the right datum to compare this against —
 * but only by luck of the name being wrong.
 */
export const LOCO_BODY_TOP_Y = CAR_FLOOR_Y + 1.84;
