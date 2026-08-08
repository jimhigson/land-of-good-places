# HANDOFF — slicing the Sky Cruiser's solve (#252, on PR #246)

Branch: `e-cruiser-slice-work`, pushed to `e/cat-bus-stage-a`
Worktree: `.claude/worktrees/e-cruiser-slice`
Base: `origin/e/cat-bus-stage-a` @ `6fa1c51`, with `origin/main` merged in twice —
`876ff9e` (#254 walls/taps/naps/rugs) and then `9271ee0` (#253, the train fix,
which landed mid-session).

## The job, and why the last attempt went to the wrong file

The cat-bus PR adds `check:park-boot` to the build chain and `deploy.yml` builds
before deploying, so a red `check:park-boot` stops the Cloudflare deploy.

It was red because of the **Sky Cruiser**, not the train. `train/plan.ts` imports
`COASTER_PLANS`, and `ParkGeneration`'s module list loaded `train/plan` first, so
the cruiser's whole solve was billed to the train's frame — measured in that
order, `train/plan` 1439.6 ms and `coaster/plan` **0.3 ms**. Issue #252 read that
number and went after the train's search. It could not have worked: with PR
#253's train fix applied the worst block only moved 1354 -> 1300 ms.

## What was done

1. **`coaster/{solve,plan,prewarm}.ts`** now mirror `slide/{solve,plan,prewarm}.ts`
   file for file. `plan.ts` is `export * from './solve'` plus
   `takePrewarmedCruiser() ?? planCruiser()`. No call site changed.
2. **`coasterRouteBriefs` extracted** from `CoasterRoute`'s constructor, so the
   brief can be built without importing the module that owns `COASTER_PLANS`.
3. **`ParkGeneration` slices the cruiser** before anything that imports it, which
   also fixes the misattribution: each module is now billed for its own work.
4. **`check:park-boot` proves the cruiser**, not just the slide, and two stale
   claims in it were corrected (below).

## Two traps found the hard way — read these before touching it again

**The constructor must not rebuild the brief on the pre-solved path.** It did at
first, purely to advance the `Rng` that `stationPoses` draws from, because
`hillPhase` draws next and skipping it would move every hill in the park. That
cost ~20 ms inside a frame that must not hitch. The fix is to hand over the
**same `Rng` object the driver's own brief call already advanced** — identical by
construction. Do not try to restate the draw count; it depends on how many
candidates survive `stationWindowIsClear`.

**The brief itself does not fit in one frame.** The park's edge is a spline, so
`boundary.distanceToEdge` is a real computation, and `stationWindowIsClear` asks
it seven times for each of 704 candidate spots — profiled at **17 ms of the
brief's 19 ms**. It is sliced a ring at a time (11 yields, ~1.8 ms each) using a
generator plus a thin synchronous driver, the same relationship `solveRailRoute`
has with `railRouteSearch`. No second slicing mechanism was invented.

Also dropped: `stationWindowIsClear` was called twice per spot, once per heading
sign. Its `along` range is symmetric about zero, so the reversed heading probes
the same set of points and cannot return a different answer.

## Numbers (canonical seed, this machine)

| | before | after |
|---|---|---|
| `check:park-boot` worst event-loop block | **1424.4 ms** | **39.3–40.3 ms** (ceiling 250, unchanged) |
| worst single `advance()` | 14.6 ms | 18.6–19.2 ms (ceiling 24, unchanged) |
| unbudgeted work | **1510 ms** | **128 ms** (ceiling 1000, unchanged) |
| `check:park-boot` exit | **1 (FAILED)** | **0 (passed)** |

Cruiser stage decomposed: brief ~19 ms, search ~1170 ms (29141 yields), finish
~13 ms.

**No threshold was weakened.** The 250 ms block ceiling, the 24 ms advance
ceiling and the 1000 ms unbudgeted ceiling are all untouched.

## Byte-identity

`measure:cruiser-fingerprint` and `measure:slide-fingerprint` on all five CI
seeds (20260728, 2, 5, 11, 18), before and after, taken **after** the `main`
merge because `main` #254 touched `stallPlacement.ts`. Baselines in
`fp-before.txt` / `fp-after.txt` in the session scratchpad. The canonical cruiser
matches down to `backtracks=14263 candidates=236320`, which is the RNG sequence
proving itself unchanged.

`check:park-boot` also hashes both cadences in one process and compares.

## Both new assertions were red-proved

- letterbox ignored in `plan.ts` -> *"a pre-warmed Sky Cruiser is still sitting in
  coaster/prewarm.ts"*, worst block back to 1357 ms;
- sliced path re-seeded -> *"a DIFFERENT LOOP from the one solved straight through
  (356.94 m vs 293.64 m)"*.

The second run is the argument for why the cruiser needs its **own** hash: it
moved the slide's route too, and the slide's own comparison still said
"identical", because both slide cadences read the same wrong cruiser.

## Corrections carried into the check

- The **"~44 ms" train figure lived here**, in `check-park-boot.mts` (not in
  `train/plan.ts`), and predated the hotel merge. Re-measured to ~157 ms, and
  recorded as leaving only ~1.5x of margin — too thin, written down rather than
  lived with, with the fix named as PR #253 rather than a higher ceiling. #253
  then landed mid-session and did exactly that: re-measured over three runs the
  worst block is **39.3–40.3 ms**, so 250 ms is back to ~6x clear. The margin was
  restored by fixing the cost, not by moving the line.
- The unbudgeted-work message asserted *"it is the slide being solved a second
  time"*. It never measured that. It now reports what it measured and warns that
  the module billed for a solve is whichever imports it first.

## The `main` merges

Two of them, one conflict each, both `package.json`'s build chain, both resolved
as the **union** and verified mechanically rather than by eye — a script list is
exactly where taking one side silently deletes the other's gates.

| merge | conflict | result |
|---|---|---|
| `876ff9e` (#254) | build chain | 40 steps; adds main's `check:tap-spacing` |
| `9271ee0` (#253) | build chain | 41 steps; adds main's `check:solve-cost` |

Verified after each: every chained script defined, no script key lost from
either side, and `check:cat-bus` / `check:bus-journey` / `check:park-boot` (the
branch's) still present and chained alongside main's.

`check:solve-cost` arrives from #253 and is compatible: it measures the
*straight-through* module-scope cost of each stage, which this change does not
alter (nothing in Node pre-warms, so `COASTER_PLANS` still solves synchronously).
Its header asks whoever merges the cat bus to reconcile the two checks' numbers —
that is done: `check:park-boot`'s stale "~44 ms" train figure is corrected above,
and the two own different questions (raw module cost vs. fitting the ride's
frame slices), so both stay.

## Still to do / watch

- The 24 ms advance ceiling has ~5 ms of headroom against the ~13 ms finish plus
  noise. If a future change grows `finishCruiserPlan`, slice its vertical repair
  loop the same way (it is already a bounded 10-pass loop, so it is a natural
  generator).
- `scripts/measure-cruiser-slices.mts` is the tool for re-measuring the three
  stages. It builds the route **once**, deliberately: `finishCruiserPlan` draws
  `hillPhase` from the stream, so finishing twice off one `Rng` gives the second
  a different height profile and a misleading number.
