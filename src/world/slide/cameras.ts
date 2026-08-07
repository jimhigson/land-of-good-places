import { PerspectiveCamera, Vector3 } from 'three';
import { fitCameraToViewport } from '../../core/RideCamera';

/**
 * **The ginormous slide is cut like a real on-ride video**: trackside cameras
 * intercut with the cart cam.
 *
 * Jim's ruling, 6 August 2026: *"let's change the slide camera to alternate
 * between a fixed camera aimed at the character and a chase camera behind them,
 * then I don't mind the body being hidden because it will still be shown for the
 * static camera"*.
 *
 * ## Why there has to be a second camera at all
 *
 * The chase shot was measured, in pixels through the live ride camera: **head
 * ~2500 px, body 0 px**. That is not a bug with a fix in it. She rides on her
 * back, **feet first**, so her feet point down the slide and her head points
 * back up it — straight into a lens sitting behind her. *Her own head is between
 * the camera and the rest of her by construction*, and no amount of moving the
 * chase eye changes that without giving up the over-the-shoulder speed shot,
 * which is the one thing the chase camera is good at.
 *
 * So the chase shot is left exactly as it is, and a **second** shot carries her
 * body. That is also the visual language a six-year-old already knows: every
 * real theme-park on-ride video cuts between a camera bolted to the cart and
 * cameras bolted to the track.
 *
 * ## The cut, and why it is a cut
 *
 * **Hard cut. No blend, ever.** Three reasons, in order of how much they matter:
 *
 * 1. The jump is enormous. The chase eye is 4.35 m behind her and moving at
 *    {@link GIANT_SLIDE_SPEED}; the trackside eye is {@link TRACKSIDE_STANDOFF}
 *    metres away, well above the chute, and bolted to the ground. A blend across
 *    that is a camera **flying through the air**, which reads as a mistake
 *    rather than as an edit.
 * 2. The two shots do not even agree about where to point. The chase looks
 *    forward along the chute; the trackside camera looks *at her*. Interpolating
 *    those aims sweeps the view across the sky in between.
 * 3. Rhythm. At {@link BEATS} beats over an 11.45 s ride each shot is under two
 *    seconds, and a half-second blend would spend a quarter of every shot in
 *    motion. The cuts **are** the rhythm; smearing them destroys it.
 *
 * Real on-ride videos hard-cut for exactly these reasons.
 *
 * ## The rhythm, and which shot it opens on
 *
 * The ride is 74.41 m and **11.45 s** on the canonical seed. Six beats of about
 * 1.9 s, alternating, starting on the chase:
 *
 * ```
 *   chase | TRACKSIDE | chase | TRACKSIDE | chase | TRACKSIDE
 * ```
 *
 * - **Six**, not four and not eight. Three trackside shots means she is
 *   properly on screen for **half** the ride, which is what Jim's ruling is
 *   *for*; two would have been 37% and eight puts every shot under 1.5 s, which
 *   is frantic rather than exciting.
 * - **Equal fractions of the solved arc**, so the rhythm a child feels is the
 *   same on every seed rather than drifting with the route's length. This is the
 *   argument `SlideRide`'s `BAND_PERIOD` already makes for the see-through
 *   bands, and it is why the beats are not written in seconds.
 * - **It opens on the chase.** The first beat is the flat lip at the top (the
 *   chute is dead level until t≈0.22 and only then starts to fall), so the ride
 *   begins with speed and height and *no idea what you look like* — and the
 *   first cut out to a trackside camera lands almost exactly on the start of the
 *   plunge. Cutting on the action, and the reveal — *"that's me, up there"* —
 *   arrives with the drop rather than before it. Opening wide and cutting in is
 *   documentary grammar; this is a thrill ride, so it is the other way round.
 * - **It closes on a trackside shot**, of her flattening out low over the grass
 *   on the run into the ball pit. That is where she is nearest the ground and
 *   most legible, and it is the last thing seen before the ride hands her back.
 *
 * ## Where a trackside camera can stand — measured, not guessed
 *
 * The eye is placed in the **chute's own frame** (the `right`/`up` pair
 * perpendicular to the tangent, the same construction `SlideRide.sampleFrames`
 * sweeps the trough along), at an elevation angle and a standoff distance.
 * Sweeping both and asking "can this one eye see a rider lying in the trough all
 * the way through its beat?", raycast against the chute *and* the castle:
 *
 * | elevation | worst beat coverage |
 * |---|---|
 * | 40° | **41–59%** |
 * | 45° | 83–90% |
 * | **50°** | **100%** |
 * | 55°–65° | 100% |
 *
 * **Standoff made no difference whatsoever** — 4.5 m and 9.0 m score identically
 * at every elevation. That is the whole insight: what cuts her out of the shot
 * is the **hand-rail along the near side of the trough**, and clearing a rail is
 * a question of *angle*, which does not care how far away you stand. So the
 * elevation is pinned to the measurement and the standoff is left free to be
 * chosen purely for how big she reads.
 *
 * The bare rail geometry says 34° would do. The measured threshold is 50°, and
 * the extra 16° is because the chute **turns** inside a beat — up to ~90° of
 * heading on the tightest bend — so at the beat's ends the eye is looking along
 * the trough obliquely and the near wall is effectively taller. A number taken
 * from the profile alone would have been wrong by that margin, which is why it
 * was measured on the built chute instead.
 */

