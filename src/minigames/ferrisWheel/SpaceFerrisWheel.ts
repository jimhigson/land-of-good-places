import { Color, DirectionalLight, HemisphereLight, Raycaster, Scene, Vector2, Vector3 } from 'three';
import { PALETTE } from '../../core/palette';
import { clamp01, lerp, smoothstep } from '../../core/mathUtils';
import { RideCamera } from '../../core/RideCamera';
import { createWorldBelow, type WorldBelow } from './below';
import { GONDOLA_EYE, createGondola, type Gondola } from './gondola';
import {
  createAlienSaucer,
  createSpaceRipika,
  createSweetieNebula,
  createSpaceTurtles,
  type FriendId,
  type SpaceFriend,
} from './friends';
import { createSpaceShow, fromAngle, type SpaceShow } from './space';
import { createSparks, type Sparks } from './sparks';
import { createRideHud, type RideHud } from './hud';
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
 * - **One obvious way out: the framework's ✕.** There was a hold-anywhere
 *   gesture here too, and the family asked for it to go (28 July 2026) — the ✕
 *   does the same thing and a six-year-old can see it. Holding still is the
 *   least discoverable gesture there is, and two ways to do one thing is worse
 *   than one you can point at. Leaving writes nothing anywhere, so going early
 *   costs nothing at all.
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

// ------------------------------------------------------------------ the show

/** When the saucer arrives, drifts and leaves. Off to the side and behind —
 *  find it by turning, the way the family asked for (27 July 2026). */
const ALIEN_IN = 34;
const ALIEN_OUT = 68;

/** When Space RiPika floats past. Dead ahead — the one beat you can watch
 *  without ever touching the look control. */
const RIPIKA_IN = 48;
const RIPIKA_OUT = 78;

/** When the sweetie nebula is out — present for most of the space stretch,
 *  since it drifts on the spot rather than crossing the window. */
const NEBULA_IN = 40;
const NEBULA_OUT = 66;

/** When the space turtles paddle by. */
const TURTLES_IN = 56;
const TURTLES_OUT = 82;

// ---------------------------------------------------- where each beat lives
//
// Degrees are the same compass the free-look yaw turns through (see
// `fromAngle` in `space.ts`): 0° is dead ahead, and the rest winds all the
// way round. RiPika stays near 0° — the one beat a child sees without ever
// touching the controls — and everything else is spread round the remaining
// 360°, so turning to look around is how the rest of the show gets found.

/** The alien's saucer drifts across the back of the sky. */
const ALIEN_ANGLE_FROM = 150;
const ALIEN_ANGLE_TO = 250;

/** Space RiPika, close to dead ahead, exactly as before. */
const RIPIKA_ANGLE_FROM = -30;
const RIPIKA_ANGLE_TO = 40;

/** The turtles paddle past behind the other shoulder from the alien. */
const TURTLES_ANGLE_FROM = 280;
const TURTLES_ANGLE_TO = 350;

/** The sweetie nebula sits still and spirals on the spot, off to one side. */
const NEBULA_ANGLE = 100;
const NEBULA_DISTANCE = 50;
const NEBULA_HEIGHT = 9;

/** Field of view. Wide: you are sitting inside a small box looking out of it. */
const FOV = 62;

// ------------------------------------------------------------- look-around
//
// The look-around itself is `core/RideCamera.ts` — the shared one the train and
// the coaster also ride behind, extracted from this file (ARCHITECTURE-DECISIONS
// Decision 4 §8) and gated by `npm run check:ride-camera`. What is left here is
// what Decision 4 says a ride owns: **its mount and its limits**. The feel — the
// turn rates, the damping, the idle sway — is deliberately *not* restated,
// because this ride's numbers are the ones the shared defaults were set from,
// and two copies of an approved number is one copy too many.

// **Both clamps opened right up (28 July 2026), and it is a deliberate change
// to family-approved behaviour** — `check:ride-camera`'s trace moves because of
// it, from `26a241cc` to `d1a4bbf0`, and that is the only reason it moves.
//
// The old numbers were tight on purpose: staring at a wooden car floor is not a
// view, so there was no reason to let a small thumb end up parked there. The
// car's floor and roof are **glass** now (`gondola.ts`), which turns the two
// directions that used to be dead ends into the best two views on the ride —
// the whole park directly below your feet, and the wheel and the stars directly
// overhead. Clamping to 19° down would have meant fitting a glass floor a child
// cannot look through, which is worse than not fitting one.
//
// These two constants and that glass are **one decision**. If you ever put the
// floor back, put these back with it.

