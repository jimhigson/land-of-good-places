import type { Object3D } from 'three';
import type { World } from './World';
import { freezeStatic, holdsLiveNode, type FreezeCount } from './staticFreeze';
import { batchStatic, type BatchCount } from './staticBatch';

/**
 * **Which of the park's props are placed once and never move** — the one list
 * of what `staticFreeze.ts` is applied to (120 fps plan, step 13), and of what
 * `staticBatch.ts` merges (step 14).
 *
 * Called once from `Game`, after `new World(...)` has placed everything. It
 * lives here rather than in the builders because every builder it touches is
 * imported by procgen: a line in `Scenery.ts` or `stallProp.ts` moves the
 * park-source hash and re-solves all sixteen parks, for a change that alters
 * no park. The builders' node worlds (procgen, `parkFacts`, every node check)
 * are therefore exactly as they were — only the browser's scene is frozen.
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
 * **The park's static props, merged into one draw per material per tile**
 * (120 fps plan, step 14; `staticBatch.ts` says how, and what is never
 * merged). Called once from `Game`, after {@link freezeParkStatics}.
 *
 * Each area is a group the batches can live in without being measured as part
 * of something a child can select: a booth is a rainbow-outline target, so
 * the stall batches go in `stalls`, beside the booths, never inside one.
 *
 * - **Stalls** — every booth's shell, posts, rings, awning and prizes. The
 *   flags stay: they flutter.
 * - **Scenery** — the wooden and stone walls. The foliage and treeline are
 *   instanced already, and stay so.
 * - **Fairy lights** — the poles and their knobs. The cables are see-through
 *   (drawn back to front), the bulbs twinkle and the lamps are lights: all stay.
 */
export function batchParkStatics(world: World): BatchCount[] {
  // Everything a rainbow outline can be drawn round, as the zones name it: a
  // merged mesh inside one stays in the graph, so the outline and the pick box
  // are built from exactly what they always were.
  const measuredWhole = new Set<Object3D>();
  for (const zone of world.interactZones()) if (zone.highlight) measuredWhole.add(zone.highlight.object);
  return [
    batchStatic(world.stalls.group, { label: 'stalls', tileSize: BATCH_TILE_M, unitDepth: 1, measuredWhole }),
    batchStatic(world.scenery.group, { label: 'scenery', tileSize: BATCH_TILE_M, unitDepth: 2, measuredWhole }),
    batchStatic(world.fairyLights.group, { label: 'fairy-lights', tileSize: BATCH_TILE_M, unitDepth: 1, measuredWhole }),
  ];
}
