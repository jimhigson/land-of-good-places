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
import { Building } from './building';
import { MiniGameStalls } from '../minigames';
import { buildDodgemsPlot, type DodgemsPlot } from '../minigames/dodgems/plot';
import type { InteractZone } from './interact';
import { collectSignZones, type SignZone } from './signs';
import type { Sky } from './Sky';
import type { FrameContext, GameSystem } from '../core/types';
import type { Player } from '../entities/Player';
import { NpcSystem } from '../entities/npc';

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
  readonly dodgems: DodgemsPlot;
  readonly dayNight: DayNight;
  readonly npcs: NpcSystem;

  constructor(scene: Scene, sky: Sky) {
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
    this.building = new Building(this.collision, this.anchorPlots);
    // Fun-fair stalls: each one is a doorway into a mini-game (see
    // `minigames/stalls.ts`). They stand on open lawn rather than in an anchor
    // plot, so they are built last and simply keep out of everyone's way.
    this.stalls = new MiniGameStalls(this.collision);
    // The dodgems, standing in their own anchor plot: bumper wall, fairy lights
    // and the fake wooden tree, visible from right across the garden. Built
    // after AnchorPlots (it fills that plot and retires its "coming soon"
    // dressing); the ride you climb into is the mini-game behind the kiosk.
    this.dodgems = buildDodgemsPlot(this.anchorPlots, this.collision);
    this.dayNight = new DayNight(scene, sky);

    // The other children in the park. Built last, because the waypoint graph
    // they wander is validated against the finished collision world — every
    // route is walked at build time and dropped if a wall or a tree is in the
    // way — and because they walk the building's ground floor, so they need the
    // same ground sampler the player gets.
    this.npcs = new NpcSystem(this.collision, (x, z, y) => this.building.surfaces.sample(x, z, y));

    scene.add(
      this.garden.group,
      this.scenery.group,
      this.flowers.group,
      this.fountain.group,
      this.fairyLights.group,
      this.lampPosts.group,
      this.anchorPlots.group,
      this.npcs.group,
      this.stalls.group,
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

    this.fountain.update(context);
    this.fairyLights.update(context);
    this.lampPosts.update(context);
    this.anchorPlots.update(context);
    this.building.update(context);
    this.npcs.update(context);
    this.stalls.update(context);
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
    return collectSignZones(this.anchorPlots.group);
  }

  /**
   * Gives the building the player. Must be called once, after the player is
   * constructed — it installs the ground sampler that makes floors walkable.
   */
  attachPlayer(player: Player): void {
    this.building.attachPlayer(player);
  }

  dispose(): void {
    this.fountain.dispose();
    this.fairyLights.dispose();
    this.lampPosts.dispose();
    this.stalls.dispose();
    this.flowers.dispose();
    this.dodgems.dispose();
  }
}
