import { circleBoundary, GARDEN_PLAY_BOUNDARY } from '../boundary';
import { CylinderGeometry, Group, Mesh, Vector3 } from 'three';
import { BUILDING_FLOOR_HEIGHT, BUILDING_HALF_X, BUILDING_HALF_Z, INTERIOR_HALF_X, INTERIOR_HALF_Z, INTERIOR_ORIGIN_X, INTERIOR_ORIGIN_Z, INTERIOR_PLAY_RADIUS, SLIDE_SPEED } from '../../core/constants';
import { BUILDING_CENTRE_X, BUILDING_CENTRE_Z } from './layout';
import { GIANT_SLIDE_SPEED, SLIDE_PLAN } from '../slide/plan';
import { LANDING_DROP, slideLandingSpot } from '../slide/landing';
import { buildSlideSupports, planSlideLegs, type SlideLeg } from '../slide/supports';
import { RideCamera } from '../../core/RideCamera';
import { PALETTE } from '../../core/palette';
import { TAU } from '../../core/mathUtils';
import type { FrameContext, GameSystem } from '../../core/types';
import type { CollisionWorld } from '../Collision';
import type { AnchorPlots } from '../AnchorPlots';
import { INDOOR_FLY_CEILING, PARK_FLY_CEILING, type Player } from '../../entities/Player';
import type { StairDirection } from '../../ui/StairMenu';

import { BallPit } from './BallPit';
import { Bubble } from './Bubble';
import { Escalators } from './Escalators';
import { FloorFader } from './floorFade';
import { GlassLift } from './GlassLift';
import { LiftRide, type LiftPanelSource } from './liftRide';
import { GrownUp } from './GrownUp';
import { buildShaftGuards } from './ShaftGuards';
import { InteriorLighting } from './InteriorLighting';
import { BuildingShell } from './Shell';
import { ShopUnits } from './ShopUnits';
import { Shops } from './shops/Shops';
import { SlideRide } from './SlideRide';
import { StairRide } from './StairRide';
import { Stairs } from './Stairs';
import { Toilets } from './Toilets';
import { Trampoline } from './Trampoline';
import { WalkSurfaces } from './surfaces';
import { buildingInteractZones } from './interactZones';
import { dressDeck } from './dressing';
import type { InteractZone } from '../interact';
import { softMaterial } from './parts';
import {
  BALL_PIT_RADIUS,
  BALL_PIT_X,
  BALL_PIT_Z,
  BUILDING_BASE_Y,
  ENTRANCE_MAX_X,
  ENTRANCE_MIN_X,
  GROWN_UP_X,
  GROWN_UP_Z,
  HELTER_CENTRE_X,
  HELTER_CENTRE_Z,
  HELTER_DECK,
  HELTER_ENTRY_X,
  HELTER_ENTRY_Z,
  HELTER_MOUTH_X,
  HELTER_SEMI_X,
  HELTER_SEMI_Z,
  INTERIOR_DOOR_MAX_X,
  INTERIOR_DOOR_MIN_X,
  LIFT_DOOR_MAX_Z,
  LIFT_DOOR_MIN_Z,
  STAIR_STAND_X,
  STAIR_STAND_Z,
  TOILET_DECK,
  TOILET_ROOM,
  TOP_DECK,
  escalatorRamp,
  facadeX,
  facadeZ,
  regionContains,
  stairFlights,
  worldX,
  worldZ,
  type RampDefinition,
} from './layout';

const RIDER_LIFT = 0.06;

/**
 * How far **ahead** of you the grown-up rides, in metres of slide.
 *
 * In front, not behind, and lying down — the family asked for it that way
 * (REQUIREMENTS §9) and it is how two people actually go down a slide together:
 * the grown-up goes first with the child tucked in behind. Lying down is what
 * makes it work from a first-person seat, because a grown-up sitting upright
 * 2.6 m ahead of a six-year-old's eyeline is a wall of back where the view
 * should be.
 */
const GROWN_UP_LEAD = 2.6;

/**
 * The angle a grown-up lies back at, riding in front.
 *
 * A quarter turn about their own left-right axis, applied after the heading, so
 * they end up on their back with their feet pointing the way they are going.
 * `rotation.order` is set to `YXZ` on the model's root for exactly this: yaw
 * first, then pitch in the yawed frame. In the default `XYZ` order the two
 * compose the other way round and a grown-up lying down on a turn corkscrews.
 */
const GROWN_UP_RECLINE = -Math.PI / 2;

/**
 * Where the chase camera sits relative to the seat — up and **behind**.
 *
 * Jim's note after riding it, 5 August 2026: *"I'd like this to now be a chase
 * cam instead, not first person, so just behind the player"*. The offsets are
 * written in camera terms because `eyeMount` is turned to face the camera's way
 * round (`rotation.y = Math.PI`), exactly as the coaster's chase view does — so
 * **+Z here is behind the rider**, not in front.
 *
 * Higher and further back than the coaster's `{ y: 2.1, z: 3.4 }` because a
 * slide is a *trough*: the camera has to clear the chute's own side walls
 * (`CHUTE_ENVELOPE.above` is 0.86 m) and the hand-rails on top of them, or the
 * near wall swings through the lens on every bend. Tuned live down the whole
 * ride rather than picked on paper.
 */
const CHASE_EYE = { x: 0, y: 2.35, z: 4.1 } as const;

/**
 * How steeply the chute is falling here, as a rotation about the rider's own
 * left-right axis.
 *
 * Derived from the unit tangent the ride is *already* using to face her, so
 * there is no second description of the chute's slope that could drift from the
 * first. Under a `YXZ` composition the model's forward (+Z) maps to
 * `(0, -sin θ, cos θ)` once yaw has been applied, so matching the tangent's
 * rise against its horizontal run is exactly `atan2(-y, |xz|)` — positive is
 * nose-down, which is the way a slide goes.
 *
 * Taking `atan2` of the run rather than `asin` of the rise keeps it honest if a
 * tangent ever arrives un-normalised; `SlideRide.tangentAt` normalises today,
 * and this does not have to care whether it still does tomorrow.
 */
function slopeOf(tangent: Vector3): number {
  return Math.atan2(-tangent.y, Math.hypot(tangent.x, tangent.z));
}

/** Seconds after a change of space before another one may be triggered. */
const SPACE_COOLDOWN = 0.9;

/**
 * How hard the balls are thrown when a rider lands in them.
 *
 * Multiplies `BallPit.splash`'s own `SPLASH_OUT_STRENGTH`/`SPLASH_UP_STRENGTH`,
 * so it stays one number describing "harder than walking in" rather than a
 * second set of physics constants beside the pit's. Was 1.15, fired from the
 * chute's mouth before she got there; she arrives at `GIANT_SLIDE_SPEED` and
 * this is the shot the ride exists for.
 */
const LANDING_SPLASH = 1.9;

/**
 * How long the landing watcher will wait for a touchdown before giving up.
 *
 * A dead-man's handle. `LANDING_DROP` is 0.85 m, which is about 0.4 s of fall,
 * so anything approaching this means the touchdown test never became true and
 * the scatter should fire once and stop rather than stay armed.
 */
const SPLASH_PATIENCE = 2;

interface ActiveRide {
  readonly slide: SlideRide;
  readonly giant: boolean;
  distance: number;
}

/**
 * Everything the building needs from the rest of the game, in one seam.
 *
 * The building owns two *places*, and moving a child between them means moving
 * the camera, the collision boundary and a screen wipe as well — none of which
 * are the building's to own. Rather than reach up into `Game`, it is handed this
 * on construction and calls back through it.
 */
