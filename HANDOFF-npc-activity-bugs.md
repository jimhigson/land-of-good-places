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

8. **C3** — `hopRequest`/`waveRemaining`/`waveAmount` cleared on the
   `'intent'`/`'child'` early return. Trace `fd3860f2` -> `7d9c4fec`.
9. **Per-frame allocations** — `paintedNpcFaces()` fills a reused pool,
   `TreeClimb.climbGroundSpot` hands back a rewritten object. Hash unchanged
   (`7d9c4fec`), `node --trace-gc` 125 scavenges -> 110.

Final: `npm run build` exit 0, trace `7d9c4fec`, wedge `painted=4/4`.

## Verified in the browser (I owned it)

Dev server on :5199, **a stale service worker was present and had to be cleared**
— see CLAUDE.md. 12 children, ~2.5 minutes, no console errors or warnings.

- Four decals at four *distinct* world positions — a mis-aliased pool would have
  put all four in the same place, which is the failure mode the reused array
  invites.
- All four moved (6.9 m – 73.2 m over 20 s), so they follow their children.
- **C2 invariant, live:** `max |head − character position|` over all 12 children
  = 0.042 m (about one frame of walking), and exactly **0 for the child who was
  riding the train at the time**. That is the bug, gone, measured.

## Left to do

- Nothing. PR raised; do not merge.

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
