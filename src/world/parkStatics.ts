import type { Object3D } from 'three';
import type { World } from './World';
import { freezeStatic, holdsLiveNode, type FreezeCount } from './staticFreeze';
import { batchStatic, type BatchAreaOptions, type BatchCount } from './staticBatch';

/**
 * **Which of the park's props are placed once and never move** — the one list
 * of what `staticFreeze.ts` is applied to (120 fps plan, step 13), and of what
 * `staticBatch.ts` merges (step 14).
 *
 * Called once from `Game`, after `new World(...)` has placed everything. It
 * lives here rather than in the builders so the builders' node worlds
 * (procgen, `parkFacts`, `check:coplanar`, every node check) are exactly as
 * they were — only the browser's scene is frozen and merged, and no park's
 * scene paths change. (This used to add that a builder edit re-solves all
 * sixteen parks; since the parks were checked in, 13 November 2026, it
 * re-solves none — `validate:parks` re-measures them instead.) What the
 * builders do carry is a `userData` handle on each node they drive, which is
 * how the passes here know to leave it alone.
 *
 * - **Scenery** — the treeline and the wall runs, built once from the park's
 *   decisions. A scenery child that holds an instanced mesh is skipped whole:
 *   that is the foliage, whose instances are hidden and felled at runtime and
 *   whose culling has its own owner.
 * - **Stalls** — the booths' shells. Their flags flutter (`stallProp.ts`
 *   drives them through `userData`), and a node carrying `userData` is left
 *   live by `staticFreeze` itself, so the flags keep moving under a frozen
 *   booth. `check:static-freeze` is what proves that stays true.
 *
 * **Not here, on purpose:** the anchor plots. Their content groups are handed
 * out (`AnchorPlots.getGroup`) to the dodgems, the wheel, the water fight and
 * the Rail Race, which all animate what they add — there is no owner yet that
 * can say which of it is still.
 */
export function freezeParkStatics(world: World): FreezeCount {
  const total: FreezeCount = { frozen: 0, worldFrozen: 0, live: 0 };
  const add = (count: FreezeCount): void => {
    total.frozen += count.frozen;
    total.worldFrozen += count.worldFrozen;
    total.live += count.live;
  };
  for (const child of world.scenery.group.children) {
    if (!holdsLiveNode(child)) add(freezeStatic(child));
  }
  for (const booth of world.stalls.group.children) add(freezeStatic(booth));
  return total;
}

/**
 * Ground tile for a batch, metres: `core/tiledInstances.ts`'s coarse tile,
 * and for the same reason — a tile is a draw call, and the ride cameras look
 * right across the park.
 */
const BATCH_TILE_M = 48;

/**
 * One tile for the whole area: for a thing a few metres across (a shop, a
 * building, a train car), which is culled as one object anyway.
 */
const ONE_TILE = Number.POSITIVE_INFINITY;

