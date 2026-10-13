import { Group, Vector3 } from 'three';
import type { CollisionWorld, WallCollider } from '../Collision';
import type { WalkSurfaces } from '../building/surfaces';
import type { InteriorControls } from '../building/Building';
import { SpaceManager } from '../SpaceManager';
import { bandCrossed, type PortalBand } from '../tapSpacing';
import { circleBoundary, GARDEN_PLAY_BOUNDARY } from '../boundary';
import { SPACE_LIBRARY, spaceAt } from '../spaces';
import type { InteractZone } from '../interact';
import type { PlacedEntry } from '../parkLayout';
import { standInPlot, type AnchorPlots } from '../AnchorPlots';
import { terrainHeight } from '../terrain';
import type { Player } from '../../entities/Player';
import type { FrameContext, GameSystem } from '../../core/types';
import type { IsoCamera } from '../../core/IsoCamera';
import type { ManagedLabel } from '../../ui/LabelManager';
import { createLibraryExterior, measureLibraryExterior, type LibraryExterior, type LibraryExteriorPlan } from '../../art/models/libraryAssets';
import { LibraryLighting } from './lighting';
import { LibraryProps, type LibrarySolid } from './props';
import { furnishReadingRoom, type StackFader } from './furnish';
import {
  buildReadingRoomShell,
  libraryEntryBand,
  libraryExitBand,
  LibraryFrame,
  registerLibraryShellCollision,
  registerLibrarySteps,
} from './shell';
import {
  LIBRARY_ARRIVAL,
  LIBRARY_BOUNDING_RADIUS,
  LIBRARY_CELLA_FRONT_Z,
  LIBRARY_FLOOR_Y,
  LIBRARY_FOOTPRINT_RADIUS,
  LIBRARY_ORIGIN_X,
  LIBRARY_ORIGIN_Z,
  LIBRARY_PLAY_RADIUS,
  LIBRARY_PLINTH_HALF_X,
  LIBRARY_PLINTH_HALF_Z,
  LIBRARY_PLINTH_TOP,
  LIBRARY_RECESS_BACK_Z,
  LIBRARY_STEPS_FRONT_Z,
  type LocalPoint,
} from './layout';

/**
 * **The Library** (#714, part 2: #716) — Jim, 13 October 2026: *"a library,
 * including many readable books, a librarian, and many other cute features and
 * a dimly lit atmosphere. Just one floor with shelves of many books."*
 *
 * ## Two places, one door
 *
 * The exterior — a classic pillared library in toy proportions: two full-width
 * steps, six fat columns, an entablature and a pediment with a book carved in
 * it — stands on the park's `library` plot, turned to face the camera. Its
 * arched door is the one way in: walking through it (a swept `PortalBand`,
 * `bandCrossed` against `Player.previousPosition`, so a long frame cannot skip
 * it) changes space through `SpaceManager` into the reading room, a disjoint
 * flat space at (-600, -600) — a hotel room in shape, open-topped for the
 * camera, 36 x 26 m behind an 18 x 14 m facade. Walking out of the room's
 * doorway puts her back on the plot's doormat. `Hotel.ts` and
 * `ReptileHouse.ts` are the precedent for every one of those moves.
 *
 * ## What is solid
 *
 * Everything drawn. Outside: the cella is a closed ring of colliders with one
 * aperture, the door's recess (enterable, leavable), the six columns their
 * bases, and the plinth and step are surfaces she walks up. Inside: every
 * bookcase, the desk, every chair, lamp and table goes through
 * {@link LibraryProps}, which refuses a collider on any spot `libraryKeepOuts`
 * says she must stand on, and nothing is a rectangle with a hollow middle.
 * `scripts/check-library.mts` floods the floor from the arrival (with a
 * control first), marches at the facade from forty-eight bearings, and walks
 * the door both ways.
 *
 * ## What later PRs add (#714 parts 3-5)
 *
 * The twelve readable books stand in `LIBRARY_READABLE_SLOTS` (#718: a gap is
 * already left on each shelf), the owl librarian behind the desk at
 * `LIBRARY_LIBRARIAN_SPOT`, and the secret den behind `LIBRARY_SECRET_BOOKCASE`
 * (#719). Their stand spots are kept clear today.
 */
export interface LibraryDeps {
  /** The park's plot for the building. */
  readonly plot: PlacedEntry;
  /** The park's reserved plots: the exterior stands in `anchor:library`, leant to the sphere. */
  readonly anchorPlots: AnchorPlots;
  /** For the stacks' sightline fade. */
  readonly camera: IsoCamera;
}

/** The exterior's tap zone's id — and its band's own zone. */
const ENTRANCE_ZONE = 'library-entrance';

