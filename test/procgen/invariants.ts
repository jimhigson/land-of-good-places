/**
 * **The invariants themselves. This list is meant to grow.**
 *
 * Adding one is a small function taking {@link ParkFacts} plus one line in
 * {@link INVARIANTS}. It then runs against every seed automatically, because
 * each seed file just calls {@link registerParkInvariants}.
 *
 * Three rules for anything added here:
 *
 * 1. **Measure the built park, never the rules that built it.** `ParkFacts`
 *    reads everything back off a real `World`. An invariant that re-derives a
 *    placement rule and checks the placement agrees with it has proved
 *    nothing — see the header of `parkFacts.ts`.
 * 2. **Thresholds come from the game, not from the generator.** Prefer
 *    `PLAYER_RADIUS`, `TRACK_CLEARANCE`, `SHORTFALL_TOLERANCE` — numbers that
 *    already mean something — over the constant the generator happens to aim
 *    for. Asserting the generator's own target only proves it can do
 *    arithmetic, and it turns every future tuning change into a test failure.
 * 3. **Return your complaints; do not assert them.** {@link Invariant} is
 *    `=> readonly string[]` and {@link registerParkInvariants} does the
 *    asserting. See that type's own comment for why it is not `=> void`:
 *    briefly, a hollow invariant that passed unconditionally shipped into this
 *    suite, and the return type is what makes writing another one a compile
 *    error rather than a thing you have to remember.
 *
 * **Whichever you write, prove it can fail.** Break the thing it guards, watch
 * it go red, put it back. An invariant nobody has ever seen fail is a claim
 * about the park, not a check on it.
 */
