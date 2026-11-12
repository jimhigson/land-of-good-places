import { Group, Vector3, type Object3D } from 'three';
import { clearsTop, type CollisionWorld, type WallCollider } from '../Collision';
import type { WalkSurfaces } from '../building/surfaces';
import type { InteriorControls } from '../building/Building';
import type { ShopStand } from '../building/shops/Shops';
import { SpaceManager } from '../SpaceManager';
import { bandWalkedThrough, type PortalBand } from '../tapSpacing';
import { circleBoundary, GARDEN_PLAY_BOUNDARY } from '../boundary';
import { SPACE_REPTILE_FORECOURT, SPACE_REPTILE_HOUSE, spaceAt, type SpaceId } from '../spaces';
import type { OpenAreaPoint } from '../dismount';
import type { InteractZone } from '../interact';
import { pressZone } from '../interact';
import { highlightObject } from '../highlight';
import type { PlacedEntry } from '../parkLayout';
import { standInPlot, type AnchorPlots } from '../AnchorPlots';
import type { Player } from '../../entities/Player';
import type { FrameContext, GameSystem } from '../../core/types';
import type { IsoCamera } from '../../core/IsoCamera';
import { Rng } from '../../core/mathUtils';
import { PALETTE } from '../../core/palette';
import { SpeechBubble } from '../../ui/SpeechBubble';
import { SpritePuffs } from '../../art/effects/spritePuffs';
import type { ManagedLabel } from '../../ui/LabelManager';
import { discoverSecret } from '../../state/secrets';
import { JUMP_APEX_HEIGHT } from '../../entities/Player';
import { SnakeSegmentPool } from '../../art/models/snake';
import {
  createReptileHouseExterior,
  reptileHouseLipsReach,
  reptileHouseLowDiscs,
  reptileHousePlinthTop,
  type ReptileHouseExterior,
} from '../../art/models/reptileHouseAssets';
import { ReptileLighting } from './lighting';
import { SignAtlas } from './signs';
import type { ReptileProps } from './props';
import { ExhibitCamera, REPTILE_HALL as REPTILE_HALL_ROOM } from './exhibitCamera';
import type { ReptileHallContent } from './hall';
import type { HallContext } from './context';
import { REPTILE_HALL } from '../interiors';
import {
  buildForecourt,
  buildHallShell,
  facadeToWorld,
  registerPlinthStep,
  registerReptileRoofCollision,
  registerReptileShellCollision,
  reptileEntryBand,
  reptileExitBand,
  reptileTailBase,
  REPTILE_JAMB_STRIP,
  type FacadeFrame,
} from './shell';
import {
  REPTILE_ARRIVAL_FACING,
  REPTILE_ARRIVAL_X,
  REPTILE_ARRIVAL_Z,
  REPTILE_DOOR_BAND_OUTER,
  REPTILE_LIPS_REACH,
  REPTILE_FOOTPRINT_RADIUS,
  REPTILE_TAIL_BASE_RADIUS,
  REPTILE_TAIL_REACH,
  REPTILE_DOORMAT_STANDOFF,
  REPTILE_ENCLOSURE_WALL_HEIGHT,
  REPTILE_FORECOURT_ORIGIN_X,
  REPTILE_FORECOURT_ORIGIN_Z,
  REPTILE_FORECOURT_RADIUS,
  REPTILE_HOUSE_FLOOR_Y,
  REPTILE_HOUSE_ORIGIN_X,
  REPTILE_HOUSE_ORIGIN_Z,
  REPTILE_HOUSE_PLAY_RADIUS,
  REPTILE_SHELL_RADIUS,
  TORTOISE_RIDE_STAND,
  EXHIBIT_PLACEMENTS,
  type LocalPoint,
} from './layout';

