# HANDOFF — railrace-bonk (agent `e-railrace-bonk`)

Work for PR **#223**, pushed to `chore/rail-race-pr-triage`. My working branch is
`e/railrace-bonk` in `.claude/worktrees/railrace-bonk`; `.claude/worktrees/pr-triage`
is another agent's and was never touched.

Jim rode the Rail Race and reported three things. **Duck bars only exist at
level 3** (`BARS_FROM_LEVEL = 3`) — QA at level 1 or 2 will never see one.

## The headline: 2 and 3 were NOT the same root cause. There were three.

### 1. The face pointed 81° away from the lens — FIXED, guarded

`camera.ts`'s rig stands square-on to the chord it frames, which measures
**81.1° off the rider's forward**, identical at every window shape and every
point on the ring. Measured by projecting her real eyes through the real rig:
one eye sat at a facing of **−0.25** (monitor) / **−0.35** (phone) — round the
back of her head, not drawn — and both eyes landed on the same screen x.

She now turns **50°** of the 81°: body 29°, head 21°. Split that way because
`gondola.ts` already ruled on this for a seated figure (*"the whole toy turns,
not its neck"*) and this kid has no neck — the head pivot is inside the torso.
50° not 60° because on a phone she is framed hard left and turning her walks an
eye towards that edge (60° left 0.003 of NDC margin; 50° leaves 0.061). The
sweep table is in `FACE_TURN_MAX`'s doc comment.

Guarded in `check:rail-race`: builds a real kid, poses her with
`faceTurnTowardsCamera` (the ride's own function, moved into `camera.ts` so
there is one copy), and asserts each eye is on the near side of the skull, on
screen, and separated from its twin. **Proved red at `FACE_TURN_MAX = 0`.**

### 2. The bar was inside her head in BOTH states — FIXED, guarded, one residual

Two causes, neither of them item 3's.

**(a) The clearance was set from measurements that are 1.40 m wrong.**
`DUCK_CLEARANCE_AT_PARK_SCALE` was set twice (1.5, then 2.1 on 1 August), both
documented as "halfway between her ducking and standing head heights", both from
a live reading of 4.70 m / 5.95 m over the rail. Re-measured by composing the
real transform chain: crown **6.10 / 7.35**, head top (hair included) **6.42 /
7.67**. Against a bar at 5.25 m the bar sat inside her head *whichever way she
played it* — the underside 1.54 m below the top of a **ducked** head. That is
why raising it to 2.1 never fixed Jim's 1 August report either.

Now **2.82** — the same rule both earlier passes intended, on real numbers,
measured to her head top because hair is what you watch pass through a bar. A
ducked head clears by 0.26 m; a standing one meets it by 0.99 m.

The duck-bar **posts** are authored 4.70 m tall — the very same wrong number,
sized on the same day — so they only ever reached their bar by coincidence.
Their length is now *derived* from the clearance (measured off the asset's
bounding box, stretched on Y alone), or every bar would float 0.75 m above its
own supports.

**(b) There is no collider on a duck bar at all** — a bonk is decided by button
state at the crossing, and nothing ever compared bar height to head height. So
the response is now physical: **the bar knocks her down into the seat**, by
exactly the drop the clearance is sized against, easing back as the wobble
fades. Rivals too — and two things were missing there: a *ducking* rival tucked
its arms but never actually went down, and a bonked one had no pose at all.

Guarded in `check:rail-race`, **proved red both ways**: at clearance 2.1 the
ducked half fires ("clears by −1.54"), at 4.0 the standing half fires ("strikes
by −1.96", i.e. a bar nothing ever hits is decoration and deletes the game).

### 3. The bonk fired 2.5 m past the bar — FIXED, guarded

The bar's geometry was drawn at `spot.at` — its supporting trestle's
collision-nudged position — while `simulate.ts` bonked at the un-nudged
`bar.at`. On the canonical seed **every one of the seven bars carried a −2.00 m
arc nudge**. `track.ts`'s own comment argued an arc nudge "costs nothing"
because bar and leg move together: true of bar-versus-leg, silent about
bar-versus-physics.

Measured, canonical seed, a rider who never ducks:

| | crossing the built bar | bonk lands |
|---|---|---|
| before | 32.40 → 32.47 m/s (no reaction) | 2.52 m past it |
| after | 32.40 → 11.36 m/s | 0.35 m, under one frame's 0.54 m |

**Fixed by drawing the bar at `bar.at`**, the number it is scored at, so the two
are one number by construction. (My *first* fix published the built position and
scheduled from it — that worked, but left two numbers kept in step by a
parameter, and the first invariant proved it: reverting `chooseLevel` left the
suite **green**. A check that passed without checking anything, in the very PR
about one. Hence the structural version.)

Guarded by a new procgen invariant, `duckBarsSlowYouWhereTheyStand`, across all
five seeds. It compares two things from genuinely different places — the bar's
own instance matrix in the built scene, against a rider driven by the real
`stepRider` through the real `scheduleForLevel` — so neither side can satisfy
the other. **Both halves proved red separately**: restoring `spot.at` gives
2.52/2.08/2.36/2.39 m late against 0.44–0.54 m of frame travel; setting
`BONK_SPEED_FACTOR = 1` leaves the position half green and fires the speed half
on all seven bars.

## The one thing left, with numbers

Her head is enormous (3.74 m tall at ride scale), so it reaches the bar before
her *centre* does. Frame by frame through a bonk at 32.5 m/s, the bar is inside
the top of her skull for **4 frames (67 ms)** — from 1.65 m before the bar to
the bonk frame — and clears cleanly from then on.

The principled fix is to bonk at **first contact** rather than at the bar's
centre: subtract a `BAR_CONTACT_LEAD` of ~1.9 m (head half-depth at the bar's
height, ~1.46 m, plus the bar's own 0.43 m) inside `planHazards` when building
`barCrossings`, so every consumer — `stepRider`, `barIsHere`, the strategies —
sees one consistent number and the rival AI/balance do not shift relative to it.

**I did not do it**, deliberately: it moves when the bonk fires by 1.9 m
immediately after a fix for the bonk firing in the wrong place, and I had **no
browser this session** to check it does not read as "she slows before the bar".
It wants eyes first. The artifact it would remove is ~3× smaller than what was
reported.

## Round 3 (6 Aug): the rig question — ANSWERED, no artist needed

Jim: *"ducking doesn't mean the whole character moving down and clipping through
the car; same for when bonking head - the mesh should properly deform; get the
3d artist to make an articulating model in blender if that's the problem"*

**Split the question in two, because the two halves have opposite answers.**

**A crouch as a rigid-part POSE: the rig can already do it. No artist needed.**
The precedent is exact — `Player.ts:1140-1158`, the flower pick, bends
`model.body.rotation.x` by up to **−0.78 rad (45°)** with the comment *"Bending
at the waist, with the feet planted"*. `body` is a real Group between `root` and
`head` (head at local y 1.36), it is already non-uniformly scaled every frame by
`applyWalk` (`asset.ts:93-97`), and legs already reach **−1.25 rad** for sitting
in the ferris wheel gondola. The house idiom is stated outright: layer a
hand-written pose on top of `applyWalk`, additively, rewritten each frame.

Arithmetic: a 45° body bend puts the head pivot at 1.36·cos45° = 0.96, a drop of
**0.40**; a further 10% squash reaches **0.49** — i.e. it reproduces today's
`DUCK_DROP = 0.5` *as a pose*, with `root` never moving, which is precisely what
stops her sliding through the cart floor.

**A DEFORMING (skinned) mesh: impossible today, and the pipeline forbids it.**
Zero hits repo-wide for `SkinnedMesh`/`Skeleton`/`Bone`/`skinIndex`. There is no
`GLTFLoader`; the hand-written reader `art/style/glb.ts` documents "no skins" and
would throw. All three Blender exporters pass `export_skins=False`
(`kid_roundtrip.py:73`, `cart_export.py:44`, `duckbar_export.py:52`). The kid is
14 flat rigid parts (`KID_BODY_PARTS`). Commissioning a skinned rig would mean
replacing `glb.ts` with a real loader, changing `check:character-parity`, and
reworking `InstancedCrowd` — a pipeline project, not an asset.

**Structural caveat if a *fully* naturalistic crouch is ever wanted:** the hip
pivots are children of `body` (local y 0.36) and **there is no knee**. So a
body-only bend takes the feet with it, and a hip-only fold swings a rigid
leg+shoe stick and lifts the shoes. In a cart neither matters — the dodgems
precedent literally buries the legs in the tub — but on open ground it would.
The cheapest authentic crouch would be a pelvis Group between `root` and `body`
plus a knee node splitting `leg-upper`; still zero skinning.

## Round 4 (6 Aug): rebased, sad-only turn, rainbow finish

Rebased onto `main` (#238, #216, #221). **#216 made the ring a boundary-following
spline** and silently invalidated two of this PR's measurements — both fixed,
both re-proved red. Detail is in the PR body and the commit messages; the short
version is that `duckBarsSlowYouWhereTheyStand` was inverting arc length with a
constant that no longer exists (`NaN`), and `droppersHangUnderRealRails` was
comparing radii on a ring whose radius now varies by 40 m. **The droppers were
fine; the test was broken.** Rewriting it took three goes and the two wrong ones
both looked like results — see the commit for the shapes of those mistakes.

Landed since round 3:

- **Turn only when sad.** `riderIsSad()` is the one owner; the turn is scaled by
  `Cart.sad`, its damped form. Guarded both ways.
- **Finish line is a huge rainbow** — 6 bands, 20.4 m tall, 40.8 m span, apex
  16.5 m over the outer rail. Radius *solved* from
  `RIDER_HEAD_TOP_AT_PARK_SCALE`, which is now the single owner of rider height
  (the duck-bar clearance is documented as derived from it). The old straight
  beam sat 2.2 m over the rail against a 7.67 m head — it passed through every
  rider, every lap.

**Counts moved:** the bar is now **156 passed / 9 files / 0 skipped**, not 137 —
`main` brought new tests, and +5 of the rise is the rainbow invariant.

## Round 5 (6 Aug): the crouch — DONE

`src/world/railRace/duckPose.ts` is the whole of it. `root` never moves; `body`
sinks (`DUCK_HIP_DROP`), the waist folds 45°, the chin tucks, the arms come in,
and a light 12% squash supports it. Player drives it through
`Player.railRaceDuck` (set in `poseRider`, applied at the end of
`Player.animate`, before `model.update` so the ponytail follows); rivals get
`poseDuck` directly after `kid.update`. The bonk knock-down uses the same pose.

Duck depth **1.49 m** at ride scale, against 1.25 for the old translation.
`DUCK_CLEARANCE` re-derived: clears by 0.74, strikes by 0.74.

**The one thing to understand before touching it:** a 45° waist bend lowers the
top of her head by only **0.077 m**, because a big round head tipped forward
brings its back up as fast as it brings the crown down; a chin tuck *alone*
RAISES it 0.263 m. The clearance comes from the hip drop and the squash. Do not
"simplify" this to a bigger bend — it will look identical and clear nothing.

**No modelling needed here, and the reason does not generalise:** it works only
because the cart hides the legs (there is no knee, so the feet sink with the
hips). Any crouch in the open still cannot be expressed — the ask would be a
pelvis Group plus a knee node, both plain Groups, zero skinning.

## STILL OPEN — the 4-frame skull clip

Re-measured after the crouch: **still 4 frames.** It cannot be fixed by a
deeper duck, because it happens while she is still *upright*, on the approach,
before the bonk that folds her. Only the ~1.9 m contact lead removes it —
subtract it inside `planHazards` when building `barCrossings` so `stepRider`,
`barIsHere` and the strategies all see one number. Deliberately not shipped: it
moves when the bonk fires by 1.9 m and I have had no browser all round.

## Checks

- `npm run build` — **exit 0**, run directly, never piped.
- `npm run test:procgen` — **137 passed, 8 files, 0 skipped** (was 132; +5 is the
  new invariant across five seeds).
- `npm run check:rail-race` prints the new lines:
  `duck bar underside 6.67 … clears by 0.26, strikes by 0.99` and
  `face monitor turned −50.0° worst eye facing 0.546 …`.

## Needs eyes (I had no browser — chrome MCP absent this session)

1. **Does the 50° turn read as "racing forwards, glancing at you"** or as
   sitting oddly in the cart? The one real judgement call here.
2. **Does a bonk read as a bonk** — bar arrives, she snaps down, wobbles? And is
   the 4-frame skull graze noticeable enough to want the contact lead above?
3. **Do the bars look right 7.05 m over the rail** with stretched posts —
   proportionate to a 5.3 m child, but it is a big change from 5.25.
4. Rivals: same three questions, plus their new hands-over-head bonk pose.
5. #223's own outstanding item: does `'frown'` read as distinct from
   `'sad'`/`'surprised'` at gameplay distance — now that it can be seen at all.

**Ride at level 3** or there will be no bars. `/rail-race` deep link; use a
private window.

---

## Stopped mid-task, 6 August — where this stands

Jim stopped the agent to save tokens. **The difficulty change was made but not
committed**; it is committed now, unreviewed and unmeasured, in the commit
that carries this note. Everything below it on the list is untouched.

### What Jim said, verbatim — this is the spec, do not re-derive it

> *"it's just too hard ffs, you go too slow and the computer goes too fast,
> that's what too hard means in a race, quit arguing with me about that"*

> *"you win a race by going fast, you go slow means race too hard"*

The Overseer had sent the agent off investigating bonk penalties and hazard
density. **That was wrong.** Jim had already given the answer: player faster,
rivals slower. Do not open that investigation again.

### The four levers, changed but NOT measured

| constant | was | now |
| --- | --- | --- |
| `PLAYER_BOOST_ADVANTAGE` | 1.2 | **1.5** |
| `MAX_SPEED` | 33 | **40** |
| `RIVAL_SKILL` | 0.62 / 0.72 / 0.82 | **0.52 / 0.60 / 0.68** |
| `SWING_BEHIND` | 1.0 | **0.12** |

`SWING_BEHIND` is the rubber band that speeds rivals up when she is ahead —
nearly off now, deliberately: a child who gets a lead should keep it.

**Nobody has ridden or simulated this.** Confirm the sloppy profile wins
comfortably and by a wide margin. The only guard rail is that she must still
be able to lose if she does badly; short of that, err well on the easy side.

Note from the earlier round, still true: **win count is seed noise** (12/12/15
across three boost settings). Mean margin is the signal.

### Still to do, none started

1. **Camera jerk** — diagnose before damping. Prime suspects: #216 made the
   ring a spline with radius varying by 40 m, and the rig reads the track's
   **pointwise** frame; and sampled-points-versus-the-segment-between-them,
   which already produced 0.42 m of quantisation in this PR's dropper check.
   Any damping added must be frame-rate independent (half-life in seconds).
2. **Camera distance scales with speed** — further back when faster, eased.
3. **Boost rock** — torso rocks forward while boosting; there is not enough
   visual feedback today.
4. **Win celebration** — camera holds on her a few seconds while she jumps in
   the cart, **legs visible for it**.
5. **Leg-visibility guards** — legs off racing, on for the win, on when she
   leaves. Derived from ride state every frame, never a stashed list.
6. **4-frame skull clip recheck** at the new higher speeds. It happens on the
   approach, before the bonk folds her. Only a ~1.9 m contact lead removes it;
   not shipped, needs eyes first.

**`body.rotation.x` will shortly have four claimants** — seated pose, duck
fold, boost rock, win jump — and `Player.animate()` rewrites it every frame,
stamping over anything set from outside. Compose them under one owner. Test
**boosting while ducking**; a child will hold boost under a bar.

### Untracked scratch files

`scratch-field.mts` and `scratch-haz.mts` are the agent's measurement scripts,
left untracked on purpose. Useful for re-running the field simulation.

### Do not hand Jim a URL until the whole list is done

His explicit instruction. He does not want it stage by stage any more.

---

## Round 6 (6 Aug), agent `e-railrace-round5` — branch `e/railrace-round5`

Rebased onto `origin/main` (24 commits replayed, no conflicts; diff vs main is
rail-race files only, checked).

### Difficulty — DONE, measured, and the pushed commit was broken

**The pushed round-5 commit failed `check:rail-race`, so `npm run build` was
red on this branch.** Two assertions: the strong player won by 534 m (a
near-lap procession) and sloppy play won 24/24.

**It also did not fix Jim's complaint.** The whole race is decided by *tap
rate*, and nothing in the build measured it — every checker strategy mashes at
a flat 6/s by design (`STRATEGY_MASH_RATE` isolates judgement from thumb
speed). Measured at realistic rates with a jittered tap stream, 24 seeds,
level 3:

| taps/s | bars | wins (committed) | margin | her top speed |
| --- | --- | --- | --- | --- |
| 6.0 | 100% | 24/24 | +24.0 s | 33.5 m/s |
| 4.0 | 65% | 21/24 | +3.1 s | 28.0 m/s |
| **3.0** | **50%** | **1/24** | **−2.7 s** | **23.5 m/s** |
| 2.0 | 30% | 0/24 | −29.4 s | 18.0 m/s |

Boost settles at `gain × rate / decay`: at 3 taps/s she held 0.50, the rivals
0.49–0.55. **She was slower than every rival before a single hazard.** That is
Jim's sentence as a number.

Now: `PLAYER_BOOST_ADVANTAGE` 1.5 → **3.0**, `RIVAL_SKILL` → **.40/.48/.56**,
`SWING_BEHIND` 0.12 → **0.40**, `MAX_SPEED` **40 unchanged**. Child at 3 taps/s:
**24/24 wins, mean 114.8 m**, top speed 23.5 → **30.1 m/s**.

**Why the advantage is the right lever: it is self-limiting.** `BOOST_MAX`
clamps boost at 1 and a 6-taps/s player is already there, so it speeds up a slow
tapper and does *nothing* for a fast one. Do not "simplify" it into
`BOOST_GAIN_PER_PRESS` — that is shared with the rivals and was measured making
sloppy play *worse*.

**`SWING_BEHIND` 0.12 was too far.** The ceiling engages at
`SWING_BEHIND / CATCHUP_BEHIND` metres = 20 m at 0.12 — *inside* the camera's
picture, the one part of the band a child sees. 0.40 puts it at 67 m and buys
"nobody gets lapped" (worst case 640 → 544 m against a 600.2 m lap). The win
celebration needs the rivals still on the track.

### New guards, all proved red by mutation

Two new strategies in `simulate.ts` — `childPace` (3/s, jittered, half the
bars) and `playsBadly` (1.2/s, a tenth of the bars). `tickMash` takes optional
jitter; rivals unaffected.

- child must win — red at the old advantage ("wins only 11/24")
- child's mean margin > 40 m — red the same way ("only 14.4 m")
- badly-played must be able to lose — red given a star's thumb ("wins 24/24")
- nobody lapped — red at `SWING_BEHIND = 0` ("660.7 m, which laps them")

**The 170 m procession bound was re-derived, not loosened.** Worked backwards it
demanded rivals at ~0.86 skill — almost exactly the 0.62/0.72/0.82 the family
rejected as "far too good" — held up by a band towing a far-behind rival to
38.9 m/s, *faster than the player*, so it came screaming back into shot: Jim's
complaint precisely. A bound only meetable by reinstating the complaint is not a
bound. Replaced with a physical fact from the game's own geometry
(`route.length`).

Old `sloppyField.wins < 24` asserted the right idea about the wrong player —
`mashSloppy` taps 6/s, a metronome that forgets bars, not a careless child.
`playsBadly` carries that guard now.

Scratch measurement scripts left untracked: `scratch-difficulty.mts`,
`scratch-sweep.mts`, `scratch-focus.mts`.

### Still to do (items 1–6 of the round-5 list, none started)

---

## Round 7 (7 Aug), agent `e-railrace-finish` — branch `e/railrace-finish`

Worktree `.claude/worktrees/railrace-finish`, branched from
`origin/chore/rail-race-pr-triage`. Already on top of `origin/main` (28 ahead, 0
behind), so no rebase was needed; `git diff --stat origin/main..HEAD` is
rail-race files only, checked for the squash-revert shape.

**The inherited "UNVERIFIED, DO NOT TRUST" WIP was in fact green** — build exit
0, `test:procgen` 171 passed / 9 files / 0 skipped, before I touched anything.
That baseline was established first so nothing below could be blamed on it. It
was, however, not finished, and it carried one defect that reached the screen.

### The defect: the pump spring froze at the finish line

`stepRider` returns early on `rider.finished`, and the `bob` decay sits below
that return — so `bob` froze at whatever the last racing frame held, which for a
child still mashing across the line is exactly **1**, for the whole 5 s result
phase. Harmless while nothing read it; the WIP made two things read it:

- the winner's celebration ran with `pump` pinned at 1, so `BOOST_ROCK` threw
  her torso +0.42 rad forward against `CHEER_LEAN`'s 0.34 back — **net +0.27
  rad, hunched over the handlebars for her victory jump**;
- every finished rival sat locked at the bottom of its `BOB_DROP` seat dip.

Fixed at source: the decay runs before the early return, counting no presses.
Guarded by driving a real rider past the line **with the button still held**
(1.00 crossing, 0.00 five seconds later), and proved red by restoring the bug.

### A gate I wrote, my own check threw out — read this before re-adding it

I gated `pump` by `(1 - cheer)` so the rock could not fight the jump. The new
check caught it **claiming more than it delivered**: `cheerAt` peaks at 0.905,
so 9.5% of the rock survived a gate whose whole purpose was that none should. A
leaky gate that reads as a rule is worse than none, because the next person
trusts it.

Removed. What actually keeps the two apart is the clock, and that is what is
guarded now: the spring is empty at `BOB_SECONDS` = 0.22 s and the first hop
does not peak until 0.30 s. Two numbers from different modules, so lengthening
the spring or quickening the hop fires it.

### Two guards that were measuring the wrong thing

Both looked reasonable and both named the zoom in a failure message about
something else. Worth knowing before tightening either.

1. **"The zoom moves the rider by exactly zero."** Red on arrival: she slides
   0.0057 of the picture. At `SPEED_PULL_BACK = 0` the slide is **0.0078** —
   *larger* — so it is the follower's `FOLLOW_LAG` lead cancelling the chase lag
   only to first order, and the zoom slightly improves it. Now bounded end to
   end at 2% of the picture; the genuinely broken case (scaling `stand` without
   `look`) slides her 3.3%.
2. **Frame-rate independence probed at one moment.** Caught a per-frame lerp of
   0.05 at 1.768 m, but a lerp of **0.2 walked through it** at 0.028 m — fast
   enough that both rates had settled before the probe looked. Now the worst of
   a sweep along the ramp. Bound 1.0 m, from a measured table: 0.071 m with no
   zoom, 0.260 shipping, 1.306 at pull-back 1.5, 2.018 for a 0.2 lerp, 4.063 for
   a 0.05 lerp. Not zero, because `damp` is exact only for a stationary target
   and both followers chase a moving one — an inherent O(dt) error, not a lerp.

### Where the six items stand

1. **Camera jerk — done** (round 6's commit, independently re-verified here:
   `TANGENT_WINDOW` 2 m and `CAMERA_GUIDE_WINDOW` 10 m are both live, and
   `raceCameraNeverRunsBackwards` runs on all five seeds).
2. **Speed zoom — done and now guarded.** 25.6 m off at a crawl, 33.6 m racing
   (31.2% back), eased on a 0.55 s half-life.
3. **Boost rock — done, guarded.** Head throws 1.42 m on a pump.
4. **Win celebration — done, guarded.** 3 hops, peak 0.905, 1.56 m of lift,
   settled by 3.10 s of the 5 s the camera holds. The hold itself was already
   there: finishing freezes `travelled`, so the rig settles on her.
5. **Leg guards — done, guarded in all five phases** through the real rule and
   the real setter, read back off `visible` *and* the drawn bounding box.
6. **Skull clip — rechecked: 4.8 frames at a child's 30.3 m/s top speed** (was
   4.8 at 30.3 — unchanged by the new difficulty). Reported at every build,
   still not fixed: the ~1.9 m `BAR_CONTACT_LEAD` moves when the bonk fires, and
   that wants eyes first. **This is the one deliberate omission.**

`body.rotation.x` has one owner, `poseRailRaceRider`, told everything at once
via `RiderPose`. Boosting while ducking is guarded (head top 5.66 either way,
against a bar underside of 6.38).

### Guards proved red by mutation — 15 in all

Pose/state (10): `cheerAt` returning 0; one long hop; a jump outlasting the
camera hold; legs hidden for the win; legs always drawn; the bob freeze
restored; `BOB_SECONDS` 0.5; `BOOST_ROCK` 0; `CHEER_HOP` 0; the pump ungated by
the fold. Camera (5): no pull-back; pull-back 1.5; `stand` scaled without
`look`; per-frame lerps at 0.05 and at 0.2.

Scripts: `/tmp/.../scratchpad/mutate.sh` and `mutate-cam.sh` (untracked, outside
the repo).

### Still needs eyes — no browser this session either

The chrome MCP was not assigned to me, so **everything visual is unverified**.
The list from earlier rounds still stands, plus: does the pull-back read as a
camera easing off or as the picture breathing; does the victory jump read as a
jump; do her legs appearing for the celebration look right or sudden.

### One interaction between two of this PR's own features — arithmetic, not a guard

The face-turn check and the speed zoom landed in the same PR and touch the same
quantity. `RaceCamera.reset()` sets `zoom = 1`, and every downstream user of the
rig in `check:rail-race` (`sweep`, the face sweep) calls `reset` before reading
the camera — so **the face checks all measure the resting framing**, never the
pulled-back one, which is exactly when a child is looking at her.

Worked through rather than left hanging: the pull-back is a uniform scaling of
the rig about the rider, so the *rider* holds her NDC mark exactly, and the eyes
— a fixed world offset from her — move **towards** that mark as the lens
retreats. So the "on screen" margins (monitor 0.288, phone 0.112) only improve.
Eye *separation* shrinks with distance, 25.6 → 33.6 m being a factor of 1.313:
monitor 0.055 → ~0.042, phone 0.102 → ~0.078, against a floor of **0.01**. Four
to eight times the floor at the worst framing.

**This is arithmetic off the measured numbers, not a guard**, and it is the one
claim in round 7 that is not proved red by mutation. It would become one by
driving the face sweep through a rig settled at racing speed instead of a reset
one — worth doing if the zoom depth is ever raised.

---

## Round 8 (7 Aug), agent `e-railrace-blockers` — branch `e/railrace-blockers`

Worktree `.claude/worktrees/e-railrace-blockers`, branched from
`origin/chore/rail-race-pr-triage`, `origin/main` merged in (one commit: the
dev-service-worker change). Two review blockers only; nothing else touched.

**Both were found by going past a green build, and both were the same disease
in different organs: a check that could not see the thing it was named after.**

### Blocker 1 — the pose never reached the screen. FIXED, and the check now runs the real pipeline

`poseRailRaceRider` was correctly the single **owner** of `body.rotation.x`. It
was not the last **writer**. `Player.update`'s riding branch ran `animate()`
(which ends by applying the pose) and *then* `applyRidePose`, which assigns
`body.rotation.x = 0.3` unconditionally.

| state | the owner asks for | the screen showed |
| --- | --- | --- |
| seated | 0.160 | **0.300** |
| duck | 0.860 | **0.300** |
| boost | 0.580 | **0.300** |
| celebration | −0.148 | **0.300** |

So the waist fold, the boost rock and the victory lean were computed exactly
right and thrown away before being drawn, for the whole life of the feature.
Only the squash and hip drop survived, which is why the duck delivered 0.42 m
against a bar sized for 0.73 m: **the duck bar went through her head while she
was ducking**, and `check:rail-race` printed *"clears by 0.73"* about it.

**Fixed by ordering, not by a fourth writer.** `applyRidePose` now runs at the
end of `Player.animate`, immediately before `poseRailRaceRider`. A quiet second
gain: `model.update` (the ponytail) now runs *after* the ride pose rather than
before it, which is what its own comment already claimed.

**The check posed a bare `createKid` and called the pose function directly**, so
it never executed the player's pipeline. It now builds a real `Player`, boards
her as `RailRace.requestBoard` does, poses her as `RailRace.poseRider` does, and
reads every height off the model *after* `Player.update` has finished. Plus one
direct guard: what she draws must equal what the pose asked for, in all four
states, against a bare kid posed by the owner alone.

**Proved red first — 7 failures**, including `boost rock head throws 0.00 m` and
`clears by −0.40`. Green after: `clears by 0.73, strikes by 0.72`, `head throws
1.42 m`, `pose drawn seated 0.160 duck 0.860 boost 0.580 celebration −0.148`.

### Blocker 2 — the camera invariant probed a rig nobody rides. FIXED

`parkFacts` drove the rig through `reset()`, which pinned `zoom = 1`. The game
reaches **1.34** within a second and holds it, and zoom scales the stand-off —
the quantity a reversal is decided by.

| | zoom | stand-off | least forward | backwards |
| --- | --- | --- | --- | --- |
| crawl | 1.000 | 27.5 m | 0.094 | 0/2400 |
| racing | 1.340 | 35.5 m | **−0.150** | **64/2400 (2.67%)** |

Proved red through the real suite: **4 of 5 seeds fail, every one at 32 m/s**
(−0.150 / −0.156 / −0.189, plus one at +0.016 that never reverses but is well
under the floor).

**Both obvious levers are walled off, and both walls are measured — do not
reopen either without reading this:**

```
  guide window   racing reversal   check:rail-race
     10 m         -0.150 (2.67%)   passes            <- shipping
     12 m         -0.043 (0.79%)   FAILS  side-scroller 0.897
     14 m         +0.055 (0.00%)   FAILS  swing 27.3°, eye facing 0.348
```

The drift a wider window adds and the reversal it removes sit at the **same two
hairpins**, so no window fixes one without breaking the other. The sweep table
in `CAMERA_GUIDE_WINDOW`'s own comment was taken at zoom 1. And clamping the
zoom globally to what the ring carries everywhere gives **1.062** — a 6%
pull-back instead of Jim's 34%.

**Why it happens:** the ring is the park boundary pushed outward, and pushing a
boundary outward *tightens* its concave corners. That leaves two hairpins of
about **22 m radius**, at 68 m and 473 m from the arch. A camera 35 m outside a
22 m bend rides a tighter circle than the rider does. She stays exactly on her
screen mark, so what a child sees is the world swinging the wrong way behind her.

**Fixed with a per-station zoom ceiling solved from the built ring**
(`RaceCamera.measureZoomCeiling`). Camera position is `rider(s) + zoom·V(s)`, so
forward progress is affine in zoom and the largest safe zoom falls out of
rearranging it — no search, no tuning. Eroded then blurred (which cannot raise a
value above the raw ceiling, so the guarantee survives the smoothing). Floored
at 1: it may take the *pull-back* away, never the resting stand-off.

Result: **full 34% pull-back on 493 m of the 600.2 m lap (82.1%)**, easing in
through the two hairpins. `check:rail-race`'s zoom line moves 33.6 m/31.2% →
33.0 m/29.0% and still passes.

The rig keeps 0.15 of forward progress; the invariant demands 0.05 of the built
ring. **Deliberately different numbers** — had the rig aimed at the number the
check tests for, the check would be reading back a constant.

**One trap worth knowing about, hit while writing this:** an
`Infinity − Infinity` in the ceiling's interpolation put the camera at NaN on
1763 of 2400 probes, and the sweep reported a pristine 0.094 anyway. NaN loses
every `<` it is asked, so a running minimum **skips** it rather than catching it;
only the stand-off, a running `Math.max`, said so (it read `NaN`). The fact now
counts non-finite probes separately and the invariant fails on them outright.

### The reviewer's addition — a max-margin bound on `childPace`. DONE

Correcting the record first: that procession bound went **140 → 170 → 600.2**,
not 140 → 170, and it moved onto `mashPerfect` on the way. Not reopened.

**A bound on the *worst* seed cannot do this job, and that is measured.**
`SWING_BEHIND`'s band tows a far-behind rival forward, compressing the very
number a max-bound reads:

```
  RIVAL_SKILL              child margin (24 seeds)      mean
  0.40 / 0.48 / 0.56        27.3 - 306.2 m             114.8   <- shipping
  0.30 / 0.36 / 0.42        64.3 - 389.9 m             219.4
  0.20 / 0.24 / 0.28       187.9 - 484.5 m             316.4
  0.10 / 0.12 / 0.14       308.0 - 529.1 m             425.4
```

The max never reaches one lap (600.2 m) however absurd the rivals get, so
`max(...) < route.length` would be a guard **incapable of failing** here. The
mean separates all four cleanly.

So: a child's **mean** margin must stay under **half a lap** (300.1 m), from the
game's own geometry, protecting something visible — the camera holds on her for
the whole celebration and a rival half a lap back is round the far side of the
ring. Met at 114.8 m with 2.6x room; **no difficulty was re-tuned**. Red at
rivals cut to half skill (316.4 m).

### FOR JIM, not acted on

**A competent player now wins by a mean of 461 m on a 1200 m race** (range
279.8–551.1). That may be too easy. It is a direct consequence of what he asked
for, he rides this too, and it is his call — so it is flagged, not changed.

### Checks

- `npm run build` — **exit 0**, run directly, never piped.
- `npm run test:procgen` — **171 passed, 9 files, 0 skipped**.

### Still needs eyes — no browser this session either

The chrome MCP was not assigned to me. Everything visual is still unverified,
and round 8 adds three things to the list that have **never been seen by
anyone**, because until this branch they were not drawn at all:

1. **The waist fold.** Does a duck read as ducking now that it actually happens?
2. **The boost rock.** 1.42 m of head throw per pump — feedback, or a twitch?
3. **The victory lean**, and the jump it belongs to.

Plus, new in round 8: **does the camera easing in through the two hairpins read
as a camera tucking in on a corner, or as the picture breathing?** It is 107 m
of the 600 m lap, twice a lap.

### Untouched, deliberately

The 4.8-frame skull graze is still the one deliberate omission — unchanged by
either fix, still reported at every build, still wanting eyes before a
`BAR_CONTACT_LEAD` moves when the bonk fires.
