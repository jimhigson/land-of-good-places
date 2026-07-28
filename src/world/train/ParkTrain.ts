import { Group, PointLight, Vector3 } from 'three';
import { clamp01 } from '../../core/mathUtils';
import { PALETTE } from '../../core/palette';
import type { FrameContext, GameSystem } from '../../core/types';
import type { Player } from '../../entities/Player';
import type { NpcCharacter } from '../../entities/npc/NpcCharacter';
import type { CollisionWorld } from '../Collision';
import type { InteractZone } from '../interact';
import type { MovingPlatform } from '../building/surfaces';
import { TrainRoute } from './route';
import { buildTrack, type Track } from './track';
import { Station } from './station';
import { computeCrossings, type LevelCrossing } from './crossings';
import { buildRailFence } from './fence';
import { SmokePuffs } from './puffs';
import {
  createCarriage,
  createLocomotive,
  CARRIAGE_COLOURS,
  CARRIAGE_LENGTH,
  CAR_FLOOR_Y,
  CAR_GAP,
  LOCO_LENGTH,
  SEAT_Y,
  type Locomotive,
  type TrainCar,
} from './trainModel';
import { playChuff, playStationBell, playTrainWhistle, setTrainAudioCarry } from './trainSounds';
import { setTrainService, type TrainPassenger, type TrainService, type TrainStop } from './service';

/**
 * The park train.
 *
 * A little engine and three open carriages going round and round the edge of
 * the park all day, calling at two stations. You get on by standing on a
 * platform when it is in; you get off by asking to move while it is stopped.
 * Children get on too.
 *
 * ### Riding is a seat-lock, not a moving floor
 *
 * The game *does* support moving platforms — `WalkSurfaces` asks every
 * registered platform where its surface is, every frame, which is how the lift
 * and the bubble carry you (ARCHITECTURE.md). The carriages register as
 * platforms too, so standing on a stopped train is solid ground and nobody
 * falls through the floor.
 *
 * But a platform only carries you *vertically*. There is no horizontal carry in
 * this engine — `Player.nudge` exists for the escalators and shoves you a fixed
 * direction — and a train doing 4 m/s round a 3-metre-radius bend would slide a
 * standing child off the back on every corner. So boarding hands the character
 * to the ride the same way the slide does: `beginRide`, a `setRidePose` every
 * frame, `endRide` when you get off. Input, collision and gravity all stop
 * applying, the camera follows as normal, and the ride cannot drop you.
 *
 * The children are carried the other way round, because a driver has no
 * business owning a position: `ParkTrain` writes a rider's x and z before
 * `NpcSystem` runs, and the carriage-as-moving-platform supplies the y. Their
 * own movement code then runs as usual and finds it has nothing to do.
 */

/** Metres per second on the open stretches. About a brisk walking pace. */
const CRUISE_SPEED = 4.0;

const ACCELERATION = 1.7;
const BRAKING = 2.4;

/** Seconds spent at each station with the doors open. */
const DWELL_SECONDS = 8;

/** Carriages, and therefore seats: two on each. */
const CARRIAGE_COUNT = 3;

/** Seat 0 is always kept for the player; children take the rest. */
const PLAYER_SEAT = 0;
const MAX_NPC_RIDERS = 4;

/** How long after boarding before a movement key means "let me off". */
const BOARDING_GRACE = 1.2;

/** Metres of travel between chuffs. */
const CHUFF_INTERVAL = 1.5;

/** Beyond this the train cannot be heard at all. */
const AUDIBLE_RANGE = 42;

interface Seat {
  /** Which car, and which of its seats. */
  readonly car: number;
  readonly index: number;
  taken: 'player' | 'npc' | null;
}

export class ParkTrain implements GameSystem, TrainService {
  readonly name = 'parkTrain';
  readonly group = new Group();

  readonly route: TrainRoute;
  readonly stations: Station[] = [];
  readonly stops: TrainStop[] = [];
  /** The level crossings — exported so `check:park` knows where feet may cross. */
  readonly crossings: readonly LevelCrossing[] = [];

  /** 0 by day, 1 at night. Set by `World`, like the fountain's. */
  nightFactor = 0;

  private readonly track: Track;
  private readonly locomotive: Locomotive;
  private readonly carriages: TrainCar[] = [];
  private readonly cars: TrainCar[] = [];
  private readonly puffs = new SmokePuffs();
  private readonly headlight: PointLight;

