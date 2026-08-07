import {
  BufferAttribute,
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
  Vector3,
  type WebGLRenderer,
} from 'three';
import { PALETTE } from '../../core/palette';
import { CAMERA_PITCH_DEGREES, CAMERA_YAW_DEGREES } from '../../core/constants';
import { createRandom, clamp01, lerp, smoothstep } from '../../core/mathUtils';
import { toonMaterial } from '../../art/style/materials';
import { createKid, KID_SKIN_TONES, type KidHandle } from '../../art/models/kid';
import { CROWD_HAIR_STYLES, type HairStyle } from '../../art/models/hair';
import { HAIR_COLOURS, OUTFIT_COLOURS } from '../../art/models/kidLooks';
import { createCatBus, CAT_BUS_SEAT_COUNT, CAT_BUS_WIDTH, type CatBusHandle } from './catBus';
import { createBusDriver, type BusDriver } from './busDriver';

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

/**
 * Half-width of the road — **derived from the bus, so "narrow" stays true.**
 *
 * *"A narrow lane"* is a relationship, not a number: the lane is narrow when
 * the bus nearly fills it. A hand-picked 5.2 gave a carriageway 1.6 times the
 * bus's width, which on screen read as a wide sandy road with a bus somewhere
 * on it. A verge of about half a bus-width in total is a lane a bus only just
 * belongs on, and it moves on its own if the bus is ever resized again.
 */
const ROAD_HALF_WIDTH = CAT_BUS_WIDTH / 2 + 1.25;

/** Half-width of the grass verge the ground mesh covers either side. */
const GROUND_HALF_WIDTH = 90;

/**
 * How much lane exists *behind* the bus's starting point.
 *
 * The camera orbits, so for a third of every turn it is looking back down the
 * road the bus came in on. Without this there is nothing there.
 */
const LANE_AHEAD = 120;

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
    Math.sin(z * 0.0755) * 3.1 +
    Math.sin(z * 0.0412 + 1.7) * 4.4 +
    Math.sin(z * 0.0169 + 0.4) * 3.2
  );
}

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

export class BusJourney {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private readonly bus: CatBusHandle;
  private readonly driver: BusDriver;
  private readonly riders: KidHandle[] = [];
  private readonly lane = new Group();

  private elapsedSeconds = 0;
  private busZ = 0;

  constructor(rider: JourneyRider) {
    this.scene.name = 'cat-bus-journey';
    // The same linear fog the park uses, pulled in tight: the lane has to end
    // somewhere, and it should end in haze rather than in a visible edge.
    this.scene.fog = new Fog(PALETTE.skyDayBottom, 60, 235);

    this.camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.5, 900);

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

    // --- the bus ------------------------------------------------------------
    this.bus = createCatBus();
    this.bus.setDoorOpen(0);
    // Nose-first down the lane. The bus's own local +Z is its length; the park
    // sends it along the kerb with `rotation.y`, and here it simply drives the
    // way it points.
    this.bus.root.rotation.y = Math.PI;
    this.scene.add(this.bus.root);

    this.driver = createBusDriver();
    this.driver.setWalkPhase(0, 0);
    this.bus.driverSeat.add(this.driver.root);

    this.seatRiders(rider);
    this.place(0);
  }

  /** Seconds since the ride began — the clock everything else here reads. */
  get elapsed(): number {
    return this.elapsedSeconds;
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
      // Facing forward down the bus, as a passenger does, with a little
      // variation so twelve children are not one child twelve times.
      kid.root.rotation.y = rng() * 0.5 - 0.25;
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

    // The tarmac, a narrow ribbon laid on the same hills a hand's breadth up so
    // it never z-fights the grass.
    const roadGeometry = new PlaneGeometry(ROAD_HALF_WIDTH * 2, LANE_LENGTH, 2, segmentsZ);
    roadGeometry.rotateX(-Math.PI / 2);
    roadGeometry.translate(0, 0, LANE_AHEAD - LANE_LENGTH / 2);
    const roadPosition = roadGeometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < roadPosition.count; i += 1) {
      roadPosition.setY(i, laneHeight(roadPosition.getZ(i)) + 0.07);
    }
    roadPosition.needsUpdate = true;
    roadGeometry.computeVertexNormals();
    const road = new Mesh(roadGeometry, toonMaterial(PALETTE.pathSand));
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
      const z = LANE_AHEAD - rng() * LANE_LENGTH;
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
      const along = (i / HEDGE) * LANE_LENGTH;
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
   * Puts the bus at a point down the lane, on the hills, pitched to the slope.
   *
   * The pitch is taken from the ground a bus-length ahead and behind rather
   * than from the slope at a point, so the bus lies along the hill the way a
   * long vehicle does instead of pivoting on its middle.
   */
  private place(z: number): void {
    const ahead = laneHeight(z - 7);
    const behind = laneHeight(z + 7);
    this.bus.root.position.set(0, laneHeight(z), z);
    this.bus.root.rotation.x = Math.atan2(behind - ahead, 14);
  }

  /**
   * Where the camera goes this frame.
   *
   * Exported shape rather than an inline lump because {@link cameraPoseAt} is
   * pure: a check can ask where the camera will be at t = 19.9 s without
   * building a bus, which is the only way to assert that the ride ends on the
   * park's own bearing.
   */
  update(dt: number): void {
    if (dt <= 0) return;
    this.elapsedSeconds = Math.min(JOURNEY_SECONDS, this.elapsedSeconds + dt);
    this.busZ = -this.elapsedSeconds * BUS_SPEED;
    this.place(this.busZ);
    this.bus.animate(dt, this.elapsedSeconds, BUS_SPEED);

    const pose = cameraPoseAt(this.elapsedSeconds);
    const height = laneHeight(this.busZ);
    this.camera.position.set(
      Math.sin(pose.yaw) * pose.horizontal,
      height + pose.lift,
      this.busZ + Math.cos(pose.yaw) * pose.horizontal,
    );
    this.camera.lookAt(0, height + 2.2, this.busZ);
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
