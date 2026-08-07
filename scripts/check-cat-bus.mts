/**
 * **Does the cat bus arrival actually play, and are the children still there
 * afterwards?**
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
 * ## What changed on 7 August, and why this file was rewritten
 *
 * The previous version drove a bare `new ArrivalSequence()` with a recording
 * stub for a player, and asserted things like *"twelve seats exist and eleven
 * have a child parented into them"*. Every one of those assertions passed on the
 * build Jim then watched, in which:
 *
 * - the children **vanished** the moment the sequence ended;
 * - they walked at 1.5 m/s in a park whose walking speed is 2.55;
 * - they **overlapped each other**, because the push-apart was overwritten by
 *   the next frame's curve evaluation before it could ever be seen;
 * - twelve children sat in a bus **0.52 m inside one another** and 0.10-0.24 m
 *   through its bodywork;
 * - the camera opened on the middle of the park.
 *
 * A check that counts seats cannot see any of that. So this one:
 *
 * 1. drives the **real `World`**, built by `buildHeadlessPark()` — the same
 *    wiring the game runs, including `World.update`'s ordering, the real
 *    `NpcSystem`, and the real 24-strong crowd the eleven passengers come from;
 * 2. keeps running for a further **thirty seconds after the arrival ends**, and
 *    measures the children then. "Are they still here, and are they behaving
 *    like the park's other children?" is the question the old check could not
 *    even ask, because its children were not the park's;
 * 3. takes every threshold from a **measured** property of the built model —
 *    `CHILD_FOOTPRINT`, `NPC_WALK_SPEED` — never from a literal.
 *
 * Everything asserted here is read back off the built objects. The door angle is
 * `door-hinge`'s own `rotation.y`, not the argument passed to `setDoorOpen`.
 */
