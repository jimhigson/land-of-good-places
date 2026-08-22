/**
 * **Does the real child-child separation mechanism actually keep two ordinary
 * children from walking through each other?**
 *
 * ```
 * npm run check:npc-separation      # or on its own, with --mutate to prove it can fail
 * ```
 *
 * ## Why this exists
 *
 * `check-cat-bus.mts` used to gate on an invented "personal space" margin —
 * 0.99 m — that had nothing to do with any real number in the game, and kept
 * re-failing by centimetres whenever nearby path geometry shifted. Fixed in
 * commit `4957382` per Jim's direction: *"just use normal pathfinding and
 * collision detection... who cares how close they are so long as they collide
 * normally."* His follow-up was explicit: *"a test that sets up children and
 * makes them walk past each other is the right check here."* This is that
 * check — a direct, general-purpose behavioural test of `NpcSystem`'s
 * child-child separation, with no bus, no seats, no invented margin.
 *
 * ## The mechanism under test
 *
 * `NpcSystem.update` calls a private `separate(dt)` every frame, over every
 * pair of live characters, which calls `first.separateFrom(second, SEPARATION,
 * maxPush)`. `SEPARATION` (exported from `NpcSystem.ts` so this check reads the
 * real number rather than a second copy of it) is `CHILD_FOOTPRINT` — 1.8 m,
 * a whole child wide — the distance at which two free children start a soft,
 * rate-limited push-apart. `NPC_RADIUS * 2` (1.0 m) is the real physical
 * floor: two centres closer than that are genuinely, physically inside one
 * another. Children are *not* registered as colliders with the shared
 * `CollisionWorld` (`NpcSystem`'s own header comment: a moving collider would
 * make every child a wall the others grind against) — `separate` is the
 * *only* thing standing between two children and full interpenetration.
 *
 * ## How this drives a genuine collision course
 *
 * Two ordinary, free (non-scripted, non-climbing) children already in the
 * built park are picked — real `WanderDriver`-driven children, the same
 * selection `check-npc-perch.mts` uses. Their driver's `update` is replaced
 * (per-instance, only for these two) with one that always aims straight at
 * the other child's *current* position — a genuine, continuously-updated
 * collision course, driven through the real `move()` → `collision.resolve`
 * → `NpcSystem.separate` pipeline exactly as any other pair of children in
 * the park. Nothing about their `scripted`/`climbing` status changes, so they
 * are subject to the exact same separation any two wandering children are.
 *
 * ## What is measured, off the running simulation
 *
 * 1. **Closest approach never drops below `NPC_RADIUS * 2`** — genuine
 *    physical interpenetration never happens.
 * 2. **The mechanism actually engaged.** Closest approach must have reached at
 *    or near the `SEPARATION` trigger range, *and* — the more direct proof —
 *    `NpcCharacter.separateFrom` is instrumented (wrapping the real method,
 *    not re-implementing it) to record every frame it actually applies a
 *    non-zero correction to this specific pair. A closest-approach number
 *    alone cannot tell "the mechanism pushed them apart" from "they just
 *    happened not to get any closer"; counting real corrective pushes can.
 *
 * ## Proving the check is real
 *
 * `--mutate` no-ops `NpcCharacter.prototype.separateFrom` outright — the same
 * method `NpcSystem.separate` calls for every pair, so this disables the real
 * mechanism system-wide, not a copy of it. Two children with nothing to stop
 * them, magnetically drawn straight at each other, walk fully into one
 * another. Run once clean and once with `--mutate` and diff the two reports;
 * see this file's PR description for the actual numbers from both runs.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { NpcCharacter, NPC_RADIUS } from '../src/entities/npc/NpcCharacter.ts';
import { WanderDriver } from '../src/entities/npc/wanderDriver.ts';
import { SEPARATION } from '../src/entities/npc/NpcSystem.ts';
import type { FrameContext } from '../src/core/types.ts';

const DT = 1 / 60;

/** Long enough to close a several-metre gap and then hold a sustained standoff. */
const RUN_SECONDS = 15;
const FRAMES = Math.ceil(RUN_SECONDS / DT);

/**
 * How far apart the chosen pair must start.
 *
 * Comfortably outside {@link SEPARATION} (1.8 m), so the run genuinely watches
 * them close the gap and cross the trigger threshold rather than starting
 * already inside it. Kept small (0.3 m of margin) on purpose: the smallest
 * gap above the threshold is the pair least likely to have a wall, a tree or
 * a bed between them on the straight line this check walks them along.
 */
const MIN_START_GAP = SEPARATION + 0.3;

/** `--mutate` disables the real separation mechanism, to prove this check is real. */
const mutate = process.argv.includes('--mutate');

const failures: string[] = [];
const notes: string[] = [];
function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

const park = buildHeadlessPark();
const world = park.world;

