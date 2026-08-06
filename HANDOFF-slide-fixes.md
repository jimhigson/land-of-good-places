# HANDOFF — e-slide-fixes (PR #227 review fixes)

Branch `e-slide-fixes`, pushed to `feat/slide-parapet-gap`. Worktree
`.claude/worktrees/e-slide-fixes`. **Do not merge — Jim merges.**

Two review fixes, plus one measurement to report on #229 and **not** ship.

## Fix 1 — over-length route accepted (DONE)

`satisfies` had two clauses (length ≤ 75, height-sensitive complaint); the
post-solve guard in `planSlide` re-checked only the height one. When the
generator's unsatisfied fallback fires it hands back the first route that
merely *solved*, and `planSlide` accepted it.

**Proved red first.** Widening the pit rim from 3 radii to 9 (29 → 92 landing
poses) on seed 5 makes the fallback fire:

```
{"seed":5,"routeLength":90.28,"MAX_RIDEABLE_LENGTH":75,"overCap":true,"satisfied":false}
```

90.28 m against a 75 m cap, accepted, exit 0. Exactly the reviewer's number.

Fixed by giving the question **one owner**: `heightSensitiveComplaint(points)`
became `unrideableComplaint(route)`, which owns length *and* the two
height-sensitive checks. `satisfies` and the post-solve guard both call it, so
there is no second condition left to fall out of step.

Same 9-radius repro after the fix: **throws**, naming 90.28 m vs 75 m.

## Fix 2 — invariant asserted a guarantee nothing enforced (DONE)

`SLIDE_PLAN.facadeDoorMinX/MaxX` → `ShellPlan.slideGap` → **two dead readers**.
`buildCastle` early-returns on the facade branch and cuts only
`plan.doorMinX/doorMaxX` (the front entrance); the interior shell sets
`slideGap: null`. Confirmed independently.

**Chose: correct the claim, not wire up the geometry.** Because the geometry
should not exist. Measured with `probe-wall-crossing.mts` on all five seeds:

| | value |
|---|---|
| chute crosses south wall plane at | **y 14.84** |
| tallest masonry (crenellations) tops at | **y 10.29** |
| clearance | **4.55 m**, identical on all 5 seeds |

The chute **flies clear over the battlements**. Cutting a `slideGap` into the
curtain wall would notch masonry the chute passes 4.55 m above — fabricating
damage to make a test true. So:

- `invariants.ts` — the "leaves through its door" premise is false and is
  replaced by a clause that measures the built chute against the **built**
  masonry (the guarantee that actually keeps a child out of stone). The
  rules-vs-rules clause 1 and the planned-hole clause 3 are gone.
- `plan.ts` / `Shell.ts` — the dead fields documented as dead, with the number.
- PR body corrected.

