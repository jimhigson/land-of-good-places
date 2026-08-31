import { Vector3 } from 'three';
import { PLAYER_RADIUS } from '../../core/constants';
import { PARK_LAYOUT } from '../parkLayout';
import { distanceToPath } from '../pathGraph';
import { terrainHeight } from '../terrain';
import { POST_FOOT_RADIUS } from '../railRace/trestleGeometry';
import type { RailSampler } from '../rail/sweptRail';

/**
 * Debug only: narrate why each slot that ends up without a pylon was refused.
 * `LGP_DEBUG_PYLONS=1`. Same shape as `paths.ts`'s `LGP_DEBUG_STREETS` — a gap
 * in the supports is otherwise indistinguishable from a slot that never had a
 * candidate, and the difference is the whole diagnosis.
 */
const DEBUG_PYLONS = ((): boolean => {
  try {
    const nodeProcess = (globalThis as { process?: { env?: Record<string, string> } }).process;
    return (nodeProcess?.env?.['LGP_DEBUG_PYLONS'] ?? null) !== null;
  } catch {
    return false;
  }
})();

/**
 * **Where the Sky Cruiser's supports stand.**
 *
 * Split out of `Coaster.buildTrack` as a pure function, the way
 * `slide/supports.ts` splits `planSlideLegs` out of building the meshes, so
 * `test/procgen/invariants.ts` can measure the choice — and so the collision
 * registration happens once, at a point the caller controls.
 *
 * ## Why this exists: four pylons on 217 m of track
 *
 * Jim, 5 August 2026: "the skyride also needs supports". It already had them.
 * Measured on the canonical seed, it had **four**, spread over a 217 m loop, so
 * the ride read as floating — which is exactly what he was looking at.
 *
 * The cause was a keep-out test that had quietly become a keep-out of the whole
 * park. `Coaster.buildTrack` rejected any candidate within
 * `entry.boundingRadius + 2.4` of a `PARK_LAYOUT` entry, with a comment
 * explaining it was there to stop a post pinching shut "the 5 m gap between two
 * plots". But `boundingRadius` is 19 m for the castle, 15 m for the dodgems and
 * the water fight, 10.5 m for the fountain — and the Sky Cruiser is a ride whose
 * whole point is flying **over** those things, including straight through the
 * castle (#213). The rule therefore banned nearly every metre of its own route.
 * Of 38 candidates: 28 rejected by that test alone, against 11 for the paved
 * network and 9 for genuine obstruction. Blame, by plot: dodgems 8, castle 7,
 * water fight 6, ball pit 4, fountain 4.
 *
 * **The slide hit this exact bug and fixed it two days earlier** —
 * `slide/supports.ts`'s `JOINED_PLOTS`, whose note reads "37 otherwise-perfect
 * spots rejected, 0 legs built, a 95 m chute left floating and nothing said so".
 * Same disease, second organ. This file takes that fix and removes its one weak
 * point: {@link plotsThisRideSpans} works out which plots the ride flies over by
 * **asking the route**, rather than naming them in a hand-maintained set that
 * nothing checks and that goes stale the day the park is re-laid.
 *
 * ## The second organ: a tree is not a wall (issue #301)
 *
 * Fixing the plot keep-out did not fix the whole ride. Jim, playing, spotted a
 * long stretch with no supports at all running straight through a dense tree
 * and bush cluster — his own diagnosis, correct: `isClear` below asks the
 * general collision world, which cannot tell a tree from a wall, so a
 * candidate standing in even one tree's trunk collider was refused exactly as
 * hard as one standing in the castle's wall. His ruling was that a park would
 * simply clear the ground it needs: *"it is very reasonable to assume that the
 * park would cut down trees that would stop them supporting their rides"*.
 * `clearTreesNear` below is that clearing, and it is deliberately narrow — it
 * only ever removes a tree, real ones felled by `Scenery.clearTreesNear`, so a
 * spot that is blocked by a wall, a booth or the paved network is refused
 * exactly as before.
 *
 * What is *not* relaxed: a pylon still has to stand on ground that is clear, off
 * the paved network, out of a stall's approach, and clear of its neighbours.
 * Those are measurements of the built world. The plot circle was a proxy, and it
 * was measuring the wrong thing.
 */

