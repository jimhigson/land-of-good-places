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

## Todo
- PR off main after #751 merges; before/after frame on the #759 preview repro
  (/spawn?pos=24.52,-18.17&facing=180&seed=5, walk in the castle door).
