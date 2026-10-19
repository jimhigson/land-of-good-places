import { Group, type Object3D, PointLight, Quaternion, Vector3 } from 'three';
import { PARADE_MEMBER_RADIUS, PLAYER_RADIUS } from '../../core/constants';
import { clamp01 } from '../../core/mathUtils';
import { PALETTE } from '../../core/palette';
import type { FrameContext, GameSystem } from '../../core/types';
import type { CompanionSeat, Player, RideHolder } from '../../entities/Player';
import type { NpcCharacter } from '../../entities/npc/NpcCharacter';
import type { BoxCollider, CollisionWorld } from '../Collision';
import { PRIMARY_ACTION, type InteractZone, type ZoneAction } from '../interact';
import type { MovingPlatform } from '../building/surfaces';
import { TRACK_CLEARANCE, TrainRoute } from './route';
import { distanceToRailCorridor, TRAIN_PLAN } from './plan';
import { FENCE_HALF_THICKNESS, FENCE_OFFSET } from './clearance';
import { terrainHeight } from '../terrain';
import { buildTrack, type Track } from './track';
import { Station } from './station';
import { RideCamera } from '../../core/RideCamera';
import { rideFrame } from '../rail/sweptRail';
import { computeCrossings, type LevelCrossing } from './crossings';
import { buildRailFence } from './fence';
import { buildBridges, type Bridge } from './bridges';
import { BRIDGE_WALL_THICKNESS } from './bridgeFootprint';
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
import { CARRIAGE_BODY_HALF_WIDTH, LOCO_BODY_TOP_Y } from './trainDimensions';
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
 * carries you (ARCHITECTURE.md). The carriages register as
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
 * `NpcSystem` runs, and the carriage-as-moving-platform supplies the y.
 *
 * Their own movement code then stands down for the frame — `setCarriedPose`,
 * the crowd's counterpart to `Player.setRidePose`. It used to *run* instead,
 * on the theory that a passenger asks for nothing and so would go nowhere.
 * That theory was wrong twice over: a seat sits on the track, inside the rail
 * fence, so collision resolution pushed every rider off the train; and the
 * resolved-position velocity rewrite then read both that push and this class's
 * own write as speed the child had asked for, which ran away. See
 * `NpcCharacter.setCarriedPose` for the numbers.
 */

/** Metres per second on the open stretches. About a brisk walking pace. */
const CRUISE_SPEED = 4.0;

const ACCELERATION = 1.7;
const BRAKING = 2.4;

/** Seconds spent at each station with the doors open. */
const DWELL_SECONDS = 8;

/**
 * **How far short of anyone on the line the train's nose stands**, metres —
 * from its buffer beam to the edge of her body. Jim, 19 Oct 2026: *"jumping
 * onto the train tracks sounds ok so long as the train stops if there's
 * someone on the tracks."* See {@link ParkTrain.keepClearOf}.
 */
export const TRAIN_STOPS_SHORT = 1.5;
/** How far down the line the train looks for someone on it, metres: well past its stopping distance at cruise. */
const LOOK_AHEAD = 24;
/**
 * The hardest it ever brakes, metres per second per second: only for someone
 * who came onto the line closer than it could stop smoothly — still a stop
 * short of her, never a bump.
 */
const HARDEST_BRAKING = 9;
/**
 * **How close to the line's middle a body may come before it is on the line**,
 * metres, beyond its own radius: the train's swept clearance
 * (`TRACK_CLEARANCE`, which every prop beside the railway keeps), so the train
 * stops for anybody it could touch — and touches nobody, so it can never push
 * her into a fence, a wall or a trap.
 *
 * Beside a platform the line runs straight and the train sweeps no wider than
 * its body, so there it is narrower, and asked two ways:
 *
 * - **ahead of the train**, a body is in its way once it reaches the engine's
 *   widest — the cab's eaves ({@link PLATFORM_AHEAD}) — and a hand: she may
 *   wait on the platform, but not with her toes over the edge;
 * - **beside it, standing**, only a body over it — its middle inside where
 *   the carriages' sides pass ({@link PLATFORM_BESIDE}), which is a body up on
 *   a carriage: a train pulling away slides past anybody touching its side,
 *   or leaning on it, and pushes nobody, so a child against a carriage, or one
 *   of the crowd idling at the platform's edge, does not hold it there.
 */
const ON_THE_LINE = TRACK_CLEARANCE;
/** Ahead of the train beside a platform: the cab's eaves (`ENGINE_PIECES`), and a hand. */
const PLATFORM_AHEAD = CARRIAGE_BODY_HALF_WIDTH + 0.12 + 0.08;
/** Beside a standing train at a platform: a body's middle inside the carriages' sides — up on one. */
const PLATFORM_BESIDE = CARRIAGE_BODY_HALF_WIDTH;
/** How long the line must stay clear before the train toots for the next person on it. */
const TOOT_REARM_SECONDS = 3;
/** How often the driver toots again while somebody stays on the line: he keeps asking, and waits. */
const TOOT_AGAIN_SECONDS = 4;

