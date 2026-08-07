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
import { Box3, Frustum, Matrix4, Vector3 } from 'three';
import {
  BusJourney,
  JOURNEY_SECONDS,
  LANE_MAX_GRADIENT,
  cameraPoseAt,
} from '../src/world/entrance/BusJourney.ts';
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
{
  const director = new JourneyDirector();
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
}

journey.dispose();

for (const line of said) console.log(`  ${line}`);
if (fouls.length > 0) {
  console.error('\ncheck:bus-journey FAILED');
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('\ncheck:bus-journey passed');
