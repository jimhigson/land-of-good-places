# Handoff — the RIDE_SCALE / NOMINAL_OUTSET temporal dead zone

**Model: Opus 5 (1M context), the Engineer default; the Overseer did not
override it.** Branch `fix/ride-scale-tdz`, PR against
`feat/procgen-on-sphere` (base commit `ae20b9fc`), worktree
`.claude/worktrees/ride-scale-tdz`. Do not merge. Never the shared checkout;
never `git stash`; kill node by PID, filtered on working directory.

## The task

`feat/procgen-on-sphere`'s `check` chain stopped at step 24 of 67, so steps
25–67 had never been run on it. Two of the newly-visible failures were this
slice, and they are one bug:

```
check:cart-shape     ReferenceError: Cannot access 'RIDE_SCALE' before initialization
                       at src/world/railRace/hazards.ts:171
check:ground-claims  (same)
```

Both reproduce on `ae20b9fc`, so neither is anyone's current work.

## Root cause, and why the obvious fix is the wrong one

`hazards.ts` computed `DUCK_CLEARANCE` at module scope from `RIDE_SCALE`,
imported from `./route`; `route.ts` imports `parkLayout`, which comes back
round to `hazards.ts`. Inside an import cycle there is no "first" module —
evaluation order is a post-order walk from whichever side the entry point
reaches — so a module-scope const computed from a binding imported out of the
same cycle can be evaluated while that binding is still in its temporal dead
zone. It fails for one set of entry points and works for every other.

**Fixed structurally, not one const at a time.** The ride's dimensional
literals moved verbatim into `src/world/railRace/dimensions.ts`, which
**imports nothing**: `LANE_COUNT`, `PLAYER_LANE`, `NOMINAL_OUTSET`,
`CART_WIDTH_AT_PARK_SCALE`, `LANE_SPACING_AT_PARK_SCALE`, `RIDE_SCALE`,
`BASE_HEIGHT`. A leaf is always evaluated before anything importing it,
whatever the entry point and whatever order the import statements are in.

**Two things measured, both load-bearing, both easy to get wrong:**

1. **A re-export does not escape the cycle.** `export { RIDE_SCALE } from
   './dimensions'` in `route.ts` still leaves a *module-scope* reader in the
   dead zone — the indirect binding resolves through `route.ts`, whose own
   imports are walked first. Proved with a four-module experiment before
   relying on it. So a module-scope reader **must import `./dimensions`
   directly**. `route.ts` re-exports them anyway, which is why no other file
   changed: everyone else reads them inside function bodies, which do not run
   at import time.
2. **Import statement order does not matter** once the constant is in a leaf.
   Also proved, both orders and both entry sides.

Making each offending const lazy was the other option and is worse: it fixes
one const and pushes laziness onto its callers. `ENTRANCE_ROAD_OUTSET` is the
worked example — eager, reading an eager thing, reading the leaf.

`DUCK_CLEARANCE` was **deleted**, not made lazy. Nothing read it (only prose,
now repointed). It held `DUCK_CLEARANCE_AT_PARK_SCALE * RIDE_SCALE` while
`track.ts` derives every ring's clearance from that ring's own scale and says
so in as many words — a second definition of one thing whose only cost was
needing `RIDE_SCALE` at module scope.

## The instrument

`scripts/scan-cycle-tdz.mts` (committed, not wired into any chain — it is an
instrument, `--strict` makes it exit 1). Walks `src/`'s **value**-import graph
(a type-only edge is erased and cannot cycle), Tarjan for the
strongly-connected components, then lists every module-scope initialiser
reading a binding from its own component. Function/arrow/class initialisers
are skipped — those bodies do not run at import time.

Static on purpose: the crash only happens on the entry orders that reach the
cycle from the wrong side, so running a check and watching it pass proves
nothing about the others.

```
pnpm exec node --no-warnings --import ./scripts/ts-extension-resolver-register.mjs scripts/scan-cycle-tdz.mts
```

It predicted `supportGround.ts` before `check:cart-shape` got far enough to
hit it. **On the base it found 10 sites in a largest cycle of 30 modules; on
this branch, 7 in a largest cycle of 26:**

