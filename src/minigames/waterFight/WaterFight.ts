import {
  DirectionalLight,
  Group,
  HemisphereLight,
  OrthographicCamera,
  Scene,
  TorusGeometry,
  Vector3,
  Mesh,
  MeshBasicMaterial,
  type CanvasTexture,
} from 'three';
import { PALETTE } from '../../core/palette';
import { DEG, Rng, clamp, clamp01, damp } from '../../core/mathUtils';
import { gameStore } from '../../state';
import { createConfetti, type Confetti } from '../railRacer/confetti';
import {
  CHILD_RADIUS,
  CHILD_TOP,
  WALK_HALF_X,
  WALK_HALF_Z,
  keepInGarden,
  poolAt,
} from './arena';
import { createChild, type ChildModel } from './child';
import { createControls, type WaterFightControls } from './controls';
import { createGarden, paintSky, type Garden } from './garden';
import { createWaterFightHud, type WaterFightHud } from './hud';
import { createPortraitRow, type PortraitFighterInfo, type WaterFightPortraits } from './portraits';
import { RAINBOW_SCREEN_TOP, createRainbow, type Rainbow } from './rainbow';
import { bestSplashPoints, recordSplashPoints } from './score';
import { createWaterSystem, type WaterSystem } from './water';
import type { MiniGame, MiniGameContext, MiniGameFrame } from '../types';

/**
 * **The water fight** — the garden behind the fourth anchor plot.
 *
 * You and five other children, in a small sunny garden, with water guns far too
 * big for any of you. Tap a child and you squirt them; hold and you charge up a
 * proper soaking. They **giggle and splash back**, which makes the next
 * exchange bigger, which is the whole game — GAME_DESIGN's line is *"the fight
 * gets bigger"*, and everything here is arranged to make that happen on its own
 * without anybody being told to attack.
 *
 * The design rules, all of which come straight from the family:
 *
 * - **Nobody loses and nothing ever goes wrong.** Being splashed costs you
 *   nothing at all: you giggle, your hair goes comically wet for three seconds,
 *   and your tank is topped straight back up. There is no health, no stagger,
 *   no lost points and no way to be knocked out of the fight. (Mayhem mode's
 *   "stinging water guns" are a separate future job and are not in this file.)
 * - **Every squirt hits.** Shots home gently on to their target over their
 *   flight. Auto-aim is not an assist here, it is the design: a six-year-old
 *   taps a friend, and the water lands on that friend. Missing is not a skill
 *   this garden is interested in teaching.
 * - **The rainbow belongs to the garden, not to the score.** It appears when
 *   there is a lot of water in the air (`water.ts` counts it) and it is the
 *   garden's way of noticing that everyone is having a good time.
 *
 * **Controls, in one thumb.** Tap a child to squirt them; hold on them to
 * charge a bigger soak; tap anywhere else to walk there. On a keyboard: WASD or
 * the arrows to walk, and the framework's one button (Space, gamepad A) squirts
 * the nearest child. Both paths meet at `beginCharge` / `fire`, so there is one
 * implementation of squirting and two ways to ask for it.
 */

// ------------------------------------------------------------------- tuning

/** Length of a round, in seconds. About as long as a six-year-old wants one go. */
const ROUND_SECONDS = 90;

/** Seconds of 3-2-1 before the fight starts. */
const COUNTDOWN = 3.2;

/** Seconds the result card sits there before a press will dismiss it. */
const RESULT_LOCKOUT = 1.2;
const RESULT_TIMEOUT = 11;

/** Metres per second. The player is a shade quicker than everyone else. */
const PLAYER_SPEED = 4.1;
const RIVAL_SPEED = 2.9;

/** How much slower you walk while a shot is charging. Never zero. */
const CHARGING_SPEED_FACTOR = 0.46;

/** Seconds of holding to reach a full tank. */
const CHARGE_SECONDS = 0.95;

/** Gravity the shots arc under, m/s². Matched to the droplets in `water.ts`. */
const SHOT_GRAVITY = 15.5;

/** Shots in the air at once. Six children cannot get near this. */
const SHOT_CAPACITY = 24;

/** Splash points: the flat rate for landing one, and what a full tank adds. */
const POINTS_BASE = 10;
const POINTS_CHARGE = 20;
/** Each hit in a streak adds this much, up to `STREAK_CAP` hits. */
const POINTS_STREAK = 2;
const STREAK_CAP = 6;
/** Seconds between hits before a streak lapses. */
const STREAK_WINDOW = 4;
/** One-off, the first time a rainbow comes out in a round. */
const POINTS_RAINBOW = 25;

/** Camera pitch, matching the park's `CAMERA_PITCH_DEGREES`. */
const CAMERA_PITCH = 38 * DEG;

/**
 * Two framing yaws, and the reason this game has two.
 *
 * At the park's 45° the garden lies across the screen as a wide diamond, which
 * is exactly right on a laptop and a tablet and hopeless on a phone held
 * upright — fitting a 16 m diamond into a 390-pixel width leaves the children
 * four per cent of the screen tall. At 88° the camera looks very nearly straight
 * down the garden's long axis instead, so the garden becomes *tall* and narrow
 * and fits a portrait screen the right way round. Not 90°: a few degrees off
 * keeps the side fences from collapsing to a line, so the garden still reads as
 * a box you are standing in.
 *
 * Every direction the player can walk is derived from whichever is in force, so
 * turning the phone turns the garden and "up the screen" keeps meaning "away
 * from me".
 */
