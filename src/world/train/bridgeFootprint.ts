import type { LevelCrossing } from './crossings';
import { frameFor, type SpineFrame } from './bridgeSpine';
import { BRIDGE_RISE, DECK_HALF_LENGTH } from './clearance';
import { ENTRANCE_RAMP } from '../building/layout';
import { GARDEN_PLAY_BOUNDARY } from '../boundary';
import { clearOfPlots } from '../parkLayout';
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

/** Re-exported from its leaf owner — see `clearance.ts`'s own note for why
 * it had to move there (an import cycle this module's `plan.ts` import
 * closed). Every reader of `bridgeFootprint.DECK_HALF_LENGTH` is unchanged. */
export { DECK_HALF_LENGTH } from './clearance';

/**
 * **How far a bridge's parapet really reaches along its own frame**, on the
 * side whose ramp runs `rampRun` past the deck — the deck's own half-length
 * plus that ramp.
 *
 * *One definition, published and consumed*, in the same shape as
 * `ShellGeometry.planEdge` on this branch. `bridges.ts` draws its parapet run
 * from `-parapetReachFor(rampRunNeg)` to `+parapetReachFor(rampRunPos)`, and
 * `planReal`'s cross-crossing exclusion ({@link planBridgeFootprints}'s
 * `nearOtherGuardRail`) clamps to the very same figure. They must agree, and
 * the only way to be sure they agree is for there to be one of them.
 *
 * They did not agree before (#349). The exclusion clamped to
 * {@link DECK_HALF_LENGTH} alone, modelling a neighbour's rail as 6.4 m long
 * when the built thing is more like 22 m, on the strength of a comment saying
 * parapets were built along the deck and "never a ramp" — true of an older
 * geometry, stale for years. Seed 2 built two bridges whose ramps run at each
 * other, and bridge 1's parapet came down across bridge 0's walked centreline
 * at `across = +0.11`, 8.73 m along its own frame: five and a half metres past
 * the end of the rail the exclusion believed in, and so completely invisible to
 * it. A walker climbing bridge 0's ramp hit a 2.98 m wall standing in the road.
 */
export function parapetReachFor(rampRun: number): number {
  return DECK_HALF_LENGTH + rampRun;
}

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
 * Bridge ramps climb at the same steepness the park's own front steps do —
 * derived from `ENTRANCE_RAMP`, never a separately chosen number, so a
 * retune of the entrance moves the bridges with it rather than leaving two
 * "how steep is a ramp here" answers to drift apart.
 */
