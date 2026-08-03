import { Group, Raycaster, Vector2, Vector3 } from 'three';
import { clamp01, lerp, smoothstep } from '../../core/mathUtils';
import { RideCamera } from '../../core/RideCamera';
import { PLAYER_RADIUS } from '../../core/constants';
import type { FrameContext, GameSystem } from '../../core/types';
import type { Player } from '../../entities/Player';
import type { CollisionWorld } from '../Collision';
import { resolveDismount } from '../dismount';
import { terrainHeight } from '../terrain';
import { placedEntry } from '../parkLayout';
import { createCloudBand, type CloudBand } from './clouds';
import { FERRIS_CAR_LOW_Y } from '../../minigames/ferrisWheel/wheelProp';
import { FERRIS_WHEEL_EXIT } from '../../minigames/ferrisWheel/exit';
import { GONDOLA_EYE, createGondola, type Gondola } from '../../minigames/ferrisWheel/gondola';
import {
  createAlienSaucer,
  createSpaceRipika,
  createSweetieNebula,
  createSpaceTurtles,
  type FriendId,
  type SpaceFriend,
} from '../../minigames/ferrisWheel/friends';
import { createSpaceShow, fromAngle, type SpaceShow } from '../../minigames/ferrisWheel/space';
import { createSparks, type Sparks } from '../../minigames/ferrisWheel/sparks';

/**
 * **The Space Ferris Wheel, riding in the real park.**
 *
 * It used to be a curtain mini-game: its own `Scene`, its own lights, and a
 * forty-metre toy diorama of the park (`minigames/ferrisWheel/below.ts`) that
 * fell away beneath you while the real park sat frozen behind the curtain. That
 * was the right way to build it first, and it is the wrong way to keep it.
 * Jim's brief, 3 August 2026: **the wheel should use the normal park as its
 * setting.**
 *
 * So now nothing is faked. The gondola genuinely rises {@link CLIMB_METRES}
 * over the park, and what falls away below a child is the actual building, the
 * actual trees, the actual crowd she was walking through a minute ago. It is
 * the fourth client of the ride seam the train and both coasters already use —
 * `rideView` into `Game.cameraOverride`, boarded through `MiniGameHost.boardRide`
 * — rather than anything with a curtain in it.
 *
 * ### The two things that had to survive the move
 *
 * **The sky is the park's own sky.** `DayNight.setSpaceFactor` takes it past
 * night and into space (see that method, and Jim's "space is basically super
 * night"), so the stars that come out on the way up are the park's stars, the
 * park lights itself up underneath you as it darkens, and riding at four in the
 * afternoon gives you a fast-forwarded sunset on the way. The old ride painted
 * its own sky from a private table and could not do any of that.
 *
 * **The cloud band still does the swap** (`clouds.ts`). The park is a hundred
 * and ten metres across and the Earth is three hundred; those two pictures can
 * never share a frame. Cloud closes over, the Earth comes out, and by the time
 * there is clear air again the park is far below the Earth's own limb. It is
 * also what stops a child seeing the boundary wall with nothing beyond it.
 *
 * ### What is deliberately unchanged
 *
 * The gondola, the space show, the four friends, the sparks and the HUD are all
 * the same modules, untouched — this file re-hosts them, it does not rewrite
 * them. The ninety-second shape, the cues, the two pitch clamps and the
 * establishing tilt are the family-approved numbers and are copied across
 * exactly. `check:ride-camera` still traces this ride's look-around, because it
 * is still the reference implementation for every first-person view in the game.
 */

// -------------------------------------------------------------------- timing
//
// Straight from the mini-game. Ninety seconds, shaped: six to settle in,
// twenty-four climbing, forty in space, sixteen coming home.

const BOARD_END = 6;
const CLIMB_END = 30;
const SPACE_END = 70;
const DESCEND_END = 86;
const RIDE_END = 90;

/** Seconds the end card sits there before a press will dismiss it. */
const CARD_LOCKOUT = 0.9;
/** Seconds after which the card dismisses itself. */
const CARD_TIMEOUT = 8;

// ------------------------------------------------------------------ the show

const ALIEN_IN = 34;
const ALIEN_OUT = 68;
const RIPIKA_IN = 48;
const RIPIKA_OUT = 78;
const NEBULA_IN = 40;
const NEBULA_OUT = 66;
const TURTLES_IN = 56;
const TURTLES_OUT = 82;

