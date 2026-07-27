import {
  BUILDING_FLOOR_COUNT,
  INTERIOR_ORIGIN_X,
  INTERIOR_ORIGIN_Z,
  LIFT_BOARD_SECONDS,
} from '../../core/constants';
import type { Player } from '../../entities/Player';
import type { GlassLift } from './GlassLift';
import type { WalkSurfaces } from './surfaces';
import {
  LIFT_CAR_X,
  LIFT_CAR_Z,
  LIFT_DOOR_MAX_Z,
  LIFT_DOOR_MIN_Z,
  LIFT_DOOR_Z,
  LIFT_LOBBY_REACH,
  LIFT_STAND_X,
  TOP_DECK,
  deckY,
  worldX,
  worldZ,
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
 * So this file is the whole of that sequence, and `GlassLift` is now only the
 * box that moves. Nothing here asks the child to walk into a moving car, line
 * herself up, or catch anything.
 *
 * ## The seam
 *
 * ARCHITECTURE-DECISIONS **Decision 3** rules that castle floors become
 * separate spaces, and that the lift survives it re-conceived as the castle's
 * one any-floor portal: press floor N, the iris closes, the doors open in floor
 * N's alcove, and no car ever travels anywhere. The decision names the two
 * methods the panel must be built against so that it survives —
 * {@link LiftControl.floors} and {@link LiftControl.go} — and that is exactly
 * what `ui/LiftPanel.ts` is written to. When the split lands, `LiftRide` is
 * replaced by a portal implementation of the same two methods and the panel is
 * untouched.
 *
 * {@link LiftPanelSource} adds two more members that are deliberately *not*
 * part of that seam: `panelState()` and `call()`. They are today's proximity
 * and summon glue — under the split "call" is meaningless (nothing has to
 * travel) and presence becomes the portal's trigger region — so they are named
 * separately and expected to go.
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
}

/** {@link LiftControl}, plus the bits that are only true of today's real car. */
export interface LiftPanelSource extends LiftControl {
  /** What to show, or `null` when the panel should not be on screen at all. */
  panelState(): LiftPanelState | null;
  /** "Come here, please." Fetches the car to the floor she is waiting on. */
  call(): void;
}

/** What `LiftRide` needs from the rest of the building. */
export interface LiftRideDeps {
  readonly lift: GlassLift;
  readonly surfaces: WalkSurfaces;
  /** Stops any tap-to-move walk that is in progress before the character boards. */
  cancelWalk(): void;
  /** True while the player is in the building's own space. */
  isInside(): boolean;
}

type Phase =
  | 'away'
  /** At the doors, nothing asked for yet. */
  | 'waiting'
  /** Called; the car is on its way to her. */
  | 'coming'
  /** The car is here and she is stepping in. */
  | 'boarding'
  /** In the car, choosing. */
  | 'aboard'
  /** In the car, travelling. */
  | 'going'
  /** Arrived; stepping out onto the deck. */
  | 'alighting';

export class LiftRide implements LiftPanelSource {
  private readonly deps: LiftRideDeps;
  private player: Player | null = null;

  private phase: Phase = 'away';
  /** The deck she is waiting on, or the one the car is carrying her to. */
  private floorWanted = 0;
  /** Progress through a board or alight step, 0..1. */
  private stepT = 0;
  private readonly stepFrom = { x: 0, y: 0, z: 0 };
  /** The doorway, which every step is bent through — see {@link updateStep}. */
  private readonly stepVia = { x: 0, y: 0, z: 0 };
  private readonly stepTo = { x: 0, y: 0, z: 0 };
  private stepFacing = 0;

  constructor(deps: LiftRideDeps) {
    this.deps = deps;
  }

  attachPlayer(player: Player): void {
    this.player = player;
  }

  // ------------------------------------------------------------- the seam

  floors(): readonly FloorInfo[] {
    const here = this.riderFloor();
    // Top first: that is the way a lift panel reads, and the way a child looks
    // at a building — the roof is up there, so its button is up there.
    const list: FloorInfo[] = [];
    for (let index = TOP_DECK; index >= 0; index -= 1) {
      list.push({
        index,
        name: floorName(index),
        glyph: floorGlyph(index),
        here: index === here,
        reachable: this.phase === 'aboard',
      });
    }
    return list;
  }

