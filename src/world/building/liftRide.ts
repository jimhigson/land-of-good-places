import { LIFT_BOARD_SECONDS } from '../../core/constants';
import type { Player } from '../../entities/Player';
import { CASTLE_FLOORS, floorX, floorZ, type CastleFloor } from './floors';
import {
  LIFT_CAR_X,
  LIFT_DOOR_MAX_Z,
  LIFT_DOOR_MIN_Z,
  LIFT_DOOR_Z,
  LIFT_LOBBY_REACH,
  LIFT_STAND_X,
} from './layout';

/**
 * Riding the lift.
 *
 * The family's ruling (GAME_DESIGN.md, "Riding the lift", 27 July 2026):
 *
 * > Walk near it and a call button appears, styled like a real elevator control
 * > panel. Press it and the lift comes quickly — never make a child wait. The
 * > character gets on automatically. The panel then shows all the floors: press
 * > one and you go straight there.
 *
 * So this file is the whole of that sequence. Nothing here asks the child to
 * walk into a moving car, line herself up, or catch anything.
 *
 * ## It is a **portal** now, and the seam held
 *
 * ARCHITECTURE-DECISIONS **Decision 3** ruled that castle floors become
 * separate spaces and that the lift survives, re-conceived as the castle's one
 * any-floor portal: press floor N, the iris closes, the doors open in floor N's
 * own alcove, and **no car ever travels anywhere**. That has now happened
 * (#377/#380). `GlassLift` — the car, the shaft, the dwell timers, its duty as
 * a `MovingPlatform` and its shaft collision — is deleted outright. "The lift
 * comes quickly, never make a child wait" is satisfied trivially, because there
 * is nothing real left to wait for.
 *
 * **The prediction in the paragraph this replaces was the point of writing it.**
 * Decision 3 named the two methods the panel had to be built against so it
 * would survive the split — {@link LiftControl.floors} and
 * {@link LiftControl.go} — and `ui/LiftPanel.ts` was written to exactly those.
 * The implementation underneath has now been replaced wholesale and **the panel
 * is untouched, not one line**. `HotelLift` proved the same seam from the other
 * side months earlier: it is a portal lift already, and it satisfies this
 * interface without knowing the castle exists.
 *
 * `panelState()` and `call()` were flagged as *expected to go* once nothing had
 * to travel. They have not, and that is a deliberate reversal: a lift you press
 * a button for and then watch the doors open is better theatre than one that
 * teleports you the instant you stand near it, and the hotel's lift keeps them
 * for the same reason. What they no longer do is fetch a car.
 */

/** One floor, as the control panel needs to show it. */
export interface FloorInfo {
  /** Deck index: 0 is the ground floor, {@link TOP_DECK} is the roof. */
  readonly index: number;
  /** "Ground floor", "Floor 2", "The roof". */
  readonly name: string;
  /** What the round button says. Lift panels use letters and numbers. */
  readonly glyph: string;
  /** True for the floor the rider is standing at right now. */
  readonly here: boolean;
  /** False while the lift is busy — a button that is about to be ignored. */
  readonly reachable: boolean;
}

/**
 * The two-method seam from Decision 3. Everything `ui/LiftPanel.ts` is allowed
 * to know about how floors actually work.
 */
export interface LiftControl {
  /** Every floor the lift serves, **top first** — the order a panel reads in. */
  floors(): readonly FloorInfo[];
  /** Take the rider straight to floor `n`. Ignored if the lift is busy. */
  go(n: number): void;
}

/** What the panel should be showing. */
export type LiftPanelMode =
  /** Waiting at the doors: one big call button. */
  | 'call'
  /** Called, and on its way. */
  | 'coming'
  /** In the car: the list of floors. */
  | 'floors'
  /** In the car and moving: the list, with the destination lit. */
  | 'going';

