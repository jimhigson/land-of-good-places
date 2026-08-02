import { Rng, clamp } from '../../core/mathUtils';
import { RAIL_RACE_PLAN } from './plan';
import { planHazards, type HazardLayout, type HazardSchedule, type RaceLevel } from './hazards';
import { LANE_COUNT, PLAYER_LANE, type RailRaceRoute } from './route';

/**
 * **The race, as arithmetic.** No scene, no camera, no DOM.
 *
 * Split out from `RailRace.ts` on purpose: this is the half that decides who
 * wins, and it is the half that shipped broken last time. Keeping it a pure
 * module means `scripts/check-rail-race.mts` can run four whole races on every
 * build and assert that letting go still beats holding — against *this* code,
 * not against a re-implementation of it that could agree with a model while
 * disagreeing with the game.
 *
 * ## The tap-rate rework (2 August 2026)
 *
 * The family's brief: no more hold-to-accelerate. Speed is driven by how
 * *fast* you press — mash a tap-only button (Space, the left mouse button,
 * a finger tapping the screen) and the cart goes faster; stop and it coasts.
 * Ducking, previously "not holding the accelerate button," is now its own
 * dedicated HELD control — a real gesture (drag down and hold on a phone,
 * hold Down or the right mouse button on a keyboard) with its own signal, not
 * derived from the absence of another one.
 *
 * The property the old hold-based tuning existed to protect — **a bonk must
 * cost more than the coasting it saved, and a black stretch must cost more
 * than the speed it bought, or the one control has nothing to teach** — is
 * unchanged. What changed is only what feeds the thrust:
 *
 * - {@link Rider.boost} replaces the old boolean "is the button down right
 *   now". Every discrete press bumps it by {@link BOOST_GAIN_PER_PRESS} and it
 *   bleeds away continuously ({@link BOOST_DECAY_RATE}), so a steady mash
 *   sustains a high boost, an occasional tap gives a short-lived pulse, and
 *   doing nothing gives zero. Thrust is `THRUST_MAX * boost`.
 * - **Ducking cancels boost gain and thrust output, completely**, exactly
 *   like the old "not holding = no thrust" rule. This is the one piece that
 *   is not obvious from "duck is now a separate control": duck and boost are
 *   genuinely independent signals (a keyboard player *can* hold Down and mash
 *   Space at the same instant), so without this coupling a keyboard player
 *   could hold duck permanently and take zero bonks while still going full
 *   speed — the duck bars would be decoration for exactly the players who
 *   can hold two things at once. Coupling them the way the old single-button
 *   game did restores the same "being safe costs you speed" trade, just fed
 *   by two hands instead of one finger.
 * - Sparking is now "any boost still on board while the rail is black" rather
 *   than "the button is down right now" — the practical difference is that a
 *   single startled tap right as you cross into a black stretch costs a
 *   little (the boost it added has to decay away, a few tenths of a second),
 *   where the old rule would have forgiven it instantly. Mashing all the way
 *   through still costs the same running drag it always did.
 */

/**
 * How many times round.
 *
 * Unchanged by the tap-rate rework and by the three-levels rework — "three
 * levels" (see `hazards.ts`'s header) means three separately-chosen hazard
 * compositions, picked once before the countdown, not three laps of one
 * race. Lap count is the family's own 1 August 2026 verdict, after actually
 * racing a tripled-lap version live and asking for two instead; nothing
 * about levels touches it. (An earlier pass in this file's git history raised
 * this to 3 on a mistaken "escalate by lap" reading of the levels brief —
 * corrected back to 2 the same day.)
 */
export const RACE_LAPS = 2;

/**
 * How much one discrete press adds to {@link Rider.boost}, 0..1.
 *
 * Tuned together with {@link BOOST_DECAY_RATE} and {@link THRUST_MAX} against
 * a swept range of tap rates (`scripts/check-rail-race.mts` prints the result
 * for several) so that a brisk, sustained mash (about 6 taps/second — fast
 * but within a child's reach) approaches the old hold-based terminal speed,
 * a moderate tap rate (about 2/second) gives roughly 60% of that, and no
 * presses at all coasts on drag and hills alone, same as before.
 */
