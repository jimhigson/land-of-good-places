# HANDOFF — closing the flat-primitive category

**Model: Opus 5 (1M context)**, chosen by the Overseer's brief. A replacement
must run the same model (CLAUDE.md, "A replacement runs the same model").

**Branch**: `eng/flat-primitives-check`, off `origin/feat/sphere-combined`
(base `90e62c5b`).
**Worktree**: `.claude/worktrees/eng-flat-types`.
**Role**: Engineer, reporting to the Overseer (`landofgoodplaces-fc`).

## The brief in one line

Everyone else on the sphere rebuild is fixing instances of the two mistakes.
This lane makes them impossible to write, so nobody has to find them again.

## Done and pushed

### 1. `Chart`'s flat form throws rather than lying (commit 1)

- `FlatChart.upAt` now asserts inside the validity radius. It was the only one
  of the three unguarded, and it is the worst: a position wrong by the
  departure is centimetres, an **up** wrong by the lean is the whole second
  mistake. Measured by a control test: a flat up read at 157 m is **40.9°** off.
- `flatChart()` refuses a chart whose departure exceeds **0.05 m**
  (= 4.69 m radius on R = 220) unless given `{ departure, because }`.
- That acceptance is checked against the real departure, so a signed-off number
  that has gone stale is a build failure with both numbers in the message.
- `test/geo/core.test.ts`: **28 → 32** tests, all passing. (An earlier commit
  message on this branch said 27 → 32; 27 was inferred from a failing run's
  total rather than read off the base. The base count is 28, measured.)

### 2. `check:flat-primitives` (commit 2) — armed and proved red

`scripts/check-flat-primitives.mts` + `scripts/flat-primitives-baseline.mts`.
TypeScript-AST scan over 597 files of `src/`, `scripts/`, `test/`. Five rules:
`HARD_UP`, `Y_DIFFERENCE`, `Y_OVER_GROUND`, `Y_THRESHOLD`, `FLAT_DISC`.
Two-way ratchet (new finding → red; fixed finding → BASELINE LOOSE → red).

**It caught its own bug before it landed, and that is the thing to keep.**
The first draft matched 57 of 93 flat discs because `-Math.PI / 2` parses as
`(-Math.PI) / 2` — the minus binds to `Math.PI`, not to the division — and it
was stripped at the outer level. Among the 36 invisible sites was
`tapMarker.ts`, the inventory's worst-felt defect. **Nothing would have gone
red.** Both halves of the control that caught it now run on every invocation:
`selfTest()` (every rule fired on its own fixture, plus four that must not
fire) and `textualControl()` (`text − excused == ast`, structurally, so it
survives people fixing sites).

Four deliberate breaks, all exit 1, on `90e62c5b` — re-runnable, and the
geometry is the branch's own source at that sha:

| break | result |
|---|---|
| `new Vector3(0,1,0)` + `zone.y - terrainHeight(...)` into `Highlights.ts` | 2 × NEW FLAT PRIMITIVE |
| delete `tapMarker.ts`'s `this.ring.rotation.x = -Math.PI / 2` | BASELINE LOOSE (baseline 1, now 0) |
| restore the sign bug in `isPiOverTwo` | ARMING FAILURE, FLAT_DISC |
| `if (false && ...)` on the `Y_OVER_GROUND` rule | ARMING FAILURE, Y_OVER_GROUND |

Cost **0.65 s**; inserted after `check:text`. Chain step **sets** compared
(not counted): 65 → 66, `DROPPED []`, `ADDED ["pnpm run check:flat-primitives"]`.
`check:chain-coverage` confirms reachability.

Baseline: 217 expressions / 241 findings — HARD_UP 55, Y_DIFFERENCE 58,
Y_OVER_GROUND 27, Y_THRESHOLD 8, FLAT_DISC 93. **Not adjudicated**, on purpose.

### 3. `Altitude` and `Up` (commit 4) — additive, nobody ambushed

`src/world/geo/Altitude.ts`, `src/world/geo/Up.ts`. **`tsc --noEmit` and
`typecheck:test` both exit 0 with no other file touched**, so the three
in-flight lanes compile exactly as before and adopt at their own pace.

The measured constraint that decided the design — probed with `tsc` **before**
designing anything, not after:

| expression | branded `number` | opaque |
|---|---|---|
| `alt < geo.cy` | **compiles** | TS2365 |
| `alt - geo.cy` | **compiles** | TS2362 |
| `needsAltitude(plainNumber)` | TS2345 | TS2345 |

A brand on a `number` is assignable *to* `number`, so every operator stays
open — it guards function boundaries only, which is the half that was never the
bug. So **`Altitude` is opaque** (six operations, no runtime representation).
**`Up` is only a brand**, because for an *object* type a brand already refuses
a plain `Vector3` while staying assignable to one — which is why it could be
wired into `Geo.up`/`Frame.up` with zero breakage.