import './headless-canvas.mjs';
import { Box3, InstancedMesh, Matrix4, Object3D, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import {
  ARRIVAL_CONTROL_AT,
  ARRIVAL_DURATION,
  ARRIVAL_KID_COUNT,
  type ArrivalPhase,
} from '../src/world/entrance/ArrivalSequence.ts';
import {
  ENTRANCE_BUS_ARRIVE_X,
  ENTRANCE_BUS_STOP_Z,
  ENTRANCE_BUS_VANISH_X,
  ENTRANCE_GATE_Z,
  ENTRANCE_PLAYER_X,
  ENTRANCE_PLAYER_Z,
  isInEntranceGateGap,
} from '../src/world/entrance/layout.ts';
import { CAT_BUS_SEAT_COUNT, createCatBus } from '../src/world/entrance/catBus.ts';
import {
  CHILD_FOOTPRINT,
  TALLEST_CHILD_HEIGHT,
  WIDEST_CHILD_FOOTPRINT,
  createKid,
} from '../src/art/models/kid.ts';
import { NPC_WALK_SPEED } from '../src/entities/npc/NpcCharacter.ts';
import { arrivalOwnsTheSpawn } from '../src/world/entrance/arrivalSpawn.ts';
import { PARK_BOUNDARY, edgeRadiusAt } from '../src/world/boundary.ts';
import { saveFlags } from '../src/state/flags.ts';
import type { FrameContext } from '../src/core/types.ts';
import type { Player } from '../src/entities/Player.ts';

const DT = 1 / 60;

/** How long to keep watching after the cutscene ends. */
const AFTERWARDS_SECONDS = 30;

const failures: string[] = [];
const notes: string[] = [];

function check(ok: boolean, message: string): void {
  if (!ok) failures.push(message);
}

class RecordingPlayer {
  riding = false;
  ridePosture: 'seated' | 'reclined' | 'walking' = 'seated';
  scriptedWalk = 0;
  readonly position = new Vector3();
  readonly poses: { x: number; y: number; z: number; posture: string }[] = [];
  readonly teleports: { x: number; y: number; z: number }[] = [];
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

  setRidePose(x: number, y: number, z: number, _facing: number): void {
    this.position.set(x, y, z);
    this.poses.push({ x, y, z, posture: this.ridePosture });
  }

  teleportTo(x: number, y: number, z: number, _facing?: number): void {
    this.position.set(x, y, z);
    this.teleports.push({ x, y, z });
  }

  nudge(): void {}
}

/**
 * Reused, because the real world reads these — `DayNight.followPlayer` copies
 * `playerPosition` every frame and a `null` there took the whole park down.
 * Driving the real `World` means honouring the real contract.
 */
const CONTEXT_PLAYER = new Vector3();
const CONTEXT_FORWARD = new Vector3(0, 0, -1);

function frame(elapsed: number, at?: Vector3): FrameContext {
  if (at) CONTEXT_PLAYER.copy(at);
  return {
    dt: DT,
    elapsed,
    frame: Math.round(elapsed / DT),
    input: { justPressed: () => false } as unknown as FrameContext['input'],
    playerPosition: CONTEXT_PLAYER as unknown as FrameContext['playerPosition'],
    cameraForward: CONTEXT_FORWARD as unknown as FrameContext['cameraForward'],
  };
}

/** Is this point inside the box, looking straight down? Height is irrelevant. */
function insideFootprint(box: Box3, at: Vector3): boolean {
  return at.x >= box.min.x && at.x <= box.max.x && at.z >= box.min.z && at.z <= box.max.z;
}

function findByName(root: Object3D, name: string): Object3D | null {
  let found: Object3D | null = null;
  root.traverse((object) => {
    if (object.name === name) found = object;
  });
  return found;
}

// ------------------------------------------------------ can you see inside?
//
// Asked before anything is driven, because it is a question about the built
// bus rather than about the sequence.
//
// **The honest form of "are the windows transparent?"** is not "is the glass
// material transparent" — it was, at `opacity: 0.34`, on the build where Jim
// said *"the windows are also not transparent"*. He was right and the material
// was too: the panes were decals stuck on the **outside of a closed box**, so
// what you saw through the glass was the cream bodywork 2 cm behind it.
//
// So this fires a ray straight in through each pane, from outside, and asks
// what it hits. If the wall behind the glass is solid, the ray hits opaque
// bodywork at the pane's own depth and there is nothing to see. This is the
// same technique that finally found the hood-face bug (CLAUDE.md, 31 July):
// cast a ray at the thing and find out what is actually there.
function checkYouCanSeeIn(): void {
  const bus = createCatBus();
  bus.root.updateMatrixWorld(true);

  const glass: Object3D[] = [];
  const opaque: Box3[] = [];
  bus.root.traverse((object) => {
    const mesh = object as { isMesh?: boolean; material?: { transparent?: boolean; opacity?: number; side?: number } };
    if (!mesh.isMesh) return;
    const material = mesh.material;
    const seeThrough = material?.transparent === true && (material.opacity ?? 1) < 0.9;
    if (seeThrough) {
      glass.push(object);
      return;
    }
    // BackSide meshes are outline shells, not bodywork.
    if (material?.side === 1) return;
    opaque.push(new Box3().setFromObject(object));
  });

  check(glass.length > 0, 'the cat bus has no glazed windows at all');

  let seeable = 0;
  for (const pane of glass) {
    const at = pane.getWorldPosition(new Vector3());
    // Straight in along x, from just outside this pane towards the centre line.
    const inward = at.x > 0 ? -1 : 1;
    // Somewhere the cabin genuinely is: a hand's width past the glass.
    const probe = new Vector3(at.x + inward * 0.45, at.y, at.z);
    const blocked = opaque.some((box) => box.containsPoint(probe));
    if (!blocked) seeable += 1;
  }

  check(
    seeable === glass.length,
    `${glass.length - seeable} of ${glass.length} cat bus windows have solid ` +
      'bodywork immediately behind the glass — they are stickers on a closed ' +
      'box, and nobody can see the children through them',
  );
  notes.push(`${seeable} of ${glass.length} windows have open cabin behind the glass`);
  bus.dispose();
}

// ------------------------------------------------- do the passengers fit?
//
// The guard that was missing. The old check asserted twelve seats existed and
// were occupied, which passed happily while every occupant stuck through the
// roof, the walls and the child in front.
function checkChildrenFitTheBus(): void {
  const bus = createCatBus();
  bus.root.updateMatrixWorld(true);

  // The cabin's own volume, from the two named shell bands. Named on purpose:
  // an earlier version of this measurement guessed "the largest opaque mesh"
  // and picked the cat's face, then cheerfully reported every child 10 m out of
  // place. A measurement that identifies the wrong object is worse than none.
  const shell = new Box3();
  shell.makeEmpty();
  let bands = 0;
  bus.root.traverse((object) => {
    if (object.name === 'cat-bus-shell-lower' || object.name === 'cat-bus-shell-upper') {
      shell.expandByObject(object);
      bands += 1;
    }
  });
  check(bands === 2, `found ${bands} named cat bus shell bands, expected 2 — the check cannot measure the cabin`);
  if (bands !== 2) {
    bus.dispose();
    return;
  }

  const seats = bus.seats;
  check(
    seats.length === CAT_BUS_SEAT_COUNT,
    `found ${seats.length} seats on the built bus, expected ${CAT_BUS_SEAT_COUNT}`,
  );

  const boxes: Box3[] = [];
  for (const seat of seats) {
    const kid = createKid({ hairStyle: 'short' });
    seat.add(kid.root);
  }
  bus.root.updateMatrixWorld(true);
  for (const seat of seats) {
    const occupant = seat.children[seat.children.length - 1];
    if (occupant) boxes.push(new Box3().setFromObject(occupant));
  }

  let worstProtrusion = 0;
  let worstSeat = -1;
  for (let index = 0; index < boxes.length; index += 1) {
    const box = boxes[index]!;
    const out = Math.max(
      box.max.y - shell.max.y,
      shell.min.x - box.min.x,
      box.max.x - shell.max.x,
      box.max.z - shell.max.z,
      shell.min.z - box.min.z,
    );
    if (out > worstProtrusion) {
      worstProtrusion = out;
      worstSeat = index;
    }
  }
  check(
    worstProtrusion <= 0,
    `a child sitting in seat ${worstSeat} sticks ${worstProtrusion.toFixed(2)} m out ` +
      'through the cat bus’s own bodywork — the bus is too small for the ' +
      'children it is documented as being sized around',
  );

  let worstOverlap = 0;
  let worstPair = '';
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (!a.intersectsBox(b)) continue;
      const overlap = Math.min(
        Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x),
        Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z),
      );
      if (overlap > worstOverlap) {
        worstOverlap = overlap;
        worstPair = `${i} and ${j}`;
      }
    }
  }
  check(
    worstOverlap <= 0,
    `children in seats ${worstPair} overlap each other by ${worstOverlap.toFixed(2)} m — ` +
      `the seat plan is tighter than the ${CHILD_FOOTPRINT} m a child measures`,
  );

  notes.push(
    `12 children seated: worst protrusion ${worstProtrusion.toFixed(2)} m, ` +
      `worst mutual overlap ${worstOverlap.toFixed(2)} m`,
  );
  notes.push(
    `cabin ${(shell.max.x - shell.min.x).toFixed(2)} x ${(shell.max.y - shell.min.y).toFixed(2)} x ` +
      `${(shell.max.z - shell.min.z).toFixed(2)} m for a ${CHILD_FOOTPRINT} m child ` +
      `(${WIDEST_CHILD_FOOTPRINT} m in a sun hat)`,
  );
  bus.dispose();
}

