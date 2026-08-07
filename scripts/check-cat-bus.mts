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
import { Box3, Object3D, Vector3 } from 'three';
import { PLAYER_RADIUS } from '../src/core/constants.ts';
import {
  ArrivalSequence,
  ARRIVAL_DURATION,
  ARRIVAL_KID_COUNT,
  ARRIVAL_TIMELINE,
  type ArrivalPhase,
} from '../src/world/entrance/ArrivalSequence.ts';
import {
  ENTRANCE_BUS_ARRIVE_X,
  ENTRANCE_BUS_STOP_Z,
  ENTRANCE_BUS_VANISH_X,
  ENTRANCE_GATE_Z,
  ENTRANCE_PLAYER_X,
  ENTRANCE_PLAYER_Z,
} from '../src/world/entrance/layout.ts';
import { CAT_BUS_SEAT_COUNT, createCatBus } from '../src/world/entrance/catBus.ts';
import { TALLEST_CHILD_HEIGHT } from '../src/art/models/kid.ts';
import { PARK_BOUNDARY } from '../src/world/boundary.ts';
import { isInEntranceGateGap } from '../src/world/entrance/layout.ts';
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
const busBoxNow = new Box3();
const busBox = busRoot ? new Box3().setFromObject(busRoot) : null;
const busHalfX = busBox ? (busBox.max.x - busBox.min.x) / 2 : 0;
const busHalfZ = busBox ? (busBox.max.z - busBox.min.z) / 2 : 0;

// Every other child, found by name off the built scene rather than assumed.
const kidRoots: (Object3D | null)[] = [];
for (let i = 0; i < ARRIVAL_KID_COUNT; i += 1) {
  kidRoots.push(findByName(arrival.group, `entrance-kid-${i}`));
}
check(
  kidRoots.every((k) => k !== null),
  `only ${kidRoots.filter(Boolean).length} of ${ARRIVAL_KID_COUNT} other children were built`,
);

/**
 * **World position, not local.** A child still in their seat is a descendant of
 * the bus, so `.position` is an offset inside the cabin — reading it as a world
 * point put children tens of metres from where they actually were and made
 * "child 0 walked 49 m" out of a nineteen-metre walk.
 */
const WHERE = new Vector3();
const worldXZ = (object: Object3D): readonly [number, number] => {
  object.getWorldPosition(WHERE);
  return [WHERE.x, WHERE.z] as const;
};

const startX = busRoot?.position.x ?? NaN;
check(
  Math.abs(startX - ENTRANCE_BUS_ARRIVE_X) < 0.01,
  `the bus should start on the kerb at x=${ENTRANCE_BUS_ARRIVE_X}, found x=${startX.toFixed(2)}`,
);

// **Sampled before the run, not after.** The children leave their seats during
// the sequence and are disposed at the end, so counting occupants afterwards
// counts an empty bus — which is exactly what the first version of this check
// did, and it duly reported "0 of 12".
const seatNodes: Object3D[] = [];
if (busRoot) {
  busRoot.traverse((object) => {
    if (/^cat-bus-seat-\d+$/.test(object.name)) seatNodes.push(object);
  });
}
const occupied = seatNodes.filter((seat) => {
  let found = false;
  seat.traverse((o) => {
    if (/^entrance-kid-/.test(o.name)) found = true;
  });
  return found;
}).length;

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
let minBusX = Infinity;
let maxBusX = -Infinity;
/** The deepest any part of the bus ever got, as a distance inside the park edge. */
let deepestIntoPark = -Infinity;
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
    minBusX = Math.min(minBusX, busRoot.position.x);
    maxBusX = Math.max(maxBusX, busRoot.position.x);
    // **Did any part of the bus get inside the park?** Measured on the built
    // bounding box every frame, against the real boundary outline — not against
    // the stop position it was told to drive to. This is the frame-by-frame
    // form of Jim's "the bus drives something like 5 m into the park".
    busBoxNow.setFromObject(busRoot);
    for (const cx of [busBoxNow.min.x, busBoxNow.max.x]) {
      for (const cz of [busBoxNow.min.z, busBoxNow.max.z]) {
        deepestIntoPark = Math.max(deepestIntoPark, PARK_BOUNDARY.distanceToEdge(cx, cz));
      }
    }
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
      if (!kid || !kid.visible || kid.parent !== arrival.group) return;
      const [kx, kz] = worldXZ(kid);
      walkers.push({ name: `child ${index}`, x: kx, z: kz });
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
    // Only once they are walking in the world, not while seated in the bus.
    kids: kidRoots.map((k) => (k && k.visible && k.parent === arrival.group ? worldXZ(k) : null)),
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

