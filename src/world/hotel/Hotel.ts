import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { circleBoundary, GARDEN_PLAY_BOUNDARY } from '../boundary';
import { HOTEL_PLAY_RADIUS } from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { ART } from '../../art/style/artPalette';
import { Rng } from '../../core/mathUtils';
import { mosaicTexture } from '../../core/textures';
import type { FrameContext, GameSystem } from '../../core/types';
import type { CollisionWorld } from '../Collision';
import type { AnchorPlots } from '../AnchorPlots';
import type { Player } from '../../entities/Player';
import type { InteriorControls } from '../building';
import type { WalkSurfaces, MovingPlatform } from '../building/surfaces';
import type { LiftPanelSource } from '../building/liftRide';
import { interiorMaterial, softMaterial } from '../building/parts';
import { toonMaterial, solid, decal, inkTint } from '../../art/style/materials';
import {
  BED_MATTRESS_TOP,
  createBreakfastBowl,
  createBreakfastChair,
  createBreakfastTable,
  createDiscoBall,
  createHotelBed,
  createHotelTower,
  createReceptionDesk,
  createYoursDoor,
  type BreakfastKind,
} from '../../art/models/hotelAssets';
import { createRipikaStatue, type RipikaStatueHandle } from '../../art/models/ripikaStatue';
import { createPet, PET_KINDS } from '../../art/models/pets';
import { createKeeper, type KeeperHandle } from '../../art/models/keeper';
import {
  bedsideTable,
  buffetCounter,
  BUFFET_TOP,
  cloud,
  crystalCluster,
  crystalColumn,
  crystalPlanter,
  flatStar,
  floorChevron,
  picture,
  rainbowRing,
  rainbowRug,
  roundRug,
  rug,
  sconce,
  sofa,
  sunburst,
} from './dressing';
import { HotelGuests } from './HotelGuests';
import { placedEntry } from '../parkLayout';
import { saveFlags } from '../../state/flags';
import { pressAction, type InteractZone } from '../interact';
import {
  BREAKFAST,
  CORRIDOR,
  DOOR_HALF,
  LIFT_ALCOVE_DEPTH,
  LOBBY,
  ROOMS,
  roomFor,
  SUITE,
  type HotelRoom,
} from './layout';
import { HotelLift } from './HotelLift';
import { spaceAt, SPACE_GARDEN } from '../spaces';

/** Seconds after a change of space before another may trigger. */
const SPACE_COOLDOWN = 0.9;

/** How long a nap on a suite bed lasts, in seconds. */
const NAP_SECONDS = 2.6;

/** How long the lobby celebrates a check-in. Long enough to see, short enough to want again. */
const CHEER_SECONDS = 2.4;

/** The three breakfasts, exactly as Eleri listed them. */
const BREAKFASTS: readonly { kind: BreakfastKind; label: string; glyph: string }[] = [
  { kind: 'cheerios', label: 'Heart cheerios', glyph: '🥣' },
  { kind: 'shreddies', label: 'Shreddies', glyph: '🟫' },
  { kind: 'yoghurt', label: 'Yoghurt + honey', glyph: '🍯' },
];

/** A static walkable plate — a room floor, a mattress top. */
class Plate implements MovingPlatform {
  constructor(
    readonly surfaceY: number,
    private readonly minX: number,
    private readonly maxX: number,
    private readonly minZ: number,
    private readonly maxZ: number,
  ) {}

  covers(x: number, z: number): boolean {
    return x >= this.minX && x <= this.maxX && z >= this.minZ && z <= this.maxZ;
  }
}

interface Chair {
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly room: HotelRoom;
  readonly id: string;
}

interface Bed {
  readonly x: number;
  readonly z: number;
  readonly id: string;
}

/**
 * Somewhere in a room a strolling guest must not stand, in that room's own
 * local metres. Built as the furniture goes down — see `Hotel.blockLocal`.
 */
export interface RoomKeepOut {
  readonly room: HotelRoom;
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** What `Hotel.hangOnWalls` puts on the two walls the camera can see. */
interface WallPlan {
  /** Sconce x positions on the north (−Z) wall. */
  readonly north?: readonly number[];
  /** Sconce z positions on the west (−X) wall. */
  readonly west?: readonly number[];
  readonly pictures?: readonly {
    readonly wall: 'north' | 'west';
    /** x on the north wall, z on the west wall. */
    readonly along: number;
    readonly width: number;
    readonly height: number;
    readonly seed: number;
  }[];
}

/**
 * **The Land Hotel** — Eleri's hotel (issue #236), close to the castle.
 *
 * Two places, like the castle: a crystal tower stands in the park (generator-
 * placed, `near: 'building'` in the manifest), and walking through its door
 * takes you somewhere else entirely. Unlike the castle — and per Jim's
 * ruling — every room is **its own disjoint space** at its own far origin
 * (`hotel/layout.ts`): lobby, breakfast room, floor-50 corridor, and the
 * suite behind the door that says "yours". The lift between them is the
 * first *portal* lift (Decision 3's shape, `HotelLift`), and the doors are
 * portals too. Nothing pretends the inside fits the outside.
 *
 * All the hotel's new art is Blender-authored (`art/blend/hotel_build.py`,
 * Jim's ruling; the Opus artist's handoff is HANDOFF-hotel-art.md). The
 * statues are deliberately NOT new art: the lobby's giant RiPika is the
 * fountain's own `createRipikaStatue` and the corridor pets are the live
 * `createPet` models — a second RiPika is a statue that goes stale
 * (`ripikaStatue.ts`'s own lesson).
 */
export class Hotel implements GameSystem {
  readonly name = 'hotel';

  /** Everything in the hotel's own spaces. Invisible until entered. */
  readonly hotelRoot = new Group();
  /** The tower in the park. */
  readonly gardenRoot = new Group();

  private readonly lift: HotelLift;
  private player: Player | null = null;
  private inside = false;
  private changingSpace = false;
  private spaceCooldown = 0;

  private readonly statue: RipikaStatueHandle;
  private readonly discoBalls: { spin: Group }[] = [];
  private readonly keepers: KeeperHandle[] = [];
  private readonly chairs: Chair[] = [];
  private readonly beds: Bed[] = [];
  private readonly keepOuts: RoomKeepOut[] = [];
  private readonly guests: HotelGuests;
  private seatedAt: string | null = null;
  /** Seconds of check-in celebration left to run. See {@link checkIn}. */
  private cheer = 0;
  /** The rainbow ring's six bands, which flash when you are given your key. */
  private readonly cheerLights: MeshToonMaterial[] = [];
  /** The star over the "yours" door — it lights up once the suite is yours. */
  private yoursStar: Mesh | null = null;
  private napping = 0;
  private nappingAt: Bed | null = null;

  /** Facade frame: the tower's yaw and centre, for the door trigger. */
  private readonly facadeYaw: number;
  private readonly facadeX: number;
  private readonly facadeZ: number;

