/**
 * **Does the ride to the park actually play, with the bus on screen?**
 *
 * `scripts/check-cat-bus.mts` owns the arrival at the gate. This owns the
 * twenty seconds in front of it: the journey, the skip, and the seam between
 * them.
 *
 * Every assertion here measures a **built** object — the bus's real bounding
 * box against the real camera's real projection matrix, the director's real
 * answers — rather than asking a builder what it meant to do. That is not
 * ceremony. On this feature specifically, *both* of the previous round's own
 * guards turned out to be incapable of failing: one counted an array where the
 * bug was in the scene, and one lived in `Game`, which builds a real
 * `WebGLRenderer` and so never ran a line of it.
 *
 * `BusJourney` is reachable from here precisely because it is not a `Game`
 * thing and not a `World` thing: it depends on the art modules and nothing
 * else, which is the same property that lets it be on screen before the park
 * has been solved.
 */
import './headless-canvas.mjs';
// The richer element stubs, for the title card. Imported *after*
// `headless-canvas.mjs` (it layers on top) and before anything from `src/`.
import { installHeadlessDom } from './headless-dom.mjs';

installHeadlessDom();

import { Box3, Frustum, Matrix4, type Mesh, type Object3D, Quaternion, Raycaster, Vector3 } from 'three';
import {
  BusJourney,
  JOURNEY_SECONDS,
  LANE_MAX_GRADIENT,
  SETTLE_SECONDS,
  cameraPoseAt,
  laneHeight,
  planJourneyShots,
} from '../src/world/entrance/BusJourney.ts';
import {
  CAT_BUS_CABIN_CEILING_Y,
  CAT_BUS_FLOOR_Y,
  CAT_BUS_SEAT_COUNT,
  CAT_BUS_SEAT_Y,
} from '../src/world/entrance/catBus.ts';
import { JourneyTitle, JOURNEY_TITLE_TEXT } from '../src/ui/JourneyTitle.ts';
import { JourneyDirector } from '../src/world/entrance/journeyDirector.ts';
import { CAMERA_YAW_DEGREES } from '../src/core/constants.ts';

const fouls: string[] = [];
const said: string[] = [];

// --------------------------------------------------------------- the ride
// Stepped at a real frame rate, from the real constructor, and measured every
// frame — not sampled at a few convenient instants.
const journey = new BusJourney({
  skin: 0xffd9be,
  hair: 0x8b5a3c,
  outfit: 0xff9fc4,
  hairStyle: 'bunches',
});

const STEP = 1 / 60;
const frustum = new Frustum();
const projection = new Matrix4();
const box = new Box3();
const size = new Vector3();

let framesWithBusOffScreen = 0;
let firstOffScreenAt = -1;
let smallestOnScreenHeight = Infinity;
let framesRun = 0;
let busMoved = 0;
let previousZ: number | null = null;

/**
 * **Does the bus lie along the hill, or across it?**
 *
 * Jim, 7 August 2026: *"the bus doesn't tilt up when going over a hill."* It
 * tilted the *opposite* way on every frame — `rotation.x` was set from
 * `behind − ahead` and then applied after a separate `rotation.y = π` — and the
 * previous guards here could not see it, because a bus that is on screen, the
 * right size and travelling is all of those things whichever way up it is.
 *
 * So this measures the one relationship that was wrong: the sign of the bus's
 * nose against the sign of the road's gradient. Both come off the built scene —
 * the nose from the bus's own world quaternion, the gradient from `laneHeight`,
 * which is the lane's one owner. Nothing here reads `place()`'s arithmetic.
 *
 * Sampled only where the road is meaningfully sloped: on the flat, the sign of
 * a gradient of 0.001 is noise and asserting on it would make this a check that
 * fails for reasons that are not faults.
 */
const MEANINGFUL_GRADIENT = 0.02;
const forward = new Vector3();
const spin = new Quaternion();
let framesTiltedWrongWay = 0;
let framesOnASlope = 0;
let worstDisagreement: { at: number; gradient: number; nose: number } | null = null;
let steepestClimbNose = 0;
let steepestClimbGradient = 0;
let flattestTilt = Infinity;

const busRoot = journey.scene.getObjectByName('cat-bus');
if (!busRoot) {
  fouls.push('there is no node named `cat-bus` anywhere in the journey scene — the ride has no bus');
}

for (let t = 0; t <= JOURNEY_SECONDS + 1e-9; t += STEP) {
  journey.update(STEP);
  framesRun += 1;
  if (!busRoot) break;

  journey.camera.aspect = 16 / 10;
  journey.camera.updateProjectionMatrix();
  journey.camera.updateMatrixWorld(true);
  journey.scene.updateMatrixWorld(true);

  const at = busRoot.getWorldPosition(new Vector3());
  if (previousZ !== null) busMoved += Math.abs(at.z - previousZ);
  previousZ = at.z;

  projection.multiplyMatrices(
    journey.camera.projectionMatrix,
    journey.camera.matrixWorldInverse,
  );
  frustum.setFromProjectionMatrix(projection);
  box.setFromObject(busRoot);

  // **On screen**, not merely existing: the bus's own box against the camera's
  // own frustum. `intersectsBox` is the same test the renderer culls with.
  if (!frustum.intersectsBox(box)) {
    framesWithBusOffScreen += 1;
    if (firstOffScreenAt < 0) firstOffScreenAt = t;
  }

  // And large enough to *be* a bus rather than a dot on the horizon. Measured
  // as the fraction of the frame the bus's box spans vertically, projected.
  box.getSize(size);
  const centre = box.getCenter(new Vector3());
  const top = centre.clone().setY(box.max.y).project(journey.camera);
  const bottom = centre.clone().setY(box.min.y).project(journey.camera);
  const onScreenHeight = Math.abs(top.y - bottom.y) / 2;
  if (onScreenHeight < smallestOnScreenHeight) smallestOnScreenHeight = onScreenHeight;

  // --- the tilt ------------------------------------------------------------
  // The bus's own forward direction, read off its world matrix: `catBus.ts`
  // builds the bus along local +Z, so that axis rotated into the world *is*
  // where the nose points. Taken from the quaternion rather than from
  // `rotation.x` on purpose — an Euler angle only means something once you know
  // the order it is applied in and what came before it, which is exactly what
  // went wrong.
  busRoot.getWorldQuaternion(spin);
  forward.set(0, 0, 1).applyQuaternion(spin);

  // The road's gradient in the direction the bus is travelling. The bus drives
  // towards −Z, so the ground ahead of it is at the smaller z; a positive
  // gradient means the road is climbing.
  const z = busRoot.position.z;
  const gradient = (laneHeight(z - 1) - laneHeight(z + 1)) / 2;

  if (Math.abs(gradient) > MEANINGFUL_GRADIENT) {
    framesOnASlope += 1;
    if (Math.sign(gradient) !== Math.sign(forward.y)) {
      framesTiltedWrongWay += 1;
      if (!worstDisagreement || Math.abs(gradient) > Math.abs(worstDisagreement.gradient)) {
        worstDisagreement = { at: t, gradient, nose: forward.y };
      }
    }
    if (gradient > steepestClimbGradient) {
      steepestClimbGradient = gradient;
      steepestClimbNose = forward.y;
    }
  }
  flattestTilt = Math.min(flattestTilt, Math.abs(forward.y));
}

