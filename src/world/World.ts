import type { Scene } from 'three';
import { CollisionWorld } from './Collision';
import { Garden } from './Garden';
import { Scenery } from './Scenery';
import { Flowers } from './Flowers';
import { Fountain } from './Fountain';
import { FairyLights } from './FairyLights';
import { LampPosts } from './LampPosts';
import { AnchorPlots } from './AnchorPlots';
import { DayNight } from './DayNight';
import { Building, type InteriorControls } from './building';
import { ParkTrain } from './train';
import { MiniGameStalls } from '../minigames';
import { dressWaterFightPlot } from '../minigames/waterFight/plot';
import { buildDodgemsPlot, type DodgemsPlot } from '../minigames/dodgems/plot';
import type { InteractZone } from './interact';
import { collectSignZones, type SignZone } from './signs';
import type { Sky } from './Sky';
import type { FrameContext, GameSystem } from '../core/types';
import type { Player } from '../entities/Player';
import type { IsoCamera } from '../core/IsoCamera';
import { NpcSystem } from '../entities/npc';
// Face painting stall (additive — see FacePaintStall.ts's own file-ownership
// note). Not a mini-game, so it is wired in here rather than through
// `minigames/`.
import { FacePaintStall } from './FacePaintStall';
import { terrainHeight } from './terrain';

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
  readonly anchorPlots: AnchorPlots;
  readonly building: Building;
  readonly stalls: MiniGameStalls;
  readonly train: ParkTrain;
  readonly dodgems: DodgemsPlot;
  readonly dayNight: DayNight;
  readonly npcs: NpcSystem;
  /** The face-painting stall (additive). See `FacePaintStall.ts`. */
  readonly facePaintStall: FacePaintStall;

  constructor(scene: Scene, sky: Sky, interiorControls: InteriorControls, camera: IsoCamera) {
    this.garden = new Garden(this.collision);
    this.scenery = new Scenery(this.collision);
    // Living, pickable flowers — no collision (you walk straight through
    // them, same as the old decorative scatter), so it needs nothing from
    // the world to be built.
    this.flowers = new Flowers();
    this.fountain = new Fountain(this.collision);
    this.fairyLights = new FairyLights(this.collision);
    // Lamp posts along the paths — the family's "night is too dark" feedback.
    // Built after FairyLights (which rings the fountain plaza) and before
    // AnchorPlots so it only needs the static ANCHORS list, not the built
    // plots themselves, to keep its lamps out of the reserved ride footprints.
    this.lampPosts = new LampPosts(this.collision);
    this.anchorPlots = new AnchorPlots(this.collision);
    // Built into the reserved plots, so it must come after AnchorPlots.
    this.building = new Building(this.collision, this.anchorPlots, interiorControls);
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

    // The dodgems, standing in their own anchor plot: bumper wall, fairy lights
    // and the fake wooden tree, visible from right across the garden. Built
    // after AnchorPlots (it fills that plot and retires its "coming soon"
    // dressing); the ride you climb into is the mini-game behind the kiosk.
    this.dodgems = buildDodgemsPlot(this.anchorPlots, this.collision);
    this.dayNight = new DayNight(scene, sky);

    // The face-painting stall (additive): built here, before the NPCs, because
    // it registers four walls with `this.collision` and `NpcSystem` must be
    // built last of all (see below) — the order genuinely matters for the
    // waypoint graph's edge validation, even though the wander-target registry
    // it also registers with (`wanderDriver.ts`) does not care which order the
    // two are constructed in, since every `WanderDriver` reads that
    // module-level target on its own next update regardless.
    this.facePaintStall = new FacePaintStall(this.collision);

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
    this.npcs = new NpcSystem(
      this.collision,
      camera,
      (x, z, y) => this.building.surfaces.sample(x, z, y),
      this.scenery.climbableTrees,
    );

    scene.add(
      this.garden.group,
      this.scenery.group,
      this.flowers.group,
      this.fountain.group,
      this.fairyLights.group,
      this.lampPosts.group,
      this.anchorPlots.group,
      // The building is bigger on the inside: its interior is its own place,
      // six hundred metres from the park rather than inside the plot the facade
      // stands on, so it joins the scene on its own rather than through a plot.
      this.building.interiorRoot,
      this.npcs.group,
      this.stalls.group,
      this.facePaintStall.group,
      this.train.group,
    );
  }

  update(context: FrameContext): void {
    this.dayNight.update(context);

    // Fan the time-of-day out to everything that changes with it. Systems read
    // a plain number rather than subscribing, which keeps the ordering obvious.
    const night = this.dayNight.nightFactor;
    const eveningGlow = this.dayNight.lightsOn ? night : night * 0.25;
    this.fountain.nightFactor = night;
    this.fairyLights.nightFactor = eveningGlow;
    this.lampPosts.nightFactor = eveningGlow;

    this.train.nightFactor = night;

    this.fountain.update(context);
    this.fairyLights.update(context);
    this.lampPosts.update(context);
    this.anchorPlots.update(context);
    this.building.update(context);

    // The train runs before the children, and it has to: it carries the ones
    // who are aboard by writing their position, and their own movement code —
    // which runs inside `npcs.update` — is what commits it to the crowd's
    // instance buffer. The other way round they would ride a frame behind.
    this.train.update(context);
    this.train.carryPassengers(this.npcs.riders);

    this.npcs.update(context);
    this.stalls.update(context);
    this.facePaintStall.update(context);
    this.flowers.update(context);
    this.dodgems.update(context);
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
      ...this.stalls.interactZones(),
      ...this.facePaintStall.interactZones(),
      ...this.train.interactZones(),
      ...this.flowers.interactZones(),
    ];
  }

  /**
   * Every tap-to-read sign in the park (see `world/signs.ts`).
   *
   * A traversal of `anchorPlots.group` rather than a per-builder registry: the
   * building is built *into* the anchor plots (see the constructor), so this
   * one call already reaches every anchor sign and every shop sign without
   * needing to know that chain of ownership.
   */
  signZones(): SignZone[] {
    return [...collectSignZones(this.anchorPlots.group), ...this.facePaintStall.signZones()];
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
    this.facePaintStall.attachPlayer(player);
    this.train.attachPlayer(player);
    // Lets the crowd push gently apart from the player instead of walking
    // through them (design feedback #31d) — see `NpcSystem.attachPlayer`.
    this.npcs.attachPlayer(player);

    const groundBeforeFountain = player.groundSampler;
    player.groundSampler = (x, z, y) =>
      this.fountain.groundLevel(
        x,
        z,
        groundBeforeFountain ? groundBeforeFountain(x, z, y) : terrainHeight(x, z),
      );
    this.fountain.attachPlayer(player);
  }

  dispose(): void {
    this.fountain.dispose();
    this.fairyLights.dispose();
    this.lampPosts.dispose();
    this.stalls.dispose();
    this.facePaintStall.dispose();
    this.train.dispose();
    this.flowers.dispose();
    this.dodgems.dispose();
  }
}
