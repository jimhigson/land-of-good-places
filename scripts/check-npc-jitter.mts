/**
 * **Nobody in the crowd may vibrate.**
 *
 * ```
 * npm run check:jitter            # or --verbose for the per-frame worst list
 * ```
 *
 * A child's position has exactly one owner at a time. When two things own it,
 * they fight, and the child flickers between two places every frame — which is
 * the shape of the bug this file was written for: a train rider whose x and z
 * were written by `ParkTrain.carryPassengers` *and* integrated by their own
 * `NpcCharacter.move()`, ping-ponging 73 metres a frame between the seat and a
 * point beside the rail fence. See `NpcCharacter.setCarriedPose` for the whole
 * chain.
 *
 * The check is a measurement of the **real** park, in the spirit of
 * `check-park.mts` and `measure-hop-clearance.mts`: the actual `World`, built
 * headlessly by `park-harness.mts`, driven through `World.update` at a fixed
 * 60 Hz with the real train, the real collision world and the real crowd.
 * Nothing here models anything.
 *
 * ## The two bounds
 *
 * Both are about a child's **own** movement, measured after
 * `carryPassengers` has had its say — so boarding, which is a legitimate
 * teleport into a seat several metres away, is not mistaken for a fault.
 *
 * 1. **{@link MAX_OWN_STEP}** — how far a child may move themselves in one
 *    frame. Walking is 4.25 cm at 60 Hz (`NPC_WALK_SPEED * dt`); the only
 *    other legitimate mover is `NpcSystem.separate`, which relaxes an overlap
 *    by at most half of it and so cannot exceed `NPC_RADIUS`.
 * 2. **{@link MAX_SPEED}** — the fastest a child may ever be going.
 *    `NPC_WALK_SPEED * RUN_INTENT` = 4.46 m/s is flat out. This is the sharper
 *    of the two: the bug's whole signature was `velocity` ratcheting upwards
 *    frame after frame, because `move()`'s "trust the resolved position"
 *    rewrite banked somebody else's write as speed the child had asked for.
 *
 * Neither is a tuning knob. If the crowd is ever meant to move faster than
 * this, raise the bound *and* say which behaviour needs it.
 */
import './headless-canvas.mjs';
import { Vector3 } from 'three';
import { buildHeadlessPark, quietly } from './park-harness.mts';
import { InputSystem } from '../src/core/input/InputSystem.ts';
import { ENTRANCE_PLAYER_X, ENTRANCE_PLAYER_Z } from '../src/world/entrance/layout.ts';
import { NPC_RADIUS } from '../src/entities/npc/NpcCharacter.ts';
import type { FrameContext } from '../src/core/types.ts';

const DT = 1 / 60;

/**
 * Long enough for children to walk out to a station, wait, board and ride.
 *
 * Two and a half minutes of park. The first trip in this seed starts around
 * frame 3400 and the runaway was unmistakable within a dozen frames of it, so
 * this leaves several boardings of margin without costing the build a second.
 */
const FRAMES = 9_000;

/** Metres a child may move under their own steam in one frame. See the header. */
const MAX_OWN_STEP = NPC_RADIUS * 2;

/** Metres per second a child may ever be going. See the header. */
const MAX_SPEED = 8;

const verbose = process.argv.includes('--verbose');

const { world } = buildHeadlessPark();

const input = new InputSystem();
// Stood at the entrance, where a child arrives and where the family starts
// every session. Deliberately *not* beside a station: the crowd's far-LOD
// (`NpcSystem.FAR_DISTANCE`) then runs the station children at half rate,
// which is the awkward case rather than the flattering one.
const playerPosition = new Vector3(ENTRANCE_PLAYER_X, 0, ENTRANCE_PLAYER_Z);
const cameraForward = new Vector3(0, 0, 1);

const characters = world.npcs.riders;
const stations = world.train.stations.map((station) => ({
  name: station.name,
  x: station.standX,
  z: station.standZ,
}));

/** Where the train left each child, so "their own movement" can be isolated. */
const carriedX = new Float64Array(characters.length);
const carriedZ = new Float64Array(characters.length);

interface Failure {
  readonly frame: number;
  readonly name: string;
  readonly what: string;
  readonly measured: number;
  readonly bound: number;
  readonly where: string;
}
const failures: Failure[] = [];

let worstStep = 0;
let worstStepWho = '';
let worstSpeed = 0;
let worstSpeedWho = '';
/** The nearest station, when a child is close enough for one to be the story. */
function nearStation(x: number, z: number): string {
  for (const station of stations) {
    if (Math.hypot(station.x - x, station.z - z) < 14) return ` near ${station.name}`;
  }
  return '';
}

