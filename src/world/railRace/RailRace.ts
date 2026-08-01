import { BoxGeometry, Group, Mesh, Vector3 } from 'three';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { addOutline, toonMaterial } from '../../art/style/materials';
import { PLAYER_RADIUS } from '../../core/constants';
import type { FrameContext, GameSystem } from '../../core/types';
import type { Player } from '../../entities/Player';
import { createKid, type KidHandle } from '../../art/models/kid';
import { createConfetti, type Confetti } from '../../minigames/railRacer/confetti';
import { discoverSecret } from '../../state/secrets';
import { terrainHeight } from '../terrain';
import { resolveDismount } from '../dismount';
import type { CollisionWorld } from '../Collision';
import { RaceCamera } from './camera';
import { RAIL_RACE_PLAN } from './plan';
import { buildRailRaceTrack, type RailRaceTrack } from './track';
import { PLAYER_LANE } from './route';
import { createSparks, type Sparks } from './sparks';
import {
  HAZARDS,
  RACE_LAPS,
  createRider,
  rivalWantsHold,
  stepRider,
  type Rider,
} from './simulate';

/**
 * **The Rail Race** — four carts, four rails, one button, all the way round the
 * park.
 *
 * The reform of 31 July 2026, from the family's brief: a **side-on** race on
 * **four parallel tracks** that follow the **park's perimeter**, so the camera
 * looking in has the whole park as its backdrop; no steering, only hills, each
 * lane undulating independently; **duck bars** to release for, and **black
 * stretches** that spark if you power over them. It replaces the solver-grown
 * race coaster, which was a Sky Cruiser with barriers on it and a camera behind
 * the rider's head.
 *
 * The work is split four ways so that no one file has to be right about
 * everything:
 *
 * - `route.ts` — where the rails are, and why every lane is exactly as hard.
 * - `simulate.ts` — who wins. Pure arithmetic, so the build can race it.
 * - `track.ts` — the geometry, swept through the park's shared rail builder.
 * - `camera.ts` — the side-on rig.
 *
 * This file is the ride: it owns the carts, the riders, boarding, the countdown,
 * the finish, and the wiring out to the HUD.
 *
 * ## What makes it a Land of Good Places race
 *
 * - **You cannot fail.** A bonk is a wobble and lost speed. Sparks are a slow
 *   patch. There are no lives, no damage and no way to end a run early.
 * - **The rivals stay near you** — rubber-banded gently and asymmetrically, so a
 *   child who holds the whole way is chased and a child who never holds at all
 *   is waited for rather than lapped.
 * - **Everybody finishes.** Fourth place gets confetti and a kind sentence;
 *   first place gets three times as much, and a Cute-o-dex deed.
 */

/** Seconds of 3-2-1 before the carts are let go. */
const COUNTDOWN_SECONDS = 3;

/** How long a countdown digit (or "GO!") stays on screen. */
const COUNT_HOLD = 0.9;

/** How long the result card sits there before she is set down at the booth. */
const RESULT_SECONDS = 5;

/** Safety net: no race may run longer than this. Nobody has ever reached it. */
const RACE_TIME_LIMIT = 180;

/** The Cute-o-dex deed for winning. Registered in `state/secrets.ts`. */
const RACE_SECRET = 'secret.railRace';

/**
 * The three rivals, on the three inner lanes.
 *
 * `skill` is how often they get a hazard right. None is perfect, because a child
 * has to be able to win; none is hopeless, because a race you cannot lose is not
 * a race. Ordered inside-out, so the nearest rival to the player is the sharpest
 * one — the cart she can actually see beside her is the one worth beating.
 */
const RIVALS: readonly {
  readonly name: string;
  readonly cart: number;
  readonly outfit: number;
  readonly hairStyle: 'short' | 'bob';
  readonly skill: number;
}[] = [
  { name: 'Pip', cart: PALETTE.markerLemon, outfit: PALETTE.markerLemon, hairStyle: 'short', skill: 0.72 },
  { name: 'Nell', cart: PALETTE.markerMint, outfit: PALETTE.markerMint, hairStyle: 'bob', skill: 0.8 },
  { name: 'Otto', cart: PALETTE.markerSky, outfit: PALETTE.markerSky, hairStyle: 'short', skill: 0.86 },
];

/**
 * How hard the rivals rubber-band.
 *
 * A metre of lead moves a rival's thrust by `CATCHUP`, clamped to ±`SWING`.
 * Asymmetric on purpose — the point is a close race, not a fair one.
 */
const CATCHUP = 0.004;
const SWING = 0.22;

/**
 * What the race wants said on screen, for whoever is holding the DOM.
 *
 * `RailRace` lives in `World` and has no business knowing about `uiRoot`; the
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

type Phase = 'waiting' | 'countdown' | 'racing' | 'finishing';

interface Cart {
  readonly rider: Rider;
  readonly group: Group;
  readonly isPlayer: boolean;
  /** The child aboard. Null for the player's cart, and in a headless park. */
  readonly kid: KidHandle | null;
}