```
415 modules, 3 value-import cycle(s) (largest 26 modules).
7 module-scope initialiser(s) reading a binding from their own cycle:
  src/world/coaster/plan.ts:70              COASTER_PLANS           <- planPart                     [src/world/parkPlan.ts]
  src/world/paths.ts:1244                   RAIL_CLAMP_DISTANCE     <- RAIL_CORRIDOR_CLEARANCE_PLAN [src/world/train/plan.ts]
  src/world/paths.ts:4953                   RAIL_STATION_GAP_MARGIN <- STATION_GAP                  [src/world/train/fence.ts]
  src/world/train/bridgeFit.ts:120          SITE_RAMP_FLOOR         <- MIN_RAMP_RUN                 [src/world/train/bridgeFootprint.ts]
  src/world/train/bridgeFit.ts:123          SITE_RAMP_IDEAL         <- BRIDGE_RAMP_GRADIENT         [src/world/train/bridgeFootprint.ts]
  src/world/train/crossingPlanSolve.ts:268  corridorBlocked         <- railCorridorBlocked          [src/world/train/bridgeFit.ts]
  src/world/train/plan.ts:430               TRAIN_PLAN              <- planPart                     [src/world/parkPlan.ts]
```

Three went, for two fixes. `hazards.ts`’s `DUCK_CLEARANCE` and
`supportGround.ts`’s `SUPPORT_GROUND_BAND` are the two that were fixed;
`roadRoute.ts:172`’s `ENTRANCE_ROAD_OUTSET <- outsetClearOfSupports` fell off
for free, because `supportGround.ts` no longer imports `./route` and so is no
longer in the cycle at all. That is the shape of the fix working: moving a
literal to a leaf does not merely rescue its reader, it can cut the cycle.

The two `planPart` sites are the `lazyView` idiom and are believed safe —
`planPart` is reached before `parkPlan.ts`’s `let`s exist, which is exactly
why that module’s state is `var` (HANDOFF-backtracking rule 2). **The other
five are live risks of the same shape as the two fixed here**: each is one new
import edge away from crashing, and none crashes today only because of where
the current entry points happen to enter their cycle. They were left alone
because they are not in this slice; the fix for each is the same move to a
leaf.

## `check:ground-claims` had a second failure behind the crash

With the TDZ gone it runs to the end for the first time on this branch, and
probe 2 fouled honestly:

```
the registry on the built park holds features [layout, cruiser, train, slide,
crossings, pathGraph, road, fountain, walls, trees, bushes, lamps, railRace]
— the production placers, in commit order, are exactly [road, railRace]
```

That is the backtracking rework: every feature now claims ground through a
`FeatureBuilder` in one of two `ParkSolve` drivers. Widened deliberately, as
the probe's own message asks. It is now a **subsequence** test — no undeclared
placer, and declared ones in declared order — because a placer that
legitimately places nothing commits nothing (`fairyLights` builds 0 poles on
the canonical seed, pre-existing, true on the base). It therefore cannot see a
placer that has silently stopped claiming, so it **names those on every run**:
`13 of 14 declared placers committed ground…; this probe asserts NOTHING about
[fairyLights]`.

Both clauses proved red, against that registry: dropping `'lamps'` from the
roster → `feature(s) [lamps] that are not declared placers`; swapping
`'walls'`/`'trees'` → `committed out of the declared build order: [trees]`.

## State

- `check:cart-shape` green, exit 0, real numbers (hopper ±0.5500 vs
  `CART_WIDTH_AT_PARK_SCALE`/2 0.5500; wheel radius 0.3840; no NaN/Infinity).
- `check:ground-claims` green, exit 0, real numbers (143/143 corridor runs,
  worst drawn vertex 4.08e-6 m outside its claim against 0.001 slack).
- `tsc --noEmit` exit 0.
- `package.json` **not touched**: 126 scripts before and after, added `[]`,
  removed `[]`, parsed not grepped. `check` chain is 67 steps.
- Full `check` chain, `test:procgen` name-diff, seed sweep: see below /
  in progress.

## Not done

- The five remaining at-risk constants above (the seven listed, less the two
  `planPart` lazyView sites).
- `scan-cycle-tdz.mts` is not wired into any chain. It probably should be
  (`--strict`, after the two `planPart` sites are understood or allow-listed),
  but `checks.yml` is at ~25 min against a 30 min cap, so it belongs beside the
  chain rather than in it.

## The chain's step-24 blocker is `check:slide-rider`, and it is not the TDZ

Running the whole chain on this branch stops at **step 24 of 67**, which is the
number the brief carried — but the step that stops it is `check:slide-rider`,
not either of the two import crashes. Those are steps 48 (`check:cart-shape`)
and 64 (`check:ground-claims`), which the chain had never reached.

```
check:slide-rider FAILED
  - the child's body is 0.13% of the frame on beat 1's trackside camera
    (ridden frame 240), against 0.40% required — 1 of 6 trackside samples are
    under it. The trackside camera is the one that has to show her whole self;
    if it cannot, nothing in this ride does
```

