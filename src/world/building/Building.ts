import { CylinderGeometry, Group, Mesh, Vector3 } from 'three';
import {
  BUILDING_CENTRE_X,
  BUILDING_CENTRE_Z,
  BUILDING_FLOOR_HEIGHT,
  BUILDING_HALF_X,
  BUILDING_HALF_Z,
  GARDEN_PLAY_RADIUS,
  INTERIOR_HALF_X,
  INTERIOR_HALF_Z,
  INTERIOR_ORIGIN_X,
  INTERIOR_ORIGIN_Z,
  INTERIOR_PLAY_RADIUS,
  SLIDE_SPEED,
} from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { TAU } from '../../core/mathUtils';
import type { FrameContext, GameSystem } from '../../core/types';
import type { CollisionWorld } from '../Collision';
import type { AnchorPlots } from '../AnchorPlots';
import type { Player } from '../../entities/Player';
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
import { cuteSign, softMaterial } from './parts';
import {
  BALL_PIT_X,
  BALL_PIT_Z,
  BUILDING_BASE_Y,
  ENTRANCE_MAX_X,
  ENTRANCE_MIN_X,
  GIANT_SLIDE_ENTRY_X,
  GIANT_SLIDE_ENTRY_Z,
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
/** How far behind you the grown-up rides, in metres of slide. */
const GROWN_UP_TRAIL = 2.6;

/** Seconds after a change of space before another one may be triggered. */
const SPACE_COOLDOWN = 0.9;

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
   * The building's own space. Added straight to the scene rather than to the
   * `building` anchor plot, because it is nowhere near the plot — that is the
   * whole idea.
   */
  readonly interiorRoot = new Group();

  private readonly shell = new BuildingShell('interior');
  private readonly facade = new BuildingShell('facade');
  /** The facade, the ginormous slide, and the grown-up while they ride it. */
  private readonly gardenRoot = new Group();

  private readonly escalators: Escalators;
  private readonly lift: GlassLift;
  private readonly liftRide: LiftRide;
  private readonly trampoline = new Trampoline();
  private readonly bubble = new Bubble();
  private readonly fader = new FloorFader();
  private readonly grownUp = new GrownUp();
  private readonly toilets: Toilets;
  private readonly helterSkelter: SlideRide;
  private readonly ginormousSlide: SlideRide;
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
    this.ginormousSlide = buildGinormousSlide();
    this.gardenRoot.add(this.ginormousSlide.group);

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
    });
  }

  /** Hands the building the player, so it can carry, bounce and ride them. */
  attachPlayer(player: Player): void {
    this.player = player;
    player.groundSampler = (x, z, y) => this.surfaces.sample(x, z, y);
    this.liftRide.attachPlayer(player);
    this.ballPit.attachPlayer(player);
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

  /** The Climb / Descend menu was answered. */
  takeStairs(deck: number, direction: StairDirection): void {
    if (!this.player || this.player.riding || !this.inside) return;
    this.stairRide.start(deck, direction);
  }

  update(context: FrameContext): void {
    const { dt, elapsed, input } = context;

    if (this.spaceCooldown > 0) this.spaceCooldown -= dt;

    // Read once and dispatched to every claimant below, so the lift and the
    // interior's own interact handling can never both react to the same
    // press (see `handleInteractPress`'s "first claimant wins" doc comment).
    const interactPressed = input.justPressed('interact');

    this.liftRide.update(dt);
    this.bubble.update(dt, elapsed);
    this.escalators.update(dt);
    this.trampoline.update(dt);
    this.toilets.update(dt, elapsed, this.toiletOccupied());
    this.ballPit.update(dt, elapsed);

    const player = this.player;
    if (!player) return;

    this.stairRide.update(dt);

    if (this.ride) {
      this.advanceRide(dt, player);
    } else if (!this.changingSpace && !player.riding) {
      this.handleInteractPress(player, interactPressed);
      this.handleTrampoline(player);
      this.handleEscalator(player, dt);
      this.checkRideTriggers(player);
      this.checkDoorways(player);
    }

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
    this.collision.setPlayBounds(INTERIOR_ORIGIN_X, INTERIOR_ORIGIN_Z, INTERIOR_PLAY_RADIUS);
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
    this.collision.setPlayBounds(0, 0, GARDEN_PLAY_RADIUS);
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
      near(localX, localZ, GIANT_SLIDE_ENTRY_X, GIANT_SLIDE_ENTRY_Z, 1.9) &&
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
      if (this.grownUpComing) this.gardenRoot.add(this.grownUp.root);

      this.ginormousSlide.pointAt(0, this.point);
      player.teleportTo(
        this.point.x + BUILDING_CENTRE_X,
        this.point.y + BUILDING_BASE_Y + RIDER_LIFT,
        this.point.z + BUILDING_CENTRE_Z,
      );
      this.startRide(this.ginormousSlide, true, player);
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

    ride.distance += SLIDE_SPEED * dt;
    const t = ride.distance / ride.slide.length;

    if (t >= 1) {
      this.finishRide(ride, player);
      return;
    }

    // The helter-skelter is inside and the ginormous slide is out in the park —
    // each is authored around its own origin, so each is ridden around it too.
    const originX = ride.giant ? BUILDING_CENTRE_X : INTERIOR_ORIGIN_X;
    const originZ = ride.giant ? BUILDING_CENTRE_Z : INTERIOR_ORIGIN_Z;

    ride.slide.pointAt(t, this.point);
    ride.slide.tangentAt(t, this.tangent);
    player.setRidePose(
      this.point.x + originX,
      this.point.y + BUILDING_BASE_Y + RIDER_LIFT,
      this.point.z + originZ,
      Math.atan2(this.tangent.x, this.tangent.z),
    );

    if (ride.giant && this.grownUpComing) {
      const trail = Math.max(0, ride.distance - GROWN_UP_TRAIL) / ride.slide.length;
      ride.slide.pointAt(trail, this.point);
      ride.slide.tangentAt(trail, this.tangent);
      this.grownUp.root.position.copy(this.point);
      this.grownUp.root.position.y += RIDER_LIFT;
      this.grownUp.root.rotation.y = Math.atan2(this.tangent.x, this.tangent.z);
    }
  }

  private finishRide(ride: ActiveRide, player: Player): void {
    const originX = ride.giant ? BUILDING_CENTRE_X : INTERIOR_ORIGIN_X;
    const originZ = ride.giant ? BUILDING_CENTRE_Z : INTERIOR_ORIGIN_Z;

    ride.slide.pointAt(1, this.point);
    ride.slide.tangentAt(1, this.tangent);

    const worldPosition = new Vector3(
      this.point.x + originX,
      this.point.y + BUILDING_BASE_Y,
      this.point.z + originZ,
    );
    player.setRidePose(
      worldPosition.x,
      worldPosition.y,
      worldPosition.z,
      Math.atan2(this.tangent.x, this.tangent.z),
    );
    player.endRide(this.tangent.x * 3.5, 1.2, this.tangent.z * 3.5);

    if (ride.giant) {
      this.ballPit.splash(worldPosition.x - BALL_PIT_X, worldPosition.z - BALL_PIT_Z, 1.15);
      this.grownUpComing = false;
      // Back up onto the roof, to wait for the next one.
      this.interiorRoot.add(this.grownUp.root);
      this.placeGrownUp();
      this.spaceCooldown = SPACE_COOLDOWN;
    }
    this.ride = null;
  }

  /**
   * One interact press, shared out.
   *
   * Each thing checks its own little patch of floor and the first to claim the
   * press wins, which is the same rule the tap zones use — so pressing E and
   * tapping a thing can never disagree about what you meant.
   */
  private handleInteractPress(player: Player, pressed: boolean): void {
    if (!pressed || !this.inside) return;
    const localX = player.position.x - INTERIOR_ORIGIN_X;
    const localZ = player.position.z - INTERIOR_ORIGIN_Z;
    const deck = this.surfaces.deckAt(player.position.x, player.position.z, player.position.y);

    if (deck !== null && near(localX, localZ, STAIR_STAND_X, STAIR_STAND_Z, 3.6)) {
      this.controls.openStairMenu(deck);
      return;
    }

    // Inside the room, not near it. GAME_DESIGN.md, 27 July 2026: *"you do not
    // use the toilet from the doorway"* — a radius round the stand spot reached
    // back out into the corridor, which is precisely what the family objected
    // to. The rectangle is the room, so the press only lands once she is in.
    if (deck === TOILET_DECK && regionContains(TOILET_ROOM, localX, localZ)) {
      this.toilets.use();
      return;
    }

    if (
      Math.abs(player.position.y - BUILDING_BASE_Y - TOP_DECK * BUILDING_FLOOR_HEIGHT) < 1.4 &&
      near(localX, localZ, GROWN_UP_X, GROWN_UP_Z, 4)
    ) {
      this.grownUpComing = !this.grownUpComing;
    }
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
 * The ginormous slide. Authored in world coordinates because the shape of it is
 * a fact about the park, not about the building, then shifted into facade space.
 */
function buildGinormousSlide(): SlideRide {
  const b = BUILDING_BASE_Y;
  const world: readonly (readonly [number, number, number])[] = [
    [-19.0, b + 14.4, -24.5],
    [-18.8, b + 13.3, -20.6],
    [-17.4, b + 11.9, -17.2],
    [-14.6, b + 10.5, -14.6],
    [-11.0, b + 9.0, -12.2],
    [-6.0, b + 7.2, -11.0],
    [-1.6, b + 5.3, -14.4],
    [-2.6, b + 3.5, -19.6],
    [-7.6, b + 2.4, -22.4],
    [-13.6, b + 1.5, -20.2],
    [-15.6, 1.3, -16.4],
    [-10.8, 0.05, -14.8],
  ];

  const points = world.map(
    ([x, y, z]) =>
      new Vector3(x - BUILDING_CENTRE_X, y - BUILDING_BASE_Y, z - BUILDING_CENTRE_Z),
  );

  return new SlideRide(points, {
    name: 'ginormous-slide',
    colour: PALETTE.slideChute,
    railColour: PALETTE.slideRail,
  });
}

/** Little painted pads and signs so a child can see where a thing begins. */
function addRideEntrances(floorGroups: readonly Group[]): void {
  const helterFloor = floorGroups[HELTER_DECK];
  if (helterFloor) {
    helterFloor.add(
      entrancePad(HELTER_ENTRY_X, HELTER_ENTRY_Z, PALETTE.markerLilac),
      entranceSign(
        HELTER_ENTRY_X - 0.4,
        HELTER_ENTRY_Z + 1.6,
        'Helter-skelter',
        '🌀',
        PALETTE.markerLilac,
      ),
    );
  }

  // The stairs get a pad and a board on every deck. This is the one thing in the
  // building you press a button at rather than walk up, so it has to be the most
  // obvious thing on the floor.
  for (let deck = 0; deck < floorGroups.length; deck += 1) {
    const floor = floorGroups[deck];
    if (!floor) continue;
    floor.add(
      entrancePad(STAIR_STAND_X, STAIR_STAND_Z, PALETTE.markerMint),
      entranceSign(
        STAIR_STAND_X,
        STAIR_STAND_Z + 1.7,
        'Stairs',
        '🪜',
        PALETTE.markerMint,
        'tap for a ride up or down!',
      ),
    );
  }

  const topFloor = floorGroups[TOP_DECK];
  if (topFloor) {
    topFloor.add(
      entrancePad(GIANT_SLIDE_ENTRY_X, GIANT_SLIDE_ENTRY_Z, PALETTE.slideChute),
      entranceSign(
        GIANT_SLIDE_ENTRY_X,
        GIANT_SLIDE_ENTRY_Z - 2.4,
        'Ginormous Slide',
        '🎢',
        PALETTE.slideChute,
        'off the roof to the ball pit!',
      ),
      entranceSign(
        GROWN_UP_X,
        GROWN_UP_Z - 1.6,
        'Press E',
        '🤗',
        PALETTE.grownUpScarf,
        'a grown-up comes too!',
      ),
    );
  }
}

function entrancePad(x: number, z: number, colour: number): Mesh {
  const pad = new Mesh(new CylinderGeometry(1.2, 1.2, 0.08, 24), softMaterial(colour, 0.6));
  pad.receiveShadow = true;
  pad.position.set(x, 0.04, z);
  return pad;
}

function entranceSign(
  x: number,
  z: number,
  title: string,
  glyph: string,
  accent: number,
  subtitle = 'step on!',
): Mesh {
  const sign = cuteSign({ title, subtitle, glyph, accent, width: 2.1 });
  sign.position.set(x, 1.8, z);
  // Left facing +Z: that is where the default isometric camera looks from, and
  // the plot signs in the garden follow the same rule for the same reason.
  return sign;
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
