import { Rng, clamp } from '../../core/mathUtils';
import { RAIL_RACE_PLAN } from './plan';
import { planHazards, type HazardSchedule } from './hazards';
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
 * ## The tuning, and where it came from
 *
 * Inherited from the retired 2D rail racer, which had already been tuned
 * against a simulation of its whole course for one specific property: **a bonk
 * must cost more than the coasting it saved**, or holding the button down for a
 * minute is the winning strategy and the game has nothing to teach. That is
 * exactly the property the in-park race then lost (see {@link WOBBLE_SECONDS}),
 * and exactly the property the checker now asserts.
 */

/**
 * How many times round.
 *
 * **Two, per the family's own 1 August 2026 verdict, after actually racing
 * the tripled-lap version live.** The 1 August physics tuning roughly doubled
 * the cart's speed, which on its own would have taken a good run over two
 * laps from 52 s down to 25 s and tripped this file's own "barely a ride"
 * guard in `scripts/check-rail-race.mts` — a third lap was added same-day to
 * paper over exactly that. Once the family played it, three read as too long
 * rather than too short; two is the family's explicit answer, not a
 * miscalculation being reintroduced. If `scripts/check-rail-race.mts`'s
 * "barely a ride" guard trips at two laps with the current physics, that is
 * the physics to revisit (`THRUST`/drag below), not this constant.
 */
export const RACE_LAPS = 2;

/**
 * Acceleration while the button is held, m/s².
 *
 * Raised by half on the family's 1 August 2026 ask ("increase the acceleration
 * and max speed when pressing by 50%"), from the 9.9 the retired 2D racer had.
 */
const THRUST = 14.85;

/**
 * Coasting drag: a linear part and a squared part, m/s².
 *
 * Both halved on the same ask ("reduce the slowdown penalty for not pressing by
 * 50%"), from 0.35 and 0.02. Note this is the whole of the slowdown when the
 * button is up — there is nothing else acting on a coasting cart but this and
 * the hills — so halving these two *is* the requested change, exactly.
 */
const DRAG_LINEAR = 0.175;
const DRAG_SQUARE = 0.01;

/**
 * Extra drag while the rail is sparking under you, m/s².
 *
 * Enough that holding through a black stretch is plainly, visibly worse than
 * coasting through it — but it is *only* drag. There is no bonk, no wobble and
 * no stop: a child who holds the whole way through one gets a shower of sparks,
 * a slow patch and a lesson, which is the kindest way to teach a rule there is.
 */
const SPARK_DRAG = 6;

/**
 * How hard the hills pull. **Real gravity**, m/s².
 *
 * Raised from 5.6 on the family's 1 August 2026 report that the cart does not
 * react to gravity — which turned out to be literally true while coasting, not
 * merely faint. The sign was always right (`-HILL_PULL * slope`, and `slopeAt`
 * is positive uphill), but the magnitude could never win:
 *
 * - the steepest gradient the route's `HARMONICS` produce is 0.2327 (13.1°)
 * - so the strongest downhill pull available was `5.6 * 0.2327` = 1.303 m/s²
 * - drag at the `MIN_SPEED` floor of 3.4 m/s was `0.35*3.4 + 0.02*3.4²` = 1.421 m/s²
 *
 * Drag beat the steepest downhill at *every speed the cart could legally be at*,
 * so a released cart could never gain a metre per second anywhere on the course.
 * Measured before the change: it sat on 3.40 m/s for an entire lap, dead flat.
 *
 * The old value's comment argued for staying "well under real gravity" so the
 * hills never became a second thing to manage. That concern is now carried by
 * `THRUST` instead, which is large enough that the hills move a *held* cart by
 * only about 6% (29.9–31.6 m/s) — the ride still is not asking her to manage
 * hills. What changed is the *coasting* case, which is where a hill should be
 * felt and where the fiction lives: let go on the flat and you sag to 3.4 m/s,
 * let go on a downhill and you keep rolling at 6.5. Twice the speed for reading
 * the track, where before it made no difference at all.
 *
 * It is real gravity rather than a tuned number on purpose: "the cart reacts to
 * gravity" has one obviously correct value, and a knob nobody can justify is a
 * knob the next person will move.
 */
const HILL_PULL = 9.8;

/**
 * You never stop and you never quite fly.
 *
 * `MAX_SPEED` raised by half with the thrust, from 22. Worth knowing what this
 * clamp actually does: at the old tuning it did **nothing at all**. Terminal
 * speed while holding solves `DRAG_SQUARE·v² + DRAG_LINEAR·v = THRUST`, which
 * came out at 15.2 m/s — the drag curve was the real cap and 22 was never
 * reached. At the new tuning terminal is 30.8 m/s, so 33 is still headroom on
 * the flat and is reached only where a downhill pushes the cart past its own
 * terminal speed. That is the right shape for it: a ceiling the hills can find
 * and the throttle cannot.
 */