  constructor(
    private readonly collision: CollisionWorld,
    anchorPlots: AnchorPlots,
    private readonly controls: InteriorControls,
    private readonly surfaces: WalkSurfaces,
  ) {
    // ------------------------------------------------------------ the tower
    const plot = placedEntry('hotel');
    this.facadeX = plot.x;
    this.facadeZ = plot.z;
    // The door faces the doormat the solver placed — the tower is a cluster
    // of crystals, so any yaw is as natural as any other.
    this.facadeYaw = Math.atan2(plot.entranceX - plot.x, plot.entranceZ - plot.z);

    const tower = createHotelTower();
    tower.root.rotation.y = this.facadeYaw;
    paintSign(tower.signboard);
    this.gardenRoot.add(tower.root);
    this.gardenRoot.name = 'the-land-hotel-outside';

    const group = anchorPlots.getGroup('hotel');
    this.gardenRoot.position.set(plot.x - group.position.x, -group.position.y, plot.z - group.position.z);
    group.add(this.gardenRoot);
    anchorPlots.setPlaceholderVisible('hotel', false);

    // Collision: an octagon of walls around the crystal cluster, with the
    // doorway left open and a short lobby wall behind it — the same "a metre
    // of hallway, then somewhere else entirely" trick as the castle facade.
    registerTowerCollision(collision, plot.x, plot.z, this.facadeYaw);

    // ------------------------------------------------------------ the rooms
    this.hotelRoot.name = 'the-land-hotel-inside';
    this.hotelRoot.visible = false;

    for (const room of ROOMS) this.buildRoomShell(room);
    this.statue = this.dressLobby();
    this.dressBreakfast();
    this.dressCorridor();
    this.dressSuite();

    // ----------------------------------------------------------- the guests
    // Built last, on purpose: it takes the keep-out list every `dress*` method
    // above filled in as it put its furniture down, so nobody strolls through
    // a sofa. Building it earlier would hand it an empty list, and the failure
    // would be silent — which is why it is here rather than beside them.
    this.guests = new HotelGuests((room) => this.roomShell(room), this.keepOuts);

    // ------------------------------------------------------------- the lift
    this.lift = new HotelLift({
      currentRoom: () => this.currentRoom(),
      atLiftDoors: (player) => this.atLiftDoors(player),
      travelTo: (room) => this.travelTo(room),
      hasKey: () => saveFlags.hasHotelKey(),
      cancelWalk: () => this.controls.cancelWalk(),
      player: () => this.player,
    });
  }

  get liftPanel(): LiftPanelSource {
    return this.lift;
  }

  get playerIsInside(): boolean {
    return this.inside;
  }

  /** What the HUD's floor pill shows — Eleri: "It shows which floor you are on". */
  floorLabel(): string | null {
    if (!this.inside) return null;
    return this.currentRoom()?.floorLabel ?? null;
  }

  attachPlayer(player: Player): void {
    this.player = player;
  }

  /**
   * Adopt a player RESTORED into a hotel room (a reload mid-visit). Being in
   * a room is not just a coordinate — the room must be visible, the play
   * bounds re-bound, `inside` true — and none of that has happened at
   * construction. Called once from `Game` after the spawn resolves; a
   * no-op for a garden spawn. This is what stops the QA-observed limbo of
   * "save says hotel.lobby, player stands at the plaza".
   */
  adoptRestoredPlayer(): void {
    const room = this.currentRoom();
    if (!room) return;
    this.inside = true;
    this.hotelRoot.visible = true;
    this.boundTo(room);
    this.spaceCooldown = SPACE_COOLDOWN;
  }

  /**
   * The `/hotel` deep link: straight into the lobby from wherever she is.
   * Safe from anywhere, the way the slide's own deep link is: the change
   * happens behind a closed iris and teleports, so it does not care where
   * she was standing when she asked.
   */
  requestEnterLobby(): boolean {
    const player = this.player;
    if (!player || player.riding || this.changingSpace || this.inside) return false;
    this.changeSpace(() => this.enterLobby());
    return true;
  }

  // ---------------------------------------------------------------- zones

  interactZones(): InteractZone[] {
    if (!this.inside) return [];
    const zones: InteractZone[] = [];
    const room = this.currentRoom();
    if (!room) return zones;

    if (room === LOBBY) {
      const x = LOBBY.originX + 5;
      const z = LOBBY.originZ - 6.2;
      zones.push({
        id: 'hotel-reception',
        label: 'reception',
        x,
        y: 1,
        z,
        pickRadius: 2.6,
        standX: x,
        standZ: z + 2.2,
        verb: 'Check in',
        sign: {
          title: 'Reception',
          note: saveFlags.hasHotelKey()
            ? 'welcome back! your room is floor 50'
            : 'check in and get your key!',
          glyph: '🔑',
          accent: PALETTE.markerLilac,
        },
        actions: () =>
          saveFlags.hasHotelKey()
            ? pressAction('Hello!', () => this.wave())
            : pressAction('Check in!', () => this.checkIn(), '🔑'),
      });
    }

    for (const chair of this.chairs) {
      if (chair.room !== room) continue;
      zones.push({
        id: `hotel-chair-${chair.id}`,
        label: 'breakfast chair',
        x: chair.x,
        y: 1,
        z: chair.z,
        pickRadius: 1.6,
        standX: chair.x - Math.sin(chair.facing) * 0.9,
        standZ: chair.z - Math.cos(chair.facing) * 0.9,
        standRadius: 2.2,
        // Sitting is a ride as far as the engine cares, and a zone is not
        // selectable while riding unless it says so — the train's own 'Get
        // off' precedent. Without this, sitting down eats every chip
        // including 'Hop down' and a child is stuck at the table forever.
        selectableWhileRiding: true,
        verb: 'Sit',
        sign: { title: 'Breakfast', note: 'sit down and choose!', glyph: '🥄' },
        actions: () =>
          this.seatedAt === chair.id
            ? [
                ...BREAKFASTS.map((food) => ({
                  id: `eat-${food.kind}`,
                  label: food.label,
                  glyph: food.glyph,
                  run: () => this.eat(),
                })),
                { id: 'hop-down', label: 'Hop down', run: () => this.standUp() },
              ]
            : pressAction('Sit down!', () => this.sitAt(chair), '🪑'),
      });
    }

    for (const bed of this.beds) {
      if (room !== SUITE) continue;
      zones.push({
        id: `hotel-bed-${bed.id}`,
        label: 'your bed',
        x: bed.x,
        y: 1,
        z: bed.z,
        pickRadius: 1.8,
        standX: bed.x,
        standZ: bed.z + 1.5,
        standRadius: 2.4,
        verb: 'Sleep',
        sign: { title: 'Your bed', note: 'sleep, or go jumpy jumpy!', glyph: '🛏️' },
        actions: () =>
          this.napping > 0 ? [] : pressAction('Sleep!', () => this.nap(bed), '💤'),
      });
    }

    return zones;
  }

  // ---------------------------------------------------------------- frame

