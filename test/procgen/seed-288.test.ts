/**
 * **Pool seed 288 — the first baked-warp seed to get invariant coverage.**
 *
 * In the sixteen-seed pool (`parkSeedPool.ts`) since #426, but until now
 * covered only by `check:park` — the #437 blind spot: a pool seed children
 * actually get, never run through this suite. It matters doubly since the
 * level-tier deletion (2 Sep 2026): 288 is one of the four pool seeds whose
 * park needs a warp vector (`parkWarp.ts`: `{waterFight: 1}`) to reconnect
 * the garden pockets its level crossings used to carry, and that vector was
 * proved only against `check:park` before this file existed.
 */
import { registerParkInvariants } from './invariants.ts';

registerParkInvariants(288);
