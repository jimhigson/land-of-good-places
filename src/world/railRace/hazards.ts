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
 * **2.1, not 1.5.** A previous pass (1 August 2026) set this to 1.5,
 * documented as "measured live... setting the bar roughly halfway between
 * [her ducking and standing head heights]." Re-measured live against the
 * actual running dev build (1 August 2026, same day, during the duck-bar
 * asset work — see `HANDOFF-duck-bar-blender-asset.md`): querying
 * `window.game.world.railRace` and `window.game.player.model.hatAnchor`'s
 * real world position directly (not recomputing the pose formula and
 * checking it against itself — the exact tautology
 * `ART-AGENT-NOTES.md` §6 warns a parity check can quietly become), her
 * crown sits **4.70 m above the rail even while off the button** (the
 * *better* of her two states). The old 1.5 was still nearly a metre below
 * that — she passed through every bar whichever way she was holding, not
 * "occasionally clipped", which is exactly Jim's report ("even while
 * ducking the character clearly goes through them overlapping by a lot").
 *
 * `DUCK_DROP` (`RailRace.ts`) is a fixed vertical translate, not a pose
 * change, so her head-to-root distance is the same in both states; her
 * standing head height is the same 4.70 m plus `DUCK_DROP * RIDE_SCALE`
 * (1.25 m) = 5.95 m. 2.1 sits roughly halfway between the two measured
 * figures (4.70 m and 5.95 m) — the same "halfway between the two real
 * states" rule the previous pass intended, just re-grounded in what the
 * running game actually measures rather than a formula re-derived from the
 * same code that produces the pose.
 */
export const DUCK_CLEARANCE = 2.1 * RIDE_SCALE;

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
      for (const bar of bars) barCrossings.push(base + bar.at);
    }
  }
  barCrossings.sort((a, b) => a - b);
  sparkStretches.sort((a, b) => a.from - b.from);

  return { lap: { bars, zones }, barCrossings, sparkStretches };
}
