import { Rng, clamp } from '../../core/mathUtils';
import { RAIL_RACE_PLAN } from './plan';
import { planHazards, type HazardSchedule } from './hazards';
import type { RailRaceRoute } from './route';

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
 * **Three, since the 1 August 2026 physics tuning — and the change is a
 * consequence of that tuning rather than a wish of its own.** The family asked
 * for a faster *cart*, not a shorter *race*, and the two are the same knob here:
 * the new thrust and drag roughly double the cart's speed, which took a good run
 * over two laps from 52 s down to 25 s and tripped this file's own "barely a
 * ride" guard in `scripts/check-rail-race.mts`. A third lap gives that back —
 * 37 s for a good run, 65 s for a child who never lets go — so the ride lasts
 * about what it always did while feeling twice as quick, which is the whole of
 * what was actually asked for.
 *
 * Four laps was measured too, and restores the old duration more exactly (49 s
 * good, 87 s worst). It was rejected: 87 s is close to the 105 s ceiling this
 * park calls "too long for one go", and the child who would sit through it is
 * precisely the one who is not enjoying it.
 */
export const RACE_LAPS = 3;

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
  rider.speed = clamp(rider.speed + (thrust - drag - HILL_PULL * slope) * dt, MIN_SPEED, MAX_SPEED);

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
 * The rivals' one decision, and their entire personality.
 *
 * `skill` is 0..1. A low-skill rival misses bars more often and enters black
 * stretches late; none of them is ever perfect, because a child has to be able
 * to win, and none of them is ever hopeless, because a race you cannot lose is
 * not a race either.
 */
export function rivalWantsHold(rider: Rider, dt: number, skill: number, rng: Rng): boolean {
  if (rider.wobble > WOBBLE_LOCKOUT) return false;
  // Judgement of each bar is drawn once, as it comes up, so a rival's mistakes
  // are decided in advance rather than flickering frame to frame.
  if (barIsHere(rider, dt, 0.8)) return rng.chance(1 - skill) ? true : false;
  if (zoneIsHere(rider, 1.5 * skill, 0)) return false;
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