const ALIEN_ANGLE_FROM = 150;
const ALIEN_ANGLE_TO = 250;
const RIPIKA_ANGLE_FROM = -30;
const RIPIKA_ANGLE_TO = 40;
const TURTLES_ANGLE_FROM = 280;
const TURTLES_ANGLE_TO = 350;
const NEBULA_ANGLE = 100;
const NEBULA_DISTANCE = 50;
const NEBULA_HEIGHT = 9;

// ------------------------------------------------------------------- the climb

/**
 * How far the gondola actually rises, in metres.
 *
 * The same number the diorama used to fall by, now spent on the real thing. It
 * is far enough that the park reads as a model of itself and nowhere near far
 * enough to be space — which is what the cloud band and the Earth are for.
 */
const CLIMB_METRES = 340;

/**
 * How deep into the cloud band the park is put away, 0..1 of the band.
 *
 * Well short of the top on purpose: the swap has to happen with cloud still
 * above her, or she watches the park wink out through a gap. Same number
 * governs the way down, so the park is already back before the band thins.
 */
const PARK_HIDDEN_FROM = 0.55;

/** Field of view. Wide: you are sitting inside a small box looking out of it. */
const FOV = 62;

/** How far down the view can tip: 80°, near enough straight down through the
 *  glass floor. Short of vertical so a child never loses which way is out. */
const PITCH_MIN = -1.396;
/** How far up: 70°, through the glass roof at the hub, the spokes and the Moon. */
const PITCH_MAX = 1.222;
/** Where the view sits before anybody touches it: a shade below level. */
const START_PITCH = -0.06;
/** Radians of extra tilt at the very start — the establishing shot. */
const ESTABLISHING_PITCH = 0.34;

interface Cue {
  readonly at: number;
  readonly say: string;
  readonly unless?: () => boolean;
  fired?: boolean;
}

/** What the ride wants said on screen. `Game` owns the DOM; this owns the words. */
export type FerrisMoment =
  | { readonly kind: 'start' }
  | { readonly kind: 'caption'; readonly text: string }
  | { readonly kind: 'shout'; readonly text: string; readonly seconds?: number }
  | { readonly kind: 'stick'; readonly stick: RideStick | null }
  | { readonly kind: 'card'; readonly title: string; readonly line: string; readonly hint: string }
  | { readonly kind: 'end' };

interface RideStick {
  readonly originX: number;
  readonly originY: number;
  readonly x: number;
  readonly y: number;
}

export class FerrisWheelRide implements GameSystem {
  readonly name = 'ferrisWheel';

  /** Everything this ride adds to the park. Added to the scene by `World`. */
  readonly group = new Group();

  rideView: RideCamera | null = null;
  onRideChange: ((riding: boolean) => void) | null = null;
  onMoment: ((moment: FerrisMoment) => void) | null = null;
  /** True on a touch device — only changes which words the cues use. */
  touch = false;

  private player: Player | null = null;
  private riding = false;

  private readonly show = new Group();
  private gondola: Gondola | null = null;
  private clouds: CloudBand | null = null;
  private space: SpaceShow | null = null;
  private sparks: Sparks | null = null;
  private alien: SpaceFriend | null = null;
  private ripika: SpaceFriend | null = null;
  private nebula: SpaceFriend | null = null;
  private turtles: SpaceFriend | null = null;

  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly scratch = new Vector3();

  /** Ride clock in seconds. Not the frame's elapsed: the card stops it. */
  private clock = 0;
  private rate = 1;
  private cardTime = -1;
  private waves = 0;
  private cues: Cue[] = [];

  /** Where the car sits at the bottom, in world metres. */
  private readonly boardX: number;
  private readonly boardY: number;
  private readonly boardZ: number;

  constructor(
    private readonly collision: CollisionWorld,
    /** Raises the park's sky past night and into space. `DayNight.setSpaceFactor`. */
    private readonly setSpaceFactor: (value: number) => void,
    /**
     * Shows or hides the park's own ferris wheel.
     *
     * Hidden for the length of the ride and put back on the way out. The
     * gondola carries the rim, spokes and hanger it swings from, which is what
     * a child sees through the skylight — so the park's wheel standing there
     * as well is simply a second ferris wheel.
     */
    private readonly setParkWheelVisible: (visible: boolean) => void,
    /**
     * Shows or hides the whole park — `World.setParkVisible`.
     *
     * Only ever false above the cloud band, and always put back on the way out.
     */
    private readonly setParkVisible: (visible: boolean) => void,
  ) {
    const wheel = placedEntry('ferrisWheel');
    this.boardX = wheel.x;
    this.boardZ = wheel.z;
    this.boardY = terrainHeight(wheel.x, wheel.z) + FERRIS_CAR_LOW_Y;

    this.group.name = 'ferrisWheel:ride';
    this.show.name = 'ferrisWheel:show';
    this.group.add(this.show);
    this.group.visible = false;
  }