/**
 * **The Reptile House** — Jim, 2 October 2026: *"a new building which is a
 * reptile house … many animals, in a zoo-like format both behind glass and in
 * enclosures without glass but with walls … snakes, including baby snakes of
 * various sizes and a stall where you can buy snake-themed things inside. The
 * outside of the building should be snake-themed too. Inside just one floor
 * but make it expansive with forking and meandering paths, and lots of
 * cultivated tropical and otherwise snake-appropriate vegetation."*
 *
 * ## Two places, one door
 *
 * The exterior — "Sunny", a mint snake coiled round a cream greenhouse — stands
 * wherever the park puts it, and the hall she walks into is a disjoint space
 * 600 m east and 600 m north of the park (`layout.ts`), a hotel room in
 * shape: one flat plate, open-topped for the camera, entered and left through
 * `SpaceManager.changeTo` on a swept `PortalBand`. `Hotel.ts` is the precedent
 * for every one of those moves and they are copied here with new numbers.
 *
 * **The park places the exterior** (`World` passes `placedEntry('reptileHouse')`); without a plot it stands on the forecourt:
 * its own flat lawn, another disjoint space 300 m south of the hall, where
 * `/reptile-house-door` puts her on the doormat and where leaving the hall
 * comes back out to. So the door works both ways on a park that has not
 * placed the building, and the placement agents' manifest entry moves the
 * exterior into the park without touching anything in here but `plot`.
 *
 * ## What is solid
 *
 * Everything drawn. The exterior is a closed 16-gon with one aperture; inside,
 * every case, enclosure, bed, post, pot, log and the stall counter goes
 * through {@link ReptileProps}, which refuses a collider on any spot
 * {@link reptileKeepOuts} says she must be able to stand on, and nothing is a
 * rectangle with a hollow middle. `scripts/check-reptile-house.mts` floods
 * the floor from the arrival point, marches at the shell from thirty-two
 * bearings, and sweeps every path for its width.
 */
export interface ReptileHouseDeps {
  /** The park's plot for the exterior, or `null` while there is none. */
  readonly plot: PlacedEntry | null;
  /**
   * The park's reserved plots: with a `plot`, the exterior stands in
   * `anchor:reptileHouse` on the sphere (`standInPlot`), exactly as the
   * hotel's tower does, and the plot's "coming soon" placeholder goes.
   */
  readonly anchorPlots: AnchorPlots | null;
  /** For sizing speech bubbles on screen. */
  readonly camera: IsoCamera;
  /** The park's night, 0..1 — the portholes glow and Sunny sleeps. */
  nightFactor(): number;
}

/** How near the building she must be for its hall's chunk to be fetched ahead of the door, in metres. */
const REPTILE_PREFETCH_RADIUS = 18;

/** The exit chip and the tail-tickle chip's ids. */
const ENTRANCE_ZONE = 'reptile-entrance';

export class ReptileHouse implements GameSystem {
  readonly name = 'reptileHouse';
  /** The hall, at the hall origin, hidden unless she is inside. */
  readonly hallRoot = new Group();
  /** The forecourt lawn and the exterior on it, hidden unless she is there. */
  readonly forecourtRoot = new Group();
  /** The exterior's root in the park, when the park has a plot for it. */
  readonly parkRoot = new Group();
  /** The exterior shell's wall colliders, chords first, so a check can remove one and go red. */
  readonly shellSolids: readonly WallCollider[];

  private readonly collision: CollisionWorld;
  private readonly controls: InteriorControls;
  private readonly surfaces: WalkSurfaces;
  private readonly deps: ReptileHouseDeps;
  private readonly spaces: SpaceManager;
  /**
   * The hall's floor — cases, enclosures, planting, the stall, the tortoise —
   * or `null` until she first walks in: it is a lazy chunk
   * (`world/interiors.ts`'s `REPTILE_HALL`, `hall.ts`). Built in the
   * constructor when the chunk is already here (Node's checks, and a boot that
   * restores or deep-links into the hall), otherwise behind the door's iris.
   */
  private hall: ReptileHallContent | null = null;
  /**
   * Where a save restored her in the hall, hall-local, when the hall's floor
   * was not here to restore her into (`adoptRestoredPlayer`): she is taken in
   * through the door on the first frame, once it is.
   */
  private restoreInto: { readonly x: number; readonly z: number; readonly facing: number } | null = null;
  /** Everything the hall's floor is built with but the props, which it makes itself. */
  private readonly hallContext: Omit<HallContext, 'props'>;
  /** The over-the-shoulder shot an exhibit's chip brings the camera down to. */
  readonly exhibitCamera: ExhibitCamera;
  private readonly exterior: ReptileHouseExterior;
  private readonly frame: FacadeFrame;
  /** Every line the hall says — an answer to a press, so `actionFeedback`. Its item is set per line. */
  private readonly bubble = new SpeechBubble({ id: 'reptile-house-say', item: '', kind: 'actionFeedback' }, PALETTE.markerMint);
  /** Hearts over whatever was just greeted — `art/effects/spritePuffs.ts`, the reptile house's own pink at 0.35. */
  private readonly hearts: SpritePuffs;
  private readonly rng = new Rng(0x5e7a1e);
  private player: Player | null = null;
  private inside = false;
  private onForecourt = false;
  private bubbleFor = 0;
  private tickle = 0;
  private lastSaid = '';

