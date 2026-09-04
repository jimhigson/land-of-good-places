# HANDOFF — #507: pet-slide is genuinely red on pool seeds 11 and 346

Model: **Claude Opus 5 (1M context)**. Role: Engineer. Branch
`fix/pet-slide-507`, worktree `.claude/worktrees/pet-slide-507`, based on
`origin/main` `10fb7c2d`.

Node **26.7.0** (`/opt/homebrew/opt/node@26/bin/node`; `scripts/with-node` is
broken, #506). Exit codes from each run's own file, never through a pipe.

## Predecessor work — read before touching anything

- `HANDOFF-pet-slide-flake.md` on `fix/pet-slide-flake` (mine, PR **#512**):
  proves the "flakiness" was stale and that #507 is the whole of the remaining
  defect. 13 identical runs on `main`; 6 distinct on pre-#508.
- `HANDOFF-pet-slide-496.md` on `fix/pet-slide-496`: found and fixed the random
  seed draw (#508), and did the sweep that produced the two red seeds.

## The two defects

| seed | clause | failure |
|---|---|---|
| **346** | not inside her | `Little Mouse was 1 cm inside the child on ridden frame 459` |
| **11** | in shot | nearest companion filled ≥1% of the chase frame on only **89%** of 9 rasters, against 95% required (smallest 0.0%) |

They are **different defects** and probably want different fixes. 346 is a
body-spacing bug; 11 is a framing bug.

## Seed 346 — the mechanism is already written down in the source

`src/world/slide/petRiders.ts` places the `slot`-th companion at a **constant
arc-length offset** behind her:

```ts
export function petSlideOffset(slot: number): number {
  return PET_SLIDE_LEAD + slot * PET_SLIDE_GAP;   // 2.73 + slot * 1.98
}
```

`PET_SLIDE_LEAD = CHILD_RECLINED_LENGTH (2.28) + BODY_CLEARANCE (0.45)`.

The doc on `BODY_CLEARANCE` states the hazard exactly, and predicts this seed:

> 0.45 m … has to absorb four things a measurement of two straight bodies laid
> end to end cannot: **the chute bends**, so two rigid bodies spaced along the
> curve lie across its chords rather than along it, and reach past each other on
> the inside of every turn …
>
> At 0.30 m the mouse touched her over four frames at the very bottom of the
> descent — a centimetre, invisible, and exactly the sort of near-miss that
> becomes a visible clip **on a seed whose slide bends harder**.

Seed 346 is that seed. **Arc length over-states the separation of two rigid
bodies on a curve** — the chord between two points 2.73 m apart along a bending
chute is shorter than 2.73 m, and the bodies are straight. A single scalar
cannot absorb an arbitrary bend, so the constant is structurally unable to be
right on every park the generator can produce.

### The fix this points to (not yet implemented)

**Do not raise `BODY_CLEARANCE`.** That is tuning a constant until the two
known seeds pass, and it would fail on the next park that bends harder — the
same shape as weakening an assertion, one level down. It is also precisely
what CLAUDE.md's "procgen backtracks on collision" rule rules out: shrinking to
a floor and accepting a result that still does not clear.

Instead **solve for the offset against the curve that is actually there**: walk
back along the chute until the *straight-line* distance from the body in front
reaches the clearance the constants already state, rather than assuming arc
equals chord. That keeps `CHILD_RECLINED_LENGTH`, `PET_RECLINED_LENGTH` and
`BODY_CLEARANCE` as the single owners of "how long is a body" and "how much
daylight", and stops a bend silently eating the daylight.

**This is player-visible** — on a bending chute the pets would sit slightly
further back than they do today. So it is Jim's call, not an invisible merge.

## Seed 11 — not started

`in shot` is about the chase camera framing, not spacing. Do not assume the 346
fix touches it; measure separately.

## #471 is adjacent — say plainly whether this subsumes it

#471: a wide pet's body hangs outside the trough and the check measures its
**root**, so it cannot see it. Note the `not inside her` / `not inside each
other` clauses already measure **drawn oriented boxes** (`drawnParts` →
`orientedBoxOf`), not the root — so #471 is about a *different* clause (the
off-chute one). If a fix here changes how extent is measured, say whether it
subsumes #471 rather than quietly overlapping it.

## Constraints (from the coordinator, and CLAUDE.md)

- **Fix the defect, not the assertion.** Never weaken a threshold to make a
  seed pass; never remove a seed from `PARK_SEED_POOL` to make a number look
  right.
- Add/extend a `test/procgen/invariants.ts` invariant if procgen changes.

## Status

Reproducing seed 346 in this worktree for frame-level diagnostics
(`/tmp/psflake/507-346.log`). Nothing implemented yet.
