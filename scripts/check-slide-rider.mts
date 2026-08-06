/**
 * **Is the child actually on the slide, and actually drawn, all the way down?**
 *
 * ```
 * npm run check:slide-rider
 * ```
 *
 * This exists because of a bug that survived a first-person ride, a peer
 * review, a procgen suite and a family play-test, and was found only when the
 * camera turned round.
 *
 * `Building.advanceRide` placed the **rider** at `pointAt(t)` plus the castle's
 * centre and base height, while `rideMount` — the seat the camera hangs off —
 * copied `pointAt(t)` straight through. Only one of those can be right, and it
 * was the mount: the chute is built from `SLIDE_PLAN.points`, which are already
 * world coordinates, onto a `parkRoot` whose world offset is exactly zero. So
 * the rider rode the entire slide **26.65 m away from it, in mid-air** — and
 * nobody could see it, because first person hid her model. The one thing in the
 * wrong place was the one thing not being drawn.
 *
 * Jim found it the instant the ride became a chase camera: *"in the chase cam
 * it seems the player is still not drawn"*. She was drawn. She was 26 m away.
 *
 * ### Why this is a script and not a procgen invariant
 *
 * `test/procgen/invariants.ts` measures a **built park**, and the park is built
 * without a `Player` — nothing in it rides anything. This has to drive the real
 * `Building.update` loop with a real `Player` attached, because the defect was
 * in the per-frame code and not in the geometry. A test that recomputed the
 * rider's position from the chute would have agreed with the chute and passed
 * while the game disagreed with both; **it has to observe, not recompute.**
 *
 * ### What it asserts, every frame of a real ride
 *
 * 1. **She is drawn.** `player.group.visible`, and every ancestor up to the
 *    scene. An assertion that the camera mode is `chase` would have been true
 *    all along while she was invisible, so the question asked is the child's
 *    one: is there anything on screen.
 * 2. **She is on the chute.** Her feet are within the built trough
 *    (`CHUTE_ENVELOPE` plus `PLAYER_RADIUS`) of the curve's nearest point. This
 *    is the clause that catches the 26.65 m bug, and it is measured against the
 *    chute as drawn rather than against the plan it was drawn from.
 * 3. **The seat agrees with the rider.** The camera's mount and the player end
 *    up in the same place, which is the specific disagreement that caused this.
 *
 * Coverage is asserted too, in the tradition of `check:crowd` and
 * `check:ride-camera`: a ride that never started, or ended after two frames,
 * must fail rather than quietly prove nothing.
 */

import './headless-dom.mjs';
import { Vector3 } from 'three';

await import('./headless-canvas.mjs');
const { Scene } = await import('three');
const { World } = await import('../src/world/World.ts');
const { Sky } = await import('../src/world/Sky.ts');
const { Player } = await import('../src/entities/Player.ts');
const { CHUTE_ENVELOPE } = await import('../src/world/building/SlideRide.ts');
const { PLAYER_RADIUS } = await import('../src/core/constants.ts');
const { IsoCamera } = await import('../src/core/IsoCamera.ts');
const { Raycaster, Box3 } = await import('three');
type InteriorControls = import('../src/world/building/Building.ts').InteriorControls;

// **Not `park-harness`'s `inertInteriorControls`.** That one throws on every
// method, because nothing should drive the player while a park is merely being
// *built* — and it is right to. This check does the opposite: it rides. So it
// needs controls that actually work, and in particular an `iris` that runs its
// midpoint, because boarding the slide is a change of space and the ride does
// not start until the midpoint fires.
const liveControls: InteriorControls = {
  walkTo: (_x, _y, _z, handlers) => handlers.onArrive(),
  cancelWalk: () => {},
  setTimeScale: () => {},
  setWhoosh: () => {},
  iris: (midpoint) => midpoint(),
  flash: () => {},
  snapCamera: () => {},
  openStairMenu: () => {},
  closeStairMenu: () => {},
};

const scene = new Scene();
const world = new World(scene, new Sky(), liveControls, new IsoCamera());
const building = world.building;
const slide = building.ginormousSlide;

slide.group.updateMatrixWorld(true);
if (slide.group.parent) slide.group.parent.updateMatrixWorld(true);

const camera = new IsoCamera();
const player = new Player(world.collision, camera, new Vector3(0, 0, 0));
scene.add(player.group);
building.attachPlayer(player);