**Pre-existing, proved by running it on the base commit** `ae20b9fc` in its own
detached worktree: exit 1, and byte-identical numbers — beat 1 trackside frame
240, head 1592 px, body 42 px, 0.13% of frame, 1 of 6 samples under 0.40%. The
other five trackside samples pass (2.58, 2.18, 1.22, 2.75, 1.53%). Nothing in
this branch touches the slide or its cameras.

It is a real red check and someone has to own it, but it is a visible framing
judgement about the ginormous slide's trackside camera — a different slice from
this one. **It blocks every step after 24**, so the remaining steps were run
individually to enumerate what else is behind it; results below.

## Behind step 24: what the rest of the chain actually does

Steps 25–67 run individually (the chain cannot reach them while step 24 is
red). Every failure is reproduced on the base commit `ae20b9fc` in its own
worktree before being called pre-existing.

### step 29 `check:waypoints` — FAIL, pre-existing, **and its own message is NaN**

```
245 waypoint(s) are somewhere no child could stand:
  (-34.76581804208908, 19.34785748357826) — inside the facade
    (x NaN..NaN, z NaN..NaN), which is solid scenery.
    The building's inside is not here — it is 600 m away.
```

Branch and base agree exactly: **245 waypoints, 245 `NaN..NaN` lines, exit 1
on both**. Not caused by anything here.

**Worth more than its pre-existence, though: the bound it is failing against is
`NaN`.** `NaN..NaN` is not a facade anyone measured — every comparison against
it is false, so this check cannot be describing the thing it names, and the 245
is a count of something else. This is the *second* failure mode of
HANDOFF-backtracking's import-order rule 1, the one this slice did not hit:
rule 1 says a module-scope plan read either lands in a temporal dead zone **or
bakes NaN** (`BUILDING_CENTRE_X` before the layout has been solved). This slice
was the dead-zone half; this looks like the NaN half, in the check rather than
in the game. Whoever takes it should find where the facade bounds are read and
when, rather than treating 245 as a real number of bad waypoints —
`scripts/scan-cycle-tdz.mts` and `_scan-nan.mts` are both pointed at this
class.

### step 66 `check:layout-rung` — FAIL, pre-existing

```
check:layout-rung: 5 failure(s):
  expected at least 30 forced refusals of the hotel, saw 0
  expected the pretend blocker to be redrawn on rung 2 once the hotel ran out
  expected the hotel to exhaust its candidates on rung 1 (11 redraws), saw 0
  expected decision zero to be reached after the hotel exhausted its supply
  expected exactly one solved line, saw 0
```

Identical on base `ae20b9fc` — same five clauses, exit 1. The check drives the
old layout machinery through `LGP_LAYOUT_REFUSE=hotel:40` and measures its
rungs; it reports `machinery (LGP_LAYOUT_REFUSE=hotel:40, seed 20260728): 0
refusal(s), 0 rung-1 redraw(s), 0 rung-2 redraw(s), 0 decision zero(s),
solved=0`. Nothing is being injected any more.

Its **first four clauses still pass and still measure real things** (a door 20 m
outside the boundary refuses `poi.nospot`; four walls ringing the hotel doormat
refuse `poi.stranded`), so this is not a dead check — it is a live check whose
machinery clause has been disconnected by the backtracking rework, which
replaced those rungs with `ParkSolve`'s ladder. Whoever owns the rework should
decide whether `LGP_LAYOUT_REFUSE` is re-pointed at the new driver or the clause
is rewritten against it; it must not simply be deleted, because those five
clauses are the only cover the layout's own backtracking has.

### The complete sweep, steps 25–67

**64 of 67 steps pass. Three fail, all three reproduced on `ae20b9fc`, none
caused by this branch:**

| step | check | note |
|---|---|---|
| 24 | `check:slide-rider` | body 0.13% of frame vs 0.40% required — the blocker that stops the chain |
| 29 | `check:waypoints` | 245 waypoints, bound prints `x NaN..NaN` |
| 66 | `check:layout-rung` | 5 clauses, machinery injects nothing |

Both of this slice's own steps pass **in chain position**: step 49
`check:cart-shape` (13 s) and step 64 `check:ground-claims` (16 s). So does
step 48 `check:rail-race` (43 s), which is the step most exposed to moving the
ride's constants, and step 32 `check:park` (24 s).

Per-step results: `/tmp/rest-results.txt`; per-step logs `/tmp/step-NN.log`.

## `test:procgen` — identical failure set, by name

Both runs in their own worktrees, same command:

