import { Box3, CatmullRomCurve3, Group, Vector3 } from 'three';
import type { CollisionWorld, WallCollider } from '../Collision';
import type { InteriorControls } from '../building/Building';
import type { Player } from '../../entities/Player';
import { PLAYER_RADIUS } from '../../core/constants';
import { resolveDismount } from '../dismount';
import { pressZone, type InteractZone } from '../interact';
import { highlightObject } from '../highlight';
import { createTortoise, type TortoiseHandle } from '../../art/models/reptiles';
import type { ReptileProps } from './props';
import {
  REPTILE_HOUSE_FLOOR_Y,
  REPTILE_HOUSE_ORIGIN_X,
  REPTILE_HOUSE_ORIGIN_Z,
  TORTOISE_RIDE_LOOP,
  TORTOISE_RIDE_PARK,
  TORTOISE_RIDE_PARK_HALF_LENGTH,
  TORTOISE_RIDE_PARK_HALF_WIDTH,
  TORTOISE_RIDE_PICK_RADIUS,
  TORTOISE_RIDE_SCALE,
  TORTOISE_RIDE_SPEED,
  TORTOISE_RIDE_STAND,
  TORTOISE_RIDE_ZONE_SETBACK,
  type LocalPoint,
} from './layout';

/**
 * **The Tortoise Ride** — Jim, 2 October 2026: *"Yeah, put the two rides in,
 * why not?"* (the spec had dropped it). A big friendly tortoise, Tock's
 * grown-up cousin, parked in the foyer: "Hop on!" and she sits on its shell
 * while it plods out of the foyer, once round the ring past Noodle, and back
 * to where it started, where it puts her down on the stand spot.
 *
 * Shaped like the Sky Cruiser's board/arrive (`coaster/Coaster.ts`) with the
 * tree climb's iso-camera loop (`TreeClimbing.ts`): `Player.beginRide` hands
 * her to us, every frame is one `setRidePose` at the seat's world position,
 * `endRide` after a `resolveDismount` on the stand spot. No camera override —
 * the fixed iso camera follows `player.position` on its own, and the HUD
 * hides itself while `player.riding`.
 *
 * **Getting off is any input.** Jim, 2 October 2026, having ridden it: *"the
 * tortoise ride needs a way to get off — jumping or trying to walk anywhere
 * should jump off its back and return to normal play."* So mid-lap a jump,
 * any stick or key movement, or a tap anywhere (`Game`'s tap handler, the
 * tree climb's "tap means come down" branch) is {@link dismount}: a hop off
 * the shell onto clear floor beside the tortoise (`resolveDismount`, never
 * into a kerb or a case), `Player.endRide` the same frame, and the tortoise
 * plods the rest of its lap back to the bay on its own. GAME_DESIGN's
 * CONTROL rule: pressing left means go left — here it means get off and go
 * left, which is the same thing one frame later.
 *
 * **Solid when parked, scenery when walking.** Parked, the tortoise is a
 * drawn thing a child can lean on, so it is one `ReptileProps.wall` — a
 * filled capsule along its body, head included — at the parking spot
 * (keep-outs asserted like every other solid in the hall). Walking, she is
 * on it and nothing else is near it; the capsule comes out at boarding and
 * goes back at arrival — two collision edits per lap, not one per frame,
 * and the parking spot is never an invisible solid with no tortoise on it. The lap itself (`TORTOISE_RIDE_LOOP`) runs the ring and
 * the south opening, both wider than the tortoise by a stride; riding
 * bypasses collision, so a bed's kerb could not stop it anyway, which is why
 * the loop is proved against the layout's own path widths rather than trusted.
 */
/** The parked capsule's two ends, hall-local: along the parking spot's facing, head end first. */
function parkedCapsule(): [LocalPoint, LocalPoint] {
  const yaw = (TORTOISE_RIDE_PARK.facing * Math.PI) / 180;
  const dx = Math.sin(yaw) * TORTOISE_RIDE_PARK_HALF_LENGTH;
  const dz = Math.cos(yaw) * TORTOISE_RIDE_PARK_HALF_LENGTH;
  return [
    { x: TORTOISE_RIDE_PARK.x + dx, z: TORTOISE_RIDE_PARK.z + dz },
    { x: TORTOISE_RIDE_PARK.x - dx, z: TORTOISE_RIDE_PARK.z - dz },
  ];
}

/** What the ride reads of the frame's input: the two things that mean "off", wherever she is. */
export interface RideInput {
  justPressed(action: 'jump'): boolean;
  readonly moveAmount: number;
}

