import { Box3, CatmullRomCurve3, Group, Vector3 } from 'three';
import type { CollisionWorld } from '../Collision';
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
  TORTOISE_RIDE_PARK_RADIUS,
  TORTOISE_RIDE_SCALE,
  TORTOISE_RIDE_SPEED,
  TORTOISE_RIDE_STAND,
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
 * **Solid when parked, scenery when walking.** Parked, the tortoise is a
 * drawn thing a child can lean on, so it is one `ReptileProps.disc` at the
 * parking spot (keep-outs asserted like every other solid in the hall).
 * Walking, she is on it and nothing else is near it; the disc comes out at
 * boarding and goes back at arrival — two collision edits per lap, not one
 * per frame, and the parking spot is never an invisible disc with no
 * tortoise on it. The lap itself (`TORTOISE_RIDE_LOOP`) runs the ring and
 * the south opening, both wider than the tortoise by a stride; riding
 * bypasses collision, so a bed's kerb could not stop it anyway, which is why
 * the loop is proved against the layout's own path widths rather than trusted.
 */
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
  private riding = false;
  private along = 0;
  private phase = 0;
  private yaw = (TORTOISE_RIDE_PARK.facing * Math.PI) / 180;
  /** The parked disc's handle in the collision world, or `null` while it is out walking. */
  private parked: number | null = null;
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
    this.seat.position.set(0, shell.max.y - 0.08, -0.15);
    this.tortoise.root.add(this.seat);

    this.loop = new CatmullRomCurve3(
      TORTOISE_RIDE_LOOP.map((point) => new Vector3(point.x, 0, point.z)),
      true,
      'centripetal',
    );
    this.length = this.loop.getLength();

    this.props.disc('the tortoise ride, parked', TORTOISE_RIDE_PARK.x, TORTOISE_RIDE_PARK.z, TORTOISE_RIDE_PARK_RADIUS, 'wall');
    this.parkedSolid = this.props.solids[this.props.solids.length - 1]!;
    this.parked = this.parkedSolid.handle as number;
    this.park();
  }

  attachPlayer(player: Player): void {
    this.player = player;
  }

  get playerRiding(): boolean {
    return this.riding;
  }

  /** "Hop on!" — from the chip, or from `/tortoise-ride` once she is in the hall. */
  requestBoard(): boolean {
    const player = this.player;
    if (!player || player.riding || this.riding) return false;
    this.controls.cancelWalk();
    this.riding = true;
    this.along = 0;
    if (this.parked !== null) {
      this.collision.removeCircle(this.parked);
      this.parked = null;
    }
    player.beginRide();
    this.place(0);
    return true;
  }

  zones(): InteractZone[] {
    if (this.riding) return [];
    return [
      pressZone(
        {
          id: 'reptile:tortoiseRide',
          label: 'Tortoise ride',
          x: REPTILE_HOUSE_ORIGIN_X + TORTOISE_RIDE_PARK.x,
          y: 1,
          z: REPTILE_HOUSE_ORIGIN_Z + TORTOISE_RIDE_PARK.z,
          pickRadius: TORTOISE_RIDE_PARK_RADIUS + 1.4,
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

  update(dt: number, elapsed: number): void {
    if (this.riding) {
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
    this.root.updateMatrixWorld();
    this.seat.getWorldPosition(this.seatWorld);
    this.player?.setRidePose(this.seatWorld.x, this.seatWorld.y, this.seatWorld.z, this.yaw);
  }

  /** Back at the parking spot: the tortoise parks, the disc comes back, she gets off at the stand. */
  private arrive(): void {
    this.riding = false;
    this.along = 0;
    this.park();
    this.parked = this.collision.addCircle(
      REPTILE_HOUSE_ORIGIN_X + TORTOISE_RIDE_PARK.x,
      REPTILE_HOUSE_ORIGIN_Z + TORTOISE_RIDE_PARK.z,
      TORTOISE_RIDE_PARK_RADIUS,
    );
    this.parkedSolid.handle = this.parked;
    const player = this.player;
    if (!player) return;
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