import { describe, it, beforeAll, expect } from 'vitest';
import { InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import {
  buildParkFacts,
  segmentDistance,
  pointToSegment,
  alongRun,
  pairKey,
  type ParkFacts,
} from './parkFacts.ts';
import { resolveDismount, resolveDismountGroup } from '../../src/world/dismount.ts';
import { PLAYER_MAX_SPEED, PLAYER_RADIUS, RIM_OUTSET_START } from '../../src/core/constants.ts';
import {
  ENTRANCE_BUS_ARRIVE_X,
  ENTRANCE_BUS_STOP_Z,
  ENTRANCE_GATE_Z,
  ENTRANCE_PLAYER_X,
  ENTRANCE_PLAYER_Z,
  isInEntranceGateGap,
} from '../../src/world/entrance/layout.ts';
import { visibleTop } from '../../src/art/style/measure.ts';
import { createKid, TALLEST_CHILD_HEIGHT } from '../../src/art/models/kid.ts';
import { HAIR_STYLES } from '../../src/art/models/hair.ts';
import { HAT_KINDS, createHat } from '../../src/art/models/hats.ts';
// `train/trainDimensions.ts` and `train/clearance.ts` rather than
// `train/trainModel.ts` — issue #226: the numbers belong somewhere a test can
// read them without loading three.js and the track builder. Checked rather than
// assumed (5 August 2026): `trainModel.ts` does **not** reach `parkManifest` at
// runtime — `track.ts` imports `TrainRoute` with `import type`, which is erased
// — so importing it here would not actually fix the seed early, and review
// proved that by pointing this import back at it and watching 132 still pass.
// The leaf module is defence against that chain becoming real, not a fix for a
// live bug. `railRaceFliesClear`'s "reached through the built world, never
// imported" note below is about `railRace/plan.ts`, which genuinely does.
import { CAR_FLOOR_Y, LOCO_BODY_TOP_Y, SEAT_Y } from '../../src/world/train/trainDimensions.ts';
import { RIDER_HEADROOM, TRAIN_CLEARANCE_Y } from '../../src/world/train/clearance.ts';
// Safe to import statically: `slide/landing.ts` deliberately reaches nothing
// seeded — see the note on `PitCircle`. It takes the pit as an argument for
// exactly this reason, so importing it here cannot fix the park's seed before
// the harness sets `LGP_SEED`.
import { LANDING_DROP, riderClearanceFromChute } from '../../src/world/slide/landing.ts';

/**
 * The narrowest gap a child can actually use.
 *
 * `PLAYER_RADIUS` is 0.62 and `NavGrid` fattens every collider by it before
 * deciding a cell is walkable, so anything narrower than this is not a gap at
 * all — it is a solid wall with a visible slot in it.
 */
const WALKABLE_GAP = 1.24;

/**
 * Half the track's width plus a little — `train/route.ts`'s own number.
 *
 * Anything closer than this to the centre line is inside the train.
 */
const TRACK_CLEARANCE = 1.3;

/**
 * How long a child may spend getting to a tree she can climb.
 *
 * Nine seconds at her own flat-out {@link PLAYER_MAX_SPEED} — a duration, not a
 * distance, because Jim's complaint was a duration: *"it takes a long time to
 * find one"*. Converting through the game's own speed is what stops this being
 * a number somebody liked the look of.
 *
 * **It was seven, and raising it deserves an explanation rather than a quiet
 * edit**, because "loosen the threshold until the seed passes" is the exact
 * move this repo forbids.
 *
 * Seven was calibrated against a park with 8 climbable trees, where the worst
 * paved point was 41.9 m. Then #216 landed, `isPlantable` stopped capping at
 * 55 m, and the park went to 72 trees with **40–49** of them climbable. The
 * worst paved point got *worse* — 55.4 m on seed 2 — because the new ground
 * opened up is the **outer** park, so the trees moved away from the middle even
 * as their number quintupled.
 *
 * That is the tell that this metric is not measuring what its name says. Every
 * worst point on every seed sits in the plaza — (9,-7), (-0,-6), (-9,10),
 * (-9,10), (-9,6) — ground owned by the plots, the stalls and the paving, where
 * no tree of any kind can be planted. A max over path points therefore reports
 * the distance from the middle of a paved square to the lawn, on a park that
 * has never had a findability problem at 40+ climbable trees.
 *
 * So this becomes what it can honestly be: **a backstop against gross
 * clustering**, wide enough not to be a report on the plaza. The tight guard on
 * the thing Jim actually complained about is now the count floor below, which
 * moved the other way — from 6 to 25 — and is what would catch a regression to
 * the park he could not find a tree in. Nine seconds still fails the park as it
 * was when he complained (96.9 m worst).
 */
const SEARCH_SECONDS = 9;
const MAX_CLIMB_SEARCH = PLAYER_MAX_SPEED * SEARCH_SECONDS;

/**
 * How far off a doormat the game itself considers "arrived" — imported in
 * spirit from `entities/TapNavigator.ts`, which `check:park` also uses for
 * exactly this. An entrance is usable if there is standable ground this close
 * to it; demanding the doormat's exact centre be standable is stricter than
 * the game has ever been, and would fail on every seed for the building, whose
 * entrance sits in its doorway.
 */
const SHORTFALL_TOLERANCE = 1.6;

/**
 * How far a lamp usefully lights. Deliberately well inside the ~20.5 m ground
 * pool documented in `LampPosts.ts`, so this measures *coverage*, not the
 * outer edge of the falloff curve.
 */
const LAMP_REACH = 15;

/**
 * Rail-over-rail air where one ride passes over another — Decision 4's number,
 * not the Rail Race's own target, so this keeps meaning something if the ring's
 * cruise height is ever retuned.
 */
const RAIL_OVER_RAIL = 5.5;

/**
 * Longest stretch of path allowed with no lamp within {@link LAMP_REACH}.
 *
 * 2.5x the 10 m the placer aims for: two lamps in a row may legitimately be
 * skipped where a path squeezes past a plot, three in a row is a dark park.
 */
const MAX_DARK_RUN = 25;

/**
 * Longest stretch of the Rail Race ring allowed to stand with no trestle leg
 * at all.
 *
 * `track.ts`'s `trestleSpots` aims for a leg every 12 m and searches a small
 * neighbourhood before giving one up as genuinely un-standable ground (over
 * the railway, a path, a plot gap). One skipped slot (~12-24 m, generously
 * ~36 m allowing for the search's own few metres of nudge either side) is the
 * track shrugging off a single bad spot, exactly as intended. This is not
 * that number, doubled to a clean 40 m on purpose — it is independently how
 * long an elevated ride can go with *no visible means of support* before it
 * reads as floating rather than built, which is the actual thing a family
 * would notice from the ground. (Measured before `trestleSpots` gained its
 * search, 1 August 2026: the canonical seed's single surviving leg left a
 * ~330 m gap — this would have failed loudly, which is the point.)
 */
const TRESTLE_GAP_TOLERANCE = 40;

/**
/**
 * How close a ribbon has to come to count as having arrived somewhere.
 *
 * A child's full width — `2 x PLAYER_RADIUS`, the same derivation
 * {@link WALKABLE_GAP} is built from — so "the paving reaches the counter"
 * means a child standing at the counter is standing on the paving rather than
 * out on the grass beside it. Not `paths.ts`'s own numbers: neither the 4 m it
 * uses to decide a node is already served, nor any route width it happens to
 * draw with.
 *
 * There is one deliberate overshoot in the generator and this clears it
 * comfortably. A spur is carried a little *past* a doormat into the plot mouth,
 * but that extension is structurally capped at 0.4 m: it is
 * `min(2, l - edge - PAST_CLEARANCE)` where `l = edge + standOff`, which
 * collapses to `min(2, 1.4 - 1)` for anything with a footprint. Meanwhile the
 * bug this was written for — every stall's ribbon stopping short of its own
 * counter, issue #114 — missed by 3.4 to 6.9 m on all five seeds, so there is
 * no risk of the tolerance swallowing the thing it exists to catch.
 */
const ARRIVAL = 2 * PLAYER_RADIUS;

/**
 * How much of the chute is allowed to be inside the castle's footprint.
 *
 * The slide leaves through a gap in the roof parapet, so its first stretch is
 * *in* the doorway by design. Long enough to cover the mouth and the wall it
 * comes through, short enough that the return leg of #118's curve — which came
 * back and stopped dead in the middle of the tower — could never hide in it.
 */
const DOORWAY_GRACE = 6;

/**
 * The ginormous slide's legs, as built: `supports.ts`'s foot radius, and how
 * far from the chute one may stand and still be holding it up.
 *
 * The reach is the arc nudge the placer is allowed (8.5 m) plus a little — a
 * leg further from the chute than the placer could possibly have moved it is a
 * leg attached to nothing.
 */
const SLIDE_LEG_RADIUS = 0.52;
const SLIDE_LEG_REACH = 10;

// ------------------------------------------------------------------ the list

/**
 * An invariant **returns** what it found wrong. It does not assert.
 *
 * One string per complaint, empty for a healthy park;
 * {@link registerParkInvariants} is the only thing here that calls `expect`.
 *
 * This return type is load-bearing, not a style choice. These functions all
 * have the same shape — walk the built park, push a sentence into an array for
 * anything wrong — and while the type was `=> void` it was possible to build
 * that array and simply forget to assert it. The result compiled, ran on every
 * seed, and passed unconditionally: a test that could never fail, sitting in
 * the suite that CI blocks merges on. That happened (5 August 2026, caught only
 * because the author reverted their own fix to check the new invariant went
 * red, and it did not).
 *
 * With a return type, forgetting is a compile error — `strict` rejects a
 * function that declares an array and falls off the end. The runner cannot be
 * bypassed by accident, so the mistake is unavailable rather than merely
 * discouraged. That matters here more than in most files, because CLAUDE.md
 * *requires* a new invariant with every procgen change: this is a mandated
 * path, walked by people who have never opened this file before.
 */
type Invariant = (facts: ParkFacts) => readonly string[];


/**
 * Every wall run keeps clear of every other one.
 *
 * Arms of a single L-shaped maze piece are exempt: they meet at a shared
 * corner on purpose, which is what makes it an L rather than two walls.
 */
const wallsDoNotClash: Invariant = (facts) => {
  const clashes: string[] = [];
  for (let i = 0; i < facts.walls.length; i += 1) {
    for (let j = i + 1; j < facts.walls.length; j += 1) {
      const a = facts.walls[i]!;
      const b = facts.walls[j]!;
      if (a.piece === b.piece) continue;
      const gap = segmentDistance(a.from, a.to, b.from, b.to) - a.halfWidth - b.halfWidth;
      if (gap < WALKABLE_GAP) {
        clashes.push(
          `${a.kind} run (${fmt(a.from)}->${fmt(a.to)}) and ${b.kind} run ` +
            `(${fmt(b.from)}->${fmt(b.to)}) leave ${gap.toFixed(2)} m between their faces`,
        );
      }
    }
  }
  return clashes;
};

/** No wall stands on the railway. Measured against the *solved* centre line. */
const wallsClearTheRailway: Invariant = (facts) => {
  const fouls: string[] = [];
  for (const wall of facts.walls) {
    let worst = Infinity;
    for (const [x, z] of alongRun(wall.from, wall.to)) {
      worst = Math.min(worst, facts.distanceToRail(x, z) - wall.halfWidth);
    }
    if (worst < TRACK_CLEARANCE) {
      fouls.push(
        `${wall.kind} run (${fmt(wall.from)}->${fmt(wall.to)}) comes within ` +
          `${worst.toFixed(2)} m of the rail centre line`,
      );
    }
  }
  return fouls;
};

/**
 * **No tree stands on the railway.** Issue #235.
 *
 * The twin of {@link wallsClearTheRailway}, and it did not exist because it
 * used to be unnecessary: `Scenery.isPlantable` refused anything beyond 55 m of
 * centre, which kept every tree well inside the outer railway by construction.
 * PR #216 retires that cap in favour of a distance-to-boundary test, which
 * opens the outer reaches — exactly where the railway runs — for planting, and
 * leaves the whole guarantee resting on `onRailway`'s 2.6 m fence with nothing
 * measuring the result.
 *
 * Written here **ahead of** that PR, deliberately. The gap is not reachable on
 * `main` today — trees still stop at 54.0 m — so this costs nothing now and
 * means #216 cannot land the problem silently. That is the same lesson as the
 * Sky Cruiser striking the fairy lights (#210): an obstacle class nobody
 * measured, because a since-retired assumption had made it unnecessary.
 *
 * The margin it is guarding is **not** generous. Measured on the canonical
 * seed, the closest tree's canopy reaches to **3.11 m** of the rail centre line
 * (then 3.26, then 3.58) against a `TRACK_CLEARANCE` of 1.3 — so 1.81 m of
 * slack on the worst tree in the park, today, before anything is widened.
 *
 * `TRACK_CLEARANCE` is the game's own half-width, and `footprint` is the tree's
 * real reach, so this asks the question in the units a collision would happen
 * in rather than in the scatter's own target.
 */
const treesClearTheRailway: Invariant = (facts) => {
  const fouls: string[] = [];
  for (const tree of facts.trees) {
    const gap = facts.distanceToRail(tree.x, tree.z) - tree.footprint;
    if (gap < TRACK_CLEARANCE) {
      fouls.push(
        `tree at ${fmt([tree.x, tree.z])} reaches to ${gap.toFixed(2)} m of the rail centre ` +
          `line (needs ${TRACK_CLEARANCE} m)`,
      );
    }
  }
  return fouls;
};

/**
 * No two plots overlap.
 *
 * Pairs the manifest deliberately relates with `near` are exempt — that field
 * exists precisely to put two things close together (the ginormous slide flies
 * over the ground between the building and the ball pit), and the manifest's
 * own `min` is the whole rule for such a pair.
 */
const plotsDoNotOverlap: Invariant = (facts) => {
  const overlaps: string[] = [];
  for (let i = 0; i < facts.plots.length; i += 1) {
    for (let j = i + 1; j < facts.plots.length; j += 1) {
      const a = facts.plots[i]!;
      const b = facts.plots[j]!;
      if (facts.nearPairs.has(pairKey(a.id, b.id))) continue;
      const gap = Math.hypot(a.x - b.x, a.z - b.z) - a.boundingRadius - b.boundingRadius;
      if (gap < 0) overlaps.push(`${a.id} and ${b.id} overlap by ${(-gap).toFixed(2)} m`);
    }
  }
  return overlaps;
};

/** Every doormat and stall counter has ground a visitor can stand on. */
const entrancesAreUsable: Invariant = (facts) => {
  const blocked: string[] = [];
  for (const entrance of facts.entrances) {
    if (standableNear(facts, entrance.x, entrance.z)) continue;
    blocked.push(
      `${entrance.id} at (${entrance.x.toFixed(1)}, ${entrance.z.toFixed(1)}) has no standable ` +
        `ground within ${SHORTFALL_TOLERANCE} m`,
    );
  }
  return blocked;
};

/**
 * No bush clump stands on the paving, or inside a plot.
 *
 * A bush is a solid collider a child has to walk round, so one sitting on a
 * path narrows it, and one inside a booth's plot is furniture in a room it does
 * not belong to. Held to the clump's **own collider radius** — the thing that
 * actually gets in the way — against the paved *surface*, not the centre line,
 * so the number comes from the built park rather than from the generator's
 * `isPlantable` clearance. Re-deriving that clearance here would only prove the
 * scatter agrees with itself.
 *
 * There was no bush invariant before this one, and nothing to write it against:
 * bushes had no observable output at all until {@link BushFact}. That is the
 * gap that let a fill-to-108 loop quietly re-roll every clump in the park each
 * time a path moved — see `Scenery.ts`'s `BUSH_BUDGET`.
 */
const bushesStandOnOpenGround: Invariant = (facts) => {
  const fouls: string[] = [];
  for (const bush of facts.bushes) {
    const where = `bush at (${bush.x.toFixed(1)}, ${bush.z.toFixed(1)})`;
    const paving = distanceToOtherPaving(facts, '', [bush.x, bush.z]);
    if (paving < bush.radius) {
      fouls.push(
        `${where} overlaps the paving by ${(bush.radius - paving).toFixed(2)} m ` +
          `— a child walking the path has to go round it`,
      );
    }
    for (const plot of facts.plots) {
      const gap = Math.hypot(bush.x - plot.x, bush.z - plot.z) - plot.boundingRadius - bush.radius;
      if (gap < 0) fouls.push(`${where} stands ${(-gap).toFixed(2)} m inside ${plot.id}'s plot`);
    }
  }
  return fouls;
};

/** No two trees grow through each other. */
const treesDoNotInterpenetrate: Invariant = (facts) => {
  const overlaps: string[] = [];
  for (let i = 0; i < facts.trees.length; i += 1) {
    for (let j = i + 1; j < facts.trees.length; j += 1) {
      const a = facts.trees[i]!;
      const b = facts.trees[j]!;
      const gap = Math.hypot(a.x - b.x, a.z - b.z) - a.footprint - b.footprint;
      if (gap < 0) {
        overlaps.push(
          `trees at (${a.x.toFixed(1)}, ${a.z.toFixed(1)}) and ` +
            `(${b.x.toFixed(1)}, ${b.z.toFixed(1)}) interpenetrate by ${(-gap).toFixed(2)} m`,
        );
      }
    }
  }
  return overlaps;
};

/**
 * No tree grows into a wall.
 *
 * Measured canopy edge to wall face: `TreeFact.footprint` is the furthest any
 * part the tree is actually built from reaches away from its trunk, and
 * `halfWidth` is the widest part of the wall (a stone wall's coping stone
 * overhangs its own courses), so this is the gap between the two things a
 * child can see and walk between.
 *
 * Held to {@link WALKABLE_GAP} for the same reason `wallsDoNotClash` is. Every
 * tree gets a collider of its own, so a tree beside a wall is two solid
 * obstacles: a slot between them narrower than two player radii is not a way
 * through, it is a dead end that looks like a way through — and the six-year-
 * old this park is for will try to run down it. Requiring the clearance at the
 * canopy edge rather than at the trunk is also what keeps a wall from
 * vanishing into a bush of leaves, which is the visible half of the same bug.
 */
const treesKeepOffWalls: Invariant = (facts) => {
  const fouls: string[] = [];
  for (const tree of facts.trees) {
    for (const wall of facts.walls) {
      const gap =
        segmentDistance([tree.x, tree.z], [tree.x, tree.z], wall.from, wall.to) -
        wall.halfWidth -
        tree.footprint;
      if (gap < WALKABLE_GAP) {
        fouls.push(
          `tree at (${tree.x.toFixed(1)}, ${tree.z.toFixed(1)}) reaching ` +
            `${tree.footprint.toFixed(2)} m leaves ${gap.toFixed(2)} m to the ${wall.kind} run ` +
            `(${fmt(wall.from)}->${fmt(wall.to)})`,
        );
      }
    }
  }
  return fouls;
};

/** No lamp stands in anything: another lamp, a wall, a plot, or the railway. */
const lampsTouchNothing: Invariant = (facts) => {
  const fouls: string[] = [];
  for (let i = 0; i < facts.lamps.length; i += 1) {
    const [x, z] = facts.lamps[i]!;
    const where = `lamp at (${x.toFixed(1)}, ${z.toFixed(1)})`;

    for (let j = i + 1; j < facts.lamps.length; j += 1) {
      const [ox, oz] = facts.lamps[j]!;
      const gap = Math.hypot(x - ox, z - oz);
      if (gap < WALKABLE_GAP) fouls.push(`${where} is ${gap.toFixed(2)} m from another lamp`);
    }
    for (const wall of facts.walls) {
      const gap = segmentDistance([x, z], [x, z], wall.from, wall.to) - wall.halfWidth;
      if (gap < 0) fouls.push(`${where} stands in a ${wall.kind} wall`);
    }
    for (const plot of facts.plots) {
      const gap = Math.hypot(x - plot.x, z - plot.z) - plot.boundingRadius;
      if (gap < 0) fouls.push(`${where} stands inside plot ${plot.id}`);
    }
    const rail = facts.distanceToRail(x, z);
    if (rail < TRACK_CLEARANCE) {
      fouls.push(`${where} is ${rail.toFixed(2)} m from the rail centre line`);
    }
  }
  return fouls;
};

/**
 * Every ride's exit (GAME_DESIGN.md's EXIT rule, 28 July 2026) is clear
 * ground a rider of the player's own radius can actually stand on, and the
 * real nav lattice can actually route a child there from the entrance —
 * proving `paths.ts`'s exit nodes are not just present in the graph but
 * genuinely usable, the same "measure the built park" standard every other
 * invariant here holds to.
 */
const rideExitsAreUsable: Invariant = (facts) => {
  const problems: string[] = [];
  for (const exit of facts.exits) {
    const at = `${exit.id} at (${exit.x.toFixed(1)}, ${exit.z.toFixed(1)})`;
    if (!facts.isStandable(exit.x, exit.z)) problems.push(`${at} is not clear ground`);
    if (!facts.reachableFromEntrance(exit.x, exit.z)) {
      problems.push(`${at} is not reachable from the entrance`);
    }
  }
  return problems;
};

/**
 * The Rail Race's exit has room for the whole **party** that arrives on it, not
 * just for one child.
 *
 * A race ends with four riders, and since 1 August 2026 all four of them are
 * put down at the exit: the player by `RailRace.arrive()`, and Pip, Nell and
 * Otto — look-alikes, see `railRace/exitCrowd.ts` — gathered round her. Three
 * extra bodies is three more chances for somebody to be standing inside a
 * hedge, or inside the player, on a seed nobody looked at.
 *
 * This runs the **real** placement code (`resolveDismount` then
 * `resolveDismountGroup`) against the **real** built collision world, in the
 * same order and with the same radii the ride uses, and then measures where
 * everybody actually ended up. It does not restate the rule that placed them:
 * an assertion that the placer's output satisfies the placer's own constraint
 * would prove nothing, so the check is against `facts.isStandable` — the same
 * "can a walker of the player's radius stand here" question every other
 * invariant in this file asks — and against {@link WALKABLE_GAP}, the width two
 * bodies genuinely need, rather than the seed spacing the placer aims for.
 *
 * The rival count is read off the **built ride** (`laneCount` minus the
 * player's own lane) rather than imported, for the reason `railRaceFliesClear`
 * gives: a static import of `railRace/plan.ts` here would pull in
 * `parkManifest` and fix the park seed before the harness has set it.
 */
const railRaceExitFitsTheParty: Invariant = (facts) => {
  const exit = facts.exits.find((node) => node.id === 'exit-railRace');
  if (!exit) return [`the built path graph has no 'exit-railRace' node`];

  const collision = facts.world.collision;
  // The player is set down first and keeps her spot — exactly `arrive()`'s
  // order, which is what makes "nobody appears on top of her" true.
  const player = resolveDismount(collision, exit.x, exit.z, PLAYER_RADIUS);
  const rivals = facts.world.railRace.laneCount - 1;
  const spots = resolveDismountGroup(collision, player.x, player.z, PLAYER_RADIUS, rivals, [
    { x: player.x, z: player.z, radius: PLAYER_RADIUS },
  ]);

  // Fail here rather than carrying on: the crowding checks below walk whatever
  // party was actually placed, so a short list would quietly check fewer bodies
  // against each other and still come back clean.
  if (spots.length !== rivals) {
    return [`only ${spots.length} of ${rivals} rivals were given a spot`];
  }

  const party = [
    { who: 'the player', x: player.x, z: player.z },
    ...spots.map((spot, index) => ({ who: `rival ${index + 1}`, x: spot.x, z: spot.z })),
  ];

  const problems: string[] = [];
  for (let i = 0; i < party.length; i += 1) {
    const a = party[i]!;
    const at = `(${a.x.toFixed(1)}, ${a.z.toFixed(1)})`;
    if (!facts.isStandable(a.x, a.z)) {
      problems.push(`${a.who} is put down at ${at}, which is not clear ground`);
    }
    for (let j = i + 1; j < party.length; j += 1) {
      const b = party[j]!;
      const gap = Math.hypot(a.x - b.x, a.z - b.z);
      if (gap < WALKABLE_GAP) {
        problems.push(
          `${a.who} and ${b.who} are ${gap.toFixed(2)} m apart at ${at} — ` +
            `two bodies need ${WALKABLE_GAP} m, so they are standing inside each other`,
        );
      }
    }
  }
  return problems;
};

/**
 * **No paved ribbon stops anywhere but a destination.**
 *
 * REQUIREMENTS-2026-07-28 §5, the family's "paths to nowhere" ruling: the
 * walking network derives from a graph of places to visit only, and no ribbon
 * may terminate anywhere but a node. A spur has two ends and both are held to
 * it — the far end must reach the node its edge names, and the near end must
 * genuinely meet the rest of the paving rather than beginning in the grass a
 * few metres off it.
 *
 * Measured on the **drawn** curve, which is the point. The ribbon is a
 * Catmull-Rom swept through control points, and `paths.ts` chooses a spur's
 * junction by walking the control *polygon* of the routes built so far — a
 * polygon the drawn curve bows away from. Checking the control points would
 * only restate the generator's intention; these are the metres of paving a
 * child actually walks on.
 *
 * The backbone is exempt: it is a closed loop and has no ends.
 */
const noPathEndsNowhere: Invariant = (facts) => {
  const nodes = new Map(facts.pathNodes.map((node) => [node.id, node]));
  const strays: string[] = [];

  for (const edge of facts.pathEdges) {
    if (edge.backbone) continue;
    const first = edge.points[0];
    const last = edge.points[edge.points.length - 1];
    if (!first || !last) {
      strays.push(`${edge.name} is a paved edge that drew no ribbon at all`);
      continue;
    }

    const ends = [
      ['start', edge.from, first],
      ['end', edge.to, last],
    ] as const;

    for (const [which, id, point] of ends) {
      // `'ring'` is not a node: it is `paths.ts`'s name for the paved network
      // itself. A spur branches off wherever paving already runs — the
      // backbone or an earlier spur — so what has to be true of this end is
      // that it really does land on some other paving.
      if (id === 'ring') {
        const gap = distanceToOtherPaving(facts, edge.name, point);
        if (gap > ARRIVAL) {
          strays.push(
            `${edge.name}'s ${which} at ${fmt(point)} is ${gap.toFixed(2)} m from the ` +
              `nearest other paving — it branches off nothing`,
          );
        }
        continue;
      }

      const node = nodes.get(id);
      if (!node) {
        strays.push(`${edge.name}'s ${which} names '${id}', which is not a node in the graph`);
        continue;
      }
      const gap = Math.max(
        0,
        Math.hypot(point[0] - node.x, point[1] - node.z) - node.reach,
      );
      if (gap > ARRIVAL) {
        strays.push(
          `${edge.name}'s ${which} at ${fmt(point)} stops ${gap.toFixed(2)} m short of ` +
            `'${node.id}' (${node.kind}) at ${fmt([node.x, node.z])} — a path to nowhere`,
        );
      }
    }
  }
  return strays;
};

/**
 * **Every place a child can be served is a node in the graph.**
 *
 * The other half of §5's ruling: the network derives from a graph of *real*
 * destinations, and the entrance of every ride and building is one of them. So
 * this asks the question the other way round from {@link noPathEndsNowhere} —
 * not "does this ribbon end somewhere real?" but "does every real place have a
 * node?".
 *
 * `facts.entrances` is built from the coordinates the **game** uses — the
 * anchors' own entrances and `STALL_STANDS`, the same points the interact zones
 * and the NPC waypoint graph are seeded from — so this compares the
 * destinations the park actually has against the destinations the path network
 * knows about, rather than comparing the generator to itself.
 *
 * The ferris wheel's ticket kiosk was missing from the graph entirely until
 * issue #114: it is placed by relation to the wheel rather than by the layout
 * solver, so the loop that built stall nodes by walking `PARK_LAYOUT`'s
 * `stall.` entries never saw it, and it survived only by happening to stand
 * near the wheel's own spur.
 */
const everyDestinationIsANode: Invariant = (facts) => {
  const missing: string[] = [];
  for (const entrance of facts.entrances) {
    let best = Infinity;
    for (const node of facts.pathNodes) {
      const gap = Math.hypot(entrance.x - node.x, entrance.z - node.z) - node.reach;
      if (gap < best) best = gap;
    }
    if (best > ARRIVAL) {
      missing.push(
        `${entrance.id} at ${fmt([entrance.x, entrance.z])} is ${best.toFixed(2)} m from the ` +
          `nearest path-graph node — nothing in the network leads to it`,
      );
    }
  }
  return missing;
};

/** Every path is lit along its whole length. */
const everyPathIsLit: Invariant = (facts) => {
  const dark: string[] = [];
  for (const route of facts.routes) {
    const step = route.length / (route.points.length - 1);
    let run = 0;
    let worst = 0;
    for (const [x, z] of route.points) {
      const lit = facts.lamps.some(([lx, lz]) => Math.hypot(lx - x, lz - z) < LAMP_REACH);
      run = lit ? 0 : run + step;
      if (run > worst) worst = run;
    }
    if (worst > MAX_DARK_RUN) {
      dark.push(`${route.name} has ${worst.toFixed(1)} m with no lamp within ${LAMP_REACH} m`);
    }
  }
  return dark;
};

/**
 * **You can find a tree to climb without hunting for one.**
 *
 * Jim, 6 August: *"re the trees, we need more climbable trees, it takes a long
 * time to find one."* The complaint is about **finding**, not about the total,
 * and the two have identical symptoms — a park with plenty of climbable trees
 * all in one corner is just as bad as a park with three. So this measures the
 * walk, not the count. (The count gets its own anti-vacuity floor below, which
 * is a different job: that one catches a park with none.)
 *
 * Measured along the **paved network**, in the shape of {@link everyPathIsLit},
 * because that is where a child actually walks and it is already sampled every
 * ~0.5 m. Measuring instead over every standable square metre would be
 * dominated by the middle of the park, which has no trees of any kind in it —
 * the plots, stalls and plaza consume the inner ~30 m — and would therefore
 * report a number nothing in this PR could move.
 *
 * The threshold comes from the game: `PLAYER_MAX_SPEED`, her own top speed,
 * times {@link SEARCH_SECONDS}. Not from the scatter's target, and not from
 * whatever the park currently manages.
 *
 * Measured on the paved network, worst point on each CI seed. The middle
 * column is this branch's predicate on the pre-#216 park; the last is the same
 * predicate on the park as it now stands, where trees plant past the old 55 m
 * cap and so sit further from the middle:
 *
 * ```
 *            old rule   this rule   this rule, post-#216
 *   canon       54.2       41.9            51.3
 *   seed 2      45.9       39.4            55.4
 *   seed 5      96.9       38.8            47.3   <- had ONE climbable tree
 *   seed 11     72.9       38.5            43.3
 *   seed 18     42.4       40.7            42.9
 * ```
 *
 * Every one of those worst points is in the plaza — see
 * {@link SEARCH_SECONDS} for why that makes this a backstop rather than the
 * tight guard it looks like.
 */
const everyPathIsNearAClimbableTree: Invariant = (facts) => {
  const far: string[] = [];
  for (const edge of facts.pathEdges) {
    let worst = 0;
    let worstAt: readonly [number, number] = [0, 0];
    for (const [x, z] of edge.points) {
      let nearest = Infinity;
      for (const tree of facts.climbableTrees) {
        const d = Math.hypot(tree.x - x, tree.z - z);
        if (d < nearest) nearest = d;
      }
      if (nearest > worst) {
        worst = nearest;
        worstAt = [x, z];
      }
    }
    // `worst` stays 0 for an edge with no points; it stays Infinity-free
    // because a park with no climbable trees at all leaves `nearest` infinite,
    // which is exactly the complaint below and must not be silently skipped.
    if (!Number.isFinite(worst)) {
      far.push(`${edge.name} has no climbable tree anywhere in the park to be near`);
    } else if (worst > MAX_CLIMB_SEARCH) {
      far.push(
        `${edge.name} passes ${fmt(worstAt)}, which is ${worst.toFixed(1)} m from the nearest ` +
          `climbable tree (a child would walk ${(worst / PLAYER_MAX_SPEED).toFixed(1)} s flat out ` +
          `to reach one, and only ${facts.climbableTrees.length} trees in the park can be climbed)`,
      );
    }
  }
  return far;
};

/**
 * **The Rail Race flies clear of everything it crosses.**
 *
 * The ring runs round the park's rim at a radius the railway already occupies,
 * so the two share ground the whole way round and only height keeps them apart
 * — and the ground under it is different on every seed. Two things are measured
 * off the built park:
 *
 * 1. **Air over the railway.** Decision 4 asks for 5.5 m of rail-over-rail
 *    clearance. Measured from the Rail Race's own rail heights down to the
 *    train's, wherever the two pass within a track's width of each other.
 * 2. **Where the trestles landed.** The legs are read back out of the built
 *    scene by name and their instance matrices decoded — not recomputed from
 *    the placement predicate, which would only prove the predicate agrees with
 *    itself. A leg standing on the railway is a leg the train drives through.
 * 3. **How many actually landed.** `track.ts`'s `trestleSpots` search a small
 *    neighbourhood before giving up on a slot (1 August 2026 — the ring runs
 *    through the park's own busiest band, and a single fixed candidate point
 *    per slot found almost nowhere clear to stand: 1 of 28 on the canonical
 *    seed before that search existed). A slot going missing here and there is
 *    fine and expected; a long unsupported run is the ring visibly floating,
 *    which this measures as the widest gap between consecutive legs, sorted
 *    round the ring by angle — not by re-running the search and checking it
 *    agrees with itself, but by measuring the real distance between the real
 *    legs the built scene actually has.
 *
 * `check:rail-race` asserts the same clearances in far more detail, but only on
 * the canonical seed; this is the half that has to hold whatever park is grown.
 */
const railRaceFliesClear: Invariant = (facts) => {
  // Reached through the built world, never imported: see the note on
  // `RailRace.route`. A static import here would set the park seed too early.
  const { walkPastRoute, raceRoute, laneCount } = facts.world.railRace;
  const train = facts.world.train.route;
  const complaints: string[] = [];

  // --- 1. air over the railway ----------------------------------------------
  //
  // Both rings, though since 2 August 2026 they circle the park outside the
  // boundary wall and the railway's own band is 48-58 m, so on a healthy park
  // nothing here is ever within range and this passes vacuously. Kept, and kept
  // measuring rather than assuming: it is the thing that would notice the day
  // somebody moves a ring back inside.
  const rail = new Vector3();
  const under = new Vector3();
  let worstAir = Infinity;
  let worstAt: readonly [number, number] = [0, 0];

  const samples = 720;
  for (const route of [walkPastRoute, raceRoute]) {
  for (let i = 0; i < samples; i += 1) {
    const distance = (i / samples) * route.length;
    for (let lane = 0; lane < laneCount; lane += 1) {
      route.pointAt(lane, distance, rail);
      if (facts.distanceToRail(rail.x, rail.z) > TRACK_CLEARANCE * 2) continue;
      train.pointAt(train.distanceNear(rail.x, rail.z), under);
      const air = rail.y - under.y;
      if (air < worstAir) {
        worstAir = air;
        worstAt = [rail.x, rail.z];
      }
    }
  }
  }
  if (worstAir < RAIL_OVER_RAIL) {
    complaints.push(
      `only ${worstAir.toFixed(2)} m of air over the railway at ${fmt(worstAt)} — ` +
        `Decision 4 asks for ${RAIL_OVER_RAIL} m`,
    );
  }

  // --- 2. where the trestle legs actually landed -----------------------------
  //
  // Per ring, because there are two of them and `getObjectByName` on the ride's
  // whole group would silently only ever find the first.
  for (const ring of builtRings(facts)) {
  const legs = ring.group.getObjectByName('railRace:trestle-legs');
  if (!(legs instanceof InstancedMesh)) {
    complaints.push(`the ${ring.label} ring has no trestle legs in the built scene to measure`);
  } else {
    const matrix = new Matrix4();
    const at = new Vector3();
    const positions: { angle: number; x: number; z: number }[] = [];
    for (let i = 0; i < legs.count; i += 1) {
      legs.getMatrixAt(i, matrix);
      at.setFromMatrixPosition(matrix);
      positions.push({ angle: Math.atan2(at.z, at.x), x: at.x, z: at.z });
      const toRail = facts.distanceToRail(at.x, at.z);
      if (toRail < TRACK_CLEARANCE) {
        complaints.push(
          `a trestle leg at ${fmt([at.x, at.z])} stands ${toRail.toFixed(2)} m from the railway ` +
            `centre line, inside the train`,
        );
      }
      for (const entrance of facts.entrances) {
        const gap = Math.hypot(at.x - entrance.x, at.z - entrance.z);
        if (gap < WALKABLE_GAP) {
          complaints.push(
            `a trestle leg at ${fmt([at.x, at.z])} is ${gap.toFixed(2)} m from ` +
              `${entrance.id}'s doormat, close enough to pinch it shut`,
          );
        }
      }
    }

    // --- 3. no long unsupported run ------------------------------------------
    // Angle order round a ring this close to circular puts legs in the same
    // order the track visits them; the *distance* itself is the real chord
    // between two real measured leg positions, not an angle converted through
    // an assumed radius — measuring the built legs, not a description of them.
    if (positions.length >= 2) {
      positions.sort((a, b) => a.angle - b.angle);
      let worstGap = 0;
      let worstIndex = 0;
      for (let i = 0; i < positions.length; i += 1) {
        const a = positions[i]!;
        const b = positions[(i + 1) % positions.length]!;
        const gap = Math.hypot(b.x - a.x, b.z - a.z);
        if (gap > worstGap) {
          worstGap = gap;
          worstIndex = i;
        }
      }
      if (worstGap > TRESTLE_GAP_TOLERANCE) {
        complaints.push(
          `the widest run between consecutive trestle legs on the ${ring.label} ring is ` +
            `${worstGap.toFixed(1)} m (after leg ${worstIndex}), over the ` +
            `${TRESTLE_GAP_TOLERANCE} m tolerance — the ring is standing on air for a stretch ` +
            `that long`,
        );
      }
    }
  }
  }

  return complaints;
};

/**
 * The two rings the Rail Race actually built, read back out of the scene.
 *
 * Named groups, not a description of them: if a ring stops being built, or is
 * renamed, or is quietly folded back into a single scaled one, this returns the
 * wrong number of rings and every invariant below says so.
 */
interface BuiltRing {
  readonly label: string;
  readonly group: Object3D;
  /** How big this ring claims to be, straight off the world's own route. */
  readonly scale: number;
}

function builtRings(facts: ParkFacts): readonly BuiltRing[] {
  const railRace = facts.world.railRace;
  return (
    [
      ['walk-past', 'railRace:walk-past-ring', railRace.walkPastRoute.scale],
      ['race', 'railRace:race-ring', railRace.raceRoute.scale],
    ] as const
  ).flatMap(([label, name, scale]) => {
    // `flatMap` with a narrowing `if`, rather than `.map(...).filter(guard)`.
    //
    // The filter form was two type errors, and they were not cosmetic — this
    // file was never typechecked until `tsconfig.test.json` existed (#192), so
    // they sat on main unnoticed. `.map` produced `group: Object3D | undefined`,
    // and the guard claimed `ring is BuiltRing`, which TypeScript rejected
    // outright (TS2677): `BuiltRing.label` is `string`, but the mapped element's
    // is the literal union `'walk-past' | 'race'`, so the predicate's type was
    // not assignable to the parameter it was narrowing. The `readonly
    // BuiltRing[]` return then failed too, because nothing had actually narrowed
    // `group`.
    //
    // A predicate would have silenced both, but a predicate is an *assertion* —
    // the compiler takes it on trust, which is what let the mismatch hide in the
    // first place. Here the `if` narrows `group` for real and the object literal
    // is checked against `BuiltRing` by ordinary inference. Nothing is asserted,
    // so nothing can be asserted wrongly.
    //
    // Behaviour is identical: a ring whose group is missing is still dropped,
    // which is deliberate — see this function's doc. The callers count the rings
    // they get back, and that count going wrong is the alarm.
    const group = railRace.group.getObjectByName(name);
    return group ? [{ label, group, scale }] : [];
  });
}

/**
 * How far outside the park's edge the rails of one ring actually run — the
 * nearest and furthest, straight off the swept tube's own vertices.
 *
 * **Outset, not radius, and that is the whole point.** This measured
 * `Math.hypot(x, z)` until the park stopped being a circle. A radius is only a
 * statement about the edge when the edge is the same distance away on every
 * bearing; once the boundary ran 59.7 m at the pinch and 101.4 m at the bulge,
 * `r = 65.5` meant "comfortably outside" on one bearing and "35 m inside, with
 * the masonry running between the rails" on another — and the assertion built
 * on it went on passing, because 65.5 > 60 is true regardless of where the park
 * actually is. Asking the boundary itself is what makes the claim survive a
 * change of shape.
 *
 * Not `route.pointAt` — that is the rule the rails were built from, and this
 * file's first commandment is to measure the thing that was built. The lane
 * centre line would also miss half a gauge of real structure either side of it,
 * which is exactly the margin these checks are about.
 */
function railOutsetRange(
  ring: BuiltRing,
  boundary: ParkFacts['boundary'],
): { min: number; max: number; vertices: number } {
  let min = Infinity;
  let max = -Infinity;
  let vertices = 0;
  ring.group.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    if (!child.name.startsWith('railRace:rail-')) return;
    const position = child.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i += 1) {
      // Outset, not radius. `distanceToEdge` is positive inside the park, so a
      // rail out beyond the wall — where both rings belong — reads positive here.
      const outset = -boundary.distanceToEdge(position.getX(i), position.getZ(i));
      if (outset < min) min = outset;
      if (outset > max) max = outset;
      vertices += 1;
    }
  });
  return { min, max, vertices };
}

