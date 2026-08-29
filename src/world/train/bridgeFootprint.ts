import type { LevelCrossing } from './crossings';
import { frameFor, type SpineFrame } from './bridgeSpine';
import { BRIDGE_RISE, FENCE_OFFSET } from './clearance';
import { ENTRANCE_RAMP } from '../building/layout';
import { GARDEN_PLAY_BOUNDARY } from '../boundary';
import { clearOfPlots } from '../parkLayout';
import { distanceToRailCorridor } from './plan';
import type { CollisionWorld } from '../Collision';
import { PATH_KERB_OVERHANG, PLAYER_RADIUS, SPRINT_PEAK_GRADE_BUDGET } from '../../core/constants';

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
 * Fraction of each side's length spent easing the grade in and out — the
 * hump's slope profile is a cosine-blended trapezoid: zero slope at the crown
 * and at the foot, a constant grade in the middle, cosine blends between.
 *
 * **Peak slope is `1 / (1 - HUMP_BLEND)` times the average grade** (1.33x at
 * 0.25), and that ratio is the whole reason this is a trapezoid and not a
 * smootherstep (1.875x): the peak is what the walk physics actually judge, so
 * a shape with a tall peak spends the whole of
 * {@link SPRINT_PEAK_GRADE_BUDGET} on a moment of the ramp. A smootherstep's
 * 0.79 peak on the canonical seed's cramped bridge put her over the ceiling,
 * and real-browser QA watched her lose the surface at the steep section, fall
 * into the tunnel and jam against the fence.
 *
 * Lives here rather than in `bridges.ts` (which re-exports it) because
 * {@link MAX_RAMP_GRADIENT} below needs it to turn a peak budget into an
 * average grade, and `bridges.ts` already imports from this file — the other
 * direction would be an import cycle.
 */
export const HUMP_BLEND = 0.25;

/**
 * **The steepest a ramp may ever be forced to** — when two crossings land close
 * enough together that {@link BRIDGE_RAMP_GRADIENT} would overlap them, and,
 * through {@link WALKABLE_FLOOR}, the shortest ramp that still counts as a
 * walkable approach at all.
 *
 * **Derived from the player, not from the nav lattice.** It used to be a flat
 * `0.6`, justified against `NavGrid`'s ~1.24 linking slope — which is the wrong
 * authority twice over: `NavGrid` decides whether an *NPC router* thinks two
 * nodes are one level, and it says nothing about whether a *child* can run up
 * the thing. The real ceiling is {@link SPRINT_PEAK_GRADE_BUDGET}: past it a
 * sprinting player on a slow device loses the deck under her feet and falls
 * through it into the tunnel.
 *
 * That budget is on the hump's **peak**, and a ramp's quoted grade is its
 * *average* — the cosine-blended trapezoid peaks at `1 / (1 - HUMP_BLEND)`
 * times it — so the average is discounted by that factor here.
 *
 * **What the old 0.6 actually shipped.** `WALKABLE_FLOOR` is
 * `BRIDGE_RISE / this`, so 0.6 let the planner truncate a ramp to 6.77 m
 * (7.25 m with its acceptance slack) and call it done. Measured on the built
 * park, seeds 2 and 18 had bridges whose ramps stood at exactly that floor —
 * 48% of the ideal run, a realised grade of **0.560** against a peak budget of
 * 0.512 — and browser QA of PR #352 duly fell through 6 sprinted runs out of
 * 32. This is CLAUDE.md's own "never shrink to a floor and accept a result that
 * still doesn't clear", with the floor itself as the thing that did not clear.
 *
 * A crossing that cannot be given a ramp this long now falls back to a level
 * crossing, which is the existing, safe alternative — a slightly duller park is
 * the correct trade against a child falling through a bridge.
 */
export const MAX_RAMP_GRADIENT = SPRINT_PEAK_GRADE_BUDGET * (1 - HUMP_BLEND);

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

/**
 * Full thickness of a bridge's own masonry side wall (the spandrel face,
 * carried up past the road as the parapet). The structural half-width the
 * search must clear is the paved half-width plus this — the wall stands
 * just outside the road, so obstacles are probed out to its own outer face,
 * not merely the paving's edge. One owner: `bridges.ts` builds the wall
 * meshes and their colliders from this same number.
 */
export const BRIDGE_WALL_THICKNESS = 0.3;

