# Handoff — stage 3, step 2a: the swept-bus instrument, as a ratchet

- **Branch**: `feat/swept-bus-instrument`, cut from `origin/design/round-robin-generation`.
- **Worktree**: `.claude/worktrees/swept-bus-2a`.
- **Model**: Opus 5 (1M context). Chosen by the Overseer's dispatch, per the
  Engineer default. A replacement must run the same model.
- **Brief**: `docs/BRIEF-stage3-step2a-swept-bus-instrument.md`.
  Authority: `docs/DESIGN-round-robin-generation.md`, "Stage 3, ruled (5 Sep, Jim)".
- **Scope**: step 2a only. Steps 2, 3, 4 are held behind other work.

## What is being built

`scripts/check-swept-bus.mts` — the cat bus's swept body along its arrival
route against the **drawn** rail-race trestle geometry (trunk *and* both
generations of branch), sampled **along each post at height**, on every seed in
`PARK_SEED_POOL`. Lands as a ratchet with a committed baseline
(`scripts/swept-bus-baseline.mts`) because `main` is red on it today.

## Why it exists

`check:entrance-road` (PR #498's branch) headlined *"0 legs hit on all sixteen
seeds"* while resolving each leg to its **foot**. A leaning leg's foot is up to
2 m from the drawn post; measured properly, 8–9 posts per seed sweep through
the bus at height. CLAUDE.md's signature failure — a measurement taken on a
convenient origin rather than on the thing that is drawn.

## Decisions taken (record as they are made)

1. **Name**: `check:swept-bus`, deliberately *not* `check:entrance-road` — the
   step-1 engineer owns that name; two checks must not both claim it.
2. **Baseline key = the seed, not a mesh name.** Issue #520 is that
   `check:coplanar`'s baseline is keyed on mesh names, so a rename silently
   loses the finding. A seed number cannot be renamed. Consequences:
   - a baseline entry for a seed **not in the pool** is a **failure**
     (orphaned entry, never a silence);
   - a pool seed with **no** entry defaults to zero allowed, so it fails on
     the first hit rather than passing unnoticed.
3. **The rename hazard one layer out, and the guard for it.** This instrument
   finds posts by mesh name (`railRace:trestle-legs`,
   `-branches-lower`, `-branches-upper`). Rename one and the sweep finds
   nothing and reports a triumphant zero — #520's disease in my own check. So
   **each named mesh must be found, with instances, on every seed**, or the run
   fails saying the mesh is gone.
4. **Where it runs**: its own workflow, `swept-bus.yml`, on `coplanar.yml`'s
   precedent — `checks.yml` is at ~25 of its 30-minute cap and a job killed by
   `timeout-minutes` reports as `cancelled`, not red. (Confirm against the
   measured wall clock before committing to this.)

## Status

- [x] Worktree, install, brief and design read; #520 read.
- [ ] Instrument written.
- [ ] Controls (flat bus → 0; feet-only vs drawn-post → different counts).
- [ ] Red run captured **with the geometry it was proved against**.
- [ ] Baseline committed; gates green.
- [ ] PR opened.

## Coverage, stated plainly (do not overclaim)

The instrument sweeps every seed in `PARK_SEED_POOL`. It says nothing about
seeds outside that pool. Separately, `check:park` is canonical-only and
`test:procgen` covers seven of sixteen pool seeds — that gap is issue #510 and
belongs to another engineer.
