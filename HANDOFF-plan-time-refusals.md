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
| 0 | 0 | 11 | — |
| 1 | 0 | 11 | — |
