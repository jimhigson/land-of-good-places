import { DirectionalLight, Group, HemisphereLight, OrthographicCamera, Scene } from 'three';
import { PALETTE } from '../../core/palette';
import { Rng, clamp, clamp01, damp } from '../../core/mathUtils';
import { gameStore } from '../../state';
import { createBackdrop, type Backdrop } from './backdrop';
import { createConfetti, type Confetti } from './confetti';
import { LANES, PLAYER_LANE, createCourse, type Course } from './course';
import { createRaceHud, placeName, type RaceHud } from './hud';
import { createRacer, type RacerModel } from './racer';
import {
  ALERT_RANGE,
  BONK_SPEED_FACTOR,
  HAZARDS,
  TRACK_LENGTH,
  railHeight,
  railPitch,
} from './track';
import type { MiniGame, MiniGameContext, MiniGameFrame } from '../types';

/**
 * **Rail Racer** — the first fairground stall.
 *
 * You ride a little cart along a rail against three cheerful rivals. There is
 * exactly one control: **hold to go faster, let go to coast**. Sparking gates
 * and low branches cross the track, and the only way under one is to be slow
 * enough that your rider ducks — so the whole game is learning *when to let go*.
 *
 * Three rules keep it a Land of Good Places game rather than a race:
 *
 * - **You cannot fail.** A bonk costs speed and gives you a wobble; it never
 *   ends the run, never takes a life, and there are no lives.
 * - **The rivals stay near you.** They are rubber-banded, gently and
 *   asymmetrically: they speed up a little when they fall behind and slow down
 *   rather more when they get ahead. Nobody watches a race they lost by half a
 *   kilometre.
 * - **Everybody gets confetti.** Fourth place still ends in a shower of paper
 *   and a kind sentence. First place just gets three times as much.
 *
 * Tuning lives at the top of this file. A race is a little under a minute at a
 * decent pace, which is about as long as a six-year-old wants one ride to be.
 */

// ------------------------------------------------------------------- tuning

/** Acceleration while the button is held, m/s². */
const THRUST = 9.9;

/** Coasting drag: a linear part and a squared part, m/s². */
const DRAG_LINEAR = 0.35;
const DRAG_SQUARE = 0.02;

/**
 * How hard the hills pull.
 *
 * Well under real gravity on purpose. The dips and rises are there to make the
 * ride feel like a rollercoaster, not to become a second thing to manage.
 */
const HILL_PULL = 5.6;

/** You never stop and you never quite fly. */
const MIN_SPEED = 3.4;
const MAX_SPEED = 22;

/**
 * How long a bonk's wobble lasts.
 *
 * The button does nothing for the first two thirds of it, which is where the
 * cost of a bonk actually lives — the lost speed alone is not enough to make
 * letting go worth learning.
 */
const WOBBLE_SECONDS = 1.3;

/** Seconds of 3-2-1 before the off. */
const COUNTDOWN = 3.2;

/** Seconds the finish card sits there before a press will dismiss it. */
const RESULT_LOCKOUT = 1.1;

/** Seconds after which the finish card dismisses itself. */
const RESULT_TIMEOUT = 9;

/** Safety net: no race may run longer than this. */
const RACE_TIME_LIMIT = 150;

/**
 * Camera framing: side-on, with just enough pitch to stack the four lanes into
 * separate rows of the picture.
 *
 * The view height is the number that matters. Too tight and the riders loom,
 * the hazards arrive with no warning and the backdrop never gets seen; 24
 * metres puts a two-metre cart at about a twelfth of the screen and gives a
 * second and a half of visible track ahead at racing speed, which is the whole
 * reaction budget the game is tuned around.
 */
const VIEW_HEIGHT = 24;
const CAMERA_YAW = 0.17;
const CAMERA_PITCH = 0.3;
const CAMERA_DISTANCE = 90;
/** The rider sits left of centre, so most of the screen is what is coming. */
const CAMERA_LEAD = 7;