// The chase camera decides whether she is drawn, so ask the ride the same
// question `Game.ts` asks and apply the same rule — rather than hard-coding
// `true` here, which would stop testing the thing that decides it.
let ridingNow = false;
building.onRideChange = (riding) => {
  ridingNow = riding;
  player.group.visible = !riding || building.playerStaysVisible;
};

/** Nearest distance from a world point to the chute's centre line, as drawn. */
const probe = new Vector3();
const chute: Vector3[] = [];
{
  const steps = Math.max(400, Math.round(slide.length / 0.2));
  for (let i = 0; i <= steps; i += 1) {
    slide.pointAt(i / steps, probe);
    chute.push(slide.group.localToWorld(probe.clone()));
  }
}
function distanceToChute(point: Vector3): number {
  let best = Infinity;
  for (const sample of chute) {
    const d = point.distanceTo(sample);
    if (d < best) best = d;
  }
  return best;
}

function drawn(object: { visible: boolean; parent: unknown } | null): boolean {
  let node = object;
  while (node) {
    if (!node.visible) return false;
    node = node.parent as typeof node;
  }
  return true;
}

/**
 * The parts that have to be on screen for her to read as a **child** rather
 * than as a head.
 *
 * **This list is the whole point, and the first version of this check did not
 * have it.** It asked `drawn(player.group)`, which walks *upwards* — group,
 * then its parents — and so answers "is her hierarchy visible", not "is she".
 * Every part of her can be switched off underneath a perfectly visible group,
 * and the check goes on reporting 686/686 green while Jim looks at a floating
 * head. It did exactly that.
 *
 * That is the same shape as the two faults already found on this ride — the
 * rider 26.65 m off a chute behind a check that looked fine, and the pose never
 * exercised because the harness did not drive `Player.update`. A guard that
 * asks about a container instead of about the thing is not a guard.
 *
 * `TreeClimbing.hidePlayerBody` used to hide *every child of `model.body` except
 * the head*, so the arms and legs were precisely what went missing. It has since
 * been deleted outright — it was the only thing in the game that hid part of
 * her, and it could hide her permanently — but this list stays, because the next
 * such mechanism should be caught by a test rather than by Jim.
 */
/** Is `node` `part`, or somewhere underneath it? */
function isDescendantOf(node: unknown, part: unknown): boolean {
  let walk = node as { parent: unknown } | null;
  while (walk) {
    if (walk === part) return true;
    walk = walk.parent as typeof walk;
  }
  return false;
}

/**
 * **How much of her the chase camera can actually see, in pixels.**
 *
 * Jim, on the build where the raycast below reported every part "unobstructed":
 * *"still can't see a body, maybe it is hidden behind the head anyway?"*. He was
 * right and the raycast was answering the wrong question — it asked whether a
 * ray reached the *centre* of each part, and a part whose centre is visible can
 * still be four pixels of shoulder behind a skull. **Unoccluded is not the same
 * as legible**, and only an area measurement can tell them apart.
 *
 * The geometry is against a camera sitting directly behind her: she lies on her
 * back **feet first**, so her feet point down the slide and her head points back
 * up it, straight into the lens. Her own head is between the camera and the rest
 * of her by construction.
 *
 * So this shoots a grid of rays through the **live** ride camera — the real
 * `PerspectiveCamera` from the running ride, via `setFromCamera`, so its fov,
 * aspect and world matrix are the ones the game is using rather than a
 * reconstruction — and counts which of her each pixel lands on. Borrowed from
 * `check-climb-wave.mts`, which measures a climbing child the same way and for
 * the same complaint.
 */
interface Shot {
  readonly headPixels: number;
  readonly bodyPixels: number;
  readonly framePixels: number;
}

const SHOT_W = 240;
const SHOT_H = 135;

function shoot(
  camera: never,
  targets: readonly unknown[],
  model: { root: unknown; head: unknown },
): Shot {
  const caster = new Raycaster();
  let headPixels = 0;
  let bodyPixels = 0;
  for (let iy = 0; iy < SHOT_H; iy += 1) {
    const ndcY = 1 - (2 * (iy + 0.5)) / SHOT_H;
    for (let ix = 0; ix < SHOT_W; ix += 1) {
      const ndcX = (2 * (ix + 0.5)) / SHOT_W - 1;
      caster.setFromCamera({ x: ndcX, y: ndcY } as never, camera);
      const hit = caster.intersectObjects(targets as never[], true)[0];
      if (!hit) continue;
      if (!isDescendantOf(hit.object, model.root)) continue;
      if (isDescendantOf(hit.object, model.head)) headPixels += 1;
      else bodyPixels += 1;
    }
  }
  return { headPixels, bodyPixels, framePixels: SHOT_W * SHOT_H };
}

