import { Rng } from '../../core/mathUtils';
import { RIDE_SCALE } from './route';

/**
 * **The two things you have to let go for.**
 *
 * The ride has exactly one control — hold to accelerate, release to coast — so
 * every hazard has to be answered with the same gesture, and the interest is
 * entirely in *when* and *for how long*:
 *
 * - A **duck bar** is a moment. Release as you reach it and you drop into the
 *   cart and go under clean, however fast you were going. The rule is the
 *   family's own, verbatim from the playtest that settled it: *"so long as not
 *   holding when passing under the barrier that should be enough to avoid it."*
 *   No speed threshold, no minimum coast beforehand, no grace period while you
 *   are underneath. The whole game is learning when to let go.
 * - A **spark zone** is a stretch. The rail goes black for twenty-odd metres and
 *   you have to be off the button for *all* of it; hold anywhere inside and the
 *   rail throws sparks and drags you down. Holding through one is never a crash
 *   — it is simply slower than coasting through it, which is the kindest way to
 *   teach a rule there is.
 *
 * Together they ask for two different shapes of the same skill: a flick of the
 * thumb, and the patience to keep it off.
 */

/**
 * How high above the rail head a duck bar hangs. Ducking gets you under it.
 *
 * Scaled by `RIDE_SCALE` like the rail gauge and the cart itself — this is a
 * purely visual clearance (bonking is decided by button state at the moment
 * of crossing, not an actual pose/collision test, see the header above).
 *
 * **1.5, not 1.15.** The first pass just multiplied the pre-`RIDE_SCALE`
 * figure through, which undercounted a second thing that also grew:
 * `RIDE_SCALE` does not only move the rider up onto a taller seat
 * (`cart.ts`'s `SEAT_HEIGHT`), it also scales the rider's own model, so her
 * head sits noticeably higher above that seat than it used to. Measured live
 * (1 August 2026) against the deployed rig: at 1.15 the bar sat roughly a
 * metre *below* her head even while ducking, so she visibly passed through
 * it whichever way she was holding the button, not just "occasionally
 * clipped" — the two states never actually straddled the bar. 1.5 was picked
 * by measuring her real head height above the rail in both states
 * (`RailRace.ts`'s `poseRider`, ducking vs not, using the matching
 * `DUCK_DROP` fix there) and setting the bar roughly halfway between them,
 * so each state has real clearance rather than a hair's breadth.
 */
export const DUCK_CLEARANCE = 1.5 * RIDE_SCALE;

/**
 * How far ahead a hazard starts warning, in metres.
 *
 * Further than the camera can comfortably see, so a hazard is already glowing as
 * it slides into frame and is never a surprise. About three seconds at racing
 * pace, against the second or so it takes to react — enough slack for a
 * six-year-old to notice, decide and act.
 */
export const ALERT_RANGE = 34;

/** A bar across a lane, at one arc distance. */
export interface DuckBar {
  /** Metres along the loop, measured from the start/finish arch. */
  readonly at: number;
}

/** A blackened stretch of rail. */
export interface SparkZone {
  /** Metres along the loop from the arch, where the black rail begins. */
  readonly from: number;
  /** ...and where it ends. */
  readonly to: number;
}

export interface HazardLayout {
  readonly bars: readonly DuckBar[];
  readonly zones: readonly SparkZone[];
}

/**
 * The whole race's hazards, as absolute distances *travelled*.
 *
 * Laid out once around one lap and then repeated for each lap, which is worth
 * doing rather than clever wrap arithmetic at hit-test time: a rider's
 * `travelled` only ever increases, so a schedule in travelled-metres can be
 * walked with a single cursor per rider and there is no wrap, no guard band and
 * no "was that the same bar twice?" — the class of bug that made the old race's
 * barriers miss. See `RailRace.checkHazards`.
 */
export interface HazardSchedule {
  /** Where the hazards sit on one lap, for the geometry to be built from. */
  readonly lap: HazardLayout;
  /** Every bar crossing of the whole race, in travelled metres, ascending. */
  readonly barCrossings: readonly number[];
  /** Every spark stretch of the whole race, in travelled metres, ascending. */
  readonly sparkStretches: readonly SparkZone[];
}

/** The first hazard is this far past the arch, so the race opens with speed. */
const OPENING_RUN = 58;

/** ...and the last one ends this far before it, so the finish is a clear dash. */
const CLOSING_RUN = 34;

/** Gap between the end of one hazard and the start of the next. */
const GAP_MIN = 27;
const GAP_MAX = 39;

/** How long a blackened stretch runs for. */
const ZONE_MIN = 15;
const ZONE_MAX = 23;

/**
 * Lays out one lap, then repeats it.
 *
 * Seeded from a fixed constant rather than the park seed: this course is meant
 * to be *learnable*. A child who knows the sparky stretch before the ferris
 * wheel is a child who is enjoying the game, and re-rolling the layout every
 * park would throw that away for nothing.
 */
export function planHazards(loopLength: number, laps: number): HazardSchedule {
  const rng = new Rng(0x9a11ce);
  const bars: DuckBar[] = [];
  const zones: SparkZone[] = [];

  let cursor = OPENING_RUN;
  const limit = loopLength - CLOSING_RUN;
  // Alternated rather than picked at random: two spark zones in a row is a long
  // time holding nothing, and five bars in a row never teaches the other rule.
  // Two bars to a zone keeps both fresh and lands about eight hazards a lap.
  let sinceZone = 0;
  while (cursor < limit) {
    if (sinceZone >= 2 && cursor + ZONE_MAX < limit) {
      const to = cursor + rng.range(ZONE_MIN, ZONE_MAX);
      zones.push({ from: cursor, to });
      cursor = to;
      sinceZone = 0;
    } else {
      bars.push({ at: cursor });
      sinceZone += 1;
    }
    cursor += rng.range(GAP_MIN, GAP_MAX);
  }

  const barCrossings: number[] = [];
  const sparkStretches: SparkZone[] = [];
  for (let lap = 0; lap < laps; lap += 1) {
    const base = lap * loopLength;
    for (const bar of bars) barCrossings.push(base + bar.at);
    for (const zone of zones) {
      sparkStretches.push({ from: base + zone.from, to: base + zone.to });
    }
  }
  barCrossings.sort((a, b) => a - b);
  sparkStretches.sort((a, b) => a.from - b.from);

  return { lap: { bars, zones }, barCrossings, sparkStretches };
}