  update(context: FrameContext): void {
    const { dt, elapsed } = context;
    if (this.spaceCooldown > 0) this.spaceCooldown -= dt;

    this.lift.update(dt);
    this.statue.update(dt, elapsed);
    this.guests.update(dt, elapsed);
    for (const ball of this.discoBalls) ball.spin.rotation.y = elapsed * 0.5;
    for (const keeper of this.keepers) keeper.setWalkPhase(elapsed * 0.4, 0.5);

    // The check-in flash. Driven off `elapsed` rather than off the countdown
    // so the pulse rate is the same every time, and settled back to zero on
    // the frame it runs out rather than left wherever the sine happened to be.
    if (this.cheer > 0) {
      this.cheer -= dt;
      const pulse = this.cheer > 0 ? 0.25 + Math.abs(Math.sin(elapsed * 8.5)) * 0.95 : 0;
      for (const band of this.cheerLights) band.emissiveIntensity = pulse;
    }

    const player = this.player;
    if (!player) return;

    if (this.napping > 0 && this.nappingAt) {
      this.napping -= dt;
      if (this.napping <= 0) {
        this.napping = 0;
        this.nappingAt = null;
        player.group.rotation.order = 'XYZ';
        player.group.rotation.x = 0;
        player.endRide();
        player.model.setExpression('happy');
      }
      return;
    }

    if (!this.changingSpace && !player.riding) this.checkDoorways(player);
  }

  // ------------------------------------------------------ changing space

  private checkDoorways(player: Player): void {
    if (this.spaceCooldown > 0) return;

    if (!this.inside) {
      // The tower door, in the facade's own frame: `forward` is metres from
      // the tower's centre along the doormat direction, `side` across it.
      const dx = player.position.x - this.facadeX;
      const dz = player.position.z - this.facadeZ;
      const forward = dx * Math.sin(this.facadeYaw) + dz * Math.cos(this.facadeYaw);
      const side = dx * Math.cos(this.facadeYaw) - dz * Math.sin(this.facadeYaw);
      if (Math.abs(side) > DOOR_HALF + 0.4) return;
      if (forward > 6.6 || forward < 4.4) return;
      this.changeSpace(() => this.enterLobby());
      return;
    }

    const room = this.currentRoom();
    if (!room) return;
    const localX = player.position.x - room.originX;
    const localZ = player.position.z - room.originZ;

    if (room === LOBBY && localZ > LOBBY.halfZ - 0.6 && Math.abs(localX) < DOOR_HALF + 0.4) {
      this.changeSpace(() => this.leaveToPark());
      return;
    }
    if (room === CORRIDOR && localX > CORRIDOR.halfX - 0.6 && Math.abs(localZ) < 1.5) {
      this.changeSpace(() => this.stepThroughDoor(SUITE, -SUITE.halfX + 1.6, 0, Math.PI / 2));
      return;
    }
    if (room === SUITE && localX < -SUITE.halfX + 0.6 && Math.abs(localZ) < 1.5) {
      this.changeSpace(() => this.stepThroughDoor(CORRIDOR, CORRIDOR.halfX - 1.6, 0, -Math.PI / 2));
    }
  }

  private changeSpace(midpoint: () => void): void {
    this.changingSpace = true;
    this.controls.cancelWalk();
    this.controls.iris(() => {
      midpoint();
      this.controls.snapCamera();
      this.changingSpace = false;
      this.spaceCooldown = SPACE_COOLDOWN;
    });
  }

  private enterLobby(): void {
    const player = this.player;
    if (!player) return;
    this.inside = true;
    this.hotelRoot.visible = true;
    this.boundTo(LOBBY);
    // Just inside the front door, facing the statue.
    player.teleportTo(LOBBY.originX, 0, LOBBY.originZ + LOBBY.halfZ - 2.2, Math.PI);
    if (!saveFlags.hasHotelKey()) this.greet();
  }

  private leaveToPark(): void {
    const player = this.player;
    if (!player) return;
    this.inside = false;
    this.hotelRoot.visible = false;
    this.collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
    const plot = placedEntry('hotel');
    const x = plot.entranceX;
    const z = plot.entranceZ;
    player.teleportTo(x, this.surfaces.sample(x, z, 3), z, this.facadeYaw);
  }

  private stepThroughDoor(room: HotelRoom, localX: number, localZ: number, facing: number): void {
    const player = this.player;
    if (!player) return;
    this.boundTo(room);
    player.teleportTo(room.originX + localX, 0, room.originZ + localZ, facing);
  }

  /** The lift's portal hop — same shape as a door, wrapped in its own iris. */
  private travelTo(room: HotelRoom): void {
    this.controls.iris(() => {
      const player = this.player;
      if (player) {
        // Behind the closed iris, like every other space change — posing
        // her before it closed gave a visible cross-space camera whip
        // (reviewer finding 2 on PR #247). The lift keeps the ride pose;
        // only the world jumps. Land in the new room's alcove.
        const x = room.originX - room.halfX - 1.2;
        const z = room.originZ + (room.liftZ ?? 0);
        player.setRidePose(x, 0, z, Math.PI / 2);
      }
      this.boundTo(room);
      this.controls.snapCamera();
      this.spaceCooldown = SPACE_COOLDOWN;
    });
  }

  private boundTo(room: HotelRoom): void {
    this.collision.setPlayBounds(circleBoundary(HOTEL_PLAY_RADIUS, room.originX, room.originZ));
  }

  // ------------------------------------------------------------- actions

  /**
   * Reception hands over the key — the one moment in the hotel a child has
   * *achieved* something, and until QA's note on 6 August the only sign of it
   * was a line of text changing on a sign she had already stopped reading.
   *
   * So three things now happen, all of them things she can see from where she
   * is standing:
   *
   *  - the receptionist beams (and so does she);
   *  - the rainbow inlaid round the statue **flashes**, right in the middle of
   *    the lobby, for {@link CHEER_SECONDS};
   *  - the star over the "yours" door, fifty floors up, comes on for good —
   *    which is the payoff she finds when she gets there.
   *
   * No new asset and no new sound: the ring and the star already existed, and
   * the star's own doc comment in `hotelAssets.ts` asks for exactly this
   * ("brighten its emissive when the suite unlocks").
   */
  private checkIn(): void {
    saveFlags.giveHotelKey();
    this.player?.model.setExpression('happy');
    for (const keeper of this.keepers) keeper.setExpression('happy');
    this.cheer = CHEER_SECONDS;
    this.lightYoursStar(true);
  }

  /** The star over the suite door: dim while the room is nobody's, lit once it is hers. */
  private lightYoursStar(lit: boolean): void {
    const material = this.yoursStar?.material;
    if (material instanceof MeshToonMaterial) material.emissiveIntensity = lit ? 1.15 : 0.3;
  }

  private greet(): void {
    for (const keeper of this.keepers) keeper.setExpression('happy');
  }

  private wave(): void {
    this.player?.model.setExpression('happy');
  }

  private sitAt(chair: Chair): void {
    const player = this.player;
    if (!player || player.riding) return;
    player.beginRide();
    player.setRidePose(chair.x, 0.42, chair.z, chair.facing);
    this.seatedAt = chair.id;
  }

  private standUp(): void {
    const player = this.player;
    if (!player) return;
    this.seatedAt = null;
    player.endRide();
  }

  private eat(): void {
    this.player?.model.setExpression('happy');
  }

  private nap(bed: Bed): void {
    const player = this.player;
    if (!player || player.riding) return;
    player.beginRide();
    player.ridePosture = 'reclined';
    player.group.rotation.order = 'YXZ';
    player.setRidePose(bed.x, BED_MATTRESS_TOP + 0.16, bed.z, Math.PI, -Math.PI / 2);
    this.napping = NAP_SECONDS;
    this.nappingAt = bed;
    player.model.setExpression('blink');
  }

  // ------------------------------------------------------------- queries