// --------------------------------------------------------------- the numbers

/**
 * How many shots the ride is cut into. See the rhythm note above: this is the
 * one number to move if the cutting feels wrong, and it moves both how often it
 * cuts *and* how many trackside cameras there are, which is right — they are the
 * same decision.
 *
 * Even, so the ride opens on the chase and closes trackside.
 */
export const BEATS = 6;

/**
 * How high above the chute's own side plane a trackside eye sits, in radians.
 *
 * **50° is measured, not chosen** — see the table above. This is 55°, five
 * degrees of margin on the safe side, because the number that fails is a hard
 * edge (below it the near hand-rail simply cuts her in half) and because the
 * measurement was taken on one seed's bends. Steeper is always safe; shallower
 * is a cliff.
 */
const TRACKSIDE_ELEVATION = (55 * Math.PI) / 180;

/**
 * How far a trackside eye stands from the chute, in metres.
 *
 * Free to choose, because the sweep proved distance has no effect at all on
 * whether she is visible. So it is chosen for the two things it *does* set:
 *
 * - **How big she reads.** At 7 m she is 6.8–10.5 m away across a beat, which
 *   with {@link TRACKSIDE_FOV} puts a reclining child at roughly a quarter of
 *   the frame's height in landscape and a seventh of it on a portrait phone.
 * - **How hard the camera whips as she passes.** The pan rate at closest
 *   approach is `GIANT_SLIDE_SPEED / standoff` — about 53°/s here. She stays
 *   centred, so it is the *background* that sweeps, which is the shot reading as
 *   speed. Closer than this and it starts to read as a lurch.
 */
const TRACKSIDE_STANDOFF = 7;

/**
 * The trackside camera's field of view, in degrees, before the portrait phone
 * widening (`fitCameraToViewport`).
 *
 * **Deliberately a long lens**, which is what a real trackside camera is. The
 * chase camera is 60°, wide, because you are inside the ride looking out; this
 * one is outside looking in, and a long lens is what keeps a child who is 7–10 m
 * away big enough to see. It also compresses the background, which is what makes
 * the pass read as fast.
 */
const TRACKSIDE_FOV = 30;

const NEAR = 0.05;
const FAR = 3200;

/**
 * Where the aim sits between her feet and her head, 0…1.
 *
 * Her model's origin is at her feet and she is lying down, so aiming at the
 * origin would frame her ankles with her body trailing off the top of the shot.
 * Halfway is her middle. Taken as a *fraction of the real distance to her real
 * head* rather than as a number of metres, so nothing here restates how big she
 * is — which is exactly the trap CLAUDE.md's "two definitions of one thing"
 * section is about, and character scale is a thing this project changes.
 */
const AIM_ALONG_BODY = 0.5;

const UP = new Vector3(0, 1, 0);

// ----------------------------------------------------------------- the plan

/**
 * The part of a ride's curve a shot plan needs. `SlideRide` satisfies this
 * structurally, so the plan can be measured without a scene.
 */
export interface RideCurve {
  readonly length: number;
  pointAt(t: number, target?: Vector3): Vector3;
  tangentAt(t: number, target?: Vector3): Vector3;
}

export type ShotKind = 'chase' | 'trackside';

export interface SlideShot {
  readonly kind: ShotKind;
  /** Where this shot starts, as a fraction of the arc. Inclusive. */
  readonly from: number;
  /** Where it ends. Exclusive, except for the last shot, which owns 1. */
  readonly to: number;
  /**
   * Where the trackside eye stands, in world space, and the point on the chute
   * it was placed to cover. `null` on a chase shot, which has no eye of its own
   * — it hangs off the ride's moving seat.
   */
  readonly eye: Vector3 | null;
  /** The point on the chute the eye was placed against — its beat's midpoint. */
  readonly covers: Vector3 | null;
}

/**
 * Cut the ride into {@link BEATS} shots and stand a trackside eye beside every
 * other one.
 *
 * `awayFrom` is the castle's centre in plan view. The eye goes on the side of
 * the chute **facing away from it**, which is not an aesthetic preference: the
 * chute is solved to clear the castle and its towers by `CORRIDOR_RADIUS`, so
 * the outward side is the open one *by construction*, on every seed. Measured on
 * the canonical seed the three eyes land 27.4, 30.0 and 32.2 m from the castle's
 * centre and 20.0, 13.8 and 6.7 m above the ground.
 *
 * It also frames better, and the two reasons agree: looking inward puts the
 * castle **behind her**, so a child watching can see where she has just come
 * from.
 */
