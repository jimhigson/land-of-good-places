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

## Progress (24 Sep)
- Pushed on feat/structural-backtrack: parkRestart, park-attempt, acceptedPark (root loop), accept-parks CLI,
  parkFindings refactor, docs/design/STRUCTURAL-BACKTRACKING.md (audit). Overseer told (audit counts).
- wip/sb-merge (side worktree .claude/worktrees/sb-merge, pushed): merge of #698 + rainbow.inPath ported into
  parkFindings; acceptParkCached + acceptanceSourceHash (.cache/lgp-accepted/<hash>/<seed>.json);
  test:procgen beforeAll and check:park now measure the ACCEPTED restart. Fast-forward main branch to it when
  the 0..15 sweep (running in the main worktree, log $SCRATCH/sb/accept-0-15-r1.log) finishes.
- Helpers (background agents): fix/sb-sleepers (port #702), fix/sb-race-camera (zoom ceiling). Merge when done.
- Finding: duck bar "3.40 vs 3.40" = rider at simulate.ts MIN_SPEED 3.4 — a bar cannot slow a rider at the
  floor. Placement decision vs ring shape; restarts catch it (seed 0 accepted at restart 1).
