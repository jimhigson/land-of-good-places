import {
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  TubeGeometry,
  Vector3,
} from 'three';
import { CoasterRoute, checkCoasterClearances, STATION_HEIGHT } from './route';
import type { PlannedCoaster } from './plan';
import { RideCamera } from '../../core/RideCamera';
import { toonMaterial } from '../../art/style/materials';
import { addOutline } from '../../art/style/materials';
import { PALETTE } from '../../core/palette';
import { terrainHeight } from '../terrain';
import { distanceToPath } from '../paths';
import { PARK_LAYOUT } from '../parkLayout';
import type { CollisionWorld } from '../Collision';
import { resolveDismount } from '../dismount';
import { PLAYER_RADIUS } from '../../core/constants';
import type { FrameContext, GameSystem } from '../../core/types';
import type { Player } from '../../entities/Player';
import type { ParkTrain } from '../train';
import { buildBarriers } from './barriers';
import { createConfetti, type Confetti } from '../../minigames/railRacer/confetti';
import { createKid, type KidHandle } from '../../art/models/kid';
import { discoverSecret } from '../../state/secrets';

/**
 * The rollercoaster — the rail racer grown up (Decision 4 C4/C5).
 *
 * The 2D mini-scene is retired: the rail racer's stall is now the way onto a
 * real elevated ride in the real park, on a track the solver grew
 * (`coaster/route.ts`), ridden in first person through the same shared
 * {@link RideCamera} as the ferris wheel and the train — with the coaster's
 * one difference, a ±120° yaw limit, so a child looks *along* the ride the
 * way the real thing insists you do.
 *
 * The cart is honest, gentle physics: a chain lift to the first crest, then
 * energy trade the rest of the way round, braked into the station. You
 * cannot fall out, fall off, or lose — this is still Land of Good Places.
 */

const CHAIN_SPEED = 3.4;
const MIN_SPEED = 4.2;
const MAX_SPEED = 15;
const STATION_SPEED = 2.6;
const GRAVITY = 6.5; // gentler than earth; a cosy park has cosy physics
const EYE = { x: 0, y: 0.95, z: 0 };

// --- the race's framing ------------------------------------------------------

/** How many times round before the finish. Two is about 45 seconds of racing. */
const RACE_LAPS = 2;

/** Seconds of 3-2-1 before the carts are let go. */
const COUNTDOWN_SECONDS = 3;

/** How long a countdown digit (or "GO!") stays on screen. */
const COUNT_HOLD = 0.9;

/** How long the win/lose card stays up before she is set down at the booth. */
const RESULT_SECONDS = 4.5;

/** The rival's pace with nobody to chase, in m/s. */
const RIVAL_BASE_SPEED = 9.5;

/**
 * How hard the rival rubber-bands, and how far it will go.
 *
 * A metre of lead moves the rival's target speed by `RIVAL_CATCHUP`, clamped
 * to ±`RIVAL_SWING`. The point is that the race is *always* close: a child who
 * holds the whole way is chased hard, and a child who never holds at all is
 * waited for rather than lapped and left. Neither end of that is a punishment.
 */
const RIVAL_CATCHUP = 0.12;
const RIVAL_SWING = 3.2;

/** How long the rival child waves after an overtake, either way. */
const WAVE_SECONDS = 1.9;

/** The Cute-o-dex deed for winning. Registered in `state/secrets.ts`. */
const RACE_SECRET = 'secret.railRace';

/**
 * What the race wants said on screen, for whoever is holding the DOM.
 *
 * `Coaster` lives in `World` and has no business knowing about `uiRoot`; the
 * train's `onRideChange` set the precedent and this is the same shape. `Game`
 * wires it to `ui/RaceHud.ts`.
 */
export type RaceMoment =
  | { readonly kind: 'start' }
  /** A countdown digit, "GO!", or `null` to clear it. */
  | { readonly kind: 'count'; readonly text: string | null }
  | { readonly kind: 'lap'; readonly lap: number; readonly of: number }
  | { readonly kind: 'result'; readonly won: boolean }
  | { readonly kind: 'end' };