if (busRoot) {
  said.push(`ran ${framesRun} frames of a ${JOURNEY_SECONDS}s ride; the bus travelled ${busMoved.toFixed(1)} m`);
  said.push(`the bus was on screen for ${framesRun - framesWithBusOffScreen} of ${framesRun} frames`);
  said.push(`at its smallest the bus still filled ${(smallestOnScreenHeight * 100).toFixed(1)}% of the frame height`);

  if (framesWithBusOffScreen > 0) {
    fouls.push(
      `the cat bus is off screen for ${framesWithBusOffScreen} of ${framesRun} frames of its own ` +
        `journey, first at t = ${firstOffScreenAt.toFixed(2)}s — the camera is not looking at the bus`,
    );
  }
  // A ride whose bus never moves is a photograph.
  if (busMoved < 100) {
    fouls.push(`the bus travelled only ${busMoved.toFixed(1)} m in ${JOURNEY_SECONDS}s — it is not going anywhere`);
  }
  // Eighteen metres of bus should not be a speck.
  if (smallestOnScreenHeight < 0.08) {
    fouls.push(
      `at its smallest the bus fills only ${(smallestOnScreenHeight * 100).toFixed(1)}% of the frame ` +
        'height — the camera is too far out to see who is on it',
    );
  }

  said.push(
    `the bus met a real slope on ${framesOnASlope} of ${framesRun} frames; on the steepest climb ` +
      `(${(steepestClimbGradient * 100).toFixed(1)}%) its nose sat ${steepestClimbNose.toFixed(3)} above horizontal`,
  );

  // **The bus tilts with the hill, not against it.**
  if (framesTiltedWrongWay > 0 && worstDisagreement) {
    const { at, gradient, nose } = worstDisagreement;
    fouls.push(
      `the bus tilts the WRONG way on ${framesTiltedWrongWay} of the ${framesOnASlope} frames where the ` +
        `lane is actually sloped — worst at t = ${at.toFixed(1)}s, where the road ${gradient > 0 ? 'climbs' : 'falls'} ` +
        `at ${(Math.abs(gradient) * 100).toFixed(1)}% and the bus's nose points ${nose > 0 ? 'up' : 'down'} ` +
        `(${nose.toFixed(3)}). Going over a hill it should pitch with the road, not across it`,
    );
  }

  // And it must tilt *at all*. A bus welded level would never disagree with the
  // gradient's sign either — `Math.sign(0)` is 0, which matches nothing — so
  // without this the check above is satisfied by a bus that does nothing, which
  // is the fault as Jim actually phrased it: *"the bus doesn't tilt up"*.
  if (steepestClimbNose < 0.02) {
    fouls.push(
      `on the steepest climb of the ride (${(steepestClimbGradient * 100).toFixed(1)}%) the bus's nose is ` +
        `only ${steepestClimbNose.toFixed(4)} above horizontal — it is driving up a hill dead level`,
    );
  }
  if (framesOnASlope < framesRun * 0.2) {
    fouls.push(
      `only ${framesOnASlope} of ${framesRun} frames had any gradient worth the name — the lane has ` +
        'gone flat, so the tilt above is being asserted against nothing',
    );
  }
}