  constructor(collision: CollisionWorld, controls: InteriorControls, surfaces: WalkSurfaces, deps: ReptileHouseDeps) {
    this.collision = collision;
    this.controls = controls;
    this.surfaces = surfaces;
    this.deps = deps;
    this.spaces = new SpaceManager(controls);

    // The engine's own rule, not a copy of it: `clearsTop` is what the
    // resolver asks, grace included, so a wall it would let a body at the
    // apex over is a wall a child jumps into and never gets out of.
    if (clearsTop(REPTILE_ENCLOSURE_WALL_HEIGHT, JUMP_APEX_HEIGHT)) {
      throw new Error(
        `Reptile House: the open enclosures' ${REPTILE_ENCLOSURE_WALL_HEIGHT} m walls are cleared by a jump ` +
          `(apex ${JUMP_APEX_HEIGHT.toFixed(2)} m plus the resolver's grace) — a child could jump in and never get out.`,
      );
    }

    // ---------------------------------------------------------- the hall
    this.hallRoot.name = 'the-reptile-house-inside';
    this.hallRoot.position.set(REPTILE_HOUSE_ORIGIN_X, REPTILE_HOUSE_FLOOR_Y, REPTILE_HOUSE_ORIGIN_Z);
    this.hallRoot.visible = false;
    this.hallRoot.add(new ReptileLighting(0, 0).group);
    buildHallShell(this.hallRoot, collision, surfaces);
    const atlas = new SignAtlas();
    this.hearts = new SpritePuffs(this.hallRoot, 12);
    this.hallRoot.add(this.bubble.sprite);
    const adults = new SnakeSegmentPool(this.hallRoot, 260, 'reptile-adults');
    const babies = new SnakeSegmentPool(this.hallRoot, 200, 'reptile-babies');
    this.hallContext = {
      root: this.hallRoot,
      atlas,
      adults,
      babies,
      rng: this.rng,
      say: (item: string, text: string, at: LocalPoint, y: number) => this.say(item, text, at, y),
      hearts: (at: LocalPoint, y: number) => this.hearts.puff(at.x, y, at.z, this.rng),
      greet: (id: string) => this.onGreet(id),
      findBaby: () => this.onBabyFound(),
      openShop: (shopId: string) => this.controls.openShop(shopId),
      // Hat and all — `topHeight` is what the name label clears, so the
      // Noodle-o-meter answers differently in a tall hat (the spec's "she
      // tries them all"); `model.height` is the bare rig and never moves.
      playerHeight: () => this.player?.topHeight ?? 0,
    };
    // The snake pools are animals, every one of them — a body is never an
    // obstacle to seeing an animal.
    this.exhibitCamera = new ExhibitCamera({ hall: this.hallRoot, collision, camera: deps.camera, seeThrough: [...adults.meshes, ...babies.meshes], room: REPTILE_HALL_ROOM });
    // The floor, now, if its chunk is already here — in the order it was
    // always built, before the outside; otherwise on the way in.
    this.furnishIfLoaded();

    // ------------------------------------------------------- the outside
    this.exterior = createReptileHouseExterior();
    this.forecourtRoot.name = 'the-reptile-house-forecourt';
    this.forecourtRoot.position.set(REPTILE_FORECOURT_ORIGIN_X, REPTILE_HOUSE_FLOOR_Y, REPTILE_FORECOURT_ORIGIN_Z);
    this.forecourtRoot.visible = false;
    const plot = deps.plot;
    if (plot) {
      // The park's plot: the facade faces its doormat, as the hotel's does.
      this.frame = { x: plot.x, z: plot.z, yaw: Math.atan2(plot.entranceX - plot.x, plot.entranceZ - plot.z) };
      if (!deps.anchorPlots) throw new Error('ReptileHouse: a park plot needs the park\'s AnchorPlots to stand in');
      // The plot's own origin is the ground under the building, leant to the
      // local up; `standInPlot` carries the world transform back through it,
      // so the plinth stands on the sphere rather than at world y 0 (the
      // hotel's 13 Sep "floating in space" fix, Hotel.ts).
      const group = deps.anchorPlots.getGroup('reptileHouse');
      this.parkRoot.name = 'the-reptile-house-outside';
      standInPlot(group, this.parkRoot, plot.x, plot.z, 0, 0);
      this.exterior.root.rotation.y = this.frame.yaw;
      this.parkRoot.add(this.exterior.root);
      group.add(this.parkRoot);
      deps.anchorPlots.setPlaceholderVisible('reptileHouse', false);
    } else {
      this.frame = { x: REPTILE_FORECOURT_ORIGIN_X, z: REPTILE_FORECOURT_ORIGIN_Z, yaw: 0 };
      buildForecourt(this.forecourtRoot, surfaces, REPTILE_FORECOURT_ORIGIN_X, REPTILE_FORECOURT_ORIGIN_Z, this.frame);
      this.forecourtRoot.add(this.exterior.root);
    }
    // `REPTILE_LIPS_REACH` is what the park's doormat is placed from, so hold
    // it to the mesh: nothing solid round the mouth may reach past it.
    const lowDiscs = reptileHouseLowDiscs(REPTILE_JAMB_STRIP);
    const lipsReach = reptileHouseLipsReach();
    const mouthReach = Math.max(
      lipsReach,
      ...lowDiscs.filter((disc) => disc.z > 0 && Math.abs(disc.x) < REPTILE_JAMB_STRIP + 2).map((disc) => disc.z + disc.radius),
    );
    if (REPTILE_FOOTPRINT_RADIUS < REPTILE_TAIL_REACH + REPTILE_TAIL_BASE_RADIUS) {
      throw new Error('ReptileHouse: REPTILE_FOOTPRINT_RADIUS does not cover the tail base — paths would pave under it');
    }
    if (mouthReach > REPTILE_LIPS_REACH) {
      throw new Error(`ReptileHouse: the mouth reaches ${mouthReach.toFixed(2)} m, past REPTILE_LIPS_REACH ${REPTILE_LIPS_REACH} — raise it in layout.ts`);
    }
    this.shellSolids = registerReptileShellCollision(collision, this.frame, lowDiscs, lipsReach);
    registerReptileRoofCollision(collision, this.frame);
    registerPlinthStep(surfaces, this.frame, reptileHousePlinthTop());
    atlas.applyTo(this.exterior.sign);
  }