export class RailRace implements GameSystem {
  readonly name = 'railRace';
  readonly group = new Group();
  /** The side-on view leaves her model on screen: watching her duck is the game. */
  readonly playerStaysVisible = true;

  /** Named `rideView` to match every other ride in `World`. */
  rideView: RaceCamera | null = null;
  onRideChange: ((riding: boolean) => void) | null = null;
  /** The race's on-screen framing. Wired by `Game` to `ui/RaceHud.ts`. */
  onRaceMoment: ((moment: RaceMoment) => void) | null = null;
  /**
   * "Is a finger down on the race pad?"
   *
   * Read *alongside* the keyboard, never instead of it. It exists because
   * `Game.screenIsBusy()` hides the touch controls while a ride has hold of you
   * — correct for the train and the Sky Cruiser, and fatal here, where holding
   * is the whole game and the hop button is the only thing bound to `jump` that
   * a finger can reach. See `ui/RaceHud.ts`.
   */
  raceHold: (() => boolean) | null = null;

  private readonly collision: CollisionWorld;
  private readonly track: RailRaceTrack;
  private readonly sparks: Sparks;
  private readonly carts: Cart[] = [];
  private readonly rng = new Rng(0x7a11ed);
  private readonly point = new Vector3();
  private readonly tangent = new Vector3();

  private player: Player | null = null;
  private riding = false;
  private phase: Phase = 'waiting';
  private countdown = 0;
  private countHold = 0;
  private raceTime = 0;
  private resultTimer = 0;
  private finishedCount = 0;
  private confetti: Confetti | null = null;
  private ducking = false;

  constructor(collision: CollisionWorld) {
    this.collision = collision;
    this.group.name = 'railRace';

    const route = RAIL_RACE_PLAN.route;
    this.track = buildRailRaceTrack(route, HAZARDS.lap, collision);
    this.group.add(this.track.group);

    this.sparks = createSparks();
    this.group.add(this.sparks.root);

    this.buildCarts();

    this.confetti = createConfetti();
    this.group.add(this.confetti.root);

    this.placeCarts();
  }

  private buildCarts(): void {
    // The rivals ride the inner lanes; the player rides the outermost, nearest
    // the camera, where nothing can ever be drawn in front of her.
    RIVALS.forEach((rival, index) => {
      const group = buildCart(rival.cart);
      const kid = createKid({ outfit: rival.outfit, hairStyle: rival.hairStyle });
      kid.root.position.y = 0.05;
      kid.setExpression('happy');
      group.add(kid.root);
      this.group.add(group);
      this.carts.push({ rider: createRider(index), group, isPlayer: false, kid });
    });

    const group = buildCart(PALETTE.markerPink);
    this.group.add(group);
    this.carts.push({ rider: createRider(PLAYER_LANE), group, isPlayer: true, kid: null });
  }

  /** Lazily, as the train does: the headless park has no player and no DOM. */
  attachPlayer(player: Player): void {
    this.player = player;
    this.rideView = new RaceCamera(RAIL_RACE_PLAN.route);
  }

  /** The stall's interact press lands here. */
  requestBoard(): boolean {
    if (this.riding || !this.player || this.phase !== 'waiting') return false;
    this.riding = true;
    this.player.beginRide();
    this.onRideChange?.(true);

    // Everybody back to the line. Nothing moves until the countdown runs out —
    // a race that has already started when the camera arrives is a race a
    // six-year-old has already lost.
    for (const cart of this.carts) {
      const fresh = createRider(cart.rider.lane);
      Object.assign(cart.rider, fresh);
    }
    this.phase = 'countdown';
    this.countdown = COUNTDOWN_SECONDS;
    this.raceTime = 0;
    this.finishedCount = 0;
    this.ducking = false;
    this.placeCarts();
    this.rideView?.reset(0);
    this.onRaceMoment?.({ kind: 'start' });
    this.emitCount(String(COUNTDOWN_SECONDS));
    return true;
  }

