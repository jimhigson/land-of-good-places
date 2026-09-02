/**
 * **Pool seed 326 — baked-warp seed, invariant coverage (see seed-288's
 * header for the reasoning; its warp is `{fountain: 1}`).** Registered in
 * seed 18's vacated sweep slot: 18 was retired 2 Sep 2026 (its park needs a
 * level crossing, which no longer exists — `invariants.ts` header), and the
 * slot goes to a park children actually draw from the pool.
 */
import { registerParkInvariants } from './invariants.ts';

registerParkInvariants(326);