export interface InteriorControls {
  /** Walk the character somewhere under orders. Used by the stair ride. */
  walkTo(
    x: number,
    y: number,
    z: number,
    handlers: { onArrive(): void; onAbandon(): void },
  ): void;
  /** Stop whatever the character was told to do. */
  cancelWalk(): void;
  /** Multiply the world clock and every animation rate by this. */
  setTimeScale(scale: number): void;
  /** The fast-forward speed-lines. */
  setWhoosh(on: boolean): void;
  /** Close the iris, run `midpoint` behind it, open it again. */
  iris(midpoint: () => void): void;
  /** A soft blink. */
  flash(): void;
  /** Put the camera exactly on the player, with no travelling. */
  snapCamera(): void;
  /** Show the Climb / Descend menu for a deck. */
  openStairMenu(deck: number): void;
  /** Open shop unit `unitId`'s purchase panel — `Shopping` owns it, not us. */
  openShop(unitId: string): void;
  /** Take the stairs menu down again — the player has left, or is riding. */
  closeStairMenu(): void;
}

/**
 * The big building, and everything inside its shell.
 *
 * ## Bigger on the inside
 *
 * The family asked for the classic trick, and this is how it is done: the
 * building is **two places**. Out in the garden stands a facade — a 24 x 18 m
 * tower with a door in it, which is scenery. Walking through that door does not
 * walk you into the tower above; it transitions you into the building's *own
 * space*, a 60 x 44 m floor plate parked six hundred metres from the park, past
 * the terrain disc and past the far fog plane, so neither place can ever appear
 * in a frame of the other.
 *
 * **Why a far offset rather than a second scene.** Everything in this game that
 * asks "where am I?" — the ground sampler, the collision world, the tap
 * navigator's ray march, the camera rig, the sun that follows the player — takes
 * world coordinates and does not care what they are. Putting the interior at an
 * offset therefore kept *all* of it working unchanged: one scene, one renderer,
 * one collision world, one sampler. A second scene graph would have meant a
 * second of each and a seam through every system in the game, for a trick the
 * player is never supposed to notice. Only two things had to learn about it: the
 * soft play boundary (`CollisionWorld.setPlayBounds`) and the camera, which is
 * snapped rather than followed across the join — both behind a closed iris, so
 * neither is ever seen doing it.
 *
 * ## The rest of it
 *
 * Five levels, and the top one is the **roof** — genuinely outdoors, open to the
 * sky, where the ginormous slide launches from. Six ways between them: the tap
 * stairs, an escalator per storey, a glass lift on the outside wall, a
 * trampoline, a floating bubble and a helter-skelter. Seven shops with proper
 * room to breathe, and the toilets on deck one.
 *
 * Two things make it work without a physics engine:
 *
 * - {@link WalkSurfaces} answers "how high is the ground here?" for the player,
 *   so decks, ramps and moving platforms are all just answers to that question.
 * - {@link FloorFader} fades away every floor above the one the player is on,
 *   which is what gives the Theme Park cutaway look indoors.
 */
export class Building implements GameSystem {
  readonly name = 'building';
  readonly surfaces = new WalkSurfaces();
  readonly units: ShopUnits;
  /** The fitted-out shops: stock, shopkeepers, and where you stand to buy. */
  readonly shops: Shops;
  readonly ballPit = new BallPit();

  /**
   * The chase camera for the ginormous slide (REQUIREMENTS §9).
   *
   * `RideCamera` rather than a second look-around of its own: it is guarded by
   * `npm run check:ride-camera`, and every other ride in the park already uses
   * it, so the slide gets the same damping, the same pitch limits and the same
   * portrait handling for free.
   *
   * Null until the ride is attached to a player, exactly like the coaster's.
   */
  rideView: RideCamera | null = null;

  /**
   * True: the ginormous slide is ridden **chase**, so her model stays on screen.
   *
   * Named and typed to match `Coaster.playerStaysVisible` and
   * `RailRace.playerStaysVisible`, because `Game.ts` reads exactly this field
   * off each ride to decide whether to hide her — one question, asked the same
   * way of every ride, rather than a special case per ride.
   *
   * **This is what makes her ride pose load-bearing.** For as long as the slide
   * was first person nothing on this ride was ever seen, so nobody noticed it
   * never passed a pitch to `setRidePose` — see {@link advanceRide}.
   */
  readonly playerStaysVisible = true;

  /** Told when the ginormous slide is boarded and left, so `Game` can swap camera. */
  onRideChange: ((riding: boolean) => void) | null = null;

  /** Follows the chute: position and heading. */
  private readonly rideMount = new Group();

  /** Scratch for {@link ridePointToWorld}, so the ride allocates nothing per frame. */
  private readonly riderPoint = new Vector3();

  /**
   * A landing that has been set up but not yet hit the balls.
   *
   * Jim, 5 August 2026: *"when the player lands in it via chase cam we should
   * see the balls scatter"*. The scatter therefore has to happen on the frame
   * she **touches** them. Splashing at `finishRide` — which is what the code did
   * before, and from the chute's mouth rather than from where she lands — fires
   * it a few frames early and a couple of metres short, so the balls have
   * already finished moving by the time she arrives and it reads as the pit
   * twitching on its own rather than as her landing in it.
   *
   * `waited` is a dead-man's handle, not a timer: nothing here should ever take
   * {@link SPLASH_PATIENCE}, and if the touchdown is somehow never detected the
   * scatter should still happen once and then stop, rather than being armed
   * forever waiting for a frame that is not coming.
   */
  private pendingSplash: { x: number; z: number; waited: number } | null = null;

  /** The frame clock, kept so the ride camera's idle sway can be driven. */
  private elapsed = 0;

  /**
   * The eye, turned to face the way the ride is going.
   *
   * The park's models face +Z and a three.js camera looks down −Z, so something
   * has to turn round. It lives here on the ride rather than inside
   * `RideCamera`, which is the convention the coaster and the train already
   * follow — the flip is a fact about how this park models things, not about
   * how cameras work.
   */
  private readonly eyeMount = new Group();

  /**
   * The building's own space. Added straight to the scene rather than to the
   * `building` anchor plot, because it is nowhere near the plot — that is the
   * whole idea.
   */
  readonly interiorRoot = new Group();

  private readonly shell = new BuildingShell('interior');
  private readonly facade = new BuildingShell('facade');
  /** The facade, the ginormous slide, and the grown-up while they ride it. */
  /**
   * The castle as it stands in the garden: the facade shell and the ginormous
   * slide. Readable rather than private so the #113 invariant can sweep the
   * Sky Cruiser's envelope against **every mesh actually in it**, instead of
   * against a list of fixtures somebody wrote down and has to remember to keep
   * up to date.
   */
  readonly gardenRoot = new Group();
  /**
   * Park level — the same group the slide's legs stand in.
   *
   * The ginormous slide spans the castle *and* the ball pit, so it is not the
   * castle's content and does not hang off the castle's plot. Everything that
   * moves along the chute lives here with it; see the note where they are added.
   */
  private parkRoot!: Group;

  private readonly escalators: Escalators;
  private readonly lift: GlassLift;
  private readonly liftRide: LiftRide;
  private readonly trampoline = new Trampoline();
  private readonly bubble = new Bubble();
  private readonly fader = new FloorFader();
  private readonly grownUp = new GrownUp();
  private readonly toilets: Toilets;
  private readonly helterSkelter: SlideRide;
  /** The ginormous slide itself, so `test/procgen` can measure what was built. */
  readonly ginormousSlide: SlideRide;