// --------------------------------------------------------------------- drive

saveFlags.hydrate({ arrivedByBus: false });

checkYouCanSeeIn();
checkChildrenFitTheBus();

const park = buildHeadlessPark();
const world = park.world;
const arrival = world.entrance.arrival;

if (!arrival) {
  console.error('FAIL: the headless park built no cat bus arrival at all.');
  process.exit(1);
}

const player = new RecordingPlayer();
world.entrance.attachPlayer(player as unknown as Player);

const kids = world.npcs.all.slice(0, ARRIVAL_KID_COUNT);
check(
  kids.length === ARRIVAL_KID_COUNT,
  `the park built ${kids.length} children for the bus, expected ${ARRIVAL_KID_COUNT}`,
);
check(
  kids.every((kid) => kid.scripted),
  'not every bus passenger was handed to the arrival — some are wandering the park while their bus arrives',
);

const busRoot = findByName(arrival.group, 'cat-bus');
check(busRoot !== null, 'no node named `cat-bus` anywhere under the arrival group');
const doorHinge = busRoot ? findByName(busRoot, 'door-hinge') : null;
check(doorHinge !== null, 'the cat bus has no `door-hinge`');

/** Where the player was on the very first frame anything was drawn. */
const openingPlayerPosition = player.position.clone();

