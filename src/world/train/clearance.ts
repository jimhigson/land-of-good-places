import { TALLEST_CHILD_HEIGHT } from '../../art/models/kid';
import { CAR_FLOOR_Y, LOCO_BODY_TOP_Y, SEAT_Y } from './trainModel';

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
 * and **the train carries passengers, who are much taller than the funnel**:
 *
 * - `ParkTrain.carryPassengers` calls `seatPosition(seat, 0, …)`, deliberately
 *   **standing** NPC riders on the carriage floor: *"Children stand in front of
 *   the bench rather than sitting on it."* Their feet are at {@link CAR_FLOOR_Y}.
 * - `ParkTrain.updateRider` calls `seatPosition(seat, SEAT_Y - CAR_FLOOR_Y, …)`
 *   and `Player.setRidePose` only sets position and rotation — **there is no
 *   seated fold anywhere**. The player rides at full height with her feet on
 *   the bench at {@link SEAT_Y}, which makes her the tallest thing on the train
 *   by a comfortable margin.
 *
 * A deck built to clear 2.42 m would have passed over Puffing Percy and gone
 * straight through the children riding behind her.
 *
 * ## The derivation
 *
 * | | m |
 * |---|---|
 * | `LOCO_BODY_TOP_Y` — funnel tip | 2.42 |
 * | `CAR_FLOOR_Y` + tallest child — standing NPC rider | 3.55 |
 * | `SEAT_Y` + tallest child — the player, and the winner | **3.97** |
 * | + {@link RIDER_HEADROOM} | **4.37** |
 *
 * `TALLEST_CHILD_HEIGHT` rather than `KID_HEIGHT`, because `KID_HEIGHT` (2.12)
 * is only the default style and children ride wearing whatever they chose — see
 * that constant's own note. Hats, not hair, are what dominate it.
 */

/**
 * The highest point of anything that actually travels the line, above the
 * terrain under the centre line.
 *
 * Both rider terms are kept rather than folded to `Math.max(CAR_FLOOR_Y, SEAT_Y)`
 * so the two riding poses stay visible: they are separately reachable states of
 * the game, and if either one changes — a seated fold for the player, a bench
 * NPCs actually sit on — the next reader can see which term moved.
 */
export const TRAIN_SWEPT_TOP_Y = Math.max(
  LOCO_BODY_TOP_Y,
  CAR_FLOOR_Y + TALLEST_CHILD_HEIGHT,
  SEAT_Y + TALLEST_CHILD_HEIGHT,
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
