import { PALETTE } from '../../core/palette';

/**
 * **Where the park's two stations want to be, before any loop exists.**
 *
 * A seed is a bearing from the middle of the park, not a position: the placer
 * (`train/plan.ts`) turns it into a target distance along whatever loop was
 * solved, then slides along that loop to find ground the platform and its
 * approach actually fit on.
 *
 * Lives in its own leaf module because **two callers need the bearings and only
 * one of them may import `plan.ts`.** `train/route.ts`'s `satisfies` backstop
 * has to ask whether a candidate loop leaves each station somewhere that clears
 * the loop's own chosen crossing — the same seeds, asked before the plan those
 * seeds belong to exists, and `plan.ts` imports `route.ts`, so the question
 * cannot be asked in that direction. A second copy of the bearings would be two
 * definitions of where a station goes, kept in step by hand.
 */
export interface StationSeed {
  readonly name: string;
  readonly accent: number;
  readonly bearingX: number;
  readonly bearingZ: number;
}

export const STATION_SEEDS: readonly StationSeed[] = [
  { name: 'Sunny Side', accent: PALETTE.markerLemon, bearingX: 1, bearingZ: 0 },
  { name: 'Bluebell Halt', accent: PALETTE.markerSky, bearingX: -1, bearingZ: 0 },
];

/**
 * How far out along its bearing a station seed's ideal point sits, metres —
 * the radius the target distance is taken at, before the placer's own
 * `STATION_SEARCH_WINDOW` slide either way from it.
 */
export const STATION_SEED_RADIUS = 60;