// ---------------------------------------------------------- pick a real pair
//
// Ordinary, free, wandering children — the same filter check-npc-perch.mts
// uses to find children whose driver can actually decide to climb. Excludes
// anybody scripted (a bus/cutscene passenger) or mid-climb, so this is
// exactly "two genuinely ordinary, free, wandering children", not a special
// case.
const wanderers = world.npcs.all.filter(
  (character) => character.driver instanceof WanderDriver && !character.scripted && !character.climbing,
);
if (wanderers.length < 2) {
  console.error(
    `check:npc-separation FAILED — the park has ${wanderers.length} free wandering children, need at least 2. ` +
      'That is a broken harness, not a failing game: fix this script before believing it.',
  );
  process.exit(1);
}

let childA: NpcCharacter | null = null;
let childB: NpcCharacter | null = null;
let startGap = Infinity;
for (let i = 0; i < wanderers.length; i += 1) {
  for (let j = i + 1; j < wanderers.length; j += 1) {
    const a = wanderers[i]!;
    const b = wanderers[j]!;
    const gap = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
    if (gap > MIN_START_GAP && gap < startGap) {
      startGap = gap;
      childA = a;
      childB = b;
    }
  }
}
if (!childA || !childB) {
  console.error(
    `check:npc-separation FAILED — no two free children in the built park start more than ` +
      `${MIN_START_GAP.toFixed(2)} m apart, so there is no genuine collision course to drive.`,
  );
  process.exit(1);
}
const [pairA, pairB]: [NpcCharacter, NpcCharacter] = [childA, childB];

// -------------------------------------------------- put them on a collision course
//
// Replaces each child's own driver's `update` — per-instance, only these two
// — with one that always aims straight at the *other* child's live position.
// Everything downstream of `intent` is the real pipeline: `move()` turns it
// into velocity, `collision.resolve` resolves it against real walls and
// trees, and `NpcSystem.separate` is what (if anything) keeps the two from
// meeting at the same point. Neither child is scripted or climbing, so they
// are ordinary members of the crowd as far as `NpcSystem` is concerned.
function aimStraightAt(mover: NpcCharacter, target: NpcCharacter): void {
  mover.driver.update = (_context, intent) => {
    intent.moveX = 0;
    intent.moveZ = 0;
    intent.hop = false;
    intent.interact = false;
    intent.lookAt = null;
    intent.expression = 'neutral';
    intent.wave = 0;
    const dx = target.position.x - mover.position.x;
    const dz = target.position.z - mover.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 1e-6) return;
    intent.moveX = dx / distance;
    intent.moveZ = dz / distance;
  };
}
aimStraightAt(pairA, pairB);
aimStraightAt(pairB, pairA);

// ------------------------------------------------------------- instrumentation
//
// Wraps the real `NpcCharacter.prototype.separateFrom` — the exact method
// `NpcSystem.separate` calls for every pair, every frame — rather than
// re-implementing any part of the separation logic. For every frame this pair
// is handed to it, records whether it actually moved either child (a real
// corrective push, not a no-op because they were already far enough apart).
//
// `--mutate` replaces the same method with a no-op instead: this is not a
// second, weaker copy of the mechanism standing in for testing purposes, it
// is *the* mechanism `NpcSystem.separate` depends on, disabled system-wide.
let separationFires = 0;
let maxSingleFrameCorrection = 0;
const originalSeparateFrom = NpcCharacter.prototype.separateFrom;

if (mutate) {
  NpcCharacter.prototype.separateFrom = function (): void {
    // no-op — proves this check is real (CLAUDE.md: "break every check
    // deliberately and watch it go red before you trust it green").
  };
} else {
  NpcCharacter.prototype.separateFrom = function (
    this: NpcCharacter,
    other: NpcCharacter,
    minimum: number,
    maxPush?: number,
  ): void {
    const isPair = (this === pairA && other === pairB) || (this === pairB && other === pairA);
    if (!isPair) {
      originalSeparateFrom.call(this, other, minimum, maxPush);
      return;
    }
    const beforeAX = this.position.x;
    const beforeAZ = this.position.z;
    const beforeBX = other.position.x;
    const beforeBZ = other.position.z;
    originalSeparateFrom.call(this, other, minimum, maxPush);
    const movedA = Math.hypot(this.position.x - beforeAX, this.position.z - beforeAZ);
    const movedB = Math.hypot(other.position.x - beforeBX, other.position.z - beforeBZ);
    if (movedA > 1e-9 || movedB > 1e-9) {
      separationFires += 1;
      maxSingleFrameCorrection = Math.max(maxSingleFrameCorrection, movedA, movedB);
    }
  };
}

// -------------------------------------------------------------------- drive it

const input = new InputSystem();
const playerPosition = new Vector3();
const cameraForward = new Vector3(0, 0, 1);

let closestApproachEver = Infinity;
let closestApproachAt = 0;
let farthestApart = 0;
const startAX = pairA.position.x;
const startAZ = pairA.position.z;
const startBX = pairB.position.x;
const startBZ = pairB.position.z;