/** Something the train must not run into — her, or something following her — at its feet, with its body's radius. */
export interface OnTheLine {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

/** Carriages, and therefore seats: two on each. */
const CARRIAGE_COUNT = 3;

/** Seat 0 is always kept for the player; children take the rest. */
const PLAYER_SEAT = 0;
/**
 * **Her companion's seat** — the bench right behind hers, in the next
 * carriage, facing her back (Jim, 19 Oct 2026: *"one rides on the seat
 * alongside the player"*). Not the bench facing her in her own carriage: she
 * rides in first person, and a pet as tall as she is sitting there would fill
 * her whole view of the line ahead — the family's own rule for the ferris
 * gondola, *"the pet should sit on a chair that is lower than the player's so
 * it is easier to see above their head"*. Her own bench has no room beside her:
 * she fills it. Kept for her companion like {@link PLAYER_SEAT} is for her, and
 * it costs the children nothing — four of them still ride
 * ({@link MAX_NPC_RIDERS}).
 */
const COMPANION_SEAT = 2;
const MAX_NPC_RIDERS = 4;

/** How long after boarding before a movement key means "let me off". */
const BOARDING_GRACE = 1.2;

/** Metres of travel between chuffs. */
const CHUFF_INTERVAL = 1.5;

/** Beyond this the train cannot be heard at all. */
const AUDIBLE_RANGE = 42;

/** Shared empty list: "nothing you can do with this train from here, just now". */
const NO_ACTIONS: readonly ZoneAction[] = [];

/**
 * **One solid piece of a car**, in the car's own frame: centred at `(x, z)`,
 * `halfX` across and `halfZ` along, its top `top` above the car's floor datum
 * (the rails' ground, where the car's root stands). `narrow` for a top no
 * child could stand on — a rim, a backrest, a round boiler — which she bumps,
 * jumps over or falls off, but never lands on.
 */
interface CarPiece {
  readonly x: number;
  readonly z: number;
  readonly halfX: number;
  readonly halfZ: number;
  readonly top: number;
  readonly narrow: boolean;
}

/** How far below a car's datum its pieces begin: under the ground, so nobody stands beneath one. */
const PIECE_BASE = -0.5;
/** Half a narrow piece's depth: a backrest's, fattened from its drawn 0.1 m to the rim's 0.16 m so she meets it square. */
const RIM_HALF = 0.08;

/**
 * **The engine, as solid as it is drawn** (`createLocomotive`): the chassis, the
 * boiler and smokebox, the cab under its roof, the funnel, the dome and the
 * buffer beam. Only the cab's roof is a top she could stand on — the boiler is
 * round, and the rest are rims and posts.
 */
const ENGINE_PIECES: readonly CarPiece[] = [
  { x: 0, z: 0, halfX: CARRIAGE_BODY_HALF_WIDTH, halfZ: (LOCO_LENGTH - 0.2) / 2, top: CAR_FLOOR_Y, narrow: true },
  { x: 0, z: (-0.55 + 2.1) / 2, halfX: 0.56, halfZ: (2.1 + 0.55) / 2, top: CAR_FLOOR_Y + 1.11, narrow: true },
  { x: 0, z: -1.05, halfX: CARRIAGE_BODY_HALF_WIDTH + 0.12, halfZ: 0.75, top: CAR_FLOOR_Y + 1.27, narrow: false },
  { x: 0, z: 1.25, halfX: 0.27, halfZ: 0.27, top: LOCO_BODY_TOP_Y, narrow: true },
  { x: 0, z: 0.35, halfX: 0.22, halfZ: 0.22, top: CAR_FLOOR_Y + 1.23, narrow: true },
  { x: 0, z: LOCO_LENGTH / 2 - 0.05, halfX: CARRIAGE_BODY_HALF_WIDTH + 0.1, halfZ: 0.09, top: CAR_FLOOR_Y + 0.1, narrow: true },
];

/**
 * **A carriage, as solid as it is drawn** (`createCarriage`): an open tub whose
 * top is its rim — the cream strip round its sides and ends — and its two
 * backrests standing up out of it. She stands on a carriage at its rim: the
 * seats are 6 cm under it, and the footwell between them and the gaps behind
 * the backrests are narrower than she is (0.54 m and 0.35 m against her
 * 1.24 m), so there is nowhere lower in a carriage for her to stand. Measured
 * on seed 5, rims of their own (0.16 m wide, too narrow to stand on) left her
 * four centimetres either side to land in, so every jump onto the carriage put
 * her on a rim and off again — a tub she could see the top of and never reach.
 */
const CARRIAGE_PIECES: readonly CarPiece[] = [
  { x: 0, z: 0, halfX: CARRIAGE_BODY_HALF_WIDTH, halfZ: CARRIAGE_LENGTH / 2, top: CAR_FLOOR_Y + 0.48, narrow: false },
  { x: 0, z: 0.78, halfX: CARRIAGE_BODY_HALF_WIDTH - 0.09, halfZ: RIM_HALF, top: SEAT_Y + 0.34, narrow: true },
  { x: 0, z: -0.78, halfX: CARRIAGE_BODY_HALF_WIDTH - 0.09, halfZ: RIM_HALF, top: SEAT_Y + 0.34, narrow: true },
];

/** A car's pieces in the collision world, and the pieces they are. */
interface CarBody {
  readonly car: TrainCar;
  readonly pieces: readonly CarPiece[];
  readonly boxes: BoxCollider[];
}

const _pieceAt = /* @__PURE__ */ new Vector3();
const _pieceTop = /* @__PURE__ */ new Vector3();
const _pieceBase = /* @__PURE__ */ new Vector3();

interface Seat {
  /** Which car, and which of its seats. */
  readonly car: number;
  readonly index: number;
  taken: 'player' | 'npc' | null;
}

const _planForward = /* @__PURE__ */ new Vector3();
/** A half turn about the carriage's own up: a bench facing back down it. */
// flat-ok: the carriage's own up — a local axis, composed onto its leant frame
const HALF_TURN = /* @__PURE__ */ new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
const _funnel = /* @__PURE__ */ new Vector3();

/**
 * **Which way a carriage is pointing, seen from above.**
 *
 * `root.rotation.y` used to answer this, and stopped being able to the moment
 * the carriages began leaning with the railway: three.js decomposes the Euler
 * out of `tilt * yaw`, so all three components carry a share of both and the
 * `.y` is neither the lean nor the heading. Three separate places read it — the
 * rider's facing, the funnel's smoke, and the "is the player under this
 * carriage's roof" test — and all three would have been quietly wrong by the
 * lean.
 *
 * Taking the object's own forward axis and flattening it into the ground plane
 * is true whatever the carriage is doing, because it asks the matrix rather
 * than a cached angle. Models in this park face `+Z` (ASSET_MANIFEST), which is
 * what `getWorldDirection` returns.
 */
function planYawOf(object: Object3D): number {
  object.getWorldDirection(_planForward);
  return Math.atan2(_planForward.x, _planForward.z);
}

export class ParkTrain implements GameSystem, TrainService {
  readonly name = 'parkTrain';
  readonly group = new Group();