export interface CoasterOptions {
  /**
   * The solved plan (`coaster/plan.ts`) — route, station stall and exit
   * point, all decided before any scene object exists. `Coaster` builds what
   * was planned; it no longer solves its own route.
   */
  readonly plan: PlannedCoaster;
  /**
   * 'firstPerson': the eye in her head, model hidden (the Sky Cruiser).
   * 'chase': the camera just behind and above her head, model visible —
   * the Rail Race, where seeing her duck is the game.
   */
  readonly camera: 'firstPerson' | 'chase';
  /** The Rail Race: hold to accelerate, release to duck under barriers. */
  readonly race?: boolean;
}

export class Coaster implements GameSystem {
  readonly name: string;
  /** True when the camera style leaves her model on screen. */
  readonly playerStaysVisible: boolean;
  readonly group = new Group();
  readonly route: CoasterRoute;

  rideView: RideCamera | null = null;
  onRideChange: ((riding: boolean) => void) | null = null;
  /** The race's on-screen framing. Wired by `Game` to `ui/RaceHud.ts`. */
  onRaceMoment: ((moment: RaceMoment) => void) | null = null;
  /**
   * "Is a finger down on the race pad?"
   *
   * Read *alongside* the keyboard, never instead of it. It exists because
   * `Game.screenIsBusy()` hides the touch controls while a ride has hold of
   * you — correct for the train and the Sky Cruiser, and fatal here, where
   * holding is the whole game and the hop button is the only thing bound to
   * `jump` that a finger can reach. See `ui/RaceHud.ts`.
   */
  raceHold: (() => boolean) | null = null;

  private readonly cart: Group;
  /** The seat: +Z along the direction of travel, like every model in the park. */
  private readonly cartMount: Group;
  /** The seat, turned to face the camera's convention. See the constructor. */
  private readonly eyeMount: Group;
  /** Kept for {@link arrive}'s dismount safety net — see `world/dismount.ts`. */
  private readonly collision: CollisionWorld;
  private player: Player | null = null;
  private riding = false;
  private distance: number;
  private speed = 0;
  private phase: 'waiting' | 'chain' | 'coasting' | 'braking' | 'countdown' | 'racing' | 'finishing' =
    'waiting';
  private readonly point = new Vector3();
  private readonly tangent = new Vector3();
  private crestDistance = 0;

  // --- the race (options.race) -------------------------------------------
  /** Distances along the loop of the duck-under barriers. */
  readonly barrierDistances: number[] = [];
  private ducking = false;
  private bonkWobble = 0;
  /** The rival's cart: same loop, the parallel track's offset. */
  private rivalCart: Group | null = null;
  /** The child aboard it. Null in a headless park — see {@link buildRace}. */
  private rivalKid: KidHandle | null = null;
  private rivalDistance = 0;
  private rivalSpeed = 0;
  /**
   * Metres run since the lights went out, for both carts.
   *
   * The race counts *travelled distance*, not laps spotted by watching a
   * position wrap past the station. Wrap-spotting needs a guard band, gets it
   * wrong when a cart is slow enough to sit on the line for two frames, and
   * has no answer at all to "who is ahead" once the two carts are a lap apart.
   * An accumulator has none of those problems: the lap is a division, the
   * finish is a comparison, and who is winning is a subtraction.
   */
  private travelled = 0;
  private rivalTravelled = 0;
  private lap = 0;
  private countdown = 0;
  /** Ticks the current countdown digit off the screen. */
  private countHold = 0;
  private resultTimer = 0;
  /** Signed lead in metres last frame, so an overtake is a change of sign. */
  private lastLead = 0;
  /** Seconds of waving left on the rival child. */
  private rivalWave = 0;
  private confetti: Confetti | null = null;

  private readonly options: CoasterOptions;