  /** Where its legs stand, so `test/procgen` can measure those too. */
  readonly slideLegs: readonly SlideLeg[];
  private readonly stairRide: StairRide;
  /** The building's own fixed lights — on indoors, off outside and on the roof. */
  private readonly interiorLighting = new InteriorLighting();

  private player: Player | null = null;
  private ride: ActiveRide | null = null;
  private grownUpComing = false;
  private wasOnPad = false;
  private wasAirborne = false;

  /** True while the player is in the building's own space. */
  private inside = false;
  /** The deck the player is currently standing on, or `null` off any deck. */
  private currentDeck: number | null = null;
  /** True from the moment an iris starts closing until the space has changed. */
  private changingSpace = false;
  private spaceCooldown = 0;

  private readonly point = new Vector3();
  private readonly tangent = new Vector3();

  constructor(
    private readonly collision: CollisionWorld,
    anchorPlots: AnchorPlots,
    private readonly controls: InteriorControls,
  ) {
    // ---------------------------------------------------------- the interior
    this.interiorRoot.name = 'the-big-building-inside';
    this.interiorRoot.position.set(INTERIOR_ORIGIN_X, BUILDING_BASE_Y, INTERIOR_ORIGIN_Z);
    this.interiorRoot.add(this.shell.group);
    // Nobody is in there yet, and six hundred metres of nothing still costs a
    // frustum test per object.
    this.interiorRoot.visible = false;

    this.units = new ShopUnits(this.shell.floorGroups, collision);
    // Fitted out straight away, and before the floor fader claims materials —
    // anything added to a floor group after that is not part of the cutaway.
    this.shops = new Shops(this.units);
    // Stairs are pure geometry: what you walk on is declared in `layout.ts`.
    new Stairs(this.shell.floorGroups);
    this.escalators = new Escalators(this.shell.floorGroups);
    this.toilets = new Toilets(this.shell.floorGroups);
    this.lift = new GlassLift(collision);
    this.interiorRoot.add(this.lift.group);
    // The lift's *experience* — call panel, automatic boarding, straight to the
    // floor you pressed — lives in `liftRide.ts` behind Decision 3's
    // `floors()` / `go(n)` seam, so the castle floor split can replace all of
    // it without touching the car, the shaft or this file. See that file.
    this.liftRide = new LiftRide({
      lift: this.lift,
      surfaces: this.surfaces,
      cancelWalk: () => this.controls.cancelWalk(),
      isInside: () => this.inside,
    });
    // Off until the player is actually indoors under a ceiling (see `update`);
    // starts invisible for the same reason `interiorRoot` does.
    this.interiorRoot.add(this.interiorLighting.group);
    this.interiorLighting.setActive(false);

    const ground = this.shell.floorGroups[0];
    if (ground) ground.add(this.trampoline.group);
    this.interiorRoot.add(this.bubble.group);

    this.helterSkelter = buildHelterSkelter();
    this.interiorRoot.add(this.helterSkelter.group);

    addRideEntrances(this.shell.floorGroups);
    // Roundels, planters and benches, so sixty metres of floor plate reads as a
    // place rather than a car park. Must be before the fader claims materials.
    this.shell.floorGroups.forEach((floor, deck) => dressDeck(deck, floor));
    this.interiorRoot.add(this.grownUp.root);
    this.placeGrownUp();

    // Walkable surfaces that are not part of a deck.
    this.surfaces.addPlatform(this.lift);
    this.surfaces.addPlatform(this.bubble);
    this.surfaces.addPlatform(this.trampoline);

    registerInteriorCollision(collision);
    // The trampoline well, the helter-skelter shaft and the bubble's shaft
    // (architecture review S14) — none of these had a rail or a collider of
    // any kind. See `ShaftGuards.ts` for why they get two different shapes.
    buildShaftGuards(this.shell.floorGroups, collision);

    // The cutaway needs the floors registered bottom to top. There is no
    // separate roof layer any more: the roof *is* the top floor.
    for (const floor of this.shell.floorGroups) this.fader.addLayer(floor);

    // ------------------------------------------------------------ the garden
    this.gardenRoot.name = 'the-big-building-outside';
    this.gardenRoot.add(this.facade.group);

    // The ginormous slide is a fact about the park, not about the interior: it
    // leaves the roof and lands in the ball pit on the grass, and both of those
    // are out here. Riding it from the roof terrace inside therefore *changes
    // space* — see `startGiantSlide`.
    //
    // At park level, not under the castle's plot, and for the reason the legs
    // already were: `check:park` measures everything under an anchor's group
    // against the `boundingRadius` that anchor declares, and this chute reaches
    // 28.2 m from a castle that promises 19 m. It passed before only because
    // its bounding-sphere *centre* happened to sit near the tower — luck that
    // ran out the moment the route changed shape. A ride that spans two plots
    // is the park's content, not the tower's.
    this.parkRoot = anchorPlots.group;
    this.ginormousSlide = buildGinormousSlide();
    this.parkRoot.add(this.ginormousSlide.group);

    // Something to stand it on. ~95 m of chute with nothing under it reads as
    // floating, and this park's things are meant to look built — see
    // `slide/supports.ts` for why the legs are sparse rather than regular.
    this.slideLegs = planSlideLegs(SLIDE_PLAN.points, (x, z, radius) =>
      collision.isClearCircle(x, z, radius),
    );
    // At park level, not under the castle's plot — the ride spans two plots and
    // its legs stand in the park between them. See `buildSlideSupports`.
    anchorPlots.group.add(buildSlideSupports(this.slideLegs, collision));

    // The rider's seat hangs off the **same group as the chute** — so the
    // chute's points and the mount's position are the same coordinates and
    // cannot drift apart. That pairing is the whole reason both moved to park
    // level together rather than one of them: `pointAt` feeds the mount, the
    // grown-up and the player teleport below, and any of them left behind in
    // the castle's frame would sit a castle's-width off the chute.
    this.eyeMount.rotation.y = Math.PI;
    // Yaw first, then pitch in the yawed frame. The mount now leans with the
    // chute as well as turning with it (see `advanceRide`), and in the default
    // `XYZ` order those two compose the other way round: the pitch would be
    // taken about the *world* X axis, so it would read as nose-down only while
    // the ride happened to be heading north, and as a barrel roll a quarter of
    // the way round the castle. Exactly the trap `GROWN_UP_RECLINE` documents.
    this.rideMount.rotation.order = 'YXZ';
    this.rideMount.add(this.eyeMount);
    this.parkRoot.add(this.rideMount);

    registerFacadeCollision(collision);

    const plot = anchorPlots.getGroup('building');
    const plotAnchor = plot.position;
    this.gardenRoot.position.set(
      BUILDING_CENTRE_X - plotAnchor.x,
      BUILDING_BASE_Y - plotAnchor.y,
      BUILDING_CENTRE_Z - plotAnchor.z,
    );
    plot.add(this.gardenRoot);
    anchorPlots.setPlaceholderVisible('building', false);

    const pitPlot = anchorPlots.getGroup('ballPit');
    pitPlot.add(this.ballPit.group);
    anchorPlots.setPlaceholderVisible('ballPit', false);

    // ------------------------------------------------------------ the stairs
    this.stairRide = new StairRide(this.surfaces, {
      walkTo: (x, y, z, handlers) => this.controls.walkTo(x, y, z, handlers),
      setTimeScale: (scale) => this.controls.setTimeScale(scale),
      setWhoosh: (on) => this.controls.setWhoosh(on),
      playerY: () => this.player?.position.y ?? BUILDING_BASE_Y,
      onArrived: () => this.controls.flash(),
    });
  }

  /** True while the player is in the building's own space. */
  get playerIsInside(): boolean {
    return this.inside;
  }

