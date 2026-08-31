# HANDOFF — #438, index-lock the wall maze against its neighbours

Branch `fix/maze-index-locked`, off `origin/main` (`347e9454`).

**Why this exists:** `CONNECTOR_SPACING_CAP_MULTIPLE` in `world/paths.ts` sits
at 2.0 instead of the 3.5 its own reasoning wants, purely because extra
connector ribbons reshuffle the wall maze and strand NPC waypoints. That cap is
what blocks reconnecting the ride cluster after #431 (see
`HANDOFF-path-weighting.md` on `feat/prefer-walking-on-paths`, and #416).
Decouple the maze and the cap can then be raised **on its merits and measured**.

## The coupling, precisely

The brief was "give the maze the index-locked treatment `BENCH_CANDIDATES`
already has". Reading it, the maze **already had** most of that treatment —
`candidateRng(MAZE_SALT, attempts)` per index, a fixed `MAZE_CANDIDATES`
budget with every fitting L accepted (no count target), and the
nearest-segment anchor lookup that replaced `rng.pick(segments)`. So that part
of the premise was already satisfied and is not where the coupling lives.

**The coupling is the corner reservation.** `generateWallMaze` rejects a
candidate whose corner is within `MAZE_PIECE_GAP + 12` of an already-recorded
corner — but it recorded that corner **only at the bottom of the loop**, after
`runIsClear` and `fitsAmong` had also passed. Those two ask about the world as
it currently stands: the path network, the railway, bridge footprints, the
cruiser, and every wall placed so far. So a refusal driven by any of them
**released a 12 m+ exclusion zone**, and a later candidate that had been
sitting outside it was promoted in — a local refusal becoming a placement
somewhere else. That is precisely the "distant promotion" the maze's own
comment claims it avoids, which it does for the *count target* and did not for
the *reservation*.

The benches have no such reservation at all, which is why they never had the
bug — not because of anything about their RNG.

**The fix** (one moved line plus its reasoning): claim the slot on the index,
immediately after the corner-spacing test, before any screen that can refuse it
for a reason outside this loop. A refusal can then only ever remove that piece,
never hand its ground to another.

## Status: NOT green. One invariant down, and it is a real find.

`pnpm run test:procgen` → **exit 1**, 486 passed, 1 failed:

```
FAIL seed 11 > the Sky Cruiser stands on its own supports
the Sky Cruiser runs 17.0 m without a support over plain open lawn, from
12.0 m along its 379.7 m loop — clear of every plot and the paved network,
so nothing legitimately explains the gap. Over the 15 m open ground may span
unsupported (issue #301: the search should have felled whatever foliage was
refusing a spot here rather than skip it).
```

**This is not the maze change being wrong — it is the maze change exposing a
latent defect the invariant already names.** Changing which maze pieces stand
changes `clearOfWalls`, which moves the foliage scatter, which put a tree where
a cruiser pylon wanted to go. The pylon search then **skipped** the spot instead
of felling the foliage, leaving a 17 m unsupported span. CLAUDE.md's standing
rule is explicit that this is a bug in the generator: *"procgen should backtrack
on collisions… never shrink to a floor and accept a result that still doesn't
clear"*, and *"if a generator does not yet backtrack this way, that is a bug in
the generator"*. Issue #301 is the same finding.

So the honest dependency chain is one link longer than anyone thought:

