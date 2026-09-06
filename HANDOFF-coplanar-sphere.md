# HANDOFF — make `check:coplanar` green on `feat/sphere-combined` (PR #600)

**Model: Opus** (chosen by the Overseer; a replacement must also be Opus).
**Role:** Engineer. Reports to the Overseer (`landofgoodplaces-fc`), not to Jim.
Does not merge.

- **Branch:** `fix/coplanar-sphere`, cut from `origin/feat/sphere-combined`.
  **The PR goes against `feat/sphere-combined`, not `main`.**
- **Worktree:** `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/coplanar-sphere`
- **Scratchpad:**
  `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/coplanar-sphere/`
- **Browser:** not owned. No dev server started.
- **Another Opus engineer is live on `feat/sphere-combined` itself**, rebuilding
  the arrival camera (fixed on the player, ~2 m away, head height, until she is
  in the park) and the bus's road run. **Stay out of `catBus.ts`,
  `roadRoute.ts`, `roadCorridor.ts` and the arrival camera files.** If a finding
  needs one, message the Overseer rather than editing it. The branch will move;
  rebase when it lands.

## The three rules this task is bound by, and they are absolute

1. **Never add a baseline entry to make a finding pass.** An entry means
   "already wrong before the gate existed"; adding one for a live finding is
   silencing it.
2. **Fix the residue by deleting the hidden face** (ART_DIRECTION.md §7) — never
   by nudging a surface apart.
3. **A `BASELINE LOOSE` entry is a finding too.** The ratchet is bidirectional on
   purpose: it fails when things get better without the baseline being re-taken,
   so nobody banks an improvement silently. Re-take them and say in the commit
   what improved and why.

And: if a threshold genuinely has to be re-derived, **re-derive it from the
geometry and write down the two populations you separated and their numbers** —
never tune until green.

## The root cause of all of it, in one line

The sphere ground moved the terrain under geometry whose seam-avoidance
thresholds were measured against the old sine-hill park.

## The findings, and where each stands

Re-measured at branch head `943d4da1` (not the numbers in
`HANDOFF-no-hill-511.md`, which are one merge stale — **the
`path-surface|track-ballast` regression that file lists is already gone**, and
there are **nine** `BASELINE LOOSE` lines, not seven). The run:

```
MORE:  garden|park-train/railway-bridges/bridge/deck|park-train/railway-bridges/bridge/shell
       2 separate seam(s) between these two on one seed, recorded at 1
WORSE: garden|garden/boundary-wall/boundary-blocks|park-train/rail-fence/<Mesh:BoxGeometry>
       0.280 m², recorded at 0.051 m²
MORE:  garden|garden/boundary-wall/boundary-blocks|park-train/rail-fence/<Mesh:BoxGeometry>
       2 separate seam(s) between these two on one seed, recorded at 1
NEW:   garden|park-train/railway-bridges/bridge/shell|park-train/railway-bridges/bridge/wallTop
       0.052 m² of shared plane, a maintained stand-off at 5.3e-3 m, seen on seed 326
```

**The pool on this branch is 10 seeds, not 16**: `20260728` (canonical), 11, 24,
128, 131, 208, 274, 326, 428, 451.

### 1. Nine `BASELINE LOOSE` entries — DONE (commit 1)

Deleted by hand from `scripts/coplanar-baseline.mts`. Deliberately **not** by
`--print-baseline`, which would also have written today's *worse* numbers in for
the live findings — that is the silencing rule 1 forbids.

Six are things standing on the ground that used to graze it (hotel tower shell
and door jamb against `terrain`; the sky-cruiser, dodgems and spooky-house stall
base cylinders against it): the old sine hills undulated under a flat footing and
one boundary always found the ground's plane; the sphere's gentler continuous
curve does not. The other three: the water-fight plot's two rounded boxes, the
rail race's duck bars against its upper trestle branches, and
`path-kerb|path-surface` (closed by the merged road work).

