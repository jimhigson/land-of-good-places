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

### The control on the instrument — run *before* trusting the green

The determinism runs above only prove two processes agree. They would agree
just as happily if the digest could not see this change at all. So the same
digest was run on the **base worktree** for seed 8 and compared:

| | meshes | park hash | `fairy-(pole\|string)` meshes |
|---|---|---|---|
| base `ae20b9fc` | 5512 | `8d08e91238c68924` | **0** |
| mine | 5540 | `f8401a3ac5fbfe25` | **17** |

**They differ, so the instrument can see the change.** And this is the
strongest evidence for the bug itself: the base park contains **zero** fairy
meshes, confirmed by a third independent instrument rather than inferred from
the mutation.

One subtlety found here and worth keeping: **`fairy-bulbs` exists on the base
too**, because `FairyLights` always constructs the `InstancedMesh` — with
`bulbPositions.length` of zero. A rig with no bulbs was therefore structurally
indistinguishable from a healthy one at the object level. Only the *instance
count* told the truth, which is exactly why a digest that ignored
`instanceMatrix` would have been blind.

**And seed 8's digest independently reproduces the gateway gap.** Its pole list
is 0, 1, 2, **4**, 5, 6, 7, 8, 9 — pole 3 absent — and its strings are 0, 1,
**4**, 5, 6, 7, 8, 9, with 2 and 3 absent. One skipped pole drops the string on
either side of it: 9 poles, 8 strings. A completely different instrument
arriving at the same answer as the mesh count.

## The knock-on is bigger than first reported — measured, seed 8

The canonical seed loses **one** lamp (82 -> 81). Seed 8 loses **three**, and
gains a wall. Measured from the world-phase summary line in both worktrees:

| | walls | lamps | poles | trees | bushes | forgone |
|---|---|---|---|---|---|---|
| base `ae20b9fc` | 34/39 | **90**/131 | 0 | 72 | 404 | 0 |
| mine | 35/39 | **87**/131 | 9 | 72 | 404 | 2 |

So "lamps 82 -> 81" is **not** the whole story and must not be quoted as if it
were: the effect is per-seed, it can reach -3, and it can move walls *up*.
The cause is the same and is correct — fairy poles are earlier in the world
phase order than lamps and walls, so they claim ground first and the later
features solve against a slightly different park. Trees and bushes are
untouched on this seed.

`forgone=2` on mine against `0` on base is the driver leaving two increments
out after retry and accommodation both failed. Note this is **not** the same
mechanism as the gateway gap: a pole standing on paving is pushed as `null`
directly by the builder and never reaches `forgo()`.

### Accounting for the mesh delta, 5512 -> 5540 (+28)

- **+26 fairy meshes**: 9 poles + 9 knobs + 8 cables. (`fairy-bulbs` is not
  new — the base already has it, with zero instances.)
- **+2 from the extra wall run** (34 -> 35).
- **Lamps contribute nothing to the mesh count** despite dropping 90 -> 87,
  because `lamp-bulbs` and `lamp-ground-glow` are `InstancedMesh`es — the
  change is in their instance counts, which is why their group hashes differ
  while the mesh total does not move.

**Honest limit on this one**: the "+2 per wall run" closes the arithmetic
exactly but is *inferred from it*, not independently measured. Everything else
in the table above was read off the world-phase summary in each worktree.

## Gate 4

### `check:swept-bus` — PASS

Exit 0, 215.3 s, **10 of 10** `PARK_SEED_POOL` seeds built and swept, both
controls held (feet-only vs drawn post differed on 0 of 10; bus lifted 200 m
read zero everywhere).

The script warns that a zero at `POST_STEP=0.2 m` is a **lower bound** and must
be re-run at 0.02 m *if the supports or the road have moved*. **They have not.**
The seed-8 digest comparison against base lists every group whose hash changed:
`(unnamed)`, `fairy-bulbs`, `lamp-bulbs`, `lamp-ground-glow`,
`living-flower-{heads,petals,stems}`, `wall-collars`, `wall-finials`,
`world-trace` — **no `railRace` group appears**, so the rail race's geometry is
byte-identical between base and this branch. The caveat does not bite.