  /**
   * True while the player is indoors under a ceiling — i.e. anywhere in the
   * building's own space *except* the roof terrace, which is genuinely
   * outdoors (GAME_DESIGN.md items 5 and 30c).
   *
   * `World` feeds this straight to `DayNight.setIndoors`, which is what turns
   * the sun's moving shadows off indoors and hands lighting over to
   * {@link InteriorLighting} instead (item 18). `currentDeck` is a frame
   * behind `inside` — set by `updateCutaway`, which runs after the doorway
   * check — but that lag is invisible behind the same iris that already hides
   * every other seam in a space change.
   */
  get playerInRoofedInterior(): boolean {
    return this.inside && (this.currentDeck === null || this.currentDeck < TOP_DECK);
  }

  /**
   * Everything in the building a finger can point at, with the two moving ones
   * (the lift's doors, the bubble) at wherever they currently are.
   *
   * Rebuilt per call rather than cached — it is a handful of object literals and
   * it is only ever called on a tap.
   */
  interactZones(): InteractZone[] {
    return buildingInteractZones({
      bubbleSurfaceY: this.bubble.surfaceY,
      trampolineSurfaceY: this.trampoline.surfaceY,
      doorstepY: this.surfaces.sample(
        facadeX(1.5),
        facadeZ(BUILDING_HALF_Z + 1.4),
        BUILDING_BASE_Y + 1,
      ),
      // The lift's "Call" chip and the panel's big round button are the same
      // summon — see `liftRide.ts`'s `LiftPanelSource`.
      callLift: () => this.liftRide.call(),
      openStairs: (deck) => this.openStairs(deck),
      useToilets: () => this.useToilets(),
      askGrownUp: () => this.askGrownUp(),
      // Opening the purchase panel is `Shopping`'s, not the building's — the
      // building owns the geometry and `Game` owns the join. See
      // `InteriorControls.openShop`.
      openShop: (unitId) => this.controls.openShop(unitId),
    });
  }

  /** Hands the building the player, so it can carry, bounce and ride them. */
  attachPlayer(player: Player): void {
    this.player = player;
    player.groundSampler = (x, z, y) => this.surfaces.sample(x, z, y);
    this.liftRide.attachPlayer(player);
    this.ballPit.attachPlayer(player);
    // **Chase, not first person** (Jim, 5 August 2026). Same shared camera,
    // mounted behind and above the seat, looking along the chute with only a
    // little look-around — the point of this view is watching *her* go down the
    // slide, not steering the eye.
    //
    // `sensorLook: false` is not a preference, it is Jim's rule of 3 August:
    // tilt-to-look belongs to first-person rides and to nothing else. A
    // third-person camera that swings when the handset does is a camera that
    // has come loose. Its yaw stays clamped for the same reason — the ride is
    // ahead of you. These are the coaster's chase settings, deliberately not
    // re-derived (`Coaster.attachPlayer`).
    this.rideView = new RideCamera({
      yawLimit: 0.55,
      startPitch: -0.14,
      fov: 60,
      sensorLook: false,
    });
    this.rideView.mountOn(this.eyeMount, CHASE_EYE);
  }

  /**
   * The lift's control panel, as `ui/LiftPanel.ts` sees it.
   *
   * Typed as {@link LiftPanelSource} rather than as `LiftRide` on purpose: the
   * UI must only ever reach Decision 3's `floors()` / `go(n)` seam and the two
   * pieces of glue beside it, so that the castle floor split can swap the
   * implementation out from under it.
   */
  get liftPanel(): LiftPanelSource {
    return this.liftRide;
  }

  /**
   * Board the ginormous slide from wherever the player is standing.
   *
   * The `/slide` deep link, for QA and for developers. Normally you reach this
   * ride by walking into the castle and climbing to the roof, which is right
   * for a child and a real tax on anyone testing it dozens of times.
   *
   * Safe from anywhere: `startGiantSlide` changes space behind a closed iris
   * and teleports the rider onto the top of the chute, so it does not care
   * where they were when they asked.
   */
  requestBoardSlide(withGrownUp: boolean): boolean {
    const player = this.player;
    if (!player || player.riding || this.ride || this.changingSpace) return false;
    this.grownUpComing = withGrownUp;
    this.startGiantSlide(player);
    return true;
  }

  /** The Climb / Descend menu was answered. */
  takeStairs(deck: number, direction: StairDirection): void {
    if (!this.player || this.player.riding || !this.inside) return;
    this.stairRide.start(deck, direction);
  }

  update(context: FrameContext): void {
    const { dt, elapsed } = context;
    this.elapsed = elapsed;

    if (this.spaceCooldown > 0) this.spaceCooldown -= dt;

    this.liftRide.update(dt);
    this.bubble.update(dt, elapsed);
    this.escalators.update(dt);
    this.trampoline.update(dt);
    this.toilets.update(dt, elapsed, this.toiletOccupied());
    this.ballPit.update(dt, elapsed);

    const player = this.player;
    if (!player) return;

    this.stairRide.update(dt);

    // Unconditionally, not inside the branch below: the whole point is that it
    // runs on the frames just *after* a ride, and it must not be skipped
    // because the iris happens still to be closing.
    this.settleIntoTheBalls(player, dt);

    if (this.ride) {
      this.advanceRide(dt, player);
    } else if (!this.changingSpace && !player.riding) {
      this.handleTrampoline(player);
      this.handleEscalator(player, dt);
      this.checkRideTriggers(player);
      this.checkDoorways(player);
    }

    // How high she may fly. A castle floor is `BUILDING_FLOOR_HEIGHT` from the
    // one above it and there is no ceiling collider up there, so indoors the
    // jet pack is a hover rather than a flight: enough to lift her over the
    // furniture, never enough to put her head through the deck above with
    // nothing up there she chose to land on. Written every frame from one
    // place, the way `speedMultiplier` already is — see `entities/Player.ts`.
    player.flyCeiling = this.inside ? INDOOR_FLY_CEILING : PARK_FLY_CEILING;

    this.grownUp.update(dt, elapsed, this.grownUpComing);
    this.shops.update(dt, elapsed);
    this.updateCutaway(player);
    this.fader.update(dt);
  }

  // -------------------------------------------------------- changing space

  /**
   * Walking through a door.
   *
   * Both directions are the same shape: notice the character has crossed a
   * threshold, close the iris, move them (and the camera, and the play boundary)
   * while nobody can see, open it again.
   */
  private checkDoorways(player: Player): void {
    if (this.spaceCooldown > 0) return;
    if (Math.abs(player.position.y - BUILDING_BASE_Y) > 1.6) return;

    if (!this.inside) {
      const localX = player.position.x - BUILDING_CENTRE_X;
      const localZ = player.position.z - BUILDING_CENTRE_Z;
      if (localX < ENTRANCE_MIN_X - 0.4 || localX > ENTRANCE_MAX_X + 0.4) return;
      if (localZ > BUILDING_HALF_Z + 0.5 || localZ < BUILDING_HALF_Z - 2.2) return;
      this.changeSpace(() => this.enterInterior());
      return;
    }

    const localX = player.position.x - INTERIOR_ORIGIN_X;
    const localZ = player.position.z - INTERIOR_ORIGIN_Z;
    if (localZ < INTERIOR_HALF_Z + 1.7) return;
    if (localX < INTERIOR_DOOR_MIN_X - 1.4 || localX > INTERIOR_DOOR_MAX_X + 1.4) return;
    this.changeSpace(() => this.leaveInterior());
  }

