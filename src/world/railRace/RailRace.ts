import { Group, Vector3 } from 'three';
import { PALETTE } from '../../core/palette';
import { Rng } from '../../core/mathUtils';
import { PLAYER_RADIUS } from '../../core/constants';
import type { InputSystem } from '../../core/input';
import type { FrameContext, GameSystem } from '../../core/types';
import type { Player } from '../../entities/Player';
import { createKid, type KidHandle } from '../../art/models/kid';
import { createConfetti, type Confetti } from '../../minigames/railRacer/confetti';
import { gameStore } from '../../state';
import { discoverSecret } from '../../state/secrets';
import { terrainHeight } from '../terrain';
import { resolveDismount } from '../dismount';
import type { CollisionWorld } from '../Collision';
import { createRailRaceExitCrowd, type RailRaceExitCrowd } from './exitCrowd';
import { RaceCamera } from './camera';
import { RAIL_RACE_PLAN } from './plan';
import { buildRailRaceTrack, LANE_COLOURS, type RailRaceTrack, type SparkingSegment } from './track';
import { LANE_COUNT, PLAYER_LANE, RIDE_SCALE, type RailRaceRoute } from './route';
import { createCart, SEAT_HEIGHT, type CartHandle } from './cart';
import { createSparks, type Sparks } from './sparks';
import type { RaceLevel } from './hazards';
import {
  HAZARD_LAYOUT,
  RACE_LAPS,
  RIVAL_SKILL,
  createRider,
  rivalBand,
  rivalInput,
  scheduleForLevel,
  stepRider,
  type Rider,
  type RiderInput,
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
 * The three rivals, on the three inner lanes — who they *are*, not how well
 * they drive.
 *
 * How well they drive is `RIVAL_SKILL` in `simulate.ts`, beside the brains
 * that read it and the checker that races it. It used to be a fourth field
 * here, and that meant the balance check had to keep its own copy of the
 * tuning it was supposed to be proving — see `RIVAL_SKILL`'s own doc comment
 * for the 2 August 2026 re-tune against the tap-rate rework. Ordered
 * inside-out, so the nearest rival to the player is the sharpest one — the
 * cart she can actually see beside her is the one worth beating.
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
  /** Given here, not left to `createKid`'s default, so the little painted
   * head in the standings HUD can be the same colour as the child in the cart. */
  readonly hair: number;
  readonly hairStyle: 'short' | 'bob';
}[] = [
  { name: 'Pip', outfit: PALETTE.markerLemon, hair: 0x6b4a8f, hairStyle: 'short' },
  { name: 'Nell', outfit: PALETTE.markerMint, hair: 0xd2694a, hairStyle: 'bob' },
  { name: 'Otto', outfit: PALETTE.markerSky, hair: 0x4a3a52, hairStyle: 'short' },
];

/**
 * How far `poseRider()` drops the player when she is off the button, in this
 * ride's own pre-`RIDE_SCALE` metres — see the comment where it is used.
 */
const DUCK_DROP = 0.5;

/**
 * How far the seat dips on the per-press pump/pedal bob, same pre-`RIDE_SCALE`
 * units as `DUCK_DROP` above (the cart's own group carries the `RIDE_SCALE`
 * multiply for both the rivals, via `kid.root` being its child, and the
 * player, via `poseRider()`'s own explicit multiply). Small — this is a quick
 * tactile "yes, that press landed", not a ducking-sized motion.
 */
const BOB_DROP = 0.12;

/** `Rider.boost` above which a rival's cart pose reads as "actively mashing". */
const PRESSING_POSE_THRESHOLD = 0.15;

/**
 * What the race wants said on screen, for whoever is holding the DOM.
 *
 * `RailRace` lives in `World` and has no business knowing about `uiRoot`; the
 * train's `onRideChange` set the precedent and this is the same shape. `Game`
 * wires it to `ui/RaceHud.ts`.
 */
