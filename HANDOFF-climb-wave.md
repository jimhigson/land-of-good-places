# HANDOFF — climb-wave

Branch `feat/climb-wave-and-npc-climb`, worktree `.claude/worktrees/climb-wave`.
GitHub #120 / board task #10. Browser NOT owned — build-verify only.
**No PR until the Overseer says.**

## Scope correction, found before writing any code

#120 is two asks. **The second one already shipped.**

> "NPCs should also climb trees (new activity on the existing climb zones)."

`src/entities/npc/activities/treeClimb.ts` landed in **PR #84** (`b764880`,
28 July), fixed in #90. It is a full `Activity` — budget, cooldown, up/peek/down
phases — instantiated at `wanderDriver.ts:149` and posed by
`TreeClimbing.updateNpcClimbs`. Nothing to do; I did not touch it.

So this branch is **only the player's wave**.

## The problem that shaped the design

A climber peeks with her **head at `canopyTopY` and everything else hidden**
(`TreeClimbing`, "Body hidden, head out"). Three things followed:

1. **The waving arm has to stay drawn.** `hidePlayerBody` now spares
   `model.rightArm` as well as the head. Her shoulder stays buried, so what
   appears is a hand and some forearm beside a head — the cartoon read.
2. **She has to rise.** *Her arm cannot reach above her own head.* Shoulder at
   0.72, head at 1.36 (`kid.ts`). Measured on the real rig at the real wave
   angle across the whole waggle, the hand tops out **0.303 m below her head**,
   while the canopy at her perch is only ~0.18 m below `canopyTopY`. A raised
   arm alone is ~0.12 m *inside the leaves* from every bearing. `WAVE_RISE = 0.3`
   lifts the whole child; worst clearance on the canonical park is 0.176 m.
3. **The pose belongs to `Player`, not `TreeClimbing`.** `Player.update`'s
   riding branch rewrites *both* arms every frame (`Player.ts`, the hold-on
   pose) and returns — an arm posed from outside survives exactly one tick.
   `Player.setClimbWave(0..1)` blends over that pose instead, using the crowd's
   own wave numbers so one gesture reads across the park.

**Do not "simplify" this by posing the arm from `TreeClimbing`.** It will look
correct, typecheck, and do nothing.

## Timing (the charm, per the brief)

`WAVE_FIRST_DELAY 0.85` → first wave almost immediately (the point of climbing
is being seen to have done it), then `WAVE_CYCLE_SECONDS 4.4` with
`WAVE_DURATION_SECONDS 1.7`. She turns to the camera to wave
(`CAMERA_FACING = CAMERA_YAW_DEGREES * DEG`; forward is `(sin, cos)` and the
camera sits at `(sin yaw, cos yaw)`) and drifts back to her peek facing after.
That is a **scripted pose, not a control** — nothing here reads the stick, so
the CONTROL RULE is untouched.

## The QA failure, and the one-sign bug (5 Aug)

QA failed the first attempt: the hand was **0% visible from the game camera on
all four climbable trees**, blocked by **her own skull, hair and ear**, with
*zero* foliage blockers. Her head read ~96% by the same method.

The cause was one sign. The crowd waves with the arm swinging **inward**
(`CLIMB_WAVE_ARM_Z` negative, from `NpcCharacter.animate`). On the ground that
is fine — you see the whole child. Up a tree only her head is out of the leaves,
so an inward hand lands squarely behind her own skull. Swinging it **out**
(+1.25, swept not guessed) gives **76%** and 18 px of hand.

**The old check stayed green through all of it**, because it measured the hand
against the canopy ellipsoids only. Its 0.176 m of leaf clearance was correct
and irrelevant: the hand cleared the leaves and then hid behind her head.

> *"Clears the obstacle I thought of" is not visibility.*

### The sentence to keep

> **A check that re-implements a pose can pass a pose the game never renders,
> which is precisely how the invisible wave shipped.**

That is why `applyRidePose` now lives in `Player.ts` and is *called* by the
check rather than copied into it. It is the duplicate-definition disease in its
most dangerous form: the copy that agrees with itself while the game does
something else.

## The ceiling — anatomy, not tuning

**~19 px of hand is all this rig can produce at play scale.** Her lateral reach
is 0.38 (shoulder) + 0.455 (arm + hand) = 0.835 m from her centreline, against a
skull of roughly 0.6 m radius — this kid is 59% head (ART_DIRECTION.md §4). Only
~0.23 m of hand can ever clear her own silhouette: about four pixels wide at
61 mm/px. Swinging further out makes it *worse*, not better — 10 px at z = 2.0,
1 px at z = 2.3, as the hand rotates back behind her.