  /**
   * Builds the ride, for this ride only.
   *
   * **Everything here used to be built in the constructor and kept for the
   * life of the session**, which was wrong twice over. The friends carry a
   * `greeted` flag that is never cleared, so from the second ride on every
   * "tap the alien!" cue was suppressed, waving raised no cheer and won no
   * sparks, and the end card always read "All the way to space and back."
   * however many friends a child waved at. And `createGondola` reads which
   * pets are owned out of the store as it builds, so a pet bought from the
   * shop between rides never got in the car.
   *
   * The curtain mini-game built all of this in `init` and threw it away in
   * `dispose`, once per visit, and that was right: a ride is a *visit*, and
   * a visit starts fresh. So it does that again. The cost is a build on
   * boarding, which happens behind the iris wipe where the old curtain hid the
   * same work — and the park gets the memory back when nobody is riding, which
   * on a phone is most of the time.
   */
  private build(): void {
    this.clouds = createCloudBand(this.boardX, this.boardZ);
    this.group.add(this.clouds.root);

    this.gondola = createGondola();
    this.gondola.root.position.set(this.boardX, this.boardY, this.boardZ);
    this.group.add(this.gondola.root);

    // The show's own coordinates are all relative to the car — `fromAngle`
    // measures bearings from the child's own seat. So it lives in a group that
    // is *moved* to the gondola each frame but never *rotated* with it: the
    // sway is the car's, and a whole sky that swayed with it would be sick-
    // making rather than cosy.
    this.space = createSpaceShow();
    this.show.add(this.space.root);

    this.alien = createAlienSaucer();
    this.ripika = createSpaceRipika();
    this.nebula = createSweetieNebula();
    this.turtles = createSpaceTurtles();
    this.nebula.root.position.copy(fromAngle(NEBULA_ANGLE, NEBULA_DISTANCE, NEBULA_HEIGHT));
    this.show.add(this.alien.root, this.ripika.root, this.nebula.root, this.turtles.root);

    this.sparks = createSparks();
    this.show.add(this.sparks.root);

    this.rideView = new RideCamera({
      fov: FOV,
      pitchMin: PITCH_MIN,
      pitchMax: PITCH_MAX,
      startPitch: START_PITCH,
    });
    // The camera rides in the car, so the sway is the ride. The eye position is
    // `gondola.ts`'s decision — it is where a child on the player's seat has
    // her eye, and the pets' chairs are built to keep their heads below it.
    this.rideView.mountOn(this.gondola.seat, GONDOLA_EYE);
  }

  /** Throws the ride away again. The park keeps nothing but the wheel. */
  private teardown(): void {
    this.rideView?.dispose();
    this.rideView = null;
    this.gondola?.dispose();
    this.gondola = null;
    this.clouds?.dispose();
    this.clouds = null;
    this.space?.dispose();
    this.space = null;
    this.alien?.dispose();
    this.alien = null;
    this.ripika?.dispose();
    this.ripika = null;
    this.nebula?.dispose();
    this.nebula = null;
    this.turtles?.dispose();
    this.turtles = null;
    this.sparks?.dispose();
    this.sparks = null;
    this.group.clear();
    this.show.clear();
    this.group.add(this.show);
  }

  attachPlayer(player: Player): void {
    this.player = player;
  }

  requestBoard(): boolean {
    if (this.riding || !this.player) return false;
    this.riding = true;
    // Fresh every visit — see `build`. Before `onRideChange`, which reads
    // `rideView.camera` the moment it fires.
    this.build();
    this.clock = 0;
    this.rate = 1;
    this.cardTime = -1;
    this.waves = 0;
    this.group.visible = true;
    this.setParkWheelVisible(false);

    this.player.beginRide();
    this.onRideChange?.(true);
    this.rideView?.board();

    this.buildCues();
    this.onMoment?.({ kind: 'start' });
    this.onMoment?.({ kind: 'caption', text: 'all aboard!' });
    this.onMoment?.({
      kind: 'shout',
      text:
        (this.gondola?.passengerCount ?? 0) > 0
          ? 'Everybody in! Up we go!'
          : 'All aboard! Up we go!',
      seconds: 2.6,
    });
    window.addEventListener('pointerdown', this.onPointerDown, true);
    return true;
  }

