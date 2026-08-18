import type { LevelCrossing } from './crossings';
import { BRIDGE_RISE, FENCE_OFFSET } from './clearance';
import { ENTRANCE_RAMP } from '../building/layout';
import { GARDEN_PLAY_BOUNDARY } from '../boundary';

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
  /**
   * How far the ramp reaches past the deck on the `sign = +1` side (the
   * direction `dirX`/`dirZ` point) and the `sign = -1` side, kept separate
   * rather than one shared `rampRun` — see {@link planBridgeFootprints}'s
   * own note on why a boundary-constrained crossing needs this.
   */
  readonly rampRunPos: number;
  readonly rampRunNeg: number;
  /**
   * True over the deck or either ramp. `margin`, in metres, pads both the
   * across- and along-axis tests outward — `0` (the default) is the exact
   * boundary `bridges.ts` builds `Bridge.covers()`/`deckCovers()` from, and
   * every runtime consumer (NavGrid's `bridgeCovers`, `fence.ts`'s
   * `deckSpanAt`, `poiGraph`'s height lookups) needs that exact edge, not a
   * padded one, so `covers()` stays unpadded by default rather than the
   * margin living as a second, separate boundary that could drift from the
   * first.
   *
   * `bridgeKeepout.ts` is the one caller that wants a bigger boundary: an
   * ordinary decorative wall or lamp built right up against the *exact*
   * footprint edge can still have its own half-thickness (up to 0.34 m) plus
   * `PLAYER_RADIUS` (0.62 m) reach a probe standing on the ramp, because an
   * ordinary relative-`topHeight` collider ignores the prober's actual
   * elevation entirely (issue #116 seed 5: a 0.95 m garden wall, built
   * 0.66 m from a ramp point that already read as on-bridge, still blocked a
   * probe standing 3.1 m up). Padding the *keepout* rather than the bridge's
   * own boundary keeps that one exact edge — the one everything else
   * depends on — untouched.
   */
  covers(x: number, z: number, margin?: number): boolean;
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
    let halfAcross = crossing.halfGap + ACROSS_MARGIN;

    // Capped by the park boundary too, along the deck's own width this
    // time rather than the ramp's length — the crossing `computeCrossings`
    // includes by hand for the walk in from the gate sits only a few
    // metres inside the boundary there (the gate *is* the boundary), and a
    // deck several metres wider than that on each side cannot fit no
    // matter how short its ramps are. Checked at the deck's own two
    // extremes (`along = ±DECK_HALF_LENGTH`), which is where the full
    // width actually has to stand; reduced until both sides of the deck
    // are genuinely inside, with a stride of margin so a walker at the
    // very edge is not standing on the boundary itself.
    for (const along of [-DECK_HALF_LENGTH, DECK_HALF_LENGTH]) {
      for (const sign of [1, -1] as const) {
        while (halfAcross > 1) {
          const x = cx + dirX * along + acrossX * halfAcross * sign;
          const z = cz + dirZ * along + acrossZ * halfAcross * sign;
          if (GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z) >= 1.5) break;
          halfAcross -= 0.5;
        }
      }
    }

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
    const idealRampRun = Math.min(BRIDGE_RISE / BRIDGE_RAMP_GRADIENT, rampRunCap);

    // Never run past the park's own playable edge either. A crossing's own
    // position is derived from the drawn path, well inside the boundary,
    // but nothing about that keeps an ~18 m ramp reaching *out* from it
    // inside too — a ramp near the rim genuinely reached past the edge
    // (found live, issue #116: `GARDEN_PLAY_BOUNDARY.distanceToEdge` read
    // negative partway along it). `distanceToEdge` is a signed field —
    // "a corridor of width w fits wherever distanceToEdge >= w" is its own
    // documented contract — so asking it to clear `halfAcross`, the ramp's
    // own half-width, is the direct question, not an approximation.
    //
    // Walked in 1 m steps along the *whole* ramp, not just tested at its
    // far end: `GARDEN_PLAY_BOUNDARY` is a spline, not a circle, and it can
    // dip inward partway along a ramp while the far end still clears —
    // trimming only the endpoint would leave that dip un-caught (measured
    // live: a far end that passed with room to spare, on a ramp whose
    // *middle* was already 2.35 m outside).
    //
    // Truncated **per side**, independently — the entrance gate itself sits
    // hard against the boundary on one side of the hand-added "gate walk"
    // crossing (`crossings.ts`'s own note on why that crossing exists),
    // while the other side opens onto ordinary lawn with room to spare.
    // A single shared `rampRun` (the original approach) forces the tight
    // side's cap onto the roomy side too, for no reason; worse, re-applying
    // `MAX_RAMP_GRADIENT`'s own floor after truncating *defeated* the
    // truncation outright whenever that floor's own reach (`BRIDGE_RISE /
    // MAX_RAMP_GRADIENT`) was itself larger than the room the boundary
    // truncation just found — exactly the gate-walk crossing's own shape
    // (issue #116, seeds 11 and 18: the floor snapped a ~1 m-deep
    // truncation straight back up to ~7.9 m, reaching 8 m past the edge of
    // the map). `MAX_RAMP_GRADIENT`'s floor exists to keep two *competing
    // bridges* from squeezing each other into an unwalkable slope
    // (`rampRunCap` above); it says nothing useful about the edge of the
    // world, where there is no slope to walk *at all* past a certain point
    // — so the boundary truncation below floors only at a small physical
    // minimum, not at the walkability grade. A ramp genuinely too cramped
    // to reach anywhere near {@link BRIDGE_RISE} on one side is exactly
    // `everyBridgeIsWalkableAndReachable`'s own "a maximally cramped
    // bridge; nothing to probe this far out" case — deliberately handled
    // there rather than forced here.
    const truncateForBoundary = (sign: 1 | -1): number => {
      let rampRun = idealRampRun;
      const steps = Math.max(1, Math.ceil(rampRun));
      for (let i = 1; i <= steps; i += 1) {
        const along = DECK_HALF_LENGTH + (i / steps) * rampRun;
        const x = cx + dirX * along * sign;
        const z = cz + dirZ * along * sign;
        if (GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z) < halfAcross) {
          rampRun = Math.max(0.5, along - DECK_HALF_LENGTH - 1.5);
          break;
        }
      }
      return rampRun;
    };
    const rampRunPos = truncateForBoundary(1);
    const rampRunNeg = truncateForBoundary(-1);

    return {
      cx,
      cz,
      dirX,
      dirZ,
      acrossX,
      acrossZ,
      halfAcross,
      rampRunPos,
      rampRunNeg,
      covers: (x: number, z: number, margin = 0): boolean => {
        const dx = x - cx;
        const dz = z - cz;
        const along = dx * dirX + dz * dirZ;
        const across = dx * acrossX + dz * acrossZ;
        if (Math.abs(across) > halfAcross + margin) return false;
        const rampRun = along >= 0 ? rampRunPos : rampRunNeg;
        return Math.abs(along) <= DECK_HALF_LENGTH + rampRun + margin;
      },
    };
  });
}
