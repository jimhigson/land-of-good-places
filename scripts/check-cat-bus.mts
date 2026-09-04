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
import { Box3, InstancedMesh, Matrix4, Mesh, Object3D, Raycaster, Vector3 } from 'three';
import { buildHeadlessPark } from './park-harness.mts';
import {
  ARRIVAL_CONTROL_AT,
  ARRIVAL_DURATION,
  ARRIVAL_KID_COUNT,
  type ArrivalPhase,
} from '../src/world/entrance/ArrivalSequence.ts';
import {

  ENTRANCE_GATE_X,
  ENTRANCE_GATE_Z,
  ENTRANCE_PLAYER_X,
  ENTRANCE_PLAYER_Z,
  isInEntranceGateOpening,
} from '../src/world/entrance/layout.ts';
import {
  CAT_BUS_DESTINATION,
  CAT_BUS_ROUTE_NUMBER,
  CAT_BUS_SEAT_COUNT,
  createCatBus,
} from '../src/world/entrance/catBus.ts';
import { isBakedFaceMesh } from '../src/art/style/faces.ts';
import { ROAD_TILE_METRES } from '../src/world/entrance/road.ts';
import {
  entranceBusArriveAt,
  entranceBusVanishAt,
  entranceRoadAt,
} from '../src/world/entrance/roadRoute.ts';

/**
 * Where the bus starts, stands and ends, in world coordinates — asked of the
 * road it drives rather than of the three straight-kerb constants this file used
 * to import. Those are gone: the road follows the park's edge now, and a point
 * on it is an arc, not an `x`.
 */
const BUS_ARRIVES_AT = entranceRoadAt(entranceBusArriveAt());
const BUS_VANISHES_AT = entranceRoadAt(entranceBusVanishAt());
const BUS_STANDS_AT = entranceRoadAt(0);
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

/**
 * Every word the art code paints, and which canvas it painted it onto.
 *
 * Installed by wrapping `document.createElement`, so it sees canvases the art
 * modules make for themselves rather than needing them handed over. Used to
 * establish that the bus's lettering goes into the bus's **own** face texture
 * — see the destination-board section below for why that is the question.
 */
const wordsPainted: { text: string; canvas: unknown }[] = [];
{
  const create = document.createElement.bind(document);
  (document as { createElement: unknown }).createElement = (tag: string): unknown => {
    const element = create(tag) as { getContext?: (kind: string) => unknown };
    if (tag !== 'canvas' || typeof element.getContext !== 'function') return element;
    const getContext = element.getContext.bind(element);
    element.getContext = (kind: string): unknown => {
      const context = getContext(kind) as { fillText?: unknown } | null;
      if (!context || typeof context !== 'object') return context;
      return new Proxy(context, {
        get(target, key, receiver) {
          if (key === 'fillText') {
            return (text: string, ...rest: unknown[]): unknown => {
              wordsPainted.push({ text: String(text), canvas: element });
              return (Reflect.get(target, key, receiver) as (...a: unknown[]) => unknown)(
                text,
                ...rest,
              );
            };
          }
          return Reflect.get(target, key, receiver);
        },
      });
    };
    return element;
  };
}

/**
 * The bodywork meshes that carry the tiger-stripe map (#364).
 *
 * Listed by the names `catBus.ts` gives them rather than inferred, so a
 * *fifth* mapped surface appearing on the bus — a face patch worn in front of
 * it, say — is a failure here rather than something quietly absorbed into "the
 * striped bodywork".
 */
const STRIPED = new Set([
  'cat-bus-shell-lower',
  'cat-bus-shell-upper',
  'cat-bus-back-wall',
  'cat-bus-door-panel',
  'cat-bus-roof',
]);

/** The words painted since this was last called, and by whom. */
function paintedWords(): readonly { text: string; canvas: unknown }[] {
  return wordsPainted;
}

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

