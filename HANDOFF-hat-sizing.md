# HANDOFF — hat-sizing

Branch `hat-sizing`, worktree `.claude/worktrees/hat-sizing`.
Family bug: **every hat is much too small, except the RiPika head, which is too large.**

## Root cause (measured, not guessed)

`art/models/kid.ts`'s cartoon pass took `HEAD` from 1 to 1.5. Everything inside
the head group is written `x * HEAD`, so hair, ears, face patch and the hat
anchor all grew. `art/models/hats.ts` is a different file holding the raw
0.44 m-skull numbers with no reference to `HEAD`, so **the hats did not grow**.

The RiPika hat is unrelated: it was added a day later at `RIPIKA_HAT_SCALE =
2.1`, picked so the ball is as wide as the wearer's *whole head*. A ball worn
on top of a head rises by its own diameter, so it took a 2.12 m child to
3.65 m.

## Measuring

`scripts/measure-hat-fit.mts` (run it with the same node flags as the other
`.mts` checks; also wired as `npm run check:hat-fit`). Builds the real kid and
the real hats, measures both about the hat anchor's axis, vertices not boxes.

## Fix

- `KID_HEAD_SCALE` exported from `kid.ts`; `RIPIKA_HEAD_SCALE` from `ripika.ts`.
- `hats.ts` is authored in **head units** and converted once by a per-hat `fit`
  group scaled by `KID_HEAD_SCALE`. `root.scale` stays 1 for the caller's pop.
- Every hat's `height` is measured (`visibleTop`), not hand-written — retires
  four `KNOWN_DRIFT` entries in `check:assets`.
- The RiPika hat is built at `RIPIKA_HEAD_SCALE`: it *is* a RiPika head.
- Shop stands use the exported `HAT_DISPLAY_SCALE` so the displays are
  unchanged (life-size hats would saw through their neighbours at 0.85 m).

## State

Committed, `npm run build` green (exit 0). No browser — another agent owns it,
so the PR lists what needs visual QA.
