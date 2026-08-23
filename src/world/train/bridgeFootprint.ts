import type { LevelCrossing } from './crossings';
import { BRIDGE_RISE, FENCE_OFFSET } from './clearance';
import { ENTRANCE_RAMP } from '../building/layout';
import { GARDEN_PLAY_BOUNDARY } from '../boundary';
import { clearOfPlots } from '../parkLayout';
import { distanceToRailCorridor } from './plan';
import type { CollisionWorld } from '../Collision';
import { PLAYER_RADIUS } from '../../core/constants';

/**
 * The bridge's own footprint in the ground plane (issue #116, Decision 8) —
 * every number `world/train/bridges.ts` needs to lay a deck and two ramps
 * out, and nothing about *building* one: no three.js, no terrain sample, no
 * `World`. Split out for one reason — `Scenery.ts` and `LampPosts.ts` need
 * this same footprint **before** any bridge exists, to keep a tree or a lamp
 * from growing through a ramp that has not been built yet (see
 * `train/bridgeKeepout.ts`), and they already import `train/plan.ts`'s
 * `distanceToRailCorridor` the same way. `bridges.ts` imports every constant
 * and the planner below rather than restating them.
 *
 * ## Two calling conventions, one function (issues #317, #319)
 *
 * `bridgeKeepout.ts` calls this **before** `Scenery`/`LampPosts` have placed
 * a single tree or lamp — there is no real collision world worth asking yet,
 * only the park's own fixed geometry (the boundary, the named plots). That
 * call omits `real` and gets a *conservative reservation*: generous enough
 * that whatever the real, later pass below decides to build always fits
 * inside it (see {@link maxLateralShiftFor}'s own note on why that is true by
 * construction), so nothing ever gets planted somewhere this file's own
 * later, better-informed pass wants for itself.
 *
 * `bridges.ts` calls this **last of all**, from inside `ParkTrain`'s own
 * constructor — by then `World`'s build order (see `World.ts`'s own
 * comments) has already registered the boundary, every garden wall and
 * tree, every lamp post, the castle, the hotel, every stall and the water-
 * fight dressing with the shared `CollisionWorld`. Passing `real` here is
 * what turns this from "check two or three hand-picked obstacle classes"
 * into "check whatever is actually there" — Jim, 22 August 2026: *"the
 * procgen should backtrack on collisions and make some different decisions
 * until it works - literally the same way the procgen always works."* This
 * is that backtracking: for each crossing, walk the width down, and try
 * shifting the deck sideways along the crossing, until a configuration is
 * found whose deck and at least one ramp genuinely clear
 * `collision.isClearCircle` — the identical planning query
 * `coaster/pylons.ts` already asks the same collision world for its own
 * pylon spots — rather than shrinking to a hard floor and shipping whatever
 * that floor happens to land on (issues #317 and #319: exactly that floor,
 * hit and shipped anyway, on 14 crossings across 5 seeds).
 *
 * The one obstacle class that genuinely *cannot* be asked of `real.collision`
 * even on the late call is the rail's own exclusion fence: `fence.ts` builds
 * it **after** this planner runs, seamed around whatever footprint this
 * function returns, so at plan time it does not exist as a collider yet.
 * `distanceToRailCorridor` (a pure geometric query against the solved rail
 * centreline, no collision registration required) stands in for it, exactly
 * as it always has — this is not a second hand-picked obstacle class in the
 * same sense as the old `clearOfPlots`/`GARDEN_PLAY_BOUNDARY` checks were,
 * because there is no way to make it a real one without bridges and fence
 * swapping which gets built first, which the fence's own seaming needs to
 * not happen.
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
 * Ordinary safety stride a ramp's own edge keeps past `GARDEN_PLAY_BOUNDARY`
 * in the early, conservative (no `real` world) reservation pass — see this
 * file's own header on the two calling conventions. The late, real pass
 * below does not use this at all: the boundary is a real, registered wall by
 * the time that pass runs, so it is simply one more thing
 * `collision.isClearCircle` already refuses to stand near.
 */
const RAMP_BOUNDARY_MARGIN = 1.5;

/**
 * Extra width, beyond a crossing's own self-measured `halfGap`, that the
 * deck and every ramp tread carry before a guard rail stands.
 *
 * `halfGap` is tuned for exactly one job — sizing the *old* level crossing's
 * fence gap so an oblique path's own waypoint samples never straddled a
 * compartment wall. A bridge has its own guard rails a path sample could
 * otherwise graze, so this is a stride's worth of slack on top.
 */
export const ACROSS_MARGIN = 2.0;

/**
 * Stride of clearance a ramp keeps from the nearest layout entry in the
 * early, conservative reservation pass — see {@link RAMP_BOUNDARY_MARGIN}'s
 * own note; same reasoning, same pass.
 */
const RAMP_PLOT_MARGIN = 2.0;

/**
 * Safety stride on top of {@link FENCE_OFFSET} — a walker's own body
 * (`PLAYER_RADIUS`) plus the fence post's own thickness both live between
 * "on the centre line" and "clear of the fence", so requiring exactly
 * `FENCE_OFFSET` would let a ramp tread graze the post rather than stand
 * comfortably past it. Used by both passes, since the rail loop is never a
 * real, queryable collider at plan time (see the file header).
 */
const RAMP_RAIL_MARGIN = 0.5;

/**
 * How far the real, late pass may slide a crossing's deck sideways — along
 * the crossing's own `across` axis, which runs roughly parallel to the rail
 * — while backtracking a candidate that does not clear. "A different
 * position along the crossing", the second lever `CLAUDE.md`'s "procgen
 * backtracks on collision" rule names after "a smaller width".
 *
 * Bounded well under a crossing's own smallest workable `halfAcross` (see
 * {@link MIN_DECK_HALF_WIDTH}) so a shift can never slide the deck out from
 * under the actual drawn path that crosses here — the search below only
 * ever accepts a shift that still leaves the crossing's own touch point at
 * least {@link MIN_DECK_HALF_WIDTH} inside the shifted deck's near edge.
 *
 * Also why the early, conservative reservation pass pads its own width by
 * this same figure (see `planBridgeFootprints`'s conservative branch): the
 * real pass can shift a deck this far from its natural centre, so a
 * reservation computed without knowing which way it will shift has to cover
 * every direction it might.
 *
 * Scaled to the crossing's own `halfGap` rather than held flat, and it has
 * to be: `halfGap` is the *real, self-measured* spread of where the drawn
 * path's own samples actually touch the rail (`crossings.ts`'s own note),
 * so the whole of that spread is where a bridge legitimately belongs — a
 * flat 4 m cap left an 11 m-`halfGap` crossing unable to slide far enough
 * within its *own* corridor to dodge an obstacle sitting near its
 * self-measured centre, even though clear room existed nearer either end of
 * that same corridor (found live testing this search, canonical seed: an
 * 11.2 m-`halfGap` crossing shrank to a technically-clear but 1–2 m sliver
 * because every shift within ±4 m still crossed the same obstacle, and
 * stranded five waypoints scattered 7–20 m across the very corridor
 * `halfGap` was measuring in the first place). Floored at the old flat
 * figure for an ordinary, tighter crossing, where it was never the limit.
 */
