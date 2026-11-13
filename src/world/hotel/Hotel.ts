import { TOWER_SHELL_RADIUS, TOWER_BACK_ALONG, TOWER_FACADE_ALONG, TOWER_DOOR_BAND_OUTER, TOWER_JAMB_REACH, TOWER_JAMB_HALF_THICKNESS } from './towerDimensions';
import type { PlacedDoorFrame } from '../../art/models/doorFrames';
import { Group, type Mesh, MeshToonMaterial, type PerspectiveCamera } from 'three';
import { glbCanvasTexture } from '../../art/style/glb';
import { GARDEN_PLAY_BOUNDARY } from '../boundary';
import { PALETTE } from '../../core/palette';
import type { FrameContext, GameSystem } from '../../core/types';
import type { CollisionWorld } from '../Collision';
import { standInPlot, type AnchorPlots } from '../AnchorPlots';
import type { Player } from '../../entities/Player';
import type { OpenAreaPoint } from '../dismount';
import type { InteriorControls } from '../building';
import type { WalkSurfaces } from '../building/surfaces';
import type { LiftPanelSource } from '../building/liftRide';
import { createEntranceDoors, createHotelTower, type SlidingDoorsHandle } from '../../art/models/hotelAssets';
import { SpeechBubble } from '../../ui/SpeechBubble';
import type { ManagedLabel } from '../../ui/LabelManager';
import type { ResidentSpec } from '../../entities/npc';
import { placedEntry } from '../parkLayout';
import type { InteractZone } from '../interact';
import { DOOR_HALF, hotelDoorBands, roomFor, type HotelRoom } from './layout';
import { bandContains, bandWalkedThrough, type PortalBand } from '../tapSpacing';
import { HotelLift } from './HotelLift';
import type { Shot } from './cinematic';
import type { RoomKeepOut } from './place';
import { spaceAt, SPACE_GARDEN } from '../spaces';
import { SpaceManager } from '../SpaceManager';
import { yAtAltitude } from '../terrain';
import { HOTEL_INTERIOR } from '../interiors';
import type { HotelDeps, HotelInterior, PetParadeLink } from './interior';

export type { HotelDeps, PetBedSpot, PetParadeLink } from './interior';

/**
 * **The Land Hotel, as the park sees it** — the crystal tower, its collider,
 * its sliding front doors and the doorway that takes her in.
 *
 * Everything inside — five rooms, their furniture and colliders, the guests,
 * the camera moments, and the half of `hotel.glb` they are drawn from — is
 * `interior.ts`'s {@link HotelInterior}, a lazy chunk fetched when she walks in
 * (`world/interiors.ts`'s `HOTEL_INTERIOR`; Jim, 12 Nov 2026: *"all interiors
 * should be loaded on-demand on entering that room"*). It is built behind the
 * door's iris, which holds shut until it is (`SpaceManager.changeToFurnished`),
 * so she never stands in a room whose solids do not exist yet. A save that
 * restores inside, or a `/hotel…` deep link, loads it before the game is built
 * (`interiorsToPreload`), and then it is furnished here in the constructor
 * exactly as it always was; Node's checks are handed it up front
 * (`scripts/lib/eagerInteriors.mts`) and measure the same fully built hotel.
 *
 * This class owns what has to work before the interior exists, and the things
 * both halves share — the change-of-space dance ({@link spaces}), the lift
 * (which `Game`'s panel holds from boot), and the receptionist's bubble (which
 * the park's `LabelManager` holds from boot). Everything else it answers by
 * asking the interior, with the answer an empty hotel would give until there is
 * one.
 */

/** How far out an automatic door notices somebody, and how wide its approach is. */
export const AUTO_DOOR_REACH = 4.2;
export const AUTO_DOOR_SIDE = 2.4;

/** Seconds an automatic door takes to slide fully open, or fully shut. */
// 1.2, up from 0.55: at 0.55 s the slide was over before the fixed camera's
// oblique view of the recess could register it — QA staged ten approaches and
// never caught a legible mid-slide frame. A door a person is meant to SEE
// open (Jim asked for exactly that) has to open at the pace of a person
// arriving, not a sensor firing.
const AUTO_DOOR_SECONDS = 1.2;

/**
 * How near the tower she must be for the interior's chunk to be fetched ahead
 * of the door, in metres from its centre. Only fetched, not built: building is
 * the door's job, behind its iris, so walking up costs nothing on screen.
 */
const HOTEL_PREFETCH_RADIUS = 24;

/** What the door says when the interior could not be fetched. */
const DOOR_REFUSED_LINE = 'The hotel is still getting your room ready — try again in a moment!';

/** Where that line hangs over the doormat, in metres above the ground — over her head. */
const DOOR_LINE_HEIGHT = 3.4;

/** How far past the door band she must step before a refused door will try again, in metres. */
const DOOR_STEP_AWAY = 1.5;