**If a bigger gesture is ever needed, the lever is the body, not the arm.** The
head is 474 px against the hand's 18. Moving the whole silhouette (a lean or
sway) is roughly twenty-five times more screen area than anything the arm can do.

## `npm run check:climb-wave`

New, and in `build`. It exists because the wave's visibility depends on four
numbers in four files that never reference each other, and the only symptom of
breaking it is *a wave you cannot see* — which no other check would catch and
which I could not eyeball (QA holds the browser).

It measures rather than computes: poses a **real** kid and takes the arm's world
bounds through the whole waggle, then walks the **real** generated park and
evaluates the **real** canopy ellipsoids over every climbing spot, at all 72
approach bearings.

It corrected me immediately: I had derived the hand as ~0.25 m below her head;
it is 0.303. Trust it over any arithmetic in a comment, including mine.

## PR #188 (swappable model) — what I did about it

`playerHiddenParts` holds children of the player's model, and #188 can replace
that model mid-climb. It now records **which model** it collected from
(`playerHiddenModel`); on restore, a mismatch means the refs belong to a
discarded model, so they are dropped and the live model is left alone (a fresh
model is already fully visible). `setClimbWave` is on `Player`, which owns its
own model reference, so the wave needs nothing further.

## Also fixed (pre-existing, one line)

`updatePlayerClimb`'s `if (!tree)` bail cleared the phase but left her **hidden
and still `riding`** — invisible and unable to move. It now restores the body
and ends the ride. Reachability not established; it was free to make safe.

## State

- [x] wave implemented — `559123a`
- [x] `check:climb-wave` + build wiring — `8ad4816`
- [x] `!tree` bail fix + this handoff — see final commit
- [x] `npm run build` exit 0, with `check:climb-wave` inside it
- [ ] PR — **hold**

## Round 3 — measure in SCREEN space, never world space

QA called round 2 marginal: it read as *"she turns round and looks at you"*, not
*"she waves"*. The finding that matters:

**The 0.3 m hoist contributes nothing on screen, and nets negative.** `Game.ts`
follows `player.position`; `IsoCamera.update` damps `focus.y` toward it. The
camera climbs with her and eats the hoist, and turning to camera swings her
off-axis head, which an isometric projection folds into screen-Y. Measured,
world-anchored at play scale, her silhouette's centroid moves **−3.5 px at
bearings 0°/90° and +1.7 px at 180°/270°** — a 0.31 m rise arriving as −3 px,
sign-flipping by approach.

> **A world-space number is not evidence of anything the eye can see.**
> Measure against a world-anchored window at play scale (`--motion`).

**The fix is a rotation, not a translation.** A camera that follows position can
cancel a translation; it cannot cancel a rotation. `CLIMB_WAVE_LEAN` rocks
`body`, swinging her head *and* arm — her head is ~25× the arm's screen area.
Measured: **6.7–7.3 px of travel at every bearing** (~35 px at desktop).

### The hand is approach-dependent; the rock is not

Hand pixels by approach bearing (0/90/180/270): **7 / 19 / 15 / 0**. On one side
the canopy hides the arm outright. The check had been reporting 76% because it
takes the **best** bearing — the same error class as measuring only the obstacle
you thought of. The spread is now printed every run, and the pass depends on the
rock, which is bearing-independent.

