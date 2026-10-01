import { frameFor, type SpineFrame } from '../../../src/world/train/bridgeSpine';
import { type LevelCrossing } from '../../../src/world/train/crossings';
import { isInEntranceGateway } from '../../../src/world/entrance/layout';
import { BRIDGE_RISE, DECK_HALF_LENGTH, FENCE_OFFSET } from '../../../src/world/train/clearance';
import { BRIDGE_RAMP_GRADIENT, BRIDGE_WALL_THICKNESS, MIN_RAMP_RUN, RAMP_CLEARANCE, REAL_PROBE_RADIUS, SAMPLE_TS, WIDTH_STEP, bridgeRoadHalfFor, footprintFromDecision, maxLateralShiftFor, parapetReachFor, planConservative, type BridgeDecision, type BridgeFootprint, type PlannedFootprint, type RealWorldQuery, walkHalfFor } from '../../../src/world/train/bridgeFootprint';
/**
 * **The bridge footprint search** — deck width, lateral shift and ramp reach
 * against the real collision world. Moved verbatim from
 * `src/world/train/bridgeFootprint.ts`, which keeps the footprint types and
 * builds a footprint from its decision. Build-time only.
 */

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
 * Fractions of the *current candidate width* tried as a lateral shift, in
 * the order tried — natural centre first, then increasingly large nudges
 * either way. Scaled by the candidate's own `halfAcross` (rather than a
 * flat metre figure) so a shift never asks a narrow deck to slide further
 * than its own width could plausibly still cover the original crossing
 * point, and clamped again against {@link maxLateralShiftFor} regardless.
 */
const SHIFT_FRACTIONS: readonly number[] = [0, 0.35, -0.35, 0.7, -0.7];


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
  /**
   * The deck's own curved frame, so {@link nearOtherGuardRail} can project a
   * probe onto a neighbour the way that neighbour is actually laid out.
   *
   * The straight `cx`/`dirX` approximation above is fine over the deck's own
   * ±3.2 m, which is all the exclusion used to look at. It is not fine over a
   * parapet that runs 11 m up a curved spine, where extrapolating the tangent
   * puts the modelled rail metres from the built one — so the exclusion asks
   * the frame instead, and the straight fields stay for pass 2's own use.
   */
  readonly frame: SpineFrame;
  /**
   * How far this deck's ramps reach past it, and so — through
   * {@link parapetReachFor} — how far its parapet really runs. Carried on the
   * plan because a *sibling* has to know it: see {@link parapetReachFor}.
   */
  readonly rampRunPos: number;
  readonly rampRunNeg: number;
}


/**
 * **A bridge is only ever built where `crossingPlanSolve.ts` proved one fits**
 * (issue #414). `LGP_ALLOW_UNPROVEN_BRIDGES=1` restores the old, opportunistic
 * behaviour — kept as a one-flag reversal, not as a supported mode.
 *
 * ## Why
 *
 * The whole point of planning crossing sites before drawing paths is that
 * *"the drawn network only ever meets the railway where a bridge belongs"*.
 * That premise used to be silently untrue on four of the five swept seeds:
 * the planner proved no bridge at a site, offered it as a level crossing,
 * `paths.ts` laid the network out for flat ground — and this pass then built
 * a bridge there anyway, against the finished park, using levers the planner
 * has not got (lateral shift, a narrower deck, felling a tree). Nothing
 * re-planned the paths afterwards, so a connector drawn for level ground
 * ended up climbing a ramp it never knew about, and Jim reported the same
 * bridge three times.
 *
 * ## The measurement that settled it
 *
 * Measured (`scripts/measure-prover-vs-builder.mts`), the planner and this
 * pass do not disagree by a little: at every such site the planner finds the
 * deck blocked outright, or a ramp reach of **0.0–5.4 m against a 12.1 m
 * floor**. So "the planner is too strict" is not the explanation, and
 * relaxing it was never the fix.
 *
 * Refusing costs four bridges across the sweep seeds and **nothing on the
 * canonical one**, which keeps all three of its (proven) bridges. What
 * replaces them is not a hole: all eleven crossings that lose a bridge are
 * walkable straight through, asked of the real `NavGrid`
 * (`scripts/measure-level-crossing-walkability.mts`). And the stranding runs
 * the other way from the obvious guess — seeds 5 and 18 pass `check:park`
 * outright for the first time (39 → 0 and 6 → 0 stranded waypoints), because
 * an opportunistic bridge is exactly what was stranding them.
 *
 * ## Why refusing, rather than re-planning the paths
 *
 * The other way round would work too: build the bridge, then re-plan the
 * network around it. It is much the bigger change, and it buys a bridge in
 * exactly the places the planner has already said a walkable ramp does not
 * fit — so the deck would still be reached by a ramp shorter than
 * `WALKABLE_FLOOR`, which is the thing the floor exists to prevent. Refusing
 * keeps one rule ("a bridge stands only where one provably fits") instead of
 * two mechanisms that have to agree.
 *
 * Since 2 Sep 2026 there is nothing to reverse INTO: every crossing that
 * reaches this pass snapped to a proven site (`crossings.ts` fails the build
 * on one that did not), so the gate below is vacuous by construction and
 * the old `LGP_ALLOW_UNPROVEN_BRIDGES` reversal is gone with the level tier
 * it re-enabled.
 */
