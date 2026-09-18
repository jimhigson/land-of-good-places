import { Object3D, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { fitCameraToViewport } from '../../core/RideCamera';
import { RIDE_RECLINE } from '../../entities/ridePose';

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
 *    {@link GIANT_SLIDE_SPEED}; the trackside eye is {@link TRACKSIDE_STANDOFF_FLOOR}–{@link TRACKSIDE_STANDOFF_CEILING}
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
 *
 * ### 55° cleared occlusion and still failed legibility — a second, later measurement
 *
 * The table above answers "is the ray to her blocked at all", which is a real
 * question but not the one `check:slide-rider`'s trackside clause actually asks
 * (added 6 August, after this table was measured): **how much of her body fills
 * the frame**, not merely whether a single ray reaches her. 55° passed the
 * occlusion sweep and still let a rider's body collapse to 0.11% of frame
 * against the check's 0.40% floor — found on beat 1 of the canonical seed, at
 * the far end of its span (t≈0.333), where her chute-relative heading has
 * swung ~45° from the beat's own midpoint (which is where the eye's `right`/`up`
 * frame is built) and the beat's pitch is almost flat (≈3.7°). The occlusion
 * sweep is binary — a ray either lands on her or it does not — so it cannot see
 * a rider who is technically unoccluded but reduced to a sliver by being viewed
 * nearly end-on down the trough. That is a second, independent failure mode
 * from the hand-rail cut the 50°/55° figures were tuned against, and it needed
 * a second measurement to find.
 *
 * Re-measured directly against `check:slide-rider`'s own pixel-fraction floor
 * (not the occlusion raycast) by sweeping elevation and standoff together and
 * rendering the actual worst frame: **standoff turns out not to be inert after
 * all** once legibility rather than bare occlusion is the question — a bigger
 * standoff *and* a steeper elevation both help, up to a point, and pushing
 * either one alone past its own sweet spot makes it worse again (she reads
 * smaller from further away; a near-vertical eye loses its lateral spread).
 * **75°, at the existing 7 m standoff, is where the same worst frame that
 * measured 0.11% measures 0.48%** — 20% of headroom over the 0.40% floor,
 * without moving the standoff at all. The other two trackside beats, which
 * already passed, get *better* too (their own worst samples rose from 0.56%
 * and 0.77% to 1.03% and 1.17%) — steeper is safe everywhere on this ride, not
 * just on the beat that was failing, which is the same "steeper is always
 * safe; shallower is a cliff" shape the original 50° finding already had.
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
 * The lowest a trackside eye may sit above the chute's own side plane, in
 * radians — **the guard for what cannot be probed at plan time**.
 *
 * 50° is where the occlusion sweep in the table above first reaches 100% beat
 * coverage; this is that plus a flat 5° of margin. It is a **floor the search
 * may not go under**, not a placement.
 *
 * The rail itself no longer needs it — {@link chuteBlocksView} measures that
 * against the built chute. What it still guards is **the castle and the
 * hillside**, and the reason is an ordering one worth knowing before anybody
 * lowers it to widen the search: the shot plan is made in `Building`'s
 * constructor *before* `gardenRoot` is stood in its plot, so its world
 * transform is not yet set and a ray fired at it there would measure a castle
 * that is not where the castle is. That is a wrong measurement rather than a
 * missing one, which is worse, so the castle is not probed and this angle
 * stands in for it. `check:slide-rider` and the trackside invariant both ray
 * against the built castle afterwards, when it *is* placed, and would catch a
 * floor set too low.
 *
 * It is not the answer to "how much of her does the frame show". **75° used to
 * be**, and that is the number this change deletes: it was read off one
 * rendered frame of one beat of one seed, and it did not survive the chute this
 * branch grows — the same beat 1 came back at 0.13% of frame. How big she reads
 * is now *measured across the whole beat*, by {@link placeTracksideEye}, rather
 * than hoped for from a constant. Elevation is one of the things it sweeps, so
 * a beat that genuinely wants 75° still gets it — by measurement.
 */
const TRACKSIDE_ELEVATION_FLOOR = (55 * Math.PI) / 180;

/**
 * How close a trackside eye may stand to the chute, in metres — **the pan
 * whip, and nothing else**.
 *
 * The pan rate at closest approach is `GIANT_SLIDE_SPEED / standoff`, about
 * 83°/s here. Nearer than this and the shot reads as a lurch rather than as
 * speed, which is a bad shot however much of the frame she fills — so the
 * legibility search may not buy pixels with it.
 */
