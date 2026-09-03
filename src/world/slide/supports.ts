import { CylinderGeometry, Group, Mesh, Vector3 } from 'three';
import { PALETTE } from '../../core/palette';
import { toonMaterial } from '../../art/style/materials';
import type { CollisionWorld } from '../Collision';
import { PLAYER_RADIUS } from '../../core/constants';
import { PARK_LAYOUT } from '../parkLayout';
import { distanceToPath } from '../pathGraph';
// Leaf module, and chosen over `train/plan` on purpose: these are two floats
// about where the lineside fence stands, and importing them must not drag the
// railway's own solve in behind them. `train/plan.ts` owns *where the rails
// are* and is injected as a function below; this file owns *how far a leg
// keeps off them*. See {@link RAIL_CLEARANCE}.
import { FENCE_HALF_THICKNESS, FENCE_OFFSET } from '../train/clearance';
import { terrainHeight } from '../terrain';
// `./solve`, not `./plan`: these two are plan-view geometry helpers, and
// importing them has no business triggering the three-and-a-half-second solve
// that `plan.ts` runs to initialise `SLIDE_PLAN`. See `slide/plan.ts`.
import { cruiserCrossesColumn, insideCastle } from './solve';

/**
 * **Legs to stand the ginormous slide on.**
 *
 * The old slide had none, and got away with it by being short. This one is
 * ~95 m of elevated trough, and a chute that long floating in mid-air is the
 * first thing anyone looking up at the park would notice — ART_DIRECTION's
 * whole premise is that things read as solid, chunky and physically there.
 *
 * ### Fewer and chunkier, not regular
 *
 * The obvious implementation puts a leg every N metres. That is wrong here for
 * a reason worth stating: the ground under this chute is ground a child walks
 * on, and a tidy row of posts is a fence. So legs are spaced generously, every
 * candidate has to earn its place on genuinely clear ground, and one that
 * cannot is simply skipped — a gap in the supports is a much smaller problem
 * than a paddock in the middle of the park.
 *
 * ### What a leg must not do
 *
 * - **Spear the Sky Cruiser.** The chute passes *over* the coaster, so a
 *   support dropped straight down from that stretch is the obvious collision.
 *   Tested as a column over the post's whole height, not as a point.
 * - **Stand inside the castle**, whose interior is empty as far as
 *   `CollisionWorld` is concerned — the facade is thin walls, so "is this
 *   clear?" happily says yes to the middle of the tower.
 * - **Block the walking network**, which is the coaster's pylon rule and its
 *   hard-won lesson: a 0.32 m post inflates past a lane's half-width in the
 *   nav lattice, and one placed in a gap between plots pinches it shut.
 * - **Stand on the railway** (issue #501). The chute flies *over* the loop
 *   legitimately; a leg dropped from that stretch does not. See
 *   {@link planSlideLegs}'s `clearOfRailway` for why this could not come from
 *   `CollisionWorld` and where the answer does come from.
 */

/** The two plots this ride spans. See the pinch test in {@link planSlideLegs}. */
const JOINED_PLOTS: ReadonlySet<string> = new Set(['building', 'ballPit']);

/**
 * Metres of chute between attempted legs.
 *
 * This is how often a leg is *tried*, not how often one is built — most
 * candidates are rejected, so the two numbers are far apart. It was 13, which
 * on a 77 m chute is five attempts, and on seed 5 the paved network took three
 * of them: `PATH_CLEARANCE` forbids a post within 2.8 m of a path, and this
 * chute runs alongside one for most of its length. Two legs under 77 m of
 * elevated trough reads as floating, and `test/procgen/invariants.ts` said so.
 *
 * Trying more places does not build more legs where there is no room for them —
 * every rejection below still applies, and the crowding test keeps whatever is
 * placed at least a child's width apart. It only stops a chute going unsupported
 * because the handful of spots it happened to ask about were all on the path.
 *
 * 9 to 6 on 7 August 2026, for the same reason and on a different seed. Once
 * the slide's length ceiling was fixed (`plan.ts`'s `MAX_RIDEABLE_LENGTH`)
 * seed 2's chute came out at 80 m and stood on **3** legs where the invariant
 * wants one per 20 m — eight attempts, five of them lost to the paths and plots
 * this chute threads between. Six metres gives twelve, and four survive. The
 * argument above is unchanged: this buys more *questions*, never a laxer answer.
 */
