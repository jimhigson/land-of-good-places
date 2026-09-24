# HANDOFF — structural backtracking (feat/structural-backtrack)

Model: Claude Opus 5.5 (1M). Engineer/Architect, Overseer-dispatched. A replacement runs the same model.
Base: origin/feat/procgen-on-sphere (Jim: this branch is the dependency; feat/prebuilt-parks (#705) waits on it).
Worktree: .claude/worktrees/structural-backtrack. Scratch: $SCRATCH/sb/ (session scratchpad).

## Requirement (Jim, verbatim)
"there should be no 'fail some placement checks' GUARANTEED STRUCTURALLY because ALL FEATURES SHOULD BE
BACKTRACKABLE — this means that even in the case of total failure, backtracking to zero will work,
effectively starting again." Plus: every seed must build, not only 0..15; prove on 0..15 + ~100 random.

## Design so far
- `src/world/parkRestart.ts`: PARK_RESTART (LGP_PARK_RESTART env / globalThis.__LGP_PARK_RESTART__),
  `generationSeed(seed, r)` (r=0 -> seed unchanged). parkManifest: PARK_SEED_ASKED = identity,
  PARK_SEED = generationSeed(asked, restart) — every generator already reads PARK_SEED, so restart r is a
  whole new park (boundary included) under the same identity.
- `scripts/lib/parkFindings.mts`: check:park's measures as `measureParkFindings(park, ratchetEnforced)`;
  check-park.mts is now a printer.
- Next: `scripts/park-attempt.mts` (one process: build at (seed, r), run every invariant + check:park,
  print JSON verdict) and `scripts/lib/acceptedPark.mts` (root loop r=0.. until accepted, log restarts).

## Overseer baseline (vet:seeds 0..15 at ae8257fb)
check:park passes all; invariants pass only seeds 2, 5. Instrument/geometry bugs to fix at cause (not
search around): sleepers (#702 fix/sleepers-on-drawn-rails), RR camera (fix/pocket-race diagnosis),
coping chamfer (#698 fix/procgen-last has the fix).
