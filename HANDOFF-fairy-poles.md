# Handoff — fairy-light poles (branch `fix/fairy-poles`, off `feat/procgen-on-sphere`)

Worktree `.claude/worktrees/fairy-poles`. PR against `feat/procgen-on-sphere`.
Do not merge.

## The bug, measured

The park drew **zero fairy lights**, on this branch and on its base.

Two numbers kept in step by hand had collided:

- the main loop runs at `RING_RADIUS` = fountain radius + 5.5 = **14.9**, and
  paves `3.6 / 2` either side, so its **inner kerb is at 13.1**;
- `FairyLights.ts` carried the literal `FAIRY_RING_RADIUS = 13.5`.

So every one of the ten poles stood **0.36–0.41 m inside the promenade's
paving**, tested as "on a path", and was skipped. Measured on seed 0 before
the fix (`scripts/_probe-fairy.mts`, untracked):

```
pole 0 (16.60, -4.45) distanceToPath -0.400 onPath(1.2)=true
pole 1 (14.02,  3.49) distanceToPath -0.398 onPath(1.2)=true
... all ten negative, all ten skipped
```

A radius sweep at the ten bearings showed the only window: poles clear of
paving 10/10 at radius 11.0 and 11.5, **0/10 from 12.0 to 17.5**.

## The fix — one owner

- `paths.ts` now owns `MAIN_LOOP_WIDTH` (was the literal `3.6` in the ring's
  route *plus* a restatement inside `RIBBON_HALF_WIDTH_CEILING`).
- `paths.ts` exports **`plazaVerge()`** — the lawn annulus between the plaza's
  paving (`PLAZA.radius`) and the main loop's inner paving
  (`RING_RADIUS - MAIN_LOOP_WIDTH / 2`), with its `middle`. A **function**, not
  a constant: `PLAZA` is a plan view and reading one at module scope forces the
  solver mid-evaluation (the branch handoff's import-order rule 1).
- `FairyLights.ts` deletes `FAIRY_RING_RADIUS` and asks `plazaVerge().middle`.
- The pole's paving clearance comes from the game now:
  `POLE_RADIUS + PLAYER_RADIUS * 2` = **1.52 m**, replacing a bare `1.2`.
  Stricter, so nothing previously refused is now let through.
- Drawn poles/strings are named `fairy-pole-<i>` / `fairy-string-<i>` so the
  invariant measures the **built scene**, not the decision list.

Seed 0 after: `poles drawn 10/10, strings drawn 10 | verge inner 9.40 outer
13.10 middle 11.25 | nearest paving at the ring 1.84 m`.

The collider is unchanged and was already there: `collision.addCircle(x, z,
POLE_RADIUS)` per drawn pole.

**Model: Opus 5 (1M context)**, the Engineer default; nobody chose otherwise
for this task.

## The invariant (commit 2 on the branch)

`everyScatteredFeaturePlacesSomething` in `test/procgen/invariants.ts`, first
in the `INVARIANTS` list. It covers the **class**, not just the fairy poles:
the five world-phase features that scatter individually-`optional` things and
so can be forgone down to nothing — walls, trees, bushes, lamps, fairy poles —
plus a sixth clause for **fairy strings**, because poles are not lights (a
cable needs two *adjacent* poles, so a ring of isolated posts draws nothing
while the pole count looks healthy).

Thresholds are deliberately the weakest honest ones, "at least one". A real
minimum count would be the suite measuring the generator's own target rather
than the park. What is refused is **silence**, not sparseness — the real
numbers go to the stderr coverage line on every run either way.

`ParkFacts.fairyLights` counts `fairy-pole-*` / `fairy-string-*` **meshes off
the drawn scene**, not the decision list that produced them.

### Proved red, and the geometry it was proved against

Mutation: `fairyRingRadius()` forced to `return 13.5` (the old literal).
Park geometry at the time: `PLAZA.radius 9.40`, `RING_RADIUS 14.9`,
`MAIN_LOOP_WIDTH 3.6`, so the verge is `9.40..13.10` and the loop's inner
paving starts at 13.10. Probe under the mutation:
`seed 0: poles drawn 0/10, strings drawn 0`.

```
  everyScatteredFeaturePlacesSomething seed 20260728: walls 39, trees 72,
    bushes 429, lamps 82, fairy poles 0, fairy strings 0 (out of 10 slots)
 x every scattered feature actually puts something in the park
AssertionError: seed 20260728: the park has 0 fairy poles. ...
AssertionError: seed 20260728: the park has 0 fairy strings. ...
 Test Files  1 failed (1)
      Tests  1 failed | 98 skipped (99)
```

Real numbers, no `NaN`/`Infinity`. Mutation reverted; same command green:

```
  everyScatteredFeaturePlacesSomething seed 20260728: walls 39, trees 72,
    bushes 429, lamps 81, fairy poles 10, fairy strings 10 (out of 10 slots)
      Tests  1 passed | 98 skipped (99)
```

Note the stderr line is visible **without** `--reporter=verbose` — confirmed by
running it, not assumed.

**Lamps 82 -> 81 on the canonical seed** is expected and is the only knock-on:
the ten poles now claim ground, and one lamp slot that used to fit no longer
does. Nothing else moved (walls 39, trees 72, bushes 429 unchanged).

`tsc --noEmit` and `typecheck:test` both exit 0.

## Still to do

- Pole counts per seed 0..15 (probe running; `scripts/_probe-fairy.mts`,
  untracked, prints BEFORE(13.5) and AFTER off the same built park).
- `LGP_SEED=n pnpm run check:park` on 0..15.
- `test:procgen` name-diff against the base (base has 55 known failures).
- Determinism, two processes on a changed seed.
- Screenshot of the lit park for Jim (needs the browser — ask the Overseer).

## This worktree's CLAUDE.md is newer than the shared checkout's

It adds rules worth knowing: **never `git stash`** (shared across worktrees);
`pnpm run check:coplanar` and `pnpm run check:swept-bus` are their own
workflows and must be run before pushing; `fnm use --install-if-missing` reads
`.node-version` and nothing does it for you.