/** How translucent a stack goes while it hides her: never gone, just out of the way. */
const STACK_FADED_ALPHA = 0.28;

export class Library implements GameSystem {
  readonly name = 'library';
  /** The reading room, at its own origin, hidden unless she is inside. */
  readonly roomRoot = new Group();
  /** The building in the park, inside `anchor:library`. */
  readonly parkRoot = new Group();
  /** The building's frame and the plan measured off its model — for the checks. */
  readonly frame: LibraryFrame;
  readonly plan: LibraryExteriorPlan;
  /** The exterior's ring walls (registration order) and column discs — so a check can open one and go red. */
  readonly shellSolids: { readonly walls: readonly WallCollider[]; readonly columns: readonly number[] };
  /** The reading room's own four walls' colliders. */
  readonly roomWalls: readonly WallCollider[];
  /** Every free-standing stack and its fade. */
  readonly stacks: readonly StackFader[];
  /** How many decorative books the shelves hold. */
  readonly bookCount: number;
  /** The room's light rig — for the checks (no black light, the darkest floor). */
  readonly lighting: LibraryLighting;

  private readonly collision: CollisionWorld;
  private readonly controls: InteriorControls;
  private readonly surfaces: WalkSurfaces;
  private readonly deps: LibraryDeps;
  private readonly spaces: SpaceManager;
  private readonly props: LibraryProps;
  /** The drawn building. */
  readonly exterior: LibraryExterior;
  private player: Player | null = null;
  private inside = false;
  private readonly from = new Vector3();
  private readonly cameraLocal = new Vector3();

  constructor(collision: CollisionWorld, controls: InteriorControls, surfaces: WalkSurfaces, deps: LibraryDeps) {
    this.collision = collision;
    this.controls = controls;
    this.surfaces = surfaces;
    this.deps = deps;
    this.spaces = new SpaceManager(controls);

    // ------------------------------------------------------ the reading room
    this.roomRoot.name = 'the-library-inside';
    this.roomRoot.position.set(LIBRARY_ORIGIN_X, LIBRARY_FLOOR_Y, LIBRARY_ORIGIN_Z);
    this.roomRoot.visible = false;
    this.roomWalls = buildReadingRoomShell(this.roomRoot, collision, surfaces);
    this.props = new LibraryProps(collision, surfaces, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z);
    const furnished = furnishReadingRoom(this.roomRoot, this.props);
    this.stacks = furnished.stacks;
    this.bookCount = furnished.bookCount;
    this.lighting = new LibraryLighting(furnished.pools);
    this.roomRoot.add(this.lighting.group);
    this.props.assertClear();

    // ------------------------------------------------------- the building
    const plot = deps.plot;
    const yaw = Math.atan2(plot.entranceX - plot.x, plot.entranceZ - plot.z);
    this.frame = new LibraryFrame(plot.x, plot.z, yaw, terrainHeight(plot.x, plot.z));
    this.exterior = createLibraryExterior();
    this.plan = measureLibraryExterior(this.exterior);
    this.assertExteriorMatchesLayout();
    const group = deps.anchorPlots.getGroup('library');
    this.parkRoot.name = 'the-library-outside';
    // The plot's own origin is the ground under the building, leant to the
    // local up; `standInPlot` carries the world transform back through it, so
    // the plinth stands on the sphere (the hotel's 13 Sep "floating" fix).
    standInPlot(group, this.parkRoot, plot.x, plot.z, 0, yaw);
    this.parkRoot.add(this.exterior.root);
    group.add(this.parkRoot);
    deps.anchorPlots.setPlaceholderVisible('library', false);
    this.shellSolids = registerLibraryShellCollision(collision, this.frame, this.plan);
    registerLibrarySteps(surfaces, this.frame, this.plan);
  }

