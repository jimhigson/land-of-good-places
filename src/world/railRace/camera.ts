import { PerspectiveCamera, Vector3 } from 'three';
import { damp } from '../../core/mathUtils';
import { LANE_RADII, PLAYER_LANE, type RailRaceRoute } from './route';

/**
 * **The Rail Race's side-on camera.**
 *
 * The brief: *"a side-on perspective like before... the tracks should go around
 * the perimeter of the park, so that the side-on perspective is looking into the
 * park."* So the camera stands **outside** the ring and looks **inward**, and
 * the park — the castle, the wheel, the fountain, the little train going the
 * other way underneath — is the backdrop the whole race is run against. It is
 * the reason the track is a rim and not a loop through the middle.
 *
 * ### Why this is not a `RideCamera`
 *
 * `core/RideCamera.ts` opens with "never write a second look-around", and this
 * is not one: it has no look control, no yaw, no pitch, no thumb, no device
 * orientation. That class exists for *first-person look-around on a moving
 * mount* — you sit in the seat and turn your head. Here nobody is sitting in a
 * seat: the camera is a fixed rig tracking a rider from the outside, exactly
 * like a 2.5D platformer's, and GAME_DESIGN.md's CONTROL rule keeps rotation
 * controls to first person and nowhere else. Bolting a look-around onto a
 * side-on view is the thing that rule exists to prevent.
 *
 * ### What the rig is, and why it is solved rather than dialled in
 *
 * The first version of this rig was four hand-set numbers — stand 30 m out,
 * 11 m up, aim 9 m ahead of the rider, and show 19.4 m of track either side of
 * that aim. It kept a promise worth keeping (the *same metres of track* are
 * visible whatever shape the window is, so a hazard does not arrive with less
 * warning on a phone than on a monitor) but it kept it the wrong way round: a
 * narrow window got the same distant scene in a **taller** frame, never a
 * closer one. Played in portrait on a phone that came out at 10 px per metre
 * against a monitor's 34, and the family's verdict on 1 August 2026 was, simply,
 * *"it is too zoomed out"*.
 *
 * So nothing here is a rig measurement any more. Two things are *asked for*:
 *
 * - {@link RIDER_SCREEN_X} — where across the picture the rider sits. Not the
 *   middle: a side-scroller spends its screen on what is *coming*, so the rider
 *   is held near the left-hand edge, and **further left the narrower the
 *   window**, because a narrow window has no width to spare.
 * - {@link AHEAD} — how many metres of track in front of the rider reach the
 *   right-hand edge. **One number for every window shape**, which is the old
 *   promise restated about the rider instead of about the middle of the frame.
 *
 * Where the camera *stands*, which way it points and how wide its lens is are
 * then all worked out from those, per {@link solve}. They are outputs, and they
 * come out different in portrait and in landscape, which is the entire point.
 *
 * ### Why an angled camera can stand closer
 *
 * The lever that makes "closer **and** still sees as far ahead" possible: a
 * camera square-on to the track has to hold the whole rider-to-lookahead span
 * across its picture broadside, so it must stand far enough back to fit it. Let
 * the camera look somewhat *down* the track instead and the same span is
 * foreshortened — the far end is further away and lands closer to the near end
 * on screen — so the same 27 m of track fits from much nearer the rider.
 *
 * That angle is not a fifth dial. It falls out of {@link RIDER_SCREEN_X}: the
 * rider is off to the left of the picture, so the middle of the picture is
 * already some way down the track from them, and the camera is therefore
 * already pointing that way. Pushing the rider from 28% of the way across
 * (a monitor) to 10% (a phone stood up) swings the aim from 1° off side-on to
 * 12°, and that alone brings the rig in from 27 m to 17 m of the rider and
 * shrinks the picture from 38 m of world across to 21 m. One asked-for number,
 * two dependent ones, no new dial.
 *
 * ### Why there is no `eyeMount`
 *
 * The `eyeMount` trap the coaster fell into (models face +Z, a three.js camera
 * looks down its own −Z, so an unrotated eye in a seat faces the way you have
 * just come) cannot happen here, because there is no mount and no seat
 * transform: the rig sets a world position and calls `lookAt`.
 * `scripts/check-rail-race.mts` still measures it rather than trusting the
 * argument — it reads the rider's and the look-ahead point's screen positions
 * off the built projection matrix, and it asserts the view is angled forward by
 * a *bounded* amount, pointed into the park, and that a rider moves *left to
 * right* across the screen.
 */