// ------------------------------------------------------- the view from inside
//
// Jim, 7 August 2026: *"we would like to be able to see inside the bus, switch
// between the view inside of the children riding it and looking excited and the
// outside."*
//
// Three separate claims, and each one passes on a build where the others are
// broken, so each is measured on its own:
//
// 1. the camera really goes **inside the bus** — not "a second camera exists";
// 2. **children are in shot** from there, projected against the real frustum;
// 3. they are **moving**, because a smile painted on a body that never stirs is
//    a photograph of excitement rather than excitement. `setExpression('happy')`
//    on twelve motionless children would satisfy any check that counted faces.
{
  const inside = new BusJourney({
    skin: 0xffd9be,
    hair: 0x8b5a3c,
    outfit: 0xff9fc4,
    hairStyle: 'bunches',
  });

  // --- the shot list, before anything is driven ----------------------------
  //
  // Jim: *"the view shouldn't be switchable, it should switch by itself."* So
  // the schedule is the feature, and it is asserted as a schedule: `shotAt` is
  // pure, so all of this is measurable without a bus.
  const shots = planJourneyShots();
  said.push(
    `shot list: ${shots.map((shot) => `${shot.view} ${shot.from.toFixed(0)}-${shot.to.toFixed(0)}s`).join(', ')}`,
  );

  if (shots.length < 3) {
    fouls.push(`the ride is cut into only ${shots.length} shots — it does not cut between views at all`);
  }
  if (shots[0]?.view !== 'outside') {
    fouls.push(
      `the ride opens ${shots[0]?.view} the bus — it must open on the bus itself, which is the ` +
        'establishing shot: a child has to see what she is riding in before being put inside it',
    );
  }
  const finalShot = shots[shots.length - 1];
  if (finalShot?.view !== 'outside') {
    fouls.push(
      `the ride ends ${finalShot?.view} the bus — the last seconds are the settle onto the park ` +
        "camera's own bearing, and the hand-over is a cut between two frames of the same bus",
    );
  }
  // **The settle must fit inside the closing shot**, or the cut into the park
  // happens partway through easing onto its bearing. Both numbers are read from
  // the modules that own them, so neither can drift.
  if (finalShot && finalShot.to - finalShot.from < SETTLE_SECONDS) {
    fouls.push(
      `the closing shot is ${(finalShot.to - finalShot.from).toFixed(1)}s but the camera needs ` +
        `${SETTLE_SECONDS.toFixed(1)}s to settle onto the park's bearing — the hand-over will land mid-turn`,
    );
  }
  // No gap, no overlap: every instant of the ride has exactly one camera.
  for (let i = 0; i < shots.length; i += 1) {
    const shot = shots[i];
    if (!shot) continue;
    const previous = i === 0 ? { to: 0 } : shots[i - 1];
    if (previous && Math.abs(shot.from - previous.to) > 1e-9) {
      fouls.push(
        `shot ${i} starts at ${shot.from.toFixed(2)}s where the one before it ended at ` +
          `${(previous.to ?? 0).toFixed(2)}s — part of the ride has no camera`,
      );
    }
  }
  if (finalShot && Math.abs(finalShot.to - JOURNEY_SECONDS) > 1e-9) {
    fouls.push(
      `the shot list ends at ${finalShot.to.toFixed(2)}s but the ride runs ${JOURNEY_SECONDS}s — ` +
        'the last stretch has no camera',
    );
  }

  const insideBus = inside.scene.getObjectByName('cat-bus');
  const seats: Object3D[] = [];
  inside.scene.traverse((object) => {
    if (object.name.startsWith('cat-bus-seat-')) seats.push(object);
  });

  // A point on each seated child that moves when they do — the crown of the
  // head. Found in the scene rather than through an accessor added for this,
  // so a child who stops being drawn stops being measured.
  const heads: Object3D[] = [];
  for (const seat of seats) {
    let skull: Object3D | null = null;
    seat.traverse((object) => {
      if (!skull && object.name === 'skull') skull = object;
    });
    if (skull) heads.push(skull);
  }
  said.push(`${seats.length} seats, ${heads.length} of them with a child's head in`);
  if (heads.length < CAT_BUS_SEAT_COUNT) {
    fouls.push(
      `only ${heads.length} of the ${CAT_BUS_SEAT_COUNT} seats have a child in them — there is not much ` +
        'to look at inside the bus',
    );
  }

  const previous = new Map<Object3D, Vector3>();
  const here = new Vector3();
  const toHead = new Vector3();
  const sight = new Raycaster();
  /** Bits of *bus* found standing between the camera and a child. */
  const blocked = new Map<string, number>();
  let blockedByTheBus = 0;
  /**
   * How close the nearest surface ever came to the inside camera.
   *
   * The simplest statement of every inside-view bug this round produced, and
   * the one that catches them all: a lens 0.08 m inside the header band, and
   * then 0.15 m inside the cat's face, are both just "something is touching the
   * camera". A camera buried in a child's hair would read the same and would
   * otherwise pass, because hair belongs to a child and so counts as seeing
   * one.
   */
  let nearestToTheLens = Infinity;
  let headMotion = 0;
  let framesCameraOutsideTheBus = 0;
  let fewestChildrenInShot = Infinity;
  let insideFrames = 0;
  let outsideFrames = 0;
  let cuts = 0;
  let wasView = inside.view;

  for (let t = 0; t <= JOURNEY_SECONDS + 1e-9; t += STEP) {
    inside.update(STEP);
    if (inside.view !== wasView) {
      cuts += 1;
      wasView = inside.view;
    }
    if (inside.view !== 'inside') {
      outsideFrames += 1;
      continue;
    }
    insideFrames += 1;
    inside.camera.aspect = 16 / 10;
    inside.camera.updateProjectionMatrix();
    inside.camera.updateMatrixWorld(true);
    inside.scene.updateMatrixWorld(true);

    // **The camera is in the bus.** Its own box, every frame, because the bus
    // climbs and pitches and a camera pinned to a world coordinate would fall
    // out of the back of it on the first hill.
    if (insideBus) {
      box.setFromObject(insideBus);
      if (!box.containsPoint(inside.camera.position)) framesCameraOutsideTheBus += 1;
    }

    projection.multiplyMatrices(inside.camera.projectionMatrix, inside.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection);

    // **Visible, not merely in the frustum.**
    //
    // The first version of this counted heads inside the frustum and reported a
    // comfortable ten of twelve — on a build whose inside view was a flat brown
    // slab, because the camera was buried in the bodywork and every child was
    // dutifully inside a frustum that could see none of them. A containment
    // test is a test of where things are, not of what can be seen, and this is
    // the third time on this feature that the difference has mattered.
    //
    // So: fire a ray from the camera at each child and require it to arrive.
    // Same technique as the cat's face and the windows.
    let inShot = 0;
    for (const head of heads) {
      head.getWorldPosition(here);
      const was = previous.get(head);
      if (was) headMotion += was.distanceTo(here);
      previous.set(head, here.clone());

      if (!frustum.containsPoint(here)) continue;
      if (!insideBus) continue;
      toHead.subVectors(here, inside.camera.position);
      const reach = toHead.length();
      sight.set(inside.camera.position, toHead.normalize());
      sight.near = inside.camera.near;
      sight.far = reach + 0.5;
      const hits = sight.intersectObject(inside.scene, true);
      // The first thing the ray meets that is not see-through. Glass is not an
      // obstruction — looking at children through the bus's own windows is the
      // whole point of the glazing.
      const blocker = hits.find((hit) => {
        const material = (hit.object as Mesh).material as
          | { transparent?: boolean; opacity?: number }
          | undefined;
        if (material?.transparent === true && (material.opacity ?? 1) < 0.9) return false;
        return true;
      });
      if (!blocker) continue;

      // **Landing on a child is the test — on *any* child, not on this one.**
      //
      // A busload of children occlude each other, and that is what a busload of
      // children looks like: the ray aimed at the back row lands on the hair of
      // the row in front, which is correct and is not a fault. Requiring each
      // ray to reach its own target made the check red on a perfectly good shot
      // — the reported obstructions were `hair.shell.bowl` and `hair.shell.crop`,
      // which is the picture Jim asked for, described as a defect.
      //
      // What must never be in the way is the **bus**. Every version of this bug
      // so far has been bodywork: the cabin's header band, and then the cat's
      // own face blob, whose BackSide outline shell filled the frame from
      // 0.15 m away.
      nearestToTheLens = Math.min(nearestToTheLens, blocker.distance);
      const onAChild = seats.some((seat) => isDescendant(blocker.object, seat));
      if (onAChild) inShot += 1;
      else {
        blockedByTheBus += 1;
        const name = blocker.object.name || `(unnamed ${(blocker.object as Mesh).geometry?.type ?? '?'})`;
        blocked.set(name, (blocked.get(name) ?? 0) + 1);
      }
    }
    fewestChildrenInShot = Math.min(fewestChildrenInShot, inShot);
  }

  // **Both shots get real time, and the cut actually happens on the built
  // ride** — not merely in the plan above. A director that never consults the
  // shot list would satisfy every assertion up there.
  said.push(
    `the ride cut ${cuts} times; ${outsideFrames} frames outside the bus and ${insideFrames} inside`,
  );
  if (cuts < 2) {
    fouls.push(
      `the ride cut between views ${cuts} times over ${JOURNEY_SECONDS}s — it is not switching by ` +
        'itself, which is the whole of what Jim asked for',
    );
  }
  if (insideFrames === 0 || outsideFrames === 0) {
    fouls.push(
      `the ride spent ${insideFrames} frames inside the bus and ${outsideFrames} outside — one of the ` +
        'two shots is never on screen at all',
    );
  }
  if (insideFrames + outsideFrames !== framesRun) {
    fouls.push(
      `${framesRun} frames of ride but ${insideFrames + outsideFrames} accounted for by a shot — ` +
        'part of the ride has no camera',
    );
  }

  said.push(
    `from inside, at worst ${fewestChildrenInShot} children could actually be seen; their heads moved ` +
      `${headMotion.toFixed(1)} m between them over the ride`,
  );
  said.push(`nothing came closer than ${nearestToTheLens.toFixed(2)} m to the inside camera's lens`);
  said.push(
    `bodywork standing between the inside camera and a child: ${
      blockedByTheBus === 0
        ? 'none'
        : [...blocked].map(([name, count]) => `${name} (${count})`).join(', ')
    }`,
  );

  if (framesCameraOutsideTheBus > 0) {
    fouls.push(
      `on ${framesCameraOutsideTheBus} of ${insideFrames} frames the "inside" camera is outside the ` +
        "bus's own bounding box — it is not inside anything",
    );
  }

  // Enough of them to be a busload rather than one child in a seat.
  if (fewestChildrenInShot < 4) {
    fouls.push(
      `looking inside the bus, at one point a ray towards only ${fewestChildrenInShot} of the ` +
        `${heads.length} children landed on a child at all — the camera is not pointed at them`,
    );
  }

  if (nearestToTheLens < 0.3) {
    fouls.push(
      `something is ${nearestToTheLens.toFixed(2)} m from the inside camera's lens — it is buried in ` +
        'geometry, and the view inside the bus is whatever that surface happens to be',
    );
  }

  // **Nothing of the bus may stand between the camera and its passengers.**
  // This is the assertion that would have caught both of this round's inside-
  // view bugs, and neither the frustum test nor the bounding-box test could.
  if (blockedByTheBus > 0) {
    fouls.push(
      `the bus's own bodywork stands between the inside camera and its passengers on ${blockedByTheBus} ` +
        `sightlines — ${[...blocked]
          .map(([name, count]) => `${name} (${count})`)
          .join(', ')}. The camera is buried in the vehicle, and the view inside is a wall`,
    );
  }

  // **Moving.** The bus itself travels 220 m, and the heads are carried along
  // with it, so the *total* head movement is dominated by the journey and says
  // nothing. What is measured instead is movement **relative to the seat they
  // are sitting in**, which is only ever the child's own bouncing and waving.
  let bounce = 0;
  const seatSpace = new Vector3();
  // A further four seconds, measuring each head against its own seat's frame.
  // The ride is over by now, so the director holds its closing shot; that does
  // not matter here, because this measures bodies rather than the camera.
  const localPrevious = new Map<Object3D, Vector3>();
  for (let i = 0; i < 240; i += 1) {
    inside.update(STEP);
    inside.scene.updateMatrixWorld(true);
    for (const head of heads) {
      const seat = seats.find((candidate) => isDescendant(head, candidate));
      if (!seat) continue;
      head.getWorldPosition(seatSpace);
      seat.worldToLocal(seatSpace);
      const was = localPrevious.get(head);
      if (was) bounce += was.distanceTo(seatSpace);
      localPrevious.set(head, seatSpace.clone());
    }
  }
  said.push(`the children moved ${bounce.toFixed(2)} m in their own seats over four seconds of riding`);
  if (bounce < 0.5) {
    fouls.push(
      `over four seconds the ${heads.length} children moved ${bounce.toFixed(2)} m in their seats between ` +
        'them — they are sitting perfectly still, which is not "looking excited"',
    );
  }

  inside.dispose();
}