export interface LiftPanelState {
  readonly mode: LiftPanelMode;
  /** The little floor readout above the buttons. */
  readonly indicator: string;
  /**
   * True on the frames the doors are opening **at the floor she asked for**.
   *
   * The panel dings on the false→true edge of this, which is the one moment a
   * lift makes a noise that means something. It cannot be derived from
   * {@link mode}: arriving and travelling are both `'going'` as far as the
   * panel's *face* is concerned — the buttons look identical — and the whole
   * point of a mode is what to draw. So the arrival is its own fact.
   *
   * Optional because `LiftRide` (the castle's real car) does not report it
   * yet; `exactOptionalPropertyTypes` means it must be **omitted** rather than
   * set to `undefined`, so an implementation that has nothing to say simply
   * does not mention it.
   */
  readonly arrived?: boolean;
}

/** {@link LiftControl}, plus the bits that are only true of today's real car. */
export interface LiftPanelSource extends LiftControl {
  /** What to show, or `null` when the panel should not be on screen at all. */
  panelState(): LiftPanelState | null;
  /** "Come here, please." Fetches the car to the floor she is waiting on. */
  call(): void;
}

/** What `LiftRide` needs from the rest of the castle. */
export interface LiftRideDeps {
  /** The floor the player is on, or null when she is not in the castle. */
  currentFloor(): CastleFloor | null;
  /**
   * **The portal.** Teleport the player to `floor`'s lift alcove behind a
   * closed iris, rebinding the play bounds and swapping which floor is
   * visible. `Building` owns all of that; this file only asks.
   */
  travelTo(floor: CastleFloor): void;
  /** Stops any tap-to-move walk in progress before the character boards. */
  cancelWalk(): void;
  player(): Player | null;
}

type Phase =
  | 'away'
  /** At the doors, nothing asked for yet. */
  | 'waiting'
  /** Called; the doors are opening. */
  | 'coming'
  /** In the car, choosing. */
  | 'aboard'
  /** In the car, "travelling" — the indicator counts, the world swaps. */
  | 'going'
  /** Arrived; stepping out into the room. */
  | 'alighting';

/** Seconds the doors take to open after a call. Never make a child wait. */
const COMING_SECONDS = 0.7;

/**
 * Seconds the indicator spends counting between floors.
 *
 * Three floors rather than the hotel's fifty, so this is shorter than
 * `HotelLift`'s 2.2 s: there is no fiction of great height to sell here, and a
 * child pressing "the great hall" should arrive in the great hall.
 */
const TRAVEL_SECONDS = 1.2;

export class LiftRide implements LiftPanelSource {
  private readonly deps: LiftRideDeps;

  private phase: Phase = 'away';
  private phaseT = 0;
  private to = CASTLE_FLOORS[0]!;
  private stepT = 0;
  private readonly stepFrom = { x: 0, y: 0, z: 0 };
  /** The doorway, which every step is bent through — see {@link updateStep}. */
  private readonly stepVia = { x: 0, y: 0, z: 0 };
  private readonly stepTo = { x: 0, y: 0, z: 0 };
  private stepFacing = 0;
  private travelled = false;

  constructor(deps: LiftRideDeps) {
    this.deps = deps;
  }

  // ------------------------------------------------------------- the seam

  floors(): readonly FloorInfo[] {
    const here = this.deps.currentFloor()?.index ?? null;
    // Top first: that is the way a lift panel reads, and the way a child looks
    // at a building — the roof is up there, so its button is up there.
    const list: FloorInfo[] = [];
    for (let index = CASTLE_FLOORS.length - 1; index >= 0; index -= 1) {
      const floor = CASTLE_FLOORS[index]!;
      list.push({
        index,
        name: floor.name,
        glyph: floor.glyph,
        here: index === here,
        reachable: this.phase === 'aboard',
      });
    }
    return list;
  }

  go(n: number): void {
    if (this.phase !== 'aboard') return;
    const here = this.deps.currentFloor();
    if (!here) return;
    const target = CASTLE_FLOORS[clampFloor(n)];
    if (!target) return;
    if (target.index === here.index) {
      // Pressing the floor you are already on means "let me out here", which is
      // the only way out of the car that does not need a second control.
      this.beginAlight(here);
      return;
    }
    this.to = target;
    this.phase = 'going';
    this.phaseT = 0;
    this.travelled = false;
  }