  /**
   * **The drawn building against the numbers the park was solved with.** The
   * plot's radius, the bounding radius, the step's front the doormat is placed
   * from and the plinth's height are literals the solver read before any mesh
   * existed (`layout.ts`); the model is measured here and a disagreement is a
   * build failure, not a path under a column. Today the primitives are built
   * from those literals; the day `library.glb` replaces them, this is what
   * holds the glb to them.
   */
  private assertExteriorMatchesLayout(): void {
    const plan = this.plan;
    const problems: string[] = [];
    const corner = Math.hypot(plan.plinthHalfX, Math.max(Math.abs(plan.plinthBackZ), plan.stepFrontZ));
    if (corner > LIBRARY_FOOTPRINT_RADIUS) problems.push(`the plinth's corner stands ${corner.toFixed(3)} m out, past the plot's ${LIBRARY_FOOTPRINT_RADIUS}`);
    if (plan.reach > LIBRARY_BOUNDING_RADIUS) problems.push(`a drawn vertex stands ${plan.reach.toFixed(3)} m out, past the bounding radius ${LIBRARY_BOUNDING_RADIUS}`);
    if (Math.abs(plan.stepFrontZ - LIBRARY_STEPS_FRONT_Z) > 0.02) problems.push(`the step's front is at ${plan.stepFrontZ.toFixed(3)}, the doormat is placed from ${LIBRARY_STEPS_FRONT_Z}`);
    if (Math.abs(plan.plinthHalfX - LIBRARY_PLINTH_HALF_X) > 0.02 || Math.abs(-plan.plinthBackZ - LIBRARY_PLINTH_HALF_Z) > 0.02) {
      problems.push(`the plinth measures ${(plan.plinthHalfX * 2).toFixed(2)} x ${(plan.stepFrontZ - plan.plinthBackZ).toFixed(2)} m, the router keeps paths off ${LIBRARY_PLINTH_HALF_X * 2} x ${LIBRARY_PLINTH_HALF_Z * 2}`);
    }
    if (Math.abs(plan.plinthTop - LIBRARY_PLINTH_TOP) > 0.02) problems.push(`the plinth's top is ${plan.plinthTop.toFixed(3)} m, the layout says ${LIBRARY_PLINTH_TOP}`);
    if (Math.abs(plan.cellaFrontZ - LIBRARY_CELLA_FRONT_Z) > 0.02 || Math.abs(plan.recessBackZ - LIBRARY_RECESS_BACK_Z) > 0.02) {
      problems.push(`the doorway runs ${plan.recessBackZ.toFixed(2)}..${plan.cellaFrontZ.toFixed(2)}, the layout's band is ${LIBRARY_RECESS_BACK_Z}..${LIBRARY_CELLA_FRONT_Z}`);
    }
    if (problems.length > 0) throw new Error(`Library: the drawn exterior disagrees with layout.ts:\n  - ${problems.join('\n  - ')}`);
  }

  // --------------------------------------------------------------- state

  /** In the reading room: the sky's lights go off and the room lights itself. */
  get playerIsInside(): boolean {
    return this.inside;
  }

  /** Where she stands outside: the plot's doormat, the one the paths are routed to. */
  get doormat(): { readonly x: number; readonly z: number } {
    return { x: this.deps.plot.entranceX, z: this.deps.plot.entranceZ };
  }

  /** Every solid the reading room registered, with its collision handle — so a check can remove one and go red. */
  get solids(): readonly LibrarySolid[] {
    return this.props.solids;
  }

  /** No labels of its own yet — the owl's bubbles arrive with #714 part 4. */
  get screenLabels(): readonly ManagedLabel[] {
    return [];
  }

  attachPlayer(player: Player): void {
    this.player = player;
  }

  /**
   * Adopt a player restored into the reading room — being there is a position
   * plus the room switched on and the bounds bound, none of which a
   * constructor can do. A no-op for a park spawn.
   */
  adoptRestoredPlayer(): void {
    const player = this.player;
    if (!player) return;
    if (spaceAt(player.position.x, player.position.z) !== SPACE_LIBRARY) return;
    this.inside = true;
    this.roomRoot.visible = true;
    this.boundToRoom();
    this.spaces.holdOff();
  }

  // --------------------------------------------------------------- doors

  /**
   * `/library`, and `/library?at=x,z&facing=deg`: into the reading room —
   * **from anywhere, the room included** (a save written inside restores her
   * there before a link runs; the Reptile House's lesson). Without `at`, just
   * inside the door, facing up the central aisle.
   */
  requestEnter(at?: { readonly x: number; readonly z: number; readonly facing?: number }): boolean {
    const player = this.player;
    if (!player || player.riding || this.spaces.isChanging) return false;
    this.spaces.changeTo(() => this.enterRoom(at));
    return true;
  }

  /** `/library-door`: outside, on the doormat at the foot of the steps, facing the door. */
  requestEnterDoor(): boolean {
    const player = this.player;
    if (!player || player.riding || this.spaces.isChanging) return false;
    this.spaces.changeTo(() => this.standOutside(this.frame.yaw + Math.PI));
    return true;
  }

  /** The front door's band and the room's exit, for the tap-spacing check and the invariants. */
  doorBands(): PortalBand[] {
    return [libraryEntryBand(this.frame, this.plan), libraryExitBand()];
  }

  interactZones(): InteractZone[] {
    if (this.inside) return [];
    return [this.exteriorEntranceZone()];
  }