/**
 * **Both Rail Race rings are built outside the park, at their own real size,
 * and only the one you can walk up to is solid.**
 *
 * This is the invariant for the two-ring rebuild of 2 August 2026, and it is
 * really one claim in four parts. All four are measured off the built scene —
 * the rails from their own swept vertices, the legs from their instance
 * matrices, the solidity from the collision world the park actually registered.
 *
 * 1. **Outside the wall, on real ground.** Every rail vertex of every lane of
 *    both rings sits further *outside the park's own edge* than the boundary
 *    masonry and a child's own radius need — a child pressed against the
 *    outside of the wall is not standing in a rail — and no further out than
 *    `RIM_OUTSET_START`, where the hill starts falling away and there is no flat
 *    ground to stand a trestle on. Both are measured as **outset**, by asking
 *    the built boundary; see `railOutsetRange` for why a radius stopped being a
 *    statement about the edge the moment the park stopped being a circle. The
 *    whole point of moving out here was that the apron is empty; this is what
 *    stops a later tweak drifting the ring back over the park or off the hill.
 *
 * 2. **Two sizes, genuinely built.** The race ring's measured radial width is
 *    the ride's own scale factor times the walk-past ring's, taken as the ratio
 *    of the two routes the world is holding rather than as an invented number.
 *    A single ring drawn twice at different `group.scale` would pass a lane-span
 *    check computed from the rules and fail this one, because this one measures
 *    vertices.
 *
 * 3. **Nothing in the ride carries a scale multiply on its geometry.** Every
 *    object under a ring group, and the ring groups themselves, must be at unit
 *    scale — and so must every cart sitting in the park at rest. This is the
 *    literal bug from Jim's screenshot: a rival's cart group was scaled 2.5x
 *    once at construction and never unscaled, so the ambient riders were
 *    two-and-a-half times life size to anyone who walked or flew past. A park
 *    that has just been built is a park at rest, so at rest is what this asserts.
 *
 * 4. **Only the walk-past ring is solid.** Its trestle legs are registered as
 *    collision circles; the race ring's are not. `CollisionWorld` cannot
 *    un-register a collider, so a race ring that ever registered one would leave
 *    an invisible solid post standing in the park for the rest of the session —
 *    the classic "walked into a rail that is not drawn" bug. Checked by asking
 *    the real collision world what is at each measured leg position.
 */
const railRaceRingsStandOutsideThePark: Invariant = (facts) => {
  const complaints: string[] = [];
  const rings = builtRings(facts);

  if (rings.length !== 2) {
    complaints.push(
      `the Rail Race built ${rings.length} named ring group(s), not the two the ride is made of ` +
        `— a walk-past ring at park scale and a race ring at ride scale`,
    );
    return complaints;
  }

  // --- 1. outside the wall, inside the hill ---------------------------------
  const widths = new Map<string, number>();
  // Two separate claims, and the rail has to satisfy both, so the threshold is
  // whichever binds harder. Neither number is chosen here; both are read off the
  // built park.
  //
  //  - **No child is standing in a rail.** She is stopped by the *collision*
  //    wall, so the furthest out she can be is its half-thickness plus her own
  //    radius.
  //  - **No rail is driven through stone.** The widest masonry is the pillar
  //    cap, which bulges past the collision wall — a rail clearing the collider
  //    can still pass through a cap, invisible to physics and obvious to a
  //    six-year-old.
  const clearOfMasonry = Math.max(
    facts.wallCollisionHalf + PLAYER_RADIUS,
    facts.masonryHalfWidth,
  );
  for (const ring of rings) {
    const { min, max, vertices } = railOutsetRange(ring, facts.boundary);
    if (vertices === 0) {
      complaints.push(`the ${ring.label} ring has no rail geometry in the built scene to measure`);
      continue;
    }
    widths.set(ring.label, max - min);
    if (min < clearOfMasonry) {
      complaints.push(
        `the ${ring.label} ring's innermost rail comes ${min.toFixed(2)} m outside the park edge, ` +
          `inside the ${clearOfMasonry.toFixed(2)} m the boundary masonry and a child's own ` +
          `${PLAYER_RADIUS} m need — the wall runs through the ride there`,
      );
    }
    if (max > RIM_OUTSET_START) {
      complaints.push(
        `the ${ring.label} ring's outermost rail runs ${max.toFixed(2)} m outside the park edge, ` +
          `past the ${RIM_OUTSET_START} m where the hill starts falling away — there is no flat ` +
          `ground out there to stand a trestle on`,
      );
    }
  }

  // --- 2. two sizes, measured, not described --------------------------------
  const walkPastWidth = widths.get('walk-past');
  const raceWidth = widths.get('race');
  if (walkPastWidth !== undefined && raceWidth !== undefined && walkPastWidth > 0) {
    const measured = raceWidth / walkPastWidth;
    // The ride's own factor, off the world rather than imported: `route.ts`
    // pulls in the park manifest at module load and a static import here would
    // fix the seed before the harness has set it.
    const expected = facts.world.railRace.raceRoute.scale / facts.world.railRace.walkPastRoute.scale;
    if (Math.abs(measured - expected) > 0.02) {
      complaints.push(
        `the race ring's rails span ${raceWidth.toFixed(2)} m against the walk-past ring's ` +
          `${walkPastWidth.toFixed(2)} m — a ratio of ${measured.toFixed(3)}, not the ` +
          `${expected.toFixed(3)} the two rings' scales claim. The rings are supposed to be built ` +
          `to their own dimensions, not drawn once and multiplied`,
      );
    }
  }

  // --- 3. no scale multiply anywhere in the ride ----------------------------
  const unit = (object: Object3D): boolean =>
    Math.abs(object.scale.x - 1) < 1e-6 &&
    Math.abs(object.scale.y - 1) < 1e-6 &&
    Math.abs(object.scale.z - 1) < 1e-6;

  for (const ring of rings) {
    ring.group.traverse((child) => {
      if (unit(child)) return;
      complaints.push(
        `${child.name || child.type} in the ${ring.label} ring is drawn at scale ` +
          `${child.scale.x.toFixed(2)} — ring geometry is built at its own size, never scaled`,
      );
    });
  }

  const walkPastScale = facts.world.railRace.walkPastRoute.scale;
  facts.world.railRace.group.traverse((child) => {
    if (child.name !== 'railRace:cart') return;
    if (Math.abs(child.scale.x - walkPastScale) < 1e-6) return;
    complaints.push(
      `a cart is sitting in the park at scale ${child.scale.x.toFixed(2)} with nobody racing — ` +
        `at rest every cart and rider belongs on the walk-past ring at scale ` +
        `${walkPastScale.toFixed(2)}. This is the 2 August 2026 bug: giant rivals idling past a ` +
        `normal-sized child`,
    );
  });

  // --- 4. only the walk-past ring is solid ----------------------------------
  const solid: { x: number; z: number; radius: number }[] = [];
  facts.world.collision.forEachCircle((x, z, radius) => {
    solid.push({ x, z, radius });
  });
  const matrix = new Matrix4();
  const at = new Vector3();
  for (const ring of rings) {
    const legs = ring.group.getObjectByName('railRace:trestle-legs');
    if (!(legs instanceof InstancedMesh)) {
      complaints.push(`the ${ring.label} ring has no trestle legs in the built scene to measure`);
      continue;
    }
    const wantsSolid = ring.label === 'walk-past';
    for (let i = 0; i < legs.count; i += 1) {
      legs.getMatrixAt(i, matrix);
      at.setFromMatrixPosition(matrix);
      const found = solid.some(
        (circle) => Math.hypot(circle.x - at.x, circle.z - at.z) < circle.radius,
      );
      if (found === wantsSolid) continue;
      complaints.push(
        wantsSolid
          ? `the walk-past ring's trestle leg at ${fmt([at.x, at.z])} is not solid — it is the ` +
            `ring that is standing there while a child is on foot, so it has to be something ` +
            `she bumps into rather than walks through`
          : `the race ring's trestle leg at ${fmt([at.x, at.z])} registered a collider. That ring ` +
            `is hidden except mid-race, and CollisionWorld cannot un-register anything, so this ` +
            `is an invisible solid post standing in the park for the rest of the session`,
      );
    }
  }

  return complaints;
};

/**
 * Longest a duck bar is allowed to sit from the nearest real trestle leg,
 * horizontally.
 *
 * Not the generator's own bound (`track.ts`'s `WIDE_ARC_NUDGES`/
 * `WIDE_RADIAL_NUDGES` can in principle nudge a support a little over 9 m
 * from its nominal grid point) — deliberately tighter, because the actual
 * guarantee this invariant exists to protect is architectural: a duck bar's
 * `at` and its support's grid index are *the same number*
 * (`hazards.ts`'s `snapToTrestleGrid`, `trestleGridIndex`), not two
 * independently-placed things that merely tend to end up near each other.
 * With legs roughly every 13 m round the ring, "nearest leg" would often be
 * under this by pure chance even for a bar placed with no relationship to
 * the supports at all, which is exactly the bug this whole mechanism exists
 * to fix — so this number is a sanity cross-check on the real, measured
 * geometry, not the proof of correctness by itself; the shared grid index in
 * the code is that proof. Measured against the real built park before this
 * mechanism existed (bars placed by the old, independent RNG cursor): worst
 * observed gap to the nearest leg was several times this.
 */