const MIN_SPEED = 3.4;
const MAX_SPEED = 33;

/**
 * How long a bonk's wobble lasts — and, crucially, **the button does nothing
 * for the first two thirds of it.**
 *
 * This is where the cost of a bonk actually lives. The old in-park race kept a
 * `bonkWobble` timer but never let it gate thrust: it shook the seat and
 * nothing else, so a bonk cost only a moment's speed and the lerp back to full
 * pace had a 0.3 s time constant. Holding the button down for the whole race
 * beat playing well, which is precisely the family's "duck bars ineffective —
 * holding wins" report. Gating thrust is the fix, and
 * `scripts/check-rail-race.mts` is the thing that stops it regressing.
 */
const WOBBLE_SECONDS = 1.3;

/** Fraction of your speed you keep through a bonk. */
const BONK_SPEED_FACTOR = 0.35;

/** Thrust is dead while the wobble is above this. */
const WOBBLE_LOCKOUT = 0.35;

/** The hazards, laid out once for the whole race. */
export const HAZARDS: HazardSchedule = planHazards(RAIL_RACE_PLAN.route.length, RACE_LAPS);

/** The finish line, in metres travelled. */
export const RACE_DISTANCE = RAIL_RACE_PLAN.route.length * RACE_LAPS;

export interface Rider {
  readonly lane: number;
  /** Metres run since the lights went out. Only ever increases. */
  travelled: number;
  speed: number;
  /** The button state actually applied this step (a wobble can veto it). */
  holding: boolean;
  wobble: number;
  /** True while the rail is sparking under this rider. */
  sparking: boolean;
  /**
   * Seconds left of a rival's lapse in concentration — a beat of coasting for
   * no reason at all. Zero for the player, who has her own thumb. See
   * {@link rivalWantsHold}.
   */
  lapse: number;
  /** How many lapses this rider has had, for the balance checker to report. */
  lapses: number;
  /** How many bar crossings this rider has already passed. */
  barCursor: number;
  /** How many black stretches this rider is already past. */
  zoneCursor: number;
  bonks: number;
  sparkSeconds: number;
  finished: boolean;
  place: number;
  finishTime: number;
}