  private changeSpace(midpoint: () => void): void {
    this.changingSpace = true;
    this.controls.cancelWalk();
    this.controls.closeStairMenu();
    this.stairRide.stop(false);
    this.controls.iris(() => {
      midpoint();
      this.controls.snapCamera();
      this.changingSpace = false;
      this.spaceCooldown = SPACE_COOLDOWN;
    });
  }

  private enterInterior(): void {
    const player = this.player;
    if (!player) return;
    this.inside = true;
    this.interiorRoot.visible = true;
    this.collision.setPlayBounds(
      circleBoundary(INTERIOR_PLAY_RADIUS, INTERIOR_ORIGIN_X, INTERIOR_ORIGIN_Z),
    );
    // Well clear of the south wall, facing north into the room.
    //
    // Not on the threshold, which is the obvious place and the wrong one: the
    // camera looks in along the +X+Z diagonal, so the south wall and its parapet
    // are between it and anybody standing within about three metres of them. Land
    // a child there and their first sight of the roomiest place in the game is
    // the back of a wall.
    player.teleportTo(worldX(0), BUILDING_BASE_Y, worldZ(INTERIOR_HALF_Z - 6.5), Math.PI);
  }

  private leaveInterior(): void {
    const player = this.player;
    if (!player) return;
    this.exitToGarden();

    const x = facadeX(1.5);
    const z = facadeZ(BUILDING_HALF_Z + 2.4);
    // Facing +Z, out into the park — which is also the way the camera looks.
    player.teleportTo(x, this.surfaces.sample(x, z, BUILDING_BASE_Y + 1), z, 0);
  }

  /**
   * The shared first half of leaving the interior: shared by `leaveInterior`
   * (the door) and `startGiantSlide` (the roof, via the slide), the two
   * independent paths out of the building's own space. Kept as one method so
   * anything added to "the player has left the interior" can't be added to
   * one path and silently miss the other, the way this pair once did.
   */
  private exitToGarden(): void {
    this.inside = false;
    this.interiorRoot.visible = false;
    this.collision.setPlayBounds(GARDEN_PLAY_BOUNDARY);
  }

  // ---------------------------------------------------------------- cutaway

  private updateCutaway(player: Player): void {
    if (!this.inside && !this.ride) {
      this.currentDeck = null;
      this.interiorLighting.setActive(false);
      this.fader.setVisibleUpTo(null);
      this.shops.setVisibleDeck(null);
      this.grownUp.root.visible = false;
      return;
    }

    const floor = this.surfaces.deckAt(player.position.x, player.position.z, player.position.y);
    this.currentDeck = floor;
    this.interiorLighting.setActive(this.playerInRoofedInterior);
    this.fader.setVisibleUpTo(floor);
    // Shop stock is only drawn on the deck the player is actually standing on;
    // the floors below are visible but their shelves are not worth the budget.
    this.shops.setVisibleDeck(floor);

    // The grown-up belongs to the roof but lives outside the fader — they have
    // to stay visible during most rides, when the player is nowhere near a
    // floor. The ginormous slide is the exception: that's the one ride he can
    // be *absent* from, riding only when invited (see `startGiantSlide`), and
    // by then the player isn't in the interior any more so `floor` is a stale
    // reading of outdoor coordinates against the interior's deck sampler —
    // not a real "nowhere near a floor" signal worth falling back on.
    this.grownUp.root.visible =
      this.ride !== null && this.ride.giant
        ? this.grownUpComing
        : this.ride !== null || floor === null || floor >= TOP_DECK;
  }

  // ------------------------------------------------------------------ rides

  private checkRideTriggers(player: Player): void {
    if (!this.inside) return;
    const localX = player.position.x - INTERIOR_ORIGIN_X;
    const localZ = player.position.z - INTERIOR_ORIGIN_Z;
    const localY = player.position.y - BUILDING_BASE_Y;

    if (
      near(localX, localZ, HELTER_ENTRY_X, HELTER_ENTRY_Z, 1.5) &&
      Math.abs(localY - HELTER_DECK * BUILDING_FLOOR_HEIGHT) < 1.2
    ) {
      this.startRide(this.helterSkelter, false, player);
      return;
    }

    if (
      near(localX, localZ, SLIDE_PLAN.entryX, SLIDE_PLAN.entryZ, 1.9) &&
      Math.abs(localY - TOP_DECK * BUILDING_FLOOR_HEIGHT) < 1.4
    ) {
      this.startGiantSlide(player);
    }
  }

  /**
   * The ginormous slide, the one ride that crosses between the two spaces.
   *
   * You step onto it on the roof terrace inside; you land in the ball pit on the
   * grass outside. Rather than try to make a spline span six hundred metres of
   * nothing, the launch *is* the transition: the iris closes on the roof, the
   * world becomes the garden, and it opens again with the chute already carrying
   * you out over the park. From a child's seat it is one continuous whoosh.
   */
  private startGiantSlide(player: Player): void {
    this.changeSpace(() => {
      this.exitToGarden();

      // The grown-up rides in the garden, so they have to be in the garden —
      // but only if they were actually invited. Reparenting unconditionally
      // here left an uninvited grown-up hanging in the sky beside the tower
      // for the whole descent, since `updateCutaway` used to show him
      // whenever any ride ran, invited or not.
      if (this.grownUpComing) this.parkRoot.add(this.grownUp.root);

      // The chute is in world coordinates now, so there is nothing to add back.
      this.ginormousSlide.pointAt(0, this.point);
      player.teleportTo(this.point.x, this.point.y + RIDER_LIFT, this.point.z);
      // Lying down in front, so set the composition order before the first
      // frame places them — see `GROWN_UP_RECLINE`.
      this.grownUp.root.rotation.order = 'YXZ';
      // And the same for the child, who is pitched down the slope now that the
      // chase camera means you can see her. Set here and put back in
      // `finishRide` rather than left on permanently: with a pitch of zero the
      // two orders are identical, so no other ride can tell the difference —
      // but the Rail Race *does* pass a non-zero pitch, and quietly changing
      // the frame it composes in would alter a ride the family has already
      // signed off, in a PR that is not about the Rail Race.
      player.group.rotation.order = 'YXZ';
      this.startRide(this.ginormousSlide, true, player);
      this.rideView?.board();
      this.onRideChange?.(true);
    });
  }

  private startRide(slide: SlideRide, giant: boolean, player: Player): void {
    this.controls.cancelWalk();
    this.controls.closeStairMenu();
    this.stairRide.stop(false);
    this.ride = { slide, giant, distance: 0 };
    player.beginRide();
  }