  go(n: number): void {
    if (this.phase !== 'aboard') return;
    const wanted = clampFloor(n);
    if (wanted === this.deps.lift.floor) {
      // Pressing the floor you are already on means "let me out here", which is
      // the only way out of the car that does not need a second control.
      this.beginAlight();
      return;
    }
    this.floorWanted = wanted;
    this.phase = 'going';
    this.deps.lift.callTo(wanted);
  }

  // ------------------------------------------------- the rest of the panel

  panelState(): LiftPanelState | null {
    switch (this.phase) {
      case 'waiting':
        return { mode: 'call', indicator: floorName(this.floorWanted) };
      case 'coming':
      case 'boarding':
        return { mode: 'coming', indicator: 'on its way…' };
      case 'aboard':
        return { mode: 'floors', indicator: floorName(this.deps.lift.floor) };
      case 'going':
      case 'alighting':
        return { mode: 'going', indicator: `${floorName(this.floorWanted)}…` };
      default:
        return null;
    }
  }

  call(): void {
    if (this.phase !== 'waiting') return;
    this.phase = 'coming';
    this.deps.lift.callTo(this.floorWanted);
  }

  // ------------------------------------------------------------ the frame

  update(dt: number): void {
    this.deps.lift.update(dt);

    const player = this.player;
    if (!player) return;

    // Any other ride owns the character outright — the slides and the
    // helter-skelter all run through `player.beginRide` too, and two things
    // posing one character is how you get a child stuck in a wall.
    if (player.riding && !this.ridingUs()) {
      this.phase = 'away';
      return;
    }

    switch (this.phase) {
      case 'away':
      case 'waiting':
        this.updateWaiting(player);
        return;
      case 'coming':
        this.updateComing(player);
        return;
      case 'boarding':
        this.updateStep(player, dt, () => {
          this.phase = 'aboard';
        });
        return;
      case 'aboard':
        this.holdInCar(player);
        return;
      case 'going':
        this.holdInCar(player);
        if (!this.deps.lift.moving) this.beginAlight();
        return;
      case 'alighting':
        this.updateStep(player, dt, () => {
          this.phase = 'away';
          player.endRide();
        });
        return;
    }
  }

  // ------------------------------------------------------------ internals

  /** True while *we* are the ride posing the character. */
  private ridingUs(): boolean {
    return this.phase === 'boarding' || this.phase === 'aboard' || this.phase === 'going' || this.phase === 'alighting';
  }

  /**
   * The floor the panel should light.
   *
   * While travelling that is the floor she has *asked for*, not the one the car
   * has reached — which is what every real lift panel does, and what tells a
   * child the press worked.
   */
  private riderFloor(): number {
    if (this.phase === 'going' || this.phase === 'alighting') return this.floorWanted;
    return this.ridingUs() ? this.deps.lift.floor : this.floorWanted;
  }

  /**
   * Not in the lift yet. Two ways in: standing in the lobby (which puts the
   * call panel on screen), or having walked into the car on her own two feet,
   * which the old lift was the only way to ride and which still has to work.
   */
  private updateWaiting(player: Player): void {
    if (!this.deps.isInside()) {
      this.phase = 'away';
      return;
    }

    if (!this.deps.lift.moving && this.inCar(player)) {
      this.startBoarding(player, true);
      return;
    }

    const deck = this.lobbyDeck(player);
    if (deck === null) {
      this.phase = 'away';
      return;
    }
    this.floorWanted = deck;
    this.phase = 'waiting';
  }

  /** Called, and coming. She may wander off, in which case never mind. */
  private updateComing(player: Player): void {
    if (!this.deps.isInside()) {
      this.phase = 'away';
      return;
    }
    const deck = this.lobbyDeck(player);
    if (deck === null) {
      this.phase = 'away';
      return;
    }
    if (deck !== this.floorWanted) {
      // She took the stairs while it was coming. Re-fetch it to where she is.
      this.floorWanted = deck;
      this.deps.lift.callTo(deck);
      return;
    }
    if (this.deps.lift.moving || this.deps.lift.floor !== deck) return;

    this.startBoarding(player, false);
  }