### 2. `deck|shell` (MORE) — DONE (commit 2)

`deck` is an **invisible** box that exists only so `invariants.ts` has an object
named `deck` to take `Box3.setFromObject(...).min.y` off. But `check:coplanar`
never consults `.visible` — **it cannot**: the hotel's rooms and the castle's
floors are whole subtrees held hidden until you walk into them (measured: **3827
invisible meshes in one built park**), so a visibility test would blind the sweep
to all of them. So the marker's four upright sides went on being reported against
the shell's abutment faces they sit exactly in the plane of: 0.0173 m² on **13 of
the 16 findings across the pool**, and on **seed 208's `bridge-0.0` at both ends
at once** — normals `(-0.707, 0, 0.707)` and `(0.707, 0, 0.707)`, 180° apart,
which is two facings and the `MORE`.

Fix: `deckGeometry.setIndex([])` — the marker keeps its eight corners and its
name and carries **no faces at all**. Control run on the same yaw+translate the
bridges use:

```
index=full     triangles=12  min=(15.115071, 4.035000, -10.831323)  raycastHits=2
index=emptied  triangles=0   min=(15.115071, 4.035000, -10.831323)  raycastHits=0
```

Both readers take `.min.y` off the position attribute, which is blind to the
index, so the measured box is unchanged to the bit; and all three places that
raycast a bridge already exclude this object **by name** (`invariants.ts` twice,
`parkFacts.ts`, `measure-bridge-parapet.mts`). Its baseline entry went with it.

### 3. `shell|wallTop` (NEW, 0.052 m², seed 326) — IN PROGRESS

**Located exactly.** `bridge-0.0` on seed 326, at (59.25, −1.14, −10.36). The two
quads share two corners; at one ring they are the *same point*, at the other they
are **7.6 mm apart in y** (5.3e-3 m perpendicular — that is the reported
separation). The `shell` face is a **course reveal**; the `wallTop` face is the
cap quad.

The reveal is drawn because `revealAtTop` misses it: with no coping stone laid
(`min(parapet over the two rings) = 0.078 m < COPING_HEIGHT = 0.28`), the sink is
`artefact = COURSE_HEIGHT / 100 = 7 mm`, and the sliver of course above this
reveal is **7.6 mm** — 0.6 mm the wrong side.

**The two populations the original calibration separated no longer separate.**
Instrumented the clause directly across all ten pool seeds — 16856 reveals
considered, 3372 with no coping laid. Their `max(course-above height)`:

```
[0, 1e-9)      2723      <- fully collapsed: a true clamping artefact
[0.004, 0.007)    1
[0.007, 0.01)     3      <- the seed-326 offender (7.6 mm) is one of these
[0.01, 0.02)      5
[0.02, 0.04)     13
[0.04, 0.06)     14
[0.06, 0.08)     13
[0.08, 0.1)      15
[0.1, 0.2)       72
[0.2, 0.4)      214
[0.4, 0.7)      206
[0.7, ...)       93
```

There is **no gap** between "artefact" and "real course" any more — it is a
continuum from 0 upward. The old comment's "strays sat 16–77 mm, a reveal
fighting the cap sits 1.5 mm" is stale, so **no depth threshold is principled**
and raising the 7 mm is tuning.

**Two fixes tried and rejected on measurement, so nobody spends the hour again:**

- **Make `revealAtTop` an OR over the two rings instead of an AND.** Rejected:
  it would newly delete **82** no-coping reveals whose *other* end is a real
  ledge up to **0.549 m** tall, opening exactly the see-through holes #489 was
  reported for. (Measured; list of all 82 max-heights is in the analysis.)
- **Raise the no-coping sink to `COURSE_RECESS` (60 mm).** Rejected: 35 extra
  deletions with slots up to 60 mm — the 16–77 mm defect again.