  constructor(collision: CollisionWorld, train: ParkTrain, options: CoasterOptions) {
    this.options = options;
    this.collision = collision;
    this.name = options.plan.name;
    this.playerStaysVisible = options.camera === 'chase';
    this.group.name = options.plan.name;
    // Solved already, at module load (`coaster/plan.ts`) — built here, not
    // re-solved. Mirrors `ParkTrain` taking `TRAIN_PLAN.route` as given.
    this.route = options.plan.route;
    this.distance = this.route.stationDistance;

    // Boot assert, in the claim-versus-fact tradition: report loudly and
    // refuse to pretend, never quietly adjust.
    const complaints = checkCoasterClearances(this.route, (x, z) => {
      const d = train.route.distanceNear(x, z);
      const p = train.route.pointAt(d, new Vector3());
      return { y: p.y, distance: Math.hypot(p.x - x, p.z - z) };
    });
    for (const complaint of complaints) console.warn(`${options.plan.name}: ${complaint}`);

    this.buildTrack(collision);
    if (options.race) this.buildRace();

    // Find the highest crest's distance, for the chain phase.
    let bestY = -Infinity;
    for (let d = 0; d < this.route.length; d += 1) {
      const y = this.route.pointAt(d, this.point).y;
      if (y > bestY) {
        bestY = y;
        this.crestDistance = d;
      }
    }

    // --- the cart ---------------------------------------------------------
    this.cart = new Group();
    const body = toonBox(1.5, 0.7, 2.2, PALETTE.markerPink);
    body.position.y = 0.35;
    // The cart's own body casts — one more draw call, and it is the shadow the
    // eye actually follows round the loop. The nose does not: it is inside the
    // body's silhouette from every angle the fixed camera can see.
    body.castShadow = true;
    this.cart.add(body);
    const nose = toonBox(1.1, 0.4, 0.5, PALETTE.markerLemon);
    nose.position.set(0, 0.35, 1.3);
    this.cart.add(nose);
    this.cartMount = new Group();
    this.cartMount.position.set(0, 0.6, 0);
    this.cart.add(this.cartMount);

    // The eye's own mount, turned half a turn — and the reason the ride used
    // to look backwards (family report, 28 July).
    //
    // Everything modelled in this park faces **+Z** (ASSET_MANIFEST), and
    // `placeCart` duly sets `cart.rotation.y = atan2(tangent.x, tangent.z)`,
    // which points the cart's +Z along the direction of travel. But a three.js
    // `PerspectiveCamera` looks down its own local **−Z**. Bolt an unrotated
    // camera into a seat whose +Z is forward and it faces the way you have just
    // come — measured at `dot(cameraForward, travel) = -1.000`, not guessed.
    //
    // The flip belongs here rather than in `core/RideCamera.ts` (which is
    // parity-gated by `npm run check:ride-camera` and must not learn about it)
    // and rather than on `cartMount` itself, which is the *seat*: the rider's
    // pose hangs off that, and it should keep meaning what every other mount in
    // the park means. So the eye gets a child of its own, and camera offsets
    // below are written in camera terms — +Z is behind the cart.
    this.eyeMount = new Group();
    this.eyeMount.rotation.y = Math.PI;
    this.cartMount.add(this.eyeMount);
    this.group.add(this.cart);
    this.placeCart();
  }

  /** Lazily, as the train does: the headless park has no player and no DOM. */
  attachPlayer(player: Player): void {
    this.player = player;
    if (this.options.camera === 'firstPerson') {
      this.rideView = new RideCamera({ yawLimit: 2.1, startPitch: -0.06 });
      this.rideView.mountOn(this.eyeMount, EYE);
    } else {
      // The chase view: the same shared camera, mounted behind and above the
      // seat, looking along the track with only a little look-around — the
      // point of this view is watching her duck, not steering the eye.
      //
      // `z` is **positive** because `eyeMount` faces the camera's way round:
      // +Z here is behind the cart, which is where a chase camera goes.
      this.rideView = new RideCamera({ yawLimit: 0.55, startPitch: -0.14, fov: 60 });
      this.rideView.mountOn(this.eyeMount, { x: 0, y: 2.1, z: 3.4 });
    }
  }

