import { CylinderGeometry, Group, Mesh, Vector3 } from 'three';
import {
  BUILDING_CENTRE_X,
  BUILDING_CENTRE_Z,
  BUILDING_FLOOR_HEIGHT,
  BUILDING_HALF_X,
  BUILDING_HALF_Z,
  SLIDE_SPEED,
} from '../../core/constants';
import { PALETTE } from '../../core/palette';
import { TAU } from '../../core/mathUtils';
import type { FrameContext, GameSystem } from '../../core/types';
import type { CollisionWorld } from '../Collision';
import type { AnchorPlots } from '../AnchorPlots';
import type { Player } from '../../entities/Player';

import { BallPit } from './BallPit';
import { Bubble } from './Bubble';
import { Escalators } from './Escalators';
import { FloorFader } from './floorFade';
import { GlassLift } from './GlassLift';
import { GrownUp } from './GrownUp';
import { BuildingShell } from './Shell';
import { ShopUnits } from './ShopUnits';
import { SlideRide } from './SlideRide';
import { Stairs } from './Stairs';
import { Trampoline } from './Trampoline';
import { WalkSurfaces } from './surfaces';
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
  LIFT_DOOR_MAX_Z,
  LIFT_DOOR_MIN_Z,
  LIFT_SHAFT,
  TOP_DECK,
  worldX,
  worldZ,
} from './layout';

const RIDER_LIFT = 0.06;
/** How far behind you the grown-up rides, in metres of slide. */
const GROWN_UP_TRAIL = 2.6;

interface ActiveRide {
  readonly slide: SlideRide;
  readonly giant: boolean;
  distance: number;
}

