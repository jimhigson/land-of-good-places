# HANDOFF — procgen rethink: why the park is slow, and what to do about it

Branch: `feat/hotel-236` · Worktree: `.claude/worktrees/hotel-236`
Mandate (Jim, 7 Aug): "the procgen of the park is crazy slow — in the 90s games
did almost instant procgen on much slower hardware. It is basically an
optimisation / space-searching problem; let's get smarter with faster algos."

**Nothing is committed.** Another agent is live-editing `src/world/hotel/*`,
`src/world/spaces.ts`, `src/core/constants.ts` and `art/blend/hotel_build.py`
in this same worktree — leave those alone; `npx tsc --noEmit` may show a
transient error in `Hotel.ts` that is theirs, not ours.

## Measuring while another agent edits the same worktree

The features agent is live-editing `hotel/*`, `spaces.ts` and `core/constants.ts`
here, and PR #223 landed mid-session. Both moved parks under me: I chased an
apparent divergence in seed 18's cruiser all the way to **stashing every one of
my own files**, and it still moved. A fingerprint that spans somebody else's
commit proves nothing.

So every before/after number below is taken from **two frozen snapshots built
from one `rsync`**, differing in exactly my five solver files (the "base" copies
come from `git show HEAD:<path>`):

```
diff -rq base/src opt/src   →   cruiserWindow.ts · parkLayout.ts
                                rail/generate.ts · rail/segments.ts · slide/plan.ts
```

Two things make that airtight, and both were checked rather than assumed:

- The solver stages import **32 modules and not one hotel or spaces file** —
  only `core/constants.ts`, which is byte-identical across the pair. (Walk the
  import graph from the five plan modules; see the closure check in this file's
  history.)
- Sweeps run `--no-world`, so `World`/`Hotel` construction — the only place the
  features agent's code executes — is never entered.

Watch the `rsync` excludes: `--exclude art` matches **any** path component and
silently removes `src/art` too, which fails every seed at the `paths` stage
with `Cannot find module 'src/art/style/materials'`. Anchor them: `--exclude /art`.

## The tool: `scripts/measure-procgen.mts`

```
node --experimental-transform-types --no-warnings \
  --import ./scripts/ts-extension-resolver-register.mjs \
  scripts/measure-procgen.mts            # canonical seed, per-stage
  … scripts/measure-procgen.mts 1 60     # sweep, solve-rate + distributions
```

Every solve in this codebase runs at **module load**, so a "stage" is a dynamic
`import()` in dependency order (ESM caches modules, so each stage is billed only
for the work it added). A sweep is one child process per seed, pooled 8-wide,
because a seed needs its own module registry.

Two metrics, and they are the same disease: **per-stage time** and **solve-rate**.

## PHASE 1 — BASELINE (measured, 7 Aug, seeds 1-60)

```
SOLVE RATE: 45/60 = 75%
per-stage ms over SOLVED seeds       median      p90       max   share
  boundary                             79.0     93.8     120.1     0%
  layout                               15.5     18.9      27.6     0%
  cruiser                            9455.0  46372.4  164329.3    39%
  train                               203.1    248.8     298.4     1%
  slide                              5226.1  27686.2   63567.6    21%
  railRace                             15.7     23.3      81.3     0%
  paths                                22.7     36.6      64.1     0%
  world(scene+scatter)               1057.3   1297.8    1438.5     4%
  navGrid                               0.0      0.0       0.1     0%
  poiGraph                            333.5    394.6     456.0     1%
  TOTAL                             24521.8  68725.5  188793.0
which stage killed each failure:  cruiser 11 · slide 3 · world 1
```

**The canonical seed is one of the lucky ones** — 6685 ms total, against a
median of 24.5 s and a worst of 188.8 s. Anyone tuning against the canonical
seed alone has been optimising the easy case for weeks.

Canonical per-stage baseline: boundary 51.8 · layout 10.3 · **cruiser 3218** ·
train 154.9 · **slide 1830** · railRace 11.1 · paths 14.2 · world 815.2 ·
navGrid 0.0 (lazy) · poiGraph 269.7 · **TOTAL 6685 ms**.

## PHASE 2 — DIAGNOSIS

### The two solve reports, canonical seed (`scripts/probe-solve.mts`)