/**
 * **Is this point inside the bus, looking straight down?**
 *
 * Asked in the **bus's own frame**, not against a world-axis-aligned box, and
 * that stopped being a nicety the day the bus started driving a road that
 * curves. An `AABB` round a vehicle at 45° is about 14.9 m square where the
 * vehicle is 15.8 x 5.3 — nearly three times the footprint, most of it empty
 * air beside the bus.
 *
 * It produced three confident, wrong failures at once on the first run after the
 * road was curved: the bus "reached 6.15 m inside the park boundary" (a corner
 * of the box, not of the bus), "two children left the bus 0.00 s apart" and "the
 * slowest child walked 1.54 m/s" (children counted as still aboard while
 * standing well clear of it, then all released on one frame). One wrong box,
 * three wrong measurements — CLAUDE.md's "an assertion reporting success about
 * something it is not describing", pointed the other way.
 *
 * `worldToLocal` is the whole fix: it undoes the bus's own rotation, so the box
 * being compared against is the box the bus really occupies.
 */
function insideFootprint(bus: Object3D, localBox: Box3, at: Vector3): boolean {
  const local = bus.worldToLocal(at.clone());
  return (
    local.x >= localBox.min.x &&
    local.x <= localBox.max.x &&
    local.z >= localBox.min.z &&
    local.z <= localBox.max.z
  );
}

/**
 * The bus's extent in its **own** coordinates, measured once off the built
 * vehicle with its placement taken out of the way.
 *
 * Measured rather than taken from `CAT_BUS_LENGTH`/`CAT_BUS_WIDTH`: those
 * describe the box the bodywork was designed around, and this file's whole job
 * is to measure the thing that was actually built.
 */
