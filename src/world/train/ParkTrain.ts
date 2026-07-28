import { Group, PointLight, Vector3 } from 'three';
import { clamp01 } from '../../core/mathUtils';
import { PALETTE } from '../../core/palette';
import type { FrameContext, GameSystem } from '../../core/types';
import type { Player } from '../../entities/Player';
import type { NpcCharacter } from '../../entities/npc/NpcCharacter';
import type { CollisionWorld } from '../Collision';
import { PRIMARY_ACTION, type InteractZone, type ZoneAction } from '../interact';
import type { MovingPlatform } from '../building/surfaces';
import { TrainRoute } from './route';
import { TRAIN_PLAN } from './plan';
import { buildTrack, type Track } from './track';
import { Station } from './station';
import { RideCamera } from '../../core/RideCamera';
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
 * the park all day, calling at two stations. Children get on by themselves.
 *
 * **You** get on and off by pressing a chip, and only by pressing a chip
 * (GAME_DESIGN.md's SELECTION RULE, 28 July 2026). Standing on a platform used
 * to board you outright and any attempt to walk used to put you off again,
 * which is exactly the "doing things by mistake" the family had had enough of:
 * a child crossing a platform found herself on a train, and a child looking
 * round from her seat found herself back on the platform. Now the station
 * offers **"Get on"** while the train is standing there, and **"Get off"**
 * while she is aboard and it is stopped, and nothing at all in between.
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

/** Shared empty list: "nothing you can do with this train from here, just now". */
const NO_ACTIONS: readonly ZoneAction[] = [];

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

  /**
   * The first-person view from the player's seat (Decision 4 C2), built on
   * C1's shared {@link RideCamera} — the ferris wheel's family-approved
   * look-around, adopted rather than rewritten. Created lazily in
   * {@link attachPlayer} because it attaches pointer listeners, and the
   * headless park (check:park) has no DOM and no player.
   */
  rideView: RideCamera | null = null;
  /** Game wires this: entered/left first person, wrap it in the iris. */
  onRideChange: ((riding: boolean) => void) | null = null;
  private seatMount: Group | null = null;

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
  /** This frame's game clock, kept so {@link requestBoard} can stamp a boarding from outside the frame. */
  private boardedAtElapsed = 0;
  /** Allocated once each: an action list is immutable and is rebuilt every frame otherwise. */
  private getOnAction: readonly ZoneAction[] | null = null;
  private getOffAction: readonly ZoneAction[] | null = null;
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

    this.route = TRAIN_PLAN.route;
    this.track = buildTrack(this.route);
    this.group.add(this.track.group);

    // Level crossings first (they come out of the solved curve and the drawn
    // paths), then the fence, which leaves a gap at every one of them and at
    // both stations (whose spots were fixed in `train/plan.ts`).
    this.crossings = computeCrossings(
      this.route,
      TRAIN_PLAN.stations.map((station) => station.distance),
    );

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
    // Planned in `train/plan.ts` — position, name, everything — before any
    // scene object existed, so the path graph could take them as nodes. Here
    // they are only *built*.
    for (const planned of TRAIN_PLAN.stations) {
      const station = new Station(
        {
          index: planned.index,
          name: planned.name,
          subtitle: planned.subtitle,
          glyph: planned.glyph,
          accent: planned.accent,
          distance: planned.distance,
        },
        this.route,
        collision,
      );
      this.stations.push(station);
      this.group.add(station.group);
      this.stops.push({
        index: planned.index,
        name: planned.name,
        x: station.standX,
        z: station.standZ,
      });
    }

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
  platforms(): MovingPlatform[] {
    const platforms: MovingPlatform[] = this.stations.map((station) => station.asPlatform());
    for (const carriage of this.carriages) platforms.push(carriageFloor(carriage));
    return platforms;
  }

  /**
   * One zone per platform, each offering whatever the train can do for you
   * *right now* — which is the whole reason {@link InteractZone.actions} is a
   * function. Standing at Bluebell Halt with the train at Sunny Side offers
   * nothing; the moment it pulls in, "Get on" appears over it.
   */
  interactZones(): InteractZone[] {
    return this.stations.map((station, index) => ({
      ...station.interactZone(),
      actions: () => this.stationActions(index),
    }));
  }

  /** "Get on" / "Get off" / nothing, for the platform at `index`. */
  private stationActions(index: number): readonly ZoneAction[] {
    // Only ever the platform she is actually standing at: the train cannot be
    // in two places, and neither can she.
    if (this.stoppedStop !== index) return NO_ACTIONS;

    if (this.playerRiding) {
      return this.getOffAction ?? (this.getOffAction = [
        { id: PRIMARY_ACTION, label: 'Get off', glyph: '👋', run: () => this.requestAlight() },
      ]);
    }

    const seat = this.seats[PLAYER_SEAT];
    if (this.boardingLocked || !seat || seat.taken !== null) return NO_ACTIONS;
    return this.getOnAction ?? (this.getOnAction = [
      { id: PRIMARY_ACTION, label: 'Get on', glyph: '🚂', run: () => this.requestBoard() },
    ]);
  }

  /**
   * "Get on, please."
   *
   * The chip's own commit walks her onto the platform first when she pressed it
   * from across the park, so by the time this runs she is standing on it — but
   * the train may have pulled out while she walked, which is why every gate is
   * re-checked here rather than trusted from when the chip was drawn.
   */
  requestBoard(): void {
    const player = this.player;
    const seat = this.seats[PLAYER_SEAT];
    if (!player || !seat) return;
    if (this.stoppedStop === null || this.boardingLocked || seat.taken !== null) return;
    if (player.riding) return; // already on a slide, or in the lift

    const station = this.stations[this.stoppedStop];
    if (!station || !station.covers(player.position.x, player.position.z)) return;

    seat.taken = 'player';
    this.playerRiding = true;
    this.playerBoardedAt = this.boardedAtElapsed;
    player.beginRide();
    playStationBell();
    this.onRideChange?.(true);
  }

  /** "Get off, please." Ignored while the train is moving — there is nowhere to step. */
  requestAlight(): void {
    const player = this.player;
    if (!player || !this.playerRiding || this.stoppedStop === null) return;
    this.alight(player);
  }

  // --------------------------------------------------------------- the frame

  update(context: FrameContext): void {
    const { dt } = context;
    this.boardedAtElapsed = context.elapsed;
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

    // The eye rides the player's seat: a mount parented into the carriage at
    // the seat's local spot, so three.js composes the motion and the view
    // needs no per-frame transform (the property C1's parity proof rests on).
    const seat = this.seats[PLAYER_SEAT];
    const car = seat ? this.carriages[seat.car] : undefined;
    const local = car?.seats[seat?.index ?? 0];
    if (car && local) {
      this.seatMount = new Group();
      this.seatMount.position.set(local.x, SEAT_Y - CAR_FLOOR_Y + CAR_FLOOR_Y, local.z);
      car.root.add(this.seatMount);
      this.rideView = new RideCamera({ startPitch: -0.05 });
      this.rideView.mountOn(this.seatMount, { x: 0, y: 0.62, z: 0 });
    }
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

      // First person: the shared look-around runs while she rides, and a
      // look-drag must never read as "let me off" — that is what the
      // reading's `dragging` is for (see wantsOff).
      const look = this.rideView?.update(context.dt, context.elapsed) ?? null;

      const settled = context.elapsed - this.playerBoardedAt > BOARDING_GRACE;
      if (
        settled &&
        this.stoppedStop !== null &&
        this.wantsOff(context, look?.dragging ?? false)
      ) {
        this.alight(player);
      }
      return;
    }

    // Nothing else to do. Boarding is {@link requestBoard} and nothing but —
    // there is deliberately no "she is standing on the platform, put her on the
    // train" branch here any more.
  }

  /**
   * "Let me off." The interact key or a hop — accelerators for the "Get off"
   * chip, for a player whose hands are already on the keyboard.
   *
   * **Walking is no longer a way off**, and that is the point of the SELECTION
   * RULE: a child who turned to look at the park found herself standing on the
   * platform watching the train leave. The chip is the way out, it is on screen
   * over the platform the whole time the train is stopped, and it is pressable
   * with a finger — which is what the movement clause was really there for.
   */
  private wantsOff(context: FrameContext, _lookDragging: boolean): boolean {
    const { input } = context;
    return input.justPressed('interact') || input.justPressed('jump');
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
    this.onRideChange?.(false);
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