const LANDSCAPE_YAW = 45 * DEG;
const PORTRAIT_YAW = 88 * DEG;

/** Far enough back that nothing in the garden clips the near plane. */
const CAMERA_DISTANCE = 60;

/** Breathing room around the fitted garden, in metres. */
const FIT_MARGIN = 0.6;

/** How high above the ground a shot aims. Chest height on a 2.12 m child. */
const AIM_HEIGHT = 1.25;

/** The five other children. Bright, distinct gun colours — that is how you tell them apart. */
const RIVALS = [
  { name: 'Pip', hair: 0x6b4a8f, outfit: PALETTE.markerLemon, gun: PALETTE.markerLemon, hairStyle: 'short' as const },
  { name: 'Nell', hair: 0xd2694a, outfit: PALETTE.markerMint, gun: PALETTE.markerMint, hairStyle: 'bob' as const },
  { name: 'Otto', hair: 0x4a3a52, outfit: PALETTE.markerSky, gun: PALETTE.markerSky, hairStyle: 'short' as const },
  { name: 'Ruby', hair: 0xf0a54a, outfit: PALETTE.markerLilac, gun: PALETTE.markerLilac, hairStyle: 'bunches' as const },
  { name: 'Sam', hair: 0x8b5a3c, outfit: PALETTE.flowerRed, gun: PALETTE.flowerRed, hairStyle: 'bob' as const },
];

type Phase = 'countdown' | 'fighting' | 'celebrating';

interface Fighter {
  readonly model: ChildModel;
  readonly name: string;
  readonly colour: number;
  readonly isPlayer: boolean;
  x: number;
  z: number;
  /** Where they are walking to. */
  goalX: number;
  goalZ: number;
  /** Seconds until they pick somewhere new to stand. */
  wanderLeft: number;
  charge: number;
  charging: boolean;
  /** Index into `fighters`, or -1. */
  aimAt: number;
  /** Seconds before this child will squirt again. */
  cooldown: number;
  /** How worked up they are, 0..1. Splashes raise it; it never falls to zero. */
  excitement: number;
  /** How full a tank this child is waiting for before letting go. */
  releaseAt: number;
  /** How many times they have been splashed this round. */
  soakings: number;
}

interface Shot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  time: number;
  flight: number;
  power: number;
  owner: number;
  target: number;
}