  /** The stall's interact press lands here instead of opening the 2D game. */
  requestBoard(): boolean {
    if (this.riding || !this.player || this.phase !== 'waiting') return false;
    this.riding = true;
    this.player.beginRide();
    this.onRideChange?.(true);

    if (this.options.race) {
      // Both carts back to the line, and the lights come on. Nothing moves
      // until the countdown runs out — a race that has already started when
      // the camera arrives is a race a six-year-old has already lost.
      this.phase = 'countdown';
      this.speed = 0;
      this.travelled = 0;
      this.rivalTravelled = 0;
      this.rivalSpeed = 0;
      this.lastLead = 0;
      this.rivalWave = 0;
      this.lap = 1;
      this.countdown = COUNTDOWN_SECONDS;
      this.distance = this.route.stationDistance;
      this.rivalDistance = this.route.stationDistance;
      this.placeRival();
      this.onRaceMoment?.({ kind: 'start' });
      this.emitCount(String(COUNTDOWN_SECONDS));
      return true;
    }

    this.phase = 'chain';
    this.speed = CHAIN_SPEED;
    // Inside the interact press, where the phone-tilt look needs to be armed:
    // it takes "forward" from here, and iOS only grants the sensors from a
    // gesture. No-op on desktop, and harmless if it is refused.
    this.rideView?.board();
    return true;
  }

