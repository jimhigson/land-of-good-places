# Handoff — stalls' `accommodate`

**Model: Opus 5 (1M context)**, chosen by the Overseer (Engineer default).
A replacement runs the same model.
Branch `feat/stall-accommodate`, based on `origin/feat/procgen-on-sphere`
(NOT main). Worktree `.claude/worktrees/stall-accommodate`.
Read `HANDOFF-backtracking.md` on this branch first — it is the record of the
backtracking procgen this sits on top of.

## The task

Jim: *"also make all features able to accomodate small movements if required,
for example, maybe a stall would move, but this would be on the class that
does the stall placement to decide to move it to a position to acoomodate a
feature that needs the space more."* Every feature on the base branch has an
`accommodate` except stalls. Build it.

## What I found before writing any code (read this first — it reframes the job)

1. **Stalls are not a `FeatureBuilder` at all, and they make no claims.**
   - Their spots come from the **layout** decision: `minigames/stallPlacement.ts`
     `placedStall(id)` → `parkLayout.ts` `placedEntry(id)`. The layout is plan
     builder #0 and it commits **zero** claims (`coarse()` with no `claims`
     spec → `{ claims: [] }`).
   - The booths are *built* in the `World` constructor (`MiniGameStalls`
     at World.ts:171, `FacePaintStall` ~:262, `KeychainShop` ~:268) and
     register **four walls each** with `CollisionWorld`
     (`stalls.ts` `addBoothCollision`: halfWidth 2.1, front 1.35, back −1.3,
     wall half-thickness 0.3 — a 4.2 × 2.65 box, hollow middle).
   - So **nothing in the registry can ever name `stalls` as a blocker.** A
     tree/bush refused by a stall just tries the next candidate
     (`collision.isClearCircle`); a lamp slot refused only by a stall collider
     falls through `lampFits` and is **silently forgone** ("Nothing fixed lets
     a lamp stand here"). That silence is the gap.

2. **Who could ask a stall to move.** `GroundClaims.blockers` is queried only
   by the world-phase builders (fountain, walls, trees, bushes, fairyLights,
   lamps) and the rail race's trestles. Every **plan**-phase builder
   (cruiser, train, slide, crossings, pathGraph, road) refuses with
   `consumed:` (a named decision), never `blockers:` — they never consult the
   registry. And they do not need to: stalls are plots in the layout, and
   `validate()` already keeps `CORRIDOR_GAP` = 5 m of walkable ground between
   plots, so a plan feature never collides with a stall.
   **=> the only real askers are world-phase features.**

3. **The driver's precedence** (`parkSolve.mayAccommodate`): a blocker
   accommodates iff `blocker.movable` **or** the blocker is *later* in the
   build order than the asker. The world phase is a **separate `ParkSolve`**
   with its own builder list, so a plan-phase builder is invisible to it
   (`this.index.get(name) ?? -1` → `undefined` → skipped). A stalls builder
   therefore has to live in the **world phase** to be askable at all.

4. **Why the shift must be small, and bounded by that.** The path spur to a
   stall's doormat is drawn at plan time (`pathGraph` → `Garden`'s paving),
   long before the world phase. A stall that jumps leaves its spur pointing at
   where it used to be. A stall that shifts ~1 m keeps its stand point on the
   paving the spur already laid. That is exactly Jim's "**small** movements".

## Design of record

A `stalls` `FeatureBuilder` in `worldPhase.ts`, **first** in the order
(`deps: []`), one increment per stall:

- **claims**: the booth footprint, plus the stand spot as a `walkable` claim
  (`keepOutsFor`'s job: nothing solid may sit where a child is invited to
  stand).
- `advance` at attempt 0 places the stall exactly where the layout put it, so
  **every park is bit-identical until an accommodation actually fires**
  (provable by the park digest).
- `movable: true` — Jim puts the judgement in the stall class, not in the
  driver, so the stall is *askable* and its own `accommodate` is the thing
  that refuses. (Every world-phase asker is a structure or a light; there are
  no frivolous askers in that phase.)
- `accommodate(claimIndex, attempt, keepClearOf)` searches a bounded ladder of
  small shifts, accepts only one that keeps the booth clear of every claim and
  of `keepClearOf`, keeps the stand spot standable, clear and reachable, and
  keeps the doormat on the spur's paving — otherwise it **refuses**, and the
  asker (a lamp slot) is forgone as it is today.
- The booth is then **relocated** — mesh, four wall colliders, interact zone —
  in the same commit, so the thing a child sees and the thing she bumps into
  move together.

## Measured

**Adding stall claims changed no park.** `scripts/park-digest-sweep.sh` on the
base (`origin/feat/procgen-on-sphere`, ae20b9fc) and on this branch, one
process per seed, all ten pool seeds:

| seed | base | branch |
|---|---|---|
| 20260728 | a1b5c16077708bc0 | a1b5c16077708bc0 |
| 11 | cff174dae3575aff | cff174dae3575aff |
| 24 | d0bc7e0fcba4d73a | d0bc7e0fcba4d73a |
| 128 | 528eebcd274a31a6 | 528eebcd274a31a6 |
| 131 | 84627b8d3eb9d3a7 | 84627b8d3eb9d3a7 |
| 208 | 9248414212c4d8de | 9248414212c4d8de |
| 274 | a7918b629da40cc1 | a7918b629da40cc1 |
| 326 | 24190286f59c7f99 | 24190286f59c7f99 |
| 428 | 4026fa879ce5bbe3 | 4026fa879ce5bbe3 |
| 451 | 9c5c9504db51c63c | 9c5c9504db51c63c |

Identical, every one — mesh counts too. That is the property the design was
built for: attempt 0 of every stall is the spot the layout drew, and the
claims are the colliders' own geometry, so nothing that was allowed before is
refused now.

Canonical seed's world phase: 634 increments (626 before, plus the eight
stalls), 7 refusals, 7 accommodations, 0 refused, 0 forgone — the same seven
accommodations (two wall runs, five bush clumps) the base made.

**No pool seed asks a stall to move.** `grep stalls` over every seed's
`world-solve` trace finds only `placed stalls#0..7`: no refusal anywhere names
`stalls` as a blocker.

## Status

- [x] Worktree + install (pnpm 12.1.0 via the pin).
- [x] Baseline measurement — see **Measured** above. No pool seed needs it.
- [x] The builder (`src/world/stallsFeature.ts`), its `accommodate`, and the
      relocation (`MiniGameStalls.boothPlacement`). The face-paint and keychain
      booths answer `null` — they do not move — which `stallsFeature.ts` turns
      into an ordinary refusal; six of the eight move.
- [ ] Seeds 0..15: does any of them ask a stall to move?
- [ ] Reachability instrument **with a control run first**.
- [ ] Invariant in `test/procgen/invariants.ts`, proved red.
- [ ] 16 seeds of `check:park`; `test:procgen` name-diff vs
      `origin/feat/procgen-on-sphere`; two-process determinism digest.

## Environment notes

- `fnm use --install-if-missing` in every fresh shell (this branch's CLAUDE.md
  adds `.node-version`; pnpm does not switch node for you).
- Never `git stash` (shared across worktrees). Never `git add -A`.