/**
 * The big building, and everything inside its shell.
 *
 * Five decks with seven empty shop units, and six different ways to get between
 * them: stairs, an escalator per storey, a self-driving glass lift on the
 * outside wall, a trampoline that throws you two floors up, a floating bubble,
 * and a helter-skelter to whoosh back down. From the top deck the ginormous
 * slide swoops out of the building and lands in the ball pit in the garden.
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
  readonly shops: ShopUnits;
  readonly ballPit = new BallPit();

  /** Everything in building-local space; `y = 0` is the ground-floor deck. */
  private readonly root = new Group();
  private readonly shell = new BuildingShell();
  private readonly escalators: Escalators;
  private readonly lift: GlassLift;
  private readonly trampoline = new Trampoline();
  private readonly bubble = new Bubble();
  private readonly fader = new FloorFader();
  private readonly grownUp = new GrownUp();
  private readonly helterSkelter: SlideRide;
  private readonly ginormousSlide: SlideRide;

  private player: Player | null = null;
  private ride: ActiveRide | null = null;
  private grownUpComing = false;
  private wasOnPad = false;
  private wasAirborne = false;

  private readonly point = new Vector3();
  private readonly tangent = new Vector3();

  constructor(collision: CollisionWorld, anchorPlots: AnchorPlots) {
    this.root.name = 'the-big-building';
    this.root.add(this.shell.group);

    this.shops = new ShopUnits(this.shell.floorGroups, collision);
    // Stairs are pure geometry: what you walk on is declared in `layout.ts`.
    new Stairs(this.shell.floorGroups);
    this.escalators = new Escalators(this.shell.floorGroups);
    this.lift = new GlassLift(collision);
    this.root.add(this.lift.group);

    const ground = this.shell.floorGroups[0];
    if (ground) ground.add(this.trampoline.group);
    this.root.add(this.bubble.group);

    this.helterSkelter = buildHelterSkelter();
    this.ginormousSlide = buildGinormousSlide();
    this.root.add(this.helterSkelter.group, this.ginormousSlide.group);

    addRideEntrances(this.shell.floorGroups);
    this.placeGrownUp();
    this.root.add(this.grownUp.root);

    // Walkable surfaces that are not part of a deck.
    this.surfaces.addPlatform(this.lift);
    this.surfaces.addPlatform(this.bubble);
    this.surfaces.addPlatform(this.trampoline);

    registerShellCollision(collision);

    // Slot into the reserved plots and clear their "coming soon" dressing.
    const plot = anchorPlots.getGroup('building');
    const plotAnchor = plot.position;
    this.root.position.set(
      BUILDING_CENTRE_X - plotAnchor.x,
      BUILDING_BASE_Y - plotAnchor.y,
      BUILDING_CENTRE_Z - plotAnchor.z,
    );
    plot.add(this.root);
    anchorPlots.setPlaceholderVisible('building', false);

    const pitPlot = anchorPlots.getGroup('ballPit');
    pitPlot.add(this.ballPit.group);
    anchorPlots.setPlaceholderVisible('ballPit', false);

    // The cutaway needs the floors registered bottom to top, roof last.
    for (const floor of this.shell.floorGroups) this.fader.addLayer(floor);
    this.fader.addLayer(this.shell.roofGroup);
  }

  /** Hands the building the player, so it can carry, bounce and ride them. */
  attachPlayer(player: Player): void {
    this.player = player;
    player.groundSampler = (x, z, y) => this.surfaces.sample(x, z, y);
  }

  update(context: FrameContext): void {
    const { dt, elapsed, input } = context;

    this.callLiftIfWaiting();
    this.lift.update(dt, this.riderInLift(), input.justPressed('interact'));
    this.bubble.update(dt, elapsed);
    this.escalators.update(dt);
    this.trampoline.update(dt);
    this.ballPit.update(dt, elapsed);

    const player = this.player;
    if (!player) return;

    if (this.ride) {
      this.advanceRide(dt, player);
    } else {
      this.handleGrownUpRequest(player, input.justPressed('interact'));
      this.handleTrampoline(player);
      this.handleEscalator(player, dt);
      this.checkRideTriggers(player);
    }

    this.grownUp.update(dt, elapsed, this.grownUpComing);
    this.updateCutaway(player);
    this.fader.update(dt);
  }

  // ------------------------------------------------------------- cutaway

  private updateCutaway(player: Player): void {
    const floor = this.surfaces.deckAt(player.position.x, player.position.z, player.position.y);
    this.fader.setVisibleUpTo(floor);

    // The grown-up and the ginormous slide both belong to the top deck but live
    // outside the fader (they have to stay visible during a ride, when the
    // player is nowhere near a floor). Hide them by hand instead.
    const topDeckShown = this.ride !== null || floor === null || floor >= TOP_DECK;
    this.grownUp.root.visible = topDeckShown;
    this.ginormousSlide.group.visible = topDeckShown;
  }

  // ---------------------------------------------------------------- rides

  private checkRideTriggers(player: Player): void {
    const localX = player.position.x - BUILDING_CENTRE_X;
    const localZ = player.position.z - BUILDING_CENTRE_Z;
    const localY = player.position.y - BUILDING_BASE_Y;

    if (
      near(localX, localZ, HELTER_ENTRY_X, HELTER_ENTRY_Z, 1.5) &&
      Math.abs(localY - HELTER_DECK * BUILDING_FLOOR_HEIGHT) < 1.2
    ) {
      this.startRide(this.helterSkelter, false, player);
      return;
    }

    if (
      near(localX, localZ, GIANT_SLIDE_ENTRY_X, GIANT_SLIDE_ENTRY_Z, 1.7) &&
      Math.abs(localY - TOP_DECK * BUILDING_FLOOR_HEIGHT) < 1.2
    ) {
      this.startRide(this.ginormousSlide, true, player);
    }
  }

  private startRide(slide: SlideRide, giant: boolean, player: Player): void {
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

    ride.slide.pointAt(t, this.point);
    ride.slide.tangentAt(t, this.tangent);
    player.setRidePose(
      this.point.x + BUILDING_CENTRE_X,
      this.point.y + BUILDING_BASE_Y + RIDER_LIFT,
      this.point.z + BUILDING_CENTRE_Z,
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
    ride.slide.pointAt(1, this.point);
    ride.slide.tangentAt(1, this.tangent);

    const worldPosition = new Vector3(
      this.point.x + BUILDING_CENTRE_X,
      this.point.y + BUILDING_BASE_Y,
      this.point.z + BUILDING_CENTRE_Z,
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
      this.placeGrownUp();
    }
    this.ride = null;
  }

  private handleGrownUpRequest(player: Player, pressed: boolean): void {
    if (!pressed) return;
    const localX = player.position.x - BUILDING_CENTRE_X;
    const localZ = player.position.z - BUILDING_CENTRE_Z;
    const localY = player.position.y - BUILDING_BASE_Y;
    if (Math.abs(localY - TOP_DECK * BUILDING_FLOOR_HEIGHT) > 1.4) return;
    if (!near(localX, localZ, GROWN_UP_X, GROWN_UP_Z, 4)) return;
    this.grownUpComing = !this.grownUpComing;
  }

  private placeGrownUp(): void {
    this.grownUp.root.position.set(
      GROWN_UP_X,
      TOP_DECK * BUILDING_FLOOR_HEIGHT,
      GROWN_UP_Z,
    );
    this.grownUp.root.rotation.y = Math.PI * 0.75;
  }

  // ------------------------------------------------------------ machinery

  /**
   * Standing at the lift doors fetches the car.
   *
   * Without this the lift is a lottery: five floors at three seconds a stop
   * means half a minute of waiting, which is not a thing to ask of a
   * six-year-old who can see the stairs from where they are standing.
   */
  private callLiftIfWaiting(): void {
    const player = this.player;
    if (!player || player.riding) return;
    const localX = player.position.x - BUILDING_CENTRE_X;
    const localZ = player.position.z - BUILDING_CENTRE_Z;
    if (localX < BUILDING_HALF_X - 2.5 || localX > LIFT_SHAFT.maxX) return;
    if (localZ < LIFT_DOOR_MIN_Z - 0.6 || localZ > LIFT_DOOR_MAX_Z + 0.6) return;

    const deck = this.surfaces.deckAt(player.position.x, player.position.z, player.position.y);
    if (deck !== null) this.lift.callTo(deck);
  }

  private riderInLift(): boolean {
    const player = this.player;
    if (!player) return false;
    return (
      this.lift.covers(player.position.x, player.position.z) &&
      Math.abs(player.position.y - this.lift.surfaceY) < 0.5
    );
  }

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
    if (player.isAirborne) return;
    const carry = this.escalators.carry(
      player.position.x - BUILDING_CENTRE_X,
      player.position.z - BUILDING_CENTRE_Z,
      player.position.y,
      BUILDING_BASE_Y,
      dt,
    );
    if (carry !== 0) player.nudge(0, carry);
  }
}