/**
 * **The half-width of the road a bridge carries — the one owner (issue
 * #349).**
 *
 * The *drawn* path is wider than its paved surface: `pathGraph.ts` draws the
 * cream kerb {@link PATH_KERB_OVERHANG} proud of the sandy surface on each
 * side, so what a child sees as "the path" is `pathHalfWidth +
 * PATH_KERB_OVERHANG` across. A bridge built to `pathHalfWidth` alone is
 * 0.425 m per side too narrow to carry the path it is carrying, and the kerb
 * was never going to land on stone.
 *
 * That is what issue #349 was: `bridges.ts` lifted path vertices out to
 * `roadHalf + PATH_KERB_OVERHANG + PATH_CARRIER_SLACK` while the masonry was
 * only swept to `roadHalf + BRIDGE_WALL_THICKNESS`, so up to 0.375 m of
 * paving hung in mid-air past the parapet at the hump's own height — the
 * sandy wedge poking out of the spandrel in Jim's screenshot. The two numbers
 * were derived independently from the same crossing and nothing held them
 * together: CLAUDE.md's "two definitions of one thing, kept in step by hand".
 *
 * So the road is defined **once, here, as the drawn paving's own width**, and
 * everything else is measured off it: the parapets' inner faces stand at this
 * line, {@link BridgeFootprint.halfAcross} is this plus the wall, and
 * `bridges.ts`'s `pavingHeightAt` clamps its lift test to that `halfAcross`.
 * The stone is then the single authority on where the paving ends, and the
 * kerb's outer edge sits a full `BRIDGE_WALL_THICKNESS` *inside* it rather
 * than 0.125 m outside.
 *
 * Note this widens the deck by 0.85 m overall, which the footprint search has
 * to find room for — see `planReal`, and the invariant
 * `plannedBridgeSiteDistances` that proves no crossing lost its bridge to a
 * level crossing because of it.
 *
 * Jim's 2026-08-23 ruling "the bridge is as wide as the path, no wider" is
 * unchanged and is exactly what this expresses; only *which* width counts as
 * "the path" is corrected, from the paving alone to the paving as drawn.
 */
export function bridgeRoadHalfFor(crossing: LevelCrossing): number {
  return crossing.pathHalfWidth + PATH_KERB_OVERHANG;
}