  private readonly seats: Seat[] = [];

  /** Distance of the *locomotive's centre* along the route. */
  private distance = 0;
  private speed = 0;
  private dwellRemaining = 0;
  private stoppedStop: number | null = null;
  private nextStop = 0;

  private chuffCarry = 0;
  private wheelSpin = 0;

  private playerRiding = false;
  private playerBoardedAt = 0;
  /** Set on alighting; cleared when the train pulls out, so you get a moment. */
  private boardingLocked = false;

  /** How far behind the locomotive's centre each car rides. */
  private readonly carOffsets: number[] = [];

  private readonly stopOffset: number;
  private player: Player | null = null;
  private readonly point = new Vector3();
  private readonly tangent = new Vector3();
  private readonly seatWorld = new Vector3();

  constructor(collision: CollisionWorld) {
    this.group.name = 'park-train';

    this.route = new TrainRoute(collision);
    this.track = buildTrack(this.route);
    this.group.add(this.track.group);

    // Level crossings first (they come out of the solved curve and the drawn
    // paths), then the fence, which leaves a gap at every one of them and at
    // both stations. Order matters: the stations below choose their spot with
    // `clearStationDistance`, so the fence is built after them — see the end
    // of this constructor.
    this.crossings = computeCrossings(this.route);

    // --- the train itself ----------------------------------------------------
    this.locomotive = createLocomotive();
    this.cars.push(this.locomotive);
    this.group.add(this.locomotive.root);

    for (let i = 0; i < CARRIAGE_COUNT; i += 1) {
      const carriage = createCarriage(
        CARRIAGE_COLOURS[i % CARRIAGE_COLOURS.length] ?? PALETTE.markerLemon,
        i,
      );
      this.carriages.push(carriage);
      this.cars.push(carriage);
      this.group.add(carriage.root);

      for (let seat = 0; seat < carriage.seats.length; seat += 1) {
        this.seats.push({ car: i, index: seat, taken: null });
      }
    }

    this.headlight = new PointLight(PALETTE.fairyWarm, 0, 16, 1.7);
    this.headlight.name = 'train-headlight';
    this.locomotive.root.add(this.headlight);
    this.headlight.position.set(0, CAR_FLOOR_Y + 0.35, LOCO_LENGTH / 2 + 0.3);

    this.group.add(this.puffs.group);

    // The train pulls up with its *carriages* alongside the platform, not its
    // engine — the whole point of standing on a platform is that a door arrives
    // in front of you.
    const carriageBlock = CARRIAGE_COUNT * CARRIAGE_LENGTH + (CARRIAGE_COUNT - 1) * CAR_GAP;
    this.stopOffset = LOCO_LENGTH / 2 + CAR_GAP + carriageBlock / 2;

    this.carOffsets.push(0);
    for (let i = 0; i < CARRIAGE_COUNT; i += 1) {
      this.carOffsets.push(
        LOCO_LENGTH / 2 + CAR_GAP + CARRIAGE_LENGTH / 2 + i * (CARRIAGE_LENGTH + CAR_GAP),
      );
    }

    // --- the stations --------------------------------------------------------
    // At the two bearings where the solved route comes closest to the park: due
    // east and due west, which are opposite ends of the loop and both on a
    // near-circular stretch, so a straight platform sits flush to the rails.
    const stationSeeds = [
      {
        name: 'Sunny Side',
        subtitle: 'all aboard for the whole park!',
        glyph: '🚂',
        accent: PALETTE.markerLemon,
        bearingX: 1,
        bearingZ: 0,
      },
      {
        name: 'Bluebell Halt',
        subtitle: 'mind the gap, and the bunnies',
        glyph: '🚉',
        accent: PALETTE.markerSky,
        bearingX: -1,
        bearingZ: 0,
      },
    ] as const;

    stationSeeds.forEach((seed, index) => {
      // The bearing gives the *neighbourhood*; the exact spot slides along
      // the loop until the platform's ground is genuinely clear. The park is
      // generated now (Decision 5), so "due east happens to be open lawn" is
      // no longer something anyone guarantees — trees are seeded before the
      // train, and a platform standing in one is exactly what check:park
      // caught the first time the layout rolled.
      const target = this.route.distanceNear(seed.bearingX * 60, seed.bearingZ * 60);
      const distance = this.clearStationDistance(target, collision);
      const station = new Station(
        {
          index,
          name: seed.name,
          subtitle: seed.subtitle,
          glyph: seed.glyph,
          accent: seed.accent,
          distance,
        },
        this.route,
        collision,
      );
      this.stations.push(station);
      this.group.add(station.group);
      this.stops.push({ index, name: seed.name, x: station.standX, z: station.standZ });
    });

    // --- the fence (Decision 4 §6: keeping feet off the track) -------------
    // Built last of all the trackside furniture, because its gaps are defined
    // by everything above: a gap at every level crossing, and a gap along
    // every platform so children can board.
    this.group.add(
      buildRailFence(this.route, collision, this.crossings, this.stations.map((station) => ({
        distance: station.distance,
      }))),
    );

    // Start standing at the first station, so the first thing a child sees is a
    // train waiting for them rather than one disappearing round a corner.
    const first = this.stations[0];
    this.distance = this.route.wrap((first?.distance ?? 0) + this.stopOffset);
    this.dwellRemaining = DWELL_SECONDS;
    this.stoppedStop = 0;
    this.nextStop = 1 % this.stations.length;

    this.placeCars();
    setTrainService(this);
  }