/** Is `node` somewhere under `ancestor`? */
function isDescendant(node: Object3D, ancestor: Object3D): boolean {
  let at: Object3D | null = node;
  while (at) {
    if (at === ancestor) return true;
    at = at.parent;
  }
  return false;
}

// --------------------------------------------------- the shot the cut lands on
// The orbit has to finish on the park camera's own bearing, or the hand-over is
// a jump rather than a cut. Asserted against `CAMERA_YAW_DEGREES` itself.
{
  const parkYaw = (CAMERA_YAW_DEGREES * Math.PI) / 180;
  const endYaw = cameraPoseAt(JOURNEY_SECONDS).yaw;
  let drift = (endYaw - parkYaw) % (Math.PI * 2);
  if (drift > Math.PI) drift -= Math.PI * 2;
  if (drift < -Math.PI) drift += Math.PI * 2;
  said.push(`the orbit ends ${((drift * 180) / Math.PI).toFixed(2)} degrees off the park camera's bearing`);
  if (Math.abs(drift) > 0.02) {
    fouls.push(
      `the ride ends ${((drift * 180) / Math.PI).toFixed(1)} degrees off the park camera's own bearing — ` +
        'the hand-over will read as a jump cut, not an arrival',
    );
  }
  // And the ride must actually go round, or "the camera rotating around it" is
  // a comment rather than a shot.
  const swept = Math.abs(cameraPoseAt(JOURNEY_SECONDS * 0.5).yaw - cameraPoseAt(0).yaw);
  said.push(`the camera sweeps ${((swept * 180) / Math.PI).toFixed(0)} degrees over the first half`);
  if (swept < Math.PI / 2) {
    fouls.push(`the camera sweeps only ${((swept * 180) / Math.PI).toFixed(0)} degrees in half a ride — it is not orbiting`);
  }
}