export class Hotel implements GameSystem {
  readonly name = 'hotel';

  /** Everything in the hotel's own spaces. Invisible until entered; empty until the interior is built. */
  readonly hotelRoot = new Group();
  /** The tower in the park. */
  readonly gardenRoot = new Group();

  /** The inside, once it has been fetched and built — see the class comment. */
  private interior: HotelInterior | null = null;
  private player: Player | null = null;
  /**
   * The change-of-space dance, shared with the castle and owned by neither.
   * See `world/SpaceManager.ts`. One for both halves, so a door inside and the
   * door outside share one cooldown.
   */
  private readonly spaces: SpaceManager;
  private readonly lift: HotelLift;
  /**
   * The receptionist's bubble. Built here, not in the interior, because the
   * park's `LabelManager` takes every label once, at boot (`World`): the
   * interior hangs it over the desk when it is built.
   */
  private readonly receptionBubble = new SpeechBubble(
    { id: 'hotel-receptionist', item: 'hotel-reception', kind: 'actionFeedback' },
    PALETTE.markerLilac,
  );
  /** The door's own line, said only when the interior could not be fetched. */
  private readonly doorBubble = new SpeechBubble(
    { id: 'hotel-door', item: 'hotel-entrance', kind: 'actionFeedback' },
    PALETTE.markerLilac,
  );
  /** Seconds the door's line has left. */
  private doorLineFor = 0;
  /** The door just failed to open because the interior could not be fetched; it waits until she steps away. */
  private doorRefused = false;
  /** A save restored her in a hotel room before the interior was here: she is taken in through the door on the first frame. */
  private restorePending = false;

  /** The tower's front doors, out in the park. The lobby's pair is the interior's. */
  private outerDoors: SlidingDoorsHandle | null = null;
  private outerOpen = 0;

  // Late-wired seams, held here and handed to the interior when it is built.
  private parade: PetParadeLink | null = null;
  private cinematicSeam: ((camera: PerspectiveCamera | null) => void) | null = null;
  private screenSize: { readonly width: number; readonly height: number } | null = null;
  /**
   * Set by `World` once its crowd exists: hands it the guests of an interior
   * built after boot. An interior built at boot (a restore, a deep link, Node)
   * has its guests read by `World` through {@link residents} as it always did.
   */
  onLateResidents: ((residents: readonly ResidentSpec[]) => void) | null = null;

  /** Facade frame: the tower's yaw and centre, for the door trigger. */
  private readonly towerHeight: number;
  private readonly facadeYaw: number;
  private readonly facadeX: number;
  private readonly facadeZ: number;
  /**
   * The anchor's own "entrance" point — `world/anchors.ts`'s `entrance: [p.
   * entranceX, p.entranceZ]`, the exact spot `ui/ParkMap.ts` draws this
   * attraction's pin at. Both come from the same `placedEntry('hotel')`
   * call, stored here rather than re-read, so {@link exteriorEntranceZone}
   * can size itself to reach it without a second, hand-picked constant that
   * could drift out of sync with wherever the solver puts it.
   */
  private readonly entranceX: number;
  private readonly entranceZ: number;
  private readonly tower: { readonly root: Group; readonly doorGlow: Mesh };

  private readonly collision: CollisionWorld;
  private readonly controls: InteriorControls;
  private readonly surfaces: WalkSurfaces;
  private readonly deps: HotelDeps;

