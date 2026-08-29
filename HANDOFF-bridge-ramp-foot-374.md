# HANDOFF — issue #374, ramps steep enough to fall through

Branch `fix/bridge-ramp-foot-374`, worktree `.claude/worktrees/eng-374`
(its `node_modules` is a **symlink** to `eng-349`'s — deps are identical; it
shows as untracked because gitignore's `node_modules/` matches directories, not
symlinks. Never `git add` it).

**PR #375.** Blocks PR #352, which rebases onto this once it lands.

## The finding, in one line

`MAX_RAMP_GRADIENT` was a flat `0.6`; the planner truncated ramps to
`BRIDGE_RISE / 0.6` = 6.77 m and accepted them, giving a realised grade of 0.560
against a sprint budget of 0.512 — so a sprinting child loses the deck and falls
into the tunnel. **Pre-existing on `main`**: at `BRIDGE_LENGTH_SCALE` 1.00,
seeds 2 and 18 fail identically, so PR #352's 40% did not cause it.

## The arithmetic everybody kept getting wrong

`Player.update` hands `this.position.y` — last frame's **damped, lagging**
height — to the ground sampler. `WalkSurfaces.sample` will not return a *built*
surface more than `BUILDING_STEP_UP` above it. Climbing steadily the damp never
catches up: it keeps `2^(-MAX_FRAME_DELTA / 0.04)` = 0.236 of the gap per
clamped frame, so the lag settles at `r / (1 - r)` = **0.309 × the climb**.

    usable climb = BUILDING_STEP_UP / 1.309 = 0.474 m per frame
    peak grade   = 0.474 / PLAYER_LONGEST_STEP (0.925) = 0.512

Every earlier estimate omitted the lag and used 0.620 / 0.925 = 0.670. That
missing term is the whole bug. It is now `SPRINT_PEAK_GRADE_BUDGET` in
`constants.ts`, derived, with a note saying it is **the shape of issue #358**
(the vertical ground sample not sub-stepping the way lateral movement does), not
anything intrinsic to ramps.

## Two traps if you re-measure

1. **`WalkSurfaces.sample` never filters the terrain** — `best` starts at
   `groundAt(x, z)` and only decks/ramps/platforms face the ceiling. So losing a
   deck sets a child on the ground beneath it, not inside scenery. A deck lying
   *on* the ground at a ramp foot is not a fall, and an invariant that ignores
   this flags harmless ramp feet. Gate on `FALL_THRESHOLD`.
2. **Bare terrain, without importing `terrainHeight`** (which reaches
   `parkManifest` and pins every seed to the default park): call
   `surfaces.sample(x, z, -1e6)` — the ceiling then rejects every built surface
   and terrain is what comes back.

## Measured, built park, five seeds

Bridges before → after: canonical 2→2, seed 2 3→2, seed 5 3→2, seed 11 2→2,
**seed 18 3→1**. Seed 18 is the visible cost and is deliberate.

Worst sprinted-frame climb is **scale-invariant** where the ramp is
clearance-truncated: seed 2's `bridge-82.0` read 0.5250 at
`BRIDGE_LENGTH_SCALE` 0.65, 0.70, 0.75 and 0.80, identical to four decimals.
That is the tell that the length is not the lever.

## State

- `test:procgen` **453 passed, exit 0**; `tsc` 0; `typecheck:test` 0;
  `build` **exit 0**. Both suites run — `test:procgen` is not in the build chain.
- Both invariants proved red by mutation **against this branch's geometry**
  (restore `MAX_RAMP_GRADIENT = 0.6`; set `SITE_IDENTITY_TOLERANCE = -1`), quoted
  in the PR body. Re-prove rather than trusting those transcripts if the
  geometry moves again.
- Carries #352's even-ring-spacing fix, cherry-picked: the new ramp lengths hit
  the sliver-segment coping bug on seed 2 without it.

## Not done here, on purpose

- **#358** — the real cure. Sub-step the vertical ground sample and this budget
  stops binding; the park could then have short, steep bridges *and* the 0.25
  hump. Do not fix it in this PR.
- **Picking `BRIDGE_LENGTH_SCALE`** — #352's, and Jim's. Note this fix moves it
  the *wrong* way for him: bridges now need more run, so 35% shorter is not free
  unless #358 lands.
- **#373**, the curved bridge.