  private currentRoom(): HotelRoom | null {
    const player = this.player;
    if (!player) return null;
    const space = spaceAt(player.position.x, player.position.z);
    if (space === SPACE_GARDEN) return null;
    return roomFor(space);
  }

  private atLiftDoors(player: Player): boolean {
    const room = this.currentRoom();
    if (!room || room.liftZ === null) return false;
    const localX = player.position.x - room.originX;
    const localZ = player.position.z - room.originZ - room.liftZ;
    return localX < -room.halfX + 3.4 && Math.abs(localZ) < 2.6;
  }

  // ------------------------------------------------------------- builders

  private buildRoomShell(room: HotelRoom): void {
    const shell = new Group();
    shell.name = `hotel:${room.space}`;
    shell.position.set(room.originX, 0, room.originZ);
    this.hotelRoot.add(shell);

    // The floor plate, in this floor's own colour, with a soft emissive lift
    // so an open-topped room at night is cosy rather than cave-dark.
    const floor = solid(
      new Mesh(
        new BoxGeometry(room.halfX * 2 + 1.2, 0.5, room.halfZ * 2 + 1.2),
        interiorMaterial(room.theme.floor),
      ),
    );
    floor.position.y = -0.25;
    shell.add(floor);
    this.surfaces.addPlatform(
      new Plate(
        0,
        room.originX - room.halfX - 0.6,
        room.originX + room.halfX + 0.6,
        room.originZ - room.halfZ - 0.6,
        room.originZ + room.halfZ + 0.6,
      ),
    );

    // Walls per side, minus the door and lift gaps, both visual and solid.
    const sides = [
      { side: 'north' as const, x1: -room.halfX, z1: -room.halfZ, x2: room.halfX, z2: -room.halfZ },
      { side: 'south' as const, x1: -room.halfX, z1: room.halfZ, x2: room.halfX, z2: room.halfZ },
      { side: 'west' as const, x1: -room.halfX, z1: -room.halfZ, x2: -room.halfX, z2: room.halfZ },
      { side: 'east' as const, x1: room.halfX, z1: -room.halfZ, x2: room.halfX, z2: room.halfZ },
    ];
    const wallMaterial = interiorMaterial(room.theme.wall);
    for (const { side, x1, z1, x2, z2 } of sides) {
      const gap = room.gaps[side];
      const along = side === 'north' || side === 'south' ? 'x' : 'z';
      const from = along === 'x' ? x1 : z1;
      const to = along === 'x' ? x2 : z2;
      const spans: [number, number][] = gap
        ? [
            [from, gap[0]],
            [gap[1], to],
          ]
        : [[from, to]];
      for (const [a, b] of spans) {
        if (b - a < 0.05) continue;
        const length = b - a;
        const mid = (a + b) / 2;
        const wall = solid(
          new Mesh(
            along === 'x'
              ? new BoxGeometry(length, room.wallHeight, 0.5)
              : new BoxGeometry(0.5, room.wallHeight, length),
            wallMaterial,
          ),
        );
        wall.position.set(
          along === 'x' ? mid : x1,
          room.wallHeight / 2,
          along === 'x' ? z1 : mid,
        );
        shell.add(wall);
        const wx1 = room.originX + (along === 'x' ? a : x1);
        const wz1 = room.originZ + (along === 'x' ? z1 : a);
        const wx2 = room.originX + (along === 'x' ? b : x1);
        const wz2 = room.originZ + (along === 'x' ? z1 : b);
        this.collision.addWall(wx1, wz1, wx2, wz2, 0.3);
      }
    }

    // The lift alcove: three walls poking out of the west gap, so the "car"
    // is a little crystal room of its own.
    if (room.liftZ !== null) {
      const ax = -room.halfX;
      const depth = LIFT_ALCOVE_DEPTH;
      for (const [x1, z1, x2, z2] of [
        [ax - depth, room.liftZ - 1.7, ax, room.liftZ - 1.7],
        [ax - depth, room.liftZ + 1.7, ax, room.liftZ + 1.7],
        [ax - depth, room.liftZ - 1.7, ax - depth, room.liftZ + 1.7],
      ] as const) {
        this.collision.addWall(
          room.originX + x1,
          room.originZ + z1,
          room.originX + x2,
          room.originZ + z2,
          0.25,
        );
        const wall = solid(
          new Mesh(
            x1 === x2
              ? new BoxGeometry(0.4, room.wallHeight, Math.abs(z2 - z1))
              : new BoxGeometry(Math.abs(x2 - x1), room.wallHeight, 0.4),
            interiorMaterial(room.theme.trim),
          ),
        );
        wall.position.set((x1 + x2) / 2, room.wallHeight / 2, (z1 + z2) / 2);
        shell.add(wall);
      }
      this.surfaces.addPlatform(
        new Plate(
          0,
          room.originX - room.halfX - depth,
          room.originX - room.halfX,
          room.originZ + room.liftZ - 1.7,
          room.originZ + room.liftZ + 1.7,
        ),
      );
    }
  }

