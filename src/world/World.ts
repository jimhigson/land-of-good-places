import type { Object3D, Scene } from 'three';
import { CollisionWorld } from './Collision';
import { Garden } from './Garden';
import { Scenery } from './Scenery';
import { Flowers } from './Flowers';
import { Fountain } from './Fountain';
import { FairyLights } from './FairyLights';
import { LampPosts } from './LampPosts';
import { TreeLights } from './TreeLights';
import { Fireflies } from './Fireflies';
import { AnchorPlots } from './AnchorPlots';
import { DayNight } from './DayNight';
import { Building, type InteriorControls } from './building';
import { ParkTrain } from './train';
import { Coaster } from './coaster/Coaster';
import { FerrisWheelRide } from './ferrisWheel/FerrisWheelRide';
import { COASTER_PLANS } from './coaster/plan';
import { RailRace } from './railRace/RailRace';
import { Hotel } from './hotel/Hotel';
import { MiniGameStalls } from '../minigames';
import { dressWaterFightPlot } from '../minigames/waterFight/plot';
import { buildDodgemsPlot, type DodgemsPlot } from '../minigames/dodgems/plot';
import type { InteractZone } from './interact';
import { PLAZA } from './paths';
import type { Sky } from './Sky';
import type { FrameContext, GameSystem } from '../core/types';
import type { Player } from '../entities/Player';
import type { IsoCamera } from '../core/IsoCamera';
import { NpcSystem } from '../entities/npc';
// Face painting stall (additive — see FacePaintStall.ts's own file-ownership
// note). Not a mini-game, so it is wired in here rather than through
// `minigames/`.
import { FacePaintStall } from './FacePaintStall';
// The keychain stall (#119/#225) — FacePaintStall's sibling, wired the same way.
import { KeychainShop } from './KeychainShop';
import { Entrance, type EntranceOptions } from './entrance/Entrance';
import { ARRIVAL_KID_COUNT } from './entrance/ArrivalSequence';
import { terrainHeight } from './terrain';

export interface WorldOptions {
  /** Passed straight to {@link Entrance} — see `EntranceOptions.arriveByBus`. */
  readonly entrance?: EntranceOptions;
}

/**
 * The park itself: ground, scenery, fountain, lights, reserved plots and the
 * clock.
 *
 * World owns the build order, which matters — every builder registers its solid
 * bits with the shared {@link CollisionWorld}, so it must be constructed first
 * and handed to each of them.
 *
 * Adding a new piece of world: build it in its own file, take `CollisionWorld`
 * in the constructor if it is solid, expose a `group`, then add it here. If it
 * animates, implement `GameSystem` and call its `update` below.
 */
export class World implements GameSystem {
  readonly name = 'world';

  readonly collision = new CollisionWorld();
  readonly garden: Garden;
  readonly scenery: Scenery;
  readonly flowers: Flowers;
  readonly fountain: Fountain;
  readonly fairyLights: FairyLights;
  readonly lampPosts: LampPosts;
  readonly treeLights: TreeLights;
  readonly fireflies: Fireflies;
  readonly anchorPlots: AnchorPlots;
  readonly building: Building;
  readonly hotel: Hotel;
  readonly stalls: MiniGameStalls;
  readonly train: ParkTrain;
  readonly coaster: Coaster;
  readonly railRace: RailRace;
  readonly dodgems: DodgemsPlot;
  /** The Space Ferris Wheel, ridden in the park itself. See its own header. */
  readonly ferrisWheel: FerrisWheelRide;
  readonly dayNight: DayNight;
  readonly npcs: NpcSystem;
  /** The face-painting stall (additive). See `FacePaintStall.ts`. */
  readonly facePaintStall: FacePaintStall;
  /** The keychain stall (additive). See `KeychainShop.ts`. */
  readonly keychainShop: KeychainShop;
  /** The park's front gate, its bus-stop shelter, and the cat bus arrival. */
  readonly entrance: Entrance;
  /** Every group that makes up the park itself. See {@link setParkVisible}. */
  private readonly parkGroups: readonly Object3D[];