const phasesSeen = new Set<ArrivalPhase>();
const busXs: number[] = [];
let deepestIntoPark = -Infinity;
let widestDoorSwing = 0;
let doorAtEnd = 0;

/** Per child: when they left their seat, and where they were each frame. */
const leftSeatAt = new Array<number>(ARRIVAL_KID_COUNT).fill(Number.NaN);
const releasedAt = new Array<number>(ARRIVAL_KID_COUNT).fill(Number.NaN);
const lastPosition = kids.map((kid) => kid.position.clone());
const walkedDistance = new Array<number>(ARRIVAL_KID_COUNT).fill(0);
const walkingFrames = new Array<number>(ARRIVAL_KID_COUNT).fill(0);
const onFootLastFrame = new Array<boolean>(ARRIVAL_KID_COUNT).fill(false);
const offTheBus = new Array<boolean>(ARRIVAL_KID_COUNT).fill(false);
const enteredPark = new Array<boolean>(ARRIVAL_KID_COUNT).fill(false);
let closestPairEver = Infinity;
let closestPairWhen = 0;
let closestPairWho = '';
const crossedGateOutsideGap: string[] = [];
const seenInsidePark = new Set<number>();

const totalSeconds = ARRIVAL_DURATION + AFTERWARDS_SECONDS;
const frames = Math.ceil(totalSeconds / DT);