### `check:coplanar` — RED, 19 NEW findings, none of them fairy

Exit 1. Classified:

- **12** rail-race `finish-rainbow-leg-*` pairs, **2** rail-race rails
- **5** others: `stone-walls`/`stone-walls`, `path-kerb`/`path-surface`,
  `fountain`/`path-surface`, `entrance-gateway-path`/`entrance-road-kerb`,
  two `entrance-door-*`/`terrain`, `ear-l`/`ear-r`

**Zero involve `fairy-pole-*`, `fairy-string-*`, `fairy-bulbs`, or any lamp,
wall or flower** — i.e. nothing this diff adds or moves.

**A trap worth recording**: `grep -c "^NEW:"` returned **0** because the lines
are indented two spaces. Nineteen findings nearly got reported as none. A scan
returning fewer findings than expected is a result to explain, never to accept
— CLAUDE.md says exactly this and it still very nearly worked.

**Name-matching is not evidence**, and the rail race *is* downstream of
`fairyLights` in the world-phase order, so it could in principle have moved. So
`check:coplanar` was run on the **base worktree** and the NEW sets compared.

### Control result: all 19 are pre-existing

| | exit | NEW findings |
|---|---|---|
| base `ae20b9fc` | 1 | **19** |
| this branch | 1 | **19** |

- NEW on mine and **not** on base: **none**.
- NEW on base and **not** on mine: **none**.
- The two sets are **identical**.

So this branch neither causes nor fixes any coplanar finding. `check:coplanar`
is **red on the base**, and the rail-race seams are another engineer's known
work on this same base.

**This gate is red and is reported as red.** It is not claimed green anywhere,
and no baseline entry was added to silence it — `coplanar-baseline.mts` is
untouched by this branch, which the diff confirms (five files, none of them
that one).

## ROUND 2 — fairy lights along the paths (Jim, 18 Sep 2026)

*"the fairy lights look good but they should be all over the park as well, not
just in around the centre - put them around a large proportion of the paths
too."*

