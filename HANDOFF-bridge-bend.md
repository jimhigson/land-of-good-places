# HANDOFF — the bridge bends to the curvature of the earth

- Branch: `eng/bridge-bend` off `feat/sphere-combined`
- Worktree: `.claude/worktrees/eng-bridge-bend`
- **Model: Opus 5 (1M context)**, chosen by the Overseer (Engineer default).
  A replacement runs the same model.
- Reports to: the Overseer session `landofgoodplaces-fc`.

## The brief

Jim, 14 September 2026: *"whatever 'down' is in the mesh of the bridge needs to
be adjusted so that down is variable along the length of the bridge, effectively
it needs to be bent to cover the curvature of the earth. Just like all meshes
that are not tiny. Trees and flowers are fine, but buildings externals and
bridges etc need to bend downwards so that they use local horizontal/vertical,
not a global one."*

## Result so far — the headline, measured

**Ramp grade, the live defect: 18 of 23 bridges over budget across the pool →
0 of 23.** Worst local grade 1.124 → 0.464 against `SPRINT_PEAK_GRADE_BUDGET`
0.512. Every pool seed was affected; every pool seed is now clear.

The Overseer's claim — *"a bridge that bends meets the ground at the same grade
at both ends, so the problem stops existing"* — is **verified, not assumed**.
The ramp-lengthening avenue stays closed and is not needed.

## Root cause, in one term

`surfaceProfile` read

```
ground + (crownY - ground) * (1 - drop)
```

which expands to `crownY·(1-drop) + ground·drop`. That second term drags the
**ground's own world-y slope** into the deck's height above the ground — and on
this planet that slope *is* the planet, up to 1.02 at the boundary. Differentiate
and the deck picks up `g'·(drop-1)`.

Stated in altitudes the term does not exist at all: the grade is
`crownAlt · drop'`, which is what the planner asked for and has nothing to do
with where on the dome the bridge stands.

## The measurement, and its controls

`scripts/diag-bridge-grade.mts`. **Run the controls; the run is void without
them.** It reports each bridge's grade twice — world-y (`Δy/Δplan`, what every
existing check in this repo measures) and local (the step's rise along the local
up at its start, over the part of the step in that point's own horizontal
plane).

Three controls, and all three are needed:

1. flat grass at r=140 must **disagree** — world large (the dome), local ~0;
2. flat grass at the park centre must **agree** — both small and within 0.05;
3. a synthetic ramp of declared grade must **read back** — a measure that only
   ever says "flat" is a check that cannot fail.

**Two of my own errors died on those controls. Both are written up in the file
and both are the kind that read clean:**

- **`altitude()` is NOT the local rise.** It is height *above the ground*, so a
  march along the ground has `Δaltitude = 0` at every step — over a hillside as
  much as over flat grass. My first version measured exactly that and printed a
  decisive `local 0.000` for the park's own slopes. Control 2 caught it.
- **Control 3 then read back a uniform 0.774** of the grade it asked for, on
  both 0.20 and 0.50. That is `cos(39.5°)` — the *control's* ramp declared its
  grade against plan distance while the orthographic `(x, z)` chart compresses
  radially by `cos θ`. The control was wrong and the measure it was doubting was
  right. **A constant-ratio miss reads like a broken instrument and is very
  often a broken expectation.**

## The design, and the line it draws

**What bends and what stays rigid is decided by a measured threshold, not by
taste.** `geo/Chart.ts` puts a flat patch's departure from this 220 m planet at
5 cm for a 4.69 m radius.

- **The crown span is rigid.** `ARCH_CLEAR_HALF` is 1.80 m — departure
  **7.4 mm**. It is a declarable flat chart. The arch, the slab and the
  clearance marker are one rigid object over a hole.