  readonly route: TrainRoute;
  readonly stations: Station[] = [];
  readonly stops: TrainStop[] = [];
  /** The level crossings — exported so `check:park` knows where feet may cross. */
  readonly crossings: readonly LevelCrossing[] = [];
  /** The bridge built at every crossing (issue #116, Decision 8) — exported
   * so `check:park`, `NavGrid` and `PoiGraph` can all route across them. */
  readonly bridges: readonly Bridge[] = [];
  /** Every bridge's own deck and ramp treads — folded into {@link platforms}. */
  private readonly bridgePlatforms: readonly MovingPlatform[] = [];

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
  /** The children carried last frame, by seat — see {@link carryPassengers}. */
  private readonly aboard = new Map<NpcCharacter, number>();
  /** Every car's solid pieces — see {@link CarBody}; moved with the car every frame ({@link placeCars}). */
  private readonly bodies: CarBody[] = [];
  private readonly collision: CollisionWorld;

  /** Distance of the *locomotive's centre* along the route. */
  private distance = 0;
  private speed = 0;
  /** Everyone the train stops for: asked every frame ({@link keepClearOf}). */
  private readonly clearOf: (() => Iterable<OnTheLine>)[] = [];
  /** Her line — see {@link attachParade}. */
  private parade: { standing(): Iterable<Readonly<Vector3>> } | null = null;
  /** Whether it has tooted for whoever is on the line now, how long since, and how long the line has been clear. */
  private tooted = false;
  private sinceToot = 0;
  private clearFor = Infinity;
  /** The platforms, so someone standing on one is not on the line. */
  private readonly platformDecks: MovingPlatform[] = [];
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