function maxLateralShiftFor(crossing: LevelCrossing): number {
  return Math.max(4.0, crossing.halfGap);
}

/**
 * The narrowest a deck or ramp may be shrunk to and still read as a deck —
 * a walker's own body plus a real, physical sliver of daylight past it, not
 * the old floor's bare `1.0`. If backtracking exhausts every width down to
 * this and every shift, the crossing genuinely cannot take a bridge and the
 * search gives up on this crossing (see `planBridgeFootprints`'s own note
 * on what happens then).
 */
export const MIN_DECK_HALF_WIDTH = PLAYER_RADIUS + 0.3;

/** Coarse step the width search backtracks by. */
const WIDTH_STEP = 0.5;

/**
 * Fractions of the *current candidate width* tried as a lateral shift, in
 * the order tried — natural centre first, then increasingly large nudges
 * either way. Scaled by the candidate's own `halfAcross` (rather than a
 * flat metre figure) so a shift never asks a narrow deck to slide further
 * than its own width could plausibly still cover the original crossing
 * point, and clamped again against {@link maxLateralShiftFor} regardless.
 */
const SHIFT_FRACTIONS: readonly number[] = [0, 0.35, -0.35, 0.7, -0.7];

/** Points swept across a candidate's own width — the union of the two
 * resolutions `planBridgeFootprints`'s own search and
 * `test/procgen/invariants.ts`'s `everyBridgeIsWalkableAndReachable` use, so
 * nothing the generator calls "clear" can read as a breach to the invariant
 * that re-measures it against the real, built park afterwards.
 *
 * **Fixed `t`s relative to a candidate's own (possibly shifted) centre —
 * not fixed relative to the crossing's own real touch line.** Found live
 * on the canonical seed's first real bridge (2026-08-23, once `BRIDGE_RISE`
 * shrank enough for one to actually build): a candidate accepted at a
 * lateral shift of roughly a third of its own `halfAcross` puts the
 * crossing's own touch point — where the drawn path actually meets the
 * rail, and the one line a shift is required to keep inside the deck (see
 * `searchDeck`'s own `Math.abs(shift) > halfAcross - MIN_DECK_HALF_WIDTH`
 * guard) — at `t ≈ 0.38` in that candidate's own frame, squarely between
 * this list's `0` and `0.45` and tested by *neither*. A lamp base sat
 * exactly there, 0.09 m inside a walker's real clearance, and nothing here
 * ever probed the one line guaranteed to carry real foot traffic. See
 * {@link sampleTsFor}, which is what actually closes the gap — this list
 * alone is deliberately kept fixed and un-widened, because a genuinely
 * dense width sweep (checking every `WIDTH_STEP` across a deck that can run
 * to a `halfGap` of a dozen-plus metres) multiplies the search's own
 * candidate cost by an order of magnitude for a hole only ever found on the
 * *one* guaranteed line, not generally across the width. */
const SAMPLE_TS: readonly number[] = [-1, -0.9, -0.5, -0.45, 0, 0.45, 0.5, 0.9, 1];

/**
 * {@link SAMPLE_TS}, plus the crossing's own real touch line in *this*
 * candidate's frame — see that constant's own note for the live bug this
 * closes. `crossing.x, crossing.z` is guaranteed inside every candidate this
 * is called for (the shift-acceptance check in `searchDeck` refuses any
 * shift that would put it outside), so this never adds a point off the
 * candidate's own deck; it only ever adds the one point every other sample
 * in the fixed list can legitimately miss.
 */
function sampleTsFor(
  crossing: { x: number; z: number },
  centerX: number,
  centerZ: number,
  acrossX: number,
  acrossZ: number,
  halfAcross: number,
): readonly number[] {
  const crossingT = ((crossing.x - centerX) * acrossX + (crossing.z - centerZ) * acrossZ) / halfAcross;
  return [...SAMPLE_TS, crossingT];
}

/**
 * Real-metre spacing {@link denseSampleTs} sweeps a candidate's own width
 * at, and `rampReach`'s own along-stepping matches it — never a fixed `t`
 * step, because `t` is a *fraction* of `halfAcross` and this crossing's
 * decks range from `MIN_DECK_HALF_WIDTH` (~1 m) to well past 10 m: a
 * fixed-`t` step that is dense enough for a narrow deck is nowhere near
 * dense enough for a wide one. A first version of this fixed `t` at `0.08`
 * — dense-*sounding*, but on an 11 m-`halfAcross` deck (this crossing's own
 * real, shifted width, this file's own header) that is 0.88 m between
 * samples, comfortably wide enough to still step clean over a 3-4 m-wide
 * stone garden bench, and did.
 *
 * **`0.5`, not the `0.2` this was first tried at.** `0.2` genuinely closed
 * the hole (proven red-then-green against the exact bench above) but cost
 * real, measured generation time: `check:park-boot` went from 770 ms spent
 * outside a budgeted slice to 2595 ms, and its worst single `advance()` from
 * 14.2 ms to 490.9 ms, on a park with only two or three crossings ever
 * reaching this pass at all. Pass 2 still runs exactly once per accepted
 * crossing, so `0.5` (`WIDTH_STEP`'s own established density elsewhere in
 * this file, not a new number) is still a large improvement over the nine
 * fixed fractions the bug shipped with, while affordable inside a real
 * frame budget — and still small next to the bench's own few-metre size, so
 * the same red-then-green case stays green at this coarser step too.
 */
const DENSE_REAL_STEP = 0.5;

/**
 * A genuinely dense sweep across a candidate's own width, `DENSE_T_STEP`
 * apart, `t` from `-1` to `1` inclusive — every point {@link SAMPLE_TS}'s
 * nine fixed fractions could still miss between them.
 *
 * **Only for pass 2's final commit, never pass 1's search.** `SAMPLE_TS`'s
 * own header already explains why the search itself stays sparse: it tries
 * dozens of width/shift candidates per crossing, so a dense sweep there
 * multiplies real cost by an order of magnitude for a hole the fixed list
 * mostly does not have. Pass 2 is different — it runs exactly **once**, on
 * the crossing's own already-decided, final geometry, so a dense sweep
 * there costs a few hundred extra `isClearCircle` calls total across the
 * whole park, not per candidate.
 *
 * Found needed live, canonical seed, PR #330: a stone garden bench (four
 * short walls, built by `Scenery.ts` well before this crossing had ever
 * accepted a shifted, real candidate to check itself against) sat squarely
 * on a ramp at `t ≈ 0.87` — between `SAMPLE_TS`'s `0.5` and `0.9`, on
 * neither of them, on a deck whose own accepted centre had shifted several
 * metres off the crossing's natural one (this file's own header on why a
 * shift happens at all). `everyBridgeIsWalkableAndReachable` caught it —
 * "the ramp ... is not standable" — exactly the disease CLAUDE.md's hotel
 * story describes: a search whose own acceptance test can pass a state the
 * built game does not actually guarantee. `sampleTsFor`'s touch-line
 * addition closes the *one* line guaranteed to carry foot traffic; nothing
 * before this closed the rest of the width for the one pass that actually
 * ships.
 */
