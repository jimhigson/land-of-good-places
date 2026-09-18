# Handoff — plan-time refusals for the `check:park` residue

**Model: Opus 5 (1M context)**, spawned by the Overseer as an Engineer on a
slice of the procgen-backtracking rework.

> **Flag for the Overseer, raised at the start:** `HANDOFF-backtracking.md` on
> the base branch says *"Model: Fable (`claude-fable-5-1`), Jim's standing
> ruling for the procgen rework; a replacement runs Fable."* I am Opus and was
> dispatched as a new engineer on a slice rather than as that agent's
> replacement. Reported, not acted on.

Branch `feat/plan-time-refusals`, off `origin/feat/procgen-on-sphere`
(ae20b9fc). Worktree `.claude/worktrees/plan-time-refusals`. PR against
`feat/procgen-on-sphere`. Do not merge.

Read `HANDOFF-backtracking.md` first — driver, `FeatureBuilder`, refusals,
the two import-order traps.

## The task

Turn the post-build `check:park` residue (`poi.nospot`, `rail.walkable`,
`anchor.reach:waterFight`) into **plan-time refusals**, so the round-robin
backtracks away from the bad decision rather than shipping a park that
happens to come out right.

## Where the residue lives, if you have to find it again

- `poi.nospot` — `scripts/check-park.mts` ~line 536. `PoiGraph` drops a
  waypoint seed with nowhere within `NUDGE_REACH` a child can stand.
  No `RATCHET` entry, so any count > 0 fails.
- `rail.walkable` — `scripts/check-park.mts` ~line 749. A track centre-line
  sample that `isStandable` **and** `walkReachable`, not on a bridge. No
  `RATCHET` entry (deleted 7 Aug 2026, issue #241), so any count > 0 fails.
- `anchor.reach:waterFight` — `scripts/check-park.mts` ~line 905. Built lumps
  beyond `anchor.boundingRadius`. `RATCHET` entry exists at **worst 0**, so
  any overrun > 0 fails.

The precedent to copy: `pathGraphBuilder.solve` in `src/world/parkPlan.ts`
(the `outside` boundary screen, `screenDrawnPathsForOffSiteCrossings`, and
`pinchedSample`). The trap recorded there: a screen that asks a *different*
question from the build-time check is worse than no screen.

## Two at-source fixes already on the base that may have closed residue

Found by reading, before the sweep landed — both postdate the handoff table
they would invalidate, which is why step 1 is "measure, don't quote":

- **`rail.walkable`** — `src/world/train/fence.ts` ~line 118 records the exact
  fault: `deckSpanAt`'s offset probes were allowed to vote from *off* the
  deck's end, reading ground level beside the deck and pinning the seam's top
  there, leaving "a half-metre of bare rail a child could stand on,
  `check:park`'s `rail.walkable: 1` on seeds 4, 6 and 9 (one sample each,
  always the sample just before a deck begins)". The fix — only a probe the
  bridge actually covers may vote — is in the file.
- **`anchor.reach:waterFight`** — `src/world/parkManifest.ts` ~line 170 now
  declares `boundingRadius: 19`, raised from 16.3 because "the worst of seeds
  0–15 built out to 18.8 (seed 12; 18.6 on seed 6), so the declaration follows
  what is built". That closes the finding by **declaring what is built**, not
  by refusing anything.

So the live question for both is whether the class is genuinely dead or
merely absent from 0..15 — hence the planned wider sweep.

## Screenability, per class (analysis, before data)

- `poi.nospot` — **screenable**. A waypoint seed with nowhere to stand is a
  seed inside a *planned solid*; the claims registry holds those at plan
  time. Both recorded root causes (a spur routed outside the boundary; a seed
  inside castle turret stone) are plan-visible.
- `rail.walkable` — **not honestly screenable as written**. The build-time
  asker is `isStandable`/`walkReachable` against the `CollisionWorld`, and the
  fence that answers it (`buildRailFence`) needs a `CollisionWorld` and
  `Bridge[]` — both World-time. A plan-time screen would ask a *different*
  question (fence-segment coverage), which is exactly the `computeCrossings`
  trap the brief warns about.
