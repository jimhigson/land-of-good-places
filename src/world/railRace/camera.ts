import { PerspectiveCamera, Vector3 } from 'three';
import { damp } from '../../core/mathUtils';
import { NOMINAL_RADIUS, type RailRaceRoute } from './route';

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
 * ### Why there is no `eyeMount`
 *
 * The `eyeMount` trap the coaster fell into (models face +Z, a three.js camera
 * looks down its own −Z, so an unrotated eye in a seat faces the way you have
 * just come) cannot happen here, because there is no mount and no seat
 * transform: the rig sets a world position and calls `lookAt`. There is no
 * second formula to fall out of sync with the first. `scripts/check-rail-race.mts`
 * still measures it rather than trusting the argument — it asserts the view is
 * perpendicular to travel, pointed into the park, and that a rider moves *left
 * to right* across the screen.
 */

/** How far outside the ring the rig stands, in metres. */
const DISTANCE = 30;

/** How far above the rails it stands. About 20° of downward tilt. */
const RISE = 11;

/**
 * How far ahead of the rider the rig centres, in metres.
 *
 * The rider sits left of centre so most of the screen is what is *coming*.
 */
const LEAD = 9;

/**
 * Half the track visible either side of the centre of the picture, in metres.
 *
 * **Fixed in metres of track, not in degrees**, and the field of view is derived
 * from it — the same choice the retired 2D game made, for the same reason: a
 * phone in portrait and a monitor in landscape must show the same amount of
 * track coming, or a hazard a portrait player had a second to react to is
 * already past a landscape player's nose. A narrow viewport therefore grows the
 * view *taller* (more sky, more park) instead of cropping the road ahead.
 */
const VIEW_HALF_WIDTH = 19.4;

/** How quickly the rig catches up. Damped, so a bonk does not jolt the screen. */
const FOLLOW = 0.12;

export class RaceCamera {
  readonly camera = new PerspectiveCamera(45, 1, 1, 400);

  private readonly route: RailRaceRoute;
  private readonly aim = new Vector3();
  private readonly outward = new Vector3();
  /** The arc distance the rig is currently centred on. */
  private centre = 0;
  private aspect = 1;

  constructor(route: RailRaceRoute) {
    this.route = route;
    this.camera.name = 'railRace:camera';
  }

  /** Snaps the rig to a rider without a chase, for the start of a race. */
  reset(travelled: number): void {
    this.centre = this.route.startDistance + travelled + LEAD;
    this.place();
  }

  /** Follows a rider. `travelled` is metres run since the lights went out. */
  update(travelled: number, dt: number): void {
    this.centre = damp(this.centre, this.route.startDistance + travelled + LEAD, FOLLOW, dt);
    this.place();
  }

  private place(): void {
    const route = this.route;
    const theta = route.angleAt(this.centre);
    // Aimed at the middle of the four lanes, at the level they undulate about,
    // so all four stay framed however far apart they have drifted vertically.
    this.aim.set(Math.cos(theta) * NOMINAL_RADIUS, route.base + 0.6, Math.sin(theta) * NOMINAL_RADIUS);
    route.outwardAt(this.centre, this.outward);

    this.camera.position.set(
      this.aim.x + this.outward.x * DISTANCE,
      this.aim.y + RISE,
      this.aim.z + this.outward.z * DISTANCE,
    );
    this.camera.lookAt(this.aim);
    this.camera.updateMatrixWorld();
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    this.camera.aspect = this.aspect;
    // Horizontal span is the promise; the vertical field of view is whatever
    // delivers it at this aspect. See VIEW_HALF_WIDTH.
    const halfHorizontal = Math.atan(VIEW_HALF_WIDTH / DISTANCE);
    const halfVertical = Math.atan(Math.tan(halfHorizontal) / this.aspect);
    this.camera.fov = (halfVertical * 2 * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    // Nothing to release: no listeners, no textures, no look control. Kept so
    // the ride can treat this exactly like the shared ride views it sits beside.
  }
}