function bodyParts(model: {
  body: unknown;
  head: unknown;
  leftArm: unknown;
  rightArm: unknown;
  leftLeg: unknown;
  rightLeg: unknown;
}): readonly (readonly [string, unknown])[] {
  return [
    ['body', model.body],
    ['head', model.head],
    ['left arm', model.leftArm],
    ['right arm', model.rightArm],
    ['left leg', model.leftLeg],
    ['right leg', model.rightLeg],
  ];
}

const boarded = building.requestBoardSlide(false);
if (!boarded) {
  console.error('check:slide-rider FAILED — could not board the ginormous slide at all');
  process.exit(1);
}

// The ride starts behind an iris; `liveControls.iris` runs the midpoint straight
// away, so the ride is live on the next update.
const dt = 1 / 60;
let elapsed = 0;
let frames = 0;
let ridingFrames = 0;
let worstOffChute = 0;
let worstOffChuteAt = -1;
let hiddenFrames = 0;
const hiddenPartNames = new Set<string>();
const occludedParts = new Set<string>();
const shots: Shot[] = [];
const raycaster = new Raycaster();
const rideCameraObject = building.rideView?.camera ?? null;
if (rideCameraObject) {
  // Headless never calls `RideCamera.resize`, so the camera would keep whatever
  // aspect it was constructed with. A phone is about 16:9 and so is the raster
  // below, so this makes "what is in frame" mean what it means on the device.
  (rideCameraObject as { aspect: number }).aspect = SHOT_W / SHOT_H;
  (rideCameraObject as { updateProjectionMatrix(): void }).updateProjectionMatrix();
}
let worstSeatGap = 0;
let uprightFrames = 0;
let headForwardFrames = 0;
let worstHeadRise = 0;
let worstAlong = -1;
let worstHeadOffChute = 0;

// The slide is ~65-75 m at 6.5 m/s, so 20 s is generous headroom for it to end.
const MAX_FRAMES = 20 * 60;
// `CHUTE_ENVELOPE` is the trough she sits in; her own width is what can stick
// out of it sideways. Taken from the game, never from the generator's
// `CORRIDOR_RADIUS`, which is the wider margin the search steers by.
const ON_CHUTE = Math.hypot(CHUTE_ENVELOPE.halfWidth, CHUTE_ENVELOPE.above) + PLAYER_RADIUS;
/**
 * How far along the chute a reclining rider must point, as a dot product.
 *
 * Her body axis (feet to head) against the direction she is travelling. **−1**
 * is flat on her back with her head straight back down the slide; **0** is
 * sitting bolt upright out of it; positive would be head-first or face-down.
 *
 * Measured on the built rig rather than chosen: at `RIDE_RECLINE` this sits at
 * about −0.97, and upright is around −0.2. −0.6 is far from both, so it tells
 * lying down from sitting up without pinning the exact angle — which is Jim's
 * to tune, and he will.
 */
const RECLINED_ALONG_CHUTE = -0.6;