/** A nudge off the shell: sideways, up a little, and she is walking. */
const HOP_OFF_SIDE = 1.2;
const HOP_OFF_UP = 3;
/** Where she lands, beside the tortoise's flank, before `resolveDismount` has its say. */
const DISMOUNT_BESIDE = 1.7;

export class TortoiseRide {
  readonly tortoise: TortoiseHandle;
  private readonly root: Group;
  private readonly props: ReptileProps;
  private readonly collision: CollisionWorld;
  private readonly controls: InteriorControls;
  private readonly loop: CatmullRomCurve3;
  private readonly length: number;
  private readonly seat = new Group();
  private readonly at = new Vector3();
  private readonly ahead = new Vector3();
  private readonly seatWorld = new Vector3();
  private player: Player | null = null;
  /** The tortoise is out on its lap (with or without her). */
  private walking = false;
  /** She is on its shell. */
  private riding = false;
  private along = 0;
  private phase = 0;
  private yaw = (TORTOISE_RIDE_PARK.facing * Math.PI) / 180;
  /** The parked capsule's handle in the collision world, or `null` while it is out walking. */
  private bay: WallCollider | null = null;
  private readonly parkedSolid: ReptileProps['solids'][number];

  constructor(root: Group, props: ReptileProps, collision: CollisionWorld, controls: InteriorControls) {
    this.root = root;
    this.props = props;
    this.collision = collision;
    this.controls = controls;
    this.tortoise = createTortoise(2024, TORTOISE_RIDE_SCALE);
    this.tortoise.root.name = 'reptile.tortoise-ride';
    root.add(this.tortoise.root);
    // The seat: on top of the shell, a little back of its middle, so she sits
    // on the dome of it rather than on the neck.
    const shell = new Box3().setFromObject(this.tortoise.shell);
    this.seat.position.set(0, shell.max.y - 0.08, -0.15); // flat-ok: the tortoise's box taken under its root before any lean; the hall is flat (floor y 0, off the sphere)
    this.tortoise.root.add(this.seat);

    this.loop = new CatmullRomCurve3(
      TORTOISE_RIDE_LOOP.map((point) => new Vector3(point.x, 0, point.z)),
      true,
      'centripetal',
    );
    this.length = this.loop.getLength();

    const [front, back] = parkedCapsule();
    this.props.wall('the tortoise ride, parked', front, back, TORTOISE_RIDE_PARK_HALF_WIDTH, 'wall');
    this.parkedSolid = this.props.solids[this.props.solids.length - 1]!;
    this.bay = this.parkedSolid.handle as WallCollider;
    this.park();
  }

  attachPlayer(player: Player): void {
    this.player = player;
  }

  get playerRiding(): boolean {
    return this.riding;
  }

  /** Back in its bay with its capsule registered — for the check. */
  get parked(): boolean {
    return !this.walking && this.bay !== null;
  }

  /** "Hop on!" — from the chip, or from `/tortoise-ride` once she is in the hall. */
  requestBoard(): boolean {
    const player = this.player;
    if (!player || player.riding || this.walking) return false;
    this.controls.cancelWalk();
    this.walking = true;
    this.riding = true;
    this.along = 0;
    if (this.bay !== null) {
      this.collision.removeWall(this.bay);
      this.bay = null;
    }
    player.beginRide();
    this.place(0);
    return true;
  }

  zones(): InteractZone[] {
    if (this.riding) return [];
    const yaw = (TORTOISE_RIDE_PARK.facing * Math.PI) / 180;
    const zoneX = TORTOISE_RIDE_PARK.x - Math.sin(yaw) * TORTOISE_RIDE_ZONE_SETBACK;
    const zoneZ = TORTOISE_RIDE_PARK.z - Math.cos(yaw) * TORTOISE_RIDE_ZONE_SETBACK;
    return [
      pressZone(
        {
          id: 'reptile:tortoiseRide',
          label: 'Tortoise ride',
          x: REPTILE_HOUSE_ORIGIN_X + zoneX,
          y: 1,
          z: REPTILE_HOUSE_ORIGIN_Z + zoneZ,
          pickRadius: TORTOISE_RIDE_PICK_RADIUS,
          standX: REPTILE_HOUSE_ORIGIN_X + TORTOISE_RIDE_STAND.x,
          standZ: REPTILE_HOUSE_ORIGIN_Z + TORTOISE_RIDE_STAND.z,
          verb: 'Ride',
          highlight: highlightObject(this.tortoise.root),
        },
        () => {
          this.requestBoard();
        },
        '🐢',
        'Hop on!',
      ),
    ];
  }

