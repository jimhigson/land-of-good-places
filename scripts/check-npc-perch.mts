/**
 * **How high does an NPC actually sit when it peeks out of a tree?**
 *
 * ```
 * npm run check:crowd            # runs this after the driver trace
 * npm run check:npc-perch        # or on its own, with --verbose
 * ```
 *
 * Issue #224, found while reviewing PR #215 and *by mutation rather than by
 * reading*. PR #215 lifts the **player** higher when she peeks from a tree so
 * her wave clears the canopy. An earlier revision of it accidentally lifted
 * **every NPC climber** too, because the lift was written inside the shared
 * `climbPose`. Review caught that and made the lift a parameter only the
 * player's three call sites pass — but nothing in the build was sensitive to
 * the difference. Setting the parameter's default to `5`, the bug back at five
 * times the magnitude, left `check:crowd`'s trace hash **completely unchanged**
 * (`639ad23c` at both `0` and `5`), because that trace covers climb *decisions*
 * and this is *height*.
 *
 * The two cases are meant to diverge and will keep diverging: the player's lift
 * is bought by her wave — a raised arm that has to clear the leaves — while an
 * NPC has no wave and no arm drawn at all, so any lift they get is pure
 * elevation with nothing under it. That is a shared-code/different-intent split,
 * which wants a check rather than a convention.
 *
 * ## What it measures
 *
 * Real crowd children, from the **real built park**, put up **real climbable
 * trees** through the game's own `TreeClimbing.update()`. Nothing here
 * re-implements `climbPose`, `setClimbPose` or the walk cycle; the number this
 * asserts on is read out of the finished scene graph — the head joint's world
 * position after a frame of the real update — and compared against the canopy's
 * own built geometry, taken from `Scenery`'s foliage parts rather than from
 * `canopyTopY`, which is the generator's *intent* rather than the park's leaves.
 *
 * ## What it deliberately does not measure
 *
 * *Whether* an NPC decides to climb, which tree, or how often. That is
 * `trace-npc-driver.mts`'s job and it already has a coverage floor on it
 * (`climbs=31` on the canonical run). This check forces a climb it did not
 * decide, precisely so that it can be about height and nothing else — one
 * question per check, and neither of the two can quietly stop asking its own.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import { TreeClimbing } from '../src/world/TreeClimbing.ts';
import { WanderDriver } from '../src/entities/npc/wanderDriver.ts';
import type { NpcCharacter } from '../src/entities/npc/NpcCharacter.ts';
import type { ClimbableTreeSeed, FoliageOccluder } from '../src/world/Scenery.ts';
import type { FrameContext } from '../src/core/types.ts';
import type { Player } from '../src/entities/Player.ts';
import type { Hud } from '../src/ui/Hud.ts';

const verbose = process.argv.includes('--verbose');

/**
 * A lift injected into every climber, for `--mutate <metres>`.
 *
 * This is how the check was proved red, and it is kept so the next person can
 * re-prove it in one command instead of hand-editing `TreeClimbing.ts` and
 * hoping they put it back. It reproduces the exact shape of the #224 bug — a
 * lift that reaches NPCs — without touching the shipped code path.
 */
const mutateArg = process.argv.indexOf('--mutate');
const MUTATION = mutateArg > 0 ? Number(process.argv[mutateArg + 1]) : 0;

// --------------------------------------------------------------- the band
//
// Both bounds come off the canopy that was actually built, and both are
// expressed in terms of the leaves rather than as absolute metres, because a
// park regenerates and its trees are not all the same size.

/**
 * How far above the leaves a head may sit, as a fraction of the canopy's own
 * height.
 *
 * A peeking child is meant to look like she is *in* the tree with her head out
 * of it. Some clearance is right — that is the whole point of peeking — but a
 * head a long way above the topmost leaf has nothing under it and reads as a
 * rendering fault, which is exactly the symptom #224 describes.
 *
 * **Chosen from the empty gap between two measured populations**, the same way
 * `check:climb-wave` picks `REQUIRED_VISIBLE`, rather than reasoned from
 * geometry. Run `--mutate <metres>` to reproduce all of it:
 *
 * ```
 *   shipped            0.073 - 0.173
 *   +0.5 m to NPCs     0.195 - 0.304
 *   +1.0 m             0.305 - 0.434
 *   +1.2 m             0.348 - 0.486   <- the player's real lift, if it leaked
 *   +5.0 m             1.157 - 1.475   <- the mutation #224 was found with
 * ```
 *
 * Nothing lands between **0.173** and **0.304**, so 0.25 cannot be reached by
 * ordinary retuning of a park whose trees change size every generation, and
 * cannot be survived by a lift leaking to NPCs — not even a half-metre one,
 * which is well under half of what the player currently gets.
 */