export function createRider(lane: number): Rider {
  return {
    lane,
    travelled: 0,
    speed: 0,
    holding: false,
    wobble: 0,
    sparking: false,
    lapse: 0,
    lapses: 0,
    barCursor: 0,
    zoneCursor: 0,
    bonks: 0,
    sparkSeconds: 0,
    finished: false,
    place: 0,
    finishTime: 0,
  };
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
 * `band` multiplies thrust, and is how a rival is rubber-banded; it is 1 for the
 * player, always.
 */
export function stepRider(
  route: RailRaceRoute,
  rider: Rider,
  wantHold: boolean,
  dt: number,
  band = 1,
): StepEvents {
  if (rider.finished) return NOTHING;

  const wobbling = rider.wobble > WOBBLE_LOCKOUT;
  rider.holding = wantHold && !wobbling;

  // --- is the rail black under us? ------------------------------------------
  const stretches = HAZARDS.sparkStretches;
  while (rider.zoneCursor < stretches.length && (stretches[rider.zoneCursor]?.to ?? 0) < rider.travelled) {
    rider.zoneCursor += 1;
  }
  const stretch = stretches[rider.zoneCursor];
  const inZone = stretch !== undefined && rider.travelled >= stretch.from;
  rider.sparking = inZone && rider.holding;
  if (rider.sparking) rider.sparkSeconds += dt;

  // --- physics ---------------------------------------------------------------
  const distance = route.wrap(route.startDistance + rider.travelled);
  const slope = route.slopeAt(rider.lane, distance);
  // Sparking cancels the thrust as well as adding drag: the rail is not carrying
  // the power, which is the whole fiction of a black section.
  const thrust = rider.holding && !rider.sparking ? THRUST * band : 0;
  const drag =
    DRAG_LINEAR * rider.speed +
    DRAG_SQUARE * rider.speed * rider.speed +
    (rider.sparking ? SPARK_DRAG : 0);
  const speedCap = band > 1 ? MAX_SPEED * band : MAX_SPEED;
  rider.speed = clamp(rider.speed + (thrust - drag - HILL_PULL * slope) * dt, MIN_SPEED, speedCap);

  const before = rider.travelled;
  rider.travelled += rider.speed * dt;

  if (rider.wobble > 0) rider.wobble = Math.max(0, rider.wobble - dt / WOBBLE_SECONDS);

  // --- did we cross a bar? ---------------------------------------------------
  //
  // Every crossing of the whole race is a single ascending list of travelled
  // distances, so this is an interval test walked by one cursor: a bar between
  // `before` and now is caught whatever the frame rate. The old race sampled
  // `|distance - barrier| < 0.9` instead — a 1.8 m window that a 30 fps frame at
  // racing speed steps most of the way across and a hitch steps clean over.
  let bonked = false;
  const crossings = HAZARDS.barCrossings;
  while (rider.barCursor < crossings.length && (crossings[rider.barCursor] ?? Infinity) <= rider.travelled) {
    if (rider.holding) {
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
  rider.bonks += 1;
}

// ------------------------------------------------------------------ the brains

/**
 * How far ahead a rider has to look to catch the next bar.
 *
 * One step's travel plus a margin: releasing any earlier only costs speed, and
 * the family's rule gives no credit for coasting down first.
 */
function barIsHere(rider: Rider, dt: number, margin: number): boolean {
  const next = HAZARDS.barCrossings[rider.barCursor];
  if (next === undefined) return false;
  return next - rider.travelled <= rider.speed * dt + margin;
}

/** Is a black stretch under us, or about to be? */
function zoneIsHere(rider: Rider, lead: number, trail: number): boolean {
  const stretch = HAZARDS.sparkStretches[rider.zoneCursor];
  if (stretch === undefined) return false;
  return rider.travelled >= stretch.from - lead && rider.travelled <= stretch.to + trail;
}

/**
 * How good each rival is, by lane, innermost first.
 *
 * **Lowered on the family's 1 August 2026 verdict that the rivals were "far
 * too good".** They were 0.72 / 0.8 / 0.86. Lowering them was not the whole
 * fix and, on its own, would not have been much of one — see {@link rivalBand},
 * which is where most of the problem actually lived.
 *
 * They live here rather than beside the rivals' names and outfits in
 * `RailRace.ts` because skill is a fact about the *simulation*: it is what
 * `scripts/check-rail-race.mts` has to race in order to assert that a child who
 * plays well wins, and a second copy of it over there is a second copy to drift.
 * Ordered inside-out, so the nearest rival to the player is the sharpest one —
 * the cart she can actually see beside her is the one worth beating.
 *
 * Picked by sweeping {@link simulateField} over 24 seeds rather than by feel.
 * At these values the three rivals make about 7 bonks and 10 lapses *between
 * them* per race — two or three visible mistakes each, which is the "visibly
 * fallible" the family asked for — while a `perfect` run still finishes about
 * 64 m clear and a `sloppy` one wins a third of the time by around 8 m. Going
 * lower (0.52/0.66/0.78 was tried) makes a good run a 93 m procession, which
 * breaks this ride's own "the rivals stay near you" promise in the other
 * direction.
 */
export const RIVAL_SKILL: readonly number[] = [0.62, 0.74, 0.85];

/**
 * How hard the rivals rubber-band, and **the real reason they felt unbeatable.**
 *
 * A metre of lead moves a rival's thrust by `CATCHUP`. It used to be clamped to
 * a symmetric ±0.22, and that symmetry was the bug. Terminal speed solves
 * `DRAG_SQUARE·v² + DRAG_LINEAR·v = THRUST·band`, so:
 *
 * - the player, whose band is always 1, tops out at **30.8 m/s**;
 * - a rival far enough behind got band 1.22, terminal 34.7, clipped by
 *   `MAX_SPEED` to **33**.
 *
 * A trailing rival was therefore *faster than the player's best possible
 * speed*, permanently. Every hazard a rival visibly bonked was refunded within
 * a few seconds, so the child could watch a rival make a mistake and still
 * never pull away from her — which reads exactly like an opponent who is
 * simply better, whatever `skill` says. No amount of lowering `skill` fixes
 * that; the mistakes were already happening and were being erased.
 *
 * So the band is now asymmetric on **both** axes — how far it can swing, and
 * how quickly it gets there:
 *
 * - **Behind**: a *slow* ramp to a generous ceiling. A rival ten metres back
 *   gets almost nothing (band 1.07), so a bonk she just watched still costs
 *   that rival real ground in the stretch where she can see it. A rival a
 *   hundred metres back gets the full +0.7 and is towed home.
 * - **Ahead**: a *fast* ramp to a hard −0.26 (terminal 25.5 m/s against the
 *   player's 30.8). A rival who gets in front sags within forty metres and is
 *   reelable, which is the half of the mechanic that lets a child come back.
 *
 * **Raised again on 1 August 2026, PR #157 review round 2**, after a second
 * reviewer ran `simulateField('perfect', seed)` per-seed across the 24 fixed
 * seeds `scripts/check-rail-race.mts` sweeps, rather than trusting its
 * field-average assertion, and found a 16.1–135.6 m spread — five of the 24
 * individually over the "quarter of a lap" ceiling the check's own prose
 * claimed to enforce, one of them a 135.6 m procession. Two things were
 * wrong, not one:
 *
 * 1. `stepRider`'s speed clamp was a flat `MAX_SPEED`, so a badly-behind
 *    rival's drag-limited terminal (33.7 m/s at the old ceiling, band 1.16)
 *    was silently re-capped straight back down to 33 — the clamp, not the
 *    band, was the real ceiling on a tow. Fixed by scaling the clamp with
 *    `band` (`stepRider`'s `speedCap`), so a rubber-banded rival's ceiling
 *    actually rises with it instead of quietly disappearing into a second,
 *    unrelated cap.
 * 2. Even with that fixed, the *old* ceiling and ramp (0.16 at 0.0018/m)
 *    were too gentle to close the deficits a rival's own bad luck can
 *    produce: a rival's lapses roll independently per second of open track
 *    ({@link rivalWantsHold}), so a slow rival spends *longer* on that
 *    track and gets *more* rolls, a compounding spiral that measured out to
 *    leads of 150–230 m mid-race on the worst of the 24 seeds — over a third
 *    of the whole 672 m race. Closing that from a ~7% speed edge in the
 *    remaining distance was never going to happen. Raised the ramp and
 *    ceiling until it could: `CATCHUP_BEHIND` from 0.0018 to 0.007 and
 *    `SWING_BEHIND` from 0.16 to 0.7 (reached at 100 m behind rather than
 *    89 m, but now worth far more once there — drag-limited terminal 42
 *    m/s instead of a clamp-truncated 33).
 *
 * Together these take the 24-seed spread from 16.1–135.6 m (mean 63.9, the
 * figure the old field-average assertion actually checked) to 4.2–86.0 m
 * (mean 38.3) — every one of the 24 now inside a real, individually-checked
 * ceiling, not just the average. A wider, non-canonical sweep of 500 seeds
 * came back 2.4–113.7 m with only one seed over 110 m, so this is a thinned
 * tail rather than a hard analytic bound — which is exactly why the check
 * asserts the 24 fixed seeds individually rather than trusting a formula.
 *
 * The point is still a close race that a six-year-old can *win*, not a fair
 * one — and, now, not a runaway one either.
 */
const CATCHUP_BEHIND = 0.007;
const CATCHUP_AHEAD = 0.006;
const SWING_BEHIND = 0.7;
const SWING_AHEAD = 0.26;

/**
 * A rival's thrust multiplier, from how far the player is ahead of them.
 *
 * `lead` is `player.travelled - rival.travelled`, so positive means the rival
 * is behind. Lives here with the physics it multiplies rather than in
 * `RailRace.ts`, so the balance checker races the same rubber band the browser
 * does instead of a re-implementation of it.
 */
export function rivalBand(lead: number): number {
  return lead >= 0
    ? 1 + Math.min(lead * CATCHUP_BEHIND, SWING_BEHIND)
    : 1 - Math.min(-lead * CATCHUP_AHEAD, SWING_AHEAD);
}

/**
 * How often a rival simply forgets to hold, per second, at zero skill — and
 * how long they forget for.
 *
 * The family wanted the rivals *visibly* fallible, and a missed duck bar is a
 * poor way to show that: it is over in a frame, and what a child sees is a
 * wobble, not a decision. A lapse is a beat of coasting on open track for no
 * reason at all, and from 30 m/s it sheds speed fast enough to see from the
 * next lane — the rival visibly sags back, then picks up again. That is what
 * "not playing very well" looks like to a six-year-old watching.
 *
 * Only ever entered on open track: the hazard tests come first in
 * {@link rivalWantsHold}, so a lapse can never accidentally *save* a rival from
 * a bar it would otherwise have bonked.
 */
const LAPSE_PER_SECOND = 0.55;
const LAPSE_MIN = 0.45;
const LAPSE_MAX = 1.15;

/**
 * The rivals' one decision, and their entire personality.
 *
 * `skill` is 0..1. A low-skill rival misses bars more often, enters black
 * stretches late, and loses concentration on the straight more often; none of
 * them is ever perfect, because a child has to be able to win, and none of them
 * is ever hopeless, because a race you cannot lose is not a race either.
 */
export function rivalWantsHold(rider: Rider, dt: number, skill: number, rng: Rng): boolean {
  if (rider.wobble > WOBBLE_LOCKOUT) return false;
  // Judgement of each bar is drawn once, as it comes up, so a rival's mistakes
  // are decided in advance rather than flickering frame to frame.
  if (barIsHere(rider, dt, 0.8)) return rng.chance(1 - skill) ? true : false;
  if (zoneIsHere(rider, 1.5 * skill, 0)) return false;

  // Open track from here down, which is the only place a lapse may start.
  if (rider.lapse > 0) {
    rider.lapse = Math.max(0, rider.lapse - dt);
    return false;
  }
  if (rng.chance(LAPSE_PER_SECOND * (1 - skill) * dt)) {
    rider.lapse = rng.range(LAPSE_MIN, LAPSE_MAX);
    rider.lapses += 1;
    return false;
  }
  return true;
}

// ----------------------------------------------------------- the headless race

/** The four ways `scripts/check-rail-race.mts` plays the game. */
export type Strategy = 'alwaysHold' | 'neverHold' | 'perfect' | 'sloppy' | 'barsOnly';

function strategyWantsHold(strategy: Strategy, rider: Rider, dt: number, rng: Rng): boolean {
  switch (strategy) {
    case 'alwaysHold':
      return true;
    case 'neverHold':
      return false;
    case 'perfect':
      // Release for exactly as long as the rule requires, and not a metre more.
      if (barIsHere(rider, dt, 0.05)) return false;
      if (zoneIsHere(rider, 0.4, 0)) return false;
      return true;
    case 'sloppy':
      // Remembers the bar about two thirds of the time, and is late off the
      // button for the black stretches.
      if (barIsHere(rider, dt, 0.05)) return rng.chance(0.35);
      if (zoneIsHere(rider, -2.5, 0)) return false;
      return true;
    case 'barsOnly':
      // Plays the black stretches perfectly and the duck bars not at all.
      //
      // This exists to isolate one number: what a bonk actually costs. Against
      // `perfect` — which differs from it *only* in letting go for the bars —
      // the gap is the duck-bar mechanic's entire contribution to the race, with
      // the spark drag subtracted out on both sides. Without it the checker was
      // measuring the two hazards added together and could not tell which one
      // was carrying the margin; it turned out the bars were carrying none of
      // it. See `scripts/check-rail-race.mts`.
      if (zoneIsHere(rider, 0.4, 0)) return false;
      return true;
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
 * made in one of two places.
 */
export function simulateRailRace(strategy: Strategy): RaceOutcome {
  const route = RAIL_RACE_PLAN.route;
  const rider = createRider(0);
  const rng = new Rng(0x1a5e51);
  const dt = 1 / 60;
  let seconds = 0;

  // A generous ceiling: nothing that finishes is anywhere near it, and a rider
  // that somehow cannot finish should end the check rather than the process.
  while (!rider.finished && seconds < 400) {
    stepRider(route, rider, strategyWantsHold(strategy, rider, dt, rng), dt);
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
  /** Mistakes the three rivals made between them, for the checker to report. */
  readonly rivalBonks: number;
  readonly rivalLapses: number;
}

/**
 * The **whole field** — the player and all three rivals — raced headlessly.
 *
 * The single-rider {@link simulateRailRace} above answers "is letting go worth
 * it?". This answers the other question the family actually asked on 1 August
 * 2026: *can she win?* It drives the very functions the browser drives —
 * {@link rivalWantsHold} for the rivals, {@link rivalBand} for the rubber band,
 * {@link stepRider} for everybody — so rival tuning cannot pass this check by
 * being right only in a model of the game.
 *
 * Each rival gets its own `Rng` stream, keyed off the seed and its lane, so one
 * rival's luck cannot shift another's: without that, changing a single skill
 * value re-rolls every rival's whole race and the check reads as noise.
 */
export function simulateField(playerStrategy: Strategy, seed: number): FieldOutcome {
  const route = RAIL_RACE_PLAN.route;
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
      const wantHold = isPlayer
        ? strategyWantsHold(playerStrategy, rider, dt, rng)
        : rivalWantsHold(rider, dt, RIVAL_SKILL[rider.lane] ?? 0.7, rng);
      const band = isPlayer ? 1 : rivalBand(player.travelled - rider.travelled);
      if (!stepRider(route, rider, wantHold, dt, band).finishedNow) continue;
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
    rivalLapses: rivals.reduce((sum, rider) => sum + rider.lapses, 0),
  };
}
