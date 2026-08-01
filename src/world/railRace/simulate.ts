import { clamp } from '../../core/mathUtils';
import { RAIL_RACE_PLAN } from './plan';
import { planHazards, type HazardSchedule } from './hazards';
import type { RailRaceRoute } from './route';

/**
 * **The race, as arithmetic.** No scene, no camera, no DOM.
 *
 * Split out from `RailRace.ts` on purpose: this is the half that decides who
 * wins, and it is the half that shipped broken last time. Keeping it a pure
 * module means `scripts/check-rail-race.mts` can run whole races on every
 * build and assert that letting go still beats holding — against *this* code,
 * not against a re-implementation of it that could agree with a model while
 * disagreeing with the game.
 *
 * ## The tuning, and where it came from
 *
 * Inherited from the retired 2D rail racer, which had already been tuned
 * against a simulation of its whole course for one specific property:
 * **letting go must cost less than the drag it saves**, or holding the button
 * down for a minute is the winning strategy and the game has nothing to
 * teach. That is exactly the property the in-park race lost once (the old
 * duck-bar wobble not gating thrust — see git history for that fault), and
 * exactly the property the checker still asserts, now purely against
 * {@link SPARK_DRAG}.
 *
 * **1 August 2026 — the duck bar retired.** This file used to carry two
 * hazards: a spark zone (drag while holding through a black stretch) and a
 * duck bar (a bonk — lost speed and a thrust lockout — for holding through a
 * single point). Jim's own verdict, after a full day building the bar's
 * trestle-snapped support and hazard-tape asset: "remove the head bump from
 * the game's dynamics and replace entirely with more frequent black
 * sections on the track." The bonk mechanic (`WOBBLE_SECONDS`,
 * `BONK_SPEED_FACTOR`, `WOBBLE_LOCKOUT`, `Rider.wobble`/`barCursor`/`bonks`,
 * the `barIsHere` lookahead) is gone with it; the spark-zone mechanic below is
 * untouched. See `hazards.ts`'s header for the retuned zone schedule that
 * replaces the bars' share of the pacing.
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
 *
 * **This is now the ride's entire cost of a mistake**, not one of two — see
 * this file's own header.
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

/** The hazards, laid out once for the whole race. */
export const HAZARDS: HazardSchedule = planHazards(RAIL_RACE_PLAN.route.length, RACE_LAPS);

/** The finish line, in metres travelled. */
export const RACE_DISTANCE = RAIL_RACE_PLAN.route.length * RACE_LAPS;

export interface Rider {
  readonly lane: number;
  /** Metres run since the lights went out. Only ever increases. */
  travelled: number;
  speed: number;
  holding: boolean;
  /** True while the rail is sparking under this rider. */
  sparking: boolean;
  /** How many black stretches this rider is already past. */
  zoneCursor: number;
  /**
   * How many times this rider has started sparking — a spark that runs
   * continuously through one whole zone still counts once. The "mistake"
   * count now that the duck bar (and its own discrete `bonks`) is gone: see
   * this file's own header.
   */
  sparkEntries: number;
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
    sparking: false,
    zoneCursor: 0,
    sparkEntries: 0,
    sparkSeconds: 0,
    finished: false,
    place: 0,
    finishTime: 0,
  };
}

/** What happened to a rider in one step, for the scene and the HUD to react to. */
export interface StepEvents {
  /** Crossed the finish line this step. */
  readonly finishedNow: boolean;
  /** Started a new lap this step, 1-based, or 0. */
  readonly lap: number;
}

const NOTHING: StepEvents = { finishedNow: false, lap: 0 };

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

  rider.holding = wantHold;

  // --- is the rail black under us? ------------------------------------------
  const stretches = HAZARDS.sparkStretches;
  while (rider.zoneCursor < stretches.length && (stretches[rider.zoneCursor]?.to ?? 0) < rider.travelled) {
    rider.zoneCursor += 1;
  }
  const stretch = stretches[rider.zoneCursor];
  const inZone = stretch !== undefined && rider.travelled >= stretch.from;
  const wasSparking = rider.sparking;
  rider.sparking = inZone && rider.holding;
  if (rider.sparking) {
    rider.sparkSeconds += dt;
    if (!wasSparking) rider.sparkEntries += 1;
  }

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

  // --- lap and finish --------------------------------------------------------
  const lapBefore = Math.floor(before / route.length);
  const lapNow = Math.floor(rider.travelled / route.length);
  const lap = lapNow !== lapBefore && lapNow < RACE_LAPS ? lapNow + 1 : 0;

  let finishedNow = false;
  if (rider.travelled >= RACE_DISTANCE) {
    rider.finished = true;
    finishedNow = true;
  }

  return { finishedNow, lap };
}

// ------------------------------------------------------------------ the brains

/** Is a black stretch under us, or about to be? */
function zoneIsHere(rider: Rider, lead: number, trail: number): boolean {
  const stretch = HAZARDS.sparkStretches[rider.zoneCursor];
  if (stretch === undefined) return false;
  return rider.travelled >= stretch.from - lead && rider.travelled <= stretch.to + trail;
}

/**
 * The rivals' one decision, and their entire personality.
 *
 * `skill` is 0..1. A low-skill rival enters black stretches late; none of
 * them is ever perfect, because a child has to be able to win, and none of
 * them is ever hopeless, because a race you cannot lose is not a race either.
 *
 * No longer takes `dt`/`rng` — those fed the duck bar's per-bar judgement
 * draw (a coin flip on whether a rival remembered a given bar), which went
 * with the mechanic. The zone lead below is deterministic in `skill` alone.
 */
export function rivalWantsHold(rider: Rider, skill: number): boolean {
  if (zoneIsHere(rider, 1.5 * skill, 0)) return false;
  return true;
}

// ----------------------------------------------------------- the headless race

/** The ways `scripts/check-rail-race.mts` plays the game. */
export type Strategy = 'alwaysHold' | 'neverHold' | 'perfect' | 'sloppy';

function strategyWantsHold(strategy: Strategy, rider: Rider): boolean {
  switch (strategy) {
    case 'alwaysHold':
      return true;
    case 'neverHold':
      return false;
    case 'perfect':
      // Release for exactly as long as the rule requires, and not a metre more.
      if (zoneIsHere(rider, 0.4, 0)) return false;
      return true;
    case 'sloppy':
      // Late off the button for the black stretches — reacts a good way into
      // a zone rather than ahead of it, but reacts every time. A per-frame
      // "sometimes forgets" coin flip was tried here and dropped: a zone
      // (unlike the old duck bar) is wide enough that flipping every step
      // inside the window produced dozens of flickering on/off sparks per
      // zone rather than one clean mistake, which is a worse model of "late"
      // than simply being late.
      if (zoneIsHere(rider, -14, 0)) return false;
      return true;
  }
}

export interface RaceOutcome {
  readonly seconds: number;
  /** How many times sparking started — see `Rider.sparkEntries`. */
  readonly sparkEntries: number;
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
  const dt = 1 / 60;
  let seconds = 0;

  // A generous ceiling: nothing that finishes is anywhere near it, and a rider
  // that somehow cannot finish should end the check rather than the process.
  while (!rider.finished && seconds < 400) {
    stepRider(route, rider, strategyWantsHold(strategy, rider), dt);
    seconds += dt;
  }

  return { seconds, sparkEntries: rider.sparkEntries, sparkSeconds: rider.sparkSeconds };
}
