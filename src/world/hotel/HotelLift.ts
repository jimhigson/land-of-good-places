import type { Player } from '../../entities/Player';
import type {
  FloorInfo,
  LiftPanelSource,
  LiftPanelState,
} from '../building/liftRide';
import { HOTEL_FLOORS, LIFT_CAR_X, type HotelRoom } from './layout';

/**
 * The Land Hotel's lift — the first **portal lift**, the exact shape
 * ARCHITECTURE-DECISIONS Decision 3 promises the castle: press floor N, the
 * iris closes, the doors open in floor N's own space, and *no car ever
 * travels anywhere*. It implements the same two-method seam
 * (`floors()` / `go(n)`) the castle's `LiftRide` does, so `ui/LiftPanel.ts`
 * drives it without one edited line — the panel was written against the seam
 * precisely so an implementation like this one could arrive underneath it.
 *
 * The fiction is fifty storeys (Eleri's spec); the panel offers the three a
 * child can press, and while "travelling" the indicator counts storeys past
 * at a rate that makes floor 50 feel properly far away without ever making
 * her wait: the whole ride is under three seconds, and Decision 3's rule —
 * never make a child wait — is why no car exists to be waited for.
 */

/** What the hotel hands its lift. The lift owns phases; the hotel owns space. */
export interface HotelLiftDeps {
  /** The room the player is in, or null when not in the hotel at all. */
  currentRoom(): HotelRoom | null;
  /** Is the player standing in this room's lift alcove reach? */
  atLiftDoors(player: Player): boolean;
  /** Teleport the player to `room`'s lift alcove, behind the iris. */
  travelTo(room: HotelRoom): void;
  /** Has reception given her the key? Floor 50 is hers, and needs it. */
  hasKey(): boolean;
  cancelWalk(): void;
  player(): Player | null;
}

type Phase = 'away' | 'waiting' | 'coming' | 'aboard' | 'going' | 'alighting';

/** Seconds the doors take to "arrive" after a call. Never make a child wait. */
const COMING_SECONDS = 0.7;

/** Seconds the storey counter spends ticking between floors. */
const TRAVEL_SECONDS = 2.2;

/** Seconds to glide in or out of the alcove. */
const STEP_SECONDS = 0.5;

export class HotelLift implements LiftPanelSource {
  private phase: Phase = 'away';
  private phaseT = 0;
  private from = HOTEL_FLOORS[0]!;
  private to = HOTEL_FLOORS[0]!;
  private readonly step = { fromX: 0, fromZ: 0, toX: 0, toZ: 0, y: 0 };
  private travelled = false;

  constructor(private readonly deps: HotelLiftDeps) {}

  // -------------------------------------------------------------- the seam

  floors(): readonly FloorInfo[] {
    const room = this.deps.currentRoom();
    const here = room?.liftFloor ?? null;
    const list: FloorInfo[] = [];
    for (let index = HOTEL_FLOORS.length - 1; index >= 0; index -= 1) {
      const floor = HOTEL_FLOORS[index]!;
      list.push({
        index,
        name: floor.name,
        glyph: floor.glyph,
        here: index === here,
        // Your floor is yours once you have your key — reception's whole job.
        reachable: this.phase === 'aboard' && (index !== 2 || this.deps.hasKey()),
      });
    }
    return list;
  }

  go(n: number): void {
    if (this.phase !== 'aboard') return;
    const target = HOTEL_FLOORS[Math.max(0, Math.min(HOTEL_FLOORS.length - 1, Math.round(n)))];
    if (!target) return;
    const room = this.deps.currentRoom();
    if (!room) return;
    if (target.room.liftFloor === room.liftFloor) {
      this.beginAlight(room);
      return;
    }
    if (target === HOTEL_FLOORS[2] && !this.deps.hasKey()) return;
    this.from = HOTEL_FLOORS[room.liftFloor ?? 0] ?? HOTEL_FLOORS[0]!;
    this.to = target;
    this.phase = 'going';
    this.phaseT = 0;
    this.travelled = false;
  }

  // ----------------------------------------------------- the rest of the panel

  panelState(): LiftPanelState | null {
    switch (this.phase) {
      case 'waiting':
        return { mode: 'call', indicator: this.hereName() };
      case 'coming':
        return { mode: 'coming', indicator: 'on its way…' };
      case 'aboard':
        return { mode: 'floors', indicator: this.hereName() };
      case 'going':
        return { mode: 'going', indicator: `${this.tickingFloorName()}…` };
      case 'alighting':
        return { mode: 'going', indicator: this.hereName() };
      default:
        return null;
    }
  }

  call(): void {
    if (this.phase !== 'waiting') return;
    this.phase = 'coming';
    this.phaseT = 0;
  }

