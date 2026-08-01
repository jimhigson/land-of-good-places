import { Group, Vector3 } from 'three';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { PLAYER_RADIUS } from '../../core/constants';
import type { FrameContext, GameSystem } from '../../core/types';
import type { Player } from '../../entities/Player';
import { createKid, type KidHandle } from '../../art/models/kid';
import { createConfetti, type Confetti } from '../../minigames/railRacer/confetti';
import { discoverSecret } from '../../state/secrets';
import { terrainHeight } from '../terrain';
import { resolveDismount } from '../dismount';
import type { CollisionWorld } from '../Collision';
import { createRailRaceExitCrowd, type RailRaceExitCrowd } from './exitCrowd';
import { RaceCamera } from './camera';
import { RAIL_RACE_PLAN } from './plan';
import { buildRailRaceTrack, LANE_COLOURS, type RailRaceTrack, type SparkingSegment } from './track';
import { LANE_COUNT, PLAYER_LANE, RIDE_SCALE } from './route';
import { createCart, SEAT_HEIGHT, type CartHandle } from './cart';
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
 *
 * No `cart` colour here any more — a rival's cart used to carry its own,
 * hand-picked colour, and it had drifted out of step with `track.ts`'s
 * `LANE_COLOURS`, the array that actually paints the rails. `buildCarts`
 * below now derives every cart's colour from `LANE_COLOURS[lane]` instead, so
 * a rival's cart always matches the rail she is riding, by construction.
 * `outfit` stays independent — what a rival wears is her own choice, not tied
 * to her rail.
 */