> reconnect the ride cluster (#416) → raise the connector cap → **decouple the
> maze (#438)** → **make the cruiser pylon search fell foliage rather than skip
> (#301)**

## Next steps, in order

1. **Make the pylon search fell the foliage it is refused by**, the way pylon
   placement already fells foliage elsewhere (the invariant message points
   straight at it). That is the blocker for this branch going green.
2. Re-run `test:procgen` (487 must pass), `pnpm run check`, `build`.
3. **Then** measure the thing this is all for: raise
   `CONNECTOR_SPACING_CAP_MULTIPLE` toward 3.5 and check `poi.stranded` stays
   0 across all five seeds. Record the connector count and stranded count per
   seed per multiple — that sweep is the evidence the cap can move, and it must
   not be skipped because the maze "should" be decoupled now.
4. Only then reconnect the ride cluster and re-run `check:path-preference`.

## Do not

- Do not raise the cap before step 3's measurement — that is the hazard 2.0
  exists to prevent.
- Do not weaken the cruiser invariant to get past step 1. It is describing a
  real 17 m unsupported span.

## Adjacent work

#414 (`fix/paths-planned-before-bridges`) is in `paths.ts` / `train/*` and
**does not touch `Scenery.ts`** — no overlap with this branch.

## #301 fixed — and it was not what the invariant's message said

**Instrumented first** (`LGP_DEBUG_PYLONS=1`, added to `coaster/pylons.ts` in
the shape of `paths.ts`'s `LGP_DEBUG_STREETS`). Seed 11's supports:

```
[pylon] slot 1 wanted 12.2 m, stood at 12.2 m (nudge 0)
[pylon] slot 2 wanted 24.5 m, stood at 29.0 m (nudge 4.5)
```

**Nothing was skipped.** Every slot placed a pylon. Slot 2 could not stand on
its even mark — `0`, `±1.5` and `±3` were all refused — so it slid `+4.5` and
left **16.8 m** of unsupported track *behind* it. The invariant's hint ("the
search should have felled whatever foliage was refusing a spot here rather
than skip it") is **stale**: `planCruiserPylons` already fells trees, and the
gap was not a skip. Neither sign of the nudge fixes it either — `−4.5` merely
moves the same gap forward onto the next pylon. With `PYLON_SPACING` 12 and a
`±6` budget the reachable worst case is a 24 m gap, so this was a latent hole
that the maze change exposed rather than caused.

**Fix:** the planner backtracks on the gaps its own nudges open, per CLAUDE.md's
standing rule. Every screen moved into one `tryPlace` helper — so the slot pass
and the fill pass cannot drift into separate ideas of a legal support — and a
bounded fill pass then inserts a pylon into any gap wider than the planner's
**own** `slotSpacing` (`route.length / attempts`, measured from the route it
just walked, deliberately *not* copied from the invariant's 15 m tolerance, so
the two stay independent). An ordinary run has every gap exactly `slotSpacing`
and fills nothing.

```
[pylon] filled 16.7 m gap after 12.2 m with a pylon at 19.1 m
```

Filling only ever *adds* a support, goes through the same crowding rule, and
leaves a gap nothing can legally stand in exactly as it was — an honest hole
beats a pylon in a flowerbed. `test:procgen`: **487 passed, exit 0.**

## The sweep — the maze coupling is gone, and 2.5 is the answer

`LGP_CONNECTOR_CAP` added as a measurement hook (same shape as the existing
`LGP_SPUR_STRETCH` / `LGP_DISABLE_INTERCONNECTS`; defaults to 2.0, so the
shipped park is unchanged).

**Connectors built, per seed, per multiple:**

| cap | canonical | seed 2 | seed 5 | seed 11 | seed 18 |
| --- | --- | --- | --- | --- | --- |
| **2.0** (today) | 3 | 5 | 5 | 4 | 5 |
| **2.5** | **4** | 7 | 5 | 6 | 5 |
| 3.0 | 5 | 8 | 5 | 7 | 7 |
| 3.5 | 5 | 8 | 6 | 7 | 7 |

**`poi.stranded` (`check:park`, canonical) — the number that pinned the cap:**

| cap | 2.0 | 2.5 | 3.0 | 3.5 |
| --- | --- | --- | --- | --- |
| `poi.stranded` | **0** | **0** | **0** | **0** |
| `check:park` exit | 0 | 0 | 0 | 0 |

**The maze-stranding hazard is gone.** At 3.5 — the multiple that used to
strand 38 waypoints — nothing is stranded at all. That is the decoupling doing
exactly what it was for, and it is the evidence the cap may now move.

**All five seeds, `test:procgen`:**

| cap | 2.5 | 3.0 | 3.5 |
| --- | --- | --- | --- |
| result | **487 passed** | 486 / **1 failed** | 486 / **1 failed** |

A *different* constraint binds above 2.5, and it is not stranding:

```
FAIL seed 11 > every paved path runs on grid axes
connector-stall.railRacer-stall.waterFight runs diagonally for 26.2 m,
from 56.1, 8.2 to 80.8, 17.0
```

At 3.0+ the cap admits pairs too far apart for the street lattice to serve, so
the connector falls back to the continuous router and draws a 26 m diagonal —
straight through Decision 3 (paths run on grid axes). That is a real limit of
the *router*, not a tolerance to widen, and it is a separate ticket if anyone
wants 3.0.

**So: 2.5, measured, not chosen.** It is the largest multiple green on all five
seeds, and on the canonical park it restores exactly the connector #431 cost:

```
canonical @ 2.5:  ferrisWheel - stall.spaceFerrisWheel
                  dodgems - stall.dodgems
                  ballPit - exit-ginormousSlide
                  stall.spaceFerrisWheel - stall.facePaint   <-- restored
```

## Next

1. Land this branch (#438 + #301) — `test:procgen` 487, `tsc` clean. Needs
   `pnpm run check` and #431's measures re-run before the PR.
2. **Then** set `CONNECTOR_SPACING_CAP_MULTIPLE` to 2.5 on its own change,
   citing the table above, and re-run `check:path-preference` on
   `feat/prefer-walking-on-paths` to confirm the ride cluster is served.
   Expect mean paved to recover past its 75% floor; the worst-route floor may
   still need the `dodgems → stall.railRacer` pair looked at separately (they
   are 36.1 m apart, outside even a 2.5 cap).
