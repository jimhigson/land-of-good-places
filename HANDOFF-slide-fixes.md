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

---

## Picked up by `e-slide-cameras`, 6 August — the two-camera work

Branch `e/slide-cameras`, worktree `.claude/worktrees/e-slide-cameras`, pushed
to `feat/slide-parapet-gap`. **Do not merge — Jim merges.**

### What the ride actually measures (canonical seed)

| | |
|---|---|
| chute curve length | **74.41 m** (the plan-view route is 68.75 m; the 3D Catmull curve is longer) |
| speed | 6.5 m/s (`GIANT_SLIDE_SPEED`) |
| ride duration | **11.45 s** |
| top of chute | y 14.84, dead level (0.0° slope) until t≈0.22 |
| steepest | 20.7° at t≈0.60 |
| mouth | y 1.09, 0.89 m over the ground |
| castle centre | (−15.34, −21.79) |

### The measurement that decided the camera placement

A trackside eye is placed in the **chute's own frame** (`right`/`up`
perpendicular to the tangent, the same construction `SlideRide.sampleFrames`
uses), at a standoff distance and an elevation angle. Sweeping both and asking
"can this one eye see a rider lying in the trough, all the way through its
beat?" (41 samples per beat, raycast against the chute **and** the castle):

| elevation | worst beat coverage |
|---|---|
| 40° | **41–59%** |
| 45° | 83–90% |
| **50°** | **100%** |
| 55°–65° | 100% |

**Standoff made no difference at all** — 4.5 m and 9.0 m give identical
coverage at every elevation. The limit is a fixed *angle*, not a distance:
what blocks the shot is the hand-rail along the near side of the trough
(a tube of radius 0.11 at ±1.0 across, 0.9 up), and clearing it is an angle in
the chute's own frame however far away you stand. The naive rail geometry says
34°; the measured threshold is 50°, and the extra 16° is because the chute
**turns** within a beat, so at the beat's ends you are looking along the trough
obliquely and the effective wall is taller.

So: elevation is chosen with margin over a measured threshold, and standoff is
free to be chosen purely for **how big she reads**.

### Placement rule (derived, never pinned)

- Beats are **equal fractions of the solved arc**, so the rhythm is the same on
  every seed — the same argument `SlideRide`'s `BAND_PERIOD` already makes for
  the see-through bands.
- The eye sits on the side **away from the castle centre**. The chute is
  planned to clear the castle and its towers by `CORRIDOR_RADIUS`, so outward
  is the open side by construction. Measured: the three eyes land 27.4, 30.0
  and 32.2 m from the castle centre, and 20.0, 13.8 and 6.7 m over the ground.

### Standards

`npm run build` and `npm run test:procgen`, exit codes read, never piped.
Own port 5413 if a dev server is ever needed.

---

## Finished by `e-slide-cameras-finish`, 7 August — the camera work is done

Branch `e/slide-cameras-finish`, worktree
`.claude/worktrees/e-slide-cameras-finish`, pushed to `feat/slide-parapet-gap`.
**Do not merge — Jim merges.**

### The WIP tip was sound; three defects around it were not

`e4d2298` ("UNVERIFIED, DO NOT TRUST") does in fact build and pass — verified
before building on it: `npm run build` exit 0, `test:procgen` **186 / 0
skipped**. The predecessor had built more than the handoff above claims.

Three defects found and fixed (`733eecb`):

1. **`rideCameraNow` restated the opening shot as a second fact about it.** Its
   doc promised "the opening shot is decided in exactly one place — the shot
   plan", then returned the chase camera whenever no shot was live. That is
   exactly the state boarding leaves behind, because `boardSlide` resets the
   director so a ride cannot inherit the last one's shot. Today the two agree
   (`BEATS` is even, so beat 0 is the chase); reversing the plan would have
   opened on one camera and cut to the other a frame later. Now it asks the plan
   for its **first** shot, and a new private `cameraForShot` is the single owner
   of the shot-to-lens mapping, which had been written out twice.
2. The new camera invariant had been inserted **between**
   `theGinormousSlideMissesTheCastleTowers` and its own doc comment, leaving 70
   lines of prose about swept discs sitting above a function about cameras.
3. The same pattern again in `Player.ts` — `ridePosture` inserted between
   `hopClearance`'s doc comment and its field.

### Merged `origin/main`, did not rebase — and why

**A rebase is not available on this branch.** It has 54 commits including an
existing `Merge origin/main` (`c75773d`); replaying them conflicts on
`src/world/rail/generate.ts` at #118, a commit nothing here touches. Merging is
also the pattern this branch already uses. Two merges done: #215 + #239.