  constructor(
    scene: Scene,
    sky: Sky,
    interiorControls: InteriorControls,
    camera: IsoCamera,
    options: WorldOptions = {},
  ) {
    this.garden = new Garden(this.collision);
    this.scenery = new Scenery(this.collision);
    // Living, pickable flowers — no collision (you walk straight through
    // them, same as the old decorative scatter), so it needs nothing from
    // the world to be built.
    this.flowers = new Flowers();
    this.fountain = new Fountain(this.collision, PLAZA.x, PLAZA.z);
    this.fairyLights = new FairyLights(this.collision);
    // Lamp posts along the paths — the family's "night is too dark" feedback.
    // Built after FairyLights (which rings the fountain plaza) and before
    // AnchorPlots so it only needs the static ANCHORS list, not the built
    // plots themselves, to keep its lamps out of the reserved ride footprints.
    this.lampPosts = new LampPosts(this.collision);
    // Drifting sparks over the lawn after dark. Depends on nothing but the
    // terrain and the reserved plots it keeps out of.
    this.fireflies = new Fireflies();
    this.anchorPlots = new AnchorPlots(this.collision);
    // Built into the reserved plots, so it must come after AnchorPlots.
    this.building = new Building(this.collision, this.anchorPlots, interiorControls);
    // The Land Hotel (issue #236): a crystal tower near the castle whose door
    // leads to rooms that are each their own space. Shares the building's
    // WalkSurfaces sampler — its floor plates and mattress tops are ordinary
    // static platforms to it.
    // The camera sizes the receptionist's speech bubble on screen; the clock is
    // read as a closure because `dayNight` is built further down this
    // constructor and a time read eagerly here would be dawn for ever.
    this.hotel = new Hotel(
      this.collision,
      this.anchorPlots,
      interiorControls,
      this.building.surfaces,
      { camera, clock: () => this.dayNight.timeOfDay },
    );
    // The water-fight garden's shop window: takes the "coming soon" sign off the
    // `waterFight` plot and lays it out as a water-fight corner — pools, hedges,
    // a sprinkler and a rack of very big water guns. The fight itself is a
    // mini-game in its own world, entered from the stall standing in that plot.
    dressWaterFightPlot(this.anchorPlots, this.collision);

    // Fun-fair stalls: each one is a doorway into a mini-game (see
    // `minigames/stalls.ts`). They stand on open lawn rather than in an anchor
    // plot, so they are built last and simply keep out of everyone's way.
    this.stalls = new MiniGameStalls(this.collision);

    // The park train. Built after everything solid, because it does not have a
    // route until it has one: it solves its loop against the finished collision
    // world, so a tree planted across the park edge bends the track rather than
    // growing through it (see `train/route.ts`). Built before the NPCs, so the
    // waypoint graph is validated against its station posts too.
    this.train = new ParkTrain(this.collision);
    // The platforms and the carriage floors are things you stand on, so they go
    // to the same sampler the lift and the bubble use.
    for (const platform of this.train.platforms()) this.building.surfaces.addPlatform(platform);
    // …and they are tap targets, which the meadow — planted before the loop
    // was solved — must keep its pickable blooms out of (the tap-spacing
    // rule, `world/tapSpacing.ts`). Any flower already inside is replanted.
    this.flowers.keepClearOfTapZones(this.train.stationTapAreas());

    // Two rollercoasters (family ruling, 28 July): the Sky Cruiser, a
    // serene first-person ride, and the Rail Race, third person with
    // barriers to duck. Both routes are solved already — `coaster/plan.ts`
    // grows the cruiser first and the race avoiding it (loop-over-loop),
    // at module load — so this just *builds* them, same as the train's
    // stations. Still built after the train, for the rail-over-rail assert.
    //
    // Built **before** `TreeLights` just below, and that order is now load-
    // bearing rather than incidental (issue #301): the cruiser's pylon search
    // fells a tree standing on an otherwise-good support spot instead of
    // skipping it (`coaster/pylons.ts`), and a tree felled after `TreeLights`
    // had already strung a garland to it would leave that garland's end
    // hanging in mid-air over a stump nobody can see. Building the coaster
    // first means every garland below is generated from the trees the park
    // actually keeps.
    this.coaster = new Coaster(this.collision, this.train, {
      plan: COASTER_PLANS.cruiser,
      camera: 'firstPerson',
      clearTreesNear: (x, z, radius) => this.scenery.clearTreesNear(x, z, radius),
    });

    // Garlands of lights strung tree to tree. Nothing about them is authored:
    // they are generated from where `Scenery` actually planted the trees and
    // from the railway's *solved* centre line, so both the next tree scatter
    // and Decision 4's replanned railway move them on their own. That is what
    // puts it here — it needs the train's route, and the train does not have
    // one until it has solved for it against the finished collision world.
    // It registers no collision itself; the wires hang overhead.
    this.treeLights = new TreeLights(this.scenery.foliageOccluders, this.train.route);

    // The Rail Race is no longer a coaster at all (reform of 31 July 2026): it
    // is four parallel rails round the park's rim, raced side-on with the park
    // itself as the backdrop. Its own module owns the route, the physics, the
    // geometry and the camera — see `railRace/RailRace.ts`.
    this.railRace = new RailRace(this.collision);

    // The dodgems, standing in their own anchor plot: bumper wall, fairy lights
    // and the fake wooden tree, visible from right across the garden. Built
    // after AnchorPlots (it fills that plot and retires its "coming soon"
    // dressing); the ride you climb into is the mini-game behind the kiosk.
    this.dodgems = buildDodgemsPlot(this.anchorPlots, this.collision);
    this.dayNight = new DayNight(scene, sky);

    // The ferris wheel's ride. Built after `anchorPlots` (whose wheel it stands
    // in for while somebody is aboard) and after `dayNight` (whose sky it takes
    // past night and into space). Both are handed in as narrow closures rather
    // than whole objects: this ride needs to raise a sky and hide a wheel, and
    // nothing else.
    this.ferrisWheel = new FerrisWheelRide(this.collision, {
      setSpaceFactor: (value) => this.dayNight.setSpaceFactor(value),
      setParkWheelVisible: (visible) => this.anchorPlots.setFerrisWheelVisible(visible),
      setParkVisible: (visible) => this.setParkVisible(visible),
      setElsewhereVisible: (visible) => this.setElsewhereVisible(visible),
    });

    // The face-painting stall (additive): built here, before the NPCs, because
    // it registers four walls with `this.collision` and `NpcSystem` must be
    // built last of all (see below) — the order genuinely matters for the
    // waypoint graph's edge validation, even though the wander-target registry
    // it also registers with (`wanderDriver.ts`) does not care which order the
    // two are constructed in, since every `WanderDriver` reads that
    // module-level target on its own next update regardless.
    this.facePaintStall = new FacePaintStall(this.collision);

    // The keychain stall (#119/#225): same reasoning, same build-order
    // requirement — it registers its own walls with `this.collision` before
    // `NpcSystem`'s waypoint graph is validated against the finished
    // collision world.
    this.keychainShop = new KeychainShop(this.collision);

    // The front gate, its bus-stop shelter, and — for a player who has not
    // arrived yet — the cat bus that brings her in. Built before the NPCs for
    // the same reason the stall above is: it registers collision circles for
    // the arch posts and the shelter, and the waypoint graph is validated
    // against the *finished* collision world.
    //
    // This is where the arrival lives, and deliberately not in `Game`: `Game`
    // builds a real `WebGLRenderer` and so cannot be constructed in a test,
    // while `World` is built headlessly by `scripts/park-harness.mts` on every
    // CI run. A cat bus hung off `Game` would be visible to no check at all,
    // which is precisely how the original shipped dead and stayed dead for
    // twelve days. See `entrance/ArrivalSequence.ts`.
    //
    // `this.train.route` is handed in so the welcome sign can be placed
    // against the train's own *solved* centre line rather than a coordinate
    // picked before the loop existed (issue #303 QA) — see
    // `Entrance.findWelcomeSignSpot`. `this.train` above is built well before
    // this line for exactly that reason.
    this.entrance = new Entrance(this.collision, this.train.route, options.entrance ?? {});
    // The welcome sign's spot is chosen dynamically against the *solved*
    // train route (see above), which the meadow — planted long before this
    // line — could not have known about either. Same pattern as the train's
    // own stations just above: tell the meadow after the fact and let it
    // replant anything that landed underneath.
    this.flowers.keepClearOfTapZones(this.entrance.interactZones());

    // The other children in the park. Built last, because the waypoint graph
    // they wander is validated against the finished collision world — every
    // route is walked at build time and dropped if a wall or a tree is in the
    // way, which is exactly why the stall above has to come first — and
    // because they walk the building's ground floor, so they need the same
    // ground sampler the player gets.
    //
    // `scenery.climbableTrees` is threaded straight through to every wander
    // driver (see `entities/npc/wanderDriver.ts`), which is what lets an NPC
    // occasionally climb one — the actual climbing (posing, hiding the body)
    // is `world/TreeClimbing.ts`, built in `Game.ts` alongside the player.
    //
    // The fifth argument is the cat bus's eleven passengers. They are **park
    // NPCs from birth** — not extra children, and not children converted into
    // NPCs when the cutscene ends. `NPC_COUNT` is untouched: eleven of the
    // park's own twenty-four simply begin the game sitting on a bus outside the
    // gate. That is the only shape the code allows anyway, `KidCrowd` being a
    // fixed-capacity `InstancedMesh` that throws rather than growing.
    //
    // …and last, the hotel's guests, who are these same children:
    // `NpcCharacter` bodies with the same walk cycle, the same collision and
    // the same push-apart, pinned to a circuit inside their own room rather
    // than wandering the park's graph. Jim, having played the hotel: *"even
    // other children can be walked through even though in the park NPCs are
    // solid — they should be the same code."* This is where that stops being
    // two implementations. The hotel is built above, before this, precisely
    // so it has guests to offer by the time the crowd is made.
    this.npcs = new NpcSystem(
      this.collision,
      camera,
      (x, z, y) => this.building.surfaces.sample(x, z, y),
      this.scenery.climbableTrees,
      this.entrance.arrival ? ARRIVAL_KID_COUNT : 0,
      this.hotel.residents,
    );

    // …and now that both exist, introduce them. `Entrance` is built before
    // `NpcSystem` (the waypoint graph needs the finished collision world), so
    // this cannot be a constructor argument in either direction — it is the
    // same late-binding `attachPlayer` has always used.
    this.entrance.attachNpcs(this.npcs.all.slice(0, ARRIVAL_KID_COUNT));

    // Everything the park *is*, as far as the scene is concerned. Kept as a
    // list rather than only spread into `scene.add` so {@link setParkVisible}
    // can take the whole park off screen in one go — see its own note. The
    // ferris wheel's ride is deliberately **not** in here: it is the one thing
    // that has to stay when the park goes.
    this.parkGroups = [
      this.garden.group,
      this.scenery.group,
      this.flowers.group,
      this.fountain.group,
      this.fairyLights.group,
      this.lampPosts.group,
      this.treeLights.group,
      this.fireflies.group,
      this.anchorPlots.group,
      this.npcs.group,
      this.stalls.group,
      this.facePaintStall.group,
      this.keychainShop.group,
      this.train.group,
      this.coaster.group,
      this.railRace.group,
      this.entrance.group,
    ];
    // The building is bigger on the inside: its interior is its own place, six
    // hundred metres from the park rather than inside the plot the facade
    // stands on. Deliberately **not** one of the park groups above — it is not
    // the park, and {@link setElsewhereVisible} is what hides it.
    scene.add(...this.parkGroups, this.building.interiorRoot, this.hotel.hotelRoot, this.ferrisWheel.group);
  }

