# HANDOFF — PR #634 / issue #629, `check:hotel`'s falling clause

**Model: Opus 5 (1M context)** — chosen by the Overseer for the engineer role.
Branch `eng/hotel-fall-629`, based on `eng/sphere-ground-claims`.
Worktree: `.claude/worktrees/eng-hotel-fall-634` (detached; push with
`git push origin HEAD:eng/hotel-fall-629`, because the branch itself is checked
out in the dead original author's worktree `eng-scale1-defects`).

## State

**Done.** Review's blocker addressed, PR body rewritten, all gates run.

## What the blocker was

`WalkSurfaces.sample(x, z, y)` is ceiling-gated at `y + BUILDING_STEP_UP`
(0.62 m) for ramps and platforms. A child who falls more than 0.62 m through a
platform therefore has **her own floor removed from the sampler's answer** —
`sample` falls through to terrain far below, `below` goes negative, and she was
filed under `carried`. All seven hotel residents, dropped 3 m, gave
`check:hotel OK` on `d913616`.

## The rule now

Ask the sampler twice and choose:

- `underfoot = sample(x, z, at.y)` — gated; what holds her up.
- `column = sample(x, z, ABOVE_EVERY_SURFACE /* 1e6 */)` — ungated; the highest
  surface in her column, including the floor she fell past.

Judged against `underfoot` when it is at her feet
(`underfoot - y >= -CLEAR_OF_SURFACE`, 0.25 m), against `column` when it is not.

Plus: **a hotel room is a pocket space that does not stand on the terrain.**
`sample` falls through to `walkableGroundAt` there, which is −220 m on the
sphere, so the terrain does not count as "at her feet" inside one. Derived as
"neither the garden (`spaceAt`) nor a castle floor (`surfaces.floorAt`)", never
a hand-kept list of room ids.

## Why not the plain column-only rule the review suggested

Measured, canonical seed, garden swept at 2 m pitch:
**67 of 40401 points have a column top >1 m above the gated ground** — the
railway bridge decks, worst 5.09 m at (−24, 36) (gated −4.12, column 0.97).
A child on the grass under one would read as fallen. Proved by standing Hugo
there: `check:hotel OK`, exit 0, `carried` still 11.

## Mutations (all on canonical seed 20260728) — full transcripts in the PR body

| mutation | result |
|---|---|
| 7 residents −3 m | exit 1, all seven named, `carried` stays 11 |
| 7 residents at raw terrain (−220) | exit 1, all seven named |
| 7 residents −20 m | exit 1, all seven named |
| Hugo (park child on terrain) −3 m | exit 1, named |
| Ola −2 m off her bridge deck to −1.01 | exit 1, named (old rule AND first cut both miss) |
| Hugo standing under the worst bridge deck | **exit 0** — correctly not reported |
| reverted, honest park | exit 0, worst 0.050 m, 11 carried |

Mutations were made by a temporary block inserted before `let lowest = Infinity;`
that moves characters after the settle loop, driven by `MUT634=a|b|c|ola|under|hugo`,
then `git checkout -- scripts/check-hotel.mts`. Nothing of it is committed.

## Gates

`tsc --noEmit` 0 · `pnpm run build` 0 (302 ms) · `pnpm run check:hotel` 0 ·
`pnpm run test:procgen` **1** — `Test Files 5 failed | 16 passed (21)`,
`Tests 85 failed | 563 passed (648)`, 49.83s. **Inherited from the base**,
identical counts, 85+563 = 648 so nothing skipped; issue #630 owns it.

Diff: one file, `scripts/check-hotel.mts` +188/−6. `package.json` untouched —
script step sets parsed both sides, 122 and 122, none added, none missing.

## Do not

- Do not exempt `scripted` characters — it would hide the bus dropping its own
  passengers (#633).
- Do not reach for `altitudeAt(...) < -2` — it samples a different column down
  the radial.
- Do not touch the author's "demonstration that refused to work" paragraph in
  the PR body; the correction sits beside it.
- Do not close or widen #633 silently. This change leaves it exactly as it was:
  a rider through the bus floor lands on terrain at her feet, so `column` is
  never consulted.
- Do not touch the `eng-scale1-defects` worktree; it holds the dead author's
  staged revert-experiment.