const BOOST_GAIN_PER_PRESS = 0.22;

/**
 * How fast {@link Rider.boost} bleeds away when nothing is topping it up,
 * per second, applied exponentially (`boost *= exp(-BOOST_DECAY_RATE * dt)`)
 * rather than as a flat per-second subtraction — a proportional leak gives a
 * smooth, forgiving decay curve rather than a hard cliff, and it is what
 * lets a single press produce a short, clean pulse rather than a value that
 * can go straight to zero mid-frame.
 */
const BOOST_DECAY_RATE = 2.0;

/** {@link Rider.boost} never goes above this. */
const BOOST_MAX = 1;

/** Thrust while sustaining full boost, m/s². See {@link BOOST_GAIN_PER_PRESS}. */
const THRUST_MAX = 20;

/**
 * How long a press keeps counting as "still pressing" for the purposes of
 * sparking, in seconds — {@link Rider.sparkGuard}.
 *
 * Deliberately its **own** timer rather than reading {@link Rider.boost}
 * directly. The first version of this file tried exactly that (sparking
 * while `boost` sat above a small threshold), and it does not work: `boost`
 * is tuned for the *throttle feel* — enough inertia that a sustained mash
 * reads as smooth power rather than a jittery on/off — which at
 * {@link BOOST_DECAY_RATE}'s tuning takes over a second to bleed from a
 * typical cruising level down near zero. A rider who stopped pressing a
 * sensible distance before a black stretch was still measured as "pressing"
 * for most of it, which `scripts/check-rail-race.mts` caught immediately: a
 * perfect run sparked for 3.7 s it should never have sparked at all. Sparking
 * wants a short, decisive window — "did a press land recently" — completely
 * independent of how slowly the *speed* itself eases off.
 */
const SPARK_GUARD_SECONDS = 0.3;

/**
 * How long the pump/pedal animation takes to spring back to neutral after a
 * press, in seconds. See {@link Rider.bob} — purely cosmetic, nothing in this
 * file reads it back.
 */
const BOB_SECONDS = 0.22;

/**
 * Coasting drag: a linear part and a squared part, m/s².
 *
 * Unchanged by the tap-rate rework — this is the whole of the slowdown when
 * nothing is pressing, whatever drives the pressing.
 */
const DRAG_LINEAR = 0.175;
const DRAG_SQUARE = 0.01;

/**
 * Extra drag while the rail is sparking under you, m/s².
 *
 * Enough that mashing through a black stretch is plainly, visibly worse than
 * coasting through it — but it is *only* drag. There is no bonk, no wobble and
 * no stop: a child who mashes the whole way through one gets a shower of
 * sparks, a slow patch and a lesson, which is the kindest way to teach a rule
 * there is.
 */
const SPARK_DRAG = 6;

/**
 * How hard the hills pull. Real gravity, m/s². Unchanged by the tap-rate
 * rework — see the git history on this constant for the derivation.
 */
const HILL_PULL = 9.8;

/** You never stop and you never quite fly. */
const MIN_SPEED = 3.4;
const MAX_SPEED = 33;

/**
 * How long a bonk's wobble lasts — and, crucially, **thrust is dead for the
 * first two thirds of it.**
 *
 * This is where the cost of a bonk actually lives. See {@link WOBBLE_LOCKOUT}.
 */
const WOBBLE_SECONDS = 1.3;

/** Fraction of your speed you keep through a bonk. */
const BONK_SPEED_FACTOR = 0.35;

/** Thrust is dead, and presses do not build boost, while the wobble is above this. */
const WOBBLE_LOCKOUT = 0.35;

/**
 * The ring's own physical bar/zone positions — level-independent (see
 * `hazards.ts`'s header), built once at module load. `track.ts` builds the
 * whole ring's hazard geometry from this, whichever level ends up chosen;
 * `RailRace.ts` never has to know both the geometry and a race's own
 * schedule come from the same `planHazards` call.
 */
export const HAZARD_LAYOUT: HazardLayout = planHazards(RAIL_RACE_PLAN.route.length, RACE_LAPS, 1).lap;