  private dressLobby(): RipikaStatueHandle {
    const shell = this.roomShell(LOBBY);

    // The mosaic floor — Jim's first note after playing it, and the single
    // biggest reason the lobby stops reading as a big pink rectangle. See
    // `core/textures.ts`'s `mosaicTexture` for why a tiling map is the right
    // answer here and a material colour is not.
    this.layMosaic(shell, LOBBY);

    // The giant RiPika, spinning gently exactly like the fountain's, with the
    // disco ball above — Eleri: "a disco ball above the ripika statue" — in
    // the middle of a rainbow inlaid in the floor. Inner radius 2.0 clears the
    // plinth's 1.15 m footing with room for a child to walk round it.
    const statue = createRipikaStatue();
    statue.root.position.set(0, 0, -1);
    shell.add(statue.root);
    this.hangDiscoBall(shell, 0, 9.6, -1);
    const ring = rainbowRing(2, 0.34);
    ring.position.set(0, 0, -1);
    shell.add(ring);
    // Kept, because checking in flashes them — see `checkIn`. The ring is six
    // meshes with six materials and this is the only handle on them; asking
    // the scene graph for "the rainbow" every frame would be a string lookup
    // in the render loop for something that never moves.
    for (const band of ring.children) {
      if (band instanceof Mesh && band.material instanceof MeshToonMaterial) {
        // Armed but off: `emissiveIntensity` defaults to 1, so setting the
        // emissive colour without also zeroing the intensity would leave the
        // rainbow permanently self-lit — the flash would be the *normal* state
        // and checking in would make it stop.
        band.material.emissive.setHex(band.material.color.getHex());
        band.material.emissiveIntensity = 0;
        this.cheerLights.push(band.material);
      }
    }

    const desk = createReceptionDesk();
    desk.root.position.set(5, 0, -7.2);
    shell.add(desk.root);
    const reception = createKeeper({ colour: PALETTE.flowerRed, hair: PALETTE.markerPink });
    reception.root.position.set(5, 0, -8.6);
    shell.add(reception.root);
    this.keepers.push(reception);

    // The breakfast corner, ground floor — "breakfast ... at the ground floor".
    // Two tables only: the *room* full of them is Floor 1 now, and this is the
    // café nook Eleri asked for downstairs as well.
    this.placeBreakfastTable(shell, LOBBY, -8, 4.5, 'lobby-a');
    this.placeBreakfastTable(shell, LOBBY, -8, -2.5, 'lobby-b', 0.3);

    // A little lounge in the east half — the one part of the lobby with no
    // job, and therefore the part that read as empty floor. Both sofas face
    // +Z so you see who is sitting on them.
    const lounge = roundRug(3.6, LOBBY.theme.accent, PALETTE.stonePinkLight);
    lounge.position.set(7.4, 0, 2.6);
    shell.add(lounge);
    for (const [x, z, colour] of [
      [5.8, 2.4, PALETTE.markerSky],
      [9.0, 2.4, PALETTE.markerMint],
    ] as const) {
      const seat = sofa(2.6, colour, PALETTE.blossomWhite);
      seat.position.set(x, 0, z);
      shell.add(seat);
    }

    // Crystal columns — the lobby's theme is "a grand crystal welcome", and a
    // column is the only prop in the hotel taller than a grown-up. A pair
    // frames reception; a pair marks the west side, clear of the arrow's run
    // to the lift.
    this.placeProps(shell, LOBBY, [
      { prop: () => crystalColumn(3, LOBBY.theme.floor), x: 2.2, z: -7.4, radius: 1.3 },
      { prop: () => crystalColumn(3, LOBBY.theme.floor), x: 8.4, z: -7.4, radius: 1.3 },
      { prop: () => crystalColumn(3, LOBBY.theme.floor), x: -9.2, z: -4.6, radius: 1.3 },
      { prop: () => crystalColumn(3, LOBBY.theme.floor), x: -10.4, z: 6.6, radius: 1.3 },
      { prop: () => crystalCluster(0x10b1), x: -11.4, z: -8.3 },
      { prop: () => crystalCluster(0x10b2), x: 11.4, z: -8.3 },
      { prop: () => crystalPlanter(0x10b3), x: 3.4, z: 2.6 },
      { prop: () => crystalPlanter(0x10b4), x: -6.2, z: -6.6 },
    ]);

    // The statue, the desk and the spot a child stands on to check in — the
    // three things in the lobby a guest must never be found standing in.
    this.blockLocal(LOBBY, 0, -1, 2.4);
    this.blockLocal(LOBBY, 5, -7.9, 2.6);
    this.blockLocal(LOBBY, 5, -4, 2);
    this.blockLocal(LOBBY, 5.8, 2.4, 2);
    this.blockLocal(LOBBY, 9, 2.4, 2);
    this.hangOnWalls(shell, LOBBY, {
      north: [-9.5, -4.5, 6.2],
      west: [-6, 2],
      pictures: [
        { wall: 'north', along: -6.5, width: 1.7, height: 1.25, seed: 0x10c1 },
        { wall: 'north', along: 9.6, width: 1.7, height: 1.25, seed: 0x10c2 },
        { wall: 'west', along: 4, width: 1.7, height: 1.25, seed: 0x10c3 },
      ],
    });

    // A painted arrow on the floor pointing at the lift — "an arrow showing
    // the way to your floor, on the floors of the hotel".
    this.paintArrow(shell, 2.5, 5.5, -LOBBY.halfX + 2.5, 0);

    return statue;
  }

  /**
   * Breakfast, **Floor 1** — the big room.
   *
   * Jim, having played it: *"Breakfast should be on the 1st floor … and should
   * be a large room with lots of tables and a buffet with breakfast foods."*
   * So: seven tables, none of them square-on to another, and a twelve-metre
   * buffet along the far wall with a keeper serving behind it.
   *
   * **The tables are laid out by hand, not scattered.** `dressDeck`'s seeded
   * rejection sampler is right for the castle, whose plan moves under it; this
   * room's plan is these fourteen numbers, and a hand layout is the one that
   * can guarantee a clear lane from the lift alcove to the buffet — which is
   * the walk a child actually makes here.
   */
  private dressBreakfast(): void {
    const shell = this.roomShell(BREAKFAST);

    // Seven tables. Each gets its own `spin`, so the room reads as a café that
    // people have been sitting in rather than as a grid — the chairs, the
    // bowls and the sit-down pose all rotate with it, so the mechanics do not
    // notice.
    const tables: readonly (readonly [number, number, string, number])[] = [
      [-7.6, 5.4, 'b1-a', 0.34],
      [-2.4, 6.4, 'b1-b', -0.52],
      [3.4, 5.6, 'b1-c', 0.18],
      [8.8, 4.6, 'b1-d', -0.3],
      [-6.6, 0.4, 'b1-e', 0.62],
      [-2.6, -3, 'b1-f', -0.16],
      [7.4, -0.8, 'b1-g', 0.46],
    ];
    for (const [x, z, id, spin] of tables) {
      this.placeBreakfastTable(shell, BREAKFAST, x, z, id, spin);
    }

    // The buffet, along the north wall — the wall the camera looks straight
    // at (see `hotel/dressing.ts`'s header on which walls are visible), so the
    // food is the thing you see when you walk in.
    const counter = buffetCounter(14);
    counter.position.set(1.5, 0, -7.4);
    shell.add(counter);
    this.layBuffet(shell, 1.5, -7.4, 14);

    const server = createKeeper({ colour: PALETTE.flowerRed, hair: PALETTE.markerPink });
    server.root.position.set(1.5, 0, -8.25);
    shell.add(server.root);
    this.keepers.push(server);

    // A band of glowing crystal panes where Floor 1's windows would be — moved
    // onto the north wall when the room grew, so the lit band is on the wall
    // the camera can see rather than on the one it looks over the top of.
    const band = decal(
      new Mesh(
        new BoxGeometry(BREAKFAST.halfX * 2 - 2, 1.0, 0.15),
        new MeshToonMaterial({
          color: PALETTE.glassTint,
          emissive: PALETTE.glassTint,
          emissiveIntensity: 0.5,
        }),
      ),
    );
    band.position.set(0, 2.3, -BREAKFAST.halfZ + 0.2);
    shell.add(band);

    // The runner from the lift into the room, and the corners.
    const runner = rug(5, 3, BREAKFAST.theme.trim, PALETTE.blossomWhite);
    runner.position.set(-9.2, 0, 0);
    shell.add(runner);

    // The sun on the floor — Floor 1's theme in one shape, in the middle of
    // the room, which is the first thing the lift doors show you.
    const sun = sunburst(3.2);
    sun.position.set(1, 0, 1.6);
    shell.add(sun);

    this.placeProps(shell, BREAKFAST, [
      { prop: () => crystalCluster(0x20b1), x: -10.6, z: -7.4 },
      { prop: () => crystalCluster(0x20b2), x: 11, z: -7.4 },
      { prop: () => crystalPlanter(0x20b3), x: -10.8, z: 6.4 },
      { prop: () => crystalPlanter(0x20b4), x: 10.6, z: 1 },
    ]);
    this.hangOnWalls(shell, BREAKFAST, {
      // No sconces on the north wall here: the glowing window band already
      // lights it, and anything mounted lower would be behind the buffet.
      north: [],
      west: [-7, 7],
      pictures: [
        { wall: 'west', along: -5, width: 1.6, height: 1.2, seed: 0x20c1 },
        { wall: 'west', along: 5, width: 1.6, height: 1.2, seed: 0x20c2 },
      ],
    });
  }