const DUCK_BAR_SUPPORT_TOLERANCE = 8;

/**
 * **Every duck bar stands over a real trestle leg.**
 *
 * Jim, 1 August 2026: the hazard schedule and the trestle placement were
 * "completely independent systems with no relationship" — a bar could land
 * anywhere a seeded RNG's cursor happened to stop, with nothing structural
 * underneath it. `hazards.ts`'s `snapToTrestleGrid` and `track.ts`'s
 * `trestleSpots` now derive both from one shared grid index, and
 * `trestleSpots` treats a grid slot with a bar scheduled on it as mandatory
 * rather than something the ring is allowed to shrug off.
 *
 * Measured off the built scene — both `railRace:duck-bars` and
 * `railRace:trestle-legs` are read back by name and their instance matrices
 * decoded — not by recomputing `snapToTrestleGrid`/`trestleGridIndex` and
 * checking they agree with themselves, which is exactly the tautology
 * ART-AGENT-NOTES.md §6 warns a parity check can quietly become. A real
 * geometric distance between two real meshes is what a family would
 * actually see if this broke again.
 */
const duckBarsStandOnRealSupports: Invariant = (facts) => {
  const complaints: string[] = [];
  const matrix = new Matrix4();
  const barPosition = new Vector3();

  // Both rings: each builds its own bars over its own legs, and a bar floating
  // free on the ring nobody is currently looking at is still a bug.
  for (const ring of builtRings(facts)) {
    const barsMesh = ring.group.getObjectByName('railRace:duck-bars');
    const legsMesh = ring.group.getObjectByName('railRace:trestle-legs');
    if (!(barsMesh instanceof InstancedMesh) || !(legsMesh instanceof InstancedMesh)) {
      complaints.push(
        `the ${ring.label} ring has no duck bars or trestle legs in the built scene to measure`,
      );
      continue;
    }

    const legPositions: Vector3[] = [];
    for (let i = 0; i < legsMesh.count; i += 1) {
      legsMesh.getMatrixAt(i, matrix);
      legPositions.push(new Vector3().setFromMatrixPosition(matrix));
    }

    for (let i = 0; i < barsMesh.count; i += 1) {
      barsMesh.getMatrixAt(i, matrix);
      barPosition.setFromMatrixPosition(matrix);
      let nearest = Infinity;
      for (const leg of legPositions) {
        const d = Math.hypot(barPosition.x - leg.x, barPosition.z - leg.z);
        if (d < nearest) nearest = d;
      }
      if (nearest > DUCK_BAR_SUPPORT_TOLERANCE) {
        complaints.push(
          `duck bar ${i} on the ${ring.label} ring at ${fmt([barPosition.x, barPosition.z])} is ` +
            `${nearest.toFixed(1)} m from the nearest trestle leg, over the ` +
            `${DUCK_BAR_SUPPORT_TOLERANCE} m tolerance — it is floating free of the ring's own ` +
            `support structure`,
        );
      }
    }
  }

  return complaints;
};

/**
 * **The rail-race stall's doormat is usable** — standable ground under it, and
 * walkable to from the park entrance on the real nav lattice.
 *
 * ### What this stopped claiming, and where that claim went
 *
 * This was `railRaceStallStandsAtTheRim`, and its headline claim was
 * *relational*: the booth's gap to the built ring had to be the smallest of
 * every plot in the park. That was a sound way to say "at the rim" while the
 * ring was a circle of fixed radius, because closest-to-the-ring and
 * furthest-out were then the same statement. Once the ring follows the park's
 * edge they are not. The edge runs 59.7 m at the pinch and 101.4 m at the
 * bulge, so a plot's gap to the ring became a fact about which *way* it lies,
 * not about how far out it stands.
 *
 * The booth is pinned at bearing 20°, and measured across the five seeds this
 * suite runs it sits 43.1 m from the ring against `waterFight`'s 34.0 m
 * (canonical) and 50.2 m against `ferrisWheel`'s 33.3 m (seed 18). It failed on
 * five of five, so this is not one unlucky seed and CLAUDE.md's "swap the seed"
 * remedy has nothing to swap to.
 *
 * ### The reason is what it *costs* to satisfy it, not that it cannot be
 *
 * Be careful with two tempting explanations. **Both are false, and both were
 * written here before being checked:**
 *
 *  - *"The rivals move per seed."* They do not. **11 of the 12 plots are
 *    identical to three decimal places on all five seeds**, including every
 *    anchor — `ferrisWheel`, `dodgems`, `building`, `ballPit`. Only
 *    `stall.skyCruiser` moves at all (by up to 3.9 m) and it is never the
 *    binding rival. What re-rolls per seed is the **boundary and the ring**:
 *    the edge runs 58.4–110.4 m and the lap 591.9–604.5 m. The gaps move
 *    because the ring moves, not because the plots do.
 *  - *"A fixed pin cannot satisfy a relational claim."* It can. Enumerating the
 *    legal disc (r ≤ 48.6) at 0.1° × 0.25 m finds **49,384 positions that
 *    satisfy the rim claim**, best margin −19.2 m. (A coarser independent sweep
 *    at 0.5° × 0.5 m finds 9,867 — the same density.) There is no shortage of
 *    winning pins.
 *
 * **What is true is that every winning pin breaks the park.** Four positions
 * from the cleanest part of that region — bearings 265/270/275/280 at r = 48.5,
 * clear of every plot and 170–180° round from the gate — were built and checked.
 * **All four fail `check:park`:** `poi.stranded` 1–2 where this branch has 0,
 * `rail.exclusion` 36 m against a recorded 21, `rail.walkable` 44 against 30.
 * An earlier exhaustive sweep of the east cluster found the same thing from the
 * other side: 344 rim-passing positions, none of them clean.
 *
 * And one of the stranded waypoints is **(20.9, 20.2)** — the ferris wheel
 * kiosk's own stand, which #233 shows sits 2.39 m *inside* that ride's exclusion
 * disc and so strands the moment anything reshapes the path network. The booth
 * cannot be pinned to the rim without paying that, which is why the claim is
 * **handed to issue #117** ("Ride stalls must adjoin their rides in the
 * generated layout"): placing the stall *by relation to its ride* is what gets
 * it near the rails without a pin that wrecks the network. (#117 waits on #222's
 * scenery RNG decoupling in turn — moving the booth lengthens its path spur, and
 * the single shared scatter stream then drops a garden wall across an unrelated
 * waypoint, the cascade `parkManifest.ts` already documents.)
 *
 * ### What it still claims, and why that half stays here
 *
 * The two usability claims, unchanged and green on all five seeds: the doormat
 * has standable ground, and it can be walked to from the park entrance. They
 * are precisely the properties *this* change can break — it moves the ride exit
 * and rewrites where a path spur branches (`bestBranchPoint`) — so they earn
 * their place in this PR rather than travelling with #117. Standability is also
 * covered generically for every entrance by `entrancesAreUsable`, but
 * reachability is not covered for any entrance anywhere else in this file, and
 * it is the half `poiGraph`'s stranding bug actually broke. Dropping the whole
 * invariant would have thrown that away along with the part that had to go.
 */
const railRaceStallDoormatIsUsable: Invariant = (facts) => {
  const complaints: string[] = [];
  const doormat = facts.entrances.find((entrance) => entrance.id === 'stall:railRacer');
  if (!doormat) {
    complaints.push("the built park has no 'stall:railRacer' doormat");
    return complaints;
  }
  const at = `(${doormat.x.toFixed(1)}, ${doormat.z.toFixed(1)})`;
  if (!standableNear(facts, doormat.x, doormat.z)) {
    complaints.push(`the rail-race stall's doormat at ${at} has no standable ground nearby`);
  }
  if (!facts.reachableFromEntrance(doormat.x, doormat.z)) {
    complaints.push(
      `the rail-race stall's doormat at ${at} cannot be walked to from the park entrance`,
    );
  }
  return complaints;
};

/**
 * Half a Sky Cruiser car, in metres.
 *
 * The car body is `toonBox(1.5, 0.7, 2.2, …)` in `Coaster.ts` — so 0.75 m of it
 * sticks out either side of the centre line, and 0.75 m is therefore the gap at
 * which the ride stops missing something and starts hitting it.
 *
 * Deliberately the *car*, not the rails (0.625 m) and emphatically not the 3 m
 * corridor the generator aims for. Asserting the generator's own target would
 * only prove it can do arithmetic, and would turn every future tuning change
 * into a test failure. This is the number at which a child in a seat would feel
 * the castle go past.
 */
const CAR_HALF_WIDTH = 0.75;

/**
 * **The Sky Cruiser flies clear of the entire park.** (Issue #198.)
 *
 * ### What this replaces, and why the thing it replaces was wrong
 *
 * There used to be a `TOO_TALL_TO_FLY_OVER` list here — two plot ids, latterly
 * one — with a comment explaining that the 6.2 m cruise floor "clears the trees,
 * the garlands and the train", and that the big wheel was therefore *"the only
 * horizontal obstacle the loop actually has"*.
 *
 * **That claim was false when it was last written down, and the park had been
 * contradicting it for as long as the station ramp existed.** The ride flew
 * through a tree canopy and a bush beside its own station on every one of the
 * five seeds below, and through a wooden hiding wall on seed 5. It was invisible
 * because all three checks that asked "does the coaster hit anything?" — this
 * one, the boot assert and the route solver — asked it of that same typed-out
 * list rather than of the park.
 *
 * Two measurements say why it could not have been kept true by hand. A canopy
 * reaches **6.68 m** above its own ground while the car's underside at cruise is
 * 6.04 m, so the cruise floor does *not* clear the trees; and **83 m of the
 * 185 m loop** has the car below 6 m, because the profile dips at the station
 * and again to thread the castle. A sentence cannot track that, and nothing
 * warns you when it stops being true.
 *
 * ### What it does instead
 *
 * Sweeps the car's own envelope — 0.75 m either side, 1.55 m up to the
 * first-person eye, 0.16 m down to the ties — along the whole loop as eight rays
 * (four corners **plus four edge midpoints**, because corners alone leave a
 * 1.5 m gap across the beam that a lamp post passes clean through) and reports
 * whatever real triangles they hit. No list, no plot circles, no height
 * threshold: a thing added to the park is covered from the day it appears.
 *
 * The requirement is simply **"does not intersect"**. There is deliberately no
 * generous clearance band, and the threshold is emphatically not the generator's
 * `CORRIDOR_RADIUS` of 3 m — asserting a solver's own target proves only that it
 * can do arithmetic and turns every future retune red.
 *
 * A near miss is therefore a pass, and one in particular is meant to stay that
 * way: the RiPika statue at 2.01 m of clear air. It is *reported* as the
 * tightest approach by `check:cruiser-clearance` and fails nothing, and whether
 * a rider passing level with a giant RiPika's chest is a good idea belongs to
 * the family, not to a collision check.
 *
 * Rays decide and boxes only report, and that split is load-bearing: no bounding
 * volume can fly through the castle window, because the wall band has a hole in
 * it and its box does not.
 *
 * Same `cruiserStrikes` the `check:cruiser-clearance` build gate runs, so there
 * is one definition of "does the ride hit anything".
 *
 * Proven red rather than assumed: against the pre-fix scatter it names both
 * original strikes, the canopy at 167 m and the bush at 182 m along the loop.
 */
const skyCruiserFliesClearOfThePark: Invariant = (facts) => facts.cruiserStrikes;

/**
 * **The Sky Cruiser still goes round the big wheel.**
 *
 * Kept alongside the sweep above rather than folded into it, because it is a
 * different kind of claim. The sweep asks whether the built ride *touches*
 * anything; this asks whether the loop respects the one plot it is required to
 * route around, measured against the built curve and the built plot.
 *
 * The distinction matters at the margin the sweep cannot see: a loop threading
 * between the wheel's legs would strike nothing and still be wrong.
 */
const skyCruiserGoesRoundTheBigWheel: Invariant = (facts) => {
  const route = facts.world.coaster.route;
  const complaints: string[] = [];
  const point = new Vector3();

  const plot = facts.plots.find((candidate) => candidate.id === 'ferrisWheel');
  if (!plot) return ['the park has no ferrisWheel plot to measure the coaster against'];

  let worst = Infinity;
  let worstAt: readonly [number, number] = [0, 0];
  // Every metre: the loop is a few hundred metres long and a clip can be
  // brief, so a coarse sweep can step straight over the one bad bend.
  for (let distance = 0; distance < route.length; distance += 1) {
    route.pointAt(distance, point);
    const gap = Math.hypot(point.x - plot.x, point.z - plot.z) - plot.boundingRadius;
    if (gap < worst) {
      worst = gap;
      worstAt = [point.x, point.z];
    }
  }
  if (worst < CAR_HALF_WIDTH) {
    complaints.push(
      `the Sky Cruiser passes ${worst.toFixed(2)} m from the big wheel at ${fmt(worstAt)} — ` +
        `a car is ${CAR_HALF_WIDTH * 2} m wide, so it clips it`,
    );
  }

  return complaints;
};

/**
 * The gentlest turn a rail ride may make, in metres.
 *
 * A ride-comfort number, not a solver setting: the retired 2D game settled on
 * "nothing a six-year-old has to brace against", and `coaster/route.ts` states
 * 12 m as the tightest turn the Sky Cruiser will make. This file cannot import
 * that constant — a static import of the coaster would solve the park layout at
 * the default seed before the per-seed tests get to set theirs — so it is
 * restated here, which is also the point: this is the *claim* being checked,
 * and it is checked against the curve riders are actually on.
 */
const GENTLEST_TURN = 12;

/** Arc spacing between the three points a curvature measurement is taken from. */
const CURVATURE_SPAN = 2.5;

/**
 * Radius of the circle through three points, in plan view. Menger curvature.
 * Infinity where they are collinear.
 */
const radiusThrough = (a: Vector3, b: Vector3, c: Vector3): number => {
  const ab = Math.hypot(b.x - a.x, b.z - a.z);
  const bc = Math.hypot(c.x - b.x, c.z - b.z);
  const ca = Math.hypot(a.x - c.x, a.z - c.z);
  const area = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  if (area < 1e-9) return Infinity;
  return (ab * bc * ca) / (4 * area);
};

/**
 * **The Sky Cruiser's built track really does turn as gently as it claims.**
 *
 * The generator validates turning radius on its own cubics, and that is not the
 * same thing as the ride having it. `CoasterRoute` resamples the solved plan
 * into control points and rebuilds it as a `CatmullRomCurve3`, and a rebuild is
 * not a copy: the spline sags away from the curve its points came from, worst
 * at the tightest bends. Measured before this was fixed, the rebuild ate up to
 * 1.38 m and two of the five seeds here shipped a curve tighter than the 12 m
 * the code declares — seed 2 at 11.68 m, seed 18 at 10.98 m.
 *
 * Which is the same mistake the old solver made, one layer down: it too pushed
 * control points where it wanted them and then smoothed them, so the built
 * curve did not honour what had been validated. A plan is a claim. This
 * measures the fact, and it is the reason the fix cannot silently rot.
 */
const skyCruiserTurnsGently: Invariant = (facts) => {
  const route = facts.world.coaster.route;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let tightest = Infinity;
  let at = 0;
  // Half-metre steps: a single tight bend is a few metres long, and a coarse
  // sweep can step straight over the one that matters.
  for (let d = 0; d < route.length; d += 0.5) {
    route.pointAt(d - CURVATURE_SPAN, a);
    route.pointAt(d, b);
    route.pointAt(d + CURVATURE_SPAN, c);
    const radius = radiusThrough(a, b, c);
    if (radius < tightest) {
      tightest = radius;
      at = d;
    }
  }
  if (tightest < GENTLEST_TURN) {
    return [
      `the Sky Cruiser's built track turns at ${tightest.toFixed(2)} m radius ` +
        `${at.toFixed(0)} m along the loop, tighter than the ${GENTLEST_TURN} m it promises — ` +
        `the plan was validated but the rebuilt curve does not honour it`,
    ];
  }
  return [];
};

/**
 * The suite. **Add an invariant by adding a line here.**
 */
/**
 * Half-width of the ginormous slide's chute, as built.
 *
 * `SlideRide`'s cross-section reaches ±0.95 m and its hand-rails sit at ±1.0 m
 * with a 0.11 m tube, so the thing a child rides in is 2.22 m across. Taken
 * from that geometry rather than from the route generator's corridor half-width,
 * which is the generator's own target and so would prove only that it can do
 * arithmetic.
 *
 * `PLAYER_RADIUS` is deliberately **not** added on top, unlike everywhere else
 * in this file. A rider on a slide is *inside* the trough, held by the rails —
 * the child's own width is already contained by the number above, and adding it
 * again would be double-counting a body that cannot stick out.
 */
const CHUTE_HALF_WIDTH = 1.11;

/**
 * The most the chute may climb between two samples, in metres.
 *
 * Not a tolerance for "roughly downhill": a slide is a thing you go down
 * because gravity does it, and a stretch that rises is a stretch a child stops
 * on. The figure is not zero only because the chute is a Catmull-Rom spline
 * through sampled points, which may overshoot by fractions of a millimetre
 * between them; a millimetre is four hundred times smaller than the 0.41 m
 * profile depth a rider sits in, so nothing at this scale is a slope.
 */
const SLIDE_MAY_RISE = 0.001;

