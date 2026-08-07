import { PerspectiveCamera, Vector3 } from 'three';
import { angleDelta, clamp, damp } from '../../core/mathUtils';
import { PLAYER_LANE, type RailRaceRoute } from './route';

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
 * on screen — so the same stretch of {@link AHEAD} metres fits from much nearer
 * the rider.
 *
 * That angle is not a fifth dial. It falls out of `RIDER_SCREEN_X_PORTRAIT`/
 * `RIDER_SCREEN_X_LANDSCAPE`: the rider is off to the left of the picture, so
 * the middle of the picture is already some way down the track from them, and
 * the camera is therefore already pointing that way. Pushing the rider further
 * left (a phone stood up wants it further left than a monitor does) swings the
 * aim further off side-on, and that alone brings the rig in closer to the rider
 * and shrinks the picture. One asked-for number, two dependent ones, no new
 * dial — run `npm run check:rail-race` for the actual current figures, which
 * move whenever {@link AHEAD} or the screen-position constants do, so are not
 * worth pinning in prose here a third time.
 *
 * It is bounded, though, by {@link MAX_SWING}: past about 26° the rider stops
 * crossing the picture and starts drifting into it, and a side-scroller a child
 * reads left to right is the brief. A phone in portrait wants more swing than
 * that, so it gets the cap and makes the rest up by **standing further down the
 * track than the rider** — which puts them left of centre just as well, only
 * without the foreshortening, so the picture there is a little wider than the
 * uncapped rig's would have been. That is the whole cost of the bound, and it
 * is a bound on a rule the game is built on rather than a tuning knob.
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
 * Was 27 (a shade more than the 26.1 m the first "too zoomed out" fix's shipped
 * rig showed, so that fix didn't quietly buy its win with less road). Still too
 * zoomed out at 27, on the family's own playtest of the deployed rig on
 * 1 August 2026 — halved to 13.5 on that verdict. Raised again the same day,
 * by 50% to 20.25, once the family had actually raced with the reworked
 * physics (roughly 2x faster) and 2.5x `RIDE_SCALE` live: 13.5 read too close
 * once the cart itself filled more of the screen. This is still the number to
 * move if warning time and closeness pull against each other again.
 */
export const AHEAD = 20.25;

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
 * just been bonked drop back. It is a floor, not a value to keep tuning — was
 * 0.13, moved down to that floor on the same 1 August 2026 playtest verdict that
 * halved {@link AHEAD}, and should not go lower than this even if asked again.
 *
 * `RIDER_SCREEN_X_LANDSCAPE` moved from 0.28 to 0.34 on 2 August 2026: the
 * standings HUD (`.mg-portrait-strip[data-layout='row']` in `style.css`) docks
 * to the left edge in landscape instead of sitting in a top row, so the rider
 * needed to sit further right to stay clear of it. `RIDER_SCREEN_X_PORTRAIT`
 * is untouched — the standings HUD stays in its top row in portrait, exactly
 * as before, so nothing there needed compensating. Re-verified with
 * `npm run check:rail-race`, whose own `riderX > 0.06 && riderX < 0.36` bound
 * is what keeps this number honest.
 */
const RIDER_SCREEN_X_PORTRAIT = 0.1;
const RIDER_SCREEN_X_LANDSCAPE = 0.34;
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

const TAN_TILT = Math.tan(TILT);
/**
 * `sec TILT`. The rig's aim is built as a horizontal unit vector with a
 * `-TAN_TILT` rise bolted on, so this is its length before it is normalised, and
 * it turns up in every one of the closed forms in {@link RaceCamera.solve}.
 */
const SEC_TILT = Math.hypot(1, TAN_TILT);

/**
 * A ceiling on how far the rig may swing its aim down the track.
 *
 * **Why there has to be one.** The rider is asked to sit left of centre, and the
 * plainest way to put them there is to aim past them down the track. Do only
 * that and the swing needed is `atan(-riderNdc · sec TILT · tan(hFov/2))` — a
 * function of the *window*, and on a phone in portrait (where
 * `RIDER_SCREEN_X_PORTRAIT` is a hard-left 0.1) it comes to **29°**. That is too
 * far: the camera's screen-right and the rider's direction of travel are exactly
 * `cos(swing)` apart, so 29° means a rider crosses the picture at 0.875 of their
 * speed and drifts into the screen for the rest. `check:rail-race` asks for
 * ≥ 0.9 — the side-scroller rule, that a rider reads left to right — and 29°
 * cannot keep it.
 *
 * So the swing is capped here and the rest of the rider's leftward placing is
 * made up by **standing further down the track** instead (see
 * {@link RaceCamera.solve}). 22° keeps `cos = 0.927` clear of that 0.9 floor with
 * the same sort of margin {@link AHEAD_SCREEN_X} keeps against the screen edge,
 * and it costs almost nothing: the swing is what foreshortens the road ahead and
 * so lets the rig stand close, but measured across 22–25.5° the phone's picture
 * only moves between 18.6 and 19.3 px per metre. Margin is worth more than
 * 0.4 px/m.
 *
 * A monitor never reaches this — it wants 12.5° — so the landscape framing the
 * family already signed off is untouched.
 */
const MAX_SWING = (22 * Math.PI) / 180;

/**
 * Stations round the lap at which the look-ahead is measured, for
 * {@link RaceCamera.solve}'s stand-off. A sample every ~1.2 m of a 600 m lap:
 * far finer than the ~40 m over which the ring's curvature actually changes.
 */
const LOOKAHEAD_STATIONS = 512;

/** How quickly the rig catches up. Damped, so a bonk does not jolt the screen. */
const FOLLOW = 0.12;

/**
 * **How much further back the rig stands at full speed** — 0.34 means a third
 * again as far away when flat out as when crawling.
 *
 * Jim, 6 August 2026: the camera should pull back as she speeds up, showing more
 * track ahead, *eased not snapped* — and he named why it matters: a duck bar
 * slows her hard, so the transition happens right where she is looking.
 *
 * ### Why this can be a plain multiplier and change nothing else
 *
 * It scales {@link RaceCamera.stand} **and** {@link RaceCamera.look} by the same
 * factor, which is a uniform scaling of the whole rig *about the rider*. That
 * changes every distance and no direction: the camera's aim, its tilt, its swing
 * and the rider's own position on screen all come out bit-identical, and the only
 * thing that moves is how many metres of the world the lens covers. So none of
 * the framing the family signed off is at risk — {@link AHEAD} is a floor and
 * this only ever raises it.
 *
 * That is also why it is applied here rather than by re-running {@link solve}:
 * solving per frame would re-derive the swing and the stand-off from a moving
 * number and could walk the rider off her mark.
 */
const SPEED_PULL_BACK = 0.34;

/**
 * The speed {@link SPEED_PULL_BACK} is reached at, m/s.
 *
 * `simulate.ts`'s `MAX_SPEED` is a hard ceiling that nothing actually touches —
 * a strong player cruises about 33.5 and a child about 30 — so pinning the zoom
 * to it would spend most of its range on speeds the ride never sees. 32 is where
 * real racing happens, and the factor is clamped, so going faster simply holds
 * the widest framing.
 */
const PULL_BACK_AT = 32;

/**
 * Half-life of the zoom's easing, seconds.
 *
 * Much slower than {@link FOLLOW}, deliberately: the follower has to keep the
 * rider on her mark and so must be quick, while the zoom is the thing Jim asked
 * to be *eased*. A bonk drops her speed by two thirds in one frame, and at
 * `FOLLOW`'s 0.12 s that would read as the picture flinching. 0.55 s lets the
 * camera drift in over about a second, which reads as a camera operator easing
 * off rather than a cut.
 *
 * A half-life, not a per-frame lerp, so it behaves the same on a 120 Hz monitor
 * as on a struggling phone.
 */
const ZOOM_HALF_LIFE = 0.55;

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


/**
 * The rider's own lane offset from the ring's centre line, on the ring this
 * camera was given. The framing promises are about the rider, so they are
 * measured there — and read off the route rather than a module constant,
 * because there are two rings of different widths and only one of them is ever
 * raced on.
 *
 * Was `riderRadius`. A radius placed the rider only while the ring was a circle
 * about the origin; it now follows the park's edge, so the rider's position has
 * to come from the path itself and this is the lateral part of it.
 */
function riderOffset(route: RailRaceRoute): number {
  return route.laneOffsets[PLAYER_LANE] ?? 0;
}

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

/**
 * **How far a rider turns towards this camera so her face can be seen at all.**
 *
 * Jim, riding it on 5 August 2026: *"we can't see the face because the player
 * needs to face towards the camera so you can see their expression."* He is
 * right, and it is the whole of PR #223: a frowning face nobody can ever look
 * at is a feature that does not exist.
 *
 * The rig above stands square-on to the chord it frames, which measures
 * **81.1° off the rider's own forward** — identically at every window shape and
 * every point on the ring, because a ring is the same shape everywhere and
 * {@link RaceCamera.solve} only ever changes how *far* out it stands, never the
 * bearing. So she was in near-perfect profile: measured by projecting her real
 * eyes through this real rig, one of them sat at a facing of −0.25 on a monitor
 * and −0.35 on a phone — round the back of her head, not drawn at all — while
 * the other grazed at 0.48, and both landed on the same screen x.
 *
 * Turning the whole 81.1° would point her face straight down the lens and her
 * shoulders straight out of the cart. This turns **50° of it**, which leaves a
 * three-quarter view rather than a mugshot, and she still plainly races
 * forwards.
 *
 * **And only while she is sad.** Jim, 6 August 2026: *"they need turn their
 * head to the camera only on sad expression, not all the time"* — which is the
 * better feature, because the turn exists to make a bonk *readable* and turning
 * permanently spends that readability on every ordinary moment of the race. She
 * looks round at you **because** she is sad about it, and the rest of the time
 * she watches where she is going. `sadness` is `RailRace`'s own eased
 * `Cart.sad`, driven by `riderIsSad` and by nothing else, so the frown and the
 * turn are one feature and cannot disagree about whether it is happening.
 *
 * **50 and not more, because on a phone the two pull against each other.** She
 * is framed hard left in portrait (`RIDER_SCREEN_X_PORTRAIT`, a documented
 * floor), and turning her swings an eye — 0.6 m off the skull's centre, 1.5 m
 * once `RIDE_SCALE` has had it — further towards that edge. Swept with
 * `check:rail-race`'s own measurement, worst case anywhere on the ring, as
 * (how squarely the worse eye faces the lens) / (how far it stays inside the
 * picture, in NDC):
 *
 * ```
 *          monitor          phone
 *   0°     -0.272 / 0.227   -0.371 / 0.268   ← one eye behind the head
 *  40°      0.392 / 0.238    0.279 / 0.116
 *  50°      0.546 / 0.241    0.437 / 0.061   ← here
 *  60°      0.685 / 0.244    0.003 of margin left
 * ```
 *
 * A monitor would happily take 60°; a phone runs out of picture. One number
 * serves both, so it is set where the phone still has real room.
 *
 * Nothing here touches steering. GAME_DESIGN.md's CONTROL rule governs what a
 * *button* does; this is a pose, and the cart, the rails and the direction she
 * travels are all exactly as they were.
 */
export const FACE_TURN_MAX = (50 * Math.PI) / 180;

/**
 * Of {@link FACE_TURN_MAX}, the share the **head** contributes rather than the
 * body — so 21° of head on top of 29° of shoulder.
 *
 * Split, rather than all neck, because `ferrisWheel/gondola.ts` has already
 * settled this exact question for a seated figure — *"the whole toy turns, not
 * its neck"* — and this kid has no neck to turn: `art/models/kid.ts` puts the
 * head pivot *inside* the top of the torso ("what hides the neck"), so a large
 * yaw on its own is a skull revolving inside a jumper. 21° also keeps the head
 * inside the 20°–35.5° band of head yaws the park already uses elsewhere (the
 * shopkeeper's idle, the backpack pet's peek); nothing in the game had ever
 * yawed a person's head further.
 */
export const FACE_TURN_HEAD_SHARE = 0.42;

/** A rider's turn towards the camera, split between the two things that turn. */
export interface FaceTurn {
  /** Radians to add to the cart's own yaw, for the rider's root. */
  readonly body: number;
  /** Radians of `head.rotation.y` on top of that. */
  readonly head: number;
}

const NO_TURN: FaceTurn = { body: 0, head: 0 };

/**
 * How far a rider facing `cartYaw` at `at` should come round towards a camera
 * standing at `cameraAt` — see {@link FACE_TURN_MAX}.
 *
 * Takes the camera's **live** position rather than a bearing written down
 * somewhere: this rig has already been re-solved twice on family feedback, and
 * a second constant elsewhere saying "the camera is over there" is exactly the
 * kind of copy that goes quietly stale the next time it moves.
 *
 * Pure, and exported, so `scripts/check-rail-race.mts` can pose a real kid with
 * the very function the ride poses her with and then measure whether her eyes
 * are actually visible — rather than re-deriving the turn and proving only that
 * arithmetic agrees with itself. That check now runs it **both ways**: a check
 * that only ever passed `sadness = 1` would go green while she stood turned
 * towards the camera for the whole race, which is the bug Jim reported in the
 * first place, inverted.
 */
export function faceTurnTowardsCamera(
  cartYaw: number,
  at: Vector3,
  cameraAt: Vector3,
  sadness: number,
): FaceTurn {
  const dx = cameraAt.x - at.x;
  const dz = cameraAt.z - at.z;
  if (sadness <= 0 || (dx === 0 && dz === 0)) return NO_TURN;
  const full = clamp(angleDelta(cartYaw, Math.atan2(dx, dz)), -FACE_TURN_MAX, FACE_TURN_MAX);
  const turn = full * clamp(sadness, 0, 1);
  const head = turn * FACE_TURN_HEAD_SHARE;
  return { body: turn - head, head };
}

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
   * track and how far up the camera stands, and where it aims.
   *
   * Solved once per {@link resize} rather than per frame, and — since the rework
   * of {@link solve} — that is now *sound* rather than an approximation. The rig
   * is a set of offsets along the track's own tangent and normal at the rider,
   * and that frame exists at every point of any curve whatsoever. The old reason
   * given here, "the ring is a ring, every point on it is the same shape", stopped
   * being true the day the ring started following the park's edge.
   */
  private readonly stand = { out: 0, along: 0, rise: 0 };
  private readonly look = { out: 0, along: 0, rise: 0 };

  /**
   * Where the point {@link AHEAD} metres in front of the rider lands **in the
   * rider's own local frame**, at every station round the lap: `along` metres
   * down the track and `out` metres to the outside of the tangent line.
   *
   * This is a property of the track alone — no window, no lens, no rig — so it
   * is measured once, here, and {@link solve} then answers every window shape
   * out of it by arithmetic. `out` runs from −7.0 m where the ring bends round
   * the park to **+6.5 m** at the two places it bends the other way, and that
   * spread is the whole reason the stand-off cannot be read off one station.
   */
  private readonly lookahead: readonly { readonly along: number; readonly out: number }[];

  /** The arc distance the framing is anchored to, and what it takes to get there. */
  private anchor = 0;
  private lastTravelled = 0;
  private speed = 0;
  /**
   * How far the rig is scaled out from the rider right now, 1 at a standstill.
   * Eased on its own half-life — see {@link SPEED_PULL_BACK}.
   */
  private zoom = 1;

  private readonly rider = new Vector3();
  private readonly out = new Vector3();
  private readonly along = new Vector3();
  private readonly aim = new Vector3();

  constructor(route: RailRaceRoute) {
    this.route = route;
    this.camera.name = 'railRace:camera';
    this.lookahead = this.measureLookahead();
    this.resize(16, 9);
  }

  /** Fills {@link lookahead}. Runs once, before the first {@link resize}. */
  private measureLookahead(): { readonly along: number; readonly out: number }[] {
    const rider = new Vector3();
    const ahead = new Vector3();
    const table: { along: number; out: number }[] = [];
    for (let i = 0; i < LOOKAHEAD_STATIONS; i += 1) {
      const station = (i / LOOKAHEAD_STATIONS) * this.route.path.length;
      // The rig's own frame — the smoothed one, so `solve` decomposes the
      // look-ahead in exactly the frame `place` will rebuild the rig against.
      const frame = this.route.path.guideAt(station);
      this.ringPoint(station, rider);
      this.ringPoint(station + AHEAD, ahead);
      const dx = ahead.x - rider.x;
      const dz = ahead.z - rider.z;
      table.push({
        along: dx * frame.tangentX + dz * frame.tangentZ,
        out: dx * frame.normalX + dz * frame.normalZ,
      });
    }
    return table;
  }

  /** Snaps the rig to a rider without a chase, for the start of a race. */
  reset(travelled: number): void {
    this.anchor = this.route.startDistance + travelled;
    this.lastTravelled = travelled;
    this.speed = 0;
    this.zoom = 1;
    this.place();
  }

  /** Follows a rider. `travelled` is metres run since the lights went out. */
  update(travelled: number, dt: number): void {
    if (dt > 0) {
      this.speed = damp(this.speed, (travelled - this.lastTravelled) / dt, FOLLOW, dt);
    }
    this.lastTravelled = travelled;
    // Stand further back the faster she is going, eased on its own much slower
    // half-life than the follower's. See SPEED_PULL_BACK.
    const wanted = 1 + SPEED_PULL_BACK * clamp(this.speed / PULL_BACK_AT, 0, 1);
    this.zoom = damp(this.zoom, wanted, ZOOM_HALF_LIFE, dt);
    // Lead by the lag the follower is about to have, so it settles on the rider
    // at every speed rather than at one. See FOLLOW_LAG.
    const target = this.route.startDistance + travelled + FOLLOW_LAG * this.speed;
    this.anchor = damp(this.anchor, target, FOLLOW, dt);
    this.place();
  }

  /** The rider's lane at arc distance `s`, at the level the lanes undulate about. */
  private ringPoint(s: number, into: Vector3): Vector3 {
    const sample = this.route.path.sampleAt(s);
    const offset = riderOffset(this.route);
    return into.set(
      sample.x + sample.normalX * offset,
      this.route.base + 0.6 + RIDER_RIDE_HEIGHT,
      sample.z + sample.normalZ * offset,
    );
  }

  private place(): void {
    const s = this.anchor;
    this.ringPoint(s, this.rider);
    // Both taken from the path's own frame. These used to be rebuilt here from
    // the bearing — a second, independent copy of the ring's geometry that only
    // agreed with `route.ts` for as long as both described the same circle.
    //
    // The **guide** frame, not the geometry one: the rig stands far enough out
    // along this normal that the ring's own tight bends would run it backwards.
    // The rider still comes from `ringPoint`, which is exact, and the rider sits
    // at the origin of this frame — so smoothing it rotates the whole rig about
    // her and leaves her screen position untouched. See `CAMERA_GUIDE_WINDOW`.
    const sample = this.route.path.guideAt(s);
    this.out.set(sample.normalX, 0, sample.normalZ);
    this.along.set(sample.tangentX, 0, sample.tangentZ);

    // One factor on both, which is a uniform scaling of the rig about the rider:
    // every direction survives it untouched and only the distances grow. See
    // SPEED_PULL_BACK.
    const zoom = this.zoom;
    this.camera.position
      .copy(this.rider)
      .addScaledVector(this.out, this.stand.out * zoom)
      .addScaledVector(this.along, this.stand.along * zoom)
      .addScaledVector(UP, this.stand.rise * zoom);
    this.aim
      .copy(this.rider)
      .addScaledVector(this.out, this.look.out * zoom)
      .addScaledVector(this.along, this.look.along * zoom)
      .addScaledVector(UP, this.look.rise * zoom);
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
   * ### The model, and the one it replaced
   *
   * The rig is **three offsets in the track's own frame at the rider** — so far
   * outward along the local normal, so far along the local tangent, so far up —
   * plus an aim swung `swing` from straight-in and leaned down by {@link TILT}.
   * That is all. {@link place} rebuilds the camera from those three numbers every
   * frame against the frame at wherever the rider now is, so the *entire* rig is
   * defined pointwise: it asks the track what it is doing **here** and never what
   * it does between here and anywhere else.
   *
   * That last property is the whole point, and it is what the previous model
   * lacked. It fitted **inscribed-angle chord geometry**: it took the chord from
   * the rider to the point {@link AHEAD} along, stood square-on to *that chord*,
   * and derived the stand-off as `L / tan Δ`. A chord is a statement about the
   * curve *between* its ends, and the geometry is only right if that stretch is a
   * near-circular arc. On a ring that follows the park's edge it is not: 100 of
   * 512 stations bend the other way (tightest concave radius ~20 m), and on those
   * the chord rotates the *opposite* side of the tangent, so a rig decomposed
   * from it at one station comes out pointing **backwards** at another. That is
   * exactly what was measured on 5 August 2026 — solving the chord model at all
   * 256 stations and interpolating took the failure count from 4 to 7 and added a
   * "looks BACK down the track" mode that no single solve had. A better-sampled
   * wrong model is still wrong, and now disagrees with itself between neighbours.
   * Do not bring the chord back.
   *
   * ### What can be promised exactly, and what cannot
   *
   * - **The rider at `riderNdc` — exactly, at every station.** The rider sits at
   *   the origin of the frame the rig is expressed in, so where they land on
   *   screen depends only on the three offsets and the lens. Nothing about the
   *   track can disturb it.
   * - **`AHEAD` at `aheadNdc` — not exactly, and it does not need to be.** Where
   *   that point falls depends on where the track has gone by then, which varies.
   *   But the promise `check:rail-race` guards is *one-sided*: a window may never
   *   show **less** road than promised, only more. So the stand-off is solved at
   *   the station that demands the most and every other station over-delivers.
   *
   * ### The closed forms
   *
   * Work in the rider's frame — `u` along the track, `v` outward, `w` up, rider
   * at the origin — and write `c = cos swing`, `s = sin swing`, `N = sec TILT`.
   * The camera stands at `(B, D, H)` with `H = D·c·TAN_TILT` (that is what makes
   * the elevation over the track match the tilt, which is what stacks the four
   * lanes into four rows). Its aim is `(s, −c, −TAN_TILT)/N`, and its screen-right
   * is `(c, s, 0)` — so `dot(screenRight, travel) = c` **exactly**, which is what
   * {@link MAX_SWING} exists to keep above the side-scroller floor.
   *
   * A point `(u, v, 0)` therefore lands across the screen at
   *
   * ```
   * screenX = N·[(u − B)·c + (v − D)·s] / ([(u − B)·s − v·c + D·c·N²] · tanH)
   * ```
   *
   * Putting the rider (`u = v = 0`) at `riderNdc` gives `B` as a fixed multiple
   * of `D`, with `g = −riderNdc·tanH/N`:
   *
   * ```
   * B = D·(g·c·N² − s) / (c + g·s)
   * ```
   *
   * — zero exactly when `tan swing = −riderNdc·N·tanH`, which is the swing a rig
   * standing straight out from the rider would need. Cap the swing below that (as
   * a phone in portrait does) and `B` goes positive: the camera makes up the
   * difference by **standing further down the track than the rider**, which puts
   * them left of centre for the same reason.
   *
   * Then, with `h = aheadNdc·tanH/N` and `k = B/D`, putting a look-ahead point at
   * `aheadNdc` is linear in `D`, so it rearranges to one division per station:
   *
   * ```
   * D = [u·c + v·s − h·(u·s − v·c)] / [k·c + s + h·(c·N² − k·s)]
   * ```
   *
   * `screenX` is monotone decreasing in `D` at every station (standing back
   * drags the look-ahead point towards the rider), so taking the largest `D` any
   * station asks for satisfies all of them at once. No bisection, no opening
   * guess, and — unlike the model this replaces — no second formula to keep in
   * step with a first.
   */
  private solve(tanH: number, riderNdc: number, aheadNdc: number): void {
    // The rider is asked for left of centre, so this is positive: how far left,
    // as a fraction of the half-width.
    const leftness = -riderNdc;
    // Swing the aim down the track to put them there — as far as that alone can,
    // and no further than the side view allows.
    const swing = Math.min(Math.atan(leftness * SEC_TILT * tanH), MAX_SWING);
    const cos = Math.cos(swing);
    const sin = Math.sin(swing);

    // Whatever the swing could not do, standing further down the track does.
    const g = (leftness * tanH) / SEC_TILT;
    const alongPerOut = (g * cos * SEC_TILT * SEC_TILT - sin) / (cos + g * sin);

    // The stand-off, from the station that demands the most of it.
    const h = (aheadNdc * tanH) / SEC_TILT;
    const perOut =
      alongPerOut * cos + sin + h * (cos * SEC_TILT * SEC_TILT - alongPerOut * sin);
    let out = 0;
    for (const point of this.lookahead) {
      const wanted =
        (point.along * cos + point.out * sin - h * (point.along * sin - point.out * cos)) / perOut;
      if (wanted > out) out = wanted;
    }

    this.stand.out = out;
    this.stand.along = out * alongPerOut;
    this.stand.rise = out * cos * TAN_TILT;

    // Walk down the aim until it has dropped the whole rise, so it sits at the
    // level the lanes undulate about and all four stay framed. The aim is a unit
    // vector falling `TAN_TILT / SEC_TILT` per metre, so that takes this long.
    const reach = (this.stand.rise * SEC_TILT) / TAN_TILT;
    this.look.out = this.stand.out - (reach * cos) / SEC_TILT;
    this.look.along = this.stand.along + (reach * sin) / SEC_TILT;
    this.look.rise = 0;
  }

  dispose(): void {
    // Nothing to release: no listeners, no textures, no look control. Kept so
    // the ride can treat this exactly like the shared ride views it sits beside.
  }
}