// ------------------------------------------------------------- the lane itself
said.push(`the lane's steepest gradient is ${((Math.atan(LANE_MAX_GRADIENT) * 180) / Math.PI).toFixed(1)} degrees`);
if (LANE_MAX_GRADIENT > Math.tan((16 * Math.PI) / 180)) {
  fouls.push(
    `the lane reaches ${((Math.atan(LANE_MAX_GRADIENT) * 180) / Math.PI).toFixed(1)} degrees — that is a ` +
      'ski slope, not a road a bus drives down',
  );
}
if (LANE_MAX_GRADIENT < Math.tan((3 * Math.PI) / 180)) {
  fouls.push(
    `the lane never exceeds ${((Math.atan(LANE_MAX_GRADIENT) * 180) / Math.PI).toFixed(1)} degrees — ` +
      'Jim asked for "various hills" and this is a table',
  );
}

// ------------------------------------------------------------------ the skip
// **Both directions**, which is the half that is easy to leave out: a check that
// only ever exercised the ready case would pass on a button that sat there
// useless from frame one.
{
  const director = new JourneyDirector();

  director.advance(1 / 60);
  if (director.shouldBuildPark()) {
    fouls.push('the park starts building on the ride’s very first frame — nothing is on screen yet');
  }
  if (director.skipOffered) {
    fouls.push('the skip is offered on the first frame of the ride, before any park exists to skip to');
  }

  // Five seconds in, still no park: nothing on offer, and no hand-over.
  for (let t = 0; t < 5; t += 1 / 60) director.advance(1 / 60);
  if (director.skipOffered) {
    fouls.push('the skip is offered five seconds into the ride while the park is still being generated');
  }

  // Ride over, park still not ready: the bus waits. It does not let her in.
  for (let t = 0; t < JOURNEY_SECONDS + 5; t += 1 / 60) director.advance(1 / 60);
  if (!director.rideOver) fouls.push('the ride never finishes');
  if (director.readyToHandOver) {
    fouls.push(
      'the ride hands over to a park that has not finished generating — a loading screen that lies ' +
        'is worse than one that waits',
    );
  }
  if (!director.overrunning) {
    fouls.push('the ride has outrun the park but does not know it, so the bus will not idle at the gate');
  }
  if (director.skipOffered) {
    fouls.push('the skip is offered after the ride has run out with no park behind it');
  }

  // ...the park is built — but its shaders are not compiled yet.
  //
  // A park that stutters for its first few seconds is the same promise broken
  // as a park that is half-built, only more quietly, so `parkFitToPlay` covers
  // both and the bus keeps idling. The skip, though, is offered the moment the
  // park exists: that is Jim's rule ("skippable only once the park has
  // generated") and warming must not quietly tighten it into something else.
  director.noteParkReady();
  if (!director.skipOffered) {
    fouls.push('the skip is NOT offered once the park has finished generating — there is no way out of the ride');
  }
  if (director.readyToHandOver) {
    fouls.push(
      'the ride hands over before the park\'s shaders are warmed — the first seconds of play will stutter',
    );
  }
  if (!director.overrunning) {
    fouls.push('the park is built but not warmed, and the bus does not know to keep idling at the gate');
  }

  // ...and now it is genuinely ready.
  director.noteWarmupReady();
  if (!director.readyToHandOver) {
    fouls.push('the park is built and warmed and the ride is over, and it still will not hand over');
  }
  if (director.overrunning) fouls.push('the ride still believes it is waiting for a park that exists');
  said.push('the skip is withheld before the park exists and offered once it does, in both directions');
  said.push('hand-over waits for the shader warm-up as well as the park, in both directions');
}

