import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshToonMaterial,
  SRGBColorSpace,
} from 'three';
import { circleBoundary, GARDEN_PLAY_BOUNDARY } from '../boundary';
import { HOTEL_PLAY_RADIUS } from '../../core/constants';
import { PALETTE } from '../../core/palette';
import type { FrameContext, GameSystem } from '../../core/types';
import type { CollisionWorld } from '../Collision';
import type { AnchorPlots } from '../AnchorPlots';
import type { Player } from '../../entities/Player';
import type { InteriorControls } from '../building';
import type { WalkSurfaces, MovingPlatform } from '../building/surfaces';
import type { LiftPanelSource } from '../building/liftRide';
import { interiorMaterial, softMaterial } from '../building/parts';
import { toonMaterial, solid, decal } from '../../art/style/materials';
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
  private seatedAt: string | null = null;
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
    for (const ball of this.discoBalls) ball.spin.rotation.y = elapsed * 0.5;
    for (const keeper of this.keepers) keeper.setWalkPhase(elapsed * 0.4, 0.5);

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
      this.boundTo(room);
      this.controls.snapCamera();
      this.spaceCooldown = SPACE_COOLDOWN;
    });
    const player = this.player;
    if (!player) return;
    // The lift keeps the ride pose; only the world jumps. Land in the new
    // room's alcove.
    const x = room.originX - room.halfX - 1.2;
    const z = room.originZ + (room.liftZ ?? 0);
    player.setRidePose(x, 0, z, Math.PI / 2);
  }

  private boundTo(room: HotelRoom): void {
    this.collision.setPlayBounds(circleBoundary(HOTEL_PLAY_RADIUS, room.originX, room.originZ));
  }

  // ------------------------------------------------------------- actions

  private checkIn(): void {
    saveFlags.giveHotelKey();
    this.player?.model.setExpression('happy');
    for (const keeper of this.keepers) keeper.setExpression('happy');
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

    // The floor plate. Crystal-pale, with a soft emissive lift so an
    // open-topped room at night is cosy rather than cave-dark.
    const floor = solid(
      new Mesh(
        new BoxGeometry(room.halfX * 2 + 1.2, 0.5, room.halfZ * 2 + 1.2),
        interiorMaterial(PALETTE.glassTint),
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
    const wallMaterial = interiorMaterial(PALETTE.stonePinkLight);
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
            interiorMaterial(PALETTE.markerLilac),
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

    // The giant RiPika, spinning gently exactly like the fountain's, with the
    // disco ball above — Eleri: "a disco ball above the ripika statue".
    const statue = createRipikaStatue();
    statue.root.position.set(0, 0, -1);
    shell.add(statue.root);
    this.hangDiscoBall(shell, 0, 9.6, -1);

    const desk = createReceptionDesk();
    desk.root.position.set(5, 0, -7.2);
    shell.add(desk.root);
    const reception = createKeeper({ colour: PALETTE.flowerRed, hair: PALETTE.markerPink });
    reception.root.position.set(5, 0, -8.6);
    shell.add(reception.root);
    this.keepers.push(reception);

    // The breakfast corner, ground floor — "breakfast ... at the ground floor".
    this.placeBreakfastTable(shell, LOBBY, -8, 4.5, 'lobby-a');
    this.placeBreakfastTable(shell, LOBBY, -8, -2.5, 'lobby-b');

    // A painted arrow on the floor pointing at the lift — "an arrow showing
    // the way to your floor, on the floors of the hotel".
    this.paintArrow(shell, 2.5, 5.5, -LOBBY.halfX + 2.5, 0);

    return statue;
  }

  private dressBreakfast(): void {
    const shell = this.roomShell(BREAKFAST);
    this.placeBreakfastTable(shell, BREAKFAST, -3.5, -2.5, 'b25-a');
    this.placeBreakfastTable(shell, BREAKFAST, 3.5, -2.5, 'b25-b');
    this.placeBreakfastTable(shell, BREAKFAST, 0, 3, 'b25-c');
    const server = createKeeper({ colour: PALETTE.flowerRed, hair: PALETTE.markerPink });
    server.root.position.set(6.8, 0, -5.6);
    server.root.rotation.y = Math.PI;
    shell.add(server.root);
    this.keepers.push(server);

    // A band of glowing crystal panes where floor 25's windows would be.
    const band = decal(
      new Mesh(
        new BoxGeometry(0.15, 1.4, BREAKFAST.halfZ * 2 - 1),
        new MeshToonMaterial({
          color: PALETTE.glassTint,
          emissive: PALETTE.glassTint,
          emissiveIntensity: 0.5,
        }),
      ),
    );
    band.position.set(BREAKFAST.halfX - 0.2, 1.9, 0);
    shell.add(band);
  }

  private dressCorridor(): void {
    const shell = this.roomShell(CORRIDOR);

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
    });

    // The door that says "yours", at the corridor's end, with an arrow to it.
    const door = createYoursDoor();
    door.root.position.set(CORRIDOR.halfX - 0.3, 0, 0);
    door.root.rotation.y = -Math.PI / 2;
    paintYours(door.plaque);
    shell.add(door.root);
    this.paintArrow(shell, -2, 0, CORRIDOR.halfX - 2, 0);
  }

  private dressSuite(): void {
    const shell = this.roomShell(SUITE);

    // Rainbow bands round the walls — "the room is rainbow coloured, only
    // for the top room" — six stripes, the game's own rainbow.
    const rainbow = [0xff8f8f, 0xffc46b, 0xffe37a, 0x8fe3a5, 0x87c9ff, 0xc9a9ff];
    rainbow.forEach((colour, index) => {
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

    // Several beds, to sleep on or go jumpy jumpy between.
    const spots: readonly (readonly [number, number])[] = [
      [-4.6, -3.4],
      [-0.6, -3.4],
      [3.4, -3.4],
    ];
    spots.forEach(([x, z], index) => {
      const bed = createHotelBed();
      bed.root.position.set(x, 0, z);
      shell.add(bed.root);
      const id = `bed-${index}`;
      this.beds.push({ x: SUITE.originX + x, z: SUITE.originZ + z, id });
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

    this.hangDiscoBall(shell, 0, SUITE.wallHeight + 0.9, 1);
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

  private placeBreakfastTable(shell: Group, room: HotelRoom, x: number, z: number, id: string): void {
    const table = createBreakfastTable();
    table.root.position.set(x, 0, z);
    shell.add(table.root);
    BREAKFASTS.forEach((food, index) => {
      const bowl = createBreakfastBowl(food.kind);
      const angle = (index / BREAKFASTS.length) * Math.PI * 2 + 0.4;
      bowl.root.position.set(x + Math.cos(angle) * 0.34, 0.74, z + Math.sin(angle) * 0.34);
      shell.add(bowl.root);
    });
    [0, Math.PI].forEach((yaw, index) => {
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

  private paintArrow(shell: Group, fromX: number, fromZ: number, toX: number, toZ: number): void {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const length = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);
    const chevrons = Math.max(2, Math.floor(length / 2.2));
    for (let i = 0; i < chevrons; i += 1) {
      const t = (i + 0.5) / chevrons;
      const chevron = decal(
        new Mesh(new BoxGeometry(0.7, 0.04, 0.28), toonMaterial(PALETTE.markerLemon)),
      );
      chevron.position.set(fromX + dx * t, 0.06, fromZ + dz * t);
      chevron.rotation.y = yaw;
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
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  signboard.material = new MeshToonMaterial({ map: texture });
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
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  plaque.material = new MeshToonMaterial({ map: texture });
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