  constructor(
    collision: CollisionWorld,
    clearTreesNear?: (x: number, z: number, radius: number) => number,
    hasFellableTreeNear?: (x: number, z: number, radius: number) => boolean,
  ) {
    this.group.name = 'park-train';

    this.route = TRAIN_PLAN.route;
    this.track = buildTrack(this.route);
    this.group.add(this.track.group);

    // Level crossings first (they come out of the solved curve and the drawn
    // paths) — each one gets a bridge, below, and the fence gaps only for
    // boarding at a station now (whose spots were fixed in `train/plan.ts`).
    this.crossings = computeCrossings(
      this.route,
      TRAIN_PLAN.stations.map((station) => station.distance),
    );

    // --- the stations ----------------------------------------------------
    // Planned in `train/plan.ts` — position, name, everything — before any
    // scene object existed, so the path graph could take them as nodes. Here
    // they are only *built* — and built **before** the bridges, not after:
    // a station's canopy posts are real, registered colliders
    // (`collision.addCircle`, `radius = 0.22`), and the bridge footprint
    // search below asks the real collision world for exactly this kind of
    // thing. Built the other way round, a bridge's own (issues #317, #319)
    // backtracking search — free, for the first time, to slide a deck
    // sideways along the crossing — could slide one into a canopy post that
    // exists in the finished game but did not yet exist in `collision` when
    // the search ran (found live testing this very search, seed 2: a deck
    // edge cleared everything the search could see and still landed 0.78 m
    // from a post the search never got to ask about).
    for (const planned of TRAIN_PLAN.stations) {
      const station = new Station(
        {
          index: planned.index,
          name: planned.name,
          accent: planned.accent,
          distance: planned.distance,
        },
        this.route,
        collision,
      );
      this.stations.push(station);
      this.platformDecks.push(station.asPlatform());
      this.group.add(station.group);
      this.stops.push({
        index: planned.index,
        name: planned.name,
        x: station.standX,
        z: station.standZ,
        waitX: station.waitX,
        waitZ: station.waitZ,
      });
    }

    // A bridge at every crossing (issue #116, Decision 8) — built before the
    // fence, which needs to know where every deck stands so it can seam
    // around it rather than gap for it. See `bridges.ts`'s header.
    //
    // `collision` is handed in here as `real` (issues #317, #319) — by this
    // point in `World`'s own build order, almost everything solid in the
    // park already exists, so the footprint search backtracks against what
    // is actually there rather than a couple of hand-picked obstacle
    // classes. `clearTreesNear` is the same last-resort lever
    // `coaster/pylons.ts` already uses for its own placement search.
    const built = buildBridges(this.route, this.crossings, {
      collision,
      railCorridorDistance: distanceToRailCorridor,
      ...(clearTreesNear ? { clearTreesNear } : {}),
      ...(hasFellableTreeNear ? { hasFellableTreeNear } : {}),
    });
    this.bridges = built.bridges;
    this.bridgePlatforms = built.platforms;
    this.group.add(built.group);
    for (const rail of built.guardRails) {
      // A masonry parapet/spandrel wall: solid from the ground (blocks a
      // walker beside the bridge) — or, over the tunnel's opening, from the
      // arch's face — with an ABSOLUTE top at the drawn coping, from one end
      // of each piece to the other (`TopSlope`) — see `bridges.ts`'s
      // `BridgeWall`.
      collision.kinded('bridge parapet', () =>
        collision.addWall(rail.x1, rail.z1, rail.x2, rail.z2, BRIDGE_WALL_THICKNESS / 2, rail.topHeight, false, true, rail.base, false, Number.NaN, rail.topHeightEnd),
      );
    }
    // The tunnel's masonry: the vault over the opening, from the soffit up,
    // and each abutment's inner face, from the ground (`bridges.ts`'s
    // `BridgeVault`). The line runs on under the bridge, for her as for the
    // train.
    for (const vault of built.vaults) {
      collision.kinded(vault.kind, () => collision.addBox(vault.cx, vault.cz, vault.halfX, vault.halfZ, vault.yaw, 0, vault.top, false, true, vault.base));
    }

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

    // --- the fence (Decision 4 §6: keeping feet off the track) -------------
    // Built last of all the trackside furniture, so it can seam around every
    // bridge and gap for every platform.
    this.group.add(
      buildRailFence(
        this.route,
        collision,
        this.bridges,
        this.stations.map((station) => ({ distance: station.distance })),
      ),
    );

    // Start standing at the first station, so the first thing a child sees is a
    // train waiting for them rather than one disappearing round a corner.
    const first = this.stations[0];
    this.distance = this.route.wrap((first?.distance ?? 0) + this.stopOffset);
    this.dwellRemaining = DWELL_SECONDS;
    this.stoppedStop = 0;
    this.nextStop = 1 % this.stations.length;

    // **Solid, as drawn** (Jim, 19 Oct 2026: *"also solid trains"*): every
    // car's pieces, registered once and moved with it every frame — she bumps
    // its sides and ends, never walks through it, and may jump up onto it
    // while it stands (and then it waits for her: `wayAhead`). Riders are
    // carried, never collided, so nobody aboard is pushed by their own train.
    this.collision = collision;
    for (const car of this.cars) {
      const pieces = car === this.locomotive ? ENGINE_PIECES : CARRIAGE_PIECES;
      const kind = car === this.locomotive ? 'train engine' : 'train carriage';
      const boxes = pieces.map((piece) =>
        collision.kinded(kind, () =>
          piece.narrow
            ? collision.toppedNarrow(RIM_HALF, () => collision.addMovingBox(0, 0, piece.halfX, piece.halfZ, 0, piece.top, PIECE_BASE))
            : collision.addMovingBox(0, 0, piece.halfX, piece.halfZ, 0, piece.top, PIECE_BASE),
        ),
      );
      this.bodies.push({ car, pieces, boxes });
    }

    this.placeCars();
    setTrainService(this);
  }

  /**
   * **The train stops for her** (Jim, 19 Oct 2026: *"jumping onto the train
   * tracks sounds ok so long as the train stops if there's someone on the
   * tracks"*). `bodies` is asked every frame for everyone who may be on the
   * line — her, and whatever follows her, a pet in her parade — and when any
   * of them is on the line ahead, within its stopping distance, the train
   * brakes smoothly to stand {@link TRAIN_STOPS_SHORT} short of them, toots,
   * waits, and moves on once the line is clear. At a station as anywhere on
   * the loop: a train due to leave waits too. One owner — {@link wayAhead} —
   * and nothing else in the game decides it.
   */
  keepClearOf(bodies: () => Iterable<OnTheLine>): void {
    this.clearOf.push(bodies);
  }

  /**
   * **Her line, for the train to look out for** — given by `World.attachParade`,
   * the one place her parade is introduced to the park. She herself comes with
   * {@link attachPlayer}. Each stands where it stands; one riding with her —
   * she in her seat, her companion in its — is aboard, and the train never
   * waits for anybody aboard it.
   */
  attachParade(parade: { standing(): Iterable<Readonly<Vector3>> }): void {
    this.parade = parade;
  }

  /**
   * **Is a body standing here on the line?** — the train's own answer, the
   * one {@link wayAhead} asks of everybody it looks out for: within reach of
   * the line's middle (its swept clearance, or a hand off the carriages' sides
   * on a platform — see {@link ON_THE_LINE}), down on the track bed or up on
   * the train, never on a bridge's deck over it. Asked from outside too: her
   * line, coming back out of her backpack, forms up off it (`Parade`).
   */
  onTheLine(x: number, y: number, z: number, radius: number): boolean {
    return this.lineAt(x, y, z, radius) !== null;
  }

