import type { LevelCrossing } from './crossings';
import { BRIDGE_RISE, FENCE_OFFSET } from './clearance';
import { ENTRANCE_RAMP } from '../building/layout';
import { GARDEN_PLAY_BOUNDARY } from '../boundary';
import { clearOfPlots } from '../parkLayout';
import { distanceToRailCorridor } from './plan';

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

/**
 * Stride of clearance a ramp keeps from the nearest layout entry — a stall,
 * a plot, a building — beyond that entry's own `boundingRadius`, tested at
 * the ramp's own two edges (see {@link planBridgeFootprints}'s
 * `truncateForPlots`).
 *
 * `route.ts`'s own solve only keeps the *rail centre line* {@link
 * BRIDGE_RAMP_GRADIENT}'s sibling, `TRACK_PLOT_CLEARANCE` (4.2 m), off a
 * plot — and a bridge's ramp reaches far further out than the rail ever
 * did (up to `BRIDGE_RISE / BRIDGE_RAMP_GRADIENT`, ~18 m each way), so a
 * long ramp can walk straight into the side of a stall the rail solve
 * never had to keep clear of at that distance. Measured live, issue #116
 * seed 11: a ramp's own documented far tread landed 2.12 m inside the
 * hotel's `boundingRadius`, another 2.21 m inside `stall.facePaint`'s, a
 * third 0.92 m inside `stall.spookyHouse`'s — a probe standing there was
 * pushed 0.69–0.85 m by the stall's own wall. (The topmost review pass on
 * this PR read those walls' `topHeight: Infinity` as "the fence's own
 * signature" and attributed the overlap to the rail loop; measured against
 * the real built park, wall half-thickness and `PARK_LAYOUT` both point to
 * ordinary stall/building walls instead — the fix belongs here regardless,
 * since a ramp truncated to clear its neighbours clears both causes.)
 */
const RAMP_PLOT_MARGIN = 2.0;

/**
 * Safety stride on top of {@link FENCE_OFFSET} in `truncateForRailLoop` — a
 * walker's own body (`PLAYER_RADIUS`) plus the fence post's own thickness
 * both live between "on the centre line" and "clear of the fence", so
 * requiring exactly `FENCE_OFFSET` would let a ramp tread graze the post
 * rather than stand comfortably past it.
 */