  /** Platforms and carriage floors, for `WalkSurfaces.addPlatform`. */
  /**
   * Slides along the loop from `target` (0, +1, -1, +2 ... metres) until the
   * platform area is clear of everything registered so far, checked as three
   * discs across the platform's length. Gives up at +-24 m and returns the
   * target — the boot assert and check:park will then say so loudly rather
   * than a child finding a platform inside a tree.
   */
  private clearStationDistance(target: number, collision: CollisionWorld): number {
    const centre = new Vector3();
    const tangent = new Vector3();
    for (let step = 0; step <= 48; step += 1) {
      const offset = (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2);
      const distance = target + offset;
      this.route.pointAt(distance, centre);
      this.route.tangentAt(distance, tangent);
      const rightX = tangent.z;
      const rightZ = -tangent.x;
      const parkIsRight = rightX * -centre.x + rightZ * -centre.z >= 0;
      const side = parkIsRight ? 1 : -1;
      const standX = centre.x + rightX * side * 2.15;
      const standZ = centre.z + rightZ * side * 2.15;
      let clear = true;
      for (const along of [-2.6, 0, 2.6]) {
        const px = standX + tangent.x * along;
        const pz = standZ + tangent.z * along;
        if (!collision.isClearCircle(px, pz, 1.7)) {
          clear = false;
          break;
        }
      }
      if (clear) return distance;
    }
    return target;
  }

  platforms(): MovingPlatform[] {
    const platforms: MovingPlatform[] = this.stations.map((station) => station.asPlatform());
    for (const carriage of this.carriages) platforms.push(carriageFloor(carriage));
    return platforms;
  }

  interactZones(): InteractZone[] {
    return this.stations.map((station) => station.interactZone());
  }

  // --------------------------------------------------------------- the frame

  update(context: FrameContext): void {
    const { dt } = context;
    if (dt <= 0) return;

    this.drive(dt);
    this.placeCars();
    this.updateRider(context);
    this.updateEffects(context);
  }

  /**
   * Carries the children who are aboard.
   *
   * Called from `World` **before** `NpcSystem.update`, which is the whole trick:
   * a rider's x and z are set here, their own movement code then runs and finds
   * it has nowhere to go, and the carriage floor — registered as a moving
   * platform — answers when it asks how high the ground is.
   */
  carryPassengers(characters: readonly NpcCharacter[]): void {
    for (const character of characters) {
      const seatNumber = (character.driver as Partial<TrainPassenger>).trainSeat;
      if (seatNumber === null || seatNumber === undefined) continue;
      const seat = this.seats[seatNumber];
      if (!seat || seat.taken !== 'npc') continue;

      // Children stand in front of the bench rather than sitting on it: they
      // are posed by their own walk cycle, and a standing child holding on
      // reads better than a walking one sitting down.
      this.seatPosition(seat, 0, character.position.y);
      character.position.x = this.seatWorld.x;
      character.position.z = this.seatWorld.z;
      character.syncTransform();
    }
  }

  dispose(): void {
    setTrainService(null);
    this.track.dispose();
    this.puffs.dispose();
  }

