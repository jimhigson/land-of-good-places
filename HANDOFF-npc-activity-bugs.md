# HANDOFF — the four NPC bugs the Activity refactor left behind

Branch `npc-activity-bugs`, worktree `.claude/worktrees/npc-bugs`, off
`origin/main` at `d210639`. Follow-up to PR #84 (ARCHITECTURE-REVIEW §6, **A2**).

## The hash ledger — the thing to keep updated

`npm run check:crowd` runs two scenarios. Every commit that moves the trace hash
has to say why. Running total:

| after | trace | why it moved |
| --- | --- | --- |
| origin/main | `ba8f7deb` | — |
| C1 (paint walk rails) | `ba8f7deb` | **unchanged** — the harness never wedged anyone *en route to the stall*, so C1 was dead code in it. That is why scenario 2 exists. |
| train no longer poaches | `060e7125` | first divergence frame 2039 child 7 — the exact poach |
| `lookAt` to the activity | `c9a98b40` | 2913 rows, `lookAt` column only |
| C2 (decal head tracking) | `c9a98b40` | **unchanged** — output nothing reads back |
| decal added to the trace | `fd3860f2` | trace scope, not behaviour |
| C3 (social state) | `7d9c4fec` | first divergence frame 10993 child 3 |

Method for attributing a hash move: dump `frame child moveX moveZ wave lookAt
hop expr target seat climb bubble` per row for ~6000 frames, run it either side
of the change, diff, and look at the **first** differing row and **which
columns** differ. Everything after the first divergence is seeded-stream
re-phasing and proves nothing on its own.

## Done (committed, in order)

1. **C1** — paint walk gets `timeout: WALK_TIMEOUT (60)`, `unstick: true`, and
   `clearSidestep()` on give-up like the train's `abandon()`.
2. **Scenario 2 in the harness** — the proof. Park with nothing but children and
   the stall, first child to set off pinned. `painted=3/4` before, `4/4` after;
   it also asserts the fourth paint lands *after* 60 s, so the check cannot pass
   vacuously if a future change stops the pinned child setting off.
3. **No poaching** — `TrainTrip` asks `host.othersBusy(this)`. Done in the
   activity, not the runner: a runner that skips non-busy activities also stops
   their idle bookkeeping, and `TreeClimb` deliberately ticks its cooldown
   through everything else.
4. **`lookAt`** — the pause look only applies when `hold === null`.
5. **C2** — head tracking moved to `FacePaintVisit.trackHead`, called from the
   top of `WanderDriver.update`.
6. **Trace covers the decal registry** — three `mix()` calls; C2 was invisible
   to the hash without them.
7. **C3** — `hopRequest`/`waveRemaining`/`waveAmount` cleared on the
   `'intent'`/`'child'` early return.

## Left to do

- Per-frame allocations in the same two files, both named in
  ARCHITECTURE-REVIEW §4/§4a: `paintedNpcFaces()` (fresh array + up to 4 objects,
  called **every frame** from `FacePaintStall.ts:323` — confirmed) and
  `TreeClimb.climbGroundSpot` (an object per climbing child per frame, read by
  `TreeClimbing.ts:299`). Both behaviour-neutral, so the hash must not move.
- `npm run build` end to end, exit code checked, **not piped through tail**.
- PR via `gh pr create`. Do not merge.

## Found, deliberately not fixed

- **`faceYaw` is stale outside a visit.** A painted child crossing the park
  carries a decal facing whichever way they were when the painter finished.
  Real, cosmetic, and wants a decision about turn smoothing plus eyes on a
  screen — not a blind fix.
- **`facePaintVisits` is a module-level `Set` children join at construction and
  never leave.** Harmless in production (built once) but it is why the two trace
  scenarios need separate processes, and a rebuilt `World` would double-count
  painted faces and exhaust the paint cap. Same family as C5.
- **`ChatToPlayer`'s own `host.othersBusy` check** is left in place; the runner
  still does not enforce `busy`, so it is load-bearing, not redundant.
