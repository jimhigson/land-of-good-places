# HANDOFF: 120 fps plan step 6 — allocation-free deterministic Math

Spec: docs/perf/FRAME-DROPS-2026-11.md on PR #746 (step 6, item 16).

## State
- `src/core/deterministicMath.ts`: reduced argument and trig kernel results go
  through one `Float64Array(2)` (`reduced`); kernels take only `iy` and write
  their answer to `reduced[0]`. Arithmetic unchanged.
- `test/deterministicMath.test.ts`: new "outputs are pinned bit for bit" block,
  digests recorded from origin/main 9b5e89e3's implementation.

## Proof (scratch tools in the agent's scratchpad, not committed)
- old-vs-new over 188,150,669 calls: 0 differing. Control (one-sign mutant of
  remPio2's negative branch): 1,138,280 differing.
- Node microbench, sin+cos+tan through global Math from a three.js-like caller:
  82 B/call -> 20 B/call (the remaining 16-20 B is sin's own boxed return to a
  non-inlining caller); 6M calls 799 ms -> 253 ms.

## Next
- Browser before/after (alloc MB/s, cpu ms) on seed 0 /spawn; park-file
  identity: build:parks seed 0 on main vs branch, diff .parks/0.json.
- Open PR.

## PR #755 (opened). Since: sin/cos/tan are tiny inlinable shells over
sinInto/cosInto/tanInto; x in reduced[0]. Microbench 5.3 B/call, 136 ms.
Park alloc 127 -> 82 MB/s mean of 3 pairs. Still 188M calls 0 diff.
- TODO: park-digest seeds 0,1,2 base vs branch (scratchpad digest-*.txt);
  pnpm run check + test:procgen; merge main when #749 lands.
