/**
 * **The Rail Race camera, measured on a built ring: the one owner of every
 * question `check:rail-race` asks about the picture.**
 *
 * Moved here out of `scripts/check-rail-race.mts` verbatim, so that the park
 * acceptance loop (`scripts/park-attempt.mts`) can ask exactly the same
 * questions of each attempt that the check asks of the shipped park. What the
 * camera can promise depends on the ring's shape — its tightest bends and where
 * they fall — and the ring's shape is a per-park decision (it follows the
 * park's boundary), so a park whose ring the camera cannot frame is a failed
 * attempt, not a shipped defect.
 *
 * `rig` is the caller's, and is left resized to whatever the last question
 * asked; the check goes on to use it.
 */
import { Vector3 } from 'three';
import { PARK_BOUNDARY } from '../../src/world/boundary.ts';
import { PLAYER_LANE, type RailRaceRoute } from '../../src/world/railRace/route.ts';
import {
  AHEAD,
  CHASE_CEILING,
  SIDE_SCROLLER_FLOOR,
  type RaceCamera,
} from '../../src/world/railRace/camera.ts';

/** The two window shapes the pose clauses sweep; `check:rail-race`'s face clauses sweep them too. */
export const POSES: readonly { readonly name: string; readonly w: number; readonly h: number }[] = [
  { name: 'monitor', w: 1280, h: 720 },
  { name: 'phone', w: 390, h: 844 },
];

export interface RaceCameraFindings {
  /** The lines the check prints, in order. */
  readonly said: readonly string[];
  /** Every clause that failed, as a sentence a person can act on. */
  readonly problems: readonly string[];
}