// The build order, on its own: not before something has been drawn.
//
// **Generation is marked finished up front on purpose**, so that this block
// tests exactly one thing — the frame rule. `shouldBuildPark()` has two
// preconditions now (a drawn frame, and generation complete) and the other one
// is owned by `check:park-boot`; leaving both in play here would mean a green
// result that could not say which of them was doing the work, and a broken
// frame rule would hide behind the generation gate.
{
  const director = new JourneyDirector();
  director.noteGenerationReady();
  director.advance(1 / 60);
  const onFirst = director.shouldBuildPark();
  director.advance(1 / 60);
  const onSecond = director.shouldBuildPark();
  said.push(`park build requested on frame 1: ${onFirst}, on frame 2: ${onSecond}`);
  if (onFirst || !onSecond) {
    fouls.push(
      `the park build is requested on frame ${onFirst ? '1' : 'never'} — it must wait until a frame of ` +
        'the ride has been drawn, or the whole World construction lands in front of the first pixel',
    );
  }

  // And generation must be advanced from frame two as well, or there is nothing
  // for the ride to be covering.
  const idle = new JourneyDirector();
  idle.advance(1 / 60);
  const generatesOnFirst = idle.shouldAdvanceGeneration();
  idle.advance(1 / 60);
  const generatesOnSecond = idle.shouldAdvanceGeneration();
  said.push(
    `generation advanced on frame 1: ${generatesOnFirst}, on frame 2: ${generatesOnSecond}`,
  );
  if (generatesOnFirst || !generatesOnSecond) {
    fouls.push(
      `generation is advanced on frame ${generatesOnFirst ? '1' : 'never'} — the first slice is a ` +
        'dynamic import whose module evaluation the browser drains before it paints, so starting ' +
        'it on frame one pushes back the very first pixel of the bus',
    );
  }
}