  // -------------------------------------------------------------- the frame

  update(dt: number): void {
    const player = this.deps.player();
    if (!player) return;

    if (player.riding && !this.ridingUs()) {
      this.phase = 'away';
      return;
    }

    const room = this.deps.currentRoom();
    this.phaseT += dt;

    switch (this.phase) {
      case 'away':
      case 'waiting': {
        if (!room || room.liftZ === null || !this.deps.atLiftDoors(player)) {
          this.phase = 'away';
          return;
        }
        this.phase = 'waiting';
        return;
      }
      case 'coming': {
        // She may wander off while it comes — in which case never mind
        // (the castle lift's own rule). Grabbing her from across the room
        // was the reviewer's first finding on PR #247.
        if (!room || !this.deps.atLiftDoors(player)) {
          this.phase = 'away';
          return;
        }
        if (this.phaseT < COMING_SECONDS) return;
        // Doors open; glide her in. The alcove mouth is the via point by
        // construction — the alcove faces the room, so a straight glide from
        // anywhere in reach passes through it.
        this.deps.cancelWalk();
        player.beginRide();
        this.step.fromX = player.position.x;
        this.step.fromZ = player.position.z;
        this.step.toX = room.originX + LIFT_CAR_X - room.halfX;
        this.step.toZ = room.originZ + (room.liftZ ?? 0);
        this.step.y = player.position.y;
        this.phase = 'aboard';
        this.phaseT = 0;
        return;
      }
      case 'aboard': {
        this.holdInCar(player);
        return;
      }
      case 'going': {
        this.holdInCar(player);
        if (this.phaseT >= TRAVEL_SECONDS && !this.travelled) {
          this.travelled = true;
          // The portal: iris, teleport, new play bounds — the hotel owns all
          // of that; this only asks. Alighting starts when it lands.
          this.deps.travelTo(this.to.room);
          this.beginAlight(this.to.room);
        }
        return;
      }
      case 'alighting': {
        const t = Math.min(1, this.phaseT / STEP_SECONDS);
        const eased = t * t * (3 - 2 * t);
        player.setRidePose(
          this.step.fromX + (this.step.toX - this.step.fromX) * eased,
          this.step.y,
          this.step.fromZ + (this.step.toZ - this.step.fromZ) * eased,
          Math.PI / 2, // facing +X: out of the west-wall alcove, into the room
        );
        if (t >= 1) {
          this.phase = 'away';
          player.endRide();
        }
        return;
      }
    }
  }

  // ------------------------------------------------------------- internals

  private ridingUs(): boolean {
    return this.phase === 'aboard' || this.phase === 'going' || this.phase === 'alighting';
  }

  private beginAlight(room: HotelRoom): void {
    const player = this.deps.player();
    if (!player) return;
    this.step.fromX = room.originX + LIFT_CAR_X - room.halfX;
    this.step.fromZ = room.originZ + (room.liftZ ?? 0);
    this.step.toX = room.originX + LIFT_CAR_X - room.halfX + 3.4;
    this.step.toZ = room.originZ + (room.liftZ ?? 0);
    this.step.y = player.position.y;
    this.phase = 'alighting';
    this.phaseT = 0;
  }

  private holdInCar(player: Player): void {
    // A short glide in, then held at the car spot, facing back into the room.
    const t = Math.min(1, this.phaseT / STEP_SECONDS);
    const eased = t * t * (3 - 2 * t);
    player.setRidePose(
      this.step.fromX + (this.step.toX - this.step.fromX) * eased,
      this.step.y,
      this.step.fromZ + (this.step.toZ - this.step.fromZ) * eased,
      Math.PI / 2,
    );
  }

  private hereName(): string {
    const room = this.deps.currentRoom();
    return room ? HOTEL_FLOORS[room.liftFloor ?? 0]?.name ?? 'Lobby' : '';
  }

  /** The storey the indicator shows mid-travel — counting, like a real lift. */
  private tickingStorey(): number {
    const t = Math.min(1, this.phaseT / TRAVEL_SECONDS);
    const eased = t * t * (3 - 2 * t);
    const from = this.from.storey;
    const to = this.to.storey;
    return Math.round(from + (to - from) * eased);
  }

  /**
   * What that storey is *called*. Storey 0 is the ground floor and says so:
   * `HOTEL_FLOORS` numbers the hotel the British way (see its doc comment), so
   * the number below Floor 1 is 0, and "Floor 0…" is not a thing a lift has
   * ever said to a six-year-old.
   */
  private tickingFloorName(): string {
    const storey = this.tickingStorey();
    return storey === 0 ? 'Ground floor' : `Floor ${storey}`;
  }
}