function denseSampleTs(crossing: { x: number; z: number }, centerX: number, centerZ: number, acrossX: number, acrossZ: number, halfAcross: number): readonly number[] {
  const ts: number[] = [];
  const step = DENSE_REAL_STEP / Math.max(halfAcross, DENSE_REAL_STEP);
  for (let t = -1; t <= 1 + 1e-9; t += step) ts.push(t);
  const crossingT = ((crossing.x - centerX) * acrossX + (crossing.z - centerZ) * acrossZ) / halfAcross;
  ts.push(crossingT);
  return ts;
}

/**
 * How much real daylight a probe needs past whatever `real.collision` has
 * registered, on top of a walker's own body — smaller than the old
 * hand-picked margins (`RAMP_PLOT_MARGIN`, `RAMP_BOUNDARY_MARGIN`) because
 * this is now checking a real, exact collider rather than a proxy
 * (`boundingRadius`, `distanceToEdge` against a spline) that itself already
 * carried slack.
 */
const REAL_CLEARANCE_STRIDE = 0.5;

/**
 * Exported so a caller placing an object near a bridge before one exists
 * (`LampPosts.ts`'s own, tighter margin) can derive its own safety margin
 * from the exact radius the real search's own probe uses, rather than
 * re-deriving a number by hand that has to be kept in step separately — see
 * CLAUDE.md's "Two definitions of one thing, kept in step by hand". A
 * hand-copied `0.92` here once sat 0.2 m short of what a lamp actually
 * needed (`PLAYER_RADIUS + 0.3` omitted `REAL_CLEARANCE_STRIDE` entirely),
 * found live once real bridges existed to measure it against.
 */
export const REAL_PROBE_RADIUS = PLAYER_RADIUS + REAL_CLEARANCE_STRIDE;

/**
 * How far a ramp side has to reach before it counts as a genuinely walkable
 * approach — {@link BRIDGE_RISE} spread over the steepest grade
 * {@link MAX_RAMP_GRADIENT} ever forces.
 *
 * **Both sides must clear this, not just the better one** — a path crosses a
 * bridge in either direction, so a deck that only ramps down on one side is
 * a dead end approached from the other: a sheer, `BRIDGE_RISE`-tall drop with
 * nothing under it at all (`covers()` stops dead at the deck's own edge on
 * the ramp-less side, so a walker there is not even standing on a surface,
 * let alone a walkable one). Found by real-browser QA on PR #330: three
 * bridges on the canonical seed and more on seeds 2 and 18 had exactly one
 * side with `rampRun` at or near zero — a 4.7–4.9 m vertical face where the
 * path ran straight into it — because the search below originally accepted
 * `Math.max(reachPos, reachNeg) >= WALKABLE_FLOOR`, "at least the better
 * side clears", which is not what a through-crossing needs. Missed by
 * `test/procgen/invariants.ts` for the same reason CLAUDE.md's hotel-collision
 * story keeps recurring: that invariant's own check treated `rampReach < 1`
 * as "skip this side" rather than "fail this bridge", so the exact bug this
 * floor exists to catch could pass with the very floor doing nothing.
 */
const WALKABLE_FLOOR = BRIDGE_RISE / MAX_RAMP_GRADIENT;

/**
 * Real slack held past {@link WALKABLE_FLOOR} before a candidate counts as
 * accepted — never accept a configuration that clears by a razor's edge.
 *
 * Found reviewing PR #330's own scatterDecoupling regression: two crossings
 * were not directly competing for the same ground (`nearOtherGuardRail`
 * never fired between them), yet which one got a real bridge still flipped
 * between an otherwise-identical build and one with an unrelated stall's
 * spur nudged 2 m — because that crossing's own search sat exactly on the
 * `WALKABLE_FLOOR` boundary, and an entirely ordinary, already-tolerated
 * scatter shift (a lamp a few metres out) was enough to tip a probe from
 * clear to blocked and back. A search whose accept/reject depends on
 * millimetres of real-world jitter is exactly "shrink to a hard floor and
 * ship a known-too-close edge" (`CLAUDE.md`'s own words) even though
 * nothing here is a literal `Math.max` clamp — the margin is the fix, the
 * same way a structural safety factor is not "cheating" a load calculation.
 * A candidate that only clears with none of this to spare was never a
 * bridge worth trusting across a reseed; it falls back to a level crossing
 * instead, same as one that fails outright.
 */
const WALKABLE_MARGIN = 0.5;

/**
 * What the late, real pass needs from the caller: the actual collision
 * world to query, and — the last lever before giving up on a crossing
 * entirely — a way to fell a real, felt tree that turns out to be the one
 * thing standing in an otherwise-clear candidate's way, exactly the lever
 * `coaster/pylons.ts` already uses for its own placement search (issue
 * #301). Optional: `bridgeKeepout.ts`'s early call passes neither, and gets
 * the conservative reservation instead (see this file's own header).
 */
export interface RealWorldQuery {
  readonly collision: CollisionWorld;
  readonly clearTreesNear?: (x: number, z: number, radius: number) => number;
  /**
   * Non-mutating twin of {@link clearTreesNear} — "would felling here find
   * anything", asked without removing it. The width/shift search below tries
   * many candidates before settling on one; asking this (never
   * {@link clearTreesNear}) while exploring means a candidate the search goes
   * on to *reject* never fells a real tree along the way — only the one,
   * final commit for whichever candidate is actually kept does that (see
   * `planReal`'s own note). Optional for the same reason
   * {@link clearTreesNear} is: `bridgeKeepout.ts`'s early call passes
   * neither.
   */
  readonly hasFellableTreeNear?: (x: number, z: number, radius: number) => boolean;
}

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
   * rather than one shared `rampRun` — a boundary- or plot-constrained
   * crossing can have room on one side and none on the other.
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
   * `bridgeKeepout.ts` is the one caller that wants a bigger boundary — see
   * that module's own note.
   */
  covers(x: number, z: number, margin?: number): boolean;
}

/** One footprint per crossing that can genuinely take a bridge, `null` at
 * the (expected to be rare — see `planBridgeFootprints`'s own note) index
 * of a crossing the search could not find any walkable, collision-clear
 * configuration for at all. `bridges.ts` reads a `null` as "fall back to a
 * level crossing here instead". */
export type PlannedFootprint = BridgeFootprint | null;