  // --------------------------------------------------------------- state

  /** Inside the hall: the sky's lights go off and the hall lights itself. */
  get playerIsInside(): boolean {
    return this.inside;
  }

  /**
   * Where she stands outside the door: the park plot's doormat (the one the
   * paths are routed to), or the forecourt's without a plot. The one owner —
   * `/reptile-house-door`, the hall's exit and `check:deep-links` all ask it.
   */
  get doormat(): { readonly x: number; readonly z: number } {
    const plot = this.deps.plot;
    if (plot) return { x: plot.entranceX, z: plot.entranceZ };
    return facadeToWorld(this.frame, REPTILE_DOOR_BAND_OUTER + REPTILE_DOORMAT_STANDOFF, 0);
  }

  /** Where the exterior stands and faces — for the checks and the door band. */
  get facade(): FacadeFrame {
    return this.frame;
  }

  /** True once the hall's floor has been built (`hall.ts`). */
  get furnished(): boolean {
    return this.hall !== null;
  }

  /**
   * Fetches the hall's floor and builds it, if nobody has. The door does this
   * behind its iris; anything else that wants the hall furnished (a check
   * driving a served build) can ask for it directly.
   */
  furnish(): Promise<void> {
    if (this.hall) return Promise.resolve();
    return REPTILE_HALL.load().then(() => this.furnishIfLoaded());
  }

  /** The two shop stands — the stall's and the nursery's — for `World.shopStands()`. None until the hall is furnished. */
  get stands(): readonly ShopStand[] {
    return this.hall?.stall.stands ?? [];
  }

  get exhibitsGreeted(): number {
    return this.hall?.exhibits.exhibitsGreeted ?? 0;
  }

  get babiesFound(): number {
    return this.hall?.exhibits.babiesFound ?? 0;
  }

  /** Every exhibit's id, in table order — for `check:exhibit-camera`. */
  get exhibitIds(): readonly string[] {
    return this.hall?.exhibits.ids ?? [];
  }

  /** The animals an exhibit's shot frames — for `check:exhibit-camera`. */
  exhibitSubjects(id: string): readonly Object3D[] {
    return this.hall?.exhibits.subjectsOf(id) ?? [];
  }

  /** Every animal in an exhibit, for `check:exhibit-camera`. */
  exhibitCast(id: string): readonly Object3D[] {
    return this.hall?.exhibits.castOf(id) ?? [];
  }

  /** Every animal's hall-local spot with its exhibit, for the check. */
  animalSpots(): { id: string; x: number; z: number }[] {
    return this.hall?.exhibits.animalSpots() ?? [];
  }