  /**
   * **Is a body down on the track itself** — on the line, and not on a
   * platform beside it: a child of the crowd pushed off a platform's edge, who
   * must be got off it (`NpcSystem.offTheLine`). One waiting on the platform,
   * however near its edge, is where she should be.
   */
  downOnTheLine(x: number, y: number, z: number, radius: number): boolean {
    const near = this.nearLine(x, y, z);
    return near !== null && !near.onPlatform && near.lateral <= ON_THE_LINE + radius;
  }

  /**
   * Where along the route a body near the line is, metres, how far from its
   * middle, and whether it stands on a platform — `null` for one that is not
   * on the line by the widest reach ({@link ON_THE_LINE}).
   */
  private lineAt(x: number, y: number, z: number, radius: number): number | null {
    const near = this.nearLine(x, y, z);
    if (!near) return null;
    return near.lateral > (near.onPlatform ? PLATFORM_AHEAD : ON_THE_LINE) + radius ? null : near.at;
  }

  private readonly nearScratch = { at: 0, lateral: 0, onPlatform: false };

  /** {@link lineAt}'s measure, before any reach is applied: `null` only above or below the line's level. */
  private nearLine(x: number, y: number, z: number): { at: number; lateral: number; onPlatform: boolean } | null {
    // Where along the line she is, to the centimetre: the route's nearest
    // sample, then onto the line itself along its tangent there — the samples
    // alone put a pet 0.13 m nearer than it stood.
    let at = this.route.distanceNear(x, z);
    for (let k = 0; k < 2; k += 1) {
      this.route.pointAt(at, this.point);
      this.route.tangentAt(at, this.tangent);
      at = this.route.wrap(at + (x - this.point.x) * this.tangent.x + (z - this.point.z) * this.tangent.z);
    }
    this.route.pointAt(at, this.point);
    if (y > this.point.y + 2 || y < this.point.y - 1.5) return null;
    const near = this.nearScratch;
    near.at = at;
    near.lateral = Math.hypot(x - this.point.x, z - this.point.z);
    near.onPlatform = this.platformDecks.some((deck) => deck.covers(x, z) && y >= deck.surfaceY - 0.05);
    return near;
  }

  /** Everybody the train looks out for: her, her line, and whoever else {@link keepClearOf} was given. */
  private *lookout(): Iterable<OnTheLine> {
    const player = this.player;
    if (player && !player.riding) yield { x: player.position.x, y: player.position.y, z: player.position.z, radius: PLAYER_RADIUS };
    if (this.parade) for (const at of this.parade.standing()) yield { x: at.x, y: at.y, z: at.z, radius: PARADE_MEMBER_RADIUS };
    for (const source of this.clearOf) yield* source();
  }

  /** Where the train's nose is along the route, metres — its buffer beam. */
  noseDistance(): number {
    return this.route.wrap(this.distance + LOCO_LENGTH / 2);
  }

  /** How fast it is going, metres a second. */
  get runningSpeed(): number {
    return this.speed;
  }

  /**
   * **How far the nose may still run before it must stand, metres** —
   * `Infinity` while the line ahead is clear: to {@link TRAIN_STOPS_SHORT}
   * short of the nearest body on the line within {@link LOOK_AHEAD}, or 0 for
   * one already alongside the train, between its nose and its tail — on the
   * track beside a carriage, pressed against its side, or standing up on it.
   * Then it does not move at all: it never pushes anybody anywhere.
   *
   * On the line is {@link onTheLine}'s answer. Anybody riding is aboard, not
   * on it — she in her seat, her companion in its own, the children in theirs
   * — and is never in {@link lookout} at all.
   */
  private wayAhead(): number {
    const nose = this.noseDistance();
    const last = this.carOffsets[this.carOffsets.length - 1] ?? 0;
    const length = LOCO_LENGTH / 2 + last + CARRIAGE_LENGTH / 2;
    const loco = this.locomotive.root.position;
    let way = Infinity;
    for (const body of this.lookout()) {
      // Nowhere near the train at all: not worth finding on the route.
      if (Math.hypot(body.x - loco.x, body.z - loco.z) > LOOK_AHEAD + length + body.radius) continue;
      const near = this.nearLine(body.x, body.y, body.z);
      if (!near) continue;
      const at = near.at;
      const beside = this.route.forwardGap(this.route.wrap(nose - length), at) <= length + body.radius;
      const reach = near.onPlatform ? (beside ? PLATFORM_BESIDE : PLATFORM_AHEAD + body.radius) : ON_THE_LINE + body.radius;
      if (near.lateral > reach) continue;
      const ahead = this.route.forwardGap(nose, at);
      if (beside) return 0;
      if (ahead > LOOK_AHEAD + body.radius + TRAIN_STOPS_SHORT) continue;
      way = Math.min(way, Math.max(0, ahead - body.radius - TRAIN_STOPS_SHORT));
    }
    return way;
  }

  /** The fastest the train may go with `way` metres left before it must stand: a smooth stop, or the hardest it brakes for one it saw late. */
  private speedFor(way: number, dt: number): number {
    if (way <= 0.01) return 0;
    const smooth = Math.sqrt(2 * BRAKING * way);
    if (this.speed <= smooth) return smooth;
    const braking = Math.min(HARDEST_BRAKING, (this.speed * this.speed) / (2 * way));
    return Math.max(0, this.speed - braking * dt);
  }

