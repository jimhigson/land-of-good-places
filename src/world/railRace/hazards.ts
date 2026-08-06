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
 *
 * ## Three separately-chosen levels, not an escalation within one race (2 August 2026)
 *
 * Jim's brief for the tap-rate rework: three distinct levels, picked once
 * after boarding, before the countdown (see `RailRace.ts`'s `chooseLevel`).
 * Level 1 is hazard-free, level 2 adds the black spark stretches, level 3
 * adds the duck bars on top — a fixed composition for the *whole* race,
 * every lap identical, not something that changes lap to lap within one go.
 * (An earlier pass read this brief as "escalate by lap" instead — Jim
 * corrected that mid-build; see the git history on this file and on
 * `RailRace.ts`/`simulate.ts` if the shape of the old reading is useful.)
 *
 * `planHazards` still lays out exactly one physical set of bar and zone
 * positions around the ring, **independent of `level`** — the RNG that
 * decides where a bar or a black stretch actually sits never looks at
 * `level` at all; only whether the *schedule* built from those positions
 * (`barCrossings`/`sparkStretches`, the absolute travelled-distance lists
 * `stepRider` actually walks) includes them depends on
 * {@link ZONES_FROM_LEVEL} and {@link BARS_FROM_LEVEL}. This is what lets
 * `simulate.ts`'s `HAZARD_LAYOUT` (built once, for the ring's geometry) and a
 * freshly-chosen race's own schedule agree on where everything physically
 * is, whichever level she picked — `track.ts`'s `setHazardLevel` only
 * toggles which of that already-built geometry is visible.
 */

/**
 * How high above the rail head a duck bar hangs. Ducking gets you under it.
 *
 * Scaled by `RIDE_SCALE` like the rail gauge and the cart itself — this is a
 * purely visual clearance (bonking is decided by button state at the moment
 * of crossing, not an actual pose/collision test, see the header above).
 *
 * **2.82, and the two numbers before it were both measured wrong.**
 *
 * 1.5, then 2.1 (1 August 2026), both documented as "roughly halfway between
 * her ducking and standing head heights" and both derived from a live reading
 * of `hatAnchor`'s world position that recorded her crown at **4.70 m** over
 * the rail ducked and 5.95 m standing.
 *
 * Those figures are wrong by 1.40 m. Re-measured 5 August 2026 by composing the
 * real transform chain — a real `createKid` parented into a real cart group at
 * the ring's own scale, `updateMatrixWorld`, then read back — her crown is at
 * **6.10 m** ducked and **7.35 m** standing, and the top of her head, hair and
 * all, reaches **6.42 m** ducked and **7.67 m** standing. (Whatever the 1
 * August reading actually caught, it was not a rider on this ring at this
 * scale.) Against a bar hanging at 2.1 × 2.5 = 5.25 m, that means the bar sat
 * *inside her head in both states*: Jim, riding it, *"their head just passes
 * through the bonkers like a ghost which looks very bad"*.
 *
 * The rule is the one both earlier passes intended — halfway between the two
 * real states — finally applied to real numbers, and measured against her head
 * **top** rather than the bare crown, because hair is what a family sees pass
 * through a bar. Halfway between 6.42 and 7.67 is 7.04 m, which is
 * `2.82 × RIDE_SCALE`. A ducked rider now clears the bar's underside by about a
 * quarter of a metre and a standing one meets it across the top of her head,
 * which is what a duck bar is for.
 *
 * **This is no longer a comment anybody has to trust.**
 * `scripts/check-rail-race.mts` builds the real kid, poses her in both states
 * the way `RailRace.ts` does, and asserts the separation — so the next time
 * anything about her height, the seat, the ring's scale or this number moves,
 * the build says so instead of a family finding out on the ride.
 *
 * `track.ts` derives the duck bar posts' own length from this, so raising it
 * does not leave the bars floating above their supports — see `postStretch`.
 */
/**
 * **How tall a rider on this ride is: the top of a standing head above the rail
 * head, at park scale.** Multiply by a ring's own `scale` for that ring.
 *
 * The single owner of "how much room does a rider need", and the reason this
 * exists as a named constant at all: on 5 August 2026 the duck bars were found
 * hanging *inside* riders' heads in both states, because the figure they had
 * twice been set from — a live reading of 4.70 m ducked / 5.95 m standing — was
 * 1.40 m wrong. Re-measured by composing the real transform chain (a real
 * `createKid` parented into a real cart group at the ring's own scale,
 * `updateMatrixWorld`, then read back): the crown reaches 7.35 m over the rail
 * and the top of her head, hair and all, **7.67 m** — which at `RIDE_SCALE` is
 * the 3.068 below. Hair, not crown, because hair is what a family watches pass
 * through things.
 *
 * Everything that has to clear a rider derives from this and nothing invents a
 * height of its own:
 *
 * - {@link DUCK_CLEARANCE_AT_PARK_SCALE} hangs a duck bar halfway between this
 *   and the same head once ducked (`RailRace.ts`'s `DUCK_DROP`, 0.5 at park
 *   scale), i.e. halfway between 3.068 and 2.568 — the 2.82 below.
 * - `track.ts`'s finish rainbow arcs clear *over* it. That one was the point of
 *   Jim's 6 August report: the old straight finish beam sat 2.2 m above the
 *   rail against this 3.068, so it passed through every rider on the ride, and
 *   a finish line you are hit by is not a finish line.
 *
 * `scripts/check-rail-race.mts` measures the real model against this rather
 * than trusting it, which is what stops it going 1.40 m stale a second time.
 */