export function planSlideShots(
  curve: RideCurve,
  awayFrom: { readonly x: number; readonly z: number },
): SlideShot[] {
  const shots: SlideShot[] = [];
  for (let beat = 0; beat < BEATS; beat += 1) {
    const from = beat / BEATS;
    const to = (beat + 1) / BEATS;
    // Odd beats are trackside, so the ride opens on the chase and — because
    // `BEATS` is even — closes trackside. See the rhythm note.
    if (beat % 2 === 0) {
      shots.push({ kind: 'chase', from, to, eye: null, covers: null });
      continue;
    }
    const mid = (from + to) / 2;
    const covers = curve.pointAt(mid, new Vector3()).clone();
    const tangent = curve.tangentAt(mid, new Vector3());

    // The chute's own frame, built exactly as `SlideRide.sampleFrames` builds
    // it — so "beside the chute" and "above the chute" mean here what they mean
    // to the trough itself, on a bend and on a slope alike.
    const right = new Vector3().crossVectors(tangent, UP);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new Vector3().crossVectors(right, tangent).normalize();

    // Outward from the castle, in plan view. `>= 0` rather than `> 0` so a
    // chute passing exactly over the castle's centre still picks a side rather
    // than falling through to an undefined one.
    const outward = new Vector3(covers.x - awayFrom.x, 0, covers.z - awayFrom.z);
    const side = outward.dot(right) >= 0 ? 1 : -1;

    const eye = covers
      .clone()
      .addScaledVector(right, side * TRACKSIDE_STANDOFF * Math.cos(TRACKSIDE_ELEVATION))
      .addScaledVector(up, TRACKSIDE_STANDOFF * Math.sin(TRACKSIDE_ELEVATION));

    shots.push({ kind: 'trackside', from, to, eye, covers });
  }
  return shots;
}

// ------------------------------------------------------------- the director

/**
 * Runs the cut: owns the one trackside camera, moves it to whichever eye the
 * current beat calls for, and aims it at the rider.
 *
 * **One camera, moved, rather than one per beat.** Only one is ever rendered
 * through, so three would be two objects kept in step with a fourth thing (which
 * beat is live) for no gain — and a camera left behind at the wrong eye is
 * exactly the class of bug this ride has already produced three times. Moving it
 * on the cut is the same instant the picture changes anyway.
 */
export class SlideShotDirector {
  /** The trackside camera. The chase camera belongs to the ride, not here. */
  readonly camera = new PerspectiveCamera(TRACKSIDE_FOV, 1, NEAR, FAR);
  readonly shots: readonly SlideShot[];

  /** Which shot is live, as an index into {@link shots}. −1 before the ride. */
  private live = -1;
  private readonly aim = new Vector3();

  constructor(shots: readonly SlideShot[]) {
    this.shots = shots;
    this.camera.name = 'slide-trackside-camera';
  }

  /**
   * Which shot covers arc fraction `t`.
   *
   * Total on [0, 1] by construction: the beats tile the whole ride with no gap
   * and no overlap, and the last one owns `t === 1`. `check:slide-rider` asserts
   * that every frame of a real ride finds a shot here, because a beat nobody
   * covers is a moment where the game has no camera — the kind of hole nobody
   * notices until a child rides it.
   */
  shotAt(t: number): SlideShot {
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    const index = Math.min(this.shots.length - 1, Math.floor(clamped * BEATS));
    // Non-null by construction — `planSlideShots` always fills every beat — but
    // asserted rather than assumed, because an empty plan silently answering
    // "chase forever" is precisely a check that cannot fail.
    const shot = this.shots[index];
    if (!shot) throw new Error(`the slide shot plan has no beat ${index} of ${BEATS}`);
    return shot;
  }

  /**
   * One frame. `t` is how far down the chute she is; `feet` and `head` are her
   * model's two ends in world space.
   *
   * Returns the shot now live, having already moved and aimed the trackside
   * camera if it is the one being rendered. A caller that sees a different shot
   * from last frame should **cut** to it — see the hard-cut note at the top.
   */
  update(t: number, feet: Vector3, head: Vector3): SlideShot {
    const shot = this.shotAt(t);
    this.live = this.shots.indexOf(shot);
    if (shot.kind !== 'trackside' || !shot.eye) return shot;

    this.camera.position.copy(shot.eye);
    // Aim at her middle, and with world up — so the trackside shot has a **level
    // horizon** while the chase banks and pitches with the chute. That contrast
    // is not incidental: it is what makes the cut read as a different camera
    // rather than as the picture glitching.
    this.aim.lerpVectors(feet, head, AIM_ALONG_BODY);
    this.camera.up.copy(UP);
    this.camera.lookAt(this.aim);
    return shot;
  }

  /** Back to before the ride, so the first frame of the next one is a fresh cut. */
  reset(): void {
    this.live = -1;
  }

  /** Which shot is live, or `null` between rides. */
  get liveShot(): SlideShot | null {
    return this.live < 0 ? null : (this.shots[this.live] ?? null);
  }

  resize(width: number, height: number): void {
    fitCameraToViewport(this.camera, TRACKSIDE_FOV, width, height);
  }
}