  constructor(
    collision: CollisionWorld,
    anchorPlots: AnchorPlots,
    controls: InteriorControls,
    surfaces: WalkSurfaces,
    deps: HotelDeps,
  ) {
    this.collision = collision;
    this.controls = controls;
    this.spaces = new SpaceManager(controls);
    this.surfaces = surfaces;
    this.deps = deps;
    // ------------------------------------------------------------ the tower
    const plot = placedEntry('hotel');
    this.facadeX = plot.x;
    this.facadeZ = plot.z;
    this.entranceX = plot.entranceX;
    this.entranceZ = plot.entranceZ;
    // The door faces the doormat the solver placed — the tower is a cluster
    // of crystals, so any yaw is as natural as any other.
    this.facadeYaw = Math.atan2(plot.entranceX - plot.x, plot.entranceZ - plot.z);

    const tower = createHotelTower();
    this.tower = tower;
    this.towerHeight = tower.height;
    tower.root.rotation.y = this.facadeYaw;
    // **Lift the porch clear of the doors.** At the camera's fixed 38° pitch
    // the porch roof hid the 2.58 m sliding leaves from every legal standing
    // spot — the auto-doors worked (QA read their openness live) and were
    // invisible, which is the same as not existing. The glb bakes placement
    // into vertices with nodes at identity, so one position lift raises the
    // whole porch; the signboard is its own node and stays put.
    tower.root.getObjectByName('tower-porch')?.position.setY(0.62);
    paintSign(tower.signboard);
    this.gardenRoot.add(tower.root);
    this.gardenRoot.name = 'the-land-hotel-outside';

    const group = anchorPlots.getGroup('hotel');
    // **Zero, not `-group.position.y`.** The plot's own origin *is* the ground
    // under the hotel — `AnchorPlots` sets it from `terrainHeight` and leans it
    // to the local up — so a local `y` of zero stands the tower on it.
    //
    // Cancelling the plot's height instead pinned the tower to **absolute world
    // y = 0**, which is the old flat park's ground plane and nothing at all on
    // a sphere. It read as correct for as long as the ground near the hotel
    // happened to be near zero: on the 1200 m sphere it was 0.76 m down there,
    // which the crystals' own skirt exactly covered. Shrink the sphere to 400 m
    // and the ground drops to 2.3 m down while the tower stays at zero — Jim,
    // 13 September 2026: *"the castle and hotel, and maybe some others are now
    // floating in space above the earth."* Measured before the fix: the lowest
    // crystal sat **1.75 m** clear of the grass.
    //
    // `standInPlot` solves the world transform first and carries it back
    // through the plot's inverse, so neither the plot's tilt nor any offset
    // between the plot's anchor and the tower's own spot can leak into height.
    standInPlot(group, this.gardenRoot, plot.x, plot.z, 0, 0);
    group.add(this.gardenRoot);
    anchorPlots.setPlaceholderVisible('hotel', false);

    // Collision: an octagon of walls around the crystal cluster, with the
    // doorway left open and a short lobby wall behind it — the same "a metre
    // of hallway, then somewhere else entirely" trick as the castle facade.
    registerTowerCollision(collision, plot.x, plot.z, this.facadeYaw, tower.height);
    this.fitOuterDoors();

    // ------------------------------------------------------------ the rooms
    this.hotelRoot.name = 'the-land-hotel-inside';
    this.hotelRoot.visible = false;

    // ------------------------------------------------------------- the lift
    // Here rather than in the interior because `Game`'s lift panel holds it
    // from boot; it asks the interior about rooms, and with no interior there
    // is no room she can be in.
    this.lift = new HotelLift({
      currentRoom: () => this.currentRoom(),
      atLiftDoors: (player) => this.atLiftDoors(player),
      travelTo: (room) => this.interior?.travelTo(room),
      cancelWalk: () => this.controls.cancelWalk(),
      player: () => this.player,
    });

    // Built now if it is already here — a save that restores inside, a deep
    // link, Node — so it is furnished in this constructor, as it always was.
    this.furnishIfLoaded();
  }

  // ------------------------------------------------------- the interior

  /** True once the interior has been built. */
  get furnished(): boolean {
    return this.interior !== null;
  }

  /**
   * Fetches the interior and builds it — for a check or a test that wants the
   * hotel furnished. The door does not come through here: it fetches at once
   * and builds behind its shut iris ({@link changeIn}).
   */
  furnish(): Promise<void> {
    if (this.interior) return Promise.resolve();
    return HOTEL_INTERIOR.load().then(() => this.furnishIfLoaded());
  }

  private furnishIfLoaded(): void {
    if (this.interior) return;
    const module = HOTEL_INTERIOR.loaded;
    if (!module) return;
    const late = this.onLateResidents;
    const interior = this.collision.ownedBy('hotel', () =>
      new module.HotelInterior(this.collision, this.controls, this.surfaces, this.deps, {
        hotelRoot: this.hotelRoot,
        spaces: this.spaces,
        lift: this.lift,
        receptionBubble: this.receptionBubble,
        facade: {
          x: this.facadeX,
          z: this.facadeZ,
          yaw: this.facadeYaw,
          towerHeight: this.towerHeight,
        },
      }),
    );
    this.interior = interior;
    if (this.player) interior.attachPlayer(this.player);
    interior.petParade = this.parade;
    interior.onCinematic = this.cinematicSeam;
    if (this.screenSize) interior.resizeCinematic(this.screenSize.width, this.screenSize.height);
    if (late) late(interior.residents);
  }

  /**
   * Into the hotel behind the iris: built first if it is not yet, and
   * `midpoint` run only once it is. If it cannot be fetched she stays where
   * she was and `onFailed` runs — the door's line, by default.
   */
  private changeIn(midpoint: (interior: HotelInterior) => void, onFailed: () => void = () => this.refuseDoor()): void {
    this.spaces.changeToFurnished(
      { part: HOTEL_INTERIOR, furnished: () => this.interior !== null, build: () => this.furnishIfLoaded() },
      () => {
        if (this.interior) midpoint(this.interior);
      },
      onFailed,
    );
  }