for (let index = 0; index < frames; index += 1) {
  const elapsed = index * DT;
  const context = frame(elapsed, player.position);

  if (!arrival.finished) phasesSeen.add(arrival.phase);

  world.update(context);

  // --- the bus -----------------------------------------------------------
  if (busRoot && !arrival.finished) {
    busXs.push(busRoot.position.x);
    const box = new Box3().setFromObject(busRoot);
    for (let ix = 0; ix <= 4; ix += 1) {
      for (let iz = 0; iz <= 4; iz += 1) {
        const px = box.min.x + ((box.max.x - box.min.x) * ix) / 4;
        const pz = box.min.z + ((box.max.z - box.min.z) * iz) / 4;
        const into = edgeRadiusAt(PARK_BOUNDARY, Math.atan2(pz, px)) - Math.hypot(px, pz);
        if (into > deepestIntoPark) deepestIntoPark = into;
      }
    }
  }
  if (doorHinge) {
    const swing = Math.abs(doorHinge.rotation.y);
    // Only while somebody is still getting out — `depart` closes the door from
    // fully open, so a door that never opened still writes a swing on its way
    // shut. That trap already caught one version of this check.
    if (arrival.stillAboard > 0) widestDoorSwing = Math.max(widestDoorSwing, swing);
    doorAtEnd = swing;
  }

  // --- the children -------------------------------------------------------
  const busFootprint = busRoot ? new Box3().setFromObject(busRoot) : null;
  for (let kidIndex = 0; kidIndex < kids.length; kidIndex += 1) {
    const kid = kids[kidIndex]!;
    const previous = lastPosition[kidIndex]!;
    const moved = Math.hypot(kid.position.x - previous.x, kid.position.z - previous.z);

    // **Outside the bus, geometrically.** Two earlier versions of this got it
    // wrong and each wrong answer produced a confident, false measurement:
    //
    // - *"did they move?"* reports all eleven leaving at t = 0, because a
    //   seated child moves every frame while the bus rolls in — they are
    //   sitting in a vehicle that is driving.
    // - *"are their feet on the terrain?"* is defeated by the terrain itself:
    //   the ground falls away under an 18 m bus parked near the hilltop's rim,
    //   so the far seats sit only ~0.1 m above the ground beneath *them* and
    //   read as standing.
    //
    // Whether a child is inside the bus is a question about the bus, so it is
    // asked of the bus's own bounding box.
    // **Sticky.** Getting off a bus is not something you undo, and the test has
    // to say so: the bus drives 30 m away at the end, sweeping its bounding box
    // straight across the children who already got out of it. Without this they
    // are re-classified as "back aboard" as it passes, which breaks the
    // consecutive-frame guard below and reported a 12.3 m/s child.
    if (!offTheBus[kidIndex] && busFootprint !== null && !insideFootprint(busFootprint, kid.position)) {
      offTheBus[kidIndex] = true;
    }
    const onFoot = offTheBus[kidIndex]!;
    if (Number.isNaN(leftSeatAt[kidIndex]) && onFoot) leftSeatAt[kidIndex] = elapsed;
    if (Number.isNaN(releasedAt[kidIndex]) && !kid.scripted) releasedAt[kidIndex] = elapsed;

    // Distance and speed are only meaningful while the script owns them; after
    // release they are an ordinary NPC's business.
    // Only once they were *already* on foot last frame: the step down is a
    // single jump from a seat inside the bus to the pavement outside it, and
    // counting that as walking put a spurious 5-9 m into the very first sample
    // and reported the whole crowd sprinting.
    const wasOnFoot = onFootLastFrame[kidIndex]!;
    onFootLastFrame[kidIndex] = onFoot;
    if (kid.scripted && onFoot && wasOnFoot && !Number.isNaN(leftSeatAt[kidIndex])) {
      walkedDistance[kidIndex] += moved;
      if (moved > 1e-4) walkingFrames[kidIndex] += 1;
    }

    if (Math.hypot(kid.position.x, kid.position.z) < edgeRadiusAt(PARK_BOUNDARY, Math.atan2(kid.position.z, kid.position.x))) {
      seenInsidePark.add(kidIndex);
    }

    // Crossing the **boundary**, which is a spline and is only at z = 60 near
    // the gate itself. Testing `z` against `ENTRANCE_GATE_Z` flagged a child
    // strolling around the middle of the park at x = 6.1, thirty seconds after
    // the arrival ended, as having walked through a wall. Radial, and only
    // while the arrival still owns them.
    // Only the **first** time each child enters the park, and only while the
    // arrival still owns them. Once inside they wander, and a child strolling
    // about the middle of the park re-crosses this line all afternoon.
    if (kid.scripted && !enteredPark[kidIndex]) {
      const nowInside =
        Math.hypot(kid.position.x, kid.position.z) <=
        edgeRadiusAt(PARK_BOUNDARY, Math.atan2(kid.position.z, kid.position.x));
      if (nowInside) {
        enteredPark[kidIndex] = true;
        if (!isInEntranceGateGap(Math.atan2(kid.position.z, kid.position.x))) {
          crossedGateOutsideGap.push(
            `child ${kidIndex} at x ${kid.position.x.toFixed(2)}, z ${kid.position.z.toFixed(2)}`,
          );
        }
      }
    }

    previous.copy(kid.position);
  }

  // Closest two children, but only once both are actually out of the bus —
  // seated neighbours are 1.8 m apart by design and are not a crowd.
  for (let i = 0; i < kids.length; i += 1) {
    if (Number.isNaN(leftSeatAt[i])) continue;
    for (let j = i + 1; j < kids.length; j += 1) {
      if (Number.isNaN(leftSeatAt[j])) continue;
      const a = kids[i]!;
      const b = kids[j]!;
      const gap = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
      if (gap < closestPairEver) {
        closestPairEver = gap;
        closestPairWhen = elapsed;
        closestPairWho = `${i} (${a.scripted ? 'scripted' : 'free'}) and ${j} (${b.scripted ? 'scripted' : 'free'})`;
      }
    }
  }
}

// ------------------------------------------------------------------ measure

// --- 1. it actually played ------------------------------------------------
for (const phase of ['rolling-in', 'doors-opening', 'stepping-down', 'walking-in', 'departing'] as const) {
  check(phasesSeen.has(phase), `the '${phase}' phase never ran — the sequence skipped it`);
}
check(arrival.finished, `the arrival never finished inside ${totalSeconds.toFixed(1)} s`);