const TRACKSIDE_STANDOFF_FLOOR = 4.5;

/**
 * How far out the search may stand an eye, in metres.
 *
 * Nothing physical stops it going further; she simply reads smaller, so the
 * score settles it and this only bounds the sweep. Twelve is comfortably past
 * the 6–8 m the canonical seed's beats actually choose, so the optimum is
 * interior rather than pinned to the edge — if a seed ever pins to it, that is
 * a sign to widen this rather than a silent clamp.
 */
const TRACKSIDE_STANDOFF_CEILING = 12;

/** Standoffs tried, in metres. Half a metre is well under what reads. */
const STANDOFF_STEP = 0.5;

/** Elevations tried, in radians — 2.5°, finer than the eye can tell. */
const ELEVATION_STEP = (2.5 * Math.PI) / 180;

/**
 * How many points along its own beat an eye is anchored at, in turn.
 *
 * The midpoint is the obvious anchor and on the canonical seed it wins; it is
 * swept anyway because a beat that turns asymmetrically has its best vantage
 * off-centre, and there is no reason for the generator to assume otherwise.
 * Even, so the midpoint is always among the candidates.
 */
const ANCHOR_CANDIDATES = 8;

/**
 * How far short of the rider a sight-line probe stops, in metres.
 *
 * She lies **in** the trough, so a ray that ran the whole way to her would end
 * by striking the chute she is lying in and report every placement blocked. A
 * fifth of a metre is well inside {@link CHUTE_ENVELOPE}'s own half-width, so
 * it cannot skip past a wall that is genuinely in the way.
 */
const RIDER_RAY_BACKOFF = 0.2;

/**
 * How many placements may be probed against the built chute before the search
 * settles for the least blocked one it found.
 *
 * The probe is the only expensive part — the candidates are ranked by how big
 * she reads first, so the answer is usually the first one tried, and this is a
 * ceiling on the pathological case rather than a budget anybody spends. Two
 * hundred × eleven rays is a few milliseconds against a park build.
 */
const MAX_PROBED_PLACEMENTS = 200;

/**
 * How many moments of the beat each candidate is scored against.
 *
 * The score is the **worst** of them, so this is really "how finely is the
 * worst moment resolved" — and it must be resolved at least as finely as
 * anything that will later measure the same beat, or the search optimises a
 * worst moment that is not the real one. `parkFacts.ts` samples a trackside
 * beat 41 times; twenty-one here is the same order, and coarser than that let
 * seed 24's beat 1 slip a genuinely end-on moment between two samples.
 */
const BEAT_SAMPLES = 20;

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
/**
 * **How much of her a given eye can actually show, at one instant.**
 *
 * The apparent angular extent of her body: how long she looks from there,
 * divided by how far away she is. Two things can shrink her to a sliver and
 * this is the one quantity that sees both —
 *
 * - **distance**, which the old placement code was the only thing measuring;
 * - **angle**, `sin(theta)` between the line of sight and the axis she lies
 *   along. Viewed end-on down the trough she is a head and nothing else,
 *   whatever the distance. That is the 0.13%-of-frame failure this replaced.
 *
 * Her actual length is left out on purpose. It scales every candidate equally,
 * so it cannot change which one wins — and putting it in would be a second
 * description of how big a child is, which is the bug shape CLAUDE.md's "two
 * definitions of one thing" section is about. What she reads as in *pixels* is
 * `check:slide-rider`'s question, measured on the built ride; this is only the
 * ordering the placement search steers by.
 */
function apparentBodyExtent(eye: Vector3, at: Vector3, bodyAxis: Vector3): number {
  const toRider = at.clone().sub(eye);
  const distance = toRider.length();
  if (distance < 1e-4) return 0;
  const cos = Math.abs(toRider.divideScalar(distance).dot(bodyAxis));
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  return sin / distance;
}

/**
 * Which way a rider lies at `t`, feet to head, in world space.
 *
 * She lies **feet first** in the chute's own frame, tipped back by
 * {@link RIDE_RECLINE} — so her head is up-slope and slightly raised, which is
 * why this is `-tangent` and `+up` mixed by the recline rather than either one
 * alone. The angle is imported rather than restated: `ridePose.ts` is the one
 * description of how a body lies on this chute, and `Building` poses her, the
 * pets follow her and `ParadeMember` turns by the very same number.
 */