  private advanceRide(dt: number, player: Player): void {
    const ride = this.ride;
    if (!ride) return;

    // The ginormous slide has its own speed. See `GIANT_SLIDE_SPEED`: the
    // shared 12 m/s is 43 km/h, which is fine for the little helter-skelter
    // watched from outside and much too fast for a ride taken through a
    // six-year-old's own eyes round a bend that wraps a castle.
    ride.distance += (ride.giant ? GIANT_SLIDE_SPEED : SLIDE_SPEED) * dt;
    const t = ride.distance / ride.slide.length;

    if (t >= 1) {
      this.finishRide(ride, player);
      return;
    }

    ride.slide.pointAt(t, this.point);
    ride.slide.tangentAt(t, this.tangent);
    // The one owner for "where is this really?" — see `ridePointToWorld`. The
    // rider and the seat the camera hangs off now read the same answer, which
    // they did not before: the rider was 26.65 m off the chute for the whole
    // ride, and only the fact that she was hidden kept it out of sight.
    this.ridePointToWorld(ride, this.point, this.riderPoint);
    // **Pitched down the slope, not bolt upright.** `setRidePose`'s own
    // docstring warns about this: a ride that positions the player model
    // independently of any parent vehicle, and that drops, has to hand the
    // slope over explicitly or she stays vertical while the chute visibly falls
    // away under her. This ride has always failed that test and it never
    // showed, because until 5 August nobody could see her — the camera was
    // inside her head. Turning on the chase view is what made it visible, so
    // the fix belongs with it.
    const pitch = ride.giant ? slopeOf(this.tangent) : 0;
    player.setRidePose(
      this.riderPoint.x,
      this.riderPoint.y + RIDER_LIFT,
      this.riderPoint.z,
      Math.atan2(this.tangent.x, this.tangent.z),
      pitch,
    );

    // The seat the chase camera hangs off, following the same curve the rider
    // does, so what you see and where you are can never disagree.
    if (ride.giant) {
      ride.slide.pointAt(t, this.point);
      this.rideMount.position.copy(this.point);
      this.rideMount.position.y += RIDER_LIFT;
      this.rideMount.rotation.y = Math.atan2(this.tangent.x, this.tangent.z);
      // The mount leans with the chute so the camera rides *in the tube's own
      // frame*. Left level (as it was for first person, where it did not
      // matter) a camera 4.1 m behind sits 1.4 m off the chute floor on a 20°
      // pitch, and the trough's uphill side wall swings through the lens.
      // `rotation.order` is `YXZ` — set in the constructor, for the same reason
      // `GROWN_UP_RECLINE` needs it: yaw first, then pitch in the yawed frame.
      this.rideMount.rotation.x = slopeOf(this.tangent);
      this.rideView?.update(dt, this.elapsed);
    }

    if (ride.giant && this.grownUpComing) {
      // In front, and lying down. Clamped to the end of the chute so the
      // grown-up never runs off the far end while the child is still aboard.
      const lead = Math.min(ride.slide.length, ride.distance + GROWN_UP_LEAD) / ride.slide.length;
      ride.slide.pointAt(lead, this.point);
      ride.slide.tangentAt(lead, this.tangent);
      this.grownUp.root.position.copy(this.point);
      this.grownUp.root.position.y += RIDER_LIFT;
      this.grownUp.root.rotation.y = Math.atan2(this.tangent.x, this.tangent.z);
      this.grownUp.root.rotation.x = GROWN_UP_RECLINE;
    }
  }

  /**
   * **The balls scatter when she lands in them.**
   *
   * Watches the frames after the ginormous slide hands her back and fires
   * `BallPit.splash` on the one where she reaches the balls — see
   * {@link pendingSplash} for why it is not fired at `finishRide`.
   *
   * Touchdown is "she is no longer airborne, or she is at/below the ball
   * surface". The second clause is not belt-and-braces: `LANDING_DROP` is short
   * and the pit floor is scooped, so on a slow frame she can cross the whole
   * drop within one step and arrive already resting, having never been observed
   * airborne at all.
   *
   * The strength is above the walk-in splash the pit already does for a child
   * wading in (`BallPit.splash`'s default 1) because this is an arrival, not a
   * step — she comes out of the chute at {@link GIANT_SLIDE_SPEED} and the shot
   * is the whole payoff for the ride. It is still one impulse into the existing
   * simulation, not a second effect bolted beside it: the pit already knows how
   * to be disturbed, and `ballPhysics.ts` settles it back down on its own.
   */
  private settleIntoTheBalls(player: Player, dt: number): void {
    const pending = this.pendingSplash;
    if (!pending) return;

    pending.waited += dt;
    const ballsY = this.surfaces.sample(pending.x, pending.z, player.position.y);
    const landed = !player.isAirborne || player.position.y <= ballsY + 0.05;
    if (!landed && pending.waited < SPLASH_PATIENCE) return;

    this.pendingSplash = null;
    // Centred on where she actually is, not on where the plan said she would
    // be: if anything has moved her in the meantime, the balls should burst
    // away from the child, which is the thing a six-year-old is watching.
    this.ballPit.splash(
      player.position.x - BALL_PIT_X,
      player.position.z - BALL_PIT_Z,
      LANDING_SPLASH,
    );
  }

  /**
   * Where the ginormous slide's **seat** is — the mount the chase camera hangs
   * off — in world space.
   *
   * Exposed for `npm run check:slide-rider`, which asserts that the seat and
   * the rider are in the same place. They were not: the rider was 26.65 m away
   * for the whole ride (see {@link ridePointToWorld}), and because the camera
   * followed the seat and her model was hidden, nothing on screen disagreed.
   * A check that recomputed either one would have missed it, so the check reads
   * the real mount out of the real scene graph.
   */
  rideSeatWorldPosition(target: Vector3): Vector3 {
    this.rideMount.updateMatrixWorld(true);
    return target.setFromMatrixPosition(this.rideMount.matrixWorld);
  }

  /**
   * **Where a point on a ride's curve actually is, in the world.**
   *
   * The one owner for a question two functions used to answer differently, and
   * the bug that hid behind the disagreement is worth stating in full because
   * it survived a first-person ride, a peer review and a procgen suite.
   *
   * `advanceRide` placed the **rider** at `pointAt(t) + (BUILDING_CENTRE_X,
   * BUILDING_BASE_Y, BUILDING_CENTRE_Z)`, while `rideMount` — the **seat the
   * camera hangs off** — copied `pointAt(t)` straight through. Only one of them
   * can have been right, and it was the mount: the chute is built from
   * `SLIDE_PLAN.points`, which are already world coordinates, and it is added to
   * `parkRoot`, whose world offset is measured at exactly (0, 0, 0). Confirmed
   * against the built park: the chute ends at (8.86, 1.09, −28.46), 2.00 m from
   * the ball pit's centre, and the arithmetic above put the rider at (−6.48,
   * 1.53, −50.25) — **26.65 m away, in mid-air, for the whole ride**.
   *
   * Nobody could see it. The camera was on the mount and therefore correct, and
   * the rider's model was hidden because the ride was first person, so the one
   * thing in the wrong place was the one thing not being drawn. `boardGiantSlide`
   * had it right all along (`pointAt(0)` with nothing added, and a comment saying
   * why), which is what made the two versions look like a considered difference
   * rather than a mistake.
   *
   * Jim found it the moment the camera turned round: *"in the chase cam it seems
   * the player is still not drawn"*. She was drawn. She was 26 m away.
   *
   * The helter-skelter genuinely does need an offset — it is authored around the
   * interior's origin and ridden there — so the frame is a property of the ride,
   * asked once, here.
   */
  private ridePointToWorld(ride: ActiveRide, point: Vector3, target: Vector3): Vector3 {
    if (ride.giant) return target.copy(point);
    return target.set(
      point.x + INTERIOR_ORIGIN_X,
      point.y + BUILDING_BASE_Y,
      point.z + INTERIOR_ORIGIN_Z,
    );
  }