```
branch (fix/ride-scale-tdz)   Tests  55 failed | 636 passed (691)   exit 1
base   (ae20b9fc)             Tests  55 failed | 636 passed (691)   exit 1

diff of failing test NAMES: empty — none added, none fixed
```

The count matching is not the evidence — a count cannot see a swap. The names
were extracted from both logs and diffed, and the diff is empty.

**Control on that extraction**, because an empty diff is also what "extracted
nothing, twice" looks like: the extractor captured **55** names carrying a
`test/` path, against the **55** failures the reporter announced. They agree, so
the diff was over the real set. Sample: `test/procgen/seed-11.test.ts > seed 11
> every Rail Race duck bar stands over a real trestle leg`.

These 55 are the pre-existing instrument-fault reds `HANDOFF-backtracking.md`
already records at 55.

## `check:park` across a spread of seeds — all green

```
PASS seed 0    11s  254/254 waypoints
PASS seed 4   227s  237/237 waypoints
PASS seed 8    15s  278/278 waypoints
PASS seed 12   14s  275/275 waypoints
PASS seed 15   44s  263/263 waypoints
```

Every waypoint reachable on every seed tried; counts read off the screen, not
expected. Seed 4 is the slow one (227 s here against the 172 s
`HANDOFF-backtracking.md` records — another agent's `check:park` was competing
for the CPU in `review-677` at the time, so the difference is load, not the
park). Seed 7, which that handoff records at 1003 s, was deliberately not in
this spread.

## Final state of this branch

| verification | result |
|---|---|
| `check:cart-shape` | **green**, standalone and at chain step 49 |
| `check:ground-claims` | **green**, standalone and at chain step 64 |
| `tsc --noEmit` | exit 0 |
| chain steps 25–67 | 64 pass; 3 fail (24, 29, 66), **all three reproduced on `ae20b9fc`** |
| `test:procgen` | 55 failed / 636 passed — failing **names** identical to base, none added |
| `check:park` seeds 0, 4, 8, 12, 15 | all green, counts above |
| `package.json` | untouched; 126 scripts before and after, added `[]`, removed `[]`, parsed not grepped |
| `scan-cycle-tdz.mts` | 10 at-risk sites on base → 7 here; 4 controls, 2 of them negative |

## Rebased onto `86f9a513` — and `check:waypoints` is fixed

The base moved on two commits while this was in flight, and one of them is the
bug this handoff reported above:

```
86f9a513 check:waypoints solves the park before reading the facade's edges
         (was comparing every waypoint against NaN..NaN) (#674)
78d25b40 check:entrance-road: one queue of parks, and a line per park as it lands (#669)
```

So the `NaN..NaN` diagnosis was right and someone else has already landed the
fix. Re-run after rebasing, `check:waypoints` now **passes**, and prints a real
facade instead of a NaN one:

```
seed=20260728 waypoints=245 facade=(33.66,3.82)..(57.66,21.82) centre=(45.66,12.82)
```

Same 245 waypoints; they were never bad, the bound was. Rebase touched none of
this branch's files (the two commits are `scripts/check-waypoints.mts`,
`scripts/check-entrance-road.mts` and two handoffs), the three-dot diff is
byte-identical before and after, and all four re-run green on the new base:
`tsc --noEmit` 0, `check:cart-shape` 0, `check:ground-claims` 0,
`check:waypoints` 0.

**So the chain's outstanding failures are down to two**, both still
pre-existing: step 24 `check:slide-rider` and step 66 `check:layout-rung`.

## Follow-up: `RAIL_GAUGE`, and two real scanner blind spots

Raised by the coordinator: `track.ts`'s `RAIL_GAUGE` is a module-scope read of
`RIDE_SCALE` through `./route`'s re-export, which by this branch's own finding
does not escape a cycle — so why was it not in the 7?

**Because it genuinely is not in the cycle, and that is measured, not assumed:**

```
route.ts can reach track.ts : false
track.ts can reach route.ts : true
=> same cycle (mutually reachable): false
```

`track.ts` is strictly **downstream** of the cycle, so all of its imports —
including `route.ts` and everything in `route`'s component — are fully
evaluated before its body runs. No entry order can catch it. The scanner was
right to omit it, and it was never crashing.

**Changed anyway, as hardening**, because it is exactly one import away, and
`import { … } from './dimensions'` costs nothing. Control E proves the change
does something rather than being decoration: add `import './track'` to
`route.ts` (the one edge that would pull it in) and the shipped leaf version
stays at 8 sites, while the old `./route` version goes to 9, naming
`track.ts:94 RAIL_GAUGE <- RIDE_SCALE`.

### The coordinator was right that the scanner had a blind spot — two, and neither was `RAIL_GAUGE`