`altitudeOf` delegates to the existing `altitude`, so there is no second
definition to drift.

Proved red (all `@ts-expect-error`, which TS fails as TS2578 when the expected
error does **not** occur — so these cannot rot):
- `Altitude` as a branded number → TS2578 on 4 lines, exit 2.
- `Up` as a plain `Vector3` alias → TS2578 on 2 lines, exit 2.

`check:flat-primitives` caught the two world-axis literals in the new test file
on its first run; they now carry `// flat-ok:` with a reason. The hatch worked
on its author first, which is the right first customer.

### 4. `check:npc-perch` was RED on the base, and both faults were my category

**Pre-existing**: `pnpm run check:npc-perch` exits 1 on `90e62c5b` with nothing
of mine applied (verified in a clean worktree at that sha). It is reached from
`check:crowd`, so the **whole `check` chain was red** on `feat/sphere-combined`.

- **Fault 1** — foliage matched to its seed by a flat 0.05 m plan distance.
  Measured: tree 0's nearest occluder is **1.965 m radially outward, 0.003 m
  tangentially**, at 32.6° of lean — i.e. `3.64 m of canopy height × sin(32.6°)`.
  The tree is correct; the measurement was flat. Fixed by decomposing against
  the seed's own bearing, tangential tolerance **unchanged** at 0.05 m.
- **Fault 2**, hidden behind fault 1 and only visible once it was fixed:
  `headY - lowest`, the body's length projected onto the world vertical. At
  tree 45 (179.2 m, lean 54.5°, cos 0.580) that reads **0.64 m** against a
  0.9 m requirement; along her own up it is **1.07 m**. She was never a
  floating head.
- The radial allowance is the only loosening, so a **uniqueness guard** fails
  the run if two seeds ever claim one canopy. Arm-tested: loosening the
  tolerances alone does *not* trip it (nearest-tangential matching stays
  correct), so it was armed with a direct mutation — recorded because a
  reproduction that quietly stops reproducing is how a check rots.

### 5. The check missed that bug, and that hole is now closed

`Y_DIFFERENCE` required a `.y` on both sides, so `headY - lowest` — two plain
identifiers — was invisible, **while it was red in CI**. A rule that cannot see
the defect sitting in its own repository is the exact fault this lane exists to
delete. There is now a fixed-point pass over names holding a `y`
(`const x = e.y`, `let y = x`, `x = Math.min(x, e.y)`).

Proof on `90e62c5b`'s own copy: before, 1 hit (line 192); after, 2 hits
including **line 236 `headY - lowest`**. It surfaced 9 more pre-existing sites
(Y_DIFFERENCE 59 → 66), one of them in the merge-blocking `invariants.ts`.
Baseline 217 → 226.

**Known residue, stated rather than discovered later**: the pass is local and
syntactic, so a `y` arriving as a **function parameter** is still invisible.

### 6. Nothing is sized against a park that can move

`PARK_SURFACE_SCALE` is **2.3355** and live, so the walkable boundary is
135.5 m (lean **38.0°**) and the furthest furniture 157 m (lean **45.5°**). My
failure messages quoted the 157 m column while calling it "the park edge".
`RULE_WHY` and the guidance block are now **computed** from
`GROUND_SPHERE_RADIUS` and `GARDEN_PLAY_RADIUS`, naming both radii. In
`check:npc-perch`, `TALLEST_CANOPY = 12` is gone: the bound is read off the
built park (**6.60 m measured**, so the match is tighter as well as
scale-tracking) and printed every run.

### 7. `check:speech-bubbles` — GREEN at the park's authored size

**Resolved. Nothing for Jim.** Measured with #620 (`eng/sphere-ground-claims`,
`PARK_SURFACE_SCALE` 1, `GARDEN_PLAY_RADIUS` 58 m, boundary lean 15.3°) merged
into this branch in a scratch worktree:

