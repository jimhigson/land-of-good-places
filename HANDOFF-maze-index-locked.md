# HANDOFF — the connector cap at 2.5, and why #438 is still open

Branch `fix/maze-index-locked` (name is now a misnomer — see below), rebased
onto `origin/main` `bbf995db`.

## What this branch ships

1. **`CONNECTOR_SPACING_CAP_MULTIPLE` 2.0 → 2.5** (`world/paths.ts`), which
   reconnects the ride cluster #431 disconnected (issue #416).
2. **The Sky Cruiser fills the gaps its own nudges open** (`coaster/pylons.ts`),
   issue #301.
3. **`LGP_CONNECTOR_CAP`** and **`LGP_DEBUG_PYLONS`** measurement hooks, in the
   shape of the existing `LGP_SPUR_STRETCH` / `LGP_DEBUG_STREETS`.

**It no longer changes `Scenery.ts` at all** — that file is byte-identical to
`main`. The maze change this branch was named for was reverted; the reason is
the most useful thing here.

## #438's premise was stale, and the naive fix was wrong

The cap sat at 2.0 because on **18 August 2026** a 3.5x cap shifted a maze piece
across an NPC waypoint chord and stranded **38 waypoints**. The mechanism is
real: `generateWallMaze` records a piece's corner — its 12 m+ exclusion zone —
only *after* `runIsClear` and `fitsAmong`, both of which ask about the world, so
a path-driven refusal releases that zone and a later candidate takes it.

**Two things turned out to be true, and they point opposite ways.**

**First: the stranding does not reproduce.** Measured 31 August with the maze
**completely untouched** — `check:park` gives `poi.stranded` **0 at 2.0, 2.5,
3.0 and 3.5 alike**. The park has been re-laid several times since August 18
(#431 most of all). The old numbers were an honest measurement of a park that no
longer exists. **So the cap never needed the maze fixed in order to move.**

**Second: fixing the coupling naively breaks #423.** This branch did first
implement the index-locked reservation (claim the slot before any world screen).
It was correct about the coupling and it broke two seeds:

```
seed 11 > every wall run goes alongside a path, and some stand flush against one
  only 2 of 14 wall runs stand flush against paving; at least 4 should
seed 5  > only 2 of 12 wall runs stand flush against paving; at least 4 should
```

Isolated with a temporary `LGP_MAZE_RESERVE_LATE` toggle, one variable at a
time: at cap **2.0** the flush failure still happened (3/9 and 2/14), so the cap
was **not** the cause; with the reservation restored to the bottom of the loop,
seed 11 **passed**. The reservation was the whole cause.

**Why, and this is the part worth carrying forward:** the late reservation is
not only a coupling, it is the maze's **only retry**. A candidate that lands
near a path, claims the slot, and then fails `runIsClear` releases the
neighbourhood so a *different* candidate can try the same ground — and near
paving that retry is exactly how a piece ends up flush. Claiming the slot on the
index removes the retry along with the coupling, and the flush count collapses.
#423 is Jim's own ask, confirmed by playing, so that is not a trade to make.

**So `LGP_MAZE_RESERVE_LATE` was removed and the maze change reverted.** No
invariant was weakened, no threshold tuned, no seed swapped.

## The sweep, on this base

Connectors built, per seed (`LGP_CONNECTOR_CAP`):

| cap | canonical | seed 2 | seed 5 | seed 11 | seed 18 |
| --- | --- | --- | --- | --- | --- |
| 2.0 | 3 | 5 | 4 | 3 | 3 |
| **2.5** | **4** | 7 | 4 | 5 | 3 |

`poi.stranded` (`check:park`, canonical only — issue #437): **0** at every cap
tried, 2.0 through 3.5. That column is one seed deep and is **not** the evidence
for the move; the row below is.

`test:procgen`, all five seeds:

| cap | 2.5 | 3.0 |
| --- | --- | --- |
| result | **497 passed** | **2 failed** |

The two failures at 3.0 are independent:

1. `connector-stall.railRacer-stall.waterFight` draws a **26.2 m diagonal**
   through Decision 3 — above 2.5 the cap admits pairs the street lattice cannot
   serve and the connector falls back to the continuous router. A limit of the
   router.
2. `scatterDecoupling` — *"bowing spur-stall.railRacer by 2 m changed scenery
   more than 30 m away"*. **This is #438's coupling, still real**, biting at 3.0
   and quiet at 2.5.

**2.5 is the largest multiple green on every seed, and reachable without
touching the maze.**

## Gates

| gate | result |
| --- | --- |
| `pnpm run check` | **exit 0** |
| `pnpm run test:procgen` | **exit 0** — **497 passed** |
| `pnpm run build` | **exit 0** |

#431's measures, each run on this branch *and* on a throwaway `origin/main`
worktree, because a number quoted from a handoff is not a baseline:

| measure | `origin/main` | this branch |
| --- | --- | --- |
| bridgeable loops | 8/9 (89%), `seed 9: LOOP UNSOLVABLE` | 8/9 (89%), same seed |
| `check:park-boot` worst slice | 12.3 ms (`trainSearch`) | 12.2 ms (`trainSearch`) |

No regression. But note plainly: the figures carried forward for these were
*bridgeable 92%* and *park-boot 11 ms*, and **neither is what `main` measures
today**. Stop quoting them.

## For the PR body

- **2.5 does not fully undo #431's cost.** It restores
  `stall.spaceFerrisWheel ↔ stall.facePaint`, but `dodgems → stall.railRacer` —
  the pair failing `check:path-preference`'s worst-route floor at 15.8% — is
  **36.1 m apart**, outside even a 2.5 cap. That pair needs separate work.
- **`poi.stranded` is canonical-only** (#437), so it is not all-seed evidence.
- **`check:path-preference` has not been re-run against this branch**, because
  it lives only on `feat/prefer-walking-on-paths`. Confirm there after this
  lands rather than assuming.

## #438 should stay open, with what we learned

The coupling is real and binds at 3.0. The fix is **not** "claim the slot on the
index" — that removes the retry #423 depends on. It needs to keep a retry while
bounding it: candidates grouped into neighbourhoods deterministically, with
refusals only ever promoting another candidate **within the same
neighbourhood**, so a path change can never move a wall across the park. Nobody
needs that until someone wants a cap above 2.5.
