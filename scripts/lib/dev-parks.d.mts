/** See `dev-parks.mjs`. */
export function devParksMiddleware(
  root: string,
  version: string,
  seeds: readonly number[],
): (req: { url?: string }, res: unknown, next: () => void) => void;
