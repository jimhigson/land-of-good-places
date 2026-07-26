import {
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from 'three';
import { PALETTE } from '../../core/palette';
import { clamp, clamp01, damp, lerp, smoothstep } from '../../core/mathUtils';
import { createWorldBelow, type WorldBelow } from './below';
import { createGondola, type Gondola } from './gondola';
import { createAlienSaucer, createSpaceRipika, type SpaceFriend } from './friends';
import { createSpaceShow, type SpaceShow } from './space';
import { createSparks, type Sparks } from './sparks';
import { HOLD_SECONDS, createRideHud, type RideHud } from './hud';
import type { MiniGame, MiniGameContext, MiniGameFrame } from '../types';

/**
 * **The Space Ferris Wheel** — the ride that goes all the way up to space.
 *
 * This is family canon, written down in GAME_DESIGN.md long before there was
 * anything to ride: the park gets small, then the whole Earth is below you,
 * there are twinkling stars and the Moon and colourful planets, a friendly alien
 * waves from a flying saucer, and Space RiPika floats past the window in a tiny
 * astronaut helmet. Everything on that list is in here, because the list is the
 * brief.
 *
 * It is a **ride, not a game**. There is nothing to win, nothing to fail, and no
 * score. What there is instead:
 *
 * - **Ninety seconds, shaped.** Six to settle in, twenty-four climbing, forty in
 *   space, sixteen coming home. Long enough to be a journey, short enough that a
 *   six-year-old is still watching at the end.
 * - **Something to do with your hands.** Tap the alien or Space RiPika and they
 *   wave back with confetti sparks. That is the entire interaction, it can never
 *   go wrong, and it is the difference between a cut-scene and a ride.
 * - **A way out that cannot happen by accident.** Hold for {@link HOLD_SECONDS}
 *   and the wheel hurries you home, with a filling ring the whole time. The
 *   framework's ✕ is still there for a grown-up in a hurry. Neither writes
 *   anything anywhere, so leaving early costs nothing at all.
 *
 * The camera is bolted inside the gondola (`gondola.ts`) and the world outside
 * is moved past it (`below.ts`, `space.ts`) — nothing here actually travels a
 * hundred kilometres.
 */

// -------------------------------------------------------------------- timing

/** Sitting in the car at the bottom, watching the park. */
const BOARD_END = 6;

/** Climbing: the park falls away, the sky darkens, the clouds go by. */
const CLIMB_END = 30;

/** Space. The whole reason for the ride. */
const SPACE_END = 70;

/** Coming down again. */
const DESCEND_END = 86;

/** The card comes up, and a press (or a few seconds) takes you back. */
const RIDE_END = 90;

/** Seconds the card sits there before a press will dismiss it. */
const CARD_LOCKOUT = 0.9;

/** Seconds after which the card dismisses itself. */
const CARD_TIMEOUT = 8;

/** How much faster the wheel turns once you have asked to go home. */
const HURRY_RATE = 4;

// ------------------------------------------------------------------ the show

/** When the saucer arrives, drifts and leaves. */
const ALIEN_IN = 34;
const ALIEN_OUT = 68;

/** When Space RiPika floats past. */
const RIPIKA_IN = 48;
const RIPIKA_OUT = 78;

/** Field of view. Wide: you are sitting inside a small box looking out of it. */
const FOV = 62;

interface Cue {
  readonly at: number;
  readonly say: string;
  /** Skipped if this is already true when the cue comes round. */
  readonly unless?: () => boolean;
  fired?: boolean;
}

class SpaceFerrisWheel implements MiniGame {
  readonly id = 'spaceFerrisWheel';
  readonly title = 'Space Ferris Wheel';
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.05, 3200);

  private context: MiniGameContext | null = null;
  /** The one the framework is drawing into: taps are measured against it. */
  private canvas: HTMLCanvasElement | null = null;
  private hud: RideHud | null = null;
  private gondola: Gondola | null = null;
  private below: WorldBelow | null = null;
  private space: SpaceShow | null = null;
  private sparks: Sparks | null = null;
  private alien: SpaceFriend | null = null;
  private ripika: SpaceFriend | null = null;

  private readonly sky = new Color();
  private readonly dayAmbient = new Color(PALETTE.ambientDay);
  private readonly hemisphere = new HemisphereLight(PALETTE.ambientDay, PALETTE.grass, 1.15);
  private readonly key = new DirectionalLight(PALETTE.sunDay, 2.2);
  private readonly fill = new DirectionalLight(PALETTE.skyDayBottom, 0.5);

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly scratch = new Vector3();

  /** Ride clock in seconds. Not the frame's elapsed: going home speeds it up. */
  private clock = 0;
  private rate = 1;
  private height = 0;
  private holdTime = 0;
  private cardTime = -1;
  private waves = 0;
  private goingHome = false;

  private yaw = 0;
  private pitch = -0.06;

  private readonly cues: Cue[] = [];

  // ------------------------------------------------------------------- setup

  init(context: MiniGameContext): void {
    this.context = context;
    this.canvas = context.renderer.domElement;

    this.scene.background = this.sky.setHex(PALETTE.skyDayBottom);

    // The rig the art was approved under (ART_DIRECTION §6), minus shadows —
    // this little world is lit by one sun and nothing in it stands on anything.
    this.key.position.set(30, 34, -12);
    this.fill.position.set(-26, 10, 24);
    this.scene.add(this.hemisphere, this.key, this.key.target, this.fill);

    this.below = createWorldBelow();
    this.scene.add(this.below.root);

    this.space = createSpaceShow();
    this.scene.add(this.space.root);

    this.gondola = createGondola();
    this.scene.add(this.gondola.root);

    // The camera rides in the car, so the sway is the ride. Rotations are set
    // directly rather than through `lookAt`: aiming at a fixed world point every
    // frame would cancel the sway out and turn the ride into a slideshow.
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, 1.44, 0.78);
    this.gondola.seat.add(this.camera);

    this.alien = createAlienSaucer();
    this.ripika = createSpaceRipika();
    this.scene.add(this.alien.root, this.ripika.root);

    this.sparks = createSparks();
    this.scene.add(this.sparks.root);

    this.hud = createRideHud(context.overlay, context.touch);
    this.hud.setCaption('all aboard!');
    this.hud.shout(
      this.gondola.passengerCount > 0 ? 'Everybody in! Up we go!' : 'All aboard! Up we go!',
      2.6,
    );

    // Cues: the whole script of the ride, in one readable list.
    this.cues.push(
      { at: BOARD_END + 3, say: 'Look how small the park is!' },
      { at: 22, say: 'Through the clouds!' },
      { at: 31, say: 'Look — the whole Earth!' },
      { at: ALIEN_IN + 1.5, say: 'A flying saucer!' },
      { at: ALIEN_IN + 7, say: 'Tap the alien to wave back!', unless: () => this.alien?.greeted ?? false },
      { at: RIPIKA_IN + 1.5, say: "It's Space RiPika!" },
      { at: RIPIKA_IN + 7, say: 'Tap RiPika to wave!', unless: () => this.ripika?.greeted ?? false },
      { at: SPACE_END + 1, say: 'Bye bye, space!' },
      { at: DESCEND_END - 3, say: 'Nearly home!' },
    );

    window.addEventListener('pointerdown', this.onPointerDown, true);
  }

  // ------------------------------------------------------------------- frame

  update(frame: MiniGameFrame): void {
    const { dt, input } = frame;

    this.clock += dt * this.rate;
    this.updateHold(dt, input.hold);

    const height = rideHeight(this.clock);
    this.height = height;

    this.below?.setHeight(height);
    this.space?.setDepth(clamp01((height - 0.5) / 0.35));
    this.applySky(height);

    // One revolution, bottom to bottom, with a slow drift while you are up
    // there so the view never quite stops moving.
    const turn = Math.PI * rideTurn(this.clock) + Math.sin(this.clock * 0.12) * 0.06;
    this.gondola?.setWheelAngle(turn);
    this.gondola?.setLampGlow(clamp01((height - 0.25) / 0.4));
    this.gondola?.update(dt, this.clock);

    this.below?.update(dt, this.clock);
    this.space?.update(dt, this.clock);
    this.updateFriends(dt);
    this.sparks?.update(dt);
    this.aimCamera(dt);

    this.fireCues();
    this.hud?.setCaption(captionFor(this.clock, this.goingHome));
    this.hud?.update(dt);

    if (this.clock >= RIDE_END && this.cardTime < 0) this.showCard();

    if (this.cardTime >= 0) {
      this.cardTime += dt;
      if (this.cardTime > CARD_LOCKOUT && (input.holdPressed || this.cardTime > CARD_TIMEOUT)) {
        this.finish();
      }
    }
  }

  /**
   * Hold to go home.
   *
   * Deliberately not instant, and deliberately not a button in the corner: on a
   * phone the whole screen is the control a small hand can find, and the ring
   * filling up is the only thing that makes holding it safe.
   */
  private updateHold(dt: number, held: boolean): void {
    if (this.cardTime >= 0) {
      this.hud?.setHomeHold(-1, false);
      return;
    }
    if (this.goingHome) {
      this.hud?.setHomeHold(-1, false);
      return;
    }

    this.holdTime = held ? this.holdTime + dt : Math.max(0, this.holdTime - dt * 2.4);
    this.hud?.setHomeHold(this.holdTime / HOLD_SECONDS, held);

    if (this.holdTime >= HOLD_SECONDS) this.goHome();
  }

  /**
   * The wheel hurries you back down, rather than cutting to black.
   *
   * The clock jumps to *the point on the way down that is the same height you
   * are at now* and then runs at {@link HURRY_RATE}, so a child who asks to go
   * home halfway up does not watch the park snap away and come back. Nothing is
   * saved and nothing is written, so this and riding to the end leave the park
   * in precisely the same state.
   */
  private goHome(): void {
    if (this.goingHome) return;
    this.goingHome = true;
    this.rate = HURRY_RATE;
    this.clock = Math.max(this.clock, descentTimeFor(this.height));
    this.hud?.shout('Home we go!', 2);
  }

  private updateFriends(dt: number): void {
    const alien = this.alien;
    if (alien) {
      alien.setPresence(window01(this.clock, ALIEN_IN, ALIEN_OUT));
      const across = clamp01((this.clock - ALIEN_IN) / (ALIEN_OUT - ALIEN_IN));
      // Right to left across the window, drifting closer as it comes.
      alien.root.position.set(
        lerp(16, -9, smoothstep(0, 1, across)),
        lerp(2.4, 6.2, across) + Math.sin(this.clock * 0.6) * 0.6,
        lerp(-30, -19, across),
      );
      alien.update(dt, this.clock);
    }

    const ripika = this.ripika;
    if (ripika) {
      ripika.setPresence(window01(this.clock, RIPIKA_IN, RIPIKA_OUT));
      const across = clamp01((this.clock - RIPIKA_IN) / (RIPIKA_OUT - RIPIKA_IN));
      // Left to right, and much closer than the saucer: this is the one a child
      // is going to press their nose to the glass for.
      ripika.root.position.set(
        lerp(-4.2, 4.6, smoothstep(0, 1, across)),
        lerp(0.4, 2.6, across) + Math.sin(this.clock * 0.8 + 1.4) * 0.35,
        lerp(-6.4, -4.6, across),
      );
      ripika.update(dt, this.clock);
    }
  }

  /**
   * Where the camera looks.
   *
   * Left alone it drifts gently around straight ahead. When a friend is at the
   * window it turns *most of* the way towards them — enough to say "look at
   * that", never so far that the child stops being the one deciding.
   */
  private aimCamera(dt: number): void {
    let wantYaw = Math.sin(this.clock * 0.11) * 0.16;
    let wantPitch = -0.06 + Math.sin(this.clock * 0.07 + 1.1) * 0.05;

    // The opening beat: while the car is still at the bottom there is nothing
    // out of the window but grass, so the ride starts by looking *up* — at the
    // spokes, the hub and the cars swinging above you. It is the establishing
    // shot, and it costs one line.
    if (this.clock < BOARD_END) {
      wantPitch += 0.34 * (1 - smoothstep(0, 1, this.clock / BOARD_END));
    }

    const focus = this.focusFriend();
    if (focus) {
      this.scratch.copy(focus.root.position);
      this.gondola?.seat.worldToLocal(this.scratch);
      const dx = this.scratch.x - this.camera.position.x;
      const dy = this.scratch.y - this.camera.position.y;
      const dz = this.scratch.z - this.camera.position.z;
      const flat = Math.hypot(dx, dz);
      wantYaw = lerp(wantYaw, Math.atan2(-dx, -dz), 0.62);
      wantPitch = lerp(wantPitch, Math.atan2(dy, flat), 0.62);
    }

    // Clamped, so that a friend arriving low and behind can never spin the view
    // round to the back wall of the car.
    this.yaw = damp(this.yaw, clamp(wantYaw, -0.62, 0.62), 0.34, dt);
    this.pitch = damp(this.pitch, clamp(wantPitch, -0.42, 0.42), 0.34, dt);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  /** The friend worth looking at right now, if any. */
  private focusFriend(): SpaceFriend | null {
    if (this.ripika?.greetable) return this.ripika;
    if (this.alien?.greetable) return this.alien;
    return null;
  }

  private applySky(height: number): void {
    this.below?.skyColour(height, this.sky);
    // Space is lit by one hard sun and almost nothing else; the ground is lit by
    // a whole sky. Sliding between the two is most of why the climb reads.
    const depth = clamp01((height - 0.45) / 0.4);
    this.hemisphere.intensity = lerp(1.15, 0.32, depth);
    this.hemisphere.color.copy(this.sky).lerp(this.dayAmbient, 1 - depth);
    this.key.intensity = lerp(2.2, 2.7, depth);
    this.fill.intensity = lerp(0.5, 0.22, depth);
  }

  private fireCues(): void {
    for (const cue of this.cues) {
      if (cue.fired || this.clock < cue.at) continue;
      cue.fired = true;
      if (cue.unless?.()) continue;
      // A cue that comes up while the ride is hurrying home has been overtaken
      // by events — nobody wants to be told about the clouds on the way down.
      if (this.goingHome) continue;
      this.hud?.shout(cue.say);
    }
  }

  // ------------------------------------------------------------- interaction

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.cardTime >= 0 || !this.canvas) return;
    const target = event.target as HTMLElement | null;
    // The ✕ belongs to the framework; a press there is not a wave.
    if (target?.classList.contains('mg-quit')) return;

    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);

    for (const friend of [this.ripika, this.alien]) {
      if (!friend || !friend.greetable) continue;
      if (this.raycaster.intersectObject(friend.hitTarget, false).length === 0) continue;
      this.greet(friend);
      return;
    }
  };

  /** Somebody waved. Everybody is delighted about it. */
  private greet(friend: SpaceFriend): void {
    const first = !friend.greeted;
    friend.wave();
    this.gondola?.rejoice();
    this.sparks?.burst(friend.sparkPoint(this.scratch), first ? 30 : 16, friend.id === 'ripika' ? 0.7 : 1.4);
    if (first) {
      this.waves += 1;
      this.hud?.shout(friend.id === 'ripika' ? 'RiPika waves back!' : 'The alien waves back!', 2.2);
    }
  }

  // --------------------------------------------------------------- the ending

  private showCard(): void {
    this.cardTime = 0;
    this.rate = 0;
    this.hud?.setHomeHold(-1, false);
    this.hud?.showCard(
      'What a ride!',
      wavesLine(this.waves),
      this.context?.touch ? 'Tap to go back to the park' : 'Press Space to go back to the park',
    );
  }

  private finish(): void {
    this.cardTime = -1;
    this.context?.finish({
      id: this.id,
      outcome: 'finished',
      seconds: Math.min(this.clock, RIDE_END),
      message: wavesLine(this.waves),
    });
  }

  // -------------------------------------------------------------- lifecycle

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    // On a portrait phone the vertical field of view has to open up, or the
    // window ends up showing a letterbox of space with the frame either side.
    this.camera.fov = this.camera.aspect < 1 ? FOV / Math.max(0.62, this.camera.aspect) : FOV;
    this.camera.fov = Math.min(this.camera.fov, 96);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    this.gondola?.dispose();
    this.below?.dispose();
    this.space?.dispose();
    this.alien?.dispose();
    this.ripika?.dispose();
    this.sparks?.dispose();
    this.hud?.dispose();
    this.scene.clear();
    this.context = null;
  }
}