  // ------------------------------------------------------------ TrainService

  nearestStop(x: number, z: number): TrainStop | null {
    let best: TrainStop | null = null;
    let bestDistance = Infinity;
    for (const stop of this.stops) {
      const distance = (stop.x - x) ** 2 + (stop.z - z) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = stop;
      }
    }
    return best;
  }

  claimSeat(stop: number): number | null {
    if (this.stoppedStop !== stop) return null;

    let riders = 0;
    for (const seat of this.seats) if (seat.taken === 'npc') riders += 1;
    if (riders >= MAX_NPC_RIDERS) return null;

    for (let i = 0; i < this.seats.length; i += 1) {
      if (i === PLAYER_SEAT) continue;
      const seat = this.seats[i];
      if (seat && seat.taken === null) {
        seat.taken = 'npc';
        return i;
      }
    }
    return null;
  }

  seatValid(seat: number): boolean {
    return this.seats[seat]?.taken === 'npc';
  }

  stoppedAt(): number | null {
    return this.stoppedStop;
  }

  leaveSeat(seat: number): void {
    const entry = this.seats[seat];
    if (entry && entry.taken === 'npc') entry.taken = null;
  }

  // ---------------------------------------------------------------- internals

  /** Speed, braking and the wait at each station. */
  private drive(dt: number): void {
    if (this.dwellRemaining > 0) {
      this.dwellRemaining -= dt;
      if (this.dwellRemaining > 0) return;

      // Off we go.
      this.stoppedStop = null;
      this.boardingLocked = false;
      playTrainWhistle();
      return;
    }

    const target = this.stations[this.nextStop];
    if (!target) return;

    const stopDistance = this.route.wrap(target.distance + this.stopOffset);
    const remaining = this.route.forwardGap(this.distance, stopDistance);

    // v² = 2·a·s, solved for the speed a stop is still reachable from. Below a
    // metre out, creep in rather than crawling asymptotically towards it.
    const approach = Math.sqrt(2 * BRAKING * Math.max(0, remaining));
    const cruising = Math.min(CRUISE_SPEED, this.speed + ACCELERATION * dt);
    this.speed = Math.max(0.35, Math.min(cruising, approach));

    const step = this.speed * dt;
    if (step >= remaining) {
      this.distance = stopDistance;
      this.speed = 0;
      this.dwellRemaining = DWELL_SECONDS;
      this.stoppedStop = this.nextStop;
      this.nextStop = (this.nextStop + 1) % this.stations.length;
      playStationBell();
      return;
    }

    this.distance = this.route.wrap(this.distance + step);
    this.wheelSpin += step;
    this.chuffCarry += step;
  }

  /** Seats every car on the rails, facing the way it is going. */
  private placeCars(): void {
    for (let i = 0; i < this.cars.length; i += 1) {
      const car = this.cars[i];
      if (!car) continue;

      const at = this.route.wrap(this.distance - (this.carOffsets[i] ?? 0));
      this.route.pointAt(at, this.point);
      this.route.tangentAt(at, this.tangent);

      car.root.position.copy(this.point);
      car.root.rotation.y = Math.atan2(this.tangent.x, this.tangent.z);

      // Wheels roll off distance travelled, so they never skate.
      for (const wheel of car.wheels) wheel.rotation.x = this.wheelSpin / 0.2;
    }
  }

  /** Where a seat is in the world, with `lift` added to the floor height. */
  private seatPosition(seat: Seat, lift: number, fallbackY: number): void {
    const car = this.carriages[seat.car];
    const local = car?.seats[seat.index];
    if (!car || !local) {
      this.seatWorld.set(0, fallbackY, 0);
      return;
    }
    const yaw = car.root.rotation.y;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    this.seatWorld.set(
      car.root.position.x + local.x * cos + local.z * sin,
      car.root.position.y + CAR_FLOOR_Y + lift,
      car.root.position.z - local.x * sin + local.z * cos,
    );
  }

  // ------------------------------------------------------------ the player

  /** Given the player once, by `World.attachPlayer`. */
  attachPlayer(player: Player): void {
    this.player = player;
  }

  private updateRider(context: FrameContext): void {
    const player = this.player;
    if (!player) return;

    const seat = this.seats[PLAYER_SEAT];
    if (!seat) return;

    if (this.playerRiding) {
      // Riding: the train owns the character until they ask to get off.
      this.seatPosition(seat, SEAT_Y - CAR_FLOOR_Y, player.position.y);
      const car = this.carriages[seat.car];
      player.setRidePose(
        this.seatWorld.x,
        this.seatWorld.y,
        this.seatWorld.z,
        car ? car.root.rotation.y : 0,
      );

      const settled = context.elapsed - this.playerBoardedAt > BOARDING_GRACE;
      if (settled && this.stoppedStop !== null && this.wantsOff(context)) this.alight(player);
      return;
    }

    if (this.stoppedStop === null || this.boardingLocked || seat.taken !== null) return;

    const station = this.stations[this.stoppedStop];
    if (!station || !station.covers(player.position.x, player.position.z)) return;
    if (player.riding) return; // already on a slide, or in the lift

    seat.taken = 'player';
    this.playerRiding = true;
    this.playerBoardedAt = context.elapsed;
    player.beginRide();
    playStationBell();
  }

  /**
   * "Let me off."
   *
   * The interact key, a hop, or *any attempt to walk*. That last one matters:
   * `Game` hides the touch buttons while a ride has hold of you, so on a phone
   * a tap on the ground — which the tap navigator turns into movement input —
   * has to be a way out, or a child is stuck on the train until they find the
   * keyboard they do not have.
   */
  private wantsOff(context: FrameContext): boolean {
    const { input } = context;
    if (input.justPressed('interact') || input.justPressed('jump')) return true;
    return Math.abs(input.moveX) + Math.abs(input.moveY) > 0.35;
  }

  private alight(player: Player): void {
    const seat = this.seats[PLAYER_SEAT];
    if (seat) seat.taken = null;
    this.playerRiding = false;
    // Locked until the train pulls out, so stepping off and standing there does
    // not put you straight back on.
    this.boardingLocked = true;

    const station = this.stoppedStop === null ? null : this.stations[this.stoppedStop];
    if (station) {
      player.setRidePose(
        station.standX,
        station.surfaceY,
        station.standZ,
        Math.atan2(-station.standX, -station.standZ),
      );
    }
    player.endRide();
  }

  // ------------------------------------------------------------- the trimmings

  private updateEffects(context: FrameContext): void {
    const { dt, playerPosition } = context;

    // --- chuffs and smoke ----------------------------------------------------
    if (this.chuffCarry >= CHUFF_INTERVAL) {
      this.chuffCarry -= CHUFF_INTERVAL;
      const local = this.locomotive.funnelTip;
      const yaw = this.locomotive.root.rotation.y;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      this.puffs.emit(
        this.locomotive.root.position.x + local.x * cos + local.z * sin,
        this.locomotive.root.position.y + local.y,
        this.locomotive.root.position.z - local.x * sin + local.z * cos,
      );
      playChuff(clamp01(this.speed / CRUISE_SPEED));
    }
    this.puffs.update(dt);

    // --- how loud is any of this? -------------------------------------------
    const toPlayer = Math.hypot(
      this.locomotive.root.position.x - playerPosition.x,
      this.locomotive.root.position.z - playerPosition.z,
    );
    setTrainAudioCarry(clamp01(1 - toPlayer / AUDIBLE_RANGE) ** 1.5);

    // --- lights --------------------------------------------------------------
    const lit = clamp01(this.nightFactor);
    this.headlight.intensity = lit * 7;
    const glow = 0.32 + lit * 0.68;
    for (const car of this.cars) {
      for (const lamp of car.lamps) lamp.color.setScalar(glow);
    }
    for (const station of this.stations) {
      for (const lamp of station.lamps) lamp.color.setScalar(glow);
    }
  }
}

/** A carriage floor, as a surface you can stand on. */
function carriageFloor(carriage: TrainCar): MovingPlatform {
  const halfLength = CARRIAGE_LENGTH / 2;
  const halfWidth = 0.72;
  return {
    get surfaceY(): number {
      return carriage.root.position.y + CAR_FLOOR_Y;
    },
    covers(x: number, z: number): boolean {
      const dx = x - carriage.root.position.x;
      const dz = z - carriage.root.position.z;
      const yaw = carriage.root.rotation.y;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const along = dx * sin + dz * cos;
      const across = dx * cos - dz * sin;
      return Math.abs(along) <= halfLength && Math.abs(across) <= halfWidth;
    },
  };
}
