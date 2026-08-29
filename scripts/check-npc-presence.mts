/**
 * **Is anybody being simulated in a room the player is not in?**
 *
 * ```
 * npm run check:npc-presence              # part of npm run build
 * npm run check:npc-presence -- --mutate  # prove it can go red
 * ```
 *
 * ## Why this exists
 *
 * Issue #362, Jim: *"if they have entered the big building, we don't simulate
 * inside rooms the player isn't in, we just mark which NPCs are in there."*
 *
 * **The honest justification is that he asked for it, plus a modest cost
 * saving.** That is worth stating flatly, because an earlier version of this
 * comment claimed something better and untrue, and a header is exactly where
 * the next agent reads a claim as settled fact.
 *
 * What it costs: simulating every NPC the player cannot see was measured, before
 * any of this was designed, at **0.147 ms a frame** — about 0.9% of a 60 Hz
 * budget, essentially all of it the seven hotel residents, who are off-space for
 * a whole session. Real, small, and not on its own a reason to build anything.
 *
 * ### What this does NOT do, despite an earlier claim here that it did
 *
 * This file used to argue that marking presence *deleted a class of bug* — that
 * indoor NPCs at coordinates six hundred metres away had corrupted crowd
 * measurements (`check:npc-dispersal` once read an RMS of 276 m, 476% of a
 * uniform scatter, and passed) and that freezing them removed the cause.
 *
 * That does not survive checking, and it was checked in review rather than
 * here:
 *
 * - `check-npc-dispersal.mts` already filters its crowd by `SPACE_GARDEN`. That
 *   filter is what fixed the 276 m reading, and it fixed it before this change
 *   existed.
 * - `check-npc-jitter.mts` already instruments `stepThroughDoor` to re-baseline
 *   across a portal, which is what stopped the 810 m single-frame step.
 * - And freezing a body does not remove it from a *positional* census at all: a
 *   marked child still stands at x≈600, so anything that measures every
 *   character's position still has to know about them. Not moving is not the
 *   same as not being there.
 *
 * So this change removes no bug class. It stops NPCs advancing in rooms nobody
 * is looking at, which is what was asked for and is a simplification worth
 * having; it is not a correctness fix, and this check exists to keep the
 * behaviour honest rather than to guard a class of defect it does not close.
 *
 * ## What is measured, off the running simulation
 *
 * The real `World`, stepped through the real `world.update` at 1/60, with the
 * player standing in the garden — which is where a player spends nearly all of
 * a session, and the only configuration in which anybody *is* elsewhere.
 *
 * 1. **Nobody in an interior the player is not in ever moves.** Frame to frame,
 *    every character inside a space that is not the garden and not the player's
 *    must have moved **exactly zero**. Not "nearly zero": a marked character is
 *    not stepped at all, so any movement whatsoever is something still
 *    simulating them.
 *
 *    Interiors only, and the garden crowd deliberately excluded — see
 *    `NpcSystem.markWhoIsElsewhere` for why that scope was measured into
 *    existence rather than argued: freezing the park while the player is
 *    indoors buys ~nothing and collides with `ParkTrain.carryPassengers`,
 *    which writes a rider's position from outside `NpcSystem`.
 * 2. **The mark agrees with the world.** Every frame, the set `NpcSystem` marked
 *    must be exactly the set whose `spaceAt` says they are elsewhere (grounded
 *    ones, which is all of them here). A mark that has drifted from the world is
 *    how a frozen NPC gets stepped, or a live one gets frozen.
 * 3. **Crossings balance, both ways.** Every character that ends the run in the
 *    garden must have crossed out exactly as many times as it crossed in. A
 *    child who goes into the castle and is later returned to the park must be
 *    counted once each way — that is what "presence counts consistent across a
 *    crossing" means, and it is what would fail if the visit timer ever put
 *    somebody back without the mark noticing, or left them in there for good.
 * 4. **Every park child starts in the park.** Jim's ticket opened *"check where
 *    children spawn inside the large castle building"*, and the answer — found
 *    by census — was that none do: all twenty-four spawn in the garden and the
 *    four who were ever indoors had walked in through the door. That is a
 *    property worth keeping rather than a question answered once, because a
 *    child spawned inside would be marked present immediately and then never
 *    simulated, never seen, and never counted in the park — invisible in exactly
 *    the way this whole mechanism makes things invisible.
 * 5. **The mechanism actually ran.** Somebody must have gone inside and somebody
 *    must have come back out. Assertions 1–3 are all vacuously true of a park
 *    where nobody ever leaves the garden, and a check that passes because
 *    nothing happened is the failure mode CLAUDE.md devotes a section to.
 *
 * ## Proving it red
 *
 * `--mutate` restores the old behaviour in the least invasive way there is: it
 * takes the mark away, so every NPC is stepped wherever they are. That is
 * precisely the park before this issue, and assertion 1 must fail on it. The
 * red output is quoted in the PR.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { NpcSystem } from '../src/entities/npc/NpcSystem.ts';
import { spaceAt, SPACE_GARDEN } from '../src/world/spaces.ts';
import type { FrameContext } from '../src/core/types.ts';
import type { NpcCharacter } from '../src/entities/npc/NpcCharacter.ts';

const mutate = process.argv.includes('--mutate');
/**
 * A second mutation, kept because this check *failed* it once.
 *
 * It leaves the mark in place and the horizontal position untouched, and lifts
 * every marked character 5 cm a frame. Over the run that is 900 m of ascent,
 * and the first version of this file reported "0 occurrences (none)" and passed,
 * because assertion 1 measured `hypot(dx, dz)` and never looked at `y`.
 *
 * Vertical is the axis this design actually worries about — the freeze is gated
 * on `isAirborne` so nobody is frozen mid-fall, and `check:hotel` has fired with
 * seven residents at −16.5 m. A red mode that only exists to prove the check can
 * see that axis is worth its ten lines.
 */