// **The bus never enters the park.** `distanceToEdge` is positive inside the
// boundary, so anything above zero is a bus where a bus should not be.
check(
  deepestIntoPark < 0,
  `the bus reached ${deepestIntoPark.toFixed(2)} m INSIDE the park boundary — it is a bus, ` +
    'it belongs on the road outside the gate',
);
notes.push(
  `closest the bus ever got to the park edge: ${(-deepestIntoPark).toFixed(2)} m outside it`,
);

// It really travelled, along the kerb, over its real span.
check(
  minBusX <= ENTRANCE_BUS_VANISH_X + 0.05,
  `the bus never drove away to x=${ENTRANCE_BUS_VANISH_X}; furthest was ${minBusX.toFixed(2)}`,
);
check(
  maxBusX >= ENTRANCE_BUS_ARRIVE_X - 0.05,
  `the bus never started out at x=${ENTRANCE_BUS_ARRIVE_X}; furthest was ${maxBusX.toFixed(2)}`,
);
const travelled = maxBusX - minBusX;
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

// --- twelve seats, with children on them --------------------------------
// Measured off the bus that was built, not restated from CAT_BUS_SEAT_COUNT.
check(
  seatNodes.length === CAT_BUS_SEAT_COUNT,
  `found ${seatNodes.length} seats on the built bus, expected ${CAT_BUS_SEAT_COUNT}`,
);
// Eleven, not twelve: the player has the other one, and she is not built here.
check(
  occupied === CAT_BUS_SEAT_COUNT - 1,
  `${occupied} of ${CAT_BUS_SEAT_COUNT} seats had a child on them at the start ` +
    '(one is the player\u2019s, so eleven is right)',
);
notes.push(`${seatNodes.length} seats, ${occupied} with a child on them plus the player\u2019s`);

// --- big enough to be a bus ---------------------------------------------
// Thresholds from the children, not from a literal, so they stay true if the
// characters are ever resized. Jim: "barely bigger than a child, and smaller
// vertically than one child with a hat".
{
  const fresh = createCatBus();
  fresh.root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(fresh.root);
  const tall = box.max.y - box.min.y;
  check(
    tall > TALLEST_CHILD_HEIGHT * 1.4,
    `the bus is ${tall.toFixed(2)} m tall against a ${TALLEST_CHILD_HEIGHT} m child in a hat — ` +
      'that is a shed, not a bus',
  );
  check(
    tall < TALLEST_CHILD_HEIGHT * 2.6,
    `the bus is ${tall.toFixed(2)} m tall, which is more than two and a half children — too big`,
  );

  // A child has to be able to stand where they are sitting, and get out.
  const seatTop = new Vector3();
  const firstSeat = fresh.seats[0];
  if (firstSeat) {
    firstSeat.getWorldPosition(seatTop);
    const overhead = box.max.y - seatTop.y;
    check(
      overhead > TALLEST_CHILD_HEIGHT,
      `only ${overhead.toFixed(2)} m from a seat to the top of the bus — a ` +
        `${TALLEST_CHILD_HEIGHT} m child does not fit on it`,
    );
    notes.push(`seat to roof: ${overhead.toFixed(2)} m for a ${TALLEST_CHILD_HEIGHT} m child`);
  }

  const hinge = findByName(fresh.root, 'door-hinge');
  if (hinge) {
    const doorBox = new Box3().setFromObject(hinge);
    const doorTall = doorBox.max.y - doorBox.min.y;
    check(
      doorTall > TALLEST_CHILD_HEIGHT,
      `the door is ${doorTall.toFixed(2)} m tall — a ${TALLEST_CHILD_HEIGHT} m child cannot ` +
        'walk out of it',
    );
    notes.push(`door opening ${doorTall.toFixed(2)} m tall`);
  }
  fresh.dispose();
}

// --- nobody walks through the wall --------------------------------------
// Everyone crosses the boundary at z = ENTRANCE_GATE_Z on their way in. That
// crossing has to happen inside the opening the masonry actually leaves (#195),
// or they are walking through pink stone — the same fault as the bus, at a
// smaller scale.
{
  const throughWall: string[] = [];
  const crossers = new Map<string, { x: number; z: number } | null>();
  for (let i = 1; i < trace.length; i += 1) {
    const before = trace[i - 1];
    const now = trace[i];
    if (!before || !now) continue;
    const pairs: [string, readonly [number, number] | null, readonly [number, number] | null][] = [
      ['the player', before.player, now.player],
      ...now.kids.map(
        (k, n) =>
          [`child ${n}`, before.kids[n] ?? null, k] as [
            string,
            readonly [number, number] | null,
            readonly [number, number] | null,
          ],
      ),
    ];
    for (const [who, was, is] of pairs) {
      if (!was || !is) continue;
      const crossed = (was[1] - ENTRANCE_GATE_Z) * (is[1] - ENTRANCE_GATE_Z) < 0;
      if (!crossed) continue;
      crossers.set(who, { x: is[0], z: is[1] });
      if (!isInEntranceGateGap(Math.atan2(is[1], is[0]))) {
        throughWall.push(`${who} crossed the boundary at x=${is[0].toFixed(2)}, outside the gate gap`);
      }
    }
  }
  if (throughWall.length > 0) {
    failures.push(`${throughWall.length} wall crossings outside the gate, e.g. ${throughWall[0]}`);
  } else {
    notes.push(`${crossers.size} walkers crossed the boundary, every one through the gate`);
  }
  check(crossers.size > 0, 'nobody ever crossed the park boundary — nobody actually walked in');
}

