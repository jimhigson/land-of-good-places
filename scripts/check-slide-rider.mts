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
 *
 * ### And, since 6 August, it asks each camera the question that camera answers
 *
 * The ride now cuts between a **chase** camera and three **trackside** ones —
 * `world/slide/cameras.ts`, and Jim's ruling quoted there. That splits this
 * check's central question in two, and getting the split wrong would be worse
 * than not having it at all:
 *
 * - **Her body must read on a trackside camera.** Every trackside sample is
 *   measured in pixels and must put at least {@link TRACKSIDE_BODY_FLOOR} of
 *   the frame on her body. Not "more than zero": a child who is four pixels of
 *   shoulder in the corner of the shot is not a child you can see, and
 *   **unoccluded is not the same as legible** — which is the exact distinction
 *   the per-part raycast this replaced could not make. Jim, on the build where
 *   that raycast reported every part unobstructed: *"still can't see a body,
 *   maybe it is hidden behind the head anyway?"*.
 * - **Her body must NOT be demanded of the chase.** She lies on her back feet
 *   first, so her head is between a lens behind her and the rest of her *by
 *   construction* — measured at head ~2500 px, body 0. A clause demanding body
 *   pixels from both cameras would **fail correct behaviour**, and the pressure
 *   would then be to wreck the chase shot to satisfy it. What the chase is held
 *   to instead is that she is **on screen at all**: some of her, head or body.
 *   That is the assertion that would still have caught her riding 26.65 m off
 *   the chute, which is what this file exists for.
 *
 * ### Every part of the ride is covered by some camera
 *
 * A beat where neither camera has her is the kind of hole nobody notices until
 * a child rides it, so three separate things are asserted: **every ridden
 * frame** finds a live shot and a camera to render it with; **every beat in the
 * plan** is live at some point (a camera nobody cuts to is a camera nobody has
 * ever looked through); and **every beat is sampled**, so no beat can pass by
 * never having been measured.
 *
 * ### Measured in pixels, and only where she could possibly be
 *
 * Rays go through the **live** camera — the real object the game would render
 * with, from `Building.rideCameraNow` — but only across the rectangle her world
 * bounding box projects into. Pixels outside it provably cannot be her, so the
 * counts are exact and the check costs a fraction of a full raster. The box is
 * taken `precise`, from vertices rather than from each part's own axis-aligned
 * box: she is lying down, so the loose version is the union of thirty rotated
 * boxes and comes out 2.46 m across for a 1.1 m child, which is three times the
 * rays for the same answer. If any corner of the box is behind the lens the
 * whole frame is rastered instead, because the projection cannot be trusted
 * there.
 *
 * The raster is 240x135 — **landscape**, and the same one the head ~2500 px /
 * body 0 px measurement of the chase was taken on, so the numbers below are
 * comparable with it. A portrait phone widens the field of view
 * (`fitCameraToViewport`), which scales what fraction of the frame she fills
 * but changes nothing about *what is in front of her*, and occlusion is the
 * question here.
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
  readonly kind: 'chase' | 'trackside';
  /** Which beat of the shot plan this was taken during. */
  readonly beat: number;
  /** Which ridden frame it was taken on. */
  readonly frame: number;
  readonly headPixels: number;
  readonly bodyPixels: number;
  readonly framePixels: number;
}

const SHOT_W = 240;
const SHOT_H = 135;

/**
 * The pixel rectangle her bounding box projects into — or the whole frame where
 * the projection cannot be trusted, or `null` if she is off screen entirely.
 *
 * A corner at or behind the near plane projects with a negative `w`, which
 * flips it to the far side of the screen and would silently shrink the search
 * to a rectangle she is *not* in — a measurement quietly reporting 0 px about
 * the wrong part of the frame, which is this project's signature bug. So that
 * case rasters everything: slower, and never wrong.
 */