/** How often a pylon is *attempted*, in metres of track. */
const PYLON_SPACING = 12;

/**
 * How far along the route a pylon may slide to find clear ground, in metres.
 *
 * Escalating, the pattern `railRace/track.ts`'s trestle search and
 * `slide/supports.ts` both use — the former found a naive placement losing 52 of
 * 67 candidates to `isClearCircle` alone. A pylon has no reason to be at an
 * exact multiple of anything, so letting it slide costs nothing.
 */
const NUDGES: readonly number[] = [0, 1.5, -1.5, 3, -3, 4.5, -4.5, 6, -6];

/**
 * How many times the gap-filling pass below may go round.
 *
 * Each pass inserts at most one pylon and then re-measures from scratch, so a
 * gap wide enough to need two supports is closed over two passes. Bounded
 * rather than `while (true)` because every generator here has to terminate on
 * a park nobody has built yet: the crowding rule already stops a gap being
 * packed, and this is the belt to its braces.
 */
const GAP_FILL_PASSES = 8;

/** Float slack when comparing a measured gap against the even slot spacing. */
const GAP_EPSILON = 1e-6;

/**
 * Shortest pylon worth building. Below this the track is close enough to the
 * ground that a post is clutter — and it is exactly where the track is low
 * (the station dip) that a child is most likely to be walking beside it.
 *
 * The number `Coaster.buildTrack` already used, kept.
 */
const MIN_PYLON_HEIGHT = 1.4;

/** Clear ground a pylon needs around it before it may stand there. */
const GROUND_CLEARANCE = 1;

/**
 * How far a pylon keeps off the paved network.
 *
 * The Sky Cruiser is the **owner** of this figure — `slide/supports.ts` calls it
 * "the coaster's pylon figure" in a comment and then writes 2.8 out again by
 * hand, which is the repo's most common bug in miniature (CLAUDE.md, *two
 * definitions of one thing*). Exported so the slide can stop keeping a copy.
 */
export const PATH_CLEARANCE = 2.8;

/**
 * Room a stall's own approach keeps, on top of its `boundingRadius`.
 *
 * Only ever applied to plots this ride does **not** fly over — see this file's
 * header.
 */
const PLOT_SKIRT = 2.4;

/**
 * The narrowest gap a child can walk through, and so the least room two pylons
 * may leave between them.
 *
 * `NavGrid` fattens every collider by `PLAYER_RADIUS` before deciding a cell is
 * walkable, so anything tighter than twice that is not a gap at all. Taken from
 * the player rather than from a spacing this planner aims for — the difference
 * between proving a child fits and proving the planner did its arithmetic.
 */
const WALKABLE_GAP = 2 * PLAYER_RADIUS;

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

/**
 * Which plots this route actually flies over, and so cannot treat as keep-outs.
 *
 * Asked of the route rather than written down: a hand-kept list is a second
 * definition of "which plots does this ride span", and the park is re-laid on
 * every seed.
 */
function plotsThisRideSpans(route: RailSampler): ReadonlySet<string> {
  const spanned = new Set<string>();
  const point = new Vector3();
  const step = 2;
  for (let d = 0; d < route.length; d += step) {
    route.pointAt(d, point);
    for (const [id, entry] of PARK_LAYOUT.entries) {
      if (spanned.has(id)) continue;
      if (Math.hypot(point.x - entry.x, point.z - entry.z) < entry.boundingRadius) {
        spanned.add(id);
      }
    }
  }
  return spanned;
}

/**
 * Chooses where the Sky Cruiser's pylons stand. Pure — no scene, no collision
 * registration; the caller does both.
 */
