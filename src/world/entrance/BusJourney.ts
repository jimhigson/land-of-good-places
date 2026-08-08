import {
  BoxGeometry,
  BufferAttribute,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { PALETTE } from '../../core/palette';
import { CAMERA_PITCH_DEGREES, CAMERA_YAW_DEGREES } from '../../core/constants';
import { createRandom, clamp01, lerp, smoothstep } from '../../core/mathUtils';
import { toonMaterial } from '../../art/style/materials';
import { createKid, KID_HEIGHT, KID_SKIN_TONES, type KidHandle } from '../../art/models/kid';
import { CROWD_HAIR_STYLES, type HairStyle } from '../../art/models/hair';
import { HAIR_COLOURS, OUTFIT_COLOURS } from '../../art/models/kidLooks';
import {
  createCatBus,
  CAT_BUS_CABIN_CEILING_Y,
  CAT_BUS_CABIN_FRONT_Z,
  CAT_BUS_SEAT_COUNT,
  CAT_BUS_LENGTH,
  type CatBusHandle,
} from './catBus';
import { createBusDriver, type BusDriver } from './busDriver';
import { ROAD_HALF_WIDTH, applyRoadUvs, roadMaterial } from './road';
// The park's own gate dimensions. Not a copy — `layout.ts` is the one owner, and
// it is reachable from here precisely because it depends on nothing heavier than
// two import-free core modules. See its note on why the arch is built twice.
import {
  ENTRANCE_GATE_HALF_WIDTH as GATE_HALF_WIDTH,
  ENTRANCE_GATE_POST_HEIGHT as GATE_POST_HEIGHT,
} from './layout';

/**
 * **The ride to the park — the twenty seconds before the gate.**
 *
 * Jim, 7 August 2026:
 *
 * > *"the bus should drive down a narrow lane with the camera rotating around
 * > it until it arrives at the park, with various hills and going past trees,
 * > but in an otherwise straight line"*
 *
 * ## Straight, and that is the point
 *
 * The lane is **one axis**. There is no route to solve, no curve to fit and no
 * interaction with the park boundary: the bus drives down world −Z, the ground
 * rises and falls beneath it, and scenery stands either side. The variety comes
 * entirely from {@link ORBIT} — the camera swinging round the bus — which is
 * why the brief specifies the two together, and why adding curves "for
 * interest" would be spending the expensive half of the budget to duplicate
 * what the cheap half already does.
 *
 * ## Why it is its own `Scene`
 *
 * Two reasons, and the second is the load-bearing one.
 *
 * The park's terrain is a **disc** that stops a couple of metres past the
 * boundary (`TERRAIN_EDGE_RADIUS = maxRadius + TERRAIN_APRON`) and then falls
 * away — measured, on the gate's own axis: −0.13 m at z = 72, −1.35 at 74,
 * −14 at 80. It is a diorama on a hilltop. A road "just outside the park" would
 * mean fighting the boundary system for ground that does not exist.
 *
 * But more than that: **this has to be on screen before the park exists at
 * all.** The whole ride is the park's loading screen, so it cannot borrow
 * `Player`, `NpcSystem` or anything else `World` owns — none of them have been
 * built yet. Hence its own scene, its own lights, its own bus and its own
 * passengers, depending on nothing heavier than the art modules.
 *
 * ## The passengers are copies, and that is fine — once
 *
 * The eleven children who ride here are **not** the park NPCs who get off at
 * the gate; they cannot be, because the crowd does not exist yet. They are
 * one-off `createKid()` models, like the driver.
 *
 * That is a second definition of "who is on the bus", which this repo has been
 * bitten by repeatedly — so it is worth being explicit about why it is safe
 * here and would not be anywhere else. The two sets are only ever compared
 * across **a single cut**, seen through translucent glass, at a distance, in
 * one frame. Nothing is ever on screen twice. The player's own look *is*
 * carried across, because that is the one a child would notice: it comes from
 * the same `CharacterCreationChoice` she chose sixty seconds ago.
 */

/** How long the ride lasts. Jim asked for "about 20s". */
export const JOURNEY_SECONDS = 20;

/** How fast the bus travels, in metres a second. A bus, not a rocket. */
const BUS_SPEED = 11;

/** The lane, in metres — everything the ride will cross, plus room to see ahead. */
const LANE_LENGTH = JOURNEY_SECONDS * BUS_SPEED + 220;

/** Half-width of the grass verge the ground mesh covers either side. */
const GROUND_HALF_WIDTH = 90;

/**
 * How far apart the two points are that the bus's pitch is taken from.
 *
 * A long vehicle bridges a dip rather than folding into it, so the bus lies
 * along the chord between the road under its front axle and the road under its
 * back one. Derived from the bus's own length — a wheelbase is most of it —
 * rather than the 14 m that used to be written here twice, so a bus that is
 * resized still bridges its own length.
 */
const BUS_PITCH_SPAN = CAT_BUS_LENGTH * 0.78;

/**
 * **How far short of the park's gate the bus stops.**
 *
 * Far enough that the arch is whole in the frame and the wall reads as a wall
 * rather than filling the screen; close enough that it is plainly *there*. At
 * {@link BUS_SPEED} this is the last two and a half seconds of the ride, which
 * is the stretch where a child works out where she is going.
 */
const PARK_STANDOFF = 30;

/**
 * How far below the cabin's ceiling the inside camera hangs.
 *
 * Enough that the lens is in open air rather than grazing the header band, and
 * small enough that it still looks *down* the gangway over everybody's heads.
 */
const INSIDE_CAMERA_HEADROOM = 0.3;

/** Where the park's gate stands, down the lane. Derived from where the ride ends. */
const PARK_AHEAD_Z = -JOURNEY_SECONDS * BUS_SPEED - PARK_STANDOFF;


/**
 * How much lane exists *behind* the bus's starting point.
 *
 * The camera orbits, so for a third of every turn it is looking back down the
 * road the bus came in on. Without this there is nothing there.
 */
const LANE_AHEAD = 120;

/**
 * The stretch of **open** lane — from behind the bus's start down to the park's
 * wall, with a few metres to spare.
 *
 * The hedges and trees are scattered over this rather than over the whole ground
 * mesh, because the ground now runs on past the gate to hold the park up: left
 * alone, the roadside hedge marched straight through the boundary wall and out
 * the other side.
 */
const LANE_OPEN_FROM = PARK_AHEAD_Z + 7;
const LANE_OPEN_RUN = LANE_AHEAD - LANE_OPEN_FROM;

/**
 * The hills, as a function of distance down the lane.
 *
 * Two sines of incommensurable wavelength plus a long swell, so the ride never
 * repeats within its own length and the bus is never level for long. Amplitudes
 * are small in absolute terms — this is a lane over rolling country, not a
 * rollercoaster, and the camera is orbiting, so vertical motion that reads as
 * gentle from one bearing reads as lurching from another.
 */
export function laneHeight(z: number): number {
  return (
    Math.sin(z * 0.0755) * 1.25 +
    Math.sin(z * 0.0412 + 1.7) * 2.0 +
    Math.sin(z * 0.0169 + 0.4) * 2.8
  );
}

/**
 * The steepest the lane ever gets, as a gradient — `sum of amplitude x
 * frequency`, which is the worst case of the derivative of the sum above.
 *
 * Exported because it is the number that decides whether this reads as a
 * country lane or a rollercoaster, and it is not obvious from the amplitudes:
 * shortening a wavelength makes a hill steeper without making it taller. The
 * first tuning kept sensible-looking amplitudes (3.1 / 4.4 / 3.2) and shortened
 * the wavelengths to make the hills visible, which took the worst gradient to
 * **27 degrees** — the captured frames show a bus diving nose-first down what
 * is plainly a ski slope. A real road tops out around 6.
 */
export const LANE_MAX_GRADIENT =
  1.25 * 0.0755 + 2.0 * 0.0412 + 2.8 * 0.0169;

/** Cross-slope, so the verges fall away and the lane sits in the land. */
function groundHeight(x: number, z: number): number {
  const across = Math.abs(x) - ROAD_HALF_WIDTH;
  if (across <= 0) return laneHeight(z);
  // Away from the tarmac the land rolls in its own right, and drops off at the
  // far edge so the mesh never ends in a visible cliff against the sky.
  const roll = Math.sin(x * 0.043 + z * 0.019) * 1.9 + Math.sin(x * 0.017) * 2.4;
  const fade = smoothstep(GROUND_HALF_WIDTH * 0.55, GROUND_HALF_WIDTH, Math.abs(x));
  return laneHeight(z) + roll * clamp01(across / 22) - fade * 26;
}

/**
 * How the camera swings round the bus.
 *
 * **The orbit is the shot** — its rate carries the whole twenty seconds, and
 * the brief says so. Slow enough that nothing swims (a six-year-old watching a
 * screen a foot from her face is the constraint, not a monitor at arm's
 * length), fast enough that it never reads as a static three-quarter view: a
 * little over one full turn across the ride.
 *
 * It **ends where the park's own camera begins**. `CAMERA_YAW_DEGREES` and
 * `CAMERA_PITCH_DEGREES` are the isometric rig's, taken from `core/constants`
 * rather than restated, and the last three seconds ease the orbit onto exactly
 * that bearing and elevation. So the cut into the park is a cut between two
 * frames of the same bus, the same size, at the same angle, moving the same way
 * — which is what makes an arrival out of what would otherwise be a jump.
 */
const ORBIT = {
  /** Turns completed over the ride, before the settle. */
  turns: 1.15,
  /** Where the swing starts, so the cat's face leads the first shot. */
  startYawDegrees: CAMERA_YAW_DEGREES + 150,
  /** Seconds at the end spent easing onto the park camera's own bearing. */
  settleSeconds: 3.2,
} as const;

/**
 * How far back the camera sits, and how high.
 *
 * Framed on the **whole bus**, which is the fault this had to fix: Stage A's
 * opening put an 18 m vehicle in a frame that cropped the cat's face off the
 * top-left. The distance is derived from the bus's own length rather than
 * chosen, so a bus that grows is still fully in shot.
 */
const CAMERA_BACK = 26;
const CAMERA_LIFT = 11;
const CAMERA_FOV = 42;

/**
 * A narrower lens for the view from inside, and it is doing real work.
 *
 * The front row sits 0.53 m either side of the gangway — a child is 1.53 m
 * across — so at the outside camera's 42 degrees two enormous heads fill the
 * left and right edges of every interior frame and the busload behind them is
 * squeezed into the middle third. There is nowhere to retreat to: everything
 * ahead of the front row is the cat's own face.
 *
 * Narrowing the lens is the one move available, and it is the right one anyway:
 * it crops the two heads flanking the lens out of shot and fills the frame with
 * the rows in front of it, which are the faces there to be looked at.
 */
const INSIDE_FOV = 33;

const DEG = Math.PI / 180;

/**
 * What the ride needs to know about the girl riding it.
 *
 * Her own look, straight from the character creator she has just closed. The
 * other eleven are dressed from the park crowd's own lists
 * (`art/models/kidLooks.ts`) rather than a palette invented here, so the
 * children in the windows are drawn from the same population as the children
 * who will be in the park.
 */
export interface JourneyRider {
  readonly skin: number;
  readonly hair: number;
  readonly outfit: number;
  readonly hairStyle: HairStyle;
}

/** One passenger, dressed out of the park crowd's own lists. */
function rollLook(rng: () => number): JourneyRider {
  const pick = <T,>(list: readonly T[], fallback: T): T =>
    list[Math.floor(rng() * list.length)] ?? fallback;
  return {
    skin: pick(KID_SKIN_TONES, { colour: PALETTE.skin, label: 'Fair' }).colour,
    hair: pick(HAIR_COLOURS, PALETTE.hair),
    outfit: pick(OUTFIT_COLOURS, PALETTE.outfit),
    hairStyle: pick(CROWD_HAIR_STYLES, 'bunches'),
  };
}

/**
 * Where the ride is watched from.
 *
 * Jim, 7 August 2026: *"we would like to be able to see inside the bus, switch
 * between the view inside of the children riding it and looking excited and the
 * outside."*
 */
export type JourneyView = 'outside' | 'inside';

export class BusJourney {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private readonly bus: CatBusHandle;
  private readonly driver: BusDriver;
  private readonly riders: KidHandle[] = [];
  private readonly lane = new Group();

  private elapsedSeconds = 0;
  /**
   * **A clock that never stops, even when the bus does.**
   *
   * Separate from {@link elapsedSeconds}, which is *distance down the lane* and
   * is deliberately held still in two cases: once the ride has run its course,
   * and while `JourneyDirector.overrunning` idles the bus at the kerb waiting
   * for a park that is taking too long.
   *
   * Driving the children's excitement off the travel clock meant that in both of
   * those cases twelve children froze mid-bounce — arms up, motionless — which
   * is a worse thing to be looking at than twelve still children would have
   * been. Found by `check:bus-journey`, which measured 0.00 m of movement in
   * four seconds and said so; nothing about the code looked wrong.
   */
  private animationSeconds = 0;
  private busZ = 0;

  private viewMode: JourneyView = 'outside';
  /**
   * The inside camera's eye and aim, **in the bus's own local space**.
   *
   * Computed once, off the seats that were actually built, and then carried
   * into world space through the bus's own matrix every frame. That is the
   * whole reason they are stored local: the bus climbs, dips and pitches, and a
   * camera inside it has to do all three exactly with it. A world-space pose
   * recomputed from a formula each frame is a second definition of where the
   * bus is, and this repo has paid for that shape repeatedly — most recently
   * with a face patch that had to track a surface it had left.
   */
  private readonly insideEye = new Vector3();
  private readonly insideAim = new Vector3();
  private readonly worldEye = new Vector3();
  private readonly worldAim = new Vector3();

  constructor(rider: JourneyRider) {
    this.scene.name = 'cat-bus-journey';
    // The same linear fog the park uses, pulled in tight: the lane has to end
    // somewhere, and it should end in haze rather than in a visible edge.
    this.scene.fog = new Fog(PALETTE.skyDayBottom, 60, 235);

    // `near` at 0.2 rather than 0.5 because this camera also goes *inside* the
    // bus, where 0.5 m clips away the nearest row of children entirely.
    this.camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.2, 900);

    // --- lighting -----------------------------------------------------------
    // `DayNight`'s own daytime rig, at its daytime values. Not shared with it:
    // `DayNight` needs a `Scene` and a `Sky` and drives a clock, none of which
    // exist yet, and a twenty-second ride does not have a time of day.
    const key = new DirectionalLight(PALETTE.sunDay, 2.2);
    key.position.set(-40, 70, 30);
    this.scene.add(key, key.target);
    const fill = new DirectionalLight(PALETTE.skyDayBottom, 0.5);
    fill.position.set(30, 20, -40);
    this.scene.add(fill);
    this.scene.add(new HemisphereLight(PALETTE.ambientDay, PALETTE.grass, 1.1));

    this.scene.add(this.lane);
    this.buildGround();
    this.buildScenery();
    this.buildParkAhead();

    // --- the bus ------------------------------------------------------------
    this.bus = createCatBus();
    this.bus.setDoorOpen(0);
    // Nose-first down the lane. **No `rotation.y` here**: `place()` owns the
    // whole orientation, yaw and pitch together, by aiming the bus at the road
    // ahead of it. A separate yaw set once in a constructor is what let the
    // pitch be applied about the wrong axis and go unnoticed — see `place`.
    this.scene.add(this.bus.root);

    this.driver = createBusDriver();
    this.driver.setWalkPhase(0, 0);
    this.bus.driverSeat.add(this.driver.root);

    this.seatRiders(rider);
    // `place` first: `aimTheInsideCamera` converts the seated children's heads
    // out of world space through the bus's own matrix, so the bus has to be
    // somewhere before it can be asked where its passengers' faces are.
    this.place(0);
    this.bus.root.updateMatrixWorld(true);
    this.aimTheInsideCamera();
  }

  /**
   * Where the inside camera sits, **measured off the seats that were built**.
   *
   * Down the aisle at `x = 0` — which is also what keeps it clear of the driver,
   * who sits off-centre at `-seatX(0)` — just ahead of the front row and at a
   * seated child's head height, looking back down the bus. So what fills the
   * frame is rows of faces, which is what Jim asked to be able to look at.
   *
   * Asking `bus.seats` rather than restating `catBus.ts`'s seat plan matters
   * here more than usual: that plan has already been re-derived once, when a
   * child turned out to be 1.53 m across rather than the 0.6 m somebody had
   * imagined, and every number that had been copied out of it was wrong
   * afterwards.
   */
  private aimTheInsideCamera(): void {
    const seats = this.bus.seats;
    let front = -Infinity;
    let back = Infinity;
    let floor = 0;
    for (const seat of seats) {
      front = Math.max(front, seat.position.z);
      back = Math.min(back, seat.position.z);
      floor = seat.position.y;
    }
    // **Above the aisle**, and that is the whole of the problem.
    //
    // A child is 1.53 m across and the seats are at x = ±1.3, so the twelve of
    // them fill this bus almost solid: there is no head height anywhere in the
    // cabin from which anything can be seen, because whatever is put there is
    // inside somebody. The first attempt sat at a seated child's eye level a
    // couple of metres ahead of the front row — which is *past the driver's own
    // seat*, in the nose — and the ride's inside view was a flat brown wall
    // 1.32 m from the lens.
    //
    // The one genuinely clear volume is the gangway: `AISLE_WIDTH` is 0.8 m and
    // the heads start 0.53 m off the centre line, so `x = 0` is open the whole
    // length of the bus. Up near the ceiling, looking back and down it, the shot
    // is rows of faces either side — which is what Jim asked to be able to look
    // at, and it is the only place in this vehicle it can be had from.
    //
    // **At the children's own eye level**, measured off the heads that were
    // actually seated rather than computed from a height constant.
    //
    // Up near the ceiling was the first version that was *clear* of everything,
    // and the captured frame showed twelve children from above: hair, foreheads
    // and the tops of heads. Faces point forwards, so a camera looking down at
    // them sees no faces at all — and "the children riding it and looking
    // excited" is a shot of faces or it is nothing.
    //
    // Clamped under `CAT_BUS_CABIN_CEILING_Y` — the underside of the header
    // band, which is the cabin's real ceiling and 0.47 m below what the bus's
    // overall height suggests.
    let heads = 0;
    let headHeight = 0;
    for (const kid of this.riders) {
      kid.head.getWorldPosition(this.worldEye);
      this.bus.root.worldToLocal(this.worldEye);
      headHeight += this.worldEye.y;
      heads += 1;
    }
    const eyeHeight = Math.min(
      CAT_BUS_CABIN_CEILING_Y - INSIDE_CAMERA_HEADROOM,
      heads > 0 ? headHeight / heads : floor + KID_HEIGHT * 0.8,
    );
    // **Directly over the front row**, which is as far forward as anything can
    // go. Everything ahead of it is the cat's own face — a squashed sphere
    // 2.7 m across whose back reaches to within a centimetre of the front row's
    // heads — and the driver sits inside that same blob. Putting the lens
    // midway between the front row and the driver's seat therefore parked it
    // *inside the cat's head*, where the ray hit the inside of the face's
    // BackSide outline shell 0.15 m away and the frame was a solid cream wall.
    //
    // As far forward as the cabin's clear interior allows, which buys the shot
    // its only breathing room: the front row's heads are 0.53 m either side of
    // the lens whatever happens, and every centimetre forward pushes them
    // further towards the edge of the frame. `CAT_BUS_CABIN_FRONT_Z` is where
    // the cat's own face begins; the headroom below it is the same clearance
    // the ceiling gets, so the guard's *"nothing within 0.3 m of the lens"*
    // holds in this direction too.
    const eyeZ = Math.max(front, CAT_BUS_CABIN_FRONT_Z - INSIDE_CAMERA_HEADROOM);
    this.insideEye.set(0, eyeHeight, eyeZ);
    // Straight down the gangway, at the same height: level with their faces, so
    // what fills the frame is faces.
    this.insideAim.set(0, eyeHeight, back);
  }

  /** Seconds since the ride began — the clock everything else here reads. */
  get elapsed(): number {
    return this.elapsedSeconds;
  }

  /** Whether the ride is being watched from outside the bus or in it. */
  get view(): JourneyView {
    return this.viewMode;
  }

  setView(view: JourneyView): void {
    this.viewMode = view;
    const fov = view === 'inside' ? INSIDE_FOV : CAMERA_FOV;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Swaps inside for outside. What the button on screen does. */
  toggleView(): JourneyView {
    this.setView(this.viewMode === 'outside' ? 'inside' : 'outside');
    return this.viewMode;
  }

  /** True once the ride has run its course. */
  get finished(): boolean {
    return this.elapsedSeconds >= JOURNEY_SECONDS;
  }

  /**
   * Eleven passengers plus her, in the bus's own seats.
   *
   * Seated by asking the bus where its seats are, exactly as `ArrivalSequence`
   * does — `catBus.ts` is the only thing that knows where a seat is, and a
   * second copy of that arithmetic is a second thing to keep in step.
   *
   * Parented **into** the seat rather than posed at its world position every
   * frame. The park has to do the latter because a crowd member's rig root is
   * where `NpcSystem` writes a world coordinate; these are one-off models that
   * belong to nobody else, so they can simply ride along for free.
   */
  private seatRiders(player: JourneyRider): void {
    const rng = createRandom(20260807);
    // Hers is the seat nearest the door, so she is the one you see best — and
    // so it is the same seat the arrival will put her in on the other side of
    // the cut.
    const seats = this.bus.seats;
    const playerSeat = this.bus.passengerSeat;

    for (let index = 0; index < CAT_BUS_SEAT_COUNT; index += 1) {
      const seat = seats[index];
      if (!seat) continue;
      const isPlayer = seat === playerSeat;
      const look: JourneyRider = isPlayer ? player : rollLook(rng);
      const kid = createKid({
        skin: look.skin,
        hair: look.hair,
        outfit: look.outfit,
        hairStyle: look.hairStyle,
        backpack: false,
      });
      kid.setExpression('happy');
      // **Turned in towards the gangway**, which is where the excitement is.
      //
      // A kid's painted face points along its own +Z (measured, not assumed),
      // so twelve children all facing the bus's nose sit in two lines with
      // their faces pointing *past* anyone in the aisle: from the inside camera
      // they are a corridor of profiles and the backs of heads. Turned inboard
      // they are children talking to each other on a bus, which is both what
      // happens on a bus and the only arrangement that puts faces where they
      // can be seen.
      //
      // Kept to 0.6 rad rather than a full quarter turn because they are also
      // looked at side-on **through the side windows from outside**, which is
      // the thing the previous round's glazing work existed to make possible.
      // At this angle they read as three-quarter faces from both places.
      const inboard = -Math.sign(seat.position.x || 1) * 0.6;
      kid.root.rotation.y = inboard + rng() * 0.4 - 0.2;
      seat.add(kid.root);
      this.riders.push(kid);
    }
  }

  /**
   * The lane's ground, as one displaced plane.
   *
   * Vertices are displaced by {@link groundHeight}, which is the same function
   * the bus's own wheels and every tree read — one definition of "where the
   * ground is", so nothing here can ever float or sink.
   */
  private buildGround(): void {
    const segmentsZ = 220;
    const segmentsX = 40;
    const geometry = new PlaneGeometry(
      GROUND_HALF_WIDTH * 2,
      LANE_LENGTH,
      segmentsX,
      segmentsZ,
    );
    geometry.rotateX(-Math.PI / 2);
    // **Translated into world space before anything is displaced.** The first
    // version left the plane at the origin, displaced its vertices by
    // `groundHeight(x, localZ)`, and then moved the *mesh* 100 m down the lane
    // — so the hills ended up a hundred metres out of step with the road, the
    // hedges, the trees and the bus, every one of which reads the same function
    // in world coordinates. The result was a bus sailing along ten metres above
    // a flat green sheet with the road and the verges buried underneath it, and
    // it read on screen as "the camera is too high", which it was not.
    //
    // Baking the offset into the geometry means there is only ever one z here,
    // and it is the one everything else uses.
    geometry.translate(0, 0, LANE_AHEAD - LANE_LENGTH / 2);
    const position = geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < position.count; i += 1) {
      position.setY(i, groundHeight(position.getX(i), position.getZ(i)));
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();

    const ground = new Mesh(geometry, toonMaterial(PALETTE.grass));
    ground.name = 'journey-ground';
    ground.receiveShadow = true;
    this.lane.add(ground);

    // The carriageway, a narrow ribbon laid on the same hills a hand's breadth
    // up so it never z-fights the grass.
    //
    // **Segmented across as well as along**, at 8 rather than 2: the texture now
    // carries kerbs at fixed `u`, and two segments across a 5.7 m road put the
    // nearest UV sample 2.9 m from the kerb it is meant to draw.
    const roadGeometry = new PlaneGeometry(ROAD_HALF_WIDTH * 2, LANE_LENGTH, 8, segmentsZ);
    roadGeometry.rotateX(-Math.PI / 2);
    roadGeometry.translate(0, 0, LANE_AHEAD - LANE_LENGTH / 2);
    const roadPosition = roadGeometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < roadPosition.count; i += 1) {
      roadPosition.setY(i, laneHeight(roadPosition.getZ(i)) + 0.07);
    }
    roadPosition.needsUpdate = true;
    roadGeometry.computeVertexNormals();
    // Slabs, kerbs and a dashed centre line, in metres — the same road the park
    // lays at its own gate. Jim: *"the texture on the road is too plain"*; it was
    // one flat fill, so nothing moved past under the bus for twenty seconds.
    applyRoadUvs(roadGeometry, { across: 'x', along: 'z' });
    const road = new Mesh(roadGeometry, roadMaterial());
    road.name = 'journey-road';
    road.receiveShadow = true;
    this.lane.add(road);
  }

  /**
   * Trees and hedges either side, instanced.
   *
   * Two populations doing two different jobs, which is why there are two:
   * **hedge posts close to the road** give the speed something to be measured
   * against — a distant tree at 11 m/s barely moves — and **trees further out**
   * give the lane somewhere to be. Everything sits on {@link groundHeight}, so
   * the scenery rides the hills with the bus.
   */
  private buildScenery(): void {
    const rng = createRandom(19470116);
    const trunkGeometry = new CylinderGeometry(0.22, 0.34, 1, 6);
    const canopyGeometry = new IcosahedronGeometry(1, 1);

    const TREES = 460;
    const trunks = new InstancedMesh(trunkGeometry, toonMaterial(PALETTE.barkDark), TREES);
    const canopies = new InstancedMesh(canopyGeometry, toonMaterial(PALETTE.leafMid), TREES);
    trunks.name = 'journey-tree-trunks';
    canopies.name = 'journey-tree-canopies';
    const matrix = new Matrix4();
    const at = new Vector3();
    const scale = new Vector3();
    const spin = new Quaternion();

    for (let i = 0; i < TREES; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      // Clear of the tarmac, thinning outwards so the lane has a near edge and
      // a soft far one.
      const x = side * (ROAD_HALF_WIDTH + 2.6 + rng() * rng() * 62);
      const z = LANE_AHEAD - rng() * LANE_OPEN_RUN;
      const ground = groundHeight(x, z);
      const height = 3.4 + rng() * 4.2;
      const radius = 1.5 + rng() * 1.6;

      spin.setFromAxisAngle(new Vector3(0, 1, 0), rng() * Math.PI * 2);
      at.set(x, ground + height / 2, z);
      scale.set(1, height, 1);
      matrix.compose(at, spin, scale);
      trunks.setMatrixAt(i, matrix);

      at.set(x, ground + height + radius * 0.3, z);
      scale.set(radius, radius * (0.85 + rng() * 0.3), radius);
      matrix.compose(at, spin, scale);
      canopies.setMatrixAt(i, matrix);
    }
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    trunks.castShadow = true;
    canopies.castShadow = true;
    this.lane.add(trunks, canopies);

    // The hedge: little rounded blobs marching along both verges, close enough
    // to the camera to sell the speed.
    const HEDGE = 520;
    const hedge = new InstancedMesh(
      new SphereGeometry(1, 8, 6),
      toonMaterial(PALETTE.leafDeep),
      HEDGE,
    );
    hedge.name = 'journey-hedge';
    for (let i = 0; i < HEDGE; i += 1) {
      const side = i % 2 === 0 ? 1 : -1;
      const along = (i / HEDGE) * LANE_OPEN_RUN;
      const z = LANE_AHEAD - along;
      const x = side * (ROAD_HALF_WIDTH + 0.9 + rng() * 0.5);
      const radius = 0.75 + rng() * 0.45;
      at.set(x, groundHeight(x, z) + radius * 0.55, z);
      scale.set(radius * 1.35, radius, radius * 1.35);
      spin.setFromAxisAngle(new Vector3(0, 1, 0), rng() * Math.PI);
      matrix.compose(at, spin, scale);
      hedge.setMatrixAt(i, matrix);
    }
    hedge.instanceMatrix.needsUpdate = true;
    hedge.castShadow = true;
    this.lane.add(hedge);
  }

  /**
   * **The park, at the end of the lane.**
   *
   * Jim, 7 August 2026: *"it doesn't actually drive up to the park, the road
   * needs to actually go to the park."*
   *
   * The road went nowhere. The lane ran on past the horizon, the ride simply
   * stopped after twenty seconds, and the cut put a child beside a gate she had
   * never seen coming. Nothing on screen ever said where the bus was going, so
   * "driving to the park" was a caption rather than a thing you watched happen.
   *
   * Now the park is **built at the far end of the road**: its boundary wall
   * across the view, its gate arch dead ahead with the carriageway running
   * through it, and its trees and rooftops standing over the wall behind. It
   * begins the ride buried in {@link Scene.fog} — 250 m out against a fog that
   * ends at 235 — and emerges over the last third, so the arrival is something
   * that grows in the windscreen rather than something that is announced.
   *
   * ## It is the park's own gate, not a lookalike
   *
   * The posts, the caps and the crossbar are built to `Entrance.ts`'s own
   * dimensions and out of the same `stonePink` family, and the road through it
   * is `road.ts`'s road at `road.ts`'s width. That matters at exactly one
   * moment — the cut — where a child is looking at a gate and a road and
   * nothing else, and any disagreement between the two scenes is a jump.
   *
   * The bus stops {@link PARK_STANDOFF} short of the arch, which is what makes
   * it an arrival rather than a collision.
   */
  private buildParkAhead(): void {
    const gateZ = PARK_AHEAD_Z;
    const stone = toonMaterial(PALETTE.stonePink);
    const capStone = toonMaterial(PALETTE.stonePinkLight);

    // --- the boundary wall, either side of the opening -----------------------
    // Blocks laid along the ground it stands on, so the wall rides the same
    // hills as everything else rather than hovering over them.
    const BLOCK = 2.2;
    const WALL_HEIGHT = 2.6;
    const blockGeometry = new BoxGeometry(BLOCK * 0.96, WALL_HEIGHT, 1.1);
    const perSide = 26;
    const wall = new InstancedMesh(blockGeometry, stone, perSide * 2);
    wall.name = 'journey-park-wall';
    const matrix = new Matrix4();
    const at = new Vector3();
    const spin = new Quaternion();
    const one = new Vector3(1, 1, 1);
    let laid = 0;
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < perSide; i += 1) {
        // Starts clear of the gate opening and marches outward.
        const x = side * (GATE_HALF_WIDTH + 1.2 + i * BLOCK);
        at.set(x, groundHeight(x, gateZ) + WALL_HEIGHT / 2 - 0.3, gateZ);
        matrix.compose(at, spin, one);
        wall.setMatrixAt(laid, matrix);
        laid += 1;
      }
    }
    wall.instanceMatrix.needsUpdate = true;
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.lane.add(wall);

    // --- the gate arch -------------------------------------------------------
    // `Entrance.ts`'s own posts, caps and crossbar. Same shape, same stone: this
    // is the gate she is about to walk through, seen from outside.
    const gateGround = groundHeight(0, gateZ);
    const gate = new Group();
    gate.name = 'journey-park-gate';
    for (const side of [-1, 1] as const) {
      const post = new Mesh(new CylinderGeometry(0.42, 0.5, GATE_POST_HEIGHT, 12), stone);
      post.position.set(side * GATE_HALF_WIDTH, gateGround + GATE_POST_HEIGHT / 2, gateZ);
      post.castShadow = true;
      gate.add(post);

      const cap = new Mesh(new SphereGeometry(0.62, 14, 10), capStone);
      cap.position.set(side * GATE_HALF_WIDTH, gateGround + GATE_POST_HEIGHT + 0.15, gateZ);
      cap.scale.set(1, 0.75, 1);
      gate.add(cap);
    }
    const crossbar = new Mesh(new TorusGeometry(GATE_HALF_WIDTH, 0.28, 10, 24, Math.PI), capStone);
    crossbar.position.set(0, gateGround + GATE_POST_HEIGHT + 0.15, gateZ);
    crossbar.rotation.z = Math.PI;
    crossbar.castShadow = true;
    gate.add(crossbar);
    this.lane.add(gate);

    // --- what stands over the wall -------------------------------------------
    // Trees and bright pastel rooftops behind the stone, so what is on the other
    // side reads as somewhere worth arriving at rather than a walled field. Kept
    // to silhouettes: at this distance that is all anybody can see anyway, and a
    // second park modelled in detail is a second park to keep in step.
    const rng = createRandom(20260808);
    const PARK_THINGS = 54;
    const roofGeometry = new ConeGeometry(1, 1, 7);
    const roofs = new InstancedMesh(roofGeometry, toonMaterial(PALETTE.markerPink), PARK_THINGS);
    roofs.name = 'journey-park-rooftops';
    const canopyGeometry = new IcosahedronGeometry(1, 1);
    const canopies = new InstancedMesh(canopyGeometry, toonMaterial(PALETTE.leafMid), PARK_THINGS);
    canopies.name = 'journey-park-trees';
    const scale = new Vector3();
    for (let i = 0; i < PARK_THINGS; i += 1) {
      const x = (rng() - 0.5) * 120;
      const z = gateZ - 6 - rng() * 55;
      const ground = groundHeight(x, z);

      const roofHeight = 5 + rng() * 7;
      spin.setFromAxisAngle(new Vector3(0, 1, 0), rng() * Math.PI * 2);
      at.set(x, ground + roofHeight / 2, z);
      scale.set(2.4 + rng() * 2.2, roofHeight, 2.4 + rng() * 2.2);
      matrix.compose(at, spin, scale);
      roofs.setMatrixAt(i, matrix);

      const treeX = (rng() - 0.5) * 130;
      const treeZ = gateZ - 4 - rng() * 60;
      const radius = 2.6 + rng() * 2.4;
      at.set(treeX, groundHeight(treeX, treeZ) + radius * 1.5, treeZ);
      scale.set(radius, radius * 1.15, radius);
      matrix.compose(at, spin, scale);
      canopies.setMatrixAt(i, matrix);
    }
    roofs.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    roofs.castShadow = true;
    canopies.castShadow = true;
    this.lane.add(roofs, canopies);
  }

  /**
   * Puts the bus at a point down the lane, on the hills, **lying along the
   * slope it is standing on**.
   *
   * ## Why this is a `lookAt` and not an angle
   *
   * It was an angle, and the angle was backwards. `rotation.x` was set to
   * `atan2(behind − ahead, 14)`, which — once the constructor's separate
   * `rotation.y = π` had turned the bus to face −Z — pitched its nose **down**
   * every time the road went up. Measured over a whole ride, the bus disagreed
   * with the ground on **every one of 1200 frames**: at t = 10 s the lane climbs
   * at +0.12 m per metre and the bus's nose pointed 0.11 *below* the horizontal.
   * Jim, 7 August 2026: *"the bus doesn't tilt up when going over a hill"* — it
   * tilted the other way, which reads as not tilting at all right up until it
   * reads as wrong.
   *
   * A sign is exactly the kind of thing that is invisible in review and obvious
   * on screen, so there is no longer a sign here to get wrong. The bus is simply
   * pointed at the piece of road under its own nose: `Object3D.lookAt` aims
   * local **+Z** — the bus's own length, the way `catBus.ts` builds it — at a
   * target, so yaw and pitch both fall out of where the road *is*. There is
   * nothing left to invert.
   *
   * The nose and tail points are {@link BUS_PITCH_SPAN} apart rather than
   * sampled at a point, so the bus lies along the hill the way a long vehicle
   * does instead of pivoting on its middle.
   *
   * {@link laneHeight} is the one owner: the ground mesh, the road ribbon, every
   * tree, every hedge and this all read it, so the bus cannot drift from the
   * road it is driving on.
   */
  private place(z: number): void {
    const half = BUS_PITCH_SPAN / 2;
    // The bus drives towards −Z, so its nose rests at the smaller z.
    const rise = laneHeight(z - half) - laneHeight(z + half);
    this.bus.root.position.set(0, laneHeight(z), z);
    // Aim the bus's length along the chord from where its tail rests to where
    // its nose rests. Uphill means `rise > 0` means the target is above the bus
    // means the nose comes up — which is a statement about the road, not about
    // a rotation convention.
    this.bus.root.lookAt(0, laneHeight(z) + rise, z - BUS_PITCH_SPAN);
  }

  /**
   * Where the camera goes this frame.
   *
   * Exported shape rather than an inline lump because {@link cameraPoseAt} is
   * pure: a check can ask where the camera will be at t = 19.9 s without
   * building a bus, which is the only way to assert that the ride ends on the
   * park's own bearing.
   */
  /**
   * One frame of the ride.
   *
   * `travelling` is false while the bus idles at the kerb — the ride has run its
   * course and the park has not finished generating (`JourneyDirector`). The
   * road stops moving; **the children do not**, because a bus of frozen
   * passengers is what a stopped clock actually looks like on screen.
   */
  update(dt: number, travelling = true): void {
    if (dt <= 0) return;
    this.animationSeconds += dt;
    if (travelling) {
      this.elapsedSeconds = Math.min(JOURNEY_SECONDS, this.elapsedSeconds + dt);
    }
    this.busZ = -this.elapsedSeconds * BUS_SPEED;
    this.place(this.busZ);
    this.bus.animate(dt, this.animationSeconds, travelling ? BUS_SPEED : 0);
    this.exciteRiders(this.animationSeconds);

    if (this.viewMode === 'inside') {
      // Through the bus's own matrix, so the camera climbs, dips and pitches
      // with it exactly — you feel the hills from inside, which is half of why
      // being able to sit in there is worth having.
      this.bus.root.updateMatrixWorld(true);
      this.worldEye.copy(this.insideEye).applyMatrix4(this.bus.root.matrixWorld);
      this.worldAim.copy(this.insideAim).applyMatrix4(this.bus.root.matrixWorld);
      this.camera.position.copy(this.worldEye);
      this.camera.lookAt(this.worldAim);
      return;
    }

    const pose = cameraPoseAt(this.elapsedSeconds);
    const height = laneHeight(this.busZ);
    this.camera.position.set(
      Math.sin(pose.yaw) * pose.horizontal,
      height + pose.lift,
      this.busZ + Math.cos(pose.yaw) * pose.horizontal,
    );
    this.camera.lookAt(0, height + 2.2, this.busZ);
  }

  /**
   * **The children, riding and looking excited.**
   *
   * Jim asked for the inside view to show *"the children riding it and looking
   * excited"*, and a `setExpression('happy')` on a body that never moves is a
   * photograph of a smile rather than excitement. So they bounce in their seats,
   * throw their arms up, and look about at the countryside going past — each on
   * their own phase, so twelve children are not one child twelve times.
   *
   * Driven every frame **whatever the view is**, not only from inside. They are
   * visible through the glazing from outside too — that glazing was the whole
   * point of the previous round — and a bus full of children who freeze the
   * moment you step out of it is a worse bug than one full of still children.
   */
  private exciteRiders(elapsed: number): void {
    for (let i = 0; i < this.riders.length; i += 1) {
      const kid = this.riders[i];
      if (!kid) continue;
      const phase = i * 1.31;
      // Bouncing on the seat. `body` is the rig's own bob target.
      kid.body.position.y = Math.abs(Math.sin(elapsed * 3.2 + phase)) * 0.13;
      // Looking out at what is going past, and up at each other.
      // Glancing about, not turning away: at ±0.55 rad most of the bus had its
      // face pointed somewhere other than forward, and the inside view is a
      // shot of faces or it is nothing.
      kid.head.rotation.y = Math.sin(elapsed * 0.9 + phase) * 0.26;
      kid.head.rotation.z = Math.sin(elapsed * 1.7 + phase) * 0.09;
      if (kid.limbs) {
        // Arms up: negative `rotation.x` raises an arm, as the ferris wheel's
        // excited riders do it.
        const lift = -1.35 + Math.sin(elapsed * 6.5 + phase) * 0.32;
        kid.limbs.leftArm.rotation.x = lift;
        kid.limbs.rightArm.rotation.x = lift + Math.sin(elapsed * 7.4 + phase) * 0.3;
        kid.limbs.leftArm.rotation.z = 0.34;
        kid.limbs.rightArm.rotation.z = -0.34;
      }
    }
  }

  render(renderer: WebGLRenderer, width: number, height: number): void {
    if (this.camera.aspect !== width / Math.max(1, height)) {
      this.camera.aspect = width / Math.max(1, height);
      this.camera.updateProjectionMatrix();
    }
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.driver.dispose();
    for (const rider of this.riders) rider.root.removeFromParent();
    this.riders.length = 0;
    this.bus.dispose();
    this.scene.clear();
  }
}