/**
 * **The park's static props, merged into one draw per material per tile**
 * (120 fps plan, step 14; `staticBatch.ts` says how, and what is never
 * merged). Called once from `Game`, after {@link freezeParkStatics}.
 *
 * An area is listed here only once everything in it that moves or changes is
 * known to carry a `userData` handle (which `staticBatch` leaves alone, with
 * everything under it) — read from the builder, and measured: every node of
 * the played park was watched for a change of transform, `visible`, material
 * or geometry, walking, riding the Rail Race, and across dusk into night.
 * `check:static-freeze` holds that to be true on every run. The handles: the
 * stall flags (`stallProp.ts`), the dodgems' and the welcome sign's bulbs, the
 * arrival's cat bus, the hotel's sliding door leaves, the reptile house's
 * head, tongue and dusk-lit windows, the ferris wheel's turning wheel, the
 * face painter and her decals on painted children, the rival riders and the
 * cart wheels, the train's cars, axles and dusk-lit lamps.
 *
 * Every area folds colours (`staticBatch`'s `foldColours`): parts that differ
 * only in colour are one draw, their colours carried per vertex. That is what
 * merges a booth's dozen paints, or a building's.
 *
 * - **Stalls** — every booth's shell, posts, rings, awning and prizes. The
 *   flags stay: they flutter.
 * - **Scenery** — the wooden and stone walls. The foliage and treeline are
 *   instanced already, and stay so.
 * - **Fairy lights** — the poles, their knobs and the cables (see-through, one
 *   material, merged anyway: measured, see `transparentToo`). The bulbs
 *   twinkle and the lamps are lights: they stay.
 * - **The dodgems and the water fight**, as they stand in the park — floors,
 *   barriers, posts, the fake tree, the parked car, pools and hedges.
 * - **The hotel, library and reptile-house fronts**, each as one area (its
 *   anchor plot; the plot's `userData.anchor` is the plot's definition, not a
 *   handle, and a root's own `userData` never makes it live).
 * - **The ferris wheel's legs, axle and rails** — under the prop's own root,
 *   which the ride hides while it flies its own wheel, so its batches hide
 *   with it. The wheel turns, and stays.
 * - **The keychain cart and the face-paint stall** — rainbow-outline targets
 *   as a whole, so every source stays in the graph and the batches hang
 *   inside the target, skipped by the walks that measure it.
 * - **The entrance** — the arch, the bus shelter, the road, the welcome sign
 *   (but its bulbs). The arrival is live.
 * - **The park train** — its stations, bridges and track; and **each car in
 *   its own frame**, so a car's merged parts ride the track with it.
 * - **Each race cart in its own frame** — hopper, frame, seats, lamps. The
 *   wheels spin and the rival riders move, and stay.
 *
 * Not here: the slide is raycast by its own cameras; the fountain's statue
 * turns *and* fades to glass when she stands behind it (`FoliageFade`), which
 * a folded copy could not; the castle's front fades its porch roof; the sky
 * cruiser, the ball pit and the lamp posts hold too little to merge.
 */
export function batchParkStatics(world: World): BatchCount[] {
  // Everything a rainbow outline can be drawn round, as the zones name it: a
  // merged mesh inside one stays in the graph, so the outline and the pick box
  // are built from exactly what they always were.
  const measuredWhole = new Set<Object3D>();
  for (const zone of world.interactZones()) if (zone.highlight) measuredWhole.add(zone.highlight.object);
  const area = (root: Object3D, label: string, tileSize: number, extra: Partial<BatchAreaOptions> = {}): BatchCount =>
    batchStatic(root, { label, tileSize, unitDepth: 1, measuredWhole, shareEqualMaterials: true, foldColours: true, ...extra });
  const counts: BatchCount[] = [
    area(world.stalls.group, 'stalls', BATCH_TILE_M),
    area(world.scenery.group, 'scenery', BATCH_TILE_M, { unitDepth: 2, shareEqualMaterials: false }),
    area(world.fairyLights.group, 'fairy-lights', BATCH_TILE_M, { shareEqualMaterials: false, transparentToo: true }),
    area(world.anchorPlots.getGroup('dodgems'), 'dodgems', BATCH_TILE_M, { transparentToo: true }),
    area(world.anchorPlots.getGroup('waterFight'), 'water-fight', BATCH_TILE_M),
    area(world.anchorPlots.getGroup('hotel'), 'hotel-outside', ONE_TILE),
    area(world.anchorPlots.getGroup('library'), 'library-outside', ONE_TILE),
    area(world.anchorPlots.getGroup('reptileHouse'), 'reptile-house-outside', ONE_TILE),
    area(world.keychainShop.group, 'keychain-cart', ONE_TILE),
    area(world.facePaintStall.group, 'face-paint', ONE_TILE),
    area(world.entrance.group, 'entrance', BATCH_TILE_M),
    area(world.train.group, 'park-train', BATCH_TILE_M),
  ];
  const ferris = world.anchorPlots.getGroup('ferrisWheel').getObjectByName('prop.ferrisWheel');
  if (ferris) counts.push(area(ferris, 'ferris-wheel-legs', ONE_TILE));
  // The movers, each merged in its own frame: the batches hang in the car and
  // go wherever it goes. Found by the names the builders give them.
  for (const car of world.train.group.children) {
    if (/^train-(locomotive|carriage-\d+)$/.test(car.name)) counts.push(area(car, car.name, ONE_TILE));
  }
  for (const cart of world.railRace.group.children) {
    if (cart.name === 'railRace:cart') counts.push(area(cart, 'race-cart', ONE_TILE));
  }
  return counts;
}