  /**
   * Shows or hides the places that are not the park.
   *
   * Today that is the castle interior, which sits at (600, 600) — 848 m out on
   * a 45 degree bearing — because it is bigger on the inside and has to live
   * somewhere. Nothing ever saw it from the park, for one accidental reason:
   * fog closed long before it. The ferris wheel pushes fog out past everything
   * so a child can look down at the park from three hundred metres, and the
   * castle's insides duly appeared, floating in the middle distance, when Jim
   * turned about 135 degrees.
   *
   * So the ride hides it outright for the whole climb. Safe by construction:
   * you cannot board a ferris wheel from indoors.
   */
  setElsewhereVisible(visible: boolean): void {
    this.building.interiorRoot.visible = visible;
  }

  /**
   * Shows or hides the whole park.
   *
   * There is exactly one caller and it is the ferris wheel
   * (`ferrisWheel/FerrisWheelRide.ts`), for the stretch of the ride spent above
   * the cloud band. Up there the Earth is out — three hundred metres of it,
   * against a park a hundred and ten metres across — and the two cannot share a
   * frame: looking straight down through the gondola's glass floor otherwise
   * showed the real park sitting in front of the planet it is supposed to be
   * part of.
   *
   * The change happens **inside the cloud**, which is the whole reason the band
   * is there, so nothing is ever seen to vanish. Visibility only: nothing is
   * disposed, nothing stops updating, and the park is exactly as she left it
   * when the clouds part again on the way down.
   */
  setParkVisible(visible: boolean): void {
    for (const group of this.parkGroups) group.visible = visible;
  }