  update(context: FrameContext): void {
    const { dt } = context;
    this.spaces.update(dt);
    const player = this.player;
    if (!player) return;
    if (this.inside) this.fadeStacks(player, dt);
    if (!this.spaces.isChanging && !player.riding) this.checkDoorways(player);

    // Nobody falls out of the world: a slipped trigger lands her back at the arrival.
    if (this.inside && !this.spaces.isChanging && player.position.y < LIBRARY_FLOOR_Y - 2) { // flat-ok: two metres under the reading room's floor; the library is its own flat space at (-600, -600), off the sphere
      this.enterRoom();
      this.controls.snapCamera();
    }
  }

  dispose(): void {
    // Nothing per-frame to tear down: the room's meshes and lights live in the scene graph.
  }

  // ------------------------------------------------------------ private

  /** A stack between the camera and her eases translucent; one that is not, back to solid. */
  private fadeStacks(player: Player, dt: number): void {
    const camera = this.deps.camera.camera.position;
    this.cameraLocal.set(camera.x - LIBRARY_ORIGIN_X, camera.y - LIBRARY_FLOOR_Y, camera.z - LIBRARY_ORIGIN_Z);
    const localX = player.position.x - LIBRARY_ORIGIN_X;
    const localZ = player.position.z - LIBRARY_ORIGIN_Z;
    const feet = player.position.y - LIBRARY_FLOOR_Y; // flat-ok: height above the reading room's own flat floor, in its own space off the sphere
    for (const stack of this.stacks) {
      let hides = false;
      for (const up of [0.3, 1, 1.7]) {
        this.from.set(localX, feet + up, localZ);
        if (stack.hides(this.from, this.cameraLocal)) {
          hides = true;
          break;
        }
      }
      stack.fadeTowards(hides ? STACK_FADED_ALPHA : 1, dt);
    }
  }

  private checkDoorways(player: Player): void {
    const { x, z } = player.position;
    const fromX = player.previousPosition.x;
    const fromZ = player.previousPosition.z;
    if (!this.inside) {
      // The cooldown guards the band that just fired: she is put down on the
      // doormat, well outside the entry band, and must not be pulled straight
      // back in. Inside, the arrival is 1.8 m from the exit band, so the exit
      // is checked from the first frame (the Reptile House's solidity review).
      if (this.spaces.settling) return;
      if (bandCrossed(libraryEntryBand(this.frame, this.plan), fromX, fromZ, x, z)) {
        this.spaces.changeTo(() => this.enterRoom());
      }
      return;
    }
    if (bandCrossed(libraryExitBand(), fromX, fromZ, x, z)) {
      this.spaces.changeTo(() => this.standOutside(this.frame.yaw));
    }
  }

  private enterRoom(at?: { readonly x: number; readonly z: number; readonly facing?: number }): void {
    const player = this.player;
    if (!player) return;
    this.inside = true;
    this.roomRoot.visible = true;
    this.boundToRoom();
    const spot: LocalPoint = at ?? LIBRARY_ARRIVAL;
    const facing = ((at?.facing ?? LIBRARY_ARRIVAL.facing) * Math.PI) / 180;
    player.teleportTo(LIBRARY_ORIGIN_X + spot.x, LIBRARY_FLOOR_Y, LIBRARY_ORIGIN_Z + spot.z, facing);
    // A fresh visit starts with every stack solid.
    for (const stack of this.stacks) stack.setAlpha(1);
  }

  /** Out on the doormat, facing `facing` (radians): away from the door on leaving, at it for the door link. */
  private standOutside(facing: number): void {
    const player = this.player;
    if (!player) return;
    this.inside = false;
    this.roomRoot.visible = false;
    this.collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
    const mat = this.doormat;
    player.teleportTo(mat.x, this.surfaces.sample(mat.x, mat.z, terrainHeight(mat.x, mat.z) + 3), mat.z, facing);
  }

  private boundToRoom(): void {
    this.collision.setPlayBounds(circleBoundary(LIBRARY_PLAY_RADIUS, LIBRARY_ORIGIN_X, LIBRARY_ORIGIN_Z));
  }

  /**
   * The building from outside: one zone over its body and its doormat, no
   * actions (walking through the doorway is what enters), its stand spot the
   * band's own centre — `Hotel.exteriorEntranceZone`'s shape and reasoning.
   */
  private exteriorEntranceZone(): InteractZone {
    const band = libraryEntryBand(this.frame, this.plan);
    const plot = this.deps.plot;
    const reach = Math.hypot(plot.entranceX - plot.x, plot.entranceZ - plot.z);
    return {
      id: ENTRANCE_ZONE,
      label: 'The Library',
      x: plot.x,
      y: this.surfaces.sample(plot.x, plot.z, terrainHeight(plot.x, plot.z) + 3),
      z: plot.z,
      pickRadius: reach + 0.5,
      standX: band.centreX,
      standZ: band.centreZ,
    };
  }
}