const LEG_SPACING = 6;

/**
 * How far along the chute a leg may be nudged to find clear ground.
 *
 * Escalating, in the spirit of `railRace/track.ts`'s trestle search, which
 * found that a naive placement lost 52 of 67 candidate spots to
 * `isClearCircle`. A leg has no reason to be at an exact multiple of anything,
 * so letting it slide along the chute costs nothing and saves most of them.
 */
const NUDGES: readonly number[] = [
  0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8.5, -8.5, 10, -10,
];

/**
 * Shortest leg worth building, in metres.
 *
 * Below this the chute is close enough to the ground that a post is clutter
 * rather than support — and it is exactly where the chute is low that a child
 * is most likely to be walking beside it.
 */
const MIN_LEG_HEIGHT = 2.4;

/** Radius of the post at the top, and at its foot. */
const TOP_RADIUS = 0.34;
const FOOT_RADIUS = 0.52;

/** What the post occupies in the collision world. */
const POST_COLLISION_RADIUS = 0.42;

/** Clear ground a leg needs around it before it may stand there. */
const GROUND_CLEARANCE = 1.0;

/**
 * **How far a leg's centre keeps off the rail centre line** (issue #501).
 *
 * Derived, never chosen, and every term is read from its owner:
 *
 * - {@link FENCE_OFFSET} — where `train/fence.ts` stands the lineside fence.
 * - {@link FENCE_HALF_THICKNESS} — how thick that fence is.
 * - {@link FOOT_RADIUS} — the widest part of this post, which is ours.
 *
 * So the post's foot rests exactly against the fence's outer face and never
 * inside it. Two solid things in one place is the same disease as a post
 * standing on the track; it is simply the one you meet second.
 *
 * ### Why not the train's own envelope, which is smaller
 *
 * `TRACK_CLEARANCE` (1.3 m) is what the *train* needs, and it is the threshold
 * `slideLegsClearTheRailway` holds the built park to — deliberately, because an
 * invariant should assert what the game requires rather than what this file
 * aims for. But a leg at 1.3 m + its foot straddles the fence: the fence
 * occupies 1.82 m to 2.18 m from the centre line, and a foot centred at 1.82 m
 * spans 1.30 m to 2.34 m, straight through it. Stopping at the train's number
 * would have been shaving the clearance to the smallest value that made the
 * pool pass, and it would have shipped a post through a fence to do it.
 *
 * ### What it costs, and why that is reported rather than shaved
 *
 * On seed 5 this is the difference between four legs and two, and two is under
 * what `theGinormousSlideStandsOnSomething` asks of an 83 m chute. That is a
 * finding about seed 5's park — its chute spends 30 of those 83 m over or
 * beside the loop — and not a reason to move this number. See the PR.
 *
 * **Not `RAIL_CORRIDOR_CLEARANCE`** (4.2 m), which `Scenery` holds its garden
 * walls to: that one also clears a station platform's canopy, because a wall is
 * long and blind and may run anywhere. A leg is a point on a known curve, and
 * paying a platform's width everywhere the chute passes the loop costs seed 5
 * every leg but one. Measured: 1.
 */
const RAIL_CLEARANCE = FENCE_OFFSET + FENCE_HALF_THICKNESS + FOOT_RADIUS;

/**
 * The narrowest gap a child can actually walk through, and so the least room
 * two legs may leave between their feet.
 *
 * `PLAYER_RADIUS` is 0.62 and `NavGrid` fattens every collider by it before
 * deciding a cell is walkable, so anything tighter than twice that is not a gap
 * at all — it is a wall with a slot in it. Taken from the player rather than
 * from a spacing the planner aims for, which is the difference between proving
 * a child fits and proving the planner did its arithmetic.
 */
