# HANDOFF — coplanar sweep (#472)

Branch `feat/coplanar-sweep`, worktree `.claude/worktrees/coplanar-sweep`.
No browser, no dev server: this is a headless geometry tool.

## State

Done. PR #473, rebased onto `main` after #463. **CI green on all five checks** at `1b3b0a5`-and-later:
Checks 24m19s pass, Coplanar faces **5m04s** pass, Procgen invariants 2m47s
pass, plus both deploy checks. Locally: `check` (`main`'s chain, unchanged),
`test:procgen` (17 files, **510** tests — `main`'s 502 plus the 8 controls
here), `check:coplanar` and `build` all exit 0.

That 5m04s is the number that vindicates moving it out of the chain: it is
exactly what would have taken `checks.yml`'s 24m19s past its 30-minute cap. No geometry changed, so there is nothing to look at — no preview
link was given, deliberately.

## What was built

| file | what |
|---|---|
| `scripts/coplanar-sweep.mts` | the measurement — world-space triangles bucketed by plane, area overlap between different meshes, same-facing only |
| `scripts/coplanar-rank.mts` | the sight line (can a camera see it) and the reach (how close can a child stand), and the ordering |
| `scripts/check-coplanar.mts` | the gate: five seeds, every space, ratcheted |
| `scripts/coplanar-baseline.mts` | generated; 281 entries |
| `test/coplanar/sweepControls.test.ts` | eight controls on the instrument |

`pnpm run check:coplanar`, run by **its own workflow** `.github/workflows/coplanar.yml`,
*not* by the `check` chain — `package.json`'s `check` is now byte-identical to
`main`'s (step sets diffed: nothing added, nothing dropped).

**It was in the chain, and taking it out is the important decision here.**
`checks.yml`'s job is already **25m04s / 24m11s / 22m52s** on `main`'s recent
runs against its own `timeout-minutes: 30`. A minute more is not free at that
margin, and a job killed by the cap reports as `cancelled`, which is precisely
the shape of the 29 August deploy outage this repo documents. So it takes
`procgen-invariants.yml`'s shape and runs beside the checks instead of inside
them — no critical-path cost, its own budget, and a failure that reads as
"somebody put two faces in a plane" rather than being buried in a 25-minute log.

**Needs a repository setting nobody but Jim can make:** `Coplanar faces` is not
a required status check on `main` until it is added to branch protection. Until
then it runs and goes red without blocking a merge. Reported on the PR, not
acted on — CLAUDE.md's rule for anything reaching outward from the project.

**And `checks.yml` at 25 of 30 minutes is a live hazard that predates this
work and outlives it.** Worth its own ticket.

## Numbers, as of 2 September 2026, all sixteen pool seeds

**281 seams, 10 spaces, 60 s** (sixteen parks, six at a time). 112 fighting at
0.1 mm; 169 more held apart by a stand-off under 1 cm; 182 of the 281 buried
where no camera can reach them on any seed.

Raw before aggregation: 11.8 M triangles → 1.81 M front-facing and over 1 cm²
→ 543 seams on the canonical seed alone.

Rebased onto `main` mid-flight when #463's sixteen-seed pool landed; the seed
source moved from `test/procgen`'s four files to `parkSeedPool.ts`'s sixteen,
which found 47 more garden seams (234 → 281).

## Decisions worth not re-deriving

- **`visible` is ignored.** 3841 of 5543 meshes are `visible=false` at build
  time, because the castle interior root and the hotel rooms are hidden until
  you walk in. Honouring it would sweep the park and skip every interior —
  which is where the last two of these bugs were.
- **The seeds come from `parkSeedPool.ts`, not `test/procgen`.** The pool is
  the one owner of which parks a child can be given; the test directory only
  keeps files for four of them.
- **Two orderings are pinned deliberately** — `findings` by seed, and the
  printed baseline by area then key — because the children finish in whatever
  order the machine gets to them. Without them the summary's occluded count and
  the baseline's line order both wobbled, and the baseline's diff is the review.
- **A key's rank comes from the seed that shows it worst**, not the seed with
  the largest overlap: the entrance road is 48 m² at the front gate on one seed
  and buried under a bridge ramp on another.
- **`Float64Array`, not `Float32Array`.** The hotel is 600 m out; a 32-bit
  float resolves ~6/100 mm there, coarser than the 0.1 mm tolerance. The
  control test's "600 m from the origin" case is what fails if anyone narrows
  it.
- **Plane separation is measured from each triangle's own vertex**, never from
  a world-origin plane offset `d`. At 600 m, a 0.001 difference in normal turns
  into 0.6 m of phantom separation.
- **Instances of one `InstancedMesh` are one object.** The world has never had
  a frame run on it, so the ferris gondolas and the hotel's disco motes are all
  still stacked at t = 0. Treating those as findings buried the real ones under
  two hundred of them.
- **CI is two cores, and the first version collapsed to one lane there.**
  `lanes` was `floor(cores / 2)` — fine on this laptop, one lane on a GitHub
  runner, so sixteen parks ran in a row inside a workflow capped at 30 minutes,
  and the first CI run reached **28m38s** still running. Be precise about that
  number if you cite it: the run ended `cancelled`, but by my own next push
  (`checks.yml` sets `cancel-in-progress`), **not** by the cap — so it is a
  measured near-miss, not a proven timeout. The optimised in-chain version then
  reached **23m39s** and was superseded the same way. **Neither in-chain run was
  ever observed completing**, which is exactly why the check moved out of the
  chain rather than being tuned until the number looked comfortable: `main`'s
  own 25m04s against a 30-minute cap is the fact that decides it, and that fact
  is not mine to make better by shaving my step. Fixed twice over: never fewer
  than two lanes, and the garden-only children now drop their indoor seams
  **before** ranking rather than after, which is where the cost is (a sight-line
  ray against every mesh in the game, plus a ring search, per seam). Same 281
  seams out. Do not re-tidy that filter back to where it reads more naturally.
- **The hash key is (world 4 m cell) × (normal cell, 27-neighbour probe).**
  A triangle is inserted into every world cell its box covers, so the grid
  cannot lose a pair; only the normal needs neighbour probing.
- Occlusion is one ray from the largest overlap's centre. Occluded seams are
  still reported and still ratcheted — they rank zero, they are not hidden.

## Proved red — transcripts, with the geometry they were taken against

Both against `src/world/entrance/Entrance.ts` at `72d526f4`:

1. `textPlane.position.set(0, 2.6, faceSide * 0.105)` → `* 0.1`, which removes
   the 5 mm stand-off between the welcome sign's mount and its text plane:

   ```
   TIGHTER: garden|entrance/welcome-sign/<Mesh:BoxGeometry>|entrance/welcome-sign/<Mesh:PlaneGeometry>
         now fighting at 8.9e-10 m; it was a stand-off when the baseline was taken
   ```
   exit 1.

2. A new `PlaneGeometry(2, 1)` named `deliberate-defect` added to `signGroup`
   at `(0, 2.6, 0.08)` — flush with the board's own front face:

   ```
   NEW: garden|entrance/welcome-sign/<Mesh:BoxGeometry>|entrance/welcome-sign/deliberate-defect
         2.000 m² of shared plane, fighting now at 1.8e-9 m, seen on seed 20260728
   ```
   exit 1.

3. A second unnamed `PlaneGeometry` added to `signGroup` at `(0, 2.6, 0.08)`,
   flush with the board's own front face — same scene-graph path as the
   existing text plane, so it lands on an existing ratchet key rather than a
   new one:

   ```
   WORSE:   garden|entrance/welcome-sign/<Mesh:BoxGeometry>|entrance/welcome-sign/<Mesh:PlaneGeometry>
   TIGHTER: garden|entrance/welcome-sign/<Mesh:BoxGeometry>|entrance/welcome-sign/<Mesh:PlaneGeometry>
   ```
   exit 1. Note which clauses fired: two *parallel* planes between the same
   pair fold into one seam, so this is caught by `area` and `fighting`, not by
   `seams`. `seams` counts distinct facings and exists for the other hole —
   `hotel.wall|hotel.wall` is one key covering two different meshes.

All three reverted; the check is green at exit 0 on the unmodified tree.

4. `LGP_RATCHET=off`, proved both ways without touching `src/` at all — delete
   the entrance road's line from `coplanar-baseline.mts` and the same run is
   exit 1 enforced and exit 0 with the switch, listing the finding either way:

   ```
   NEW: garden|entrance/entrance-road-gateway|entrance/entrance-road-kerb
         48.429 m² of shared plane, fighting now at 8.1e-5 m, seen on seed 24
   check:coplanar OK — … 1 new or worse, listed above and NOT enforced because LGP_RATCHET=off.
   ```

   The summary names the suppressed count rather than saying "none is new",
   which was the first version and would have made the switch a way to get a
   green line over a red result.

## If you pick this up

The backlog it produces is #467's list plus more. Fixing any of it is a
separate ticket — when a seam is fixed, `check:coplanar` prints
`BASELINE LOOSE` and asks for the line to be deleted from
`scripts/coplanar-baseline.mts`.
