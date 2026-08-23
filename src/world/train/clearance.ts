import { TALLEST_CHILD_SEATED_HEIGHT } from '../../art/models/kid';
// `./trainDimensions`, deliberately not `./trainModel` — issue #226's shape:
// three floats should not drag three.js, the textures and `./track` in behind
// them for `check-park.mts` and `test/procgen/`. See that module's own note,
// including what this is *not* defending against.
import { CAR_FLOOR_Y, LOCO_BODY_TOP_Y } from './trainDimensions';

/**
 * **How much air anything built over the railway has to leave.**
 *
 * The single owner of that number. Nothing else may re-derive it, and nothing
 * else may hand-copy the pieces it is built from — every one of them is
 * imported above, so retuning the loco, moving the bench or adding a taller hat
 * moves the clearance instead of leaving a second copy quietly wrong.
 *
 * ## Why this module exists at all
 *
 * `trainModel.ts` exported `LOCO_TOP_Y`, documented as *"the tallest point of
 * the whole train"* and *"the number anything built over the railway has to
 * clear"*. It was neither. It is the funnel tip — the locomotive's bodywork —
 * and **the train carries passengers, who are much taller than the funnel**.
 *
 * ## Everyone aboard sits (2026-08-23, Jim, resolving Decision 8's open question)
 *
 * This module's own earlier finding was that neither rider actually sat:
 * `ParkTrain.carryPassengers` stood NPCs on the carriage floor on purpose —
 * *"a standing child holding on reads better than a walking one sitting
 * down"* — and the player's own feet landed on the **bench top**
 * (`trainDimensions.ts`'s `SEAT_Y`), taller than a standing NPC by the
 * height of the bench.
 * That made "should everyone on the train sit" a real family decision, not
 * an engineering free choice — ARCHITECTURE-DECISIONS.md Decision 8 records
 * it as open, because a pose change invalidates every bridge deck already
 * placed. Jim's answer: yes, both riders sit. `ParkTrain.updateRider` now
 * seats the player with her feet on the floor like an NPC rider (not the
 * bench), and `NpcCharacter.animate` folds the same `applyRidePose('seated')`
 * pose onto whoever `ParkTrain.carryPassengers` is carrying that frame — one
 * function, shared with every other seated ride in the park, rather than a
 * second hand-copied "holding on" pose that could quietly stop matching it.
 *
 * ## The derivation
 *
 * Both riders now share one reference — the carriage floor — so there is one
 * rider term, not two:
 *
 * | | m |
 * |---|---|
 * | `LOCO_BODY_TOP_Y` — funnel tip | 2.42 |
 * | `CAR_FLOOR_Y` + seated tallest child — both riders now | **3.47** |
 * | + {@link RIDER_HEADROOM} | **3.87** |
 *
 * `TALLEST_CHILD_SEATED_HEIGHT` rather than `TALLEST_CHILD_HEIGHT`, because
 * that constant's own note explains why sitting on this rig — no knee, a leg
 * that swings from a fixed hip and buys nothing bent — saves a real but small
 * 0.054 m from the forward body lean alone, not the half-of-standing a real
 * child's bent knees would. The rest of this derivation's saving over the
 * pre-2026-08-23 number is the player's feet moving off the bench and onto
 * the floor, which is a **position** fix, not a pose one, and is exactly why
 * both are recorded here rather than only the constant that moved.
 */

/**
 * The highest point of anything that actually travels the line, above the
 * terrain under the centre line.
 *
 * One rider term, not two, since 2026-08-23: both the player and NPC
 * riders now sit with their feet on the same reference — the carriage
 * floor (`ParkTrain.updateRider`, `ParkTrain.carryPassengers`) — posed
 * through the same `applyRidePose('seated')` (`Player.animate`,
 * `NpcCharacter.animate`). Before that they were two separately reachable
 * states worth keeping visible as two terms; now collapsing them to one
 * is the honest shape of what the game does, not a shortcut past it.
 */
export const TRAIN_SWEPT_TOP_Y = Math.max(
  LOCO_BODY_TOP_Y,
  CAR_FLOOR_Y + TALLEST_CHILD_SEATED_HEIGHT,
);

