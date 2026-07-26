import {
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  RingGeometry,
  Scene,
} from 'three';
import { PALETTE } from '../../core/palette';
import { Rng, TAU, clamp, clamp01, damp, turnTowards } from '../../core/mathUtils';
import { gameStore } from '../../state';
import { createArena, type Arena } from './arena';
import { createCar, type CarModel, type DriverKind } from './car';
import { createGiggles, type Giggles } from './giggles';
import { createDodgemsHud, type DodgemsHud } from './hud';
import { createSparks, type Sparks } from './sparks';
import { createSteering, type Steering } from './steering';
import { createWobblyTree, type AppleTarget, type WobblyTree } from './tree';
import {
  ARENA_RADIUS,
  BUMP_THRESHOLD,
  CAR_BOUNCE,
  CAR_RADIUS,
  TREE_BOUNCE,
  TREE_RADIUS,
  WALL_BOUNCE,
} from './layout';
import type { MiniGame, MiniGameContext, MiniGameFrame } from '../types';

/**
 * **The Dodgems** — bump the cars, bonk the tree.
 *
 * The rules that make it a Land of Good Places ride rather than a driving game:
 *
 * - **You cannot lose and you cannot crash badly.** Every collision is a bounce
 *   and a giggle. There is no damage, no spinning out, no being stuck.
 * - **The rivals are bumblers.** They potter towards cheerful targets — a spot
 *   on the floor, another car, quite often the tree — and they are capped a
 *   little slower than the player. None of them is ever *coming for you*.
 * - **The tree is the point.** It is worth its own counter on the HUD, the
 *   rivals go for it too so it goes off even when the player is doing something
 *   else, and hitting it fires all four gags at once.
 *
 * Driving is deliberately the simplest thing that is still fun: hold to go,
 * point where you want to be. There is no brake, no reverse and no handbrake,
 * because there is no situation in this rink where a six-year-old needs one.
 */

// ------------------------------------------------------------------- tuning

/** How long a ride lasts. Long enough to get good at it, short enough to want another. */
const RIDE_SECONDS = 78;

/** Seconds of 3-2-1 before the off. */
const COUNTDOWN = 3.2;

/** Seconds the finish card sits there before a press will dismiss it. */
const RESULT_LOCKOUT = 1.1;
/** Seconds after which the finish card dismisses itself. */
const RESULT_TIMEOUT = 11;

/** Push while the go button is held, m/s². */
const THRUST = 13;
/** Everything on this floor slides to a stop eventually. */
const DRAG = 1.65;
/** Cruising speed under power. Rivals get less. */
const PLAYER_TOP_SPEED = 7.4;
const RIVAL_TOP_SPEED = 5.9;
/** Nothing may exceed this, however hard it is hit. */
const SPEED_LIMIT = 13;
/** How fast a car swings its nose round, rad/s. Snappy: this is not a lorry. */
const TURN_RATE = 5.2;

/** Seconds a driver looks startled after a wallop. */
const SURPRISE_SECONDS = 0.7;
/**
 * Seconds before the same car can set the tree off again.
 *
 * Without this, a car held against the trunk re-bonks every frame: the counter
 * ran to five in a second and a half of the first playtest, and the four gags
 * restarted so often that none of them ever got to finish.
 */
const TREE_GAP = 0.9;
/** Same idea for the bump counter, so leaning on somebody is not a score. */
const BUMP_GAP = 0.22;
/** Seconds between giggle bubbles from the same car, so a pile-up is not a wall of text. */
const GIGGLE_GAP = 0.55;

/**
 * Camera framing.
 *
 * Pseudo-top-down: high enough that a child can see the whole rink and plan a
 * run at the tree, tilted enough that the cars and the drivers' faces are still
 * three-dimensional objects rather than roofs. Fixed yaw — a rotating camera in
 * a game about steering is how a six-year-old ends up driving into the wall.
 */