  /**
   * The door that could not open. It says why over the doormat, and stays shut
   * until she has stepped away from it — firing again every time the cooldown
   * ran out, while she stood in the doorway, would close and open the iris
   * about once a second (QA on #749, at the Reptile House).
   */
  private refuseDoor(): void {
    this.doorRefused = true;
    this.doorBubble.anchorAt(this.entranceX - this.facadeX, DOOR_LINE_HEIGHT, this.entranceZ - this.facadeZ);
    if (this.doorBubble.sprite.parent !== this.gardenRoot) this.gardenRoot.add(this.doorBubble.sprite);
    this.doorBubble.setText(DOOR_REFUSED_LINE);
    this.doorLineFor = 1.6 + DOOR_REFUSED_LINE.length * 0.07;
  }

  // ------------------------------------------------------------ queries

  private get inside(): boolean {
    return this.interior?.isInside ?? false;
  }

  private currentRoom(): HotelRoom | null {
    const player = this.player;
    if (!player) return null;
    const space = spaceAt(player.position.x, player.position.z);
    if (space === SPACE_GARDEN) return null;
    return roomFor(space);
  }

  private atLiftDoors(player: Player): boolean {
    const room = this.currentRoom();
    if (!room) return false;
    const lift = hotelDoorBands(room).find((band) => band.kind === 'lift');
    return lift !== undefined && bandContains(lift, player.position.x, player.position.z);
  }

  /** May a deep link take her in now? */
  private canEnter(): boolean {
    const player = this.player;
    return player !== null && !player.riding && !this.spaces.isChanging && !this.inside;
  }

  // ----------------------------------------------------- what World asks

  get liftPanel(): LiftPanelSource {
    return this.lift;
  }

  /**
   * The doorway frame round the lobby's way out to the park (`doorFrames.ts`).
   * It is the interior's — the lobby's south wall and the frame standing in it
   * are built with the rooms — so there is none to hand over until the hotel
   * is {@link furnished}; ask that first (`World.doorwayExits` does).
   */
  get exitDoorFrame(): PlacedDoorFrame {
    if (!this.interior) throw new Error('Hotel.exitDoorFrame: the interior is not built — furnish() first');
    return this.interior.exitDoorFrame;
  }

  /** See `HotelInterior.propKeepOuts`. Empty until the interior is built. */
  get propKeepOuts(): readonly RoomKeepOut[] {
    return this.interior?.propKeepOuts ?? [];
  }

  get bathroomRooms(): readonly HotelRoom[] {
    return this.interior?.bathroomRooms ?? [];
  }

  /** See `HotelInterior.bathroomFixtures`; `null` until the interior is built. */
  bathroomFixtures(room: HotelRoom): ReturnType<HotelInterior['bathroomFixtures']> {
    return this.interior?.bathroomFixtures(room) ?? null;
  }

  get artworkStands(): HotelInterior['artworkStands'] {
    return this.interior?.artworkStands ?? [];
  }

  get artworkPlacements(): HotelInterior['artworkPlacements'] {
    return this.interior?.artworkPlacements ?? [];
  }

  get cinematicShots(): readonly { readonly id: string; readonly room: HotelRoom; readonly shot: Shot }[] {
    return this.interior?.cinematicShots ?? [];
  }

  windowVantage(room: HotelRoom): ReturnType<HotelInterior['windowVantage']> {
    if (!this.interior) throw new Error('Hotel.windowVantage: the interior is not built — furnish() first');
    return this.interior.windowVantage(room);
  }

  resizeCinematic(width: number, height: number): void {
    this.screenSize = { width, height };
    this.interior?.resizeCinematic(width, height);
  }

  /** The parade, for the pet beds — see `HotelInterior.petParade`. */
  get petParade(): PetParadeLink | null {
    return this.parade;
  }

  set petParade(parade: PetParadeLink | null) {
    this.parade = parade;
    if (this.interior) this.interior.petParade = parade;
  }

  /** Set by `Game`; the seam that hands a camera to `Game.cameraOverride`. */
  get onCinematic(): ((camera: PerspectiveCamera | null) => void) | null {
    return this.cinematicSeam;
  }

  set onCinematic(seam: ((camera: PerspectiveCamera | null) => void) | null) {
    this.cinematicSeam = seam;
    if (this.interior) this.interior.onCinematic = seam;
  }

  get playerIsInside(): boolean {
    return this.interior?.playerIsInside ?? false;
  }

  get isNapping(): boolean {
    return this.interior?.isNapping ?? false;
  }

  /** The guests, for `World`'s crowd — none until the interior is built (then {@link onLateResidents}). */
  get residents(): readonly ResidentSpec[] {
    return this.interior?.residents ?? [];
  }

  get screenLabels(): readonly ManagedLabel[] {
    return [this.receptionBubble, this.doorBubble];
  }

  get petBeds(): HotelInterior['petBeds'] {
    return this.interior?.petBeds ?? [];
  }

