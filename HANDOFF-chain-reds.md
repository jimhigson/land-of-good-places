# Handoff — chain reds (`check:park-boot`, `check:layout-rung`, `check:arrival-camera`, `check:solve-cost`)

Branch `fix/chain-reds`, worktree `.claude/worktrees/chain-reds`, based on
`origin/feat/procgen-on-sphere` at **86f9a513** (two commits past the
`ae20b9fc` the brief named: `78d25b40` check:entrance-road, `86f9a513`
check:waypoints/#674). PR against `feat/procgen-on-sphere`. Do not merge.

Probe worktree `.claude/worktrees/chain-reds-probe` is a detached checkout of
`origin/fix/ride-scale-tdz` (PR #682), used as a control. Remove it when done.

## Triage on the base — the four are NOT four defects

| check | status on 86f9a513 | owner |
|---|---|---|
| `check:arrival-camera` | red, `Cannot access 'RIDE_SCALE' before initialization` | **not mine — PR #682** |
| `check:layout-rung` | red, 5 failures, all in the *machinery* half | mine |
| `check:park-boot` | **green, 4/4 runs** — but a latent red, see below | mine |
| `check:solve-cost` | green here; wall-clock budget, flaked at 260 ms once | mine |

### `check:arrival-camera` — belongs to #682, no residue

Same `hazards.ts:171` TDZ as `check:cart-shape` / `check:ground-claims`. One
cause, three checks. **Proved it is the whole story**: on the probe worktree
(`origin/fix/ride-scale-tdz`, 06085e08) `pnpm run check:arrival-camera` exits
**0** with `PASS: 28 checks`, every number real. So nothing on this branch is
needed for it — it goes green the moment #682 lands. Do not duplicate the fix.

### `check:layout-rung` — the check's own driver went stale, not the machinery

Geometry half (part 1) passes all three cases on the base:

```
  control: 14 doormats on seed 20260728, 0 refusal(s)
  a door 20 m outside the boundary at (0, 91.8): poi.nospot, blockers=[], non-plot=[boundary]
  four walls ringing the hotel doormat with faces 12 m out: poi.stranded, blockers=[ring-n,ring-s,ring-e,ring-w]
  a 3 m plot on the hotel doormat (inside the 7 m arrival exemption): 0 refusal(s)
```

Machinery half (part 2) reports **zero of everything**:

```
  machinery (LGP_LAYOUT_REFUSE=hotel:40, seed 20260728): 0 refusal(s), 0 rung-1 redraw(s), 0 rung-2 redraw(s), 0 decision zero(s), solved=0
check:layout-rung: 5 failure(s): ...
```

**Root cause.** The check spawns a child that runs
`await import("./src/world/parkLayout.ts")` and greps its trace. On the base
that import solved the layout at module scope. On this branch it does not:
`PARK_LAYOUT` is `lazyView(() => planPart('layout'))`, so an import decides
nothing. Run by hand, the child prints exactly one line and exits:

```
layout-trace: seed=20260728 cached — no solve ran in this process
```

The `LGP_LAYOUT_REFUSE` hook, the rungs and decision zero are all intact —
forcing the view (`m.PARK_LAYOUT.entries.size`) under the same env produces
the full ladder: `refusal ... rung=1 ... x11`, `redraw ... rung=2 ...`,
`decision-zero restart=0 after=hotel`, then `restart=1`, and so on. So this
is a check reporting about something it is no longer describing.

**Second, related defect found alongside it.** `parkLayout.ts:1080`

```ts
if (layoutTrace.length === 0) traceLine('cached — no solve ran in this process');
```

runs at module scope. With a lazy `PARK_LAYOUT` the trace is *always* empty at
that point, so this line is now printed on every run, including runs that go
on to solve. A coverage note that is unconditionally wrong is worse than none.

### `check:park-boot` — passes, and says on every run that it should not

Green 4/4 (21 s each), but every single run prints the same NOTE naming the
same task:

| run | ceiling | worst slice | units | of slices |
|---|---|---|---|---|
| 1 | 20.0 ms | 22.8 ms busy / 22.9 ms wall | 21 | 1 of 1690 |
| 2 | 20.5 ms | 22.5 ms busy / 22.6 ms wall | 21 | 1 of 1656 |
| 3 | 20.1 ms | 23.1 ms busy / 23.1 ms wall | 21 | 1 of 1687 |
| 4 | 20.1 ms | 22.4 ms busy / 22.4 ms wall | 21 | 1 of 1674 |

Always `parkPlan x21`, 21 work units, during **"joining up the paths"**. The
check's own words: *"If you see this line run after run, naming the same task,
that is the check telling you it IS the code."* One more breaching slice makes
it a foul (issue #606), which is almost certainly the red seen on `ae20b9fc`.
So this is a real slice-size defect to fix, not a pass to accept.

### `check:solve-cost` — a wall-clock budget on a shared machine

Not yet investigated. 260.3 ms once against a 250 ms budget, then 96.6 / 98.0 /
99.3 ms. Per CLAUDE.md the fix is to remove the non-determinism, not to widen
the budget.

## State

- Triage done and reproduced; nothing fixed yet.