/**
 * The hazard schedule for one chosen level — see `hazards.ts`'s header.
 * Called once when `RailRace.chooseLevel` fires, and once more at
 * construction for the calm, hazard-free level-1 default the ring and the
 * idling rivals sit in between races.
 */
export function scheduleForLevel(level: RaceLevel): HazardSchedule {
  return planHazards(RAIL_RACE_PLAN.route.length, RACE_LAPS, level);
}

/** The finish line, in metres travelled. */
export const RACE_DISTANCE = RAIL_RACE_PLAN.route.length * RACE_LAPS;

export interface Rider {
  readonly lane: number;
  /** Metres run since the lights went out. Only ever increases. */
  travelled: number;
  speed: number;
  /** 0..1: the tap-rate charge that drives thrust. See this file's header. */
  boost: number;
  /** True while the dedicated duck control is actively held this step. */
  ducking: boolean;
  /** 0 (neutral) .. 1 (fully pressed down): the per-tap pump/pedal pose. */
  bob: number;
  wobble: number;
  /** True while the rail is sparking under this rider. */
  sparking: boolean;
  /** Seconds left before a recent press stops counting as "still pressing" for sparking. See {@link SPARK_GUARD_SECONDS}. */
  sparkGuard: number;
  /** How many bar crossings this rider has already passed. */
  barCursor: number;
  /** How many black stretches this rider is already past. */
  zoneCursor: number;
  bonks: number;
  sparkSeconds: number;
  finished: boolean;
  place: number;
  finishTime: number;
  /**
   * Internal accumulator for a synthetic, regular tap stream — used by
   * {@link rivalInput} and the headless checker's own strategies, never by a
   * rider driven from real input (a real player's presses arrive as actual
   * frame-by-frame edges, with nothing to accumulate).
   */
  mashPhase: number;
}

export function createRider(lane: number): Rider {
  return {
    lane,
    travelled: 0,
    speed: 0,
    boost: 0,
    ducking: false,
    bob: 0,
    wobble: 0,
    sparking: false,
    sparkGuard: 0,
    barCursor: 0,
    zoneCursor: 0,
    bonks: 0,
    sparkSeconds: 0,
    finished: false,
    place: 0,
    finishTime: 0,
    mashPhase: 0,
  };
}

/** What a rider is asking for this exact step. */
export interface RiderInput {
  /** A boost press (tap, Space, a mouse click) landed on this step. */
  readonly pressed: boolean;
  /** The dedicated duck control is held down this step. */
  readonly ducking: boolean;
}

/** What happened to a rider in one step, for the scene and the HUD to react to. */
export interface StepEvents {
  /** Hit a duck bar this step. */
  readonly bonked: boolean;
  /** Crossed the finish line this step. */
  readonly finishedNow: boolean;
  /** Started a new lap this step, 1-based, or 0. */
  readonly lap: number;
}

const NOTHING: StepEvents = { bonked: false, finishedNow: false, lap: 0 };

/**
 * One rider's step.
 *
 * `hazards` is the schedule for whichever level was chosen for this race
 * (see `hazards.ts`'s header and `RailRace.chooseLevel`) — never a fixed
 * module-level constant, because which bars/zones are actually live is now a
 * per-race choice, not a build-time fact. `band` multiplies thrust, and is
 * how a rival is rubber-banded; it is 1 for the player, always.
 */