**#215 ("Wave from up a tree") collided with the reclined pose, and the
resolution matters.** #215 extracted the seated ride pose out of
`Player.update` into a module-level `applyRidePose(model, climbWave, elapsed)`
*specifically* so `check:climb-wave` poses a kid exactly as the game does — its
own doc comment says a check that re-implements a pose can pass a pose the game
never renders. Meanwhile this branch had added `ridePosture` plus two private
methods, `holdSeated`/`holdReclined`. Keeping both as written would have left
**two definitions of "how a rider is posed"** — `check:climb-wave` posing
through one and `check:slide-rider` through the other. Combined instead:
`applyRidePose` now takes a `posture` and owns both, with `holdSeated`/
`holdReclined` gone.

**A latent bug on our side that main's reasoning exposed.** The seated pose
zeroes `body.rotation.z` deliberately — `Player.animate` runs immediately before
it and writes the gait's roll there, so a rider who boarded mid-stride would
otherwise keep a frozen sliver of that lean for the whole ride. The reclined
pose never did this. It does now.

**Checked, not assumed: no body-part hider survives anywhere in `src/`.** Both
branches independently deleted `hidePlayerBody`/`showPlayerBody` — ours for the
slide complaint, #215's for the tree one — so the merge could have silently
reverted the floating-head fix. It did not; `grep` over `src/` finds no
`.visible = false` on any character body part.

### One trap worth knowing: `scripts/*.mts` are not typechecked

Adding `root` to `RidePoseTarget` compiled clean under **both** `tsc --noEmit`
and `typecheck:test`, then failed at runtime inside `check:climb-wave`, which
hands `applyRidePose` an object literal built by hand. Neither tsconfig covers
`scripts/`. If you change a type that a `scripts/*.mts` imports from `src/`,
**run the build** — the compiler will not tell you. (There is a
`chore/typecheck-scripts` branch that would close this.)

### Standards

`npm run build` exit 0 and `npm run test:procgen` **196 passed / 0 skipped**,
counts read not colours, never piped. The 196 reconciles: 181 before this PR,
**+5** for the camera invariant across five seeds, **+10** for #215's two new
invariants across five seeds.

No dev server was needed and no Chrome tab was used — the pixel evidence comes
from `check:slide-rider`'s offscreen raster, not from a browser. **Visual QA
still wants eyes on the cut** (see the PR body).

---

## Review round (Overseer), 7 August — one fix, then Jim

**PR approved with one blocker, now fixed.**

### The blocker: `scripts/map-slide-space.mts` exited 1

A new file on this branch importing `FACADE_SLIDE_DOOR_MIN_X`/`MAX_X` from
`layout.ts` — constants this same branch deletes. `SyntaxError`, exit 1. Nothing
caught it: wired into no npm script, and `scripts/` is in neither tsconfig.

**Deleted, not repaired.** It is #118 scaffolding that maps where the chute may
go *on the assumption the slide leaves through a hole in the facade* — the very
premise this branch measured false (chute clears the battlements by 3.44 m on
all five seeds, which is why those constants went). Repairing the import would
mean inventing a coordinate for a door that is not there, which is the thing the
branch already declined to do for `slideGap`. It also modelled the chute as a
hand-rolled smoothstep between two env knobs, which is what you write *before*
there is a solver; the route is solved now, and its job is covered by
`measure:slide-comfort`, `measure:slide-towers`, `measure:slide-fingerprint`,
`check:slide-rider` and the procgen invariants.

**Swept for more**: an ad-hoc `tsc` pass over `scripts/**/*.mts` after the
deletion reports **no other missing-export errors**. Both instances of the
`scripts/` typecheck gap seen on this branch are now written up on **#197**
(the loud one — `root` on `RidePoseTarget` compiling clean and crashing in
`check:climb-wave`; and this silent one).

### What the reviewer verified by breaking it — keep this

The guards are **not** hollow, proved on three failure axes. The one worth
remembering: dropping the trackside elevation 55° → 40° reproduced the
documented claim exactly — **98 of 342 trackside frames blocked, worst pixel
sample 0.77%, still above the 0.40% floor**. So the pixel clause alone would
have stayed **green**, and the continuous per-frame sight line is genuinely
load-bearing rather than belt-and-braces. If anyone ever proposes dropping one
of the two clauses as redundant, this is the number that says no.

Also confirmed independently: 196 reconciles as 34 invariants + 1 anti-vacuity
× 5 seeds = 175, plus 4+8+3+6 = 21, zero skipped; **seed-independence holds** —
on seed 5 beat 1's eye lands on the *opposite side of the castle* from
canonical, which is the test that actually matters for a procgen ride; neither
pre-merge path zeroed `body.rotation.z`, so the merge fixed something **neither
parent had right alone**; no body-part hider anywhere; build chain 34 → 35 steps
with nothing lost; merge base equals `origin/main`; merge-over-rebase endorsed.

### Still unseen by anyone

The reviewer had no browser. **Nobody has watched this ride.** 344/342/0 and the
pixel counts say the cut *happens* and that she is *on screen*; they say nothing
about whether six beats feels right, whether opening on the chase lands, or
whether the trackside framing looks good. That is Jim's to judge, and it is
stated plainly in the PR body rather than left to be inferred.