export const RIDER_HEAD_TOP_AT_PARK_SCALE = 3.068;

/**
 * ...and the top of the same head once she has **folded** — see
 * `railRace/duckPose.ts`. Measured the same way, off the real posed model.
 *
 * Was a translation of the whole child (`DUCK_DROP`, 0.5), which Jim rejected
 * twice: *"that's not what ducking means."* The crouch that replaced it is
 * **deeper** than the translation it removed — **1.49 m** at ride scale against
 * 1.25 — because sinking the hips and folding the waist buys more than sliding
 * the whole child down ever did. So the bars did not *have* to be re-tuned to
 * keep working; they were re-derived anyway, because the number they derive
 * *from* moved, and a constant that survives by luck is exactly what this file
 * has already been burned by once.
 */
export const RIDER_DUCKED_HEAD_TOP_AT_PARK_SCALE = 2.472;

/**
 * Half the duck-bar asset's own depth, at park scale — `duckbar.blend` measures
 * 0.75 m tall about its centre, and a ring hangs it by that centre.
 */
const DUCK_BAR_HALF_DEPTH_AT_PARK_SCALE = 0.15;

/**
 * Where a duck bar's **underside** wants to be: halfway between a standing head
 * and a ducked one, so ducking clears it by as much as standing meets it.
 */
const DUCK_BAR_UNDERSIDE_AT_PARK_SCALE =
  (RIDER_HEAD_TOP_AT_PARK_SCALE + RIDER_DUCKED_HEAD_TOP_AT_PARK_SCALE) / 2;

export const DUCK_CLEARANCE_AT_PARK_SCALE =
  DUCK_BAR_UNDERSIDE_AT_PARK_SCALE + DUCK_BAR_HALF_DEPTH_AT_PARK_SCALE;

/**
 * The clearance on the ring a child actually races on. A ring builds its own
 * bars at `DUCK_CLEARANCE_AT_PARK_SCALE * route.scale` (`track.ts`), so the
 * walk-past ring's bars are proportioned to the park-scale kids under them
 * rather than hanging at race height over half-size carts.
 */
export const DUCK_CLEARANCE = DUCK_CLEARANCE_AT_PARK_SCALE * RIDE_SCALE;

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

/**
 * Trestles this far apart around the ring.
 *
 * Lives here, not in `track.ts` (which builds the trestles themselves),
 * because `planHazards` needs it too — see {@link snapToTrestleGrid} — and
 * `track.ts` already imports from this file, so the constant living here
 * avoids a circular import rather than creating one.
 */
export const TRESTLE_SPACING = 12;

/** The three levels `RailRace.chooseLevel` offers. See this file's own header. */
export type RaceLevel = 1 | 2 | 3;

/**
 * First level the black stretches spark on. See this file's own header —
 * level 1 is deliberately hazard-free.
 */
export const ZONES_FROM_LEVEL: RaceLevel = 2;