const MAX_ABOVE_CANOPY = 0.25;

/**
 * And how far *into* the leaves a head may sink before it is not peeking.
 *
 * Same units. Zero would demand the head clear the topmost leaf outright, which
 * is stricter than the game needs — a head half-buried in foliage still reads
 * as a child in a tree — but sink it far below the top and there is nothing to
 * see at all. The worst real climber today sits 0.073 *above* the leaves, so
 * there is a great deal of room before this fires; it is here to catch a perch
 * that stops clearing the canopy at all, not to police the current spread.
 */
const MIN_ABOVE_CANOPY = -0.25;

const park = buildHeadlessPark();
const trees = park.world.scenery.climbableTrees;
const occluders = park.world.scenery.foliageOccluders;
const npcs = park.world.npcs;

if (trees.length === 0) {
  console.error('check:npc-perch FAILED — the park generated no climbable trees at all.');
  process.exit(1);
}

/** Every child in the park whose driver can actually climb. */
const climbers = npcs.all.filter((c) => c.driver instanceof WanderDriver);
if (climbers.length === 0) {
  console.error(
    'check:npc-perch FAILED — the park spawned no wandering children, so nothing can climb.\n' +
      'That is a broken harness, not a failing game: fix this script before believing it.',
  );
  process.exit(1);
}

/**
 * The built canopy's real vertical extent above this tree, in world metres.
 *
 * Read off `Scenery`'s own foliage parts — the ellipsoids that are drawn — not
 * from `ClimbableTreeSeed.canopyTopY`. `canopyTopY` is what the generator
 * *meant*; a check that took its band from there would agree with the pose code
 * about a number they both got from the same place, and would still pass if
 * both were wrong together.
 */
function canopyBandOf(tree: ClimbableTreeSeed): { top: number; bottom: number } | null {
  let occluder: FoliageOccluder | null = null;
  let nearest = 0.05;
  for (const candidate of occluders) {
    const distance = Math.hypot(candidate.x - tree.x, candidate.z - tree.z);
    if (distance < nearest) {
      occluder = candidate;
      nearest = distance;
    }
  }
  if (!occluder) return null;

  let top = -Infinity;
  let bottom = Infinity;
  for (const part of occluder.parts) {
    if (part.kind === 'trunk') continue;
    top = Math.max(top, part.position.y + part.scale.y);
    bottom = Math.min(bottom, part.position.y - part.scale.y);
  }
  return top === -Infinity ? null : { top, bottom };
}

/**
 * Puts `character` up `tree` for real and returns where its head ends up.
 *
 * The climb *decision* is forced — the getters `TreeClimbing` reads are shadowed
 * on this one driver instance, which keeps it a genuine `WanderDriver` (the
 * `instanceof` gate in `updateNpcClimbs` is real and must pass) while putting it
 * in the state a climb would. Everything downstream of that decision is the
 * shipped code: `TreeClimbing.update` -> `climbPose` -> `setClimbPose` ->
 * `NpcCharacter.update`'s own walk cycle, and then the head is simply read out
 * of the scene graph.
 */
function perchHeadY(character: NpcCharacter, tree: ClimbableTreeSeed, bearing: number): number {
  const driver = character.driver as WanderDriver;
  const spot = {
    x: tree.x + Math.sin(bearing) * (tree.trunkRadius + 1.1),
    z: tree.z + Math.cos(bearing) * (tree.trunkRadius + 1.1),
  };
  for (const [name, value] of [
    ['climbing', true],
    ['climbTree', tree],
    ['climbGroundSpot', spot],
    ['climbPhase', 'peek'],
    ['climbProgress', 1],
  ] as const) {
    Object.defineProperty(driver, name, { get: () => value, configurable: true });
  }

  const climbing = new TreeClimbing(
    {} as unknown as Player,
    { all: [character] } as unknown as typeof npcs,
    { setPrompt: () => {} } as unknown as Hud,
    trees,
  );

  const context = {
    dt: 1 / 60,
    elapsed: 12.5,
    playerPosition: new Vector3(0, 0, 0),
  } as unknown as FrameContext;

  // Two frames: the first begins the climb and hides the body, the second holds
  // the peek. The pose is written by the first, but running a second proves it
  // is *held* rather than a one-frame flicker.
  climbing.update(context);
  climbing.update(context);
  // The character's own frame, which is what runs the walk cycle over the pose
  // TreeClimbing just wrote. It matters: `NpcCharacter.animate` is what finally
  // puts the head where it is drawn, and it does not leave the perch alone.
  character.update(context.dt, context.elapsed, context.playerPosition, false);

  const rig = character.avatar.rig;
  rig.root.updateMatrixWorld(true);
  const headY = rig.head.getWorldPosition(new Vector3()).y;

  // Put the child back on the ground so the next tree starts clean.
  for (const name of ['climbing', 'climbTree', 'climbGroundSpot', 'climbPhase', 'climbProgress']) {
    Object.defineProperty(driver, name, { get: () => (name === 'climbing' ? false : null), configurable: true });
  }
  climbing.update(context);

  return headY + MUTATION;
}