const busStart = busXs[0] ?? Number.NaN;
const busEnd = busXs[busXs.length - 1] ?? Number.NaN;
check(
  Math.abs(busStart - ENTRANCE_BUS_ARRIVE_X) < 0.01,
  `the bus started at x ${busStart.toFixed(2)}, not ENTRANCE_BUS_ARRIVE_X (${ENTRANCE_BUS_ARRIVE_X})`,
);
check(
  Math.abs(busEnd - ENTRANCE_BUS_VANISH_X) < 1.5,
  `the bus ended at x ${busEnd.toFixed(2)}, nowhere near ENTRANCE_BUS_VANISH_X (${ENTRANCE_BUS_VANISH_X})`,
);
check(widestDoorSwing > 1.5, `the door only ever swung ${widestDoorSwing.toFixed(2)} rad while children were still aboard`);
check(doorAtEnd < 0.01, `the bus drove away with its door ${doorAtEnd.toFixed(2)} rad open`);
check(
  deepestIntoPark < 0,
  `the bus reached ${deepestIntoPark.toFixed(2)} m INSIDE the park boundary — it is a bus, it belongs on the road outside the gate`,
);

// --- 2. THE ONE THAT MATTERS: are they still here, and are they NPCs? -----
//
// Jim: *"the children still get off the bus, walk in and vanish"*. The old
// check could not have caught that, because it asserted on models the cutscene
// itself owned and disposed of. These are the park's own children, so the
// question is simply whether the park still has them — measured a full
// half-minute after the bus drove away.
const stillInTheWorld = world.npcs.all.length;
check(
  stillInTheWorld === 24,
  `the park has ${stillInTheWorld} children ${AFTERWARDS_SECONDS} s after the arrival, expected 24 — somebody was disposed of`,
);
// **Is anything actually being DRAWN where each of them is?**
//
// The strongest form of "they did not vanish", and the first version of this
// check could not ask it: counting `npcs.all` counts an array, and an array is
// exactly what still had eleven entries in it on the build where Jim watched
// children disappear. A crowd child's rig is a *detached* proxy skeleton with
// no parent, so scene-graph attachment says nothing either — what reaches the
// screen is an instance matrix in a `KidCrowd` `InstancedMesh`, and a hidden
// member's is the zero matrix, parked at the origin.
//
// So: gather every instance translation in the built scene, and require one
// near each child. This is measuring pixels' worth of truth rather than
// bookkeeping.
const drawnAt: Vector3[] = [];
const instanceMatrix = new Matrix4();
park.scene.traverse((object) => {
  const instanced = object as InstancedMesh;
  if (!instanced.isInstancedMesh) return;
  for (let index = 0; index < instanced.count; index += 1) {
    instanced.getMatrixAt(index, instanceMatrix);
    const at = new Vector3().setFromMatrixPosition(instanceMatrix);
    if (at.lengthSq() < 1e-6) continue; // the zero matrix: this member is hidden
    instanced.localToWorld(at);
    drawnAt.push(at);
  }
});
let undrawn = 0;
for (const kid of kids) {
  let nearest = Infinity;
  for (const at of drawnAt) {
    nearest = Math.min(nearest, Math.hypot(at.x - kid.position.x, at.z - kid.position.z));
  }
  if (nearest > 2) undrawn += 1;
}
check(
  undrawn === 0,
  `${undrawn} of the ${ARRIVAL_KID_COUNT} bus children have nothing drawn anywhere near them ` +
    `${AFTERWARDS_SECONDS} s after the arrival — they are in the crowd's book-keeping but not ` +
    'on the screen, which is exactly what "they walk in and vanish" looks like from in here',
);
notes.push(`${drawnAt.length} crowd instances drawn; all ${ARRIVAL_KID_COUNT} arrivals have one within 2 m`);

const stillScripted = kids.filter((kid) => kid.scripted).length;
check(
  stillScripted === 0,
  `${stillScripted} of the ${ARRIVAL_KID_COUNT} bus children are still frozen under scripted control ` +
    `${AFTERWARDS_SECONDS} s after the arrival ended — they will never move again`,
);
check(
  seenInsidePark.size === ARRIVAL_KID_COUNT,
  `only ${seenInsidePark.size} of ${ARRIVAL_KID_COUNT} bus children were ever inside the park boundary`,
);