  petBedsForNapIn(bedIndex: number): ReturnType<HotelInterior['petBedsForNapIn']> {
    return this.interior?.petBedsForNapIn(bedIndex) ?? [];
  }

  petBedShortfall(bedIndex: number): number {
    return this.interior?.petBedShortfall(bedIndex) ?? 0;
  }

  attachPlayer(player: Player): void {
    this.player = player;
    this.interior?.attachPlayer(player);
  }

  /**
   * Adopt a player restored into a hotel room (a reload mid-visit). See
   * `HotelInterior.adoptRestoredPlayer`.
   *
   * `main.ts` loads the interior before the game is built for a save that
   * restores in here (`interiorsToPreload`), so it is built by now. If it is
   * not — that load failed, or timed out — she is **never** put in a room to
   * have its furniture built round her: a prop's collider registered on top of
   * her is a box she can never leave. On the first frame ({@link update}) she
   * is put on the doormat and taken in through the door, behind its iris, once
   * it is built. Not here: `Game` puts her back on her saved spot after every
   * adoption, so a move made now would be undone.
   */
  adoptRestoredPlayer(): void {
    if (!this.currentRoom()) return;
    if (this.interior) {
      this.interior.adoptRestoredPlayer();
      return;
    }
    console.error('Land of Good Places: restored into the hotel before its interior was loaded — see interiorsToPreload in world/interiors.ts. She waits at the door.');
    this.restorePending = true;
  }

  /** "Next day" — see `HotelInterior.wakeTomorrowBehindTheIris`. Refused while anything still has her. */
  wakeTomorrowInSuite(behindTheIris: () => void): boolean {
    const player = this.player;
    if (!player || player.riding || this.spaces.isChanging) return false;
    this.changeIn((interior) => interior.wakeTomorrowBehindTheIris(behindTheIris), () => {});
    return true;
  }

  openArea(room: HotelRoom): OpenAreaPoint[] {
    return this.interior?.openArea(room) ?? [];
  }

  releasePlayer(): void {
    this.interior?.releasePlayer();
  }

  wakeNap(): void {
    this.interior?.wakeNap();
  }

  /**
   * The `/hotel` deep link: straight into the lobby from wherever she is.
   * Safe from anywhere, the way the slide's own deep link is: the change
   * happens behind a closed iris and teleports, so it does not care where
   * she was standing when she asked.
   */
  requestEnterLobby(): boolean {
    if (!this.canEnter()) return false;
    this.changeIn((interior) => interior.enterLobby());
    return true;
  }

  /** The `/hotel-bathroom` family of deep links — see `HotelInterior.enterBathroomOf`. */
  requestEnterBathroom(room?: HotelRoom): boolean {
    if (!this.canEnter()) return false;
    if (this.interior && !this.interior.hasBathroom(room)) return false;
    this.changeIn((interior) => interior.enterBathroomOf(room));
    return true;
  }

  /** The `/hotel-breakfast` deep link — see `HotelInterior.enterBreakfastRoom`. */
  requestEnterBreakfast(): boolean {
    if (!this.canEnter()) return false;
    this.changeIn((interior) => interior.enterBreakfastRoom());
    return true;
  }

  /** The `/hotel-cafe` deep link — see `HotelInterior.enterCafe`. */
  requestEnterCafe(): boolean {
    if (!this.canEnter()) return false;
    this.changeIn((interior) => interior.enterCafe());
    return true;
  }

  /** The `/hotel-suite` deep link — see `HotelInterior.enterSuite`. */
  requestEnterSuite(): boolean {
    if (!this.canEnter()) return false;
    this.changeIn((interior) => interior.enterSuite());
    return true;
  }

  // ---------------------------------------------------------------- zones

