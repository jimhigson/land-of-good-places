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
 * Thickness of the crown-span soffit slab a bridge actually builds — the
 * mesh named `deck` in `world/train/bridges.ts`, the flat ceiling a train
 * passes under and the one `test/procgen/invariants.ts` measures the built
 * clearance off.
 *
 * A plate, not a beam: nothing structural hangs off it, it is the visible
 * underside of the crown and the rest of the masonry above it is the
 * spandrel shell the road bed sits in. Kept the same as
 * {@link BRIDGE_SHELL_MIN} so the two thinnest pieces of the arch read as
 * one course of stone rather than two different ones.
 */
export const BRIDGE_DECK_SLAB = 0.05;

/**
 * The thinnest masonry a bridge ever leaves between the top of its
 * {@link BRIDGE_DECK_SLAB} and the bed its roadway is laid in — the pinch
 * point, at the far edge of the flat crown span where the hump's own
 * surface has already started to fall away.
 */
export const BRIDGE_SHELL_MIN = 0.05;

/**
 * How far below the height a bridge reports as *walkable* its masonry road
 * bed sits — the gap the park's own path ribbon is laid into, so that
 * walking over a bridge stands you on the same sandy paving as everywhere
 * else rather than on bare stone (Jim, 2026-08-24). Exactly the relationship
 * the terrain has with the paving it carries on the flat.
 */
export const BRIDGE_ROAD_BED_DROP = 0.06;

/**
 * The depth of a bridge's own structure between the surface a child walks
 * on and the soffit a train passes beneath.
 *
 * **This used to be the one number in this file that was a claim rather
 * than a derivation** — 0.35 m, with its own note admitting nothing in the
 * built park measured a deck's thickness back. It is now the sum of the
 * three pieces `world/train/bridges.ts` genuinely builds, so the claim is
 * gone and a retune of any of them moves the clearance with it:
 *
 * | | m |
 * |---|---|
 * | {@link BRIDGE_DECK_SLAB} — the built crown ceiling | 0.05 |
 * | {@link BRIDGE_SHELL_MIN} — masonry over it at the pinch | 0.05 |
 * | {@link BRIDGE_ROAD_BED_DROP} — bed to walkable surface | 0.06 |
 *
 * Note what this is *not*: the height a real bridge's crown ends up at.
 * The road is a hump, so it has already begun to fall away by the edge of
 * the flat crown span, and `bridges.ts` raises the crown until the *lowest*
 * road surface over that span still clears the slab — see its own note.
 * That is a per-bridge solve against the real ramp lengths, and it is what
 * the old 0.35 was silently standing in for park-wide.
 */
export const BRIDGE_DECK_DEPTH = BRIDGE_DECK_SLAB + BRIDGE_SHELL_MIN + BRIDGE_ROAD_BED_DROP;

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
 * Half-length of a bridge deck along the crossing direction — has to clear
 * both fence lines (each {@link FENCE_OFFSET} out from the rail centre) with
 * a little margin so the deck's own edge does not sit flush on a fence post.
 *
 * **This is the part of a bridge that cannot shrink.** The tunnel has to
 * swallow the whole fenced corridor, so any future shortening of a bridge
 * takes every metre out of the ramps.
 *
 * It lives here, in the leaf, rather than in `bridgeFootprint.ts` which owns
 * every other footprint number, **because of an import cycle it was the only
 * cause of**: `crossingKeepOut.ts` needs this one constant, and taking it from
 * `bridgeFootprint.ts` dragged in that module's `distanceToRailCorridor`
 * import of `plan.ts`, closing the loop `plan -> route -> crossingKeepOut ->
 * bridgeFootprint -> plan`. `check:park-boot` died on it with
 * `ReferenceError: Cannot access 'TrainRoute' before initialization`,
 * depending on which module the entry point happened to reach first — which is
 * why the browser and most checks were unaffected and one check was not. Same
 * disease, and the same fix, as {@link FENCE_OFFSET}'s own note directly
 * above. `bridgeFootprint.ts` re-exports it, so every existing reader is
 * unchanged and there is still exactly one definition.
 */
export const DECK_HALF_LENGTH = FENCE_OFFSET + 1.2;

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

/**
 * How long a station platform is along the track, metres.
 *
 * Here rather than in `station.ts` for the same reason as everything else in
 * this file: `plan.ts` has to know it — it is half of how far apart two
 * stations must stand (#472) — and `station.ts` builds meshes, so a plan that
 * imported it would drag the whole scene layer into the pure planning pass.
 * `station.ts` reads it from here, so there is still one definition.
 */
export const PLATFORM_LENGTH = 7.2;

/**
 * Half-width of the corridor a bridge site's deck and ramps are probed at.
 * The real pass starts its width search at the crossing's own `halfGap`
 * (floored at 4.5 in `crossings.ts`, and a square planned crossing measures
 * at that floor), so this is the corridor the first — preferred — real
 * candidate will actually occupy, plus half a stride of slack.
 */
export const SITE_HALF_WIDTH = 4.5 + 0.5;
/**
 * The narrower corridor tried when {@link SITE_HALF_WIDTH} finds nothing —
 * a deck for a path that arrives square needs barely more than the ribbon
 * itself, and a whole district with no bridge at all is a far worse
 * outcome than a slimmer one (seed 2's east: plots, a station and the
 * boundary between them ruled out every full-width candidate).
 */
export const NARROW_HALF_WIDTH = 4.0;

/**
 * **How far along the loop a station must stay from a planned crossing.**
 *
 * A crossing needs the station's own platform window ({@link STATION_GAP}
 * either way) plus its own corridor half-width, plus a post's worth of
 * daylight so the fence gap and the platform window never merge.
 *
 * **Two modules must agree on this number, which is why it lives here.**
 * `crossingPlanSolve.ts` refuses to plan a crossing this close to a station;
 * `plan.ts` refuses to *place* a station this close to the loop's own chosen
 * crossing. If they ever disagreed, the generator would grow a loop from a
 * bridgeable crossing and then put a station on top of it — which is exactly
 * what happened on seed 2 before the second half existed (issue #427: a
 * station landed at d = -2.0 m, on the crossing, and the park came out with no
 * bridge at all).
 */
export const CROSSING_STATION_CLEARANCE = STATION_GAP + SITE_HALF_WIDTH + 2.0;

/**
 * **How far a station's own structures must stand from a planned crossing, in
 * SPACE** — as distinct from {@link CROSSING_STATION_CLEARANCE}, which is
 * measured *along the loop*.
 *
 * The loop winds, so the two are not the same rule seen twice. A station 104 m
 * away around the circuit can stand a few metres from a crossing in plain
 * space, and its canopy posts then block the bridge deck. Measured on #427:
 * seeds 2 and 15 both chose a bridgeable crossing, solved a loop through it,
 * and the planner then reported `DECK BLOCKED` at all ten width/angle pairs —
 * with the along-the-loop clearance satisfied.
 *
 * Read from both directions, like its along-the-loop twin: the planner refuses
 * to *plan* a crossing this close to station structures, and `plan.ts` refuses
 * to *place* a station this close to the loop's chosen crossing.
 */
export const CROSSING_STATION_STRUCTURE_CLEARANCE = 8;