function riderAxisAt(tangent: Vector3, up: Vector3, target: Vector3): Vector3 {
  const lean = Math.abs(RIDE_RECLINE);
  return target
    .copy(up)
    .multiplyScalar(Math.cos(lean))
    .addScaledVector(tangent, -Math.sin(lean))
    .normalize();
}

/** One candidate eye, and the point on the chute its frame was built at. */
interface PlacedEye {
  readonly eye: Vector3;
  readonly covers: Vector3;
}

/**
 * **Is anything of the chute between this eye and the child?**
 *
 * Asked of the **built chute**, by raycast, at the moment the shot plan is made
 * — not of a model of it. That is the difference this replaced, and it is the
 * rule CLAUDE.md states for every generator here: backtrack against the real
 * world as it stands, never against the two or three obstacle shapes a
 * generator happens to know by name.
 *
 * An analytic version of this was written first and was wrong in a way worth
 * recording, because it looked right. It projected the eye into the rider's own
 * cross-section and asked whether it cleared *that* section's wall — which is
 * the whole of the 40°/50° table above, and it is sound as far as it goes. It
 * cannot see the wall that is actually in the way: on the canonical seed's beat
 * 5 the chute **bends back** between the eye and the rider, so what blocked the
 * shot for 31 frames was a length of trough 1.4 m in front of her belonging to
 * a different part of the curve entirely. A cross-section test is blind to that
 * by construction — it drops the along-chute component, which is exactly where
 * the offending geometry was. The real chute is right there; ask it.
 *
 * The ray stops just short of her so that the trough she is lying in cannot
 * count as blocking the view of her.
 */
function chuteBlocksView(sight: Raycaster, eye: Vector3, at: Vector3, chute: Object3D): boolean {
  const toRider = at.clone().sub(eye);
  const reach = toRider.length();
  if (reach < 1e-4) return false;
  sight.set(eye, toRider.divideScalar(reach));
  sight.far = reach - RIDER_RAY_BACKOFF;
  if (sight.far <= 0) return false;
  return sight.intersectObject(chute, true).length > 0;
}

/**
 * **Stand the eye where it can see her for the whole beat — searched, not
 * constructed.**
 *
 * The old version built one eye out of the beat's **midpoint** frame at a fixed
 * elevation, then stepped the standoff in while the worst *distance* across the
 * beat was too big. Distance was never the thing that failed. On the canonical
 * seed's beat 1 the rider stayed 6.6–8.9 m away all the way through — inside
 * every allowance — while the line of sight swung from square across her
 * (`|cos| = 0.00`, body 2.58% of frame) to straight down her (`|cos| = 0.91`,
 * body **0.13%**), because the chute *turns* inside a beat and a midpoint-
 * anchored eye is broadside only at the midpoint. The chute stretches with the
 * park (#241), so beats get longer and this gets worse, not better; 75° of
 * elevation was a hand-tune against the same symptom on the old chute and did
 * not survive a new one.
 *
 * So this does what every other generator in this codebase does: it tries
 * different decisions and **measures the result**. Anchor along the beat,
 * elevation and standoff are swept together, each candidate is scored by the
 * **worst** {@link apparentBodyExtent} across its own beat — the worst moment is
 * what the check gates on, so it is what is optimised — and the best is taken.
 *
 * Two hard constraints survive from the measurements that earned them, because
 * neither is something this score can see:
 *
 * - **{@link TRACKSIDE_ELEVATION_FLOOR}**, standing in for the castle and the
 *   hillside, which are not yet placed when this runs and so cannot be probed.
 * - **{@link TRACKSIDE_STANDOFF_FLOOR}**, the pan whip. A shot that reads as a
 *   lurch is a bad shot at any body fraction.
 */