  /**
   * Floor 50 — **up among the clouds**, which is the only thing about a
   * fiftieth floor a six-year-old cares about.
   *
   * The theme does the heavy lifting (sky-blue walls over a deeper sky floor,
   * `layout.ts`'s `CORRIDOR_THEME`); this adds the two shapes that say *sky*
   * without a word: chunky flat stars on the far wall, at the same angle as
   * the "yours" door's own star, and clouds floating **above the wall line**,
   * which an open-topped room is uniquely able to show off.
   */
  private dressCorridor(): void {
    const shell = this.roomShell(CORRIDOR);
    const sky: readonly number[] = [
      PALETTE.markerSky,
      PALETTE.flowerBlue,
      PALETTE.bubbleSkin,
      PALETTE.buildingRoof,
    ];

    // Life-sized statues of all the cute pets, on little plinths.
    PET_KINDS.forEach((kind, index) => {
      const plinth = solid(
        new Mesh(new CylinderGeometry(0.85, 0.95, 0.4, 16), softMaterial(PALETTE.stonePink)),
      );
      const x = -7.5 + index * 5;
      plinth.position.set(x, 0.2, -CORRIDOR.halfZ + 1.4);
      shell.add(plinth);
      const pet = createPet(kind);
      pet.root.position.set(x, 0.4, -CORRIDOR.halfZ + 1.4);
      shell.add(pet.root);
      this.blockLocal(CORRIDOR, x, -CORRIDOR.halfZ + 1.4, 1.6);
    });

    // The runner from the lift to the door. It is also the plainest possible
    // "this way" — the chevrons painted on top of it point along it.
    const runner = rug(17, 2.6, CORRIDOR.theme.accent, PALETTE.blossomWhite);
    runner.position.set(0, 0, 0.6);
    shell.add(runner);

    // Stars on the far wall, at child's-eye height and above.
    const starRng = new Rng(0x30a5);
    for (const [x, y, r] of [
      [-9.6, 2.35, 0.34],
      [-5, 2.62, 0.42],
      [0, 2.3, 0.3],
      [5, 2.66, 0.4],
      [9.6, 2.4, 0.36],
    ] as const) {
      const star = flatStar(r, CORRIDOR.theme.glow);
      star.position.set(x, y, -CORRIDOR.halfZ + 0.3);
      star.rotation.z = starRng.range(-0.3, 0.3);
      shell.add(star);
    }

    // Clouds, floating over the wall line where the iso camera can see them.
    for (const [x, y, z, scale, seed] of [
      [-6.4, 3.7, -1, 1.25, 0x30c1],
      [0.8, 4.05, 1.6, 1, 0x30c2],
      [6.8, 3.65, -0.4, 1.15, 0x30c3],
    ] as const) {
      const puff = cloud(seed, scale);
      puff.position.set(x, y, z);
      shell.add(puff);
    }

    this.placeProps(shell, CORRIDOR, [
      { prop: () => crystalCluster(0x30b1, 1, sky), x: -9.8, z: 2.6 },
      { prop: () => crystalCluster(0x30b2, 1, sky), x: 9.6, z: 2.6 },
      { prop: () => crystalPlanter(0x30b3, CORRIDOR.theme.trim, sky), x: -4, z: 2.9 },
      { prop: () => crystalPlanter(0x30b4, CORRIDOR.theme.trim, sky), x: 4, z: 2.9 },
    ]);
    this.hangOnWalls(shell, CORRIDOR, { north: [], west: [-2.9, 2.9], pictures: [] });

    // The door that says "yours", at the corridor's end, with an arrow to it.
    const door = createYoursDoor();
    door.root.position.set(CORRIDOR.halfX - 0.3, 0, 0);
    door.root.rotation.y = -Math.PI / 2;
    paintYours(door.plaque);
    shell.add(door.root);
    this.yoursStar = door.star;
    // A returning child's star is already lit — the door has been hers since
    // the moment reception handed the key over.
    this.lightYoursStar(saveFlags.hasHotelKey());
    this.paintArrow(shell, -2, 0, CORRIDOR.halfX - 2, 0);
  }

  private dressSuite(): void {
    const shell = this.roomShell(SUITE);

    // Rainbow bands round the walls — "the room is rainbow coloured, only
    // for the top room" — six stripes, the game's own rainbow.
    //
    // `ART.rainbow`, not six hand-typed hexes: they were six near-copies of
    // it, and ART_DIRECTION §5's rule against a second definition of a colour
    // the game already names is exactly the "two definitions kept in step by
    // hand" trap CLAUDE.md opens with. The rug and the blankets below take the
    // same six, so the suite is one rainbow rather than three.
    ART.rainbow.forEach((colour, index) => {
      const y = 0.6 + index * 0.42;
      for (const [w, d, x, z] of [
        [SUITE.halfX * 2 - 0.3, 0.12, 0, -SUITE.halfZ + 0.4],
        [SUITE.halfX * 2 - 0.3, 0.12, 0, SUITE.halfZ - 0.4],
        [0.12, SUITE.halfZ * 2 - 0.3, SUITE.halfX - 0.4, 0],
      ] as const) {
        const stripe = decal(
          new Mesh(new BoxGeometry(w, 0.34, d), toonMaterial(colour)),
        );
        stripe.position.set(x, y, z);
        shell.add(stripe);
      }
    });

    // Several beds, to sleep on or go jumpy jumpy between — one rainbow band
    // each, so "which is my bed" has an answer a child can shout across a room.
    const spots: readonly (readonly [number, number])[] = [
      [-4.6, -3.4],
      [-0.6, -3.4],
      [3.4, -3.4],
    ];
    spots.forEach(([x, z], index) => {
      const bed = createHotelBed();
      bed.root.position.set(x, 0, z);
      repaintPart(bed.root, 'bed-blanket', ART.rainbow[index * 2] ?? PALETTE.markerMint);
      shell.add(bed.root);
      const id = `bed-${index}`;
      this.beds.push({ x: SUITE.originX + x, z: SUITE.originZ + z, id });
      this.blockLocal(SUITE, x, z, 1.7);
      this.surfaces.addPlatform(
        new Plate(
          BED_MATTRESS_TOP,
          SUITE.originX + x - 0.7,
          SUITE.originX + x + 0.7,
          SUITE.originZ + z - 1,
          SUITE.originZ + z + 1,
        ),
      );
    });

    // A bedside table and its little crystal lamp between each pair of beds.
    for (const x of [-2.6, 1.4, 5.5]) {
      const table = bedsideTable();
      table.position.set(x, 0, -3.4);
      shell.add(table);
      this.blockLocal(SUITE, x, -3.4, 1);
    }

    // The rainbow rug, under the disco ball — the middle of the room, which
    // until now was the emptiest floor in the hotel and is where a child
    // actually stands when the ball is spinning.
    const mat = rainbowRug(0.8, 0.3);
    mat.position.set(0, 0, 1.2);
    shell.add(mat);

    const suiteCrystals: readonly number[] = [
      PALETTE.markerPink,
      PALETTE.markerLilac,
      PALETTE.markerMint,
      PALETTE.markerSky,
    ];
    this.placeProps(shell, SUITE, [
      { prop: () => crystalCluster(0x40b1, 1, suiteCrystals), x: -6.8, z: -4.8 },
      { prop: () => crystalCluster(0x40b2, 1, suiteCrystals), x: 6.8, z: -4.8 },
      { prop: () => crystalPlanter(0x40b3, PALETTE.markerPink, suiteCrystals), x: 6.6, z: 4.2 },
    ]);
    this.hangOnWalls(shell, SUITE, {
      north: [-4.6, 3.4],
      west: [-5, 5],
      pictures: [
        { wall: 'west', along: -3.2, width: 1.5, height: 1.15, seed: 0x40c1 },
        { wall: 'west', along: 3.2, width: 1.5, height: 1.15, seed: 0x40c2 },
      ],
    });

    this.hangDiscoBall(shell, 0, SUITE.wallHeight + 0.9, 1);
  }