export function stepRider(
  route: RailRaceRoute,
  rider: Rider,
  hazards: HazardSchedule,
  input: RiderInput,
  dt: number,
  band = 1,
): StepEvents {
  if (rider.finished) return NOTHING;

  const wobbling = rider.wobble > WOBBLE_LOCKOUT;
  rider.ducking = input.ducking;

  // Bob: a quick pump down on every fresh press, springing back up between
  // them — see this file's header. Purely cosmetic.
  rider.bob = input.pressed ? 1 : Math.max(0, rider.bob - dt / BOB_SECONDS);

  // Boost: a discrete bump per press, bleeding away continuously. Ducking or
  // the dead window right after a bonk both cancel a press's bump — the same
  // "no free speed while you should be doing something else" rule the old
  // hold-based thrust used.
  const registersAsPressed = input.pressed && !rider.ducking && !wobbling;
  const gain = registersAsPressed ? BOOST_GAIN_PER_PRESS : 0;
  rider.boost = Math.min(BOOST_MAX, (rider.boost + gain) * Math.exp(-BOOST_DECAY_RATE * dt));

  // A short, decisive "was that a real press, recently" window — see
  // SPARK_GUARD_SECONDS' own doc comment for why this is not just `boost`
  // read against a threshold.
  rider.sparkGuard = registersAsPressed ? SPARK_GUARD_SECONDS : Math.max(0, rider.sparkGuard - dt);

  // --- is the rail black under us? ------------------------------------------
  const stretches = hazards.sparkStretches;
  while (rider.zoneCursor < stretches.length && (stretches[rider.zoneCursor]?.to ?? 0) < rider.travelled) {
    rider.zoneCursor += 1;
  }
  const stretch = stretches[rider.zoneCursor];
  const inZone = stretch !== undefined && rider.travelled >= stretch.from;
  rider.sparking = inZone && rider.sparkGuard > 0;
  if (rider.sparking) rider.sparkSeconds += dt;

  // --- physics ---------------------------------------------------------------
  const distance = route.wrap(route.startDistance + rider.travelled);
  const slope = route.slopeAt(rider.lane, distance);
  // Ducking and sparking both cancel thrust outright, not just growth — the
  // rail is not carrying the power in either case, which is the whole
  // fiction of "you must let go for this".
  const thrustGate = !rider.ducking && !rider.sparking && !wobbling;
  const thrust = thrustGate ? THRUST_MAX * rider.boost * band : 0;
  const drag =
    DRAG_LINEAR * rider.speed +
    DRAG_SQUARE * rider.speed * rider.speed +
    (rider.sparking ? SPARK_DRAG : 0);
  // The clamp scales with `band`, not just the thrust that feeds it. A flat
  // `MAX_SPEED` here was the exact bug the family's "far too good" rivals
  // report traced to under the old hold-based physics (see `rivalBand`'s own
  // doc comment): a rubber-banded rival's thrust could rise, but its speed
  // was silently re-capped back down to the player's own ceiling, so a
  // trailing rival given a tow could never actually close on it. `band` is 1
  // for the player always, so this is a no-op for her.
  const speedCap = band > 1 ? MAX_SPEED * band : MAX_SPEED;
  rider.speed = clamp(rider.speed + (thrust - drag - HILL_PULL * slope) * dt, MIN_SPEED, speedCap);

  const before = rider.travelled;
  rider.travelled += rider.speed * dt;

  if (rider.wobble > 0) rider.wobble = Math.max(0, rider.wobble - dt / WOBBLE_SECONDS);

  // --- did we cross a bar? ---------------------------------------------------
  //
  // Every crossing of the whole race is a single ascending list of travelled
  // distances, so this is an interval test walked by one cursor: a bar between
  // `before` and now is caught whatever the frame rate.
  let bonked = false;
  const crossings = hazards.barCrossings;
  while (rider.barCursor < crossings.length && (crossings[rider.barCursor] ?? Infinity) <= rider.travelled) {
    if (!rider.ducking) {
      bonk(rider);
      bonked = true;
    }
    rider.barCursor += 1;
  }

  // --- lap and finish --------------------------------------------------------
  const lapBefore = Math.floor(before / route.length);
  const lapNow = Math.floor(rider.travelled / route.length);
  const lap = lapNow !== lapBefore && lapNow < RACE_LAPS ? lapNow + 1 : 0;

  let finishedNow = false;
  if (rider.travelled >= RACE_DISTANCE) {
    rider.finished = true;
    finishedNow = true;
  }

  return { bonked, finishedNow, lap };
}

function bonk(rider: Rider): void {
  rider.speed = Math.max(MIN_SPEED, rider.speed * BONK_SPEED_FACTOR);
  rider.wobble = 1;
  // A crisp punishment, not just a gate on new gain: without this a rider
  // who had built up a lot of boost right before the bar would keep coasting
  // on it the instant the wobble drops back under WOBBLE_LOCKOUT.
  rider.boost = 0;
  rider.sparkGuard = 0;
  rider.bonks += 1;
}