| | scale 2.3355 (this branch) | scale 1 (+ #620) |
|---|---|---|
| speaking-frames | 1234 | 5758 |
| within 40 m | 408 | 615 |
| on screen | **0** | **516** |
| sightings | 0 → **exit 1** | 516 → **exit 0** |

I had the cause exactly right and then attributed it to a park size that was
already fixed and merely unmerged. **A measurement is only as current as the
tree it was taken in** — that is the lesson, and it is why the earlier "real
loss of life in the park" line was wrong.

The rig fixes stay (correct at either size); their docblock now records the
135.5 m numbers as *what a park-size regression does to this check*.

### 7b. Two faults of my own, both the fault this lane exists to delete

- **I committed debug instrumentation** (`__loopDiag`, `__spk`, `__bubbleDiag`
  and four stderr dumps), by snapshotting the file while instrumented. Rebuilt
  from the clean parent; verified 0 occurrences and identical behaviour at both
  scales. There is now a grep over the whole diff for this.
- **`FURNITURE_REACH = 157` stayed hard-coded** inside the very commit that made
  the other figures derived — caught only by running at scale 1 and watching the
  boundary follow to 58 m while the furniture column sat still. **Deleted rather
  than corrected**: 157 m and 108.6 m are both *measured off a built park*, and
  this check never builds one (0.65 s static scan). A number that can only be
  measured does not belong in a static scanner's message.

Verified across the resize with nothing edited: 38.0° / 135 m / 1.27× becomes
15.3° / 58 m / 1.04×. `check:npc-perch` tracked too (canopy 6.60 → 6.39 m over
42 trees, exit 0).

### 7c. superseded — the original diagnosis, kept because the method was right

**Speech bubbles are not broken.** `check:speech-bubbles:wide` (same park, same
code, 1920×1080, 420 s) draws **601** and exits 0.

The portrait run failed because the rig circled the gate at a 7 m radius while
the crowd moved out with the park: 1442 speaking-frames, nearest speaking child
**51.4 m** from the camera focus (median 91.6 m) against a 40 m gate, **0**
within range. Fixed two rig faults — the walk now goes in from the gate to the
middle of the garden and back (within-40 m goes **0 → 408**), and she stands on
the ground instead of `y = 0` six metres above it.

**It is still red**, and the residue is not a rig bug: `onScreen` is **0 of
408**, the speaker's *feet* are off screen too, and a control proves the frustum
is fine (`isOnScreen` true on **7200 of 7200** frames for the camera's own focus
and the player). The children that get within 40 m are at the very edge of it,
and a 390×844 iso viewport shows far less ground than that.

So the remaining question is **player-visible tuning** — `BUBBLE_MAX_DISTANCE`,
crowd density near the player, or where NPCs wander. A child sees that change,
so it is Jim's call, not an engineer's. Reported, not acted on.

### 8. Two more rules

`AXIS_ALIGNED_BOX` (**177** sites) and `VERTICAL_RAY` (**4**). The four are the
right four: `invariants.ts:5437` and `:6415` — both in the merge-blocking suite,
and `:6415` decides whether the train drives through its own bridge — plus two
diagnostics. Baseline 226 → **320**, seven rules.

## Still to do — the decision the Overseer owns

Nothing here forces adoption. **Migrating a subsystem to `Altitude`/`Up` is
what breaks a lane**, and that is the call to make deliberately:

- **Decided: hold.** The Overseer has ruled that adoption waits until the three
  conversion lanes land, and will then hand it over as its own lane with those
  engineers still resumable. **Nothing has been pushed under them.**
- The baseline's 217 entries are the migration list. As sites are fixed the
  check prints BASELINE LOOSE and asks for the line to be deleted, so the
  table shrinks to zero as the category closes. That is the progress metric.

Two rules I would extend the check with next, both from the inventory and both
additive: `new Box3()` round possibly-leaning geometry (10 uses in `test/`,
every one axis-aligned), and a raycast fired along world `+Y`
(`invariants.ts:5400,6357` — the clause deciding whether the train drives
through its own bridge).

## The branch is broadly red, and none of it is mine

Measured against an untouched worktree at `90e62c5b`, not assumed:

| | base `90e62c5b` | this branch |
|---|---|---|
| `check:npc-perch` | **exit 1** | exit 0 (fixed here) |
| `check:speech-bubbles` | **exit 1**, "0 bubble(s) drawn in 120s" | **exit 1**, identical |
| `test:procgen` | **128 failed**, 501 passed (629) | **128 failed**, 513 passed (641) |

- **`check:speech-bubbles`** is the next chain step after `check:crowd`, so it
  was *masked* by `npc-perch` until that was fixed. Same shape as fault 2 inside
  `npc-perch`: fixing one red uncovers the next. It is failing honestly — it
  refuses to pass vacuously on a silent park — and the real question is why no
  child speaks. Not investigated here.
- **`test:procgen`**: the failure count is **identical**, and the +12 passing is
  fully accounted for (geo 28 → 40: 4 Chart tests + 8 type tests). Per-file
  counts on the seed suites are unchanged at 93 each, so **nothing was silently
  skipped** — that reconciliation is the check CLAUDE.md asks for, and it is
  what turned up the 27-vs-28 correction above.

The 128 are systemic sphere-rebuild invariant failures (trees interpenetrating,
paths off grid axes, Rail Race supports, the gate arch) across all five seeds.
They belong to the conversion lanes, not to this one.

## Rules I am working under

- Never the shared checkout; never `git stash` (shared across worktrees).
- Verify the chain by **parsing** `package.json`'s scripts object, never grep —
  names are prefixes of one another.
- Read exit codes directly; never pipe a check through `tail`/`head`.
- Push after every commit.