```
cruiser  762 start poses offered, took index 68; 236,320 candidate pieces;
         14,263 backtracks; 13,968 closure attempts; 26 satisfy-rejects
         rejected: 125,547 collision · 53,291 boundary · 80,159 self-clearance
                   165,228 curvature
slide  2,025 attempts offered, took index 48; 349,280 candidates;
         21,482 backtracks; 21,455 closure attempts; 13 satisfy-rejects
         rejected: 444,810 collision · 21,768 boundary · 20,168 self-clearance
                   202,049 curvature
```

Eleven final segments cost 236,320 candidate pieces and 13,968 analytic
closure attempts. **68 whole start poses were explored and thrown away before
one worked, and 26 complete loops were solved and then discarded** by the
castle backstop.

### Where the time went (Node `--cpu-prof`, cruiser solve)

```
21.5% selfClear (rail/generate.ts)      ← 3×3 grid lookup, STRING cell keys
14.5% clearOfFootprints (parkLayout)    ← Map iterator + O(plots) scan, per sample
14.3% castleMasonryDistance + distanceToRect  ← 7 rects + 4 towers, per sample
 7.0% validate      6.3% minCurvatureRadius   2.7% GC
```

**Nothing here was an algorithm.** 58% of the Sky Cruiser's solve was spent
re-deriving, per sample, answers that a prefilter or an integer settles.

### Why seeds FAIL (the brittleness, from the sweep's own error text)

The cruiser failures divide in two, and the split is the finding:

- **Starved**: seeds 4, 29, 30 gave up after **8, 14 and 10 attempts** having
  tried 128, 272 and 208 candidate pieces — sixteen per attempt, i.e. **one
  joint**. The search did not run out of budget; `stationPoses` only ever
  offered it eight start poses, because `stationWindowIsClear` rejected the
  other 1,400. The outermost level of the search was empty before it began.
- **Ground down**: seeds 25, 48, 56 tried 204-382 attempts and 350k-810k
  candidate pieces. Those are the same seeds that appear in the slow list at
  45-164 seconds.

Both are the same fault: **candidates are produced by rejection sampling and
then filtered, instead of being constructed inside the region that is actually
free.** When the free region is large the filter is merely wasteful; when it is
small the filter starves, and the park will not build at all. Slowness and
brittleness are one disease, exactly as HANDOFF-hotel-236 suspected.

The slide has a third, sharper version of it: the search is given
`desiredLength: 60` and no ceiling, closes anywhere up to `60 × 1.45` plus a
closer, and `satisfies` then rejects anything over `MAX_RIDEABLE_LENGTH = 75`.
**The one hard constraint that decides the ride is invisible to the search that
solves it** — so seed 5 solves 123 routes and throws all 123 away.

## PHASE 3 — WHAT HAS BEEN REBUILT (in progress)

### Increment 1 — the inner loop, and it is byte-identical

Proved by `scripts/fingerprint-cruiser.mts` / `fingerprint-slide.mts` and by
every counter in the solve report being unchanged (candidates tried,
backtracks, closure attempts, per-reason rejection counts, solved length).

- `rail/generate.ts` `selfClear`: **integer cell keys** instead of `` `${gx},${gz}` ``
  (nine fresh strings per sample), index loops instead of `for…of`, and an
  early `break` — a bucket is in arc order, so once one entry is close enough
  behind the head to ignore, so is every entry after it.
- `parkLayout.ts`: plots held as **flat typed-array columns**, built once, with
  exact axis prefilters (`hypot(a,b) >= |a|`, so an axis alone settles it).
- `building/cruiserWindow.ts` `castleClear`: **a bounding-box early-out**
  inflated by `TOWER_KEEPOUT_RADIUS` (the corner towers are centred ON the
  corners and reach outside the walls — a box drawn to the walls alone would
  wave a route through a tower).
- `rail/segments.ts` `minCurvatureRadius`: the two derivatives written out,
  same arithmetic in the same order, instead of 130 calls per piece
  re-deriving the same six control differences into two scratch objects.

Canonical measured after Increment 1: **cruiser 4050 → 1291 ms (3.1×)**,
**slide 2385 → 1337 ms (1.8×)**.

### Increment 2 — the slide's ceiling, visible to the search that solves it

`RouteBrief.maxLength` (see its doc comment). Deliberately changes the slide's
routes on every seed; leaves every other ride byte-identical because a brief
that does not set it makes no comparison at all.

## AFTER-NUMBERS — what actually ships

Paired snapshots from one `rsync`, differing in exactly my five files, 60 seeds,
`--no-world`. **Increment 2 is gated off** (see below), so this is Increment 1
alone — a pure identity transform.

