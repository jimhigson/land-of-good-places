/**
 * **Does the cat bus arrival actually play?**
 *
 * ```
 * npm run check:cat-bus
 * ```
 *
 * The park's invariant suite asks the other half of this question — *is there a
 * node called `cat-bus` in the built scene?* — and goes red if the wiring from
 * `World` to `Entrance` to `ArrivalSequence` breaks anywhere along its length.
 * That is the check whose absence let PR #27 ship a whole feature as dead code
 * on 26 July 2026 and sit unnoticed for twelve days.
 *
 * But a bus that is *present* and never *moves* would satisfy it. So this drives
 * the real sequence, frame by frame, for its whole length, and measures what
 * actually came out: where the bus went, how far the door really swung, where
 * the children really walked, and — the one that matters most — **exactly where
 * the player was standing when she was handed the controls.**
 *
 * Everything asserted here is read back off the built objects. The door angle is
 * `door-hinge`'s own `rotation.y`, not the argument that was passed to
 * `setDoorOpen`; the bus position is `root.position`, not the tween's input.
 * Measuring the input would pass on a bus whose parts were never wired to it,
 * which is the exact shape of the hood-face bug this repo already paid for once.
 *
 * It asserts **coverage** as well as values, in the spirit of `check:crowd` and
 * `check:ride-camera`: a trace that matches because nothing happened is worse
 * than no trace at all, so the build fails if any phase never ran, if the bus
 * never moved, or if the door never opened.
 */
import './headless-canvas.mjs';
import { writeFileSync } from 'node:fs';
import { Box3, Object3D } from 'three';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import {
  ArrivalSequence,
  ARRIVAL_DURATION,
  ARRIVAL_TIMELINE,
  type ArrivalPhase,
} from '../src/world/entrance/ArrivalSequence.ts';
import {
  ENTRANCE_BUS_ARRIVE_Z,
  ENTRANCE_BUS_STOP_X,
  ENTRANCE_BUS_STOP_Z,
  ENTRANCE_BUS_VANISH_Z,
  ENTRANCE_PLAYER_X,
  ENTRANCE_PLAYER_Z,
} from '../src/world/entrance/layout.ts';
import { saveFlags } from '../src/state/flags.ts';
import type { FrameContext } from '../src/core/types.ts';

const DT = 1 / 60;

const failures: string[] = [];
const notes: string[] = [];

function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

/**
 * Records every call the sequence makes, so the trace can be measured rather
 * than trusted.
 *
 * Deliberately a stand-in and not a real `Player`: what is under test is the
 * *choreography* — the numbers the sequence produces — and a recorder is the
 * only way to assert that she was riding for exactly the right stretch and was
 * put down in exactly the right spot. `Player`'s own end of the contract
 * (`'walking'` posing her with the ordinary walk cycle) is held by
 * `check:climb-wave` and the `applyRidePose` tests.
 */
class RecordingPlayer {
  riding = false;
  ridePosture: 'seated' | 'reclined' | 'walking' = 'seated';
  scriptedWalk = 0;
  readonly poses: { x: number; y: number; z: number; facing: number; posture: string }[] = [];
  teleports: { x: number; y: number; z: number; facing?: number }[] = [];
  beginRides = 0;
  endRides = 0;

  beginRide(): void {
    this.riding = true;
    this.ridePosture = 'seated';
    this.beginRides += 1;
  }

  endRide(): void {
    this.riding = false;
    this.endRides += 1;
  }

  setScriptedWalk(speed: number): void {
    this.scriptedWalk = Math.max(0, speed);
  }

  setRidePose(x: number, y: number, z: number, facing: number): void {
    this.poses.push({ x, y, z, facing, posture: this.ridePosture });
  }

  teleportTo(x: number, y: number, z: number, facing?: number): void {
    const entry: { x: number; y: number; z: number; facing?: number } = { x, y, z };
    if (facing !== undefined) entry.facing = facing;
    this.teleports.push(entry);
  }
}

function frame(elapsed: number, dt = DT): FrameContext {
  return {
    dt,
    elapsed,
    frame: Math.round(elapsed / DT),
    input: null as unknown as FrameContext['input'],
    playerPosition: null as unknown as FrameContext['playerPosition'],
    cameraForward: null as unknown as FrameContext['cameraForward'],
  };
}

function findByName(root: Object3D, name: string): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((object) => {
    if (object.name === name) found = object;
  });
  return found;
}

// --------------------------------------------------------------------- drive

// A fresh player: the arrival is due, and `arrivalIsDue()` must say so.
saveFlags.hydrate({ arrivedByBus: false });