while (frames < MAX_FRAMES) {
  const context = {
    dt,
    elapsed,
    input: { justPressed: () => false, isDown: () => false } as never,
    playerPosition: player.position,
    cameraForward: new Vector3(0, 0, 1),
    frame: frames,
  } as never;
  building.update(context);
  // **The player is updated too, and that is not incidental.** Her riding pose
  // is applied in `Player.update`, so a loop that only drove the building would
  // leave her in her default standing pose and the recline clauses below would
  // be measuring nothing. Caught by this check failing on its own first run
  // with "sitting up for 686 of 686 frames" while the pose code was correct —
  // the harness was the thing that was wrong, which is the same class of bug as
  // the one it exists to catch.
  player.update(context);
  elapsed += dt;
  frames += 1;

  if (!ridingNow) {
    if (ridingFrames > 0) break; // the ride has finished
    continue;
  }

  ridingFrames += 1;

  // Her whole self, part by part — not just the group she hangs off.
  for (const [name, part] of bodyParts(player.model as never)) {
    if (!drawn(part as never)) {
      hiddenFrames += 1;
      hiddenPartNames.add(name);
    }
  }

  const off = distanceToChute(player.position);
  if (off > worstOffChute) {
    worstOffChute = off;
    worstOffChuteAt = ridingFrames;
  }

  // **Can the camera actually SEE her, or is the chute in the way?**
  //
  // Visibility flags were all true while Jim was looking at a floating head, so
  // "is it visible" is the wrong question. She lies *inside* a trough whose
  // walls are `CHUTE_ENVELOPE.above` (0.86 m) tall, and a chase camera that
  // looks across the chute rather than down into it has that near wall between
  // it and everything below her chin. This casts a ray from the camera at each
  // body part and asks what it hits first — the same trick CLAUDE.md records
  // for the hood faces, where a mesh that looked correct everywhere was never
  // being drawn.
  if (rideCameraObject && ridingFrames % 30 === 0) {
    rideCameraObject.updateMatrixWorld(true);
    const eye = rideCameraObject.getWorldPosition(new Vector3());
    for (const [name, part] of bodyParts(player.model as never)) {
      const target = (part as { getWorldPosition(v: Vector3): Vector3 }).getWorldPosition(
        new Vector3(),
      );
      const toPart = target.clone().sub(eye);
      const distance = toPart.length();
      if (distance < 1e-4) continue;
      raycaster.set(eye, toPart.normalize());
      raycaster.far = distance - 0.05;
      // Against the chute **and against her own model**. Self-occlusion is the
      // one that bit: lying on her back feet-first puts her head nearest a
      // camera sitting directly behind her, so her own skull is between the
      // lens and the rest of her. Testing only the chute passed happily while
      // Jim looked at a floating head.
      const hits = raycaster.intersectObjects([slide.group, player.model.root], true);
      const blocked = hits.some((hit) => !isDescendantOf(hit.object, part));
      if (blocked) occludedParts.add(name);
    }
  }

  // Sampled rather than every frame: 240x135 rays is a third of a million
  // intersection tests, and the shot does not change materially between
  // neighbouring frames.
  if (rideCameraObject && ridingFrames % 120 === 0) {
    // **From the scene root, not from the camera.** `updateMatrixWorld` composes
    // an object's world matrix from its *parent's current* one and refreshes its
    // descendants — it does not walk up. The camera hangs off `eyeMount` off
    // `rideMount`, so updating the camera alone leaves it reading whatever those
    // two happened to hold, and `setFromCamera` then shoots from a stale pose.
    // This is why the first run of this measurement reported 0 px of her: not
    // because she was invisible, but because the rays were fired from the wrong
    // place. Exactly the "measured or reconstructed rather than live" trap.
    scene.updateMatrixWorld(true);
    const shot = shoot(rideCameraObject as never, [slide.group, player.model.root], player.model as never);
    shots.push(shot);
  }

  const seat = building.rideSeatWorldPosition(new Vector3());
  const seatGap = seat.distanceTo(player.position);
  if (seatGap > worstSeatGap) worstSeatGap = seatGap;

  // **Is she actually lying down?** A check that only asked "is a ride running"
  // would have been true for every frame of the months she rode this slide bolt
  // upright, which is the bug Jim found by eye. So the question asked is about
  // her body: which way does she point, from her feet to her head.
  //
  // Measured **against the chute, not against world vertical.** The first
  // version of this compared her head's height to her feet's and went red on
  // frames 406-409 — the steepest part of the ride — while the pose was
  // perfectly correct. She lies along a slide that is itself tilted, so on a
  // steep pitch her up-slope body axis genuinely rises in world Y. The
  // threshold was not too tight; it was the wrong quantity. Raising it would
  // have buried a real measurement under a fudge factor.
  const head = player.model.head.getWorldPosition(new Vector3());

  // The way she is travelling, reconstructed from the rotation the ride itself
  // set (`YXZ`: yaw then slope), so this asks about the pose actually applied
  // rather than re-sampling the curve and hoping the two agree.
  const yaw = player.group.rotation.y;
  const pitch = player.group.rotation.x;
  const travel = new Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    -Math.sin(pitch),
    Math.cos(yaw) * Math.cos(pitch),
  );
  const bodyAxis = head.clone().sub(player.position);
  const rise = bodyAxis.y;
  if (rise > worstHeadRise) worstHeadRise = rise;
  if (bodyAxis.lengthSq() < 1e-6) {
    headForwardFrames += 1;
  } else {
    // -1 is lying flat with her head straight back down the slide; 0 is sitting
    // bolt upright out of it. Reclined feet-first sits near -0.97.
    const along = bodyAxis.normalize().dot(travel);
    if (along > worstAlong) worstAlong = along;
    if (along > RECLINED_ALONG_CHUTE) uprightFrames += 1;
  }

  // Her head is the far end of her, so it is the part that leaves the trough
  // first if she is lying across the chute rather than along it.
  const headOff = distanceToChute(head);
  if (headOff > worstHeadOffChute) worstHeadOffChute = headOff;
}