**Still open (QA's second finding, not fixed):** the *turn* cue is also
approach-dependent — 45°–297° across the four sides, so climbing from the
camera-facing side nearly removes the strongest cue. The fix is to choose the
perch on the camera-facing side of the trunk rather than by approach, which
changes where the scramble goes and so wants QA eyes; not attempted here.

## CLOSED — Jim's ruling, 5 Aug: sit higher, ship it

> *"I think the waving in the tree doesn't need more QA, just let the character
> sit higher and call it done."*

`CLIMB_PEEK_LIFT = 0.74` (40% of the kid's 1.86 m). Re-measured by QA's method —
eight bearings, whole scene, delta technique — the arm now shows **18–21 px at
every bearing on every tree: 0 of 32 zeros, from 15 of 32.** The arm half of the
anti-correlation is gone.

**Peeking read preserved** (the risk flagged before doing it): at play scale the
canopy still meets her at about chin level with ~6 px of head clear above it.
She reads as sitting *in* the tree from the chest up, not floating above it —
better than before, when only the crown of her head showed as a bump.

**Known, not fixed:** the *turn* is still approach-dependent (0.49 s
camera-facing out of a 1.7 s wave at bearing 45°, against the full 1.70 s at
225°). The lift does not address it. Not opened.

## Round 3 QA — FAILED (history; superseded by the ruling above)

The rock was **verified**: 22.7 px of head travel at 1280×800, identical at
every settled bearing on all four trees. QA froze the world (`timeScale = 0`)
and advanced only the pose clock by half a rock period, so two frames differed
by exactly one thing — a cleaner method than the one in this script.

**But a rocking head is not a wave.** QA: *"a girl's head popping out of a bush
and swaying happily — genuinely quite cute, just not a wave."*

**The hand is worse than this handoff previously said.** Measured as pixels
changed when the arm is deleted, whole screen rather than a crop:

- **0 px on the entire screen** at bearings 225°/270°/315°, on **every** tree
- **15 of 32** tree×bearing combinations show no arm at all
- best case ~13–20 px with no forearm and no separation from the head; ~4 CSS px
  on phone

The figures printed by `--motion` (7/19/15/0 at four cardinal bearings) sampled
too few bearings and used a crop rather than the whole screen. **Both errors
flattered the feature.** Trust QA's numbers over this script's.

**The blocker has changed since round 1.** Hiding her head now reveals nothing:
it is **the canopy** in front of the hand, not her own skull. Round 1's fix
(swing the arm out) was correct and is not the current problem.

**The finding that decides it: the turn and the hand are anti-correlated.** She
is camera-facing for only 0.67 s of the 2.38 s wave at the worst approach. Where
the arm shows (90°/135°) she is still spinning; where she settles facing you
(225°/270°/315°) the arm is gone. Only 180° gives both, and there the hand is a
bead.

**Direction (QA, endorsed by the Overseer): the lever is height, not amplitude.**
Her hand tops out 0.303 m below her head, essentially level with `canopyTopY`,
so canopy bulk sits in front of it from the far bearings. Raising
`CLIMB_WAVE_LEAN` only makes the wobble worse.

### Options put to Jim (his call, not an agent's)

1. **Perch her on the camera-facing side of the trunk** rather than by approach.
   Kills the anti-correlation, removes the long turn, lifts the arm clear —
   addresses both failures. Changes where a child ends up sitting after a climb.
2. **Perch her higher** (raise the peek so the hand clears `canopyTopY`). Same
   "height" lever, smaller behavioural change, she still sits where she climbed
   — but her head floats further above the leaves, so it may stop reading as
   *peeking out of* a bush.
3. **Ship what exists and drop the wave.** The turn + rock is, in QA's own
   words, genuinely quite cute. Close #120 as partially delivered and stop
   spending rounds on a gesture this rig struggles to show.

Nothing functional regressed across any round: 11/11 this pass, console clean,
build exit 0, day and night identical, touch build correct.

## What the check now enforces (three terms)

1. **Un-occluded ≥ 50%** — raycast from the real orthographic game camera
   against *every drawn mesh, her own body included*, over 12 bearings × 8
   waggle phases. Threshold sits in the empty gap between the inward poses
   (~0%) and the outward ones (51–80%).
2. **Legible ≥ 12 px** — rasterises her at play scale (35 px figure) and counts
   hand pixels. Shipped pose gives 18. *Un-occluded is not the same as seen*,
   and skipping this is how the first version passed a wave nobody could see.

Plus a **control**: the head, measured identically. If it ever drops below 50%
the script reports *itself* broken rather than blaming the pose — a method that
returns 0% for everything proves nothing.

`--sweep` explores arm angles; `--picture` prints the ASCII render. Both go
through the same measurement as the check, so they cannot disagree with it.

## Visual QA still needed (no browser)

1. Climb a tree: after ~0.85 s she swings round to the camera and waves, then
   settles back to her peek facing; repeats every ~4.4 s.
2. The **hand is visible above the leaves** through the whole wag — the one
   thing `check:climb-wave` bounds numerically but nobody has actually looked at.
3. The rise reads as hauling herself up, not floating.
4. Climb down mid-wave: arm returns to normal, body reappears, no stuck pose.
5. An NPC climbing nearby still looks right (untouched, but shares `climbPose`).