const mutateVertical = process.argv.includes('--mutate-vertical');

const DT = 1 / 60;
const RUN_SECONDS = Number(process.env['SECONDS'] ?? 300);
const FRAMES = Math.ceil(RUN_SECONDS / DT);

if (mutate) {
  // The park exactly as it was before #362: everybody stepped, wherever they
  // are. Patched on the prototype so the code under test stays the shipping
  // code and the mutation is visibly confined to this script.
  (NpcSystem.prototype as unknown as { markWhoIsElsewhere: () => void }).markWhoIsElsewhere =
    function (this: { elsewhere: Set<NpcCharacter> }) {
      this.elsewhere.clear();
    };
}

const park = buildHeadlessPark();
const world = park.world;
const npcs = world.npcs;
const all = npcs.all;

if (mutateVertical) {
  const system = npcs as unknown as {
    markWhoIsElsewhere: () => void;
    elsewhere: Set<NpcCharacter>;
  };
  const real = system.markWhoIsElsewhere.bind(system);
  system.markWhoIsElsewhere = () => {
    real();
    for (const character of system.elsewhere) character.position.y += 0.05;
  };
}

// --- 4. where everybody starts, before a single frame is stepped -----------
const spawnedOutside = all
  .filter((c) => c.driver.name === 'wander')
  .filter((c) => spaceAt(c.position.x, c.position.z) !== SPACE_GARDEN)
  .map((c) => `${c.name} in ${spaceAt(c.position.x, c.position.z)}`);

const input = new InputSystem();
/** The player stands in the garden and stays there. */
const playerPosition = new Vector3(0, 0, 0);
const cameraForward = new Vector3(0, 0, 1);

const failures: string[] = [];
const notes: string[] = [];
const check = (ok: boolean, message: string): void => {
  if (!ok) failures.push(message);
};