/**
 * Metres of track in front of the rider that reach the right-hand edge.
 *
 * **One number for every window shape.** This is the promise the retired 2D game
 * made and the first version of this rig made: a phone in portrait and a monitor
 * in landscape show the same amount of track *coming*, or a hazard a portrait
 * player had a second to react to is already past a landscape player's nose. At
 * the 22 m/s top speed of `simulate.ts` this is about 1.2 seconds of warning.
 *
 * 27 rather than a round 30 because 27 is a shade more than the 26.1 m the
 * shipped rig was measured to show: the fix for "too zoomed out" must not be
 * bought by quietly showing less road.
 */
const AHEAD = 27;

/**
 * Where the look-ahead point sits, as a fraction of the way across the picture.
 *
 * Not 1.0. A point exactly on the edge is a point half off the edge as soon as
 * the rider's lane undulates or the follower is mid-catch-up, so it is inset by
 * a twentieth of the width and the promise above is kept with a margin.
 */
const AHEAD_SCREEN_X = 0.95;

/**
 * Where the rider sits, as a fraction of the way across the picture — asked
 * for, not measured, and *"fine for them to be near the left edge"*.
 *
 * It is the one input that varies with the shape of the window, and it varies
 * because the cost of screen behind the rider is not the same in both. A wide
 * frame can spend a quarter of itself on where they have just been and still
 * have room; a tall narrow one cannot spend anything, so the rider goes hard
 * left and every remaining pixel goes on the road ahead. Everything else about
 * the rig follows from this number, so pushing it left is *also* what pulls the
 * camera in and makes the rider bigger — see the class comment.
 *
 * Below 0.10 the rider starts to sit in the part of a wide lens where straight
 * things bend, and there is no longer enough behind them to see a rider who has
 * just been bonked drop back. It is a floor, not a value to keep tuning.
 */
const RIDER_SCREEN_X_PORTRAIT = 0.13;
const RIDER_SCREEN_X_LANDSCAPE = 0.28;
/** The window shapes those two are quoted for: a phone stood up, and a monitor. */
const PORTRAIT_ASPECT = 0.5;
const LANDSCAPE_ASPECT = 1.6;

/**
 * The lens, as the tangent of half its **horizontal** field of view.
 *
 * Horizontal, because horizontal is the direction the promises are made in. 66°
 * is what the shipped rig worked out to in landscape, and it is kept: the width
 * of the lens barely moves the framing (a longer lens simply stands further back
 * for the same picture) but it does set how strongly the four lanes separate in
 * depth, and that was already right.
 */
const TAN_HALF_H_FOV = Math.tan((66 * Math.PI) / 180 / 2);

/**
 * A ceiling on the **vertical** field of view.
 *
 * Not a design input — a guard. Holding the horizontal lens fixed means a very
 * narrow window derives a very tall one, and past about 110° a perspective
 * camera stops being a picture and starts being a fisheye. A real phone in
 * portrait lands just under this; something narrower lengthens the lens and
 * stands further back instead, which costs a little zoom and keeps the picture.
 */
const MAX_V_FOV = (112 * Math.PI) / 180;

/**
 * How far the rig leans down towards the track.
 *
 * Kept at the shipped rig's 20.1° (it stood 11 m up at 30 m out). Enough to
 * stack the four lanes into four rows of the picture, not so much that the
 * storybook side view turns into a plan view. It is an *angle* and no longer a
 * height, so the composition survives the rig moving in and out.
 */
const TILT = Math.atan(11 / 30);