/**
 * One footprint per crossing, in the order `crossings` gave them — the
 * ground-plane rectangle every bridge occupies, deck and both ramps, before
 * a single mesh or collider exists.
 *
 * See this file's own header for the two calling conventions (`real`
 * present or absent) and issues #317/#319 for why the real one exists at
 * all.
 */
export function planBridgeFootprints(
  crossings: readonly LevelCrossing[],
  real?: RealWorldQuery,
): PlannedFootprint[] {
  return real ? planReal(crossings, real) : planConservative(crossings);
}

// --------------------------------------------------------------------------
// The early, conservative reservation — no real collision world to ask yet.
// --------------------------------------------------------------------------

function planConservative(crossings: readonly LevelCrossing[]): BridgeFootprint[] {
  return crossings.map((crossing) => {
    const cx = crossing.x;
    const cz = crossing.z;
    const dirX = crossing.pathDirX;
    const dirZ = crossing.pathDirZ;
    const acrossX = -dirZ;
    const acrossZ = dirX;
    let halfAcross = crossing.halfGap + ACROSS_MARGIN;

    const clearsBoundaryAt = (testHalfAcross: number): boolean => {
      for (const along of [-DECK_HALF_LENGTH, DECK_HALF_LENGTH]) {
        for (const t of SAMPLE_TS) {
          const x = cx + dirX * along + acrossX * testHalfAcross * t;
          const z = cz + dirZ * along + acrossZ * testHalfAcross * t;
          if (GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z) < RAMP_BOUNDARY_MARGIN) return false;
        }
      }
      return true;
    };
    while (halfAcross > MIN_DECK_HALF_WIDTH && !clearsBoundaryAt(halfAcross)) {
      halfAcross -= WIDTH_STEP;
    }
    const clearsPlotsAt = (testHalfAcross: number): boolean => {
      for (const along of [-DECK_HALF_LENGTH, DECK_HALF_LENGTH]) {
        for (const t of SAMPLE_TS) {
          const x = cx + dirX * along + acrossX * testHalfAcross * t;
          const z = cz + dirZ * along + acrossZ * testHalfAcross * t;
          if (!clearOfPlots(x, z, RAMP_PLOT_MARGIN)) return false;
        }
      }
      return true;
    };
    while (halfAcross > MIN_DECK_HALF_WIDTH && !clearsPlotsAt(halfAcross)) {
      halfAcross -= WIDTH_STEP;
    }

    // Padded by the full lateral shift budget: the real, late pass may slide
    // the deck this far sideways from this same natural centre, and this
    // reservation has to cover wherever it lands — see
    // `maxLateralShiftFor`'s own note.
    const reservedHalfAcross = halfAcross + maxLateralShiftFor(crossing);

    const idealRampRun = BRIDGE_RISE / BRIDGE_RAMP_GRADIENT;
    const truncate = (sign: 1 | -1): number => {
      // **Not `reservedHalfAcross` here** (issue found on PR #330's own
      // canonical-seed measurement: `rampRunPos`/`rampRunNeg` came out `0.00`
      // on 12 of this seed's 14 crossing-sides). `reservedHalfAcross` is the
      // *union* of every width/shift combination the real, late search might
      // ever try — correct for how wide `covers()` needs to stay near the
      // crossing, where a shift can genuinely land the deck anywhere in that
      // band. But no *single* candidate the real search ever accepts is that
      // wide: pass 1's own width loop tops out at `crossing.halfGap +
      // ACROSS_MARGIN` (`halfAcross` here, before the shift padding is
      // added) — a shift moves *where* that band sits, it never *widens* it.
      // Sampling ramp-length clearance across the full shift-padded envelope
      // therefore tests corners no real candidate's ramp will ever occupy —
      // on this park, routinely 11-24 m out to either side of the crossing —
      // and a single boundary or plot hit at one of those corners collapsed
      // the *entire* ramp-length reservation to near zero, for every shift,
      // not just the one whose corner actually failed. That measured
      // directly as `bridgeKeepout.ts`'s own reservation covering none of
      // the real search's actual blocking points on any of the seven
      // canonical-seed crossings — the "generous" reservation was reserving
      // almost nothing past the deck itself, so `Scenery`/`LampPosts` (which
      // both honestly ask `isInBridgeFootprint` before planting) freely
      // planted lamps and garden walls exactly where the real, much
      // narrower ramp went on to need the ground.
      const clearAt = (along: number): boolean => {
        for (const t of SAMPLE_TS) {
          const x = cx + dirX * along * sign + acrossX * halfAcross * t;
          const z = cz + dirZ * along * sign + acrossZ * halfAcross * t;
          if (GARDEN_PLAY_BOUNDARY.distanceToEdge(x, z) < RAMP_BOUNDARY_MARGIN) return false;
          if (!clearOfPlots(x, z, RAMP_PLOT_MARGIN)) return false;
          if (distanceToRailCorridor(x, z) < FENCE_OFFSET + RAMP_RAIL_MARGIN) return false;
        }
        return true;
      };
      let rampRun = idealRampRun;
      const steps = Math.max(1, Math.ceil(rampRun / WIDTH_STEP));
      for (let i = 1; i <= steps; i += 1) {
        const along = DECK_HALF_LENGTH + (i / steps) * rampRun;
        if (!clearAt(along)) {
          rampRun = Math.max(0, along - DECK_HALF_LENGTH - 1.5);
          break;
        }
      }
      const BACKOFF_STEP = 0.1;
      while (rampRun > 0 && !clearAt(DECK_HALF_LENGTH + rampRun)) {
        rampRun = Math.max(0, rampRun - BACKOFF_STEP);
      }
      return rampRun;
    };
    const rampRunPos = truncate(1);
    const rampRunNeg = truncate(-1);

    return {
      cx,
      cz,
      dirX,
      dirZ,
      acrossX,
      acrossZ,
      halfAcross: reservedHalfAcross,
      rampRunPos,
      rampRunNeg,
      covers: (x: number, z: number, margin = 0): boolean => {
        const dx = x - cx;
        const dz = z - cz;
        const along = dx * dirX + dz * dirZ;
        const across = dx * acrossX + dz * acrossZ;
        if (Math.abs(across) > reservedHalfAcross + margin) return false;
        const rampRun = along >= 0 ? rampRunPos : rampRunNeg;
        return Math.abs(along) <= DECK_HALF_LENGTH + rampRun + margin;
      },
    };
  });
}

// --------------------------------------------------------------------------
// The late, real pass — genuine backtracking against the built park.
// --------------------------------------------------------------------------

interface DeckPlan {
  readonly crossingIndex: number;
  readonly cx: number;
  readonly cz: number;
  readonly dirX: number;
  readonly dirZ: number;
  readonly acrossX: number;
  readonly acrossZ: number;
  readonly halfAcross: number;
}