/**
 * Where the camera is, as a bearing and a distance from the bus, at time `t`.
 *
 * Pure and exported so a check can measure the shot without a renderer — in
 * particular that the ride **ends on the park's own camera bearing**, which is
 * what makes the hand-over a cut rather than a jump, and which is exactly the
 * kind of claim that is easy to write in a comment and never verify.
 */
export function cameraPoseAt(t: number): {
  readonly yaw: number;
  readonly horizontal: number;
  readonly lift: number;
} {
  const settleStart = JOURNEY_SECONDS - ORBIT.settleSeconds;
  const spun = ORBIT.startYawDegrees * DEG + (t / JOURNEY_SECONDS) * ORBIT.turns * Math.PI * 2;
  const parkYaw = CAMERA_YAW_DEGREES * DEG;

  // Ease onto the park's bearing over the last few seconds, taking the shortest
  // way round from wherever the orbit has got to, so the settle never spins
  // back on itself.
  let yaw = spun;
  if (t > settleStart) {
    const settle = smoothstep(0, 1, clamp01((t - settleStart) / ORBIT.settleSeconds));
    const target = parkYaw + Math.round((spun - parkYaw) / (Math.PI * 2)) * Math.PI * 2;
    yaw = lerp(spun, target, settle);
  }

  // The park's camera is a fixed elevation; the ride's drifts a little so the
  // shot breathes, and lands on the park's own by the end.
  const parkPitch = CAMERA_PITCH_DEGREES * DEG;
  const settle = t > settleStart ? smoothstep(0, 1, clamp01((t - settleStart) / ORBIT.settleSeconds)) : 0;
  const drift = Math.sin(t * 0.42) * 0.09;
  const pitch = lerp(parkPitch + drift, parkPitch, settle);
  const distance = lerp(CAMERA_BACK + Math.sin(t * 0.31) * 3.5, CAMERA_BACK, settle);

  return {
    yaw,
    horizontal: Math.cos(pitch) * distance,
    lift: lerp(Math.sin(pitch) * distance, CAMERA_LIFT, settle * 0.25),
  };
}