/** Coarse step the ramp-reach probes walk by. */
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
  frame: SpineFrame,
  crossing: { x: number; z: number },
  shift: number,
  halfAcross: number,
): readonly number[] {
  const crossingT = frame.project(crossing.x, crossing.z, shift).across / halfAcross;
  return [...SAMPLE_TS, Math.max(-1, Math.min(1, crossingT))];
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
 * Exported because it is the *one* definition of "how much daylight the
 * bridge search demands around a probe point" — `LampPosts.ts` sizes its
 * own keep-back off this exact figure. A lamp placed clear of a smaller,
 * hand-copied margin still reads as "blocked" to this search, 0.2 m short
 * of what it needs — the dominant single cause of blocked ramp reach in PR
 * #330's traces, and CLAUDE.md's "two definitions of one thing" disease in
 * its purest form.
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
  /**
   * Structural half-width — the outer face of the masonry side walls, what
   * the search probes obstacles out to. `roadHalf + BRIDGE_WALL_THICKNESS`
   * on a real footprint; the (much wider) reservation width on a
   * conservative one.
   */
  readonly halfAcross: number;
  /**
   * Paved half-width — the **drawn** path's own half-width, kerb included
   * ({@link bridgeRoadHalfFor}; Jim, 2026-08-23: the bridge is as wide as the
   * path, no wider). The parapets' inner faces stand here.
   */
  readonly roadHalf: number;
  /**
   * Standable half-width — how far off the centreline a walker's own
   * *centre* can really stand between the parapets: {@link roadHalf} less
   * the walker's body (`PLAYER_RADIUS`). This is the honest extent
   * `covers()`/`deckCovers()` report, because "covers" has always meant
   * "walkable here" to every consumer (NavGrid's exemption, the
   * invariants' probes) — a wall-to-wall figure would read as promising
   * standability inside the parapet's own collision reach.
   */
  readonly walkHalf: number;
  /**
   * The curved local frame the whole bridge is laid out in (the drawn
   * path's own centreline through the crossing — `bridgeSpine.ts`), plus
   * the lateral shift the search settled on. `bridges.ts` builds every
   * mesh, collider and surface through these two rather than re-deriving a
   * straight frame of its own.
   */
  readonly frame: SpineFrame;
  readonly shift: number;
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

    // **The reservation runs the full ideal ramp on both sides, always.**
    // It used to truncate where the boundary, a plot or the rail's own
    // curving corridor intersected the *reserved* (maximally padded) width —
    // but this footprint's one job is keeping movable scatter (trees, lamps,
    // maze walls) off ground the real, late pass may want, and truncation
    // only ever *removes* protection: reserving ground that overlaps a plot
    // or lies outside the boundary is harmless (nothing scatters there
    // anyway), while a reservation cut short is exactly how a lamp ended up
    // standing 8 m down a ramp the real pass then needed (canonical seed,
    // crossing at railDistance 172, 2026-08-23 — and the same disease
    // `HANDOFF-bridge-backtrack-continue.md` left as its open question).
    const idealRampRun = BRIDGE_RISE / BRIDGE_RAMP_GRADIENT;
    const rampRunPos = idealRampRun;
    const rampRunNeg = idealRampRun;

    return {
      cx,
      cz,
      dirX,
      dirZ,
      acrossX,
      acrossZ,
      halfAcross: reservedHalfAcross,
      // A reservation has no road or parapet of its own — the whole
      // reserved width is what scenery must stay off, so both figures are
      // the reservation itself. Only `bridges.ts` reads these for real
      // geometry, and it only ever consumes the *real* pass's footprints.
      roadHalf: reservedHalfAcross,
      walkHalf: reservedHalfAcross,
      frame: frameFor(crossing),
      shift: 0,
      rampRunPos,
      rampRunNeg,
      // Straight rectangle on purpose, spine or no spine: this pass's one
      // job is a conservative superset of wherever the real, curved bridge
      // can land, and the real frame's own deviation cap
      // (`bridgeSpine.ts`'s `DEVIATION_CAP`, 3 m) plus the search's own
      // lateral shift are both comfortably inside the
      // `maxLateralShiftFor` padding above.
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
  /** The shifted frame at `along = 0` — a straight approximation of the
   * deck used only for the cross-crossing guard-rail exclusion
   * (`nearOtherGuardRail`); everything about this crossing's own geometry
   * goes through the frame instead. */
  readonly cx: number;
  readonly cz: number;
  readonly dirX: number;
  readonly dirZ: number;
  readonly acrossX: number;
  readonly acrossZ: number;
  /** Structural half-width (`roadHalf + BRIDGE_WALL_THICKNESS`). */
  readonly halfAcross: number;
  /** Lateral shift of the whole frame — the search's dodge lever. */
  readonly shift: number;
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

  /** Node-only diagnostics (`LGP_DEBUG_BRIDGE=1 npm run check:park` etc.):
   * says, per rejected candidate, what actually stopped it — absent in the
   * browser bundle, and silent without the flag. */
  const debugBridge = (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[
    'LGP_DEBUG_BRIDGE'
  ]
    ? (message: string): void => {
        (globalThis as unknown as { process: { stdout: { write: (s: string) => void } } }).process.stdout.write(
          `bridge: ${message}\n`,
        );
      }
    : null;

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
      // The parapet stands at the structural edge itself now (`halfAcross`
      // already includes the wall's own thickness) — not `ACROSS_MARGIN`
      // further out, which was the old wide-deck geometry's rail line.
      const railAcross = deck.halfAcross;
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
    const frame = frameFor(crossing);
    const idealRampRun = idealRampRunFor(crossing, crossings);
    // NOTE: a ramp may run past the frame's `trustedReach` — beyond the
    // spine's trimmed end the frame extrapolates straight, and a hump foot
    // landing on plain lawn past its path's own turn is fine (walkers
    // route over grass; the old geometry always did this). A cap at the
    // trusted reach was tried and reverted: on seed 2 every site's
    // straight promise is pinch-curtailed to ~7 m, the cap starved every
    // ramp below `WALKABLE_FLOOR`, and the seed lost all three of its
    // bridges. What actually keeps the extrapolated run honest is the
    // same rule as everywhere else: the probes below walk it against the
    // real collision world and truncate on whatever is genuinely there.
    // **The width is not a search lever any more.** Jim, 2026-08-23: the
    // bridge deck is exactly as wide as the path that crosses it — so the
    // structural width is the path's own paved width plus the masonry
    // walls, full stop. The search still backtracks, but only on the
    // levers that keep that promise: lateral shift (below), tree felling
    // (`searchClear`), and — last of all — the level-crossing fallback.
    const halfAcross = bridgeRoadHalfFor(crossing) + BRIDGE_WALL_THICKNESS;

    const deckClears = (shift: number): boolean => {
      const ts = sampleTsFor(frame, crossing, shift, halfAcross);
      for (const along of [-DECK_HALF_LENGTH, DECK_HALF_LENGTH]) {
        for (const t of ts) {
          const { x, z } = frame.worldAt(along, halfAcross * t, shift);
          if (!searchClear(x, z)) return false;
          if (nearOtherGuardRail(siblingDecks, x, z, GUARD_RAIL_MARGIN)) return false;
        }
      }
      return true;
    };
    // Provisional probe of one ramp side, used only to decide whether a
    // candidate shift is even worth locking in — pass 2 re-measures the
    // real, final reach with every other crossing's deck fully in place.
    const provisionalReach = (shift: number, sign: 1 | -1): number => {
      const rampRun = idealRampRun;
      const steps = Math.max(1, Math.ceil(rampRun / WIDTH_STEP));
      const ts = sampleTsFor(frame, crossing, shift, halfAcross);
      for (let i = 1; i <= steps; i += 1) {
        const along = DECK_HALF_LENGTH + (i / steps) * rampRun;
        let blocked = false;
        for (const t of ts) {
          const { x, z } = frame.worldAt(along * sign, halfAcross * t, shift);
          if (!searchClear(x, z) || nearOtherGuardRail(siblingDecks, x, z, GUARD_RAIL_MARGIN)) {
            debugBridge?.(
              `  ramp ${sign > 0 ? '+' : '-'} blocked at along=${along.toFixed(1)} t=${t.toFixed(2)} (${x.toFixed(1)},${z.toFixed(1)}): ` +
                (!collision.isClearCircle(x, z, REAL_PROBE_RADIUS)
                  ? 'collider'
                  : collision.playBounds.distanceToEdge(x, z) < REAL_PROBE_RADIUS
                    ? 'playBounds'
                    : 'guardRail'),
            );
            blocked = true;
            break;
          }
          if (distanceToRailCorridor(x, z) < FENCE_OFFSET + RAMP_RAIL_MARGIN) {
            debugBridge?.(
              `  ramp ${sign > 0 ? '+' : '-'} blocked at along=${along.toFixed(1)} t=${t.toFixed(2)} (${x.toFixed(1)},${z.toFixed(1)}): rail corridor`,
            );
            blocked = true;
            break;
          }
        }
        if (blocked) return Math.max(0, along - DECK_HALF_LENGTH - WIDTH_STEP);
      }
      return rampRun;
    };

    // Keep a still-valid previous answer rather than re-searching — see
    // this function's own header for why. `existing` was itself only ever
    // accepted because it once passed exactly these same two checks, so
    // re-running them against the *current* siblings is the whole test: if
    // a sibling has newly encroached, this legitimately fails and falls
    // through to a real re-search below; otherwise this crossing's answer
    // does not change shape just because something elsewhere did.
    if (
      existing &&
      deckClears(existing.shift) &&
      Math.min(provisionalReach(existing.shift, 1), provisionalReach(existing.shift, -1)) >=
        WALKABLE_FLOOR + WALKABLE_MARGIN
    ) {
      return existing;
    }

    const maxShift = maxLateralShiftFor(crossing);
    for (const fraction of SHIFT_FRACTIONS) {
      const shift = Math.max(-maxShift, Math.min(maxShift, fraction * halfAcross));
      // The crossing's own touch point — where the real, drawn path meets
      // the rail — must stay genuinely STANDABLE on the shifted deck (not
      // merely inside the masonry): a shift past the walkable half-width
      // parks the parapet on the path's own centreline.
      if (Math.abs(shift) > Math.max(0, walkHalfFor(crossing) - 0.1)) continue;
      if (!deckClears(shift)) {
        debugBridge?.(
          `crossing railD=${crossing.railDistance.toFixed(1)} w=${halfAcross.toFixed(1)} shift=${shift.toFixed(1)}: deck blocked`,
        );
        continue;
      }
      const reachPos = provisionalReach(shift, 1);
      const reachNeg = provisionalReach(shift, -1);
      // Both sides, not the better one — see `WALKABLE_FLOOR`'s own note.
      // A path crosses this deck in either direction; a ramp missing on
      // one side is a sheer drop approached from that direction, not a
      // usable bridge with merely a worse approach.
      if (Math.min(reachPos, reachNeg) >= WALKABLE_FLOOR + WALKABLE_MARGIN) {
        const origin = frame.worldAt(0, 0, shift);
        const at = frame.pointAt(0);
        return {
          crossingIndex: -1,
          cx: origin.x,
          cz: origin.z,
          dirX: at.dirX,
          dirZ: at.dirZ,
          acrossX: at.acrossX,
          acrossZ: at.acrossZ,
          halfAcross,
          shift,
        };
      }
      debugBridge?.(
        `crossing railD=${crossing.railDistance.toFixed(1)} w=${halfAcross.toFixed(1)} shift=${shift.toFixed(1)}: reach +${reachPos.toFixed(1)}/-${reachNeg.toFixed(1)} < ${(WALKABLE_FLOOR + WALKABLE_MARGIN).toFixed(2)}`,
      );
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

    const { cx, cz, dirX, dirZ, acrossX, acrossZ, halfAcross, shift } = deck;
    const frame = frameFor(crossing);
    const idealRampRun = idealRampRunFor(crossing, crossings);
    const otherDecks = decks.filter((d) => d.crossingIndex !== crossingIndex);
    // Same augmented set `deckClears`/`provisionalReach` searched with —
    // see `sampleTsFor`'s own note. This deck's shift is already fixed
    // (pass 1's accepted answer), so this is the one, fixed extra `t` every
    // sample loop below adds.
    const ts = sampleTsFor(frame, crossing, shift, halfAcross);

    // Commit the deck's own footprint — the exact points `deckClears`
    // probed with `searchClear` (felling-considered, non-mutating) during
    // the search. Whatever candidate the search kept is this one, so a
    // point it only passed because a tree *could* be felled there genuinely
    // needs that tree gone now — this is the one real fell for the deck
    // itself, matching `clearAt` below's own fell for the ramps.
    for (const along of [-DECK_HALF_LENGTH, DECK_HALF_LENGTH]) {
      for (const t of ts) {
        const { x, z } = frame.worldAt(along, halfAcross * t, shift);
        commitFell(x, z);
      }
    }

    const clearAt = (along: number, sign: 1 | -1): boolean => {
      for (const t of ts) {
        const { x, z } = frame.worldAt(along * sign, halfAcross * t, shift);
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
      const steps = Math.max(1, Math.ceil(rampRun / WIDTH_STEP));
      for (let i = 1; i <= steps; i += 1) {
        const along = DECK_HALF_LENGTH + (i / steps) * rampRun;
        if (!clearAt(along, sign)) {
          rampRun = Math.max(0, along - DECK_HALF_LENGTH - WIDTH_STEP);
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
    const roadHalf = bridgeRoadHalfFor(crossing);
    const walkHalf = walkHalfFor(crossing);

    return {
      cx,
      cz,
      dirX,
      dirZ,
      acrossX,
      acrossZ,
      halfAcross,
      roadHalf,
      walkHalf,
      frame,
      shift,
      rampRunPos,
      rampRunNeg,
      covers: (x: number, z: number, margin = 0): boolean => {
        const projected = frame.project(x, z, shift);
        if (Math.abs(projected.across) > walkHalf + margin) return false;
        const rampRun = projected.along >= 0 ? rampRunPos : rampRunNeg;
        return Math.abs(projected.along) <= DECK_HALF_LENGTH + rampRun + margin;
      },
    };
  });
}

/**
 * The standable half-width of a crossing's bridge — see
 * {@link BridgeFootprint.walkHalf}'s own doc: the paved half-width less the
 * walker's own body, which is what the parapet's collision genuinely
 * leaves. One owner for the search's shift guard and the footprint's own
 * `covers`, so the two can never disagree about where a walker's centre
 * fits.
 */
function walkHalfFor(crossing: LevelCrossing): number {
  return Math.max(bridgeRoadHalfFor(crossing) - PLAYER_RADIUS, MIN_DECK_HALF_WIDTH - PLAYER_RADIUS);
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