  /**
   * Getting on, automatically — the whole point of the family's note.
   *
   * A short scripted glide rather than a walk: the car is a moving platform in
   * a shaft with a drop under it, and "walk yourself in through the doorway"
   * is precisely the fiddly thing being deleted. `alreadyInside` covers the
   * child who walked in herself, who needs the panel but not the step.
   */
  private startBoarding(player: Player, alreadyInside: boolean): void {
    this.deps.cancelWalk();
    player.beginRide();
    this.floorWanted = this.deps.lift.floor;

    const target = this.carPoint();
    this.stepFrom.x = player.position.x;
    this.stepFrom.y = player.position.y;
    this.stepFrom.z = player.position.z;
    this.setVia(target.y);
    this.stepTo.x = target.x;
    this.stepTo.y = target.y;
    this.stepTo.z = target.z;
    // Facing +X: out through the glass, at the park. It is a *glass* lift; the
    // view is the reason it exists.
    this.stepFacing = Math.PI / 2;
    this.stepT = alreadyInside ? 1 : 0;
    this.phase = alreadyInside ? 'aboard' : 'boarding';
    if (alreadyInside) this.holdInCar(player);
  }

  private beginAlight(): void {
    const player = this.player;
    if (!player) return;
    const floor = this.deps.lift.floor;
    this.floorWanted = floor;

    this.stepFrom.x = player.position.x;
    this.stepFrom.y = player.position.y;
    this.stepFrom.z = player.position.z;
    this.setVia(deckY(floor));
    this.stepTo.x = worldX(LIFT_STAND_X);
    this.stepTo.y = deckY(floor);
    this.stepTo.z = worldZ(LIFT_DOOR_Z);
    // Facing −X, into the room she has just arrived on.
    this.stepFacing = -Math.PI / 2;
    this.stepT = 0;
    this.phase = 'alighting';
  }

  /** The doorway itself, at the height the step ends at. */
  private setVia(y: number): void {
    this.stepVia.x = worldX(LIFT_STAND_X + 1.4);
    this.stepVia.y = y;
    this.stepVia.z = worldZ(LIFT_DOOR_Z);
  }

  /**
   * One scripted step — in through the doors, or out of them.
   *
   * A quadratic curve bent through the doorway rather than a straight line,
   * because a straight line from wherever she happened to stop would clip the
   * door jamb: the lobby she can wait in is wider than the hole in the wall.
   * Nothing here is collided against — it is half a second of choreography —
   * so the curve is the only thing keeping her out of the wall.
   */
  private updateStep(player: Player, dt: number, onDone: () => void): void {
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
    if (this.stepT >= 1) onDone();
  }

  /** Standing in the car, wherever the car happens to be this frame. */
  private holdInCar(player: Player): void {
    const point = this.carPoint();
    player.setRidePose(point.x, point.y, point.z, Math.PI / 2);
  }

  private carPoint(): { x: number; y: number; z: number } {
    return {
      x: worldX(LIFT_CAR_X),
      y: this.deps.lift.surfaceY,
      z: worldZ(LIFT_CAR_Z),
    };
  }

  private inCar(player: Player): boolean {
    return (
      this.deps.lift.covers(player.position.x, player.position.z) &&
      Math.abs(player.position.y - this.deps.lift.surfaceY) < 0.7
    );
  }

  /**
   * The deck she is waiting on, or null if she is not at the lift doors.
   *
   * Same patch of floor the old `Building.callLiftIfWaiting` watched, widened
   * to {@link LIFT_LOBBY_REACH} so the panel appears while she is still walking
   * up rather than only once she is standing on exactly the right tile.
   */
  private lobbyDeck(player: Player): number | null {
    const localX = player.position.x - INTERIOR_ORIGIN_X;
    const localZ = player.position.z - INTERIOR_ORIGIN_Z;
    if (localX < LIFT_STAND_X - LIFT_LOBBY_REACH) return null;
    if (localZ < LIFT_DOOR_MIN_Z - 1.2 || localZ > LIFT_DOOR_MAX_Z + 1.2) return null;
    return this.deps.surfaces.deckAt(player.position.x, player.position.z, player.position.y);
  }
}

/** Matches `Game.ts`'s `floorName` and `ParkMap`'s, so the game agrees with itself. */
export function floorName(deck: number): string {
  if (deck <= 0) return 'Ground floor';
  if (deck >= BUILDING_FLOOR_COUNT - 1) return 'The roof';
  return `Floor ${deck}`;
}

/** What the round button on the panel says. */
function floorGlyph(deck: number): string {
  if (deck <= 0) return 'G';
  if (deck >= BUILDING_FLOOR_COUNT - 1) return 'R';
  return String(deck);
}

function clampFloor(deck: number): number {
  return Math.max(0, Math.min(TOP_DECK, Math.round(deck)));
}

/** Ease in and out, so a half-second step does not start and stop with a jerk. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
