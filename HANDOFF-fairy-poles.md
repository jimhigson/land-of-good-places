# Handoff — fairy-light poles (branch `fix/fairy-poles`, off `feat/procgen-on-sphere`)

Worktree `.claude/worktrees/fairy-poles`. PR against `feat/procgen-on-sphere`.
Do not merge.

## The bug, measured

The park drew **zero fairy lights**, on this branch and on its base.

Two numbers kept in step by hand had collided:

- the main loop runs at `RING_RADIUS` = fountain radius + 5.5 = **14.9**, and
  paves `3.6 / 2` either side, so its **inner kerb is at 13.1**;
- `FairyLights.ts` carried the literal `FAIRY_RING_RADIUS = 13.5`.

So every one of the ten poles stood **0.36–0.41 m inside the promenade's
paving**, tested as "on a path", and was skipped. Measured on seed 0 before
the fix (`scripts/_probe-fairy.mts`, untracked):

```
pole 0 (16.60, -4.45) distanceToPath -0.400 onPath(1.2)=true
pole 1 (14.02,  3.49) distanceToPath -0.398 onPath(1.2)=true
... all ten negative, all ten skipped
```

A radius sweep at the ten bearings showed the only window: poles clear of
paving 10/10 at radius 11.0 and 11.5, **0/10 from 12.0 to 17.5**.

## The fix — one owner

- `paths.ts` now owns `MAIN_LOOP_WIDTH` (was the literal `3.6` in the ring's
  route *plus* a restatement inside `RIBBON_HALF_WIDTH_CEILING`).