// ------------------------------------------------------------------ the brains

/**
 * How far ahead a rider has to look to catch the next bar.
 *
 * One step's travel plus a margin: ducking any earlier only costs speed, and
 * the family's rule gives no credit for coasting down first.
 */
function barIsHere(rider: Rider, hazards: HazardSchedule, dt: number, margin: number): boolean {
  const next = hazards.barCrossings[rider.barCursor];
  if (next === undefined) return false;
  return next - rider.travelled <= rider.speed * dt + margin;
}

/** Is a black stretch under us, or about to be? */
function zoneIsHere(rider: Rider, hazards: HazardSchedule, lead: number, trail: number): boolean {
  const stretch = hazards.sparkStretches[rider.zoneCursor];
  if (stretch === undefined) return false;
  return rider.travelled >= stretch.from - lead && rider.travelled <= stretch.to + trail;
}

/**
 * How good each rival is, by lane, innermost first.
 *
 * **Lowered on the family's 1 August 2026 verdict that the rivals were "far
 * too good"**, and re-measured here on 2 August 2026 against the tap-rate
 * rework — the old 0.72/0.8/0.86 survived PR #167's whole input-model rewrite
 * untouched (nobody had reason to touch it while chasing the tap-rate work),
 * and at those numbers a rival's *mash rate* alone
 * (`RIVAL_MASH_RATE_MIN + (MAX-MIN) * skill`) sits at 5.2–5.7 taps/second —
 * within a whisker of `mashPerfect`'s flat-out 6, which is a rival who is
 * very nearly always mashing at full tilt. Skill has three levers now, not
 * one: the mash rate itself, the chance of missing a duck bar
 * (`1 - rng.chance(skill)` in {@link rivalInput}), and how much lead a rival
 * gives a black stretch before easing off. Lowering only the number, without
 * touching {@link rivalBand}, would have repeated the exact mistake PR #157's
 * second review round caught under the old physics: a rubber band that
 * refunds every mistake a low-skill rival makes reads as "the rivals are
 * still unbeatable" no matter how low `skill` goes, because a low `skill`
 * rival is *further behind* and so gets *more* of the tow.
 *
 * Picked by racing {@link simulateField} across the fixed seed sweep
 * `scripts/check-rail-race.mts` prints (level 3, every hazard live — the
 * hardest of the three the family can choose): a `mashPerfect` player wins
 * every one of the 24 fixed seeds, comfortably but never by a procession,
 * while a `mashSloppy` one wins under half of them — sloppy play is a real
 * chance of losing, not a formality either way — and every rival lands a
 * handful of real, visible bar-misses per race rather than either never
 * missing (unbeatable) or missing constantly (a joke). See that script's own
 * "the field" section for the live numbers.
 */
export const RIVAL_SKILL: readonly number[] = [0.62, 0.72, 0.82];

/**
 * How hard the rivals rubber-band, and **why a low `skill` alone was never
 * going to be enough.**
 *
 * A metre of lead moves a rival's thrust by `CATCHUP`. Before this file, it
 * was a single symmetric ±0.22 in `RailRace.ts`, clamped straight onto
 * thrust with nothing scaling the speed ceiling that thrust was trying to
 * push past — the exact defect PR #157's second review round found under the
 * old hold-based physics, reproduced here in the tap-rate rework because
 * nothing about the rubber band changed when the control scheme did. Two
 * separate bugs, and lowering `RIVAL_SKILL` fixes neither:
 *
 * 1. **The speed clamp didn't scale with the band that was supposed to beat
 *    it.** A trailing rival's thrust could rise (a bigger `band`), but
 *    `stepRider` re-capped the resulting speed straight back down to the
 *    player's own `MAX_SPEED` — see that function's `speedCap` fix. Whatever
 *    edge the tow was meant to give a rival evaporated at the clamp.
 * 2. **The band itself was symmetric and short.** A rival who fell behind —
 *    which a *lower-skill* rival now does more often, precisely because it
 *    is missing more bars and mashing slower — only ever got back to +22%
 *    thrust, reached slowly. A rival who is genuinely worse plays worse
 *    *more*, falls behind *more*, and needs *more* tow to stay a race rather
 *    than a procession — the band has to grow with how far behind a rival
 *    actually gets, not cap out at the same modest ceiling a rival who is
 *    barely behind at all also gets.
 *
 * So, asymmetric on both axes, same shape as the fix that solved this once
 * already under the old physics:
 *
 * - **Behind**: a gentle ramp to a generous ceiling — a rival ten metres back
 *   gets almost nothing, so a mistake the player just watched still costs
 *   real ground in the stretch where she can see it happen; a rival a long
 *   way back is towed hard enough to stay in the race.
 * - **Ahead**: a quicker ramp to a harder ceiling — a rival who gets in front
 *   sags back within a modest lead, which is the half of the mechanic that
 *   lets a child who is behind come back.
 */
