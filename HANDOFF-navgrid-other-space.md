# HANDOFF — perf/navgrid-other-space (follow-up to #751)

QA on #759: 459–517 ms freeze ~3.4 s after first entering the lazy castle —
the room's colliders overflowed #751's 256-entry change ring, so the park's
lattice rebuilt whole on a park child's next plan.

## Done (on top of #751; rebase onto main once #751 merges, open as its own PR)
- `Collision.ts`: exact growable change log (4 floats per revision, NaN = everywhere);
  a cache >8192 changes behind rebuilds whole. (Ring+256 blocks, then 16 blocks, both
  went red: the block reached back into the park's construction.)
- `NavGrid.ts`: touching patch rectangles merged before stamping (162 rects = 45 ms → few).
- `scripts/check-nav-spaces.mts` (+ shard 6): the reptile hall's 291 solids registered in
  their own space → 0 park rebuilds, lattice == whole rebuild, control in the park seen.
  Green 0.3 ms; `NAV_SPACES_MUTATE=whole` red at 451 ms; #751's code red (416 ms, 1 whole).
- check:library NAV REBUILDS still green (5 patches, worst 1.5 ms).

## Handed over 13 Nov (to the NavGrid workflow engineer)
Proven:
- `check:nav-spaces` green on this branch: hall's 291 solids -> 0 whole park rebuilds, lattice ==
  whole rebuild, park-middle control seen; park's next plan 0.3 ms (Node).
- Red with `NAV_SPACES_MUTATE=whole` (1 whole rebuild, 451 ms). Red on #751's code (ring of 256),
  but that run used the earlier selection (453 solids incl. the house's outside): 1 whole, 416 ms.
- The ring+256-block and 16-block versions both stayed red on the same check (see commit log).
- `check:library` NAV REBUILDS still green here (5 patches, 210 cells, worst 1.5 ms, 5/5 verified).
- `tsc --noEmit` passes. Shard wiring verified by parsing `scripts` (old step set kept, +check:nav-spaces).
Unproven:
- Full `pnpm run check` / `test:procgen` not run on this branch; no CI run yet.
- The final hall-only check not re-run against #751's code (291 > 256 ring, so it should go red).
- No browser before/after frame on the #759 castle repro (#759 not on main; preview needs parks).
- `coalesceRects` is O(n^3) worst case; measured only up to 162 rects. Change log grows 4 floats
  per revision for the session; CHANGE_WALK_LIMIT = 8192 is a judgement, not a measurement.
- Stacked on #751 (not yet merged): rebase onto main once #751 lands.