  private finishRide(ride: ActiveRide, player: Player): void {
    ride.slide.pointAt(1, this.point);
    ride.slide.tangentAt(1, this.tangent);

    // Same one owner as `advanceRide`, so where the ride *ends* and where it
    // was a frame earlier cannot be in different coordinate frames.
    const worldPosition = this.ridePointToWorld(ride, this.point, new Vector3());
    if (ride.giant) {
      // **She lands in the balls** — see `slide/landing.ts` for why she used to
      // land inside the chute instead, and why an offset could not have fixed
      // it. Carried on past the mouth along the heading she is already
      // travelling, so there is one description of where the ride ends rather
      // than two fanned off the same bearing with nothing keeping them level.
      //
      // The exit node is untouched and still means what it meant: it is what
      // `check:park` proves she can walk away from (GAME_DESIGN.md's EXIT
      // rule). She climbs out of the pit onto it. It is simply no longer the
      // place the ride drops her.
      const spot = slideLandingSpot(worldPosition.x, worldPosition.z, this.tangent.x, this.tangent.z, {
        x: BALL_PIT_X,
        z: BALL_PIT_Z,
        radius: BALL_PIT_RADIUS,
      });
      // The scooped pit floor, from the same sampler her own feet use all the
      // rest of the time — not `terrainHeight`, which is a pure function of the
      // hills and does not know the pit has been dug out of them.
      const ballsY = this.surfaces.sample(spot.x, spot.z, worldPosition.y);
      player.setRidePose(
        spot.x,
        ballsY + LANDING_DROP,
        spot.z,
        Math.atan2(this.tangent.x, this.tangent.z),
      );
      // Back to the default composition order now the slope no longer applies
      // (see `startGiantSlide`), and level: she arrives feet first.
      player.group.rotation.order = 'XYZ';
      player.group.rotation.x = 0;
      // Handed back still moving, so the last thing the slide does is deliver
      // her rather than switch off. Gravity closes the {@link LANDING_DROP}.
      player.endRide(this.tangent.x * 1.4, -0.6, this.tangent.z * 1.4);
      // The balls scatter when she *hits* them, not now — `update` watches for
      // the touchdown. See {@link pendingSplash}.
      this.pendingSplash = { x: spot.x, z: spot.z, waited: 0 };
      this.grownUpComing = false;
      // Back up onto the roof, to wait for the next one.
      this.interiorRoot.add(this.grownUp.root);
      this.grownUp.root.rotation.x = 0;
      this.placeGrownUp();
      this.spaceCooldown = SPACE_COOLDOWN;
      this.onRideChange?.(false);
    } else {
      player.setRidePose(
        worldPosition.x,
        worldPosition.y,
        worldPosition.z,
        Math.atan2(this.tangent.x, this.tangent.z),
      );
      player.endRide(this.tangent.x * 3.5, 1.2, this.tangent.z * 3.5);
    }
    this.ride = null;
  }

  /**
   * The three things inside the building a press can do, one method each.
   *
   * These were one `handleInteractPress(player, pressed)` that read the key,
   * measured three patches of floor and gave the press to the first claimant.
   * That rule was sound *within* this file and useless outside it: five other
   * systems were measuring their own patches of floor for the same key at the
   * same time, which is GitHub issue #122. Each is now the run body of one
   * zone's chip (`building/interactZones.ts`), so the thing that happens is the
   * thing the child was shown.
   *
   * The gates that remain are not "is this press mine?" — the selection has
   * already settled that. They are "is this still possible?", re-checked because
   * a chip pressed from across the room walks her there first.
   */
  openStairs(deck: number): void {
    if (!this.inside || this.ride || this.changingSpace) return;
    const player = this.player;
    if (!player || player.riding) return;
    // The deck she is actually standing on, not the one the chip was drawn for:
    // five decks share a stairwell shaft, so a stale chip must not open the
    // menu for a floor she has since left.
    const standing = this.surfaces.deckAt(player.position.x, player.position.z, player.position.y);
    this.controls.openStairMenu(standing ?? deck);
  }

  /**
   * Inside the room, not near it. GAME_DESIGN.md, 27 July 2026: *"you do not use
   * the toilet from the doorway"* — a radius round the stand spot reached back
   * out into the corridor, which is precisely what the family objected to. The
   * rectangle is the room, so this only lands once she is in.
   *
   * `TOILET_STAND` is a spot *inside* `TOILET_ROOM`, so a chip pressed from the
   * corridor walks her in and then passes this; pressing it while standing in
   * the doorway does not.
   */
  useToilets(): void {
    if (!this.inside || this.ride || this.changingSpace) return;
    const player = this.player;
    if (!player || player.riding) return;
    const localX = player.position.x - INTERIOR_ORIGIN_X;
    const localZ = player.position.z - INTERIOR_ORIGIN_Z;
    const deck = this.surfaces.deckAt(player.position.x, player.position.z, player.position.y);
    if (deck !== TOILET_DECK || !regionContains(TOILET_ROOM, localX, localZ)) return;
    this.toilets.use();
  }

  /** "Come with me!" / "never mind" — the grown-up follows, or stops. */
  askGrownUp(): void {
    if (!this.inside || this.ride || this.changingSpace) return;
    const player = this.player;
    if (!player || player.riding) return;
    this.grownUpComing = !this.grownUpComing;
  }

  /**
   * Is a child in the toilet room right now?
   *
   * Asked fresh every frame and answered only from her current position — no
   * flag set on the way in and cleared on the way out, because a flag is
   * something a reload or an unexpected exit can leave stuck, and the one
   * thing the privacy roof must never do is shut her in. See `Toilets`.
   *
   * `deckAt` returns `null` out in the park, so the world-space test and the
   * interior-local one can never be confused for each other.
   */
  private toiletOccupied(): boolean {
    const player = this.player;
    if (!player) return false;
    const { x, y, z } = player.position;
    if (this.surfaces.deckAt(x, z, y) !== TOILET_DECK) return false;
    return this.toilets.occupies(x - INTERIOR_ORIGIN_X, z - INTERIOR_ORIGIN_Z);
  }

  private placeGrownUp(): void {
    this.grownUp.root.position.set(GROWN_UP_X, TOP_DECK * BUILDING_FLOOR_HEIGHT, GROWN_UP_Z);
    this.grownUp.root.rotation.y = Math.PI * 0.75;
  }

  // -------------------------------------------------------------- machinery

  private handleTrampoline(player: Player): void {
    const onPad =
      this.trampoline.covers(player.position.x, player.position.z) &&
      Math.abs(player.position.y - this.trampoline.surfaceY) < 0.4;

    if (onPad && (!this.wasOnPad || (this.wasAirborne && !player.isAirborne))) {
      player.launch(this.trampoline.bounce());
    }

    this.wasOnPad = onPad;
    this.wasAirborne = player.isAirborne;
  }

  private handleEscalator(player: Player, dt: number): void {
    if (player.isAirborne || !this.inside) return;
    const carry = this.escalators.carry(
      player.position.x - INTERIOR_ORIGIN_X,
      player.position.z - INTERIOR_ORIGIN_Z,
      player.position.y,
      BUILDING_BASE_Y,
      dt,
    );
    if (carry !== 0) player.nudge(0, carry);
  }
}

// ---------------------------------------------------------------- geometry

function near(x: number, z: number, targetX: number, targetZ: number, radius: number): boolean {
  const dx = x - targetX;
  const dz = z - targetZ;
  return dx * dx + dz * dz <= radius * radius;
}

/**
 * The helter-skelter: 1.75 anticlockwise oval turns from deck two down to the
 * ground floor, wound round the east shaft.
 *
 * The turns go anticlockwise so that the tangent where the helix begins already
 * points the way the lead-in was heading — start it the other way round and the
 * chute doubles back on itself at the mouth.
 */
