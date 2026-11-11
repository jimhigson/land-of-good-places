import { PLAYER_LONGEST_STEP, PLAYER_MAX_SPEED, PLAYER_SPRINT_MULTIPLIER } from '../core/constants';

/**
 * **Tap to go: a long journey is a dash.** The one owner of how fast a tapped
 * (or map-picked, or chip-asked) walk goes, and of every number that decides it.
 *
 * Jim, 11 November 2026: *"if selecting a place on the map more than a short
 * distance away, the player should run there at super-speed (faster than when
 * holding shift) to get there quickly. The speed they run should be normal for
 * journeys of less than 1.5 seconds, and ramp up linearly to provide a max
 * travel time of about 4s."*
 *
 * ## The curve
 *
 * Let `v` be the walk ({@link PLAYER_MAX_SPEED}, 7.4 m/s) and `L` the length of
 * the route `NavGrid` planned, in metres. The journey is judged once, when it
 * is planned, on what it *would* take at a walk: `L / v`.
 *
 * ```
 *            ⎧ v                                   L ≤ v·T₀      (a walk)
 * speed(L) = ⎨
 *            ⎩ v·(1 − T₀/T∞) + L/T∞               L > v·T₀      (a dash)
 *
 * T₀ = DASH_WALK_SECONDS = 1.5 s     T∞ = DASH_MAX_SECONDS = 4 s
 * ```
 *
 * - **Normal for anything under 1.5 s.** Up to `v·T₀` = 11.1 m nothing changes:
 *   same speed, same easing into the marker, as before this file existed.
 * - **Linear past it.** The speed is a straight line in the journey's length,
 *   which is the "ramp up linearly" Jim asked for.
 * - **Continuous at the threshold.** At `L = v·T₀` the dash branch is
 *   `v − v·T₀/T∞ + v·T₀/T∞ = v` exactly, so there is no step in speed between a
 *   journey just under the line and one just over it.
 * - **Travel time never goes down as the journey gets longer.**
 *   `t(L) = L / (a + L/T∞)` with `a = v·(1 − T₀/T∞) = 4.63 m/s > 0`, whose
 *   derivative `a / (a + L/T∞)²` is positive everywhere — a further place is
 *   never reached sooner than a nearer one.
 * - **Capped at 4 s.** `t(L)` rises towards `T∞` and never reaches it: the
 *   longest journey in the park takes *about* four seconds and no journey,
 *   however long, takes four. Measured on the park (`check:tap-dash`) the
 *   longest real routes are 100-150 m, which the cruise covers in 3.4-3.6 s;
 *   the run-up and the braking into the marker add the rest.
 * - **At or above a sprint well past the line.** The dash reaches sprint
 *   speed (× {@link PLAYER_SPRINT_MULTIPLIER}, 11.1 m/s) at `L` = 25.9 m — a
 *   journey that would have been 3.5 s at a walk — and is faster than a sprint
 *   for everything further. A double-tap "run there" still sprints, so a short
 *   double-tapped journey is never slower than it was.
 *
 * | journey at a walk | route | dash speed | travel |
 * |---|---|---|---|
 * | ≤ 1.5 s | ≤ 11.1 m | 7.4 m/s (walk) | ≤ 1.5 s |
 * | 3.5 s | 25.9 m | 11.1 m/s (sprint) | 2.33 s |
 * | 6.8 s | 50 m | 17.1 m/s | 2.92 s |
 * | 13.5 s | 100 m | 29.6 m/s | 3.38 s |
 * | 20.3 s | 150 m | 42.1 m/s | 3.56 s |
 *
 * ## What it does not change
 *
 * Nothing about *where* she goes: the route is `NavGrid`'s, unchanged, and is
 * walked by the same seek. The dash is a multiplier on the speed `Player`
 * already has ({@link Player.setTravelBoost}), and the frame is split into
 * short strides ({@link dashSubsteps}) so that every stride goes through the
 * same `Player.update` — the same collision sub-stepping, ground sampling,
 * step-up rule and auto-hop — that a walk does, never longer than a sprint's
 * worst frame ({@link PLAYER_LONGEST_STEP}). See `Game.tick`.
 */

/** A journey this long or shorter, at a walk, is walked. Jim's number. */
export const DASH_WALK_SECONDS = 1.5;

/**
 * The time no journey reaches: the asymptote of the curve. Jim's "max travel
 * time of about 4s".
 */
