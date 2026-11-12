import type { CollisionWorld } from '../Collision';
import type { InteriorControls } from '../building/Building';
import type { HallContext } from './context';
import { ReptileProps } from './props';
import { Exhibits } from './exhibits';
import { Planting } from './planting';
import { paintPaths } from './floorPaint';
import { ReptileStall } from './stall';
import { TortoiseRide } from './tortoiseRide';
import { REPTILE_HOUSE_ORIGIN_X, REPTILE_HOUSE_ORIGIN_Z } from './layout';

/**
 * **The Reptile House's hall, furnished** — every case, enclosure, plant, path,
 * the stall and the tortoise — fetched when she first walks in, not at boot.
 *
 * It is a lazy chunk (`world/interiors.ts`'s `REPTILE_HALL`): the four kits it
 * is drawn from (cases, plants, Noodle, the stall) are most of a megabyte, and
 * a child who never goes in has no use for any of it. `ReptileHouse` keeps the
 * outside, the hall's shell and its lights, and the exhibit camera; this builds
 * what goes on the floor, in the order it always was built.
 *
 * Everything here is solid the moment it exists: `ReptileProps` registers every
 * collider as it places the thing it belongs to, and `assertClear` refuses a
 * collider on any spot she must be able to stand on. The door holds its iris
 * shut until this has run (`SpaceManager.changeToFurnished`), so she never
 * stands in the hall before its solids are there.
 */
export interface ReptileHallContent {
  readonly props: ReptileProps;
  readonly exhibits: Exhibits;
  readonly stall: ReptileStall;
  readonly ride: TortoiseRide;
}

/**
 * Furnishes the hall. `context` minus `props`, which is made here: everything
 * the hall's floor is built from comes from this chunk.
 */
export function furnishReptileHall(
  collision: CollisionWorld,
  controls: InteriorControls,
  context: Omit<HallContext, 'props'>,
): ReptileHallContent {
  const props = new ReptileProps(collision, REPTILE_HOUSE_ORIGIN_X, REPTILE_HOUSE_ORIGIN_Z);
  const ctx: HallContext = { ...context, props };
  const exhibits = new Exhibits(ctx);
  new Planting(ctx);
  paintPaths(ctx);
  const stall = new ReptileStall(ctx);
  const ride = new TortoiseRide(context.root, props, collision, controls);
  props.assertClear();
  return { props, exhibits, stall, ride };
}
