/**
 * Pool seed 4 of 0..15 — one of the seven `CI_SWEEP_SEEDS` `test:procgen`
 * builds and measures on every PR. Nothing about this seed is special and
 * nothing here is per-seed: the invariants are the same for every park a
 * child can be given, and a seed that fails one is a generator bug.
 */
import { registerParkInvariants } from './invariants.ts';

registerParkInvariants(4);