  update(context: FrameContext): void {
    const { dt } = context;

    if (this.options.race && this.phase !== 'waiting') {
      this.updateRace(context);
    } else if (this.phase !== 'waiting') {
      const height = this.route.pointAt(this.distance, this.point).y;
      const crestHeight = this.route.pointAt(this.crestDistance, this.point).y;
      if (this.phase === 'chain') {
        this.speed = CHAIN_SPEED;
        const pastCrest =
          this.route.wrap(this.distance - this.route.stationDistance) >
          this.route.wrap(this.crestDistance - this.route.stationDistance);
        if (pastCrest) this.phase = 'coasting';
      } else if (this.phase === 'coasting') {
        const drop = Math.max(0, crestHeight - height);
        this.speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.sqrt(2 * GRAVITY * drop + CHAIN_SPEED ** 2)));
        const toStation = this.route.wrap(this.route.stationDistance - this.distance);
        if (toStation < 24) this.phase = 'braking';
      } else {
        const toStation = this.route.wrap(this.route.stationDistance - this.distance);
        this.speed = Math.max(STATION_SPEED, this.speed - 9 * dt);
        if (toStation < 0.6 || toStation > this.route.length - 5) {
          this.arrive();
        }
      }
      this.distance = this.route.wrap(this.distance + this.speed * dt);
    }

    this.placeCart();
    // Paper keeps falling after the race is over and after she has been set
    // down, so it is ticked outside every phase test.
    this.confetti?.update(dt);

    if (this.riding && this.player) {
      this.rideView?.update(dt, context.elapsed);
      const seat = this.cartMount.getWorldPosition(this.point);
      // Ducking reads from behind: she drops into the cart. The wobble after
      // a bonk shakes the seat a little, cosy not punishing.
      const duckDrop = this.options.race && this.ducking ? 0.52 : 0;
      const wobble = this.bonkWobble > 0 ? Math.sin(this.bonkWobble * 34) * 0.08 * this.bonkWobble : 0;
      this.player.setRidePose(
        seat.x + wobble,
        seat.y - 0.55 - duckDrop,
        seat.z,
        this.cart.rotation.y,
      );
    }
  }

  // ------------------------------------------------------------- the race

  /**
   * The race, frame by frame: 3-2-1, two laps, a finish and a card.
   *
   * Split out of {@link update} because the passive ride and the race share a
   * cart and a track and nothing else — one is a chain lift and gravity, the
   * other is a child holding a button.
   */
  private updateRace(context: FrameContext): void {
    const { dt } = context;
    const finishLine = this.route.length * RACE_LAPS;

    // The countdown digit ticks off the screen on its own clock, so it keeps
    // running through the change from counting down to racing — "GO!" is
    // raised as the carts are let go and clears a beat later.
    if (this.countHold > 0) {
      this.countHold -= dt;
      if (this.countHold <= 0) this.onRaceMoment?.({ kind: 'count', text: null });
    }

    if (this.phase === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (now !== before && now >= 1) this.emitCount(String(now));
      if (this.countdown <= 0) {
        this.phase = 'racing';
        this.speed = MIN_SPEED;
        this.emitCount('GO!');
        this.onRaceMoment?.({ kind: 'lap', lap: 1, of: RACE_LAPS });
      }
      this.updateRival(dt, context.elapsed);
      return;
    }

    if (this.phase === 'racing') {
      // The old racer's one button, on real rails: HOLD to go fast, RELEASE
      // to duck. Not holding while passing under a barrier is enough to
      // clear it (the family's rule); a bonk is a wobble and lost speed.
      const input = context.input;
      const holding =
        input.isDown('jump') || input.isDown('interact') || this.raceHold?.() === true;
      this.ducking = !holding;
      const target = holding ? MAX_SPEED * 0.9 : MIN_SPEED * 0.9;
      this.speed += (target - this.speed) * Math.min(1, 3.2 * dt);
      for (const barrier of this.barrierDistances) {
        const gap = Math.abs(
          this.route.wrap(this.distance - barrier + this.route.length / 2) - this.route.length / 2,
        );
        if (gap < 0.9 && !this.ducking && this.bonkWobble <= 0) {
          this.speed = Math.max(2.5, this.speed * 0.35);
          this.bonkWobble = 1.1;
        }
      }
      this.bonkWobble = Math.max(0, this.bonkWobble - dt);

      this.travelled += this.speed * dt;
      this.distance = this.route.wrap(this.route.stationDistance + this.travelled);

      const lap = Math.min(RACE_LAPS, Math.floor(this.travelled / this.route.length) + 1);
      if (lap !== this.lap) {
        this.lap = lap;
        this.onRaceMoment?.({ kind: 'lap', lap, of: RACE_LAPS });
      }

      this.updateRival(dt, context.elapsed, finishLine);

      if (this.travelled >= finishLine) this.finishRace();
      return;
    }

    // 'finishing': the card is up, the cart rolls gently to a stop, and the
    // confetti (if she won) falls. She is set down at the booth when the card
    // has had its moment — never yanked out from under a celebration.
    this.resultTimer -= dt;
    this.speed = Math.max(STATION_SPEED, this.speed - 6 * dt);
    this.travelled += this.speed * dt;
    this.distance = this.route.wrap(this.route.stationDistance + this.travelled);
    this.ducking = false;
    this.bonkWobble = Math.max(0, this.bonkWobble - dt);
    this.updateRival(dt, context.elapsed);
    if (this.resultTimer <= 0) {
      this.onRaceMoment?.({ kind: 'end' });
      this.arrive();
    }
  }

  /** Raises a countdown digit and starts its clock. */
  private emitCount(text: string): void {
    this.onRaceMoment?.({ kind: 'count', text });
    this.countHold = COUNT_HOLD;
  }

  /**
   * Crossing the line on the final lap.
   *
   * Won if the rival has not finished yet. Winning is a Cute-o-dex deed and a
   * shower of paper; losing is a card that says "so close!" and asks her to go
   * again, because this is Land of Good Places and being told you lost is how
   * a six-year-old learns to stop pressing the thing.
   */
  private finishRace(): void {
    this.phase = 'finishing';
    this.resultTimer = RESULT_SECONDS;
    const won = this.rivalTravelled < this.route.length * RACE_LAPS;
    this.onRaceMoment?.({ kind: 'result', won });
    if (won) {
      discoverSecret(RACE_SECRET);
      this.confetti?.burst(this.cart.position.x, this.cart.position.y + 1.6, this.cart.position.z, 90, 1.2);
      this.confetti?.burst(this.cart.position.x, this.cart.position.y + 2.2, this.cart.position.z, 60, 0.9);
    }
    this.rivalKid?.setExpression(won ? 'surprised' : 'happy');
  }

  /**
   * The rival: where its cart is, how fast, and what the child in it is doing.
   *
   * Rubber-banded on purpose (see {@link RIVAL_CATCHUP}) so the race is always
   * close in both directions. `finishLine` is passed only while racing — once
   * the race is over the rival simply coasts, and clamping it to the line then
   * would make it stop dead in mid-air.
   */
  private updateRival(dt: number, elapsed: number, finishLine?: number): void {
    if (this.phase !== 'countdown') {
      const lead = this.travelled - this.rivalTravelled;
      const target =
        RIVAL_BASE_SPEED + Math.max(-RIVAL_SWING, Math.min(RIVAL_SWING, lead * RIVAL_CATCHUP));
      this.rivalSpeed += (target - this.rivalSpeed) * Math.min(1, 1.6 * dt);
      this.rivalTravelled += this.rivalSpeed * dt;
      if (finishLine !== undefined) this.rivalTravelled = Math.min(finishLine, this.rivalTravelled);
      this.rivalDistance = this.route.wrap(this.route.stationDistance + this.rivalTravelled);

      // An overtake, either way, is a change in the sign of the lead. The
      // dead band stops two carts running level from waving continuously.
      if (Math.sign(lead) !== Math.sign(this.lastLead) && Math.abs(lead) > 0.6) {
        this.rivalWave = WAVE_SECONDS;
      }
      this.lastLead = lead;
    }

    this.placeRival();
    this.poseRivalKid(dt, elapsed);
  }

  private placeRival(): void {
    if (!this.rivalCart) return;
    this.route.pointAt(this.rivalDistance, this.point);
    this.route.tangentAt(this.rivalDistance, this.tangent);
    // The parallel track: a cart-width to the side of the solved centre line.
    const sideX = this.tangent.z;
    const sideZ = -this.tangent.x;
    this.rivalCart.position.set(this.point.x + sideX * 1.9, this.point.y, this.point.z + sideZ * 1.9);
    this.rivalCart.rotation.y = Math.atan2(this.tangent.x, this.tangent.z);
    this.rivalCart.rotation.x = -Math.asin(
      Math.max(-0.6, Math.min(0.6, this.tangent.y)),
    );
  }

  /**
   * The child in the other cart.
   *
   * She is the reason the rival is a rival rather than a moving box: she sits
   * up in her seat, and when one cart passes the other she turns and **waves**
   * — which is the entire personality brief. Being waved at by the child you
   * have just overtaken is friendlier than a lap counter, and being waved at by
   * the one who has just overtaken *you* takes the sting out of it.
   */
  private poseRivalKid(dt: number, elapsed: number): void {
    const kid = this.rivalKid;
    if (!kid) return;
    kid.update(dt);
    const limbs = kid.limbs;
    if (this.rivalWave > 0) {
      this.rivalWave -= dt;
      // Arm up and flapping. `rotation.x` is what raises an arm on this rig —
      // the same numbers `minigames/railRacer/racer.ts` cheers with.
      const flap = Math.sin(elapsed * 13) * 0.28;
      limbs.rightArm.rotation.x = -2.5 + flap;
      limbs.rightArm.rotation.z = -0.55;
      limbs.leftArm.rotation.x = -1.1;
      limbs.leftArm.rotation.z = 0.2;
      // Turned to look across at the other cart while she waves.
      kid.head.rotation.y = -0.5;
      if (this.rivalWave <= 0) kid.head.rotation.y = 0;
    } else {
      // Hands on the rail, leaning into it.
      limbs.rightArm.rotation.x = -1.2;
      limbs.rightArm.rotation.z = -0.2;
      limbs.leftArm.rotation.x = -1.2;
      limbs.leftArm.rotation.z = 0.2;
      kid.head.rotation.y = 0;
    }
  }

  /** The race's furniture: the dressed barriers, and the rival and her cart. */
  private buildRace(): void {
    const rng = (seed => () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)(
      this.route.length | 0,
    );
    let d = this.route.stationDistance + 30;
    while (d < this.route.stationDistance + this.route.length - 34) {
      this.barrierDistances.push(this.route.wrap(d));
      d += 22 + rng() * 18;
    }
    this.group.add(buildBarriers(this.route, this.barrierDistances));

    this.rivalCart = new Group();
    const body = toonBox(1.5, 0.7, 2.2, PALETTE.markerSky);
    body.position.y = 0.35;
    body.castShadow = true;
    this.rivalCart.add(body);
    const nose = toonBox(1.1, 0.4, 0.5, PALETTE.markerMint);
    nose.position.set(0, 0.35, 1.3);
    this.rivalCart.add(nose);

    // The child aboard. Seated at the same height off the cart floor as the
    // player is put by `setRidePose`, so the two riders read as the same size
    // doing the same thing — which is what makes it a race.
    const kid = createKid({ outfit: PALETTE.markerLemon, hairStyle: 'short' });
    kid.root.position.y = 0.05;
    kid.setExpression('happy');
    this.rivalCart.add(kid.root);
    this.rivalKid = kid;

    this.group.add(this.rivalCart);
    this.rivalDistance = this.route.stationDistance;
    this.placeRival();

    // Confetti for the finish. Lives on the coaster's own group so it falls
    // where the cart is, in the park, rather than in a mini-game's scene.
    this.confetti = createConfetti();
    this.group.add(this.confetti.root);
  }

  private arrive(): void {
    this.phase = 'waiting';
    this.distance = this.route.stationDistance;
    this.speed = 0;
    if (this.riding && this.player) {
      this.riding = false;
      // The planned exit (`coaster/plan.ts`) — beside the station, clear of
      // every plot blocker — with the runtime safety net on top (see
      // `world/dismount.ts`): this used to put a rider 40% of the way from
      // the booth's own centre towards its doormat, which is still inside
      // the booth's four walls and trapped her there for good.
      const { x, z } = resolveDismount(
        this.collision,
        this.options.plan.exitX,
        this.options.plan.exitZ,
        PLAYER_RADIUS,
      );
      this.player.setRidePose(x, terrainHeight(x, z), z, 0);
      this.player.endRide();
      this.onRideChange?.(false);
    }
  }

  private placeCart(): void {
    this.route.pointAt(this.distance, this.point);
    this.route.tangentAt(this.distance, this.tangent);
    this.cart.position.copy(this.point);
    this.cart.rotation.y = Math.atan2(this.tangent.x, this.tangent.z);
    // Pitch with the track, gently — the mount (and so the rider's eye and
    // the cart's nose) follows the hill it is on.
    this.cart.rotation.x = -Math.asin(Math.max(-0.6, Math.min(0.6, this.tangent.y)));
  }

  private buildTrack(collision: CollisionWorld): void {
    const railMaterial = toonMaterial(PALETTE.markerPink);
    const tieMaterial = toonMaterial(PALETTE.woodLight);
    const pylonMaterial = toonMaterial(PALETTE.stonePinkLight);

    const step = 1.4;
    const segments = Math.ceil(this.route.length / step);
    const railGauge = 0.55;
    // The rails are **swept**, not chopped (family note, 28 July): a rail built
    // from one straight box per 1.4 m read as a row of disjointed sticks
    // wherever the loop bends, which on a coaster is most of it. Two closed
    // curves — the solved centre line offset left and right — tubed along their
    // whole length instead, so a bend is a bend.
    //
    // A circular cross-section is why this can be a plain `TubeGeometry`: the
    // Frenet frame `TubeGeometry` builds may twist along a curve with torsion,
    // and on a tube of circular section that twist is invisible. Two draw calls
    // per coaster, and the ties and pylons stay instanced.
    const railGeometries = [1, -1].map((sideSign) => {
      const points: Vector3[] = [];
      const centre = new Vector3();
      const along = new Vector3();
      for (let i = 0; i < segments; i += 1) {
        const d = i * step;
        this.route.pointAt(d, centre);
        this.route.tangentAt(d, along);
        // Sideways in the ground plane: the track has no banking, so "left of
        // the rail" is the horizontal normal, not a rolled one.
        const sideX = along.z;
        const sideZ = -along.x;
        const norm = Math.hypot(sideX, sideZ) || 1;
        points.push(
          new Vector3(
            centre.x + (sideX / norm) * sideSign * railGauge,
            centre.y,
            centre.z + (sideZ / norm) * sideSign * railGauge,
          ),
        );
      }
      const railCurve = new CatmullRomCurve3(points, true, 'catmullrom', 0.5);
      // Two tubular segments a metre: enough that the tightest bend the solver
      // can produce still reads as a curve rather than a polygon.
      return new TubeGeometry(railCurve, Math.ceil(this.route.length * 2), 0.075, 6, true);
    });
    // The rails cast (ARCHITECTURE.md, *rendering notes*: shadow casting is
    // opt-out and every caster is drawn twice). A coaster is a thing in the
    // sky, and without a shadow on the lawn under it there is nothing telling
    // a child how high up it is — which is the whole feeling of the ride. Two
    // tubes is two extra draw calls for the entire loop, which is exactly the
    // "shapes doing the silhouette's work" the note asks for.
    for (const geometry of railGeometries) {
      const rail = new Mesh(geometry, railMaterial);
      rail.castShadow = true;
      this.group.add(rail);
    }

    const ties = new InstancedMesh(new BoxGeometry(1.5, 0.08, 0.3), tieMaterial, segments);
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const forward = new Vector3();
    const position = new Vector3();
    const one = new Vector3(1, 1, 1);
    const mid = new Vector3();
    const next = new Vector3();

    const pylonSpots: { x: number; z: number; height: number }[] = [];
    for (let i = 0; i < segments; i += 1) {
      const d = i * step;
      this.route.pointAt(d, mid);
      this.route.pointAt(d + step, next);
      forward.subVectors(next, mid).normalize();
      rotation.setFromUnitVectors(new Vector3(0, 0, 1), forward);
      matrix.compose(position.copy(mid).setY(mid.y - 0.12), rotation, one);
      ties.setMatrixAt(i, matrix);

      // A pylon roughly every 6 m, where the ground is genuinely clear —
      // clear of *collision*, clear of the walking network, and clear of the
      // corridors between plots. `isClearCircle` knows nothing about either:
      // a 0.32 m post inflates past a lane's half-width in the nav lattice
      // (one on a spur stranded the ball pit's own doormat), and one in the
      // 5 m gap between two plots pinched it shut for strolling NPCs. The
      // track shrugs off a missing pylon; the walk network cannot shrug off
      // a misplaced one.
      if (i % 4 === 2) {
        const ground = terrainHeight(mid.x, mid.z);
        const height = mid.y - ground;
        const pinchesCorridor = [...PARK_LAYOUT.entries.values()].some(
          (entry) =>
            Math.hypot(mid.x - entry.x, mid.z - entry.z) < entry.boundingRadius + 2.4,
        );
        if (
          height > 1.4 &&
          collision.isClearCircle(mid.x, mid.z, 1.0) &&
          distanceToPath(mid.x, mid.z) > 2.8 &&
          !pinchesCorridor
        ) {
          pylonSpots.push({ x: mid.x, z: mid.z, height });
          collision.addCircle(mid.x, mid.z, 0.32);
        }
      }
    }
    ties.instanceMatrix.needsUpdate = true;

    const pylons = new InstancedMesh(
      new CylinderGeometry(0.22, 0.3, 1, 8),
      pylonMaterial,
      Math.max(1, pylonSpots.length),
    );
    pylons.count = pylonSpots.length;
    const stretch = new Vector3();
    pylonSpots.forEach((spot, index) => {
      const ground = terrainHeight(spot.x, spot.z);
      position.set(spot.x, ground + spot.height / 2 - 0.15, spot.z);
      stretch.set(1, spot.height, 1);
      matrix.compose(position, rotation.identity(), stretch);
      pylons.setMatrixAt(index, matrix);
    });
    pylons.instanceMatrix.needsUpdate = true;
    // The pylons cast too: they are what plants the track on the ground, and
    // an `InstancedMesh` is one draw call however many posts there are, so the
    // whole colonnade costs one more.
    //
    // The **ties do not**, and that is a judgement rather than a saving: they
    // are 8 cm slats every 1.4 m, and a shadow of them is a fine stripey comb
    // that `VSMShadowMap`'s soft edges turn to mush at this scale. Nobody looks
    // for the shadow of a sleeper — see the station canopy's note in
    // `train/station.ts` and ARCHITECTURE.md's *rendering notes*.
    pylons.castShadow = true;
    this.group.add(ties, pylons);

    // The station platform: a low deck beside the boarding dip.
    const stationPoint = this.route.pointAt(this.route.stationDistance, new Vector3());
    const deck = toonBox(3.2, 0.25, 6, PALETTE.woodLight);
    deck.position.set(
      stationPoint.x,
      terrainHeight(stationPoint.x, stationPoint.z) + STATION_HEIGHT - 0.5,
      stationPoint.z,
    );
    this.group.add(deck);
  }

  interactZones(): [] {
    return [];
  }

  dispose(): void {
    this.rideView?.dispose();
    this.confetti?.dispose();
    this.rivalKid?.dispose?.();
  }
}

/** A toon box with the house outline — tiny local helper. */
function toonBox(w: number, h: number, d: number, colour: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(w, h, d), toonMaterial(colour));
  addOutline(mesh, 0.02);
  return mesh;
}