/** The factory the stall registers. */
export function createSpaceFerrisWheel(): MiniGame {
  return new SpaceFerrisWheel();
}

// ------------------------------------------------------------------ helpers

/** How high the ride is, 0 on the platform and 1 in space. */
function rideHeight(clock: number): number {
  if (clock <= BOARD_END) return 0;
  if (clock <= CLIMB_END) return smoothstep(0, 1, (clock - BOARD_END) / (CLIMB_END - BOARD_END));
  if (clock <= SPACE_END) return 1;
  if (clock <= DESCEND_END) {
    return 1 - smoothstep(0, 1, (clock - SPACE_END) / (DESCEND_END - SPACE_END));
  }
  return 0;
}

/**
 * How far round the wheel the car has come, in half-turns.
 *
 * Exactly one revolution, bottom to bottom, so the ride ends where it started —
 * which matters, because the park is waiting exactly where it was left.
 */
function rideTurn(clock: number): number {
  if (clock <= BOARD_END) return 0;
  if (clock <= CLIMB_END) return smoothstep(0, 1, (clock - BOARD_END) / (CLIMB_END - BOARD_END));
  if (clock <= SPACE_END) return 1;
  if (clock <= DESCEND_END) {
    return 1 + smoothstep(0, 1, (clock - SPACE_END) / (DESCEND_END - SPACE_END));
  }
  return 2;
}

