# HANDOFF — triage of the 51 `Procgen invariants` failures on `feat/sphere-combined`

**Model: Opus 5 (1M context)**, Engineer. A replacement runs the same model.
Branch `fix/sphere-procgen-triage` off `origin/feat/sphere-combined` @ 5c322a5b.
Worktree `.claude/worktrees/sphere-procgen-triage`. No browser, no dev server.

Source list: CI run 35120529727 (head 5c322a5b) — `51 failed | 628 passed (679)`, 0 skipped.
Local canonical run reproduces the canonical subset exactly (17 s per seed file).

## The 51, by test name (x seeds)

| test | seeds |
|---|---|
| park gate arch stands over its gateway | 5 |
| Rail Race duck bar stands over a real trestle leg | 5 |
| Rail Race duck bar slows you down where it stands | 5 |
| every support meets the track it carries | 5 |
| Rail Race trestle forks twice and carries all four tracks | 5 |
| Rail Race sleepers bridge both rails | 5 |
| every racer meets the same number of duck bars | 5 |
| Sky Cruiser stands on its own supports | 5 |
| both Rail Race rings stand outside the park | 5 |
| slide does not clip the castle towers | 24, 326 |
| every modelled coping stone sits on the wall it caps | 11, 326 |
| slide clears the garden on the castle roof | 131 |
| no drawn path ends in mid-air on a bridge | canonical |

## Verdicts (filled in as reached)

(in progress)