  update(context: FrameContext): void {
    // The wheel's own scenery keeps turning whether anybody is on it or not;
    // that is `wheelProp`'s job and happens through `AnchorPlots`. Nothing here
    // costs a frame unless a child is actually aboard.
    if (!this.riding) return;

    const dt = context.dt;
    this.clock += dt * this.rate;

    const height = rideHeight(this.clock);
    const altitude = this.boardY + height * CLIMB_METRES;

    // The one line that makes this a ride in the park rather than a ride in a
    // box: the car goes up, and everything else stays exactly where it is.
    this.gondola?.root.position.setY(altitude);
    this.show.position.set(this.boardX, altitude, this.boardZ);

    // The park's own sky, taken past night — see `DayNight.setSpaceFactor`.
    // Driven from the same curve as the climb, so the sky and the altitude can
    // never disagree about how high up she is.
    this.setSpaceFactor(height);

    // The Earth comes out **as the cloud closes over**, asked of the band
    // itself rather than worked out from a fraction of the climb. There used to
    // be a pair of constants here whose comment re-derived 96/340 by hand, so
    // moving CLOUD_BASE silently desynchronised the swap from the curtain
    // meant to hide it — the same shape as CLAUDE.md's hood-face rule, one
    // formula tracking another. Now there is only the one.
    const enveloped = this.clouds?.enveloped(altitude) ?? 0;
    this.space?.setDepth(enveloped);

    // ...and the park goes away behind the same curtain, on the same number.
    // Above the band the Earth is out — three hundred metres of planet against
    // a hundred and ten metres of park — and looking down through the glass
    // floor showed the real park sitting in front of the planet it is meant to
    // be part of. Both halves of the swap now happen inside the cloud, which is
    // the only reason the cloud is there.
    this.setParkVisible(enveloped < PARK_HIDDEN_FROM);

    // One revolution of the wheel fragment the car hangs from, bottom to
    // bottom, plus a slow drift up there so the view never quite stops moving.
    const turn = Math.PI * rideTurn(this.clock) + Math.sin(this.clock * 0.12) * 0.06;
    this.gondola?.setWheelAngle(turn);
    this.gondola?.setLampGlow(clamp01((height - 0.25) / 0.4));
    this.gondola?.update(dt, this.clock);

    // Fades the band out above itself and hides it altogether once there is
    // nothing left to see: in space there is no weather, and left alone the
    // band sat under the gondola for the whole forty seconds up there like a
    // white floor beneath a child looking at the Earth.
    this.clouds?.setAltitude(altitude);
    this.clouds?.update(dt, this.clock);
    this.space?.update(dt, this.clock);
    this.updateFriends(dt);
    this.sparks?.update(dt);
    this.aimCamera(dt);

    this.fireCues();
    this.onMoment?.({ kind: 'caption', text: captionFor(this.clock) });

    if (this.clock >= RIDE_END && this.cardTime < 0) this.showCard();

    // "Let me out" — the same key that backs out of anything else. The
    // mini-game framework used to supply a ✕ for this; a world ride has to
    // bring its own, and GAME_DESIGN's EXIT rule is not optional. Ignored
    // while the end card is up, where a press means "yes, take me back".
    if (this.cardTime < 0 && context.input.justPressed('cancel')) {
      this.leave();
      return;
    }

    if (this.cardTime >= 0) {
      this.cardTime += dt;
      const pressed = context.input.justPressed('interact') || context.input.justPressed('jump');
      if (this.cardTime > CARD_LOCKOUT && (pressed || this.cardTime > CARD_TIMEOUT)) {
        this.leave();
      }
    }
  }

  /**
   * Puts her down beside the wheel and gives the park back.
   *
   * Only the *state* changes here. Everything a child can see — the gondola,
   * the clouds, the space show and the sky's space factor — is left exactly as
   * it is and torn down by {@link hideRide} instead, which `Game` calls at the
   * **midpoint of the iris wipe**, which is also where the camera swaps back.
   * Doing it here meant the closing half of that wipe was spent looking through
   * the gondola's own camera at three hundred metres with the gondola gone and
   * a daylight sky behind it.
   */
  private leave(): void {
    if (!this.riding) return;
    this.riding = false;
    this.cardTime = -1;
    window.removeEventListener('pointerdown', this.onPointerDown, true);

    const { x, z } = resolveDismount(
      this.collision,
      FERRIS_WHEEL_EXIT.x,
      FERRIS_WHEEL_EXIT.z,
      PLAYER_RADIUS,
    );
    this.player?.teleportTo(x, terrainHeight(x, z), z);
    this.player?.endRide();
    this.onMoment?.({ kind: 'end' });

    if (this.onRideChange) this.onRideChange(false);
    // Nobody is driving a wipe (a headless trace, a torn-down game): there is
    // no midpoint to wait for, so do it now rather than leaking a sky stuck in
    // space and a hidden ferris wheel.
    else this.hideRide();
  }