  update(context: FrameContext): void {
    const { dt, elapsed } = context;

    // The countdown digit ticks off the screen on its own clock, so it keeps
    // running through the change from counting down to racing — "GO!" is raised
    // as the carts are let go and clears a beat later.
    if (this.countHold > 0) {
      this.countHold -= dt;
      if (this.countHold <= 0) this.onRaceMoment?.({ kind: 'count', text: null });
    }

    switch (this.phase) {
      case 'countdown': {
        const before = Math.ceil(this.countdown);
        this.countdown -= dt;
        const now = Math.ceil(this.countdown);
        if (now !== before && now >= 1) this.emitCount(String(now));
        if (this.countdown <= 0) {
          this.phase = 'racing';
          this.emitCount('GO!');
          this.onRaceMoment?.({ kind: 'lap', lap: 1, of: RACE_LAPS });
        }
        break;
      }

      case 'racing': {
        this.raceTime += dt;
        this.driveRiders(context, true);
        if (this.me.rider.finished || this.raceTime > RACE_TIME_LIMIT) this.finishRace();
        break;
      }

      case 'finishing': {
        // The rivals carry on across the line behind the card — a race that
        // freezes the moment you finish feels like it was never really running.
        this.raceTime += dt;
        this.driveRiders(context, false);
        this.resultTimer -= dt;
        if (this.resultTimer <= 0) {
          this.onRaceMoment?.({ kind: 'end' });
          this.arrive();
        }
        break;
      }

      case 'waiting':
        break;
    }

    this.placeCarts();
    this.animate(dt, elapsed);
    // Paper keeps falling after the race is over and after she has been set
    // down, so these are ticked outside every phase test.
    this.confetti?.update(dt);
    this.rideView?.update(this.me.rider.travelled, dt);
    this.poseRider();
  }

  /** One frame of everybody's physics. */
  private driveRiders(context: FrameContext, playerDrives: boolean): void {
    const { dt } = context;
    const me = this.me.rider;

    for (const cart of this.carts) {
      const rider = cart.rider;
      let wantHold: boolean;
      let band = 1;

      if (cart.isPlayer) {
        // The old racer's one button, on real rails.
        const input = context.input;
        wantHold =
          playerDrives &&
          (input.isDown('jump') || input.isDown('interact') || this.raceHold?.() === true);
      } else {
        wantHold = rivalWantsHold(rider, dt, skillOf(rider), this.rng);
        // Rubber band: catching up is easier than running away.
        const lead = me.travelled - rider.travelled;
        band = 1 + Math.max(-SWING, Math.min(SWING, lead * CATCHUP));
      }

      const events = stepRider(RAIL_RACE_PLAN.route, rider, wantHold, dt, band);

      if (cart.isPlayer) {
        this.ducking = !rider.holding;
        if (events.bonked) {
          this.confetti?.burst(cart.group.position.x, cart.group.position.y + 1.4, cart.group.position.z, 10, 0.55);
        }
        if (events.lap > 0) {
          this.onRaceMoment?.({ kind: 'lap', lap: events.lap, of: RACE_LAPS });
        }
      }

      if (events.finishedNow) {
        this.finishedCount += 1;
        rider.place = this.finishedCount;
        rider.finishTime = this.raceTime;
      }
    }
  }

  /**
   * Crossing the line.
   *
   * Won if nobody else got there first. Winning is a Cute-o-dex deed and a
   * shower of paper; losing is a card that says "so close!" and asks her to go
   * again, because this is Land of Good Places and being told you lost is how a
   * six-year-old learns to stop pressing the thing.
   */
  private finishRace(): void {
    const me = this.me.rider;
    if (!me.finished) {
      // Ran out of time. Give her the line rather than the clock.
      me.finished = true;
      this.finishedCount += 1;
      me.place = this.finishedCount;
      me.finishTime = this.raceTime;
    }
    this.phase = 'finishing';
    this.resultTimer = RESULT_SECONDS;
    const won = me.place === 1;
    this.onRaceMoment?.({ kind: 'result', won });
    if (won) {
      discoverSecret(RACE_SECRET);
      const at = this.me.group.position;
      this.confetti?.burst(at.x, at.y + 1.6, at.z, 90, 1.2);
      this.confetti?.burst(at.x, at.y + 2.2, at.z, 60, 0.9);
    } else {
      const at = this.me.group.position;
      this.confetti?.burst(at.x, at.y + 1.8, at.z, 30, 0.9);
    }
  }

  /** Raises a countdown digit and starts its clock. */
  private emitCount(text: string): void {
    this.onRaceMoment?.({ kind: 'count', text });
    this.countHold = COUNT_HOLD;
  }

  private placeCarts(): void {
    const route = RAIL_RACE_PLAN.route;
    for (const cart of this.carts) {
      const at = route.wrap(route.startDistance + cart.rider.travelled);
      route.pointAt(cart.rider.lane, at, this.point);
      route.tangentAt(cart.rider.lane, at, this.tangent);
      cart.group.position.copy(this.point);
      cart.group.rotation.y = Math.atan2(this.tangent.x, this.tangent.z);
      // Pitch with the hill it is on — the whole point of the undulation.
      cart.group.rotation.x = -Math.asin(Math.max(-0.6, Math.min(0.6, this.tangent.y)));
    }
  }