const BEARINGS = 4;
interface Row {
  index: number;
  canopyHeight: number;
  clearance: number;
  fraction: number;
}

const rows: Row[] = [];
for (const [index, tree] of trees.entries()) {
  const band = canopyBandOf(tree);
  if (!band) {
    console.error(`check:npc-perch FAILED — climbable tree ${index} has no foliage to measure.`);
    process.exit(1);
  }
  const canopyHeight = band.top - band.bottom;
  for (let b = 0; b < BEARINGS; b += 1) {
    const character = climbers[(index * BEARINGS + b) % climbers.length];
    if (!character) continue;
    const headY = perchHeadY(character, tree, (b / BEARINGS) * Math.PI * 2);
    const clearance = headY - band.top;
    rows.push({ index, canopyHeight, clearance, fraction: clearance / canopyHeight });
  }
}

const highest = rows.reduce((a, b) => (b.fraction > a.fraction ? b : a));
const lowest = rows.reduce((a, b) => (b.fraction < a.fraction ? b : a));

console.log(
  `check:npc-perch: ${climbers.length} wandering children, ${trees.length} climbable trees x ` +
    `${BEARINGS} approaches${MUTATION ? `, MUTATED by +${MUTATION} m` : ''}.`,
);
if (verbose) {
  console.log('  tree  canopy height   head above leaves   as a fraction');
  for (const row of rows) {
    console.log(
      `  ${String(row.index).padStart(4)}  ${row.canopyHeight.toFixed(2).padStart(13)} m  ` +
        `${row.clearance.toFixed(3).padStart(17)} m  ${row.fraction.toFixed(3).padStart(13)}`,
    );
  }
}
console.log(
  `  NPC heads sit ${lowest.fraction.toFixed(3)} to ${highest.fraction.toFixed(3)} of a canopy ` +
    `height above the topmost leaf (allowed ${MIN_ABOVE_CANOPY} to ${MAX_ABOVE_CANOPY}).`,
);
console.log(
  `  In metres: ${lowest.clearance.toFixed(2)} m to ${highest.clearance.toFixed(2)} m, against ` +
    `canopies ${Math.min(...rows.map((r) => r.canopyHeight)).toFixed(2)}-` +
    `${Math.max(...rows.map((r) => r.canopyHeight)).toFixed(2)} m tall.`,
);

if (highest.fraction > MAX_ABOVE_CANOPY) {
  console.error(
    `\ncheck:npc-perch FAILED — a climbing NPC's head sits ${highest.clearance.toFixed(2)} m above ` +
      `the leaves of tree ${highest.index} (${highest.fraction.toFixed(3)} of its canopy height, ` +
      `allowed ${MAX_ABOVE_CANOPY}).\n` +
      'This is issue #224: an NPC is floating above the canopy with nothing under it. The usual\n' +
      "cause is a lift that has found its way inside `climbPose` and so reaches everybody. The\n" +
      "player's CLIMB_PEEK_LIFT is hers alone and must stay a parameter her own three call sites\n" +
      'pass — she has a raised arm that has to clear the leaves, and an NPC has no wave and no arm\n' +
      'drawn at all, so a lift buys them nothing and costs them their footing.',
  );
  process.exit(1);
}

if (lowest.fraction < MIN_ABOVE_CANOPY) {
  console.error(
    `\ncheck:npc-perch FAILED — a climbing NPC's head is ${(-lowest.clearance).toFixed(2)} m *below* ` +
      `the leaves of tree ${lowest.index} (${lowest.fraction.toFixed(3)} of its canopy height, ` +
      `needs at least ${MIN_ABOVE_CANOPY}).\n` +
      'It is buried in the foliage rather than peeking out of it, so the climb is invisible.',
  );
  process.exit(1);
}

console.log('check:npc-perch OK');