  /**
   * The tower from outside, before she has ever walked in — GitHub issue
   * #309's "the character can't be sent there at all", for the hotel
   * specifically.
   *
   * One zone covering the whole crystal footprint, so a `ui/ParkMap.ts` tap
   * anywhere on the tower's plot finds it (`Game.useZoneNear`'s
   * `pickInteractZone`, tested against `pickRadius`) rather than getting the
   * flat "can't walk there" a solid collider used to earn. No `actions` —
   * same as `world/building/interactZones.ts`'s own `frontDoor` — because
   * there has never been an "enter the hotel" button to press: walking
   * through the doorway is what has always done it, via
   * {@link checkTowerDoor}'s own crossing trigger, and that fires on the walk
   * itself with no help from this zone.
   *
   * **`standX/standZ` is {@link towerDoorBand}'s own centre — not a second,
   * hand-picked offset.** The first cut placed it 1.5 m *past* the band's
   * inner edge, reasoning that only a point beyond the whole band could force
   * a routed walk to cross it — sound for straight-line steering, wrong for
   * the actual routed walk, which plans on `NavGrid`'s half-metre lattice
   * baked from collision. That lattice has no waypoint past the tower's real
   * back wall, so the route stopped 2.6 m short of the target every time and
   * the doorway's crossing trigger never fired (PR #315 review). The band's
   * centre needs no such offset trick: it is, by construction, inside the band
   * on every axis, so any walk that reaches it has already crossed the band
   * getting there.
   *
   * **`pickRadius` reaches at least as far as {@link entranceX}/{@link
   * entranceZ}** — the exact point `world/anchors.ts` reports as this
   * anchor's `entrance` and `ui/ParkMap.ts` draws the tower's pin at (PR
   * #315's second review: the two were 9.38 m apart on one seed, and a fixed
   * reach fell short of the pin). Derived from the real distance, so it always
   * covers the pin whatever a reseed puts it at; `Math.max` with
   * `TOWER_SHELL_RADIUS` keeps the whole crystal footprint tappable too.
   */
  private exteriorEntranceZone(): InteractZone {
    const band = this.towerDoorBand();
    const entranceReach = Math.hypot(
      this.entranceX - this.facadeX,
      this.entranceZ - this.facadeZ,
    );
    return {
      id: 'hotel-entrance',
      label: 'The Land Hotel',
      x: this.facadeX,
      y: this.surfaces.sample(this.facadeX, this.facadeZ, 3),
      z: this.facadeZ,
      pickRadius: Math.max(TOWER_SHELL_RADIUS, entranceReach) + 1,
      standX: band.centreX,
      standZ: band.centreZ,
    };
  }

  interactZones(): InteractZone[] {
    if (!this.inside) return [this.exteriorEntranceZone()];
    return this.interior?.interactZones() ?? [];
  }

  // -------------------------------------------------------------- frame

  update(context: FrameContext): void {
    const { dt } = context;
    this.spaces.update(dt);
    this.updateOuterDoors(dt);
    if (this.doorLineFor > 0) {
      this.doorLineFor -= dt;
      this.doorBubble.updateScreenSize(this.deps.camera);
      if (this.doorLineFor <= 0) this.doorBubble.setText(null);
    }
    this.interior?.update(context);

    const player = this.player;
    if (!player) return;
    // A save that restored her in a room before the interior was here: in
    // through the door now, behind its iris, which holds until it is built.
    if (this.restorePending && !this.spaces.isChanging) {
      this.restorePending = false;
      // Out of the empty room at once, onto the doormat — where she stays,
      // told why, if the interior cannot be fetched (`refuseDoor`).
      this.collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
      player.teleportTo(this.entranceX, this.surfaces.sample(this.entranceX, this.entranceZ, 3), this.entranceZ, this.facadeYaw);
      this.controls.snapCamera();
      this.changeIn((interior) => interior.enterLobby());
    }
    if (this.inside) return;
    // **Fetch the interior's chunk on approach** — only fetch, not build, so
    // walking up costs nothing; the door then builds it behind its iris
    // without waiting on the network.
    if (!this.interior && Math.hypot(player.position.x - this.facadeX, player.position.z - this.facadeZ) < HOTEL_PREFETCH_RADIUS) {
      HOTEL_INTERIOR.load().catch(() => {
        // The door asks again, and says so if it still cannot.
      });
    }
    if (!this.spaces.isChanging && !player.riding) this.checkTowerDoor(player);
  }

  /**
   * The tower's front-door trigger, in world metres — the same rectangle
   * {@link checkTowerDoor} walks through, published so
   * `scripts/check-tap-spacing.mts` can hold the park's tap targets clear of
   * it. Room doorways get the same treatment from `layout.ts`'s
   * `hotelDoorBands`; this one alone lives here because only the built hotel
   * knows where the solver put its facade.
   */
  towerDoorBand(): PortalBand {
    // **The doorway, as built**, rather than three numbers that have to be
    // kept level with it by hand: from the lobby back wall out to the outer
    // face of the facade she walks through. The old band stopped 0.45 m
    // *inside* the facade plane, so there was a sliver in which she was
    // through the door and the trigger said she was not — the sort of gap
    // between two hand-copied depths this repo has been bitten by six times
    // in a day (CLAUDE.md, "Two definitions of one thing").
    const outer = TOWER_DOOR_BAND_OUTER;
    const centre = (TOWER_BACK_ALONG + outer) / 2;
    return {
      what: "the hotel tower's front door",
      centreX: this.facadeX + Math.sin(this.facadeYaw) * centre,
      centreZ: this.facadeZ + Math.cos(this.facadeYaw) * centre,
      halfAlong: (outer - TOWER_BACK_ALONG) / 2,
      halfAcross: DOOR_HALF + 0.4,
      yaw: this.facadeYaw,
      y: 0,
      // `exteriorEntranceZone`'s `hotel-entrance` zone *is* this door (GitHub
      // issue #309) — same pattern as `Building.ts`'s `castleEntranceBand`.
      // Without this, `scripts/check-tap-spacing.mts` reads the zone's wide
      // `pickRadius` as one zone's pick area eating another's trigger band —
      // which is backwards here: the zone and the band are the same doorway.
      ownZoneId: 'hotel-entrance',
    };
  }