function planReal(crossings: readonly LevelCrossing[], real: RealWorldQuery): PlannedFootprint[] {
  const { collision, clearTreesNear, hasFellableTreeNear, railCorridorDistance } = real;
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
    collision.playBounds.distanceToEdge(x, z) >= REAL_PROBE_RADIUS &&
    // **Never into the park's own front doorway** (#414, #437). The same
    // predicate `crossingPlanSolve.ts` plans against, asked here because this
    // search has levers the planner has not -- a lateral shift, a narrower
    // deck, a felled tree -- and used them to run a ramp the planner had
    // stopped at the arch straight back through it. Measured on the canonical
    // seed the moment the paths moved: `gate-approach` ended at (0.0, 54.0),
    // 0.70 m up on a bridge, against a child's 0.62 m step-up. One owner
    // (`entrance/layout.ts`), read from both directions.
    !isInEntranceGateway(x, z);

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
   * wall `bridges.ts` stands along each long edge of the hump, **deck and both
   * ramps alike**, out at the structural edge and running
   * {@link parapetReachFor} either way. It is not a real,
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
      // Projected onto the neighbour's own curved frame, shift included — the
      // line its parapet is actually built along (`bridges.ts` lays every wall
      // segment with `frame.worldAt(along, wallLine * side, shift)`). The old
      // straight projection off `cx`/`dirX` was adequate only because the
      // clamp below never looked more than 3.2 m from the deck centre; over a
      // parapet's real 11 m reach a tangent extrapolation misses a curved
      // bridge by metres.
      const { along, across } = deck.frame.project(x, z, deck.shift);
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
      // **The rail's real span, asked of the one thing that defines it.** Not
      // `±DECK_HALF_LENGTH`: the parapet runs the whole hump, deck and both
      // ramps, and clamping to the deck alone is what let seed 2's two bridges
      // plan their ramps through each other (#349 — see `parapetReachFor`).
      const alongClamped = Math.max(
        -parapetReachFor(deck.rampRunNeg),
        Math.min(parapetReachFor(deck.rampRunPos), along),
      );
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
              `  ramp ${sign > 0 ? '+' : '-'} blocked at along=${along.toFixed(1)} t=${t.toFixed(2)} (${x.toFixed(1)},${z.toFixed(1)}) ` +
              `[${collision.describeNear(x, z, REAL_PROBE_RADIUS, 0.5).join('; ') || 'nothing within 0.5 m — bounds or gateway'}]: ` +
                (!collision.isClearCircle(x, z, REAL_PROBE_RADIUS)
                  ? 'collider'
                  : collision.playBounds.distanceToEdge(x, z) < REAL_PROBE_RADIUS
                    ? 'playBounds'
                    : 'guardRail'),
            );
            blocked = true;
            break;
          }
          if (railCorridorDistance(x, z) < FENCE_OFFSET + RAMP_RAIL_MARGIN) {
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
        MIN_RAMP_RUN
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
      if (Math.min(reachPos, reachNeg) >= MIN_RAMP_RUN) {
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
          frame,
          // Pass 1's own provisional reaches — the best answer available at
          // the moment this candidate is accepted, and the same figures pass 2
          // starts from. A sibling reading them models this parapet at the
          // length this deck currently believes it will be.
          rampRunPos: reachPos,
          rampRunNeg: reachNeg,
        };
      }
      debugBridge?.(
        `crossing railD=${crossing.railDistance.toFixed(1)} w=${halfAcross.toFixed(1)} shift=${shift.toFixed(1)}: reach +${reachPos.toFixed(1)}/-${reachNeg.toFixed(1)} < ${MIN_RAMP_RUN.toFixed(2)}`,
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
      // Every crossing here snapped to a site the planner proved a deck and
      // both ramps onto (`crossings.ts` fails the build on one that did
      // not), so this search runs for all of them.
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
    if (!deck) return null; // buildBridges fails the build on this — there is no level fallback

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
        if (railCorridorDistance(x, z) < FENCE_OFFSET + RAMP_RAIL_MARGIN) return false;
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

    return footprintFromDecision(crossing, {
      cx,
      cz,
      dirX,
      dirZ,
      acrossX,
      acrossZ,
      halfAcross,
      shift,
      rampRunPos,
      rampRunNeg,
    });
  });
}


/** The decision a footprint came from. */
export function bridgeDecisionOf(footprint: BridgeFootprint): BridgeDecision {
  const { cx, cz, dirX, dirZ, acrossX, acrossZ, halfAcross, shift, rampRunPos, rampRunNeg } = footprint;
  return { cx, cz, dirX, dirZ, acrossX, acrossZ, halfAcross, shift, rampRunPos, rampRunNeg };
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
    MIN_RAMP_RUN,
    nearestOtherCrossing / 2 - DECK_HALF_LENGTH - RAMP_CLEARANCE,
  );
  return Math.min(BRIDGE_RISE / BRIDGE_RAMP_GRADIENT, rampRunCap);
}