**Rebased onto `881cb158`** first (#670's boundary-distance fix, which is also
why Jim's preview was slow to load). Rebase verified rather than trusted:
identical diff shape before and after, merge-base moved to `881cb158`, and the
only deletions in `paths.ts` are the two lines I intentionally replaced. **Every
round-1 measurement in PR #677 was taken against `ae20b9fc` and is now stale.**

### What changed

- **Poles are planned as chains.** Chain 0 is the plaza ring (closed, exactly
  as approved); the rest are path runs (open, strung neighbour to neighbour).
  Slots stay sparse — `null` where a pole was left out — so no cable spans a
  gap. `FairyPole` is unchanged; the new type is `FairyChain`.
- **`planPoleSlots()` reads the drawn centreline** (`pathCentreline`), so each
  pole is offset by that sample's **own** `halfWidth` plus its clearance. No
  path width is restated anywhere in `FairyLights.ts`.
- **`LIT_PATH_FRACTION = 2/3`**, longest-run-first, so the lights read as
  avenues rather than scattered fragments. Two thirds because poles claim
  ground before lamps and walls.
- **`PATH_POLE_SPACING = 7.1 m`**, matched to the approved ring (10 poles on
  radius 11.25 is a 7.1 m span, which is what the cable's sag is tuned to).
- **`MIN_LIT_RUN_LENGTH`** — a run with room for one pole gets none, because a
  lone pole draws no cable.
- **`fairyLights` now accommodates.** It was `movable: false` in effect — a
  lamp refused by a pole went straight to `forgone`. A path pole can slide
  along its run or swap sides, so it now does. A ring pole still has exactly
  one candidate and correctly refuses, which is what preserves the gateway gap.
- **Real point lights stay rationed across the whole park**, not per chain —
  otherwise lighting the paths would have multiplied the park's point-light
  count by the number of runs.

### `MAIN_LOOP_WIDTH` — the fourth copy closed

Moved to `core/constants.ts`, a leaf both `paths.ts` and `parkLayout.ts` can
read (`paths.ts` imports `parkLayout.ts`, so ownership could live in neither).
`RING_PLOT_CLEARANCE` was the literal `3.35` with a comment asserting it was
`1.8 + 0.85 + 0.7`; it now derives the first two from `MAIN_LOOP_WIDTH` and
`PATH_KERB_OVERHANG`, leaving only the walking stride as a literal.

**Watch this one.** `RING_PLOT_CLEARANCE` is now `3.3499999999999996`, not
`3.35`, and it feeds a `<` in the layout solver — a plot sitting exactly on
that boundary could move. Deliberately **not** rounded to hide it; park
digests are the check.

### Measured so far (seed 0, canonical park)

`poles=96 strings=88 pointLights=3 lamps=77 runs=26 pathLen=1024m` — 2/3 of
1024 m at 7.1 m spacing is ~86 path poles plus the ring's 10, which is exactly
what was drawn.

**Reachability holds and the totals did not shrink**: seed 0 `254/254` and
seed 8 `278/278`, the *same totals* as round 1. A `check:park` that reads
`N/N` can still hide a loss if the denominator falls, so compare totals, not
just green.

**Lamp cost is smaller than feared**: seed 8 goes base 90 -> ring-only 87 ->
ring+paths **86**. Eighty-six extra poles cost **one** more lamp.

### A bug caught by disbelieving a number

The world-phase trace printed `poles=7` on seed 0 while the park had drawn 96:
the counter was `out.filter(Boolean).length`, and `out` is now **chains**. A
label saying one thing and reporting another — the same disease as the fairy
ring itself, in the instrument instead of the park. Fixed to print
placed/total poles and the chain count separately.

### Parsing GitHub Actions logs — the escapes are LITERAL `^[`, not ESC bytes

`gh run view --log-failed` does **not** emit real escape bytes. It emits the
two literal characters `^` and `[` followed by `[31m`. Three separate strip
attempts — `perl -pe 's/\e\[[0-9;]*m//g'`, the same with `\x1b`, and
`tr -d '\033'` — all exited 0 and removed **nothing**, because there were no
ESC bytes to remove.

Worse, the check meant to catch that could not fail: `grep -c $'\x1b'` in
**fish**, which does not support `$'...'` syntax, so it searched for a literal
string, found none, and read as confirmation. A vacuous check guarding a
vacuous strip.

The visible symptom was a **distinct-name count of 46** where the truth was
**17** — the per-line *durations* were still embedded in each string, so
`sort -u` was uniquing on `... 48ms` vs `... 49ms`.

**The form that works:**

```
sed -E 's/\^\[\[[0-9;]*m//g' raw.txt
```

And the unit matters: on CI run 35373640335 (sha `d5fa436e`) the suite showed
**57 failed instances / 17 distinct names**. Report which one you mean, every
time — the same confusion is how "57 distinct" got reported once already.

### Comparing failures: diff PER SEED, not only by name

A name-set diff cannot see a regression that adds a failure of an
*already-failing name* on a *different seed*. `every modelled coping stone sits
on the wall it caps` was already red on seeds 11 and 131 before this branch
existed (`bridge-14.0: 2 of its 81 coping blocks are not seated on their own
parapet, worst 0.031 m above where it should sit`), so the name appears on both
sides and a bare name diff reads "identical". Vitest reports one instance per
*(seed file, test name)*, so the comparison key must be
`ancestorTitles.concat(title)` — seed included — and then two extra instances
show up as two extra keys.

## The per-candidate ride query is free — measured on the phase itself

`check:park-boot` cannot answer this: every work unit it slices is a
**plan-phase** solver, and the world phase runs outside any budgeted slice
(#694). Timing a whole park build cannot answer it either — on seed 7 the plan
phase is minutes and averages any world-phase change to nothing.

So the world-solve summary now prints `ms=`, and the measurement is of the
phase itself, on **fast seeds** where it is the whole number rather than
rounding error:

| seed | base | branch |
|---|---|---|
| 6 | 719 inc / 423 ms | 808 inc / 361 ms |
| 14 | 709 inc / 292 ms | 788 inc / 306 ms |
| 7 (insensitive) | 469 inc / 231 s build | 571 inc / 244 s build |

**The honest claim is "no measurable cost", not "faster".** Seed 14 is the
clean result: **+14 ms for +79 increments**. Seed 6 came out 62 ms *faster*
while doing 89 more increments, which this diff cannot explain and is almost
certainly run-to-run variance on a shared machine — two runs is not a sample.

**Do not quote `ms per increment`.** It falls on both seeds mainly because ~80
**cheap** increments were added: placing a pole is not the same unit of work as
placing a wall run or a bush clump, so the average drops without anything being
faster. That figure measures a change in increment *mix*, not in speed. It is
exactly the shape of confounded derived metric this file keeps warning about,
and I wrote it down before catching it.

**Increments rise by roughly the pole count, innocently** — every placed pole
*is* an increment — and the query is invisible to that metric by construction,
since it runs inside one increment's candidate loop. `ms=` is the only number
that can see it.

What keeps it cheap: the loop's frames are memoised per route (`WeakMap`, keyed
by the route object so a new solve cannot read a stale entry) and a whole-loop
bounding-sphere reject answers most poles in one distance test. Without those
it would have been `drawnOnSphere` plus a full loop walk **per candidate**,
~112 slots x up to 10 candidates.

## Two more defects, both mine, both caught by gates I had already run once

**1. The cruiser went through the BULBS** (seed 326, after the pole fix):
`the Sky Cruiser's car passes through 'fairy-bulbs' at 152.0 m along the loop`.

The overhead test guarded the 4.4 m **post**. The rig also hangs cables between
poles, sagging 1.15 m, with bulbs 0.18 m under those — **air where there is no
pole at all**, so the car passed cleanly between two poles, cleared both, and
hit the lights strung between them.

I had written the three names of the rig's parts that morning —
`fairy-pole-*`, `fairy-string-*`, `fairy-bulbs` — to count them in an
invariant, and then wrote a clearance test covering one of the three.

**The fix is generic on purpose.** `fairyOccupiedPoints` returns the rig's
**drawn** world geometry for a pole and its spans; the drawing is built from
the same calls (`fairyAnchorAt`, `fairySpan`); `cruiserClearanceForPoints`
takes those points. **Sharing the constants would not have been enough** —
constants shared with geometry re-derived is still two definitions of one
thing, and the next person to tune the sag would have silently un-guarded the
ride. A part added to the rig is covered the day it is added, not when somebody
remembers this test exists.

**2. Nine new coplanar seams, all fairy.** `check:coplanar` 19 → 28 against
base: `fairy-pole-0`/`fairy-pole-10`, `fairy-pole-20`/`21`,
`fairy-pole-20`/`50`, the knobs against each other. A pole is an eight-sided
cylinder and a knob a sphere, both from one shared geometry, **all placed at
yaw 0** — so every post's facets pointed the same way, and two posts offset
along a direction parallel to a facet put that facet in the *same plane*. Ten
poles in one verge never showed it; a hundred across the park is arithmetic.

Fixed in **two** steps, and the first was not enough:

- **Each post takes its own seeded bearing.** This misaligns the cylinders'
  *side* facets and fixed **three** of the nine, including the knob-vs-knob
  pair (the knob takes `yaw + 0.7`, so a post and its knob do not turn as one
  rigid piece). Verified present before and absent after, not assumed.
- **The pole geometry is open-ended.** Yaw can do nothing about a cylinder's
  **end caps**: they are flat discs perpendicular to the axis, and rotating a
  disc about its own normal leaves it in the same plane. Two posts on similar
  ground kept coplanar caps whatever their bearing — the tell was in the pairs
  (`20/21`, `73/74`, `88/89` are *adjacent* poles 7.1 m apart, where ground
  height is most nearly equal) and I did not read it. Neither cap is ever seen:
  the top is inside the knob sphere (radius 0.22 against a 0.12 rise), the
  bottom is at ground level. ART_DIRECTION.md §7 says **delete the hidden
  face**, so they are deleted rather than nudged.

Result: `check:coplanar` NEW **19**, identical to base, **zero fairy seams**,
both set differences empty.

**The tally line for this one:** the first commit message asserted the fix
removed the shared plane *"at its cause"*, when it had removed two thirds of
one cause. The gate disagreeing with the commit message is the only reason I
knew.

## The extraction was NOT wired — review caught it, and my comments asserted it was

The worst error on this branch. `fairyAnchorAt` and `fairySpan` were extracted
as "the one owner", and then called **only from the test path**
(`fairyOccupiedPoints`). The constructor went on re-implementing both from its
own literals:

| | guarded | drawn |
|---|---|---|
| bulbs per string | `BULBS_PER_STRING` | `const bulbsPerString = 9` |
| sag | `CABLE_SAG` | `* 1.15` |
| bulb drop | `BULB_DROP` | `-0.18` |
| anchor drop | `ANCHOR_DROP` | `poleHeight - 0.25` |

**They agreed only because the numbers had been copied.** Three docstrings on
the diff asserted the opposite — "the drawing is built from the same calls, so
a part cannot be guarded in one place and drawn in another" — and I reported it
upward as done.

The reviewer proved it by **mutation rather than by reading**: `CABLE_SAG = 3.0`
moved the guarded cable 1.85 m while the drawing stayed at `1.15`. At committed
values the disagreement is `0.000e+0`.

Fixed by wiring the code to the promise. The proof, now on the **drawn**
geometry:

```
CABLE_SAG 1.15 -> lowest drawn cable vertex y = -15.3704
CABLE_SAG 3.0  -> lowest drawn cable vertex y = -17.0406   (moved 1.6702 m)
```

`tsc` then reported `bulbsPerString`, `scratchLean` and `up` as unused — **the
compiler confirming the drawing no longer re-derives anything**, which is a
better check than reading it.

**The lesson is not "wire it up".** It is that *extracting* a shared owner and
*consuming* it are two separate jobs, and doing the first while believing you
have done both produces code that looks exactly like the fix. The only way to
tell them apart is to move the shared value and watch the drawn thing move.

## The right owner exposed a gap the wrong one was papering over

The ride guard inflated a post's sampled axis by `POLE_RADIUS` (0.28) — the
**collider** radius. That is a tolerance masquerading as ownership: widen the
drawn post and the guard silently under-covers, with nothing to say so. So the
drawn radii got an owner and `WIDEST_DRAWN_RADIUS` (0.22) is derived from them.

**Switching to the correct owner made the cover worse**, because 0.28 had been
accidentally compensating for a *sampling* gap. A vertex on the cylinder wall
midway between two axis samples is `hypot(step / 2, bottomRadius)` from the
nearest:

| axis step | inflation | worst wall vertex | outside the guard by |
|---|---|---|---|
| 0.5 m | 0.28 (collider) | 0.302 | 0.022 m |
| 0.5 m | 0.22 (drawn) | 0.302 | **0.082 m** |
| **0.25 m** | **0.22 (drawn)** | **0.211** | **none** |

The honest form of the old promise was "covered to within 0.082 m". Rather than
quote a tolerance, `POST_AXIS_STEP` is **derived from the inequality that has to
hold** — `hypot(step / 2, bottomRadius) <= widestDrawnRadius` — with a
module-scope check that fails loudly if either number moves. **The promise is
true instead of true-to-within-X**, and there is no number for anyone to
maintain or to find stale later.

Two constants were also live duplicates: the knob rise `0.12` (guard and
drawing) and the drawn radii, which existed *only* in the drawing.
`POLE_RADIUS` had been doing three unrelated jobs — collider, guard inflation,
paving clearance — and now does two.

### What `fairyOccupiedPoints` covers, and what it does not

Covers: the post's axis, the knob, every cable and bulb to a standing
neighbour. A **second string** between the same poles is free, because it comes
from `fairySpan`.

**Does not cover:** a part bolted to the post — a pennant, a lantern on a
bracket — reaching further out than the knob. Nothing yet makes a *guard*
narrower than the drawing fail; only a *collider* narrower than the drawing
does. **That limit is written into the docstring** because this file has twice
carried a comment promising cover it did not give.

## Read the log's STRUCTURE before quoting any line from it

Three separate misreadings of a log in one session, all the same shape — **a
subsidiary listing read as the primary result** — and all three reported before
checking:

1. `38 -> 37` wall slots, quoted as proof of an upstream computation, theorising
   on what the figure counted rather than checking.
2. `worst advance 0.0 ms` from `check:park-boot`, quoted as the worst slice. The
   headline is `worst single advance() 16.7 ms ... parkPlan x3662`; the `0.0 ms`
   is a **looping-overrun** line near the bottom.
3. `check:npc-dispersal` / `check:npc-presence` grepped out of the `check` chain
   log and read as top-level steps far down the list — so the chain was reported
   as having passed `check:slide-rider`. **It had stopped there.** Those names
   are **sub-steps of `check:crowd`**, which is step **20** and is an aggregate:
   `trace-npc-driver && check:npc-perch && check:npc-separation &&
   check:npc-dispersal && check:npc-presence`. The chain was at step 20, not
   past 60.

   Worth noting how this one went wrong *twice*: having caught the misreading,
   I then explained it as coming from `check:chain-coverage`'s inventory — also
   without checking, also wrong. The conclusion (the chain stopped at
   `slide-rider`) was right and independently confirmed by the explicit
   `check:slide-rider FAILED` line and `exit=1`; the story about *why* was
   invented twice before being measured once.

The fix is not "be careful". It is: **before quoting any line, establish what
part of the log it belongs to.** A chain log opens with an inventory; a boot log
ends with subsidiary budgets; a summary line's fields mean what the emitting
code says they mean and not what the name suggests.

### A catalogue that logs only failures cannot tell you where it is

The per-step runner prints a line only when a step goes **red**, so `0 reds`
means either "nothing has failed" or "nothing has run" and there is no way to
tell them apart from its output. Twenty minutes in I read `0 reds` while
`check:slide-rider` — which fails standalone on both branches — was supposedly
long past, and had to test the runner's own exit-code logic before discovering
it was simply still *on* that step. The `check-park.mts` process visible at the
time was a **child** `slide-rider` had spawned to build a park, so
`pgrep -n node` was answering a different question than the one I asked it.

Whatever it was, `/tmp/step-out.log` held the answer: it is the current step's
output, so its contents name the step. **A long unattended run wants a progress
signal, not only a failure signal** — otherwise silence is unreadable.

### `check:slide-rider` is NOT park-sensitive — measured, both sides

```
BASE   exit=1  body 0.13% of frame vs 0.40% required, 1 of 6 samples under
BRANCH exit=1  identical text, identical numbers
```

Known #680 failure, unmoved by ~100 new poles. **`pnpm run check` stops at
step 24 of 67 on this base**, so the 43 steps after it are never reached by the
chain — they must be run individually, which is how the base's known-bad set
was catalogued in the first place.

## When two measurements disagree, re-read your own log first

Twice in one session I quoted a number, built a theory on what I assumed it
counted, and reported the theory:

- `38 -> 37` wall slots, taken as proof of an upstream computation. It was not.
- `worst advance 0.0 ms` from `check:park-boot`, taken as proof the
  attested-busy mechanism cannot measure headless — reported to the Overseer as
  worth filing. **It measures fine.** The headline in that log is
  `worst single advance() 16.7 ms ... that worst slice was parkPlan x3662`,
  against a 20.0 ms ceiling. The `0.0 ms` is a *subsidiary* line counting
  looping-overrun frames, near the bottom, which is where I was looking.

The second one was caught only because **another agent's run of the same check
on the same base produced real numbers**. Faced with their result contradicting
mine, the comfortable move — the one I made — was to reach for a story in which
both could be true ("it must behave differently in my environment"). The right
move is the cheap one: **re-read your own log before theorising about anyone
else's.** When two measurements of one thing disagree, one is wrong, and the
one you can check for free is yours.

`check:park-boot`'s real coverage limit, separately and genuinely: every sliced
work unit is a **plan-phase** solver (`brief`, `cruiser search`,
`cruiser finish`, `slide search`). The **world phase runs outside any budgeted
slice** — the log's own `162 ms of generation happened outside a budgeted
slice`. So that gate is blind to everything `worldPhase.ts` does, including
this file's per-candidate ride query. Filed as **#694**; not a fairy-lights fix.

## A build order here is a PRECEDENCE order, not a completion order

**This is the most useful thing learned in this work, and every wrong theory
about the bush loss rested on not knowing it.**

`ParkSolve` is a **round-robin**: `nextRunnable()` rotates a cursor and a
builder is gated **only by the `deps` it declares**. The list order in
`solveWorldPhase` sets *precedence* — who is asked to accommodate whom — it does
**not** mean one feature finishes before the next begins.

So `deps: ['fountain']` on `fairyPoleBuilder` meant poles began claiming ground
as soon as the fountain was done, **interleaved with the walls, the trees and
the bushes**. Honest when the feature was ten poles in the plaza verge; false
the moment it spanned the park, with nothing announcing the change.

The tell was that **nothing was refused**. Accommodations went *down*, not up;
unwinds were 0; the layout was proved unmoved three separate ways. An
under-declared builder does not displace anything — it simply **gets there
first**, which looks like no mechanism at all.

Bisected to be certain, same build, one env flag apart:

```
poles disabled: bushes=182 walls=33/38   <- byte-identical to base 881cb158
poles enabled:  bushes=177 walls=32/37
```

Fixed by declaring the real dependency,
`['fountain', 'walls', 'trees', 'bushes']` — where the driver can enforce it
rather than where somebody has to remember it.

### The same shape in three other builders — reported, not fixed

| builder | declared deps | gap |
|---|---|---|
| `fountain` | `[]` | none (first, single increment) |
| `walls` | `[]` | **no `fountain`** |
| `trees` | `['walls']` | **no `fountain`** |
| `bushes` | `['walls', 'trees']` | **no `fountain`** |
| `lamps` | `['walls','trees','bushes','fountain','fairyLights']` | fully declared |
| `fairyLights` | `['fountain','walls','trees','bushes']` | fully declared |

Walls, trees and bushes can race the fountain's basin claim. Low risk today —
the fountain is one increment and first in the list — but it is exactly the
latent shape this bug had. Not fixed here: changing another builder's deps
re-rolls parks on seeds nobody has looked at, and a fairy-lights PR is the
wrong place for it.

## Gate results on the final code (rebased onto `881cb158`)

| gate | result |
|---|---|
| `check:park` 0–15 | **16/16 GREEN**, every waypoint denominator unchanged |
| `test:procgen` name-diff | **55 vs 55, ADDED none, GONE none** (+5 total = the new invariant on five seed files) |
| determinism | **identical** — seed 8 `d6e22e7a32dbb69e`, canonical `a47b312c6846961c` |
| `check:coplanar` | **NEW 19, same as base, zero fairy seams**, both set differences empty |
| `check:swept-bus` | **pass**, both controls held |
| `check:park-boot` | **pass**, worst slice 16.7 ms against a 20.0 ms ceiling |
| world-phase cost | **no measurable cost** — seed 14: +14 ms for +79 increments |

**The digest is re-run LAST, after the final edit.** Its hashes moved three
times on this branch as geometry changed (yaw, then cap removal); any hash
quoted before the last edit describes a park that no longer exists. Two sets of
superseded hashes nearly reached the PR body.

### Round-2 gates — ALL must be re-run on the rebased base

## PR raised: #677 against `feat/procgen-on-sphere`

All four gates run and reported. Coplanar is red **and reported as red**, with
the base control proving the set is identical to the base's.

**Next, deliberately not done yet:** rebase onto `feat/procgen-on-sphere`, which
has moved (entrance-road and waypoints fixes merged; solve-time #670 in review).
Held off on the Overseer's instruction so the PR's numbers describe the base
they were actually measured against. **After rebasing, the measurements above
describe a different base** — re-run at minimum `check:park` on a couple of
seeds and `test:procgen`, and re-check the coplanar NEW set against the new
base, before anyone treats the numbers here as current.
