# HANDOFF: sb-kerb (fix/sb-kerb, based on origin/wip/sb-merge)

- Model: Claude Opus 5.5, chosen by the structural-backtrack engineer. A replacement runs the same model.
- Task: clear check:coplanar's one finding `garden|garden/path-kerb|garden/path-surface` (0.222 m², 6.1e-3 m, seed 24)
  at cause per ART_DIRECTION.md §7 (delete the hidden face). No PR; push fix/sb-kerb and report back.
- Scratch: /private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/sb-kerb/
  (probe.mts: LGP_SEED=24 sweep, dumps kerb|surface pairs and nearby triangles).

## Status
- Before-runs started (coplanar, park:attempt seed 24 + 20260728) -> scratch *-before.log.