  // ------------------------------------------------- the rest of the panel

  panelState(): LiftPanelState | null {
    switch (this.phase) {
      case 'waiting':
        return { mode: 'call', indicator: this.hereName() };
      case 'coming':
        return { mode: 'coming', indicator: 'on its way…' };
      case 'aboard':
        return { mode: 'floors', indicator: this.hereName() };
      case 'going':
        return { mode: 'going', indicator: `${this.to.name}…` };
      case 'alighting':
        // The doors are opening on the floor she pressed — the ding.
        return { mode: 'going', indicator: this.hereName(), arrived: true };
      default:
        return null;
    }
  }

  call(): void {
    if (this.phase !== 'waiting') return;
    this.phase = 'coming';
    this.phaseT = 0;
  }

  // ------------------------------------------------------------ the frame

  update(dt: number): void {
    const player = this.deps.player();
    if (!player) return;

    // Any other ride owns the character outright — the ginormous slide runs
    // through `player.beginRide` too, and two things posing one character is
    // how you get a child stuck in a wall.
    if (player.riding && !this.ridingUs()) {
      this.phase = 'away';
      return;
    }

    const floor = this.deps.currentFloor();
    this.phaseT += dt;

    switch (this.phase) {
      case 'away':
      case 'waiting': {
        if (!floor || !this.atDoors(player)) {
          this.phase = 'away';
          return;
        }
        this.phase = 'waiting';
        return;
      }
      case 'coming': {
        // She may wander off while the doors open — in which case never mind.
        if (!floor || !this.atDoors(player)) {
          this.phase = 'away';
          return;
        }
        if (this.phaseT < COMING_SECONDS) return;
        this.deps.cancelWalk();
        player.beginRide();
        // Boarding starts from wherever she actually stopped walking — she is
        // standing in the lobby and the glide draws her in.
        this.beginStep(
          player,
          floor,
          { x: player.position.x, z: player.position.z },
          { x: floorX(floor, LIFT_CAR_X), z: floorZ(floor, LIFT_DOOR_Z) },
          Math.PI / 2,
        );
        this.phase = 'aboard';
        this.phaseT = 0;
        return;
      }
      case 'aboard': {
        this.updateStep(player, dt);
        return;
      }
      case 'going': {
        this.updateStep(player, dt);
        if (this.phaseT >= TRAVEL_SECONDS && !this.travelled) {
          this.travelled = true;
          // The portal fires: iris, teleport, new play bounds, the destination
          // floor made visible. Alighting begins on the far side of it.
          this.deps.travelTo(this.to);
          this.beginAlight(this.to);
        }
        return;
      }
      case 'alighting': {
        this.updateStep(player, dt);
        if (this.stepT >= 1) {
          this.phase = 'away';
          player.endRide();
        }
        return;
      }
    }
  }

  // ------------------------------------------------------------ internals

  /** True while *we* are the ride posing the character. */
  private ridingUs(): boolean {
    return this.phase === 'aboard' || this.phase === 'going' || this.phase === 'alighting';
  }

  private hereName(): string {
    return this.deps.currentFloor()?.name ?? '';
  }

  /**
   * Is she in the lift lobby?
   *
   * The same patch of floor on every floor, in that floor's own local metres —
   * a lift alcove that wandered from floor to floor would read as broken.
   */
  private atDoors(player: Player): boolean {
    const floor = this.deps.currentFloor();
    if (!floor) return false;
    const localX = player.position.x - floor.originX;
    const localZ = player.position.z - floor.originZ;
    if (localX < LIFT_STAND_X - LIFT_LOBBY_REACH) return false;
    if (localZ < LIFT_DOOR_MIN_Z - 1.2 || localZ > LIFT_DOOR_MAX_Z + 1.2) return false;
    return true;
  }

