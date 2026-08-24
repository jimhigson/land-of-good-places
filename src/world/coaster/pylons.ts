import { Vector3 } from 'three';
import { PLAYER_RADIUS } from '../../core/constants';
import { PARK_LAYOUT } from '../parkLayout';
import { distanceToPath } from '../pathGraph';
import { terrainHeight } from '../terrain';
import { POST_FOOT_RADIUS } from '../railRace/trestleGeometry';
import type { RailSampler } from '../rail/sweptRail';

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

  for (let slot = 0; slot < attempts; slot += 1) {
    const wanted = (slot / attempts) * route.length;
    for (const nudge of NUDGES) {
      const at = wanted + nudge;
      if (at < 0 || at >= route.length) continue;
      route.pointAt(at, point);
      const ground = terrainHeight(point.x, point.z);
      const height = point.y - ground;
      if (height < MIN_PYLON_HEIGHT) continue;
      if (distanceToPath(point.x, point.z) < PATH_CLEARANCE) continue;
      // Only plots this ride does *not* span — see the header. A ride that flies
      // over the castle cannot also keep 21.4 m clear of it.
      const pinches = [...PARK_LAYOUT.entries].some(
        ([id, entry]) =>
          !spanned.has(id) &&
          Math.hypot(point.x - entry.x, point.z - entry.z) < entry.boundingRadius + PLOT_SKIRT,
      );
      if (pinches) continue;
      // Not too close to one already placed. Slots are spaced along the route,
      // which is not the same as being spaced apart on the ground: this loop
      // doubles back past the castle, so two slots far apart along the track can
      // stand almost on the same spot. Checked before ground clearance below,
      // for the same reason path and plot clearance are: this is independent
      // of any tree, so it must reject a doomed candidate before that
      // candidate gets a chance to cost anybody a tree.
      const crowds = pylons.some(
        (placed) =>
          Math.hypot(point.x - placed.x, point.z - placed.z) <
          2 * POST_FOOT_RADIUS + WALKABLE_GAP,
      );
      if (crowds) continue;
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
        if (clearTreesNear(point.x, point.z, GROUND_CLEARANCE) === 0) continue;
        if (!isClear(point.x, point.z, GROUND_CLEARANCE)) continue;
      }
      pylons.push({ x: point.x, z: point.z, ground, height, at });
      break;
    }
  }
  return pylons;
}