function searchWindow(
  camera: { matrixWorldInverse: unknown; near: number },
  root: unknown,
): { x0: number; x1: number; y0: number; y1: number } | null {
  // `precise` — from vertices, not from each part's axis-aligned box. She is
  // lying down, so the loose version unions thirty *rotated* boxes and comes out
  // 2.46 m across for a 1.1 m child, tripling the rays for the same answer.
  const box = new Box3().setFromObject(root as never, true);
  if (box.isEmpty()) return null;

  const whole = { x0: 0, x1: SHOT_W - 1, y0: 0, y1: SHOT_H - 1 };
  const corner = new Vector3();
  const view = new Vector3();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < 8; i += 1) {
    corner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    );
    // Camera space first, so "is this behind the lens" is a plain sign test
    // rather than something inferred after the divide has already gone wrong.
    view.copy(corner).applyMatrix4((camera as { matrixWorldInverse: never }).matrixWorldInverse);
    if (view.z > -camera.near) return whole;
    corner.project(camera as never);
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }

  // A pixel of slack each way, so a silhouette grazing the box's edge is
  // clipped by the geometry rather than by the search.
  const toX = (ndc: number): number => Math.round(((ndc + 1) / 2) * SHOT_W - 0.5);
  const toY = (ndc: number): number => Math.round(((1 - ndc) / 2) * SHOT_H - 0.5);
  const x0 = Math.max(0, toX(minX) - 1);
  const x1 = Math.min(SHOT_W - 1, toX(maxX) + 1);
  const y0 = Math.max(0, toY(maxY) - 1);
  const y1 = Math.min(SHOT_H - 1, toY(minY) + 1);
  if (x1 < x0 || y1 < y0) return null; // off screen — 0 px, which is the truth
  return { x0, x1, y0, y1 };
}

