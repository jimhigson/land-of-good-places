# HANDOFF — make `check:coplanar` green on `feat/sphere-combined` (PR #600)

**Stopped mid-task on 6 September 2026 for a token pause, not because the work
was finished.** Three of the four live findings are fixed and re-measured; the
fourth has a committed, typechecking, **unverified** proposal on it. Nothing has
been run since that last commit. No PR was opened.

**Model: Opus** (chosen by the Overseer; a replacement must also be Opus).
**Role:** Engineer. Reports to the Overseer (`landofgoodplaces-fc`), not to Jim.
Does not merge.

- **Branch:** `fix/coplanar-sphere`, cut from `origin/feat/sphere-combined` at
  `943d4da1`. **The PR goes against `feat/sphere-combined`, not `main`.**
- **Worktree:** `/Users/jim/dev/landOfGoodPlaces/.claude/worktrees/coplanar-sphere`
- **Scratchpad (all measurements live here):**
  `/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/coplanar-sphere/`
- **No dev server was started. No browser page was opened.** Nothing to clean up.
- **`feat/sphere-combined` moved while this ran** — two other engineers were on
  it (the arrival camera and the bus's road run) and have also stopped.
  **Rebase onto it before trusting anything here**, and stay out of `catBus.ts`,
  `roadRoute.ts`, `roadCorridor.ts` and the arrival camera files.

## The three rules this task is bound by. They are absolute, and they are what stops the cheap route.

1. **Never add a baseline entry to make a live finding pass.** An entry means
   "already wrong before the gate existed"; adding one for a live finding is
   silencing it.
2. **Fix the residue by deleting the hidden face** (ART_DIRECTION.md §7) — never
   by nudging a surface apart. A stand-off is a number somebody has to maintain
   and it goes stale the moment either surface moves.
3. **A `BASELINE LOOSE` entry is a finding too.** The ratchet is bidirectional
   on purpose: it fails when things get *better* without the baseline being
   re-taken, so nobody banks an improvement silently. Re-take it and say what
   improved and why — never leave the ratchet slack.

And: if a threshold genuinely has to be re-derived, **re-derive it from the
geometry and write both populations and their numbers down**, the way the
original calibration did. A number tuned to make today's park pass is what put
us here.

## The root cause of all of it, in one line

The sphere ground moved the terrain under geometry whose seam-avoidance
thresholds were measured against the old sine-hill park.

## Two corrections to `HANDOFF-no-hill-511.md`, which is one merge stale

Re-measured at branch head. **Do not work from that file's numbers.**

- **`path-surface|track-ballast` is NOT a live finding.** It does not appear at
  all in the run at `943d4da1`. The two-roads merge closed it. Nothing was done
  about it and nothing needs to be — see its section below for what that means
  for the ordering problem that file describes.
- **There are nine `BASELINE LOOSE` lines, not seven.**

**The pool on this branch is 10 seeds, not 16**: `20260728` (canonical), 11, 24,
128, 131, 208, 274, 326, 428, 451.

## Where each finding stands

### 1. Nine `BASELINE LOOSE` entries — **DONE**, commit `0265bed1`

Deleted by hand from `scripts/coplanar-baseline.mts`. Deliberately **not** by
`--print-baseline`, which would also have written today's *worse* numbers in for
the live findings — that is the silencing rule 1 forbids.

Six are things standing on the ground that used to graze it: the hotel tower's
shell and its door jamb against `terrain`, and the sky-cruiser, dodgems and
spooky-house stalls' base cylinders against it. The old sine hills undulated
under a flat footing so one boundary always found the ground's plane; the
sphere's gentler continuous curve does not. The other three: the water-fight
plot's own two rounded boxes, the rail race's duck bars against its upper
trestle branches, and `path-kerb|path-surface` (closed by the merged road work,
which put the drawn approach and its claimed reach behind one call).

### 2. `deck|shell` on railway bridges (`MORE`) — **DONE**, commit `69c7ae6d`

`deck` is an **invisible** box that exists only so `invariants.ts` has an object
named `deck` to take `Box3.setFromObject(...).min.y` off. But `check:coplanar`
never consults `.visible` — **and it must not**: the hotel's rooms and the
castle's floors are whole subtrees held hidden until you walk into them
(measured: **3827 invisible meshes in one built park**), so a visibility test in
the sweep would blind it to all of them. That was considered and rejected on
that number; do not revisit it.

So the marker's four upright sides went on being reported against the shell's
abutment faces they sit exactly in the plane of: **0.0173 m² on 13 of the 15
findings across the pool**, and on **seed 208's `bridge-0.0` at both ends at
once** — normals `(-0.707, 0, 0.707)` and `(0.707, 0, -0.707)`, 180° apart,
which is two facings and the `MORE`.

Fix: `deckGeometry.setIndex([])`. The marker keeps its eight corners and its
name and carries **no faces at all** — §7's own remedy, because nothing wanted
them. Control, run on the same yaw+translate the bridges use:

```
index=full     triangles=12  min=(15.115071, 4.035000, -10.831323)  raycastHits=2
index=emptied  triangles=0   min=(15.115071, 4.035000, -10.831323)  raycastHits=0
```

Both readers take `.min.y` off the position attribute, which is blind to the
index, so the measured box is unchanged to the bit; and all three places that
raycast a bridge already exclude this object **by name** (`invariants.ts` twice,
`parkFacts.ts`, `measure-bridge-parapet.mts`), so losing its two ray hits changes
no answer. Its baseline entry went with it.

### 3. `shell|wallTop` on railway bridges (`NEW`, 0.052 m², seed 326) — **DONE**, commit `050fc8a1`

**This is the one the brief flagged as hard, and the calibration it names is
dead. Read this before touching `bridges.ts`.**

Located exactly: `bridge-0.0` on seed 326, at (59.25, −1.14, −10.36). The two
quads share two corners; at one ring they are the *same point*, at the other they
are **7.6 mm apart in y** — 5.3e-3 m perpendicular, which is the reported
separation. The `shell` face is a **course reveal**; the `wallTop` face is the
**cap** quad. The reveal is drawn because `revealAtTop` misses it: with no coping
stone laid there (`min(parapet over the ring pair) = 0.078 m < COPING_HEIGHT =
0.28`) the sink is `artefact = COURSE_HEIGHT / 100 = 7 mm`, and the sliver of
course above the reveal is 7.6 mm — 0.6 mm the wrong side.

**The two populations the old calibration separated no longer have a gap between
them.** The comment in `bridges.ts` said *"the strays sat 16–77 mm below the wall
top, while a reveal actually fighting the cap sits 1.5 mm under it"* and put the
line at 7 mm. Instrumented directly across all ten pool seeds — **16856 reveals
considered, 3372 of them where no coping stone is laid** — the height of the
course above the reveal comes out as a *continuum*:

```
[0, 1e-9)      2723      <- collapsed clean onto the wall top: a true artefact
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

So **no line drawn through them is a measurement** — it is a number tuned to
today's park, and the next terrain change moves it again. Two candidate lines
were tried and rejected on the numbers:

- **Make `revealAtTop` an OR over the ring pair instead of an AND.** Would newly
  delete **82** no-coping reveals whose *other* end is a real ledge, **up to
  0.549 m tall** — reopening exactly the see-through holes #489 was reported for.
- **Raise the no-coping sink to `COURSE_RECESS` (60 mm).** Would delete **35**
  more, leaving open slots up to 60 mm — the same 16–77 mm defect.

**The fix taken instead removes the sliver rather than drawing a line through
it.** The coursing is one ladder per bridge struck from `highestTop`, the tallest
wall top anywhere on that bridge, so every *other* ring's wall top falls at an
arbitrary point between two rungs and the topmost course there is whatever is
left — anything from zero to a full `COURSE_HEIGHT`, decided by nothing.
`snapToWallTop` now snaps any rung within `COURSE_RECESS` below a ring's own wall
top **to** that wall top. The leftover course then collapses to nothing, so the
existing clause deletes its reveal by the rule it already had, and the course
*below* grows to reach the wall top, so **the wall stays closed and no slot is
opened**. Nothing is deleted that was not already being deleted.

That makes the number benign in both directions — too large and a course reads
up to 9% taller than its neighbours, too small and the seam returns — which is
exactly what a threshold on the deletion clause could not be. `COURSE_RECESS` is
the owner for the same reason the `revealInGround` clause below already uses it:
a shelf standing less than its own depth out of anything is not reading as
masonry.

Verified at the seam with `scripts/probe-walltop.mts` at `LGP_SEED=326`: the two
`shell` reveal triangles in that plane are **gone**; the four `wallTop` cap
triangles are untouched.

**Still to do on this one:** it has had no visual QA. A bridge's coursing is
something a child looks at, so somebody should stand at a ramp foot and see that
the top course reads right — `/spawn?pos=59,-10` on seed 326 is the exact spot.

### 4. `boundary-blocks|rail-fence` (`WORSE` 0.280 m² recorded 0.051, and `MORE`) — **PROPOSED, UNVERIFIED**, commit `621f5ae1`

**This is the only finding still live.** After commits 2 and 3, a full
`check:coplanar` run reported exactly these two lines and nothing else — no new
findings, no new `BASELINE LOOSE`. Exit 1. Output at `<scratchpad>/run2.txt`.

Measured positions:

```
seed 326  area 0.2801  sep 2.05e-3  at (70.18, -1.82, -35.45)  n (0, 1, 0)
seed 128  area 0.0413  sep 3.38e-3  at (92.39, -3.53,  13.82)  n (0, 1, 0)
seed 326  area 0.0032  sep 4.09e-3  at (105.80, -4.46, -0.84)  n (0.256, 0, 0.967)
```

Seed 326 carries **two facings** — one horizontal, one vertical — on the same
instance pair, and that is the `MORE`.

**Root cause, measured** (`scripts/probe-wall-fence.mts`, seed 326): **77
rail-fence posts and 129 rail-fence rails stand inside a boundary block**, worst
overlap 1.613 × 0.063 × 1.629 m at (93.81, −3.43, −20.95). The boundary outline
runs 57–110 m and the train's loop is solved without reference to it, so on some
seeds they cross. `Garden.ts` seats blocks at `terrainHeight(x, z) + 0.62 ×
(course + 0.5)`; `fence.ts` seats rails at `terrainHeight(post) + 0.62`. Both
hang off `terrainHeight` at *different* points, which is why the sphere took the
seam from 0.051 to 0.280 m² **without changing the interpenetration at all** — it
changed only whether the two heights happened to coincide. **The shared plane is
the symptom; a decorative wall built through a live railway is the defect.**

The committed proposal filters the wall's **drawn** block and pillar stations
with `Scenery.ts`'s `clearOfRailway` — its single owner of "is this the
railway" — at `DRAWN_BLOCK_GATE_MARGIN`, the wall's own reach from a station's
centre to the far corner of the stone laid on it. The wall gives way rather than
the fence, because the fence is the rule that keeps a child off the track
(`check:park`'s rail.exclusion) and must be continuous, while this wall is
scenery the player never reaches — she is held by the soft boundary at
`GARDEN_PLAY_RADIUS`, two metres inside the masonry. The **collision ring is
deliberately left whole**, so nothing drawn is made unsolid.

**What is unverified, and it is everything past `tsc --noEmit`:**

- `check:coplanar` has **not** been run against it. It is not known whether this
  closes the seam.
- `check:park` and `test:procgen` have not been run. No invariant requires the
  boundary wall to be continuous — `theGateIsAHoleInTheWall` is the only one that
  reads `boundary-blocks`, and it only forbids stone *in* the gate — but that was
  read, not run.
- **The size of the gap this opens in the drawn wall is not measured.** It may
  look wrong. This is a visible change and needs Jim's eyes, or a smaller answer.
- `clearOfRailway` reaches `isInBridgeFootprint`, whose lazy first call must
  happen after `buildPaths()`. It does — Garden's constructor runs `buildPaths()`
  two lines earlier — but **`bridgeKeepout.ts`'s header still says that first
  call happens in `Scenery`, and this moves it into `Garden`. That comment is now
  stale and was not corrected.** Fix it wherever you land.

An alternative not explored: move the *fence* or the *track* instead, per
CLAUDE.md's "procgen backtracks on collision, always" — the train's route is
solved with no knowledge of the boundary outline at all, which is arguably the
real gap. That is a bigger change and was not attempted.

### 5. `path-surface|track-ballast` — **NOT A FINDING ON THIS BRANCH**

`HANDOFF-no-hill-511.md` lists it as `WORSE` at 5.993 m² against 3.032. **It does
not appear in the run at branch head.** The two-roads merge closed it. Its
baseline entry (3.032 m²) is still present and still matched, so it is not
`BASELINE LOOSE` either — the seam is smaller than recorded, not gone.

**On the ordering problem that file describes** — that `buildPaths()` runs inside
`Garden` before the train exists, so it cannot keep clear of the ballast the way
the gateway path does: **that premise is wrong, and worth knowing even though the
finding went away.** `TRAIN_PLAN` is a **module-load constant** — the route is a
pure pre-scene plan (`train/plan.ts`) — so anything can ask where the track is at
any point in the build. `Entrance.ts`'s own `distanceToTrackCentre` says so in as
many words, and `bridgeKeepout.ts` and `Scenery.ts`'s `onRailway` both do exactly
this. So if this seam ever comes back, `buildPaths()` **can** ask
`BALLAST_HALF_WIDTH` and `TRAIN_PLAN.route` directly; no post-pass in the shape
of `drapePathsOverBridges` is needed. What is genuinely unavailable at that point
is the *built* collision world, not the plan.

## Instruments written for this — all throwaway, **delete before the PR**

Committed so a replacement can re-run them rather than rewrite them.

- `scripts/probe-sphere-seams.mts` — dumps the offending seams with area,
  separation, world position and normal, per seed, one child process per seed.
- `scripts/probe-walltop.mts` — dumps the actual `shell` / `wallTop` triangles
  within 1.2 m of a point and facing a given plane. `LGP_SEED=326`.
- `scripts/probe-reveals.mts` — needs a temporary `LGP_REVEALS` push inside
  `bridges.ts`'s reveal clause (removed again; re-add to re-run). Dumps every
  reveal across the pool as `[seed, depthPrev, depthRing, copingHere,
  revealAtTop, parapetPrev, parapetRing, hPrev, hRing]`.
- `scripts/probe-wall-fence.mts` and `scripts/probe-invisible.mts` are
  **untracked** in the worktree, not committed. The first counts wall/fence box
  intersections; the second lists every invisible mesh in a built park.

**One trap that cost time:** a child process that ends with `process.exit(0)`
has its stdout **truncated at 65536 bytes**, and the parent's `JSON.parse` then
fails mid-array with no hint that the cause is truncation. Write to a file per
seed instead.

## Before the PR

`pnpm run check:coplanar` (read the exit code), then `pnpm run check`,
`pnpm run test:procgen`, `pnpm run build`, plus `check:swept-bus` and
`check:park-pool`. Never pipe through `head` or `tail`. `check` is ~16 minutes —
launch it with Bash `run_in_background: true`; do **not** use a Monitor and end
the turn, which stalled several agents. Then `git diff --stat
origin/main...HEAD`, **three dots**, and account for every file. Delete the probe
scripts and this file's throwaway sections before opening the PR — against
`feat/sphere-combined`, not `main`.
