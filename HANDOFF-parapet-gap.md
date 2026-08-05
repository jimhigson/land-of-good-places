# HANDOFF — E7-parapet — the ginormous slide's parapet gap

Branch `feat/slide-parapet-gap`, based on `feat/slide-on-rail-generator` (E3's
#118 work, not yet merged). Worktree `.claude/worktrees/parapet-gap`, dev port
**5327** (not currently running — build-verified only).

**Status: commit 1 landed and green. Commit 2 DROPPED by Overseer ruling —
do not build it.**
`npm run build` exit 0. `npm run test:procgen` exit 0, **127 tests** (122 + 5,
one new invariant per seed).

**Do not raise a PR. Do not merge.** Commit 2 is explicitly a screenshot call
for Jim — it visibly relocates the hole in the castle's south face.

---

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

## CURRENT PRIORITY — the slide clips the castle towers (Jim, ridden)

**Status: invariant committed and deliberately RED. `npm run test:procgen`
exits 1. `npm run build` exits 0. The fix is not written yet.**

### Root cause (measured, confirmed — not the hypothesis I was handed)

`slide/plan.ts` exempts the castle and ball-pit plots from `clearOfPlots`
(their circles overlap, so a ride joining them could never solve) and
re-imposes the castle **as its footprint rectangle**. The towers stand at
`(±outerX, ±outerZ)` — outside that rectangle by half a wall — and bulge
2.05–2.45 m further out. So the exemption is as narrow as intended, but the
thing re-imposed is not the castle.

**The route wraps the castle the long way round** (out past the north-west
corner to (-28.5, -32.2)), so it meets **all four** towers, not just the
south-east one as hypothesised.

| seed | result |
|---|---|
| 20260728 | 1.52 m inside `tower-bodies[0]` |
| 2 | 1.14 m inside `tower-bodies[0]` |
| 5 | 0.78 m inside `tower-bodies[1]` |
| 18 | 1.09 m inside `tower-bodies[1]` |
| 11 | clears by **0.043 m** |

Four clip; the fifth misses by 43 mm. There is no margin anywhere.

`npm run measure:slide-towers` (honours `LGP_SEED`) prints the worst gap and
which tower, off the built scene.

### Threshold — the one number not to get wrong

`CHUTE_ENVELOPE` (in `SlideRide.ts`, derived from `PROFILE`: ±0.95 m across,
−0.06…+0.86 up) is the **rider's own envelope**. `CORRIDOR_RADIUS` (1.45 m) is
the wider margin the *search* steers by. Use the envelope for collision truth:
the 0.5 m difference is exactly what separates seed 11's real 43 mm clearance
from an apparent 0.46 m clip.

### The fix, not yet written

Make the chute's `clear` predicate know about the towers, so the search routes
around them instead of being told about a rectangle they are not in. Towers are
solids of revolution, so `distance to axis vs radius-at-height` is exact and
cheap — no probe rays needed. Keep the two-plot exemption narrow; re-impose the
castle as rectangle **plus** towers.

Beware: `slide/supports.ts` legs may also foul towers — check after.

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