export function planCruiserPylons(
  route: RailSampler,
  isClear: (x: number, z: number, radius: number) => boolean,
  clearTreesNear: (x: number, z: number, radius: number) => number,
): CruiserPylon[] {
  const spanned = plotsThisRideSpans(route);
  const pylons: CruiserPylon[] = [];
  const point = new Vector3();
  const attempts = Math.floor(route.length / PYLON_SPACING);
  /** The even spacing the slots below aim for — the promise this planner makes. */
  const slotSpacing = route.length / attempts;
  let refusal = '';

  /**
   * **The one owner of "may a pylon stand here?".** Both the slot pass and the
   * gap-filling pass below ask exactly this, so the two can never drift into
   * separate ideas of a legal support (CLAUDE.md, "two definitions of one
   * thing"). Returns the pylon, or `null` having set {@link refusal}.
   */
  const tryPlace = (at: number): CruiserPylon | null => {
    if (at < 0 || at >= route.length) {
      refusal = 'off the end of the route';
      return null;
    }
    route.pointAt(at, point);
    const ground = terrainHeight(point.x, point.z);
    const height = point.y - ground;
    if (height < MIN_PYLON_HEIGHT) {
      refusal = `too low (${height.toFixed(2)} m < ${MIN_PYLON_HEIGHT})`;
      return null;
    }
    if (distanceToPath(point.x, point.z) < PATH_CLEARANCE) {
      refusal = `paving ${distanceToPath(point.x, point.z).toFixed(2)} m < ${PATH_CLEARANCE}`;
      return null;
    }
    // Only plots this ride does *not* span — see the header. A ride that flies
    // over the castle cannot also keep 21.4 m clear of it.
    const pinches = [...PARK_LAYOUT.entries].some(
      ([id, entry]) =>
        !spanned.has(id) &&
        Math.hypot(point.x - entry.x, point.z - entry.z) < entry.boundingRadius + PLOT_SKIRT,
    );
    if (pinches) {
      refusal = 'a plot it does not span';
      return null;
    }
    // Not too close to one already placed. Slots are spaced along the route,
    // which is not the same as being spaced apart on the ground: this loop
    // doubles back past the castle, so two slots far apart along the track can
    // stand almost on the same spot. Checked before ground clearance below,
    // for the same reason path and plot clearance are: this is independent
    // of any tree, so it must reject a doomed candidate before that
    // candidate gets a chance to cost anybody a tree.
    const crowds = pylons.some(
      (placed) =>
        Math.hypot(point.x - placed.x, point.z - placed.z) < 2 * POST_FOOT_RADIUS + WALKABLE_GAP,
    );
    if (crowds) {
      refusal = 'crowds a pylon already placed';
      return null;
    }
    // Ground clearance is checked last, once every other test on this spot
    // has already passed. A tree is only ever cut down for a spot that
    // would otherwise be built on; checking this earlier would fell trees
    // for candidates the path, a plot or a neighbouring pylon was always
    // going to refuse anyway.
    if (!isClear(point.x, point.z, GROUND_CLEARANCE)) {
      // A spot that is otherwise good but has a tree standing on it should
      // lose the tree, not the support — a real park would clear the
      // ground it needs to hold a ride up (Jim, issue #301: "it is very
      // reasonable to assume that the park would cut down trees that would
      // stop them supporting their rides"). Only *this* candidate's own
      // circle is asked to clear: felling is real and permanent
      // (`Scenery.clearTreesNear`), so a spot blocked by something that is
      // not a tree — a wall, a booth, the paved network — still refuses it
      // exactly as before, because there is nothing here for felling to
      // remove.
      if (clearTreesNear(point.x, point.z, GROUND_CLEARANCE) === 0) {
        refusal = `ground blocked at (${point.x.toFixed(1)}, ${point.z.toFixed(1)}), nothing fellable there`;
        return null;
      }
      if (!isClear(point.x, point.z, GROUND_CLEARANCE)) {
        refusal = `ground still blocked at (${point.x.toFixed(1)}, ${point.z.toFixed(1)}) after felling`;
        return null;
      }
    }
    return { x: point.x, z: point.z, ground, height, at };
  };

  for (let slot = 0; slot < attempts; slot += 1) {
    const wanted = slot * slotSpacing;
    refusal = 'no nudge in range';
    for (const nudge of NUDGES) {
      const placed = tryPlace(wanted + nudge);
      if (!placed) continue;
      pylons.push(placed);
      refusal = '';
      break;
    }
    if (refusal && DEBUG_PYLONS) {
      // eslint-disable-next-line no-console
      console.log(`[pylon] slot ${slot} at ${wanted.toFixed(1)} m refused: ${refusal}`);
    }
  }

  // **Backtrack on the gaps the nudges opened** (issue #301).
  //
  // A slot that cannot stand on its even mark slides up to 6 m to find clear
  // ground, and the slide is one-sided: seed 11's slot 2 wanted 24.5 m, found
  // 0 and +/-1.5 and +/-3 all blocked, and took +4.5 — leaving **16.8 m** of
  // unsupported track behind it, over open lawn. Neither sign of the nudge
  // fixes that on its own (-4.5 merely moves the same gap forward to the next
  // pylon); with `PYLON_SPACING` 12 and a +/-6 budget the reachable worst case
  // is 24 m. The gap was never a *skipped* pylon, which is what that
  // invariant's message had long assumed — every slot here placed one.
  //
  // So rather than accept a span it has already measured as too long, the
  // planner goes back and fills it, which is this codebase's standing rule for
  // every generator (CLAUDE.md: "procgen backtracks on collision, always" —
  // try a different decision, never accept a result that still doesn't clear).
  // The bar is the planner's **own** promise, `slotSpacing`, taken from the
  // route it just measured rather than copied from the invariant's tolerance,
  // so the two stay independent: an ordinary run has every gap exactly
  // `slotSpacing` and fills nothing at all.
  //
  // Filling only ever *adds* a support, and every candidate goes through the
  // same `tryPlace` as the slots did — including the crowding rule, which is
  // what stops a gap being packed. A gap nothing can stand in stays as it is:
  // a park with an honest hole beats one with a pylon in a flowerbed.
  for (let pass = 0; pass < GAP_FILL_PASSES; pass += 1) {
    pylons.sort((a, b) => a.at - b.at);
    let filled = false;
    for (let i = 0; i < pylons.length; i += 1) {
      const here = pylons[i] as CruiserPylon;
      const next = pylons[i + 1];
      // The last pylon's gap runs to the end of the route, not round to the
      // first: `slot 0` sits at 0 m, so the loop's seam is already carried.
      const until = next ? next.at : route.length;
      if (until - here.at <= slotSpacing + GAP_EPSILON) continue;
      const middle = (here.at + until) / 2;
      refusal = 'no nudge in range';
      for (const nudge of NUDGES) {
        const placed = tryPlace(middle + nudge);
        if (!placed) continue;
        pylons.push(placed);
        filled = true;
        if (DEBUG_PYLONS) {
          // eslint-disable-next-line no-console
          console.log(
            `[pylon] filled ${(until - here.at).toFixed(1)} m gap after ${here.at.toFixed(1)} m ` +
              `with a pylon at ${placed.at.toFixed(1)} m`,
          );
        }
        break;
      }
      if (filled) break;
      if (DEBUG_PYLONS) {
        // eslint-disable-next-line no-console
        console.log(
          `[pylon] ${(until - here.at).toFixed(1)} m gap after ${here.at.toFixed(1)} m ` +
            `cannot be filled: ${refusal}`,
        );
      }
    }
    if (!filled) break;
  }
  pylons.sort((a, b) => a.at - b.at);

  return pylons;
}
