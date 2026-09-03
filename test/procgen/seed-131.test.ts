/**
 * **Sweep seed 131 — a park a child can really be given, replacing seed 18 (#481).**
 *
 * ## Why seed 18 had to go
 *
 * Seed 18's railway ran **through the park's own front arch**: the lineside
 * fence at `(-1.13, 59.87) -> (1.43, 58.85)`, 0.4 m inside the gate line, with
 * its 1.3 m track escort 3 m behind it. A child stepping off the bus met a
 * fence. #481 fixed that — `train/route.ts`'s `loopKeepsItsCrossing` now
 * refuses a closed loop that comes within the arch's half-width plus the fenced
 * corridor of the gate — so on seed 18 the search moves on to a later start
 * pose and grows a different loop, 31.0 m from the gate instead of 2.5 m.
 *
 * The railway moving re-solves that park's paths and crossings with it, and the
 * park that comes out trips two invariants:
 *
 * - `every street sits on the shared 12 m lattice` — `spur-ferrisWheel` runs
 *   9.6 m on `z = 52.86`, 3.20 m off the lattice.
 * - `every crossing on a site the planner proved bridgeable still carries its
 *   bridge` — the crossing at `(-58.9, 53.7)` is on a proven site and the
 *   builder fell back to a level crossing.
 *
 * **Neither is the gate fix being wrong, and neither is weakened here.** They
 * are the #414 planner-versus-builder gap and the path lattice's own fragility,
 * showing on a re-rolled park; the pool's own seed 288 trips the same lattice
 * clause on `main` today, with no railway change involved at all. They are
 * recorded with this exact reproduction rather than lost — see the issue linked
 * from PR for #481 — and swapping the seed with the reason written down is what
 * CLAUDE.md asks for instead of touching an assertion.
 *
 * ## Why 131, measured rather than picked by eye
 *
 * Every seed in `parkSeedPool.ts` was put through the whole suite. Ten come out
 * 83/83; 288 and 115 carry one latent failure each. Of the ten, **131's railway
 * passes closest to the gate — 10.8 m, against 12.6 m for the next nearest and
 * 80 m for the furthest** — so it is the tightest front-door park in the pool
 * that is otherwise clean, which is the property this seed is standing in for.
 *
 * It is also a **pool seed**, which seed 18 never was: a park a child can
 * actually draw on a first visit (#426), like the three sweep seeds beside it
 * (5, 11 and 24). And this change does not move it — its loop is 236 m before
 * the fix and 236 m after, as are all ten of the clean pool seeds. The suite
 * measures the same parks it did, minus a seed the fix legitimately re-rolls.
 *
 * **Where the defect itself is prosecuted, now that 18 is gone**:
 * `pnpm run check:gateway` walks a child in through the arch on all sixteen
 * pool seeds — including 288, the one #481 was reported on — and it is a step
 * of the required `Procgen invariants` workflow. This file's own
 * `a child can walk in through the front gate` clause is the regression guard;
 * the script is the cover.
 */
import { registerParkInvariants } from './invariants.ts';

registerParkInvariants(131);