  /** Every solid the hall registered, with its collision handle — so a check can remove one and go red. */
  get solids(): ReptileProps['solids'] {
    return this.hall?.props.solids ?? [];
  }

  /** The hall's one bubble, for `World` to register with the park's `LabelManager`. */
  get screenLabels(): readonly ManagedLabel[] {
    return [this.bubble];
  }

  /** The last line a bubble was asked to say — for the checks, which cannot read a sprite. */
  get lastBubble(): string {
    return this.lastSaid;
  }

  attachPlayer(player: Player): void {
    this.player = player;
    this.hall?.ride.attachPlayer(player);
  }

  /** On the tortoise's shell, mid-lap — for the checks and `Game`'s tap handler. */
  get playerOnTortoise(): boolean {
    return this.hall?.ride.playerRiding ?? false;
  }

  /** The tortoise back in its bay, solid — for the check. True before the hall is furnished: it has not left it. */
  get tortoiseParked(): boolean {
    return this.hall?.ride.parked ?? true;
  }

  /** A tap anywhere while she is on the tortoise: off it, walking. */
  dismountTortoise(): void {
    this.hall?.ride.dismount();
  }

  /**
   * Adopt a player restored into the hall or onto the forecourt — being there
   * is a position plus the root switched on and the bounds bound, none of
   * which a constructor can do. A no-op for a park spawn.
   */
  adoptRestoredPlayer(): void {
    const player = this.player;
    if (!player) return;
    const space = spaceAt(player.position.x, player.position.z);
    // Each place clears the other: the flags are what `interactZones` keys
    // on, and a probe adopted into the hall and then onto the forecourt (as
    // `check:tap-spacing` does) must get the forecourt's two zones, not the
    // hall's twenty a second time.
    if (space === SPACE_REPTILE_HOUSE) {
      // `main.ts` loads the hall's chunk before the game is built for a save
      // that restores in here (`interiorsToPreload`), so it is furnished by
      // now. If it is not — that load failed, or timed out — she is **never**
      // put in the hall to have its floor built round her: a prop's collider
      // registered on top of her is a box she can never leave. She waits on
      // the doormat instead, and goes in through the door, behind its iris,
      // to the spot she saved at, once the floor is built (`update`).
      if (!this.hall) {
        console.error('Land of Good Places: restored into the Reptile House hall before its floor was loaded — see interiorsToPreload in world/interiors.ts. She waits at the door.');
        this.restoreInto = {
          x: player.position.x - REPTILE_HOUSE_ORIGIN_X,
          z: player.position.z - REPTILE_HOUSE_ORIGIN_Z,
          facing: (player.facing * 180) / Math.PI,
        };
        this.standAtDoor();
        return;
      }
      this.inside = true;
      this.onForecourt = false;
      this.hallRoot.visible = true;
      this.forecourtRoot.visible = false;
      this.boundToHall();
      this.spaces.holdOff();
      this.warmExhibitCamera();
    } else if (space === SPACE_REPTILE_FORECOURT) {
      this.inside = false;
      this.onForecourt = true;
      this.hallRoot.visible = false;
      this.forecourtRoot.visible = true;
      this.boundToForecourt();
      this.spaces.holdOff();
    }
  }

  // --------------------------------------------------------------- doors

  /**
   * `/reptile-house`, and `/reptile-house?at=x,z&facing=deg`: straight into
   * the hall — **from anywhere, the hall included.** A save written inside
   * the hall restores her there (`adoptRestoredPlayer`) before the link
   * runs, and a link that then refused because she was "already inside" left
   * her wherever the save had put her, with a console error, on every
   * returning profile (the art review's run, 2 October 2026). Already in,
   * the change of space is a teleport to the asked-for spot, or back to the
   * arrival for the plain link — the hotel's lobby link's shape.
   */
  requestEnter(at?: { readonly x: number; readonly z: number; readonly facing?: number }): boolean {
    const player = this.player;
    if (!player || player.riding || this.spaces.isChanging) return false;
    this.changeToHall(() => this.enterHall(at));
    return true;
  }

  /**
   * `/tortoise-ride`: into the hall at the ride's stand spot and straight
   * onto the tortoise — boarded inside the iris, after the teleport, since
   * `requestEnter` returns before the change of space has happened.
   */
  requestTortoiseRide(): boolean {
    const player = this.player;
    if (!player || player.riding || this.spaces.isChanging) return false;
    this.changeToHall(() => {
      this.enterHall(TORTOISE_RIDE_STAND);
      this.hall?.ride.requestBoard();
    });
    return true;
  }