- `anchor.reach:waterFight` — **screenable after all, and this corrects my
  own first reading above.** `src/minigames/waterFight/plot.ts` dresses the
  plot from `new Rng(0x77a7e5)` — a **fixed** stream, not the park seed — so
  the dressing is geometrically *identical in plot-local metres on every
  seed*. What varies is the world-space reach, because the plot group "leans
  to the local up" on the sphere, so how far the dressing throws out depends
  on **where the layout put the plot**. That makes the measured reach a
  function of a plan decision (`layout`), which is precisely what a plan-time
  refusal can consume. The ratchet note in `parkManifest.ts` saying "the pools
  and hedges are seeded per park" is **stale** — correct it if this lands.

  Traced the whole chain to be sure: `AnchorPlots`' constructor puts each plot
  group at `(x, terrainHeight(x,z), z)` and leans it with `standOnSphere`, and
  `groundInPlot` derives every prop's local `y` from the plot centre. So an
  anchor's world-space reach is a **pure function of its plot centre plus a
  fixed local model** — no World state in it, which is why a plan-time asker
  is possible at all. The one-owner shape, if it is needed: the dressing
  publishes its local lumps once, and one function projects them through the
  plot transform for a candidate centre; `check:park` and the plan screen both
  call it, the way `crossingPredicate.ts` is one predicate with three askers.
  A second hand-written reach formula beside it would be the exact fault this
  repo keeps paying for.

## Status

- [x] Worktree, `pnpm install --frozen-lockfile`, Node 26.5.0.
- [ ] **Step 1 — measure.** Baseline sweep `LGP_SEED=0..15 pnpm run check:park`,
      one process at a time, running now into
      `<scratchpad>/sweep-base/`. Handoff numbers are from an earlier commit
      and are treated as stale.
- [ ] Step 2 — screens for whatever residue is still there.
- [ ] Step 3 — proofs: trace evidence each screen fires; control-first honesty
      proof; two-process determinism; `test:procgen` name-diff; `check:park-boot`.

## Measurements (re-taken at this head)

Baseline sweep, `ae20b9fc` + nothing: **in progress**, table below filled as
it lands.

| seed | rc | secs | residue |
|---|---|---|---|
| 0 | 0 | 11 | — (1 unwind, decision-zero 1) |
| 1 | 0 | 11 | — (0 refusals) |
| 2 | 0 | 27 | — (0 refusals) |
| 3 | 0 | 116 | — (6 unwinds, train attempt 3) |
| 4 | 0 | 231 | — (14 refusals, 5 unwinds, decision-zero 1) |
| 5 | 0 | 11 | — (0 refusals) |

## The three controls this slice owes (planned before running)

If the residue is gone, the claim "gone" is worth nothing until the
instrument is shown able to fire, and shown to be closed **at source** rather
than by a differently-drawn park. So, one control per class — restore the old
input, watch the finding come back, then restore:

1. `rail.walkable` — revert `fence.ts`'s `deckSpanAt` guard (*"Only a probe
   the bridge actually covers may vote"*), re-run seeds 4, 6, 9.
2. `anchor.reach:waterFight` — put `parkManifest.ts`'s `boundingRadius` back
   to 16.3, re-run seed 12 (and 6).
3. `poi.nospot` — disable `parkPlan.ts`'s `outside` boundary refusal in
   `pathGraphBuilder`, re-run seed 4. This one doubles as proof that an
   existing plan-time screen is load-bearing.

Paste the geometry each was proved against alongside the transcript — a
red-run transcript goes stale (CLAUDE.md).

**The control harness itself has been controlled.** It is
`<scratchpad>/control.sh <on|off> <fence|manifest|outside>`, and all three
were applied and reverted with `git diff --stat` empty afterwards — an
instrument that leaves residue in the tree would poison every run after it.
The `manifest` one was additionally checked to hit **waterFight**'s
`boundingRadius: 19` and not **dodgems**', which carries the identical
number six lines later; anchored on the following `id: 'dodgems'`, and the
diff confirms dodgems' 19 is untouched.

## The shape of the deliverable if the residue is gone

The brief anticipates this case. Then the work is:

1. The sweep table above, taken at this head, as the evidence.
2. The three controls, so "gone" means "the instrument still fires and the
   class is closed **at source**", not "this seed drew a different park".
3. A **wide sweep past the pool** (16..39, `LGP_RATCHET=off --verbose`, which
   reports drift rather than failing and prints each anchor's built-out
   margin) to answer "absent by luck?" — a class that returns off-pool is not
   closed, only hidden.
4. The one fragility already visible by reading: `anchor.reach:waterFight` is
   held at zero by a **hand-declared constant** (`boundingRadius: 19`) that
   somebody re-measured against seeds 0–15 and typed in. That is the repo's
   most expensive habit — two definitions of one thing kept in step by hand —
   and the margin is 0.2 m (seed 12 built to 18.8). If the wide sweep puts
   any seed past 19, the honest fix is a **refusal in the world phase** (the
   ride's own dressing builder retries when its lumps exceed its declared
   reach), not another re-typed number.