// Behaving *as NPCs*: an ordinary park child moves. Eleven statues standing
// where the cutscene dropped them would satisfy "still present" and satisfy
// nobody watching.
const restingPlaces = kids.map((kid) => kid.position.clone());
for (let extra = 0; extra < Math.ceil(10 / DT); extra += 1) {
  world.update(frame(totalSeconds + extra * DT, player.position));
}
const movedAfterwards = kids.filter(
  (kid, index) => kid.position.distanceTo(restingPlaces[index]!) > 0.5,
).length;
check(
  movedAfterwards >= ARRIVAL_KID_COUNT - 3,
  `only ${movedAfterwards} of ${ARRIVAL_KID_COUNT} bus children moved at all in the 10 s after that — ` +
    'they are present but not alive; the hand-back to the wander driver did not take',
);

// --- 3. they got off at genuinely different times -------------------------
const departures = leftSeatAt.filter((when) => !Number.isNaN(when)).sort((a, b) => a - b);
check(
  departures.length === ARRIVAL_KID_COUNT,
  `only ${departures.length} of ${ARRIVAL_KID_COUNT} children ever left their seat`,
);
let tightestGap = Infinity;
for (let index = 1; index < departures.length; index += 1) {
  tightestGap = Math.min(tightestGap, departures[index]! - departures[index - 1]!);
}
// Not a literal: the doorway cannot clear faster than one child moving their
// own width at the park's own walking pace.
const REQUIRED_GAP = (CHILD_FOOTPRINT / NPC_WALK_SPEED) * 0.9;
check(
  tightestGap >= REQUIRED_GAP,
  `two children left the bus only ${tightestGap.toFixed(2)} s apart — a ${CHILD_FOOTPRINT} m child ` +
    `walking at ${NPC_WALK_SPEED} m/s needs ${REQUIRED_GAP.toFixed(2)} s to clear the doorway, so they overlap in it`,
);

// --- 4. they never walk through each other --------------------------------
//
// Threshold from the model, not from a literal: two children are inside one
// another whenever their centres are closer than a child is wide. Some slack,
// because a chibi head is a sphere and touching is not overlapping.
const REQUIRED_CLEARANCE = CHILD_FOOTPRINT * 0.55;
check(
  closestPairEver >= REQUIRED_CLEARANCE,
  `two disembarking children came within ${closestPairEver.toFixed(2)} m of each other at ` +
    `${closestPairWhen.toFixed(1)} s — children ${closestPairWho} — a child is ${CHILD_FOOTPRINT} m across, so their models overlap`,
);

// --- 5. they walk at the park's walking speed ------------------------------
const speeds = kids.map((_, index) =>
  walkingFrames[index]! > 0 ? walkedDistance[index]! / (walkingFrames[index]! * DT) : 0,
);
const slowest = Math.min(...speeds);
const fastest = Math.max(...speeds);
check(
  slowest > NPC_WALK_SPEED * 0.8,
  `the slowest arriving child walked at ${slowest.toFixed(2)} m/s against the park's ` +
    `${NPC_WALK_SPEED} m/s — they are dawdling in a way nothing else in the park does`,
);
check(
  fastest < NPC_WALK_SPEED * 1.25,
  `the fastest arriving child walked at ${fastest.toFixed(2)} m/s against the park's ${NPC_WALK_SPEED} m/s`,
);

// --- 6. everybody walked in through the gate ------------------------------
check(
  crossedGateOutsideGap.length === 0,
  `${crossedGateOutsideGap.length} children crossed the boundary outside the gate opening: ${crossedGateOutsideGap
    .slice(0, 3)
    .join('; ')}`,
);

// --- 7. the player -------------------------------------------------------
check(player.beginRides === 1, `the player boarded ${player.beginRides} times, expected once`);
check(player.endRides === 1, `the player was handed the controls ${player.endRides} times, expected once`);
const handover = player.teleports[player.teleports.length - 1];
check(handover !== undefined, 'the player was never put down at the end of the arrival');
if (handover) {
  const drift = Math.hypot(handover.x - ENTRANCE_PLAYER_X, handover.z - ENTRANCE_PLAYER_Z);
  check(drift < 0.01, `she was handed over ${drift.toFixed(2)} m from ENTRANCE_PLAYER_X/Z`);
}