function placeTracksideEye(
  curve: RideCurve,
  awayFrom: { readonly x: number; readonly z: number },
  chute: Object3D,
  from: number,
  to: number,
): PlacedEye {
  // Where she will be, and which way she will be lying, across the beat — one
  // sweep, reused by every candidate.
  const riders: { at: Vector3; axis: Vector3 }[] = [];
  for (let i = 0; i <= BEAT_SAMPLES; i += 1) {
    const t = from + ((to - from) * i) / BEAT_SAMPLES;
    const at = curve.pointAt(t, new Vector3()).clone();
    const tangent = curve.tangentAt(t, new Vector3()).normalize();
    const right = new Vector3().crossVectors(tangent, UP);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new Vector3().crossVectors(right, tangent).normalize();
    riders.push({ at, axis: riderAxisAt(tangent, up, new Vector3()) });
  }

  // **Two questions, in order, and the order is the point.** An eye that hides
  // her behind the chute is not a candidate at all, however much of the frame
  // she would have filled — so every placement is *scored* on how big she reads
  // and then *tried* against the built geometry in that order, taking the first
  // that is actually clear. Ranking first and probing in rank order is what
  // keeps this cheap: the winner is usually found in the first handful of
  // probes, and a raycast is only ever spent on a candidate worth having.
  const candidates: { eye: Vector3; covers: Vector3; score: number }[] = [];

  for (let a = 0; a <= ANCHOR_CANDIDATES; a += 1) {
    const anchorT = from + ((to - from) * a) / ANCHOR_CANDIDATES;
    const covers = curve.pointAt(anchorT, new Vector3()).clone();
    const tangent = curve.tangentAt(anchorT, new Vector3()).normalize();

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

    // The beat's own downhill pitch is added to the floor, so the floor means
    // on this chute what it meant on the one it was measured against: a steeper
    // beat tilts the trough's frame and eats the margin degree for degree.
    //
    // **Never past the chute's own vertical.** Elevation is an angle from
    // `right` in the plane square to the chute, so beyond 90° the eye crosses
    // over the top and lands on the *near* side, looking back through the
    // hand-rail it was lifted to see over. On the canonical seed, once the
    // chute was held against the planet (#645), beat 3 pitched 42° in world `y`
    // and an unclamped eye was placed at 117°, with the near rail hiding the
    // rider at the start of the beat.
    const pitch = Math.atan2(-tangent.y, Math.hypot(tangent.x, tangent.z));
    const floor = Math.min(Math.PI / 2, TRACKSIDE_ELEVATION_FLOOR + Math.max(0, pitch));

    for (let elevation = floor; elevation <= Math.PI / 2 + 1e-9; elevation += ELEVATION_STEP) {
      const cosE = Math.cos(elevation);
      const sinE = Math.sin(elevation);
      for (
        let standoff = TRACKSIDE_STANDOFF_FLOOR;
        standoff <= TRACKSIDE_STANDOFF_CEILING + 1e-9;
        standoff += STANDOFF_STEP
      ) {
        const eye = covers
          .clone()
          .addScaledVector(right, side * standoff * cosE)
          .addScaledVector(up, standoff * sinE);
        let score = Infinity;
        for (const rider of riders) {
          const extent = apparentBodyExtent(eye, rider.at, rider.axis);
          if (extent < score) score = extent;
        }
        candidates.push({ eye, covers, score });
      }
    }
  }

  candidates.sort((x, y) => y.score - x.score);

  const sight = new Raycaster();
  let best: PlacedEye | null = null;
  let fewestBlocked = Infinity;
  const probes = Math.min(candidates.length, MAX_PROBED_PLACEMENTS);
  for (let i = 0; i < probes; i += 1) {
    const candidate = candidates[i]!;
    let blocked = 0;
    for (const rider of riders) {
      if (chuteBlocksView(sight, candidate.eye, rider.at, chute)) blocked += 1;
    }
    if (blocked === 0) return { eye: candidate.eye, covers: candidate.covers };
    // Nothing clear yet — remember the least bad, so a beat the chute wraps
    // round itself still gets the best eye there is rather than an arbitrary
    // one. `check:slide-rider` fails on any blocked frame, so this is a floor
    // under the failure, never a way to pass with one.
    if (blocked < fewestBlocked) {
      fewestBlocked = blocked;
      best = { eye: candidate.eye, covers: candidate.covers };
    }
  }

  // Non-null by construction — the sweep always produces at least one
  // candidate, since the elevation floor is clamped to 90° and the standoff
  // floor is below its ceiling — but asserted rather than assumed, because a
  // beat silently getting no eye is a camera nobody has ever looked through.
  if (!best) throw new Error(`no trackside eye could be placed for the beat ${from}..${to}`);
  return best;
}

export function planSlideShots(
  curve: RideCurve,
  awayFrom: { readonly x: number; readonly z: number },
  chute: Object3D,
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
    const placed = placeTracksideEye(curve, awayFrom, chute, from, to);
    shots.push({ kind: 'trackside', from, to, eye: placed.eye, covers: placed.covers });
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