// ------------------------------------------------- sitting, not merely aboard
/**
 * **Is each child actually resting on the seat, and is any part of one below the
 * floor?**
 *
 * There was already a guard that twelve seats exist and are occupied. It passed
 * for weeks with every one of those twelve **underground** — Jim, riding it on
 * 7 August: *"the children on the bus aren't sitting on seats, they're clipped
 * through the floor while on the inside view"*. Occupancy is not sitting, and
 * containment is not contact; this file's own header records the third time
 * that distinction has cost this feature a round.
 *
 * So this measures the two things the old one could not:
 *
 * 1. every child's lowest drawn point is **on** her cushion, within a tolerance
 *    taken from the rig rather than from the seat plan — the kid model's own
 *    geometry hangs {@link RIG_HEM_OVERHANG} below its origin, so "resting on
 *    the cushion" means "no lower than that";
 * 2. **nothing** of any child is below {@link CAT_BUS_FLOOR_Y}.
 *
 * Both are measured in the **bus's own frame**, not the world's: the bus tilts
 * with the lane, so a world-space `y` comparison is a measurement of the hill
 * and would report a different answer on every frame of the ride. That is not
 * hypothetical — the first version of this probe did exactly that and produced
 * twelve different "depths" for twelve children sitting identically.
 *
 * And over four seconds of riding rather than one frame, because the children
 * bounce: a child who clears the floor at rest and dips through it at the bottom
 * of her bob is the fault, not the fix.
 */
{
  const chassis = journey.scene.getObjectByName('chassis');
  if (!chassis) {
    fouls.push('there is no `chassis` node in the journey scene — nothing to measure the cabin against');
  } else {
    /**
     * How far the kid rig's own geometry hangs below its origin, in metres.
     *
     * Measured off a built, posed kid rather than assumed to be zero: the torso
     * hem and the outline shell both reach a little under the feet. A tolerance
     * of zero would report every correctly-seated child as sunk, and a generous
     * round number would have hidden the 0.174 m this exists to catch.
     */
    const RIG_HEM_OVERHANG = 0.02;

    const seatNodes: Object3D[] = [];
    chassis.traverse((object) => {
      if (object.name.startsWith('cat-bus-seat-')) seatNodes.push(object);
    });

    /** Exact bounds of everything `object` draws, in the frame given by `inverse`. */
    const boxIn = (object: Object3D, inverse: Matrix4): Box3 => {
      const box = new Box3();
      const point = new Vector3();
      const local = new Matrix4();
      object.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh || !mesh.geometry || !mesh.visible) return;
        const positions = mesh.geometry.getAttribute('position');
        if (!positions) return;
        local.multiplyMatrices(inverse, mesh.matrixWorld);
        for (let i = 0; i < positions.count; i += 1) {
          box.expandByPoint(point.fromBufferAttribute(positions, i).applyMatrix4(local));
        }
      });
      return box;
    };

    const lowest = new Map<string, number>();
    const highest = new Map<string, number>();
    const toBus = new Matrix4();
    for (let frame = 0; frame < 240; frame += 1) {
      journey.update(STEP);
      journey.scene.updateMatrixWorld(true);
      toBus.copy(chassis.matrixWorld).invert();
      for (const seat of seatNodes) {
        // The child is the only non-mesh child of the seat group; the cushion
        // and its back are siblings on the chassis, not children of the anchor.
        const occupants = seat.children.filter((child) => !(child as Mesh).isMesh);
        if (occupants.length === 0) continue;
        const box = new Box3();
        for (const occupant of occupants) box.union(boxIn(occupant, toBus));
        lowest.set(seat.name, Math.min(lowest.get(seat.name) ?? Infinity, box.min.y));
        highest.set(seat.name, Math.max(highest.get(seat.name) ?? -Infinity, box.max.y));
      }
    }

    if (lowest.size < CAT_BUS_SEAT_COUNT) {
      fouls.push(
        `only ${lowest.size} of the ${CAT_BUS_SEAT_COUNT} seats had a child in them to measure — ` +
          'the seating check has nothing to check',
      );
    }

    let deepest = { name: '', below: -Infinity };
    let floating = { name: '', above: -Infinity };
    let tallest = { name: '', through: -Infinity };
    for (const [name, low] of lowest) {
      const belowFloor = CAT_BUS_FLOOR_Y - low;
      if (belowFloor > deepest.below) deepest = { name, below: belowFloor };
      const offCushion = low - CAT_BUS_SEAT_Y;
      if (offCushion > floating.above) floating = { name, above: offCushion };
      const throughCeiling = (highest.get(name) ?? -Infinity) - CAT_BUS_CABIN_CEILING_Y;
      if (throughCeiling > tallest.through) tallest = { name, through: throughCeiling };
    }

    said.push(
      `seated children: deepest reaches ${deepest.below > 0 ? '' : '-'}` +
        `${Math.abs(deepest.below).toFixed(3)} m ${deepest.below > 0 ? 'below' : 'clear of'} the cabin floor; ` +
        `worst gap under a bottom ${floating.above.toFixed(3)} m; ` +
        `closest head to the ceiling ${(-tallest.through).toFixed(3)} m`,
    );

    if (deepest.below > 0) {
      fouls.push(
        `${deepest.name} has a child ${deepest.below.toFixed(3)} m below the cabin floor — she is not ` +
          `sitting in the bus, she is inside its floor. Nothing may reach under ` +
          `CAT_BUS_FLOOR_Y (${CAT_BUS_FLOOR_Y.toFixed(3)}).`,
      );
    }
    if (floating.above > RIG_HEM_OVERHANG) {
      fouls.push(
        `${floating.name} has a child sitting ${floating.above.toFixed(3)} m above her own cushion — ` +
          `she is hovering over the seat rather than resting on it (tolerance ` +
          `${RIG_HEM_OVERHANG.toFixed(3)} m, the rig's own hem overhang)`,
      );
    }
    if (tallest.through > 0) {
      fouls.push(
        `${tallest.name} has a child whose head goes ${tallest.through.toFixed(3)} m through the cabin ` +
          'ceiling at the top of her bounce — a head through the header band is the same defect as ' +
          'feet through the floor, seen from the other end',
      );
    }

    // ------------------------------------------- nothing floats off the bus
    /**
     * **Is every drawn part of the bus attached to the bus?**
     *
     * Jim, same ride: *"there is a strange block floating off the back of it"*.
     * It was the rear bumper, positioned at `-BODY_LENGTH / 2` while the
     * bodywork actually ends 1.51 m forward of that, leaving a 5 m slab hanging
     * in clear air 1.05 m behind the vehicle. Two more were found the same way:
     * the tail grew from a point 0.88 m behind the bus, and the door step
     * floated 0.20 m under it.
     *
     * **Not "is it inside the bounding box"** — that is the containment test
     * this feature keeps being caught by, and it would have passed the bumper,
     * which sat comfortably inside the length `CAT_BUS_LENGTH` claimed. What is
     * measured is *contact*: every top-level part's own bounds against the
     * bodywork's, and a part separated from it by clear air is a foul however
     * near the middle of the vehicle it is.
     *
     * The bodywork is the two shell bands plus the cat's face, which really is
     * the whole front of the bus — see `catBus.ts`. Everything else has to touch
     * that.
     */
    const bodywork = new Box3();
    for (const name of ['cat-bus-shell-lower', 'cat-bus-shell-upper', 'cat-bus-face']) {
      const part = chassis.getObjectByName(name);
      if (part) bodywork.union(boxIn(part, toBus));
    }
    if (bodywork.isEmpty()) {
      fouls.push('could not find the bus bodywork to measure its parts against');
    } else {
      const adrift: string[] = [];
      let worstGap = 0;
      for (const part of chassis.children) {
        const box = boxIn(part, toBus);
        if (box.isEmpty()) continue;
        // The clear air between this part and the bodywork, on whichever axis
        // separates them most. Negative or zero means they touch or overlap.
        const gap = Math.max(
          bodywork.min.x - box.max.x,
          box.min.x - bodywork.max.x,
          bodywork.min.y - box.max.y,
          box.min.y - bodywork.max.y,
          bodywork.min.z - box.max.z,
          box.min.z - bodywork.max.z,
        );
        if (gap > 0.001) {
          adrift.push(`${part.name || '(unnamed)'} by ${gap.toFixed(2)} m`);
          worstGap = Math.max(worstGap, gap);
        }
      }
      said.push(
        `every part of the bus against its bodywork: ${adrift.length} adrift` +
          (adrift.length > 0 ? ` (worst ${worstGap.toFixed(2)} m)` : ''),
      );
      if (adrift.length > 0) {
        fouls.push(
          `${adrift.length} piece(s) of the bus are drawn floating in clear air, attached to ` +
            `nothing: ${adrift.join(', ')}. A part that does not touch the bodywork reads as ` +
            'debris hanging off the vehicle.',
        );
      }
    }

    // --------------------------------------------- the glass starts up the side
    /**
     * **Does any glazing reach below the window sill?**
     *
     * Jim: *"the windows of the bus go all the way down to the floor of the bus
     * […] windows should only start about halfway up the sides"*. The sill is
     * now derived from a seated child's chin rather than picked, so this asserts
     * the thing that stays true whatever that derivation yields: **no pane of
     * glass may start below a seated child's seat.** A window whose bottom edge
     * is under the cushion she is sitting on is a window down to the floor,
     * which is the fault.
     *
     * Found by material rather than by name — the glazing is the only
     * transparent material on the bus — so a pane added later is measured too
     * without anybody remembering to name it.
     */
    const glass = new Box3();
    let panes = 0;
    chassis.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as { transparent?: boolean; opacity?: number } | undefined;
      if (!material?.transparent || (material.opacity ?? 1) >= 1) return;
      panes += 1;
      glass.union(boxIn(mesh, toBus));
    });
    if (panes === 0) {
      fouls.push('the bus has no transparent glazing at all — there is nothing to see the children through');
    } else {
      // **The side, not the silhouette.** Measured between the two shell bands
      // — the flat flank you actually look at — rather than off `bodywork`,
      // which includes the cat's face sphere and its 0.14 m chin. Using that
      // reported the sill at 48% "up the side" when it is 34% up the side of
      // the bus, and a number quoted to Jim has to be the one he can see.
      const lowerShell = chassis.getObjectByName('cat-bus-shell-lower');
      const upperShell = chassis.getObjectByName('cat-bus-shell-upper');
      const sideBottom = lowerShell ? boxIn(lowerShell, toBus).min.y : bodywork.min.y;
      const sideTop = upperShell ? boxIn(upperShell, toBus).max.y : CAT_BUS_CABIN_CEILING_Y;
      const upTheSide = ((glass.min.y - sideBottom) / (sideTop - sideBottom)) * 100;
      said.push(
        `glazing starts at ${glass.min.y.toFixed(3)} m, ${upTheSide.toFixed(0)}% up the cabin side, ` +
          `${(glass.min.y - CAT_BUS_SEAT_Y).toFixed(3)} m above the seat cushions (${panes} panes)`,
      );
      if (glass.min.y < CAT_BUS_SEAT_Y) {
        fouls.push(
          `glazing reaches down to ${glass.min.y.toFixed(3)} m, which is ` +
            `${(CAT_BUS_SEAT_Y - glass.min.y).toFixed(3)} m below the seat cushions at ` +
            `${CAT_BUS_SEAT_Y.toFixed(3)} — the windows run down past the children rather than ` +
            'starting up the side of the bus',
        );
      }
    }
  }
}

