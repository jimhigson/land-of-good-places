
/**
 * **What the crossing-site search decides** — the types the game and
 * `procgen/` share (`docs/design/PREBUILT-PARKS.md`).
 */

/**
 * **Where the park may cross its own railway — planned first, not
 * discovered afterwards** (Jim, 23 August 2026: "design the park around
 * these constraints, not try to fit the bridges into a park they were never
 * designed for").
 *
 * The old order was: plots placed, paths routed wherever they liked, then
 * `crossings.ts` *measured* where the drawn ribbons happened to meet the
 * rail, and only then — after scenery, lamps and stalls had claimed the
 * ground — did `bridgeFootprint.ts` try to fit a real ramp onto each
 * accidental crossing point. Measured result of that order (2026-08-23):
 * **zero bridges buildable on any of the three required seeds** (0/7
 * canonical, 0/7 seed 2, 0/5 seed 18), one crossing landed *inside a
 * station's fenced window* (sealed by `fence.ts`'s `stationRun` — 6
 * waypoints stranded), and several crossed so obliquely their fence gaps
 * ran to halfGap 8.5 m.
 *
 * This module inverts that order. It runs at module load — after the rail
 * (`TRAIN_PLAN`) and the plots (`PARK_LAYOUT`) are solved, before a single
 * path is drawn — and finds every point on the loop where a real bridge
 * (deck plus a genuinely walkable ramp on *both* sides) provably fits
 * against everything fixed that exists at that moment: the park boundary,
 * every placed plot, the rail's own corridor and the stations' fenced
 * windows. `paths.ts` then routes every rail-crossing leg through one of
 * these {@link CROSSING_SITES}, square to the track, so the drawn network
 * only ever meets the railway where a bridge belongs. The scatter passes
 * keep off the reserved footprints exactly as before (`bridgeKeepout.ts` —
 * whose crossings now land on these sites by construction), and
 * `ParkTrain`'s late, real, backtracking search stays the final verifier
 * rather than a search that was doomed before it started.
 *
 * **There is no level-crossing tier.** Jim's ruling, 2 Sep 2026: every
 * place a path crosses the railway is a bridge, and the ability to plan a
 * level crossing must not exist in the code. A loop that proves no bridge
 * site anywhere is an invalid park and this module fails it loudly; the
 * cure is a warp vector (`parkWarp.ts`) or, failing that, the seed simply
 * not entering the pool — never a flat crossing. (The tier this replaced
 * was measured before deletion: emptying it cost no attraction on any of
 * the sixteen pool seeds, only garden-waypoint pockets that the baked
 * warps reconnect — branch feat/park-warp-solver, measurements/.)
 *
 * Thresholds are the game's own (CLAUDE.md's procgen rule): the walkable
 * floor is `BRIDGE_RISE / MAX_RAMP_GRADIENT` — the identical floor the real
 * acceptance pass demands — never a separately-invented number.
 */
export interface CrossingSite {
  /** Metres along the solved loop. */
  readonly railDistance: number;
  /** The crossing point, on the track centre line. */
  readonly x: number;
  readonly z: number;
  /** Unit direction a path travels while crossing here — perpendicular to
   * the rail, or one of the small oblique angles tried when perpendicular
   * does not fit. Points toward the local `side = +1` of the rail
   * (`crossings.ts`'s side convention). */
  readonly dirX: number;
  readonly dirZ: number;
  /** Feasible clear reach past the deck's edge along `+dir` / `-dir`,
   * measured against boundary, plots and the rail corridor. For a bridge
   * site both are at least {@link SITE_RAMP_FLOOR}; for a level-crossing
   * site they are the (much shorter) ground-corridor reaches. */
  readonly rampReachPos: number;
  readonly rampReachNeg: number;
  /** The corridor half-width this site was proven at. For a bridge site
   * this is what the measured crossing's `halfGap` is capped to (minus the
   * probe's own half-stride of slack), so the real search's deck-width
   * floor never exceeds the width the site was actually proven feasible
   * at. {@link SITE_HALF_WIDTH} normally; {@link NARROW_HALF_WIDTH} for a
   * site that only fits a narrower deck. */
  readonly halfWidth: number;
}


export interface SolvedCrossingSites {
  readonly bridges: readonly CrossingSite[];
}