  /**
   * Stepping out into the room, on the floor she pressed for.
   *
   * **Every point comes from `floor`, not from `player.position`** — and that
   * is not a style choice, it is the whole correctness of the manoeuvre.
   * {@link travelTo} runs behind a closed iris, so the teleport has *not
   * happened yet* when this is called on the very next line: she is still
   * standing in the alcove of the floor she left. Reading her position here
   * made the glide interpolate from the old floor's alcove to the new one's —
   * **three hundred metres across open nothing**, with her visibly sliding
   * through the void between two castles for half a second.
   *
   * Every check was green: the arrival is correct, the space is correct, and
   * the validator asserts where she *ends up*, not the path she takes to get
   * there. It was found by riding the lift and reading her x mid-glide: 826.4,
   * which is 73.6 m short of the great hall and 200 m past the mall.
   * `HotelLift` never had the bug because its `beginAlight` always derived both
   * ends from the room.
   */
  private beginAlight(floor: CastleFloor): void {
    const player = this.deps.player();
    if (!player) return;
    this.beginStep(
      player,
      floor,
      { x: floorX(floor, LIFT_CAR_X), z: floorZ(floor, LIFT_DOOR_Z) },
      { x: floorX(floor, LIFT_STAND_X), z: floorZ(floor, LIFT_DOOR_Z) },
      -Math.PI / 2,
    );
    this.phase = 'alighting';
    this.phaseT = 0;
  }

  /**
   * Sets up one scripted step across `floor`'s own lift alcove.
   *
   * `floor` is passed rather than asked of `currentFloor()` for the same reason
   * the ends are: mid-transition the player's position is not yet on the floor
   * this step belongs to.
   */
  private beginStep(
    player: Player,
    floor: CastleFloor,
    from: { x: number; z: number },
    to: { x: number; z: number },
    facing: number,
  ): void {
    // Every floor's walking surface is at the same height since the split, so
    // one `y` serves all three and the step never rises or falls.
    const y = player.position.y;
    this.stepFrom.x = from.x;
    this.stepFrom.y = y;
    this.stepFrom.z = from.z;
    // The doorway itself, bent through so the curve does not clip the jamb.
    this.stepVia.x = floorX(floor, LIFT_STAND_X + 1.4);
    this.stepVia.y = y;
    this.stepVia.z = floorZ(floor, LIFT_DOOR_Z);
    this.stepTo.x = to.x;
    this.stepTo.y = y;
    this.stepTo.z = to.z;
    this.stepFacing = facing;
    this.stepT = 0;
  }

  /**
   * One scripted step — in through the doors, or out of them, then held.
   *
   * A quadratic curve bent through the doorway rather than a straight line,
   * because a straight line from wherever she happened to stop would clip the
   * door jamb: the lobby she can wait in is wider than the hole in the wall.
   * Nothing here is collided against — it is half a second of choreography —
   * so the curve is the only thing keeping her out of the wall.
   */
  private updateStep(player: Player, dt: number): void {
    this.stepT = Math.min(1, this.stepT + dt / LIFT_BOARD_SECONDS);
    const t = smoothstep(this.stepT);
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    player.setRidePose(
      a * this.stepFrom.x + b * this.stepVia.x + c * this.stepTo.x,
      a * this.stepFrom.y + b * this.stepVia.y + c * this.stepTo.y,
      a * this.stepFrom.z + b * this.stepVia.z + c * this.stepTo.z,
      this.stepFacing,
    );
  }
}

/**
 * Matches `Game.ts`'s and `ParkMap`'s, so the game agrees with itself about
 * what a floor is called — and all three now read the **one** table in
 * `floors.ts` rather than each carrying their own `deck <= 0 ? …` ladder.
 */
export function floorName(deck: number): string {
  return CASTLE_FLOORS[clampFloor(deck)]?.name ?? 'The mall';
}

function clampFloor(index: number): number {
  return Math.max(0, Math.min(CASTLE_FLOORS.length - 1, Math.round(index)));
}

/** Ease in and out, so a half-second step does not start and stop with a jerk. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