const WALKABLE_GAP = 2 * PLAYER_RADIUS;

/** How far a leg keeps off the paved network. The coaster's pylon figure. */
const PATH_CLEARANCE = 2.8;

export interface SlideLeg {
  readonly x: number;
  readonly z: number;
  /** Terrain height at its foot. */
  readonly ground: number;
  /** Height of the chute floor above it. */
  readonly top: number;
}

/**
 * Chooses where the chute's legs stand.
 *
 * Pure, and separate from building the meshes, so `test/procgen` can measure
 * the choice without a scene — and so the collision registration below happens
 * exactly once, at a point the caller controls.
 *
 * ### Why the railway arrives as a second injected question
 *
 * `isClear` is the real `CollisionWorld`, and asking it was never enough for
 * the train, because **the railway is not a collider when this runs.** The
 * lineside fence is one (`train/fence.ts` adds walls of `TRACK_CLEARANCE`
 * half-width) but `ParkTrain` is built in `World.ts` *after* `Building`, so at
 * this moment there is nothing in the collision world anywhere the loop will
 * go. A leg vetted against it is vetted against a park with no railway in it,
 * which is exactly how seed 5 shipped four posts standing in the train — one of
 * them 0.43 m *past* the centre line — for as long as the ride has existed
 * (issue #501). No pairwise invariant covered the pair either, so nothing said
 * so; `slideLegsClearTheRailway` in `test/procgen/invariants.ts` does now.
 *
 * **The ordering was the first thing established, because it decides which side
 * the fix belongs on**: had the legs genuinely been placed before the railway
 * existed, nothing here could see it and the railway would have had to move
 * instead. It does not. `TRAIN_PLAN` is solved *at module load*, from the park
 * layout alone, before any scene object exists — the railway as data, final
 * long before this constructor runs. So the question is answerable here; it
 * simply cannot be answered by `CollisionWorld`.
 *
 * Hence a distance, injected: `train/plan.ts` owns **where the rails are** and
 * hands that in (`Scenery` already asks it the same thing for garden walls, so
 * this is a second caller rather than a second definition), and this file owns
 * **how far a leg keeps off them** — see {@link RAIL_CLEARANCE}. Splitting it
 * that way is what keeps the policy next to the thing whose foot it is about.
 */