export const DASH_MAX_SECONDS = 4;

/**
 * How far out the dash starts easing off, in seconds of walking — so the last
 * {@link DASH_BRAKE_SECONDS} × walk speed (2.2 m) of every dash is the ordinary
 * walk into the marker, and every metre further the boost may be at most
 * `remaining / (v · this)`. An exponential brake: from a cruise of `B`× the walk
 * it costs `this · ln(B)` seconds, 0.5 s from the fastest dash in the park.
 *
 * 2.2 m is deliberately `TapNavigator`'s own slow radius, so the dash hands
 * over to the walk's own easing exactly where that easing starts and arrival is
 * the arrival it always was: the same speed past the same stand points,
 * doormats and trigger bands.
 */
export const DASH_BRAKE_SECONDS = 0.3;

/**
 * The longest single stride of a dash, in metres.
 *
 * A frame of dashing is split into strides no longer than this
 * ({@link dashSubsteps}), and each stride is one ordinary `Player.update`. Half
 * a metre because it is shorter than `TapNavigator`'s arrive and corner radii
 * (0.55 m, 0.7 m): a stride can never carry her past a waypoint without the
 * navigator seeing her inside it, so she turns every corner the route has
 * rather than overshooting one and doubling back. It is also well under
 * {@link PLAYER_LONGEST_STEP} (0.925 m), the step every collision rule in the
 * game is already sized for.
 */
export const DASH_STRIDE = 0.5;

/**
 * Strides in one frame, at most. At the clamped frame (1/12 s) the fastest
 * dash in the park covers 3.5 m — seven strides. Sixteen covers a 200 m route
 * at the clamp; past that the stride grows rather than the work, and the
 * check asserts it never grows past {@link PLAYER_LONGEST_STEP}.
 */
export const DASH_MAX_STRIDES = 16;

/**
 * The fastest the legs ever cycle, as a ground speed in m/s: 1.35 × a sprint,
 * about 6.3 strides a second. Past it she covers more ground per stride rather
 * than pedalling faster — at 42 m/s a stride-locked cycle would be 17 Hz, a
 * strobe at 60 fps rather than a run.
 */
export const DASH_CADENCE_SPEED = PLAYER_MAX_SPEED * PLAYER_SPRINT_MULTIPLIER * 1.35;

/** Distance at which a journey starts being a dash, in metres: 11.1 m. */
export const DASH_THRESHOLD_METRES = PLAYER_MAX_SPEED * DASH_WALK_SECONDS;

/** The cruising speed for a journey of `routeLength` metres. See the table above. */
export function dashCruiseSpeed(routeLength: number): number {
  if (!(routeLength > DASH_THRESHOLD_METRES)) return PLAYER_MAX_SPEED;
  return PLAYER_MAX_SPEED * (1 - DASH_WALK_SECONDS / DASH_MAX_SECONDS) + routeLength / DASH_MAX_SECONDS;
}

/** {@link dashCruiseSpeed} as a multiple of the walk — what `Player` is handed. */
export function dashBoost(routeLength: number): number {
  return dashCruiseSpeed(routeLength) / PLAYER_MAX_SPEED;
}

/** The nominal travel time of a journey, at its cruise: `L / speed(L)`. */
export function dashSeconds(routeLength: number): number {
  return routeLength / dashCruiseSpeed(routeLength);
}

/**
 * The boost to run at right now, with `remaining` metres of route still to go:
 * the journey's cruise, eased down to the walk over the last stretch. See
 * {@link DASH_BRAKE_SECONDS}.
 */
export function dashBoostNow(cruiseBoost: number, remaining: number): number {
  const brake = remaining / (PLAYER_MAX_SPEED * DASH_BRAKE_SECONDS);
  return Math.max(1, Math.min(cruiseBoost, brake));
}

/**
 * How many strides a frame of `dt` seconds at `speed` m/s is split into. One —
 * the frame exactly as it has always been run — for anything that fits a
 * single {@link DASH_STRIDE}. `Game.tick` only asks while a dash is running;
 * a walk or a sprint is never split, whatever the frame rate.
 */
export function dashSubsteps(speed: number, dt: number): number {
  const travel = speed * dt;
  if (!(travel > DASH_STRIDE)) return 1;
  return Math.min(DASH_MAX_STRIDES, Math.ceil(travel / DASH_STRIDE));
}