// --- they get off at different times, and do not march in a line ---------
// Jim, watching twelve arrive: "make the children all get off at different
// times, and then walk into the park, currently they all move exactly in a
// line". Both halves are asserted here, because both were true.
{
  /** The first frame each child was out in the world, by index. */
  const startedAt = new Map<number, number>();
  for (const f of trace) {
    f.kids.forEach((k, n) => {
      if (k && !startedAt.has(n)) startedAt.set(n, f.t);
    });
  }
  check(
    startedAt.size === ARRIVAL_KID_COUNT,
    `only ${startedAt.size} of ${ARRIVAL_KID_COUNT} children ever got off the bus`,
  );

  const times = [...startedAt.values()].sort((a, b) => a - b);
  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? 0;
  check(
    last - first > 2,
    `every child was off the bus within ${(last - first).toFixed(2)} s of the first — ` +
      'they unloaded like cargo rather than getting off at different times',
  );
  // And no two share a moment, which a naive "stagger" by even division does.
  let sameMoment = 0;
  for (let i = 1; i < times.length; i += 1) {
    if (Math.abs((times[i] ?? 0) - (times[i - 1] ?? 0)) < 0.08) sameMoment += 1;
  }
  check(sameMoment === 0, `${sameMoment} pairs of children stepped down at the same moment`);
  notes.push(
    `children got off over ${(last - first).toFixed(1)} s, no two within 0.08 s of each other`,
  );

  // **Not in a line.** For every frame, how far apart are the two closest
  // children? If they are walking in formation this stays pinned at the
  // spacing they were given and never varies; real children bunch and string
  // out. Measuring the *variation* catches a rigid formation that happens to
  // be widely spaced, which a bare minimum-distance test would pass.
  const spreads: number[] = [];
  for (const f of trace) {
    const here = f.kids.filter((k): k is readonly [number, number] => !!k);
    if (here.length < 3) continue;
    let closest = Infinity;
    for (let i = 0; i < here.length; i += 1) {
      for (let j = i + 1; j < here.length; j += 1) {
        const a = here[i];
        const b = here[j];
        if (!a || !b) continue;
        closest = Math.min(closest, Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
    }
    if (Number.isFinite(closest)) spreads.push(closest);
  }
  check(spreads.length > 30, `only ${spreads.length} frames with three or more children walking`);
  if (spreads.length > 0) {
    const lo = Math.min(...spreads);
    const hi = Math.max(...spreads);
    check(
      hi - lo > 0.5,
      `the closest pair of children stayed ${lo.toFixed(2)}–${hi.toFixed(2)} m apart all the ` +
        'way in — that is a formation, not a group of children',
    );
    check(lo > 0.25, `two children came within ${lo.toFixed(2)} m — they are walking through each other`);
    notes.push(`closest pair varied ${lo.toFixed(2)}–${hi.toFixed(2)} m — not a formation`);
  }

  // No two children may walk the same route, however staggered in time.
  let identical = 0;
  for (let i = 0; i < ARRIVAL_KID_COUNT; i += 1) {
    for (let j = i + 1; j < ARRIVAL_KID_COUNT; j += 1) {
      const a = trace.map((f) => f.kids[i]).filter(Boolean).pop();
      const b = trace.map((f) => f.kids[j]).filter(Boolean).pop();
      if (a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.3) identical += 1;
    }
  }
  check(identical === 0, `${identical} pairs of children finished in the same spot`);
}

// And the flag that stops it happening twice is set by the sequence itself.
check(saveFlags.arrivedByBus, 'markArrived() never fired — the arrival would replay for ever');

// She walks rather than being slid along: the posture actually changes.
const walkingPoses = player.poses.filter((p) => p.posture === 'walking').length;
const seatedPoses = player.poses.filter((p) => p.posture === 'seated').length;
check(seatedPoses > 60, `only ${seatedPoses} seated frames — she barely rode the bus at all`);
check(walkingPoses > 60, `only ${walkingPoses} walking frames — she never really walked in`);

notes.push(`bus travelled ${travelled.toFixed(2)} m along the kerb, x ${maxBusX.toFixed(1)} to ${minBusX.toFixed(1)}`);
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