function planReal(crossings: readonly LevelCrossing[], real: RealWorldQuery): PlannedFootprint[] {
  const { collision, clearTreesNear, hasFellableTreeNear } = real;
  // `isClearCircle` only ever asks the registered circles and walls — the
  // park's own soft edge (`CollisionWorld.playBounds`, what `resolve()`
  // pushes a walker back across) is a *separate* mechanism, asked nowhere
  // else in `isClearCircle`, precisely because a real gate leaves a genuine
  // gap in the *wall* right where the soft edge still has to hold (found
  // live debugging this very search, seed 18's gate-walk crossing: a
  // candidate `isClearCircle` accepted was still 0.51 m inside the soft
  // boundary, and `resolve()` pushed a probe standing there by exactly the
  // shortfall). So this asks both, the same two things a real walker's
  // `resolve()` call would ever be stopped by on open ground.
  const realClear = (x: number, z: number): boolean =>
    collision.isClearCircle(x, z, REAL_PROBE_RADIUS) &&
    collision.playBounds.distanceToEdge(x, z) >= REAL_PROBE_RADIUS;

  /**
   * **Pass-1 probe: "would this point be clear, felling included" — never
   * fells for real.** Used by every candidate the width/shift search below
   * tries (`deckClears`, `provisionalReach`).
   *
   * Scatter-decoupling regression, found reviewing PR #330: the search
   * tries many widths and, at each, several lateral shifts, before settling
   * on the one it keeps — the great majority of what it tries gets
   * rejected for some other reason (a ramp too short, a neighbour's guard
   * rail) even when a tree stood in its way and *could* have been felled to
   * clear it. The previous version of this function felled inline for every
   * one of those candidates, not just the winner, so which real trees ended
   * up standing became a function of everything the search *considered*,
   * not just what it *kept* — and since the search's own candidate order
   * can shift with scatter jitter nowhere near this crossing (an ordinary,
   * tolerated effect `test/procgen/scatterDecoupling.test.ts` already
   * expects within its own `LOCALITY_LIMIT`), that leaked into genuinely
   * different trees being felled between two otherwise-identical builds,
   * far outside any locality bound. Asking `hasFellableTreeNear` instead —
   * "is there a fellable tree here", no mutation — keeps the search free to
   * *consider* felling as a lever (a candidate that only clears once a tree
   * is felled must still read as viable, or the search would wrongly prefer
   * a narrower/shifted candidate that needed no felling at all) without
   * ever paying for a candidate it does not keep. See `searchClear`'s call
   * sites for where this is used, and pass 2 below (`commitFell`) for where
   * the one real fell per crossing actually happens.
   */
  const searchClear = (x: number, z: number): boolean =>
    realClear(x, z) || (hasFellableTreeNear ? hasFellableTreeNear(x, z, REAL_PROBE_RADIUS) : false);

  /**
   * **Pass-2 commit: fells a real, felt tree inline, the same "try, then
   * clear, then try again" order `coaster/pylons.ts` already uses for its
   * own placement search (issue #301)** — but, unlike the old version of
   * this file, only ever called against the one, final, already-decided
   * geometry per crossing (see `searchClear`'s own note on why the search
   * itself must not fell). `Scenery`'s own scatter already keeps the
   * *ordinary* case clear (it asks `isInBridgeFootprint` before planting),
   * but a clump's individual trunks are jittered a little off the candidate
   * spot that check actually asked about, so a lone trunk can still land
   * inside a bridge's real, final footprint even though the scatter's own
   * check passed (found live testing this search: a deck edge otherwise
   * clearing the conservative reservation with 2 m to spare still had a
   * 0.68 m-radius trunk sitting 0.08 m from it). Felling only ever removes a
   * real, registered tree — a point blocked by anything else (a wall, a
   * building, the boundary) is refused exactly as before, because
   * {@link Scenery.clearTreesNear} has nothing there to remove.
   */
  const commitFell = (x: number, z: number): boolean => {
    if (realClear(x, z)) return true;
    if (clearTreesNear && clearTreesNear(x, z, REAL_PROBE_RADIUS) > 0) {
      return collision.isClearCircle(x, z, REAL_PROBE_RADIUS);
    }
    return false;
  };

  // --- pass 1: each crossing's own deck — width and lateral shift ---------
  //
  // Independent per crossing: a deck's own extent never depends on where
  // any other crossing's deck ends up (the rail loop, the one thing that
  // does create cross-crossing dependency, is never a hazard to the deck
  // itself — the deck's whole job is to stand over its own stretch of it).
  // Backtracks width first (the least visually disruptive lever — a
  // narrower bridge is still obviously the same bridge), then, at each
  // width, lateral shift (issue #319's "a shifted position along the
  // crossing") — accepting the first combination whose deck clears the real
  // collision world AND whose ramp can plausibly reach {@link WALKABLE_FLOOR}
  // on BOTH sides (see that constant's own note on why "the better side" was
  // the wrong test) against a conservative (no cross-deck exception) reading
  // of the rail loop, so pass 1 never locks in a width pass 2 could not
  // actually build a walkable ramp for.
  /**
   * True near a *different* crossing's own guard rail — the real, physical
   * wall `bridges.ts` stands along each long edge of a deck (never a ramp:
   * see that file's own `railHalfAcross`), at `halfAcross + ACROSS_MARGIN`
   * out, running the deck's own `DECK_HALF_LENGTH` span. It is not a real,
   * queryable collider yet at plan time — `ParkTrain` only calls
   * `collision.addWall` for every bridge's guard rails once this whole
   * search has returned — so it needs the same synthetic treatment as the
   * rail loop, this time as an EXCLUSION rather than an exemption: found
   * live testing this search, two crossings close enough that one's deck
   * edge, cleared against everything real, still landed inside where a
   * neighbour's own guard rail was about to stand.
   */
  const nearOtherGuardRail = (
    otherDecks: readonly DeckPlan[],
    x: number,
    z: number,
    margin: number,
  ): boolean => {
    for (const deck of otherDecks) {
      const dx = x - deck.cx;
      const dz = z - deck.cz;
      const along = dx * deck.dirX + dz * deck.dirZ;
      const across = dx * deck.acrossX + dz * deck.acrossZ;
      const railAcross = deck.halfAcross + ACROSS_MARGIN;
      // Real point-to-segment distance to each of the two rail lines — not
      // "along within span, then across within margin" separately, which
      // reads a point near a rail's own END as safe whenever it clears
      // *either* test alone even though the true nearest point (the rail's
      // own endpoint, a corner) is still close. Found live testing this
      // search, seed 11: a probe 0.68 m from a real guard rail's endpoint —
      // comfortably within this file's own margin — still read as "no
      // nearby guard rail" because its `along` alone sat just past
      // `DECK_HALF_LENGTH + margin`, and its `across` alone was too, even
      // though neither excess was on its own enough to put the *point* that
      // far from the *segment*.
      const alongClamped = Math.max(-DECK_HALF_LENGTH, Math.min(DECK_HALF_LENGTH, along));
      const dAlong = along - alongClamped;
      for (const sign of [1, -1] as const) {
        const dAcross = across - sign * railAcross;
        if (Math.hypot(dAlong, dAcross) < margin) return true;
      }
    }
    return false;
  };

  const GUARD_RAIL_MARGIN = 0.08 + REAL_PROBE_RADIUS;

  /**
   * `siblingDecks` is every OTHER crossing's own current-best deck — empty
   * where none of them have a deck yet, filled in as `resweep` (below)
   * updates each crossing in place, so a later crossing's guard rail is
   * known to an earlier one too and vice versa within the very same sweep
   * (see `nearOtherGuardRail`'s own note for the live case this closes).
   * `nearOtherGuardRail` only ever *removes* room a candidate would
   * otherwise have — so a crossing accepted with fuller sibling knowledge
   * is never worse than one accepted with less, only ever more cautious.
   *
   * `existing` is this same crossing's own answer from the *previous*
   * sweep, if it found one — checked first, and kept unchanged if it still
   * clears, rather than re-searching from this crossing's own maximum width
   * back down every sweep. Without this, two crossings close enough to
   * compete for the same ground exhibit a winner-take-all runaway: crossing
   * A converges to a modest, valid width in sweep 1 while crossing B (its
   * competitor) finds nothing and goes `null`; in sweep 2, A's search sees
   * `null` for B and — because it always starts back at its own *maximum*
   * desired width — happily re-claims the room it had just as happily given
   * up, which then makes B's own sweep-2 attempt fail even harder than
   * sweep 1's, permanently. Which of two competing, nearly-tied crossings
   * ends up on the losing end of that runaway is decided by whichever
   * happened to converge (or fail) first, which is sensitive to real but
   * entirely incidental collision-world detail nowhere near either crossing
   * (found reviewing PR #330: a lamp post 40+ m away, itself shifted a few
   * metres by an ordinary, already-tolerated scatter perturbation, was
   * enough to flip which of two crossings 17 m apart got a bridge — and the
   * *loser*, having no deck built at all, then needed no tree felled near
   * it while the winner did, so trees near BOTH crossings changed between
   * builds even though neither crossing's own geometry, nor a single real
   * tree, had moved at all). Keeping a validated answer fixed instead of
   * re-maximising it every sweep means the first sweep's more modest,
   * available-room-for-everyone allocation is what actually sticks, and a
   * neighbour's later disappearance never retroactively claims back room
   * this crossing no longer needs.
   */
  const searchDeck = (
    crossing: LevelCrossing,
    siblingDecks: readonly DeckPlan[],
    existing: DeckPlan | null,
  ): DeckPlan | null => {
    const dirX = crossing.pathDirX;
    const dirZ = crossing.pathDirZ;
    const acrossX = -dirZ;
    const acrossZ = dirX;
    const idealRampRun = idealRampRunFor(crossing, crossings);

    const deckClears = (centerX: number, centerZ: number, halfAcross: number): boolean => {
      const ts = sampleTsFor(crossing, centerX, centerZ, acrossX, acrossZ, halfAcross);
      for (const along of [-DECK_HALF_LENGTH, DECK_HALF_LENGTH]) {
        for (const t of ts) {
          const x = centerX + dirX * along + acrossX * halfAcross * t;
          const z = centerZ + dirZ * along + acrossZ * halfAcross * t;
          if (!searchClear(x, z)) return false;
          if (nearOtherGuardRail(siblingDecks, x, z, GUARD_RAIL_MARGIN)) return false;
        }
      }
      return true;
    };
    // Provisional probe of one ramp side, used only to decide whether a
    // candidate width/shift is even worth locking in — pass 2 re-measures
    // the real, final reach with every other crossing's deck fully in place.
    const provisionalReach = (
      centerX: number,
      centerZ: number,
      halfAcross: number,
      sign: 1 | -1,
    ): number => {
      let rampRun = idealRampRun;
      const steps = Math.max(1, Math.ceil(rampRun / WIDTH_STEP));
      const ts = sampleTsFor(crossing, centerX, centerZ, acrossX, acrossZ, halfAcross);
      for (let i = 1; i <= steps; i += 1) {
        const along = DECK_HALF_LENGTH + (i / steps) * rampRun;
        let blocked = false;
        for (const t of ts) {
          const x = centerX + dirX * along * sign + acrossX * halfAcross * t;
          const z = centerZ + dirZ * along * sign + acrossZ * halfAcross * t;
          if (!searchClear(x, z) || nearOtherGuardRail(siblingDecks, x, z, GUARD_RAIL_MARGIN)) {
            blocked = true;
            break;
          }
          if (distanceToRailCorridor(x, z) < FENCE_OFFSET + RAMP_RAIL_MARGIN) {
            blocked = true;
            break;
          }
        }
        if (blocked) return Math.max(0, along - DECK_HALF_LENGTH - WIDTH_STEP);
      }
      return rampRun;
    };

    // Keep a still-valid previous answer rather than re-maximising — see
    // this function's own header for why. `existing` was itself only ever
    // accepted because it once passed exactly these same two checks, so
    // re-running them against the *current* siblings is the whole test: if
    // a sibling has newly encroached, this legitimately fails and falls
    // through to a real re-search below; otherwise this crossing's answer
    // does not change shape just because something elsewhere did.
    if (
      existing &&
      deckClears(existing.cx, existing.cz, existing.halfAcross) &&
      Math.min(
        provisionalReach(existing.cx, existing.cz, existing.halfAcross, 1),
        provisionalReach(existing.cx, existing.cz, existing.halfAcross, -1),
      ) >= WALKABLE_FLOOR + WALKABLE_MARGIN
    ) {
      return existing;
    }

    // Never shrink past the crossing's own self-measured `halfGap` — that
    // number is not a suggestion, it is the real spread of where the drawn
    // path's own samples actually touch the rail (`crossings.ts`'s own
    // note: "an oblique path occupies more corridor than a perpendicular
    // one, and a fixed gap strands the path's own waypoint samples"). A
    // deck narrower than that still technically clears real collision —
    // {@link MIN_DECK_HALF_WIDTH} alone never stops it — but it is a bridge
    // wide enough for one child standing exactly on the crossing's own
    // centre line and nobody approaching from anywhere else the path
    // actually runs, which is not a usable crossing at all. Found live
    // testing this search, canonical seed: an extremely oblique crossing
    // (`halfGap` 11.2 m) shrank to a technically-clear 1–2 m sliver and
    // stranded five waypoints scattered 7–20 m across the very corridor
    // `halfGap` was measuring in the first place. Below this floor the
    // search gives up on a bridge here entirely rather than accept a deck
    // too narrow to be the crossing it is meant to be — see this file's own
    // header on the fallback that follows.
    const USABLE_HALF_WIDTH_FLOOR = Math.max(MIN_DECK_HALF_WIDTH, crossing.halfGap);
    const maxShift = maxLateralShiftFor(crossing);
    // Narrowest first, widening only as a real backtrack — the reverse of
    // this loop's original direction. QA on PR #330: decks were coming out
    // 12.9-15.8 m wide for a path only ~4 m across, "a giant plywood table",
    // because the old loop started at the crossing's own widest offer
    // (`halfGap + ACROSS_MARGIN`, i.e. the full 2 m collision-safety margin
    // added on *both* sides) and accepted the very first candidate that
    // cleared — which is the widest one whenever the widest one clears at
    // all, so a deck was only ever narrower than that by accident, never by
    // choice. `USABLE_HALF_WIDTH_FLOOR` (`crossing.halfGap` itself, the
    // real, self-measured corridor a child's own path actually occupies —
    // see this floor's own note just above) is already the right *default*
    // width for a deck that reads as the path it carries, not a discount
    // rate to fall back on. Widening still happens, exactly the same way
    // narrowing used to: only when the narrower candidate at this shift
    // fails real collision, the loop keeps going outward from here.
    for (
      let halfAcross = USABLE_HALF_WIDTH_FLOOR;
      halfAcross <= crossing.halfGap + ACROSS_MARGIN;
      halfAcross += WIDTH_STEP
    ) {
      for (const fraction of SHIFT_FRACTIONS) {
        const shift = Math.max(-maxShift, Math.min(maxShift, fraction * halfAcross));
        // The crossing's own touch point — where the real, drawn path meets
        // the rail — must stay genuinely inside the shifted deck, not just
        // past its exact edge.
        if (Math.abs(shift) > halfAcross - MIN_DECK_HALF_WIDTH) continue;
        const centerX = crossing.x + acrossX * shift;
        const centerZ = crossing.z + acrossZ * shift;
        if (!deckClears(centerX, centerZ, halfAcross)) continue;
        const reachPos = provisionalReach(centerX, centerZ, halfAcross, 1);
        const reachNeg = provisionalReach(centerX, centerZ, halfAcross, -1);
        // Both sides, not the better one — see `WALKABLE_FLOOR`'s own note.
        // A path crosses this deck in either direction; a ramp missing on
        // one side is a sheer drop approached from that direction, not a
        // usable bridge with merely a worse approach.
        if (Math.min(reachPos, reachNeg) >= WALKABLE_FLOOR + WALKABLE_MARGIN) {
          return { crossingIndex: -1, cx: centerX, cz: centerZ, dirX, dirZ, acrossX, acrossZ, halfAcross };
        }
      }
    }
    return null;
  };

  /**
   * Gauss-Seidel, not Jacobi — each crossing's search sees every OTHER
   * crossing's **latest** result, including ones already updated earlier in
   * this very sweep, rather than a whole-array snapshot frozen at the start
   * of it. Updating the whole array at once from a single frozen snapshot
   * (this file's first version) let two mutually-adjacent crossings
   * perpetually flip-flop: each round, crossing A's search saw crossing B's
   * *previous* (wide, pre-conflict) answer and reclaimed the space crossing
   * B needed, while crossing B's search — reading the *same* frozen
   * snapshot — did the exact same thing back, so both rejected each other
   * every other round and forgave each other on the rounds between,
   * forever (found live, seed 11: rounds 0/2 both placed a 6.5 m-wide deck
   * each, rounds 1/3 both went `null`, and the code's own "retry a null
   * against whatever placed" rescue then picked the unsafe, mutually-blind
   * answer straight back up). Updating in place instead means crossing B's
   * search, run right after crossing A's in the same sweep, already knows
   * whatever A just decided — the two can still each shrink the other, but
   * neither can un-know what the other only just chose, which is what
   * actually settles it.
   */
  const current: (DeckPlan | null)[] = crossings.map(() => null);
  /** Every crossing index the most recent {@link resweep} call actually
   * changed — read after the sweep loop to tell a genuinely converged
   * answer from one the sweep bound merely cut off mid-oscillation. */
  let lastChangedIndices: number[] = [];
  const resweep = (): boolean => {
    lastChangedIndices = [];
    for (let index = 0; index < crossings.length; index += 1) {
      const siblings = current.filter((d, i): d is DeckPlan => i !== index && d !== null);
      const previous = current[index] ?? null;
      const next = searchDeck(crossings[index] as LevelCrossing, siblings, previous);
      if (
        (next === null) !== (previous === null) ||
        (next && previous && (next.halfAcross !== previous.halfAcross || next.cx !== previous.cx || next.cz !== previous.cz))
      ) {
        lastChangedIndices.push(index);
      }
      current[index] = next;
    }
    return lastChangedIndices.length > 0;
  };
  // Sweep until nothing changes any more, or a generous bound — the same
  // "cheap insurance, not a proof" this file's own tree-felling retry
  // already accepts. Every sweep after the first only ever tightens or
  // holds what an earlier one found (an extra, already-in-place sibling
  // only ever adds a genuine exemption or a genuine exclusion the built
  // park will actually enforce), so stopping early on "nothing changed" is
  // the true fixed point, not an approximation of one.
  const MAX_SWEEPS = 6;
  let converged = false;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep += 1) {
    if (!resweep()) {
      converged = true;
      break;
    }
  }
  // Convergence safety net (flagged reviewing PR #330: the sweep bound had
  // no check for non-convergence, and none of the 5 CI seeds happened to
  // exercise it). A crossing still changing on the very last sweep the
  // budget allowed for has never been seen stable against its siblings'
  // truly final answers — keeping it anyway would ship whichever of two (or
  // more) oscillating candidates the bound happened to cut off on, exactly
  // the "shrink to a hard floor and ship it" failure this whole search
  // exists to avoid (`CLAUDE.md`'s "procgen backtracks on collision"). Safer
  // to fall back to a level crossing for it — genuinely rare in practice
  // (oscillation needs two crossings close enough to fight over the same
  // ground, see `resweep`'s own note), and the fallback is real, tested
  // infrastructure (`fence.ts`), not a guess.
  if (!converged) {
    for (const index of lastChangedIndices) current[index] = null;
  }
  // A crossing still `null` here has been through a full, converged sweep —
  // every other crossing's own final answer was already visible to its own
  // search (see `resweep`'s own note) — and still found no width, at any
  // lateral shift, whose deck clears the real collision world (felling
  // considered — see `searchClear`'s own note) with a ramp reaching
  // {@link WALKABLE_FLOOR} on BOTH sides, OR was still oscillating when the
  // sweep bound ran out (see the convergence safety net just above). This
  // crossing genuinely cannot take a bridge; see this file's own header for
  // what happens next (a level crossing).
  const decksOrNull: (DeckPlan | null)[] = current;

  // --- pass 2: real, final ramp reach, now that every deck is fixed -------
  const decks: DeckPlan[] = decksOrNull
    .map((deck, crossingIndex) => (deck ? { ...deck, crossingIndex } : null))
    .filter((deck): deck is DeckPlan => deck !== null);

  return crossings.map((crossing, crossingIndex) => {
    const deck = decks.find((d) => d.crossingIndex === crossingIndex);
    if (!deck) return null; // see this file's own header: fall back to a level crossing

    const { cx, cz, dirX, dirZ, acrossX, acrossZ, halfAcross } = deck;
    const idealRampRun = idealRampRunFor(crossing, crossings);
    const otherDecks = decks.filter((d) => d.crossingIndex !== crossingIndex);
    // A genuinely dense sweep, not the sparse set `deckClears`/
    // `provisionalReach` searched candidates with — see `denseSampleTs`'s
    // own note for why pass 2 can afford, and needs, better than pass 1.
    // This deck's `(cx, cz)` is already fixed (pass 1's accepted answer), so
    // this runs exactly once for this crossing.
    const ts = denseSampleTs(crossing, cx, cz, acrossX, acrossZ, halfAcross);

    // Commit the deck's own footprint — the exact points `deckClears`
    // probed with `searchClear` (felling-considered, non-mutating) during
    // the search. Whatever candidate the search kept is this one, so a
    // point it only passed because a tree *could* be felled there genuinely
    // needs that tree gone now — this is the one real fell for the deck
    // itself, matching `clearAt` below's own fell for the ramps.
    for (const along of [-DECK_HALF_LENGTH, DECK_HALF_LENGTH]) {
      for (const t of ts) {
        const x = cx + dirX * along + acrossX * halfAcross * t;
        const z = cz + dirZ * along + acrossZ * halfAcross * t;
        commitFell(x, z);
      }
    }

    const clearAt = (along: number, sign: 1 | -1): boolean => {
      for (const t of ts) {
        const x = cx + dirX * along * sign + acrossX * halfAcross * t;
        const z = cz + dirZ * along * sign + acrossZ * halfAcross * t;
        // The one real fell per crossing (see `commitFell`'s own note) —
        // this deck is already the search's final, kept answer, so a tree
        // felled here is a tree the built park genuinely needed cleared.
        if (!commitFell(x, z)) return false;
        if (nearOtherGuardRail(otherDecks, x, z, GUARD_RAIL_MARGIN)) return false;
        if (distanceToRailCorridor(x, z) < FENCE_OFFSET + RAMP_RAIL_MARGIN) return false;
      }
      return true;
    };
    const rampReach = (sign: 1 | -1): number => {
      let rampRun = idealRampRun;
      // `DENSE_REAL_STEP`, not `WIDTH_STEP` — this is pass 2's own final
      // commit, exactly like `denseSampleTs`'s own width densification, and
      // for the same reason: a coarse 0.5 m along-step can step clean over
      // an obstacle whose own along-extent is narrower than that, exactly as
      // a coarse `t` step could across the width. Found paired with the
      // width fix, canonical seed: the width densification alone still
      // missed the same stone bench, because the *along* stepping that
      // decides which `t`-rows even get tested had already skipped past it.
      const steps = Math.max(1, Math.ceil(rampRun / DENSE_REAL_STEP));
      for (let i = 1; i <= steps; i += 1) {
        const along = DECK_HALF_LENGTH + (i / steps) * rampRun;
        if (!clearAt(along, sign)) {
          rampRun = Math.max(0, along - DECK_HALF_LENGTH - DENSE_REAL_STEP);
          break;
        }
      }
      const BACKOFF_STEP = 0.1;
      while (rampRun > 0 && !clearAt(DECK_HALF_LENGTH + rampRun, sign)) {
        rampRun = Math.max(0, rampRun - BACKOFF_STEP);
      }
      return rampRun;
    };

    const rampRunPos = rampReach(1);
    const rampRunNeg = rampReach(-1);

    // **Re-verify the same floor pass 1 accepted this candidate for, now
    // against pass 2's own denser, more accurate measurement — never ship a
    // bridge pass 2 itself has just proven does not actually clear it.**
    // Pass 1 accepts a candidate using `provisionalReach`'s cheaper,
    // sparse-`t` sampling (real cost: it runs for every width/shift
    // candidate the search tries, not just the one kept); pass 2 re-measures
    // the one, final, already-decided geometry with `denseSampleTs` and a
    // finer along-step, specifically so a real obstacle the sparse pass
    // could straddle does not silently ship. Found live, canonical seed:
    // pass 1's sparse check found `Math.min(reachPos, reachNeg) >= 7.58 m`
    // and accepted a heavily shifted deck; pass 2's dense re-check found the
    // *same* side's real reach was `0.00 m` — a sheer drop, not a ramp — the
    // exact obstacle `denseSampleTs`'s own header names (the shift put the
    // deck's real width mostly on one side of the crossing, and the sparse
    // sampling never happened to land inside the stone bench sitting on it).
    // Falling back to a level crossing here is this file's own header's
    // documented, expected outcome for a crossing that cannot actually take
    // a bridge — not a new kind of failure, just caught one pass later than
    // it should have been.
    if (Math.min(rampRunPos, rampRunNeg) < WALKABLE_FLOOR + WALKABLE_MARGIN) return null;

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

/** Capped by how close the *next* crossing is — two crossings closer
 * together than the ordinary grade's own ramp length would otherwise
 * overlap. Shared by both the deck search and the final ramp pass so
 * neither can disagree about how far a ramp is even trying to reach. */
function idealRampRunFor(crossing: LevelCrossing, crossings: readonly LevelCrossing[]): number {
  let nearestOtherCrossing = Infinity;
  for (const other of crossings) {
    if (other === crossing) continue;
    nearestOtherCrossing = Math.min(
      nearestOtherCrossing,
      Math.hypot(other.x - crossing.x, other.z - crossing.z),
    );
  }
  // The floor here must be at least {@link WALKABLE_FLOOR} +
  // {@link WALKABLE_MARGIN}, not `WALKABLE_FLOOR` alone — this is the
  // distance `searchDeck`'s own probe is capped at (see `provisionalReach`
  // and `rampReach`: both walk out to exactly `idealRampRunFor`'s answer and
  // never further), so a floor that stopped at `WALKABLE_FLOOR` made the
  // acceptance test's own `+ WALKABLE_MARGIN` mathematically unreachable
  // for any crossing whose spacing pins `rampRunCap` to this floor — the
  // ceiling was capped a half-metre short of the bar the search demanded to
  // clear it. Found live: every crossing on the canonical seed with a close
  // neighbour showed `idealRampRun` landing exactly on the old floor
  // (7.87 m) while the acceptance test asked for 8.37 m, so `Math.min` of
  // the two probed sides could never reach it — 0 of 7 crossings got a
  // bridge, all fell back to level crossings, until this floor rose to
  // match what accepting a candidate actually requires.
  const rampRunCap = Math.max(
    WALKABLE_FLOOR + WALKABLE_MARGIN,
    nearestOtherCrossing / 2 - DECK_HALF_LENGTH - RAMP_CLEARANCE,
  );
  return Math.min(BRIDGE_RISE / BRIDGE_RAMP_GRADIENT, rampRunCap);
}