class WaterFight implements MiniGame {
  readonly id = 'waterFight';
  readonly title = 'Water Fight';
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, CAMERA_DISTANCE * 3);

  private context: MiniGameContext | null = null;
  private controls: WaterFightControls | null = null;
  private hud: WaterFightHud | null = null;
  private portraits: WaterFightPortraits | null = null;
  private garden: Garden | null = null;
  private water: WaterSystem | null = null;
  private rainbow: Rainbow | null = null;
  private confetti: Confetti | null = null;
  private skyTexture: CanvasTexture | null = null;
  private aimRing: Mesh | null = null;
  private aimRingMaterial: MeshBasicMaterial | null = null;

  private readonly fighters: Fighter[] = [];
  private readonly shots: Shot[] = [];
  private readonly rng = new Rng(0x5a1a5b);

  private phase: Phase = 'countdown';
  private countdown = COUNTDOWN;
  private timeLeft = ROUND_SECONDS;
  private resultTime = 0;
  private points = 0;
  private streak = 0;
  private streakLeft = 0;
  private rainbowClaimed = false;
  private celebrationBurst = 0;
  private newBest = false;

  /** Set while the player is charging with a finger rather than a key. */
  private pointerCharging = false;
  private holdPrevious = false;
  /** Where a tap on the grass told the player to walk. */
  private walkGoal: { x: number; z: number } | null = null;

  private aspect = 1;
  private yaw = LANDSCAPE_YAW;
  private sprinklerPhase = 0;
  /** Metres of pool walked through since the last splashy footstep. */
  private paddled = 0;

  // Scratch, so nothing is allocated per frame.
  private readonly scratchA = new Vector3();
  private readonly scratchB = new Vector3();
  private readonly forward = new Vector3(0, 0, -1);
  private readonly right = new Vector3(1, 0, 0);

  // -------------------------------------------------------------------- setup

  init(context: MiniGameContext): void {
    this.context = context;

    this.skyTexture = paintSky();
    this.scene.background = this.skyTexture;

    // The rig the art was approved under (ART_DIRECTION §6), shadows included.
    // The rail racer does without them because it is a flat storybook page; this
    // is the park's own isometric view of a garden, and without a soft shadow
    // under each child they all look like stickers floating a foot above the
    // lawn. The shadow camera is wound right in to the garden — a default one
    // spreads its map over hundreds of metres of nothing.
    this.scene.add(new HemisphereLight(PALETTE.ambientDay, PALETTE.grass, 1.15));
    const key = new DirectionalLight(PALETTE.sunDay, 2.25);
    key.position.set(18, 34, 22);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 4;
    key.shadow.camera.far = 90;
    key.shadow.camera.left = -18;
    key.shadow.camera.right = 18;
    key.shadow.camera.top = 18;
    key.shadow.camera.bottom = -18;
    key.shadow.bias = -0.0006;
    this.scene.add(key, key.target);
    const fill = new DirectionalLight(PALETTE.skyDayBottom, 0.6);
    fill.position.set(-24, 16, -18);
    this.scene.add(fill);

    this.garden = createGarden();
    this.scene.add(this.garden.root);

    this.water = createWaterSystem();
    this.scene.add(this.water.root);

    // Hung off the camera, so `y` is screen metres and the 38° pitch cannot
    // sail it off the top of the frame. That means the camera itself has to be
    // in the scene graph, which it otherwise would not need to be.
    this.rainbow = createRainbow();
    this.camera.add(this.rainbow.root);
    this.scene.add(this.camera);

    this.confetti = createConfetti();
    this.scene.add(this.confetti.root);

    // The ring under whoever you are about to squirt. One mesh, moved about —
    // it is the only piece of UI that lives in the world rather than in the DOM,
    // because it has to say *that* child, and only a thing in the garden can.
    this.aimRingMaterial = new MeshBasicMaterial({
      color: PALETTE.markerPink,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    this.aimRing = new Mesh(new TorusGeometry(0.62, 0.075, 8, 26), this.aimRingMaterial);
    this.aimRing.rotation.x = -Math.PI / 2;
    this.aimRing.position.y = 0.05;
    this.aimRing.visible = false;
    this.aimRing.renderOrder = 4;
    this.scene.add(this.aimRing);

    for (let i = 0; i < SHOT_CAPACITY; i += 1) {
      this.shots.push({
        active: false,
        x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0,
        time: 0, flight: 1, power: 0,
        owner: -1, target: -1,
      });
    }

    this.buildFighters();

    this.controls = createControls();

    // A little head for everybody in the fight, at the top edge of the HUD —
    // see `portraits.ts` for why this replaced the pop-up messages. Built in
    // the same order as `this.fighters` (rivals, then the player), so an
    // index into one is always an index into the other.
    const portraitPlayer = gameStore.get().player;
    const portraitFighters: PortraitFighterInfo[] = [
      ...RIVALS.map((rival): PortraitFighterInfo => ({
        name: rival.name,
        hair: rival.hair,
        accent: rival.gun,
        isPlayer: false,
      })),
      { name: portraitPlayer.name, hair: portraitPlayer.hairColour, accent: PALETTE.markerPink, isPlayer: true },
    ];
    this.portraits = createPortraitRow(context.overlay, portraitFighters);

    this.hud = createWaterFightHud(context.overlay);
    this.hud.setBest(bestSplashPoints());
    this.hud.setPoints(0);
    this.hud.setTime(ROUND_SECONDS);
    this.hud.setHint(
      context.touch
        ? 'Tap a friend to squirt · hold for a BIG soak · tap the grass to walk'
        : 'WASD or arrows to walk · hold Space to squirt the nearest friend',
    );

    this.applyCamera();
  }

  private buildFighters(): void {
    const group = new Group();
    group.name = 'waterfight:children';
    this.scene.add(group);

    const player = gameStore.get().player;

    // Everybody starts on a ring around the middle, facing in. Nobody starts
    // behind a hedge, and nobody starts within squirting distance of anybody
    // else — the first shot of a round should be one somebody chose to take.
    const positions: [number, number][] = [
      [0, 4.4],
      [-5.6, 3.6],
      [5.6, 3.4],
      [-6.4, -3.4],
      [6.4, -3.2],
      [0, -4.6],
    ];

    RIVALS.forEach((rival, index) => {
      const spot = positions[index + 1] ?? [0, 0];
      const model = createChild({
        hair: rival.hair,
        outfit: rival.outfit,
        gun: rival.gun,
        hairStyle: rival.hairStyle,
      });
      group.add(model.root);
      this.fighters.push(this.makeFighter(model, rival.name, rival.gun, false, spot[0], spot[1]));
    });

    // The player plays as themselves — their own hair from the park, and a
    // bright pink gun and outfit nobody else has, which is the lesson the rail
    // racer learned about telling six near-identical children apart.
    const spot = positions[0] ?? [0, 0];
    const model = createChild({
      hair: player.hairColour,
      outfit: PALETTE.markerPink,
      gun: PALETTE.markerPink,
      hairStyle: 'bunches',
      label: { text: 'YOU', accent: PALETTE.markerPink },
    });
    group.add(model.root);
    this.fighters.push(this.makeFighter(model, player.name, PALETTE.markerPink, true, spot[0], spot[1]));

    for (const fighter of this.fighters) {
      fighter.model.root.position.set(fighter.x, 0, fighter.z);
      // Everyone looks at the middle of the garden to start with.
      fighter.model.setFacing(Math.atan2(-fighter.x, -fighter.z));
    }
  }

  private makeFighter(
    model: ChildModel,
    name: string,
    colour: number,
    isPlayer: boolean,
    x: number,
    z: number,
  ): Fighter {
    return {
      model,
      name,
      colour,
      isPlayer,
      x,
      z,
      goalX: x,
      goalZ: z,
      wanderLeft: this.rng.range(1.2, 3.4),
      charge: 0,
      charging: false,
      aimAt: -1,
      // Staggered, so the first volley is a scatter rather than a salvo.
      cooldown: isPlayer ? 0 : this.rng.range(1.4, 4.2),
      excitement: 0,
      releaseAt: this.rng.range(0.45, 1),
      soakings: 0,
    };
  }

  // -------------------------------------------------------------------- frame

  update(frame: MiniGameFrame): void {
    const { dt, elapsed, input } = frame;
    const controls = this.controls;
    if (!controls) return;

    switch (this.phase) {
      case 'countdown':
        this.countdown -= dt;
        this.hud?.setCount(countdownText(this.countdown));
        if (this.countdown <= 0) {
          this.phase = 'fighting';
          // `countdownText` already showed "SPLASH!" as the last frame of the
          // count above — nothing more needed here, and nothing left to clear
          // but the count itself. That is the point: the one thing telling you
          // the fight has started is gone before the fight has properly begun.
          this.hud?.setCount(null);
        }
        break;

      case 'fighting':
        this.timeLeft -= dt;
        this.hud?.setTime(this.timeLeft);
        this.drivePlayer(dt, controls, input.hold, input.hold && !this.holdPrevious, !input.hold && this.holdPrevious);
        this.driveRivals(dt);
        if (this.timeLeft <= 0) this.celebrate();
        break;

      case 'celebrating':
        this.resultTime += dt;
        // The other children carry on splashing behind the card. A garden that
        // freezes the moment the whistle goes never looked like it was alive.
        this.driveRivals(dt);
        this.celebrationBurst -= dt;
        if (this.celebrationBurst <= 0) {
          this.celebrationBurst = 0.4;
          this.throwConfetti(this.newBest ? 34 : 18);
        }
        if (
          this.resultTime > RESULT_LOCKOUT &&
          (controls.pointerReleased || (input.hold && !this.holdPrevious) || input.quit ||
            this.resultTime > RESULT_TIMEOUT)
        ) {
          this.reportResult();
        }
        break;
    }

    this.holdPrevious = input.hold;

    this.updateShots(dt);
    this.updateSprinklers(dt);

    for (let i = 0; i < this.fighters.length; i += 1) {
      const fighter = this.fighters[i];
      if (!fighter) continue;
      fighter.model.setCharge(fighter.charge);
      fighter.model.update(dt, elapsed, this.walkSpeedOf(fighter));
      fighter.model.root.position.set(fighter.x, 0, fighter.z);
      // The portrait's own wet fade watches the same flag the drippy 3D hair
      // does, so the little face at the edge of the screen never disagrees
      // with the child it belongs to.
      this.portraits?.setSoaked(i, fighter.model.soaked);
    }

    this.water?.update(dt, this.camera.quaternion);
    this.rainbow?.update(dt, this.water?.density ?? 0);
    this.garden?.update(dt, elapsed);
    this.confetti?.update(dt);
    this.updateAimRing(dt);
    this.hud?.update(dt);
    this.portraits?.update(dt);

    // The rainbow's one-off bonus. Claimed once a round, so it is a moment
    // rather than an income. The 3D rainbow in the garden (`rainbow.ts`) is
    // the only announcement it gets — no HUD banner repeating what is already
    // visible right there in the sky.
    if (!this.rainbowClaimed && this.phase === 'fighting' && this.rainbow?.showing) {
      this.rainbowClaimed = true;
      this.addPoints(POINTS_RAINBOW);
    }

    controls.endFrame();
  }

  // ------------------------------------------------------------------- player

  private drivePlayer(
    dt: number,
    controls: WaterFightControls,
    hold: boolean,
    holdPressed: boolean,
    holdReleased: boolean,
  ): void {
    const player = this.player;

    // --- what is the finger doing? -------------------------------------------
    // The pointer takes precedence over `input.hold`, and has to: the framework
    // merges "a finger is down anywhere" into `hold` as well, so reading both
    // would charge twice and fire twice from one tap.
    if (controls.pointerPressed) {
      const tapped = this.childAtScreen(controls.pointerX, controls.pointerY);
      if (tapped >= 0 && tapped !== this.playerIndex) {
        this.beginCharge(player, tapped);
        this.pointerCharging = true;
        this.walkGoal = null;
      } else {
        // Grass: walk there. Tap-to-move, exactly as in the park, so the one
        // control a child already knows carries into the garden.
        this.setWalkGoalFromScreen(controls.pointerX, controls.pointerY);
      }
    }

    if (this.pointerCharging && controls.pointerDown) {
      player.charge = clamp01(player.charge + dt / CHARGE_SECONDS);
    }

    if (this.pointerCharging && controls.pointerReleased) {
      this.fire(this.playerIndex);
      this.pointerCharging = false;
    }

    // Dragging on the grass keeps re-aiming the walk, which is what a finger
    // sliding across a screen obviously means.
    if (!this.pointerCharging && controls.pointerDown && controls.dragged) {
      this.setWalkGoalFromScreen(controls.pointerX, controls.pointerY);
    }

    // --- and the keyboard? ----------------------------------------------------
    if (!this.pointerCharging) {
      if (holdPressed) {
        const nearest = this.nearestTo(this.playerIndex);
        if (nearest >= 0) this.beginCharge(player, nearest);
      }
      if (hold && player.charging) player.charge = clamp01(player.charge + dt / CHARGE_SECONDS);
      if (holdReleased && player.charging) this.fire(this.playerIndex);
    }

    // --- walking ---------------------------------------------------------------
    const moveX = controls.moveX;
    const moveY = controls.moveY;
    let dirX = 0;
    let dirZ = 0;
    if (moveX !== 0 || moveY !== 0) {
      // Camera-relative, so "up" is always up the screen whichever way the
      // garden is framed (see the note on the two yaws).
      dirX = this.right.x * moveX + this.forward.x * moveY;
      dirZ = this.right.z * moveX + this.forward.z * moveY;
      this.walkGoal = null;
    } else if (this.walkGoal) {
      const dx = this.walkGoal.x - player.x;
      const dz = this.walkGoal.z - player.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 0.3) this.walkGoal = null;
      else {
        dirX = dx / distance;
        dirZ = dz / distance;
      }
    }

    const length = Math.hypot(dirX, dirZ);
    if (length > 0.001) {
      const speed = PLAYER_SPEED * (player.charging ? CHARGING_SPEED_FACTOR : 1) * dt;
      player.x += (dirX / length) * speed;
      player.z += (dirZ / length) * speed;
      keepInGarden(player);
      // Facing the way you are going, unless you are lining a shot up — then
      // you face your friend, and run sideways like a proper water fight.
      if (!player.charging) player.model.setFacing(Math.atan2(dirX, dirZ));
    }

    if (player.charging) {
      const target = this.fighters[player.aimAt];
      if (target) player.model.setFacing(Math.atan2(target.x - player.x, target.z - player.z));
    }

    this.separate(player);

    if (this.streakLeft > 0) {
      this.streakLeft -= dt;
      if (this.streakLeft <= 0) this.streak = 0;
    }
  }

  // ------------------------------------------------------------------- rivals

  /**
   * Everything the other five children do.
   *
   * They wander, they squirt, and when they are splashed they giggle and splash
   * back — which is the only rule that really matters, because it is what makes
   * the fight escalate on its own. `excitement` is the escalation: every
   * soaking raises it a little, and it shortens the wait before the next shot
   * for the rest of the round. Nothing ever brings it down, so a garden that
   * starts as an occasional squirt reliably ends as a free-for-all.
   */
  private driveRivals(dt: number): void {
    const fighting = this.phase === 'fighting';

    for (let i = 0; i < this.fighters.length; i += 1) {
      const fighter = this.fighters[i];
      if (!fighter || fighter.isPlayer) continue;

      if (fighter.charging) {
        fighter.charge = clamp01(fighter.charge + dt / CHARGE_SECONDS);
        const target = this.fighters[fighter.aimAt];
        if (target) fighter.model.setFacing(Math.atan2(target.x - fighter.x, target.z - fighter.z));
        if (fighter.charge >= fighter.releaseAt) this.fire(i);
      } else if (fighting) {
        fighter.cooldown -= dt * (1 + fighter.excitement * 2.2);
        if (fighter.cooldown <= 0) {
          const target = fighter.aimAt >= 0 ? fighter.aimAt : this.pickTarget(i);
          if (target >= 0) this.beginCharge(fighter, target);
        }
      }

      // --- wandering ---------------------------------------------------------
      fighter.wanderLeft -= dt;
      if (fighter.wanderLeft <= 0) {
        fighter.wanderLeft = this.rng.range(1.8, 4.4);
        fighter.goalX = this.rng.range(-WALK_HALF_X + 0.6, WALK_HALF_X - 0.6);
        fighter.goalZ = this.rng.range(-WALK_HALF_Z + 0.6, WALK_HALF_Z - 0.6);
      }

      const dx = fighter.goalX - fighter.x;
      const dz = fighter.goalZ - fighter.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 0.35) {
        const speed = RIVAL_SPEED * (fighter.charging ? CHARGING_SPEED_FACTOR : 1) * dt;
        fighter.x += (dx / distance) * speed;
        fighter.z += (dz / distance) * speed;
        keepInGarden(fighter);
        if (!fighter.charging) fighter.model.setFacing(Math.atan2(dx, dz));
      }

      this.separate(fighter);
    }
  }

  /** Who a rival squirts next. Weighted towards the player, but never only them. */
  private pickTarget(index: number): number {
    if (this.rng.chance(0.45)) return this.playerIndex;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const candidate = this.rng.int(0, this.fighters.length - 1);
      if (candidate !== index) return candidate;
    }
    return this.playerIndex;
  }

  /** Nudges two children who have walked into each other apart. */
  private separate(fighter: Fighter): void {
    for (const other of this.fighters) {
      if (other === fighter) continue;
      const dx = fighter.x - other.x;
      const dz = fighter.z - other.z;
      const distance = Math.hypot(dx, dz);
      const minimum = CHILD_RADIUS * 2;
      if (distance >= minimum || distance < 0.0001) continue;
      const push = (minimum - distance) * 0.5;
      fighter.x += (dx / distance) * push;
      fighter.z += (dz / distance) * push;
    }
    keepInGarden(fighter);
  }

  // -------------------------------------------------------------------- shots

  private beginCharge(fighter: Fighter, target: number): void {
    if (this.phase !== 'fighting') return;
    fighter.charging = true;
    fighter.charge = 0;
    fighter.aimAt = target;
  }

  /**
   * Lets a charged shot go.
   *
   * The launch velocity is solved for a fixed flight time rather than a fixed
   * speed, which is what makes every arc land where it was pointed regardless of
   * how far away the target is — and it is re-solved every frame in
   * {@link updateShots}, so a friend who runs while the water is in the air
   * still gets it. Missing is not a thing this garden does.
   */
  private fire(index: number): void {
    const fighter = this.fighters[index];
    if (!fighter || !fighter.charging) return;
    fighter.charging = false;

    const target = this.fighters[fighter.aimAt];
    const power = 0.3 + fighter.charge * 0.7;
    fighter.charge = 0;
    // A rival who has just fired waits before deciding on the next one, and
    // forgets who splashed them — otherwise two children lock on to each other
    // and nobody else in the garden ever gets wet.
    if (!fighter.isPlayer) {
      fighter.cooldown = this.rng.range(1.5, 3.6);
      fighter.releaseAt = this.rng.range(0.45, 1);
      fighter.aimAt = -1;
    }
    if (!target || target === fighter) return;

    let shot: Shot | undefined;
    for (const candidate of this.shots) {
      if (!candidate.active) {
        shot = candidate;
        break;
      }
    }

    const muzzle = fighter.model.muzzleWorld(this.scratchA);
    this.water?.muzzle(
      muzzle.x,
      muzzle.y,
      muzzle.z,
      Math.sin(fighter.model.root.rotation.y) * 6,
      2,
      Math.cos(fighter.model.root.rotation.y) * 6,
      power,
    );
    if (!shot) return;

    const distance = Math.hypot(target.x - fighter.x, target.z - fighter.z);
    shot.active = true;
    shot.x = muzzle.x;
    shot.y = muzzle.y;
    shot.z = muzzle.z;
    shot.time = 0;
    // Longer shots hang in the air longer, which keeps the arc looking like an
    // arc instead of flattening into a laser as the garden gets crowded.
    shot.flight = clamp(0.3 + distance * 0.05, 0.32, 0.9);
    shot.power = power;
    shot.owner = index;
    shot.target = this.fighters.indexOf(target);
    this.solveShot(shot, target);
  }

  /** Points the shot at where the target is now, for the time it has left. */
  private solveShot(shot: Shot, target: Fighter): void {
    const remaining = Math.max(shot.flight - shot.time, 0.06);
    shot.vx = (target.x - shot.x) / remaining;
    shot.vz = (target.z - shot.z) / remaining;
    shot.vy = (AIM_HEIGHT - shot.y) / remaining + 0.5 * SHOT_GRAVITY * remaining;
  }

  private updateShots(dt: number): void {
    const water = this.water;
    for (const shot of this.shots) {
      if (!shot.active) continue;

      const target = this.fighters[shot.target];
      if (target) this.solveShot(shot, target);

      shot.vy -= SHOT_GRAVITY * dt;
      shot.x += shot.vx * dt;
      shot.y += shot.vy * dt;
      shot.z += shot.vz * dt;
      shot.time += dt;

      water?.trail(shot.x, shot.y, shot.z, shot.vx, shot.vy, shot.vz, shot.power);

      if (shot.time >= shot.flight) {
        shot.active = false;
        water?.splash(shot.x, shot.y, shot.z, shot.power);
        if (target) this.land(shot.owner, shot.target, shot.power);
      }
    }
  }

  /**
   * A squirt has landed on somebody.
   *
   * All the canon effects fire from here: the drippy hair, the splash back,
   * and — if it was your shot — the splash points. What used to also be a
   * pop-up message ("Hee hee!", "SOAKED Nell!") is now the portrait row
   * instead: whoever landed the shot gets a brief smile, and whoever was hit
   * gets the wet portrait — no text over the garden either way.
   */
  private land(ownerIndex: number, targetIndex: number, power: number): void {
    const target = this.fighters[targetIndex];
    if (!target) return;

    target.model.soak();
    target.soakings += 1;
    // The one who landed it smiles, splasher or splashee alike — this fires
    // for every hit in the garden, not only the player's, so the whole row of
    // portraits stays alive.
    this.portraits?.score(ownerIndex);
    // Every soaking winds the whole garden up a little, not just the child who
    // got it: this is the "the fight gets bigger" line, as a number.
    target.excitement = clamp01(target.excitement + 0.16);
    for (const other of this.fighters) {
      if (!other.isPlayer) other.excitement = clamp01(other.excitement + 0.02);
    }

    if (target.isPlayer) {
      // Being splashed is a joke, never a setback. Your tank is topped up as a
      // thank-you for standing still long enough to get hit — the giggle and
      // the drippy hair are the wet portrait's job now, not a message's.
      if (this.pointerCharging || this.player.charging) {
        this.player.charge = clamp01(this.player.charge + 0.3);
      }
      return;
    }

    // Splashed children splash back — after a beat, because an instant reply
    // reads as a machine and a half-second one reads as a decision.
    if (!target.charging) {
      target.aimAt = ownerIndex;
      target.cooldown = this.rng.range(0.3, 0.9);
    }

    if (ownerIndex !== this.playerIndex) return;

    this.streak = Math.min(this.streak + 1, STREAK_CAP);
    this.streakLeft = STREAK_WINDOW;
    const scored = Math.round(POINTS_BASE + power * POINTS_CHARGE + this.streak * POINTS_STREAK);
    this.addPoints(scored);
  }

  private addPoints(amount: number): void {
    this.points += amount;
    this.hud?.setPoints(this.points);
    this.hud?.gain(amount);
  }

  // ------------------------------------------------------------------ garden

  /** The sprinklers, hissing away and quietly keeping the air damp. */
  private updateSprinklers(dt: number): void {
    const water = this.water;
    const heads = this.garden?.sprinklerHeads;
    if (!water || !heads) return;
    this.sprinklerPhase += dt;
    // Six droplets a second each, all round: enough to see, nowhere near enough
    // to bring the rainbow out on its own.
    const per = 1 / 6;
    while (this.sprinklerPhase >= per) {
      this.sprinklerPhase -= per;
      for (const head of heads) {
        water.mist(head.x, head.y, head.z, this.rng.range(0, Math.PI * 2));
      }
    }

    // Splashy footsteps: anybody wading through a paddling pool kicks water up
    // as they go. Metered by distance travelled rather than by time, so walking
    // through one makes a spray and standing in one does not.
    this.paddled += dt;
    if (this.paddled < 0.09) return;
    this.paddled = 0;
    for (const fighter of this.fighters) {
      if (this.walkSpeedOf(fighter) < 0.2) continue;
      if (!poolAt(fighter.x, fighter.z)) continue;
      water.mist(fighter.x, 0.16, fighter.z, this.rng.range(0, Math.PI * 2));
    }
  }

  private updateAimRing(dt: number): void {
    const ring = this.aimRing;
    const material = this.aimRingMaterial;
    if (!ring || !material) return;
    const player = this.player;
    const target = player.charging ? this.fighters[player.aimAt] : undefined;
    if (!target) {
      material.opacity = damp(material.opacity, 0, 0.08, dt);
      ring.visible = material.opacity > 0.02;
      return;
    }
    ring.visible = true;
    ring.position.set(target.x, 0.06, target.z);
    material.opacity = damp(material.opacity, 0.85, 0.05, dt);
    // Tightens as the tank fills, so the ring is also the charge meter for
    // anybody watching the target rather than their own gun.
    ring.scale.setScalar(1.35 - player.charge * 0.35);
  }

  // ---------------------------------------------------------------- finishing

  private celebrate(): void {
    this.phase = 'celebrating';
    this.resultTime = 0;
    this.celebrationBurst = 0;
    this.timeLeft = 0;
    this.hud?.setTime(0);
    this.hud?.setHint(null);

    for (const fighter of this.fighters) {
      fighter.charging = false;
      fighter.charge = 0;
      fighter.model.setCheering(true);
    }

    const record = recordSplashPoints(this.points);
    this.newBest = record.isNewBest;
    this.hud?.setBest(record.best);
    this.throwConfetti(record.isNewBest ? 70 : 34);

    const touch = this.context?.touch ?? false;
    this.hud?.setCount(null);
    this.hud?.showResult(
      record.isNewBest ? 'NEW BEST! 🌈' : 'What a splash!',
      `${this.points} splash points`,
      touch ? 'Tap to go back to the park' : 'Press Space to go back to the park',
    );
  }

  private throwConfetti(count: number): void {
    const player = this.player;
    this.confetti?.burst(player.x, 3.4, player.z, count, 1.2);
  }

  private reportResult(): void {
    this.context?.finish({
      id: this.id,
      outcome: 'finished',
      seconds: ROUND_SECONDS,
      message: this.newBest
        ? `A new best — ${this.points} splash points!`
        : `${this.points} splash points!`,
    });
  }

  // ------------------------------------------------------------------ picking

  /**
   * Which child is under (or nearest to) a point on the screen.
   *
   * Screen-space distance to each child's head rather than a raycast against
   * their geometry, and generously so: a small finger on a phone lands three
   * centimetres wide of where its owner thought it did, and a tap that hits
   * nobody because it clipped past an ear is the most annoying thing a game
   * like this can do. The nearest child wins, so long as they are within a
   * radius scaled to the screen.
   */
  private childAtScreen(clientX: number, clientY: number): number {
    const canvas = this.context?.renderer.domElement;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const radius = Math.max(64, Math.min(rect.width, rect.height) * 0.2);

    let best = -1;
    let bestDistance = radius;
    for (let i = 0; i < this.fighters.length; i += 1) {
      const fighter = this.fighters[i];
      if (!fighter || fighter.isPlayer) continue;
      // Aim at the middle of the child, not the head: a finger goes for the
      // body, and the head is the top third of it.
      this.scratchB.set(fighter.x, 1.2, fighter.z).project(this.camera);
      const px = rect.left + (this.scratchB.x * 0.5 + 0.5) * rect.width;
      const py = rect.top + (-this.scratchB.y * 0.5 + 0.5) * rect.height;
      const distance = Math.hypot(clientX - px, clientY - py);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  /** Turns a tap on the grass into somewhere to walk. */
  private setWalkGoalFromScreen(clientX: number, clientY: number): void {
    const canvas = this.context?.renderer.domElement;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    // Unprojecting one point and walking along the view direction is all an
    // orthographic camera needs — every ray is parallel, so there is no eye
    // position to work from.
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const origin = this.scratchA.set(nx, ny, -1).unproject(this.camera);
    const direction = this.scratchB.set(0, 0, -1).transformDirection(this.camera.matrixWorld);
    if (Math.abs(direction.y) < 0.0001) return;
    const t = -origin.y / direction.y;
    if (t < 0) return;

    const goal = { x: origin.x + direction.x * t, z: origin.z + direction.z * t };
    keepInGarden(goal);
    this.walkGoal = goal;
  }

  /** The closest other child, for the keyboard's "squirt the nearest friend". */
  private nearestTo(index: number): number {
    const from = this.fighters[index];
    if (!from) return -1;
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < this.fighters.length; i += 1) {
      const fighter = this.fighters[i];
      if (!fighter || i === index) continue;
      const distance = Math.hypot(fighter.x - from.x, fighter.z - from.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------- camera

  /**
   * Frames the whole garden, in any shape of window, without ever cropping it.
   *
   * The rule is the one the rail racer arrived at from the other end: decide
   * what must be visible in metres, then let the aspect ratio decide which way
   * to grow. Here the list is the walkable lawn, a child's height standing on
   * the far edge of it, and the top of the rainbow — projected on to the
   * camera's own screen axes, so it is correct for either framing yaw. Whichever
   * of width or height is short at this aspect is the one that sets the scale,
   * so a narrow window gets more sky and a wide one gets more lawn, and the
   * garden itself is always all there.
   */
  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    this.yaw = this.aspect < 1 ? PORTRAIT_YAW : LANDSCAPE_YAW;
    this.applyCamera();

    const sinYaw = Math.sin(this.yaw);
    const cosYaw = Math.cos(this.yaw);
    const sinPitch = Math.sin(CAMERA_PITCH);
    const cosPitch = Math.cos(CAMERA_PITCH);
    // The camera's own screen axes, derived rather than read back, because they
    // are wanted before anything has been rendered.
    const rightX = cosYaw;
    const rightZ = -sinYaw;
    const upX = -sinYaw * sinPitch;
    const upY = cosPitch;
    const upZ = -cosYaw * sinPitch;

    let needX = 0;
    let needY = RAINBOW_SCREEN_TOP;
    for (const x of [-WALK_HALF_X, WALK_HALF_X]) {
      for (const z of [-WALK_HALF_Z, WALK_HALF_Z]) {
        for (const y of [0, CHILD_TOP]) {
          needX = Math.max(needX, Math.abs(x * rightX + z * rightZ));
          needY = Math.max(needY, Math.abs(x * upX + y * upY + z * upZ));
        }
      }
    }
    needX += FIT_MARGIN;
    needY += FIT_MARGIN;

    const halfWidth = Math.max(needX, needY * this.aspect);
    const halfHeight = halfWidth / this.aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  private applyCamera(): void {
    const horizontal = Math.cos(CAMERA_PITCH) * CAMERA_DISTANCE;
    this.camera.position.set(
      Math.sin(this.yaw) * horizontal,
      Math.sin(CAMERA_PITCH) * CAMERA_DISTANCE,
      Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(0, 0.9, 0);
    this.camera.updateMatrixWorld();

    // The ground-plane basis the walk keys are interpreted through.
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  // --------------------------------------------------------------- lifecycle

  dispose(): void {
    for (const fighter of this.fighters) fighter.model.dispose();
    this.fighters.length = 0;
    this.shots.length = 0;
    this.controls?.dispose();
    this.hud?.dispose();
    this.portraits?.dispose();
    this.garden?.dispose();
    this.water?.dispose();
    this.rainbow?.dispose();
    this.confetti?.dispose();
    this.aimRing?.geometry.dispose();
    this.aimRingMaterial?.dispose();
    this.skyTexture?.dispose();
    this.scene.background = null;
    this.scene.clear();
    this.context = null;
  }

  // --------------------------------------------------------------- internals

  private get playerIndex(): number {
    return this.fighters.length - 1;
  }

  private get player(): Fighter {
    const player = this.fighters[this.fighters.length - 1];
    if (!player) throw new Error('Water fight: nobody was built to play as.');
    return player;
  }

  /** 0..1 of a running child, for the walk cycle. */
  private walkSpeedOf(fighter: Fighter): number {
    if (fighter.isPlayer) {
      const moving = this.walkGoal !== null || (this.controls?.moveX ?? 0) !== 0 || (this.controls?.moveY ?? 0) !== 0;
      return moving ? (fighter.charging ? 0.45 : 1) : 0;
    }
    const distance = Math.hypot(fighter.goalX - fighter.x, fighter.goalZ - fighter.z);
    return distance > 0.35 ? (fighter.charging ? 0.4 : 0.85) : 0;
  }
}

/** The factory the stall registers. */
export function createWaterFight(): MiniGame {
  return new WaterFight();
}

// ------------------------------------------------------------------ helpers

function countdownText(remaining: number): string {
  if (remaining > 2.2) return '3';
  if (remaining > 1.2) return '2';
  if (remaining > 0.2) return '1';
  return 'SPLASH!';
}