- `paths.ts` exports **`plazaVerge()`** — the lawn annulus between the plaza's
  paving (`PLAZA.radius`) and the main loop's inner paving
  (`RING_RADIUS - MAIN_LOOP_WIDTH / 2`), with its `middle`. A **function**, not
  a constant: `PLAZA` is a plan view and reading one at module scope forces the
  solver mid-evaluation (the branch handoff's import-order rule 1).
- `FairyLights.ts` deletes `FAIRY_RING_RADIUS` and asks `plazaVerge().middle`.
- The pole's paving clearance comes from the game now:
  `POLE_RADIUS + PLAYER_RADIUS * 2` = **1.52 m**, replacing a bare `1.2`.
  Stricter, so nothing previously refused is now let through.
- Drawn poles/strings are named `fairy-pole-<i>` / `fairy-string-<i>` so the
  invariant measures the **built scene**, not the decision list.

Seed 0 after: `poles drawn 10/10, strings drawn 10 | verge inner 9.40 outer
13.10 middle 11.25 | nearest paving at the ring 1.84 m`.

The collider is unchanged and was already there: `collision.addCircle(x, z,
POLE_RADIUS)` per drawn pole.

**Model: Opus 5 (1M context)**, the Engineer default; nobody chose otherwise
for this task.

## The invariant (commit 2 on the branch)

`everyScatteredFeaturePlacesSomething` in `test/procgen/invariants.ts`, first
in the `INVARIANTS` list. It covers the **class**, not just the fairy poles:
the five world-phase features that scatter individually-`optional` things and
so can be forgone down to nothing — walls, trees, bushes, lamps, fairy poles —
plus a sixth clause for **fairy strings**, because poles are not lights (a
cable needs two *adjacent* poles, so a ring of isolated posts draws nothing
while the pole count looks healthy).

Thresholds are deliberately the weakest honest ones, "at least one". A real
minimum count would be the suite measuring the generator's own target rather
than the park. What is refused is **silence**, not sparseness — the real
numbers go to the stderr coverage line on every run either way.

`ParkFacts.fairyLights` counts `fairy-pole-*` / `fairy-string-*` **meshes off
the drawn scene**, not the decision list that produced them.

### Proved red, and the geometry it was proved against

Mutation: `fairyRingRadius()` forced to `return 13.5` (the old literal).
Park geometry at the time: `PLAZA.radius 9.40`, `RING_RADIUS 14.9`,
`MAIN_LOOP_WIDTH 3.6`, so the verge is `9.40..13.10` and the loop's inner
paving starts at 13.10. Probe under the mutation:
`seed 0: poles drawn 0/10, strings drawn 0`.

```
  everyScatteredFeaturePlacesSomething seed 20260728: walls 39, trees 72,
    bushes 429, lamps 82, fairy poles 0, fairy strings 0 (out of 10 slots)
 x every scattered feature actually puts something in the park
AssertionError: seed 20260728: the park has 0 fairy poles. ...
AssertionError: seed 20260728: the park has 0 fairy strings. ...
 Test Files  1 failed (1)
      Tests  1 failed | 98 skipped (99)
```

Real numbers, no `NaN`/`Infinity`. Mutation reverted; same command green:

```
  everyScatteredFeaturePlacesSomething seed 20260728: walls 39, trees 72,
    bushes 429, lamps 81, fairy poles 10, fairy strings 10 (out of 10 slots)
      Tests  1 passed | 98 skipped (99)
```

Note the stderr line is visible **without** `--reporter=verbose` — confirmed by
running it, not assumed.

**Lamps 82 -> 81 on the canonical seed** is expected and is the only knock-on:
the ten poles now claim ground, and one lamp slot that used to fit no longer
does. Nothing else moved (walls 39, trees 72, bushes 429 unchanged).

`tsc --noEmit` and `typecheck:test` both exit 0.

## Pole counts per seed (AFTER), measured off the drawn scene

`scripts/_probe-fairy.mts` (untracked) counts `fairy-pole-*` / `fairy-string-*`
meshes in the built `world.fairyLights.group`.

| seed | poles drawn | strings | nearest paving at the ring |
|---|---|---|---|
| 0, 1, 2, 3, 4, 5, 6 | 10/10 | 10 | 1.84 m |
| 7 | 10/10 | 10 | 1.75 m |
| **8** | **9/10** | **8** | **-0.17 m** |
| 9, 10, 11 | 10/10 | 10 | 1.84 m |
| **12** | **8/10** | **7** | **1.15 m** |
| 13, 14, 15 | 10/10 | 10 | 1.84 m |

**147 poles across the sixteen seeds. BEFORE: 0 on every seed.**

The verge is **identical on every seed** — `9.40..13.10`, middle `11.25` —
because `PLAZA.radius` and `RING_RADIUS` both derive from the fountain's
manifest footprint, not from the seed. Only the spurs that cross the verge
vary.

BEFORE is 0 poles on every seed for that same reason: the old literal 13.5
sits 0.40 m inside a loop whose inner paving is at 13.10 on every seed.
Measured directly on the canonical seed by the red-run mutation below (0/10
poles, 0 strings at r=13.5); `scripts/_probe-fairy-before.mts` measures both
rings against one built park if a per-seed BEFORE column is ever wanted.

### The gateway gap still works — seeds 8 and 12 prove it

On most seeds every slot stands, so the ring is a complete circle of ten poles
and ten strings. **Seeds 8 and 12 are the exceptions and they are the useful
ones**: a spur crosses the verge (seed 8 at **-0.17 m**, i.e. actually on the
paving; seed 12 at 1.15 m, inside the 1.52 m gate), so a pole is skipped and
the strings either side of it are dropped. That is the designed "gateway"
behaviour firing on a real park, which also means the skip branch is live code
rather than dead code.

(An earlier revision of this handoff said the branch "never fires now". That
was wrong, and it was wrong because it was reasoned from the geometry instead
of measured. Seed 8 corrected it. Measure, do not derive.)

The new invariant passes on both: 9/8 and 8/7 are non-zero. It refuses
**silence**, not the gateway gap — which is the distinction it exists for.

## Browser QA done (browser was allocated by the Overseer, now released)

Built bundle served by `vite preview --port 5417 --strictPort` (PID noted and
**killed by PID** when finished; port confirmed free of my node process).
Canonical seed, plaza at **(-9.07, 7.38)**, ring radius 11.25.

Three frames, in the session scratchpad
(`/private/tmp/claude-501/-Users-jim-dev-landOfGoodPlaces/92acae52-e71b-43c9-a76b-92e2c76ea5d3/scratchpad/`):

| file | URL | what it shows |
|---|---|---|
| `fairy-lights-spawn-daytime.png` | `/spawn?pos=-9.07,-6.62&facing=0` | **the best one.** The character on the path with the pole ring and its bulb strings running past her at child scale — and clearly *beside* the paving, not on it |
| `fairy-dusk-ring.png` | `/view?camPos=-9.07,26,-28&camDir=0,-0.78,1&timeOfDay=21:00` | the fountain with the lit ring arcing round it at dusk |
| `fairy-dusk.png` | `/view?camPos=-9.07,11.5,-14.6&camDir=0,-0.52,1&timeOfDay=21:00` | closer on the strings: poles, finials, coloured bulbs lit |

Bulbs read pink / yellow / mint / blue on a dark cable, poles dark brown with
pink finials — visibly distinct from the pink lamp posts beside them.

**Console: no errors.** One pre-existing warning unrelated to this change
(`skyCruiser: the station platform is 4.5 m of track from the castle's level
run`).

Two discarded frames (`fairy-dusk-probe.png`, `fairy-lights-dusk-FINAL.png`)
are badly aimed cameras, not defects — ignore them. Camera aiming on the
sphere is not intuitive: `camDir` toward the plaza did not centre it, so the
frames were found by iterating, not by computing.

## check:park — 16 of 16 GREEN

| seed | waypoints | seed | waypoints |
|---|---|---|---|
| 0 | 254/254 | 8 | **278/278** |
| 1 | 228/228 | 9 | 235/235 |
| 2 | 233/233 | 10 | 216/216 |
| 3 | 237/237 | 11 | 308/308 |
| 4 | 237/237 | 12 | **275/275** |
| 5 | 242/242 | 13 | 246/246 |
| 6 | 230/230 | 14 | 214/214 |
| 7 | 253/253 | 15 | 263/263 |

One process per seed. **Seeds 8 and 12 are the load-bearing ones**: they are
the seeds where a spur crosses the verge and a pole is skipped, and both reach
every waypoint. A skipped pole costs nothing in reachability — the gateway gap
does not block anywhere a child has to stand, which is the thing `keepOutsFor`
and the claims registry exist to protect.

(The sweep ran 0–6, was paused at seed 7 to run the name-diff first on the
Overseer's advice, then resumed 7–15. Seed 7 came in green at 253/253 without
stalling, so the contention worry did not materialise.)

## The name-diff, and how it is being done honestly

A name-diff needs **both** sides, so there is a second worktree at the merge
base: `.claude/worktrees/fairy-poles-base`, detached at **ae20b9fc**, which
`git merge-base origin/feat/procgen-on-sphere HEAD` confirms is exactly my
merge base. `test:procgen` runs in each with
`--reporter=json --outputFile=...`, so the comparison is on **test names from
structured output**, never on a count and never on grepped text.

Remember to `git worktree remove .claude/worktrees/fairy-poles-base` when done.

### Result: clean, and the control held

| | total | passed | failed | skipped |
|---|---|---|---|---|
| mine | 696 | 641 | 55 | 0 |
| base `ae20b9fc` | 691 | 636 | 55 | 0 |

- **0 failing names added, 0 removed** — the failing sets are identical by name,
  compared as sets from JSON output.
- **Total delta +5**, exactly one new test per seed file. This was written down
  as a prediction *before* the base run finished, as a control: had the total
  come out anything other than 691, something besides my invariant would have
  changed the suite's shape and that would have needed chasing first.
- **0 skipped on both sides.** Worth checking separately — the silent-skip
  failure mode hides behind a healthy fail count and the tell is the *pass*
  count, not the fail count.
- My invariant was confirmed present in the **passed** list by name on all five
  seed files, rather than inferred from the absence of a failure. An invariant
  that never ran would also produce no failure.

### The coverage line on the five CI seeds

| seed | walls | trees | bushes | lamps | poles | strings |
|---|---|---|---|---|---|---|
| canonical 20260728 | 39 | 72 | 429 | 81 | 10 | 10 |
| 11 | 26 | 72 | 159 | 88 | 10 | 10 |
| 24 | 34 | 72 | 497 | 81 | 10 | 10 |
| 131 | 33 | 72 | 182 | 69 | **8** | **6** |
| 326 | 46 | 72 | 533 | 77 | 10 | 10 |

All five CI seeds have fairy lights; all five had none before.

**Seed 131 is the most informative gateway case so far**: 6 strings against 8
poles. One gap in a ring of 8 would leave 7 strings, so 6 means **two separate
gaps** — two non-adjacent poles skipped where spurs cross the verge.

## Determinism: why `scripts/park-digest.mts` is the right instrument

**A digest blind to `InstancedMesh` instance matrices would be structurally
incapable of seeing this change**, because the fairy bulbs *are* an instanced
mesh — the poles and cables are ordinary `Mesh`es, but every bulb is an
instance. `park-digest.mts` hashes `instanceMatrix` and `instanceColor` over
`count`, so it can see them.

That is not a hypothetical. The script's own comment records the bug being
caught **by its own control** on 6 Sep 2026: a whole-park digest read
byte-identical while `check:swept-bus` on the same park went 28 posts to 0,
because the digest was reading `matrixWorld` and geometry only. Choosing an
instrument that *can* see your change is the whole game — an instrument that
cannot is a check that cannot fail.

It also prints the layout, plan and world driver traces as separate hashes, so
a disagreement between two processes can be told apart: a different park
versus a different route to the same park.

Run: two separate processes per seed, on **seed 8** (exercises the skip branch,
so more of this change's decision-making is in its world trace than a plain
10/10 seed) and the **canonical** seed.

### Result: deterministic on both

| seed | meshes | park | layout trace | plan trace | world trace | two processes |
|---|---|---|---|---|---|---|
| 8 | 5540 | `f8401a3ac5fbfe25` | `a8aa5373dd2f20a0` (5 lines) | `49869f8feb01a3f6` (24) | `1c4959d525f5a48e` (**651**) | **identical** |
| canonical 20260728 | 5566 | `dded3a667ddf6e1d` | `a4e2cf23fc5b3676` (3) | `530be81588feb072` (15) | `c6438340824af51a` (**659**) | **identical** (all 386 lines byte-for-byte) |

The **world trace** matching matters more than the park hash: 651 and 659 lines
of every refusal, retry, accommodation and unwind in order, reproduced exactly.
That is the same *route* to the park, not merely the same park by luck.

### The instrument sees this change — confirmed, not assumed

The digest contains `fairy-pole-*`, `fairy-string-*` **and `fairy-bulbs`** (the
`InstancedMesh`). Counts read straight off it agree with the scene-graph
counts measured independently: canonical 20 entries (10 poles + 10 strings);
seed 8 seventeen.

**And seed 8's digest independently reproduces the gateway gap.** Its pole list
is 0, 1, 2, **4**, 5, 6, 7, 8, 9 — pole 3 absent — and its strings are 0, 1,
**4**, 5, 6, 7, 8, 9, with 2 and 3 absent. One skipped pole drops the string on
either side of it: 9 poles, 8 strings. A completely different instrument
arriving at the same answer as the mesh count.

## Still to do
- `LGP_SEED=n pnpm run check:park` on 0..15.
- `test:procgen` name-diff against the base (base has 55 known failures).
- Determinism, two processes on a changed seed.
- Screenshot of the lit park for Jim (needs the browser — ask the Overseer).

## This worktree's CLAUDE.md is newer than the shared checkout's

It adds rules worth knowing: **never `git stash`** (shared across worktrees);
`pnpm run check:coplanar` and `pnpm run check:swept-bus` are their own
workflows and must be run before pushing; `fnm use --install-if-missing` reads
`.node-version` and nothing does it for you.