  /**
   * Takes the ride off the screen. Called behind the closed iris.
   *
   * Putting the park's sky back is the part that must never be missed: a child
   * who quits half way up must not leave the whole park in space.
   */
  hideRide(): void {
    this.group.visible = false;
    this.setParkWheelVisible(true);
    // Whatever height she left at — quitting from the top must not leave the
    // park she is being put back into invisible.
    this.setParkVisible(true);
    this.setSpaceFactor(0);
    this.teardown();
  }

  /** The ✕, Backspace, the pause menu — anything that says "let me out". */
  quit(): void {
    this.leave();
  }

  private buildCues(): void {
    const lookHint = this.touch ? 'drag to look around!' : 'use the arrow keys to look around!';
    this.cues = [
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
    ];
  }

  private updateFriends(dt: number): void {
    const alien = this.alien;
    if (alien) {
      alien.setPresence(window01(this.clock, ALIEN_IN, ALIEN_OUT));
      const across = clamp01((this.clock - ALIEN_IN) / (ALIEN_OUT - ALIEN_IN));
      const eased = smoothstep(0, 1, across);
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
      turtles.root.position
        .copy(fromAngle(lerp(TURTLES_ANGLE_FROM, TURTLES_ANGLE_TO, eased), lerp(26, 17, eased), 0))
        .setY(lerp(1.1, 3.2, across) + Math.sin(this.clock * 0.5 + 2.4) * 0.4);
      turtles.update(dt, this.clock);
    }
  }

  /**
   * Where the camera looks — driven by the child, not by the show.
   *
   * Unchanged from the mini-game, deliberately: the show is spread all round
   * the gondola, so turning to find things is meant to be hers to do. All the
   * feel lives in `core/RideCamera`, and the two things only this ride knows
   * are its clock and the establishing tilt below.
   */
  private aimCamera(dt: number): void {
    // While the car is still at the bottom there is nothing out of the window
    // but grass, so the ride starts by looking *up* — at the spokes, the hub
    // and the cars swinging above. Gone within a few seconds either way.
    const establishing =
      this.clock < BOARD_END
        ? ESTABLISHING_PITCH * (1 - smoothstep(0, 1, this.clock / BOARD_END))
        : 0;
    const look = this.rideView?.update(dt, this.clock, establishing);
    this.onMoment?.({ kind: 'stick', stick: look?.touch ?? null });
  }

  private fireCues(): void {
    for (const cue of this.cues) {
      if (cue.fired || this.clock < cue.at) continue;
      cue.fired = true;
      if (cue.unless?.()) continue;
      this.onMoment?.({ kind: 'shout', text: cue.say });
    }
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    // The card says "Tap to go back to the park", so a tap has to do it — on a
    // phone there is no other press that can. The X belongs to the framework
    // around this and is not a wave, nor a dismissal.
    if ((event.target as HTMLElement | null)?.classList.contains('ferris-quit')) return;
    if (this.cardTime >= 0) {
      if (this.cardTime > CARD_LOCKOUT) this.leave();
      return;
    }
    if (!this.rideView) return;
    const canvas = document.getElementById('game-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.rideView.camera);

    for (const friend of this.friends) {
      if (!friend.greetable) continue;
      if (this.raycaster.intersectObject(friend.hitTarget, false).length === 0) continue;
      this.greet(friend);
      return;
    }
  };

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
    this.sparks?.burst(
      friend.sparkPoint(this.scratch),
      first ? 30 : 16,
      friend.id === 'ripika' ? 0.7 : 1.4,
    );
    if (first) {
      this.waves += 1;
      this.onMoment?.({ kind: 'shout', text: GREETING[friend.id], seconds: 2.2 });
    }
  }

  private showCard(): void {
    this.cardTime = 0;
    this.rate = 0;
    this.onMoment?.({
      kind: 'card',
      title: 'What a ride!',
      line: wavesLine(this.waves),
      hint: this.touch ? 'Tap to go back to the park' : 'Press Space to go back to the park',
    });
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.onPointerDown, true);
    this.teardown();
  }
}

// ------------------------------------------------------------------ helpers
//
// All four straight from the mini-game — the ninety-second shape is family
// canon and is not being retuned by a refactor.

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

/** How far round the wheel the car has come, in half-turns. */
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
