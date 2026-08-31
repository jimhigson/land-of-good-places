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