- **Rigid means flat in the LOCAL frame and tilted in world `y`.** They were
  flat in *world y*, which over their own 3.6 m span at the park's reach puts
  one haunch 3.9 m out of place. `tangentY(x, z, rise)` is the conversion, and
  it is deliberately **not** `worldYAtAltitude` — a rigid object must not follow
  the terrain under it, or it is not rigid.
- **The ramps bend.** At 14–18 m they are nowhere near qualifying for a flat
  chart. `worldYAtAltitude` is their conversion.

## New shared primitive

`src/world/geo/ground.ts` → **`worldYAtAltitude(x, z, metres)`**, exported from
`geo/index.ts`. The one owner of *"how high in this column is this altitude"*.

It is **not** `terrainHeight(x, z) + metres`: stepping up the world `y` axis by
`δ` at a point leaning `θ` gains only `δ·cos θ` of altitude. Asking for 4.60 m:

| plan point | `worldYAtAltitude` → altitude | `terrainHeight+4.60` → altitude |
|---|---|---|
| (0, 0) | 4.600 | 4.600 |
| (100, 0) | 4.600 | 4.112 |
| (139, −51) | 4.600 | 3.409 |
| (−99, 138) | 4.600 | **2.932** |

Exact to ~1 µm, and identical to the flat answer at the park's origin, so
converting a centre-of-park call site can never make it worse.

**That right-hand column is a live defect wherever it appears, and it is not
only bridges.** Anything built by adding metres to `terrainHeight` has up to
**36 % less real clearance than it asked for** at the park's reach. That is the
shape of the "train drives into its own bridges" report. `BRIDGE_RISE` is now an
altitude, so the train gets the air it was promised.

## What is done

- `surfaceProfile` states the hump in altitudes — the road bends. (commit 3)
- The crown solve measures a rise above the crossing's own tangent plane rather
  than a world `y`. In world `y` that loop was measuring the planet: over its
  3.6 m span the dome alone falls 3.9 m, twenty times the terrain wave the
  worst-case was ever about. (commit 3)
- The arch is built in the tangent frame; `archCurve` returns rises and each
  reader converts at its own plan point. `ArchPlacement` carries both halves of
  putting it back — the rise-to-world-`y` conversion **and** the rotation taking
  world `+Y` to the local up, because the voussoir ring and the imposts need
  their basis vectors leaned as well as their positions. (commit 4)
- The parapet hump measure (`parapetHeightFor`'s taper, and `PARAPET_MIN_HUMP`'s
  decision whether a collider wall stands at all) uses the altitude, not the
  world-`y` difference that over-reported it by up to 1.47×. A wall standing
  where the hump is really below a step severs the path junctions a ramp foot
  lands in. (commit 4)
- Wall bottoms bury 0.5 m along the local up rather than down the world `y`
  axis, which buried only 0.34 m at the park's reach. (commit 4)

## What is NOT done — read this before claiming the bridge is converted

- **The parapet/spandrel verticals still stand along world `y`.** A parapet is
  ~1.2 m, so its top is displaced ~0.92 m from where the local up would put it
  at 45° of lean; a spandrel wall runs ~5.5 m from deck to buried bottom and is
  sheared much further. This is the largest remaining piece of Jim's brief.
- **`courseLevels` steps the masonry coursing in world `y`**, so courses are
  horizontal in world space rather than parallel to the deck they belong to.
- **`deckMesh`'s rotation is still `setFromAxisAngle(Vector3(0,1,0), yaw)`** — a
  yaw about world `+Y` and nothing else, so it never leans. It is an invisible
  marker with no faces, read only via `Box3.setFromObject(...).min.y`, so this
  is a measurement question rather than a visible one — but the invariants read
  their clearance off it, so leaning it and leaning the arch must land together.