  /**
   * **The front door is one question, asked of the line she just walked**:
   * did that line pass through the door's rectangle? (`bandWalkedThrough`,
   * `world/tapSpacing.ts` — see `HotelInterior.checkDoorways` for why not "is
   * she standing in it".) Every door inside is the interior's.
   */
  private checkTowerDoor(player: Player): void {
    if (this.spaces.settling) return;
    const band = this.towerDoorBand();
    if (this.doorRefused) {
      if (Math.hypot(player.position.x - band.centreX, player.position.z - band.centreZ) > band.halfAlong + DOOR_STEP_AWAY) {
        this.doorRefused = false;
      }
      return;
    }
    if (bandWalkedThrough(band, player)) {
      this.changeIn((interior) => interior.enterLobby());
    }
  }

  // --------------------------------------------------------------- doors

  /**
   * The tower's front doors — Jim: the hotel entrance *"slides open as you
   * approach"*. The lobby's matching pair, on the other side of the portal,
   * is the interior's (`HotelInterior.fitInnerDoors`).
   *
   * **The portal is untouched.** {@link checkTowerDoor} still fires on exactly
   * the same patch of ground it always did; these leaves are decoration in
   * front of a trigger that already worked, opening a good two metres before
   * it. That ordering is the whole design — the doors have to be visibly open
   * by the time she reaches the threshold, or she walks through shut ones.
   */
  private fitOuterDoors(): void {
    // **Measured off the asset, not written down here.** The doorway's own
    // recess panel knows where the doorway is; `hotel_build.py` bakes every
    // placement into vertices and leaves the nodes at identity, so the panel's
    // geometry bounds *are* its position in the tower's frame.
    const tower = this.tower;
    tower.doorGlow.geometry.computeBoundingBox();
    const box = tower.doorGlow.geometry.boundingBox;
    if (!box) return;
    const outside = createEntranceDoors();
    outside.root.position.set((box.min.x + box.max.x) / 2, box.min.y, box.max.z + 0.07);
    outside.setOpen(0);
    // Parented to the tower, so it takes the facade's yaw for free.
    tower.root.add(outside.root);
    this.outerDoors = outside;
  }

  /** The tower's front doors, in the facade's own frame — the same `forward` and `side` the door band is measured in. */
  private updateOuterDoors(dt: number): void {
    const player = this.player;
    if (!player || !this.outerDoors || this.inside) return;
    const dx = player.position.x - this.facadeX;
    const dz = player.position.z - this.facadeZ;
    const forward = dx * Math.sin(this.facadeYaw) + dz * Math.cos(this.facadeYaw);
    const side = dx * Math.cos(this.facadeYaw) - dz * Math.sin(this.facadeYaw);
    const near =
      Math.abs(side) < AUTO_DOOR_SIDE && forward > 3.6 && forward < AUTO_DOOR_REACH + 6.6;
    this.outerOpen = easeDoor(this.outerOpen, near ? 1 : 0, dt);
    this.outerDoors.setOpen(this.outerOpen);
  }
}

/**
 * Moves `current` toward `target` at the automatic doors' own rate — both
 * pairs, the tower's and the lobby's.
 *
 * Framerate-independent and linear rather than exponential, because a door is
 * a motor: it opens at one speed and stops. An eased approach would leave the
 * last centimetre of the leaf creeping for ever, which is exactly what a
 * sliding door does not do.
 */