/**
 * The moment on the way down that is at a given height.
 *
 * The descent is a smoothstep, and a cubic smoothstep has a closed-form
 * inverse: `t = ½ − sin(asin(1 − 2y) / 3)`. Cheaper and exact where a bisection
 * would have been approximate, and it means "take me home" always joins the
 * descent at the height the child is actually looking at.
 */
function descentTimeFor(height: number): number {
  const fallen = clamp01(1 - height);
  const t = 0.5 - Math.sin(Math.asin(clamp(1 - 2 * fallen, -1, 1)) / 3);
  return SPACE_END + t * (DESCEND_END - SPACE_END);
}

/** 0 before, 1 during, 0 after — with a soft edge at each end. */
function window01(clock: number, from: number, to: number): number {
  if (clock < from) return 0;
  if (clock > to) return clamp01(1 - (clock - to) / 3);
  return clamp01((clock - from) / 3);
}

function captionFor(clock: number, goingHome: boolean): string {
  if (goingHome && clock < DESCEND_END) return 'home we go…';
  if (clock < BOARD_END) return 'all aboard!';
  if (clock < 20) return 'up we go!';
  if (clock < CLIMB_END) return 'through the clouds…';
  if (clock < SPACE_END) return 'SPACE!';
  if (clock < DESCEND_END) return 'home we go…';
  return 'back in the park!';
}

function wavesLine(waves: number): string {
  switch (waves) {
    case 0:
      return 'All the way to space and back.';
    case 1:
      return 'You waved at a friend in space!';
    default:
      return 'You waved at the alien AND Space RiPika!';
  }
}