function shoot(
  camera: never,
  targets: readonly unknown[],
  model: { root: unknown; head: unknown },
): { headPixels: number; bodyPixels: number; framePixels: number } {
  const caster = new Raycaster();
  let headPixels = 0;
  let bodyPixels = 0;
  const framePixels = SHOT_W * SHOT_H;
  const window = searchWindow(camera as never, model.root);
  if (window === null) return { headPixels: 0, bodyPixels: 0, framePixels };
  for (let iy = window.y0; iy <= window.y1; iy += 1) {
    const ndcY = 1 - (2 * (iy + 0.5)) / SHOT_H;
    for (let ix = window.x0; ix <= window.x1; ix += 1) {
      const ndcX = (2 * (ix + 0.5)) / SHOT_W - 1;
      caster.setFromCamera({ x: ndcX, y: ndcY } as never, camera);
      const hit = caster.intersectObjects(targets as never[], true)[0];
      if (!hit) continue;
      if (!isDescendantOf(hit.object, model.root)) continue;
      if (isDescendantOf(hit.object, model.head)) headPixels += 1;
      else bodyPixels += 1;
    }
  }
  return { headPixels, bodyPixels, framePixels };
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
const shots: Shot[] = [];
// Headless never resizes a window, so the slide's cameras would keep whatever
// aspect they were constructed with. Through the ride's **own** resize path
// rather than by poking `aspect`: that path is what the game runs, and it is
// where the portrait field-of-view rule lives.
building.resizeRideCameras(SHOT_W, SHOT_H);

/**
 * What can stand between a camera and the child.
 *
 * The chute she is lying in, **the castle the chute wraps round**, and her own
 * model. The castle is new with the trackside cameras: the old list was the
 * chute alone, so an eye that ended up behind a tower would have measured a
 * perfectly clear shot. Her own model has to be here because self-occlusion is
 * the entire reason the chase camera cannot show a body.
 */
const occluders = [slide.group, building.gardenRoot, player.model.root];

/** Which beats were ever live, and which were ever measured. */
const beatsLive = new Set<number>();
const beatsSampled = new Set<number>();
let framesWithNoCamera = 0;
const framesByKind = { chase: 0, trackside: 0 };
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

/**
 * How much of the frame the child's **body** must fill on a trackside camera,
 * as a fraction of the whole raster.
 *
 * Deliberately not "more than zero" — see the note at the top on legibility
 * versus occlusion. Read off the built ride rather than picked in the abstract:
 * sampling the canonical seed's ride every 40 frames, the three trackside
 * cameras measure **0.92% to 2.57%** of frame — worst at the very end of the
 * last beat, where she is furthest from that eye. 0.40% sits below that with room for the route to come
 * out a different shape on another seed, and two orders of magnitude above the
 * **0.00%** the chase camera scores — so it cannot be satisfied by accident,
 * and moving the trackside placement badly turns it red.
 *
 * Proved red rather than assumed: dropping the elevation in `slide/cameras.ts`
 * from 55° to 40° — where the sweep says the near hand-rail starts cutting her
 * out — takes the worst sample to 0.00% and this check fails naming the beat.
 */
const TRACKSIDE_BODY_FLOOR = 0.004;

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

  // **Which shot is the game rendering with, this frame?**
  //
  // Asked of the ride, never reconstructed: `rideCameraNow` is the very getter
  // `Game.ts` reads, and `liveShot` is the plan's own answer. A check that
  // recomputed the beat from `t` would agree with itself while the game
  // disagreed with both — which is the shape of all three faults this ride has
  // already produced.
  const liveShot = building.slideShots.liveShot;
  const liveCamera = building.rideCameraNow;
  const beat = liveShot ? building.slideShots.shots.indexOf(liveShot) : -1;
  if (!liveShot || !liveCamera || beat < 0) {
    framesWithNoCamera += 1;
  } else {
    beatsLive.add(beat);
    framesByKind[liveShot.kind] += 1;
  }

  // Sampled rather than every frame: even restricted to her own bounding box
  // this is thousands of intersection tests, and the shot does not change
  // materially between neighbouring frames. Every 60 gives at least two samples
  // inside each of the six beats, and `beatsSampled` below fails outright if
  // that ever stops being true rather than letting a beat pass unmeasured.
  if (liveShot && liveCamera && beat >= 0 && ridingFrames % 60 === 0) {
    // **From the scene root, not from the camera.** `updateMatrixWorld` composes
    // an object's world matrix from its *parent's current* one and refreshes its
    // descendants — it does not walk up. The chase camera hangs off `eyeMount`
    // off `rideMount`, so updating the camera alone leaves it reading whatever
    // those two happened to hold, and `setFromCamera` then shoots from a stale
    // pose. This is why the first run of this measurement reported 0 px of her:
    // not because she was invisible, but because the rays were fired from the
    // wrong place. Exactly the "measured or reconstructed rather than live"
    // trap.
    scene.updateMatrixWorld(true);
    // The trackside camera is deliberately unparented (see `Building`), so the
    // sweep above does not reach it. It keeps its own matrix current on every
    // aim; this asks again rather than assuming so.
    (liveCamera as { updateMatrixWorld(force: boolean): void }).updateMatrixWorld(true);
    const pixels = shoot(liveCamera as never, occluders, player.model as never);
    shots.push({ kind: liveShot.kind, beat, frame: ridingFrames, ...pixels });
    beatsSampled.add(beat);
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

const plan = building.slideShots.shots;
console.log(`  the cut: ${plan.length} beats — ${plan.map((s) => s.kind).join(' | ')}`);
console.log(
  `  ${framesByKind.chase} frames on the chase, ${framesByKind.trackside} trackside, ` +
    `${framesWithNoCamera} with no camera at all`,
);
console.log('  the shot, sampled down the ride (240x135 rays through the live camera):');
for (const shot of shots) {
  const pct = ((shot.bodyPixels / shot.framePixels) * 100).toFixed(2);
  console.log(
    `    beat ${shot.beat} ${shot.kind.padEnd(9)} frame ${String(shot.frame).padStart(3)}  ` +
      `head ${String(shot.headPixels).padStart(5)} px   ` +
      `body ${String(shot.bodyPixels).padStart(5)} px   ` +
      `body is ${pct.padStart(5)}% of frame`,
  );
}

const trackside = shots.filter((s) => s.kind === 'trackside');
const chase = shots.filter((s) => s.kind === 'chase');

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
// --------------------------------------------------- the cut, camera by camera
//
// **Every ridden frame has a camera.** A stretch of chute the plan does not
// cover is a stretch the game renders through whatever was last set, and nobody
// would find it until a child rode it.
if (framesWithNoCamera > 0) {
  complaints.push(
    `${framesWithNoCamera} of ${ridingFrames} ridden frames had no live shot, or no camera ` +
      'to render one with — part of the ride is covered by neither the chase nor a ' +
      'trackside camera',
  );
}

// **Every camera in the plan is cut to.** One that is planned, placed and never
// used is one nobody has ever looked through.
const neverLive = plan.map((_, i) => i).filter((i) => !beatsLive.has(i));
if (neverLive.length > 0) {
  complaints.push(
    `beats ${neverLive.join(', ')} of ${plan.length} were never live — they are in the shot ` +
      'plan but the ride never cuts to them',
  );
}

// **…and every one is measured.** Without this a beat could pass by never having
// been sampled, which is a green light for a shot nothing ever looked at — the
// exact failure this file's own first version shipped.
const neverSampled = plan.map((_, i) => i).filter((i) => !beatsSampled.has(i));
if (neverSampled.length > 0) {
  complaints.push(
    `beats ${neverSampled.join(', ')} were never sampled, so nothing below proves anything ` +
      'about them — the sampling interval has grown too coarse for the beats',
  );
}

// **Her body must read on a trackside camera.** This is the clause Jim's ruling
// buys: the chase is allowed to be all head *because* these carry her body.
if (trackside.length === 0) {
  complaints.push('no trackside shot was measured at all, so her body was never checked');
} else {
  const tooSmall = trackside.filter((s) => s.bodyPixels / s.framePixels < TRACKSIDE_BODY_FLOOR);
  if (tooSmall.length > 0) {
    const worst = tooSmall.reduce((a, b) => (b.bodyPixels < a.bodyPixels ? b : a));
    complaints.push(
      `the child's body is ${((worst.bodyPixels / worst.framePixels) * 100).toFixed(2)}% of the ` +
        `frame on beat ${worst.beat}'s trackside camera (ridden frame ${worst.frame}), against ` +
        `${(TRACKSIDE_BODY_FLOOR * 100).toFixed(2)}% required — ${tooSmall.length} of ` +
        `${trackside.length} trackside samples are under it. The trackside camera is the one ` +
        'that has to show her whole self; if it cannot, nothing in this ride does',
    );
  }
}

// **The chase is held to a different question, on purpose.** It may be all head
// — that is the shape of a rider lying feet-first with a lens behind her, and
// demanding body pixels here would fail correct behaviour. What it may not be
// is *empty*: that is the state she was in for the whole ride at 26.65 m off
// the chute, and it is what this file was written for.
if (chase.length === 0) {
  complaints.push('no chase shot was measured at all, so the chase camera was never checked');
} else {
  const empty = chase.filter((s) => s.headPixels + s.bodyPixels === 0);
  if (empty.length > 0) {
    complaints.push(
      `the child is not on screen at all on ${empty.length} of ${chase.length} chase samples ` +
        `(first at ridden frame ${empty[0]?.frame}) — 0 px of her, head or body. She is ` +
        'allowed to be all head on this camera; she is not allowed to be absent from it',
    );
  }
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

const worstTrackside = trackside.reduce((a, b) => (b.bodyPixels < a.bodyPixels ? b : a));
const bestChaseBody = Math.max(...chase.map((s) => s.bodyPixels));
console.log(
  `check:slide-rider ok — ${ridingFrames} frames ridden, drawn throughout, ` +
    `worst ${worstOffChute.toFixed(2)} m off the chute (trough allows ${ON_CHUTE.toFixed(2)} m), ` +
    `seat within ${worstSeatGap.toFixed(2)} m, ` +
    `reclined throughout (body at most ${worstAlong.toFixed(2)} along the chute, ` +
    `head at most ${worstHeadRise.toFixed(2)} m over her feet and ` +
    `${worstHeadOffChute.toFixed(2)} m from the chute).\n` +
    `  All ${plan.length} beats live and sampled, every frame covered. Her body fills at least ` +
    `${((worstTrackside.bodyPixels / worstTrackside.framePixels) * 100).toFixed(2)}% of the ` +
    `frame on a trackside camera (floor ${(TRACKSIDE_BODY_FLOOR * 100).toFixed(2)}%), and she ` +
    `is on screen on every chase sample — where she is allowed to be all head, and manages ` +
    `${bestChaseBody} px of body at best.`,
);