/** How far down you can tip the view: 80°, near enough straight down through
 *  the glass floor. Short of vertical on purpose — at exactly 90° there is no
 *  horizon left anywhere in frame and a child loses track of which way is out. */
const PITCH_MIN = -1.396;
/** How far up: 70°, up through the glass roof at the hub, the spokes and the
 *  Moon. Also short of vertical, for the same reason. */
const PITCH_MAX = 1.222;
/** Where the view sits before anybody touches it: a shade below level, so the
 *  park is in the window rather than the sky. */
const START_PITCH = -0.06;
/** Radians of extra tilt at the very start of the ride — see {@link
 *  SpaceFerrisWheel.aimCamera}. */
const ESTABLISHING_PITCH = 0.34;

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
  /**
   * The shared first-person look-around, this ride's first consumer.
   *
   * Only the two clamps and the starting tilt are stated: yaw is free (there is
   * glass on every side of the rebuilt gondola, so there is always something to
   * turn towards), and the rates, damping and idle sway are the shared defaults,
   * which *are* this ride's approved numbers.
   */
  private readonly view = new RideCamera({
    fov: FOV,
    pitchMin: PITCH_MIN,
    pitchMax: PITCH_MAX,
    startPitch: START_PITCH,
  });

  readonly camera = this.view.camera;

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
  private nebula: SpaceFriend | null = null;
  private turtles: SpaceFriend | null = null;

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
  private cardTime = -1;
  private waves = 0;

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

    // The camera rides in the car, so the sway is the ride: mounting it on the
    // seat is what makes that true, and is all this ride has to say about where
    // the eye goes. `RideCamera` sets rotations directly rather than through
    // `lookAt` — aiming at a fixed world point every frame would cancel the sway
    // out and turn the ride into a slideshow.
    //
    // The eye position comes from `gondola.ts` because it is that file's
    // decision: it is where a child sitting on the player's seat has their eye,
    // and the pets' chairs are built to keep their heads below it. It is a
    // **position only** — nothing here or there rotates the seat, so the
    // family-confirmed look-around directions are untouched by it.
    this.view.mountOn(this.gondola.seat, GONDOLA_EYE);

    this.alien = createAlienSaucer();
    this.ripika = createSpaceRipika();
    this.nebula = createSweetieNebula();
    this.turtles = createSpaceTurtles();
    // The nebula does not travel across the window like the others — it sits
    // at its own compass point and turns on the spot — so it is placed once,
    // here, rather than every frame in `updateFriends`.
    this.nebula.root.position.copy(fromAngle(NEBULA_ANGLE, NEBULA_DISTANCE, NEBULA_HEIGHT));
    this.scene.add(this.alien.root, this.ripika.root, this.nebula.root, this.turtles.root);

    this.sparks = createSparks();
    this.scene.add(this.sparks.root);

    this.hud = createRideHud(context.overlay);
    this.hud.setCaption('all aboard!');
    this.hud.shout(
      this.gondola.passengerCount > 0 ? 'Everybody in! Up we go!' : 'All aboard! Up we go!',
      2.6,
    );

    // Cues: the whole script of the ride, in one readable list. The show is
    // spread all round the gondola now, so most of these say "look around"
    // rather than pointing at a spot on the glass — the child has to turn to
    // find what is being talked about, which is the point of the rebuild.
    const lookHint = context.touch ? 'drag to look around!' : 'use the arrow keys to look around!';
    this.cues.push(
      { at: BOARD_END + 3, say: 'Look how small the park is!' },
      { at: BOARD_END + 8, say: `Try it — ${lookHint}` },
      { at: 22, say: 'Through the clouds!' },
      { at: 31, say: 'Look — the whole Earth!' },
      { at: ALIEN_IN + 1.5, say: 'A flying saucer somewhere — go find it!' },
      { at: ALIEN_IN + 8, say: 'Tap the alien to wave back!', unless: () => this.alien?.greeted ?? false },
      { at: NEBULA_IN + 1.5, say: 'A nebula made of sweets!' },
      { at: NEBULA_IN + 7, say: 'Tap the nebula — it sparkles!', unless: () => this.nebula?.greeted ?? false },
      { at: RIPIKA_IN + 1.5, say: "It's Space RiPika!" },
      { at: RIPIKA_IN + 7, say: 'Tap RiPika to wave!', unless: () => this.ripika?.greeted ?? false },
      { at: TURTLES_IN + 1.5, say: 'Space turtles, paddling by!' },
      { at: TURTLES_IN + 7, say: 'Tap the turtles to wave!', unless: () => this.turtles?.greeted ?? false },
      { at: SPACE_END + 1, say: 'Bye bye, space!' },
      { at: DESCEND_END - 3, say: 'Nearly home!' },
    );

    window.addEventListener('pointerdown', this.onPointerDown, true);
  }

  // ------------------------------------------------------------------- frame

  update(frame: MiniGameFrame): void {
    const { dt, input } = frame;

    this.clock += dt * this.rate;

    const height = rideHeight(this.clock);

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
    this.hud?.setCaption(captionFor(this.clock));
    this.hud?.update(dt);

    if (this.clock >= RIDE_END && this.cardTime < 0) this.showCard();

    if (this.cardTime >= 0) {
      this.cardTime += dt;
      if (this.cardTime > CARD_LOCKOUT && (input.holdPressed || this.cardTime > CARD_TIMEOUT)) {
        this.finish();
      }
    }
  }

  private updateFriends(dt: number): void {
    const alien = this.alien;
    if (alien) {
      alien.setPresence(window01(this.clock, ALIEN_IN, ALIEN_OUT));
      const across = clamp01((this.clock - ALIEN_IN) / (ALIEN_OUT - ALIEN_IN));
      const eased = smoothstep(0, 1, across);
      // Sweeping across the back of the sky, drifting closer as it comes —
      // a child has to turn most of the way round to find it.
      alien.root.position
        .copy(fromAngle(lerp(ALIEN_ANGLE_FROM, ALIEN_ANGLE_TO, eased), lerp(30, 21, eased), 0))
        .setY(lerp(2.4, 6.2, across) + Math.sin(this.clock * 0.6) * 0.6);
      alien.update(dt, this.clock);
    }

    const ripika = this.ripika;
    if (ripika) {
      ripika.setPresence(window01(this.clock, RIPIKA_IN, RIPIKA_OUT));
      const across = clamp01((this.clock - RIPIKA_IN) / (RIPIKA_OUT - RIPIKA_IN));
      const eased = smoothstep(0, 1, across);
      // Close, and near dead ahead: this is the one a child is going to press
      // their nose to the glass for, whether they have touched the look
      // control yet or not.
      ripika.root.position
        .copy(fromAngle(lerp(RIPIKA_ANGLE_FROM, RIPIKA_ANGLE_TO, eased), lerp(7.2, 6.6, across), 0))
        .setY(lerp(0.4, 2.6, across) + Math.sin(this.clock * 0.8 + 1.4) * 0.35);
      ripika.update(dt, this.clock);
    }

    const nebula = this.nebula;
    if (nebula) {
      nebula.setPresence(window01(this.clock, NEBULA_IN, NEBULA_OUT));
      nebula.update(dt, this.clock);
    }

    const turtles = this.turtles;
    if (turtles) {
      turtles.setPresence(window01(this.clock, TURTLES_IN, TURTLES_OUT));
      const across = clamp01((this.clock - TURTLES_IN) / (TURTLES_OUT - TURTLES_IN));
      const eased = smoothstep(0, 1, across);
      // Paddling past on the opposite shoulder from the alien, so the two
      // flybys never compete for the same turn of the head.
      turtles.root.position
        .copy(fromAngle(lerp(TURTLES_ANGLE_FROM, TURTLES_ANGLE_TO, eased), lerp(26, 17, eased), 0))
        .setY(lerp(1.1, 3.2, across) + Math.sin(this.clock * 0.5 + 2.4) * 0.4);
      turtles.update(dt, this.clock);
    }
  }

  /**
   * Where the camera looks — driven by the child, not by the show.
   *
   * The old ride turned the camera towards whichever friend had just arrived,
   * because the whole show played out in front of you and there was nothing
   * else for the camera to do. Now the show is spread all round the gondola
   * (see the `*_ANGLE_*` constants above), so the camera can no longer make
   * that choice *for* the child without undoing the entire point of giving
   * them a look control — turning to find things is meant to be theirs to do.
   *
   * The stick/keys set a **turn rate**, not a target angle: the further the
   * deflection, the faster the view spins, and the damping is what turns a
   * sudden flick into a smooth spin-up rather than a snap. Yaw is free —
   * there is glass on every side of the rebuilt gondola, so there is always
   * something to turn towards. Pitch is clamped wide (80° down, 70° up) and
   * for one reason only: to stop short of vertical, where there is no horizon
   * left in frame and a child loses track of which way is out. There is glass
   * underfoot and overhead now, so both directions are views.
   *
   * All of that now lives in `core/RideCamera.ts`, shared with the first-person
   * train and the coaster, and the signs in it are this ride's — the ones the
   * family confirmed. What is left here is the two things only the ferris wheel
   * knows: **its clock**, which the idle sway breathes on and which stops when
   * the end card comes up, and **the establishing tilt** below.
   */
  private aimCamera(dt: number): void {
    // The opening beat: while the car is still at the bottom there is nothing
    // out of the window but grass, so the ride starts by looking *up* — at the
    // spokes, the hub and the cars swinging above you. It is the establishing
    // shot, layered on top of whatever the child is doing and gone within a
    // few seconds either way.
    const establishing =
      this.clock < BOARD_END
        ? ESTABLISHING_PITCH * (1 - smoothstep(0, 1, this.clock / BOARD_END))
        : 0;

    // The reading comes back because the HUD draws the stick under the thumb.
    const look = this.view.update(dt, this.clock, establishing);
    this.hud?.setStick(look.touch);
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

    for (const friend of this.friends) {
      if (!friend.greetable) continue;
      if (this.raycaster.intersectObject(friend.hitTarget, false).length === 0) continue;
      this.greet(friend);
      return;
    }
  };

  /**
   * Every space-show beat that currently exists, in one list.
   *
   * Kept as a single queryable place — each with a live `root.position`, a
   * `greetable`/presence state, and a stable `id` — rather than four separate
   * optional fields scattered through the class, on purpose: a future
   * "arrow pointing off-screen at what you're missing" feature (queued in
   * GAME_DESIGN.md, not built here) needs exactly this list, and should not
   * have to go hunting for it.
   */
  private get friends(): readonly SpaceFriend[] {
    return [this.ripika, this.alien, this.nebula, this.turtles].filter(
      (friend): friend is SpaceFriend => friend !== null,
    );
  }

  /** Somebody waved. Everybody is delighted about it. */
  private greet(friend: SpaceFriend): void {
    const first = !friend.greeted;
    friend.wave();
    this.gondola?.rejoice();
    this.sparks?.burst(friend.sparkPoint(this.scratch), first ? 30 : 16, friend.id === 'ripika' ? 0.7 : 1.4);
    if (first) {
      this.waves += 1;
      this.hud?.shout(GREETING[friend.id], 2.2);
    }
  }

  // --------------------------------------------------------------- the ending

  private showCard(): void {
    this.cardTime = 0;
    this.rate = 0;
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
    // Including the portrait-phone widening: a first-person window that
    // letterboxes on a turned phone is every first-person ride's problem, so it
    // moved into `RideCamera` with the rest of it.
    this.view.resize(width, height);
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    this.view.dispose();
    this.gondola?.dispose();
    this.below?.dispose();
    this.space?.dispose();
    this.alien?.dispose();
    this.ripika?.dispose();
    this.nebula?.dispose();
    this.turtles?.dispose();
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

/** 0 before, 1 during, 0 after — with a soft edge at each end. */
function window01(clock: number, from: number, to: number): number {
  if (clock < from) return 0;
  if (clock > to) return clamp01(1 - (clock - to) / 3);
  return clamp01((clock - from) / 3);
}

function captionFor(clock: number): string {
  if (clock < BOARD_END) return 'all aboard!';
  if (clock < 20) return 'up we go!';
  if (clock < CLIMB_END) return 'through the clouds…';
  if (clock < SPACE_END) return 'SPACE!';
  if (clock < DESCEND_END) return 'home we go…';
  return 'back in the park!';
}

/** The HUD's cheer for whichever friend just got waved at. */
const GREETING: Record<FriendId, string> = {
  alien: 'The alien waves back!',
  ripika: 'RiPika waves back!',
  nebula: 'The nebula sparkles back at you!',
  turtles: 'The space turtles wave their flippers!',
};

function wavesLine(waves: number): string {
  switch (waves) {
    case 0:
      return 'All the way to space and back.';
    case 1:
      return 'You waved at a friend in space!';
    case 2:
    case 3:
      return 'You made friends all round the sky!';
    default:
      return 'You waved at EVERYONE in space!';
  }
}
