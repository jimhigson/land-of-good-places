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
 * The performance case for that is weak and this file should say so plainly:
 * measured before the work was designed, simulating every off-space NPC costs
 * **0.147 ms a frame** — about 0.9% of a 60 Hz budget. Nobody should build a
 * level-of-detail system for that, and nobody did.
 *
 * The case that matters is **correctness**, and it was paid for in #350.
 * Children who walk into the castle stand at interior coordinates six hundred
 * metres from the park, and while they were live agents there, every
 * measurement over "the crowd" had to remember to exclude them. One did not:
 * the dispersal check read an RMS of **276 m — 476% of a uniform scatter over
 * the whole park — and passed**. An impossible number going green means the
 * metric had stopped meaning anything. `check:jitter` caught the same root from
 * the other side, as an 810 m single-frame step.
 *
 * Marking presence deletes that whole class: a marked NPC does not move, so
 * there is nothing for a distant coordinate to corrupt. This check is what
 * keeps it deleted.
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
const lastZ = new Map<NpcCharacter, number>();
const lastSpace = new Map<NpcCharacter, string>();
for (const c of all) {
  lastX.set(c, c.position.x);
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

    // 1. nobody in an interior the player is not in moves
    if (space !== playerSpace && space !== SPACE_GARDEN) {
      const dx = character.position.x - (lastX.get(character) ?? 0);
      const dz = character.position.z - (lastZ.get(character) ?? 0);
      const moved = Math.hypot(dx, dz);
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
    `${worstFrozenMove.toFixed(4)} m by ${worstFrozenWho} at frame ${worstFrozenAt}. A marked NPC ` +
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

console.log(`${all.length} NPCs, player in ${playerSpace}${mutate ? ', --mutate: nobody marked' : ''}`);
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