for (let frame = 0; frame < FRAMES; frame += 1) {
  // Kept near both children, so the crowd's far-LOD halving (`NpcSystem`'s
  // `FAR_DISTANCE`) never applies to this pair — this check is about the
  // separation pass, which runs every frame regardless, not about proving
  // anything survives running at half rate.
  playerPosition.set((pairA.position.x + pairB.position.x) / 2, 0, (pairA.position.z + pairB.position.z) / 2);

  const context: FrameContext = {
    dt: DT,
    elapsed: frame * DT,
    input,
    playerPosition,
    cameraForward,
    frame,
  };
  quietly(() => world.update(context));

  const gap = Math.hypot(pairA.position.x - pairB.position.x, pairA.position.z - pairB.position.z);
  if (gap < closestApproachEver) {
    closestApproachEver = gap;
    closestApproachAt = frame * DT;
  }
  farthestApart = Math.max(farthestApart, gap);
}

// ------------------------------------------------------------------ measure

const walkedA = Math.hypot(pairA.position.x - startAX, pairA.position.z - startAZ);
const walkedB = Math.hypot(pairB.position.x - startBX, pairB.position.z - startBZ);

// Coverage: none of the below means anything if nothing actually happened.
check(
  walkedA > 0.5 && walkedB > 0.5,
  `the chosen pair barely moved (${walkedA.toFixed(2)} m and ${walkedB.toFixed(2)} m over ${RUN_SECONDS} s) — ` +
    'the collision course was never actually driven',
);
check(
  closestApproachEver < startGap - 0.5,
  `the pair started ${startGap.toFixed(2)} m apart and their closest approach was ${closestApproachEver.toFixed(2)} m — ` +
    'they never meaningfully closed the gap, so this never exercised anything',
);

// --- a. genuine physical interpenetration never happens --------------------
const TRUE_OVERLAP_FLOOR = NPC_RADIUS * 2;
check(
  closestApproachEver >= TRUE_OVERLAP_FLOOR,
  `${pairA.name} and ${pairB.name} came within ${closestApproachEver.toFixed(3)} m of each other at ` +
    `${closestApproachAt.toFixed(2)} s — closer than NPC_RADIUS * 2 (${TRUE_OVERLAP_FLOOR.toFixed(2)} m), ` +
    'which is genuine physical interpenetration between two children',
);

// --- b. the mechanism was genuinely engaged, not just uninvolved -----------
//
// Two independent signals, because either alone can be misread: a closest
// approach near the trigger range could in principle happen even if
// `separate` never fired (a wall could be doing the stopping); a fire count
// alone says nothing about whether real overlap was actually threatened.
// Together they say what happened and why.
const REACHED_TRIGGER_RANGE = SEPARATION * 1.05;
check(
  closestApproachEver <= REACHED_TRIGGER_RANGE,
  `closest approach was ${closestApproachEver.toFixed(2)} m, never reaching SEPARATION's own trigger range ` +
    `(${SEPARATION.toFixed(2)} m, allowing to ${REACHED_TRIGGER_RANGE.toFixed(2)} m) — this run never actually ` +
    'tested the separation mechanism, it just proves two children can avoid each other by accident',
);
check(
  separationFires > 0,
  `NpcCharacter.separateFrom was never observed applying a real corrective push to ${pairA.name} and ` +
    `${pairB.name} across ${FRAMES} frames — the mechanism this check exists to test did not engage`,
);

// ------------------------------------------------------------------- report

notes.push(
  `chosen pair: ${pairA.name} and ${pairB.name}, starting ${startGap.toFixed(2)} m apart ` +
    `(minimum required: ${MIN_START_GAP.toFixed(2)} m)`,
);
notes.push(`ran ${RUN_SECONDS} s (${FRAMES} frames) at ${DT.toFixed(4)} s/frame${mutate ? ', --mutate: separation disabled' : ''}`);
notes.push(`${pairA.name} walked ${walkedA.toFixed(2)} m, ${pairB.name} walked ${walkedB.toFixed(2)} m`);
notes.push(
  `closest approach: ${closestApproachEver.toFixed(3)} m at ${closestApproachAt.toFixed(2)} s ` +
    `(true-overlap floor NPC_RADIUS*2 = ${TRUE_OVERLAP_FLOOR.toFixed(2)} m, SEPARATION trigger = ${SEPARATION.toFixed(2)} m)`,
);
notes.push(`farthest apart during the run: ${farthestApart.toFixed(2)} m`);
notes.push(
  `separateFrom applied a real correction to this pair on ${separationFires} of ${FRAMES} frames, ` +
    `worst single-frame correction ${maxSingleFrameCorrection.toFixed(3)} m`,
);

for (const note of notes) console.log(`  ${note}`);

if (failures.length > 0) {
  console.error(`\nFAIL: child-child separation did not hold up${mutate ? ' (--mutate: expected)' : ''}.`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nnpc separation OK');