export type RaceMoment =
  /** Boarding: who is racing, in cart order. The HUD builds its heads from this. */
  | { readonly kind: 'start'; readonly racers: readonly RaceRacer[] }
  /**
   * "Which level?" — shown the moment she boards, before the countdown even
   * starts (see `chooseLevel`), and cleared the instant she picks one. This
   * is also where the "tap fast to win" instructions live: read while she's
   * deciding, rather than a separate pill flashed during 3-2-1, which is a
   * moment she is watching the track, not the text.
   */
  | { readonly kind: 'levelSelect'; readonly shown: boolean }
  /**
   * Raised once, the instant `chooseLevel` picks a hazard composition and the
   * countdown starts — the controls reminder's cue. Deliberately its own
   * moment rather than piggybacked on `count`'s first tick: `count` fires
   * again every second while this must fire exactly once, whichever level
   * she picked.
   */
  | { readonly kind: 'controls' }
  /**
   * The running order changed: racer indices (into the `start` list), leader
   * first. Raised only when it actually changes, not every frame.
   */
  | { readonly kind: 'standings'; readonly order: readonly number[] }
  /** A countdown digit, "GO!", or `null` to clear it. */
  | { readonly kind: 'count'; readonly text: string | null }
  | { readonly kind: 'lap'; readonly lap: number; readonly of: number }
  /** The player hit a duck bar. Never raised for a rival's bonk — see `driveRiders`. */
  | { readonly kind: 'bonk' }
  | { readonly kind: 'result'; readonly won: boolean }
  | { readonly kind: 'end' };

/**
 * `levelSelect` sits between boarding and the countdown: everybody is at the
 * line, the ride view is up, but nothing moves until `chooseLevel` picks a
 * hazard composition and starts the clock.
 */
type Phase = 'waiting' | 'levelSelect' | 'countdown' | 'racing' | 'finishing';

/**
 * One racer, as the HUD needs them.
 *
 * Deliberately the shape `minigames/portraitStrip.ts` already takes, so
 * `Game` hands it straight across without a mapping step in between — the
 * same reason a route *is* a `RailSampler` in `rail/sweptRail.ts`.
 */
export interface RaceRacer {
  readonly name: string;
  readonly hair: number;
  readonly accent: number;
  readonly isPlayer: boolean;
}

interface Cart {
  readonly rider: Rider;
  readonly group: Group;
  readonly cart: CartHandle;
  readonly isPlayer: boolean;
  /** The child aboard. Null for the player's cart, and in a headless park. */
  readonly kid: KidHandle | null;
}

/**
 * One of the ride's two rings: the geometry, and the route it was built from.
 *
 * See `route.ts`'s header. Both are built once, at park load — **never** when a
 * race starts. Rebuilding a 400 m loop of swept rail, trestles and duck bars
 * mid-game would mean a mesh rebuild and the collection that follows it, in the
 * one moment a six-year-old has just pressed the button and is watching.
 */
interface Ring {
  readonly route: RailRaceRoute;
  readonly track: RailRaceTrack;
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
  readonly route = RAIL_RACE_PLAN.raceRing;
  /**
   * The ring the rivals idle round at park scale, and the ring a race is run
   * on at toy scale — both exposed for the same reason `route` is: an
   * invariant has to be able to measure them **through the built world**
   * rather than by importing `railRace/plan.ts`.
   */
  readonly walkPastRoute = RAIL_RACE_PLAN.walkPastRing;
  readonly raceRoute = RAIL_RACE_PLAN.raceRing;
  readonly laneCount = LANE_COUNT;
  /** The side-on view leaves her model on screen: watching her duck is the game. */
  readonly playerStaysVisible = true;

