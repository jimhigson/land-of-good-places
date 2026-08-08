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
import { Box3, Frustum, Matrix4, type Object3D, Quaternion, Vector3 } from 'three';
import {
  BusJourney,
  JOURNEY_SECONDS,
  LANE_MAX_GRADIENT,
  cameraPoseAt,
  laneHeight,
} from '../src/world/entrance/BusJourney.ts';
import { CAT_BUS_SEAT_COUNT } from '../src/world/entrance/catBus.ts';
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

  // The toggle itself, before anything is driven.
  said.push(`the ride opens ${inside.view}`);
  if (inside.view !== 'outside') {
    fouls.push(`the ride opens ${inside.view} the bus — it should open on the bus, from outside`);
  }
  if (inside.toggleView() !== 'inside' || inside.view !== 'inside') {
    fouls.push('toggling the view does not put the camera inside the bus');
  }
  if (inside.toggleView() !== 'outside') {
    fouls.push('toggling the view a second time does not bring the camera back outside');
  }
  inside.setView('inside');

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
  let headMotion = 0;
  let framesCameraOutsideTheBus = 0;
  let fewestChildrenInShot = Infinity;
  let insideFrames = 0;

  for (let t = 0; t <= JOURNEY_SECONDS + 1e-9; t += STEP) {
    inside.update(STEP);
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

    let inShot = 0;
    for (const head of heads) {
      head.getWorldPosition(here);
      if (frustum.containsPoint(here)) inShot += 1;
      const was = previous.get(head);
      if (was) headMotion += was.distanceTo(here);
      previous.set(head, here.clone());
    }
    fewestChildrenInShot = Math.min(fewestChildrenInShot, inShot);
  }

  said.push(
    `from inside, at worst ${fewestChildrenInShot} children were in frame; their heads moved ` +
      `${headMotion.toFixed(1)} m between them over the ride`,
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
      `looking inside the bus, at one point only ${fewestChildrenInShot} of the ${heads.length} children ` +
        'are in frame — the camera is not pointed at the children',
    );
  }

  // **Moving.** The bus itself travels 220 m, and the heads are carried along
  // with it, so the *total* head movement is dominated by the journey and says
  // nothing. What is measured instead is movement **relative to the seat they
  // are sitting in**, which is only ever the child's own bouncing and waving.
  let bounce = 0;
  const seatSpace = new Vector3();
  // A further four seconds, measuring each head against its own seat's frame.
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

  // ...and now it is ready.
  director.noteParkReady();
  if (!director.skipOffered) {
    fouls.push('the skip is NOT offered once the park has finished generating — there is no way out of the ride');
  }
  if (!director.readyToHandOver) {
    fouls.push('the park is built and the ride is over, and it still will not hand over');
  }
  if (director.overrunning) fouls.push('the ride still believes it is waiting for a park that exists');
  said.push('the skip is withheld before the park exists and offered once it does, in both directions');
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

journey.dispose();

for (const line of said) console.log(`  ${line}`);
if (fouls.length > 0) {
  console.error('\ncheck:bus-journey FAILED');
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('\ncheck:bus-journey passed');
