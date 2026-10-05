

/**
 * How far a pylon keeps off the paved network.
 *
 * The Sky Cruiser is the **owner** of this figure — `slide/supports.ts` calls it
 * "the coaster's pylon figure" in a comment and then writes 2.8 out again by
 * hand, which is the repo's most common bug in miniature (CLAUDE.md, *two
 * definitions of one thing*). Exported so the slide can stop keeping a copy.
 */
export const PATH_CLEARANCE = 2.8;

export interface CruiserPylon {
  readonly x: number;
  readonly z: number;
  /** Terrain height at its foot. */
  readonly ground: number;
  /** Height of the rail above that foot. */
  readonly height: number;
  /** Metres along the route it carries. */
  readonly at: number;
}
