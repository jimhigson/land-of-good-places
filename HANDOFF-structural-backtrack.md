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
- Sleepers: merged fix/sb-sleepers into wip/sb-merge (#702 port + stationsEvenlyAlongDrawn spacing fix; seeds
  1,3,8,9 sleepers cleared). OPEN: check:coplanar gains race-ring vs walk-past-ring sleeper side faces (canonical
  ~(-53,-9.6,75.4)); rings are mutually exclusive (RailRace.setActiveRing) — decide: teach the check exclusivity.
- Restart-0 identity: seed 11 park digest f949720aa35c7716 identical at ae8257fb and dec4376c (restart stream).
- Sweep 0..15 (base code): 2@r0, 5@r0, 0@r1, 3@r6, 6@r10, 4@r16, 8@r2 ... (log accept-0-15-r1.log).
- Helper running: fix/sb-cruiser-castle (castleSpan null though satisfies=crossesTheCastle).