/**
 * **The ginormous slide is one a child can actually ride down and walk away
 * from.** This is #118, stated as something the park proves on every seed.
 *
 * The bug was not subtle and neither is this: the slide's twelve hand-authored
 * coordinates were absolute, the castle's position is per-seed, and eight of
 * the twelve ended up inside the tower — the last of them behind a solid wall,
 * where a six-year-old was left with no way out. Every clause below would have
 * failed on that curve, which is the point.
 *
 * Measured off `facts.slideChute`, which is the built chute pushed out through
 * the scene graph into world space, against the built plots — never against
 * `slide/plan.ts`, which is the thing under test.
 */
const theGinormousSlideIsRideable: Invariant = (facts) => {
  const complaints: string[] = [];
  const chute = facts.slideChute;
  const first = chute[0];
  const last = chute[chute.length - 1];

  if (chute.length < 2 || !first || !last) {
    complaints.push('the ginormous slide has no chute at all');
    return complaints;
  }

  // --- 1. it goes down, all the way down ------------------------------------
  let worstRise = 0;
  let worstRiseAt: readonly [number, number, number] = first;
  for (let i = 1; i < chute.length; i += 1) {
    const before = chute[i - 1];
    const here = chute[i];
    if (!before || !here) continue;
    const rise = here[1] - before[1];
    if (rise > worstRise) {
      worstRise = rise;
      worstRiseAt = here;
    }
  }
  if (worstRise > SLIDE_MAY_RISE) {
    complaints.push(
      `the ginormous slide climbs ${worstRise.toFixed(3)} m at ` +
        `(${worstRiseAt[0].toFixed(1)}, ${worstRiseAt[1].toFixed(1)}, ${worstRiseAt[2].toFixed(1)}) ` +
        '— a slide that goes uphill is one a child stops on',
    );
  }

  // --- 2. it finishes in the ball pit ---------------------------------------
  //
  // Where it ends is the whole of #118, so it is asserted against the built
  // pit's own position rather than against anything the slide's plan believes.
  const pit = facts.plots.find((plot) => plot.id === 'ballPit');
  if (!pit) complaints.push('there is no ball pit for the ginormous slide to land in');
  else {
    const missed = Math.hypot(last[0] - pit.x, last[2] - pit.z);
    // BALL_PIT_RADIUS is 6; the plot's bounding radius is larger than the pit
    // itself, so the pit's own radius is what "lands in the balls" means.
    if (missed > 6) {
      complaints.push(
        `the ginormous slide ends ${missed.toFixed(1)} m from the middle of the ball pit ` +
          `at ${fmt([last[0], last[2]])} — it should end in the balls`,
      );
    }
  }

  // --- 3. it is not inside the castle ---------------------------------------
  //
  // The exact failure of #118. The chute starts *in* the parapet doorway by
  // design, so the first few metres of it are allowed to be within the
  // footprint and nothing after that is.
  const castle = facts.castleFootprint;
  {
    let insideAfterDoor: readonly [number, number, number] | null = null;
    let travelled = 0;
    for (let i = 1; i < chute.length; i += 1) {
      const before = chute[i - 1];
      const here = chute[i];
      if (!before || !here) continue;
      travelled += Math.hypot(here[0] - before[0], here[2] - before[2]);
      if (travelled < DOORWAY_GRACE) continue;
      if (
        Math.abs(here[0] - castle.x) < castle.halfX &&
        Math.abs(here[2] - castle.z) < castle.halfZ
      ) {
        insideAfterDoor = here;
        break;
      }
    }
    if (insideAfterDoor) {
      complaints.push(
        `the ginormous slide runs back inside the castle at ` +
          `${fmt([insideAfterDoor[0], insideAfterDoor[2]])} — this is #118, where a ` +
          'child finished the ride sealed inside the tower',
      );
    }
  }

  // --- 4. it clears every plot it is not deliberately joining ---------------
  //
  // At the width of the thing a child rides in, plus the child's own radius.
  for (const plot of facts.plots) {
    if (plot.id === 'building' || plot.id === 'ballPit') continue;
    for (const point of chute) {
      const gap = Math.hypot(point[0] - plot.x, point[2] - plot.z);
      if (gap < plot.boundingRadius + CHUTE_HALF_WIDTH) {
        complaints.push(
          `the ginormous slide passes ${gap.toFixed(1)} m from the middle of ` +
            `${plot.id} (radius ${plot.boundingRadius.toFixed(1)}) at ` +
            `${fmt([point[0], point[2]])}`,
        );
        break;
      }
    }
  }

  return complaints;
};

/**
 * **The ginormous slide is standing on something, and you can walk between the
 * legs.**
 *
 * Separate from the chute's own invariant because it fails differently. A
 * support planner that places *nothing* looks healthy from every angle except
 * the park's — the ride still works, the tests still pass, and a 95 m trough
 * hangs in the air. That happened here: the "do not pinch a plot corridor"
 * rule counted the castle and the ball pit, whose bounding circles cover this
 * entire ride between them, and it rejected all 37 viable spots in silence.
 *
 * The second clause is the opposite failure. Legs a child cannot walk between
 * turn the ground under the slide into a paddock, which is worse than no legs
 * at all — so the gap between the nearest two is measured at the width a child
 * actually is.
 */
const theGinormousSlideStandsOnSomething: Invariant = (facts) => {
  const complaints: string[] = [];
  const legs = facts.slideLegs;
  const chute = facts.slideChute;

  // --- 1. it is held up at all ----------------------------------------------
  //
  // Scaled to the ride: a leg roughly every 20 m of chute is sparse, and
  // anything sparser than that is not "deliberately generous spacing", it is a
  // planner that has quietly given up.
  let chuteLength = 0;
  for (let i = 1; i < chute.length; i += 1) {
    const before = chute[i - 1];
    const here = chute[i];
    if (!before || !here) continue;
    chuteLength += Math.hypot(here[0] - before[0], here[1] - before[1], here[2] - before[2]);
  }
  const wanted = Math.floor(chuteLength / 20);
  if (legs.length < wanted) {
    complaints.push(
      `the ginormous slide is ${chuteLength.toFixed(0)} m long and stands on ` +
        `${legs.length} legs — at least ${wanted} were expected, and a chute this ` +
        'long with nothing under it reads as floating',
    );
  }

  // --- 2. a child can walk between them -------------------------------------
  for (let i = 0; i < legs.length; i += 1) {
    for (let j = i + 1; j < legs.length; j += 1) {
      const a = legs[i];
      const b = legs[j];
      if (!a || !b) continue;
      const faces = Math.hypot(a.x - b.x, a.z - b.z) - 2 * SLIDE_LEG_RADIUS;
      if (faces < WALKABLE_GAP) {
        complaints.push(
          `two of the ginormous slide's legs leave ${faces.toFixed(2)} m between their ` +
            `faces at ${fmt([a.x, a.z])} and ${fmt([b.x, b.z])} — a child cannot get through`,
        );
      }
    }
  }

  // --- 3. each one actually reaches its chute -------------------------------
  //
  // A leg is only support if it meets the thing it is supporting. Measured
  // against the built chute rather than against what the planner believed.
  for (const leg of legs) {
    if (leg.top <= leg.ground) {
      complaints.push(`a ginormous slide leg at ${fmt([leg.x, leg.z])} has no height at all`);
      continue;
    }
    let nearest = Infinity;
    for (const point of chute) {
      const gap = Math.hypot(point[0] - leg.x, point[2] - leg.z);
      if (gap < nearest) nearest = gap;
    }
    if (nearest > SLIDE_LEG_REACH) {
      complaints.push(
        `a ginormous slide leg at ${fmt([leg.x, leg.z])} is ${nearest.toFixed(1)} m from the ` +
          'chute it is supposed to be holding up',
      );
    }
  }

  return complaints;
};

/**
 * **The ginormous slide leaves the castle over the top of the battlements**,
 * with real air under it — not through the stone.
 *
 * ### This used to claim something that was not true
 *
 * It was called `theGinormousSlideLeavesThroughItsDoor`, and it asserted that
 * the chute passed through a hole cut in the south curtain wall, citing
 * `SLIDE_PLAN.facadeDoorMinX/MaxX` as the value both the plan and the masonry
 * read. **No such hole is ever cut.** `SLIDE_PLAN`'s door numbers reach
 * `ShellPlan.slideGap`, whose only two readers are inside `wallShapes` and
 * `buildWindows` — and `BuildingShell` early-returns into `buildCastle` on the
 * facade branch, which cuts the front entrance and nothing else, while the
 * interior shell that *does* reach those builders sets `slideGap: null`. Both
 * readers are unreachable, so the doorway existed only in the plan and in this
 * test. Pre-existing rot, orphaned by the castle rewrite.
 *
 * The old clauses could not fail. One compared `SLIDE_PLAN`'s door span against
 * `BUILDING_HALF_X` — both generator-side, and already guaranteed by
 * `doorFitsTheWall`, which is rules against rules. The other compared the built
 * chute against that same planned span, which is a number nothing builds from.
 *
 * ### What is true, measured
 *
 * The chute crosses the south wall plane at **y 14.84** on every one of the
 * five seeds, and the tallest stone — the crenellations — tops out at
 * **y 10.29**. What matters is the chute's *underside*, at 14.84 − 1.11 =
 * **13.73 m**, so the air a rider actually has under them is **3.44 m** — not
 * the 4.55 m the centre line clears by, which is the number this was first
 * written up with. (Corrected in review. Two numbers describing one gap is the
 * exact habit this branch has now been bitten by twice; the code below was
 * always right, only the prose was loose.)
 *
 * So the honest guarantee is not "it goes through the hole" but "it goes over
 * the top, and there is air under it", and that is what is asserted here.
 *
 * That is a guarantee worth holding: it is what keeps a child from riding down
 * inside a wall. It fails the moment anyone lowers `START_Y`, raises
 * `CASTLE_WALL_HEIGHT`, or gives the merlons another metre — none of which is
 * far-fetched, and all of which currently pass unnoticed.
 *
 * Measured off the built chute pushed out through the scene graph into world
 * space, against the built masonry's own world bounding boxes — never against
 * `slide/plan.ts` or `CASTLE_WALL_HEIGHT`, which are the things under test.
 */
const theGinormousSlideLeavesOverTheBattlements: Invariant = (facts) => {
  const complaints: string[] = [];
  const castle = facts.castleFootprint;
  const chute = facts.slideChute;

  const first = chute[0];
  const last = chute[chute.length - 1];
  if (chute.length < 2 || !first || !last) {
    complaints.push('the ginormous slide has no chute, so it leaves over nothing');
    return complaints;
  }

  // --- 1. the chute starts over the castle, not in mid-air beyond it --------
  //
  // In plan view. The mouth is carried back over the footprint on purpose, so
  // the ride begins on the tower rather than floating off the south face. The
  // castle's south face is +Z.
  const wallZ = castle.z + castle.halfZ;
  if (first[2] > wallZ) {
    complaints.push(
      `the ginormous slide's mouth starts ${(first[2] - wallZ).toFixed(2)} m beyond the ` +
        `castle's south wall (chute z ${first[2].toFixed(2)}, wall z ${wallZ.toFixed(2)}) ` +
        '— it should start back over the castle, so the ride begins on the tower',
    );
  }

  // --- 2. it does cross the south side, so there is something to measure ----
  //
  // Interpolates across the span that straddles the wall plane rather than
  // taking the nearest sample: at 0.4 m spacing the nearest sample can sit a
  // third of a metre to either side, which is most of the clearance measured.
  let crossing: { x: number; y: number } | null = null;
  for (let i = 1; i < chute.length; i += 1) {
    const before = chute[i - 1];
    const here = chute[i];
    if (!before || !here) continue;
    if (before[2] > wallZ || here[2] < wallZ) continue;
    const span = here[2] - before[2];
    // Guard the degenerate case: a chute running exactly along the wall plane
    // would divide by zero and hand the message a NaN, and NaN compares false
    // against every threshold — which would make this clause incapable of
    // failing while still looking like a test.
    const t = Math.abs(span) < 1e-9 ? 0 : (wallZ - before[2]) / span;
    crossing = {
      x: before[0] + (here[0] - before[0]) * t,
      y: before[1] + (here[1] - before[1]) * t,
    };
    break;
  }

  if (crossing === null) {
    complaints.push(
      `the ginormous slide never crosses its own south wall (wall z ${wallZ.toFixed(2)}, ` +
        `chute runs z ${first[2].toFixed(2)}…${last[2].toFixed(2)}) — it does not leave ` +
        'the castle on the side it is built to leave on',
    );
    return complaints;
  }

  // --- 3. and where it crosses, the stone is below it -----------------------
  //
  // The clause that carries the weight. The underside of the chute — its centre
  // line less the half-envelope a rider sits in — must be above the highest
  // masonry, or the ride passes through the battlements.
  const underside = crossing.y - CHUTE_HALF_WIDTH;
  const stone = facts.castleMasonryTopY;

  // **A missing measurement is a failure here, not a pass.** `castleMasonryTopY`
  // is a max seeded with `-Infinity` over meshes picked out by name, so if the
  // castle is ever renamed out from under it the fact arrives as `-Infinity` and
  // `underside < -Infinity` is false for *every conceivable chute* — this
  // invariant would go quietly green while measuring nothing at all. Caught in
  // review by breaking the name pattern: the canonical suite stayed 28/28 green.
  //
  // Note the polarity is the opposite of
  // {@link theGinormousSlideMissesTheCastleTowers}'s `Number.isFinite(worstGap)`
  // guard, and the reason is worth having, because the two look contradictory
  // side by side. That invariant can read `Infinity` as a *genuine pass* — the
  // chute simply never came near a tower — **only because it has already ruled
  // out the disarmed case separately**, with its own `towers.length === 0`
  // complaint. Two possible meanings, two checks.
  //
  // Here there is only one number to guard, so one check does both jobs: an
  // unmatched name and a missing castle are the same failure and read the same
  // way. Neither guard should be "made consistent" with the other by removing
  // it — they are opposite for that reason, not by accident.
  if (!Number.isFinite(stone)) {
    complaints.push(
      'no castle stonework was found in the built park at all, so the check that ' +
        'keeps the ginormous slide out of the battlements measured nothing. Either ' +
        'the castle is missing, or the mesh names `parkFacts.castleMasonryTopY` ' +
        'looks for have changed and this invariant has been silently switched off',
    );
    return complaints;
  }

  if (underside < stone) {
    complaints.push(
      `the ginormous slide crosses the castle's south wall at world ` +
        `(${crossing.x.toFixed(2)}, ${crossing.y.toFixed(2)}) — its underside is at ` +
        `${underside.toFixed(2)} m and the stonework tops out at ${stone.toFixed(2)} m, so ` +
        `the chute is ${(stone - underside).toFixed(2)} m inside the battlements. Nothing ` +
        'cuts a hole for it: `slideGap` reaches no geometry, so there is solid stone here',
    );
  }

  return complaints;
};

/**
 * **The ginormous slide does not go through the castle's corner towers.**
 *
 * Jim rode it and found it clipping through them; this is that, stated as
 * something the park proves on every seed. It fails the build, which is what he
 * asked for.
 *
 * ### Why nothing caught it
 *
 * `slide/plan.ts` cannot use the standard `clearOfPlots` predicate — the
 * castle's plot circle and the ball pit's overlap, so no point between the two
 * satisfies it, and a ride whose whole job is joining them would never solve.
 * It therefore exempts exactly those two plots and re-imposes the castle
 * "precisely, as its actual footprint rectangle".
 *
 * A footprint rectangle does not contain the towers. They stand at
 * `(±outerX, ±outerZ)` — *outside* the rectangle by half a wall thickness — and
 * bulge 2.05–2.45 m further out again. So the exemption was narrow and
 * deliberate exactly as intended, and the thing re-imposed in its place was
 * still missing the one solid the chute passes closest to. Measured on the
 * canonical seed the chute ran **2.02 m inside a tower body**, 87 consecutive
 * samples buried, while every existing invariant stayed green.
 *
 * ### What it measures
 *
 * The built chute against the built towers — both read out of the scene graph,
 * neither taken from the plan. The threshold is the **rider's own envelope**
 * (`CHUTE_ENVELOPE`, derived from the trough's cross-section) rather than
 * `CORRIDOR_RADIUS`, which is the wider margin the generator steers by: a
 * collision test owes the truth about where the trough physically is, not about
 * where the search preferred to keep it.
 *
 * A tower is a solid of revolution, so testing the centre line against
 * `towerRadius + halfWidth` is exact — it is a swept disc in closed form, and
 * strictly better here than firing a ring of probe rays and hoping the gaps
 * between them are small enough to catch a thin obstacle.
 */
const theGinormousSlideMissesTheCastleTowers: Invariant = (facts) => {
  const complaints: string[] = [];
  const chute = facts.slideChute;
  const towers = facts.castleTowers;
  const envelope = facts.chuteEnvelope;

  if (towers.length === 0) {
    complaints.push(
      'no castle towers were found in the built park, so this invariant is ' +
        'measuring nothing — the tower meshes have been renamed or removed',
    );
    return complaints;
  }
  if (chute.length < 2) {
    complaints.push('the ginormous slide has no chute to check against the towers');
    return complaints;
  }

  let worstGap = Infinity;
  let worstTower = '';
  let worstAt: readonly [number, number, number] = chute[0] ?? [0, 0, 0];
  let buried = 0;

  for (const point of chute) {
    const [px, py, pz] = point;
    for (const tower of towers) {
      // The chute occupies a band around its centre line, so it fouls the
      // tower's height range if either edge of that band is inside it.
      if (py + envelope.above < tower.bottomY) continue;
      if (py - envelope.below > tower.topY) continue;

      // Radius where the two actually meet in height, so a cone is measured at
      // the height the chute passes it rather than at its widest.
      const clamped = Math.min(Math.max(py, tower.bottomY), tower.topY);
      const span = tower.topY - tower.bottomY;
      const t = span <= 1e-9 ? 0 : (clamped - tower.bottomY) / span;
      const radius = tower.radiusBottom + (tower.radiusTop - tower.radiusBottom) * t;

      const gap = Math.hypot(px - tower.x, pz - tower.z) - radius - envelope.halfWidth;
      if (gap < worstGap) {
        worstGap = gap;
        worstTower = tower.name;
        worstAt = point;
      }
      if (gap < 0) buried += 1;
    }
  }

  // `worstGap` stays Infinity only if the chute never shares a height with any
  // tower, which is a clean pass rather than a missing measurement — but it must
  // never reach a message, because Infinity and NaN compare false against every
  // threshold and would make this look green while testing nothing.
  if (Number.isFinite(worstGap) && worstGap < 0) {
    complaints.push(
      `the ginormous slide passes ${(-worstGap).toFixed(2)} m inside ${worstTower} at ` +
        `(${worstAt[0].toFixed(2)}, ${worstAt[1].toFixed(2)}, ${worstAt[2].toFixed(2)}) ` +
        `— ${buried} of ${chute.length} sampled points are inside a tower, and a child ` +
        'rides through solid masonry',
    );
  }

  return complaints;
};

