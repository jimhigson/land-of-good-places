import { Rng } from '../../core/mathUtils';

/**
 * **The one thing you have to let go for.**
 *
 * The ride has exactly one control — hold to accelerate, release to coast — so
 * the hazard has to be answered with the same gesture, and the interest is
 * entirely in *when* and *for how long*.
 *
 * A **spark zone** is a stretch. The rail goes black for twenty-odd metres and
 * you have to be off the button for *all* of it; hold anywhere inside and the
 * rail throws sparks and drags you down. Holding through one is never a crash
 * — it is simply slower than coasting through it, which is the kindest way to
 * teach a rule there is.
 *
 * **1 August 2026 — the duck bar retired.** The ride used to carry a second
 * hazard, a bar you ducked under by releasing the instant before it, snapped
 * onto a real trestle support so it always had something visible holding it
 * up. Jim's own verdict after a full day building that support-snapping
 * mechanism, the Blender asset and its hazard tape: "remove the head bump
 * from the game's dynamics and replace entirely with more frequent black
 * sections on the track." Deliberate simplification, not a bug fix — one
 * mechanic teaches the one lesson ("when do I let go") on its own, so the
 * spark zone below is now the *whole* game, laid out denser to carry the
 * pacing the two hazards used to share. See `planHazards`'s own doc comment
 * for the retuned numbers and why.
 *
 * The trestle-leg support structure the bar's snapping was built against is
 * unrelated infrastructure — every lane still needs holding up — and stays
 * exactly as it was; only the bar that once needed to coincide with a leg is
 * gone. See `track.ts`'s `trestleSpots`.
 */

/**
 * How far ahead a hazard starts warning, in metres.
 *
 * Further than the camera can comfortably see, so a hazard is already glowing as
 * it slides into frame and is never a surprise. About three seconds at racing
 * pace, against the second or so it takes to react — enough slack for a
 * six-year-old to notice, decide and act.
 *
 * Currently unused: the duck bar's warning lamps were the one thing this
 * distance fed, and a black stretch is its own warning from as far away as it
 * is visible at all, with nothing else needing a countdown to it. Kept rather
 * than deleted — it is a real, still-true fact about the ride ("about three
 * seconds of notice, on foot"), and a future zone-only warning treatment (a
 * glow at the leading edge, say) would want exactly this number rather than
 * reinventing it.
 */
export const ALERT_RANGE = 34;

/** A blackened stretch of rail. */
export interface SparkZone {
  /** Metres along the loop from the arch, where the black rail begins. */
  readonly from: number;
  /** ...and where it ends. */
  readonly to: number;
}

export interface HazardLayout {
  readonly zones: readonly SparkZone[];
}

/**
 * The whole race's hazards, as absolute distances *travelled*.
 *
 * Laid out once around one lap and then repeated for each lap, which is worth
 * doing rather than clever wrap arithmetic at hit-test time: a rider's
 * `travelled` only ever increases, so a schedule in travelled-metres can be
 * walked with a single cursor per rider and there is no wrap, no guard band and
 * no "was that the same zone twice?" — the class of bug that made the old race's
 * barriers miss. See `RailRace.checkHazards`.
 */
export interface HazardSchedule {
  /** Where the hazards sit on one lap, for the geometry to be built from. */
  readonly lap: HazardLayout;
  /** Every spark stretch of the whole race, in travelled metres, ascending. */
  readonly sparkStretches: readonly SparkZone[];
}

/** The first hazard is this far past the arch, so the race opens with speed. */
const OPENING_RUN = 58;

/** ...and the last one ends this far before it, so the finish is a clear dash. */
const CLOSING_RUN = 34;

/**
 * Gap between the end of one zone and the start of the next.
 *
 * **Retuned 1 August 2026, down from 27–39.** The old schedule alternated
 * two bars to a zone, so this gap separated a bar or a zone from whatever
 * followed it, indifferently — bars are gone now, and every hazard is a
 * zone, so simply deleting the bar branch and leaving the gap alone was
 * tried first (see `planHazards`'s own doc comment for what that measured:
 * 5.4 s of "letting go is worth it", against the old two-hazard race's
 * measured 18.1 s). Tightening the gap, and lengthening the zone below,
 * together fit more and longer black stretches into the same 244 m usable
 * span — the family's own ask, "more frequent black sections" — and get the
 * checker's own measured gap back up near the old figure. See
 * `scripts/check-rail-race.mts`'s header for the final, measured numbers.
 */
const GAP_MIN = 22;
const GAP_MAX = 32;

/**
 * How long a blackened stretch runs for.
 *
 * **Retuned 1 August 2026, up from 15–23** — alongside `GAP_MIN`/`GAP_MAX`,
 * see that constant's own doc comment for why both moved together rather
 * than the gap alone.
 */
const ZONE_MIN = 18;
const ZONE_MAX = 30;

/**
 * Lays out one lap, then repeats it.
 *
 * **Retuned 1 August 2026 for the duck bar's removal.** The old schedule
 * alternated two bars to a zone and landed about seven hazards a lap (five
 * bars, two zones, `~37 m` of black track). With the bar branch simply
 * removed and `GAP_MIN`/`GAP_MAX`/`ZONE_MIN`/`ZONE_MAX` left at their old
 * values, the same gap-then-hazard loop lands five zones a lap but only
 * `~37 m` of black track still — the same total the two zones alone used to
 * carry, because a bar's own "when do I let go" moment carried none of it.
 * Measured with `scripts/check-rail-race.mts`: playing well beat holding by
 * only 5.4 s over the whole two-lap race, against the two-hazard race's
 * 18.1 s — a real, measured regression in "how much does letting go
 * matter", not a hunch.
 *
 * `GAP_MIN`/`GAP_MAX`/`ZONE_MIN`/`ZONE_MAX` were retuned from there, not left
 * alone: five zones a lap, now averaging `~25 m` each (`~123 m` of black
 * track a lap on the canonical route — over three times the old figure,
 * matching the family's own "more frequent black sections" ask) brings the
 * checker's measured gap to 15.6 s, back in the old race's ballpark. See
 * that script's header for the exact figures and the mutation that proves
 * the guard still catches a broken one.
 *
 * Seeded from a fixed constant rather than the park seed: this course is meant
 * to be *learnable*. A child who knows the sparky stretch before the ferris
 * wheel is a child who is enjoying the game, and re-rolling the layout every
 * park would throw that away for nothing.
 */
export function planHazards(loopLength: number, laps: number): HazardSchedule {
  const rng = new Rng(0x9a11ce);
  const zones: SparkZone[] = [];

  let cursor = OPENING_RUN;
  const limit = loopLength - CLOSING_RUN;
  while (cursor + ZONE_MAX < limit) {
    const to = cursor + rng.range(ZONE_MIN, ZONE_MAX);
    zones.push({ from: cursor, to });
    cursor = to + rng.range(GAP_MIN, GAP_MAX);
  }

  const sparkStretches: SparkZone[] = [];
  for (let lap = 0; lap < laps; lap += 1) {
    const base = lap * loopLength;
    for (const zone of zones) {
      sparkStretches.push({ from: base + zone.from, to: base + zone.to });
    }
  }
  sparkStretches.sort((a, b) => a.from - b.from);

  return { lap: { zones }, sparkStretches };
}