const RAMP_RAIL_MARGIN = 0.5;

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
  // Pass 1: every crossing's own deck rectangle — position, orientation and
  // (boundary-truncated) half-width — computed before any ramp length, so
  // pass 2's rail-loop truncation (below) can ask "does a candidate ramp
  // point fall under ANY crossing's deck", exactly the Euclidean rectangle
  // test `fence.ts`'s own `deckSpanAt`/`Bridge.deckCovers` use to decide
  // where the fence gets its `topIsAbsolute` seam. A ramp's own rampRun has
  // not been decided yet at this point and does not need to be — the deck
  // rectangle alone is what makes a stretch of fence safe to stand near.
  const decks = crossings.map((crossing) => {
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

    // Same shape, against every nearby layout entry — a wide, oblique
    // crossing's own deck can be broad enough to reach a stall or building
    // at its own two along-extremes, before a single ramp tread exists.
    // `route.ts`'s solve only kept the *rail centre line* clear of a plot
    // (`TRACK_PLOT_CLEARANCE`); nothing kept a wide DECK's own edge clear
    // of one too (issue #116, seed 11: the deck at rail-distance 186.5 had
    // `halfAcross` 6.84 m, wide enough that even its very first ramp tread
    // — before any rail-loop or plot ramp-truncation ran — still stood
    // 0.98 m inside `stall.spookyHouse`'s own wall). Reduced the same way
    // the boundary loop above is, so a walker at the deck's own edge always
    // has {@link RAMP_PLOT_MARGIN} of daylight past the nearest plot.
    for (const along of [-DECK_HALF_LENGTH, DECK_HALF_LENGTH]) {
      for (const sign of [1, -1] as const) {
        while (halfAcross > 1) {
          const x = cx + dirX * along + acrossX * halfAcross * sign;
          const z = cz + dirZ * along + acrossZ * halfAcross * sign;
          if (clearOfPlots(x, z, RAMP_PLOT_MARGIN)) break;
          halfAcross -= 0.5;
        }
      }
    }
    return { cx, cz, dirX, dirZ, acrossX, acrossZ, halfAcross };
  });

  /**
   * True wherever ANY crossing's own deck rectangle — padded outward by
   * `margin` — covers `(x, z)`. `margin = 0` is where the fence really
   * does stand aside (see the header above); `truncateForRailLoop` below
   * asks with a real margin instead, because an *oblique, wide* deck's
   * rail can curve away from its own straight-sided rectangle faster than
   * the ramp's own wide edge does — a point one ramp-tread past the
   * rectangle's exact corner is still genuinely this crossing's own
   * approach, not a foreign stretch of the loop, and the exact-edge test
   * alone read it as one (issue #116, canonical seed: crossing at
   * rail-distance 204.9, `halfAcross` 5.79 m — a point 1 m past its own
   * deck's far corner, still following the same curve in, measured 1.9 m
   * from the corridor and got truncated to the floor on a side that had
   * **7.4 m of genuinely clear room**, stranding the deck off the nav
   * lattice entirely on four of the five seeds). Padded by
   * {@link RAMP_CLEARANCE} — the same "stride of margin" a capped ramp
   * already keeps clear of a *neighbouring* crossing's own corridor,
   * reused here for a crossing's own.
   */
  const underAnyDeck = (x: number, z: number, margin = 0): boolean => {
    for (const deck of decks) {
      const dx = x - deck.cx;
      const dz = z - deck.cz;
      const along = dx * deck.dirX + dz * deck.dirZ;
      const across = dx * deck.acrossX + dz * deck.acrossZ;
      if (Math.abs(along) <= DECK_HALF_LENGTH + margin && Math.abs(across) <= deck.halfAcross + margin) {
        return true;
      }
    }
    return false;
  };

  return crossings.map((crossing, crossingIndex) => {
    const { cx, cz, dirX, dirZ, acrossX, acrossZ, halfAcross } = decks[crossingIndex] as (typeof decks)[number];

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
    //
    // **The `0.5 m` floor above is a physical minimum, not a promise it is
    // itself inside the boundary — and on the gate-walk crossing it isn't.**
    // The gate sits so hard against `GARDEN_PLAY_BOUNDARY` that the coarse
    // walk above can find the violation on its very first sampled metre,
    // while the deck's own edge (`along = DECK_HALF_LENGTH`, before any
    // ramp at all) is *already* only a few tens of centimetres inside it —
    // issue #116, seeds 11 and 18: the deck edge measured 0.44 m and
    // 0.19–0.34 m inside the boundary respectively, and the unconditional
    // `0.5 m` floor then landed the far tread 0.06–0.20 m *past* it. So the
    // floored value is walked back down here, in fine (0.1 m) steps, until
    // its own far tread genuinely clears the boundary by `halfAcross` —
    // never assumed safe just because it is short. This can reach `0` (no
    // ramp reach on this side at all): the gate-walk crossing's tight side
    // faces *outward*, past the gate the walk-in samples run from
    // (`crossings.ts`'s own note), so nobody ever needs to stand there —
    // unlike the boundary-truncation loop's own "too cramped to reach
    // `BRIDGE_RISE`" case above, a `0`-length ramp on one side is not a
    // failure, it is the correct answer for a side nothing walks on.
    const truncateForBoundary = (sign: 1 | -1, requiredClearance = halfAcross): number => {
      let rampRun = idealRampRun;
      const steps = Math.max(1, Math.ceil(rampRun));
      for (let i = 1; i <= steps; i += 1) {
        const along = DECK_HALF_LENGTH + (i / steps) * rampRun;
        const x = cx + dirX * along * sign;
        const z = cz + dirZ * along * sign;
        if (GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z) < requiredClearance) {
          rampRun = Math.max(0.5, along - DECK_HALF_LENGTH - 1.5);
          break;
        }
      }
      const BACKOFF_STEP = 0.1;
      while (rampRun > 0) {
        const along = DECK_HALF_LENGTH + rampRun;
        const x = cx + dirX * along * sign;
        const z = cz + dirZ * along * sign;
        if (GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z) >= requiredClearance) break;
        rampRun = Math.max(0, rampRun - BACKOFF_STEP);
      }
      return rampRun;
    };
    // Truncated against every nearby layout entry too — a stall, a plot, a
    // building — the thing `route.ts`'s own solve keeps only the rail
    // *centre line* clear of (`TRACK_PLOT_CLEARANCE`, 4.2 m), never a
    // bridge's ramp reaching several times that far out from it. Sampled
    // across the ramp's *whole* width, not just its two edges: a wide
    // crossing's `halfAcross` can swing both far edges clear of a stall
    // sitting just off the ramp's own centreline while the middle of the
    // walkable surface still stands on top of it — the same "the edge
    // clears but the middle does not" shape `planBridgeFootprints`'s own
    // boundary walk already knows to check the *whole* ramp for (see that
    // loop's own comment), not only sampled at the wrong axis here. See
    // {@link RAMP_PLOT_MARGIN} for the measured numbers this closes.
    const truncateForPlots = (sign: 1 | -1, margin = RAMP_PLOT_MARGIN): number => {
      let rampRun = idealRampRun;
      const steps = Math.max(1, Math.ceil(rampRun));
      for (let i = 1; i <= steps; i += 1) {
        const along = DECK_HALF_LENGTH + (i / steps) * rampRun;
        for (const t of [-1, -0.5, 0, 0.5, 1]) {
          const x = cx + dirX * along * sign + acrossX * halfAcross * t;
          const z = cz + dirZ * along * sign + acrossZ * halfAcross * t;
          if (!clearOfPlots(x, z, margin)) {
            return Math.max(0.5, along - DECK_HALF_LENGTH - 1.5);
          }
        }
      }
      return rampRun;
    };

    // Truncated against the rail/fence loop itself, not only the map edge
    // and the nearest crossing — on a layout where the loop curves back
    // near itself, a long ramp can otherwise walk straight into a stretch
    // of its own exclusion fence that has nothing to do with this
    // crossing. Sampled across the ramp's whole width (same reason as
    // `truncateForPlots` above), and — critically — a rail sample is only
    // a hazard where it is NOT under any crossing's own deck: `fence.ts`
    // only ever seams the fence under a deck's exact rectangle
    // (`Bridge.deckCovers`), never under a ramp, so a ramp tread standing
    // close to rail that is *not* under a deck meets an ordinary,
    // always-solid wall regardless of whose crossing that rail belongs to
    // — including, past the deck's own edge, this crossing's own (a wide,
    // oblique deck's curve can swing its own nearby rail back close to the
    // very first ramp tread). `underAnyDeck` (pass 1, above) is the same
    // Euclidean rectangle test the real fence build uses, so this and the
    // built game can never disagree about which stretch is safe.
    const truncateForRailLoop = (sign: 1 | -1, margin = RAMP_RAIL_MARGIN): number => {
      let rampRun = idealRampRun;
      const steps = Math.max(1, Math.ceil(rampRun));
      for (let i = 1; i <= steps; i += 1) {
        const along = DECK_HALF_LENGTH + (i / steps) * rampRun;
        for (const t of [-1, -0.5, 0, 0.5, 1]) {
          const x = cx + dirX * along * sign + acrossX * halfAcross * t;
          const z = cz + dirZ * along * sign + acrossZ * halfAcross * t;
          if (underAnyDeck(x, z, RAMP_CLEARANCE)) continue; // the fence stands aside here — safe
          if (distanceToRailCorridor(x, z) < FENCE_OFFSET + margin) {
            return Math.max(0.5, along - DECK_HALF_LENGTH - 1.5);
          }
        }
      }
      return rampRun;
    };

    // Every one of the three truncations above is a real constraint, and
    // ordinarily all three apply together (`Math.min` of all three, per
    // side). But **a `0.5 m` floor was never a claim that side is walkable
    // — only that its geometry will not be literally degenerate.** It
    // never could be: a tread run has to cover the *whole* {@link
    // BRIDGE_RISE} regardless of how little `along` room it is given, so a
    // `0.5 m` ramp descends the same rise a normal one spreads over ~18 m
    // in a fraction of the distance — a grade far past anything `NavGrid`
    // links as one walkable level, which is exactly why a bridge whose
    // *only* two approaches both floor this way ends up with its deck
    // simply unreachable, not just cordoned off (`check:park`'s invariant 1
    // and this file's own `reachableFromEntrance` check both hold every
    // attraction, bridges included, to that). The pre-fix code never hit
    // this: only the boundary truncation had a floor at all, and a
    // crossing needing *this* rescue needs it precisely because the two
    // truncations this PR adds (plots, the rail loop) can now each
    // independently floor a *different* side of the same crossing — found
    // live, issue #116, seed 2: rail-distance 286.4 floored to `0.5 m` on
    // *both* sides, one from a plot, the other from the boundary, and nothing
    // reached the deck at all.
    //
    // **This is genuinely tiered, not "drop whichever of the three is
    // smallest."** An earlier version of this fallback computed
    // `Math.max(Math.min(a,b), Math.min(a,c), Math.min(b,c))` over the raw
    // per-constraint results — the "median of three" identity, which drops
    // whichever constraint happens to be tightest, *including the
    // boundary*, with nothing recomputed at a lesser standard. Peer review
    // caught it live on the *canonical* seed (rail-distance 128.2's
    // crossing): the boundary had correctly floored `rampRunPos` to `0.5 m`
    // — a real, tight boundary — but because `rampRunNeg` was *also* below
    // the walkable floor for an unrelated reason (`RAMP_PLOT_MARGIN`), the
    // fallback fired and threw the boundary's own answer away outright,
    // landing the real, built far tread `1.68 m` past `GARDEN_PLAY_BOUNDARY`
    // with real collision pushback up to `2.26 m` — the exact class of bug
    // this whole file exists to close, reintroduced by its own rescue path.
    //
    // The fix: `plots` and `rail loop` carry a real safety **margin** on top
    // of the literal overlap they measure ({@link RAMP_PLOT_MARGIN}, {@link
    // RAMP_RAIL_MARGIN}), and `truncateForBoundary` carries the ramp's full
    // `halfAcross` **width** requirement on top of its own literal edge —
    // three genuinely different things to give up, at three genuinely
    // different tiers, never the boundary's edge itself:
    //
    // 1. Full margins (already computed above as `rampRunPos`/`rampRunNeg`).
    // 2. If a side is still short: the *margin* on plots and the rail loop
    //    given up (recomputed at `margin = 0` — the literal, unpadded
    //    overlap, never crossed), boundary untouched.
    // 3. If, even then, BOTH sides are still short together: boundary's own
    //    *width* requirement also given up (recomputed at `requiredClearance
    //    = 0` — literal-edge-only, its own backoff loop still floors at
    //    `distanceToEdge >= 0`, i.e. never actually past the map).
    //
    // Reachability is a harder, pre-existing requirement than any one of
    // these margins (`check:park`'s invariant 1, this file's own
    // `reachableFromEntrance`), which is why a crossing this cramped is
    // allowed to give them up at all — but the literal boundary edge is
    // never one of the things given up, at any tier.
    const WALKABLE_FLOOR = BRIDGE_RISE / MAX_RAMP_GRADIENT;
    const sideWithMargins = (sign: 1 | -1): number =>
      Math.min(truncateForBoundary(sign), truncateForPlots(sign), truncateForRailLoop(sign));
    const sideMarginFree = (sign: 1 | -1): number =>
      Math.min(truncateForBoundary(sign), truncateForPlots(sign, 0), truncateForRailLoop(sign, 0));
    const sideBoundaryEdgeOnly = (sign: 1 | -1): number =>
      Math.min(truncateForBoundary(sign, 0), truncateForPlots(sign, 0), truncateForRailLoop(sign, 0));

    let rampRunPos = sideWithMargins(1);
    let rampRunNeg = sideWithMargins(-1);
    if (rampRunPos < WALKABLE_FLOOR) rampRunPos = Math.max(rampRunPos, sideMarginFree(1));
    if (rampRunNeg < WALKABLE_FLOOR) rampRunNeg = Math.max(rampRunNeg, sideMarginFree(-1));
    if (rampRunPos < WALKABLE_FLOOR && rampRunNeg < WALKABLE_FLOOR) {
      rampRunPos = Math.max(rampRunPos, sideBoundaryEdgeOnly(1));
      rampRunNeg = Math.max(rampRunNeg, sideBoundaryEdgeOnly(-1));
    }
    // If both sides are still short even here, this crossing is genuinely
    // as cramped as the gate-walk crossing's own tight side, and is left as
    // measured — `everyBridgeIsWalkableAndReachable`
    // (test/procgen/invariants.ts) is what judges whether that leaves the
    // deck reachable at all.

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
