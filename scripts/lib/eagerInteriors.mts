/**
 * **Every lazy room, furnished up front — for Node.**
 *
 * In the browser each interior's furnishings are a lazy chunk fetched when she
 * walks in (`src/world/interiors.ts`). A headless check builds the whole park
 * in one synchronous constructor and then measures every room in it, so here
 * every one of those chunks is imported statically and handed over before any
 * building is constructed: the building finds its room already loaded and
 * furnishes it in its constructor, exactly as it did before rooms were lazy.
 *
 * **Import this before anything that builds a building** — `park-harness.mts`
 * does, as its first import after the canvas. It throws if `LAZY_INTERIORS`
 * names a room this file does not provide, so a room added to the list without
 * a line here fails every headless check at once rather than leaving them
 * measuring an empty shell.
 */
import { LAZY_INTERIORS, REPTILE_HALL } from '../../src/world/interiors.ts';
import * as reptileHall from '../../src/world/reptileHouse/hall.ts';

REPTILE_HALL.provide(reptileHall);

const missing = LAZY_INTERIORS.filter((part) => part.loaded === null).map((part) => part.name);
if (missing.length > 0) {
  throw new Error(`eagerInteriors: ${missing.join(', ')} not provided — add it to scripts/lib/eagerInteriors.mts`);
}