// A child stepping through the castle's door is the *other* declared write —
// issue #350. It is a genuine jump: the garden and the castle interior are six
// hundred metres apart, so crossing between them is a portal rather than a walk
// (`entities/npc/portals.ts`), and one frame legitimately moves a child that
// far. Re-baselined here exactly as a train carry is, and for the same reason:
// this checker's question is "did something move a child while their own
// movement code fought it", and a declared step through a door is neither
// undeclared nor fought.
//
// Note what this does NOT do: it re-baselines only on the frame
// `stepThroughDoor` is actually called. A child who jumped six hundred metres
// any other way still fails, which is the whole point — the exemption is tied
// to the declaration, not to the distance or to the child.
for (let i = 0; i < characters.length; i += 1) {
  const character = characters[i]!;
  const step = character.stepThroughDoor.bind(character);
  const index = i;
  character.stepThroughDoor = (x: number, y: number, z: number, facing: number) => {
    step(x, y, z, facing);
    carriedX[index] = character.position.x;
    carriedZ[index] = character.position.z;
  };
}

// The train is the one thing outside `NpcSystem` that writes a child's x/z, so
// its write is where "somebody else moved them" ends and "they moved
// themselves" begins.
const train = world.train;
const carry = train.carryPassengers.bind(train);
train.carryPassengers = (riders) => {
  carry(riders);
  for (let i = 0; i < characters.length; i += 1) {
    carriedX[i] = characters[i]!.position.x;
    carriedZ[i] = characters[i]!.position.z;
  }
};

for (let frame = 0; frame < FRAMES; frame += 1) {
  for (let i = 0; i < characters.length; i += 1) {
    carriedX[i] = characters[i]!.position.x;
    carriedZ[i] = characters[i]!.position.z;
  }

  const context: FrameContext = {
    dt: DT,
    elapsed: frame * DT,
    input,
    playerPosition,
    cameraForward,
    frame,
  };
  // The park says things as it runs (a driver giving up on a walk, say). None
  // of it is this checker's finding, so it is collected rather than scrolled.
  quietly(() => world.update(context));

  for (let i = 0; i < characters.length; i += 1) {
    const character = characters[i]!;
    const { x, z } = character.position;
    const dx = x - carriedX[i]!;
    const dz = z - carriedZ[i]!;
    const step = Math.hypot(dx, dz);
    const speed = Math.hypot(character.velocity.x, character.velocity.z);
    const where = `(${x.toFixed(2)}, ${z.toFixed(2)})${nearStation(x, z)}`;

    if (step > worstStep) {
      worstStep = step;
      worstStepWho = character.name;
    }
    if (speed > worstSpeed) {
      worstSpeed = speed;
      worstSpeedWho = character.name;
    }

    if (step > MAX_OWN_STEP) {
      failures.push({ frame, name: character.name, what: 'own step', measured: step, bound: MAX_OWN_STEP, where });
    }
    if (speed > MAX_SPEED) {
      failures.push({ frame, name: character.name, what: 'speed', measured: speed, bound: MAX_SPEED, where });
    }
  }
}

const seconds = (FRAMES * DT).toFixed(0);
console.log(
  `check:jitter — ${characters.length} children, ${FRAMES} frames (${seconds} s of park) at ${(1 / DT).toFixed(0)} Hz`,
);
console.log(`  worst own step : ${worstStep.toFixed(3)} m (${worstStepWho})   bound ${MAX_OWN_STEP} m`);
console.log(`  worst speed    : ${worstSpeed.toFixed(3)} m/s (${worstSpeedWho})   bound ${MAX_SPEED} m/s`);

if (verbose) {
  for (const failure of failures.slice(0, 40)) {
    console.log(
      `  f${String(failure.frame).padStart(6)} ${failure.name.padEnd(8)} ${failure.what} ` +
        `${failure.measured.toFixed(3)} > ${failure.bound} at ${failure.where}`,
    );
  }
}

if (failures.length > 0) {
  const first = failures[0]!;
  console.error(
    `\ncheck:jitter FAILED — ${failures.length} violations across ${FRAMES} frames.\n` +
      `  first: frame ${first.frame}, ${first.name}, ${first.what} ${first.measured.toFixed(3)} ` +
      `(bound ${first.bound}) at ${first.where}\n` +
      '\n' +
      'Something other than the child is writing their position, and their own\n' +
      'movement code is fighting it. `NpcCharacter.setCarriedPose` is how a ride\n' +
      'takes a child over properly; re-run with --verbose for the full list.',
  );
  process.exit(1);
}