export function measureRaceCamera(route: RailRaceRoute, rig: RaceCamera): RaceCameraFindings {
  const said: string[] = [];
  const problems: string[] = [];
  const say = (line: string): void => {
    said.push(line);
  };
  const require = (ok: boolean, complaint: string): void => {
    if (!ok) problems.push(complaint);
  };
  const point = new Vector3();

  // --- does the camera build the picture it promises? --------------------------
  //
  // The rig has no rig measurements left to read off. It is handed two things —
  // how many metres of track in front of the rider must reach the right-hand
  // edge, and where across the picture the rider sits — and solves its own
  // distance, aim and lens from them, to a different answer for every shape of
  // window. So the first half of this asserts the *picture*, read straight off
  // the built projection matrix, rather than the numbers that produced it.
  //
  // The second half still asserts the thing the coaster learned the hard way
  // (every ride camera in this park faced backwards for weeks, at
  // dot(forward, travel) = -1.000, and it was found by measuring rather than by
  // reading). What has changed is that the view is now *deliberately* angled a
  // little down the track — that angle is what lets the rig stand close enough
  // for a phone — so the assertion is a bounded range rather than a zero. The
  // bound is what keeps it a guard: a camera that had flipped measures -1.000 and
  // a camera that had become a chase measures +1.000, and the range below admits
  // neither. It is also swept at two window shapes now, because the rig is a
  // different rig at each and measuring one would leave the other unmeasured.
  //
  // ### Watched to fail, on 1 August 2026
  //
  // ```
  // the shipped pre-fix rig put back    portrait spans the same 37.6 m as a
  //                                     monitor; 10.4 px/m; 122° of fisheye in a
  //                                     sliver; and it aimed 9.6° BACKWARDS of
  //                                     the rider — which the old check, taking
  //                                     its bearing from the middle of the frame
  //                                     rather than from the rider, scored 0.000
  // the aim swung the other way          0.0 m of road ahead, rider 460% across
  // the rider asked for off-screen left  rider -55% across
  // AHEAD raised to 75 m                 7.3 px/m, aims 23.2° backwards
  // AHEAD cut to 9 m                     9.9 m of road ahead
  // ```
  //
  // The chase-camera ceiling (`mostAngled < 0.45`, about 27°) is the one thing
  // here no mutation reached: the rig measures 2.5° on a monitor and 14.5° on a
  // phone, and nothing that can be done to the two inputs pushes it past 27
  // without tripping something else first. It is honestly a ceiling on the design
  // rather than a detector of a fault, and it is what would catch a future rewrite
  // that puts an explicit swing dial back on the rig.

  const probe = new Vector3();

  /**
   * The rider's own lane at `s`, at the height the rider themself rides at.
   *
   * **Asked of the rig, never recomputed here.** This was a copy of
   * `RaceCamera.ringPoint`'s formula, with a comment promising it stayed in step
   * with it. It did not: the ring stopped being level, `route.base` became
   * `route.baseAt(s)`, and the copy went on reading `route.base` — `undefined`.
   * Every `project` through it returned `NaN`, `NaN >= 1` is false, and so **the
   * seven assertions below about where the rider sits in the picture reported
   * `NaN%` and could not fail.** That is CLAUDE.md's two-definitions disease and
   * its check-that-cannot-fail disease in one place, and the fix is the one that
   * file prescribes: one owner, everyone else asks.
   *
   * Measuring at the rider's height and not the rail's still matters for the
   * reason it always did — a tilted camera pushes a raised off-centre point
   * further off centre — but that height is now the rig's business, not this
   * file's.
   */
  const onLane = (s: number, into: Vector3): Vector3 => rig.riderPoint(s, into);

  /** Where the track `s` metres along lands across the screen, -1 left, +1 right. */
  const across = (s: number): number => onLane(s, probe).project(rig.camera).x;

  interface Framing {
    /** The rider's own place across the picture, 0 at the left edge. */
    riderX: number;
    /** Metres of track in front of the rider that are on screen. */
    ahead: number;
    /** Metres of world the whole picture spans, at the rider. */
    frameWidth: number;
    fov: number;
  }

  function framing(width: number, height: number): Framing {
    rig.resize(width, height);
    rig.reset(0);
    const start = route.startDistance;
    // Walked, not bisected. The track is a ring, so far enough round it comes back
    // into shot from behind the camera and `project` starts answering about a
    // point that is behind the lens — bisecting straight off would have found one
    // of those and reported 200 m of visible road, which it did.
    const heading = new Vector3();
    rig.camera.getWorldDirection(heading);
    const walk = new Vector3();
    let ahead = 0;
    for (let s = 0.25; s <= 140; s += 0.25) {
      onLane(start + s, walk).sub(rig.camera.position);
      if (walk.dot(heading) <= 0) break;
      if (across(start + s) >= 1) {
        let near = ahead;
        let far = s;
        for (let i = 0; i < 40; i += 1) {
          const mid = (near + far) / 2;
          if (across(start + mid) < 1) near = mid;
          else far = mid;
        }
        ahead = (near + far) / 2;
        break;
      }
      ahead = s;
    }
    // How much world the picture spans: step one metre sideways from the rider and
    // see how much of the screen that took.
    const right = new Vector3().setFromMatrixColumn(rig.camera.matrixWorld, 0).normalize();
    const stepped = onLane(start, new Vector3()).addScaledVector(right, 1).project(rig.camera).x;
    return {
      riderX: (across(start) + 1) / 2,
      ahead,
      frameWidth: 2 / (stepped - across(start)),
      fov: rig.camera.fov,
    };
  }

  const SHAPES: readonly { readonly name: string; readonly w: number; readonly h: number }[] = [
    { name: 'monitor 1280x720', w: 1280, h: 720 },
    { name: 'laptop 1440x900', w: 1440, h: 900 },
    { name: 'square 900x900', w: 900, h: 900 },
    { name: 'tablet 820x1180', w: 820, h: 1180 },
    { name: 'phone 390x844', w: 390, h: 844 },
    { name: 'sliver 320x900', w: 320, h: 900 },
  ];

  say('');
  const frames = SHAPES.map((shape) => {
    const f = framing(shape.w, shape.h);
    say(
      `${shape.name.padEnd(17)} rider ${(f.riderX * 100).toFixed(1).padStart(5)}% across   ` +
        `${f.ahead.toFixed(1).padStart(5)} m of track ahead   ` +
        `picture ${f.frameWidth.toFixed(1).padStart(5)} m wide   ` +
        `${(shape.w / f.frameWidth).toFixed(1).padStart(5)} px/m   ` +
        `fov ${f.fov.toFixed(0).padStart(3)}°`,
    );
    return f;
  });

  const monitor = frames[0]!;
  const phone = frames[4]!;

  // The promise the retired 2D game made and this rig inherited: the same amount
  // of track is *coming* whatever shape the window is, so a hazard does not arrive
  // with less warning on a phone than on a monitor. It used to be kept by fixing
  // the metres either side of the middle of the frame; it is now kept about the
  // rider, which is where it always meant something.
  const leastAhead = Math.min(...frames.map((f) => f.ahead));
  say(
    `                  ahead ${leastAhead.toFixed(1)}–` +
      `${Math.max(...frames.map((f) => f.ahead)).toFixed(1)} m across every shape ` +
      `(a monitor gets ${monitor.ahead.toFixed(1)} m)`,
  );
  // The floor is AHEAD itself, not a historical figure: AHEAD is the metres-ahead
  // promise this rig is solved from, and AHEAD_SCREEN_X insets the target point
  // short of the true edge, so every window shape shows a little more than AHEAD
  // — the promise is broken only if a shape shows *less*. (Previously pinned to
  // 26.1 m, the pre-solve rig's figure, back when AHEAD was 27 — that guarded
  // against buying "less zoomed out" with "less warning". On the family's own
  // 1 August 2026 playtest verdict on the deployed rig, AHEAD itself was halved
  // to 13.5, which is the number now being protected here.)
  require(
    leastAhead > AHEAD,
    `only ${leastAhead.toFixed(1)} m of track is visible in front of the rider in the tightest ` +
      `window shape, which is less than the ${AHEAD} m the rig is solved to promise. A window ` +
      'shape must never see less than the promise, only more.',
  );
  // The rig pins AHEAD metres at a fixed place across the picture, so what varies
  // between shapes is only the sliver beyond that, which is why this is a floor
  // against the monitor rather than a symmetric spread. The direction matters and
  // the size does not: a *narrow* window must never be the one that sees less.
  require(
    leastAhead > monitor.ahead - 2,
    `the tightest window shape sees ${leastAhead.toFixed(1)} m of track ahead against a ` +
      `monitor's ${monitor.ahead.toFixed(1)} m. A hazard a landscape player had a second to ` +
      "react to would already be past a portrait player's nose. See AHEAD in railRace/camera.ts.",
  );

  // Left of centre, because a side-scroller spends its screen on what is coming —
  // but on the screen, not half off the edge of it, and with enough behind them to
  // see a rider who has just been bonked drop back.
  for (const [i, f] of frames.entries()) {
    require(
      f.riderX > 0.06 && f.riderX < 0.36,
      `in a ${SHAPES[i]!.name} the rider sits ${(f.riderX * 100).toFixed(1)}% across the picture. ` +
        'They belong left of centre and clear of the edge — see RIDER_SCREEN_X.',
    );
  }

  // The bug this whole rewrite is for. A phone stood up used to get the same 37.6
  // m of world across 390 px that a monitor got across 1280, which is 10.4 px per
  // metre against 34.1, which is what "it is too zoomed out" was.
  require(
    phone.frameWidth < monitor.frameWidth * 0.8,
    `a phone in portrait spans ${phone.frameWidth.toFixed(1)} m of world against a monitor's ` +
      `${monitor.frameWidth.toFixed(1)} m. Portrait has no width to spare, so it must buy a ` +
      'closer view with the room it does not have to spend behind the rider — this is the ' +
      '1 August 2026 "too zoomed out" report, and it is what RIDER_SCREEN_X exists to fix.',
  );
  require(
    390 / phone.frameWidth > 15,
    `a phone in portrait renders the world at ${(390 / phone.frameWidth).toFixed(1)} px per metre, ` +
      'which is the size the rider was too small to read at.',
  );

  // A very narrow window derives a very tall field of view from a fixed horizontal
  // one; past about 110° that stops being a picture and starts being a fisheye.
  const widestFov = Math.max(...frames.map((f) => f.fov));
  require(
    widestFov <= 112.5,
    `the vertical field of view reaches ${widestFov.toFixed(1)}°, which is a fisheye. ` +
      'See MAX_V_FOV in railRace/camera.ts.',
  );

  // --- does it stand further back when she is going faster? --------------------
  //
  // Jim, 6 August 2026: the camera should pull back as she speeds up, showing more
  // track ahead, **eased not snapped**. Three separate claims live in that, and
  // each is asserted here against the real `RaceCamera`, driven frame by frame:
  //
  // 1. **It pulls back at all**, and by an amount worth the code.
  // 2. **The rider does not move on screen while it does.** This is the one that
  //    could quietly wreck the ride: `RIDER_SCREEN_X` is a promise the family
  //    signed off twice, and a zoom that walked her towards the edge would undo
  //    it. The rig is scaled about the rider, so this should be exact.
  // 3. **The easing is frame-rate independent**, i.e. a real half-life rather than
  //    a per-frame lerp. A per-frame lerp is the ordinary way to write this and it
  //    ties the camera's feel to the frame rate — the same ramp settles at a
  //    different place on a 240 Hz monitor than on a phone dropping frames. Asked
  //    for explicitly, so measured explicitly.
  //
  // All three drive `rig.update` with the same wall-clock ramp and differ only in
  // the step, so nothing here can agree with itself by construction.

  rig.resize(1280, 720);

  /** Drives the real rig at a constant speed for `seconds`, from a standstill. */
  function settle(speed: number, dt: number, seconds = 6): number {
    rig.reset(0);
    let travelled = 0;
    for (let t = 0; t < seconds; t += dt) {
      travelled += speed * dt;
      rig.update(travelled, dt);
    }
    return travelled;
  }

  /** How far the lens ends up from the rider it is framing, in metres. */
  function standOff(travelled: number): number {
    return rig.camera.position.distanceTo(onLane(route.startDistance + travelled, probe));
  }

  /** Where the rider sits across the picture, 0 at the left edge — her mark. */
  function riderMark(travelled: number): number {
    return (onLane(route.startDistance + travelled, probe).project(rig.camera).x + 1) / 2;
  }

  const TICK = 1 / 60;
  const crawlRun = settle(2, TICK);
  const crawlStand = standOff(crawlRun);
  const crawlMark = riderMark(crawlRun);
  const racingRun = settle(32, TICK);
  const racingStand = standOff(racingRun);
  const racingMark = riderMark(racingRun);

  say('');
  say(
    `zoom       stands ${crawlStand.toFixed(1)} m off at a crawl, ${racingStand.toFixed(1)} m at ` +
      `racing speed (${((racingStand / crawlStand - 1) * 100).toFixed(1)}% further back)   ` +
      `rider holds her mark at ${crawlMark.toFixed(4)} / ${racingMark.toFixed(4)} across`,
  );

  // 1. It has to actually pull back, and by enough to notice.
  require(
    racingStand > crawlStand * 1.1,
    `the camera stands ${racingStand.toFixed(2)} m off at racing speed against ` +
      `${crawlStand.toFixed(2)} m at a crawl — under a tenth further back, which is not a zoom. See ` +
      'SPEED_PULL_BACK in railRace/camera.ts.',
  );
  // ...and not so far that the ride turns into a map.
  require(
    racingStand < crawlStand * 1.6,
    `the camera pulls back to ${(racingStand / crawlStand).toFixed(2)}x its resting distance, which ` +
      'is a different shot rather than the same shot with more road in it. See SPEED_PULL_BACK.',
  );

  // 2. **She holds her mark at every speed.** `RIDER_SCREEN_X` is a promise the
  //    family signed off twice, and a camera that walked her towards the edge as
  //    she sped up would undo it silently.
  //
  //    Measured end to end rather than as "the zoom contributes exactly zero",
  //    which is what this assertion said first and is a subtly different claim.
  //    The zoom really is a uniform scaling of the rig about the rider, so on its
  //    own it moves her not at all — but the **follower** does, a little: leading
  //    by `FOLLOW_LAG × speed` cancels the chase lag at every speed only to first
  //    order, leaving a residual that grows with speed. Watched at
  //    `SPEED_PULL_BACK = 0`, the drift is **0.0078** of the picture; with the
  //    pull-back switched on it is **0.0057**, i.e. the zoom slightly *improves*
  //    it. An assertion that blamed the zoom for the follower's residual would
  //    have been red on arrival for the wrong reason, and would have gone green
  //    again if someone deleted the lead-ahead.
  //
  //    So the bound is on what a child actually sees — under 2% of the picture
  //    across the entire speed range — and it catches a broken zoom easily,
  //    because scaling `stand` without `look` swings the aim and moves her by far
  //    more than that.
  const markDrift = Math.abs(racingMark - crawlMark);
  require(
    markDrift < 0.02,
    `the rider slides from ${crawlMark.toFixed(4)} to ${racingMark.toFixed(4)} across the picture ` +
      `between a crawl and racing speed — ${(markDrift * 100).toFixed(1)}% of the width, and ` +
      'RIDER_SCREEN_X is a promise the family signed off. Either the pull-back is not a uniform ' +
      'scaling of the rig about the rider (it must scale `stand` and `look` by one factor, or the ' +
      'aim swings), or FOLLOW_LAG has stopped cancelling the follower lag. See camera.ts.',
  );

  // 3. **Frame-rate independence**: the same wall clock at 30 Hz and at 240 Hz has
  //    to put the camera in the same place. A per-frame lerp — the ordinary way
  //    to write this — ties the camera's feel to the frame rate, so the ride
  //    behaves differently on a 240 Hz monitor than on a phone dropping frames.
  //
  //    **Sampled all the way along the ramp, not at one moment**, and that is not
  //    caution: watched at a single 1.2 s probe, a per-frame lerp of 0.05 was
  //    caught 1.768 m apart, but one of 0.2 slipped through at 0.028 m — a plain
  //    hand-tuned value, fast enough that both rates had already settled by the
  //    time the probe looked. The disagreement only exists *while the easing is
  //    easing*, so the probe has to be there for it. Taking the worst of a sweep
  //    catches a lerp of any speed: a slow one diverges late, a fast one early.
  //
  //    **The bound is not zero, and the reason is worth knowing before anyone
  //    tightens it.** `damp` is exact for a target that is standing still, but
  //    both followers here chase a target that is itself moving — the anchor
  //    chases a rider accelerating away, and the zoom chases a speed that is still
  //    settling — and stepping an exponential over a moving target carries an
  //    inherent first-order-in-`dt` error. That is a property of discrete time,
  //    not of a per-frame lerp, and it is most of what is left. Swept:
  //
  //    ```
  //      SPEED_PULL_BACK = 0 (no zoom at all)     0.071 m   <- the follower alone
  //      SPEED_PULL_BACK = 0.34 (shipping)        0.260 m   <- here
  //      SPEED_PULL_BACK = 1.5                    1.306 m
  //      per-frame lerp, 0.2 per frame            2.018 m   <- nearest failure
  //      per-frame lerp, 0.05 per frame           4.063 m
  //    ```
  //
  //    So 1.0 m: four times the shipping value, half the cheapest thing that is
  //    genuinely wrong. Tightening it towards 0.26 would be fitting the bound to
  //    today's `dt`s rather than to the fault it is looking for.
  const RAMP_PROBES = [0.1, 0.2, 0.3, 0.5, 0.8, 1.2];
  let worstRateGap = 0;
  let worstRateAt = 0;
  let worstSlow = 0;
  let worstFast = 0;
  for (const at of RAMP_PROBES) {
    const slow = standOff(settle(32, 1 / 30, at));
    const fast = standOff(settle(32, 1 / 240, at));
    if (Math.abs(slow - fast) > worstRateGap) {
      worstRateGap = Math.abs(slow - fast);
      worstRateAt = at;
      worstSlow = slow;
      worstFast = fast;
    }
  }
  say(
    `           worst 30 Hz vs 240 Hz disagreement ${worstRateGap.toFixed(4)} m, ` +
      `${worstRateAt.toFixed(1)} s into the ramp (${worstSlow.toFixed(3)} vs ${worstFast.toFixed(3)} m)`,
  );
  require(
    worstRateGap < 1.0,
    `${worstRateAt.toFixed(1)} s into the same acceleration the camera stands ${worstSlow.toFixed(3)} m ` +
      `out at 30 Hz and ${worstFast.toFixed(3)} m at 240 Hz — ${worstRateGap.toFixed(3)} m apart, so ` +
      'the easing is tied to the frame rate. Both the follower and the zoom must ease on a half-life ' +
      'in seconds (see `damp`), never a per-frame lerp.',
  );

  // --- and is it pointed the right way, all the way round? ---------------------

  const forward = new Vector3();
  const inward = new Vector3();
  const travelAtRider = new Vector3();
  /** The rider's own frame at each probe — asked of the rig, never rebuilt here. */
  const localOut = new Vector3();
  const localAlong = new Vector3();
  const localUp = new Vector3();

  interface Pose {
    mostAngled: number;
    leastAngled: number;
    leastInward: number;
    leastRightward: number;
    mostPitch: number;
    outsideRing: boolean;
    closestToPark: number;
  }

  function sweep(width: number, height: number): Pose {
    rig.resize(width, height);
    const worst: Pose = {
      mostAngled: -1,
      leastAngled: 1,
      leastInward: 1,
      leastRightward: 1,
      mostPitch: 0,
      outsideRing: true,
      closestToPark: Infinity,
    };
    for (let i = 0; i < 240; i += 1) {
      const travelled = (i / 240) * route.length;
      rig.reset(travelled);
      const camera = rig.camera;
      camera.getWorldDirection(forward);

      // Everything is measured against the rider, who is what the rig is for —
      // and **in the rider's own frame**, which is what `rigBasis` hands back.
      //
      // Every question below used to be asked by setting a `y` to zero. That
      // projects onto the *world* horizontal, which is the ground's tangent plane
      // at the middle of the park and nowhere else. Out at the ring the ground
      // leans, so a rig tilted the intended 20.1 degrees towards its own track
      // measured 6.6 against world `+Y`, and this check called that too flat and
      // failed it. The rig makes its promises in the rider's frame; they have to
      // be read there, and asking the rig itself is what stops the two drifting.
      const at = route.wrap(route.startDistance + travelled);
      route.pointAt(PLAYER_LANE, at, point);
      rig.rigBasis(at, localOut, localAlong, localUp);
      // Flattened *in the tangent plane at the rider*, so the rig's downward tilt
      // is not mistaken for looking along the track. The tilt is checked
      // separately, below, and against the same up.
      const flat = forward.clone().addScaledVector(localUp, -forward.dot(localUp)).normalize();

      route.tangentAt(PLAYER_LANE, at, travelAtRider);
      travelAtRider.addScaledVector(localUp, -travelAtRider.dot(localUp)).normalize();
      // "Into the park" is the reverse of the ring's own outward normal, not the
      // direction of the origin. Those were the same vector while the ring was a
      // circle centred there; on a ring that follows a spline edge they are not,
      // and pointing at the origin would call a perfectly good side view "not
      // looking into the park" wherever the boundary bulges.
      inward.copy(localOut).negate();

      const angled = flat.dot(travelAtRider);
      worst.mostAngled = Math.max(worst.mostAngled, angled);
      worst.leastAngled = Math.min(worst.leastAngled, angled);
      worst.leastInward = Math.min(worst.leastInward, flat.dot(inward));
      // Tilt below the rider's own horizon, not below the world's.
      worst.mostPitch = Math.max(worst.mostPitch, Math.abs(Math.asin(-forward.dot(localUp))));

      // The rider must cross the screen left to right. Screen-right is the
      // camera's own local +X in world space, which is `matrixWorld`'s first column.
      const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      right.addScaledVector(localUp, -right.dot(localUp)).normalize();
      worst.leastRightward = Math.min(worst.leastRightward, right.dot(travelAtRider));

      // Outset, not radius: "is the rig outside the park?" is a question about the
      // edge, and the edge is 41 m further out on some bearings than others.
      const standsAt = -PARK_BOUNDARY.distanceToEdge(camera.position.x, camera.position.z);
      worst.outsideRing &&= standsAt > -PARK_BOUNDARY.distanceToEdge(point.x, point.z);
      worst.closestToPark = Math.min(worst.closestToPark, standsAt);
    }
    return worst;
  }

  say('');
  for (const shape of POSES) {
    const p = sweep(shape.w, shape.h);
    say(
      `camera ${shape.name.padEnd(9)} looks ${((Math.asin(p.leastAngled) * 180) / Math.PI).toFixed(1)}–` +
        `${((Math.asin(p.mostAngled) * 180) / Math.PI).toFixed(1)}° down the track from side-on   ` +
        `into the park ≥ ${p.leastInward.toFixed(3)}   ` +
        `left-to-right ≥ ${p.leastRightward.toFixed(3)}   ` +
        `tilt ${((p.mostPitch * 180) / Math.PI).toFixed(1)}° down   ` +
        `stands ≥${p.closestToPark.toFixed(0)} m outside the edge`,
    );

    // Deliberately angled forward, and bounded at both ends. A rig that had been
    // built facing the way the rider has come — the fault every other ride camera
    // in this park has had at some point — measures -1.000 here, and a chase
    // camera measures +1.000. Neither is within a mile of this range.
    require(
      p.leastAngled > -0.05,
      `in a ${shape.name} window the camera looks BACK down the track by ` +
        `${(-(Math.asin(p.leastAngled) * 180) / Math.PI).toFixed(1)}°. It is meant to lead the ` +
        'rider, never trail them — this is the coaster eyeMount fault, in a new place.',
    );
    require(
      p.mostAngled < CHASE_CEILING,
      `in a ${shape.name} window the camera looks ` +
        `${((Math.asin(p.mostAngled) * 180) / Math.PI).toFixed(1)}° down the track. A little is ` +
        'what lets the rig stand close enough for a phone; this much is a chase camera, and the ' +
        'brief asks for a side view.',
    );
    require(
      p.leastInward > 0.85,
      `in a ${shape.name} window the camera is not looking into the park (dot with inward is ` +
        `${p.leastInward.toFixed(3)}). The park is meant to be the backdrop of the whole race.`,
    );
    require(
      p.leastRightward > SIDE_SCROLLER_FLOOR,
      `in a ${shape.name} window riders cross the screen the wrong way ` +
        `(dot(screenRight, travel) = ${p.leastRightward.toFixed(3)}). A side-scroller reads left ` +
        'to right — see the sign of RailRaceRoute.angleAt.',
    );
    require(
      p.outsideRing,
      `in a ${shape.name} window the camera rig strays inside the ring, so it would look outwards.`,
    );
    // Solving the rig for a tighter picture pulls it in towards the track. It must
    // not come in so far that it is standing in the park among the trees and the
    // boundary wall it is meant to be looking over.
    require(
      p.closestToPark > 0,
      `in a ${shape.name} window the rig stands ${p.closestToPark.toFixed(1)} m inside the park ` +
        "edge, where the park's own scenery is between it and the race.",
    );
    // Enough tilt to stack the four lanes into four rows of the picture, not so
    // much that the storybook side view turns into a plan view.
    require(
      p.mostPitch > 0.12 && p.mostPitch < 0.5,
      `in a ${shape.name} window the camera tilts ${((p.mostPitch * 180) / Math.PI).toFixed(1)}° ` +
        'down; it needs a little, to separate the four lanes, and not a lot, or the side view ' +
        'becomes a map.',
    );
  }


  return { said, problems };
}