/**
 * **Every trackside camera on the ginormous slide can see the bit of ride it
 * was stood beside, on every seed.**
 *
 * The slide cuts between a chase camera and three trackside ones
 * (`slide/cameras.ts`, and Jim's ruling quoted there). Those three are placed
 * from the **solved route**, so on a procgen ride they land somewhere different
 * every time — and a camera that ends up looking at the back of a tower, buried
 * in a hill, or too shallow to see over the chute's own hand-rail is a stretch
 * of the ride where a child cannot see herself.
 *
 * `check:slide-rider` already rides the canonical seed with a real `Player` and
 * measures her in pixels. This is the other four seeds, and it asks a different
 * question: not *is the rider legible* but *is the camera anywhere sensible*.
 * That split is deliberate — the pixel check is far too slow to run five times,
 * and a placement fault shows up in geometry long before it needs a rider.
 *
 * Four clauses, and the first is the one the brief called for:
 *
 * 1. **Every part of the ride is covered by some camera.** Measured as
 *    arithmetic on the built plan: the spans must start at 0, end at 1, and
 *    meet exactly — no gap where the game has no shot, and no overlap where two
 *    disagree about which is live.
 * 2. **Nothing stands between a camera and the chute it covers**, sampled
 *    across that camera's whole beat against the built chute and the built
 *    castle. This is the clause the measured 50° elevation threshold exists for.
 * 3. **No camera is underground.** A lens below the hills renders dirt.
 * 4. **There is more than one shot.** A plan that collapsed to a single chase
 *    beat would satisfy 1–3 vacuously while quietly undoing the whole feature.
 */
const theSlideTracksideCamerasCanSeeTheRide: Invariant = (facts) => {
  const complaints: string[] = [];
  const spans = facts.slideShotSpans;
  const cameras = facts.slideCameras;

  // Anti-vacuity first, in the tradition of `castleMasonryTopY`'s guard: an
  // empty plan must be a complaint, not a silent pass over nothing.
  if (spans.length < 2) {
    complaints.push(
      `the ginormous slide's shot plan has ${spans.length} beat(s) — it is meant to cut ` +
        'between a chase camera and trackside ones, and with fewer than two it cuts nowhere',
    );
    return complaints;
  }
  if (cameras.length === 0) {
    complaints.push(
      'the ginormous slide has no trackside cameras at all, so the chase camera — which ' +
        'shows a rider lying feet-first as a floating head, by construction — is the only ' +
        'view of the whole ride',
    );
    return complaints;
  }

  // 1. The beats tile the ride.
  const first = spans[0];
  const last = spans[spans.length - 1];
  if (first && Math.abs(first.from) > 1e-9) {
    complaints.push(
      `the ginormous slide's first shot starts at ${first.from.toFixed(4)} of the way down ` +
        'rather than at the top — the opening of the ride has no camera',
    );
  }
  if (last && Math.abs(last.to - 1) > 1e-9) {
    complaints.push(
      `the ginormous slide's last shot ends at ${last.to.toFixed(4)} rather than at the ` +
        'bottom — the end of the ride has no camera',
    );
  }
  for (let i = 1; i < spans.length; i += 1) {
    const previous = spans[i - 1];
    const current = spans[i];
    if (!previous || !current) continue;
    const step = current.from - previous.to;
    if (Math.abs(step) > 1e-9) {
      complaints.push(
        `beat ${i - 1} of the ginormous slide ends at ${previous.to.toFixed(4)} and beat ${i} ` +
          `starts at ${current.from.toFixed(4)} — ${step > 0 ? 'a gap where no camera has ' +
          'her' : 'an overlap where two shots each think they are live'}`,
      );
    }
  }

  // 2 and 3. Each camera can see its own beat, and is above the ground.
  for (const camera of cameras) {
    if (camera.samples === 0) {
      complaints.push(
        `the trackside camera on beat ${camera.beat} was never sampled, so its sight line ` +
          'proves nothing',
      );
      continue;
    }
    if (camera.blocked > 0) {
      complaints.push(
        `the trackside camera on beat ${camera.beat}, at (${camera.eye[0].toFixed(1)}, ` +
          `${camera.eye[1].toFixed(1)}, ${camera.eye[2].toFixed(1)}), cannot see the chute ` +
          `for ${camera.blocked} of ${camera.samples} samples across its own beat — the ` +
          'chute or the castle is in the way. If it is the near hand-rail, the elevation ' +
          'in `slide/cameras.ts` is too shallow: the sweep recorded there puts the ' +
          'threshold at 50°',
      );
    }
    // Clear of the grass by at least the chute's own half-width. Taken from the
    // game's built profile rather than invented here, in the spirit of the rule
    // about thresholds: it is a length this ride already has an opinion about,
    // and it is comfortably more than a lens needs to be out of the dirt. The
    // three cameras measure 20.0, 13.8 and 6.7 m on the canonical seed, so this
    // fires on a camera that has genuinely gone into a hill rather than on one
    // that is merely low.
    const air = camera.eye[1] - camera.groundY;
    const needed = facts.chuteEnvelope.halfWidth;
    if (air < needed) {
      complaints.push(
        `the trackside camera on beat ${camera.beat} sits ${air.toFixed(2)} m over the ` +
          `ground against ${needed.toFixed(2)} m needed — it is in the hillside, and ` +
          'renders dirt',
      );
    }
  }

  return complaints;
};

/**
 * **The Sky Cruiser fits through the castle it flies into.** (Issue #113.)
 *
 * The other cruiser invariants ask whether the loop *misses* things. This one
 * exists because the loop now deliberately does not: it crosses two curtain
 * walls, and the only thing standing between a child and a wall of stone is
 * that the hole was cut in the right place, at the right height, wide enough,
 * and clear of the towers at either end of the panel.
 *
 * It is measured twice over, on purpose, and the two are not redundant:
 *
 * - the geometric check says *why* — within one panel, this much masonry left
 *   beside the tower, this wide against a car this wide, both openings sharing
 *   a height because the run through the castle is level;
 * - the swept check says *whether* — four rays along the car's own envelope,
 *   fired at **every mesh under the castle's garden root**, naming what they
 *   hit. It knows nothing about walls or towers, so a fixture added to the
 *   castle later is covered from the day it appears.
 *
 * Both are the same functions the boot assert and `check:castle-window` run,
 * so there is one definition of "does the ride fit" and it cannot drift.
 *
 * **This one still passes vacuously on a seed with no crossing** — it asks
 * whether the windows that exist are right, not whether any exist. That the
 * crossing *happens at all* is now a separate and much stronger claim, made by
 * {@link skyCruiserAlwaysFliesThroughTheCastle} below. The two were one
 * invariant for a while and the split matters: "the hole is in the right place"
 * and "there is a hole" fail for completely different reasons, and reading one
 * green as evidence of the other is exactly how a seed shipped an unbroken
 * castle.
 *
 * Proven to have teeth rather than assumed to: shrinking the opening below the
 * car's width, cutting it 3 m from where the route crosses, shoving it into a
 * corner tower and raising it through the battlements each turn this red — and
 * building the wall solid while still declaring the openings is what exposed
 * that the swept check was measuring nothing at all, because a headless park
 * never renders and every `matrixWorld` was still the identity.
 */
const skyCruiserFitsThroughTheCastle: Invariant = (facts) => facts.castlePass.complaints;

/**
 * **A child boarding the ginormous slide is put down on the chute**, not a
 * castle's width from it.
 *
 * The seat, the grown-up and the teleport all position themselves from
 * `SlideRide.pointAt`, and all three are parented alongside the chute so those
 * are the same coordinates. `Building.ts` says so in a comment; this is the
 * part that checks it is still true.
 *
 * It exists because the chute had to move out of the castle's plot group and up
 * to park level — a ride spanning two plots is the park's content, and
 * `check:park` measures everything under an anchor against the radius that
 * anchor promises. Moving the chute alone would have left three riders behind
 * in the castle's frame, each of them floating about 26 m from the trough,
 * while the slide itself still looked perfect from every angle. So they moved
 * together, and this is the assertion that they still travel together.
 *
 * Comparing `pointAt` straight against `pointAt` pushed through the scene graph
 * is the whole test: at park level the group is the identity and the two are
 * the same number. It needs no knowledge of *which* group is correct, so it
 * keeps working if the park is restructured again for some other reason.
 */
const theSlideRiderSitsOnTheChute: Invariant = (facts) => {
  const complaints: string[] = [];
  const { local, world } = facts.slideRiderFrame;

  if (local.length === 0 || local.length !== world.length) {
    complaints.push(
      `the ginormous slide's rider frame was sampled ${local.length} times locally ` +
        `and ${world.length} times in world space — nothing can be concluded`,
    );
    return complaints;
  }

  let worst = 0;
  let worstAt = 0;
  for (let i = 0; i < local.length; i += 1) {
    const a = local[i]!;
    const b = world[i]!;
    const drift = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (drift > worst) {
      worst = drift;
      worstAt = i;
    }
  }

  // Millimetres, not zero: these are floating-point transforms of the same
  // number, and the failure this guards against is metres wide.
  if (worst > 0.001) {
    const a = local[worstAt]!;
    const b = world[worstAt]!;
    complaints.push(
      `the ginormous slide's riders would sit ${worst.toFixed(2)} m off the chute — ` +
        `${(worstAt / (local.length - 1) * 100).toFixed(0)}% along, \`pointAt\` gives ` +
        `(${a[0].toFixed(2)}, ${a[1].toFixed(2)}, ${a[2].toFixed(2)}) but the chute is ` +
        `drawn at (${b[0].toFixed(2)}, ${b[1].toFixed(2)}, ${b[2].toFixed(2)}) — the seat, ` +
        'the grown-up and the boarding teleport all read the first of those',
    );
  }

  return complaints;
};

/**
 * **About half the ginormous slide's chute is see-through** (#228).
 *
 * Jim: *"the slide should have a mix of transparent and opaque sections to see
 * the part through it"*, roughly 50/50.
 *
 * #228 asks whoever builds this to say plainly whether it needs an invariant,
 * rather than leaving it unstated. It does, and this is why: the split is a
 * function of the chute's **length**, and the chute's length is procedural. A
 * ride that came out shorter than one band period on some future seed would
 * build an empty see-through mesh and be uniformly opaque again — a feature
 * silently absent on one seed, which is precisely the class of failure this
 * suite exists to catch and the one a reviewer reading the diff cannot.
 *
 * What is **not** asserted here, because it is structural rather than
 * measurable: that the two meshes tile the sweep exactly. `buildChute` is
 * called with a predicate and its negation, so every quad lands in exactly one
 * of the two by construction — there is no arithmetic that could leave a hole
 * in the slide for a test to find. (Checked once by hand on a 61 m probe:
 * 2520 + 2340 = 4860 vertices, exactly a full sweep.)
 *
 * The band is deliberately wide. This is an art decision Jim will tune by
 * looking at it, and an invariant that pinned it to 0.5 would fail the moment
 * he said "a bit more glass" — it is here to catch *absent*, not to police
 * taste.
 */
const theChuteIsHalfSeeThrough: Invariant = (facts) => {
  const { solid, clear } = facts.slideChuteBands;
  const total = solid + clear;

  if (total === 0) {
    return ['the ginormous slide built no chute at all — neither mesh has any geometry'];
  }
  if (clear === 0) {
    return [
      'the ginormous slide is entirely opaque: its see-through mesh has no geometry, ' +
        `against ${solid} vertices of solid chute — issue #228 asked for about half of it ` +
        'to be see-through, and on this seed none of it is',
    ];
  }
  if (solid === 0) {
    return [
      'the ginormous slide is entirely see-through: its solid mesh has no geometry, ' +
        `against ${clear} vertices of clear chute — it is meant to be a mix`,
    ];
  }

  const share = clear / total;
  if (share < 0.35 || share > 0.65) {
    return [
      `the ginormous slide is ${(share * 100).toFixed(0)}% see-through ` +
        `(${clear} clear vertices against ${solid} solid) — issue #228 asked for about ` +
        'half and half, and this is far enough off that the pattern has stopped reading ' +
        'as alternating',
    ];
  }

  return [];
};

/**
 * How tall a child is, standing, in metres.
 *
 * ART_DIRECTION.md §4: the player kid is 2.12 m after the cartoon pass. Stated
 * here rather than imported for the reason {@link CHUTE_HALF_WIDTH} is — and
 * `scripts/check-statue-occlusion.mts` states the same number for the same
 * reason, which is the other place in this repo that asks "can she be seen
 * through something".
 *
 * Unlike {@link CHUTE_HALF_WIDTH}, `PLAYER_RADIUS` **is** added on top wherever
 * this is used: a rider on the chute is contained by the trough, but a child
 * standing in the ball pit is a free body next to a structure, and her shoulder
 * is as able to be inside the chute as her nose.
 */
const RIDER_HEIGHT = 2.12;

/**
 * **A child finishes the ginormous slide in the balls, and not inside the
 * chute she has just come out of.**
 *
 * Jim, having ridden it on 5 August 2026: *"at the bottom of the slide, at the
 * end of the ride, the player appears clipped into the slide, not in the ball
 * pit like they should"*. Both halves were true and both had one cause — the
 * dismount was computed by `planExit()`, which fans bearings out from the pit
 * and has never been told where the chute is (see `slide/landing.ts`).
 *
 * This is the guard that stops it coming back, and it is deliberately written
 * as the **two** things Jim said rather than one: in the pit, *and* clear of
 * the chute. Either alone passes for the wrong reason. A landing far out on
 * the grass is clear of the chute; a landing dead under the mouth is inside the
 * pit.
 *
 * ### Why this measures a column and not a point
 *
 * `finishRide` hands her back `LANDING_DROP` above the balls and lets gravity
 * close the gap, so there is no single height at which she exists. The
 * clearance is taken over the whole column she occupies between being handed
 * back and coming to rest — feet on the balls at the bottom, head at the top of
 * the drop — which is conservative in the only direction that matters.
 *
 * Thresholds come from the built trough (`CHUTE_ENVELOPE`, via
 * `riderClearanceFromChute`) and never from `slide/plan.ts`'s `CORRIDOR_RADIUS`,
 * which is the wider margin the *generator* steers by: measuring against the
 * generator's own target would report a clip half a metre before there is one,
 * and the temptation would then be to loosen the wrong number.
 */
const theSlideRiderLandsInTheBalls: Invariant = (facts) => {
  const complaints: string[] = [];
  const landing = facts.slideLanding;
  const chute = facts.slideChute;

  // Anti-vacuity, in the tradition of `castleMasonryTopY`'s guard: every clause
  // below is a comparison, and a comparison against a missing measurement is a
  // pass that measured nothing.
  if (chute.length === 0) {
    return ['the ginormous slide has no chute, so where it lands cannot be measured'];
  }
  if (
    !Number.isFinite(landing.x) ||
    !Number.isFinite(landing.z) ||
    !Number.isFinite(landing.groundY) ||
    !Number.isFinite(landing.pitRadius)
  ) {
    return [
      'the ginormous slide’s landing could not be measured — ' +
        `spot (${landing.x}, ${landing.z}), ground ${landing.groundY}, ` +
        `pit radius ${landing.pitRadius}`,
    ];
  }

  // 1. She is in the balls — all of her, not just her centre line.
  const fromPitCentre = Math.hypot(landing.x - landing.pitX, landing.z - landing.pitZ);
  if (fromPitCentre + PLAYER_RADIUS > landing.pitRadius) {
    complaints.push(
      `the ginormous slide puts a child down ${fromPitCentre.toFixed(2)} m from the ball ` +
        `pit’s centre, and she is ${PLAYER_RADIUS} m wide, so she overhangs a pit of ` +
        `radius ${landing.pitRadius} m by ` +
        `${(fromPitCentre + PLAYER_RADIUS - landing.pitRadius).toFixed(2)} m — ` +
        'the ride is supposed to land her in the balls',
    );
  }

  // 2. And she is not inside the thing she just came out of. Measured against
  //    every sample of the built chute, not only its last one: the route wraps
  //    the castle and an earlier stretch passing over the pit would clip her
  //    just as thoroughly as the mouth does.
  let worstGap = Infinity;
  let worstAt = -1;
  for (let i = 0; i < chute.length; i += 1) {
    const [cx, cy, cz] = chute[i]!;
    const gap = riderClearanceFromChute(
      landing.x,
      landing.groundY,
      landing.z,
      // The whole column: the drop she is handed back at, plus her own height.
      LANDING_DROP + RIDER_HEIGHT,
      cx,
      cy,
      cz,
    );
    if (gap < worstGap) {
      worstGap = gap;
      worstAt = i;
    }
  }

  if (!Number.isFinite(worstGap)) {
    // Cannot happen with a non-empty chute, and says so rather than passing if
    // it somehow does. Opposite polarity to `theSlideDoesNotClipTheTowers`'s
    // `Infinity`, where "never came near one" is a genuine pass; here every
    // sample is compared, so an infinity means no comparison happened.
    return ['the ginormous slide’s landing was never compared against the chute'];
  }

  if (worstGap < 0) {
    const [cx, cy, cz] = chute[worstAt]!;
    complaints.push(
      `the ginormous slide leaves a child ${(-worstGap).toFixed(2)} m inside its own chute ` +
        `where it stops: she is put down at (${landing.x.toFixed(2)}, ${landing.z.toFixed(2)}) ` +
        `standing on ${landing.groundY.toFixed(2)} m, and the chute runs through ` +
        `(${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)}) — ` +
        `${((worstAt / (chute.length - 1)) * 100).toFixed(0)}% along the ride`,
    );
  }

  return complaints;
};