const CATCHUP_BEHIND = 0.006;
const CATCHUP_AHEAD = 0.01;
const SWING_BEHIND = 0.55;
const SWING_AHEAD = 0.32;

/**
 * A rival's thrust multiplier, from how far the player is ahead of them.
 *
 * `lead` is `player.travelled - rival.travelled`, so positive means the rival
 * is behind. Lives here with the physics it multiplies rather than in
 * `RailRace.ts`, so the balance checker races the same rubber band the
 * browser does instead of a re-implementation of it.
 */
export function rivalBand(lead: number): number {
  return lead >= 0
    ? 1 + Math.min(lead * CATCHUP_BEHIND, SWING_BEHIND)
    : 1 - Math.min(-lead * CATCHUP_AHEAD, SWING_AHEAD);
}

/** How many taps a second a rival lands while nothing needs their attention. */
const RIVAL_MASH_RATE_MIN = 2.5;
const RIVAL_MASH_RATE_MAX = 6.2;

/**
 * Ticks a rider's own {@link Rider.mashPhase} accumulator at `rate` taps a
 * second and reports whether one landed this step — a regular, deterministic
 * tap stream rather than one jittered per frame, which is plenty: a rival
 * skips a tap here and there through `skill` and `rng` at the call site
 * instead (see {@link rivalInput}), not by making the underlying rhythm
 * ragged.
 */
function tickMash(rider: Rider, rate: number, dt: number): boolean {
  if (rate <= 0) return false;
  rider.mashPhase += rate * dt;
  if (rider.mashPhase < 1) return false;
  rider.mashPhase -= 1;
  return true;
}

/**
 * The rivals' whole personality: how hard they mash, and whether they
 * remember to duck and to ease off.
 *
 * `skill` is 0..1. A low-skill rival mashes slower, misses bars more often
 * and eases off a black stretch late; none of them is ever perfect, because a
 * child has to be able to win, and none of them is ever hopeless, because a
 * race you cannot lose is not a race either.
 */
export function rivalInput(
  rider: Rider,
  hazards: HazardSchedule,
  dt: number,
  skill: number,
  rng: Rng,
): RiderInput {
  if (rider.wobble > WOBBLE_LOCKOUT) return { pressed: false, ducking: false };

  // Judgement of each bar is drawn once, as it comes up, so a rival's mistakes
  // are decided in advance rather than flickering frame to frame.
  if (barIsHere(rider, hazards, dt, 0.8)) {
    return { pressed: false, ducking: rng.chance(skill) };
  }
  // Scaled by SPARK_AVOID_LEAD, same as the checker's own `mashPerfect`: a
  // rival at skill 1 eases off with (almost) enough lead to never spark, one
  // at skill 0 eases off right at the edge of the zone and sparks visibly —
  // which is the point, see this function's own doc comment.
  if (zoneIsHere(rider, hazards, SPARK_AVOID_LEAD * skill, 0)) return { pressed: false, ducking: false };

  const rate = RIVAL_MASH_RATE_MIN + (RIVAL_MASH_RATE_MAX - RIVAL_MASH_RATE_MIN) * skill;
  return { pressed: tickMash(rider, rate, dt), ducking: false };
}

// ----------------------------------------------------------- the headless race

