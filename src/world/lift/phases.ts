import { LIFT_BOARD_SECONDS } from '../../core/constants';

/**
 * **The one lift, as a state machine.**
 *
 * There are two portal lifts in the park — `hotel/HotelLift.ts` and
 * `building/liftRide.ts` — and they are the *same* lift with two sets of
 * stops. Both were written to ARCHITECTURE-DECISIONS Decision 3's two-method
 * seam, and both grew the same six phases, the same 0.7 s of doors opening and
 * the same half-second glide, independently and in that order.
 *
 * That is the duplication that produced issue #450. `HotelLift` had a
 * {@link doorOpenness} and the castle's `LiftRide` did not, so the hotel drew
 * doors and the castle drew nothing: **a child stepped into the castle's lift
 * and floated in open air while the world changed underneath her.** The
 * castle's lift logic was correct the whole time — what was missing was the
 * half of the pair the hotel happened to have.
 *
 * So the phases, the timings, and the one function that turns a phase into
 * something an alcove can draw live here, once, and both lifts import them.
 * A phase added to this union is a compile error in whichever lift has not
 * handled it, which is the property the two private copies did not have.
 */
export type LiftPhase =
  /** Nowhere near it. */
  | 'away'
  /** At the doors, nothing asked for yet: the call button is on screen. */
  | 'waiting'
  /** Called; the doors are opening. */
  | 'coming'
  /** In the car, choosing a floor. */
  | 'aboard'
  /** In the car, "travelling" — the indicator counts, the world swaps. */
  | 'going'
  /** Arrived; stepping out into the room. */
  | 'alighting';

/**
 * Seconds the doors take to open after a call. **Never make a child wait** —
 * GAME_DESIGN.md, "Riding the lift". Nothing is being fetched; this is the
 * theatre of a lift arriving, and it is deliberately shorter than a real one.
 */
export const LIFT_COMING_SECONDS = 0.7;

/**
 * Seconds the character takes to glide into the car, or back out of it.
 *
 * The same `LIFT_BOARD_SECONDS` the castle already used; the hotel had its own
 * `STEP_SECONDS = 0.5` beside it, which is the same number written twice.
 */
export const LIFT_STEP_SECONDS = LIFT_BOARD_SECONDS;

/**
 * **How far apart the door leaves are** — 0 shut, 1 wide open, eased, so they
 * slide rather than snap.
 *
 * Deliberately a *number* derived from the phase rather than the phase itself.
 * An alcove needs one fact — how far apart the leaves are — and handing it the
 * phase would put a copy of this switch statement in every building that has a
 * lift, where it would go stale the next time a phase is added.
 *
 * Open while she is **in** the car choosing, and while she is stepping **out**
 * of it; shut the rest of the time — including all of `going`, because a lift
 * travels with its doors closed and that is the whole of why she is safely
 * inside something while the world changes. `coming` eases them open over its
 * last moments so the doors are already parting as she is drawn in, which is
 * what stops the glide looking like she walks through them.
 *
 * `phaseT` is seconds since the phase began.
 */
export function liftDoorOpenness(phase: LiftPhase, phaseT: number): number {
  switch (phase) {
    case 'aboard':
      return 1;
    case 'alighting':
      // Closing again behind her as she steps out.
      return 1 - smoothstep01(phaseT / LIFT_STEP_SECONDS);
    case 'coming':
      return smoothstep01(
        (phaseT - LIFT_COMING_SECONDS * 0.45) / (LIFT_COMING_SECONDS * 0.55),
      );
    default:
      return 0;
  }
}

/** Ease in and out, clamped to 0…1. */
export function smoothstep01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