  /** Named `rideView` to match every other ride in `World`. */
  rideView: RaceCamera | null = null;
  onRideChange: ((riding: boolean) => void) | null = null;
  /** The race's on-screen framing. Wired by `Game` to `ui/RaceHud.ts`. */
  onRaceMoment: ((moment: RaceMoment) => void) | null = null;
  /**
   * The touch half of the tap-rate control, read *alongside* the keyboard and
   * mouse, never instead of them — same reason the old `raceHold` existed:
   * `Game.screenIsBusy()` hides the on-screen buttons while a ride has hold of
   * you, which is fatal here, where a finger is the only way a phone can play
   * at all. Wired by `Game` to `ui/RaceHud.ts`, whose whole-screen pad now
   * tells a tap (this) apart from a drag-down-and-hold (`touchDucking` below).
   *
   * Drained once a frame, not read as a level: a boost press is a discrete
   * event, and a finger can tap faster than a frame, so `RaceHud` queues them
   * and this call empties the queue rather than losing everything but the
   * last one still down.
   */
  takeTouchBoostPresses: (() => number) | null = null;
  /** The touch half of duck: true for as long as a finger is dragged down and held. */
  touchDucking: (() => boolean) | null = null;

  private readonly collision: CollisionWorld;
  /** The ring the rivals live on between races. Always visible; always solid. */
  private readonly walkPastRing: Ring;
  /** The ring a race is run on. Visible only between `requestBoard` and `arrive`. */
  private readonly raceRing: Ring;
  /**
   * Whichever of the two is live right now. **Exactly one ever is** — the two
   * rings are concentric, so this is the whole mutual-exclusion rule and it
   * lives in one place ({@link setActiveRing}).
   */
  private activeRing: Ring;
  private readonly sparks: Sparks;
  private readonly carts: Cart[] = [];
  private readonly rng = new Rng(0x7a11ed);
  private readonly point = new Vector3();
  private readonly tangent = new Vector3();

  private player: Player | null = null;
  /** Cached off `FrameContext` every `update()`, so `requestBoard`/`arrive` — which
   *  are called from outside the frame loop — can reach the input system too. */
  private input: InputSystem | null = null;
  private riding = false;
  private phase: Phase = 'waiting';
  private countdown = 0;
  private countHold = 0;
  private raceTime = 0;
  private resultTimer = 0;
  private finishedCount = 0;
  private confetti: Confetti | null = null;
  private ducking = false;
  /**
   * The hazard composition for the race in progress — chosen once, in
   * `chooseLevel`, before the countdown, and reset to the calm level-1
   * default in `arrive()`. Also what the idling rivals race against between
   * races (see `driveIdleRivals`), so the ring is quiet until somebody
   * actually picks a level.
   */
  private activeLevel: RaceLevel = 1;
  private activeSchedule = scheduleForLevel(1);
  /** Look-alike rivals who stand about at the exit when a race lets you off. */
  private readonly exitCrowd: RailRaceExitCrowd;
  /** The running order last sent to the HUD, so it is only sent on a change. */
  private standings: number[] = [];

  constructor(collision: CollisionWorld) {
    this.collision = collision;
    this.group.name = 'railRace';

    // Both rings, built here and never again — see {@link Ring}. Level-
    // independent, as `HAZARD_LAYOUT`'s own doc comment explains: a ring's
    // hazard geometry is built once, in full, whichever level ends up chosen;
    // `setHazardLevel` only ever toggles its visibility.
    //
    // The walk-past ring goes up **first**, and it is the one that registers
    // collision. The race ring's own trestle search then sees those posts as
    // occupied ground and stands its legs clear of them for free, so the two
    // rings' supports never land on the same square metre even though the
    // rings are concentric.
    this.walkPastRing = {
      route: RAIL_RACE_PLAN.walkPastRing,
      track: buildRailRaceTrack(RAIL_RACE_PLAN.walkPastRing, HAZARD_LAYOUT, collision, {
        ringName: 'railRace:walk-past-ring',
        registerCollision: true,
      }),
    };
    this.raceRing = {
      route: RAIL_RACE_PLAN.raceRing,
      track: buildRailRaceTrack(RAIL_RACE_PLAN.raceRing, HAZARD_LAYOUT, collision, {
        ringName: 'railRace:race-ring',
        registerCollision: false,
      }),
    };
    for (const ring of [this.walkPastRing, this.raceRing]) {
      ring.track.setHazardLevel(this.activeLevel);
      this.group.add(ring.track.group);
    }
    this.activeRing = this.walkPastRing;

    this.sparks = createSparks();
    this.group.add(this.sparks.root);

    this.buildCarts();

    this.confetti = createConfetti();
    this.group.add(this.confetti.root);

    this.exitCrowd = createRailRaceExitCrowd(collision);
    this.group.add(this.exitCrowd.root);

    this.setActiveRing(this.walkPastRing);
  }