/** The five ways `scripts/check-rail-race.mts` plays the game. */
export type Strategy = 'mashThroughEverything' | 'neverPress' | 'mashPerfect' | 'mashSloppy' | 'ducksNothing';

/**
 * Sustained tap rate for each strategy, taps a second, while nothing needs
 * attention. Every strategy but `neverPress` mashes at the same top rate —
 * this table exists to isolate *hazard judgement*, not mashing stamina, so a
 * strategy's whole difference from `mashPerfect` should be how it handles a
 * bar or a zone, not how fast its thumb is the rest of the time. (An earlier
 * draft gave `mashSloppy` a slower rate too, on top of worse judgement —
 * `scripts/check-rail-race.mts` caught that it then finished *slower* than
 * `mashThroughEverything` even after avoiding most of its bonks, because the
 * slow mash rate dominated the whole ~50 s race far more than a handful of
 * ~2 s bonks ever could. Isolate one variable at a time.)
 */
const STRATEGY_MASH_RATE: Readonly<Record<Strategy, number>> = {
  mashThroughEverything: 6,
  neverPress: 0,
  mashPerfect: 6,
  mashSloppy: 6,
  ducksNothing: 6,
};

/**
 * How far ahead of a black stretch a strategy that means to play it cleanly
 * has to stop pressing, in metres — sized against {@link SPARK_GUARD_SECONDS}
 * at {@link MAX_SPEED} (0.3 s × 33 m/s ≈ 10 m) so the guard window has
 * genuinely expired by the time the zone starts, whatever speed the rider
 * arrives at. The first draft used 0.4 m, copied from the old hold-based
 * game where releasing was instant; against a decaying `sparkGuard` that
 * left a "perfect" run sparking for 3.7 s of a race it should have sparked
 * for none of — see `SPARK_GUARD_SECONDS`'s own doc comment.
 */
const SPARK_AVOID_LEAD = 10;

function strategyInput(
  strategy: Strategy,
  rider: Rider,
  hazards: HazardSchedule,
  dt: number,
  rng: Rng,
): RiderInput {
  const pressed = tickMash(rider, STRATEGY_MASH_RATE[strategy], dt);
  switch (strategy) {
    case 'mashThroughEverything':
      // Never lets go for anything — the old game-breaking bug this file
      // exists to catch, rephrased for a tap button: mash flat out, forever,
      // duck for nothing.
      return { pressed, ducking: false };
    case 'neverPress':
      return { pressed: false, ducking: false };
    case 'mashPerfect':
      // Ducks for exactly as long as a bar needs and stops pressing early
      // enough that the black stretch never sees a live press.
      if (barIsHere(rider, hazards, dt, 0.05)) return { pressed: false, ducking: true };
      if (zoneIsHere(rider, hazards, SPARK_AVOID_LEAD, 0)) return { pressed: false, ducking: false };
      return { pressed, ducking: false };
    case 'mashSloppy':
      // Remembers the bar about two thirds of the time, and is late off the
      // gas for the black stretches — presses right up until it is already
      // inside one, so it always sparks a little rather than never.
      if (barIsHere(rider, hazards, dt, 0.05)) return { pressed: false, ducking: rng.chance(0.65) };
      if (zoneIsHere(rider, hazards, -2.5, 0)) return { pressed: false, ducking: false };
      return { pressed, ducking: false };
    case 'ducksNothing':
      // Isolates what a bonk actually costs. Against `mashPerfect` — which
      // differs from it *only* in ducking for the bars — the gap is the
      // duck-bar mechanic's entire contribution to the race, with the spark
      // drag subtracted out on both sides. See `scripts/check-rail-race.mts`.
      if (zoneIsHere(rider, hazards, SPARK_AVOID_LEAD, 0)) return { pressed: false, ducking: false };
      return { pressed, ducking: false };
  }
}

export interface RaceOutcome {
  readonly seconds: number;
  readonly bonks: number;
  readonly sparkSeconds: number;
}

/**
 * One rider, one whole race, at a fixed 60 Hz. Used by the build's checker.
 *
 * Deliberately drives {@link stepRider} — the very function the browser calls
 * every frame — so a change to the physics cannot pass the check by only being
 * made in one of two places. `level` picks which hazard composition the race
 * is run against — see `hazards.ts`'s header.
 */