```
                        BASE    SHIPPED    factor
sweep wall            387.5 s   204.1 s     1.90x
SOLVE RATE            46/60     46/60       unchanged — as an identity MUST be
TOTAL   median        32658 ms  15362 ms    2.13x
        p90           83821     46164       1.82x
        max          227113    103247       2.20x
cruiser median        13807      3872       3.57x
        p90           54865     23724       2.31x
        max          190329     83903       2.27x
slide   median         7642      4695       1.63x
        p90           35201     24867       1.42x
        max           86395     60626       1.43x
```

Canonical seed, per stage: cruiser **3218 -> 1291 ms**, slide **1830 -> 1337 ms**.
The failed-seed list is character-for-character identical to BASE.

The small stages (boundary, layout, train, railRace, paths — together under 3%
of a build) move by up to ±30% in *both* directions between runs. That is 8-way
parallel-sweep noise on stages dominated by module parse time, not signal.

### Increment 2 measured, then GATED OFF — and why that was right

With `maxLength` on: slide median **7.6 s -> 2.0 s (3.8x)**, seed 38 went from
failing to solving, seed 53's waste fell from 47 rejected routes to 2, and the
whole-park median hit 15.0 s at a **78%** solve rate.

It also turned `the ginormous slide stands on legs a child can walk between`
**red on seed 2**. Per CLAUDE.md the check is right and the algorithm is
incomplete, so it does not ship: a measured 3.8x is not worth one red invariant.
The one-line switch and everything needed to finish it are documented at the
call site in `slide/plan.ts`. Two other things to fix in that pass: seed 5 spends
**18.7 million candidate pieces** discovering an honest "no route exists" (an
attempt should bail once nothing fits under the ceiling), and seed 5's slide may
simply be infeasible at 75 m from the poses it is given — a question for Jim,
not a solver bug.

### The honest headline: the speed is fixed, the brittleness is not

**The eleven cruiser failures are unchanged and byte-identical** — same seeds,
same attempt counts, same candidate counts. A 2.1x speedup buys nothing for
solve-rate: slow and brittle share a *cause*, not a *fix*. Getting past 77%
needs the constructive-placement work in Decision 10 part 4, which is the next
person's job and is specified there.

## Verification

- **Cruiser byte-identical on all five CI seeds** (`fingerprint-cruiser.mts`,
  base vs opt snapshots: curve SHA256 + full solve report). The cruiser
  exercises every one of Increment 1's optimisations, so this is the proof for
  all of them.
- **`npx vitest run` matches pristine HEAD exactly**, quoted off the screen:
  both `Test Files 3 failed | 7 passed (10)`, `Tests 2 failed | 215 passed |
  48 skipped (265)`, same three failures (seed 5's park does not build; seed
  11's rainbow; seed 2's cruiser). Those three are **pre-existing** — they fail
  identically on a pristine `git archive HEAD`.
- Both suites were run against a copy of `invariants.ts` repaired with the
  missing `};` (below), because HEAD's does not parse.

### BLOCKER FOUND ON THE PUSHED BRANCH — not mine

`test/procgen/invariants.ts` **at HEAD does not parse**: the `};` closing
`skyCruiserStandsOnItsOwnSupports` (opened line 4001) is missing, so oxc fails
the file at EOF and all five seed test files fail to collect. `npm run
test:procgen` — the check that blocks merges — therefore cannot run on the
branch as pushed. A one-line fix exists as an **uncommitted** edit in the
worktree (`git diff test/procgen/invariants.ts`, +`};` at 4089). It needs
committing by whoever owns it; I did not touch it, and I ran my own gate against
a copy repaired with that line.

### Still to do

- Decision 10 part 4: construct start poses in the free region instead of
  filtering 1,400 down to 8, and make `stationWindowIsClear` ask the same
  question the search asks (it tests bounding circles at 1.2 m; the search tests
  footprints at 3.6 m — a pose can qualify and have no legal first piece, which
  is what seeds 4/29/30 die of, at 16 candidates and 0 backtracks each).
- Early bail when nothing fits under `maxLength` (seed 5's 18.7M pieces).
- Grid-bucket the plot queries (exact, not a distance-field approximation).

## For the staged-procgen / loading-screen agent

The stage boundaries are exactly the dynamic imports listed in
`scripts/measure-procgen.mts`'s `STAGES`: boundary → layout → cruiser → train →
slide → railRace → paths, then `World` construction, then `NavGrid` (already
lazy — it measures 0 ms) and `PoiGraph`. Cruiser and slide are 60% of the
budget between them and are the two worth showing progress for.