  /** `/reptile-house-door`: outside, on the doormat, facing the door. */
  requestEnterDoor(): boolean {
    const player = this.player;
    if (!player || player.riding || this.spaces.isChanging) return false;
    this.spaces.changeTo(() => this.standAtDoor());
    return true;
  }

  /** The front door's band and the hall's exit, for the tap-spacing check and the invariants. */
  doorBands(): PortalBand[] {
    return [reptileEntryBand(this.frame), reptileExitBand()];
  }

  interactZones(): InteractZone[] {
    if (this.inside) return this.hall ? [...this.hall.exhibits.zones(), ...this.hall.stall.zones(), ...this.hall.ride.zones()] : [];
    if (this.onForecourt || this.deps.plot) return [this.exteriorEntranceZone(), this.tailZone()];
    return [];
  }

  update(context: FrameContext): void {
    const { dt, elapsed } = context;
    this.spaces.update(dt);
    const player = this.player;

    if (this.inside) {
      const local: LocalPoint | null = player ? { x: player.position.x - REPTILE_HOUSE_ORIGIN_X, z: player.position.z - REPTILE_HOUSE_ORIGIN_Z } : null;
      const hall = this.hall;
      if (hall) hall.exhibits.update(dt, elapsed, local);
      if (player) this.exhibitCamera.update(dt, context.input, player, true, this.bubbleFor);
      if (hall) {
        hall.stall.update(dt, elapsed);
        hall.ride.update(dt, elapsed, context.input);
      }
      this.hearts.update(dt);
      if (this.bubbleFor > 0) {
        this.bubbleFor -= dt;
        if (this.bubbleFor <= 0) this.bubble.setText(null);
        else this.bubble.updateScreenSize(this.deps.camera);
      }
    }

    if (this.onForecourt || this.deps.plot) {
      this.exterior.setNight(this.deps.nightFactor());
      // The head is the door now, so it only ever tilts a few hundredths of
      // a radian — the lips stay on the jambs' colliders — and the tongue,
      // which is the doormat, wags at its root rather than vanishing.
      if (this.tickle > 0) {
        this.tickle = Math.max(0, this.tickle - dt);
        const t = this.tickle / 2;
        this.exterior.head.rotation.z = Math.sin(t * Math.PI * 3) * 0.03;
        this.exterior.tongue.rotation.y = Math.sin(t * Math.PI * 6) * 0.1;
        this.exterior.setFace(t > 0.3 ? 'happy' : 'neutral');
      } else {
        this.exterior.head.rotation.z = Math.sin(elapsed * 0.4) * 0.008;
        this.exterior.tongue.rotation.y = 0;
      }
    }

    if (!player) return;
    // A save that restored her in the hall before its floor was here: in
    // through the door now, behind its iris, which holds until it is built.
    const restore = this.restoreInto;
    if (restore && !this.spaces.isChanging) {
      this.restoreInto = null;
      this.changeToHall(() => this.enterHall(restore));
    }
    // **Fetch the hall's chunk on approach** — only fetch, not build, so
    // walking up costs nothing; the door then builds it behind its iris
    // without waiting on the network. Entering is still what furnishes it.
    if (!this.hall && !this.inside && Math.hypot(player.position.x - this.frame.x, player.position.z - this.frame.z) < REPTILE_PREFETCH_RADIUS) {
      REPTILE_HALL.load().catch(() => {
        // The door asks again, and says so if it still cannot.
      });
    }
    if (!this.spaces.isChanging && !player.riding) this.checkDoorways(player);

    // Nobody falls out of the world: a slipped trigger lands her back at the arrival.
    if (this.inside && !this.spaces.isChanging && player.position.y < -2) { // flat-ok: two metres under the hall floor; the reptile house is its own flat space at x 600, floor y 0, off the sphere
      player.teleportTo(REPTILE_HOUSE_ORIGIN_X + REPTILE_ARRIVAL_X, REPTILE_HOUSE_FLOOR_Y, REPTILE_HOUSE_ORIGIN_Z + REPTILE_ARRIVAL_Z, Math.PI);
      this.controls.snapCamera();
    }
  }

  dispose(): void {
    this.bubble.setText(null);
  }

  // ------------------------------------------------------------ private