const CAMERA_YAW = 0.42;
/**
 * 42° above the horizon — a shade steeper than the park's 38°, and a long way
 * off straight down. Authored at 56° first, which showed the player the roofs
 * of the cars and the tops of the drivers' heads; the faces are the whole point
 * of the drivers, so the camera came back down until they read.
 */
const CAMERA_PITCH = 0.74;
const CAMERA_DISTANCE = 70;
/** World radius the framing tries to keep on screen. */
const FRAME_RADIUS = ARENA_RADIUS + 2.6;
/** Never zoom out past this, however narrow the phone is — see `resize`. */
const MAX_VIEW_HEIGHT = 42;
const MIN_VIEW_HEIGHT = 21;

/** The rivals. Cheerful, varied, and all of them fond of that tree. */
const RIVALS: readonly { name: string; car: number; driver: DriverKind }[] = [
  {
    name: 'RiPika',
    car: PALETTE.markerLemon,
    driver: { kind: 'ripika' },
  },
  {
    name: 'Pip',
    car: PALETTE.markerMint,
    driver: { kind: 'kid', hair: 0x6b4a8f, outfit: PALETTE.markerMint, hairStyle: 'short' },
  },
  {
    name: 'Nell',
    car: PALETTE.markerSky,
    driver: { kind: 'kid', hair: 0xd2694a, outfit: PALETTE.markerSky, hairStyle: 'bob' },
  },
  {
    name: 'Otto',
    car: PALETTE.markerLilac,
    driver: { kind: 'kid', hair: 0x4a3a52, outfit: PALETTE.markerLilac, hairStyle: 'short' },
  },
  {
    name: 'Bea',
    car: PALETTE.flowerRed,
    driver: { kind: 'kid', hair: 0xf0d27a, outfit: PALETTE.flowerRed, hairStyle: 'bunches' },
  },
];

type Phase = 'countdown' | 'riding' | 'celebrating';

interface Car {
  readonly model: CarModel;
  readonly isPlayer: boolean;
  readonly name: string;
  readonly topSpeed: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  squash: number;
  surprise: number;
  giggleCooldown: number;
  treeCooldown: number;
  bumpCooldown: number;
  /** Rival brain: where it is pottering off to, and for how long. */
  targetX: number;
  targetZ: number;
  targetTimer: number;
}