const lastX = new Map<NpcCharacter, number>();
const lastY = new Map<NpcCharacter, number>();
const lastZ = new Map<NpcCharacter, number>();
const lastSpace = new Map<NpcCharacter, string>();
for (const c of all) {
  lastX.set(c, c.position.x);
  lastY.set(c, c.position.y);
  lastZ.set(c, c.position.z);
  lastSpace.set(c, spaceAt(c.position.x, c.position.z));
}

/** Worst movement seen from a character who should have been standing still. */
let worstFrozenMove = 0;
let worstFrozenWho = '';
let worstFrozenAt = 0;
let frozenMoveCount = 0;
/** Frames on which the mark disagreed with the world. */
let markDisagreements = 0;
let firstDisagreement = '';

const crossedIn = new Map<NpcCharacter, number>();
const crossedOut = new Map<NpcCharacter, number>();
let markedFrames = 0;

const playerSpace = spaceAt(playerPosition.x, playerPosition.z);

for (let frame = 0; frame < FRAMES; frame += 1) {
  const context: FrameContext = {
    dt: DT,
    elapsed: frame * DT,
    input,
    playerPosition,
    cameraForward,
    frame,
  };
  quietly(() => world.update(context));

  const marked = new Set(npcs.markedElsewhere);
  if (marked.size > 0) markedFrames += 1;

  for (const character of all) {
    const space = spaceAt(character.position.x, character.position.z);
    const was = lastSpace.get(character);
    if (was !== space) {
      if (space !== playerSpace) crossedIn.set(character, (crossedIn.get(character) ?? 0) + 1);
      else crossedOut.set(character, (crossedOut.get(character) ?? 0) + 1);
      lastSpace.set(character, space);
      // A crossing legitimately moves a body a long way — that is the portal.
      // Re-baseline rather than reading the step as simulation.
      lastX.set(character, character.position.x);
      lastY.set(character, character.position.y);
      lastZ.set(character, character.position.z);
      continue;
    }

    // 2. the mark agrees with the world
    const shouldBeMarked =
      space !== playerSpace && space !== SPACE_GARDEN && !character.isAirborne;
    if (!mutate && shouldBeMarked !== marked.has(character)) {
      markDisagreements += 1;
      if (!firstDisagreement) {
        firstDisagreement =
          `${character.name} at frame ${frame} is in ${space} (player in ${playerSpace}) ` +
          `but ${marked.has(character) ? 'was marked when it should not be' : 'was not marked'}`;
      }
    }

    // 1. nobody in an interior the player is not in moves.
    //
    // Same `isAirborne` exclusion assertion 2 uses. They disagreed once —
    // 2 excluded airborne characters and 1 did not — which is a latent spurious
    // red: a character legitimately still falling onto its floor is not marked,
    // so it is *expected* to move, and flagging that would fail the build for
    // the mechanism working.
    if (space !== playerSpace && space !== SPACE_GARDEN && !character.isAirborne) {
      const dx = character.position.x - (lastX.get(character) ?? 0);
      const dy = character.position.y - (lastY.get(character) ?? 0);
      const dz = character.position.z - (lastZ.get(character) ?? 0);
      // **All three axes.** An earlier version measured only x and z, and a
      // review broke it in the most pointed way available: a mutation that kept
      // the mark and the horizontal position intact while adding 5 cm to `y`
      // each frame floated every frozen NPC **900 m upwards** over the run, and
      // this check reported "0 occurrences" and passed. Vertical is the one axis
      // this design actually frets about — the freeze is gated on `isAirborne`
      // precisely because a body frozen mid-fall stays under its own floor, and
      // `check:hotel` has fired with seven residents at −16.5 m — so leaving it
      // out was measuring everything except the thing most likely to go wrong.
      const moved = Math.hypot(dx, dy, dz);
      if (moved > 0) {
        frozenMoveCount += 1;
        if (moved > worstFrozenMove) {
          worstFrozenMove = moved;
          worstFrozenWho = character.name;
          worstFrozenAt = frame;
        }
      }
    }

    lastX.set(character, character.position.x);
    lastY.set(character, character.position.y);
    lastZ.set(character, character.position.z);
  }
}