  private checkDoorways(player: Player): void {
    // The path she took this frame, stride by stride on a dash — see
    // `tapSpacing.ts`'s `bandWalkedThrough`.
    if (!this.inside) {
      // The cooldown guards the band that just fired: she is put down on the
      // doormat a stride outside the entry band, and must not be pulled
      // straight back in. Inside, the arrival is 1.6 m from the exit band, so
      // the exit is checked from the first frame — a child who arrives and
      // immediately pushes down used to walk off the plate and be popped back
      // to the arrival (the solidity review, 2 October 2026).
      if (this.spaces.settling) return;
      if (bandWalkedThrough(reptileEntryBand(this.frame), player)) {
        this.changeToHall(() => this.enterHall());
      }
      return;
    }
    if (bandWalkedThrough(reptileExitBand(), player)) {
      this.spaces.changeTo(() => this.leaveToOutside());
    }
  }

  private enterHall(at?: { readonly x: number; readonly z: number; readonly facing?: number }): void {
    const player = this.player;
    if (!player) return;
    this.inside = true;
    this.onForecourt = false;
    this.hallRoot.visible = true;
    this.forecourtRoot.visible = false;
    this.boundToHall();
    const x = at ? at.x : REPTILE_ARRIVAL_X;
    const z = at ? at.z : REPTILE_ARRIVAL_Z;
    const facing = ((at?.facing ?? REPTILE_ARRIVAL_FACING) * Math.PI) / 180;
    player.teleportTo(REPTILE_HOUSE_ORIGIN_X + x, REPTILE_HOUSE_FLOOR_Y, REPTILE_HOUSE_ORIGIN_Z + z, facing);
    this.warmExhibitCamera();
  }

  /**
   * **The Reptile House's open area**, for the put-down rule
   * (`world/dismount.ts`): in the hall, where she arrives through the door; on
   * the forecourt, the doormat. World metres.
   */
  openArea(space: SpaceId): OpenAreaPoint[] {
    if (space === SPACE_REPTILE_HOUSE) {
      return [{ x: REPTILE_HOUSE_ORIGIN_X + REPTILE_ARRIVAL_X, z: REPTILE_HOUSE_ORIGIN_Z + REPTILE_ARRIVAL_Z }];
    }
    return [this.doormat];
  }

  /**
   * **She has been taken somewhere else, behind an iris somebody else is
   * running** — the "Next day" button, from the hall or the forecourt. The
   * building stops being where she is, as walking out would leave it: both
   * rooms hidden, the exhibit shot and the keeper's words stopped. No teleport
   * and no play bounds; the space she was taken to owns both.
   */
  releasePlayer(): void {
    if (!this.inside && !this.onForecourt) return;
    this.inside = false;
    this.onForecourt = false;
    this.exhibitCamera.cancel();
    this.hallRoot.visible = false;
    this.forecourtRoot.visible = false;
    this.bubble.setText(null);
  }

  /** Out through the door: into the park at the plot's doormat, or onto the forecourt. */
  private leaveToOutside(): void {
    const player = this.player;
    if (!player) return;
    this.inside = false;
    this.exhibitCamera.cancel();
    this.hallRoot.visible = false;
    this.bubble.setText(null);
    const plot = this.deps.plot;
    if (plot) {
      this.collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
      player.teleportTo(plot.entranceX, this.surfaces.sample(plot.entranceX, plot.entranceZ, 3), plot.entranceZ, this.frame.yaw);
      return;
    }
    this.standAtDoor(this.frame.yaw);
  }

  /** On the doormat outside the door — the park plot's, or the forecourt's — facing the door. */
  private standAtDoor(facing = this.frame.yaw + Math.PI): void {
    const player = this.player;
    if (!player) return;
    this.inside = false;
    this.hallRoot.visible = false;
    const mat = this.doormat;
    if (this.deps.plot) {
      this.collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
      player.teleportTo(mat.x, this.surfaces.sample(mat.x, mat.z, 3), mat.z, facing);
      return;
    }
    this.onForecourt = true;
    this.forecourtRoot.visible = true;
    this.boundToForecourt();
    player.teleportTo(mat.x, REPTILE_HOUSE_FLOOR_Y, mat.z, facing);
  }

  /** Every exhibit's shot, solved in the background from its stand spot (`ExhibitCamera.warm`). */
  private warmExhibitCamera(): void {
    this.exhibitCamera.warm(
      EXHIBIT_PLACEMENTS.map((placement) => ({
        id: placement.id,
        subjects: () => this.exhibitSubjects(placement.id),
        cast: () => this.exhibitCast(placement.id),
        at: new Vector3(REPTILE_HOUSE_ORIGIN_X + placement.stand.x, REPTILE_HOUSE_FLOOR_Y, REPTILE_HOUSE_ORIGIN_Z + placement.stand.z),
        facing: (placement.stand.facing * Math.PI) / 180,
      })),
    );
  }