function localFootprint(bus: Object3D): Box3 {
  const position = bus.position.clone();
  const rotation = bus.rotation.y;
  bus.position.set(0, 0, 0);
  bus.rotation.y = 0;
  bus.updateMatrixWorld(true);
  const box = new Box3().setFromObject(bus);
  bus.position.copy(position);
  bus.rotation.y = rotation;
  bus.updateMatrixWorld(true);
  return box;
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

// The whole cast as the built world defines it — park children AND the
// hotel's residents, who live in `npcs.all` too since the Land Hotel merge.
// Captured here, before the arrival plays, so the disposal assertion below
// measures "nobody the world built has gone" rather than repeating a
// hand-counted 24 that goes stale every time the population rule changes
// (it already did once: NPC_COUNT is density-derived now, and the residents
// made a literal 24 wrong the day the hotel landed).
const populationAtStart = world.npcs.all.length;
check(
  kids.every((kid) => kid.scripted),
  'not every bus passenger was handed to the arrival — some are wandering the park while their bus arrives',
);

const busRoot = findByName(arrival.group, 'cat-bus');
check(busRoot !== null, 'no node named `cat-bus` anywhere under the arrival group');
const doorHinge = busRoot ? findByName(busRoot, 'door-hinge') : null;
check(doorHinge !== null, 'the cat bus has no `door-hinge`');

/** The bus's own extent, measured once — see {@link localFootprint}. */
const busLocalBox = busRoot ? localFootprint(busRoot) : new Box3();

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
    // Sampled over the bus's **own** footprint and then taken into the world, so
    // every probe is a point the bus really occupies. The old version gridded a
    // world-aligned box, whose corners are beside a turned bus rather than on it.
    for (let ix = 0; ix <= 4; ix += 1) {
      for (let iz = 0; iz <= 4; iz += 1) {
        const local = new Vector3(
          busLocalBox.min.x + ((busLocalBox.max.x - busLocalBox.min.x) * ix) / 4,
          0,
          busLocalBox.min.z + ((busLocalBox.max.z - busLocalBox.min.z) * iz) / 4,
        );
        const world = busRoot.localToWorld(local);
        const into =
          edgeRadiusAt(PARK_BOUNDARY, Math.atan2(world.z, world.x)) - Math.hypot(world.x, world.z);
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
    if (!offTheBus[kidIndex] && busRoot !== null && !insideFootprint(busRoot, busLocalBox, kid.position)) {
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
        if (!isInEntranceGateOpening(kid.position.x, kid.position.z)) {
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
  Math.abs(busStart - BUS_ARRIVES_AT.x) < 0.01,
  `the bus started at x ${busStart.toFixed(2)}, not on the road at the brow (${BUS_ARRIVES_AT.x.toFixed(2)})`,
);
check(
  Math.abs(busEnd - BUS_VANISHES_AT.x) < 1.5,
  `the bus ended at x ${busEnd.toFixed(2)}, nowhere near where the road goes over the far brow ` +
    `(${BUS_VANISHES_AT.x.toFixed(2)})`,
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
  stillInTheWorld === populationAtStart,
  `the park has ${stillInTheWorld} children ${AFTERWARDS_SECONDS} s after the arrival, ` +
    `but the built world started with ${populationAtStart} — somebody was disposed of`,
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
//
// **Not every bus passenger is a crowd instance, though.** `ArrivalSequence`
// hands the bus the first `ARRIVAL_KID_COUNT` of `npcs.all` with no exemption
// for the three pinned kids (`NpcSystem.ts`'s Ethan/Eleri/Rumi) — and two of
// those three (Eleri's hat and pet, Rumi's simulated ponytail) are built as a
// real, individually-rendered `CharacterModel` rather than an instanced
// `KidAvatar` (`NpcAvatar.member` is only ever set on the crowd path — see
// that field's own doc in `npcAvatar.ts`). Her rig is *not* a detached proxy —
// it is the genuine scene-graph object a normal render draws — so the
// instance-matrix search above can never find her: she was reported "undrawn"
// while a raycast at her `foot-l` mesh, 0.20 m from her tracked position,
// found a fully attached, fully visible child. That is a hole in this check,
// not in the game — `Rumi` (or `Eleri`) riding the bus is exactly as legitimate
// as any other child, so the two avatar kinds each get the test that is
// actually meaningful for them.
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
const undrawnKids: string[] = [];
for (const kid of kids) {
  if (kid.avatar.member) {
    // The common case: an instanced crowd member, drawn only through the
    // instance buffer gathered above.
    let nearest = Infinity;
    for (const at of drawnAt) {
      nearest = Math.min(nearest, Math.hypot(at.x - kid.position.x, at.z - kid.position.z));
    }
    if (nearest > 2) undrawnKids.push(`${kid.name} (crowd, nearest instance ${nearest.toFixed(2)} m away)`);
  } else {
    // A pinned kid (Eleri, Rumi): a real `CharacterModel`, so ask about her
    // own root rather than the crowd's instance buffer — attached to the
    // scene, visible all the way up, and actually where she is tracked to be.
    const root = kid.avatar.rig.root;
    let attached = false;
    let visibleChain = true;
    for (let node: Object3D | null = root; node; node = node.parent) {
      if (!node.visible) visibleChain = false;
      if (node === park.scene) attached = true;
    }
    const at = root.getWorldPosition(new Vector3());
    const drift = Math.hypot(at.x - kid.position.x, at.z - kid.position.z);
    if (!attached || !visibleChain || drift > 2) {
      undrawnKids.push(
        `${kid.name} (individual model, attached=${attached}, visible=${visibleChain}, drift ${drift.toFixed(2)} m)`,
      );
    }
  }
}
check(
  undrawnKids.length === 0,
  `${undrawnKids.length} of the ${ARRIVAL_KID_COUNT} bus children have nothing drawn anywhere near ` +
    `them ${AFTERWARDS_SECONDS} s after the arrival — on screen for neither the crowd instance buffer ` +
    'nor (for a pinned child) their own model, which is exactly what "they walk in and vanish" looks ' +
    `like from in here: ${undrawnKids.join('; ')}`,
);
notes.push(
  `${drawnAt.length} crowd instances drawn; every arrival is drawn either as a crowd instance within ` +
    '2 m or, for a pinned child riding the bus, as her own attached, visible model',
);

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
// "Alive" is moved OR legitimately engaged, not moved alone. Since the Land
// Hotel merge the park's train station can stand near the gate (#241 spreads
// the attractions), and measured on the merged park five of the eleven
// arrivals walked straight over and queued for the train — `trainTrip` busy,
// stood honestly still on the platform. That is the wander system working,
// not a child who was never handed back. A disposed or frozen proxy has no
// busy activity and no displacement, so the original disease is still caught.
const busyAfterwards = kids.filter((kid, index) => {
  if (kid.position.distanceTo(restingPlaces[index]!) > 0.5) return false;
  const activities = (kid.driver as never as { activities?: { busy?: boolean }[] }).activities;
  return (activities ?? []).some((activity) => activity.busy === true);
}).length;
const aliveAfterwards = movedAfterwards + busyAfterwards;
check(
  aliveAfterwards >= ARRIVAL_KID_COUNT - 3,
  `only ${movedAfterwards} of ${ARRIVAL_KID_COUNT} bus children moved in the 10 s after that, and ` +
    `only ${busyAfterwards} more were busy with an activity — the rest are present but not alive; ` +
    'the hand-back to the wander driver did not take',
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

// --- 4. how close free children get, for information only -----------------
//
// This used to gate on CHILD_FOOTPRINT * 0.55 (0.99 m) of clearance between
// any two children, at any point in the arrival, and re-failed by a few
// centimetres every time nearby path geometry shifted — most recently when
// the ring road was grid-aligned. That number was never a collision bound;
// it was an invented personal-space preference. Once a disembarking child
// crosses RELEASE_Z they are an ordinary free child under ordinary crowd
// rules, no different from the other twenty-odd in the park — NpcSystem.ts's
// own SEPARATION constant (CHILD_FOOTPRINT, 1.8 m) is only where two free
// children *start* a soft, rate-limited push-apart, not a floor they are
// held to, and children brushing past each other is normal, wanted
// behaviour (see NpcSystem.ts's comment on SEPARATION). Even the tighter,
// physically-real NPC_RADIUS * 2 (1.0 m, the actual wall-collision radius)
// isn't a meaningful "looks fine" line — a chibi rig is almost entirely
// head, so two children *at* that distance already read as skulls
// overlapping to a viewer, which is exactly why SEPARATION was raised past
// it in the first place. There is no single number here that is "the
// correct" personal-space floor, so this check stops picking one: per Jim
// (18 August 2026), "just use normal pathfinding and collision
// detection... who cares how close they are so long as they collide
// normally." The seat-overlap check above (`worst mutual overlap`) already
// catches genuine interpenetration — the original bug this check was built
// for, twelve children 0.52 m inside one another, was a *seated* bug, and
// that section still gates hard on it. This one is a note, not a gate.

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
  openingPlayerPosition.x - BUS_ARRIVES_AT.x,
  openingPlayerPosition.z - BUS_ARRIVES_AT.z,
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

// --- 7a. the road actually reaches the park -------------------------------
//
// Jim, 7 August 2026: *"it doesn't actually drive up to the park, the road
// needs to actually go to the park."* The bus pulled up on grass — there was no
// road at the entrance at all.
//
// **Measured off the built park, in metres, not restated from the constants
// that built it.** A check comparing `ENTRANCE_BUS_STOP_Z` to itself would pass
// on a park with no road in it whatsoever, which is precisely the state this is
// about. So every number below comes from the road meshes' own world-space
// vertices.
{
  /** The road itself — the surface the bus drives on, outside the wall. */
  const roadPoints: Vector3[] = [];
  /**
   * **The whole arrival surface: the road, plus the run in through the gate.**
   *
   * These were one mesh family until Jim asked for the run through the gateway
   * to be an ordinary park path rather than road continuing through
   * (3 September) — so it is drawn from `pathSurface.ts` now and named
   * `entrance-gateway-path*`. The surface a child walks in on did not go
   * anywhere; it changed material and therefore changed name.
   *
   * Asking only about `entrance-road*` after that rename is a clause measuring
   * a mesh name instead of the thing it is about: it reported "0 vertices
   * inside the wall — it does not pass through the gate" about a gateway with a
   * path laid squarely through it. `theRoadArrivesAtTheParkAndGoesIn` in the
   * invariant suite was widened to both families when the rename landed and
   * this, its twin, was not — CLAUDE.md's "two definitions of one thing, kept
   * in step by hand", with the copy found wrong by a check rather than a child
   * only because the two happen to run in different suites.
   *
   * The two lists stay separate because the clauses below ask genuinely
   * different questions: the bus stands on the **road**, and it must never be
   * satisfied by a footpath it cannot drive on; the park is **reached** by
   * whichever surface actually gets there.
   */
  const arrivalPoints: Vector3[] = [];
  const at = new Vector3();
  park.scene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const isRoad = mesh.name.startsWith('entrance-road');
    const isGatewayPath = mesh.name.startsWith('entrance-gateway-path');
    if (!isRoad && !isGatewayPath) return;
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      at.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(mesh.matrixWorld);
      const point = at.clone();
      arrivalPoints.push(point);
      if (isRoad) roadPoints.push(point);
    }
  });

  check(roadPoints.length > 0, 'there is no road at the park entrance at all — the bus arrives on grass');
  check(
    arrivalPoints.length > roadPoints.length,
    'nothing is drawn between the road and the park — the run in through the gate is missing entirely',
  );

  if (roadPoints.length > 0) {
    /** How close the road the bus drives on gets to a point on the ground. */
    const roadReaches = (x: number, z: number): number => {
      let nearest = Infinity;
      for (const point of roadPoints) nearest = Math.min(nearest, Math.hypot(point.x - x, point.z - z));
      return nearest;
    };

    /** How close any of the arrival surface — road or gateway path — gets. */
    const arrivalReaches = (x: number, z: number): number => {
      let nearest = Infinity;
      for (const point of arrivalPoints) nearest = Math.min(nearest, Math.hypot(point.x - x, point.z - z));
      return nearest;
    };

    // **The gate.** Not "a road exists somewhere near the entrance" — the road
    // has to come up to the one fixed thing in the park (Decision 5). The
    // threshold is the road's own segment length, because that is the finest
    // resolution a vertex can land at; anything tighter would be asserting on
    // where the tessellation happened to fall.
    const toTheGate = arrivalReaches(ENTRANCE_GATE_X, ENTRANCE_GATE_Z);
    check(
      toTheGate < ROAD_TILE_METRES / 2,
      `the nearest paved surface gets to the gate is ${toTheGate.toFixed(1)} m — it does not reach the park`,
    );

    // **And through it.** A surface that stops at the wall arrives at a park you
    // cannot walk into. The gate is a hole in the wall
    // (`theGateIsAHoleInTheWall` in the invariant suite), so there must be
    // surface on both sides of it — the road outside, the gateway path inside.
    const outside = arrivalPoints.filter((point) => point.z > ENTRANCE_GATE_Z).length;
    const inside = arrivalPoints.filter((point) => point.z < ENTRANCE_GATE_Z).length;
    check(
      outside > 0 && inside > 0,
      `the arrival surface has ${outside} vertices outside the wall and ${inside} inside it — it does ` +
        'not pass through the gate, so it arrives at the park without going in',
    );

    // **And the bus stands on it**, everywhere it stops along its run — which is
    // the fault as Jim actually saw it, a bus on grass.
    let worstOffRoad = 0;
    // Three points along the run, taken off the road itself: where it drives on,
    // where it stands, and halfway to where it leaves.
    for (const at of [entranceBusArriveAt(), 0, entranceBusVanishAt() / 2]) {
      const on = entranceRoadAt(at);
      worstOffRoad = Math.max(worstOffRoad, roadReaches(on.x, on.z));
    }
    check(
      worstOffRoad < ROAD_TILE_METRES / 2,
      `somewhere along its run the bus stands ${worstOffRoad.toFixed(1)} m from the nearest road surface ` +
        '— it is parked on the grass',
    );

    const deepest = Math.min(...arrivalPoints.map((point) => point.z));
    notes.push(
      `the arrival surface runs from z ${Math.max(...arrivalPoints.map((p) => p.z)).toFixed(0)} outside ` +
        `the wall to z ${deepest.toFixed(0)} inside the park, passing ${toTheGate.toFixed(2)} m from the ` +
        `gate centre — ${roadPoints.length} vertices of road (the bus's own surface) and ` +
        `${arrivalPoints.length - roadPoints.length} of gateway path carrying it in through the arch`,
    );
  }
}

// --- 7b. the cat's face is DRAWN, on the bus's own bodywork ---------------
//
// Jim, 7 August 2026: *"the face of the cat projects off its head and floats in
// space. It should be a texture map on the head."*
//
// Two separate things have to be true, and a check for either one alone passes
// on a build where the other is broken:
//
// 1. **It is drawn.** CLAUDE.md's hood-face bug was a mesh that was never
//    rendered while the mesh, the texture and the code all looked correct on
//    inspection — wound inside out, so `MeshToonMaterial`'s `FrontSide` culled
//    it. Asserting that a face texture *exists* would have passed on it
//    throughout. The only test that can tell the difference is the one that
//    found it in the end: fire a ray in from where a viewer is and see what it
//    hits. That is what happens below.
// 2. **It is not floating.** A ray test alone passes on the build Jim watched,
//    because a patch hanging a metre off the bus is still the first thing the
//    ray meets. So the surface the face is on is also measured against the
//    bus's own solid bodywork.
{
  // Everything painted from here on is the bus's own doing. Scoped, because the
  // recorder is global and the park built above paints two dozen NPC name
  // labels; asserting over all of them would be asserting about the crowd.
  const paintedBefore = paintedWords().length;
  const faceBus = createCatBus();
  faceBus.root.updateMatrixWorld(true);

  // Every mesh in the bus carrying a painted texture, and — separately — every
  // one carrying a **face**.
  //
  // This used to be one list. It asserted "the bus has exactly one painted
  // surface" and then took `painted[0]` as the face, which worked only for as
  // long as the face was the single mapped thing on the vehicle. #364 painted
  // tiger stripes into the bodywork's own UV space, which is four more mapped
  // surfaces and is the *right* way to do stripes — the same one-surface-one-
  // texture rule the face itself follows. The old assertion would have refused
  // it, and, worse, `painted[0]` would then have been a flank: every face
  // assertion below would have gone on measuring the side of the bus and
  // reporting confidently about it.
  //
  // So the question is asked properly now. **The number that must be one is the
  // number of surfaces carrying a face**, which is what CLAUDE.md's rule is
  // actually about, and `isBakedFaceMesh` answers it directly rather than by a
  // proxy that happened to be true.
  const painted: Mesh[] = [];
  faceBus.root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as { map?: unknown } | undefined;
    if (material && material.map) painted.push(mesh);
  });
  const faceSurfaces = painted.filter((mesh) => isBakedFaceMesh(mesh));

  check(
    faceSurfaces.length === 1,
    `the bus carries ${faceSurfaces.length} face-bearing surfaces where it should carry exactly one, ` +
      "the cat's own — a second one is a second place for a face to be in the wrong position",
  );
  // A face that is *not* on a baked surface would show up as a mapped mesh that
  // is neither the face nor a stripe. Named so the failure says which.
  const mysteryMaps = painted.filter(
    (mesh) => !isBakedFaceMesh(mesh) && !STRIPED.has(mesh.name),
  );
  check(
    mysteryMaps.length === 0,
    `${mysteryMaps.length} painted surface(s) on the bus are neither the baked face nor the striped ` +
      `bodywork: ${mysteryMaps.map((mesh) => mesh.name || '(unnamed)').join(', ')} — a patch worn in ` +
      'front of the bus rather than its own UV map (CLAUDE.md: one surface, one texture)',
  );

  // **Every** face surface, not just the first one traversal happens to reach:
  // a check decided by traversal order reports on something other than what it
  // is describing.
  for (const mesh of faceSurfaces) {
    // `solid()` marks a real, shadow-casting part of the vehicle; `decal()`
    // marks something stuck on the outside of one. A face that is a decal is by
    // definition not the bodywork, whatever its coordinates say.
    check(
      mesh.castShadow,
      "the cat's face is on a decal rather than on the bus's own bodywork — a decal is a second " +
        'surface, which is a second thing that can be in the wrong place',
    );
  }

  const faceMesh = faceSurfaces[0];
  if (faceMesh) {
    const faceBox = new Box3().setFromObject(faceMesh);

    // **The ray.** From well in front of the bus, straight down its length, at
    // the height of the face's own centre — aimed at the built object rather
    // than at a constant, so this follows a face that is moved rather than
    // going quietly green.
    const faceCentre = faceBox.getCenter(new Vector3());
    const from = new Vector3(faceCentre.x, faceCentre.y, faceBox.max.z + 25);
    const raycaster = new Raycaster(from, new Vector3(0, 0, -1), 0, 200);
    const hits = raycaster.intersectObject(faceBus.root, true);
    const first = hits[0];
    check(
      first !== undefined && first.object === faceMesh,
      first === undefined
        ? "a ray fired straight at the cat's face from outside the bus hits NOTHING — the face is not " +
          'being drawn at all (this is the hood-face bug: wound inside out and culled by FrontSide)'
        : `a ray fired at the cat's face hits \`${first.object.name || '(unnamed)'}\` first, not the face — ` +
          'something stands in front of it',
    );

    // **How much air is there behind the cat's face?**
    //
    // The measurement Jim's complaint actually names. Walk the ray's hits from
    // the front and find the first one that is on a shadow-casting piece of the
    // vehicle: that is where the bus's skin really starts. If the face is
    // printed into that skin the answer is zero, because the first hit *is* the
    // skin. If it is worn in front of it — the build Jim watched — the answer is
    // the size of the gap, and it was **1.13 m**.
    //
    // Deliberately *not* "the face's front against the frontmost bodywork":
    // that version was written first, went green, and turned out to be incapable
    // of failing, because the face sphere is itself the frontmost bodywork and
    // so was being compared against itself. Moving it a metre forward left it
    // reporting 0.000. Caught by mutation, which is the only thing that would
    // have caught it.
    const solidHit = hits.find((hit) => (hit.object as Mesh).castShadow);
    if (first && solidHit) {
      const airBehindTheFace = solidHit.distance - first.distance;
      check(
        airBehindTheFace <= 0.02,
        `the cat's face floats ${airBehindTheFace.toFixed(2)} m in front of the bus's own skin — there is ` +
          'clear air between the face and the vehicle it belongs to',
      );
      notes.push(
        `the cat's face is drawn on the bus's skin itself, ${airBehindTheFace.toFixed(3)} m of air behind it ` +
          `(ray lands at z = ${(from.z - first.distance).toFixed(2)})`,
      );
    } else {
      check(false, "no shadow-casting bodywork lies behind the cat's face at all");
    }

    // --- the destination board ------------------------------------------
    //
    // Jim: *"write 'Land of Good Places' on the front of the bus"*, and *"make
    // the bus number 67"*.
    //
    // **"The texture exists" is not the assertion.** The hood-face bug was a
    // mesh never rendered while its texture, its geometry and its code all
    // looked correct. What has to be true is that the words were painted **into
    // the bus's own face canvas** — not onto a second surface, which is the
    // exact fault being fixed on the face this same round — and that the
    // surface carrying them is drawn and in front.
    //
    // Node's canvas is a no-op stub (`headless-canvas.mjs`), so the ink cannot
    // be read back out of the bitmap. What *can* be established here, and is:
    // every `fillText` the bus makes is recorded along with the canvas it went
    // to, and the canvas the words land on must be the one that became the face
    // material's map. Anything painting a destination board onto a mesh of its
    // own fails that, and so does a board that is never painted at all.
    const painted = paintedWords().slice(paintedBefore);
    const faceCanvas = (faceMesh.material as { map?: { image?: unknown } }).map?.image;
    const onTheFace = painted.filter((word) => word.canvas === faceCanvas);
    const said = onTheFace.map((word) => word.text).join(' | ');

    for (const wanted of [CAT_BUS_DESTINATION, CAT_BUS_ROUTE_NUMBER]) {
      const whole = onTheFace.some((word) => word.text === wanted);
      const split = wanted
        .split(' ')
        .every((part) => onTheFace.some((word) => word.text.includes(part)));
      check(
        whole || split,
        `"${wanted}" is not painted into the bus's own face texture — the words actually painted ` +
          `onto it are: ${said || '(none at all)'}`,
      );
    }
    check(
      painted.length > 0 && painted.length === onTheFace.length,
      `${painted.length - onTheFace.length} of the ${painted.length} words the bus paints go onto a ` +
        "canvas that is not the face's — a destination board on a surface of its own is the floating " +
        'face bug wearing a different hat',
    );
    notes.push(
      `the bus paints ${painted.length} words, all ${onTheFace.length} of them into its own face texture`,
    );
    notes.push(`the front of the bus reads: ${said}`);

    // And the band it is painted in is drawn, from outside, like the face.
    // Aimed above the eyes, where the board sits.
    const boardY = faceBox.max.y - (faceBox.max.y - faceBox.min.y) * 0.28;
    const boardRay = new Raycaster(
      new Vector3(faceCentre.x, boardY, faceBox.max.z + 25),
      new Vector3(0, 0, -1),
      0,
      200,
    );
    const boardHit = boardRay.intersectObject(faceBus.root, true)[0];
    check(
      boardHit !== undefined && boardHit.object === faceMesh,
      'a ray fired at the destination board on the front of the bus does not land on the surface ' +
        'the lettering is painted into — the board is not being drawn',
    );
  }
  faceBus.dispose();
}

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
notes.push(`closest two children ever got: ${closestPairEver.toFixed(2)} m (informational only — see check 4's comment)`);
notes.push(`walking speed ${slowest.toFixed(2)}-${fastest.toFixed(2)} m/s against the park's ${NPC_WALK_SPEED}`);
notes.push(`controls at ${ARRIVAL_CONTROL_AT.toFixed(1)} s, whole arrival ${ARRIVAL_DURATION.toFixed(1)} s`);
notes.push(`${stillInTheWorld} children in the park ${AFTERWARDS_SECONDS} s later; ${movedAfterwards} of the ${ARRIVAL_KID_COUNT} arrivals walking about, ${busyAfterwards} more busy with an activity (the train, usually)`);
notes.push(`bus is ${TALLEST_CHILD_HEIGHT.toFixed(2)} m child-friendly; seat plan from CHILD_FOOTPRINT ${CHILD_FOOTPRINT} m`);

for (const note of notes) console.log(`  ${note}`);

if (failures.length > 0) {
  console.error('\nFAIL: the cat bus arrival did not play as it should.');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\ncat bus arrival OK');