export function easeDoor(current: number, target: number, dt: number): number {
  const step = dt / AUTO_DOOR_SECONDS;
  if (target > current) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

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

// The tower's shell radius, back wall and facade plane live in a leaf module so
// the park layout can place the doormat at the real door — see its header.
export { TOWER_SHELL_RADIUS, TOWER_BACK_ALONG, TOWER_FACADE_ALONG } from './towerDimensions';

/** The shell walls' own half-thickness. */
const TOWER_SHELL_HALF_THICKNESS = 0.4;

/**
 * Half the doorway's clear width, in metres — where its jambs stand. Wider
 * than the door leaves themselves ({@link DOOR_HALF}) so the aperture is
 * generous to walk at, and it is this, not the octagon's own corners, that
 * says how much of the facade is open.
 */
export const TOWER_DOOR_HALF = DOOR_HALF + 0.5;


/**
 * The tower's collision: a **closed** octagon around the crystal cluster with
 * exactly one hole in it — the doorway, as wide as the gap between its own
 * jambs — plus those jambs and a lobby back wall a couple of metres in.
 * Walking on through the doorway is what enters the hotel, and the back wall
 * is what stops a sprinting child ending up inside solid crystal while the
 * iris closes.
 *
 * ### It was not closed, and a child found it
 *
 * Jim, playing, 9 August 2026: *"the hotel building is not solid, I can walk
 * straight through it."* The ring was built by walking eight sectors and
 * trimming each one's *start* by the door's arc, when only the two sectors
 * beside the doorway ever wanted trimming. Every face therefore began 0.32 rad
 * late and ended on the nominal line, leaving **six 0.32 rad gaps** evenly
 * spaced round the tower — 2.29 m of arc each, 1.49 m of it clear of both
 * walls' half-thickness, against a 1.24 m-wide child. Measured on the built
 * park before the fix: of 48 bearings marched at the facade, 22 got inside the
 * 7.2 m shell and 8 reached the middle of it (radius 0.00 m). The doorway
 * itself was a 1.43 rad hole — 9.4 m of chord for a 2.6 m door — so three
 * quarters of the "doorway" was open wall you could walk in through beside the
 * jambs and miss the entry trigger entirely, which is the other half of what
 * he reported.
 *
 * So it is built as geometry now rather than as trimmed angles: a ring of
 * chords that closes, and one aperture cut in the middle of the face the door
 * is in. `scripts/check-hotel.mts` marches at it from 32 bearings and is the
 * thing that would say so again.
 */
function registerTowerCollision(
  collision: CollisionWorld,
  x: number,
  z: number,
  yaw: number,
  towerHeight: number,
): void {
  // Every wall of the shell stands to the tower's own measured height — a real
  // top, far over anything she can jump to.
  const add = (x1: number, z1: number, x2: number, z2: number, halfThickness: number): void => {
    const top = yAtAltitude((x1 + x2) / 2, (z1 + z2) / 2, towerHeight);
    collision.kinded('hotel tower', () => collision.addWall(x1, z1, x2, z2, halfThickness, top, false, true));
  };
  const R = TOWER_SHELL_RADIUS;
  const SIDES = 8;
  const sector = (Math.PI * 2) / SIDES;

  // The facade's own frame: `along` runs out through the door, `across` it.
  const alongX = Math.sin(yaw);
  const alongZ = Math.cos(yaw);
  const acrossX = Math.sin(yaw + Math.PI / 2);
  const acrossZ = Math.cos(yaw + Math.PI / 2);
  const wall = (
    along1: number,
    across1: number,
    along2: number,
    across2: number,
    halfThickness: number,
  ): void => {
    add(
      x + alongX * along1 + acrossX * across1,
      z + alongZ * along1 + acrossZ * across1,
      x + alongX * along2 + acrossX * across2,
      z + alongZ * along2 + acrossZ * across2,
      halfThickness,
    );
  };

  // Vertices half a sector either side of the door's axis, so the doorway sits
  // in the **middle of one face** rather than straddling a corner: the face it
  // is in is then a chord at a constant distance out
  // ({@link TOWER_FACADE_ALONG}), and the aperture is a plain gap in the
  // middle of it.
  const vertexAcross = R * Math.sin(sector / 2);

  // The seven faces the door is not in — the ring, closed, corner to corner.
  for (let face = 1; face < SIDES; face += 1) {
    const a1 = yaw + (face - 0.5) * sector;
    const a2 = yaw + (face + 0.5) * sector;
    add(
      x + Math.sin(a1) * R,
      z + Math.cos(a1) * R,
      x + Math.sin(a2) * R,
      z + Math.cos(a2) * R,
      TOWER_SHELL_HALF_THICKNESS,
    );
  }

  // The facade itself: the same chord, in two stubs either side of the
  // doorway. `TOWER_DOOR_HALF` (1.80 m) is well inside `vertexAcross`
  // (2.76 m), so each stub is a real 0.96 m of wall meeting its jamb at the
  // corner — and probe 22 in `scripts/check-hotel.mts` is what would notice
  // if a wider door ever turned a stub inside out and reopened the shell.
  for (const side of [-1, 1]) {
    wall(
      TOWER_FACADE_ALONG,
      side * TOWER_DOOR_HALF,
      TOWER_FACADE_ALONG,
      side * vertexAcross,
      TOWER_SHELL_HALF_THICKNESS,
    );
  }

  // The jambs, running from the back wall out past the facade plane, and the
  // lobby back wall across the far end between them.
  for (const side of [-1, 1]) {
    wall(TOWER_BACK_ALONG, side * TOWER_DOOR_HALF, TOWER_JAMB_REACH, side * TOWER_DOOR_HALF, TOWER_JAMB_HALF_THICKNESS);
  }
  wall(TOWER_BACK_ALONG, TOWER_DOOR_HALF, TOWER_BACK_ALONG, -TOWER_DOOR_HALF, 0.35);
}