export function planSlideLegs(
  chute: readonly Vector3[],
  isClear: (x: number, z: number, radius: number) => boolean,
  distanceToRailway: (x: number, z: number) => number,
): SlideLeg[] {
  // Arc length along the chute, so spacing means metres of ride rather than
  // metres of straight line — the difference is large on a curve this tight.
  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 1; i < chute.length; i += 1) {
    total += chute[i]!.distanceTo(chute[i - 1]!);
    cumulative.push(total);
  }

  const pointAtArc = (target: number): Vector3 | null => {
    if (target <= 0 || target >= total) return null;
    for (let i = 1; i < cumulative.length; i += 1) {
      const before = cumulative[i - 1]!;
      const here = cumulative[i]!;
      if (here < target) continue;
      const span = here - before;
      const t = span > 1e-6 ? (target - before) / span : 0;
      return chute[i - 1]!.clone().lerp(chute[i]!, t);
    }
    return null;
  };

  const legs: SlideLeg[] = [];
  const slots = Math.floor(total / LEG_SPACING);
  for (let slot = 1; slot <= slots; slot += 1) {
    const wanted = (slot / (slots + 1)) * total;
    for (const nudge of NUDGES) {
      const point = pointAtArc(wanted + nudge);
      if (!point) continue;
      const ground = terrainHeight(point.x, point.z);
      const height = point.y - ground;
      if (height < MIN_LEG_HEIGHT) continue;
      if (insideCastle(point.x, point.z, GROUND_CLEARANCE)) continue;
      // The column, not the top of it: the chute flies over the coaster and a
      // leg dropped from there would go straight through it.
      if (cruiserCrossesColumn(point.x, point.z, ground, point.y)) continue;
      // Same shape as the cruiser clause above, and for the same reason: the
      // chute passes over the railway, and a post dropped from that stretch
      // stands in front of the train. Rejected rather than nudged sideways —
      // the loop below is the nudge, and it slides the candidate along the
      // chute until it clears rather than shrinking what "clear" means.
      if (distanceToRailway(point.x, point.z) < RAIL_CLEARANCE) continue;
      if (!isClear(point.x, point.z, GROUND_CLEARANCE)) continue;
      if (distanceToPath(point.x, point.z) < PATH_CLEARANCE) continue;
      // The coaster's lesson: a post in the gap between two plots pinches shut
      // a corridor the walk network and strolling NPCs both need.
      //
      // The castle and the ball pit are exempt, for the same reason the route
      // itself exempts them — their plot circles are 19 m and 9 m with centres
      // 23 m apart, so between them they cover this entire ride and the rule
      // would reject every candidate. Measured, before the exemption: 37
      // otherwise-perfect spots rejected, 0 legs built, a 95 m chute left
      // floating and nothing said so. The castle's real walls are still
      // honoured above, as a footprint rather than a circle.
      const pinches = [...PARK_LAYOUT.entries.values()].some(
        (entry) =>
          !JOINED_PLOTS.has(entry.id) &&
          Math.hypot(point.x - entry.x, point.z - entry.z) < entry.boundingRadius + 2.4,
      );
      if (pinches) continue;
      // Not too close to a leg already placed.
      //
      // Slots are spaced along **arc length**, which is not the same as being
      // spaced apart on the ground: this chute wraps a castle, so two slots a
      // third of the ride apart can stand almost on the same spot. Nothing
      // checked that, and on seed 5 two legs ended up overlapping by 0.11 m —
      // a single fat post where a child should have been able to walk between
      // two, which the procgen invariant caught only after the towers changed
      // the route enough to expose it.
      const crowds = legs.some(
        (placed) =>
          Math.hypot(point.x - placed.x, point.z - placed.z) < 2 * FOOT_RADIUS + WALKABLE_GAP,
      );
      if (crowds) continue;
      legs.push({ x: point.x, z: point.z, ground, top: point.y });
      break;
    }
  }
  return legs;
}

/**
 * Builds the legs, in **world space**, to be added at park level.
 *
 * Deliberately *not* under the castle's own anchor group, where the chute
 * itself hangs. `check:park`'s invariant 6 measures everything under an
 * anchor's group against the `boundingRadius` that anchor declares — the
 * promise every other builder routes and scatters around — and a leg 19.1 m
 * from the castle's centre breaks a 19 m promise. Which is the check being
 * right, not inconvenient: content out there is content nobody planned around.
 *
 * But a leg is not the castle's content. This ride *spans* two plots, and its
 * supports stand in the park between them, so the honest place for them is the
 * park, not the tower. They earn their own safety instead of inheriting the
 * castle's: every one stands on ground vetted by `isClearCircle`, keeps
 * {@link PATH_CLEARANCE} off the paved network, and is registered as a solid
 * circle so the nav lattice knows it is there.
 */
export function buildSlideSupports(
  legs: readonly SlideLeg[],
  collision: CollisionWorld,
): Group {
  const group = new Group();
  group.name = 'ginormous-slide-supports';

  // One unit-height cylinder, scaled per leg: a handful of posts, so the
  // sharing is for tidiness rather than for draw calls. Tapered, and chunkier
  // at the foot, because a straight thin pole reads as scaffolding and this
  // park's things are meant to look planted.
  const geometry = new CylinderGeometry(TOP_RADIUS, FOOT_RADIUS, 1, 10);
  const material = toonMaterial(PALETTE.slideRail);

  for (const leg of legs) {
    const height = leg.top - leg.ground;
    const post = new Mesh(geometry, material);
    post.name = 'ginormous-slide-leg';
    post.scale.set(1, height, 1);
    // Sunk slightly, so a leg never floats above uneven ground.
    post.position.set(leg.x, leg.ground + height / 2 - 0.15, leg.z);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);

    collision.addCircle(leg.x, leg.z, POST_COLLISION_RADIUS);
  }

  return group;
}