/** How quickly the rig catches up. Damped, so a bonk does not jolt the screen. */
const FOLLOW = 0.12;

/**
 * The lag a follower with that half-life settles into behind a target moving at
 * constant speed, in seconds — `halfLife / ln 2`.
 *
 * The old rig aimed 9 m in front of the rider to cancel this, which cancelled it
 * at exactly one speed: the rider slid from a quarter of the way across the
 * screen when crawling to over a third of the way when flat out, and the faster
 * they went — the moment they most needed the road ahead — the more of the
 * screen went on the road behind. Leading by the lag the follower is *about* to
 * have instead cancels it at every speed, so {@link RIDER_SCREEN_X} is where the
 * rider actually is rather than where they are when stationary.
 */
const FOLLOW_LAG = FOLLOW / Math.LN2;

/** The rider's own lane. The framing promises are about the rider, so measured there. */
const RIDER_RADIUS = LANE_RADII[PLAYER_LANE]!;

/**
 * How far above the rails the rider themself sits, in metres.
 *
 * The framing is solved for the rider, so it has to be solved at the height the
 * rider *is*, not at the height of the rail they are riding on. Solving at the
 * rail put them about two percent of the width further left than they were asked
 * to be — a tilted camera divides by a depth that raising a point shortens, so a
 * raised point that is already off centre is pushed further off it, and two
 * percent of 390 px is the difference between a rider beside the edge and a
 * rider clipped by it. Measured in the running game on 1 August 2026 at 1.2–2.0 m
 * above the rail; solving at 1.9 lands the rider where the number above says.
 */
export const RIDER_RIDE_HEIGHT = 1.9;

const UP = new Vector3(0, 1, 0);

/** Linear ramp from `a` to `b` as `t` runs from `lo` to `hi`, flat outside. */
function ramp(t: number, lo: number, hi: number, a: number, b: number): number {
  const f = Math.min(1, Math.max(0, (t - lo) / (hi - lo)));
  return a + (b - a) * f;
}

export class RaceCamera {
  readonly camera = new PerspectiveCamera(45, 1, 1, 400);

  private readonly route: RailRaceRoute;

  /**
   * The solved rig, in the rider's own frame: how far outward, how far along the
   * track and how far up the camera stands, and where it aims. Solved once per
   * {@link resize} rather than per frame, because the ring is a ring — every
   * point on it is the same shape, so the answer only depends on the window.
   */
  private readonly stand = { out: 0, along: 0, rise: 0 };
  private readonly look = { out: 0, along: 0, rise: 0 };

  /** The arc distance the framing is anchored to, and what it takes to get there. */
  private anchor = 0;
  private lastTravelled = 0;
  private speed = 0;

  private readonly rider = new Vector3();
  private readonly out = new Vector3();
  private readonly along = new Vector3();
  private readonly aim = new Vector3();

  constructor(route: RailRaceRoute) {
    this.route = route;
    this.camera.name = 'railRace:camera';
    this.resize(16, 9);
  }

  /** Snaps the rig to a rider without a chase, for the start of a race. */
  reset(travelled: number): void {
    this.anchor = this.route.startDistance + travelled;
    this.lastTravelled = travelled;
    this.speed = 0;
    this.place();
  }

  /** Follows a rider. `travelled` is metres run since the lights went out. */
  update(travelled: number, dt: number): void {
    if (dt > 0) {
      this.speed = damp(this.speed, (travelled - this.lastTravelled) / dt, FOLLOW, dt);
    }
    this.lastTravelled = travelled;
    // Lead by the lag the follower is about to have, so it settles on the rider
    // at every speed rather than at one. See FOLLOW_LAG.
    const target = this.route.startDistance + travelled + FOLLOW_LAG * this.speed;
    this.anchor = damp(this.anchor, target, FOLLOW, dt);
    this.place();
  }

  /** The rider's lane at arc distance `s`, at the level the lanes undulate about. */
  private ringPoint(s: number, into: Vector3): Vector3 {
    const theta = this.route.angleAt(s);
    return into.set(
      Math.cos(theta) * RIDER_RADIUS,
      this.route.base + 0.6 + RIDER_RIDE_HEIGHT,
      Math.sin(theta) * RIDER_RADIUS,
    );
  }