/** First level the duck bars are live on. */
export const BARS_FROM_LEVEL: RaceLevel = 3;

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
 * How many trestle grid slots fit round one lap — `track.ts`'s own
 * `Math.floor(route.length / TRESTLE_SPACING)`, duplicated as one line
 * rather than imported, because importing it would mean this file reaching
 * into `track.ts` while `track.ts` already reaches into this one (see
 * `TRESTLE_SPACING`'s own doc comment on why that direction was chosen).
 */
function trestleGridCount(loopLength: number): number {
  return Math.max(1, Math.floor(loopLength / TRESTLE_SPACING));
}

/**
 * Which trestle grid slot a given arch-relative `at` belongs to — the same
 * formula in both directions (`at -> index` here, `index -> at` in
 * `snapToTrestleGrid`), so `track.ts` can recover exactly the slot a bar was
 * snapped onto without either file re-deriving the other's arithmetic.
 */
export function trestleGridIndex(at: number, loopLength: number): number {
  const count = trestleGridCount(loopLength);
  const raw = Math.round((at / loopLength) * count);
  return ((raw % count) + count) % count;
}

/**
 * Snaps a raw cursor position onto `track.ts`'s own trestle grid, and returns
 * exactly the `at` a trestle candidate at that grid index would compute
 * (`(index / count) * loopLength`) — the same formula, not an approximation
 * of it, so a bar and the support meant to carry it agree on position to the
 * metre before any collision-driven search ever nudges the support a little.
 *
 * **Why a duck bar needs this at all.** Jim, 1 August 2026: the hazard
 * schedule and the trestle placement were "completely independent systems
 * with no relationship" — a bar could, and did, land anywhere a seeded RNG's
 * cursor happened to stop, with nothing structural underneath it. Snapping
 * the bar itself onto the same grid `trestleSpots` places supports on means
 * every bar's `at` *is* a trestle grid index — the shared source Jim's own
 * two suggested fixes both point at, rather than two positions that have to
 * be reconciled after the fact.
 *
 * `usedIndices` guards against two different bars landing on the same
 * support — vanishingly unlikely given `GAP_MIN` (27 m) is more than twice
 * `TRESTLE_SPACING` (12 m), but a schedule silently losing a bar to a
 * collision would be a worse bug than the few metres' nudge this costs when
 * it actually happens.
 */
function snapToTrestleGrid(cursor: number, loopLength: number, usedIndices: Set<number>): number {
  const count = trestleGridCount(loopLength);
  const raw = trestleGridIndex(cursor, loopLength);
  for (let delta = 0; delta < count; delta += 1) {
    const candidates = delta === 0 ? [raw] : [raw - delta, raw + delta];
    for (const candidate of candidates) {
      const index = ((candidate % count) + count) % count;
      if (!usedIndices.has(index)) {
        usedIndices.add(index);
        return (index / count) * loopLength;
      }
    }
  }
  // Every grid index already used — not reachable with this file's own
  // GAP_MIN/TRESTLE_SPACING ratio, but fall back to the raw index rather than
  // throwing, so a future tuning change that *does* reach this fails as a
  // slightly crowded schedule, not a crash.
  const fallback = ((raw % count) + count) % count;
  usedIndices.add(fallback);
  return (fallback / count) * loopLength;
}

/**
 * Lays out one lap, then repeats it — the physical positions, always; whether
 * a given level's schedule actually includes them is decided afterwards, see
 * this file's own header.
 *
 * Seeded from a fixed constant rather than the park seed: this course is meant
 * to be *learnable*. A child who knows the sparky stretch before the ferris
 * wheel is a child who is enjoying the game, and re-rolling the layout every
 * park would throw that away for nothing. The seed, and everything about
 * *where* a bar or a zone sits, is deliberately the same whichever level is
 * chosen — level only ever adds or removes whole hazards, never moves one.
 */
export function planHazards(loopLength: number, laps: number, level: RaceLevel): HazardSchedule {
  const rng = new Rng(0x9a11ce);
  const bars: DuckBar[] = [];
  const zones: SparkZone[] = [];

  let cursor = OPENING_RUN;
  const limit = loopLength - CLOSING_RUN;
  // Alternated rather than picked at random: two spark zones in a row is a long
  // time holding nothing, and five bars in a row never teaches the other rule.
  // Two bars to a zone keeps both fresh and lands about eight hazards a lap.
  let sinceZone = 0;
  const usedTrestleIndices = new Set<number>();
  while (cursor < limit) {
    if (sinceZone >= 2 && cursor + ZONE_MAX < limit) {
      const to = cursor + rng.range(ZONE_MIN, ZONE_MAX);
      zones.push({ from: cursor, to });
      cursor = to;
      sinceZone = 0;
    } else {
      // Snapped onto the trestle grid — see `snapToTrestleGrid` — rather than
      // left at the raw cursor: a duck bar now always sits at a position
      // `track.ts` can guarantee a real support for.
      bars.push({ at: snapToTrestleGrid(cursor, loopLength, usedTrestleIndices) });
      sinceZone += 1;
    }
    cursor += rng.range(GAP_MIN, GAP_MAX);
  }

  // Which of the physical layout above actually makes it into this level's
  // schedule — uniformly across every lap (unlike the old lap-escalation
  // reading of the brief this replaced): a level is a fixed composition for
  // the whole race, not something that changes as the laps go by.
  const includeZones = level >= ZONES_FROM_LEVEL;
  const includeBars = level >= BARS_FROM_LEVEL;
  const barCrossings: number[] = [];
  const sparkStretches: SparkZone[] = [];
  for (let lap = 0; lap < laps; lap += 1) {
    const base = lap * loopLength;
    if (includeZones) {
      for (const zone of zones) {
        sparkStretches.push({ from: base + zone.from, to: base + zone.to });
      }
    }
    if (includeBars) {
      // `bar.at` is also exactly where `track.ts` hangs the bar's geometry — see
      // that file's duck-bar loop. The two used to be allowed to differ by the
      // supporting trestle's arc nudge, which is how a rider came to fly through
      // a bar and lose her speed a cart's length later.
      for (const bar of bars) barCrossings.push(base + bar.at);
    }
  }
  barCrossings.sort((a, b) => a - b);
  sparkStretches.sort((a, b) => a.from - b.from);

  return { lap: { bars, zones }, barCrossings, sparkStretches };
}