console.log('  the shot, sampled down the ride (240x135 rays through the live ride camera):');
for (const [i, shot] of shots.entries()) {
  const pct = ((shot.bodyPixels / shot.framePixels) * 100).toFixed(2);
  console.log(
    `    sample ${String(i + 1).padStart(2)}  head ${String(shot.headPixels).padStart(5)} px   ` +
      `body ${String(shot.bodyPixels).padStart(5)} px   ` +
      `body is ${pct.padStart(5)}% of frame   ` +
      `body/head ${(shot.bodyPixels / Math.max(1, shot.headPixels)).toFixed(2)}`,
  );
}
const worstShot = shots.reduce(
  (a, b) => (b.bodyPixels < a.bodyPixels ? b : a),
  shots[0] ?? { headPixels: 0, bodyPixels: 0, framePixels: SHOT_W * SHOT_H },
);

const complaints: string[] = [];

// Coverage first: a sweep that did nothing must not pass.
if (ridingFrames < 60) {
  complaints.push(
    `the ride only ran for ${ridingFrames} frames — nothing below was actually exercised`,
  );
}
if (hiddenPartNames.size > 0) {
  complaints.push(
    `the child was missing her ${[...hiddenPartNames].sort().join(', ')} during the ride ` +
      `(${hiddenFrames} part-frames hidden of ${ridingFrames} frames) — she is meant to go ` +
      'down the slide as a whole child, not as a floating head',
  );
}
if (worstOffChute > ON_CHUTE) {
  complaints.push(
    `the child rode ${worstOffChute.toFixed(2)} m off the chute (frame ${worstOffChuteAt} of ` +
      `${ridingFrames}), against ${ON_CHUTE.toFixed(2)} m of trough — she is beside the ` +
      'slide, not on it',
  );
}
if (occludedParts.size > 0) {
  complaints.push(
    `the chute hides the child's ${[...occludedParts].sort().join(', ')} from the chase ` +
      'camera — every visibility flag is true, she is simply down inside the trough with ' +
      'its near wall between her and the lens, which is what "just a head on the slide" ' +
      'looks like',
  );
}
if (uprightFrames > 0) {
  complaints.push(
    `the child rode sitting up for ${uprightFrames} of ${ridingFrames} frames — her body ` +
      `pointed ${worstAlong.toFixed(2)} along the chute at worst, against ` +
      `${RECLINED_ALONG_CHUTE} required (-1 is flat on her back, 0 is bolt upright); ` +
      'she is meant to be lying on her back, feet first',
  );
}
if (headForwardFrames > 0) {
  complaints.push(
    `the child had no measurable body axis for ${headForwardFrames} of ${ridingFrames} ` +
      'frames — her head and her feet were in the same place, so nothing was proved',
  );
}
if (worstHeadOffChute > ON_CHUTE) {
  complaints.push(
    `the child's head reached ${worstHeadOffChute.toFixed(2)} m from the chute against ` +
      `${ON_CHUTE.toFixed(2)} m of trough — she is lying across the slide, not along it`,
  );
}
if (worstSeatGap > ON_CHUTE) {
  complaints.push(
    `the camera's seat and the child are ${worstSeatGap.toFixed(2)} m apart at worst — ` +
      'the view and the rider are in different coordinate frames, which is exactly the ' +
      'bug this check exists for',
  );
}

if (complaints.length > 0) {
  console.error('check:slide-rider FAILED');
  for (const complaint of complaints) console.error(`  - ${complaint}`);
  process.exit(1);
}

console.log(
  `check:slide-rider ok — ${ridingFrames} frames ridden, drawn throughout, ` +
    `worst ${worstOffChute.toFixed(2)} m off the chute (trough allows ${ON_CHUTE.toFixed(2)} m), ` +
    `seat within ${worstSeatGap.toFixed(2)} m, ` +
    `reclined throughout (body at most ${worstAlong.toFixed(2)} along the chute, ` +
    `head at most ${worstHeadRise.toFixed(2)} m over her feet and ` +
    `${worstHeadOffChute.toFixed(2)} m from the chute)`,
);