const arrival = new ArrivalSequence();
const player = new RecordingPlayer();
arrival.attachPlayer(player as unknown as Parameters<ArrivalSequence['attachPlayer']>[0]);

check(player.beginRides === 1, `attachPlayer should put her aboard exactly once, got ${player.beginRides}`);
check(arrival.phase === 'rolling-in', `the sequence should open on 'rolling-in', got '${arrival.phase}'`);

const busRoot = findByName(arrival.group, 'cat-bus');
check(busRoot !== null, 'no node named `cat-bus` under the arrival group');
const doorHinge = busRoot ? findByName(busRoot, 'door-hinge') : null;
check(doorHinge !== null, 'the cat bus has no `door-hinge` to swing');

/**
 * The bus's own footprint, measured off the built model while the door is still
 * shut, so the swung-open door does not inflate it.
 *
 * Half-extents rather than a box, because the bus moves: the test below places
 * this rectangle at wherever the bus is parked.
 */
const busBox = busRoot ? new Box3().setFromObject(busRoot) : null;
const busHalfX = busBox ? (busBox.max.x - busBox.min.x) / 2 : 0;
const busHalfZ = busBox ? (busBox.max.z - busBox.min.z) / 2 : 0;

const kidRoots = [findByName(arrival.group, 'entrance-kid-0'), findByName(arrival.group, 'entrance-kid-1')];
check(kidRoots.every((k) => k !== null), 'the two other children are not in the arrival group');

const startZ = busRoot?.position.z ?? NaN;
check(
  Math.abs(startZ - ENTRANCE_BUS_ARRIVE_Z) < 0.01,
  `the bus should start at the gate approach z=${ENTRANCE_BUS_ARRIVE_Z}, found z=${startZ.toFixed(2)}`,
);

const phasesSeen = new Set<ArrivalPhase>();
/**
 * The widest the door swung **while people were getting out of it**.
 *
 * Scoped to those phases on purpose. A plain "widest ever" was the first thing
 * written here and it was worthless: `depart` begins by closing the door from
 * fully open, so its very first frame writes a swing of 1 whatever happened
 * earlier, and the measurement passed on a sequence whose door never opened at
 * all. Measure the door during the phases that need it open.
 */
let doorSwingWhileOpen = 0;
/** The door at rest, at either end — it must start shut and finish shut. */
let doorAtStart = Number.NaN;
let doorAtEnd = Number.NaN;
let minBusZ = Infinity;
let maxBusZ = -Infinity;
let ridingWhileWalkingIn = true;
let posesDuringWalkIn = 0;
/** Where she was standing on the frame the controls were handed over. */
let handoverAt: { x: number; z: number } | null = null;
/** Anyone found walking through the bodywork. */
const clipsThroughBus: string[] = [];
/** The whole trace, for `--trace <path>` to write out and a human to plot. */
const trace: {
  t: number;
  phase: ArrivalPhase;
  bus: readonly [number, number] | null;
  player: readonly [number, number] | null;
  kids: readonly (readonly [number, number] | null)[];
  door: number;
}[] = [];