  /**
   * **Is the player in an interior — any interior?**
   *
   * The one question `DayNight.setIndoors` is asked, and the reason it is a
   * question rather than a field: it used to read `building.playerInRoofedInterior`
   * directly, which quietly meant "indoors" was defined as *the castle*. Then
   * the hotel arrived with four more indoor spaces, and Jim, having played it:
   * *"the hotel shouldn't have a night/day cycle like outdoors."* It was not
   * that the hotel had been forgotten — it was that there was nowhere for it to
   * be remembered. Anything with an inside adds itself to this line, and gets
   * the whole indoor rule (a still sun, no travelling shadows, daytime fog)
   * without knowing that any of that is what it is asking for.
   *
   * Each space owns what "inside" means for itself, which is not the same
   * answer twice: the castle's roof terrace is genuinely outdoors and excluded
   * by `playerInRoofedInterior`, while every hotel room counts, because a
   * hotel room being open-topped is a *camera* decision (the iso view looks
   * in) rather than a claim that it is outside.
   *
   * Each interior is also responsible for lighting itself once the sky's own
   * lights go out — `building/InteriorLighting.ts` for the castle,
   * `hotel/lighting.ts` for the hotel.
   */
  private get playerInAnyInterior(): boolean {
    return this.building.playerInRoofedInterior || this.hotel.playerIsInside;
  }