/** The three rivals. Cheerful, beatable, and each one rides a bit differently. */
const RIVALS = [
  { name: 'Pip', hair: 0x6b4a8f, outfit: PALETTE.markerLemon, cart: PALETTE.markerLemon, strength: 0.98, caution: 1.12, mistakes: 0.16, hairStyle: 'short' as const },
  { name: 'Nell', hair: 0xd2694a, outfit: PALETTE.markerMint, cart: PALETTE.markerMint, strength: 1.0, caution: 0.98, mistakes: 0.22, hairStyle: 'bob' as const },
  { name: 'Otto', hair: 0x4a3a52, outfit: PALETTE.markerSky, cart: PALETTE.markerSky, strength: 0.94, caution: 1.24, mistakes: 0.12, hairStyle: 'short' as const },
];

type Phase = 'countdown' | 'racing' | 'celebrating';

interface Rider {
  readonly model: RacerModel;
  readonly colour: number;
  readonly isPlayer: boolean;
  readonly lane: number;
  /** Rival tuning; ignored for the player. */
  readonly strength: number;
  readonly caution: number;
  readonly mistakes: number;
  x: number;
  speed: number;
  wobble: number;
  holding: boolean;
  band: number;
  hazardIndex: number;
  /** Drawn fresh per hazard: below 1 means this rider will misjudge this one. */
  hazardFudge: number;
  finished: boolean;
  place: number;
  finishTime: number;
}

