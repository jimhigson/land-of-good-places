# HANDOFF — the trestle fork's fighting seam

**Model: Claude Opus 5 (1M context)**, chosen by the Overseer (Engineer
default). A replacement runs the same model.

**Branch:** `fix/trestle-branch-fighting`, based on `origin/feat/procgen-on-sphere` (`ca3b1b49`).
**Worktree:** `.claude/worktrees/trestle-tighter`.

## The job

`check:coplanar` reported, after #684 merged:

```
TIGHTER: garden|railRace/railRace:race-ring/railRace:trestle-branches-lower
         |railRace/railRace:race-ring/railRace:trestle-branches-upper
    now fighting at 7.6e-5 m; it was a stand-off when the baseline was taken
```

7.6e-5 m is inside the depth buffer's resolution, so the seam strobes. Fix the
cause, not the stand-off.

## Root cause — measured, not argued

The fighting pair is a **fork joint**. On the canonical seed,
`trestle-branches-lower#87` ends at `(40.52, -16.74, -95.98)` and
`trestle-branches-upper#175` begins at exactly that point and carries on nearly
in line with it. Two facts turn a joint into a shared plane:

1. **`strut` turns every cylinder with `setFromUnitVectors(UP, direction)`,
   which adds no roll**, so a strut's facet phase is a pure function of its
   direction. Two struts pointing the same way come out phased alike. Measured
   at the forks: **0.14° to 1.15°** apart, inside the sweep's 0.5° tolerance.
2. **`STRUT_RADII` tapers the tree continuously**, so `branches-lower.to` and
   `branches-upper.from` are *the same expression*. The cylinders are exactly
   as fat as each other where they meet.

Equal radius + equal phase + shared axis = one plane. **Structural, available
at every fork on every seed** — not a coincidence of this seed.

## The fix

`upperBranchGeometry.rotateY(Math.PI / BRANCH_RADIAL_SEGMENTS)` — the upper
generation rolled **half a facet**, so its faces sit at the midpoints of the
lower's and no face of one can ever coincide with a face of the other, at any
joint angle, on any seed.

**Why not a per-strut random phase** (the other candidate, and the shape of the
fairy-lights fix): it is weaker here. It leaves every near-collinear pair a
~2% chance of landing within the sweep's 0.5° tolerance anyway — a seam waiting
for a seed nobody has drawn yet. The half-facet offset is exact rather than
lucky, and needs no RNG plumbing.

No stand-off, nothing nudged apart (ART_DIRECTION.md §7). An N-gon rolled about
its own axis is the same N-gon and the instance scale is equal in x and z, so
the silhouette is untouched. Nothing reads the phase: the claims, the post
collider and `check:swept-bus` all read endpoints and radii.

The stale baseline entry is deleted in the same PR — **that deletion is the
guard**. With no allowance left, a returning fork seam arrives as `NEW` and
fails the check. That is why no bespoke procgen invariant comes with it; one
would be a second definition of the same rule.

## Verified

- **Targeted**: trestle-branch seams on the canonical seed **3 → 0**.
- `check:coplanar`: findings **11 → 10**, `TIGHTER` **1 → 0**, `BASELINE LOOSE`
  0, zero findings mentioning `trestle-branches`. Still exit 1 on the
  **10 pre-existing** seams, which are a separate workstream (two need Jim).
- `test:procgen`: 25 failed | 668 passed — failing test **names** diffed
  before/after, **none added, none fixed** (10 distinct names either side).
- `check:swept-bus`: exit 0. **And re-run at `POST_STEP`/`SWEEP_STEP` = 0.02 m**
  as the check itself instructs after supports move, still exit 0 — it reads
  `trestle-branches-upper`, the mesh I rolled, and the roll moves the drawn
  surface by under a millimetre. Script restored afterwards.
- `pnpm run build`: exit 0.

## Three-strut nodes — asked in review, answered with numbers

The roll separates the two *generations*, so a node where **three** struts meet
could have had a pair left unseparated. The tree meets three-at-a-time twice:
`trunkTop` = leg + 2 lower, `forkNode` = lower + 2 upper. Measured across five
seeds, both rings — every pair is covered, each by an independent mechanism:

| node | pair | separated by | measured |
|---|---|---|---|
| `trunkTop` | leg ↔ lower | radius step | **0.18256 m**, 18× the sweep's 1 cm `near` threshold |
| `trunkTop` | lower ↔ lower | angle | **≥ 41.12°** (tolerance 0.5°) |
| `forkNode` | lower ↔ upper | **the half-facet roll** | radius step is **0.00000 m**, so nothing else could |
| `forkNode` | upper ↔ upper | angle | **≥ 37.85°** |

**The exposure was ~20× what the check reported.** Counting the fork pairs that
are actually in line: **~28 of ~200 per ring are within 0.5°, and 27–28 of those
are _exactly_ in line (< 0.0005°)**, with a 0.00000 m radius step, on every seed
and on both rings — so **~56 joints per park** had their faces in one plane.
`check:coplanar` reported three of them because of its overlap-area and
visibility filters.

That also settles fixed-offset vs random phase for good: against ~56 exactly
collinear pairs, a random phase would be expected to leave ~`56 × 8 / 360` ≈
**1.2 strobing joints per park**. The 2% I quoted was *per pair*; against the
real population it is not a small residual.

## Traps met on this task

- **`Vector3.transformDirection()` normalises.** Taking `.length()` off it to
  get a strut's length silently gives 1, so a probe's segments were the middle
  third of each strut and found nothing near the seam. Read the length off the
  matrix's own y-scale column instead.
- **The headless park's world matrices are not current.** Call
  `scene.updateMatrixWorld(true)` before reading `matrixWorld` in a probe.
- **`CoplanarPair.separation` is the gap at its *furthest*, not the closest
  approach** — so 7.6e-5 m means the two faces are within 0.076 mm *everywhere*
  they overlap, which is tighter than it first reads.
- **`TIGHTER:` is a fifth finding category** beside NEW/WORSE/MORE/BASELINE
  LOOSE. `NEW+WORSE+MORE` undercounts the headline. (Being filed by the
  Overseer.)
- **zsh runs backticks inside a double-quoted `-m`.** A commit message lost the
  word `strut` to command substitution. Use `git commit -F -` with a heredoc.
- `scripts/check-coplanar.mts` contains literal NUL bytes, so plain `grep`
  **silently skips the whole file**. Use `grep -a`.

## If picked up next

Nothing outstanding. Needs a review and the Overseer's merge. Ask the Overseer
whether this counts as visible: the mechanism has no silhouette effect, and the
only thing on screen is a sub-centimetre shimmer *stopping*, so I could not
honestly write "you will see X when you do Y" for Jim.