Both silently shrank the strongly-connected components, which is the failure
mode where a scan returns *fewer* findings and reads as a clean repo:

1. **`export { X } from './y'` was not an edge.** 84 of them across `src/`. A
   re-exporting module still has to be evaluated and its own imports walked
   first. Adding them took the cycle count **3 → 4** and surfaced
   `src/art/style/artPalette.ts:13 ART <- PALETTE [src/art/style/bridge.ts]`,
   which had never been listed.
2. **A bare `import './x'` was not an edge.** It binds no names, so it was
   skipped alongside the type-only imports — but it *forces evaluation*, which
   is the entire question here. Found because control E was written expecting a
   9, got an 8, and the gap turned out to be this bug rather than the mutation
   failing to bite.

**Sites are 7 → 8**, and the extra is a real one the blind spot was hiding, not
a regression. Controls A–D were re-run against the fixed scanner and still
hold (A 8, B 9 naming `hazards.ts`, C 8, D 8).

`src/art/style/artPalette.ts`'s `ART` is the new one and is **not fixed here** —
same class as the other five, one edge from live, and it is the art system's
central palette rather than this slice.

## `check:arrival-camera` — cleared by this fix

It was failing on base `86f9a513` with the identical crash:

```
file:///…/tdz-base2/src/world/railRace/hazards.ts:171
ReferenceError: Cannot access 'RIDE_SCALE' before initialization
```

and passes on this branch. **So this PR clears three checks, not two**:
`check:cart-shape`, `check:ground-claims` and `check:arrival-camera`. If
`check:arrival-camera` is on someone's list as an unowned red, it can come off.

## On the `check:ground-claims` coverage note

It is kept, and it is visible. It goes to `console.log` rather than
`process.stderr`, deliberately: CLAUDE.md's stderr rule exists because
**Vitest's** default reporter hides console output from *passing* tests. This
is a plain Node script whose stdout is shown on every run — confirmed by
reading the note off a **green** run — and all eight of the script's other
notes go the same way. Moving only this one to stderr would interleave it out
of order with the rest for no gain.

## `check:cycle-tdz` — the scanner is now in the chain

A scanner nobody runs is a scanner that rots, and this one had already proved
it could silently under-report. Chain position **5 of 68**, beside the other
static AST scan (`check:flat-primitives`). **1.86 s** — which matters, because
`checks.yml` is at ~25 min against a 30-min cap.

It ratchets against `scripts/cycle-tdz-baseline.mts` rather than failing on its
own 8 findings, the way `check:coplanar` does. Two deliberate differences from
that one:

- **Keyed on `file::name`, never on line number.** A line moves on every edit
  above it, and a baseline that churns on unrelated edits is one people
  regenerate wholesale rather than read — which is how #520 orphaned coplanar
  entries by renaming a mesh.
- **It ratchets both ways.** A new site fails, obviously; a site that has
  *gone* also fails, demanding its baseline entry be deleted in the same
  commit. That is what makes the number able only to go down. A baseline you
  may quietly leave stale is a baseline that grows.

Proved red in both directions against the 8-site baseline, then green:

```
new site (DUCK_CLEARANCE restored), exit 1:
  NEW module-scope read inside an import cycle:
  src/world/railRace/hazards.ts::DUCK_CLEARANCE at line 186 reads RIDE_SCALE
  from src/world/railRace/route.ts

stale entry (a ghost added to the baseline), exit 1:
  STALE baseline entry: src/world/nonexistent.ts::GHOST is no longer a
  module-scope read inside a cycle

unmutated, exit 0:
  check:cycle-tdz ok — the same 8 site(s) as the baseline, none added, none stale
```

**It states its own blind spot on every run, pass or fail**, to stderr: it says
nothing about a constant that is safe today only because its module sits
*outside* every cycle. That is a property of the import graph rather than of the
constant, and one new edge changes it silently — which is exactly `RAIL_GAUGE`.

Chain verified by **parsing the scripts object and comparing sets, not sizes**:
67 → 68 steps, 126 → 127 names, **dropped `[]` both times**, added exactly
`['pnpm run check:cycle-tdz']` and `['check:cycle-tdz']`.
`check:chain-coverage` accounts for it (86 defined, 80 reachable leaves, not in
the orphan list, which stays at the same 5). Chain steps 1–6 run in order, 0.

## The count going 7 → 8 is not a regression

Worth stating loudly because it reads as one. `artPalette.ts::ART` was always
there; the scanner could not see it while `export … from` was not an edge.
Fixing the instrument made it honest, not worse. Sites were 10 on the base
before any of this. The number is now gated and can only go down.