const RIVALS: readonly {
  readonly name: string;
  readonly outfit: number;
  readonly hairStyle: 'short' | 'bob';
  readonly skill: number;
}[] = [
  { name: 'Pip', outfit: PALETTE.markerLemon, hairStyle: 'short', skill: 0.72 },
  { name: 'Nell', outfit: PALETTE.markerMint, hairStyle: 'bob', skill: 0.8 },
  { name: 'Otto', outfit: PALETTE.markerSky, hairStyle: 'short', skill: 0.86 },
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
 * How far `poseRider()` drops the player when she is off the button, in this
 * ride's own pre-`RIDE_SCALE` metres — see the comment where it is used.
 */
const DUCK_DROP = 0.5;

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
  /** The player hit a duck bar. Never raised for a rival's bonk — see `driveRiders`. */
  | { readonly kind: 'bonk' }
  | { readonly kind: 'result'; readonly won: boolean }
  | { readonly kind: 'end' };

type Phase = 'waiting' | 'countdown' | 'racing' | 'finishing';

interface Cart {
  readonly rider: Rider;
  readonly group: Group;
  readonly cart: CartHandle;
  readonly isPlayer: boolean;
  /** The child aboard. Null for the player's cart, and in a headless park. */
  readonly kid: KidHandle | null;
}

export class RailRace implements GameSystem {
  readonly name = 'railRace';
  readonly group = new Group();
  /**
   * The ring this race is run on, and how many lanes it has.
   *
   * Exposed rather than left implicit so that anything measuring the built park
   * can reach them **through the world** — `test/procgen/invariants.ts` must not
   * import `railRace/plan.ts` directly, because that pulls in `parkManifest`
   * at module load and would fix the park seed before the harness has set it.
   * (It did exactly that on the first attempt: four of the five seed suites
   * built the canonical park instead of their own.)
   */
  readonly route = RAIL_RACE_PLAN.route;
  readonly laneCount = LANE_COUNT;
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
  /** Look-alike rivals who stand about at the exit when a race lets you off. */
  private readonly exitCrowd: RailRaceExitCrowd;

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

    this.exitCrowd = createRailRaceExitCrowd(collision);
    this.group.add(this.exitCrowd.root);

    this.placeCarts();
  }

  private buildCarts(): void {
    // The rivals ride the inner lanes; the player rides the outermost, nearest
    // the camera, where nothing can ever be drawn in front of her. Each cart's
    // colour comes from `LANE_COLOURS[lane]` — the same array that paints the
    // rails — so a cart can never be a different colour from its own rail.
    RIVALS.forEach((rival, index) => {
      const cart = createCart(LANE_COLOURS[index] ?? PALETTE.markerPink);
      const group = cart.root;
      const kid = createKid({ outfit: rival.outfit, hairStyle: rival.hairStyle });
      // Local to this still-unscaled `group` (the RIDE_SCALE below applies to
      // both together), so this is the cart's own SEAT_HEIGHT, not the
      // player's world-space `poseRider()` version of the same fact.
      kid.root.position.y = SEAT_HEIGHT;
      kid.setExpression('happy');
      group.add(kid.root);
      // RIDE_SCALE scales the cart's own body/nose and, since the kid is a
      // child of this same group, the rival riding in it, together.
      group.scale.setScalar(RIDE_SCALE);
      this.group.add(group);
      this.carts.push({ rider: createRider(index), group, cart, isPlayer: false, kid });
    });

    const playerCart = createCart(LANE_COLOURS[PLAYER_LANE] ?? PALETTE.markerMint);
    const group = playerCart.root;
    group.scale.setScalar(RIDE_SCALE);
    this.group.add(group);
    this.carts.push({ rider: createRider(PLAYER_LANE), group, cart: playerCart, isPlayer: true, kid: null });
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
    // RIDE_SCALE scales her own live model too, not just the decorative
    // rivals — reset in arrive() so she is her normal size again once she is
    // walking around the park.
    this.player.model.root.scale.setScalar(RIDE_SCALE);
    this.onRideChange?.(true);

    // Everybody back to the line. Nothing moves until the countdown runs out —
    // a race that has already started when the camera arrives is a race a
    // six-year-old has already lost.
    for (const cart of this.carts) {
      const fresh = createRider(cart.rider.lane);
      Object.assign(cart.rider, fresh);
    }
    // Headlamps on for the race, and only for the race. They are real
    // `SpotLight`s (Jim, 1 August 2026) and the park has no other dynamic
    // lights at all, so four idling carts must not leave eight of them burning
    // in every material in the park — see `cart.ts`'s `HEADLAMP_RANGE`.
    for (const cart of this.carts) cart.cart.setHeadlamps(true);
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
        // Nobody is racing, but the rivals do not know that — they carry on
        // round the ring exactly like the train does with an empty carriage.
        // See {@link driveIdleRivals}.
        this.driveIdleRivals(context);
        break;
    }

    this.placeCarts();
    this.animate(dt, elapsed);
    // Paper keeps falling after the race is over and after she has been set
    // down, so these are ticked outside every phase test — and so does the
    // little crowd at the exit, which by definition only exists once the race
    // has handed control back and the phase is `'waiting'` again.
    this.confetti?.update(dt);
    this.exitCrowd.update(dt);
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
          // Only the player's own bonk gets a message — a rival's bonk has no
          // action for her to take and would just be noise (unlike the sparks,
          // which are meant to be visible so she can learn from watching them).
          this.onRaceMoment?.({ kind: 'bonk' });
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
   * Keeps the rivals circling the ring whenever nobody is racing.
   *
   * The park train never stops going round just because nobody boarded it
   * (`ParkTrain.drive` runs every frame regardless); this is the same idea
   * for the Rail Race. It drives the three rival carts through the exact
   * `stepRider` physics a real race uses — not a canned loop animation — and
   * only the rivals: the player's own cart has nobody in it and stays parked
   * at the line until {@link requestBoard} is pressed, which already resets
   * every rider (including these) to a fresh start line for the real thing.
   *
   * A rival that reaches the finish line here is not "done" the way a real
   * race ends it — there is no result card and nobody to show it to — so
   * rather than freezing at the line (`stepRider` would, via `rider.finished`)
   * it is quietly wrapped back into lap one and carries on at whatever speed
   * it already had, for a seamless join rather than a stop-start.
   */
  private driveIdleRivals(context: FrameContext): void {
    const { dt } = context;
    const route = RAIL_RACE_PLAN.route;
    for (const cart of this.carts) {
      if (cart.isPlayer) continue;
      const rider = cart.rider;
      const wantHold = rivalWantsHold(rider, dt, skillOf(rider), this.rng);
      stepRider(route, rider, wantHold, dt);
      if (rider.finished) {
        rider.travelled %= route.length;
        rider.finished = false;
        rider.barCursor = 0;
        rider.zoneCursor = 0;
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
    // else get it wrong. But only *their* rail lights up: each cart's own
    // zone×lane, found from its own `zoneCursor`, not a ring-wide flag — a
    // rival sparking on the far side must not light up every black stretch in
    // the park, only the one they are actually standing on.
    const sparkingSegments: SparkingSegment[] = [];
    for (const cart of this.carts) {
      if (!cart.rider.sparking) continue;
      const at = cart.group.position;
      // Struck from under the cart, a few per frame rather than a burst: a
      // continuous shower for as long as the button is held.
      this.sparks.emit(at.x, at.y - 0.15, at.z, 2);
      // `sparkStretches` repeats `HAZARDS.lap.zones` once per lap in the same
      // order, so the cursor modulo the lap's zone count is exactly the zone
      // this rider is in right now — the same fact `stepRider` used to decide
      // `sparking` in the first place, not a re-derived position match.
      const zoneIndex = cart.rider.zoneCursor % HAZARDS.lap.zones.length;
      sparkingSegments.push({ zoneIndex, lane: cart.rider.lane });
    }
    this.track.setSparking(sparkingSegments, elapsed);
    this.sparks.update(dt);

    // Wheels turn with distance travelled, not with `dt` — an absolute angle
    // off `Rider.travelled` rather than an accumulated one, so a fresh race
    // (which resets `travelled` to 0) resets the wheels too. See `cart.ts`.
    for (const cart of this.carts) cart.cart.spinWheels(cart.rider.travelled);

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
    //
    // Scaled by RIDE_SCALE — her own model is too (`requestBoard()`), so an
    // unscaled drop stayed the same fixed 0.5m while her seated head height
    // grew with everything else, and duck bars ended up sitting well below
    // her head in *both* held and ducked states (see DUCK_CLEARANCE in
    // hazards.ts). This and that value were picked together against her real
    // measured head height in both states, live, on 1 August 2026.
    const duckDrop = this.ducking && this.phase === 'racing' ? DUCK_DROP * RIDE_SCALE : 0;
    const wobble = rider.wobble > 0 ? Math.sin(rider.wobble * 34) * 0.08 * rider.wobble : 0;
    this.player.setRidePose(
      cart.position.x + wobble,
      cart.position.y + SEAT_HEIGHT * RIDE_SCALE - duckDrop,
      cart.position.z,
      cart.rotation.y,
      // Rivals get this for free — `kid.root` is a child of the same group
      // `placeCarts()` pitches — but the player's own model is positioned
      // independently every frame, so it never inherited the cart's tilt on
      // the ring's hills until `setRidePose` grew a pitch parameter to carry it.
      cart.rotation.x,
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
      // Undo the RIDE_SCALE boarding scale-up now she's back on foot.
      this.player.model.root.scale.setScalar(1);
      this.player.endRide();
      this.onRideChange?.(false);

      // Pip, Nell and Otto turn up beside her, as though the four of them had
      // just climbed out together — read off the race that has this second
      // finished, so whoever actually won is the one cheering hardest. This
      // must happen *before* the reset below, which wipes `place`. They are
      // look-alikes rather than the racers themselves, and they are not solid;
      // `exitCrowd.ts` explains both at length.
      this.exitCrowd.show(
        x,
        z,
        x,
        z,
        this.carts
          .filter((cart) => !cart.isPlayer)
          .map((cart, index) => ({
            outfit: RIVALS[index]?.outfit ?? PALETTE.markerLemon,
            hairStyle: RIVALS[index]?.hairStyle ?? 'short',
            place: cart.rider.place,
          })),
      );
    }
    // Everybody back to the line, so the ring looks ready rather than abandoned.
    for (const cart of this.carts) {
      cart.cart.setHeadlamps(false);
      Object.assign(cart.rider, createRider(cart.rider.lane));
    }
    this.placeCarts();
  }

  interactZones(): [] {
    return [];
  }

  dispose(): void {
    this.track.dispose();
    this.confetti?.dispose();
    this.exitCrowd.dispose();
    this.sparks.dispose();
    this.rideView?.dispose();
    for (const cart of this.carts) {
      cart.kid?.dispose?.();
      cart.cart.dispose();
    }
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
