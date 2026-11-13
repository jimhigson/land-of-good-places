import type { World } from './World';
import { freezeStatic, holdsLiveNode, type FreezeCount } from './staticFreeze';

/**
 * **Which of the park's props are placed once and never move** — the one list
 * of what `staticFreeze.ts` is applied to (120 fps plan, step 13).
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