  // ------------------------------------------------------ dressing helpers

  /**
   * The mosaic plate — Jim's *"an interesting and playful mosaic on the tiles
   * of the floor"*, laid over the room's own floor slab rather than replacing
   * it.
   *
   * A separate `decal` plate, not a map on the slab's material, for two
   * reasons: the slab is a `BoxGeometry` whose UVs run over all six faces, and
   * the plate stops 0.3 m short of every wall so the floor's own themed colour
   * survives as a border. One canvas per 4 m, which puts a tile at ~0.5 m —
   * chunky enough to survive being toon-banded (see `mosaicTexture`).
   */
  private layMosaic(shell: Group, room: HotelRoom): void {
    const width = room.halfX * 2 - 0.6;
    const depth = room.halfZ * 2 - 0.6;
    const METRES_PER_CANVAS = 4;
    const plate = decal(
      new Mesh(
        new PlaneGeometry(width, depth),
        toonMaterial(PALETTE.blossomWhite, {
          map: mosaicTexture(width / METRES_PER_CANVAS, depth / METRES_PER_CANVAS),
          // The same cosy lift `interiorMaterial` gives every other interior
          // surface, in the grout's own colour — a white emissive would wash
          // the tile colours out to pastel mush after dark.
          emissive: PALETTE.stonePinkLight,
          emissiveIntensity: 0.14,
        }),
      ),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = 0.02;
    shell.add(plate);
  }

  /** Bowls laid the length of a buffet counter, cycling the three breakfasts. */
  private layBuffet(shell: Group, x: number, z: number, length: number): void {
    const rng = new Rng(0x21b0f);
    const count = 9;
    for (let i = 0; i < count; i += 1) {
      const food = BREAKFASTS[i % BREAKFASTS.length];
      if (!food) continue;
      const bowl = createBreakfastBowl(food.kind);
      bowl.root.position.set(
        x - length / 2 + 0.9 + (i / (count - 1)) * (length - 1.8),
        BUFFET_TOP,
        z + rng.range(-0.1, 0.2),
      );
      shell.add(bowl.root);
    }
    // Three keep-out discs along the counter rather than one huge one: a
    // guest strolling past the buffet should be able to walk *along* it.
    for (const along of [-0.35, 0, 0.35]) {
      this.blockLocal(BREAKFAST, x + along * length, z + 0.6, 1.5);
    }
  }

  /** Stands a list of props on the floor, each registering its own keep-out. */
  private placeProps(
    shell: Group,
    room: HotelRoom,
    items: readonly { prop: () => Group; x: number; z: number; radius?: number }[],
  ): void {
    for (const item of items) {
      const group = item.prop();
      group.position.set(item.x, 0, item.z);
      shell.add(group);
      this.blockLocal(room, item.x, item.z, item.radius ?? 1);
    }
  }

  /**
   * Sconces and pictures, on the two walls the camera can actually see.
   *
   * The camera sits at focus + (+X, +Y, +Z), so it looks at the **inside faces
   * of the north (−Z) and west (−X) walls** and at the *outside* of the other
   * two — anything hung on the south or east wall is a prop nobody will ever
   * see. That is why this helper only offers those two.
   */
  private hangOnWalls(shell: Group, room: HotelRoom, plan: WallPlan): void {
    const SCONCE_Y = 1.85;
    const PICTURE_Y = 1.9;
    for (const x of plan.north ?? []) {
      const light = sconce(room.theme.glow);
      light.position.set(x, SCONCE_Y, -room.halfZ + 0.28);
      shell.add(light);
    }
    for (const z of plan.west ?? []) {
      const light = sconce(room.theme.glow);
      light.position.set(-room.halfX + 0.28, SCONCE_Y, z);
      light.rotation.y = Math.PI / 2;
      shell.add(light);
    }
    for (const frame of plan.pictures ?? []) {
      const art = picture(frame.width, frame.height, frame.seed);
      if (frame.wall === 'north') {
        art.position.set(frame.along, PICTURE_Y, -room.halfZ + 0.31);
      } else {
        art.position.set(-room.halfX + 0.31, PICTURE_Y, frame.along);
        art.rotation.y = Math.PI / 2;
      }
      shell.add(art);
    }
  }

  /**
   * Records somewhere a strolling guest must not stand, in the room's own
   * local metres. `HotelGuests` is handed the whole list.
   *
   * Registered by the placement helpers themselves rather than written out a
   * second time next to the guest code — a hand-kept copy of "where the
   * furniture is" is CLAUDE.md's most-repeated bug, and this one would fail
   * silently as a child walking through a sofa.
   */
  private blockLocal(room: HotelRoom, x: number, z: number, radius: number): void {
    this.keepOuts.push({ room, x, z, radius });
  }

  private roomShell(room: HotelRoom): Group {
    const name = `hotel:${room.space}`;
    const shell = this.hotelRoot.children.find((child) => child.name === name);
    if (!shell) throw new Error(`hotel: no shell built for ${room.space}`);
    return shell as Group;
  }

  private hangDiscoBall(shell: Group, x: number, y: number, z: number): void {
    // A slim beam carries the ball — the rooms are open-topped, so there is
    // no ceiling to hang it from, and a ball on nothing reads as a bug.
    const beam = solid(
      new Mesh(new BoxGeometry(3.2, 0.16, 0.16), softMaterial(PALETTE.stonePinkDark)),
    );
    beam.position.set(x, y + 1.35, z);
    shell.add(beam);
    const ball = createDiscoBall();
    const spin = new Group();
    spin.position.set(x, y + 1.27, z);
    spin.add(ball.root);
    shell.add(spin);
    this.discoBalls.push({ spin });
  }

  /**
   * One laid table with a chair on either side.
   *
   * `spin` yaws the whole setting — chairs, bowls and the sit-down pose all
   * take it, because they are all derived from it rather than written down
   * separately. It exists because seven tables at the same yaw is a canteen:
   * Jim asked for the breakfast room to *"vary rotation/position so it doesn't
   * grid"*, and a per-table angle is the cheapest way to buy that.
   */
  private placeBreakfastTable(
    shell: Group,
    room: HotelRoom,
    x: number,
    z: number,
    id: string,
    spin = 0,
  ): void {
    const table = createBreakfastTable();
    table.root.position.set(x, 0, z);
    table.root.rotation.y = spin;
    shell.add(table.root);
    // A table plus both chairs is 1.05 m of furniture each way; 2.2 keeps a
    // strolling guest from clipping the back of a chair.
    this.blockLocal(room, x, z, 2.2);
    BREAKFASTS.forEach((food, index) => {
      const bowl = createBreakfastBowl(food.kind);
      const angle = (index / BREAKFASTS.length) * Math.PI * 2 + 0.4 + spin;
      bowl.root.position.set(x + Math.cos(angle) * 0.34, 0.74, z + Math.sin(angle) * 0.34);
      shell.add(bowl.root);
    });
    [spin, spin + Math.PI].forEach((yaw, index) => {
      const chair = createBreakfastChair();
      const cx = x + Math.sin(yaw) * 1.05;
      const cz = z + Math.cos(yaw) * 1.05;
      chair.root.position.set(cx, 0, cz);
      chair.root.rotation.y = yaw + Math.PI;
      shell.add(chair.root);
      this.chairs.push({
        x: room.originX + cx,
        z: room.originZ + cz,
        facing: yaw + Math.PI,
        room,
        id: `${id}-${index}`,
      });
    });
  }

  /**
   * The painted "this way to the lift" arrow — "an arrow showing the way to
   * your floor, on the floors of the hotel" (Eleri).
   *
   * The chevrons are real arrow geometry (`dressing.ts`'s `floorChevron`)
   * rather than the rotated rectangles they started as: QA's note was that
   * from the play camera a rectangle reads as a stripe, not as a direction.
   * They stay the same lemon on every floor on purpose — the *colour* is the
   * wayfinding, and a way-out sign that changes colour per storey is one a
   * child has to re-learn each time she leaves the lift.
   */
  private paintArrow(shell: Group, fromX: number, fromZ: number, toX: number, toZ: number): void {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const length = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const chevrons = Math.max(2, Math.floor(length / 2.2));
    for (let i = 0; i < chevrons; i += 1) {
      const t = (i + 0.5) / chevrons;
      const chevron = floorChevron(PALETTE.markerLemon);
      chevron.position.set(fromX + dx * t, 0.06, fromZ + dz * t);
      chevron.rotation.set(-Math.PI / 2, yaw, 0);
      shell.add(chevron);
    }
  }
}

// ----------------------------------------------------------------- helpers

/** "The Land Hotel", painted onto the tower's signboard. */
function paintSign(signboard: Mesh): void {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#3d2b4f';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#ffe9f4';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('The Land Hotel', 256, 68);
  signboard.material = new MeshToonMaterial({ map: glbCanvasTexture(canvas) });
}

/**
 * A canvas texture for a mesh whose UVs came out of a **glTF file**.
 *
 * three.js defaults `Texture.flipY` to `true`, which is right for the whole
 * rest of this game: a `CanvasTexture` is painted with y running *down* the
 * page, and geometry built here has v running *up*, so the flip is what makes
 * the two agree. glTF stores its UVs the other way up — v runs down, top-left
 * origin — and the loader does not rewrite them, so the same default flip
 * applied to an authored mesh cancels out the wrong way and the writing comes
 * out **upside-down**. QA found exactly that on the tower's signboard
 * (6 August 2026), and the "yours" plaque had it too — it was simply harder to
 * spot on a five-letter word in a rounded panel.
 *
 * Both painted panels in this hotel are authored nodes (`hotel_build.py` UV-maps
 * them), so both go through here. **Anything else that paints words onto an
 * asset from a `.glb` must do the same** — the failure is silent, symmetrical
 * and looks like a modelling mistake rather than a texture setting.
 */
function glbCanvasTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Recolours one named part of an authored asset, outline included.
 *
 * The `.glb` owns shape and code owns colour (`art/models/hotelAssets.ts`'s
 * header) — normally through that file's `STYLES` table, which is the right
 * home for "what colour is a bed blanket". This is the other case: *these
 * three beds want three different blankets*, which is a fact about the suite,
 * not about the asset, exactly as the rail cart's lane colour is a fact about
 * the race. Each `hotelMesh` builds its own material, so this touches one bed.
 *
 * **The outline has to move with it.** `addOutline` bakes `inkTint(colour)`
 * into a `MeshBasicMaterial` at build time, so a repaint that skipped it would
 * leave a mint-tinted line drawn round a red blanket — the sort of thing that
 * reads as a lighting bug rather than as a missed line of code.
 */
function repaintPart(root: Group, name: string, colour: number): void {
  const mesh = root.getObjectByName(name);
  if (!(mesh instanceof Mesh)) return;
  const material = mesh.material;
  if (material instanceof MeshToonMaterial) material.color.setHex(colour);
  for (const child of mesh.children) {
    if (child instanceof Mesh && child.material instanceof MeshBasicMaterial) {
      child.material.color.setHex(inkTint(colour));
    }
  }
}

/** "yours", on the suite door's plaque — Eleri's exact word, lowercase. */
function paintYours(plaque: Mesh): void {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#fff3c9';
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = '#3d2b4f';
  ctx.font = 'bold 72px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('yours', 128, 66);
  plaque.material = new MeshToonMaterial({ map: glbCanvasTexture(canvas) });
}

/**
 * The tower's collision: eight walls around the crystal cluster with the
 * doorway open, and a lobby back wall a couple of metres in — walking on
 * through is what enters the hotel, and the wall is what stops a sprinting
 * child ending up inside solid crystal while the iris closes.
 */
function registerTowerCollision(
  collision: CollisionWorld,
  x: number,
  z: number,
  yaw: number,
): void {
  const R = 7.2;
  const doorArc = 0.32;
  for (let i = 0; i < 8; i += 1) {
    const a1 = yaw + (i / 8) * Math.PI * 2 + doorArc;
    const a2 = yaw + ((i + 1) / 8) * Math.PI * 2 - (i === 7 ? doorArc : -0.001);
    // The doorway faces `yaw`; skip the segment straddling it.
    if (i === 0) continue;
    collision.addWall(
      x + Math.sin(a1) * R,
      z + Math.cos(a1) * R,
      x + Math.sin(a2) * R,
      z + Math.cos(a2) * R,
      0.4,
    );
  }
  // The doorway's jambs and the lobby back wall.
  const doorSin = Math.sin(yaw);
  const doorCos = Math.cos(yaw);
  const sideSin = Math.sin(yaw + Math.PI / 2);
  const sideCos = Math.cos(yaw + Math.PI / 2);
  const jamb = (side: number) => {
    collision.addWall(
      x + doorSin * (R - 2.2) + sideSin * side * (DOOR_HALF + 0.5),
      z + doorCos * (R - 2.2) + sideCos * side * (DOOR_HALF + 0.5),
      x + doorSin * (R + 0.4) + sideSin * side * (DOOR_HALF + 0.5),
      z + doorCos * (R + 0.4) + sideCos * side * (DOOR_HALF + 0.5),
      0.35,
    );
  };
  jamb(1);
  jamb(-1);
  collision.addWall(
    x + doorSin * (R - 2.2) + sideSin * (DOOR_HALF + 0.5),
    z + doorCos * (R - 2.2) + sideCos * (DOOR_HALF + 0.5),
    x + doorSin * (R - 2.2) - sideSin * (DOOR_HALF + 0.5),
    z + doorCos * (R - 2.2) - sideCos * (DOOR_HALF + 0.5),
    0.35,
  );
}