  private place(): void {
    const s = this.anchor;
    this.ringPoint(s, this.rider);
    const theta = this.route.angleAt(s);
    this.out.set(Math.cos(theta), 0, Math.sin(theta));
    // The clockwise horizontal tangent at that bearing — see RailRaceRoute.angleAt,
    // whose dθ/ds is −1/NOMINAL_RADIUS.
    this.along.set(Math.sin(theta), 0, -Math.cos(theta));

    this.camera.position
      .copy(this.rider)
      .addScaledVector(this.out, this.stand.out)
      .addScaledVector(this.along, this.stand.along)
      .addScaledVector(UP, this.stand.rise);
    this.aim
      .copy(this.rider)
      .addScaledVector(this.out, this.look.out)
      .addScaledVector(this.along, this.look.along)
      .addScaledVector(UP, this.look.rise);
    this.camera.lookAt(this.aim);
    this.camera.updateMatrixWorld();
  }

  resize(width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    this.camera.aspect = aspect;

    // The lens is fixed horizontally; the vertical field is whatever that comes
    // to at this shape, up to the fisheye guard, which lengthens it instead.
    const tanH = Math.min(TAN_HALF_H_FOV, Math.tan(MAX_V_FOV / 2) * aspect);
    this.camera.fov = (2 * Math.atan(tanH / aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();

    const riderX = ramp(
      aspect,
      PORTRAIT_ASPECT,
      LANDSCAPE_ASPECT,
      RIDER_SCREEN_X_PORTRAIT,
      RIDER_SCREEN_X_LANDSCAPE,
    );
    this.solve(tanH, 2 * riderX - 1, 2 * AHEAD_SCREEN_X - 1);
  }

  /**
   * Works the rig out from the two things that were asked for.
   *
   * ### The geometry
   *
   * Two points on the track are known: the rider **R**, and the point **F** that
   * is {@link AHEAD} metres in front of them. Two screen positions are wanted:
   * `riderNdc` for R and `aheadNdc` for F, in normalised device coordinates
   * (−1 at the left edge, +1 at the right). For a pinhole camera a point that
   * sits `α` off the axis lands at `tan α / tan(fov/2)`, so wanting R and F at
   * those two places fixes the angle **between** them:
   *
   * ```
   * Δ = atan(aheadNdc · tanH) − atan(riderNdc · tanH)
   * ```
   *
   * — the angle the chord R→F must subtend **at the camera**, whatever the
   * camera does. And the set of points that see a fixed segment at a fixed angle
   * is, by the inscribed angle theorem, a circular arc through R and F. So the
   * camera is not free: it must stand somewhere on that arc, and choosing where
   * on it chooses everything else. By the sine rule, standing at `β` to the chord
   * puts it `L · sin(β + Δ) / sin Δ` from the rider.
   *
   * The rig stands at **β = 90°**, square-on to the chord — which, because the
   * ring bends away underneath it, is already about 14° in front of straight out
   * from the rider, and is the closest the arc comes while still standing beside
   * the race rather than behind it. That is the tidy closed form
   * `distance = L / tan Δ`, and it is used as the opening guess.
   *
   * ### And then it is measured, not trusted
   *
   * The closed form is worked in the horizontal plane, and the rig is tilted, so
   * it is out by a couple of percent — the tilt lengthens the depth every screen
   * position is divided by, which pulls both points towards the middle. Two
   * percent of the width is nothing at the rider and everything at F, which is a
   * twentieth of the width from falling off the edge. So the closed form only
   * starts it off: the aim and the distance are then each bisected against the
   * **actual** projection until R and F land where they were asked to, which is
   * cheap, exact, and needs no second formula to be kept in step with the first.
   * It runs once per resize, not per frame.
   */
  private solve(tanH: number, riderNdc: number, aheadNdc: number): void {
    const rider = this.ringPoint(0, new Vector3());
    const ahead = this.ringPoint(AHEAD, new Vector3());
    const theta = this.route.angleAt(0);
    const out = new Vector3(Math.cos(theta), 0, Math.sin(theta));
    const along = new Vector3(Math.sin(theta), 0, -Math.cos(theta));

    // The chord, and the horizontal direction square-on to it on the outside.
    const chord = new Vector3(ahead.x - rider.x, 0, ahead.z - rider.z);
    const length = chord.length();
    chord.multiplyScalar(1 / length);
    const beam = new Vector3(-chord.z, 0, chord.x);
    if (beam.dot(out) < 0) beam.negate();

    const delta = Math.atan(aheadNdc * tanH) - Math.atan(riderNdc * tanH);

    // Scratch, reused by the two bisections below.
    const at = new Vector3();
    const axis = new Vector3();
    const right = new Vector3();
    const toPoint = new Vector3();
    const flat = new Vector3();
    const perp = new Vector3();

    /** Where `point` lands across the screen, from the real camera basis. */
    const screenX = (point: Vector3): number => {
      toPoint.subVectors(point, at);
      return toPoint.dot(right) / toPoint.dot(axis) / tanH;
    };

    /**
     * Stands the rig `distance` from the rider and swings its aim `swing` past
     * the rider, down the track. `swing` is what puts the rider left of centre.
     */
    const pose = (distance: number, swing: number): void => {
      const depth = distance * Math.cos(swing);
      at.copy(rider).addScaledVector(beam, distance).addScaledVector(UP, depth * Math.tan(TILT));
      // Aim: the ray to the rider, rotated `swing` towards the track ahead, then
      // leaned down by TILT.
      flat.set(rider.x - at.x, 0, rider.z - at.z).normalize();
      perp.copy(chord).addScaledVector(flat, -chord.dot(flat)).normalize();
      axis
        .copy(flat)
        .multiplyScalar(Math.cos(swing))
        .addScaledVector(perp, Math.sin(swing));
      // `flat` and `perp` are perpendicular horizontal units, so the sum is one
      // too, and leaning it down by tan(TILT) then normalising gives exactly
      // TILT of pitch.
      axis.y = -Math.tan(TILT);
      axis.normalize();
      right.crossVectors(axis, UP).normalize();
    };

    /** The swing that puts the rider exactly where they were asked for. */
    const swingFor = (distance: number): number => {
      let lo = 0;
      let hi = (80 * Math.PI) / 180;
      for (let i = 0; i < 34; i += 1) {
        const mid = (lo + hi) / 2;
        pose(distance, mid);
        // More swing carries the rider further left, so this is monotone.
        if (screenX(rider) > riderNdc) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    };

    // Opening guess: β = 90° on the inscribed-angle arc.
    let lo = 4;
    let hi = Math.max(20, (4 * length) / Math.tan(delta));
    for (let i = 0; i < 34; i += 1) {
      const mid = (lo + hi) / 2;
      pose(mid, swingFor(mid));
      // Standing further back closes the angle between the two points, which
      // slides F back towards the rider. Monotone, so bisection is safe.
      if (screenX(ahead) > aheadNdc) lo = mid;
      else hi = mid;
    }
    const distance = (lo + hi) / 2;
    pose(distance, swingFor(distance));

    const stand = new Vector3().subVectors(at, rider);
    this.stand.out = stand.dot(out);
    this.stand.along = stand.dot(along);
    this.stand.rise = stand.y;

    // Walk down the axis until it has dropped the whole rise, so the aim sits at
    // the level the lanes undulate about and all four stay framed.
    const look = new Vector3().addScaledVector(axis, this.stand.rise / Math.sin(TILT)).add(stand);
    this.look.out = look.dot(out);
    this.look.along = look.dot(along);
    this.look.rise = look.y;
  }

  dispose(): void {
    // Nothing to release: no listeners, no textures, no look control. Kept so
    // the ride can treat this exactly like the shared ride views it sits beside.
  }
}