let elapsed = 0;
// A generous margin past the nominal length, so a sequence that overruns is
// caught by the "did it finish?" assertion rather than by running out of frames.
const frames = Math.ceil((ARRIVAL_DURATION + 2) / DT);
for (let i = 0; i < frames; i += 1) {
  const before = arrival.phase;
  phasesSeen.add(before);

  const teleportsBefore = player.teleports.length;
  arrival.update(frame(elapsed));
  elapsed += DT;

  if (busRoot) {
    minBusZ = Math.min(minBusZ, busRoot.position.z);
    maxBusZ = Math.max(maxBusZ, busRoot.position.z);
  }
  if (doorHinge) {
    const swing = Math.abs(doorHinge.rotation.y);
    if (i === 0) doorAtStart = swing;
    doorAtEnd = swing;
    if (
      before === 'doors-opening' ||
      before === 'kids-off' ||
      before === 'stepping-down' ||
      before === 'walking-in'
    ) {
      doorSwingWhileOpen = Math.max(doorSwingWhileOpen, swing);
    }
  }
  if (before === 'walking-in') {
    posesDuringWalkIn += 1;
    if (!player.riding) ridingWhileWalkingIn = false;
  }
  if (player.teleports.length > teleportsBefore && handoverAt === null) {
    const last = player.teleports[player.teleports.length - 1];
    if (last) handoverAt = { x: last.x, z: last.z };
  }

  // Nobody may walk through the parked bus. The drop-off is on the curb side
  // and the place gameplay starts is on the other side of the bus, so the walk
  // in has to go round its nose — a route that is easy to get subtly wrong and
  // invisible in a diff. Only tested while the bus is actually standing still
  // at the stop, since that is the only time anybody is walking beside it.
  const busHere = busRoot?.position;
  if (busHere && Math.abs(busHere.z - ENTRANCE_BUS_STOP_Z) < 0.05) {
    const walkers: { name: string; x: number; z: number }[] = [];
    const lastPose = player.poses[player.poses.length - 1];
    // The player is exempt while she is *stepping down*, and only then: she
    // starts that phase sitting in the cabin and ends it on the curb, so she
    // passes through the doorway on the way — and a bounding box has no
    // doorway in it. Catching her there would be catching the check's own
    // crudeness, not a bug. From the walk in onwards she must be clear of the
    // bodywork, which is the case this is actually here to guard: the curb is
    // on one side of the bus and the place gameplay starts is on the other.
    if (lastPose && before === 'walking-in') {
      walkers.push({ name: 'the player', x: lastPose.x, z: lastPose.z });
    }
    kidRoots.forEach((kid, index) => {
      if (kid && kid.visible) walkers.push({ name: `child ${index}`, x: kid.position.x, z: kid.position.z });
    });
    for (const walker of walkers) {
      const insideX = Math.abs(walker.x - busHere.x) < busHalfX - PLAYER_RADIUS * 0.5;
      const insideZ = Math.abs(walker.z - busHere.z) < busHalfZ - PLAYER_RADIUS * 0.5;
      if (insideX && insideZ) {
        clipsThroughBus.push(
          `${walker.name} is inside the parked bus at ${walker.x.toFixed(2)}, ${walker.z.toFixed(2)} ` +
            `(bus centre ${busHere.x.toFixed(2)}, ${busHere.z.toFixed(2)}, ` +
            `half-extents ${busHalfX.toFixed(2)} x ${busHalfZ.toFixed(2)})`,
        );
      }
    }
  }

  trace.push({
    t: +elapsed.toFixed(3),
    phase: before,
    bus: busRoot ? [+busRoot.position.x.toFixed(3), +busRoot.position.z.toFixed(3)] : null,
    player: (() => {
      const p = player.poses[player.poses.length - 1];
      return p ? [+p.x.toFixed(3), +p.z.toFixed(3)] : null;
    })(),
    kids: kidRoots.map((k) =>
      k && k.visible ? [+k.position.x.toFixed(3), +k.position.z.toFixed(3)] : null,
    ),
    door: doorHinge ? +Math.abs(doorHinge.rotation.y).toFixed(3) : 0,
  });

  if (arrival.finished) break;
}

// ------------------------------------------------------------------ measure

check(arrival.finished, 'the sequence never finished inside its own advertised duration');

for (const phase of [
  'rolling-in',
  'doors-opening',
  'kids-off',
  'stepping-down',
  'walking-in',
  'departing',
] as const) {
  check(phasesSeen.has(phase), `the '${phase}' phase never ran — the sequence skipped it`);
}

// The bus really travelled, in both directions, over its real span.
check(
  minBusZ <= ENTRANCE_BUS_STOP_Z + 0.05,
  `the bus never reached the stop at z=${ENTRANCE_BUS_STOP_Z}; closest was ${minBusZ.toFixed(2)}`,
);
check(
  maxBusZ >= ENTRANCE_BUS_VANISH_Z - 0.05,
  `the bus never drove back out to z=${ENTRANCE_BUS_VANISH_Z}; furthest was ${maxBusZ.toFixed(2)}`,
);
const travelled = maxBusZ - minBusZ;
check(travelled > 5, `the bus only moved ${travelled.toFixed(2)} m in total — it barely went anywhere`);

// The door actually swung, measured on the hinge rather than on the setter, and
// only across the phases during which anybody is trying to get out of it.
check(
  doorSwingWhileOpen > 1.5,
  `the door only reached ${doorSwingWhileOpen.toFixed(2)} rad while people were getting out — ` +
    'nobody could get through that',
);
check(doorAtStart < 0.01, `the bus arrives with its door already ${doorAtStart.toFixed(2)} rad open`);
check(doorAtEnd < 0.01, `the bus drives away with its door ${doorAtEnd.toFixed(2)} rad open`);