// -------------------------------------------------- the title over the ride
/**
 * **Is the game's name on screen, and are its characters actually moving?**
 *
 * Jim asked for the title *"overlaid on the screen […] characters in different
 * colours […] animate the characters to bounce up and down like they are
 * jumping"*. Three separate claims, and the guard has to be able to fail each:
 * a title that exists but is never mounted, one whose letters are all one
 * colour, and — the one this feature keeps shipping — one that is drawn and
 * perfectly still.
 *
 * The last is why `JourneyTitle` animates from JS rather than a CSS keyframe.
 * A keyframe is invisible to anything without a rendering browser, so a check
 * could only ever assert the element exists, which is exactly the *"ten of
 * twelve children are in the frustum"* shape of guard — true of a brown wall.
 * Sampling the transforms the code actually writes is a test of the animation.
 */
{
  const title = new JourneyTitle();
  const body = (globalThis as { document?: { body?: { children: unknown[] } } }).document?.body;
  const mounted = Array.isArray(body?.children) && body.children.length > 0;

  type Stub = { textContent?: string; style?: { transform?: string; color?: string }; children?: Stub[] };
  const collect = (node: Stub, out: Stub[]): Stub[] => {
    for (const child of node.children ?? []) {
      if ((child.children ?? []).length === 0) out.push(child);
      else collect(child, out);
    }
    return out;
  };
  const root = (body?.children as Stub[])?.[0];
  const letters = root ? collect(root, []) : [];

  const spelled = letters.map((letter) => letter.textContent ?? '').join('');
  const wanted = JOURNEY_TITLE_TEXT.replace(/ /g, '');
  const colours = new Set(letters.map((letter) => letter.style?.color ?? ''));

  said.push(
    `title: ${mounted ? 'mounted' : 'NOT MOUNTED'}, ${letters.length} characters spelling ` +
      `"${spelled}", in ${colours.size} colours`,
  );

  if (!mounted) {
    fouls.push('the journey title is never added to the document — nothing of it reaches the screen');
  }
  if (spelled !== wanted) {
    fouls.push(
      `the title spells "${spelled}" rather than "${wanted}" — the game's name is not what is on screen`,
    );
  }
  if (colours.size < 2) {
    fouls.push(
      `all ${letters.length} characters of the title are the same colour (${colours.size} distinct) — ` +
        'Jim asked for characters in different colours',
    );
  }

  // **Do they move?** Sampled across a whole bounce cycle. Two things have to be
  // true and they are different: that the letters move *at all* over time, and
  // that at any one instant they are not all at the same height — a title where
  // every character rises and falls together is a title bobbing as one block,
  // not characters jumping.
  const trail = new Map<number, Set<string>>();
  let raggedest = 0;
  for (let t = 0; t < 4; t += 1 / 30) {
    title.update(t);
    const nowAt = new Set<string>();
    letters.forEach((letter, index) => {
      const at = letter.style?.transform ?? '';
      nowAt.add(at);
      const seen = trail.get(index) ?? new Set<string>();
      seen.add(at);
      trail.set(index, seen);
    });
    raggedest = Math.max(raggedest, nowAt.size);
  }
  const stillest = Math.min(...[...trail.values()].map((seen) => seen.size));
  said.push(
    `title motion: every character took at least ${stillest} distinct positions, and at the ` +
      `raggedest instant the ${letters.length} of them were at ${raggedest} different heights`,
  );

  if (letters.length === 0 || stillest < 5) {
    fouls.push(
      `a character of the title only ever took ${Number.isFinite(stillest) ? stillest : 0} position(s) ` +
        'over four seconds — the title is drawn but not animated, which is the failure this feature ' +
        'has shipped three times',
    );
  }
  if (raggedest < 3) {
    fouls.push(
      `at no instant were the title's characters at more than ${raggedest} different heights — they ` +
        'are moving as one block rather than jumping individually',
    );
  }

  title.dispose();
  const leftBehind = Array.isArray(body?.children) ? body.children.length : -1;
  said.push(`title disposed: ${leftBehind} elements left on the body`);
  if (leftBehind !== 0) {
    fouls.push(
      `disposing the title left ${leftBehind} element(s) on the document — it would survive the cut ` +
        'into the park and sit over the game',
    );
  }
}

journey.dispose();

for (const line of said) console.log(`  ${line}`);
if (fouls.length > 0) {
  console.error('\ncheck:bus-journey FAILED');
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('\ncheck:bus-journey passed');
