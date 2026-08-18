import type { LevelCrossing } from './crossings';
import { BRIDGE_RISE, FENCE_OFFSET } from './clearance';
import { ENTRANCE_RAMP } from '../building/layout';

/**
 * The bridge's own footprint in the ground plane (issue #116, Decision 8) —
 * every number `world/train/bridges.ts` needs to lay a deck and two ramps
 * out, and nothing about *building* one: no three.js, no terrain sample, no
 * `World`. Split out for one reason — `Scenery.ts` and `LampPosts.ts` need
 * this same footprint **before** any bridge exists, to keep a tree or a lamp
 * from growing through a ramp that has not been built yet (see
 * `train/bridgeKeepout.ts`), and they already import `train/plan.ts`'s
 * `distanceToRailCorridor` the same way. `bridges.ts` imports every constant
 * and the planner below rather than restating them — the exact "two
 * definitions of one thing" disease CLAUDE.md tracks by name, and the reason
 * a scenery-collision bug (a lamp inside a live ramp, found by
 * `test/procgen/invariants.ts`'s `everyBridgeIsWalkableAndReachable`) is what
 * finally split this file out rather than a ramp-geometry change.
 */

/**
 * Bridge ramps climb at the same steepness the park's own front steps do —
 * derived from `ENTRANCE_RAMP`, never a separately chosen number, so a
 * retune of the entrance moves the bridges with it rather than leaving two
 * "how steep is a ramp here" answers to drift apart.
 */
export const BRIDGE_RAMP_GRADIENT =
  Math.abs(ENTRANCE_RAMP.yTo - ENTRANCE_RAMP.yFrom) / Math.abs(ENTRANCE_RAMP.to - ENTRANCE_RAMP.from);

/**
 * Half-length of the deck along the crossing direction — has to clear both
 * fence lines (each {@link FENCE_OFFSET} out from the rail centre) with a
 * little margin so the deck's own edge does not sit flush on a fence post.
 */
export const DECK_HALF_LENGTH = FENCE_OFFSET + 1.2;

/**
 * The steepest a ramp may ever be forced to, when two crossings land close
 * enough together that {@link BRIDGE_RAMP_GRADIENT} would overlap them —
 * see {@link planBridgeFootprints}'s `rampRunCap`.
 *
 * Derived, not chosen: `NavGrid` links two lattice nodes as one walking
 * level whenever they are within `BUILDING_STEP_UP` (0.62 m) of each other,
 * sampled every `NavGrid`'s own 0.5 m cell — so a slope stays walkable up to
 * `BUILDING_STEP_UP / CELL` ≈ 1.24. Capping here at half that leaves a full
 * doubling of margin before a cramped bridge could ever stop reading as one
 * connected level, while still being visibly steeper than the ordinary
 * grade — exactly the "cramped, so it's a steep hump" a child would expect
 * two close bridges to look like.
 */
export const MAX_RAMP_GRADIENT = 0.6;

/** Buffer, past the deck itself, a capped ramp always keeps clear of the
 * next crossing's own corridor — never flush against it. */
export const RAMP_CLEARANCE = 2.0;

/**
 * Extra width, beyond a crossing's own self-measured `halfGap`, that the
 * deck and every ramp tread carry before a guard rail stands.
 *
 * `halfGap` is tuned for exactly one job — sizing the *old* level crossing's
 * fence gap so an oblique path's own waypoint samples never straddled a
 * compartment wall (its own comment: "a fixed gap strands the path's own
 * waypoint samples"). That gap had nothing at all in this direction to
 * clip against. A bridge does — its own guard rails — so a path sample that
 * used to graze `halfGap` with metres to spare in every other direction now
 * grazes the rail meant to stop a child falling off the side. A stride's
 * worth of slack, the same margin `check-park.mts` used to give a route
 * meeting a crossing's own fence gap before bridges made that escape
 * unnecessary.
 */
export const ACROSS_MARGIN = 2.0;

export interface BridgeFootprint {
  readonly cx: number;
  readonly cz: number;
  readonly dirX: number;
  readonly dirZ: number;
  readonly acrossX: number;
  readonly acrossZ: number;
  readonly halfAcross: number;
  readonly rampRun: number;
  /** True over the deck or either ramp. */
  covers(x: number, z: number): boolean;
}

/**
 * One footprint per crossing, in the order `crossings` gave them — the
 * ground-plane rectangle every bridge occupies, deck and both ramps, before
 * a single mesh or collider exists.
 */
export function planBridgeFootprints(crossings: readonly LevelCrossing[]): BridgeFootprint[] {
  return crossings.map((crossing) => {
    const cx = crossing.x;
    const cz = crossing.z;
    const dirX = crossing.pathDirX;
    const dirZ = crossing.pathDirZ;
    const acrossX = -dirZ;
    const acrossZ = dirX;
    const halfAcross = crossing.halfGap + ACROSS_MARGIN;

    // Capped by how close the *next* crossing is — see `bridges.ts`'s own
    // note on `rampRunCap` for why (two crossings closer together than the
    // ordinary grade's own ramp length would otherwise overlap).
    let nearestOtherCrossing = Infinity;
    for (const other of crossings) {
      if (other === crossing) continue;
      nearestOtherCrossing = Math.min(nearestOtherCrossing, Math.hypot(other.x - cx, other.z - cz));
    }
    const rampRunCap = Math.max(
      BRIDGE_RISE / MAX_RAMP_GRADIENT,
      nearestOtherCrossing / 2 - DECK_HALF_LENGTH - RAMP_CLEARANCE,
    );
    const rampRun = Math.min(BRIDGE_RISE / BRIDGE_RAMP_GRADIENT, rampRunCap);

    return {
      cx,
      cz,
      dirX,
      dirZ,
      acrossX,
      acrossZ,
      halfAcross,
      rampRun,
      covers: (x: number, z: number): boolean => {
        const dx = x - cx;
        const dz = z - cz;
        const along = dx * dirX + dz * dirZ;
        const across = dx * acrossX + dz * acrossZ;
        if (Math.abs(across) > halfAcross) return false;
        return Math.abs(along) <= DECK_HALF_LENGTH + rampRun;
      },
    };
  });
}