/**
 * Air that must separate the ginormous slide from the Sky Cruiser, in metres.
 *
 * Decision 4's rail-over-rail figure. Stated here rather than imported from
 * `slide/plan.ts` for the reason {@link CHUTE_HALF_WIDTH} is: importing the
 * number the generator aimed at would prove only that it can reach its own
 * target, and this file's job is to measure the park that was built.
 */
const CRUISER_AIR_REQUIRED = 5.5;

/**
 * Half-width of the Sky Cruiser's cart, as built: `CART_BODY_WIDTH` is 1.5 m.
 *
 * Stated rather than imported for the same reason as {@link CHUTE_HALF_WIDTH} —
 * and unlike the chute's, this one is a *body* whose width is what sweeps past,
 * so it is the right thing to add to the chute's half-width to ask whether two
 * solids overlap rather than two centre lines.
 */
const CART_HALF_WIDTH = 0.75;

/**
 * **The ginormous slide keeps its air from the Sky Cruiser.**
 *
 * The chute crosses the cruiser's loop shortly after leaving the parapet and
 * passes over the top of it — about 4 m of clearance is the whole reason the
 * route is solvable at all, because at ground level there is roughly 2 m between
 * the castle's east wall and the cruiser and the chute is 3.4 m wide.
 *
 * **This existed only as a throw at module load until 5 August 2026, which is
 * why it is here now.** The slide's height at a point is a function of how far
 * along it that point is *as a fraction of the whole*, and the whole is not
 * known until the route is solved — so the search runs on an assumed length and
 * `planSlide` iterates. That loop used to fall out of its pass limit and use the
 * last route regardless, whose clearance had been checked against a different
 * length's height profile. On seed 11, once #213 moved the cruiser, it built a
 * 64.4 m ride from a search that had verified an 86 m one, and put the chute
 * 1.15 m inside the cruiser's air at a spot the search had checked and passed.
 *
 * The failure mode is what matters here: it surfaced as the **whole park
 * failing to construct**, because a module-load throw takes everything with it,
 * and every other invariant for that seed reported "skipped" rather than
 * "failed". A geometric fact about two rides belongs where a geometric fact
 * about two rides is checked, on every seed, saying which two things are how
 * close.
 *
 * Measured on the built chute against the built coaster curve — neither is the
 * plan either of them was solved from.
 */
const theSlideKeepsItsAirFromTheCruiser: Invariant = (facts) => {
  const chute = facts.slideChute;
  if (chute.length === 0) return ['the ginormous slide has no chute to measure against the cruiser'];

  const cruiser = facts.world.coaster.route;
  let worst = Infinity;
  let worstAt: readonly [number, number, number] | null = null;
  let worstNear: { x: number; y: number; z: number } | null = null;

  for (const point of chute) {
    const near = cruiser.nearestPoint(point[0], point[2]);
    // Only somewhere the two actually overlap in plan view can foul at all.
    // Half the chute plus half the cart's envelope, so it is the solids being
    // compared rather than two centre lines.
    if (Math.hypot(near.x - point[0], near.z - point[2]) > CHUTE_HALF_WIDTH + CART_HALF_WIDTH) {
      continue;
    }
    const vertical = Math.abs(near.y - point[1]);
    if (vertical < worst) {
      worst = vertical;
      worstAt = point;
      worstNear = { x: near.x, y: near.y, z: near.z };
    }
  }

  if (!worstAt || !worstNear || worst >= CRUISER_AIR_REQUIRED) return [];
  return [
    `the ginormous slide passes ${worst.toFixed(2)} m from the Sky Cruiser, against ` +
      `${CRUISER_AIR_REQUIRED} m required — chute at ${fmt([worstAt[0], worstAt[2]])} ` +
      `y ${worstAt[1].toFixed(2)}, cruiser at ${fmt([worstNear.x, worstNear.z])} ` +
      `y ${worstNear.y.toFixed(2)}`,
  ];
};

/**
 * **Every park's Sky Cruiser flies through the castle, not round it.**
 *
 * The family asked for the ride to go *through* the building, and for a while
 * it only usually did. The generator returns the **first** route that fits, not
 * the best one, and nothing was asking it for a crossing — so on one CI seed in
 * five the loop simply closed before it got there, and that child got an
 * ordinary circuit and an unbroken castle. Nothing was broken; nothing had been
 * requested.
 *
 * It is requested now, in two parts, and this invariant is what holds them to
 * it. `coaster/route.ts` declares a {@link RouteInfluence} at the castle, which
 * biases the choice *at the decision point* and does the actual work; and a
 * `satisfies` backstop discards a solved route with no crossing. Measured
 * across these five seeds, the backstop fires **twice** — the weighting is
 * carrying the feature and the backstop is insurance, which is the balance
 * wanted. If this ever goes red the honest first question is which of the two
 * stopped working.
 *
 * **Deliberately measured on the built curve, not on the solver's report.**
 * `route.castleSpan` is re-derived from the finished `CatmullRomCurve3`, which
 * is a rebuild of the plan and not a copy of it — the plan runs about 1.5%
 * short, and treating one as the other already silently cost a window once.
 * Asking the report whether it was satisfied would be asking the generator to
 * mark its own homework.
 *
 * **It does not assert that space was reserved, because none is** (Decision 6).
 * The opening is still cut wherever the route actually crosses; this asserts
 * the crossing happened, never that anything was held open for it.
 */
const skyCruiserAlwaysFliesThroughTheCastle: Invariant = (facts) => {
  const route = facts.world.coaster.route;
  if (route.castleSpan) return [];
  return [
    'the Sky Cruiser never enters the castle on this seed — the loop closed ' +
      'without crossing it, so no windows were cut and the castle is whole. ' +
      'The family asked that the ride always flies through it: check the ' +
      "castle influence's weight and the `satisfies` backstop in coaster/route.ts",
  ];
};

/**
 * The tallest child the park can build, measured once per fork.
 *
 * Every hair style crossed with every hat, on **real models**, attached the way
 * `WornHat` and `NpcSystem.buildIndividualAvatar` attach them — `hatAnchor.add`
 * at the hat's own natural scale, which is also exactly what the shop
 * catalogue's `model()` hands over. Styles that hide a hat (`hairHidesHat` —
 * mohican's crest) are measured bare, because that is what they render as.
 *
 * Lazy rather than at module load, because `createKid` wants the headless
 * canvas shim and that arrives with `buildParkFacts`. ~0.5 s per fork.
 */
let tallestChildMeasured: { height: number; what: string } | null = null;

function measureTallestChild(): { height: number; what: string } {
  if (tallestChildMeasured) return tallestChildMeasured;
  let height = 0;
  let what = '';
  for (const style of HAIR_STYLES) {
    const bare = createKid({ hairStyle: style });
    const bareTop = visibleTop(bare.root);
    if (bareTop > height) {
      height = bareTop;
      what = `${style}, bare-headed`;
    }
    if (bare.hairHidesHat) continue;
    for (const kind of HAT_KINDS) {
      const kid = createKid({ hairStyle: style });
      kid.hatAnchor.add(createHat(kind).root);
      kid.setHatWorn(true);
      const top = visibleTop(kid.root);
      if (top > height) {
        height = top;
        what = `${style} hair + ${kind} hat`;
      }
    }
  }
  tallestChildMeasured = { height, what };
  return tallestChildMeasured;
}

/**
 * **Nothing built over the railway may touch the train — or anyone riding it.**
 *
 * This exists because the constant that was *supposed* to mean that did not.
 * `trainModel.ts` exported `LOCO_TOP_Y`, documented as "the tallest point of the
 * whole train" and "the number anything built over the railway has to clear",
 * and it was the funnel tip — **the locomotive's bodywork, on a train that
 * carries passengers who are taller than the funnel.** A bridge deck derived
 * from it put its soffit at exactly 2.42 m: zero margin for Puffing Percy, and
 * between a quarter and three quarters of a metre *inside* the children behind
 * her. The whole point of PR #220 was to stop clearance being a claim, so the
 * claim now gets measured.
 *
 * Three measurements, all off things that were actually built:
 *
 * 1. **The locomotive's real bodywork**, `visibleTop` on the built car groups
 *    found by name in `world.train.group` — not recomputed from the constants
 *    that positioned them. `LOCO_BODY_TOP_Y` has to cover what is really there.
 *    (The station canopies live in that same group and are deliberately skipped:
 *    they stand beside the line, they do not travel it.)
 * 2. **The tallest child the park can build**, hair × hats, real models — see
 *    {@link measureTallestChild}. `TALLEST_CHILD_HEIGHT` has to cover it, so
 *    adding a taller hat turns this red instead of quietly lowering a bridge.
 * 3. **Where riders actually are.** `ParkTrain.carryPassengers` stands NPCs on
 *    the carriage floor (`CAR_FLOOR_Y`) and `Player.setRidePose` applies no
 *    seated fold, so the player's feet are on the bench (`SEAT_Y`) and she rides
 *    at full height. The clearance has to cover the worst of the three.
 *
 * Then `TRAIN_CLEARANCE_Y` — the published number, from `train/clearance.ts` —
 * is checked against that measured worst case. This is `railRaceFliesClear`'s
 * pattern exactly: measure the built thing, compare it against the number the
 * game publishes, and never against the arithmetic that produced it.
 *
 * **Seed-independent by construction**, and kept here rather than in
 * `check:park` on purpose: it costs nothing extra to run on five seeds, and it
 * is the file CLAUDE.md sends anyone changing procgen to. When #116 lands a real
 * deck, the deck's own surfaces get measured against `TRAIN_CLEARANCE_Y` here
 * too — the constant this guards is the one they will be built from.
 */
const railwayClearanceCoversTheTrainAndItsRiders: Invariant = (facts) => {
  const complaints: string[] = [];

  // --- 1. the built locomotive and carriages -------------------------------
  let builtBodyTop = 0;
  let builtBodyWhat = '';
  for (const child of facts.world.train.group.children) {
    const name = child.name;
    if (name !== 'train-locomotive' && !name.startsWith('train-carriage')) continue;
    const top = visibleTop(child);
    if (top > builtBodyTop) {
      builtBodyTop = top;
      builtBodyWhat = name;
    }
  }
  if (builtBodyWhat === '') {
    complaints.push(
      'no locomotive or carriage in the built train group to measure — the car ' +
        'names in trainModel.ts have changed and this invariant is measuring nothing',
    );
    return complaints;
  }
  if (builtBodyTop > LOCO_BODY_TOP_Y) {
    complaints.push(
      `LOCO_BODY_TOP_Y is ${LOCO_BODY_TOP_Y.toFixed(2)} m but the built ` +
        `${builtBodyWhat} reaches ${builtBodyTop.toFixed(2)} m — the constant no ` +
        'longer covers the bodywork it is meant to describe',
    );
  }

  // --- 2. the tallest child the park can build -----------------------------
  const child = measureTallestChild();
  if (child.height > TALLEST_CHILD_HEIGHT) {
    complaints.push(
      `TALLEST_CHILD_HEIGHT is ${TALLEST_CHILD_HEIGHT.toFixed(2)} m but a real ` +
        `${child.what} measures ${child.height.toFixed(3)} m — raise the constant ` +
        'in kid.ts, because train/clearance.ts sizes a bridge from it',
    );
  }

  // --- 3. does the published clearance cover all of that? -------------------
  //
  // Measured child, not the constant, so a stale constant cannot hide a real
  // rider: this stays honest even if the complaint above is the one that fires.
  const riderTop = Math.max(CAR_FLOOR_Y, SEAT_Y) + child.height;
  const sweptTop = Math.max(builtBodyTop, riderTop);
  if (TRAIN_CLEARANCE_Y < sweptTop) {
    const intrusion = sweptTop - TRAIN_CLEARANCE_Y;
    complaints.push(
      `TRAIN_CLEARANCE_Y is ${TRAIN_CLEARANCE_Y.toFixed(2)} m but the train sweeps ` +
        `to ${sweptTop.toFixed(2)} m — anything built to that clearance sits ` +
        `${intrusion.toFixed(2)} m inside it. Worst: ` +
        `built ${builtBodyWhat} ${builtBodyTop.toFixed(2)}, standing NPC rider ` +
        `${(CAR_FLOOR_Y + child.height).toFixed(2)}, player on the bench ` +
        `${(SEAT_Y + child.height).toFixed(2)} (${child.what})`,
    );
  } else if (TRAIN_CLEARANCE_Y - sweptTop < RIDER_HEADROOM) {
    // Not "is the arithmetic right" — the swept top here is *measured*, so this
    // catches the geometry growing into headroom that the constants still think
    // is there.
    complaints.push(
      `only ${(TRAIN_CLEARANCE_Y - sweptTop).toFixed(2)} m of measured headroom ` +
        `over the train, against the ${RIDER_HEADROOM.toFixed(2)} m ` +
        'train/clearance.ts believes it is leaving',
    );
  }

  return complaints;
};

/**
 * **Is the cat bus actually in the park?**
 *
 * This is the invariant the repo did not have, and its absence is the whole
 * story of issue #245. The arrival merged on 26 July 2026 as PR #27 — six new
 * files under `world/entrance/`, no `Game.ts`, no `main.ts`, no call site
 * anywhere. `Entrance` was never constructed, `createCatBus` had no importers,
 * and the identifier `cat-bus` did not appear in the shipped bundle at all.
 * Two hundred tests and thirty-odd `check:*` scripts stayed green for twelve
 * days, and all five of those files could have been deleted without a single
 * one of them noticing. Jim found it the only way it could be found: *"I've
 * never seen the cat bus, I don't think it works."*
 *
 * So this asks the one question none of them asked — **is the thing there?** —
 * of the built scene graph, not of the code that was supposed to build it. It
 * goes red if `World` stops constructing `Entrance`, if `Entrance` stops
 * constructing the arrival, if the arrival stops adding the bus to a group that
 * reaches the scene, or if the bus is built with no geometry on it.
 *
 * Thresholds are deliberately loose and physical: this is not a test of where
 * the choreography puts the bus frame by frame (`scripts/check-cat-bus.mts`
 * drives that), it is a test that a bus exists, has a body, has its driver and
 * its passengers, and is standing at the gate rather than at the origin.
 */
/**
 * **Is there actually a hole in the wall at the gate?**
 *
 * Issue #195. `isInEntranceGateGap` sat in `entrance/layout.ts` from the day the
 * entrance was written with **zero callers anywhere**, so the gate was a gate in
 * name only: an arch stood over unbroken masonry, with an unbroken collision
 * polygon behind it. `buildBoundaryWall`'s own comment said "the wall is solid",
 * and it was. Jim found it the way it was always going to be found — by
 * watching a bus drive through it.
 *
 * This measures the **built** wall: every block instance the boundary actually
 * placed, against the opening the gate claims to have. A predicate saying "the
 * walkers pass through the gate's angle" is not this, and does not catch it —
 * that stays true whether or not there is any stone in the way, which is
 * precisely how the first version of this guard passed with the gap closed
 * again.
 */
const theGateIsAHoleInTheWall: Invariant = (facts) => {
  const blocks: { x: number; z: number }[] = [];
  const local = new Matrix4();
  const composed = new Matrix4();
  const centre = new Vector3();
  facts.world.garden.group.traverse((object) => {
    if (!(object instanceof InstancedMesh)) return;
    if (!/^boundary-(blocks|pillars)?/.test(object.name) && object.name !== 'boundary-blocks') return;
    for (let i = 0; i < object.count; i += 1) {
      object.getMatrixAt(i, local);
      composed.multiplyMatrices(object.matrixWorld, local);
      centre.setFromMatrixPosition(composed);
      blocks.push({ x: centre.x, z: centre.z });
    }
  });

  if (blocks.length === 0) return ['found no boundary wall blocks at all to measure'];

  const fouls: string[] = [];
  const inGap = blocks.filter((b) => isInEntranceGateGap(Math.atan2(b.z, b.x)));
  if (inGap.length > 0) {
    const worst = inGap[0];
    fouls.push(
      `${inGap.length} boundary wall blocks stand inside the gate opening, e.g. ` +
        `${fmt([worst?.x ?? 0, worst?.z ?? 0])} — the gate is solid stone (#195)`,
    );
  }

  // And the hole is wide enough to walk through: the nearest stone either side
  // of the gate centre must leave more than a child's width between them.
  let nearest = Infinity;
  for (const b of blocks) {
    nearest = Math.min(nearest, Math.hypot(b.x - 0, b.z - ENTRANCE_GATE_Z));
  }
  if (nearest < PLAYER_RADIUS * 2) {
    fouls.push(
      `the closest wall block sits ${nearest.toFixed(2)} m from the middle of the gate — ` +
        `a child of ${PLAYER_RADIUS} m cannot get through`,
    );
  }
  return fouls;
};