// **The camera opens on the bus.** `Game` snaps the camera to `player.position`
// before the first frame is drawn, so "where was she when the world was first
// built" *is* "where does the camera open". On the build Jim watched she was at
// the park edge, ~17 m away, and the camera spent half a second sliding out to
// the bus to find her. Measuring where the camera ends up would have passed.
const openingDistanceToBus = Math.hypot(
  openingPlayerPosition.x - ENTRANCE_BUS_ARRIVE_X,
  openingPlayerPosition.z - ENTRANCE_BUS_STOP_Z,
);
const openingDistanceToSpawn = Math.hypot(
  openingPlayerPosition.x - ENTRANCE_PLAYER_X,
  openingPlayerPosition.z - ENTRANCE_PLAYER_Z,
);
// **The decision itself**, because the positional assertion below cannot reach
// it. The bug lived in `Game`'s constructor, and `Game` builds a real
// `WebGLRenderer` — so this file, which drives `World` directly, runs none of
// it. Reinstating the exact bug left the positional check green, which makes
// that check hollow on its own. `arrivalOwnsTheSpawn` exists so there is
// something a test can actually hold.
check(
  arrivalOwnsTheSpawn(true, false) === true,
  'a fresh game with the cat bus arriving does NOT let the arrival own where she starts — ' +
    'Game will teleport her to the park edge after the bus has seated her, and the camera ' +
    'snaps to the park and then scrolls out to the bus',
);
check(
  arrivalOwnsTheSpawn(true, true) === false,
  'a continued save is being overridden by the arrival — she should resume where she quit',
);
check(
  arrivalOwnsTheSpawn(false, false) === false,
  'with no arrival, something other than the spawn point is deciding where she starts',
);

check(
  openingDistanceToBus < openingDistanceToSpawn,
  `on the opening frame the player is ${openingDistanceToSpawn.toFixed(1)} m from her park spawn and ` +
    `${openingDistanceToBus.toFixed(1)} m from the arriving bus — the camera snaps to her, so it opens on ` +
    'the park and then scrolls out to the bus',
);

// --- 8. coverage: none of the above passed because nothing happened -------
check(busXs.length > 100, `only ${busXs.length} frames of bus motion were recorded`);
const totalWalked = walkedDistance.reduce((sum, value) => sum + value, 0);
check(totalWalked > ARRIVAL_KID_COUNT * 5, `the children walked ${totalWalked.toFixed(1)} m between them — far too little`);
check(saveFlags.arrivedByBus === true, 'the arrival never recorded that she has arrived');

// ------------------------------------------------------------------- report

notes.push(`bus travelled x ${busStart.toFixed(1)} to ${busEnd.toFixed(1)}, never closer than ${(-deepestIntoPark).toFixed(2)} m outside the park`);
notes.push(`door swung to ${widestDoorSwing.toFixed(2)} rad while unloading, shut at the end`);
notes.push(
  `children left over ${(departures[departures.length - 1]! - departures[0]!).toFixed(1)} s, ` +
    `tightest gap ${tightestGap.toFixed(2)} s (needs ${REQUIRED_GAP.toFixed(2)})`,
);
notes.push(`closest two children ever got: ${closestPairEver.toFixed(2)} m (needs ${REQUIRED_CLEARANCE.toFixed(2)})`);
notes.push(`walking speed ${slowest.toFixed(2)}-${fastest.toFixed(2)} m/s against the park's ${NPC_WALK_SPEED}`);
notes.push(`controls at ${ARRIVAL_CONTROL_AT.toFixed(1)} s, whole arrival ${ARRIVAL_DURATION.toFixed(1)} s`);
notes.push(`${stillInTheWorld} children in the park ${AFTERWARDS_SECONDS} s later; ${movedAfterwards} of the ${ARRIVAL_KID_COUNT} arrivals still walking about`);
notes.push(`bus is ${TALLEST_CHILD_HEIGHT.toFixed(2)} m child-friendly; seat plan from CHILD_FOOTPRINT ${CHILD_FOOTPRINT} m`);

for (const note of notes) console.log(`  ${note}`);

if (failures.length > 0) {
  console.error('\nFAIL: the cat bus arrival did not play as it should.');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\ncat bus arrival OK');
