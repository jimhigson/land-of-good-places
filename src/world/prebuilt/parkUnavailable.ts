/**
 * **The park a child asked for cannot be had** — thrown by the client when a
 * seed has no prebuilt park file it can use (`docs/design/PREBUILT-PARKS.md`).
 *
 * Jim, 24 September 2026: *"seeds not downloadable is an error."* The game as
 * delivered carries no solver, so there is no fallback: a seed outside the
 * supported set, a missing file, a file from another build or a failed
 * download all end here, and `ui/ParkUnavailableScreen.ts` says so on screen,
 * naming the seed and the reason.
 */
export class ParkUnavailable extends Error {
  readonly seed: number;
  readonly reason: string;

  constructor(seed: number, reason: string) {
    super(`Park ${seed} is not available: ${reason}`);
    this.name = 'ParkUnavailable';
    this.seed = seed;
    this.reason = reason;
  }
}

/** A `ParkUnavailable`, wherever in a `cause` chain it was wrapped. */
export function parkUnavailableIn(error: unknown): ParkUnavailable | null {
  for (let e: unknown = error, depth = 0; e && depth < 8; depth += 1) {
    if (e instanceof ParkUnavailable) return e;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}