class RailRacer implements MiniGame {
  readonly id = 'railRacer';
  readonly title = 'Rail Racer';
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 3);

  private context: MiniGameContext | null = null;
  private hud: RaceHud | null = null;
  private course: Course | null = null;
  private backdrop: Backdrop | null = null;
  private confetti: Confetti | null = null;
  private readonly riders: Rider[] = [];
  private readonly rng = new Rng(0x7a11ed);

  private phase: Phase = 'countdown';
  private countdown = COUNTDOWN;
  private raceTime = 0;
  private resultTime = 0;
  private finishedCount = 0;
  private aspect = 1;
  private cameraX = 0;
  private cameraY = 0;
  private toldToLetGo = false;
  private celebrationBurst = 0;

  // ------------------------------------------------------------------ setup

  init(context: MiniGameContext): void {
    this.context = context;

    this.scene.add(new HemisphereLight(PALETTE.ambientDay, PALETTE.grass, 1.1));

    // The rig the art was approved under (ART_DIRECTION.md §6), minus shadows:
    // this little world is a flat storybook page and a shadow pass would double
    // its draw calls for something the style does not want.
    const key = new DirectionalLight(PALETTE.sunDay, 2.3);
    key.position.set(24, 40, 30);
    this.scene.add(key, key.target);

    const fill = new DirectionalLight(PALETTE.skyDayBottom, 0.55);
    fill.position.set(-30, 18, 20);
    this.scene.add(fill);

    // The backdrop hangs off the camera so that its x and y are screen metres —
    // see the note in `backdrop.ts`. That means the camera itself has to be in
    // the scene graph, which it otherwise would not need to be.
    this.backdrop = createBackdrop();
    this.camera.add(this.backdrop.root);
    this.scene.add(this.camera);

    this.course = createCourse();
    this.scene.add(this.course.root);

    this.confetti = createConfetti();
    this.scene.add(this.confetti.root);

    this.buildRiders();

    this.hud = createRaceHud(context.overlay);
    this.hud.setPlace(1, this.riders.length);

    this.cameraX = CAMERA_LEAD;
    this.cameraY = railHeight(0) + 2;
    this.applyCamera();
  }

  private buildRiders(): void {
    const group = new Group();
    group.name = 'railracer:riders';
    this.scene.add(group);

    const player = gameStore.get().player;

    RIVALS.forEach((rival, index) => {
      const model = createRacer({
        hair: rival.hair,
        outfit: rival.outfit,
        cart: rival.cart,
        hairStyle: rival.hairStyle,
      });
      group.add(model.root);
      this.riders.push({
        model,
        colour: rival.cart,
        isPlayer: false,
        lane: LANES[index] ?? 0,
        strength: rival.strength,
        caution: rival.caution,
        mistakes: rival.mistakes,
        x: -4 - index * 1.6,
        speed: 0,
        wobble: 0,
        holding: false,
        band: 1,
        hazardIndex: 0,
        hazardFudge: 1,
        finished: false,
        place: 0,
        finishTime: 0,
      });
    });

    // The player rides as themselves: same hair and outfit as the kid standing
    // in the park, so the rider on the front rail is recognisably *you*.
    const model = createRacer({
      hair: player.hairColour,
      outfit: player.outfitColour,
      cart: PALETTE.markerPink,
      hairStyle: 'bunches',
    });
    group.add(model.root);
    this.riders.push({
      model,
      colour: PALETTE.markerPink,
      isPlayer: true,
      lane: LANES[PLAYER_LANE] ?? 0,
      strength: 1,
      caution: 1,
      mistakes: 0,
      x: -2,
      speed: 0,
      wobble: 0,
      holding: false,
      band: 1,
      hazardIndex: 0,
      hazardFudge: 1,
      finished: false,
      place: 0,
      finishTime: 0,
    });

    for (const rider of this.riders) this.placeRider(rider);
  }

  // ------------------------------------------------------------------ frame

  update(frame: MiniGameFrame): void {
    const { dt, elapsed, input } = frame;
    const player = this.player;

    switch (this.phase) {
      case 'countdown':
        this.countdown -= dt;
        this.hud?.setCount(countdownText(this.countdown));
        if (this.countdown <= 0) {
          this.phase = 'racing';
          this.hud?.setCount(null);
          this.hud?.shout('GO!', 0.9);
        }
        break;

      case 'racing':
        this.raceTime += dt;
        this.driveRiders(dt, input.hold);
        this.teach(input.hold);
        if (player.finished || this.raceTime > RACE_TIME_LIMIT) this.celebrate();
        break;

      case 'celebrating':
        this.resultTime += dt;
        // The rivals carry on across the line behind the card — a race that
        // freezes the moment you finish feels like it was never really running.
        this.driveRiders(dt, false);
        this.celebrationBurst -= dt;
        if (this.celebrationBurst <= 0) {
          this.celebrationBurst = 0.35;
          this.throwConfetti(player.place === 1 ? 26 : 12);
        }
        if (
          this.resultTime > RESULT_LOCKOUT &&
          (input.holdPressed || input.quit || this.resultTime > RESULT_TIMEOUT)
        ) {
          this.reportResult();
        }
        break;
    }

    this.animate(dt, elapsed);
    this.confetti?.update(dt);
    this.hud?.update(dt);
    this.updateCamera(dt);
    this.updateHud();
  }

  /**
   * One rider's second of physics.
   *
   * Hold adds thrust, coasting leaves only drag, and the hills push or pull.
   * Speed is floored rather than allowed to reach zero: a child who lets go and
   * looks out of the window still rolls gently to the finish.
   */
  private driveRiders(dt: number, playerHold: boolean): void {
    const playerX = this.player.x;

    for (const rider of this.riders) {
      if (rider.finished) {
        rider.model.setCheering(true);
        continue;
      }

      rider.holding = rider.isPlayer ? playerHold && rider.wobble < 0.35 : this.rivalWantsSpeed(rider);

      if (!rider.isPlayer) {
        // Rubber band: catching up is easier than running away. Asymmetric on
        // purpose — the point is a close race, not a fair one.
        const gap = playerX - rider.x;
        rider.band =
          gap >= 0 ? 1 + Math.min(gap, 70) * 0.003 : 1 - Math.min(-gap, 70) * 0.005;
      }

      const slope = railSlopeAt(rider.x);
      const thrust = rider.holding ? THRUST * rider.strength * rider.band : 0;
      const drag = DRAG_LINEAR * rider.speed + DRAG_SQUARE * rider.speed * rider.speed;
      rider.speed = clamp(
        rider.speed + (thrust - drag - HILL_PULL * slope) * dt,
        MIN_SPEED,
        MAX_SPEED,
      );
      rider.x += rider.speed * dt;

      this.checkHazards(rider);

      if (rider.wobble > 0) rider.wobble = Math.max(0, rider.wobble - dt / WOBBLE_SECONDS);

      if (!rider.finished && rider.x >= TRACK_LENGTH) {
        rider.finished = true;
        this.finishedCount += 1;
        rider.place = this.finishedCount;
        rider.finishTime = this.raceTime;
        this.confetti?.burst(rider.x, railHeight(rider.x) + 2.2, rider.lane, 18, 1.1);
      }
    }
  }

  /** The rivals' one decision: keep pedalling, or start coasting for the gate? */
  private rivalWantsSpeed(rider: Rider): boolean {
    if (rider.wobble > 0.35) return false;
    const hazard = HAZARDS[rider.hazardIndex];
    if (!hazard) return true;
    const distance = hazard.x - rider.x;
    const needed =
      slowDownDistance(rider.speed, hazard.safeSpeed - 0.4) * rider.caution * rider.hazardFudge;
    return distance > needed + 1.5;
  }

  /** Did anyone just go under a bar too fast? */
  private checkHazards(rider: Rider): void {
    let hazard = HAZARDS[rider.hazardIndex];
    while (hazard && hazard.x <= rider.x) {
      if (rider.speed > hazard.safeSpeed) this.bonk(rider);
      rider.hazardIndex += 1;
      // Draw this rider's judgement of the *next* hazard now, so a rival's
      // mistakes are decided in advance and are the same every race.
      rider.hazardFudge = this.rng.chance(rider.mistakes) ? 0.5 : 1;
      hazard = HAZARDS[rider.hazardIndex];
    }
  }

  private bonk(rider: Rider): void {
    rider.speed *= BONK_SPEED_FACTOR;
    rider.wobble = 1;
    rider.model.setExpression('surprised');
    this.confetti?.burst(rider.x, railHeight(rider.x) + 1.9, rider.lane, 10, 0.55);
    if (rider.isPlayer) {
      this.hud?.shout('Bonk! Let go sooner!', 1.5);
    }
  }

  /** A nudge the first time a hazard comes up, and never again. */
  private teach(hold: boolean): void {
    if (this.toldToLetGo) return;
    const player = this.player;
    const hazard = HAZARDS[player.hazardIndex];
    if (!hazard) return;
    if (hazard.x - player.x < 34 && hold && player.speed > hazard.safeSpeed) {
      this.toldToLetGo = true;
      this.hud?.shout('Let go to duck!', 2);
    }
  }

  private celebrate(): void {
    const player = this.player;
    if (!player.finished) {
      // Ran out of time (nobody has ever managed it). Give them the line.
      player.finished = true;
      this.finishedCount += 1;
      player.place = this.finishedCount;
      player.finishTime = this.raceTime;
    }
    this.phase = 'celebrating';
    this.resultTime = 0;
    this.celebrationBurst = 0;
    player.model.setExpression('happy');
    this.throwConfetti(player.place === 1 ? 60 : 26);

    const touch = this.context?.touch ?? false;
    this.hud?.setCount(null);
    this.hud?.showResult(
      resultTitle(player.place),
      `${placeName(player.place)} of ${this.riders.length} · ${player.finishTime.toFixed(1)} seconds`,
      touch ? 'Tap to go back to the park' : 'Press Space to go back to the park',
    );
  }

  private throwConfetti(count: number): void {
    const player = this.player;
    this.confetti?.burst(player.x + 1, railHeight(player.x) + 3.4, player.lane, count, 1.25);
  }

  private reportResult(): void {
    const player = this.player;
    this.context?.finish({
      id: this.id,
      outcome: 'finished',
      place: player.place,
      of: this.riders.length,
      seconds: player.finishTime,
      message: resultTitle(player.place),
    });
  }

  // ----------------------------------------------------------------- visuals

  private animate(dt: number, elapsed: number): void {
    for (const rider of this.riders) {
      this.placeRider(rider);
      rider.model.setSpeed(rider.speed, dt);
      rider.model.setDuck(rider.finished ? 0 : rider.holding ? 0 : 1, dt);
      rider.model.setWobble(rider.wobble, elapsed);
      if (rider.wobble <= 0 && !rider.finished) {
        rider.model.setExpression(rider.holding ? 'happy' : 'neutral');
      }
    }

    // Hazard lamps: amber while you are too fast for the next one, mint the
    // moment you are slow enough to duck under it.
    const player = this.player;
    for (const prop of this.course?.hazards ?? []) {
      const distance = prop.hazard.x - player.x;
      const closeness = distance < -3 ? 0 : clamp01(1 - distance / ALERT_RANGE);
      prop.setAlert(closeness, player.speed <= prop.hazard.safeSpeed, elapsed);
    }
  }

  private placeRider(rider: Rider): void {
    rider.model.root.position.set(rider.x, railHeight(rider.x), rider.lane);
    rider.model.root.rotation.z = railPitch(rider.x);
  }

  private updateCamera(dt: number): void {
    const player = this.player;
    // Damped, and only forwards: a camera that snaps backwards when the rider
    // is bonked makes the whole screen jolt.
    this.cameraX = damp(this.cameraX, player.x + CAMERA_LEAD, 0.14, dt);
    this.cameraY = damp(this.cameraY, railHeight(player.x) + 2, 0.28, dt);
    this.applyCamera();
    this.backdrop?.update(this.cameraX, this.cameraY);
  }

  private applyCamera(): void {
    const focusZ = LANES[PLAYER_LANE] ?? 0;
    const horizontal = Math.cos(CAMERA_PITCH) * CAMERA_DISTANCE;
    this.camera.position.set(
      this.cameraX + Math.sin(CAMERA_YAW) * horizontal,
      this.cameraY + Math.sin(CAMERA_PITCH) * CAMERA_DISTANCE,
      focusZ + Math.cos(CAMERA_YAW) * horizontal,
    );
    this.camera.lookAt(this.cameraX, this.cameraY, focusZ);
    this.camera.updateMatrixWorld();
  }

  private updateHud(): void {
    const hud = this.hud;
    if (!hud) return;
    const player = this.player;

    let ahead = 0;
    for (const rider of this.riders) if (!rider.isPlayer && rider.x > player.x) ahead += 1;
    hud.setPlace(player.finished ? player.place : ahead + 1, this.riders.length);

    hud.setPips(
      this.riders.map((rider) => ({
        colour: rider.colour,
        progress: rider.x / TRACK_LENGTH,
        you: rider.isPlayer,
      })),
    );
  }

  // ------------------------------------------------------------- lifecycle

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    const halfHeight = VIEW_HEIGHT / 2;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.left = -halfHeight * this.aspect;
    this.camera.right = halfHeight * this.aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    for (const rider of this.riders) rider.model.dispose();
    this.riders.length = 0;
    this.course?.dispose();
    this.backdrop?.dispose();
    this.confetti?.dispose();
    this.hud?.dispose();
    this.scene.clear();
    this.context = null;
  }

  // ------------------------------------------------------------- internals

  private get player(): Rider {
    const player = this.riders[this.riders.length - 1];
    if (!player) throw new Error('Rail Racer: no riders were built.');
    return player;
  }
}

