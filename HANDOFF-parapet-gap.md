# HANDOFF — E7-parapet — the ginormous slide

Branch `feat/slide-parapet-gap`, based on `feat/slide-on-rail-generator` (E3's
#118 work, not yet merged). Worktree `.claude/worktrees/parapet-gap`, dev port
**5327** (not running — build-verified only).

**Status: green and stopped.** `npm run build` exit 0 (including `check:park`,
**unratcheted**). `npm run test:procgen` exit 0, **142 tests**. Tower clearance
1.54–1.97 m on all five seeds. **No PR raised. Do not merge.**

Handed over deliberately: the two things left are substantial and were not
worth attempting on a nearly-spent budget.

**Also still queued:** the transparent-chute work Jim asked for (make ~50/50 of
the chute glass so a rider can see the ground 14.8 m below). Deliberately not
started until boot time is fixed — details near the end of this file.

**Tools this branch adds**, all honouring `LGP_SEED`:

| command | what it answers |
|---|---|
| `npm run measure:slide-towers` | worst gap to any tower, and which one |
| `npm run measure:slide-fingerprint` | SHA256 of route + chute, door span, solve report |
| `npm run measure:slide-comfort` | tightest bend, lateral g, where on the ride |

---

# START HERE — the four things that must not be re-derived

## 1. #209 and #213 are the same problem. Do not solve it twice.

**The generator returns the first *satisfying* route, not the best one.**

I reached that from the slide: `MIN_TURN_RADIUS` is 5 against a `wrap`
vocabulary offering 5–12 m, so the search takes a 5 m bend the instant one
fits, and no amount of offering it better doors changes that. It is filed as
**#209**.

**#213 states the same thing in its own doc comment, reached independently from
the coaster side** — 24 free solves of the Sky Cruiser, 20 crossed the castle
and 4 did not, and *the four were not rejected for anything, they simply closed
before they got there*. #213's answer was `RouteInfluence`: a weighted nudge
applied **at the decision point**, because a preference that is not worth
something where candidates are compared cannot be had by asking afterwards.

That is the mechanism #209 needs. Whoever picks up either one should read the
other first: **they are one problem with one fix**, and the fix already exists
in half-built form on `main`.

## 2. The `main` merge — analysis done, execution not started

`origin/main` is `ff17910` (#213). I merged `05f3a4b` (#203) fine. **#213
conflicts structurally in `src/world/rail/generate.ts`** and I aborted rather
than botch it — `git merge origin/main`, one conflicted file, three hunks.

The divergence:

| | this branch (E3, #118) | `origin/main` (#213) |
|---|---|---|
| brief type | `RouteBriefBase` → `ClosedRouteBrief \| OpenRouteBrief` union, `export type RouteBrief = …` | single `export interface RouteBrief`, `closed: boolean` |
| new fields | `endPoses` on the open half | `influences?: RouteInfluence[]`, `satisfies?: (route) => boolean` |
| scoring | `if (accumulated / brief.desiredLength <= BIAS_FROM) return jitter;` | `const pull = pullOf(seg, wanted); if (!brief.closed \|\| accumulated / brief.desiredLength <= BIAS_FROM) return jitter + pull;` |
| report | `const report: SolveReport = { startPoseCount: attempts.length, … }` | `const reportFor = (satisfied: boolean): SolveReport => ({ startPoseCount: brief.startPoses.length, … })` |

**Proposed resolution — keep the union, take main's behaviour:**

1. Keep `RouteBriefBase` / `ClosedRouteBrief` / `OpenRouteBrief` / the exported
   union. The slide needs `endPoses`, and the union is what makes `closed`
   discriminate.
2. Add main's `influences?` and `satisfies?` to **`RouteBriefBase`**, so both
   halves get them. Keep main's `RouteInfluence` interface verbatim — its doc
   comment is the best statement of item 1 above and should survive.
3. Take main's scoring line unchanged. Note it already handles `!brief.closed`,
   so open routes get the pull applied throughout rather than only after
   `BIAS_FROM`.
4. Take main's `reportFor` and the `satisfies` plumbing.

**The one real trap, and it is not visible in the diff.** Main's report says
`startPoseCount: brief.startPoses.length`. On this branch that is **wrong for
open routes**: E3 flattened the search into `attempts`, a list of every
(start × end) *pairing*, and `report.startPoseIndex` indexes **that flat list**.
So the door actually chosen is `floor(startPoseIndex / endPoses.length)` — the
divisor is the number of admissible landings, 34 on the seeds I measured, not 1.
If you take `brief.startPoses.length` wholesale, `startPoseIndex` and
`startPoseCount` start describing different lists and anything reading them
silently lies. `scripts/fingerprint-slide.mts` prints both; use it to check.
Keep `attempts.length` for the open case.

Also verify `pullOf(seg, wanted)` is safe when `brief.influences` is undefined
(the slide passes none) — it must contribute exactly zero, not `NaN`.

## 3. Boot time — still open, and the two hypotheses that are already dead

`SLIDE_PLAN` solves at module load, so this is **game boot**. Adding the towers
as obstacles took it from ~1.2 s to 9–35 s. A 35-second freeze before a
six-year-old can play is not shippable.

**Dead hypothesis 1 — moving the door.** The door at facade-local 9.5 does
overlap the south-east tower's footprint (span 7.4–11.6 against the tower's
10.011–14.439), and clearing it requires `DOOR_OFFER_CENTRE ≤ 6.776`. It does
not help. Pure solve times:

| seed | door 9.5 (overlaps tower) | door 6.7 (clear of it) |
|---|---|---|
| 20260728 | 8.8 s | **31.0 s** |
| 2 | 10.2 s | 19.7 s |
| 5 | **35.1 s** | 19.4 s |
| 11 | 28.2 s | 5.2 s |
| 18 | 12.8 s | 4.9 s |
| total | 95.1 s | 80.1 s |

Worst-seed boot — what a child waits — goes 35.1 → 31.0 s, and the **canonical
seed gets 3.5× worse**. Door 5.0 makes seed 2 unsolvable. Relocating reshuffles
*which* seeds are slow; it makes none of them fast. (This is the second time the
door has been measured and found not to be the lever; the first was for turn
radius, before towers were obstacles.)

**Dead hypothesis 2 — the cruiser clearance scan is the bottleneck.** Disabling
`clearsCruiser` takes seed 5 from 53.8 s to 1.6 s, which looks conclusive and is
**misleading**: it removes a *constraint*, not work, and the search then solves
almost immediately. **Do not repeat that A/B.** A spatial grid over the cruiser
segments is already in (byte-identical results, ~1.3×) and was not enough.

The real cause is that towers made the constraint set harder *everywhere*: seed
5 went from 944 candidate pieces to 2.34 M. The remaining candidate is item 1 —
better ordering / preferring good pieces at the decision point.

## 4. The tower clearance is closed-form on purpose. Do not unify it.

`distanceOutsideTower` in `building/layout.ts` compares distance-to-axis against
radius-at-height. A tower is a solid of revolution, so that is a **swept disc in
closed form: exact, with no gaps between probes.**

There are two ray-based tools on `main` and neither should replace it:
`coaster/castleWindows.ts`'s `sweptCartHits` (four rays) and
`coaster/clearance.ts` (eight rays, from #211 `6cdb272`). They exist because the
Sky Cruiser's window must be checked against **arbitrary meshes**, where there
is no formula and rays are the only option — and they pay for it with gaps
between rays that a thin obstacle can pass clean through. For a cylinder, rays
would be strictly *less* accurate. The comment in the code says so; leave it
there.

---

# HISTORY — how the branch got here

## The job in one line

The search *already chose* which door the slide leaves by
(`report.startPoseIndex`); the masonry ignored that answer and cut the hole at a
hand-written fixed spot. Commit 1 stops the code throwing away what it knows.

## Commit 1 — pure refactor, byte-identical, landed

`SLIDE_PLAN` now owns the doorway. `building/layout.ts` no longer states it.

- Deleted from `layout.ts`: `FACADE_SLIDE_DOOR_MIN_X/MAX_X`,
  `SLIDE_DOOR_MIN_X/MAX_X`, `GIANT_SLIDE_ENTRY_X/Z`.
- Added to `SLIDE_PLAN`: `facadeDoorMinX/MaxX` (**derived from the solved route**
  — `route.pointAt(0)` read back, not from re-deriving the pose),
  `roofDoorMinX/MaxX`, `entryX/entryZ`.
- Consumers now read `SLIDE_PLAN`: `Shell.ts` (both the facade gap and the roof
  parapet gap), `interactZones.ts`, `dressing.ts`, `Building.ts`, `ParkMap.ts`.
- The gap's **width** is now derived too:
  `SLIDE_DOOR_HALF_WIDTH = CORRIDOR_RADIUS + DOOR_SHOULDER` = 1.45 + 0.65 = 2.1,
  so widening the chute widens its hole. Previously the two agreed only by
  coincidence and nothing checked it.

### Import direction — the one real hazard, and the guard is real

Required: `building/layout.ts → slide/plan.ts → Shell.ts`. `layout.ts` must
**never** import `SLIDE_PLAN` — the plan needs `BUILDING_CENTRE_*` and `deckY`
from layout.

**Proved the guard exists** by adding the cycle deliberately:

- `npx tsc --noEmit` — **passes**. TypeScript does *not* catch it.
- `npx vite build` — **exit 0**. Rollup does *not* catch it either.
- `npm run check:park` — **exit 1**, `ReferenceError: Cannot access 'TOP_DECK'
  before initialization`.

So the cycle guard is the **node-executed check scripts** in `npm run build`,
which import the module graph eagerly — not the bundler and not the typechecker.
Anyone reordering `npm run build` should know that removing `check:park` from it
removes the only thing that catches an import cycle.

### Byte-identity proof, and watching it fail first

`scripts/fingerprint-slide.mts` (`npm run measure:slide-fingerprint`, honours
`LGP_SEED`). SHA256 over 4000 plan-view samples, a second hash over the built 3D
chute, plus segments, length, exit pose and the derived door span.

All five seeds (20260728, 2, 5, 11, 18): **route hash, chute hash, length,
segment count and exit pose all unchanged**, and the derived facade door came
out exactly `7.4000 … 11.6000` on every seed — the old hand-written constants,
reproduced rather than restated.

**The fingerprint was watched failing before it was trusted:**

| deliberate break | result |
|---|---|
| `DOOR_OFFER_CENTRE` 9.5 → 9.6 | both hashes change; door 7.5…11.7 |
| `DOOR_SHOULDER` 0.65 → 0.75 | door span changes, hashes **do not** (correct — the shoulder widens the hole, it does not move the chute) |
| restored | back to baseline exactly |

### Why it is byte-identical (the fact the whole refactor rests on)

`startPoseIndex` indexes the **flat (start × end) attempt list**, not
`startPoses` — `generate.ts` pairs every start with every end for an open route.
So `doorPoseIndex = floor(startPoseIndex / endPoses.length)`, with
`endPoses.length = 2890 / 85 = 34` on all five seeds.

Decoded, the chosen `acrossFraction` is **0 on every seed** — the search always
takes the gap centre and only the *heading* varies. That is why deriving the gap
from the solved pose reproduces 7.4…11.6 exactly. Verified directly by the
`facade door` line rather than by this arithmetic.

### The "one owner" question — a correction worth reading

The brief asked me to give the interior↔facade **scale relation** one owner,
citing "interior 17.5–22.5 maps to facade 7.4–11.6, a 0.84 scale".

**There is no such scale, and I did not invent one.** 0.84 is just 4.2 ÷ 5, the
ratio of two independently authored widths. It is not a designed relation:

- half-widths: facade 12, interior 30 → 0.4, not 0.84
- gap centres: facade 9.5, interior 20 → 0.475
- as a fraction of the wall: 0.792 vs 0.667 — they do not agree either

`Shell.ts` already calls the two "disconnected worlds", and the interior is a
much larger space than the visible castle. Enshrining 0.84 would have *created*
the bug class the task was trying to remove: a magic number that reads as
derived but is a coincidence.

What I did instead — each number owned by the thing that actually decides it:

- **facade gap** ← the solved route (where the chute really leaves) + the chute's
  own width. Removes two hand-kept numbers.
- **roof parapet gap** ← the boarding pad (`ROOF_ENTRY_X`) ± a walkable half
  width. This removes a **real** duplication: `GIANT_SLIDE_ENTRY_X` was 20 and
  the gap centre `(17.5+22.5)/2` was also 20, kept in step by hand and by
  nothing else.
- and an invariant that measures the built chute against the built masonry, so
  the two cannot drift however they are stated.

## The new invariant

`test/procgen/invariants.ts` →
`the ginormous slide leaves the castle through the hole cut for it`.

Three clauses, all against **built** facts (`facts.slideChute` in world space,
`facts.castleFootprint`): the hole lies wholly within the south wall; the
chute's mouth starts *inside* the masonry so it emerges from the hole; and where
the chute crosses the wall plane its full corridor width is inside the gap.
Clause 3 is the one that would have caught #118.

`facts.slideDoor` was added to `ParkFacts` and is imported **dynamically** —
`SLIDE_PLAN` is seed-dependent, so a static import into the test tree would have
pinned every seed's door to the default park (the trap the E3 handoff flags,
whose tell is the *pass* count looking wrong).

**Proved it can fail**, not just that it passes: shoving the cut hole 3 m along
the wall gives **exactly 5 failures, one per seed**, 122 still passing, messages
carrying real numbers, **zero NaN/Infinity** in the output.

## Baseline measurements — the "before" for commit 2

| seed | tightest radius | peak lateral g | where | altitude |
|---|---|---|---|---|
| 20260728 | 6.17 m | 0.698 g | 2.2% in, 0.31 s | 14.84 m |
| 2 | 6.08 m | 0.708 g | 94.7% in | 1.25 m |
| 5 | **5.46 m** | **0.789 g** | 56.6% in | 8.68 m |
| 11 | 5.91 m | 0.728 g | 2.2% in, 0.31 s | 14.84 m |
| 18 | 6.50 m | 0.663 g | 1.7% in, 0.23 s | 14.84 m |

Note the brief's "5 m radius / 0.69 g / 1.6 s in" mixes two things:
`MIN_TURN_RADIUS = 5` is the configured floor; the canonical seed's *actual*
tightest is 6.17 m, and 0.698 g is measured from that. Worst seed is 5, at
0.789 g. Speed is 6.5 m/s and lateral load is v²/r, so radius only means
anything next to it.

**Early evidence commit 2 will work:** nudging the door centre by **10 cm**
(9.5 → 9.6) took the canonical seed's tightest bend from 6.17 m to **11.12 m**.
The route is extremely sensitive to door position, which is exactly the argument
for letting the search choose it.

## Commit 2 — measured, disproved, and dropped by ruling

**Do not build it.** The premise was false, and QA independently found the
comfort problem it was meant to solve does not exist.

### The premise, and what the measurement showed

The plan was: widen the offered door positions to the whole south wall, expect
the tightest bend to go from ~5 m back toward 8–11 m. I swept the door across
the full wall (facade-local x −10 … 9.9, 1 m steps) on all five seeds before
building anything.

**Door position does not buy turn radius.** The tightest bend is roughly flat
noise in the 5–7 m band wherever the door is put, with occasional lucky spots
that are not a trend:

| seed | radius at today's door (9.5) | best over whole wall | worst |
|---|---|---|---|
| 20260728 | 6.17 m | 10.45 m (at 9.9) | 5.01 m (at 4) |
| 2 | 6.08 m | 8.32 m (at −7) | 5.07 m (at 7) |
| 11 | 5.91 m | 6.58 m (at 1, 2, 4) | 5.03 m (at −9) |
| 18 | 6.50 m | 7.00 m (at −8) | 5.08 m (at −6) |

**Root cause: the search returns the first route that satisfies its
constraints, not the gentlest one.** With `MIN_TURN_RADIUS = 5` and a `wrap`
vocabulary offering 5–12 m, it takes a 5 m bend the moment one fits. The door is
not the dial; route *selection* is.

A second finding compounds it: `restartLimit = min(budgets.restarts,
attempts.length)` = 700, and an open route pairs every start with every end, so
with 34 admissible landings only **~20 of the 85 offered poses are ever
reached** — all of them at the centre position. Widening the door adds
candidates the search never gets to. **Ordering, not budget, is the lever.**

Getting a gentler ride would mean solving several doors and keeping the best by
min-radius — real work, and at ~1.2 s per solve a serious boot-time cost. That
is generator work, not slide work.

### QA's verdict, which settles it

QA rode it: the tightest bend is **not** a comfort problem.

> "Neither exciting nor sickening, and that's the problem… for the first ~2.5 s
> the trough walls fill almost the whole frame; you cannot tell you are 14.8 m
> up. It reads as sliding down an enclosed tube."

So the fault is the **enclosed opening view**, not lateral load. 0.79 g is not
hurting anyone. Spending boot time to halve a load nobody minds would have been
a bad trade even if the door had worked.

**Overseer ruling: drop commit 2 entirely. Do not widen the door, do not raise
the radius.** The follow-up (search speed / ordering) is filed as a separate
issue.

### Still out of scope

An **east**-wall door. Geometrically natural (the pit is east) but `Shell.ts`
cuts gaps only in the south wall at `TOP_DECK`, so it is new masonry code — and
on this evidence it would not buy turn radius either.

## Note on tooling overlap

`scripts/measure-slide-comfort.mts` (added on the base branch while I was
measuring) owns the comfort numbers. My `fingerprint-slide.mts` owns the
byte-identity fingerprint only — I stripped its duplicate comfort block rather
than ship two tools computing peak g two ways, which is the same one-owner
principle commit 1 is about. The two agreed closely where they overlapped
(canonical 6.20 vs 6.17 m; seed 5 5.48 vs 5.46 m), which is worth knowing: the
measurement is robust to how it is sampled.

## Towers: the bug Jim found by riding it, and its fix

**`npm run test:procgen` exit 0, 137 tests. `npm run build` exit 1 — see (A).**

### The fix

`slide/plan.ts` re-imposes the castle as rectangle **plus** towers; the
two-plot exemption is untouched. `CASTLE_TOWERS` lives in `layout.ts` because
`Shell.ts` imports the plan and could not own it without a cycle.

| seed | before | after |
|---|---|---|
| 20260728 | 1.52 m inside | **1.97 m clear** |
| 2 | 1.14 m inside | 1.54 m clear |
| 5 | 0.78 m inside | 1.97 m clear |
| 18 | 1.09 m inside | 1.79 m clear |
| 11 | 0.043 m clear | 1.79 m clear |

Worst margin 1.54 m. Seed 11's 43 mm of luck is gone.

Four further real bugs the invariants exposed, all fixed at source rather than
by moving a threshold: the hole was cut where the route *starts* rather than
where the chute *crosses* the wall (0.67 m out on angled exits); the door stub
stopped reaching the wall past ~38°; two legs overlapped by 0.11 m because
slots are spaced by arc length, not on the ground; and a 2.5 mm spline
overshoot at the lip, fixed by sampling at 0.9 m instead of 1.6 m.

### (A) CLOSED — the slide moved to park level

`npm run build` exit 0, `check:park` included and **not** ratcheted.

Four things moved together, because `Building.ts` keeps them in one frame on
purpose: the chute, the ride mount (+ eye mount), the grown-up, and the boarding
teleport. All read `SlideRide.pointAt`. Moving the chute alone would have left
the other three 26.65 m from the trough with the chute still looking perfect —
that number is measured, not guessed: it is what the new invariant reports when
the chute alone is put back under the castle's group.

Points are built in world space now; park level is the identity.
`SLIDE_GROUP_ORIGIN` is deleted rather than updated — it described the old
frame, and a constant describing the wrong frame is worse than none.

New invariant `a child boarding the ginormous slide is put down on the chute`
compares `pointAt` against `pointAt` pushed through the scene graph. Same number
at park level; a castle's width apart if the frames ever part. Proved red first:
5 failures, one per seed, real numbers, no NaN. **142 tests** (137 + 5).

*(Boot time and the `main` merge are covered at the top of this file.)*

### Queued behind it (Jim, second item)

Make ~50/50 of the chute transparent so the floor below is visible — this is
the fix for QA's "reads as an enclosed tube for the first 2.5 s, you cannot
tell you are 14.8 m up". Weight the glass toward the opening; alternate in runs
so it reads as designed, not noise. **Reuse the ferris wheel's existing glass
(`gondola.ts`) — do not invent a second glass material.** Watch `MeshToonMaterial`
+ `FrontSide` culling, and measure draw calls/frame cost before and after.

## Rebuilding my state in one command

```
cd /Users/jim/dev/landOfGoodPlaces/.claude/worktrees/parapet-gap
npm ci                                   # a worktree without its own node_modules
                                         # silently resolves into the shared checkout's
npm run build && npm run test:procgen
LGP_SEED=5 npm run measure:slide-fingerprint
npx vite --port 5327 --strictPort        # only if a live build is needed; kill by PID
```