  /**
   * Puts one ring on show and takes the other off, and moves every cart and
   * rider onto it.
   *
   * **The rivals are relocated, not duplicated.** These are the same three
   * `Cart` objects with the same `Rider` state and the same `KidHandle` — all
   * that changes is which route `placeCarts` reads and how big the cart group
   * is drawn. `travelled` carries across untouched, because both rings share
   * one arc length and one start distance (`route.ts`). A second, parallel set
   * of rivals kept "in sync" with the first is exactly how you end up with two
   * copies of Pip idling in two places the first time a swap is missed; there
   * is only ever one Pip.
   *
   * This is also the one and only place a cart's `scale` is written. It used to
   * be set once in `buildCarts()` and never touched again, which is why the
   * rivals were 2.5x life-size to anybody walking past between races — the bug
   * that started all this.
   */
  private setActiveRing(ring: Ring): void {
    this.activeRing = ring;
    this.walkPastRing.track.group.visible = ring === this.walkPastRing;
    this.raceRing.track.group.visible = ring === this.raceRing;
    for (const cart of this.carts) cart.group.scale.setScalar(ring.route.scale);
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
      // Local to this group, whose scale is the ring's (see `setActiveRing`)
      // and applies to the cart and the kid sitting in it together — so this
      // is the cart's own SEAT_HEIGHT, not the player's world-space
      // `poseRider()` version of the same fact.
      kid.root.position.y = SEAT_HEIGHT;
      kid.setExpression('happy');
      group.add(kid.root);
      // No scale here. A cart is sized by the ring it is currently on, and
      // only by `setActiveRing` — see that method for the bug this fixes.
      this.group.add(group);
      this.carts.push({ rider: createRider(index), group, cart, isPlayer: false, kid });
    });

    const playerCart = createCart(LANE_COLOURS[PLAYER_LANE] ?? PALETTE.markerMint);
    const group = playerCart.root;
    this.group.add(group);
    this.carts.push({ rider: createRider(PLAYER_LANE), group, cart: playerCart, isPlayer: true, kid: null });
  }

  /** Lazily, as the train does: the headless park has no player and no DOM. */
  attachPlayer(player: Player): void {
    this.player = player;
    this.rideView = new RaceCamera(RAIL_RACE_PLAN.raceRing);
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

    // Everybody back to the line. Nothing moves until she picks a level and
    // the countdown runs out — a race that has already started when the
    // camera arrives is a race a six-year-old has already lost.
    for (const cart of this.carts) {
      const fresh = createRider(cart.rider.lane);
      Object.assign(cart.rider, fresh);
    }
    // Headlamps on for the race, and only for the race. They are real
    // `SpotLight`s (Jim, 1 August 2026) and the park has no other dynamic
    // lights at all, so four idling carts must not leave eight of them burning
    // in every material in the park — see `cart.ts`'s `HEADLAMP_RANGE`.
    for (const cart of this.carts) cart.cart.setHeadlamps(true);
    this.phase = 'levelSelect';
    this.raceTime = 0;
    this.finishedCount = 0;
    this.ducking = false;
    // Up onto the race ring: the big one appears, the little one goes away, and
    // the three rivals come with her. Both rings were built at park load, so
    // this is two `visible` flags and a scale, not a rebuild. It is hidden
    // behind the boarding iris either way — she never sees the swap, only that
    // the ring she is on is suddenly enormous.
    this.setActiveRing(this.raceRing);
    this.rideView?.reset(0);
    // The right mouse button is the desktop duck control for the whole race —
    // see `InputSystem.setMouseCaptureActive`'s own doc comment for why this
    // is scoped to the ride rather than a park-wide suppression of the
    // context menu.
    this.input?.setMouseCaptureActive(true);
    this.standings = [];
    this.onRaceMoment?.({ kind: 'start', racers: this.racers() });
    this.updateStandings();
    this.onRaceMoment?.({ kind: 'levelSelect', shown: true });
    return true;
  }

  /**
   * The level-select screen's own choice lands here. Builds the schedule for
   * the chosen level, arms the track's hazard geometry to match, and starts
   * the countdown — the tail end of what `requestBoard` used to do in one go
   * before there was a choice to make first.
   */
  chooseLevel(level: RaceLevel): boolean {
    if (this.phase !== 'levelSelect') return false;
    this.activeLevel = level;
    this.activeSchedule = scheduleForLevel(level);
    for (const ring of [this.walkPastRing, this.raceRing]) ring.track.setHazardLevel(level);
    this.onRaceMoment?.({ kind: 'levelSelect', shown: false });
    // Fired here, not in the countdown branch of `update()`: this is the one
    // moment she has just committed to racing but nothing has moved yet,
    // which is the point in `RaceMoment.controls`'s own doc comment about not
    // being missed on the way past.
    this.onRaceMoment?.({ kind: 'controls' });
    this.phase = 'countdown';
    this.countdown = COUNTDOWN_SECONDS;
    this.emitCount(String(COUNTDOWN_SECONDS));
    return true;
  }

  /**
   * Everybody in the race, in cart order — the order every `standings` index
   * afterwards refers to.
   *
   * The player rides as herself: her own hair colour off the save, exactly as
   * the dodgems do it, so the head at the top of the screen is recognisably
   * hers. Accents come from `LANE_COLOURS`, the same array that paints the
   * rails, the carts and the droppers, so "my colour" is one fact from the
   * rail under her all the way up to the portrait in the corner.
   */
  private racers(): RaceRacer[] {
    const hair = gameStore.get().player.hairColour;
    return this.carts.map((cart, index) => {
      const accent = LANE_COLOURS[cart.rider.lane] ?? PALETTE.markerPink;
      const rival = RIVALS[index];
      return cart.isPlayer || !rival
        ? { name: 'You', hair, accent, isPlayer: true }
        : { name: rival.name, hair: rival.hair, accent, isPlayer: false };
    });
  }

  /**
   * Works out who is currently winning, and tells the HUD when that changes.
   *
   * **There was no such thing as a live position before this.** `Rider.place`
   * was only ever written as somebody crossed the line, so for the whole race
   * up to that point nothing in the game knew who was ahead — which is
   * exactly what the family asked to see (1 August 2026).
   *
   * `travelled` alone is the whole ranking rule: it counts from the lights and
   * never resets at a lap, so "most laps, then furthest round this one" is
   * simply the largest number. Riders who have already finished are held
   * above everyone still going, in the order they actually crossed, so a
   * leader cannot appear to drop to fourth the instant she stops moving.
   *
   * Four riders sorted every frame is nothing; the *emit* is what is guarded,
   * because rebuilding four labels sixty times a second would be silly and
   * the order changes only a handful of times a race.
   */
  private updateStandings(): void {
    const ranked = this.carts
      .map((cart, index) => ({ index, rider: cart.rider }))
      .sort((a, b) => {
        if (a.rider.finished !== b.rider.finished) return a.rider.finished ? -1 : 1;
        if (a.rider.finished && b.rider.finished) return a.rider.place - b.rider.place;
        return b.rider.travelled - a.rider.travelled;
      })
      .map((entry) => entry.index);

    if (
      ranked.length === this.standings.length &&
      ranked.every((racer, place) => this.standings[place] === racer)
    ) {
      return;
    }
    this.standings = ranked;
    this.onRaceMoment?.({ kind: 'standings', order: ranked });
  }

  update(context: FrameContext): void {
    const { dt, elapsed } = context;
    this.input = context.input;

    // The countdown digit ticks off the screen on its own clock, so it keeps
    // running through the change from counting down to racing — "GO!" is raised
    // as the carts are let go and clears a beat later.
    if (this.countHold > 0) {
      this.countHold -= dt;
      if (this.countHold <= 0) this.onRaceMoment?.({ kind: 'count', text: null });
    }

    switch (this.phase) {
      case 'levelSelect':
        // Everybody sits at the line while she decides — `chooseLevel` moves
        // the phase on. Nothing to step here.
        break;

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
        this.updateStandings();
        if (this.me.rider.finished || this.raceTime > RACE_TIME_LIMIT) this.finishRace();
        break;
      }

      case 'finishing': {
        // The rivals carry on across the line behind the card — a race that
        // freezes the moment you finish feels like it was never really running.
        this.raceTime += dt;
        this.driveRiders(context, false);
        this.updateStandings();
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

    // Drained every frame regardless of `playerDrives`, so a tap that landed
    // while the result card was up cannot queue up and fire late once she
    // boards again.
    const touchPresses = this.takeTouchBoostPresses?.() ?? 0;

    for (const cart of this.carts) {
      const rider = cart.rider;
      let riderInput: RiderInput;
      let band = 1;

      if (cart.isPlayer) {
        // Mash Space or the left mouse button, or tap the screen — see
        // `actions.ts`'s `boost`/`duck` and `RaceHud`'s touch pad.
        const input = context.input;
        riderInput = playerDrives
          ? {
              pressed: input.justPressed('jump') || input.justPressed('boost') || touchPresses > 0,
              ducking: input.isDown('duck') || this.touchDucking?.() === true,
            }
          : { pressed: false, ducking: false };
      } else {
        riderInput = rivalInput(rider, this.activeSchedule, dt, skillOf(rider), this.rng);
        // Rubber band: catching up is easier than running away — see
        // `rivalBand`'s own doc comment for why this is asymmetric on both
        // axes rather than the old flat ±22%.
        band = rivalBand(me.travelled - rider.travelled);
      }

      const events = stepRider(this.activeRing.route, rider, this.activeSchedule, riderInput, dt, band);

      if (cart.isPlayer) {
        this.ducking = rider.ducking;
        // Same "that hurt" moments as the rivals get (see `poseRider` below),
        // but for her own face, which nothing in this file otherwise touches —
        // her cart carries no `kid`, only the live `Player` model riding it.
        // Cleared in `arrive()` so it can never outlive the ride.
        if (this.player) this.player.railRaceFrown = rider.sparking || rider.wobble > 0.2;
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
    const route = this.activeRing.route;
    for (const cart of this.carts) {
      if (cart.isPlayer) continue;
      const rider = cart.rider;
      stepRider(
        route,
        rider,
        this.activeSchedule,
        rivalInput(rider, this.activeSchedule, dt, skillOf(rider), this.rng),
        dt,
      );
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
    const route = this.activeRing.route;
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
    const route = this.activeRing.route;

    // The warning lamps, driven off how far round this lap she is. Safe now
    // means "actively ducking" (the dedicated held control), not "not
    // holding the old accelerate button" — see `hazards.ts`'s header.
    const lapOffset = me.travelled % route.length;
    this.activeRing.track.setAlerts(lapOffset, me.ducking, elapsed);

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
      // `sparkStretches` repeats `HAZARD_LAYOUT.zones` once per lap in the
      // same order, so the cursor modulo the lap's zone count is exactly the
      // zone this rider is in right now — the same fact `stepRider` used to
      // decide `sparking` in the first place, not a re-derived position match.
      const zoneIndex = cart.rider.zoneCursor % HAZARD_LAYOUT.zones.length;
      sparkingSegments.push({ zoneIndex, lane: cart.rider.lane });
    }
    this.activeRing.track.setSparking(sparkingSegments, elapsed);
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
      // The pump/pedal bob: a quick dip on every fresh press, springing back
      // up between them (`Rider.bob`, see `simulate.ts`'s header) — the seat
      // itself moves, on top of whatever pose the arms are holding.
      kid.root.position.y = SEAT_HEIGHT - cart.rider.bob * BOB_DROP;
      if (cart.rider.finished) {
        // Arms up, cheering.
        const flap = Math.sin(elapsed * 11) * 0.3;
        limbs.rightArm.rotation.x = -2.5 + flap;
        limbs.leftArm.rotation.x = -2.5 - flap;
      } else if (cart.rider.ducking) {
        // Ducked: head down, arms tucked in.
        limbs.rightArm.rotation.x = -0.4;
        limbs.leftArm.rotation.x = -0.4;
        kid.head.rotation.x = 0.5;
      } else if (cart.rider.boost > PRESSING_POSE_THRESHOLD) {
        // Mashing: hands on the rail, leaning into it.
        limbs.rightArm.rotation.x = -1.2;
        limbs.rightArm.rotation.z = -0.2;
        limbs.leftArm.rotation.x = -1.2;
        limbs.leftArm.rotation.z = 0.2;
        kid.head.rotation.x = 0;
      } else {
        // Coasting: hands resting, nobody's pressing anything right now.
        limbs.rightArm.rotation.x = -0.7;
        limbs.rightArm.rotation.z = 0;
        limbs.leftArm.rotation.x = -0.7;
        limbs.leftArm.rotation.z = 0;
        kid.head.rotation.x = 0;
      }
      // Frown for the two moments the family asked to be readable from
      // watching a rival: mid-wobble right after a bonk, and while actively
      // powering over a sparking black stretch. No separate lockout timer is
      // needed for the second — `simulate.ts` only sets `sparking` while a
      // rider is in a black zone *and* still mashing (`sparkGuard > 0`), so
      // easing off clears the frown by itself, which is the lesson.
      kid.setExpression(cart.rider.sparking || cart.rider.wobble > 0.2 ? 'frown' : 'happy');
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
    //
    // Taken off the ring she is actually on rather than off `RIDE_SCALE`
    // directly. She only ever rides the race ring, so the number is the same —
    // but reading it from the ring is what stops this drifting the day a third
    // one exists, and it is the same rule every other size in this file now
    // follows.
    const rideScale = this.activeRing.route.scale;
    const duckDrop = this.ducking && this.phase === 'racing' ? DUCK_DROP * rideScale : 0;
    const wobble = rider.wobble > 0 ? Math.sin(rider.wobble * 34) * 0.08 * rider.wobble : 0;
    this.player.setRidePose(
      cart.position.x + wobble,
      cart.position.y + SEAT_HEIGHT * rideScale - duckDrop,
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
      // Otherwise a frown caught mid-race would ride home with her forever —
      // `driveRiders` (the only place that sets it) stops running the moment
      // `phase` leaves 'racing'/'finishing'.
      this.player.railRaceFrown = false;
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
      this.input?.setMouseCaptureActive(false);

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
    // Back to the calm level-1 default between races — see `activeLevel`'s
    // own doc comment.
    this.activeLevel = 1;
    this.activeSchedule = scheduleForLevel(1);
    for (const ring of [this.walkPastRing, this.raceRing]) ring.track.setHazardLevel(1);
    // Back down onto the walk-past ring, at park scale, where Pip, Nell and
    // Otto go back to being three normal-sized children riding a normal-sized
    // coaster round the outside of the park. This is the line that fixes the
    // bug in Jim's screenshot.
    this.setActiveRing(this.walkPastRing);
  }

  interactZones(): [] {
    return [];
  }

  dispose(): void {
    for (const ring of [this.walkPastRing, this.raceRing]) ring.track.dispose();
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

/**
 * Rival skill, by lane. Kept out of the hot loop's closure.
 *
 * The numbers themselves live in `simulate.ts` beside the brains that read
 * them, so `scripts/check-rail-race.mts` races the same rivals the browser
 * does rather than a second, driftable copy of their tuning.
 */
function skillOf(rider: Rider): number {
  return RIVAL_SKILL[rider.lane] ?? 0.7;
}