// ------------------------------------------------------------------ verdicts

check(
  spawnedOutside.length === 0,
  `${spawnedOutside.length} park child(ren) spawned outside the garden — ${spawnedOutside.join(', ')}. ` +
    'A child spawned in another space is marked present immediately and then never simulated, ' +
    'never seen and never counted in the park. Children belong on garden waypoints and walk in ' +
    'through the door (#362)',
);

check(
  frozenMoveCount === 0,
  `${frozenMoveCount} times a character inside a space the player is not in moved anyway — worst ` +
    `${worstFrozenMove.toFixed(4)} m by ${worstFrozenWho} at frame ${worstFrozenAt} ` +
    `(measured on all three axes). A marked NPC ` +
    'is not stepped at all, so any movement means something is still simulating them (#362)',
);

check(
  markDisagreements === 0,
  `the mark disagreed with the world on ${markDisagreements} character-frames. First: ` +
    `${firstDisagreement}. A mark that has drifted from where characters actually are is how a ` +
    'frozen NPC gets stepped, or a live one gets frozen',
);

const unbalanced: string[] = [];
for (const character of all) {
  const space = spaceAt(character.position.x, character.position.z);
  if (space !== playerSpace) continue;
  const inn = crossedIn.get(character) ?? 0;
  const out = crossedOut.get(character) ?? 0;
  if (inn !== out) unbalanced.push(`${character.name} in=${inn} out=${out}`);
}
check(
  unbalanced.length === 0,
  `${unbalanced.length} character(s) end the run in the garden with unbalanced crossings — ` +
    `${unbalanced.join(', ')}. Presence must be consistent across a crossing in both directions: ` +
    'somebody counted in and never out has been left behind by the mark',
);

const totalIn = [...crossedIn.values()].reduce((a, b) => a + b, 0);
const totalOut = [...crossedOut.values()].reduce((a, b) => a + b, 0);
check(
  totalIn > 0 && totalOut > 0,
  `nobody crossed in (${totalIn}) or nobody crossed back out (${totalOut}) across ${RUN_SECONDS}s, ` +
    'so assertions 1-3 are vacuously true and this run proves nothing. The castle portals or the ' +
    'visit timer have stopped working',
);

// ------------------------------------------------------------------- report

console.log(
  `${all.length} NPCs, player in ${playerSpace}` +
    (mutate ? ', --mutate: nobody marked' : '') +
    (mutateVertical ? ', --mutate-vertical: marked NPCs lifted 5 cm a frame' : ''),
);
notes.push(`ran ${RUN_SECONDS}s (${FRAMES} frames) at ${DT.toFixed(4)} s/frame`);
notes.push(`frames with somebody marked elsewhere: ${markedFrames} of ${FRAMES}`);
notes.push(`crossings: ${totalIn} in, ${totalOut} out`);
notes.push(
  `movement by characters in another space: ${frozenMoveCount} occurrences` +
    (frozenMoveCount > 0
      ? `, worst ${worstFrozenMove.toFixed(4)} m (${worstFrozenWho}, frame ${worstFrozenAt})`
      : ' (none)'),
);
notes.push(`mark/world disagreements: ${markDisagreements} character-frames`);
notes.push(
  `park children spawned outside the garden: ${spawnedOutside.length}` +
    (spawnedOutside.length > 0 ? ` (${spawnedOutside.join(', ')})` : ' (none)'),
);
for (const note of notes) console.log(`  ${note}`);

if (failures.length > 0) {
  console.error(
    `\nFAIL: somebody is being simulated where the player cannot see them${mutate ? ' (--mutate: expected)' : ''}.`,
  );
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nnpc presence OK');