  /** Platforms, carriage floors and every bridge deck/tread, for
   * `WalkSurfaces.addPlatform`. */
  platforms(): MovingPlatform[] {
    const platforms: MovingPlatform[] = this.stations.map((station) => station.asPlatform());
    for (const carriage of this.carriages) platforms.push(carriageFloor(carriage));
    platforms.push(...this.bridgePlatforms);
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

  /**
   * The platforms' tap areas, for the flower scatter to keep its blooms out
   * of (the tap-spacing rule, `world/tapSpacing.ts`) — the stations only
   * exist once the loop is solved, which is after the meadow is planted.
   */
  stationTapAreas(): readonly { x: number; z: number; pickRadius: number }[] {
    return this.stations.map((station) => {
      const zone = station.interactZone();
      return { x: zone.x, z: zone.z, pickRadius: zone.pickRadius };
    });
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
    player.beginRide(this.holder);
    playStationBell();
    // Still inside the "Get on" press, which is the point: this is where the
    // phone-tilt look takes "straight ahead" from where she is actually facing,
    // and where iOS is asked for the sensors — a prompt it will only show from
    // inside a gesture. Does nothing on desktop.
    this.rideView?.board();
    this.onRideChange?.(true);
  }

  /**
   * Whoever rides the train is held by this — and let go by getting off: at the
   * platform it is standing at, or, mid-journey, at the next one's stand, the
   * platform she was about to arrive at. Never in the middle of the track.
   */
  private readonly holder: RideHolder = {
    holding: 'the train',
    letGo: () => {
      const player = this.player;
      if (player && this.playerRiding) this.alight(player);
    },
    // Her companion, on the bench behind hers ({@link COMPANION_SEAT}).
    companion: { beside: (seat) => this.companionSeatPose(seat) },
  };

  /**
   * Where her companion sits this frame: its feet on the bench top of
   * {@link COMPANION_SEAT}, facing the way that bench faces, in the carriage's
   * own frame — so it leans with the railway as the carriage does.
   */
  private companionSeatPose(seat: CompanionSeat): boolean {
    const entry = this.seats[COMPANION_SEAT];
    const car = entry ? this.carriages[entry.car] : undefined;
    const local = car && entry ? car.seats[entry.index] : undefined;
    if (!car || !local) return false;
    car.root.updateMatrixWorld();
    this.seatWorld.set(local.x, SEAT_Y, local.z);
    car.root.localToWorld(this.seatWorld);
    seat.x = this.seatWorld.x;
    seat.y = this.seatWorld.y;
    seat.z = this.seatWorld.z;
    // The bench's riders face away from its backrest — towards the carriage's
    // middle — which for this one is the way the train goes.
    const backwards = local.z > 0;
    seat.facing = planYawOf(car.root) + (backwards ? Math.PI : 0);
    seat.turn.copy(car.root.quaternion);
    if (backwards) seat.turn.multiply(HALF_TURN);
    return true;
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
    // **Off the train, onto the platform.** A child who gave her seat up last
    // frame is still standing where it was — inside a carriage, which is
    // solid — so she is carried one last step, to the platform beside her
    // seat, and walks off from there.
    for (const [character, seatNumber] of this.aboard) {
      const now = (character.driver as Partial<TrainPassenger>).trainSeat;
      if (now === seatNumber) continue;
      this.aboard.delete(character);
      const seat = this.seats[seatNumber];
      if (!seat) continue;
      this.seatPosition(seat, 0, character.position.y);
      // The platform she was at: the nearest to her seat, not the stop the
      // train is standing at — she may give her seat up on its last frame
      // there, and be set down on the first frame it is moving again.
      let station: Station | null = null;
      let nearest = Infinity;
      for (const candidate of this.stations) {
        const gap = Math.hypot(candidate.standX - this.seatWorld.x, candidate.standZ - this.seatWorld.z);
        if (gap < nearest) {
          nearest = gap;
          station = candidate;
        }
      }
      if (!station) continue;
      this.route.pointAt(station.distance, this.point);
      character.setCarriedPose(this.seatWorld.x + station.standX - this.point.x, this.seatWorld.z + station.standZ - this.point.z);
    }
    for (const character of characters) {
      const seatNumber = (character.driver as Partial<TrainPassenger>).trainSeat;
      if (seatNumber === null || seatNumber === undefined) continue;
      const seat = this.seats[seatNumber];
      if (!seat || seat.taken !== 'npc') continue;
      this.aboard.set(character, seatNumber);

      // Feet on the carriage floor — same reference as the player's, since
      // she now sits too (see `updateRider`). `NpcCharacter.animate` reads
      // back "was I carried this frame" and folds the ride's own seated pose
      // onto whoever `setCarriedPose` touches below, so the visual sit and
      // the clearance this height is measured against (train/clearance.ts)
      // are the same fact, not two.
      this.seatPosition(seat, 0, character.position.y);
      // Hands the child to the ride for this frame — see
      // `NpcCharacter.setCarriedPose`. Writing x/z here and letting their own
      // `move()` run anyway is what made riders vibrate: the seat is on the
      // track, so `collision.resolve` shoved them off the train every frame,
      // and the resolved-position velocity rewrite banked the shove as speed.
      character.setCarriedPose(this.seatWorld.x, this.seatWorld.z);
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
      if (i === PLAYER_SEAT || i === COMPANION_SEAT) continue;
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

  wayOff(x: number, z: number, radius: number): { readonly x: number; readonly z: number } {
    const at = this.route.distanceNear(x, z);
    this.route.pointAt(at, this.point);
    this.route.tangentAt(at, this.tangent);
    // Square off the line, out past its fence, on either side; the side she
    // is on first.
    const acrossX = this.tangent.z;
    const acrossZ = -this.tangent.x;
    const onSide = (x - this.point.x) * acrossX + (z - this.point.z) * acrossZ >= 0 ? 1 : -1;
    const out = FENCE_OFFSET + FENCE_HALF_THICKNESS + radius + 0.3;
    for (const side of [onSide, -onSide]) {
      const ox = this.point.x + acrossX * side * out;
      const oz = this.point.z + acrossZ * side * out;
      const y = terrainHeight(ox, oz);
      if (this.collision.isClearCircle(ox, oz, radius) && this.collision.clearOfBoundary(ox, oz, radius) && !this.onTheLine(ox, y, oz, radius)) return { x: ox, z: oz };
    }
    // Hemmed in either side: the nearest platform's waiting spot.
    let best = { x: this.stations[0]?.waitX ?? x, z: this.stations[0]?.waitZ ?? z };
    let nearest = Infinity;
    for (const station of this.stations) {
      const gap = Math.hypot(station.waitX - x, station.waitZ - z);
      if (gap < nearest) {
        nearest = gap;
        best = { x: station.waitX, z: station.waitZ };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- internals

  /** Speed, braking and the wait at each station — and a stop for anyone on the line ahead ({@link keepClearOf}). */
  private drive(dt: number): void {
    const way = this.wayAhead();
    if (Number.isFinite(way)) {
      this.clearFor = 0;
    } else {
      this.clearFor += dt;
      if (this.clearFor >= TOOT_REARM_SECONDS) this.tooted = false;
    }
    this.sinceToot += dt;
    if (this.dwellRemaining > 0) {
      this.dwellRemaining -= dt;
      if (this.dwellRemaining > 0) return;
      // Doors closing: off it goes, as soon as the line ahead lets it — and
      // until it actually moves it is still standing at this platform, where
      // she may get on and off ({@link stoppedStop}, cleared below).
    }

    const target = this.stations[this.nextStop];
    if (!target) return;

    const stopDistance = this.route.wrap(target.distance + this.stopOffset);
    const remaining = this.route.forwardGap(this.distance, stopDistance);

    // v² = 2·a·s, solved for the speed a stop is still reachable from. Below a
    // metre out, creep in rather than crawling asymptotically towards it.
    const approach = Math.sqrt(2 * BRAKING * Math.max(0, remaining));
    const cruising = Math.min(CRUISE_SPEED, this.speed + ACCELERATION * dt);
    const forTheStation = Math.max(0.35, Math.min(cruising, approach));
    // Someone on the line ahead: stand short of them, and toot — and toot
    // again every few seconds for as long as they stay: the driver keeps
    // asking, and waits.
    const forTheLine = Number.isFinite(way) ? this.speedFor(way, dt) : Infinity;
    if (forTheLine < forTheStation && (!this.tooted || this.sinceToot >= TOOT_AGAIN_SECONDS)) {
      this.tooted = true;
      this.sinceToot = 0;
      playTrainWhistle();
    }
    this.speed = Math.min(forTheStation, forTheLine);
    // Standing still — at a platform, still standing at it: "Get on" and
    // "Get off" stay on offer however long it waits there.
    if (this.speed <= 0) return;

    // Moving: if it was standing at a platform, it has left it now.
    if (this.stoppedStop !== null) {
      this.stoppedStop = null;
      this.boardingLocked = false;
      playTrainWhistle();
    }

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
      // **Lean with the sleepers.** `track.ts:123` stands every sleeper through
      // `placeOnSphere`, so the drawn railway lies on the sphere; the carriages
      // were left upright on it. Only the orientation needs the map here — a
      // train runs *on* the ground, so `pointAt` already returns a point at
      // `terrainHeight` and `placeOnSphere` would move it by zero.
      //
      // Pitch stays 0, which is what it has always been: these cars do not tip
      // with the gradient today, and giving them that is a separate change with
      // its own look to judge.
      rideFrame(this.point, Math.atan2(this.tangent.x, this.tangent.z), 0, car.root.quaternion);

      // Wheels roll off distance travelled, so they never skate.
      for (const wheel of car.wheels) wheel.rotation.x = this.wheelSpin / 0.2;
    }
    this.moveBodies();
  }

  /**
   * Every car's solid pieces to where the car now is — leant, turned and
   * lifted exactly as its meshes are, by asking the car's own matrix where each
   * piece's middle, top and base are.
   */
  private moveBodies(): void {
    for (const body of this.bodies) {
      const root = body.car.root;
      root.updateMatrixWorld();
      // The collision world's yaw takes a box's local X onto the world, as
      // `atan2(z, x)` measures it; a car's local X is its width.
      const yaw = -planYawOf(root);
      for (let i = 0; i < body.pieces.length; i += 1) {
        const piece = body.pieces[i]!;
        const box = body.boxes[i]!;
        root.localToWorld(_pieceAt.set(piece.x, 0, piece.z));
        root.localToWorld(_pieceTop.set(piece.x, piece.top, piece.z));
        root.localToWorld(_pieceBase.set(piece.x, PIECE_BASE, piece.z));
        this.collision.moveBox(box, _pieceAt.x, _pieceAt.z, yaw, _pieceTop.y, _pieceBase.y);
      }
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
    // **Ask three.js where the seat is, rather than re-deriving it.**
    //
    // This used to hand-roll the carriage's yaw (`local.x * cos + local.z * sin`
    // …) and add the floor height straight up world `+Y`. Both stopped being
    // true when the carriages began leaning with the railway: the hand-rolled
    // rotation is a yaw only, so it cannot express the lean, and `+Y` is not the
    // carriage floor's up any more. A seat is a fixed point in the carriage, and
    // `localToWorld` is the transform that already knows where the carriage is —
    // it is the same "one owner" rule as everywhere else, applied to a matrix
    // three.js is maintaining for us regardless.
    car.root.updateMatrixWorld();
    this.seatWorld.set(local.x, CAR_FLOOR_Y + lift, local.z);
    car.root.localToWorld(this.seatWorld);
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
      // `SEAT_Y`, plainly. This read `SEAT_Y - CAR_FLOOR_Y + CAR_FLOOR_Y`.
      this.seatMount.position.set(local.x, SEAT_Y, local.z);
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
      //
      // Feet on the carriage floor, same as an NPC rider — not on the bench
      // top. `SEAT_Y - CAR_FLOOR_Y` used to be handed here as the lift,
      // planting her feet on the bench and making her the tallest thing on
      // the train by the width of the bench (train/clearance.ts's own
      // finding). She is seated (`Player.ridePosture` defaults to `'seated'`
      // from `beginRide`, so `applyRidePose` already folds her for it); a
      // seated child's feet rest on the floor, not the seat.
      this.seatPosition(seat, 0, player.position.y);
      const car = this.carriages[seat.car];
      player.setRidePose(
        this.seatWorld.x,
        this.seatWorld.y,
        this.seatWorld.z,
        car ? planYawOf(car.root) : 0,
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
   * "Let me off." A hop — the accelerator for the "Get off" chip, for a player
   * whose hands are already on the keyboard.
   *
   * The interact key is deliberately *not* read here. It arrives through the
   * platform zone's own "Get off" action instead (see {@link stationActions},
   * and `selectableWhileRiding`), which is what makes E mean exactly what the
   * chip in front of her says — GitHub issue #122. `jump` stays because it has
   * no chip and means the same thing everywhere.
   *
   * **Walking is no longer a way off**, and that is the point of the SELECTION
   * RULE: a child who turned to look at the park found herself standing on the
   * platform watching the train leave. The chip is the way out, it is on screen
   * over the platform the whole time the train is stopped, and it is pressable
   * with a finger — which is what the movement clause was really there for.
   */
  private wantsOff(context: FrameContext, _lookDragging: boolean): boolean {
    return context.input.justPressed('jump');
  }

  private alight(player: Player): void {
    const seat = this.seats[PLAYER_SEAT];
    if (seat) seat.taken = null;
    this.playerRiding = false;
    // Locked until the train pulls out, so stepping off and standing there does
    // not put you straight back on.
    this.boardingLocked = true;

    // At the platform it is standing at — or, let go mid-journey (see
    // `holder`), the next one along.
    const station = this.stations[this.stoppedStop ?? this.nextStop] ?? null;
    // The platform stand is already a genuine exit — `train/plan.ts` solves it
    // clear of every plot before the platform is ever built — and `endRide`'s
    // put-down rule (`world/dismount.ts`) still checks it: the universal rule
    // is "every dismount goes through here", not "every dismount that is
    // currently known to need it".
    player.endRide(
      station
        ? {
            x: station.standX,
            y: station.surfaceY,
            z: station.standZ,
            facing: Math.atan2(-station.standX, -station.standZ),
          }
        : { x: player.position.x, y: player.position.y, z: player.position.z },
    );
    this.onRideChange?.(false);
  }

  // ------------------------------------------------------------- the trimmings

  private updateEffects(context: FrameContext): void {
    const { dt, playerPosition } = context;

    // --- chuffs and smoke ----------------------------------------------------
    if (this.chuffCarry >= CHUFF_INTERVAL) {
      this.chuffCarry -= CHUFF_INTERVAL;
      // The funnel tip is a fixed point on the locomotive, so ask the
      // locomotive where it is now. The hand-rolled yaw this replaces could
      // only express a turn, never the lean the engine now carries.
      const local = this.locomotive.funnelTip;
      this.locomotive.root.updateMatrixWorld();
      _funnel.set(local.x, local.y, local.z);
      this.locomotive.root.localToWorld(_funnel);
      this.puffs.emit(_funnel.x, _funnel.y, _funnel.z);
      playChuff(clamp01(this.speed / CRUISE_SPEED));
    }
    this.puffs.update(dt);

    // --- how loud is any of this? -------------------------------------------
    const toPlayer = Math.hypot(
      this.locomotive.root.position.x - playerPosition.x,
      this.locomotive.root.position.z - playerPosition.z,
    );
    setTrainAudioCarry(Math.pow(clamp01(1 - toPlayer / AUDIBLE_RANGE), 1.5));

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
      const yaw = planYawOf(carriage.root);
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const along = dx * sin + dz * cos;
      const across = dx * cos - dz * sin;
      return Math.abs(along) <= halfLength && Math.abs(across) <= halfWidth;
    },
  };
}
