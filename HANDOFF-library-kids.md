# HANDOFF — The Library, track B: the story cushions and the library's children (#718; plan Steps 7-8)

Branch `feat/library-714-kids`, cut from the foundation head **bb4eb46f** (`feat/library-714`), worktree
`.claude/worktrees/library-714-kids`. Engineer, Claude Opus 5.5. The plan is
`docs/library-build/PLAN-parts-4-5.md` (Steps 7 and 8, plus its Ground rules, Seams, Numbers and
Decisions); where the orchestrator's task text differs from the plan (branches, handoff names, what
the groundwork already built), the task wins. **Raise no PR**: Jim's ruling is one PR for the whole
Library (#720, head `feat/library`, moved only by the orchestrator at a milestone).

Scratch logs: `/Users/jim/dev/landOfGoodPlaces/.claude/library-build-scratch/kids-step7/` (gitignored).

## Status
- [ ] **Step 7 — sitting on the story cushions (the player)** — in progress
- [ ] Step 8 — the library's three children (next task)

## Step 7

### Verified present in the foundation (read, not assumed)
- `scripts/lib/seatedPose.mts` (groundwork 3422aed0): `SEAT_TOLERANCE` 0.003, `FLOOR_TOLERANCE`
  0.015, `seatedErrors(model, floorY, seatTop)` = lowest visible non-outline vertex (instanced meshes
  expanded) and the `leftLeg` world y; its doc records the one-foot blind spot. `check-castle.mts`
  imports both tolerances (line 92) and keeps no private copy (no `0.003`/`0.015` literal left).
- `ridePose.ts` `'listening'`: in `RidePosture`; `applyListeningPose` dispatched beside `'dining'`
  before the seated fallthrough; root x 0, **both legs x 0**, body x `DINING_LEAN` (0) and z 0, arms
  `LISTEN_ARM_X` (−0.95) + sin(e·1.3 / e·1.1+1)·0.04 and z ±0.3, head x `LISTEN_CHIN` (−0.08) +
  sin(e·1.3)·0.03, head z 0 — every line the plan's Step 1 change 3 lists.
- The cushion is the glb's `cushion-body`: `libraryCushionSize().top` 0.36000001 = `KID_HIP_HEIGHT`
  0.36, so Decision 14's re-cut is a no-op (the constructor assertion is still added).
- `libraryArmchairSize()` takes no argument (one chair for all): `seatCentre` goes on it, no `big`.

### Baselines at the foundation (bb4eb46f, seed 5 restart 1 hydrated from `.parks` copied from the library-714 worktree, manifest d283ffaa…)
| check | exit | off the screen |
|---|---|---|
| check:library | 0 | 60 ✓, 0 ✗, "All clauses passed."; 137 solids; keep-outs 64 of 64; 8785 clear cells, no pocket |
| check:tap-spacing | 0 | 10 spaces, 131 zones, 27 portal bands; 231 zone-band and 20 close zone-zone pairs; 20 same-action overlaps (warnings); OK |

## Decisions (with reasons)
(filled in as they are made)

## Red transcripts (each with the geometry it was proved against)
(filled in as they are proved)

## For the join
(filled in as found)