  private animate(dt: number, elapsed: number): void {
    const me = this.me.rider;
    const route = RAIL_RACE_PLAN.route;

    // The warning lamps, driven off how far round this lap she is.
    const lapOffset = me.travelled % route.length;
    this.track.setAlerts(lapOffset, !me.holding, elapsed);

    // Sparks fly off whichever carts are powering over a black stretch — the
    // rivals' too, which is how a child learns the rule by watching somebody
    // else get it wrong.
    let anySparking = false;
    for (const cart of this.carts) {
      if (!cart.rider.sparking) continue;
      anySparking = true;
      const at = cart.group.position;
      // Struck from under the cart, a few per frame rather than a burst: a
      // continuous shower for as long as the button is held.
      this.sparks.emit(at.x, at.y - 0.15, at.z, 2);
    }
    this.track.setSparking(anySparking, elapsed);
    this.sparks.update(dt);

    for (const cart of this.carts) {
      const kid = cart.kid;
      if (!kid) continue;
      kid.update(dt);
      const limbs = kid.limbs;
      if (cart.rider.finished) {
        // Arms up, cheering.
        const flap = Math.sin(elapsed * 11) * 0.3;
        limbs.rightArm.rotation.x = -2.5 + flap;
        limbs.leftArm.rotation.x = -2.5 - flap;
      } else if (!cart.rider.holding) {
        // Ducked: head down, arms tucked in.
        limbs.rightArm.rotation.x = -0.4;
        limbs.leftArm.rotation.x = -0.4;
        kid.head.rotation.x = 0.5;
      } else {
        // Hands on the rail, leaning into it.
        limbs.rightArm.rotation.x = -1.2;
        limbs.rightArm.rotation.z = -0.2;
        limbs.leftArm.rotation.x = -1.2;
        limbs.leftArm.rotation.z = 0.2;
        kid.head.rotation.x = 0;
      }
      kid.setExpression(cart.rider.wobble > 0.2 ? 'surprised' : 'happy');
    }
  }

  /** Puts the player's model in her cart, ducking when she is off the button. */
  private poseRider(): void {
    if (!this.riding || !this.player) return;
    const cart = this.me.group;
    const rider = this.me.rider;
    // Ducking drops her into the cart, which is the thing the side view exists
    // to show. The wobble after a bonk shakes the seat a little, cosy not
    // punishing.
    const duckDrop = this.ducking && this.phase === 'racing' ? 0.5 : 0;
    const wobble = rider.wobble > 0 ? Math.sin(rider.wobble * 34) * 0.08 * rider.wobble : 0;
    this.player.setRidePose(
      cart.position.x + wobble,
      cart.position.y + 0.05 - duckDrop,
      cart.position.z,
      cart.rotation.y,
    );
  }

  private arrive(): void {
    this.phase = 'waiting';
    if (this.riding && this.player) {
      this.riding = false;
      // The planned exit (`railRace/plan.ts`) — a clear patch beside the booth
      // — with the runtime safety net on top (see `world/dismount.ts`).
      const { x, z } = resolveDismount(
        this.collision,
        RAIL_RACE_PLAN.exitX,
        RAIL_RACE_PLAN.exitZ,
        PLAYER_RADIUS,
      );
      this.player.setRidePose(x, terrainHeight(x, z), z, 0);
      this.player.endRide();
      this.onRideChange?.(false);
    }
    // Everybody back to the line, so the ring looks ready rather than abandoned.
    for (const cart of this.carts) Object.assign(cart.rider, createRider(cart.rider.lane));
    this.placeCarts();
  }

  interactZones(): [] {
    return [];
  }

  dispose(): void {
    this.track.dispose();
    this.confetti?.dispose();
    this.sparks.dispose();
    this.rideView?.dispose();
    for (const cart of this.carts) cart.kid?.dispose?.();
  }

  // ------------------------------------------------------------- internals

  private get me(): Cart {
    const cart = this.carts[this.carts.length - 1];
    if (!cart) throw new Error('Rail Race: no carts were built.');
    return cart;
  }
}

/** Rival skill, by lane. Kept out of the hot loop's closure. */
function skillOf(rider: Rider): number {
  return RIVALS[rider.lane]?.skill ?? 0.8;
}

/** A little cart: a body, a nose, and the house outline. */
function buildCart(colour: number): Group {
  const group = new Group();
  const body = new Mesh(new BoxGeometry(1.15, 0.62, 1.7), toonMaterial(colour));
  body.position.y = 0.32;
  // The cart's own body casts — one more draw call, and it is the shadow the eye
  // actually follows round the ring.
  body.castShadow = true;
  addOutline(body, 0.02);
  group.add(body);

  const nose = new Mesh(new BoxGeometry(0.85, 0.34, 0.42), toonMaterial(PALETTE.markerLemon));
  nose.position.set(0, 0.32, 1.02);
  addOutline(nose, 0.02);
  group.add(nose);
  return group;
}
