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

import {
  Box3,
  Frustum,
  Matrix4,
  type Mesh,
  type Object3D,
  Quaternion,
  Raycaster,
  Vector3,
  type WebGLRenderer,
} from 'three';
import {
  BusJourney,
  JOURNEY_SECONDS,
  LANE_MAX_GRADIENT,
  JOURNEY_GATE_Z,
  PULL_IN_SECONDS,
  SETTLE_SECONDS,
  cameraPoseAt,
  laneHeight,
  planJourneyShots,
} from '../src/world/entrance/BusJourney.ts';
import {
  CAT_BUS_BODY_COLOUR,
  CAT_BUS_CABIN_CEILING_Y,
  CAT_BUS_FLOOR_Y,
  CAT_BUS_LENGTH,
  CAT_BUS_ROOF_COLOUR,
  CAT_BUS_SEAT_COUNT,
  CAT_BUS_SEAT_Y,
} from '../src/world/entrance/catBus.ts';
import { JourneyTitle, JOURNEY_TITLE_TEXT } from '../src/ui/JourneyTitle.ts';
import { JourneyDirector } from '../src/world/entrance/journeyDirector.ts';
import { CAMERA_YAW_DEGREES } from '../src/core/constants.ts';

/**
 * How finely the inside frame is sampled. 24 x 14 is 336 rays — enough that a
 * surface owning a third of the picture cannot hide between them, and few
 * enough to run a handful of times without the check getting slow.
 */
const FRAME_GRID_X = 24;
const FRAME_GRID_Y = 14;

/**
 * **The two windows the ride is actually watched in.**
 *
 * This check used to write `camera.aspect = 16 / 10` and stop, which is the
 * whole reason QA's complaint survived a guard written to catch it: the fault
 * they photographed was on a phone, and nothing here had ever looked at one.
 * A phone is not a narrow desktop — `fitCameraToViewport` opens the vertical
 * field from 52 degrees to **83.9** to fit a wide subject into a tall frame,
 * and inside a 2.7 m cabin that extra 32 degrees can only find floor and
 * ceiling. Landscape passing says nothing whatever about it.
 *
 * Real pixel sizes rather than bare ratios, because the ride is handed a width
 * and a height and derives the ratio itself; handing it a ratio would be this
 * check doing the ride's arithmetic for it.
 */
const VIEWPORTS = [
  { label: 'a 1440x900 desktop', width: 1440, height: 900 },
  { label: 'a 390x844 phone', width: 390, height: 844 },
  // **The tablet is not redundant.** It is at aspect 0.75, between the two
  // above, and the inside shot swings across the rows over a span that ends at
  // 0.9 — so this is the entry that fails if that span is ever stretched out,
  // and a half-swung frame is measurably worse than either end of the swing.
  { label: 'a 768x1024 tablet', width: 768, height: 1024 },
] as const;

/**
 * Fitting the ride's camera to a window is **the ride's own job**, and it is
 * asked to do it rather than told the answer.
 *
 * `BusJourney.render` is where `fitCameraToViewport` — the declared one owner
 * of the portrait rule — is consulted, and it is also where the shot's own
 * `baseFov` is applied. Setting `camera.aspect` and `camera.fov` here instead
 * would be a second copy of that rule inside the check that is supposed to
 * police it, and it would quietly measure a 52-degree lens on a phone.
 */
