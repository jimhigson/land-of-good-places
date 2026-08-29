/**
 * **What counts as a tap.** The one owner of that question, for every surface
 * in the game a finger can land on.
 *
 * There used to be three answers. `PointerControls` (tap-to-walk in the park)
 * asked for a `pointerdown`/`pointerup` pair within 18 CSS px and 600 ms; the
 * park map's own canvas asked for a pair within 8 px and no time limit at all;
 * and the park map's dimmed backdrop asked for nothing whatsoever — it closed
 * the map on `pointerdown`, before the finger had lifted. That third answer is
 * the bug Jim reported on 29 August 2026: *"Deployed map isn't zoomable by
 * pinching. As soon as I touch the screen the map closes. Should be a definite
 * tap to close."* A finger that came down in the margin around the map card and
 * then moved — the beginning of a pinch, or of a pan, or simply a six-year-old
 * steadying her thumb — dismissed the map instantly.
 *
 * Two definitions of one thing kept in step by hand is this repo's most-cited
 * bug class, so there is now one: the numbers below, and the three predicates
 * that read them. A surface that wants "a definite tap" imports these rather
 * than picking its own slop.
 */

/**
 * How far a pointer may travel and still count as a tap, in CSS pixels.
 *
 * Generous, because it has to be: a six-year-old's tap on a phone routinely
 * travels ten pixels, and the cost of being too strict is a tap that silently
 * does nothing.
 */
export const TAP_MAX_DRIFT_PX = 18;

/** Longer than this and it was a considered press, not a tap. */
export const TAP_MAX_MILLISECONDS = 600;

/** Where and when a finger came down. */
export interface TapCandidate {
  readonly startX: number;
  readonly startY: number;
  /**
   * **`event.timeStamp`, not `performance.now()`.** Both are on the same clock,
   * but `timeStamp` is when the browser *created* the event and `now()` is when
   * our handler finally ran. In a game with a 3D park rendering behind the
   * overlay those differ by a lot: measured here on a paused map, a `pointerup`
   * dispatched 80 ms after its `pointerdown` reached the listener **2205 ms**
   * later. Timing a tap by when we got round to it turns a busy frame into "not
   * a tap", which is a six-year-old pressing the screen and nothing happening —
   * the failure mode this whole file exists to avoid.
   */
  readonly startTime: number;
}

/**
 * Records the start of a possible tap. Pass `event.timeStamp`; the default is
 * only for callers that have no event (tests, and the map's fallback when a
 * gesture is reconstructed mid-flight).
 */
export function tapCandidate(x: number, y: number, startTime = performance.now()): TapCandidate {
  return { startX: x, startY: y, startTime };
}

/**
 * True once the finger has travelled far enough that this is a drag, a pan or a
 * pinch rather than a tap. Measured from where the gesture *started*, never
 * summed per frame, so a slow drift over many small moves still disqualifies.
 */
export function tapDriftedTooFar(candidate: TapCandidate, x: number, y: number): boolean {
  return Math.hypot(x - candidate.startX, y - candidate.startY) > TAP_MAX_DRIFT_PX;
}

/**
 * True when lifting here, now, completes a definite tap: still within
 * {@link TAP_MAX_DRIFT_PX} of where it began, and inside
 * {@link TAP_MAX_MILLISECONDS}.
 */
export function completesTap(
  candidate: TapCandidate,
  x: number,
  y: number,
  now = performance.now(),
): boolean {
  // `now` should be the lifting event's own `timeStamp` — see `startTime`.
  if (tapDriftedTooFar(candidate, x, y)) return false;
  return now - candidate.startTime <= TAP_MAX_MILLISECONDS;
}