const theCatBusIsInThePark: Invariant = (facts) => {
  const bus = facts.catBus;
  if (!bus) {
    return [
      'no node named `cat-bus` anywhere in the built scene — the arrival is not wired in. ' +
        'This is exactly the state PR #27 shipped in and nothing caught for twelve days; ' +
        'see `world/entrance/ArrivalSequence.ts`.',
    ];
  }

  const fouls: string[] = [];
  // A bus made of nothing would satisfy "a node called cat-bus exists".
  if (bus.meshCount < 20) {
    fouls.push(`the cat bus has only ${bus.meshCount} meshes on it — that is not a built bus`);
  }
  // Big enough to be a bus, measured against the children who ride in it rather
  // than against a literal — so it stays true if they are ever resized. Jim, on
  // the first version anyone saw: "barely bigger than a child, and smaller
  // vertically than one child with a hat".
  if (bus.height <= TALLEST_CHILD_HEIGHT * 1.4) {
    fouls.push(
      `the cat bus is ${bus.height.toFixed(2)} m tall against a ${TALLEST_CHILD_HEIGHT} m ` +
        'child in a hat — that is a shed, not a bus',
    );
  }
  if (bus.height >= TALLEST_CHILD_HEIGHT * 2.6) {
    fouls.push(`the cat bus is ${bus.height.toFixed(2)} m tall, which is too big even for a bus`);
  }
  if (!bus.hasDriver) fouls.push('the cat bus has nobody driving it');
  if (bus.kidCount !== 2) {
    fouls.push(`expected 2 other children to arrive with her, found ${bus.kidCount}`);
  }

  // Waiting on the kerb outside the gate, where the sequence starts. A bus left
  // at the origin is in the middle of the ball pit.
  const kerbGap = Math.hypot(bus.x - ENTRANCE_BUS_ARRIVE_X, bus.z - ENTRANCE_BUS_STOP_Z);
  if (kerbGap > 1) {
    fouls.push(
      `the cat bus starts at ${fmt([bus.x, bus.z])}, ${kerbGap.toFixed(2)} m from the kerb ` +
        `${fmt([ENTRANCE_BUS_ARRIVE_X, ENTRANCE_BUS_STOP_Z])} it is supposed to pull in from`,
    );
  }

  // **And it is outside the park.** Jim, watching the first run: "the bus drives
  // something like 5 m into the park, through a wall". `distanceToEdge` is
  // positive inside the boundary, so anything at or above zero is a bus
  // somewhere a bus has no business being.
  const inside = facts.boundary.distanceToEdge(bus.x, bus.z);
  if (inside >= 0) {
    fouls.push(
      `the cat bus is parked ${inside.toFixed(2)} m INSIDE the park boundary — it belongs on ` +
        'the road outside the gate',
    );
  }
  return fouls;
};

/**
 * **Can the bus actually stop here, and can she actually walk in?**
 *
 * `entrance/layout.ts` has exported `ENTRANCE_CLEAR_X/Z/RADIUS` since the
 * entrance was written, under a comment saying they keep the scatter off the
 * stop and the gate plaza — and **nothing imported them**. The comment
 * described an intention that no code implemented, so trees and bushes were
 * free to grow in the road the bus parks in and on the ground she is set down
 * on. `Scenery.ts` now asks them; this is what proves it kept asking.
 *
 * Measured against the **game's** numbers rather than the generator's target,
 * per this file's rule 2: what has to be true is that a child set down here can
 * stand and walk away, not that the scatter respected some particular radius.
 * The corridor sampled is the real one — from where the bus parks, round to
 * where she is handed the controls.
 *
 * **{@link DROP_OFF_CLEAR} was measured, not guessed.** A bare `PLAYER_RADIUS`
 * was the first threshold written here and it was **vacuous**: with the keep-out
 * deliberately removed, all five seeds still passed, because the nearest bush to
 * her spawn on the canonical seed sits 0.94 m away — clear of her 0.62 m body
 * and therefore, on that reading, fine. It is plainly not fine; she would spawn
 * pressed into a bush. Two of five seeds go red at 1.5 m, which is the same
 * clearance `Scenery.ts` already demands around a ride exit and for the same
 * documented reason: 0.62 m of body plus the 0.85 m widest clump collider this
 * park plants is 1.47 m, so 1.5 m is room to be set down and *step off*, rather
 * than merely to be inserted.
 */
const theEntranceIsClearEnoughToArriveAt: Invariant = (facts) => {
  const fouls: string[] = [];

  // The route she is actually walked along, sampled every half metre, plus
  // where the bus parks and where she ends up standing.
  // From the gate she walks in through, to where the game hands her the
  // controls. The bus itself is outside the park now, so the part of the walk
  // that the scatter can foul is the part inside it.
  const corridor = samplePolyline(
    [
      [0, ENTRANCE_GATE_Z],
      [ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z],
    ],
    0.5,
  );

  const planted: readonly { x: number; z: number; footprint: number; what: string }[] = [
    ...facts.trees.map((tree) => ({
      x: tree.x,
      z: tree.z,
      footprint: tree.footprint,
      what: 'tree',
    })),
    ...facts.bushes.map((bush) => ({
      x: bush.x,
      z: bush.z,
      // A bush publishes the radius of the collider it puts in a walker's way,
      // which is the same thing a tree's `footprint` is, under another name.
      footprint: bush.radius,
      what: 'bush',
    })),
  ];

  // Report the worst offender per plant rather than once per sampled point, or
  // one bush in the road becomes forty near-identical complaints.
  for (const thing of planted) {
    let worst = Infinity;
    let where: readonly [number, number] = [0, 0];
    for (const [x, z] of corridor) {
      const gap = Math.hypot(thing.x - x, thing.z - z) - thing.footprint;
      if (gap < worst) {
        worst = gap;
        where = [x, z];
      }
    }
    if (worst < DROP_OFF_CLEAR) {
      fouls.push(
        `a ${thing.what} at ${fmt([thing.x, thing.z])} reaches to ${worst.toFixed(2)} m of ` +
          `${fmt(where)} on the walk in from the cat bus — a child set down here needs ` +
          `${DROP_OFF_CLEAR} m to stand and step off`,
      );
    }
  }
  return fouls;
};

/**
 * Room to be set down by a vehicle and walk away from it, in metres.
 *
 * `PLAYER_RADIUS` (0.62) of body, plus the 0.85 m collider of the widest bush
 * clump this park plants, is 1.47 — so 1.5 m is the point at which a drop-off
 * is somewhere you can *leave*, not merely somewhere you fit. `Scenery.ts`
 * reaches the same number by the same argument for a ride exit.
 */
const DROP_OFF_CLEAR = 1.5;

/** Points every `step` metres along a polyline, corners included. */
function samplePolyline(
  points: readonly (readonly [number, number])[],
  step: number,
): readonly (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = Math.max(1, Math.ceil(length / step));
    for (let n = 0; n <= count; n += 1) {
      const t = n / count;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as const);
    }
  }
  return out;
}

const INVARIANTS: readonly (readonly [string, Invariant])[] = [
  ['no two wall runs cross or crowd each other', wallsDoNotClash],
  ['no wall run stands on the railway', wallsClearTheRailway],
  ['no tree stands on the railway', treesClearTheRailway],
  ['no two plots overlap', plotsDoNotOverlap],
  ['every entrance has standable ground', entrancesAreUsable],
  ['no two trees interpenetrate', treesDoNotInterpenetrate],
  ['no bush stands on the paving or inside a plot', bushesStandOnOpenGround],
  ['no tree grows into a wall', treesKeepOffWalls],
  ['every path passes near a tree a child can climb', everyPathIsNearAClimbableTree],
  ['no lamp stands in anything', lampsTouchNothing],
  ['every path is lit end to end', everyPathIsLit],
  ['no paved path stops anywhere but a destination', noPathEndsNowhere],
  ['every place a child can be served is a node in the path graph', everyDestinationIsANode],
  ['every ride exit is clear ground, reachable from the entrance', rideExitsAreUsable],
  ['the Rail Race exit fits the whole party that arrives on it', railRaceExitFitsTheParty],
  ['the Rail Race flies clear of the railway and stands on clear ground', railRaceFliesClear],
  ['every Rail Race duck bar stands over a real trestle leg', duckBarsStandOnRealSupports],
  [
    'both Rail Race rings stand outside the park, built to their own size, ' +
      'and only the walk-past one is solid',
    railRaceRingsStandOutsideThePark,
  ],
  ["the rail-race stall's doormat is standable and reachable", railRaceStallDoormatIsUsable],
  ['the Sky Cruiser flies clear of the whole park', skyCruiserFliesClearOfThePark],
  ['the Sky Cruiser goes round the big wheel', skyCruiserGoesRoundTheBigWheel],
  ['the Sky Cruiser built track turns as gently as it promises', skyCruiserTurnsGently],
  [
    'the ginormous slide goes downhill all the way, lands in the ball pit, ' +
      'and never runs back inside the castle',
    theGinormousSlideIsRideable,
  ],
  [
    'the ginormous slide stands on legs a child can walk between',
    theGinormousSlideStandsOnSomething,
  ],
  [
    'the ginormous slide leaves the castle over the top of the battlements',
    theGinormousSlideLeavesOverTheBattlements,
  ],
  [
    'the ginormous slide does not clip the castle towers',
    theGinormousSlideMissesTheCastleTowers,
  ],
  [
    "the ginormous slide's cameras cover the whole ride and can see it",
    theSlideTracksideCamerasCanSeeTheRide,
  ],
  ['a child boarding the ginormous slide is put down on the chute', theSlideRiderSitsOnTheChute],
  [
    'a child finishing the ginormous slide lands in the balls, clear of the chute',
    theSlideRiderLandsInTheBalls,
  ],
  ['about half the ginormous slide’s chute is see-through', theChuteIsHalfSeeThrough],
  ['the ginormous slide keeps its air from the Sky Cruiser', theSlideKeepsItsAirFromTheCruiser],
  ['the Sky Cruiser fits through the window it cut in the castle', skyCruiserFitsThroughTheCastle],
  ['the Sky Cruiser always flies through the castle', skyCruiserAlwaysFliesThroughTheCastle],
  [
    'the clearance over the railway covers the train and everyone riding it',
    railwayClearanceCoversTheTrainAndItsRiders,
  ],
  ['the cat bus is actually in the park, at the gate, with everyone aboard', theCatBusIsInThePark],
  ['the boundary wall has a gate you can actually walk through', theGateIsAHoleInTheWall],
  [
    'the bus stop and the walk in from it are clear of trees and bushes',
    theEntranceIsClearEnoughToArriveAt,
  ],
];

/**
 * Registers every invariant for one seed.
 *
 * The park is built **once** per seed in `beforeAll` and shared: it is a few
 * hundred milliseconds of real `World` construction, and building it per
 * assertion would turn a fast suite into a slow one for no extra proof.
 */
export function registerParkInvariants(seed: number, label = `seed ${seed}`): void {
  describe(label, () => {
    let facts: ParkFacts;

    beforeAll(async () => {
      facts = await buildParkFacts(seed);
    }, 120_000);

    it('built the park it was asked for', () => {
      expect(facts.seed).toBe(seed);
      // A park with no walls, no trees or no lamps would pass every clearance
      // invariant below vacuously. This is the guard against that.
      //
      // Trees get a real floor rather than `> 0`, because thinning the scatter
      // is the cheapest possible way to make a clearance invariant go green and
      // it is not a hypothetical: adding `treesKeepOffWalls` took the canonical
      // seed from 30 trees to 19 until the scatter's attempt budget was raised
      // to buy them back.
      //
      // **This floor cannot catch every thinning, and the number is chosen
      // knowing that.** Measured both ways round — healthy park 26/27/26/30/28
      // across the five seeds, the same park with the budget reverted
      // 19/23/23/27/23 — the two sets *overlap*: seed 11 thinned (27) plants
      // more than the canonical seed healthy (26). So no single floor can
      // separate them everywhere, and any threshold low enough to keep a real
      // park green necessarily lets seed 11's thinning through.
      //
      // 24 is the best a global floor does: it catches 4 of the 5 seeds and
      // still leaves the healthiest-but-lowest real seed two trees of headroom
      // for ordinary seed-to-seed drift. Four suites going red at once is a
      // loud enough signal; running on five seeds is what makes it work, not
      // the cleverness of the number. Raising it to 25 would catch no more and
      // leave one tree of headroom, so it is not worth the false alarms.
      //
      // An anti-vacuity guard, not a placement threshold — the "thresholds come
      // from the game" rule above is about the latter.
      expect(facts.trees.length, 'the park planted almost no trees').toBeGreaterThan(24);
      // Bushes get a floor for the same reason, and they need one more than
      // they used to. The clump count was pinned at exactly 108 by a
      // fill-until-N loop; it is now whatever a fixed budget of candidates
      // passes, which is the price of the scatter being local (see
      // `Scenery.ts`'s `BUSH_BUDGET`). That makes thinning something that can
      // now happen quietly, so it gets a guard.
      //
      // Measured across the five CI seeds at 149 / 128 / 137 / 142 / 140. The
      // floor is 108 because that is exactly what every seed used to plant, so
      // it reads as "no seed is worse off than before the scatter was made
      // local" rather than as an arbitrary round number — and the worst seed
      // still clears it by 20.
      expect(facts.bushes.length, 'the park planted almost no bushes').toBeGreaterThan(107);
      // Climbable trees get their own floor, separate from the walk-distance
      // invariant, because the two fail differently: the distance check goes
      // red when they are badly spread, this one when there are simply too few.
      // A park could in principle satisfy the walk with four well-placed trees
      // and still feel bare.
      //
      // **This is the primary guard on Jim's complaint**, and it tightened a
      // long way when #216 landed. Measured across the five CI seeds at
      // 43 / 40 / 49 / 48 / 48 — up from 8 / 9 / 12 / 12 / 11 before that PR
      // stopped capping planting at 55 m, and from 1 / 2 / 2 / 3 / 5 under the
      // rule that had Jim hunting for a tree at all.
      //
      // The floor is 25: comfortably below the worst seed (40, so 37% of slack
      // for a park that regenerates), and comfortably *above* both earlier
      // populations, so it fails outright if either the old predicate or the
      // old planting cap comes back. It is deliberately not scaled to the
      // current park — a floor that tracks what the park happens to manage
      // catches nothing.
      expect(
        facts.climbableTrees.length,
        'the park planted almost nothing a child can climb',
      ).toBeGreaterThan(24);
      expect(facts.lamps.length, 'the park has no lamps').toBeGreaterThan(0);
      expect(facts.plots.length, 'the park placed no plots').toBeGreaterThan(0);
      expect(facts.exits.length, 'the park has no ride exits').toBeGreaterThan(0);
    });

    // The one place in this file that asserts. See {@link Invariant}.
    for (const [name, check] of INVARIANTS) {
      it(name, () => {
        const complaints = check(facts);
        expect(complaints, describeComplaints(complaints)).toHaveLength(0);
      });
    }
  });
}

// ------------------------------------------------------------------ helpers

/**
 * How many complaints a failure prints before it starts summarising.
 *
 * A badly-placed park can produce hundreds — `treesDoNotInterpenetrate` used to
 * cap its own message at eight for exactly this reason — and a wall of them
 * buries the first one, which is usually the one worth reading.
 */
const MAX_COMPLAINTS_SHOWN = 8;

/** The failure message for a set of complaints, capped so one bad seed does not bury the console. */
function describeComplaints(complaints: readonly string[]): string {
  const shown = complaints.slice(0, MAX_COMPLAINTS_SHOWN);
  const rest = complaints.length - shown.length;
  return rest > 0 ? `${shown.join('\n')}\n…and ${rest} more` : shown.join('\n');
}

function standableNear(facts: ParkFacts, x: number, z: number): boolean {
  if (facts.isStandable(x, z)) return true;
  const rings = 8;
  for (let i = 0; i < rings; i += 1) {
    const angle = (i / rings) * Math.PI * 2;
    const px = x + Math.cos(angle) * SHORTFALL_TOLERANCE;
    const pz = z + Math.sin(angle) * SHORTFALL_TOLERANCE;
    if (facts.isStandable(px, pz)) return true;
  }
  return false;
}

/**
 * How far `point` is from the paved *surface* of every ribbon but `exclude`'s
 * — zero once it is standing on one of them.
 *
 * The surface rather than the centre line: two ribbons have joined when their
 * paving meets, which is what makes a junction something a child can walk
 * through, and a 3.6 m backbone offers 1.8 m of that on either side.
 */
function distanceToOtherPaving(
  facts: ParkFacts,
  exclude: string,
  point: readonly [number, number],
): number {
  let best = Infinity;
  for (const edge of facts.pathEdges) {
    if (edge.name === exclude) continue;
    for (let i = 0; i < edge.points.length - 1; i += 1) {
      const gap = pointToSegment(point, edge.points[i]!, edge.points[i + 1]!) - edge.halfWidth;
      if (gap < best) best = gap;
    }
  }
  // The plaza is paving too, and a disc rather than a ribbon.
  for (const node of facts.pathNodes) {
    if (node.reach <= 0) continue;
    const gap = Math.hypot(point[0] - node.x, point[1] - node.z) - node.reach;
    if (gap < best) best = gap;
  }
  return Math.max(0, best);
}

function fmt(point: readonly [number, number]): string {
  return `${point[0].toFixed(1)}, ${point[1].toFixed(1)}`;
}