  update(context: FrameContext): void {
    // Read before `building.update()` runs this frame, so it is a frame behind
    // — invisible in practice, since every doorway crossing already happens
    // behind a closed iris (see `Building.changeSpace`).
    this.dayNight.setIndoors(this.playerInAnyInterior);
    this.dayNight.update(context);

    // Fan the time-of-day out to everything that changes with it. Systems read
    // a plain number rather than subscribing, which keeps the ordering obvious.
    const night = this.dayNight.nightFactor;
    const eveningGlow = this.dayNight.lightsOn ? night : night * 0.25;
    this.fountain.nightFactor = night;
    this.fairyLights.nightFactor = eveningGlow;
    this.lampPosts.nightFactor = eveningGlow;
    this.treeLights.nightFactor = eveningGlow;
    // Fireflies follow the real night rather than the park's lighting-up
    // time — they are not part of the fairy-light rig, they are wildlife.
    this.fireflies.nightFactor = night;

    this.train.nightFactor = night;

    this.fountain.update(context);
    this.fairyLights.update(context);
    this.lampPosts.update(context);
    this.treeLights.update(context);
    this.fireflies.update(context);
    this.anchorPlots.update(context);
    this.building.update(context);
    this.hotel.update(context);

    // The train runs before the children, and it has to: it carries the ones
    // who are aboard by writing their position, and their own movement code —
    // which runs inside `npcs.update` — is what commits it to the crowd's
    // instance buffer. The other way round they would ride a frame behind.
    this.train.update(context);
    this.coaster.update(context);
    this.railRace.update(context);
    this.ferrisWheel.update(context);
    this.train.carryPassengers(this.npcs.riders);

    // The arrival runs **before** the children, for exactly the reason the
    // train does: it writes the position of eleven of them, and their own
    // update is what commits that to the crowd's instance buffer. After it,
    // every passenger would be drawn a frame behind the bus they are sitting
    // in — fine up a tree, very much not fine through a window.
    this.entrance.update(context);

    this.npcs.update(context);
    this.stalls.update(context);
    this.facePaintStall.update(context);
    this.keychainShop.update(context);
    this.flowers.update(context);
    this.dodgems.update(context);
    // Last: the arrival moves the player, and everything above has already had
    // its frame, so nothing overwrites where the sequence just put her. The
    // pose itself was computed above, with the children's; this only re-asserts
    // it, so the two can never disagree about where she is this frame.
    this.entrance.reassertPlayerPose();
  }

