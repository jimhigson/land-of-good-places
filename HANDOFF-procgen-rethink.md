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

---

# ROUND 2 (7 Aug, later) — making `test:procgen` green for the merge

Commission: PR #247's required "Procgen invariants" check is what blocks the
hotel branch. Judged by real greenness, not a massaged pass.

## Where it started, and where it is

```
BEFORE   Test Files  3 failed | 7 passed (10)
              Tests  2 failed | 215 passed | 48 skipped (265)
NOW      Test Files  1 failed | 9 passed (10)
              Tests  1 failed | 264 passed (265)
```

The pass count is the number that moved: **215 -> 264**. Seed 5 could not build
a park at all, so its 48 tests never ran — "48 skipped" was hiding a whole seed,
exactly the trap CLAUDE.md names ("a skipped test is not a passing test").

`npm run build` EXIT 0. `npx tsc --noEmit` clean.

## What was wrong, and what fixed it

Four faults, each measured before it was touched, and **three of the four were
one disease: two numbers for one thing, agreeing only by coincidence.**

1. **seed 5's park would not build.** The slide's search stopped at 92 m
   (`MAX_LENGTH`, inside its own `clear` predicate) while the verdict that
   judged its answer was 75 m (`MAX_RIDEABLE_LENGTH`) — so it solved 123
   complete routes in the dead band and threw all 123 away. One number now,
   handed to the search as `RouteBrief.maxLength`. Plus: `desiredLength` was a
   fixed 60 on a journey whose shortest possible chute is **8.7 m on the
   canonical seed and 30.4 m on seed 5** (`npm run measure:slide-feasibility`,
   written for this) — and every threshold the search steers by is a *fraction*
   of it, so seed 5 wandered 27 m before it began steering. The target is a
   ladder now, 60 first so every already-solving seed is untouched.
2. **The Sky Cruiser's exit was a ray, not a ring** — twenty samples in one
   direction, and if all were blocked it returned the 5 m mark it had already
   measured as bad. Revealed only once seed 5 could build. Now a fan.
3. **seed 2's fence in the cruiser's car.** The train's radial profile is solved
   at 360 bearings and the curve built from every 5th; a **1.7 m sliver** between
   the cruiser's low corridor and the park wall counted as free (`>= 1`), the
   profile sat in it at bearing 169 and was back inside by 175, and the
   Catmull-Rom cut straight through the blocked band. A gap narrower than
   `FENCE_OFFSET * 2` cannot hold a *fenced* railway however the centre line is
   drawn, so it is no longer offered.
4. **The finish rainbow's feet stood on the paths** (seeds 5 and 11). `buildArch`
   placed twelve legs with no idea where the paths were — its only world query
   was `terrainHeight`. `railRace/arch.ts` now owns where a foot lands, and
   `paths.ts` routes around them (Decision 6: publish what you solved). **Fixed
   seed 5; seed 11 is still red.**

## The one that is still red, and what it needs

`seed 11 > the Rail Race finish rainbow stands on the ground`.

Measured, not guessed (`scripts/diag-arch.mts` in the gate snapshot): seed 11's
arch inner feet run from (67.4, -21.4) to (65.1, -19.9) and the rail race
booth's doormat is at **(65.9, -20.7) — in the middle of that line**. The
nearest path is `spur-stall.railRacer`, and `routeAround` will not detour it
*by design*: a spur has to arrive at the door it serves. The arch and the
doormat are placed by the same bearing, so on this seed they are placed on top
of each other.

**I tried the obvious fix and backed it out, which is the useful part of this
note.** Sliding `startDistance` along the ring is the only lever that moves the
finish line and everything scored from it *together* (duck bars, spark zones,
`RACE_DISTANCE`, cart placement). Nudging it clear of the doormat worked — seed
11 went green, `48 passed` — but `startDistance` is the whole ride's datum, so
moving it moved seed 5's ride too, and **seed 5 went red on two tests**
(rainbow on paths again, plus a Sky Cruiser strike). One failure traded for two.
Reverted; the tree is at the better state.

What it actually needs: the nudge search must clear *everything the ride's datum
can collide with* — the doormat and plots (done, in the reverted patch), **and
the Sky Cruiser's loop, and the ride's own exit** — all of which are plan-time
knowable except the exit, which `railRace/plan.ts` computes after the rings and
would need reordering. That is a contained piece of work with a clear
acceptance test; it is not a knob to tune.

## Discipline notes for whoever is next

- **A green `tsc` is not evidence an import is safe.** `coaster/plan ->
  railRace/plan -> train/plan -> coaster/plan` typechecks perfectly and dies at
  module load with "Cannot access 'COASTER_PLANS' before initialization".
  `EXIT_INSIDE_EDGE` moved to `boundary.ts` to break it.
- **`snapToFree`'s doc still lies.** It claims "greedy continuity — the profile
  stays in whichever gap it is already in"; it snaps to the nearest interval
  with no memory of the previous bearing at all. Fix 3 removed the temptation on
  the seeds we test, not the capability.
- Measure against a `git archive HEAD` snapshot: other agents are editing this
  worktree live, and a suite run against their in-flight edits proves nothing.