// She was carried for the whole sequence, and let go exactly once.
check(player.endRides === 1, `she should be handed the controls exactly once, got ${player.endRides}`);
check(ridingWhileWalkingIn, 'she was not under the sequence’s control during the walk in');
check(posesDuringWalkIn > 30, `only ${posesDuringWalkIn} frames of walking in — too short to read`);

// The one that matters: where she is standing when the game becomes hers.
check(handoverAt !== null, 'she was never put down anywhere — no teleport on hand-over');
if (handoverAt) {
  const drift = Math.hypot(handoverAt.x - ENTRANCE_PLAYER_X, handoverAt.z - ENTRANCE_PLAYER_Z);
  check(
    drift < 0.01,
    `she is handed the controls at ${handoverAt.x.toFixed(2)}, ${handoverAt.z.toFixed(2)} — ` +
      `${drift.toFixed(2)} m from ENTRANCE_PLAYER_X/Z, which is where check:park measures ` +
      'every route from and where Game.DEFAULT_SPAWN puts her',
  );
  notes.push(
    `handed over at ${handoverAt.x.toFixed(2)}, ${handoverAt.z.toFixed(2)} ` +
      `(ENTRANCE_PLAYER_X/Z, drift ${drift.toFixed(4)} m)`,
  );
}

// Nobody walked through the bodywork on the way in.
if (clipsThroughBus.length > 0) {
  failures.push(
    `${clipsThroughBus.length} frames with somebody inside the parked bus, e.g. ${clipsThroughBus[0]}`,
  );
} else {
  notes.push('nobody walks through the parked bus — the route goes round its nose');
}

// The other children genuinely walk in, rather than appearing and standing
// still — "alongside several other children" is half of what was asked for.
kidRoots.forEach((kid, index) => {
  const seen = trace.map((f) => f.kids[index]).filter((p): p is readonly [number, number] => !!p);
  const first = seen[0];
  const last = seen[seen.length - 1];
  if (!first || !last) {
    failures.push(`child ${index} was never visible at any point in the sequence`);
    return;
  }
  const walked = Math.hypot(last[0] - first[0], last[1] - first[1]);
  check(walked > 2, `child ${index} only moved ${walked.toFixed(2)} m — they barely got off the bus`);
  check(
    last[1] < ENTRANCE_BUS_STOP_Z,
    `child ${index} finishes at z=${last[1].toFixed(2)}, no further into the park than the bus`,
  );
  notes.push(`child ${index} walked ${walked.toFixed(2)} m, finishing at ${last[0].toFixed(2)}, ${last[1].toFixed(2)}`);
});

// And the flag that stops it happening twice is set by the sequence itself.
check(saveFlags.arrivedByBus, 'markArrived() never fired — the arrival would replay for ever');

// She walks rather than being slid along: the posture actually changes.
const walkingPoses = player.poses.filter((p) => p.posture === 'walking').length;
const seatedPoses = player.poses.filter((p) => p.posture === 'seated').length;
check(seatedPoses > 60, `only ${seatedPoses} seated frames — she barely rode the bus at all`);
check(walkingPoses > 60, `only ${walkingPoses} walking frames — she never really walked in`);

notes.push(`bus travelled ${travelled.toFixed(2)} m, z ${maxBusZ.toFixed(1)} down to ${minBusZ.toFixed(1)}`);
notes.push(
  `door swung to ${doorSwingWhileOpen.toFixed(2)} rad while unloading, shut at both ends`,
);
notes.push(`${seatedPoses} frames riding, ${walkingPoses} frames walking`);
notes.push(
  `phases: ${[...phasesSeen].join(' -> ')} over ${ARRIVAL_DURATION.toFixed(1)} s ` +
    `(roll-in ${ARRIVAL_TIMELINE.rollingIn} s)`,
);

// ------------------------------------------------------------------- report

// `--trace <path>` dumps the whole run for a human to plot. Not part of the
// check; it exists because this sequence has no deep link and nobody can watch
// it without starting a brand-new game, so a plan view of the real numbers is
// the cheapest way to look at the staging.
const traceFlag = process.argv.indexOf('--trace');
if (traceFlag !== -1) {
  const path = process.argv[traceFlag + 1];
  if (path) {
    writeFileSync(path, JSON.stringify({ busHalfX, busHalfZ, frames: trace }, null, 1));
    notes.push(`trace written to ${path} (${trace.length} frames)`);
  }
}

for (const note of notes) console.log(`  ${note}`);
if (failures.length > 0) {
  console.error('\nFAIL: the cat bus arrival did not play as it should.');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nPASS: the cat bus arrives, opens up, lets everyone out and drives away.');