export function simulateRailRace(strategy: Strategy, level: RaceLevel): RaceOutcome {
  const route = RAIL_RACE_PLAN.route;
  const hazards = scheduleForLevel(level);
  const rider = createRider(0);
  const rng = new Rng(0x1a5e51);
  const dt = 1 / 60;
  let seconds = 0;

  // A generous ceiling: nothing that finishes is anywhere near it, and a rider
  // that somehow cannot finish should end the check rather than the process.
  while (!rider.finished && seconds < 400) {
    stepRider(route, rider, hazards, strategyInput(strategy, rider, hazards, dt, rng), dt);
    seconds += dt;
  }

  return { seconds, bonks: rider.bonks, sparkSeconds: rider.sparkSeconds };
}

/** How a whole four-cart race came out. */
export interface FieldOutcome {
  /** The player's finishing position, 1 is a win. */
  readonly playerPlace: number;
  /** Lanes in finishing order. */
  readonly order: readonly number[];
  /** How long the player's own race took, in seconds. */
  readonly seconds: number;
  /**
   * How far the nearest rival was from the line **at the moment the player
   * crossed it** — positive if that rival was still behind, negative if they
   * had already finished ahead. Sampled then rather than at the end of the
   * whole race, when everybody is on the line and every margin is zero.
   */
  readonly marginMetres: number;
  /** Duck bars the three rivals missed between them, for the checker to report. */
  readonly rivalBonks: number;
}

/**
 * The **whole field** — the player and all three rivals — raced headlessly.
 *
 * The single-rider {@link simulateRailRace} above answers "is letting go
 * worth it?". This answers the question the family actually asked on 1
 * August 2026, unchanged by the tap-rate rework: *can she win?* It drives the
 * very functions the browser drives — {@link rivalInput} for the rivals,
 * {@link rivalBand} for the rubber band, {@link stepRider} for everybody —
 * so rival tuning cannot pass this check by being right only in a model of
 * the game that the browser does not actually run.
 *
 * Each rider gets its own `Rng` stream, keyed off the seed and its lane, so
 * one rival's luck cannot shift another's: without that, changing a single
 * skill value re-rolls every rival's whole race and the check reads as noise
 * rather than a measurement of the change that was actually made.
 */
export function simulateField(playerStrategy: Strategy, level: RaceLevel, seed: number): FieldOutcome {
  const route = RAIL_RACE_PLAN.route;
  const hazards = scheduleForLevel(level);
  const dt = 1 / 60;
  const riders = Array.from({ length: LANE_COUNT }, (_unused, lane) => createRider(lane));
  const rngs = riders.map((_unused, lane) => new Rng(seed + lane * 0x9e37));
  const player = riders[PLAYER_LANE]!;
  const rivals = riders.filter((rider) => rider.lane !== PLAYER_LANE);
  const order: number[] = [];
  let seconds = 0;
  let playerSeconds = 0;
  let marginMetres = 0;

  while (order.length < riders.length && seconds < 400) {
    for (const rider of riders) {
      if (rider.finished) continue;
      const rng = rngs[rider.lane]!;
      const isPlayer = rider.lane === PLAYER_LANE;
      const input = isPlayer
        ? strategyInput(playerStrategy, rider, hazards, dt, rng)
        : rivalInput(rider, hazards, dt, RIVAL_SKILL[rider.lane] ?? 0.7, rng);
      const band = isPlayer ? 1 : rivalBand(player.travelled - rider.travelled);
      if (!stepRider(route, rider, hazards, input, dt, band).finishedNow) continue;
      order.push(rider.lane);
      if (isPlayer) {
        playerSeconds = seconds;
        marginMetres = RACE_DISTANCE - Math.max(...rivals.map((other) => other.travelled));
      }
    }
    seconds += dt;
  }

  return {
    playerPlace: order.indexOf(PLAYER_LANE) + 1,
    order,
    seconds: playerSeconds,
    marginMetres,
    rivalBonks: rivals.reduce((sum, rider) => sum + rider.bonks, 0),
  };
}