  /**
   * Off the shell, onto clear floor beside the tortoise, walking — from a
   * jump, a movement, or a tap. A no-op when she is not on it.
   */
  dismount(): void {
    const player = this.player;
    if (!player || !this.riding) return;
    this.riding = false;
    // Beside its flank, on the side away from the ring's middle — the beds and
    // Noodle's kerb are inboard of the ring, the open floor outboard — then
    // `resolveDismount` spirals out from there if that spot is not clear.
    const sideX = Math.cos(this.yaw);
    const sideZ = -Math.sin(this.yaw);
    const outward = sideX * this.at.x + sideZ * this.at.z >= 0 ? 1 : -1;
    const { x, z } = resolveDismount(
      this.collision,
      REPTILE_HOUSE_ORIGIN_X + this.at.x + sideX * outward * DISMOUNT_BESIDE,
      REPTILE_HOUSE_ORIGIN_Z + this.at.z + sideZ * outward * DISMOUNT_BESIDE,
      PLAYER_RADIUS,
    );
    player.setRidePose(x, REPTILE_HOUSE_FLOOR_Y, z, this.yaw);
    player.endRide(sideX * outward * HOP_OFF_SIDE, HOP_OFF_UP, sideZ * outward * HOP_OFF_SIDE);
  }

  update(dt: number, elapsed: number, input?: RideInput): void {
    if (this.riding && input && (input.justPressed('jump') || input.moveAmount > 0.22)) this.dismount();
    if (this.walking) {
      this.along += TORTOISE_RIDE_SPEED * dt;
      if (this.along >= this.length) {
        this.arrive();
      } else {
        this.phase = (this.phase + dt * 1.1) % 1;
        this.tortoise.setWalkPhase(this.phase, 1);
        this.place(this.along);
      }
    } else {
      this.tortoise.setWalkPhase(0, 0);
    }
    this.tortoise.update(dt, elapsed);
  }

  /** The tortoise at `along` metres round the lap, and her on its seat. */
  private place(along: number): void {
    const u = Math.min(along / this.length, 0.9999);
    this.loop.getPointAt(u, this.at);
    this.loop.getPointAt(Math.min((along + 0.4) / this.length, 0.9999), this.ahead);
    const dx = this.ahead.x - this.at.x;
    const dz = this.ahead.z - this.at.z;
    if (Math.hypot(dx, dz) > 1e-4) this.yaw = Math.atan2(dx, dz);
    this.tortoise.root.position.set(this.at.x, 0, this.at.z);
    this.tortoise.root.rotation.y = this.yaw;
    if (!this.riding) return;
    this.root.updateMatrixWorld();
    this.seat.getWorldPosition(this.seatWorld);
    this.player?.setRidePose(this.seatWorld.x, this.seatWorld.y, this.seatWorld.z, this.yaw);
  }

  /** Back at the parking spot: the tortoise parks, the disc comes back, she gets off at the stand. */
  private arrive(): void {
    const rider = this.riding;
    this.riding = false;
    this.walking = false;
    this.along = 0;
    this.park();
    const [front, back] = parkedCapsule();
    this.bay = this.collision.addWall(
      REPTILE_HOUSE_ORIGIN_X + front.x,
      REPTILE_HOUSE_ORIGIN_Z + front.z,
      REPTILE_HOUSE_ORIGIN_X + back.x,
      REPTILE_HOUSE_ORIGIN_Z + back.z,
      TORTOISE_RIDE_PARK_HALF_WIDTH,
    );
    this.parkedSolid.handle = this.bay;
    const player = this.player;
    if (!player || !rider) return;
    const { x, z } = resolveDismount(
      this.collision,
      REPTILE_HOUSE_ORIGIN_X + TORTOISE_RIDE_STAND.x,
      REPTILE_HOUSE_ORIGIN_Z + TORTOISE_RIDE_STAND.z,
      PLAYER_RADIUS,
    );
    player.setRidePose(x, REPTILE_HOUSE_FLOOR_Y, z, (TORTOISE_RIDE_STAND.facing * Math.PI) / 180);
    player.endRide();
  }

  private park(): void {
    this.yaw = (TORTOISE_RIDE_PARK.facing * Math.PI) / 180;
    this.tortoise.root.position.set(TORTOISE_RIDE_PARK.x, 0, TORTOISE_RIDE_PARK.z);
    this.tortoise.root.rotation.y = this.yaw;
  }
}