  private boundToHall(): void {
    this.collision.setPlayBounds(circleBoundary(REPTILE_HOUSE_PLAY_RADIUS, REPTILE_HOUSE_ORIGIN_X, REPTILE_HOUSE_ORIGIN_Z));
  }

  private boundToForecourt(): void {
    this.collision.setPlayBounds(circleBoundary(REPTILE_FORECOURT_RADIUS, REPTILE_FORECOURT_ORIGIN_X, REPTILE_FORECOURT_ORIGIN_Z));
  }

  /**
   * The building from outside, before she has walked in: one zone covering
   * the whole footprint, no actions (walking through the doorway is what
   * enters, via {@link checkDoorways}), stand spot the band's own centre —
   * `Hotel.exteriorEntranceZone`'s shape and reasoning.
   */
  private exteriorEntranceZone(): InteractZone {
    const band = reptileEntryBand(this.frame);
    // The tail's own "Tickle tail!" zone stands at `REPTILE_TAIL_REACH`, so the
    // pick area stops a finger short of it (the tap-spacing rule) — in the
    // park as on the forecourt. Reaching out to the doormat as the hotel's
    // does put the tail inside it (seed 5 restart 4: 'reptile-entrance' and
    // 'reptile-tail' 0.00 m apart); the doormat is walked onto, not tapped.
    const pickRadius = REPTILE_SHELL_RADIUS + 0.6;
    return {
      id: ENTRANCE_ZONE,
      label: 'Reptile House',
      x: this.frame.x,
      y: this.surfaces.sample(this.frame.x, this.frame.z, 3),
      z: this.frame.z,
      pickRadius,
      standX: band.centreX,
      standZ: band.centreZ,
    };
  }

  /** "Tickle tail!" at the signpost: Sunny's head tilts, her eyes go happy and her tongue wags. */
  private tailZone(): InteractZone {
    const base = reptileTailBase(this.frame);
    const stand = facadeToWorld(this.frame, REPTILE_DOOR_BAND_OUTER + REPTILE_DOORMAT_STANDOFF, 2.6);
    return pressZone(
      {
        id: 'reptile-tail',
        label: "Sunny's tail",
        x: base.x,
        y: this.surfaces.sample(base.x, base.z, 3) + 1,
        z: base.z,
        pickRadius: 2.2,
        standX: stand.x,
        standZ: stand.z,
        verb: 'Tickle tail',
        highlight: highlightObject(this.exterior.tail),
      },
      () => {
        this.tickle = 2;
      },
      '🐍',
      'Tickle tail!',
    );
  }

  private say(item: string, text: string, at: LocalPoint, y: number): void {
    this.lastSaid = text;
    this.bubble.identity.item = item;
    this.bubble.anchorAt(at.x, y, at.z);
    this.bubble.setText(text);
    this.bubbleFor = 1.6 + text.length * 0.07;
  }

  private onGreet(id: string): void {
    const player = this.player;
    if (player && this.inside) this.exhibitCamera.start(id, this.exhibitSubjects(id), this.exhibitCast(id), player);
    if (this.exhibitsGreeted >= 15) discoverSecret('secret.metTheReptiles');
  }

  private onBabyFound(): void {
    if (this.babiesFound >= 5) discoverSecret('secret.snakeSpotter');
  }

  /** Builds the hall's floor if its chunk is here and nobody has yet. */
  private furnishIfLoaded(): void {
    const module = REPTILE_HALL.loaded;
    if (this.hall || !module) return;
    this.hall = this.collision.ownedBy('reptile house', () => module.furnishReptileHall(this.collision, this.controls, this.hallContext));
    if (this.player) this.hall.ride.attachPlayer(this.player);
  }

  /** Into the hall, fetching and building its floor behind the iris first if it is not here yet. */
  private changeToHall(midpoint: () => void): void {
    this.spaces.changeToFurnished(() => this.hall !== null, () => this.furnish(), midpoint);
  }
}

/** The hall's local point of a world position, for anything that asks from outside. */
export function reptileHouseLocal(position: Vector3): LocalPoint {
  return { x: position.x - REPTILE_HOUSE_ORIGIN_X, z: position.z - REPTILE_HOUSE_ORIGIN_Z };
}