- **The whole-bridge lean question is deliberately NOT reopened.** The previous
  engineer measured that a per-vertex `placeOnSphere` moves the deck up to
  5.38 m and the parapet top up to 6.12 m off their own colliders, against a
  0.62 m `PLAYER_RADIUS`. Nothing here leans a plan footprint: every query,
  collider, `MovingPlatform` and `planEdge` keys off the same `(x, z)` it always
  did, which is why no desync is possible from these commits. **If you lean a
  footprint, you own inverting every `(x, z)` query with it** — and the honest
  framing of that is the orthographic-chart problem `geo/Chart.ts`'s curved
  chart exists to solve, which is the architect's work, not a bridge patch.

## Instruments

- `scripts/diag-bridge-grade.mts` — the grade, both ways, with its three
  controls. `LGP_SEED=<n>`; exit 1 if any bridge is over budget, exit 2 if a
  control failed (in which case every number it printed is void).
- `scripts/diag-bridge-solid.mts` (pre-existing, previous engineer's) — the
  solidity/reachability instrument. Re-run it before claiming the drawn stone
  is still solid; its own header records the 8.87 m false alarm it nearly
  shipped and why controls that pass on open grass cannot catch a probe that is
  blind to the object.

## Pool sweep — before and after, all controls green on every run

| seed | before | after |
|---|---|---|
| canonical | 3 of 5 over, worst 1.124 | **0 of 5, 0.464** |
| 11 | 1 of 2 over, 0.800 | **0 of 2, 0.464** |
| 24 | 2 of 2 over, 0.817 | **0 of 2, 0.405** |
| 128 | 1 of 2 over, 0.553 | **0 of 2, 0.356** |
| 131 | 1 of 1 over, 0.685 | **0 of 1, 0.398** |
| 208 | 1 of 1 over, 0.844 | **0 of 1, 0.364** |
| 274 | 1 of 1 over, 0.573 | **0 of 1, 0.338** |
| 326 | 5 of 5 over, 0.783 | **0 of 5, 0.489** |
| 428 | 1 of 1 over, 0.538 | **0 of 1, 0.345** |
| 451 | 2 of 3 over, 0.852 | **0 of 3, 0.364** |

Bridge counts are unchanged on every seed, so nothing was lost to get this.

**The world-y grade stays large after the fix** (1.475 at the outermost
canonical crossing, down from 2.179). That is correct and is the tell that the
bridge genuinely leans with the dome now; it is the grade her legs feel that
came into budget.

## `test:procgen` parity — diffed by name, not by count

Base `feat/sphere-combined` @ `90e62c5b`: **128 failed**.
After the profile commit alone: **146 failed** — 18 new, 0 gone, all four
clauses bridge-related and all four caused by the arch still being flat in world
`y` while the road had started to bend. Those are what commit 4 addresses; the
re-run is the current state of play (see below). **Diff the names — the count
alone cannot see a swap.**

The four clauses to watch, per seed:

- `every bridge is as wide as its own path, with the rail corridor open beneath`
- `no bridge parapet can be seen through — its outer face reaches the wall top`
- `nothing a bridge builds hangs into its own tunnel, measured by ray from the rail`
- `the park's own paving rides over every bridge, and none is left in a tunnel`

## `test:procgen` — the honest state, diffed by name

Base `feat/sphere-combined` @ `90e62c5b`: **128 failed**, 122.55 s.
This branch after the arch conversion: **139 failed**, 101.99 s.
**12 new, 1 gone.** Diff the names — the count alone cannot see a swap.

Gone: `seed 11 > every modelled coping stone sits on the wall it caps`.

New — four clauses, across five seeds:

| clause | seeds |
|---|---|
| `no bridge parapet can be seen through — its outer face reaches the wall top` | canonical, 11, 24, 131, 326 |
| `the park's own paving rides over every bridge, and none is left in a tunnel` | canonical, 11, 24, 131, 326 |
| `every bridge is as wide as its own path, with the rail corridor open beneath` | 326 |
| `nothing a bridge builds hangs into its own tunnel, measured by ray from the rail` | 326 |

The arch conversion took this from **18 new to 12** and cleared the tunnel
clauses on every seed but 326.

**These are mine and they are the work now.** Nothing here is "pre-existing" or
"unrelated" — the road bent and the drawn stone has not fully caught up.

### Three hypotheses tried, all measured, none of them it

Recorded so the next person does not spend the same hour. Each was plausible,
each was tested by changing it and re-running, and each left the numbers
essentially unmoved (canonical parapet counts 24/25/58/3/9 before, 24/27/58/3/10
after):

1. **`humpAbove` — the parapet taper reading an altitude instead of a world-`y`
   difference.** Reverted that one line alone; both clauses still failed. Not it.
   (The change is right on its own merits and was kept.)
2. **The course ladder stepping in world `y`.** Converted it to a ladder of
   rises in the tangent frame. Numbers unmoved. **Reverted** — an unproven
   change does not belong in the diff, however good the argument for it. The
   argument, for whoever wants it: masonry courses are laid *level*, and level
   on this planet is the local horizontal, so a world-`y` ladder under a leaning
   parapet cannot reach its top. It reduces to the present ladder exactly on
   flat ground. It is simply not what these clauses are complaining about.
3. **The cross-section taking one centre-derived height across its width.**
   Fixed, and **kept** — it is a real one-owner correction and it is verified
   neutral-or-better on solidity and grade. But it did not clear the clauses.

### What I could NOT settle, and why you should not trust my guess

My leading remaining hypothesis is that
`noBridgeParapetCanBeSeenThrough` **measures in a stale frame**: it drops down a
**world vertical** from the wall top (`y = top - drop`) and fires a ray with a
zero `y` component (`direction.set(ux, 0, uz)`) at a face that now leans by up
to 50°. Its own inner "is there masonry here" control is fired from 1.2 m in
over the roadway and has more room, so it can keep hitting while the outer ray
walks off the tilted face — which would produce exactly this report.

**I wrote an instrument to test that and it came back inconclusive, so the
hypothesis is unsupported and must not be acted on as if it were proven.** The
instrument fired the clause's own outer ray and a local-frame one at the same
samples. Result:

```
  bridge          tilt    both hit   world MISS/local HIT   world hit/local miss   both miss
  bridge-590.0    11.8°       5245                     48                    112        865
  bridge-92.0     32.9°       5190                     57                    462        321
  bridge-748.0    39.6°       5054                     23                    499        454
  bridge-288.0    47.1°       3898                    153                    495        284
  bridge-326.0    50.4°       4109                     18                    700        243
```

The column that would support the hypothesis (`world MISS / local HIT`) is 299
of ~28,000 and **does not grow with tilt** — 48, 57, 23, 153, 18. A frame error
must scale with the lean, and this does not.

**The instrument is the thing at fault, not the finding.** It aimed both rays
along the crude outward *radial* rather than along the wall's own normal, so
every column is contaminated — and the 243–865 samples where **both** rays miss
say plainly that its sample points are often not on a parapet at all. It was
deleted rather than committed: an instrument that cannot answer its question
should not be left lying about looking like one that can.

**Do this properly instead:** take the clause's own ring/normal data
(`ShellGeometry.planEdge` and `parapetLine`, which is what it already walks),
and vary *only* the frame — drop along the local up and project the existing
normal into that point's own horizontal plane. Then it is a one-variable
experiment. And whichever way it comes out, **the clause must still be proved
red against a real hole** before it is believed green: it was written for a
genuine 1.17 m see-through band (#489, Jim standing on one), and a frame change
that quietly stops it being able to see that is worse than the bug.

## Still to do

1. Settle the four red clauses — read the section above first.
2. `pnpm run check`, `check:coplanar`, `check:swept-bus`.
3. The parapet/spandrel verticals (see "What is NOT done").
4. Browser QA: a bridge at an outer crossing, seen from the side. `/spawn`
   coordinates that stand on one — canonical seed, outermost first:
   `/spawn?pos=138.9,-82.1`, `/spawn?pos=139.0,-50.8`, `/spawn?pos=-14.0,121.7`.
   The preview on 5412 is Jim's; do not take it.

## Instruments left behind

- `scripts/diag-bridge-grade.mts` — the grade, both ways, three controls.
  `LGP_SEED=<n>`; exit 1 if any bridge is over budget, **exit 2 if a control
  failed**, in which case every number it printed is void.
- `scripts/diag-bridge-solid.mts` (previous engineer's) — re-run after any
  geometry change. Currently 24/24 stopped and 125/125 carried at both the
  innermost and outermost bridge, controls passing: the bend did **not** desync
  the stone from its collider.

---

# Continued — the 10 regressions, settled (Opus 5, 1M context; Overseer-assigned)

## 1. `no bridge parapet can be seen through` — FIXED, and the frame hypothesis is DISPROVED

Not the frame. `PROBE_BOTTOM` was a bare `1.5` while
`PARAPET_HEIGHT + PARAPET_CROWN_LIFT` is **1.17** — the clause probed **0.33 m
below the bottom of the wall it was probing**, into the spandrel and deck edge
underneath. The old world-`y` bridge happened to put stone in that band; bending
it moved that stone.

`scripts/diag-parapet-frame.mts` varies **only the frame**, off the clause's own
ring data, as this handoff's predecessor designed:

| seed | world-frame misses | all below the 1.17 m wall? | misses at/above wall bottom | world MISS / local HIT |
|---|---|---|---|---|
| canonical | 17 | 17 of 17 | **0 of 10,718** | **0** |
| 11 | 13 | 13 of 13 | **0 of 3,680** | **0** |
| 24 | 15 | 15 of 15 | **0 of 4,692** | **0** |
| 131 | 9 | 9 of 9 | **0 of 2,346** | **0** |
| 326 | 29 | 29 of 29 | **0 of 10,856** | 1 |

Every miss sat at drop 1.38-1.48 m. The deleted instrument's 299-of-28,000
column was its own contamination — the real figure is zero, at every tilt.

**Proved red against a real hole before being believed green** (CLAUDE.md, and
this handoff's own warning): with the probe shortened, reintroducing #489's bug
— `buildCourses(surfaceOuterPlus/Minus, …)` instead of `parapetTopPlus/Minus`,
`bridges.ts:1417-1418`, canonical seed — gives **1349-1791 places per bridge on
all five bridges, worst run 1.15 m spanning 0.03-1.13 m below the top**. That is
the 1.17 m band #489 was written for. Mutation reverted.

Result: `test:procgen` **138 -> 133** failed, 629 total both ways.

## 2. `the park's own paving rides over every bridge` — NOT the check. A REAL geometry bug.

**Do not "fix" this in the invariant. The bridge is wrong.**

`scripts/diag-soffit-point.mts`, canonical seed:

| bridge | plan position | paving above its own road | **road vs the soffit over it** | along the bridge axis |
|---|---|---|---|---|
| 590.0 | (20.4, −20.3) | — | **passes** | — |
| 92.0 | (51.4, 95.8) | +0.030 m | **−0.651 m** | −0.50 m |
| 748.0 | (−14.0, 121.7) | +0.030 m | **−0.813 m** | −1.10 m |
| 288.0 | (139.0, −50.8) | +0.030 m | **−1.161 m** | −0.91 m |
| 326.0 | (138.9, −82.1) | +0.030 m | **−1.895 m** | −1.23 m |

Read that middle column: the **road surface is below the tunnel ceiling above
it**, by up to 1.90 m. The paving is innocent — it sits a constant 0.030 m on
its own road on every bridge, so `drapePathsOverBridges` is working perfectly.

And every offending vertex is **within ±1.80 m of the crossing centre along the
bridge axis** — i.e. **directly over the tunnel opening**, not out on a ramp. A
train drives into the underside of its own bridge road. The error is **zero near
the park centre and grows monotonically with radius**, which is the signature of
two height conversions disagreeing.

### The cause, and the fix this branch's own design already prescribes

Two owners for "how high is this", used on the same rigid object:

- the **road** (`surfaceProfile`) converts with `worldYAtAltitude`, which
  **follows the terrain column** — it bends;
- the **arch, slab and clearance marker** convert with `tangentY`, rigid in the
  crossing's own tangent plane.

They agree exactly at the crown centre and diverge away from it. But this
handoff's own "The design, and the line it draws" says the crown span is
**rigid**: *"`ARCH_CLEAR_HALF` is 1.80 m — departure 7.4 mm... The arch, the slab
and the clearance marker are one rigid object over a hole."* The road over that
same span was never converted to match, so the rigid arch and the bending road
pull apart exactly where they must not.

**Fix: over `|along| <= ARCH_CLEAR_HALF` the deck must be rigid too** — i.e.
`tangentY`, the same conversion the arch under it uses — blending to the bending
`worldYAtAltitude` form outside it. **The blend is the whole difficulty**: a step
at the boundary is a trip hazard and would show up immediately in the sprint
grade clause, so it must be C1, and it must be re-measured against
`scripts/diag-bridge-grade.mts` (all three controls) afterwards.

### An avenue measured and rejected — do not repeat it

**Leaning the `deck` marker does not work**, though this handoff lists it as
not-done. Leaned (`setFromUnitVectors(+Y, crownUp)` composed with the yaw, and
its height via `tangentY`), the paving clause cleared on 4 of 5 seeds — and
`the clearance over the railway covers the train and everyone riding it` went
red on **5** seeds, reporting 3.19-3.60 m against the 3.90 m required. Net
133 -> 134.

The reason is the instrument, not the marker: every clearance invariant reads it
via `Box3.setFromObject(...).min.y`, and **the axis-aligned bounding box of a
tilted plate is far taller than the plate** — measured AABB height 0.050 m
unleaned, which is exactly the slab thickness, against metres once leaned. So
leaning the marker cannot be done until the invariants stop asking an AABB for
a height. Reverted.

**This is the same disease as the cat bus's 9.43 m, in a different organ.**
There, a measurement was taken on a convenient origin — a trestle's *foot* —
rather than on the thing that actually gets drawn, and the check headlined a
confident, honest, wrong zero (`check:entrance-road`: *"0 legs hit on all
sixteen seeds"*, against 364 posts once measured along the drawn, leaning
trunk — 3.40x more). Here the convenient origin is an axis-aligned box around
an object that is no longer axis-aligned. In both cases the number is real,
cheap to compute, and describes something other than the question being asked;
in both cases the tell is that it only goes wrong once the thing being measured
**leans**. An AABB is a legitimate answer to "what volume does this occupy" and
never an answer to "how high is this surface", and the moment the bridge bends,
those two stop coinciding.

So the rule for whoever takes this on: **the invariants must ask for the soffit
height at a plan point, not for the minimum corner of a marker's bounding box.**
Until they do, the marker has to stay unleaned — and while it stays unleaned it
cannot be trusted over a bent bridge either, which is why #632 exists.

## Measurement traps hit here

- `mv scripts/diag-*.mts` swept up **9 pre-existing tracked** scripts. Caught by
  `git status`, restored with `git checkout --`. Remove scratch by exact name.
- A warp sweep wrapped in `timeout 240` reported **0 failures on every
  candidate** — the builds were being killed and `grep -c` read empty output as
  a pass. Re-run honestly, 2 of 5 still failed. Assert the run *completed*,
  never just that the bad string is absent.
- My first `diag-soffit-point` used the crossing centre where the clause uses
  the nearest point on the **rail centreline**, and found nothing at all while
  the clause failed. The disagreement is what exposed it. An instrument that
  disagrees with the clause it is explaining is wrong until proven otherwise.