// -------------------------------------------------------------- geometry

function near(x: number, z: number, targetX: number, targetZ: number, radius: number): boolean {
  const dx = x - targetX;
  const dz = z - targetZ;
  return dx * dx + dz * dz <= radius * radius;
}

/**
 * The helter-skelter: 1.75 anticlockwise oval turns from deck two down to the
 * ground floor, wound round the north-east shaft.
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
    new Vector3(7.4, 0.45, HELTER_CENTRE_Z + 2.2),
    new Vector3(5.8, 0.28, HELTER_CENTRE_Z + 2.4),
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
 * a fact about the park, not about the building, then shifted into local space.
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

/** Little painted pads and signs so a child can see where a slide begins. */
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

  const topFloor = floorGroups[TOP_DECK];
  if (topFloor) {
    topFloor.add(
      entrancePad(GIANT_SLIDE_ENTRY_X, GIANT_SLIDE_ENTRY_Z, PALETTE.slideChute),
      entranceSign(
        GIANT_SLIDE_ENTRY_X,
        GIANT_SLIDE_ENTRY_Z + 2.2,
        'Ginormous Slide',
        '🎢',
        PALETTE.slideChute,
      ),
      entranceSign(
        GROWN_UP_X,
        GROWN_UP_Z + 1.4,
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

// ------------------------------------------------------------- collision

/**
 * The shell is solid apart from its two doorways. Collision is height-blind, so
 * these walls hold on every deck at once — which is exactly what you want for a
 * building, and the reason the lift shaft gets its own three sides.
 */
function registerShellCollision(collision: CollisionWorld): void {
  const west = worldX(-BUILDING_HALF_X);
  const east = worldX(BUILDING_HALF_X);
  const north = worldZ(-BUILDING_HALF_Z);
  const south = worldZ(BUILDING_HALF_Z);

  collision.addWall(west, north, east, north, 0.3);
  collision.addWall(west, north, west, south, 0.3);

  // South face, minus the front door.
  collision.addWall(west, south, worldX(ENTRANCE_MIN_X), south, 0.3);
  collision.addWall(worldX(ENTRANCE_MAX_X), south, east, south, 0.3);

  // East face, minus the way into the lift.
  collision.addWall(east, north, east, worldZ(LIFT_DOOR_MIN_Z), 0.3);
  collision.addWall(east, worldZ(LIFT_DOOR_MAX_Z), east, south, 0.3);
}