class Dodgems implements MiniGame {
  readonly id = 'dodgems';
  readonly title = 'Dodgems';
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 3);

  private context: MiniGameContext | null = null;
  private arena: Arena | null = null;
  private tree: WobblyTree | null = null;
  private sparks: Sparks | null = null;
  private giggles: Giggles | null = null;
  private hud: DodgemsHud | null = null;
  private steering: Steering | null = null;
  private readonly cars: Car[] = [];
  private readonly rng = new Rng(0xd0d63e);
  /** The ring painted on the floor under the player's car — "this one is you". */
  private youMarker: Mesh | null = null;

  private phase: Phase = 'countdown';
  private countdown = COUNTDOWN;
  private rideTime = 0;
  private resultTime = 0;
  private bumps = 0;
  private treeBonks = 0;
  private celebrationBurst = 0;
  private aspect = 1;
  private viewHeight = MIN_VIEW_HEIGHT;
  private focusX = 0;
  private focusZ = 0;
  private taughtSteering = false;

  // ------------------------------------------------------------------ setup

  init(context: MiniGameContext): void {
    this.context = context;

    this.scene.add(new HemisphereLight(PALETTE.ambientDay, PALETTE.grass, 1.15));

    // The rig the art was approved under (ART_DIRECTION.md §6). No shadow pass:
    // this is a flat storybook rink and shadows would double its draw calls for
    // something the style does not ask for.
    const key = new DirectionalLight(PALETTE.sunDay, 2.2);
    key.position.set(18, 34, 26);
    this.scene.add(key, key.target);

    const fill = new DirectionalLight(PALETTE.skyDayBottom, 0.6);
    fill.position.set(-26, 16, -18);
    this.scene.add(fill);

    this.arena = createArena();
    this.scene.add(this.arena.root);

    this.tree = createWobblyTree();
    this.scene.add(this.tree.root);

    this.sparks = createSparks();
    this.scene.add(this.sparks.root);

    this.giggles = createGiggles();
    this.scene.add(this.giggles.root);

    this.buildCars();

    // Six near-identical little cars in a circle, and one of them is yours: the
    // ring is how a child finds theirs again after a four-car pile-up. Painted
    // on the floor rather than floated above the car, because from this angle
    // anything above a car ends up over somebody else's.
    this.youMarker = new Mesh(
      new RingGeometry(1.15, 1.4, 32),
      new MeshBasicMaterial({
        color: PALETTE.blossomWhite,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.youMarker.rotation.x = -Math.PI / 2;
    this.youMarker.renderOrder = 1;
    this.scene.add(this.youMarker);

    this.steering = createSteering();
    this.hud = createDodgemsHud(context.overlay);
    this.hud.setBumps(0);
    this.hud.setTreeBonks(0);
    this.hud.setTime(RIDE_SECONDS);

    this.applyCamera();
  }

  private buildCars(): void {
    const group = new Group();
    group.name = 'dodgems:cars';
    this.scene.add(group);

    // Everyone starts spread evenly round the outside, nose towards the middle
    // — which is where the tree is, which is the first thing anybody should hit.
    const total = RIVALS.length + 1;
    const startRadius = ARENA_RADIUS - 3.2;

    RIVALS.forEach((rival, index) => {
      const angle = ((index + 1) / total) * TAU;
      const model = createCar({ body: rival.car, driver: rival.driver });
      group.add(model.root);
      this.cars.push(this.makeCar(model, rival.name, false, angle, startRadius, RIVAL_TOP_SPEED));
    });

    // The player drives as themselves: the kid standing in the park, in a pink
    // car, so the one you are steering is recognisably *you*.
    const player = gameStore.get().player;
    const model = createCar({
      body: PALETTE.markerPink,
      driver: {
        kind: 'kid',
        hair: player.hairColour,
        outfit: player.outfitColour,
        hairStyle: 'bunches',
      },
    });
    group.add(model.root);
    this.cars.push(this.makeCar(model, 'You', true, 0, startRadius, PLAYER_TOP_SPEED));

    for (const car of this.cars) {
      car.model.root.position.set(car.x, 0, car.z);
      car.model.root.rotation.y = car.yaw;
    }
  }

  private makeCar(
    model: CarModel,
    name: string,
    isPlayer: boolean,
    angle: number,
    radius: number,
    topSpeed: number,
  ): Car {
    return {
      model,
      isPlayer,
      name,
      topSpeed,
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      vx: 0,
      vz: 0,
      // Facing round the rink, not at the tree. Six cars all pointed at the
      // middle turned the first two seconds of every ride into one pile-up in
      // the centre, which is funny once and then is simply where the ride is.
      // Yaw 0 looks down +Z, the park's convention.
      yaw: Math.atan2(-Math.sin(angle), Math.cos(angle)),
      squash: 0,
      surprise: 0,
      giggleCooldown: 0,
      treeCooldown: 0,
      bumpCooldown: 0,
      targetX: 0,
      targetZ: 0,
      targetTimer: 0,
    };
  }

  // ------------------------------------------------------------------ frame

  update(frame: MiniGameFrame): void {
    const { dt, elapsed, input } = frame;
    const steer = this.steering?.read() ?? { x: 0, y: 0, wants: false, touch: null };
    this.hud?.setStick(steer.touch);

    switch (this.phase) {
      case 'countdown':
        this.countdown -= dt;
        this.hud?.setCount(countdownText(this.countdown));
        if (this.countdown <= 0) {
          this.hud?.setCount(null);
          this.hud?.shout('GO! Bonk the tree!', 2.2);
          this.phase = 'riding';
        }
        // Everybody idles in place until the off — but the tree and the lights
        // are already alive, so the rink never looks like a paused screenshot.
        break;

      case 'riding': {
        this.rideTime += dt;
        this.driveCars(dt, input.hold || steer.wants, steer.x, steer.y);
        this.teach(steer.wants);
        this.hud?.setTime(RIDE_SECONDS - this.rideTime);
        if (this.rideTime >= RIDE_SECONDS) this.celebrate();
        break;
      }

      case 'celebrating':
        this.resultTime += dt;
        // The rivals carry on bumping about behind the card. A rink that
        // freezes the moment the bell goes feels switched off.
        this.driveCars(dt, false, 0, 0);
        this.celebrationBurst -= dt;
        if (this.celebrationBurst <= 0) {
          this.celebrationBurst = 0.4;
          this.throwConfetti();
        }
        if (
          this.resultTime > RESULT_LOCKOUT &&
          (input.holdPressed || input.quit || this.resultTime > RESULT_TIMEOUT)
        ) {
          this.reportResult();
        }
        break;
    }

    this.resolveCollisions();
    this.animate(dt, elapsed);
    this.tree?.update(dt, elapsed, this.appleTargets());
    this.sparks?.update(dt);
    this.giggles?.update(dt);
    this.arena?.update(elapsed);
    this.hud?.update(dt);
    this.updateCamera(dt);
  }

  /**
   * One second of driving, for everybody.
   *
   * The player's car and a rival's car run through exactly the same physics —
   * only the choice of direction differs. That is deliberate: it means a rival
   * bumping the player and the player bumping a rival feel identical, and it
   * leaves one set of numbers to tune rather than two.
   */
  private driveCars(dt: number, playerGo: boolean, steerX: number, steerY: number): void {
    // Screen up/right, on the ground plane. Steering is given in screen space
    // because that is what the child's thumb means: "up" is away from them.
    const upX = -Math.sin(CAMERA_YAW);
    const upZ = -Math.cos(CAMERA_YAW);
    const rightX = Math.cos(CAMERA_YAW);
    const rightZ = -Math.sin(CAMERA_YAW);

    for (const car of this.cars) {
      let wantX = 0;
      let wantZ = 0;
      let going = false;

      if (car.isPlayer) {
        wantX = rightX * steerX + upX * steerY;
        wantZ = rightZ * steerX + upZ * steerY;
        going = playerGo;
      } else {
        this.thinkRival(car, dt);
        wantX = car.targetX - car.x;
        wantZ = car.targetZ - car.z;
        going = true;
      }

      const length = Math.hypot(wantX, wantZ);
      if (length > 0.001) {
        car.yaw = turnTowards(car.yaw, Math.atan2(wantX, wantZ), TURN_RATE * dt);
      }

      // Forward is +Z at yaw 0 — the park's asset convention, so the driver
      // model needs no fudge rotation.
      const forwardX = Math.sin(car.yaw);
      const forwardZ = Math.cos(car.yaw);

      if (going) {
        const speed = Math.hypot(car.vx, car.vz);
        // Ease the push off as the car approaches its cruising speed, so top
        // speed is a gentle ceiling rather than a wall.
        const room = clamp01(1 - speed / car.topSpeed);
        car.vx += forwardX * THRUST * room * dt;
        car.vz += forwardZ * THRUST * room * dt;
      }

      car.vx -= car.vx * DRAG * dt;
      car.vz -= car.vz * DRAG * dt;

      const speed = Math.hypot(car.vx, car.vz);
      if (speed > SPEED_LIMIT) {
        car.vx = (car.vx / speed) * SPEED_LIMIT;
        car.vz = (car.vz / speed) * SPEED_LIMIT;
      }

      car.x += car.vx * dt;
      car.z += car.vz * dt;

      car.squash = Math.max(0, car.squash - dt * 2.2);
      car.surprise = Math.max(0, car.surprise - dt);
      car.giggleCooldown = Math.max(0, car.giggleCooldown - dt);
      car.treeCooldown = Math.max(0, car.treeCooldown - dt);
      car.bumpCooldown = Math.max(0, car.bumpCooldown - dt);
    }
  }

  /**
   * A rival's entire brain.
   *
   * It picks somewhere to be and drives there, cheerfully and not very well.
   * A third of the time that somewhere is the tree, which matters more than it
   * sounds: it means the big gag goes off every few seconds without the player
   * having to be the one who does it, and a child who is still learning to
   * steer still gets the show.
   */
  private thinkRival(car: Car, dt: number): void {
    car.targetTimer -= dt;
    const reached = Math.hypot(car.targetX - car.x, car.targetZ - car.z) < 2;
    if (car.targetTimer > 0 && !reached) return;

    car.targetTimer = this.rng.range(2.4, 4.6);
    const roll = this.rng.unit();

    if (roll < 0.28) {
      // Off to bonk the tree. Aims a little past it so it arrives at speed.
      const angle = this.rng.range(0, TAU);
      car.targetX = Math.cos(angle) * 0.6;
      car.targetZ = Math.sin(angle) * 0.6;
      return;
    }

    if (roll < 0.66) {
      // Go and say hello to somebody. Never singles the player out — the point
      // is a rink full of friends, not a rink full of pursuers.
      const others = this.cars.filter((other) => other !== car);
      const friend = others[this.rng.int(0, others.length - 1)];
      if (friend) {
        car.targetX = friend.x;
        car.targetZ = friend.z;
        return;
      }
    }

    // Potter off to a random spot.
    const angle = this.rng.range(0, TAU);
    const radius = Math.sqrt(this.rng.unit()) * (ARENA_RADIUS - 2.5);
    car.targetX = Math.cos(angle) * radius;
    car.targetZ = Math.sin(angle) * radius;
  }

  // ------------------------------------------------------------- collisions

  private resolveCollisions(): void {
    const cars = this.cars;

    // --- car against car ------------------------------------------------
    for (let i = 0; i < cars.length; i += 1) {
      const a = cars[i];
      if (!a) continue;
      for (let j = i + 1; j < cars.length; j += 1) {
        const b = cars[j];
        if (!b) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const distance = Math.hypot(dx, dz);
        const overlap = CAR_RADIUS * 2 - distance;
        if (overlap <= 0) continue;

        // Two cars exactly on top of each other have no normal; give them one.
        const nx = distance > 0.0001 ? dx / distance : 1;
        const nz = distance > 0.0001 ? dz / distance : 0;

        // Separate first, half each — equal masses, and a dodgem that gets
        // shoved further because it happened to be second in the loop feels
        // broken even if nobody can say why.
        a.x -= nx * overlap * 0.5;
        a.z -= nz * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.z += nz * overlap * 0.5;

        const approach = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (approach > 0) continue; // already flying apart

        // Elastic, and then some: `CAR_BOUNCE` above 1 puts energy *in*, which
        // is wrong physics and exactly right dodgems.
        const impulse = -approach * CAR_BOUNCE * 0.5;
        a.vx -= nx * impulse;
        a.vz -= nz * impulse;
        b.vx += nx * impulse;
        b.vz += nz * impulse;

        const impact = Math.abs(approach);
        if (impact > BUMP_THRESHOLD) {
          this.bump(a, b, impact, a.x + nx * CAR_RADIUS, a.z + nz * CAR_RADIUS);
        }
      }
    }

    // --- the tree, and the wall ------------------------------------------
    for (const car of cars) {
      const distance = Math.hypot(car.x, car.z);

      // The tree: a solid post in the middle. Bouncier than the wall, because
      // pinging off it is half of what makes people go back for another go.
      const treeReach = TREE_RADIUS + CAR_RADIUS;
      if (distance < treeReach && distance > 0.0001) {
        const nx = car.x / distance;
        const nz = car.z / distance;
        car.x = nx * treeReach;
        car.z = nz * treeReach;
        const approach = car.vx * nx + car.vz * nz;
        if (approach < 0) {
          car.vx -= nx * approach * (1 + TREE_BOUNCE);
          car.vz -= nz * approach * (1 + TREE_BOUNCE);
          const impact = Math.abs(approach);
          if (impact > BUMP_THRESHOLD * 0.8) this.bonkTree(car, nx, nz, impact);
        }
      }

      // The barrier.
      const wallReach = ARENA_RADIUS - CAR_RADIUS;
      if (distance > wallReach && distance > 0.0001) {
        const nx = car.x / distance;
        const nz = car.z / distance;
        car.x = nx * wallReach;
        car.z = nz * wallReach;
        const approach = car.vx * nx + car.vz * nz;
        if (approach > 0) {
          car.vx -= nx * approach * (1 + WALL_BOUNCE);
          car.vz -= nz * approach * (1 + WALL_BOUNCE);
          const impact = Math.abs(approach);
          if (impact > BUMP_THRESHOLD) {
            this.sparks?.spark(car.x, 0.85, car.z, 8, 0.7);
            car.squash = Math.min(1, car.squash + impact * 0.1);
            this.giggle(car, 'wall');
          }
        }
      }
    }
  }

  /** Two cars met. Sparks, squash, surprise, a giggle, and one on the counter. */
  private bump(a: Car, b: Car, impact: number, contactX: number, contactZ: number): void {
    const power = clamp01(impact / 7);
    this.sparks?.spark(contactX, 0.8, contactZ, 8 + Math.round(power * 12), 0.6 + power);
    for (const car of [a, b]) {
      car.squash = Math.min(1, car.squash + 0.35 + power * 0.5);
      car.surprise = SURPRISE_SECONDS;
    }
    if ((a.isPlayer || b.isPlayer) && a.bumpCooldown <= 0 && b.bumpCooldown <= 0) {
      a.bumpCooldown = BUMP_GAP;
      b.bumpCooldown = BUMP_GAP;
      this.bumps += 1;
      this.hud?.setBumps(this.bumps);
    }
    this.giggle(a.isPlayer ? b : a, 'car');
  }

  /** Somebody drove into the tree. Everything happens at once — that is the joke. */
  private bonkTree(car: Car, nx: number, nz: number, impact: number): void {
    if (car.treeCooldown > 0) return;
    car.treeCooldown = TREE_GAP;
    const power = clamp01(impact / 6);

    // A rival that has just bonked goes off somewhere else, so the tree gets
    // fresh runs at it rather than one car grinding against the trunk.
    if (!car.isPlayer) {
      const angle = this.rng.range(0, TAU);
      const radius = this.rng.range(ARENA_RADIUS * 0.55, ARENA_RADIUS - 2.5);
      car.targetX = Math.cos(angle) * radius;
      car.targetZ = Math.sin(angle) * radius;
      car.targetTimer = this.rng.range(2.4, 4.6);
    }

    // The wallop travelled *inwards*, so the tree leans away from the car.
    this.tree?.bonk(-nx, -nz, power);
    this.sparks?.spark(car.x - nx * 0.6, 1.1, car.z - nz * 0.6, 14, 0.9);
    car.squash = Math.min(1, car.squash + 0.5 + power * 0.5);
    car.surprise = SURPRISE_SECONDS;

    if (car.isPlayer) {
      this.treeBonks += 1;
      this.hud?.setTreeBonks(this.treeBonks);
      this.hud?.shout('TWEET!? 🐦', 1.8);
    }
    this.giggle(car, 'tree');
  }

  private giggle(car: Car, _reason: 'car' | 'wall' | 'tree'): void {
    if (car.giggleCooldown > 0) return;
    car.giggleCooldown = GIGGLE_GAP;
    this.giggles?.pop(car.x, 2.4, car.z);
  }

  /** What the falling apples are allowed to know about the cars. */
  private appleTargets(): AppleTarget[] {
    return this.cars.map((car) => ({
      x: car.x,
      z: car.z,
      push: (dx: number, dz: number, power: number) => {
        car.vx += dx * power * 2.2;
        car.vz += dz * power * 2.2;
        car.squash = Math.min(1, car.squash + 0.25);
      },
      onApple: () => {
        car.surprise = SURPRISE_SECONDS;
        this.giggle(car, 'tree');
        if (car.isPlayer) this.hud?.shout('Apple bonk!', 1.2);
      },
    }));
  }

  // ---------------------------------------------------------------- visuals

  private animate(dt: number, elapsed: number): void {
    for (const car of this.cars) {
      car.model.root.position.set(car.x, 0, car.z);
      car.model.root.rotation.y = car.yaw;
      const speed = Math.hypot(car.vx, car.vz);
      // Signed turn: which way the nose is swinging relative to where the car
      // is actually sliding. That is what the model leans into.
      const drift = Math.atan2(car.vx, car.vz) - car.yaw;
      const turn = Math.atan2(Math.sin(drift), Math.cos(drift));
      car.model.animate(dt, elapsed, speed, clamp(turn, -1, 1), car.squash);
      car.model.setExpression(car.surprise > 0 ? 'surprised' : 'happy');
    }

    const player = this.cars[this.cars.length - 1];
    if (this.youMarker && player) {
      this.youMarker.position.set(player.x, 0.03, player.z);
      this.youMarker.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.04);
    }
  }

  private teach(steering: boolean): void {
    if (this.taughtSteering || this.phase !== 'riding') return;
    if (steering) {
      this.taughtSteering = true;
      return;
    }
    if (this.rideTime > 2.5) {
      this.taughtSteering = true;
      const touch = this.context?.touch ?? false;
      this.hud?.shout(touch ? 'Slide your thumb to steer!' : 'Steer with the arrow keys!', 3);
    }
  }

  private celebrate(): void {
    this.phase = 'celebrating';
    this.resultTime = 0;
    this.celebrationBurst = 0;
    this.hud?.setCount(null);
    this.hud?.setTime(0);
    this.throwConfetti();

    const touch = this.context?.touch ?? false;
    this.hud?.showResult(
      resultTitle(this.treeBonks, this.bumps),
      `${this.bumps} bump${this.bumps === 1 ? '' : 's'} · ${this.treeBonks} tree bonk${this.treeBonks === 1 ? '' : 's'}`,
      touch ? 'Tap to go back to the park' : 'Press Space to go back to the park',
    );
  }

  /** Confetti over everybody, always. Nobody loses at the dodgems. */
  private throwConfetti(): void {
    for (const car of this.cars) {
      this.sparks?.confetti(car.x, 3.2, car.z, car.isPlayer ? 22 : 10, car.isPlayer ? 1.25 : 0.9);
    }
  }

  private reportResult(): void {
    this.context?.finish({
      id: this.id,
      outcome: 'finished',
      seconds: this.rideTime,
      message: resultTitle(this.treeBonks, this.bumps),
    });
  }

  // ----------------------------------------------------------------- camera

  /**
   * Keeps the whole rink on screen where it fits, and follows the player where
   * it does not.
   *
   * A phone held upright cannot show a 30-metre circle without shrinking the
   * cars to specks, so past a point the camera stops zooming out and starts
   * panning instead — but only as far as the rink's own edge, so the barrier is
   * always the boundary of the picture and a child can never lose the arena.
   */
  private updateCamera(dt: number): void {
    const player = this.cars[this.cars.length - 1];
    if (!player) return;

    const halfWidth = (this.viewHeight * this.aspect) / 2;
    const halfHeight = this.viewHeight / 2;
    const sinPitch = Math.sin(CAMERA_PITCH);

    const upX = -Math.sin(CAMERA_YAW);
    const upZ = -Math.cos(CAMERA_YAW);
    const rightX = Math.cos(CAMERA_YAW);
    const rightZ = -Math.sin(CAMERA_YAW);

    // How far the focus may wander before the rink's edge would leave the frame.
    const panRight = Math.max(0, FRAME_RADIUS - halfWidth);
    const panUp = Math.max(0, FRAME_RADIUS - halfHeight / Math.max(sinPitch, 0.2));

    const alongRight = clamp(player.x * rightX + player.z * rightZ, -panRight, panRight);
    const alongUp = clamp(player.x * upX + player.z * upZ, -panUp, panUp);

    const targetX = rightX * alongRight + upX * alongUp;
    const targetZ = rightZ * alongRight + upZ * alongUp;

    this.focusX = damp(this.focusX, targetX, 0.35, dt);
    this.focusZ = damp(this.focusZ, targetZ, 0.35, dt);
    this.applyCamera();
  }

  private applyCamera(): void {
    const horizontal = Math.cos(CAMERA_PITCH) * CAMERA_DISTANCE;
    this.camera.position.set(
      this.focusX + Math.sin(CAMERA_YAW) * horizontal,
      Math.sin(CAMERA_PITCH) * CAMERA_DISTANCE,
      this.focusZ + Math.cos(CAMERA_YAW) * horizontal,
    );
    this.camera.lookAt(this.focusX, 0.8, this.focusZ);
    this.camera.updateMatrixWorld();
  }

  // ------------------------------------------------------------- lifecycle

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    // Fit the rink both ways: on screen it is an ellipse, squashed vertically by
    // the camera's pitch, so the height it needs is far less than its width.
    // Take whichever of the two is the binding constraint, then stop at
    // MAX_VIEW_HEIGHT and let the camera pan once a phone gets too narrow for
    // zooming out to be worth it.
    const needHeight = FRAME_RADIUS * 2 * Math.sin(CAMERA_PITCH) + 3.5;
    const needWidth = (FRAME_RADIUS * 2) / Math.max(this.aspect, 0.1);
    this.viewHeight = clamp(Math.max(needHeight, needWidth), MIN_VIEW_HEIGHT, MAX_VIEW_HEIGHT);
    const halfHeight = this.viewHeight / 2;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.left = -halfHeight * this.aspect;
    this.camera.right = halfHeight * this.aspect;
    this.camera.updateProjectionMatrix();
    this.applyCamera();
  }

  dispose(): void {
    for (const car of this.cars) car.model.dispose();
    this.cars.length = 0;
    this.youMarker?.geometry.dispose();
    (this.youMarker?.material as MeshBasicMaterial | undefined)?.dispose();
    this.youMarker = null;
    this.arena?.dispose();
    this.tree?.dispose();
    this.sparks?.dispose();
    this.giggles?.dispose();
    this.hud?.dispose();
    this.steering?.dispose();
    this.scene.clear();
    this.context = null;
  }
}

/** The factory the stall registers. */
export function createDodgems(): MiniGame {
  return new Dodgems();
}

// ----------------------------------------------------------------- helpers

function countdownText(remaining: number): string {
  if (remaining > 2.2) return '3';
  if (remaining > 1.2) return '2';
  if (remaining > 0.2) return '1';
  return 'GO!';
}

/** Always kind. There is no losing score at the dodgems. */
function resultTitle(treeBonks: number, bumps: number): string {
  if (treeBonks >= 6) return 'Tree-bonking champion!';
  if (treeBonks >= 3) return 'That poor bird!';
  if (treeBonks >= 1) return 'You bonked the tree!';
  if (bumps >= 12) return 'What a bumpy ride!';
  return 'What a lovely drive!';
}
