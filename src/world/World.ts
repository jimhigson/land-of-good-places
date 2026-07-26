import type { Scene } from 'three';
import { CollisionWorld } from './Collision';
import { Garden } from './Garden';
import { Scenery } from './Scenery';
import { Fountain } from './Fountain';
import { FairyLights } from './FairyLights';
import { AnchorPlots } from './AnchorPlots';
import { DayNight } from './DayNight';
import type { Sky } from './Sky';
import type { FrameContext, GameSystem } from '../core/types';

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
  readonly fountain: Fountain;
  readonly fairyLights: FairyLights;
  readonly anchorPlots: AnchorPlots;
  readonly dayNight: DayNight;

  constructor(scene: Scene, sky: Sky) {
    this.garden = new Garden(this.collision);
    this.scenery = new Scenery(this.collision);
    this.fountain = new Fountain(this.collision);
    this.fairyLights = new FairyLights(this.collision);
    this.anchorPlots = new AnchorPlots(this.collision);
    this.dayNight = new DayNight(scene, sky);

    scene.add(
      this.garden.group,
      this.scenery.group,
      this.fountain.group,
      this.fairyLights.group,
      this.anchorPlots.group,
    );
  }

  update(context: FrameContext): void {
    this.dayNight.update(context);

    // Fan the time-of-day out to everything that changes with it. Systems read
    // a plain number rather than subscribing, which keeps the ordering obvious.
    const night = this.dayNight.nightFactor;
    this.fountain.nightFactor = night;
    this.fairyLights.nightFactor = this.dayNight.lightsOn ? night : night * 0.25;

    this.fountain.update(context);
    this.fairyLights.update(context);
    this.anchorPlots.update(context);
  }

  dispose(): void {
    this.fountain.dispose();
    this.fairyLights.dispose();
  }
}