  /**
   * Every tap target in the park (see `world/interact.ts`).
   *
   * Only the building has any for now; garden rides add theirs here as they are
   * built, which is why this lives on World rather than on Building.
   */
  interactZones(): InteractZone[] {
    return [
      ...this.building.interactZones(),
      ...this.hotel.interactZones(),
      ...this.stalls.interactZones(),
      ...this.facePaintStall.interactZones(),
      ...this.keychainShop.interactZones(),
      ...this.train.interactZones(),
      ...this.flowers.interactZones(),
      ...this.entrance.interactZones(),
    ];
  }

  /**
   * Mounts the HUD belonging to anything in the world that owns some.
   *
   * Separate from the constructor because `Hud` empties `#ui-root` when it is
   * built, and the world is built first — see `FacePaintStall.mountUi`, whose
   * panel and hint were being wiped out of the document exactly that way.
   * `Game` calls this once, after the HUD exists.
   */
  mountUi(uiRoot: HTMLElement): void {
    this.facePaintStall.mountUi(uiRoot);
    this.keychainShop.mountUi(uiRoot);
  }

  /**
   * Gives the building, the face-painting stall and the fountain the player.
   * Must be called once, after the player is constructed: the building
   * installs the ground sampler that makes floors walkable, the stall hangs
   * the paint overlay on the player's actual head, and the fountain then
   * wraps the sampler with its own shallow-water dip inside the rim so
   * wading works without either system knowing about the other.
   */
  attachPlayer(player: Player): void {
    this.building.attachPlayer(player);
    this.hotel.attachPlayer(player);
    this.facePaintStall.attachPlayer(player);
    this.keychainShop.attachPlayer(player);
    this.train.attachPlayer(player);
    this.coaster.attachPlayer(player);
    this.railRace.attachPlayer(player);
    this.ferrisWheel.attachPlayer(player);
    // Lets the crowd push gently apart from the player instead of walking
    // through them (design feedback #31d) — see `NpcSystem.attachPlayer`.
    this.npcs.attachPlayer(player);
    // So the meadow can ask her to bend, pick and smell — see `Flowers.pick`.
    this.flowers.attachPlayer(player);

    const groundBeforeFountain = player.groundSampler;
    player.groundSampler = (x, z, y) =>
      this.fountain.groundLevel(
        x,
        z,
        groundBeforeFountain ? groundBeforeFountain(x, z, y) : terrainHeight(x, z),
      );
    this.fountain.attachPlayer(player);
    // Puts her aboard the cat bus, if one is bringing her in.
    this.entrance.attachPlayer(player);
  }

  dispose(): void {
    this.fountain.dispose();
    this.fairyLights.dispose();
    this.lampPosts.dispose();
    this.treeLights.dispose();
    this.fireflies.dispose();
    this.stalls.dispose();
    this.facePaintStall.dispose();
    this.keychainShop.dispose();
    this.train.dispose();
    this.coaster.dispose();
    this.railRace.dispose();
    this.ferrisWheel.dispose();
    this.flowers.dispose();
    this.dodgems.dispose();
  }
}