This also **answers** the QA question the reviewer raised ("may fly clear over
the battlements") — it does, measurably, on every seed. What still needs eyes is
whether a chute launching from above the battlements *looks* right.

## Review round 2 (Overseer) — DONE

- **BLOCKER fixed.** `castleMasonryTopY` seeded `-Infinity` with no match check
  meant a mesh rename made `underside < -Infinity` false for every chute: the
  invariant went green measuring nothing (reviewer broke the regex, got 28/28
  green). A missing measurement is now a *complaint*. Re-proved by breaking the
  same regex: red, 1 failed / 27 passed, naming the cause. Polarity is
  deliberately opposite to the `Number.isFinite(worstGap)` guard at the towers
  invariant, where Infinity is a genuine pass; both comments say so.
- **4.55 m was the centre line, not the air.** Underside 13.73 m vs stone
  10.29 m = **3.44 m**. Code was always right (it uses the underside); prose was
  loose. Corrected everywhere.
- `scoreOf` comment no longer says "nothing would fail" (seed 5's leg invariant
  does fail); `doorPoses` symmetry claim corrected with measured 34 vs 8.
- Deleted rather than documented: `facadeDoorChuteHalf` (zero readers) and
  `ShellPlan.slideGap` (12 lines of comment, two unreachable readers).
- Route byte-for-byte unmoved: canonical 68.7537 m attempt 199, seed 5
  72.9703 m attempt 323, SHA256s unchanged.

## The measurement for #229 — report only, DONE, nothing committed

Diagonal (anti-diagonal) attempt ordering **combined with** free landings.
**It works on 4 of 5 seeds**, and the rides come out better-shaped too.

| seed | baseline (pinned, start-major) | diagonal + free landings |
|---|---|---|
| 20260728 | 3.50 s / 68.8 m | **0.60 s** / 61.3 m |
| 2 | 3.69 s / 72.3 m | **0.84 s** / 65.7 m |
| 5 | 15.75 s / 73.0 m | **31.12 s** / 66.2 m |
| 11 | 6.73 s / 69.4 m | **1.72 s** / 63.6 m |
| 18 | 5.18 s / 66.5 m | **0.96 s** / 60.4 m |

Control — diagonal ordering with the pit still **pinned**, which reproduces the
previous author's reverted experiment on this machine:

| seed | reverted experiment (their number) | mine |
|---|---|---|
| 20260728 | 9.87 s | 9.65 s |
| 5 | 31.64 s | 32.48 s |

**Attribution:** seed 5's ~31 s appears with the pit pinned *and* free, so it is
caused by **diagonal ordering**, not by freeing the landing. And the canonical
seed goes 3.50 -> 9.65 s under diagonal-alone but 3.50 -> **0.60 s** under
diagonal+free: the two changes are not the sum of their parts, and free landings
*rescue* what diagonal ordering alone breaks. That is exactly the untested
combination the reviewer predicted.

**Caveat that matters.** The best-first ordering of the landing list dominates
the result. My first attempt ranked landings by `|straight_line - 60|`; the chute
wraps the tower so a route is ~3x the straight line (the pinned pit is 23.11 m
out and yields 66-73 m of ride). With that wrong target, **4 of 5 seeds failed to
solve at all** — canonical's best offer was 89.67 m against the 75 m cap.
Retargeting to `|3 * straight_line - 60|` produced the table above. So "free
landings" is not one experiment, it is a family of them, and the ordering
heuristic is the variable.

Experiment shape (reconstruct from here; **not committed**):
- `generate.ts`: anti-diagonal pairing, `for d in 0..S+E-2, for i in ...` .
- `plan.ts`: `freeLandingPoses()` — 4 m grid over `GARDEN_PLAY_RADIUS`, keep
  centres where `openGround` holds at the centre and 8 rim points at
  `BALL_PIT_RADIUS`, 4 headings each facing the middle, filtered by
  `approachIsClear`, sorted by `|3 * ride - DESIRED_LENGTH|`.

### Round 2: the ordering key was the whole problem

The Overseer asked for (a) the unmeasured free+start-major cell and (b) a line
fit to calibrate the ordering. Both done, and they overturned the 3x key.

**(a) Free landings + start-major does NOT work** — seed 5 fails to solve at all
(best offer 91.13 m against the 75 m cap); the other four solve at 2.98 / 9.95 /
7.32 / 1.15 s. Attempt indices show why: 9945 attempts against a 700 budget
reaches only doors 0-2, and seed 5 needs a higher door. **So diagonal ordering
is load-bearing** — the seed 5 regression cannot be dodged by dropping it.

**(b) The line fit does not exist.** Observational pairs give slope **-0.80**,
R^2 **0.368** — negative, because landing distance is *selected by the ordering
under test*. A controlled sweep (canonical seed, landing radius forced to a +/-2 m
annulus) confirms there is no usable relationship:

| forced R | 18 | 22 | 26 | 30 | 34 | 38 |
|---|---|---|---|---|---|---|
| length | 66.2 | 63.5 | 66.8 | 59.2 | 74.7 | 47.0 |

Non-monotonic, 47-75 m. **Length is essentially independent of landing distance**
— the solver returns whatever piece chain fits. So "prefer landings at radius
r*" was the wrong frame entirely. What actually varies with distance is
**solvability and cost**: near landings solved in 0.7-1.0 s, far ones 2.7-4.5 s.

**(c) So order by ascending distance, and drop the length model.** Every seed
then beats baseline and the seed 5 regression disappears:

| seed | baseline | free + diagonal + ascending distance |
|---|---|---|
| 20260728 | 3.43 s / 68.75 m | **0.75 s** / 64.95 m |
| 2 | 3.54 s / 72.28 m | **1.05 s** / 72.78 m |
| 5 | 15.40 s / 72.97 m | **11.80 s** / 60.41 m |
| 11 | 6.64 s / 69.43 m | **1.81 s** / 61.77 m |
| 18 | 5.11 s / 66.53 m | **0.96 s** / 62.46 m |

Worst case **15.40 -> 11.80 s**, total **34.12 -> 16.37 s**, all lengths inside
the cap. Caveat: every seed then lands at d ~ 18.4 m (vs 21.7-28.1 pinned), so
the pit hugs the castle — a design call for Jim, and a minimum-distance floor is
the obvious knob.

Posted to #229.

## Standards used

`npm run build` exit 0, `npm run test:procgen` **157 passed / 0 skipped** —
count read, not colour. Never piped through head/tail.

## Temp files (deleted before each commit)

`scripts/probe-slide-length.mts`, `scripts/probe-wall-crossing.mts` — probes,
not part of the PR. Recreate from this file's numbers if needed.


## Review round 3 (Overseer) — DONE. PR approved.

- Fixed the dangling `{@link theSlideDoesNotClipTheTowers}` (real symbol:
  `theGinormousSlideMissesTheCastleTowers`), and took the reviewer's sharper
  reason for the opposite polarity: the towers invariant guards its own vacuity
  *separately* at `invariants.ts:1692` (`towers.length === 0`), which is what
  leaves `Infinity` there with only the genuine-pass reading. One number here,
  so one check does both jobs. Commit `51ba319`.

### #229 round 3 — headline holds, my explanation does not

**Holdout seeds 3, 7, 13, 29, 47 (never looked at before): 5 of 5 improve.**
Worst 9.94 -> 3.73 s, total 25.25 -> 10.86 s. Across all ten seeds now measured,
**10 of 10 improve**, total 59.37 -> 27.23 s. Attempts-to-solution (the
ordering-independent unit) roughly halves: 179 -> 77 across all ten, and the
holdouts agree with the originals (79 vs 75) rather than regressing.

Noticed on the way: **seed 47's baseline ride is 74.75 m against the 75 m cap**
-- a fresh seed within 0.25 m of tripping the guard Fix 1 added.

**Length is an input, not an output.** `CLOSE_AFTER 0.68` / `CLOSE_ONLY_AFTER
1.45` x desiredLength 60 clamp closure into 40.8-87 m. No distance->length model
could have worked; my controlled sweep was measuring the clamp. The 3x key
reduces to "prefer landings near 20 m" -- an accidental proxy, never a model.

**"Near landings are genuinely easier" is FALSE.** Holding landings-per-band at
N=8 (360 attempts, under the 700 budget, so no door starvation) seed 5's *far*
band R=38 is its easiest by far (44 attempts, 2.28 s) while R=18/26/30/34 fail
outright. The reviewer's confound was real and my mechanism was wrong.

The confound cannot be fully removed by subsampling either: circumference 2*pi*r
means R=18 holds only 9 landings total, so N<=8, at which point success turns on
whether one workable landing survived the subsample.

**Current hypothesis (stated as one, untested): it is diversity, not distance.**
Ascending distance walks many distinct sites early; with anti-diagonal ordering
covering doors early too, the first 700 attempts span a more diverse slice of
(door x landing). Whoever implements this must NOT write "near landings are
easier" in a comment -- that is the claim I would have shipped, and it is false.

---

## Stopped mid-task, 6 August — where this stands

Jim stopped the agent to save tokens. Everything is committed and pushed;
nothing was lost. Branch tip `2eb9014`.

### What is done and approved by Jim

Landing bug (root-caused: `planExit` was never told where the chute is),
reclined feet-first riding pose, boarding moved to **1.225 m** from the roof
edge, half-see-through chute (#228), balls scattering on touchdown, the
90.28 m over-cap acceptance, and the battlements invariant with its
`Number.isFinite` guard. The floating-head bug is fixed — cause was
`TreeClimbing.hidePlayerBody`, the game's only body-part hider, which could
strand her permanently; deleted.

### The one thing outstanding — the camera

Jim's ruling, verbatim:

> *"let's change the slide camera to alternate between a fixed camera aimed at
> the character and a chase camera behind them, then I don't mind the body
> being hidden because it will still be shown for the static camera"*

**Nothing of this is built.** The branch tip is only the measurement commit
that proved the problem.

**The measurement that settles the design: head ~2500 px, body 0 px.** She
lies feet-first on her back, so her head points back up the slide straight at
a camera behind her — from directly behind, her head hides the rest of her by
construction. That is not a bug to fix; Jim has accepted it, because the fixed
camera carries the body.

**So do not compromise the chase shot.** Leave it as the over-the-shoulder
speed shot it is.

**To build:**

- **A fixed trackside camera** aimed at her, cutting with the chase camera.
- **Take its positions from the solved route**, not pinned coordinates — this
  is a procgen ride and the chute differs on every seed.
- Several fixed cameras down the chute is likely better than one distant one:
  she must be **big enough to see**, and the ride is ~68 m.
- Judge the **rhythm** (how often it cuts, which it opens on) and whether it
  **cuts or blends** — real on-ride videos hard-cut, and a blend across a big
  spatial jump usually reads as a mistake. Decide and justify.

**Guard it, pointing at the right shot:** `check:slide-rider` must assert her
body reads **on the fixed camera**, and explicitly *not* on the chase, which
is now allowed to show a head. A check demanding body pixels on both would
fail correct behaviour. Also assert **every part of the ride is covered by
some camera** — a gap where neither has her is the kind of thing nobody
notices until a child rides it.

### Do not touch

`START_Y`, the 1.225 m roof-edge boarding, the recline pose, and the
`Number.isFinite` guard on `theGinormousSlideLeavesOverTheBattlements`. All
settled, all approved.

### Also outstanding, separate PR

Item 5 of Jim's original six — **the ball pit following the slide** — is
stopped on a measured blocker written up on **#229**: `train/route.ts` keeps
the railway clear of the pit and the train is solved *before* the slide, so a
pit that follows the landing is a dependency cycle. Dropping that keep-out
changes the train's route on all ten seeds and trips
`RATCHET LOOSE: rail.walkable: recorded 30, now 29`. It needs its own PR.

The ordering change that delivers it is measured and holds on **10 of 10
seeds**, five of them fresh holdouts — but **whoever implements it must not
write "near landings are easier" in a comment.** That claim was tested and
disproved; document the key as chosen empirically, mechanism unconfirmed.

### Do not hand Jim a URL until the camera work is done

His explicit instruction — no more stage-by-stage.

### Three faults on this ride shared one shape, worth remembering

The rider 26.65 m off the chute, a pose the harness never exercised because it
never called `Player.update`, and visibility asked of the wrapper instead of
the thing. **Assert the thing, not its container.**