const noDrawing = { render: () => {} } as unknown as WebGLRenderer;

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
  /**
   * What the inside frame is made of, **kept per window rather than pooled**.
   *
   * Pooling them would let a comfortable desktop average carry a phone that is
   * two thirds bare floor, which is the shape of the fault this is here to
   * catch. One of these per entry in {@link VIEWPORTS}.
   */
  interface Composition {
    /** The biggest share of the whole frame any **single** surface takes. */
    worstShare: number;
    worstName: string;
    /**
     * How much of the barest horizontal third of the frame is **bare bus** —
     * floor pan, shell, the cat's own blank face. Not "any one surface": a
     * child's head filling the top of a phone frame is the picture, and a
     * rule that could not tell the two apart would fail the good shot.
     */
    barestBandShare: number;
    barestBandLabel: string;
    /** How much of the frame is seating, and how much is children. */
    seatShare: number;
    childShare: number;
    said: string;
  }
  const composition = new Map<string, Composition>(
    VIEWPORTS.map((viewport) => [
      viewport.label,
      {
        worstShare: 0,
        worstName: '',
        barestBandShare: 0,
        barestBandLabel: '',
        seatShare: 0,
        childShare: 0,
        said: '',
      },
    ]),
  );
  const probe = new Vector3();
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
    // The occlusion tests below are about what stands between the lens and a
    // child, which is a property of the cabin rather than of the window; they
    // are measured on the desktop frame. The **composition** is measured on
    // every window, further down, because that is the part that changes.
    inside.render(noDrawing, VIEWPORTS[0].width, VIEWPORTS[0].height);
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

    // ------------------------------------------- does the shot read as a bus?
    //
    // **The fault QA refused to sign off was a composition, and no assertion
    // here could see a composition.** Their words, 8 August 2026: *"the bottom
    // 35–40% is featureless cream floor […] there is no seat, window, pillar or
    // ceiling in shot — you cannot tell it is a bus."* Every guard in this file
    // passed on that frame, because each of them asks about one object at a
    // time and the fault was in the proportions of the whole picture.
    //
    // So this one fires a grid of rays through the frame itself and asks what
    // fills it. Three things, all taken straight from the complaint:
    //
    // - **no single surface may own the shot** — one flat mesh covering better
    //   than a third of the frame *is* "featureless cream floor", whichever
    //   mesh it happens to be;
    // - **no single surface may own a band of it either.** QA did not say "the
    //   frame is a third floor", they said *"the **bottom** 35–40% is
    //   featureless cream floor"*, and a picture can be healthy overall while
    //   one horizontal band of it is blank. So the same question is asked of
    //   each third of the frame separately;
    // - **a seat and a child must both be in it** — that is the difference
    //   between the inside of a bus and a corridor.
    //
    // **And all of it is asked once per window.** The version that shipped set
    // `aspect = 16 / 10` and never looked further, so the one frame QA actually
    // photographed — a phone — was outside everything this file could see.
    //
    // Sampled rather than every frame: 336 rays per window is not free, and the
    // camera is rigidly mounted in the bus, so the composition changes only as
    // the world outside does.
    if (insideFrames % 40 === 1) {
      for (const viewport of VIEWPORTS) {
        const seen = composition.get(viewport.label);
        if (!seen) continue;
        inside.render(noDrawing, viewport.width, viewport.height);
        inside.camera.updateMatrixWorld(true);

        const perSurface = new Map<Object3D, number>();
        const perKind = new Map<string, number>();
        /** Rays that found bare bus, per horizontal third: 0 is the bottom. */
        const bareInBand = [0, 0, 0];
        const bandRays = [0, 0, 0];
        let rays = 0;
        for (let gx = 0; gx < FRAME_GRID_X; gx += 1) {
          for (let gy = 0; gy < FRAME_GRID_Y; gy += 1) {
            const ny = ((gy + 0.5) / FRAME_GRID_Y) * 2 - 1;
            probe
              .set(((gx + 0.5) / FRAME_GRID_X) * 2 - 1, ny, 0.5)
              .unproject(inside.camera)
              .sub(inside.camera.position)
              .normalize();
            sight.set(inside.camera.position, probe);
            sight.near = inside.camera.near;
            sight.far = 80;
            // **What the camera can actually see**, which is not the same as
            // what is there: `Raycaster` ignores `visible`, and the ride hides
            // the lower body's outline shell for exactly these frames
            // (`setCutaway`). A guard that counted hidden geometry would report
            // the cabin as a solid box and would have passed the shot it is
            // here to fail.
            const hits = sight
              .intersectObject(inside.scene, true)
              .filter((hit) => isDrawn(hit.object));
            let landedOn: Object3D | null = null;
            let throughGlass: Object3D | null = null;
            for (const hit of hits) {
              if (seeThrough(hit.object)) {
                // **A ray that crosses the glass is looking out of a window**,
                // and that is the single strongest "this is a bus" signal there
                // is. Every previous version of this dropped see-through hits
                // and then scored the ray as *out of the bus*, which is why
                // `describeInsideHit`'s `cat-bus-window` arm was unreachable
                // and glazing has always measured exactly 0%.
                if (!throughGlass && busPartOf(hit.object) === 'cat-bus-window') {
                  throughGlass = hit.object;
                }
                continue;
              }
              landedOn = hit.object;
              break;
            }
            rays += 1;
            const band = ny < -1 / 3 ? 0 : ny < 1 / 3 ? 1 : 2;
            bandRays[band] = (bandRays[band] ?? 0) + 1;

            const surface = landedOn ?? throughGlass;
            const kind = landedOn
              ? describeInsideHit(landedOn, seats)
              : throughGlass
                ? 'out of a window'
                : 'out of the bus';
            perKind.set(kind, (perKind.get(kind) ?? 0) + 1);
            if (kind === 'the floor' || kind === 'bare bodywork') {
              bareInBand[band] = (bareInBand[band] ?? 0) + 1;
            }
            if (!surface) continue;
            perSurface.set(surface, (perSurface.get(surface) ?? 0) + 1);
          }
        }

        const nameOf = (object: Object3D): string =>
          object.name || `(unnamed ${(object as Mesh).geometry?.type ?? '?'})`;
        for (const [object, count] of perSurface) {
          const share = count / rays;
          if (share > seen.worstShare) {
            seen.worstShare = share;
            seen.worstName = nameOf(object);
          }
        }
        const BAND_NAMES = ['the bottom third', 'the middle third', 'the top third'];
        for (let band = 0; band < bandRays.length; band += 1) {
          const total = bandRays[band] ?? 0;
          if (total === 0) continue;
          const share = (bareInBand[band] ?? 0) / total;
          if (share > seen.barestBandShare) {
            seen.barestBandShare = share;
            seen.barestBandLabel = BAND_NAMES[band] ?? `band ${band}`;
          }
        }
        const shareOf = (kind: string): number => (perKind.get(kind) ?? 0) / rays;
        seen.seatShare = Math.max(seen.seatShare, shareOf('a seat'));
        seen.childShare = Math.max(seen.childShare, shareOf('a child'));
        if (seen.said === '') {
          seen.said = [...perKind]
            .sort((a, b) => b[1] - a[1])
            .map(([kind, count]) => `${kind} ${((100 * count) / rays).toFixed(0)}%`)
            .join(', ');
        }
      }
    }
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

  if (nearestToTheLens < 0.3) {
    fouls.push(
      `something is ${nearestToTheLens.toFixed(2)} m from the inside camera's lens — it is buried in ` +
        'geometry, and the view inside the bus is whatever that surface happens to be',
    );
  }

  // -------------------------------------------------- the shot reads as a bus
  //
  // **Two assertions used to stand here and both have been replaced, because
  // the property they enforced is the one Jim overruled.** They were
  // *"a ray towards at least four children must land on a child"* and
  // *"no bodywork may stand between the camera and a passenger"*, and together
  // they meant: fill the frame with faces. That is precisely the shot QA would
  // not sign off — from the front of the cabin looking aft, faces are all there
  // is, and a bus made only of faces is not recognisably a bus.
  //
  // Turning the camera round to look forward makes both of them impossible to
  // satisfy by construction: the seats face the nose, so every sightline to a
  // child behind the front row passes through the back of somebody's seat, and
  // a seat back is bodywork. Keeping them would have meant keeping the shot.
  //
  // **They are not weakened, they are aimed at the real complaint instead.**
  // What is measured now is the composition of the frame, which is what the
  // complaint was about, and the old failures are still caught: a camera buried
  // in a wall is one surface owning the whole frame, and a camera pointed away
  // from the passengers is `childShare` at zero.
  //
  // **Every one of them is asked once per window.** Landscape was fixed on 8
  // August and portrait was not, and a check that pooled the two would have
  // reported the average of a good shot and QA's own screenshot.
  for (const viewport of VIEWPORTS) {
    const seen = composition.get(viewport.label);
    if (!seen) continue;
    said.push(`inside, on ${viewport.label}, the shot is made of: ${seen.said || 'nothing measured'}`);
    said.push(
      `  its largest single surface is ${seen.worstName || '(none)'} at ` +
        `${(100 * seen.worstShare).toFixed(0)}% of the frame; its barest band is ` +
        `${seen.barestBandLabel || 'none'} at ${(100 * seen.barestBandShare).toFixed(0)}% bare bus; ` +
        `seating ${(100 * seen.seatShare).toFixed(0)}%, children ${(100 * seen.childShare).toFixed(0)}%`,
    );

    if (seen.worstShare > 0.3) {
      fouls.push(
        `on ${viewport.label}, one surface — ${seen.worstName} — fills ` +
          `${(100 * seen.worstShare).toFixed(0)}% of the view inside the bus. That is a wall or a floor ` +
          'with nothing on it, which is what "you cannot tell it is a bus" looks like from the inside',
      );
    }
    // **QA's sentence was about a band, not about the whole frame** — *"the
    // bottom 35–40% is featureless cream floor"* — and a shot can hold a
    // perfectly healthy overall mix while one third of it is a blank slab,
    // which is exactly what a phone's widened lens produces in here.
    //
    // **Bare bus, not "any one surface".** The obvious version of this rule
    // asks whether one *mesh* owns a band, and it fails the good shot: swung
    // across the rows, a child's head can be a fifth of a phone frame and half
    // its top third, and that head is the picture. What may not own a band is
    // floor pan and bodywork, which is what QA was looking at.
    //
    // Half, because half is where a band stops carrying a surface and becomes
    // one. Landscape sits at 23% and the phone at 32%; the framing this
    // replaced was at 88%.
    if (seen.barestBandShare > 0.5) {
      fouls.push(
        `on ${viewport.label}, ${seen.barestBandLabel} of the view inside the bus is ` +
          `${(100 * seen.barestBandShare).toFixed(0)}% bare floor and bodywork — that band has nothing ` +
          'in it, which is QA\'s "the bottom 35–40% is featureless cream floor" whichever way up it ' +
          'happens to be',
      );
    }
    if (seen.seatShare < 0.05) {
      fouls.push(
        `on ${viewport.label}, seating is ${(100 * seen.seatShare).toFixed(0)}% of the view inside the ` +
          'bus — there is no seat in shot, and a vehicle with no seats in it does not read as a bus ' +
          'however many children are aboard',
      );
    }
    if (seen.childShare < 0.05) {
      fouls.push(
        `on ${viewport.label}, children are ${(100 * seen.childShare).toFixed(0)}% of the view inside ` +
          'the bus — the camera is not pointed at the passengers, which is the whole reason the inside ' +
          'shot exists',
      );
    }
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

/**
 * Would this actually be drawn?
 *
 * `Raycaster` does not consult `visible` — it walks the graph and hits whatever
 * geometry is there. The ride hides the lower body's outline shell for the
 * inside beats, so a check that did not ask this would measure a cabin the
 * camera cannot see and pass the very shot it exists to fail.
 */
function isDrawn(node: Object3D): boolean {
  let at: Object3D | null = node;
  while (at) {
    if (!at.visible) return false;
    at = at.parent;
  }
  return true;
}

/**
 * Can a lens see past this? Glass can be looked through; bodywork cannot.
 *
 * Its own function because two separate things ask it — the sightline to a
 * child, and the composition grid — and they disagreed once already, which is
 * how a window came to be scored as "out of the bus".
 */
function seeThrough(object: Object3D): boolean {
  const material = (object as Mesh).material as
    | { transparent?: boolean; opacity?: number }
    | undefined;
  return material?.transparent === true && (material.opacity ?? 1) < 0.9;
}

/** Which named part of the bus `object` belongs to, or '' for anything else. */
function busPartOf(object: Object3D): string {
  let at: Object3D | null = object;
  while (at) {
    if (at.name.startsWith('cat-bus-')) return at.name;
    at = at.parent;
  }
  return '';
}

/** What a ray landing on `object` has found, in words a foul can use. */
function describeInsideHit(object: Object3D, seats: readonly Object3D[]): string {
  if (seats.some((seat) => isDescendant(object, seat))) return 'a child';
  switch (busPartOf(object)) {
    case 'cat-bus-cushion':
    case 'cat-bus-backrest':
      return 'a seat';
    case 'cat-bus-floor-pan':
      return 'the floor';
    case 'cat-bus-aisle-paw':
      return 'a paw print on the floor';
    case 'cat-bus-grab-rail':
      return 'a grab rail';
    case 'cat-bus-ceiling-lamp':
      return 'a ceiling lamp';
    case 'cat-bus-pillar':
      return 'a pillar';
    // Reached only by an **opaque** pane. A real one is see-through, and a ray
    // that crosses it is scored `out of a window` by the caller instead — so
    // this arm firing means the glass has stopped being glass.
    case 'cat-bus-window':
      return 'a solid pane where the glazing should be';
    case 'cat-bus-shell-lower':
    case 'cat-bus-shell-upper':
    case 'cat-bus-face':
      return 'bare bodywork';
    case 'cat-bus-driver':
      return 'the driver';
    default:
      return 'the lane outside';
  }
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
     * […] windows should only start about halfway up the sides"*.
     *
     * **Measured against the children who are sitting there, not against a
     * height.** The first version of this asserted that no glass reached below
     * the seat cushions — and it *passed with the old floor-to-ceiling
     * windows*, because the old sill sat 0.076 m above the cushion. A guard that
     * cannot fail on the exact geometry it was written for is the failure this
     * feature has shipped three times, and it took a mutation to find it here
     * too.
     *
     * So the rule is the design intent stated against built objects: **the solid
     * panel below the glass covers the children's bodies, and the glass shows
     * their faces**. The lowest chin in the bus is found from the built skulls;
     * glass starting below that is glass running down past the children, which
     * is what "all the way down to the floor" means from outside.
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

      // Two landmarks off the built, seated children — one for each way the
      // sill can be wrong.
      let lowestShoulder = Infinity;   // top of a torso: where a body stops
      let skullBottom = Infinity;      // a chin
      let skullTop = -Infinity;
      for (const seat of seatNodes) {
        let skull: Object3D | null = null;
        let torso: Object3D | null = null;
        seat.traverse((node) => {
          if (!skull && node.name === 'skull') skull = node;
          if (!torso && node.name === 'torso') torso = node;
        });
        if (torso) lowestShoulder = Math.min(lowestShoulder, boxIn(torso, toBus).max.y);
        if (skull) {
          const box = boxIn(skull, toBus);
          skullBottom = Math.min(skullBottom, box.min.y);
          skullTop = Math.max(skullTop, box.max.y);
        }
      }

      /** A little slack, so a sill grazing a shoulder is not a foul. */
      const SHOULDER_SLACK = 0.08;
      /**
       * How much of a head the panel may hide before the faces stop reading.
       *
       * The jaw, and no more. The mouth is painted 60% of the way down the face
       * canvas, so hiding much beyond a quarter of the skull starts eating the
       * expression — and the whole reason this bus has glass at all is Stage B's
       * ask that you can see the children being excited.
       */
      const MOST_OF_A_HEAD_HIDDEN = 0.4;

      const skullHeight = skullTop - skullBottom;
      const hiddenFraction = skullHeight > 0 ? (glass.min.y - skullBottom) / skullHeight : 0;

      said.push(
        `glazing starts at ${glass.min.y.toFixed(3)} m, ${upTheSide.toFixed(0)}% up the bus's side, ` +
          `${(glass.min.y - lowestShoulder).toFixed(3)} m from the lowest shoulder aboard, ` +
          `hiding ${(hiddenFraction * 100).toFixed(0)}% of a head (${panes} panes)`,
      );

      if (!Number.isFinite(lowestShoulder) || !Number.isFinite(skullBottom)) {
        fouls.push('found no seated children to measure the glazing against');
      } else {
        // Too low: glass running down past their bodies to the floor.
        if (glass.min.y < lowestShoulder - SHOULDER_SLACK) {
          fouls.push(
            `glazing reaches down to ${glass.min.y.toFixed(3)} m, ` +
              `${(lowestShoulder - glass.min.y).toFixed(3)} m below the lowest seated child's ` +
              `shoulders at ${lowestShoulder.toFixed(3)} — the windows run down past the children's ` +
              `bodies towards the floor instead of starting up the side of the bus (they start ` +
              `${upTheSide.toFixed(0)}% up it)`,
          );
        }
        // Too high: a bus you cannot see the children in, which is the fault the
        // glazing was cut into the bodywork to fix in the first place.
        if (hiddenFraction > MOST_OF_A_HEAD_HIDDEN) {
          fouls.push(
            `the panel below the glass hides ${(hiddenFraction * 100).toFixed(0)}% of a seated ` +
              `child's head — over the ${(MOST_OF_A_HEAD_HIDDEN * 100).toFixed(0)}% that still ` +
              'leaves a face to look at. The windows exist so the children can be seen through them.',
          );
        }
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

// ------------------------------------------------------ the wait, and the gate
/**
 * **What the screen does when the park is not ready and the bus has to wait.**
 *
 * QA measured the shipped behaviour under 4x CPU throttling: over 6.4 s of
 * waiting, **1 distinct camera pose in 51 samples, 1 bus transform, and the
 * title frozen mid-jump**, against 270 camera poses and 262 title layouts during
 * the ride itself. It read as a crash. On seed 5 generation finished at ride
 * t = 19.04 s on an M4 Pro, so this is a state real hardware reaches with under
 * a second to spare, not a theoretical branch.
 *
 * Nothing measured the wait at all, because nothing ever passed
 * `travelling = false` — the overrun was only ever wired up in `main.ts`, where
 * no check can reach. That is the same gap that let the whole cat bus ship as
 * dead code for twelve days.
 *
 * Two things are asserted, and they are the two Jim named:
 *
 * - the bus **reaches the gate**, rather than stopping in open lane wherever
 *   twenty seconds happened to leave it;
 * - the presentation **stays alive** — the clock that drives anything drawn
 *   keeps running while the lane clock is stopped.
 */
{
  const waiting = new BusJourney({
    skin: 0xffd9be,
    hair: 0x8b5a3c,
    outfit: 0xff9fc4,
    hairStyle: 'bunches',
  });
  const waitingBus = waiting.scene.getObjectByName('cat-bus');

  // Run the ride out first — the wait only exists after the road does.
  for (let t = 0; t <= JOURNEY_SECONDS + 1e-9; t += STEP) waiting.update(STEP);
  const zWhenTheRideRanOut = waiting.busPositionZ;
  const elapsedWhenTheRideRanOut = waiting.elapsed;
  const animationWhenTheRideRanOut = waiting.animationTime;

  // Then wait, the way `main.ts` does while `JourneyDirector.overrunning`.
  const busPositions = new Set<string>();
  const cameraPoses = new Set<string>();
  const titlePositions = new Set<string>();
  const idleTitle = new JourneyTitle();
  const idleLetters: { style?: { transform?: string } }[] = [];
  const gather = (node: { children?: unknown[] }): void => {
    const kids = Array.isArray(node.children) ? node.children : [];
    if (kids.length === 0) idleLetters.push(node as { style?: { transform?: string } });
    for (const kid of kids) gather(kid as { children?: unknown[] });
  };
  const idleBody = (globalThis as { document?: { body?: { children?: unknown[] } } }).document?.body;
  const idleRoot = Array.isArray(idleBody?.children) ? idleBody.children.at(-1) : undefined;
  if (idleRoot) gather(idleRoot as { children?: unknown[] });

  /**
   * **Long enough to outlast the manoeuvre**, which is the whole point.
   *
   * At 8 s this ran for twice {@link PULL_IN_SECONDS} and reported the wait as
   * comfortably alive — 310 bus positions, 241 camera poses — on a build whose
   * *stopped* idle holds **one** camera pose. The pull-in is a moving bus with a
   * camera following it, so every liveness number is carried by it, and the
   * state QA actually photographed as a crash begins where it ends. Measured on
   * the running game under QA's own 4x throttle, the split was 301 poses over
   * the 4.0 s pull-in against 1 over the 1.7 s after it.
   *
   * So the wait is run well past the stop and the two halves are asserted
   * **separately**. Two of the five overruns measured on real hardware (6.34 and
   * 7.73 s) reach the settled half, so this is a state the family gets to.
   */
  const WAIT_SECONDS = PULL_IN_SECONDS * 3;
  /** Which half of the wait a frame belongs to — the stop is the boundary. */
  type Half = 'pulling in' | 'stopped at the gate';
  const halves: Half[] = ['pulling in', 'stopped at the gate'];
  const busPositionsIn = new Map<Half, Set<string>>();
  const cameraPosesIn = new Map<Half, Set<string>>();
  const titlePositionsIn = new Map<Half, Set<string>>();
  const framesIn = new Map<Half, number>();
  for (const half of halves) {
    busPositionsIn.set(half, new Set());
    cameraPosesIn.set(half, new Set());
    titlePositionsIn.set(half, new Set());
    framesIn.set(half, 0);
  }

  /** The bearing the ride ends on — the park camera's, which the cut lands on. */
  const endBearing = cameraPoseAt(JOURNEY_SECONDS).yaw;
  let worstBearingDrift = 0;

  for (let i = 0; i < WAIT_SECONDS / STEP; i += 1) {
    waiting.update(STEP, false);
    waiting.scene.updateMatrixWorld(true);
    // **The clock `main.ts` hands the title.** Written as the same expression,
    // so what is measured here is what is drawn there.
    idleTitle.update(waiting.animationTime);
    // Taken from the ride's own idle clock rather than counted off `i`, so the
    // split lands where the bus actually stops.
    const half: Half = waiting.waited <= PULL_IN_SECONDS ? 'pulling in' : 'stopped at the gate';
    framesIn.set(half, (framesIn.get(half) ?? 0) + 1);
    if (waitingBus) {
      const at = waitingBus.getWorldPosition(new Vector3());
      const where = `${at.x.toFixed(3)},${at.y.toFixed(3)},${at.z.toFixed(3)}`;
      busPositions.add(where);
      busPositionsIn.get(half)?.add(where);
    }
    const eye = waiting.camera.position;
    const from = `${eye.x.toFixed(3)},${eye.y.toFixed(3)},${eye.z.toFixed(3)}`;
    cameraPoses.add(from);
    cameraPosesIn.get(half)?.add(from);
    // **Alive is not enough — it has to stay on the park's bearing.**
    //
    // The hand-over is a cut from this pose to the park camera's, and it can
    // fall on *any* frame of the wait, because it happens the instant
    // generation finishes. So whatever keeps the shot alive must not be
    // something that swings it round: an idle that orbited would pass every
    // liveness assertion above and turn the arrival into a jump cut, on a
    // schedule set by how slow the machine is.
    //
    // Measured as the camera's own bearing about the bus it is watching, off
    // the built camera, against the bearing the ride ended on.
    const bearing = Math.atan2(eye.x, eye.z - waiting.busPositionZ);
    let off = (bearing - endBearing) % (Math.PI * 2);
    if (off > Math.PI) off -= Math.PI * 2;
    if (off < -Math.PI) off += Math.PI * 2;
    worstBearingDrift = Math.max(worstBearingDrift, Math.abs(off));
    const layout = idleLetters.map((letter) => letter.style?.transform ?? '').join('|');
    titlePositions.add(layout);
    titlePositionsIn.get(half)?.add(layout);
  }

  const restedAt = waiting.busPositionZ;
  const noseAt = restedAt - CAT_BUS_LENGTH / 2;
  const shortOfTheGate = Math.abs(noseAt - JOURNEY_GATE_Z);

  said.push(
    `waiting ${WAIT_SECONDS.toFixed(1)}s past the end of the ride: the bus rolled from ` +
      `${zWhenTheRideRanOut.toFixed(1)} to ${restedAt.toFixed(1)} m, nose ${shortOfTheGate.toFixed(2)} m ` +
      `from the gate at ${JOURNEY_GATE_Z}`,
  );
  said.push(
    `while waiting: ${busPositions.size} bus positions, ${cameraPoses.size} camera poses, ` +
      `${titlePositions.size} title layouts over ${Math.round(WAIT_SECONDS / STEP)} frames`,
  );

  // **At the gate.** A bus length of slack, because "at the gate" is a place a
  // vehicle stands, not a coordinate — but 30 m of open tarmac is not it.
  if (shortOfTheGate > CAT_BUS_LENGTH) {
    fouls.push(
      `after ${WAIT_SECONDS.toFixed(1)}s of waiting the bus's nose is ${shortOfTheGate.toFixed(1)} m from the ` +
        `gate — it is idling in open lane, and a bus standing still in the middle of a road reads as ` +
        'broken down rather than as waiting',
    );
  }
  if (Math.abs(restedAt - zWhenTheRideRanOut) < 1) {
    fouls.push(
      `the bus moved ${Math.abs(restedAt - zWhenTheRideRanOut).toFixed(2)} m in ${WAIT_SECONDS.toFixed(1)}s of ` +
        'waiting — it stopped dead the moment the road ran out instead of pulling in',
    );
  }

  // **Alive — in each half of the wait on its own.**
  //
  // Each of the three things QA found frozen, measured separately, because they
  // froze for one reason and could be revived one at a time. And each measured
  // once per half, because a number taken across the whole wait is dominated by
  // the pull-in: a camera following a bus that is still rolling moves whatever
  // else is broken, so the totals cannot see a stopped bus's frozen shot.
  //
  // The bar is a tenth of that half's own frames. A screen that changes on fewer
  // than one frame in ten is not "subtly alive", it is stuttering — and against
  // QA's measured 1-in-51 it is still an order of magnitude of headroom.
  for (const half of halves) {
    const frames = framesIn.get(half) ?? 0;
    if (frames === 0) {
      fouls.push(
        `no frames of the wait were spent ${half} — the two halves of the idle cannot both be ` +
          'measured, so one of these assertions is running against nothing',
      );
      continue;
    }
    const lively = Math.max(10, Math.round(frames * 0.1));
    const buses = busPositionsIn.get(half)?.size ?? 0;
    const eyes = cameraPosesIn.get(half)?.size ?? 0;
    const layouts = titlePositionsIn.get(half)?.size ?? 0;
    said.push(
      `  while ${half} (${frames} frames): ${buses} bus positions, ${eyes} camera poses, ` +
        `${layouts} title layouts`,
    );
    if (buses < lively) {
      fouls.push(
        `while ${half} the bus took ${buses} distinct positions over ${frames} frames — it is a ` +
          'still image, which is what QA read as a crash',
      );
    }
    if (eyes < lively) {
      fouls.push(
        `while ${half} the camera took ${eyes} distinct poses over ${frames} frames — the shot is ` +
          'frozen. One pose held for the whole of a wait is the exact number QA reported as a crash',
      );
    }
    if (layouts < lively) {
      fouls.push(
        `while ${half} the title took ${layouts} distinct layouts over ${frames} frames — it is ` +
          'stopped mid-jump with its letters at scattered heights, which is the loudest "this has ' +
          'crashed" signal on the screen',
      );
    }
  }

  said.push(
    `over the whole wait the camera stayed within ` +
      `${((worstBearingDrift * 180) / Math.PI).toFixed(3)} degrees of the bearing the ride ended on`,
  );
  if (worstBearingDrift > 0.02) {
    fouls.push(
      `while waiting, the camera swung ${((worstBearingDrift * 180) / Math.PI).toFixed(1)} degrees off ` +
        'the bearing the ride ended on. The park is handed over the instant generation finishes, ' +
        'which can be any frame of the wait, so an idle that moves the camera round turns the ' +
        'arrival into a jump cut on a schedule set by how slow the machine is',
    );
  }

  // **And the distinction that causes it is real**: the lane clock must stop
  // (she is not being driven anywhere) while the animation clock must not. If
  // these two ever became the same number, the fix above would be undone and
  // every assertion here would still pass.
  said.push(
    `while waiting the lane clock held at ${waiting.elapsed.toFixed(2)}s and the animation clock ran ` +
      `on to ${waiting.animationTime.toFixed(2)}s`,
  );
  if (waiting.elapsed !== elapsedWhenTheRideRanOut) {
    fouls.push(
      `the lane clock ran on from ${elapsedWhenTheRideRanOut.toFixed(2)} to ` +
        `${waiting.elapsed.toFixed(2)}s while the bus was waiting — the ride believes it is still ` +
        'travelling, and the orbit will swing off the park camera\'s bearing before hand-over',
    );
  }
  if (waiting.animationTime - animationWhenTheRideRanOut < WAIT_SECONDS * 0.9) {
    fouls.push(
      `the animation clock advanced only ` +
        `${(waiting.animationTime - animationWhenTheRideRanOut).toFixed(2)}s over ${WAIT_SECONDS.toFixed(1)}s of ` +
        'waiting — the one clock that must never stop has stopped',
    );
  }

  idleTitle.dispose();
  waiting.dispose();
}

for (const line of said) console.log(`  ${line}`);
if (fouls.length > 0) {
  console.error('\ncheck:bus-journey FAILED');
  for (const foul of fouls) console.error(`  - ${foul}`);
  process.exit(1);
}
console.log('\ncheck:bus-journey passed');