/**
 * Air above the swept volume, so a bridge reads as safe rather than as a graze.
 *
 * **Measured, not picked.** {@link TRAIN_SWEPT_TOP_Y} is a measurement of
 * *settled* geometry, and the tallest thing on the train has a transient that
 * beats it: `WornHat.update` pops a newly-worn hat in with
 * `1 + Math.sin(pop * Math.PI) * 0.35`, so for a fraction of a second the hat
 * is drawn at **1.35×** its own size. Measured on the real models, that peak
 * costs **0.346 m** on the tallest hat — a child who swaps hats while riding
 * genuinely reaches that high.
 *
 * So this is that overshoot, rounded up to leave daylight rather than sitting
 * exactly on it. It is the closest thing here to a claim, which is why it is
 * named and separate: the number it must cover is measurable, and the invariant
 * that guards `TALLEST_CHILD_HEIGHT` re-measures the geometry it comes from.
 */
export const RIDER_HEADROOM = 0.4;

/**
 * **The number anything built over the railway has to clear**, above the
 * terrain under the centre line.
 *
 * The datum is the terrain, not the rail head, and that is deliberate — see
 * `LOCO_BODY_TOP_Y`'s note. A car's root is placed at `route.pointAt(...)`,
 * whose Y is `terrainHeight`, so every term above is already measured from the
 * same ground. `RAIL_HEIGHT` is rightly absent: it is rail sitting *on* the
 * datum, not part of it.
 */
export const TRAIN_CLEARANCE_Y = TRAIN_SWEPT_TOP_Y + RIDER_HEADROOM;

/**
 * The depth of a bridge's own structure — deck planks plus the beams under
 * them — between the surface a child walks on and the soffit a train passes
 * beneath.
 *
 * The one number here that is a *claim* rather than a derivation, because
 * nothing in the built park measures a deck's own thickness back. Stated
 * separately, and named, so it is obvious what to reconcile if the real deck
 * geometry (`world/train/bridges.ts`) ever settles on something else.
 */
export const BRIDGE_DECK_DEPTH = 0.35;

/**
 * How far a walkable surface must stand above the ground under the track
 * before a route passing over it counts as a **bridge** rather than a level
 * crossing (issue #116, Decision 8) — {@link TRAIN_CLEARANCE_Y} plus the
 * deck's own thickness.
 *
 * The single owner: `world/train/bridges.ts` builds every deck to stand
 * exactly this high above the ground under the crossing, and
 * `scripts/check-park.mts`'s invariant 2 re-derives the same number to judge
 * it, so a retune of the train, the rider, or the deck's own thickness moves
 * both sides together.
 */
export const BRIDGE_RISE = TRAIN_CLEARANCE_Y + BRIDGE_DECK_DEPTH;

/**
 * How far the exclusion fence stands from the rail centre line, each side.
 *
 * Lives here, a leaf module with no three.js and no `TrainRoute`, rather
 * than in `fence.ts` itself — `bridges.ts` needs the same number (a deck has
 * to clear both fence lines) and `fence.ts` needs `bridges.ts`'s own
 * {@link FENCE_SEAM_MARGIN} to build the seam under a deck, so the two
 * importing each other directly would be a cycle. One leaf both sides read
 * from is the same fix `trainDimensions.ts`'s own header describes for the
 * same disease.
 */
export const FENCE_OFFSET = 2.0;

/**
 * How far below a bridge deck's own surface the fence's `topIsAbsolute` top
 * sits, where a run of fence posts falls directly under a deck — a decisive
 * margin, never a graze, and nowhere near a ground jump reaches (see
 * `bridges.ts`'s header for the full mechanism).
 */
export const FENCE_SEAM_MARGIN = 0.18;

/**
 * Half-length of a station's open fence gap along the loop — the stretch
 * `fence.ts` leaves unfenced on the platform side and seals on the far
 * side (`stationRun`). Lives here, in the leaf module, so seed-sensitive
 * test files can read it without a static import that reaches
 * `parkManifest` (fence.ts pulls `route.ts`, which does) — the same
 * reasoning as every other constant in this file.
 */
export const STATION_GAP = 6.5;
