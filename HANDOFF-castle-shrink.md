# HANDOFF — castle floors, half the area (#403)

Branch `feat/castle-floors-half-area`, worktree `.claude/worktrees/castle-shrink`.
Dev server port **5404** (`--strictPort`), kill by PID only.

## The ask

Jim, 30 Aug: *"The floors inside the castle are still too sparse. Make them half
their current size to increase the feature density."*

Clarified: **half the AREA**, not half each dimension. 60 m plate → ~42 m.
He explicitly declined halving the linear dimension (that would quarter it).

## The numbers

`src/core/constants.ts`:
- `INTERIOR_HALF_X = 30` → `21.2` (60 m → 42.4 m)
- `INTERIOR_HALF_Z = 22` → `15.6` (44 m → 31.2 m)

Both scaled by 1/√2 = 0.7071. Area 2640 m² → 1323 m², ratio 0.501.

## Rules I am working under

- **Never relax a keep-out to make it fit.** If furniture no longer fits that is
  a finding for the Overseer, not a threshold to edit.
- `dressing.ts`'s docblock records why the plate was *widened* ("sixty metres of
  one flat pink colour is not roominess, it is an empty car park"). I am
  reversing part of that decision — amend the docblock with why, do not delete
  their reasoning.
- Prefer one owning constant; report anything hard-coding a position instead of
  deriving it.

## Status

- [x] worktree created
- [ ] survey of hard-coded positions
- [ ] the change
- [ ] gates
- [ ] before/after screenshots

## Findings so far

(none yet)
