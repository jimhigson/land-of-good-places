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

## Still to do

- The invariant (`test/procgen/invariants.ts`) covering the whole class of
  features that can silently place zero of themselves.
- Pole counts + `check:park` on seeds 0..15.
- `test:procgen` name-diff against the base (base has 55 known failures).
- Deliberate red proof of the new invariant.
- Determinism, two processes.
- Screenshot of the lit park for Jim.