**The fix being implemented instead — no threshold sensitivity and no hole.**
The sliver exists because `courseLevels` is one ladder per bridge anchored at
`highestTop` (the bridge's tallest wall top anywhere), so at every other ring the
local wall top falls at an arbitrary point in the ladder and leaves a course of
arbitrary height between 0 and `COURSE_HEIGHT`. So: **snap the ladder, per ring,
to that ring's own wall top** — any course boundary within `COURSE_RECESS` below
`topY` is treated as being *at* `topY`. Then the sliver course collapses to zero
height (h = 0, so the existing `revealAtTop` rule deletes its reveal, unchanged)
and the course below it grows to reach the wall top, so **nothing is deleted and
no slot is opened**. The threshold is benign in both directions: too large and a
course reads up to 9% taller; too small and the seam returns. `COURSE_RECESS` is
the owner because it is the argument the `revealInGround` clause two lines down
already makes — a shelf shallower than its own depth is not reading as masonry.

Implementation point: snap the *level*, not the clamp, so course `c` and course
`c+1` both see the same boundary:
`const snapped = courseLevels.map((y) => (y < topY && topY - y < COURSE_RECESS ? topY : y))`
inside `buildCourses`, used for both `levelTop` and `levelBottom`.

### 4. `boundary-blocks|rail-fence` (WORSE 0.280 m² recorded 0.051, and MORE) — NOT STARTED

Measured positions, seed 326 and 128:

```
seed 326  area 0.2801  sep 2.05e-3  at (70.18, -1.82, -35.45)  n (0, 1, 0)
seed 128  area 0.0413  sep 3.38e-3  at (92.39, -3.53,  13.82)  n (0, 1, 0)
seed 326  area 0.0032  sep 4.09e-3  at (105.80, -4.46, -0.84)  n (0.256, 0, 0.967)
```

Seed 326 carries **two facings** (one horizontal, one vertical) on the same
instance pair — that is the `MORE`.

What they are: `Garden.ts`'s `boundary-blocks` is an `InstancedMesh` of
0.62 m-tall boxes in two courses, seated at `terrainHeight(x, z) + 0.62 *
(course + 0.5)`. `fence.ts`'s rail is an `InstancedMesh` of
`BoxGeometry(0.09, 0.1, 1)` at `terrainHeight(post) + 0.62`. Both hang off
`terrainHeight` at *different* points, so whether their faces land in one plane
is decided by the terrain between them — which the sphere changed. The two
objects physically interpenetrate where the railway leaves the park; that
overlap is the defect, the shared plane is the symptom. Likely fix: keep the
fence out of the boundary wall (or the wall out of the fence) rather than any
threshold. **Not yet investigated.**

## Instruments written for this (all throwaway, delete before the PR)

- `scripts/probe-sphere-seams.mts` — dumps the three offending seams with area,
  separation, world position and normal, per seed, one child process per seed.
  Output at `<scratchpad>/coplanar-sphere-seams.json`.
- `scripts/probe-walltop.mts` — dumps the actual `shell` / `wallTop` triangles
  within 1.2 m of a point and facing a given plane. `LGP_SEED=326` for the one
  above.
- `scripts/probe-reveals.mts` — with a temporary `LGP_REVEALS` push inside
  `bridges.ts`'s reveal clause, dumps every reveal considered across the pool as
  `[seed, depthPrev, depthRing, copingHere, revealAtTop, parapetPrev,
  parapetRing, hPrev, hRing]`. Per-seed files under `<scratchpad>/reveals/`.
  **Write to files, not stdout** — `process.exit(0)` truncates a child's stdout
  at 65536 bytes and the parent's `JSON.parse` then fails mid-array.

## Before pushing

`pnpm run check:coplanar` (read the exit code), then `pnpm run check`,
`pnpm run test:procgen`, `pnpm run build`, plus `check:swept-bus` and
`check:park-pool`. Never pipe through `head` or `tail`. `check` is ~16 minutes —
launch it with Bash `run_in_background: true`; do **not** use a Monitor and end
the turn. Then `git diff --stat origin/main...HEAD`, three dots, and account for
every file.