/** The factory the stall registers. */
export function createRailRacer(): MiniGame {
  return new RailRacer();
}

// ---------------------------------------------------------------- helpers

/** Slope of the rail, as `sin(pitch)` rather than `dy/dx`. */
function railSlopeAt(x: number): number {
  return Math.sin(railPitch(x));
}

/**
 * Roughly how much track it takes to coast down from `speed` to `target`.
 *
 * Integrated in a handful of steps rather than solved: the drag curve has a
 * squared term, the answer only has to be good enough for a rival to decide
 * when to let go, and eight divisions is cheaper than being clever.
 */
function slowDownDistance(speed: number, target: number): number {
  if (speed <= target) return 0;
  const steps = 8;
  const step = (speed - target) / steps;
  let distance = 0;
  let v = speed;
  for (let i = 0; i < steps; i += 1) {
    const decel = DRAG_LINEAR * v + DRAG_SQUARE * v * v;
    distance += (v * step) / Math.max(decel, 0.5);
    v -= step;
  }
  return distance;
}

function countdownText(remaining: number): string {
  if (remaining > 2.2) return '3';
  if (remaining > 1.2) return '2';
  if (remaining > 0.2) return '1';
  return 'GO!';
}

function resultTitle(place: number): string {
  switch (place) {
    case 1:
      return 'You WON!';
    case 2:
      return 'Second place!';
    case 3:
      return 'Third place!';
    default:
      return 'What a race!';
  }
}