function buildHelterSkelter(): SlideRide {
  const top = HELTER_DECK * BUILDING_FLOOR_HEIGHT;
  const helixTop = top - 0.35;
  const helixBottom = 0.75;

  const points: Vector3[] = [
    new Vector3(HELTER_MOUTH_X, top, HELTER_ENTRY_Z),
    new Vector3(HELTER_MOUTH_X + 0.6, top - 0.15, HELTER_CENTRE_Z + 1.0),
  ];

  const sweep = TAU * 1.75;
  const steps = 16;
  for (let i = 0; i <= steps; i += 1) {
    const angle = Math.PI + (sweep * i) / steps;
    const t = i / steps;
    points.push(
      new Vector3(
        HELTER_CENTRE_X + Math.cos(angle) * HELTER_SEMI_X,
        helixTop + (helixBottom - helixTop) * t,
        HELTER_CENTRE_Z + Math.sin(angle) * HELTER_SEMI_Z,
      ),
    );
  }

  points.push(
    new Vector3(HELTER_CENTRE_X - 2.2, 0.45, HELTER_CENTRE_Z + 2.6),
    new Vector3(HELTER_CENTRE_X - 4.4, 0.28, HELTER_CENTRE_Z + 3),
  );

  const slide = new SlideRide(points, {
    name: 'helter-skelter',
    colour: PALETTE.markerLilac,
    railColour: PALETTE.markerLemon,
  });
  // Indoors, inside a shaft: its shadow would land on nothing anybody can see.
  slide.setCastsShadow(false);
  return slide;
}

/**
 * The ginormous slide, built from its solved plan.
 *
 * This used to be twelve hand-authored absolute world coordinates, and #118 is
 * what that cost: the castle's position is per-seed and those numbers were not,
 * so eight of the twelve ended up inside the tower's own footprint — including
 * the last one, which landed behind a solid wall segment and sealed a
 * six-year-old inside with no way out.
 *
 * Now the shape comes from `slide/plan.ts`, solved from the park layout at
 * module load. The only thing left here is the shift from world space into the
 * facade's, which the garden group's own offset then cancels exactly.
 */
function buildGinormousSlide(): SlideRide {
  // Straight through in world space: the chute hangs at park level, whose group
  // is the identity, so the plan's own coordinates are the ones to build with.
  // Everything that travels along it — the seat, the grown-up, the teleport —
  // reads `pointAt` and therefore reads world space too.
  const points = SLIDE_PLAN.points.map((p) => new Vector3(p.x, p.y, p.z));

  return new SlideRide(points, {
    name: 'ginormous-slide',
    colour: PALETTE.slideChute,
    railColour: PALETTE.slideRail,
  });
}

/**
 * Little painted pads so a child can see where a thing begins.
 *
 * Each of these used to have a small board beside it naming the ride. The
 * boards went with every other sign in the park on 28 July 2026 (the family:
 * they are hard to read), and the pads — a disc of the ride's own colour,
 * readable from right across the deck at the camera's fixed angle — turned out
 * to be doing most of the work anyway. The stairs and the grown-up say their
 * names on the sign card now (`building/interactZones.ts`); the helter-skelter
 * and the ginormous slide are things you use by *arriving*, so they offer no
 * actions, are not selectable, and have only their pad. Which is the same
 * answer the SELECTION RULE already gave them.
 */
function addRideEntrances(floorGroups: readonly Group[]): void {
  const helterFloor = floorGroups[HELTER_DECK];
  if (helterFloor) {
    helterFloor.add(entrancePad(HELTER_ENTRY_X, HELTER_ENTRY_Z, PALETTE.markerLilac));
  }

  // The stairs get a pad on every deck. This is the one thing in the building
  // you press a button at rather than walk up, so it has to be the most obvious
  // thing on the floor.
  for (let deck = 0; deck < floorGroups.length; deck += 1) {
    const floor = floorGroups[deck];
    if (!floor) continue;
    floor.add(entrancePad(STAIR_STAND_X, STAIR_STAND_Z, PALETTE.markerMint));
  }

  const topFloor = floorGroups[TOP_DECK];
  if (topFloor) {
    topFloor.add(entrancePad(SLIDE_PLAN.entryX, SLIDE_PLAN.entryZ, PALETTE.slideChute));
  }
}

function entrancePad(x: number, z: number, colour: number): Mesh {
  const pad = new Mesh(new CylinderGeometry(1.2, 1.2, 0.08, 24), softMaterial(colour, 0.6));
  pad.receiveShadow = true;
  pad.position.set(x, 0.04, z);
  return pad;
}

// --------------------------------------------------------------- collision

/**
 * The interior shell is solid apart from its two doorways. Collision is
 * height-blind, so these walls hold on every deck at once — which is exactly
 * what you want for a building, and the reason the lift shaft gets its own
 * three sides.
 */
function registerInteriorCollision(collision: CollisionWorld): void {
  const west = worldX(-INTERIOR_HALF_X);
  const east = worldX(INTERIOR_HALF_X);
  const north = worldZ(-INTERIOR_HALF_Z);
  const south = worldZ(INTERIOR_HALF_Z);

  collision.addWall(west, north, east, north, 0.3);
  collision.addWall(west, north, west, south, 0.3);

  // South face, minus the way out.
  collision.addWall(west, south, worldX(INTERIOR_DOOR_MIN_X), south, 0.3);
  collision.addWall(worldX(INTERIOR_DOOR_MAX_X), south, east, south, 0.3);

  // East face, minus the way into the lift.
  collision.addWall(east, north, east, worldZ(LIFT_DOOR_MIN_Z), 0.3);
  collision.addWall(east, worldZ(LIFT_DOOR_MAX_Z), east, south, 0.3);

  // Stairs and escalator: a wall down each side of every ramp, so a wobbly
  // step sideways meets a rail instead of open air. Footprints do not depend
  // on which deck you asked for, and collision is height-blind, so one
  // registration guards every storey at once. The stairs are a switchback —
  // two flights side by side — and the shared inner edge between them is the
  // most dangerous one of all: at any given z the two flights are mid-climb by
  // different amounts, so stepping across it is not a level step sideways,
  // it is stepping off a ledge into thin air. Walling both flights' full
  // footprints on both edges covers that shared edge twice over, which costs
  // nothing and cannot leave a gap.
  const [stairFlightA, stairFlightB] = stairFlights(0);
  addRampSideWalls(collision, stairFlightA);
  addRampSideWalls(collision, stairFlightB);
  addRampSideWalls(collision, escalatorRamp(0));
}

/** A collision wall down each long edge of a ramp's footprint. */
function addRampSideWalls(collision: CollisionWorld, ramp: RampDefinition): void {
  const { minX, maxX, minZ, maxZ } = ramp.footprint;
  collision.addWall(worldX(minX), worldZ(minZ), worldX(minX), worldZ(maxZ), 0.2);
  collision.addWall(worldX(maxX), worldZ(minZ), worldX(maxX), worldZ(maxZ), 0.2);
}

/**
 * The facade out in the garden is a solid block with a doorway in it.
 *
 * The doorway leads to a metre and a half of lobby and then a wall, because
 * there is nothing behind it: cross that threshold and the game takes you
 * somewhere else entirely. The back wall is what stops a child who keeps walking
 * during the quarter-second the iris takes to close from ending up inside a
 * solid tower.
 */
function registerFacadeCollision(collision: CollisionWorld): void {
  const west = facadeX(-BUILDING_HALF_X);
  const east = facadeX(BUILDING_HALF_X);
  const north = facadeZ(-BUILDING_HALF_Z);
  const south = facadeZ(BUILDING_HALF_Z);

  collision.addWall(west, north, east, north, 0.3);
  collision.addWall(west, north, west, south, 0.3);
  collision.addWall(east, north, east, south, 0.3);

  collision.addWall(west, south, facadeX(ENTRANCE_MIN_X), south, 0.3);
  collision.addWall(facadeX(ENTRANCE_MAX_X), south, east, south, 0.3);

  // The back of the lobby.
  const lobbyZ = facadeZ(BUILDING_HALF_Z - 1.8);
  collision.addWall(facadeX(ENTRANCE_MIN_X), lobbyZ, facadeX(ENTRANCE_MAX_X), lobbyZ, 0.3);
}