export const BRIDGE_RAMP_GRADIENT =
  Math.abs(ENTRANCE_RAMP.yTo - ENTRANCE_RAMP.yFrom) / Math.abs(ENTRANCE_RAMP.to - ENTRANCE_RAMP.from);

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
export function maxLateralShiftFor(crossing: LevelCrossing): number {
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
export const WIDTH_STEP = 0.5;

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
export const SAMPLE_TS: readonly number[] = [-1, -0.9, -0.5, -0.45, 0, 0.45, 0.5, 0.9, 1];

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
 * **The ramp every accepted bridge achieves on _both_ sides** — the floor plus
 * its margin, as one published figure.
 *
 * Exported because it is not only the footprint search's own acceptance bar:
 * the *site* planner (`crossingPlanSolve.ts`) has to know it too, both to give
 * a site credit for enough ramp and to refuse to propose two crossings so close
 * together that two bridges cannot physically occupy them. That module used to
 * restate `BRIDGE_RISE / MAX_RAMP_GRADIENT + 0.5` by hand, which is the same
 * two-descriptions-of-one-object shape as #349's parapet reach, one layer up.
 */
export const MIN_RAMP_RUN = WALKABLE_FLOOR + WALKABLE_MARGIN;

/**
 * **Half the length of the shortest bridge this codebase will ever accept** —
 * its deck's own half-length plus the ramp it must achieve on that side.
 *
 * Two bridges whose ramps run at each other therefore need
 * `2 * MIN_BRIDGE_HALF_LENGTH` between them. Nothing enforced that until #392:
 * seed 2 planned two crossings **20.83 m** apart needing **28.54 m**, and the
 * footprint search discovered the conflict far too late to do anything but drop
 * one of them — after, in the #349 case, having built one bridge straight
 * through the other's parapet.
 */
export const MIN_BRIDGE_HALF_LENGTH = DECK_HALF_LENGTH + MIN_RAMP_RUN;

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
  /**
   * How far (x, z) stands from the solved rail corridor — `plan.ts`'s
   * `distanceToRailCorridor`, **handed in rather than imported**.
   *
   * This module used to import it directly, and that one import was the
   * closing edge of a cycle: `plan -> route -> crossingKeepOut/bridgeFit ->
   * bridgeFootprint -> plan`. Which module an entry point happened to reach
   * first then decided whether it blew up, so the browser and most checks were
   * fine and `check:park-boot` died with `ReferenceError: Cannot access
   * 'TrainRoute' before initialization`. Passing it is also the more honest
   * shape: everything else this search knows about the built world arrives
   * through this object, and the rail corridor is part of the built world.
   *
   * Only `planReal` needs it; the conservative pass has no railway to ask.
   */
  readonly railCorridorDistance: (x: number, z: number) => number;
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

// --------------------------------------------------------------------------
// The early, conservative reservation — no real collision world to ask yet.
// --------------------------------------------------------------------------

/**
 * The early, conservative reservation alone — what the scenery keep-out reads
 * (`bridgeKeepout.ts`). Its own entry point so that asking for it does not
 * reach the real search, which only build tooling runs.
 */
export function planConservativeFootprints(crossings: readonly LevelCrossing[]): BridgeFootprint[] {
  return planConservative(crossings);
}

export function planConservative(crossings: readonly LevelCrossing[]): BridgeFootprint[] {
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

/**
 * Everything the bridge search decides about one bridge — what a prebuilt
 * park records (`world/prebuilt/parkFile.ts`). The rest of a
 * {@link BridgeFootprint} is derived from these and the crossing.
 */
export interface BridgeDecision {
  readonly cx: number;
  readonly cz: number;
  readonly dirX: number;
  readonly dirZ: number;
  readonly acrossX: number;
  readonly acrossZ: number;
  readonly halfAcross: number;
  readonly shift: number;
  readonly rampRunPos: number;
  readonly rampRunNeg: number;
}

/**
 * A bridge's footprint from its decision — the one constructor, used by the
 * search's final pass and by a park hydrated from its file alike.
 */
export function footprintFromDecision(crossing: LevelCrossing, decision: BridgeDecision): BridgeFootprint {
  const frame = frameFor(crossing);
  const roadHalf = bridgeRoadHalfFor(crossing);
  const walkHalf = walkHalfFor(crossing);
  const { shift, rampRunPos, rampRunNeg } = decision;
  return {
    ...decision,
    roadHalf,
    walkHalf,
    frame,
    covers: (x: number, z: number, margin = 0): boolean => {
      const projected = frame.project(x, z, shift);
      if (Math.abs(projected.across) > walkHalf + margin) return false;
      const rampRun = projected.along >= 0 ? rampRunPos : rampRunNeg;
      return Math.abs(projected.along) <= DECK_HALF_LENGTH + rampRun + margin;
    },
  };
}

/**
 * The standable half-width of a crossing's bridge — see
 * {@link BridgeFootprint.walkHalf}'s own doc: the paved half-width less the
 * walker's own body, which is what the parapet's collision genuinely
 * leaves. One owner for the search's shift guard and the footprint's own
 * `covers`, so the two can never disagree about where a walker's centre
 * fits.
 */
export function walkHalfFor(crossing: LevelCrossing): number {
  return Math.max(bridgeRoadHalfFor(crossing) - PLAYER_RADIUS, MIN_DECK_HALF_WIDTH - PLAYER_RADIUS);
}
